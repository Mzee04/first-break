export type ServiceKeyMode = "auto" | "true" | "false"
export type GuardrailMode = "monitor" | "block"

export type AppConfig = {
  port: number
  otariBaseUrl: string
  apiKey: string | null
  narratorModel: string
  narratorFallback: string
  attemptModel: string
  attemptFallback: string
  narratorPolicy: string | null
  attemptPolicy: string | null
  serviceKey: ServiceKeyMode
  endUserBudgetId: string | null
  guardrailProfile: string
  guardrailMode: GuardrailMode
  guardrailOnUnavailable: GuardrailMode
  sessionBudgetUsd: number
  mcpServerUrl: string | null
  mcpServerName: string
  mcpAllowedTools: string[] | null
  mcpPurpose: string
  maxTokensNarrate: number
  maxTokensAttempt: number
}

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function mode(value: string | undefined, fallback: GuardrailMode): GuardrailMode {
  return value === "block" || value === "monitor" ? value : fallback
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const service = clean(env.OTARI_SERVICE_KEY)?.toLowerCase()
  const serviceKey: ServiceKeyMode = service === "true" || service === "false" ? service : "auto"
  const tools = clean(env.OTARI_MCP_ALLOWED_TOOLS)
  return {
    port: Number(env.PORT || env.SERVER_PORT || 43124),
    otariBaseUrl: (clean(env.OTARI_BASE_URL) || "https://api.otari.ai/api/v1").replace(/\/$/, ""),
    apiKey: clean(env.OTARI_API_KEY),
    narratorModel: clean(env.OTARI_NARRATOR_MODEL) || "alibaba/qwen3-32b",
    narratorFallback: clean(env.OTARI_NARRATOR_FALLBACK) || "google/gemma-3-27b-it",
    attemptModel: clean(env.OTARI_ATTEMPT_MODEL) || "meta/llama-3.3-70b-instruct",
    attemptFallback: clean(env.OTARI_ATTEMPT_FALLBACK) || "mistral/mistral-small-3.2-24b-instruct",
    narratorPolicy: clean(env.OTARI_NARRATOR_POLICY),
    attemptPolicy: clean(env.OTARI_ATTEMPT_POLICY),
    serviceKey,
    endUserBudgetId: clean(env.OTARI_END_USER_BUDGET_ID),
    guardrailProfile: clean(env.OTARI_GUARDRAIL_PROFILE) || "prompt-injection",
    guardrailMode: mode(clean(env.OTARI_GUARDRAIL_MODE) ?? undefined, "monitor"),
    guardrailOnUnavailable: mode(clean(env.OTARI_GUARDRAIL_ON_UNAVAILABLE) ?? undefined, "monitor"),
    sessionBudgetUsd: Number(env.FIRST_BREAK_SESSION_USD || 1),
    mcpServerUrl: clean(env.OTARI_MCP_SERVER_URL),
    mcpServerName: clean(env.OTARI_MCP_SERVER_NAME) || "first-break-hints",
    mcpAllowedTools: tools ? tools.split(",").map((tool) => tool.trim()).filter(Boolean) : null,
    mcpPurpose:
      clean(env.OTARI_MCP_PURPOSE) ||
      "Look up a short plain-language note for a reading-order break. Do not invent control names.",
    maxTokensNarrate: Number(env.OTARI_NARRATOR_MAX_TOKENS || 500),
    maxTokensAttempt: Number(env.OTARI_ATTEMPT_MAX_TOKENS || 700),
  }
}

export function narratorSelector(config: AppConfig): string {
  return config.narratorPolicy || config.narratorModel
}

export function attemptSelector(config: AppConfig): string {
  return config.attemptPolicy || config.attemptModel
}
