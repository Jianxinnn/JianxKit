// 给首页、组件列表、更新记录页用的数据。改了 component.toml / CHANGELOG.md 会自动刷新。
import { createMarkdownRenderer } from 'vitepress'
import { loadComponents, ROOT } from './kit.mjs'

export default {
  watch: [`${ROOT}components/*/component.toml`, `${ROOT}components/*/CHANGELOG.md`],
  async load() {
    const md = await createMarkdownRenderer(ROOT)
    const inline = text => md.renderInline(text)
    const components = loadComponents().map(({ readme, changelog, ...c }) => ({
      ...c,
      changelog: changelog.map(entry => ({ ...entry, items: entry.items.map(inline) })),
    }))
    const timeline = components
      .flatMap(c => c.changelog.map(entry => ({ id: c.id, ...entry })))
      .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id))
    return { components, timeline }
  },
}
