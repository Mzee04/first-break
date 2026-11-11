import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import test from "node:test"
import { fixtureHtmlPath } from "../src/fixture.js"
import { buildCodeExecutionSource, parseWithLocalPython } from "../src/parser/tree.js"

const html = readFileSync(fixtureHtmlPath(), "utf8")

test("local parser flags the skipped heading and the unlabeled button", async () => {
  const tree = await parseWithLocalPython(html)
  assert.equal(tree.sourceKind, "html")
  assert.equal(tree.title, "Saturday workshop")
  assert.equal(tree.items.find((item) => item.ref === "h2")?.level, 3)
  assert.equal(tree.items.find((item) => item.ref === "c1")?.name, "Email")
  assert.equal(tree.items.find((item) => item.ref === "c2")?.name, "")
  assert.equal(tree.items.find((item) => item.ref === "c3")?.name, "Notify me")
  assert.deepEqual(
    tree.issues.map((issue) => issue.kind),
    ["skipped-heading", "missing-name"],
  )
})

test("the source sent to Otari code execution parses the same tree", async () => {
  const local = await parseWithLocalPython(html)
  const source = buildCodeExecutionSource(html)
  assert.match(source, /parse_document/)
  assert.doesNotMatch(source, /if __name__ == "__main__"/)
  const run = spawnSync("python3", ["-c", source], { encoding: "utf8" })
  assert.equal(run.status, 0, run.stderr)
  assert.deepEqual(JSON.parse(run.stdout), local)
})

test("markdown extraction keeps heading skips and empty links", async () => {
  const tree = await parseWithLocalPython("# Saturday workshop\n### What to bring\n\n[Email](https://example.com)\n[](https://example.com/x)\n")
  assert.equal(tree.sourceKind, "markdown")
  assert.equal(tree.issues.some((issue) => issue.kind === "skipped-heading"), true)
  assert.equal(tree.issues.some((issue) => issue.kind === "missing-name"), true)
})
