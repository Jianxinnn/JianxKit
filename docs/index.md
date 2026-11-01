---
layout: home

hero:
  name: MyKit
  text: 个人组件库
  tagline: 常用代码只维护一份。各项目一条命令装上，按自己的节奏升级。
  image:
    src: /logo.svg
    alt: MyKit
  actions:
    - theme: brand
      text: 浏览组件
      link: /components/
    - theme: alt
      text: 快速上手
      link: /guide/quickstart

features:
  - title: 一条命令装进项目
    details: mykit add 自动识别 uv / npm / pnpm。开发时链接源码，稳定后 --pin 锁定版本。
  - title: 更新看得见
    details: mykit outdated 列出能升级的组件和每个版本改了什么，升级再 pin 一次。
  - title: 来源可追溯
    details: 每个组件写明从哪个项目、哪个 commit 复刻，第三方代码保留许可证。
---

<div class="mk-home">

## 组件

<p class="mk-lead">点卡片看安装方法、用法和在线示例。</p>

<ComponentGallery />

## 最近更新

<ChangelogTimeline :limit="6" />

</div>
