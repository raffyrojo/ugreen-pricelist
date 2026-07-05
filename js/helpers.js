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

/* Admin gate — implemented in Phase 4. Browse-only build: never admin. */
function isAdmin(){ return false; }

/* Toast + loading overlay (guarded exactly like the original). */
function showToast(msg){var t=document.getElementById('toast');if(!t){console.warn('[Toast]',msg);return;}t.textContent=msg;t.classList.add('show');setTimeout(function(){if(t)t.classList.remove('show');},2800);}
function showLoading(msg){var lbl=document.getElementById('loading-label');var ov=document.getElementById('loading-overlay');if(lbl)lbl.textContent=msg||'Please wait…';if(ov)ov.classList.add('show');}
function hideLoading(){var ov=document.getElementById('loading-overlay');if(ov)ov.classList.remove('show');}
