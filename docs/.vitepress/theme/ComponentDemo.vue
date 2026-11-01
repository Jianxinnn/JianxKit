<script setup>
import { computed } from 'vue'
import { withBase } from 'vitepress'
import { data } from '../kit.data.mjs'

const props = defineProps({ id: { type: String, required: true } })
const demo = computed(() => data.components.find(c => c.id === props.id)?.demo)
const src = computed(() => demo.value && withBase(`/demos/${props.id}/${demo.value.entry}`))
</script>

<template>
  <div v-if="demo" class="mk-demo">
    <iframe :src="src" :style="{ height: `${demo.height}px` }" :title="`${props.id} 在线示例`" loading="lazy" />
    <div class="bar">
      <span>示例页随文档站构建；本地运行 <code>mykit demo {{ props.id }}</code></span>
      <a :href="src" target="_blank" rel="noopener">新窗口打开 ↗</a>
    </div>
  </div>
</template>

<style scoped>
.mk-demo { margin: 16px 0; border: 1px solid var(--vp-c-divider); border-radius: 12px; overflow: hidden; background: var(--vp-c-bg-alt); }
iframe { display: block; width: 100%; border: 0; }
.bar { display: flex; justify-content: space-between; gap: 12px; padding: 8px 14px; font-size: 13px; color: var(--vp-c-text-2); border-top: 1px solid var(--vp-c-divider); }
.bar a { font-weight: 500; }
</style>
