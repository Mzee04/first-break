import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { loadConfig } from "../src/config.js"
import { FIXTURE_HOWTO, fixtureHtmlPath } from "../src/fixture.js"
import { runCheck } from "../src/loop.js"
import { createOtariClient, type FetchLike } from "../src/otari/client.js"
import { parseWithLocalPython } from "../src/parser/tree.js"
import { SessionLedger } from "../src/sessions.js"

const html = readFileSync(fixtureHtmlPath(), "utf8")
const tree = await parseWithLocalPython(html)

function harness(fetchImpl: FetchLike, env: Record<string, string> = {}) {
  const config = loadConfig({ OTARI_API_KEY: "otk_test_key_not_real", OTARI_SERVICE_KEY: "false", ...env })
  const otari = createOtariClient(config, fetchImpl)
  assert.ok(otari)
  return { config, otari, ledger: new SessionLedger(), parseLocal: async () => tree, loadFixture: () => html }
}

test("the fixture run uses code execution, not fetch, and stops at the first break", async () => {
  const calls: string[] = []
  const deps = harness(async (url, init) => {
    const path = new URL(String(url)).pathname
    calls.push(path)
    const body = init?.body ? (JSON.parse(String(init.body)) as { model?: string }) : {}
    if (path.endsWith("/key/budget")) return Response.json({ budgets_enforced: true, remaining_usd: 2, limits: [] })
    if (path.endsWith("/code/execute")) {
      return Response.json({ object: "code_execution.result", stdout: JSON.stringify(tree), stderr: "", return_code: 0 })
    }
    if (body.model?.includes("qwen") || body.model?.includes("gemma")) {
      return Response.json({
        choices: [{ message: { content: JSON.stringify({ prose: 'In reading order: a level 1 heading, “Saturday workshop”, then a level 3 heading, “What to bring”. The level jumps from 1 to 3. A button has no accessible name.' }) } }],
        usage: { cost_usd: "0.000200" },
      }, { headers: { "Otari-Model": "qwen3-32b", "Otari-Fallback": "false", "Otari-Guardrails": '[{"profile":"prompt-injection","status":"monitor","valid":true}]' } })
    }
    return Response.json({
      choices: [{ message: { content: JSON.stringify({ stuckIndex: 3, because: 'The step names “Reserve my seat”, and that name is not in the reading order.', rewrite: 'Nothing in the reading order is named “Reserve my seat”. button c2, type submit has no accessible name. Name that control for what it does, then use that name in this step.' }) } }],
      usage: { cost_usd: "0.000300" },
    }, { headers: { "Otari-Model": "llama-3.3-70b-instruct", "Otari-Fallback": "false" } })
  })
  const result = await runCheck({ url: "http://127.0.0.1:43123/fixture/broken.html", html: "", howto: FIXTURE_HOWTO, sessionId: "demo1" }, deps)
  assert.equal(result.ok, true)
  assert.equal(calls.includes("/api/v1/fetch"), false)
  assert.equal(calls.includes("/api/v1/code/execute"), true)
  assert.equal(result.readingOrder?.parser, "otari-code-execution")
  assert.equal(result.otari.fetch.status, "local-fixture")
  assert.equal(result.firstBreak?.stepIndex, 3)
  assert.equal(result.attempt?.steps.map((step) => step.status).join(","), "done,done,stuck")
  assert.match(result.rewrite?.text ?? "", /Reserve my seat/)
  assert.doesNotMatch(result.rewrite?.text ?? "", /Notify me/)
  assert.equal(result.rewrite?.from, "model")
  assert.equal(result.otari.models.narrator.served, "qwen3-32b")
  assert.equal(result.otari.models.attempt.served, "llama-3.3-70b-instruct")
  assert.match(result.otari.guardrails.header ?? "", /prompt-injection/)
  assert.equal(result.otari.budget.sessionSpentUsd > 0, true)
  assert.equal(result.otari.mcp.status, "not-configured")
})

test("an invented rewrite is held and the tree's step is kept", async () => {
  const grounded = harness(async (url, init) => {
    const path = new URL(String(url)).pathname
    const body = init?.body ? (JSON.parse(String(init.body)) as { metadata?: { role?: string } }) : {}
    if (path.endsWith("/key/budget")) return Response.json({ remaining_usd: 1, budgets_enforced: true, limits: [] })
    if (path.endsWith("/code/execute")) return Response.json({ stdout: JSON.stringify(tree), stderr: "", return_code: 0 })
    if (body.metadata?.role === "narrate") {
      return Response.json({ choices: [{ message: { content: '{"prose":"A level 1 heading, \\"Saturday workshop\\", then a level 3 heading, \\"What to bring\\". Heading level jumps from 1 to 3. A button has no accessible name."}' } }] })
    }
    return Response.json({ choices: [{ message: { content: '{"stuckIndex":3,"because":"The step names \\"Reserve my seat\\", and that name is not in the reading order.","rewrite":"Click \\"Confirm booking\\"."}' } }] })
  })
  const result = await runCheck({ url: "/fixture/broken.html", html: "", howto: FIXTURE_HOWTO, sessionId: "demo2" }, grounded)
  assert.equal(result.rewrite?.from, "guardrail")
  assert.match(result.rewrite?.text ?? "", /Reserve my seat/)
  assert.doesNotMatch(result.rewrite?.text ?? "", /Confirm booking/)
  assert.equal(result.otari.guardrails.held.some((reason) => reason.includes("Confirm booking")), true)
})

test("a product named without a domain is searched and not fetched", async () => {
  const calls: string[] = []
  const deps = harness(async (url, init) => {
    const path = new URL(String(url)).pathname
    calls.push(path)
    const body = init?.body ? (JSON.parse(String(init.body)) as { metadata?: { role?: string }; query?: string }) : {}
    if (path.endsWith("/key/budget")) return Response.json({ remaining_usd: 1, budgets_enforced: true, limits: [] })
    if (path.endsWith("/search")) {
      assert.equal(body.query, "Notion")
      return Response.json({ results: [{ title: "Notion", url: "https://www.notion.so", snippet: "Notion" }] })
    }
    return Response.json({ choices: [{ message: { content: '{"stuckIndex":1,"because":"This step needs a page, and no page was opened.","rewrite":"This step needs a page, and no page was opened. Paste the page URL before asking someone to follow this step."}' } }] })
  })
  const result = await runCheck({ url: "", html: "", howto: '1. Sign up on Notion', sessionId: "demo3" }, deps)
  assert.equal(calls.includes("/api/v1/search"), true)
  assert.equal(calls.includes("/api/v1/fetch"), false)
  assert.equal(result.otari.search.status, "skipped-fetch")
  assert.equal(result.firstBreak?.stepIndex, 1)
})

test("code execution failure uses the local parser and says so", async () => {
  const deps = harness(async (url) => {
    const path = new URL(String(url)).pathname
    if (path.endsWith("/key/budget")) return Response.json({ remaining_usd: 1, budgets_enforced: true, limits: [] })
    if (path.endsWith("/code/execute")) return Response.json({ detail: "No sandbox is configured" }, { status: 400 })
    return Response.json({ choices: [{ message: { content: '{"prose":"A level 1 heading, \\"Saturday workshop\\". Heading level jumps from 1 to 3. A button has no accessible name.","stuckIndex":null,"because":"","rewrite":""}' } }] })
  })
  const result = await runCheck({ url: "", html, howto: "", sessionId: "demo4" }, deps)
  assert.equal(result.readingOrder?.parser, "local-python")
  assert.equal(result.otari.codeExecution.status, "failed")
  assert.equal(result.firstBreak?.kind, "heading")
})
