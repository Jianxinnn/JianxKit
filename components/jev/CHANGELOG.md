# 更新记录

## 0.1.0 · 2026-11-01

- 从 EnzymeGroup/jev-base c9a19fd 复刻（只取 git 跟踪的文件，`.env` 没有带过来）。
- 包名改为 `mykit-jev` / `@mykit/jev`，Python 导入名改为 `mykit.jev`；接口和行为不变。
- 示例读取的 `.env` 改到 `components/jev/.env`。
- 去掉各自的 lock 文件，改由 MyKit 根目录的工作区统一锁定。
- 新增离线测试（Python 用 httpx.MockTransport，TypeScript 用假的 fetch）。
