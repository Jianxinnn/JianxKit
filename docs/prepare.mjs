// 构建文档站前：为有 [demo] 的组件运行 npm run demo:build，把导出的静态页面复制到 docs/public/demos/<id>/。
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { COMPONENTS, ROOT, loadComponents } from './.vitepress/kit.mjs'

const target = join(ROOT, 'docs/public/demos')
rmSync(target, { recursive: true, force: true })
mkdirSync(target, { recursive: true })
for (const component of loadComponents().filter(c => c.demo)) {
  execFileSync('npm', ['run', 'demo:build', '-w', `@mykit/${component.id}`], { cwd: ROOT, stdio: 'inherit' })
  const built = join(COMPONENTS, component.id, 'typescript/demo-build')
  if (!existsSync(built)) throw new Error(`${component.id}: demo:build 没有生成 typescript/demo-build/`)
  cpSync(built, join(target, component.id), { recursive: true })
  console.log(`在线示例：${component.id}`)
}
