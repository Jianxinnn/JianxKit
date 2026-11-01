# 更新记录

## 0.1.0 · 2026-11-01

- 从 Evo-Platform `packages/protein-viewer` 复刻，包含该目录当天未提交的修改。
- 包名改为 `@mykit/molstar-viewer`；iframe 消息通道名保持 `evo-protein`，与 Evo 宿主兼容。
- 把 `molstar@5.11.0` 写进 peerDependencies（原包只在 README 里说明）。
- 浏览器测试从 Evo 的 `standalone.test.cjs` 迁来，改为 ESM，结构文件放进 `test/fixtures/`。
- 新增导出测试（不需要浏览器）和 `npm run demo`。
- 示例页支持 `?structure=1UBQ.pdb` 自动打开同目录的结构文件；新增 `npm run demo:build`，供文档站嵌入在线示例。
