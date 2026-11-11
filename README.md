# First Break

First Break checks a page the way a stranger would, and stops at the first place they get stuck.

Paste a URL, a how-to, or both. The app runs one loop:

1. If there is a page, it builds the heading and control order a screen reader would meet, and flags a missing accessible name or a skipped heading level.
2. If there is a how-to, it tries those steps against the page (or against the steps alone) and stops at the first step a stranger cannot finish.
3. It rewrites only that step, or names the unlabeled control. It does not rewrite the rest.

Hosted [Otari](https://otari.ai) does the model calls, the public fetch, the web search, and the HTML parse. The browser never sees the API key.

## Run it

```bash
npm install
npm install --prefix client
npm install --prefix server
cp .env.example .env
# put your otk_ key in .env
npm run dev
```

Open [http://127.0.0.1:43123](http://127.0.0.1:43123). The client proxies `/api` and `/fixture` to the server on port `43124`.

Click **Load the broken demo**. That fills the bundled page and a how-to that does not match it: the page skips from `h1` to `h3`, the submit button has no accessible name, and step 3 says to click “Reserve my seat”.

**Open the broken page** shows the fixture itself: [http://127.0.0.1:43123/fixture/broken.html](http://127.0.0.1:43123/fixture/broken.html).

A public `http` or `https` URL is fetched with Otari. A private or loopback address is refused, except this app’s own `/fixture/broken.html`, which is read from disk because Otari will not fetch loopback. You can also paste HTML. Pasted HTML is the page, and the URL beside it is not fetched.

```bash
npm test
npm run typecheck
npm run build
npm start
```

`npm start` serves the built client and the API on `PORT` (default `43124`).

The local parser fallback needs `python3` on `PATH`.

## Environment

See `.env.example`. The only secret is `OTARI_API_KEY`. It stays on the server. Do not put it in a `VITE_` variable.

| Variable | Role |
| --- | --- |
| `OTARI_BASE_URL` | `https://api.otari.ai/api/v1`, or `https://eu.api.otari.ai/api/v1` for an EU account |
| `OTARI_NARRATOR_MODEL` | Open-weight model that narrates the reading order |
| `OTARI_NARRATOR_FALLBACK` | Open-weight model used if that call fails before an answer |
| `OTARI_ATTEMPT_MODEL` | Open-weight model that finds the first break and drafts the one step |
| `OTARI_ATTEMPT_FALLBACK` | Open-weight fallback for that call |
| `OTARI_NARRATOR_POLICY` / `OTARI_ATTEMPT_POLICY` | Optional dashboard routing-policy names. When set, they replace the catalog id sent as `model` |
| `OTARI_SERVICE_KEY` | `auto` (default), `true`, or `false`. See budgets below |
| `OTARI_END_USER_BUDGET_ID` | Optional end-user budget id, sent as `Otari-End-User-Budget` |
| `OTARI_GUARDRAIL_PROFILE` | Default `prompt-injection` |
| `OTARI_GUARDRAIL_MODE` | `monitor` or `block` |
| `OTARI_GUARDRAIL_ON_UNAVAILABLE` | `monitor` or `block` |
| `FIRST_BREAK_SESSION_USD` | App ceiling for one session id |
| `OTARI_MCP_SERVER_URL` | Optional public `https` MCP server |

This environment had no `OTARI_API_KEY`, so the hosted catalog was not listed from `GET /api/v1/catalog/models`. The default ids are models.dev canonical ids (`vendor/model`), which is the catalog id Otari documents. They were open-weight in the models.dev snapshot read while building this app. Confirm them on the workspace Models page and override the env vars if the hosted catalog spells them differently. Do not point either role at a closed model.

| Role | Default id | Fallback |
| --- | --- | --- |
| Narrate the reading order | `alibaba/qwen3-32b` | `google/gemma-3-27b-it` |
| Find the first break and draft one step | `meta/llama-3.3-70b-instruct` | `mistral/mistral-small-3.2-24b-instruct` |

## Where Otari is used

All of these go through `server/src/otari/client.ts`. The loop that decides when to call them is `server/src/loop.ts`.

| Feature | Call | Where |
| --- | --- | --- |
| Chat, two models | `POST /api/v1/chat/completions` | Narrator and attempt in `loop.ts` |
| Catalog-id routing | The catalog id is sent as `model`, so Otari can fall across offerings. `Otari-Model`, `Otari-Fallback`, and `Otari-Attempt-Count` are kept on the trace | `client.ts` |
| Client fallback | On 408, 424, 429, 500, 502, 503, or 504 before an answer, the same call is sent to the other open-weight model | `OtariClient.chat` |
| Dashboard routing policy | Set `OTARI_*_POLICY` to a policy name. A workspace `otk_` key cannot create policies | env + README dashboard steps |
| Fetch | `POST /api/v1/fetch` with `fetch_tool_name: "builtin_fetch"` for a public URL | `loop.ts` |
| Search | `POST /api/v1/search` when the how-to names a domain or “on Product” and there is no page. A result is fetched only when its host is a domain the steps named | `urls.ts`, `loop.ts` |
| Code execution | `POST /api/v1/code/execute` runs `server/parser/reading_order.py` (stdlib only) | `parser/tree.ts` |
| Local parse | The same script via `python3` only if that call fails, or when no key is set | `parseWithLocalPython` |
| Guardrails | Top-level `guardrails` on every chat: profile, mode, `on_unavailable` | `client.ts` |
| App rules | Drop invented names, extra steps, and accessibility claims that are not in the tree. Do not fetch an unnamed site | `guard.ts`, `urls.ts` |
| Key budget | `GET /api/v1/key/budget` before and after a run | `loop.ts` |
| End user | Session id in `metadata.end_user` on every chat. `user` is sent for a service key. `GET /api/v1/end-users?external_id=` only after Otari accepts `user` | `client.ts` |
| Session ceiling | `usage.cost_usd` is summed per session id, capped by `FIRST_BREAK_SESSION_USD` | `sessions.ts` |
| MCP | `mcp_servers` is added to the attempt call only when `OTARI_MCP_SERVER_URL` is public `https`. A call is shown only if `otari_tool_calls` contains one | `client.ts` |

`builtin_fetch` returns extracted text, not the raw document. The reading-order note says so. The fixture path uses the real HTML, so the demo’s missing name and skipped heading are on the document, not on an extract.

## Dashboard steps this key cannot do by itself

Routing policy (optional, so failover stays inside Otari):

1. Workspace → Routing → Policies → Create policy → Fallback.
2. Name it `first-break-narrate` (no `:` or `/`). Main model: the narrator id. If unavailable: the narrator fallback.
3. Create `first-break-attempt` the same way for the attempt pair.
4. Set `OTARI_NARRATOR_POLICY=first-break-narrate` and `OTARI_ATTEMPT_POLICY=first-break-attempt`.

End-user budget:

1. Organization → Spend & budgets → Add budget. Give it a small daily USD limit.
2. API keys → Create key → Advanced → Service key. Put that budget under End-user budgets and set it as the default. Copy the key into `OTARI_API_KEY`.
3. Optional: copy the budget id into `OTARI_END_USER_BUDGET_ID`.

Guardrail, if you want it to block rather than report `unavailable`:

1. Organization → Guardrails → Configure guardrail, then Mandate it for this workspace.
2. Set `OTARI_GUARDRAIL_MODE=block` only after a test on that page succeeds. Until a profile exists, leave mode and `on_unavailable` on `monitor` so a missing service does not refuse the demo.

MCP:

1. The server must be a public `https` URL Otari’s gateway can reach. A localhost server will not be called.
2. Either Tools → MCP servers → Add MCP server (name, URL, allowed tools, default policy Allow), or turn on “Let requests name their own MCP servers” and set `OTARI_MCP_SERVER_URL`.
3. New workspaces start with request-named servers off. If the attempt returns an MCP refusal, the app retries that call without the server and records the refusal. It does not claim the tool ran.

Web search and code execution also have to be allowed for the workspace (Tools → Web search, Tools → Code execution). Fetch uses the gateway’s `builtin_fetch`.

## Tests

`npm test` covers the fixture parse, the source string sent to code execution, the do-not-invent checks, URL and search guards, and the Otari client against recorded responses. Nothing in the tests is a live Otari call.

## License

MIT. See `LICENSE`.
