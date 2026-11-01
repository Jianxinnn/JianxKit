"""Jev（TypeSafe System One）适配器：把统一请求转换为 Choice / Noul 问题。
协议见 https://docs.typesafe.ai/api/system-one.md"""

from __future__ import annotations

from typing import Any
import math

from ..types import Issue, JevConfig, ProviderResult, Request, Verdicts
from .http import ProviderError, post_json

UNDETERMINED = '__undetermined__'
MAX_CHOICE_OPTIONS = 255

JUDGE_CRITERIA = {
    'holds': 'The `state` clearly supports the statement.',
    'does_not_hold': 'The `state` clearly contradicts the statement.',
    'unknown': 'The `state` does not contain enough information to decide.',
}
VERDICT = {'holds': True, 'does_not_hold': False, 'unknown': None}


class JevProvider:
    name = 'jev'

    def __init__(self, config: JevConfig):
        self.config = config
        if not all(_is_probability(v) for v in (config.min_confidence, config.noul_yes, config.noul_no)) or config.noul_no >= config.noul_yes:
            raise ValueError('jev thresholds must be in [0, 1], with noul_no < noul_yes')
        if not math.isfinite(config.timeout) or config.timeout <= 0:
            raise ValueError('jev.timeout must be positive')

    # Jev 不做自由提取，也不返回原文引用
    def supports(self, request: Request) -> bool:
        if request.operation == 'extract' or request.require_evidence:
            return False
        if request.operation == 'classify' and request.mode == 'single':
            ids = [c['id'] for c in request.categories]
            return len(ids) < MAX_CHOICE_OPTIONS and UNDETERMINED not in ids
        return True

    async def run(self, request: Request) -> ProviderResult:
        if request.operation == 'judge':
            return await self._judge(request)
        if request.operation == 'classify':
            return await (self._classify_single(request) if request.mode == 'single' else self._classify_multi(request))
        raise ProviderError(f'jev does not support {request.operation}', transient=False)

    async def _ask(self, request: Request, questions: dict[str, Any]) -> tuple[str, dict[str, Any]]:
        c = self.config
        state = {part['id']: part['content'] for part in request.input['parts']}
        body = await post_json(
            c.url,
            {'Authorization': f'Bearer {c.api_key}'},
            {'model': c.model, 'state': state, 'questions': questions},
            c.timeout,
            c.transport,
        )
        answers = body.get('answers') if isinstance(body, dict) else None
        if not isinstance(answers, dict):
            raise ProviderError('Jev response has no answers', transient=False)
        for name in questions:
            if not isinstance(answers.get(name), dict):
                raise ProviderError(f'Jev response is missing answer "{name}"', transient=False)
            if answers[name].get('type') != questions[name]['type']:
                raise ProviderError(f'Jev answer "{name}" has an unexpected type', transient=False)
        model = body.get('model')
        return (model if isinstance(model, str) else c.model), answers

    def _low_confidence(self, answer: dict[str, Any], what: str) -> list[Issue]:
        confidence = answer.get('confidence')
        if confidence is None:
            return [Issue('low_confidence', f'missing confidence for {what}')]
        if not _is_probability(confidence):
            raise ProviderError('Jev confidence must be a probability in [0, 1]', transient=False)
        if confidence >= self.config.min_confidence:
            return []
        return [Issue('low_confidence', f'confidence {confidence:.2f} for {what}')]

    async def _classify_single(self, request: Request) -> ProviderResult:
        criteria = {c['id']: c['description'] for c in request.categories}
        criteria[UNDETERMINED] = 'The `state` does not contain enough information to pick any other option with certainty.'
        question = {
            'type': 'choice',
            'instructions': _with_task(request.instruction, 'Which category best describes the `state`?'),
            'criteria': criteria,
        }
        model, answers = await self._ask(request, {'category': question})
        answer = answers['category']
        choice = answer.get('choice')
        if not isinstance(choice, str):
            raise ProviderError('Jev choice answer has no choice', transient=False)
        undetermined = choice == UNDETERMINED
        data = {'categories': [] if undetermined else [choice], 'undetermined': undetermined}
        return ProviderResult(model, data, issues=self._low_confidence(answer, f'"{choice}"'), raw=answers)

    async def _classify_multi(self, request: Request) -> ProviderResult:
        questions = {
            f'c{i}': {
                'type': 'noul',
                'instructions': _with_task(request.instruction, f'Does the category "{c["id"]}" apply to the `state`?'),
                'criteria': {'true': c['description'], 'false': 'The `state` does not match this description.'},
            }
            for i, c in enumerate(request.categories)
        }
        model, answers = await self._ask(request, questions)
        chosen: list[str] = []
        issues: list[Issue] = []
        for i, category in enumerate(request.categories):
            p = answers[f'c{i}'].get('noul')
            if not _is_probability(p):
                raise ProviderError('Jev noul answer must have a probability in [0, 1]', transient=False)
            if p >= self.config.noul_yes:
                chosen.append(category['id'])
            elif p > self.config.noul_no:
                issues.append(Issue('low_confidence', f'"{category["id"]}" has probability {p:.2f}'))
        data = {'categories': chosen, 'undetermined': bool(issues)}
        return ProviderResult(model, data, issues=issues, raw=answers)

    async def _judge(self, request: Request) -> ProviderResult:
        keys = list(request.statements)
        questions = {
            f's{i}': {
                'type': 'choice',
                'instructions': f'Statement: {request.statements[key]}\nDoes the `state` support this statement?',
                'criteria': JUDGE_CRITERIA,
            }
            for i, key in enumerate(keys)
        }
        model, answers = await self._ask(request, questions)
        data: Verdicts = {}
        issues: list[Issue] = []
        for i, key in enumerate(keys):
            answer = answers[f's{i}']
            if answer.get('choice') not in VERDICT:
                raise ProviderError(f'Jev returned unexpected choice "{answer.get("choice")}"', transient=False)
            data[key] = VERDICT[answer['choice']]
            issues += self._low_confidence(answer, f'"{key}"')
        return ProviderResult(model, data, issues=issues, raw=answers)


def _with_task(instruction: str | None, question: str) -> str:
    return f'Task: {instruction}\n{question}' if instruction else question


def _is_probability(value: Any) -> bool:
    return type(value) in (int, float) and math.isfinite(value) and 0 <= value <= 1
