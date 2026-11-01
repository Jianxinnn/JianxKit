import json

import pytest

from mykit.react_loop import (
    AgentTool,
    JsonlTraceWriter,
    ModelResponse,
    ScriptedModel,
    ToolRegistry,
    ToolRequest,
    compact_value,
    run_react_loop,
)

ADD = AgentTool(
    name="add",
    description="Add two integers.",
    input_schema={
        "type": "object",
        "properties": {"a": {"type": "integer"}, "b": {"type": "integer"}},
        "required": ["a", "b"],
        "additionalProperties": False,
    },
    handler=lambda args: {"status": "ok", "sum": args["a"] + args["b"]},
)


def run(responses, tools=(ADD,), **kwargs):
    model = ScriptedModel(responses)
    result = run_react_loop(model=model, registry=ToolRegistry(list(tools)), system_prompt="sys", user_prompt="what is 2+3?", **kwargs)
    return model, result


def test_tool_call_then_final_answer(tmp_path):
    with JsonlTraceWriter(tmp_path / "trace.jsonl") as trace:
        model, result = run(
            [ModelResponse("", [ToolRequest("add", {"a": 2, "b": 3}, "c1")]), ModelResponse(" 5 ", [])],
            trace=trace,
        )
    assert (result.status, result.final_answer) == ("complete", "5")
    assert result.tool_call_log[0].success and result.tool_call_log[0].observation["sum"] == 5
    # 第二次请求时，模型看到了自己的工具调用和工具结果
    second = model.requests[1]["messages"]
    assert second[2]["tool_calls"][0]["id"] == "c1"
    assert second[3]["role"] == "tool" and json.loads(second[3]["content"])["sum"] == 5
    assert model.requests[0]["tools"][0]["function"]["name"] == "add"
    events = [json.loads(line)["event_type"] for line in (tmp_path / "trace.jsonl").read_text().splitlines()]
    assert events == ["agent_start", "model_request", "model_response", "tool_observation", "model_request", "model_response", "agent_stop"]


def test_unknown_tool_and_bad_args_are_reported_to_the_model():
    model, result = run([
        ModelResponse("", [ToolRequest("nope", {}), ToolRequest("add", {"a": 1})]),
        ModelResponse("gave up", []),
    ])
    first, second = result.tool_call_log
    assert first.error == "unknown_tool:nope" and first.observation["available_tools"] == ["add"]
    assert second.error == "bad_tool_args" and "missing required keys" in second.observation["details"]
    assert result.status == "tool_error" and result.final_answer == "gave up"
    tool_messages = [m for m in model.requests[1]["messages"] if m["role"] == "tool"]
    assert [m["tool_call_id"] for m in tool_messages] == ["call_1_1", "call_1_2"]


def test_handler_exception_and_non_dict_result():
    boom = AgentTool("boom", "Raises.", {"type": "object"}, handler=lambda args: 1 / 0)
    plain = AgentTool("plain", "Returns a number.", {"type": "object"}, handler=lambda args: 42)
    _, result = run([ModelResponse("", [ToolRequest("boom", {}), ToolRequest("plain", {})]), ModelResponse("ok", [])], tools=(boom, plain))
    assert result.tool_call_log[0].error.startswith("ZeroDivisionError")
    assert result.tool_call_log[1].observation == {"result": 42}


def test_stops_at_max_turns():
    _, result = run([ModelResponse("", [ToolRequest("add", {"a": 1, "b": 1})])] * 5, max_turns=2)
    assert result.status == "max_turns"
    assert len(result.tool_call_log) == 2
    assert "max_turns=2" in result.final_answer


def test_duplicate_tool_names_are_rejected():
    with pytest.raises(ValueError, match="duplicate"):
        ToolRegistry([ADD, ADD])


def test_compact_value_bounds_size():
    assert compact_value({"a": {"b": {"c": {"d": 1}}}}) == {"a": {"b": {"c": {"keys": ["d"], "omitted_nested": True}}}}
    assert compact_value(list(range(10))) == {"count": 10, "sample": [0, 1, 2], "omitted": 7}
    text = compact_value("x" * 1000)
    assert len(text) < 500 and "<truncated>" in text
