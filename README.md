# MyKit

个人组件库。常用代码在这里只维护一份，各项目用一条命令装上，按自己的节奏升级。

```sh
uv tool install --editable ./kit   # 装一次 mykit 命令行（跟随源码更新）

mykit docs                         # 文档站：组件展示、在线示例、更新记录
mykit list                         # 有哪些组件
mykit add react-loop               # 在你的项目里：链接安装，组件库改了立刻生效
mykit add react-loop --pin         # 稳定后：锁定当前版本
mykit outdated                     # 项目里的组件能不能升级、改了什么
```

组件一览见 [CATALOG.md](CATALOG.md)。详细说明在文档站的[快速上手](docs/guide/quickstart.md)和[维护组件库](docs/guide/maintain.md)。

## 目录

```
MyKit/
├── components/<id>/   每个组件：component.toml、README.md、CHANGELOG.md、python/、typescript/
├── kit/               mykit 命令行和新组件模板
├── docs/              文档站（VitePress），内容从各组件的三个文件生成
└── CATALOG.md         组件表（mykit catalog 生成）
```

## 维护

```sh
mykit new pdb-io --lang python --category model --summary "PDB / mmCIF 读写"
mykit bump react-loop 0.2.0   # 同步改三处版本号，在 CHANGELOG 加一节
mykit check                   # 检查规范
make test                     # 全部测试
```

开发环境：Python 组件和命令行是一个 uv workspace，TypeScript 组件和文档站是一个 npm workspace，都在根目录统一安装和锁定（`uv sync --all-packages`、`npm install`）。diffusion 依赖 torch，第一次同步会比较慢。
