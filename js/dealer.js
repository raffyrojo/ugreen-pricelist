/* UGREEN Pricelist CMS — Dealer portal logic (js/dealer.js).
   Standalone page. The dealer enters a private access code; the Worker returns
   ONLY their {name, discountPct, skus}. We then load the SAME live products.json
   (single source of truth) and show their price = round(SRP*(1-pct/100)).
   SRP edits and SKU deletions in the main list flow through automatically. */
(function(){
  var CFG=window.CONFIG||{};
  var EP=(CFG.backend&&CFG.backend.workerEndpoint)||'';
  var PURL=(CFG.data&&CFG.data.products)||'data/products.json';
  var SKEY='ug_dealer_code';
  var S={ dealer:null, products:null, rows:[], q:'' };

  function $(id){ return document.getElementById(id); }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function peso(n){ n=Math.round(Number(n)||0); return '₱'+n.toLocaleString('en-PH'); }
  function num(n){ return (Number(n)||0).toLocaleString('en-PH'); }

  function show(view){ ['login','loading','list'].forEach(function(v){ var e=$('view-'+v); if(e) e.style.display=(v===view?'':'none'); }); }

  function doLogin(code){
    code=String(code||'').trim();
    if(!code){ loginErr('Enter your access code.'); return; }
    if(!EP){ loginErr('Portal not configured.'); return; }
    show('loading');
    fetch(EP,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'dealerAuth',code:code})})
      .then(function(r){ return r.json().catch(function(){return {};}).then(function(j){return {status:r.status,body:j};}); })
      .then(function(res){
        if(res.status!==200||!res.body||!res.body.ok){
          show('login'); loginErr((res.status===401)?'Invalid access code.':((res.body&&res.body.error)||'Sign-in failed.')); return;
        }
        S.dealer=res.body.dealer;
        try{ sessionStorage.setItem(SKEY,code); }catch(e){}
        loadProducts();
      })
      .catch(function(e){ show('login'); loginErr('Network error: '+(e.message||e)); });
  }
  function loginErr(m){ var e=$('login-err'); if(e){ e.textContent=m||''; e.style.display=m?'':'none'; } }

  function loadProducts(){
    show('loading');
    fetch(PURL+'?t='+Date.now(),{cache:'no-store'})
      .then(function(r){ return r.json(); })
      .then(function(list){ S.products=Array.isArray(list)?list:[]; computeRows(); renderList(); show('list'); })
      .catch(function(e){ show('login'); loginErr('Could not load pricelist: '+(e.message||e)); });
  }

  function computeRows(){
    var pct=Math.max(0,Math.min(95,Number(S.dealer.discountPct)||0));
    var set={}; (S.dealer.skus||[]).forEach(function(c){ set[String(c)]=1; });
    S.rows=(S.products||[]).filter(function(p){ return set[String(p.item_code)]; }).map(function(p){
      var srp=Number(p.srp)||0, dp=Math.round(srp*(1-pct/100));
      return { sheet:p.sheet||'', category:p.category||'', model:p.model||'', item_code:p.item_code||'',
               name:p.product_name||'', color:p.color||'', length:p.length||'', moq:p.moq||'',
               srp:srp, dp:dp, save:srp-dp };
    });
    S.rows.sort(function(a,b){ return (a.sheet||'').localeCompare(b.sheet||'')||(a.category||'').localeCompare(b.category||'')||(a.name||'').localeCompare(b.name||''); });
  }

  function filtered(){
    var q=(S.q||'').toLowerCase().trim();
    if(!q) return S.rows;
    return S.rows.filter(function(r){ return (r.name.toLowerCase().indexOf(q)>=0)||(String(r.item_code).toLowerCase().indexOf(q)>=0)||(String(r.model).toLowerCase().indexOf(q)>=0); });
  }

  function renderList(){
    var d=S.dealer, pct=Math.max(0,Math.min(95,Number(d.discountPct)||0));
    $('dlr-name').textContent=d.name||'Dealer';
    $('dlr-sub').textContent=pct+'% off SRP · '+S.rows.length+' product'+(S.rows.length===1?'':'s')+' available to you';
    var rows=filtered(), body='', lastSheet=null;
    if(!rows.length){
      body='<tr><td colspan="6" class="dlr-none">'+(S.rows.length? 'No products match your search.' : 'No products are assigned to your account yet. Please contact your Iontech rep.')+'</td></tr>';
    } else {
      rows.forEach(function(r){
        if(r.sheet!==lastSheet){ lastSheet=r.sheet; body+='<tr class="grp"><td colspan="6">'+esc(r.sheet||'Products')+'</td></tr>'; }
        var savePct=r.srp? Math.round(r.save/r.srp*100):0;
        var meta=[r.color,r.length].filter(Boolean).join(' · ');
        body+='<tr>'+
          '<td class="pn"><span class="pn-name">'+esc(r.name)+'</span>'+(meta?'<span class="pn-meta">'+esc(meta)+'</span>':'')+'</td>'+
          '<td class="mono">'+esc(r.item_code)+'</td>'+
          '<td class="mono hide-sm">'+esc(r.model)+'</td>'+
          '<td class="rt srp">'+peso(r.srp)+'</td>'+
          '<td class="rt dp">'+peso(r.dp)+'</td>'+
          '<td class="rt save hide-sm">'+peso(r.save)+' <span class="save-pct">'+savePct+'%</span></td>'+
        '</tr>';
      });
    }
    $('dlr-tbody').innerHTML=body;
    $('dlr-count').textContent=rows.length+' shown';
  }

  // ---- events ----
  function wire(){
    var f=$('login-form');
    if(f) f.addEventListener('submit',function(e){ e.preventDefault(); doLogin($('code-input').value); });
    var q=$('dlr-search'); if(q) q.addEventListener('input',function(){ S.q=this.value; renderList(); });
    var ex=$('btn-exit'); if(ex) ex.addEventListener('click',function(){ try{ sessionStorage.removeItem(SKEY); }catch(e){} S.dealer=null; S.products=null; S.rows=[]; var ci=$('code-input'); if(ci) ci.value=''; loginErr(''); show('login'); });
    var pr=$('btn-print'); if(pr) pr.addEventListener('click',function(){ window.print(); });
    // resume session
    var saved=''; try{ saved=sessionStorage.getItem(SKEY)||''; }catch(e){}
    if(saved) doLogin(saved); else show('login');
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',wire); else wire();
})();
