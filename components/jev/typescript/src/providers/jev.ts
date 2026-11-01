import type { ClassifyData, Input, Issue, JevConfig, Provider, ProviderResult, Request, Verdicts } from '../types.js'
import { isObject, postJSON, ProviderError } from './http.js'

// Jev（TypeSafe System One）适配器：把统一请求转换为 Choice / Noul 问题。
// 协议见 https://docs.typesafe.ai/api/system-one.md

const UNDETERMINED = '__undetermined__'
const MAX_CHOICE_OPTIONS = 255

type JevQuestion =
  | { type: 'noul'; instructions: string; criteria?: { true: string; false: string } }
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }

type JevAnswer = { type: string; noul?: number; choice?: string; confidence?: number | null }

export function jevProvider(config: JevConfig): Provider {
  const url = config.url ?? 'https://api.typesafe.ai/v1/systemone'
  const model = config.model ?? 'jev-latest'
  const minConfidence = config.minConfidence ?? 0.5
  const noulYes = config.noulYes ?? 0.7
  const noulNo = config.noulNo ?? 0.3
  const fetchFn = config.fetch ?? fetch
  const timeoutMs = config.timeoutMs ?? 30_000
  if (![minConfidence, noulYes, noulNo].every(isProbability) || noulNo >= noulYes) {
    throw new Error('jev thresholds must be in [0, 1], with noulNo < noulYes')
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('jev.timeoutMs must be positive')

  async function ask(input: Input, questions: Record<string, JevQuestion>) {
    const state = Object.fromEntries(input.parts.map((part) => [part.id, part.content]))
    const body = await postJSON(
      fetchFn,
      url,
      { Authorization: `Bearer ${config.apiKey}` },
      { model, state, questions },
      timeoutMs,
    )
    if (!isObject(body) || !isObject(body.answers)) throw new ProviderError('Jev response has no answers', false)
    const answers = body.answers as Record<string, JevAnswer>
    for (const name of Object.keys(questions)) {
      if (!isObject(answers[name])) throw new ProviderError(`Jev response is missing answer "${name}"`, false)
      if (answers[name]!.type !== questions[name]!.type) throw new ProviderError(`Jev answer "${name}" has an unexpected type`, false)
    }
    return { model: typeof body.model === 'string' ? body.model : model, answers }
  }

  function lowConfidence(answer: JevAnswer, what: string): Issue[] {
    if (answer.confidence === undefined || answer.confidence === null) {
      return [{ code: 'low_confidence', message: `missing confidence for ${what}` }]
    }
    if (!isProbability(answer.confidence)) throw new ProviderError('Jev confidence must be a probability in [0, 1]', false)
    if (answer.confidence >= minConfidence) return []
    return [{ code: 'low_confidence', message: `confidence ${answer.confidence.toFixed(2)} for ${what}` }]
  }

  async function classifySingle(request: Extract<Request, { operation: 'classify' }>): Promise<ProviderResult> {
    const criteria = Object.fromEntries(request.categories.map((category) => [category.id, category.description]))
    criteria[UNDETERMINED] = 'The `state` does not contain enough information to pick any other option with certainty.'
    const { model, answers } = await ask(request.input, {
      category: {
        type: 'choice',
        instructions: withTask(request.instruction, 'Which category best describes the `state`?'),
        criteria,
      },
    })
    const answer = answers.category!
    if (typeof answer.choice !== 'string') throw new ProviderError('Jev choice answer has no choice', false)
    const data: ClassifyData = answer.choice === UNDETERMINED
      ? { categories: [], undetermined: true }
      : { categories: [answer.choice], undetermined: false }
    return { model, data, issues: lowConfidence(answer, `"${answer.choice}"`), raw: answers }
  }

  async function classifyMulti(request: Extract<Request, { operation: 'classify' }>): Promise<ProviderResult> {
    const questions: Record<string, JevQuestion> = {}
    request.categories.forEach((category, i) => {
      questions[`c${i}`] = {
        type: 'noul',
        instructions: withTask(request.instruction, `Does the category "${category.id}" apply to the \`state\`?`),
        criteria: { true: category.description, false: 'The `state` does not match this description.' },
      }
    })
    const { model, answers } = await ask(request.input, questions)
    const chosen: string[] = []
    const issues: Issue[] = []
    request.categories.forEach((category, i) => {
      const p = answers[`c${i}`]!.noul
      if (!isProbability(p)) throw new ProviderError('Jev noul answer must have a probability in [0, 1]', false)
      if (p >= noulYes) chosen.push(category.id)
      else if (p > noulNo) issues.push({ code: 'low_confidence', message: `"${category.id}" has probability ${p.toFixed(2)}` })
    })
    const data: ClassifyData = { categories: chosen, undetermined: issues.length > 0 }
    return { model, data, issues, raw: answers }
  }

  async function judge(request: Extract<Request, { operation: 'judge' }>): Promise<ProviderResult> {
    const keys = Object.keys(request.statements)
    const questions: Record<string, JevQuestion> = {}
    keys.forEach((key, i) => {
      questions[`s${i}`] = {
        type: 'choice',
        instructions: `Statement: ${request.statements[key]}\nDoes the \`state\` support this statement?`,
        criteria: {
          holds: 'The `state` clearly supports the statement.',
          does_not_hold: 'The `state` clearly contradicts the statement.',
          unknown: 'The `state` does not contain enough information to decide.',
        },
      }
    })
    const { model, answers } = await ask(request.input, questions)
    const data: Verdicts = Object.fromEntries(keys.map((key) => [key, null]))
    const issues: Issue[] = []
    keys.forEach((key, i) => {
      const answer = answers[`s${i}`]!
      if (answer.choice === 'holds') data[key] = true
      else if (answer.choice === 'does_not_hold') data[key] = false
      else if (answer.choice === 'unknown') data[key] = null
      else throw new ProviderError(`Jev returned unexpected choice "${answer.choice}"`, false)
      issues.push(...lowConfidence(answer, `"${key}"`))
    })
    return { model, data, issues, raw: answers }
  }

  return {
    name: 'jev',
    // Jev 不做自由提取，也不返回原文引用
    supports(request) {
      if (request.operation === 'extract' || request.requireEvidence) return false
      if (request.operation === 'classify' && request.mode === 'single') {
        return request.categories.length < MAX_CHOICE_OPTIONS && !request.categories.some((c) => c.id === UNDETERMINED)
      }
      return true
    },
    async run(request) {
      if (request.operation === 'extract') throw new ProviderError('jev does not support extract', false)
      if (request.operation === 'judge') return judge(request)
      return request.mode === 'single' ? classifySingle(request) : classifyMulti(request)
    },
  }
}

function withTask(instruction: string | undefined, question: string): string {
  return instruction ? `Task: ${instruction}\n${question}` : question
}

function isProbability(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}
