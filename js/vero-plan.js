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
  var VERSION='qp1';
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
    s=s.replace(/\bbuild[\s-]?in\b|\bbuilt\s+in\b/g,'built-in').replace(/\bmag\s?safe\b/g,'magsafe').replace(/\bqi\s?2\b/g,'qi2');
    s=s.replace(/\bhdmi\s*(2\.1|2\.0|1\.4)\b/g,'hdmi $1').replace(/\bdisplay\s?port\b/g,'displayport').replace(/\bpower\s?banks?\b/g,function(m){ return /s$/.test(m)?'power banks':'power bank'; });
    s=s.replace(/\b(8k|4k)\s*[x×*]\s*(4k|2k)\b/g,'$1');
    s=s.replace(/[?!]+/g,' ').replace(/,(?!\d)/g,' , ').replace(/\s+/g,' ');
    return s;
  }
  /* "Nk" thousands (engine p2r2.1 rule): in a capacity context a 5k–60k value is mAh unless an explicit price cue is attached */
  var K_PRICE_BEFORE=/(?:₱|budget(?:\s+(?:of|is|ko|ng))?|under|below|less than|lower than|cheaper than|up to|max(?:imum)?|hanggang|wala pang|within|not more than|price|presyo|srp|dp|magkano|worth|cost|costs)\s*$/;
  function expandK(s,trace){
    var capCtx=/power bank|\bmah\b|\bcapacity\b|\bbattery\b/.test(s);
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
    c.displayRe=new RegExp('\\b(\\d|two|three|four|dual|triple|dalawang|dalawa|tatlong)\\s*(?:'+(L.displayWords||['monitor']).map(esc).join('|')+')\\b');
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

  function extract(q,c,trace){
    var raw=String(q==null?'':q), s0=normalize(raw), s=expandK(s0,trace);
    var X={ raw:raw, norm:s.trim(), filters:[], match:[], connectors:[], pair:null, ports:[], unsupported:[], devices:{ classes:[], named:[] } };
    X.G=scanGroups(s,c);
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

  /* ======================= 4. plan builder ======================= */
  function pickAttr(X,c){
    var hits=allHits(c.attrs,X.t).filter(function(h){ return !(h.x.k==='dp' && X.dpConn); });
    if(X.dpConn) hits=hits.filter(function(h){ return h.x.k!=='dp'; });
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

  function build(query,opts){
    opts=opts||{}; var t0=Date.now();
    var c=compile(), trace=[], products=(opts.products||[]).filter(function(p){ return p && !p.disabled; });
    var FA=FACTS(), idx=opts.facts||FA.build(products,{ version:opts.version });
    var ai=anchorIndex(products,idx.key);
    var X=extract(query,c,trace), G=X.G, ctx=opts.ctx||null;
    var plan={ v:1, engine:VERSION, q:X.raw, norm:X.norm, intent:null, anchors:[], refs:[], type:null, form:null, connectors:[], pair:X.pair,
      filters:[], match:X.match, ports:X.ports, attribute:null, sort:null, limit:null, metric:null, history:null, priceField:'srp', useCase:null,
      flags:{ stock:!!G.stock, judgement:!!G.judgement, coach:!!G.coach, compat:!!G.compat, external:X.external, devices:X.devices, explicitAlt:!!G.alternative },
      ambiguity:[], unsupported:X.unsupported.slice(), route:null, result:null, confidence:'low', trace:trace, ms:0 };
    if(!X.norm){ plan.intent='help'; plan.route={ route:ROUTES.CLARIFY, rule:'R0 empty', candidates:[] }; return finish(plan,t0); }

    /* ---- anchors + context references ---- */
    plan.anchors=findAnchors(' '+X.t+' ',ai,trace);
    var resolved=plan.anchors.filter(function(a){ return a.codes.length; });
    var refWords=(c.L.language.reference||[]).filter(function(w){ return w!=='yung' && w!=='these' && w!=='those' && w!=='them' && phraseRe(w).test(X.t); });
    var ordinal=X.t.match(/\b(first one|yung una|una|pangalawa|second one|second|ikalawa|third one|pangatlo)\b/);
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
      if(r.codes.length) trace.push('context:'+r.kind+'→'+r.codes.join(','));
    });
    var refCodes=[]; plan.refs.forEach(function(r){ (r.codes||[]).forEach(function(x){ refCodes.push(x); }); });
    var subject=uniq([].concat.apply([],resolved.map(function(a){ return a.codes; })).concat(refCodes));

    /* ---- type ---- */
    plan.type=resolveType(X,c,trace);
    var FAM=familyIds(c);
    if(!plan.type && subject.length){ var fams=uniq(subject.map(function(x){ var f=idx.byCode[x]; return f?f.type.family:null; }).filter(Boolean)); if(fams.length===1) plan.type={ id:fams[0], family:fams[0], subtype:null, via:resolved.length?'anchor':'context', confidence:'high' }; }
    /* forms (cable / adapter ...) when no family term was named */
    if(!plan.type || plan.type.family==='video_cable'){ ['cable','adapter','extender','splitter','switch','enclosure'].some(function(k){ if(new RegExp('\\b'+(k==='adapter'?'(?:adapter|adaptor|converter)':k)+'s?\\b').test(X.t)){ plan.form=k; return true; } return false; }); }
    /* use cases */
    var UC=c.L.useCases||{};
    if(X.useCases.length) plan.useCase={ id:X.useCases[0], families:(UC[X.useCases[0]]||{}).families||[], minVideoOut:(UC[X.useCases[0]]||{}).minVideoOut||null };
    else if(X.devices.classes.length>=2 && !X.devices.named.length) plan.useCase={ id:'multi_device', families:(UC.multi_device||{}).families||[] };
    else if(X.useCaseRaw){ plan.unsupported.push({ attr:'useCase', value:X.useCaseRaw, note:'unknown use case — no family mapping' }); trace.push('useCase:'+X.useCaseRaw+' (unknown)'); }
    if(plan.useCase && plan.useCase.minVideoOut && !X.filters.some(function(f){ return f.attr==='videoOut'; })) X.filters.push({ attr:'videoOut', op:'ge', value:plan.useCase.minVideoOut, raw:'use case' });

    /* ---- connectors / ports (port families: words after the type are ports it must have) ---- */
    var portFam={ hub_dock:1, av_switch:1, usb_switch:1, network_switch:1 };
    var typeAt=(X.typeHits&&X.typeHits[0])?X.typeHits[0].at:-1;
    X.connectors.forEach(function(k){
      if(plan.type && portFam[plan.type.family] && typeAt>=0 && k.at>typeAt) plan.ports.push({ kind:k.k==='tf'?'sd':k.k, op:'has', raw:k.k });
      else if(plan.connectors.indexOf(k.k)<0) plan.connectors.push(k.k);
    });
    plan.ports=dedupePorts(plan.ports);
    if(plan.connectors.length===1 && plan.connectors[0]==='rj45' && !plan.type && /\blan\b/.test(X.t) && !plan.form){ /* bare "2.5g lan" -> no type word; result family decides */ }
    plan.filters=X.filters.slice();
    plan.priceField=priceFieldOf(X);
    plan.filters.forEach(function(f){ if(f.attr==='price') f.field=plan.priceField; });

    /* ---- intent (ordered rules; the anchor never consumes the intent) ---- */
    var attrs=pickAttr(X,c), rank=rankFrom(G,X,attrs), metric=metricOf(X,c,G);
    var hasType=!!(plan.type||plan.form||plan.useCase), hasSpec=!!(plan.filters.length||plan.match.length||plan.connectors.length||plan.ports.length);
    var specificDevice=X.devices.named.length>0;
    var histWords=!!G.history || (/\b(price|presyo)\b/.test(X.t) && c.hist.up.concat(c.hist.down).some(function(re){ re.lastIndex=0; return re.test(X.t); }));
    var I=null;
    if(G.coach) I='coach';
    else if(histWords && !G.compat) I='price_history';
    else if(G.alternative || ((G.comparative||[]).some(function(w){ return /mura|cheaper|mahal/.test(w); }) && subject.length && resolved.length===1 && !plan.refs.length && !G.compare && !G.judgement)) I='alternative';
    else if(G.compat || X.external) I='compat';
    else if(G.judgement || (X.devices.classes.length>=2 && !hasSpec)) I='recommend';
    else if(subject.length>=2 && (G.compare||G.comparative||metric) ) I='compare';
    else if(plan.refs.some(function(r){ return r.kind==='all'; }) && (G.comparative||metric)) I='compare';
    else if(subject.length && attrs.filter(function(a){ return a!=='sku'; }).length) I='attribute';
    else if(!subject.length && attrs.indexOf('sku')>=0 && (hasType||hasSpec)) I='attribute';
    else if(rank && !subject.length) I='rank';
    else if(G.count) I='count';
    else if(G.existence || /^\s*(?:may|meron|mayroon)\b/.test(X.t) || G.stock) I='exist';
    else if(G.compare && subject.length<2) I='compare';
    else if(hasType||hasSpec) I='list';
    else if(subject.length) I='lookup';
    else I='clarify';
    if(I==='list' && !plan.type && !plan.form && plan.useCase && !subject.length) I='recommend';
    if(specificDevice && !subject.length && (I==='list'||I==='exist'||I==='recommend')){ I='compat'; trace.push('named device → device-fit question'); }
    plan.intent=I;
    if(I==='attribute') plan.attribute=(subject.length?attrs.filter(function(a){ return a!=='sku'; })[0]:'sku')||attrs[0];
    if(I==='rank'){ plan.sort=[{ by:rank.by==='price'?plan.priceField:rank.by, dir:rank.dir }]; plan.limit=X.topN||1; }
    if(I==='compare' || I==='alternative') plan.metric=metric;
    if(I==='alternative'){ plan.alternative={ direction:/mura|cheaper|price|presyo|mahal/.test(X.t)?'cheaper':'similar',
      keep:(/same wattage/.test(X.t)?['watts']:[]).concat(/same capacity/.test(X.t)?['mah']:[]) }; }
    if(I==='price_history') plan.history=histPlan(X,c,G);
    if(I==='coach') plan.coach={ want:(G.coach||[])[0]||null };

    /* ---- execute locally (shadow candidate set; facts only) ---- */
    plan.result=execute(plan,products,idx,subject,X,c);
    if(!plan.type && plan.result && plan.result.codes.length){ var rf=uniq(plan.result.codes.map(function(x){ return idx.byCode[x]?idx.byCode[x].type.family:null; })); if(rf.length===1) plan.type={ id:rf[0], family:rf[0], subtype:null, via:'result', confidence:'medium' }; }
    plan.subject=subject;

    /* ---- ambiguity ---- */
    if(plan.refs.length && !refCodes.length && !resolved.length && !hasType && !hasSpec) plan.ambiguity.push({ slot:'target', reason:'reference with no conversation context' });
    if(I==='compare' && subject.length<2) plan.ambiguity.push({ slot:'target', reason:'compare needs two products' });
    if(I==='recommend' && !hasType && !subject.length) plan.ambiguity.push({ slot:'type', reason:'no product type, anchor or context' });
    if(I==='list' && !plan.type && plan.form && !plan.connectors.length && !plan.filters.length && !plan.match.length && !plan.pair) plan.ambiguity.push({ slot:'type', reason:'form only ('+plan.form+') — which connector / product?' });
    if(I==='rank' && !hasType && !hasSpec) plan.ambiguity.push({ slot:'type', reason:'superlative with no product type' });
    if(plan.anchors.some(function(a){ return !a.codes.length; }) && !resolved.length) plan.ambiguity.push({ slot:'anchor', reason:'code/model not in the pricelist' });
    var seenAmb={}; plan.ambiguity=plan.ambiguity.filter(function(a){ var k=a.slot+'|'+a.reason; if(seenAmb[k]) return false; seenAmb[k]=1; return true; });

    plan.route=route(plan,X,idx,subject,refCodes);
    plan.confidence=(resolved.length||(plan.type&&plan.type.via==='lexicon'))&&!plan.ambiguity.length?'high':((plan.type||subject.length)?'medium':'low');
    return finish(plan,t0);
  }
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
    if(form==='adapter') return (!!t.forms.adapter || /adapter|converter/i.test(F.category)) && t.family!=='hub_dock';
    return !!t.forms[form];
  }
  function execute(plan,products,idx,subject,X,c){
    var R={ executor:null, codes:[], mentioned:[], related:[], unknown:0, evidence:{}, notes:[], caveats:[] };
    if(plan.flags.stock) R.caveats.push('stock');
    if(plan.flags.devices.classes.length||plan.flags.devices.named.length) R.caveats.push('compat');
    var byCode={}; products.forEach(function(p){ byCode[String(p.item_code)]=p; });
    var I=plan.intent;
    if(I==='price_history') return histExec(plan,products,idx,subject,R);
    var anyProduct=subject.length||plan.type||plan.form||plan.useCase||plan.filters.length||plan.match.length||plan.connectors.length||plan.ports.length;
    if(I==='coach'||I==='help'||I==='clarify'||!anyProduct){ R.executor='none'; R.codes=subject.slice(); return R; }
    if(I==='alternative'){ R.executor='pending(p2r3b)'; R.codes=subject.slice(); R.notes.push('alternatives executor not built in this step'); return R; }
    if(I==='attribute' && plan.attribute==='colors' && subject.length){
      var mdl=uniq(subject.map(function(x){ return idx.byCode[x]?idx.byCode[x].model.toLowerCase():''; }).filter(Boolean));
      R.executor='variants'; R.codes=products.filter(function(p){ return mdl.indexOf(String(p.model||'').toLowerCase().trim())>=0; }).map(function(p){ return String(p.item_code); }); return R; }
    if(I==='compare'){ R.executor='compare'; R.codes=subject.slice(0,4); if(plan.metric) R.verdict=verdict(plan.metric,R.codes,idx,byCode,plan.priceField); return R; }

    /* subject (anchor / context) questions: the subject IS the set, narrowed by any spec named with it */
    var pool, fromSubject=subject.length>0;
    if(fromSubject) pool=subject.map(function(x){ return byCode[x]; }).filter(Boolean);
    else {
      var T=plan.type, fams=plan.useCase&&!T?plan.useCase.families:null;
      pool=products.filter(function(p){ var F=idx.byCode[String(p.item_code)]; if(!F) return false;
        if(T && !inType(F,T)) return false;
        if(fams && fams.length && fams.indexOf(F.type.family)<0) return false;
        if(plan.form && !(T && T.family!=='video_cable') && !formOk(F,plan.form)) return false;
        return true; });
      if(T && T.subtype && T.fallback && !pool.length){ var T2={ family:T.family }; pool=products.filter(function(p){ var F=idx.byCode[String(p.item_code)]; return F && inType(F,T2); }); R.notes.push('subtype fallback to family'); }
      /* car items only when "car" is asked (engine rule), unless they are the only matches */
      if(!/\bcar\b/.test(X.t)){ var nc=pool.filter(function(p){ var F=idx.byCode[String(p.item_code)]; return F.type.subtype!=='car' && !/\bcar\b/i.test(String(p.product_name||'')) && !/\bcar\b/i.test(String(p.sheet_display||'')); }); if(nc.length) pool=nc; }
    }
    var conf=[], weak=[];
    pool.forEach(function(p){
      var code=String(p.item_code), F=idx.byCode[code]; if(!F) return;
      var worst=3, ev=[], unknown=false, fail=false;
      function take(r){ if(!r||!r.ok){ if(r&&r.unknown) unknown=true; fail=true; return; } worst=Math.min(worst,TIER[r.tier]||3); if(r.ev) ev.push(r.ev); }
      if(!fromSubject){
        /* named connectors must be in the product name for cables / adapters (p2r2.1 rule); otherwise name or features */
        plan.connectors.forEach(function(k){ if(fail) return; var named=F.attrs.connectors.named.indexOf(k)>=0;
          if(named) return take({ ok:true, tier:'strong' }); if((plan.form||(plan.type&&/cable/.test(plan.type.family)))) return take({ ok:false });
          take(F.attrs.connectors.value.indexOf(k)>=0?{ ok:true, tier:'medium' }:{ ok:false }); });
        if(!fail && plan.pair) take({ ok:pairOk(F,plan.pair), tier:'strong' });
      }
      plan.filters.forEach(function(f){ if(!fail) take(numCheck(F,f,p)); });
      plan.ports.forEach(function(pp){ if(!fail) take(portCheck(F,pp)); });
      plan.match.forEach(function(a){ if(fail) return; var m=FACTS().match(F,a); if(!m) return take({ ok:false }); take({ ok:true, tier:m.t, ev:m.ev }); });
      if(fail){ if(unknown) R.unknown++; return; }
      if(worst===1) weak.push(code); else { conf.push({ code:code, tier:worst===3?'strong':'medium' }); if(ev.length) R.evidence[code]=ev[0]; }
    });
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
    if(plan.intent==='rank' && plan.sort){
      var S=plan.sort[0], vals={}, keep=[];
      R.codes.forEach(function(code){ var v=rankVal(S.by,idx.byCode[code],byCode[code]); if(v==null) R.unknown++; else { vals[code]=v; keep.push(code); } });
      keep.sort(function(a,b){ return (S.dir==='asc'?vals[a]-vals[b]:vals[b]-vals[a]) || (a<b?-1:a>b?1:0); });
      R.codes=keep; R.top=keep.slice(0,plan.limit||1); R.executor='rank';
    }
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
      if(!subject.length || list.length<2) pool.forEach(function(x){ if(list.indexOf(x)<0) list.push(x); });
      if(subject.length===1 && list.length<2 && fam && fam.length && I!=='compat'){        /* one anchored SKU for a judgement: add same-family items nearest in SRP */
        var ap=null;
        var sib=(idx.families[fam[0]]||[]).filter(function(x){ return x!==subject[0] && idx.byCode[x] && !idx.byCode[x].disabled; });
        var srp=function(x){ return Number((HOOK.byCode[x]||{}).srp)||0; }; ap=srp(subject[0]);
        sib.sort(function(x,y){ return Math.abs(srp(x)-ap)-Math.abs(srp(y)-ap) || (x<y?-1:1); }); sib.slice(0,7).forEach(function(x){ list.push(x); });
      }
      var perModel={}, final=[];
      list.forEach(function(x){ if(final.length>=8) return; var F=idx.byCode[x]; if(!F) return; var m=(F.model||x).toLowerCase(); if((perModel[m]||0)>=2 && subject.indexOf(x)<0) return; perModel[m]=(perModel[m]||0)+1; final.push(x); });
      out.purity=fam&&fam.length?{ families:fam, pure:final.filter(function(x){ return fam.indexOf(idx.byCode[x].type.family)>=0; }).length, of:final.length }:null;
      return final;
    }
    function set(r,rule){ out.route=r; out.rule=rule; return out; }
    if(I==='help') return set(ROUTES.CLARIFY,'R0 empty');
    if(I==='coach') return set(ROUTES.COACH,'R1 coach');
    if(I==='price_history') return set(ROUTES.LOCAL,'R2 history');
    var specific=plan.flags.devices.named.length>0;
    if(I==='compat' || (specific && !subject.length && (I==='recommend'||I==='list'||I==='exist'||I==='lookup'))){
      if(!hasProduct) return set(ROUTES.CLARIFY,'R3 compat without product');
      out.candidates=cands();
      if(subject.length || out.candidates.length>=1) return set(ROUTES.WEB,'R3 compat/device/external → WEB');
      return set(ROUTES.CLARIFY,'R3 compat, no candidate');
    }
    if(plan.ambiguity.some(function(a){ return a.slot==='target'||a.slot==='type'; }) && I!=='recommend') return set(ROUTES.CLARIFY,'R4 ambiguity');
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
  function nextContext(plan,prev){
    prev=prev||{}; var ctx={ turn:(prev.turn||0)+1, focus:[], results:[], comparison:prev.comparison||[], lastPlan:null };
    var subj=plan.subject||[], res=(plan.result&&plan.result.codes)||[];
    if(plan.intent==='compare' && subj.length>=2){ ctx.comparison=subj.slice(0,4); ctx.focus=[]; }
    else if(subj.length){ ctx.focus=subj.slice(); }
    else if(res.length===1){ ctx.focus=res.slice(); }
    ctx.results=(plan.result&&plan.result.top&&plan.intent!=='rank'?plan.result.top:res).slice(0,12);
    if(plan.intent==='rank') ctx.results=res.slice(0,12);
    if(subj.length && plan.intent!=='compare') ctx.comparison=prev.comparison&&plan.refs&&plan.refs.length?prev.comparison:[];
    ctx.lastPlan={ intent:plan.intent, type:plan.type?plan.type.id:null, filters:plan.filters.map(function(f){ return { attr:f.attr, op:f.op, value:f.attr==='price'?undefined:f.value }; }) };
    return ctx;
  }

  var API={ version:VERSION, routes:ROUTES, build:function(q,opts){ return buildWith(q,opts||{},(function(){ var m={}; ((opts||{}).products||[]).forEach(function(p){ if(p) m[String(p.item_code)]=p; }); return m; })()); },
    nextContext:nextContext, normalize:normalize, _compile:compile };
  if(typeof module!=='undefined' && module.exports) module.exports=API;
  root.VeroPlan=API;
})(typeof window!=='undefined'?window:globalThis);
