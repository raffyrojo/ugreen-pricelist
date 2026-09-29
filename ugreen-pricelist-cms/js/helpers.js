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
  var up=e.dir==='up', cls=up?'pc-up':'pc-down', arrow=up?'↑':'↓', label=up?'Increase':'Decrease';
  /* Hierarchy (2026-09-18): current price (rendered by the card) -> indicator ->
     Before: <old price>. Old price comes straight from previousSRP/previousDP via
     pcRecentEntry(e.prev) -- never reconstructed from a percentage. `full` kept for
     call-site compatibility; both modes now use the same stacked layout. */
  return '<span class="pc-ind '+cls+'">'+arrow+' '+label+'</span>'+
         '<span class="pc-before '+(up?'pcb-up':'pcb-down')+'">Before: <span class="pc-before-val">'+fmt(e.prev)+'</span></span>';
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

/* == Effective-date scheduling + Price History (2026-09-29) =================
   Two OPTIONAL, backward-compatible per-SKU arrays. The badge system above is
   UNTOUCHED -- these add a forward-dated schedule and an append-only log.
     priceSchedule[]  future changes (effectiveDate > today). Do NOT affect the
                      live price / exports / public view until they come due.
     priceHistory[]   append-only log of ACTIVATED changes (past + current),
                      each event = {effectiveDate,createdDate,oldSrp,newSrp,
                      oldDp,newDp,oldVol,newVol,source}.
   History for display derives from priceHistory[]; when that log is still empty
   the current indicator metadata (previousSRP/DP) is reconstructed as a seed row
   so already-stamped SKUs show up immediately. The seed migrates into
   priceHistory[] the first time a new change is applied -- never lost, never
   duplicated. Live price / exports always read p.srp/p.dp/p.dp_volume, which
   pcResolveSchedule keeps equal to the currently-active price. */
function _pcNum(v){ if(v===''||v===null||v===undefined) return null; var n=Number(v); return isNaN(n)?null:n; }
function _pcId(){ return 'pcs_'+Date.now().toString(36)+Math.random().toString(36).slice(2,7); }
/* One history event reconstructed from the live indicator metadata, or null. */
function pcSeedEventFromMeta(p){
  if(!p) return null;
  var hasS=(p.priceChangeSRP&&p.previousSRP!=null), hasD=(p.priceChangeDP&&p.previousDP!=null);
  if(!hasS&&!hasD) return null;
  return { effectiveDate:(p.srpChangeDate||p.dpChangeDate||null),
    createdDate:(p.srpChangeDate||p.dpChangeDate||null),
    oldSrp:hasS?_pcNum(p.previousSRP):null, newSrp:hasS?_pcNum(p.srp):null,
    oldDp:hasD?_pcNum(p.previousDP):null,  newDp:hasD?_pcNum(p.dp):null,
    oldVol:null, newVol:null, source:'seed', seeded:true };
}
/* Apply an immediate price change end-to-end: capture prior state, set the new
   prices (null/'' leaves a field unchanged), stamp the badge indicator, and log
   the event to priceHistory[]. Returns true if any price moved. */
function pcApplyChange(p, newSrp, newDp, newVol, effDate, createdDate, source){
  if(!p) return false;
  var d=effDate||pcToday(), cd=createdDate||pcToday();
  var oldSrp=p.srp, oldDp=p.dp, oldVol=p.dp_volume;
  var priorSeed=(!(p.priceHistory&&p.priceHistory.length))?pcSeedEventFromMeta(p):null;
  var ns=_pcNum(newSrp), nd=_pcNum(newDp), nv=_pcNum(newVol);
  if(ns!==null) p.srp=ns;
  if(nd!==null) p.dp=nd;
  if(nv!==null) p.dp_volume=nv;
  pcStamp(p, oldSrp, oldDp, d);
  var os=_pcNum(oldSrp), os2=_pcNum(p.srp), od=_pcNum(oldDp), od2=_pcNum(p.dp), ov=_pcNum(oldVol), ov2=_pcNum(p.dp_volume);
  if(os===os2 && od===od2 && ov===ov2) return false;
  p.priceHistory = p.priceHistory || [];
  if(priorSeed && !p.priceHistory.length) p.priceHistory.push(priorSeed);
  p.priceHistory.push({ effectiveDate:d, createdDate:cd, oldSrp:os, newSrp:os2, oldDp:od, newDp:od2, oldVol:ov, newVol:ov2, source:source||'edit' });
  return true;
}
/* Queue a FUTURE change (does not touch the live price). effDate required. */
function pcScheduleAdd(p, newSrp, newDp, newVol, effDate, createdDate){
  if(!p||!effDate) return null;
  p.priceSchedule = p.priceSchedule || [];
  var e={ id:_pcId(), effectiveDate:effDate, createdDate:createdDate||pcToday(),
    srp:_pcNum(newSrp), dp:_pcNum(newDp), dp_volume:_pcNum(newVol),
    prevSRP:_pcNum(p.srp), prevDP:_pcNum(p.dp), prevVol:_pcNum(p.dp_volume) };
  p.priceSchedule.push(e); return e;
}
/* At load: activate any scheduled change whose effectiveDate has arrived
   (<= today), ascending, then drop it from priceSchedule. Idempotent per load
   (re-runs from the same file with the same result until republished). Returns
   the number of activated changes. */
function pcResolveSchedule(products){
  if(!products||!products.length) return 0;
  var today=pcToday(), activated=0;
  for(var i=0;i<products.length;i++){
    var p=products[i];
    if(!p||!p.priceSchedule||!p.priceSchedule.length) continue;
    var due=[], future=[];
    for(var j=0;j<p.priceSchedule.length;j++){
      var e=p.priceSchedule[j];
      if(e && e.effectiveDate && String(e.effectiveDate)<=today) due.push(e); else future.push(e);
    }
    if(!due.length) continue;
    due.sort(function(a,b){ return String(a.effectiveDate)<String(b.effectiveDate)?-1:1; });
    for(var k=0;k<due.length;k++){
      var d=due[k];
      if(pcApplyChange(p, d.srp, d.dp, d.dp_volume, d.effectiveDate, d.createdDate, 'scheduled')) activated++;
    }
    p.priceSchedule = future;
  }
  return activated;
}
/* Unified rows for the admin Price Changes tab. Returns {active,scheduled,
   history}; each row = {code,model,name,type:'SRP'|'DP',oldPrice,newPrice,
   effectiveDate,createdDate,status,scheduleId?}. Latest activated event per
   SKU+field is 'Active', older ones 'Superseded'; future entries 'Scheduled'. */
function pcAllChangeRows(products){
  products = products || (typeof ALL_PRODUCTS!=='undefined'?ALL_PRODUCTS:[]);
  var active=[], scheduled=[], history=[];
  function rowsFromEvent(p, ev){
    var out=[];
    if(ev.oldSrp!=null && ev.newSrp!=null && ev.oldSrp!==ev.newSrp)
      out.push({code:p.item_code,model:p.model||'',name:p.product_name||'',type:'SRP',oldPrice:ev.oldSrp,newPrice:ev.newSrp,effectiveDate:ev.effectiveDate||'',createdDate:ev.createdDate||''});
    if(ev.oldDp!=null && ev.newDp!=null && ev.oldDp!==ev.newDp)
      out.push({code:p.item_code,model:p.model||'',name:p.product_name||'',type:'DP',oldPrice:ev.oldDp,newPrice:ev.newDp,effectiveDate:ev.effectiveDate||'',createdDate:ev.createdDate||''});
    return out;
  }
  for(var i=0;i<products.length;i++){
    var p=products[i]; if(!p) continue;
    var evs=(p.priceHistory&&p.priceHistory.length)?p.priceHistory.slice():[];
    if(!evs.length){ var seed=pcSeedEventFromMeta(p); if(seed) evs.push(seed); }
    evs.sort(function(a,b){ return String(a.effectiveDate)<String(b.effectiveDate)?-1:(String(a.effectiveDate)>String(b.effectiveDate)?1:0); });
    var latestByType={}, allRows=[];
    for(var j=0;j<evs.length;j++){
      var rws=rowsFromEvent(p,evs[j]);
      for(var r=0;r<rws.length;r++){ allRows.push(rws[r]); latestByType[rws[r].type]=rws[r]; }
    }
    for(var a=0;a<allRows.length;a++){
      allRows[a].status=(allRows[a]===latestByType[allRows[a].type])?'Active':'Superseded';
      history.push(allRows[a]);
      if(allRows[a].status==='Active') active.push(allRows[a]);
    }
    if(p.priceSchedule&&p.priceSchedule.length){
      for(var s=0;s<p.priceSchedule.length;s++){
        var se=p.priceSchedule[s];
        var srows=rowsFromEvent(p,{oldSrp:se.prevSRP,newSrp:se.srp,oldDp:se.prevDP,newDp:se.dp,effectiveDate:se.effectiveDate,createdDate:se.createdDate});
        for(var sr=0;sr<srows.length;sr++){ srows[sr].status='Scheduled'; srows[sr].scheduleId=se.id; scheduled.push(srows[sr]); }
      }
    }
  }
  return {active:active, scheduled:scheduled, history:history};
}
