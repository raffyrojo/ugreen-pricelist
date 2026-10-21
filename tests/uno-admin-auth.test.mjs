/* ugreen-vero admin auth tests (B1b, owner-approved 2026-10-20; owner D2 / D15 / D27; fix round 1 2026-10-21: B1b-G1 lockout boundary,
 * B1b-G2 no D1 statement on a refused admin /ask, B1b-G4 exact epoch / scope / role matching). Run: node tests/uno-admin-auth.test.mjs
 * Runs the real backend/vero/worker.js against the real D1 migrations on an in-memory SQLite (node:sqlite); no network,
 * no provider, no secret (test values only). Covers: POST /admin/session (active admin-role codes only, 2 h admin:read
 * token, shared 15-minute lockout with /session, same refusal for every non-admin outcome); POST /admin/whoami (signature,
 * expiry, scope, token role, code row active / token_epoch / role, no data, no D1 write); /ask refuses scoped tokens
 * before any quota or log write; /session tokens unchanged (no scope claim, TOKEN_TTL_HOURS) and still accepted by /ask;
 * no knowledge write routes; no code, hash, token or signing key in logs or responses.
 * Each mutant of the B1b logic (re-built from the real source) must make at least one check fail. */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { newCode, insertSql, hashCode } from '../tools/vero-code.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(path.join(ROOT, 'backend/vero/worker.js'), 'utf8');
const SCHEMA = readFileSync(path.join(ROOT, 'backend/vero/migrations/0001_init.sql'), 'utf8');
const SCHEMA2 = readFileSync(path.join(ROOT, 'backend/vero/migrations/0002_product_text_cache.sql'), 'utf8');
const ORIGIN = 'https://raffyrojo.github.io';
const KEY = 'test-signing-key-0123456789abcdef-xyz';   // test value only
const H = 3600000;

/* ---------------- D1 adapter over node:sqlite (same shape as tests/vero-worker.test.mjs) ---------------- */
class Stmt {
  constructor(db, sql, params) { this.db = db; this.sql = sql; this.params = params || []; }
  bind(...a) { return new Stmt(this.db, this.sql, a.map(v => (v === undefined ? null : v))); }
  _all() { return this.db.prepare(this.sql).all(...this.params); }
  async first(col) { const r = this._all(); return r.length ? (col ? r[0][col] : r[0]) : null; }
  async all() { return { results: this._all(), success: true }; }
  async run() { const i = this.db.prepare(this.sql).run(...this.params); return { success: true, meta: { changes: i.changes } }; }
}
class FakeD1 {
  constructor() { this.db = new DatabaseSync(':memory:'); this.db.exec(SCHEMA); this.db.exec(SCHEMA2); this.sqlLog = []; }
  prepare(sql) { this.sqlLog.push(sql); return new Stmt(this.db, sql); }   // every statement the worker prepares (B1b-G2)
  async batch(stmts) { this.db.exec('BEGIN'); try { const out = stmts.map(s => ({ results: s._all(), success: true })); this.db.exec('COMMIT'); return out; } catch (e) { this.db.exec('ROLLBACK'); throw e; } }
  q(sql, ...p) { return this.db.prepare(sql).all(...p); }
  snapshot() { return ['counters', 'daily_stats', 'spend', 'question_log', 'answer_cache', 'access_codes'].map(t => JSON.stringify(this.q('SELECT * FROM ' + t))).join('\n'); }
}
globalThis.fetch = async url => { throw new Error('unexpected fetch ' + url); };   // auth paths must never touch the network

const mkEnv = over => Object.assign({ DB: new FakeD1(), AI_ENABLED: 'true', WEB_ENABLED: 'true', TOKEN_SIGNING_KEY: KEY, IP_HASH_SALT: 'salt',
  ALLOW_ORIGIN: ORIGIN, PROVIDER: 'openai', OPENAI_API_KEY: 'fake-openai-key', OPENAI_BASE_URL: 'https://openai.fake', IP_PER_MIN: '1000', IP_PER_DAY: '1000' }, over || {});
const addCode = (env, id, role) => { const code = newCode(); env.DB.db.exec(insertSql({ id, role }, code)); return code; };
const payload = tok => JSON.parse(Buffer.from(String(tok).split('.')[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));

let LOGS = [], CHECKS = 0;
const _log = console.log;
const tmp = mkdtempSync(path.join(os.tmpdir(), 'unoauth-'));
let nMod = 0;
async function load(src) { const f = path.join(tmp, 'w' + (nMod++) + '.mjs'); writeFileSync(f, src); return import(pathToFileURL(f).href); }

/* One full run of every check against a worker module; returns the list of failed check names. */
async function suite(W, out) {
  const worker = W.default, failed = [];
  const chk = (n, c, x) => { if (out) CHECKS++; if (c) { if (out) _log('PASS - ' + n); } else { failed.push(n); if (out) _log('FAIL - ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 300) : '')); } };
  async function call(env, p, body, opts) {
    opts = opts || {};
    const headers = { 'content-type': 'application/json', origin: opts.origin === undefined ? ORIGIN : opts.origin, 'cf-connecting-ip': opts.ip || '203.0.113.7' };
    if (opts.token) headers.authorization = 'Bearer ' + opts.token;
    const req = new Request('https://ugreen-vero.test' + p, { method: opts.method || 'POST', headers, body: opts.method === 'GET' ? undefined : (opts.raw !== undefined ? opts.raw : JSON.stringify(body || {})) });
    const pend = []; const res = await worker.fetch(req, env, { waitUntil: x => pend.push(x) }); await Promise.all(pend);
    const text = await res.text(); let j = null; try { j = JSON.parse(text); } catch (_) {}
    return { status: res.status, j, text, headers: res.headers };
  }
  const sign = p => W.signToken(p, KEY);
  const askBody = { v: 1, q: '', candidates: [], history: [], route: 'catalog', trigger: 'auto' };   // empty q: 422 bad_question once auth passes

  LOGS = []; console.log = (...a) => { LOGS.push(a.map(String).join(' ')); };
  try {
    let env = mkEnv();
    const adminCode = addCode(env, 'c_admin01', 'admin'), salesCode = addCode(env, 'c_sales01', 'sales'), dealerCode = addCode(env, 'c_dealer01', 'dealer');
    const offCode = addCode(env, 'c_admin02', 'admin'); env.DB.db.exec("UPDATE access_codes SET active = 0 WHERE id = 'c_admin02'");

    /* ---- /admin/session ---- */
    const t0 = Date.now(); let r = await call(env, '/admin/session', { code: adminCode.toLowerCase().replace(/-/g, ' ') }); const t1 = Date.now();
    const tokA = r.j && r.j.token, pa = tokA ? payload(tokA) : {};
    chk('A1 admin code -> 200 admin:read token (any case / spacing)', r.status === 200 && r.j.ok === true && typeof tokA === 'string' && r.j.role === 'admin' && r.j.scope === 'admin:read', r.j);
    chk('A1b response keys exactly ok / token / role / scope / exp', r.j && JSON.stringify(Object.keys(r.j).sort()) === '["exp","ok","role","scope","token"]', r.j);
    chk('A1c token payload {sid, role admin, ep, exp, scope admin:read}', pa.sid === 'c_admin01' && pa.role === 'admin' && pa.ep === 1 && pa.scope === 'admin:read' && pa.exp === r.j.exp, pa);
    chk('A1d admin token lifetime = exactly 2 h (ADMIN_READ_HOURS = 2)', W.ADMIN_READ_HOURS === 2 && r.j.exp >= t0 + 2 * H && r.j.exp <= t1 + 2 * H, { exp: r.j && r.j.exp, t0 });
    chk('A1e no-store + CORS = live origin', r.headers.get('cache-control') === 'no-store' && r.headers.get('access-control-allow-origin') === ORIGIN);
    for (const [name, code] of [['sales', salesCode], ['dealer', dealerCode], ['inactive admin', offCode], ['unknown', 'VERO-AAAA-BBBB-CCCC-DDDD-EEEE'], ['too short', 'VERO-1']]) {
      env = mkEnv(); env.DB.db.exec(insertSql({ id: 'c_sales01', role: 'sales' }, salesCode)); env.DB.db.exec(insertSql({ id: 'c_dealer01', role: 'dealer' }, dealerCode));
      env.DB.db.exec(insertSql({ id: 'c_admin02', role: 'admin' }, offCode)); env.DB.db.exec("UPDATE access_codes SET active = 0 WHERE id = 'c_admin02'");
      r = await call(env, '/admin/session', { code });
      chk(`A2 ${name} code -> 401 invalid_code, no token, failure counted`, r.status === 401 && r.j.error === 'invalid_code' && !('token' in r.j) && Object.keys(r.j).length === 2
        && env.DB.q("SELECT n FROM counters WHERE scope = 'session_fail'").reduce((s, x) => s + x.n, 0) === 1, r.j);
    }
    env = mkEnv(); addCode(env, 'c_admin01', 'admin');
    r = await call(env, '/admin/session', null, { raw: '{bad' });
    chk('A3 malformed JSON -> 400', r.status === 400 && r.j.error === 'bad_request');
    r = await call(env, '/admin/session', { code: adminCode }, { origin: 'https://evil.example' });
    chk('A3b foreign Origin -> 403 before any lookup', r.status === 403 && r.j.error === 'forbidden_origin');
    r = await call(env, '/admin/session', null, { method: 'GET' });
    chk('A3c GET -> 405', r.status === 405);
    r = await call(mkEnv({ TOKEN_SIGNING_KEY: 'short' }), '/admin/session', { code: adminCode });
    chk('A3d weak signing key -> 503 not_configured (never signs)', r.status === 503 && r.j.error === 'not_configured');
    { const e = mkEnv({ AI_ENABLED: 'false' }); const ac = addCode(e, 'c_admin01', 'admin'); r = await call(e, '/admin/session', { code: ac });
      chk('A3e admin session independent of the AI kill switch (AI_ENABLED=false)', r.status === 200 && r.j.scope === 'admin:read'); }

    /* ---- shared lockout ---- */
    env = mkEnv(); const ac2 = addCode(env, 'c_admin01', 'admin'), sc2 = addCode(env, 'c_sales01', 'sales');
    for (let i = 0; i < 5; i++) await call(env, '/admin/session', { code: 'VERO-AAAA-BBBB-CCCC-DDDD-EEE' + i }, { ip: '198.51.100.9' });
    r = await call(env, '/admin/session', { code: ac2 }, { ip: '198.51.100.9' });
    const r2 = await call(env, '/session', { code: sc2 }, { ip: '198.51.100.9' });
    chk('A4 5 wrong codes on /admin/session lock /admin/session and /session for that IP', r.status === 429 && r.j.error === 'session_locked' && r2.status === 429);
    for (let i = 0; i < 5; i++) await call(env, '/session', { code: 'VERO-AAAA-BBBB-CCCC-DDDD-FFF' + i }, { ip: '198.51.100.10' });
    r = await call(env, '/admin/session', { code: ac2 }, { ip: '198.51.100.10' });
    chk('A4b 5 wrong codes on /session lock /admin/session too (one bucket)', r.status === 429 && r.j.error === 'session_locked');
    for (let i = 0; i < 5; i++) await call(env, '/admin/session', { code: sc2 }, { ip: '198.51.100.11' });
    r = await call(env, '/admin/session', { code: ac2 }, { ip: '198.51.100.11' });
    chk('A4c a sales code tried 5x on /admin/session counts as failures (lockout)', r.status === 429);
    // B1b-G1: the boundary is exactly 5 failures - 4 still let a valid admin code in, the 5th locks
    for (let i = 0; i < 4; i++) await call(env, '/admin/session', { code: 'VERO-AAAA-BBBB-CCCC-DDDD-GGG' + i }, { ip: '198.51.100.12' });
    r = await call(env, '/admin/session', { code: ac2 }, { ip: '198.51.100.12' });
    chk('A4d lockout boundary: after 4 wrong codes a valid admin code still gets 200', r.status === 200 && r.j.scope === 'admin:read', r.j);
    await call(env, '/admin/session', { code: 'VERO-AAAA-BBBB-CCCC-DDDD-GGG9' }, { ip: '198.51.100.12' });
    r = await call(env, '/admin/session', { code: ac2 }, { ip: '198.51.100.12' });
    chk('A4e lockout boundary: the 5th wrong code locks (429 even for a valid code)', r.status === 429 && r.j.error === 'session_locked');

    /* ---- /session unchanged ---- */
    env = mkEnv(); const ac3 = addCode(env, 'c_admin01', 'admin'), sc3 = addCode(env, 'c_sales01', 'sales'), dc3 = addCode(env, 'c_dealer01', 'dealer');
    let s0 = Date.now(); r = await call(env, '/session', { code: sc3 }); let s1 = Date.now();
    const tokS = r.j.token, ps = payload(tokS);
    chk('S1 /session sales -> 12 h token, response keys unchanged (ok / token / role / exp / web)', r.status === 200 && JSON.stringify(Object.keys(r.j).sort()) === '["exp","ok","role","token","web"]' && r.j.exp >= s0 + 12 * H && r.j.exp <= s1 + 12 * H, r.j);
    chk('S1b /session token payload has no scope claim (exactly sid / role / ep / exp)', JSON.stringify(Object.keys(ps).sort()) === '["ep","exp","role","sid"]', ps);
    r = await call(env, '/session', { code: ac3 });
    const tokAI_admin = r.j.token;
    chk('S2 /session admin code -> AI token (role admin, no scope, 12 h)', r.status === 200 && r.j.role === 'admin' && payload(tokAI_admin).scope === undefined && r.j.exp - Date.now() > 11.9 * H);
    r = await call(env, '/session', { code: dc3 });
    chk('S3 /session dealer code still refused (AI_ROLES)', r.status === 401 && r.j.error === 'invalid_code');
    { const e = mkEnv({ TOKEN_TTL_HOURS: '5' }); const sc = addCode(e, 'c_sales01', 'sales'), ac = addCode(e, 'c_admin01', 'admin');
      const a = await call(e, '/session', { code: sc }), b = await call(e, '/admin/session', { code: ac }), n = Date.now();
      chk('S4 TOKEN_TTL_HOURS drives AI sessions only; admin stays 2 h', a.j.exp - n > 4.9 * H && a.j.exp - n <= 5 * H && b.j.exp - n > 1.9 * H && b.j.exp - n <= 2 * H, { a: a.j.exp - n, b: b.j.exp - n }); }

    /* ---- /ask ---- */
    r = await call(env, '/admin/session', { code: ac3 }); const tokA3 = r.j.token;
    const before = env.DB.snapshot();
    env.DB.sqlLog = [];
    r = await call(env, '/ask', Object.assign({}, askBody, { q: 'which charger is better for travel', candidates: ['1', '2'] }), { token: tokA3 });
    const askSql = env.DB.sqlLog.slice();
    chk('Q1 admin token on /ask -> 403 scope_not_allowed', r.status === 403 && r.j.error === 'scope_not_allowed', r.j);
    chk('Q1b refused admin /ask wrote nothing (no quota, budget, cache or log row)', env.DB.snapshot() === before);
    chk('Q1c refused admin /ask prepared no D1 statement at all (scope refused before the access_codes lookup)', askSql.length === 0, askSql);
    r = await call(env, '/ask', askBody, { token: tokS });
    chk('Q2 /session (sales) token still passes /ask auth (reaches question validation: 422)', r.status === 422 && r.j.error === 'bad_question', r.j);
    r = await call(env, '/ask', askBody, { token: tokAI_admin });
    chk('Q2b /session (admin role) token still passes /ask auth', r.status === 422 && r.j.error === 'bad_question', r.j);
    const legacy = await sign({ sid: 'c_sales01', role: 'sales', ep: 1, exp: Date.now() + 11 * H });
    r = await call(env, '/ask', askBody, { token: legacy });
    chk('Q3 pre-B1b token (no scope claim, unexpired) still accepted by /ask', r.status === 422 && r.j.error === 'bad_question');
    for (const sc of ['knowledge:write', 'ai', '', null]) {
      r = await call(env, '/ask', askBody, { token: await sign({ sid: 'c_sales01', role: 'sales', ep: 1, exp: Date.now() + H, scope: sc }) });
      chk(`Q4 any scope claim (${JSON.stringify(sc)}) refused by /ask`, r.status === 403 && r.j.error === 'scope_not_allowed');
    }
    { const e = mkEnv({ AI_ENABLED: 'false' }); r = await call(e, '/ask', askBody, { token: tokA3 });
      chk('Q5 AI kill switch still answers 503 first', r.status === 503 && r.j.error === 'ai_disabled'); }

    /* ---- /admin/whoami ---- */
    const before2 = env.DB.snapshot();
    r = await call(env, '/admin/whoami', {}, { token: tokA3 });
    chk('W1 admin token -> 200 {ok, role admin, scope admin:read, exp} and nothing else', r.status === 200 && JSON.stringify(Object.keys(r.j).sort()) === '["exp","ok","role","scope"]' && r.j.role === 'admin' && r.j.scope === 'admin:read' && r.j.exp === payload(tokA3).exp, r.j);
    chk('W1b whoami reads only (D1 unchanged)', env.DB.snapshot() === before2);
    chk('W1c whoami no-store + CORS', r.headers.get('cache-control') === 'no-store' && r.headers.get('access-control-allow-origin') === ORIGIN);
    // B1b-G4: exact matching (no type coercion, no case folding, no trimming)
    const pA = payload(tokA3);
    r = await call(env, '/admin/whoami', {}, { token: await sign(Object.assign({}, pA, { ep: String(pA.ep) })) });
    chk('W1d token_epoch as a string ("1") -> 401 (strict epoch match)', r.status === 401 && r.j.error === 'unauthorized', r.j);
    for (const sc of ['ADMIN:READ', 'admin:read ', ' admin:read', 'Admin:Read']) {
      r = await call(env, '/admin/whoami', {}, { token: await sign(Object.assign({}, pA, { scope: sc })) });
      chk(`W1e scope ${JSON.stringify(sc)} -> 403 (exact scope match)`, r.status === 403 && r.j.error === 'scope_not_allowed', r.j);
    }
    r = await call(env, '/admin/whoami', {}, { token: await sign(Object.assign({}, pA, { role: 'ADMIN' })) });
    chk('W1f token role "ADMIN" -> 403 (exact role match)', r.status === 403 && r.j.error === 'scope_not_allowed', r.j);
    r = await call(env, '/admin/whoami', {});
    chk('W2 no token -> 401', r.status === 401 && r.j.error === 'unauthorized');
    r = await call(env, '/admin/whoami', {}, { token: tokA3.slice(0, -2) + (tokA3.endsWith('xx') ? 'yy' : 'xx') });
    chk('W3 tampered signature -> 401', r.status === 401);
    r = await call(env, '/admin/whoami', {}, { token: await W.signToken(payload(tokA3), 'another-signing-key-0123456789abcdef') });
    chk('W3b token signed with another key -> 401', r.status === 401);
    r = await call(env, '/admin/whoami', {}, { token: await sign({ sid: 'c_admin01', role: 'admin', ep: 1, exp: Date.now() - 1000, scope: 'admin:read' }) });
    chk('W4 expired admin token -> 401', r.status === 401 && r.j.error === 'unauthorized');
    r = await call(env, '/admin/whoami', {}, { token: tokAI_admin });
    chk('W5 /session AI token of an admin code (no scope) -> 403', r.status === 403 && r.j.error === 'scope_not_allowed');
    r = await call(env, '/admin/whoami', {}, { token: tokS });
    chk('W5b sales AI token -> 403', r.status === 403 && r.j.error === 'scope_not_allowed');
    r = await call(env, '/admin/whoami', {}, { token: await sign({ sid: 'c_admin01', role: 'admin', ep: 1, exp: Date.now() + H, scope: 'knowledge:write' }) });
    chk('W6 wrong scope (knowledge:write) -> 403', r.status === 403 && r.j.error === 'scope_not_allowed');
    r = await call(env, '/admin/whoami', {}, { token: await sign({ sid: 'c_admin01', role: 'sales', ep: 1, exp: Date.now() + H, scope: 'admin:read' }) });
    chk('W6b admin:read scope with a non-admin token role -> 403 scope_not_allowed', r.status === 403 && r.j.error === 'scope_not_allowed');
    r = await call(env, '/admin/whoami', {}, { token: await sign({ sid: 'c_sales01', role: 'admin', ep: 1, exp: Date.now() + H, scope: 'admin:read' }) });
    chk('W7 admin claim on a sales code row -> 403 role_not_allowed', r.status === 403 && r.j.error === 'role_not_allowed');
    r = await call(env, '/admin/whoami', {}, { token: await sign({ sid: 'c_nobody', role: 'admin', ep: 1, exp: Date.now() + H, scope: 'admin:read' }) });
    chk('W7b unknown code id -> 401', r.status === 401);
    env.DB.db.exec("UPDATE access_codes SET active = 0 WHERE id = 'c_admin01'");
    r = await call(env, '/admin/whoami', {}, { token: tokA3 });
    chk('W8 revoked admin code -> 401 on the next request', r.status === 401 && r.j.error === 'unauthorized');
    env.DB.db.exec("UPDATE access_codes SET active = 1, token_epoch = token_epoch + 1 WHERE id = 'c_admin01'");
    r = await call(env, '/admin/whoami', {}, { token: tokA3 });
    chk('W9 token_epoch bump ends admin sessions -> 401', r.status === 401 && r.j.error === 'unauthorized');
    r = await call(env, '/admin/session', { code: ac3 }); const tokA4 = r.j.token;
    r = await call(env, '/admin/whoami', {}, { token: tokA4 });
    chk('W9b new admin session after the epoch bump works (ep 2)', r.status === 200 && payload(tokA4).ep === 2);
    env.DB.db.exec("UPDATE access_codes SET role = 'sales' WHERE id = 'c_admin01'");
    r = await call(env, '/admin/whoami', {}, { token: tokA4 });
    chk('W10 code demoted to sales -> 403 role_not_allowed', r.status === 403 && r.j.error === 'role_not_allowed');
    r = await call(env, '/admin/whoami', {}, { token: tokA4, origin: 'https://evil.example' });
    chk('W11 whoami from a foreign Origin -> 403', r.status === 403 && r.j.error === 'forbidden_origin');

    /* ---- no knowledge write routes ---- */
    let all404 = true;
    for (const p of ['/admin/approve', '/admin/publish', '/admin/kb', '/kb/claims', '/admin/stats', '/admin', '/admin/session/x', '/admin/whoami/']) {
      const x = await call(env, p, {}, { token: tokA4 }); if (!(x.status === 404 && x.j.error === 'not_found')) all404 = false;
    }
    chk('K1 no knowledge write (or other admin) routes: all -> 404', all404);

    /* ---- secrets ---- */
    const blob = LOGS.join('\n');
    const secretsSeen = [adminCode, salesCode, ac3, sc3, hashCode(adminCode), hashCode(ac3), KEY, tokA, tokA3, tokA4, tokS].filter(s => s && blob.includes(s));
    chk('L1 logs contain no access code, code hash, token or signing key', secretsSeen.length === 0 && !/VERO-[0-9A-Z]{4}/.test(blob), secretsSeen.length);
    chk('L2 admin_session log line carries only path + outcome', LOGS.filter(l => l.includes('admin_session')).every(l => JSON.stringify(Object.keys(JSON.parse(l)).sort()) === '["outcome","path","vero"]'));
  } catch (e) {
    failed.push('EXCEPTION ' + (e && e.message)); if (out) _log('FAIL - exception: ' + (e && e.stack));
  } finally { console.log = _log; }
  return failed;
}

/* ---------------- main run ---------------- */
const failedMain = await suite(await load(SRC), true);
const fail = failedMain.length, pass = CHECKS - fail;

/* ---------------- mutants ---------------- */
const swap = (a, b) => { if (SRC.split(a).length !== 2) throw new Error('mutant anchor not unique / missing: ' + a.slice(0, 70)); return SRC.replace(a, b); };
const MUT = [
  ['/ask accepts scoped tokens', () => swap("  if (tok.scope !== undefined) return fail(c, 403, 'scope_not_allowed');", '')],
  ['whoami ignores scope', () => swap("if (tok.scope !== ADMIN_READ_SCOPE || tok.role !== 'admin') return", "if (tok.role !== 'admin') return")],
  ['whoami ignores token role', () => swap("if (tok.scope !== ADMIN_READ_SCOPE || tok.role !== 'admin') return", 'if (tok.scope !== ADMIN_READ_SCOPE) return')],
  ['whoami ignores active', () => swap("  if (!code || !code.active || code.token_epoch !== tok.ep) return fail(c, 401, 'unauthorized');\n  if (code.role !== 'admin')", "  if (!code || code.token_epoch !== tok.ep) return fail(c, 401, 'unauthorized');\n  if (code.role !== 'admin')")],
  ['whoami ignores token_epoch', () => swap("  if (!code || !code.active || code.token_epoch !== tok.ep) return fail(c, 401, 'unauthorized');\n  if (code.role !== 'admin')", "  if (!code || !code.active) return fail(c, 401, 'unauthorized');\n  if (code.role !== 'admin')")],
  ['whoami ignores the row role', () => swap("  if (code.role !== 'admin') return fail(c, 403, 'role_not_allowed');\n  return json(c, { ok: true, role: 'admin'", "  return json(c, { ok: true, role: 'admin'")],
  ['admin session accepts AI roles', () => swap("r => r.role === 'admin');", 'r => c.aiRoles.indexOf(r.role) >= 0);')],
  ['admin session accepts any role', () => swap("r => r.role === 'admin');", 'r => true);')],
  ['admin TTL 12 h', () => swap('export const ADMIN_READ_HOURS = 2;', 'export const ADMIN_READ_HOURS = 12;')],
  ['admin TTL from TOKEN_TTL_HOURS', () => swap('const exp = t + ADMIN_READ_HOURS * 3600000;', 'const exp = t + c.tokenHours * 3600000;')],
  ['admin token without scope', () => swap('exp, scope: ADMIN_READ_SCOPE }, env.TOKEN_SIGNING_KEY);', 'exp }, env.TOKEN_SIGNING_KEY);')],
  ['/session tokens carry the admin scope', () => swap('ep: row.token_epoch, exp }, env.TOKEN_SIGNING_KEY);', 'ep: row.token_epoch, exp, scope: ADMIN_READ_SCOPE }, env.TOKEN_SIGNING_KEY);')],
  ['inactive codes accepted', () => swap('if (!row || !row.active || !allowed(row)) {', 'if (!row || !allowed(row)) {')],
  ['failures not counted (no lockout)', () => swap("    await db.prepare(\"INSERT INTO counters (scope, subject, win, n, expires) VALUES ('session_fail', ?1, ?2, 1, ?3) ON CONFLICT (scope, subject, win) DO UPDATE SET n = n + 1\")\n      .bind(ipHash, bucket, plusDays(t, 1)).run();\n    return { res: fail(c, 401, 'invalid_code') };", "    return { res: fail(c, 401, 'invalid_code') };")],
  ['separate lockout bucket for admin', () => swap("const { res, row } = await codeLogin(req, env, c, t, ipHash, r => r.role === 'admin');", "const { res, row } = await codeLogin(req, env, c, t, ipHash + 'A', r => r.role === 'admin');")],
  ['expiry not checked', () => swap("typeof p.exp !== 'number' || p.exp < now) return null;", "typeof p.exp !== 'number') return null;")],
  ['admin session logs the code row id', () => swap("logLine({ path: 'admin_session', outcome: 'ok' });", "logLine({ path: 'admin_session', outcome: 'ok', sid: row.id });")],
  ['whoami returns the code id', () => swap("return json(c, { ok: true, role: 'admin', scope: ADMIN_READ_SCOPE, exp: tok.exp });", "return json(c, { ok: true, role: 'admin', scope: ADMIN_READ_SCOPE, exp: tok.exp, sid: tok.sid });")],
  // fix round 1 (QA round 1 survivors QA6 / QA2 / QA10 / QA11 + role case-folding)
  ['lockout after 4 failures (>= 4)', () => swap('if (locked && locked.n >= 5) return', 'if (locked && locked.n >= 4) return')],
  ['/ask scope check after the access_codes read', () => swap(
    "  if (tok.scope !== undefined) return fail(c, 403, 'scope_not_allowed');   // scoped (admin) tokens never spend AI budget (D27)\n  const code = await db.prepare('SELECT id, role, active, token_epoch, daily_limit, last_used_at FROM access_codes WHERE id = ?1').bind(tok.sid).first();",
    "  const code = await db.prepare('SELECT id, role, active, token_epoch, daily_limit, last_used_at FROM access_codes WHERE id = ?1').bind(tok.sid).first();\n  if (tok.scope !== undefined) return fail(c, 403, 'scope_not_allowed');")],
  ['whoami loose epoch (!=)', () => swap("  if (!code || !code.active || code.token_epoch !== tok.ep) return fail(c, 401, 'unauthorized');\n  if (code.role !== 'admin')", "  if (!code || !code.active || code.token_epoch != tok.ep) return fail(c, 401, 'unauthorized');\n  if (code.role !== 'admin')")],
  ['whoami trims + lower-cases the scope', () => swap("if (tok.scope !== ADMIN_READ_SCOPE || tok.role !== 'admin') return", "if (String(tok.scope).trim().toLowerCase() !== ADMIN_READ_SCOPE || tok.role !== 'admin') return")],
  ['whoami lower-cases the token role', () => swap("if (tok.scope !== ADMIN_READ_SCOPE || tok.role !== 'admin') return", "if (tok.scope !== ADMIN_READ_SCOPE || String(tok.role).toLowerCase() !== 'admin') return")],
  ['a knowledge route exists', () => swap("      if (url.pathname === '/admin/whoami')", "      if (url.pathname === '/admin/approve') return json(c, { ok: true });\n      if (url.pathname === '/admin/whoami')")],
];
let killed = 0, mutFail = 0;
for (const [name, mk] of MUT) {
  let f; try { f = await suite(await load(mk()), false); } catch (e) { f = ['load/anchor error: ' + e.message]; }
  if (f.length && !f[0].startsWith('load/anchor')) { killed++; _log(`PASS - mutant killed: ${name} (${f.length} check(s) failed, e.g. ${f[0].slice(0, 90)})`); }
  else { mutFail++; _log('FAIL - mutant survived: ' + name + (f.length ? ' ' + f[0] : '')); }
}
rmSync(tmp, { recursive: true, force: true });
_log(`UNO admin auth (checks ${pass}/${CHECKS}, mutants ${killed}/${MUT.length}): ${pass + killed} passed, ${fail + mutFail} failed`);
process.exit(fail + mutFail ? 1 : 0);
