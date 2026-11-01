import { componentPage, loadComponents } from '../.vitepress/kit.mjs'

export default {
  paths() {
    const components = loadComponents()
    const ids = components.map(c => c.id)
    return components.map(c => ({ params: { id: c.id }, content: componentPage(c, ids) }))
  },
}
