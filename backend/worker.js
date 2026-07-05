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
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'POST') return json({ error: 'POST only' }, 405, cors);

    let payload;
    try { payload = await request.json(); }
    catch (e) { return json({ error: 'Invalid JSON body' }, 400, cors); }

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

function b64utf8(str) {
  // btoa on UTF-8 bytes (₱ and other non-ASCII in features/descriptions)
  return btoa(unescape(encodeURIComponent(str)));
}
function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}
