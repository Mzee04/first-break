import assert from "node:assert/strict"
import test from "node:test"
import { classifyPageUrl, extractDomains, hostMatches, searchPlan } from "../src/urls.js"

test("the bundled fixture is not sent to Otari fetch", () => {
  assert.equal(classifyPageUrl("/fixture/broken.html").kind, "fixture")
  assert.equal(classifyPageUrl("http://127.0.0.1:43123/fixture/broken.html").kind, "fixture")
  assert.equal(classifyPageUrl("http://127.0.0.1:43123/secret").kind, "blocked")
})

test("a public URL is allowed and a private host is not", () => {
  const pub = classifyPageUrl("https://example.com/docs")
  assert.equal(pub.kind, "public")
  assert.equal(classifyPageUrl("http://10.0.0.8/admin").kind, "blocked")
  assert.equal(classifyPageUrl("http://169.254.169.254/latest").kind, "blocked")
})

test("search stays on a named domain and does not treat a bare product as a fetch", () => {
  const named = searchPlan("Read the docs on developer.mozilla.org")
  assert.deepEqual(named?.domains, ["developer.mozilla.org"])
  assert.equal(hostMatches("https://developer.mozilla.org/en-US/docs", named?.domains ?? []), true)
  assert.equal(hostMatches("https://evil.example/developer.mozilla.org", named?.domains ?? []), false)
  const product = searchPlan("Sign up on Notion")
  assert.equal(product?.query, "Notion")
  assert.deepEqual(product?.domains, [])
  assert.equal(searchPlan("Open the Saturday workshop page"), null)
  assert.deepEqual(extractDomains("see example.com and https://example.com/a"), ["example.com"])
})
