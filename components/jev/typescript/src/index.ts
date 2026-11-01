import { z, type ZodType } from 'zod'
import type {
  AIConfig,
  ClassifyData,
  ClassifyOptions,
  ExtractOptions,
  JudgeData,
  JudgeManyData,
  JudgeManyOptions,
  JudgeOptions,
  Provider,
  Result,
  Verdicts,
} from './types.js'
import { isObject } from './providers/http.js'
import { jevProvider } from './providers/jev.js'
import { llmProvider } from './providers/llm.js'
import { failed, run, type Policy } from './runner.js'
import { checkCategories, checkInput } from './validation.js'

export type * from './types.js'
export { ProviderError } from './providers/http.js'
export { jevProvider } from './providers/jev.js'
export { llmProvider } from './providers/llm.js'

export type AI = {
  classify(options: ClassifyOptions): Promise<Result<ClassifyData>>
  extract<S extends ZodType>(options: ExtractOptions<S>): Promise<Result<z.output<S>>>
  judge(options: JudgeOptions): Promise<Result<JudgeData>>
  judge(options: JudgeManyOptions): Promise<Result<JudgeManyData>>
}

// 提供方按注册顺序尝试：jev、llm、再是 providers。
// 每次请求只用支持它的提供方，所以分类、判断 Jev 优先；提取和要求原文引用时直接走语言模型。
export function createAI(config: AIConfig): AI {
  if (config.jev && !config.jev.apiKey) throw new Error('jev.apiKey is empty')
  if (config.llm && (!config.llm.baseURL || !config.llm.apiKey || !config.llm.model)) {
    throw new Error('llm needs baseURL, apiKey and model')
  }
  const providers: Provider[] = [
    ...(config.jev ? [jevProvider(config.jev)] : []),
    ...(config.llm ? [llmProvider(config.llm)] : []),
    ...(config.providers ?? []),
  ]
  const policy: Policy = { retries: config.retries ?? 2, retryDelayMs: config.retryDelayMs ?? 500 }
  if (!Number.isInteger(policy.retries) || policy.retries < 0 || !Number.isFinite(policy.retryDelayMs) || policy.retryDelayMs < 0) {
    throw new Error('retries must be a non-negative integer; retryDelayMs must be finite and non-negative')
  }

  async function judge(options: JudgeOptions | JudgeManyOptions) {
    const many = 'statements' in options
    const statements = many ? options.statements : { statement: options.statement }
    const issues = checkInput(options.input)
    if (!isObject(statements) || Object.keys(statements).length === 0) {
      issues.push({ code: 'invalid_input', message: 'statements must be a non-empty object' })
    } else if (Object.entries(statements).some(([key, s]) => !key.trim() || typeof s !== 'string' || s.trim() === '')) {
      issues.push({ code: 'invalid_input', message: 'every statement must be non-empty text' })
    }
    if (issues.length > 0) return failed(issues)
    const result = await run(
      { operation: 'judge', input: options.input, statements, requireEvidence: options.requireEvidence ?? false },
      providers,
      policy,
    )
    const verdicts = result.data as Verdicts | null
    const data = verdicts === null ? null : many ? { holds: verdicts } : { holds: verdicts.statement ?? null }
    return { ...result, data }
  }

  return {
    async classify(options) {
      const issues = [...checkInput(options.input), ...checkCategories(options.categories)]
      if (options.mode !== undefined && options.mode !== 'single' && options.mode !== 'multi') {
        issues.push({ code: 'invalid_input', message: 'mode must be single or multi' })
      }
      if (issues.length > 0) return failed(issues)
      const request = {
        operation: 'classify' as const,
        input: options.input,
        instruction: options.instruction,
        categories: options.categories,
        mode: options.mode ?? 'single',
        requireEvidence: options.requireEvidence ?? false,
      }
      return (await run(request, providers, policy)) as Result<ClassifyData>
    },

    async extract<S extends ZodType>(options: ExtractOptions<S>) {
      const issues = checkInput(options.input)
      let jsonSchema: Record<string, unknown> = {}
      try {
        jsonSchema = z.toJSONSchema(options.schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>
      } catch (error) {
        issues.push({ code: 'invalid_input', message: `schema cannot be converted to JSON Schema: ${String(error)}` })
      }
      if (issues.length > 0) return failed(issues)
      const request = {
        operation: 'extract' as const,
        input: options.input,
        instruction: options.instruction,
        schema: options.schema,
        jsonSchema,
        requireEvidence: options.requireEvidence ?? false,
      }
      return (await run(request, providers, policy)) as Result<z.output<S>>
    },

    judge: judge as AI['judge'],
  }
}
