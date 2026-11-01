import { join, relative } from 'node:path'
import { defineConfig } from 'vitepress'
import { CATEGORIES, COMPONENTS, ROOT, loadComponents } from './kit.mjs'

// 组件的 README / CHANGELOG / component.toml 改了以后，让 VitePress 重新读配置（侧边栏、组件页、数据都会刷新）。
// 只有配置文件变化才会让 VitePress 重新生成动态路由，所以这里把组件文件的变化转告为配置文件变化。
const CONFIG_FILE = join(ROOT, 'docs/.vitepress/config.mjs')
const COMPONENT_FILE = new RegExp(`^${COMPONENTS.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/[^/]+/(component\\.toml|README\\.md|CHANGELOG\\.md)$`)

function reloadOnComponentChange() {
  return {
    name: 'mykit:reload-components',
    configureServer(server) {
      server.watcher.add(COMPONENTS)
      let timer
      server.watcher.on('all', (_event, file) => {
        if (!COMPONENT_FILE.test(file)) return
        clearTimeout(timer)
        timer = setTimeout(() => {
          server.config.logger.info(`组件文件有变化：${relative(ROOT, file)}，重新加载`, { timestamp: true })
          server.watcher.emit('change', CONFIG_FILE)
        }, 200)
      })
    },
  }
}

const components = loadComponents()
const componentSidebar = [
  { text: '全部组件', link: '/components/' },
  ...Object.entries(CATEGORIES)
    .map(([key, label]) => ({
      text: label,
      items: components.filter(c => c.category === key).map(c => ({ text: c.id, link: `/components/${c.id}` })),
    }))
    .filter(group => group.items.length),
]

export default defineConfig({
  lang: 'zh-CN',
  title: 'MyKit',
  description: '个人组件库：常用代码只维护一份，各项目按版本取用',
  head: [['link', { rel: 'icon', href: '/logo.svg' }]],
  vite: { plugins: [reloadOnComponentChange()] },
  themeConfig: {
    logo: '/logo.svg',
    nav: [
      { text: '组件', link: '/components/', activeMatch: '^/components/' },
      { text: '快速上手', link: '/guide/quickstart' },
      { text: '维护', link: '/guide/maintain' },
      { text: '更新记录', link: '/changelog' },
    ],
    sidebar: {
      '/components/': componentSidebar,
      '/guide/': [
        {
          text: '指南',
          items: [
            { text: '快速上手', link: '/guide/quickstart' },
            { text: '维护组件库', link: '/guide/maintain' },
          ],
        },
      ],
    },
    outline: { label: '本页' },
    docFooter: { prev: '上一页', next: '下一页' },
    darkModeSwitchLabel: '外观',
    lightModeSwitchTitle: '切换到浅色',
    darkModeSwitchTitle: '切换到深色',
    sidebarMenuLabel: '菜单',
    returnToTopLabel: '回到顶部',
    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: '搜索', buttonAriaLabel: '搜索' },
          modal: {
            noResultsText: '没有结果',
            resetButtonTitle: '清除',
            footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' },
          },
        },
      },
    },
    footer: { message: '内容来自各组件的 component.toml、README.md、CHANGELOG.md' },
  },
})
