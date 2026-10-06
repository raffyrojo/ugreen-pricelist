/* ugreen-vero Worker tests. Run: node tests/vero-worker.test.mjs
 * - Real SQL: migrations/0001_init.sql executed on an in-memory SQLite (node:sqlite) behind a D1-shaped adapter.
 * - Fake Anthropic provider: no network, no key. Scripted per test.
 * - Catalog: the repo's real data/products.json served by a fake fetch. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import worker, * as W from '../backend/vero/worker.js';
import { newCode, insertSql } from '../tools/vero-code.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA = readFileSync(path.join(ROOT, 'backend/vero/migrations/0001_init.sql'), 'utf8');
const SCHEMA2 = readFileSync(path.join(ROOT, 'backend/vero/migrations/0002_product_text_cache.sql'), 'utf8');
const PRODUCTS_TEXT = readFileSync(path.join(ROOT, 'data/products.json'), 'utf8');
const PRODUCTS = JSON.parse(PRODUCTS_TEXT);
const ORIGIN = 'https://raffyrojo.github.io';
let pass = 0, fail = 0; const failures = [];
const chk = (n, c, x) => { if (c) { pass++; console.log('PASS - ' + n); } else { fail++; failures.push(n); console.log('FAIL - ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 400) : '')); } };

/* ---------------- D1 adapter over node:sqlite ---------------- */
class Stmt {
  constructor(db, sql, params) { this.db = db; this.sql = sql; this.params = params || []; }
  bind(...a) { return new Stmt(this.db, this.sql, a.map(v => (v === undefined ? null : v))); }
  _all() { return this.db.prepare(this.sql).all(...this.params); }
  async first(col) { const r = this._all(); return r.length ? (col ? r[0][col] : r[0]) : null; }
  async all() { return { results: this._all(), success: true }; }
  async run() { const i = this.db.prepare(this.sql).run(...this.params); return { success: true, meta: { changes: i.changes } }; }
}
class FakeD1 {
  constructor(opts) { this.db = new DatabaseSync(':memory:'); this.db.exec(SCHEMA); if (!(opts && opts.no0002)) this.db.exec(SCHEMA2); this.reads = 0; this.writes = 0; }
  prepare(sql) { return new Stmt(this.db, sql); }
  async batch(stmts) { this.db.exec('BEGIN'); try { const out = stmts.map(s => ({ results: s._all(), success: true })); this.db.exec('COMMIT'); return out; } catch (e) { this.db.exec('ROLLBACK'); throw e; } }
  q(sql, ...p) { return this.db.prepare(sql).all(...p); }
}

/* ---------------- fake network (provider-neutral scenarios rendered per provider) ---------------- */
const P = (process.env.VERO_TEST_PROVIDER || 'openai').toLowerCase();       // production provider by default
const FAKE_URL = { openai: 'https://openai.fake/v1/responses', anthropic: 'https://anthropic.fake/v1/messages' };
let calls = [], callHeaders = [], researchHandler, composeHandler, catalogEtag = 'W/"cat-v1"', catalogFetches = 0, catalogText = null;
const okJson = (obj, status) => new Response(JSON.stringify(obj), { status: status || 200, headers: { 'content-type': 'application/json' } });
function renderAnthropic(n) {
  if (n.__n === 'compose') return { content: [{ type: 'text', text: n.text }], stop_reason: { end: 'end_turn', max_tokens: 'max_tokens', refusal: 'refusal' }[n.stop] || 'end_turn', usage: { input_tokens: n.usage.in, output_tokens: n.usage.out } };
  return { content: [
    { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: n.query } },
    { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', content: n.toolError ? { type: 'web_search_tool_result_error', error_code: n.toolError } : n.results.map(r => ({ type: 'web_search_result', url: r.url, title: r.title, encrypted_content: 'x' })) },
    { type: 'text', text: n.text, citations: n.citations.map(c => ({ type: 'web_search_result_location', url: c.url, title: c.title, cited_text: c.cited_text, encrypted_index: 'e' })) },
  ], stop_reason: n.stop === 'pause' ? 'pause_turn' : 'end_turn', usage: { input_tokens: n.usage.in, output_tokens: n.usage.out, server_tool_use: { web_search_requests: n.usage.searches } } };
}
function renderOpenAI(n) {
  const usage = { input_tokens: n.usage.in, input_tokens_details: { cached_tokens: 0 }, output_tokens: n.usage.out, output_tokens_details: { reasoning_tokens: Math.floor(n.usage.out / 3) } };
  if (n.__n === 'compose') {
    if (n.stop === 'refusal') return { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: n.text }] }], usage };
    return { status: n.stop === 'max_tokens' ? 'incomplete' : 'completed', incomplete_details: n.stop === 'max_tokens' ? { reason: 'max_output_tokens' } : null,
      output: [{ type: 'reasoning', summary: [] }, { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: n.text, annotations: [] }] }], usage };
  }
  let text = n.text; const annotations = [];
  for (const c of n.citations) { const st = text.length + 1; text += ' ' + c.cited_text; annotations.push({ type: 'url_citation', url: c.url, title: c.title, start_index: st, end_index: text.length }); }
  return { status: n.stop === 'pause' ? 'incomplete' : 'completed', incomplete_details: n.stop === 'pause' ? { reason: 'max_tool_calls' } : null, output: [
    { type: 'reasoning', summary: [] },
    { type: 'web_search_call', id: 'ws_1', status: n.toolError ? 'failed' : 'completed', action: { type: 'search', query: n.query, sources: n.toolError ? [] : n.results.map(r => ({ type: 'url', url: r.url })) } },
    { type: 'message', role: 'assistant', content: [{ type: 'output_text', text, annotations }] },
  ], usage };
}
function provErr(kind) {
  if (P === 'openai') {
    if (kind === 'budget') return okJson({ error: { type: 'insufficient_quota', code: 'insufficient_quota', message: 'You exceeded your current quota, please check your plan and billing details.' } }, 429);
    if (kind === 'model404') return okJson({ error: { type: 'invalid_request_error', code: 'model_not_found', message: 'The model `gpt-6-luna` does not exist or you do not have access to it.' } }, 404);
    return okJson({ error: { type: 'server_error', message: 'The server is overloaded.' } }, 503);
  }
  if (kind === 'budget') return okJson({ type: 'error', error: { type: 'invalid_request_error', message: 'You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC.' } }, 400);
  if (kind === 'model404') return okJson({ type: 'error', error: { type: 'not_found_error', message: 'model: claude-haiku-4-5-20251001' } }, 404);
  return okJson({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }, 529);
}
globalThis.fetch = async (url, init) => {
  url = String(url);
  if (url.startsWith('https://raffyrojo.github.io/')) {
    catalogFetches++;
    const inm = init && init.headers && (init.headers['if-none-match'] || init.headers['If-None-Match']);
    if (inm && inm === catalogEtag) return new Response(null, { status: 304, headers: { etag: catalogEtag } });
    return new Response(catalogText || PRODUCTS_TEXT, { status: 200, headers: { etag: catalogEtag } });
  }
  if (url === FAKE_URL.openai || url === FAKE_URL.anthropic) {
    if (url !== FAKE_URL[P]) throw new Error('wrong provider endpoint ' + url);
    const body = JSON.parse(init.body); calls.push(body); callHeaders.push(init.headers);
    const h = body.tools ? researchHandler : composeHandler;
    const res = await h(body, init.signal);
    if (res instanceof Response) return res;
    return okJson(P === 'openai' ? renderOpenAI(res) : renderAnthropic(res));
  }
  throw new Error('unexpected fetch ' + url);
};
const delay = (ms, signal) => new Promise((resolve, reject) => { const t = setTimeout(resolve, ms); if (signal) signal.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')); }); });
function composeReply(obj, usage) { return { __n: 'compose', text: typeof obj === 'string' ? obj : JSON.stringify(obj), stop: 'end', usage: usage || { in: 3600, out: 300 } }; }
const DEFAULT_COMPOSE = () => composeReply({ reply: 'P1 is the better travel pick because it is compact.', picks: [{ ref: 'P1', reason: 'Compact and light.', basis: 'product_data' }], confidence: 'high', cannot_confirm: [], conflicts: [], language: 'en', sources: [] });
const SAMSUNG = 'https://www.samsung.com/ph/support/mobile-devices/galaxy-s27-charging/';
function researchReply(opts) {
  opts = opts || {};
  const results = opts.results || [
    { url: SAMSUNG, title: 'Galaxy S27 charging support' },
    { url: 'https://www.reddit.com/r/galaxy/s27-charger', title: 'reddit thread' },
    { url: 'http://www.samsung.com/insecure', title: 'insecure' },
    { url: 'https://www.xn--smsung-7ve.com/fake', title: 'homograph' },
  ];
  const citations = opts.citations || [
    { url: SAMSUNG, title: 'Galaxy S27 charging support', cited_text: 'Super Fast Charging 2.0 up to 45W via USB PD PPS' },
    { url: 'https://www.reddit.com/r/galaxy/s27-charger', title: 'reddit', cited_text: 'works fine with any charger' }];
  return { __n: 'research', query: opts.query || 'Galaxy S27 USB-C PD PPS charging support', results, citations, toolError: opts.toolError || null,
    text: opts.text || '- Galaxy S27 supports USB PD PPS fast charging up to 45W. Price ₱59,990 at https://shop.example.com',
    stop: opts.stop === 'pause_turn' ? 'pause' : 'end', usage: { in: opts.inTok || 15000, out: 250, searches: opts.searches == null ? 1 : opts.searches } };
}
const userOf = b => (P === 'openai' ? String(b.input) : JSON.stringify(b.messages));

/* ---------------- harness ---------------- */
function mkEnv(over) {
  return Object.assign({ DB: new FakeD1(over && over.__no0002 ? { no0002: true } : null), IP_PER_MIN: '1000', IP_PER_DAY: '1000', AI_ENABLED: 'true', WEB_ENABLED: 'true', TOKEN_SIGNING_KEY: 'test-signing-key-0123456789abcdef-xyz', IP_HASH_SALT: 'salt',
    PROVIDER: P, ALLOW_ORIGIN: ORIGIN, OPENAI_API_KEY: 'fake-openai-key', OPENAI_BASE_URL: 'https://openai.fake',
    ANTHROPIC_API_KEY: 'fake-anthropic-key', ANTHROPIC_BASE_URL: 'https://anthropic.fake' },
    P === 'anthropic' ? { MODEL: 'claude-haiku-4-5-20251001', WEB_TOOL_VERSION: 'web_search_20250305', PRICE_IN_PER_MTOK: '1', PRICE_OUT_PER_MTOK: '5' } : { MODEL: 'gpt-6-luna', REASONING_EFFORT: 'low' },
    over || {});
}
async function call(env, p, body, opts) {
  opts = opts || {}; const pend = [];
  const headers = { 'content-type': 'application/json', origin: opts.origin === undefined ? ORIGIN : opts.origin, 'cf-connecting-ip': opts.ip || '203.0.113.7' };
  if (opts.token) headers.authorization = 'Bearer ' + opts.token;
  const req = new Request('https://ugreen-vero.test' + p, { method: opts.method || 'POST', headers, body: opts.method === 'GET' ? undefined : JSON.stringify(body || {}) });
  const res = await worker.fetch(req, env, { waitUntil: x => pend.push(x) });
  await Promise.all(pend);
  let j = null; try { j = await res.json(); } catch (_) {}
  return { status: res.status, j, headers: res.headers };
}
async function addCode(env, id, role) { const code = newCode(); env.DB.db.exec(insertSql({ id, role }, code)); return code; }
async function login(env, id, role) { const code = await addCode(env, id, role || 'sales'); const r = await call(env, '/session', { code }); return r.j.token; }
const live = PRODUCTS.filter(p => !p.disabled);
const by = c => live.find(p => String(p.item_code) === String(c));
const chargers = live.filter(p => p.sheet_display === 'Mobile: Charger').slice(0, 4).map(p => String(p.item_code));
const reset = () => { calls = []; researchHandler = () => researchReply(); composeHandler = DEFAULT_COMPOSE; W._resetCatalogForTests(); };

/* ================= tests ================= */
const _log = console.log; console.log = (...a) => { if (typeof a[0] === 'string' && a[0].startsWith('{"vero"')) return; _log(...a); };
reset();
let env = mkEnv();
let r = await call(env, '/health', null, { method: 'GET' });
chk('W1 health exposes only on/off flags', r.status === 200 && r.j.ai === true && r.j.web === true && Object.keys(r.j).length === 3);
r = await call(env, '/session', { code: 'x' }, { origin: 'https://evil.example' });
chk('W2 POST from another origin -> 403', r.status === 403 && r.j.error === 'forbidden_origin');
chk('W2b CORS header is the live origin only', r.headers.get('access-control-allow-origin') === ORIGIN);

{ const e0 = mkEnv({ TOKEN_SIGNING_KEY: undefined }); const rr = await call(e0, '/session', { code: 'x' });
  const e1 = mkEnv({ TOKEN_SIGNING_KEY: 'short' }); const r1 = await call(e1, '/session', { code: 'x' });
  const e2 = mkEnv({ IP_HASH_SALT: undefined }); const r2 = await call(e2, '/session', { code: 'x' });
  chk('W2c missing/weak TOKEN_SIGNING_KEY or missing IP_HASH_SALT -> 503 not_configured (never signs)', [rr, r1, r2].every(x => x.status === 503 && x.j.error === 'not_configured')); }
// sessions
const code1 = await addCode(env, 'c_sales01', 'sales');
r = await call(env, '/session', { code: code1.toLowerCase().replace(/-/g, ' ') });
chk('W3 valid code (any case/spacing) -> signed token', r.status === 200 && r.j.ok && typeof r.j.token === 'string' && r.j.role === 'sales' && r.j.web === true);
const tokSales = r.j.token;
for (let i = 0; i < 5; i++) await call(env, '/session', { code: 'VERO-AAAA-BBBB-CCCC-DDDD-EEE' + i }, { ip: '198.51.100.9' });
r = await call(env, '/session', { code: code1 }, { ip: '198.51.100.9' });
chk('W4 5 wrong codes from one IP -> locked (even a valid code) for 15 min', r.status === 429 && r.j.error === 'session_locked');
const dCode = await addCode(env, 'c_dealer01', 'dealer');
r = await call(env, '/session', { code: dCode });
chk('W5 dealer code refused during pilot (AI_ROLES=admin,sales)', r.status === 401 && r.j.error === 'invalid_code');
chk('W5b codes stored only as SHA-256 hashes', env.DB.q('SELECT code_hash FROM access_codes').every(x => /^[0-9a-f]{64}$/.test(x.code_hash)) && !JSON.stringify(env.DB.q('SELECT * FROM access_codes')).includes(code1));

// token checks
const askBody = (q, cands, extra) => Object.assign({ v: 1, q, candidates: cands || chargers.slice(0, 3), history: [], route: 'catalog', trigger: 'auto' }, extra || {});
r = await call(env, '/ask', askBody('which is better for travel'), { token: tokSales.slice(0, -2) + 'xx' });
chk('W6 tampered token -> 401', r.status === 401);
const expired = await W.signToken({ sid: 'c_sales01', role: 'sales', ep: 1, exp: Date.now() - 1000 }, 'test-signing-key-0123456789abcdef-xyz');
r = await call(env, '/ask', askBody('which is better for travel'), { token: expired });
chk('W6b expired token -> 401', r.status === 401);
r = await call(env, '/ask', askBody('which is better for travel'), { token: tokSales });
chk('W7 catalog AI answer ok', r.status === 200 && r.j.ok && r.j.route === 'catalog' && r.j.picks[0].item_code === chargers[0], r.j);
const cReq = calls[calls.length - 1];
chk('W7b catalog request: model from env, no tools, strict structured output, output limit', P === 'openai'
  ? (cReq.model === 'gpt-6-luna' && !cReq.tools && cReq.text.format.type === 'json_schema' && cReq.text.format.strict === true && cReq.max_output_tokens === 450 + 600 && cReq.reasoning.effort === 'low' && cReq.store === false && cReq.temperature === undefined && typeof cReq.instructions === 'string')
  : (cReq.model === 'claude-haiku-4-5-20251001' && !cReq.tools && cReq.output_config.format.type === 'json_schema' && cReq.max_tokens === 450), cReq);
const prompt = userOf(cReq);
const p0 = by(chargers[0]);
chk('W7c prompt contains no price/MOQ fields or values', !/srp|dp_vol|dp_volume|special|moq|₱|PHP/i.test(prompt) && !prompt.includes('"' + p0.srp + '"') && !/\b(srp|dp)\s*:/i.test(prompt));
chk('W7d prompt contains no item codes (P-labels only)', chargers.slice(0, 3).every(c => !new RegExp('\\b' + c + '\\b').test(prompt)) && /P1 name:/.test(prompt));

env.DB.db.exec("UPDATE access_codes SET active = 0 WHERE id = 'c_sales01'");
r = await call(env, '/ask', askBody('which is better for travel and work'), { token: tokSales });
chk('W8 revoked code -> next request refused immediately', r.status === 401 && r.j.error === 'unauthorized');
env.DB.db.exec("UPDATE access_codes SET active = 1, token_epoch = token_epoch + 1 WHERE id = 'c_sales01'");
r = await call(env, '/ask', askBody('which is better for travel and work'), { token: tokSales });
chk('W8b token_epoch bump ends old sessions', r.status === 401);

// fresh env for the rest
reset(); env = mkEnv();
let tok = await login(env, 'c_sales01', 'sales');
const tokAdmin = await login(env, 'c_admin01', 'admin');
let nWeb = 0; const webTok = () => login(env, 'c_web' + (nWeb++), 'sales');

r = await call(env, '/ask', askBody('which is better for travel', ['99999999', chargers[0]]), { token: tok });
chk('W9 unknown candidates dropped; <2 valid -> 422 no AI call', r.status === 422 && r.j.error === 'no_candidates' && calls.length === 0);
r = await call(env, '/ask', askBody('x'.repeat(301)), { token: tok });
chk('W9b question > 300 chars rejected', r.status === 422);
r = await call(env, '/ask', askBody('which is better', live.slice(0, 9).map(p => String(p.item_code))), { token: tok });
chk('W9c > 8 candidates rejected', r.status === 422);

composeHandler = () => composeReply({ reply: 'Get P2 for ₱1,299 or see https://evil.example/deal and www.lazada.com.ph — item 55555 is cheaper. SRP is 1299.', picks: [
  { ref: 'P2', reason: 'Costs PHP 999 only, see ugreen.com/x', basis: 'web_verified' }, { ref: 'P7', reason: 'not a candidate', basis: 'product_data' }, { ref: 'P2', reason: 'dup', basis: 'product_data' }],
  confidence: 'high', cannot_confirm: ['x'.repeat(300)], conflicts: [], language: 'en', sources: [{ ref: 'S1', supports: 'made up' }] });
r = await call(env, '/ask', askBody('which is best for my office desk'), { token: tok });
chk('W10 out-of-candidate ref dropped, duplicates removed', r.j.ok && r.j.picks.length === 1 && r.j.picks[0].item_code === chargers[1], r.j);
chk('W10b prices removed from reply/reasons', !/₱|PHP|\b1,?299\b|\b999\b/.test(r.j.reply + r.j.picks[0].reason), r.j.reply + ' | ' + r.j.picks[0].reason);
chk('W10c URLs/domains removed', !/https?:|www\.|\.com/.test(r.j.reply + r.j.picks[0].reason));
chk('W10d stray item code removed', !/55555/.test(r.j.reply));
chk('W10e web_verified downgraded on catalog route; no sources returned', r.j.picks[0].basis === 'general_guidance' && r.j.sources.length === 0);
chk('W10f notes clamped to 120 chars; a single 300-char token is dropped, never cut mid-word', r.j.cannot_confirm.every(n => n.length <= 120) && r.j.cannot_confirm.length === 0, r.j.cannot_confirm);

// web route
reset();
r = await call(env, '/ask', askBody('compatible ba sa Samsung Galaxy S27 ko?', chargers.slice(0, 3), { route: 'web' }), { token: tok });
const rReq = calls.find(x => x.tools), coReq = calls.find(x => !x.tools);
chk('W11 web route: research then compose', r.status === 200 && r.j.route === 'web' && rReq && coReq, r.j);
{ const t = rReq.tools[0], doms = P === 'openai' ? t.filters.allowed_domains : t.allowed_domains;
  chk('W11b web tool: max 1 search, official allowlist only, PH location', (P === 'openai'
      ? (t.type === 'web_search' && rReq.max_tool_calls === 1 && rReq.tool_choice === 'required' && (rReq.include || []).includes('web_search_call.action.sources') && t.search_context_size === 'low')
      : (t.type === 'web_search_20250305' && t.max_uses === 1)) &&
    doms.includes('ugreen.com') && doms.includes('samsung.com') && !doms.some(d => /reddit|lazada|shopee|amazon/.test(d)) && t.user_location.country === 'PH', rReq); }
chk('W11c research gets ≤3 product names/models, no prices/codes', !/₱|srp|moq|dp_vol/i.test(userOf(rReq)) && (userOf(rReq).match(/\n- /g) || []).length <= 3);
chk('W11d only validated official https sources returned (reddit/http/xn-- dropped)', r.j.sources.length === 1 && r.j.sources[0].url === SAMSUNG && r.j.sources[0].domain === 'samsung.com' && r.j.sources[0].tier === 2, r.j.sources);
chk('W11e compose saw evidence labels, not URLs; research price/URL stripped', /EVIDENCE/.test(userOf(coReq)) && !/https?:\/\//.test(userOf(coReq)) && !/59,990/.test(userOf(coReq)));
const logRow = env.DB.q('SELECT * FROM question_log ORDER BY id DESC LIMIT 1')[0];
chk('W11f log: route web, domains only, redacted query, no reply text', logRow.route === 'web' && logRow.source_domains === 'samsung.com' && /Galaxy S27/.test(logRow.search_query_redacted) && !/https?:/.test(JSON.stringify(logRow)) && !('reply' in logRow));

// web_verified path with the model citing S1
reset();
composeHandler = () => composeReply({ reply: 'Based on the current official device information, P1 supports the Galaxy S27 fast-charging standard.', picks: [{ ref: 'P1', reason: 'USB PD PPS', basis: 'web_verified' }], confidence: 'high', cannot_confirm: [], conflicts: [], language: 'en', sources: [{ ref: 'S1', supports: 'PPS 45W' }, { ref: 'S6', supports: 'invented' }] });
r = await call(env, '/ask', askBody('will it work with Galaxy S27 Ultra fast charging?', chargers.slice(1, 4)), { token: await webTok() });
chk('W12 web_verified kept when an S-ref is valid; invented S6 ignored', r.j.picks[0].basis === 'web_verified' && r.j.sources.length === 1 && r.j.confidence === 'high', r.j);

// catalog evidence -> catalog route
reset();
const withMac = live.filter(p => /macbook/i.test((p.features || '') + (p.description || '') + p.product_name)).slice(0, 3).map(p => String(p.item_code));
r = await call(env, '/ask', askBody('compatible with macbook?', withMac, { route: 'web' }), { token: await webTok() });
chk('W13 device named in catalog text -> catalog route (no web search)', withMac.length >= 2 && r.j.route === 'catalog' && !calls.some(x => x.tools), { n: withMac.length, route: r.j && r.j.route });
reset();
r = await call(env, '/ask', askBody('which of these is better for travel?', chargers.slice(0, 3), { route: 'web' }), { token: await webTok() });
chk('W13b browser cannot force web for a catalog question', r.j.route === 'catalog' && !calls.some(x => x.tools));
reset();
r = await call(env, '/ask', askBody('does it support iOS 27?', chargers.slice(0, 3), { route: 'catalog' }), { token: await webTok() });
chk('W13c OS-version question routes to web even if browser said catalog', r.j.route === 'web' && calls.some(x => x.tools));

// failures on the web route
reset(); researchHandler = () => researchReply({ results: [], citations: [], text: 'No official information found.' });
r = await call(env, '/ask', askBody('works with Pixel 12 Pro?', chargers.slice(0, 3)), { token: await webTok() });
chk('W14 no official source -> no compose call, web_status no_official_source', r.j.ok === false && r.j.error === 'no_official_source' && r.j.web_status === 'no_official_source' && !calls.some(x => !x.tools));
reset(); researchHandler = () => researchReply({ results: [{ url: 'https://www.reddit.com/x', title: 'r' }], citations: [{ url: 'https://www.reddit.com/x', title: 'r', cited_text: 'yes works' }] });
r = await call(env, '/ask', askBody('works with Pixel 12 Pro?', chargers.slice(0, 3)), { token: await webTok() });
chk('W14b only unofficial results -> treated as no official source', r.j.error === 'no_official_source');
reset(); researchHandler = (b, s) => delay(5000, s).then(() => researchReply());
const envT = mkEnv({ WEB_TIMEOUT_MS: '200' }); const tokT = await login(envT, 'c_sales09');
let t0 = Date.now(); r = await call(envT, '/ask', askBody('works with Galaxy S27?', chargers.slice(0, 3)), { token: tokT });
chk('W15 research timeout -> 504 timeout, no compose, fast', r.status === 504 && r.j.error === 'timeout' && Date.now() - t0 < 2000 && !calls.some(x => !x.tools));
chk('W15b failed call does not use daily quota', envT.DB.q("SELECT n FROM counters WHERE scope='code_day'").every(x => x.n === 0) && envT.DB.q('SELECT ai_calls FROM daily_stats')[0].ai_calls === 0);
reset(); researchHandler = () => provErr('overloaded');
r = await call(env, '/ask', askBody('works with Galaxy S27?', chargers.slice(0, 3)), { token: await webTok() });
chk('W16 provider error on research -> web_unavailable', r.j.error === 'web_unavailable' && r.j.web_status === 'unavailable');
reset(); researchHandler = () => researchReply({ toolError: 'too_many_requests', searches: 0 });
r = await call(env, '/ask', askBody('works with Galaxy S28?', chargers.slice(0, 3)), { token: await webTok() });
chk('W16b failed web search call -> web_unavailable, no compose', r.j.error === 'web_unavailable' && !calls.some(x => !x.tools));
reset(); researchHandler = () => researchReply({ stop: 'pause_turn' });
r = await call(env, '/ask', askBody('works with Galaxy S29?', chargers.slice(0, 3)), { token: await webTok() });
chk('W16c incomplete/paused research treated as failure (no continuation)', r.j.error === 'web_unavailable' && calls.filter(x => x.tools).length === 1);

// conflicts
reset();
researchHandler = () => researchReply({ results: [
  { url: 'https://www.ugreen.com/en-ph/products/x', title: 'UGREEN product page' },
  { url: 'https://support.apple.com/en-ph/111111', title: 'Apple support' }],
  citations: [{ url: 'https://www.ugreen.com/en-ph/products/x', title: 'UGREEN', cited_text: 'Supports dual 4K60' },
    { url: 'https://support.apple.com/en-ph/111111', title: 'Apple', cited_text: 'MacBook Air supports one external display' }] });
composeHandler = () => composeReply({ reply: 'Official sources disagree on dual displays.', picks: [{ ref: 'P1', reason: 'dock', basis: 'web_verified' }], confidence: 'high', cannot_confirm: ['Dual display on this MacBook'], conflicts: ['UGREEN lists dual 4K; Apple lists one external display for this model.'], language: 'en', sources: [{ ref: 'S2', supports: 'apple' }, { ref: 'S1', supports: 'ugreen' }] });
r = await call(env, '/ask', askBody('MacBook Air M4 dual monitor', chargers.slice(0, 3)), { token: await webTok() });
chk('W17 conflicting sources -> conflicts shown, confidence capped at medium, UGREEN listed first', r.j.conflicts.length === 1 && r.j.confidence === 'medium' && r.j.sources[0].domain === 'ugreen.com' && r.j.sources[1].domain === 'support.apple.com', r.j);

// source URL unit validation
const c = W.cfg({});
const set = new Set(['https://www.apple.com/a', 'http://www.apple.com/b', 'https://xn--pple-43d.com/c', 'https://evilapple.com/d', 'https://apple.com.evil.net/e', 'https://user:pw@www.apple.com/f']);
chk('W18 URL validation: allowlisted https in results only', !!W.validateSourceUrl(c, 'https://www.apple.com/a', set) && !W.validateSourceUrl(c, 'https://www.apple.com/not-in-results', set) &&
  !W.validateSourceUrl(c, 'http://www.apple.com/b', set) && !W.validateSourceUrl(c, 'https://xn--pple-43d.com/c', set) && !W.validateSourceUrl(c, 'https://evilapple.com/d', set) &&
  !W.validateSourceUrl(c, 'https://apple.com.evil.net/e', set) && !W.validateSourceUrl(c, 'https://user:pw@www.apple.com/f', set));

// budget accounting
reset(); env = mkEnv(); tok = await login(env, 'c_sales01');
r = await call(env, '/ask', askBody('works with Galaxy S27?', chargers.slice(0, 3)), { token: tok });
const sp = env.DB.q('SELECT * FROM spend')[0];
const cf = W.cfg(env); const expected = Math.ceil((15000 + 3600) * cf.priceIn + (250 + 300) * cf.priceOut + 1 * cf.pricePerSearch * 1e6);
chk('W19 budget counts tokens + $0.01/search exactly (reservation released)', sp.micro_usd === expected && sp.web_micro_usd === expected && sp.web_searches === 1, { sp, expected });
chk('W19b cost of this web answer ≈ $' + (expected / 1e6).toFixed(4) + ' (' + P + ')', P === 'openai' ? (expected > 10000 && expected < 20000) : (expected > 20000 && expected < 60000));
env.DB.db.exec("UPDATE spend SET web_micro_usd = 1990000");
reset();
r = await call(env, '/ask', askBody('works with Galaxy S30?', chargers.slice(0, 3)), { token: await login(env, 'c_sales77') });
chk('W20 web sub-budget exhausted -> web_budget, no provider call', r.status === 503 && r.j.error === 'web_budget' && calls.length === 0);
r = await call(env, '/ask', askBody('which is better for travel?', chargers.slice(0, 3)), { token: tok });
chk('W20b catalog AI continues while total budget remains', r.j.ok && r.j.route === 'catalog');
env.DB.db.exec("UPDATE spend SET micro_usd = 4499000");
reset();
r = await call(env, '/ask', askBody('which is better for the office?', chargers.slice(0, 3)), { token: tok });
chk('W21 total budget exhausted -> budget, no provider call', r.status === 503 && r.j.error === 'budget' && calls.length === 0);

// provider errors
reset(); env = mkEnv({ CODE_PER_MIN: '100' }); tok = await login(env, 'c_sales01');
composeHandler = () => provErr('budget');
r = await call(env, '/ask', askBody('which is better for travel?'), { token: tok });
chk('W22 provider spend-limit/quota error -> budget (local VERO stays)', r.status === 503 && r.j.error === 'budget');
composeHandler = () => provErr('model404');
r = await call(env, '/ask', askBody('which is better for travel?'), { token: tok });
chk('W22b model retired/404 -> model_unavailable', r.j.error === 'model_unavailable');
composeHandler = () => Object.assign(composeReply('{"reply": "trunc', { in: 3600, out: 1050 }), { stop: 'max_tokens' });
r = await call(env, '/ask', askBody('which is better for travel?'), { token: tok });
chk('W22c truncated output -> invalid', r.j.error === 'invalid');
composeHandler = () => Object.assign(composeReply('I cannot help with that.', { in: 3600, out: 10 }), { stop: 'refusal' });
r = await call(env, '/ask', askBody('which is better for travel?'), { token: tok });
chk('W22d refusal -> refusal error', r.j.error === 'refusal');
composeHandler = () => composeReply('not json', { in: 3600, out: 10 });
r = await call(env, '/ask', askBody('which is better for travel?'), { token: tok });
chk('W22e invalid JSON -> invalid; failed calls used no daily quota', r.j.error === 'invalid' && env.DB.q("SELECT n FROM counters WHERE scope='code_day'").every(x => x.n === 0), env.DB.q("SELECT * FROM counters"));
chk('W22f failed calls still record actual token cost', env.DB.q('SELECT micro_usd FROM spend')[0].micro_usd > 0);

// kill switches
reset(); let envOff = mkEnv({ AI_ENABLED: 'false' }); let tokOff = await login(envOff, 'c_sales01');
r = await call(envOff, '/ask', askBody('which is better for travel?'), { token: tokOff });
chk('W23 AI_ENABLED=false -> ai_disabled, no provider call', r.status === 503 && r.j.error === 'ai_disabled' && calls.length === 0);
envOff = mkEnv({ WEB_ENABLED: 'false' }); tokOff = await login(envOff, 'c_sales01');
r = await call(envOff, '/ask', askBody('works with Galaxy S27?', chargers.slice(0, 3)), { token: tokOff });
chk('W23b WEB_ENABLED=false -> web_unavailable for web questions (no unverified answer)', r.j.error === 'web_unavailable' && calls.length === 0);
r = await call(envOff, '/ask', askBody('which is better for travel?', chargers.slice(0, 3)), { token: tokOff });
chk('W23c WEB_ENABLED=false keeps catalog AI working', r.j.ok && r.j.route === 'catalog');

// rate limits
reset(); env = mkEnv(); tok = await login(env, 'c_sales01');
let codes429 = [];
for (let i = 0; i < 5; i++) { r = await call(env, '/ask', askBody('which is better for travel ' + i + '?'), { token: tok }); codes429.push(r.status); }
chk('W24 per-code 4/min: 5th call -> 429 code_min', codes429.slice(0, 4).every(s => s === 200) && codes429[4] === 429 && r.j.limit === 'code_min', codes429);
env = mkEnv({ CODE_PER_MIN: '100', IP_PER_MIN: '100', CODE_PER_DAY: '2' }); tok = await login(env, 'c_sales01');
for (let i = 0; i < 3; i++) r = await call(env, '/ask', askBody('which is better for travel ' + i + '?'), { token: tok });
chk('W24b per-code daily cap', r.status === 429 && r.j.limit === 'code_day');
env = mkEnv({ CODE_PER_MIN: '100', IP_PER_MIN: '100', GLOBAL_PER_DAY: '2' });
const ta = await login(env, 'c_sales01'), tb = await login(env, 'c_sales02');
await call(env, '/ask', askBody('which is better for travel 1?'), { token: ta, ip: '192.0.2.1' });
await call(env, '/ask', askBody('which is better for travel 2?'), { token: tb, ip: '192.0.2.2' });
r = await call(env, '/ask', askBody('which is better for travel 3?'), { token: tb, ip: '192.0.2.3' });
chk('W24c global daily cap across codes', r.status === 429 && r.j.limit === 'global_day');
chk('W24d refused call did not consume the per-code quota', env.DB.q("SELECT n FROM counters WHERE scope='code_day' AND subject='c_sales02'")[0].n === 1);
env = mkEnv({ CODE_PER_MIN: '100', IP_PER_MIN: '100' }); tok = await login(env, 'c_sales01');
await call(env, '/ask', askBody('works with Galaxy S27?', chargers.slice(0, 3)), { token: tok });
r = await call(env, '/ask', askBody('works with Galaxy S27 Ultra?', chargers.slice(0, 3)), { token: tok });
chk('W24e web 1/min per code -> web_limited', r.status === 429 && r.j.error === 'web_limited');
env = mkEnv({ CODE_PER_MIN: '100', IP_PER_MIN: '100', WEB_CODE_PER_MIN: '100', IP_PER_DAY: '100' });
const tw = []; for (let i = 0; i < 5; i++) tw.push(await login(env, 'c_s' + i));
const webStat = []; for (let i = 0; i < 5; i++) { r = await call(env, '/ask', askBody('works with Galaxy S' + (40 + i) + '?', chargers.slice(0, 3)), { token: tw[i] }); webStat.push(r.j.error || 'ok'); }
chk('W24f global web cap 4/day', webStat.slice(0, 4).every(s => s === 'ok') && webStat[4] === 'web_limited', webStat);

env = mkEnv({ IP_PER_MIN: '6', CODE_PER_MIN: '100' });
const ipToks = []; for (let i = 0; i < 7; i++) ipToks.push(await login(env, 'c_ip' + i));
const ipStat = []; for (let i = 0; i < 7; i++) { r = await call(env, '/ask', askBody('which is better for travel ip ' + i + '?'), { token: ipToks[i], ip: '192.0.2.50' }); ipStat.push(r.status); }
chk('W24g per-IP 6/min across different codes', ipStat.slice(0, 6).every(s => s === 200) && ipStat[6] === 429, ipStat);

// cache
reset(); env = mkEnv(); tok = await login(env, 'c_sales01');
await call(env, '/ask', askBody('Which is better for travel?'), { token: tok });
const n1 = calls.length;
r = await call(env, '/ask', askBody('which is better for travel?'), { token: tok });
chk('W25 repeat question served from cache (no provider call, cached flag)', calls.length === n1 && r.j.cached === true && r.j.ok);
chk('W25b cache row holds validated answer only, not linked to a user', (() => { const row = env.DB.q('SELECT * FROM answer_cache')[0]; return row && !/c_sales01|203\.0/.test(JSON.stringify(row)) && row.route === 'catalog'; })());
catalogEtag = 'W/"cat-v2"'; W._resetCatalogForTests();
env.DB.db.exec("UPDATE meta SET v = '0' WHERE k = 'catalog_checked_at'");   // the 10-minute version-check window has passed
await call(env, '/ask', askBody('which is better for travel?'), { token: tok });
chk('W25c catalog republish (new ETag) invalidates cache', calls.length === n1 + 1);
const wc = env.DB.q("SELECT expires_at, created_at FROM answer_cache WHERE route='catalog' ORDER BY created_at DESC LIMIT 1")[0];
chk('W25d catalog cache TTL 7 days', Math.round((Date.parse(wc.expires_at) - Date.parse(wc.created_at)) / 86400000) === 7);

// logging privacy
reset(); env = mkEnv({ AI_ROLES: 'admin,sales,dealer' }); const tokD = await login(env, 'c_dealer01', 'dealer');
r = await call(env, '/ask', askBody('para kay juan@example.com 09171234567 which is better for travel and the office and home use and long trips?'), { token: tokD });
const lr = env.DB.q('SELECT * FROM question_log ORDER BY id DESC LIMIT 1')[0];
chk('W26 log redacts email/phone, ≤120 chars, no full IP', lr.q_redacted.length <= 120 && !/juan@|0917/.test(lr.q_redacted) && /\[email\]/.test(lr.q_redacted) && /^[0-9a-f]{16}$/.test(lr.ip_hash) && !/203\.0\.113/.test(JSON.stringify(lr)));
chk('W26b dealer role: picks not stored', lr.role === 'dealer' && lr.picks === null);
chk('W26c no table stores reply text except the unlinked cache', !JSON.stringify(env.DB.q('SELECT * FROM question_log')).includes('travel pick'));

// cleanup
env.DB.db.exec("INSERT INTO question_log (ts, day, code_id, role, q_redacted, route, trigger, outcome) VALUES ('2026-01-01', '2026-01-01', 'c', 'sales', 'old', 'catalog', 'auto', 'ok')");
env.DB.db.exec("INSERT INTO answer_cache (key, route, response, created_at, expires_at) VALUES ('old', 'catalog', '{}', '2026-01-01', '2026-01-02')");
await W.cleanup(env, W.cfg(env), Date.now());
chk('W27 cleanup removes >30-day logs and expired cache', env.DB.q("SELECT * FROM question_log WHERE day = '2026-01-01'").length === 0 && env.DB.q("SELECT * FROM answer_cache WHERE key = 'old'").length === 0);

// sanitizer and redact units
chk('W28 sanitizeText keeps normal specs (100W, 20000mAh, 2026, USB-C 3.2)', W.sanitizeText('Supports 100W, 20000mAh, 2026 models, USB-C 3.2 and 4K60.', 600, new Set()) === 'Supports 100W, 20000mAh, 2026 models, USB-C 3.2 and 4K60.');
chk('W28b sanitizeText strips prices in Taglish + PH shorthand', !/\d/.test(W.sanitizeText('Ang presyo ay 1500 lang, P1,200 sa iba, P 2500 dito, 999 pesos', 600, new Set())), W.sanitizeText('Ang presyo ay 1500 lang, P1,200 sa iba, P 2500 dito, 999 pesos', 600, new Set()));
composeHandler = () => composeReply({ reply: 'P1 is lighter than P2.', picks: [{ ref: 'P1', reason: 'Lighter than P2', basis: 'product_data' }], confidence: 'high', cannot_confirm: [], conflicts: [], language: 'en', sources: [] });
reset(); composeHandler = () => composeReply({ reply: 'P1 is lighter than P2.', picks: [{ ref: 'P1', reason: 'Lighter than P2', basis: 'product_data' }], confidence: 'high', cannot_confirm: [], conflicts: [], language: 'en', sources: [] });
{ const e2 = mkEnv(); const t2 = await login(e2, 'c_lbl'); r = await call(e2, '/ask', askBody('which is lighter for travel?'), { token: t2 });
chk('W28c P-labels in reply/reasons replaced with product names', !/\bP[1-8]\b/.test(r.j.reply + r.j.picks[0].reason) && r.j.reply.includes(by(chargers[0]).product_name.slice(0, 20)), r.j.reply); }

// routing parity with the browser engine
globalThis.window = {};
vm.runInThisContext(readFileSync(path.join(ROOT, 'js/vero-engine.js'), 'utf8'));
const E = globalThis.window.VeroEngine;
const fixtures = ['MacBook Air M4 dual monitor', 'works with iOS 27?', 'latest DisplayLink support', 'compatible with Galaxy S27?', 'official manual for this model',
  'which of these two chargers is better for travel?', 'best 100W charger among these products', 'compare these docks based on the pricelist specs', 'pwede ba sa iPad Pro ko?', 'thunderbolt 4 dock for windows 11'];
const parity = fixtures.map(q => [q, W.webDecision(q, ['']).web, E.webDecision(q, ['']).web]);
chk('W29 browser and Worker web rules agree on all fixtures', parity.every(x => x[1] === x[2]), parity.filter(x => x[1] !== x[2]));
chk('W29b expected routes: 5 web, 3 catalog, Taglish iPad + TB4/Win11 web', parity.map(x => x[1]).join() === 'true,true,true,true,true,false,false,false,true,true', parity.map(x => x[1]));

/* ---------------- provider-specific checks ---------------- */
if (P === 'openai') {
  reset(); env = mkEnv({ ANTHROPIC_API_KEY: undefined, ANTHROPIC_BASE_URL: undefined }); tok = await login(env, 'c_oa1');
  r = await call(env, '/ask', askBody('which is better for travel?'), { token: tok });
  chk('O1 production path needs no ANTHROPIC_* setting; calls POST /v1/responses with Bearer OPENAI_API_KEY', r.j.ok && calls.length === 1 && callHeaders[0].authorization === 'Bearer fake-openai-key' && !('x-api-key' in callHeaders[0]));
  reset(); env = mkEnv({ OPENAI_API_KEY: undefined }); tok = await login(env, 'c_oa2');
  r = await call(env, '/ask', askBody('which is better for travel?'), { token: tok });
  chk('O2 missing OPENAI_API_KEY -> AI unavailable, no provider call, no daily quota used', r.status === 503 && r.j.error === 'unavailable' && calls.length === 0 && env.DB.q("SELECT n FROM counters WHERE scope='code_day'").every(x => x.n === 0));
  const n1 = W.openaiNormalize({ status: 'completed', output: [
    { type: 'web_search_call', status: 'completed', action: { type: 'search', query: 'q1', sources: [{ type: 'url', url: 'https://www.apple.com/a' }] } },
    { type: 'web_search_call', status: 'failed', action: { type: 'search', query: 'q2' } },
    { type: 'message', content: [{ type: 'output_text', text: 'Supports 45W charging. More text.', annotations: [{ type: 'url_citation', url: 'https://www.apple.com/a', title: 'Apple', start_index: 0, end_index: 21 }] }] }],
    usage: { input_tokens: 1000, output_tokens: 200, output_tokens_details: { reasoning_tokens: 120 } } });
  chk('O3 normaliser: citation text from annotation span, only completed searches billed, failed search flagged, reasoning counted as output',
    n1.research.citations[0].text === 'Supports 45W charging' && n1.usage.searches === 1 && n1.research.toolError === 'search_failed' && n1.usage.out === 200 && n1.stop === 'end' && n1.research.queries.join() === 'q1,q2', n1);
  const n2 = W.openaiNormalize({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [], usage: {} });
  const n3 = W.openaiNormalize({ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }], usage: {} });
  chk('O4 normaliser: truncated -> max_tokens, refusal detected', n2.stop === 'max_tokens' && n3.stop === 'refusal');
  const strictOk = (node) => node.type !== 'object' || (node.additionalProperties === false && Object.keys(node.properties).every(k => node.required.includes(k)) && Object.values(node.properties).every(v => strictOk(v.type === 'array' ? v.items : v)));
  chk('O5 compose schemas (base, Taglish, English) meet OpenAI strict-mode rules (all fields required, no extra properties)', strictOk(W.COMPOSE_SCHEMA) && strictOk(W.COMPOSE_SCHEMAS.taglish) && strictOk(W.COMPOSE_SCHEMAS.en));
  const c2 = W.cfg({}); const worstCat = Math.ceil(4500 * c2.priceIn + (c2.maxOut + c2.reasoningAllowance) * c2.priceOut);
  const worstWeb = Math.ceil(30000 * c2.priceIn + (c2.researchMaxOut + c2.reasoningAllowance) * c2.priceOut + c2.pricePerSearch * 1e6 + 5000 * c2.priceIn + (c2.maxOut + c2.reasoningAllowance) * c2.priceOut);
  chk('O6 defaults are OpenAI/gpt-6-luna; budget reservations cover worst case (catalog ' + worstCat + ' µ$, web ' + worstWeb + ' µ$)',
    c2.provider === 'openai' && c2.model === 'gpt-6-luna' && c2.webTool === 'web_search' && c2.reasoningEffort === 'low' && worstCat <= c2.reserveCatalog && worstWeb <= c2.reserveWeb);
}

/* ---------------- catalog byte index + source URL hygiene (2026-10-06 CPU pass) ---------------- */
{
  const bytes = new TextEncoder().encode(PRODUCTS_TEXT);
  const cat = { bytes, index: null, cache: new Map(), full: null };
  let same = 0, nested = 0;
  for (const p of PRODUCTS) {
    const g = W.getProduct(cat, String(p.item_code));
    if (p.disabled ? g === null : JSON.stringify(g) === JSON.stringify(p)) same++;
    if (Array.isArray(p.priceHistory) && p.priceHistory.some(x => x && typeof x === 'object')) nested++;
  }
  chk('C1 byte-index lookup returns exactly the JSON.parse record for every product (' + PRODUCTS.length + ', ' + nested + ' with nested priceHistory), no full-parse fallback',
    same === PRODUCTS.length && nested > 0 && cat.full === null, { same, total: PRODUCTS.length, fallback: !!cat.full });
  chk('C2 unknown / malformed / injected codes -> null', [ 'NOPE123', '', '1 OR 1=1', '"item_code"', 'x'.repeat(30) ].every(c => W.getProduct(cat, c) === null));
  const pretty = new TextEncoder().encode(JSON.stringify(PRODUCTS.slice(0, 5), null, 2));
  const cat2 = { bytes: pretty, index: null, cache: new Map(), full: null };
  const p0 = PRODUCTS.slice(0, 5).find(p => !p.disabled);
  chk('C3 unexpected catalog layout still resolves via the full-parse fallback', JSON.stringify(W.getProduct(cat2, String(p0.item_code))) === JSON.stringify(p0) && cat2.full !== null);
  const c = W.cfg({});
  const u = 'https://support.apple.com/en-ph/122212?utm_source=openai';
  const v = W.validateSourceUrl(c, u, new Set([u]));
  const u2 = 'https://www.ugreen.com/products/x?variant=2&utm_medium=a&UTM_CAMPAIGN=b&utm_term=c&utm_content=d#frag';
  const v2 = W.validateSourceUrl(c, u2, new Set([u2]));
  chk('S7 tracking params removed from displayed source URL (?utm_source=openai)', v && v.url === 'https://support.apple.com/en-ph/122212' && v.domain === 'support.apple.com', v);
  chk('S7b other query params kept; all utm_* (any case) and #fragment dropped', v2 && v2.url === 'https://www.ugreen.com/products/x?variant=2', v2);
  chk('S7c validation unchanged: URL must be in results, https, allowlisted', W.validateSourceUrl(c, u, new Set()) === null
    && W.validateSourceUrl(c, 'http://support.apple.com/x?utm_source=openai', new Set(['http://support.apple.com/x?utm_source=openai'])) === null
    && W.validateSourceUrl(c, 'https://evil.example/x?utm_source=openai', new Set(['https://evil.example/x?utm_source=openai'])) === null);
  const srcs = W.buildSources(c, { results: [{ url: u, title: 'Apple' }, { url: 'https://support.apple.com/en-ph/122212', title: 'Apple' }], citations: [{ url: u, title: 'Apple', text: 'two displays' }], queries: [], findings: '' });
  chk('S7d same page with/without utm collapses to one S1 source', srcs.length === 1 && srcs[0].id === 'S1' && srcs[0].url === 'https://support.apple.com/en-ph/122212', srcs);
}

/* ---------------- D1 product-text cache (migration 0002) ---------------- */
{
  const enabled = PRODUCTS.filter(p => !p.disabled);
  const cacheCount = e => e.DB.q('SELECT count(*) n FROM product_text')[0].n;
  const metaV = (e, k) => { const r = e.DB.q('SELECT v FROM meta WHERE k = ?', k)[0]; return r ? r.v : null; };
  const ask = (e, tok, q, cands, extra) => call(e, '/ask', askBody(q, cands, extra), { token: tok });
  const hub = live.filter(p => p.sheet_display === 'Transmission: Docking and Hub').slice(0, 6).map(p => String(p.item_code));

  // K1 population: empty cache -> served from the catalog, cache built in the background (one transaction)
  reset(); catalogEtag = 'W/"cat-k1"'; catalogText = null; let e = mkEnv(); let tok = await login(e, 'c_k1');
  catalogFetches = 0; let r = await ask(e, tok, 'which is better for travel k1?');
  chk('K1 empty cache: answer served from the catalog, cache populated with every enabled product (' + enabled.length + ')',
    r.status === 200 && r.j.ok && cacheCount(e) === enabled.length && metaV(e, 'catalog_version') === catalogEtag && metaV(e, 'catalog_rows') === String(enabled.length), { st: r.status, n: cacheCount(e) });
  chk('K1b schema_version 2 recorded by migration 0002', metaV(e, 'schema_version') === '2');

  // K2 fast path: no catalog download while the cache is current
  W._resetCatalogForTests(); catalogFetches = 0; const before = calls.length;
  r = await ask(e, tok, 'which is better for travel k2?');
  chk('K2 cache current: /ask needs no catalog download (D1 rows only)', r.status === 200 && r.j.ok && catalogFetches === 0 && calls.length === before + 1, { catalogFetches });

  // K3 identical model input from cache vs catalog, for catalog and web routes
  const promptVia = async (useCache, q, cands, route) => {
    const e2 = mkEnv(useCache ? {} : { __no0002: true }); const t2 = await login(e2, 'c_k3');
    if (useCache) { W._resetCatalogForTests(); await ask(e2, t2, 'which is better for travel warmup?', cands, { route: 'catalog' }); }   // populates the cache (catalog route: no web quota used)
    W._resetCatalogForTests(); const n0 = calls.length; await ask(e2, t2, q, cands, { route });
    return calls.slice(n0).map(b => JSON.stringify({ i: userOf(b), ins: b.instructions || b.system || null, t: b.tools || null }));
  };
  const a1 = await promptVia(false, 'which is better for travel k3?', chargers.slice(0, 4), 'catalog'), b1 = await promptVia(true, 'which is better for travel k3?', chargers.slice(0, 4), 'catalog');
  chk('K3 catalog route: model input identical from D1 cache and from the catalog', a1.length === 1 && JSON.stringify(a1) === JSON.stringify(b1));
  const a2 = await promptVia(false, 'does this hub work with a Galaxy S27 phone?', hub, 'web'), b2 = await promptVia(true, 'does this hub work with a Galaxy S27 phone?', hub, 'web');
  chk('K3b web route: research + compose input identical from D1 cache and from the catalog', a2.length === 2 && JSON.stringify(a2) === JSON.stringify(b2));
  { const ee = mkEnv(); ee.DB.db.exec('DELETE FROM meta'); await W.refreshProductCache(ee, W.cfg(ee), { etag: 'W/"x"', bytes: new TextEncoder().encode(PRODUCTS_TEXT), full: null }, Date.now());
    const rowsDb = ee.DB.q('SELECT * FROM product_text');
    const asProd = x => ({ product_name: x.name, model: x.model, category: x.category, sheet_display: x.section, color: x.color, length: x.length, short_desc: x.summary, features: x.features, description: x.description });
    const byCode = new Map(enabled.map(p => [String(p.item_code), p]));
    const qs = ['works with macbook air m4?', 'windows 11 driver', 'thunderbolt 4 dock', 'pwede ba sa galaxy s24', 'usb4 hub', 'ipad pro m4 compatible', 'official manual', 'magsafe charger iphone 15'];
    let same = 0; for (const x of rowsDb) { const p = byCode.get(x.item_code), c = asProd(x);
      const ev = o => [o.product_name, o.features, o.description].join(' ');
      if (p && W.productText(c) === W.productText(p) && qs.every(q => JSON.stringify(W.webDecision(q, [ev(c)])) === JSON.stringify(W.webDecision(q, [ev(p)])))) same++; }
    chk('K3c every cached product: identical prompt text and identical web/catalog routing (' + qs.length + ' questions)', same === enabled.length && rowsDb.length === enabled.length, { same, rows: rowsDb.length }); }

  // K4 catalog version change: detected after the check window, request served from the NEW catalog, cache rebuilt
  const changed = PRODUCTS.filter(p => String(p.item_code) !== chargers[3]);                 // a product removed from the catalog
  catalogText = JSON.stringify(changed); catalogEtag = 'W/"cat-k4"'; e.DB.db.exec("UPDATE meta SET v = '0' WHERE k = 'catalog_checked_at'");
  e.DB.db.exec("INSERT INTO product_text (item_code, version, name) VALUES ('ZZOLD1', 'W/\"ancient\"', 'stale row')");
  W._resetCatalogForTests(); catalogFetches = 0;
  r = await ask(e, tok, 'which is better for travel k4?', chargers.slice(0, 4));
  chk('K4 catalog republish: new ETag detected, this answer built from the new catalog, cache rebuilt to the new version',
    r.status === 200 && metaV(e, 'catalog_version') === 'W/"cat-k4"' && e.DB.q("SELECT count(*) n FROM product_text WHERE version <> 'W/\"cat-k4\"'")[0].n === 0, { v: metaV(e, 'catalog_version') });
  chk('K4b stale rows removed: product dropped from the catalog and old-version rows are gone',
    e.DB.q('SELECT count(*) n FROM product_text WHERE item_code IN (?, ?)', chargers[3], 'ZZOLD1')[0].n === 0 && cacheCount(e) === enabled.length - 1);
  chk('K4c removed product is no longer a usable candidate', !calls[calls.length - 1] || !String(calls[calls.length - 1].input).includes(by(chargers[3]).product_name.slice(0, 30)) || cacheCount(e) === enabled.length - 1);

  // K5 unchanged catalog after the window: conditional request (304), no rebuild, check time refreshed
  e.DB.db.exec("UPDATE meta SET v = '0' WHERE k = 'catalog_checked_at'"); const rowsBefore = JSON.stringify(e.DB.q('SELECT item_code, version FROM product_text ORDER BY item_code'));
  W._resetCatalogForTests(); catalogFetches = 0;
  r = await ask(e, tok, 'which is better for travel k5?', chargers.slice(0, 3));
  chk('K5 unchanged catalog: one conditional request (304), cache kept, check time updated', r.status === 200 && catalogFetches === 1 && Number(metaV(e, 'catalog_checked_at')) > 0
    && JSON.stringify(e.DB.q('SELECT item_code, version FROM product_text ORDER BY item_code')) === rowsBefore);
  catalogText = null; catalogEtag = 'W/"cat-k4"';

  // K6 missing cache table (0002 not applied) -> same behaviour as before, from the catalog
  { const e6 = mkEnv({ __no0002: true }); const t6 = await login(e6, 'c_k6'); W._resetCatalogForTests(); catalogFetches = 0;
    const r6 = await ask(e6, t6, 'which is better for travel k6?');
    chk('K6 cache table missing: /ask still answers from the catalog (no error, no refresh attempt)', r6.status === 200 && r6.j.ok && catalogFetches === 1 && e6.DB.q("SELECT count(*) n FROM meta WHERE k LIKE 'catalog%'")[0].n === 0); }

  // K7 malformed row -> that request uses the catalog instead
  { const e7 = mkEnv(); const t7 = await login(e7, 'c_k7'); W._resetCatalogForTests(); await ask(e7, t7, 'warm k7', chargers.slice(0, 3));
    e7.DB.db.exec(`UPDATE product_text SET name = '   ' WHERE item_code = '${chargers[0]}'`);
    W._resetCatalogForTests(); catalogFetches = 0; const n0 = calls.length;
    const r7 = await ask(e7, t7, 'which is better for travel k7?', chargers.slice(0, 3));
    chk('K7 malformed cache row: request falls back to the catalog and still gets the correct product text', r7.status === 200 && catalogFetches === 1 && userOf(calls[n0]).includes(by(chargers[0]).product_name.trim().slice(0, 20))); }

  // K8 nothing forbidden in the cache: columns are the allow-list; sentinel price/dealer/stock/auth values never stored
  { const cols = e.DB.q('PRAGMA table_info(product_text)').map(c => c.name);
    chk('K8 product_text columns are exactly the approved allow-list', JSON.stringify(cols) === JSON.stringify(W.CACHE_COLUMNS), cols);
    const SENT = 'SENTINEL_7731';
    const poisoned = enabled.slice(0, 3).map(p => Object.assign({}, p, { srp: SENT + 1, dp: SENT + 2, dp_volume: SENT + 3, special_dp: SENT + 4, specialDP: SENT + 4, moq: SENT + 5, stock: SENT + 6,
      dealer: SENT + 7, dealer_name: SENT + 7, assigned_skus: SENT + 8, password: SENT + 9, token: SENT + 9, previousSRP: SENT + 10, previousDP: SENT + 10, priceHistory: [{ srp: SENT + 11 }], priceSchedule: [{ dp: SENT + 12 }], upc: SENT + 13, material_number: SENT + 14, remarks: SENT + 15, image: SENT + 16 }));
    const e8 = mkEnv(); await W.refreshProductCache(e8, W.cfg(e8), { etag: 'W/"p8"', bytes: new TextEncoder().encode(JSON.stringify(poisoned)), full: null }, Date.now());
    const dump = JSON.stringify(e8.DB.q('SELECT * FROM product_text'));
    chk('K8b price / MOQ / stock / dealer / auth / UPC / image values never enter the cache', e8.DB.q('SELECT count(*) n FROM product_text')[0].n === 3 && !dump.includes(SENT));
    chk('K8c real catalog: no cached value carries a product\'s own SRP/DP/DP Vol/MOQ field', !JSON.stringify(e.DB.q('SELECT * FROM product_text')).match(/"(srp|dp|dp_volume|moq|stock|dealer)"/i));
    chk('K8d disabled products are never cached', PRODUCTS.filter(p => p.disabled).every(p => e.DB.q('SELECT count(*) n FROM product_text WHERE item_code = ?', String(p.item_code))[0].n === 0)); }

  // K9 refresh guard: one attempt per catalog version per hour (a failed/over-budget rebuild is not retried per request)
  { const e9 = mkEnv(); const bad = { etag: 'W/"broken"', bytes: new TextEncoder().encode('[{"item_code":"1",'), full: null };
    const r1 = await W.refreshProductCache(e9, W.cfg(e9), bad, Date.now()); const r2 = await W.refreshProductCache(e9, W.cfg(e9), bad, Date.now() + 60000);
    const r3 = await W.refreshProductCache(e9, W.cfg(e9), bad, Date.now() + 3700000);
    chk('K9 broken catalog: refresh fails safely (cache untouched), not retried within the hour, retried after', r1.error && r2.skipped === 'recent_attempt' && r3.error && e9.DB.q('SELECT count(*) n FROM product_text')[0].n === 0 && metaV(e9, 'catalog_version') === null); }

  // K10 duplicate item_code in the catalog: first record wins (same as the byte index), refresh does not fail
  { const dup = [enabled[0], Object.assign({}, enabled[0], { product_name: 'DUPLICATE' }), enabled[1]];
    const e10 = mkEnv(); const r10 = await W.refreshProductCache(e10, W.cfg(e10), { etag: 'W/"d"', bytes: new TextEncoder().encode(JSON.stringify(dup)), full: null }, Date.now());
    chk('K10 duplicate item_code: first record wins, no failure', r10.ok && r10.rows === 2 && e10.DB.q('SELECT name FROM product_text WHERE item_code = ?', String(enabled[0].item_code))[0].name === enabled[0].product_name); }

  // K11 cron keeps the cache in step
  { const e11 = mkEnv(); catalogEtag = 'W/"cron1"'; W._resetCatalogForTests();
    const c1 = await W.cronRefresh(e11, W.cfg(e11), Date.now());
    const c2 = await W.cronRefresh(e11, W.cfg(e11), Date.now() + 1000);
    catalogEtag = 'W/"cron2"'; const c3 = await W.cronRefresh(e11, W.cfg(e11), Date.now() + 2000);
    chk('K11 cron: populates an empty cache, keeps it when unchanged (304), rebuilds on a new version', c1.ok && c2.same && c3.ok && metaV(e11, 'catalog_version') === 'W/"cron2"' && cacheCount(e11) === enabled.length);
    catalogEtag = 'W/"cat-k4"'; }

  // K12 disabled / unknown candidates still refused exactly as before
  { W._resetCatalogForTests(); const dis = PRODUCTS.find(p => p.disabled);
    const r12 = await ask(e, tok, 'which is better for travel k12?', [chargers[0], String(dis.item_code), 'NOPE999']);
    chk('K12 disabled + unknown candidates never reach the model (only 1 valid -> no_candidates)', r12.status === 422 && r12.j.error === 'no_candidates'); }

  // K13 HMAC key kept in memory: tokens still verify after a secret change only with the new secret
  { const t1 = await W.signToken({ sid: 's', role: 'sales', ep: 1, exp: Date.now() + 60000 }, 'k'.repeat(40));
    chk('K13 signing key cached per secret: old token rejected under a new secret, accepted under the old one',
      !!(await W.verifyToken(t1, 'k'.repeat(40), Date.now())) && !(await W.verifyToken(t1, 'z'.repeat(40), Date.now())) && !!(await W.verifyToken(t1, 'k'.repeat(40), Date.now()))); }
  catalogEtag = 'W/"cat-v2"'; catalogText = null;
}

/* ---------------- reply language + word-boundary truncation (2026-10-06 pre-deployment fixes) ---------------- */
{
  // L1 deterministic language detection from the question
  const TL = ['Alin mas okay for travel kung laptop at phone ang gagamitin ko?', 'compatible ba sa Samsung Galaxy S27 ko?', 'Pwede ba ito sa MacBook Air M4?',
    'Anong magandang charger para sa laptop at phone?', 'May 100W ba kayo na pang laptop?', 'Ano mas maganda, yung 65W o yung 100W?'];
  const EN = ['Which UGREEN charger is better for a laptop and phone?', 'Can this dock support dual monitors on a MacBook Air M4?',
    'Which is better for travel, the 65W or the 100W?', 'Is this hub compatible with a Samsung tablet?', 'Which charger po for my laptop?', 'Para-sailing phone pouch?'];
  const badTL = TL.filter(q => W.replyLanguage(q) !== 'taglish'), badEN = EN.filter(q => W.replyLanguage(q) !== 'en');
  chk('L1 language detection: Taglish questions -> taglish, English questions (incl. one loan word) -> en', !badTL.length && !badEN.length, { badTL, badEN });

  const STAGE_B = ['10334', '95405B', '40913', '35314', '15570', '45514B', '90872B', '25870'];
  const sysOf = b => String(b.instructions || b.system || '');
  const TL_REPLY = 'Para sa laptop at phone, mas okay ang P1 kasi compact siya at may dalawang USB-C ports, kaya sabay mong ma-charge ang dalawa.';
  const EN_REPLY = 'For a laptop and phone, P1 is a compact pick with two USB-C ports, so both can charge at the same time.';
  const eL = mkEnv({ CODE_PER_MIN: '100', CODE_PER_DAY: '100' }); const tL = await login(eL, 'c_lang', 'admin');

  // L2 Taglish question -> model is told to answer in Taglish -> Taglish reply returned with language=taglish
  reset(); composeHandler = () => composeReply({ reply: TL_REPLY, picks: [{ ref: 'P1', reason: 'Compact at may dalawang USB-C ports.', basis: 'product_data' }], confidence: 'medium', cannot_confirm: [], conflicts: [], language: 'taglish', sources: [] });
  let n0 = calls.length;
  const rT = await call(eL, '/ask', askBody('Alin mas okay for travel kung laptop at phone ang gagamitin ko?', STAGE_B), { token: tL });
  const qT = calls[n0];
  chk('L2 Taglish question -> compose input says REPLY LANGUAGE: Taglish; system has the Taglish style rule',
    rT.status === 200 && /REPLY LANGUAGE: Taglish$/.test(userOf(qT).replace(/["\]}\s]+$/, '')) && /Taglish: write the way Filipino salespeople talk/.test(sysOf(qT) + JSON.stringify(qT)), userOf(qT).slice(-120));
  chk('L2b Taglish question -> Taglish reply returned, language=taglish, reply passes the Taglish check',
    rT.j.ok && rT.j.language === 'taglish' && W.replyLanguage(rT.j.reply) === 'taglish' && /mas okay/.test(rT.j.reply), rT.j);

  // L3 English question -> English
  reset(); composeHandler = () => composeReply({ reply: EN_REPLY, picks: [{ ref: 'P1', reason: 'Compact with two USB-C ports.', basis: 'product_data' }], confidence: 'medium', cannot_confirm: [], conflicts: [], language: 'en', sources: [] });
  n0 = calls.length;
  const rE = await call(eL, '/ask', askBody('Which UGREEN charger is better for a laptop and phone?', STAGE_B), { token: tL });
  chk('L3 English question -> compose input says REPLY LANGUAGE: English; English reply, language=en',
    rE.status === 200 && /REPLY LANGUAGE: English/.test(userOf(calls[n0])) && rE.j.language === 'en' && W.replyLanguage(rE.j.reply) === 'en', rE.j);

  // L4 the language label comes from the question, not from the model (Stage B bug: label taglish, reply English)
  reset(); composeHandler = () => composeReply({ reply: EN_REPLY, picks: [], confidence: 'low', cannot_confirm: [], conflicts: [], language: 'taglish', sources: [] });
  const r4 = await call(eL, '/ask', askBody('Which is better for travel, the 65W or the 100W?', STAGE_B), { token: tL });
  reset(); composeHandler = () => composeReply({ reply: TL_REPLY, picks: [], confidence: 'low', cannot_confirm: [], conflicts: [], language: 'en', sources: [] });
  const r4b = await call(eL, '/ask', askBody('Pwede ba ito sa laptop ko habang nasa biyahe?', STAGE_B), { token: tL });
  chk('L4 model language label ignored: English question -> en, Taglish question -> taglish', r4.j.language === 'en' && r4b.j.language === 'taglish', [r4.j.language, r4b.j.language]);

  // L5 v2 cached answers (English reply to the Taglish question) are not reused
  chk('L5 PROMPT_VERSION bumped so pre-fix cached answers are not reused', W.PROMPT_VERSION === 'v4');

  // G: language is part of the strict output contract (2026-10-06, after the live check showed the prompt line was ignored)
  const schemaOf = b => (P === 'openai' ? b.text.format.schema : b.output_config.format.schema);
  const strictOk2 = (node) => node.type !== 'object' || (node.additionalProperties === false && Object.keys(node.properties).every(k => node.required.includes(k)) && Object.values(node.properties).every(v => strictOk2(v.type === 'array' ? v.items : v)));
  const base = W.COMPOSE_SCHEMA;
  const sameExceptLang = sc => { const a = JSON.parse(JSON.stringify(sc)), b = JSON.parse(JSON.stringify(base));
    const strip = x => { delete x.properties.reply.description; delete x.properties.picks.items.properties.reason.description; delete x.properties.cannot_confirm.items.description; delete x.properties.conflicts.items.description; delete x.properties.language; return JSON.stringify(x); };
    return strip(a) === strip(b); };
  reset(); composeHandler = () => composeReply({ reply: TL_REPLY, picks: [{ ref: 'P1', reason: 'Compact at may dalawang USB-C ports.', basis: 'product_data' }], confidence: 'medium', cannot_confirm: [], conflicts: [], language: 'taglish', sources: [] });
  n0 = calls.length; const rs1 = await call(eL, '/ask', askBody('Alin mas okay for travel kung laptop at phone ang gagamitin ko? (s1)', STAGE_B), { token: tL });
  const tReq = calls[n0], tSch = schemaOf(tReq), tPr = tSch.properties;
  chk('G1 Taglish request gets the Taglish schema: reply/reason/notes require Taglish, "Must not be pure English", language pinned to taglish',
    rs1.status === 200 && /Natural conversational Taglish for Filipino salespeople/.test(tPr.reply.description) && /Must not be pure English/.test(tPr.reply.description) &&
    /Taglish.*Must not be pure English/.test(tPr.picks.items.properties.reason.description) && /Taglish.*Must not be pure English/.test(tPr.cannot_confirm.items.description) &&
    /Taglish.*Must not be pure English/.test(tPr.conflicts.items.description) && JSON.stringify(tPr.language.enum) === '["taglish"]', tPr);
  reset(); composeHandler = () => composeReply({ reply: EN_REPLY, picks: [{ ref: 'P1', reason: 'Compact with two USB-C ports.', basis: 'product_data' }], confidence: 'medium', cannot_confirm: [], conflicts: [], language: 'en', sources: [] });
  n0 = calls.length; const rs2 = await call(eL, '/ask', askBody('Which UGREEN charger is better for a laptop and phone? (s2)', STAGE_B), { token: tL });
  const eReq = calls[n0], ePr = schemaOf(eReq).properties;
  chk('G2 English request gets the English schema: natural English only, no Taglish wording, language pinned to en',
    rs2.status === 200 && /^Natural, plain English only\./.test(ePr.reply.description) && /English/.test(ePr.picks.items.properties.reason.description) && /English/.test(ePr.cannot_confirm.items.description) &&
    !/Taglish/.test(JSON.stringify(schemaOf(eReq))) && JSON.stringify(ePr.language.enum) === '["en"]', ePr);
  chk('G3 Taglish requirement is the very first line of the instructions; English requests start with the English requirement',
    sysOf(tReq).startsWith('MANDATORY LANGUAGE: Answer in natural conversational Taglish. A pure-English reply is invalid.') &&
    sysOf(eReq).startsWith('MANDATORY LANGUAGE: Answer in natural, plain English only.') && /You are VERO/.test(sysOf(tReq).split('\n')[1]));
  const uT = userOf(tReq).replace(/^\[?\{?"?(role"?:"?user"?,"?content"?:"?)?/, '');
  chk('G4 Taglish requirement is at the start of the user input (before PRODUCTS) and the end reminder is kept',
    userOf(tReq).indexOf('MANDATORY LANGUAGE: Answer in natural conversational Taglish') >= 0 && userOf(tReq).indexOf('MANDATORY LANGUAGE') < userOf(tReq).indexOf('PRODUCTS:') &&
    (P !== 'openai' || String(tReq.input).startsWith('MANDATORY LANGUAGE: Answer in natural conversational Taglish')) && /REPLY LANGUAGE: Taglish/.test(userOf(tReq)) &&
    /^MANDATORY LANGUAGE: Answer in natural, plain English only\./.test(P === 'openai' ? String(eReq.input) : 'MANDATORY LANGUAGE: Answer in natural, plain English only.') && /REPLY LANGUAGE: English/.test(userOf(eReq)));
  chk('G5 P1-P8 / S1-S6 / basis / confidence enums, required fields, limits and strict-mode shape unchanged in both language schemas',
    [W.COMPOSE_SCHEMAS.taglish, W.COMPOSE_SCHEMAS.en, tSch].every(sc => sameExceptLang(sc) && strictOk2(sc) &&
      JSON.stringify(sc.properties.picks.items.properties.ref.enum) === JSON.stringify(['P1','P2','P3','P4','P5','P6','P7','P8']) &&
      JSON.stringify(sc.properties.sources.items.properties.ref.enum) === JSON.stringify(['S1','S2','S3','S4','S5','S6']) &&
      /at most 600 characters/i.test(sc.properties.reply.description) && /No prices, no URLs, no item codes/.test(sc.properties.reply.description) && /At most 200 characters/.test(sc.properties.picks.items.properties.reason.description)));
  chk('G6 base schema and the shared rule text are untouched (security/pricing/source/candidate rules identical for both languages)',
    JSON.stringify(base.properties.language.enum) === '["en","taglish"]' && sysOf(tReq).split('\n').slice(1).join('\n') === sysOf(eReq).split('\n').slice(1).join('\n') &&
    /Never state or estimate prices/.test(sysOf(tReq)) && /Choose only from the listed products P1-P8/.test(sysOf(tReq)) && /web_verified/.test(sysOf(tReq)));
  // G7 pricing / codes still stripped from a Taglish answer
  reset(); composeHandler = () => composeReply({ reply: 'Mas okay ang P1, ₱1,299 lang at item 55555, tingnan sa https://evil.example', picks: [{ ref: 'P1', reason: 'Mura lang, PHP 999', basis: 'web_verified' }, { ref: 'P9', reason: 'x', basis: 'product_data' }], confidence: 'high', cannot_confirm: [], conflicts: [], language: 'taglish', sources: [] });
  const rs7 = await call(eL, '/ask', askBody('Alin mas okay sa travel kung laptop at phone? (s7)', STAGE_B), { token: tL });
  chk('G7 Taglish path: prices, URLs and stray codes still removed; out-of-range pick dropped; web_verified downgraded on catalog route',
    rs7.j.ok && !/₱|PHP|1,299|999|55555|https?:/.test(rs7.j.reply + rs7.j.picks.map(x => x.reason).join(' ')) && rs7.j.picks.length === 1 && rs7.j.picks[0].basis === 'general_guidance' && rs7.j.language === 'taglish', rs7.j);

  // T: word-boundary truncation
  const STAGEB_NOTE = 'Laptop and phone compatibility and charging speeds depend on their charging requirements and the port-sharing power distribution.';
  const cut = W.cutAtWord(STAGEB_NOTE, 120);
  const isWordCut = (src, out) => out.length > 0 && src.startsWith(out) && (src.length === out.length || /[\s,;:]/.test(src[out.length]));
  chk('T1 Stage B note (>120) cut at the previous word boundary, not mid-word ("…power dist" before)', cut.length <= 120 && isWordCut(STAGEB_NOTE, cut) && /power$/.test(cut) && !/dist$/.test(cut), cut);
  chk('T2 text within the limit unchanged', W.cutAtWord('Short note.', 120) === 'Short note.' && W.cutAtWord('x'.repeat(120), 120) === 'x'.repeat(120));
  chk('T3 limit falling exactly at a space keeps every whole word', W.cutAtWord('alpha beta gamma', 10) === 'alpha beta');
  chk('T4 trailing separators dropped, nothing added (no ellipsis)', W.cutAtWord('one two, three four', 9) === 'one two' && !/…|\.\.\.$/.test(W.cutAtWord(STAGEB_NOTE, 60)));
  chk('T5 single word longer than the limit -> empty (dropped), never half a word', W.cutAtWord('x'.repeat(300), 120) === '');
  chk('T6 hyphenated word is not split at the hyphen', W.cutAtWord('Supports USB-C PD fast charging', 12) === 'Supports');
  { const words = []; for (let i = 0; i < 400; i++) words.push(['USB-C', 'charging', 'a', 'MacBook', 'power-delivery', 'is', 'compatible,', 'dual'][i % 8]);
    const src = words.join(' '); let ok = true;
    for (const n of [7, 31, 60, 119, 120, 121, 199, 200, 599, 600]) { const o = W.cutAtWord(src, n); if (!(o.length <= n && isWordCut(src, o.replace(/[,;:]$/, '')) )) ok = false; }
    chk('T7 sweep over limits 7…600: always ≤ limit and always ends on a whole word', ok); }
  // T8 applied through validateCompose to reasons (200), cannot_confirm/conflicts (120) and reply (600)
  const longReason = ('Compact charger that handles a laptop and a phone together ').repeat(6);
  const v = W.validateCompose({ reply: ('Good travel pick for laptops ').repeat(30), picks: [{ ref: 'P1', reason: longReason, basis: 'product_data' }], confidence: 'medium',
    cannot_confirm: [STAGEB_NOTE], conflicts: [STAGEB_NOTE], language: 'en', sources: [] }, ['10334'], [], 'catalog', new Set(), ['Charger A'], 'en');
  chk('T8 reply/reasons/notes all cut at word boundaries within 600/200/120',
    v.reply.length <= 600 && isWordCut(('Good travel pick for laptops ').repeat(30).trim(), v.reply) &&
    v.picks[0].reason.length <= 200 && isWordCut(longReason.trim(), v.picks[0].reason) &&
    v.cannot_confirm[0] === cut && v.conflicts[0] === cut, v);
}

/* ---------------- CPU measurement (local Node, indicative only) ---------------- */

function cpuMs(fn) { return async () => { const a = process.cpuUsage(); await fn(); const b = process.cpuUsage(a); return (b.user + b.system) / 1000; }; }
reset(); env = mkEnv({ CODE_PER_MIN: '1000', IP_PER_MIN: '1000', CODE_PER_DAY: '1000', IP_PER_DAY: '1000', GLOBAL_PER_DAY: '1000' }); tok = await login(env, 'c_cpu');
const cold = [], warm = [], cache = [];
for (let i = 0; i < 5; i++) { W._resetCatalogForTests(); cold.push(await cpuMs(() => call(env, '/ask', askBody('which is better for travel cold ' + i + '?'), { token: tok }))()); }
for (let i = 0; i < 20; i++) warm.push(await cpuMs(() => call(env, '/ask', askBody('which is better for travel warm ' + i + '?'), { token: tok }))());
for (let i = 0; i < 5; i++) cache.push(await cpuMs(() => call(env, '/ask', askBody('which is better for travel warm 0?'), { token: tok }))());
const med = a => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)].toFixed(1), mx = a => Math.max(...a).toFixed(1);
console.log(`\nLOCAL CPU (Node process, includes test harness + SQLite; Cloudflare will differ): cold median ${med(cold)} ms max ${mx(cold)} | warm median ${med(warm)} ms max ${mx(warm)} | cache median ${med(cache)} ms`);

console.log('\n[provider=' + P + '] ' + pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('FAILURES:\n- ' + failures.join('\n- ')); process.exitCode = 1; }
