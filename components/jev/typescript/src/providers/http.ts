import type { Fetch } from '../types.js'

// transient = 暂时性故障（超时、限流、过载），runner 只对它做有限重试。
// 其他错误直接交给下一个提供方。
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly transient: boolean,
    readonly retryAfterMs?: number,
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}

export async function postJSON(
  fetchFn: Fetch,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
): Promise<unknown> {
  let status: number
  let text: string
  let retryAfter: string | null
  try {
    const response = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
    status = response.status
    retryAfter = response.headers.get('retry-after')
    text = await response.text()
  } catch (error) {
    throw new ProviderError(`request failed: ${error instanceof Error ? error.message : String(error)}`, true)
  }
  if (status < 200 || status >= 300) {
    const transient = status === 408 || status === 429 || status >= 500
    const seconds = retryAfter === null ? NaN : Number(retryAfter)
    const retryAfterMs = Number.isFinite(seconds) ? Math.max(0, seconds * 1000)
      : retryAfter === null ? NaN : Math.max(0, Date.parse(retryAfter) - Date.now())
    throw new ProviderError(
      `HTTP ${status}: ${text.slice(0, 300)}`,
      transient,
      Number.isFinite(retryAfterMs) ? retryAfterMs : undefined,
    )
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new ProviderError(`response is not JSON: ${text.slice(0, 200)}`, false)
  }
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
