"""用本机假服务器测试请求格式、工具调用解析和重试，不访问网络。"""

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from mykit.llm_call import ModelResponse, OpenAICompatChatModel, OpenAICompatConfig, ToolRequest, call_llm


@pytest.fixture(autouse=True)
def no_proxy(monkeypatch):
    monkeypatch.setenv("no_proxy", "*")
    monkeypatch.setenv("NO_PROXY", "*")


@pytest.fixture
def server():
    """按顺序返回 responses 里的 (status, body)，并记录收到的请求体。"""
    state = {"responses": [], "requests": []}

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            length = int(self.headers["Content-Length"])
            state["requests"].append({"path": self.path, "auth": self.headers["Authorization"], "body": json.loads(self.rfile.read(length))})
            status, body = state["responses"].pop(0)
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *args):
            pass

    httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    state["config"] = OpenAICompatConfig(
        model="test-model", api_key="sk-test", base_url=f"http://127.0.0.1:{httpd.server_port}/v1", retry_base_seconds=0
    )
    yield state
    httpd.shutdown()
    httpd.server_close()


def reply(content="", tool_calls=None):
    message = {"role": "assistant", "content": content}
    if tool_calls:
        message["tool_calls"] = tool_calls
    return 200, {"choices": [{"message": message}]}


def test_call_llm_sends_system_and_user_without_tools(server):
    server["responses"].append(reply("你好"))
    assert call_llm("hi", system="be brief", config=server["config"], temperature=0) == "你好"
    request = server["requests"][0]
    assert request["path"] == "/v1/chat/completions"
    assert request["auth"] == "Bearer sk-test"
    assert request["body"]["messages"] == [{"role": "system", "content": "be brief"}, {"role": "user", "content": "hi"}]
    assert request["body"]["temperature"] == 0
    assert "tools" not in request["body"] and "tool_choice" not in request["body"]


def test_complete_parses_tool_calls(server):
    server["responses"].append(reply(tool_calls=[
        {"id": "c1", "type": "function", "function": {"name": "lookup", "arguments": '{"q": "1UBQ"}'}},
        {"id": "c2", "type": "function", "function": {"name": "broken", "arguments": "{not json"}},
    ]))
    tools = [{"type": "function", "function": {"name": "lookup", "parameters": {"type": "object"}}}]
    response = OpenAICompatChatModel(server["config"]).complete([{"role": "user", "content": "x"}], tools)
    assert response == ModelResponse("", [
        ToolRequest("lookup", {"q": "1UBQ"}, "c1"),
        ToolRequest("broken", {"__invalid_json_arguments__": "{not json"}, "c2"),
    ])
    assert server["requests"][0]["body"]["tool_choice"] == "auto"


def test_retries_transient_status_then_succeeds(server):
    server["responses"] += [(503, {"error": "busy"}), reply("ok")]
    assert call_llm("x", config=server["config"]) == "ok"
    assert len(server["requests"]) == 2


def test_non_retryable_status_raises_at_once(server):
    server["responses"].append((400, {"error": "bad request"}))
    with pytest.raises(RuntimeError, match="HTTP 400"):
        call_llm("x", config=server["config"])
    assert len(server["requests"]) == 1


def test_gives_up_after_max_attempts(server):
    server["responses"] += [(503, {"error": "busy"})] * 2
    config = OpenAICompatConfig(**{**_fields(server["config"]), "max_attempts": 2})
    with pytest.raises(RuntimeError, match="HTTP 503"):
        call_llm("x", config=config)
    assert len(server["requests"]) == 2


def test_from_env_reads_environment_and_overrides(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-env")
    monkeypatch.setenv("OPENAI_MODEL", "env-model")
    monkeypatch.delenv("OPENAI_BASE_URL", raising=False)
    config = OpenAICompatConfig.from_env(model="override")
    assert (config.api_key, config.model, config.base_url) == ("sk-env", "override", "https://api.openai.com/v1")


def test_from_env_requires_key(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    with pytest.raises(ValueError, match="api_key"):
        OpenAICompatConfig.from_env(model="m")


def _fields(config):
    return {name: getattr(config, name) for name in config.__dataclass_fields__}
