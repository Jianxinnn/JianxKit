"""Adapted from BioMolHarness baseline/agent/registry.py."""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

from .types import AgentTool, ToolCallEntry


class ToolRegistry:
    def __init__(self, tools: list[AgentTool]) -> None:
        self._tools: dict[str, AgentTool] = {}
        for tool in tools:
            if tool.name in self._tools:
                raise ValueError(f"duplicate tool name: {tool.name}")
            self._tools[tool.name] = tool

    @property
    def names(self) -> list[str]:
        return sorted(self._tools)

    def schemas(self) -> list[dict[str, Any]]:
        return [self._tools[name].openai_schema() for name in self.names]

    def write_contracts(self, path: Path, metadata: dict[str, Any] | None = None) -> None:
        payload = {"tool_count": len(self._tools), "tools": self.schemas()}
        if metadata:
            payload["metadata"] = metadata
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    def execute(self, *, index: int, name: str, args: Any) -> ToolCallEntry:
        started = time.monotonic()

        def entry(*, success: bool, observation: dict[str, Any], error: str | None, args: dict[str, Any]) -> ToolCallEntry:
            return ToolCallEntry(index, name, args, success, observation, time.monotonic() - started, error)

        if name not in self._tools:
            args = args if isinstance(args, dict) else {"value": args}
            return entry(success=False, observation={"error": f"unknown_tool:{name}", "available_tools": self.names}, error=f"unknown_tool:{name}", args=args)
        if not isinstance(args, dict):
            return entry(success=False, observation={"error": "tool_args_must_be_object"}, error="tool_args_must_be_object", args={"value": args})
        validation_error = validate_json_schema(args, self._tools[name].input_schema)
        if validation_error:
            return entry(success=False, observation={"error": "bad_tool_args", "details": validation_error}, error="bad_tool_args", args=args)
        try:
            observation = self._tools[name].handler(args)
        except Exception as exc:  # 工具内部报错不终止循环，交给模型决定下一步
            return entry(success=False, observation={"error": type(exc).__name__, "message": str(exc)}, error=f"{type(exc).__name__}: {exc}", args=args)
        if not isinstance(observation, dict):
            observation = {"result": observation}
        hard_error = str(observation.get("status") or "") == "failed"
        error = str(observation.get("reason") or "tool_failed") if hard_error else None
        return entry(success=not hard_error, observation=observation, error=error, args=args)


def validate_json_schema(value: dict[str, Any], schema: dict[str, Any]) -> str | None:
    """只检查顶层：required、additionalProperties=false 和基本 type。"""
    if schema.get("type") != "object":
        return "only object schemas are supported"
    properties = dict(schema.get("properties") or {})
    required = [str(item) for item in schema.get("required") or []]
    missing = [key for key in required if key not in value]
    if missing:
        return f"missing required keys: {missing}"
    if schema.get("additionalProperties") is False:
        extra = sorted(key for key in value if key not in properties)
        if extra:
            return f"unexpected keys: {extra}"
    for key, item in value.items():
        if key not in properties:
            continue
        expected = properties[key].get("type")
        if expected and not _matches_type(item, str(expected)):
            return f"{key} must be {expected}"
    return None


def _matches_type(value: Any, expected: str) -> bool:
    if expected == "boolean":
        return isinstance(value, bool)
    if expected == "string":
        return isinstance(value, str)
    if expected == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if expected == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if expected == "array":
        return isinstance(value, list)
    if expected == "object":
        return isinstance(value, dict)
    return True
