/* Formatting + rendering helpers — ported verbatim from v1.3.23.
   Only imgSrc changed: product.image is now a file path / URL, not a base64 key. */

function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function escAttr(s){return esc(String(s||'')).replace(/'/g,'&#39;');}
function hl(text,q){if(!q||!text)return esc(text||'');var re=new RegExp('('+q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+')','gi');return esc(String(text)).replace(re,'<mark>$1</mark>');}

function fmt(n){if(n===null||n===undefined||n==='')return '—';return '₱'+Number(n).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});}
function fmtS(n){if(!n)return '—';return '₱'+Number(n).toLocaleString('en-PH',{minimumFractionDigits:0});}
function tag(t){return '<span class="td-tag">'+esc(t||'—')+'</span>';}

function getLengthValue(length){if(length==null||length==='')return 0;var s=String(length).trim();var n=parseFloat(s.replace(/[^\d.\-]/g,''));return isNaN(n)?0:n;}
function cmpCode(a,b){var na=Number(a);var nb=Number(b);if(isNaN(na))na=0;if(isNaN(nb))nb=0;return na-nb;}
function parseLength(str){if(!str)return 0;var s=String(str).trim().toUpperCase();var m=s.match(/^([\d.]+)\s*(M|CM|MM)?$/);if(!m)return 0;var n=parseFloat(m[1]);if(m[2]==='CM')return n/100;if(m[2]==='MM')return n/1000;return n;}
function normalizeSidebar(val){return (val==null?'':String(val)).trim();}

/* product.image holds "images/xxx.webp", an http(s) URL, "", or (for admin-uploaded
   images this session) a key into window.IMAGES holding base64. */
function imgSrc(name){ if(!name) return null; if(window.IMAGES && window.IMAGES[name]) return window.IMAGES[name]; return name; }

function thumbCell(name){var s=imgSrc(name);return s?'<td class="td-thumb"><img src="'+s+'" loading="lazy" alt=""></td>':'<td class="td-thumb"><div class="no-img-sm">N/A</div></td>';}
function gridImgHtml(name){var s=imgSrc(name);return s?'<img src="'+s+'" loading="lazy" alt="">':'<div class="no-img-grid"><span style="font-size:1.8rem">&#128230;</span><span>No Image</span></div>';}
function expandImgHtml(name){var s=imgSrc(name);return s?'<img src="'+s+'" loading="lazy" decoding="async" alt="">':'<div class="no-img-lg">No Image</div>';}

function dpvCellHtml(p){
  var priceTxt=fmt(p.dp_volume);
  if(!p.dp_volume)return priceTxt;
  if(!p.moq)return '<span class="dpv-cell">'+priceTxt+'</span>';
  var tooltipMsg='Volume price applies only when order meets the minimum quantity (<strong>MOQ: '+esc(String(p.moq))+'</strong>).';
  return '<span class="dpv-cell dpv-has-moq">'+priceTxt+
    '<span class="dpv-moq-note">MOQ: '+esc(String(p.moq))+'</span>'+
    '<span class="dpv-badge">MOQ Required</span>'+
    '<span class="dpv-tooltip">'+tooltipMsg+'</span></span>';
}

function firstBullet(raw){var lines=parseBullets(raw);return lines.length?lines[0]:'';}
function parseBullets(raw){if(!raw)return[];return raw.split('\n').map(function(l){return l.replace(/^[▪•\*]\s*/,'').replace(/^\t?-[\w,\s]+$/,'').trim();}).filter(function(l){return l.length>0&&!/^-[\w]/.test(l);});}
function parseFeats(raw){if(!raw)return[];return raw.split('\n').map(function(l){return l.replace(/^\*/,'').replace(/^▪\s*/,'').trim();}).filter(Boolean).slice(1);}
function featsHtml(raw){var c=parseFeats(raw);if(!c.length)return '';return '<div class="expand-features-wrap"><div class="desc-section-title">Product Features</div><ul class="bullet-list">'+c.map(function(x){return '<li>'+esc(x)+'</li>';}).join('')+'</ul></div>';}
function descBulletsHtml(raw,ctx){var lines=parseBullets(raw);if(!lines.length)return '';return '<div class="desc-block"><div class="desc-section-title">Product Description</div><ul class="bullet-list">'+lines.map(function(l){return '<li>'+esc(l)+'</li>';}).join('')+'</ul></div>';}

/* Badges depend on admin edit sessions (Phase 4). No badges on a fresh catalog load. */
function isRecentlyNew(){ return false; }
function isRecentlyMerged(){ return false; }

/* ---- Public "New Arrivals" detector (auto-expiring). A SKU is NEW for
   NEW_WINDOW_DAYS days after it was added, then drops off automatically.
   Handles both dateAdded formats in the data: numeric ms (single-add / clone)
   and "YYYY-MM" month strings (Excel bulk import); falls back to created_at.
   Widen the window by changing NEW_WINDOW_DAYS. ---- */
var NEW_WINDOW_DAYS = 30;
function _newAddedTs(p){
  if(!p) return 0;
  var d=p.dateAdded;
  if(typeof d==='number' && isFinite(d)) return d;
  if(typeof d==='string'){
    if(/^\d{4}-\d{2}$/.test(d)){var a=d.split('-');return Date.UTC(+a[0],+a[1]-1,1);}
    if(/^\d{4}-\d{2}-\d{2}/.test(d)){var t=Date.parse(d);if(!isNaN(t))return t;}
    if(/^\d+$/.test(d))return +d;
  }
  if(p.created_at){var c=Date.parse(p.created_at);if(!isNaN(c))return c;}
  return 0;
}
function isNewArrival(p){
  var ts=_newAddedTs(p);
  if(!ts) return false;
  var age=Date.now()-ts;
  return age>=0 && age<=NEW_WINDOW_DAYS*86400000;
}

/* Admin gate — implemented in Phase 4. Browse-only build: never admin. */
function isAdmin(){ return false; }

/* Toast + loading overlay (guarded exactly like the original). */
function showToast(msg){var t=document.getElementById('toast');if(!t){console.warn('[Toast]',msg);return;}t.textContent=msg;t.classList.add('show');setTimeout(function(){if(t)t.classList.remove('show');},2800);}
function showLoading(msg){var lbl=document.getElementById('loading-label');var ov=document.getElementById('loading-overlay');if(lbl)lbl.textContent=msg||'Please wait…';if(ov)ov.classList.add('show');}
function hideLoading(){var ov=document.getElementById('loading-overlay');if(ov)ov.classList.remove('show');}

/* == Price Change indicators (SIMPLIFIED 2026-09-18) =======================
   When a price CHANGES (manual edit or bulk apply) the SKU stores lightweight
   per-field metadata -- like the NEW-product flag -- stamped against the price
   that existed immediately BEFORE the change. No baseline / pubSRP-pubDP /
   publish-time detection. Auto-expires after the configured window; the current
   price stays unchanged after expiry.
     previousSRP, priceChangeSRP ('up'|'down'), srpChangeDate ('YYYY-MM-DD')
     previousDP,  priceChangeDP  ('up'|'down'), dpChangeDate  ('YYYY-MM-DD') */
function pcIndicatorDays(){ try{ var d=window.PRICE_SETTINGS&&Number(window.PRICE_SETTINGS.indicatorDays); return (d&&d>0)?d:30; }catch(e){ return 30; } }
function pcWithinDays(dateStr){
  if(!dateStr) return false;
  var d=new Date(String(dateStr)+'T00:00:00'); if(isNaN(d.getTime())) return false;
  var end=new Date(d.getTime()); end.setDate(end.getDate()+pcIndicatorDays());
  return new Date() <= end;
}
function pcToday(){ var x=new Date(); return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0'); }
/* Returns {type,prev,new,dir,date} for an in-window change on SRP or DP, else null. */
function pcRecentEntry(p,type){
  if(!p) return null;
  function pick(t){
    if(t==='SRP'){ if(p.priceChangeSRP&&p.previousSRP!=null&&pcWithinDays(p.srpChangeDate)) return {type:'SRP',prev:p.previousSRP,'new':p.srp,dir:p.priceChangeSRP,date:p.srpChangeDate}; }
    else if(t==='DP'){ if(p.priceChangeDP&&p.previousDP!=null&&pcWithinDays(p.dpChangeDate)) return {type:'DP',prev:p.previousDP,'new':p.dp,dir:p.priceChangeDP,date:p.dpChangeDate}; }
    return null;
  }
  if(type) return pick(type);
  return pick('SRP')||pick('DP');
}
function pcHasRecent(p,dir){
  var a=pcRecentEntry(p,'SRP'), b=pcRecentEntry(p,'DP');
  function ok(e){ return !!(e && (!dir||e.dir===dir)); }
  return ok(a)||ok(b);
}
/* Render a badge. type='SRP'|'DP'. full=true -> prev->new + label; compact -> arrow+label. */
function pcBadge(p,type,full){
  var e=pcRecentEntry(p,type); if(!e) return '';
  var up=e.dir==='up', cls=up?'pc-up':'pc-down', arrow=up?'↑':'↓', label=up?'Price Increase':'Price Decrease';
  if(full){
    return '<div class="pc-ind '+cls+'"><span class="pc-old">'+fmt(e.prev)+'</span> <span class="pc-arrow">→</span> '+fmt(e['new'])+' <span class="pc-delta">'+arrow+' '+label+'</span></div>';
  }
  return '<span class="pc-ind '+cls+'">'+arrow+' '+(up?'Increase':'Decrease')+'</span>';
}
/* Stamp change metadata when SRP/DP actually change, comparing NEW values (already
   on p) vs supplied OLD values. Only sets fields for changed prices; leaves an
   unchanged field's existing metadata intact. effDate = change date. Returns true
   if anything changed. Used by manual edit + bulk apply. */
function pcStamp(p, oldSRP, oldDP, effDate){
  var d=effDate||pcToday();
  function num(v){ if(v===''||v===null||v===undefined) return null; var n=Number(v); return isNaN(n)?null:n; }
  var changed=false;
  var os=num(oldSRP), ns=num(p.srp);
  if(os!==null && ns!==null && ns!==os){ p.previousSRP=os; p.priceChangeSRP=(ns>os?'up':'down'); p.srpChangeDate=d; changed=true; }
  var od=num(oldDP), nd=num(p.dp);
  if(od!==null && nd!==null && nd!==od){ p.previousDP=od; p.priceChangeDP=(nd>od?'up':'down'); p.dpChangeDate=d; changed=true; }
  return changed;
}
