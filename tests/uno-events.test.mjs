/* ugreen-vero UNO events tests (B2a, owner-approved 2026-10-21; owner D3 / D4 / D5 / D14 / D18, B2-Q1…Q6, plan
 * docs/plans/UNO-B2-Implementation-Plan-2026-10-21.md in the outer project folder). Run: node tests/uno-events.test.mjs
 * Runs the real backend/vero/worker.js against the real D1 migrations 0001–0003 on an in-memory SQLite (node:sqlite); no network,
 * no provider, no secret (test values only). Covers POST /events: kill switch first (no body read, no D1 statement), Origin / size /
 * method guards, schema and enum validation, redaction (emails, phones, digit runs, access-code-like tokens), catalogue code filter
 * and derived category, server time and catalogue-ETag stamp, rate limits (in-isolate + D1 counters, dropped counts), feedback
 * without text, nothing private stored; cleanupUno rollup (idempotent), 30 / 400-day retention, and cleanup tolerating a database
 * without the 0003 tables. Each mutant of the B2a logic (re-built from the real source in a temp folder) must make a check fail. */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(path.join(ROOT, 'backend/vero/worker.js'), 'utf8');
const MIG = ['0001_init.sql', '0002_product_text_cache.sql', '0003_uno_events.sql'].map(f => readFileSync(path.join(ROOT, 'backend/vero/migrations', f), 'utf8'));
const ORIGIN = 'https://raffyrojo.github.io';
const KEY = 'test-signing-key-0123456789abcdef-xyz';   // test value only
const ETAG = 'W/"etag-test-1"';
const UNO_COLS = 'id,ts,day,sid,seq,role,engine,data_ver,data_checked_at,q_redacted,chip,type,outcome,codes,n_codes,category,route,ai_trigger,lang,followup,act';

/* ---------------- D1 adapter over node:sqlite (same shape as tests/uno-admin-auth.test.mjs) ---------------- */
class Stmt {
  constructor(db, sql, params) { this.db = db; this.sql = sql; this.params = params || []; }
  bind(...a) { if (a.length > 100) throw new Error('D1: too many bound parameters (' + a.length + ' > 100)'); return new Stmt(this.db, this.sql, a.map(v => (v === undefined ? null : v))); }
  _all() { return this.db.prepare(this.sql).all(...this.params); }
  async first(col) { const r = this._all(); return r.length ? (col ? r[0][col] : r[0]) : null; }
  async all() { return { results: this._all(), success: true }; }
  async run() { const i = this.db.prepare(this.sql).run(...this.params); return { success: true, meta: { changes: i.changes } }; }
}
class FakeD1 {
  constructor(n) { this.db = new DatabaseSync(':memory:'); MIG.slice(0, n || 3).forEach(s => this.db.exec(s)); this.sqlLog = []; this.batches = 0; }
  prepare(sql) { this.sqlLog.push(sql); return new Stmt(this.db, sql); }
  async batch(stmts) { this.batches++; if (this.yieldFirst) await new Promise(r => setTimeout(r, 0)); this.db.exec('BEGIN'); try { const out = stmts.map(s => ({ results: s._all(), success: true })); this.db.exec('COMMIT'); return out; } catch (e) { this.db.exec('ROLLBACK'); throw e; } }
  q(sql, ...p) { return this.db.prepare(sql).all(...p); }
}
globalThis.fetch = async url => { throw new Error('unexpected fetch ' + url); };   // /events must never touch the network

const mkEnv = (over, nMig) => Object.assign({ DB: new FakeD1(nMig), EVENTS_ENABLED: 'true', AI_ENABLED: 'true', WEB_ENABLED: 'true', TOKEN_SIGNING_KEY: KEY,
  IP_HASH_SALT: 'salt', ALLOW_ORIGIN: ORIGIN }, over || {});
function seed(env, t) {
  const ins = env.DB.db.prepare('INSERT INTO product_text (item_code, version, name, category) VALUES (?, ?, ?, ?)');
  [['25870', 'Mobile: Charger'], ['15570', 'Mobile: Charger'], ['40189', 'A&V: Video Capture']].forEach(([k, g]) => ins.run(k, ETAG, 'n' + k, g));
  env.DB.db.prepare("INSERT INTO meta (k, v) VALUES ('catalog_version', ?), ('catalog_checked_at', ?)").run(ETAG, String(t));
}
const SID = 'Sid_0123456789abcdef', SID2 = 'Sid2_abcdefghijklmnop';
const qev = o => Object.assign({ kind: 'q', seq: 1, q: 'may nexode 65w ba?', chip: false, type: 'list', outcome: 'answered', codes: ['25870'], n_codes: 1,
  route: 'local', ai_trigger: 'none', lang: 'tl', followup: false, act: 'none' }, o || {});
const batch = (ev, o) => Object.assign({ v: 1, sid: SID, role: 'anon', engine: 'p2r3a', ev }, o || {});

let LOGS = [], CHECKS = 0;
const _log = console.log;
const tmp = mkdtempSync(path.join(os.tmpdir(), 'unoevents-'));
let nMod = 0;
async function load(src) { const f = path.join(tmp, 'w' + (nMod++) + '.mjs'); writeFileSync(f, src); return import(pathToFileURL(f).href); }

/* One full run of every check against a worker module (W) and a second, independent isolate of the same source (W2). */
async function suite(W, W2, W3, W4, out) {
  const failed = [];
  let ipN = 0;   // every call gets its own client IP unless a test names one (the per-IP minute limit is per isolate)
  const chk = (n, c, x) => { if (out) CHECKS++; if (c) { if (out) _log('PASS - ' + n); } else { failed.push(n); if (out) _log('FAIL - ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x).slice(0, 300) : '')); } };
  async function call(env, p, body, opts) {
    opts = opts || {};
    const headers = { 'content-type': opts.ctype || 'text/plain;charset=UTF-8', origin: opts.origin === undefined ? ORIGIN : opts.origin, 'cf-connecting-ip': opts.ip || ('10.9.' + Math.floor(++ipN / 250) + '.' + (ipN % 250)) };
    if (opts.len !== undefined) headers['content-length'] = String(opts.len);
    const method = opts.method || 'POST';
    const req = new Request('https://ugreen-vero.test' + p, { method, headers, body: method === 'GET' || method === 'OPTIONS' ? undefined : (opts.raw !== undefined ? opts.raw : JSON.stringify(body || {})) });
    const pend = []; const res = await (opts.W || W).default.fetch(req, env, { waitUntil: x => pend.push(x) }); await Promise.all(pend);
    const text = await res.text(); let j = null; try { j = JSON.parse(text); } catch (_) {}
    return { status: res.status, j, text, headers: res.headers };
  }
  const ipHash = async (ip, t) => (await W.sha256hex(ip + '|salt|' + W.manilaDay(t, 480))).slice(0, 16);
  const ev = env => env.DB.q('SELECT * FROM uno_events ORDER BY id');
  const dump = env => JSON.stringify([env.DB.q('SELECT * FROM uno_events'), env.DB.q('SELECT * FROM uno_feedback'), env.DB.q('SELECT * FROM uno_daily')]);

  LOGS = []; console.log = (...a) => { LOGS.push(a.map(String).join(' ')); };
  try {
    const t = Date.now();
    let env, r;

    /* ---- E1 kill switch ---- */
    for (const v of [undefined, 'false', 'TRUE', ' true', '1', 'yes']) {
      env = mkEnv({ EVENTS_ENABLED: v }); seed(env, t); env.DB.sqlLog = [];
      r = await call(env, '/events', batch([qev()]));
      chk(`E1 EVENTS_ENABLED=${JSON.stringify(v)} -> 503 events_off, 0 D1 statements, nothing stored`, r.status === 503 && r.j && r.j.error === 'events_off'
        && env.DB.sqlLog.length === 0 && ev(env).length === 0, { s: r.status, j: r.j, sql: env.DB.sqlLog.length });
    }
    env = mkEnv({ EVENTS_ENABLED: undefined }); env.DB.sqlLog = [];
    r = await call(env, '/events', null, { raw: '{not json' });
    chk('E1b kill switch answers before the body is parsed (bad JSON still 503 events_off)', r.status === 503 && r.j.error === 'events_off' && env.DB.sqlLog.length === 0);
    { const e0 = mkEnv({ EVENTS_ENABLED: undefined }); e0.DB.sqlLog = []; const r0 = await call(e0, '/events', { v: 2, sid: 'x', ev: 'nope' });
      chk('E1e kill switch answers before the schema check (invalid body, switch off -> 503 events_off)', r0.status === 503 && r0.j.error === 'events_off' && e0.DB.sqlLog.length === 0, r0.j); }
    chk('E1c cfg(): eventsEnabled only for exactly "true"', W.cfg({ EVENTS_ENABLED: 'true' }).eventsEnabled === true && W.cfg({}).eventsEnabled === false && W.cfg({ EVENTS_ENABLED: 'True' }).eventsEnabled === false);

    /* ---- E2 guards ---- */
    env = mkEnv(); seed(env, t); env.DB.sqlLog = [];
    r = await call(env, '/events', batch([qev()]), { origin: 'https://evil.example' });
    chk('E2 foreign Origin -> 403, 0 D1 statements', r.status === 403 && r.j.error === 'forbidden_origin' && env.DB.sqlLog.length === 0);
    r = await call(env, '/events', null, { method: 'GET' });
    chk('E2b GET /events -> 405', r.status === 405);
    r = await call(env, '/events', null, { raw: 'x'.repeat(5000), len: 5000 });
    chk('E2c content-length > 4096 -> 413', r.status === 413 && r.j.error === 'too_large');
    const big = JSON.stringify(batch([qev({ q: 'ñ'.repeat(150) })])) + ' '.repeat(4000);
    r = await call(env, '/events', null, { raw: big });
    chk('E2d actual body > 4096 UTF-8 bytes without a content-length -> 413, nothing stored', r.status === 413 && ev(env).length === 0, r.j);
    r = await call(env, '/events', null, { raw: big, len: 100 });
    chk('E2e actual body > 4096 with a lying content-length -> 413', r.status === 413);
    const exact = JSON.stringify(batch([qev()])); r = await call(env, '/events', null, { raw: exact + ' '.repeat(4096 - Buffer.byteLength(exact)) });
    chk('E2f body of exactly 4096 bytes accepted', r.status === 200 && r.j.ok === true, r.j);
    r = await call(env, '/events', null, { raw: exact + ' '.repeat(4097 - Buffer.byteLength(exact)) });
    chk('E2g body of 4097 bytes (no content-length) -> 413', r.status === 413, r.j);
    { const e0 = mkEnv({ EVENTS_ENABLED: undefined }); let pulled = false;
      const body = new ReadableStream({ pull(ctl) { pulled = true; ctl.error(new Error('body read')); } });
      const res = await W.default.fetch(new Request('https://ugreen-vero.test/events', { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'text/plain' }, body, duplex: 'half' }), e0, { waitUntil: () => {} });
      const jj = await res.json().catch(() => ({}));
      chk('E1d kill switch answers before the body is read (an unreadable body still gets 503 events_off)', res.status === 503 && jj.error === 'events_off', { s: res.status, jj, pulled }); }   // a body read would throw -> 503 unavailable
    r = await call(env, '/events', null, { method: 'OPTIONS' });
    chk('E10 OPTIONS preflight unchanged (204, CORS = live origin)', r.status === 204 && r.headers.get('access-control-allow-origin') === ORIGIN);
    r = await call(env, '/events', batch([qev()]), { ctype: 'application/json' });
    chk('E10b application/json accepted too', r.status === 200 && r.j.stored === 1);
    chk('E10c success response {ok, stored} + no-store + CORS', JSON.stringify(Object.keys(r.j).sort()) === '["ok","stored"]' && r.headers.get('cache-control') === 'no-store'
      && r.headers.get('access-control-allow-origin') === ORIGIN);

    /* ---- E3 schema ---- */
    env = mkEnv(); seed(env, t);
    const bad = [['bad JSON', null, '{x'], ['v 2', batch([qev()], { v: 2 })], ['short sid', batch([qev()], { sid: 'abc' })], ['sid with space', batch([qev()], { sid: 'Sid 0123456789abcdef' })],
      ['role boss', batch([qev()], { role: 'boss' })], ['engine with /', batch([qev()], { engine: 'a/b' })], ['ev empty', batch([])], ['ev 13 items', batch(Array.from({ length: 13 }, (_, i) => qev({ seq: i })))],
      ['ev not array', batch({ kind: 'q' })], ['all events invalid', batch([qev({ outcome: 'great' }), qev({ seq: 1000 }), qev({ type: 'x' }), qev({ kind: 'zzz' }), qev({ q: 42 }), qev({ q: '   ' })])]];
    for (const [name, body, raw] of bad) {
      r = await call(env, '/events', body, raw !== undefined ? { raw } : {});
      chk(`E3 ${name} -> 400 bad_request`, r.status === 400 && r.j.error === 'bad_request', r.j);
    }
    chk('E3b nothing stored by the rejected batches', ev(env).length === 0);
    r = await call(env, '/events', batch([qev({ seq: 1 }), qev({ seq: 2, outcome: 'nope' }), qev({ seq: 3, route: 'mars', lang: 'fr', act: 'zap', ai_trigger: 'x' })]));
    let rows = ev(env);
    chk('E3c invalid events dropped, valid stored; bad optional enums fall back (local / en / none / none)', r.status === 200 && r.j.stored === 2 && rows.length === 2
      && rows[1].seq === 3 && rows[1].route === 'local' && rows[1].lang === 'en' && rows[1].act === 'none' && rows[1].ai_trigger === 'none', rows);
    env = mkEnv(); seed(env, t);
    const MARK = 'ZZMARKZZ';
    r = await call(env, '/events', batch([qev({ srp: MARK, dp: MARK, price: MARK, dealer: MARK, username: MARK, mode: MARK, token: MARK, ip: MARK, ua: MARK, reply: MARK, ts: '1999-01-01T00:00:00Z' })],
      { dealer: MARK, username: MARK, token: MARK, ip: MARK }));
    rows = ev(env);
    chk('E3d injected price / dealer / username / mode / token / ip / reply keys never stored', r.status === 200 && !dump(env).includes(MARK) && !LOGS.join('\n').includes(MARK));
    chk('E3e uno_events row has exactly the 0003 columns (no ip / agent / price / dealer column)', rows.length === 1 && Object.keys(rows[0]).join(',') === UNO_COLS, Object.keys(rows[0] || {}));

    /* ---- E4 redaction ---- */
    env = mkEnv(); seed(env, t);
    const corpus = [
      ['email me at juan.dela@cruz.ph pls', s => s.includes('[email]') && !s.includes('@')],
      ['call 0917 123 4567 about nexode', s => s.includes('[phone]') && !/4567/.test(s)],
      ['+63 917-123-4567 charger', s => s.includes('[phone]') && !/917/.test(s)],
      ['my code VERO-AB12-CD34-EF56-GH78 ok', s => s.includes('[code]') && !/AB12|GH78/.test(s)],
      ['code ab12cd34ef56gh78ij90', s => s.includes('[code]') && !/ab12/.test(s)],
      ['order 12345678901234 status', s => s.includes('[phone]') && !/1234567/.test(s)],
      ['nexode 65w ₱1,299 ñ', s => s === 'nexode 65w ₱1,299 ñ'],
      ['CM498A 25870 X755 charger', s => s === 'CM498A 25870 X755 charger'],
      ['USB-C-to-HDMI-cable-4K-60Hz', s => s === 'USB-C-to-HDMI-cable-4K-60Hz'],
      ['  may   nexode\n\t65w  ', s => s === 'may nexode 65w'],
      ['a'.repeat(400), s => s.length === 120],
      // fix round 1 (FR2 / FR3): every way /session accepts a code, no product-text false positives, control characters
      ['code AB12 CD34 EF56 GH78 IJKL', s => s === '[code]'],
      ['AB12.CD34.EF56.GH78.WXYZ', s => s === '[code]'],
      ['AB12_CD34_EF56_GH78_IJ90', s => s === '[code]'],
      // fix round 2: any separator /session accepts (QA2-B2a-1) and no spec-word false positives (QA2-B2a-2)
      ['VERO/5R2T/AWBH/ZKJX/XYN6/AFXS', s => s === '[code]'],
      ['VERO:5R2T:AWBH:ZKJX:XYN6:AFXS', s => s === '[code]'],
      ['VERO - 5R2T - AWBH - ZKJX - XYN6 - AFXS', s => s === '[code]'],
      ['VERO-5R2TAWBHZK-JXXYN6AFXS', s => s === '[code]'],
      ['5R2T--AWBH--ZKJX--XYN6--AFXS', s => s === '[code]'],
      ['5R2T, AWBH, ZKJX, XYN6, AFXS', s => s === '[code]'],
      ['5R2T+AWBH+ZKJX+XYN6+AFXS', s => s === '[code]'],
      ['5R2T|AWBH|ZKJX|XYN6|AFXS', s => s === '[code]'],
      ['VERO' + String.fromCharCode(0x2013) + ['5R2T', 'AWBH', 'ZKJX', 'XYN6', 'AFXS'].join(String.fromCharCode(0x2013)), s => s === '[code]'],
      ['VERO' + String.fromCharCode(0x2011) + ['5R2T', 'AWBH', 'ZKJX', 'XYN6', 'AFXS'].join(String.fromCharCode(0x2011)), s => s === '[code]'],
      ['my code AB12    CD34    EF56    GH78    IJ90 ok', s => s === 'my [code] ok'],   // the adjacent 4-letter word goes with it (documented)
      ['a '.repeat(54) + 'VERO-5R2T-AWBH-ZKJX-XYN6-AFXS', s => !/5R2T|AWBH|ZKJX|XYN6|AFXS/.test(s)],   // a cut first would leave 'VERO-5R2T-AW'
      ['may usb4 dock with hdmi port ba kayo', s => s === 'may usb4 dock with hdmi port ba kayo'],
      ['need usb4 dock with dual 4k display', s => s === 'need usb4 dock with dual 4k display'],
      ['dock with dual hdmi plus usb4 port', s => s === 'dock with dual hdmi plus usb4 port'],
      ['vero do you have a 65w charger for macbook', s => s === 'vero do you have a 65w charger for macbook'],
      ['may 2230 2242 2260 2280 ssd enclosure ba', s => !s.includes('[code]')],
      ['compatible with 1080P, 1080i, 720P, 576P, 576i, 480P, 480i', s => !s.includes('[code]')],
      ['8K@30Hz : 7680*4320@30Hz, 3840*2160@120Hz', s => !s.includes('[code]')],
      ['1080@60Hz. With this HDMI 2.0 splitter', s => s === '1080@60Hz. With this HDMI 2.0 splitter'],
      ['Frequency Band' + String.fromCharCode(0xFF1A) + '2400MHz-2483.5MHz', s => !s.includes('[code]')],
      ['pang macbook pro 2019 2020 2021 2022 2023', s => !s.includes('[code]')],
      ['VERO-ABCD-EFGH-IJKL-MNOP-QRST no digits', s => s === '[code] no digits'],
      ['VEROABCDEFGHIJKLMNOPQRS1', s => s === '[code]'],
      ['vero 5r2t awbh zkjx xyn6 afxs', s => s === '[code]'],
      [' '.repeat(292) + 'ABCD1234EFGH5678IJKL', s => s === '[code]'],
      ['USB-C-to-HDMI-2.1-cable-8K60-4K120Hz-2m', s => s === 'USB-C-to-HDMI-2.1-cable-8K60-4K120Hz-2m'],
      ['does this have good bass', s => s === 'does this have good bass'],
      ['vero does this have good bass', s => s === 'vero does this have good bass'],
      ['4K60Hz HDMI 2.1 Cable 8K@60Hz 48Gbps 2m', s => s === '4K60Hz HDMI 2.1 Cable 8K@60Hz 48Gbps 2m'],
      ['x\u202Ey\u0000z\u200Bw', s => s === 'xy zw'],
      ['a'.repeat(119) + '\u{1F600}', s => s === 'a'.repeat(119)],
      ['ABCDEFGHJKMNPQRSTVW1', s => s === '[code]'],
      ['10000mAh Magnetic Wireless 20W Power Bank', s => s === '10000mAh Magnetic Wireless 20W Power Bank'],
      ['AC650 11ac Dual-Band Wireless USB Adapter', s => s === 'AC650 11ac Dual-Band Wireless USB Adapter'],
      ['48000mAh 300W Fast Charging Power Bank', s => s === '48000mAh 300W Fast Charging Power Bank'],
    ];
    /* Simulated issued codes (tools/vero-code.mjs format; fixed-seed generator) in every accepted spelling: none may survive. */
    { const AL = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; let seed32 = 12345, leaks = 0, ex = null, n = 0;
      const rnd = () => { seed32 = (seed32 * 1103515245 + 12345) >>> 0; return seed32 >>> 27; };
      for (let i = 0; i < 1500; i++) {
        let body = ''; for (let j = 0; j < 20; j++) body += AL[rnd()];
        const g = body.match(/.{4}/g), digit = /\d/.test(body), letter = /[A-Z]/.test(body);
        // Documented limits (B2a fix round 2): with the VERO prefix every spelling is caught (spaced: if it has a digit); an
        // unprefixed separated code needs 2+ mixed groups, 2+ groups with 2+ letters and at most 1 all-digit group (~1.3 % fail).
        const grp = g.filter(x => /\d/.test(x) && /[A-Z]/.test(x)).length >= 2 && g.filter(x => (x.match(/[A-Z]/g) || []).length >= 2).length >= 2
          && g.filter(x => /^\d+$/.test(x)).length <= 1;
        const D = String.fromCharCode(0x2011), E = String.fromCharCode(0x2013);
        const forms = ['VERO-' + g.join('-'), ('VERO-' + g.join('-')).toLowerCase(), 'VERO' + body, 'VERO.' + g.join('.'), 'VERO_' + g.join('_'),
          'VERO/' + g.join('/'), 'VERO:' + g.join(':'), 'VERO' + E + g.join(E), 'VERO' + D + g.join(D), 'VERO-' + body.slice(0, 10) + '-' + body.slice(10)];
        if (digit) forms.push('VERO ' + g.join(' '), 'VERO - ' + g.join(' - '));
        if (digit && letter) forms.push(body, body.toLowerCase());
        if (grp) forms.push(g.join('-'), g.join('.'), g.join('_'), g.join(' '), g.join(', '), g.join('+'), g.join('|'), g.join('--'));
        for (const f of forms) { n++; const out = W.redactEvent('my code is ' + f + ' ok'); if (out !== 'my code is [code] ok' && out !== 'my code is [code] [code] ok') { leaks++; ex = ex || [f, out]; } }
      }
      chk(`E4c ${n} simulated access-code spellings all redacted`, leaks === 0, ex); }
    for (const [q, ok] of corpus) {
      const got = W.redactEvent(q);
      chk(`E4 redactEvent ${JSON.stringify(q.slice(0, 40))}`, ok(got) && got.length <= 120, got);
    }
    r = await call(env, '/events', batch([qev({ seq: 7, q: 'my code VERO-AB12-CD34-EF56-GH78 and a@b.com' })]));
    rows = ev(env);
    chk('E4b the route stores the redacted text only', r.status === 200 && rows.length === 1 && rows[0].q_redacted.includes('[code]') && rows[0].q_redacted.includes('[email]')
      && !dump(env).includes('AB12') && !dump(env).includes('a@b.com'), rows[0]);

    /* ---- E5 catalogue filter, category, stamps ---- */
    env = mkEnv(); seed(env, t); const tA = Date.now();
    r = await call(env, '/events', batch([qev({ codes: ['25870', '99999', '40189', '15570', 'bad code!', 42], n_codes: 7 }), qev({ seq: 2, codes: [], n_codes: undefined })]));
    rows = ev(env); const tB = Date.now();
    chk('E5 codes kept only if in product_text (order kept), invalid / unknown dropped', rows[0].codes === '25870,40189,15570', rows[0]);
    chk('E5b category = most frequent category of the kept codes', rows[0].category === 'Mobile: Charger' && rows[1].category === null, rows.map(x => x.category));
    chk('E5c n_codes = client count when valid, else kept count', rows[0].n_codes === 7 && rows[1].n_codes === 0);
    chk('E5d data_ver = meta.catalog_version; data_checked_at = ISO of catalog_checked_at', rows[0].data_ver === ETAG && rows[0].data_checked_at === new Date(t).toISOString(), rows[0]);
    chk('E5e ts / day from the server clock (client ts ignored)', Date.parse(rows[0].ts) >= tA - 5 && Date.parse(rows[0].ts) <= tB + 5 && rows[0].day === W.manilaDay(Date.parse(rows[0].ts), 480));
    { const e2 = mkEnv(); r = await call(e2, '/events', batch([qev({ codes: ['25870'] })]));
      const x = ev(e2)[0]; chk('E5f empty catalogue cache -> stored without codes / ETag (no fetch)', r.status === 200 && x.codes === null && x.data_ver === null && x.data_checked_at === null, x); }
    { const e3 = mkEnv(); seed(e3, t); const many = Array.from({ length: 12 }, (_, i) => qev({ seq: i, codes: Array.from({ length: 12 }, (_, j) => (j === 0 ? '25870' : 'C' + i + '-' + j)) }));
      r = await call(e3, '/events', batch(many));
      chk('E5g 144 codes in one batch (> 100 bound parameters) handled', r.status === 200 && r.j.stored === 12 && ev(e3).every(x => x.codes === '25870'), r.j); }
    { const e4 = mkEnv(); seed(e4, t);
      r = await call(e4, '/events', batch([qev({ codes: ['25870', '25870', '25870', '40189'], n_codes: undefined, chip: true, followup: true }), qev({ seq: 2, chip: 'yes', followup: 1 })]));
      const x = ev(e4);
      chk('E5h duplicate codes de-duplicated (n_codes / category from the unique set)', x[0].codes === '25870,40189' && x[0].n_codes === 2, x[0]);
      chk('E5i chip / followup stored only for exact true', x[0].chip === 1 && x[0].followup === 1 && x[1].chip === 0 && x[1].followup === 0, x.map(y => [y.chip, y.followup])); }
    { const e6 = mkEnv(); seed(e6, t);
      const thirteen = Array.from({ length: 12 }, (_, i) => 'Z' + i).concat(['25870']);
      r = await call(e6, '/events', batch([qev({ chip: true, followup: false }), qev({ seq: 2, chip: false, followup: true }), qev({ seq: 3, codes: thirteen, n_codes: undefined }),
        qev({ seq: 4, codes: ['25870'], n_codes: 1000 }), qev({ seq: 5, codes: ['40189', '25870', '15570'] })]));
      const x = ev(e6);
      chk('E5k chip and followup are independent', x[0].chip === 1 && x[0].followup === 0 && x[1].chip === 0 && x[1].followup === 1, x.slice(0, 2).map(y => [y.chip, y.followup]));
      chk('E5l at most 12 codes per event (a 13th is dropped before the catalogue check)', x[2].codes === null && x[2].n_codes === 0, x[2]);
      chk('E5m n_codes above 999 falls back to the kept count', x[3].n_codes === 1, x[3]);
      chk('E5n category = majority category, not the first code', x[4].category === 'Mobile: Charger', x[4]); }
    { const e5 = mkEnv(); seed(e5, t); const real = Date.now, FIX = Date.parse('2026-10-21T17:30:00Z');   // 01:30 on 22 Oct in Manila
      Date.now = () => FIX;
      try { r = await call(e5, '/events', batch([qev()])); } finally { Date.now = real; }
      const x = ev(e5)[0];
      chk('E5j frozen clock: day is the Manila day (2026-10-22), ts = server time', r.status === 200 && x.day === '2026-10-22' && x.ts === new Date(FIX).toISOString(), x && [x.day, x.ts]); }

    /* ---- E6 rate limits + D1 write budget (fix round 1, FR1) ---- */
    const writes = env => env.DB.sqlLog.filter(q => /^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(q)).length;
    env = mkEnv(); seed(env, t);
    let st = [];
    for (let i = 0; i < 7; i++) st.push((await call(env, '/events', batch([qev({ seq: i })]), { ip: '198.51.100.1' })).status);
    chk('E6 per IP: 6 requests / minute accepted, the 7th -> 429 (in-isolate)', st.slice(0, 6).every(s => s === 200) && st[6] === 429, st);
    env.DB.sqlLog = [];
    r = await call(env, '/events', batch([qev()]), { ip: '198.51.100.1' });
    chk('E6b in-isolate refusal makes 0 D1 statements', r.status === 429 && env.DB.sqlLog.length === 0);
    chk('E6c the minute limit lives in memory only (no ev_ip_min counter row in D1)', env.DB.q("SELECT COUNT(*) n FROM counters WHERE scope NOT IN ('ev_ip_day', 'ev_global_day')")[0].n === 0,
      env.DB.q('SELECT scope, n FROM counters'));
    r = await call(env, '/events', batch([qev()]), { ip: '198.51.100.2' });
    chk('E6d another IP is not affected', r.status === 200);
    env = mkEnv(); seed(env, t); env.DB.sqlLog = []; env.DB.batches = 0;
    r = await call(env, '/events', batch([qev()]), { ip: '198.51.100.20' });
    chk('E6j write budget: an accepted 1-event request = 2 batches (1 read, 1 write) and exactly 3 write statements (2 counters + 1 row)', r.status === 200 && env.DB.batches === 2
      && writes(env) === 3, { batches: env.DB.batches, writes: writes(env) });
    chk('E6m daily counters expire no earlier than 36 h ahead (cleanup cannot reset a running day)', env.DB.q("SELECT expires FROM counters WHERE scope IN ('ev_ip_day', 'ev_global_day')")
      .every(x => Date.parse(x.expires) > Date.now() + 36 * 3600000) && env.DB.q("SELECT COUNT(*) n FROM counters")[0].n === 2, env.DB.q('SELECT scope, expires FROM counters'));
    env.DB.sqlLog = [];
    r = await call(env, '/events', batch(Array.from({ length: 12 }, (_, i) => qev({ seq: i }))), { ip: '198.51.100.21' });
    chk('E6k write budget: 12 events = 14 write statements (2 counters + 12 rows); 0003 has no AUTOINCREMENT', r.status === 200 && writes(env) === 14 && !/AUTOINCREMENT\s*[,)]/i.test(MIG[2]), writes(env));
    env = mkEnv(); seed(env, t); const day = W.manilaDay(Date.now(), 480);
    env.DB.db.prepare("INSERT INTO counters (scope, subject, win, n, expires) VALUES ('ev_ip_day', ?, ?, 195, '2999-01-01')").run(await ipHash('198.51.100.3', Date.now()), day);
    env.DB.sqlLog = [];
    r = await call(env, '/events', batch(Array.from({ length: 6 }, (_, i) => qev({ seq: i }))), { ip: '198.51.100.3' });
    const w1 = writes(env), n1 = env.DB.q("SELECT n FROM counters WHERE scope = 'ev_ip_day'")[0].n;
    env.DB.sqlLog = [];
    const r5 = await call(env, '/events', batch([qev()]), { ip: '198.51.100.3', W: W2 });
    const r6 = await call(env, '/events', batch(Array.from({ length: 5 }, (_, i) => qev({ seq: i }))), { ip: '198.51.100.3' });
    chk('E6e per IP per day (D1, across isolates): 195 + 6 > 200 -> 429 nothing stored; +1 in another isolate accepted (196); 196 + 5 > 200 -> 429', r.status === 429 && r5.status === 200 && r6.status === 429 && ev(env).length === 1,
      { a: r.status, b: r5.status, c: r6.status, rows: ev(env).length });
    chk('E6f a per-IP refusal writes only one "dropped" count and leaves the counters unchanged', w1 === 1 && n1 === 195
      && env.DB.q("SELECT n FROM uno_daily WHERE metric = 'dropped'")[0].n === 6, { w1, n1 });
    env.DB.sqlLog = [];
    r = await call(env, '/events', batch(Array.from({ length: 5 }, (_, i) => qev({ seq: i }))), { ip: '198.51.100.3' });
    chk('E6l a second per-IP refusal in the same isolate writes nothing', r.status === 429 && writes(env) === 0, writes(env));
    // E6g runs on the second isolate: its in-isolate 'capped' flag lasts for the rest of the day by design
    env = mkEnv(); seed(env, t);
    env.DB.db.prepare("INSERT INTO counters (scope, subject, win, n, expires) VALUES ('ev_global_day', 'all', ?, 9998, '2999-01-01')").run(day);
    r = await call(env, '/events', batch([qev(), qev({ seq: 2 })]), { ip: '198.51.100.4', W: W2 });
    env.DB.sqlLog = [];
    const rg = await call(env, '/events', batch([qev()]), { ip: '198.51.100.5', W: W2 });
    const wg = writes(env);
    env.DB.sqlLog = [];
    const rg2 = await call(env, '/events', batch([qev()]), { ip: '198.51.100.6', W: W2 });
    chk('E6g global cap 10,000 / day: 9,998 + 2 accepted; the next -> 429 with 0 writes; then refused in-isolate with 0 D1 statements', r.status === 200 && rg.status === 429 && wg === 0
      && rg2.status === 429 && env.DB.sqlLog.length === 0, { a: r.status, b: rg.status, wg, c: rg2.status, sql: env.DB.sqlLog.length });
    // E6i: concurrent requests (third isolate) can never store more rows than the cap allows
    env = mkEnv(); seed(env, t); env.DB.yieldFirst = true;   // every batch waits a macrotask: all 20 reads run before any write (a real race)
    env.DB.db.prepare("INSERT INTO counters (scope, subject, win, n, expires) VALUES ('ev_global_day', 'all', ?, 9995, '2999-01-01')").run(day);
    const par = await Promise.all(Array.from({ length: 20 }, (_, i) => call(env, '/events', batch([qev({ seq: i })]), { ip: '203.0.113.' + (100 + i), W: W3 })));
    chk('E6i 20 parallel requests at 9,995 / 10,000: exactly 5 rows stored, 5 x 200, 15 x 429', ev(env).length === 5 && par.filter(x => x.status === 200).length === 5
      && par.filter(x => x.status === 429).length === 15, { rows: ev(env).length, s: par.map(x => x.status).join('') });
    { const real = Date.now, next = real() + 86400000; const e7 = mkEnv(); seed(e7, t);
      const ec = mkEnv(); seed(ec, t); ec.DB.db.prepare("INSERT INTO counters (scope, subject, win, n, expires) VALUES ('ev_global_day', 'all', ?, 10000, '2999-01-01')").run(day);
      const rc = await call(ec, '/events', batch([qev()]), { ip: '203.0.113.199', W: W3 });   // caps isolate W3 for today
      chk('E6n0 isolate W3 refuses at the global cap (sets its capped flag)', rc.status === 429);
      Date.now = () => next;
      try { r = await call(e7, '/events', batch([qev()]), { ip: '203.0.113.200', W: W3 }); } finally { Date.now = real; }
      chk('E6n the in-isolate "capped" flag ends with the Manila day (next day accepted again)', r.status === 200, r.j); }
    { const e8 = mkEnv(); seed(e8, t); e8.DB.yieldFirst = true;
      e8.DB.db.prepare("INSERT INTO counters (scope, subject, win, n, expires) VALUES ('ev_ip_day', ?, ?, 195, '2999-01-01')").run(await ipHash('198.51.100.77', Date.now()), day);
      const p1 = await Promise.all(Array.from({ length: 6 }, (_, i) => call(e8, '/events', batch([qev({ seq: i })]), { ip: '198.51.100.77', W: W4 })));
      chk('E6o 6 parallel requests from one IP at 195 / 200: exactly 5 rows stored (per-IP half of the insert guard)', ev(e8).length === 5 && p1.filter(x => x.status === 200).length === 5, ev(e8).length); }
    { const e9 = mkEnv(); seed(e9, t); e9.DB.yieldFirst = true;
      e9.DB.db.prepare("INSERT INTO counters (scope, subject, win, n, expires) VALUES ('ev_global_day', 'all', ?, 9995, '2999-01-01')").run(day);
      await Promise.all(Array.from({ length: 20 }, (_, i) => call(e9, '/events', batch([{ kind: 'fb', seq: i, reason: 'other' }]), { ip: '203.0.113.' + (150 + i), W: W4 })));
      chk('E6p 20 parallel feedback requests at 9,995 / 10,000: exactly 5 feedback rows (feedback insert guard)', e9.DB.q('SELECT COUNT(*) n FROM uno_feedback')[0].n === 5,
        e9.DB.q('SELECT COUNT(*) n FROM uno_feedback')[0].n); }
    { const e10 = mkEnv(); seed(e10, t); const st2 = [];
      for (let i = 0; i < 7; i++) { st2.push((await call(e10, '/events', batch([qev({ seq: i })]), { ip: '198.51.100.90' })).status); await call(e10, '/events', batch([qev()]), { ip: '198.51.100.' + (100 + i) }); }
      chk('E6q the per-IP minute limit survives other IPs in the in-memory map (7th from the same IP -> 429)', st2.slice(0, 6).every(x => x === 200) && st2[6] === 429, st2); }
    chk('E6h limit constants', W.EVENTS_MAX_BYTES === 4096 && W.EVENTS_MAX_BATCH === 12 && W.EVENTS_IP_PER_MIN === 6 && W.EVENTS_IP_PER_DAY === 200 && W.EVENTS_GLOBAL_PER_DAY === 10000);

    /* ---- E7 feedback ---- */
    env = mkEnv(); seed(env, t);
    r = await call(env, '/events', batch([{ kind: 'fb', seq: 3, reason: 'wrong_spec', q: MARK + ' text', comment: MARK, codes: ['25870'] }, { kind: 'fb', seq: 4, reason: 'rude' }, { kind: 'fb', seq: 'x', reason: 'other' }]));
    const fb = env.DB.q('SELECT * FROM uno_feedback');
    chk('E7 feedback stored with sid / seq / role / engine / ETag / reason only; bad reason or seq dropped', r.status === 200 && r.j.stored === 1 && fb.length === 1
      && fb[0].reason === 'wrong_spec' && fb[0].seq === 3 && fb[0].sid === SID && fb[0].data_ver === ETAG && ev(env).length === 0, fb);
    chk('E7b feedback text never stored or logged', !dump(env).includes(MARK) && !LOGS.join('\n').includes(MARK));

    /* ---- E12 nothing identifying stored ---- */
    env = mkEnv(); seed(env, t);
    await call(env, '/events', batch([qev()], { role: 'dealer' }), { ip: '192.0.2.77' });
    const h = await ipHash('192.0.2.77', Date.now());
    chk('E12 no IP or IP hash in any uno_* table; role label kept', !dump(env).includes('192.0.2.77') && !dump(env).includes(h) && ev(env)[0].role === 'dealer');
    chk('E12b /events writes no log line', LOGS.length === 0, LOGS);

    /* ---- E8 cleanup: rollup + retention ---- */
    env = mkEnv(); const T = Date.parse('2026-10-21T04:00:00Z'), c = W.cfg(env);
    const dayAgo = d => W.manilaDay(T - d * 86400000, 480);
    const insE = env.DB.db.prepare("INSERT INTO uno_events (ts, day, sid, seq, role, engine, q_redacted, type, outcome, route, ai_trigger, lang, act) VALUES ('x', ?, ?, 1, ?, 'e', 'q', 'list', ?, 'local', 'none', ?, 'none')");
    [[0, 'a', 'anon', 'answered', 'en'], [1, 'a', 'anon', 'answered', 'en'], [1, 'b', 'dealer', 'no_match', 'tl'], [1, 'b', 'dealer', 'answered', 'tl'], [30, 'c', 'anon', 'clarify', 'en'], [31, 'd', 'anon', 'answered', 'en']]
      .forEach(([d, s, role, o, l]) => insE.run(dayAgo(d), s, role, o, l));
    const insF = env.DB.db.prepare("INSERT INTO uno_feedback (ts, day, sid, seq, role, engine, reason) VALUES ('x', ?, 's', 1, 'anon', 'e', ?)");
    insF.run(dayAgo(1), 'wrong_spec'); insF.run(dayAgo(31), 'other');
    env.DB.db.prepare("INSERT INTO uno_daily (day, metric, dim, n) VALUES (?, 'dropped', '', 5), (?, 'outcome', 'answered', 9)").run(dayAgo(400), dayAgo(401));
    await W.cleanupUno(env, c, T);
    const daily = () => JSON.stringify(env.DB.q('SELECT day, metric, dim, n FROM uno_daily ORDER BY day, metric, dim'));
    const g = (d, m, dim) => (env.DB.q('SELECT n FROM uno_daily WHERE day = ? AND metric = ? AND dim = ?', dayAgo(d), m, dim)[0] || {}).n;
    chk('E8 rollup of yesterday: outcome / lang / role / route / feedback / sessions', g(1, 'outcome', 'answered') === 2 && g(1, 'outcome', 'no_match') === 1 && g(1, 'lang', 'tl') === 2
      && g(1, 'role', 'dealer') === 2 && g(1, 'route', 'local') === 3 && g(1, 'feedback', 'wrong_spec') === 1 && g(1, 'sessions', '') === 2, daily());
    chk('E8b today is not rolled up (still in progress)', g(0, 'outcome', 'answered') === undefined);
    chk('E8c days older than 30 were rolled up before their raw rows were deleted', g(31, 'outcome', 'answered') === 1 && g(31, 'feedback', 'other') === 1);
    chk('E8d retention: raw events / feedback older than 30 days deleted, day 30 kept', env.DB.q('SELECT day FROM uno_events ORDER BY day').map(x => x.day).join() === [dayAgo(30), dayAgo(1), dayAgo(1), dayAgo(1), dayAgo(0)].join()
      && env.DB.q('SELECT COUNT(*) n FROM uno_feedback')[0].n === 1, env.DB.q('SELECT day FROM uno_events'));
    chk('E8e uno_daily: day 400 kept, day 401 deleted', g(400, 'dropped', '') === 5 && g(401, 'outcome', 'answered') === undefined);
    chk('E8f meta.uno_rollup_day = yesterday', env.DB.q("SELECT v FROM meta WHERE k = 'uno_rollup_day'")[0].v === dayAgo(1));
    const before = daily();
    await W.cleanupUno(env, c, T);
    chk('E8g second run changes nothing (idempotent)', daily() === before);
    env.DB.db.exec("DELETE FROM meta WHERE k = 'uno_rollup_day'");
    await W.cleanupUno(env, c, T);
    chk('E8h re-rolling from scratch gives the same counts for the days still present (recomputed, not added)', g(1, 'outcome', 'answered') === 2 && g(1, 'sessions', '') === 2, daily());
    { const e2 = mkEnv(undefined, 2); const c2 = W.cfg(e2); e2.DB.db.prepare("INSERT INTO question_log (ts, day, code_id, role, q_redacted, route, trigger, outcome) VALUES ('x', ?, 'c', 'sales', 'q', 'catalog', 'auto', 'ok')").run(dayAgo(40));
      let threw = false; try { await W.cleanup(e2, c2, T); } catch (_) { threw = true; }
      chk('E8i database without the 0003 tables: cleanup does not throw and the existing retention still runs', !threw && e2.DB.q('SELECT COUNT(*) n FROM question_log')[0].n === 0
        && e2.DB.q("SELECT v FROM meta WHERE k = 'last_cleanup_day'")[0].v === W.manilaDay(T, 480)); }
    { const e2 = mkEnv(undefined, 2); seed(e2, t); r = await call(e2, '/events', batch([qev()]));
      chk('E8j events on but tables missing -> 503 unavailable (exception path), other routes unaffected', r.status === 503 && r.j.error === 'unavailable'); }

    /* ---- E9 other routes unchanged in shape ---- */
    env = mkEnv(); r = await call(env, '/health', null, { method: 'GET' });
    chk('E9 /health unchanged', r.status === 200 && r.text === '{"ok":true,"ai":true,"web":true}', r.text);
    r = await call(env, '/ask', {}, { ctype: 'application/json' });
    chk('E9b /ask without a token -> 401', r.status === 401 && r.j.error === 'unauthorized');
    r = await call(env, '/events/x', batch([qev()]));
    const r404 = await call(env, '/admin/events', batch([qev()]));
    chk('E9c /events/x and /admin/events -> 404 (exact route only)', r.status === 404 && r404.status === 404);
    r = await call(mkEnv({ EVENTS_ENABLED: 'true', AI_ENABLED: 'false' }), '/events', batch([qev()]));
    chk('E9d events independent of the AI kill switch (AI_ENABLED=false)', r.status === 200, r.j);
  } catch (e) {
    failed.push('EXCEPTION ' + (e && e.stack || e));
    if (out) _log('FAIL - exception: ' + (e && e.stack || e));
  } finally { console.log = _log; }
  return failed;
}

/* ---------------- mutants: each must fail at least one check ---------------- */
const MUTANTS = [
  ['kill switch removed', "if (!c.eventsEnabled) return fail(c, 503, 'events_off');", ''],
  ['events always on', "eventsEnabled: String(env.EVENTS_ENABLED) === 'true'", 'eventsEnabled: true'],
  ['kill switch after body parse', "  if (!c.eventsEnabled) return fail(c, 503, 'events_off');                    // kill switch: before the body and before any D1 statement\n  const raw = await readCapped(req, EVENTS_MAX_BYTES);\n  if (raw === null) return fail(c, 413, 'too_large');\n  let b; try { b = JSON.parse(raw); } catch (_) { return fail(c, 400, 'bad_request'); }",
    "  const raw = await readCapped(req, EVENTS_MAX_BYTES);\n  if (raw === null) return fail(c, 413, 'too_large');\n  let b; try { b = JSON.parse(raw); } catch (_) { return fail(c, 400, 'bad_request'); }\n  if (!c.eventsEnabled) return fail(c, 503, 'events_off');"],
  ['redaction removed', 'const q = redactEvent(e.q);', 'const q = String(e.q).trim();'],
  ['code-like redaction removed', "? '[code]' : m", '? m : m'],
  ['size cap removed', 'readCapped(req, EVENTS_MAX_BYTES)', 'readCapped(req, 1e9)'],
  ['catalogue code filter removed', 'e.codes.filter(x => cat.has(x))', 'e.codes'],
  ['per-IP minute limit raised', 'EVENTS_IP_PER_MIN = 6', 'EVENTS_IP_PER_MIN = 600'],
  ['per-IP day limit raised', 'EVENTS_IP_PER_DAY = 200', 'EVENTS_IP_PER_DAY = 2000000'],
  ['global cap raised', 'EVENTS_GLOBAL_PER_DAY = 10000', 'EVENTS_GLOBAL_PER_DAY = 1e9'],
  ['in-isolate global flag ignored', "if (EV_MEM.capped) return fail(c, 429, 'rate_limited');", ''],
  ['dropped not counted', '.bind(day, k).run().catch', '.bind(day, 0).run().catch'],
  ['uno cleanup failure propagates', 'await cleanupUno(env, c, t).catch(() => {});', 'await cleanupUno(env, c, t);'],
  ['raw retention off', "db.prepare('DELETE FROM uno_events WHERE day < ?1').bind(cut(c.logDays))", "db.prepare('DELETE FROM uno_events WHERE day < ?1').bind(cut(3650))"],
  ['aggregate retention off', "db.prepare('DELETE FROM uno_daily WHERE day < ?1').bind(cut(400))", "db.prepare('DELETE FROM uno_daily WHERE day < ?1').bind(cut(4000))"],
  ['rollup adds instead of recomputing', "'ON CONFLICT (day, metric, dim) DO UPDATE SET n = excluded.n').bind(from, today);", "'ON CONFLICT (day, metric, dim) DO UPDATE SET n = n + excluded.n').bind(from, today);"],
  ['rollup includes today', 'WHERE day > ?1 AND day < ?2 GROUP BY day, ${dim}', 'WHERE day > ?1 AND day <= ?2 GROUP BY day, ${dim}'],
  ['outcome enum check removed', 'EV_OUTCOMES.indexOf(e.outcome) < 0', 'false'],
  ['batch size check removed', 'b.ev.length > EVENTS_MAX_BATCH', 'false'],
  ['sid check removed', '!EV_SID_RE.test(b.sid)', 'false'],
  ['ETag not stamped', 'b.role, b.engine, ver, checked, e.q', 'b.role, b.engine, null, checked, e.q'],
  ['feedback reason check removed', "if (EV_REASONS.indexOf(e.reason) >= 0) evs.push", 'if (true) evs.push'],
  ['bound-parameter chunking removed', 'i += 90) chunks.push(all.slice(i, i + 90))', 'i += 1000) chunks.push(all.slice(i, i + 1000))'],
  // fix round 1 (FR1–FR5)
  ['insert cap guard removed (race can exceed the cap)', String.raw`" WHERE (SELECT n FROM counters WHERE scope = 'ev_global_day' AND subject = 'all' AND win = ?2) <= " + EVENTS_GLOBAL_PER_DAY +`,
    String.raw`" WHERE ?2 = ?2 AND " + EVENTS_GLOBAL_PER_DAY + " > 0" +`],
  ['global read-check removed (refusal writes counters)', String.raw`if ((cnt.ev_global_day || 0) + k > EVENTS_GLOBAL_PER_DAY) { EV_MEM.capped = true; return fail(c, 429, 'rate_limited'); }`, ''],
  ['per-IP read-check removed (refusal writes counters)', 'if ((cnt.ev_ip_day || 0) + k > EVENTS_IP_PER_DAY) {', 'if (false) {'],
  ['dropped written on every refusal', 'if (cur && !cur.dropped) {', 'if (cur) {'],
  ['code de-duplication removed', String.raw`[...new Set((Array.isArray(e.codes) ? e.codes : []).filter(x => typeof x === 'string' && EV_CODE_RE.test(x)))].slice(0, 12)`,
    String.raw`(Array.isArray(e.codes) ? e.codes : []).filter(x => typeof x === 'string' && EV_CODE_RE.test(x)).slice(0, 12)`],
  ['control / format characters kept', String.raw`.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ').replace(/\p{Cf}/gu, '')`, ''],
  ['half surrogate kept at the cut', String.raw`.replace(/[\uD800-\uDBFF]$/, '')`, ''],
  ['vero-prefix rule removed', String.raw`  [/\bvero(?:[^0-9a-z]{0,3}[0-9a-z]){20}\b/gi,`, String.raw`  [/\bNEVERMATCH\b/gi,`],
  ['vero-prefix separators narrowed to . _ - space', String.raw`(?:[^0-9a-z]{0,3}[0-9a-z]){20}`, String.raw`(?:[ ._-]?[0-9a-z]){20}`],
  ['vero-prefix whitespace structure check removed', String.raw`m => !/\s/.test(m.slice(4))
    || (`, String.raw`m => true
    || (`],
  ['joined 20-character rule removed', String.raw`  [/\b[0-9a-z]{20}\b/gi, m => /\d/.test(m) && /[a-z]/i.test(m)],`, ''],
  ['separated-groups rule removed', String.raw`  [/\b[0-9a-z]{4}(?:[^0-9a-z]{1,3}[0-9a-z]{4}){4,}\b/gi,`, String.raw`  [/\bNEVERMATCH\b/gi,`],
  ['separated-groups separators narrowed to . _ - space', String.raw`(?:[^0-9a-z]{1,3}[0-9a-z]{4}){4,}`, String.raw`(?:[ ._-][0-9a-z]{4}){4,}`],
  ['groups may split words (optional separator)', String.raw`(?:[^0-9a-z]{1,3}[0-9a-z]{4}){4,}`, String.raw`(?:[^0-9a-z]{0,3}[0-9a-z]{4}){4,}`],
  ['mixed-group requirement weakened to 1', String.raw`/[a-z]/i.test(x)).length >= 2 && g.filter`, String.raw`/[a-z]/i.test(x)).length >= 1 && g.filter`],
  ['two-letter-group requirement removed', String.raw`.length >= 2).length >= 2`, String.raw`.length >= 0).length >= 0`],
  ['all-digit-group cap removed', String.raw`&& g.filter(x => /^\d+$/.test(x)).length <= 1; }],`, String.raw`&& true; }],`],
  ['code rules after the 120-char cut', String.raw`  for (const [re, ok] of EV_CODE_RULES) s = s.replace(re, m => (ok(m) ? '[code]' : m));
  return redact(s)`, String.raw`  s = redact(s); for (const [re, ok] of EV_CODE_RULES) s = s.replace(re, m => (ok(m) ? '[code]' : m));
  return (s)`],
  ['whitespace normalisation removed before the rules', String.raw`.replace(/\s+/g, ' ').trim();   // FR3`, String.raw`.trim();   // FR3`],
  ['per-IP half of the insert guard removed', String.raw`" AND (SELECT n FROM counters WHERE scope = 'ev_ip_day' AND subject = ?3 AND win = ?2) <= " + EVENTS_IP_PER_DAY`,
    String.raw`" AND ?3 = ?3 AND " + EVENTS_IP_PER_DAY + " > 0"`],
  ['feedback insert guard removed', String.raw`SELECT ?1, ?2, ?4, ?5, ?6, ?7, ?8, ?9' + guard)`, String.raw`SELECT ?1, ?2, ?4, ?5, ?6, ?7, ?8, ?9 WHERE ?3 = ?3 RETURNING id')`],
  ['capped flag survives the day change', 'EV_MEM.day = day; EV_MEM.capped = false;', 'EV_MEM.day = day;'],
  ['daily counters expire immediately', "k, plusDays(t, 2)), addCountStmt(db, 'ev_global_day', 'all', day, k, plusDays(t, 2))", "k, plusDays(t, 0)), addCountStmt(db, 'ev_global_day', 'all', day, k, plusDays(t, 0))"],
  ['kill switch after the schema check', "  if (!c.eventsEnabled) return fail(c, 503, 'events_off');                    // kill switch: before the body and before any D1 statement\n", '',
    "  if (!evs.length) return fail(c, 400, 'bad_request');\n", "  if (!evs.length) return fail(c, 400, 'bad_request');\n  if (!c.eventsEnabled) return fail(c, 503, 'events_off');\n"],
  ['followup taken from chip', 'followup: e.followup === true ? 1 : 0', 'followup: e.chip === true ? 1 : 0'],
  ['13 codes accepted', 'EV_CODE_RE.test(x)))].slice(0, 12)', 'EV_CODE_RE.test(x)))].slice(0, 13)'],
  ['n_codes unbounded', 'nCodes: evInt(e.n_codes, 0, 999)', 'nCodes: evInt(e.n_codes, 0, 1e9)'],
  ['category from the first code', 'if (n > best) { best = n; category = g; }', 'if (category === null) { best = n; category = g; }'],
  ['in-memory IP map cleared at 5 entries', 'EV_MEM.ip.size > 5000', 'EV_MEM.ip.size > 5'],
  ['size cap off by one (4097 accepted)', 'if (n > max) {', 'if (n > max + 1) {'],
  ['Manila day replaced by the UTC day', 'const day = manilaDay(t, c.dayOffsetMin), minute = manilaMinute(t, c.dayOffsetMin), k = evs.length;', 'const day = manilaDay(t, 0), minute = manilaMinute(t, c.dayOffsetMin), k = evs.length;'],
  ['followup flag dropped', 'followup: e.followup === true ? 1 : 0', 'followup: 0'],
  ['chip flag dropped', 'chip: e.chip === true ? 1 : 0', 'chip: 0'],
  ['kill switch between body read and parse', "  if (!c.eventsEnabled) return fail(c, 503, 'events_off');                    // kill switch: before the body and before any D1 statement\n  const raw = await readCapped(req, EVENTS_MAX_BYTES);\n",
    "  const raw = await readCapped(req, EVENTS_MAX_BYTES);\n  if (!c.eventsEnabled) return fail(c, 503, 'events_off');\n"],
];

const W = await load(SRC), W2 = await load(SRC), W3 = await load(SRC), W4 = await load(SRC);
const failed = await suite(W, W2, W3, W4, true), baseFailed = new Set(failed);
let killed = 0;
for (const [name, from, to, from2, to2] of MUTANTS) {
  const n = SRC.split(from).length - 1, n2 = from2 === undefined ? 1 : SRC.split(from2).length - 1;
  if (n !== 1 || n2 !== 1) { CHECKS++; failed.push('mutant anchor ' + name); _log(`FAIL - mutant "${name}": anchor found ${n} / ${n2} times`); continue; }
  let src = SRC.replace(from, () => to);
  if (from2 !== undefined) src = src.replace(from2, () => to2);
  const m1 = await load(src), m2 = await load(src), m3 = await load(src), m4 = await load(src);
  const f = await suite(m1, m2, m3, m4, false);
  CHECKS++;
  const fresh = f.filter(x => !baseFailed.has(x));   // only checks that pass on the real source count as a kill
  if (fresh.length) { killed++; _log(`PASS - mutant killed: ${name} (${fresh.length} checks fail, e.g. ${fresh[0].slice(0, 80)})`); }
  else { failed.push('mutant survived: ' + name); _log(`FAIL - mutant survived: ${name}`); }
}
rmSync(tmp, { recursive: true, force: true });
_log(`\n${CHECKS - failed.length} passed, ${failed.length} failed (${killed}/${MUTANTS.length} mutants killed)`);
process.exit(failed.length ? 1 : 0);
