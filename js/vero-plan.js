/* VERO Local Brain — QueryPlan builder (SHADOW MODE, step qp1).
   One pipeline, one plan per question:  normalize -> extract -> plan -> context refs -> shadow route -> candidate set.
   SHADOW ONLY: not loaded by index.html, not referenced by vero.js / vero-engine.js / vero-nlu.js. The current engine stays
   authoritative and produces every answer; this module only builds a QueryPlan beside it for tests and comparison.
   Rules
     - Vocabulary comes from VeroLexicon (data). This file holds grammar only: numbers, units, comparators, the
       capacity-vs-price "k" rule, decimal-k, connector pairs, intent precedence and the router.
     - Product facts come only from VeroFacts (one evidence rule for every path):
         STRONG = structured field / product name (confirmed) · MEDIUM = feature line (confirmed) · WEAK = short_desc /
         description (mentioned only, never confirmed). Unknown stays unknown.
     - A named SKU / model ANCHORS the plan; it never consumes the intent.
     - No AI / WEB route without an identified product intent (anchor, type, use case or context) and a candidate set.
     - MagSafe != magnetic wireless, Qi != Qi2, USB-C port != USB-C cable, Thunderbolt != USB4 (VeroFacts.assertLexiconSafe).
     - No SKU lists, no prices, no network calls. Never mutates the product objects.
     - Alternatives / nearest match: intent recognised, executor NOT built (p2r3b). Sales Coach: COACH_FUTURE only.
   Browser: window.VeroPlan; Node: module.exports. Depends on VeroLexicon, VeroFacts and VeroNLU (price-history rows). */
(function(root){
  'use strict';
  var LEX0=root.VeroLexicon||null, F0=root.VeroFacts||null, NL0=root.VeroNLU||null;
  if(typeof require==='function'){
    if(!LEX0){ try{ LEX0=require('./vero-lexicon.js'); }catch(e){} }
    if(!NL0){ try{ NL0=require('./vero-nlu.js'); }catch(e){} }
    if(!F0){ try{ F0=require('./vero-facts.js'); }catch(e){} }
  }
  function LEX(){ return root.VeroLexicon||LEX0; }
  function FACTS(){ return root.VeroFacts||F0; }
  function NLU(){ return root.VeroNLU||NL0; }
  var VERSION='p2r3a';
  var HOOK={ byCode:null, today:null };   /* per-call helpers (product lookup, 'today'); never stored on the returned plan */
  var ROUTES={ LOCAL:'LOCAL', AI:'AI_CATALOG', WEB:'WEB', CLARIFY:'CLARIFY', COACH:'COACH_FUTURE' };

  function esc(w){ return String(w).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }
  function uniq(a){ var o=[], s={}; (a||[]).forEach(function(x){ if(!s[x]){ s[x]=1; o.push(x); } }); return o; }
  function num(v){ var n=parseFloat(String(v).replace(/,/g,'')); return isNaN(n)?null:n; }

  /* ======================= 1. normalize (surface forms only, no meaning) ======================= */
  function normalize(raw){
    var s=' '+String(raw==null?'':raw).toLowerCase()+' ';
    s=s.replace(/[   ]/g,' ').replace(/[“”"]/g,' ').replace(/[’`]/g,"'").replace(/：/g,':');
    s=s.replace(/₱/g,' ₱ ').replace(/\bphp\b/g,' ₱ ');
    s=s.replace(/(\d),(\d{3})(?!\d)/g,'$1$2').replace(/(\d),(\d{3})(?!\d)/g,'$1$2');
    s=s.replace(/\b(?:type|tipo)[\s-]?c\b|\busb[\s-]?c\b|\busbc\b|\btypec\b/g,'usb-c').replace(/\busb[\s-]?a\b/g,'usb-a');
    s=s.replace(/\bpci[\s-]?express\b|\bpci[\s-]?e(?![a-z])/g,'pcie ');   /* PCIe = PCI-E = PCI Express (names write "PCI-E3.0X4" and "PCIe Gen 4"); same text path for names and queries */
    s=s.replace(/\bbuild[\s-]?in\b|\bbuilt\s+in\b/g,'built-in')
     .replace(/\b(?:kotse|sasakyan|oto)\b/g,'car')
     .replace(/\b(?:may |with )?(?:cable|kable) na naka-?kabit\b|\bnaka-?kabit na (?:cable|kable)\b|\b(?:may )?sariling (?:cable|kable)\b|\b(?:naka-?attach na|attached) (?:cable|kable)\b|\bintegrated cable\b/g,' built-in cable ').replace(/\bmag\s?safe\b/g,'magsafe').replace(/\bqi\s?2\b/g,'qi2');
    s=s.replace(/\bhdmi\s*(2\.1|2\.0|1\.4)\b/g,'hdmi $1').replace(/\bdisplay\s?port\b/g,'displayport').replace(/\bpower\s?banks?\b/g,function(m){ return /s$/.test(m)?'power banks':'power bank'; });
    s=s.replace(/\b(8k|4k)\s*[x×*]\s*(4k|2k)\b/g,'$1');
    s=s.replace(/[?!]+/g,' ').replace(/,(?!\d)/g,' , ').replace(/\s+/g,' ');
    return s;
  }
  /* "Nk" thousands (engine p2r2.1 rule): in a capacity context a 5k–60k value is mAh unless an explicit price cue is attached */
  var K_PRICE_BEFORE=/(?:₱|budget(?:\s+(?:of|is|ko|ng))?|under|below|less than|lower than|cheaper than|up to|max(?:imum)?|hanggang|wala pang|within|not more than|price|presyo|srp|dp|magkano|worth|cost|costs)\s*$/;
  function expandK(s,trace,capHint){
    var capCtx=capHint || /power bank|\bmah\b|\bcapacity\b|\bbattery\b/.test(s);
    return s.replace(/(\d+(?:\.\d+)?)\s?k\b(\s?mah\b)?/g,function(all,n,mah,off,str){
      var v=Math.round(parseFloat(n)*1000);
      if(mah){ trace.push('k:'+all.trim()+'→'+v+'mAh'); return v+'mah'; }
      var pre=str.slice(Math.max(0,off-24),off).replace(/\b(?:lowest|highest|cheapest|best)\s+(?:price|presyo)\s*$/,' ');
      /* 2k / 4k / 5k / 8k with no price cue = a video resolution, not an amount ("may 8K HDMI", "4K@60Hz") */
      if(/^[2458]$/.test(n) && !K_PRICE_BEFORE.test(pre) && !/(?:above|over|more than|at least|min(?:imum)?)\s*$/.test(pre) && !/^\s*(?:₱|pesos?\b|budget\b)/.test(str.slice(off+all.length,off+all.length+12))) return all;
      if(capCtx && v>=5000 && v<=60000 && !K_PRICE_BEFORE.test(pre) && !/^\s*(?:₱|(?:pesos?|budget)\b)/.test(str.slice(off+all.length,off+all.length+12))){
        trace.push('k:'+all.trim()+'→'+v+'mAh(capacity-context)'); return v+'mah'; }
      trace.push('k:'+all.trim()+'→'+v); return String(v);
    });
  }

  /* ======================= lexicon compilation (once per lexicon object) ======================= */
  var C=null, C_FOR=null;
  function phraseRe(ph){
    var p=esc(ph.toLowerCase()), tail=/[a-z]$/.test(ph)?'(?:ng|g|s)?':'';
    return new RegExp('(^|[^a-z0-9₱])('+p+')'+tail+'(?=$|[^a-z0-9])','g');
  }
  function compile(){
    var L=LEX(); if(C && C_FOR===L) return C;
    if(!L) throw new Error('VeroLexicon not loaded');
    FACTS().assertLexiconSafe(L);
    var c={ phrases:[], aliases:[], connectors:[], attrs:[], metrics:[], hist:{}, useCases:[], devClass:[], devBrand:[], external:[], colors:[] };
    Object.keys(L.language).forEach(function(g){ L.language[g].forEach(function(ph){ c.phrases.push({ g:g, ph:ph, re:phraseRe(ph) }); }); });
    c.phrases.sort(function(a,b){ return b.ph.length-a.ph.length; });
    L.aliases.forEach(function(a){ var ns=String(a.to).split('.')[0]; if(ns==='connector'||ns==='flag') return;
      c.aliases.push({ term:a.term, to:a.to, rel:a.relation, strict:!!a.strict, fallback:!!a.familyFallback, re:phraseRe(a.term) }); });
    var haveT={}, gen={}; c.aliases.forEach(function(a){ haveT[a.term.toLowerCase()]=1; }); (L.genericLabels||[]).forEach(function(w){ gen[w]=1; });
    L.taxonomy.families.forEach(function(f){ [f.label,f.plural].join(' / ').split(/\s*\/\s*|\s+and\s+/).forEach(function(t){ t=String(t||'').toLowerCase().trim(); if(!t||gen[t]||haveT[t]) return; haveT[t]=1;
      c.aliases.push({ term:t, to:f.id, rel:'same', strict:false, fallback:false, re:phraseRe(t), derived:true }); }); });
    c.aliases.sort(function(a,b){ return b.term.length-a.term.length; });
    Object.keys(L.connectors).forEach(function(k){ L.connectors[k].forEach(function(w){ c.connectors.push({ k:k, w:w, re:new RegExp('(^|[^a-z0-9.])('+esc(w)+')(?=$|[^a-z0-9])','g') }); }); });
    c.connectors.sort(function(a,b){ return b.w.length-a.w.length; });
    Object.keys(L.attributes||{}).forEach(function(k){ L.attributes[k].forEach(function(w){ c.attrs.push({ k:k, w:w, re:phraseRe(w) }); }); });
    c.attrs.sort(function(a,b){ return b.w.length-a.w.length; });
    Object.keys(L.metrics||{}).forEach(function(k){ L.metrics[k].forEach(function(w){ c.metrics.push({ k:k, w:w, re:phraseRe(w) }); }); });
    c.metrics.sort(function(a,b){ return b.w.length-a.w.length; });
    ['up','down'].forEach(function(d){ c.hist[d]=((L.historyDir||{})[d]||[]).map(phraseRe); });
    Object.keys(L.useCases||{}).forEach(function(k){ var u=L.useCases[k]; (u.terms||[]).forEach(function(w){ c.useCases.push({ k:k, w:w, re:phraseRe(w) }); }); });
    c.useCases.sort(function(a,b){ return b.w.length-a.w.length; });
    var D=L.devices||{classes:{},brands:{}};
    Object.keys(D.classes).forEach(function(k){ D.classes[k].forEach(function(w){ c.devClass.push({ k:k, re:phraseRe(w) }); }); });
    Object.keys(D.brands).forEach(function(k){ D.brands[k].forEach(function(w){ c.devBrand.push({ k:k, w:w, re:new RegExp('(^|[^a-z0-9])('+esc(w)+')((?:\\s+(?:air|pro|max|plus|ultra|mini|fe|se|lite|neo|m\\d{1,2}|s\\d{1,2}|a\\d{1,2}|\\d{1,2}))*)(?=$|[^a-z0-9])','g') }); }); });
    c.devBrand.sort(function(a,b){ return b.w.length-a.w.length; });
    c.external=(L.external||[]).map(phraseRe);
    Object.keys(L.colors).forEach(function(k){ L.colors[k].forEach(function(w){ c.colors.push({ k:k, re:new RegExp('\\b'+esc(w)+'\\b') }); }); });
    c.small=[]; Object.keys(L.smalltalk||{}).forEach(function(k){ L.smalltalk[k].forEach(function(w){ c.small.push({ k:k, w:w, re:new RegExp('(^| )'+esc(w)+'(?=[ ]|$)','g') }); }); });
    c.small.sort(function(a,b){ return b.w.length-a.w.length; });
    c.smallFill={}; (L.smalltalkFiller||[]).forEach(function(w){ c.smallFill[w]=1; });
    c.followRe=new RegExp('^ (?:'+(L.followUpCues||[]).slice().sort(function(a,b){ return b.length-a.length; }).map(esc).join('|')+')(?= )');
    c.topicRe=new RegExp(' (?:'+(L.topicSwitchCues||[]).map(esc).join('|')+')(?= |:)');
    c.standards=[]; Object.keys(L.standards||{}).forEach(function(k){ L.standards[k].terms.forEach(function(w){ c.standards.push({ k:k, re:new RegExp('(^|[^a-z0-9])'+esc(w)+'(?![a-z0-9])') }); }); });
    c.displayRe=new RegExp('\\b(\\d|two|three|four|dual|triple|dalawang|dalawa|tatlong)\\s*(?:'+(L.displayWords||['monitor']).map(esc).join('|')+')\\b');
    /* every word the lexicon already explains (used to tell a product NAME / unknown qualifier from ordinary words) */
    var V={}; function addW(t){ String(t||'').toLowerCase().split(/[^a-z0-9.-]+/).forEach(function(w){ if(w) V[w]=1; }); }
    Object.keys(L.language).forEach(function(g){ L.language[g].forEach(addW); }); L.aliases.forEach(function(a){ addW(a.term); });
    L.taxonomy.families.forEach(function(f){ addW(f.label); addW(f.plural); (f.subtypes||[]).forEach(function(x){ addW(x.label); }); (f.nameCues||[]).forEach(addW); });
    [L.connectors,L.colors,L.attributes||{},L.metrics||{},L.smalltalk||{},L.forms||{}].forEach(function(o){ Object.keys(o).forEach(function(k){ addW(k); (o[k]||[]).forEach(addW); }); });
    Object.keys(L.useCases||{}).forEach(function(k){ addW(k); ((L.useCases[k]||{}).terms||[]).forEach(addW); });
    Object.keys((L.devices||{}).classes||{}).forEach(function(k){ L.devices.classes[k].forEach(addW); }); Object.keys((L.devices||{}).brands||{}).forEach(function(k){ L.devices.brands[k].forEach(addW); });
    [L.smalltalkFiller,L.followUpCues,L.topicSwitchCues,L.inventoryWords,L.external,L.taglishMarkers,L.nameGeneric,L.genericLabels,Object.keys(L.nameQualifiers||{}),((L.historyDir||{}).up||[]),((L.historyDir||{}).down||[])].forEach(function(a){ (a||[]).forEach(addW); });
    FU_KNOWN.forEach(addW); NOUN_STOP.forEach(addW); EXTRA_STOP.forEach(addW);
    c.vocab=V; c.nameGeneric={}; (L.nameGeneric||[]).forEach(function(w){ c.nameGeneric[w]=1; });
    c.inv=new RegExp('(^|[^a-z0-9])('+(L.inventoryWords||[]).slice().sort(function(a,b){ return b.length-a.length; }).map(esc).join('|')+')(?=$|[^a-z0-9])');
    c.L=L; C=c; C_FOR=L; return c;
  }

  /* longest-first phrase scan across ALL language groups; a matched span is consumed so a shorter phrase in another group
     ("mura" inside "mas mura", "longer" inside "longer than") cannot also fire. Declared shared phrases count for each group. */
  function scanGroups(s,c){
    var G={}, work=s, shared=c.L.sharedPhrases||{};
    c.phrases.forEach(function(x){
      x.re.lastIndex=0; var m, hit=false;
      while((m=x.re.exec(work))){ hit=true; var st=m.index+m[1].length, len=m[0].length-m[1].length;
        work=work.slice(0,st)+new Array(len+1).join('\u0001')+work.slice(st+len); x.re.lastIndex=st+len; }
      if(hit){ (G[x.g]=G[x.g]||[]).push(x.ph); (shared[x.ph]||[]).forEach(function(g){ if(g!==x.g) (G[g]=G[g]||[]).push(x.ph); }); }
    });
    return G;
  }
  function firstHit(list,s){ for(var i=0;i<list.length;i++){ list[i].re.lastIndex=0; var m=list[i].re.exec(s); if(m) return { x:list[i], at:m.index+m[1].length, text:m[2] }; } return null; }
  function allHits(list,s){ var out=[]; list.forEach(function(x){ x.re.lastIndex=0; var m; while((m=x.re.exec(s))){ out.push({ x:x, at:m.index+m[1].length, text:m[2] }); } }); return out; }

  /* ======================= anchor index (item code / UPC / material no. / model) ======================= */
  var AIX={ key:null, idx:null };
  function anchorIndex(products,key){
    if(AIX.key===key && AIX.idx) return AIX.idx;
    var codes={}, models={}, multi=[];
    function add(map,k,code){ if(!k) return; (map[k]=map[k]||[]); if(map[k].indexOf(code)<0) map[k].push(code); }
    products.forEach(function(p){ if(!p) return; var code=String(p.item_code);
      add(codes,code.toLowerCase(),code); add(codes,String(p.upc||'').toLowerCase().trim(),code); add(codes,String(p.material_number||'').toLowerCase().trim(),code);
      var m=String(p.model||'').toLowerCase().replace(/\s+/g,' ').trim(); if(!m) return;
      add(models,m,code); var m1=m.split(' ')[0]; if(m1!==m) add(models,m1,code);
      if(/\s/.test(m) && /\d/.test(m)) multi.push(m);
    });
    multi=uniq(multi).sort(function(a,b){ return b.length-a.length; });
    AIX={ key:key, idx:{ codes:codes, models:models, multi:multi } }; return AIX.idx;
  }
  /* ---------- fix-pack 2 #1: product-NAME / line-name anchors, built from the live products (no SKU lists; new SKUs join automatically) ---------- */
  var NIX={ key:null, idx:null };
  function nameToks(txt){ return normalize(txt).replace(/[()\[\]{}“”"'’,;:|/+&*]/g,' ').split(/[^a-z0-9.-]+/).map(function(w){ return w.replace(/^[.-]+|[.-]+$/g,''); }).filter(Boolean); }
  function nameIndex(products,key){
    if(NIX.key===key && NIX.idx) return NIX.idx;
    var post={}, toks={}, df={};
    products.forEach(function(p){ if(!p) return; var code=String(p.item_code), tk=nameToks(p.product_name); toks[code]=tk;
      var seen={}; tk.forEach(function(w,i){ (post[w]=post[w]||[]).push([code,i]); if(!seen[w]){ seen[w]=1; df[w]=(df[w]||0)+1; } }); });
    NIX={ key:key, idx:{ post:post, toks:toks, df:df } }; return NIX.idx;
  }
  /* a word that can identify products by NAME: not explained by the lexicon, not generic, not a spec, rare enough in names */
  function nameWord(w,c,ni){ return !!(ni.df[w] && ni.df[w]<=40 && /[a-z]/.test(w) && (w.length>=4 || (/\d/.test(w) && w.length>=3) || (w.length===3 && ni.df[w]<=5)) && !c.vocab[w] && !c.nameGeneric[w] && !SPEC_TOKEN.test(w)); }
  /* longest contiguous query window that appears contiguously in product names and holds >= 1 name word */
  function findNames(t,c,ni,trace){
    var q=[], out=[], used={};
    nameToks(t).forEach(function(w){ if(/-/.test(w) && !ni.df[w]) w.split('-').forEach(function(x){ if(x) q.push(x); }); else q.push(w); });   /* "open-ear" → open ear */
    /* join split brand words ("fit buds" -> fitbuds, "max 5s" -> max5s) */
    for(var i=0;i+1<q.length;i++){ var j=q[i]+q[i+1]; if(ni.df[j] && !ni.df[q[i]+' '] && nameWord(j,c,ni) && !(nameWord(q[i],c,ni)&&nameWord(q[i+1],c,ni))){ q.splice(i,2,j); } }
    for(var a=0;a<q.length;a++){
      if(used[a] || !nameWord(q[a],c,ni)) continue;
      var best=null;
      for(var lo=a;lo>=Math.max(0,a-3);lo--){ for(var hi=a;hi<Math.min(q.length,a+4);hi++){
        if(hi-lo+1<= (best?best.hi-best.lo+1:0)) continue;
        var win=q.slice(lo,hi+1); if(win.some(function(w,ix){ return used[lo+ix]; })) continue;
        if(win.length>1 && win.indexOf('to')>=0) continue;   /* "X to Y" is a direction; names write it both ways ("M.2 to PCI-E" / "PCIe … to M.2"), so "to" never glues a name phrase */
        if(win.some(function(w){ return !ni.df[w]; })) continue;
        var codes=[]; (ni.post[win[0]]||[]).forEach(function(pp){ var tk=ni.toks[pp[0]]; for(var k=1;k<win.length;k++){ if(tk[pp[1]+k]!==win[k]) return; } if(codes.indexOf(pp[0])<0) codes.push(pp[0]); });
        if(codes.length){ /* edge words that are only vocabulary add nothing: keep them only when they narrow the match */ best={ lo:lo, hi:hi, codes:codes, text:win.join(' ') }; }
      } }
      if(!best) continue;
      for(var u=best.lo;u<=best.hi;u++) used[u]=1;
      out.push(best); trace.push('name:"'+best.text+'"→'+best.codes.length);
    }
    return out;
  }
  var SPEC_TOKEN=/^\d+(?:\.\d+)?(?:w|watts?|mah|m|cm|mm|k|in1|ports?|p|hz|gb|tb|g|gbps|mbps)$|^cat\d{1,2}[a-z]?$|^hdmi\d|^usb\d|^pd\d|^qi\d|^gen\d|^ddr\d|^wifi\d|^\d+k\d+(?:hz)?$/;
  function findAnchors(s,ai,trace){
    var out=[], work=s;
    ai.multi.forEach(function(m){ var re=new RegExp('(^|[^a-z0-9])'+esc(m)+'(?=$|[^a-z0-9])'); if(re.test(work)){ out.push({ raw:m, via:'model', codes:ai.models[m].slice() }); work=work.replace(re,' '); } });
    var toks=work.split(/[^a-z0-9.]+/).filter(Boolean);
    for(var i=0;i+1<toks.length;i++){ var j=toks[i]+toks[i+1]; if(/\d/.test(j) && ai.models[j] && !ai.models[toks[i]]){ out.push({ raw:toks[i]+' '+toks[i+1], via:'model', codes:ai.models[j].slice() }); work=work.replace(new RegExp('\\b'+esc(toks[i])+'\\s+'+esc(toks[i+1])+'\\b'),' '); } }
    work.split(/[^a-z0-9.]+/).forEach(function(t){
      t=t.replace(/^\.+|\.+$/g,''); if(t.length<4 || !/\d/.test(t) || SPEC_TOKEN.test(t) || /^\d{1,4}$/.test(t) || /^\d+\.\d+$/.test(t)) return;
      if(/^\d+$/.test(t) && new RegExp('(under|below|less than|lower than|up to|max(imum)?|hanggang|budget|within|above|over|more than|at least|min(imum)?|between|₱)\\s*₱?\\s*'+t+'\\b').test(work)) return;
      if(out.some(function(a){ return a.raw===t; })) return;
      if(ai.codes[t]) out.push({ raw:t, via:'item_code', codes:ai.codes[t].slice() });
      else if(ai.models[t]) out.push({ raw:t, via:'model', codes:ai.models[t].slice() });
      else if(/[a-z]/.test(t) || t.length>=5) { out.push({ raw:t, via:'unresolved', codes:[] }); trace.push('anchor:unresolved '+t); }
    });
    return out;
  }

  /* ======================= 2. extract slots (grammar) ======================= */
  var MAXW=/(?:under|below|less than|lower than|up to|max(?:imum)?|hanggang|wala pang|within|not more than|cheaper than|shorter than|<=?)\s*₱?\s*$/;
  var GEW=/(?:at least|minimum(?: of)?|min\.?|>=)\s*₱?\s*$/;
  var GTW=/(?:more than|over|above|higher than|longer than|greater than|>)\s*₱?\s*$/;
  var SUF_GE=/^\s*(?:pataas|and up|and above|or more|or higher|or above|\+)/;
  var SUF_LE=/^\s*(?:pababa|or less|and below|or lower|and under)/;
  function opAt(s,off,len){
    var pre=s.slice(Math.max(0,off-22),off), post=s.slice(off+len,off+len+14);
    if(MAXW.test(pre)) return 'le'; if(GEW.test(pre)) return 'ge'; if(GTW.test(pre)) return 'gt';
    if(SUF_GE.test(post)) return 'ge'; if(SUF_LE.test(post)) return 'le'; return 'eq';
  }
  var RES_RANK={'720p':1,'1080p':2,'fhd':2,'2k':3,'1440p':3,'qhd':3,'4k':4,'uhd':4,'5k':5,'8k':6}, RES_LABEL={1:'720p',2:'1080p',3:'2K',4:'4K',5:'5K',6:'8K'};
  function decimalTail(s,i){ return i>=2 && s.charAt(i-1)==='.' && /\d/.test(s.charAt(i-2)); }
  function priceCtx(s,i,len){ var pre=s.slice(Math.max(0,i-16),i), post=s.slice(i+len,i+len+10);
    return /(₱|peso|pesos|budget|under|below|over|above|less than|more than|hanggang|within|price|srp|dp|at least|up to|max|min)\s*$/.test(pre)||/^\s*(pesos?|budget)\b/.test(post); }
  /* 'dp' = DisplayPort only next to video / connector words; otherwise the dealer-price field */
  function dpIsConnector(s){ return /\b(hdmi|usb-c|vga|dvi|mini|displayport)\b[^.]{0,14}\bdp\b|\bdp\b[^.]{0,14}\b(hdmi|vga|dvi|cable|adapter|converter|ports?|monitor|alt)\b|\bdp\s?1\.\d/.test(s); }

  function extract(q,c,trace,o){
    o=o||{};
    var raw=String(q==null?'':q), s0=normalize(raw), s=expandK(s0,trace,o.capHint);
    var X={ raw:raw, norm:s.trim(), filters:[], match:[], connectors:[], pair:null, ports:[], unsupported:[], devices:{ classes:[], named:[] } };
    /* p2r3a fix 6: a leading "ok / okay / sige" (and a topic-switch cue) is a discourse marker, not a judgement word */
    var sG=s.replace(/^\s*(?:o\s+)?(?:ok(?:ay)?|sige|cge|alright|ah|oh)(?:\s+po)?\s*,?\s+(?!(?:ba|na ba|lang ba|kaya|ito|yan|yun|yung|ang|sa)\b)/,' ');
    if(c.topicRe.test(' '+sG.trim()+' ')) sG=(' '+sG.trim()+' ').replace(c.topicRe,' ').replace(/^\s*[,:]\s*/,' ');
    X.G=scanGroups(sG,c);
    /* p2r3a fix 1: inventory wording (VERO has no live inventory) — caveat + "listed" wording only, never a filter */
    var invHit=c.inv.exec(s); c.inv.lastIndex=0;
    var invOpt=/\bmeron pa(?:ng| ba| bang)?\s+(?:iba|ibang|mas|other|cheaper|mura|murang)\b/.test(s);   /* "meron pa bang mas mura?" asks for more options, not stock */
    if(invHit && /^meron pa/.test(invHit[2]) && invOpt) invHit=null;
    if(invHit && /^availab/.test(invHit[2]) && /\b(colou?rs?|kulay|variants?|versions?)\b/.test(s) && !/\b(stocks?|on hand|natitira|remaining|sold out|ubos)\b/.test(s)) invHit=null;
    X.inventory=!!invHit || (!!X.G.stock && !invOpt) || /\b(?:how many|any|ilan|ilang)\b[^.]{0,30}\bleft\b|\bleft in stock\b/.test(s);
    X.invQty=X.inventory && /\b(ilan|ilang|how many|natitira|natira|remaining|left|quantity|qty|units?|pcs)\b/.test(s);
    var dpConn=dpIsConnector(s);
    X.dpConn=dpConn;
    /* ---- video resolution / refresh / HDMI version (same grammar as p2r2.1, so evidence parity holds) ---- */
    var hasQ=/\bhdmi\b/.test(s)?'hdmi':(/\bdisplayport\b/.test(s)||(dpConn&&/\bdp\b/.test(s))?'dp':null), refreshDone=false, t=s;
    t=t.replace(/\b(8k|4k|2k|1080p|1440p)(\s*@\s*|\s+|)(\d{2,3})\s*(hz)?\b/g,function(all,r,sep,hz,unit,off,str){
      if(decimalTail(str,off)) return all; if(!unit && sep.trim()!=='@' && sep!=='') return all;
      X.match.push({ k:'refresh', r:RES_RANK[r], hz:+hz, q:hasQ, label:RES_LABEL[RES_RANK[r]]+'@'+hz+'Hz' }); refreshDone=true; return ' '; });
    t=t.replace(/\b(8k|5k|4k|2k|1080p|1440p)\b/g,function(all,r,off,str){
      if(decimalTail(str,off)) return all; if(/^[2458]k$/.test(r) && priceCtx(str,off,all.length)) return all;
      X.match.push({ k:'res', v:RES_RANK[r], q:hasQ, label:RES_LABEL[RES_RANK[r]] }); return ' '; });
    if(!refreshDone) t=t.replace(/\b(\d{2,3})\s?hz\b/g,function(all,hz){ X.match.push({ k:'refresh', r:null, hz:+hz, q:hasQ, label:hz+'Hz' }); return ' '; });
    t=t.replace(/\bhdmi (2\.1|2\.0|1\.4)\b/g,function(all,v){ X.match.push({ k:'hdmiver', v:parseFloat(v), label:'HDMI '+v }); return ' hdmi '; });
    /* p2r3a fix 3 + fix-pack 2 #4: a number tied to inch / " / -inch is a SIZE (product-name fact), never a price or a bare number.
       Quotes are stripped by normalize(), so read the raw text. "2.5 hdd" (no unit) keeps the drive-size shorthand. */
    var rl=' '+raw.toLowerCase()+' ', szm=rl.match(/[^\d.](\d{1,2}(?:\.\d{1,2})?)(?:\s*(?:-\s*)?(?:inch(?:es)?\b|''|"|“|”|″|')|in\b)/)||rl.match(/[^\d.](2\.5|3\.5)(?=\s*(?:hdd|ssd|sata|hard\s?drive|drive|enclosure|disk)\b)/);
    if(szm && +szm[1]>0 && +szm[1]<=40){ var szv=String(+szm[1]); X.match.push({ k:'size', v:szv, label:szv+'"' });
      t=t.replace(new RegExp('(^|[^\\d.])'+szm[1].replace('.','\\.')+'\\s*(?:-\\s*)?(?:inch(?:es)?|in)?(?![\\d.])'),'$1 '); trace.push('size:'+szv+'"'); }
    /* ---- speeds ---- */
    if(/\b(lan|ethernet|rj45|network|gigabit)\b/.test(t)){
      if(/\bgigabit\b/.test(t)&&!/\b(2\.5|5|10)\s?g/.test(t)) X.match.push({ k:'eth', v:1, label:'Gigabit' });
      t=t.replace(/\b(2\.5|5|10|25)\s?(?:gbps|gb\/s|g)\b/g,function(all,v){ X.match.push({ k:'eth', v:+v, label:v+'Gbps' }); return ' '; });
    } else {
      t=t.replace(/\b(\d+(?:\.\d+)?)\s?(?:gbps|gb\/s|g)\b/g,function(all,v){ if(+v<1||+v>120) return all; X.match.push({ k:'gbps', v:+v, label:v+'Gbps' }); return ' '; });
    }
    /* ---- feature flags (MagSafe / Qi2 are certification words: only those exact words, never "magnetic" / "qi") ---- */
    if(/\bbuilt-in\b|\bintegrated cable\b/.test(t)) X.match.push({ k:'flag', v:'builtin' });
    if(/\bretractable\b/.test(t)) X.match.push({ k:'flag', v:'retractable' });
    if(/\bqi2\b/.test(t)) X.match.push({ k:'flag', v:'qi2' });
    else if(/\bqi\b/.test(t)){ X.unsupported.push({ attr:'qi', note:'Qi is not Qi2; no Qi flag is indexed' }); trace.push('qi≠qi2'); }
    if(/\bmagsafe\b/.test(t)) X.match.push({ k:'flag', v:'magsafe' });
    else if(/\bmagnetic\b/.test(t)) trace.push('magnetic (related to MagSafe, never equivalent)');
    if(/\bgan\b/.test(t)) X.match.push({ k:'flag', v:'gan' });
    if(/\bpd\b(?!\s?vol)/.test(t)) X.match.push({ k:'flag', v:'pd' });
    /* ---- colour ---- */
    for(var i=0;i<c.colors.length;i++){ if(c.colors[i].re.test(t)){ X.match.push({ k:'color', v:c.colors[i].k }); break; } }
    /* ---- numeric specs ---- */
    var masked=t;
    t.replace(/(\d+(?:\.\d+)?)\s?(?:w|watts?)\b/g,function(m,n,off){ X.filters.push({ attr:'watts', op:opAt(t,off,m.length), value:+n, unit:'W', raw:m.trim() }); return m; });
    t.replace(/(\d{3,6})\s?mah\b/g,function(m,n,off){ X.filters.push({ attr:'mah', op:opAt(t,off,m.length), value:+n, unit:'mAh', raw:m.trim() }); return m; });
    var lastNum=X.filters.length?X.filters[X.filters.length-1]:null;
    if(lastNum && lastNum.op==='eq' && /\b(?:pataas|and up|and above|or more|or higher)\s*$/.test(t.trim())){ lastNum.op='ge'; trace.push('suffix range → '+lastNum.attr+' ≥'); }
    var lr=t.match(/\b(\d+(?:\.\d+)?)\s?(m|cm)?\s*(?:to|-|hanggang|and)\s*(\d+(?:\.\d+)?)\s?(m|cm)\b/);
    if(lr){ var f=function(v,u){ v=+v; return u==='cm'?v/100:v; }, lo=f(lr[1],lr[2]||lr[4]), hi=f(lr[3],lr[4]); X.filters.push({ attr:'lengthM', op:'between', value:[Math.min(lo,hi),Math.max(lo,hi)], unit:'m', raw:lr[0].trim() }); }
    else t.replace(/(\d+(?:\.\d+)?)\s?(m|meters?|metres?|metros?|metro|cm)\b/g,function(m,n,u,off,str){
      if(/^\s*(?:ah|bps)/.test(str.slice(off+m.length))) return m; var v=+n; if(u==='cm') v=v/100;
      X.filters.push({ attr:'lengthM', op:opAt(t,off,m.length), value:v, unit:'m', raw:m.trim() }); return m; });
    /* ports: "with 3 ports" = exactly; "at least 3 ports" / "3+ ports" = minimum; "3 HDMI ports" = at least 3 of that kind */
    var pk=t.match(/\b(\d{1,2})\s*(?:x\s*)?(hdmi|displayport|dp|usb-c|usb-a|usb|rj45|ethernet|lan|vga|sd)(?:\s*(?:ports?|outputs?)\b|(?=\s*(?:$|,|and|at|\+|&|ports?)))(?!\s*(?:cables?|adapters?))/);
    if(pk){ X.ports.push({ kind:portKindOf(pk[2]), op:'ge', value:+pk[1], raw:pk[0] }); masked=masked.replace(pk[0],' '); }
    var pt=masked.match(/\b(?:(at least|minimum(?: of)?|min\.?)\s*)?(\d{1,2})\s*(\+|or more|and up|and above)?\s*-?\s*ports?\b/);
    if(pt) X.filters.push({ attr:'ports', op:(pt[1]||pt[3])?'ge':'eq', value:+pt[2], raw:pt[0].trim() });
    else if(/\bsingle[\s-]?port\b/.test(t)) X.filters.push({ attr:'ports', op:'eq', value:1, raw:'single port' });
    var dm=t.match(c.displayRe);
    if(dm){ var NW={two:2,three:3,four:4,dual:2,triple:3,dalawang:2,dalawa:2,tatlong:3}; X.filters.push({ attr:'videoOut', op:'ge', value:NW[dm[1]]||+dm[1], raw:dm[0] }); }
    /* ---- price bounds (numbers with no unit after a comparator, or with ₱) ---- */
    var pm=t.replace(/\d+(?:\.\d+)?\s?(?:w(?:atts?)?|mah|m|meters?|metros?|metro|cm|mm|ports?|hz|gbps|g)\b/g,' ');
    var rng=pm.match(/₱?\s*(\d{2,6})\s*(?:-|to|hanggang)\s*₱?\s*(\d{2,6})(?!\d)/);
    if(rng && (/₱|between|price|budget|presyo/.test(pm))) X.filters.push({ attr:'price', op:'between', value:[+rng[1],+rng[2]], raw:rng[0].trim() });
    else pm.replace(/(under|below|less than|lower than|cheaper than|up to|max(?:imum)?|hanggang|wala pang|budget(?: of| is| ko)?|within|not more than|above|over|more than|at least|min(?:imum)?)\s*₱?\s*(\d{2,6})(?![\d.])/g,function(m,w,n){
      X.filters.push({ attr:'price', op:/above|over|more than/.test(w)?'gt':(/at least|min/.test(w)?'ge':'le'), value:+n, raw:m.trim() }); return m; });
    /* ---- connectors: "A to B" pair, otherwise every named connector ---- */
    var cons=[];
    c.connectors.forEach(function(x){ if(x.k==='dp' && !dpConn && x.w==='dp') return; x.re.lastIndex=0; var m; while((m=x.re.exec(t))){ var at=m.index+m[1].length; if(!cons.some(function(o){ return at>=o.at && at<o.at+o.len; })) cons.push({ k:x.k, at:at, len:m[2].length }); } });
    cons.sort(function(a,b){ return a.at-b.at; });
    X.connectors=cons;
    for(var j=0;j+1<cons.length;j++){ var mid=t.slice(cons[j].at+cons[j].len,cons[j+1].at); if(/^\s*(?:to|papuntang|->)\s*$/.test(mid)){ X.pair={ from:cons[j].k, to:cons[j+1].k }; break; } }
    /* ---- devices: generic class vs named device (brand/line) ---- */
    c.devBrand.forEach(function(x){ x.re.lastIndex=0; var m=x.re.exec(t); if(m && !X.devices.named.some(function(d){ return d.label.indexOf(m[2])>=0; })) X.devices.named.push({ kind:x.k, label:(m[2]+(m[3]||'')).trim() }); });
    c.devClass.forEach(function(x){ x.re.lastIndex=0; if(x.re.test(t) && X.devices.classes.indexOf(x.k)<0) X.devices.classes.push(x.k); });
    X.devices.named.forEach(function(d){ var k={laptop:'laptop',phone:'phone',tablet:'tablet'}[d.kind]; if(k && X.devices.classes.indexOf(k)<0) X.devices.classes.push(k); });
    /* ---- use case / external facts ---- */
    var uc=allHits(c.useCases,t); X.useCases=uniq(uc.map(function(h){ return h.x.k; }));
    var pu=t.match(/\b(?:pang|pang-|para sa|for)\s+([a-z]{3,})\b/); if(pu && !X.useCases.length && !c.L.useCases[pu[1]]) X.useCaseRaw=pu[1];
    X.external=c.external.some(function(re){ re.lastIndex=0; return re.test(t); });
    if(/\b(?:no need|without|walang|hindi kailangan(?: ng)?)\s+displaylink\b/.test(t)) X.unsupported.push({ attr:'displaylink', op:'not', note:'no DisplayLink fact is indexed yet' });
    /* ---- top N ---- */
    var tn=t.match(/\btop\s*(\d{1,2}|two|three|four|five|six|seven|eight|nine|ten)\b|\b(\d{1,2})\s+(?:cheapest|pinakamura|most expensive|longest)\b/);
    if(tn){ var NW2={two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10}; X.topN=Math.max(1,Math.min(10,NW2[tn[1]]||parseInt(tn[1]||tn[2],10))); }
    /* cable standards (Cat6 …) — a name / feature fact, never an anchor */
    X.standards=[]; c.standards.forEach(function(x){ if(x.re.test(t) && X.standards.indexOf(x.k)<0) X.standards.push(x.k); });
    if(X.standards.indexOf('cat6a')>=0) X.standards=X.standards.filter(function(k){ return k!=='cat6'; });
    /* a bare number with no unit (follow-up "how about 100?") */
    var bn=t.replace(/(?:under|below|less than|up to|hanggang|budget|within|above|over|more than|at least|top|₱)\s*\d[\d.]*/g,' ').match(/(?:^|\s)(\d{1,4}(?:\.\d+)?)(?=\s|$)/);
    X.bareNumber=bn?+bn[1]:null;
    X.t=t;
    return X;
  }
  function portKindOf(w){ return ({ displayport:'dp', dp:'dp', 'usb-c':'usb_c', 'usb-a':'usb_a', usb:'usb', rj45:'rj45', ethernet:'rj45', lan:'rj45', hdmi:'hdmi', vga:'vga', sd:'sd' })[w]||w; }

  /* ======================= 3. type resolution (lexicon aliases; structured taxonomy) ======================= */
  function familyIds(c){ var o={}; c.L.taxonomy.families.forEach(function(f){ o[f.id]=f; }); return o; }
  function resolveType(X,c,trace){
    var t2=X.t.replace(/\b(?:na|ng|yung|ung|po|ang|sana|lang|mga)\b/g,' ').replace(/\s+/g,' ');
    var hits=[], work=t2;
    c.aliases.forEach(function(a){ a.re.lastIndex=0; var m; while((m=a.re.exec(work))){ var at=m.index+m[1].length;
      if(a.rel==='related'||a.rel==='notEquivalent'){ trace.push('alias:'+a.term+' ('+a.rel+' '+a.to+', not applied)'); continue; }
      hits.push({ a:a, at:at }); var len=m[0].length-m[1].length; work=work.slice(0,at)+new Array(len+1).join('\u0001')+work.slice(at+len); a.re.lastIndex=at+len; } });
    hits.sort(function(x,y){ return x.at-y.at; });
    X.typeHits=hits;
    if(!hits.length) return null;
    var h=hits[0], parts=h.a.to.split('.');
    /* a later family term after "with / may / na may" is a feature of the first (e.g. a hub "with" a card-reader slot) */
    hits.slice(1).forEach(function(o){ if(o.a.to==='card_reader') X.ports.push({ kind:'sd', op:'has', raw:o.a.term }); });
    var T={ id:h.a.to, family:parts[0], subtype:parts[1]||null, via:'lexicon', term:h.a.term, strict:h.a.strict, fallback:h.a.fallback, confidence:'high' };
    trace.push('type:'+h.a.term+'→'+h.a.to+(T.strict?' (strict)':''));
    return T;
  }

  /* ---------- plan-builder helpers ---------- */
  function pickAttr(X,c){
    var hits=allHits(c.attrs,X.t).filter(function(h){ return !(h.x.k==='dp' && X.dpConn); });
    if(X.dpConn) hits=hits.filter(function(h){ return h.x.k!=='dp'; });
    if(hits.some(function(h){ return h.x.k==='dp_volume'; })) hits=hits.filter(function(h){ return h.x.k!=='dp'; });   /* "dp vol" is one field, not DP + DP Vol */
    hits.sort(function(a,b){ var r={ sku:1, price:2 }; return (r[a.x.k]||0)-(r[b.x.k]||0) || a.at-b.at; });
    return hits.map(function(h){ return h.x.k; });
  }
  function rankFrom(G,X,attrs){
    var d=null;
    if(G.rankMin) d={ by:'price', dir:'asc' }; else if(G.rankMax) d={ by:'price', dir:'desc' };
    else if(G.rankLongest) d={ by:'lengthM', dir:'desc' }; else if(G.rankShortest) d={ by:'lengthM', dir:'asc' };
    else if(G.rankPower) d={ by:'watts', dir:'desc' }; else if(G.rankCapacity) d={ by:'mah', dir:'desc' };
    var lw=X.t.match(/\b(lowest|highest|cheapest)\s+(dp\s?vol(?:ume)?|dpv|dp|srp)\b/);
    if(lw){ d={ by:'price', dir:lw[1]==='highest'?'desc':'asc' }; }
    if(!d && /\b(?:biggest|largest|highest)\s+capacity\b/.test(X.t)) d={ by:'mah', dir:'desc' };
    return d;
  }
  function priceFieldOf(X,attrs){ if(/\b(dp\s?vol(?:ume)?|dpv|volume price)\b/.test(X.t)) return 'dp_volume'; if(!X.dpConn && /\bdp\b|\bdealer price\b/.test(X.t)) return 'dp'; return 'srp'; }
  function metricOf(X,c,G){
    var m=firstHit(c.metrics,X.t), k=m?m.x.k:null;
    var comp=(G.comparative||[]).concat(G.rankMin||[],G.rankMax||[]).join(' ');
    if(!k){ if(/mura|mahal|cheaper|expensive/.test(comp)) k='srp'; else if(/maraming|more/.test(comp) && /\bports?\b/.test(X.t)) k='ports'; }
    if(!k) return null;
    var dir=/mura|cheaper|mababa|lower|maikli|shorter|less/.test(comp+' '+X.t.slice(0,0))?'min':'max';
    if(k==='srp' && /mahal|expensive/.test(comp)) dir='max';
    return { attr:k, dir:dir };
  }

  /* ======================= p2r3a: small talk ======================= */
  var ST_ORDER=['nameWhy','identity','help','howAreYou','thanks','bye','greeting'];
  function smalltalkOf(X,c){
    var t=' '+X.norm.replace(/[^a-z0-9'’ ]+/g,' ').replace(/\s+/g,' ').trim()+' ', kinds={}, work=t, first=null;
    c.small.forEach(function(x){ x.re.lastIndex=0; var m=x.re.exec(work); if(!m) return;
      if(first===null || m.index<first.at) first={ k:x.k, at:m.index };
      kinds[x.k]=1; work=work.replace(x.re,' '); });
    var left=work.trim().split(/\s+/).filter(function(w){ return w && !c.smallFill[w]; });
    var ks=ST_ORDER.filter(function(k){ return kinds[k]; });
    if(!ks.length) return null;
    return { kind:ks[0], kinds:ks, whole:!left.length, greetingFirst:!!(first && first.k==='greeting' && first.at<=1) };
  }
  /* ======================= p2r3a: follow-up / topic switch ======================= */
  var FU_KNOWN=('same but pero mas yung ung the one a an what how about with only instead naman ba ano is it na ng ang sa e eh and then tapos ok okay sige '+
    'kung paano if bout po lang din rin nga please pls also too more less higher lower cheaper mura murang mahal for of in').split(' ');
  /* a token the user wrote like a product NAME (Capitalised mid-sentence, CamelCase, letters+digits) that nothing explains */
  function nameLikeUnknown(X,c){ var rawW=String(X.raw||'').split(/[^A-Za-z0-9.-]+/).filter(Boolean);
    return rawW.filter(function(r,ix){ var w=r.toLowerCase(); if(w.length<3 || c.vocab[w] || c.nameGeneric[w] || /^\d+(?:\.\d+)?$/.test(w) || SPEC_TOKEN.test(w)) return false;
      return /[A-Z]/.test(r.slice(1)) || (ix>0 && /^[A-Z]/.test(r)) || (/\d/.test(r)&&/[a-z]/i.test(r)); }).map(function(r){ return r.toLowerCase(); }); }
  function followUpOf(X,c,ctx,G,resolved,subject){
    var lp=ctx&&ctx.lastPlan; if(!lp) return null;
    var t=X.t.replace(/\s+/g,' ').trim();
    if(c.topicRe.test(' '+t+' ')) return { follow:false, why:'topic cue' };
    if(resolved.length) return { follow:false, why:'new anchor' };
    if(G.history||G.coach) return { follow:false, why:'new intent' };
    if(subject.length) return { follow:false, why:'reference' };
    var hit=(X.typeHits||[])[0];
    var newFam=hit?hit.a.to.split('.')[0]:((X.standards.length && (c.L.standards[X.standards[0]]||{}).family)||null);
    if(newFam && lp.type && newFam!==lp.type.family) return { follow:false, why:'new family' };
    if(newFam && !lp.type) return { follow:false, why:'new family' };
    var cue=c.followRe.test(' '+t+' ');
    var noun=/\b(cables?|adapters?|adaptors?|converters?|hubs?|docks?|chargers?|power banks?|splitters?|switch(?:es|er)?|extenders?|enclosures?|readers?)\b/.test(t);
    if((hit || X.standards.length || noun || X.pair) && !cue) return { follow:false, why:'complete question' };
    var known={}; FU_KNOWN.forEach(function(w){ known[w]=1; }); Object.keys(c.smallFill).forEach(function(w){ known[w]=1; });
    (c.L.language.filler||[]).concat(c.L.language.comparative||[],c.L.language.rankMin||[],c.L.language.rankMax||[],c.L.language.reference||[]).forEach(function(p){ p.split(' ').forEach(function(w){ known[w]=1; }); });
    Object.keys(c.L.colors).forEach(function(k){ c.L.colors[k].forEach(function(w){ known[w]=1; }); });
    Object.keys(c.L.attributes||{}).forEach(function(k){ c.L.attributes[k].forEach(function(p){ p.split(' ').forEach(function(w){ known[w]=1; }); }); });
    Object.keys(c.L.connectors).forEach(function(k){ c.L.connectors[k].forEach(function(p){ p.split(' ').forEach(function(w){ known[w]=1; }); }); });
    ['gan','pd','magsafe','qi2','built-in','built','retractable','cable','charger','wireless','fast','black','white','second','first','third','una','pangalawa','pangatlo','ikalawa','hdmi','usb-c','usb-a','lightning','meters','meter','metro','long','capacity','wattage','price','budget','under','below','above','at','least','up','to','pataas','pababa','hanggang','or','and','₱'].forEach(function(w){ known[w]=1; });
    if(hit) hit.a.term.split(' ').forEach(function(w){ known[w]=1; });
    var toks=t.split(' ').filter(Boolean), unknown=toks.filter(function(w){ return !known[w] && !/\d/.test(w) && w.length>1; });
    var slots=!!(X.filters.length||X.match.length||X.connectors.length||X.ports.length||X.standards.length||hit||X.bareNumber||G.comparative||G.rankMin||G.rankMax||
      /\b(cheaper|mura|mas mura|second|first|third|una|pangalawa|pangatlo)\b/.test(t)||pickAttrWords(X,c).length||subject.length);
    var short=toks.length<=7 && unknown.length<=1;
    /* fix-pack 2 #1D: a product-like word we cannot resolve (Capitalised / CamelCase / letters+digits in the raw text) is a NEW product,
       never a follow-up on the old results ("e yung <NewName> magkano?") */
    var rawW=String(X.raw||'').split(/[^A-Za-z0-9.-]+/).filter(Boolean), likeName=unknown.filter(function(w){ return rawW.some(function(r,ix){ return r.toLowerCase()===w && (/[A-Z]/.test(r.slice(1)) || (ix>0 && /^[A-Z]/.test(r)) || (/\d/.test(r)&&/[a-z]/i.test(r))); }); });
    if(likeName.length) return { follow:false, why:'unknown name', name:likeName.join(' ') };
    if((cue||short) && slots) return { follow:true, cue:cue, unknown:unknown };
    return { follow:false, why:'not a follow-up' };
  }
  function pickAttrWords(X,c){ return allHits(c.attrs,X.t).map(function(h){ return h.x.k; }).filter(function(k){ return !(k==='dp' && X.dpConn); }); }
  function clone(o){ return o==null?o:JSON.parse(JSON.stringify(o)); }
  function mergeFollowUp(plan,lp,X,trace){
    var inh=[];
    if(!plan.type && lp.type){ plan.type=clone(lp.type); plan.type.via='context'; inh.push('type'); }
    else if(plan.type && lp.type && plan.type.family===lp.type.family && !plan.type.subtype && lp.type.subtype){ plan.type=clone(lp.type); plan.type.via='context'; inh.push('type'); }
    if(!plan.form && lp.form && !(plan.type && plan.type.via==='lexicon')){ plan.form=lp.form; inh.push('form'); }
    if(!plan.connectors.length && !plan.pair && lp.connectors && lp.connectors.length){ plan.connectors=lp.connectors.slice(); plan.pair=clone(lp.pair); inh.push('connectors'); }
    (lp.filters||[]).forEach(function(f){ if(!plan.filters.some(function(g){ return g.attr===f.attr; })){ plan.filters.push(clone(f)); inh.push(f.attr); } });
    (lp.match||[]).forEach(function(m){ var same=plan.match.some(function(n){ return n.k===m.k && (m.k!=='flag' || n.v===m.v); });
      if(!same){ plan.match.push(clone(m)); inh.push(m.k==='flag'?('flag:'+m.v):m.k); } });
    (lp.ports||[]).forEach(function(p){ if(!plan.ports.some(function(q){ return q.kind===p.kind; })){ plan.ports.push(clone(p)); inh.push('port:'+p.kind); } });
    if(!plan.standards.length && lp.standards && lp.standards.length){ plan.standards=lp.standards.slice(); inh.push('standard'); }
    if(!plan.formStrict && lp.formStrict) plan.formStrict=lp.formStrict;
    if(!plan.useCase && lp.useCase){ plan.useCase=clone(lp.useCase); inh.push('useCase'); }
    plan.inherited=inh; trace.push('follow-up: inherited '+(inh.join(',')||'nothing'));
    return inh;
  }

  /* ======================= 4. plan builder ======================= */
  function build(query,opts){
    opts=opts||{}; var t0=Date.now();
    var c=compile(), trace=[], products=(opts.products||[]).filter(function(p){ return p && !p.disabled; });
    var FA=FACTS(), idx=opts.facts||FA.build(products,{ version:opts.version });
    var ai=anchorIndex(products,idx.key), ctx=opts.ctx||null, lp=ctx&&ctx.lastPlan;
    var X=extract(query,c,trace,{ capHint:!!(lp && lp.type && lp.type.family==='power_bank') }), G=X.G;
    var plan={ v:1, engine:VERSION, q:X.raw, norm:X.norm, intent:null, anchors:[], refs:[], type:null, form:null, connectors:[], pair:X.pair,
      filters:[], match:X.match, ports:X.ports, standards:X.standards.slice(), attribute:null, sort:null, limit:null, metric:null, history:null, priceField:'srp', useCase:null,
      flags:{ stock:!!X.inventory, invQty:!!X.invQty, judgement:!!G.judgement, coach:!!G.coach, compat:!!G.compat, external:X.external, devices:X.devices, explicitAlt:!!G.alternative },
      followUp:false, topicSwitch:null, inherited:[], echo:null, greeting:false, smalltalk:null, lang:langOf(X,c),
      ambiguity:[], unsupported:X.unsupported.slice(), route:null, result:null, subject:[], confidence:'low', trace:trace, ms:0 };
    if(!X.norm){ plan.intent='help'; plan.result={ executor:'none', codes:[], mentioned:[], related:[], unknown:0, evidence:{}, notes:[], caveats:[] }; plan.route={ route:ROUTES.CLARIFY, rule:'R0 empty', candidates:[] }; return finish(plan,t0); }

    /* ---- small talk: answered locally only when the whole message is small talk ---- */
    var st=smalltalkOf(X,c);
    if(st && st.whole){
      plan.intent='smalltalk'; plan.smalltalk=st.kind; plan.confidence='high';
      plan.result={ executor:'none', codes:[], mentioned:[], related:[], unknown:0, evidence:{}, notes:[], caveats:[] };
      plan.route={ route:ROUTES.LOCAL, rule:'R0 small talk', candidates:[] }; return finish(plan,t0);
    }
    if(st && st.greetingFirst) plan.greeting=true;

    /* ---- anchors + context references ---- */
    plan.anchors=findAnchors(' '+X.t+' ',ai,trace);
    /* fix-pack 2 #1: product-name anchors. With a product TYPE in the question the name is a filter inside that type;
       without one, a narrow name (<= 8 SKUs) is an anchor like a SKU/model, a broad one ("hitune") is a filter. */
    var tNm=X.t; X.devices.named.forEach(function(d){ tNm=tNm.replace(new RegExp('(^|[^a-z0-9])'+esc(d.label)+'(?=$|[^a-z0-9])','g'),'$1 '); });   /* a named device ("macbook air m4") is never a product name */
    var NI=nameIndex(products,idx.key), names=findNames(tNm,c,NI,trace), typeWord=!!resolveType({ t:X.t, ports:[] },c,[]) || X.connectors.length>0 || /\b(cables?|adapters?|adaptors?|converters?|hubs?|docks?|chargers?|splitters?|switch(?:es|er)?|extenders?|enclosures?|readers?)\b/.test(X.t);
    names=names.filter(function(n){ return !plan.anchors.some(function(a){ return a.codes.length && n.codes.every(function(x){ return a.codes.indexOf(x)>=0; }); }); });
    names.forEach(function(n){
      var words=n.text.split(' ');
      plan.anchors=plan.anchors.filter(function(a){ return a.codes.length || words.indexOf(a.raw)<0 && n.text.replace(/ /g,'').indexOf(a.raw.replace(/ /g,''))<0; });
      if(X.bareNumber!=null && words.indexOf(String(X.bareNumber))>=0){ X.bareNumber=null; }
      if(!typeWord && n.codes.length<=8 && !plan.anchors.some(function(a){ return a.codes.length; })) plan.anchors.push({ raw:n.text, via:'name', codes:n.codes.slice() });
      else { var core=words.filter(function(w){ return nameWord(w,c,NI); }).join(' ')||n.text, withQ=new RegExp('\\b(?:with|may|na may)\\s+(?:\\S+\\s+)?'+esc(core.split(' ')[0])+'\\b').test(X.t);
        X.match.push({ k:'namephrase', v:n.text, codes:n.codes.slice(), label:(withQ?'for ':'')+core, withLabel:withQ }); }
    });
    plan.names=names.map(function(n){ return { text:n.text, n:n.codes.length }; });
    var resolved=plan.anchors.filter(function(a){ return a.codes.length; });
    /* references are matched as exact words (no Tagalog -ng suffix: "yung" is an article, not "yun") */
    var refWords=(c.L.language.reference||[]).filter(function(w){ return w!=='yung' && w!=='these' && w!=='those' && w!=='them' && w!=='that' && new RegExp('(^|[^a-z0-9])'+esc(w)+'(?![a-z0-9])').test(X.t); });
    var ordinal=X.t.match(/\b(first one|yung una|una|pangalawa|second one|second|ikalawa|third one|pangatlo|third)\b/);
    var allRef=!resolved.length && /\b(alin|which one|which)\b/.test(X.t) && (G.comparative || G.judgement);
    if(!resolved.length){
      if(ordinal) plan.refs.push({ kind:'ordinal', index:/first|una/.test(ordinal[1])?0:(/third|pangatlo/.test(ordinal[1])?2:1) });
      else if(allRef) plan.refs.push({ kind:'all' });
      else if(refWords.length) plan.refs.push({ kind:'pronoun', word:refWords[0] });
    }
    plan.refs.forEach(function(r){
      if(!ctx){ r.codes=[]; return; }
      if(r.kind==='ordinal') r.codes=ctx.results&&ctx.results[r.index]?[ctx.results[r.index]]:[];
      else if(r.kind==='all') r.codes=(ctx.comparison&&ctx.comparison.length>=2)?ctx.comparison.slice():((ctx.results&&ctx.results.length>=2&&ctx.results.length<=4)?ctx.results.slice():[]);
      else r.codes=(ctx.focus&&ctx.focus.length)?ctx.focus.slice():((ctx.results&&ctx.results.length===1)?ctx.results.slice():[]);
      r.codes=r.codes.filter(function(x){ return !!idx.byCode[x] && !idx.byCode[x].disabled; });
      if(r.codes.length) trace.push('context:'+r.kind+'→'+r.codes.join(','));
    });
    var refCodes=[]; plan.refs.forEach(function(r){ (r.codes||[]).forEach(function(x){ refCodes.push(x); }); });
    var subject=uniq([].concat.apply([],resolved.map(function(a){ return a.codes; })).concat(refCodes));

    /* ---- type ---- */
    plan.type=resolveType(X,c,trace);
    /* fix-pack 2 #2: a phone holder "sa kotse / pang kotse / for car" is a car mount (holder context only) */
    if(plan.type && plan.type.family==='holder' && plan.type.subtype!=='car_mount' && plan.type.subtype!=='laptop_stand' && /\bcar\b/.test(X.t)){ plan.type=Object.assign({},plan.type,{ id:'holder.car_mount', subtype:'car_mount', term:'car holder' }); trace.push('holder + car → car mount'); }
    if(plan.type && plan.type.family==='charger' && !plan.type.subtype && /\bcar\b/.test(X.t)){ plan.type=Object.assign({},plan.type,{ id:'charger.car', subtype:'car', term:'car charger' }); trace.push('charger + car → car charger'); }
    if(!plan.type && plan.standards.length){ var sf=(c.L.standards[plan.standards[0]]||{}).family; if(sf){ plan.type={ id:sf, family:sf, subtype:null, via:'standard', term:plan.standards[0]+' cable', confidence:'high' }; trace.push('type:'+plan.standards[0]+'→'+sf); if(/\bcables?\b/.test(X.t)) plan.formStrict='cable'; } }
    if(!plan.type && subject.length){ var fams=uniq(subject.map(function(x){ var f=idx.byCode[x]; return f?f.type.family:null; }).filter(Boolean)); if(fams.length===1) plan.type={ id:fams[0], family:fams[0], subtype:null, via:resolved.length?'anchor':'context', confidence:'high' }; }
    if(!plan.type || plan.type.family==='video_cable'){ ['cable','adapter','extender','splitter','switch','enclosure'].some(function(k){ if(new RegExp('\\b'+(k==='adapter'?'(?:adapter|adaptor|converter)':k)+'s?\\b').test(X.t)){ plan.form=k; return true; } return false; }); }
    var UC=c.L.useCases||{};
    if(X.useCases.length) plan.useCase={ id:X.useCases[0], families:(UC[X.useCases[0]]||{}).families||[], minVideoOut:(UC[X.useCases[0]]||{}).minVideoOut||null };
    else if(X.devices.classes.length>=2 && !X.devices.named.length) plan.useCase={ id:'multi_device', families:(UC.multi_device||{}).families||[] };
    else if(X.useCaseRaw){ plan.unsupported.push({ attr:'useCase', value:X.useCaseRaw, note:'unknown use case — no family mapping' }); trace.push('useCase:'+X.useCaseRaw+' (unknown)'); }
    if(plan.type){ X.match=X.match.filter(function(m){ if(m.k!=='namephrase' || plan.deviceNamed) return true; var hit=m.codes.some(function(x){ var F=idx.byCode[x]; return F && inType(F,{ family:plan.type.family }); }); if(!hit) trace.push('name "'+m.v+'" not in '+plan.type.family+' names → ignored'); return hit; }); plan.match=X.match; }
    if(plan.type||plan.form){ Object.keys(c.L.nameQualifiers||{}).forEach(function(w){ if(new RegExp('\\b'+w+'\\b').test(X.t) && !(w==='magnetic' && X.match.some(function(m){ return m.v==='magsafe'; }))) X.match.push({ k:'nameword', v:w, soft:!!c.L.nameQualifiers[w].soft, label:w }); }); plan.match=X.match; }
    if(plan.useCase && plan.useCase.minVideoOut && !X.filters.some(function(f){ return f.attr==='videoOut'; })) X.filters.push({ attr:'videoOut', op:'ge', value:plan.useCase.minVideoOut, raw:'use case' });

    var portFam={ hub_dock:1, av_switch:1, usb_switch:1, network_switch:1 };
    var typeAt=(X.typeHits&&X.typeHits[0])?X.typeHits[0].at:-1;
    X.connectors.forEach(function(k){
      if(plan.type && portFam[plan.type.family] && typeAt>=0 && k.at>typeAt) plan.ports.push({ kind:k.k==='tf'?'sd':k.k, op:'has', raw:k.k });
      else if(plan.connectors.indexOf(k.k)<0) plan.connectors.push(k.k);
    });
    if(plan.type && plan.type.family==='lan_cable') plan.connectors=plan.connectors.filter(function(k){ return k!=='rj45'; });
    plan.ports=dedupePorts(plan.ports);
    plan.filters=X.filters.slice();
    plan.priceField=priceFieldOf(X);
    plan.filters.forEach(function(f){ if(f.attr==='price') f.field=plan.priceField; });

    /* ---- p2r3a: follow-up (plan mutation) vs topic switch ---- */
    var fu=followUpOf(X,c,ctx,G,resolved,subject);
    if(fu){ if(fu.follow){ plan.followUp=true; mergeFollowUp(plan,lp,X,trace); } else if(lp){ plan.topicSwitch=fu.why; trace.push('topic switch: '+fu.why); } }

    /* ---- intent (ordered rules; the anchor never consumes the intent) ---- */
    var attrs=pickAttr(X,c), rank=rankFrom(G,X,attrs), metric=metricOf(X,c,G);
    var hasType=!!(plan.type||plan.form||plan.useCase), hasSpec=!!(plan.filters.length||plan.match.length||plan.connectors.length||plan.ports.length||plan.standards.length);
    var specificDevice=X.devices.named.length>0;
    var histWords=!!G.history || (/\b(price|presyo)\b/.test(X.t) && c.hist.up.concat(c.hist.down).some(function(re){ re.lastIndex=0; return re.test(X.t); }));
    var cheaperWord=/\b(cheaper|mas mura|mas murang|mura pa|lower price)\b/.test(X.t) || (G.comparative||[]).some(function(w){ return /mura|cheaper/.test(w); });
    var sameBut=/\b(same|pareho|parehong|ganun din|ganyan din)\b/.test(X.t);
    var specAttr=attrs.filter(function(a){ return a!=='sku' && a!=='price' && a!=='srp' && a!=='dp' && a!=='dp_volume' && a!=='moq' && a!=='description' && a!=='colors'; });
    var I=null;
    if(G.coach) I='coach';
    else if(histWords && !G.compat) I='price_history';
    else if(G.alternative || (cheaperWord && subject.length && resolved.length===1 && !plan.refs.length && !G.compare && !G.judgement)) I='alternative';
    else if(G.compat || X.external) I='compat';
    else if(G.judgement || (X.devices.classes.length>=2 && !hasSpec)) I='recommend';
    else if((resolved.length>=2 || refCodes.length>=2) && (G.compare||G.comparative||metric)) I='compare';
    else if(subject.length>=2 && resolved.length===1 && G.compare) I='compare';
    else if(plan.refs.some(function(r){ return r.kind==='all'; }) && (G.comparative||metric)) I='compare';
    else if(subject.length && attrs.filter(function(a){ return a!=='sku'; }).length) I='attribute';
    else if(!subject.length && attrs.indexOf('sku')>=0 && (hasType||hasSpec)) I='attribute';
    else if(!subject.length && specAttr.length && (hasType||hasSpec)) I='attribute';
    else if(rank && !subject.length) I='rank';
    else if(G.count) I='count';
    else if(G.existence || /^\s*(?:(?:hi|hello|hey|good (?:morning|afternoon|evening))[\s,!.]*)?(?:may|meron|mayroon)\b/.test(X.t) || G.stock) I='exist';
    else if(G.compare && subject.length<2) I='compare';
    else if(subject.length && !X.filters.length && !X.match.length && !X.ports.length && !X.standards.length) I='lookup';
    else if(hasType||hasSpec) I='list';
    else if(subject.length) I='lookup';
    else I='clarify';
    if(I==='list' && !plan.type && !plan.form && plan.useCase && !subject.length) I='recommend';
    if(specificDevice && !subject.length && (I==='list'||I==='exist'||I==='recommend')){ I='compat'; trace.push('named device → device-fit question'); }

    /* ---- p2r3a: follow-up intent rules ---- */
    if(plan.followUp){
      var focus=(ctx.focus||[]).filter(function(x){ return !!idx.byCode[x]; }), last=(ctx.results||[]).filter(function(x){ return !!idx.byCode[x]; });
      var nonSkuAttr=attrs.filter(function(a){ return a!=='sku'; });
      if(cheaperWord && (ctx.comparison||[]).length>=2 && ctx.lastPlan.intent==='compare'){
        subject=ctx.comparison.filter(function(x){ return !!idx.byCode[x]; }); I='compare'; metric={ attr:'srp', dir:'min' }; plan.refs.push({ kind:'all', codes:subject.slice() });
      } else if(nonSkuAttr.length && !subject.length){
        subject=focus.length?focus.slice():last.slice(0,12); I='attribute'; plan.attrFromContext=focus.length?'focus':'results';
        trace.push('follow-up attribute → '+plan.attrFromContext);
      } else if((cheaperWord || (sameBut && hasSpec)) && !subject.length && focus.length && !plan.refs.length && (ctx.lastPlan.intent==='lookup'||ctx.lastPlan.intent==='attribute'||ctx.lastPlan.intent==='alternative'||ctx.lastPlan.intent==='compat'||ctx.lastPlan.intent==='recommend')){
        subject=[focus[0]]; I='alternative'; plan.subjectVia='focus';
      } else if(cheaperWord && !subject.length && !plan.refs.some(function(r){ return r.kind==='all'; })){
        I='rank'; rank={ by:'price', dir:'asc' }; plan.cheaperList=true; plan.limit=null;
      } else if(X.bareNumber && !X.filters.length){
        plan.ambiguity.push({ slot:'number', reason:'number with no unit', value:X.bareNumber });
      } else if((I==='list'||I==='clarify') && ctx.lastPlan.intent==='attribute' && ctx.lastPlan.attribute && ATTR_VAL[ctx.lastPlan.attribute] && !ctx.lastPlan.subjectBased && !subject.length){
        I='attribute'; specAttr=[ctx.lastPlan.attribute]; trace.push('follow-up keeps attribute '+ctx.lastPlan.attribute);
      } else if((I==='list'||I==='clarify'||I==='exist') && ['list','exist','count','rank'].indexOf(ctx.lastPlan.intent)>=0 && !subject.length){
        I=ctx.lastPlan.intent==='exist'?'exist':ctx.lastPlan.intent;
        if(I==='rank' && !rank && ctx.lastPlan.sort){ plan.sort=clone(ctx.lastPlan.sort); plan.limit=ctx.lastPlan.limit; }
      }
    } else if(X.bareNumber && !hasType && !hasSpec && !subject.length && I==='clarify'){
      plan.ambiguity.push({ slot:'number', reason:'number with no unit', value:X.bareNumber });
    }
    /* fix-pack 2 #6: a named product + a named device + a fit/compatibility verb is a compatibility question (never a plain card) */
    if(subject.length && X.devices.named.length && I!=='compare' && I!=='price_history' && I!=='coach' && /\b(pwede|puwede|compatible|compat|gagana|work|works|kaya|support|supports|fit|fits|bagay)\b/.test(X.t)){ I='compat'; trace.push('named product + named device → compat'); }
    /* fix-pack 2 #1/#2: "<device-line> tracker / finder": products NAMED for that device line are a catalogue fact → name filter, stays LOCAL */
    var existQ=!!G.existence || /^\s*(?:(?:hi|hello)[\s,!.]*)?(?:may|meron|mayroon)\b/.test(X.t);
    if(I==='compat' && existQ && !subject.length && plan.type && !G.compat && !X.external && X.devices.named.length){   /* existence questions only ("may <device> <product> kayo?"); a "<device> <product type>" search stays a compat question */
      var NW=((c.L.devices||{}).nameWords)||{}, words=[]; X.devices.named.forEach(function(d){ d.label.split(' ').forEach(function(w){ (NW[w]||[]).forEach(function(x){ if(words.indexOf(x)<0) words.push(x); }); }); });
      var dcodes=words.length?products.filter(function(p){ var F=idx.byCode[String(p.item_code)]; return F && inType(F,plan.type) && words.some(function(w){ return new RegExp('\\b'+esc(w)+'\\b').test(F.units[0].text); }); }).map(function(p){ return String(p.item_code); }):[];
      if(dcodes.length){ plan.match.push({ k:'namephrase', v:words[0], codes:dcodes, label:'for '+X.devices.named[0].label }); plan.deviceNamed=true; I='exist'; trace.push('device line named in products → name filter'); }
    }
    /* fix-pack 2 #3: a qualifier next to the product type that is neither parsed nor found in product names is reported, never dropped */
    if((plan.type||plan.form) && !subject.length && ((X.typeHits && X.typeHits.length) || plan.form) && ['list','exist','rank','count'].indexOf(I)>=0){
      var tt=(X.typeHits && X.typeHits.length)?X.typeHits[0].a.term:plan.form, tre=new RegExp('(^|\\s)'+esc(tt)+'s?(?=\\s|$)'), tm=tre.exec(' '+X.t+' '), qual=[];
      if(tm){ var pre=(' '+X.t+' ').slice(0,tm.index).trim().split(/\s+/).slice(-2), post=(' '+X.t+' ').slice(tm.index+tm[0].length).trim().split(/\s+/);
        var postQ=[]; if(/^(?:with|may|na|w\/)$/.test(post[0]||'')){ postQ=post.slice(1,3); if(postQ[0]==='may'||postQ[0]==='with') postQ=postQ.slice(1); }
        pre.concat(postQ).forEach(function(w){ w=String(w||'').replace(/[^a-z0-9-]/g,''); if(!w || w.length<3 || /\d/.test(w)) return;
          var inName=function(x){ return plan.match.some(function(m){ return m.k==='namephrase' && m.v.split(' ').indexOf(x)>=0; }); };
          var known=function(x){ var y=x.replace(/(?:ng|g)$/,''); return !x || x.length<3 || c.vocab[x] || c.nameGeneric[x] || inName(x) || (y!==x && (c.vocab[y] || c.vocab[x.replace(/ng$/,'n')])); };   /* Tagalog -ng / -g ligature: kayong → kayo, ibang → iba */ if(known(w) || w.split('-').every(known) || w.split('-').some(function(x){ return x.length>=3 && inName(x); })) return; if(qual.indexOf(w)<0) qual.push(w); }); }
      if(qual.length){ plan.unconfirmed=qual; trace.push('qualifier not confirmed: '+qual.join(',')); }
    }
    /* p2r3a fix 1: an inventory question is never answered with a SKU count ("ilan pa natitira" ≠ number of SKUs) */
    if(plan.flags.stock && I==='count'){ I=subject.length?'lookup':'exist'; trace.push('inventory: count → listed'); }
    /* p2r3a fix 5 + P0 guard 1: existence or count with no product noun we know — name the noun in a zero result, or clarify
       when there is none. A count never falls through to a catalogue-empty "0 —": a field / measure asked with no product
       ("ilang ports") clarifies, and a generic catalogue noun ("how many products") gets the listed total (not on a stock question). */
    if((I==='exist'||I==='count') && !subject.length && !plan.type && !plan.form && !plan.useCase && !hasSpec && !plan.anchors.length){
      var nn=nounOf(X,c);
      var nnW=nn?nn.split(' '):[], catW=nnW.some(function(w){ return CATALOG_NOUN.indexOf(w)>=0; });
      if(nn && catW && nnW.length===1 && !plan.flags.stock){ plan.catalogTotal=products.length; trace.push('generic catalogue noun → listed total'); }
      else if((I==='count' && specAttr.length) || (nn && fieldOnly(nn,c))) plan.ambiguity.push({ slot:'type', reason:'field / measure with no product' });
      /* the per-noun negative is only honest when no published product NAME or CATEGORY carries the noun; a qualified catalogue
         noun ("products for macbook") is not a product type either — both clarify instead of a false "Wala tayong …" */
      else if(nn && !catW && nnW.length<=3 && !inCatalogue(nnW,products)){ plan.unknownNoun=nn; trace.push('unknown noun: '+nn); }
      else plan.ambiguity.push({ slot:'type', reason:(I==='count'?'count':'existence')+' question with no product noun' });
    }
    /* p2r3a fix 2: "with cable" on a power bank / charger without built-in or retractable = unclear hard constraint → clarify */
    if(plan.type && (plan.type.family==='power_bank'||plan.type.family==='charger') && !plan.pair && !subject.length &&
       /\b(?:with|may|meron|w\/)\s+(?:[a-z0-9-]+\s+)?(?:cables?|kable)\b/.test(X.t) && !plan.match.some(function(m){ return m.k==='flag' && (m.v==='builtin'||m.v==='retractable'); }))
      plan.ambiguity.push({ slot:'cable', reason:'cable wording without built-in / retractable' });
    plan.intent=I;
    if(I==='attribute'){ plan.attribute=(subject.length?attrs.filter(function(a){ return a!=='sku'; })[0]:(specAttr[0]||'sku'))||attrs[0]; plan.attributes=uniq(attrs.filter(function(a){ return a!=='sku'; })); }
    if(I==='rank' && !plan.sort && rank){ plan.sort=[{ by:rank.by==='price'?plan.priceField:rank.by, dir:rank.dir }]; if(!plan.cheaperList) plan.limit=X.topN||1; }
    if(I==='compare' || I==='alternative') plan.metric=metric;
    if(I==='alternative'){
      var keep=(/same wattage|parehong wattage/.test(X.t)?['watts']:[]).concat(/same capacity|parehong capacity/.test(X.t)?['mah']:[]).concat(/same length|parehong haba/.test(X.t)?['lengthM']:[]);
      var direction=(cheaperWord||/\b(price|presyo|mahal|budget)\b/.test(X.t))?'cheaper':'similar';
      plan.alternative={ direction:direction, keep:keep, base:subject[0]||null,
        executable:!!subject.length && (direction==='cheaper' || keep.length>0 || plan.filters.length>0 || plan.match.length>0) };
    }
    if(I==='price_history') plan.history=histPlan(X,c,G);
    if(I==='coach') plan.coach={ want:(G.coach||[])[0]||null };

    /* ---- execute locally (facts only) ---- */
    plan.result=execute(plan,products,idx,subject,X,c);
    if(!plan.type && plan.result && plan.result.codes.length){ var rf=uniq(plan.result.codes.map(function(x){ return idx.byCode[x]?idx.byCode[x].type.family:null; })); if(rf.length===1) plan.type={ id:rf[0], family:rf[0], subtype:null, via:'result', confidence:'medium' }; }
    plan.subject=subject;

    /* ---- ambiguity ---- */
    if(plan.refs.length && !refCodes.length && !resolved.length && !hasType && !hasSpec && !plan.followUp) plan.ambiguity.push({ slot:'target', reason:'reference with no conversation context' });
    if(I==='compare' && subject.length<2) plan.ambiguity.push({ slot:'target', reason:'compare needs two products' });
    if(I==='recommend' && !hasType && !subject.length) plan.ambiguity.push({ slot:'type', reason:'no product type, anchor or context' });
    if(I==='list' && !plan.type && plan.form && !plan.connectors.length && !plan.filters.length && !plan.match.length && !plan.pair && !plan.standards.length) plan.ambiguity.push({ slot:'type', reason:'form only ('+plan.form+') — which connector / product?' });
    if(I==='rank' && !hasType && !hasSpec && !plan.followUp) plan.ambiguity.push({ slot:'type', reason:'superlative with no product type' });
    if(I==='lookup' && plan.refs.length && !subject.length) plan.ambiguity.push({ slot:'target', reason:'reference not in the last results' });
    if(I==='attribute' && plan.attrFromContext && !subject.length) plan.ambiguity.push({ slot:'target', reason:'no product in context' });
    if(plan.anchors.some(function(a){ return !a.codes.length; }) && !resolved.length) plan.ambiguity.push({ slot:'anchor', reason:'code/model not in the pricelist' });
    var nlu=(fu && fu.why==='unknown name')?fu.name:nameLikeUnknown(X,c).filter(function(w){ return !(plan.names||[]).some(function(n){ return n.text.split(' ').indexOf(w)>=0; }) && !plan.anchors.some(function(a){ return a.codes.length && a.raw===w; }); }).join(' ');
    if(nlu && !resolved.length && !plan.type && !plan.form && !hasSpec && I!=='smalltalk' && I!=='price_history'){ plan.ambiguity=plan.ambiguity.filter(function(a){ return a.slot!=='number' && a.slot!=='anchor'; }); plan.ambiguity.unshift({ slot:'name', reason:'product name not found', value:nlu }); }
    var seenAmb={}; plan.ambiguity=plan.ambiguity.filter(function(a){ var k=a.slot+'|'+a.reason; if(seenAmb[k]) return false; seenAmb[k]=1; return true; });

    plan.echo=echoOf(plan,ctx,idx,c);
    plan.route=route(plan,X,idx,subject,refCodes);
    plan.confidence=(resolved.length||(plan.type&&plan.type.via==='lexicon'))&&!plan.ambiguity.length?'high':((plan.type||subject.length)?'medium':'low');
    return finish(plan,t0);
  }
  /* context transparency: one short line naming what was carried over */
  function fmtNum(n){ return String(n).replace(/\B(?=(\d{3})+(?!\d))/g,','); }
  function filterLabel(f){
    var op=f.op==='ge'?'≥':(f.op==='le'?'≤':(f.op==='gt'?'>':''));
    if(f.attr==='watts') return op+f.value+'W';
    if(f.attr==='mah') return op+fmtNum(f.value)+'mAh';
    if(f.attr==='lengthM') return f.op==='between'?(f.value[0]+'–'+f.value[1]+'m'):(op+f.value+'m');
    if(f.attr==='price') return f.op==='between'?('₱'+fmtNum(f.value[0])+'–₱'+fmtNum(f.value[1])):((f.op==='le'||f.op==='lt'?'under ':'over ')+'₱'+fmtNum(f.value));
    if(f.attr==='ports') return op+f.value+' ports';
    if(f.attr==='videoOut') return op+f.value+' displays';
    return f.attr+' '+op+f.value;
  }
  function matchLabel(m,L){ if(m.k==='flag') return ((L.flags[m.v]||{}).label)||m.v; if(m.k==='color') return m.v; return m.label||m.k; }
  var CONN_LABEL=new Proxy({ usb_c:'USB-C', usb_a:'USB-A', lightning:'Lightning', hdmi:'HDMI', dp:'DisplayPort', vga:'VGA', dvi:'DVI', rj45:'LAN', micro_usb:'Micro USB', aux35:'3.5mm', thunderbolt:'Thunderbolt', usb4:'USB4' },
    { get:function(o,k){ if(typeof k!=='string') return undefined; var L=LEX()&&LEX().connectorLabels; return (L&&L[k])||o[k]||k.replace(/_/g,' ').replace(/\b\w/g,function(x){ return x.toUpperCase(); }); } });   /* fix-pack 2 #5: never a raw key / undefined */
  function typeLabel(T,L){
    if(!T) return null; if(T.term) return T.term;
    var f=L.taxonomy.families.filter(function(x){ return x.id===T.family; })[0]; if(!f) return T.family;
    if(T.subtype){ var s=(f.subtypes||[]).filter(function(x){ return x.id===T.subtype; })[0]; if(s) return s.label; }
    return f.label;
  }
  function niceCase(t){ return String(t||'').replace(/\b(hdmi|usb|lan|nas|dp|vga|dvi|gan|pd|sd|tf)\b/g,function(w){ return w.toUpperCase(); }).replace(/\busb-c\b/gi,'USB-C').replace(/\busb-a\b/gi,'USB-A'); }
  function slotLabels(plan,L){
    var out=[], tl=null;
    if(plan.type){ tl=niceCase(typeLabel(plan.type,L)); out.push(tl); } else if(plan.form) out.push(plan.form);
    plan.standards.forEach(function(s){ out.push(s.replace(/^cat/,'Cat')); });
    if(plan.pair) out.push((CONN_LABEL[plan.pair.from]||plan.pair.from)+' to '+(CONN_LABEL[plan.pair.to]||plan.pair.to));
    else plan.connectors.forEach(function(k){ var lab=CONN_LABEL[k]||k; if(tl && tl.toLowerCase().indexOf(lab.toLowerCase())>=0) return; out.push(lab); });
    plan.filters.filter(function(f){ return f.attr!=='price'; }).concat(plan.filters.filter(function(f){ return f.attr==='price'; })).forEach(function(f){ out.push(filterLabel(f)); });
    plan.match.forEach(function(m){ out.push(matchLabel(m,L)); });
    plan.ports.forEach(function(p){ out.push((p.op==='ge'?p.value+'+ ':'')+(CONN_LABEL[p.kind]||p.kind)+' port'); });
    return out.filter(Boolean);
  }
  function echoOf(plan,ctx,idx,c){
    var r=plan.refs.filter(function(x){ return x.codes&&x.codes.length; })[0];
    if(!r && plan.followUp && plan.inherited.length && plan.intent!=='attribute' && plan.intent!=='alternative') return slotLabels(plan,c.L).join(' · ');
    if(r){ if(r.kind==='all') return 'your comparison ('+r.codes.join(' vs ')+')'; if(r.kind==='ordinal') return 'result #'+(r.index+1)+' — SKU '+r.codes[0]; return 'SKU '+r.codes.join(', '); }
    if(plan.subjectVia==='focus' || plan.attrFromContext==='focus') return 'SKU '+plan.subject.join(', ');
    if(plan.attrFromContext==='results') return 'your last results';
    return null;
  }
  function langOf(X,c){
    var toks=String(X.raw||X.norm).toLowerCase().replace(/[^a-z'’ ]+/g,' ').split(/\s+/).filter(Boolean), M={}; (c.L.taglishMarkers||[]).forEach(function(w){ M[w]=1; });
    var n=toks.filter(function(w){ return M[w]; }).length;
    var strong=toks.some(function(w){ return /^(ba|po|meron|mayroon|alin|natin|naman|wala|magkano|ilan|ilang|ano|anong|yung|pang|paano|bakit|salamat|kailangan|gusto|kayo|tayo|natitira)$/.test(w); });
    return (strong || n>=2)?'tl':'en';
  }
  /* the leftover noun of an existence question ("may <thing> kayo?" → thing); null when nothing product-like is left */
  var EXTRA_STOP=('i me my mine we us our you your he she it its they them their this that these those what which who whom whose when where why how is am are was were be been being do does did doing have has had having '+
    'can could will would shall should may might must need needs want wants please pls thanks a an the and or but if then so of at by for with about into from in on off out over under up down again also too very just only '+
    'ko mo niya namin natin nila ako ikaw siya kami tayo kayo sila ito iyan iyon dito diyan doon dun yun yan sana kasi pero tapos lang din rin naman nga po ho ba pa na ng ang mga si ni sa kay para pang pag kung '+
    'customer client clients customers buyer gusto kailangan need hanap hanapin meron wala bili bibili benta order quote '+
    'hdd ssd sata drive disk external internal monitor monitors screen office home school small large big users user people persons '+
    'lahat all any some every each other others iba ibang good nice best better okay ok legit genuine authentic sample stocks item items unit units piece').split(' ');
  var NOUN_STOP=('may meron mayroon ba kayo tayo ka po ng na sa pa rin din nga lang naman ho kami ako you we do does have has any there is are a an the us our your natin namin ninyo inyo '+
    'ganito ganyan yung ung ang mga si ni right now currently pricelist ugreen stock stocks available on hand inventory still sold out remaining natitira natira ubos ilan pa').split(' ');
  /* P0 guard 2: closed-class words only (prepositions / conjunctions, count words and quantifiers, Tagalog pronoun spellings) —
     never product vocabulary — so "in stock ba?" leaves no product noun ("Walang in …"). Stock words are already in NOUN_STOP. */
  var FUNC_STOP=('in on at of for to with from by into about and or but how many much number kahit ilang total lahat all ano nyo niyo kayong').split(' ');
  /* generic catalogue nouns: "how many products / items / SKUs" asks for the listed total, not for a product type */
  var CATALOG_NOUN=['product','products','item','items','sku','skus'];
  /* a leftover made only of the lexicon's field / measure words (metrics + attributes: "ports", "capacity", "speed") is not a product */
  function fieldOnly(nn,c){ var F={}; [c.L.metrics||{},c.L.attributes||{}].forEach(function(o){ Object.keys(o).forEach(function(k){ (o[k]||[]).forEach(function(t){ String(t).split(' ').forEach(function(w){ F[w]=1; }); }); }); });
    return nn.split(' ').every(function(w){ return F[w]; }); }
  /* any leftover word (singular or plural) appearing as a whole word in a published product name or category */
  function inCatalogue(words,products){
    /* the word as typed plus its -s / -es stems ("cases" → case); a line name glued to a model number (letters + digits) counts */
    var res=words.filter(function(w){ return w.length>=2; }).map(function(w){ var st=[w]; if(w.length>3 && /s$/.test(w)) st.push(w.slice(0,-1)); if(w.length>4 && /es$/.test(w)) st.push(w.slice(0,-2));
      return new RegExp('(^|[^a-z0-9])(?:'+st.map(esc).join('|')+')(?:s|es)?(?![a-z'+(w.length>=3?'':'0-9')+'])','i'); });
    return res.length>0 && products.some(function(p){ var t=String(p.product_name||'')+' '+String(p.category||''); return res.some(function(re){ return re.test(t); }); }); }
  function nounOf(X,c){ var stop={}; NOUN_STOP.concat(FUNC_STOP).forEach(function(w){ stop[w]=1; }); Object.keys(c.smallFill).forEach(function(w){ stop[w]=1; });
    var w=X.t.replace(/[^a-z0-9 -]+/g,' ').split(/\s+/).filter(function(x){ return x && !stop[x] && x.length>1 && !/^\d+$/.test(x); });
    return w.length?w.join(' '):null; }
  function finish(plan,t0){ plan.ms=Date.now()-t0; return plan; }
  function dedupePorts(ps){ var s={}, o=[]; ps.forEach(function(p){ var k=p.kind+'|'+p.op+'|'+(p.value||''); if(!s[k]){ s[k]=1; o.push(p); } }); return o; }
  function histPlan(X,c,G){
    var up=c.hist.up.some(function(re){ re.lastIndex=0; return re.test(X.t); }), dn=c.hist.down.some(function(re){ re.lastIndex=0; return re.test(X.t); });
    var H={ dir:up&&!dn?'up':(dn&&!up?'down':null), kind:null, field:/\bdp\s?vol|\bdpv\b/.test(X.t)?'vol':(/\bdp\b|dealer price/.test(X.t)?'dp':'srp'), period:null, n:X.topN||null, metric:/%|percent|porsyento/.test(X.t)?'pct':'peso' };
    var MON=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'], m;
    if(/\b(this month|ngayong buwan|current month)\b/.test(X.t)) H.period={ k:'thisMonth' };
    else if(/\b(last month|previous month|nakaraang buwan)\b/.test(X.t)) H.period={ k:'lastMonth' };
    else if(/\b(this year|ngayong taon)\b/.test(X.t)) H.period={ k:'thisYear' };
    else if((m=X.t.match(/\b(?:since|from|after)\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/))) H.period={ k:'since', m:MON.indexOf(m[1]) };
    if(/\b(previous|old|dating|before)\b/.test(X.t)) H.kind='previous';
    else if(/\b(category|categories|section|sections)\b/.test(X.t)) H.kind='aggregate';
    else if(H.n || G.rankCapacity || /\b(biggest|largest|highest|most|pinakamalaki|pinakamataas)/.test(X.t)) H.kind='rank';
    else if(G.count) H.kind='count';
    else if(G.existence || /^\s*(may|meron|mayroon)\b/.test(X.t) || /\b\w+\s+ba\b/.test(X.t)) H.kind='exist';
    else if(/\b(magkano|how much)\b/.test(X.t)) H.kind='amount';
    else H.kind='list';
    return H;
  }

  /* ======================= 5. executor (shadow): one evidence rule for every path ======================= */
  var TIER={ strong:3, medium:2, weak:1 };
  function cmp(v,op,x){ if(v==null) return null; var e=1e-9;
    if(op==='eq') return Math.abs(v-x)<=1e-3; if(op==='ge') return v>=x-e; if(op==='gt') return v>x+e; if(op==='le') return v<=x+e; if(op==='lt') return v<x-e;
    if(op==='between') return v>=x[0]-e && v<=x[1]+e; return null; }
  function attrTier(a){ if(!a||!a.evidence||!a.evidence.length) return null; return a.tier||a.evidence[0].tier; }
  function numCheck(F,f,p){
    if(f.attr==='price'){ var v=Number(p[f.field||'srp']); if(!(v>0)) return { ok:false, unknown:true }; return { ok:cmp(v,f.op,f.value), tier:'strong' }; }
    if(f.attr==='ports'){ var pv=F.attrs.ports.value; if(!pv||pv.total==null) return { ok:false, unknown:true }; return { ok:cmp(pv.total,f.op,f.value), tier:F.attrs.ports.evidence[0].tier }; }
    if(f.attr==='videoOut'){ var bv=F.attrs.ports.value; if(!bv||!bv.byKind) return { ok:false, unknown:true }; var n=(bv.byKind.hdmi||0)+(bv.byKind.dp||0)+(bv.byKind.vga||0); return { ok:cmp(n,f.op,f.value), tier:'medium' }; }
    var A=F.attrs[f.attr]; if(!A) return { ok:false, unknown:true };
    if(A.value==null){ if(A.mentioned!=null && cmp(A.mentioned,f.op,f.value)) return { ok:true, tier:'weak' }; return { ok:false, unknown:true }; }
    return { ok:cmp(A.value,f.op,f.value), tier:attrTier(A)||'strong', ev:(A.evidence[0]||{}).text };
  }
  function portCheck(F,pp){
    var bk=F.attrs.ports.value&&F.attrs.ports.value.byKind, named=F.attrs.connectors.named, any=F.attrs.connectors.value;
    var kinds=pp.kind==='sd'?['sd','tf']:(pp.kind==='usb_a'?['usb_a','usb']:[pp.kind]);
    var cnt=bk?kinds.reduce(function(a,k){ return a+(bk[k]||0); },0):0;
    if(pp.op==='ge'){ if(!bk) return { ok:false, unknown:true }; return { ok:cnt>=pp.value, tier:'medium' }; }
    if(cnt>0) return { ok:true, tier:'strong' };
    if(kinds.some(function(k){ return named.indexOf(k)>=0; })) return { ok:true, tier:'strong' };
    if(kinds.some(function(k){ return any.indexOf(k)>=0; })) return { ok:true, tier:'medium' };
    return { ok:false };
  }
  function pairOk(F,pair){
    var n=F.units[0].text, L=LEX().connectors;   /* UGREEN names state the pair in either direction ("Lightning To Type-C") */
    function pos(k,from){ var best=-1; (L[k]||[]).forEach(function(w){ var re=new RegExp('(^|[^a-z0-9])'+esc(FNORM(w))+'(?=$|[^a-z0-9])','g'), m; while((m=re.exec(n))){ var i=m.index+m[1].length; if(i>=from && (best<0||i<best)) best=i; } }); return best; }
    if(pair.from!==pair.to) return pos(pair.from,0)>=0 && pos(pair.to,0)>=0 && / to /.test(n);
    var a=pos(pair.from,0); if(a<0) return false; var to=n.indexOf(' to ',a); return to>=0 && pos(pair.to,to)>=0;
  }
  /* drive size in the product NAME: true = this size, false = another size, null = no size stated (excluded from confirmed matches) */
  function sizeOk(p,v){ var n=' '+String(p&&p.product_name||'')+' ', x=+v, re=/[^\d.](\d{1,2}(?:\.\d{1,2})?)\s*(?:-\s*)?(?:inch(?:es)?\b|in\b|''|"|“|”|″|'|’’)(?:\s*[-–~]\s*(\d{1,2}(?:\.\d{1,2})?)\s*(?:inch(?:es)?\b|in\b|''|"|“|”|″|'|’’)?)?/gi, m, seen=false;
    while((m=re.exec(n))){ seen=true; var a1=+m[1], b1=m[2]!=null?+m[2]:null; if(b1!=null ? (x>=a1-1e-6 && x<=b1+1e-6) : Math.abs(a1-x)<0.051) return true; } return seen?false:null; }
  function FNORM(w){ return NLU()?NLU().normText(w):String(w).toLowerCase(); }
  function inType(F,T){
    if(!T) return true;
    if(F.type.family!==T.family) return false;
    if(T.subtype && F.type.subtype!==T.subtype) return false;
    return true;
  }
  function formOk(F,form){
    var t=F.type;
    if(form==='cable') return !!t.forms.cable && !/\bcar charger\b/.test(F.units[0].text);
    if(form==='adapter') return (!!t.forms.adapter || /adapter|converter|expansion card/i.test(F.category)) && t.family!=='hub_dock';   /* expansion cards are sold as "M.2 / PCIe adapters" */
    return !!t.forms[form];
  }
  /* car item = car subtype, or "car" in the product name / section (same test as the p2r3a pre-filter it replaces) */
  function carItem(p,idx){ if(!p) return false; var F=idx.byCode[String(p.item_code)];
    return !!(F && F.type.subtype==='car') || /\bcar\b/i.test(String(p.product_name||'')) || /\bcar\b/i.test(String(p.sheet_display||'')); }
  function execute(plan,products,idx,subject,X,c){
    var R={ executor:null, codes:[], mentioned:[], related:[], unknown:0, evidence:{}, notes:[], caveats:[] };
    if(plan.flags.stock) R.caveats.push('stock');
    if(plan.flags.devices.classes.length||plan.flags.devices.named.length) R.caveats.push('compat');
    var byCode={}; products.forEach(function(p){ byCode[String(p.item_code)]=p; });
    var I=plan.intent;
    if(I==='price_history') return histExec(plan,products,idx,subject,R);
    var anyProduct=subject.length||plan.type||plan.form||plan.useCase||plan.filters.length||plan.match.length||plan.connectors.length||plan.ports.length;
    if(I==='coach'||I==='help'||I==='clarify'||!anyProduct){ R.executor='none'; R.codes=subject.slice(); return R; }
    if(I==='alternative'){
      if(plan.alternative && plan.alternative.executable) return sameButExec(plan,products,idx,subject,X,c,R,byCode);
      R.executor='pending(p2r3b)'; R.codes=subject.slice(); R.notes.push('alternatives scorer is p2r3b'); return R; }
    if(I==='attribute' && plan.attribute==='colors' && subject.length){
      var mdl=uniq(subject.map(function(x){ return idx.byCode[x]?idx.byCode[x].model.toLowerCase():''; }).filter(Boolean));
      R.executor='variants'; R.codes=products.filter(function(p){ return mdl.indexOf(String(p.model||'').toLowerCase().trim())>=0; }).map(function(p){ return String(p.item_code); }); return R; }
    if(I==='compare'){ R.executor='compare'; R.codes=subject.slice(0,4); if(plan.metric) R.verdict=verdict(plan.metric,R.codes,idx,byCode,plan.priceField); return R; }

    /* subject (anchor / context) questions: the subject IS the set, narrowed by any spec named with it */
    var pool, fromSubject=subject.length>0, carRule=false;
    if(fromSubject) pool=subject.map(function(x){ return byCode[x]; }).filter(Boolean);
    else {
      var T=plan.type, fams=plan.useCase&&!T?plan.useCase.families:null;
      pool=products.filter(function(p){ var F=idx.byCode[String(p.item_code)]; if(!F) return false;
        if(T && !inType(F,T)) return false;
        if(fams && fams.length && fams.indexOf(F.type.family)<0) return false;
        if(plan.form && !(T && T.family!=='video_cable') && !formOk(F,plan.form)) return false;
        if(plan.formStrict && !formOk(F,plan.formStrict)) return false;
        return true; });
      if(T && T.subtype && T.fallback && !pool.length){ var T2={ family:T.family }; pool=products.filter(function(p){ var F=idx.byCode[String(p.item_code)]; return F && inType(F,T2); }); R.notes.push('subtype fallback to family'); }
      /* car items only when "car" is asked (engine rule), unless they are the only MATCHES (p2r3a.3: decided after matching,
         as in p2r2.1 — a pre-match pool filter hid car-only wattages / features). The soft-qualifier and facet reruns keep
         the non-car pool (conservative: a secondary rerun never surfaces car-only results). */
      if(!/\bcar\b/.test(X.t)){ var nc=pool.filter(function(p){ return !carItem(p,idx); }); if(nc.length){ if(plan._softRun||plan._facetRun) pool=nc; else carRule=true; } }
    }
    var conf=[], weak=[], unk=[];
    pool.forEach(function(p){
      var code=String(p.item_code), F=idx.byCode[code]; if(!F) return;
      var worst=3, ev=[], unknown=false, fail=false;
      function take(r){ if(!r||!r.ok){ if(r&&r.unknown) unknown=true; fail=true; return; } worst=Math.min(worst,TIER[r.tier]||3); if(r.ev && r.tier==='medium') ev.push(r.ev); }
      if(!fromSubject){
        /* a connector named in the question must be in the product NAME (p2r2.1 rule, now on every path): a USB-C power port
           in the features does not make a USB-A hub a "USB-C hub". Port inventories use plan.ports instead. */
        plan.connectors.forEach(function(k){ if(fail) return; take(F.attrs.connectors.named.indexOf(k)>=0?{ ok:true, tier:'strong' }:{ ok:false }); });
        if(!fail && plan.pair) take({ ok:pairOk(F,plan.pair), tier:'strong' });
      }
      plan.filters.forEach(function(f){ if(!fail) take(numCheck(F,f,p)); });
      plan.ports.forEach(function(pp){ if(!fail) take(portCheck(F,pp)); });
      plan.match.forEach(function(a){ if(fail) return;
        if(a.k==='nameword') return take(new RegExp('\\b'+a.v).test(F.units[0].text)?{ ok:true, tier:'strong' }:{ ok:false });
        if(a.k==='namephrase') return take(a.codes.indexOf(code)>=0?{ ok:true, tier:'strong' }:{ ok:false });
        if(a.k==='size'){ var sz=sizeOk(p,a.v); if(sz===null) unknown=true; return take(sz?{ ok:true, tier:'strong' }:{ ok:false, unknown:sz===null }); }
        var m=FACTS().match(F,a); if(!m) return take({ ok:false }); take({ ok:true, tier:m.t, ev:m.ev }); });
      (plan.standards||[]).forEach(function(sd){ if(!fail) take(standardCheck(F,sd,c)); });
      if(fail){ if(unknown) unk.push(code); return; }
      if(worst===1) weak.push(code); else { conf.push({ code:code, tier:worst===3?'strong':'medium' }); if(ev.length) R.evidence[code]=ev[0]; }
    });
    /* p2r3a.3 post-match car rule: any non-car match → non-car only (identical to the old pre-filter); only car matches →
       keep them (R.carOnly, compose names them); no match → as before. Unknown counts follow the same set. */
    if(carRule){
      var isCar=function(code){ return carItem(byCode[code],idx); }, notCar=function(code){ return !isCar(code); };
      var ncConf=conf.filter(function(x){ return notCar(x.code); }), ncWeak=weak.filter(notCar);
      if(ncConf.length || ncWeak.length || (!conf.length && !weak.length)){ conf=ncConf; weak=ncWeak; unk=unk.filter(notCar); }
      else { R.carOnly=true; unk=unk.filter(isCar); }
      pool=pool.filter(function(p){ return !carItem(p,idx); });   /* secondary lists (MagSafe related) keep the non-car pool */
    }
    R.unknown+=unk.length;
    /* MagSafe asked: magnetic-wireless names are listed separately as related, never confirmed */
    if(plan.match.some(function(a){ return a.k==='flag' && a.v==='magsafe'; })){
      var inC={}; conf.forEach(function(x){ inC[x.code]=1; });
      R.related=pool.filter(function(p){ var F=idx.byCode[String(p.item_code)]; return F && !inC[String(p.item_code)] && F.attrs.flags.magnetic_wireless; }).map(function(p){ return String(p.item_code); });
      if(R.related.length) R.notes.push('magnetic wireless — MagSafe not explicitly confirmed');
    }
    conf.sort(function(a,b){ return TIER[b.tier]-TIER[a.tier]; });
    R.codes=conf.map(function(x){ return x.code; }); R.mentioned=weak; R.medium=conf.filter(function(x){ return x.tier==='medium'; }).length;
    if(fromSubject && !R.codes.length && !plan.filters.length && !plan.match.length) R.codes=subject.slice();
    R.executor=fromSubject?'subject':'filter';
    /* soft name qualifier ("travel charger") with no match: drop it, say so, keep the rest */
    if(!fromSubject && !R.codes.length && !R.mentioned.length && !plan._softRun && plan.match.some(function(m){ return m.soft; })){
      var sp={}; for(var k0 in plan) sp[k0]=plan[k0]; sp.match=plan.match.filter(function(m){ return !m.soft; }); sp._softRun=true;
      var dropped=plan.match.filter(function(m){ return m.soft; }).map(function(m){ return m.v; });
      var sr=execute(sp,products,idx,subject,X,c); if(sr.codes.length){ sr.droppedQualifiers=dropped; return sr; }
    }
    /* laptop use (ordering hint only, architecture §10): power products >= 45W first */
    if(!fromSubject && plan.flags.devices.classes.indexOf('laptop')>=0 && plan.type && (plan.type.family==='charger'||plan.type.family==='power_bank') && !plan.sort){
      var lw=function(x){ var a=idx.byCode[x].attrs.watts.value||0; return (a>=45?1000:0)+a; };
      R.codes=R.codes.slice().sort(function(a,b){ return lw(b)-lw(a) || (a<b?-1:1); }); R.ordered='laptop';
    }
    /* zero results: the values that DO exist for the faceted spec under every other constraint (not nearest-match scoring) */
    if(!fromSubject && !R.codes.length && !R.mentioned.length && !plan._facetRun){
      var fa=plan.filters.filter(function(f){ return f.attr==='watts'||f.attr==='mah'||f.attr==='lengthM'; })[0];
      if(fa){ var rp={}; for(var k in plan) rp[k]=plan[k]; rp.filters=plan.filters.filter(function(f){ return f!==fa; }); rp.intent='list'; rp._facetRun=true; rp.sort=null;
        var fr=execute(rp,products,idx,[],X,c); R.facet={ attr:fa.attr, codes:fr.codes.slice() }; }
    }
    if(plan.intent==='attribute' && plan.attribute && ATTR_VAL[plan.attribute]){
      R.values={}; R.codes.forEach(function(code){ var v=ATTR_VAL[plan.attribute](idx.byCode[code],byCode[code]); if(v) R.values[code]=v; });
      R.executor=fromSubject?'subject-attribute':'filter-attribute';
    }
    if(plan.intent==='rank' && plan.sort){
      var S=plan.sort[0], vals={}, keep=[];
      R.codes.forEach(function(code){ var v=rankVal(S.by,idx.byCode[code],byCode[code]); if(v==null) R.unknown++; else { vals[code]=v; keep.push(code); } });
      keep.sort(function(a,b){ return (S.dir==='asc'?vals[a]-vals[b]:vals[b]-vals[a]) || (a<b?-1:a>b?1:0); });
      R.codes=keep; R.top=plan.limit?keep.slice(0,plan.limit):keep.slice(); R.executor='rank';
    }
    return R;
  }
  /* ---------- p2r3a helpers: standards, attribute values, "same but …" ---------- */
  function standardCheck(F,sd,c){
    var terms=((c.L.standards||{})[sd]||{}).terms||[]; if(!terms.length) return { ok:false };
    var re=new RegExp('(^|[^a-z0-9])(?:'+terms.map(esc).join('|')+')(?![a-z0-9])');
    if(re.test(F.units[0].text)) return { ok:true, tier:'strong' };
    /* the product name states a different standard (e.g. a Cat8 cable whose features say "backward compatible with Cat6A"): the name decides */
    if(/(^|[^a-z0-9])cat\s?(5e|6a|6|7|8)(?![a-z0-9])/.test(F.units[0].text)) return { ok:false };
    for(var i=1;i<F.units.length-1;i++) if(re.test(F.units[i].text)) return { ok:true, tier:'medium', ev:F.units[i].text };
    return { ok:false };
  }
  function speedOf(F){
    var best=null;
    for(var i=0;i<F.units.length-1;i++){ var u=F.units[i], m, re=/(\d+(?:\.\d+)?)\s?(gbps|mbps)\b/g;
      while((m=re.exec(u.text))){ var v=+m[1]*(m[2]==='gbps'?1000:1);
        var pref=/speed|transfer|rate|data/.test(u.text)?1:0;
        if(!best || pref>best.pref || (pref===best.pref && v>best.mbps)) best={ mbps:v, label:m[1]+(m[2]==='gbps'?'Gbps':'Mbps'), tier:u.tier, src:i===0?'name':'features', text:u.text, pref:pref }; } }
    return best?{ value:best.label, tier:best.tier, src:best.src, text:best.text }:null;
  }
  var ATTR_VAL={
    speed:function(F){ return speedOf(F); },
    nasBays:function(F){ return F.attrs.nas&&F.attrs.nas.bays!=null?{ value:F.attrs.nas.bays+' bays', tier:'medium', src:'features', text:F.attrs.nas.evidence[0].text }:null; },
    nasCpu:function(F){ return F.attrs.nas&&F.attrs.nas.cpu?{ value:F.attrs.nas.cpu, tier:'medium', src:'features' }:null; },
    nasRam:function(F){ return F.attrs.nas&&F.attrs.nas.ram?{ value:F.attrs.nas.ram, tier:'medium', src:'features' }:null; }
  };
  function keyVal(k,F){
    if(k==='ports'){ var pv=F.attrs.ports.value; return pv&&pv.total!=null?pv.total:null; }
    if(k==='nasBays') return F.attrs.nas&&F.attrs.nas.bays!=null?F.attrs.nas.bays:null;
    var A=F.attrs[k]; return A&&A.value!=null&&typeof A.value==='number'?A.value:null;
  }
  function sameButExec(plan,products,idx,subject,X,c,R,byCode){
    var base=subject[0], B=idx.byCode[base], bp=byCode[base]; R.executor='same-but'; R.base=base;
    if(!B||!bp){ R.codes=[]; return R; }
    var pf=plan.priceField||'srp', bprice=Number(bp[pf])||0;
    var keys=uniq((plan.alternative.keep||[]).concat(((c.L.keySpecs||{})[B.type.family])||[]));
    var keep=[]; keys.forEach(function(k){ var v=keyVal(k,B); if(v!=null) keep.push({ k:k, v:v }); });
    R.keep=keep; R.keepUnknown=keys.filter(function(k){ return keyVal(k,B)==null; });
    var cableFam=/cable/.test(B.type.family), bconn=B.attrs.connectors.named.slice().sort().join('|'), out=[];
    products.forEach(function(p){
      var code=String(p.item_code); if(code===base) return; var F=idx.byCode[code]; if(!F || F.disabled) return;
      if(F.type.family!==B.type.family) return; if(B.type.subtype && F.type.subtype!==B.type.subtype) return;
      if(cableFam && F.attrs.connectors.named.slice().sort().join('|')!==bconn) return;
      for(var i=0;i<keep.length;i++){ var v=keyVal(keep[i].k,F); if(v==null){ R.unknown++; return; } if(Math.abs(v-keep[i].v)>1e-6) return; }
      var worst=3, ev=null, ok=true;
      plan.filters.forEach(function(f){ if(!ok) return; var r=numCheck(F,f,p); if(!r||!r.ok){ ok=false; return; } worst=Math.min(worst,TIER[r.tier]||3); });
      plan.match.forEach(function(a){ if(!ok) return; if(a.k==='namephrase'){ if(a.codes.indexOf(code)<0) ok=false; return; } if(a.k==='size'){ if(!sizeOk(p,a.v)) ok=false; return; } var m=FACTS().match(F,a); if(!m){ ok=false; return; } worst=Math.min(worst,TIER[m.t]); if(m.ev&&!ev) ev=m.ev; });
      plan.ports.forEach(function(pp){ if(!ok) return; var r=portCheck(F,pp); if(!r.ok){ ok=false; return; } worst=Math.min(worst,TIER[r.tier]||3); });
      if(!ok || worst===1) return;
      var price=Number(p[pf]); if(!(price>0)) return;
      if(plan.alternative.direction==='cheaper' && !(bprice>0 && price<bprice)) return;
      out.push({ code:code, price:price }); if(ev) R.evidence[code]=ev;
    });
    out.sort(function(a,b){ return plan.alternative.direction==='cheaper' ? (a.price-b.price || (a.code<b.code?-1:1)) : (Math.abs(a.price-bprice)-Math.abs(b.price-bprice) || (a.code<b.code?-1:1)); });
    R.codes=out.map(function(o){ return o.code; });
    return R;
  }
  function rankVal(by,F,p){
    if(by==='srp'||by==='dp'||by==='dp_volume'){ var v=Number(p[by]); return v>0?v:null; }
    if(by==='ports'){ var pv=F.attrs.ports.value; return pv&&pv.total!=null?pv.total:null; }
    if(by==='nasBays') return F.attrs.nas&&F.attrs.nas.bays!=null?F.attrs.nas.bays:null;
    var A=F.attrs[by]; return A&&A.value!=null&&A.value>0?A.value:null;
  }
  function verdict(metric,codes,idx,byCode,pf){
    var by=metric.attr==='srp'?pf:metric.attr, vals={};
    codes.forEach(function(x){ if(idx.byCode[x]) vals[x]=rankVal(by,idx.byCode[x],byCode[x]); });
    var known=codes.filter(function(x){ return vals[x]!=null; });
    if(known.length<2) return { metric:by, values:vals, winner:null, note:'value not listed for '+codes.filter(function(x){ return vals[x]==null; }).join(', ') };
    known.sort(function(a,b){ return metric.dir==='min'?vals[a]-vals[b]:vals[b]-vals[a]; });
    var tie=vals[known[0]]===vals[known[1]];
    return { metric:by, dir:metric.dir, values:vals, winner:tie?null:known[0], tie:tie };
  }
  function histExec(plan,products,idx,subject,R){
    var NL=NLU(), H=plan.history; R.executor='history';
    if(!NL||!NL.historyRows){ R.notes.push('history rows unavailable'); return R; }
    var today=HOOK.today||NL.todayStr(), field=H.field;
    var rows=NL.historyRows(products,{ today:today, fields:[field] });
    var pr=H.period?NL.periodRange(H.period,today):null;
    rows=rows.filter(function(r){
      if(pr && (r.date<pr.from || r.date>pr.to)) return false;
      if(H.dir==='up' && !(r.delta>0)) return false; if(H.dir==='down' && !(r.delta<0)) return false;
      if(subject.length && subject.indexOf(r.code)<0) return false;
      if(plan.type){ var F=idx.byCode[r.code]; if(!F||!inType(F,plan.type)) return false; }
      return true; });
    rows.sort(function(a,b){ return Math.abs(b.delta)-Math.abs(a.delta); });
    R.codes=uniq(rows.map(function(r){ return r.code; })); R.rows=rows.length;
    if(H.n) R.top=R.codes.slice(0,H.n);
    return R;
  }

  /* ======================= 6. shadow router (deterministic, first match wins) ======================= */
  function route(plan,X,idx,subject,refCodes){
    var I=plan.intent, R=plan.result||{ codes:[] }, out={ route:null, rule:null, candidates:[], purity:null };
    var hasProduct=!!(subject.length||plan.type||plan.form||plan.useCase);
    function cands(){
      var list=subject.slice(), fam=null;
      if(plan.type) fam=[plan.type.family]; else if(subject.length) fam=uniq(subject.map(function(x){ return idx.byCode[x]&&idx.byCode[x].type.family; }).filter(Boolean));
      else if(plan.useCase) fam=plan.useCase.families;
      var pool=(R.codes||[]).filter(function(x){ var F=idx.byCode[x]; return F && (!fam||!fam.length||fam.indexOf(F.type.family)>=0); });
      /* use-case ordering hint only (architecture §10): laptop power needs >= 45W first, then higher wattage */
      if(plan.flags.devices.classes.indexOf('laptop')>=0 && !plan.sort){ var wv=function(x){ var a=idx.byCode[x].attrs.watts.value||0; return (a>=45?1000:0)+a; };
        pool=pool.slice().sort(function(a,b){ return wv(b)-wv(a) || (a<b?-1:1); }); }
      if(!subject.length || list.length<2) pool.forEach(function(x){ if(list.indexOf(x)<0) list.push(x); });
      if(list.length===1 && fam && fam.length){        /* one product (anchor or single result): add same-family items nearest in SRP — the Worker needs >= 2 candidates; the product stays #1 */
        var ap=null, one=list[0], f1=idx.byCode[one]?idx.byCode[one].type.family:fam[0];
        var sib=(idx.families[f1]||[]).filter(function(x){ return x!==one && idx.byCode[x] && !idx.byCode[x].disabled && HOOK.byCode[x]; });
        var srp=function(x){ return Number((HOOK.byCode[x]||{}).srp)||0; }; ap=srp(one);
        out.padded=true;
        var sub1=idx.byCode[one]?idx.byCode[one].type.subtype:null, ss=function(x){ return sub1 && idx.byCode[x].type.subtype===sub1?0:1; };
        sib.sort(function(x,y){ return ss(x)-ss(y) || Math.abs(srp(x)-ap)-Math.abs(srp(y)-ap) || (x<y?-1:1); }); sib.slice(0,7).forEach(function(x){ list.push(x); });
      }
      var perModel={}, final=[];
      /* a compatibility question about named product(s) is about THAT product: pad only to the Worker minimum of 2 */
      var cap=(I==='compat' && subject.length)?Math.max(2,subject.length):8;
      list.forEach(function(x){ if(final.length>=cap) return; var F=idx.byCode[x]; if(!F) return; var m=(F.model||x).toLowerCase(); if((perModel[m]||0)>=2 && subject.indexOf(x)<0) return; perModel[m]=(perModel[m]||0)+1; final.push(x); });
      out.purity=fam&&fam.length?{ families:fam, pure:final.filter(function(x){ return fam.indexOf(idx.byCode[x].type.family)>=0; }).length, of:final.length }:null;
      return final;
    }
    function set(r,rule){ out.route=r; out.rule=rule; return out; }
    if(I==='help') return set(ROUTES.CLARIFY,'R0 empty');
    if(I==='coach') return set(ROUTES.COACH,'R1 coach');
    if(I==='price_history') return set(ROUTES.LOCAL,'R2 history');
    var specific=plan.flags.devices.named.length>0 && !plan.deviceNamed;   /* products NAMED for the device line = catalogue fact */
    if(I==='compat' || (specific && !subject.length && (I==='recommend'||I==='list'||I==='exist'||I==='lookup'))){
      if(!hasProduct) return set(ROUTES.CLARIFY,'R3 compat without product');
      out.candidates=cands();
      if(out.candidates.length>=2) return set(ROUTES.WEB,'R3 compat/device/external → WEB');
      if(subject.length) return set(ROUTES.LOCAL,'R3 compat, single product (no second candidate) → local card + caveat');
      return set(ROUTES.CLARIFY,'R3 compat, no candidate');
    }
    if(plan.ambiguity.some(function(a){ return a.slot==='target'||a.slot==='type'||a.slot==='number'||a.slot==='cable'||a.slot==='name'; }) && I!=='recommend') return set(ROUTES.CLARIFY,'R4 ambiguity');
    if(['lookup','exist','count','list','rank','compare','attribute','alternative'].indexOf(I)>=0){
      if(I==='lookup' && !subject.length) return set(ROUTES.CLARIFY,'R4 unresolved anchor');
      return set(ROUTES.LOCAL,'R5 local intent');
    }
    if(I==='recommend'){
      if(!hasProduct) return set(ROUTES.CLARIFY,'R6b judgement without product');
      out.candidates=cands();
      if(out.candidates.length>=2) return set(ROUTES.AI,'R6a judgement + candidates');
      return set(ROUTES.CLARIFY,'R6b fewer than 2 candidates');
    }
    return set(ROUTES.CLARIFY,'R7 nothing identified');
  }

  /* ======================= public API ======================= */
  function buildWith(query,opts,byCode){
    var o=Object.assign({},opts);
    HOOK.byCode=byCode; HOOK.today=opts.today||null;
    try{ return build(query,o); } finally { HOOK.byCode=null; HOOK.today=null; }
  }

  /* next-turn conversation context: item codes + a pruned plan only (no prices, no text) */
  /* next-turn conversation context: item codes + the user's own constraints (pruned plan). Never catalog prices, AI text or user text. */
  function nextContext(plan,prev){
    prev=prev||{};
    if(plan.intent==='smalltalk' || plan.intent==='help') return prev;          /* small talk never changes the context */
    var ctx={ turn:(prev.turn||0)+1, focus:[], results:[], comparison:(prev.comparison||[]).slice(), lastPlan:null };
    var subj=plan.subject||[], res=(plan.result&&plan.result.codes)||[];
    if(plan.intent==='compare' && subj.length>=2){ ctx.comparison=subj.slice(0,4); }
    else if(subj.length && plan.intent!=='attribute'){ ctx.focus=subj.slice(0,6); }
    else if(subj.length && plan.attrFromContext!=='results'){ ctx.focus=subj.slice(0,6); }
    else if(res.length===1){ ctx.focus=res.slice(); }
    if(plan.intent==='alternative' && plan.alternative && plan.alternative.executable){ ctx.focus=subj.slice(0,1); ctx.results=res.slice(0,12); }
    else ctx.results=((plan.intent==='rank')?res:((plan.result&&plan.result.top)||res)).slice(0,12);
    if(plan.attrFromContext==='results') ctx.results=subj.slice(0,12);
    if(plan.intent==='price_history' || plan.intent==='coach'){ ctx.focus=subj.slice(0,6); ctx.results=[]; }
    if(plan.topicSwitch && plan.topicSwitch!=='reference' && plan.intent!=='compare') ctx.comparison=[];
    var T=plan.type?{ id:plan.type.id, family:plan.type.family, subtype:plan.type.subtype||null, term:plan.type.term||null, strict:!!plan.type.strict, fallback:!!plan.type.fallback }:null;
    ctx.lastPlan={ intent:plan.intent, attribute:plan.attribute||null, formStrict:plan.formStrict||null, subjectBased:!!(plan.subject&&plan.subject.length), type:T, form:plan.form, connectors:(plan.connectors||[]).slice(), pair:plan.pair?{ from:plan.pair.from, to:plan.pair.to }:null,
      filters:(plan.filters||[]).map(function(f){ return { attr:f.attr, op:f.op, value:f.value, unit:f.unit||null, field:f.field||null }; }),
      match:(plan.match||[]).map(function(m){ return JSON.parse(JSON.stringify(m)); }), ports:(plan.ports||[]).map(function(x){ return { kind:x.kind, op:x.op, value:x.value }; }),
      standards:(plan.standards||[]).slice(), useCase:plan.useCase?JSON.parse(JSON.stringify(plan.useCase)):null, sort:plan.sort?JSON.parse(JSON.stringify(plan.sort)):null, limit:plan.limit };
    return ctx;
  }

  var API={ version:VERSION, routes:ROUTES, build:function(q,opts){ return buildWith(q,opts||{},(function(){ var m={}; ((opts||{}).products||[]).forEach(function(p){ if(p) m[String(p.item_code)]=p; }); return m; })()); },
    nextContext:nextContext, normalize:normalize, _compile:compile };
  if(typeof module!=='undefined' && module.exports) module.exports=API;
  root.VeroPlan=API;
})(typeof window!=='undefined'?window:globalThis);
