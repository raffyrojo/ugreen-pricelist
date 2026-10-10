/* VERO Local Brain V2-2C C2 — context layer (SHADOW ONLY, DORMANT).
   Not loaded by index.html or by any live runtime file; nothing calls it in production (asset gate G23 enforces that).
   The ONLY v2 layer that manages result-set / catalogue context across turns (design review 2026-10-09, §4–§12):
     VeroParse.turnFrame (current turn only)  ->  VeroContext.step  ->  VeroDiscourse.resolve (pure, unchanged)
     -> post-resolve guards  ->  VeroParse.executeFrame (full current catalogue, live prices)  ->  VeroDiscourse.buildContext
     -> storage sanitiser.
   Pure and deterministic: no DOM, no network, no clock (time comes from opts.now), no writes to any global except
   VeroContext. It reads the catalogue (facts + graph) read-only and never stores prices, names, stock, text or AI data:
   the stored state holds a typed frame, opaque product codes and catalogue identity only. It holds no word or phrase
   lists (words stay in VeroOntology / the parser) and adds no new linguistic behaviour.

   API
     step(state, turnFrame, opts) -> { outcome, state }      one conversational turn; state is a ContextState or null
     applicability(opts)          -> { applies3, applies, families, qualify }   (facts-derived, read-only)
     narrowMetrics(pool, codes, family, opts) -> [metric]   metrics CONFIRMED on >= max(2, 30%) of the set
     identity(opts)               -> { dataVersion, catalogueSig }
     sanitize(state) / validate(state) / serialize(state) / deserialize(text) / clear()
     TTL_MS, THRESHOLDS, SLOT_EVIDENCE, METRIC_ATTR, version
   opts: { now (ms, required), mode (string, required), facts (built from the published products), products (published,
           i.e. enabled), allProducts? (incl. disabled, to tell 'disabled' from 'removed'), dataVersion?, shownN? (<=12) }

   ContextState (stored; JSON-safe; never holds prices / names / text / stock / evidence):
     { v:'c2', ctx: SessionContext v2 exactly as VeroDiscourse.buildContext returns it, sanitised,
       meta: { dataVersion, catalogueSig, resultState: 'ok'|'empty'|'failed'|'clarify', family, anchorKind,
               shownFam: [family] aligned with ctx.shown } }
   outcome (per turn; never stored):
     { act, target?, codes (full ranked semantic result set of the merged frame), shown (displayed top-N), kind,
       evidence { code: { slot: CONFIRMED|INFERRED|UNKNOWN|CONTRADICTED } } (live, from the executor, never upgraded),
       options [{ id, kind, labelKey, value }] | noOptions { reason } (every CLARIFY has one of them),
       reason?, notes [{ code, ... }], ctxStatus: 'none'|'fresh'|'expired'|'modeChanged'|'malformed'|'dataChanged' }

   Additive A5 amendment (design §12-D, emitted by the parser in C1; discourse ignores both, its bytes are unchanged):
     flags.same  a same-but cue without a metric ("same but white"): a model anchor of the context is retained
     keep        [{ slot }] keep-slots ("same wattage"): the single focus item's CONFIRMED value is applied as an equality
   ------------------------------------------------------------------------------------------------------------------ */
(function(root){
  'use strict';
  var D0=root.VeroDiscourse||null, P0=root.VeroParse||null, O0=root.VeroOntology||null;
  if(typeof require==='function'){
    if(!D0){ try{ D0=require('./vero-discourse.js'); }catch(e){} }
    if(!O0){ try{ O0=require('./vero-ontology.js'); }catch(e){} }
    if(!P0){ try{ P0=require('./vero-parse.js'); }catch(e){} }
  }
  function DIS(){ return root.VeroDiscourse||D0; }
  function VP(){ return root.VeroParse||P0; }
  function ONT(){ return root.VeroOntology||O0; }

  var VERSION='v2-2C-C2';
  var TTL_MS=15*60*1000;                                   /* per mode; equal to VeroDiscourse.TTL_MS */
  var THRESHOLDS=Object.freeze({ appliesMin:2, appliesPct:0.10, metricMin:2, metricPct:0.30 });
  var CAPS=Object.freeze({ shown:12, options:12 });
  var STATE_V='c2';
  var CONF='CONFIRMED', INF='INFERRED', UNK='UNKNOWN', CONTRA='CONTRADICTED';
  /* acts that produce a (new) result set: the merged frame is re-executed over the full current catalogue */
  var RESULT_ACTS={ SWITCH:1, REFINE:1, REPLACE:1, RELAX:1, EXCLUDE:1, ALTERNATIVE:1, COMPARE_METRIC:1 };
  /* acts that read a target inside the previous result set */
  var TARGET_ACTS={ SELECT:1, ATTRIBUTE_OF_FOCUS:1, STOCK_OF_CONTEXT:1 };
  /* storage: catalogue pricing, dealer data, stock truth and prose never enter the stored state (a superset of the
     discourse C6 list, which stays authoritative; the test checks the superset) */
  var FORBIDDEN={ srp:1, dp:1, dp_volume:1, dpvolume:1, dp_vol:1, dpvol:1, special_dp:1, moq:1, dealer:1, dealer_price:1, dealerprice:1,
    dealer_id:1, stock:1, stockstate:1, instock:1, qty:1, quantity:1, inventory:1, answer:1, text:1, html:1, rendered:1, aianswer:1,
    ai:1, reply:1, name:1, lname:1, label:1, price_value:1, evidence:1 };

  /* §8 slot -> evidence mapping. Each entry: (graph, slotArg) -> true when the product CONFIRMS that the slot is stated.
     'always' slots are name / structured slots that are always evaluable; 'never' = structurally impossible (ontology). */
  var SLOT_EVIDENCE=Object.freeze({
    'num:watts':  { has:function(g){ return g.watts!=null; } },
    'num:mah':    { has:function(g){ return g.mah!=null; } },
    'num:lengthM':{ has:function(g){ return g.lengthM!=null; } },
    'num:gbps':   { has:function(g){ return g.gbps!=null || g.ethGbps!=null; } },
    'ports':      { has:function(g){ return !!(g.ports && (g.ports.total!=null || g.ports.byKind)); } },
    'connector':  { has:function(g,id){ return !!(g.conns && (g.conns.all.indexOf(id)>=0)); } },
    'feature':    { has:function(g,id){ return !!(g.feats && g.feats[id] && g.feats[id].state===CONF); } },
    'version':    { has:function(g,iface){ return ifaceHasVersion(g,iface); } },
    'lanes':      { has:function(g){ return g.lanes!=null; }, onlyIface:'pcie' },
    'res':        { has:function(g){ return g.res!=null; } },
    'hz':         { has:function(g){ return !!(g.hzRes && g.hzRes.length); } },
    'size':       { has:function(g){ return !!g.size; } },
    'colour':     { has:function(g){ return !!g.color; }, anyIsYes:true },
    'name':1, 'nametoken':1, 'nametext':1, 'price':1, 'role':1, 'form':1, 'pair':1, 'family':1, 'subtype':1, 'component':1, 'standard':1
  });
  /* §9 metric -> graph attribute (live values; used for coverage and cheaper-than-focus only, never stored) */
  var METRIC_ATTR=Object.freeze({
    price:function(g){ return g.srp; }, watts:function(g){ return g.watts; }, mah:function(g){ return g.mah; }, capacity:function(g){ return g.mah; },
    length:function(g){ return g.lengthM; }, lengthM:function(g){ return g.lengthM; },
    gbps:function(g){ return g.gbps!=null?g.gbps:g.ethGbps; }, speed:function(g){ return g.gbps!=null?g.gbps:g.ethGbps; },
    ports:function(g){ return g.ports?g.ports.total:null; }, size:function(g){ return g.size?g.size.hi:null; } });
  var METRIC_POOL=['price','watts','mah','length','gbps','ports'];   /* candidates for a judgement word with no metric of its own */

  /* ---------------- helpers ---------------- */
  function isObj(x){ return !!x && typeof x==='object' && !Array.isArray(x); }
  function arr(x){ return Array.isArray(x)?x:[]; }
  function clone(x){ return x===undefined?undefined:JSON.parse(JSON.stringify(x)); }
  function uniq(a){ var s={}, o=[]; arr(a).forEach(function(x){ var k=String(x); if(x!=null && !s[k]){ s[k]=1; o.push(k); } }); return o; }
  function ifaceHasVersion(g,iface){ var O=ONT(); if(!g || !g.versions || !O || !O.INTERFACES[iface]) return false;
    return (O.INTERFACES[iface].connectors||[]).some(function(k){ return g.versions[k]!=null; }); }
  function deepStrip(x,removed,path){
    if(Array.isArray(x)) return x.map(function(v,i){ return deepStrip(v,removed,path+'['+i+']'); });
    if(!isObj(x)) return x;
    var o={}; Object.keys(x).forEach(function(k){ if(FORBIDDEN[k.toLowerCase()]){ removed.push(path?path+'.'+k:k); return; } o[k]=deepStrip(x[k],removed,path?path+'.'+k:k); });
    return o; }

  /* ---------------- catalogue identity (design §5: dataVersion + facts key + enabled count) ---------------- */
  function identity(opts){
    var f=opts&&opts.facts, n=arr(opts&&opts.products).filter(function(p){ return p && !p.disabled; }).length;
    return { dataVersion:opts&&opts.dataVersion!==undefined?opts.dataVersion:null, catalogueSig:f&&f.key?String(f.key)+'|n'+n:null }; }
  function sameIdentity(a,b){ return !!a && !!b && a.catalogueSig!==null && a.catalogueSig===b.catalogueSig && a.dataVersion===b.dataVersion; }

  /* ---------------- catalogue view (read-only; built per call, never stored) ---------------- */
  function view(opts){
    var V=VP(), pub=arr(opts.products).filter(function(p){ return p && !p.disabled; }), byFam={}, enabled={};
    var C=V.catalog(opts.facts,opts.products);                                       /* one catalogue read per step (live prices refreshed) */
    pub.forEach(function(p){ var c=String(p.item_code), g=C.G[c]; if(!g) return; enabled[c]=g; (byFam[g.family]=byFam[g.family]||[]).push(c); });
    var all={}; arr(opts.allProducts).forEach(function(p){ if(p) all[String(p.item_code)]=p; });
    return { G:enabled, byFam:byFam, all:all, hasAll:arr(opts.allProducts).length>0 }; }
  function availability(code,W,storedFam){
    var g=W.G[code]; if(g) return storedFam!=null && g.family!==storedFam?'reclassified':'ok';
    if(W.hasAll && W.all[code]) return W.all[code].disabled?'disabled':'removed';
    return 'removed'; }

  /* ---------------- §8 applicability ---------------- */
  function applicability(opts,W){
    W=W||view(opts); var memo={}, V=VP();
    function tri(slot,fam){
      var key=slot+'@'+fam; if(memo[key]) return memo[key];
      var s=String(slot), i=s.indexOf(':'), kind=i<0?s:s.slice(0,i), arg=i<0?null:s.slice(i+1), r=UNK;
      var spec=SLOT_EVIDENCE[s]||SLOT_EVIDENCE[kind];
      var codes=W.byFam[fam]||[];
      if(spec===1) r='YES';
      else if(spec && spec.onlyIface && arg && arg!==spec.onlyIface) r='NO';                 /* lanes outside PCIe scope */
      else if(spec && codes.length){
        var hit=codes.filter(function(c){ return spec.has(W.G[c],arg); }).length;
        if(spec.anyIsYes && hit>0) r='YES';
        else if(hit>=Math.max(THRESHOLDS.appliesMin,Math.ceil(THRESHOLDS.appliesPct*codes.length))) r='YES';
      }
      memo[key]=r; return r; }                                                               /* a data gap is UNKNOWN, never NO */
    return {
      applies3:tri,
      applies:function(slot,fam){ return tri(slot,fam)!=='NO'; },                              /* discourse boolean: UNKNOWN stays in context */
      families:Object.keys(W.byFam).sort(),
      qualify:function(kind,fam){ if(kind==='ports') return (V.PORT_ROLE_BY_FAMILY||{})[fam]||null; if(kind==='lanes') return 'pcie'; return null; } }; }

  /* ---------------- §9 metric narrowing ---------------- */
  function narrowMetrics(pool,codes,family,opts,W){
    W=W||view(opts);
    var sets=[uniq(codes).filter(function(c){ return W.G[c]; }), family?(W.byFam[family]||[]):[]].filter(function(s){ return s.length; });
    return uniq(pool).filter(function(m){
      if(m==='price') return true;                                                             /* always applicable (live price) */
      var f=METRIC_ATTR[m]; if(!f) return false;
      return sets.some(function(set){ var hit=set.filter(function(c){ return f(W.G[c])!=null; }).length;
        return hit>=Math.max(THRESHOLDS.metricMin,Math.ceil(THRESHOLDS.metricPct*set.length)); }); }); }

  /* ---------------- state: sanitise / validate / (de)serialise ---------------- */
  function sanitize(state){
    if(!isObj(state)) return null;
    var removed=[], s=deepStrip(clone(state),removed,'state');
    if(s.ctx){ s.ctx.unresolved=arr(s.ctx.unresolved).map(function(u){ return { kind:isObj(u)&&u.kind?String(u.kind):null }; }); }   /* §12-A */
    return s; }
  function validate(state){
    var p=[];
    if(!isObj(state)) return { ok:false, problems:['state-not-object'] };
    if(state.v!==STATE_V) p.push('version');
    var c=state.ctx, m=state.meta;
    if(!isObj(c) || c.v!==2 || !isObj(c.frame)) p.push('ctx');
    else {
      if(typeof c.at!=='number' || !isFinite(c.at)) p.push('ctx.at');
      if(typeof c.mode!=='string') p.push('ctx.mode');
      ['candidates','shown','focus','comparison'].forEach(function(k){ if(!Array.isArray(c[k]) || c[k].some(function(x){ return typeof x!=='string'; })) p.push('ctx.'+k); });
      if(!Array.isArray(c.frame.constraints)) p.push('ctx.frame.constraints'); }
    if(!isObj(m)) p.push('meta');
    else {
      if(['ok','empty','failed','clarify'].indexOf(m.resultState)<0) p.push('meta.resultState');
      if(!Array.isArray(m.shownFam) || (isObj(c) && Array.isArray(c.shown) && m.shownFam.length!==c.shown.length)) p.push('meta.shownFam');
      if(m.catalogueSig!==null && typeof m.catalogueSig!=='string') p.push('meta.catalogueSig'); }
    var removed=[]; deepStrip(state,removed,'state'); if(removed.length) p.push('forbidden:'+removed.join(','));
    return { ok:!p.length, problems:p }; }
  function serialize(state){ var s=sanitize(state); return s?JSON.stringify(s):null; }
  function deserialize(text){
    var s; try{ s=JSON.parse(String(text)); }catch(e){ return { state:null, problems:['json'] }; }
    var v=validate(s); return v.ok?{ state:s, problems:[] }:{ state:null, problems:v.problems }; }
  function clear(){ return null; }

  /* ---------------- outcome builders ---------------- */
  function optionsOf(kind,values,labelPrefix){ return uniq(values).slice(0,CAPS.options).map(function(v){ return { id:kind+':'+v, kind:kind, labelKey:labelPrefix+'.'+v, value:v }; }); }
  function clarifyOutcome(base,reason,options,noReason){
    var o=Object.assign(base,{ act:'CLARIFY', reason:reason, codes:[], shown:[], evidence:{} });
    if(options && options.length) o.options=options; else o.noOptions={ reason:noReason||reason };
    return o; }
  function liveEvidence(codes,frame,opts){
    var V=VP(), ev={}; var cons=arr(frame&&frame.constraints);
    if(!cons.length) return ev;
    codes.forEach(function(code){ var e={}; cons.forEach(function(c){ var x=fromA5Probe(c); if(x) e[c.slot]=V.evalConstraint(code,x,opts); }); ev[code]=e; });
    return ev; }
  /* a minimal A5 -> executor mapping for live evidence on target codes (the same kinds the executor maps) */
  function fromA5Probe(c){
    var v=c.value, sl=String(c.slot||''), pol=c.polarity;
    switch(c.kind){
      case 'num': return { kind:'num', attr:sl.split(':')[1], op:c.op||'=', v:v };
      case 'connector': return pol===false?{ kind:'notConnector', id:v.id }:{ kind:'connector', id:v.id, ver:null, gen:null, count:v.count||null, role:v.role||null };
      case 'version': return v&&v.interface?(pol===false?{ kind:'notVersion', id:null, iface:v.interface, ver:v.generation }:{ kind:'ifaceVersion', iface:v.interface, gen:v.generation }):null;
      case 'feature': return { kind:'feature', id:sl.split(':')[1], neg:pol===false, hard:true };
      case 'colour': return { kind:'colour', v:v, neg:pol===false };
      case 'family': return pol===false?{ kind:'notFamily', family:v.family }:{ kind:'family', family:v.family, subtype:v.subtype||null };
      default: return null; } }

  /* ================================= step ================================= */
  function step(stateIn,frameIn,opts){
    opts=opts||{};
    var notes=[], out={ act:null, codes:[], shown:[], evidence:{}, notes:notes, ctxStatus:'none' };
    if(typeof opts.now!=='number' || !isFinite(opts.now) || typeof opts.mode!=='string' || !opts.facts || !Array.isArray(opts.products)){
      notes.push({ code:'opts.invalid' }); out.act='ERROR'; return { outcome:out, state:null }; }
    var D=DIS(), V=VP(), O=ONT(), frame=isObj(frameIn)?clone(frameIn):{};
    var unres=arr(frame.ledger).filter(function(l){ return isObj(l) && l.state==='UNRESOLVED'; }).map(function(l){ return { kind:'unresolved', text:String(l.span) }; });
    var W=view(opts), id=identity(opts), A=applicability(opts,W);
    var shownN=Math.max(1,Math.min(CAPS.shown,typeof opts.shownN==='number'?opts.shownN:CAPS.shown));

    /* -------- 1. pre: shape, clock, mode, TTL, catalogue identity, shown state, prior result state -------- */
    var state=null;
    if(stateIn!==null && stateIn!==undefined){
      var vd=validate(stateIn);
      if(!vd.ok){ notes.push({ code:'ctx.malformed', problems:vd.problems }); out.ctxStatus='malformed'; }
      else state=sanitize(stateIn); }
    if(state){
      var age=opts.now-state.ctx.at, ttl=TTL_MS;
      if(age<0){ notes.push({ code:'ctx.ignored', why:'future' }); out.ctxStatus='malformed'; state=null; }
      else if(age>ttl){ notes.push({ code:'ctx.expired', ageMs:age }); out.ctxStatus='expired'; state=null; }
      else if(state.ctx.mode!==opts.mode){ notes.push({ code:'ctx.modeChanged', from:state.ctx.mode, to:opts.mode }); out.ctxStatus='modeChanged'; state=null; }
      else out.ctxStatus='fresh'; }
    var shownState=[], dataChanged=false;
    if(state){
      if(!sameIdentity(state.meta,id)){ dataChanged=true; out.ctxStatus='dataChanged'; notes.push({ code:'data.changed' }); }
      shownState=state.ctx.shown.map(function(c,i){ return availability(c,W,state.meta.shownFam[i]); });
      if(shownState.indexOf('reclassified')>=0) notes.push({ code:'data.reclassified' }); }
    var ctx=state?clone(state.ctx):null;
    /* the prior search produced nothing usable: no SELECT / ordinal / stock / focus reference on it */
    if(state && state.meta.resultState!=='ok'){
      var refs=frame.ref && /^(ordinal|focus|other|results|code)$/.test(frame.ref.kind);
      if(refs || (frame.intent==='INVENTORY' && !frame.subject) || (frame.flags&&frame.flags.selectCue)){
        clarifyOutcome(out,'prior-result-empty',null,'prior-result-'+state.meta.resultState);
        return { outcome:out, state:keepState(state,opts) }; } }

    /* -------- 2-3. resolve with injected applicability / families / qualify -------- */
    var dopts={ now:opts.now, mode:opts.mode, ttlMs:TTL_MS, applies:A.applies, families:A.families, qualify:A.qualify };
    var keep=arr(frame.keep), same=!!(frame.flags && frame.flags.same);
    /* §12-D keep-slots ("same wattage"): the single focus item's stated value becomes an equality on the context search */
    if(keep.length){
      var kr=resolveKeep(frame,keep,ctx,state,W,A,opts,notes);
      if(kr.outcome){ Object.assign(out,kr.outcome); return { outcome:out, state:state?keepState(state,opts):null }; }
      frame=kr.frame; }
    var res=D.resolve(frame,ctx,dopts);
    res.notes.forEach(function(n){ notes.push(n); });

    /* -------- 4. post-resolve guards -------- */
    var act=res.act, merged=res.mergedFrame?clone(res.mergedFrame):null, fam=merged&&merged.subject&&merged.subject.family||null;
    out.act=act; out.target=res.delta&&res.delta.target?clone(res.delta.target):undefined;
    if(act===null){ /* smalltalk / nodata passthrough: the context is unchanged */
      return { outcome:out, state:state?keepState(state,opts):null }; }
    if(act==='CLARIFY'){
      var narrowed=narrowClarify(res,frame,ctx,state,W,dopts,opts,notes);
      if(narrowed.res){ res=narrowed.res; act=res.act; merged=clone(res.mergedFrame); fam=merged&&merged.subject&&merged.subject.family||null; out.act=act; out.target=clone(res.delta.target); }
      else if(narrowed.notListed){ out.act='NOT_LISTED'; out.reason=narrowed.reason; return { outcome:out, state:state?keepState(state,opts):null }; }
      else { var cl=res.delta.clarify||{};
        var opt=narrowed.options||optionsFromClarify(cl);
        if(opt) opt=opt.filter(function(o){ return o.kind!=='choice' || !!W.G[o.value]; });              /* never offer a product that is no longer listed */
        if(opt && !opt.length) opt=null;
        if(opt) cl.options=opt.map(function(x){ return x.value; });   /* the stored pending clarification binds exactly what was offered */
        else if(cl.options) cl.options=[];
        clarifyOutcome(out,cl.reason||'clarify',opt,cl.reason);
        return { outcome:out, state:storeState(state,res,{ unresolved:unres },opts,id,W,notes) }; } }
    /* own-family EXCLUDE (§12-C): never execute family=false against the context family */
    if(merged){
      var own=arr(merged.constraints).filter(function(c){ return c.kind==='family' && c.polarity===false && c.value && c.value.family===fam; });
      if(own.length && fam){
        notes.push({ code:'exclude.ownFamily', family:fam });
        clarifyOutcome(out,'exclude-own-family',null,'exclude-own-family');
        return { outcome:out, state:state?keepState(state,opts):null }; } }
    /* §11 generation canonicalisation after binding: the raw generation goes to canonVersion unchanged ("gen" is never stripped) */
    if(merged){
      var badV=null;
      merged.constraints.forEach(function(c){ if(c.kind!=='version' || !c.value || !c.value.interface || badV) return;
        var cv=O.canonVersion(c.value.interface,c.value.generation);
        if(cv===null){ badV={ iface:c.value.interface, generation:c.value.generation }; return; }
        if(cv!==c.value.generation){ notes.push({ code:'version.canonical', from:c.value.generation, to:cv }); c.value.generation=cv; } });
      if(badV){ notes.push({ code:'version.unresolved', iface:badV.iface });
        clarifyOutcome(out,'version-unresolved',null,'version-not-valid-for-interface');
        return { outcome:out, state:state?keepState(state,opts):null }; } }
    /* §8 carry across a family SWITCH: only YES slots carry; a carried numeric equality is soft (echoed, never exact-forced) */
    if(act==='SWITCH' && merged && fam){
      var carried=[]; notes.forEach(function(n){ if(n.code==='carried') carried=carried.concat(arr(n.slots)); });
      if(carried.length){
        var drop=carried.filter(function(s){ return A.applies3(s,fam)!=='YES'; });
        if(drop.length){ merged.constraints=merged.constraints.filter(function(c){ return drop.indexOf(c.slot)<0; }); notes.push({ code:'carry.dropped.notApplicable', slots:drop, family:fam }); }
        var soft=merged.constraints.filter(function(c){ return carried.indexOf(c.slot)>=0 && c.kind==='num' && (c.op||'=')==='='; }).map(function(c){ return c.slot; });
        if(soft.length) notes.push({ code:'carry.soft', slots:soft }); } }
    /* §12-D flags.same: a model anchor of the context is retained for the new constraint */
    if(same && merged && ctx && ctx.frame.subject && arr(ctx.frame.subject.anchors).length && (act==='REFINE' || act==='REPLACE')){
      merged.subject=Object.assign({},merged.subject||{},{ anchors:clone(ctx.frame.subject.anchors) }); notes.push({ code:'same.anchorRetained' }); }
    else if(same && merged && !(merged.subject && (merged.subject.family || arr(merged.subject.anchors).length))){
      clarifyOutcome(out,'same-needs-anchor',ctx?optionsOf('choice',okShown(ctx,shownState),'code'):null,'same-needs-anchor');
      return { outcome:out, state:state?keepState(state,opts):null }; }

    /* -------- target acts: validate the target codes against the CURRENT catalogue (never shift an ordinal) -------- */
    if(TARGET_ACTS[act]){
      var tk=res.delta.target&&res.delta.target.kind, tcodes=uniq(res.delta.target&&res.delta.target.codes);
      if(!tcodes.length && tk==='results') tcodes=ctx?ctx.shown.slice(0,shownN):[];
      var gone=tcodes.filter(function(c){ return !W.G[c]; });
      if(gone.length && (tk==='shown' || tk==='results') && gone.length<tcodes.length){   /* a whole-set target: unavailable items are left out, named */
        notes.push({ code:'target.partialUnavailable', codes:gone }); tcodes=tcodes.filter(function(c){ return W.G[c]; }); gone=[]; }
      if(gone.length){
        notes.push({ code:'target.unavailable', codes:gone, states:gone.map(function(c){ return availability(c,W,null); }) });
        clarifyOutcome(out,'target-no-longer-listed',optionsOf('choice',okShown(ctx,shownState),'code'),'no-listed-items');
        return { outcome:out, state:state?keepState(state,opts):null }; }
      out.codes=tcodes.slice(); out.shown=tcodes.slice(0,shownN); out.kind='target';
      out.evidence=liveEvidence(tcodes,merged,opts);
      if(res.delta.stock) out.stock=true;
      return { outcome:out, state:storeState(state,res,{ unresolved:unres, focus:res.focus },opts,id,W,notes) }; }

    /* -------- 5. execute the merged frame over the FULL current catalogue (live prices; re-execution after data change) -------- */
    if(RESULT_ACTS[act] && merged){
      var ex;
      try{ ex=V.executeFrame(merged,opts); }catch(e){ notes.push({ code:'execute.failed' }); clarifyOutcome(out,'execute-failed',null,'execute-failed'); return { outcome:out, state:storeState(state,res,{ unresolved:unres, failed:true },opts,id,W,notes) }; }
      if(ex.kind==='clarify'){ /* subject-less flood guard (executor): ask for the family, with the applicable families as options */
        var mc=arr(merged.constraints).filter(function(c){ return c.polarity===true; });
        var fo=mc.length?A.families.filter(function(f){ return mc.every(function(c){ return A.applies3(c.slot,f)==='YES'; }); }):[];
        clarifyOutcome(out,'needs-family',fo.length && fo.length<=CAPS.options?optionsOf('family',fo,'family'):null,'no-applicable-family');
        return { outcome:out, state:state?keepState(state,opts):null }; }
      var codes=uniq(ex.codes);
      /* no subject-less execution (design §13 #15, §10): a merged frame with no family and no anchor whose results span several
         families is not answered as one list; the family is asked first, with the families actually present as options */
      var defining=arr(merged.constraints).some(function(c){ return c.polarity===true && /^(form|connector|pair|standard)$/.test(c.kind); });   /* the executor's defining kinds; a mixed-family name is NOT one (§13 #15) */
      if(!(merged.subject && (merged.subject.family || arr(merged.subject.anchors).length)) && !defining){
        var famCount={}; codes.forEach(function(c){ var f=W.G[c]&&W.G[c].family; if(f) famCount[f]=(famCount[f]||0)+1; });
        var famsHit=Object.keys(famCount).sort(function(a,b){ return famCount[b]-famCount[a] || (a<b?-1:1); });
        if(famsHit.length>1){ notes.push({ code:'subjectless.multiFamily', families:famsHit.length });
          clarifyOutcome(out,'needs-family',famsHit.length<=CAPS.options?optionsOf('family',famsHit,'family'):null,'too-many-families');
          return { outcome:out, state:state?keepState(state,opts):null }; } }
      if(act==='ALTERNATIVE'){
        var exclude=uniq(res.delta.exclude); codes=codes.filter(function(c){ return exclude.indexOf(c)<0; });
        var rk=merged.rank;
        if(rk && rk.metric==='price' && (rk.dir||'asc')==='asc' && exclude.length===1 && W.G[exclude[0]]){
          var fp=W.G[exclude[0]].srp;
          var before=codes.length; codes=codes.filter(function(c){ var p=W.G[c]&&W.G[c].srp; return fp!=null && p!=null && p<fp; });
          notes.push({ code:'alternative.cheaperThanFocus', removed:before-codes.length }); } }
      if(keep.length && ctx && ctx.focus.length===1) codes=codes.filter(function(c){ return c!==ctx.focus[0]; });
      if(act==='COMPARE_METRIC' && res.delta.target && res.delta.target.kind==='comparison'){
        var cmp=uniq(res.delta.target.codes); codes=codes.filter(function(c){ return cmp.indexOf(c)>=0; }).concat(cmp.filter(function(c){ return codes.indexOf(c)<0 && W.G[c]; })); }
      out.codes=codes; out.shown=codes.slice(0,shownN); out.kind=ex.kind;
      out.evidence={}; codes.forEach(function(c){ if(ex.evidence && ex.evidence[c]) out.evidence[c]=clone(ex.evidence[c]); });
      if(ex.exactCodes) out.exactCodes=uniq(ex.exactCodes).filter(function(c){ return codes.indexOf(c)>=0; });
      if(ex.inferred) out.inferred=uniq(ex.inferred).filter(function(c){ return codes.indexOf(c)>=0; });
      if(dataChanged) notes.push({ code:'reexecuted' });
      if(fam && state && state.meta.family && state.meta.family!==fam && act!=='SWITCH') notes.push({ code:'family.contextKept', family:fam });
      res.mergedFrame=merged;
      return { outcome:out, state:storeState(state,res,{ unresolved:unres, candidates:codes, shown:out.shown, comparison:act==='COMPARE_METRIC'&&ctx?ctx.comparison:[] },opts,id,W,notes) }; }

    clarifyOutcome(out,'nothing-to-apply',null,'nothing-to-apply');
    return { outcome:out, state:state?keepState(state,opts):null };
  }

  /* ---------------- step helpers ---------------- */
  function okShown(ctx,shownState){ return ctx?ctx.shown.filter(function(c,i){ return shownState[i]==='ok' || shownState[i]===undefined; }):[]; }
  function optionsFromClarify(cl){
    var o=arr(cl.options); if(!o.length) return null;
    var kind=cl.slot==='metric'?'metric':cl.slot==='family'?'family':cl.slot==='interface'?'interface':cl.slot==='choice'?'choice':'slot';
    return optionsOf(kind,o,kind==='choice'?'code':kind); }
  /* metric clarifications are narrowed by coverage (§9): one survivor -> COMPARE_METRIC (not for a judgement word), none -> not listed */
  function narrowClarify(res,frame,ctx,state,W,dopts,opts,notes){
    var cl=res.delta&&res.delta.clarify||{}; var D=DIS();
    if(['ambiguous-metric','judgement-needs-metric','alternative-needs-metric'].indexOf(cl.reason)<0 || !ctx) return {};
    var judgement=cl.reason==='judgement-needs-metric', pool=arr(cl.options).length?arr(cl.options):METRIC_POOL;
    var fam=ctx.frame.subject&&ctx.frame.subject.family||null;
    var surv=narrowMetrics(pool,ctx.shown.length?ctx.shown:ctx.candidates,fam,opts,W);
    notes.push({ code:'metric.narrowed', from:uniq(pool), to:surv });
    if(!surv.length){ notes.push({ code:'metric.notListed', family:fam }); return { notListed:true, reason:'metric-not-listed' }; }
    if(surv.length===1 && !judgement && cl.reason!=='alternative-needs-metric'){
      var f2=clone(frame); f2.metric={ metric:surv[0], dir:frame.metric&&frame.metric.dir||'asc' };
      var r2=D.resolve(f2,ctx,dopts); return { res:r2 }; }
    return { options:optionsOf('metric',surv,'metric') }; }
  /* keep-slots: needs a single focus; the value comes from the CURRENT catalogue and must be stated (CONFIRMED) */
  function resolveKeep(frame,keep,ctx,state,W,A,opts,notes){
    var o={ codes:[], shown:[], evidence:{} };
    if(!ctx){ return { outcome:Object.assign(o,{ act:'CLARIFY', reason:'needs-context', noOptions:{ reason:'needs-context' } }) }; }
    if(ctx.focus.length!==1){
      var opt=optionsOf('choice',ctx.shown.filter(function(c){ return W.G[c]; }),'code');
      return { outcome:Object.assign(o,{ act:'CLARIFY', reason:'keep-needs-focus' },opt.length?{ options:opt }:{ noOptions:{ reason:'keep-needs-focus' } }) }; }
    var g=W.G[ctx.focus[0]];
    if(!g){ return { outcome:Object.assign(o,{ act:'CLARIFY', reason:'target-no-longer-listed', noOptions:{ reason:'no-listed-items' } }) }; }
    var fam=g.family, cons=[];
    for(var i=0;i<keep.length;i++){
      var k=keep[i], slot=String(k.slot||''), val=null, kind=null;
      if(slot==='price'){ notes.push({ code:'keep.price.refused' }); return { outcome:Object.assign(o,{ act:'NOT_LISTED', reason:'keep-price-not-a-constraint' }) }; }
      if(slot.indexOf('num:')===0){ var f=METRIC_ATTR[slot.slice(4)]; val=f?f(g):null; kind='num'; }
      else if(slot==='colour'){ val=g.color||null; kind='colour'; }
      else if(slot==='ports'){ val=g.ports?g.ports.total:null; kind='ports'; }
      if(val==null || A.applies3(slot,fam)!=='YES'){ notes.push({ code:'keep.notListed', slot:slot, family:fam });
        return { outcome:Object.assign(o,{ act:'NOT_LISTED', reason:'keep-slot-not-listed' }) }; }
      cons.push({ kind:kind, slot:slot, value:val, op:'=', polarity:true, hard:true, source:{ span:k.span||null } }); }
    notes.push({ code:'keep.applied', slots:cons.map(function(c){ return c.slot; }) });
    var f2={ intent:'FIND', subject:null, constraints:cons.concat(arr(frame.constraints)), fields:arr(frame.fields), flags:{ needsContext:true, elliptical:true }, relax:arr(frame.relax), ref:null, metric:frame.metric||null, rank:frame.rank||null, sameBut:false, ledger:arr(frame.ledger) };
    return { frame:f2 }; }
  /* keep the stored state as it was (refreshing the clock: the conversation is still alive in this mode) */
  function keepState(state,opts){ var s=clone(state); s.ctx.at=opts.now; return sanitize(s); }
  function storeState(state,res,exec,opts,id,W,notes){
    var D=DIS(), prev=state?state.ctx:null;
    var ex={ unresolved:arr(exec.unresolved) };   /* the turn's unresolved report; buildContext writes text, sanitize() strips it (§12-A) */
    if(exec.candidates) ex.candidates=exec.candidates.slice(0,D.CAPS.candidates);
    if(exec.shown) ex.shown=exec.shown.slice(0,D.CAPS.shown);
    if(exec.comparison) ex.comparison=exec.comparison;
    if(exec.focus) ex.focus=exec.focus;
    ex.dataVersion=id.dataVersion;
    var ctx=D.buildContext(prev,res,ex,{ now:opts.now, mode:opts.mode, dataVersion:id.dataVersion });
    var fam=ctx.frame&&ctx.frame.subject&&ctx.frame.subject.family||null;
    var rs=exec.failed?'failed':(res.act==='CLARIFY'?(state?state.meta.resultState:'clarify'):(exec.candidates?(exec.candidates.length?'ok':'empty'):(state?state.meta.resultState:'clarify')));
    var anchors=ctx.frame&&ctx.frame.subject&&arr(ctx.frame.subject.anchors);
    var st={ v:STATE_V, ctx:ctx, meta:{ dataVersion:id.dataVersion, catalogueSig:id.catalogueSig, resultState:rs, family:fam,
      anchorKind:anchors&&anchors.length?String(anchors[0].kind):null, shownFam:ctx.shown.map(function(c){ return W.G[c]?W.G[c].family:null; }) } };
    return sanitize(st); }

  var API={ version:VERSION, TTL_MS:TTL_MS, THRESHOLDS:THRESHOLDS, SLOT_EVIDENCE:SLOT_EVIDENCE, METRIC_ATTR:METRIC_ATTR, CAPS:CAPS,
    step:step, applicability:function(opts){ return applicability(opts); }, narrowMetrics:function(pool,codes,family,opts){ return narrowMetrics(pool,codes,family,opts); },
    identity:identity, sanitize:sanitize, validate:validate, serialize:serialize, deserialize:deserialize, clear:clear };
  if(typeof module!=='undefined' && module.exports) module.exports=API;
  root.VeroContext=API;
})(typeof window!=='undefined'?window:globalThis);
