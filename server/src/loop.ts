import { attemptSelector, narratorSelector, type AppConfig } from "./config.js"
import { loadFixtureHtml } from "./fixture.js"
import { deterministicProse, followSteps, splitHowto } from "./follow.js"
import { acceptProse, mergeAttempt, parseModelAttempt, parseModelProse } from "./guard.js"
import { OtariError, type OtariClient } from "./otari/client.js"
import { assertTree, buildCodeExecutionSource, parseWithLocalPython } from "./parser/tree.js"
import { SessionLedger } from "./sessions.js"
import {
  APP_RULES,
  type AttemptView,
  type CheckResponse,
  type FirstBreak,
  type ModelTrace,
  type OtariTrace,
  type ReadingTree,
  type ReadingView,
  type Rewrite,
} from "./types.js"
import { classifyPageUrl, extractExplicitUrls, hostMatches, publicHttpsUrl, searchPlan } from "./urls.js"

export type CheckInput = {
  url: string
  html: string
  howto: string
  sessionId: string
  requestHost?: string
}

export type CheckDeps = {
  config: AppConfig
  otari: OtariClient | null
  ledger: SessionLedger
  parseLocal?: (html: string) => Promise<ReadingTree>
  loadFixture?: () => string
}

const NARRATOR_SYSTEM = `You narrate a screen-reader reading order for First Break.
Describe only the tree in the user message, in that order.
Do not add headings, controls, or problems that are not in the tree.
Quote a name only when that exact name appears in the tree.
If issues is empty, do not say anything is skipped, unlabeled, or missing a name.
Write two to four sentences a person can read aloud.
Reply with JSON only: {"prose":"..."}`

const ATTEMPT_SYSTEM = `You are the attempt pass in First Break. A stranger follows the how-to and stops at the first step they cannot finish.
Use only the steps and the reading-order tree in the user message.
Do not add steps.
Do not invent control or heading names. A name is real only if it appears in the tree. Placeholder text is not an accessible name.
If a step quotes a name that is not in the tree, that step is where they stop.
stuckIndex is the 1-based step number, or null when every step can be done.
rewrite replaces only the stuck step, in one or two sentences. It may repeat a name that is already in that step. It must not tell the reader to use a different control.
If nothing is stuck and the tree has issues, stuckIndex is null and rewrite names the first issue without inventing a label.
If nothing is stuck and the tree has no issues, rewrite is an empty string.
Reply with JSON only: {"stuckIndex":null,"because":"...","rewrite":"..."}`

function blankModel(requested: string, fallback: string): ModelTrace {
  return { requested, fallback, served: null, clientFallback: false, otariFallback: null, requestId: null }
}

function failure(sessionId: string, error: string, otari: OtariTrace): CheckResponse {
  return { ok: false, error, sessionId, readingOrder: null, attempt: null, firstBreak: null, rewrite: null, otari }
}

function errorText(error: unknown): string {
  if (error instanceof OtariError) return error.detail
  return error instanceof Error ? error.message : "The Otari call failed."
}

function runSpent(prior: number, otari: OtariClient | null): number {
  const extra = otari?.calls.reduce((sum, call) => sum + (call.costUsd ? Number(call.costUsd) || 0 : 0), 0) ?? 0
  return prior + extra
}

export async function runCheck(input: CheckInput, deps: CheckDeps): Promise<CheckResponse> {
  const parseLocal = deps.parseLocal ?? parseWithLocalPython
  const loadFixture = deps.loadFixture ?? loadFixtureHtml
  const { config, otari, ledger } = deps
  const held: string[] = []
  const prior = ledger.get(input.sessionId)
  const trace: OtariTrace = {
    configured: Boolean(otari),
    baseUrl: config.otariBaseUrl,
    calls: [],
    models: {
      narrator: blankModel(narratorSelector(config), config.narratorFallback),
      attempt: blankModel(attemptSelector(config), config.attemptFallback),
    },
    fetch: { status: "not-requested", detail: "No URL was fetched.", requestId: null },
    search: { status: "not-requested", detail: "Web search was not needed.", requestId: null },
    codeExecution: { status: "not-requested", detail: "No page was parsed.", requestId: null, parser: "none" },
    guardrails: {
      profile: config.guardrailProfile,
      mode: config.guardrailMode,
      onUnavailable: config.guardrailOnUnavailable,
      header: null,
      appRules: APP_RULES,
      held,
    },
    budget: {
      before: null,
      after: null,
      sessionSpentUsd: prior.spentUsd,
      sessionCalls: prior.calls,
      sessionCeilingUsd: config.sessionBudgetUsd,
      endUser: null,
      endUserMode: otari ? "not-sent" : "not-called",
    },
    mcp: {
      status: "not-configured",
      detail: publicHttpsUrl(config.mcpServerUrl)
        ? "An https MCP server is configured. It is sent only on the attempt call, and a call is recorded only when Otari returns one."
        : "No public https MCP server is set. Otari was not asked to call one. See README for the dashboard step.",
      calls: [],
    },
  }

  const finish = (response: CheckResponse): CheckResponse => {
    if (otari) {
      trace.calls = otari.calls.map((call) => ({ ...call }))
      trace.guardrails.header = otari.calls.find((call) => call.guardrails)?.guardrails ?? null
      const spent = runSpent(prior.spentUsd, otari)
      const calls = prior.calls + otari.calls.length
      ledger.set(input.sessionId, { spentUsd: spent, calls })
      trace.budget.sessionSpentUsd = spent
      trace.budget.sessionCalls = calls
      if (otari.userFieldAccepted === true) trace.budget.endUserMode = "end-user"
      else if (otari.userFieldAccepted === false) trace.budget.endUserMode = "rejected-not-a-service-key"
      else if (config.serviceKey === "false") trace.budget.endUserMode = "metadata-only"
    }
    trace.guardrails.held = held
    return response
  }

  if (!input.url.trim() && !input.html.trim() && !input.howto.trim()) {
    return finish(failure(input.sessionId, "Paste a URL, a how-to, or both.", trace))
  }

  if (otari) trace.budget.before = await otari.keyBudget()
  const budgetReason =
    (trace.budget.before?.remainingUsd ?? 1) <= 0
      ? "Otari reports no remaining budget on this key."
      : prior.spentUsd >= config.sessionBudgetUsd
        ? `This session is already at its ${config.sessionBudgetUsd} USD ceiling.`
        : null

  let html = input.html.trim()
  if (html) {
    trace.fetch = { status: "not-requested", detail: "Pasted HTML was used, so the URL was not fetched.", requestId: null }
  } else if (input.url.trim()) {
    const classified = classifyPageUrl(input.url, input.requestHost)
    if (classified.kind === "fixture") {
      html = loadFixture()
      trace.fetch = {
        status: "local-fixture",
        detail: "The bundled fixture was read here. Otari fetch refuses loopback addresses, so it was not called.",
        requestId: null,
      }
    } else if (classified.kind === "blocked") {
      return finish(failure(input.sessionId, classified.reason, trace))
    } else if (classified.kind === "public") {
      if (!otari) {
        return finish(failure(input.sessionId, "No OTARI_API_KEY is set, so a public URL cannot be fetched. Load the broken demo or paste the HTML.", trace))
      }
      if (budgetReason) return finish(failure(input.sessionId, budgetReason, trace))
      try {
        const fetched = await otari.fetchPage(classified.url)
        html = fetched.text
        trace.fetch = {
          status: "completed",
          detail: `POST /api/v1/fetch via ${fetched.tool} returned ${fetched.text.length} characters.`,
          url: classified.url,
          requestId: fetched.call.requestId,
        }
        if (!html.trim()) return finish(failure(input.sessionId, "Otari fetch returned an empty page.", trace))
      } catch (error) {
        trace.fetch = { status: "failed", detail: errorText(error), url: classified.url, requestId: null }
        return finish(failure(input.sessionId, errorText(error), trace))
      }
    }
  } else if (input.howto.trim()) {
    const explicit = extractExplicitUrls(input.howto)
    if (explicit.length > 1) held.push("Only the first public URL in the steps was opened.")
    const target = explicit[0]
    if (target) {
      if (!otari) {
        return finish(failure(input.sessionId, "The steps include a public URL, and this server has no OTARI_API_KEY to fetch it.", trace))
      }
      if (budgetReason) return finish(failure(input.sessionId, budgetReason, trace))
      try {
        const fetched = await otari.fetchPage(target)
        html = fetched.text
        trace.fetch = {
          status: "completed",
          detail: "The steps included a public URL, so Otari fetch opened that page and no other.",
          url: target,
          requestId: fetched.call.requestId,
        }
      } catch (error) {
        trace.fetch = { status: "failed", detail: errorText(error), url: target, requestId: null }
        return finish(failure(input.sessionId, errorText(error), trace))
      }
    } else {
      const plan = searchPlan(input.howto)
      if (!plan) {
        trace.search = { status: "not-requested", detail: "The steps do not name a site or product, so web search was not called.", requestId: null }
      } else if (!otari) {
        trace.search = { status: "not-requested", detail: "The steps name a site or product, but there is no OTARI_API_KEY, so web search was not called.", requestId: null }
      } else if (budgetReason) {
        trace.search = { status: "failed", detail: budgetReason, query: plan.query, requestId: null }
      } else {
        try {
          const searched = await otari.search(plan.query, plan.domains, input.sessionId)
          const match = plan.domains.length ? searched.results.find((result) => hostMatches(result.url, plan.domains)) : undefined
          trace.search = {
            status: match ? "completed" : "skipped-fetch",
            detail: match
              ? "Search found a result on a domain the steps named. That page was fetched. No other result was opened."
              : plan.domains.length
                ? "Search ran. No result was on a domain the steps named, so nothing was fetched."
                : "Search ran for the product the steps named. No domain was named, so no result was fetched.",
            query: plan.query,
            requestId: searched.call.requestId,
          }
          if (match && runSpent(prior.spentUsd, otari) < config.sessionBudgetUsd) {
            const fetched = await otari.fetchPage(match.url)
            html = fetched.text
            trace.fetch = {
              status: "completed",
              detail: "Fetched only the search result whose host the steps named.",
              url: match.url,
              requestId: fetched.call.requestId,
            }
          }
        } catch (error) {
          trace.search = { status: "failed", detail: errorText(error), query: plan.query, requestId: null }
          held.push("Web search failed, so the steps were judged without a page.")
        }
      }
    }
  }

  if (html.length > 350_000) {
    return finish(failure(input.sessionId, "That page is too large to parse in one pass.", trace))
  }

  let tree: ReadingTree | null = null
  if (html) {
    const canExecute = Boolean(otari) && !budgetReason && runSpent(prior.spentUsd, otari) < config.sessionBudgetUsd
    if (canExecute && otari) {
      try {
        const exec = await otari.execute(buildCodeExecutionSource(html))
        if (exec.returnCode !== 0) throw new Error(exec.stderr || `Otari code execution exited ${exec.returnCode}.`)
        tree = assertTree(JSON.parse(exec.stdout) as unknown)
        trace.codeExecution = {
          status: "completed",
          detail: "POST /api/v1/code/execute parsed the page into reading order.",
          requestId: exec.call.requestId,
          parser: "otari-code-execution",
        }
      } catch (error) {
        held.push(`Otari code execution failed (${errorText(error)}). The local parser ran instead.`)
        try {
          tree = await parseLocal(html)
          trace.codeExecution = { status: "failed", detail: errorText(error), requestId: null, parser: "local-python" }
        } catch (localError) {
          return finish(failure(input.sessionId, errorText(localError), trace))
        }
      }
    } else {
      try {
        tree = await parseLocal(html)
        trace.codeExecution = {
          status: "not-requested",
          detail: budgetReason
            ? `${budgetReason} The local parser ran instead of Otari code execution.`
            : "No OTARI_API_KEY is set. The local parser ran. Otari code execution was not called.",
          requestId: null,
          parser: "local-python",
        }
      } catch (error) {
        return finish(failure(input.sessionId, errorText(error), trace))
      }
    }
  }

  const steps = input.howto.trim() ? splitHowto(input.howto) : []
  const follow = followSteps(steps, tree)
  const modelsBlocked = Boolean(budgetReason) || runSpent(prior.spentUsd, otari) >= config.sessionBudgetUsd
  if (modelsBlocked && budgetReason) held.push(budgetReason)
  else if (modelsBlocked) held.push("The session ceiling was reached before the model calls.")

  let readingOrder: ReadingView | null = null
  if (tree) {
    let prose = deterministicProse(tree)
    let proseFrom: ReadingView["proseFrom"] = "tree"
    if (otari && !modelsBlocked) {
      try {
        const chat = await otari.chat(
          "narrate",
          [
            { role: "system", content: NARRATOR_SYSTEM },
            { role: "user", content: JSON.stringify({ title: tree.title, sourceKind: tree.sourceKind, items: tree.items, issues: tree.issues }) },
          ],
          input.sessionId,
          false,
        )
        trace.models.narrator = {
          requested: narratorSelector(config),
          fallback: config.narratorFallback,
          served: chat.call.servedModel || (chat.clientFallback ? config.narratorFallback : narratorSelector(config)),
          clientFallback: chat.clientFallback,
          otariFallback: chat.call.otariFallback,
          requestId: chat.call.requestId,
        }
        const parsed = parseModelProse(chat.content)
        if (!parsed) {
          held.push("The narrator did not return JSON. The reading-order note was written from the tree.")
          proseFrom = "guardrail"
        } else {
          const verdict = acceptProse(parsed, tree)
          if (verdict.ok) {
            prose = parsed
            proseFrom = "model"
          } else {
            held.push(verdict.reason)
            proseFrom = "guardrail"
          }
        }
      } catch (error) {
        held.push(`The narrator call failed (${errorText(error)}). The note was written from the tree.`)
      }
    }
    readingOrder = {
      sourceKind: tree.sourceKind,
      title: tree.title,
      items: tree.items,
      issues: tree.issues,
      prose,
      proseFrom,
      parser: trace.codeExecution.parser === "otari-code-execution" ? "otari-code-execution" : "local-python",
      note:
        tree.sourceKind === "markdown"
          ? "Otari fetch returned extracted text, not the raw document. Controls that extractor dropped are not listed and are not reported as missing."
          : null,
    }
  }

  let attempt: AttemptView | null = null
  let merged = mergeAttempt(null, follow, tree, false)
  const shouldAttempt = Boolean(otari) && !modelsBlocked && (steps.length > 0 || Boolean(tree?.issues.length))
  if (shouldAttempt && otari) {
    try {
      const chat = await otari.chat(
        "attempt",
        [
          { role: "system", content: ATTEMPT_SYSTEM },
          {
            role: "user",
            content: JSON.stringify({
              steps: steps.map((text, index) => ({ index: index + 1, text })),
              tree: tree ? { title: tree.title, sourceKind: tree.sourceKind, items: tree.items, issues: tree.issues } : null,
            }),
          },
        ],
        input.sessionId,
        true,
      )
      trace.models.attempt = {
        requested: attemptSelector(config),
        fallback: config.attemptFallback,
        served: chat.call.servedModel || (chat.clientFallback ? config.attemptFallback : attemptSelector(config)),
        clientFallback: chat.clientFallback,
        otariFallback: chat.call.otariFallback,
        requestId: chat.call.requestId,
      }
      if (chat.mcpRefused) {
        trace.mcp = { status: "refused", detail: chat.mcpRefused, calls: [] }
      } else if (chat.toolCalls.length > 0) {
        trace.mcp = { status: "called", detail: "Otari returned MCP tool calls on the attempt.", calls: chat.toolCalls }
      } else if (publicHttpsUrl(config.mcpServerUrl)) {
        trace.mcp = { status: "declared", detail: "The MCP server was offered. The model did not call it.", calls: [] }
      }
      merged = mergeAttempt(parseModelAttempt(chat.content), follow, tree, true)
    } catch (error) {
      held.push(`The attempt call failed (${errorText(error)}). The break was taken from the tree and the steps.`)
      merged = mergeAttempt(null, follow, tree, false)
    }
  }
  held.push(...merged.held.filter((reason) => !held.includes(reason)))

  if (steps.length > 0) {
    const stuck = follow.steps.find((step) => step.status === "stuck")
    attempt = {
      steps: follow.steps,
      stoppedBecause: stuck ? `Stopped at step ${stuck.index}. Later steps were not tried.` : "Every step could be followed.",
      noteFrom: merged.from,
    }
    if (merged.from !== "tree") {
      const stuckStep = follow.steps.find((step) => step.status === "stuck")
      if (stuckStep && merged.because) stuckStep.because = merged.because
    }
  } else if (tree) {
    attempt = {
      steps: [],
      stoppedBecause: "No how-to was given. The pass stops at the first flagged item in the reading order.",
      noteFrom: merged.from,
    }
  }

  const stuck = follow.steps.find((step) => step.status === "stuck") ?? null
  const issue = tree?.issues[0] ?? null
  let firstBreak: FirstBreak
  if (stuck) {
    firstBreak = {
      kind: "step",
      title: `Step ${stuck.index} is where a stranger stops`,
      detail: stuck.because,
      stepIndex: stuck.index,
      stepText: stuck.text,
      refs: stuck.refs,
    }
  } else if (issue) {
    firstBreak = {
      kind: issue.kind === "skipped-heading" ? "heading" : "control",
      title: issue.kind === "skipped-heading" ? "The first heading break" : "The first unlabeled control",
      detail: issue.detail,
      stepIndex: null,
      stepText: null,
      refs: [issue.ref],
    }
  } else {
    firstBreak = {
      kind: "none",
      title: "No break in what you gave",
      detail: steps.length ? "The steps get through the page." : "Nothing in the reading order was flagged.",
      stepIndex: null,
      stepText: null,
      refs: [],
    }
  }

  const rewrite: Rewrite | null = merged.rewrite
    ? { text: merged.rewrite, from: merged.from, draft: merged.draft, held: merged.held }
    : null

  if (otari && otari.userFieldAccepted === true) {
    trace.budget.endUser = await otari.endUser(input.sessionId)
  }
  if (otari) trace.budget.after = await otari.keyBudget()

  return finish({
    ok: true,
    sessionId: input.sessionId,
    readingOrder,
    attempt,
    firstBreak,
    rewrite,
    otari: trace,
  })
}
