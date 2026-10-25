/* UNO owner dashboard Worker "uno-dashboard" - DB1 owner gate shell (owner decision 2026-10-24; design:
 * Deliverables/UNO-Admin-Dashboard/UNO-Owner-Dashboard-Design-2026-10-24.md, decisions OD1-OD6).
 *
 * Only the owner may use it. Cloudflare Access (one-email policy + MFA) sits in front of the Worker's hostname; this
 * Worker does NOT trust Access alone: every request must carry a valid Access JWT (Cf-Access-Jwt-Assertion, RS256, signed
 * by the team's Access keys, aud = ACCESS_AUD, iss = ACCESS_TEAM_DOMAIN, not expired) whose email equals OWNER_EMAIL.
 * VERO access codes and admin:read tokens are never accepted. Anything missing or wrong fails closed.
 *
 *   GET  /              -> owner shell page (no data in DB1; DB2a: fixed "Back to Admin" link, ADMIN_RETURN_URL)
 *   GET  /app.css       -> stylesheet for the shell page
 *   POST /api/whoami    -> { ok, role: 'owner', exp }   (same-origin only; no data)
 *
 * DB1 has no D1 binding, no CORS headers, no cookies or storage of its own, and writes no log lines.
 * Settings (Cloudflare dashboard; never in the repo): DASHBOARD_ENABLED (var, exactly "true" to serve; kill switch),
 * OWNER_EMAIL, ACCESS_AUD, ACCESS_TEAM_DOMAIN (secrets; team domain = https://<team>.cloudflareaccess.com). */

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
const PAGE = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<meta name="robots" content="noindex,nofollow"><title>UNO Owner Dashboard</title><link rel="stylesheet" href="/app.css"></head>' +
  '<body><main><a class="back" href="' + ADMIN_RETURN_URL + '">&larr; Back to Admin</a><h1>UNO Owner Dashboard</h1><p>Signed in as the owner.</p>' +
  '<p class="note">DB1 owner gate: no data is shown yet. Reports arrive in later checkpoints.</p></main></body></html>';
const CSS = 'body{margin:0;font:16px/1.5 system-ui,sans-serif;background:#f6f7f9;color:#1d2330}' +
  'main{max-width:720px;margin:0 auto;padding:24px 16px}h1{font-size:22px;margin:0 0 12px}.note{color:#5b6475;font-size:14px}' +
  '.back{display:inline-block;margin:0 0 16px;padding:10px 0;color:#007934;font-weight:600;text-decoration:none}' +
  '@media (prefers-color-scheme:dark){body{background:#14171c;color:#e6e9ef}.note{color:#9aa3b2}.back{color:#4cc27a}}';

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
    if (url.pathname === '/') return req.method === 'GET' ? new Response(PAGE, { headers: headers('text/html; charset=utf-8') }) : fail(405, 'method_not_allowed');
    if (url.pathname === '/app.css') return req.method === 'GET' ? new Response(CSS, { headers: headers('text/css; charset=utf-8') }) : fail(405, 'method_not_allowed');
    if (url.pathname === '/api/whoami') {
      if (req.method !== 'POST') return fail(405, 'method_not_allowed');
      if ((req.headers.get('origin') || '') !== url.origin) return fail(403, 'forbidden_origin');
      return json({ ok: true, role: 'owner', exp: claims.exp });
    }
    return fail(404, 'not_found');
  },
};
