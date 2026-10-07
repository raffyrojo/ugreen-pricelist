/* VERO Local Brain — derived facts index (Foundation Step 1, p2r3-f1).
   Builds, in memory, one fact record per product from products.json: family / subtype, model / code, connectors, watts,
   mAh, length, port inventory by kind, resolution / refresh, data + ethernet speeds, feature flags and NAS attributes.
   Nothing is stored as a file; the index is memoized per catalog version and rebuilt when the catalog changes, so new
   monthly SKUs take part automatically.
   Evidence hierarchy (same as p2r2.1):
     STRONG  = structured field or product name                    -> confirmed
     MEDIUM  = authoritative feature line (features field)         -> confirmed
     WEAK    = short_desc + full description                       -> mentioned only, NOT confirmed
   Rules: the description never assigns a family or type; an attribute with no evidence stays unknown (never inferred);
   disagreeing evidence is kept and flagged as a conflict (the stronger tier keeps the value).
   SHADOW ONLY in this step: not loaded by index.html and not used by the live answer path.
   Browser: window.VeroFacts; Node: module.exports. Depends on VeroLexicon (data) and VeroNLU (text helpers). */
(function(root){
  'use strict';
  var LEX0=root.VeroLexicon||null, NL0=root.VeroNLU||null;
  if(typeof require==='function'){
    if(!LEX0){ try{ LEX0=require('./vero-lexicon.js'); }catch(e){} }
    if(!NL0){ try{ NL0=require('./vero-nlu.js'); }catch(e){} }
  }
  function LEXI(){ return root.VeroLexicon||LEX0; }
  function NLI(){ return root.VeroNLU||NL0; }
  function lc(s){ return String(s==null?'':s).toLowerCase(); }
  function txt(p,f){ return String((p&&p[f])==null?'':p[f]); }
  function esc(w){ return String(w).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }
  function wordsRe(list){ return new RegExp('(?:^|[^a-z0-9])(?:'+list.slice().sort(function(a,b){ return b.length-a.length; }).map(esc).join('|')+')(?![a-z0-9])'); }
  var TIER_RANK={strong:3,medium:2,weak:1};

  /* ================= safety-critical non-equivalences (CODE, not data) =================
     The lexicon may relate these terms for discovery ('related' / 'notEquivalent') but must never make them the same
     thing. assertLexiconSafe() rejects a lexicon that does. */
  var PROTECTED=[
    { a:['magnetic wireless','magnetic'], b:'flag.magsafe', why:'Magnetic wireless is not MagSafe (certification claim).' },
    { a:['qi'], b:'flag.qi2', why:'Qi is not Qi2.' },
    { a:['usb-c port','usb c port','type c port'], b:'connector.usb_c.cable', why:'A USB-C port is not a USB-C cable.' },
    { a:['thunderbolt','thunderbolt 3','thunderbolt 4','tbt'], b:'connector.usb4', why:'Thunderbolt is not automatically USB4.' }
  ];
  var SAFE_RELATIONS={ related:1, notEquivalent:1 };
  function assertLexiconSafe(lex){
    var errs=[];
    (lex.aliases||[]).forEach(function(al){
      PROTECTED.forEach(function(pr){
        if(pr.a.indexOf(lc(al.term))>=0 && String(al.to).indexOf(pr.b)===0 && !SAFE_RELATIONS[al.relation]) errs.push('"'+al.term+'" -> '+al.to+' as '+al.relation+': '+pr.why);
      });
    });
    /* a protected pair must never sit in one connector / unit synonym list */
    var c=lex.connectors||{};
    if((c.thunderbolt||[]).some(function(w){ return (c.usb4||[]).indexOf(w)>=0; }) || (c.usb4||[]).some(function(w){ return /thunderbolt|tbt/.test(w); })) errs.push('thunderbolt and usb4 share connector words');
    if(new RegExp(lex.flags.qi2.pattern).test('qi wireless charging')) errs.push('qi2 flag pattern matches plain "qi"');
    if(new RegExp(lex.flags.magsafe.pattern).test('magnetic wireless')) errs.push('magsafe flag pattern matches "magnetic wireless"');
    if(errs.length) throw new Error('VeroLexicon unsafe: '+errs.join('; '));
    return true;
  }

  /* ================= compile lexicon (once per lexicon object) ================= */
  var COMPILED=null, COMPILED_FOR=null;
  function compile(){
    var L=LEXI(); if(COMPILED && COMPILED_FOR===L) return COMPILED;
    if(!L) throw new Error('VeroLexicon not loaded');
    assertLexiconSafe(L);
    var C={ families:[], forms:{}, connectors:{}, flags:{}, colors:{}, portKinds:[] };
    L.taxonomy.families.forEach(function(f){
      C.families.push({ id:f.id, rules:f.rules, subtypes:f.subtypes||[], expects:f.expects||[], lineField:f.lineField||null,
        cue: f.nameCues&&f.nameCues.length ? wordsRe(f.nameCues) : null });
    });
    C.unclassified=L.taxonomy.unclassified||[];
    Object.keys(L.forms).forEach(function(k){ C.forms[k]=wordsRe(L.forms[k]); });
    Object.keys(L.connectors).forEach(function(k){ C.connectors[k]=wordsRe(L.connectors[k].map(function(w){ return lc(NLI().normText(w)); })); });
    Object.keys(L.flags).forEach(function(k){ C.flags[k]={ re:new RegExp(L.flags[k].pattern), nameOnly:!!L.flags[k].nameOnly }; });
    Object.keys(L.colors).forEach(function(k){ C.colors[k]=L.colors[k].map(function(w){ return new RegExp('\\b'+esc(w)+'\\b'); }); });
    /* port kinds: longest phrase first so "usb 3.0 a" wins over "usb" */
    Object.keys(L.portKinds).forEach(function(k){ L.portKinds[k].forEach(function(w){ var n=lc(NLI().normText(w)); C.portKinds.push({k:k,w:n,re:new RegExp('(?:^|[^a-z0-9.])'+esc(n)+'(?![a-z0-9])')}); }); });
    C.portKinds.sort(function(a,b){ return b.w.length-a.w.length; });
    C.resWords=L.resolutionWords; C.resLabels=L.resolutionLabels;
    COMPILED=C; COMPILED_FOR=L; return C;
  }

  /* ================= classification (structured first) ================= */
  function ruleHit(p,rule){
    var n=0;
    for(var f in rule){ if(!Object.prototype.hasOwnProperty.call(rule,f)) continue; if(rule[f].indexOf(txt(p,f))<0) return 0; n++; }
    return n;
  }
  function bestRule(p,rules){ var best=0; (rules||[]).forEach(function(r){ best=Math.max(best,ruleHit(p,r)); }); return best; }
  function classify(p,C,name){
    var hits=[];
    C.families.forEach(function(f){ var s=bestRule(p,f.rules); if(s) hits.push({f:f,s:s}); });
    var T={ family:'other', subtype:null, source:'none', specificity:0, conflict:null, line:null };
    if(hits.length){
      var top=Math.max.apply(null,hits.map(function(h){ return h.s; }));
      var tops=hits.filter(function(h){ return h.s===top; });
      var f=tops[0].f;
      T.family=f.id; T.specificity=top; T.source=f.rules.some(function(r){ return ruleHit(p,r)===top && r.category; })?'category':'sheet_display';
      if(tops.length>1) T.conflict={ kind:'structured', families:tops.map(function(h){ return h.f.id; }) };
      var sub=f.subtypes.filter(function(s){ return bestRule(p,s.rules); });
      if(sub.length) T.subtype=sub[0].id;
      if(f.lineField && txt(p,f.lineField)) T.line=txt(p,f.lineField);
      /* cross-check with the product name: the name cue of a DIFFERENT family, and none of this family's cues */
      if(!T.conflict && f.cue && !f.cue.test(name)){
        var other=C.families.filter(function(g){ return g.id!==f.id && g.cue && g.cue.test(name) && distinctiveCue(g.id); }).map(function(g){ return g.id; });
        if(other.length) T.conflict={ kind:'name', families:[f.id].concat(other), note:'structured family kept; product name suggests '+other.join(', ') };
      }
      return T;
    }
    var unc=C.unclassified.some(function(r){ return ruleHit(p,r); });
    if(!unc){                                                         /* not covered by structured rules: product-name fallback */
      var byName=C.families.filter(function(g){ return g.cue && distinctiveCue(g.id) && g.cue.test(name); });
      if(byName.length===1){ T.family=byName[0].id; T.source='name'; }
      else if(byName.length>1){ T.source='name'; T.conflict={ kind:'name-ambiguous', families:byName.map(function(g){ return g.id; }) }; }
    }
    return T;
  }
  /* families whose name cue is specific enough for a name-only fallback / cross-check */
  var DISTINCTIVE={ charger:1, power_bank:1, hub_dock:1, nas:1, card_reader:1, mouse:1, earphone:1, enclosure:1, webcam:1, stylus:1, microphone:1, capture_card:1, network_adapter:1, lan_cable:1, smart_finder:1, bt_adapter:1 };
  function distinctiveCue(id){ return !!DISTINCTIVE[id]; }

  /* ================= text units (evidence sources) ================= */
  var VIDEO_Q=/\b(hdmi|displayport|dp|vga|dvi|mini\s?dp)\b/g;
  function videoKinds(s){ var k={}, m; VIDEO_Q.lastIndex=0; while((m=VIDEO_Q.exec(s))) k[m[1].replace(/\s/g,'').replace('displayport','dp')]=1; return Object.keys(k).length; }
  var LAN_Q=/\b(rj45|ethernet|lan|gigabit|network|cat\s?[5-8]e?|1000\s?mbps|2\.5\s?g(?:bps)?|10\/100)\b/;
  function isLanProduct(p,name){ return /ethernet adapter/i.test(txt(p,'sheet_display'))||/\b(ethernet|lan|network)\s+(cable|adapter|adaptor|converter|switch|coupler)\b|\bcat\s?[5-8]e?\b/i.test(txt(p,'product_name')); }
  function isVideoCable(name){ return /\bcables?\b/.test(name) && /\b(hdmi|dp|displayport|vga|dvi)\b/.test(name) && !/\b(data|hub|dock)\b|usb\s?3|gen\s?2/.test(name); }
  function hzMentions(s){ var out=[],m,re=/\b(\d{2,3})\s*hz\b/g; while((m=re.exec(s))) out.push(+m[1]); return out; }
  function hdmiVers(s){ var m=s.match(/\bhdmi (2\.1|2\.0|1\.4)\b/g); return m?m.map(function(t){ return parseFloat(t.slice(5)); }):[]; }
  function gbpsName(s){ var v=0,m,re=/(\d+(?:\.\d+)?)\s?g(?:bps)?\b/g; while((m=re.exec(s))) v=Math.max(v,+m[1]); return v; }
  function gbpsSeg(s){ if(LAN_Q.test(s) || /\b(hdmi|displayport|dp)\b/.test(s)) return 0; var v=0,m,re=/(\d+(?:\.\d+)?)\s?(?:gbps|gb\/s)\b/g; while((m=re.exec(s))) v=Math.max(v,+m[1]); return v; }
  function ethSpeed(s){ if(!LAN_Q.test(s)) return 0; var v=0,m;
    if(/gigabit|1000\s?mbps|\b1\s?g(bps)?\b/.test(s)) v=Math.max(v,1);
    var re=/\b(2\.5|5|10|25|40)\s?(?:gbe|g(?:bps)?\s*(?:base-?t\s*)?(?:ethernet|lan|rj45|network)|gbps?\s*(?:ethernet|lan|rj45|network))\b|\b(?:ethernet|lan|rj45|network)(?:\s+port)?\s*(?:[:\-]|up to|speed(?: of)?)?\s*(2\.5|5|10|25|40)\s?g(?:bps|be)?\b/g;
    while((m=re.exec(s))) v=Math.max(v,+(m[1]||m[2]));
    if(!v && /\b100\s?mbps|10\/100\b/.test(s)) v=0.1; return v; }
  function unit(src,tier,text,isName,C){
    var NL=NLI();
    var u={ src:src, tier:tier, text:text,
      hdmi:/\bhdmi\b/.test(text), dp:/\b(dp|displayport|mini\s?dp)\b/.test(text), vga:/\bvga\b/.test(text),
      res:NL.resMentions(text), hz:hzMentions(text), hdmiVer:hdmiVers(text),
      gbps:isName?gbpsName(text):gbpsSeg(text), eth:ethSpeed(text), flags:{} };
    Object.keys(C.flags).forEach(function(k){ if((!C.flags[k].nameOnly||isName) && C.flags[k].re.test(text)) u.flags[k]=true; });
    return u;
  }
  function weakSource(p,re,W){ /* which weak field carries the mention (for the evidence record) */
    if(!W.d){ W.d=NLI().normText(txt(p,'description')); W.s=NLI().normText(txt(p,'short_desc')); }
    var d=W.d, s=W.s;
    return re(d)?'description':(re(s)?'short_desc':'description+short_desc');
  }

  /* ================= numeric attributes ================= */
  function lenMeters(str){ if(str==null||str==='') return null; var m=String(str).trim().toUpperCase().match(/^([\d.]+)\s*(M|CM|MM)?$/); if(!m) return null; var n=parseFloat(m[1]); return m[2]==='CM'?n/100:(m[2]==='MM'?n/1000:n); }
  function ev(attr,value,source,tier,text,extra){ var e={ attr:attr, value:value, source:source, tier:tier, confirmed:tier!=='weak', text:text==null?null:String(text).slice(0,160) }; if(extra) for(var k in extra) e[k]=extra[k]; return e; }
  function chooseValue(list){ /* strongest tier wins; disagreement inside confirmed evidence = conflict */
    if(!list.length) return { value:null, tier:null, evidence:[], conflict:false };
    list.sort(function(a,b){ return TIER_RANK[b.tier]-TIER_RANK[a.tier]; });
    var top=list[0], conf=list.filter(function(e){ return e.confirmed; });
    var vals={}; conf.forEach(function(e){ vals[JSON.stringify(e.value)]=1; });
    return { value:top.confirmed?top.value:null, tier:top.tier, mentioned:top.confirmed?undefined:top.value, evidence:list, conflict:Object.keys(vals).length>1 };
  }
  function wattsAttr(p,raw,segs){
    var out=[], all=raw.match(/(\d{2,3}(?:\.\d)?)\s?W\b/gi);
    if(all) out.push(ev('watts',Math.max.apply(null,all.map(function(x){ return parseFloat(x); })),'name','strong',raw));
    var best=0, bestSeg=null;
    segs.forEach(function(s){ if(!/(max|up to|support|charging|output|power|pd)/.test(s)) return; var m,re=/(\d{2,3})\s?w\b/g; while((m=re.exec(s))) if(+m[1]>best){ best=+m[1]; bestSeg=s; } });
    if(best) out.push(ev('watts',best,'features','medium',bestSeg));
    var r=chooseValue(out);
    /* a feature line may state a per-port figure lower than the name: only a HIGHER feature figure is a conflict */
    r.conflict = out.length===2 && out[1].value>out[0].value && !/recommend|input|adapter|~|\bac\b|\d{3}\s?v\b/.test(bestSeg);
    return r;
  }
  function mahAttr(p,raw,segs,desc){
    var out=[], m=raw.replace(/,/g,'').match(/(\d{4,5})\s?mAh/i);
    if(m) out.push(ev('mah',parseInt(m[1],10),'name','strong',raw));
    /* "rated capacity" / cell capacity (with voltage or cell count) is a different quantity, kept as mahRated — not a conflict */
    var rated=null;
    for(var i=0;i<segs.length;i++){ var s=segs[i].replace(/(\d),(\d{3})/g,'$1$2'), mm=s.match(/\b(\d{4,6})\s?mah\b/); if(!mm) continue;
      if(/\brated\b|\bcells?\b|\d(?:\.\d+)?\s?v\b/.test(s)){ if(!rated) rated=ev('mahRated',parseInt(mm[1],10),'features','medium',segs[i]); continue; }
      out.push(ev('mah',parseInt(mm[1],10),'features','medium',segs[i])); break; }
    if(!out.length){ var d=desc.replace(/(\d),(\d{3})/g,'$1$2').match(/\b(\d{4,6})\s?mah\b/); if(d) out.push(ev('mah',parseInt(d[1],10),'description','weak',d[0])); }
    var r=chooseValue(out); if(rated) r.rated=rated; return r;
  }
  function lengthAttr(p,name){
    var out=[], f=lenMeters(p.length);
    if(f!=null) out.push(ev('lengthM',f,'field:length','strong',txt(p,'length')));
    var m=name.match(/\b(\d+(?:\.\d+)?)\s?(m|cm)\b(?!\s?(?:ah|bps))/);
    if(m){ var v=+m[1]/(m[2]==='cm'?100:1); out.push(ev('lengthM',v,'name','strong',m[0])); }
    var r=chooseValue(out);
    r.conflict = out.length===2 && Math.abs(out[0].value-out[1].value)>1e-9;
    if(out.length) r.value=out[0].value;                             /* structured field first */
    return r;
  }
  function colorAttr(p,C,name){
    var c=lc(p.color), fam=Object.keys(C.colors).filter(function(k){ return C.colors[k].some(function(re){ return re.test(c); }); });
    if(c) return { value:fam.length?fam:null, raw:txt(p,'color'), tier:'strong', evidence:[ev('color',fam,'field:color','strong',txt(p,'color'))] };
    fam=Object.keys(C.colors).filter(function(k){ return C.colors[k].some(function(re){ return re.test(name); }); });
    return fam.length?{ value:fam, tier:'strong', evidence:[ev('color',fam,'name','strong',name)] }:{ value:null, tier:null, evidence:[] };
  }
  function connectorsAttr(C,name,segs){
    var byName=[], byFeat=[];
    Object.keys(C.connectors).forEach(function(k){ if(C.connectors[k].test(' '+name+' ')) byName.push(k); });
    var all=' '+segs.join(' \n ')+' ';
    Object.keys(C.connectors).forEach(function(k){ if(byName.indexOf(k)<0 && C.connectors[k].test(all)) byFeat.push(k); });
    var e=byName.map(function(k){ return ev('connector',k,'name','strong',name); }).concat(byFeat.map(function(k){ return ev('connector',k,'features','medium',null); }));
    return { value:byName.concat(byFeat), named:byName, evidence:e };
  }

  /* ---------- port inventory ---------- */
  /* charger port total: identical rule to vero-engine productPorts (explicit naming only) */
  function chargerPortTotal(p,family){
    var name=txt(p,'product_name');
    if(family!=='charger') return null;
    if(p.category==='Wireless Charger' || /wireless|cable|built[\s-]?in/i.test(name)) return null;
    var m;
    if(/single[\s-]?port/i.test(name)) return 1;
    if((m=name.match(/\b(\d)[\s-]?ports?\b/i))) return parseInt(m[1],10);
    if(/\b(?:dual|triple|quad|set)\b/i.test(name)) return null;
    if((m=name.match(/\b(\d)\s*C\s*\+?\s*(\d)\s*A\b/i))) return parseInt(m[1],10)+parseInt(m[2],10);
    if((m=name.match(/\b(\d)\s*A\s*\+?\s*(\d)\s*C\b/i))) return parseInt(m[1],10)+parseInt(m[2],10);
    var n=0, hit=false;
    name.replace(/(?:\b(\d)\s*[*x×]\s*)?USB[\s-]?(?:A|C)\b(?:\s*[*x×]\s*(\d))?/gi,function(mm,k1,k2){ hit=true; n+=k1?parseInt(k1,10):(k2?parseInt(k2,10):1); return mm; });
    if(hit) return n;
    if((m=name.match(/\b(\d)C\b/))) return parseInt(m[1],10);
    return null;
  }
  function tokenKinds(tok,C){
    var t=' '+tok.replace(/[()]/g,' ')+' ', kinds=[];
    if(/\bsd\s?(?:&|\/|and)\s?tf\b|\btf\s?(?:&|\/|and)\s?sd\b/.test(t)) return ['sd','tf'];
    for(var i=0;i<C.portKinds.length;i++){
      if(C.portKinds[i].re.test(t)){ kinds.push(C.portKinds[i].k); break; }
    }
    return kinds;
  }
  function parsePortList(s,C){
    var by={}, any=false;
    s.split(/\+|,|，|&|\/|\band\b/).forEach(function(tok){
      tok=tok.trim(); if(!tok) return;
      var cnt=1, m, ac=tok.match(/\b(\d)\s?a\s?(\d)\s?c\b|\b(\d)\s?c\s?(\d)\s?a\b/);
      if(ac){ var na=+(ac[1]||ac[4]), nc=+(ac[2]||ac[3]); by.usb_a=(by.usb_a||0)+na; by.usb_c=(by.usb_c||0)+nc; any=true; return; }   /* "1A1C" / "2C2A" */
      if((m=tok.match(/^(\d{1,2})\s*(?:[*x×]|pcs\b|ports?\b)\s*/))||(m=tok.match(/^(\d{1,2})x\s/))) cnt=+m[1];
      else if((m=tok.match(/(?:^|[^a-z])[*x×]\s*(\d{1,2})(?![\d.])/))) cnt=+m[1];
      else if(/^dual\b/.test(tok)) cnt=2; else if(/^triple\b/.test(tok)) cnt=3;
      var ks=tokenKinds(tok,C); if(!ks.length) return;
      ks.forEach(function(k){ by[k]=(by[k]||0)+cnt; }); any=true;
    });
    return any?by:null;
  }
  var PORT_FAMILIES={ hub_dock:1, usb_switch:1, network_switch:1, av_switch:1, video_adapter:1 };
  function portsAttr(p,family,C,name,segs){
    var out={ value:null, evidence:[], conflict:false };
    if(family==='charger'){
      var t=chargerPortTotal(p,family);
      if(t!=null){ out.value={ total:t, byKind:null }; out.evidence.push(ev('ports',{total:t},'name','strong',txt(p,'product_name'))); }
      return out;
    }
    if(!PORT_FAMILIES[family]) return out;
    var inOne=name.match(/\b(\d{1,2})\s?-?in-?\s?1\b/);
    var nm=null, tot=name.match(/\b(\d{1,2})[\s-]?ports?\b/);
    var toIdx=name.search(/\bto\b/);
    if(toIdx>=0){ nm=parsePortList(name.slice(toIdx+2).replace(/\b\d{1,2}\s?-?in-?\s?1\b/g,' ').replace(/\b(converter|hub|adapter|power|port|female|male|\d+(?:\.\d+)?\s?g)\b/g,' '),C); }
    var nameVal=null;
    if(nm||tot){ nameVal={ byKind:nm, total:tot?+tot[1]:(nm?Object.keys(nm).reduce(function(a,k){ return a+(k==='pd'||k==='dc'?0:nm[k]); },0):null) };
      out.evidence.push(ev('ports',nameVal,'name','strong',txt(p,'product_name'))); }
    var outSeg=null, fv=null, lines=txt(p,'features').split(/\r?\n|[▪•]/);
    for(var i=0;i<lines.length;i++){ var l=NLI().normText(lines[i]).replace(/^[\s*]+/,'').trim(); if(/^output\s*[:：]/.test(l)){ outSeg=l; break; } }
    if(outSeg && /\bor\b/.test(outSeg)) outSeg=null;                 /* "1*HDMI or 2*HDMI" (bi-directional): not an inventory */
    if(outSeg){ var lst=parsePortList(outSeg.replace(/^output\s*[:：]\s*/,'').replace(/\b(female|male|port|slot|card|use simultaneously)\b/g,' '),C);
      if(lst){ fv={ byKind:lst, total:Object.keys(lst).reduce(function(a,k){ return a+(k==='pd'||k==='dc'?0:lst[k]); },0) }; out.evidence.push(ev('ports',fv,'features','medium',outSeg)); } }
    out.value=nameVal||fv; if(out.value && inOne) out.value.inOne=+inOne[1];
    if(nameVal&&nameVal.byKind&&fv){
      ['hdmi','dp','vga','rj45'].forEach(function(k){ if((nameVal.byKind[k]||0)!==(fv.byKind[k]||0)) out.conflict=true; });   /* video / LAN ports: any disagreement */
      var ua=(nameVal.byKind.usb_a||0)+(nameVal.byKind.usb||0), fa=(fv.byKind.usb_a||0)+(fv.byKind.usb||0);
      if(ua&&fa&&ua!==fa) out.conflict=true;
      if(nameVal.total!=null && Math.abs(nameVal.total-fv.total)>=2) out.conflict=true;
    }
    return out;
  }

  /* ---------- NAS attributes (feature lines only; no inference) ---------- */
  function nasAttr(segs){
    var o={ bays:null, cpu:null, ram:null, evidence:[] };
    segs.forEach(function(s){
      var m;
      if(o.bays==null && (m=s.match(/^bays?\s*[:：]\s*(\d{1,2})\b/))){ o.bays=+m[1]; o.evidence.push(ev('nasBays',+m[1],'features','medium',s)); }
      if(o.cpu==null && (m=s.match(/^cpu\s*[:：]\s*(.+)$/))){ o.cpu=m[1].trim(); o.evidence.push(ev('nasCpu',o.cpu,'features','medium',s)); }
      if(o.ram==null && (m=s.match(/^ram\s*[:：]\s*(.+)$/))){ o.ram=m[1].trim(); o.evidence.push(ev('nasRam',o.ram,'features','medium',s)); }
    });
    return o;
  }

  /* ================= one product -> fact ================= */
  function factOf(p,C){
    var NL=NLI(), raw=txt(p,'product_name'), name=NL.normText(raw), own=NL.normText(txt(p,'item_code'));
    var foreign=function(s){ var m,re=/\b(\d{5}[a-z]?)\b(?!\s?(?:mah|w|mm|m|hz|mbps|gbps|p|k)\b)/g; while((m=re.exec(s))) if(m[1]!==own) return true; return false; };
    var segs=NL.segments(txt(p,'features')).filter(function(s){ return !foreign(s); });
    var desc=NL.normText(txt(p,'description')+'\n'+txt(p,'short_desc'));
    var T=classify(p,C,name);
    var single=videoKinds(name)===1 && !/\+|\d-in-1|\b(hub|dock|docking)\b/.test(name) && !/docking and hub/i.test(txt(p,'sheet_display'));
    var units=[unit('name','strong',name,true,C)].concat(segs.map(function(s){ return unit('features','medium',s,false,C); }), [unit('weak','weak',desc,false,C)]);
    var forms={}; Object.keys(C.forms).forEach(function(k){ if(C.forms[k].test(' '+name+' ')) forms[k]=true; });
    T.forms=forms;

    var F={ code:String(p.item_code), model:txt(p,'model').trim(), name:raw, section:txt(p,'sheet_display'), category:txt(p,'category'),
      disabled:!!p.disabled, type:T, single:single, gbpsExcluded:isLanProduct(p,name)||isVideoCable(name), units:units, attrs:{}, unknown:[], conflicts:[] };
    var A=F.attrs;
    A.watts=wattsAttr(p,raw,segs);
    A.mah=mahAttr(p,raw,segs,desc);
    A.lengthM=lengthAttr(p,name);
    A.color=colorAttr(p,C,name);
    A.connectors=connectorsAttr(C,name,segs);
    A.ports=portsAttr(p,T.family,C,name,segs);
    /* video: every resolution / refresh mention with its port qualifier and tier */
    var vm=[];
    units.forEach(function(u){ u.res.forEach(function(r){ vm.push({ r:r.r, label:C.resLabels[String(r.r)]||null, hz:r.hz, ports:['hdmi','dp','vga'].filter(function(k){ return u[k]; }), source:u.src==='weak'?'description+short_desc':u.src, tier:u.tier, confirmed:u.tier!=='weak' }); }); });
    var maxC=vm.filter(function(m){ return m.confirmed; }).reduce(function(a,m){ return Math.max(a,m.r); },0);
    A.video={ value:maxC?{ maxRes:maxC, label:C.resLabels[String(maxC)] }:null, mentions:vm };
    A.hdmiVersion=bestNum(units,'hdmiVer','hdmiVersion');
    A.dataGbps=F.gbpsExcluded?{ value:null, excluded:true, evidence:[] }:bestScalar(units,'gbps','dataGbps');
    A.ethGbps=bestScalar(units,'eth','ethGbps');
    A.flags={}; var W={};
    Object.keys(C.flags).forEach(function(k){
      for(var i=0;i<units.length;i++){ if(units[i].flags[k]){ var u=units[i];
        A.flags[k]={ tier:u.tier, confirmed:u.tier!=='weak', evidence:[ev('flag:'+k,true,u.src==='weak'?weakSource(p,function(s){ return C.flags[k].re.test(s); },W):u.src,u.tier,u.text)] }; return; } }
    });
    if(T.family==='nas'){ A.nas=nasAttr(segs); }
    /* unknown = expected for this family but no confirmed evidence */
    var fam=C.families.filter(function(f){ return f.id===T.family; })[0];
    (fam?fam.expects:[]).forEach(function(k){
      var a=k==='nasBays'?(A.nas&&A.nas.bays!=null?{value:A.nas.bays}:null):A[k];
      var has=a && a.value!=null && !(Array.isArray(a.value)&&!a.value.length);
      if(!has) F.unknown.push(k);
    });
    ['watts','mah','lengthM','ports'].forEach(function(k){ if(A[k]&&A[k].conflict) F.conflicts.push(k); });
    if(T.conflict) F.conflicts.push('type');
    return F;
  }
  function bestScalar(units,key,attr){
    var out=[]; units.forEach(function(u){ if(u[key]) out.push(ev(attr,u[key],u.src==='weak'?'description+short_desc':u.src,u.tier,u.text)); });
    var r=chooseValue(out.slice()); /* report the max confirmed value */
    var conf=out.filter(function(e){ return e.confirmed; });
    r.value=conf.length?Math.max.apply(null,conf.map(function(e){ return e.value; })):null; r.conflict=false; return r;
  }
  function bestNum(units,key,attr){
    var out=[]; units.forEach(function(u){ if(u[key].length) out.push(ev(attr,Math.max.apply(null,u[key]),u.src==='weak'?'description+short_desc':u.src,u.tier,u.text)); });
    var conf=out.filter(function(e){ return e.confirmed; });
    return { value:conf.length?Math.max.apply(null,conf.map(function(e){ return e.value; })):null, evidence:out };
  }

  /* ================= index build (memoized per catalog version) ================= */
  var MEMO={ key:null, idx:null };
  function signature(products){
    var h=2166136261, n=0;
    for(var i=0;i<products.length;i++){ var p=products[i]; if(!p) continue; n++;
      var s=String(p.item_code)+'|'+(p.product_name||'')+'|'+(p.sheet_display||'')+'|'+(p.category||'')+'|'+(p.features||'').length+'|'+(p.description||'').length+'|'+(p.short_desc||'').length+'|'+(p.length||'')+'|'+(p.color||'')+'|'+(p.disabled?1:0);
      for(var j=0;j<s.length;j++){ h^=s.charCodeAt(j); h=(h*16777619)>>>0; } }
    return n+':'+h.toString(16);
  }
  function build(products,opts){
    opts=opts||{}; products=products||[];
    var key=(opts.version?('v:'+opts.version+'|'):'')+signature(products)+'|lex:'+(LEXI()&&LEXI().version);
    if(!opts.force && MEMO.key===key && MEMO.idx) return MEMO.idx;
    var t0=Date.now(), C=compile(), byCode={}, families={}, stats={ total:0, classified:0, other:0, conflicting:0, bySource:{}, byFamily:{} };
    products.forEach(function(p){
      if(!p) return; var f=factOf(p,C); byCode[f.code]=f; stats.total++;
      (families[f.type.family]=families[f.type.family]||[]).push(f.code);
      stats.byFamily[f.type.family]=(stats.byFamily[f.type.family]||0)+1;
      stats.bySource[f.type.source]=(stats.bySource[f.type.source]||0)+1;
      if(f.type.family==='other') stats.other++; else stats.classified++;
      if(f.type.conflict) stats.conflicting++;
    });
    var idx={ key:key, version:opts.version||null, builtAt:new Date().toISOString(), buildMs:Date.now()-t0, byCode:byCode, families:families, stats:stats };
    MEMO={ key:key, idx:idx };
    return idx;
  }
  function factFor(p){ return factOf(p,compile()); }

  /* ================= PARITY MODE (tests only) =================
     match() answers the same constraint objects as VeroNLU.match ({k:'res'|'refresh'|'hdmiver'|'gbps'|'eth'|'flag'|'color'|'lenRange', ...})
     from the structured facts, so tests can prove the facts index reproduces today's evidence tiers before any parser
     logic moves. legacyTypes() reproduces VeroNLU.types from the taxonomy. Neither is used by the live answer path. */
  function qualOkU(u,q,F){ if(!q) return true; if(F && F.single && qualOkU(F.units[0],q)) return true; if(q==='hdmi') return u.hdmi; if(q==='dp') return u.dp; if(q==='vga') return u.vga; return true; }
  function scan(F,okIn,nameStops){
    var U=F.units;
    if(okIn(U[0],null)) return {t:'strong'};
    if(nameStops && nameStops(U[0])) return null;
    for(var i=1;i<U.length-1;i++) if(okIn(U[i],F)) return {t:'medium',ev:U[i].text};
    if(okIn(U[U.length-1],F)) return {t:'weak'};
    return null;
  }
  function match(F,a){
    var C=compile();
    switch(a.k){
      case 'res': return scan(F,function(u,x){ return qualOkU(u,a.q,x) && u.res.some(function(m){ return m.r>=a.v; }); },
                    function(n){ return qualOkU(n,a.q) && n.res.length>0; });
      case 'refresh': return scan(F,function(u,x){ if(!qualOkU(u,a.q,x)) return false;
                        return a.r ? u.res.some(function(m){ return m.r>=a.r && m.hz!=null && m.hz>=a.hz; }) : u.hz.some(function(h){ return h>=a.hz; }); },
                    function(n){ return qualOkU(n,a.q) && (a.r ? n.res.some(function(m){ return m.hz!=null; }) : n.hz.length>0); });
      case 'hdmiver': return scan(F,function(u){ return u.hdmiVer.some(function(v){ return v>=a.v-1e-9; }); });
      case 'gbps': if(F.gbpsExcluded) return null; return scan(F,function(u){ return u.gbps>=a.v; });
      case 'eth': return scan(F,function(u){ return u.eth>=a.v; });
      case 'flag': return scan(F,function(u){ return !!u.flags[a.v]; });
      case 'color': { var want=a.v==='grey'?'gray':a.v, c=F.attrs.color; return c.value && c.value.indexOf(want)>=0 ? {t:'strong'} : null; }
      case 'lenRange': { var e=F.attrs.lengthM.evidence.filter(function(x){ return x.source==='field:length'; })[0]; if(!e) return null; return (e.value>=a.lo-1e-9 && e.value<=a.hi+1e-9)?{t:'strong'}:null; }
    }
    return null;
  }
  function legacyTypes(F){
    var t=F.type, n=F.units[0].text, conn=F.attrs.connectors.named;
    var hub=t.family==='hub_dock' || !!t.forms.hub;
    return {
      cable: !!t.forms.cable && !/\bcar charger\b/.test(n),
      hub: hub, dock: hub,
      adapter: (!!t.forms.adapter || /adapter|converter/i.test(F.category)) && !hub,
      converter: (!!t.forms.adapter || /adapter|converter/i.test(F.category)) && !hub,
      lan: t.family==='network_adapter' || conn.indexOf('rj45')>=0,
      hdmi: conn.indexOf('hdmi')>=0,
      charger: t.family==='charger',
      powerbank: t.family==='power_bank',
      nas: t.family==='nas' || /\bnasync\b/.test(n)
    };
  }

  var API={ version:'f1', build:build, factFor:factFor, signature:signature, assertLexiconSafe:assertLexiconSafe, protectedRules:PROTECTED,
    match:match, legacyTypes:legacyTypes, chargerPortTotal:chargerPortTotal, _compile:compile };
  if(typeof module!=='undefined' && module.exports) module.exports=API;
  root.VeroFacts=API;
})(typeof window!=='undefined'?window:globalThis);
