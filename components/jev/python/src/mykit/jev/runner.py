"""固定流程：按顺序调用提供方 → 统一校验 → 必要时调用备用提供方 → 返回结果。

- 调用报错（重试后仍失败）或结果校验不通过：换下一个提供方。
- 结果 needs_review：记下作为候选，再问下一个提供方。
  下一个给出 ok 且与候选一致，返回 ok；不一致，返回 needs_review 并说明冲突。
- 全部失败：failed。
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, replace
from typing import Any, Awaitable, Callable, Sequence, TypeVar

from pydantic import BaseModel

from .providers.http import ProviderError
from .types import ClassifyData, Issue, Meta, Provider, Request, Result, Status
from .validation import Settled, settle

T = TypeVar('T')


@dataclass
class Policy:
    retries: int = 2
    retry_delay: float = 0.5  # 秒，之后指数增长


@dataclass
class _Outcome:
    provider: Provider
    index: int
    model: str
    settled: Settled
    raw: Any


async def run(request: Request, providers: Sequence[Provider], policy: Policy) -> Result[Any]:
    route = [p for p in providers if p.supports(request)]
    if not route:
        return failed([Issue('no_provider', f'no provider can handle this {request.operation} request')])
    notes: list[Issue] = []
    candidates: list[_Outcome] = []
    for index, provider in enumerate(route):
        try:
            result = await _with_retry(lambda: provider.run(request), policy)
            outcome = _Outcome(provider, index, result.model, settle(request, result), result.raw)
        except Exception as error:  # 任何提供方故障都改用下一个
            notes.append(Issue('provider_error', str(error), provider.name))
            continue
        settled = outcome.settled
        disagreement = next((previous for previous in candidates if settled.status != 'failed'
                             and _conflicts(request, previous.settled.data, settled.data)), None)
        if disagreement:
            notes.append(Issue('conflict', f'{disagreement.provider.name} and {provider.name} disagree'))
        if settled.status == 'ok':
            return _build(outcome, 'needs_review' if any(i.code == 'conflict' for i in notes) else 'ok', notes)
        notes += [replace(issue, provider=provider.name) for issue in settled.issues]
        if settled.status == 'needs_review':
            candidates.append(outcome)
    if candidates:
        return _build(candidates[0], 'needs_review', notes)
    return failed(notes, route[-1].name, len(route) > 1)


async def _with_retry(fn: Callable[[], Awaitable[T]], policy: Policy) -> T:
    attempt = 0
    while True:
        try:
            return await fn()
        except ProviderError as error:
            if not error.transient or attempt >= policy.retries:
                raise
            # 服务端要求长时间等待时直接降级，不提前重试，也不阻塞当前调用。
            if error.retry_after is not None and error.retry_after > 30:
                raise
            delay = error.retry_after if error.retry_after is not None else policy.retry_delay * 2**attempt
            await asyncio.sleep(min(delay, 30))
            attempt += 1


# 只有已明确的结论才参与比较；“无法确定”不算冲突
def _conflicts(request: Request, a: Any, b: Any) -> bool:
    if isinstance(a, ClassifyData) and isinstance(b, ClassifyData):
        return (not b.undetermined and bool(set(a.categories) - set(b.categories))) or (
            not a.undetermined and bool(set(b.categories) - set(a.categories))
        )
    return _differs(a.model_dump(mode='json', by_alias=True) if isinstance(a, BaseModel) else a,
                    b.model_dump(mode='json', by_alias=True) if isinstance(b, BaseModel) else b)


def _differs(a: Any, b: Any) -> bool:
    if a is None or b is None:
        return False
    if isinstance(a, list) and isinstance(b, list):
        return len(a) != len(b) or any(_differs(x, y) for x, y in zip(a, b))
    if isinstance(a, dict) and isinstance(b, dict):
        return any(_differs(a[key], b[key]) for key in a.keys() & b.keys())
    return a != b


def _build(outcome: _Outcome, status: Status, issues: list[Issue]) -> Result[Any]:
    s = outcome.settled
    meta = Meta(outcome.provider.name, outcome.model, outcome.index > 0, outcome.raw)
    return Result(status, s.data, s.evidence, issues, meta)


def failed(issues: list[Issue], provider: str = '', fallback_used: bool = False) -> Result[Any]:
    return Result('failed', None, [], issues, Meta(provider, '', fallback_used))
