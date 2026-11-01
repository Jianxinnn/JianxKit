<script setup>
import { computed } from 'vue'
import { data } from '../kit.data.mjs'

const props = defineProps({ id: { type: String, required: true } })
const c = computed(() => data.components.find(item => item.id === props.id))
const CATEGORIES = { ui: '界面', ai: 'AI / Agent', model: '模型' }
const STATUSES = { stable: '稳定', experimental: '实验中', deprecated: '已弃用' }
const tsDeps = computed(() => Object.entries(c.value?.typescript?.dependencies ?? {}).map(([name, spec]) => `${name}@${spec}`))
</script>

<template>
  <div v-if="c" class="mk-meta">
    <div class="pills">
      <span class="mk-pill version">v{{ c.version }}</span>
      <span class="mk-pill" :class="c.status">{{ STATUSES[c.status] }}</span>
      <span class="mk-pill">{{ CATEGORIES[c.category] }}</span>
      <span v-for="s in c.sources" :key="s.project" class="mk-pill">来自 {{ s.project }}</span>
    </div>
    <dl>
      <template v-if="c.python">
        <dt>Python</dt>
        <dd><code>{{ c.python.name }}</code> → <code>import {{ c.python.import }}</code></dd>
        <dt>依赖</dt>
        <dd>{{ c.python.dependencies.length ? c.python.dependencies.join('，') : '无，只用标准库' }}</dd>
      </template>
      <template v-if="c.typescript">
        <dt>TypeScript</dt>
        <dd><code>{{ c.typescript.name }}</code></dd>
        <dt>依赖</dt>
        <dd>{{ tsDeps.length ? tsDeps.join('，') : '无' }}</dd>
      </template>
    </dl>
  </div>
</template>

<style scoped>
.mk-meta { margin: 16px 0 24px; padding: 16px 20px; border-radius: 12px; background: var(--vp-c-bg-soft); }
.pills { display: flex; flex-wrap: wrap; gap: 6px; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; margin: 14px 0 0; font-size: 14px; }
dt { color: var(--vp-c-text-3); }
dd { margin: 0; color: var(--vp-c-text-1); overflow-wrap: anywhere; }
</style>
