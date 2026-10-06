-- ugreen-vero D1 schema, migration 0001 (VERO Phase 2 pilot).
-- Apply once in the Cloudflare D1 console (or: wrangler d1 migrations apply ugreen-vero).
-- Future changes go in 0002_*.sql, 0003_*.sql ... never edit this file after it is applied.

-- Access codes: one row per person. The code itself is never stored, only SHA-256 of the
-- normalised code (uppercase, letters/digits only). Codes are ~100-bit random, so an unsalted
-- hash is safe. Disable a code (active = 0) to revoke AI access on the very next request.
CREATE TABLE IF NOT EXISTS access_codes (
  id           TEXT PRIMARY KEY,                                   -- e.g. c_admin01 (appears in logs; no names)
  code_hash    TEXT NOT NULL UNIQUE,
  role         TEXT NOT NULL CHECK (role IN ('admin','sales','dealer')),
  label        TEXT,                                               -- optional internal note; never logged or sent to AI
  active       INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  token_epoch  INTEGER NOT NULL DEFAULT 1,                         -- bump to end existing sessions without revoking
  daily_limit  INTEGER,                                            -- NULL = CODE_PER_DAY default
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at   TEXT,
  last_used_at TEXT                                                -- refreshed at most hourly
);

-- Short-window rate-limit counters. Updated with a single conditional UPSERT so a check and
-- its increment are one atomic statement (see worker.js limitStmt()).
CREATE TABLE IF NOT EXISTS counters (
  scope    TEXT NOT NULL,      -- code_min, code_day, ip_min, ip_day, web_code_min, web_code_day, session_fail
  subject  TEXT NOT NULL,      -- code id or daily-rotated IP hash
  win      TEXT NOT NULL,      -- minute / Manila day / 15-minute bucket
  n        INTEGER NOT NULL DEFAULT 0,
  expires  TEXT NOT NULL,
  PRIMARY KEY (scope, subject, win)
);
CREATE INDEX IF NOT EXISTS idx_counters_expires ON counters(expires);

-- Daily totals (Manila day). ai_calls and web_calls also enforce the global daily caps.
CREATE TABLE IF NOT EXISTS daily_stats (
  day           TEXT PRIMARY KEY,
  ai_calls      INTEGER NOT NULL DEFAULT 0,
  web_calls     INTEGER NOT NULL DEFAULT 0,
  web_searches  INTEGER NOT NULL DEFAULT 0,
  cache_hits    INTEGER NOT NULL DEFAULT 0,
  errors        INTEGER NOT NULL DEFAULT 0,
  timeouts      INTEGER NOT NULL DEFAULT 0,
  rate_limited  INTEGER NOT NULL DEFAULT 0,
  capped        INTEGER NOT NULL DEFAULT 0,
  tokens_in     INTEGER NOT NULL DEFAULT 0,
  tokens_out    INTEGER NOT NULL DEFAULT 0,
  micro_usd     INTEGER NOT NULL DEFAULT 0,
  web_micro_usd INTEGER NOT NULL DEFAULT 0
);

-- Monthly budget (UTC month = Anthropic billing month). micro_usd includes in-flight reservations.
CREATE TABLE IF NOT EXISTS spend (
  month         TEXT PRIMARY KEY,                                  -- 2026-10
  micro_usd     INTEGER NOT NULL DEFAULT 0,                        -- total (catalog + web)
  web_micro_usd INTEGER NOT NULL DEFAULT 0,                        -- web share (sub-budget)
  calls         INTEGER NOT NULL DEFAULT 0,
  web_searches  INTEGER NOT NULL DEFAULT 0
);

-- Redacted question log (30 days). Never: AI reply text, full URLs, prices, dealer data, codes, full IPs.
CREATE TABLE IF NOT EXISTS question_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ts            TEXT NOT NULL,
  day           TEXT NOT NULL,
  code_id       TEXT NOT NULL,
  role          TEXT NOT NULL,
  ip_hash       TEXT,
  q_redacted    TEXT NOT NULL,                                     -- <= 120 chars, emails/phones removed
  route         TEXT NOT NULL,                                     -- catalog | web
  trigger       TEXT NOT NULL,                                     -- auto | manual
  n_candidates  INTEGER,
  picks         TEXT,                                              -- item codes; NULL for role = dealer
  confidence    TEXT,
  outcome       TEXT NOT NULL,
  web_searches  INTEGER,
  web_status    TEXT,
  source_domains TEXT,                                             -- domains only, never URLs
  search_query_redacted TEXT,                                      -- <= 120 chars
  tokens_in     INTEGER,
  tokens_out    INTEGER,
  micro_usd     INTEGER,
  latency_ms    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_qlog_day ON question_log(day);

-- Answer cache. Holds validated answers only (item codes, reply, notes, validated sources).
-- Not linked to any user, code, IP or log row. Key includes model, prompt version, catalog ETag,
-- normalised question, sorted candidates and route, so a catalog republish invalidates it.
CREATE TABLE IF NOT EXISTS answer_cache (
  key         TEXT PRIMARY KEY,
  route       TEXT NOT NULL,
  response    TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  hits        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_cache_expires ON answer_cache(expires_at);

CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
INSERT OR IGNORE INTO meta (k, v) VALUES ('schema_version', '1');
