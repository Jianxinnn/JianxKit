"""代码能确定的检查都在这里：输入、格式、类别、字段、原文引用是否存在。
原文是否真正支持结论属于语义判断，不在这里做。"""

from __future__ import annotations

import unicodedata
import json
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, ValidationError

from .types import ClassifyData, Evidence, Issue, ProviderResult, Request, Status


@dataclass
class Settled:
    status: Status
    data: Any
    evidence: list[Evidence]
    issues: list[Issue]


def _invalid(message: str) -> Issue:
    return Issue('invalid_input', message)


# ---- 输入检查 ----


def check_input(input: Any) -> list[Issue]:
    parts = input.get('parts') if isinstance(input, dict) else None
    if not isinstance(parts, list) or not parts:
        return [_invalid('input["parts"] must be a non-empty list')]
    issues: list[Issue] = []
    seen: set[str] = set()
    for index, part in enumerate(parts):
        part_id = part.get('id') if isinstance(part, dict) else None
        if not isinstance(part_id, str) or not part_id.strip():
            issues.append(_invalid(f'part {index} has no id'))
            continue
        if part_id in seen:
            issues.append(_invalid(f'duplicate part id "{part_id}"'))
        seen.add(part_id)
        if not isinstance(part.get('content'), (str, dict)):
            issues.append(_invalid(f'part "{part_id}" content must be a string or a dict'))
    if not issues:
        try:
            json.dumps(input, allow_nan=False)
            if all(_text(p['content']) == '' for p in parts):
                issues.append(_invalid('all parts are empty'))
        except (TypeError, ValueError, RecursionError):
            issues.append(_invalid('input must be JSON serializable'))
    return issues


def check_categories(categories: Any) -> list[Issue]:
    if not isinstance(categories, list) or not categories:
        return [_invalid('categories must be a non-empty list')]
    ids = [c.get('id') if isinstance(c, dict) else None for c in categories]
    if any(not isinstance(i, str) or not i.strip() for i in ids):
        return [_invalid('every category needs an id')]
    if any(not isinstance(c.get('description'), str) or not c['description'].strip() for c in categories):
        return [_invalid('every category needs a description')]
    duplicate = next((i for n, i in enumerate(ids) if i in ids[:n]), None)
    return [_invalid(f'duplicate category id "{duplicate}"')] if duplicate else []


# ---- 结果检查 ----


def settle(request: Request, result: ProviderResult) -> Settled:
    try:
        data, review = _check_data(request, result.data)
    except _Invalid as error:
        return Settled('failed', None, [], [Issue('invalid_output', m) for m in error.messages])
    targets = _conclusion_targets(request, data)
    kept, evidence_issues = _check_evidence(request, result.evidence, set(targets))
    issues = [*result.issues, *review, *evidence_issues]
    covered = {item.target for item in kept}
    missing = [target for target in targets if target not in covered]
    if request.require_evidence and missing:
        issues.append(Issue('missing_evidence', f'no quote from the input for: {", ".join(missing)}'))
    return Settled('needs_review' if issues else 'ok', data, kept, issues)


class _Invalid(Exception):
    def __init__(self, *messages: str):
        self.messages = messages


def _check_data(request: Request, data: Any) -> tuple[Any, list[Issue]]:
    if request.operation == 'extract':
        assert request.schema is not None
        try:
            return request.schema.model_validate_json(json.dumps(data, allow_nan=False), strict=True), []
        except ValidationError as error:
            raise _Invalid(*(
                f'schema: {".".join(str(x) for x in e["loc"]) or "(root)"}: {e["msg"]}' for e in error.errors()
            )) from None

    if request.operation == 'judge':
        if not isinstance(data, dict):
            raise _Invalid('verdicts must be an object')
        verdicts: dict[str, bool | None] = {}
        review: list[Issue] = []
        for key, statement in request.statements.items():
            value = data.get(key, ...)
            if value is not True and value is not False and value is not None:
                raise _Invalid(f'verdict "{key}" must be true, false or null')
            verdicts[key] = value
            if value is None:
                review.append(Issue('undetermined', f'material is not enough to decide: {statement}'))
        return verdicts, review

    if isinstance(data, ClassifyData):
        data = {'categories': data.categories, 'undetermined': data.undetermined}
    raw = data.get('categories') if isinstance(data, dict) else None
    if not isinstance(raw, list) or not all(isinstance(c, str) for c in raw):
        raise _Invalid('classification must contain a list of category ids')
    if not isinstance(data.get('undetermined'), bool):
        raise _Invalid('classification undetermined must be a boolean')
    categories = list(dict.fromkeys(raw))
    known = {c['id'] for c in request.categories}
    unknown = [c for c in categories if c not in known]
    if unknown:
        raise _Invalid(*(f'unknown category "{c}"' for c in unknown))
    if request.mode == 'single' and len(categories) > 1:
        raise _Invalid(f'single mode returned {len(categories)} categories')
    # 单选时什么都没选，等同于无法确定；多选时允许“都不适用”
    undetermined = data.get('undetermined') is True or (request.mode == 'single' and not categories)
    review = [Issue('undetermined', 'material is not enough to classify')] if undetermined else []
    return ClassifyData(categories, undetermined), review


# 引用指向实际结论；嵌套字段和数组元素使用点路径，例如 items.0.name。
def _conclusion_targets(request: Request, data: Any) -> list[str]:
    if request.operation == 'classify':
        return data.categories
    if request.operation == 'judge':
        return [key for key, value in data.items() if value is not None]

    def leaves(value: Any, path: str) -> list[str]:
        if value is None:
            return []
        if isinstance(value, (dict, list)):
            items = value.items() if isinstance(value, dict) else enumerate(value)
            return [p for key, item in items for p in leaves(item, f'{path}.{key}' if path else str(key))]
        return [path]

    return leaves(data.model_dump(mode='json', by_alias=True), '')


# ---- 原文引用 ----


def _check_evidence(request: Request, evidence: list[Any], targets: set[str]) -> tuple[list[Evidence], list[Issue]]:
    parts = {p['id']: _text(p['content']) for p in request.input['parts']}
    kept: list[Evidence] = []
    issues: list[Issue] = []
    for item in evidence:
        e = _as_evidence(item)
        if e is None:
            issues.append(Issue('bad_evidence', 'malformed evidence item dropped'))
            continue
        source = parts.get(e.source_id)
        quote = _normalize(e.quote)
        if e.target not in targets:
            issues.append(Issue('bad_evidence', f'evidence cites unknown or empty target "{e.target}"'))
        elif source is None:
            issues.append(Issue('bad_evidence', f'evidence for "{e.target}" cites unknown part "{e.source_id}"'))
        elif not quote or quote not in source:
            issues.append(Issue('bad_evidence', f'quote for "{e.target}" not found in part "{e.source_id}"'))
        else:
            kept.append(e)
    return kept, issues


def _as_evidence(item: Any) -> Evidence | None:
    if isinstance(item, Evidence):
        item = {'target': item.target, 'source_id': item.source_id, 'quote': item.quote}
    if not isinstance(item, dict):
        return None
    target, quote = item.get('target'), item.get('quote')
    source_id = item.get('source_id', item.get('sourceId'))
    if not (isinstance(target, str) and isinstance(source_id, str) and isinstance(quote, str)):
        return None
    return Evidence(target, source_id, quote)


# 与语言模型看到的资料一致，保留大小写、标点和数字符号。
def _text(content: Any) -> str:
    return _normalize(content if isinstance(content, str) else json.dumps(content, ensure_ascii=False, indent=2))


def _normalize(value: str) -> str:
    value = unicodedata.normalize('NFC', value)
    value = ''.join(chr(ord(ch) - 0xFEE0) if '！' <= ch <= '～' else ch for ch in value)
    return ' '.join(value.split())
