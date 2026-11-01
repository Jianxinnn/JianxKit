<script setup>
import { computed, ref } from 'vue'
import { withBase } from 'vitepress'
import { data } from '../kit.data.mjs'

const props = defineProps({ filters: { type: Boolean, default: false } })
const CATEGORIES = { ui: '界面', ai: 'AI / Agent', model: '模型' }
const STATUSES = { stable: '稳定', experimental: '实验中', deprecated: '已弃用' }
const LANGUAGES = { python: 'Python', typescript: 'TS' }

const query = ref('')
const category = ref('')
const language = ref('')

const shown = computed(() => {
  const q = query.value.trim().toLowerCase()
  return data.components.filter(c =>
    (!category.value || c.category === category.value) &&
    (!language.value || c.languages.includes(language.value)) &&
    (!q || `${c.id} ${c.summary} ${c.sources.map(s => s.project).join(' ')}`.toLowerCase().includes(q)))
})
const latest = c => c.changelog[0]?.date ?? ''
</script>

<template>
  <div class="mk-gallery">
    <div v-if="props.filters" class="toolbar">
      <input v-model="query" type="search" placeholder="搜索组件、说明、来源…" aria-label="搜索组件" />
      <div class="chips" role="group" aria-label="类别">
        <button :class="{ on: !category }" @click="category = ''">全部</button>
        <button v-for="(label, key) in CATEGORIES" :key="key" :class="{ on: category === key }" @click="category = category === key ? '' : key">{{ label }}</button>
      </div>
      <div class="chips" role="group" aria-label="语言">
        <button v-for="(label, key) in LANGUAGES" :key="key" :class="{ on: language === key }" @click="language = language === key ? '' : key">{{ label }}</button>
      </div>
    </div>
    <div class="grid">
      <a v-for="c in shown" :key="c.id" class="card" :href="withBase(`/components/${c.id}`)">
        <div class="top">
          <span class="category">{{ CATEGORIES[c.category] }}</span>
          <span class="mk-pill" :class="c.status">{{ STATUSES[c.status] }}</span>
        </div>
        <h3>{{ c.id }}</h3>
        <p>{{ c.summary }}</p>
        <div class="bottom">
          <span class="mk-pill version">v{{ c.version }}</span>
          <span v-for="lang in c.languages" :key="lang" class="mk-pill">{{ LANGUAGES[lang] }}</span>
          <span v-if="c.demo" class="mk-pill demo">在线示例</span>
          <span class="date">{{ latest(c) }}</span>
        </div>
      </a>
    </div>
    <p v-if="!shown.length" class="empty">没有符合条件的组件。</p>
  </div>
</template>

<style scoped>
.toolbar { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin: 16px 0 20px; }
.toolbar input {
  flex: 1 1 240px; height: 36px; padding: 0 12px; border-radius: 8px;
  border: 1px solid var(--vp-c-divider); background: var(--vp-c-bg-alt); color: var(--vp-c-text-1); font-size: 14px;
}
.toolbar input:focus { outline: none; border-color: var(--vp-c-brand-1); }
.chips { display: flex; gap: 6px; flex-wrap: wrap; }
.chips button {
  height: 30px; padding: 0 12px; border-radius: 999px; font-size: 13px;
  border: 1px solid var(--vp-c-divider); color: var(--vp-c-text-2); background: var(--vp-c-bg); transition: all .15s;
}
.chips button:hover { color: var(--vp-c-text-1); border-color: var(--vp-c-text-3); }
.chips button.on { color: var(--vp-c-brand-1); border-color: var(--vp-c-brand-1); background: var(--vp-c-brand-soft); }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(270px, 1fr)); gap: 16px; }
.card {
  display: flex; flex-direction: column; gap: 8px; padding: 18px 20px; border-radius: 12px;
  border: 1px solid var(--vp-c-bg-soft); background: var(--vp-c-bg-soft);
  color: inherit; text-decoration: none !important; transition: border-color .2s, transform .2s, box-shadow .2s;
}
.card:hover { border-color: var(--vp-c-brand-1); transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0, 0, 0, .06); }
.top { display: flex; justify-content: space-between; align-items: center; }
.category { font-size: 12px; color: var(--vp-c-text-3); letter-spacing: .02em; }
h3 { margin: 0; font-size: 17px; font-weight: 600; font-family: var(--vp-font-family-mono); color: var(--vp-c-text-1); border: 0; padding: 0; }
p { margin: 0; flex: 1; font-size: 14px; line-height: 1.6; color: var(--vp-c-text-2); }
.bottom { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 4px; }
.mk-pill.demo { background: rgba(99, 102, 241, .14); color: #6366f1; }
.dark .mk-pill.demo { color: #a5b4fc; }
.date { margin-left: auto; font-size: 12px; color: var(--vp-c-text-3); }
.empty { color: var(--vp-c-text-2); }
</style>
