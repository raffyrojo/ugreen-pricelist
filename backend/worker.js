/* UGREEN Pricelist CMS — Cloudflare Worker (secure backend)
   Commits products.json (and any new images) to GitHub on behalf of the admin.
   The GitHub token NEVER reaches the browser — it lives only in this Worker's
   secrets. The frontend must send the correct save password.

   Secrets (set with `wrangler secret put NAME`):
     GITHUB_TOKEN       fine-grained PAT, Contents: Read+Write on the repo
     ADMIN_SAVE_SECRET  the save password the admin types in the app
   Vars (wrangler.toml [vars]):
     GH_OWNER, GH_REPO, GH_BRANCH
*/

export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin': env.ALLOW_ORIGIN || '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    // Public GET: live trending list (top-viewed item_codes over the last 30 days).
    if (request.method === 'GET') {
      const url = new URL(request.url);
      if (url.searchParams.get('trending') != null) return handleTrendingGet(env, cors);
      if (url.searchParams.get('searches') != null) return handleSearchesGet(env, cors);
      return json({ ok: true, service: 'ugreen-cms' }, 200, cors);
    }
    if (request.method !== 'POST') return json({ error: 'POST only' }, 405, cors);

    let raw, payload;
    try { raw = await request.text(); payload = JSON.parse(raw); }
    catch (e) { return json({ error: 'Invalid JSON body' }, 400, cors); }

    // Public, anonymous telemetry (NO password): a session's viewed codes / searched terms.
    if (payload && payload.action === 'track') return handleTrack(payload, env, cors, request, _enc.encode(raw).length);
    // Admin-only: clear the trending buckets.
    if (payload && payload.action === 'resetTrending') return handleResetTrending(payload, env, cors);
    // Dealer portal: public code exchange + admin CRUD for private dealer price lists.
    if (payload && payload.action === 'dealerAuth') return handleDealerAuth(payload, env, cors);
    if (payload && payload.action === 'dealersGet') return handleDealersGet(payload, env, cors);
    if (payload && payload.action === 'dealersSave') return handleDealersSave(payload, env, cors);

    // --- auth: constant-time password check (fails closed when the secret is missing) ---
    if (!payload || !(await secretOk(payload.password, env.ADMIN_SAVE_SECRET))) {
      return json({ error: 'Unauthorized' }, 401, cors);
    }
    if (!Array.isArray(payload.products)) {
      return json({ error: 'products array required' }, 400, cors);
    }
    // --- validate JSON is serializable + non-empty ---
    let productsJson;
    try {
      productsJson = JSON.stringify(payload.products);
      if (!productsJson || productsJson === '[]') return json({ error: 'Refusing to commit empty product list' }, 400, cors);
    } catch (e) { return json({ error: 'products not serializable' }, 400, cors); }

    const owner = env.GH_OWNER, repo = env.GH_REPO, branch = env.GH_BRANCH || 'main';
    const ghHeaders = {
      'Authorization': 'Bearer ' + env.GITHUB_TOKEN,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'ugreen-cms-worker'
    };
    const productsPath = payload.productsPath || 'data/products.json';

    try {
      // 1) commit any newly-uploaded images first (so products.json never points at a missing file)
      const committedImages = [];
      if (payload.newImages && typeof payload.newImages === 'object') {
        for (const path of Object.keys(payload.newImages)) {
          const dataUrl = payload.newImages[path];
          const b64 = String(dataUrl).indexOf(',') >= 0 ? String(dataUrl).split(',')[1] : String(dataUrl);
          await putFile(owner, repo, branch, path, b64, 'Add image ' + path, ghHeaders);
          committedImages.push(path);
        }
      }
      // 2) commit products.json (UTF-8 safe base64)
      const content = b64utf8(productsJson);
      const commitSha = await putFile(owner, repo, branch, productsPath, content,
        payload.message || 'Updated products via Admin Panel', ghHeaders);

      return json({ ok: true, commit: commitSha, images: committedImages }, 200, cors);
    } catch (e) {
      return json({ error: e.message || 'commit failed' }, e.status || 500, cors);
    }
  }
};

/* Constant-time check of the admin save password (B1a, UAD-F2): both sides are SHA-256 hashed so the comparison
   always runs over 32 bytes, independent of where the strings differ or how long they are. Only a non-empty string
   can match a non-empty configured secret, exactly as the previous `!==` check accepted; a missing secret fails closed.
   The hash input is the string's UTF-16 code units (not UTF-8), so two different strings never hash alike - e.g. lone
   surrogates are not folded into U+FFFD (B1a fix round 1, FR6). */
const _enc = new TextEncoder();
function _units(str) { const u = new Uint16Array(str.length); for (let i = 0; i < str.length; i++) u[i] = str.charCodeAt(i); return new Uint8Array(u.buffer); }
async function secretOk(given, secret) {
  if (typeof given !== 'string' || !given || typeof secret !== 'string' || !secret) return false;
  const a = new Uint8Array(await crypto.subtle.digest('SHA-256', _units(given)));
  const b = new Uint8Array(await crypto.subtle.digest('SHA-256', _units(secret)));
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

/* PUT a file to the repo via the Contents API, creating or updating it.
   Reads the current SHA (needed to update), retries once on 409 conflict. */
async function putFile(owner, repo, branch, path, base64Content, message, headers) {
  const api = 'https://api.github.com/repos/' + owner + '/' + repo + '/contents/' +
    path.split('/').map(encodeURIComponent).join('/');

  async function currentSha() {
    const r = await fetch(api + '?ref=' + encodeURIComponent(branch), { headers });
    if (r.status === 200) { const j = await r.json(); return j.sha; }
    if (r.status === 404) return undefined; // new file
    const t = await r.text(); const e = new Error('GitHub read ' + r.status + ': ' + t.slice(0, 200)); e.status = r.status; throw e;
  }

  let sha = await currentSha();
  const body = { message: message, content: base64Content, branch: branch };
  if (sha) body.sha = sha;

  let res = await fetch(api, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (res.status === 409) { // SHA moved under us — refetch and retry once
    sha = await currentSha();
    if (sha) body.sha = sha;
    res = await fetch(api, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }
  if (!res.ok) { const t = await res.text(); const e = new Error('GitHub write ' + res.status + ': ' + t.slice(0, 200)); e.status = res.status; throw e; }
  const j = await res.json();
  return j.commit && j.commit.sha;
}

/* ===== Trending analytics (Cloudflare KV binding: TRENDING) =====================
   Anonymous, aggregate only: item_code -> view count, term -> search count, in
   per-day buckets that auto-expire after 35 days (=> a rolling ~30-day window).
   If no KV is bound, every path degrades to a safe no-op. No PII is stored. */
function _dayKey(d) { return 'v:' + d.toISOString().slice(0, 10); }
function _recentDayKeys(n) {
  const out = [], now = Date.now();
  for (let i = 0; i < n; i++) out.push(_dayKey(new Date(now - i * 86400000)));
  return out;
}
/* B1a fix round 1 (FR3): count maps never inherit from Object.prototype and keep only finite positive numbers, so
   keys such as "constructor" / "valueOf" / "__proto__" are ordinary counters and old corrupted values are dropped. */
function _counts(src) {
  const o = Object.create(null);
  if (src && typeof src === 'object') for (const k of Object.keys(src)) { const n = src[k]; if (typeof n === 'number' && isFinite(n) && n > 0) o[k] = n; }
  return o;
}
function _capMap(m, max) {
  const ks = Object.keys(m);
  if (ks.length <= max) return m;
  ks.sort((a, b) => m[b] - m[a]);
  const out = Object.create(null);
  for (let i = 0; i < max; i++) out[ks[i]] = m[ks[i]];
  return out;
}
/* track hardening (B1a, UAD-F1): the request comes from the public page, so everything is validated here.
   - a request from another site's page (Origin present and not ALLOW_ORIGIN) is refused; body <= 16 KB (UTF-8 bytes);
   - views: item-code charset only; terms: 3-60 chars of letters / digits / basic punctuation, never an email-like,
     phone-like or long digit run (no personal data stored in KV); at most 50 of each per request;
   - nothing valid -> no KV read or write. */
const TRACK_MAX_BYTES = 16384, TRACK_MAX_ITEMS = 50, MIN_SEARCH_COUNT = 3;
const TRACK_CODE_RE = /^[A-Za-z0-9-]{1,20}$/;
/* fix round 1: FR1 wider charset (catalogue names use * ° % @ etc.; combining marks), FR2 NFC normalisation,
   FR5 phone-like = any digit group of 7+ digits incl. separators (Metro Manila landlines "8123 4567"; also covers any
   plain run of 7+ digits) */
const TRACK_TERM_RE = /^[\p{L}\p{M}\p{N} .,'"+\-\/&()#*°%?!₱…“”‘’@_]+$/u;
const TRACK_EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]{2,}/;
function _trackTerm(t) {
  if (typeof t !== 'string') return '';
  const s = t.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
  if (s.length < 3 || s.length > 60 || !TRACK_TERM_RE.test(s) || TRACK_EMAIL_RE.test(s)) return '';
  if ((s.match(/\+?\d[\d\s().-]{5,}\d/g) || []).some(m => m.replace(/\D/g, '').length >= 7)) return '';   // phone-like
  return s;
}
async function handleTrack(payload, env, cors, request, rawLength) {
  const origin = request && request.headers.get('origin');
  if (origin && env.ALLOW_ORIGIN && origin !== env.ALLOW_ORIGIN) return json({ ok: false, error: 'forbidden_origin' }, 403, cors);
  if (rawLength > TRACK_MAX_BYTES) return json({ ok: false, error: 'too_large' }, 413, cors);
  if (!env.TRENDING) return json({ ok: true, skipped: 'no-kv' }, 200, cors);
  const ev = (payload.events && typeof payload.events === 'object') ? payload.events : {};
  const views = [...new Set((Array.isArray(ev.views) ? ev.views : []).slice(0, 300).filter(c => typeof c === 'string' && TRACK_CODE_RE.test(c)))].slice(0, TRACK_MAX_ITEMS);
  const searches = [...new Set((Array.isArray(ev.searches) ? ev.searches : []).slice(0, 300).map(_trackTerm).filter(Boolean))].slice(0, TRACK_MAX_ITEMS);
  if (!views.length && !searches.length) return json({ ok: true, empty: true }, 200, cors);
  const key = _dayKey(new Date());
  let cur = null;
  try { cur = await env.TRENDING.get(key, 'json'); } catch (e) { cur = null; }
  cur = (cur && typeof cur === 'object') ? cur : {};
  const v = _counts(cur.views), s = _counts(cur.searches);
  for (const k of views) v[k] = (v[k] || 0) + 1;
  for (const k of searches) s[k] = (s[k] || 0) + 1;
  cur.views = _capMap(v, 800); cur.searches = _capMap(s, 400);
  try { await env.TRENDING.put(key, JSON.stringify(cur), { expirationTtl: 60 * 60 * 24 * 35 }); } catch (e) {}
  return json({ ok: true, accepted: { views: views.length, searches: searches.length } }, 200, cors);
}
async function handleTrendingGet(env, cors) {
  if (!env.TRENDING) return json([], 200, cors);
  const keys = _recentDayKeys(30);
  let buckets = [];
  try { buckets = await Promise.all(keys.map(k => env.TRENDING.get(k, 'json').catch(() => null))); } catch (e) { buckets = []; }
  const totals = Object.create(null);
  for (const b of buckets) { if (b) { const m = _counts(b.views); for (const c of Object.keys(m)) totals[c] = (totals[c] || 0) + m[c]; } }
  const top = Object.keys(totals).sort((a, b) => totals[b] - totals[a]).slice(0, 12);
  return json(top, 200, cors); // array of item_codes — same shape as data/trending.json
}
async function handleSearchesGet(env, cors) {
  if (!env.TRENDING) return json([], 200, cors);
  const keys = _recentDayKeys(30);
  let buckets = [];
  try { buckets = await Promise.all(keys.map(k => env.TRENDING.get(k, 'json').catch(() => null))); } catch (e) { buckets = []; }
  const totals = Object.create(null);
  for (const b of buckets) { if (b) { const m = _counts(b.searches); for (const t of Object.keys(m)) totals[t] = (totals[t] || 0) + m[t]; } }
  // B1a (owner B1-Q2): a term is published only after >= MIN_SEARCH_COUNT session-counts in the 30-day window,
  // so a single burst cannot put a term on every visitor's "Top Searches"
  const top = Object.keys(totals).filter(t => totals[t] >= MIN_SEARCH_COUNT).sort((a, b) => totals[b] - totals[a]).slice(0, 12);
  return json(top, 200, cors); // array of search terms, most-searched first (cross-visitor, 30-day)
}
async function handleResetTrending(payload, env, cors) {
  if (!(await secretOk(payload.password, env.ADMIN_SAVE_SECRET))) return json({ error: 'Unauthorized' }, 401, cors);
  if (!env.TRENDING) return json({ error: 'No trending KV bound' }, 500, cors);
  const keys = _recentDayKeys(40);
  let cleared = 0;
  try { await Promise.all(keys.map(k => env.TRENDING.delete(k).then(() => { cleared++; }).catch(() => {}))); } catch (e) {}
  return json({ ok: true, cleared }, 200, cors);
}

/* ===== Dealer portal (Cloudflare KV binding: DEALERS) ==========================
   One KV key 'dealers' -> JSON array of dealer profiles:
     { id, name, username, password, discountPct (0-95, percent off SRP), active, skus:[item_code] }
   dealerAuth is PUBLIC (no admin password): a dealer exchanges username+password
   for ONLY their own {name,discountPct,skus}. Other dealers' data is never returned.
   dealersGet/dealersSave are admin-only (ADMIN_SAVE_SECRET). Credentials never
   live in the public repo. If no KV is bound, dealer routes fail closed. */
async function _dealersRead(env) {
  let list = null;
  try { list = await env.DEALERS.get('dealers', 'json'); } catch (e) { list = null; }
  return Array.isArray(list) ? list : [];
}
async function handleDealerAuth(payload, env, cors) {
  const username = String(payload.username || '').trim().toLowerCase();
  const password = String(payload.password || '');
  if (!username || !password) return json({ error: 'username and password required' }, 400, cors);
  if (!env.DEALERS) return json({ error: 'Dealer portal not configured' }, 503, cors);
  const list = await _dealersRead(env);
  const d = list.find(x => x && x.active !== false && String(x.username || '').toLowerCase() === username && String(x.password || '') === password);
  if (!d) return json({ error: 'Invalid username or password' }, 401, cors);
  return json({ ok: true, dealer: {
    id: d.id, name: d.name,
    discountPct: Math.max(0, Math.min(95, Number(d.discountPct) || 0)),
    skus: Array.isArray(d.skus) ? d.skus : []
  } }, 200, cors);
}
async function handleDealersGet(payload, env, cors) {
  if (!(await secretOk(payload.password, env.ADMIN_SAVE_SECRET))) return json({ error: 'Unauthorized' }, 401, cors);
  if (!env.DEALERS) return json({ error: 'No DEALERS KV bound' }, 500, cors);
  return json({ ok: true, dealers: await _dealersRead(env) }, 200, cors);
}
async function handleDealersSave(payload, env, cors) {
  if (!(await secretOk(payload.password, env.ADMIN_SAVE_SECRET))) return json({ error: 'Unauthorized' }, 401, cors);
  if (!env.DEALERS) return json({ error: 'No DEALERS KV bound' }, 500, cors);
  if (!Array.isArray(payload.dealers)) return json({ error: 'dealers array required' }, 400, cors);
  const seen = {};
  const clean = payload.dealers.slice(0, 1000).map(d => ({
    id: String(d.id || '').slice(0, 40),
    name: String(d.name || '').slice(0, 120),
    username: String(d.username || '').trim().toLowerCase().slice(0, 120),
    password: String(d.password || '').slice(0, 200),
    discountPct: Math.max(0, Math.min(95, Number(d.discountPct) || 0)),
    active: d.active !== false,
    skus: Array.isArray(d.skus) ? [...new Set(d.skus.map(s => String(s).slice(0, 60)))].slice(0, 5000) : []
  }));
  for (const d of clean) {
    if (!d.name) return json({ error: 'Every dealer needs a name' }, 400, cors);
    if (!d.username) return json({ error: 'Dealer "' + d.name + '" needs a username' }, 400, cors);
    if (!d.password) return json({ error: 'Dealer "' + d.name + '" needs a password' }, 400, cors);
    const k = d.username;
    if (seen[k]) return json({ error: 'Duplicate username "' + k + '" — usernames must be unique' }, 400, cors);
    seen[k] = 1;
  }
  try { await env.DEALERS.put('dealers', JSON.stringify(clean)); }
  catch (e) { return json({ error: 'KV write failed' }, 500, cors); }
  return json({ ok: true, count: clean.length }, 200, cors);
}

function b64utf8(str) {
  // btoa on UTF-8 bytes (₱ and other non-ASCII in features/descriptions)
  return btoa(unescape(encodeURIComponent(str)));
}
function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}
