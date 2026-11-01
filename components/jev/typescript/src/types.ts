import type { ZodType } from 'zod'

export type Operation = 'classify' | 'extract' | 'judge'

// ---- 输入 ----

export type Part = { id: string; content: string | Record<string, unknown> }
export type Input = { parts: Part[] }
export type Category = { id: string; description: string }

// ---- 结果 ----

export type Status = 'ok' | 'needs_review' | 'failed'

export type Evidence = {
  target: string // 类别、判断语句的键或非 null 叶子字段的点路径，例如 items.0.name
  sourceId: string // 对应输入 part.id
  quote: string // 输入资料中的原文
}

export type IssueCode =
  | 'invalid_input' // 输入或参数不合法
  | 'no_provider' // 没有能处理该请求的提供方
  | 'provider_error' // 调用失败（已按需重试）
  | 'invalid_output' // 返回的格式、类别或字段不合法
  | 'low_confidence' // 提供方置信度低
  | 'undetermined' // 资料不足以得出结论
  | 'bad_evidence' // 引用的来源或原文在输入中找不到
  | 'missing_evidence' // 要求引用，但没有有效引用
  | 'conflict' // 提供方之间结论不一致

export type Issue = { code: IssueCode; message: string; provider?: string }

export type Result<T> = {
  status: Status
  data: T | null
  evidence: Evidence[]
  issues: Issue[]
  meta: {
    provider: string
    model: string
    fallbackUsed: boolean
    raw?: unknown // 提供方原始概率等，只作记录，不代表正确率
  }
}

// ---- 三个方法 ----

type Common = {
  input: Input
  // 每个明确结论都需有原文引用，否则 needs_review。Jev 不返回原文，开启后直接用语言模型。
  requireEvidence?: boolean
}

export type ClassifyOptions = Common & {
  instruction?: string
  categories: Category[]
  mode?: 'single' | 'multi'
}

export type ClassifyData = {
  categories: string[]
  undetermined: boolean // 资料不足以确定
}

export type ExtractOptions<S extends ZodType> = Common & {
  instruction?: string
  schema: S // 未提及的字段要允许 null，例如 z.string().nullable()
}

export type Verdicts = Record<string, boolean | null> // null 表示资料不足以判断

export type JudgeOptions = Common & { statement: string }
export type JudgeData = { holds: boolean | null }

// 一次判断多句，资料只发送一次
export type JudgeManyOptions = Common & { statements: Record<string, string> }
export type JudgeManyData = { holds: Verdicts }

// ---- 提供方接口（适配层只做协议转换）----

export type Request =
  | {
      operation: 'classify'
      input: Input
      instruction?: string
      categories: Category[]
      mode: 'single' | 'multi'
      requireEvidence: boolean
    }
  | {
      operation: 'extract'
      input: Input
      instruction?: string
      schema: ZodType
      jsonSchema: Record<string, unknown>
      requireEvidence: boolean
    }
  | {
      operation: 'judge'
      input: Input
      statements: Record<string, string>
      requireEvidence: boolean
    }

// data 按操作区分：classify → ClassifyData，extract → 符合 schema 的对象，judge → Verdicts。
// 适配器只负责转换，内容由 runner 统一校验。
export type ProviderResult = {
  model: string
  data: unknown
  evidence?: Evidence[]
  issues?: Issue[] // 提供方自己发现的问题，例如置信度低
  raw?: unknown
}

export interface Provider {
  readonly name: string
  supports(request: Request): boolean
  run(request: Request): Promise<ProviderResult>
}

// ---- 配置 ----

export type Fetch = typeof fetch

export type JevConfig = {
  apiKey: string
  url?: string // 完整接口地址，默认 https://api.typesafe.ai/v1/systemone；用中转时填中转地址
  model?: string // 默认 jev-latest
  minConfidence?: number // Choice 置信度低于此值时 needs_review，默认 0.5
  noulYes?: number // 多标签：概率 ≥ 此值算选中，默认 0.7
  noulNo?: number // 多标签：概率 ≤ 此值算不选，默认 0.3
  timeoutMs?: number
  fetch?: Fetch
}

export type LlmConfig = {
  baseURL: string // OpenAI 兼容接口，例如 https://api.openai.com/v1
  apiKey: string
  model: string
  temperature?: number
  jsonMode?: boolean // 是否发送 response_format: json_object，默认 true
  timeoutMs?: number
  fetch?: Fetch
}

export type AIConfig = {
  jev?: JevConfig
  llm?: LlmConfig
  // 额外的适配器，排在 jev、llm 之后作为备用。需要其他顺序时不传 jev/llm，
  // 直接传 [rules, jevProvider(...), llmProvider(...)]
  providers?: Provider[]
  retries?: number // 暂时性故障的重试次数，默认 2
  retryDelayMs?: number // 首次重试等待，之后指数增长，默认 500
}
