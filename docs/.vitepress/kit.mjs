// 读取组件（component.toml、README.md、CHANGELOG.md、包定义），生成文档站的数据和组件页。
// 和 kit/src/mykit_cli/registry.py 读同样的文件；规则改动时两边一起改。
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'smol-toml'

export const ROOT = fileURLToPath(new URL('../..', import.meta.url))
export const COMPONENTS = join(ROOT, 'components')
export const CATEGORIES = { ui: '界面', ai: 'AI / Agent', model: '模型' }
export const STATUSES = { stable: '稳定', experimental: '实验中', deprecated: '已弃用' }
export const LANGUAGE_LABELS = { python: 'Python', typescript: 'TypeScript' }

const read = path => (existsSync(path) ? readFileSync(path, 'utf8') : '')

export function parseChangelog(text) {
  const entries = []
  for (const line of text.split('\n')) {
    const heading = /^## (\d+\.\d+\.\d+)(?:\s*·\s*(\S+))?\s*$/.exec(line)
    if (heading) entries.push({ version: heading[1], date: heading[2] ?? '', items: [] })
    else if (entries.length && line.startsWith('- ')) entries.at(-1).items.push(line.slice(2).trim())
    else if (entries.length && line.startsWith('  ') && entries.at(-1).items.length) entries.at(-1).items[entries.at(-1).items.length - 1] += ' ' + line.trim()
  }
  return entries
}

export function loadComponents() {
  const found = []
  for (const id of readdirSync(COMPONENTS).sort()) {
    const dir = join(COMPONENTS, id)
    let meta
    try {
      meta = parse(readFileSync(join(dir, 'component.toml'), 'utf8'))
    } catch {
      continue
    }
    if (meta.id !== id) continue
    const languages = ['python', 'typescript'].filter(lang => (meta.languages ?? []).includes(lang))
    const component = {
      id,
      version: String(meta.version),
      status: meta.status,
      category: meta.category,
      summary: meta.summary,
      languages,
      // smol-toml 把 copied = 2026-11-01 解析成 TomlDate；toISOString() 对纯日期只返回 YYYY-MM-DD
      sources: (meta.source ?? []).map(s => ({ ...s, copied: s.copied instanceof Date ? s.copied.toISOString().slice(0, 10) : String(s.copied ?? '') })),
      demo: meta.demo ? { entry: meta.demo.entry, height: meta.demo.height ?? 600 } : null,
      readme: read(join(dir, 'README.md')),
      changelog: parseChangelog(read(join(dir, 'CHANGELOG.md'))),
    }
    if (languages.includes('python')) {
      const project = parse(read(join(dir, 'python/pyproject.toml'))).project ?? {}
      component.python = { name: `mykit-${id}`, import: `mykit.${id.replaceAll('-', '_')}`, dependencies: project.dependencies ?? [] }
    }
    if (languages.includes('typescript')) {
      const pkg = JSON.parse(read(join(dir, 'typescript/package.json')))
      component.typescript = {
        name: `@mykit/${id}`,
        dependencies: { ...pkg.dependencies, ...pkg.peerDependencies },
        peers: Object.entries(pkg.peerDependencies ?? {}).map(([name, spec]) => `${name}@${spec}`),
        build: Boolean(pkg.scripts?.build),
      }
    }
    found.push(component)
  }
  const order = Object.keys(CATEGORIES)
  return found.sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category) || a.id.localeCompare(b.id))
}

// ---- 组件页 ----

export function componentPage(component, ids) {
  const { intro, body } = splitReadme(component.readme)
  return [
    `# ${component.id}`,
    `<ComponentMeta id="${component.id}" />`,
    rewriteLinks(intro, component.id, ids),
    component.demo ? `## 在线示例\n\n<ComponentDemo id="${component.id}" />` : '',
    installSection(component),
    rewriteLinks(body, component.id, ids),
    changelogSection(component),
    sourceSection(component),
  ].filter(Boolean).join('\n\n') + '\n'
}

function splitReadme(text) {
  const lines = text.replace(/^# .*\n/, '').split('\n')
  let fence = false
  const index = lines.findIndex(line => {
    if (/^(```|~~~)/.test(line)) fence = !fence
    return !fence && line.startsWith('## ')
  })
  return index < 0
    ? { intro: lines.join('\n').trim(), body: '' }
    : { intro: lines.slice(0, index).join('\n').trim(), body: lines.slice(index).join('\n').trim() }
}

function installSection(c) {
  const tabs = [
    `\`\`\`sh [mykit（推荐）]\n# 在你的项目根目录\nmykit add ${c.id}          # 开发中：链接到 MyKit，改了立刻生效\nmykit add ${c.id} --pin    # 稳定后：锁定 ${c.version}\n\`\`\``,
  ]
  if (c.python) {
    tabs.push(`\`\`\`sh [uv]\nuv add --editable ../MyKit/components/${c.id}/python\n\`\`\``)
  }
  if (c.typescript) {
    const build = c.typescript.build ? `# 先在 MyKit 根目录构建\nnpm run build -w ${c.typescript.name}\n# 再在你的项目里\n` : ''
    const peers = c.typescript.peers.length ? ` --save-exact ${c.typescript.peers.join(' ')}` : ''
    tabs.push(`\`\`\`sh [npm]\n${build}npm install ../MyKit/components/${c.id}/typescript${peers}\n\`\`\``)
  }
  const usage = []
  if (c.python) usage.push(`\`\`\`python\nimport ${c.python.import}\n\`\`\``)
  if (c.typescript) usage.push(`\`\`\`ts\nimport { ... } from '${c.typescript.name}'\n\`\`\``)
  return [
    '## 安装',
    `::: code-group\n\n${tabs.join('\n\n')}\n\n:::`,
    '直接用 uv / npm 时按实际位置调整 `../MyKit` 路径。两种装法的区别和升级方法见 [快速上手](/guide/quickstart)。',
    usage.join('\n\n'),
  ].join('\n\n')
}

function changelogSection(c) {
  if (!c.changelog.length) return ''
  const entries = c.changelog.map(entry => {
    const items = entry.items.map(item => `- ${item}`).join('\n')
    return `### ${entry.version}${entry.date ? ` · ${entry.date}` : ''}\n\n${items}`
  })
  return `## 更新记录\n\n${entries.join('\n\n')}`
}

function sourceSection(c) {
  if (!c.sources.length) return '## 来源\n\n原创组件。'
  const blocks = c.sources.map(s => {
    const head = [
      `**${s.repo ? `[${s.project}](${s.repo})` : s.project}**`,
      s.commit && `commit \`${s.commit}\``,
      s.copied && `${s.copied} 复刻`,
      s.license && `许可证 ${s.license}`,
    ].filter(Boolean).join(' · ')
    const paths = (s.paths ?? []).map(p => `- \`${p}\``).join('\n')
    return [head, paths, s.note && `> ${s.note}`].filter(Boolean).join('\n\n')
  })
  return `## 来源\n\n复刻时没有改动原项目。和原代码的差异见上文。\n\n${blocks.join('\n\n')}`
}

// README 里的相对链接：其他组件 → 站内页面；component.toml / CHANGELOG.md → 本页小节；其他文件 → 显示为路径
function rewriteLinks(text, id, ids) {
  let fence = false
  return text.split('\n').map(line => {
    if (/^(```|~~~)/.test(line)) fence = !fence
    if (fence) return line
    return line.replace(/(?<!!)\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label, href) => {
      if (/^([a-z]+:|#|\/)/i.test(href)) return match
      const target = posix.normalize(posix.join('components', id, href))
      const other = /^components\/([^/]+)\/README\.md$/.exec(target)
      if (other && ids.includes(other[1])) return `[${label}](/components/${other[1]})`
      if (target === `components/${id}/component.toml`) return `[${label}](#来源)`
      if (target === `components/${id}/CHANGELOG.md`) return `[${label}](#更新记录)`
      const plainLabel = label.replace(/`/g, '')
      return plainLabel === href || plainLabel === posix.basename(href) ? `\`${target}\`` : `${label}（\`${target}\`）`
    })
  }).join('\n')
}
