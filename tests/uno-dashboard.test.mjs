/* uno-dashboard owner gate tests (DB1, owner decision 2026-10-24; design UNO-Owner-Dashboard-Design-2026-10-24.md OD1-OD6).
 * Run: node tests/uno-dashboard.test.mjs
 * Runs the real backend/dashboard/worker.js with a fake Cloudflare Access key set (RSA keys generated per run, test values
 * only; no network, no Cloudflare, no secret). Covers: kill switch first; fail-closed config; Access JWT verification
 * (RS256 only, signature, key id, aud, iss, exp, nbf, email claim); owner-only email match; VERO / admin tokens refused;
 * one uniform refusal; same-origin POST; routes and methods; security headers, no CORS, no cookies; no log output; key
 * caching and refetch limits; static checks on the Worker source and its wrangler.toml (one read-only D1 binding, no hard-coded
 * email). DB2b (owner decisions 2026-10-25, S1 + V2): the analytics page runs the six fixed SELECT statements against a real SQLite
 * database built from backend/vero/migrations/0001_init.sql (node:sqlite, query_only = ON, so any write fails) with synthetic rows,
 * plus a raw fake D1 for the page-side filters. Each mutant (re-built from the real source) must make at least one check fail. */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(path.join(ROOT, 'backend/dashboard/worker.js'), 'utf8');
const TOML = readFileSync(path.join(ROOT, 'backend/dashboard/wrangler.toml'), 'utf8');
const VERO_TOML = readFileSync(path.join(ROOT, 'backend/vero/wrangler.toml'), 'utf8');
const MIGRATION = readFileSync(path.join(ROOT, 'backend/vero/migrations/0001_init.sql'), 'utf8');
// DB2b: the six reviewed statements (proposal 2026-10-25 §2, validated against 0001_init.sql); any change must be reviewed here too
const EXPECT_SQL = {
  daily: 'SELECT day, ai_calls, web_calls, web_searches, cache_hits, errors, timeouts, rate_limited, capped, tokens_in, tokens_out, micro_usd, web_micro_usd FROM daily_stats WHERE day >= ?1 ORDER BY day DESC LIMIT 31',
  monthly: 'SELECT month, micro_usd, web_micro_usd, calls, web_searches FROM spend WHERE month >= ?1 ORDER BY month DESC LIMIT 3',
  mix: "SELECT route, outcome, COALESCE(confidence, 'none') AS confidence, COUNT(*) AS n FROM question_log WHERE day >= ?1 GROUP BY route, outcome, COALESCE(confidence, 'none') ORDER BY n DESC LIMIT 60",
  signals: "SELECT day, COUNT(*) AS n, SUM(outcome NOT IN ('ok', 'cached')) AS failed, SUM(outcome = 'ok' AND (picks IS NULL OR picks = '')) AS no_picks, SUM(COALESCE(confidence, '') = 'low') AS low_conf, SUM(outcome = 'no_official_source') AS no_source, SUM(outcome = 'cached') AS cached, SUM(route = 'web') AS web FROM question_log WHERE day >= ?1 GROUP BY day ORDER BY day DESC LIMIT 31",
  latency: "SELECT CASE WHEN latency_ms < 2000 THEN 'a' WHEN latency_ms < 5000 THEN 'b' WHEN latency_ms < 10000 THEN 'c' WHEN latency_ms < 20000 THEN 'd' ELSE 'e' END AS bucket, COUNT(*) AS n FROM question_log WHERE day >= ?1 AND latency_ms IS NOT NULL GROUP BY bucket",
  picks: "SELECT j.value AS item_code, COUNT(*) AS n FROM question_log AS q, json_each('[\"' || replace(q.picks, ',', '\",\"') || '\"]') AS j WHERE q.day >= ?1 AND q.outcome = 'ok' AND q.picks IS NOT NULL AND q.picks <> '' AND q.picks NOT GLOB '*[^A-Za-z0-9,-]*' AND j.value <> '' GROUP BY j.value HAVING COUNT(*) >= ?2 ORDER BY n DESC, item_code LIMIT 20",
};
const TEAM = 'https://example-team.cloudflareaccess.com';          // test values only
const AUD = 'aud0123456789abcdef0123456789abcdef0123456789abcdef0123456789ab';
const OWNER = 'owner.test@example.com';
const HOST = 'https://uno-dashboard.example.workers.dev';
const CERTS_URL = TEAM + '/cdn-cgi/access/certs';

const b64u = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const ALG = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };
const K1 = await crypto.subtle.generateKey(ALG, true, ['sign', 'verify']);
const K2 = await crypto.subtle.generateKey(ALG, true, ['sign', 'verify']);   // not published in the key set
const J1 = await crypto.subtle.exportKey('jwk', K1.publicKey);
const J2 = await crypto.subtle.exportKey('jwk', K2.publicKey);
async function jwt(claims, opt) {
  opt = opt || {};
  const head = Object.assign({ alg: 'RS256', kid: 'k1', typ: 'JWT' }, opt.head || {});
  const p = b64u(JSON.stringify(head)) + '.' + b64u(JSON.stringify(claims));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', (opt.key || K1).privateKey, new TextEncoder().encode(p));
  return p + '.' + b64u(new Uint8Array(sig));
}
const now = () => Math.floor(Date.now() / 1000);
const good = over => Object.assign({ aud: [AUD], iss: TEAM, email: OWNER, iat: now() - 10, nbf: now() - 10, exp: now() + 3600, type: 'app', sub: 'u1' }, over || {});

let FETCHES = [], CERTS_STATUS = 200, CERTS_MODE = 'ok', SIGNALS = [], HANG_NEXT = false, SERVE_B = false, GATED = null;
const TEAM_B = 'https://other-team.cloudflareaccess.com';
const tick = () => new Promise(r => setTimeout(r, 5));   // lets concurrent requests overlap one key fetch
globalThis.fetch = async (url, init) => {
  FETCHES.push(String(url));
  SIGNALS.push(!!(init && init.signal && typeof init.signal.aborted === 'boolean'));
  if (HANG_NEXT) { HANG_NEXT = false; return new Promise(() => {}); }   // a key fetch that never answers (QA-DB1-7)
  if (GATED) await new Promise(r => GATED.push(r));                     // released by the test, in a chosen order (QA-DB1-8)
  else await tick();
  if (SERVE_B && String(url) === TEAM_B + '/cdn-cgi/access/certs') {   // team B publishes K2 under the same kid
    return new Response(JSON.stringify({ keys: [{ kid: 'k1', alg: 'RS256', kty: J2.kty, n: J2.n, e: J2.e }] }), { headers: { 'content-type': 'application/json' } });
  }
  if (String(url) !== CERTS_URL) throw new Error('unexpected fetch ' + url);
  if (CERTS_STATUS !== 200) return new Response('no', { status: CERTS_STATUS });
  const k1 = { kid: 'k1', alg: 'RS256', use: 'sig', kty: J1.kty, n: J1.n, e: J1.e };
  const keys = { ok: [k1], empty: [], rs384: [Object.assign({}, k1, { alg: 'RS384' })], oct: [Object.assign({}, k1, { kty: 'oct' })],
    k2: [{ kid: 'k2', alg: 'RS256', use: 'sig', kty: J2.kty, n: J2.n, e: J2.e }] }[CERTS_MODE];
  return new Response(JSON.stringify({ keys }), { headers: { 'content-type': 'application/json' } });
};
const ENV = over => Object.assign({ DASHBOARD_ENABLED: 'true', OWNER_EMAIL: OWNER, ACCESS_AUD: AUD, ACCESS_TEAM_DOMAIN: TEAM }, over || {});

/* DB2b: a D1-shaped adapter over a real SQLite database built from the VERO migration; query_only = ON after seeding, so a write
   statement would fail (and the page would show "Data unavailable"). LOG records every prepare / bind / batch. */
const LOG = { prepared: [], binds: [], batches: 0 };
const resetLog = () => { LOG.prepared = []; LOG.binds = []; LOG.batches = 0; };
function sqliteD1(seed, opt) {
  const db = new DatabaseSync(':memory:');
  db.exec(MIGRATION);
  if (seed) seed(db);
  db.exec('PRAGMA query_only = ON');
  return {
    prepare(sql) { LOG.prepared.push(sql); return { sql, args: [], bind(...a) { LOG.binds.push(a); return { sql, args: a }; } }; },
    async batch(list) {
      LOG.batches++;
      if (opt && opt.fail) throw new Error('D1_ERROR: unavailable');
      if (opt && opt.badShape) return [{ success: true }];
      return list.map(st => ({ success: true, results: db.prepare(st.sql).all(...st.args) }));
    },
  };
}
/* Raw fake: returns crafted rows (as if SQL had misbehaved) to test the page-side filters. */
function rawD1(results) {
  return { prepare(sql) { LOG.prepared.push(sql); return { bind(...a) { LOG.binds.push(a); return { sql }; } }; },
    async batch(list) { LOG.batches++; return list.map((_, i) => ({ results: results[i] || [] })); } };
}
const MDAY = (k, t) => new Date((t || Date.now()) + 480 * 60000 - k * 86400000).toISOString().slice(0, 10);
const UMONTH = k => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - k, 1)).toISOString().slice(0, 7); };
const SECRET = ['CODEID_MARK', 'IPHASH_MARK', 'QTEXT_MARK', 'SEARCHQ_MARK', 'DOMAIN_MARK', 'TS_MARK', 'ROLE_MARK'];
function seedMain(db) {
  const dst = db.prepare('INSERT INTO daily_stats (day, ai_calls, web_calls, web_searches, cache_hits, errors, timeouts, rate_limited, capped, tokens_in, tokens_out, micro_usd, web_micro_usd) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)');
  dst.run(MDAY(0), 5, 1, 2, 1, 1, 0, 2, 0, 1000, 500, 12345, 2000);
  dst.run(MDAY(3), 2, 0, 0, 0, 0, 1, 0, 1, 400, 200, 2000, 0);
  dst.run(MDAY(40), 900, 0, 0, 0, 0, 0, 0, 0, 0, 0, 777777, 0);   // outside the window
  const sp = db.prepare('INSERT INTO spend (month, micro_usd, web_micro_usd, calls, web_searches) VALUES (?,?,?,?,?)');
  sp.run(UMONTH(0), 3400000, 500000, 9, 2); sp.run(UMONTH(1), 1000000, 0, 4, 0); sp.run(UMONTH(2), 250000, 0, 1, 0);
  sp.run(UMONTH(3), 9990000, 0, 99, 0);   // older than the last 3 months
  const q = db.prepare('INSERT INTO question_log (ts, day, code_id, role, ip_hash, q_redacted, route, trigger, n_candidates, picks, confidence, outcome, web_searches, web_status, source_domains, search_query_redacted, tokens_in, tokens_out, micro_usd, latency_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const row = (day, route, picks, conf, outcome, lat) => q.run('TS_MARK', day, 'CODEID_MARK', 'ROLE_MARK', 'IPHASH_MARK', 'QTEXT_MARK', route, 'auto', 5, picks, conf, outcome,
    route === 'web' ? 1 : null, route === 'web' ? 'used' : null, route === 'web' ? 'DOMAIN_MARK.example' : null, 'SEARCHQ_MARK', 10, 10, 100, lat);
  row(MDAY(0), 'catalog', '25870,95169HSR', 'high', 'ok', 1500);
  row(MDAY(0), 'catalog', '25870,95169HSR', 'medium', 'ok', 3000);
  row(MDAY(1), 'catalog', '95169HSR', 'low', 'ok', 6000);           // 95169HSR = 3 answers (listed); 25870 = 2 (suppressed, k = 3)
  row(MDAY(1), 'catalog', '', 'low', 'ok', 2500);                    // no product suggested
  row(MDAY(2), 'web', null, null, 'no_official_source', 15000);
  row(MDAY(2), 'catalog', null, null, 'timeout', 25000);
  for (let i = 0; i < 3; i++) row(MDAY(2), 'catalog', '10334', null, 'cached', null);              // cached: never counted as a pick
  for (let i = 0; i < 3; i++) row(MDAY(3), 'catalog', '<script>x</script>,99999', 'high', 'ok', 1000);   // invalid pick string: dropped
  for (let i = 0; i < 3; i++) row(MDAY(3), 'catalog', 'A'.repeat(40), 'high', 'ok', 1000);         // 40-char code: dropped page-side
  for (let i = 0; i < 5; i++) row(MDAY(40), 'catalog', '77777', 'high', 'ok', 1000);               // outside the window
  row(MDAY(4), 'catalog', null, null, '<img src=x onerror=alert(1)> & co', 900);                    // hostile outcome text: escaped (incl. &, QA-DB2b-4)
}

const _log = console.log;
const tmp = mkdtempSync(path.join(os.tmpdir(), 'unodash-'));
let nMod = 0, CHECKS = 0;
async function load(src) { const f = path.join(tmp, 'w' + (nMod++) + '.mjs'); writeFileSync(f, src); return import(pathToFileURL(f).href); }

async function suite(W, out) {
  const worker = W.default, failed = [];
  const chk = (n, c, x) => { if (out) CHECKS++; if (c) { if (out) _log('PASS - ' + n); } else { failed.push(n); if (out) _log('FAIL - ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 300) : '')); } };
  const LOGGED = [];
  for (const k of ['log', 'warn', 'error', 'info', 'debug']) console[k] = (...a) => LOGGED.push(a.join(' '));
  async function call(p, opt) {
    opt = opt || {};
    const h = Object.assign({}, opt.headers || {});
    if (opt.tok !== undefined) h['cf-access-jwt-assertion'] = opt.tok;
    if ((opt.method || 'GET') === 'POST' && opt.origin !== null) h.origin = opt.origin === undefined ? HOST : opt.origin;
    const r = await worker.fetch(new Request(HOST + p, { method: opt.method || 'GET', headers: h }), opt.env || ENV());
    const text = await r.text();
    let j = null; try { j = JSON.parse(text); } catch (_) {}
    return { status: r.status, h: r.headers, text, j };
  }
  try {
    W._resetCerts(); FETCHES = []; SIGNALS = []; CERTS_STATUS = 200; CERTS_MODE = 'ok'; HANG_NEXT = false; SERVE_B = false; GATED = null;
    const T = await jwt(good());

    // --- kill switch first: nothing else runs (no key fetch), any value but exactly "true" is off
    for (const v of [undefined, 'false', 'TRUE', '1', 'true ', 'yes', '']) {
      FETCHES = [];
      const r = await call('/', { tok: T, env: ENV({ DASHBOARD_ENABLED: v }) });
      chk('kill switch ' + JSON.stringify(v) + ' -> 503 dashboard_off, no key fetch', r.status === 503 && r.j && r.j.error === 'dashboard_off' && FETCHES.length === 0, [r.status, r.j, FETCHES.length]);
    }
    // --- fail closed on missing / invalid configuration
    for (const [n, e] of [['no OWNER_EMAIL', { OWNER_EMAIL: '' }], ['OWNER_EMAIL without @', { OWNER_EMAIL: 'owner' }], ['no ACCESS_AUD', { ACCESS_AUD: '' }],
      ['short ACCESS_AUD', { ACCESS_AUD: 'abc' }], ['no team', { ACCESS_TEAM_DOMAIN: '' }], ['foreign team host', { ACCESS_TEAM_DOMAIN: 'https://evil.example.com' }],
      ['http team', { ACCESS_TEAM_DOMAIN: 'http://example-team.cloudflareaccess.com' }], ['team with path', { ACCESS_TEAM_DOMAIN: TEAM + '/x' }],
      ['OWNER_EMAIL with a non-ASCII character', { OWNER_EMAIL: 'owner.t\u00e9st@example.com' }], ['OWNER_EMAIL with an inner space', { OWNER_EMAIL: 'owner test@example.com' }],
      ['OWNER_EMAIL Kelvin sign that lower-cases to ASCII', { OWNER_EMAIL: '\u212aate.owner@example.com' }]]) {
      FETCHES = [];
      const r = await call('/', { tok: T, env: ENV(e) });
      chk('config ' + n + ' -> 503 not_configured, no key fetch', r.status === 503 && r.j && r.j.error === 'not_configured' && FETCHES.length === 0, [r.status, r.j]);
    }
    {
      const r = await call('/', { tok: T, env: ENV({ ACCESS_TEAM_DOMAIN: TEAM + '/' }) });
      chk('config team domain with a trailing slash is accepted (normalised)', r.status === 200, r.status);
    }

    // --- the owner gets in
    W._resetCerts(); FETCHES = [];
    const ok = await call('/', { tok: T });
    chk('owner GET / without a D1 binding -> 200 page "UNO Analytics" with "Data unavailable" and no numbers', ok.status === 200 && /^text\/html/.test(ok.h.get('content-type'))
      && ok.text.includes('<h1>UNO Analytics</h1>') && ok.text.includes('Data unavailable') && ok.text.includes('Signed in as the owner.') && !ok.text.includes('class="tiles"'), [ok.status, ok.text.slice(0, 80)]);
    chk('owner GET / fetched the Access keys once, only from the team certs URL', FETCHES.length === 1 && FETCHES[0] === CERTS_URL, FETCHES);
    await call('/', { tok: T });
    chk('Access keys are cached (second request: no fetch)', FETCHES.length === 1, FETCHES.length);
    const css = await call('/app.css', { tok: T });
    chk('owner GET /app.css -> 200 text/css', css.status === 200 && /^text\/css/.test(css.h.get('content-type')), css.status);
    const who = await call('/api/whoami', { tok: T, method: 'POST' });
    chk('owner POST /api/whoami -> { ok, role: owner, exp = the token exp } and nothing else', who.status === 200 && who.j && who.j.ok === true && who.j.role === 'owner'
      && who.j.exp === JSON.parse(Buffer.from(T.split('.')[1], 'base64url').toString()).exp && Object.keys(who.j).sort().join() === 'exp,ok,role', who.j);
    chk('owner email in different ASCII case still matches', (await call('/', { tok: await jwt(good({ email: 'Owner.Test@Example.COM' })) })).status === 200);
    chk('exp 29 s ago is accepted (30 s clock skew)', (await call('/', { tok: await jwt(good({ exp: now() - 29 })) })).status === 200);
    chk('aud as a plain string equal to the AUD is accepted', (await call('/', { tok: await jwt(good({ aud: AUD })) })).status === 200);
    {
      const exact = new Set(['content-type', 'cache-control', 'content-security-policy', 'x-content-type-options', 'x-frame-options', 'referrer-policy',
        'cross-origin-opener-policy', 'cross-origin-resource-policy', 'permissions-policy', 'strict-transport-security']);
      const set = [...ok.h.keys()];
      chk('exact response header set (no extra, none missing)', set.length === exact.size && set.every(k => exact.has(k)), set);
      chk('exact CSP string', ok.h.get('content-security-policy') === "default-src 'none'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'", ok.h.get('content-security-policy'));
      chk('exact hardening header values', ok.h.get('strict-transport-security') === 'max-age=31536000' && ok.h.get('cross-origin-opener-policy') === 'same-origin'
        && ok.h.get('cross-origin-resource-policy') === 'same-origin' && ok.h.get('permissions-policy') === 'camera=(), microphone=(), geolocation=(), interest-cohort=()');
      // DB2a: same-tab launch from the Admin sidebar; the dashboard is still never framed
      chk('DB2a: framing still refused (X-Frame-Options DENY + frame-ancestors none)', ok.h.get('x-frame-options') === 'DENY' && /frame-ancestors 'none'$/.test(ok.h.get('content-security-policy') || ''));
    }
    {
      const RET = 'https://raffyrojo.github.io/ugreen-pricelist/#uno-return';
      const hrefs = t => [...t.matchAll(/href="([^"]*)"/g)].map(m => m[1]);
      chk('DB2a: ADMIN_RETURN_URL is the fixed admin URL with the #uno-return fragment', W.ADMIN_RETURN_URL === RET, W.ADMIN_RETURN_URL);
      chk('DB2a: shell page links exactly /app.css + the Back to Admin URL', JSON.stringify(hrefs(ok.text)) === JSON.stringify(['/app.css', RET]) && ok.text.includes('>&larr; Back to Admin</a>'), hrefs(ok.text));
      const q = await call('/?return=https%3A%2F%2Fevil.example%2F&next=//evil.example', { tok: T });
      chk('DB2a: no open redirect - query parameters never change the Back link', q.status === 200 && JSON.stringify(hrefs(q.text)) === JSON.stringify(['/app.css', RET]) && !q.text.includes('evil'), hrefs(q.text));
      chk('DB2a: the Back link is styled (.back) in /app.css', /\.back\{/.test(css.text));
    }

    // --- every refusal is the same 403 forbidden (no oracle)
    const REF = [];
    const refuse = async (n, tok, extra) => {
      const r = await call('/', Object.assign({ tok }, extra || {}));
      REF.push(r.text);
      chk('refused: ' + n + ' -> 403 forbidden', r.status === 403 && r.j && r.j.error === 'forbidden', [r.status, r.j]);
    };
    await refuse('no Access JWT header', undefined);
    await refuse('empty JWT', '');
    await refuse('garbage JWT', 'abc.def.ghi');
    await refuse('two-part token (VERO / admin:read token shape)', 'eyJzaWQiOiJjX2FkbWluMDEiLCJyb2xlIjoiYWRtaW4iLCJzY29wZSI6ImFkbWluOnJlYWQifQ.c2ln');
    await refuse('VERO admin token in Authorization header, no Access JWT', undefined, { headers: { authorization: 'Bearer eyJzaWQiOiJjIn0.c2ln' } });
    await refuse('valid Access JWT sent in Authorization instead of the Access header', undefined, { headers: { authorization: 'Bearer ' + T } });
    await refuse('other email', await jwt(good({ email: 'someone.else@example.com' })));
    await refuse('email that contains the owner email', await jwt(good({ email: 'x' + OWNER })));
    await refuse('owner email as a prefix', await jwt(good({ email: OWNER + '.evil.com' })));
    await refuse('service token (common_name, no email)', await jwt(Object.assign(good(), { email: undefined, common_name: 'svc.access' })));
    await refuse('email not a string', await jwt(good({ email: [OWNER] })));
    await refuse('email wrapped in spaces', await jwt(good({ email: '  ' + OWNER + ' ' })));
    await refuse('email wrapped in no-break spaces', await jwt(good({ email: '\u00a0' + OWNER + '\u00a0' })));
    {
      const kenv = ENV({ OWNER_EMAIL: 'kate.owner@example.com' });
      chk('control: kate.owner@example.com is accepted when it is the owner', (await call('/', { tok: await jwt(good({ email: 'kate.owner@example.com' })), env: kenv })).status === 200);
      await refuse('Kelvin-sign look-alike that lower-cases to the owner email', await jwt(good({ email: '\u212aate.owner@example.com' })), { env: kenv });
    }
    await refuse('fullwidth letter in the email', await jwt(good({ email: OWNER.replace('o', '\uff4f') })));
    await refuse('zero-width space in the email', await jwt(good({ email: OWNER.replace('@', '\u200b@') })));
    await refuse('header with crit', await jwt(good(), { head: { crit: ['exp'] } }));
    await refuse('aud string longer than the AUD', await jwt(good({ aud: AUD + 'x' })));
    await refuse('aud string that only contains the AUD', await jwt(good({ aud: 'x' + AUD })));
    await refuse('expired 31 s ago', await jwt(good({ exp: now() - 31 })));
    await refuse('wrong aud', await jwt(good({ aud: ['other-aud-0123456789'] })));
    await refuse('aud missing', await jwt(Object.assign(good(), { aud: undefined })));
    await refuse('wrong issuer', await jwt(good({ iss: 'https://other-team.cloudflareaccess.com' })));
    await refuse('expired', await jwt(good({ exp: now() - 120 })));
    await refuse('exp missing', await jwt(Object.assign(good(), { exp: undefined })));
    await refuse('not yet valid (nbf in the future)', await jwt(good({ nbf: now() + 600 })));
    await refuse('nbf not a number', await jwt(good({ nbf: 'soon' })));
    await refuse('signed by a key that is not in the Access key set (kid k1)', await jwt(good(), { key: K2 }));
    await refuse('unknown key id', await jwt(good(), { head: { kid: 'k9' } }));
    await refuse('alg HS256 header', await jwt(good(), { head: { alg: 'HS256' } }));
    await refuse('alg none header', await jwt(good(), { head: { alg: 'none' } }));
    await refuse('kid missing', await jwt(good(), { head: { kid: undefined } }));
    {
      const p = T.split('.'); const c = JSON.parse(Buffer.from(p[1], 'base64url').toString()); c.email = 'someone.else@example.com';
      await refuse('payload swapped after signing', p[0] + '.' + b64u(JSON.stringify(c)) + '.' + p[2]);
    }
    await refuse('oversized token', 'a'.repeat(9000));
    {
      const big = await jwt(good({ pad: 'x'.repeat(9000) }));
      await refuse('validly signed owner token over 8192 characters (' + big.length + ')', big);
    }
    chk('every refusal has the identical body', REF.length > 10 && REF.every(x => x === REF[0]), [...new Set(REF)]);

    // --- key refetch is limited; key-set failures fail closed
    W._resetCerts(); FETCHES = [];
    await call('/', { tok: T });
    const unk = await jwt(good(), { head: { kid: 'k9' } });
    await call('/', { tok: unk }); await call('/', { tok: unk });
    chk('unknown key id right after a fetch does not refetch the key set', FETCHES.length === 1, FETCHES.length);
    W._resetCerts(); FETCHES = []; CERTS_STATUS = 500;
    const down = await call('/', { tok: T });
    chk('key set unavailable -> 503 auth_unavailable', down.status === 503 && down.j && down.j.error === 'auth_unavailable', [down.status, down.j]);
    CERTS_STATUS = 200;
    const again = await call('/', { tok: T });
    chk('after a failed key fetch: 503 again without a new fetch (backoff)', again.status === 503 && FETCHES.length === 1, [again.status, FETCHES.length]);
    {
      const c = W.cfg(ENV()), t0 = Date.now();
      const v = await W.verifyAccessJwt(T, c, t0 + W.CERTS_BACKOFF_MS + 1000);
      chk('after the backoff the key set is fetched again and the owner verifies', v && v.email === OWNER && FETCHES.length === 2, FETCHES.length);
      const v2 = await W.verifyAccessJwt(T, c, t0 + W.CERTS_BACKOFF_MS + 1000 + W.CERTS_TTL_MS + 1000);
      chk('cached keys expire after CERTS_TTL_MS (re-fetched)', v2 && FETCHES.length === 3, FETCHES.length);
      let threw = false;
      try { await W.verifyAccessJwt(T, W.cfg(ENV({ ACCESS_TEAM_DOMAIN: 'https://other-team.cloudflareaccess.com' })), t0 + W.CERTS_BACKOFF_MS + 2000 + W.CERTS_TTL_MS); } catch (_) { threw = true; }
      chk('a different team never reuses cached keys (fetches its own certs URL)', threw && FETCHES[FETCHES.length - 1] === 'https://other-team.cloudflareaccess.com/cdn-cgi/access/certs', FETCHES.slice(-1));
    }
    W._resetCerts(); FETCHES = [];
    const burst = await Promise.all(Array.from({ length: 20 }, () => call('/', { tok: unk })));
    chk('20 concurrent requests on a cold isolate share one key fetch', FETCHES.length === 1 && burst.every(r => r.status === 403), [FETCHES.length, [...new Set(burst.map(r => r.status))]]);
    for (const [mode, n] of [['empty', 'empty key set'], ['rs384', 'only an RS384 key'], ['oct', 'only a non-RSA (oct) key']]) {
      W._resetCerts(); CERTS_MODE = mode;
      const r = await call('/', { tok: T });
      chk(n + ' -> 503 auth_unavailable (no usable key)', r.status === 503 && r.j && r.j.error === 'auth_unavailable', [r.status, r.j]);
    }
    CERTS_MODE = 'ok'; W._resetCerts();

    // --- fix round 2: fetch timeout signal, in-flight age limit, keys from the own load, backoff from the failure time
    {
      FETCHES = []; SIGNALS = [];
      await call('/', { tok: T });
      chk('the key fetch carries an abort signal (timeout)', SIGNALS.length === 1 && SIGNALS[0] === true, SIGNALS);
      chk('fetch timeout and in-flight limit are 5 s / 10 s', W.CERTS_FETCH_TIMEOUT_MS === 5000 && W.CERTS_INFLIGHT_MAX_MS === 10000);
      const race = (p, ms) => { let t; return Promise.race([p, new Promise(r => { t = setTimeout(() => r('TIMEOUT'), ms); })]).finally(() => clearTimeout(t)); };
      W._resetCerts(); FETCHES = []; HANG_NEXT = true;
      const c = W.cfg(ENV()), t0 = Date.now();
      W.verifyAccessJwt(T, c, t0).catch(() => {});   // never settles: its key fetch hangs
      const later = await race(W.verifyAccessJwt(T, c, t0 + W.CERTS_INFLIGHT_MAX_MS + 1000).then(v => v ? 'ok' : 'null', () => 'error'), 300);
      chk('a hung key fetch is not reused past the in-flight limit (later request fetches again and verifies)', later === 'ok' && FETCHES.length === 2, [later, FETCHES.length]);
      W._resetCerts();
    }
    {
      SERVE_B = true;
      const TB = await jwt(good({ iss: TEAM_B }), { key: K2 });
      const cA = W.cfg(ENV()), cB = W.cfg(ENV({ ACCESS_TEAM_DOMAIN: TEAM_B }));
      for (const order of [[0, 1], [1, 0]]) {
        W._resetCerts(); GATED = [];
        const pA = W.verifyAccessJwt(T, cA, Date.now()).then(v => v ? 'ok' : 'null', () => 'error');
        const pB = W.verifyAccessJwt(TB, cB, Date.now()).then(v => v ? 'ok' : 'null', () => 'error');
        while (GATED.length < 2) await new Promise(r => setTimeout(r, 1));
        const rel = GATED; GATED = null; order.forEach(i => rel[i]());
        const got = await Promise.all([pA, pB]);
        chk('two teams loading keys at once each verify with their own keys (release order ' + order.join('') + ')', got[0] === 'ok' && got[1] === 'ok', got);
      }
      SERVE_B = false; W._resetCerts();
    }
    {
      // fix round 3 (QA-DB1-12): a load that a newer load replaced must not put its old keys back into the shared cache
      W._resetCerts(); FETCHES = []; GATED = [];
      const c = W.cfg(ENV()), t0 = Date.now() + 1000;
      const T2 = await jwt(good(), { key: K2, head: { kid: 'k2' } });
      const old = W.verifyAccessJwt(T, c, t0).then(v => v ? 'ok' : 'null', () => 'error');   // load 1: held, will return key set k1
      while (GATED.length < 1) await new Promise(r => setTimeout(r, 1));
      const held = GATED; GATED = null; CERTS_MODE = 'k2';
      const race = (p, ms) => { let tm; return Promise.race([p, new Promise(r => { tm = setTimeout(() => r('TIMEOUT'), ms); })]).finally(() => clearTimeout(tm)); };
      const fresh = await race(W.verifyAccessJwt(T2, c, t0 + W.CERTS_INFLIGHT_MAX_MS + 1).then(v => v ? 'ok' : 'null', () => 'error'), 300);   // load 2: k2
      CERTS_MODE = 'ok'; held[0]();
      const late = await race(old, 300);
      const after = await W.verifyAccessJwt(T2, c, t0 + W.CERTS_INFLIGHT_MAX_MS + 2).then(v => v ? 'ok' : 'null', () => 'error');
      chk('a replaced key load does not overwrite the newer keys (owner token on the new key still verifies)', fresh === 'ok' && late === 'ok' && after === 'ok' && FETCHES.length === 2,
        [fresh, late, after, FETCHES.length]);
      CERTS_MODE = 'ok'; W._resetCerts();
    }
    {
      // fix round 4 (QA-DB1-14): a replaced load that fails late must not arm the backoff (clock shifted into the past so
      // that Math.max(now, Date.now()) would put a wrongly armed backoff after the next request)
      W._resetCerts(); FETCHES = []; GATED = [];
      const c = W.cfg(ENV()), T0 = Date.now() - 100000;
      const back = { iat: now() - 300, nbf: now() - 300 };   // valid at the shifted clock too
      const T = await jwt(good(back));
      const T2 = await jwt(good(back), { key: K2, head: { kid: 'k2' } });
      const race = (p, ms) => { let tm; return Promise.race([p, new Promise(r => { tm = setTimeout(() => r('TIMEOUT'), ms); })]).finally(() => clearTimeout(tm)); };
      const old = W.verifyAccessJwt(T, c, T0).then(v => v ? 'ok' : 'null', () => 'error');   // load 1: held, will fail
      while (GATED.length < 1) await new Promise(r => setTimeout(r, 1));
      const held = GATED; GATED = null;
      const newer = await race(W.verifyAccessJwt(T, c, T0 + W.CERTS_INFLIGHT_MAX_MS + 1).then(v => v ? 'ok' : 'null', () => 'error'), 300);   // load 2: ok
      CERTS_STATUS = 500; held[0]();
      const late = await race(old, 300);
      CERTS_STATUS = 200; CERTS_MODE = 'k2';
      const next = await race(W.verifyAccessJwt(T2, c, T0 + W.CERTS_INFLIGHT_MAX_MS + 1 + W.CERTS_REFETCH_MS + 1).then(v => v ? 'ok' : 'null', () => 'error'), 300);
      chk('a replaced load that fails late does not arm the backoff (next key fetch proceeds)', newer === 'ok' && late === 'error' && next === 'ok' && FETCHES.length === 3,
        [newer, late, next, FETCHES.length]);
      CERTS_MODE = 'ok'; W._resetCerts();
    }
    {
      W._resetCerts(); FETCHES = []; CERTS_STATUS = 500;
      const c = W.cfg(ENV()), tPast = Date.now() - 60000;
      const first = await W.verifyAccessJwt(T, c, tPast).then(() => 'ok', () => 'error');
      CERTS_STATUS = 200;
      const second = await W.verifyAccessJwt(T, c, tPast + W.CERTS_BACKOFF_MS + 1).then(v => v ? 'ok' : 'null', () => 'error');
      chk('backoff counts from when the failure arrived, not when the failing fetch started', first === 'error' && second === 'error' && FETCHES.length === 1, [first, second, FETCHES.length]);
      W._resetCerts();
    }

    // --- routes, methods, same-origin POST
    chk('POST / -> 405', (await call('/', { tok: T, method: 'POST' })).status === 405);
    chk('GET /api/whoami -> 405', (await call('/api/whoami', { tok: T })).status === 405);
    chk('POST /app.css -> 405', (await call('/app.css', { tok: T, method: 'POST' })).status === 405);
    chk('POST /api/whoami from another origin -> 403 forbidden_origin', (await call('/api/whoami', { tok: T, method: 'POST', origin: 'https://raffyrojo.github.io' })).j.error === 'forbidden_origin');
    chk('POST /api/whoami without Origin -> 403', (await call('/api/whoami', { tok: T, method: 'POST', origin: null })).status === 403);
    chk('unknown path -> 404 (owner only)', (await call('/api/stats', { tok: T })).status === 404);
    const anon404 = await call('/api/stats', {});
    chk('unknown path without Access JWT -> 403 (routes are not revealed)', anon404.status === 403, anon404.status);
    chk('OPTIONS without Access JWT -> 403 (no CORS preflight answer)', (await call('/api/whoami', { method: 'OPTIONS' })).status === 403);

    // --- DB2b: aggregate analytics from the real SQL over a real SQLite copy of the VERO schema (synthetic rows)
    let dbPage = null;
    {
      resetLog();
      const r = await call('/', { tok: T, env: ENV({ DB: sqliteD1(seedMain) }) });
      dbPage = r;
      const t = r.text;
      chk('DB2b: owner page with the binding -> 200, analytics rendered (tiles + sections A-E), not "Data unavailable"', r.status === 200 && t.includes('class="tiles"')
        && ['A. AI usage', 'B. Monthly usage', 'C. Answer routes', 'D. Low-confidence', 'E. Frequently recommended'].every(x => t.includes(x)) && !t.includes('Data unavailable'), t.slice(0, 200));
      chk('DB2b: exactly one batch of the six fixed statements, in order, bound only to the cutoff (and k = 3)', LOG.batches === 1 && JSON.stringify(LOG.prepared) === JSON.stringify(Object.values(EXPECT_SQL))
        && JSON.stringify(LOG.binds) === JSON.stringify([[MDAY(29)], [UMONTH(2)], [MDAY(29)], [MDAY(29)], [MDAY(29)], [MDAY(29), 3]]), [LOG.batches, LOG.binds]);
      chk('DB2b: no excluded value reaches the page (question text, search query, domains, code_id, ip_hash, ts, role)', SECRET.every(m => !t.includes(m)), SECRET.filter(m => t.includes(m)));
      chk('DB2b: tiles = 7 AI answers, 16 logged (3 cached), 18.8% failed, 15.4% low confidence, 10% no product of 10 answered, $3.40 this month',
        ['<span>AI answers</span><b>7</b>', '<span>Logged AI questions</span><b>16</b><i>incl. 3 cached</i>',
          '<span>Failed AI calls</span><b>18.8%</b><i>3 of 16 logged (not wrong answers)</i>',   // fix round 1 (DB2b-D3): each tile names its denominator
          '<span>Low confidence</span><b>15.4%</b><i>of 13 not cached; signal, not proof</i>', '<span>No product suggested</span><b>10%</b><i>of 10 answered</i>',
          '<span>Cost this month</span><b>$3.40</b>'].every(x => t.includes(x)),
        (t.match(/<div class="tile">.*?<\/div>/g) || []).join(' '));
      chk('DB2b: rows outside the window / older months are not shown (day 40, month -3)', !t.includes(MDAY(40)) && !t.includes('900') && !t.includes(UMONTH(3)) && !t.includes('$9.99') && !t.includes('77777'));
      chk('DB2b: SKUs - 95169HSR listed with 3 answers; 25870 (2 answers, below k), cached 10334, invalid and 40-char codes absent',
        t.includes('<td data-l="Item code">95169HSR</td><td data-l="Answers">3</td>') && !t.includes('>25870<') && !t.includes('10334') && !t.includes('99999') && !t.includes('A'.repeat(40)));
      chk('DB2b: hostile values are escaped, & included (no raw tag or bare & from the database)', t.includes('&lt;img src=x onerror=alert(1)&gt; &amp; co') && !/<img|<script|onerror=alert\(1\)>| & co/.test(t));
      // fix round 1 (QA-DB2b-1): section B shares against the right budget (3.40 of 4.50; web 0.50 of 2.00)
      chk('DB2b: section B - this month 75.6% of the $4.50 budget, web 25% of the $2.00 web budget', t.includes('<td data-l="Of budget">75.6%</td>') && t.includes('<td data-l="Of web budget">25%</td>'));
      chk('DB2b: latency buckets 8 / 2 / 1 / 1 / 1 (no row-level values)', ['under 2 s</td><td data-l="Questions">8<', '2 to 5 s</td><td data-l="Questions">2<',
        '5 to 10 s</td><td data-l="Questions">1<', '10 to 20 s</td><td data-l="Questions">1<', '20 s or more</td><td data-l="Questions">1<'].every(x => t.includes(x)));
      chk('DB2b: coverage note on the page (staff AI only, local answers not logged, events off, signals not proof)', t.includes('<b>Coverage:</b> staff UNO AI answers only')
        && t.includes('UNO event logging is off') && t.includes('not proven errors'));
      chk('DB2b: the analytics page has no script, no inline style, and the only links are /app.css + Back to Admin',
        !/<script|style=/i.test(t.replace(/&lt;script/g, '')) && JSON.stringify([...t.matchAll(/href="([^"]*)"/g)].map(m => m[1])) === JSON.stringify(['/app.css', 'https://raffyrojo.github.io/ugreen-pricelist/#uno-return']));
      chk('DB2b: same strict headers with data (exact CSP, no-store, DENY)', r.h.get('content-security-policy') === ok.h.get('content-security-policy') && r.h.get('cache-control') === 'no-store' && r.h.get('x-frame-options') === 'DENY');
    }
    {
      const W0 = Date.UTC(2026, 9, 25, 20, 0, 0);   // 2026-10-26 04:00 Manila
      const c = W.cutoffs(W0);
      chk('DB2b: cutoffs use the Manila day (UTC 2026-10-25 20:00 -> window from 2026-09-27) and the last 3 UTC months', c.day === '2026-09-27' && c.month === '2026-08' && c.thisMonth === '2026-10', c);
      // fix round 1 (QA-DB2b-2): at a month boundary the Manila day is already November, the spend month is still the UTC month
      const e = W.cutoffs(Date.UTC(2026, 9, 31, 20, 0, 0));   // 2026-11-01 04:00 Manila
      chk('DB2b: month boundary - UTC 2026-10-31 20:00 -> window from 2026-10-03, this month 2026-10 (UTC, not Manila)', e.day === '2026-10-03' && e.thisMonth === '2026-10' && e.month === '2026-08', e);
    }
    {
      // fix round 1 (DB2b-D2): an empty element in a picks string (",," / trailing comma) is never counted as an item code
      const db = new DatabaseSync(':memory:');
      db.exec(MIGRATION);
      const ins = db.prepare("INSERT INTO question_log (ts, day, code_id, role, q_redacted, route, trigger, picks, outcome) VALUES ('t', ?, 'c', 'r', 'q', 'catalog', 'auto', ?, 'ok')");
      for (const p of [',,', 'C1,', ',C1', 'C1,,C2', 'C1', 'C2']) ins.run(MDAY(0), p);
      const got = db.prepare(W.SQL.picks).all(MDAY(29), 1);
      chk('DB2b: SQL picks never yields an empty item code (",,", trailing / leading / double commas)', got.length === 2 && got.every(r => r.item_code !== '') && got[0].item_code === 'C1' && got[0].n === 4, got);
    }
    for (const [n, env, mode] of [['kill switch off', ENV({ DASHBOARD_ENABLED: 'false' }), 503], ['no Access JWT', ENV(), 403], ['other email', ENV(), 403]]) {
      resetLog();
      const tok = n === 'no Access JWT' ? undefined : n === 'other email' ? await jwt(good({ email: 'someone.else@example.com' })) : T;
      const r = await call('/', { tok, env: Object.assign(env, { DB: sqliteD1(seedMain) }) });
      chk('DB2b: ' + n + ' -> ' + mode + ' and the database is never touched', r.status === mode && LOG.prepared.length === 0 && LOG.batches === 0, [r.status, LOG.prepared.length, LOG.batches]);
    }
    for (const [n, db] of [['D1 throws', sqliteD1(seedMain, { fail: true })], ['unexpected result shape', sqliteD1(seedMain, { badShape: true })], ['binding without batch()', { prepare() { return {}; } }]]) {
      const r = await call('/', { tok: T, env: ENV({ DB: db }) });
      chk('DB2b: ' + n + ' -> 200 "Data unavailable", no numbers', r.status === 200 && r.text.includes('Data unavailable') && !r.text.includes('class="tiles"'), r.text.slice(-200));
    }
    {
      const r = await call('/', { tok: T, env: ENV({ DB: sqliteD1(null) }) });
      chk('DB2b: empty database -> 200, "no data in this window", zero tiles', r.status === 200 && r.text.includes('no data in this window') && r.text.includes('<span>AI answers</span><b>0</b>'), r.text.slice(0, 120));
      chk('DB2b: POST / is still 405 with the binding, /api/whoami unchanged', (await call('/', { tok: T, method: 'POST', env: ENV({ DB: sqliteD1(null) }) })).status === 405
        && (await call('/api/whoami', { tok: T, method: 'POST', env: ENV({ DB: sqliteD1(null) }) })).j.role === 'owner');
    }
    {
      // page-side filters (as if the SQL misbehaved): codes below k, invalid codes, more than 20 codes, bad day / month strings
      const many = Array.from({ length: 25 }, (_, i) => ({ item_code: 'C' + (100 + i), n: 30 - i }));
      const res = [[{ day: 'not-a-day', ai_calls: 5 }, { day: MDAY(0), ai_calls: 1 }], [{ month: '2026-1x', micro_usd: 5 }], [],
        [{ day: 'bad-day-2', n: 7 }, { day: MDAY(0), n: 1 }], [],   // fix round 1 (QA-DB2b-3): the signals rows are day-checked too
        [{ item_code: 'LOW1', n: 2 }, { item_code: 'bad code', n: 99 }, { item_code: '"><b>x', n: 99 }].concat(many)];   // first: only the filters can drop them
      resetLog();
      const r = await call('/', { tok: T, env: ENV({ DB: rawD1(res) }) });
      const listed = [...r.text.matchAll(/<td data-l="Item code">([^<]*)<\/td>/g)].map(m => m[1]);
      chk('DB2b: page-side filters: at most 20 codes, none below k = 3, only [A-Za-z0-9-] codes, invalid day / month rows dropped',
        listed.length === 20 && listed[0] === 'C100' && !listed.includes('LOW1') && !r.text.includes('bad code') && !r.text.includes('not-a-day') && !r.text.includes('2026-1x')
        && !r.text.includes('bad-day-2')
        && !r.text.includes('<b>x'), [listed.length, listed.slice(0, 3)]);
    }

    // --- headers on every response
    const all = [ok, css, who, anon404, dbPage, await call('/', { tok: T, env: ENV({ DASHBOARD_ENABLED: 'false' }) })];
    const hdrOk = r => r.h.get('cache-control') === 'no-store' && /frame-ancestors 'none'/.test(r.h.get('content-security-policy') || '')
      && /default-src 'none'/.test(r.h.get('content-security-policy') || '') && !/unsafe-inline|unsafe-eval/.test(r.h.get('content-security-policy') || '')
      && r.h.get('x-content-type-options') === 'nosniff' && r.h.get('x-frame-options') === 'DENY' && r.h.get('referrer-policy') === 'no-referrer';
    chk('every response: no-store, strict CSP (no unsafe-inline / eval), nosniff, DENY, no-referrer', all.every(hdrOk));
    chk('no response carries CORS or cookie headers', all.every(r => ![...r.h.keys()].some(k => /^access-control-|^set-cookie$/.test(k))));
    chk('no response body contains the owner email, AUD or team domain', all.concat([who]).every(r => !r.text.toLowerCase().includes(OWNER) && !r.text.includes(AUD) && !r.text.includes('example-team')));
    chk('the shell page has no script and no inline style', !/<script|style=/i.test(ok.text));
    chk('the Worker wrote no log output', LOGGED.length === 0, LOGGED.slice(0, 2));
  } catch (e) {
    failed.push('exception: ' + (e && e.message));
    if (out) _log('FAIL - exception: ' + (e && e.stack));
  } finally {
    for (const k of ['log', 'warn', 'error', 'info', 'debug']) console[k] = k === 'log' ? _log : () => {};
  }
  return failed;
}

/* ---------------- static checks on the source and its config ---------------- */
function statics(src, mod) {
  const SRC = src;   // fix round 4: also run on every mutant source (DB2b: with its loaded module, for SQL)
  const res = [];
  const s = SRC.replace(/\/\*[\s\S]*?\*\//g, '');
  // fix rounds 2-3 (QA-DB1-9 / QA-DB1-13): on the RAW source (no comment stripping), env appears only as env.<one of the 4 settings>,
  // in the cfg(env) definition / call and in fetch(req, env); no Reflect, arguments or cloudflare: import; the default export has
  // exactly one handler, fetch
  // DB2b: plus exactly one read of the D1 binding, env.DB, handed to page() after the owner check
  const envLeft = SRC.replace(/\benv\.(ACCESS_AUD|ACCESS_TEAM_DOMAIN|DASHBOARD_ENABLED|OWNER_EMAIL)\b/g, '').replace('export function cfg(env) {', '')
    .replace('async fetch(req, env) {', '').replace('const c = cfg(env);', '').replace('await page(env.DB, t)', '');
  res.push(['worker uses env only for the 4 settings + one env.DB read (no other binding, alias, destructuring, env[...], Reflect, arguments, cloudflare: import or backslash-u escape)',
    !/\benv\b/.test(envLeft) && (SRC.match(/\bcfg\(env\)/g) || []).length === 2 && (SRC.match(/\benv\.DB\b/g) || []).length === 1 && !/\bReflect\b|\barguments\b|cloudflare:|\\u/.test(SRC)]);
  const dflt = SRC.slice(SRC.indexOf('\nexport default {'));
  res.push(['the default export has exactly one handler: fetch(req, env)', (SRC.match(/\nexport default \{/g) || []).length === 1
    && (dflt.match(/^ {2}(?:async\s+)?[A-Za-z_$][\w$]*\s*\(/gm) || []).length === 1 && /^ {2}async fetch\(req, env\) \{/m.test(dflt)
    && !/^ {2}[A-Za-z_$'"][^\n]*:/m.test(dflt) && (SRC.match(/\bexport\s+default\b/g) || []).length === 1]);
  res.push(['worker sends no CORS header', !/access-control-/i.test(s)]);
  res.push(['worker has no hard-coded email address', !/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(SRC)]);
  res.push(['worker writes no log line and uses no browser storage / cookies', !/console\.|localStorage|sessionStorage|set-cookie|document\.cookie/i.test(s)]);
  res.push(['worker routes are exactly / /app.css /api/whoami', JSON.stringify([...new Set([...s.matchAll(/url\.pathname === '([^']+)'/g)].map(m => m[1]))].sort()) === JSON.stringify(['/', '/api/whoami', '/app.css'])
    && (s.match(/pathname/g) || []).length === 3]);
  res.push(['kill switch is exactly DASHBOARD_ENABLED === "true" and runs first', s.includes("enabled: String(env.DASHBOARD_ENABLED) === 'true',")
    && /const c = cfg\(env\);\s*if \(!c\.enabled\) return fail\(503, 'dashboard_off'\);/.test(s)]);
  res.push(['the only outbound fetch is the Access key set of the configured team', (s.match(/\bfetch\(/g) || []).length === 2 && (s.match(/async fetch\(req, env\)/g) || []).length === 1 && s.includes("fetch(team + '/cdn-cgi/access/certs'")]);
  // fix round 2 (QA-DB1-9): exact key allowlist per section (catches inline binding arrays such as kv_namespaces = [ ... ])
  const sect = {}; let cur = '';
  for (const raw of TOML.split('\n')) {
    const l = raw.replace(/#.*$/, '').trim();
    if (!l) continue;
    const t = l.match(/^\[{1,2}([^\]]+)\]{1,2}$/);
    if (t) { cur = l; sect[cur] = sect[cur] || []; continue; }
    const k = l.match(/^([A-Za-z0-9_.-]+)\s*=/);
    (sect[cur] = sect[cur] || []).push(k ? k[1] : '?' + l.slice(0, 20));
  }
  // DB2a (DB1-DEP-5): the kill switch is dashboard-managed (no [vars] table; keep_vars = true keeps it on a wrangler deploy)
  res.push(['wrangler.toml: exact keys per section (top: name main compatibility_date workers_dev preview_urls keep_vars; [observability]: enabled; [[d1_databases]]: binding database_name database_id)',
    JSON.stringify(sect) === JSON.stringify({ '': ['name', 'main', 'compatibility_date', 'workers_dev', 'preview_urls', 'keep_vars'], '[observability]': ['enabled'],
      '[[d1_databases]]': ['binding', 'database_name', 'database_id'] })]);
  const tables = [...TOML.matchAll(/^\s*\[{1,2}([^\]]+)\]{1,2}/gm)].map(m => m[0].trim());
  res.push(['wrangler.toml: only [observability] + one [[d1_databases]] (no [vars], no other binding table), no route', JSON.stringify(tables) === JSON.stringify(['[observability]', '[[d1_databases]]']) && !/^\s*routes?\s*=/m.test(TOML)]);
  // DB2b: the one binding is DB -> the VERO database (same id as backend/vero/wrangler.toml)
  const veroId = (VERO_TOML.match(/^database_id = "([0-9a-f-]{36})"/m) || [])[1];
  res.push(['wrangler.toml: binding "DB" -> database "ugreen-vero", database_id = backend/vero/wrangler.toml', !!veroId && /^binding = "DB"$/m.test(TOML)
    && /^database_name = "ugreen-vero"$/m.test(TOML) && new RegExp('^database_id = "' + veroId + '"', 'm').test(TOML)]);
  // DB2b read-only safeguards (owner decisions 2026-10-25): the six SQL texts are exactly the reviewed ones; D1 is touched only as
  // prepare(SQL.<name>) x 6 + one batch; no write keyword, no excluded column / table; constants agree with the VERO config
  const W2 = mod && mod.SQL ? Object.assign({}, mod.SQL) : null;
  res.push(['DB2b: SQL = exactly the six reviewed statements', !!W2 && JSON.stringify(W2) === JSON.stringify(EXPECT_SQL)]);
  const prep = [...s.matchAll(/\.prepare\(([^)]*)\)/g)].map(m => m[1]);
  res.push(['DB2b: D1 is used only as prepare(SQL.<name>) x 6 (each once) + one batch; no exec / run / first / raw / all / dump', prep.length === 6
    && JSON.stringify(prep.slice().sort()) === JSON.stringify(Object.keys(EXPECT_SQL).map(k => 'SQL.' + k).sort()) && (s.match(/\.batch\(/g) || []).length === 1
    && !/(?<!Promise)\.(exec|run|first|raw|all|dump|withSession)\(/.test(s)]);
  res.push(['DB2b: no SQL write / schema keyword anywhere in the Worker', !/\b(INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE|PRAGMA|ATTACH|DETACH|VACUUM|TRIGGER)\b/.test(s)]);
  const sqlText = W2 ? Object.values(W2).join(' ') : '';
  res.push(['DB2b: SQL never names question text, search query, source domains, code_id, ip_hash, ts, id, role, or another table', !!sqlText
    && !/q_redacted|search_query|source_domains|code_id|ip_hash|\bts\b|\bid\b|\brole\b|answer_cache|access_codes|counters|product_text|\bmeta\b|uno_/.test(sqlText)
    && JSON.stringify([...new Set([...sqlText.matchAll(/\bFROM\s+([a-z_]+)/g)].map(m => m[1]))].sort()) === JSON.stringify(['daily_stats', 'question_log', 'spend'])]);
  const vv = k => (VERO_TOML.match(new RegExp('^' + k + ' = "([^"]*)"', 'm')) || [])[1];
  res.push(['DB2b: budget constants = VERO config (4.50 / 2.00), window = LOG_RETENTION_DAYS (30), Manila offset = DAY_UTC_OFFSET_MIN (480)',
    !!vv('MONTHLY_BUDGET_USD') && s.includes("export const BUDGET_USD = '" + vv('MONTHLY_BUDGET_USD') + "';") && s.includes("export const WEB_BUDGET_USD = '" + vv('WEB_MONTHLY_BUDGET_USD') + "';")
    && s.includes('export const WINDOW_DAYS = ' + vv('LOG_RETENTION_DAYS') + ';') && s.includes('export const DAY_OFFSET_MIN = ' + vv('DAY_UTC_OFFSET_MIN') + ';')
    && s.includes('export const PICK_MIN = 3;') && s.includes('export const PICK_TOP = 20;')]);
  res.push(['DB2b: every table cell and tile value goes through esc()', s.includes("'<td data-l=\"' + esc(head[i]) + '\">' + esc(c) + '</td>'")
    && s.includes("'<div class=\"tile\"><span>' + esc(label) + '</span><b>' + esc(value) + '</b><i>' + esc(note) + '</i></div>'")]);
  res.push(['wrangler.toml: kill switch not set in the file (dashboard-managed, keep_vars = true), observability off, workers.dev only, no preview URLs',
    !/^\s*DASHBOARD_ENABLED\s*=/m.test(TOML) && /^keep_vars = true\b/m.test(TOML) && /\[observability\]\s*\nenabled = false/.test(TOML)
    && /^workers_dev = true$/m.test(TOML) && /^preview_urls = false\b/m.test(TOML)]);
  // DB2a (DB1-DEP-2): the mirror carries the dashboard's compatibility date (owner decision 2026-10-24)
  res.push(['wrangler.toml: compatibility_date = "2026-10-24" (= the dashboard)', /^compatibility_date = "2026-10-24"/m.test(TOML)]);
  res.push(['wrangler.toml: no email, AUD or team value', !/@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(TOML) && !/OWNER_EMAIL\s*=|ACCESS_AUD\s*=|ACCESS_TEAM_DOMAIN\s*=/.test(TOML)]);
  return res;
}

/* ---------------- mutants: each must be caught ---------------- */
const MUT = [
  ['kill switch truthy', "enabled: String(env.DASHBOARD_ENABLED) === 'true',", 'enabled: !!env.DASHBOARD_ENABLED,'],
  ['kill switch after auth', "    if (!c.enabled) return fail(503, 'dashboard_off');                 // kill switch first: nothing else runs\n", ''],
  ['config always ok', 'function configured(c) { return ', 'function configured(c) { return true || '],
  ['team host not validated', 'team: TEAM_RE.test(team) ? team : \'\',', 'team,'],
  ['alg not checked', "head.alg !== 'RS256' || ", ''],
  ['signature ignored', 'if (!sigOk) return null;', ''],
  ['aud not checked', 'if (aud.indexOf(c.aud) < 0) return null;', ''],
  ['iss not checked', 'if (claims.iss !== c.team) return null;', ''],
  ['exp not checked', 'claims.exp + CLOCK_SKEW_SEC < sec', 'false'],
  ['nbf not checked', "claims.nbf - CLOCK_SKEW_SEC > sec", 'false'],
  ['owner email not compared', '!(await sameEmail(normEmail(claims.email), c.owner))', 'false'],
  ['email compared by substring', 'return d === 0;', 'return d === 0 || true;'],
  ['origin not checked', "if ((req.headers.get('origin') || '') !== url.origin) return fail(403, 'forbidden_origin');", ''],
  ['keys never cached', 'if (fresh && CERTS.keys.has(kid)) return', 'if (false) return'],
  ['unknown kid refetches every time', 'if (fresh && now - CERTS.tried < CERTS_REFETCH_MS) return null;', ''],
  ['key-set failure accepted', "catch (_) { return fail(503, 'auth_unavailable'); }", 'catch (_) { claims = { email: c.owner, exp: 0 }; }'],
  ['whoami leaks the email', "return json({ ok: true, role: 'owner', exp: claims.exp });", "return json({ ok: true, role: 'owner', exp: claims.exp, email: claims.email });"],
  ['CSP allows inline', "const CSP = \"default-src 'none';", "const CSP = \"default-src 'none' 'unsafe-inline';"],
  ['no-store dropped', "'cache-control': 'no-store', ", ''],
  ['CORS header added', "'content-type': type, ", "'content-type': type, 'access-control-allow-origin': '*', "],
  // fix round 1 (QA-DB1-1 ... QA-DB1-4)
  ['email ASCII check removed', '  if (!EMAIL_RE.test(claims.email)) return null;', ''],
  ['owner config ASCII check loosened', 'function configured(c) { return EMAIL_RE.test(c.ownerRaw) &&', "function configured(c) { return c.owner.indexOf('@') > 0 &&"],
  ['crit accepted', '  if (head.crit !== undefined) return null;', ''],
  ['no shared in-flight key fetch', '  if (CERTS.inflight && CERTS.inflightTeam === team && now - CERTS.inflightAt < CERTS_INFLIGHT_MAX_MS) return CERTS.inflight;\n', ''],
  // fix round 2 (QA-DB1-7 ... QA-DB1-11, size limit)
  ['owner config checked after lower-casing', 'EMAIL_RE.test(c.ownerRaw)', 'EMAIL_RE.test(c.owner)'],
  ['in-flight fetch reused forever', ' && now - CERTS.inflightAt < CERTS_INFLIGHT_MAX_MS) return CERTS.inflight;', ') return CERTS.inflight;'],
  ['key fetch without timeout', ", signal: AbortSignal.timeout(CERTS_FETCH_TIMEOUT_MS) });", ' });'],
  ['keys read from the shared cache', 'return got && got.team === team ? got.keys.get(kid) || null : null;', 'return CERTS.keys.get(kid) || null;'],
  ['backoff from the fetch start', 'CERTS.failedAt = Math.max(now, Date.now());', 'CERTS.failedAt = now;'],
  ['token size limit dropped', ' || token.length > 8192', ''],
  // fix round 4 (QA-DB1-15): identifiers spelled with backslash-u escapes read a binding past a plain-text check
  ['escaped env binding read', '    const c = cfg(env);', '    void \\u0065nv.DB;\n    const c = cfg(env);'],
  ['escaped env with code-point brace', '    const c = cfg(env);', '    void \\u{65}nv.DB;\n    const c = cfg(env);'],
  ['escaped Reflect read', '    const c = cfg(env);', '    void Reflec\\u0074.ownKeys(\\u0065nv);\n    const c = cfg(env);'],
  ['escaped arguments read', '    const c = cfg(env);', '    void argument\\u0073[1];\n    const c = cfg(env);'],
  // fix round 4 (QA-DB1-14)
  ['replaced load arms the backoff', '    if (CERTS.inflight === p) { CERTS.failTeam = team; CERTS.failedAt = Math.max(now, Date.now()); }',
    '    { CERTS.failTeam = team; CERTS.failedAt = Math.max(now, Date.now()); }'],
  // fix round 3 (QA-DB1-12)
  ['replaced load overwrites newer keys', '    if (CERTS.inflight === p) { CERTS.team = team; CERTS.at = now; CERTS.keys = keys; CERTS.failTeam = \'\'; }',
    '    { CERTS.team = team; CERTS.at = now; CERTS.keys = keys; CERTS.failTeam = \'\'; }'],
  ['no failure backoff', "if (CERTS.failTeam === team && now - CERTS.failedAt < CERTS_BACKOFF_MS) return Promise.reject(new Error('certs_backoff'));", ''],
  ['clock skew widened to 90 s', 'export const CLOCK_SKEW_SEC = 30;', 'export const CLOCK_SKEW_SEC = 90;'],
  ['key cache never expires', 'now - CERTS.at < CERTS_TTL_MS', 'true'],
  ['team not part of the key cache', 'const fresh = CERTS.team === team &&', 'const fresh ='],
  ['string aud matched by substring', 'const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];', 'const aud = Array.isArray(claims.aud) ? claims.aud : (String(claims.aud).includes(c.aud) ? [c.aud] : []);'],
  ['empty key set accepted', "  if (!keys.size) throw new Error('certs_empty');\n", ''],
  ['JWK alg filter removed', "    if (k.alg !== undefined && k.alg !== 'RS256') continue;\n", ''],
  ['JWK kty filter removed', "k.kty !== 'RSA' || ", ''],
  ['HSTS removed', "\n    'strict-transport-security': 'max-age=31536000',", ''],
  ['COOP removed', "'cross-origin-opener-policy': 'same-origin',", ''],
  ['permissions-policy removed', "'permissions-policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',", ''],
  ['CSP allows remote scripts', "const CSP = \"default-src 'none'; style-src", "const CSP = \"default-src 'none'; script-src https:; style-src"],
  ['CSP base-uri dropped', " base-uri 'none';", ''],
  ['/app.css any method', "if (url.pathname === '/app.css') return req.method === 'GET' ?", "if (url.pathname === '/app.css') return true ?"],
  ['whoami exp changed', 'exp: claims.exp });', 'exp: Math.floor(Date.now() / 1000) + 7200 });'],
  // DB2a: same-tab Back link, framing still refused
  ['Back link to another host', "export const ADMIN_RETURN_URL = 'https://raffyrojo.github.io/ugreen-pricelist/#uno-return';", "export const ADMIN_RETURN_URL = 'https://evil.example/#uno-return';"],
  ['Back link without the return fragment', "ugreen-pricelist/#uno-return';", "ugreen-pricelist/';"],
  ['Back link removed', '<a class="back" href="\' + ADMIN_RETURN_URL + \'">&larr; Back to Admin</a>', ''],
  ['X-Frame-Options relaxed', "'x-frame-options': 'DENY'", "'x-frame-options': 'SAMEORIGIN'"],
  ['frame-ancestors opened to the admin origin', "frame-ancestors 'none'\";", "frame-ancestors https://raffyrojo.github.io\";"],
  // DB2b: read-only aggregate analytics
  ['k suppression removed in SQL', 'HAVING COUNT(*) >= ?2', 'HAVING COUNT(*) >= 1'],
  ['k filter removed page-side', ' && num(r.n) >= PICK_MIN).slice(0, PICK_TOP)', ').slice(0, PICK_TOP)'],
  ['top-20 cap removed', '.slice(0, PICK_TOP) };', ' };'],
  ['item-code check removed', 'CODE_RE.test(String(r.item_code)) && ', ''],
  ['day check removed', 'daily: rows(0).filter(r => DAY_RE.test(String(r.day))),', 'daily: rows(0),'],
  ['cell escaping removed', "'\">' + esc(c) + '</td>'", "'\">' + c + '</td>'"],
  ['tile escaping removed', "'</span><b>' + esc(value) + '</b>", "'</span><b>' + value + '</b>"],
  ['question text selected', 'SELECT route, outcome,', 'SELECT q_redacted AS route, outcome,'],
  ['cached answers counted as picks', "AND q.outcome = 'ok' AND q.picks IS NOT NULL", 'AND q.picks IS NOT NULL'],
  ['pick string filter removed', " AND q.picks NOT GLOB '*[^A-Za-z0-9,-]*' ", ' '],
  ['write statement added', '  picks: `SELECT', "  wipe: 'DELETE FROM question_log',\n  picks: `SELECT"],
  ['D1 read before the owner check', '    const t = Date.now();\n', '    const t = Date.now(); await page(env.DB, t);\n'],
  ['window widened to 45 days', 'export const WINDOW_DAYS = 30;', 'export const WINDOW_DAYS = 45;'],
  ['Manila offset dropped', 'export const DAY_OFFSET_MIN = 480;', 'export const DAY_OFFSET_MIN = 0;'],
  ['monthly window widened', 'd.getUTCMonth() - 2, 1', 'd.getUTCMonth() - 3, 1'],
  ['D1 failure rethrown', 'catch (_) { body = UNAVAILABLE; }', 'catch (e) { throw e; }'],
  ['result shape not checked', "if (!Array.isArray(r)) throw new Error('d1_shape'); return r;", 'return r || [];'],
  ['budget constant drifts from the VERO config', "export const BUDGET_USD = '4.50';", "export const BUDGET_USD = '5.00';"],
  // DB2b fix round 1 (QA-DB2b-1 ... 4, DB2b-D2, DB2b-D3)
  ['section B uses the web budget for the total', 'pct(r.micro_usd, Number(BUDGET_USD) * 1e6)', 'pct(r.micro_usd, Number(WEB_BUDGET_USD) * 1e6)'],
  ['this month taken from the Manila clock', 'thisMonth: d.toISOString().slice(0, 7)', 'thisMonth: new Date(t + DAY_OFFSET_MIN * 60000).toISOString().slice(0, 7)'],
  ['signals day check removed', 'signals: rows(3).filter(r => DAY_RE.test(String(r.day))),', 'signals: rows(3),'],
  ['& not escaped', "'&': '&amp;', ", "'&': '&', "],
  ['empty pick element counted', " AND j.value <> '' ", ' '],
  ['failed tile without its denominator', "int(failed) + ' of ' + int(logged) + ' logged (not wrong answers)'", "int(failed) + ' calls (not wrong answers)'"],
  ['low-confidence tile without its denominator', "'of ' + int(logged - cached) + ' not cached; signal, not proof'", "'signal, not proof'"],
];

const W = await load(SRC);
const failed = await suite(W, true);
let sFail = 0;
for (const [n, ok] of statics(SRC, W)) { CHECKS++; if (ok) _log('PASS - static: ' + n); else { sFail++; _log('FAIL - static: ' + n); } }
const pass = CHECKS - failed.length - sFail;
let killed = 0, mutFail = 0;
for (const [n, from, to] of MUT) {
  if (!SRC.includes(from)) { mutFail++; _log('FAIL - mutant anchor missing: ' + n); continue; }
  const M = await load(SRC.replace(from, to));
  const f = (await suite(M, false)).concat(statics(SRC.replace(from, to), M).filter(x => !x[1]).map(x => 'static: ' + x[0]));
  if (f.length) { killed++; _log('PASS - mutant killed: ' + n + ' (' + f.length + ' checks)'); } else { mutFail++; _log('FAIL - mutant survived: ' + n); }
}
console.log = _log;
try { rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
_log(`UNO dashboard owner gate (checks ${pass}/${CHECKS}, mutants ${killed}/${MUT.length}): ${pass + killed} passed, ${failed.length + sFail + mutFail} failed`);
process.exit(failed.length + sFail + mutFail ? 1 : 0);
