export type ReadingItem = {
  ref: string
  kind: "title" | "heading" | "control"
  level?: number
  text?: string
  tag?: string
  role?: string
  inputType?: string
  name?: string
  disabled?: boolean
  placeholder?: string
}

export type ReadingIssue = {
  ref: string
  kind: "skipped-heading" | "missing-name"
  detail: string
}

export type ReadingTree = {
  sourceKind: "html" | "markdown"
  title: string
  items: ReadingItem[]
  issues: ReadingIssue[]
}

export type FollowStep = {
  index: number
  text: string
  status: "done" | "stuck"
  because: string
  refs: string[]
}

export type FirstBreak = {
  kind: "step" | "heading" | "control" | "none"
  title: string
  detail: string
  stepIndex: number | null
  stepText: string | null
  refs: string[]
}

export type Rewrite = {
  text: string
  from: "model" | "guardrail" | "tree"
  draft: string | null
  held: string[]
}

export type AttemptView = {
  steps: FollowStep[]
  stoppedBecause: string
  noteFrom: "model" | "guardrail" | "tree"
}

export type ReadingView = {
  sourceKind: "html" | "markdown"
  title: string
  items: ReadingItem[]
  issues: ReadingIssue[]
  prose: string
  proseFrom: "model" | "guardrail" | "tree"
  parser: "otari-code-execution" | "local-python"
  note: string | null
}

export type BudgetSnapshot = {
  remainingUsd: number | null
  budgetsEnforced: boolean | null
  limits: unknown
  error?: string
}

export type ToolStatus = "not-requested" | "local-fixture" | "completed" | "failed" | "skipped-fetch"

export type OtariCallRecord = {
  endpoint: string
  role: string
  model: string | null
  status: number
  requestId: string | null
  servedModel: string | null
  provider: string | null
  otariFallback: boolean | null
  attemptCount: string | null
  costUsd: string | null
  error: string | null
  code: string | null
}

export type ModelTrace = {
  requested: string
  fallback: string
  served: string | null
  clientFallback: boolean
  otariFallback: boolean | null
  requestId: string | null
}

export type OtariTrace = {
  configured: boolean
  baseUrl: string
  calls: OtariCallRecord[]
  models: { narrator: ModelTrace; attempt: ModelTrace }
  fetch: { status: ToolStatus; detail: string; url?: string; requestId: string | null }
  search: { status: ToolStatus; detail: string; query?: string; requestId: string | null }
  codeExecution: {
    status: "not-requested" | "completed" | "failed"
    detail: string
    requestId: string | null
    parser: "otari-code-execution" | "local-python" | "none"
  }
  guardrails: {
    profile: string
    mode: string
    onUnavailable: string
    header: string | null
    appRules: string[]
    held: string[]
  }
  budget: {
    before: BudgetSnapshot | null
    after: BudgetSnapshot | null
    sessionSpentUsd: number
    sessionCalls: number
    sessionCeilingUsd: number
    endUser: unknown | null
    endUserMode: string
  }
  mcp: {
    status: "not-configured" | "declared" | "called" | "refused"
    detail: string
    calls: { server?: string; name?: string; status?: string; output?: string }[]
  }
}

export type CheckResponse = {
  ok: boolean
  error?: string
  sessionId: string
  readingOrder: ReadingView | null
  attempt: AttemptView | null
  firstBreak: FirstBreak | null
  rewrite: Rewrite | null
  otari: OtariTrace
}

export const APP_RULES = [
  "Do not add steps that were not in the how-to.",
  "Do not invent control names that are not in the parsed tree.",
  "Do not claim an accessibility problem that is not in the tree.",
  "Do not fetch a site the steps did not name.",
]
