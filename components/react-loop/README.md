# react-loop

最小 ReAct 循环：模型提出工具调用 → 校验参数并执行 → 把结果发回模型，直到模型不再调用工具。只用 Python 标准库。

复刻自 BioMolHarness 的 `baseline/agent/`（loop、registry、trace、AgentTool），来源记录见 [component.toml](component.toml)。

## 用法

```python
from mykit.llm_call import OpenAICompatChatModel, OpenAICompatConfig
from mykit.react_loop import AgentTool, JsonlTraceWriter, ToolRegistry, run_react_loop

lookup = AgentTool(
    name="lookup_pdb",
    description="Return the title of a PDB entry.",
    input_schema={"type": "object", "properties": {"pdb_id": {"type": "string"}}, "required": ["pdb_id"]},
    handler=lambda args: {"status": "ok", "title": titles[args["pdb_id"]]},
)

with JsonlTraceWriter("runs/trace.jsonl") as trace:  # trace 可省略
    result = run_react_loop(
        model=OpenAICompatChatModel(OpenAICompatConfig.from_env()),
        registry=ToolRegistry([lookup]),
        system_prompt="You are a structural biology assistant.",
        user_prompt="What is 1UBQ?",
        max_turns=10,
        trace=trace,
    )

result.status          # complete / max_turns / tool_error
result.final_answer
result.tool_call_log   # 每次工具调用的参数、观察、耗时、错误
```

- 模型只要有 `complete(messages, tools)`，返回带 `content` 和 `tool_calls`（每项有 `name`、`args`、`call_id`）的对象。[llm-call](../llm-call/README.md) 符合这个接口；两个组件互不依赖。
- 工具返回字典；`{"status": "failed", "reason": ...}` 记为失败。未知工具、参数不合法、工具抛异常都会作为观察发回模型，循环继续。
- 只要有一次工具失败，`status` 就是 `tool_error`，`final_answer` 仍保留模型的回答。
- 发回模型的观察默认用 `compact_value` 截断（完整内容在 `tool_call_log` 和轨迹里）；传 `compact_observation=` 可换成自己的压缩。
- 参数校验只查顶层的 `required`、`additionalProperties: false` 和基本类型。
- 测试和演练用 `ScriptedModel([ModelResponse(...), ...])`，按顺序返回预设回复。

## 和原代码的差异

- 去掉 BDB 专用的 `ToolContext`、各领域工具和 `compact_observation_for_model`（按 backbones / sequences 等键压缩）。
- `trace` 可省略，`max_turns` 默认 20；`AgentTool.output_contract` 默认为空。
- 重名工具直接报错（原来后者覆盖前者）；工具返回非字典时包成 `{"result": ...}`。
