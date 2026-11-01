"""最小 ReAct 循环：模型提出工具调用 → 校验参数并执行 → 把结果发回模型，直到模型给出最终回答。

    from mykit.react_loop import AgentTool, ToolRegistry, run_react_loop
    result = run_react_loop(model=model, registry=ToolRegistry(tools), system_prompt=..., user_prompt=...)

model 只要有 complete(messages, tools)，返回带 content 和 tool_calls 的对象，
例如 mykit.llm_call.OpenAICompatChatModel；测试用 ScriptedModel。
"""

from .loop import LoopResult, compact_value, run_react_loop
from .registry import ToolRegistry, validate_json_schema
from .scripted import ScriptedModel
from .trace import JsonlTraceWriter, NullTrace, Trace
from .types import AgentModel, AgentTool, ModelResponse, ToolCallEntry, ToolRequest

__all__ = [
    "AgentModel", "AgentTool", "JsonlTraceWriter", "LoopResult", "ModelResponse", "NullTrace", "ScriptedModel",
    "ToolCallEntry", "ToolRegistry", "ToolRequest", "Trace", "compact_value", "run_react_loop", "validate_json_schema",
]
