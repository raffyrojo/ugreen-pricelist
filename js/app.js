/* Bootstrap: load JSON data, initialise the browse UI, wire events.
   Phase 2 = browse only. Export + admin actions are stubbed (Phases 3–5). */

function _bust(url){ return url + (url.indexOf('?')<0?'?':'&') + 'v=' + Date.now(); }

function _applyData(products, categories, settings){
  ALL_PRODUCTS = products || [];
  CATEGORIES   = categories;
  SETTINGS     = settings;
  if(SETTINGS&&SETTINGS.app&&SETTINGS.app.title)document.title=SETTINGS.app.title;
  if(SETTINGS&&SETTINGS.brand&&SETTINGS.brand.accent){
    try{document.documentElement.style.setProperty('--accent',SETTINGS.brand.accent);}catch(e){}
  }
  return ALL_PRODUCTS;
}

function _loadScript(src){
  return new Promise(function(res,rej){
    var s=document.createElement('script');
    s.src=src; s.onload=function(){res();}; s.onerror=function(){rej(new Error('load '+src));};
    document.head.appendChild(s);
  });
}

/* Primary path (http/https, e.g. GitHub Pages): fetch the JSON files — they are
   the single source of truth. Fallback (file://, where fetch() is blocked):
   load the auto-generated data/data.js mirror via a <script> tag. */
function loadData(){
  var C=(window.CONFIG&&window.CONFIG.data)||{products:'data/products.json',categories:'data/categories.json',settings:'data/settings.json'};
  return Promise.all([
    fetch(_bust(C.products)).then(function(r){if(!r.ok)throw new Error('products.json '+r.status);return r.json();}),
    fetch(_bust(C.categories)).then(function(r){return r.ok?r.json():null;}).catch(function(){return null;}),
    fetch(_bust(C.settings)).then(function(r){return r.ok?r.json():null;}).catch(function(){return null;})
  ]).then(function(res){
    return _applyData(res[0], res[1], res[2]);
  }).catch(function(fetchErr){
    // fetch failed — almost always file:// (opened by double-click). Use the mirror.
    console.warn('[UGREEN] fetch blocked ('+ (fetchErr&&fetchErr.message||fetchErr) +') — loading data/data.js fallback');
    return _loadScript('data/data.js').then(function(){
      var D=window.__UG_DATA||{};
      if(!D.products) throw new Error('data.js loaded but empty');
      return _applyData(D.products, D.categories, D.settings);
    });
  });
}

/* Mobile: keep layout height in sync with the header (ported verbatim). */
function fixMobileLayout(){
  var layout=document.querySelector('.layout');
  if(!layout)return;
  if(window.innerWidth<=640){
    var hh=document.querySelector('header')?document.querySelector('header').getBoundingClientRect().height:106;
    layout.style.height=(window.innerHeight-hh)+'px';
    var sideEl=document.querySelector('aside');if(sideEl)sideEl.style.top=hh+'px';
  }else{
    layout.style.height='';
    var s=document.querySelector('aside');if(s)s.style.top='';
  }
}

/* Export dropdown (UI only). */
function toggleDlMenu(){document.getElementById('dl-menu').classList.toggle('open');}

/* ── Phase 3/4 placeholders — keep the header intact, no dead clicks ──
   These are wired for real in later phases. */
function _soon(){ showToast('That feature arrives in a later phase.'); }
function downloadPDF(){_soon();}
function openStyledPdf(){_soon();}
function openCatalogPdf(){_soon();}
function downloadExcel(){_soon();}
function handleExcelUpload(){_soon();}
function openAdminModal(){_soon();}
function captureSkuCard(){_soon();}
function adminEditProduct(){_soon();}
function adminDeleteProduct(){_soon();}

document.addEventListener('DOMContentLoaded', function(){
  showLoading('Loading pricelist…');
  loadData().then(function(){
    sortProducts(ALL_PRODUCTS);
    wireTable();
    rebuildSidebar();
    render();
    var searchEl=document.getElementById('search');
    if(searchEl)searchEl.addEventListener('input',function(){handleSearch(this.value);});
    if(window.innerWidth<=640 && currentView!=='grid')setView('grid');
    fixMobileLayout();
    hideLoading();
    try{console.info('[UGREEN] loaded',ALL_PRODUCTS.length,'products');}catch(e){}
  }).catch(function(err){
    hideLoading();
    console.error('[UGREEN] load failed:',err);
    var empty=document.getElementById('empty-table');
    if(empty){empty.innerHTML='<h3>Could not load products</h3><p>'+esc(err.message||'Network error')+'</p>';empty.style.display='';}
    showToast('Failed to load products');
  });
});

/* Close export menu when clicking outside it. */
document.addEventListener('click',function(e){
  var wrap=document.getElementById('dl-wrap');
  var menu=document.getElementById('dl-menu');
  if(menu&&menu.classList.contains('open')&&wrap&&!wrap.contains(e.target))menu.classList.remove('open');
});

document.addEventListener('DOMContentLoaded',fixMobileLayout);
window.addEventListener('orientationchange',function(){setTimeout(fixMobileLayout,300);});
window.addEventListener('resize',fixMobileLayout);
