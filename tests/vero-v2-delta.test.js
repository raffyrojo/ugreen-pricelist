/* VERO Local Brain v2-2A — QueryPlan delta / discourse resolver tests (SHADOW ONLY; js/vero-discourse.js is dormant).
   Run: node tests/vero-v2-delta.test.js
   All discourse cases use SYNTHETIC typed frames in the frozen A5 turn-frame contract (see the header of
   js/vero-discourse.js). Real RELAX / EXCLUDE / comparative / version / ordinal spans only come from the parser in V2-2B.
   Applicability is a synthetic table injected as opts.applies (V2-2C derives it from the facts index).
   Sections: A ADD · B REPLACE · C REFINE_VALUE · D RELAX · E power-bank REFINE · F SELECT · G VERSION · H ATTRIBUTE ·
             I STOCK · J SWITCH/RESET · K EXCLUDE · L COMPARE_METRIC · M ALTERNATIVE · N mandatory CLARIFY ·
             P pending clarification · Q context safety · R price/data safety · S purity · T live-engine freeze ·
             U performance · V frame-contract alignment with v2-1 */
const fs=require('fs'), path=require('path'), vm=require('vm');
const ROOT=path.join(__dirname,'..');
const SRC_PATH=path.join(ROOT,'js','vero-discourse.js'), SRC=fs.readFileSync(SRC_PATH,'utf8');
let pass=0, fail=0; const chk=(n,c,x)=>{ if(c){ pass++; console.log('PASS - '+n); } else { fail++; console.log('FAIL - '+n+(x!==undefined?'  -> '+(typeof x==='string'?x:JSON.stringify(x)).slice(0,700):'')); } };
const safe=(f)=>{ try{ return { v:f() }; }catch(e){ return { err:String(e&&e.stack||e) }; } };

/* ---------------- synthetic world ---------------- */
const FAM=['charger','power_bank','video_cable','hub','adapter'];
const APPLIES={
  'num:watts':['charger','power_bank'], 'num:mah':['power_bank'], 'ports:charging_output':['charger','power_bank'],
  'feature:built_in_cable':['power_bank','charger'], 'feature:magnetic':['power_bank'], 'connector:hdmi':['video_cable','hub','adapter'],
  'standard:hdmi_2_1':['video_cable','adapter'], 'num:lengthM':['video_cable'], 'colour':FAM, 'price':FAM,
  'version:pcie':['adapter'], 'lanes:pcie':['adapter'], 'connector:pcie':['adapter'], 'version:usb':['hub','adapter','video_cable'],
  'num:gbps':['hub','adapter','video_cable'], 'ports:data_port':['hub'] };
const applies=(slot,fam)=>(APPLIES[slot]||[]).includes(fam);
const T0=1e12, MIN=60*1000;
const QUAL={ 'ports|charger':'charging_output', 'ports|power_bank':'charging_output', 'ports|hub':'data_port', 'lanes|adapter':'pcie' };
const qualify=(kind,fam)=>QUAL[kind+'|'+fam]||null;
const OPTS=(o)=>Object.assign({ now:T0, mode:'public', applies, families:FAM, qualify }, o||{});
const con=(kind,slot,value,x)=>Object.assign({ kind, slot, value, polarity:true, hard:true, source:{ span:'s-'+slot } }, x||{});
const fr=(x)=>Object.assign({ intent:'FIND', subject:null, constraints:[], fields:[], flags:{}, relax:[], ref:null, metric:null, sameBut:false, ledger:[] }, x||{});
const prov=(t,a)=>({ turn:t||1, span:'p', act:a||'SWITCH' });
const ctxOf=(x)=>{ x=x||{}; return { v:2, turn:x.turn||1, at:x.at!==undefined?x.at:T0-MIN, mode:x.mode||'public', dataVersion:'1.0',
  frame:{ intent:x.intent||'FIND', subject:x.subject!==undefined?x.subject:{ family:x.family||'charger' }, constraints:(x.cons||[]).map(c=>Object.assign({ polarity:true, hard:true, provenance:prov() }, c)), fields:[], rank:null, compare:null },
  candidates:x.candidates||x.shown||[], shown:x.shown||[], focus:x.focus||[], comparison:x.comparison||[], lastAct:'SWITCH',
  pendingClarification:x.pending, unresolved:[] }; };
const W65={ kind:'num', slot:'num:watts', value:65, op:'=' }, W100={ kind:'num', slot:'num:watts', value:100, op:'=' };
const P3={ kind:'ports', slot:'ports:charging_output', value:3 }, P4={ kind:'ports', slot:'ports:charging_output', value:4 };
const S4=['A1','A2','A3','A4'];
const slots=r=>r.mergedFrame?r.mergedFrame.constraints.map(c=>c.slot).sort():[];
const valOf=(r,s)=>{ const c=r.mergedFrame&&r.mergedFrame.constraints.find(x=>x.slot===s); return c?c.value:undefined; };
const ops=r=>r.delta.ops.map(o=>o.op);
/* accountability: every context slot is in the ledger with a state; every incoming slot is merged, or the act is CLARIFY */
function accountable(r,ctx,frame){
  if(r.act==='CLARIFY' || r.passthrough) return true;
  const L={}; r.inheritedLedger.forEach(l=>L[l.slot]=l.state);
  const ctxOk=!ctx || ctx.frame.constraints.every(c=>L[c.slot] && ['INHERITED','REPLACED','REFINED','REMOVED','DROPPED','NEW'].includes(L[c.slot]));
  const inc=(frame.constraints||[]).every(c=>r.mergedFrame.constraints.some(m=>m.slot===c.slot || (c.slot===c.kind && m.kind===c.kind)));
  /* nothing else the user asked for may vanish: requested fields, a comparative metric, an ordinal / other target */
  const f=(frame.fields||[]), fieldsOk=!f.length || f.every(x=>(r.mergedFrame.fields||[]).includes(x) || r.delta.ops.some(o=>o.op==='ATTRIBUTE' && o.value===x));
  const metricOk=!(frame.metric && frame.metric.metric) || r.act==='SWITCH' && !ctx || (r.mergedFrame.rank && r.mergedFrame.rank.metric===frame.metric.metric);
  const refOk=!(frame.ref && (frame.ref.kind==='ordinal' || frame.ref.kind==='other')) || (r.delta.target && arr(r.delta.target.codes).length===1);
  return ctxOk && inc && fieldsOk && metricOk && refOk; }
function arr(x){ return Array.isArray(x)?x:[]; }
const R=require(SRC_PATH);
const run=(f,c,o)=>{ const r=R.resolve(f,c,OPTS(o)); if(!accountable(r,c,f)) throw new Error('silent drop: '+JSON.stringify(r)); return r; };

/* ================= A  ADD ================= */
{ const c=ctxOf({ cons:[W65], shown:S4 }); const f=fr({ constraints:[con('ports','ports:charging_output',3)], flags:{ elliptical:true, needsContext:true } });
  const r=run(f,c);
  chk('A1 charger+65W ctx + ports=3 (elliptical) -> REFINE with one ADD ports=3', r.act==='REFINE' && eq(ops(r),['ADD']) && r.delta.ops[0].slot==='ports:charging_output');
  chk('A2 merged keeps charger + 65W and adds ports=3', r.mergedFrame.subject.family==='charger' && valOf(r,'num:watts')===65 && valOf(r,'ports:charging_output')===3);
  const L=Object.fromEntries(r.inheritedLedger.map(l=>[l.slot,l]));
  chk('A3 inherited ledger: 65W INHERITED with original provenance, ports NEW with provenance turn 2', L['num:watts'].state==='INHERITED' && L['num:watts'].provenance.turn===1 && L['ports:charging_output'].state==='NEW' && L['ports:charging_output'].provenance.turn===2 && L['ports:charging_output'].provenance.act==='REFINE');
  chk('A4 no duplicate slots in the merged frame', new Set(slots(r)).size===slots(r).length);
  chk('A5 REFINE offers a standalone SWITCH alternative (A1: executor can avoid a 0-result dead end)', r.alternatives && r.alternatives[0].act==='SWITCH' && r.alternatives[0].frame.subject===null && r.alternatives[0].frame.constraints.length===1); }

/* ================= B  REPLACE ================= */
{ const c=ctxOf({ cons:[W65], shown:S4 }); const r=run(fr({ constraints:[con('num','num:watts',100)], flags:{ elliptical:true, followUp:true } }),c);
  chk('B1 65W ctx + watts=100 -> REPLACE 65 -> 100', r.act==='REPLACE' && eq(ops(r),['REPLACE']) && valOf(r,'num:watts')===100);
  chk('B2 exactly one watts constraint after replace', r.mergedFrame.constraints.filter(x=>x.slot==='num:watts').length===1);
  chk('B3 ledger marks watts REPLACED', r.inheritedLedger.find(l=>l.slot==='num:watts').state==='REPLACED'); }

/* ================= C  REFINE_VALUE (numeric operator merge) ================= */
{ const geq=ctxOf({ cons:[{ kind:'num', slot:'num:watts', value:65, op:'>=' }] });
  const r=run(fr({ constraints:[con('num','num:watts',100,{ op:'<' })], flags:{ elliptical:true } }),geq);
  chk('C1 >=65 then <100 -> REFINE_VALUE to range [65,100)', r.act==='REFINE' && eq(ops(r),['REFINE_VALUE']) && eq(valOf(r,'num:watts'),{ lo:65, loIncl:true, hi:100, hiIncl:false }));
  const r2=run(fr({ constraints:[con('num','num:watts',100,{ op:'>=' })], flags:{ elliptical:true } }),geq);
  chk('C2 >=65 then >=100 (same direction) -> REPLACE, latest bound wins', r2.act==='REPLACE' && valOf(r2,'num:watts')===100 && r2.mergedFrame.constraints.find(x=>x.slot==='num:watts').op==='>=');
  const r3=run(fr({ constraints:[con('num','num:watts',65,{ op:'<' })], flags:{ elliptical:true } }),ctxOf({ cons:[{ kind:'num', slot:'num:watts', value:100, op:'>=' }] }));
  chk('C3 contradictory bounds (>=100 then <65) -> CLARIFY with a structured conflict, no invented range', r3.act==='CLARIFY' && r3.delta.clarify.reason==='numeric-conflict' && r3.delta.clarify.conflict.slot==='num:watts' && r3.delta.clarify.conflict.existing.value===100);
  const r4=run(fr({ constraints:[con('num','num:watts',65,{ op:'<=' })], flags:{ elliptical:true } }),geq);
  chk('C4 >=65 then <=65 -> exact 65 (REFINE_VALUE to "=")', valOf(r4,'num:watts')===65 && r4.mergedFrame.constraints.find(x=>x.slot==='num:watts').op==='=');
  const r5=run(fr({ constraints:[con('num','num:watts',65,{ op:'<' })], flags:{ elliptical:true } }),geq);
  chk('C5 >=65 then <65 -> empty range -> CLARIFY', r5.act==='CLARIFY' && r5.delta.clarify.reason==='numeric-conflict');
  const r6=run(fr({ constraints:[con('num','num:watts',120,{ op:'<' })], flags:{ elliptical:true } }),ctxOf({ cons:[{ kind:'num', slot:'num:watts', value:{ lo:65, loIncl:true, hi:100, hiIncl:false }, op:'range' }] }));
  chk('C6 range [65,100) then <120 -> REFINE_VALUE updates the upper side only', eq(valOf(r6,'num:watts'),{ lo:65, loIncl:true, hi:120, hiIncl:false })); }

/* ================= D  RELAX ================= */
{ const c=ctxOf({ cons:[W100,P4], shown:['B1','B2'] }); const r=run(fr({ intent:'ATTRIBUTE', relax:[{ slot:'ports:charging_output', span:'q' }], flags:{ needsContext:true } }),c);
  chk('D1 100W charger + ports=4, RELAX ports -> REMOVE ports', r.act==='RELAX' && eq(ops(r),['REMOVE']) && r.delta.ops[0].slot==='ports:charging_output');
  chk('D2 RELAX keeps charger + 100W', r.mergedFrame.subject.family==='charger' && valOf(r,'num:watts')===100 && valOf(r,'ports:charging_output')===undefined);
  chk('D3 RELAX is echoed (note relaxed) and ledger marks the slot REMOVED', r.notes.some(n=>n.code==='relaxed' && n.slot==='ports:charging_output') && r.inheritedLedger.find(l=>l.slot==='ports:charging_output').state==='REMOVED');
  const r2=run(fr({ relax:[{ slot:'num:lengthM' }], flags:{ needsContext:true } }),ctxOf({ cons:[W100] }));
  chk('D4 RELAX of an inactive slot is a non-destructive no-op with a note', r2.act==='RELAX' && r2.delta.ops.length===0 && eq(slots(r2),['num:watts']) && r2.notes.some(n=>n.code==='relax.inactive')); }

/* ================= E  power-bank REFINE ================= */
{ const c=ctxOf({ family:'power_bank', cons:[{ kind:'num', slot:'num:mah', value:10000, op:'=' }] });
  const r=run(fr({ constraints:[con('feature','feature:built_in_cable',true)], flags:{ needsContext:true, refPronoun:true } }),c);
  chk('E1 power bank 10000mAh + built-in cable -> REFINE ADD feature', r.act==='REFINE' && eq(ops(r),['ADD']));
  chk('E2 family and 10000mAh retained (capacity is never dropped)', r.mergedFrame.subject.family==='power_bank' && valOf(r,'num:mah')===10000 && valOf(r,'feature:built_in_cable')===true); }

/* ================= F  SELECT ================= */
{ const c=ctxOf({ cons:[W65], shown:S4, candidates:S4 });
  const r=run(fr({ ref:{ kind:'ordinal', n:2 } }),c);
  chk('F1 ordinal 2 in range -> SELECT the 2nd shown code', r.act==='SELECT' && eq(r.delta.target.codes,['A2']) && r.focus[0]==='A2');
  const r2=run(fr({ ref:{ kind:'ordinal', n:5 } }),c);
  chk('F2 ordinal beyond the shown count -> CLARIFY (shownCount reported)', r2.act==='CLARIFY' && r2.delta.clarify.reason==='ordinal-out-of-range' && r2.delta.clarify.shownCount===4);
  const r3=run(fr({ constraints:[con('ports','ports:charging_output',3)], flags:{ selectCue:true, needsContext:true } }),c);
  chk('F3 select cue + constraint -> SELECT over the SHOWN codes only (never candidates / catalogue)', r3.act==='SELECT' && r3.delta.target.kind==='shown' && eq(r3.delta.target.codes,S4) && valOf(r3,'ports:charging_output')===3);
  const big=ctxOf({ cons:[W65], shown:S4, candidates:S4.concat(['X1','X2','X3']) });
  const r3b=run(fr({ constraints:[con('ports','ports:charging_output',3)], flags:{ selectCue:true } }),big);
  chk('F4 select never expands to the truncated candidate list', eq(r3b.delta.target.codes,S4));
  const r4=run(fr({ constraints:[con('num','num:watts',100)], flags:{ selectCue:true } }),c);
  chk('F5 select value conflicting with an active hard slot -> REPLACE (re-execute) with a structured note', r4.act==='REPLACE' && valOf(r4,'num:watts')===100 && r4.notes.some(n=>n.code==='select.conflict.replace') && r4.delta.target.kind==='results');
  chk('F6 select with nothing shown -> CLARIFY', run(fr({ constraints:[con('ports','ports:charging_output',3)], flags:{ selectCue:true } }),ctxOf({ cons:[W65] })).act==='CLARIFY'); }

/* ================= G  VERSION (interface, generation) — synthetic, no text parsing ================= */
{ const pc={ kind:'connector', slot:'connector:pcie', value:{ id:'pcie', interface:'pcie' } }, x4={ kind:'lanes', slot:'lanes:pcie', value:4 };
  const c=ctxOf({ family:'adapter', cons:[pc,x4], shown:['V1','V2','V3'] });
  const r=run(fr({ constraints:[con('version','version',{ interface:null, generation:4 })], flags:{ selectCue:true } }),c);
  chk('G1 generation-only span in a PCIe context binds to version:pcie {pcie, 4} and SELECTs on shown', r.act==='SELECT' && eq(valOf(r,'version:pcie'),{ interface:'pcie', generation:4 }) && eq(r.delta.target.codes,['V1','V2','V3']));
  chk('G2 lane width x4 stays a separate lanes slot, untouched by the generation (never a version)', valOf(r,'lanes:pcie')===4 && !r.mergedFrame.constraints.some(x=>x.kind==='version' && x.value.generation===x4.value && x.slot==='lanes:pcie'));
  const cu=ctxOf({ family:'adapter', cons:[pc,{ kind:'version', slot:'version:usb', value:{ interface:'usb', generation:'3.2g2' } }] });
  const r2=run(fr({ constraints:[con('version','version:pcie',{ interface:'pcie', generation:4 })], flags:{ elliptical:true } }),cu);
  chk('G3 PCIe Gen 4 is a different slot from USB Gen: ADD, the USB version is untouched', r2.act==='REFINE' && eq(valOf(r2,'version:usb'),{ interface:'usb', generation:'3.2g2' }) && eq(valOf(r2,'version:pcie'),{ interface:'pcie', generation:4 }));
  const r3=run(fr({ constraints:[con('version','version',{ interface:null, generation:4 })], flags:{ selectCue:true } }),cu);
  chk('G4 generation-only span with two interfaces in context (pcie + usb) -> CLARIFY, never a guess', r3.act==='CLARIFY' && r3.delta.clarify.reason==='version-interface-unknown' && r3.delta.clarify.options.sort().join()==='pcie,usb');
  const r4=run(fr({ constraints:[con('lanes','lanes:pcie',16)], flags:{ elliptical:true } }),c);
  chk('G5 x16 replaces the lane width only; no version constraint is created', r4.act==='REPLACE' && valOf(r4,'lanes:pcie')===16 && !r4.mergedFrame.constraints.some(x=>x.kind==='version'));
  chk('G6 generation-only span with no context -> CLARIFY', R.resolve(fr({ constraints:[con('version','version',{ interface:null, generation:4 })] }),null,OPTS()).act==='CLARIFY');
  chk('G7 version without a generation is malformed -> CLARIFY', R.resolve(fr({ constraints:[con('version','version:pcie',{ interface:'pcie' })], flags:{ elliptical:true } }),c,OPTS()).delta.clarify.reason==='malformed-frame'); }

/* ================= H  ATTRIBUTE_OF_FOCUS ================= */
{ const c=ctxOf({ cons:[W65], shown:['F1'], focus:['F1'] });
  const r=run(fr({ intent:'ATTRIBUTE', fields:['price'], ref:{ kind:'focus' } }),c);
  chk('H1 focused code + field price -> ATTRIBUTE_OF_FOCUS on the focus', r.act==='ATTRIBUTE_OF_FOCUS' && eq(r.delta.target,{ kind:'focus', codes:['F1'] }) && r.delta.ops[0].op==='ATTRIBUTE' && r.delta.ops[0].value==='price');
  chk('H2 only the field is requested: no price value anywhere in the result', !/"(srp|dp|price_value|amount)"\s*:/i.test(JSON.stringify(r)) && !JSON.stringify(r).match(/₱|\bPHP\b/));
  const r2=run(fr({ intent:'ATTRIBUTE', fields:['price'] }),ctxOf({ cons:[W65], shown:S4, candidates:S4 }));
  chk('H3 no focus, everything shown -> ATTRIBUTE over the shown results', r2.act==='ATTRIBUTE_OF_FOCUS' && r2.delta.target.kind==='shown' && eq(r2.delta.target.codes,S4)); }

/* ================= I  STOCK_OF_CONTEXT ================= */
{ const c=ctxOf({ cons:[W65], shown:S4, candidates:S4 });
  const r=run(fr({ intent:'INVENTORY' }),c);
  chk('I1 INVENTORY + no subject + active context -> STOCK_OF_CONTEXT, subject/constraints inherited', r.act==='STOCK_OF_CONTEXT' && r.mergedFrame.subject.family==='charger' && valOf(r,'num:watts')===65 && r.delta.stock===true);
  chk('I2 no stock truth / state / quantity is created anywhere', !/"(stock|stockState|inStock|qty|quantity)"\s*:/.test(JSON.stringify({ m:r.mergedFrame, l:r.inheritedLedger, n:r.notes })) && r.mergedFrame.intent!=='INVENTORY');
  const next=R.buildContext(c,r,{},{ now:T0, mode:'public' });
  chk('I3 stock flag is per-turn only: next context has no stock key and intent is not INVENTORY', !/"\w*stock\w*"\s*:/i.test(JSON.stringify(next)) && next.frame.intent==='FIND' && eq(next.shown,S4));
  const r2=run(fr({ intent:'INVENTORY', constraints:[con('ports','ports:charging_output',3)] }),c);
  chk('I4 INVENTORY + a new constraint -> STOCK_OF_CONTEXT with ADD (subject kept)', r2.act==='STOCK_OF_CONTEXT' && eq(ops(r2),['ADD']) && valOf(r2,'num:watts')===65);
  chk('I5 INVENTORY with no context -> standalone (SWITCH), never inherits anything', R.resolve(fr({ intent:'INVENTORY' }),null,OPTS()).act==='SWITCH');
  const cf=ctxOf({ cons:[W65], shown:['F1','F2'], focus:['F2'] });
  chk('I6 with a focus, stock targets the focus only', eq(run(fr({ intent:'INVENTORY', ref:{ kind:'focus' } }),cf).delta.target,{ kind:'focus', codes:['F2'] })); }

/* ================= J  SWITCH / RESET (power bank -> HDMI class) ================= */
{ const c=ctxOf({ family:'power_bank', cons:[{ kind:'num', slot:'num:mah', value:10000 },{ kind:'feature', slot:'feature:built_in_cable', value:true }], shown:['P1'] });
  const f=fr({ constraints:[con('connector','connector:hdmi',{ id:'hdmi' }),con('standard','standard:hdmi_2_1','hdmi_2_1')] });
  const r=run(f,c);
  chk('J1 complete frame with slots that do not apply to power_bank -> SWITCH (not a merged power-bank search)', r.act==='SWITCH' && r.delta.ops[0].op==='RESET');
  chk('J2 nothing from the old family leaks: no subject, no mAh, no feature', r.mergedFrame.subject===null && eq(slots(r),['connector:hdmi','standard:hdmi_2_1']));
  chk('J3 dropped slots reported structurally (note + ledger DROPPED)', r.notes.some(n=>n.code==='dropped' && eq(n.slots.sort(),['feature:built_in_cable','num:mah'])) && r.inheritedLedger.filter(l=>l.state==='DROPPED').length===2);
  chk('J4 the not-applicable reason is structural (slots + family)', r.notes.some(n=>n.code==='not-applicable' && n.family==='power_bank'));
  const r2=run(fr({ subject:{ family:'video_cable' }, constraints:[con('num','num:lengthM',2)] }),c);
  chk('J5 explicit different family (complete question) -> SWITCH with no carry-over', r2.act==='SWITCH' && r2.mergedFrame.subject.family==='video_cable' && eq(slots(r2),['num:lengthM']));
  const c65=ctxOf({ cons:[W65,{ kind:'colour', slot:'colour', value:'white' }] });
  const r3=run(fr({ subject:{ family:'power_bank' }, flags:{ followUp:true } }),c65);
  chk('J6 elliptical family switch carries only slots that apply to the new family (watts + colour apply to power_bank)', r3.act==='SWITCH' && r3.mergedFrame.subject.family==='power_bank' && eq(slots(r3),['colour','num:watts']) && r3.notes.some(n=>n.code==='carried'));
  const r4=run(fr({ subject:{ family:'video_cable' }, flags:{ followUp:true } }),c65);
  chk('J7 elliptical switch to video_cable: watts dropped and stated, colour carried', eq(slots(r4),['colour']) && r4.notes.some(n=>n.code==='dropped' && eq(n.slots,['num:watts'])));
  const r5=run(fr({ subject:{ family:'charger', anchors:[{ kind:'model', codes:['M9'] }] } }),c65);
  chk('J8 a new anchor in the turn -> SWITCH', r5.act==='SWITCH'); }

/* ================= K  EXCLUDE ================= */
{ const c=ctxOf({ family:'power_bank', cons:[{ kind:'num', slot:'num:mah', value:10000 }] });
  const r=run(fr({ constraints:[con('feature','feature:magnetic',true,{ polarity:false })], flags:{ elliptical:true } }),c);
  chk('K1 negated value -> EXCLUDE (polarity false), capacity kept', r.act==='EXCLUDE' && eq(ops(r),['EXCLUDE']) && r.mergedFrame.constraints.find(x=>x.slot==='feature:magnetic').polarity===false && valOf(r,'num:mah')===10000);
  const c2=R.buildContext(c,r,{ shown:['P1'] },{ now:T0, mode:'public' });
  const r2=run(fr({ constraints:[con('feature','feature:magnetic',true)], flags:{ elliptical:true } }),c2);
  chk('K2 EXCLUDE then ADD of the same value flips polarity (REPLACE), one slot, no contradiction kept', r2.act==='REPLACE' && r2.mergedFrame.constraints.filter(x=>x.slot==='feature:magnetic').length===1 && r2.mergedFrame.constraints.find(x=>x.slot==='feature:magnetic').polarity===true);
  const r3=run(fr({ constraints:[con('feature','feature:magnetic',true,{ polarity:false })], flags:{ elliptical:true } }),c2);
  chk('K3 repeating the same EXCLUDE is idempotent (no duplicate, noted)', r3.mergedFrame.constraints.filter(x=>x.slot==='feature:magnetic').length===1 && r3.notes.some(n=>n.code==='duplicate.ignored')); }

/* ================= L  COMPARE_METRIC ================= */
{ const c=ctxOf({ cons:[W65], shown:['X','Y'], comparison:['X','Y'] });
  const r=run(fr({ metric:{ metric:'watts', dir:'desc' } }),c);
  chk('L1 comparison pair + metric -> COMPARE_METRIC on the pair', r.act==='COMPARE_METRIC' && eq(r.delta.target,{ kind:'comparison', codes:['X','Y'] }) && eq(r.mergedFrame.rank,{ metric:'watts', dir:'desc' }));
  const r2=run(fr({ metric:{ candidates:['gbps','watts'] } }),c);
  chk('L2 ambiguous metric (two speed-like metrics) on the pair -> CLARIFY with metric options', r2.act==='CLARIFY' && r2.delta.clarify.reason==='ambiguous-metric' && eq(r2.delta.clarify.options,['gbps','watts']));
  const r3=run(fr({ metric:{ metric:'price', dir:'asc' } }),ctxOf({ cons:[W65], shown:S4 }));
  chk('L3 no comparison set -> rank the merged search (results); ranking itself happens at execution from live prices', r3.act==='COMPARE_METRIC' && r3.delta.target.kind==='results' && !('codes' in r3.delta.target));
  chk('L4 COMPARE_METRIC carries no price values', !/"(srp|dp)"\s*:/.test(JSON.stringify(r3))); }

/* ================= M  ALTERNATIVE ================= */
{ const c1=ctxOf({ cons:[W65], shown:['F1','F2','F3'], focus:['F1'] });
  const r=run(fr({ intent:'ALTERNATIVE', sameBut:true, metric:{ metric:'price', dir:'asc' } }),c1);
  chk('M1 single focus + metric + same-but cue -> ALTERNATIVE, focus kept as reference and excluded from results', r.act==='ALTERNATIVE' && eq(r.mergedFrame.rank,{ metric:'price', dir:'asc' }) && eq(r.delta.exclude,['F1']) && valOf(r,'num:watts')===65);
  const c2=ctxOf({ cons:[W65], shown:['X','Y'], comparison:['X','Y'], focus:['X'] });
  const r2=run(fr({ intent:'ALTERNATIVE' }),c2);
  chk('M2 ALTERNATIVE without a metric + exactly two compared + focus on one -> complement SELECT of the other', r2.act==='SELECT' && eq(r2.delta.target.codes,['Y']) && r2.delta.ops[0].slot==='complement');
  const r3=run(fr({ ref:{ kind:'other' } }),ctxOf({ cons:[W65], shown:['X','Y'], focus:['Y'] }));
  chk('M3 structural "other" reference with two shown -> the other shown code', r3.act==='SELECT' && eq(r3.delta.target.codes,['X']));
  const r4=run(fr({ ref:{ kind:'other' } }),ctxOf({ cons:[W65], shown:['X','Y','Z'] }));
  chk('M4 "other" reference with three shown -> CLARIFY (set size != 2)', r4.act==='CLARIFY' && r4.delta.clarify.reason==='other-needs-two');
  const r5=run(fr({ intent:'ALTERNATIVE', sameBut:true, metric:{ metric:'price', dir:'asc' } }),ctxOf({ cons:[W65], shown:['X','Y'], focus:['X','Y'] }));
  chk('M5 ALTERNATIVE with two focused items -> CLARIFY (needs a single focus)', r5.act==='CLARIFY' && r5.delta.clarify.reason==='alternative-needs-single-focus');
  chk('M6 ALTERNATIVE without a metric is never a free catalogue search', run(fr({ intent:'ALTERNATIVE' }),ctxOf({ cons:[W65], shown:S4 })).act==='CLARIFY'); }

/* ================= N  mandatory CLARIFY ================= */
{ const c=ctxOf({ cons:[W65], shown:S4, candidates:S4 }), A=(f,cc)=>run(f,cc||c);
  const cases=[
    ['N1 active context + unresolved non-name-shaped span', A(fr({ ledger:[{ span:'u1', state:'UNRESOLVED', nameShaped:false }] })), 'unresolved-in-context'],
    ['N2 ambiguous polarity (negation scope unclear)', A(fr({ constraints:[con('feature','feature:built_in_cable',true,{ polarity:null })], flags:{ elliptical:true } })), 'ambiguous-polarity'],
    ['N3 ordinal beyond shown count', A(fr({ ref:{ kind:'ordinal', n:9 } })), 'ordinal-out-of-range'],
    ['N4 "other" reference where set size != 2', A(fr({ ref:{ kind:'other' } })), 'other-needs-two'],
    ['N5 two or more speed-like metrics', A(fr({ metric:{ candidates:['gbps','watts'] } })), 'ambiguous-metric'],
    ['N6 judgement with no catalogue metric', A(fr({ metric:{ judgement:true, candidates:['watts'] } })), 'judgement-needs-metric'],
    ['N7 AMBIGUOUS high-impact span', A(fr({ constraints:[con('ports','ports:charging_output',3)], ledger:[{ span:'a1', state:'AMBIGUOUS', impact:'high' }], flags:{ elliptical:true } })), 'ambiguous-span'],
    ['N8 family-conflicting elliptical slot that maps to several families', A(fr({ constraints:[con('connector','connector:hdmi',{ id:'hdmi' })], flags:{ elliptical:true, needsContext:true } })), 'family-conflict'],
    ['N9 reference with no focus while results were truncated (not all shown)', A(fr({ intent:'ATTRIBUTE', fields:['price'], ref:{ kind:'focus' } }),ctxOf({ cons:[W65], shown:S4, candidates:S4.concat(['Z1','Z2']) })), 'reference-scope'],
    ['N10 elliptical frame with no context', R.resolve(fr({ constraints:[con('ports','ports:charging_output',3)], flags:{ elliptical:true } }),null,OPTS()), 'needs-context'],
    ['N11 nothing applicable to do with an active context', A(fr({})), 'nothing-to-apply'] ];
  cases.forEach(([n,r,why])=>chk(n+' -> CLARIFY ('+why+')', r.act==='CLARIFY' && r.delta.clarify.reason===why, r.delta));
  chk('N12 a CLARIFY inside a context keeps the context frame (no silent topic loss)', cases.slice(0,9).every(([,r])=>r.mergedFrame && r.mergedFrame.subject && r.mergedFrame.subject.family==='charger'));
  const r8=A(fr({ constraints:[con('connector','connector:hdmi',{ id:'hdmi' })], flags:{ elliptical:true } }));
  chk('N13 family-conflict CLARIFY offers the families the slot implies, as a deferred SWITCH', !!r8.delta.clarify && eq(arr(r8.delta.clarify.options).slice().sort(),['adapter','hub','video_cable']) && r8.delta.clarify.act==='SWITCH' && r8.delta.clarify.slot==='family');
  const rs=A(fr({ constraints:[con('num','num:lengthM',2)], flags:{ elliptical:true } }));
  chk('N14 elliptical slot implying exactly ONE family -> SWITCH to it with a note (not a clarify)', rs.act==='SWITCH' && rs.mergedFrame.subject.family==='video_cable' && rs.notes.some(n=>n.code==='dropped'));
  const rn=A(fr({ ledger:[{ span:'n1', state:'UNRESOLVED', nameShaped:true }] }));
  chk('N15 name-shaped unresolved span with a context -> SWITCH (new name search), never merged', rn.act==='SWITCH' && rn.mergedFrame.constraints.length===0);
  const nd=A(fr({ intent:'NODATA' }));
  chk('N16 no-data request keeps the context (passthrough, no destruction)', nd.passthrough===true && eq(R.buildContext(c,nd,{},{ now:T0, mode:'public' }),c));
  chk('N17 low-impact AMBIGUOUS span does not force a clarify', A(fr({ constraints:[con('ports','ports:charging_output',3)], ledger:[{ span:'a2', state:'AMBIGUOUS', impact:'low' }], flags:{ elliptical:true } })).act==='REFINE'); }

/* ================= P  pending clarification (A2) ================= */
{ const base=ctxOf({ cons:[W65], shown:['X','Y'], comparison:['X','Y'] });
  const cl=R.resolve(fr({ metric:{ candidates:['gbps','watts'] } }),base,OPTS());
  const c1=R.buildContext(base,cl,{},{ now:T0, mode:'public' });
  chk('P1 a CLARIFY with options stores pendingClarification {slot, options, act} and keeps the previous sets', c1.pendingClarification && c1.pendingClarification.slot==='metric' && eq(c1.pendingClarification.options,['gbps','watts']) && c1.pendingClarification.act==='COMPARE_METRIC' && eq(c1.comparison,['X','Y']));
  const r=R.resolve(fr({ metric:{ metric:'watts' } }),c1,OPTS());
  chk('P2 reply bound to the pending metric -> deferred COMPARE_METRIC on the pair', r.act==='COMPARE_METRIC' && eq(r.mergedFrame.rank,{ metric:'watts', dir:'asc' }) && r.notes.some(n=>n.code==='clarification.bound'));
  const rc=R.resolve(fr({ choice:'gbps' }),c1,OPTS());
  chk('P3 chip choice binds the same way', rc.act==='COMPARE_METRIC' && rc.mergedFrame.rank.metric==='gbps');
  const lenCtx=ctxOf({ family:'video_cable', cons:[{ kind:'connector', slot:'connector:hdmi', value:{ id:'hdmi' } }], pending:{ slot:'num:lengthM', options:['1','2'], act:'REFINE' } });
  const r2=R.resolve(fr({ constraints:[con('num','num:lengthM',2)], ledger:[{ span:'u', state:'UNRESOLVED', nameShaped:false }] }),lenCtx,OPTS());
  chk('P4 slot-value reply binds to the pending slot BEFORE ledger handling (deferred REFINE), unresolved text not inherited', r2.act==='REFINE' && valOf(r2,'num:lengthM')===2 && !JSON.stringify(r2.mergedFrame).includes('"u"'));
  const r3=R.resolve(fr({ subject:{ family:'charger' }, constraints:[con('num','num:watts',65)] }),lenCtx,OPTS());
  chk('P5 a new explicit subject overrides the pending clarification (normal resolution -> SWITCH)', r3.act==='SWITCH');
  const famCtx=ctxOf({ cons:[W65], pending:{ slot:'family', options:['hub','video_cable'], act:'SWITCH' } });
  const r4=R.resolve(fr({ choice:'hub' }),famCtx,OPTS());
  chk('P6 deferred SWITCH: choosing a family switches to it carrying only applicable slots', r4.act==='SWITCH' && r4.mergedFrame.subject.family==='hub' && !slots(r4).includes('num:watts'));
  const r5=R.resolve(fr({ choice:'nope' }),famCtx,OPTS());
  chk('P7 an answer outside the options is not bound (noted) and falls back to ordinary resolution', r5.notes.some(n=>n.code==='clarification.unanswered') && r5.act==='CLARIFY');
  const after=R.buildContext(c1,r,{ comparison:['X','Y'] },{ now:T0, mode:'public' });
  chk('P8 pendingClarification lasts one turn (cleared after it is answered)', after.pendingClarification===undefined); }

/* ================= Q  context safety ================= */
{ const f=fr({ constraints:[con('ports','ports:charging_output',3)], flags:{ elliptical:true } });
  const tries=[['null ctx',null],['undefined ctx',undefined],['legacy v1 keepCtx shape',{ plan:{ family:'charger', watts:65 }, codes:['A1'], lastField:'price' }],['wrong v',Object.assign(ctxOf({ cons:[W65] }),{ v:1 })],['string ctx','x'],['ctx without frame',{ v:2, at:T0 }]];
  tries.forEach(([n,cx])=>{ const s=safe(()=>R.resolve(f,cx,OPTS())); chk('Q1 '+n+' -> treated as no context, no throw, elliptical frame CLARIFYs (never REFINE)', !s.err && s.v.act==='CLARIFY' && s.v.delta.clarify.reason==='needs-context', s.err||s.v); });
  const odd=[null,'65W',42,[],{ constraints:[null] },{ constraints:[{ slot:5 }] },{ constraints:[{ kind:'num', slot:'num:watts', value:5, op:'~' }] },{ intent:'UNKNOWN_INTENT', constraints:[{ kind:'weird', slot:'weird:x', value:1 }] },{ flags:'x', ledger:'y', relax:'z' }];
  const res=odd.map(o=>safe(()=>R.resolve(o,ctxOf({ cons:[W65] }),OPTS())));
  chk('Q2 malformed / odd frames never throw', res.every(s=>!s.err), res.filter(s=>s.err).map(s=>s.err));
  chk('Q3 malformed constraints are never silently discarded: CLARIFY malformed-frame with the problem listed', ['constraints:[null]','slot:5','bad op'].every((_,i)=>{ const v=res[4+i].v; return v.act==='CLARIFY' && v.delta.clarify.reason==='malformed-frame' && v.delta.clarify.problems.length>0; }));
  chk('Q4 an unknown slot kind is accounted for (kept in the merged frame or clarified), never dropped', (()=>{ const v=res[7].v; return v.act==='CLARIFY' || v.mergedFrame.constraints.some(c=>c.slot==='weird:x'); })());
  /* idempotence + determinism */
  const c=ctxOf({ cons:[W65], shown:S4 }); const a=R.resolve(f,c,OPTS()), b=R.resolve(f,c,OPTS());
  chk('Q5 deterministic: same input twice -> deep-equal output', eq(a,b));
  const c2=R.buildContext(c,a,{ shown:['A1'] },{ now:T0, mode:'public' }); const a2=R.resolve(f,c2,OPTS());
  chk('Q6 idempotent: the same ADD twice gives no duplicate slot', a2.mergedFrame.constraints.filter(x=>x.slot==='ports:charging_output').length===1);
  const frozen=deepFreeze(JSON.parse(JSON.stringify(f))), fc=deepFreeze(JSON.parse(JSON.stringify(c)));
  const sF=safe(()=>R.resolve(frozen,fc,OPTS()));
  chk('Q7 inputs are never mutated (deep-frozen frame and context accepted, strict mode)', !sF.err, sF.err);
  /* TTL around 15 minutes (time only from opts.now) */
  const ttl=R.TTL_MS; const at=T0-ttl;
  const tt=(age)=>R.resolve(f,ctxOf({ cons:[W65], at:T0-age }),OPTS()).act;
  chk('Q8 TTL just inside (15 min - 1 s) -> context used (REFINE)', tt(ttl-1000)==='REFINE');
  chk('Q9 TTL exact edge (15 min) -> context still valid (REFINE)', tt(ttl)==='REFINE' && at===T0-ttl);
  chk('Q10 TTL just outside (15 min + 1 ms) -> expired, elliptical frame CLARIFYs, note ctx.expired', tt(ttl+1)==='CLARIFY' && R.resolve(f,ctxOf({ cons:[W65], at:T0-ttl-1 }),OPTS()).notes.some(n=>n.code==='ctx.expired'));
  chk('Q11 no injected clock -> context ignored (never reads a system clock)', R.resolve(f,ctxOf({ cons:[W65] }),OPTS({ now:undefined })).delta.clarify.reason==='needs-context');
  chk('Q12 ctx.at in the future -> ignored', R.resolve(f,ctxOf({ cons:[W65], at:T0+5 }),OPTS()).act==='CLARIFY');
  /* mode switch */
  const md=R.resolve(f,ctxOf({ cons:[W65], mode:'public' }),OPTS({ mode:'dealer' }));
  chk('Q13 public -> dealer mode change resets the context (note ctx.modeChanged)', md.act==='CLARIFY' && md.notes.some(n=>n.code==='ctx.modeChanged'));
  const pf=ctxOf({ cons:[W65], mode:'public' }); pf.frame.priceField='srp_view';
  const kept=R.buildContext(pf,R.resolve(f,pf,OPTS()),{ shown:['A1'] },{ now:T0, mode:'public' }), dropped=R.buildContext(pf,{ act:'SWITCH', mergedFrame:pf.frame, delta:{} },{},{ now:T0, mode:'dealer' });
  chk('Q14 priceField survives within a mode but never across a mode change', kept.frame.priceField==='srp_view' && dropped.frame.priceField===undefined);
  /* caps */
  const many=n=>Array.from({ length:n },(_,i)=>'K'+i);
  const capped=R.buildContext(c,a,{ candidates:many(80), shown:many(20), focus:many(9), comparison:many(7) },{ now:T0, mode:'public' });
  chk('Q15 size caps: candidates<=50, shown<=12, focus<=6, comparison<=4', capped.candidates.length===50 && capped.shown.length===12 && capped.focus.length===6 && capped.comparison.length===4);
  /* unresolved never inherited */
  const cu=R.buildContext(c,a,{ shown:['A1'], unresolved:[{ text:'zzq', kind:'word' }] },{ now:T0, mode:'public' });
  const ru=R.resolve(fr({ constraints:[con('colour','colour','black')], flags:{ elliptical:true } }),cu,OPTS());
  const cu2=R.buildContext(cu,ru,{ shown:['A1'] },{ now:T0, mode:'public' });
  chk('Q16 unresolved spans are report-only: never become constraints and never carry to the following context', !JSON.stringify(ru.mergedFrame).includes('zzq') && eq(cu2.unresolved,[]));
  /* anchor / model carry-over only on reference / attribute / alternative / stock turns */
  const an=ctxOf({ subject:{ family:'charger', anchors:[{ kind:'model', codes:['M1'] }] }, cons:[W65], shown:['M1'], focus:['M1'] });
  const rr=R.resolve(fr({ constraints:[con('colour','colour','black')], flags:{ elliptical:true } }),an,OPTS());
  const ra=R.resolve(fr({ intent:'ATTRIBUTE', fields:['price'], ref:{ kind:'focus' } }),an,OPTS());
  const rl=R.resolve(fr({ intent:'ALTERNATIVE', sameBut:true, metric:{ metric:'price', dir:'asc' } }),an,OPTS());
  const rst=R.resolve(fr({ intent:'INVENTORY' }),an,OPTS());
  chk('Q17 REFINE does not carry the model anchor (noted); ATTRIBUTE / ALTERNATIVE / STOCK do', !rr.mergedFrame.subject.anchors && rr.notes.some(n=>n.code==='anchor.notCarried') && ra.mergedFrame.subject.anchors && rl.mergedFrame.subject.anchors && rst.mergedFrame.subject.anchors);
  /* smalltalk passthrough */
  const st=R.resolve(fr({ intent:'SMALLTALK' }),c,OPTS());
  chk('Q18 smalltalk: passthrough, context deep-equal before/after', st.passthrough===true && eq(R.buildContext(c,st,{},{ now:T0, mode:'public' }),c));
  /* 3+ turn chains */
  const T=(f0,cx,exec)=>{ const r=run(f0,cx); return { r, c:R.buildContext(cx,r,exec||{},{ now:T0, mode:'public' }) }; };
  const t1=T(fr({ subject:{ family:'charger' }, constraints:[con('num','num:watts',65)] }),null,{ shown:S4, candidates:S4 });
  const t2=T(fr({ constraints:[con('ports','ports:charging_output',3)], flags:{ elliptical:true } }),t1.c,{ shown:['A1','A2'] });
  const tS=T(fr({ intent:'SMALLTALK' }),t2.c);
  const t3=T(fr({ relax:[{ slot:'ports:charging_output' }], flags:{ needsContext:true } }),tS.c,{ shown:S4 });
  const t4=T(fr({ constraints:[con('connector','connector:hdmi',{ id:'hdmi' })] }),t3.c,{ shown:['H1','H2'], focus:['H1'] });
  const t5=T(fr({ intent:'ATTRIBUTE', fields:['price'], ref:{ kind:'focus' } }),t4.c);
  chk('Q19 chain REFINE -> smalltalk -> RELAX -> SWITCH -> ATTRIBUTE: acts in order', [t1.r.act,t2.r.act,tS.r.act,t3.r.act,t4.r.act,t5.r.act].join()===['SWITCH','REFINE',null,'RELAX','SWITCH','ATTRIBUTE_OF_FOCUS'].join());
  chk('Q20 chain: smalltalk left the context untouched and RELAX removed only ports', eq(tS.c,t2.c) && eq(t3.r.mergedFrame.constraints.map(x=>x.slot),['num:watts']));
  chk('Q21 chain leakage negative: nothing inherited after the SWITCH (no watts, no charger)', eq(t4.r.mergedFrame.constraints.map(x=>x.slot),['connector:hdmi']) && t4.r.mergedFrame.subject===null && eq(t5.r.delta.target.codes,['H1']));
  const u1=T(fr({ subject:{ family:'charger' }, constraints:[con('num','num:watts',65)] }),null,{ shown:S4 });
  const u2=T(fr({ constraints:[con('num','num:watts',100)], flags:{ elliptical:true } }),u1.c,{ shown:['B1'] });
  const u3=T(fr({ subject:{ family:'power_bank' }, constraints:[con('num','num:mah',10000)] }),u2.c,{ shown:['P1'], focus:['P1'] });
  const u4=T(fr({ intent:'INVENTORY' }),u3.c);
  chk('Q22 chain REPLACE -> SWITCH -> STOCK: stock targets the new focus, no charger leakage', [u2.r.act,u3.r.act,u4.r.act].join()==='REPLACE,SWITCH,STOCK_OF_CONTEXT' && u4.r.mergedFrame.subject.family==='power_bank' && !slots(u4.r).includes('num:watts') && eq(u4.r.delta.target.codes,['P1']));
  chk('Q23 turn counter advances and lastAct is recorded', u4.c.turn===4 && u4.c.lastAct==='STOCK_OF_CONTEXT'); }

/* ================= R  price / data safety ================= */
{ const dirty=ctxOf({ cons:[W65,{ kind:'price', slot:'price', value:2000, op:'<=', typed:true }], shown:['A1'] });
  dirty.frame.constraints[0].srp=999; dirty.frame.constraints[0].dp=800; dirty.dealer={ id:'d' }; dirty.frame.moq=10; dirty.frame.dp_volume=700; dirty.answer='rendered text'; dirty.stock='in'; dirty.frame.subject.special_dp=1;
  const f=fr({ constraints:[con('colour','colour','black'),{ kind:'price', slot:'price', value:1500, op:'<=', polarity:true, hard:false, srp:1200, origin:'catalogue' }], flags:{ elliptical:true } });
  const r=R.resolve(f,dirty,OPTS()), next=R.buildContext(dirty,r,{ shown:['A1'], srp:5 },{ now:T0, mode:'public' });
  const FORBID=/"(srp|dp|dp_volume|special_dp|moq|dealer|stock|qty|quantity|answer|rendered|aiAnswer)"\s*:/;
  chk('R1 catalogue SRP/DP/DP Volume/MOQ/dealer/stock/answer keys stripped from mergedFrame', !FORBID.test(JSON.stringify(r.mergedFrame)), JSON.stringify(r.mergedFrame));
  chk('R2 ... and from the inherited ledger and the delta', !FORBID.test(JSON.stringify(r.inheritedLedger)) && !FORBID.test(JSON.stringify(r.delta)));
  chk('R3 ... and from the next SessionContext', !FORBID.test(JSON.stringify(next)), JSON.stringify(next));
  chk('R4 stripping is reported (note stripped with key paths), not silent', r.notes.some(n=>n.code==='stripped' && n.keys.some(k=>/srp/.test(k))));
  chk('R5 the user\'s own TYPED price limit is kept as a constraint and survives REFINE', valOf(r,'price')===2000 && next.frame.constraints.some(c=>c.slot==='price' && c.value===2000));
  chk('R6 a catalogue-origin price constraint is refused and reported (C3)', r.notes.some(n=>n.code==='price.catalogue.refused') && valOf(r,'price')===2000);
  const tp=R.resolve(fr({ constraints:[con('price','price',1500,{ op:'<=' })], flags:{ elliptical:true } }),ctxOf({ cons:[W65] }),OPTS());
  chk('R7 a price parsed from the user text (no typed flag) is the user own limit: accepted, stored as typed (C3)', tp.act==='REFINE' && valOf(tp,'price')===1500 && tp.mergedFrame.constraints.find(c=>c.slot==='price').typed===true);
  chk('R8 the context schema has only the reviewed keys', eq(Object.keys(next).sort(),['at','candidates','comparison','dataVersion','focus','frame','lastAct','mode','shown','turn','unresolved','v'])); }

/* ================= S  purity ================= */
{ const raw=SRC, noWrap=SRC.split('\n').filter(l=>!/^\}\)\(typeof window!=='undefined'\?window:globalThis\);\s*$/.test(l)).join('\n');
  const BAN=['fetch','XMLHttpRequest','sendBeacon','WebSocket','EventSource','import(','importScripts','navigator.','localStorage','document','Date.now','new Date(','Math.random','require(','process.','setTimeout','setInterval','eval(','Function(','window'];
  const hits=BAN.filter(w=>noWrap.includes(w));
  chk('S1 source has no DOM / network / clock / randomness / require / window (outside the UMD wrapper line)', !hits.length, hits);
  chk('S2 the UMD wrapper is the only window reference', (raw.match(/window/g)||[]).length===2 && /\}\)\(typeof window!=='undefined'\?window:globalThis\);\s*$/.test(raw));
  const CUE=['kahit','ayoko','magkano','yung','alin','dun','doon','naman','lang','wala','hindi','meron','pa ba','stock ba','how about','which one','that one','other one','any number','same but','gen 4','mas mura','mas okay','better'];
  const lc=raw.toLowerCase(); const cueHits=CUE.filter(w=>new RegExp('(^|[^a-z])'+w.replace(/ /g,'\\s+')+'([^a-z]|$)').test(lc));
  chk('S3 no phrase / cue-word lists in the source (acts come from structured frame properties)', !cueHits.length, cueHits);
  const codes=new Set(JSON.parse(fs.readFileSync(path.join(ROOT,'data','products.json'),'utf8')).map(p=>String(p.item_code).toUpperCase()));
  const toks=(raw.toUpperCase().match(/[A-Z0-9]+/g)||[]).filter(t=>codes.has(t));
  chk('S4 no catalogue item code anywhere in the source, any quoting, incl. alphanumeric codes ('+codes.size+' codes checked)', !toks.length, toks);
  chk('S5 no 5-digit numerals in the source (G21 regex safety; e.g. a real code like 45000)', !/\b\d{5}[A-Z]{0,2}\b/i.test(raw));
  const BQ=JSON.parse(fs.readFileSync(path.join(__dirname,'vero-sales-questions.json'),'utf8')).questions.map(q=>q.question.toLowerCase());
  const DEV=JSON.parse(fs.readFileSync(path.join(__dirname,'vero-v2-devsets.json'),'utf8')); const DQ=[]; Object.keys(DEV.sets).forEach(k=>DEV.sets[k].items.forEach(it=>DQ.push(String(it.q).toLowerCase())));
  const leakQ=BQ.concat(DQ).filter(q=>q.length>10 && lc.includes(q));
  chk('S6 no benchmark / HO1-3 question text in the source ('+(BQ.length+DQ.length)+' questions)', !leakQ.length, leakQ.slice(0,3));
  const ids=BQ.length?JSON.parse(fs.readFileSync(path.join(__dirname,'vero-sales-questions.json'),'utf8')).questions.map(q=>String(q.id)).filter(i=>i.length>2):[];
  chk('S7 no benchmark ids in the source', !ids.some(i=>new RegExp('\\b'+i+'\\b').test(raw)));
  const famWords=FAM.filter(w=>raw.includes("'"+w+"'"));
  chk('S8 no product-family-specific rules in the source (no family literals)', !famWords.length, famWords);
  /* both UMD paths */
  const cjs=require(SRC_PATH);
  chk('S9 CommonJS export works (resolve, buildContext, OPS, ACTS)', typeof cjs.resolve==='function' && typeof cjs.buildContext==='function' && cjs.OPS.length===9 && cjs.ACTS.length===11);
  const winCtx={ window:{} }; vm.createContext(winCtx); vm.runInContext(SRC,winCtx);
  chk('S10 browser path: sets window.VeroDiscourse and nothing else on window', Object.keys(winCtx.window).join()==='VeroDiscourse' && typeof winCtx.window.VeroDiscourse.resolve==='function');
  const gCtx={}; vm.createContext(gCtx); const before=Object.keys(gCtx); vm.runInContext(SRC,gCtx);
  chk('S11 no-window path: only globalThis.VeroDiscourse is added', eq(Object.keys(gCtx).filter(k=>!before.includes(k)),['VeroDiscourse']));
  chk('S12 OPS and ACTS are exactly the approved sets', eq(cjs.OPS,['ADD','REPLACE','REMOVE','EXCLUDE','REFINE_VALUE','SELECT','ATTRIBUTE','COMPARE_METRIC','RESET']) && eq(cjs.ACTS,['SWITCH','REFINE','REPLACE','RELAX','EXCLUDE','SELECT','ATTRIBUTE_OF_FOCUS','STOCK_OF_CONTEXT','ALTERNATIVE','COMPARE_METRIC','CLARIFY']));
  const ORDER=['index.html','js/vero-lexicon.js','js/vero-nlu.js','js/vero-facts.js','js/vero-plan.js','js/vero-compose.js','js/vero-engine.js','js/vero.js'];
  const refs=ORDER.filter(f=>/vero-discourse|VeroDiscourse/.test(fs.readFileSync(path.join(ROOT,f),'utf8')));
  chk('S13 dormant: vero-discourse.js / VeroDiscourse referenced by NO live file (index.html + all 7 load-order scripts)', !refs.length, refs);
  chk('S14 the frozen A5 frame contract is documented in the module header', /TURN FRAME CONTRACT \(A5/.test(raw) && /SESSION CONTEXT v2/.test(raw)); }

/* ================= T  live-engine freeze (current p2r3a.3 answers unchanged with VeroDiscourse loaded) ================= */
{ const T={ window:{ PRICE_SETTINGS:{ indicatorDays:30 } } };
  delete globalThis.VeroDiscourse; delete require.cache[require.resolve(SRC_PATH)];   /* answers below are captured with NO VeroDiscourse anywhere */
  global.window=T.window;
  eval(fs.readFileSync(path.join(ROOT,'js','helpers.js'),'utf8'));
  ['vero-lexicon','vero-nlu','vero-facts','vero-plan','vero-compose'].forEach(f=>require(path.join(ROOT,'js',f+'.js')));
  const E=require(path.join(ROOT,'js','vero-engine.js'));
  const ALL=JSON.parse(fs.readFileSync(path.join(ROOT,'data','products.json'),'utf8')); pcResolveSchedule(ALL); const PUB=ALL.filter(p=>!p.disabled);
  const productsBefore=JSON.stringify(ALL);
  const BENCH=JSON.parse(fs.readFileSync(path.join(__dirname,'vero-sales-questions.json'),'utf8')).questions;
  const sig=()=>{ const C={}; return JSON.stringify(BENCH.map(q=>{ const conv=q.contextFrom?C[q.contextFrom]:null; const r=E.answer(PUB,q.question,{ conv }), a=E.aiRoute(PUB,q.question,r,{}); C[q.id]=r.ctxOut||conv; return [q.id,r.type,r.codes,r.note,r.echo||null,r.stockNote||null,a.route,a.candidates,a.canEscalate]; })); };
  const winKeys0=Object.keys(global.window).sort(), gKeys0=Object.keys(globalThis).sort();
  const BEFORE=sig();
  delete require.cache[require.resolve(SRC_PATH)]; delete global.window.VeroDiscourse;
  const D=require(SRC_PATH);
  for(let i=0;i<200;i++){ const c=ctxOf({ cons:[W65], shown:S4 }); D.buildContext(c,D.resolve(fr({ constraints:[con('ports','ports:charging_output',3)], flags:{ elliptical:true } }),c,OPTS()),{ shown:['A1'] },{ now:T0, mode:'public' }); }
  const AFTER=sig();
  chk('T1 '+BENCH.length+' benchmark turns (contextFrom chained): type, codes, note, echo, stock note, route, AI candidates byte-identical before/after loading + running VeroDiscourse', BEFORE===AFTER && BENCH.length>=144);
  const winAdded=Object.keys(global.window).sort().filter(k=>!winKeys0.includes(k)), gAdded=Object.keys(globalThis).sort().filter(k=>!gKeys0.includes(k));
  chk('T2 only new global is VeroDiscourse (window), nothing added to globalThis', eq(winAdded,['VeroDiscourse']) && eq(gAdded,[]), { winAdded, gAdded });
  chk('T3 products.json objects not mutated', JSON.stringify(ALL)===productsBefore);
  chk('T4 VeroDiscourse is never consulted by the engine (no reference in engine source)', !/VeroDiscourse/.test(fs.readFileSync(path.join(ROOT,'js','vero-engine.js'),'utf8'))); }

/* ================= U  performance ================= */
{ const times=[]; let chains=0; const hr=()=>process.hrtime.bigint();
  const steps=[
    c=>fr({ constraints:[con('ports','ports:charging_output',1+(chains%4))], flags:{ elliptical:true } }),
    c=>fr({ relax:[{ slot:'ports:charging_output' }], flags:{ needsContext:true } }),
    c=>fr({ constraints:[con('num','num:watts',[30,45,65,100][chains%4],{ op:chains%2?'>=':'=' })], flags:{ elliptical:true } }),
    c=>fr({ intent:'INVENTORY' }),
    c=>fr({ ref:{ kind:'ordinal', n:1+(chains%5) } }),
    c=>fr({ constraints:[con('connector','connector:hdmi',{ id:'hdmi' })] }) ];
  for(chains=0;chains<500;chains++){ let c=null;
    const first=fr({ subject:{ family:'charger' }, constraints:[con('num','num:watts',65)] });
    let s=hr(); let r=R.resolve(first,c,OPTS()); times.push(Number(hr()-s)/1e6); c=R.buildContext(c,r,{ shown:S4, candidates:S4 },{ now:T0, mode:'public' });
    for(let k=0;k<3;k++){ const f=steps[(chains+k)%steps.length](c); s=hr(); r=R.resolve(f,c,OPTS()); times.push(Number(hr()-s)/1e6); c=R.buildContext(c,r,{ shown:S4, candidates:S4 },{ now:T0, mode:'public' }); } }
  times.sort((a,b)=>a-b); const p95=times[Math.floor(times.length*0.95)], p50=times[Math.floor(times.length*0.5)];
  console.log('INFO performance: '+chains+' chains, '+times.length+' resolve calls, p50 '+p50.toFixed(3)+' ms, p95 '+p95.toFixed(3)+' ms, max '+times[times.length-1].toFixed(3)+' ms (Node '+process.version+', '+process.platform+'/'+process.arch+')');
  chk('U1 discourse p95 <= 2 ms over >= 400 synthetic chains', chains>=400 && p95<=2, p95); }

/* ================= V  frame-contract alignment with the v2-1 parser (read-only; nothing in v2-1 changes at A) ================= */
{ const VP=require(path.join(ROOT,'js','vero-parse.js'));
  const src=fs.readFileSync(path.join(ROOT,'js','vero-parse.js'),'utf8');
  const flags=['needsContext','elliptical','refPronoun','selectCue','followUp'].filter(k=>!new RegExp('F\\.'+k+'\\b').test(src));
  chk('V1 the flag names consumed by the contract exist on the v2-1 frame (needsContext, elliptical, refPronoun, selectCue, followUp)', !flags.length, flags);
  const ints=['FIND','ATTRIBUTE','INVENTORY','ALTERNATIVE','SMALLTALK','NODATA','COMPARE'].filter(k=>!src.includes("F.intent='"+k+"'") && !src.includes("intent:'"+k+"'"));
  chk('V2 the intent names consumed by the contract exist in v2-1', !ints.length, ints);
  chk('V3 the ledger states consumed by the contract are the v2-1 states', eq(VP.STATES,['BOUND','UNCONFIRMABLE','UNRESOLVED','AMBIGUOUS']));
  chk('V4 V2-2B still owes: relax / ref / metric / version / lanes / sameBut / choice / slot keys (not emitted by v2-1 yet; documented, not faked)', !/\brelax\s*:/.test(src) && !/\bsameBut\b/.test(src)); }

/* ================= W  regressions from the V2-2A VERO review (real v2-1 shapes + blocking D1–D5, C1, C2) ================= */
{ const c65=ctxOf({ cons:[W65], shown:S4, candidates:S4 });
  /* C1: v2-1 gives an elliptical ports span the wrong role; the contract emits it unqualified and the resolver binds it */
  const w1=run(fr({ constraints:[con('ports','ports',3)], flags:{ needsContext:true, refPronoun:true } }),c65);
  chk('W1 C1 unqualified ports in a charger context binds via qualify -> REFINE ports:charging_output=3 (no SWITCH to hub)', w1.act==='REFINE' && valOf(w1,'ports:charging_output')===3 && w1.mergedFrame.subject.family==='charger');
  const c4=ctxOf({ cons:[W100,P4], shown:['B1','B2'] });
  const w2=run(fr({ relax:[{ slot:'ports' }], flags:{ needsContext:true } }),c4);
  chk('W2 C1 RELAX of an unqualified ports slot removes the single active ports:* slot (H2/H3)', w2.act==='RELAX' && eq(ops(w2),['REMOVE']) && valOf(w2,'ports:charging_output')===undefined && valOf(w2,'num:watts')===100);
  const c2p=ctxOf({ family:'hub', cons:[{ kind:'ports', slot:'ports:data_port', value:3 },{ kind:'ports', slot:'ports:charging_output', value:1 }], shown:['H1'] });
  const w3=R.resolve(fr({ constraints:[con('ports','ports',4)], flags:{ elliptical:true } }),c2p,OPTS());
  const w3c=R.buildContext(c2p,w3,{},{ now:T0, mode:'public' }), w3r=R.resolve(fr({ choice:'ports:data_port' }),w3c,OPTS());
  chk('W3 C1 two active ports slots -> CLARIFY slot-qualifier-ambiguous; the chosen slot completes the deferred REFINE', w3.act==='CLARIFY' && w3.delta.clarify.reason==='slot-qualifier-ambiguous' && w3r.act==='REPLACE' && valOf(w3r,'ports:data_port')===4 && valOf(w3r,'ports:charging_output')===1);
  /* D1: a field request with an ordinal / other reference is an attribute of the selected item */
  const w4=run(fr({ intent:'ATTRIBUTE', fields:['price'], ref:{ kind:'ordinal', n:2 } }),c65);
  chk('W4 D1 field + ordinal 2 -> ATTRIBUTE_OF_FOCUS on shown[1] with the ATTRIBUTE op kept', w4.act==='ATTRIBUTE_OF_FOCUS' && eq(w4.delta.target,{ kind:'focus', codes:['A2'] }) && w4.delta.ops.some(o=>o.op==='SELECT') && w4.delta.ops.some(o=>o.op==='ATTRIBUTE' && o.value==='price') && eq(w4.focus,['A2']));
  const w5=run(fr({ intent:'ATTRIBUTE', fields:['price'], ref:{ kind:'other' } }),ctxOf({ cons:[W65], shown:['X','Y'], comparison:['X','Y'], focus:['X'] }));
  chk('W5 D1 field + "other" reference -> ATTRIBUTE_OF_FOCUS on the complement', w5.act==='ATTRIBUTE_OF_FOCUS' && eq(w5.delta.target.codes,['Y']) && w5.delta.ops.some(o=>o.op==='ATTRIBUTE'));
  /* D2: a comparative together with a constraint keeps the ranking */
  const w6=run(fr({ constraints:[con('ports','ports',3)], metric:{ metric:'price', dir:'asc' }, flags:{ elliptical:true } }),c65);
  chk('W6 D2 metric + constraint -> REFINE with ADD ports and rank price asc', w6.act==='REFINE' && valOf(w6,'ports:charging_output')===3 && eq(w6.mergedFrame.rank,{ metric:'price', dir:'asc' }) && w6.delta.ops.some(o=>o.op==='COMPARE_METRIC'));
  /* D3: the stock path applies applicability and honours a selection */
  const pb=ctxOf({ family:'power_bank', cons:[{ kind:'num', slot:'num:mah', value:10000 }], shown:['P1','P2'] });
  const w7=run(fr({ intent:'INVENTORY', constraints:[con('connector','connector:hdmi',{ id:'hdmi' })] }),pb);
  chk('W7 D3 stock + a slot that does not apply to power_bank -> SWITCH (never merged into a 0-result power-bank stock answer), stock flag kept', w7.act==='SWITCH' && w7.delta.stock===true && !slots(w7).includes('num:mah'));
  const w8=run(fr({ intent:'INVENTORY', ref:{ kind:'ordinal', n:2 } }),ctxOf({ cons:[W65], shown:S4, focus:['A4'] }));
  chk('W8 D3 stock of "the 2nd one" targets shown[1], not the results or the old focus', w8.act==='STOCK_OF_CONTEXT' && eq(w8.delta.target.codes,['A2']) && w8.delta.stock===true);
  /* D4: select conflicts do not depend on hard; an in-range value narrows; a non-applicable slot is not a SELECT */
  const wh=ctxOf({ cons:[W65,{ kind:'colour', slot:'colour', value:'white', hard:false }], shown:S4 });
  const w9=run(fr({ constraints:[con('colour','colour','black',{ hard:false })], flags:{ selectCue:true } }),wh);
  chk('W9 D4 select black while white is active (soft slot) -> REPLACE / re-run, never an empty SELECT', w9.act==='REPLACE' && valOf(w9,'colour')==='black' && w9.delta.target.kind==='results');
  const w10=run(fr({ constraints:[con('num','num:watts',100)], flags:{ selectCue:true } }),ctxOf({ cons:[{ kind:'num', slot:'num:watts', value:65, op:'>=' }], shown:S4 }));
  chk('W10 D4 select 100W inside an active >=65W -> SELECT on shown (narrowing, not a replace)', w10.act==='SELECT' && eq(w10.delta.target.codes,S4));
  const w11=run(fr({ constraints:[con('connector','connector:hdmi',{ id:'hdmi' })], flags:{ selectCue:true } }),c65);
  chk('W11 D4 select cue with a slot that does not apply to chargers -> applicability (CLARIFY family-conflict), never SELECT', w11.act==='CLARIFY' && w11.delta.clarify.reason==='family-conflict');
  /* D5: pending clarifications keep the deferred turn */
  const fcx=R.buildContext(c65,R.resolve(fr({ constraints:[con('connector','connector:hdmi',{ id:'hdmi' })], flags:{ elliptical:true } }),c65,OPTS()),{},{ now:T0, mode:'public' });
  const w12a=R.resolve(fr({ choice:'video_cable' }),fcx,OPTS()), w12b=R.resolve(fr({ subject:{ family:'video_cable' } }),fcx,OPTS());
  chk('W12 D5 family-conflict answered by chip -> SWITCH to video_cable KEEPING the hdmi constraint', w12a.act==='SWITCH' && w12a.mergedFrame.subject.family==='video_cable' && slots(w12a).includes('connector:hdmi') && !slots(w12a).includes('num:watts'));
  chk('W13 D5 family-conflict answered by typing the family (a subject) binds the same way', w12b.act==='SWITCH' && slots(w12b).includes('connector:hdmi') && w12b.notes.some(n=>n.code==='clarification.bound'));
  const vcx0=ctxOf({ family:'adapter', cons:[{ kind:'connector', slot:'connector:pcie', value:{ id:'pcie' }, interfaces:['pcie'] },{ kind:'version', slot:'version:usb', value:{ interface:'usb', generation:'3.2g2' } }], shown:['V1','V2','V3'] });
  const vq=R.resolve(fr({ constraints:[con('version','version',{ interface:null, generation:4 })], flags:{ selectCue:true } }),vcx0,OPTS());
  const w14=R.resolve(fr({ choice:'pcie' }),R.buildContext(vcx0,vq,{},{ now:T0, mode:'public' }),OPTS());
  chk('W14 D5 version-interface CLARIFY answered "pcie" -> deferred SELECT with version:pcie gen 4 (no loop, generation kept)', vq.act==='CLARIFY' && w14.act==='SELECT' && eq(valOf(w14,'version:pcie'),{ interface:'pcie', generation:4 }));
  const fx=ctxOf({ cons:[W65], shown:['F1','F2'], focus:['F1'] });
  const aq=R.resolve(fr({ intent:'ALTERNATIVE', sameBut:true, metric:{ candidates:['price','watts'] } }),fx,OPTS());
  const w15=R.resolve(fr({ choice:'price' }),R.buildContext(fx,aq,{},{ now:T0, mode:'public' }),OPTS());
  chk('W15 D5 alternative metric CLARIFY answered "price" -> ALTERNATIVE excluding the focus (not a plain COMPARE)', aq.act==='CLARIFY' && aq.delta.clarify.act==='ALTERNATIVE' && w15.act==='ALTERNATIVE' && eq(w15.delta.exclude,['F1']) && w15.mergedFrame.rank.metric==='price');
  /* C2: interfaces[] on a context constraint declares the versioned interface */
  const pair=ctxOf({ family:'adapter', cons:[{ kind:'pair', slot:'pair', value:{ from:'nvme', to:'pcie' }, interfaces:['pcie'] },{ kind:'lanes', slot:'lanes:pcie', value:4 }], shown:['V1','V2','V3'] });
  const w16=run(fr({ constraints:[con('version','version',{ interface:null, generation:4 })], flags:{ selectCue:true } }),pair);
  chk('W16 C2 pair constraint declaring interfaces:[pcie] binds Gen 4 -> SELECT version:pcie on shown, lanes untouched', w16.act==='SELECT' && eq(valOf(w16,'version:pcie'),{ interface:'pcie', generation:4 }) && valOf(w16,'lanes:pcie')===4);
  /* other review items */
  const w17=run(fr({ intent:'INVENTORY', subject:{ family:'charger' }, constraints:[con('num','num:watts',45)] }),c65);
  chk('W17 INVENTORY with a same-family subject (complete question) -> SWITCH carrying the per-turn stock flag', w17.act==='SWITCH' && w17.delta.stock===true);
  const alt=R.resolve(fr({ intent:'ALTERNATIVE', sameBut:true, metric:{ metric:'price', dir:'asc' } }),fx,OPTS());
  chk('W18 after ALTERNATIVE the excluded item is NOT the next focus (executor supplies the new focus)', eq(R.buildContext(fx,alt,{ shown:['G1'] },{ now:T0, mode:'public' }).focus,[]));
  const pbm=ctxOf({ family:'power_bank', cons:[{ kind:'num', slot:'num:mah', value:10000 }] });
  const w19=run(fr({ subject:{ family:'power_bank' }, constraints:[con('feature','feature:built_in_cable',true)] }),pbm);
  chk('W19 complete same-family question -> SWITCH, with the REFINE reading (mAh kept) offered as an alternative', w19.act==='SWITCH' && w19.alternatives && w19.alternatives[0].act==='REFINE' && w19.alternatives[0].frame.constraints.some(c=>c.slot==='num:mah'));
  const w20=R.resolve(fr({ intent:'RANK', subject:{ family:'charger' }, constraints:[con('num','num:watts',65)], rank:{ metric:'price', dir:'asc' } }),pbm,OPTS());
  chk('W20 C5 a standalone ranking is kept on SWITCH', w20.act==='SWITCH' && eq(w20.mergedFrame.rank,{ metric:'price', dir:'asc' }));
  const w21=R.resolve(fr({ constraints:[con('ports','ports',3)], flags:{ elliptical:true } }),ctxOf({ family:'video_cable', cons:[{ kind:'num', slot:'num:lengthM', value:2 }] }),OPTS());
  chk('W21 C1 unqualified ports with no qualifier for the family stays unqualified, fails applicability and CLARIFYs inside the context (no silent role guess)', w21.act==='CLARIFY' && w21.delta.clarify.reason==='family-conflict' && eq(w21.delta.clarify.slots,['ports']) && w21.mergedFrame.subject.family==='video_cable');
  /* coverage gaps found by QA mutation testing (round 2) */
  const x1=run(fr({ intent:'ALTERNATIVE', sameBut:true }),ctxOf({ cons:[W65], shown:['F1','F2'], focus:['F1'] }));
  chk('W23 same-but ALTERNATIVE with a single focus but no metric and no candidates -> CLARIFY alternative-needs-metric (never an unranked free search)', x1.act==='CLARIFY' && x1.delta.clarify.reason==='alternative-needs-metric');
  const x2=run(fr({ intent:'INVENTORY', ref:{ kind:'focus' } }),ctxOf({ cons:[W65], shown:S4, candidates:S4.concat(['Z1']) }));
  chk('W24 stock with a focus reference, no focus and truncated results -> CLARIFY reference-scope', x2.act==='CLARIFY' && x2.delta.clarify.reason==='reference-scope');
  const x3=run(fr({ subject:{ family:'charger', anchors:[{ kind:'model', codes:['M9'] }] }, flags:{ followUp:true } }),ctxOf({ cons:[W65] }));
  chk('W25 a new anchor with a follow-up flag still SWITCHes (new-anchor rule, not the complete-question path)', x3.act==='SWITCH' && x3.notes.some(n=>n.code==='switch' && n.why==='new-anchor'));
  chk('W22 accountability helper now also guards fields, metric->rank and ordinal targets (W4/W6/W8 pass through run())', [w4,w6,w8].every(r=>r && r.act!=='CLARIFY')); }

function eq(a,b){ return JSON.stringify(a)===JSON.stringify(b); }
function deepFreeze(o){ if(o && typeof o==='object'){ Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; }

console.log('\nvero-v2-delta: '+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
