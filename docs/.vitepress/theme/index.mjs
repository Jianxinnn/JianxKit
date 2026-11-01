import DefaultTheme from 'vitepress/theme'
import ChangelogTimeline from './ChangelogTimeline.vue'
import ComponentDemo from './ComponentDemo.vue'
import ComponentGallery from './ComponentGallery.vue'
import ComponentMeta from './ComponentMeta.vue'
import './style.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('ComponentGallery', ComponentGallery)
    app.component('ComponentMeta', ComponentMeta)
    app.component('ComponentDemo', ComponentDemo)
    app.component('ChangelogTimeline', ChangelogTimeline)
  },
}
