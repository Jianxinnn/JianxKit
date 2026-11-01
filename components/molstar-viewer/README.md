# molstar-viewer

`@mykit/molstar-viewer`：独立的 Mol* 结构阅读内核和 TypeScript 通信接口。无需 React、Next.js、Chat、账号、MCP 或模型。当前适配并测试 Mol* **5.11.0**，由宿主提供本地依赖及结构文本。

复刻自 Evo-Platform 的 `packages/protein-viewer`（2026-11-01 的工作区版本），来源记录见 [component.toml](component.toml)。

**看效果：** 文档站的组件页里有在线示例；也可以运行 `mykit demo molstar-viewer`，在浏览器里打开终端打印的地址。

## 边界

| 本包负责 | 宿主负责 |
| --- | --- |
| PDB / mmCIF 解析、3D 渲染、旋转、缩放、PNG 导出 | 获取文件、来源标注、权限、持久化 |
| 按作者链号、残基号选择、聚焦、取消选择 | 序列 UI 和序列位置到作者残基号的可靠映射 |
| 卡通、棍状、表面；命名图层、选择、颜色/透明度、测量、镜头与主题 | 工具栏外观、应用主题读取、布局 |
| 隔离 iframe、操作队列、revision、逐步骤回执和 Promise 接口 | 聊天上下文、资产权限、浏览器工具桥接与轨迹持久化 |

本包只有内核和通信接口。Evo 里的 React 适配器（`ProteinViewer`）、Chat 适配器（`HarnessReferenceReader`）和面板 CSS 没有复刻过来；各项目用自己的工具栏和序列组件。

## 接入

本包把 `molstar@5.11.0` 声明为 peerDependency，`mykit add molstar-viewer` 会一起装上。构建时把所有静态资源导出到宿主指定目录：

```js
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { exportProteinViewer } from '@mykit/molstar-viewer/export-assets';
const require = createRequire(import.meta.url);
await exportProteinViewer('./public/molecules', dirname(require.resolve('molstar/package.json')));
```

所有资源使用相对路径，因此 `/molecules/`、更深的子路径及不同项目的部署前缀均可使用。保留导出的 `vendor/molstar/LICENSE`。

```html
<iframe id="protein" src="/molecules/protein-viewer.html" sandbox="allow-scripts"></iframe>
```

```ts
import { sendViewerCommand, subscribeViewer } from '@mykit/molstar-viewer';
const frame = document.querySelector<HTMLIFrameElement>('#protein')!;
const unsubscribe = subscribeViewer(frame, event => {
  if (event.type === 'pick') {
    // 宿主决定是否选择，并同步序列；三维点击本身仅报告作者编号。
    sendViewerCommand(frame, { type: 'select', chain: event.chain, residue: event.residue });
  }
  if (event.type === 'selected') console.log(event.chain, event.residue, event.atoms);
});
frame.addEventListener('load', () => sendViewerCommand(frame, {
  type: 'load', content: pdbText, format: 'pdb', background: 0xf7f7f8, dark: false,
}));
// 在 ready 后由工具栏事件调用。residue:null 表示整个聚合物。
function showResidueSurface() {
  sendViewerCommand(frame, { type: 'style', mode: 'surface', palette: 'uniform', chain: 'A', residue: '25' });
}
function clearSelection() {
  sendViewerCommand(frame, { type: 'select', chain: '', residue: null });
}
// 卸载宿主组件时调用 unsubscribe；移除 iframe 时会释放 Mol* / WebGL。
```

`pdbText` 由宿主提供。实际应用在 `ready` 后启用工具栏，并在卸载时调用 `unsubscribe()`。可运行的完整示例是导出目录里的 `protein-viewer-example.html`：打开本地文件后即可选择残基、切换表示和主题。

## 行为约定

### Agent 与用户共同操作

`createProteinWorkspace` 是无框架依赖的控制层，可从浏览器 Harness、React 或普通页面使用。宿主在 iframe 准备好后发送操作，并把经过 `subscribeViewer` 来源校验的回执交给控制层：

```js
import { createProteinWorkspace, sendViewerCommand, subscribeViewer } from '@mykit/molstar-viewer';
const workspace = createProteinWorkspace({ send: command => sendViewerCommand(frame, command) });
const unsubscribe = subscribeViewer(frame, event => {
  if (event.type === 'receipt') workspace.receive(event);
});
// load 中的 assetId / assetVersion 必须与操作一致；版本由宿主资产系统提供。
const receipt = await workspace.request({
  type: 'view', id: 'run-42:tool-3', assetId: '1UBQ', assetVersion: 'v1',
  chain: 'A', residue: '48', mode: 'stick', palette: 'uniform', focus: true,
});
// applied / not-found / failed / cancelled；只有 applied 携带确认的 state。
console.log(receipt.id, receipt.status, receipt.state);
```

- `view` 将选择、表示、聚焦作为一条有序操作执行；不会被旧的合并队列吞掉。验证目标后才修改视图，完成表示构建、即时相机定位和两次绘制调度后回执。执行异常可能发生在部分修改后，`failed` 不能作为已恢复旧画面的证明。
- `assetId`、`assetVersion` 与已加载资产不一致时失败。残基始终使用作者编号（允许负数及插入码），不接受隐式序列下标。宿主负责可靠映射。
- `request()` 返回 Promise；重复相同 ID 和参数复用结果，冲突参数报错。主动再次定位须使用新的操作 ID。查看器保留最近 256 个操作回执；控制层在本实例内保留去重记录。
- `setPinned(true)` 保留所有新建议，不中断已经执行中的操作；旋转、缩放、普通点击不改变固定状态。`applyPending(id)` 只应用所选建议并保留固定，`dismiss(id)` 返回 `cancelled`。`setPinned(false)` 依次应用剩余建议。
- `getSnapshot()` / `subscribe()` 提供活动指令、待应用队列、最近回执和最近确认的操作状态。`confirmed` 是历史执行结果，不等于用户随后操作后的实时视图。
- 默认 20 秒未收到对应回执返回 `failed`，自动固定并停止派发后续操作，因为此时无法确定查看器是否仍在执行。旧 ID、错误资产版本、错误选择或表示的回执不会确认当前指令。
- `clear()` 在切换分支时取消活动及待应用请求；`dispose()` 在销毁控制层时取消所有未完成 Promise。宿主切换资产或任务时应销毁旧实例和旧 iframe，防止旧绘制操作继续影响新资产。
- `clear-local-styles` 清除局部表示、保留选择，与 `select` 的取消选择独立。

宿主负责把操作 ID 和自己的运行、工具调用、会话关联起来（Evo 的做法是等同一浏览器的真实回执，再把结果交回同一轮 Agent）。加载历史不会自动重放场景操作。iframe 与宿主之间的消息通道名仍是 `evo-protein`，保持与 Evo 宿主兼容。

### Agent 场景协议

`scene` 在单一有序批次内最多执行 24 个固定操作。每步都必须有稳定 ID，并返回 `applied`、`not_found`、`failed` 或 `skipped`；批次返回 `success`、`partial`、`error` 或 `conflict`。`expectedRevision` 可阻止 Agent 覆盖用户刚刚修改过的场景。

```ts
sendViewerCommand(frame, {
  type: "scene",
  id: "browser-request-id",
  assetId: "uploaded-file-id",
  assetVersion: "sha256",
  expectedRevision: 0,
  onError: "stop",
  operations: [
    { id: "hide-default", op: "visibility.set", layer_id: "builtin", visible: false },
    {
      id: "active-site",
      op: "representation.upsert",
      layer_id: "active-site",
      selection: { kind: "within", distance: 5, of: { kind: "residue", chain: "A", residue: "25" } },
      mode: "surface",
      palette: "uniform",
      color: "#d946ef",
      opacity: 0.4,
    },
    { id: "focus", op: "selection.set", selection: { kind: "residue", chain: "A", residue: "25" }, focus: true },
  ],
});
```

选择支持 `all`、`polymer`、`water`、`ligand`、`chain`、`residue`、`range`、`atom` 和嵌套 `within`。操作支持命名表示图层增删/显隐、选择、镜头 fit/reset/zoom/spin、水、距离/角度/二面角测量和 PNG 快照。`get-state` 返回当前资产、revision、选择、图层、测量和可序列化状态。

**安全边界：** 浏览器只接受上述固定协议，不接受 JavaScript、Mol* 脚本或任意网络 URL。打开哪些文件、谁有权限，由宿主决定。该能力负责可视化操作，不执行分子动力学、对接或科学结论推断。场景状态只存在于当前 iframe，刷新后不做跨会话持久化。

- `select` 只改变选择，取消选择保留已应用的局部表示。
- `style` 显式包含目标；无选择的全局修改会清除局部覆盖。
- 局部图层与其余结构分区，表示切换保持其他残基不变。
- 连续待执行的相同范围 style、select、theme 等只保留最后一次；不同目标及 load/reset/snapshot 保持顺序。正在执行的结构计算不会强行中断。
- 主题仅更新背景及单色主题，不重建几何。重复相同表示直接返回当前状态。
- `selected` 是渲染器已处理选择/表示后的确认，包含当前实际表示和原子数。它不是服务器保存记录或逐帧截图回执。
- iframe 的结构输入上限为 8 MiB、50,000 个坐标原子。状态限当前 iframe 实例，刷新不持久化。
- 仅允许固定命令。iframe 不允许父页面 DOM、网络请求或任意脚本命令；宿主订阅器校验消息来源窗口和事件字段。Mol* 内部代码生成所需的 `unsafe-eval` 仅存在于隔离页。

## 验证

在 MyKit 根目录执行：

```sh
npm install
npm test -w @mykit/molstar-viewer              # 控制层和导出，不需要浏览器
npx playwright install chromium                # 浏览器测试第一次运行前装一次
npm run test:browser -w @mykit/molstar-viewer  # 真实 WebGL
```

浏览器测试把包导出到临时静态目录，并在嵌套 URL 中启动真实 WebGL：验证文件读取、作者残基选择、局部表示、主题切换、图层和几何引用复用、76 次待处理选择合并、消息来源隔离，以及无外部请求。场景测试还覆盖范围表面、自定义颜色和透明度、原子距离、选择聚焦、镜头操作、状态读取、revision 冲突和幂等重放。
