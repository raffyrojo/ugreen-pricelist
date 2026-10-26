/* UNO owner dashboard Worker "uno-dashboard" - DB1 owner gate shell (owner decision 2026-10-24; design:
 * Deliverables/UNO-Admin-Dashboard/UNO-Owner-Dashboard-Design-2026-10-24.md, decisions OD1-OD6).
 *
 * Only the owner may use it. Cloudflare Access (one-email policy + MFA) sits in front of the Worker's hostname; this
 * Worker does NOT trust Access alone: every request must carry a valid Access JWT (Cf-Access-Jwt-Assertion, RS256, signed
 * by the team's Access keys, aud = ACCESS_AUD, iss = ACCESS_TEAM_DOMAIN, not expired) whose email equals OWNER_EMAIL.
 * VERO access codes and admin:read tokens are never accepted. Anything missing or wrong fails closed.
 *
 *   GET  /              -> owner page: fixed "Back to Admin" link (DB2a, ADMIN_RETURN_URL) + DB2b aggregate analytics, rendered
 *                          on the server (no script); "Data unavailable" when the D1 binding is absent or does not answer
 *   GET  /app.css       -> stylesheet for the page
 *   POST /api/whoami    -> { ok, role: 'owner', exp }   (same-origin only; no data)
 *
 * No CORS headers, no cookies or storage of its own, no log lines, no writes. D1 (binding DB = ugreen-vero, DB2b) is read only
 * after the kill switch and the owner check, and only through the six fixed SELECT statements in SQL.
 * Settings (Cloudflare dashboard; never in the repo): DASHBOARD_ENABLED (var, exactly "true" to serve; kill switch),
 * OWNER_EMAIL, ACCESS_AUD, ACCESS_TEAM_DOMAIN (secrets; team domain = https://<team>.cloudflareaccess.com); binding DB (DB2b). */

export const JWT_HEADER = 'cf-access-jwt-assertion';
export const CLOCK_SKEW_SEC = 30;
export const CERTS_TTL_MS = 600000;        // Access signing keys cached 10 min per isolate
export const CERTS_REFETCH_MS = 60000;     // an unknown key id re-fetches the keys at most once a minute
export const CERTS_BACKOFF_MS = 10000;     // after a failed key fetch, answer auth_unavailable for 10 s without fetching
export const CERTS_FETCH_TIMEOUT_MS = 5000; // a key fetch that does not answer is aborted (fix round 2, QA-DB1-7)
export const CERTS_INFLIGHT_MAX_MS = 10000; // a shared in-flight key fetch is reused only this long (fix round 2, QA-DB1-7)
const TEAM_RE = /^https:\/\/[a-z0-9][a-z0-9-]{0,62}\.cloudflareaccess\.com$/;
const EMAIL_RE = /^[\x21-\x7e]+@[\x21-\x7e]+$/;   // printable ASCII only: no Unicode look-alikes, no spaces (fix round 1, QA-DB1-1)
const enc = new TextEncoder();
const utf8 = new TextDecoder();

/* ------------------------------------------------------------------ config */
export function cfg(env) {
  const team = String(env.ACCESS_TEAM_DOMAIN || '').trim().replace(/\/+$/, '');
  const ownerRaw = String(env.OWNER_EMAIL || '').trim();
  return {
    enabled: String(env.DASHBOARD_ENABLED) === 'true',
    ownerRaw,                                   // checked before lower-casing (fix round 2, QA-DB1-11)
    owner: normEmail(ownerRaw),
    aud: String(env.ACCESS_AUD || '').trim(),
    team: TEAM_RE.test(team) ? team : '',
  };
}
export function normEmail(s) { return String(s || '').trim().toLowerCase(); }
function configured(c) { return EMAIL_RE.test(c.ownerRaw) && c.aud.length >= 16 && !!c.team; }

/* ------------------------------------------------------------------ JWT (Cloudflare Access, RS256) */
function b64urlDecode(s) {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]*$/.test(s)) throw new Error('b64');
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}
/* Per isolate: kid -> CryptoKey. Concurrent loads share one fetch (fix round 1, QA-DB1-2) for at most CERTS_INFLIGHT_MAX_MS, the
   fetch itself times out, and a failure backs off from the time it arrived (fix round 2, QA-DB1-7 / QA-DB1-10). A load resolves to
   its own { team, keys }; callers never read keys another team's load put in the shared cache (fix round 2, QA-DB1-8). */
const CERTS = { team: '', at: 0, tried: 0, keys: new Map(), inflight: null, inflightTeam: '', inflightAt: 0, failTeam: '', failedAt: 0 };
function loadCerts(team, now) {
  if (CERTS.inflight && CERTS.inflightTeam === team && now - CERTS.inflightAt < CERTS_INFLIGHT_MAX_MS) return CERTS.inflight;
  if (CERTS.failTeam === team && now - CERTS.failedAt < CERTS_BACKOFF_MS) return Promise.reject(new Error('certs_backoff'));
  // only the current load writes shared state; a load that a newer one replaced just returns / rethrows (fix round 3, QA-DB1-12)
  const p = fetchCerts(team).then(keys => {
    if (CERTS.inflight === p) { CERTS.team = team; CERTS.at = now; CERTS.keys = keys; CERTS.failTeam = ''; }
    return { team, keys };
  }, e => {
    if (CERTS.inflight === p) { CERTS.failTeam = team; CERTS.failedAt = Math.max(now, Date.now()); }
    throw e;
  });
  CERTS.inflight = p; CERTS.inflightTeam = team; CERTS.inflightAt = now;
  const clear = () => { if (CERTS.inflight === p) CERTS.inflight = null; };
  p.then(clear, clear);
  return p;
}
async function fetchCerts(team) {
  const r = await fetch(team + '/cdn-cgi/access/certs', { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(CERTS_FETCH_TIMEOUT_MS) });
  if (!r.ok) throw new Error('certs_http');
  const j = await r.json();
  const keys = new Map();
  for (const k of (j && Array.isArray(j.keys) ? j.keys : [])) {
    if (!k || k.kty !== 'RSA' || typeof k.kid !== 'string' || typeof k.n !== 'string' || typeof k.e !== 'string') continue;
    if (k.alg !== undefined && k.alg !== 'RS256') continue;
    keys.set(k.kid, await crypto.subtle.importKey('jwk', { kty: 'RSA', n: k.n, e: k.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']));
  }
  if (!keys.size) throw new Error('certs_empty');
  return keys;
}
async function keyFor(team, kid, now) {
  const fresh = CERTS.team === team && now - CERTS.at < CERTS_TTL_MS;
  if (fresh && CERTS.keys.has(kid)) return CERTS.keys.get(kid);
  if (fresh && now - CERTS.tried < CERTS_REFETCH_MS) return null;   // unknown kid, keys fetched moments ago
  CERTS.tried = now;
  const got = await loadCerts(team, now);
  return got && got.team === team ? got.keys.get(kid) || null : null;
}
export function _resetCerts() {
  Object.assign(CERTS, { team: '', at: 0, tried: 0, keys: new Map(), inflight: null, inflightTeam: '', inflightAt: 0, failTeam: '', failedAt: 0 });
}

/* Returns the verified claims, or null. Throws only when the Access keys cannot be loaded. */
export async function verifyAccessJwt(token, c, now) {
  if (typeof token !== 'string' || token.length > 8192) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  let head, claims;
  try {
    head = JSON.parse(utf8.decode(b64urlDecode(parts[0])));
    claims = JSON.parse(utf8.decode(b64urlDecode(parts[1])));
  } catch (_) { return null; }
  if (!head || head.alg !== 'RS256' || typeof head.kid !== 'string' || !claims || typeof claims !== 'object') return null;
  if (head.crit !== undefined) return null;   // no critical extensions are understood (RFC 7515 4.1.11; QA-DB1-4)
  const key = await keyFor(c.team, head.kid, now);
  if (!key) return null;
  let sigOk = false;
  try { sigOk = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlDecode(parts[2]), enc.encode(parts[0] + '.' + parts[1])); }
  catch (_) { return null; }
  if (!sigOk) return null;
  const sec = Math.floor(now / 1000);
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (aud.indexOf(c.aud) < 0) return null;
  if (claims.iss !== c.team) return null;
  if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_SEC < sec) return null;
  if (claims.nbf !== undefined && (typeof claims.nbf !== 'number' || claims.nbf - CLOCK_SKEW_SEC > sec)) return null;
  if (typeof claims.email !== 'string') return null;   // service tokens carry common_name, never email
  if (!EMAIL_RE.test(claims.email)) return null;       // compared only after this, so lower-casing cannot fold look-alikes
  return claims;
}
/* Equal-length digests compared without an early exit. */
async function sameEmail(a, b) {
  const [x, y] = await Promise.all([a, b].map(s => crypto.subtle.digest('SHA-256', enc.encode(s))));
  const u = new Uint8Array(x), v = new Uint8Array(y);
  let d = 0;
  for (let i = 0; i < u.length; i++) d |= u[i] ^ v[i];
  return d === 0;
}

/* ------------------------------------------------------------------ HTTP */
const CSP = "default-src 'none'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
function headers(type) {
  return {
    'content-type': type, 'cache-control': 'no-store', 'content-security-policy': CSP, 'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer', 'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin', 'permissions-policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
    'strict-transport-security': 'max-age=31536000',
  };
}
function json(body, status) { return new Response(JSON.stringify(body), { status: status || 200, headers: headers('application/json; charset=utf-8') }); }
function fail(status, error) { return json({ ok: false, error }, status); }

/* DB2a: the dashboard opens in the admin's own tab (same-tab launch from the Admin sidebar, no frame); this fixed link returns
   there. A constant, never a request parameter (no open redirect); the fragment carries no data. */
export const ADMIN_RETURN_URL = 'https://raffyrojo.github.io/ugreen-pricelist/#uno-return';
const HEAD = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<meta name="robots" content="noindex,nofollow"><title>UNO Analytics</title><link rel="stylesheet" href="/app.css"></head>' +
  '<body><main><a class="back" href="' + ADMIN_RETURN_URL + '">&larr; Back to Admin</a><h1>UNO Analytics</h1>';
const COVERAGE = '<p class="cov"><b>Coverage:</b> staff UNO AI answers only (admin and sales). Local UNO answers, visitor and dealer ' +
  'questions, and requests refused before the AI call are not logged. UNO event logging is off. Low confidence and "no product ' +
  'suggested" are signals for review, not proven errors.</p>';
const UNAVAILABLE = '<p class="sub">Signed in as the owner.</p>' + COVERAGE +
  '<p class="unavail">Data unavailable: the analytics database is not connected or did not answer. No numbers are shown.</p>';
const CSS = 'body{margin:0;font:16px/1.5 system-ui,sans-serif;background:#f6f7f9;color:#1d2330}' +
  'main{max-width:960px;margin:0 auto;padding:24px 16px}h1{font-size:22px;margin:0 0 4px}h2{font-size:18px;margin:28px 0 8px}' +
  '.sub,.note,.empty,.tile span,dd{color:#5b6475;font-size:14px}.sub{margin:0 0 12px}' +
  '.back{display:inline-block;margin:0 0 16px;padding:10px 0;min-height:24px;color:#007934;font-weight:600;text-decoration:none}' +
  '.cov,.unavail,.tile{border:1px solid #d5dae3;border-radius:8px;background:#fff}.cov{padding:10px 12px;font-size:14px}' +
  '.unavail{padding:12px;background:#fff4e5;border-color:#f0c78a}' +
  '.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin:12px 0 4px}' +
  '.tile{padding:10px 12px}.tile b{display:block;font-size:22px;line-height:1.2}.tile i{display:block;font-style:normal;font-size:13px}' +
  'table.t{width:100%;border-collapse:collapse;font-size:14px;margin:0 0 12px;font-variant-numeric:tabular-nums}' +
  '.t caption{text-align:left;font-weight:600;padding:4px 0}.t th,.t td{padding:6px 8px;border-bottom:1px solid #e3e6ec;text-align:right}' +
  '.t th:first-child,.t td:first-child{text-align:left}.t tfoot td{font-weight:600}' +
  'dl{font-size:14px}dt{font-weight:600;margin:8px 0 0}dd{margin:0}' +
  '@media (max-width:600px){.t thead{display:none}.t tr{display:block;border:1px solid #e3e6ec;border-radius:8px;margin:0 0 8px;padding:4px 0;background:#fff}' +
  '.t td,.t td:first-child{display:flex;justify-content:space-between;gap:12px;border:0;text-align:right;padding:4px 10px}' +
  '.t td::before{content:attr(data-l);color:#5b6475;text-align:left}}' +
  '@media (prefers-color-scheme:dark){body{background:#14171c;color:#e6e9ef}.sub,.note,.empty,.tile span,dd,.t td::before{color:#9aa3b2}' +
  '.back{color:#4cc27a}.cov,.tile,.t tr{background:#1c2027;border-color:#2e3440}.unavail{background:#3a2a10;border-color:#6b4d1a}' +
  '.t th,.t td{border-color:#2e3440}}';

/* ------------------------------------------------------------------ DB2b: aggregate analytics (read-only)
   Owner decisions 2026-10-25 (S1 aggregate-only + V2 server-rendered, O1-O8; proposal
   Deliverables/UNO-Admin-Dashboard/UNO-Analytics-DB2b-Final-Proposal-and-Knowledge-Roadmap-2026-10-25.md).
   The D1 binding DB (ugreen-vero) is used only through the six fixed SELECT statements in SQL, bound to a computed cutoff (and k).
   Never read: question text, search queries, source domains, code_id, ip_hash, ts, row ids, role; never the tables answer_cache,
   access_codes, counters, product_text, meta or uno_*. question_log is read only as counts: breakdowns over the whole window,
   per-day rows only for totals and signal counts, item codes only with k >= PICK_MIN. Staff UNO AI answers only (local answers are
   not logged). Retention stays with the VERO Worker cron; this Worker never writes. */
export const WINDOW_DAYS = 30;          // = question_log retention (LOG_RETENTION_DAYS)
export const DAY_OFFSET_MIN = 480;      // Manila day: = DAY_UTC_OFFSET_MIN in backend/vero/wrangler.toml, the boundary the VERO Worker writes (gate G33)
export const PICK_MIN = 3;              // O2: an item code is listed only when at least 3 answers recommended it
export const PICK_TOP = 20;
export const BUDGET_USD = '4.50';       // O4: = MONTHLY_BUDGET_USD in backend/vero/wrangler.toml (gate G33)
export const WEB_BUDGET_USD = '2.00';   // O4: = WEB_MONTHLY_BUDGET_USD in backend/vero/wrangler.toml (gate G33)
const CODE_RE = /^[A-Za-z0-9-]{1,32}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;
export const SQL = Object.freeze({
  daily: 'SELECT day, ai_calls, web_calls, web_searches, cache_hits, errors, timeouts, rate_limited, capped, tokens_in, tokens_out, micro_usd, web_micro_usd ' +
    'FROM daily_stats WHERE day >= ?1 ORDER BY day DESC LIMIT 31',
  monthly: 'SELECT month, micro_usd, web_micro_usd, calls, web_searches FROM spend WHERE month >= ?1 ORDER BY month DESC LIMIT 3',
  mix: "SELECT route, outcome, COALESCE(confidence, 'none') AS confidence, COUNT(*) AS n FROM question_log WHERE day >= ?1 " +
    "GROUP BY route, outcome, COALESCE(confidence, 'none') ORDER BY n DESC LIMIT 60",
  signals: "SELECT day, COUNT(*) AS n, SUM(outcome NOT IN ('ok', 'cached')) AS failed, SUM(outcome = 'ok' AND (picks IS NULL OR picks = '')) AS no_picks, " +
    "SUM(COALESCE(confidence, '') = 'low') AS low_conf, SUM(outcome = 'no_official_source') AS no_source, SUM(outcome = 'cached') AS cached, " +
    "SUM(route = 'web') AS web FROM question_log WHERE day >= ?1 GROUP BY day ORDER BY day DESC LIMIT 31",
  latency: "SELECT CASE WHEN latency_ms < 2000 THEN 'a' WHEN latency_ms < 5000 THEN 'b' WHEN latency_ms < 10000 THEN 'c' " +
    "WHEN latency_ms < 20000 THEN 'd' ELSE 'e' END AS bucket, COUNT(*) AS n FROM question_log WHERE day >= ?1 AND latency_ms IS NOT NULL GROUP BY bucket",
  picks: `SELECT j.value AS item_code, COUNT(*) AS n FROM question_log AS q, json_each('["' || replace(q.picks, ',', '","') || '"]') AS j ` +
    `WHERE q.day >= ?1 AND q.outcome = 'ok' AND q.picks IS NOT NULL AND q.picks <> '' AND q.picks NOT GLOB '*[^A-Za-z0-9,-]*' AND j.value <> '' ` +
    'GROUP BY j.value HAVING COUNT(*) >= ?2 ORDER BY n DESC, item_code LIMIT 20',
});

/* First Manila day of the window (today + the 29 days before) and the first UTC month of the last 3 (spend is per UTC month). */
export function cutoffs(t) {
  const d = new Date(t);
  return { day: new Date(t + DAY_OFFSET_MIN * 60000 - (WINDOW_DAYS - 1) * 86400000).toISOString().slice(0, 10),
    month: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 2, 1)).toISOString().slice(0, 7), thisMonth: d.toISOString().slice(0, 7) };
}
const num = x => { const v = Number(x); return Number.isFinite(v) ? v : 0; };
/* One batch, the six fixed statements; any unexpected result shape throws (the page then shows "Data unavailable"). */
export async function readStats(db, t) {
  const c = cutoffs(t);
  const res = await db.batch([
    db.prepare(SQL.daily).bind(c.day), db.prepare(SQL.monthly).bind(c.month), db.prepare(SQL.mix).bind(c.day),
    db.prepare(SQL.signals).bind(c.day), db.prepare(SQL.latency).bind(c.day), db.prepare(SQL.picks).bind(c.day, PICK_MIN),
  ]);
  const rows = i => { const r = Array.isArray(res) && res[i] && res[i].results; if (!Array.isArray(r)) throw new Error('d1_shape'); return r; };
  return { from: c.day, thisMonth: c.thisMonth, daily: rows(0).filter(r => DAY_RE.test(String(r.day))),
    months: rows(1).filter(r => MONTH_RE.test(String(r.month))), mix: rows(2), signals: rows(3).filter(r => DAY_RE.test(String(r.day))),
    latency: rows(4), picks: rows(5).filter(r => CODE_RE.test(String(r.item_code)) && num(r.n) >= PICK_MIN).slice(0, PICK_TOP) };
}

/* Every value reaches the page through esc() (table cells, tile text); numbers are formatted first. */
export function esc(s) { return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]); }
const int = x => String(Math.round(num(x))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const usd = (micro, dp) => '$' + (num(micro) / 1e6).toFixed(dp === undefined ? 3 : dp);
const pct = (a, b) => num(b) > 0 ? (Math.round(num(a) * 1000 / num(b)) / 10) + '%' : '-';
const total = (rows, k) => rows.reduce((s, r) => s + num(r[k]), 0);
function group(rows, k) {
  const m = new Map();
  for (const r of rows) m.set(String(r[k]), (m.get(String(r[k])) || 0) + num(r.n));
  return [...m].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
}
function table(cap, head, rows, foot) {
  if (!rows.length) return '<p class="empty">' + esc(cap) + ': no data in this window.</p>';
  const tr = r => '<tr>' + r.map((c, i) => '<td data-l="' + esc(head[i]) + '">' + esc(c) + '</td>').join('') + '</tr>';
  return '<table class="t"><caption>' + esc(cap) + '</caption><thead><tr>' + head.map(h => '<th scope="col">' + esc(h) + '</th>').join('') +
    '</tr></thead><tbody>' + rows.map(r => tr(r)).join('') + '</tbody>' + (foot ? '<tfoot>' + tr(foot) + '</tfoot>' : '') + '</table>';
}
const tile = (label, value, note) => '<div class="tile"><span>' + esc(label) + '</span><b>' + esc(value) + '</b><i>' + esc(note) + '</i></div>';
const LATENCY = [['a', 'under 2 s'], ['b', '2 to 5 s'], ['c', '5 to 10 s'], ['d', '10 to 20 s'], ['e', '20 s or more']];

export function renderStats(d) {
  const logged = total(d.signals, 'n'), cached = total(d.signals, 'cached'), failed = total(d.signals, 'failed');
  const answered = d.mix.filter(r => r.outcome === 'ok').reduce((s, r) => s + num(r.n), 0);
  const cur = d.months.find(m => m.month === d.thisMonth);
  const latest = [d.daily[0] && d.daily[0].day, d.signals[0] && d.signals[0].day].filter(Boolean).sort().pop();
  const shares = rows => rows.map(([k, n]) => [k, int(n), pct(n, logged)]);
  const latN = new Map(d.latency.map(r => [String(r.bucket), num(r.n)])), latAll = [...latN.values()].reduce((a, b) => a + b, 0);
  const A = ['ai_calls', 'cache_hits', 'web_calls', 'errors', 'timeouts', 'rate_limited', 'capped'];
  const D = ['n', 'failed', 'no_picks', 'low_conf', 'no_source', 'cached', 'web'];
  return '<p class="sub">Signed in as the owner. Last ' + WINDOW_DAYS + ' Manila days, from ' + esc(d.from) + '; latest data: ' + esc(latest || 'none') + '.</p>' +
    COVERAGE +
    '<div class="tiles">' +
      tile('AI answers', int(total(d.daily, 'ai_calls')), WINDOW_DAYS + ' days') +
      tile('Logged AI questions', int(logged), 'incl. ' + int(cached) + ' cached') +
      tile('Failed AI calls', pct(failed, logged), int(failed) + ' of ' + int(logged) + ' logged (not wrong answers)') +
      tile('Low confidence', pct(total(d.signals, 'low_conf'), logged - cached), 'of ' + int(logged - cached) + ' not cached; signal, not proof') +
      tile('No product suggested', pct(total(d.signals, 'no_picks'), answered), 'of ' + int(answered) + ' answered') +
      tile('Cost this month', usd(cur ? cur.micro_usd : 0, 2), 'of $' + BUDGET_USD + ' budget (estimate)') +
    '</div>' +
    '<h2>A. AI usage and estimated cost</h2>' +
    table('Per Manila day, newest first', ['Day', 'AI answers', 'Cache hits', 'Web calls', 'Errors', 'Timeouts', 'Rate-limited', 'Capped', 'Cost'],
      d.daily.map(r => [r.day].concat(A.map(k => int(r[k])), [usd(r.micro_usd)])),
      ['Total'].concat(A.map(k => int(total(d.daily, k))), [usd(total(d.daily, 'micro_usd'))])) +
    '<h2>B. Monthly usage and budget</h2>' +
    table('Per UTC month (budget $' + BUDGET_USD + ', web $' + WEB_BUDGET_USD + ')', ['Month', 'Cost', 'Of budget', 'Web cost', 'Of web budget', 'AI calls', 'Web searches'],
      d.months.map(r => [r.month, usd(r.micro_usd, 2), pct(r.micro_usd, Number(BUDGET_USD) * 1e6), usd(r.web_micro_usd, 2),
        pct(r.web_micro_usd, Number(WEB_BUDGET_USD) * 1e6), int(r.calls), int(r.web_searches)])) +
    '<h2>C. Answer routes, outcomes and confidence (' + WINDOW_DAYS + ' days)</h2>' +
    table('Route', ['Route', 'Questions', 'Share'], shares(group(d.mix, 'route'))) +
    table('Outcome', ['Outcome', 'Questions', 'Share'], shares(group(d.mix, 'outcome'))) +
    table('Confidence (none = cached or failed)', ['Confidence', 'Questions', 'Share'], shares(group(d.mix, 'confidence'))) +
    '<h2>D. Low-confidence, unanswered and failure signals</h2>' +
    table('Per Manila day, newest first', ['Day', 'Logged', 'Failed', 'No product', 'Low confidence', 'No official source', 'Cached', 'Web'],
      d.signals.map(r => [r.day].concat(D.map(k => int(r[k])))), ['Total'].concat(D.map(k => int(total(d.signals, k))))) +
    table('Response time (' + WINDOW_DAYS + ' days, answers that called the AI)', ['Time', 'Questions', 'Share'],
      latAll ? LATENCY.map(([k, l]) => [l, int(latN.get(k) || 0), pct(latN.get(k) || 0, latAll)]) : []) +
    '<h2>E. Frequently recommended SKUs (' + WINDOW_DAYS + ' days)</h2>' +
    table('Item codes in at least ' + PICK_MIN + ' answered AI questions, top ' + PICK_TOP + ' (cached answers not counted)', ['#', 'Item code', 'Answers'],
      d.picks.map((r, i) => [String(i + 1), String(r.item_code), int(r.n)])) +
    '<h2>Definitions</h2><dl>' +
      '<dt>AI answers</dt><dd>AI calls that returned a validated answer (daily_stats.ai_calls).</dd>' +
      '<dt>Logged AI questions</dt><dd>Staff AI questions in the log, including cached answers and failed calls.</dd>' +
      '<dt>Failed</dt><dd>The AI call did not produce an answer (timeout, budget, refusal, invalid, no official source, ...).</dd>' +
      '<dt>No product</dt><dd>Answered, but no item code was recommended.</dd>' +
      '<dt>Low confidence</dt><dd>The answer reported low confidence. A signal for review, not a proven error.</dd>' +
      '<dt>Cost</dt><dd>Estimated by the VERO Worker from token and search usage; the provider bill is authoritative.</dd>' +
      '<dt>Item code</dt><dd>The exact UGREEN item code is the product identity; model numbers are not unique.</dd>' +
    '</dl>';
}

/* The owner page: analytics when the binding answers, otherwise the shell with "Data unavailable" (never partial numbers). */
export async function page(db, t) {
  let body = UNAVAILABLE;
  if (db && typeof db.prepare === 'function' && typeof db.batch === 'function') {
    try { body = renderStats(await readStats(db, t)); } catch (_) { body = UNAVAILABLE; }
  }
  return HEAD + body + '</main></body></html>';
}

export default {
  async fetch(req, env) {
    const c = cfg(env);
    if (!c.enabled) return fail(503, 'dashboard_off');                 // kill switch first: nothing else runs
    if (!configured(c)) return fail(503, 'not_configured');
    const t = Date.now();
    let claims;
    try { claims = await verifyAccessJwt(req.headers.get(JWT_HEADER) || '', c, t); }
    catch (_) { return fail(503, 'auth_unavailable'); }
    if (!claims || !(await sameEmail(normEmail(claims.email), c.owner))) return fail(403, 'forbidden');
    const url = new URL(req.url);
    if (url.pathname === '/') return req.method === 'GET' ? new Response(await page(env.DB, t), { headers: headers('text/html; charset=utf-8') }) : fail(405, 'method_not_allowed');
    if (url.pathname === '/app.css') return req.method === 'GET' ? new Response(CSS, { headers: headers('text/css; charset=utf-8') }) : fail(405, 'method_not_allowed');
    if (url.pathname === '/api/whoami') {
      if (req.method !== 'POST') return fail(405, 'method_not_allowed');
      if ((req.headers.get('origin') || '') !== url.origin) return fail(403, 'forbidden_origin');
      return json({ ok: true, role: 'owner', exp: claims.exp });
    }
    return fail(404, 'not_found');
  },
};
