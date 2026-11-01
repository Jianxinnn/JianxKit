import type { ClassifyData, Issue, Provider, Request, Result, Status } from './types.js'
import { isObject, ProviderError } from './providers/http.js'
import { settle, type Settled } from './validation.js'

// 固定流程：按顺序调用提供方 → 统一校验 → 必要时调用备用提供方 → 返回结果。
//
// - 调用报错（重试后仍失败）或结果校验不通过：换下一个提供方。
// - 结果 needs_review：记下作为候选，再问下一个提供方。
//   下一个给出 ok 且与候选一致，返回 ok；不一致，返回 needs_review 并说明冲突。
// - 全部失败：failed。

export type Policy = { retries: number; retryDelayMs: number }

type Outcome = { provider: Provider; index: number; model: string; settled: Settled; raw: unknown }

export async function run(request: Request, providers: Provider[], policy: Policy): Promise<Result<unknown>> {
  const route = providers.filter((p) => p.supports(request))
  if (route.length === 0) return failed([{ code: 'no_provider', message: `no provider can handle this ${request.operation} request` }])
  const notes: Issue[] = []
  const candidates: Outcome[] = []
  for (const [index, provider] of route.entries()) {
    let outcome: Outcome
    try {
      const result = await withRetry(() => provider.run(request), policy)
      outcome = { provider, index, model: result.model, settled: settle(request, result), raw: result.raw }
    } catch (error) {
      notes.push({ code: 'provider_error', message: error instanceof Error ? error.message : String(error), provider: provider.name })
      continue
    }
    const { status, issues, data } = outcome.settled
    const disagreement = status === 'failed' ? undefined : candidates.find((previous) => conflicts(request, previous.settled.data, data))
    if (disagreement) {
      notes.push({ code: 'conflict', message: `${disagreement.provider.name} and ${provider.name} disagree` })
    }
    if (status === 'ok') {
      return build(outcome, notes.some((issue) => issue.code === 'conflict') ? 'needs_review' : 'ok', notes)
    }
    notes.push(...issues.map((issue) => ({ ...issue, provider: provider.name })))
    if (status === 'needs_review') candidates.push(outcome)
  }
  if (candidates.length > 0) return build(candidates[0]!, 'needs_review', notes)
  return failed(notes, route.at(-1)!.name, route.length > 1)
}

async function withRetry<T>(fn: () => Promise<T>, policy: Policy): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (error) {
      if (!(error instanceof ProviderError) || !error.transient || attempt >= policy.retries) throw error
      // 服务端要求长时间等待时直接降级，不提前重试，也不阻塞当前调用。
      if (error.retryAfterMs !== undefined && error.retryAfterMs > 30_000) throw error
      const delay = error.retryAfterMs ?? policy.retryDelayMs * 2 ** attempt
      await new Promise((resolve) => setTimeout(resolve, Math.min(delay, 30_000)))
    }
  }
}

// 只有已明确的结论才参与比较；“无法确定”不算冲突
function conflicts(request: Request, a: unknown, b: unknown): boolean {
  if (request.operation === 'classify') {
    const x = a as ClassifyData
    const y = b as ClassifyData
    return (!y.undetermined && x.categories.some((id) => !y.categories.includes(id)))
      || (!x.undetermined && y.categories.some((id) => !x.categories.includes(id)))
  }
  return differs(a, b)
}

function differs(a: unknown, b: unknown): boolean {
  if (a === null || b === null) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length !== b.length || a.some((item, index) => differs(item, b[index]))
  }
  if (isObject(a) && isObject(b)) {
    return Object.keys(a).some((key) => Object.hasOwn(b, key) && differs(a[key], b[key]))
  }
  return a !== b
}

function build(outcome: Outcome, status: Status, issues: Issue[]): Result<unknown> {
  return {
    status,
    data: outcome.settled.data,
    evidence: outcome.settled.evidence,
    issues,
    meta: {
      provider: outcome.provider.name,
      model: outcome.model,
      fallbackUsed: outcome.index > 0,
      ...(outcome.raw === undefined ? {} : { raw: outcome.raw }),
    },
  }
}

export function failed(issues: Issue[], provider = '', fallbackUsed = false): Result<never> {
  return { status: 'failed', data: null, evidence: [], issues, meta: { provider, model: '', fallbackUsed } }
}
