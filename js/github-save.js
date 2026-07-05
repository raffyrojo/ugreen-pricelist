/* GitHub save (Phase 5) — sends the in-memory product data to the Cloudflare
   Worker, which commits products.json (and any new images) to the repo.
   The GitHub token is never here; the admin types a save password per save.
   Loaded AFTER admin.js, so saveToGitHub()/saveAsNewVersion() defined here win. */

/* Build the payload: deep-copy products, and pull any session-uploaded images
   (base64 held in window.IMAGES, keyed by product.image) out as files to commit,
   rewriting those products to point at the committed file path. The live
   ALL_PRODUCTS is NOT mutated here — only on confirmed success (rollback-safe). */
function _b64utf8(str){ return btoa(unescape(encodeURIComponent(str))); }

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
  // -- Promo popup: persist config to data/promo.json (+ commit its image as a
  //    file). Both ride the newImages channel the Worker already commits, so no
  //    Worker change is needed. Makes the popup survive refresh + redeploy. --
  try{
    if (typeof PROMO_CONFIG !== 'undefined' && PROMO_CONFIG) {
      var pc = PROMO_CONFIG;
      var promoOut = {
        enabled: !!pc.enabled,
        linkUrl: pc.linkUrl || '',
        altText: pc.altText || 'UGREEN Promo',
        duration: (typeof pc.duration === 'number' ? pc.duration : 10),
        mediaType: pc.mediaType || 'image',
        image: ''
      };
      var pimg = pc.imageData || '';
      if (/^data:/.test(pimg)) {                       // fresh upload -> commit as a file
        var mm = pimg.match(/^data:([a-zA-Z0-9.+\/-]+);/);
        var mime = (mm && mm[1]) ? mm[1] : (promoOut.mediaType === 'video' ? 'video/mp4' : 'image/png');
        var extMap = {'image/png':'png','image/jpeg':'jpg','image/jpg':'jpg','image/webp':'webp','image/gif':'gif','video/mp4':'mp4','video/webm':'webm'};
        var pext = extMap[mime] || (promoOut.mediaType === 'video' ? 'mp4' : 'png');
        var ppath = 'images/promo/promo-' + Date.now() + '.' + pext;
        newImages[ppath] = pimg;
        promoOut.image = ppath;
        pc._pendingImagePath = ppath;                  // adopt into memory on success
      } else if (pimg) {
        promoOut.image = pimg;                          // already a committed path
      }
      newImages['data/promo.json'] = 'data:application/json;base64,' + _b64utf8(JSON.stringify(promoOut, null, 2));
    }
  }catch(e){}
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
      try{ if (typeof PROMO_CONFIG !== 'undefined' && PROMO_CONFIG && PROMO_CONFIG._pendingImagePath){ PROMO_CONFIG.imageData = PROMO_CONFIG._pendingImagePath; delete PROMO_CONFIG._pendingImagePath; } }catch(e){}
      if (typeof updateSaveIndicator === 'function') { try { window.HAS_UNSAVED_CHANGES = false; updateSaveIndicator(); } catch(e){} }
      // Published: these edits are now committed to products.json, so the local
      // "pending edits" overlay (ugreen_new_skus) is redundant. Clear it so the
      // dashboard "Pending Changes" KPI resets to 0 after a successful publish.
      try { if (typeof saveNewSkus === 'function') saveNewSkus([]); else localStorage.setItem('ugreen_new_skus','[]'); } catch(e){}
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
   These override the download-to-file versions in admin.js (this file loads last):
   - saveCurrentVersion(): the main "Save (vX)" CTA in the header + Version-History tab
   - saveAsNewVersion():   the "Save as New Version…" buttons in Import/Export + Version-History */
function saveCurrentVersion(){ saveToGitHub(); }
function saveAsNewVersion(){ saveToGitHub(); }
