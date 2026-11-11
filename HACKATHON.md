# First Break — Mozilla Otari Hackathon

First Break lets someone check a page the way a stranger would, and it stops at the first place that stranger gets stuck.

## Otari features used

These are implemented against the hosted API at `https://api.otari.ai/api/v1` (EU override via `OTARI_BASE_URL`). This workspace had no `OTARI_API_KEY`, so none of the rows below were executed against production Otari. Tests use recorded responses. There is no invented request id.

| Feature | How it is used |
| --- | --- |
| Chat completions | Two open-weight models, two jobs |
| Web fetch | `POST /api/v1/fetch` with `builtin_fetch` for a public URL |
| Web search | `POST /api/v1/search` when the how-to names a site or product and no page was given |
| Code execution | `POST /api/v1/code/execute` parses HTML into reading order |
| Routing / fallback | Catalog id (Otari falls across offerings) plus a client retry to another open-weight model on a failure before any answer. Optional dashboard policy names via env |
| Guardrails | `guardrails` on every chat (`prompt-injection`, monitor, `on_unavailable: monitor`) and app rules that reject invented steps, names, and issues |
| Budgets | `GET /api/v1/key/budget` before and after, plus a per-session ceiling from `usage.cost_usd` |
| End users | Session id in `metadata.end_user`. `user` and `GET /api/v1/end-users` when the key is a service key |
| MCP | Request field is wired. It is not called unless `OTARI_MCP_SERVER_URL` is public https. No MCP call is claimed in this repo |

## Open-weight models

Confirmed open-weight on the models.dev catalog Otari documents, not by a live `GET /api/v1/catalog/models` (that route needs a key). Both roles are open-weight. Ids are env-overridable.

| Job | Primary | If that call fails before an answer |
| --- | --- | --- |
| Narrate the screen-reader order from the parsed tree | `alibaba/qwen3-32b` | `google/gemma-3-27b-it` |
| Try the how-to, name the first break, draft the one step | `meta/llama-3.3-70b-instruct` | `mistral/mistral-small-3.2-24b-instruct` |

A closed model is not one of these four.

## Code pointers

- Loop: `server/src/loop.ts`
- Otari client: `server/src/otari/client.ts`
- Parser sent to code execution: `server/parser/reading_order.py`, wrapped by `server/src/parser/tree.ts`
- Do-not-invent checks: `server/src/guard.ts`, `server/src/follow.ts`
- Fetch / search allow-list: `server/src/urls.ts`
- Fixture page: `fixture/broken.html`
- UI: `client/src/App.tsx`

## What was not verified live

- No production Otari request was made from this environment.
- The four model ids may need the exact selector from the workspace Models page.
- `builtin_fetch` returns extracted text. Public pages can lose controls the extractor drops. The fixture demo uses the raw HTML file.
- Creating a routing policy, a service-key end-user budget, a mandated guardrail, and a stored MCP server are dashboard steps. A workspace `otk_` key cannot do them. The README lists the clicks.
- MCP was not invoked. The attempt call adds `mcp_servers` only for a public https URL, and the UI shows a call only when Otari returns `otari_tool_calls`.

No issue or pull request was opened on `mozilla-ai/otari`. The docs used here were consistent enough to implement against, and there was no live API failure to report.

## Submission checklist

- Public GitHub repo (create it yourself; this draft was not published).
- Branch name `devs-wilding`.
- The first commit on `devs-wilding` is the Otari integration.
- Demo is a screen recording in your own voice. No AI voice. `DEMO.md` is the script. End with “Thanks for watching.”
- Written answers are enough for the feedback questions.
- Do not file placeholder issues or pull requests on `https://github.com/mozilla-ai/otari`.
