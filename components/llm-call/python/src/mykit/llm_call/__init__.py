"""一次 OpenAI 兼容的 chat completions 调用，可带工具，只用标准库。

    from mykit.llm_call import call_llm
    text = call_llm("用一句话介绍泛素", system="简洁回答")

需要工具调用或完整消息时用 OpenAICompatChatModel(config).complete(messages, tools)。
"""

from .client import (
    DEFAULT_BASE_URL,
    ModelResponse,
    OpenAICompatChatModel,
    OpenAICompatConfig,
    ToolRequest,
    call_llm,
)

__all__ = ["DEFAULT_BASE_URL", "ModelResponse", "OpenAICompatChatModel", "OpenAICompatConfig", "ToolRequest", "call_llm"]
