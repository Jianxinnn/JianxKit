# 组件目录

由 `mykit catalog` 根据各组件的 component.toml 生成，不要手改。更好看的版本：`mykit docs`。

| 组件 | 类别 | 状态 | 版本 | 语言 | 说明 | 来源 |
| --- | --- | --- | --- | --- | --- | --- |
| [molstar-viewer](components/molstar-viewer/README.md) | 界面 | stable | 0.1.0 | TS | 隔离 iframe 里的 Mol* 结构阅读器，带类型化的宿主通信接口和 Agent 场景协议 | Evo-Platform |
| [jev](components/jev/README.md) | AI / Agent | experimental | 0.1.0 | Python · TS | 分类、提取、判断三个接口：Jev 优先，OpenAI 兼容模型补充提取、原文引用和降级 | jev-base |
| [llm-call](components/llm-call/README.md) | AI / Agent | experimental | 0.1.0 | Python | 一次 OpenAI 兼容的 chat completions 调用，可带工具，带重试，只用标准库 | BioMolHarness |
| [react-loop](components/react-loop/README.md) | AI / Agent | experimental | 0.1.0 | Python | 最小 ReAct 循环：工具注册与参数校验、调用记录、JSONL 轨迹，模型可替换 | BioMolHarness |
| [reflection](components/reflection/README.md) | AI / Agent | experimental | 0.1.0 | Python | 基本 reflection：验证失败后由 critic 总结原因和下一步，附在任务后重试 | learn-claude-code/Agent-demo |
| [diffusion](components/diffusion/README.md) | 模型 | experimental | 0.1.0 | Python | AF3 / EDM 风格坐标扩散：噪声日程、EDM 预条件和损失权重、随机增强、Euler 采样器，网络可替换 | Protenix |
