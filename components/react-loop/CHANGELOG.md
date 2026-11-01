# 更新记录

## 0.1.0 · 2026-11-01

- 从 BioMolHarness `baseline/agent/` 复刻 ReAct 循环、工具注册表、JSONL 轨迹和 `AgentTool`。
- 去掉 BDB 专用部分（`ToolContext`、BDB 观察压缩）；观察压缩改为通用的 `compact_value`，可替换。
- `trace`、`max_turns` 有默认值；重名工具直接报错；工具抛异常或返回非字典时不终止循环。
