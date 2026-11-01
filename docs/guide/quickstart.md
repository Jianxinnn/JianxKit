# 快速上手

MyKit 像一个私有的零件仓库：组件在这里维护，项目用 `mykit add` 取用。每个项目自己决定跟着源码走，还是锁定在某个版本。

## 1. 装命令行（一次）

```sh
uv tool install --editable ~/Desktop/CodeProjects/MyKit/kit
```

`--editable` 让命令行跟着 MyKit 源码更新，以后不用重装。卸载：`uv tool uninstall mykit-cli`。

## 2. 找组件

```sh
mykit list              # 所有组件
mykit info react-loop   # 用法、依赖、最近更新
mykit docs              # 打开这个文档站
```

## 3. 装进项目

在你的项目根目录运行：

```sh
mykit add react-loop
```

`mykit add` 会看项目里有 `pyproject.toml` 还是 `package.json`，自动调用 uv、npm 或 pnpm。加 `--dry-run` 只显示要执行的命令，不实际执行。

两种装法：

| | `mykit add <组件>` | `mykit add <组件> --pin` |
| --- | --- | --- |
| 适合 | 正在一起改组件和项目 | 项目稳定了，不想被组件库的改动影响 |
| 做法 | Python 可编辑安装；TS 链接本地路径 | 把当前版本打包成 wheel / tgz，放进项目的 `vendor/mykit/` |
| 组件库改了 | 项目里立刻生效 | 不受影响，直到你再 pin 一次 |
| 换机器、上集群 | 需要同一路径下有 MyKit | 不需要：把 `vendor/mykit/` 一起提交即可 |

`--pin` 前会先跑 `mykit check`，没通过的组件不会被锁定。

## 4. 升级

```sh
mykit outdated
```

它列出项目里每个 MyKit 组件的装法、当前版本和 MyKit 里的最新版本。有新版本时，会显示中间每个版本改了什么，以及升级命令（通常就是再 `mykit add <组件> --pin` 一次）。链接安装的 TS 组件如果源码比构建产物新，也会提示重新构建。

## 不用命令行也可以

每个组件页的「安装」一节都有 uv / npm 的原始命令。`mykit add` 只是替你算好路径、依赖和构建步骤。
