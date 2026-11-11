import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { FIXTURE_HOWTO, fixtureHtmlPath } from "../src/fixture.js"
import { deterministicRewrite, followSteps, splitHowto } from "../src/follow.js"
import { acceptProse, acceptRewrite, mergeAttempt, parseModelAttempt } from "../src/guard.js"
import { parseWithLocalPython } from "../src/parser/tree.js"

const tree = await parseWithLocalPython(readFileSync(fixtureHtmlPath(), "utf8"))
const steps = splitHowto(FIXTURE_HOWTO)

test("the fixture how-to stops at the missing control and does not invent a label", () => {
  const follow = followSteps(steps, tree)
  assert.deepEqual(
    follow.steps.map((step) => step.status),
    ["done", "done", "stuck"],
  )
  assert.equal(follow.stuckIndex, 3)
  const rewrite = deterministicRewrite(follow.steps[2] ?? null, tree)
  assert.match(rewrite, /Reserve my seat/)
  assert.match(rewrite, /no accessible name/)
  assert.doesNotMatch(rewrite, /Notify me/)
  assert.doesNotMatch(rewrite, /Confirm/)
})

test("a rewrite that names a control outside the tree is held", () => {
  const follow = followSteps(steps, tree)
  const verdict = acceptRewrite('Click "Confirm booking".', tree, follow.steps[2] ?? null)
  assert.equal(verdict.ok, false)
  if (!verdict.ok) assert.match(verdict.reason, /Confirm booking/)
})

test("a rewrite that sends the reader to a different real control is held", () => {
  const follow = followSteps(steps, tree)
  const verdict = acceptRewrite('Click "Notify me" instead.', tree, follow.steps[2] ?? null)
  assert.equal(verdict.ok, false)
  if (!verdict.ok) assert.match(verdict.reason, /Notify me/)
})

test("a narration cannot claim a skipped heading the tree does not have", async () => {
  const clean = await parseWithLocalPython("<h1>Only</h1><button>Save</button>")
  const verdict = acceptProse("The page skips a heading level before Save.", clean)
  assert.equal(verdict.ok, false)
})

test("a model that stops on the wrong step is replaced by the tree", () => {
  const follow = followSteps(steps, tree)
  const model = parseModelAttempt('{"stuckIndex":2,"because":"The email field is missing.","rewrite":"Invent a field."}')
  const merged = mergeAttempt(model, follow, tree, true)
  assert.equal(merged.from, "guardrail")
  assert.match(merged.rewrite, /Reserve my seat/)
  assert.equal(merged.held.length > 0, true)
})

test("steps alone, with no page, stop at the first step that needs one", () => {
  const follow = followSteps(steps, null)
  assert.equal(follow.stuckIndex, 1)
  assert.match(follow.steps[0]?.because ?? "", /no page/)
})
