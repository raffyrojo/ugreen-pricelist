/* ugreen-pricelist-cms Worker tests (B1a, owner-approved 2026-10-20). Run: node tests/cms-worker.test.mjs
 * Runs the real backend/worker.js against in-memory KV fakes and a fake GitHub Contents API (no network, no secret).
 * Covers: the constant-time admin save-password check on all 4 admin routes (publish, resetTrending, dealersGet,
 * dealersSave) incl. fail-closed on a missing secret; track hardening (Origin, size, item-code / term validation, PII
 * drop, de-duplication, caps, no write when nothing is valid); the public ?searches=1 count threshold; unchanged GET
 * shapes; fix round 1 (FR1 charset, FR2 NFC, FR3 null-prototype numeric counters, FR4 byte size, FR5 7-digit phone rule, FR6
 * code-unit secret hashing). Each mutant of the hardening (re-built from the real source) must make at least one check fail. */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(path.join(ROOT, 'backend/worker.js'), 'utf8');
const ORIGIN = 'https://raffyrojo.github.io';
const SECRET = 'test-Säve-secret-ñ-0123456789';   // test value only (unicode on purpose)

class KV {
  constructor(init) { this.m = new Map(Object.entries(init || {}).map(([k, v]) => [k, JSON.stringify(v)])); this.puts = 0; this.deletes = 0; }
  async get(k, type) { const v = this.m.get(k); return v == null ? null : (type === 'json' ? JSON.parse(v) : v); }
  async put(k, v) { this.puts++; this.m.set(k, String(v)); }
  async delete(k) { this.deletes++; this.m.delete(k); }
}
const today = () => 'v:' + new Date().toISOString().slice(0, 10);
const dayAgo = n => 'v:' + new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

function makeEnv(over) {
  return Object.assign({ ALLOW_ORIGIN: ORIGIN, GH_OWNER: 'o', GH_REPO: 'r', GH_BRANCH: 'main', GITHUB_TOKEN: 'gh-test-token',
    ADMIN_SAVE_SECRET: SECRET, TRENDING: new KV(), DEALERS: new KV({ dealers: [{ id: 'd1', name: 'D', username: 'u', password: 'p', discountPct: 10, active: true, skus: ['45514B'] }] }) }, over || {});
}
let ghCalls = [];
globalThis.fetch = async (url, opts) => {   /* fake GitHub Contents API */
  ghCalls.push([opts && opts.method || 'GET', String(url)]);
  if (!opts || !opts.method || opts.method === 'GET') return new Response(JSON.stringify({ sha: 'oldsha' }), { status: 200 });
  return new Response(JSON.stringify({ commit: { sha: 'newcommitsha' } }), { status: 200 });
};
const post = (body, headers) => new Request('https://cms.example.invalid/', { method: 'POST', headers: Object.assign({ 'content-type': 'text/plain' }, headers || {}), body: typeof body === 'string' ? body : JSON.stringify(body) });
const get = q => new Request('https://cms.example.invalid/?' + q, { method: 'GET' });
const body = async r => { try { return JSON.parse(await r.text()); } catch (_) { return null; } };

async function suite(worker, src) {
  const F = [];
  const ck = (name, cond, extra) => { if (!cond) F.push(name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); };

  /* ---- A. admin save password: identical acceptance on all 4 routes; fails closed ---- */
  const routes = {
    publish: pw => ({ password: pw, products: [{ item_code: 'X1' }], message: 'test' }),
    resetTrending: pw => ({ action: 'resetTrending', password: pw }),
    dealersGet: pw => ({ action: 'dealersGet', password: pw }),
    dealersSave: pw => ({ action: 'dealersSave', password: pw, dealers: [{ id: 'd1', name: 'D', username: 'u', password: 'p', discountPct: 10 }] })
  };
  const wrong = ['', 'x', SECRET.slice(0, -1), SECRET + 'x', SECRET.toUpperCase(), ' ' + SECRET, 'undefined', 'null'];
  for (const [rt, mk] of Object.entries(routes)) {
    ghCalls = [];
    const env = makeEnv();
    const ok = await worker.fetch(post(mk(SECRET), { origin: ORIGIN }), env);
    ck(`A.${rt} correct password accepted (200)`, ok.status === 200, ok.status);
    for (const w of wrong) { const r = await worker.fetch(post(mk(w), { origin: ORIGIN }), makeEnv()); ck(`A.${rt} wrong password ${JSON.stringify(w)} -> 401`, r.status === 401, r.status); }
    const nonStr = await worker.fetch(post(mk(12345), {}), makeEnv({ ADMIN_SAVE_SECRET: '12345' }));
    ck(`A.${rt} non-string password never matches`, nonStr.status === 401, nonStr.status);
    const noPw = await worker.fetch(post(Object.assign(mk(SECRET), { password: undefined })), makeEnv());
    ck(`A.${rt} missing password -> 401`, noPw.status === 401, noPw.status);
    for (const missing of [undefined, '', null]) {
      for (const pw of ['undefined', '', 'null', SECRET]) {
        const r = await worker.fetch(post(mk(pw)), makeEnv({ ADMIN_SAVE_SECRET: missing }));
        ck(`A.${rt} secret ${JSON.stringify(missing)} + password ${JSON.stringify(pw)} fails closed`, r.status === 401, r.status);
      }
    }
  }
  /* FR6: digest equality is exactly the old === (lone surrogates are not folded into U+FFFD) */
  for (const [sec, pw, want] of [['�', '\ud800', 401], ['ab�cd', 'ab\udc00cd', 401], ['ab\ud800cd', 'ab\ud800cd', 200], ['🔌key', '🔌key', 200]]) {
    const r6 = await worker.fetch(post(routes.resetTrending(pw)), makeEnv({ ADMIN_SAVE_SECRET: sec }));
    ck(`FR6.secret ${JSON.stringify(sec)} vs password ${JSON.stringify(pw)} -> ${want} (same as the old === check)`, r6.status === want, r6.status);
  }
  /* publish happy path still commits through the Contents API */
  ghCalls = [];
  const pub = await worker.fetch(post(routes.publish(SECRET)), makeEnv());
  const pj = await body(pub);
  ck('A.publish returns ok + commit sha', pub.status === 200 && pj && pj.ok === true && pj.commit === 'newcommitsha', pj);
  ck('A.publish PUTs data/products.json', ghCalls.some(([m, u]) => m === 'PUT' && /contents\/data\/products\.json$/.test(u)), ghCalls);
  ck('A.static: no `!== env.ADMIN_SAVE_SECRET` comparison left', !/!==\s*env\.ADMIN_SAVE_SECRET/.test(src));
  ck('A.static: 4 secretOk call sites', (src.match(/await secretOk\(payload\.password, env\.ADMIN_SAVE_SECRET\)/g) || []).length === 4);

  /* ---- B. track hardening ---- */
  const tr = (views, searches) => ({ action: 'track', events: { views, searches } });
  let env = makeEnv(); let r = await worker.fetch(post(tr(['45514B', '25870'], ['usb-c 65w', "2.5'' sata", 'cargador rápido ñ']), { origin: ORIGIN }), env);
  let j = await body(r); let day = await env.TRENDING.get(today(), 'json');
  ck('B.valid views + terms accepted', r.status === 200 && j.ok && day && day.views['45514B'] === 1 && day.views['25870'] === 1 && day.searches['usb-c 65w'] === 1 && day.searches["2.5'' sata"] === 1 && day.searches['cargador rápido ñ'] === 1, { j, day });
  env = makeEnv(); r = await worker.fetch(post(tr(['45514B'], ['hdmi cable'])), env);
  ck('B.no Origin header -> accepted', r.status === 200 && env.TRENDING.puts === 1, r.status);
  env = makeEnv(); r = await worker.fetch(post(tr(['45514B'], ['hdmi cable']), { origin: 'https://evil.example' }), env);
  ck('B.foreign Origin -> 403, no KV access', r.status === 403 && env.TRENDING.puts === 0, { s: r.status, puts: env.TRENDING.puts });
  const big = JSON.stringify(tr(['45514B'], Array(2000).fill('hdmi cable')));
  env = makeEnv(); r = await worker.fetch(post(big, { origin: ORIGIN }), env);
  ck('B.body > 16 KB -> 413, no write', big.length > 16384 && r.status === 413 && env.TRENDING.puts === 0, { len: big.length, s: r.status, puts: env.TRENDING.puts });
  const edge = JSON.stringify(tr(['45514B'], ['hdmi cable'])).replace('}}', '}' + ' '.repeat(16384 - JSON.stringify(tr(['45514B'], ['hdmi cable'])).length) + '}');
  env = makeEnv(); r = await worker.fetch(post(edge), env);
  ck('B.body of exactly 16 KB still accepted', edge.length === 16384 && r.status === 200 && env.TRENDING.puts === 1, { len: edge.length, s: r.status });
  const badCodes = ['<script>', 'A'.repeat(21), 'AB CD', 'x"y', '', 12345, null, { a: 1 }, '__proto__'];
  const badTerms = ['ab', 'x'.repeat(61), 'mail me@x.com', 'sales@ugreen.com', 'call 0917 123 4567', '+63 917 123 4567', 'code 1234567', 'tel 8123 4567', 'tel 8123-4567', '<img src=x>', 12345, null, 'semi;colon', 'emoji \u{1F50C} plug'];
  env = makeEnv(); r = await worker.fetch(post(tr(badCodes, badTerms), { origin: ORIGIN }), env); j = await body(r);
  ck('B.all-invalid payload -> empty, no KV read/write', r.status === 200 && j.empty === true && env.TRENDING.puts === 0, { j, puts: env.TRENDING.puts });
  env = makeEnv(); r = await worker.fetch(post(tr(['45514B'].concat(badCodes), ['hdmi cable'].concat(badTerms)), { origin: ORIGIN }), env);
  day = await env.TRENDING.get(today(), 'json');
  ck('B.mixed payload keeps only the valid items', day && Object.keys(day.views).join() === '45514B' && Object.keys(day.searches).join() === 'hdmi cable', day);
  ck('B.no prototype pollution', ({}).polluted === undefined && Object.getPrototypeOf({}) === Object.prototype);
  /* ---- fix round 1 (FR1-FR5) ---- */
  const fr1 = ['hdmi 2.0 1*4 splitter', 'dp to hdmi female converter 4k*2k@60hz', 'what charger?', 'charger!', '100% original', '₱500 charger', 'usb_c', 'sata3.0 data cable (90° elbow)', '“quoted” term', 'usb-c 65w 3-in-1', 'saan yung powerbank'];
  env = makeEnv(); r = await worker.fetch(post(tr([], fr1)), env); day = await env.TRENDING.get(today(), 'json');
  ck('FR1.catalogue-style terms with * ° % ? ! ₱ “” @ _ are kept', day && fr1.every(t => day.searches[t] === 1), day && Object.keys(day.searches));
  env = makeEnv(); r = await worker.fetch(post(tr([], ['café charger'])), env); day = await env.TRENDING.get(today(), 'json');
  ck('FR2.terms are NFC-normalised (decomposed accent -> one stored term)', day && day.searches['café charger'] === 1 && Object.keys(day.searches).length === 1, day && Object.keys(day.searches));
  env = makeEnv({ TRENDING: new KV({ [today()]: { views: { constructor: 'function Object() { [native code] }11', valueOf: 2 }, searches: { 'hdmi cable': 'x', 'power bank': 2 } } }) });
  for (let i = 0; i < 4; i++) await worker.fetch(post(tr(['constructor', 'valueOf', 'toString', 'hasOwnProperty'], ['__proto__', 'constructor', 'hdmi cable'])), env);
  day = await env.TRENDING.get(today(), 'json');
  ck('FR3.built-in property names are plain numeric counters; corrupted values reset', day && day.views.constructor === 4 && day.views.valueOf === 6 && day.views.toString === 4 && day.views.hasOwnProperty === 4 && day.searches.constructor === 4 && day.searches['__proto__'] === 4 && day.searches['hdmi cable'] === 4 && day.searches['power bank'] === 2, day);
  r = await worker.fetch(get('trending=1'), env); j = await body(r);
  ck('FR3.?trending=1 sums only numeric counts (no string concatenation)', Array.isArray(j) && j[0] === 'valueOf' && j.every(x => typeof x === 'string'), j);
  r = await worker.fetch(get('searches=1'), env); j = await body(r);
  ck('FR3.?searches=1 with built-in names works', Array.isArray(j) && j.includes('__proto__') && j.includes('constructor') && j.includes('hdmi cable') && !j.includes('power bank'), j);
  env = makeEnv({ TRENDING: new KV({ [today()]: { views: { constructor: 'function Object() { [native code] }11', A1: 2 }, searches: { junk: 'xxx', ok: 2 } },
                                    [dayAgo(1)]: { views: { constructor: 1, A1: 1, B2: 5 }, searches: { junk: 1, ok: 2 } } }) });
  r = await worker.fetch(get('trending=1'), env); j = await body(r);
  ck('FR3.GET sums only numeric stored counts (corrupted bucket values ignored)', Array.isArray(j) && j.join('|') === 'B2|A1|constructor', j);
  r = await worker.fetch(get('searches=1'), env); j = await body(r);
  ck('FR3.?searches=1 threshold uses numeric counts only', Array.isArray(j) && j.join('|') === 'ok', j);
  ck('FR3.Object.prototype untouched', Object.getPrototypeOf({}) === Object.prototype && typeof ({}).constructor === 'function');
  const multi = JSON.stringify(tr(['45514B'], Array.from({ length: 200 }, (_, i) => 'é'.repeat(45) + i)));
  env = makeEnv(); r = await worker.fetch(post(multi), env);
  ck('FR4.size limit counts UTF-8 bytes (multibyte body under 16k chars but over 16 KB -> 413)', multi.length <= 16384 && Buffer.byteLength(multi) > 16384 && r.status === 413 && env.TRENDING.puts === 0, { chars: multi.length, bytes: Buffer.byteLength(multi), s: r.status });
  const many = Array.from({ length: 120 }, (_, i) => 'C' + i), manyT = Array.from({ length: 120 }, (_, i) => 'term ' + i);
  env = makeEnv(); r = await worker.fetch(post(tr(many.concat(many), manyT.concat(manyT)), { origin: ORIGIN }), env); j = await body(r);
  day = await env.TRENDING.get(today(), 'json');
  ck('B.caps: <= 50 views and <= 50 terms per request, de-duplicated', Object.keys(day.views).length === 50 && Object.keys(day.searches).length === 50 && Object.values(day.views).every(n => n === 1), { v: Object.keys(day.views).length, s: Object.keys(day.searches).length });
  ck('B.response reports accepted counts', j && j.accepted && j.accepted.views === 50 && j.accepted.searches === 50, j);
  env = makeEnv(); r = await worker.fetch(post(tr(['45514B', '45514B', '45514B'], ['hdmi cable', 'HDMI cable', ' hdmi  cable'])), env); day = await env.TRENDING.get(today(), 'json');
  ck('B.repeats inside one request count once (a request cannot inflate a term)', day && day.views['45514B'] === 1 && day.searches['hdmi cable'] === 1, day);
  env = makeEnv(); r = await worker.fetch(post(tr(['45514B'], ['  HDMI   Cable  '])), env); day = await env.TRENDING.get(today(), 'json');
  ck('B.terms lowercased + whitespace-collapsed', day && day.searches['hdmi cable'] === 1, day && day.searches);
  env = makeEnv({ TRENDING: undefined }); r = await worker.fetch(post(tr(['45514B'], ['hdmi cable'])), env); j = await body(r);
  ck('B.no KV bound -> safe no-op', r.status === 200 && j.skipped === 'no-kv', j);

  /* ---- C. public GETs ---- */
  env = makeEnv({ TRENDING: new KV({ [today()]: { views: { '45514B': 4, '25870': 1 }, searches: { 'hdmi cable': 2, 'power bank': 1, 'one-off burst': 1, 'charger': 5 } },
                                    [dayAgo(1)]: { views: { '45514B': 1 }, searches: { 'hdmi cable': 1, 'power bank': 1 } } }) });
  r = await worker.fetch(get('searches=1'), env); j = await body(r);
  ck('C.?searches=1 returns only terms with >= 3 counts, most-searched first', Array.isArray(j) && j.join('|') === 'charger|hdmi cable', j);
  r = await worker.fetch(get('trending=1'), env); j = await body(r);
  ck('C.?trending=1 unchanged: all viewed codes, most-viewed first', Array.isArray(j) && j.join('|') === '45514B|25870', j);
  r = await worker.fetch(get('searches=1'), makeEnv({ TRENDING: undefined })); j = await body(r);
  ck('C.no KV -> []', Array.isArray(j) && j.length === 0, j);
  r = await worker.fetch(get(''), makeEnv()); j = await body(r);
  ck('C.plain GET health shape unchanged', j && j.ok === true && j.service === 'ugreen-cms', j);

  /* ---- D. dealer auth (public) unchanged ---- */
  r = await worker.fetch(post({ action: 'dealerAuth', username: 'U', password: 'p' }), makeEnv()); j = await body(r);
  ck('D.dealerAuth unchanged', r.status === 200 && j.ok && j.dealer && j.dealer.id === 'd1' && !('password' in j.dealer), j);
  r = await worker.fetch(post('{not json'), makeEnv()); j = await body(r);
  ck('D.invalid JSON -> 400 unchanged', r.status === 400 && j.error === 'Invalid JSON body', j);
  return F;
}

const tmp = mkdtempSync(path.join(os.tmpdir(), 'cmsw-'));
let n = 0;
async function load(src) { const f = path.join(tmp, 'w' + (n++) + '.mjs'); writeFileSync(f, src); return (await import(pathToFileURL(f).href)).default; }

let pass = 0, fail = 0;
try {
  const real = await suite(await load(SRC), SRC);
  if (real.length) { fail += real.length; real.forEach(x => console.log('FAIL - ' + x)); } else { pass++; console.log('PASS - real worker: all A / B / C / D checks'); }

  const swap = (a, b) => { if (!SRC.includes(a)) throw new Error('mutant anchor missing: ' + a.slice(0, 60)); return SRC.replace(a, b); };
  const MUT = [
    ['M1 Origin check removed', swap("if (origin && env.ALLOW_ORIGIN && origin !== env.ALLOW_ORIGIN) return", 'if (false) return')],
    ['M2 size limit removed', swap('if (rawLength > TRACK_MAX_BYTES) return', 'if (false) return')],
    ['M3 search threshold 1', swap('MIN_SEARCH_COUNT = 3', 'MIN_SEARCH_COUNT = 1')],
    ['M5 phone rule removed', swap(".some(m => m.replace(/\\D/g, '').length >= 7)) return '';", ".some(m => false)) return '';")],
    ['M6 per-request cap 300', SRC.split('.slice(0, TRACK_MAX_ITEMS)').join('.slice(0, 300)')],
    ['M7 secretOk without the missing-secret guard', swap("if (typeof given !== 'string' || !given || typeof secret !== 'string' || !secret) return false;", "given = String(given); secret = String(secret);")],
    ['M8 term charset check removed', swap(' || !TRACK_TERM_RE.test(s)', '')],
    ['M9 code charset check removed', swap("typeof c === 'string' && TRACK_CODE_RE.test(c)", 'c != null && c !== ""')],
    ['M10 compare reverted to !==', SRC.split('!(await secretOk(payload.password, env.ADMIN_SAVE_SECRET))').join('(!payload.password || payload.password !== env.ADMIN_SAVE_SECRET)')],
    ['M11 de-duplication removed', SRC.split('[...new Set(').join('[...(')],
    ['M12 NFC normalisation removed', swap("t.normalize('NFC').toLowerCase()", 't.toLowerCase()')],
    ['M13 plain-object count maps', swap('function _counts(src) {\n  const o = Object.create(null);', 'function _counts(src) {\n  const o = {};')],
    ['M14 size limit by characters', swap('_enc.encode(raw).length)', 'raw.length)')],
    ['M15 phone rule back to 10 digits', swap(".some(m => m.replace(/\\D/g, '').length >= 7)) return '';", ".some(m => m.replace(/\\D/g, '').length >= 10)) return '';")],
    ['M16 secret hashed as UTF-8', SRC.split('_units(given)').join('_enc.encode(given)').split('_units(secret)').join('_enc.encode(secret)')],
    ['M17 email rule removed', swap(' || TRACK_EMAIL_RE.test(s)', '')],
    ['M18 charset without *', swap('#*°%?!', '#°%?!')],
    ['M19 GET totals unguarded', SRC.split('const m = _counts(b.views); for (const c of Object.keys(m)) totals[c] = (totals[c] || 0) + m[c];').join('const m = b.views || {}; for (const c in m) totals[c] = (totals[c] || 0) + m[c];')]
  ];
  let killed = 0;
  for (const [name, msrc] of MUT) {
    const f = await suite(await load(msrc), msrc);
    if (f.length) { killed++; pass++; console.log(`PASS - mutant killed: ${name} (${f.length} check(s) failed, e.g. ${f[0].slice(0, 90)})`); }
    else { fail++; console.log('FAIL - mutant survived: ' + name); }
  }
  console.log(`CMS Worker (checks + mutants ${killed}/${MUT.length}): ${pass} passed, ${fail} failed`);
} catch (e) { fail++; console.log('FAIL - harness error: ' + (e && e.stack || e)); console.log(`CMS Worker: ${pass} passed, ${fail} failed`); }
finally { rmSync(tmp, { recursive: true, force: true }); }
process.exit(fail ? 1 : 0);
