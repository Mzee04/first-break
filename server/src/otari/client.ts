import { randomUUID } from "node:crypto"
import { attemptSelector, narratorSelector, type AppConfig } from "../config.js"
import type { BudgetSnapshot } from "../types.js"
import { publicHttpsUrl } from "../urls.js"

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

const RETRYABLE = new Set([408, 424, 429, 500, 502, 503, 504])

export type CallMeta = {
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
  guardrails: string | null
  endUserBudget: string | null
  error: string | null
  code: string | null
}

export type McpCall = { server?: string; name?: string; status?: string; output?: string }

export class OtariError extends Error {
  readonly status: number
  readonly code: string | null
  readonly detail: string
  readonly retryable: boolean
  readonly call: CallMeta

  constructor(detail: string, status: number, code: string | null, retryable: boolean, call: CallMeta) {
    super(detail)
    this.name = "OtariError"
    this.status = status
    this.code = code
    this.detail = detail
    this.retryable = retryable
    this.call = call
  }
}

export type ChatResult = {
  content: string
  call: CallMeta
  clientFallback: boolean
  toolCalls: McpCall[]
  mcpRefused: string | null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null
}

export class OtariClient {
  userFieldAccepted: boolean | null = null
  readonly calls: CallMeta[] = []

  constructor(
    readonly config: AppConfig,
    private readonly fetchImpl: FetchLike,
  ) {}

  sendUser(): boolean {
    if (!this.config.apiKey) return false
    if (this.config.serviceKey === "false") return false
    if (this.config.serviceKey === "true") return true
    return this.userFieldAccepted !== false
  }

  private scrub(text: string): string {
    const key = this.config.apiKey
    const clean = text.replace(/\s+/g, " ").trim().slice(0, 500)
    return key ? clean.split(key).join("[redacted]") : clean
  }

  private detailOf(json: unknown, text: string): string {
    const record = asRecord(json)
    if (record) {
      if (typeof record.detail === "string") return this.scrub(record.detail)
      if (Array.isArray(record.detail)) return this.scrub(JSON.stringify(record.detail))
      const error = asRecord(record.error)
      if (error && typeof error.message === "string") return this.scrub(error.message)
    }
    return this.scrub(text || "Otari returned an empty error.")
  }

  private finishCall(response: Response, json: unknown, role: string, model: string | null, endpoint: string, error: string | null, code: string | null): CallMeta {
    const usage = asRecord(asRecord(json)?.usage)
    const call: CallMeta = {
      endpoint,
      role,
      model,
      status: response.status,
      requestId: response.headers.get("otari-request-id"),
      servedModel: response.headers.get("otari-model"),
      provider: response.headers.get("otari-provider"),
      otariFallback: response.headers.get("otari-fallback") === null ? null : response.headers.get("otari-fallback") === "true",
      attemptCount: response.headers.get("otari-attempt-count"),
      costUsd: typeof usage?.cost_usd === "string" ? usage.cost_usd : null,
      guardrails: response.headers.get("otari-guardrails"),
      endUserBudget: response.headers.get("otari-end-user-budget"),
      error,
      code: code || response.headers.get("otari-error-code"),
    }
    this.calls.push(call)
    return call
  }

  async request(method: string, path: string, body: unknown, role: string, model: string | null, sessionUser: string | null): Promise<{ json: unknown; call: CallMeta }> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.apiKey ?? ""}`,
      Accept: "application/json",
    }
    let payload = body
    const includeUser = Boolean(sessionUser) && this.sendUser()
    if (payload && includeUser && sessionUser) {
      payload = { ...(payload as object), user: sessionUser }
      if (this.config.endUserBudgetId) headers["Otari-End-User-Budget"] = this.config.endUserBudgetId
    }
    if (method !== "GET") {
      headers["Content-Type"] = "application/json"
      headers["Idempotency-Key"] = randomUUID()
    }
    const response = await this.fetchImpl(`${this.config.otariBaseUrl}${path}`, {
      method,
      headers,
      body: method === "GET" ? undefined : JSON.stringify(payload),
    })
    const text = await response.text()
    let json: unknown = null
    if (text) {
      try {
        json = JSON.parse(text) as unknown
      } catch {
        json = null
      }
    }
    if (!response.ok) {
      const detail = this.detailOf(json, text)
      const code = asRecord(json) && typeof asRecord(json)?.code === "string" ? String(asRecord(json)?.code) : response.headers.get("otari-error-code")
      const call = this.finishCall(response, json, role, model, `${method} ${path}`, detail, code)
      const mismatch = response.status === 403 && /does not match/i.test(detail) && /user/i.test(detail)
      if (mismatch && includeUser && this.config.serviceKey === "auto") {
        this.userFieldAccepted = false
        return this.request(method, path, body, role, model, null)
      }
      throw new OtariError(detail, response.status, code, RETRYABLE.has(response.status), call)
    }
    if (includeUser) this.userFieldAccepted = true
    const call = this.finishCall(response, json, role, model, `${method} ${path}`, null, null)
    return { json, call }
  }

  private messageContent(json: unknown): string {
    const choice = asRecord(json)?.choices
    const first = Array.isArray(choice) ? asRecord(choice[0]) : null
    const message = asRecord(first?.message)
    if (typeof message?.content === "string") return message.content
    if (Array.isArray(message?.content)) {
      return message.content
        .map((part) => (asRecord(part) && typeof asRecord(part)?.text === "string" ? String(asRecord(part)?.text) : ""))
        .join("")
    }
    return ""
  }

  private mcpCalls(json: unknown): McpCall[] {
    const calls = asRecord(json)?.otari_tool_calls
    if (!Array.isArray(calls)) return []
    return calls
      .map((call) => asRecord(call))
      .filter((call): call is Record<string, unknown> => Boolean(call) && call?.type === "mcp")
      .map((call) => ({
        server: typeof call.server === "string" ? call.server : undefined,
        name: typeof call.name === "string" ? call.name : undefined,
        status: typeof call.status === "string" ? call.status : undefined,
        output: typeof call.output === "string" ? call.output.slice(0, 500) : undefined,
      }))
  }

  private async postChat(model: string, messages: { role: string; content: string }[], sessionId: string, maxTokens: number, withMcp: boolean, role: "narrate" | "attempt"): Promise<Omit<ChatResult, "clientFallback" | "mcpRefused">> {
    const body: Record<string, unknown> = {
      model,
      messages,
      temperature: 0.2,
      max_tokens: maxTokens,
      metadata: { feature: "first-break", role, end_user: sessionId },
      guardrails: [
        {
          profile: this.config.guardrailProfile,
          mode: this.config.guardrailMode,
          on_unavailable: this.config.guardrailOnUnavailable,
        },
      ],
    }
    if (withMcp && this.config.mcpServerUrl) {
      const server: Record<string, unknown> = {
        name: this.config.mcpServerName,
        url: this.config.mcpServerUrl,
        purpose_hint: this.config.mcpPurpose,
      }
      if (this.config.mcpAllowedTools?.length) server.allowed_tools = this.config.mcpAllowedTools
      body.mcp_servers = [server]
    }
    const result = await this.request("POST", "/chat/completions", body, role, model, sessionId)
    return { content: this.messageContent(result.json), call: result.call, toolCalls: this.mcpCalls(result.json) }
  }

  async chat(role: "narrate" | "attempt", messages: { role: string; content: string }[], sessionId: string, mcp: boolean): Promise<ChatResult> {
    const primary = role === "narrate" ? narratorSelector(this.config) : attemptSelector(this.config)
    const fallback = role === "narrate" ? this.config.narratorFallback : this.config.attemptFallback
    const maxTokens = role === "narrate" ? this.config.maxTokensNarrate : this.config.maxTokensAttempt
    let useMcp = mcp && publicHttpsUrl(this.config.mcpServerUrl) !== null
    try {
      const first = await this.postChat(primary, messages, sessionId, maxTokens, useMcp, role)
      return { ...first, clientFallback: false, mcpRefused: null }
    } catch (error) {
      if (useMcp && error instanceof OtariError && (error.status === 400 || error.status === 403) && /mcp/i.test(error.detail)) {
        try {
          const again = await this.postChat(primary, messages, sessionId, maxTokens, false, role)
          return { ...again, clientFallback: false, mcpRefused: error.detail }
        } catch (retry) {
          if (retry instanceof OtariError && retry.retryable) {
            const second = await this.postChat(fallback, messages, sessionId, maxTokens, false, role)
            return { ...second, clientFallback: true, mcpRefused: error.detail }
          }
          throw retry
        }
      }
      if (error instanceof OtariError && error.retryable) {
        const second = await this.postChat(fallback, messages, sessionId, maxTokens, false, role)
        return { ...second, clientFallback: true, mcpRefused: null }
      }
      throw error
    }
  }

  async execute(code: string): Promise<{ stdout: string; stderr: string; returnCode: number; call: CallMeta }> {
    const result = await this.request("POST", "/code/execute", { code, timeout_seconds: 20 }, "parse", null, null)
    const body = asRecord(result.json)
    return {
      stdout: typeof body?.stdout === "string" ? body.stdout : "",
      stderr: typeof body?.stderr === "string" ? body.stderr : "",
      returnCode: typeof body?.return_code === "number" ? body.return_code : 1,
      call: result.call,
    }
  }

  async fetchPage(url: string): Promise<{ text: string; title: string; finalUrl: string; tool: string; call: CallMeta }> {
    const result = await this.request(
      "POST",
      "/fetch",
      { url, max_chars: 100_000, fetch_tool_name: "builtin_fetch" },
      "fetch",
      null,
      null,
    )
    const body = asRecord(result.json)
    return {
      text: typeof body?.text === "string" ? body.text : "",
      title: typeof body?.title === "string" ? body.title : "",
      finalUrl: typeof body?.final_url === "string" ? body.final_url : url,
      tool: typeof body?.fetch_tool === "string" ? body.fetch_tool : "builtin_fetch",
      call: result.call,
    }
  }

  async search(query: string, domains: string[], sessionId: string): Promise<{ results: { url: string; title: string; snippet: string }[]; call: CallMeta }> {
    const body: Record<string, unknown> = { query: query.slice(0, 200), max_results: 5 }
    if (domains.length > 0) body.search_domain_filter = domains
    const result = await this.request("POST", "/search", body, "search", null, sessionId)
    const results = asRecord(result.json)?.results
    const parsed = Array.isArray(results)
      ? results.map((item) => {
          const row = asRecord(item)
          return {
            url: typeof row?.url === "string" ? row.url : "",
            title: typeof row?.title === "string" ? row.title : "",
            snippet: typeof row?.snippet === "string" ? row.snippet : "",
          }
        }).filter((item) => item.url)
      : []
    return { results: parsed, call: result.call }
  }

  async keyBudget(): Promise<BudgetSnapshot> {
    try {
      const result = await this.request("GET", "/key/budget", undefined, "budget", null, null)
      const body = asRecord(result.json)
      return {
        remainingUsd: typeof body?.remaining_usd === "number" ? body.remaining_usd : null,
        budgetsEnforced: typeof body?.budgets_enforced === "boolean" ? body.budgets_enforced : null,
        limits: body?.limits ?? [],
      }
    } catch (error) {
      return {
        remainingUsd: null,
        budgetsEnforced: null,
        limits: [],
        error: error instanceof Error ? error.message : "Budget could not be read.",
      }
    }
  }

  async endUser(sessionId: string): Promise<unknown | null> {
    if (this.userFieldAccepted !== true) return null
    try {
      const result = await this.request("GET", `/end-users?external_id=${encodeURIComponent(sessionId)}`, undefined, "end-user", null, null)
      return result.json
    } catch (error) {
      return { error: error instanceof Error ? error.message : "End user could not be read." }
    }
  }
}

export function createOtariClient(config: AppConfig, fetchImpl: FetchLike = fetch): OtariClient | null {
  if (!config.apiKey) return null
  return new OtariClient(config, fetchImpl)
}
