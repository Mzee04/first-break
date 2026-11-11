import assert from "node:assert/strict"
import test from "node:test"
import { loadConfig } from "../src/config.js"
import { OtariError, createOtariClient, type FetchLike } from "../src/otari/client.js"

const KEY = "otk_test_key_not_real"

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } })
}

function client(fetchImpl: FetchLike, env: Record<string, string> = {}) {
  const config = loadConfig({
    OTARI_API_KEY: KEY,
    OTARI_BASE_URL: "https://api.otari.ai/api/v1",
    OTARI_SERVICE_KEY: "auto",
    ...env,
  })
  const created = createOtariClient(config, fetchImpl)
  assert.ok(created)
  return created
}

test("chat sends guardrails, metadata, and the open-weight model, and falls back after a provider failure", async () => {
  const seen: { url: string; body: Record<string, unknown>; auth: string }[] = []
  let attempt = 0
  const otari = client(async (url, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    seen.push({ url: String(url), body, auth: String((init?.headers as Record<string, string>).Authorization) })
    attempt += 1
    if (attempt === 1) return json(502, { detail: "The provider failed the request with HTTP 500", code: "provider_error" })
    return json(
      200,
      { choices: [{ message: { content: '{"prose":"In reading order."}' } }], usage: { cost_usd: "0.000100" } },
      { "Otari-Model": "gemma-3-27b-it", "Otari-Fallback": "false", "Otari-Request-ID": "req_recorded", "Otari-Guardrails": '[{"profile":"prompt-injection","status":"unavailable"}]' },
    )
  })
  const result = await otari.chat("narrate", [{ role: "user", content: "tree" }], "session-1", false)
  assert.equal(result.clientFallback, true)
  assert.equal(seen[0]?.body.model, "alibaba/qwen3-32b")
  assert.equal(seen[1]?.body.model, "google/gemma-3-27b-it")
  assert.equal(seen[0]?.auth, `Bearer ${KEY}`)
  assert.equal(JSON.stringify(seen[0]?.body).includes(KEY), false)
  const guardrails = seen[0]?.body.guardrails as { profile: string; mode: string }[]
  assert.equal(guardrails[0]?.profile, "prompt-injection")
  assert.equal(guardrails[0]?.mode, "monitor")
  const metadata = seen[0]?.body.metadata as { end_user: string; role: string }
  assert.equal(metadata.end_user, "session-1")
  assert.equal(metadata.role, "narrate")
  assert.equal(result.call.requestId, "req_recorded")
  assert.equal(result.call.costUsd, "0.000100")
  assert.match(result.call.guardrails ?? "", /prompt-injection/)
})

test("a service-key mismatch is retried without the user field", async () => {
  const users: unknown[] = []
  const otari = client(async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    users.push(body.user)
    if (body.user) return json(403, { detail: "'user' field does not match the authenticated API key's user" })
    return json(200, { choices: [{ message: { content: "{}" } }] })
  })
  await otari.chat("attempt", [{ role: "user", content: "steps" }], "person-7", false)
  assert.deepEqual(users, ["person-7", undefined])
  assert.equal(otari.userFieldAccepted, false)
})

test("fetch, search, and code execution use the documented endpoints", async () => {
  const calls: { url: string; body: Record<string, unknown> }[] = []
  const otari = client(async (url, init) => {
    calls.push({ url: String(url), body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {} })
    if (String(url).endsWith("/fetch")) {
      return json(200, { object: "fetch", fetch_tool: "builtin_fetch", text: "<h1>Hi</h1>", title: "Hi", final_url: "https://example.com" })
    }
    if (String(url).endsWith("/search")) {
      return json(200, { object: "search", results: [{ title: "Docs", url: "https://example.com/docs", snippet: "Docs" }] })
    }
    return json(200, { object: "code_execution.result", stdout: "{}\n", stderr: "", return_code: 0 })
  }, { OTARI_SERVICE_KEY: "false" })
  const fetched = await otari.fetchPage("https://example.com")
  const searched = await otari.search("example.com", ["example.com"], "session-1")
  const exec = await otari.execute("print(1)")
  assert.equal(fetched.tool, "builtin_fetch")
  assert.equal(calls[0]?.url, "https://api.otari.ai/api/v1/fetch")
  assert.equal(calls[0]?.body.fetch_tool_name, "builtin_fetch")
  assert.equal(calls[1]?.url, "https://api.otari.ai/api/v1/search")
  assert.deepEqual(calls[1]?.body.search_domain_filter, ["example.com"])
  assert.equal(calls[1]?.body.user, undefined)
  assert.equal(calls[2]?.url, "https://api.otari.ai/api/v1/code/execute")
  assert.equal(exec.returnCode, 0)
  assert.equal(searched.results[0]?.url, "https://example.com/docs")
})

test("errors do not echo the API key", async () => {
  const otari = client(async () => json(401, { detail: `bad key ${KEY}` }))
  await assert.rejects(
    () => otari.fetchPage("https://example.com"),
    (error: unknown) => {
      assert.ok(error instanceof OtariError)
      assert.equal(error.message.includes(KEY), false)
      assert.match(error.message, /redacted/)
      return true
    },
  )
})

test("key budget reads remaining dollars", async () => {
  const otari = client(async () => json(200, { budgets_enforced: true, remaining_usd: 0.42, limits: [] }))
  const budget = await otari.keyBudget()
  assert.equal(budget.remainingUsd, 0.42)
  assert.equal(budget.budgetsEnforced, true)
})
