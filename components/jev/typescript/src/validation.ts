import type { Category, ClassifyData, Evidence, Input, Issue, Part, ProviderResult, Request, Status, Verdicts } from './types.js'
import { isObject } from './providers/http.js'

// 代码能确定的检查都在这里：输入、格式、类别、字段、原文引用是否存在。
// 原文是否真正支持结论属于语义判断，不在这里做。

export type Settled = { status: Status; data: unknown; evidence: Evidence[]; issues: Issue[] }

const invalid = (message: string): Issue => ({ code: 'invalid_input', message })

// ---- 输入检查 ----

export function checkInput(input: Input): Issue[] {
  if (!isObject(input) || !Array.isArray(input.parts) || input.parts.length === 0) {
    return [invalid('input.parts must be a non-empty array')]
  }
  const issues: Issue[] = []
  const seen = new Set<string>()
  for (const [index, part] of input.parts.entries()) {
    if (!isObject(part) || typeof part.id !== 'string' || part.id.trim() === '') {
      issues.push(invalid(`part ${index} has no id`))
      continue
    }
    if (seen.has(part.id)) issues.push(invalid(`duplicate part id "${part.id}"`))
    seen.add(part.id)
    if (typeof part.content !== 'string' && !isObject(part.content)) {
      issues.push(invalid(`part "${part.id}" content must be a string or an object`))
    }
  }
  if (issues.length === 0) {
    try {
      if (input.parts.every((p) => text(p.content) === '')) issues.push(invalid('all parts are empty'))
      JSON.stringify(input, (_key, value: unknown) => {
        if ((typeof value === 'number' && !Number.isFinite(value))
          || ['undefined', 'function', 'symbol', 'bigint'].includes(typeof value)) throw new Error('not JSON')
        return value
      })
    } catch {
      issues.push(invalid('input must be JSON serializable'))
    }
  }
  return issues
}

export function checkCategories(categories: Category[]): Issue[] {
  if (!Array.isArray(categories) || categories.length === 0) return [invalid('categories must be a non-empty array')]
  const ids = categories.map((c) => (isObject(c) ? c.id : undefined))
  if (ids.some((id) => typeof id !== 'string' || id.trim() === '')) return [invalid('every category needs an id')]
  if (categories.some((c) => typeof c.description !== 'string' || c.description.trim() === '')) return [invalid('every category needs a description')]
  const duplicate = ids.find((id, i) => ids.indexOf(id) !== i)
  return duplicate ? [invalid(`duplicate category id "${duplicate}"`)] : []
}

// ---- 结果检查 ----

export function settle(request: Request, result: ProviderResult): Settled {
  const checked = checkData(request, result.data)
  if ('errors' in checked) {
    const issues = checked.errors.map((message): Issue => ({ code: 'invalid_output', message }))
    return { status: 'failed', data: null, evidence: [], issues }
  }
  const targets = conclusionTargets(request, checked.data)
  const { kept, issues: evidenceIssues } = checkEvidence(request.input, result.evidence ?? [], new Set(targets))
  const issues = [...(result.issues ?? []), ...checked.review, ...evidenceIssues]
  const covered = new Set(kept.map((item) => item.target))
  const missing = targets.filter((target) => !covered.has(target))
  if (request.requireEvidence && missing.length > 0) {
    issues.push({ code: 'missing_evidence', message: `no quote from the input for: ${missing.join(', ')}` })
  }
  return { status: issues.length > 0 ? 'needs_review' : 'ok', data: checked.data, evidence: kept, issues }
}

type Checked = { errors: string[] } | { data: unknown; review: Issue[] }

function checkData(request: Request, data: unknown): Checked {
  if (request.operation === 'extract') {
    const parsed = request.schema.safeParse(data)
    if (parsed.success) return { data: parsed.data, review: [] }
    return { errors: parsed.error.issues.map((i) => `schema: ${i.path.join('.') || '(root)'}: ${i.message}`) }
  }

  if (request.operation === 'judge') {
    if (!isObject(data)) return { errors: ['verdicts must be an object'] }
    const verdicts: Verdicts = Object.fromEntries(Object.keys(request.statements).map((key) => [key, null]))
    const review: Issue[] = []
    for (const [key, statement] of Object.entries(request.statements)) {
      const value = Object.hasOwn(data, key) ? data[key] : undefined
      if (value !== true && value !== false && value !== null) return { errors: [`verdict "${key}" must be true, false or null`] }
      verdicts[key] = value
      if (value === null) review.push({ code: 'undetermined', message: `material is not enough to decide: ${statement}` })
    }
    return { data: verdicts, review }
  }

  if (!isObject(data) || !Array.isArray(data.categories) || !data.categories.every((c) => typeof c === 'string')) {
    return { errors: ['classification must contain a list of category ids'] }
  }
  if (typeof data.undetermined !== 'boolean') return { errors: ['classification undetermined must be a boolean'] }
  const known = new Set(request.categories.map((c) => c.id))
  const categories = [...new Set(data.categories as string[])]
  const unknown = categories.filter((c) => !known.has(c))
  if (unknown.length > 0) return { errors: unknown.map((c) => `unknown category "${c}"`) }
  if (request.mode === 'single' && categories.length > 1) return { errors: [`single mode returned ${categories.length} categories`] }
  // 单选时什么都没选，等同于无法确定；多选时允许“都不适用”
  const undetermined = data.undetermined === true || (request.mode === 'single' && categories.length === 0)
  const review: Issue[] = undetermined ? [{ code: 'undetermined', message: 'material is not enough to classify' }] : []
  return { data: { categories, undetermined } satisfies ClassifyData, review }
}

// 引用指向实际结论；嵌套字段和数组元素使用点路径，例如 items.0.name。
function conclusionTargets(request: Request, data: unknown): string[] {
  if (request.operation === 'classify') return (data as ClassifyData).categories
  if (request.operation === 'judge') return Object.keys(data as Verdicts).filter((key) => (data as Verdicts)[key] !== null)
  function leaves(value: unknown, path: string): string[] {
    if (value === null || value === undefined) return []
    if (Array.isArray(value) || isObject(value)) {
      return Object.entries(value).flatMap(([key, item]) => leaves(item, path ? `${path}.${key}` : key))
    }
    return [path]
  }
  return leaves(data, '')
}

// ---- 原文引用 ----

function checkEvidence(input: Input, evidence: Evidence[], targets: Set<string>) {
  const parts = new Map(input.parts.map((p) => [p.id, text(p.content)]))
  const kept: Evidence[] = []
  const issues: Issue[] = []
  for (const item of evidence) {
    if (!isObject(item) || typeof item.target !== 'string' || typeof item.sourceId !== 'string' || typeof item.quote !== 'string') {
      issues.push({ code: 'bad_evidence', message: 'malformed evidence item dropped' })
      continue
    }
    const source = parts.get(item.sourceId)
    const quote = normalize(item.quote)
    if (!targets.has(item.target)) issues.push({ code: 'bad_evidence', message: `evidence cites unknown or empty target "${item.target}"` })
    else if (source === undefined) issues.push({ code: 'bad_evidence', message: `evidence for "${item.target}" cites unknown part "${item.sourceId}"` })
    else if (quote === '' || !source.includes(quote)) issues.push({ code: 'bad_evidence', message: `quote for "${item.target}" not found in part "${item.sourceId}"` })
    else kept.push({ target: item.target, sourceId: item.sourceId, quote: item.quote })
  }
  return { kept, issues }
}

// 与语言模型看到的资料一致，保留大小写、标点和数字符号。
function text(content: Part['content']): string {
  return normalize(typeof content === 'string' ? content : JSON.stringify(content, null, 2))
}

function normalize(value: string): string {
  return value.normalize('NFC')
    .replace(/[！-～]/gu, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/\s+/gu, ' ').trim()
}
