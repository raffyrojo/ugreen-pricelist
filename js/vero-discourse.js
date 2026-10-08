/* VERO Local Brain v2-2A — discourse / QueryPlan-delta resolver (SHADOW ONLY, DORMANT).
   Not loaded by index.html or by any live runtime file; nothing calls it in production. Asset gate G23 enforces that.
   Pure and deterministic: no DOM, no network, no clock (time comes from opts.now), no catalogue access, no prices.
   It reasons ONLY from structured frame / context properties. It holds no word or phrase lists; turning words into the
   structured frame below is the parser's job (v2-1 today, v2-2B additions later).

   API
     resolve(frame, ctx, opts)            -> { act, delta, mergedFrame, inheritedLedger, alternatives?, notes, passthrough?, focus? }
     buildContext(prevCtx, result, exec, opts) -> SessionContext v2 for the next turn (sanitised, capped)
     OPS, ACTS, CAPS, TTL_MS, version
   opts: { now (ms, required to use a context), mode, ttlMs?, applies(slotKind, family) -> bool, families: [family],
           qualify(kind, family) -> qualifier | null (C1), turn? }   applies / families / qualify are injected data
           (synthetic tables in V2-2A tests; derived from the facts index in V2-2C).

   ---------------------------------------------------------------------------------------------------------------
   TURN FRAME CONTRACT (A5, frozen at V2-2A). The v2-2B parser additions / v2-2C adapter must emit exactly this shape.
   {
     intent:      'FIND' | 'ATTRIBUTE' | 'INVENTORY' | 'COMPARE' | 'ALTERNATIVE' | 'RANK' | 'SMALLTALK' | 'NODATA' | ... (v2-1 names)
     subject:     null | { family, subtype?, interface?, anchors?: [ { kind, codes: [] } ] }   explicit subject of THIS turn only
     constraints: [ Constraint ]                                                      typed, new in THIS turn
     fields:      [ fieldId ]                                                         requested attributes (e.g. 'price')
     flags:       { needsContext?, elliptical?, refPronoun?, selectCue?, followUp? }  v2-1 frame flags (truthy values)
     relax:       [ { slot, span? } ]           RELAX: an "any value" quantifier bound to a slot -> remove that slot
     ref:         null | { kind: 'focus' | 'results' | 'ordinal' | 'other', n? }      structural reference
                    focus   = singular reference to the focused item(s)
                    results = reference to the shown result set
                    ordinal = nth shown result, n is 1-based
                    other   = complement of the focus inside a two-item set
                    (code   = internal only: set when a clarification answer picks a shown item; never emitted by the parser)
     metric:      null | { metric?, dir?: 'asc' | 'desc', candidates?: [metric], judgement?: true }
                    metric present             -> comparative on that metric (ranks the merged search)
                    no metric, candidates >= 2 -> several metrics fit (e.g. two speed-like metrics) -> CLARIFY
                    judgement without metric   -> evaluative word with no catalogue metric -> CLARIFY with chips
     rank:        null | { metric, dir }        standalone ranking of THIS turn (superlative question)
     sameBut:     bool                          ALTERNATIVE cue: same product kind, improved on a metric
     choice:      optional option id            reply to a pending clarification (chip / option id)
     ledger:      [ { span, state: 'BOUND' | 'UNCONFIRMABLE' | 'UNRESOLVED' | 'AMBIGUOUS', nameShaped?, impact?: 'high' | 'low' } ]
   }
   Constraint {
     kind,             'num' | 'ports' | 'connector' | 'feature' | 'colour' | 'standard' | 'form' | 'price' | 'name' |
                       'pair' | 'version' | 'lanes' | 'family' | 'subtype' | ...
     slot,             canonical slot key, the unit of identity for merge and applicability:
                         num:<attr>  ports:<role>  connector:<id>  feature:<id>  standard:<id>  colour  form  price
                         version:<interface>  lanes:<interface>  pair  name:<id>
     value,            scalar or object. version -> { interface, generation }  (generation is never a lane count)
                                              lanes   -> integer lane width (x4 / x16); a separate slot, never a version
     op?,              numeric: '=' | '>=' | '<=' | '>' | '<'   (default '=')
     polarity,         true = affirm, false = EXCLUDE (negated value), null = ambiguous negation scope -> CLARIFY
     hard,
     interfaces?,      versioned interfaces this constraint declares (e.g. a connector / pair constraint naming PCIe)
     typed?, origin?,  price: a price constraint in a TURN frame is the user's own typed limit by definition; it is
                       refused only when typed === false or origin === 'catalogue'. Stored context keeps typed === true only.
     source: { span }
   }
   Contract rules the v2-2B parser / adapter must follow (found in the V2-2A review against real v2-1 frames):
     C1  Qualified slots whose qualifier comes from the turn's family (ports:<role>, lanes:<interface>) MUST be emitted
         unqualified ('ports', 'lanes') when the turn has no explicit family. The resolver binds an unqualified slot
         (and a RELAX of one) to the single active qualified slot of that kind in the context; two or more -> CLARIFY;
         none -> opts.qualify(kind, contextFamily); still none -> it stays unqualified (applicability on the bare kind).
     C2  A version span without an interface is emitted as slot 'version', value { interface: null, generation }.
         The interface is bound from the context: subject.interface, constraint.interfaces[], or value.interface of any
         active constraint. Exactly one -> bound; none or several -> CLARIFY with the interfaces as options.
     C3  Price constraints parsed from the user's text keep typed (default true); catalogue-derived prices never enter.
     C4  v2-1 field names (v, n, id, neg, attr, field, subject.kind/codes, notConnector, notFamily) are mapped to this
         contract by the adapter; this module never reads v2-1 internals.
     C5  A standalone ranking ("the cheapest ...") travels in rank and is kept on SWITCH.
     C6  Field names in FORBIDDEN_KEYS (e.g. text, qty, inventory) are stripped from every frame and context; an
         executor that needs the raw v2-1 quantity question must read it from the raw parser output, not from here.
   STOCK: INVENTORY intent with no subject. There is NO stock-state field anywhere; stock is a per-turn flag only.

   SESSION CONTEXT v2 (plan §6): { v:2, turn, at, mode, dataVersion, frame:{ intent, subject, constraints[+provenance],
     fields, rank?, compare? }, candidates<=50, shown<=12, focus<=6, comparison<=4, lastAct,
     pendingClarification?: { slot, options, act, deferred }, unresolved[] }. Never stored: rendered text, catalogue
     SRP / DP / DP Volume / MOQ / dealer fields, stock state, AI answers, priceField across a mode change.
     unresolved holds the current turn's report only and is never read back.
   Documented behaviour (V2-2A): RELAX and COMPARE_METRIC keep the context subject including anchors (they work on the
     same search); EXCLUDE of a different value on an affirmed single-value slot replaces the affirmation (ledgered
     REPLACED); without opts.applies a REFINE is not checked for applicability (noted 'applicability.unchecked').
   --------------------------------------------------------------------------------------------------------------- */
(function(root){
  'use strict';
  var VERSION='v2-2A';
  var OPS=['ADD','REPLACE','REMOVE','EXCLUDE','REFINE_VALUE','SELECT','ATTRIBUTE','COMPARE_METRIC','RESET'];
  var ACTS=['SWITCH','REFINE','REPLACE','RELAX','EXCLUDE','SELECT','ATTRIBUTE_OF_FOCUS','STOCK_OF_CONTEXT','ALTERNATIVE','COMPARE_METRIC','CLARIFY'];
  var CAPS={ candidates:50, shown:12, focus:6, comparison:4 };
  var TTL_MS=15*60*1000;
  /* structural field names that must never be stored or emitted (catalogue pricing, dealer data, stock truth, prose) */
  var FORBIDDEN_KEYS={ srp:1, dp:1, dp_volume:1, dpvolume:1, dp_vol:1, special_dp:1, moq:1, dealer:1, dealer_price:1,
    dealerprice:1, dealer_id:1, stock:1, stockstate:1, instock:1, qty:1, quantity:1, inventory:1, answer:1, text:1, html:1,
    rendered:1, aianswer:1, ai:1, reply:1 };
  var NUM_OPS={ '=':1, '>=':1, '<=':1, '>':1, '<':1 };
  var QUALIFIED={ ports:1, lanes:1 };   /* slot kinds whose qualifier may be unknown in an elliptical turn (C1) */

  /* ---------------- helpers ---------------- */
  function isObj(x){ return !!x && typeof x==='object' && !Array.isArray(x); }
  function arr(x){ return Array.isArray(x)?x:[]; }
  function clone(x){ return x===undefined?undefined:JSON.parse(JSON.stringify(x)); }
  function uniqStr(a){ var seen={}, out=[]; arr(a).forEach(function(c){ var k=String(c); if(c!==null && c!==undefined && !seen[k]){ seen[k]=1; out.push(k); } }); return out; }
  function eq(a,b){ return JSON.stringify(a)===JSON.stringify(b); }
  function strip(x,removed,path){
    if(Array.isArray(x)) return x.map(function(v,i){ return strip(v,removed,path+'['+i+']'); });
    if(!isObj(x)) return x;
    var o={}; Object.keys(x).forEach(function(k){
      if(FORBIDDEN_KEYS[k.toLowerCase()]){ removed.push(path?path+'.'+k:k); return; }
      o[k]=strip(x[k],removed,path?path+'.'+k:k); });
    return o; }
  function slotKind(slot){ return String(slot); }
  function familyOf(F){ return F && F.subject && F.subject.family || null; }
  function hasFollowShape(fl){ return !!(fl && (fl.needsContext || fl.elliptical || fl.refPronoun || fl.selectCue || fl.followUp)); }
  function rankOfMetric(m){ return m && m.metric?{ metric:String(m.metric), dir:m.dir||'asc' }:null; }

  /* ---------------- frame sanitising (never silently drops: problems are returned) ---------------- */
  function sanitizeFrame(frame){
    var removed=[], bad=[], priceDropped=[];
    var f=isObj(frame)?strip(clone(frame),removed,'frame'):{};
    var F={ intent:typeof f.intent==='string'?f.intent:null,
      subject:isObj(f.subject)?f.subject:null,
      constraints:[], fields:uniqStr(f.fields), flags:isObj(f.flags)?f.flags:{},
      relax:arr(f.relax).filter(function(r){ return isObj(r) && typeof r.slot==='string'; }),
      ref:isObj(f.ref) && typeof f.ref.kind==='string'?f.ref:null,
      metric:isObj(f.metric)?f.metric:null, rank:isObj(f.rank) && f.rank.metric?{ metric:String(f.rank.metric), dir:f.rank.dir||'asc' }:null,
      sameBut:!!f.sameBut, choice:f.choice===undefined?null:f.choice,
      ledger:arr(f.ledger).filter(isObj) };
    if(!isObj(frame)) bad.push({ why:'frame-not-object' });
    arr(f.constraints).forEach(function(c,i){
      if(!isObj(c) || typeof c.slot!=='string' || !c.slot || typeof c.kind!=='string'){ bad.push({ why:'constraint-malformed', index:i }); return; }
      if(c.kind==='price' && (c.typed===false || c.origin==='catalogue')){ priceDropped.push(c.slot); return; }
      var op=c.op===undefined?'=':c.op;
      if(c.kind==='num' && !NUM_OPS[op]){ bad.push({ why:'constraint-bad-op', index:i, slot:c.slot }); return; }
      if(c.kind==='version' && !(isObj(c.value) && c.value.generation!==undefined && c.value.generation!==null)){ bad.push({ why:'version-without-generation', index:i, slot:c.slot }); return; }
      var x=clone(c); x.op=op; x.polarity=(c.polarity===undefined)?true:c.polarity; x.hard=!!c.hard; if(c.kind==='price') x.typed=true; F.constraints.push(x); });
    if(F.subject && F.subject.anchors) F.subject.anchors=arr(F.subject.anchors).filter(isObj).map(function(a){ return { kind:a.kind, codes:uniqStr(a.codes) }; });
    return { F:F, removed:removed, bad:bad, priceDropped:priceDropped };
  }
  function snapshot(F){ return clone({ intent:F.intent, subject:F.subject, constraints:F.constraints, fields:F.fields, flags:F.flags, relax:F.relax, ref:F.ref, metric:F.metric, rank:F.rank, sameBut:F.sameBut }); }

  /* ---------------- context check: shape, TTL, mode ---------------- */
  function checkContext(ctx,opts,notes){
    if(ctx===null || ctx===undefined) return null;
    if(!isObj(ctx) || ctx.v!==2 || !isObj(ctx.frame)){ notes.push({ code:'ctx.ignored', why:'not a v2 SessionContext' }); return null; }
    var now=opts.now, ttl=typeof opts.ttlMs==='number'?opts.ttlMs:TTL_MS;
    if(typeof now!=='number' || !isFinite(now) || typeof ctx.at!=='number'){ notes.push({ code:'ctx.ignored', why:'no injected clock or no ctx.at' }); return null; }
    var age=now-ctx.at;
    if(age<0){ notes.push({ code:'ctx.ignored', why:'ctx.at is in the future' }); return null; }
    if(age>ttl){ notes.push({ code:'ctx.expired', ageMs:age }); return null; }
    if(opts.mode!==undefined && ctx.mode!==opts.mode){ notes.push({ code:'ctx.modeChanged', from:ctx.mode, to:opts.mode }); return null; }
    var removed=[]; var c=strip(clone(ctx),removed,'ctx');
    if(removed.length) notes.push({ code:'stripped', keys:removed });
    c.frame.constraints=arr(c.frame.constraints).filter(function(k){ return isObj(k) && typeof k.slot==='string' && !(k.kind==='price' && k.typed!==true); });
    c.candidates=uniqStr(c.candidates); c.shown=uniqStr(c.shown); c.focus=uniqStr(c.focus); c.comparison=uniqStr(c.comparison);
    return c;
  }

  /* ---------------- result builders ---------------- */
  function provenanceFor(ctx,opts,c,act){ return { turn:ctx?(ctx.turn||0)+1:(typeof opts.turn==='number'?opts.turn:1), span:c.source&&c.source.span!==undefined?c.source.span:(c.span!==undefined?c.span:null), act:act }; }
  function opOf(c,op,ctx,opts){ var p=provenanceFor(ctx,opts,c,null); var o={ op:op, slot:c.slot }; if(c.value!==undefined) o.value=clone(c.value); if(c.op && c.kind==='num') o.cmp=c.op; o.polarity=c.polarity; o.source={ span:p.span, turn:p.turn }; return o; }
  function stored(c,prov){ var x=clone(c); delete x.source; x.provenance=prov; return x; }
  function result(act,delta,merged,ledger,notes,extra){
    var r={ act:act, delta:delta, mergedFrame:merged, inheritedLedger:ledger, notes:notes };
    if(extra) Object.keys(extra).forEach(function(k){ if(extra[k]!==undefined) r[k]=extra[k]; });
    return r; }
  /* every CLARIFY names its reason; when the user can answer it with an option, it also names the slot, the options,
     the deferred act and a snapshot of this turn so the answer can complete the original request (A2) */
  function clarify(reason,ctx,notes,extra,F){
    var d={ act:'CLARIFY', ops:[], clarify:{ reason:reason } };
    if(extra) Object.keys(extra).forEach(function(k){ if(extra[k]!==undefined) d.clarify[k]=extra[k]; });
    if(F && arr(d.clarify.options).length) d.clarify.deferred=snapshot(F);
    var merged=ctx?clone(ctx.frame):null;
    var ledger=ctx?arr(ctx.frame.constraints).map(function(c){ return { slot:c.slot, state:'INHERITED', provenance:c.provenance||null }; }):[];
    return result('CLARIFY',d,merged,ledger,notes); }
  function inheritAll(ctx){ return arr(ctx.frame.constraints).map(function(c){ return clone(c); }); }
  function ledgerOf(merged,ctx,touched){ var L=[]; var seen={};
    merged.constraints.forEach(function(c){ seen[c.slot]=1; L.push({ slot:c.slot, state:touched[c.slot]||'INHERITED', provenance:c.provenance||null }); });
    if(ctx) arr(ctx.frame.constraints).forEach(function(c){ if(!seen[c.slot]) L.push({ slot:c.slot, state:touched[c.slot]||'DROPPED', provenance:c.provenance||null }); });
    return L; }

  /* ---------------- numeric merge (REFINE_VALUE rule) ----------------
     existing '=' + incoming any            -> REPLACE (the user restated the value / bound)
     existing bound + incoming '='          -> REPLACE
     existing bound + incoming bound, same direction -> REPLACE (latest bound wins)
     existing bound + incoming opposite bound        -> REFINE_VALUE to a range; empty range -> conflict (CLARIFY)
     existing range + incoming bound        -> REFINE_VALUE on that side; empty -> conflict                       */
  function dirOf(op){ return op==='>='||op==='>'?'lo':(op==='<='||op==='<'?'hi':'eq'); }
  function rangeOf(c){ if(c.op==='range') return clone(c.value); var d=dirOf(c.op); if(d==='lo') return { lo:c.value, loIncl:c.op==='>=' }; if(d==='hi') return { hi:c.value, hiIncl:c.op==='<=' }; return null; }
  function emptyRange(r){ if(r.lo===undefined || r.hi===undefined) return false; if(r.lo<r.hi) return false; if(r.lo===r.hi) return !(r.loIncl && r.hiIncl); return true; }
  function mergeNum(old,inc){
    var di=dirOf(inc.op);
    if(di==='eq' || (old.op==='=' )) return { op:'REPLACE', c:inc };
    var r=rangeOf(old), dold=old.op==='range'?'range':dirOf(old.op);
    if(dold!=='range' && dold===di) return { op:'REPLACE', c:inc };
    if(di==='lo'){ r.lo=inc.value; r.loIncl=inc.op==='>='; } else { r.hi=inc.value; r.hiIncl=inc.op==='<='; }
    if(emptyRange(r)) return { op:'CONFLICT', range:r };
    if(r.lo!==undefined && r.hi!==undefined && r.lo===r.hi) return { op:'REFINE_VALUE', c:Object.assign(clone(inc),{ op:'=', value:r.lo }) };
    if(r.lo===undefined || r.hi===undefined) return { op:'REPLACE', c:inc };
    return { op:'REFINE_VALUE', c:Object.assign(clone(inc),{ op:'range', value:r }) };
  }
  /* does an exact incoming value lie inside an existing numeric constraint (so selecting on it narrows, not replaces)? */
  function within(old,c){
    if(old.kind!=='num' || c.kind!=='num' || (c.op||'=')!=='=' || typeof c.value!=='number') return false;
    var v=c.value;
    if(old.op==='range'){ var r=old.value||{}; return (r.lo===undefined || (r.loIncl?v>=r.lo:v>r.lo)) && (r.hi===undefined || (r.hiIncl?v<=r.hi:v<r.hi)); }
    if(old.op==='>=') return v>=old.value; if(old.op==='>') return v>old.value;
    if(old.op==='<=') return v<=old.value; if(old.op==='<') return v<old.value;
    return v===old.value; }

  /* ---------------- applicability (A1) ---------------- */
  function applicability(F,ctxFam,opts,notes){
    var bad=[];
    if(typeof opts.applies!=='function'){ if(F.constraints.length && ctxFam) notes.push({ code:'applicability.unchecked' }); return bad; }
    if(!ctxFam) return bad;
    F.constraints.forEach(function(c){ if(!opts.applies(slotKind(c.slot),ctxFam)) bad.push(c.slot); });
    return bad; }
  function familiesFor(slot,opts){ return typeof opts.applies==='function'?arr(opts.families).filter(function(f){ return opts.applies(slotKind(slot),f); }):[]; }

  /* ---------------- SWITCH ---------------- */
  function doSwitch(F,ctx,opts,notes,why,carryFamily,extra){
    var merged={ intent:F.intent, subject:F.subject?clone(F.subject):null, constraints:[], fields:F.fields.slice(), rank:F.rank||rankOfMetric(F.metric), compare:null };
    var touched={}, ops=[{ op:'RESET', slot:'*' }], carried=[], dropped=[];
    if(carryFamily){ merged.subject={ family:carryFamily }; }
    if(ctx && carryFamily){
      arr(ctx.frame.constraints).forEach(function(c){
        if(F.constraints.some(function(n){ return n.slot===c.slot; })) return;
        if(typeof opts.applies==='function' && opts.applies(slotKind(c.slot),carryFamily)){ merged.constraints.push(clone(c)); carried.push(c.slot); touched[c.slot]='INHERITED'; }
        else dropped.push(c.slot); }); }
    else if(ctx) dropped=arr(ctx.frame.constraints).map(function(c){ return c.slot; });
    F.constraints.forEach(function(c){ merged.constraints.push(stored(c,provenanceFor(ctx,opts,c,'SWITCH'))); touched[c.slot]='NEW'; ops.push(opOf(c,c.polarity===false?'EXCLUDE':'ADD',ctx,opts)); });
    if(merged.rank) ops.push({ op:'COMPARE_METRIC', slot:'rank', value:clone(merged.rank) });
    if(dropped.length){ notes.push({ code:'dropped', slots:dropped }); dropped.forEach(function(s){ touched[s]='DROPPED'; }); }
    if(carried.length) notes.push({ code:'carried', slots:carried });
    if(ctx && ctx.frame.subject && ctx.frame.subject.anchors && ctx.frame.subject.anchors.length && !(F.subject && F.subject.anchors)) notes.push({ code:'anchor.notCarried' });
    notes.push({ code:'switch', why:why });
    return result('SWITCH',{ act:'SWITCH', ops:ops, target:{ kind:'results' } },merged,ledgerOf(merged,ctx,touched),notes,extra);
  }

  /* ---------------- REFINE / REPLACE / EXCLUDE merge onto the context frame (also carries a metric into rank) ---------------- */
  function merge(F,ctx,opts,notes,act0,keepAnchors){
    var merged={ intent:F.intent && F.intent!=='INVENTORY'?F.intent:(ctx.frame.intent||'FIND'), subject:clone(ctx.frame.subject)||null,
      constraints:inheritAll(ctx), fields:F.fields.length?F.fields.slice():arr(ctx.frame.fields).slice(), rank:ctx.frame.rank||null, compare:ctx.frame.compare||null };
    if(ctx.frame.priceField!==undefined) merged.priceField=ctx.frame.priceField;
    if(merged.subject && merged.subject.anchors && !keepAnchors){ delete merged.subject.anchors; notes.push({ code:'anchor.notCarried' }); }
    var ops=[], touched={}, conflict=null;
    F.constraints.forEach(function(c){
      var i=-1; merged.constraints.forEach(function(x,k){ if(x.slot===c.slot) i=k; });
      var prov=provenanceFor(ctx,opts,c,act0);
      if(i<0){ merged.constraints.push(stored(c,prov)); touched[c.slot]='NEW'; ops.push(opOf(c,c.polarity===false?'EXCLUDE':'ADD',ctx,opts)); return; }
      var old=merged.constraints[i];
      if(eq(old.value,c.value) && old.polarity===c.polarity && (old.op||'=')===(c.op||'=')){ touched[c.slot]=touched[c.slot]||'INHERITED'; notes.push({ code:'duplicate.ignored', slot:c.slot }); return; }
      if(eq(old.value,c.value) && old.polarity!==c.polarity){ merged.constraints[i]=stored(c,prov); touched[c.slot]='REPLACED'; ops.push(opOf(c,c.polarity===false?'EXCLUDE':'REPLACE',ctx,opts)); return; }
      if(c.kind==='num' && old.kind==='num'){
        var m=mergeNum(old,c);
        if(m.op==='CONFLICT'){ conflict={ slot:c.slot, existing:{ op:old.op, value:clone(old.value) }, incoming:{ op:c.op, value:c.value } }; return; }
        merged.constraints[i]=stored(m.c,prov); touched[c.slot]=m.op==='REFINE_VALUE'?'REFINED':'REPLACED'; ops.push(opOf(m.c,m.op,ctx,opts)); return; }
      merged.constraints[i]=stored(c,prov); touched[c.slot]='REPLACED'; ops.push(opOf(c,c.polarity===false?'EXCLUDE':'REPLACE',ctx,opts));
    });
    var rk=rankOfMetric(F.metric)||F.rank;
    if(rk){ merged.rank=rk; ops.push({ op:'COMPARE_METRIC', slot:'rank', value:clone(rk) }); }
    return { merged:merged, ops:ops, touched:touched, conflict:conflict };
  }
  function actFromOps(ops){
    var o=ops.filter(function(x){ return x.op!=='COMPARE_METRIC'; });
    if(!o.length) return 'REFINE';
    if(o.every(function(x){ return x.op==='EXCLUDE'; })) return 'EXCLUDE';
    if(o.every(function(x){ return x.op==='REPLACE'; })) return 'REPLACE';
    return 'REFINE'; }

  /* ---------------- C1: bind unqualified slots (ports / lanes) and RELAX targets to the context ---------------- */
  function bindQualifiers(F,ctx,opts){
    var problem=null, fam=familyOf(ctx&&ctx.frame);
    function active(kind){ return ctx?uniqStr(arr(ctx.frame.constraints).filter(function(x){ return String(x.slot).indexOf(kind+':')===0; }).map(function(x){ return x.slot; })):[]; }
    function bind(kind){ var a=active(kind); if(a.length===1) return a[0]; if(a.length>1){ if(!problem) problem={ slot:kind, options:a }; return null; }
      var q=fam && typeof opts.qualify==='function'?opts.qualify(kind,fam):null; return q?kind+':'+q:null; }
    F.constraints.forEach(function(c){ if(QUALIFIED[c.kind] && c.slot===c.kind){ var s=bind(c.kind); if(s) c.slot=s; } });
    F.relax.forEach(function(r){ if(QUALIFIED[r.slot]){ var s=bind(r.slot); if(s) r.slot=s; } });
    return problem; }

  /* ---------------- C2: bind a generation-only version to the context interface ---------------- */
  function interfacesOf(ctx){
    var ifs={}; if(!ctx) return [];
    arr(ctx.frame.constraints).forEach(function(x){
      if(isObj(x.value) && x.value.interface) ifs[x.value.interface]=1;
      arr(x.interfaces).forEach(function(i){ ifs[i]=1; });
      if(typeof x.interface==='string') ifs[x.interface]=1; });
    if(ctx.frame.subject && ctx.frame.subject.interface) ifs[ctx.frame.subject.interface]=1;
    return Object.keys(ifs).sort(); }
  function bindVersion(F,ctx){
    var problem=null, k=null;
    F.constraints.forEach(function(c){
      if(c.kind!=='version' || (c.value && c.value.interface)) return;
      k=k||interfacesOf(ctx);
      if(k.length!==1){ problem={ options:k }; return; }
      c.value={ interface:k[0], generation:c.value.generation }; c.slot='version:'+k[0]; });
    return problem; }

  /* ---------------- A2: complete the deferred turn of a pending clarification with the user's answer ---------------- */
  function answerPending(F,ctx){
    var pc=ctx.pendingClarification, opt=arr(pc.options).map(String), v=null, used=null;
    if(F.choice!==null && opt.indexOf(String(F.choice))>=0) v=String(F.choice);
    else if(pc.slot==='family' && F.subject && F.subject.family && opt.indexOf(String(F.subject.family))>=0) v=String(F.subject.family);
    else if(pc.slot==='metric' && F.metric && F.metric.metric && opt.indexOf(String(F.metric.metric))>=0) v=String(F.metric.metric);
    else F.constraints.forEach(function(c){ if(v===null && c.slot===pc.slot && opt.indexOf(String(c.value))>=0){ v=c.value; used=c; } });
    if(v===null) return null;
    var D=isObj(pc.deferred)?clone(pc.deferred):{ intent:ctx.frame.intent, constraints:[], fields:[], flags:{} };
    D.constraints=arr(D.constraints); D.flags=isObj(D.flags)?D.flags:{};
    if(pc.slot==='metric') D.metric={ metric:v, dir:(D.metric&&D.metric.dir)||'asc' };
    else if(pc.slot==='family'){ D.subject={ family:v }; D.flags.followUp=true; }
    else if(pc.slot==='interface') D.constraints.forEach(function(c){ if(c.kind==='version' && !(c.value && c.value.interface)){ c.value={ interface:v, generation:c.value.generation }; c.slot='version:'+v; } });
    else if(pc.slot==='choice') D.ref={ kind:'code', code:v };
    else if(QUALIFIED[pc.slot]){ D.constraints.forEach(function(c){ if(c.slot===pc.slot) c.slot=v; }); D.relax=arr(D.relax).map(function(r){ return r.slot===pc.slot?{ slot:v, span:r.span }:r; }); }
    else D.constraints=D.constraints.filter(function(c){ return c.slot!==pc.slot; }).concat([used?clone(used):{ kind:pc.kind||'value', slot:pc.slot, value:v, polarity:true, hard:true, source:{ span:null } }]);
    F.constraints.forEach(function(c){ if(c!==used && !D.constraints.some(function(d){ return d.slot===c.slot; })) D.constraints.push(clone(c)); });
    return D; }

  /* ================================= resolve ================================= */
  function resolveCore(frame,ctxIn,opts,depth){
    var notes=[];
    var S=sanitizeFrame(frame), F=S.F;
    if(S.removed.length) notes.push({ code:'stripped', keys:S.removed });
    if(S.priceDropped.length) notes.push({ code:'price.catalogue.refused', slots:S.priceDropped });
    var ctx=depth?ctxIn:checkContext(ctxIn,opts,notes);
    if(S.bad.length) return clarify('malformed-frame',ctx,notes,{ problems:S.bad });

    /* smalltalk / help: the context passes through unchanged */
    if(F.intent==='SMALLTALK') return result(null,{ act:null, ops:[] },ctx?clone(ctx.frame):null,[],notes,{ passthrough:true });

    /* A2: a pending clarification is resolved BEFORE ordinary discourse resolution */
    if(ctx && ctx.pendingClarification && !depth){
      var D=answerPending(F,ctx);
      var rest=clone(ctx); delete rest.pendingClarification;
      if(D){ var rb=resolveCore(D,rest,opts,1); rb.notes=notes.concat([{ code:'clarification.bound', slot:ctx.pendingClarification.slot, act:ctx.pendingClarification.act||null }],rb.notes); return rb; }
      notes.push({ code:'clarification.unanswered', slot:ctx.pendingClarification.slot }); ctx=rest;
    }

    /* ledger safety */
    var unresolved=F.ledger.filter(function(l){ return l.state==='UNRESOLVED'; });
    var ambiguous=F.ledger.filter(function(l){ return l.state==='AMBIGUOUS' && l.impact!=='low'; });
    if(ambiguous.length) return clarify('ambiguous-span',ctx,notes,{ spans:ambiguous.map(function(l){ return l.span; }) });
    if(ctx && unresolved.some(function(l){ return !l.nameShaped; })) return clarify('unresolved-in-context',ctx,notes,{ spans:unresolved.map(function(l){ return l.span; }) });
    if(unresolved.length) notes.push({ code:'unresolved.reported', spans:unresolved.map(function(l){ return l.span; }) });

    /* polarity and metric ambiguity */
    var amb=F.constraints.filter(function(c){ return c.polarity===null; });
    if(amb.length) return clarify('ambiguous-polarity',ctx,notes,{ slots:amb.map(function(c){ return c.slot; }) });
    if(F.metric && !F.metric.metric && arr(F.metric.candidates).length>=2) return clarify('ambiguous-metric',ctx,notes,{ slot:'metric', options:F.metric.candidates.slice(), act:F.intent==='ALTERNATIVE'||F.sameBut?'ALTERNATIVE':'COMPARE_METRIC' },F);
    if(F.metric && !F.metric.metric && F.metric.judgement) return clarify('judgement-needs-metric',ctx,notes,{ slot:'metric', options:arr(F.metric.candidates).slice(), act:'COMPARE_METRIC' },F);

    var follow=hasFollowShape(F.flags) || !!F.ref || F.relax.length>0 || (!!F.metric && !F.subject) || F.sameBut;

    /* no usable context */
    if(!ctx){
      if(F.constraints.some(function(c){ return c.kind==='version' && !(c.value && c.value.interface); })) return clarify('version-interface-unknown',null,notes,{ slot:'interface' });
      if(F.intent==='NODATA') return result(null,{ act:null, ops:[] },null,[],notes.concat([{ code:'nodata' }]),{ passthrough:true });
      if(follow && !F.subject) return clarify('needs-context',null,notes);
      return doSwitch(F,null,opts,notes,'no-context');
    }
    if(F.intent==='NODATA') return result(null,{ act:null, ops:[] },clone(ctx.frame),ledgerOf(ctx.frame,ctx,{}),notes.concat([{ code:'nodata' }]),{ passthrough:true });

    /* a name-shaped unresolved span with nothing else to apply is a new topic (name search), not a refinement */
    if(unresolved.length && !F.subject && !F.constraints.length && !F.fields.length && !F.relax.length && !F.ref && !F.metric && F.intent!=='INVENTORY') return doSwitch(F,ctx,opts,notes,'unresolved-name');

    var ctxFam=familyOf(ctx.frame);
    /* explicit subject in this turn */
    if(F.subject){
      if(F.subject.anchors && F.subject.anchors.length) return doSwitch(F,ctx,opts,notes,'new-anchor');
      if(F.subject.family && F.subject.family!==ctxFam) return doSwitch(F,ctx,opts,notes,'new-family',follow?F.subject.family:null);
      if(!follow){
        /* complete question about the same family: a new search, but the refinement reading is offered as an alternative */
        var mq=merge(F,ctx,opts,[],'REFINE',false);
        return doSwitch(F,ctx,opts,notes,'complete-question',null,mq.conflict?null:{ alternatives:[{ act:'REFINE', frame:mq.merged }] }); }
    }

    /* C1 / C2 binding against the context */
    var qb=bindQualifiers(F,ctx,opts);
    if(qb) return clarify('slot-qualifier-ambiguous',ctx,notes,{ slot:qb.slot, options:qb.options, act:'REFINE' },F);
    var vb=bindVersion(F,ctx);
    if(vb) return clarify('version-interface-unknown',ctx,notes,{ slot:'interface', options:vb.options, act:F.flags.selectCue?'SELECT':'REFINE' },vb.options.length?F:null);

    /* A1 applicability: applies to every path that brings constraints (refine, select, stock) */
    if(F.constraints.length){
      var bad=applicability(F,ctxFam,opts,notes);
      if(bad.length){
        if(hasFollowShape(F.flags)){
          var fams={}; bad.forEach(function(s){ familiesFor(s,opts).forEach(function(f){ fams[f]=(fams[f]||0)+1; }); });
          var all=Object.keys(fams).filter(function(f){ return fams[f]===bad.length; }).sort();
          if(all.length===1) return doSwitch(F,ctx,opts,notes,'slot-implies-family',all[0]);
          return clarify('family-conflict',ctx,notes,{ slot:'family', slots:bad, options:all, act:'SWITCH' },all.length?F:null);
        }
        notes.push({ code:'not-applicable', slots:bad, family:ctxFam });
        return doSwitch(F,ctx,opts,notes,'slot-not-applicable');
      }
    }

    /* selection target from an ordinal / complement / chosen code (SELECT on what was shown) */
    var sel=null;
    if(F.ref && F.ref.kind==='ordinal'){
      var n=F.ref.n;
      if(typeof n!=='number' || n<1 || n>ctx.shown.length || Math.floor(n)!==n) return clarify('ordinal-out-of-range',ctx,notes,{ shownCount:ctx.shown.length, slot:'choice', options:ctx.shown.slice(), act:'SELECT' },F);
      sel={ kind:'ordinal', n:n, codes:[ctx.shown[n-1]], op:{ op:'SELECT', slot:'ordinal', value:n } };
    }
    var otherRef=(F.ref && F.ref.kind==='other') || (F.intent==='ALTERNATIVE' && !(F.metric && F.metric.metric) && !F.sameBut);
    if(otherRef){
      var set=ctx.comparison.length===2?ctx.comparison:(ctx.shown.length===2?ctx.shown:null);
      if(!set) return clarify('other-needs-two',ctx,notes,{ comparisonCount:ctx.comparison.length, shownCount:ctx.shown.length });
      var restC=set.filter(function(c){ return ctx.focus.indexOf(c)<0; });
      if(restC.length!==1) return clarify('other-without-focus',ctx,notes,{ slot:'choice', options:set.slice(), act:'SELECT' },F);
      sel={ kind:'shown', codes:restC, op:{ op:'SELECT', slot:'complement', value:restC[0] } };
    }
    if(F.ref && F.ref.kind==='code'){
      var code=String(F.ref.code);
      if(ctx.shown.indexOf(code)<0 && ctx.comparison.indexOf(code)<0 && ctx.focus.indexOf(code)<0) return clarify('choice-not-shown',ctx,notes);
      sel={ kind:'shown', codes:[code], op:{ op:'SELECT', slot:'code', value:code } };
    }

    /* A4: stock of the context (INVENTORY, no subject, active context); honours a selection */
    if(F.intent==='INVENTORY'){
      if(!sel && F.ref && F.ref.kind==='focus' && !ctx.focus.length && ctx.candidates.length>ctx.shown.length) return clarify('reference-scope',ctx,notes);
      var ms=merge(F,ctx,opts,notes,'STOCK_OF_CONTEXT',true);
      if(ms.conflict) return clarify('numeric-conflict',ctx,notes,{ conflict:ms.conflict });
      ms.merged.intent=ctx.frame.intent||'FIND';
      var tgt=sel?{ kind:sel.kind, codes:sel.codes.slice() }:(ctx.focus.length?{ kind:'focus', codes:ctx.focus.slice() }:{ kind:'results' });
      return result('STOCK_OF_CONTEXT',{ act:'STOCK_OF_CONTEXT', ops:(sel?[sel.op]:[]).concat(ms.ops), target:tgt },ms.merged,ledgerOf(ms.merged,ctx,ms.touched),notes,{ focus:sel?sel.codes.slice():undefined }); }

    /* a selection with a field request is an attribute of the selected item; otherwise a plain SELECT */
    if(sel){
      var mS=merge(F,ctx,opts,notes,'SELECT',true);
      if(mS.conflict) return clarify('numeric-conflict',ctx,notes,{ conflict:mS.conflict });
      if(F.fields.length){ mS.merged.intent='ATTRIBUTE';
        return result('ATTRIBUTE_OF_FOCUS',{ act:'ATTRIBUTE_OF_FOCUS', ops:[sel.op].concat(mS.ops,F.fields.map(function(f){ return { op:'ATTRIBUTE', slot:'field', value:f }; })), target:{ kind:'focus', codes:sel.codes.slice() } },mS.merged,ledgerOf(mS.merged,ctx,mS.touched),notes,{ focus:sel.codes.slice() }); }
      return result('SELECT',{ act:'SELECT', ops:[sel.op].concat(mS.ops), target:{ kind:sel.kind, n:sel.n, codes:sel.codes.slice() } },mS.merged,ledgerOf(mS.merged,ctx,mS.touched),notes,{ focus:sel.codes.slice() }); }

    /* ALTERNATIVE on a single focus: keep the focus key constraints, rank by the metric (ranking happens at execution) */
    if(F.intent==='ALTERNATIVE' || F.sameBut){
      if(ctx.focus.length!==1) return clarify('alternative-needs-single-focus',ctx,notes,{ focusCount:ctx.focus.length });
      if(!(F.metric && F.metric.metric)) return clarify('alternative-needs-metric',ctx,notes,{ slot:'metric', options:arr(F.metric&&F.metric.candidates).slice(), act:'ALTERNATIVE' },F);
      var ma=merge(F,ctx,opts,notes,'ALTERNATIVE',true);
      if(ma.conflict) return clarify('numeric-conflict',ctx,notes,{ conflict:ma.conflict });
      return result('ALTERNATIVE',{ act:'ALTERNATIVE', ops:ma.ops, target:{ kind:'results' }, exclude:ctx.focus.slice() },ma.merged,ledgerOf(ma.merged,ctx,ma.touched),notes); }

    /* ATTRIBUTE of the focus / shown results */
    if(F.fields.length && !F.constraints.length && !F.relax.length && (F.intent==='ATTRIBUTE' || F.ref)){
      if(!ctx.focus.length && ctx.candidates.length>ctx.shown.length) return clarify('reference-scope',ctx,notes,{ fields:F.fields.slice() });
      var mt=clone(ctx.frame); mt.fields=F.fields.slice(); mt.intent='ATTRIBUTE';
      var at=ctx.focus.length?{ kind:'focus', codes:ctx.focus.slice() }:{ kind:'shown', codes:ctx.shown.slice() };
      return result('ATTRIBUTE_OF_FOCUS',{ act:'ATTRIBUTE_OF_FOCUS', ops:F.fields.map(function(f){ return { op:'ATTRIBUTE', slot:'field', value:f }; }), target:at },mt,ledgerOf(mt,ctx,{}),notes); }

    /* comparative on the context search / comparison set */
    if(F.metric && F.metric.metric && !F.constraints.length && !F.relax.length){
      var mc=clone(ctx.frame); mc.rank=rankOfMetric(F.metric);
      var ct=ctx.comparison.length>=2?{ kind:'comparison', codes:ctx.comparison.slice() }:{ kind:'results' };
      return result('COMPARE_METRIC',{ act:'COMPARE_METRIC', ops:[{ op:'COMPARE_METRIC', slot:'rank', value:clone(mc.rank) }], target:ct },mc,ledgerOf(mc,ctx,{}),notes); }

    /* RELAX: remove the slot; relaxing an inactive slot is a no-op with a note */
    if(F.relax.length){
      var mr=clone(ctx.frame), opsR=[], touchedR={};
      F.relax.forEach(function(r){
        var had=mr.constraints.some(function(c){ return c.slot===r.slot; });
        if(had){ mr.constraints=mr.constraints.filter(function(c){ return c.slot!==r.slot; }); opsR.push({ op:'REMOVE', slot:r.slot, source:{ span:r.span===undefined?null:r.span } }); touchedR[r.slot]='REMOVED'; notes.push({ code:'relaxed', slot:r.slot }); }
        else notes.push({ code:'relax.inactive', slot:r.slot }); });
      if(F.constraints.length || rankOfMetric(F.metric)){
        var ctx2=clone(ctx); ctx2.frame=mr;
        var mm=merge(Object.assign({},F,{ relax:[] }),ctx2,opts,notes,'RELAX',true);
        if(mm.conflict) return clarify('numeric-conflict',ctx,notes,{ conflict:mm.conflict });
        mr=mm.merged; opsR=opsR.concat(mm.ops); Object.keys(mm.touched).forEach(function(k){ touchedR[k]=mm.touched[k]; }); }
      return result('RELAX',{ act:'RELAX', ops:opsR, target:{ kind:'results' } },mr,ledgerOf(mr,ctx,touchedR),notes); }

    /* SELECT with a constraint on the shown results; a value that contradicts an active slot re-runs the search */
    if((F.flags.selectCue || (F.ref && F.ref.kind==='results')) && F.constraints.length){
      if(!ctx.shown.length) return clarify('nothing-shown',ctx,notes);
      var conflictSlots=F.constraints.filter(function(c){ return c.kind!=='version' && ctx.frame.constraints.some(function(x){ return x.slot===c.slot && !(eq(x.value,c.value) && x.polarity===c.polarity) && !within(x,c); }); }).map(function(c){ return c.slot; });
      var msel=merge(F,ctx,opts,notes,conflictSlots.length?'REPLACE':'SELECT',!conflictSlots.length);
      if(msel.conflict) return clarify('numeric-conflict',ctx,notes,{ conflict:msel.conflict });
      if(conflictSlots.length){ notes.push({ code:'select.conflict.replace', slots:conflictSlots });
        return result('REPLACE',{ act:'REPLACE', ops:msel.ops, target:{ kind:'results' } },msel.merged,ledgerOf(msel.merged,ctx,msel.touched),notes); }
      return result('SELECT',{ act:'SELECT', ops:[{ op:'SELECT', slot:'shown', value:ctx.shown.slice() }].concat(msel.ops), target:{ kind:'shown', codes:ctx.shown.slice() } },msel.merged,ledgerOf(msel.merged,ctx,msel.touched),notes); }

    /* constraints without a subject (applicability already checked): REFINE / REPLACE / EXCLUDE */
    if(F.constraints.length){
      var mf2=merge(F,ctx,opts,notes,'REFINE',false);
      if(mf2.conflict) return clarify('numeric-conflict',ctx,notes,{ conflict:mf2.conflict });
      var act=actFromOps(mf2.ops);
      var alts=F.constraints.some(function(c){ return c.polarity===true; })?[{ act:'SWITCH', frame:{ intent:F.intent||'FIND', subject:null, constraints:F.constraints.map(function(c){ return stored(c,provenanceFor(ctx,opts,c,'SWITCH')); }), fields:F.fields.slice(), rank:mf2.merged.rank&&rankOfMetric(F.metric)?rankOfMetric(F.metric):null } }]:undefined;
      return result(act,{ act:act, ops:mf2.ops, target:{ kind:'results' } },mf2.merged,ledgerOf(mf2.merged,ctx,mf2.touched),notes,{ alternatives:alts });
    }

    return clarify('nothing-to-apply',ctx,notes);
  }
  function resolve(frame,ctx,opts){
    var r=resolveCore(frame,ctx,opts||{},0);
    /* stock is a per-turn flag on the delta of every non-clarify answer to an INVENTORY turn (never stored) */
    if(r.act && r.act!=='CLARIFY' && isObj(frame) && frame.intent==='INVENTORY') r.delta.stock=true;
    return r; }

  /* ================================= next SessionContext ================================= */
  function buildContext(prev,res,exec,opts){
    opts=opts||{}; exec=exec||{};
    if(res && res.passthrough) return prev===undefined?null:clone(prev);
    var p=isObj(prev) && prev.v===2?prev:null;
    var act=res?res.act:null;
    var base=res && res.mergedFrame?res.mergedFrame:(p?p.frame:{ intent:null, subject:null, constraints:[], fields:[] });
    var removed=[]; var fr=strip(clone(base),removed,'frame');
    fr.constraints=arr(fr.constraints).filter(function(c){ return isObj(c) && typeof c.slot==='string' && !(c.kind==='price' && c.typed!==true); });
    if(act==='STOCK_OF_CONTEXT' && p) fr.intent=p.frame.intent||'FIND';
    if(fr.intent==='INVENTORY') fr.intent='FIND';
    var modeChanged=!!(p && opts.mode!==undefined && p.mode!==opts.mode);
    /* acts that do not produce a new result set keep the previous sets unless the executor supplies new ones */
    var keepSets=p && (act==='CLARIFY' || act==='SELECT' || act==='ATTRIBUTE_OF_FOCUS' || act==='STOCK_OF_CONTEXT' || act==='COMPARE_METRIC');
    var setOf=function(k){ return exec[k]!==undefined?exec[k]:(keepSets?p[k]:[]); };
    var ctx={ v:2, turn:(p?p.turn||0:0)+1, at:opts.now, mode:opts.mode, dataVersion:exec.dataVersion!==undefined?exec.dataVersion:(opts.dataVersion!==undefined?opts.dataVersion:(p?p.dataVersion:null)),
      frame:{ intent:fr.intent||null, subject:fr.subject||null, constraints:fr.constraints, fields:arr(fr.fields), rank:fr.rank||null, compare:fr.compare||null },
      candidates:uniqStr(setOf('candidates')).slice(0,CAPS.candidates), shown:uniqStr(setOf('shown')).slice(0,CAPS.shown),
      focus:uniqStr(exec.focus!==undefined?exec.focus:(res&&res.focus?res.focus:(keepSets?p.focus:[]))).slice(0,CAPS.focus), comparison:uniqStr(setOf('comparison')).slice(0,CAPS.comparison),
      lastAct:act, unresolved:arr(exec.unresolved).filter(isObj).map(function(u){ return { text:String(u.text===undefined?'':u.text), kind:u.kind||null }; }) };
    if(fr.priceField!==undefined && !modeChanged) ctx.frame.priceField=fr.priceField;
    var cl=act==='CLARIFY' && res.delta && res.delta.clarify;
    if(cl && arr(cl.options).length){
      ctx.pendingClarification={ slot:cl.slot||'choice', options:arr(cl.options).map(String), act:cl.act||'SELECT' };
      if(isObj(cl.deferred)) ctx.pendingClarification.deferred=strip(clone(cl.deferred),removed,'deferred'); }
    return ctx;
  }

  var API={ version:VERSION, OPS:OPS, ACTS:ACTS, CAPS:CAPS, TTL_MS:TTL_MS, resolve:resolve, buildContext:buildContext };
  if(typeof module!=='undefined' && module.exports) module.exports=API;
  root.VeroDiscourse=API;
})(typeof window!=='undefined'?window:globalThis);
