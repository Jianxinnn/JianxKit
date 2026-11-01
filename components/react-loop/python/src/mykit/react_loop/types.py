"""Adapted from BioMolHarness baseline/agent/models.py and tools/base.py (AgentTool)."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Callable, Protocol, Sequence


@dataclass(frozen=True, slots=True)
class ToolRequest:
    name: str
    args: dict[str, Any]
    call_id: str = ""


@dataclass(frozen=True, slots=True)
class ModelResponse:
    content: str
    tool_calls: list[ToolRequest]


class ToolCallLike(Protocol):
    name: str
    args: Any
    call_id: str


class ResponseLike(Protocol):
    content: str
    tool_calls: Sequence[ToolCallLike]


class AgentModel(Protocol):
    """mykit.llm_call.OpenAICompatChatModel 符合这个接口；返回值只要有同名字段即可。"""

    def complete(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]) -> ResponseLike:
        ...


@dataclass(frozen=True, slots=True)
class ToolCallEntry:
    index: int
    tool: str
    args: dict[str, Any]
    success: bool
    observation: dict[str, Any]
    duration_seconds: float
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True, slots=True)
class AgentTool:
    name: str
    description: str
    input_schema: dict[str, Any]
    handler: Callable[[dict[str, Any]], Any]
    output_contract: str = ""  # 追加到 description，告诉模型返回值怎么读
    category: str = "uncategorized"

    def openai_schema(self) -> dict[str, Any]:
        description = self.description
        if self.output_contract:
            description = f"{description}\nOutput contract: {self.output_contract}"
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": description,
                "parameters": self.input_schema,
            },
        }
