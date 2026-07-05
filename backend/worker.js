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

    // --- AI one-sentence summary (separate action; own auth; never writes to GitHub) ---
    if (payload && payload.action === 'summarize') {
      return handleSummarize(payload, env, cors);
    }

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

/* AI: generate one dealer-facing sentence for the SKU card from the product's
   own name/description/features. Same admin password as publishing. Anthropic
   key lives only in the Worker secret ANTHROPIC_API_KEY. */
async function handleSummarize(payload, env, cors) {
  if (!payload.password || payload.password !== env.ADMIN_SAVE_SECRET) return json({ error: 'Unauthorized' }, 401, cors);
  if (!env.ANTHROPIC_API_KEY) return json({ error: 'AI not configured: set the ANTHROPIC_API_KEY Worker secret.' }, 500, cors);
  const p = payload.product || {};
  const name = String(p.product_name || '').slice(0, 300);
  const desc = String(p.description || '').slice(0, 2000);
  const feats = String(p.features || '').slice(0, 2000);
  const cat = String(p.category || '').slice(0, 120);
  if (!name && !desc && !feats) return json({ error: 'Need at least a product name, description, or features.' }, 400, cors);

  const system = "You write one-sentence product summaries for a UGREEN pricelist SKU card (dealer-facing). RULES: exactly ONE sentence, at most 80 characters, at most 12 words, ending with a period. State only facts present in the provided name/description/features — NEVER invent numbers, wattages, capacities, materials, ports, speeds, or compatibility. Keep the product type plus one key spec or benefit. Plain and factual: no marketing fluff, no emojis, no line breaks. Output ONLY the sentence, nothing else.";
  const user = "Category: " + cat + "\nProduct name: " + name + "\nDescription:\n" + desc + "\nFeatures:\n" + feats + "\n\nWrite the one-sentence card summary now.";
  const model = env.ANTHROPIC_MODEL || 'claude-3-5-haiku-latest';

  let r;
  try {
    r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: model, max_tokens: 100, system: system, messages: [{ role: 'user', content: user }] })
    });
  } catch (e) { return json({ error: 'AI request failed: ' + (e.message || e) }, 502, cors); }

  const data = await r.json().catch(function () { return {}; });
  if (!r.ok) return json({ error: 'AI error ' + r.status + ': ' + ((data && data.error && data.error.message) || '') }, r.status, cors);

  let text = String((data.content && data.content[0] && data.content[0].text) || '').replace(/\s+/g, ' ').trim();
  var q = text.match(/"([^"]{5,})"/); if (q) text = q[1];            // unwrap if the model quoted the sentence
  text = text.replace(/^["'\s]+|["'\s]+$/g, '');
  const m = text.match(/^.*?[.!?](?=\s|$)/); if (m) text = m[0];            // first sentence only
  if (!/[.!?]$/.test(text)) text = text.replace(/[.\s]+$/, '') + '.';        // ensure terminal period
  if (text.length > 80) text = text.slice(0, 79).replace(/\s+\S*$/, '').replace(/[,;:\s]+$/, '') + '.';
  if (!text || text === '.') return json({ error: 'AI returned an empty summary.' }, 502, cors);
  return json({ ok: true, summary: text }, 200, cors);
}

function b64utf8(str) {
  // btoa on UTF-8 bytes (₱ and other non-ASCII in features/descriptions)
  return btoa(unescape(encodeURIComponent(str)));
}
function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}
