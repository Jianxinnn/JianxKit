# 更新记录

## 0.1.0 · 2026-11-01

- 从 BioMolHarness `baseline/agent/llm.py`、`models.py` 复刻 `OpenAICompatChatModel`、`ToolRequest`、`ModelResponse`。
- 配置改为 `from_env()` 和显式字段；新增 `call_llm()`；空工具列表不再发送。
- 新增本机假服务器测试。
