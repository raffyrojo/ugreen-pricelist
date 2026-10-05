/* VERO — AI Product & Sales Assistant (Phase 1: local/free lookup only).
   - No network calls of any kind. All answers come from VeroEngine over ALL_PRODUCTS.
   - Prices are read from the live product objects at render time (never stored in chat).
   - Dealer mode: ALL_PRODUCTS is already the dealer's own SKUs with Special DP; VERO follows
     the same price rules as the product modal and resets the chat when the mode changes.
   - Isolated: injects its own DOM; only calls existing globals openModal(), imgSrc(). */
(function(){
  'use strict';
  var CFG=(window.CONFIG&&window.CONFIG.vero)||{};
  if(CFG.enabled===false) return;

  var ASSET='assets/vero/';
  var GREETING='Hi! I\u2019m VERO. I can help you find, compare, and understand UGREEN products.';
  var PAGE=6, MAX_CMP=4;

  var S={ open:false, msgs:[], modeKey:null, cmp:[], built:false };

  /* ---------- small utils ---------- */
  function $(id){ return document.getElementById(id); }
  function e(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function money(n){
    if(n===null||n===undefined||n===''||isNaN(Number(n))) return '\u2014';
    return '\u20B1'+Number(n).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
  }
  function dealer(){ return window.DEALER_MODE||null; }
  function modeKey(){ var d=dealer(); return d?('d:'+(d.username||d.name||'')):'pub'; }
  function pool(){
    var all=(typeof ALL_PRODUCTS!=='undefined'&&Array.isArray(ALL_PRODUCTS))?ALL_PRODUCTS:[];
    return all.filter(function(p){ return p && !p.disabled; });
  }
  function byCode(code){
    var all=pool(); for(var i=0;i<all.length;i++) if(String(all[i].item_code)===String(code)) return all[i];
    return null;
  }
  function img(name){ try{ return (typeof imgSrc==='function')?imgSrc(name):name; }catch(_){ return name; } }
  /* Mascot avatar. Fixed-size box + width/height attrs = no layout shift.
     If an asset ever fails to load, a neutral sparkle mark shows instead (no letter badge). */
  var FALLBACK='<i class="vero-fb" aria-hidden="true">'+'<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true"><path d="M12 2.5c.6 4.6 2.9 6.9 7.5 7.5-4.6.6-6.9 2.9-7.5 7.5-.6-4.6-2.9-6.9-7.5-7.5 4.6-.6 6.9-2.9 7.5-7.5z" fill="currentColor"/></svg>'+'</i>';
  var AV_PX={ 'vero-av-sm':34, 'vero-av-md':40, 'vero-av-lg':58 };
  function avatar(kind,cls){
    var px=AV_PX[cls]||40;
    return '<span class="vero-av '+(cls||'')+'"><img src="'+ASSET+'vero-'+kind+'.webp" width="'+px+'" height="'+px+'" alt="" decoding="async" onerror="this.parentNode.classList.add(\'vero-av-fb\');this.remove();">'+FALLBACK+'</span>';
  }
  var ICON={
    send:'<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22 11 13 2 9z"/></svg>',
    x:'<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    search:'<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>',
    tag:'<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg>',
    cmp:'<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 3v18M16 3v18M3 8h5M16 16h5"/></svg>',
    wallet:'<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M16 12h2M3 10h18"/></svg>'
  };

  /* ---------- price model (mirrors render.js openModal rules) ---------- */
  function priceRows(p){
    if(dealer()){
      return [
        {k:'srp', label:'SRP', v:money(p.srp)},
        {k:'dp_std', label:'DP', v:money(p.dp_std)},
        {k:'dp', label:'Special DP', v:money(p.special_dp!=null?p.special_dp:p.dp), hl:true},
        {k:'moq', label:'MCQ', v:(p.moq||'\u2014')}
      ];
    }
    return [
      {k:'srp', label:'SRP', v:money(p.srp)},
      {k:'dp', label:'DP', v:money(p.dp), hl:true},
      {k:'dp_volume', label:'DP Vol', v:money(p.dp_volume)},
      {k:'moq', label:'MOQ', v:(p.moq||'\u2014')}
    ];
  }
  function answerLine(p,fields){
    if(!fields||!fields.length) return '';
    var d=dealer(), parts=[];
    fields.forEach(function(f){
      if(f==='srp') parts.push('SRP <b>'+money(p.srp)+'</b>');
      else if(f==='dp'){ if(d) parts.push('Special DP <b>'+money(p.special_dp!=null?p.special_dp:p.dp)+'</b> (standard DP '+money(p.dp_std)+')'); else parts.push('DP <b>'+money(p.dp)+'</b>'); }
      else if(f==='dp_volume'){ if(d) parts.push('DP Volume is not part of your pricelist'); else parts.push('DP Vol <b>'+money(p.dp_volume)+'</b>'+(p.moq?' (min. '+e(p.moq)+' units)':'')); }
      else if(f==='moq') parts.push((d?'MCQ':'MOQ')+' <b>'+e(p.moq||'\u2014')+'</b>');
    });
    return parts.join(' \u00B7 ');
  }

  /* ---------- product card ---------- */
  function card(p,opts){
    opts=opts||{};
    var src=img(p.image), sel=S.cmp.indexOf(String(p.item_code))>=0;
    var specs=[p.color,p.length].filter(Boolean).map(function(x){ return '<span class="vero-pill">'+e(x)+'</span>'; }).join('');
    var asked={}; (opts.fields||[]).forEach(function(f){ asked[f]=1; if(f==='dp'&&dealer()) asked.dp=1; });
    var prices=priceRows(p).map(function(r){
      var on=asked[r.k]||(r.k==='dp_std'&&false);
      return '<div class="vero-pr'+(r.hl?' vero-pr-dp':'')+(on?' vero-pr-ask':'')+'"><span>'+r.label+'</span><b>'+e(r.v)+'</b></div>';
    }).join('');
    return '<div class="vero-card'+(opts.compact?' vero-card-c':'')+'" data-code="'+e(p.item_code)+'">'+
      '<div class="vero-card-top">'+
        '<div class="vero-thumb">'+(src?'<img loading="lazy" src="'+e(src)+'" alt="">':'')+'</div>'+
        '<div class="vero-card-meta"><div class="vero-card-name">'+e(p.product_name)+'</div>'+
        '<div class="vero-card-code">Item '+e(p.item_code)+(p.model?' \u00B7 '+e(String(p.model).trim()):'')+'</div>'+
        (specs?'<div class="vero-pills">'+specs+'</div>':'')+'</div>'+
      '</div>'+
      '<div class="vero-prices'+(dealer()?' vero-prices-d':'')+'">'+prices+'</div>'+
      '<div class="vero-card-act">'+
        '<button type="button" class="vero-link" data-act="details" data-code="'+e(p.item_code)+'">View details</button>'+
        '<button type="button" class="vero-cmp-tg'+(sel?' on':'')+'" data-act="cmp" data-code="'+e(p.item_code)+'" aria-pressed="'+(sel?'true':'false')+'">'+ICON.cmp+(sel?' Selected':' Compare')+'</button>'+
      '</div></div>';
  }

  /* ---------- compare table ---------- */
  function feats(p){
    var raw=String(p.features||''); var lines=raw.split('\n').map(function(l){ return l.replace(/^\*/,'').replace(/^▪\s*/,'').trim(); }).filter(Boolean).slice(1,4);
    return lines;
  }
  function compareTable(codes){
    var ps=codes.map(byCode).filter(Boolean);
    if(ps.length<2) return '<p class="vero-note">Those products are not available in this pricelist anymore.</p>';
    var rows=priceRows(ps[0]).map(function(r){ return r; });
    function low(k){
      var vals=ps.map(function(p){ var v=Number(k==='dp'&&dealer()?(p.special_dp!=null?p.special_dp:p.dp):p[k]); return v>0?v:Infinity; });
      var m=Math.min.apply(null,vals); return vals.map(function(v){ return v===m&&m!==Infinity; });
    }
    var h=(ps.length>2?'<p class="vero-cmp-hint">Comparing '+ps.length+' products \u2014 scroll sideways to see all.</p>':'')+'<div class="vero-cmp-wrap"><table class="vero-cmp"><thead><tr><th></th>';
    ps.forEach(function(p){ var src=img(p.image); h+='<th><div class="vero-cmp-img">'+(src?'<img src="'+e(src)+'" alt="">':'')+'</div><div class="vero-cmp-name">'+e(p.product_name)+'</div></th>'; });
    h+='</tr></thead><tbody>';
    h+='<tr><td>Item / Model</td>'+ps.map(function(p){ return '<td>'+e(p.item_code)+(p.model?' \u00B7 '+e(String(p.model).trim()):'')+'</td>'; }).join('')+'</tr>';
    rows.forEach(function(r){
      var lw=(r.k==='moq')?null:low(r.k==='dp_std'?'dp_std':r.k);
      h+='<tr class="vero-cmp-price"><td>'+r.label+'</td>'+ps.map(function(p,i){
        var v=priceRows(p).filter(function(x){ return x.k===r.k; })[0];
        return '<td'+(lw&&lw[i]&&ps.length>1?' class="vero-low"':'')+'>'+e(v?v.v:'\u2014')+'</td>'; }).join('')+'</tr>';
    });
    [['Color','color'],['Length','length'],['Section','sheet_display']].forEach(function(f){
      h+='<tr><td>'+f[0]+'</td>'+ps.map(function(p){ return '<td>'+e(p[f[1]]||'\u2014')+'</td>'; }).join('')+'</tr>';
    });
    h+='<tr><td>Key features</td>'+ps.map(function(p){ var f=feats(p); return '<td>'+(f.length?'<ul>'+f.map(function(x){ return '<li>'+e(x)+'</li>'; }).join('')+'</ul>':'\u2014')+'</td>'; }).join('')+'</tr>';
    h+='<tr><td></td>'+ps.map(function(p){ return '<td><button type="button" class="vero-link" data-act="details" data-code="'+e(p.item_code)+'">View details</button></td>'; }).join('')+'</tr>';
    return h+'</tbody></table></div><p class="vero-fine">Lowest price per row highlighted.</p>';
  }

  /* ---------- message rendering ---------- */
  function botHtml(m){
    var r=m.res, out='', av='default';
    if(r.type==='clarify'||r.type==='none') av='thinking';
    if(r.type==='lookup'){
      var p=byCode(r.codes[0]);
      if(!p){ out='<p class="vero-note">That product is no longer in this pricelist.</p>'; }
      else{
        var line=answerLine(p,r.fields);
        out=(line?'<p class="vero-ans">'+line+'</p>':'<p class="vero-note">Here\u2019s what I found:</p>')+card(p,{fields:r.fields});
      }
    } else if(r.type==='list'){
      var ps=r.codes.map(byCode).filter(Boolean), shown=Math.min(ps.length,m.shown||PAGE);
      var pf=r.parsed&&r.parsed.priceField;
      var head=r.note?e(r.note):(ps.length+' products found'+(pf?' \u00B7 lowest '+(pf==='srp'?'SRP':(pf==='dp'?(dealer()?'Special DP':'DP'):'DP Vol'))+' first among best matches':'')+':');
      out='<p class="vero-note">'+head+'</p><div class="vero-list">'+ps.slice(0,shown).map(function(p){ return card(p,{compact:true,fields:r.fields}); }).join('')+'</div>';
      if(shown<ps.length) out+='<button type="button" class="vero-more" data-act="more" data-idx="'+m.idx+'">Show more ('+(ps.length-shown)+' left)</button>';
    } else if(r.type==='compare'){
      out=(r.note?'<p class="vero-note">'+e(r.note)+'</p>':'')+compareTable(r.codes);
    } else if(r.type==='clarify'){
      out='<p class="vero-note">'+e(r.note)+'</p>';
      if(r.chips&&r.chips.length) out+='<div class="vero-chips">'+r.chips.map(function(c,i){ return '<button type="button" class="vero-chip" data-act="chip" data-idx="'+m.idx+'" data-chip="'+i+'">'+e(c.label)+(c.count?' <span>'+c.count+'</span>':'')+'</button>'; }).join('')+'</div>';
    } else if(r.type==='none'){
      out='<p class="vero-note">'+e(r.note||'No products match that in this pricelist.')+'</p><p class="vero-fine">Try an item code, model, UPC, or a product type with wattage, length, or budget \u2014 e.g. \u201C65W charger\u201D, \u201CHDMI 2m\u201D, \u201Cpower bank under \u20B12,000\u201D.</p>';
    } else if(r.type==='text'){
      out='<p class="vero-note">'+e(r.note)+'</p>';
    }
    if(r.needsAI && CFG.aiEnabled!==true && r.type!=='compare'){
      out+='<p class="vero-fine vero-soon">Personalised recommendations and compatibility checks are coming soon. For now I\u2019m showing matching products from the pricelist.</p>';
    }
    if(r.parsed && r.parsed.priceField==='dp_volume' && dealer()){
      out='<p class="vero-note">DP Volume is not part of your pricelist. Try a budget on SRP or Special DP instead.</p>';
    }
    return '<div class="vero-msg vero-bot">'+avatar(av,'vero-av-sm')+'<div class="vero-bub">'+out+'</div></div>';
  }
  function userHtml(m){ return '<div class="vero-msg vero-me"><div class="vero-bub">'+e(m.text)+'</div></div>'; }
  function greetHtml(){
    return '<div class="vero-greet">'+avatar('happy','vero-av-lg')+
      '<div><p class="vero-greet-t">'+e(GREETING)+'</p>'+
      '<div class="vero-quick">'+
        '<button type="button" class="vero-q" data-act="quick" data-fill="" data-ph="e.g. 65W charger, HDMI 2m, 20000mAh power bank">'+ICON.search+'Find a product</button>'+
        '<button type="button" class="vero-q" data-act="quick" data-fill="Price of " data-ph="Item code or model">'+ICON.tag+'Price check</button>'+
        '<button type="button" class="vero-q" data-act="quick" data-fill="Compare " data-ph="2\u20134 item codes or models">'+ICON.cmp+'Compare</button>'+
        '<button type="button" class="vero-q" data-act="quick" data-fill="Chargers under \u20B1" data-ph="Budget, e.g. Chargers under \u20B11,500">'+ICON.wallet+'By budget</button>'+
      '</div></div></div>';
  }
  function renderLog(){
    var log=$('vero-log'); if(!log) return;
    var h=greetHtml();
    S.msgs.forEach(function(m){ h+=(m.role==='me')?userHtml(m):botHtml(m); });
    log.innerHTML=h;
    renderCmpBar();
  }
  function scrollEnd(){ var log=$('vero-log'); if(log) log.scrollTop=log.scrollHeight; }
  function renderCmpBar(){
    var bar=$('vero-cmpbar'); if(!bar) return;
    if(!S.cmp.length){ bar.hidden=true; return; }
    bar.hidden=false;
    bar.innerHTML='<span>'+S.cmp.length+' of '+MAX_CMP+' selected</span>'+
      '<button type="button" class="vero-btn" data-act="docmp"'+(S.cmp.length<2?' disabled':'')+'>Compare '+S.cmp.length+'</button>'+
      '<button type="button" class="vero-link" data-act="clrcmp">Clear</button>';
  }

  /* ---------- conversation ---------- */
  function syncMode(){
    var k=modeKey();
    if(S.modeKey!==k){ S.modeKey=k; S.msgs=[]; S.cmp=[]; }
  }
  function pushBot(res){ var m={role:'bot',res:res,idx:S.msgs.length,shown:PAGE}; S.msgs.push(m); return m; }
  function ask(text,ctx,label){
    syncMode();
    text=String(text||'').trim(); if(!text) return;
    S.msgs.push({role:'me',text:label||text});
    var res;
    var all=pool();
    if(!all.length) res={type:'text',note:'The pricelist is still loading \u2014 try again in a moment.',codes:[],chips:[]};
    else{
      try{ res=window.VeroEngine.answer(all,text,ctx||{}); }
      catch(err){ try{ console.warn('[VERO]',err); }catch(_){}; res={type:'text',note:'Sorry \u2014 I couldn\u2019t process that. Try an item code, model, or product type.',codes:[],chips:[]}; }
    }
    res.query=text; res.ctx=ctx||{};
    pushBot(res);
    renderLog(); scrollEnd();
  }
  function send(){
    var inp=$('vero-input'); if(!inp) return;
    var v=inp.value; if(!String(v).trim()) return;
    inp.value=''; inp.placeholder='Ask about a product, price, or spec\u2026';
    ask(v);
    inp.focus();
  }

  /* ---------- open / close ---------- */
  function headerBottom(){
    var h=document.querySelector('header'); if(!h) return 56;
    var b=h.getBoundingClientRect().bottom; return Math.max(0,Math.round(b));
  }
  function place(){ document.documentElement.style.setProperty('--vero-top',headerBottom()+'px'); }
  function open(){
    build(); syncMode();
    var d=$('vero-drawer'), f=$('vero-fab'); if(!d) return;
    place(); renderLog();
    d.hidden=false; requestAnimationFrame(function(){ d.classList.add('open'); });
    S.open=true; document.body.classList.add('vero-open');
    if(f){ f.setAttribute('aria-expanded','true'); }
    setTimeout(function(){ var i=$('vero-input'); if(i) try{ i.focus({preventScroll:true}); }catch(_){ i.focus(); } scrollEnd(); },60);
  }
  function close(){
    var d=$('vero-drawer'), f=$('vero-fab'); if(!d) return;
    d.classList.remove('open'); S.open=false; document.body.classList.remove('vero-open');
    setTimeout(function(){ if(!S.open) d.hidden=true; },200);
    if(f){ f.setAttribute('aria-expanded','false'); try{ f.focus({preventScroll:true}); }catch(_){} }
  }

  /* ---------- events ---------- */
  function onClick(ev){
    var b=ev.target.closest&&ev.target.closest('[data-act]'); if(!b) return;
    var act=b.getAttribute('data-act');
    if(act==='close'){ close(); return; }
    if(act==='send'){ send(); return; }
    if(act==='details'){
      var code=b.getAttribute('data-code');
      if(typeof openModal==='function') openModal(code);   /* modal (z 500) opens above the drawer (z 450) */
      return;
    }
    if(act==='cmp'){
      var c=b.getAttribute('data-code'), i=S.cmp.indexOf(c);
      if(i>=0) S.cmp.splice(i,1);
      else{ if(S.cmp.length>=MAX_CMP){ toast('You can compare up to '+MAX_CMP+' products.'); return; } S.cmp.push(c); }
      var keep=$('vero-log').scrollTop; renderLog(); $('vero-log').scrollTop=keep; return;
    }
    if(act==='docmp'){
      if(S.cmp.length<2) return;
      var codes=S.cmp.slice(); S.cmp=[];
      ask('compare', {compareCodes:codes}, 'Compare '+codes.join(', '));
      return;
    }
    if(act==='clrcmp'){ S.cmp=[]; var k2=$('vero-log').scrollTop; renderLog(); $('vero-log').scrollTop=k2; return; }
    if(act==='more'){
      var m=S.msgs[+b.getAttribute('data-idx')]; if(m){ m.shown=(m.shown||PAGE)+PAGE; var k3=$('vero-log').scrollTop; renderLog(); $('vero-log').scrollTop=k3; }
      return;
    }
    if(act==='chip'){
      var mm=S.msgs[+b.getAttribute('data-idx')]; if(!mm) return;
      var chip=mm.res.chips[+b.getAttribute('data-chip')]; if(!chip) return;
      if(chip.sheet) ask(mm.res.query,{sheet:chip.sheet},mm.res.query+' \u00B7 '+chip.sheet);
      else if(chip.append) ask(mm.res.query+chip.append,mm.res.ctx||{});
      return;
    }
    if(act==='quick'){
      var inp=$('vero-input'); if(!inp) return;
      inp.value=b.getAttribute('data-fill')||''; inp.placeholder=b.getAttribute('data-ph')||inp.placeholder;
      inp.focus(); try{ inp.setSelectionRange(inp.value.length,inp.value.length); }catch(_){}
      return;
    }
  }
  function toast(m){ if(typeof showToast==='function') showToast(m); }

  /* ---------- build DOM ---------- */
  function build(){
    if(S.built) return; S.built=true;
    var fab=document.createElement('button');
    fab.type='button'; fab.id='vero-fab'; fab.className='vero-fab';
    fab.setAttribute('aria-label','Open VERO, AI Product & Sales Assistant');
    fab.setAttribute('aria-controls','vero-drawer'); fab.setAttribute('aria-expanded','false');
    fab.title='Ask VERO';
    fab.innerHTML='<img src="'+ASSET+'vero-icon.webp" width="56" height="56" alt="" decoding="async" onerror="this.parentNode.classList.add(\'vero-fab-fb\');this.remove();">'+FALLBACK+'<span class="vero-fab-tip">Ask VERO</span>';
    fab.addEventListener('click',function(){ S.open?close():open(); });

    var d=document.createElement('section');
    d.id='vero-drawer'; d.className='vero-drawer'; d.hidden=true;
    d.setAttribute('role','dialog'); d.setAttribute('aria-modal','false'); d.setAttribute('aria-labelledby','vero-title');
    d.innerHTML=
      '<div class="vero-head">'+avatar('icon','vero-av-md')+
        '<div class="vero-head-t"><div id="vero-title" class="vero-title">VERO <span class="vero-spark" aria-hidden="true">\u2726</span></div>'+
        '<div class="vero-sub">AI Product &amp; Sales Assistant</div></div>'+
        '<button type="button" class="vero-x" data-act="close" aria-label="Close VERO">'+ICON.x+'</button></div>'+
      '<div class="vero-log" id="vero-log" role="log" aria-live="polite"></div>'+
      '<div class="vero-cmpbar" id="vero-cmpbar" hidden></div>'+
      '<div class="vero-foot">'+
        '<div class="vero-inrow"><input id="vero-input" type="text" maxlength="200" autocomplete="off" aria-label="Ask VERO" placeholder="Ask about a product, price, or spec\u2026">'+
        '<button type="button" class="vero-send" data-act="send" aria-label="Send">'+ICON.send+'</button></div>'+
        '<div class="vero-disc">Answers come from the current UGREEN pricelist.</div>'+
      '</div>';
    d.addEventListener('click',onClick);
    document.body.appendChild(fab);
    document.body.appendChild(d);
    document.body.classList.add('vero-on');
    $('vero-input').addEventListener('keydown',function(ev){ if(ev.key==='Enter'){ ev.preventDefault(); send(); } });
  }

  document.addEventListener('keydown',function(ev){
    if(ev.key!=='Escape'||!S.open) return;
    var modal=$('modal'); if(modal&&modal.classList.contains('open')) return;          /* Esc closes the product modal first */
    var so=$('search-overlay'); if(so&&so.classList.contains('open')) return;
    close();
  });
  window.addEventListener('resize',function(){ if(S.open) place(); });

  function init(){ build(); }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init); else init();

  window.veroOpen=open; window.veroClose=close;
  window.veroAsk=function(q){ if(!S.open) open(); ask(q); };   /* used by tests / future entry points */
})();
