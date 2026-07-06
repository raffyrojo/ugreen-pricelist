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


/* == Publish safety helpers (2026-07-06 hardening) ============================
   - _ugHash: cheap content fingerprint (djb2 + length) of the products JSON.
   - _checkRemoteDrift: compares GitHub's current products.json against the
     baseline this browser loaded at boot (window._UG_BASELINE, set in app.js).
     Catches the "edited from another device / another tab already published"
     case BEFORE we overwrite it. Never blocks publishing on network failure.
   - _verifyPublished: after a publish, re-reads raw.githubusercontent (which
     reflects commits immediately) and confirms the commit really landed --
     large commits have silently failed before. */
function _ugHash(s){ var h=5381,i=s.length; while(i) h=(h*33)^s.charCodeAt(--i); return (h>>>0).toString(36)+'-'+s.length; }

function _rawProductsUrl(){
  var gh=(window.CONFIG&&window.CONFIG.github)||{};
  if(!gh.owner||!gh.repo) return null;
  return 'https://raw.githubusercontent.com/'+gh.owner+'/'+gh.repo+'/'+(gh.branch||'main')+'/'+(gh.productsPath||'data/products.json')+'?nocache='+Date.now();
}

function _checkRemoteDrift(){
  return new Promise(function(resolve){
    var url=_rawProductsUrl(), base=window._UG_BASELINE;
    if(!url||!base||!base.hash){ resolve({drifted:false,remoteCount:null}); return; }
    var done=false;
    var t=setTimeout(function(){ if(!done){ done=true; resolve({drifted:false,remoteCount:null}); } },8000);
    fetch(url,{cache:'no-store'})
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(j){
        if(done) return; done=true; clearTimeout(t);
        if(!Array.isArray(j)){ resolve({drifted:false,remoteCount:null}); return; }
        resolve({ drifted: _ugHash(JSON.stringify(j)) !== base.hash, remoteCount: j.length });
      })
      .catch(function(){ if(!done){ done=true; clearTimeout(t); resolve({drifted:false,remoteCount:null}); } });
  });
}

function _verifyPublished(sentCount, sentHash){
  setTimeout(function(){
    var url=_rawProductsUrl(); if(!url) return;
    fetch(url,{cache:'no-store'})
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(j){
        if(!Array.isArray(j)){ showToast('\u26A0 Could not verify the publish \u2014 check GitHub before making further edits.'); return; }
        if(j.length===sentCount && (!sentHash || _ugHash(JSON.stringify(j))===sentHash)){
          showToast('Verified on GitHub \u2713 ('+sentCount+' products). Live site follows in ~1\u20132 min.');
        } else {
          showToast('\u26A0 GitHub shows '+j.length+' products but '+sentCount+' were sent. If this persists after a minute, re-publish (your data is still in this browser).');
        }
      })
      .catch(function(){});
  }, 5000);
}

function saveToGitHub(){
  var cfg = window.CONFIG || {};
  var endpoint = cfg.backend && cfg.backend.workerEndpoint;
  if (!endpoint) {
    showToast('No backend configured yet — set workerEndpoint in config.js. Downloading products.json instead.');
    if (typeof _downloadProductsJson === 'function') _downloadProductsJson();
    return;
  }
  /* -- Preflight: never publish an empty or obviously broken catalog -------- */
  if (!Array.isArray(ALL_PRODUCTS) || ALL_PRODUCTS.length === 0) {
    showToast('Refusing to publish: the product list is empty. Reload the page and try again.');
    return;
  }
  var warn = [];
  try {
    if (typeof _dataHealthCheck === 'function') {
      var h = _dataHealthCheck();
      if (h.dupCodes > 0) warn.push('\u2022 ' + h.dupCodes + ' duplicate item code(s): ' + (h.dupList||[]).slice(0,5).join(', '));
      if (h.noCode > 0)   warn.push('\u2022 ' + h.noCode + ' record(s) without an item code');
      if (h.dpGtSrp > 0)  warn.push('\u2022 ' + h.dpGtSrp + ' product(s) with Dealer Price above SRP');
    }
  } catch(e){}
  var base = window._UG_BASELINE;
  if (base && base.count && ALL_PRODUCTS.length < base.count) {
    var dropped = base.count - ALL_PRODUCTS.length;
    if (dropped >= 5 || dropped / base.count > 0.02) {
      warn.push('\u2022 Publishing ' + dropped + ' FEWER products than were loaded (' + base.count + ' \u2192 ' + ALL_PRODUCTS.length + ')');
    }
  }

  var built = _buildSavePayload();
  var imgCount = 0; for (var ik in built.newImages) { if (ik.indexOf('data/') !== 0) imgCount++; }
  var pendingCnt = 0; try { pendingCnt = (typeof loadNewSkus === 'function') ? loadNewSkus().length : 0; } catch(e){}

  /* -- One confirmation with a clear summary (and any warnings) ------------- */
  var summary = 'Publish to the LIVE site?\n\n' +
    '\u2022 ' + built.products.length + ' products' +
    (pendingCnt ? '\n\u2022 ' + pendingCnt + ' unpublished change(s) included' : '') +
    (imgCount ? '\n\u2022 ' + imgCount + ' new image(s) to commit' : '');
  if (warn.length) summary += '\n\n\u26A0 WARNINGS \u2014 review before continuing:\n' + warn.join('\n');
  if (!confirm(summary)) return;

  var pw = window.prompt('Enter the admin save password to publish to GitHub:');
  if (pw === null) return;                 // cancelled
  if (!pw) { showToast('Save cancelled — no password entered.'); return; }

  /* -- Drift check: has someone else changed products.json since we loaded? - */
  showLoading('Checking the live data on GitHub…');
  _checkRemoteDrift().then(function(drift){
    if (drift.drifted) {
      hideLoading();
      if (!confirm('\u26A0 products.json on GitHub has CHANGED since this page loaded' +
          (drift.remoteCount !== null ? ' (it now has ' + drift.remoteCount + ' products)' : '') + '.\n\n' +
          'Publishing now will OVERWRITE those newer changes with what you see here.\n\n' +
          'Safest: Cancel \u2192 reload the page \u2192 verify your edits \u2192 publish again.\n\nOverwrite anyway?')) {
        showToast('Publish cancelled \u2014 nothing was sent.');
        return;
      }
    }
    _doPublish(endpoint, cfg, pw, built);
  });
}

function _doPublish(endpoint, cfg, pw, built){
  var gh = cfg.github || {};
  var sentHash = null;
  try { sentHash = _ugHash(JSON.stringify(built.products)); } catch(e){}
  var body = {
    password: pw,
    products: built.products,
    newImages: built.newImages,
    productsPath: (gh.productsPath || 'data/products.json'),
    message: 'Updated products via Admin Panel'
  };

  showLoading('Publishing to GitHub…');
  /* Timeout guard: a hung Worker no longer leaves the overlay up forever. */
  var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  var kill = ctrl ? setTimeout(function(){ try{ ctrl.abort(); }catch(e){} }, 120000) : null;
  fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: ctrl ? ctrl.signal : undefined
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
      // Pending-image store is now committed (or orphaned) — clear it.
      try { if (typeof clearPendingImgs === 'function') clearPendingImgs(); } catch(e){}
      // New baseline = exactly what we just published (feeds the next drift check).
      try { window._UG_BASELINE = { count: built.products.length, hash: sentHash, ts: Date.now() }; } catch(e){}
      var short = res.body.commit ? String(res.body.commit).slice(0,7) : '';
      showToast('Published ✓ ' + (short ? '('+short+') ' : '') + 'Verifying on GitHub…');
      try{localStorage.setItem('ugreen_last_publish',String(Date.now()));}catch(e){}
      _verifyPublished(built.products.length, sentHash);
    } else if (res.status === 401) {
      showToast('Wrong save password — nothing was published.');
    } else if (res.status === 409) {
      showToast('products.json changed on GitHub since load — reload the page, then save again.');
    } else if (res.status === 413) {
      showToast('Publish failed: payload too large. Remove or re-add fewer new images, then publish again.');
    } else if (res.status >= 500) {
      showToast('Backend error (HTTP ' + res.status + '). The commit may NOT have landed — verifying…');
      _verifyPublished(built.products.length, sentHash);
    } else {
      var msg = (res.body && res.body.error) ? res.body.error : ('HTTP ' + res.status);
      showToast('Publish failed: ' + msg + ' (your edits are safe — not lost).');
    }
  })
  .catch(function(err){
    hideLoading();
    if (err && err.name === 'AbortError') {
      showToast('Publish timed out after 2 minutes. The commit may still have landed — verifying on GitHub…');
      _verifyPublished(built.products.length, sentHash);
    } else {
      showToast('Network error — could not reach the backend. Your edits are safe. (' + (err.message||err) + ')');
    }
  })
  .then(function(){ if (kill) clearTimeout(kill); });
}

/* Repurpose every admin "Save" action as the Publish-to-GitHub action.
   These override the download-to-file versions in admin.js (this file loads last):
   - saveCurrentVersion(): the main "Save (vX)" CTA in the header + Version-History tab
   - saveAsNewVersion():   the "Save as New Version…" buttons in Import/Export + Version-History */
function saveCurrentVersion(){ saveToGitHub(); }
function saveAsNewVersion(){ saveToGitHub(); }
