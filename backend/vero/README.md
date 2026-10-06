# ugreen-vero — VERO AI Worker (Phase 2 pilot)

Separate Cloudflare Worker for VERO's AI answers. It is **not** the publish Worker: it has no GitHub
token, no admin password and no access to the dealer store. All its state is in its own D1 database.

```
Browser (GitHub Pages) ── local VERO answer first (free)
   └─ only when AI is needed ──► ugreen-vero  /ask
                                   ├─ AI_WITH_CATALOG: 1 OpenAI Responses call (gpt-6-luna) over P1–P8 candidates
                                   └─ AI_WITH_WEB:     RESEARCH (web search, official sites, 1 search) + COMPOSE
```

Prices (SRP / DP / DP Vol / Special DP / MOQ) are never sent to the model and never come from it —
the browser always shows them from the live pricelist.

## Files
| File | Purpose |
|---|---|
| `worker.js` | The Worker (sessions, routing, limits, budget, Anthropic calls, validation, cache, logs, cleanup) |
| `wrangler.toml` | Config — keep identical to the Cloudflare dashboard |
| `migrations/0001_init.sql` | D1 schema. Future changes: add `0002_*.sql`, never edit an applied file |
| `../../tools/vero-code.mjs` | Create / revoke access codes (prints SQL for the D1 console) |
| `../../tests/vero-worker.test.mjs` | Worker tests (real SQL + fake Anthropic) |
| `../../tests/vero-ai.playwright.py` | End-to-end UI tests with the real Worker logic |

## One-time setup (Cloudflare dashboard)
1. **D1** → Create database `ugreen-vero` → Console → paste `migrations/0001_init.sql` → Execute.
   Put the database id into `wrangler.toml` (`database_id`).
2. **Workers** → Create Worker `ugreen-vero` → paste `worker.js` → Deploy.
3. Worker → Settings → **Bindings** → D1 database → variable name `DB` → `ugreen-vero`.
4. Worker → Settings → **Variables**: add every `[vars]` entry from `wrangler.toml` exactly
   (keep `AI_ENABLED = "false"` and `WEB_ENABLED = "false"` until the pilot is approved).
5. Worker → Settings → **Secrets** (entered by Raffy, never committed):
   - `OPENAI_API_KEY` — from an OpenAI project with a **hard monthly spend limit** (≈ $5)
   - `TOKEN_SIGNING_KEY` — `node tools/vero-code.mjs secret`
   - `IP_HASH_SALT` — `node tools/vero-code.mjs secret`
6. Worker → Settings → **Triggers** → Cron `0 18 * * *` (02:00 Manila daily cleanup).
7. Set `compatibility_date` in `wrangler.toml` to the date shown in the dashboard.
8. OpenAI: the project must have access to `gpt-6-luna` and the Responses API `web_search` tool.
9. Site: `config.js` → `vero.aiEndpoint = "https://ugreen-vero.<subdomain>.workers.dev"`.

## Access codes (no admin UI in Phase 2)
```
node tools/vero-code.mjs new --id c_sales01 --role sales     # prints the code ONCE + an INSERT for the D1 console
node tools/vero-code.mjs revoke --id c_sales01               # disables immediately (next request refused)
node tools/vero-code.mjs logout --id c_sales01               # ends active sessions, code stays valid
node tools/vero-code.mjs restore --id c_sales01
node tools/vero-code.mjs list
```
Only `SHA-256(code)` is stored. Roles allowed to use AI: `AI_ROLES` (pilot: `admin,sales`); web: `WEB_ROLES`.
Dealer codes can be created but are refused until `dealer` is added to `AI_ROLES` (and to the frontend later).

## Provider and model
Production: `PROVIDER = "openai"`, `MODEL = "gpt-6-luna"` (OpenAI Responses API, `reasoning.effort = low`,
strict JSON schema, `web_search` tool with `filters.allowed_domains`, `max_tool_calls = 1`, `store = false`).
The model appears only in configuration, never in code paths. An Anthropic adapter remains in `worker.js` as an
option (`PROVIDER = "anthropic"` + `ANTHROPIC_API_KEY`) but nothing in production depends on it.

To switch or update the model:
1. Check the model's API ID, structured-output and web-search support, and price on the provider's official pages.
2. Update **both** the dashboard variables and `wrangler.toml`: `MODEL`, `PRICE_IN_PER_MTOK`, `PRICE_OUT_PER_MTOK`
   (and `PROVIDER`, `WEB_TOOL_VERSION`, `REASONING_EFFORT` if needed).
3. Run `node tests/vero-worker.test.mjs` (and `VERO_TEST_PROVIDER=anthropic node tests/vero-worker.test.mjs`), then a few live questions.
No automatic model migration exists. `gpt-6-luna` has no dated snapshot, so OpenAI may update it in place.
If the model becomes unavailable the Worker answers `model_unavailable` and VERO falls back to local answers.

## Kill switches (fastest first)
| Switch | Where | Effect |
|---|---|---|
| `AI_ENABLED = "false"` | Worker variable | All AI answers stop instantly; local VERO unaffected |
| `WEB_ENABLED = "false"` | Worker variable | Web-verified answers stop; catalog AI continues |
| `aiEnabled / webEnabled: false` | site `config.js` | AI UI hidden — VERO behaves exactly like Phase 1 |
| revoke a code | D1 console | That person loses AI on their next request |
| disable key / lower limit | OpenAI project (hard spend limit) | No AI spend possible |

## Limits and budget (pilot)
4/min & 20/day per code · 6/min & 30/day per IP · 60/day global · web: 1/min & 3/day per code, 4/day global ·
monthly budget $4.50 (UTC month) with a $2.00 web sub-budget · OpenAI project hard spend limit ≈ $5 as backstop.
Each call reserves its worst-case cost first (catalog $0.007, web $0.08) and is settled to the actual
token + search cost afterwards; failed answers do not use the daily quota.

## Logs (D1 `question_log`, 30 days)
Redacted question (≤120 chars, emails/phones removed), redacted search query, route, trigger, candidate count,
picked item codes (not for dealers), confidence, outcome, source **domains**, tokens, cost, latency,
daily-rotating IP hash. Never: AI reply text, URLs, prices, dealer data, codes, keys, full IPs.

## CPU (Workers Free: 10 ms per request)
The 1.6 MB catalog is not JSON-parsed as a whole: each candidate's object is located by its `item_code`
and only that slice is parsed. Check **Metrics → CPU time** and Workers Logs (`"vero":1` lines carry
`path`, `catalog: cold|warm`, `outcome`) after deploy. Do not upgrade the plan without approval.
