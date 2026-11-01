# llm-call

一次 OpenAI 兼容的 chat completions 调用，可带工具，只用 Python 标准库。可以单独用，也可以直接作为 [react-loop](../react-loop/README.md) 的模型。

复刻自 BioMolHarness 的 `baseline/agent/llm.py` 和 `models.py`，来源记录见 [component.toml](component.toml)。

## 用法

```python
from mykit.llm_call import OpenAICompatChatModel, OpenAICompatConfig, call_llm

# 读 OPENAI_API_KEY / OPENAI_MODEL / OPENAI_BASE_URL；也可以全部用参数传
config = OpenAICompatConfig.from_env(model="gpt-4o-mini")

# 只要文本
text = call_llm("用一句话介绍泛素", system="简洁回答", config=config, temperature=0)

# 完整消息和工具
model = OpenAICompatChatModel(config)
response = model.complete(messages, tools)  # tools 是 OpenAI function 格式
response.content       # 文本
response.tool_calls    # [ToolRequest(name, args, call_id), ...]
```

- 429、5xx 和网络错误按指数退避重试（默认 5 次，单次最多等 60 秒）；其他 HTTP 错误直接抛 `RuntimeError`。
- 工具参数不是合法 JSON 时，`args` 为 `{"__invalid_json_arguments__": 原文}`，由调用方决定怎么处理。
- 代理、关闭 SSL 校验、重试次数、超时都是 `OpenAICompatConfig` 的字段。

## 和原代码的差异

- 配置从环境变量或参数读取，不再读 `.claw.toml`。
- 原来靠 `BDB_AGENT_*` 环境变量控制的代理、SSL、重试次数，改成配置字段。
- `tools` 为空时请求里不带 `tools` / `tool_choice`（有的兼容服务会拒绝空列表）。
- 新增 `call_llm()`，以及 `complete()` 的额外请求参数（如 `temperature`）。
- 没有复刻 BDB 专用的 `ScriptedBDBAgentModel` 和 `build_model()`；测试用的脚本模型在 react-loop 里。
