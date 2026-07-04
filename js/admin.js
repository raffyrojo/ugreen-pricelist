/* ─────────────────────────────────────────────────────────────────────────
   ADMIN (Phase 4) — auth (PIN), dashboard, SKU management, add/edit/delete/
   duplicate, image upload, Excel upload, categories, version history, health.
   Ported verbatim from v1.3.23. Persistence rewired to the CMS model:
   edits mutate the in-memory product list; "Save" writes products.json
   (Phase 5 commits it to GitHub). Admin-uploaded images live in window.IMAGES
   (base64) for the session; Phase 5 turns them into committed files.
   ───────────────────────────────────────────────────────────────────────── */

window.IMAGES = window.IMAGES || {};
var IMAGES = window.IMAGES;

var _errLog=[], _healthReport=null;
function _logErr(where,err){try{var m=(err&&err.message)||String(err);_errLog.push({t:Date.now(),where:String(where),msg:m});if(_errLog.length>60)_errLog.shift();if(window.console&&console.error)console.error('[UGREEN]['+where+']',err);}catch(e){}}

function _safe(fn,label){return function(){try{return fn.apply(this,arguments);}catch(e){_logErr(label||'fn',e);return '';}};}

function _num(v){var n=Number(v);return isNaN(n)?0:n;}

function _dataHealthCheck(){var r={products:0,images:0,dupCodes:0,missingPrice:0,missingImage:0,noCode:0,dpGtSrp:0,dupList:[]};try{r.products=(typeof ALL_PRODUCTS!=='undefined'&&ALL_PRODUCTS)?ALL_PRODUCTS.length:0;r.images=(typeof IMAGES!=='undefined'&&IMAGES)?Object.keys(IMAGES).length:0;var seen={};(typeof ALL_PRODUCTS!=='undefined'?ALL_PRODUCTS:[]||[]).forEach(function(p){if(!p)return;var ic=String(p.item_code||'');if(!ic){r.noCode++;}else if(seen[ic]){r.dupCodes++;if(r.dupList.length<10)r.dupList.push(ic);}else{seen[ic]=1;}var s=p.srp;if(s===null||s===undefined||s===''||isNaN(Number(s)))r.missingPrice++;if(!p.image)r.missingImage++;if(_num(p.dp)>_num(p.srp)&&_num(p.srp)>0)r.dpGtSrp++;});}catch(e){_logErr('healthCheck',e);}return r;}

function descHtml(desc,cls){if(!desc)return '';return '<div class="'+cls+'">'+esc(desc).replace(/\n/g,'<br>')+'</div>';}

var sheets=[...new Set(ALL_PRODUCTS.map(function(p){return p.sheet;}))].sort();
var categories=[...new Set(ALL_PRODUCTS.map(function(p){return p.category;}).filter(Boolean))].sort();
var VALID_CATEGORIES = categories.map(function(c){ return c.trim(); });
var VALID_SECTIONS   = sheets.map(function(s){ return s.trim(); });
var _validCatSet = new Set(VALID_CATEGORIES.map(function(c){ return c.toLowerCase(); }));
var _validSecSet = new Set(VALID_SECTIONS.map(function(s){ return s.toLowerCase(); }));
function matchCategory(val) {
  if (!val) return null;
  var lc = val.trim().toLowerCase();
  for (var i = 0; i < VALID_CATEGORIES.length; i++) {
    if (VALID_CATEGORIES[i].toLowerCase() === lc) return VALID_CATEGORIES[i];
  }
  return null;
}

function matchSection(val) {
  if (!val) return null;
  var lc = val.trim().toLowerCase();
  for (var i = 0; i < VALID_SECTIONS.length; i++) {
    if (VALID_SECTIONS[i].toLowerCase() === lc) return VALID_SECTIONS[i];
  }
  return null;
}

function validateProduct(p, isNew) {
  var errors = [];
  // Required fields
  if (!p.item_code || !String(p.item_code).trim()) errors.push('Item Code is required');
  if (!p.model || !String(p.model).trim()) errors.push('Model No is required');
  if (!p.product_name || !String(p.product_name).trim()) errors.push('Product Name is required');
  if (!p.category || !String(p.category).trim()) errors.push('Category is required');
  if (p.srp === null || p.srp === undefined || p.srp === '') errors.push('SRP is required');
  if (p.dp === null || p.dp === undefined || p.dp === '') errors.push('Dealer Price is required');
  // Numeric and non-negative
  if (p.srp !== null && p.srp !== undefined && p.srp !== '') {
    var srpN = Number(p.srp);
    if (isNaN(srpN) || srpN < 0) errors.push('SRP must be a non-negative number');
  }
  if (p.dp !== null && p.dp !== undefined && p.dp !== '') {
    var dpN = Number(p.dp);
    if (isNaN(dpN) || dpN < 0) errors.push('Dealer Price must be a non-negative number');
  }
  if (p.dp_volume !== null && p.dp_volume !== undefined && p.dp_volume !== '') {
    var dpvN = Number(p.dp_volume);
    if (isNaN(dpvN) || dpvN < 0) errors.push('Volume Price must be a non-negative number');
  }
  // DP <= SRP
  if (p.srp !== null && p.dp !== null && p.srp !== '' && p.dp !== '') {
    var srpV = Number(p.srp), dpV = Number(p.dp);
    if (!isNaN(srpV) && !isNaN(dpV) && dpV > srpV) errors.push('Dealer Price must be <= SRP');
  }
  // MOQ must be positive integer if provided
  if (p.moq !== null && p.moq !== undefined && p.moq !== '') {
    var moqN = Number(p.moq);
    if (!Number.isInteger(moqN) || moqN < 1) errors.push('MOQ must be a positive integer');
  }
  // Category & Section: accept any value (users can add new ones or rename existing)
  return errors;
}

function getCategoryMap(products) {
  var map = {};
  products.forEach(function(item) {
    var raw = normalizeSidebar(item.category) || 'Uncategorized';
    var key = raw.toLowerCase();
    if (!map[key]) {
      map[key] = { name: raw, count: 0 };
    }
    map[key].count++;
  });
  return Object.keys(map).map(function(k){ return map[k]; })
    .filter(function(cat){ return cat.count > 0; })
    .sort(function(a, b){ return a.name.localeCompare(b.name); });
}

function getSectionMap(products) {
  var map = {};
  products.forEach(function(item) {
    var raw = normalizeSidebar(item.sheet);
    if (!raw) return;
    var key = raw.toLowerCase();
    var displayName = normalizeSidebar(item.sheet_display) || raw
      .replace('A&V-','A&V: ').replace('Mobile-','Mobile: ')
      .replace('Transmission-','Transmission: ').replace('Flash-','Flash: ')
      .replace('Others-','Others: ');
    if (!map[key]) {
      map[key] = { name: displayName, value: raw, count: 0 };
    }
    map[key].count++;
  });
  return Object.keys(map).map(function(k){ return map[k]; })
    .filter(function(sec){ return sec.count > 0; })
    .sort(function(a, b){ return a.name.localeCompare(b.name); });
}

var _activityLog = [];
var _recentNewIds = {};
var _recentMergedIds = {};
function logActivity(action, itemCode, label) {
  _activityLog.unshift({ action: action, code: itemCode, label: label || itemCode, time: Date.now() });
  if (_activityLog.length > 20) _activityLog.length = 20;
  if (action === 'added' || action === 'uploaded') {
    _recentNewIds[itemCode] = Date.now();
  }
}

function findDuplicateByModelName(model, name, excludeCode) {
  if (!model && !name) return null;
  var mLow = (model||'').toLowerCase().trim();
  var nLow = (name||'').toLowerCase().trim();
  if (!mLow && !nLow) return null;
  return ALL_PRODUCTS.find(function(p) {
    if (excludeCode && p.item_code === excludeCode) return false;
    var pm = (p.model||'').toLowerCase().trim();
    var pn = (p.product_name||'').toLowerCase().trim();
    return mLow && nLow && pm === mLow && pn === nLow;
  }) || null;
}

function mergeFeatures(existing, incoming) {
  if (!incoming) return existing || '';
  if (!existing) return incoming;
  var elines = existing.split('\n').map(function(l){ return l.trim(); }).filter(Boolean);
  var ilines = incoming.split('\n').map(function(l){ return l.trim(); }).filter(Boolean);
  var set = {};
  elines.forEach(function(l){ set[l.toLowerCase()] = l; });
  ilines.forEach(function(l){ if (!set[l.toLowerCase()]) { set[l.toLowerCase()] = l; } });
  return Object.keys(set).map(function(k){ return set[k]; }).join('\n');
}

function isRecentlyMerged(code) {
  var t = _recentMergedIds[code];
  if (!t) return false;
  if (Date.now() - t > 300000) { delete _recentMergedIds[code]; return false; }
  return true;
}

function isRecentlyNew(code) {
  var t = _recentNewIds[code];
  if (!t) return false;
  if (Date.now() - t > 300000) { delete _recentNewIds[code]; return false; }
  return true;
}

function renderActivityHtml() {
  if (!_activityLog.length) return '<div style="font-size:.72rem;color:var(--text-dim);padding:.5rem 0">No recent activity in this session.</div>';
  var _lastUpload = _activityLog.find(function(a){ return a.action === 'uploaded'; });
  var _lastEdit = _activityLog.find(function(a){ return a.action === 'edited' && a.code !== 'batch'; });
  var _summaryHtml = '<div style="font-size:.65rem;color:var(--text-dim);margin-bottom:6px;line-height:1.5">';
  if (_lastUpload) { var _luAgo = Math.round((Date.now()-_lastUpload.time)/60000); _summaryHtml += 'Last upload: ' + (_luAgo<1?'just now':_luAgo+'m ago') + ' \u00b7 '; }
  if (_lastEdit) { _summaryHtml += 'Last edit: ' + (_lastEdit.label||_lastEdit.code); }
  if (!_lastUpload && !_lastEdit) { _summaryHtml += 'Session started'; }
  _summaryHtml += '</div>';
  var _logItems = _activityLog.map(function(a) {
    var ago = Math.round((Date.now() - a.time) / 60000);
    var agoTxt = ago < 1 ? 'just now' : ago + 'm ago';
    return '<div class="activity-item">' +
      '<span class="activity-tag ' + a.action + '">' + a.action + '</span>' +
      '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + (a.label||a.code) + '</span>' +
      '<span class="activity-time">' + agoTxt + '</span></div>';
  }).join('');
  return _summaryHtml + _logItems;
}

function updateAll(opts) {
  opts = opts || {};
  sortCol = null;              // always reset to multi-level sort
  expandedKey = null;          // collapse any expanded row
  // v1.2.2: Rebuild category/section arrays so datalist options stay current
  categories = [...new Set(ALL_PRODUCTS.map(function(p){return p.category;}).filter(Boolean))].sort();
  sheets = [...new Set(ALL_PRODUCTS.map(function(p){return p.sheet;}))].sort();
  sortProducts(ALL_PRODUCTS);  // sort master data
  rebuildSidebar();            // recompute sidebar from data
  render();                    // re-render table/grid
  if (opts.manage) renderManage(); // refresh manage panel if open
}

function normalizeLength(str) {
  if (!str) return '';
  var s = String(str).trim().toUpperCase();
  var m = s.match(/^([\d.]+)\s*(M|CM|MM)?$/);
  if (!m) return str.trim(); // unrecognised format — keep as entered
  var n = parseFloat(m[1]);
  if (isNaN(n)) return str.trim();
  var unit = m[2] || 'M';
  // Drop unnecessary trailing zeros: 1.00 → 1, 1.50 → 1.5
  var display = (n % 1 === 0) ? String(Math.round(n)) : String(n);
  return display + unit;
}

var _sortLogEmitted = false;
var _VS_CHUNK=50;
var _vsRendered=0;
var _vsRows=[];
var _vsSentinel=null;
var _vsObserver=null;
var LS_KEY = 'ugreen_new_skus';
function loadNewSkus() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch(e){ return []; }
}

function saveNewSkus(arr) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(arr)); } catch(e){}
}

var NEW_DAYS = 30;
function isNewItem(dateStr) {
  if (!dateStr) return false;
  var created = new Date(dateStr);
  if (isNaN(created.getTime())) return false;
  var diff = (Date.now() - created.getTime()) / 86400000;
  return diff <= NEW_DAYS;
}

function isNewSku(p) {
  // v1.1.17: STRICT — a product is "new" iff it was explicitly marked isNew===true
  // when created via the admin panel. Editing never flips this. Base products
  // imported from the source Excel do NOT carry isNew and therefore never appear in
  // "New Items Only"; they are the baseline, not additions. Date-based fallback
  // (NEW_DAYS / current-month match) was removed because it made every edited product
  // look new when its dateAdded happened to match the current month.
  return p.isNew === true;
}

var _fileHandle = null;
var PROMO_CONFIG = {"enabled":false,"linkUrl":"","altText":"UGREEN Promo","duration":10,"mediaType":"image","imageData":""};
var DELETED_PRODUCTS = [];
function toggleMoreMenu(){
  document.getElementById('more-menu').classList.toggle('open');
}

function openPanel(tab) {
  document.getElementById('panel-overlay').classList.add('open');
  switchTab(tab || 'add');
}

function closePanel() { document.getElementById('panel-overlay').classList.remove('open'); if(typeof renderSkuTable==='function'&&document.getElementById('sku-tbody')&&isAdmin())renderSkuTable(); }

function closePanelOverlay(e) { /* v1.3.5: backdrop click no longer closes Admin Panel — prevents accidental close while editing. Use X, Close, or Log Out. */ }

function switchTab(tab) {
  document.getElementById('tab-add').classList.toggle('active', tab === 'add');
  document.getElementById('tab-manage').classList.toggle('active', tab === 'manage');
  if (tab === 'add') renderAddForm();
  else renderManage();
}

function getCategoryOptions() {
  return categories.map(function(c){ return '<option value="'+esc(c)+'">'+esc(c)+'</option>'; }).join('');
}

function getSheetOptions() {
  return sheets.map(function(s){
    var d = s.replace('A&V-','A&V: ').replace('Mobile-','Mobile: ').replace('Transmission-','Transmission: ').replace('Flash-','Flash: ').replace('Others-','Others: ');
    return '<option value="'+esc(s)+'">'+esc(d)+'</option>';
  }).join('');
}

function renameCategoryInline() {
  var input = document.getElementById('f-cat');
  var oldCat = input ? input.value.trim() : '';
  if (!oldCat) { showToast('Select a category first.'); return; }
  var exists = categories.indexOf(oldCat) >= 0;
  if (!exists) { showToast('"' + oldCat + '" is new — just save the SKU to create it.'); return; }
  var newCat = prompt('Rename category "' + oldCat + '" to:\n(All SKUs in this category will be updated)', oldCat);
  if (!newCat || newCat.trim() === '' || newCat.trim() === oldCat) return;
  newCat = newCat.trim();
  var count = 0;
  ALL_PRODUCTS.forEach(function(p) {
    if (p.category === oldCat) { p.category = newCat; count++; }
  });
  // Update derived arrays
  var ci = categories.indexOf(oldCat);
  if (ci >= 0) categories[ci] = newCat;
  categories.sort();
  input.value = newCat;
  rebuildSidebar();
  showToast('Renamed "' + oldCat + '" → "' + newCat + '" (' + count + ' SKUs updated)');
}

function renameSectionInline() {
  var input = document.getElementById('f-sheet');
  var oldSheet = input ? input.value.trim() : '';
  if (!oldSheet) { showToast('Select a section first.'); return; }
  var exists = sheets.indexOf(oldSheet) >= 0;
  if (!exists) { showToast('"' + oldSheet + '" is new — just save the SKU to create it.'); return; }
  var newSheet = prompt('Rename section "' + oldSheet + '" to:\n(All SKUs in this section will be updated)', oldSheet);
  if (!newSheet || newSheet.trim() === '' || newSheet.trim() === oldSheet) return;
  newSheet = newSheet.trim();
  var newDisplay = newSheet.replace('A&V-','A&V: ').replace('Mobile-','Mobile: ').replace('Transmission-','Transmission: ').replace('Flash-','Flash: ').replace('Others-','Others: ');
  var count = 0;
  ALL_PRODUCTS.forEach(function(p) {
    if (p.sheet === oldSheet) { p.sheet = newSheet; p.sheet_display = newDisplay; count++; }
  });
  var si = sheets.indexOf(oldSheet);
  if (si >= 0) sheets[si] = newSheet;
  sheets.sort();
  input.value = newSheet;
  rebuildSidebar();
  showToast('Renamed "' + oldSheet + '" → "' + newSheet + '" (' + count + ' SKUs updated)');
}

var editingCode = null;
var pendingImgB64 = null;
function renderAddForm(prefill) {
  var p = prefill || {};
  document.getElementById('panel-title').textContent = prefill ? 'Edit SKU' : 'Add New SKU';
  document.getElementById('panel-body').innerHTML =
    '<div class="form-grid">' +
      '<div class="form-field"><label>Item Code *</label><input id="f-ic" value="'+esc(p.item_code||'')+'" placeholder="e.g. 12345" oninput="checkDuplicateLive()"><span class="field-error" id="ic-err"></span></div>' +
      '<div class="form-field"><label>Model No.</label><input id="f-model" value="'+esc(p.model||'')+'" placeholder="e.g. HD104"></div>' +
      '<div class="form-field form-full"><label>Product Name *</label><input id="f-name" value="'+esc(p.product_name||'')+'" placeholder="e.g. HDMI 2.0 Male To Male Cable"></div>' +
      '<div class="form-field"><label>Category</label><div style="display:flex;gap:4px"><input id="f-cat" list="ug-cat-list" type="text" placeholder="Pick or type new" autocomplete="off" style="flex:1"><button type="button" class="btn-ghost" style="padding:2px 8px;font-size:.65rem;white-space:nowrap;border:1px solid var(--border);border-radius:4px" onclick="renameCategoryInline()" title="Rename this category across all SKUs">Rename</button></div><datalist id="ug-cat-list">'+getCategoryOptions()+'</datalist><span class="form-hint">Type a new name or pick existing. Rename updates all SKUs.</span></div>' +
      '<div class="form-field"><label>Section</label><div style="display:flex;gap:4px"><input id="f-sheet" list="ug-sheet-list" type="text" placeholder="Pick or type new" autocomplete="off" style="flex:1"><button type="button" class="btn-ghost" style="padding:2px 8px;font-size:.65rem;white-space:nowrap;border:1px solid var(--border);border-radius:4px" onclick="renameSectionInline()" title="Rename this section across all SKUs">Rename</button></div><datalist id="ug-sheet-list">'+getSheetOptions()+'</datalist><span class="form-hint">Type a new name or pick existing. Rename updates all SKUs.</span></div>' +
      '<div class="form-field"><label>Color</label><input id="f-color" value="'+esc(p.color||'')+'" placeholder="e.g. Black"></div>' +
      '<div class="form-field"><label>Length</label><input id="f-length" value="'+esc(p.length||'')+'" placeholder="e.g. 1.5M"></div>' +
    '</div>' +
    '<div class="form-grid three" style="margin-top:.85rem">' +
      '<div class="form-field"><label>SRP &#8369;</label><input id="f-srp" type="number" value="'+esc(String(p.srp||''))+'" placeholder="0.00" step="0.01"></div>' +
      '<div class="form-field"><label>DP &#8369;</label><input id="f-dp" type="number" value="'+esc(String(p.dp||''))+'" placeholder="0.00" step="0.01"></div>' +
      '<div class="form-field"><label>DP Volume &#8369;</label><input id="f-dpv" type="number" value="'+esc(String(p.dp_volume||''))+'" placeholder="0.00" step="0.01"></div>' +
      '<div class="form-field"><label>MOQ</label><input id="f-moq" type="number" value="'+esc(String(p.moq||''))+'" placeholder="0"></div>' +
      '<div class="form-field"><label>UPC</label><input id="f-upc" value="'+esc(p.upc||'')+'" placeholder="Barcode"></div>' +
      '<div class="form-field"><label>Material Number</label><input id="f-mat" value="'+esc(p.material_number||'')+'" placeholder="Mat. No."></div>' +
    '</div>' +
    '<div class="form-grid" style="margin-top:.85rem">' +
      '<div class="form-field form-full"><label>Description <span class="form-hint">One bullet point per line</span></label>' +
        '<textarea id="f-desc" rows="4" placeholder="HDMI Cable for 4K displays&#10;Compatible with PS5, Xbox">'+esc(parseBullets(p.description||'').join('\n'))+'</textarea></div>' +
      '<div class="form-field form-full"><label>Features <span class="form-hint">One feature per line</span></label>' +
        '<textarea id="f-feats" rows="3" placeholder="4K@60Hz&#10;Gold-plated connectors">'+esc(parseFeats(p.features||'').join('\n'))+'</textarea></div>' +
      '<div class="form-field form-full"><label>Image URL <span class="form-hint">Paste https:// link</span></label>' +
        '<input type="text" id="f-img-url" placeholder="https://example.com/product.jpg" value="'+(p.image&&/^https?:\/\//.test(p.image)?esc(p.image):'')+'"><div style="font-size:.6rem;color:var(--srp);margin:.25rem 0;line-height:1.4">\u26A0 URLs may fail in Excel/PDF exports if the source blocks CORS. <strong>File uploads are more reliable.</strong></div><div style="font-size:.62rem;color:var(--text-dim);margin:.3rem 0">OR upload file:</div>' +
        '<input type="file" id="f-img" accept="image/*" onchange="previewImg(this)"><div style="font-size:.62rem;color:var(--text-dim);margin-top:.3rem">Images are auto-optimized: max 1000px, ~50–150 KB. Originals stay on your device.</div>' +
        '<div id="img-preview-wrap">' + (p.image?'<img src="'+(imgSrc(p.image)||'')+'" class="img-preview" style="margin-top:6px">' : '') + '</div>' +
      '</div>' +
    '</div>' +
    '<div class="form-actions">' +
      '<button class="btn-ghost" onclick="closePanel()">Cancel</button>' +
      '<button id="btn-save-sku" class="btn-primary" onclick="saveSku()">Save SKU</button>' +
    '</div>';
  // v07: hybrid inputs use .value directly
  if (p.category) document.getElementById('f-cat').value = p.category;
  if (p.sheet)    document.getElementById('f-sheet').value = p.sheet;
  editingCode = p.item_code || null;
  pendingImgB64 = null;
}

function previewImg(input) {
  pendingImgB64 = null;
  if (!input.files || !input.files[0]) return;
  var file = input.files[0];
  var origSize = file.size;

  // v1.1.17: tighter compression — max 400px (was 1000px), always compress (no skip threshold),
  //          WebP-first (modern browsers) for smallest possible stored size.
  var MAX_DIM = 400;
  var LOSSY_QUALITY = 0.82;

  // One-time WebP capability check — canvas.toDataURL returns 'data:image/webp...' only if supported
  var _supportsWebP = (function() {
    try {
      var c = document.createElement('canvas'); c.width = 1; c.height = 1;
      return c.toDataURL('image/webp').indexOf('data:image/webp') === 0;
    } catch(e) { return false; }
  })();

  var reader = new FileReader();
  reader.onload = function(e) {
    var dataUrl = e.target.result;

    // Always run through canvas so dimensions are capped at MAX_DIM regardless of file size
    var img = new Image();
    img.onload = function() {
      var w = img.width, h = img.height;
      var ratio = Math.min(1, MAX_DIM / Math.max(w, h));
      var nw = Math.round(w * ratio), nh = Math.round(h * ratio);

      var canvas = document.createElement('canvas');
      canvas.width = nw; canvas.height = nh;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, nw, nh);

      var out, fmt;
      if (_supportsWebP) {
        // WebP handles both opaque and transparent images efficiently
        out = canvas.toDataURL('image/webp', LOSSY_QUALITY);
        fmt = 'WebP';
      } else {
        var hasAlpha = _detectTransparency(img);
        if (hasAlpha) {
          // Preserve alpha channel — PNG fallback
          out = canvas.toDataURL('image/png');
          fmt = 'PNG';
        } else {
          // Opaque — composite white background then JPEG
          ctx.globalCompositeOperation = 'destination-over';
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, nw, nh);
          ctx.globalCompositeOperation = 'source-over';
          out = canvas.toDataURL('image/jpeg', LOSSY_QUALITY);
          fmt = 'JPEG';
        }
      }

      // Rough byte estimate: base64 chars × 0.75
      var newSize = Math.round((out.length - out.indexOf(',') - 1) * 0.75);
      pendingImgB64 = out;
      _showImgPreview(out);

      var pct = Math.round(100 * (1 - newSize / origSize));
      var origKB = Math.round(origSize / 1024);
      var newKB  = Math.round(newSize / 1024);
      var note = 'Image optimized: ' + origKB + ' KB \u2192 ' + newKB + ' KB (' + pct + '% smaller, ' + nw + '\u00d7' + nh + ' ' + fmt + ')';
      try { showToast(note); } catch(e){}
    };
    img.onerror = function() {
      // Fallback: store original if canvas decode fails
      pendingImgB64 = dataUrl;
      _showImgPreview(dataUrl);
      try { showToast('Could not optimize image \u2014 stored as-is.'); } catch(e){}
    };
    img.src = dataUrl;
  };
  reader.readAsDataURL(file);
}

function _showImgPreview(dataUrl) {
  var wrap = document.getElementById('img-preview-wrap');
  if (wrap) wrap.innerHTML = '<img src="' + dataUrl + '" class="img-preview" style="margin-top:6px">';
}

function stripLeadingBullets(line) {
  return line.replace(/^[•\-\*\u2013\u2014\u25aa\u25cf▪]\s?/, '').trimStart();
}

function saveSku() {
  var ic   = String(document.getElementById('f-ic').value||'').trim().replace(/\s+/g,''); // no whitespace in codes
  var name = (document.getElementById('f-name').value||'').trim();
  var model = (document.getElementById('f-model').value||'').trim();
  var cat  = (document.getElementById('f-cat').value||'').trim();
  var srpVal = document.getElementById('f-srp').value;
  var dpVal  = document.getElementById('f-dp').value;
  var dpvVal = document.getElementById('f-dpv').value;
  var moqVal = document.getElementById('f-moq').value;

  // v1.3.0: Full validation using validateProduct()
  var _preCheck = {
    item_code: ic, model: model, product_name: name, category: cat,
    srp: srpVal !== '' ? parseFloat(srpVal) : null,
    dp: dpVal !== '' ? parseFloat(dpVal) : null,
    dp_volume: dpvVal !== '' ? parseFloat(dpvVal) : null,
    moq: moqVal !== '' ? parseInt(moqVal, 10) : null,
    sheet: (document.getElementById('f-sheet').value||'').trim()
  };
  var _errs = validateProduct(_preCheck, !editingCode);
  if (_errs.length) {
    showToast(_errs[0]); // show first error
    // Highlight relevant field
    var _fieldMap = {'Item Code':'f-ic','Model No':'f-model','Product Name':'f-name','Category':'f-cat','SRP':'f-srp','Dealer Price':'f-dp','Volume Price':'f-dpv','MOQ':'f-moq'};
    for (var _ek in _fieldMap) {
      if (_errs[0].indexOf(_ek) >= 0) {
        var _ef = document.getElementById(_fieldMap[_ek]);
        if (_ef) { _ef.style.borderColor = 'var(--srp)'; _ef.focus(); setTimeout(function(){ _ef.style.borderColor = ''; }, 2500); }
        break;
      }
    }
    return;
  }

  // ── Duplicate item_code guard ────────────────────────────────────────────
  var _icField = document.getElementById('f-ic');
  function _highlightErr(field) {
    if (!field) return;
    field.style.borderColor = 'var(--srp)';
    field.focus();
    setTimeout(function(){ field.style.borderColor = ''; }, 2500);
  }
  if (!editingCode) {
    var _dupAdd = ALL_PRODUCTS.find(function(p){ return p.item_code === ic; });
    if (_dupAdd) {
      showToast('Item Code "' + ic + '" already exists (' + (_dupAdd.product_name||'unknown') + ').');
      _highlightErr(_icField);
      return;
    }
  } else if (ic !== editingCode) {
    var _dupEdit = ALL_PRODUCTS.find(function(p){ return p.item_code === ic; });
    if (_dupEdit) {
      showToast('Item Code "' + ic + '" is already used by "' + (_dupEdit.product_name||ic) + '".');
      _highlightErr(_icField);
      return;
    }
  }
  // v1.3.8: Secondary duplicate check (model+name match)
  var _modField = document.getElementById('f-model');
  var _nameField = document.getElementById('f-name');
  var _secDup = findDuplicateByModelName(
    _modField ? _modField.value : '',
    _nameField ? _nameField.value : '',
    editingCode || null
  );
  if (_secDup && !editingCode) {
    if (!confirm('A similar product already exists:\n\nItem Code: ' + _secDup.item_code + '\nModel: ' + (_secDup.model||'N/A') + '\nName: ' + (_secDup.product_name||'N/A') + '\n\nContinue adding this SKU anyway?')) {
      return;
    }
  }
  // ── End duplicate guard ───────────────────────────────────────────────────

  // v1.3.0: Standardize Category/Section casing to match predefined values
  cat = matchCategory(cat) || cat;
  var sheet = matchSection(document.getElementById('f-sheet').value) || document.getElementById('f-sheet').value;
  var sheetDisplay = sheet.replace('A&V-','A&V: ').replace('Mobile-','Mobile: ').replace('Transmission-','Transmission: ').replace('Flash-','Flash: ').replace('Others-','Others: ');
  var descLines = (document.getElementById('f-desc').value||'').split('\n').map(function(l){return stripLeadingBullets(l.trim());}).filter(Boolean);
  var featLines = (document.getElementById('f-feats').value||'').split('\n').map(function(l){return stripLeadingBullets(l.trim());}).filter(Boolean);
  var now = new Date();
  // v1.1.17: "New Item" tag fix — PRESERVE dateAdded/created_at on EDIT so editing
  // an SKU never re-tags it as "new". Only stamp them fresh when creating a brand-new SKU.
  // Root cause of bug: every save used to rewrite dateAdded to the current month,
  // which made isNewSku() return true for edited SKUs and pollute the "New Items Only" filter.
  var prevProduct = editingCode ? ALL_PRODUCTS.find(function(x){return String(x.item_code)===String(editingCode);}) : null;
  var dateAdded = (prevProduct && prevProduct.dateAdded)
    ? prevProduct.dateAdded                                                        // EDIT: keep original
    : (now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0'));        // ADD: stamp today
  // created_at: ISO timestamp — preserved on edit, stamped on add. If an edited
  // base product has no created_at (source import), leave it null so isNewSku()
  // falls back to date-based detection via dateAdded (which is now preserved).
  var created_at = editingCode
    ? ((prevProduct && prevProduct.created_at) || null)
    : now.toISOString();
  // v1.1.17: STRICT isNew handling — the single source of truth for "New" badge.
  //   ADD  → isNew = true (explicit, one-time stamp at creation).
  //   EDIT → preserve whatever value the existing record holds. If prevProduct.isNew
  //          is true, keep it true. If undefined (base product), leave it undefined so
  //          the product continues to be treated as baseline (not in "New Items Only").
  // Explicit-protection pattern: formData.isNew = existingItem.isNew on edit; the only
  // place isNew is set to true is here, for brand-new creations. Editing NEVER retags.
  var isNewFlag;
  if (editingCode && prevProduct) {
    isNewFlag = prevProduct.isNew; // preserve exact value — may be true, false, or undefined
  } else {
    isNewFlag = true; // creation: stamp explicitly
  }
  var imgKey = null;
  var urlInput = document.getElementById('f-img-url');
  var imgUrl = urlInput ? urlInput.value.trim() : '';
  if (pendingImgB64) {
    imgKey = 'custom_'+ic; IMAGES[imgKey] = pendingImgB64;
  } else if (imgUrl && /^https?:\/\//.test(imgUrl)) {
    imgKey = imgUrl; // store URL directly
  } else if (editingCode) {
    var prev = ALL_PRODUCTS.find(function(x){return String(x.item_code)===String(editingCode);});
    if (prev && prev.image) imgKey = prev.image;
  }
  var p = {
    item_code: ic, model: model,
    product_name: name, category: cat,
    sheet: sheet, sheet_display: sheetDisplay,
    color: (document.getElementById('f-color').value||'').trim(),
    length: normalizeLength(document.getElementById('f-length').value||''),
    srp: parseFloat(document.getElementById('f-srp').value)||null,
    dp:  parseFloat(document.getElementById('f-dp').value)||null,
    dp_volume: parseFloat(document.getElementById('f-dpv').value)||null,
    moq: parseInt(document.getElementById('f-moq').value)||null,
    upc: (document.getElementById('f-upc').value||'').trim(),
    material_number: (document.getElementById('f-mat').value||'').trim(),
    description: descLines.join('\n'),
    features: featLines.length ? '*placeholder\n'+featLines.map(function(f){return '*'+f;}).join('\n') : '',
    remarks: '', image: imgKey||'', dateAdded: dateAdded, created_at: created_at
  };
  // v1.1.17: only attach isNew when we have a value (true on add, preserved on edit).
  // Leave it off entirely when editing a base product that never had an isNew flag,
  // so isNewSku() continues to fall back to its date-based logic.
  if (isNewFlag !== undefined) p.isNew = isNewFlag;
  var custom = loadNewSkus();
  var idx = custom.findIndex(function(x){return String(x.item_code)===String(ic);});
  // v1.1.17: MERGE instead of replace — preserves any fields on the existing record
  // that aren't rebuilt from the form (future-proofing, and matches the spec).
  if (idx >= 0) Object.assign(custom[idx], p); else custom.push(p);
  saveNewSkus(custom);
  var gi = ALL_PRODUCTS.findIndex(function(x){return String(x.item_code)===String(ic);});
  if (gi >= 0) Object.assign(ALL_PRODUCTS[gi], p); else ALL_PRODUCTS.push(p);
  updateAll();
  closePanel();
  var msg = editingCode ? 'SKU "'+ic+'" updated ✓' : 'SKU "'+ic+'" added ✓';
  logActivity(editingCode ? 'edited' : 'added', ic, (p.product_name||ic));
  autoSave(); markUnsaved();
  showToast(msg);
  editingCode = null; pendingImgB64 = null;
}

function renderManage() {
  document.getElementById('panel-title').textContent = 'Manage SKUs';
  var custom = loadNewSkus();
  var deletedCount = 0;
  try { deletedCount = JSON.parse(localStorage.getItem('ugreen_deleted')||'[]').length; } catch(e){}
  if (!custom.length && !deletedCount) {
    document.getElementById('panel-body').innerHTML = '<div class="manage-empty">No custom SKUs yet.<br><span style="font-size:0.7rem;color:var(--text-dim)">Expand any product row and click ✏️ Edit SKU to make changes.</span></div>';
    return;
  }
  var deletedIds = [];
  try { deletedIds = JSON.parse(localStorage.getItem('ugreen_deleted')||'[]'); } catch(e){}
  var deletedBlock = '';
  if (deletedIds.length) {
    deletedBlock = '<div style="margin-bottom:1rem">'+'<div class="adm-section-title" style="margin-bottom:.5rem">'+'Removed Products (' + deletedIds.length + ') — '+'<button onclick="restoreAllDeleted()" style="background:none;border:none;color:var(--accent);font-size:0.7rem;cursor:pointer;font-family:\u0027Metropolis\u0027,\u0027Helvetica Neue\u0027,Arial,sans-serif;text-decoration:underline">Restore All</button></div>'+'<div class="features-list">'+deletedIds.map(function(ic){return '<span class="feature-chip" style="display:inline-flex;align-items:center;gap:6px">'+esc(ic)+'<button onclick="restoreDeleted(\''+escAttr(ic)+'\')" style="background:none;border:none;color:var(--accent);cursor:pointer;font-size:0.7rem;padding:0">&#x21A9;</button></span>';}).join('')+'</div></div>';
  }
  document.getElementById('panel-body').innerHTML = deletedBlock + '<div class="manage-list">' +
    (custom.length ? '' : '<div class="manage-empty" style="padding:1rem">No custom SKUs. Expand any row and click ✏️ Edit SKU.</div>') +
    custom.map(function(p) {
      var src = p.image ? IMAGES[p.image] : null;
      return '<div class="manage-item">' +
        (src ? '<img src="'+src+'" class="img-preview">' :
          '<div style="width:60px;height:60px;background:var(--bg);border:1px solid var(--border);border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:0.6rem;color:var(--text-dim)">No Img</div>') +
        '<div class="manage-item-info">' +
          '<div class="manage-item-code">'+esc(p.item_code)+'<span class="badge-new" style="margin-left:6px">'+esc(p.dateAdded)+'</span></div>' +
          '<div class="manage-item-name">'+esc(p.product_name)+'</div>' +
        '</div>' +
        (isAdmin()?'<button class="btn-ghost" style="font-size:.72rem;padding:.3rem .7rem" onclick="editSku(\''+escAttr(p.item_code)+'\')">Edit</button>':'') +
        (isAdmin()?'<button class="btn-danger" onclick="deleteSku(\''+escAttr(p.item_code)+'\')">Delete</button>':'') +
      '</div>';
    }).join('') + '</div>';
}

function editSku(ic) {
  // Look in full product list (covers originals + custom)
  var p = ALL_PRODUCTS.find(function(x){return String(x.item_code)===String(ic);})
       || loadNewSkus().find(function(x){return String(x.item_code)===String(ic);});
  if (p) { switchTab('add'); renderAddForm(p); }
}

function adminEditProduct(ic) {
  requireAdmin(function(){
    var p = ALL_PRODUCTS.find(function(x){return String(x.item_code)===String(ic);});
    if (p) { openPanel('add'); renderAddForm(p); }
  });
}

function adminDeleteProduct(ic) {
  requireAdmin(function(){
    var p = ALL_PRODUCTS.find(function(x){return String(x.item_code)===String(ic);});
    var name = p ? p.product_name : ic;
    if (!confirm('Remove "' + name + '" from the price list?\n\nThis can be undone any time from Admin \u2192 Manage \u2192 Removed Products.')) return;
    var custom = loadNewSkus().filter(function(x){return String(x.item_code)!==String(ic);});
    saveNewSkus(custom);
    try {
      var deleted = JSON.parse(localStorage.getItem('ugreen_deleted')||'[]');
      if (!deleted.includes(ic)) deleted.push(ic);
      localStorage.setItem('ugreen_deleted', JSON.stringify(deleted));
    } catch(e){}
    var gi = ALL_PRODUCTS.findIndex(function(x){return String(x.item_code)===String(ic);});
    if (gi>=0) {
      // v01.3: stash removed product in memory so Restore works without refresh
      DELETED_PRODUCTS.push(ALL_PRODUCTS[gi]);
      ALL_PRODUCTS.splice(gi,1);
    }
    updateAll();
    autoSave(); markUnsaved();
    logActivity('deleted', ic, name||ic);
    showToast('"' + ic + '" removed. Restore from Admin \u2192 Manage if needed.');
  });
}

function deleteSku(ic) {
  var p = loadNewSkus().find(function(x){return String(x.item_code)===String(ic);});
  var name = p ? p.product_name : ic;
  if (!confirm('Permanently remove "' + name + '" ('+ic+')?' )) return;
  var custom = loadNewSkus().filter(function(x){return String(x.item_code)!==String(ic);});
  saveNewSkus(custom);
  var gi = ALL_PRODUCTS.findIndex(function(x){return String(x.item_code)===String(ic);});
  if (gi >= 0) ALL_PRODUCTS.splice(gi,1);
  updateAll({manage: true});
  autoSave(); markUnsaved();
  showToast('SKU "' + ic + '" deleted.');
}

function restoreDeleted(ic) {
  try {
    var deleted = JSON.parse(localStorage.getItem('ugreen_deleted')||'[]');
    deleted = deleted.filter(function(x){return x!==ic;});
    localStorage.setItem('ugreen_deleted', JSON.stringify(deleted));
  } catch(e){}
  // v01.3: live-restore using in-memory DELETED_PRODUCTS — no refresh needed
  var idx = DELETED_PRODUCTS.findIndex(function(p){ return p.item_code === ic; });
  var ok = false;
  if (idx >= 0) {
    var p = DELETED_PRODUCTS.splice(idx, 1)[0];
    if (!ALL_PRODUCTS.some(function(x){ return x.item_code === ic; })) {
      ALL_PRODUCTS.push(p);
      updateAll();
      ok = true;
    }
  }
  showToast(ok ? ('Restored "' + ic + '" — back in the list.')
                : ('Restored "' + ic + '" — refresh to see it.'));
  renderManage();
  autoSave(); markUnsaved();
}

function restoreAllDeleted() {
  try { localStorage.removeItem('ugreen_deleted'); } catch(e){}
  // v01.3: live-restore all from in-memory snapshot
  var n = DELETED_PRODUCTS.length;
  if (n > 0) {
    DELETED_PRODUCTS.forEach(function(p){
      if (!ALL_PRODUCTS.some(function(x){ return x.item_code === p.item_code; })) {
        ALL_PRODUCTS.push(p);
      }
    });
    DELETED_PRODUCTS.length = 0;
    updateAll();
    showToast('Restored ' + n + ' product(s) — all back in the list.');
  } else {
    showToast('Nothing to restore.');
  }
  renderManage();
  autoSave(); markUnsaved();
}

var _ac = (function() {
  // v01.6.3: hardened admin auth. Default admin PIN stored as SHA-256 hash — not recoverable from view-source.
  // PIN changes are hashed before storage. Legacy plaintext PINs auto-migrate to hash on first unlock.
  // Editing features stay locked until a valid PIN is entered, even when the HTML file is shared.
  var _sk=['_ug','9s','k_'].join(''), _pk=['_ug','9p','k_'].join('');
  // SHA-256 hash of the default admin PIN
  var _dh='9ec5adcb162fea7bdcefce818598776ef77423ee0f29bcbe8d5f564b7bd47703';
  /* v1.2.8: Persist lockout in localStorage so reload doesn't reset (audit S-4) */
  var _lkKey='_ug9_lockout';
  function _ldLock(){try{var d=JSON.parse(localStorage.getItem(_lkKey)||'{}');return{f:d.f||0,t:d.t||0};}catch(e){return{f:0,t:0};}}
  function _svLock(f,t){try{localStorage.setItem(_lkKey,JSON.stringify({f:f,t:t}));}catch(e){}}
  function _clrLock(){try{localStorage.removeItem(_lkKey);}catch(e){}}
  function _mkTok(){return btoa([Date.now().toString(36),'_','ug9k'].join(''));}
  function _chk(){try{var r=sessionStorage.getItem(_sk);if(!r)return false;var d=atob(r);return d.indexOf('_ug9k')>0&&d.length>10;}catch(e){return false;}}
  function _hash(pin){
    if (!(window.crypto && window.crypto.subtle && window.crypto.subtle.digest)) {
      return Promise.reject(new Error('Web Crypto unavailable in this browser — please use Chrome, Edge, Firefox, or Safari 11+.'));
    }
    var buf = new TextEncoder().encode(String(pin));
    return window.crypto.subtle.digest('SHA-256', buf).then(function(h){
      var arr = new Uint8Array(h); var hex='';
      for (var i=0;i<arr.length;i++){ var b=arr[i].toString(16); if(b.length<2)b='0'+b; hex+=b; }
      return hex;
    });
  }
  function _rd(){
    var v = localStorage.getItem(_pk);
    if (v && v.length===64 && /^[0-9a-f]+$/i.test(v)) return v;
    return _dh;
  }
  function _wrHash(h){ try{ localStorage.setItem(_pk, h); }catch(e){} }
  function _rv(){sessionStorage.removeItem(_sk);}
  function _try(pin){
    var now=Date.now(); var lk=_ldLock();
    if(now<lk.t)return Promise.resolve({ok:false,wait:Math.ceil((lk.t-now)/1000)});
    return _hash(pin).then(function(hp){
      // Legacy migration: stored plaintext (not 64-char hex) matches input → upgrade to hash and let in.
      var stored = localStorage.getItem(_pk);
      var isLegacy = !!(stored && (stored.length!==64 || !/^[0-9a-f]+$/i.test(stored)));
      if (isLegacy && pin === stored) {
        _wrHash(hp); sessionStorage.setItem(_sk,_mkTok()); _clrLock();
        return {ok:true, migrated:true};
      }
      if (hp === _rd()) {
        sessionStorage.setItem(_sk,_mkTok()); _clrLock(); return {ok:true};
      }
      var nf=lk.f+1;
      if (nf>=3) { var wait=Math.min(30*(1<<Math.floor((nf-3)/3)),300); var lt=Date.now()+wait*1000; _svLock(nf,lt); return {ok:false,wait:wait}; }
      _svLock(nf,0); return {ok:false,left:3-nf};
    }).catch(function(e){ return {ok:false, err:(e&&e.message)||'Hash error'}; });
  }
  function _setPin(pin){
    if(!_chk()) return Promise.resolve(false);
    return _hash(pin).then(function(h){ _wrHash(h); return true; })
      .catch(function(){ return false; });
  }
  return{check:_chk,revoke:_rv,setPin:_setPin,attempt:_try,hash:_hash};
})();
function isAdmin()    { return _ac.check(); }

function adminLogout(){ _ac.revoke(); refreshAdminUI(); closeAdminModal(); }

function refreshAdminUI() {
  var btn=document.getElementById('admin-header-btn');
  var badge=document.getElementById('admin-mode-badge');
  var rbAdm=document.getElementById('btn-rollback-upload-adm');
  if (!btn) return;
  if (_ac.check()) {
    btn.innerHTML='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'; btn.title='Admin Panel'; btn.classList.add('active');
    if(badge) badge.style.display='';
    if(rbAdm && _uploadSnapshot) rbAdm.style.display='';
  } else {
    btn.innerHTML='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'; btn.title='Admin Login'; btn.classList.remove('active');
    if(badge) badge.style.display='none';
    if(rbAdm) rbAdm.style.display='none';
  }
}

function requireAdmin(cb){ if(_ac.check()){cb();return;} openAdminModal(cb); }

var _admCb=null, _cdTimer=null;
function openAdminModal(cb){ _admCb=cb||null; document.getElementById('adm-overlay').classList.add('open'); renderAdminContent(); }

function closeAdminModal() { document.getElementById('adm-overlay').classList.remove('open'); _admCb=null; }

function closeAdminModalOutside(e){ /* v1.3.5: backdrop click no longer closes login modal — prevents accidental close. Use the × button. */ }

function _admEsc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

function _admSectionCounts(){var c={};for(var i=0;i<ALL_PRODUCTS.length;i++){var s=ALL_PRODUCTS[i].sheet_display||ALL_PRODUCTS[i].sheet||'Other';c[s]=(c[s]||0)+1;}var a=Object.keys(c).map(function(k){return {k:k,v:c[k]};});a.sort(function(x,y){return y.v-x.v;});return a;}

function renderSectionChartHtml(){var a=_admSectionCounts();if(!a.length)return '<div style="font-size:.75rem;color:var(--text-dim);text-align:center;padding:1rem">No products</div>';var top=a.slice(0,8);var others=a.slice(8).reduce(function(s,x){return s+x.v;},0);if(others>0)top.push({k:'Other ('+(a.length-8)+' sections)',v:others});var max=Math.max.apply(null,top.map(function(x){return x.v;}))||1;return top.map(function(x){var pct=Math.max(4,Math.round(x.v/max*100));return '<div class="adm-chart-row"><span class="adm-chart-label" title="'+_admEsc(x.k)+'">'+_admEsc(x.k)+'</span><span class="adm-chart-track"><span class="adm-chart-fill" style="width:'+pct+'%"></span></span><span class="adm-chart-num">'+x.v+'</span></div>';}).join('');}

function renderAdminSnapshotHtml(){var a=_admSectionCounts();var lg=a.length?a[0]:{k:'-',v:0};function row(l,v){return '<div class="adm-snap-row"><span>'+l+'</span><b>'+v+'</b></div>';}return row('Sections',a.length)+row('Largest',_admEsc(lg.k)+' ('+lg.v+')')+row('Products',ALL_PRODUCTS.length)+row('Hidden',DELETED_PRODUCTS.length)+row('Pending edits',loadNewSkus().length);}

function admTab(el,id){var items=el.parentNode.querySelectorAll('.adm-rail-item');for(var i=0;i<items.length;i++)items[i].classList.remove('active');el.classList.add('active');var tabs=document.querySelectorAll('.adm-tab');for(var j=0;j<tabs.length;j++)tabs[j].classList.remove('active');var t=document.getElementById(id);if(t)t.classList.add('active');if(id==='tab-sku'&&typeof renderSkuTable==='function')renderSkuTable();var tt=document.getElementById('adm-tab-title');if(tt)tt.textContent=(el.textContent||'').replace(/\s+/g,' ').trim();var cr=document.getElementById('adm-crumb');if(cr)cr.textContent=(el.textContent||'').replace(/\s+/g,' ').trim();if(typeof admCloseRail==='function')admCloseRail();var sc=document.querySelector('.adm-main-scroll');if(sc)sc.scrollTop=0;}

function renderPriceDistHtml(){var b=[["₱0 – 500",0,500,0],["₱500 – 2,000",500,2000,0],["₱2,000 – 5,000",2000,5000,0],["₱5,000+",5000,Infinity,0]];for(var i=0;i<ALL_PRODUCTS.length;i++){var v=Number(ALL_PRODUCTS[i].srp)||0;for(var k=0;k<b.length;k++){if(v>=b[k][1]&&v<b[k][2]){b[k][3]++;break;}}}var mx=Math.max.apply(null,b.map(function(x){return x[3];}))||1;return b.map(function(x){var p=Math.max(3,Math.round(x[3]/mx*100));return '<div class="adm-chart-row"><span class="adm-chart-label">'+x[0]+'</span><span class="adm-chart-track"><span class="adm-chart-fill" style="width:'+p+'%"></span></span><span class="adm-chart-num">'+x[3]+'</span></div>';}).join('');}

function renderCategoriesTableHtml(){var a=_admSectionCounts().slice().sort(function(x,y){return x.k.localeCompare(y.k);});var EYE='<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';var rows=a.map(function(x){return '<tr><td>'+_admEsc(x.k)+'</td><td style="text-align:right;font-weight:700;color:var(--accent)">'+x.v+'</td><td style="text-align:right"><button class="adm-cat-view" title="View products in this category" onclick="viewCategory(\''+escAttr(x.k)+'\')">'+EYE+'</button></td></tr>';}).join('');return '<table class="adm-cat-table"><thead><tr><th>Category / Section</th><th style="text-align:right">Products</th><th style="text-align:right">View</th></tr></thead><tbody>'+rows+'</tbody></table>';}

function renderSkuCatOptions(){var a=_admSectionCounts().slice().sort(function(x,y){return x.k.localeCompare(y.k);});return '<option value="">All categories</option>'+a.map(function(x){return '<option value="'+_admEsc(x.k)+'">'+_admEsc(x.k)+' ('+x.v+')</option>';}).join('');}

function _skuRows(){var g=function(id){var e=document.getElementById(id);return e?e.value:'';};var q=g('sku-search').trim().toLowerCase(),cat=g('sku-cat'),pr=g('sku-price'),sort=g('sku-sort')||'name';var r=ALL_PRODUCTS.filter(function(p){if(cat&&String(p.sheet_display||p.sheet||p.category)!==cat)return false;if(pr){var s=Number(p.srp)||0;if(pr==='a'&&!(s<500))return false;if(pr==='b'&&!(s>=500&&s<2000))return false;if(pr==='c'&&!(s>=2000&&s<5000))return false;if(pr==='d'&&!(s>=5000))return false;}if(q){var h=((p.product_name||'')+' '+(p.model||'')+' '+(p.item_code||'')+' '+(p.color||'')+' '+(p.upc||'')+' '+(p.material_number||'')).toLowerCase();if(h.indexOf(q)<0)return false;}return true;});r.sort(function(a,b){if(sort==='srp-asc')return (Number(a.srp)||0)-(Number(b.srp)||0);if(sort==='srp-desc')return (Number(b.srp)||0)-(Number(a.srp)||0);if(sort==='code')return String(a.item_code).localeCompare(String(b.item_code));return String(a.product_name||'').localeCompare(String(b.product_name||''));});return r;}

function renderSkuTable(){var rows=_skuRows(),cnt=document.getElementById('sku-count');if(cnt)cnt.textContent=rows.length+' of '+ALL_PRODUCTS.length+' SKUs';var tb=document.getElementById('sku-tbody');if(!tb)return;var ED='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';var TR='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';var cap=rows.slice(0,120);tb.innerHTML=cap.map(function(p){var src=imgSrc(p.image);var img=src?'<img src="'+src+'" alt="" loading="lazy">':'<div class="adm-sku-noimg"></div>';return '<tr><td class="adm-sku-imgcell">'+img+'</td><td><div class="adm-sku-pname">'+escAttr(p.product_name||'')+'</div><div class="adm-sku-pmeta">'+escAttr(p.sheet_display||p.sheet||p.category||'')+(p.color?' · '+escAttr(p.color):'')+'</div></td><td class="adm-sku-code">'+escAttr(p.item_code||'')+'</td><td>'+escAttr(p.model||'')+'</td><td class="adm-sku-price adm-sku-thr"><span class="adm-sku-srp">'+fmt(p.srp)+'</span><span class="adm-sku-dp">'+fmt(p.dp)+'</span></td><td><span class="adm-sku-status">Active</span></td><td class="adm-sku-actcell adm-sku-thr"><button class="adm-sku-act" title="Edit" onclick="adminEditProduct(\''+p.item_code+'\')">'+ED+'</button><button class="adm-sku-act del" title="Delete" onclick="adminDeleteProduct(\''+p.item_code+'\')">'+TR+'</button></td></tr>';}).join('')+(rows.length>120?'<tr><td colspan="7" class="adm-sku-more">Showing first 120 of '+rows.length+' — use search or filters to narrow.</td></tr>':'')+(rows.length===0?'<tr><td colspan="7" class="adm-sku-more">No products match your filters.</td></tr>':'');}

function skuFilter(){renderSkuTable();}

function viewCategory(cat){var items=document.querySelectorAll('.adm-rail-item');for(var i=0;i<items.length;i++){items[i].classList.remove('active');if((items[i].textContent||'').replace(/\s+/g,' ').trim()==='SKU Management')items[i].classList.add('active');}var tabs=document.querySelectorAll('.adm-tab');for(var j=0;j<tabs.length;j++)tabs[j].classList.remove('active');var t=document.getElementById('tab-sku');if(t)t.classList.add('active');var tt=document.getElementById('adm-tab-title');if(tt)tt.textContent='SKU Management';var sel=document.getElementById('sku-cat');if(sel)sel.value=cat;if(typeof renderSkuTable==='function')renderSkuTable();var sc=document.querySelector('.adm-main-scroll');if(sc)sc.scrollTop=0;}

function renderHealthHtml(){var h=_healthReport||(_healthReport=_dataHealthCheck());function row(l,v,bad){return '<div class="adm-snap-row"><span>'+l+'</span><b style="color:'+(bad?'#dc2626':'var(--text)')+'">'+v+'</b></div>';}return '<div class="adm-panel"><div class="adm-panel-head"><div class="adm-panel-title">System Health</div><div class="adm-panel-sub">Data integrity &amp; error monitor</div></div><div class="adm-snap">'+row('Products',h.products,false)+row('Images',h.images,false)+row('Duplicate item codes',h.dupCodes,h.dupCodes>0)+row('Missing / invalid prices',h.missingPrice,h.missingPrice>0)+row('Missing images',h.missingImage,h.missingImage>0)+row('Records without item code',h.noCode,h.noCode>0)+row('Dealer price &gt; SRP',h.dpGtSrp,h.dpGtSrp>0)+row('Errors logged this session',(_errLog?_errLog.length:0),(_errLog&&_errLog.length>0))+'</div><button class="btn-ghost" style="width:100%;margin-top:.65rem" onclick="admHealthRecheck()">Re-run health check</button></div>';}

function admHealthRecheck(){_healthReport=_dataHealthCheck();var el=document.getElementById('adm-health-slot');if(el)el.innerHTML=renderHealthHtml();try{showToast('Health check complete — '+_healthReport.products+' products, '+(_errLog?_errLog.length:0)+' errors logged.');}catch(e){}}

/* ===================================================================
   PHASE 1 - Enterprise workspace shell (appbar + collapsible rail).
   Builders assemble the authed admin dashboard. All existing tabs and
   handlers preserved; new sections (Pricing/Images/Reports) are
   navigable placeholders. Import/Export split into their own tabs.
   =================================================================== */
var _ADM_ICONS = {
  dash:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg>',
  sku:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>',
  cats:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>',
  pricing:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
  images:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
  imp:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>',
  exp:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  reports:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
  activity:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
  promo:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
  versions:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  settings:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>'
};
function _admRailItem(id,label,ico,active){return '<button class="adm-rail-item'+(active?' active':'')+'" data-tab="'+id+'" onclick="admTab(this,\''+id+'\')" title="'+label+'"><span class="adm-rail-ico">'+ico+'</span><span class="adm-rail-txt">'+label+'</span></button>';}
function _admRailHtml(){
  return '<aside class="adm-rail">'+
    '<div class="adm-rail-brand"><img class="adm-rail-logo" src="'+UGREEN_LOGO_DARK+'" alt="UGREEN"><span class="adm-rail-badge">Admin</span></div>'+
    '<nav class="adm-rail-nav">'+
      '<div class="adm-rail-group">Main</div>'+
      _admRailItem('tab-overview','Dashboard',_ADM_ICONS.dash,true)+
      _admRailItem('tab-sku','SKU Management',_ADM_ICONS.sku,false)+
      _admRailItem('tab-categories','Categories',_ADM_ICONS.cats,false)+
      '<div class="adm-rail-group">Catalog</div>'+
      _admRailItem('tab-pricing','Pricing',_ADM_ICONS.pricing,false)+
      _admRailItem('tab-images','Images',_ADM_ICONS.images,false)+
      '<div class="adm-rail-group">Data</div>'+
      _admRailItem('tab-import','Import',_ADM_ICONS.imp,false)+
      _admRailItem('tab-export','Export',_ADM_ICONS.exp,false)+
      _admRailItem('tab-reports','Reports',_ADM_ICONS.reports,false)+
      '<div class="adm-rail-group">System</div>'+
      _admRailItem('tab-activity','Activity Log',_ADM_ICONS.activity,false)+
      _admRailItem('tab-promo','Popup Ads',_ADM_ICONS.promo,false)+
      _admRailItem('tab-versions','Version History',_ADM_ICONS.versions,false)+
      _admRailItem('tab-settings','Settings',_ADM_ICONS.settings,false)+
    '</nav>'+
    '<div class="adm-rail-foot"><div class="adm-rail-user"><span class="adm-rail-avatar">RR</span><div><div class="adm-rail-uname">Raffy Rojo</div><div class="adm-rail-urole">Admin · '+APP_VERSION+'</div></div></div>'+
    '<button class="adm-rail-logout adm-rail-logoutbtn" onclick="adminLogout()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg><span>Logout</span></button></div>'+
    '</aside>';
}
function _admAppbarHtml(){
  return '<header class="adm-appbar">'+
    '<button class="adm-appbar-burger" onclick="admToggleRail()" title="Toggle menu" aria-label="Toggle menu"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg></button>'+
    '<img class="adm-appbar-logo" src="'+UGREEN_LOGO_DARK+'" alt="UGREEN">'+
    '<nav class="adm-crumbs" aria-label="Breadcrumb"><span class="adm-crumb-root">Admin</span><span class="adm-crumb-sep">/</span><span id="adm-crumb">Dashboard</span></nav>'+
    '<div class="adm-appbar-search"><span class="adm-appbar-search-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></span>'+
      '<input id="adm-global-search" type="text" placeholder="Search products, then Enter…" onkeydown="admGlobalSearch(event)" aria-label="Global search"></div>'+
    '<div class="adm-appbar-actions">'+
      '<button class="adm-ico-btn" title="Notifications" onclick="admNotifSoon()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg></button>'+
      '<button class="adm-ico-btn" title="Theme" onclick="admThemeSoon()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg></button>'+
      '<div class="adm-profile">'+
        '<button class="adm-profile-btn" onclick="admProfileToggle(event)" title="Account"><span class="adm-rail-avatar">RR</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>'+
        '<div class="adm-profile-menu" id="adm-profile-menu">'+
          '<div class="adm-profile-head"><div class="adm-profile-name">Raffy Rojo</div><div class="adm-profile-role">Admin · '+APP_VERSION+'</div></div>'+
          '<button class="adm-profile-item" onclick="adminLogout()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>Logout</button>'+
        '</div>'+
      '</div>'+
    '</div>'+
  '</header>';
}
function _admTabImportHtml(){
  return '<div class="adm-tab" id="tab-import">'+
    '<div class="adm-panel"><div class="adm-panel-head"><div class="adm-panel-title">Import</div><div class="adm-panel-sub">Bring products in from Excel</div></div>'+
      '<button class="btn-secondary" style="width:100%" onclick="closeAdminModal();document.getElementById(\'excel-upload-input\').click()">Upload Excel</button>'+
      '<div class="adm-soon-note">Drag-and-drop import wizard with live preview, validation &amp; conflict detection arrives in a later phase. The current Upload Excel flow (with its preview) is fully functional.</div>'+
    '</div>'+
  '</div>';
}
function _admTabExportHtml(){
  return '<div class="adm-tab" id="tab-export">'+
    '<div class="adm-panel"><div class="adm-panel-head"><div class="adm-panel-title">Export</div><div class="adm-panel-sub">Download the pricelist</div></div><div class="adm-io-grid">'+
      '<button class="btn-secondary" onclick="closeAdminModal();downloadPDF()">Price List (Quick)</button>'+
      '<button class="btn-secondary" onclick="closeAdminModal();openStyledPdf()">Price List (Detailed)</button>'+
      '<button class="btn-secondary" onclick="closeAdminModal();openCatalogPdf()">Product Catalog</button>'+
      '<button class="btn-secondary" onclick="closeAdminModal();downloadExcel(\'original\')">Excel (Data)</button>'+
      '<button class="btn-secondary" onclick="closeAdminModal();downloadExcel(\'recommended\')">Excel (Full)</button>'+
      '<button class="btn-secondary" onclick="closeAdminModal();saveAsNewVersion()">Save as New Version</button>'+
    '</div></div>'+
  '</div>';
}
function _admSoonTab(id,iconKey,title,sub,desc){
  return '<div class="adm-tab" id="'+id+'"><div class="adm-empty-state"><div class="adm-empty-ico">'+_ADM_ICONS[iconKey]+'</div><div class="adm-empty-title">'+title+'</div><div class="adm-empty-sub">'+sub+'</div><p class="adm-empty-desc">'+desc+'</p><span class="adm-soon-badge">Coming soon</span></div></div>';
}
function _admTabPricingHtml(){return _admSoonTab('tab-pricing','pricing','Pricing','Bulk pricing tools','Bulk SRP / dealer / volume controls, margin views and price-rule editing arrive in a later phase. For now, edit prices per SKU from SKU Management.');}
function _admTabImagesHtml(){return _admSoonTab('tab-images','images','Images','Image library','A visual image manager to browse, replace and optimize product images arrives in a later phase. Image upload still works from the SKU editor.');}
function _admTabReportsHtml(){return _admSoonTab('tab-reports','reports','Reports','Analytics & charts','Category distribution, price summaries and recently-updated analytics arrive in a later phase. Quick stats are on the Dashboard.');}
function _admTabActivityHtml(){
  return '<div class="adm-tab" id="tab-activity"><div class="adm-panel"><div class="adm-panel-head"><div class="adm-panel-title">Activity Log</div><div class="adm-panel-sub">Latest changes and actions this session</div></div><div style="max-height:62vh;overflow-y:auto">'+renderActivityHtml()+'</div></div></div>';
}
/* ---- Shell wiring (Phase 1) ---- */
function admToggleRail(){var s=document.getElementById('adm-shell');if(!s)return;if(window.matchMedia&&window.matchMedia('(max-width:760px)').matches){s.classList.toggle('rail-open');}else{s.classList.toggle('rail-collapsed');try{localStorage.setItem('ugreen_adm_rail',s.classList.contains('rail-collapsed')?'1':'0');}catch(e){}}}
function admCloseRail(){var s=document.getElementById('adm-shell');if(s)s.classList.remove('rail-open');}
function _admApplyRailPref(){try{var s=document.getElementById('adm-shell');if(!s)return;if(window.matchMedia&&window.matchMedia('(max-width:760px)').matches)return;if(localStorage.getItem('ugreen_adm_rail')==='1')s.classList.add('rail-collapsed');}catch(e){}}
function admGoSku(q){var items=document.querySelectorAll('.adm-rail-item');for(var i=0;i<items.length;i++){items[i].classList.remove('active');if(items[i].getAttribute('data-tab')==='tab-sku')items[i].classList.add('active');}var tabs=document.querySelectorAll('.adm-tab');for(var j=0;j<tabs.length;j++)tabs[j].classList.remove('active');var t=document.getElementById('tab-sku');if(t)t.classList.add('active');var tt=document.getElementById('adm-tab-title');if(tt)tt.textContent='SKU Management';var cr=document.getElementById('adm-crumb');if(cr)cr.textContent='SKU Management';var sel=document.getElementById('sku-search');if(sel)sel.value=q||'';if(typeof renderSkuTable==='function')renderSkuTable();admCloseRail();var sc=document.querySelector('.adm-main-scroll');if(sc)sc.scrollTop=0;}
function admGlobalSearch(ev){if(ev&&ev.key==='Enter'){admGoSku((ev.target.value||'').trim());}}
function admNotifSoon(){try{showToast('No new notifications');}catch(e){}}
function admThemeSoon(){try{showToast('Dark mode is coming in a later phase');}catch(e){}}
function admProfileToggle(ev){if(ev&&ev.stopPropagation)ev.stopPropagation();var m=document.getElementById('adm-profile-menu');if(m)m.classList.toggle('open');}
if(!window._admProfileDocBound){window._admProfileDocBound=true;document.addEventListener('click',function(e){var m=document.getElementById('adm-profile-menu');if(m&&m.classList.contains('open')&&!(e.target.closest&&e.target.closest('.adm-profile')))m.classList.remove('open');});}

/* ============ PHASE 2 - Dashboard (KPIs, analytics, quick actions) ============ */
function _admLastSync(){
  try{
    var t=localStorage.getItem('ugreen_last_publish');
    if(!t) return {v:'Not yet', s:'No publish this device'};
    var n=Number(t), diff=Date.now()-n, rel;
    if(diff<60000) rel='just now';
    else if(diff<3600000) rel=Math.floor(diff/60000)+'m ago';
    else if(diff<86400000) rel=Math.floor(diff/3600000)+'h ago';
    else rel=Math.floor(diff/86400000)+'d ago';
    return {v:rel, s:new Date(n).toLocaleString()};
  }catch(e){ return {v:'—', s:''}; }
}
function admBackup(){ try{ if(typeof _downloadProductsJson==='function'){ _downloadProductsJson(); } else { showToast('Backup unavailable'); } }catch(e){ try{showToast('Backup failed');}catch(_){}} }
function admFirebaseSoon(){ try{ showToast('Firebase sync is coming in a later phase'); }catch(e){} }
function _admQuickActionsHtml(){
  var UP=_ADM_ICONS.imp, DN=_ADM_ICONS.exp;
  var PLUS='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
  var DL='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
  var CLOUD='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/><polyline points="9 15 12 12 15 15"/><line x1="12" y1="12" x2="12" y2="20"/></svg>';
  var EYE='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  var FIRE='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>';
  return '<div class="adm-panel"><div class="adm-panel-head"><div class="adm-panel-title">Quick Actions</div><div class="adm-panel-sub">Common tasks</div></div>'+
    '<div class="adm-qa-grid">'+
      '<button class="adm-qa" onclick="closeAdminModal();openPanel(\x27add\x27)"><span class="adm-qa-ico">'+PLUS+'</span><span class="adm-qa-label">Add SKU</span></button>'+
      '<button class="adm-qa" onclick="closeAdminModal();document.getElementById(\x27excel-upload-input\x27).click()"><span class="adm-qa-ico">'+UP+'</span><span class="adm-qa-label">Import Excel</span></button>'+
      '<button class="adm-qa" onclick="closeAdminModal();downloadExcel(\x27recommended\x27)"><span class="adm-qa-ico">'+DN+'</span><span class="adm-qa-label">Export Excel</span></button>'+
      '<button class="adm-qa" onclick="admBackup()"><span class="adm-qa-ico">'+DL+'</span><span class="adm-qa-label">Backup JSON</span></button>'+
      '<button class="adm-qa adm-qa-accent" onclick="closeAdminModal();saveCurrentVersion()"><span class="adm-qa-ico">'+CLOUD+'</span><span class="adm-qa-label">Publish to GitHub</span></button>'+
      '<button class="adm-qa" onclick="closeAdminModal()"><span class="adm-qa-ico">'+EYE+'</span><span class="adm-qa-label">Open Pricelist</span></button>'+
      '<button class="adm-qa adm-qa-soon" onclick="admFirebaseSoon()"><span class="adm-qa-ico">'+FIRE+'</span><span class="adm-qa-label">Firebase Sync</span><span class="adm-qa-badge">Soon</span></button>'+
    '</div></div>';
}
function _admTabOverviewHtml(){
  var STAR='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
  var EDIT='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
  var SYNC='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>';
  var newCount=0; try{ for(var i=0;i<ALL_PRODUCTS.length;i++){ if(typeof isNewSku==='function'&&isNewSku(ALL_PRODUCTS[i])) newCount++; } }catch(e){}
  var pending=0; try{ pending=loadNewSkus().length; }catch(e){}
  var ls=_admLastSync();
  function kpi(ico,val,label,sub){ return '<div class="adm-kpi"><div class="adm-kpi-ico">'+ico+'</div><div class="adm-kpi-val">'+val+'</div><div class="adm-kpi-label">'+label+'</div>'+(sub?'<div class="adm-kpi-sub">'+sub+'</div>':'')+'</div>'; }
  return '<div class="adm-tab active" id="tab-overview">'+
    '<div class="adm-kpi-row k5">'+
      kpi(_ADM_ICONS.sku, ALL_PRODUCTS.length, 'Total SKUs', 'Active catalog')+
      kpi(_ADM_ICONS.cats, _admSectionCounts().length, 'Categories', 'Sections in use')+
      kpi(STAR, newCount, 'New Products', 'Flagged new')+
      kpi(EDIT, pending, 'Pending Changes', 'Unpublished edits')+
      '<div class="adm-kpi adm-kpi-wide"><div class="adm-kpi-ico">'+SYNC+'</div><div class="adm-kpi-val adm-kpi-val-sm">'+ls.v+'</div><div class="adm-kpi-label">Last Sync</div>'+(ls.s?'<div class="adm-kpi-sub">'+ls.s+'</div>':'')+'</div>'+
    '</div>'+
    '<div class="adm-ov-2col">'+
      '<div class="adm-panel"><div class="adm-panel-head"><div class="adm-panel-title">Products by Section</div><div class="adm-panel-sub">Category analytics · top sections</div></div><div class="adm-chart">'+renderSectionChartHtml()+'</div></div>'+
      '<div class="adm-panel"><div class="adm-panel-head"><div class="adm-panel-title">Recent Activity</div><div class="adm-panel-sub">Latest changes this session</div></div><div style="max-height:300px;overflow-y:auto">'+renderActivityHtml()+'</div></div>'+
    '</div>'+
    _admQuickActionsHtml()+
    '<div class="adm-panel"><div class="adm-panel-head"><div class="adm-panel-title">Price Distribution (SRP)</div><div class="adm-panel-sub">Products by SRP range</div></div><div class="adm-chart">'+renderPriceDistHtml()+'</div></div>'+
  '</div>';
}
function renderAdminContent(){
  var el=document.getElementById('adm-content');
  var modal=document.getElementById('adm-modal');
  if(_ac.check()){
    modal.classList.remove('adm-compact');modal.classList.remove('adm-login');modal.classList.add('adm-dash');
    el.innerHTML=
      '<div class="adm-shell" id="adm-shell">'+_admAppbarHtml()+'<div class="adm-dash">'+'<div class="adm-rail-backdrop" onclick="admCloseRail()"></div>'+_admRailHtml()+'<div class="adm-main">'+'<header class="adm-main-top"><div><h2 class="adm-main-title" id="adm-tab-title">Dashboard</h2><p class="adm-main-sub">Overview of your UGREEN pricelist</p></div>'+'<div class="adm-main-actions"><button class="btn-secondary" style="font-size:.8rem" onclick="closeAdminModal();openPanel(\x27add\x27)">+ Add SKU</button>'+'<button class="adm-btn-cta" onclick="closeAdminModal();saveCurrentVersion()"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Save ('+APP_VERSION+')</button>'+'<button class="adm-close-btn" onclick="closeAdminModal()" title="Close">&times;</button></div></header>'+'<div class="adm-main-scroll">'+_admTabOverviewHtml()+'<div class="adm-tab" id="tab-sku">'+'<div class="adm-sku-topbar"><div><div class="adm-sku-title">SKU Management</div><div class="adm-panel-sub" id="sku-count">'+ALL_PRODUCTS.length+' SKUs</div></div>'+'<div class="adm-sku-topbtns">'+'<button class="btn-secondary" onclick="closeAdminModal();document.getElementById(\x27excel-upload-input\x27).click()">Import Excel</button>'+'<button class="btn-secondary" onclick="closeAdminModal();downloadExcel(\x27recommended\x27)">Export</button>'+'<button class="adm-btn-cta" onclick="closeAdminModal();openPanel(\x27add\x27)">+ Add SKU</button>'+'<button class="btn-ghost" id="btn-rollback-upload-adm" onclick="closeAdminModal();rollbackUpload()" style="display:none">Undo Upload</button>'+'</div></div>'+'<div class="adm-sku-filters">'+'<input id="sku-search" class="adm-input" placeholder="Search name, model, code, material, UPC\u2026" oninput="skuFilter()">'+'<select id="sku-cat" class="adm-input" onchange="skuFilter()">'+renderSkuCatOptions()+'</select>'+'<select id="sku-price" class="adm-input" onchange="skuFilter()"><option value="">All prices</option><option value="a">\u20b10 \u2013 500</option><option value="b">\u20b1500 \u2013 2,000</option><option value="c">\u20b12,000 \u2013 5,000</option><option value="d">\u20b15,000+</option></select>'+'<select id="sku-sort" class="adm-input" onchange="skuFilter()"><option value="name">Product name</option><option value="code">Item code</option><option value="srp-asc">SRP: low to high</option><option value="srp-desc">SRP: high to low</option></select>'+'</div>'+'<div class="adm-panel" style="padding:0;overflow:hidden"><div class="adm-sku-tablewrap"><table class="adm-sku-table"><thead><tr><th>Image</th><th>Product</th><th>Item Code</th><th>Model</th><th class="adm-sku-thr">SRP / Dealer</th><th>Status</th><th class="adm-sku-thr">Actions</th></tr></thead><tbody id="sku-tbody"></tbody></table></div></div>'+'</div>'+'<div class="adm-tab" id="tab-categories">'+'<div class="adm-panel"><div class="adm-panel-head"><div class="adm-panel-title">Categories</div><div class="adm-panel-sub">'+_admSectionCounts().length+' sections \u00b7 auto-derived from products</div></div>'+renderCategoriesTableHtml()+'</div>'+'</div>'+_admTabImportHtml()+_admTabExportHtml()+_admTabPricingHtml()+_admTabImagesHtml()+_admTabReportsHtml()+_admTabActivityHtml()+'<div class="adm-tab" id="tab-promo">'+'<div class="adm-card adm-card-full">'+
        '<div class="adm-card-header">'+
          '<span class="adm-card-icon promo" id="sec-promo"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg></span>'+
          '<div><div class="adm-card-title">Promo Popup</div><div class="adm-card-sub">Session-based promotional overlay</div></div>'+
        '</div>'+
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.75rem">'+
          '<div><div style="font-size:.82rem;font-weight:600;color:var(--text-main)">Popup enabled</div><div style="font-size:.7rem;color:var(--text-dim)">Show once per visitor session</div></div>'+
          '<label class="adm-toggle"><input type="checkbox" id="promo-toggle-cb" '+(PROMO_CONFIG.enabled?'checked':'')+' onchange="togglePromoEnabled()"><span class="adm-toggle-track"><span class="adm-toggle-thumb"></span></span></label>'+
        '</div>'+
        '<div style="margin-bottom:.5rem"><label class="adm-input-label">Link URL</label><div class="adm-input-hint">Where the promo image links to (optional)</div><input class="adm-input" type="url" id="promo-link-input" value="'+(PROMO_CONFIG.linkUrl||'')+'" placeholder="https://example.com" onchange="updatePromoLink(this.value)"></div>'+
        '<div style="display:flex;gap:.5rem;margin-bottom:.5rem">'+
          '<div style="flex:1"><label class="adm-input-label">Auto-dismiss</label><input class="adm-input" type="number" id="promo-duration-input" value="'+(PROMO_CONFIG.duration||10)+'" min="0" max="60" step="1" onchange="updatePromoDuration(this.value)"><div class="adm-input-hint">Seconds (0 = manual close)</div></div>'+
          '<div style="flex:1"><label class="adm-input-label">Alt Text</label><input class="adm-input" type="text" id="promo-alt-input" value="'+(PROMO_CONFIG.altText||'UGREEN Promo')+'" placeholder="UGREEN Promo" onchange="updatePromoAlt(this.value)"></div>'+
        '</div>'+
        '<div style="margin-bottom:.5rem"><label class="adm-input-label">Promo Image / Video</label>'+
          '<div style="display:flex;gap:.4rem">'+
            '<button class="btn-secondary" style="flex:1;padding:.4rem .6rem;font-size:.78rem" onclick="document.getElementById(\x27promo-img-upload\x27).click()"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg> Upload</button>'+
            '<button class="btn-ghost" style="padding:.4rem .6rem;font-size:.78rem" onclick="clearPromoImage()"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg> Clear</button>'+
          '</div>'+
          '<input type="file" id="promo-img-upload" accept="image/*,video/mp4,video/webm" style="display:none" onchange="handlePromoImageUpload(this)">'+
        '</div>'+
        (PROMO_CONFIG.imageData ? '<div style="margin-top:.4rem;text-align:center;border-radius:8px;overflow:hidden;border:1px solid var(--border)">'+(PROMO_CONFIG.mediaType==='video' ? '<video src="'+PROMO_CONFIG.imageData+'" autoplay muted loop playsinline style="max-width:100%;max-height:180px;display:block"></video>' : '<img src="'+PROMO_CONFIG.imageData+'" alt="Preview" style="max-width:100%;max-height:180px;display:block">')+'</div>' : '<div style="font-size:.75rem;color:var(--text-dim);text-align:center;padding:.75rem;border:1px dashed var(--border);border-radius:8px">No promo media set</div>')+
      '</div>'+'</div>'+'<div class="adm-tab" id="tab-versions">'+'<div class="adm-card">'+
        '<div class="adm-card-header">'+
          '<span class="adm-card-icon save" id="sec-save"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg></span>'+
          '<div><div class="adm-card-title">Save & Export</div><div class="adm-card-sub">Persist changes to file</div></div>'+
        '</div>'+
        '<button class="btn-primary" style="width:100%;margin-bottom:.5rem" onclick="closeAdminModal();saveCurrentVersion()"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/></svg>Save (' + APP_VERSION + ')</button>'+
        '<button class="btn-secondary" style="width:100%;border-color:var(--accent);color:var(--accent)" onclick="closeAdminModal();saveAsNewVersion()">Save as New Version…</button>'+
      '</div>'+'<div class="adm-card">'+
        '<div class="adm-card-header">'+
          '<span class="adm-card-icon history"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></span>'+
          '<div><div class="adm-card-title">Version History</div><div class="adm-card-sub">Snapshots from Save as New Version</div></div>'+
        '</div>'+
        '<div id="vh-list" style="max-height:160px;overflow-y:auto;margin-bottom:.5rem"></div>'+
        '<button class="btn-ghost" style="width:100%;font-size:.72rem;padding:.4rem" onclick="copyChangelogTemplate()" title="Copy changelog stub for ' + APP_VERSION + '"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:3px"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>Copy changelog entry</button>'+
      '</div>'+'</div>'+'<div class="adm-tab" id="tab-settings">'+'<div id="adm-health-slot">'+renderHealthHtml()+'</div>'+'<div class="adm-card">'+
        '<div class="adm-card-header">'+
          '<span class="adm-card-icon security" id="sec-security"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></span>'+
          '<div><div class="adm-card-title">Security</div><div class="adm-card-sub">Update your admin PIN</div></div>'+
        '</div>'+
        '<div style="display:flex;flex-direction:column;gap:.5rem">'+
          '<div><label class="adm-input-label">New PIN</label><input class="adm-input" type="password" id="adm-new-pin" maxlength="20" placeholder="Enter new PIN" oninput="validatePinFields()"></div>'+
          '<div><label class="adm-input-label">Confirm PIN</label><input class="adm-input" type="password" id="adm-confirm-pin" maxlength="20" placeholder="Confirm new PIN" oninput="validatePinFields()"></div>'+
        '</div>'+
        '<div class="adm-error" id="adm-err"></div>'+
        '<button class="btn-primary" id="btn-update-pin" onclick="changePin()" disabled style="width:100%;margin-top:.5rem">Update PIN</button>'+
      '</div>'+'<div class="adm-card adm-card-full" style="border-color:color-mix(in srgb,var(--srp) 30%,transparent)">'+
        '<div class="adm-card-header">'+
          '<span class="adm-card-icon danger" id="sec-danger"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span>'+
          '<div><div class="adm-card-title" style="color:var(--srp)">Danger Zone</div><div class="adm-card-sub">Irreversible actions</div></div>'+
        '</div>'+
        '<button class="btn-danger" style="width:100%" onclick="resetToDefault()"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:3px"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg>Reset to Original Data</button>'+
      '</div>'+'</div>'+'</div>'+'</div>'+'</div>'+'</div>';

  } else {
    /* ── Login view — compact modal ── */
    modal.classList.remove('adm-dash');modal.classList.add('adm-login');
    el.innerHTML=
      '<div class="adm-login-wrap">'+
        '<aside class="adm-login-left">'+
          '<div class="adm-ll-shapes" aria-hidden="true"><span></span><span></span><span></span></div>'+
          '<div class="adm-ll-content">'+
            '<img class="adm-ll-logo" src="'+UGREEN_LOGO_LIGHT+'" alt="UGREEN">'+
            '<h2 class="adm-ll-welcome">WELCOME</h2>'+
            '<p class="adm-ll-sub">UGREEN Product Management Portal</p>'+
            '<p class="adm-ll-desc">Secure access for authorized Iontech personnel. Manage products, pricing, and administrative settings from one place.</p>'+
          '</div>'+
          '<div class="adm-ll-foot">Powered by Iontech Inc.</div>'+
        '</aside>'+
        '<section class="adm-login-right">'+
          '<button class="adm-close-btn adm-login-close" onclick="closeAdminModal()" title="Close">&times;</button>'+
          '<div class="adm-lr-inner" id="adm-lr-card">'+
            '<h3 class="adm-lr-title">Admin Sign In</h3>'+
            '<p class="adm-lr-sub">Enter your credentials to continue.</p>'+
            '<label class="adm-field-label" for="adm-username">Username</label>'+
            '<div class="adm-field">'+
              '<span class="adm-field-ico"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></span>'+
              '<input id="adm-username" class="adm-field-input" type="text" placeholder="Enter your username" autocomplete="username" aria-label="Username">'+
            '</div>'+
            '<label class="adm-field-label" for="adm-pin-field">Password</label>'+
            '<div class="adm-field">'+
              '<span class="adm-field-ico"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></span>'+
              '<input id="adm-pin-field" class="adm-field-input" type="password" maxlength="20" placeholder="Enter your password" autocomplete="current-password" aria-label="Password" onkeydown="if(event.key===\x27Enter\x27)submitPin()">'+
              '<button type="button" class="adm-show-btn" onclick="var i=document.getElementById(\x27adm-pin-field\x27);if(i.type===\x27password\x27){i.type=\x27text\x27;this.textContent=\x27Hide\x27;}else{i.type=\x27password\x27;this.textContent=\x27Show\x27;}">Show</button>'+
            '</div>'+
            '<label class="adm-remember"><input type="checkbox" id="adm-remember"><span>Remember me</span></label>'+
            '<div class="adm-error" id="adm-err"></div>'+
            '<button class="adm-signin-btn" id="adm-login-btn" onclick="submitPin()"><span class="adm-btn-label">Sign In</span><span class="adm-spin" aria-hidden="true"></span></button>'+
            '<div class="adm-lr-foot">Authorized Personnel Only<br>Iontech Inc.</div>'+
          '</div>'+
        '</section>'+
      '</div>';
  }
  if(typeof _admApplyRailPref==='function')_admApplyRailPref();setTimeout(renderVersionHistory, 0);
}

function submitPin(){
  var field=document.getElementById('adm-pin-field'),errEl=document.getElementById('adm-err'),btn=document.getElementById('adm-login-btn');
  if(!field)return;
  var pin=field.value.trim(); if(!pin){errEl.textContent='Enter your PIN.';return;}
  if(btn){btn.disabled=true;btn.classList.add('is-loading');}
  _ac.attempt(pin).then(function(res){
    if(res.ok){
      refreshAdminUI();closeAdminModal();
      if(_admCb){var cb=_admCb;_admCb=null;cb();}
      showToast(res.migrated ? 'Admin access granted — PIN secured.' : 'Admin access granted.');
      return;
    }
    var field=document.getElementById('adm-pin-field')||document.getElementById('adm-pin');
    var btn=document.getElementById('adm-login-btn')||document.getElementById('adm-continue');
    var errEl=document.getElementById('adm-err');
    if(!errEl){return;}
    if(res.wait!==undefined){
      if(field){field.value='';field.disabled=true;} if(btn){btn.disabled=true;btn.classList.remove('is-loading');}
      var rem=res.wait; errEl.style.color='var(--srp)'; errEl.textContent='Too many attempts. Wait '+rem+'s.';
      clearInterval(_cdTimer);
      _cdTimer=setInterval(function(){
        rem--;
        if(!document.getElementById('adm-err')){clearInterval(_cdTimer);return;}
        if(rem<=0){
          clearInterval(_cdTimer);
          var f2=document.getElementById('adm-pin-field')||document.getElementById('adm-pin');
          var b2=document.getElementById('adm-login-btn')||document.getElementById('adm-continue');
          var e2=document.getElementById('adm-err');
          if(f2){f2.disabled=false;f2.focus();} if(b2){b2.disabled=false;b2.classList.remove('is-loading');} if(e2){e2.textContent='';e2.style.color='';}
        } else {
          document.getElementById('adm-err').textContent='Too many attempts. Wait '+rem+'s.';
        }
      },1000);
    } else if (res.err) {
      errEl.style.color='var(--srp)'; errEl.textContent=res.err;
      if(field){field.value='';field.focus();} if(btn){btn.disabled=false;btn.classList.remove('is-loading');}
    } else {
      errEl.style.color='var(--srp)'; errEl.textContent='Invalid username or password.';
      if(field){field.value='';field.focus();} if(btn){btn.disabled=false;btn.classList.remove('is-loading');}
      var _c=document.getElementById('adm-lr-card'); if(_c){_c.classList.remove('adm-shake');void _c.offsetWidth;_c.classList.add('adm-shake');}
    }
  });
}

function changePin(){
  if(!_ac.check()){showToast('Session expired.');adminLogout();return;}
  var np=(document.getElementById('adm-new-pin').value||'').trim();
  var cp=(document.getElementById('adm-confirm-pin').value||'').trim();
  var errEl=document.getElementById('adm-err');
  if(!np){errEl.textContent='Enter a new PIN.';return;}
  if(np.length<4){errEl.textContent='PIN must be at least 4 characters.';return;}
  if(np!==cp){errEl.textContent='PINs do not match.';return;}
  // v01.6.3: setPin is async — hash then store. Never writes plaintext to localStorage.
  _ac.setPin(np).then(function(ok){
    if(ok){
      errEl.style.color='var(--accent)'; errEl.textContent='\u2705 PIN updated successfully.';
      document.getElementById('adm-new-pin').value=''; document.getElementById('adm-confirm-pin').value='';
      var btn=document.getElementById('btn-update-pin'); if(btn) btn.disabled=true;
      setTimeout(function(){ var e=document.getElementById('adm-err'); if(e) e.textContent=''; }, 3000);
    } else {
      errEl.style.color='var(--srp)'; errEl.textContent='Could not update PIN. Try a modern browser.';
    }
  });
}

function validatePinFields(){
  var np=(document.getElementById('adm-new-pin')||{}).value||'';
  var cp=(document.getElementById('adm-confirm-pin')||{}).value||'';
  var btn=document.getElementById('btn-update-pin');
  var errEl=document.getElementById('adm-err');
  if(!btn) return;
  var valid = np.trim().length >= 4 && np === cp;
  btn.disabled = !valid;
  if(errEl){
    if(np.trim().length > 0 && np.trim().length < 4){
      errEl.style.color='var(--srp)'; errEl.textContent='PIN must be at least 4 characters.';
    } else if(cp.length > 0 && np !== cp){
      errEl.style.color='var(--srp)'; errEl.textContent='PINs do not match.';
    } else {
      errEl.textContent='';
    }
  }
}

var VERSION_HISTORY_KEY = 'ugreen_version_history';
var MAX_VERSION_SNAPSHOTS = 10;
function loadVersionHistory() {
  try { return JSON.parse(localStorage.getItem(VERSION_HISTORY_KEY) || '[]'); } catch(e) { return []; }
}

function saveVersionHistoryStore(h) {
  try { localStorage.setItem(VERSION_HISTORY_KEY, JSON.stringify(h)); } catch(e) { console.warn('[VH]',e); }
}

function pushVersionSnapshot(label) {
  var h = loadVersionHistory();
  var customSkus = loadNewSkus();
  var deletedIds = [];
  try { deletedIds = JSON.parse(localStorage.getItem('ugreen_deleted')||'[]'); } catch(e){}
  h.unshift({ version: label, timestamp: Date.now(), customSkus: customSkus, deletedIds: deletedIds });
  if (h.length > MAX_VERSION_SNAPSHOTS) h = h.slice(0, MAX_VERSION_SNAPSHOTS);
  saveVersionHistoryStore(h);
}

function restoreVersionSnapshot(idx) {
  var h = loadVersionHistory();
  var entry = h[idx];
  if (!entry) return;
  if (!confirm(
    'Restore snapshot "' + entry.version + '"?\n' +
    'Saved: ' + new Date(entry.timestamp).toLocaleString() + '\n\n' +
    'This replaces your current custom edits and deletions with the saved state.'
  )) return;
  saveNewSkus(entry.customSkus);
  localStorage.setItem('ugreen_deleted', JSON.stringify(entry.deletedIds));
  showToast('Restored to ' + entry.version + ' — reloading…');
  setTimeout(function(){ location.reload(); }, 1400);
}

function renderVersionHistory() {
  var panel = document.getElementById('vh-list');
  if (!panel) return;
  var h = loadVersionHistory();
  if (!h.length) {
    panel.innerHTML = '<div style="font-size:.72rem;color:var(--text-muted);padding:.3rem 0">' +
      'No snapshots yet. Use “Save as New Version” to create one.</div>';
    return;
  }
  panel.innerHTML = h.map(function(entry, i) {
    var dt = new Date(entry.timestamp).toLocaleString();
    var isCurrent = (entry.version === APP_VERSION);
    return '<div style="display:flex;align-items:center;gap:.4rem;padding:.3rem 0;border-bottom:1px solid var(--border)">' +
      '<div style="flex:1;min-width:0;font-size:.75rem">' +
        '<span style="font-weight:700' + (isCurrent ? ';color:var(--accent)' : '') + '">' +
          entry.version + (isCurrent ? ' ★' : '') +
        '</span>' +
        '<div style="font-size:.67rem;color:var(--text-muted);margin-top:.1rem">' +
          dt + ' · ' + entry.customSkus.length + ' custom, ' + entry.deletedIds.length + ' deleted' +
        '</div>' +
      '</div>' +
      '<button class="btn-ghost" style="font-size:.68rem;padding:.18rem .45rem;flex-shrink:0" ' +
        'onclick="restoreVersionSnapshot(' + i + ')">Restore</button>' +
    '</div>';
  }).join('');
}

function copyChangelogTemplate() {
  var ver = APP_VERSION;
  var d = new Date();
  var dateStr = d.getFullYear() + '-' +
                String(d.getMonth()+1).padStart(2,'0') + '-' +
                String(d.getDate()).padStart(2,'0');
  var tmpl =
    '## ' + ver + ' \u2014 ' + dateStr + ' \u2014 <short title>\n\n' +
    '### Why this release\n' +
    '<one-paragraph motivation \u2014 what pain did this solve?>\n\n' +
    '### What\'s new / What was fixed\n' +
    '- \n' +
    '- \n' +
    '- \n\n' +
    '### What was NOT changed\n' +
    '- Exports (Quick PDF, Styled PDF, Catalog PDF, Excel Quick + Full) \u2014 untouched.\n' +
    '- Download menu, data schema, UI layout \u2014 untouched.\n\n' +
    '### Validation\n' +
    '- \n\n' +
    '### File map\n' +
    '- `ugreen_pricelist_' + ver + '.html` \u2014 working copy at project root.\n' +
    '- `Archive/HTML Versions/ugreen_pricelist_<prev>.html` \u2014 archived predecessor.\n';

  function ok() { showToast('\u2713 Changelog template copied \u2014 paste into docs/changelog.md above the previous entry.'); }
  function fallback(errInfo) {
    // Legacy execCommand path for browsers/contexts without async clipboard API.
    try {
      var ta = document.createElement('textarea');
      ta.value = tmpl;
      ta.style.position = 'fixed'; ta.style.top = '-9999px'; ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      var copied = document.execCommand('copy');
      document.body.removeChild(ta);
      if (copied) { ok(); return; }
    } catch(e) { /* fall through */ }
    // Last resort: log and tell the user.
    console.warn('[Changelog] Clipboard unavailable:', errInfo);
    console.log('\u2500\u2500\u2500 Changelog template \u2500\u2500\u2500\n' + tmpl);
    showToast('Clipboard blocked \u2014 template logged to console (F12).');
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(tmpl).then(ok).catch(fallback);
  } else {
    fallback('no async clipboard API');
  }
}

var STORAGE_KEY = 'ugreen_price_list_data_v1';
function isDuplicateSKU(code) {
  return ALL_PRODUCTS.some(function(p){ return p.item_code === code; });
}

function checkDuplicateSKU(itemCode, editingCode){
  return ALL_PRODUCTS.some(function(p){
    if(editingCode && p.item_code===editingCode) return false;
    return p.item_code===itemCode;
  });
}

function checkDuplicateLive(){
  var input = document.getElementById('f-ic');
  var err   = document.getElementById('ic-err');
  var saveBtn = document.getElementById('btn-save-sku');
  if (!input || !err) return;
  var val = String(input.value||'').trim().replace(/\s+/g,'');
  if (!val) {
    err.textContent = ''; err.className = 'field-error';
    input.classList.remove('field-invalid');
    if (saveBtn) saveBtn.disabled = false;
    return;
  }
  if (typeof editingCode !== 'undefined' && editingCode && val === editingCode) {
    err.textContent = ''; err.className = 'field-error';
    input.classList.remove('field-invalid');
    if (saveBtn) saveBtn.disabled = false;
    return;
  }
  var dup = ALL_PRODUCTS.find(function(p){
    if (typeof editingCode !== 'undefined' && editingCode && p.item_code === editingCode) return false;
    return p.item_code === val;
  });
  if (dup) {
    err.textContent = 'This SKU already exists' + (dup.product_name ? ' (' + dup.product_name + ')' : '');
    err.className = 'field-error visible';
    input.classList.add('field-invalid');
    if (saveBtn) saveBtn.disabled = true;
  } else {
    err.textContent = ''; err.className = 'field-error';
    input.classList.remove('field-invalid');
    if (saveBtn) saveBtn.disabled = false;
  }
}

function resetToDefault(){
  if(!_ac.check())return;
  if(!confirm('Reset to original data?\nAll custom changes will be removed.'))return;
  [STORAGE_KEY,'ugreen_new_skus_apr2026','ugreen_deleted'].forEach(function(k){try{localStorage.removeItem(k);}catch(e){}});
  location.reload();
}

var HAS_UNSAVED_CHANGES=false;
function markUnsaved(){HAS_UNSAVED_CHANGES=true;updateSaveIndicator(false);highlightDownloadButton();}

function updateSaveIndicator(isSaved){
  var el=document.getElementById('save-indicator');if(!el)return;
  clearTimeout(el._t);
  if(isSaved){el.textContent='\u2713 Exported';el.className='save-indicator saved';
    el._t=setTimeout(function(){el.style.opacity='0';setTimeout(function(){el.className='save-indicator';el.textContent='';el.style.opacity='';},400);},2000);
  }else{el.textContent='\u25cf Unsaved changes';el.className='save-indicator unsaved';el.style.opacity='1';}
}

function highlightDownloadButton(){var b=document.querySelector('.dl-btn');if(b)b.classList.add('needs-save');}

function removeDownloadHighlight(){var b=document.querySelector('.dl-btn');if(b)b.classList.remove('needs-save');}

var _pendingUpload = null;
function showUploadPreview(stats, changes, colMap) {
  _pendingUpload = { stats: stats, changes: changes };
  var cols = Object.keys(colMap).join(', ');
  function fmtVal(v){
    if (v === null || v === undefined || v === '') return '\u2014';
    var s = String(v);
    if (s.length > 60) s = s.slice(0, 60) + '\u2026';
    return esc(s);
  }
  var updates  = changes.filter(function(c){ return c.t === 'u'; });
  var adds     = changes.filter(function(c){ return c.t === 'a'; });
  var rejected = (stats.errors||[]).filter(function(e){ return e.rejected; });
  var warnings = (stats.errors||[]).filter(function(e){ return !e.rejected; });
  var hasCritical = rejected.length > 0;
  var hasWarnings = warnings.length > 0;

  var html = '';
  // Status banner
  if (hasCritical) {
    html += '<div class="up-banner up-blocked"><span class="up-banner-icon">\u26D4</span><div><strong>Issues Found</strong><div class="up-banner-text">' + rejected.length + ' row(s) rejected due to critical errors. Review below and fix in your Excel file.</div></div></div>';
  } else if (hasWarnings) {
    html += '<div class="up-banner up-warning"><span class="up-banner-icon">\u26A0</span><div><strong>Warnings Detected</strong><div class="up-banner-text">' + warnings.length + ' row(s) have minor issues. You can still apply, but review recommended.</div></div></div>';
  } else if (stats.updated + stats.added > 0) {
    html += '<div class="up-banner up-safe"><span class="up-banner-icon">\u2705</span><div><strong>Ready to Apply</strong><div class="up-banner-text">All ' + (stats.updated + stats.added) + ' change(s) passed validation.</div></div></div>';
  }

  // Stats grid
  html += '<div class="up-stats-grid">';
  html += '<div class="up-stat up-total"><span>Total Rows</span><span class="up-num">' + stats.total + '</span></div>';
  html += '<div class="up-stat up-update"><span>Will Update</span><span class="up-num">' + stats.updated + '</span></div>';
  html += '<div class="up-stat up-add"><span>Will Add</span><span class="up-num">' + stats.added + '</span></div>';
  if (stats.skipped > 0) html += '<div class="up-stat up-skip"><span>Skipped</span><span class="up-num">' + stats.skipped + '</span></div>';
  if (rejected.length > 0) html += '<div class="up-stat up-error"><span>Rejected</span><span class="up-num">' + rejected.length + '</span></div>';
  html += '</div>';

  // Collapsible section builder
  function sectionHead(icon, label, count, color, startCollapsed) {
    var cls = startCollapsed ? ' collapsed' : '';
    var style = color ? ' style="color:' + color + '"' : '';
    return '<div class="up-section"><div class="up-section-head' + cls + '" onclick="this.classList.toggle(\x27collapsed\x27)"' + style + '><span><span class="up-toggle">\u25BC</span>' + icon + ' ' + label + '</span><span class="up-section-count">' + count + '</span></div><div class="up-section-list">';
  }
  var sEnd = '</div></div>';

  // Updates (collapsed by default)
  if (updates.length) {
    html += sectionHead('\uD83D\uDD04', 'Will Update', updates.length, '', true);
    updates.forEach(function(c){
      html += '<div class="up-row"><div class="up-row-head"><span class="up-row-code">' + esc(c._itemCode||'') + '</span><span class="up-row-name">' + esc(c._name||'') + '</span></div><div class="up-diff">';
      Object.keys(c.diff).forEach(function(field){
        var pair = c.diff[field];
        html += '<div class="up-field">' + esc(field.replace(/_/g,' ')) + '</div><div class="up-vals"><span class="up-old">' + fmtVal(pair[0]) + '</span><span class="up-arrow">\u2192</span><span class="up-new">' + fmtVal(pair[1]) + '</span></div>';
      });
      html += '</div></div>';
    });
    html += sEnd;
  }

  // Additions (collapsed by default)
  if (adds.length) {
    html += sectionHead('\u2795', 'Will Add', adds.length, '', true);
    adds.forEach(function(c){
      var p = c.p;
      var meta = [p.category, p.model].filter(Boolean).join(' \u00B7 ');
      html += '<div class="up-row"><div class="up-row-head"><span class="up-row-code">' + esc(c._itemCode||'') + '</span><span class="up-row-name">' + esc(c._name||'') + '</span></div>' + (meta ? '<div class="up-diff" style="display:block;color:var(--text-dim);font-size:.68rem">' + esc(meta) + '</div>' : '') + '</div>';
    });
    html += sEnd;
  }

  // Rejected (expanded - critical)
  if (rejected.length) {
    html += sectionHead('\u274C', 'Rejected', rejected.length, 'var(--srp)', false);
    rejected.forEach(function(e){
      html += '<div class="up-row"><div class="up-row-head"><span class="up-row-code">' + esc(e.ic) + '</span><span class="up-row-name" style="color:var(--srp)">Row ' + e.row + '</span></div><div class="up-diff" style="display:block;color:var(--srp);font-size:.68rem">' + e.errors.map(function(er){ return esc(er); }).join('<br>') + '</div></div>';
    });
    html += '<div class="up-guidance">Fix these rows in your Excel file and re-upload. Rows with 3+ errors are automatically rejected.</div>';
    html += sEnd;
  }

  // Warnings (expanded)
  if (warnings.length) {
    html += sectionHead('\u26A0', 'Warnings', warnings.length, '#e6a700', false);
    warnings.forEach(function(e){
      html += '<div class="up-row"><div class="up-row-head"><span class="up-row-code">' + esc(e.ic) + '</span><span class="up-row-name" style="color:#e6a700">Row ' + e.row + '</span></div><div class="up-diff" style="display:block;color:#e6a700;font-size:.68rem">' + e.errors.map(function(er){ return esc(er); }).join('<br>') + '</div></div>';
    });
    html += '<div class="up-guidance">These rows will still be imported, but the flagged values may need correction after upload.</div>';
    html += sEnd;
  }

  // Skipped (collapsed)
  if (stats.skipped > 0) {
    html += sectionHead('\u23ED', 'Skipped', stats.skipped, '', true);
    html += '<div class="up-skipped-note">Rows are skipped when: the Item Code is empty, the row has more than 2 validation errors, required fields are missing for new products, or the row has no actual changes.</div>';
    html += sEnd;
  }

  html += '<div class="up-col-list">Detected columns: ' + esc(cols) + '</div>';

  // Disable Apply if all rows have critical errors and no valid changes
  var applyDisabled = (hasCritical && (stats.updated + stats.added) === 0);
  document.getElementById('upload-preview-body').innerHTML = html;
  var applyBtn = document.getElementById('upload-apply-btn');
  if (applyBtn) {
    applyBtn.disabled = applyDisabled;
    applyBtn.title = applyDisabled ? 'Cannot apply: all rows have critical errors. Fix your Excel file and re-upload.' : '';
  }
  var o = document.getElementById('upload-preview-overlay');
  if (o) o.style.display = 'flex';
}

function closeUploadPreview(){ var o=document.getElementById('upload-preview-overlay'); if(o) o.style.display='none'; }

function cancelExcelUpload(){ _pendingUpload=null; closeUploadPreview(); }

var _uploadSnapshot = null;
function confirmExcelUpload() {
  if (!_pendingUpload) return;
  var changes = _pendingUpload.changes;
  var stats   = _pendingUpload.stats;
  var totalChanges = stats.updated + stats.added;
  // v1.3.0 UX: Confirmation step before applying
  var msg = 'Apply ' + totalChanges + ' change(s) to your pricelist?\n\n';
  if (stats.updated > 0) msg += '\u2022 ' + stats.updated + ' product(s) will be updated\n';
  if (stats.added > 0) msg += '\u2022 ' + stats.added + ' product(s) will be added\n';
  if (stats.skipped > 0) msg += '\u2022 ' + stats.skipped + ' row(s) skipped\n';
  msg += '\nThis action can be undone via More \u2192 Undo Last Upload.';
  if (!confirm(msg)) return;
  _pendingUpload = null;
  closeUploadPreview();
  showLoading('Applying ' + totalChanges + ' changes\u2026');
  setTimeout(function() {
    try {
      // v1.2.8: Snapshot for rollback
      _uploadSnapshot = JSON.parse(JSON.stringify(ALL_PRODUCTS));
      changes.forEach(function(c) {
        if (c.t === 'u') {
          var p = ALL_PRODUCTS[c.idx];
          if (!p) return;
          Object.keys(c.u).forEach(function(k){ p[k] = c.u[k]; });
        } else {
          if (!c.p.category || !String(c.p.category).trim()) c.p.category = 'Uncategorized';
          if (!c.p.sheet || !String(c.p.sheet).trim()) c.p.sheet = 'Others';
          ALL_PRODUCTS.push(c.p);
        }
      });
      updateAll();
      autoSave();
      markUnsaved();
      hideLoading();
      // v1.2.8: Show rollback button
      var rb = document.getElementById('btn-rollback-upload');
      if (rb) rb.style.display = '';
      var rbAdm = document.getElementById('btn-rollback-upload-adm');
      if (rbAdm) rbAdm.style.display = '';
      var _mergeCount = changes.filter(function(c){ return c._merged; }).length;
      if (_mergeCount) {
        logActivity('uploaded', 'batch', _mergeCount + ' SKUs auto-merged');
        changes.forEach(function(c){ if (c._merged) { _recentMergedIds[c.ic] = Date.now(); } });
      }
      if (stats.added) logActivity('uploaded', 'batch', stats.added + ' SKUs added');
      if (stats.updated) logActivity('edited', 'batch', stats.updated + ' SKUs updated');
      var _sumParts = [];
      if (stats.added) _sumParts.push('\u2705 ' + stats.added + ' added');
      if (_mergeCount) _sumParts.push('\uD83D\uDD00 ' + _mergeCount + ' merged');
      if (stats.updated) _sumParts.push('\uD83D\uDD04 ' + stats.updated + ' updated');
      if (stats.skipped) _sumParts.push('\u26A0\uFE0F ' + stats.skipped + ' skipped');
      showToast('Upload complete: ' + _sumParts.join(', ') + '. Undo available in More menu.');
    } catch(err) {
      if (_uploadSnapshot) {
        ALL_PRODUCTS.length = 0;
        _uploadSnapshot.forEach(function(p){ ALL_PRODUCTS.push(p); });
        _uploadSnapshot = null;
        updateAll(); autoSave();
      }
      hideLoading();
      showToast('Apply failed \u2014 changes rolled back: ' + err.message);
    }
  }, 40);
}

function rollbackUpload() {
  if (!_uploadSnapshot) { showToast('No upload to undo.'); return; }
  if (!confirm('Undo the last upload and restore previous data?')) return;
  ALL_PRODUCTS.length = 0;
  _uploadSnapshot.forEach(function(p){ ALL_PRODUCTS.push(p); });
  _uploadSnapshot = null;
  updateAll(); autoSave(); markUnsaved();
  var rb = document.getElementById('btn-rollback-upload');
  if (rb) rb.style.display = 'none';
  showToast('Upload rolled back successfully.');
}

function handleExcelUpload(input) {
  if (!input.files || !input.files[0]) return;
  if (typeof ExcelJS === 'undefined') { showToast('Excel library loading — please wait.'); return; }
  var file = input.files[0];
  input.value = '';
  showLoading('Reading Excel\u2026');
  var r = new FileReader();
  r.onerror = function(){ hideLoading(); showToast('Failed to read file.'); };
  r.onload  = function(e){ processExcelUpload(e.target.result); };
  r.readAsArrayBuffer(file);
}

async function processExcelUpload(buffer) {
  try {
    var wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    var ws = wb.worksheets[0];
    if (!ws || ws.rowCount < 2) { hideLoading(); showToast('\u26a0\ufe0f No data in first worksheet.'); return; }

    // -- Strict column mapping (Excel as raw data source only) ------------
    // Canonical Excel columns expected by spec:
    //   model, item_code, product_name, color, length,
    //   srp, dp, dp_vol, moq, description, features
    // Aliases below accept common header variations (header normalizer strips
    // whitespace, underscores, dashes, dots, slashes before lookup).
    var ALIASES = {
      category:['category','cat','productcategory'],
      section:['section','sheet','sheetdisplay','productline'],
      model:['model','modelno','modelnumber','modelcode'],
      item_code:['itemcode','sku','code','skucode','itemno','item','stockcode','productcode'],
      product_name:['productname','name','title','product'],
      features:['productfeatures','features','specs','keyfeatures'],
      description:['description','desc','details','productdetails','productdescription','longdescription','itemdescription'],
      color:['color','colour','productcolor'],
      length:['length','cablelength','len','size'],
      srp:['srp','retail','retailprice','price'],
      dp:['dp','dealerprice','dealer'],
      // dp_volume: accepts spec-canonical 'dp_vol' plus legacy variants.
      dp_volume:['dpvol','dpvolume','volumedp','volumeprice','bulkprice','moqforvolumeprice'],
      moq:['moq','moqforvolumeprice','minorder','minqty'],
      material_number:['materialnumber','material','matno','mat'],
      upc:['upc','barcode','ean','ean13'],
    };
    var _lk={}; Object.keys(ALIASES).forEach(function(f){ALIASES[f].forEach(function(a){_lk[a]=f;});});
    var colMap={};
    ws.getRow(1).eachCell(function(cell,cn){
      var norm=String(cell.value||'').toLowerCase().replace(/[\s_\-\.\/\\]+/g,'');
      var f=_lk[norm]; if(f && colMap[f]===undefined) colMap[f]=cn;
    });
    console.log('[Upload] Column mapping:', JSON.stringify(colMap));
    if (colMap.item_code===undefined){ hideLoading(); showToast('\u274c "Item Code" column not found.'); return; }

    // ── DRY RUN: analyze rows, NO mutation of ALL_PRODUCTS ─────────────────
    var changes = [];
    var skipped = 0;
    var seen = new Set();  // duplicate protection WITHIN upload file
    var _now = new Date().toISOString();
    var _da  = _now.slice(0, 7);

    var _uploadErrors = [];
    var _uploadDupes = [];
    ws.eachRow(function(row, rn) {
      if (rn === 1) return;
      function s(ci){if(ci===undefined)return'';var v=row.getCell(ci).value;if(v==null)return'';if(typeof v==='object'&&v.result!==undefined)v=v.result;return String(v).trim();}
      function n(ci){if(ci===undefined)return null;var v=row.getCell(ci).value;if(v==null||v==='')return null;if(typeof v==='object'&&v.result!==undefined)v=v.result;var x=parseFloat(v);return isNaN(x)?null:Math.round(x*10000)/10000;}
      function i(ci){if(ci===undefined)return null;var v=row.getCell(ci).value;if(v==null||v==='')return null;if(typeof v==='object'&&v.result!==undefined)v=v.result;var x=parseInt(v,10);return isNaN(x)?null:x;}
      // v1.3.0: Features support pipe-separated (Fast Charge|Braided|4K) AND newline-separated
      function ff(ci){var v=s(ci);if(!v)return'';var ls;if(v.indexOf('|')>=0){ls=v.split('|').map(function(l){return l.trim();}).filter(Boolean);}else{ls=v.split(/\r?\n/).map(function(l){return l.trim();}).filter(Boolean);}return ls.length?'*placeholder\n'+ls.map(function(l){return l[0]==='*'?l:'*'+l;}).join('\n'):'';}

      var ic = s(colMap.item_code);
      console.log('[Upload] Row ' + rn + ':', {ic:ic, desc:s(colMap.description), name:s(colMap.product_name)});
      if (!ic)           { skipped++; return; }   // empty
      if (seen.has(ic))  {
        _uploadDupes.push(ic);
        skipped++; return;
      }
      seen.add(ic);

      var _sec=s(colMap.section),_cat=s(colMap.category),_mod=s(colMap.model),_nm=s(colMap.product_name);
      var _srp_raw=n(colMap.srp),_dp_raw=n(colMap.dp),_dpv_raw=n(colMap.dp_volume),_mq_raw=i(colMap.moq);

      // v1.3.0: Trim whitespace, standardize casing for Category/Section
      if (_cat) _cat = (matchCategory(_cat) || _cat).trim();
      if (_sec) _sec = (matchSection(_sec) || _sec).trim();

      // v1.3.0: Full row-level validation
      var ei_chk = ALL_PRODUCTS.findIndex(function(p){ return String(p.item_code)===ic; });
      var isNew = (ei_chk < 0);
      var rowErrors = [];
      // Required fields for NEW products
      if (isNew) {
        if (!_nm) rowErrors.push('Product Name required');
        if (!_mod) rowErrors.push('Model No required');
        if (!_cat) rowErrors.push('Category required');
        if (_srp_raw === null) rowErrors.push('SRP required');
        if (_dp_raw === null) rowErrors.push('Dealer Price required');
      }
      // Numeric non-negative checks (apply to both new and updates when value present)
      if (_srp_raw !== null && _srp_raw < 0) rowErrors.push('SRP must be non-negative');
      if (_dp_raw !== null && _dp_raw < 0) rowErrors.push('DP must be non-negative');
      if (_dpv_raw !== null && _dpv_raw < 0) rowErrors.push('Volume Price must be non-negative');
      // DP <= SRP check
      if (_srp_raw !== null && _dp_raw !== null && _dp_raw > _srp_raw) rowErrors.push('DP (' + _dp_raw + ') > SRP (' + _srp_raw + ')');
      // MOQ must be positive integer
      if (_mq_raw !== null && (!Number.isInteger(_mq_raw) || _mq_raw < 1)) rowErrors.push('MOQ must be positive integer');
      // Category must match predefined values (when provided)
      /* v1.2.8: category validation is warning-only, not blocking (audit R-7) */
      if (_cat && !matchCategory(_cat)) { rowErrors.push('Note: category "' + _cat + '" is new (not in existing list)'); }
      // Section must match predefined values (when provided)
      /* v1.2.8: section validation is warning-only (audit R-7) */
      if (_sec && !matchSection(_sec)) { rowErrors.push('Note: section "' + _sec + '" is new (not in existing list)'); }
      // v1.3.0: Reject rows with more than 2 validation errors
      if (rowErrors.length > 2) {
        _uploadErrors.push({ ic: ic, row: rn, errors: rowErrors, rejected: true });
        skipped++; return;
      }
      // Any errors → still record them but allow upload with warning (1-2 errors)
      if (rowErrors.length > 0) {
        _uploadErrors.push({ ic: ic, row: rn, errors: rowErrors, rejected: false });
        // For new products with required-field failures, skip the row
        if (isNew && rowErrors.some(function(e){ return e.indexOf('required') >= 0; })) {
          _uploadErrors[_uploadErrors.length-1].rejected = true;
          skipped++; return;
        }
      }
      var _ft=ff(colMap.features),_ds=s(colMap.description),_cl=s(colMap.color);
      var _ln=normalizeLength(s(colMap.length));
      var _srp=_srp_raw,_dp=_dp_raw,_dpv=_dpv_raw;
      var _mq=_mq_raw,_mt=s(colMap.material_number),_up=s(colMap.upc);

      var ei = ALL_PRODUCTS.findIndex(function(p){ return String(p.item_code)===ic; });
      // v1.3.8: Secondary duplicate detection by model+name
      if (ei < 0 && _mod && _nm) {
        var _secMatch = findDuplicateByModelName(_mod, _nm, null);
        if (_secMatch) {
          // Auto-merge: treat as update of the matched item
          ei = ALL_PRODUCTS.indexOf(_secMatch);
          ic = _secMatch.item_code; // use existing item code
          console.log('[Upload] Auto-merge: row ' + rn + ' matched existing "' + _secMatch.item_code + '" by model+name');
        }
      }

      if (ei >= 0) {
        // v1.1.17: SAFE PARTIAL UPDATE
        //   - Only non-empty values are candidates for update.
        //   - The candidate is only RECORDED if it actually differs from the
        //     existing value (no-op writes are skipped — counted as "skipped").
        //   - For numeric fields: 0 is a valid value (parses to 0, not null), so
        //     0 IS preserved. Only a literal empty/null cell is ignored.
        //   - Diff (old → new) is captured so the preview can render per-field
        //     before/after lines, not just a summary count.
        var prev = ALL_PRODUCTS[ei];
        var u = {};
        var diff = {};
        function trackStr(field, candidate, currentVal){
          if (!candidate) return;                                 // empty/null → ignore
          if (String(candidate) === String(currentVal||'')) return; // no-op
          u[field] = candidate;
          diff[field] = [currentVal == null ? '' : currentVal, candidate];
        }
        function trackNum(field, candidate, currentVal){
          // v1.1.17: 0 is valid; null/undefined/''/NaN are NOT valid → ignore.
          // [DIAG-MARKER-7905742-IF-YOU-SEE-THIS-WRITE-WORKED-BEYOND-7905742]
          // The parse helpers (n/i) already return null for empty cells, but we
          // belt-and-braces this so any future caller can't accidentally apply NaN.
          if (candidate === null || candidate === undefined || candidate === '') return;
          var cand = Number(candidate);
          if (isNaN(cand)) return;
          if (cand === Number(currentVal)) return;  // no-op (0===0 true)
          u[field] = cand;
          diff[field] = [currentVal == null ? '' : currentVal, cand];
        }
        trackStr('category',        _cat, prev.category);
        if (_sec) {
          // Section/sheet drives both 'sheet' and 'sheet_display' for legacy code paths.
          if (String(_sec) !== String(prev.sheet||'') ||
              String(_sec) !== String(prev.sheet_display||'')) {
            u.sheet = _sec; u.sheet_display = _sec;
            diff.section = [prev.sheet_display||prev.sheet||'', _sec];
          }
        }
        trackStr('model',           _mod, prev.model);
        trackStr('product_name',    _nm,  prev.product_name);
        trackStr('features',        _ft,  prev.features);
        trackStr('description',     _ds,  prev.description);
        trackStr('color',           _cl,  prev.color);
        trackStr('length',          _ln,  prev.length);
        trackNum('srp',             _srp, prev.srp);
        trackNum('dp',              _dp,  prev.dp);
        trackNum('dp_volume',       _dpv, prev.dp_volume);
        trackNum('moq',             _mq,  prev.moq);
        trackStr('material_number', _mt,  prev.material_number);
        trackStr('upc',             _up,  prev.upc);
        if (Object.keys(u).length) {
          // Carry context fields so preview can render '<item_code> — <name>' headers.
          changes.push({ t:'u', idx:ei, u:u, diff:diff,
                         _itemCode: prev.item_code, _name: prev.product_name, _merged: (ic !== s(colMap.item_code)) });
        } else {
          // No actual changes — count as skipped (no-op).
          skipped++;
        }
      } else {
        // ADD new product. Per spec: defaults for missing optional fields.
        var sn = _sec || 'Uploaded';
        changes.push({ t:'a', _itemCode: ic, _name: _nm || ic, p: {
          sheet: sn, sheet_display: sn,
          category: _cat || 'Uncategorized', model: _mod || '', item_code: ic,
          product_name: _nm || ic,
          features: _ft || '', description: _ds || '',
          color: _cl || '', length: _ln || '',
          srp: _srp, dp: _dp, dp_volume: _dpv, moq: _mq,
          material_number: _mt || '', upc: _up || '',
          image: '', remarks: '',
          dateAdded: _da, created_at: _now,
        }});
      }
    });

    // v1.3.0: REJECT entire file if duplicate Item Codes detected
    if (_uploadDupes.length) {
      hideLoading();
      var dupeList = _uploadDupes.slice(0, 10).join(', ');
      if (_uploadDupes.length > 10) dupeList += ' (+' + (_uploadDupes.length - 10) + ' more)';
      alert('Upload rejected: ' + _uploadDupes.length + ' duplicate Item Code(s) found in file.\n\n' + dupeList + '\n\nItem Code must be unique. Please fix the file and try again.');
      return;
    }

    // v1.3.0: Count rejected vs warning errors
    var rejectedErrors = _uploadErrors.filter(function(e){ return e.rejected; });
    var warningErrors  = _uploadErrors.filter(function(e){ return !e.rejected; });

    var stats = {
      updated: changes.filter(function(c){return c.t==='u';}).length,
      added:   changes.filter(function(c){return c.t==='a';}).length,
      skipped: skipped,
      total:   changes.length + skipped,
      errors:  _uploadErrors,
      rejectedCount: rejectedErrors.length,
      warningCount:  warningErrors.length,
    };
    hideLoading();
    showUploadPreview(stats, changes, colMap);

  } catch(err) {
    hideLoading();
    showToast('Upload failed: ' + err.message);
    console.error('[UGREEN Upload]', err);
  }
}

function togglePromoEnabled(){
  var cb=document.getElementById('promo-toggle-cb');
  PROMO_CONFIG.enabled = cb ? cb.checked : !PROMO_CONFIG.enabled;
  HAS_UNSAVED_CHANGES = true; updateSaveIndicator(false);
  showToast('Promo popup ' + (PROMO_CONFIG.enabled ? 'enabled' : 'disabled'));
}

function updatePromoLink(val){
  PROMO_CONFIG.linkUrl = (val||'').trim();
  HAS_UNSAVED_CHANGES = true; updateSaveIndicator(false);
}

function updatePromoAlt(val){
  PROMO_CONFIG.altText = (val||'').trim() || 'UGREEN Promo';
  HAS_UNSAVED_CHANGES = true; updateSaveIndicator(false);
}

function handlePromoImageUpload(input){
  if (!input.files || !input.files[0]) return;
  var file = input.files[0];
  var isImage = file.type.startsWith('image/');
  var isVideo = file.type.startsWith('video/');
  if (!isImage && !isVideo) { showToast('Please select an image or video file.'); return; }
  var maxMB = isVideo ? 20 : 5;
  if (file.size > maxMB * 1024 * 1024) { showToast('File too large (max ' + maxMB + ' MB).'); return; }
  showLoading('Processing ' + (isVideo ? 'video' : 'image') + '…');
  var reader = new FileReader();
  reader.onload = function(e){
    PROMO_CONFIG.imageData = e.target.result;
    PROMO_CONFIG.mediaType = isVideo ? 'video' : 'image';
    HAS_UNSAVED_CHANGES = true; updateSaveIndicator(false);
    hideLoading();
    renderAdminContent();
    showToast('Promo ' + (isVideo ? 'video' : 'image') + ' updated — remember to Save.');
  };
  reader.onerror = function(){ hideLoading(); showToast('Failed to read file.'); };
  reader.readAsDataURL(file);
}

function clearPromoImage(){
  if (!PROMO_CONFIG.imageData) return;
  if (!confirm('Remove the promo image? The popup will not show without an image.')) return;
  PROMO_CONFIG.imageData = ''; PROMO_CONFIG.mediaType = 'image';
  HAS_UNSAVED_CHANGES = true; updateSaveIndicator(false);
  renderAdminContent();
  showToast('Promo image cleared.');
}

function updatePromoDuration(val){
  var n = parseInt(val, 10);
  PROMO_CONFIG.duration = isNaN(n) ? 10 : Math.max(0, Math.min(60, n));
  HAS_UNSAVED_CHANGES = true; updateSaveIndicator(false);
}



/* ── CMS persistence layer (replaces single-file HTML "bake & download") ── */
function _downloadProductsJson(){
  try{
    var blob=new Blob([JSON.stringify(ALL_PRODUCTS)],{type:'application/json'});
    var a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='products.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function(){URL.revokeObjectURL(a.href);},600);
  }catch(e){ showToast('Save failed: '+(e.message||e)); }
}
function saveData(){ try{ localStorage.setItem('ugreen_cms_products', JSON.stringify(ALL_PRODUCTS)); }catch(e){} }
function autoSave(){ saveData(); }
function saveCurrentVersion(){ _downloadProductsJson(); showToast('products.json downloaded.'); }
function saveAsNewVersion(){ try{ if(typeof pushVersionSnapshot==='function') pushVersionSnapshot(); }catch(e){} _downloadProductsJson(); showToast('products.json downloaded \u2014 Phase 5 will commit it to GitHub.'); }
function exportHTML(){ _downloadProductsJson(); }
function _bakeAndDownload(){ _downloadProductsJson(); }


/* ── Duplicate product (new in CMS) — clones a SKU, then opens the editor ── */
function adminDuplicateProduct(code){
  if(typeof isAdmin==='function' && !isAdmin()){ openAdminModal(); return; }
  var src=ALL_PRODUCTS.find(function(x){return String(x.item_code)===String(code);});
  if(!src){ showToast('Product not found'); return; }
  var base=String(src.item_code), nc=base+'-COPY', i=2;
  while(ALL_PRODUCTS.some(function(x){return String(x.item_code)===nc;})){ nc=base+'-COPY'+i; i++; }
  var clone=JSON.parse(JSON.stringify(src));
  clone.item_code=nc; clone.isNew=true; clone.dateAdded=Date.now();
  ALL_PRODUCTS.push(clone);
  try{ var cu=loadNewSkus(); cu.push(clone); saveNewSkus(cu); }catch(e){}
  try{ _recentNewIds[nc]=Date.now(); }catch(e){}
  updateAll(); autoSave();
  showToast('Duplicated as '+nc+' \u2014 opening editor');
  if(typeof adminEditProduct==='function') adminEditProduct(nc);
}
