/* uno-dashboard owner gate tests (DB1, owner decision 2026-10-24; design UNO-Owner-Dashboard-Design-2026-10-24.md OD1-OD6).
 * Run: node tests/uno-dashboard.test.mjs
 * Runs the real backend/dashboard/worker.js with a fake Cloudflare Access key set (RSA keys generated per run, test values
 * only; no network, no Cloudflare, no secret). Covers: kill switch first; fail-closed config; Access JWT verification
 * (RS256 only, signature, key id, aud, iss, exp, nbf, email claim); owner-only email match; VERO / admin tokens refused;
 * one uniform refusal; same-origin POST; routes and methods; security headers, no CORS, no cookies; no log output; key
 * caching and refetch limits; static checks on the Worker source and its wrangler.toml (no D1 binding, no hard-coded email).
 * Each mutant of the gate logic (re-built from the real source) must make at least one check fail. */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(path.join(ROOT, 'backend/dashboard/worker.js'), 'utf8');
const TOML = readFileSync(path.join(ROOT, 'backend/dashboard/wrangler.toml'), 'utf8');
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
    chk('owner GET / -> 200 HTML shell', ok.status === 200 && /^text\/html/.test(ok.h.get('content-type')) && ok.text.includes('UNO Owner Dashboard'), [ok.status, ok.text.slice(0, 80)]);
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

    // --- headers on every response
    const all = [ok, css, who, anon404, await call('/', { tok: T, env: ENV({ DASHBOARD_ENABLED: 'false' }) })];
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
function statics(src) {
  const SRC = src;   // fix round 4: also run on every mutant source
  const res = [];
  const s = SRC.replace(/\/\*[\s\S]*?\*\//g, '');
  // fix rounds 2-3 (QA-DB1-9 / QA-DB1-13): on the RAW source (no comment stripping), env appears only as env.<one of the 4 settings>,
  // in the cfg(env) definition / call and in fetch(req, env); no Reflect, arguments or cloudflare: import; the default export has
  // exactly one handler, fetch
  const envLeft = SRC.replace(/\benv\.(ACCESS_AUD|ACCESS_TEAM_DOMAIN|DASHBOARD_ENABLED|OWNER_EMAIL)\b/g, '').replace('export function cfg(env) {', '')
    .replace('async fetch(req, env) {', '').replace('const c = cfg(env);', '');
  res.push(['worker uses env only for the 4 settings (no binding, alias, destructuring, env[...], Reflect, arguments, cloudflare: import or backslash-u escape)',
    !/\benv\b/.test(envLeft) && (SRC.match(/\bcfg\(env\)/g) || []).length === 2 && !/\bReflect\b|\barguments\b|cloudflare:|\\u/.test(SRC)]);
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
  res.push(['wrangler.toml: exact keys per section (top: name main compatibility_date workers_dev preview_urls keep_vars; [observability]: enabled; [vars]: DASHBOARD_ENABLED)',
    JSON.stringify(sect) === JSON.stringify({ '': ['name', 'main', 'compatibility_date', 'workers_dev', 'preview_urls', 'keep_vars'], '[observability]': ['enabled'], '[vars]': ['DASHBOARD_ENABLED'] })]);
  const tables = [...TOML.matchAll(/^\s*\[{1,2}([^\]]+)\]{1,2}/gm)].map(m => m[0].trim());
  res.push(['wrangler.toml: only the [observability] and [vars] tables (no binding table of any kind), no route', JSON.stringify(tables) === JSON.stringify(['[observability]', '[vars]']) && !/^\s*routes?\s*=/m.test(TOML)]);
  res.push(['wrangler.toml: kill switch "false" by default, observability off, workers.dev only, no preview URLs', /DASHBOARD_ENABLED = "false"/.test(TOML) && /\[observability\]\s*\nenabled = false/.test(TOML)
    && /^workers_dev = true$/m.test(TOML) && /^preview_urls = false\b/m.test(TOML)]);
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
];

const W = await load(SRC);
const failed = await suite(W, true);
let sFail = 0;
for (const [n, ok] of statics(SRC)) { CHECKS++; if (ok) _log('PASS - static: ' + n); else { sFail++; _log('FAIL - static: ' + n); } }
const pass = CHECKS - failed.length - sFail;
let killed = 0, mutFail = 0;
for (const [n, from, to] of MUT) {
  if (!SRC.includes(from)) { mutFail++; _log('FAIL - mutant anchor missing: ' + n); continue; }
  const M = await load(SRC.replace(from, to));
  const f = (await suite(M, false)).concat(statics(SRC.replace(from, to)).filter(x => !x[1]).map(x => 'static: ' + x[0]));
  if (f.length) { killed++; _log('PASS - mutant killed: ' + n + ' (' + f.length + ' checks)'); } else { mutFail++; _log('FAIL - mutant survived: ' + n); }
}
console.log = _log;
try { rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
_log(`UNO dashboard owner gate (checks ${pass}/${CHECKS}, mutants ${killed}/${MUT.length}): ${pass + killed} passed, ${failed.length + sFail + mutFail} failed`);
process.exit(failed.length + sFail + mutFail ? 1 : 0);
