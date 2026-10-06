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

  var S={ open:false, msgs:[], modeKey:null, cmp:[], built:false, aiHist:[] };

  /* ---------- Phase 2: VERO AI (off unless config.vero.aiEnabled && aiEndpoint) ---------- */
  var AI_KEY='vero_ai_session';
  function aiCfg(){ return { on: CFG.aiEnabled===true && !!CFG.aiEndpoint, web: CFG.webEnabled===true, url: String(CFG.aiEndpoint||'').replace(/\/+$/,'') }; }
  function aiForUser(){ return aiCfg().on && !dealer(); }          /* dealers: AI off during the pilot */
  function aiSession(){ try{ var x=JSON.parse(sessionStorage.getItem(AI_KEY)||'null'); if(x&&x.token&&x.exp>Date.now()) return x; }catch(_){} return null; }
  function setAiSession(x){ try{ if(x) sessionStorage.setItem(AI_KEY,JSON.stringify(x)); else sessionStorage.removeItem(AI_KEY); }catch(_){} }
  var AI_MSG={
    verify:'I couldn\u2019t verify the external compatibility details right now.',
    extOff:'External verification is unavailable right now.',
    down:'VERO AI is temporarily unavailable. Local product search is still available.',
    limit:'You\u2019ve reached the VERO AI limit for now. Please try again a little later.',
    slow:'VERO AI took too long to answer.',
    few:'I need at least two matching products to work with. Try describing the product type.'
  };
  /* ---- AI access gate (swappable policy component) ----
     Today's policy: AI is for authorized sales users with a VERO access code.
     To change the policy later (limited free AI, daily public quota, sign-in, ...), replace AI_GATE only:
       intro(m)  -> HTML shown when a user without access asks an AI-type question
       form(m)   -> HTML for the access step (shown only after the user opts in)
       open(m)   -> called by the "Sales AI Access" action
       submit(m, value) -> obtains a session (today: POST /session with the code) */
  var AI_GATE={
    text:{
      intro:'This question needs VERO AI. AI access is currently available to authorized sales users.',
      action:'Sales AI Access',
      note:'Enter your VERO access code.',
      invalid:'Invalid or inactive VERO access code.',
      expired:'Your VERO AI session has expired. Enter your access code again.',
      busy:'Too many attempts. Please try again in 15 minutes.'
    },
    intro:function(m){
      return '<p class="vero-note">'+e(AI_GATE.text.intro)+'</p>'+
        '<button type="button" class="vero-gate-btn" data-act="gateopen" data-idx="'+m.idx+'">'+ICON.spark+AI_GATE.text.action+'</button>';
    },
    form:function(m){
      return (m.gateErr?'':'<p class="vero-note vero-gate-note">'+e(m.gateMsg||AI_GATE.text.note)+'</p>')+
        (m.gateErr?'<p class="vero-ai-err">'+e(m.gateErr)+'</p>':'')+
        '<div class="vero-unlock"><input type="password" autocomplete="off" spellcheck="false" maxlength="40" aria-label="VERO access code" placeholder="VERO access code" data-unlock="'+m.idx+'">'+
        '<button type="button" class="vero-btn vero-btn-sm" data-act="unlock" data-idx="'+m.idx+'"'+(m.busy?' disabled':'')+'>'+(m.busy?'Checking\u2026':'Continue')+'</button></div>';
    },
    open:function(m){ m.gateOpen=true; m.gateErr=null; m.gateMsg=null; },
    submit:function(m,value){ unlockAI(m,value); }
  };
  function aiErrText(err,route){
    if(err==='web_budget'||err==='web_limited'||err==='web_off') return AI_MSG.extOff;
    if(err==='no_official_source'||err==='web_unavailable'||(route==='web'&&err==='timeout')) return AI_MSG.verify;
    if(err==='rate_limited') return AI_MSG.limit;
    if(err==='timeout') return AI_MSG.slow;
    if(err==='no_candidates') return AI_MSG.few;
    return AI_MSG.down;
  }
  function aiRetryable(err){ return ['timeout','unavailable','web_unavailable','invalid','network'].indexOf(err)>=0; }
  function pushAi(o){ o.role='ai'; o.idx=S.msgs.length; S.msgs.push(o); return o; }
  function aiAfterLocal(m,text){
    if(!aiForUser()||!window.VeroEngine.aiRoute) return;
    var dec; try{ dec=window.VeroEngine.aiRoute(pool(),text,m.res,{}); }catch(_){ return; }
    if(dec.route==='local'){ if(dec.canEscalate) m.offer=true; return; }
    startAI(text,dec,'auto');
  }
  function startAI(q,dec,trigger){
    var a=aiCfg(), sess=aiSession();
    var am=pushAi({ q:q, route:dec.route, candidates:dec.candidates, trigger:trigger, state:'loading' });
    if(dec.route==='web' && (!a.web || (sess && sess.web===false))){ am.state='error'; am.err='web_off'; return am; }
    if(!sess){ am.state='gate'; am.gateOpen=false; return am; }
    runAI(am); return am;
  }
  function runAI(am){
    var a=aiCfg(), sess=aiSession();
    if(!sess){ am.state='gate'; am.gateOpen=false; renderAndKeep(); return; }
    am.state='loading'; am.err=null;
    var ctl=('AbortController' in window)?new AbortController():null;
    var tmo=setTimeout(function(){ if(ctl) ctl.abort(); },am.route==='web'?32000:15000);
    var body={ v:1, q:String(am.q).slice(0,300), candidates:am.candidates.slice(0,8),
      history:S.aiHist.slice(-2).map(function(h){ return {q:h.q,picks:h.picks.slice(0,3)}; }), route:am.route, trigger:am.trigger };
    fetch(a.url+'/ask',{ method:'POST', headers:{'content-type':'application/json','authorization':'Bearer '+sess.token}, body:JSON.stringify(body), signal:ctl?ctl.signal:undefined })
      .then(function(r){ return r.json().catch(function(){ return {ok:false,error:'unavailable'}; }).then(function(j){ return {status:r.status,j:j}; }); })
      .then(function(x){
        clearTimeout(tmo);
        var j=x.j||{};
        if(j.ok){
          var allowed={}; am.candidates.forEach(function(c){ allowed[c]=1; });
          j.picks=(j.picks||[]).filter(function(p){ return p && allowed[p.item_code] && byCode(p.item_code); });   /* dealer-safe: only codes visible to this user */
          j.sources=(j.sources||[]).filter(function(s){ return s && /^https:\/\//.test(s.url||''); });
          am.state='done'; am.data=j;
          S.aiHist.push({q:am.q,picks:j.picks.map(function(p){ return p.item_code; })}); S.aiHist=S.aiHist.slice(-2);
        } else {
          am.state='error'; am.err=j.error||('http_'+x.status);
          if(am.err==='unauthorized'){ setAiSession(null); renderDisc(); am.state='gate'; am.gateOpen=true; am.gateErr=null; am.gateMsg=AI_GATE.text.expired; }
        }
        renderAndKeep();
      })
      .catch(function(err){ clearTimeout(tmo); am.state='error'; am.err=(err&&err.name==='AbortError')?'timeout':'network'; renderAndKeep(); });
    renderAndKeep();
  }
  function unlockAI(am,code){
    var a=aiCfg(); code=String(code||'').trim();
    if(!code){ am.gateErr=AI_GATE.text.note; renderAndKeep(); return; }
    am.busy=true; am.gateErr=null; renderAndKeep();
    fetch(a.url+'/session',{ method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({code:code}) })
      .then(function(r){ return r.json().catch(function(){ return {}; }); })
      .then(function(j){
        am.busy=false;
        if(j&&j.ok&&j.token){ setAiSession({token:j.token,role:j.role,exp:j.exp,web:!!j.web}); renderDisc(); runAI(am); }
        else { am.gateErr=(j&&j.error==='session_locked')?AI_GATE.text.busy:(j&&j.error==='invalid_code'?AI_GATE.text.invalid:AI_MSG.down); renderAndKeep(); }
      })
      .catch(function(){ am.busy=false; am.gateErr=AI_MSG.down; renderAndKeep(); });
  }
  function renderAndKeep(){ var log=$('vero-log'); var atEnd=!log||log.scrollHeight-log.scrollTop-log.clientHeight<40; renderLog(); if(atEnd) scrollEnd(); }
  function basisLabel(b){ return b==='web_verified'?'Official source':(b==='product_data'?'From pricelist data':'General guidance'); }
  function aiHtml(m){
    var out='', av='default';
    if(m.state==='loading'){
      av='thinking';
      out='<p class="vero-note vero-ai-wait"><span class="vero-dots" aria-hidden="true"><i></i><i></i><i></i></span>'+(m.route==='web'?'VERO AI is checking official sources\u2026':'VERO AI is thinking\u2026')+'</p>';
    } else if(m.state==='gate'){
      av='default';
      out=m.gateOpen?AI_GATE.form(m):AI_GATE.intro(m);
    } else if(m.state==='error'){
      av='thinking';
      out='<p class="vero-note">'+e(aiErrText(m.err,m.route))+'</p>'+(aiRetryable(m.err)?'<button type="button" class="vero-more vero-retry" data-act="retryai" data-idx="'+m.idx+'">Retry</button>':'');
    } else if(m.state==='done'){
      var d=m.data, web=d.route==='web'&&d.sources&&d.sources.length;
      out='<div class="vero-ai-meta"><span class="vero-ai-badge">VERO AI</span><span>'+(web?'Verified with official sources':'Based on UGREEN Pricelist data')+'</span></div>';
      out+='<p class="vero-ai-reply">'+e(d.reply)+'</p>';
      if(d.confidence==='low') out+='<p class="vero-ai-warn">Low confidence \u2014 please verify before quoting.</p>';
      if(d.picks.length){
        out+='<div class="vero-list">'+d.picks.map(function(p){
          var prod=byCode(p.item_code); if(!prod) return '';
          return '<div class="vero-ai-pick">'+card(prod,{compact:true})+'<p class="vero-ai-why"><span class="vero-basis vero-basis-'+e(p.basis)+'">'+basisLabel(p.basis)+'</span>'+e(p.reason)+'</p></div>';
        }).join('')+'</div>';
      }
      if(d.cannot_confirm&&d.cannot_confirm.length) out+='<p class="vero-ai-note"><b>Couldn\u2019t confirm:</b> '+d.cannot_confirm.map(e).join(' \u00B7 ')+'</p>';
      if(d.conflicts&&d.conflicts.length) out+='<p class="vero-ai-note"><b>Sources disagree:</b> '+d.conflicts.map(e).join(' \u00B7 ')+'</p>';
      if(web){
        out+='<div class="vero-sources"><div class="vero-sources-h">Sources</div>'+d.sources.map(function(s){
          return '<a href="'+e(s.url)+'" target="_blank" rel="noopener noreferrer nofollow">'+e(s.title||s.domain)+'</a><span class="vero-src-dom">'+e(s.domain)+'</span>';
        }).join('')+'</div>';
      }
      out+='<p class="vero-fine">AI guidance \u2014 confirm specs before quoting. Prices shown are from the live pricelist.</p>';
    }
    return '<div class="vero-msg vero-bot vero-ai">'+avatar(av,'vero-av-sm')+'<div class="vero-bub">'+out+'</div></div>';
  }
  function renderDisc(){
    var d=$('vero-disc'); if(!d) return;
    var sess=aiForUser()?aiSession():null;
    d.innerHTML='Answers come from the current UGREEN pricelist.'+(sess?' <span class="vero-ai-on">VERO AI on</span> \u00B7 <button type="button" class="vero-link vero-signout" data-act="aisignout">Sign out</button>':'');
  }

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
    spark:'<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path d="M12 2.5c.6 4.6 2.9 6.9 7.5 7.5-4.6.6-6.9 2.9-7.5 7.5-.6-4.6-2.9-6.9-7.5-7.5 4.6-.6 6.9-2.9 7.5-7.5z" fill="currentColor"/></svg>',
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
    if(r.stockNote){ out+='<p class="vero-fine">'+e(r.stockNote)+'</p>'; }   /* p2r1: no inventory data -> never imply stock */
    if(m.offer){ out+='<button type="button" class="vero-chip vero-askai" data-act="askai" data-idx="'+m.idx+'">\u2726 Ask VERO AI</button>'; }
    if(r.needsAI && !aiForUser() && r.type!=='compare'){
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
    S.msgs.forEach(function(m){ h+=(m.role==='me')?userHtml(m):(m.role==='ai'?aiHtml(m):botHtml(m)); });
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
  function pushBot(res){ var m={role:'bot',res:res,idx:S.msgs.length,shown:(res&&res.rank)?Math.min(Math.max(PAGE,(res.codes||[]).length),12):PAGE}; S.msgs.push(m); return m; }
  function ask(text,ctx,label){
    syncMode();
    text=String(text||'').trim(); if(!text) return;
    S.msgs.push({role:'me',text:label||text});
    var res;
    var all=pool();
    if(!all.length) res={type:'text',note:'The pricelist is still loading \u2014 try again in a moment.',codes:[],chips:[]};
    else{
      try{ res=window.VeroEngine.answer(all,text,Object.assign({},ctx||{},{dealer:!!dealer()})); }   /* dealer flag: price labels only (Special DP); data stays local */
      catch(err){ try{ console.warn('[VERO]',err); }catch(_){}; res={type:'text',note:'Sorry \u2014 I couldn\u2019t process that. Try an item code, model, or product type.',codes:[],chips:[]}; }
    }
    res.query=text; res.ctx=ctx||{};
    var bm=pushBot(res);
    if(!(ctx&&ctx.compareCodes)) aiAfterLocal(bm,text);
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
    place(); renderLog(); renderDisc();
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
    if(act==='askai'){
      var lm=S.msgs[+b.getAttribute('data-idx')]; if(!lm||!lm.res) return;
      lm.offer=false;
      var dec=window.VeroEngine.aiRoute(pool(),lm.res.query,lm.res,{manual:true});
      if(dec.route==='local'){ pushAi({q:lm.res.query,route:'catalog',candidates:[],trigger:'manual',state:'error',err:'no_candidates'}); renderAndKeep(); scrollEnd(); return; }
      startAI(lm.res.query,dec,'manual'); renderAndKeep(); scrollEnd(); return;
    }
    if(act==='gateopen'){
      var gm=S.msgs[+b.getAttribute('data-idx')]; if(!gm) return;
      AI_GATE.open(gm); renderAndKeep();
      var gi=document.querySelector('[data-unlock="'+gm.idx+'"]'); if(gi) try{ gi.focus({preventScroll:true}); }catch(_){ gi.focus(); }
      return;
    }
    if(act==='unlock'){
      var um=S.msgs[+b.getAttribute('data-idx')]; var inp2=document.querySelector('[data-unlock="'+b.getAttribute('data-idx')+'"]');
      if(um) AI_GATE.submit(um,inp2?inp2.value:''); return;
    }
    if(act==='retryai'){ var rm=S.msgs[+b.getAttribute('data-idx')]; if(rm) runAI(rm); return; }
    if(act==='aisignout'){ setAiSession(null); renderDisc(); renderAndKeep(); return; }
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
        '<div class="vero-disc" id="vero-disc">Answers come from the current UGREEN pricelist.</div>'+
      '</div>';
    d.addEventListener('click',onClick);
    document.body.appendChild(fab);
    document.body.appendChild(d);
    document.body.classList.add('vero-on');
    $('vero-input').addEventListener('keydown',function(ev){ if(ev.key==='Enter'){ ev.preventDefault(); send(); } });
    d.addEventListener('keydown',function(ev){ var t=ev.target; if(ev.key==='Enter'&&t&&t.hasAttribute&&t.hasAttribute('data-unlock')){ ev.preventDefault(); var um=S.msgs[+t.getAttribute('data-unlock')]; if(um) AI_GATE.submit(um,t.value); } });
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
