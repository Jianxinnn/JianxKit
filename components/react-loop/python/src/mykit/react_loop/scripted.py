"""Adapted from BioMolHarness baseline/agent/llm.py (SequenceAgentModel)."""

from __future__ import annotations

import copy
from typing import Any

from .types import ModelResponse


class ScriptedModel:
    """按顺序返回预设回复，用完后返回 "done"。用于测试和不调用模型的演练。"""

    def __init__(self, responses: list[ModelResponse]) -> None:
        self._responses = list(responses)
        self.requests: list[dict[str, Any]] = []

    def complete(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]) -> ModelResponse:
        # 循环会继续往同一个 messages 里追加，所以存副本
        self.requests.append({"messages": copy.deepcopy(messages), "tools": tools})
        if self._responses:
            return self._responses.pop(0)
        return ModelResponse("done", [])
