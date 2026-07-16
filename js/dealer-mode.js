/* UGREEN Pricelist CMS — Dealer Mode (js/dealer-mode.js).
   Classic global scope. A dealer signs in from the main Login modal (username +
   password). On success the SAME pricelist UI is filtered to their assigned SKUs
   and shows their Special DP. The main products.json stays the single source of
   truth — dealer mode just derives a filtered/re-priced copy at runtime.
   Columns in dealer mode: SRP · DP (standard) · Special DP · MCQ (Master Carton Qty).
   Log out to return to the public list. */

window.DEALER_MODE = window.DEALER_MODE || null;
var _PUBLIC_PRODUCTS = null;          // backup of the full public list
var _DM_TH = { dpv:null, moq:null };  // captured original <th> HTML for restore
var _DM_SKEY = 'ug_dealer_profile';

function _dmEndpoint(){ var BE=(window.CONFIG&&window.CONFIG.backend)||{}; return BE.workerEndpoint||''; }
function _dmToast(m){ if(typeof showToast==='function') showToast(m); }
function _dmRound(n){ return Math.round(Number(n)||0); }

function _dmInjectCss(){
  if(document.getElementById('dm-css')) return;
  var st=document.createElement('style'); st.id='dm-css';
  st.textContent=[
   '#dm-banner{position:sticky;top:0;z-index:60;display:flex;align-items:center;gap:12px;flex-wrap:wrap;',
     'background:linear-gradient(90deg,#007934,#00612a);color:#fff;padding:9px 16px;font-size:.85rem;box-shadow:0 2px 10px rgba(0,0,0,.18)}',
   '#dm-banner .dm-badge{background:rgba(255,255,255,.18);border-radius:20px;padding:2px 10px;font-weight:700;font-size:.72rem;letter-spacing:.3px}',
   '#dm-banner .dm-name{font-weight:700}',
   '#dm-banner .dm-spacer{margin-left:auto}',
   '#dm-banner .dm-logout{background:#fff;color:#00612a;border:none;border-radius:8px;padding:7px 14px;font-weight:700;font-size:.8rem;cursor:pointer}',
   '#dm-banner .dm-logout:hover{filter:brightness(.95)}',
   '.dm-derr{color:#ff6b6b;font-size:.8rem;margin-top:8px;min-height:1em}'
  ].join('');
  document.head.appendChild(st);
}

/* ---- sign in from the login modal ---- */
function dealerSignIn(){
  var uEl=document.getElementById('dlr-user'), pEl=document.getElementById('dlr-pass'), errEl=document.getElementById('dlr-err');
  var u=(uEl&&uEl.value||'').trim(), pw=(pEl&&pEl.value||'');
  if(errEl) errEl.textContent='';
  if(!u||!pw){ if(errEl) errEl.textContent='Enter your username and password.'; return; }
  var ep=_dmEndpoint(); if(!ep){ if(errEl) errEl.textContent='Portal not configured.'; return; }
  if(errEl) errEl.textContent='Signing in…';
  fetch(ep,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'dealerAuth',username:u,password:pw})})
    .then(function(r){ return r.json().catch(function(){return {};}).then(function(j){return {status:r.status,body:j};}); })
    .then(function(res){
      if(res.status!==200||!res.body||!res.body.ok){
        if(errEl) errEl.textContent=(res.status===401)?'Invalid username or password.':((res.body&&res.body.error)||'Sign-in failed.');
        return;
      }
      if(typeof closeAdminModal==='function') closeAdminModal();
      enterDealerMode(res.body.dealer);
    })
    .catch(function(e){ if(errEl) errEl.textContent='Network error: '+(e.message||e); });
}

/* ---- enter / rebuild dealer view ---- */
function enterDealerMode(profile, fromSession){
  if(!profile) return;
  _dmInjectCss();
  if(!_PUBLIC_PRODUCTS) _PUBLIC_PRODUCTS = ALL_PRODUCTS;      // capture once
  var pct=Math.max(0,Math.min(95,Number(profile.discountPct)||0));
  var set={}; (profile.skus||[]).forEach(function(c){ set[String(c)]=1; });
  var dealerProducts=_PUBLIC_PRODUCTS.filter(function(p){ return set[String(p.item_code)]; }).map(function(p){
    var srp=Number(p.srp)||0, sp=_dmRound(srp*(1-pct/100));  // Special Price = round(SRP x (1 - margin%)) to nearest peso; shown 2-dec via fmt
    return Object.assign({}, p, { dp_std:p.dp, dp:sp, special_dp:sp, dp_volume:'' });
  });
  ALL_PRODUCTS = dealerProducts;
  window.DEALER_MODE = { name:profile.name||'Dealer', username:profile.username||'', discountPct:pct, count:dealerProducts.length };
  currentFilter={ type:'all', value:'', section:'' }; currentSearch='';
  var sb=document.getElementById('search'); if(sb) sb.value='';
  _dmSwapHeaders(true); _dmBanner(true);
  if(typeof rebuildSidebar==='function') rebuildSidebar();
  if(typeof render==='function') render();
  try{ sessionStorage.setItem(_DM_SKEY, JSON.stringify(profile)); }catch(e){}
  if(!fromSession) _dmToast('Signed in as '+window.DEALER_MODE.name+' — showing your pricing.');
  try{ window.scrollTo(0,0); }catch(e){}
}

function dealerLogout(){
  if(_PUBLIC_PRODUCTS) ALL_PRODUCTS=_PUBLIC_PRODUCTS;
  window.DEALER_MODE=null;
  currentFilter={ type:'all', value:'', section:'' }; currentSearch='';
  var sb=document.getElementById('search'); if(sb) sb.value='';
  _dmSwapHeaders(false); _dmBanner(false);
  if(typeof rebuildSidebar==='function') rebuildSidebar();
  if(typeof render==='function') render();
  try{ sessionStorage.removeItem(_DM_SKEY); }catch(e){}
  _dmToast('Logged out — showing the public pricelist.');
}

/* ---- swap the two table headers for dealer mode ---- */
function _dmSwapHeaders(on){
  var thV=document.querySelector('thead th[data-col="dp_volume"], thead th[data-col="special_dp"]');
  var thM=document.querySelector('thead th[data-col="moq"]');
  if(on){
    if(thV && _DM_TH.dpv===null){ _DM_TH.dpv=thV.outerHTML; }
    if(thM && _DM_TH.moq===null){ _DM_TH.moq=thM.outerHTML; }
    if(thV){ thV.setAttribute('data-col','special_dp'); thV.setAttribute('onclick',"sortBy('special_dp')"); thV.style.opacity=''; thV.title='Your special dealer price'; thV.innerHTML='Special DP <span class="sa">↕</span>'; }
    if(thM){ thM.innerHTML='MCQ <span class="sa">↕</span>'; thM.title='Master Carton Quantity'; }
  } else {
    if(thV && _DM_TH.dpv!==null){ thV.outerHTML=_DM_TH.dpv; }
    if(thM && _DM_TH.moq!==null){ thM.outerHTML=_DM_TH.moq; }
  }
}

/* ---- top banner ---- */
function _dmBanner(on){
  var ex=document.getElementById('dm-banner');
  if(on){
    if(ex) ex.parentNode.removeChild(ex);
    var b=document.createElement('div'); b.id='dm-banner';
    b.innerHTML='<span class="dm-badge">DEALER VIEW</span>'+
      '<span>Signed in as <span class="dm-name">'+esc(window.DEALER_MODE.name)+'</span> · '+window.DEALER_MODE.discountPct+'% off SRP · '+window.DEALER_MODE.count+' product'+(window.DEALER_MODE.count===1?'':'s')+'</span>'+
      '<span class="dm-spacer"></span>'+
      '<button class="dm-logout" onclick="dealerLogout()">Log out</button>';
    document.body.insertBefore(b, document.body.firstChild);
  } else if(ex){ ex.parentNode.removeChild(ex); }
}

/* ---- restore dealer session after a refresh ---- */
(function(){
  function tryResume(tries){
    if(typeof ALL_PRODUCTS==='undefined' || !ALL_PRODUCTS || !ALL_PRODUCTS.length){
      if(tries>0) return setTimeout(function(){ tryResume(tries-1); }, 200);
      return;
    }
    var raw=null; try{ raw=sessionStorage.getItem(_DM_SKEY); }catch(e){}
    if(!raw) return;
    var prof=null; try{ prof=JSON.parse(raw); }catch(e){ prof=null; }
    if(prof && !window.DEALER_MODE) enterDealerMode(prof, true);
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',function(){ tryResume(25); });
  else tryResume(25);
})();

if(typeof window!=='undefined'){ window.dealerSignIn=dealerSignIn; window.dealerLogout=dealerLogout; window.enterDealerMode=enterDealerMode; }
