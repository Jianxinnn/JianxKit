"""Adapted from BioMolHarness baseline/agent/llm.py (OpenAICompatChatModel) and models.py (ToolRequest, ModelResponse)."""

from __future__ import annotations

import http.client
import json
import os
import socket
import ssl
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any

DEFAULT_BASE_URL = "https://api.openai.com/v1"
RETRY_STATUSES = frozenset({429, 500, 502, 503, 504})


@dataclass(frozen=True, slots=True)
class ToolRequest:
    name: str
    args: dict[str, Any]
    call_id: str = ""


@dataclass(frozen=True, slots=True)
class ModelResponse:
    content: str
    tool_calls: list[ToolRequest]


@dataclass(frozen=True, slots=True)
class OpenAICompatConfig:
    model: str
    api_key: str
    base_url: str = DEFAULT_BASE_URL
    timeout_seconds: int = 600
    max_attempts: int = 5
    proxy: str = ""  # 例如 http://127.0.0.1:7890；空则沿用系统 / 环境变量代理
    verify_ssl: bool = True
    retry_base_seconds: float = 2.0  # 第 n 次重试前等待 base * 2^(n-1) 秒，最多 60 秒

    @classmethod
    def from_env(cls, **overrides: Any) -> "OpenAICompatConfig":
        """读 OPENAI_API_KEY / OPENAI_MODEL / OPENAI_BASE_URL；关键字参数优先。"""
        values = {
            "api_key": os.environ.get("OPENAI_API_KEY", ""),
            "model": os.environ.get("OPENAI_MODEL", ""),
            "base_url": os.environ.get("OPENAI_BASE_URL") or DEFAULT_BASE_URL,
            **overrides,
        }
        if not values["api_key"]:
            raise ValueError("missing api_key: pass api_key= or set OPENAI_API_KEY")
        if not values["model"]:
            raise ValueError("missing model: pass model= or set OPENAI_MODEL")
        return cls(**values)


class OpenAICompatChatModel:
    def __init__(self, config: OpenAICompatConfig) -> None:
        self.config = config

    def complete(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        **params: Any,
    ) -> ModelResponse:
        """params 原样放进请求体，例如 temperature=0、max_tokens=512。"""
        body: dict[str, Any] = {"model": self.config.model, "messages": messages, **params}
        if tools:
            body["tools"] = tools
            body.setdefault("tool_choice", "auto")
        request = urllib.request.Request(
            self.config.base_url.rstrip("/") + "/chat/completions",
            data=json.dumps(body).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {self.config.api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        payload = self._open_with_retries(request)
        message = dict(payload["choices"][0]["message"])
        calls: list[ToolRequest] = []
        for item in message.get("tool_calls") or []:
            function = dict(item.get("function") or {})
            calls.append(
                ToolRequest(
                    name=str(function.get("name") or ""),
                    args=_parse_args(function.get("arguments")),
                    call_id=str(item.get("id") or ""),
                )
            )
        if message.get("function_call"):
            function = dict(message["function_call"])
            calls.append(ToolRequest(str(function.get("name") or ""), _parse_args(function.get("arguments")), "legacy_call"))
        return ModelResponse(content=str(message.get("content") or ""), tool_calls=calls)

    def _open_with_retries(self, request: urllib.request.Request) -> dict[str, Any]:
        config = self.config
        context = None if config.verify_ssl else ssl._create_unverified_context()
        handlers: list[urllib.request.BaseHandler] = [urllib.request.HTTPSHandler(context=context)]
        if config.proxy:
            handlers.insert(0, urllib.request.ProxyHandler({"http": config.proxy, "https": config.proxy}))
        opener = urllib.request.build_opener(*handlers)
        last_error: BaseException | None = None
        for attempt in range(1, config.max_attempts + 1):
            try:
                with opener.open(request, timeout=config.timeout_seconds) as response:
                    return json.loads(response.read().decode("utf-8"))
            except urllib.error.HTTPError as exc:
                detail = exc.read().decode("utf-8", errors="ignore")
                if exc.code not in RETRY_STATUSES or attempt == config.max_attempts:
                    raise RuntimeError(f"OpenAI-compatible chat completion failed: HTTP {exc.code}: {detail}") from exc
                last_error = RuntimeError(f"HTTP {exc.code}: {detail}")
            except (http.client.RemoteDisconnected, urllib.error.URLError, TimeoutError, socket.timeout, ConnectionResetError) as exc:
                if attempt == config.max_attempts:
                    raise RuntimeError(
                        f"OpenAI-compatible chat completion failed after {config.max_attempts} attempts: {exc}"
                    ) from exc
                last_error = exc
            time.sleep(min(60.0, config.retry_base_seconds * 2 ** (attempt - 1)))
        raise RuntimeError(f"OpenAI-compatible chat completion failed: {last_error}")


def call_llm(
    prompt: str,
    *,
    system: str | None = None,
    config: OpenAICompatConfig | None = None,
    **params: Any,
) -> str:
    """一次调用，返回文本。config 为空时用 OpenAICompatConfig.from_env()。"""
    messages: list[dict[str, Any]] = [{"role": "system", "content": system}] if system else []
    messages.append({"role": "user", "content": prompt})
    model = OpenAICompatChatModel(config or OpenAICompatConfig.from_env())
    return model.complete(messages, **params).content


def _parse_args(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if value in (None, ""):
        return {}
    try:
        parsed = json.loads(str(value))
    except json.JSONDecodeError:
        return {"__invalid_json_arguments__": str(value)}
    return parsed if isinstance(parsed, dict) else {"value": parsed}
