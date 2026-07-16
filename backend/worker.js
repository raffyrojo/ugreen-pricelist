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

    let payload;
    try { payload = await request.json(); }
    catch (e) { return json({ error: 'Invalid JSON body' }, 400, cors); }

    // Public, anonymous telemetry (NO password): a session's viewed codes / searched terms.
    if (payload && payload.action === 'track') return handleTrack(payload, env, cors);
    // Admin-only: clear the trending buckets.
    if (payload && payload.action === 'resetTrending') return handleResetTrending(payload, env, cors);
    // Dealer portal: public code exchange + admin CRUD for private dealer price lists.
    if (payload && payload.action === 'dealerAuth') return handleDealerAuth(payload, env, cors);
    if (payload && payload.action === 'dealersGet') return handleDealersGet(payload, env, cors);
    if (payload && payload.action === 'dealersSave') return handleDealersSave(payload, env, cors);

    // --- auth: constant-time-ish password check ---
    if (!payload || !payload.password || payload.password !== env.ADMIN_SAVE_SECRET) {
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
function _capMap(m, max) {
  const ks = Object.keys(m);
  if (ks.length <= max) return m;
  ks.sort((a, b) => m[b] - m[a]);
  const out = {};
  for (let i = 0; i < max; i++) out[ks[i]] = m[ks[i]];
  return out;
}
async function handleTrack(payload, env, cors) {
  if (!env.TRENDING) return json({ ok: true, skipped: 'no-kv' }, 200, cors);
  const ev = payload.events || {};
  const views = Array.isArray(ev.views) ? ev.views.slice(0, 300) : [];
  const searches = Array.isArray(ev.searches) ? ev.searches.slice(0, 300) : [];
  if (!views.length && !searches.length) return json({ ok: true, empty: true }, 200, cors);
  const key = _dayKey(new Date());
  let cur = null;
  try { cur = await env.TRENDING.get(key, 'json'); } catch (e) { cur = null; }
  cur = (cur && typeof cur === 'object') ? cur : {};
  const v = cur.views || {}, s = cur.searches || {};
  for (const c of views) { const k = String(c).slice(0, 40); if (k) v[k] = (v[k] || 0) + 1; }
  for (const t of searches) { const k = String(t).toLowerCase().slice(0, 60).trim(); if (k) s[k] = (s[k] || 0) + 1; }
  cur.views = _capMap(v, 800); cur.searches = _capMap(s, 400);
  try { await env.TRENDING.put(key, JSON.stringify(cur), { expirationTtl: 60 * 60 * 24 * 35 }); } catch (e) {}
  return json({ ok: true }, 200, cors);
}
async function handleTrendingGet(env, cors) {
  if (!env.TRENDING) return json([], 200, cors);
  const keys = _recentDayKeys(30);
  let buckets = [];
  try { buckets = await Promise.all(keys.map(k => env.TRENDING.get(k, 'json').catch(() => null))); } catch (e) { buckets = []; }
  const totals = {};
  for (const b of buckets) { if (b && b.views) for (const c in b.views) totals[c] = (totals[c] || 0) + b.views[c]; }
  const top = Object.keys(totals).sort((a, b) => totals[b] - totals[a]).slice(0, 12);
  return json(top, 200, cors); // array of item_codes — same shape as data/trending.json
}
async function handleSearchesGet(env, cors) {
  if (!env.TRENDING) return json([], 200, cors);
  const keys = _recentDayKeys(30);
  let buckets = [];
  try { buckets = await Promise.all(keys.map(k => env.TRENDING.get(k, 'json').catch(() => null))); } catch (e) { buckets = []; }
  const totals = {};
  for (const b of buckets) { if (b && b.searches) for (const t in b.searches) totals[t] = (totals[t] || 0) + b.searches[t]; }
  const top = Object.keys(totals).sort((a, b) => totals[b] - totals[a]).slice(0, 12);
  return json(top, 200, cors); // array of search terms, most-searched first (cross-visitor, 30-day)
}
async function handleResetTrending(payload, env, cors) {
  if (!payload.password || payload.password !== env.ADMIN_SAVE_SECRET) return json({ error: 'Unauthorized' }, 401, cors);
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
  if (!payload.password || payload.password !== env.ADMIN_SAVE_SECRET) return json({ error: 'Unauthorized' }, 401, cors);
  if (!env.DEALERS) return json({ error: 'No DEALERS KV bound' }, 500, cors);
  return json({ ok: true, dealers: await _dealersRead(env) }, 200, cors);
}
async function handleDealersSave(payload, env, cors) {
  if (!payload.password || payload.password !== env.ADMIN_SAVE_SECRET) return json({ error: 'Unauthorized' }, 401, cors);
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
