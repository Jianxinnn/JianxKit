# jev · Python

需要 Python 3.10+。在使用方项目根目录运行 `mykit add jev`。导入名是 `mykit.jev`。

同步使用 `create_sync_ai`；已有事件循环时使用 `create_ai` 并 `await` 各方法。提取 schema 使用 Pydantic 模型，结果数据为对应模型实例。

接口用法、配置和处理规则见[主文档](../README.md)，可运行示例见 [classify_tool.py](examples/classify_tool.py)。
