/* GitHub save (Phase 5) — sends the in-memory product data to the Cloudflare
   Worker, which commits products.json (and any new images) to the repo.
   The GitHub token is never here; the admin types a save password per save.
   Loaded AFTER admin.js, so saveToGitHub()/saveAsNewVersion() defined here win. */

/* Build the payload: deep-copy products, and pull any session-uploaded images
   (base64 held in window.IMAGES, keyed by product.image) out as files to commit,
   rewriting those products to point at the committed file path. The live
   ALL_PRODUCTS is NOT mutated here — only on confirmed success (rollback-safe). */
function _buildSavePayload(){
  var products = JSON.parse(JSON.stringify(ALL_PRODUCTS));
  var newImages = {};
  var rewrites = []; // {code, path} to apply to ALL_PRODUCTS on success
  products.forEach(function(p){
    var key = p.image;
    if (key && window.IMAGES && window.IMAGES[key] && /^data:/.test(window.IMAGES[key])) {
      var m = window.IMAGES[key].match(/^data:image\/([a-zA-Z0-9.+-]+);/);
      var ext = (m && m[1] ? m[1] : 'png').toLowerCase().replace('jpeg','jpg');
      var safe = String(key).replace(/[^A-Za-z0-9_-]/g,'_');
      var path = 'images/' + safe + '.' + ext;
      newImages[path] = window.IMAGES[key];
      p.image = path;
      rewrites.push({ code: p.item_code, path: path, key: key });
    }
  });
  return { products: products, newImages: newImages, rewrites: rewrites };
}

function saveToGitHub(){
  var cfg = window.CONFIG || {};
  var endpoint = cfg.backend && cfg.backend.workerEndpoint;
  if (!endpoint) {
    showToast('No backend configured yet — set workerEndpoint in config.js. Downloading products.json instead.');
    if (typeof _downloadProductsJson === 'function') _downloadProductsJson();
    return;
  }
  var pw = window.prompt('Enter the admin save password to publish to GitHub:');
  if (pw === null) return;                 // cancelled
  if (!pw) { showToast('Save cancelled — no password entered.'); return; }

  var built = _buildSavePayload();
  var gh = cfg.github || {};
  var body = {
    password: pw,
    products: built.products,
    newImages: built.newImages,
    productsPath: (gh.productsPath || 'data/products.json'),
    message: 'Updated products via Admin Panel'
  };

  showLoading('Publishing to GitHub…');
  fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  .then(function(r){ return r.json().catch(function(){ return {}; }).then(function(j){ return { status: r.status, body: j }; }); })
  .then(function(res){
    hideLoading();
    if (res.status === 200 && res.body && res.body.ok) {
      // Success — adopt the image path rewrites into the live data and drop the
      // now-committed base64 blobs from memory.
      built.rewrites.forEach(function(rw){
        var p = ALL_PRODUCTS.find(function(x){ return String(x.item_code) === String(rw.code); });
        if (p) p.image = rw.path;
        if (window.IMAGES) delete window.IMAGES[rw.key];
      });
      if (typeof removeDownloadHighlight === 'function') removeDownloadHighlight();
      if (typeof updateSaveIndicator === 'function') { try { window.HAS_UNSAVED_CHANGES = false; updateSaveIndicator(); } catch(e){} }
      var short = res.body.commit ? String(res.body.commit).slice(0,7) : '';
      showToast('Published ✓ ' + (short ? '('+short+') ' : '') + 'Live in ~1–2 min.');
      try{localStorage.setItem('ugreen_last_publish',String(Date.now()));}catch(e){}
    } else if (res.status === 401) {
      showToast('Wrong save password — nothing was published.');
    } else if (res.status === 409) {
      showToast('products.json changed on GitHub since load — reload the page, then save again.');
    } else {
      var msg = (res.body && res.body.error) ? res.body.error : ('HTTP ' + res.status);
      showToast('Publish failed: ' + msg + ' (your edits are safe — not lost).');
    }
  })
  .catch(function(err){
    hideLoading();
    showToast('Network error — could not reach the backend. Your edits are safe. (' + (err.message||err) + ')');
  });
}

/* Repurpose every admin "Save" action as the Publish-to-GitHub action.
   These override the download-to-file versions in ad