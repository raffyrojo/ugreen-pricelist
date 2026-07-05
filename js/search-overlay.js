/* Search overlay + lightweight, privacy-friendly search/view analytics (Phase 11).
   - Collapses the header search into an icon that opens a full-screen overlay.
   - "Top Searches": the most frequent terms THIS visitor has searched (localStorage).
   - "Suggested Products": trending SKUs, resolved in priority order:
       1. data/trending.json  (an item_code list a backend/trends job can populate later)
       2. most-viewed SKUs on this device
       3. most-searched terms -> first matching SKU
       4. curated default drawn from popular categories in the live catalog
   All client-side. trending.json is fetched lazily (idle / on first open) so there is
   zero added page-load cost. IIFE-scoped; onclick entry points exposed on window. */
(function(){
  'use strict';
  var SKEY='ugreen_search_stats', VKEY='ugreen_view_stats';
  var MAX_TAGS=8, MAX_SUGGEST=6;
  var _trending=null, _trendingTried=false, _open=false;

  function _load(k){ try{ return JSON.parse(localStorage.getItem(k)||'{}'); }catch(e){ return {}; } }
  function _save(k,o){ try{ localStorage.setItem(k,JSON.stringify(o)); }catch(e){} }
  function _rank(obj){ return Object.keys(obj).sort(function(a,b){ return obj[b]-obj[a]; }); }
  function _esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function _title(s){ return String(s).replace(/\b\w/g,function(c){ return c.toUpperCase(); }); }

  /* ---- tracking ---- */
  function recordSearch(term){
    term=(term||'').trim().toLowerCase();
    if(term.length<3) return;
    var s=_load(SKEY); s[term]=(s[term]||0)+1; _save(SKEY,s);
  }
  function recordView(code){
    if(code==null) return;
    var v=_load(VKEY), k=String(code); v[k]=(v[k]||0)+1; _save(VKEY,v);
  }
  window.recordView=recordView;   /* called from render.js openModal() */

  /* ---- catalog lookups ---- */
  function _byCode(code){
    if(typeof ALL_PRODUCTS==='undefined'||!ALL_PRODUCTS) return null;
    for(var i=0;i<ALL_PRODUCTS.length;i++){ if(String(ALL_PRODUCTS[i].item_code)===String(code)) return ALL_PRODUCTS[i]; }
    return null;
  }
  function _firstMatch(term){
    if(typeof ALL_PRODUCTS==='undefined'||!ALL_PRODUCTS) return null;
    term=String(term).toLowerCase();
    for(var i=0;i<ALL_PRODUCTS.length;i++){ var p=ALL_PRODUCTS[i];
      if((p.product_name||'').toLowerCase().indexOf(term)>=0 ||
         (p.category||'').toLowerCase().indexOf(term)>=0 ||
         (p.sheet||'').toLowerCase().indexOf(term)>=0 ||
         (p.item_code||'').toLowerCase().indexOf(term)>=0) return p;
    }
    return null;
  }

  /* ---- top searches (padded with catalog-valid defaults) ---- */
  var DEFAULTS=['power bank','charger','charging cable','usb cable','docking','hdmi','card reader','hub'];
  function topSearches(){
    var out=_rank(_load(SKEY)).slice(0,MAX_TAGS);
    for(var i=0;i<DEFAULTS.length && out.length<MAX_TAGS;i++){
      var t=DEFAULTS[i];
      if(out.indexOf(t)<0 && _firstMatch(t)) out.push(t);   /* only surface terms that hit the catalog */
    }
    return out;
  }

  /* ---- suggested products (layered fallback) ---- */
  function suggestedProducts(){
    var picks=[], seen={};
    function add(p){ if(p && !seen[p.item_code]){ seen[p.item_code]=1; picks.push(p); } }
    if(_trending && _trending.length) _trending.forEach(function(c){ if(picks.length<MAX_SUGGEST) add(_byCode(c)); });
    if(picks.length<MAX_SUGGEST) _rank(_load(VKEY)).forEach(function(c){ if(picks.length<MAX_SUGGEST) add(_byCode(c)); });
    if(picks.length<MAX_SUGGEST) _rank(_load(SKEY)).forEach(function(t){ if(picks.length<MAX_SUGGEST) add(_firstMatch(t)); });
    if(picks.length<MAX_SUGGEST) DEFAULTS.forEach(function(t){ if(picks.length<MAX_SUGGEST) add(_firstMatch(t)); });
    if(picks.length<MAX_SUGGEST && typeof ALL_PRODUCTS!=='undefined' && ALL_PRODUCTS)
      for(var i=0;i<ALL_PRODUCTS.length && picks.length<MAX_SUGGEST;i++) add(ALL_PRODUCTS[i]);
    return picks.slice(0,MAX_SUGGEST);
  }

  /* ---- trending.json (lazy, non-blocking; empty/absent => fallback) ---- */
  function loadTrending(){
    if(_trendingTried) return; _trendingTried=true;
    try{
      var C=(window.CONFIG&&window.CONFIG.data)||{};
      var url=C.trending||'data/trending.json';
      fetch(url,{cache:'no-cache'})
        .then(function(r){ return r.ok?r.json():null; })
        .then(function(j){ if(Array.isArray(j)) _trending=j; })
        .catch(function(){});
    }catch(e){}
  }

  /* ---- rendering ---- */
  function _imgHtml(p){
    var s=(typeof imgSrc==='function')?imgSrc(p.image):p.image;
    return s?'<img src="'+_esc(s)+'" loading="lazy" alt="">':'<div class="so-noimg">📦</div>';
  }
  function renderOverlay(){
    var tags=document.getElementById('so-tags');
    if(tags){
      var terms=topSearches();
      tags.innerHTML=terms.length?terms.map(function(t){
        return '<button type="button" class="so-tag" onclick="soPickTerm(\''+_esc(t).replace(/'/g,"\\'")+'\')">'+_esc(_title(t))+'</button>';
      }).join(''):'<div class="so-muted">No searches yet — start typing above.</div>';
    }
    var grid=document.getElementById('so-suggest');
    if(grid){
      var ps=suggestedProducts();
      grid.innerHTML=ps.length?ps.map(function(p){
        return '<button type="button" class="so-card" onclick="soPickProduct(\''+_esc(String(p.item_code)).replace(/'/g,"\\'")+'\')">'+
          '<div class="so-card-img">'+_imgHtml(p)+'</div>'+
          '<div class="so-card-txt"><div class="so-card-name">'+_esc(p.product_name||p.item_code)+'</div>'+
          (p.item_code?'<div class="so-card-code">'+_esc(p.item_code)+'</div>':'')+'</div>'+
        '</button>';
      }).join(''):'<div class="so-muted">No products to suggest.</div>';
    }
  }

  /* ---- open / close ---- */
  function openSearchOverlay(){
    loadTrending();
    var ov=document.getElementById('search-overlay'); if(!ov) return;
    renderOverlay();
    ov.classList.add('open'); _open=true;
    document.body.classList.add('so-lock');
    var inp=document.getElementById('search');
    if(inp) setTimeout(function(){ try{ inp.focus(); inp.select(); }catch(e){} },60);
  }
  function closeSearchOverlay(){
    var ov=document.getElementById('search-overlay'); if(!ov) return;
    ov.classList.remove('open'); _open=false;
    document.body.classList.remove('so-lock');
  }
  function closeSearchOverlayOutside(e){ if(e&&e.target&&e.target.id==='search-overlay') closeSearchOverlay(); }
  function soPickTerm(t){
    var inp=document.getElementById('search');
    if(inp){ inp.value=t; if(typeof handleSearch==='function') handleSearch(t); }
    recordSearch(t); closeSearchOverlay();
  }
  function soPickProduct(code){
    recordView(code); closeSearchOverlay();
    if(typeof openModal==='function') openModal(code);
  }
  window.openSearchOverlay=openSearchOverlay;
  window.closeSearchOverlay=closeSearchOverlay;
  window.closeSearchOverlayOutside=closeSearchOverlayOutside;
  window.soPickTerm=soPickTerm;
  window.soPickProduct=soPickProduct;

  /* ---- wiring ---- */
  document.addEventListener('DOMContentLoaded',function(){
    var inp=document.getElementById('search');
    if(inp){
      var t;
      inp.addEventListener('input',function(){ var v=this.value; clearTimeout(t); t=setTimeout(function(){ recordSearch(v); },1200); });
      inp.addEventListener('keydown',function(e){ if(e.key==='Enter'){ recordSearch(this.value); closeSearchOverlay(); } });
    }
    /* keyboard shortcut: "/" opens search (unless typing in a field) */
    document.addEventListener('keydown',function(e){
      if(e.key==='/' && !_open){
        var a=document.activeElement, tag=a&&a.tagName;
        if(tag!=='INPUT' && tag!=='TEXTAREA' && !(a&&a.isContentEditable)){ e.preventDefault(); openSearchOverlay(); }
      }
    });
    var idle=window.requestIdleCallback||function(f){ return setTimeout(f,1500); };
    idle(loadTrending);
  });
  document.addEventListener('keydown',function(e){ if(e.key==='Escape'&&_open) closeSearchOverlay(); });
})();
