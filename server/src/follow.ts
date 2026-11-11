import type { FollowStep, ReadingTree } from "./types.js"

const QUOTE = /"([^"\n]{1,160})"|“([^”\n]{1,160})”|«([^»\n]{1,160})»|‘([^’\n]{1,160})’/g
const GENERIC = new Set(["the button", "a button", "the link", "a link", "button", "link", "it", "here", "this", "submit", "the control", "a control"])

export function norm(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim()
}

export function quotedPhrases(text: string): string[] {
  const phrases: string[] = []
  for (const match of text.matchAll(QUOTE)) {
    const phrase = (match[1] || match[2] || match[3] || match[4] || "").trim()
    if (phrase) phrases.push(phrase)
  }
  return phrases
}

export function splitHowto(howto: string): string[] {
  const lines = howto.split(/\n+/).map((line) => line.trim()).filter(Boolean)
  const steps = lines.map((line) => line.replace(/^\s*(?:\d+[.)]|[-*])\s+/, "").trim()).filter(Boolean)
  if (steps.length === 0 && howto.trim()) return [howto.trim()]
  return steps
}

export function treePhrases(tree: ReadingTree): string[] {
  const phrases: string[] = []
  if (tree.title) phrases.push(tree.title)
  for (const item of tree.items) {
    if (item.text) phrases.push(item.text)
    if (item.name) phrases.push(item.name)
  }
  return phrases.filter(Boolean)
}

export function phraseKnown(phrases: string[], target: string): boolean {
  const wanted = norm(target)
  if (!wanted) return false
  return phrases.some((phrase) => norm(phrase) === wanted)
}

function verbOf(step: string): "open" | "click" | "enter" | "other" {
  const first = step.trim().toLowerCase().split(/\s+/)[0]?.replace(/[^a-z]/g, "") ?? ""
  if (["open", "visit", "go", "sign", "log", "register", "create", "join", "download", "install", "read", "find"].includes(first)) return "open"
  if (["click", "press", "tap", "select", "choose", "hit"].includes(first)) return "click"
  if (["enter", "type", "fill", "write"].includes(first)) return "enter"
  return "other"
}

function keywordFor(step: string): string | null {
  const lower = step.toLowerCase()
  if (lower.includes("e-mail") || lower.includes("email")) return "email"
  for (const word of ["password", "phone", "search"]) {
    if (lower.includes(word)) return word
  }
  return null
}

function unquotedTarget(step: string): string | null {
  const rest = step.replace(/^\s*\S+\s+/, "").replace(/[.?!]+$/g, "").trim()
  if (!rest || rest.length > 80) return null
  return rest
}

export function followSteps(steps: string[], tree: ReadingTree | null): { steps: FollowStep[]; stuckIndex: number | null } {
  const phrases = tree ? treePhrases(tree) : []
  const controls = tree?.items.filter((item) => item.kind === "control") ?? []
  const unlabeled = controls.filter((item) => !item.name)
  const out: FollowStep[] = []

  for (const [offset, text] of steps.entries()) {
    const index = offset + 1
    const quotes = quotedPhrases(text)
    const missing = tree ? quotes.find((quote) => !phraseKnown(phrases, quote)) : quotes[0]
    if (missing && tree) {
      out.push({
        index,
        text,
        status: "stuck",
        because: `The step names “${missing}”, and that name is not in the reading order.`,
        refs: unlabeled.map((item) => item.ref),
      })
      return { steps: out, stuckIndex: index }
    }
    const verb = verbOf(text)
    if (!tree) {
      const needsPage = verb !== "other" || quotes.length > 0 || /\b(page|site|website|button|link|field|form|menu)\b/i.test(text)
      if (needsPage) {
        out.push({
          index,
          text,
          status: "stuck",
          because: "This step needs a page, and no page was opened.",
          refs: [],
        })
        return { steps: out, stuckIndex: index }
      }
      out.push({ index, text, status: "done", because: "This step does not point at a page.", refs: [] })
      continue
    }
    if (verb === "click") {
      const target = quotes[0] ?? unquotedTarget(text)
      if (!target || GENERIC.has(norm(target))) {
        if (unlabeled.length > 0) {
          const first = unlabeled[0]
          out.push({
            index,
            text,
            status: "stuck",
            because: `${first?.tag ?? "control"} ${first?.ref ?? ""} has no accessible name, so a stranger cannot tell which control this step means.`.trim(),
            refs: unlabeled.map((item) => item.ref),
          })
          return { steps: out, stuckIndex: index }
        }
        const namedActions = controls.filter((item) => item.name && (item.role === "button" || item.role === "link"))
        if (namedActions.length !== 1) {
          out.push({
            index,
            text,
            status: "stuck",
            because: "The step does not name a control, and the page does not have exactly one named button or link.",
            refs: namedActions.map((item) => item.ref),
          })
          return { steps: out, stuckIndex: index }
        }
      }
      out.push({ index, text, status: "done", because: "The control this step names is in the reading order.", refs: [] })
      continue
    }
    if (verb === "enter") {
      if (quotes.length > 0) {
        out.push({ index, text, status: "done", because: "The step names something that is in the reading order.", refs: [] })
        continue
      }
      const keyword = keywordFor(text)
      const match = keyword
        ? controls.find((item) => `${item.name ?? ""} ${item.inputType ?? ""}`.toLowerCase().includes(keyword))
        : undefined
      if (!match) {
        out.push({
          index,
          text,
          status: "stuck",
          because: "The step asks for a field that is not in the reading order.",
          refs: [],
        })
        return { steps: out, stuckIndex: index }
      }
      out.push({ index, text, status: "done", because: `The field ${match.ref} matches this step.`, refs: [match.ref] })
      continue
    }
    if (verb === "open") {
      out.push({ index, text, status: "done", because: "The page is open.", refs: [] })
      continue
    }
    out.push({ index, text, status: "done", because: "Nothing in this step names a missing control.", refs: [] })
  }
  return { steps: out, stuckIndex: null }
}

export function deterministicProse(tree: ReadingTree): string {
  if (tree.items.length === 0) return "The parser found no title, headings, or controls."
  const parts = tree.items.map((item) => {
    if (item.kind === "title") return `the document title “${item.text ?? ""}”`
    if (item.kind === "heading") return `a level ${item.level} heading, “${item.text || "(empty)"}”`
    if (!item.name) return `a ${item.tag} with no accessible name (${item.ref})`
    return `a ${item.tag} named “${item.name}” (${item.ref})`
  })
  const issues = tree.issues.map((issue) => issue.detail).join(" ")
  const source =
    tree.sourceKind === "markdown"
      ? " This pass used extracted text, so controls the extractor dropped are not listed and are not reported as missing."
      : ""
  return `In reading order: ${parts.join("; ")}. ${issues}${source}`.replace(/\s+/g, " ").trim()
}

export function deterministicRewrite(stuck: FollowStep | null, tree: ReadingTree | null): string {
  if (stuck) {
    const phrases = tree ? treePhrases(tree) : []
    const missing = quotedPhrases(stuck.text).find((quote) => !phraseKnown(phrases, quote))
    const unlabeled = tree?.items.find((item) => item.kind === "control" && !item.name && stuck.refs.includes(item.ref))
    if (missing && unlabeled) {
      const typed = unlabeled.inputType ? `, type ${unlabeled.inputType}` : ""
      return `Nothing in the reading order is named “${missing}”. ${unlabeled.tag} ${unlabeled.ref}${typed} has no accessible name. Name that control for what it does, then use that name in this step.`
    }
    if (missing) {
      return `Nothing in the reading order is named “${missing}”. Rewrite this step so it only names a control the page actually has.`
    }
    if (!tree) {
      return "This step needs a page, and no page was opened. Paste the page URL before asking someone to follow this step."
    }
    return stuck.because
  }
  const issue = tree?.issues[0]
  if (!issue || !tree) return ""
  const item = tree.items.find((entry) => entry.ref === issue.ref)
  if (issue.kind === "missing-name" && item) {
    return `${item.tag ?? "Control"} ${item.ref} has no accessible name. Name it for what it does. Do not invent a label the page does not show.`
  }
  return issue.detail
}
