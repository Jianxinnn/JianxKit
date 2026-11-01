from __future__ import annotations

from typing import Any
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import math

import httpx


class ProviderError(Exception):
    """transient=True 表示暂时性故障（超时、限流、过载），runner 只对它做有限重试。
    其他错误直接交给下一个提供方。"""

    def __init__(self, message: str, transient: bool, retry_after: float | None = None):
        super().__init__(message)
        self.transient = transient
        self.retry_after = retry_after  # 秒


async def post_json(
    url: str,
    headers: dict[str, str],
    body: Any,
    timeout: float,
    transport: httpx.AsyncBaseTransport | None,
) -> Any:
    try:
        async with httpx.AsyncClient(transport=transport, timeout=timeout) as client:
            response = await client.post(url, headers=headers, json=body)
    except (httpx.TimeoutException, httpx.NetworkError, httpx.RemoteProtocolError) as error:
        raise ProviderError(f'request failed: {type(error).__name__}: {error}', transient=True) from error
    status = response.status_code
    if not 200 <= status < 300:
        transient = status in (408, 429) or status >= 500
        raise ProviderError(f'HTTP {status}: {response.text[:300]}', transient, _seconds(response.headers.get('retry-after')))
    try:
        return response.json()
    except ValueError as error:
        raise ProviderError(f'response is not JSON: {response.text[:200]}', transient=False) from error


def _seconds(value: str | None) -> float | None:
    if value is None:
        return None
    try:
        seconds = float(value)
    except ValueError:
        try:
            date = parsedate_to_datetime(value)
            seconds = (date - datetime.now(timezone.utc)).total_seconds()
        except (ValueError, TypeError, OverflowError):
            return None
    return max(0, seconds) if math.isfinite(seconds) else None
