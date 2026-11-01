<script setup>
import { computed } from 'vue'
import { withBase } from 'vitepress'
import { data } from '../kit.data.mjs'

const props = defineProps({ limit: { type: Number, default: 0 } })
const entries = computed(() => (props.limit ? data.timeline.slice(0, props.limit) : data.timeline))
</script>

<template>
  <ol class="mk-timeline">
    <li v-for="entry in entries" :key="`${entry.id}@${entry.version}`">
      <div class="head">
        <span class="date">{{ entry.date || '未注明日期' }}</span>
        <a class="name" :href="withBase(`/components/${entry.id}#更新记录`)">{{ entry.id }}</a>
        <span class="mk-pill version">v{{ entry.version }}</span>
      </div>
      <ul>
        <li v-for="(item, index) in entry.items" :key="index" v-html="item" />
      </ul>
    </li>
  </ol>
</template>

<style scoped>
.mk-timeline { list-style: none; margin: 16px 0; padding: 0 0 0 18px; border-left: 2px solid var(--vp-c-divider); }
.mk-timeline > li { position: relative; margin: 0 0 22px; }
.mk-timeline > li::before {
  content: ''; position: absolute; left: -25px; top: 6px; width: 12px; height: 12px; border-radius: 50%;
  background: var(--vp-c-bg); border: 2px solid var(--vp-c-brand-1);
}
.head { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.date { font-size: 13px; color: var(--vp-c-text-3); font-family: var(--vp-font-family-mono); }
.name { font-weight: 600; font-family: var(--vp-font-family-mono); text-decoration: none; }
ul { margin: 6px 0 0; padding-left: 18px; font-size: 14px; color: var(--vp-c-text-2); }
ul li { margin: 2px 0; line-height: 1.65; }
</style>
