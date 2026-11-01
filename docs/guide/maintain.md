# 维护组件库

## 加一个组件

```sh
mykit new pdb-io --lang python --category model --summary "PDB / mmCIF 读写"
```

生成目录、包定义、测试和文档模板。写好代码和测试，把 README.md、CHANGELOG.md 里的「（待填写）」补完，`mykit check` 通过就算完成。文档站会自动出现这个组件。

从别的项目复刻时不要改原项目。在 `component.toml` 的 `[[source]]` 写明项目、路径、commit、日期；第三方代码保留许可证和版权声明，并在 README 的「和原代码的差异」一节写清改了什么。

## 改组件、发新版本

```sh
# 1. 改代码、加测试
uv run pytest components/react-loop          # 或 npm test -w @mykit/<组件>
# 2. 改版本号：同步修改 component.toml、pyproject.toml、package.json，并在 CHANGELOG.md 顶部加一节
mykit bump react-loop 0.2.0
# 3. 在 CHANGELOG.md 写清这次改了什么，然后
mykit check
# 4. 提交并打 tag
git tag react-loop-v0.2.0
```

版本号规则：修 bug 改第三位，加功能改第二位，接口不兼容改第一位（1.0 之前不兼容也只改第二位）。

发布后，链接安装的项目已经用上新代码；锁定了旧版本的项目运行 `mykit outdated` 就能看到这次更新和升级命令。

## 组件的结构

```
components/<id>/
├── component.toml   版本、状态、类别、语言、来源、在线示例
├── README.md        用途、用法、和原代码的差异（不用写安装方法）
├── CHANGELOG.md     每个版本改了什么
├── python/          包 mykit-<id>，代码在 src/mykit/<模块>/，导入 mykit.<模块>
└── typescript/      包 @mykit/<id>
```

文档站和 `mykit` 命令行都只读这三个文件和包定义，所以不需要在别处另外登记。安装方法由它们自动生成，README 里只写怎么用。

`component.toml` 示例：

```toml
id = "react-loop"
version = "0.1.0"
status = "experimental"        # experimental / stable / deprecated
category = "ai"                # ui / ai / model
summary = "最小 ReAct 循环：……"
languages = ["python"]

[[source]]                     # 原创组件不写
project = "BioMolHarness"
repo = "https://github.com/..."
paths = ["baseline/agent/loop.py"]
commit = "df43d921"
copied = 2026-11-01
license = "Apache-2.0"         # 第三方代码才写

[demo]                         # 可选：文档站的在线示例
entry = "index.html"
height = 600
```

有 `[demo]` 的组件需要在 `typescript/package.json` 里提供 `demo:build` 脚本，把静态页面导出到 `typescript/demo-build/`。文档站构建时会把它复制进来，嵌在组件页里。

## 规则

`mykit check` 会检查下面大部分规则：

- `id` 用小写和连字符，等于目录名；包名 `mykit-<id>` / `@mykit/<id>`。
- 三处版本号一致；CHANGELOG 有当前版本的小节，而且没有「（待填写）」。
- Python 代码在 `src/mykit/<模块>/`；`src/mykit/` 是各组件共享的命名空间，不能有 `__init__.py`。
- 每种语言都有测试。
- 组件之间不互相依赖。需要配合时只约定数据形状，比如 react-loop 接受任何有 `complete(messages, tools)` 的模型，llm-call 恰好符合。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `mykit check` | 检查所有组件 |
| `mykit catalog` | 重新生成 `CATALOG.md`（GitHub 上看的组件表） |
| `make test` | Python 和 TypeScript 全部测试 |
| `mykit docs` | 本地启动文档站；改了组件的 README / CHANGELOG 会自动刷新 |
| `make docs-build` | 构建静态站点到 `docs/.vitepress/dist/`，可以直接部署 |
