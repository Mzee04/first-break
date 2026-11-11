export type ReadingItem = {
  ref: string
  kind: "title" | "heading" | "control"
  level?: number
  text?: string
  tag?: string
  role?: string
  inputType?: string
  name?: string
}

export type ReadingIssue = {
  ref: string
  kind: "skipped-heading" | "missing-name"
  detail: string
}

export type FollowStep = {
  index: number
  text: string
  status: "done" | "stuck"
  because: string
  refs: string[]
}

export type CheckResponse = {
  ok: boolean
  error?: string
  sessionId: string
  readingOrder: null | {
    sourceKind: "html" | "markdown"
    title: string
    items: ReadingItem[]
    issues: ReadingIssue[]
    prose: string
    proseFrom: "model" | "guardrail" | "tree"
    parser: "otari-code-execution" | "local-python"
    note: string | null
  }
  attempt: null | {
    steps: FollowStep[]
    stoppedBecause: string
    noteFrom: "model" | "guardrail" | "tree"
  }
  firstBreak: null | {
    kind: "step" | "heading" | "control" | "none"
    title: string
    detail: string
    stepIndex: number | null
    stepText: string | null
    refs: string[]
  }
  rewrite: null | {
    text: string
    from: "model" | "guardrail" | "tree"
    draft: string | null
    held: string[]
  }
  otari: {
    configured: boolean
    baseUrl: string
    models: {
      narrator: ModelTrace
      attempt: ModelTrace
    }
    fetch: ToolNote
    search: ToolNote
    codeExecution: {
      status: string
      detail: string
      requestId: string | null
      parser: string
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
      before: { remainingUsd: number | null; error?: string } | null
      after: { remainingUsd: number | null; error?: string } | null
      sessionSpentUsd: number
      sessionCalls: number
      sessionCeilingUsd: number
      endUserMode: string
    }
    mcp: { status: string; detail: string }
  }
}

export type ModelTrace = {
  requested: string
  fallback: string
  served: string | null
  clientFallback: boolean
  otariFallback: boolean | null
  requestId: string | null
}

export type ToolNote = {
  status: string
  detail: string
  requestId: string | null
  url?: string
  query?: string
}

export type Health = {
  ok: boolean
  otariConfigured: boolean
  baseUrl: string
  models: {
    narrator: string
    narratorFallback: string
    attempt: string
    attemptFallback: string
  }
  guardrail: { profile: string; mode: string; onUnavailable: string }
  mcpConfigured: boolean
}
