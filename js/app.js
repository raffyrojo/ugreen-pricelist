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
    /* Mobile = grid-only: never leave the table view active. */
    if(typeof currentView!=='undefined' && currentView!=='grid' && typeof setView==='function'){setView('grid');}
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

/* Support dropdown (help / NAS resources). Mirrors the Export menu, adds keyboard nav. */
function toggleSupMenu(e){
  if(e){e.stopPropagation();}
  var m=document.getElementById('sup-menu'),b=document.getElementById('sup-btn');
  if(!m)return;
  var open=m.classList.toggle('open');
  if(b)b.setAttribute('aria-expanded',open?'true':'false');
  if(open){var first=m.querySelector('.sup-item');if(first){setTimeout(function(){try{first.focus();}catch(_){}}, 0);}}
}
function closeSupMenu(focusBtn){
  var m=document.getElementById('sup-menu'),b=document.getElementById('sup-btn');
  if(m&&m.classList.contains('open')){m.classList.remove('open');if(b)b.setAttribute('aria-expanded','false');if(focusBtn&&b){try{b.focus();}catch(_){}}}
}
/* Close when clicking outside, and close after a link is chosen. */
document.addEventListener('click',function(e){
  var wrap=document.getElementById('sup-wrap');
  var menu=document.getElementById('sup-menu');
  if(menu&&menu.classList.contains('open')&&wrap&&!wrap.contains(e.target))closeSupMenu(false);
  var link=e.target.closest&&e.target.closest('#sup-menu .sup-item');
  if(link)closeSupMenu(false);
});
/* Keyboard: Escape closes; Arrow/Home/End move between items; ArrowDown from the button opens. */
document.addEventListener('keydown',function(e){
  var menu=document.getElementById('sup-menu'),btn=document.getElementById('sup-btn');
  if(document.activeElement===btn&&e.key==='ArrowDown'){e.preventDefault();if(menu&&!menu.classList.contains('open'))toggleSupMenu();else if(menu){var f=menu.querySelector('.sup-item');if(f)f.focus();}return;}
  if(!menu||!menu.classList.contains('open'))return;
  if(e.key==='Escape'){e.preventDefault();closeSupMenu(true);return;}
  var items=Array.prototype.slice.call(menu.querySelectorAll('.sup-item'));
  if(!items.length)return;
  var idx=items.indexOf(document.activeElement);
  if(e.key==='ArrowDown'){e.preventDefault();items[(idx+1+items.length)%items.length].focus();}
  else if(e.key==='ArrowUp'){e.preventDefault();items[(idx-1+items.length)%items.length].focus();}
  else if(e.key==='Home'){e.preventDefault();items[0].focus();}
  else if(e.key==='End'){e.preventDefault();items[items.length-1].focus();}
});

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
