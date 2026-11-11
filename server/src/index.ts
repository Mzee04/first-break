import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { existsSync, readFileSync, statSync } from "node:fs"
import { dirname, extname, join, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { loadConfig } from "./config.js"
import { loadDotEnv } from "./env.js"
import { FIXTURE_HOWTO, fixtureHtmlPath } from "./fixture.js"
import { runCheck } from "./loop.js"
import { createOtariClient } from "./otari/client.js"
import { SessionLedger } from "./sessions.js"

const here = dirname(fileURLToPath(import.meta.url))
loadDotEnv(here)
const config = loadConfig()
const ledger = new SessionLedger()
const otari = createOtariClient(config)

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(payload),
  })
  res.end(payload)
}

function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolveBody, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on("data", (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error("The request is too large."))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")))
    req.on("error", reject)
  })
}

function clientDist(): string | null {
  const candidates = [resolve(here, "../../client/dist"), resolve(here, "../../../client/dist")]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

function sendFile(res: ServerResponse, file: string): void {
  const body = readFileSync(file)
  res.writeHead(200, {
    "Content-Type": TYPES[extname(file)] || "application/octet-stream",
    "Content-Length": body.length,
    "Cache-Control": file.endsWith(".html") ? "no-store" : "public, max-age=3600",
  })
  res.end(body)
}

function health() {
  return {
    ok: true,
    product: "First Break",
    otariConfigured: Boolean(config.apiKey),
    baseUrl: config.otariBaseUrl,
    models: {
      narrator: config.narratorPolicy || config.narratorModel,
      narratorFallback: config.narratorFallback,
      attempt: config.attemptPolicy || config.attemptModel,
      attemptFallback: config.attemptFallback,
    },
    guardrail: {
      profile: config.guardrailProfile,
      mode: config.guardrailMode,
      onUnavailable: config.guardrailOnUnavailable,
    },
    mcpConfigured: Boolean(config.mcpServerUrl),
    sessionCeilingUsd: config.sessionBudgetUsd,
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`)
    if (req.method === "GET" && url.pathname === "/api/health") {
      send(res, 200, health())
      return
    }
    if (req.method === "GET" && url.pathname === "/api/fixture") {
      send(res, 200, { path: "/fixture/broken.html", howto: FIXTURE_HOWTO, title: "Saturday workshop" })
      return
    }
    if (req.method === "GET" && url.pathname === "/fixture/broken.html") {
      sendFile(res, fixtureHtmlPath())
      return
    }
    if (req.method === "POST" && url.pathname === "/api/check") {
      const raw = await readBody(req, 600_000)
      let body: Record<string, unknown>
      try {
        body = JSON.parse(raw) as Record<string, unknown>
      } catch {
        send(res, 400, { ok: false, error: "The request was not JSON." })
        return
      }
      const sessionId = typeof body.sessionId === "string" && body.sessionId.trim() ? body.sessionId.trim() : `guest${Date.now().toString(36)}`
      if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(sessionId)) {
        send(res, 400, { ok: false, error: "Use a session id of letters, numbers, and . _ : -." })
        return
      }
      const result = await runCheck(
        {
          url: typeof body.url === "string" ? body.url : "",
          html: typeof body.html === "string" ? body.html : "",
          howto: typeof body.howto === "string" ? body.howto : "",
          sessionId,
          requestHost: req.headers.host,
        },
        { config, otari, ledger },
      )
      send(res, result.ok ? 200 : 400, result)
      return
    }
    const dist = clientDist()
    if (dist && req.method === "GET" && !url.pathname.includes("\0")) {
      const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "")
      const file = relative && !relative.includes("..") ? resolve(dist, relative) : join(dist, "index.html")
      const inside = file === dist || file.startsWith(dist + sep)
      if (inside && existsSync(file) && statSync(file).isFile()) {
        sendFile(res, file)
        return
      }
      const index = join(dist, "index.html")
      if (existsSync(index)) {
        sendFile(res, index)
        return
      }
    }
    send(res, 404, { ok: false, error: "Not found." })
  } catch (error) {
    const message = error instanceof Error ? error.message : "The check failed."
    send(res, 500, { ok: false, error: message.slice(0, 300) })
  }
})

server.listen(config.port, "0.0.0.0", () => {
  console.log(`First Break listening on http://0.0.0.0:${config.port}`)
})
