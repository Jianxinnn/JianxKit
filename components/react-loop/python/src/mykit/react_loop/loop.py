"""Adapted from BioMolHarness baseline/agent/loop.py."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Callable

from .registry import ToolRegistry
from .trace import NullTrace, Trace
from .types import AgentModel, ToolCallEntry


@dataclass(frozen=True, slots=True)
class LoopResult:
    final_answer: str
    status: str  # complete / max_turns / tool_error
    tool_call_log: list[ToolCallEntry]
    messages: list[dict[str, Any]]


def run_react_loop(
    *,
    model: AgentModel,
    registry: ToolRegistry,
    system_prompt: str,
    user_prompt: str,
    max_turns: int = 20,
    trace: Trace | None = None,
    compact_observation: Callable[[dict[str, Any]], Any] | None = None,
) -> LoopResult:
    """模型不再调用工具时结束。完整观察记在 tool_call_log 和 trace 里，
    发回给模型的是 compact_observation(observation)，默认用 compact_value 截断。"""
    trace = trace or NullTrace()
    compact = compact_observation or compact_value
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]
    tool_log: list[ToolCallEntry] = []
    final_answer = ""
    status = "max_turns"
    trace.write("agent_start", {"max_turns": max_turns, "tools": registry.names})
    for turn in range(1, max_turns + 1):
        trace.write("model_request", {"turn": turn, "message_count": len(messages)})
        response = model.complete(messages, registry.schemas())
        trace.write(
            "model_response",
            {
                "turn": turn,
                "content": response.content,
                "tool_calls": [{"name": call.name, "args": call.args, "call_id": call.call_id} for call in response.tool_calls],
            },
        )
        if not response.tool_calls:
            final_answer = response.content.strip() or "Agent completed."
            messages.append({"role": "assistant", "content": final_answer})
            status = "complete"
            break
        messages.append(
            {
                "role": "assistant",
                "content": response.content or "",
                "tool_calls": [
                    {
                        "id": call.call_id or f"call_{turn}_{offset}",
                        "type": "function",
                        "function": {"name": call.name, "arguments": json.dumps(call.args, sort_keys=True)},
                    }
                    for offset, call in enumerate(response.tool_calls, start=1)
                ],
            }
        )
        for offset, call in enumerate(response.tool_calls, start=1):
            call_id = call.call_id or f"call_{turn}_{offset}"
            entry = registry.execute(index=len(tool_log) + 1, name=call.name, args=call.args)
            tool_log.append(entry)
            trace.write("tool_observation", {"turn": turn, "tool_call_id": call_id, "entry": entry.to_dict()})
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "name": call.name,
                    "content": json.dumps(compact(entry.observation), sort_keys=True, default=str),
                }
            )
    if not final_answer:
        final_answer = f"Stopped after max_turns={max_turns} before final answer."
    if any(not entry.success and entry.error for entry in tool_log):
        status = "tool_error"
    trace.write("agent_stop", {"status": status, "tool_call_count": len(tool_log), "final_answer": final_answer})
    return LoopResult(final_answer=final_answer, status=status, tool_call_log=tool_log, messages=messages)


def compact_value(value: Any, *, depth: int = 0) -> Any:
    """把任意 JSON 值截到有限大小：三层以下的字典只留键名，长列表只留前 3 项，长字符串掐头去尾。"""
    if isinstance(value, dict):
        if depth >= 3:
            return {"keys": sorted(str(key) for key in value.keys())[:20], "omitted_nested": True}
        return {str(key): compact_value(item, depth=depth + 1) for key, item in list(value.items())[:40]}
    if isinstance(value, list):
        if len(value) <= 5:
            return [compact_value(item, depth=depth + 1) for item in value]
        return {
            "count": len(value),
            "sample": [compact_value(item, depth=depth + 1) for item in value[:3]],
            "omitted": len(value) - 3,
        }
    if isinstance(value, str):
        return value if len(value) <= 500 else value[:240] + "...<truncated>..." + value[-200:]
    return value
