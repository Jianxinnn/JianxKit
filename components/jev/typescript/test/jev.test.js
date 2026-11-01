// 离线测试：用假的 fetch 代替 Jev 接口。先 npm run build。
import assert from 'node:assert/strict'
import test from 'node:test'
import { createAI } from '../dist/index.js'

const input = { parts: [{ id: 'description', content: '预测结合亲和力，支持批量输入。' }] }
const categories = [
  { id: 'prediction', description: '预测未知结果' },
  { id: 'conversion', description: '转换数据格式' },
]

function jevAI(answers, seen = []) {
  const fetch = async (_url, init) => {
    const body = JSON.parse(init.body)
    seen.push(body)
    return new Response(JSON.stringify({ model: 'jev-test', answers: answers(body) }), { status: 200 })
  }
  return createAI({ jev: { apiKey: 'test-key', fetch } })
}

test('classify sends parts as state and reads the choice', async () => {
  const seen = []
  const ai = jevAI(() => ({ category: { type: 'choice', choice: 'prediction', confidence: 0.9 } }), seen)
  const result = await ai.classify({ input, categories })
  assert.equal(result.status, 'ok')
  assert.deepEqual(result.data.categories, ['prediction'])
  assert.equal(result.meta.provider, 'jev')
  assert.deepEqual(seen[0].state, { description: '预测结合亲和力，支持批量输入。' })
})

test('low confidence judgement needs review', async () => {
  const ai = jevAI(() => ({ s0: { type: 'choice', choice: 'holds', confidence: 0.2 } }))
  const result = await ai.judge({ input, statement: '工具支持批量输入' })
  assert.equal(result.status, 'needs_review')
  assert.equal(result.data.holds, true)
  assert.ok(result.issues.some(issue => issue.code === 'low_confidence'))
})
