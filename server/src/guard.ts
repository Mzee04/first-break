import { deterministicRewrite, phraseKnown, quotedPhrases, treePhrases } from "./follow.js"
import type { FollowStep, ReadingTree } from "./types.js"

export type ModelAttempt = {
  stuckIndex: number | null
  because: string
  rewrite: string
}

export type MergedAttempt = {
  because: string
  rewrite: string
  from: "model" | "guardrail" | "tree"
  draft: string | null
  held: string[]
}

function claimsSkipped(text: string): boolean {
  return /skip(?:ped|s)?(?:\s+\w+){0,4}\s+(?:heading|level)/i.test(text)
}

function claimsMissing(text: string): boolean {
  return /no accessible name|unlabeled|without a name|missing (?:an |a )?name|mystery/i.test(text)
}

export function acceptGroundedText(
  text: string,
  tree: ReadingTree | null,
  limit: number,
  extra: string[] = [],
): { ok: true } | { ok: false; reason: string } {
  const trimmed = text.trim()
  if (!trimmed) return { ok: false, reason: "The model returned an empty note." }
  if (trimmed.length > limit) return { ok: false, reason: "The model note was longer than this pass allows." }
  const phrases = [...(tree ? treePhrases(tree) : []), ...extra]
  for (const quote of quotedPhrases(trimmed)) {
    const inIssue = tree?.issues.some((issue) => issue.detail.includes(quote)) ?? false
    if (!phraseKnown(phrases, quote) && !inIssue) {
      return { ok: false, reason: `The model quotes “${quote}”, which is not in the reading order.` }
    }
  }
  if (claimsSkipped(trimmed) && !tree?.issues.some((issue) => issue.kind === "skipped-heading")) {
    return { ok: false, reason: "The model claims a skipped heading that is not in the tree." }
  }
  if (claimsMissing(trimmed) && !tree?.issues.some((issue) => issue.kind === "missing-name")) {
    return { ok: false, reason: "The model claims a missing accessible name that is not in the tree." }
  }
  return { ok: true }
}

export function acceptProse(prose: string, tree: ReadingTree): { ok: true } | { ok: false; reason: string } {
  return acceptGroundedText(prose, tree, 1200)
}

function mentionsOtherControl(rewrite: string, stuckText: string, names: string[]): string | null {
  for (const name of names) {
    if (name.trim().length < 2) continue
    if (stuckText.toLowerCase().includes(name.toLowerCase())) continue
    const pattern = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i")
    if (pattern.test(rewrite)) return name
  }
  return null
}

export function acceptRewrite(
  rewrite: string,
  tree: ReadingTree | null,
  stuck: FollowStep | null,
): { ok: true } | { ok: false; reason: string } {
  const trimmed = rewrite.trim()
  if (!trimmed) return { ok: false, reason: "The rewrite was empty." }
  if (trimmed.length > 600) return { ok: false, reason: "The rewrite was too long to be one step." }
  if (/\n\s*(?:\d+[.)]|[-*])\s+/.test(`\n${trimmed}`)) {
    return { ok: false, reason: "The rewrite adds steps that were not in the how-to." }
  }
  const allowed = tree ? treePhrases(tree) : []
  if (stuck) allowed.push(...quotedPhrases(stuck.text))
  for (const quote of quotedPhrases(trimmed)) {
    if (!phraseKnown(allowed, quote)) {
      return { ok: false, reason: `The rewrite quotes “${quote}”, which is not in the step or the reading order.` }
    }
  }
  if (claimsSkipped(trimmed) && !tree?.issues.some((issue) => issue.kind === "skipped-heading")) {
    return { ok: false, reason: "The rewrite claims a skipped heading that is not in the tree." }
  }
  if (claimsMissing(trimmed) && !tree?.issues.some((issue) => issue.kind === "missing-name")) {
    return { ok: false, reason: "The rewrite claims a missing accessible name that is not in the tree." }
  }
  if (stuck && tree) {
    const otherNames = tree.items.filter((item) => item.kind === "control" && item.name).map((item) => item.name ?? "")
    const other = mentionsOtherControl(trimmed, stuck.text, otherNames)
    if (other) return { ok: false, reason: `The rewrite mentions “${other}”, which is a different control.` }
  }
  return { ok: true }
}

export function parseModelAttempt(content: string): ModelAttempt | null {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/)
  const raw = (fenced?.[1] ?? content).trim()
  const start = raw.indexOf("{")
  const end = raw.lastIndexOf("}")
  if (start < 0 || end < start) return null
  try {
    const value = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>
    const stuck = value.stuckIndex
    const stuckIndex = stuck === null || stuck === undefined || stuck === "" ? null : Number(stuck)
    if (stuckIndex !== null && (!Number.isInteger(stuckIndex) || stuckIndex < 1)) return null
    return {
      stuckIndex,
      because: typeof value.because === "string" ? value.because : "",
      rewrite: typeof value.rewrite === "string" ? value.rewrite : "",
    }
  } catch {
    return null
  }
}

export function parseModelProse(content: string): string | null {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/)
  const raw = (fenced?.[1] ?? content).trim()
  const start = raw.indexOf("{")
  const end = raw.lastIndexOf("}")
  if (start < 0 || end <= start) return null
  try {
    const value = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>
    return typeof value.prose === "string" ? value.prose.trim() : null
  } catch {
    return null
  }
}

export function mergeAttempt(
  model: ModelAttempt | null,
  follow: { steps: FollowStep[]; stuckIndex: number | null },
  tree: ReadingTree | null,
  askedModel: boolean,
): MergedAttempt {
  const stuck = follow.stuckIndex ? follow.steps.find((step) => step.index === follow.stuckIndex) ?? null : null
  const fallbackRewrite = deterministicRewrite(stuck, tree)
  const fallbackBecause = stuck
    ? stuck.because
    : tree?.issues[0]?.detail || (follow.steps.length ? "The steps get through." : "No how-to was given.")

  if (!askedModel) {
    return { because: fallbackBecause, rewrite: fallbackRewrite, from: "tree", draft: null, held: [] }
  }
  if (!model) {
    return {
      because: fallbackBecause,
      rewrite: fallbackRewrite,
      from: "guardrail",
      draft: null,
      held: ["The model did not return the JSON this pass asked for."],
    }
  }
  const held: string[] = []
  if (model.stuckIndex !== follow.stuckIndex) {
    held.push(
      `The model stopped at step ${model.stuckIndex ?? "none"}. The reading order stops at step ${follow.stuckIndex ?? "none"}.`,
    )
    return { because: fallbackBecause, rewrite: fallbackRewrite, from: "guardrail", draft: model.rewrite || null, held }
  }
  const becauseVerdict = model.because.trim()
    ? acceptGroundedText(model.because, tree, 800, stuck ? quotedPhrases(stuck.text) : [])
    : { ok: false as const, reason: "The model note was empty." }
  const rewriteNeeded = Boolean(fallbackRewrite)
  const rewriteVerdict = rewriteNeeded ? acceptRewrite(model.rewrite, tree, stuck) : model.rewrite.trim()
    ? { ok: false as const, reason: "The model rewrote a step that was not stuck and the tree has nothing to name." }
    : { ok: true as const }
  if (!becauseVerdict.ok) held.push(becauseVerdict.reason)
  if (!rewriteVerdict.ok) held.push(rewriteVerdict.reason)
  if (becauseVerdict.ok && rewriteVerdict.ok) {
    return {
      because: model.because.trim() || fallbackBecause,
      rewrite: rewriteNeeded ? model.rewrite.trim() : "",
      from: "model",
      draft: null,
      held,
    }
  }
  return {
    because: becauseVerdict.ok ? model.because.trim() : fallbackBecause,
    rewrite: rewriteVerdict.ok && rewriteNeeded ? model.rewrite.trim() : fallbackRewrite,
    from: "guardrail",
    draft: model.rewrite.trim() || null,
    held,
  }
}
