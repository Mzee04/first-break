import { useEffect, useState, type FormEvent } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { CheckResponse, Health, ReadingItem } from "@/lib/types"

const SESSION_KEY = "first-break-session"

function sessionId(): string {
  const existing = localStorage.getItem(SESSION_KEY)
  if (existing && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(existing)) return existing
  const created = `fb${Math.random().toString(36).slice(2, 10)}`
  localStorage.setItem(SESSION_KEY, created)
  return created
}

function sourceLabel(from: "model" | "guardrail" | "tree" | undefined, served: string | null): string {
  if (from === "model") return served ? `Drafted by ${served}` : "Drafted by the model"
  if (from === "guardrail") return "Held by the do-not-invent rule"
  return "Written from the reading order. No model note was used."
}

function itemLabel(item: ReadingItem): string {
  if (item.kind === "title") return item.text || "Untitled document"
  if (item.kind === "heading") return item.text || "(empty heading)"
  if (!item.name) return `${item.tag ?? "control"} with no accessible name`
  return item.name
}

function money(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "not reported"
  return `$${value.toFixed(4)}`
}

export default function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [url, setUrl] = useState("")
  const [html, setHtml] = useState("")
  const [howto, setHowto] = useState("")
  const [session, setSession] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<CheckResponse | null>(null)

  useEffect(() => {
    setSession(sessionId())
    fetch("/api/health")
      .then((response) => response.json())
      .then((body: Health) => setHealth(body))
      .catch(() => setHealth(null))
  }, [])

  async function loadDemo() {
    setError(null)
    const response = await fetch("/api/fixture")
    if (!response.ok) {
      setError("The broken demo page could not be loaded.")
      return
    }
    const fixture = (await response.json()) as { path: string; howto: string }
    setUrl(`${window.location.origin}${fixture.path}`)
    setHowto(fixture.howto)
    setHtml("")
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!url.trim() && !html.trim() && !howto.trim()) {
      setError("Paste a URL, a how-to, or both.")
      return
    }
    setBusy(true)
    setError(null)
    localStorage.setItem(SESSION_KEY, session)
    try {
      const response = await fetch("/api/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, html, howto, sessionId: session }),
      })
      const body = (await response.json()) as CheckResponse
      setResult(body)
      if (!body.ok) setError(body.error || "The check did not finish.")
    } catch {
      setError("The check could not reach the server.")
    } finally {
      setBusy(false)
    }
  }

  const flagged = new Set(result?.readingOrder?.issues.map((issue) => issue.ref) ?? [])
  const breakRefs = new Set(result?.firstBreak?.refs ?? [])

  return (
    <div className="min-h-screen bg-paper text-ink">
      <a href="#check" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-10 focus:bg-card focus:px-3 focus:py-2">
        Skip to the check
      </a>
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 md:flex-row md:items-end md:justify-between">
          <div className="max-w-xl">
            <p className="font-mono text-xs tracking-[0.22em] text-break">ONE PASS</p>
            <h1 className="mt-2 font-serif text-5xl leading-none sm:text-6xl">First Break</h1>
            <p className="mt-4 text-lg leading-snug">
              Read a page the way a stranger would. Stop at the first place they get stuck.
            </p>
          </div>
          {health ? (
            <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
              Narration uses <span className="text-foreground">{health.models.narrator}</span>, then{" "}
              <span className="text-foreground">{health.models.narratorFallback}</span>. The attempt uses{" "}
              <span className="text-foreground">{health.models.attempt}</span>, then{" "}
              <span className="text-foreground">{health.models.attemptFallback}</span>.
            </p>
          ) : null}
        </div>
      </header>

      <main className="mx-auto grid max-w-5xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <form id="check" onSubmit={onSubmit} className="rounded-lg border border-line bg-card p-4 sm:p-6" aria-busy={busy}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="font-serif text-2xl">What should a stranger be able to do?</h2>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => void loadDemo()}>
                Load the broken demo
              </Button>
              <Button asChild variant="outline" size="sm">
                <a href="/fixture/broken.html" target="_blank" rel="noreferrer">
                  Open the broken page
                </a>
              </Button>
            </div>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Give a URL, a how-to, or both. One of them is required. The page can be in any language. Put a control’s name in quotes.
          </p>
          {health && !health.otariConfigured ? (
            <p className="mt-4 rounded-md bg-secondary px-3 py-2 text-sm">
              This server has no Otari key. The broken demo still runs with the local parser. Model, fetch, and code-execution calls are not made.
            </p>
          ) : null}

          <div className="mt-6 grid gap-5">
            <div className="grid gap-2">
              <Label htmlFor="url">Page URL</Label>
              <Input
                id="url"
                name="url"
                type="url"
                inputMode="url"
                placeholder="https://"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="howto">How-to</Label>
              <Textarea
                id="howto"
                name="howto"
                placeholder={'1. Open the page.\n2. Enter your email.\n3. Click "Save".'}
                value={howto}
                onChange={(event) => setHowto(event.target.value)}
              />
            </div>
            <details className="rounded-md border border-line px-3 py-2">
              <summary className="cursor-pointer text-sm font-semibold">Paste HTML instead of a URL</summary>
              <div className="mt-3 grid gap-2">
                <Label htmlFor="html">Page HTML</Label>
                <Textarea
                  id="html"
                  name="html"
                  className="min-h-24 font-mono text-sm"
                  placeholder="<button></button>"
                  value={html}
                  onChange={(event) => setHtml(event.target.value)}
                />
                <p className="text-sm text-muted-foreground">Pasted HTML is parsed as the page. A URL next to it is not fetched.</p>
              </div>
            </details>
            <div className="grid gap-2">
              <Label htmlFor="session">Session id</Label>
              <Input
                id="session"
                name="session"
                value={session}
                onChange={(event) => setSession(event.target.value)}
                maxLength={64}
                spellCheck={false}
              />
              <p className="text-sm text-muted-foreground">
                Sent to Otari as the end-user tag for this browser. It is not an account.
              </p>
            </div>
          </div>

          {error ? (
            <p role="alert" className="mt-4 text-sm font-semibold text-break">
              {error}
            </p>
          ) : null}

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button type="submit" disabled={busy} className="sm:min-w-48">
              {busy ? "Checking the first break…" : "Find the first break"}
            </Button>
            <p className="text-sm text-muted-foreground">{busy ? "One loop: read, try, stop." : "Stops at the first stuck step."}</p>
          </div>
        </form>

        <aside className="text-sm leading-relaxed lg:pt-2">
          <h2 className="font-serif text-xl">The loop</h2>
          <ol className="mt-3 grid list-decimal gap-3 pl-5">
            <li>Read the page in screen-reader order.</li>
            <li>Try the how-to until a stranger would stop.</li>
            <li>Rewrite that step, or name the unlabeled control.</li>
          </ol>
        </aside>

        {result ? (
          <div className="grid gap-6 lg:col-span-2">
            <section className="rounded-lg border border-line bg-card p-4 sm:p-6" aria-labelledby="reading-order">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="reading-order" className="font-serif text-2xl">01 Reading order</h2>
                {result.readingOrder ? <Badge variant="outline">{result.readingOrder.parser}</Badge> : null}
              </div>
              {result.readingOrder ? (
                <>
                  <p className="mt-3 max-w-3xl leading-relaxed">{result.readingOrder.prose}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{sourceLabel(result.readingOrder.proseFrom, result.otari.models.narrator.served)}</p>
                  {result.readingOrder.note ? <p className="mt-3 text-sm text-muted-foreground">{result.readingOrder.note}</p> : null}
                  <ol className="mt-5 grid gap-2">
                    {result.readingOrder.items.map((item) => {
                      const marked = flagged.has(item.ref) || breakRefs.has(item.ref)
                      return (
                        <li key={item.ref} className="grid grid-cols-[3.5rem_1fr] gap-3 border-t border-line py-2">
                          <span className={`pt-0.5 font-mono text-xs ${marked ? "text-break" : "text-muted-foreground"}`}>{item.ref}</span>
                          <span>
                            <span className="block text-xs uppercase tracking-wide text-muted-foreground">
                              {item.kind === "heading" ? `Heading ${item.level}` : item.kind === "title" ? "Document title" : item.tag}
                            </span>
                            <span className={marked ? "font-semibold text-break" : ""}>{itemLabel(item)}</span>
                          </span>
                        </li>
                      )
                    })}
                  </ol>
                  {result.readingOrder.issues.length > 0 ? (
                    <ul className="mt-4 grid gap-2">
                      {result.readingOrder.issues.map((issue) => (
                        <li key={`${issue.ref}-${issue.kind}`}>
                          <Badge variant="break">{issue.kind}</Badge> <span className="text-sm">{issue.detail}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-4 text-sm text-pass">No skipped heading or missing name in this tree.</p>
                  )}
                </>
              ) : (
                <p className="mt-3 text-muted-foreground">No page was opened, so there is no reading order.</p>
              )}
            </section>

            <section className="rounded-lg border border-line bg-card p-4 sm:p-6" aria-labelledby="attempt">
              <h2 id="attempt" className="font-serif text-2xl">02 The attempt</h2>
              {result.attempt && result.attempt.steps.length > 0 ? (
                <ol className="mt-4 grid gap-3">
                  {result.attempt.steps.map((step) => (
                    <li key={step.index} className="grid gap-1 border-t border-line pt-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={step.status === "stuck" ? "break" : "pass"}>{step.status === "stuck" ? "Stuck" : "Followed"}</Badge>
                        <span className="font-semibold">Step {step.index}</span>
                      </div>
                      <p>{step.text}</p>
                      <p className="text-sm text-muted-foreground">{step.because}</p>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-3">{result.attempt?.stoppedBecause ?? "No how-to was given."}</p>
              )}
              {result.attempt?.steps.length ? <p className="mt-4 text-sm text-muted-foreground">{result.attempt.stoppedBecause}</p> : null}
            </section>

            <section className="rounded-lg border border-mark/40 bg-card p-4 sm:p-6" aria-labelledby="first-break">
              <div className="flex gap-3">
                <span className="mt-1 w-1 shrink-0 rounded-full bg-mark" aria-hidden="true" />
                <div>
                  <p className="font-mono text-xs tracking-[0.18em] text-break">03</p>
                  <h2 id="first-break" className="font-serif text-2xl">{result.firstBreak?.title}</h2>
                  <p className="mt-2 max-w-3xl leading-relaxed">{result.firstBreak?.detail}</p>
                  {result.firstBreak?.stepText ? <p className="mt-3 text-sm text-muted-foreground">Original step: {result.firstBreak.stepText}</p> : null}
                </div>
              </div>
            </section>

            <section className="rounded-lg border border-line bg-card p-4 sm:p-6" aria-labelledby="rewrite">
              <h2 id="rewrite" className="font-serif text-2xl">04 One step</h2>
              {result.rewrite ? (
                <>
                  <p className="mt-3 max-w-3xl text-lg leading-relaxed">{result.rewrite.text}</p>
                  <p className="mt-2 text-sm text-muted-foreground">{sourceLabel(result.rewrite.from, result.otari.models.attempt.served)}</p>
                  {result.rewrite.draft && result.rewrite.from !== "model" ? (
                    <p className="mt-3 text-sm text-muted-foreground">Held draft: {result.rewrite.draft}</p>
                  ) : null}
                </>
              ) : (
                <p className="mt-3 text-muted-foreground">Nothing needed a rewrite.</p>
              )}
            </section>

            {result.ok ? null : (
              <p role="alert" className="text-sm font-semibold text-break">
                {result.error}
              </p>
            )}
            <section className="rounded-lg border border-dashed border-line p-4 sm:p-6" aria-labelledby="otari-run">
              <h2 id="otari-run" className="font-serif text-2xl">What Otari did on this run</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {result.otari.configured ? result.otari.baseUrl : "No API key was configured, so these calls were not made."}
              </p>
              <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
                <div>
                  <dt className="font-semibold">Narrator</dt>
                  <dd>{result.otari.models.narrator.requested}</dd>
                  <dd className="text-muted-foreground">Fallback {result.otari.models.narrator.fallback}</dd>
                  <dd>Served {result.otari.models.narrator.served ?? "not called"}</dd>
                  <dd className="text-muted-foreground">
                    Request {result.otari.models.narrator.requestId ?? "none"} · Otari fallback {String(result.otari.models.narrator.otariFallback)} · client fallback {String(result.otari.models.narrator.clientFallback)}
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold">Attempt</dt>
                  <dd>{result.otari.models.attempt.requested}</dd>
                  <dd className="text-muted-foreground">Fallback {result.otari.models.attempt.fallback}</dd>
                  <dd>Served {result.otari.models.attempt.served ?? "not called"}</dd>
                  <dd className="text-muted-foreground">
                    Request {result.otari.models.attempt.requestId ?? "none"} · Otari fallback {String(result.otari.models.attempt.otariFallback)} · client fallback {String(result.otari.models.attempt.clientFallback)}
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold">Fetch</dt>
                  <dd>{result.otari.fetch.status}</dd>
                  <dd className="text-muted-foreground">{result.otari.fetch.detail}</dd>
                  <dd>Request {result.otari.fetch.requestId ?? "none"}</dd>
                </div>
                <div>
                  <dt className="font-semibold">Search</dt>
                  <dd>{result.otari.search.status}</dd>
                  <dd className="text-muted-foreground">{result.otari.search.detail}</dd>
                  <dd>Request {result.otari.search.requestId ?? "none"}</dd>
                </div>
                <div>
                  <dt className="font-semibold">Code execution</dt>
                  <dd>{result.otari.codeExecution.status} · {result.otari.codeExecution.parser}</dd>
                  <dd className="text-muted-foreground">{result.otari.codeExecution.detail}</dd>
                  <dd>Request {result.otari.codeExecution.requestId ?? "none"}</dd>
                </div>
                <div>
                  <dt className="font-semibold">Guardrails</dt>
                  <dd>
                    {result.otari.guardrails.profile} · {result.otari.guardrails.mode} · if unavailable {result.otari.guardrails.onUnavailable}
                  </dd>
                  <dd className="break-words text-muted-foreground">{result.otari.guardrails.header ?? "No Otari-Guardrails header on this run."}</dd>
                </div>
                <div>
                  <dt className="font-semibold">Budget</dt>
                  <dd>Key remaining before {money(result.otari.budget.before?.remainingUsd)} · after {money(result.otari.budget.after?.remainingUsd)}</dd>
                  <dd>
                    Session {money(result.otari.budget.sessionSpentUsd)} across {result.otari.budget.sessionCalls} calls, ceiling {money(result.otari.budget.sessionCeilingUsd)}
                  </dd>
                  <dd className="text-muted-foreground">End user: {result.otari.budget.endUserMode}</dd>
                </div>
                <div>
                  <dt className="font-semibold">MCP</dt>
                  <dd>{result.otari.mcp.status}</dd>
                  <dd className="text-muted-foreground">{result.otari.mcp.detail}</dd>
                </div>
              </dl>
              <h3 className="mt-5 text-sm font-semibold">App rules checked</h3>
              <ul className="mt-2 grid gap-1 text-sm">
                {result.otari.guardrails.appRules.map((rule) => (
                  <li key={rule}>{rule}</li>
                ))}
              </ul>
              <p className="mt-3 text-sm">
                {result.otari.guardrails.held.length ? `Held: ${result.otari.guardrails.held.join(" ")}` : "Held: nothing on this run."}
              </p>
            </section>
          </div>
        ) : null}
      </main>
    </div>
  )
}
