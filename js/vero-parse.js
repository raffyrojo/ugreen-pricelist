/* VERO Local Brain v2-1 — "Accountable Parse" (SHADOW ONLY).
   Typed lexer -> semantic span ledger -> contextual sense resolver -> SemanticFrame -> coverage guard -> shadow executor
   over a typed product graph (tri-state CONFIRMED / UNKNOWN / CONTRADICTED) -> false-negative ladder -> label integrity.
   Every token of the question ends in exactly one span, and every span ends in exactly one state:
     BOUND          bound to a frame slot (subject, constraint, field, intent, device, use case, discourse, function word)
     UNCONFIRMABLE  bound, but the listing cannot confirm it for the candidates (said out loud, never silently dropped)
     UNRESOLVED     no concept found (never inherited, never ignored; blocks a confident exact answer)
     AMBIGUOUS      several senses with too small a margin (clarify or surface the interpretation)
   A span with none of these states is a SILENT DROP; the shadow report counts them and v2-1 must keep them at zero.
   SHADOW ONLY: not loaded by index.html, never called by vero-engine.js / vero.js; the live answer path is unchanged.
   v2-2B (still SHADOW, still unloaded): scope() adds version notation, PCIe lanes, bare generations, negation scope and RELAX;
   turnFrame(P) projects a parse into the frozen A5 turn-frame contract consumed by VeroDiscourse (js/vero-discourse.js).
   V2-2C C1 (still SHADOW, still unloaded): executeFrame(frame, opts) evaluates a merged A5 frame over the full published
   catalogue (evidence CONFIRMED / INFERRED / UNKNOWN / CONTRADICTED, live prices); absence is never a contradiction except for
   name-defined slots; the catalogue cache re-reads prices; parser follow-ups (relativised "with cable" = built-in cable,
   "X, not needed", require + relax of one slot = AMBIGUOUS, "not HDMI 2.1" excludes the version only, "built-in", generic
   mixed-family name words) and the additive A5 amendment (flags.same, keep). Current turn only: never a result set.
   Browser: window.VeroParse; Node: module.exports. Depends on VeroOntology, VeroLexicon, VeroFacts (data only). */
(function(root){
  'use strict';
  var ONT0=root.VeroOntology||null, LEX0=root.VeroLexicon||null, VF0=root.VeroFacts||null;
  if(typeof require==='function'){
    if(!ONT0){ try{ ONT0=require('./vero-ontology.js'); }catch(e){} }
    if(!LEX0){ try{ LEX0=require('./vero-lexicon.js'); }catch(e){} }
    if(!VF0){ try{ VF0=require('./vero-facts.js'); }catch(e){} }
  }
  function ONT(){ return root.VeroOntology||ONT0; }
  function LEX(){ return root.VeroLexicon||LEX0; }
  function VF(){ return root.VeroFacts||VF0; }
  var VERSION='v2-2C-C1';
  function now(){ return (typeof performance!=='undefined' && performance.now)?performance.now():Date.now(); }
  function uniq(a){ var s={}, o=[]; (a||[]).forEach(function(x){ var k=typeof x==='object'?JSON.stringify(x):String(x); if(!s[k]){ s[k]=1; o.push(x); } }); return o; }
  function own(o,k){ return Object.prototype.hasOwnProperty.call(o,k); }
  function num(x){ var n=parseFloat(String(x==null?'':x).replace(/[^0-9.\-]/g,'')); return isNaN(n)?null:n; }
  function esc(w){ return String(w).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }

  /* =====================================================================================================
     A. TYPED LEXER
     ===================================================================================================== */
  var UNIT_SUFFIX={}; /* glued unit suffix -> unit id ("65w", "20000mah", "2m", "15.6inch") */
  var RES_TOKENS={ '720p':1, '1080p':2, '1440p':3, '2160p':4, '2k':3, '4k':4, '5k':5, '8k':6, 'fhd':2, 'qhd':3, 'uhd':4 };
  function normalizeQ(s){
    s=String(s==null?'':s).toLowerCase();
    s=s.replace(/[‘’ʼ`]/g,"'").replace(/[“”]/g,'"').replace(/[‐-―−]/g,'-').replace(/ /g,' ');
    for(var i=0;i<2;i++) s=s.replace(/(\d),(\d{3})(?!\d)/g,'$1$2');
    s=s.replace(/\bwi-?fi\b/g,'wifi').replace(/(\w)'s\b/g,'$1s').replace(/'/g,'');
    s=s.replace(/\bpinaka[\s-]+(?=[a-z])/g,'pinaka');
    /* v2-2B: one spelling for the PCIe interface ("PCI-E", "pci e", "PCI Express" -> "pcie"); split glued versions / lanes
       inside PCIe notation only ("pci-e3.0x4" -> "pcie 3.0 x4"); keep USB "Gen 2x2" as one generation token */
    s=s.replace(/\bpci[\s-]?e(?=\d|\b)/g,'pcie').replace(/\bpci[\s-]express\b/g,'pcie').replace(/\bpcie(?=\d)/g,'pcie ');
    s=s.replace(/\b(pcie (?:gen ?)?\d(?:\.\d)?)x(\d{1,2})\b/g,'$1 x$2').replace(/\bgen ?(\d)x(\d)\b/g,'gen$1x$2');
    /* Taglish verb prefixes on an English stem carry aspect, not product meaning: "nag-increase" -> "increase", "i-recommend" -> "recommend" */
    s=s.replace(/\b(nag|mag|na|ma|pa|pag)-(iba|bago|taas|baba|mura|mahal|ubos|dagdag|bawas|palit|sira|bili|benta|kaiba)\b/g,'$1$2');
    s=s.replace(/\b(?:nag|mag|naka|maka|pag|ipa|mai|pina|i|ma)(?:[a-z]{1,3})?-(?=[a-z]{3})/g,function(m){ return /^(nag|mag|naka|maka|pag|ipa|mai|pina|i|ma)-$/.test(m)||/^(nag|mag)[a-z]{1,3}-$/.test(m)?'':m; });
    return s.replace(/\s+/g,' ').trim();
  }
  /* raw tokens: numbers (with glued suffix), words (letters, optional digits / .digits), symbols kept for grammar */
  var TOK_RE=/₱|\d+(?:\.\d+)?[a-z]*(?:\.\d+)?|[a-z]+[a-z0-9]*(?:\.\d+)?[a-z]*|[+*"&?:]/g;
  function tokenize(s,cat){
    var out=[], m; TOK_RE.lastIndex=0;
    function push(t,k,from,to,v){ var o={ t:t, k:k, from:from, to:to }; if(v!=null) o.v=v; out.push(o); }
    while((m=TOK_RE.exec(s))){
      var t=m[0], a=m.index, b=a+t.length, mm;
      if(t==='₱'){ push(t,'sym',a,b); continue; }
      if(/^[+*"&?:]$/.test(t)){ push(t,'sym',a,b); continue; }
      if(/^\d/.test(t)){
        if(cat && cat.codes[t]){ push(t,'code',a,b); continue; }
        if((mm=t.match(/^(\d+(?:\.\d+)?)$/))){ push(t,'num',a,b,parseFloat(t)); continue; }
        if(RES_TOKENS[t] && !/k$/.test(t)){ push(t,'word',a,b); continue; }
        if((mm=t.match(/^(\d+)x([a-z].*)$/))){ push(mm[1],'num',a,a+mm[1].length,+mm[1]); push('*','sym',a+mm[1].length,a+mm[1].length+1); push(mm[2],'word',a+mm[1].length+1,b); continue; }
        if((mm=t.match(/^(\d+(?:\.\d+)?)([a-z]+)$/)) && UNIT_SUFFIX[mm[2]]){ push(mm[1],'num',a,a+mm[1].length,parseFloat(mm[1])); push(mm[2],'word',a+mm[1].length,b); continue; }
        push(t,'word',a,b); continue;
      }
      if(cat && (cat.codes[t]||cat.models[t])){ push(t,'code',a,b); continue; }
      if((mm=t.match(/^(usb|dp|hdmi|bt|gen|wifi|tb|thunderbolt)(\d+(?:\.\d+)?)([a-z]?)$/))){
        var p1=mm[1], p2=mm[2], p3=mm[3];
        push(p1,'word',a,a+p1.length); push(p2,'num',a+p1.length,a+p1.length+p2.length,parseFloat(p2)); if(p3) push(p3,'word',b-1,b); continue; }
      push(t,'word',a,b);
    }
    if(cat){ for(var q=0;q<out.length-1;q++){ var a1=out[q], a2=out[q+1], a3=out[q+2];
      if((a1.k==='word'||a1.k==='code') && /\d/.test(a1.t) && a2 && a2.k==='word'){ var j2=a1.t+a2.t, j3=a3&&a3.k==='word'?j2+a3.t:null;
        if(j3 && cat.models[j3]){ out.splice(q,3,{ t:j3, k:'code', from:a1.from, to:a3.to, joined:[a1.t,a2.t,a3.t] }); }
        else if(cat.models[j2] && !cat.models[a1.t]){ out.splice(q,2,{ t:j2, k:'code', from:a1.from, to:a2.to, joined:[a1.t,a2.t] }); } } } }
    out.forEach(function(x,i){ x.i=i; if(x.k==='word' && x.t.length>=4 && /ng$/.test(x.t)) x.base=x.t.slice(0,-2); else if(x.k==='word' && x.t.length>=5 && /[^s]s$/.test(x.t)) x.base=x.t.slice(0,-1); });
    return out;
  }
  function tokTexts(s){ return tokenize(normalizeQ(s),null).map(function(x){ return x.t; }); }

  /* =====================================================================================================
     B. COMPILED VOCABULARY (ontology + lexicon), memoized per lexicon/ontology object
     ===================================================================================================== */
  var VOC=null, VOC_FOR=null;
  function trieAdd(trie,phrase,entry){
    var toks=Array.isArray(phrase)?phrase:tokTexts(phrase); if(!toks.length) return;
    var node=trie; toks.forEach(function(t){ node=node.c[t]||(node.c[t]={ c:{}, e:null }); });
    (node.e=node.e||[]).push(entry);
  }
  function plural(w){ return /(s|x|ch|sh)$/.test(w)?w+'es':(/[^aeiou]y$/.test(w)?w.slice(0,-1)+'ies':w+'s'); }
  var PRIO={ ANCHOR:0, COMPOSITE:1, DEVICE:2, AMBIG:2, STANDARD:3, CONNECTOR:3, PORTROLE:3, FIELD:4, FAMILY:4, INTENT:4, FEATURE:5, USECASE:5, DEVICECLASS:5,
    COLOR:6, DISCOURSE:6, NEG:6, NAME:7, FORM:7, GENDER:8, RES:8, REF:9, FUNCTION:10 };
  var FORM_WORDS={ cable:['cable','cables','cord','kable','wire'], adapter:['adapter','adapters','adaptor','adaptors','converter','converters','dongle'], extender:['extender','extenders'],
    splitter:['splitter','splitters'], switcher:['switcher','switchers'], enclosure:['enclosure','enclosures','case for ssd'], extension:['extension','extensions'],
    set:['set','kit'], stand:['stand','stands'], pen:['pen'] };
  var FORM_NAME_RE={ cable:/\bcables?\b|\bcord\b/, adapter:/\badapt[eo]rs?\b|\bconverter\b|\bdongle\b/, extender:/\bextender\b/, splitter:/\bsplitter\b/, switcher:/\bswitch(?:er)?\b/,
    enclosure:/\benclosure\b/, extension:/\bextension\b/, set:/\bset\b|\bkit\b/, stand:/\bstand\b/, pen:/\bpen\b/ };
  /* v2-2B: negators come from VeroOntology.NEGATION (clear / existential negate; relax = "not needed"; epistemic = unsure) */
  var GENDER_WORDS={ male:'male', female:'female', lalaki:'male', babae:'female' };
  var TO_WORDS={ to:1, papunta:1, into:1 };
  var PRICE_OPS={ under:'<=', below:'<=', 'less than':'<=', 'mababa sa':'<=', 'hindi lalagpas':'<=', max:'<=', hanggang:'<=', within:'<=', budget:'<=', 'up to':'<=',
    above:'>=', over:'>=', 'more than':'>=', 'at least':'>=', around:'~', mga:'~', approx:'~', about:'~' };
  var MEASURE_OPS={ 'at least':'>=', 'or more':'>=', pataas:'>=', 'and above':'>=', minimum:'>=', 'at most':'<=', pababa:'<=', 'or higher':'>=', 'and up':'>=',
    'longer than':'>', 'more than':'>', 'higher than':'>', 'bigger than':'>', 'greater than':'>', 'mas mahaba sa':'>', 'mas mataas sa':'>', 'shorter than':'<', 'less than':'<', 'lower than':'<' };
  function compileVocab(){
    var O=ONT(), L=LEX(); if(VOC && VOC_FOR===O && VOC.lex===L) return VOC;
    if(!O||!L) throw new Error('VeroParse: VeroOntology and VeroLexicon are required');
    var trie={ c:{}, e:null }, single={}, senseTerms={};
    function add(ph,e){ trieAdd(trie,ph,e); var tt=tokTexts(ph); if(tt.length===1) single[tt[0]]=true; }
    Object.keys(O.SENSES).forEach(function(term){ senseTerms[term]=1; add(term,{ type:'AMBIG', value:term, prio:PRIO.AMBIG }); });
    function notSense(ph){ return !senseTerms[tokTexts(ph).join(' ')]; }
    /* units: glued suffixes */
    Object.keys(O.UNITS).forEach(function(u){ O.UNITS[u].aliases.forEach(function(a){ if(/^[a-z/]+$/.test(a)) UNIT_SUFFIX[a.replace('/','')]=u; }); });
    UNIT_SUFFIX.inch='inch'; UNIT_SUFFIX.in='inch'; UNIT_SUFFIX.k='k'; UNIT_SUFFIX.g='Gbps'; UNIT_SUFFIX.ghz='GHz'; delete UNIT_SUFFIX.p;
    /* connectors */
    Object.keys(O.CONNECTORS).forEach(function(id){ O.CONNECTORS[id].aliases.forEach(function(a){ if(notSense(a)) add(a,{ type:'CONNECTOR', value:{ id:id }, prio:PRIO.CONNECTOR }); }); });
    add('usb',{ type:'CONNECTOR', value:{ id:'usb' }, prio:PRIO.CONNECTOR });
    Object.keys(O.STANDARDS).forEach(function(id){ O.STANDARDS[id].aliases.forEach(function(a){ if(/^\d/.test(a)||a==='ax') return; add(a,{ type:'STANDARD', value:{ id:id }, prio:PRIO.STANDARD }); }); });
    Object.keys(O.PORT_ROLES).forEach(function(id){ O.PORT_ROLES[id].cues.forEach(function(a){ if(tokTexts(a).length>1) add(a,{ type:'PORTROLE', value:{ role:id }, prio:PRIO.PORTROLE }); }); });
    Object.keys(O.FEATURES).forEach(function(id){ O.FEATURES[id].aliases.forEach(function(a){ if(notSense(a)) add(a,{ type:'FEATURE', value:{ id:id }, prio:PRIO.FEATURE }); }); });
    Object.keys(O.FIELDS).forEach(function(id){ O.FIELDS[id].aliases.forEach(function(a){ if(notSense(a)) add(a,{ type:'FIELD', value:{ id:id }, prio:PRIO.FIELD }); }); });
    Object.keys(O.DEVICE_CLASSES).forEach(function(id){ O.DEVICE_CLASSES[id].aliases.forEach(function(a){ add(a,{ type:'DEVICECLASS', value:{ id:id }, prio:PRIO.DEVICECLASS }); }); });
    Object.keys(O.USE_CASES).forEach(function(id){ O.USE_CASES[id].aliases.forEach(function(a){ add(a,{ type:'USECASE', value:{ id:id }, prio:PRIO.USECASE }); }); add('gaming setup',{ type:'USECASE', value:{ id:'gaming' }, prio:PRIO.USECASE }); });
    Object.keys(O.INTENT_CUES).forEach(function(k){ if(k==='attribute'||k==='find') return; O.INTENT_CUES[k].forEach(function(a){ if(notSense(a)) add(a,{ type:'INTENT', value:{ id:k, word:a }, prio:PRIO.INTENT }); }); });
    O.INTENT_CUES.find.forEach(function(a){ add(a,{ type:'FUNCTION', value:{ role:'find' }, prio:PRIO.FUNCTION }); });
    Object.keys(L.colors).forEach(function(c){ L.colors[c].forEach(function(a){ add(a,{ type:'COLOR', value:{ id:c }, prio:PRIO.COLOR }); }); });
    ['space gray','space grey','dark gray','light blue','navy','rose gold','orange','brown'].forEach(function(a){ add(a,{ type:'COLOR', value:{ id:a.replace('grey','gray') }, prio:PRIO.COLOR }); });
    Object.keys(RES_TOKENS).forEach(function(r){ if(!/k$/.test(r)) add(r,{ type:'RES', value:{ rank:RES_TOKENS[r], text:r }, prio:PRIO.RES }); });
    (L.external||[]).forEach(function(w){ add(w,{ type:'EXTERNAL', value:{ word:w }, prio:PRIO.FEATURE }); });
    ['jellyfin','plex','docker','emby','home assistant','nextcloud','time machine','airline','check-in','hand carry','isakay','carry on','carry-on'].forEach(function(w){ add(w,{ type:'EXTERNAL', value:{ word:w }, prio:PRIO.FEATURE }); });
    (L.language.period||[]).concat(['this week','last week','recently','lately','kamakailan','ngayon','today','this quarter']).forEach(function(w){ add(w,{ type:'PERIOD', value:{ period:w }, prio:PRIO.INTENT }); });
    Object.keys(MEASURE_OPS).concat(Object.keys(PRICE_OPS),['longer than','shorter than','higher than','lower than','more than','less than','bigger than','greater than','mas mahaba sa','mas mataas sa','or higher','or lower','pataas','pababa','and up','minimum']).forEach(function(w){ if(tokTexts(w).length>1 || /^(pataas|pababa|minimum|under|below|above|over|within|budget|hanggang|around|approx|about)$/.test(w)) add(w,{ type:'OPERATOR', value:{ op:w }, prio:PRIO.INTENT }); });
    Object.keys(L.smalltalk||{}).forEach(function(k){ (L.smalltalk[k]||[]).forEach(function(w){ if(tokTexts(w).length>=1 && notSense(w)) add(w,{ type:'DISCOURSE', value:{ id:w, smalltalk:k }, prio:PRIO.DISCOURSE }); }); });
    /* families from the lexicon (single source of truth with the live engine) */
    var FAM_GENERIC={ cable:1, audio:1, switch:1, connector:1, mic:1, aux:1, adapter:1, converter:1, extender:1, case:1 };
    L.taxonomy.families.forEach(function(f){
      var cues=(f.nameCues||[]).filter(function(c){ return !FAM_GENERIC[c]; }).concat([f.label, f.plural]).filter(Boolean);
      cues.forEach(function(c){ if(c.indexOf(' or ')>=0||c.indexOf('/')>=0) return; var tt=tokTexts(c); if(!tt.length||!notSense(c)) return;
        add(tt,{ type:'FAMILY', value:{ family:f.id, subtype:null }, prio:PRIO.FAMILY }); var pl=tt.slice(0,-1).concat([plural(tt[tt.length-1])]); add(pl,{ type:'FAMILY', value:{ family:f.id, subtype:null }, prio:PRIO.FAMILY }); });
      (f.subtypes||[]).forEach(function(st){ if(st.label && st.label.indexOf('/')<0){ var tt=tokTexts(st.label); add(tt,{ type:'FAMILY', value:{ family:f.id, subtype:st.id }, prio:PRIO.FAMILY+0.5 }); add(tt.slice(0,-1).concat([plural(tt[tt.length-1])]),{ type:'FAMILY', value:{ family:f.id, subtype:st.id }, prio:PRIO.FAMILY+0.5 }); } });
    });
    add('audio cable',{ type:'FAMILY', value:{ family:'audio_cable', subtype:null }, prio:PRIO.FAMILY }); add('audio cables',{ type:'FAMILY', value:{ family:'audio_cable', subtype:null }, prio:PRIO.FAMILY });
    add('aux cable',{ type:'FAMILY', value:{ family:'audio_cable', subtype:null }, prio:PRIO.FAMILY });
    add('microphone',{ type:'FAMILY', value:{ family:'microphone', subtype:null }, prio:PRIO.FAMILY });
    ['sd card reader','tf card reader','micro sd card reader','sd/tf card reader','sd reader','card readers'].forEach(function(w){ add(w,{ type:'FAMILY', value:{ family:'card_reader', subtype:null }, prio:PRIO.FAMILY }); });
    L.aliases.forEach(function(al){
      var to=String(al.to), tt=tokTexts(al.term); if(!tt.length||!notSense(al.term)) return;
      if(al.relation==='related'||al.relation==='notEquivalent'){ return; }
      var parts=to.split('.');
      if(parts[0]==='connector') add(tt,{ type:'CONNECTOR', value:{ id:parts[1] }, prio:PRIO.CONNECTOR });
      else if(parts[0]==='flag') add(tt,{ type:'FEATURE', value:{ id:parts[1] }, prio:PRIO.FEATURE });
      else if(!FAM_GENERIC[al.term]){ add(tt,{ type:'FAMILY', value:{ family:parts[0], subtype:parts[1]||null }, prio:PRIO.FAMILY });
        if(tt.length) add(tt.slice(0,-1).concat([plural(tt[tt.length-1])]),{ type:'FAMILY', value:{ family:parts[0], subtype:parts[1]||null }, prio:PRIO.FAMILY }); }
    });
    Object.keys(FORM_WORDS).forEach(function(k){ FORM_WORDS[k].forEach(function(w){ add(w,{ type:'FORM', value:{ form:k }, prio:PRIO.FORM }); }); });
    Object.keys(O.NAMED_DEVICES).forEach(function(id){ O.NAMED_DEVICES[id].words.forEach(function(w){ add(w,{ type:'DEVICE', value:{ id:id }, prio:PRIO.DEVICE }); }); });
    (L.followUpCues||[]).forEach(function(w){ if(tokTexts(w).length>=2 && notSense(w)) add(w,{ type:'FOLLOWUP', value:{ cue:w }, prio:PRIO.DISCOURSE }); });
    ['how about','what about','e yung','eh yung','e kung','eh kung','paano kung','paano naman','e di','with a','with my','sa may'].forEach(function(w){ add(w,{ type:'FOLLOWUP', value:{ cue:w }, prio:PRIO.DISCOURSE }); });
    Object.keys(O.METRIC_WORDS).forEach(function(m){ O.METRIC_WORDS[m].forEach(function(w){ if(tokTexts(w).length===1 && notSense(w)) add(w,{ type:'METRIC', value:{ metric:m, word:w }, prio:PRIO.COLOR }); }); });
    Object.keys(O.METRIC_POLARITY).forEach(function(w){ add(w,{ type:'METRIC', value:{ metric:O.METRIC_POLARITY[w][0], dir:O.METRIC_POLARITY[w][1], word:w }, prio:PRIO.COLOR }); });
    /* v2-2B structural classes (word classes only; meaning is assigned by scope() from the span sequence) */
    O.NEGATION.clear.forEach(function(w){ add(w,{ type:'NEG', value:{ neg:true, cls:'clear' }, prio:PRIO.NEG }); });
    O.NEGATION.existential.forEach(function(w){ add(w,{ type:'NEG', value:{ neg:true, cls:'existential' }, prio:PRIO.NEG }); });
    O.NEGATION.relax.forEach(function(w){ add(w,{ type:'RELAXNEG', value:{ cue:w }, prio:PRIO.NEG }); });
    O.NEGATION.epistemic.forEach(function(w){ add(w,{ type:'EPISTEMIC', value:{ cue:w }, prio:PRIO.NEG }); });
    O.QUANTIFIERS.forEach(function(w){ add(w,{ type:'QUANT', value:{ q:w }, prio:PRIO.NEG }); });
    O.RELAX_AFTER.forEach(function(w){ add(w,{ type:'RELAXCUE', value:{ cue:w }, prio:PRIO.NEG }); });
    Object.keys(O.ORDINALS).forEach(function(w){ add(w,{ type:'ORDINAL', value:{ n:O.ORDINALS[w] }, prio:PRIO.FEATURE }); });
    O.LAST_WORDS.forEach(function(w){ add(w,{ type:'ORDLAST', value:{ word:w }, prio:PRIO.FEATURE }); });
    ['other','results'].forEach(function(k){ O.REF_KIND[k].forEach(function(w){ add(w,{ type:'REF', value:{ ref:w, kind:k }, prio:PRIO.REF-1 }); }); });
    O.SELECT_CUES.forEach(function(w){ add(w,{ type:'FOLLOWUP', value:{ cue:w, select:true }, prio:PRIO.DISCOURSE }); });
    Object.keys(O.COMPARE_MORE).concat(['another']).forEach(function(w){ if(w!=='more') add(w,{ type:'FUNCTION', value:{ role:'comparative' }, prio:PRIO.FUNCTION }); });
    Object.keys(GENDER_WORDS).forEach(function(w){ add(w,{ type:'GENDER', value:{ g:GENDER_WORDS[w] }, prio:PRIO.GENDER }); });
    O.DISCOURSE.forEach(function(w){ if(notSense(w)) add(w,{ type:'DISCOURSE', value:{ id:w }, prio:PRIO.DISCOURSE }); });
    O.REFERENCE.forEach(function(w){ add(w,{ type:'REF', value:{ ref:w }, prio:PRIO.REF }); });
    O.FUNCTION_WORDS.forEach(function(w){ if(notSense(w)) add(w,{ type:'FUNCTION', value:{ role:'grammar' }, prio:PRIO.FUNCTION }); });
    ['setup','items','item','products','product','options','option','klase','kind','type','types','unit','units','model','models','piece','pcs',
     'ba','kaya','pwede','puwede','po','nalang','lang','muna','gusto','sana','pang','current','pricelist','price list','listahan','natin','ninyo','nyo','niyo','nyo ba',
     'tayo','kayo','meron','ganito','ganyan','na','mo','yon','dun','doon','pls','thank','hm','hmm','pala','oh','okay'].forEach(function(w){ add(w,{ type:'FUNCTION', value:{ role:'grammar' }, prio:PRIO.FUNCTION+1 }); });
    VOC={ lex:L, trie:trie, single:single, senseTerms:senseTerms, FORM_NAME_RE:FORM_NAME_RE };
    VOC_FOR=O; return VOC;
  }

  /* =====================================================================================================
     C. CATALOG INDEX + TYPED PRODUCT GRAPH (data-driven; memoized per facts index)
     ===================================================================================================== */
  var CAT=null, CAT_KEY=null;
  /* everyday descriptive words: never a product-line name on their own */
  var GENERIC_EN=('small large big little mini portable compact slim thin light lightweight heavy home office desk outdoor indoor smart premium classic basic standard '+
    'new original official genuine fast quick strong durable soft hard black white gray grey blue red green pink purple silver gold beige '+
    'travel car wall desktop kids kid adult men women unisex pocket multi universal foldable magnetic wireless wired stereo mono digital analog '+
    'clear transparent matte glossy round flat long short mega ultra super extra plus series edition version design style model type').split(' ');
  var MODS={ pro:1, plus:1, mini:1, max:1, air:1, lite:1, ultra:1, se:1, neo:1, n:1, x:1, s:1, go:1, duo:1, slim:1, nano:1 };
  function nameTokens(raw){ return tokenize(normalizeQ(raw),null); }
  function connScan(toks){ /* connectors found in a token sequence (name grammar), with positions + versions */
    var V=compileVocab(), O=ONT(), out=[];
    /* V2-2C C1 (review fix): a stated USB Gen ("USB 3.2 Gen 2", "USB-C 3.1 GEN2", "Gen 2x2") is part of the stated version */
    function genAfter(k,ver){ if(!/^(3\.1|3\.2)$/.test(ver||'')) return null; var a=toks[k], b=toks[k+1], m;
      if(a && a.t==='gen' && b && b.k==='num' && /^[12]$/.test(b.t)) return { v:ver+'g'+b.t, n:2 };
      if(a && (m=a.t.match(/^gen(\d)x(\d)$/)) && ver==='3.2') return { v:'3.2g'+m[1]+'x'+m[2], n:1 }; return null; }
    for(var i=0;i<toks.length;i++){
      var t=toks[i];
      if(t.t==='usb' && toks[i+1] && toks[i+1].k==='num' && /^(2\.0|3\.0|3\.1|3\.2)$/.test(toks[i+1].t)){
        var uv=toks[i+1].t, ug=genAfter(i+2,uv), uj=i+2; if(ug){ uv=ug.v; uj+=ug.n; }
        var nx=toks[uj]&&toks[uj].t; if(nx==='a'||nx==='c'){ out.push({ id:nx==='a'?'usb_a':'usb_c', ver:uv, at:i, end:uj+1 }); i=uj; continue; }
        out.push({ id:'usb', ver:uv, at:i, end:uj }); i=uj-1; continue; }
      var node=V.trie, best=null;
      for(var j=i;j<toks.length;j++){ node=node.c[toks[j].t]; if(!node) break; if(node.e){ var ce=node.e.filter(function(e){ return e.type==='CONNECTOR'||(e.type==='AMBIG'&&e.value==='dp'); })[0]; if(ce) best={ e:ce, end:j+1 }; } }
      if(best){ var id=best.e.type==='AMBIG'?'dp':best.e.value.id, ver=null;
        var vt=toks[best.end]; if(vt && vt.k==='num' && O.CONNECTORS[id] && (O.CONNECTORS[id].versions||[]).indexOf(vt.t)>=0){ ver=vt.t; best.end++;
          if(O.interfaceOf(id)==='usb'){ var cg=genAfter(best.end,ver); if(cg){ ver=cg.v; best.end+=cg.n; } } }
        /* v2-2B: PCIe versions are canonical generations ("PCI-E3.0" = "Gen 3"; "PCIe Gen 4" = "4.0") */
        if(id==='pcie'){ if(!ver && vt && vt.t==='gen' && toks[best.end+1] && toks[best.end+1].k==='num'){ ver='gen'+toks[best.end+1].t; best.end+=2; } else if(!ver && vt && vt.k==='num'){ ver=vt.t; best.end++; } ver=ver?O.canonVersion('pcie',ver):null; }
        out.push({ id:id, ver:ver, at:i, end:best.end }); i=best.end-1; }
    }
    /* V2-2C C1 (review R2-2): a GEN token later in the name ("USB-C 3.1 Male To Male GEN1") binds to the name's single USB 3.1 / 3.2
       version when nothing else in the name can own it (no PCIe, exactly one ungenned USB 3.x) */
    var u3=out.filter(function(c){ return O.interfaceOf(c.id)==='usb' && /^(3\.1|3\.2)$/.test(c.ver||''); });
    if(u3.length===1 && !out.some(function(c){ return c.id==='pcie' || (O.interfaceOf(c.id)==='usb' && /g/.test(c.ver||'')); })){
      for(var gi=u3[0].end;gi<toks.length;gi++){ var lg=genAfter(gi,u3[0].ver); if(lg){ u3[0].ver=lg.v; break; } } }
    return out;
  }
  function graphNode(F,p,O){
    var raw=String(p.product_name||''), nt=nameTokens(raw), lname=normalizeQ(raw), feat=normalizeQ(p.features||'');
    var conns=connScan(nt), toAt=-1;
    for(var i=1;i<nt.length-1;i++){ if(TO_WORDS[nt[i].t] && !(nt[i-1].k==='num' && nt[i+1].k==='num')){ toAt=i; break; } }
    var withAt=-1; nt.forEach(function(t,i){ if(withAt<0 && (t.t==='with'||t.t==='plus') ) withAt=i; });
    var main=[], power=[], from=[], to=[], versions={};
    conns.forEach(function(c){
      if(c.ver) versions[c.id]=c.ver;
      var after=nt.slice(c.end,c.end+3).map(function(x){ return x.t; }).join(' ');
      var isPower=/^(?:female )?(?:power|pd|charging|dc)(?: delivery)? (?:port|input|in)\b/.test(after+' ');
      if(isPower) power.push(c.id); else main.push(c.id);
      if(toAt>=0){ if(c.at<toAt) from.push(c.id); else if(!isPower) to.push(c.id); }
    });
    var gender=/\bmale to male\b|\bfemale to female\b/.test(lname);
    /* direction: a passive plug-to-plug cable (charging / data / audio) connects either way round, so "A to B cable" = "B to A cable";
       converters, adapters with a female end and video cables keep their direction (HDMI -> VGA is not VGA -> HDMI) */
    var passive=/\bcables?\b/.test(lname) && !/\bfemale\b|\badapt[eo]r\b|\bconverter\b/.test(lname) && !/^(video_cable|video_adapter|capture_card)$/.test(F.type.family);
    var pair=null; if(toAt>=0 && from.length){ pair={ from:uniq(from), to:uniq(to.length?to:(gender?from:[])), bidi:/\bbi-?directional\b/.test(lname)||passive }; }
    /* features: NAME (strong) then FEATURES lines (medium); negative pattern = contradiction */
    var feats={};
    Object.keys(O.FEATURES).forEach(function(id){
      var fd=O.FEATURES[id], re=new RegExp(fd.evidence), neg=fd.negative?new RegExp(fd.negative):null;
      if(neg && neg.test(lname)) feats[id]={ state:'CONTRADICTED', tier:'strong', src:'name' };
      else if(re.test(lname)) feats[id]={ state:'CONFIRMED', tier:'strong', src:'name' };
      else if(neg && neg.test(feat)) feats[id]={ state:'CONTRADICTED', tier:'medium', src:'features' };
      else if(re.test(feat)) feats[id]={ state:'CONFIRMED', tier:'medium', src:'features' };
    });
    if(F.attrs && F.attrs.flags){ Object.keys(F.attrs.flags).forEach(function(k){ var fl=F.attrs.flags[k]; if(fl && fl.confirmed && O.FEATURES[k] && !feats[k]) feats[k]={ state:'CONFIRMED', tier:fl.tier, src:'facts' }; }); }
    if(feats.without_audio && feats.without_audio.state==='CONFIRMED') feats.audio={ state:'CONTRADICTED', tier:'strong', src:'name' };
    if(power.length && !(feats.power_port && feats.power_port.tier==='strong')) feats.power_port={ state:'CONFIRMED', tier:'strong', src:'name' };
    /* device targets ("for iPad", "for MacBook", "for car") */
    var targets=[], m, tre=/\bfor ([a-z0-9 ]{2,30})/g;
    while((m=tre.exec(lname))){ var seg=' '+m[1]+' ';
      Object.keys(O.NAMED_DEVICES).forEach(function(id){ O.NAMED_DEVICES[id].words.forEach(function(w){ if(seg.indexOf(' '+w+' ')>=0) targets.push(id); }); });
      Object.keys(O.DEVICE_CLASSES).forEach(function(id){ O.DEVICE_CLASSES[id].aliases.forEach(function(w){ if(seg.indexOf(' '+w+' ')>=0) targets.push('class:'+id); }); }); }
    Object.keys(O.NAMED_DEVICES).forEach(function(id){ O.NAMED_DEVICES[id].words.forEach(function(w){ if(new RegExp('\\b'+esc(w)+'\\b').test(lname)) targets.push(id); }); });
    /* size (inch) ranges in the name */
    var IN_RE='(?:inch|in\\b(?![\\s-]?1\\b)|")';
    var size=null, sm=lname.match(new RegExp('(\\d{1,2}(?:\\.\\d)?)"?\\s?(?:-|~|to)\\s?(\\d{1,2}(?:\\.\\d)?)[\\s-]?'+IN_RE))||lname.match(new RegExp('(\\d{1,2}(?:\\.\\d)?)[\\s-]?'+IN_RE));
    if(sm) size={ lo:parseFloat(sm[1]), hi:parseFloat(sm[2]||sm[1]) };
    if(!size){ var sd=lname.match(/\b(2\.5|3\.5)\b(?=.*\b(?:hdd|ssd|sata|hard drive|enclosure|drive)\b)/); if(sd) size={ lo:+sd[1], hi:+sd[1] }; }
    var A=F.attrs||{}, pv=A.ports&&A.ports.value;
    var nIn1=(lname.match(/(\d{1,2})[\s-]?in[\s-]?1\b/)||[])[1];
    var plugs=pair?pair.from.slice():uniq(main);
    /* v2-2B: PCIe lane width from the name (only where the name carries PCIe) */
    var lanes=null; if(uniq(main.concat(power)).indexOf('pcie')>=0) nt.forEach(function(t){ var lm=t.t.match(/^x(\d{1,2})$/); if(lanes==null && lm && O.LANE_WIDTHS.indexOf(+lm[1])>=0) lanes=+lm[1]; });
    return { code:F.code, model:F.model, family:F.type.family, plug:plugs[0]||null, plugs:plugs, subtype:F.type.subtype||null, name:raw, lname:lname, ntoks:nt.map(function(x){ return x.t; }),
      conns:{ main:uniq(main), power:uniq(power), all:uniq(main.concat(power)), feat:(A.connectors&&A.connectors.value||[]).filter(function(k){ return (A.connectors.named||[]).indexOf(k)<0; }) },
      pair:pair, versions:versions, lanes:lanes, feats:feats, targets:uniq(targets), size:size,
      hzRes:(A.video&&A.video.mentions||[]).filter(function(m){ return m.confirmed && m.hz; }).map(function(m){ return { r:m.r, hz:m.hz }; }),
      watts:A.watts?A.watts.value:null, mah:A.mah?A.mah.value:null, lengthM:A.lengthM?A.lengthM.value:null,
      ports:pv?{ total:pv.total!=null?pv.total:null, byKind:pv.byKind||null }:null, in1:nIn1?+nIn1:null, bays:A.nas&&A.nas.bays!=null?A.nas.bays:null,
      gbps:A.dataGbps?A.dataGbps.value:null, ethGbps:A.ethGbps?A.ethGbps.value:null, res:A.video&&A.video.value?A.video.value.maxRes:null,
      color:String(p.color||'').toLowerCase().replace(/grey/g,'gray'), srp:num(p.srp), dp:num(p.dp), dpVol:num(p.dp_volume), moq:num(p.moq),
      category:String(p.category||''), section:String(p.sheet_display||'') };
  }
  /* every token of every NAME-guard class (VeroOntology.NAME_GUARD_CLASSES) */
  function nameGuard(){ var O=ONT(), g={}; Object.keys(O.NAME_GUARD_CLASSES).forEach(function(k){ O.NAME_GUARD_CLASSES[k].forEach(function(w){ tokTexts(w).forEach(function(t){ g[t]=1; }); }); }); return g; }
  /* V2-2C C1 (QA F4.5): the facts key excludes prices, so a cache hit must still re-read SRP / DP / DP Volume / MOQ when they
     changed in memory (a price edit keeps the facts key). Prices are refreshed in place; the graph is not rebuilt. */
  function priceSig(products){ var h=0, s, i, j; for(i=0;i<(products||[]).length;i++){ var p=products[i]; if(!p) continue; s=String(p.item_code)+'|'+p.srp+'|'+p.dp+'|'+p.dp_volume+'|'+p.moq+'|'+(p.disabled?1:0)+';'; for(j=0;j<s.length;j++) h=((h<<5)-h+s.charCodeAt(j))|0; } return h; }
  function refreshPrices(C,products){ (products||[]).forEach(function(p){ if(!p||p.disabled) return; var c=String(p.item_code), g=C.G[c]; if(!g) return; C.byCode[c]=p; g.srp=num(p.srp); g.dp=num(p.dp); g.dpVol=num(p.dp_volume); g.moq=num(p.moq); }); }
  function catalog(facts,products){
    var key=facts&&facts.key, ps=priceSig(products);
    if(CAT && CAT_KEY===key && CAT.n===(products||[]).length){ if(CAT.priceSig!==ps){ refreshPrices(CAT,products); CAT.priceSig=ps; } return CAT; }
    var t0=now(), O=ONT(), L=LEX(); compileVocab();
    var byCode={}, codes={}, models={}, order=[], G={};
    (products||[]).forEach(function(p){ if(!p||p.disabled) return; var c=String(p.item_code); byCode[c]=p; order.push(c);
      codes[c.toLowerCase()]=c;
      var m=String(p.model||'').trim().toLowerCase(); if(m){ var m1=m.split(/\s+/)[0]; if(/\d/.test(m1)&&m1.length>=3){ (models[m1]=models[m1]||[]).push(c); }
        var mf=m.replace(/\s+/g,''); if(mf!==m1 && /\d/.test(mf)) (models[mf]=models[mf]||[]).push(c); } });
    var cat={ codes:codes, models:models };
    order.forEach(function(c){ var F=facts.byCode[c]; if(F) G[c]=graphNode(F,byCode[c],O); });
    /* name index: distinctive name tokens (not ontology / lexicon vocabulary, not frequent) and line phrases */
    var V=compileVocab(), freq={};
    order.forEach(function(c){ if(!G[c]) return; uniq(G[c].ntoks).forEach(function(t){ freq[t]=(freq[t]||0)+1; }); });
    var generic={}; (L.nameGeneric||[]).concat(GENERIC_EN).forEach(function(w){ generic[w]=1; });
    /* v2-2B NAME guard: stock / reference / discourse / function / quantifier / negator / ordinal / interface / lane words are never name tokens */
    var GUARD=nameGuard(); function isGeneric(t){ return GUARD[t] || generic[t] || V.single[t] || /^\d/.test(t) || t.length<3 || freq[t]>30 || models[t] || codes[t]; }
    var phrases={}, distinct={};
    order.forEach(function(c){ var g=G[c]; if(!g) return; var tk=g.ntoks;
      for(var i=0;i<tk.length;i++){ if(isGeneric(tk[i]) || !/^[a-z][a-z0-9]*$/.test(tk[i])) continue; distinct[tk[i]]=1;
        var ph=[tk[i]]; (phrases[ph.join(' ')]=phrases[ph.join(' ')]||{})[c]=1;
        for(var j=i+1;j<tk.length && j<i+4;j++){ var w=tk[j]; if(MODS[w] || (!isGeneric(w) && /^[a-z][a-z0-9]*$/.test(w)) || /^[a-z]\d{1,2}$/.test(w) || /^\d{1,2}[a-z]?$/.test(w)){ ph.push(w); (phrases[ph.join(' ')]=phrases[ph.join(' ')]||{})[c]=1; } else break; } } });
    Object.keys(phrases).forEach(function(k){ phrases[k]=Object.keys(phrases[k]); });
    var nameTrie={ c:{}, e:null }; Object.keys(phrases).forEach(function(k){ trieAdd(nameTrie,k.split(' '),{ type:'NAME', value:{ phrase:k, codes:phrases[k] }, prio:PRIO.NAME }); });
    /* closed fuzzy vocabulary: single-token concept words + distinctive name tokens + models */
    var fuzzy={}; Object.keys(V.single).forEach(function(w){ if(w.length>=4 && /^[a-z]+$/.test(w)) fuzzy[w]='vocab'; });
    Object.keys(distinct).forEach(function(w){ if(w.length>=4) fuzzy[w]='name'; });
    var byFam={}; order.forEach(function(c){ var g=G[c]; if(g) (byFam[g.family]=byFam[g.family]||[]).push(c); });
    /* v2-2B: families of the products that carry each versioned-interface connector (data-derived) */
    var connFam={}; order.forEach(function(c){ var g=G[c]; if(!g) return; g.conns.all.forEach(function(k){ if(O.interfaceOf(k)) (connFam[k]=connFam[k]||{})[g.family]=1; }); }); Object.keys(connFam).forEach(function(k){ connFam[k]=Object.keys(connFam[k]); });
    CAT={ n:(products||[]).length, cat:cat, byCode:byCode, order:order, G:G, nameTrie:nameTrie, phrases:phrases, fuzzy:fuzzy, byFam:byFam, connFam:connFam, priceSig:ps, buildMs:Math.round(now()-t0) };
    CAT_KEY=key; return CAT;
  }

  /* =====================================================================================================
     D. SPAN RECOGNITION (longest match over typed tokens) + composites
     ===================================================================================================== */
  function dl1(a,b){ /* Damerau-Levenshtein (OSA) distance, early exit above 1 */
    if(a===b) return 0; var la=a.length, lb=b.length; if(Math.abs(la-lb)>1) return 2;
    var d=[], i, j; for(i=0;i<=la;i++){ d[i]=[i]; } for(j=0;j<=lb;j++) d[0][j]=j;
    for(i=1;i<=la;i++){ var rowMin=99; for(j=1;j<=lb;j++){ var cost=a[i-1]===b[j-1]?0:1;
      d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+cost);
      if(i>1&&j>1&&a[i-1]===b[j-2]&&a[i-2]===b[j-1]) d[i][j]=Math.min(d[i][j],d[i-2][j-2]+cost);
      if(d[i][j]<rowMin) rowMin=d[i][j]; } if(rowMin>1) return 2; }
    return d[la][lb];
  }
  function trieMatches(trie,toks,i,useBase){
    var out=[], node=trie;
    for(var j=i;j<toks.length;j++){ var t=toks[j].t; var nx=node.c[t];
      if(!nx && useBase && toks[j].base) nx=node.c[toks[j].base];
      if(!nx) break; node=nx; if(node.e) out.push({ from:i, to:j+1, entries:node.e }); }
    return out;
  }
  function composites(toks,C){ /* lexer-level composite spans: numeric+unit, port counts, prices, ratios, versioned connectors */
    var O=ONT(), out=[];
    function cand(from,to,type,value,extra){ var c={ from:from, to:to, entries:[{ type:type, value:value, prio:PRIO.COMPOSITE }] }; if(extra) for(var k in extra) c[k]=extra[k]; out.push(c); }
    for(var i=0;i<toks.length;i++){
      var t=toks[i], n1=toks[i+1], n2=toks[i+2], n3=toks[i+3];
      if(t.t==='usb' && n1 && n1.k==='num' && /^(2\.0|3\.0|3\.1|3\.2)$/.test(n1.t)){
        if(n2 && (n2.t==='a'||n2.t==='c')) cand(i,i+3,'CONNECTOR',{ id:n2.t==='a'?'usb_a':'usb_c', ver:n1.t });
        else cand(i,i+2,'CONNECTOR',{ id:'usb', ver:n1.t }); }
      if(t.k==='word' && n1 && n1.k==='num'){ /* connector + version ("hdmi 2.1", "dp 1.4", "thunderbolt 4") */
        Object.keys(O.CONNECTORS).forEach(function(id){ var cd=O.CONNECTORS[id]; if((cd.versions||[]).indexOf(n1.t)>=0 && cd.aliases.indexOf(t.t)>=0) cand(i,i+2,'CONNECTOR',{ id:id, ver:n1.t, versionSyntax:true }); }); }
      if(t.k==='word' && /^(cat)$/.test(t.t) && n1 && n1.k==='num'){ var sid='cat'+n1.t+(n2&&n2.t==='e'?'e':''); if(O.STANDARDS[sid]) cand(i,n2&&n2.t==='e'?i+3:i+2,'STANDARD',{ id:sid }); }
      if(/^(top|first|unang)$/.test(t.t) && n1 && n1.k==='num' && n1.v<=20){ cand(i,i+2,'LIMIT',{ n:n1.v }); }
      /* v2-2B: a generation notation ("Gen 4", "gen4", "gen2x2"): raw until an interface is bound (BA1) */
      if(t.t==='gen' && n1 && n1.k==='num' && /^\d$/.test(n1.t)) cand(i,i+2,'VERSION',{ raw:'gen'+n1.t });
      if(/^gen\dx\d$/.test(t.t)) cand(i,i+1,'VERSION',{ raw:t.t });
      /* V2-2C C1: "tb3" / "tb4" / "tb 5" = Thunderbolt with a version; a bare "tb" is never Thunderbolt */
      if(t.t==='tb' && n1 && n1.k==='num' && /^[345]$/.test(n1.t)) cand(i,i+2,'CONNECTOR',{ id:'thunderbolt', ver:n1.t, versionSyntax:true });
      if(t.t==='₱' && n1 && n1.k==='num'){ var kk=n2&&n2.t==='k'; cand(i,kk?i+3:i+2,'PRICE',{ op:'=', v:n1.v*(kk?1000:1) }); }
      if(t.k!=='num') continue;
      var v=t.v;
      /* N to M (splitter ratio) */
      if(n1 && TO_WORDS[n1.t] && n2 && n2.k==='num'){ cand(i,i+3,'RATIO',{ a:v, b:n2.v }); }
      /* N users / persons (sizing for a recommendation) */
      if(n1 && /^(users?|tao|persons?|people|katao|employees?|staff)$/.test(n1.t)){ cand(i,i+2,'USERS',{ n:v }); }
      /* N-in-1 */
      if(n1 && n1.t==='in' && n2 && (n2.t==='1'||n2.t==='one')){ cand(i,i+3,'PORTCOUNT',{ n:v, in1:true }); }
      /* N port(s) */
      if(n1 && (n1.t==='port'||n1.t==='ports'||n1.t==='portes')){ cand(i,i+2,'PORTCOUNT',{ n:v }); }
      /* N (x|*)? connector -> counted connector (handled in grammar) */
      /* price: N pesos / php / k with price context handled by sense; plain "N pesos" here */
      if(n1 && /^(php|peso|pesos|p)$/.test(n1.t) && !(n1.t==='p' && RES_TOKENS[t.t+'p'])) cand(i,i+2,'PRICE',{ op:'=', v:v });
      /* N unit */
      if(n1 && n1.k==='word'){
        var u=null, len=2;
        Object.keys(O.UNITS).forEach(function(id){ if(u) return; if(id==='port'||id==='in1'||id==='peso') return;
          O.UNITS[id].aliases.forEach(function(a){ if(u) return; var at=tokTexts(a); if(!at.length) return; var ok=true; for(var q=0;q<at.length;q++){ var tq=toks[i+1+q]; if(!tq||tq.t!==at[q]){ ok=false; break; } } if(ok){ u=id; len=1+at.length; } }); });
        if(n1.t==='k' && n2 && (n2.t==='mah')){ u='mAh'; len=3; v=v*1000; }
        if(u==='mm' && (v===3.5||v===6.35||v===2.5||v===6.5)) u=null; /* audio jack sizes are connectors, not lengths */
        if(u==='inch' && n1.t==='in' && !(n2 && /^(laptop|monitor|tablet|sleeve|bag|screen|drive|hdd|ssd|display|macbook)/.test(n2.t)) && !(toks[i-1] && /^(laptop|monitor|tablet|sleeve|bag)$/.test(toks[i-1].t))) u=null;
        if(u==='k' && n2 && n2.k==='num' && [24,30,60,75,90,120,144,165,240].indexOf(n2.v)>=0 && (v===2||v===4||v===5||v===8)){ cand(i,(n3&&n3.t==='hz')?i+4:i+3,'RES',{ rank:RES_TOKENS[v+'k'], text:v+'k', hz:n2.v }); }
        if(u==='k'){ var vidCtx=/\b(hdmi|dp|displayport|monitor|monitors|display|resolution|video|hz|tv|capture|webcam|projector|8k|4k|screen|cable)\b/.test(toks.map(function(x){ return x.t; }).join(' '));
          if(vidCtx && (v===2||v===4||v===5||v===8)) cand(i,i+2,'RES',{ rank:RES_TOKENS[v+'k'], text:v+'k' }); u=null; }
        if(u){ var ud=O.UNITS[u]; cand(i,i+len,'NUMUNIT',{ unit:u, dim:ud.dim, v:v*(ud.factor||1), raw:v }); }
      }
    }
    /* price operators: under / below / budget N[k] */
    Object.keys(PRICE_OPS).forEach(function(op){ var at=tokTexts(op);
      for(var i=0;i<toks.length;i++){ var ok=true; for(var q=0;q<at.length;q++){ if(!toks[i+q]||toks[i+q].t!==at[q]){ ok=false; break; } } if(!ok) continue;
        var j=i+at.length; if(toks[j] && toks[j].t==='₱') j++; if(toks[j] && toks[j].k==='num'){ var val=toks[j].v, end=j+1; if(toks[end]&&toks[end].t==='k'){ val*=1000; end++; }
          if(toks[end] && /^(mah|w|watts|m|meters|gb|tb)$/.test(toks[end].t)) continue;
          if(val>=50 || end>j+1 || toks[j-1].t==='₱') cand(i,end,'PRICE',{ op:PRICE_OPS[op], v:val }); } } });
    return out;
  }
  function recognize(norm,toks,C,opts){
    var V=compileVocab(), O=ONT(), cands=composites(toks,C);
    for(var i=0;i<toks.length;i++){
      var t=toks[i];
      if(t.k==='code'){ var codes=C.cat.codes[t.t]?[C.cat.codes[t.t]]:(C.cat.models[t.t]||[]); cands.push({ from:i, to:i+1, entries:[{ type:'ANCHOR', value:{ kind:C.cat.codes[t.t]?'sku':'model', key:t.t, codes:codes }, prio:PRIO.ANCHOR }] }); continue; }
      /* v2-2B: a lane-width token ("x4", "x16"); scope() keeps it only in PCIe scope (BA7) */
      var lm=t.k==='word' && t.t.match(/^x(\d{1,2})$/); if(lm && O.LANE_WIDTHS.indexOf(+lm[1])>=0) cands.push({ from:i, to:i+1, entries:[{ type:'LANES', value:{ n:+lm[1] }, prio:PRIO.COMPOSITE }] });
      trieMatches(V.trie,toks,i,true).forEach(function(m){ cands.push(m); });
      trieMatches(C.nameTrie,toks,i,false).forEach(function(m){ cands.push(m); });
      /* named device + its own model modifiers ("macbook air", "iphone 15 pro max") */
      var dm=trieMatches(V.trie,toks,i,false).filter(function(m){ return m.entries.some(function(e){ return e.type==='DEVICE'; }); }).pop();
      if(dm){ var dev=dm.entries.filter(function(e){ return e.type==='DEVICE'; })[0].value.id, mods=O.NAMED_DEVICES[dev].mods.map(function(x){ return new RegExp('^'+x+'$'); }), j=dm.to, absorbed=[];
        while(j<toks.length && (mods.some(function(re){ return re.test(toks[j].t); }))){ absorbed.push({ word:toks[j].t, sense:'device.mod' }); j++; }
        var st=i, pre=(O.NAMED_DEVICES[dev].prefixMods||[]); while(st>0 && pre.indexOf(toks[st-1].t)>=0){ st--; absorbed.unshift({ word:toks[st].t, sense:'device.mod(prefix)' }); }
        cands.push({ from:st, to:j, entries:[{ type:'DEVICE', value:{ id:dev }, prio:PRIO.DEVICE }], absorbed:absorbed }); }
    }
    /* selection: longest first, then priority, then leftmost */
    cands.forEach(function(c){ c.entries=c.entries.slice().sort(function(a,b){ return a.prio-b.prio || ((b.value&&b.value.subtype)?1:0)-((a.value&&a.value.subtype)?1:0); }); c.best=c.entries[0]; });
    cands.sort(function(a,b){ return (b.to-b.from)-(a.to-a.from) || a.best.prio-b.best.prio || a.from-b.from; });
    var taken=[], spans=[];
    cands.forEach(function(c){ for(var k=c.from;k<c.to;k++) if(taken[k]) return; for(k=c.from;k<c.to;k++) taken[k]=true;
      var alts=uniq(c.entries.slice(1).map(function(e){ return e.type+':'+JSON.stringify(e.value).slice(0,60); }));
      /* same-range alternatives of other candidates (e.g. NAME vs FAMILY) */
      cands.forEach(function(o){ if(o!==c && o.from===c.from && o.to===c.to) o.entries.forEach(function(e){ alts.push(e.type+':'+JSON.stringify(e.value).slice(0,60)); }); });
      var sp={ type:c.best.type, value:c.best.value, from:c.from, to:c.to, alts:uniq(alts).filter(function(a){ return a.indexOf(c.best.type+':'+JSON.stringify(c.best.value).slice(0,60))!==0; }) };
      if(c.absorbed&&c.absorbed.length) sp.absorbed=c.absorbed;
      spans.push(sp); });
    /* name phrases absorb line modifiers -> record the sense decision */
    spans.forEach(function(s){ if(s.type==='NAME'){ var w=s.value.phrase.split(' ').slice(1).filter(function(x){ return MODS[x]; }); if(w.length) s.absorbed=w.map(function(x){ return { word:x, sense:'line.'+x }; }); } });
    /* uncovered tokens: numbers, symbols, fuzzy, unknown */
    for(i=0;i<toks.length;i++){ if(taken[i]) continue; t=toks[i];
      if(t.k==='sym'){ spans.push({ type:t.t==='+'?'FUNCTION':'SYM', value:{ sym:t.t, role:t.t==='+'?'and':'punct' }, from:i, to:i+1 }); continue; }
      if(t.k==='num'){ spans.push({ type:'NUMBER', value:{ v:t.v }, from:i, to:i+1 }); continue; }
      var fz=fuzzyMatch(t.base||t.t,C,V);
      if(fz){ var fm=trieMatches(V.trie,[{ t:fz.word }],0,false).concat(trieMatches(C.nameTrie,[{ t:fz.word }],0,false))[0];
        if(fm){ var e=fm.entries.slice().sort(function(a,b){ return a.prio-b.prio; })[0]; spans.push({ type:e.type, value:e.value, from:i, to:i+1, fuzzy:{ from:t.t, to:fz.word }, conf:0.7 }); continue; } }
      spans.push({ type:'UNKNOWN', value:{ word:t.t }, from:i, to:i+1 });
    }
    spans.sort(function(a,b){ return a.from-b.from; });
    spans.forEach(function(s,k){ s.id='s'+k; s.text=toks.slice(s.from,s.to).map(function(x){ return x.t; }).join(' '); s.chars=[toks[s.from].from,toks[s.to-1].to]; if(s.conf==null) s.conf=1; });
    return spans;
  }
  function fuzzyMatch(w,C,V){
    if(!w || w.length<5 || !/^[a-z]+$/.test(w)) return null;
    var hits=[]; Object.keys(C.fuzzy).forEach(function(x){ if(Math.abs(x.length-w.length)<=1 && x[0]===w[0] && dl1(w,x)===1) hits.push(x); });
    if(hits.length===1) return { word:hits[0] };
    return null;
  }

  /* =====================================================================================================
     E. CONTEXTUAL SENSE RESOLVER
     ===================================================================================================== */
  function senseScore(sense,ctx){
    var sc=sense.prior||0, fired=[];
    (sense.signals||[]).forEach(function(sg){
      var hit=false;
      if(sg.near) hit=sg.near.some(function(w){ return ctx.nearText.indexOf(' '+w+' ')>=0; });
      else if(sg.nextWord) hit=sg.nextWord.indexOf(ctx.nextWord)>=0 || (sg.nextWord.indexOf('?')>=0 && ctx.nextWord==='?');
      else if(sg.prevWord) hit=sg.prevWord.indexOf(ctx.prevWord)>=0;
      else if(sg.nextType) hit=sg.nextType.indexOf(ctx.nextType)>=0;
      else if(sg.prevType) hit=sg.prevType.indexOf(ctx.prevType)>=0;
      else if(sg.hasType) hit=sg.hasType.some(function(t){ return ctx.types[t]; });
      else if(sg.nextNumber) hit=ctx.nextIsNum; else if(sg.prevNumber) hit=ctx.prevIsNum;
      else if(sg.versionNext) hit=ctx.versionNext;
      else if(sg.subjectFamily) hit=!!ctx.subjFam && sg.subjectFamily.indexOf(ctx.subjFam)>=0;
      else if(sg.subjectFamilyNot) hit=!!ctx.subjFam && sg.subjectFamilyNot.indexOf(ctx.subjFam)<0;
      else if(sg.atEnd) hit=ctx.atEnd; else if(sg.atStart) hit=ctx.atStart;
      else if(sg.ctxField) hit=!!ctx.prevField && sg.ctxField.indexOf(ctx.prevField)>=0;
      if(hit){ sc+=sg.w; fired.push(Object.keys(sg).filter(function(k){ return k!=='w'; })[0]+(sg.w>0?'+':'')+sg.w); }
    });
    return { score:Math.round(sc*100)/100, fired:fired };
  }
  function subjectFamilyHint(spans,C){
    var fams=[];
    spans.forEach(function(s){ if(s.type==='FAMILY') fams.push(s.value.family);
      if(s.type==='ANCHOR'||s.type==='NAME'){ var cs=s.type==='ANCHOR'?s.value.codes:s.value.codes; uniq(cs.map(function(c){ return C.G[c]&&C.G[c].family; })).forEach(function(f){ if(f) fams.push(f); }); } });
    fams=uniq(fams); return fams.length===1?fams[0]:null;
  }
  var CONTENT_TYPES={ ANCHOR:1, NAME:1, DEVICE:1, DEVICECLASS:1, CONNECTOR:1, CONN_PAIR:1, PORTCOUNT:1, PORTROLE:1, NUMUNIT:1, PRICE:1, RES:1, RATIO:1, NUMBER:1, STANDARD:1, FAMILY:1, FORM:1, FEATURE:1, COLOR:1, FIELD:1, USECASE:1, INTENT:1, AMBIG:1, UNKNOWN:1, RELAXSLOT:1, VERSION:1, LANES:1, QVALUE:1 };
  function resolveSenses(spans,toks,C,opts,force){
    var O=ONT(), types={}, decisions=[];
    /* role resolution: a word that names both a product family and a device class ("projector", "monitor", "car") is the
       DEVICE when it is the target of sa / para sa / for / with or when a fit question has a concrete subject; else the family */
    var hasCompat=spans.some(function(x){ return x.type==='INTENT' && x.value.id==='compat'; }), hasAnchor=spans.some(function(x){ return x.type==='ANCHOR'||x.type==='NAME'; });
    spans.forEach(function(s,k){
      var alt=(s.alts||[]).filter(function(a){ return a.indexOf('DEVICECLASS:')===0; })[0];
      if(s.type!=='FAMILY' || !alt) return;
      var pv=toks[s.from-1]&&toks[s.from-1].t, pv2=toks[s.from-2]&&toks[s.from-2].t;
      var target=/^(sa|for|with|pang|sa may)$/.test(pv) || (pv2==='para'&&pv==='sa');
      var dev=target || (hasCompat && hasAnchor);
      var dv=JSON.parse(alt.slice('DEVICECLASS:'.length));
      s.candidates=[{ id:'family.'+s.value.family, concept:'family', value:s.value.family, score:dev?0.5:1.5, fired:dev?[]:['default+1'] },{ id:'device.'+dv.id, concept:'deviceClass', value:dv.id, score:dev?2.5:0.5, fired:dev?[(target?'targetPrep':'compat+anchor')+'+2']:[] }].sort(function(a,b){ return b.score-a.score; });
      s.term=s.text; s.margin=2; s.senseState='CLEAR'; s.impact='medium';
      if(dev){ s.alts=s.alts.filter(function(a){ return a!==alt; }).concat(['FAMILY:'+JSON.stringify(s.value)]); s.type='DEVICECLASS'; s.value={ id:dv.id }; }
      s.selected=s.candidates[0].id;
      decisions.push({ span:s.id, term:s.text, selected:s.selected, margin:2, state:'CLEAR', scores:s.candidates.map(function(x){ return x.id+'='+x.score+(x.fired.length?'['+x.fired.join(',')+']':''); }) });
    });
    var subjFam=subjectFamilyHint(spans,C);
    spans.forEach(function(s){ types[s.type]=1; });
    spans.forEach(function(s,k){
      if(s.type!=='AMBIG') return;
      var def=O.SENSES[s.value]; if(!def) return;
      var prevS=null, nextS=null; for(var a=k-1;a>=0;a--){ if(spans[a].type!=='SYM'){ prevS=spans[a]; break; } } for(a=k+1;a<spans.length;a++){ if(spans[a].type!=='SYM'){ nextS=spans[a]; break; } }
      var lo=Math.max(0,s.from-3), hi=Math.min(toks.length,s.to+3), near=' '+toks.slice(lo,s.from).concat(toks.slice(s.to,hi)).map(function(x){ return x.t; }).join(' ')+' ';
      var nx=toks[s.to], pv=toks[s.from-1];
      var ctx={ nearText:near, nextWord:nx?nx.t:null, prevWord:pv?pv.t:null, nextType:nextS?(nextS.type==='AMBIG'?'AMBIG':nextS.type):null, prevType:prevS?prevS.type:null, types:types,
        nextIsNum:!!(nx&&nx.k==='num'), prevIsNum:!!(pv&&pv.k==='num'), versionNext:!!(nx&&nx.k==='num'&&/^\d\.\d$/.test(nx.t)), subjFam:subjFam,
        atEnd:!toks.slice(s.to).some(function(x){ return x.k!=='sym'; }), atStart:!toks.slice(0,s.from).some(function(x){ return x.k!=='sym'; }), prevField:opts.ctx&&opts.ctx.lastField };
      var scored=def.senses.map(function(se){ var r=senseScore(se,ctx); return { id:se.id, concept:se.concept, value:se.value, score:r.score, fired:r.fired }; }).sort(function(a,b){ return b.score-a.score; });
      var best=scored[0], second=scored[1]||{ score:0 }, margin=Math.round((best.score-second.score)*100)/100;
      var pick=best; if(force && force[s.id]) pick=scored.filter(function(x){ return x.id===force[s.id]; })[0]||best;
      s.term=s.value; s.candidates=scored; s.selected=pick.id; s.margin=margin; s.impact=def.impact;
      s.senseState=(force&&force[s.id])?'FORCED':(margin>=O.MARGIN_MIN?'CLEAR':(margin>=0.3?'SURFACED':'AMBIGUOUS'));
      s.conf=Math.min(1,0.5+margin/4);
      applySense(s,pick);
      decisions.push({ span:s.id, term:s.term, selected:pick.id, margin:margin, state:s.senseState, scores:scored.map(function(x){ return x.id+'='+x.score+(x.fired.length?'['+x.fired.join(',')+']':''); }) });
    });
    return decisions;
  }
  function applySense(s,pick){
    var c=pick.concept, v=pick.value;
    if(c==='field'){ s.type='FIELD'; s.value={ id:v }; }
    else if(c==='connector'){ s.type='CONNECTOR'; s.value={ id:v }; }
    else if(c==='family'){ s.type='FAMILY'; s.value={ family:v, subtype:null }; }
    else if(c==='device'){ s.type='DEVICE'; s.value={ id:v }; }
    else if(c==='feature'){ s.type='FEATURE'; s.value={ id:v }; }
    else if(c==='useCase'){ s.type='USECASE'; s.value={ id:v }; }
    else if(c==='portCount'||c==='count'){ s.type=c==='count'?'COUNTWORD':'FIELD'; s.value=c==='count'?{ n:v }:{ id:'ports' }; }
    else if(c==='portRole'){ s.type='FIELD'; s.value={ id:'ports' }; }
    else if(c==='inventory'){ s.type='INTENT'; s.value={ id:'inventory', word:s.term, qty:v==='qty' }; }
    else if(c==='exist'){ s.type='INTENT'; s.value={ id:'exist', word:s.term, listed:true }; }
    else if(c==='alternative'){ s.type='INTENT'; s.value={ id:'alternative', word:s.term }; }
    else if(c==='recommend'){ s.type='INTENT'; s.value={ id:'recommend', word:s.term }; }
    else if(c==='rank'){ s.type='INTENT'; s.value={ id:'rankMax', word:s.term }; }
    else if(c==='discourse'){ s.type='DISCOURSE'; s.value={ id:s.term }; }
    else if(c==='nameMod'){ s.type='NAMEMOD'; s.value={ word:v }; }
    else if(c==='deviceMod'){ s.type='DEVICEMOD'; s.value={ word:v }; }
    else if(c==='connectorMod'){ s.type='FUNCTION'; s.value={ role:'connectorMod' }; }
    else if(c==='qualifier'){ s.type='QUALIFIER'; s.value={ word:v }; }
    else if(c==='thousand'){ s.type='THOUSAND'; s.value={ dim:v }; }
    else if(c==='unit'){ s.type='UNITWORD'; s.value={ unit:v }; }
    else if(c==='version'){ s.type='FUNCTION'; s.value={ role:'version' }; }
    else if(c==='deviceTarget'){ s.type='FUNCTION'; s.value={ role:'target' }; }
    else { s.type='FUNCTION'; s.value={ role:v }; }
  }

  /* =====================================================================================================
     F. GRAMMAR: connector pairs (direction), counted connectors, connector+role, negation, thousand
     ===================================================================================================== */
  function grammar(spans,toks){
    var out=[], i=0;
    function isConn(s){ return s && s.type==='CONNECTOR'; }
    function skipG(k){ while(spans[k] && (spans[k].type==='GENDER')) k++; return k; }
    for(i=0;i<spans.length;i++){
      var s=spans[i];
      /* counted connector: "2 usb-c", "2*usb-a", "dual usb-c" */
      if((s.type==='NUMBER'||s.type==='COUNTWORD') && spans[i+1]){ var k=i+1; if(spans[k].type==='SYM'&&spans[k].value.sym==='*') k++;
        if(isConn(spans[k]) && (s.type==='COUNTWORD' || s.value.v<=8)){ var c=spans[k]; c.value=Object.assign({},c.value,{ count:s.type==='COUNTWORD'?s.value.n:s.value.v }); c.children=(c.children||[]).concat([s.id]); c.from=s.from; c.text=s.text+' '+c.text; s._merged=c.id; if(k>i+1) spans[i+1]._merged=c.id;
          var pw=spans[k+1]; if(pw && ((pw.type==='FIELD'&&pw.value.id==='ports')||(pw.type==='AMBIG'&&pw.value==='port'))){ pw._merged=c.id; c.to=pw.to; c.text=c.text+' '+pw.text; c.children.push(pw.id); } } }
    }
    spans=spans.filter(function(s){ return !s._merged; });
    for(i=0;i<spans.length;i++){
      var a=spans[i];
      if(isConn(a)){
        var j=skipG(i+1);
        if(spans[j] && (spans[j].type==='FUNCTION'||spans[j].type==='SYM') && TO_WORDS[spans[j].text]){
          var k2=skipG(j+1);
          if(isConn(spans[k2])){
            var to=[spans[k2]], end=k2;
            while(true){ var m=skipG(end+1); var jn=spans[m]; if(jn && ((jn.type==='FUNCTION' && /^(\+|and|at)$/.test(jn.text)) || (jn.type==='SYM'&&jn.value.sym==='+'))){ var m2=skipG(m+1); if(isConn(spans[m2])){ to.push(spans[m2]); end=m2; continue; } } break; }
            /* female on the target side after "+" = a pass-through port, not the main output */
            var pairSpan={ type:'CONN_PAIR', value:{ from:{ id:a.value.id, ver:a.value.ver||null }, to:to.map(function(x){ return { id:x.value.id, ver:x.value.ver||null }; }) },
              from:a.from, to:spans[end].to, children:spans.slice(i,end+1).map(function(x){ return x.id; }), id:a.id, conf:1 };
            pairSpan.text=toks.slice(pairSpan.from,pairSpan.to).map(function(x){ return x.t; }).join(' '); pairSpan.chars=[toks[pairSpan.from].from,toks[pairSpan.to-1].to];
            out.push(pairSpan); i=end; continue;
          }
        }
        /* connector + port role ("usb-c power port") */
        var r=spans[i+1]; if(r && r.type==='PORTROLE'){ r.value=Object.assign({},r.value,{ conn:a.value.id }); r.from=a.from; r.text=a.text+' '+r.text; r.children=[a.id]; out.push(r); i++; continue; }
      }
      if(a.type==='NUMBER' && spans[i+1] && spans[i+1].type==='THOUSAND'){ var th=spans[i+1]; var ns={ type:th.value.dim==='mah'?'NUMUNIT':'PRICE', value:th.value.dim==='mah'?{ unit:'mAh', dim:'mah', v:a.value.v*1000, raw:a.value.v }:{ op:'=', v:a.value.v*1000 },
          from:a.from, to:th.to, id:a.id, children:[a.id,th.id], conf:th.conf, candidates:th.candidates, selected:th.selected, margin:th.margin, senseState:th.senseState, term:'k' };
        ns.text=a.text+' '+th.text; ns.chars=[a.chars[0],th.chars[1]]; out.push(ns); i++; continue; }
      if(a.type==='NUMBER' && spans[i+1] && spans[i+1].type==='UNITWORD'){ var uw=spans[i+1]; var nu={ type:'NUMUNIT', value:{ unit:uw.value.unit, dim:uw.value.unit==='inch'?'size':'speed', v:a.value.v }, from:a.from, to:uw.to, id:a.id, children:[a.id,uw.id], conf:uw.conf, candidates:uw.candidates, selected:uw.selected, term:uw.term };
        nu.text=a.text+' '+uw.text; nu.chars=[a.chars[0],uw.chars[1]]; out.push(nu); i++; continue; }
      out.push(a);
    }
    return out;
  }

  /* =====================================================================================================
     F2. v2-2B SCOPE (shadow): version notation, PCIe lane scope, bare generations, negation scope, RELAX.
     Structural only: decided from the span sequence of THIS turn; never from a context, a result set or the catalogue.
     Marks spans; buildFrame() binds them, turnFrame() projects them into the A5 contract.
     ===================================================================================================== */
  var VALUE_TYPES={ COLOR:1, FEATURE:1, CONNECTOR:1, FAMILY:1, FORM:1, NUMUNIT:1, PRICE:1, PORTCOUNT:1, STANDARD:1, CONN_PAIR:1, RES:1 };
  var NEGATABLE={ COLOR:1, FEATURE:1, CONNECTOR:1, FAMILY:1, FORM:1 };   /* other governed values (numbers, prices, pairs) -> polarity null */
  var SKIP_WORDS={ po:1, yung:1, ung:1, ang:1, ng:1, the:1, a:1, an:1, kayo:1, kayong:1, tayo:1, tayong:1, ninyo:1, nyo:1, niyo:1, mga:1, na:1, naman:1, ko:1 };
  var RELATIVISER={ yung:1, ung:1, na:1, ng:1, with:1, w:1, may:1 };
  var REL_SKIP={ may:1, with:1, one:1, the:1, yung:1, ung:1, ng:1, na:1, w:1, isang:1 };
  var COUNT_WORDS={ ilan:1, ilang:1, 'how many':1, 'number of':1, 'count of':1 };
  var STRUCT_SKIP={ FUNCTION:1, SYM:1, REF:1, DISCOURSE:1, FOLLOWUP:1, GENDER:1 };
  var CLAUSE_WORDS={ pero:1, but:1, tapos:1, then:1 };
  function scope(spans,toks,norm){
    var O=ONT(), i, k;
    /* clause boundary between two spans: punctuation in the normalized text, or a clause conjunction span between them.
       Negation never crosses it ("hindi po, may white ba?" = "no - do you have white?") */
    function cut(a,b){ if(!a||!b) return false; if(norm && a.chars && b.chars && /[,.;!]/.test(norm.slice(Math.min(a.chars[1],b.chars[0]),Math.max(a.chars[1],b.chars[0])))) return true;
      var ia=spans.indexOf(a), ib=spans.indexOf(b), lo=Math.min(ia,ib), hi=Math.max(ia,ib); for(var kk=lo+1;kk<hi;kk++) if(CLAUSE_WORDS[spans[kk].text]) return true; return false; }
    function drop(x){ x._merged=true; }
    function absorb(s,n){ s.to=n.to; s.text=s.text+' '+n.text; if(s.chars && n.chars) s.chars=[s.chars[0],n.chars[1]]; s.children=(s.children||[]).concat([n.id]); drop(n); }
    function nextIdx(i,skip){ for(var k=i+1;k<spans.length;k++){ var x=spans[k]; if(x._merged||x.type==='SYM') continue; if(skip && (x.type==='FUNCTION'||x.type==='REF') && SKIP_WORDS[x.text]) continue; return k; } return -1; }
    function prevIdx(i){ for(var k=i-1;k>=0;k--){ var x=spans[k]; if(x._merged||x.type==='SYM') continue; return k; } return -1; }
    function isContent(x){ return x && !x._merged && !STRUCT_SKIP[x.type] && x.type!=='NEG' && x.type!=='QUANT' && x.type!=='EPISTEMIC'; }
    /* 1. connector + adjacent version notation: "usb-c 3.1", "pcie 4", "usb 3.2 gen 2", "pcie gen 4" (invalid notations are not absorbed) */
    for(i=0;i<spans.length;i++){ var s=spans[i], ifc=s.type==='CONNECTOR'?O.interfaceOf(s.value.id):null; if(!ifc || s._merged) continue;
      if(ifc==='pcie' && s.value.ver) s.value=Object.assign({},s.value,{ ver:O.canonVersion('pcie',s.value.ver) });
      var n1=spans[i+1];
      if(n1 && n1.type==='NUMBER' && !s.value.ver && !s.value.gen && n1.from===s.to){
        var okv=ifc==='pcie'?O.canonVersion('pcie',n1.text):((O.CONNECTORS[s.value.id]&&(O.CONNECTORS[s.value.id].versions||[]).indexOf(n1.text)>=0)?n1.text:null);
        if(okv){ s.value=Object.assign({},s.value,{ ver:okv }); absorb(s,n1); n1=spans[nextIdx(i,false)]; } }
      if(n1 && n1.type==='VERSION' && !s.value.gen && n1.from===s.to){
        var g=n1.value.raw.replace(/^gen/,''), cv2=ifc==='pcie'?(s.value.ver?null:O.canonVersion('pcie',n1.value.raw)):O.canonVersion(ifc,(s.value.ver||'')+'g'+g);
        if(cv2){ s.value=Object.assign({},s.value,ifc==='pcie'?{ ver:cv2 }:{ gen:'g'+g }); absorb(s,n1); } } }
    spans=spans.filter(function(x){ return !x._merged; });
    var conns=spans.filter(function(x){ return x.type==='CONNECTOR' && O.interfaceOf(x.value.id); });
    var pairIfs=[]; spans.forEach(function(x){ if(x.type==='CONN_PAIR') [x.value.from].concat(x.value.to).forEach(function(c){ var f=O.interfaceOf(c.id); if(f) pairIfs.push(f); }); });
    var ifaces=uniq(conns.map(function(x){ return O.interfaceOf(x.value.id); }).concat(pairIfs));
    /* 2. lane widths only in PCIe scope (BA7); a lane-only turn stays an unqualified lanes slot for the resolver (C1) */
    var pcieScope=ifaces.indexOf('pcie')>=0;
    spans.forEach(function(x){ if(x.type!=='LANES') return;
      if(pcieScope) x.value=Object.assign({},x.value,{ iface:'pcie' });
      else if(!spans.some(function(y){ return y!==x && isContent(y); })) x.value=Object.assign({},x.value,{ iface:null });
      else { x.type='UNKNOWN'; x.value={ word:x.text }; } });
    /* 3. bare generation ("Gen 4"): bind to the turn's single versioned interface; none -> raw (resolver binds, C2); several ->
          AMBIGUOUS; impossible for the interface or conflicting with an explicit version -> UNRESOLVED */
    spans.forEach(function(v){ if(v.type!=='VERSION') return;
      /* V2-2C C1 (review R3): a negated bare generation ("not gen 1", "hindi gen 2") is never bound as a requirement: UNRESOLVED */
      var vb=spans.indexOf(v)-1; while(vb>=0 && (spans[vb].type==='SYM' || (spans[vb].type==='FUNCTION' && SKIP_WORDS[spans[vb].text]))) vb--;
      if(vb>=0 && (spans[vb].type==='NEG' || spans[vb].type==='RELAXNEG') && !cut(spans[vb],v)){ v._unres=true; v.impact='high'; return; }
      if(ifaces.length>1){ v._amb=true; return; }
      if(ifaces.length===1){ var f=ifaces[0], cs=conns.filter(function(x){ return O.interfaceOf(x.value.id)===f; });
        if(!cs.length || cs.some(function(x){ return x.value.ver || x.value.gen; })){ v._unres=true; return; }
        var cv=O.canonVersion(f,v.value.raw); if(!cv){ v._unres=true; return; }
        cs[0].value=Object.assign({},cs[0].value,f==='pcie'?{ ver:cv }:{ gen:cv }); v._slot='constraint.part'; v.boundTo=cs[0].id; return; }
      if(!Object.keys(O.INTERFACES).some(function(f){ return O.canonVersion(f,v.value.raw); })) v._unres=true; });
    /* 4. negation scope (BA2: a governed value is never affirmed) */
    for(i=0;i<spans.length;i++){ var e=spans[i];
      if(e.type==='EPISTEMIC'){ e._slot='epistemic';
        for(k=i+1;k<spans.length && k<=i+4;k++){ var ev=spans[k]; if(ev.type==='NEG'||ev.type==='EPISTEMIC'||cut(e,ev)) break; if(VALUE_TYPES[ev.type]){ ev.polNull=true; ev.negGov=e.id; } } continue; }
      if(e.type!=='NEG') continue;
      /* a bare "no" / "hindi po" closing its own clause is an answer word: it governs nothing in the next clause */
      var nx0=spans[nextIdx(i,false)]; if(nx0 && cut(e,nx0)){ e._slot='discourse.answer'; continue; }
      var q=nextIdx(i,false), qs=spans[q];
      if(qs && qs.type==='FUNCTION' && O.QUESTION_PARTICLES.indexOf(qs.text)>=0){
        if(e.value.cls==='existential'){ e._slot='intent.exist'; e.existQ=true; continue; }   /* "wala bang white?" = is there a white one */
        e._slot='question.yesno'; var yv=spans[nextIdx(q,true)]; if(yv && VALUE_TYPES[yv.type]){ yv._yesNo=true; yv.negGov=e.id; } continue; }
      var t=spans[nextIdx(i,true)];
      /* relativised object: "ayaw ko ng MAY cable", "not THE ONE WITH hdmi", "huwag yung may cable" */
      var ti=nextIdx(i,true), relSkip=false; while(t && REL_SKIP[t.text] && /^(FUNCTION|REF|INTENT)$/.test(t.type)){ relSkip=true; ti=nextIdx(ti,true); t=spans[ti]; }
      if(!t || cut(e,t)) continue;
      if(t.type==='INTENT' && t.value.id==='inventory'){ e._slot='intent.inventory'; continue; }   /* "walang stock" = stock wording */
      if(!VALUE_TYPES[t.type]) continue;
      e._slot='negation'; t.negGov=e.id;
      if(!NEGATABLE[t.type]){ t.polNull=true; continue; }
      var relObj=relSkip;
      if(e.value.cls==='existential'){ var p=spans[prevIdx(i)];
        var rel=p && ((RELATIVISER[p.text] && (p.type==='FUNCTION'||p.type==='REF'||p.type==='INTENT')) || /^(FAMILY|FORM|NAME|ANCHOR|DEVICE|DEVICECLASS|FAMILY_ALIAS|FORM_ALIAS)$/.test(p.type));
        if(!rel){ t.polNull=true; continue; } relObj=true; }
      t.negated=true;
      /* V2-2C C1 (#1): a relativised "the one WITH cable" / "yung MAY cable" / "yung walang cable" is the product HAVING a cable,
         i.e. the built-in-cable feature, never the product form "cable" ("not a cable" keeps the form) */
      if(relObj && t.type==='FORM' && t.value.form==='cable'){ t.type='FEATURE'; t.value={ id:'builtin' }; t.viaCable=true; } }
    /* 4b. safety net (BA2): a negator whose scope stayed unresolved never lets a nearby value be affirmed -> polarity null */
    spans.forEach(function(e,ix){ if(e.type!=='NEG' || e._slot) return;
      for(var k2=ix+1;k2<spans.length && k2<=ix+4;k2++){ var v2=spans[k2]; if(v2.type==='NEG'||v2.type==='EPISTEMIC'||cut(e,v2)) break; if(VALUE_TYPES[v2.type] && !v2.negGov){ v2.polNull=true; v2.negGov=e.id; } } });
    /* 5. RELAX: quantifier + slot noun, slot noun + "doesn't matter", "not needed" + slot noun / slot value */
    function relaxSlotOf(x){ if(!x) return null;
      if(x.type==='FIELD' && O.RELAX_FIELDS[x.value.id]) return O.RELAX_FIELDS[x.value.id];
      if(x.type==='FEATURE') return 'feature:'+x.value.id; if(x.type==='CONNECTOR') return 'connector:'+x.value.id;
      if(x.type==='STANDARD') return 'standard:'+x.value.id; if(x.type==='COLOR') return 'colour'; if(x.type==='FORM') return 'form';
      if(x.type==='NUMUNIT'){ var nd={ watts:'num:watts', mah:'num:mah', length:'num:lengthM', speed:'num:gbps' }[x.value.dim]; if(nd) return nd; }
      if(x.type==='PRICE') return 'price'; if(x.type==='PORTCOUNT') return 'ports'; return null; }
    function relaxOn(cue,x,slot){ cue._slot='relax'; x.type='RELAXSLOT'; x.value={ relaxSlot:slot, was:x.value }; x._slot='relax.slot'; x.relaxBy=cue.id; }
    for(i=0;i<spans.length;i++){ var c=spans[i];
      if(c.type==='QUANT'){ k=i+1; while(k<spans.length && (spans[k].type==='SYM' || (spans[k].type==='FUNCTION' && !O.COMPARE_MORE[spans[k].text]) || spans[k].type==='REF' || (spans[k].type==='INTENT' && COUNT_WORDS[spans[k].text]))) k++;
        var sl=spans[k] && spans[k].type==='FIELD' ? relaxSlotOf(spans[k]) : null;
        if(sl){ for(var m=i+1;m<k;m++) if(spans[m].type==='INTENT'){ spans[m].type='RELAXPART'; spans[m]._slot='relax'; } relaxOn(c,spans[k],sl); continue; }
        if(spans.some(function(y){ return y!==c && isContent(y); })) c._slot='grammar'; else c._amb=true; continue; }   /* "kahit ano" alone: no slot -> AMBIGUOUS */
      if(c.type==='RELAXCUE'){ var pv=spans[prevIdx(i)], ps=relaxSlotOf(pv); if(ps) relaxOn(c,pv,ps); else c._unres=true; continue; }
      /* "not needed" relaxes the value after it, or (nothing after) the value just before it in the same clause ("white not needed") */
      /* V2-2C C1 (#2): a trailing "not needed" with nothing after it also reaches back across a comma ("white, not needed"); a clause
         conjunction still bounds it. The preceding value is relaxed, never affirmed. */
      if(c.type==='RELAXNEG'){ var nv=spans[nextIdx(i,true)], ns=nv && !cut(c,nv)?relaxSlotOf(nv):null, pv=spans[prevIdx(i)], ps=pv && !pv.negGov && !cut(pv,c)?relaxSlotOf(pv):null;
        if(!ns && !ps && pv && !pv.negGov && !(nv && !cut(c,nv) && isContent(nv)) && !cutClause(pv,c)) ps=relaxSlotOf(pv);
        if(ns) relaxOn(c,nv,ns); else if(ps) relaxOn(c,pv,ps); else { c._unres=true; for(var k3=i+1;k3<spans.length && k3<=i+4;k3++){ var v3=spans[k3]; if(v3.type==='NEG'||v3.type==='EPISTEMIC'||cut(c,v3)) break; if(VALUE_TYPES[v3.type] && !v3.negGov){ v3.polNull=true; v3.negGov=c.id; } } } } }   /* never affirm a "not needed" value */
    /* V2-2C C1 (#3): one turn that both requires and relaxes the same slot ("white pero no need white", "65W, kahit ilang watts")
       keeps neither: both spans are AMBIGUOUS (high impact) so the turn clarifies */
    spans.forEach(function(r){ if(r.type!=='RELAXSLOT') return; spans.forEach(function(v){ if(v===r || v._merged || v.negGov || v.negated || v.polNull || !VALUE_TYPES[v.type]) return;
      if(relaxSlotOf(v)===r.value.relaxSlot){ v._amb=true; v._conflict=true; v.impact='high'; r._amb=true; r._conflict=true; r.impact='high'; } }); });
    return spans;
    function cutClause(a,b){ var ia=spans.indexOf(a), ib=spans.indexOf(b), lo=Math.min(ia,ib), hi=Math.max(ia,ib); for(var kk=lo+1;kk<hi;kk++) if(CLAUSE_WORDS[spans[kk].text]) return true; return false; }
  }

  /* =====================================================================================================
     G. SEMANTIC FRAME (structural intent, subject, field, constraints)
     ===================================================================================================== */
  var MEASURE_FIELD={ watts:1, mah:1, ports:1, colour:1, length:1, bays:1, speed:1 };
  var PRICE_FIELD={ srp:1, dp:1, dp_vol:1, price:1 };
  function buildFrame(spans,toks,C,opts){
    var O=ONT(), L=LEX();
    var F={ intent:null, why:[], subject:null, field:null, fields:[], constraints:[], rank:null, compare:null, device:null, useCase:null, inventory:null,
      discourse:[], refs:[], needsContext:false, interpretations:[], negDevice:[], relax:[] };
    function bind(s,slot){ s.slot=slot; }
    var by=function(t){ return spans.filter(function(s){ return s.type===t; }); };
    var anchors=by('ANCHOR'), names=by('NAME'), fams=by('FAMILY'), intents=by('INTENT'), fields=by('FIELD');
    /* --- discourse / function / refs --- */
    spans.forEach(function(s){
      if(s.type==='FUNCTION'||s.type==='SYM'||s.type==='GENDER'){ bind(s,s.value&&s.value.role==='target'?'device.target':'grammar'); }
      if(s.type==='DISCOURSE'){ F.discourse.push(s.value.id); bind(s,'discourse'); }
      if(s.type==='REF'){ F.refs.push(s.text); bind(s,'reference'); }
      /* v2-2B structural spans (scope() decided their role) */
      if(s._slot) bind(s,s._slot);
      if(s.type==='ORDINAL'){ F.ordinal=s.value.n; F.refPronoun=true; bind(s,'reference.ordinal'); }
      if(s.type==='REF' && s.value.kind==='other') F.refOther=true;
      if(s.type==='RELAXSLOT' && !s._conflict) F.relax.push({ slot:s.value.relaxSlot, span:s.relaxBy });
      if(s.type==='NEG' && s.existQ) F.existQ=true;
      if(s._yesNo){ F.yesNo={ field:yesNoField(s), span:s.id }; s.type='QVALUE'; bind(s,'question.value'); }
      if(s.type==='FOLLOWUP' && s.value.select) F.selectCue=true;
      if(s.type==='FOLLOWUP'){ F.followUp=s.value.cue; if(/^(alin|which|yung alin)\b/.test(s.value.cue) && /\b(dun|doon|diyan|dyan|those|there)\b/.test(s.value.cue)) F.selectCue=true; bind(s,'discourse.followup'); }
      if(s.type==='METRIC'){ F.metricWord=s.value.metric; if(s.value.dir) F.metricPref={ metric:s.value.metric, dir:s.value.dir, word:s.value.word }; bind(s,'metric'); }
      if(s.type==='EXTERNAL'){ F.external=(F.external||[]).concat([s.value.word]); bind(s,'external'); }
      if(s.type==='PERIOD'){ F.period=s.value.period; bind(s,'period'); }
      if(s.type==='OPERATOR'){ bind(s,'operator'); }
      if(s.type==='LIMIT'){ F.limit=s.value.n; bind(s,'limit'); }
      if(s.type==='USERS'){ F.users=s.value.n; bind(s,'useCase.size'); }
      if(s.type==='REF'){ var nx=spans.slice(spans.indexOf(s)+1).filter(function(x){ return x.type!=='SYM'; })[0];
        if(!nx || !/^(FAMILY|NAME|ANCHOR|FORM|DEVICE|DEVICECLASS|CONNECTOR|CONN_PAIR|NUMUNIT|PORTCOUNT|FAMILY_ALIAS)$/.test(nx.type)) F.refPronoun=true; }
    });
    /* --- subject --- */
    if(anchors.length){
      var ac=uniq([].concat.apply([],anchors.map(function(a){ return a.value.codes; })));
      F.subject={ kind:anchors.length>1?'anchors':anchors[0].value.kind, codes:ac, text:anchors.map(function(a){ return a.text; }).join(', '), groups:anchors.map(function(a){ return a.value.codes; }) };
      anchors.forEach(function(a){ bind(a,'subject'); });
      names.forEach(function(n){ var ov=n.value.codes.some(function(c){ return ac.indexOf(c)>=0; }); if(ov) bind(n,'subject.alias'); else { F.constraints.push({ kind:'name', phrase:n.value.phrase, codes:n.value.codes, span:n.id, hard:true, label:n.text }); bind(n,'constraint'); } });
    } else if(names.length){
      /* a name that shares no product with the named family is a descriptive word here, not the product line */
      if(fams.length){ names=names.filter(function(n){ var fam0=fams[0].value.family; var hit=n.value.codes.some(function(c){ return C.G[c] && C.G[c].family===fam0; });
        if(!hit){ n.type='QUALIFIER'; n.value={ word:n.text, demotedName:true }; } return hit; }); }
    }
    /* V2-2C C1 (#15): a generic name word whose products span several families ("card") is a name constraint, never the subject:
       a subject over mixed families would anchor a catalogue-wide follow-up */
    if(!anchors.length && names.length && !fams.length){
      names=names.filter(function(n){ var nf=uniq(n.value.codes.map(function(c){ return C.G[c]&&C.G[c].family; }).filter(Boolean)); if(nf.length<=1) return true;
        F.constraints.push({ kind:'name', phrase:n.value.phrase, codes:n.value.codes, span:n.id, hard:true, label:n.text, mixedFamily:true }); bind(n,'constraint'); return false; }); }
    if(!anchors.length && names.length){
      var nc=names[0].value.codes.slice(); names.slice(1).forEach(function(n){ var inter=nc.filter(function(c){ return n.value.codes.indexOf(c)>=0; }); nc=inter.length?inter:nc.concat(n.value.codes); });
      F.subject={ kind:'name', codes:uniq(nc), text:names.map(function(n){ return n.text; }).join(' ') }; names.forEach(function(n){ bind(n,'subject'); });
    }
    /* a family / form noun next to an anchor that the anchor's own name carries is a description of the anchor, not a filter */
    if(anchors.length){ spans.forEach(function(f){ if(f.type!=='FAMILY' && f.type!=='FORM') return; var w=f.text.replace(/s$/,'');
      if(F.subject.codes.some(function(c){ return C.G[c] && new RegExp('\\b'+esc(w)).test(C.G[c].lname); })){ f.type=f.type==='FAMILY'?'FAMILY_ALIAS':'FORM_ALIAS'; bind(f,'subject.alias'); } }); fams=fams.filter(function(f){ return f.type==='FAMILY'; }); }
    /* "<family> with <other family>" / "<family> na may <other family>": the second family is a COMPONENT of the subject */
    fams=fams.filter(function(f,k){ if(k===0 && !F.subject) return true; var i=spans.indexOf(f), back=spans.slice(Math.max(0,i-3),i).map(function(x){ return x.text; }).join(' ');
      var subjFam0=F.subject&&F.subject.family || (fams[0]&&fams[0]!==f?fams[0].value.family:null);
      if(subjFam0===f.value.family) return true;
      if((F.subject||k>0) && /\b(with|may|na may|w)\b/.test(back)){ F.constraints.push({ kind:'component', family:f.value.family, span:f.id, hard:true, label:'with '+f.text }); bind(f,'constraint.component'); return false; } return true; });
    fams.forEach(function(f,k){
      if(f.negated){ F.constraints.push({ kind:'notFamily', family:f.value.family, span:f.id, hard:true, label:'not '+f.text }); bind(f,'constraint'); return; }
      if(!F.subject){ F.subject={ kind:f.value.subtype?'subtype':'family', family:f.value.family, subtype:f.value.subtype, text:f.text }; bind(f,'subject'); }
      else if(F.subject.family && F.subject.family===f.value.family){ if(f.value.subtype && !F.subject.subtype){ F.subject.subtype=f.value.subtype; F.subject.kind='subtype'; } bind(f,'subject'); }
      else { F.constraints.push({ kind:'family', family:f.value.family, subtype:f.value.subtype, span:f.id, hard:true, label:f.text }); bind(f,'constraint'); }
    });
    /* a cable standard implies its family ("cat5e 10m" = LAN cables) */
    if(!F.subject){ var stdS=spans.filter(function(x){ return x.type==='STANDARD'; })[0]; if(stdS && O.STANDARDS[stdS.value.id].family){ F.subject={ kind:'family', family:O.STANDARDS[stdS.value.id].family, subtype:null, text:O.STANDARDS[stdS.value.id].label+' cables', via:'standard' }; } }
    /* a multi-word family phrase that names a connector ("hdmi cable", "usb hub", "lan adapter") keeps that connector */
    spans.forEach(function(f){ if(f.type!=='FAMILY' || f.to-f.from<2) return; connScan(toks.slice(f.from,f.to)).forEach(function(cn){
      if(F.subject && F.subject.family==='lan_cable' && cn.id==='rj45') return;
      F.constraints.push({ kind:'connector', id:cn.id, ver:cn.ver||null, span:f.id, hard:true, label:connLabel(cn), fromFamilyPhrase:true }); }); });
    /* --- device (named device / device class): a hint for routing and fit, never a product proof --- */
    spans.forEach(function(s,k){
      if(s.type==='DEVICE'||s.type==='DEVICECLASS'){
        var d=s.type==='DEVICE'?{ kind:'named', id:s.value.id, label:O.NAMED_DEVICES[s.value.id].label, cls:O.NAMED_DEVICES[s.value.id].cls, text:s.text, mods:(s.absorbed||[]).map(function(x){ return x.word; }) }
                                 :{ kind:'class', id:s.value.id, label:O.DEVICE_CLASSES[s.value.id].label, cls:s.value.id, text:s.text, likely:(O.DEVICE_CLASSES[s.value.id].likelyInputs||O.DEVICE_CLASSES[s.value.id].likelyPorts||[]) };
        if(!F.device) F.device=d; else if(d.kind==='named' && F.device.kind==='class'){ d.more=[F.device].concat(F.device.more||[]); F.device=d; } else (F.device.more=F.device.more||[]).push(d);
        var pn=spans[k-1]; if(pn && pn.type==='NUMBER'){ d.count=pn.value.v; bind(pn,'device.count'); }
        bind(s,'device');
        /* qualifiers of the device itself: "projector na walang wifi" */
        for(var q=k+1;q<spans.length && q<=k+3;q++){ var qs=spans[q]; if((qs.type==='FEATURE'||qs.type==='CONNECTOR') && qs.negated){ d.qualifiers=(d.qualifiers||[]).concat(['no '+(qs.type==='FEATURE'?O.FEATURES[qs.value.id].label:connLabel(qs.value))]); bind(qs,'device.qualifier'); qs._deviceQual=true; } }
      }
      if(s.type==='DEVICEMOD'){ bind(s,'device.mod'); }
    });
    /* a device class that names a subtype of the subject family ("charger pang car", "phone holder sa kotse") is that subtype */
    if(F.device && F.device.kind==='class' && F.subject && F.subject.family){
      var famDef=(L.taxonomy.families||[]).filter(function(f){ return f.id===F.subject.family; })[0], dcl=F.device.id;
      var st=famDef && (famDef.subtypes||[]).filter(function(x){ return x.id===dcl || x.id.split('_').indexOf(dcl)>=0; })[0];
      if(st && st.id!==F.subject.subtype){ F.subject.subtype=st.id; F.subject.kind='subtype'; F.why.push('device class "'+F.device.text+'" names subtype '+F.subject.family+'.'+st.id); F.deviceAsSubtype=F.device; F.device=null; } }
    /* --- fields --- */
    fields.forEach(function(f){ F.fields.push(f.value.id); bind(f,'field'); });
    var spec=F.fields.filter(function(x){ return x!=='price'; });
    F.field=spec.length?spec[0]:(F.fields[0]||null);
    /* --- constraints --- */
    var fam=F.subject&&F.subject.family;
    spans.forEach(function(s){
      var lab=s.text;
      if(s._conflict) return;   /* V2-2C C1 (#3): required and relaxed in one turn -> AMBIGUOUS, no constraint */
      switch(s.type){
        case 'NUMUNIT':
          var op0=opNear(s,toks);
          if(s.value.dim==='watts') F.constraints.push({ kind:'num', attr:'watts', op:op0, v:s.value.v, span:s.id, hard:true, label:opWord(op0)+s.value.v+'W' });
          else if(s.value.dim==='mah') F.constraints.push({ kind:'num', attr:'mah', op:op0, v:s.value.v, span:s.id, hard:true, label:opWord(op0)+s.value.v.toLocaleString('en-US')+'mAh' });
          else if(s.value.dim==='length') F.constraints.push({ kind:'num', attr:'lengthM', op:op0, v:Math.round(s.value.v*1000)/1000, span:s.id, hard:false, label:opWord(op0)+fmtLen(s.value.v) });
          else if(s.value.dim==='size') F.constraints.push({ kind:'size', v:s.value.v, span:s.id, hard:false, label:s.value.v+'"' });
          else if(s.value.dim==='speed') F.constraints.push({ kind:'num', attr:'gbps', op:'>=', v:s.value.v, span:s.id, hard:false, label:'at least '+s.value.v+'Gbps' });
          else if(s.value.dim==='refresh') F.constraints.push({ kind:'hz', v:s.value.v, span:s.id, hard:false, label:s.value.v+'Hz' });
          else if(s.value.dim==='storage'||s.value.dim==='volts'||s.value.dim==='GHz') F.constraints.push({ kind:'nametext', re:'\\b'+s.value.raw+' ?'+s.value.unit.toLowerCase()+'\\b', span:s.id, hard:false, label:s.text });
          else break;
          bind(s,'constraint'); break;
        case 'PORTCOUNT': F.constraints.push({ kind:'ports', n:s.value.n, in1:!!s.value.in1, role:fam==='charger'?'charging_output':(fam==='network_switch'?'rj45':'data_port'), span:s.id, hard:true, label:s.value.n+(s.value.in1?'-in-1':'-port') }); bind(s,'constraint'); break;
        case 'CONN_PAIR': F.constraints.push({ kind:'pair', from:s.value.from, to:s.value.to, multiport:fams.some(function(f){ return f.value.family==='hub_dock'; }), span:s.id, hard:true, label:connLabel(s.value.from)+' to '+s.value.to.map(connLabel).join(' + ') }); bind(s,'constraint');
          (s.children||[]).forEach(function(cid){ var cs=spans.filter(function(x){ return x.id===cid; })[0]; if(cs) bind(cs,'constraint.part'); }); break;
        case 'CONNECTOR': if(s._deviceQual) break;
          /* V2-2C C1 (#5): a negated VERSIONED connector ("not HDMI 2.1") excludes that version only; the connector stays affirmed */
          var nIf=s.negated && (s.value.ver||s.value.gen) ? O.interfaceOf(s.value.id) : null, nCv=nIf ? O.canonVersion(nIf,nIf==='usb'?(s.value.ver||'')+(s.value.gen||''):(s.value.ver||s.value.gen)) : null;
          if(nCv){ if(!F.constraints.some(function(x){ return x.kind==='connector' && x.id===s.value.id; })) F.constraints.push({ kind:'connector', id:s.value.id, ver:null, span:s.id, hard:true, label:connLabel({ id:s.value.id }), affirmBase:true });
            F.constraints.push({ kind:'notVersion', id:s.value.id, iface:nIf, ver:nCv, span:s.id, hard:true, label:('not '+connLabel({ id:s.value.id })+' '+(s.value.ver||'')+(s.value.gen?' Gen '+s.value.gen.replace(/^g/,''):'')).replace(/\s+/g,' ').trim() }); bind(s,'constraint'); break; }
          if(s.negated){ F.constraints.push({ kind:'notConnector', id:s.value.id, span:s.id, hard:true, label:'no '+connLabel(s.value) }); bind(s,'constraint'); break; }
          var nxt=spans[spans.indexOf(s)+1], plugRole=!!(nxt && nxt.type==='FAMILY' && /^(hub_dock|card_reader)$/.test(nxt.value.family));
          F.constraints.push({ kind:'connector', id:s.value.id, ver:s.value.ver||null, gen:s.value.gen||null, count:s.value.count||null, role:plugRole?'plug':null, span:s.id, hard:true, label:(s.value.count?s.value.count+'× ':'')+connLabel(s.value)+(s.value.gen?' Gen '+s.value.gen.replace(/^g/,''):'') }); bind(s,'constraint'); break;
        case 'PORTROLE': F.constraints.push({ kind:'role', role:s.value.role, conn:s.value.conn||null, span:s.id, hard:true, label:(s.value.conn?connLabel({ id:s.value.conn })+' ':'')+O.PORT_ROLES[s.value.role].label }); bind(s,'constraint'); break;
        case 'FEATURE': if(s._deviceQual) break; F.constraints.push({ kind:'feature', id:s.value.id, neg:!!s.negated, span:s.id, hard:!!O.FEATURES[s.value.id].hard, label:(s.negated?'no ':'')+O.FEATURES[s.value.id].label }); bind(s,'constraint'); break;
        case 'COLOR': F.constraints.push({ kind:'colour', v:s.value.id, span:s.id, hard:false, label:s.text }); bind(s,'constraint'); break;
        case 'STANDARD': F.constraints.push({ kind:'standard', id:s.value.id, span:s.id, hard:true, label:O.STANDARDS[s.value.id].label }); bind(s,'constraint'); break;
        case 'PRICE': var pop=s.value.op==='='?'<=':s.value.op; F.constraints.push({ kind:'price', op:pop, v:s.value.v, span:s.id, hard:false, label:opWord(pop,true)+'₱'+s.value.v.toLocaleString('en-US') }); bind(s,'constraint'); break;
        case 'RES': F.constraints.push({ kind:'res', rank:s.value.rank, span:s.id, hard:false, label:String(s.value.text||s.text).replace(/ /g,'').toUpperCase() });
          if(s.value.hz) F.constraints.push({ kind:'hz', v:s.value.hz, rank:s.value.rank, span:s.id, hard:false, label:s.value.hz+'Hz' }); bind(s,'constraint'); break;
        case 'RATIO': F.constraints.push({ kind:'nametext', re:'\\b'+s.value.a+' ?to ?'+s.value.b+'\\b', span:s.id, hard:true, label:s.value.a+' to '+s.value.b }); bind(s,'constraint'); break;
        case 'FORM': F.constraints.push({ kind:'form', form:s.value.form, span:s.id, hard:false, label:s.text }); bind(s,'constraint'); break;
        case 'VERSION': if(s._unres || s._amb || s.boundTo) break; F.constraints.push({ kind:'version', iface:null, raw:s.value.raw, span:s.id, hard:true, label:s.text.replace(/^gen\s?/,'Gen ') }); bind(s,'constraint'); break;
        case 'LANES': F.constraints.push({ kind:'lanes', n:s.value.n, iface:s.value.iface||null, span:s.id, hard:true, label:'x'+s.value.n }); bind(s,'constraint'); break;
        case 'NAMEMOD': F.constraints.push({ kind:'nametoken', word:s.value.word, span:s.id, hard:true, label:s.text }); bind(s,'constraint'); break;
        case 'QUALIFIER': F.constraints.push({ kind:'nametoken', word:s.value.word, span:s.id, hard:false, label:s.text }); bind(s,'constraint'); break;
        case 'USECASE':
          if(fam && (C.byFam[fam]||[]).some(function(c){ return new RegExp('\\b'+esc(s.text)+'\\b').test(C.G[c].lname); })){ F.constraints.push({ kind:'nametoken', word:s.text, span:s.id, hard:false, label:s.text }); bind(s,'constraint'); break; }
          F.useCase=s.value.id; bind(s,'useCase'); break;
      }
    });
    if(F.subject && F.subject.family==='lan_cable') F.constraints=F.constraints.filter(function(c){ return !(c.kind==='connector'&&c.id==='rj45'); });
    /* v2-2B: polarity from scope(): a negated colour / form is an exclusion; a governed value with unclear scope (negated number,
       bare "walang X", epistemic) is polarity null -> never evaluated as confirmed (BA2) */
    var spanById={}; spans.forEach(function(x){ spanById[x.id]=x; });
    F.constraints.forEach(function(c){ var sp=spanById[c.span]; if(!sp) return; if(sp.negGov && !c.affirmBase) c.negGov=sp.negGov;
      if(sp.polNull){ c.polNull=true; c.label='(unclear: '+c.label+')'; }
      else if(sp.negated && (c.kind==='colour'||c.kind==='form')){ c.neg=true; c.label='not '+c.label; } });
    /* v2-2B: a versioned interface whose catalogue products all sit in ONE family implies that family (data-derived, like a cable standard) */
    if(!F.subject){ var ifc=spans.filter(function(x){ return x.type==='CONNECTOR' && !x.negated && !x.polNull && O.interfaceOf(x.value.id) && C.connFam[x.value.id] && C.connFam[x.value.id].length===1; })[0];
      if(ifc){ F.subject={ kind:'family', family:C.connFam[ifc.value.id][0], subtype:null, text:ifc.text, via:'interface' }; } }
    /* device target for a product: named device = name evidence; class = hint */
    if(F.device) F.constraints.push({ kind:'device', device:F.device, span:null, hard:false, label:'for '+F.device.label, hint:F.device.kind==='class' });
    /* --- intent (structural) --- */
    var has=function(id){ return intents.some(function(s){ return s.value.id===id; }); };
    intents.forEach(function(s){ bind(s,'intent'); });
    var countCue=intents.filter(function(s){ return s.value.id==='count'; })[0];
    var subjConcrete=F.subject && (F.subject.kind==='sku'||F.subject.kind==='model'||F.subject.kind==='name'||F.subject.kind==='anchors');
    /* use case with catalogue families (lexicon data) becomes a recommendable subject; two+ device classes = multi-device */
    var LUC=L.useCases||{}, nClasses=uniq(spans.filter(function(x){ return x.type==='DEVICECLASS'; }).map(function(x){ return x.value.id; })).length;
    if(nClasses>=2 && !(F.useCase && LUC[F.useCase] && (LUC[F.useCase].families||[]).length)) F.useCase='multi_device';
    var ucFams=F.useCase && LUC[F.useCase] ? (LUC[F.useCase].families||[]) : [];
    F.useCaseFamilies=ucFams;
    var defining=F.constraints.some(function(c){ return (/^(connector|pair|family|name|standard|form)$/.test(c.kind) && !c.affirmBase) || (c.kind==='nametoken'&&c.hard); });
    var cmpCue=intents.some(function(s){ return s.value.id==='compare'||s.value.id==='comparative'; });
    if(!F.subject && !defining && (F.followUp || F.refPronoun || (cmpCue && !anchors.length))) { F.needsContext=true; }
    var contentLeft=spans.filter(function(s){ return CONTENT_TYPES[s.type] && s.type!=='INTENT'; }).length;
    var onlyTalk=!contentLeft && !intents.length && (F.discourse.length || spans.every(function(s){ return s.type==='FUNCTION'||s.type==='SYM'||s.type==='DISCOURSE'||s.type==='REF'; }));
    if(onlyTalk && F.discourse.length){ F.intent='SMALLTALK'; F.why.push('discourse only'); }
    else if(has('coach')){ F.intent='COACH'; F.why.push('sales-coach cue (out of v2-1 scope; routed as today)'); }
    else if(has('inventory')){ F.intent='INVENTORY'; F.inventory={ qty:intents.some(function(s){ return s.value.id==='inventory' && (s.value.qty||/ilan|left|natira|natitira|remaining/.test(s.value.word||'')); }) }; F.why.push('inventory sense'); }
    else if(has('history')||F.fields.indexOf('price_history')>=0){ F.intent='PRICE_HISTORY'; F.why.push('history cue'); }
    else if(has('nodata')){ F.intent='NODATA'; F.why.push('asks for data the pricelist does not hold (sales rank / release date)'); }
    else if(has('alternative') || ((has('comparative')||F.metricPref) && anchors.length===1 && !has('compare'))){ F.intent='ALTERNATIVE'; F.why.push('alternative / cheaper-than an anchor'); }
    else if(F.external && (F.subject || F.constraints.length || has('compat'))){ F.intent=subjConcrete?'COMPAT':'RECOMMEND'; F.judge=true; F.why.push('outside-knowledge term ('+F.external.join(', ')+') -> official source'); }
    else if(has('compare') || (has('comparative') && F.subject && F.subject.kind==='anchors')){ F.intent='COMPARE'; F.judge=has('judge')||has('recommend'); F.compare={ codes:F.subject&&F.subject.codes?F.subject.codes:[], metric:metricOf(spans,toks,true)||F.metricWord||null }; F.why.push('compare cue'+(F.judge?' + judgement':'')); }
    else if(has('compat') && (F.device || subjConcrete)){ F.intent='COMPAT'; F.why.push('fit/compat cue + '+(F.device?F.device.kind+' device':'product')); }
    else if((has('judge')||has('recommend')) && !countCue && !has('rankMin') && !has('rankMax')){ F.intent='RECOMMEND'; F.judge=true; F.why.push('judgement / recommendation cue'); }
    else if(F.useCase && ucFams.length && !countCue && !has('rankMin') && !has('rankMax')){ F.intent='RECOMMEND'; F.why.push('use case "'+F.useCase+'" -> families '+ucFams.join('/')); }
    else if(countCue){
      var after=spans.filter(function(s){ return s.from>=countCue.to && s.type!=='FUNCTION' && s.type!=='SYM' && s.type!=='REF'; })[0];
      var measure=after && after.type==='FIELD' && MEASURE_FIELD[after.value.id] ? after.value.id : null;
      if(measure && (subjConcrete || F.needsContext)){ F.intent='ATTRIBUTE'; F.field=measure; F.why.push('count cue + measure noun "'+after.text+'" + concrete subject -> attribute'); }
      else if(measure){ F.intent='ATTRIBUTE'; F.field=measure; F.why.push('count cue + measure noun + family subject -> attribute list'); }
      else { F.intent='COUNT'; F.why.push('count cue + product noun phrase -> count'); }
    }
    else if(has('rankMin')||has('rankMax')){ var rs=intents.filter(function(s){ return s.value.id==='rankMin'||s.value.id==='rankMax'; })[0];
      var w0=rs.value.word.replace(/^pinaka /,'pinaka'), intrinsic=O.RANK_METRICS[w0];
      var priceWord=/^(cheapest|least expensive|pinakamura|pinakamurang|lowest price|pinakamababang presyo|most expensive|priciest|pinakamahal|pinakamahal na|highest price|mura)$/.test(w0);
      var metric=priceWord?'price':(metricOf(spans,toks,false)||intrinsic||'price');
      if(metric==='size'||metric==='value'){ var ks=(L.keySpecs||{})[F.subject&&F.subject.family]||[]; metric=ks[0]==='mah'?'mah':ks[0]==='watts'?'watts':ks[0]==='lengthM'?'length':ks[0]==='ports'?'ports':'price'; }
      var dir=rs.value.id==='rankMin'?'asc':'desc'; if(metric!=='price' && /lowest|pinakamababa|smallest|shortest|pinakamaikli/.test(rs.value.word)) dir='asc';
      F.intent='RANK'; F.rank={ metric:metric, dir:dir }; F.why.push('superlative "'+rs.value.word+'" -> rank by '+metric+' '+dir); }
    else if(has('recommend')){ F.intent='RECOMMEND'; F.why.push('recommend cue'); }
    else if(has('alternative')){ F.intent='FIND'; F.alternative=true; F.why.push('more options'); }
    else if(F.field && (subjConcrete || F.needsContext)){ F.intent='ATTRIBUTE'; F.why.push('field + concrete subject'); }
    else if(has('exist')){ F.intent='EXIST'; F.why.push('existence cue'); }
    else if(F.subject && subjConcrete && !F.constraints.filter(function(c){ return c.kind!=='device'; }).length && !F.field){ F.intent='ATTRIBUTE'; F.field='overview'; F.why.push('bare product name -> lookup'); }
    else if(F.subject || F.constraints.filter(function(c){ return c.kind!=='device'; }).length){ F.intent=F.field&&PRICE_FIELD[F.field]?'FIND':'FIND'; F.why.push('noun phrase -> find'); }
    else if(F.useCase || F.device){ F.intent='RECOMMEND'; F.why.push('use case / device only'); }
    else { F.intent='CLARIFY'; F.why.push('no subject, no constraint'); }
    if(F.selectCue && !anchors.length) F.needsContext=true;
    if(!F.subject && (F.relax.length || F.ordinal || F.refOther || F.yesNo)) F.needsContext=true;
    if(F.intent==='FIND' && !F.subject && !defining && !intents.length && F.constraints.length){ F.needsContext=true; F.elliptical=true; F.why.push('modifier-only phrase -> refinement of an earlier turn'); }
    var resC=F.constraints.filter(function(c){ return c.kind==='res'; })[0]; F.constraints.forEach(function(c){ if(c.kind==='hz' && resC) c.rank=resC.rank; });
    if(!F.rank && F.metricPref && /^(FIND|EXIST|RECOMMEND)$/.test(F.intent)){ var mp=F.metricPref.metric; if(mp==='size'){ var ks2=(L.keySpecs||{})[F.subject&&F.subject.family]||[]; mp=ks2[0]==='mah'?'mah':ks2[0]==='watts'?'watts':ks2[0]==='lengthM'?'length':'price'; }
      if(mp==='speed'){ var ks3=(L.keySpecs||{})[F.subject&&F.subject.family]||[]; if(ks3[0]==='watts') mp='watts'; }
      F.rank={ metric:mp, dir:F.metricPref.dir, soft:true }; F.why.push('adjective "'+F.metricPref.word+'" -> prefer '+mp+' '+F.metricPref.dir); }
    if(!F.subject && ucFams.length && F.intent==='RECOMMEND'){ F.subject={ kind:'useCase', families:ucFams, text:F.useCase }; }
    if(has('rankMin')||has('rankMax')){ if(F.intent!=='RANK'){ var rs2=intents.filter(function(s){ return s.value.id==='rankMin'||s.value.id==='rankMax'; })[0]; F.rank={ metric:metricOf(spans,toks,false)||O.RANK_METRICS[rs2.value.word]||'price', dir:rs2.value.id==='rankMin'?'asc':'desc' }; } }
    return F;
  }
  function yesNoField(s){ if(s.type==='COLOR') return 'colour'; if(s.type==='NUMUNIT') return s.value.dim==='watts'?'watts':s.value.dim==='mah'?'mah':s.value.dim==='length'?'length':'description';
    if(s.type==='CONNECTOR'||s.type==='CONN_PAIR') return 'connector'; if(s.type==='PORTCOUNT') return 'ports'; if(s.type==='PRICE') return 'price'; return 'description'; }
  function opWord(op,price){ return op==='>='?'at least ':op==='>'?'over ':op==='<='?(price?'under ':'up to '):op==='<'?'under ':op==='~'?'around ':''; }
  function opNear(s,toks){ var after=toks.slice(s.to,s.to+3).map(function(x){ return x.t; }).join(' '), before=toks.slice(Math.max(0,s.from-2),s.from).map(function(x){ return x.t; }).join(' ');
    var k; for(k in MEASURE_OPS){ if((' '+after+' ').indexOf(' '+k+' ')>=0 || (' '+before+' ').indexOf(' '+k+' ')>=0) return MEASURE_OPS[k]; }
    if(toks[s.to] && toks[s.to].t==='+') return '>='; if(/\b(above|over|more than)\b/.test(before)) return '>='; if(/\b(under|below|less than)\b/.test(before)) return '<=';
    return '='; }
  function fmtLen(v){ return v>=1?(Math.round(v*100)/100)+'m':Math.round(v*100)+'cm'; }
  function connLabel(c){ var O=ONT(); var id=c.id||c; var b=id==='usb'?'USB':(O.CONNECTORS[id]?O.CONNECTORS[id].label:id); return b+(c.ver?' '+c.ver:''); }
  function metricOf(spans,toks,comparative){
    var O=ONT(), t=' '+toks.map(function(x){ return x.t; }).join(' ')+' ', fieldS=spans.filter(function(s){ return s.type==='FIELD'; }).map(function(s){ return s.value.id; });
    if(fieldS.indexOf('mah')>=0) return 'mah'; if(fieldS.indexOf('watts')>=0) return 'watts'; if(fieldS.indexOf('length')>=0) return 'length'; if(fieldS.indexOf('speed')>=0) return 'speed';
    var k; for(k in O.METRIC_WORDS){ if(O.METRIC_WORDS[k].some(function(w){ return t.indexOf(' '+w+' ')>=0 || t.indexOf('mas '+w)>=0; })) return k; }
    return null;
  }

  /* =====================================================================================================
     H. COVERAGE LEDGER
     ===================================================================================================== */
  function ledger(spans,F){
    var S={ BOUND:0, UNCONFIRMABLE:0, UNRESOLVED:0, AMBIGUOUS:0, UNUSED:0 }, meaningful=0, accounted=0, unresolved=[], ambiguous=[], silent=[];
    spans.forEach(function(s){
      if(s.type==='UNKNOWN'){ s.state='UNRESOLVED'; s.slot=null; }
      else if(s._unres || s.type==='ORDLAST'){ s.state='UNRESOLVED'; s.slot=null; if(s.type==='ORDLAST') s.impact='high'; }   /* v2-2B: "last" has no contract yet; impossible / conflicting version */
      else if(s._amb){ s.state='AMBIGUOUS'; s.impact='high'; }   /* v2-2B: no-slot quantifier, generation with several interfaces */
      else if(s.type==='AMBIG'){ s.state='AMBIGUOUS'; }
      else if(s.senseState==='AMBIGUOUS' && (s.impact==='high')){ s.state='AMBIGUOUS'; }
      else if(s.slot){ s.state=s.state==='UNCONFIRMABLE'?'UNCONFIRMABLE':'BOUND'; }
      else if(s.type==='NUMBER'){ s.state='UNRESOLVED'; }
      else if(s.type==='NEG'||s.type==='THOUSAND'||s.type==='UNITWORD'||s.type==='COUNTWORD'||s.type==='RELAXCUE'||s.type==='RELAXNEG'||s.type==='QUANT'||s.type==='VERSION'){ s.state='UNRESOLVED'; }
      else { s.state='UNUSED'; }
      var isContent=!(s.type==='FUNCTION'||s.type==='SYM'||s.type==='GENDER'||s.type==='REF'||s.type==='DISCOURSE');
      if(isContent) meaningful+=(s.to-s.from);
      if(isContent && s.state!=='UNUSED') accounted+=(s.to-s.from);
      S[s.state]=(S[s.state]||0)+1;
      if(s.state==='UNRESOLVED') unresolved.push({ span:s.id, text:s.text, kind:s.type==='UNKNOWN'?(nameLike(s,spans)?'name-like':'word'):s.type.toLowerCase(), adjacentTo:adjType(s,spans) });
      if(s.state==='AMBIGUOUS') ambiguous.push({ span:s.id, text:s.text, candidates:(s.candidates||[]).map(function(c){ return c.id+'='+c.score; }) });
      if(s.state==='UNUSED') silent.push({ span:s.id, text:s.text, type:s.type });
    });
    var coverage=meaningful?Math.round(accounted/meaningful*1000)/1000:1;
    var bound=spans.filter(function(s){ return s.state==='BOUND' && !(s.type==='FUNCTION'||s.type==='SYM'||s.type==='GENDER'||s.type==='REF'||s.type==='DISCOURSE'); });
    var conf=bound.reduce(function(a,s){ return a*Math.max(0.3,s.conf||1); },1);
    if(unresolved.length) conf*=0.6; if(ambiguous.length) conf*=0.6;
    return { states:S, coverage:coverage, boundCoverage:meaningful?Math.round(bound.reduce(function(a,s){ return a+(s.to-s.from); },0)/meaningful*1000)/1000:1,
      unresolved:unresolved, ambiguous:ambiguous, silentDrops:silent, confidence:Math.round(conf*100)/100, level:conf>=0.8?'high':conf>=0.5?'medium':'low' };
  }
  function adjType(s,spans){ var i=spans.indexOf(s), p=spans[i-1], n=spans[i+1]; return [p&&p.type, n&&n.type].filter(Boolean).join('|'); }
  function nameLike(s,spans){ var w=s.text; return w.length>=4 && /^[a-z][a-z0-9]+$/.test(w) && !/^(ang|mga|yung|para|paano|ganun|talaga|siguro|baka|kasi|lahat|ganito|iyong|kayong)$/.test(w); }

  /* =====================================================================================================
     I. SHADOW EXECUTOR (tri-state evaluation over the typed graph)
     ===================================================================================================== */
  var CONF='CONFIRMED', UNK='UNKNOWN', CONTRA='CONTRADICTED', INF='INFERRED';
  /* V2-2C C1 evidence model (design §7): CONFIRMED = stated (name / governed field); INFERRED = follows from a governed ontology
     relation (USB naming equivalence, retractable => built-in); never counted as exact and always labelled; UNKNOWN = no
     governed evidence either way; CONTRADICTED = a governed field states a conflicting value. Absence is UNKNOWN, except for
     the name-defined slots (form, standard, name, nametoken, nametext, pair, family). */
  function usbSame(a,b){ return a===b || (ONT().USB_NAMING||[]).some(function(r){ return r.names.indexOf(a)>=0 && r.names.indexOf(b)>=0; }); }
  function versionState(iface,want,have){ if(have==null || want==null) return UNK; var O=ONT(), h=O.canonVersion(iface,have); if(h==null) return UNK; if(h===want) return CONF;
    if(iface==='usb'){
      /* V2-2C C1 (review R3): a bare Gen request ("usb-c gen 1") matches the Gen a name states (3.1 Gen 1 / 3.2 Gen 1); USB 3.0 is the
         same 5 Gbps rate (INFERRED); a name with "3.1" / "3.2" and no Gen is UNKNOWN; only a different stated Gen contradicts */
      if(/^g/.test(want)){ var hg=(h.match(/g(\d(?:x\d)?)$/)||[])[1]; if(hg) return 'g'+hg===want?CONF:CONTRA; if(/^(3\.1|3\.2)$/.test(h)) return UNK; if(h==='3.0' && want==='g1') return INF; return CONTRA; }
      if(/^(3\.1|3\.2)$/.test(h) && want.indexOf(h+'g')===0) return UNK;   /* "USB 3.2" in a name does not state which Gen */
      if(/^(3\.1|3\.2)$/.test(want) && h.indexOf(want+'g')===0) return CONF;
      if(usbSame(h,want)) return INF; }
    return CONTRA; }
  function connWant(c){ var O=ONT(), f=O.interfaceOf(c.id); if(!f || !(c.ver||c.gen)) return null; return O.canonVersion(f,f==='usb'?(c.ver||'')+(c.gen||''):(c.ver||c.gen)); }
  function ifaceVersions(g,iface){ var O=ONT(), out=[]; ((O.INTERFACES[iface]||{}).connectors||[]).forEach(function(k){ if(g.versions[k]!=null) out.push(g.versions[k]); }); return out; }
  function evalC(g,c,C){
    var O=ONT();
    if(c.polNull) return UNK;   /* v2-2B: unclear negation scope is never confirmed (BA2) */
    switch(c.kind){
      case 'lanes': return g.lanes==null?UNK:(g.lanes===c.n?CONF:CONTRA);
      case 'version': return UNK;   /* a generation with no interface cannot be evaluated */
      case 'ifaceVersion': {   /* V2-2C C1: version:<interface> evaluated against graph versions */
        var vs=c.bind?(g.versions[c.bind]!=null?[g.versions[c.bind]]:[]):ifaceVersions(g,c.iface); if(!vs.length) return UNK;
        var st0=vs.map(function(v){ return versionState(c.iface,c.gen,v); }); return st0.indexOf(CONF)>=0?CONF:(st0.indexOf(INF)>=0?INF:(st0.indexOf(UNK)>=0?UNK:CONTRA)); }
      case 'notVersion': {   /* V2-2C C1 (#5): excluded version; the connector itself is a separate affirmed constraint */
        var nv=c.id&&g.versions[c.id]!=null?[g.versions[c.id]]:ifaceVersions(g,c.iface); if(!nv.length) return UNK;
        var sv=nv.map(function(v){ return versionState(c.iface,c.ver,v); }); return sv.indexOf(CONF)>=0||sv.indexOf(INF)>=0?CONTRA:(sv.indexOf(UNK)>=0?UNK:CONF); }
      case 'family': return (g.family===c.family && (!c.subtype||g.subtype===c.subtype))?CONF:CONTRA;
      case 'notFamily': return g.family===c.family?CONTRA:CONF;
      case 'name': return c.codes.indexOf(g.code)>=0?CONF:CONTRA;
      case 'nametoken': return new RegExp('\\b'+esc(c.word)+'\\b').test(g.lname)?CONF:CONTRA;
      case 'nametext': return new RegExp(c.re).test(g.lname)?CONF:CONTRA;
      case 'num': {
        var val=c.attr==='watts'?g.watts:c.attr==='mah'?g.mah:c.attr==='lengthM'?g.lengthM:c.attr==='gbps'?(g.gbps||g.ethGbps):null;
        if(val==null) return UNK;
        if(c.op==='>=') return val>=c.v-1e-9?CONF:CONTRA; if(c.op==='<=') return val<=c.v+1e-9?CONF:CONTRA; if(c.op==='>') return val>c.v+1e-9?CONF:CONTRA; if(c.op==='<') return val<c.v-1e-9?CONF:CONTRA;
        return Math.abs(val-c.v)<1e-6?CONF:CONTRA; }
      case 'size': { if(!g.size) return UNK; return (c.v>=g.size.lo-0.05 && c.v<=g.size.hi+0.05)?CONF:CONTRA; }
      case 'hz': { var re=new RegExp('\\b'+c.v+' ?hz\\b'); if(re.test(g.lname)) return CONF; if(g.hzRes.some(function(m){ return m.hz>=c.v && (!c.rank || m.r>=c.rank); })) return CONF; return g.hzRes.length?CONTRA:UNK; }
      case 'price': { if(g.srp==null) return UNK; if(c.op==='>=') return g.srp>=c.v?CONF:CONTRA; if(c.op==='~') return Math.abs(g.srp-c.v)<=c.v*0.25?CONF:CONTRA; return g.srp<=c.v?CONF:CONTRA; }
      case 'res': return g.res==null?UNK:(g.res>=c.rank?CONF:CONTRA);
      case 'colour': { var cr=g.color?(g.color.indexOf(c.v)>=0?CONF:CONTRA):UNK; return c.neg?(cr===CONF?CONTRA:(cr===CONTRA?CONF:UNK)):cr; }
      case 'standard': { var sd=O.STANDARDS[c.id]; var hit=sd.aliases.some(function(a){ return new RegExp('\\b'+esc(a)+'\\b(?![a-z0-9])').test(g.lname); }); return hit?CONF:(g.family===sd.family?CONTRA:CONTRA); }
      case 'form': { var fr=FORM_NAME_RE[c.form]; if(!fr) return UNK; var fo=(fr.test(g.lname) || (c.form==='adapter' && /adapter|converter/i.test(g.category)) || (c.form==='cable' && /\bcable\b/i.test(g.category)))?CONF:CONTRA; return c.neg?(fo===CONF?CONTRA:CONF):fo; }
      case 'connector': {
        /* V2-2C C1 (§7 rule 2): a connector the listing does not name is UNKNOWN, never CONTRADICTED (other named connectors are
           not evidence of absence); a connector named only as the power input still contradicts a data / video request */
        if(c.id==='usb'){ var any=/\busb\b|usb-?[abc]\b/.test(g.lname) || g.conns.all.some(function(k){ return /^usb|micro_usb/.test(k); }); if(!any) return UNK;
          var uw=connWant(c); if(!uw) return CONF; var uv=ifaceVersions(g,'usb'); if(!uv.length) return UNK;   /* V2-2C C1: a versioned "usb" request is evaluated */
          var us=uv.map(function(v){ return versionState('usb',uw,v); }); return us.indexOf(CONF)>=0?CONF:(us.indexOf(INF)>=0?INF:(us.indexOf(UNK)>=0?UNK:CONTRA)); }
        if(c.role==='plug' && g.plugs.length){ if(g.plugs.indexOf(c.id)<0 && !(c.id==='usb' && g.plugs.some(function(k){ return /^usb/.test(k); }))) return CONTRA; }
        var inMain=g.conns.main.indexOf(c.id)>=0 || (g.pair && (g.pair.from.indexOf(c.id)>=0||g.pair.to.indexOf(c.id)>=0));
        var st=inMain?CONF:(g.conns.power.indexOf(c.id)>=0?CONTRA:UNK);
        if(st===CONF && (c.ver||c.gen)){ var gv=g.versions[c.id], ifv=O.interfaceOf(c.id), cw=connWant(c); if(gv && ifv && cw) st=versionState(ifv,cw,gv); else if(gv && c.ver && gv!==c.ver) st=CONTRA; else if(!gv) st=UNK; }
        /* V2-2C G3: an explicit count is re-checked for an INFERRED version too (a Gen inferred from USB 3.0 never bypasses "2 usb-c"):
           a stated sufficient count keeps the state, a stated smaller count contradicts, an unstated count is UNKNOWN */
        if((st===CONF||st===INF) && c.count && g.ports && g.ports.byKind && g.ports.byKind[c.id]!=null){ return g.ports.byKind[c.id]>=c.count?st:CONTRA; }
        if((st===CONF||st===INF) && c.count){ var NW={ dual:2, double:2, twin:2, triple:3, quad:4 }, mm=g.lname.match(new RegExp('(\\d|dual|double|twin|triple|quad)\\s?[x*]?\\s?'+connAliasRe(c.id)+'\\b')); var cnt=mm?(NW[mm[1]]||+mm[1]):null;
          if(cnt!=null && cnt<c.count) st=CONTRA; else if(cnt==null) st=UNK; }
        return st; }
      /* V2-2C C1 (§7 rule 2): absence is not a confirmed "without"; a connector named in the name OR listed in the features
         (governed, medium tier) contradicts the exclusion; otherwise UNKNOWN (kept and labelled "not stated") */
      case 'notConnector': return (g.conns.all.indexOf(c.id)>=0 || g.conns.feat.indexOf(c.id)>=0)?CONTRA:UNK;
      case 'component': {
        if(c.family==='card_reader') return (g.conns.all.indexOf('sd')>=0||g.conns.all.indexOf('tf')>=0||/card reader|\bsd\b|\btf\b/.test(g.lname))?CONF:(g.conns.feat.indexOf('sd')>=0||g.conns.feat.indexOf('tf')>=0?CONF:CONTRA);
        var fd=(LEX().taxonomy.families||[]).filter(function(f){ return f.id===c.family; })[0]; var words=fd?(fd.nameCues||[]).concat([fd.label]):[];
        return words.some(function(w){ return new RegExp('\\b'+esc(w)).test(g.lname); })?CONF:UNK; }
      case 'pair': {
        if(!g.pair){ var both=g.conns.all.indexOf(c.from.id)>=0 && c.to.every(function(t){ return g.conns.all.indexOf(t.id)>=0; }); return both?UNK:CONTRA; }
        var fwd=g.pair.from.indexOf(c.from.id)>=0 && c.to.every(function(t){ return g.pair.to.indexOf(t.id)>=0; });
        /* an "A to B" request means a single-purpose adapter/cable; a multiport dock that also has B matches only when a hub/dock is asked for */
        if(fwd && g.family==='hub_dock' && !c.multiport && g.pair.to.length>c.to.length+1) return CONTRA;
        if(fwd) return CONF;
        var rev=c.to.some(function(t){ return g.pair.from.indexOf(t.id)>=0; }) && g.pair.to.indexOf(c.from.id)>=0;
        if(rev && g.pair.bidi) return CONF;
        return CONTRA; }
      case 'role': {
        if(c.role==='power_input'){ if(c.conn){ return g.conns.power.indexOf(c.conn)>=0?CONF:(g.feats.power_port||g.feats.passthrough?UNK:UNK); }
          var f=g.feats.power_port||g.feats.passthrough; return f&&f.state===CONF?CONF:(f&&f.state===CONTRA?CONTRA:UNK); }
        return UNK; }
      case 'feature': {
        var fe=g.feats[c.id]; var s=fe?fe.state:UNK;
        if(c.id==='wireless' && !fe && /\bwired\b/.test(g.lname)) s=CONTRA;
        /* V2-2C C1 (#6): a governed relation (retractable => built-in) gives INFERRED, never CONFIRMED */
        if(!fe){ var IMP=O.FEATURE_IMPLIES||{}; Object.keys(IMP).forEach(function(k){ if(IMP[k].indexOf(c.id)>=0 && g.feats[k] && g.feats[k].state===CONF) s=INF; }); }
        if(c.neg) return (s===CONF||s===INF)?CONTRA:(s===CONTRA?CONF:UNK);
        return s; }
      case 'ports': {
        if(c.in1){ if(g.in1!=null) return g.in1===c.n?CONF:CONTRA; return UNK; }
        var tot=g.ports&&g.ports.total; if(tot==null && g.in1!=null && g.family==='hub_dock') return UNK;
        if(tot==null) return UNK; if(c.op==='>='||c.op==='>') return tot>=c.n+(c.op==='>'?1:0)?CONF:CONTRA; if(c.op==='<='||c.op==='<') return tot<=c.n-(c.op==='<'?1:0)?CONF:CONTRA; return tot===c.n?CONF:CONTRA; }
      case 'device': {
        var d=c.device; if(g.targets.indexOf(d.id)>=0 || (d.kind==='class' && g.targets.indexOf('class:'+d.id)>=0)) return CONF;
        return UNK; }
    }
    return UNK;
  }
  function connAliasRe(id){ var O=ONT(); var a=(O.CONNECTORS[id]||{ aliases:[id] }).aliases.slice().sort(function(x,y){ return y.length-x.length; }); return '(?:'+a.map(esc).join('|')+')'; }
  var RELAX_ORDER=['colour','price','form','nametoken:soft','feature:soft','size','num:lengthM','hz','res','num:gbps','device','role','feature:hard','num:watts','num:mah','ports','connector','standard','nametext','pair','name','family'];
  function relaxKey(c){ if(c.kind==='num') return 'num:'+c.attr; if(c.kind==='feature') return 'feature:'+(c.hard?'hard':'soft'); if(c.kind==='nametoken') return 'nametoken:'+(c.hard?'hard':'soft'); return c.kind; }
  function isExcl(c){ return !!(c.neg || c.kind==='notConnector' || c.kind==='notFamily' || c.kind==='notVersion'); }
  function baseCodes(F,C){
    var s=F.subject;
    if(s && s.codes) return s.codes.filter(function(c){ return C.G[c]; });
    if(s && s.families) return C.order.filter(function(c){ return C.G[c] && s.families.indexOf(C.G[c].family)>=0; });
    if(s && s.family){ return (C.byFam[s.family]||[]).filter(function(c){ return !s.subtype || C.G[c].subtype===s.subtype || (s.family==='network_adapter' && s.subtype==='wifi' && /wi-?fi|wireless|dual[- ]band|wlan/.test(C.G[c].lname)); }); }
    return C.order.filter(function(c){ return C.G[c]; });
  }
  /* V2-2C C1: inf = INFERRED matches (never exact); xunk = exclusions the listing neither confirms nor contradicts (§7 rule 3: an
     UNKNOWN product is kept and labelled "not stated", it is not a missing requirement) */
  function scoreSet(codes,cons,C){
    return codes.map(function(c){ var g=C.G[c], st={}, conf=0, unk=0, contra=0, inf=0, xunk=0;
      cons.forEach(function(k,i){ var r=evalC(g,k,C); st[i]=r; if(r===CONF) conf++; else if(r===INF) inf++; else if(r===UNK){ if(isExcl(k)) xunk++; else unk++; } else contra++; });
      return { code:c, st:st, conf:conf, unk:unk, contra:contra, inf:inf, xunk:xunk }; });
  }
  function metricVal(g,m){ return m==='price'?g.srp:m==='mah'?g.mah:m==='watts'?g.watts:m==='length'?g.lengthM:m==='speed'?(g.gbps||g.ethGbps):m==='ports'?(g.ports&&g.ports.total):null; }
  /* V2-2C C1 (§7 rule 4): rows with no value for the metric are kept AFTER the ranked rows (never silently dropped) */
  function rankCodes(codes,rank,C){
    if(!rank) return codes.slice();
    var withV=codes.filter(function(c){ return metricVal(C.G[c],rank.metric)!=null; }), noV=codes.filter(function(c){ return metricVal(C.G[c],rank.metric)==null; });
    var pos={}; codes.forEach(function(c,i){ pos[c]=i; });
    withV.sort(function(a,b){ var x=metricVal(C.G[a],rank.metric), y=metricVal(C.G[b],rank.metric); return (rank.dir==='asc'?x-y:y-x) || pos[a]-pos[b]; });
    return withV.concat(noV);
  }
  function execute(P,opts){
    var t0=now(), C=P._C, F=P.frame, O=ONT(), out={ route:null, kind:null, codes:[], label:null, notes:[], interpretation:[], unconfirmed:[], ladder:[], values:[], hint:null };
    /* V2-2C C1 (review sweep): the connector re-affirmed beside a version exclusion ("not HDMI 2.1") is an A5 frame fact for the resolver;
       the single-turn executor applies only the exclusion, so "charger not hdmi 2.1" never becomes a search for HDMI chargers */
    var cons=F.constraints.filter(function(c){ return !c.affirmBase && !(c.kind==='device' && (F.intent==='COMPAT'||c.hint)); });
    function lab(codes){ return buildLabel(codes,F,C); }
    P.spans.forEach(function(s){ if((s.senseState==='SURFACED' || s.senseState==='FORCED') && s.impact!=='low' && s.type!=='FUNCTION'){ var se=(s.candidates||[]).filter(function(x){ return x.id===s.selected; })[0]; if(se) out.interpretation.push(interpText(s,se)); } });
    /* routes that need no product search */
    if(F.intent==='SMALLTALK'){ out.route='LOCAL'; out.kind='smalltalk'; return fin(); }
    if(F.intent==='NODATA'){ out.route='LOCAL'; out.kind='no-data'; out.notes.push('Wala sa pricelist ang sales ranking o release dates, kaya hindi ko masasabi ang best seller / pinakabago. I can list by price, specs or family.'); return fin(); }
    if(F.intent==='ALTERNATIVE'){ var alt=alternatives(F,cons,C,P); if(alt) { Object.keys(alt).forEach(function(k){ out[k]=alt[k]; }); out.route='LOCAL'; out.label=lab(out.codes); return fin(); } }
    if(F.intent==='COACH'){ out.route='COACH'; out.kind='coach'; out.notes.push('Sales-coach question: not part of v2-1; the current coach route applies.'); return fin(); }
    if(!F.subject && F.needsContext){ out.route='CONTEXT'; out.kind='needs-context'; out.notes.push('Reference to an earlier turn: context resolution is v2-2 (QueryPlan delta).'); if(F.intent==='INVENTORY') out.notes.push('Wala akong live inventory data; I can only confirm what is listed in the current pricelist.'); return fin(); }
    if(F.intent==='CLARIFY' || (F.intent==='RECOMMEND' && !F.subject && !cons.filter(function(c){ return c.kind!=='device'; }).length && !(F.device&&F.device.kind==='named'))){ out.route='CLARIFY'; out.kind='clarify'; out.notes.push(F.useCase?'Which product type for '+O.USE_CASES[F.useCase].label+'?':'Which product type or SKU?'); return fin(); }
    if(!F.subject && F.needsContext){ out.route='CONTEXT'; out.kind='needs-context'; out.notes.push('Reference to an earlier turn: context resolution is v2-2 (QueryPlan delta).'); return fin(); }
    var unresolvedHard=P.ledger.unresolved.filter(function(u){ return u.kind==='name-like' || u.kind==='neg' || u.kind==='relaxneg' || /FAMILY|NAME|FORM|ANCHOR/.test(u.adjacentTo); });   /* v2-2B: an unresolved negator blocks a confident exact answer */
    var ambHigh=P.ledger.ambiguous;
    if(ambHigh.length){ out.route='CLARIFY'; out.kind='clarify'; out.notes.push('Ambiguous: '+ambHigh.map(function(a){ return '"'+a.text+'" ('+a.candidates.join(' / ')+')'; }).join('; ')); return fin(); }
    if(!F.subject && !cons.length && unresolvedHard.length){ out.kind='not-found'; out.route='LOCAL'; out.notes.push('Wala akong nakitang "'+unresolvedHard.map(function(u){ return u.text; }).join(' ')+'" sa pricelist names (unknown word, not inherited).'); return fin(); }
    if(F.device && F.device.kind==='class' && !F.subject && !F.constraints.some(function(c){ return /^(connector|pair|family|name|standard|num|ports|feature)$/.test(c.kind); })){
      out.route='CLARIFY'; out.kind='clarify'; out.notes.push('Which connection does your '+F.device.label+' have? Likely: '+(F.device.likely||[]).map(function(k){ return connLabel(k); }).join(' / ')+' (a hint, not a confirmation).'); return fin(); }
    var base=baseCodes(F,C);
    var sc=scoreSet(base,cons,C);
    var exact=sc.filter(function(x){ return x.contra===0 && x.unk===0 && !x.inf; }).map(function(x){ return x.code; });
    var inferred=sc.filter(function(x){ return x.contra===0 && x.unk===0 && x.inf>0; }).map(function(x){ return x.code; });   /* V2-2C C1: governed relation only */
    if(exact.length>1){ var strength=function(code){ var g=C.G[code], n=0; cons.forEach(function(c){ if(c.kind==='feature'||c.kind==='role'){ var fe=g.feats[c.id]||g.feats.power_port||g.feats.passthrough; if(c.kind==='feature') fe=g.feats[c.id]; if(fe && fe.tier==='strong') n++; } }); return n; };
      var pos0={}; exact.forEach(function(c,i){ pos0[c]=i; }); exact.sort(function(a,b){ return strength(b)-strength(a) || pos0[a]-pos0[b]; }); }
    var partialRows=sc.filter(function(x){ return x.contra===0 && x.unk>0; });
    out.ladder.push({ step:'exact', n:exact.length });
    /* V2-2C C1: a product SEARCH with no subject and nothing to filter is never "exact" (price history, counts and rankings are
       catalogue-wide by definition and keep their scope) */
    var chosen=exact, kind=(!F.subject && !cons.length && !/^(PRICE_HISTORY|COUNT|RANK)$/.test(F.intent))?'all':'exact';
    var wholeCat=!F.subject && base.length===C.order.filter(function(c){ return C.G[c]; }).length;
    var DEFINING=function(c){ return !isExcl(c) && !c.polNull && /^(form|connector|pair|standard|name|family|component)$/.test(c.kind) || (c.kind==='nametoken' && c.hard && !isExcl(c)); };
    var defCons=cons.filter(DEFINING);
    function flood(n){ out.ladder.push({ step:'no-subject-flood', n:n }); out.route='CLARIFY'; out.kind='clarify'; out.codes=[]; out.flood=n; out.label=null;
      out.notes.push(defCons.length?'No listed product states '+defCons.map(function(c){ return c.label; }).join(' + ')+'; which product type do you need?':'Which product type? (no product type in the question; '+n+' items across families would only partly match).'); return fin(); }
    /* the flood guard applies only when no proposed product CONFIRMS a defining constraint of the question (a named form /
       connector / pair / standard / name is a product type in itself: "usb-c to hdmi dp alt mode", "thunderbolt 4 cable") */
    function floods(codes){ return wholeCat && codes.length && uniq(codes.map(function(c){ return C.G[c].family; })).length>1 && !codes.some(function(code){ return defCons.some(function(c){ return evalC(C.G[code],c,C)===CONF; }); }); }
    /* V2-2C C1: INFERRED matches (USB naming equivalence, retractable => built-in) are listed after the stated ones and labelled;
       a set that contains any inferred match is never called exact */
    if(inferred.length){ chosen=exact.concat(inferred); kind='inferred'; out.exactCodes=exact.slice(); out.inferred=inferred.slice();
      var infL=cons.filter(function(c,i){ return sc.some(function(x){ return inferred.indexOf(x.code)>=0 && x.st[i]===INF; }); }).map(function(c){ return c.label; });
      out.notes.push('Inferred, not stated in the listing: '+infL.join(', ')+' ('+inferred.length+' item'+(inferred.length>1?'s':'')+').'); out.ladder.push({ step:'inferred', n:inferred.length }); }
    /* ladder step 1: plausible alternative sense (never chosen because of results alone) */
    if(!chosen.length && cons.length && opts && !opts._noAlt){
      var alt=altSenses(P);
      for(var a=0;a<alt.length && !chosen.length;a++){
        var force={}; force[alt[a].span]=alt[a].sense;
        var P2=parse(P.q,Object.assign({},opts,{ _force:force, _noAlt:true }));
        var r2=execute(P2,Object.assign({},opts,{ _noAlt:true }));
        out.ladder.push({ step:'alt-sense', span:alt[a].text, sense:alt[a].sense, plausibility:alt[a].why, n:r2.kind==='exact'?r2.codes.length:0 });
        if(r2.kind==='exact' && r2.codes.length){ r2.interpretation.unshift(interpText({ term:alt[a].text },{ id:alt[a].sense })); r2.ladder=out.ladder.concat(r2.ladder); r2.altSense=alt[a]; r2.ms=Math.round((now()-t0)*100)/100; return r2; }
      }
    }
    /* ladder step 2: UNKNOWN-tolerant (never presented as confirmed) */
    /* an UNKNOWN that is the only thing separating the request from the whole subject is not an answer: say none is confirmed */
    if(!chosen.length && partialRows.length && partialRows.length===sc.filter(function(x){ return x.contra===0 || cons.every(function(c,i){ return x.st[i]!==CONTRA || c.kind==='feature' || c.kind==='role'; }); }).length && cons.length && cons.every(function(c,i){ return partialRows.every(function(x){ return x.st[i]!==CONF; }) ? (c.kind==='feature'||c.kind==='role') : true; }) && !cons.some(function(c,i){ return partialRows.some(function(x){ return x.st[i]===CONF; }) && c.kind!=='feature' && c.kind!=='role'; })){
      if(floods(partialRows.map(function(x){ return x.code; }))) return flood(partialRows.length);   /* V2-2C C1: no subject-less "none confirmed" over the catalogue */
      var unkOnly=cons.filter(function(c,i){ return partialRows.every(function(x){ return x.st[i]===UNK; }); }).map(function(c){ return c.label; });
      out.kind='none-confirmed'; out.unconfirmed=unkOnly; out.related=partialRows.slice(0,12).map(function(x){ return x.code; });
      out.notes.push('Walang naka-confirm na '+unkOnly.join(' + ')+' sa listing'+(F.subject&&F.subject.text?' para sa '+F.subject.text:'')+'; not confirmed is not the same as not available.');
      out.ladder.push({ step:'unknown-only', unconfirmed:unkOnly, n:0 }); out.route=routeOf(F,out,P); out.label=lab([]); return fin(); }
    /* V2-2C C1 (review fix): an UNKNOWN-tolerant row needs SOME positive evidence for the request: a confirmed / inferred
       constraint, or the requested connector named in the listing (its version / count unstated). A row with no evidence at all
       is never offered as a partial match; the request falls through to the relax / closest ladder (labelled) instead. */
    /* a requested connector the listing neither names nor mentions (features) is UNKNOWN evidence, but never a basis to PROPOSE the
       product: every requested connector must be named or mentioned, and the row needs >= 1 positive piece of evidence */
    var connSeen=function(g,c){ return g.conns.all.indexOf(c.id)>=0 || g.conns.feat.indexOf(c.id)>=0 || (c.id==='usb' && g.conns.all.concat(g.conns.feat).some(function(k){ return /^usb|micro_usb/.test(k); })) || (g.pair && (g.pair.from.indexOf(c.id)>=0 || g.pair.to.indexOf(c.id)>=0)); };
    /* needPos: the UNKNOWN-tolerant step also needs >= 1 positive piece of evidence on a requirement (a device is a routing hint,
       not a requirement); the relax / closest ladder only needs the connector floor (§7 rule 4: unknown specs are kept, labelled) */
    var admissible=function(code,set,needPos){ var g=C.G[code], n=0, ok=true; set.forEach(function(c){ var s=evalC(g,c,C); if(s===CONF||s===INF) n++; else if(s===UNK && c.kind==='connector'){ if(connSeen(g,c)) n++; else ok=false; } });
      return ok && (!needPos || n>0 || !set.some(function(c){ return !isExcl(c) && c.kind!=='device' && c.kind!=='version' && !c.polNull && !c.negGov; })); };   /* an unclear (negated) value, or a generation with no interface (never evaluable), is never a requirement */
    if(!chosen.length && partialRows.length){ var posRows=partialRows.filter(function(x){ return admissible(x.code,cons,true); }); if(posRows.length<partialRows.length) out.ladder.push({ step:'no-evidence-dropped', n:partialRows.length-posRows.length }); partialRows=posRows; }
    if(!chosen.length && partialRows.length){
      var minU=Math.min.apply(null,partialRows.map(function(x){ return x.unk; }));
      partialRows=partialRows.filter(function(x){ return x.unk===minU; });
      chosen=partialRows.map(function(x){ return x.code; }); kind='partial';
      var unkIdx={}; partialRows.forEach(function(x){ Object.keys(x.st).forEach(function(i){ if(x.st[i]===UNK) unkIdx[i]=1; }); });
      out.unconfirmed=Object.keys(unkIdx).map(function(i){ return cons[i].label; });
      out.ladder.push({ step:'unknown-tolerant', n:chosen.length, unconfirmed:out.unconfirmed });
    } else if(exact.length && partialRows.length && F.intent!=='COUNT'){ out.alsoUnconfirmed=partialRows.length; }
    /* ladder step 3: direction — try the reverse pair, and say so */
    var pairC=cons.filter(function(c){ return c.kind==='pair'; })[0];
    if(!chosen.length && pairC){
      var rev=cons.map(function(c){ return c===pairC?{ kind:'pair', from:pairC.to[0], to:[pairC.from], label:connLabel(pairC.to[0])+' to '+connLabel(pairC.from), hard:true }:c; });
      var sr=scoreSet(baseCodes(F,C),rev.filter(function(c){ return c.kind!=='form'; }),C).filter(function(x){ return x.contra===0; }).map(function(x){ return x.code; });
      out.ladder.push({ step:'reverse-direction', n:sr.length });
      if(sr.length){ chosen=sr; kind='closest'; out.notes.push('No exact match for '+pairC.label+'; the reverse direction ('+connLabel(pairC.to[0])+' to '+connLabel(pairC.from)+') is listed:'); }
    }
    /* ladder step 4: relax constraints one at a time in priority order (soft first); numeric -> nearest */
    if(!chosen.length && cons.length){
      var order=cons.map(function(c,i){ return { c:c, i:i, r:RELAX_ORDER.indexOf(relaxKey(c)) }; }).sort(function(a,b){ return a.r-b.r; });
      for(var k=0;k<order.length && !chosen.length;k++){
        var drop=order[k].c; if(drop.kind==='pair' || isExcl(drop)) continue;   /* v2-2B: an exclusion is never relaxed */
        if(drop.kind==='version') continue;   /* V2-2C C1 (review R3): an unevaluable generation is never "No exact match for Gen N" */
        var keep=cons.filter(function(c){ return c!==drop; });
        var rows=scoreSet(baseCodes(F,C),keep,C).filter(function(x){ return x.contra===0 && admissible(x.code,keep); });   /* V2-2C C1: same evidence floor as above */
        if(drop.kind==='num' && rows.length && !drop.polNull && !drop.negGov){   /* V2-2C C1 (review R2-1): never "nearest" to a value the user negated */ var near=rows.map(function(x){ var g=C.G[x.code], v=metricVal(g,drop.attr==='lengthM'?'length':drop.attr==='gbps'?'speed':drop.attr); return { code:x.code, d:v==null?Infinity:Math.abs(v-drop.v) }; }).filter(function(x){ return x.d<Infinity; });
          var md=Math.min.apply(null,near.map(function(x){ return x.d; })); rows=near.filter(function(x){ return x.d===md; }).map(function(x){ return { code:x.code }; }); }
        out.ladder.push({ step:'relax', dropped:drop.label, n:rows.length });
        if(rows.length){ chosen=rows.map(function(x){ return x.code; }); kind='closest'; out.notes.push(('No exact match for '+drop.label+'; closest options are:').replace(/\bfor for\b/,'for')); out.relaxed=drop.label; }
      }
    }
    /* ladder step 5: widen to the family / subject only */
    if(!chosen.length && cons.length && (F.subject)){
      var wide=baseCodes(F,C); out.ladder.push({ step:'widen-subject', n:wide.length });
      if(wide.length){ chosen=wide; kind='closest'; out.notes.push('No exact match for '+cons.map(function(c){ return c.label; }).join(' + ')+'; closest options in '+(F.subject.text||'this line')+':'); }
    }
    if(!chosen.length && !cons.length && base.length){ chosen=base; kind='exact'; }
    /* v2-2B EXCLUDE integrity: whatever ladder step produced the set, no product that carries an excluded value is proposed */
    var excl=cons.filter(isExcl), exclEmptied=false; if(excl.length && chosen.length){ var kept=chosen.filter(function(code){ return excl.every(function(c){ return evalC(C.G[code],c,C)!==CONTRA; }); }); if(kept.length<chosen.length) out.ladder.push({ step:'exclusion-filter', removed:chosen.length-kept.length }); exclEmptied=!kept.length; chosen=kept; }
    /* V2-2C C1 (§7 rule 3): an exclusion the listing does not settle keeps the product and says so */
    if(excl.length && chosen.length){ var ns=excl.filter(function(c){ return chosen.some(function(code){ return evalC(C.G[code],c,C)===UNK; }); }).map(function(c){ return c.label; });
      if(ns.length){ out.notStated=ns; out.notes.push('Not stated in the listing (kept, not confirmed): '+ns.join(', ')+'.'); } }
    /* V2-2C C1 (§7 rule 4): "closest" rows whose kept constraints are UNKNOWN are labelled, never presented as matching */
    if(kind==='closest' && chosen.length){ var keptC=cons.filter(function(c){ return !isExcl(c) && c.label!==out.relaxed; }), unkN=chosen.filter(function(code){ return keptC.some(function(c){ return evalC(C.G[code],c,C)===UNK; }); }).length;
      if(unkN){ out.unknownRows=unkN; out.notes.push(unkN+' of these: spec not listed.'); } }
    /* V2-2C C1: no subject-less catalogue flood. A frame with no subject that found no exact / inferred match never proposes an
       UNKNOWN-tolerant or relaxed set over the whole catalogue across families: it clarifies the product type instead */
    if(!F.subject && chosen.length && kind!=='exact' && kind!=='alternative' && floods(chosen)) return flood(chosen.length);
    /* V2-2C C1 (review fix): when the requested exclusion removed every match, say that, never "wala" */
    if(!chosen.length && exclEmptied){ kind='none'; out.ladder.push({ step:'none-after-exclusion' }); out.notes=out.notes.filter(function(n){ return !/^No exact match/.test(n); }); out.notes.push('Every listed '+(lab([])||'match')+' has '+excl.map(function(c){ return c.label.replace(/^(no|not) /,''); }).join(' / ')+' (you asked to exclude it), so none is left to show.'); }
    else if(!chosen.length){ kind='none'; out.ladder.push({ step:'none' }); out.notes.push('Wala tayong '+(lab([])||'match')+' sa current pricelist (checked: exact, alternative senses, unconfirmed, direction, relaxed, family).'); }
    /* coverage guard: an unresolved hard qualifier blocks a confident exact answer */
    if((kind==='exact'||kind==='inferred') && unresolvedHard.length){ kind='partial'; out.notes.push('Hindi ko nabasa ang "'+unresolvedHard.map(function(u){ return u.text; }).join(' ')+'": showing matches without it.'); out.unconfirmed=out.unconfirmed.concat(unresolvedHard.map(function(u){ return u.text; })); }
    /* UNCONFIRMABLE features: state them, never silently drop */
    cons.forEach(function(c,i){ if(c.kind==='feature' || c.kind==='role' || c.kind==='device'){ var any=chosen.some(function(code){ return evalC(C.G[code],c,C)===CONF; });
      if(!any && chosen.length){ var sp=P.spans.filter(function(s){ return s.id===c.span; })[0]; if(sp){ sp.state='UNCONFIRMABLE'; } if(out.unconfirmed.indexOf(c.label)<0) out.unconfirmed.push(c.label); } } });
    if(P.spans.some(function(s){ return s.state==='UNCONFIRMABLE'; })) P.ledger=ledgerRecount(P);
    /* intent-specific shaping */
    /* V2-2C C1 (review R3): in a ranking, stated matches always come before inferred ones (the "cheapest" is never an inferred row) */
    var ranked=F.rank?(kind==='inferred'&&out.exactCodes?rankCodes(out.exactCodes,F.rank,C).concat(rankCodes(out.inferred||[],F.rank,C)):rankCodes(chosen,F.rank,C)):chosen;
    if(F.rank){ var noM=ranked.filter(function(c){ return metricVal(C.G[c],F.rank.metric)==null; }).length; if(noM){ out.unrankedTail=noM; out.notes.push(noM+' listed without a '+F.rank.metric+' value (placed last).'); } }
    if(F.limit) ranked=ranked.slice(0,F.limit);
    out.codes=ranked; out.kind=kind;
    /* V2-2C C1 (review fix): a count with inferred matches counts the STATED ones and reports the inferred ones separately */
    if(F.intent==='COUNT' && kind==='inferred'){ out.count=(out.exactCodes||[]).length; out.inferredCount=(out.inferred||[]).length; out.notes.push(out.inferredCount+' more inferred, not stated in the listing (not counted).'); }
    else if(F.intent==='COUNT' && kind!=='exact'){ out.partialCodes=ranked; out.codes=[]; out.count=0; out.notes.push(kind==='partial'?ranked.length+' more listed without a confirmed '+out.unconfirmed.join(', ')+' (not counted).':'Count of exact matches: 0.'); }
    switch(F.intent){
      case 'COUNT': if(out.count==null) out.count=out.codes.length; break;
      case 'ATTRIBUTE': out.values=ranked.slice(0,12).map(function(c){ return { code:c, field:F.field, value:fieldValue(C,c,F.field) }; }); break;
      case 'COMPARE': out.values=(F.compare.codes||[]).map(function(c){ return { code:c, metric:F.compare.metric, value:C.G[c]?metricVal(C.G[c],F.compare.metric||'price'):null }; }); out.codes=F.compare.codes.slice(); break;
      case 'INVENTORY': out.notes.push('Naka-lista sa current pricelist; wala akong live inventory data'+(F.inventory&&F.inventory.qty?' (walang quantity)':'')+'.'); break;
      case 'COMPAT': out.hint=compatHint(F,ranked,C); break;
    }
    out.route=routeOf(F,out,P);
    out.label=lab(out.codes.length?out.codes:(out.partialCodes||[]));
    return fin();
    function fin(){ out.ms=Math.round((now()-t0)*100)/100; return out; }
  }
  /* alternatives to an anchor: same family (and subtype), anchor excluded; "same <spec>" keeps the key spec equal; "mas mura /
     cheaper" keeps price below the anchor; ordered by key-spec closeness then price. Extra constraints still apply (tri-state). */
  function alternatives(F,cons,C,P){
    var L=LEX(); if(!F.subject || !F.subject.codes || !F.subject.codes.length){ return null; }
    var a0=F.subject.codes.map(function(c){ return C.G[c]; }).filter(Boolean); if(!a0.length) return null; var g0=a0[0];
    var ks=((L.keySpecs||{})[g0.family]||[])[0]||null, key=ks==='lengthM'?'length':ks;
    var t=' '+P.norm+' ', same=/\bsame (wattage|watts|capacity|mah|length|specs?)\b/.exec(t), cheaper=/\b(mas mura|cheaper|mura|less expensive|mas mababa)\b/.test(t);
    var sameKey=same?(/watt/.test(same[1])?'watts':/cap|mah/.test(same[1])?'mah':/length/.test(same[1])?'length':key):null;
    var anchorModels=a0.map(function(g){ return g.model; });
    var pool=C.order.filter(function(c){ var g=C.G[c]; return g && g.family===g0.family && (!g0.subtype || g.subtype===g0.subtype) && F.subject.codes.indexOf(c)<0 && anchorModels.indexOf(g.model)<0; });
    var v0=key?metricVal(g0,key):null, notes=[];
    var poolAll=pool.filter(function(c){ return !cheaper || (C.G[c].srp!=null && g0.srp!=null && C.G[c].srp<g0.srp); });
    if(sameKey){ var sv=metricVal(g0,sameKey); if(sv!=null){ pool=pool.filter(function(c){ return metricVal(C.G[c],sameKey)===sv; }); notes.push('same '+sameKey+' as '+(g0.model||g0.code)+' ('+sv+')'); } }
    if(cheaper && g0.srp!=null){ pool=pool.filter(function(c){ return C.G[c].srp!=null && C.G[c].srp<g0.srp; }); notes.push('cheaper than '+(g0.model||g0.code)+' (SRP '+g0.srp+')'); }
    var rest=cons.filter(function(c){ return c.kind!=='name'&&c.kind!=='family'&&c.kind!=='device'; });
    /* V2-2C C1: an alternative admitted only through a governed relation (INFERRED) is kept OUT of the stated list, placed after
       it and labelled (both on the main path and on the closest-same-spec fallback) */
    var split=function(rs){ return { st:rs.filter(function(x){ return x.contra===0&&x.unk===0&&!x.inf; }).map(function(x){ return x.code; }), inf:rs.filter(function(x){ return x.contra===0&&x.unk===0&&x.inf>0; }) }; };
    var rows=scoreSet(pool,rest,C), sp0=split(rows), exact=sp0.st, infRows=sp0.inf;
    if(!exact.length && !infRows.length && sameKey && poolAll.length){ var rows2=scoreSet(poolAll,rest,C), sp2=split(rows2);
      if(sp2.st.length||sp2.inf.length){ exact=sp2.st; infRows=sp2.inf; key=sameKey; v0=metricVal(g0,sameKey); notes.push('no exact same '+sameKey+' — closest '+sameKey+' first'); } }
    var byClose=function(a,b){ var x=key?metricVal(C.G[a],key):null, y=key?metricVal(C.G[b],key):null; var dx=(x==null||v0==null)?1e9:Math.abs(x-v0), dy=(y==null||v0==null)?1e9:Math.abs(y-v0); return dx-dy || (C.G[a].srp||0)-(C.G[b].srp||0); };
    exact.sort(byClose);
    var infA=infRows.map(function(x){ return x.code; }).sort(byClose);
    if(infA.length) notes.push(infA.length+' inferred, not stated, listed last ('+rest.filter(function(c,i){ return infRows.some(function(x){ return x.st[i]===INF; }); }).map(function(c){ return c.label; }).join(', ')+')');
    exact=exact.concat(infA);
    return { kind:exact.length?'alternative':'none', codes:exact, inferred:infA, notes:[(exact.length?'Alternatives to ':'Walang alternative sa ')+(g0.model||g0.code)+(notes.length?' — '+notes.join(', '):'')+' (anchor excluded; ordered by '+(key||'price')+' closeness).'] , ladder:[{ step:'alternative', n:exact.length }] };
  }
  function ledgerRecount(P){ var L2=ledger(P.spans,P.frame); return L2; }
  function interpText(s,se){
    var map={ 'field.dp':'Using DP as Dealer Price.', 'connector.dp':'Using DP as DisplayPort.', 'family.network_switch':'Reading "switch" as a network (Ethernet) switch.', 'family.av_switch':'Reading "switch" as an HDMI/video switch.',
      'family.usb_switch':'Reading "switch" as a USB sharing switch.', 'device.nintendo_switch':'Reading "switch" as the Nintendo Switch.', 'catalog.listed':'Reading "available" as listed in the pricelist.', 'inventory.stock':'Reading this as a stock question.',
      'more.options':'Reading "meron pa" as more options.', 'thousand.price':'Reading "k" as thousand pesos.', 'thousand.mah':'Reading "k" as thousand mAh.' };
    return map[se.id]||('Reading "'+(s.term||s.text)+'" as '+se.id+'.');
  }
  function altSenses(P){ /* plausibility gate: the alternative must have its own positive contextual evidence and be close to the winner */
    var out=[];
    P.spans.forEach(function(s){ if(!s.candidates||s.candidates.length<2) return;
      var best=s.candidates.filter(function(c){ return c.id===s.selected; })[0];
      s.candidates.forEach(function(c){ if(c.id===s.selected) return;
        var positive=c.fired.some(function(f){ return /\+/.test(f); });
        if(positive && c.score>0 && best.score-c.score<=2.5) out.push({ span:s.id, text:s.text, sense:c.id, why:'own signals: '+c.fired.join(', ')+'; gap '+(Math.round((best.score-c.score)*100)/100) }); }); });
    return out;
  }
  function fieldValue(C,code,f){ var g=C.G[code], p=C.byCode[code]; if(!g) return null;
    switch(f){ case 'srp': return g.srp; case 'dp': return g.dp; case 'dp_vol': return g.dpVol; case 'moq': return g.moq; case 'price': return { srp:g.srp, dp:g.dp };
      case 'watts': return g.watts; case 'mah': return g.mah; case 'length': return g.lengthM; case 'ports': return g.ports?g.ports.total:(g.in1||null); case 'colour': return p.color||null;
      case 'connector': return g.conns.all; case 'speed': return g.gbps||g.ethGbps; case 'bays': return g.bays; default: return null; } }
  function compatHint(F,codes,C){
    var d=F.device; if(!d||!codes.length) return null;
    var g=C.G[codes[0]], outs=(g.pair?g.pair.to:g.conns.main).map(function(k){ return connLabel(k); });
    if(d.kind==='class'){
      var likely=(d.likely||[]).map(function(k){ return connLabel(k); });
      var shared=(g.pair?g.pair.to:g.conns.main).filter(function(k){ return (d.likely||[]).indexOf(k)>=0; }).map(function(k){ return connLabel(k); });
      return (g.model||g.code)+(outs.length?' uses '+outs.join(' / '):'')+'. '+(shared.length?'If your '+d.label+' has an '+shared.join(' / ')+' input, this is the relevant connection; ':'')+'I can’t confirm the '+d.label+' itself without its model/input.'+(d.qualifiers?' (Noted: '+d.qualifiers.join(', ')+'.)':'');
    }
    return 'Named device ('+d.label+(d.mods&&d.mods.length?' '+d.mods.join(' '):'')+'): fit needs the device’s ports/specs — official-source check.';
  }
  function routeOf(F,out,P){
    var C=P._C, devNamed=F.device&&F.device.kind==='named';
    if(out.kind==='clarify') return 'CLARIFY';
    if(out.kind==='not-found') return 'LOCAL';
    if(F.external) return 'WEB';
    if(F.intent==='COMPAT') return devNamed?'WEB':'AI_CATALOG';
    if(F.intent==='RECOMMEND') return devNamed?'WEB':(F.subject||F.constraints.length?'AI_CATALOG':'CLARIFY');
    if(F.intent==='COMPARE' && F.judge) return 'AI_CATALOG';
    if(devNamed && /^(FIND|EXIST|RANK|COUNT)$/.test(F.intent)){
      /* a named device is a catalogue fact only when the product names say so AND no specific model was asked */
      var dc=F.constraints.filter(function(c){ return c.kind==='device'; })[0];
      var allConf=out.codes.length && dc && out.codes.every(function(code){ return evalC(C.G[code],dc,C)===CONF; });
      return (allConf && !(F.device.mods&&F.device.mods.length))?'LOCAL':'WEB'; }
    return 'LOCAL';
  }

  /* =====================================================================================================
     J. LABEL INTEGRITY (labels come from the verified intersection of the shown products)
     ===================================================================================================== */
  function buildLabel(codes,F,C){
    var L=LEX(), O=ONT(); if(!codes.length) return (F.subject&&F.subject.text)||null;
    var gs=codes.map(function(c){ return C.G[c]; }).filter(Boolean);
    var fams=uniq(gs.map(function(g){ return g.family; })), subs=uniq(gs.map(function(g){ return g.subtype; }));
    var famDef=fams.length===1?L.taxonomy.families.filter(function(f){ return f.id===fams[0]; })[0]:null, noun='products';
    if(famDef){ noun=famDef.plural||famDef.label; if(subs.length===1 && subs[0]){ var st=(famDef.subtypes||[]).filter(function(s){ return s.id===subs[0]; })[0]; if(st) noun=plural(st.label); } }
    var pre=[], post=[], forT=[];
    (F?F.constraints:[]).forEach(function(c){
      if(c.kind==='device' && c.hint) return;
      var allConf=gs.every(function(g){ return evalC(g,c,C)===CONF; }); if(!allConf) return;
      if(c.kind==='name'||c.kind==='family'||c.kind==='form') return;
      /* "with X" for ports / features / non-plug connectors, so a label never reads a port as the plug ("RJ45 docking station") */
      if(c.kind==='device') forT.push(c.label);
      else if(c.kind==='component') post.push(c.label.replace(/^with /,''));
      else if((c.kind==='connector' && c.role!=='plug' && /^(hub_dock|card_reader|charger|power_bank)$/.test(fams[0]||'')) || c.kind==='role' || (c.kind==='feature' && !c.neg)) post.push(c.label);
      else pre.push(c.label);
    });
    return (pre.length?pre.join(' · ')+' ':'')+noun+(post.length?' with '+post.join(' · '):'')+(forT.length?' '+forT.join(' '):'');
  }
  /* audit a label someone else wrote (e.g. the current engine's header) against the products it sits on */
  function auditLabel(text,codes,opts){
    /* Only the LABEL part is audited: the header before the first ':' (the words that describe the shown set), with a leading
       result count removed. Claims: connector (plug role when it modifies a hub/adapter noun), A-to-B pair, port count, wattage /
       capacity / length (with its operator), hard feature, family / subtype word, price with an explicit operator.
       HARD violation = a shown product CONTRADICTS a claim; WORDING violation = "hub" for a docking station or vice versa. */
    var C=catalog(opts.facts,opts.products), res={ claims:[], violations:[], wording:[], unverified:[] };
    if(!text || !codes || !codes.length) return res;
    var head=String(text).split('|').map(function(x){ return x.trim(); }).map(function(seg){ var i=seg.indexOf(':'); return i>=0?seg.slice(0,i):(/^using\b/i.test(seg)?seg.replace(/^using\s*/i,''):seg); }).join(' . ');
    if(String(text).indexOf(':')<0 && !/^using\b/i.test(String(text)) && !opts.isLabel) return res;
    var norm=normalizeQ(head).replace(/(^|\. )\d+\s+(?:na\s+)?/g,'$1').replace(/≥\s?/g,'at least ').replace(/≤\s?/g,'up to ').replace(/>\s?(?=\d)/g,'over ').replace(/<\s?(?=\d)/g,'under ');
    var toks=tokenize(norm,null), spans=recognize(norm,toks,C,{}); resolveSenses(spans,toks,C,{},null); spans=scope(grammar(spans,toks),toks,norm);
    var claims=[], mixedHubDock=/\bhubs? (?:and|or|\/) dock|hub\/dock|hubs and docking stations|hubs? or docking/.test(norm);
    function opBefore(s){ var i=spans.indexOf(s), p=spans[i-1], n=spans[i+1]; if(n && n.type==='SYM' && n.value.sym==='+') return '>=';
      if(p && (p.type==='OPERATOR'||p.type==='INTENT'||p.type==='FUNCTION')){ var w=p.text; if(MEASURE_OPS[w]) return MEASURE_OPS[w]; if(PRICE_OPS[w]) return PRICE_OPS[w]; if(/^(over|above)$/.test(w)) return '>'; if(/^(under|below)$/.test(w)) return '<'; } return '='; }
    spans.forEach(function(s,k){
      if(s.type==='CONNECTOR'){ var nx=spans[k+1]; var plug=!!(nx && nx.type==='FAMILY' && /^(hub_dock|card_reader)$/.test(nx.value.family)); claims.push({ kind:'connector', id:s.value.id, ver:s.value.ver||null, role:plug?'plug':null, label:s.text }); }
      if(s.type==='CONN_PAIR') claims.push({ kind:'pair', from:s.value.from, to:s.value.to, multiport:true, label:s.text });
      if(s.type==='PORTCOUNT') claims.push({ kind:'ports', n:s.value.n, in1:!!s.value.in1, op:opBefore(s), label:s.text });
      if(s.type==='NUMUNIT' && (s.value.dim==='watts'||s.value.dim==='mah'||s.value.dim==='length')){ var o=opBefore(s); if(o!=='~') claims.push({ kind:'num', attr:s.value.dim==='length'?'lengthM':s.value.dim, op:o, v:s.value.v, label:s.text }); }
      if(s.type==='PRICE' && spans[k-1] && spans[k-1].type==='OPERATOR'){ claims.push({ kind:'price', op:s.value.op==='='?'<=':s.value.op, v:s.value.v, label:s.text }); }
      if(s.type==='FEATURE' && ONT().FEATURES[s.value.id].hard) claims.push({ kind:'feature', id:s.value.id, neg:!!s.negated, label:s.text });
      if(s.type==='FAMILY' && mixedHubDock && s.value.family==='hub_dock'){ claims.push({ kind:'family', family:'hub_dock', label:'hubs/docks' }); return; }
      if(s.type==='FAMILY' && k>0 && /\b(with|may)\b/.test(spans.slice(Math.max(0,k-2),k).map(function(x){ return x.text; }).join(' '))){ claims.push({ kind:'component', family:s.value.family, label:'with '+s.text }); return; }
      if(s.type==='FAMILY'){ var w=s.text.replace(/s$/,''); if(w==='hub'||w==='usb hub') claims.push({ kind:'subtypeWord', want:'hub', label:s.text }); else if(/dock|docking station/.test(w)) claims.push({ kind:'subtypeWord', want:'dock', label:s.text });
        else claims.push({ kind:'family', family:s.value.family, subtype:s.value.subtype, label:s.text }); }
    });
    res.claims=claims.map(function(c){ return c.label; });
    claims.forEach(function(c){
      codes.forEach(function(code){ var g=C.G[code]; if(!g) return; var st;
        if(c.kind==='subtypeWord'){ st=(g.subtype===c.want || new RegExp('\\b'+c.want).test(g.lname))?CONF:(g.family==='hub_dock'?CONTRA:CONF);
          if(st===CONTRA){ res.wording.push({ claim:c.label, code:code, model:g.model }); } return; }
        if(c.kind==='family'){ st=(g.family===c.family && (!c.subtype || g.subtype===c.subtype))?CONF:CONTRA; }
        else st=evalC(g,c,C);
        if(st===CONTRA) res.violations.push({ claim:c.label, code:code, model:g.model });
        else if(st===UNK) res.unverified.push({ claim:c.label, code:code }); }); });
    return res;
  }

  /* =====================================================================================================
     L. v2-2B TURN FRAME: projection of one parse into the frozen A5 contract consumed by VeroDiscourse (js/vero-discourse.js).
     Reads ONLY this turn's parse (spans, frame, ledger). Never a SessionContext, a shown / candidate list, the catalogue result
     set, prices, stock state or AI output. Closed-world keys:
       { intent, subject, constraints, fields, flags, relax, ref, metric, rank, sameBut, ledger }
     Contract rules applied here: C1 (ports / lanes unqualified unless THIS turn names a family / interface with a safe
     qualifier), C2 (generation without interface -> slot 'version', interface null, raw notation), C3 (typed prices),
     C4 (v2-1 field names mapped here), C6 (no forbidden keys: ledger carries span ids only, never text).
     ===================================================================================================== */
  /* port role a family named IN THE SAME TURN safely determines (B owns this; elliptical turns stay unqualified, C1) */
  var PORT_ROLE_BY_FAMILY=Object.freeze({ charger:'charging_output', power_bank:'charging_output', network_switch:'rj45', hub_dock:'data_port' });   /* V2-2C C1: exported (single source for C2 qualify), frozen */
  var METRIC_OF_FIELD={ watts:'watts', mah:'mah', length:'length', ports:'ports', price:'price', srp:'price', dp:'price', speed:'speed' };
  function metricName(m){ return m==='speed'?'gbps':m; }
  function comparative(P){
    var O=ONT(), sp=P.spans.filter(function(s){ return s.type!=='SYM'; }), norm=' '+P.norm+' ', base=null, cue=-1, i;
    function speedPick(){ var k; for(k in O.SPEED_CUES){ if(O.SPEED_CUES[k].some(function(w){ return norm.indexOf(' '+w+' ')>=0; })) return k; } return null; }
    for(i=0;i<sp.length && !base;i++){ var s=sp[i], tx=s.text, nx=sp[i+1];
      if(O.JUDGEMENT_WORDS.indexOf(tx)>=0) return { judgement:true };
      if(/^(alin mas|alin ang mas)$/.test(tx) && nx){
        if(O.JUDGEMENT_AFTER.indexOf(nx.text)>=0) return { judgement:true };
        if(nx.type==='METRIC'){ var pl=O.METRIC_POLARITY[nx.text]; base=pl?{ metric:pl[0], dir:pl[1] }:(nx.value.dir?{ metric:nx.value.metric, dir:nx.value.dir }:{ metric:nx.value.metric, dir:'desc' }); if(base.metric==='speed') base={ dir:base.dir, speed:true }; cue=i+1; } continue; }
      if(O.COMPARATIVES[tx]){ base=O.COMPARATIVES[tx]; cue=i; continue; }
      if(O.COMPARE_MORE[tx] && nx && ((nx.type==='FIELD' && METRIC_OF_FIELD[nx.value.id]) || nx.type==='METRIC')){
        var mm=nx.type==='FIELD'?METRIC_OF_FIELD[nx.value.id]:nx.value.metric; base=mm==='speed'?{ dir:O.COMPARE_MORE[tx], speed:true }:{ metric:mm, dir:O.COMPARE_MORE[tx] }; cue=i+1; } }
    if(!base) return null;
    /* an explicit measure noun in the turn narrows a generic comparative ("mas mataas na wattage") */
    var noun=null; sp.forEach(function(s,k){ if(noun || k<cue) return; if(s.type==='FIELD' && METRIC_OF_FIELD[s.value.id] && METRIC_OF_FIELD[s.value.id]!=='speed') noun=METRIC_OF_FIELD[s.value.id]; });
    var out={ dir:base.dir };
    if(base.metric) out.metric=base.metric;
    else if(noun) out.metric=noun;
    else if(base.speed){ var sk=speedPick(); if(sk) out.metric=sk; else out.candidates=['gbps','watts']; }
    else out.candidates=base.candidates.slice();
    out._noun=cue;   /* internal: index of the span used as the measure cue (removed before output) */
    return out;
  }
  function turnFrame(P){
    var O=ONT(), F=P.frame, C=P._C, spans=P.spans;
    var T={ intent:F.intent, subject:null, constraints:[], fields:[], flags:{}, relax:[], ref:null, metric:null, rank:null, sameBut:false, ledger:[] };
    /* subject: anchors (sku / model / product line) or the family named in this turn */
    var S=F.subject, famOf=function(codes){ var f=uniq(codes.map(function(c){ return C.G[c]&&C.G[c].family; }).filter(Boolean)); return f.length===1?f[0]:null; };
    if(S && (S.kind==='sku'||S.kind==='model'||S.kind==='anchors'||S.kind==='name')){
      var an=spans.filter(function(s){ return s.type==='ANCHOR'; }).map(function(s){ return { kind:s.value.kind, codes:s.value.codes.slice() }; });
      if(!an.length) an=[{ kind:'name', codes:S.codes.slice() }];
      T.subject={ family:famOf(S.codes), anchors:an };
    } else if(S && S.family){ T.subject={ family:S.family }; if(S.subtype) T.subject.subtype=S.subtype; }
    var explicitFam=S && (S.kind==='family'||S.kind==='subtype') && S.via!=='interface' ? S.family : null;
    /* constraints (C4 mapping); polarity: false = EXCLUDE, null = unclear scope; a governed value is never true (BA2) */
    var ifs={};
    function pol(c){ var p=c.polNull?null:((c.neg||c.kind==='notConnector'||c.kind==='notFamily'||c.kind==='notVersion')?false:true); return (p===true && c.negGov)?null:p; }
    function add(kind,slot,value,c,x){ var o={ kind:kind, slot:slot, value:value, polarity:pol(c), hard:!!c.hard, source:{ span:c.span } }; if(x) Object.keys(x).forEach(function(k){ o[k]=x[k]; }); T.constraints.push(o); return o; }
    F.constraints.forEach(function(c){
      switch(c.kind){
        case 'num': add('num','num:'+c.attr,c.v,c,{ op:c.op||'=' }); break;
        case 'ports': add('ports',c.in1?'ports:in1':(explicitFam && PORT_ROLE_BY_FAMILY[explicitFam]?'ports:'+PORT_ROLE_BY_FAMILY[explicitFam]:'ports'),c.n,c,c.op?{ op:c.op }:null); break;
        case 'connector': case 'notConnector': {
          var f=O.interfaceOf(c.id), v={ id:c.id }; if(c.count) v.count=c.count; if(c.role) v.role=c.role;
          var pc=pol(c); add('connector','connector:'+c.id,v,c,f && pc===true?{ interfaces:[f] }:null); if(f && pc===true) ifs[f]=1;   /* only an affirmed connector declares its interface */
          var sp=spans.filter(function(s){ return s.id===c.span; })[0], gen=sp&&sp.value&&sp.value.gen;
          var raw=c.id==='usb4'?'4':(f==='usb'?((c.ver||'')+(gen||'')):(c.ver||gen||null)), cv=f&&raw?O.canonVersion(f,raw):null;
          /* V2-2C C1 (remote review N1): an affirmBase connector is the base of a NEGATED version ("hub not usb 3.2 gen 2"); its
             version lives only in the notVersion constraint, so the span's absorbed Gen is never emitted again as a requirement */
          if(cv && !c.affirmBase) add('version','version:'+f,{ interface:f, generation:cv },c);
          break; }
        case 'pair': { var pf=pol(c)!==true?[]:uniq([c.from.id].concat(c.to.map(function(t){ return t.id; })).map(function(k){ return O.interfaceOf(k); }).filter(Boolean)); pf.forEach(function(x){ ifs[x]=1; });
          add('pair','pair',{ from:c.from.id, to:c.to.map(function(t){ return t.id; }) },c,pf.length?{ interfaces:pf }:null); break; }
        case 'feature': add('feature','feature:'+c.id,true,c); break;
        case 'colour': add('colour','colour',c.v,c); break;
        case 'standard': add('standard','standard:'+c.id,c.id,c); break;
        case 'form': add('form','form',c.form,c); break;
        case 'price': add('price','price',c.v,c,{ op:c.op, typed:true }); break;
        case 'name': add('name','name:'+c.phrase.replace(/\s+/g,'_'),{ codes:c.codes.slice() },c); break;
        case 'family': case 'notFamily': add('family','family',c.subtype?{ family:c.family, subtype:c.subtype }:{ family:c.family },c); break;
        case 'component': add('component','component:'+c.family,c.family,c); break;
        case 'role': add('role','role:'+c.role,c.conn?{ role:c.role, conn:c.conn }:{ role:c.role },c); break;
        case 'res': add('res','res',c.rank,c); break;
        case 'hz': add('hz','hz',c.v,c); break;
        case 'size': add('size','size',c.v,c); break;
        case 'nametoken': add('nametoken','nametoken:'+c.word.replace(/\s+/g,'_'),c.word,c); break;
        case 'nametext': add('nametext','nametext',c.re,c); break;
        case 'version': add('version','version',{ interface:null, generation:c.raw },c); break;   /* C2 + BA1: raw until bound */
        case 'notVersion': add('version','version:'+c.iface,{ interface:c.iface, generation:c.ver },c); break;   /* V2-2C C1 (#5): EXCLUDE the version only */
        case 'lanes': add('lanes',c.iface?'lanes:'+c.iface:'lanes',c.n,c); if(c.iface) ifs[c.iface]=1; break;
        /* 'device' is a routing hint (named device / device class), never a product constraint: it stays in the ledger as BOUND */
      } });
    var ifl=Object.keys(ifs); if(T.subject && ifl.length===1) T.subject.interface=ifl[0];
    /* fields, minus a measure noun used as the comparative's metric ("more ports") or a yes/no value */
    var M=comparative(P);
    T.fields=uniq(F.fields.filter(function(fid){ return !(M && M.metric && M.metric!=='price' && METRIC_OF_FIELD[fid]===M.metric); }));
    if(F.yesNo && T.fields.indexOf(F.yesNo.field)<0) T.fields.push(F.yesNo.field);
    /* RELAX (ports qualified only from a family named in this turn) */
    F.relax.forEach(function(r){ var sl=r.slot==='ports' && explicitFam && PORT_ROLE_BY_FAMILY[explicitFam]?'ports:'+PORT_ROLE_BY_FAMILY[explicitFam]:r.slot; if(!T.relax.some(function(x){ return x.slot===sl; })) T.relax.push({ slot:sl, span:r.span }); });
    /* comparative / judgement / sameBut (sameBut only with a METRIC comparative, BA8) */
    if(M){ delete M._noun; T.metric=M; }
    var sameCue=spans.some(function(s){ return s.type==='FOLLOWUP' && O.SAME_BUT.indexOf(s.value.cue)>=0; });
    if(sameCue && M && !M.judgement && (M.metric || (M.candidates && M.candidates.length))) T.sameBut=true;
    /* V2-2C C1 additive A5 amendment (design §12-D). Both are structural marks of THIS turn; the parser never resolves them against
       a focus, an anchor or a result set (C2 does):
         flags.same  a same-but cue with no metric comparative ("same but white", "pareho pero white")
         keep        [{ slot, span }] "same <attribute>" keeps that slot of the anchor ("same wattage" -> num:watts); ports stay
                     unqualified unless THIS turn names a family (contract rule C1) */
    if(sameCue && !T.sameBut) T.flags.same=true;
    var KS=O.KEEP_SLOTS||{}, SW=O.SAME_WORDS||[], tk=P.tokens||[], keep=[];
    for(var ki=0;ki<tk.length;ki++){ if(SW.indexOf(tk[ki].t)<0) continue; var kj=ki+1; while(tk[kj] && /^(na|ng|the|a|ang|yung)$/.test(tk[kj].t)) kj++;
      var mw=tk[kj] && O.MEASURE_WORDS[tk[kj].t], ksl=mw && KS[mw]; if(!ksl) continue;
      if(ksl==='ports' && explicitFam && PORT_ROLE_BY_FAMILY[explicitFam]) ksl='ports:'+PORT_ROLE_BY_FAMILY[explicitFam];
      var ksp=spans.filter(function(s){ return s.from<=kj && s.to>kj; })[0];
      if(!keep.some(function(x){ return x.slot===ksl; })) keep.push(ksp?{ slot:ksl, span:ksp.id }:{ slot:ksl }); }
    if(keep.length) T.keep=keep;
    if(F.rank && F.rank.metric) T.rank={ metric:metricName(F.rank.metric), dir:F.rank.dir||'asc' };
    /* structural reference (the resolver, not the parser, maps it onto shown / focus / comparison) */
    var focusRef=spans.some(function(s){ return s.type==='REF' && O.REF_KIND.focus.indexOf(s.text)>=0; }), resRef=spans.some(function(s){ return s.type==='REF' && s.value.kind==='results'; });
    /* a select cue the lexicon already lists as a plain follow-up ("alin dito") is still a select cue in the contract (projection only) */
    var selCue=F.selectCue || spans.some(function(s){ return s.type==='FOLLOWUP' && O.SELECT_CUES.indexOf(s.value.cue)>=0; });
    if(selCue) F=Object.assign({},F,{ selectCue:true });
    if(F.ordinal) T.ref={ kind:'ordinal', n:F.ordinal };
    else if(F.refOther) T.ref={ kind:'other' };
    else if(F.selectCue || (resRef && F.refPronoun)) T.ref={ kind:'results' };
    else if(focusRef && F.refPronoun) T.ref={ kind:'focus' };
    else if(F.yesNo) T.ref={ kind:'focus' };
    /* flags: booleans only (v2-1 keeps the follow-up cue text; the contract never carries text); flags.same is set above */
    ['needsContext','elliptical','refPronoun','selectCue','followUp'].forEach(function(k){ if(F[k]) T.flags[k]=true; });
    /* intent */
    if(T.sameBut) T.intent='ALTERNATIVE';
    else if(F.yesNo) T.intent='ATTRIBUTE';
    else if(F.existQ && (T.intent==='FIND'||T.intent==='CLARIFY')) T.intent='EXIST';
    else if(T.intent==='CLARIFY' && (T.constraints.length || T.relax.length || T.ref || T.metric)) T.intent='FIND';
    else if(T.intent==='ATTRIBUTE' && T.metric && !T.fields.length) T.intent='FIND';   /* the measure noun was the comparative's metric */
    /* ledger: span ids + states only */
    spans.forEach(function(s){ var l={ span:s.id, state:s.state };
      if(s.state==='UNRESOLVED') l.nameShaped=!!(s.type==='UNKNOWN' && nameLike(s,spans));
      if(s.state==='UNRESOLVED' && s.impact==='high') l.impact='high';
      if(s.state==='AMBIGUOUS') l.impact=s.impact==='low'?'low':(s.impact==='medium'?'high':(s.impact||'high'));
      T.ledger.push(l); });
    return T;
  }

  /* =====================================================================================================
     M. V2-2C C1 FRAME EXECUTOR: evaluates a MERGED A5 frame (as VeroDiscourse.resolve returns it) over the FULL published
     catalogue. It reads no SessionContext, no shown / candidate list and stores nothing: the caller (C2 VeroContext) passes the
     frame; opts = { facts, products } (live prices are re-read on every call, see catalog()). Polarity true = require,
     false = EXCLUDE (needs CONFIRMED / INFERRED evidence to remove a product), null = unclear scope (never confirmed).
     The frame's relax[] is already applied by the resolver; keep[] / flags.same are resolved by C2, so they are ignored here.
     Returns { v, kind, route, codes, exactCodes?, inferred?, notStated?, unconfirmed, evidence:{ code:{ slot:state } }, notes,
     ladder, label, frameErrors }.
     ===================================================================================================== */
  function fromA5(c){
    var v=c.value, pol=c.polarity, sl=String(c.slot||''), o=null, lab=sl;
    switch(c.kind){
      case 'num': o={ kind:'num', attr:sl.split(':')[1], op:c.op||'=', v:v }; break;
      case 'ports': o={ kind:'ports', n:v, in1:sl==='ports:in1', op:c.op }; break;
      case 'connector': o=pol===false?{ kind:'notConnector', id:v.id }:{ kind:'connector', id:v.id, ver:null, count:v.count||null, role:v.role||null }; break;
      case 'version': o=(v && v.interface)?(pol===false?{ kind:'notVersion', id:null, iface:v.interface, ver:v.generation }:{ kind:'ifaceVersion', iface:v.interface, gen:v.generation }):{ kind:'version', raw:v&&v.generation }; break;
      case 'lanes': o={ kind:'lanes', n:v }; break;
      case 'feature': o={ kind:'feature', id:sl.split(':')[1], neg:pol===false, hard:true }; break;
      case 'colour': o={ kind:'colour', v:v, neg:pol===false }; break;
      case 'standard': o={ kind:'standard', id:v }; break;
      case 'form': o={ kind:'form', form:v, neg:pol===false }; break;
      case 'price': o={ kind:'price', op:c.op||'<=', v:v }; break;
      case 'name': o={ kind:'name', codes:(v&&v.codes)||[] }; break;
      case 'pair': o={ kind:'pair', from:{ id:v.from }, to:(v.to||[]).map(function(t){ return { id:t }; }), multiport:false }; break;
      case 'family': o=pol===false?{ kind:'notFamily', family:v.family }:{ kind:'family', family:v.family, subtype:v.subtype||null }; break;
      case 'component': o={ kind:'component', family:v }; break;
      case 'role': o={ kind:'role', role:v.role, conn:v.conn||null }; break;
      case 'res': o={ kind:'res', rank:v }; break;
      case 'hz': o={ kind:'hz', v:v }; break;
      case 'size': o={ kind:'size', v:v }; break;
      case 'nametoken': o={ kind:'nametoken', word:v, hard:!!c.hard }; break;
      case 'nametext': o={ kind:'nametext', re:v }; break;
    }
    if(!o) return null;
    if(c.kind==='connector' && v) lab=connLabel({ id:v.id }); else if(c.kind==='version' && v) lab=(v.interface?connLabel({ id:v.interface })+' ':'')+v.generation; else if(c.kind==='feature' && ONT().FEATURES[o.id]) lab=ONT().FEATURES[o.id].label;
    if(pol===null){ o.polNull=true; lab='(unclear) '+lab; } else if(pol===false) lab='not '+lab;
    o.hard=c.hard!==undefined?!!c.hard:o.hard; o.label=lab; o.slot=sl; o.span=null; return o;
  }
  /* V2-2C C2F: the executor constraint list of an A5 frame — the ONE mapping shared by executeFrame and evalFrameCodes.
     provSpan: a constraint stored by VeroDiscourse has no source span but a provenance { turn, span }; span ids are per turn, so the
     G3 same-span key is turn + span (evalFrameCodes only; executeFrame keeps reading source spans exactly as before) */
  function mapFrame(frame,provSpan){
    var O=ONT(), errs=[], cons=[];
    var srcOf=[];   /* V2-2C G3: the A5 source span of each mapped constraint (kept beside cons, never on the constraint itself) */
    var srcKey=function(c){ if(c && c.source && c.source.span) return c.source.span; var p=provSpan && c && c.provenance; return p && p.span!=null && p.span!==''?'t'+p.turn+':'+p.span:null; };
    (frame&&frame.constraints||[]).forEach(function(c,i){ var x=fromA5(c||{}); if(x){ cons.push(x); srcOf.push(srcKey(c)); } else errs.push({ index:i, slot:c&&c.slot, why:'unsupported-kind' }); });
    /* V2-2C G3: a required version stated ON a counted connector ("2 usb-c gen 1" = two Gen 1 USB-C ports) is read from that connector
       only, so a Gen inferred from another port (USB-A 3.0) never stands in for it. Binding needs the SAME source span: a version
       stated on a different connector ("usb-a 3.0 and 2 usb-c") keeps its own scope */
    cons.forEach(function(v,vi){ if(v.kind!=='ifaceVersion' || v.polNull || !srcOf[vi]) return;
      var cc=cons.filter(function(x,xi){ return x.kind==='connector' && x.count && !x.polNull && x.id!==v.iface && O.interfaceOf(x.id)===v.iface && srcOf[xi]===srcOf[vi]; });
      if(cc.length===1) v.bind=cc[0].id; });
    return { cons:cons, errs:errs };
  }
  /* V2-2C C2F: per-code evaluation of a merged A5 frame on GIVEN codes only (a target inside an earlier result set): the same mapping,
     G3 binding and evaluator as executeFrame; no catalogue search, no ranking, no ladder. states[code][i] is aligned with slots[i];
     evidence[code][slot] is built exactly as executeFrame builds it. A code that is not in the published catalogue is left out. */
  function evalFrameCodes(frame,codes,opts){
    opts=opts||{}; var facts=opts.facts||(VF()&&VF().build(opts.products||[])), C=catalog(facts,opts.products||[]), mf=mapFrame(frame,true);
    var out={ slots:mf.cons.map(function(c){ return { slot:c.slot, exclusion:isExcl(c), unclear:!!c.polNull }; }), states:{}, evidence:{}, frameErrors:mf.errs };
    (codes||[]).forEach(function(code){ var g=C.G[code]; if(!g) return; var st=[], e={};
      mf.cons.forEach(function(c){ var s=evalC(g,c,C); st.push(s); e[c.slot]=s; }); out.states[code]=st; out.evidence[code]=e; });
    return out;
  }
  function executeFrame(frame,opts){
    opts=opts||{}; var t0=now(), O=ONT();
    var facts=opts.facts||(VF()&&VF().build(opts.products||[])), C=catalog(facts,opts.products||[]);
    var mf=mapFrame(frame,false), errs=mf.errs, cons=mf.cons;
    var S=frame&&frame.subject||null, subj=null;
    if(S && S.anchors && S.anchors.length){ var ac=uniq([].concat.apply([],S.anchors.map(function(a){ return a.codes||[]; }))); subj={ kind:'anchors', codes:ac, text:'the selected item'+(ac.length>1?'s':'') }; }
    else if(S && S.family){ subj={ kind:S.subtype?'subtype':'family', family:S.family, subtype:S.subtype||null, text:S.family.replace(/_/g,' ') }; }
    var rank=frame&&frame.rank?{ metric:frame.rank.metric==='gbps'?'speed':frame.rank.metric, dir:frame.rank.dir||'asc' }:(frame&&frame.metric&&frame.metric.metric?{ metric:frame.metric.metric==='gbps'?'speed':frame.metric.metric, dir:frame.metric.dir||'asc' }:null);
    var F={ intent:'FIND', subject:subj, constraints:cons, fields:[], rank:rank, device:null, discourse:[], refs:[], relax:[], why:['executeFrame'] };
    var P={ q:'', norm:'', spans:[], frame:F, ledger:{ unresolved:[], ambiguous:[], states:{} }, _C:C };
    var out=execute(P,{ _noAlt:true });
    out.v=VERSION; out.frameErrors=errs;
    /* per product x slot evidence for the proposed codes (live state at execution time; never cached) */
    out.evidence={}; (out.codes||[]).forEach(function(code){ var e={}; cons.forEach(function(c){ e[c.slot]=evalC(C.G[code],c,C); }); out.evidence[code]=e; });
    out.ms=Math.round((now()-t0)*100)/100;
    return out;
  }

  /* =====================================================================================================
     K. PUBLIC API
     ===================================================================================================== */
  function parse(q,opts){
    opts=opts||{}; var t0=now();
    var facts=opts.facts||(VF()&&VF().build(opts.products||[]));
    var C=catalog(facts,opts.products||[]);
    var norm=normalizeQ(q), toks=tokenize(norm,C.cat);
    var spans=recognize(norm,toks,C,opts);
    var senses=resolveSenses(spans,toks,C,opts,opts._force||null);
    spans=scope(grammar(spans,toks),toks,norm);
    var frame=buildFrame(spans,toks,C,opts);
    var P={ v:VERSION, q:q, norm:norm, tokens:toks.map(function(t){ return { t:t.t, k:t.k }; }), spans:spans, senses:senses, frame:frame, _C:C };
    P.ledger=ledger(spans,frame);
    P.parseMs=Math.round((now()-t0)*100)/100;
    return P;
  }
  function run(q,opts){ var P=parse(q,opts||{}); P.proposal=execute(P,opts||{}); P.ledger=P.ledger; return P; }
  function report(P){ /* compact, JSON-safe shadow record */
    return { q:P.q, norm:P.norm,
      spans:P.spans.map(function(s){ return { id:s.id, text:s.text, tok:[s.from,s.to], type:s.type, value:s.value, alts:s.alts&&s.alts.length?s.alts:undefined, candidates:s.candidates?s.candidates.map(function(c){ return c.id+'='+c.score; }):undefined,
        selected:s.selected, margin:s.margin, senseState:s.senseState, slot:s.slot||null, state:s.state, conf:Math.round((s.conf||1)*100)/100, fuzzy:s.fuzzy, absorbed:s.absorbed }; }),
      senses:P.senses, frame:stripFrame(P.frame), ledger:P.ledger, proposal:P.proposal, parseMs:P.parseMs };
  }
  function stripFrame(F){ var o={}; Object.keys(F).forEach(function(k){ if(k==='constraints') o[k]=F[k].map(function(c){ var x={}; Object.keys(c).forEach(function(z){ if(z!=='codes') x[z]=c[z]; }); if(c.codes) x.nCodes=c.codes.length; return x; }); else if(k==='subject' && F[k]){ o[k]=Object.assign({},F[k]); if(o[k].codes && o[k].codes.length>20){ o[k].nCodes=o[k].codes.length; o[k].codes=o[k].codes.slice(0,20); } } else o[k]=F[k]; }); return o; }

  var API={ version:VERSION, normalize:normalizeQ, tokenize:function(q,opts){ var C=opts&&opts.facts?catalog(opts.facts,opts.products):null; return tokenize(normalizeQ(q),C?C.cat:null); },
    parse:parse, turnFrame:turnFrame, execute:function(P,opts){ P.proposal=execute(P,opts||{}); return P.proposal; }, run:run, report:report,
    executeFrame:executeFrame, evalFrameCodes:evalFrameCodes, PORT_ROLE_BY_FAMILY:PORT_ROLE_BY_FAMILY, EVIDENCE:['CONFIRMED','INFERRED','UNKNOWN','CONTRADICTED'],
    catalog:catalog, resetCache:function(){ CAT=null; CAT_KEY=null; }, graphFor:function(code,opts){ var C=catalog(opts.facts,opts.products); return C.G[code]||null; },
    evalConstraint:function(code,c,opts){ var C=catalog(opts.facts,opts.products); return evalC(C.G[code],c,C); },
    buildLabel:function(codes,frame,opts){ return buildLabel(codes,frame,catalog(opts.facts,opts.products)); }, auditLabel:auditLabel,
    dl1:dl1, _compileVocab:compileVocab, _nameGuard:nameGuard, _altSenses:altSenses, STATES:['BOUND','UNCONFIRMABLE','UNRESOLVED','AMBIGUOUS'] };
  if(typeof module!=='undefined' && module.exports) module.exports=API;
  root.VeroParse=API;
})(typeof window!=='undefined'?window:globalThis);
