// 真实调用示例：npm run example
// 读取仓库根目录的 .env：EMRand_JEV_URL / EMRand_JEV_KEY / EMRand_JEV_MODEL（中转），
// 或官方的 TYPESAFE_API_KEY。设置 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL 后会启用备用模型和 extract。
import { z } from 'zod'
import { createAI, type Result } from '../src/index.js'

try {
  process.loadEnvFile(new URL('../../.env', import.meta.url))
} catch {
  // 没有 .env 时只用已有的环境变量
}

const env = process.env
const apiKey = env.EMRand_JEV_KEY ?? env.TYPESAFE_API_KEY
if (!apiKey) throw new Error('set EMRand_JEV_KEY or TYPESAFE_API_KEY')

const ai = createAI({
  jev: { apiKey, url: env.EMRand_JEV_URL, model: env.EMRand_JEV_MODEL },
  ...(env.LLM_BASE_URL && env.LLM_API_KEY && env.LLM_MODEL
    ? { llm: { baseURL: env.LLM_BASE_URL, apiKey: env.LLM_API_KEY, model: env.LLM_MODEL } }
    : {}),
})

const input = {
  parts: [
    { id: 'description', content: 'Predicts the binding affinity of a protein-ligand pair. Accepts a batch of up to 100 pairs.' },
    { id: 'input-schema', content: { type: 'object', properties: { pairs: { type: 'array', description: 'protein-ligand pairs' } } } },
    { id: 'output-schema', content: { type: 'object', properties: { affinity: { type: 'number', description: 'predicted pKd' } } } },
  ],
}

const categories = [
  { id: 'prediction', description: '预测未知结果' },
  { id: 'scoring', description: '对已有对象评分' },
  { id: 'conversion', description: '转换数据格式' },
]

function show(label: string, result: Result<unknown>) {
  console.log(`\n== ${label}: ${result.status}  (${result.meta.provider} ${result.meta.model})`)
  console.log('data  ', JSON.stringify(result.data))
  for (const issue of result.issues) console.log('issue ', issue.code, issue.provider ?? '', issue.message)
}

show('classify single', await ai.classify({ input, instruction: '按实际能力分类', categories }))
show('classify multi', await ai.classify({ input, instruction: '按实际能力分类', categories, mode: 'multi' }))
show('judge', await ai.judge({ input, statement: '工具支持批量输入' }))
show('judge many', await ai.judge({ input, statements: { batch: '工具支持批量输入', gpu: '工具需要 GPU' } }))

if (env.LLM_BASE_URL) {
  const schema = z.object({ maxBatchSize: z.number().nullable(), outputUnit: z.string().nullable() })
  show('extract', await ai.extract({ input, instruction: '提取工具的批量上限和输出单位', schema, requireEvidence: true }))
}
