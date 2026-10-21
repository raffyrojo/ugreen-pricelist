-- ugreen-vero D1 schema, migration 0003 (UNO B2a, 2026-10-21): anonymous UNO answer events + wrong-answer feedback.
-- Apply once in the Cloudflare D1 console after 0001 / 0002. Additive only (new tables + indexes); safe to re-run.
-- The Worker writes these tables only when EVENTS_ENABLED = "true" (absent = off) and tolerates their absence in cleanup.
--
-- Privacy (owner D3 / D4 / D5 / D18): a random per-page-visit sid, a coarse role label and redacted question text (<= 120 chars).
-- NEVER stored: IP or IP hash, user agent, prices, dealer identity, username, access code, token, UNO / AI reply text,
-- feedback free text. Retention: uno_events / uno_feedback = LOG_RETENTION_DAYS (30), uno_daily (counts only) = 400 days.
-- Index writes count as D1 rows written (Free plan: 100,000 / day), so each raw table has exactly one index (day) and no
-- AUTOINCREMENT (fix round 1, FR1).

CREATE TABLE IF NOT EXISTS uno_events (
  id              INTEGER PRIMARY KEY,           -- rowid; no AUTOINCREMENT (it would write sqlite_sequence on every insert)
  ts              TEXT NOT NULL,                 -- server time (client time ignored)
  day             TEXT NOT NULL,                 -- Manila day
  sid             TEXT NOT NULL,                 -- random per page visit; never linked to a code, dealer or IP
  seq             INTEGER NOT NULL,              -- turn number within the visit
  role            TEXT NOT NULL,                 -- anon | dealer | sales | admin | admin_ui (label only)
  engine          TEXT NOT NULL,                 -- VeroEngine version
  data_ver        TEXT,                          -- catalogue ETag known to the Worker (meta.catalog_version)
  data_checked_at TEXT,                          -- when that ETag was last checked (meta.catalog_checked_at)
  q_redacted      TEXT NOT NULL,                 -- redacted question, <= 120 chars
  chip            INTEGER NOT NULL DEFAULT 0,    -- 1 = a chip label, not typed text
  type            TEXT NOT NULL,                 -- lookup | list | compare | clarify | none | text | smalltalk
  outcome         TEXT NOT NULL,                 -- answered | clarify | honest_negative | no_match | error | smalltalk
  codes           TEXT,                          -- item codes shown that exist in the catalogue (<= 12, comma-separated)
  n_codes         INTEGER NOT NULL DEFAULT 0,
  category        TEXT,                          -- derived by the Worker from the codes
  route           TEXT NOT NULL,                 -- local | ai | web
  ai_trigger      TEXT NOT NULL,                 -- none | auto | manual
  lang            TEXT NOT NULL,                 -- en | tl
  followup        INTEGER NOT NULL DEFAULT 0,
  act             TEXT NOT NULL                  -- none | details | chip | more
);
CREATE INDEX IF NOT EXISTS idx_uno_events_day ON uno_events(day);

CREATE TABLE IF NOT EXISTS uno_feedback (
  id       INTEGER PRIMARY KEY,
  ts       TEXT NOT NULL,
  day      TEXT NOT NULL,
  sid      TEXT NOT NULL,
  seq      INTEGER NOT NULL,
  role     TEXT NOT NULL,
  engine   TEXT NOT NULL,
  data_ver TEXT,
  reason   TEXT NOT NULL CHECK (reason IN ('wrong_product','wrong_spec','missing_product','other'))
);
CREATE INDEX IF NOT EXISTS idx_uno_feedback_day ON uno_feedback(day);

-- Daily counts only (no text): metric outcome / route / lang / role / feedback / sessions (rolled up from the raw tables by the
-- cleanup) and dropped (written live when a rate limit refuses events).
CREATE TABLE IF NOT EXISTS uno_daily (
  day    TEXT NOT NULL,
  metric TEXT NOT NULL,
  dim    TEXT NOT NULL DEFAULT '',
  n      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, metric, dim)
);

-- meta key written by the Worker (not here): uno_rollup_day (last Manila day rolled up into uno_daily)
INSERT INTO meta (k, v) VALUES ('schema_version', '3') ON CONFLICT (k) DO UPDATE SET v = '3';
