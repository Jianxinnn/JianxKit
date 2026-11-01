"""通用 AI 处理模块：分类、提取、判断。Jev 优先，普通语言模型补充。

    ai = create_ai(jev={'api_key': ...}, llm={'base_url': ..., 'api_key': ..., 'model': ...})
    result = await ai.classify(input=..., categories=[...])

同步代码用 create_sync_ai，方法和参数相同。
"""

from __future__ import annotations

import asyncio
import math
from typing import Any, Sequence, TypeVar, overload

from pydantic import BaseModel

from .providers.http import ProviderError
from .providers.jev import JevProvider
from .providers.llm import LlmProvider
from .runner import Policy, failed, run
from .types import (
    Category,
    CategoryLike,
    ClassifyData,
    Evidence,
    Input,
    InputLike,
    Issue,
    IssueCode,
    JevConfig,
    JudgeData,
    JudgeManyData,
    LlmConfig,
    Meta,
    Mode,
    Part,
    Provider,
    ProviderResult,
    Request,
    Result,
    Status,
    Verdicts,
)
from .validation import check_categories, check_input

__all__ = [
    'AI', 'SyncAI', 'create_ai', 'create_sync_ai', 'JevProvider', 'LlmProvider', 'ProviderError',
    'Category', 'CategoryLike', 'ClassifyData', 'Evidence', 'Input', 'InputLike', 'Issue', 'IssueCode', 'JevConfig', 'JudgeData',
    'JudgeManyData', 'LlmConfig', 'Meta', 'Mode', 'Part', 'Provider', 'ProviderResult', 'Request',
    'Result', 'Status', 'Verdicts',
]

M = TypeVar('M', bound=BaseModel)


def create_ai(
    jev: JevConfig | dict[str, Any] | None = None,
    llm: LlmConfig | dict[str, Any] | None = None,
    providers: Sequence[Provider] = (),
    retries: int = 2,
    retry_delay: float = 0.5,
) -> AI:
    """提供方按注册顺序尝试：jev、llm、再是 providers。每次请求只用支持它的提供方，
    所以分类、判断 Jev 优先；提取和要求原文引用时直接走语言模型。
    需要其他顺序时不传 jev/llm，直接传 providers=[rules, JevProvider(...), LlmProvider(...)]。"""
    jev_config = JevConfig(**jev) if isinstance(jev, dict) else jev
    llm_config = LlmConfig(**llm) if isinstance(llm, dict) else llm
    if type(retries) is not int or retries < 0 or not math.isfinite(retry_delay) or retry_delay < 0:
        raise ValueError('retries must be a non-negative integer; retry_delay must be finite and non-negative')
    if jev_config and not jev_config.api_key:
        raise ValueError('jev api_key is empty')
    if llm_config and not (llm_config.base_url and llm_config.api_key and llm_config.model):
        raise ValueError('llm needs base_url, api_key and model')
    registry: list[Provider] = []
    if jev_config:
        registry.append(JevProvider(jev_config))
    if llm_config:
        registry.append(LlmProvider(llm_config))
    registry += providers
    return AI(registry, Policy(retries, retry_delay))


def create_sync_ai(*args: Any, **kwargs: Any) -> SyncAI:
    """参数同 create_ai。每次调用内部执行 asyncio.run，不能在已运行的事件循环里使用（如 Jupyter，请用 create_ai）。"""
    return SyncAI(create_ai(*args, **kwargs))


class AI:
    def __init__(self, providers: list[Provider], policy: Policy):
        self.providers = providers
        self.policy = policy

    async def classify(
        self,
        input: InputLike,
        categories: Sequence[CategoryLike],
        instruction: str | None = None,
        mode: Mode = 'single',
        require_evidence: bool = False,
    ) -> Result[ClassifyData]:
        issues = [*check_input(input), *check_categories(categories)]
        if mode not in ('single', 'multi'):
            issues.append(Issue('invalid_input', 'mode must be single or multi'))
        if issues:
            return failed(issues)
        request = Request('classify', input, require_evidence, instruction, categories=categories, mode=mode)
        return await run(request, self.providers, self.policy)

    async def extract(
        self,
        input: InputLike,
        schema: type[M],
        instruction: str | None = None,
        require_evidence: bool = False,
    ) -> Result[M]:
        """schema 是 pydantic 模型；未提及的字段要允许 None，例如 amount: float | None。"""
        issues = check_input(input)
        if not (isinstance(schema, type) and issubclass(schema, BaseModel)):
            issues.append(Issue('invalid_input', 'schema must be a pydantic BaseModel class'))
        if issues:
            return failed(issues)
        try:
            json_schema = schema.model_json_schema()
        except (ValueError, TypeError) as error:
            return failed([Issue('invalid_input', f'schema cannot be converted to JSON Schema: {error}')])
        request = Request('extract', input, require_evidence, instruction, schema=schema, json_schema=json_schema)
        return await run(request, self.providers, self.policy)

    @overload
    async def judge(self, input: InputLike, statement: str, *, require_evidence: bool = False) -> Result[JudgeData]: ...
    @overload
    async def judge(
        self, input: InputLike, *, statements: dict[str, str], require_evidence: bool = False,
    ) -> Result[JudgeManyData]: ...

    async def judge(
        self,
        input: InputLike,
        statement: str | None = None,
        *,
        statements: dict[str, str] | None = None,
        require_evidence: bool = False,
    ) -> Result[Any]:
        """传 statement 判断一句；传 statements 一次判断多句，资料只发送一次。"""
        many = statements is not None
        texts: dict[str, Any] = dict(statements) if isinstance(statements, dict) else {'statement': statement}
        issues = check_input(input)
        if (statement is None) == (statements is None):
            issues.append(Issue('invalid_input', 'pass exactly one of statement or statements'))
        elif many and (not isinstance(statements, dict) or not statements):
            issues.append(Issue('invalid_input', 'statements must be a non-empty dict'))
        elif any(not isinstance(key, str) or not key.strip() or not isinstance(s, str) or not s.strip() for key, s in texts.items()):
            issues.append(Issue('invalid_input', 'every statement must be non-empty text'))
        if issues:
            return failed(issues)
        result = await run(Request('judge', input, require_evidence, statements=texts), self.providers, self.policy)
        if result.data is not None:
            result.data = JudgeManyData(result.data) if many else JudgeData(result.data.get('statement'))
        return result


class SyncAI:
    """AI 的同步版本，方法和参数相同。"""

    def __init__(self, ai: AI):
        self.ai = ai

    def classify(
        self,
        input: InputLike,
        categories: Sequence[CategoryLike],
        instruction: str | None = None,
        mode: Mode = 'single',
        require_evidence: bool = False,
    ) -> Result[ClassifyData]:
        return asyncio.run(self.ai.classify(input, categories, instruction, mode, require_evidence))

    def extract(
        self, input: InputLike, schema: type[M], instruction: str | None = None, require_evidence: bool = False,
    ) -> Result[M]:
        return asyncio.run(self.ai.extract(input, schema, instruction, require_evidence))

    @overload
    def judge(self, input: InputLike, statement: str, *, require_evidence: bool = False) -> Result[JudgeData]: ...
    @overload
    def judge(
        self, input: InputLike, *, statements: dict[str, str], require_evidence: bool = False,
    ) -> Result[JudgeManyData]: ...

    def judge(
        self,
        input: InputLike,
        statement: str | None = None,
        *,
        statements: dict[str, str] | None = None,
        require_evidence: bool = False,
    ) -> Result[Any]:
        return asyncio.run(
            self.ai.judge(input, statement, statements=statements, require_evidence=require_evidence),  # type: ignore[call-overload]
        )
