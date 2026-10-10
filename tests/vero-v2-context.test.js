/* VERO Local Brain V2-2C C2 — context layer tests (SHADOW ONLY; js/vero-context.js is never loaded by the live site).
   Run: node tests/vero-v2-context.test.js
   Chains run through the real C1 parser (turnFrame), the unchanged VeroDiscourse and the C1 executor. Fixtures are derived
   from data/products.json at run time (no SKU lists); catalogue changes use in-memory clones only (nothing is written).
   CX.P purity · CX.S stored state · CX.T TTL / mode · CX.D catalogue identity / stale data · CX.L live prices · CX.R refine
   semantics · CX.O ordinals · CX.K same / keep · CX.E evidence · CX.A applicability · CX.M metric narrowing · CX.G guards ·
   CX.MUT mutation kills */
const fs=require('fs'), path=require('path'), crypto=require('crypto'), vm=require('vm');
const ROOT=path.join(__dirname,'..');
global.window={ PRICE_SETTINGS:{ indicatorDays:30 } };
eval(fs.readFileSync(path.join(ROOT,'js','helpers.js'),'utf8'));
['vero-lexicon','vero-nlu','vero-facts'].forEach(f=>require(path.join(ROOT,'js',f+'.js')));
const VF=window.VeroFacts, O=require(path.join(ROOT,'js','vero-ontology.js')), VP=require(path.join(ROOT,'js','vero-parse.js'));
const D=require(path.join(ROOT,'js','vero-discourse.js')), VC=require(path.join(ROOT,'js','vero-context.js'));
const CTX_SRC=fs.readFileSync(path.join(ROOT,'js','vero-context.js'),'utf8'), DISC_SRC=fs.readFileSync(path.join(ROOT,'js','vero-discourse.js'),'utf8');
const ALL=JSON.parse(fs.readFileSync(path.join(ROOT,'data','products.json'),'utf8')); pcResolveSchedule(ALL);
const PUB=ALL.filter(p=>!p.disabled), FACTS=VF.build(PUB);
const DV=(JSON.parse(fs.readFileSync(path.join(ROOT,'data','settings.json'),'utf8')).app||{}).dataVersion||'dv';
const POPTS={ facts:FACTS, products:PUB };
let pass=0, fail=0; const chk=(n,c,x)=>{ if(c){ pass++; console.log('PASS - '+n); } else { fail++; console.log('FAIL - '+n+(x!==undefined?'  -> '+String(x).slice(0,700):'')); } };
const TF=(q,po)=>VP.turnFrame(VP.parse(q,po||POPTS));
const G=c=>VP.graphFor(c,POPTS);
const T0=1e12; let clock=T0;
const base=(extra)=>Object.assign({ now:clock, mode:'public', facts:FACTS, products:PUB, allProducts:ALL, dataVersion:DV },extra||{});
/* one chain: [q | frame | {q, opts, dt}] -> per-turn { q, outcome, state } */
function chain(turns,o){ let s=(o&&o.state)||null; const out=[];
  turns.forEach(t=>{ const x=typeof t==='string'?{ q:t }:t; clock+=x.dt===undefined?60000:x.dt;
    const op=base(Object.assign({},(o&&o.opts)||{},x.opts||{},{ now:clock }));
    const fr=x.frame||TF(x.q,{ facts:op.facts, products:op.products });
    const r=VC.step(x.state!==undefined?x.state:s,fr,op); s=r.state; out.push({ q:x.q||'(frame)', outcome:r.outcome, state:r.state }); });
  return out; }
const last=a=>a[a.length-1];
const famCodes=f=>PUB.map(p=>String(p.item_code)).filter(c=>G(c)&&G(c).family===f);
function deepFreeze(o){ if(o && typeof o==='object' && !Object.isFrozen(o)){ Object.freeze(o); Object.keys(o).forEach(k=>deepFreeze(o[k])); } return o; }
const FORBID_DISC=new Set((DISC_SRC.match(/var FORBIDDEN_KEYS=\{([\s\S]*?)\};/)||[,''])[1].match(/\b\w+(?=:1)/g)||[]);
const FORBID_CTX=new Set((CTX_SRC.match(/var FORBIDDEN=\{([\s\S]*?)\};/)||[,''])[1].match(/\b\w+(?=:1)/g)||[]);
const keysDeep=(x,acc)=>{ acc=acc||[]; if(Array.isArray(x)) x.forEach(v=>keysDeep(v,acc)); else if(x&&typeof x==='object') Object.keys(x).forEach(k=>{ acc.push(k); keysDeep(x[k],acc); }); return acc; };
const optionShapeOk=o=>o.act!=='CLARIFY' || ((Array.isArray(o.options) && o.options.length>0 && o.options.every(x=>x.id && x.kind && x.labelKey && x.value!==undefined) && !o.noOptions) || (!o.options && o.noOptions && typeof o.noOptions.reason==='string'));
/* clone the catalogue (in memory only) with an edit */
function catalogueWith(edit){ const all=JSON.parse(JSON.stringify(ALL)); edit(all); pcResolveSchedule(all); const pub=all.filter(p=>!p.disabled); return { allProducts:all, products:pub, facts:VF.build(pub) }; }

function carryCase(){ const A=VC.applicability(base()); const fr=(fam,cons,flags)=>({ intent:'FIND', subject:{ family:fam }, constraints:cons, fields:[], flags:flags||{}, relax:[], ref:null, metric:null, rank:null, sameBut:false, ledger:[] });
  for(const slot of ['num:lengthM','num:mah','num:watts','num:gbps']) for(const a of A.families) for(const b of A.families){ if(a===b || famCodes(a).length<5 || famCodes(b).length<5) continue;
    if(A.applies3(slot,a)==='YES' && A.applies3(slot,b)==='UNKNOWN') return { slot, from:a, to:b, turns:[{ frame:fr(a,[{ kind:'num', slot, value:2, op:'=', polarity:true, hard:true, source:{ span:'s0' } }]) },{ frame:fr(b,[],{ followUp:true }) }] }; }
  return null; }

/* ================= CX.P purity ================= */
{ chk('CX.P1 js/vero-discourse.js is byte-identical (sha f5b766d7…) and has no reference to the context layer (no discourse dependency on C2)',
    crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,'js','vero-discourse.js'))).digest('hex')==='f5b766d715410c7998fd7dd5bfc4b48d74284311103b3962d4d778c3fdf27f04' && !/VeroContext|vero-context/.test(DISC_SRC));
  const nocom=CTX_SRC.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'');
  chk('CX.P2 no network, DOM, storage or wall clock in vero-context.js (fetch / XHR / sendBeacon / document / localStorage / Date)', !/\bfetch\s*\(|XMLHttpRequest|sendBeacon|\bdocument\.|localStorage|sessionStorage|\bDate\s*\.|new Date/.test(nocom));
  const codes=new Set(ALL.map(p=>String(p.item_code).toUpperCase())); const leak=(CTX_SRC.toUpperCase().match(/\b\d{5}[A-Z]{0,2}\b/g)||[]).filter(t=>codes.has(t));
  chk('CX.P3 no catalogue item code, no priceSchedule read and no user-facing negative wording ("wala", "we don\'t have") in vero-context.js', !leak.length && !/priceSchedule/.test(CTX_SRC) && !/\bwala\b|we don.t have|hindi ko makita/i.test(nocom), leak);
  chk('CX.P4 qualify reuses PORT_ROLE_BY_FAMILY from vero-parse.js (single source: no copy of the port-role table in vero-context.js)', !/charging_output|data_port/.test(nocom));
  const sb={ window:{ VeroDiscourse:D, VeroParse:VP, VeroOntology:O }, module:{ exports:{} } }; const before=new Set(Object.keys(sb.window));
  vm.runInNewContext(CTX_SRC,sb); const added=Object.keys(sb.window).filter(k=>!before.has(k));
  chk('CX.P5 the module writes exactly one global: VeroContext', JSON.stringify(added)==='["VeroContext"]', JSON.stringify(added));
  chk('CX.P6 TTL is 15 minutes and equals VeroDiscourse.TTL_MS', VC.TTL_MS===15*60*1000 && VC.TTL_MS===D.TTL_MS);
  chk('CX.P7 the storage forbidden-key list is a superset of the discourse C6 FORBIDDEN_KEYS ('+FORBID_DISC.size+' keys)', FORBID_DISC.size>=20 && [...FORBID_DISC].every(k=>FORBID_CTX.has(k)), [...FORBID_DISC].filter(k=>!FORBID_CTX.has(k)));
  const s1=last(chain(['charger'])).state; const fr=deepFreeze(TF('white')), st=deepFreeze(JSON.parse(JSON.stringify(s1)));
  let threw=null; try{ VC.step(st,fr,base({ now:clock+1000 })); }catch(e){ threw=e.message; }
  chk('CX.P8 step never mutates its inputs (deep-frozen turn frame and stored state)', threw===null, threw);
  const a=VC.step(st,fr,base({ now:clock+1000 })), b=VC.step(st,fr,base({ now:clock+1000 }));
  chk('CX.P9 deterministic: identical inputs give byte-identical outcome and state', JSON.stringify(a)===JSON.stringify(b)); }

/* ================= CX.S stored state ================= */
{ const c=chain(['charger','white']); const s=last(c).state, J=JSON.stringify(s);
  chk('CX.S1 save / read: a valid ContextState validates and round-trips through serialize / deserialize unchanged', VC.validate(s).ok && JSON.stringify(VC.deserialize(VC.serialize(s)).state)===J, JSON.stringify(VC.validate(s).problems));
  chk('CX.S2 stored state: v2 SessionContext + meta (dataVersion, catalogueSig, resultState, family, anchorKind, shownFam aligned with shown)',
    s.v==='c2' && s.ctx.v===2 && s.meta.catalogueSig && s.meta.dataVersion===DV && s.meta.resultState==='ok' && s.meta.shownFam.length===s.ctx.shown.length);
  const keys=keysDeep(s).map(k=>k.toLowerCase()), bad=keys.filter(k=>FORBID_CTX.has(k));
  const names=new Set(PUB.map(p=>String(p.product_name||'').toLowerCase()).filter(x=>x.length>8));
  const strs=[]; (function walk(x){ if(typeof x==='string') strs.push(x.toLowerCase()); else if(x&&typeof x==='object') Object.values(x).forEach(walk); })(s);
  chk('CX.S3 the stored state holds no price / dealer / stock / text / name / evidence key and no product name string', !bad.length && !strs.some(x=>names.has(x)), JSON.stringify(bad));
  const u=last(chain(['charger','zqxjv white'])).state;
  chk('CX.S4 unresolved[].text is never stored (design §12-A): only the kind survives', u && u.ctx.unresolved.length>0 && u.ctx.unresolved.every(x=>!('text' in x) && x.kind==='unresolved'), JSON.stringify(u&&u.ctx.unresolved));
  const bads=[['garbage json',null,'{oops'],['wrong version',x=>{ x.v='c1'; }],['shown not array',x=>{ x.ctx.shown='a'; }],['shownFam misaligned',x=>{ x.meta.shownFam=[]; }],['injected srp',x=>{ x.ctx.frame.srp=1; }],
    ['ctx.at not a number',x=>{ x.ctx.at='now'; }],['unknown resultState',x=>{ x.meta.resultState='great'; }],['ctx missing',x=>{ delete x.ctx; }]];
  const missed=bads.filter(([n,f,raw])=>{ let st;
    if(raw!==undefined){ const d=VC.deserialize(raw); if(d.state!==null) return true; st={ v:'c2' }; } else { st=JSON.parse(J); f(st); if(VC.validate(st).ok) return true; }
    const r=VC.step(st,TF('yung pangalawa'),base({ now:clock+1000 }));
    return !(r.outcome.ctxStatus==='malformed' && r.outcome.act==='CLARIFY' && r.outcome.reason==='needs-context'); }).map(x=>x[0]);
  chk('CX.S5 malformed stored state fails closed (8 variants): never used, a reference turn clarifies needs-context', !missed.length, missed);
  chk('CX.S6 clear() resets: no context afterwards (a reference turn clarifies)', VC.clear()===null && VC.step(VC.clear(),TF('yung pangalawa'),base({ now:clock+2000 })).outcome.reason==='needs-context'); }

/* ================= CX.T TTL / mode ================= */
{ const s=last(chain(['power bank'])).state, at=s.ctx.at, shown=s.ctx.shown;
  const ok=VC.step(s,TF('yung pangalawa'),base({ now:at+VC.TTL_MS }));
  chk('CX.T1 exactly at the TTL the context is still used (ordinal 2 = shown[1])', ok.outcome.act==='SELECT' && ok.outcome.codes[0]===shown[1] && ok.outcome.ctxStatus==='fresh', JSON.stringify([ok.outcome.act,ok.outcome.ctxStatus]));
  const ex=VC.step(s,TF('yung pangalawa'),base({ now:at+VC.TTL_MS+1 }));
  chk('CX.T2 TTL + 1 ms: the context is expired, never reused (ordinal clarifies needs-context; note ctx.expired)', ex.outcome.ctxStatus==='expired' && ex.outcome.act==='CLARIFY' && ex.outcome.reason==='needs-context' && ex.outcome.notes.some(n=>n.code==='ctx.expired'));
  const fu=VC.step(s,TF('yung pangalawa'),base({ now:at-1 }));
  chk('CX.T3 a context stamped in the future is ignored', fu.outcome.ctxStatus==='malformed' && fu.outcome.act==='CLARIFY');
  const dm=VC.step(s,TF('yung pangalawa'),base({ now:at+1000, mode:'dealer' }));
  const back=VC.step(dm.state,TF('yung pangalawa'),base({ now:at+2000, mode:'public' }));
  const mixed=[dm,back].some(r=>r.outcome.codes.some(c=>shown.indexOf(c)>=0));
  chk('CX.T4 mode isolation: a public context is never used in dealer mode, and returning to public never revives it', dm.outcome.ctxStatus==='modeChanged' && dm.outcome.act==='CLARIFY' && back.outcome.ctxStatus==='modeChanged' && !mixed, JSON.stringify([dm.outcome.ctxStatus,back.outcome.ctxStatus]));
  const n1=VC.step(s,TF('white'),Object.assign(base(),{ now:undefined })), n2=VC.step(s,TF('white'),Object.assign(base(),{ mode:undefined }));
  chk('CX.T5 missing clock or mode fails closed (ERROR, nothing stored)', n1.outcome.act==='ERROR' && n1.state===null && n2.outcome.act==='ERROR' && n2.state===null); }

/* ================= CX.D catalogue identity / stale data ================= */
{ const s=last(chain(['charger'])).state;
  const same=VC.step(s,TF('white'),base({ now:clock+1000 }));
  chk('CX.D1 catalogue signature match: context fresh, no data.changed note', same.outcome.ctxStatus==='fresh' && !same.outcome.notes.some(n=>n.code==='data.changed'));
  const dv=VC.step(s,TF('white'),base({ now:clock+1000, dataVersion:DV+'-next' }));
  chk('CX.D2 dataVersion change: the act is kept (REFINE, not SWITCH), the merged frame is re-executed, note data.changed', dv.outcome.ctxStatus==='dataChanged' && dv.outcome.act==='REFINE' && dv.outcome.notes.some(n=>n.code==='data.changed') && dv.outcome.notes.some(n=>n.code==='reexecuted'));
  const victim=s.ctx.shown[1];
  const C2=catalogueWith(all=>{ all.find(p=>String(p.item_code)===victim).disabled=true; });
  const re=VC.step(s,TF('white'),base({ now:clock+1000, facts:C2.facts, products:C2.products, allProducts:C2.allProducts }));
  chk('CX.D3 catalogue change: re-execution against the current catalogue; the disabled product is never kept from the stale set', re.outcome.ctxStatus==='dataChanged' && re.outcome.codes.indexOf(victim)<0 && re.outcome.codes.length>0);
  const sel=VC.step(s,TF('yung pangalawa'),base({ now:clock+1000, facts:C2.facts, products:C2.products, allProducts:C2.allProducts }));
  chk('CX.D4 a removed ordinal target clarifies "no longer listed" with the remaining shown items as options (never shifts the ordinal)',
    sel.outcome.act==='CLARIFY' && sel.outcome.reason==='target-no-longer-listed' && sel.outcome.options && sel.outcome.options.every(o=>o.value!==victim) && sel.outcome.options.length===s.ctx.shown.length-1
    && sel.outcome.notes.some(n=>n.code==='target.unavailable' && n.states[0]==='disabled') && JSON.stringify(sel.state.ctx.shown)===JSON.stringify(s.ctx.shown), JSON.stringify(sel.outcome.notes));
  const other=s.ctx.shown[5]; const C3=catalogueWith(all=>{ all.find(p=>String(p.item_code)===other).disabled=true; });
  const keepOrd=VC.step(s,TF('yung pangalawa'),base({ now:clock+1000, facts:C3.facts, products:C3.products, allProducts:C3.allProducts }));
  chk('CX.D5 an ordinal still resolvable after an unrelated catalogue change survives (same product, not shifted)', keepOrd.outcome.act==='SELECT' && keepOrd.outcome.codes[0]===s.ctx.shown[1]);
  const C4=catalogueWith(all=>{ all.splice(all.findIndex(p=>String(p.item_code)===victim),1); });
  const rm=VC.step(s,TF('yung pangalawa'),base({ now:clock+1000, facts:C4.facts, products:C4.products, allProducts:C4.allProducts }));
  chk('CX.D6 a product deleted from the catalogue is reported "removed" and clarified', rm.outcome.reason==='target-no-longer-listed' && rm.outcome.notes.some(n=>n.code==='target.unavailable' && n.states[0]==='removed'));
  const rc=JSON.parse(JSON.stringify(s)); rc.meta.shownFam[0]='power_bank';
  const rcl=VC.step(rc,TF('white'),base({ now:clock+1000 }));
  chk('CX.D7 a reclassified shown item is noted (data.reclassified) and the REFINE stays in the context family', rcl.outcome.notes.some(n=>n.code==='data.reclassified') && rcl.outcome.act==='REFINE' && rcl.state.ctx.frame.subject.family==='charger'); }

/* ================= CX.L live prices ================= */
{ const c=chain(['power bank','mas mura']); const s1=c[0].state, first=c[1].outcome.codes[0];
  const C2=catalogueWith(all=>{ all.find(p=>String(p.item_code)===first).srp='99999'; });
  const r=VC.step(s1,TF('mas mura'),base({ now:clock+1000, facts:C2.facts, products:C2.products, allProducts:C2.allProducts }));
  chk('CX.L1 a price change between turns re-orders "mas mura" from LIVE prices (the formerly cheapest item is no longer first)', c[1].outcome.act==='COMPARE_METRIC' && r.outcome.act==='COMPARE_METRIC' && r.outcome.codes[0]!==first && r.outcome.codes.indexOf(first)>0, JSON.stringify([first,r.outcome.codes.slice(0,3)]));
  chk('CX.L2 no price is cached in the context: the stored state is identical whatever the catalogue prices are (no srp / dp key or value)',
    !keysDeep(s1).some(k=>/^(srp|dp|dp_volume|moq)$/i.test(k)) && JSON.stringify(c[1].state.ctx.frame)===JSON.stringify(VC.step(s1,TF('mas mura'),base({ now:c[1].state.ctx.at })).state.ctx.frame));
  const pb=last(chain(['power bank'])).state; const mx=pb.ctx.shown.reduce((b,c,i)=>(+G(c).srp>+G(pb.ctx.shown[b]).srp?i:b),0);
  const ordF=Object.assign(TF('yung pangalawa'),{ ref:{ kind:'ordinal', n:mx+1 } });
  const st=VC.step(pb,ordF,base({ now:clock+500 })).state, focus=st.ctx.focus[0], fp=+PUB.find(p=>String(p.item_code)===focus).srp;
  const alt={ intent:'ALTERNATIVE', subject:null, constraints:[], fields:[], flags:{ needsContext:true }, relax:[], ref:null, metric:{ metric:'price', dir:'asc' }, rank:null, sameBut:false, ledger:[] };
  const a=VC.step(st,alt,base({ now:clock+1000 }));
  chk('CX.L3 ALTERNATIVE "cheaper" keeps only items cheaper than the focus at LIVE prices, never the focus itself', a.outcome.act==='ALTERNATIVE' && a.outcome.codes.length>0 && a.outcome.codes.every(c=>c!==focus && +G(c).srp<fp), JSON.stringify([fp,a.outcome.codes.slice(0,3).map(c=>G(c).srp)]));
  const C5=catalogueWith(all=>{ all.find(p=>String(p.item_code)===focus).srp=String(fp*3); });
  const a2=VC.step(st,alt,base({ now:clock+1000, facts:C5.facts, products:C5.products, allProducts:C5.allProducts }));
  chk('CX.L4 cheaper-than-focus reads the focus price live (a price rise of the focus admits more alternatives)', a2.outcome.codes.length>a.outcome.codes.length); }

/* ================= CX.R refine semantics ================= */
{ const c=chain(['cable','white']); const s0=c[0].state, r=c[1].outcome;
  const beyond=r.codes.filter(x=>s0.ctx.candidates.indexOf(x)<0);
  chk('CX.R1 REFINE re-executes over the FULL catalogue: it finds items beyond the stored candidates (truncated at 50) and the displayed top-12',
    s0.ctx.candidates.length===50 && s0.ctx.shown.length===12 && beyond.length>0 && r.act==='REFINE', JSON.stringify([s0.ctx.candidates.length,beyond.length]));
  chk('CX.R2 the full semantic result set is separate from the displayed top-N (codes > shown; shown = top 12 of codes)', r.codes.length>r.shown.length && r.shown.length===12 && JSON.stringify(r.codes.slice(0,12))===JSON.stringify(r.shown));
  const n5=VC.step(s0,TF('white'),base({ now:clock+1000, shownN:5 }));
  chk('CX.R3 the displayed size is a parameter (shownN 5): the stored shown has 5, the semantic set is unchanged', n5.outcome.shown.length===5 && n5.state.ctx.shown.length===5 && n5.outcome.codes.length===r.codes.length); }

/* ================= CX.O ordinals / references ================= */
{ const c=chain(['power bank','yung pangalawa']); const s0=c[0].state;
  chk('CX.O1 ordinal n selects shown[n-1] exactly (never off by one) and becomes the focus', c[1].outcome.act==='SELECT' && c[1].outcome.codes[0]===s0.ctx.shown[1] && c[1].state.ctx.focus[0]===s0.ctx.shown[1]);
  const big={ intent:'FIND', subject:null, constraints:[], fields:[], flags:{ needsContext:true, refPronoun:true }, relax:[], ref:{ kind:'ordinal', n:13 }, metric:null, rank:null, sameBut:false, ledger:[] };
  const oor=VC.step(s0,big,base({ now:clock+1000 }));
  chk('CX.O2 an out-of-range ordinal clarifies with the shown items as options', oor.outcome.act==='CLARIFY' && oor.outcome.reason==='ordinal-out-of-range' && oor.outcome.options.length===12);
  const gone=s0.ctx.shown[3]; const Cg=catalogueWith(all=>{ all.find(p=>String(p.item_code)===gone).disabled=true; });
  const oor2=VC.step(s0,big,base({ now:clock+1000, facts:Cg.facts, products:Cg.products, allProducts:Cg.allProducts }));
  chk('CX.O2b clarification options never offer a product that is no longer listed (outcome and stored pending clarification)', oor2.outcome.options.length===11 && oor2.outcome.options.every(o=>o.value!==gone) && oor2.state.ctx.pendingClarification.options.indexOf(gone)<0);
  const oth=VC.step(s0,TF('the other one'),base({ now:clock+1000 }));
  chk('CX.O3 an ambiguous reference ("the other one" over 12 shown) fails closed: CLARIFY with an explicit noOptions reason', oth.outcome.act==='CLARIFY' && oth.outcome.noOptions && oth.outcome.codes.length===0);
  const att=VC.step(c[1].state,TF('ano price nito'),base({ now:clock+1000 }));
  chk('CX.O4 an attribute of the focus answers on the focus code only (target act; evidence computed live)', att.outcome.act==='ATTRIBUTE_OF_FOCUS' && JSON.stringify(att.outcome.codes)===JSON.stringify([s0.ctx.shown[1]])); }

/* ================= CX.K same / keep ================= */
{ const famW=['charger','power_bank'].find(f=>famCodes(f).length>5);
  const c=chain([famW==='charger'?'65w charger':'power bank','yung una','same wattage']);
  const focus=c[1].state.ctx.focus[0], w=G(focus).watts, k=c[2].outcome;
  chk('CX.K1 keep "same wattage" with a single focus applies the focus wattage (from the current catalogue) and excludes the focus itself',
    k.notes.some(n=>n.code==='keep.applied') && k.codes.indexOf(focus)<0 && (k.exactCodes||(k.kind==='exact'?k.codes:[])).every(x=>G(x).watts===w) && JSON.stringify(c[2].state.ctx.frame.constraints).indexOf('"num:watts"')>=0, JSON.stringify([w,k.act,k.kind]));
  const nf=chain(['power bank','same wattage']);
  chk('CX.K2 keep without a single focus clarifies "keep-needs-focus" with the shown items as options (no dead end)', last(nf).outcome.act==='CLARIFY' && last(nf).outcome.reason==='keep-needs-focus' && last(nf).outcome.options.length>0);
  const famNo=['hdmi_cable','video_cable','audio_cable','bag'].find(f=>famCodes(f).length>2 && VC.applicability(base()).applies3('num:watts',f)!=='YES');
  const q0=famNo?famNo.replace(/_/g,' '):null;
  const na=famNo?chain([q0,'yung una','same wattage']):null;
  chk('CX.K3 keep on a slot not listed for the family ('+famNo+') answers NOT_LISTED (never a dead-end clarification), the context is kept', na && last(na).outcome.act==='NOT_LISTED' && last(na).state && last(na).state.ctx.focus.length===1, na&&JSON.stringify([last(na).outcome.act,last(na).outcome.reason]));
  const kp=Object.assign(TF('same wattage'),{ keep:[{ slot:'price', span:'s0' }] });
  const pr=VC.step(c[1].state,kp,base({ now:clock+1000 }));
  chk('CX.K4 a keep on price is refused (a catalogue price never becomes a constraint or enters the context)', pr.outcome.act==='NOT_LISTED' && pr.outcome.notes.some(n=>n.code==='keep.price.refused') && JSON.stringify(pr.state).indexOf('"price"')<0);
  /* a model line with several colours, one of them white (data-derived) */
  const byModel={}; PUB.forEach(p=>{ const m=String(p.model||'').trim(); if(/^[A-Z]{1,3}\d{2,4}[A-Z]?$/i.test(m)) (byModel[m]=byModel[m]||[]).push(p); });
  const line=Object.keys(byModel).find(m=>{ const ps=byModel[m]; return ps.length>=2 && ps.some(p=>/white/i.test(p.color||'')) && ps.some(p=>!/white/i.test(p.color||'')); });
  const sm=line?chain([line,'same but white']):null;
  const anc=sm&&sm[0].state&&sm[0].state.ctx.frame.subject&&sm[0].state.ctx.frame.subject.anchors;
  chk('CX.K5 "same but white" after a model search retains the model anchor (flags.same, design §12-D) and stays inside that model line ('+line+')',
    sm && anc && anc.length && last(sm).outcome.notes.some(n=>n.code==='same.anchorRetained') && last(sm).outcome.codes.every(x=>anc[0].codes.indexOf(x)>=0), sm&&JSON.stringify([last(sm).outcome.act,last(sm).outcome.notes.map(n=>n.code)]));
  const ns=chain(['same but white']);
  chk('CX.K6 flags.same with no context fails closed (CLARIFY needs-context, explicit noOptions)', last(ns).outcome.act==='CLARIFY' && last(ns).outcome.noOptions); }

/* ================= CX.E evidence ================= */
{ const c=chain(['usb 3.2 gen 1 hub','white']); const o1=c[0].outcome, o2=c[1].outcome;
  const ex=VP.executeFrame(c[0].state.ctx.frame,POPTS);
  chk('CX.E1 outcome evidence is exactly the executor\'s live evidence (no layer rewrites a state)', o1.codes.every(x=>JSON.stringify(o1.evidence[x])===JSON.stringify(ex.evidence[x])), JSON.stringify(o1.codes.slice(0,2).map(x=>[o1.evidence[x],ex.evidence[x]])));
  const inf=o1.codes.filter(x=>Object.values(o1.evidence[x]||{}).indexOf('INFERRED')>=0);
  const kept=inf.filter(x=>o2.codes.indexOf(x)>=0);
  chk('CX.E2 context reuse never promotes evidence: an INFERRED row stays INFERRED on the next turn (never CONFIRMED) and is never "exact"',
    inf.length>0 && kept.every(x=>Object.values(o2.evidence[x]).indexOf('INFERRED')>=0) && (o1.exactCodes||[]).every(x=>inf.indexOf(x)<0), JSON.stringify([inf.length,kept.length]));
  const allEv=[].concat(...[o1,o2].map(o=>Object.keys(o.evidence).map(x=>Object.entries(o.evidence[x]).map(([slot,st])=>[x,slot,st]))));
  const mismatch=[].concat(...allEv).filter(([x,slot,st])=>{ const cons=(slot.indexOf('version:')===0)?{ kind:'ifaceVersion', iface:slot.split(':')[1], gen:c[1].state.ctx.frame.constraints.find(k=>k.slot===slot).value.generation }:null; return cons && VP.evalConstraint(x,cons,POPTS)!==st; });
  chk('CX.E3 missing evidence is never turned into a contradiction: every reported state equals a fresh evaluation on the current catalogue', !mismatch.length, JSON.stringify(mismatch.slice(0,3)));
  chk('CX.E4 evidence is never stored in the context (no evidence key, no state names in the stored state)', !keysDeep(c[1].state).includes('evidence') && !/CONFIRMED|INFERRED|CONTRADICTED/.test(JSON.stringify(c[1].state))); }

/* ================= CX.A applicability ================= */
{ const A=VC.applicability(base());
  chk('CX.A1 tri-valued applicability: lanes outside PCIe = NO (structural); name / price / form = YES; a facts gap (power-bank ports) is UNKNOWN, never NO',
    A.applies3('lanes:usb','hub_dock')==='NO' && A.applies3('name:x','charger')==='YES' && A.applies3('price','bag')==='YES' && A.applies3('form','charger')==='YES' && A.applies3('ports:charging_output','power_bank')!=='NO' && A.applies3('num:watts','charger')==='YES',
    JSON.stringify([A.applies3('ports:charging_output','power_bank'),A.applies3('num:watts','charger')]));
  chk('CX.A2 the discourse boolean is "not NO" (UNKNOWN stays in the context: no false SWITCH from a data gap)', ['num:watts','connector:hdmi','lanes:usb','feature:builtin','ports'].every(s=>A.families.every(f=>A.applies(s,f)===(A.applies3(s,f)!=='NO'))));
  const slots=new Set(); ['65w charger','power bank 20000mah','hdmi cable 2m','usb-c hub with 3 usb-a ports','pcie x4 card','4k hdmi cable','white charger','charger with built-in cable','usb 3.2 gen 2 hub','dp to hdmi adapter','cable under 500','gen 4','not hdmi 2.1','144hz cable','ugreen cable','charger na walang usb-a','2.5 inch enclosure','pcie gen 4 card'].forEach(q=>TF(q).constraints.forEach(c=>slots.add(c.slot)));
  const unmapped=[...slots].filter(s=>{ const k=s.split(':')[0]; return !(s in VC.SLOT_EVIDENCE) && !(k in VC.SLOT_EVIDENCE); });
  chk('CX.A3 mapping completeness: every slot kind the turnFrame emits has an evidence mapping ('+slots.size+' slots)', !unmapped.length, unmapped);
  chk('CX.A4 qualify single source: ports -> PORT_ROLE_BY_FAMILY (vero-parse.js), lanes -> pcie, others null', A.qualify('ports','charger')===VP.PORT_ROLE_BY_FAMILY.charger && A.qualify('ports','hub_dock')===VP.PORT_ROLE_BY_FAMILY.hub_dock && A.qualify('lanes','x')==='pcie' && A.qualify('colour','charger')===null);
  /* stability: one synthetic contrary product per family never flips a family-level decision */
  const SL=['num:watts','num:mah','num:lengthM','num:gbps','ports','connector:hdmi','connector:usb_c','res','colour'];
  const flips=[]; A.families.slice(0,12).forEach(f=>{ const src=PUB.find(p=>G(String(p.item_code))&&G(String(p.item_code)).family===f); if(!src) return;
    const syn=Object.assign(JSON.parse(JSON.stringify(src)),{ item_code:'SYN'+f.length+'X', product_name:src.product_name+' Plain', features:'', description:'' });
    const pub2=PUB.concat([syn]), f2=VF.build(pub2), A2=VC.applicability({ facts:f2, products:pub2 });
    const gs=VP.graphFor(syn.item_code,{ facts:f2, products:pub2 }); if(!gs || gs.family!==f) return;
    SL.forEach(s=>{ const k=s.split(':')[0], spec=VC.SLOT_EVIDENCE[s]||VC.SLOT_EVIDENCE[k]; if(spec && spec.has && spec.has(gs,s.split(':')[1])) return;   /* not contrary for this slot */
      if(A.applies3(s,f)!==A2.applies3(s,f)) flips.push(f+'/'+s); }); });
  chk('CX.A5 stability: one synthetic contrary product per family flips no family-level applicability decision', !flips.length, flips);
  chk('CX.A6 families = the taxonomy families with at least one enabled product', A.families.length>5 && A.families.every(f=>famCodes(f).length>0)); }

/* ================= CX.M metric narrowing ================= */
{ const hub=chain(['hub','mas mabilis']);
  chk('CX.M1 hub + "mas mabilis": both speed-class metrics are listed for hubs -> CLARIFY with exactly gbps / watts', last(hub).outcome.act==='CLARIFY' && JSON.stringify(last(hub).outcome.options.map(o=>o.value).sort())==='["gbps","watts"]');
  const ch=chain(['charger','mas mabilis']);
  chk('CX.M2 charger + "mas mabilis": one surviving metric -> COMPARE_METRIC by watts (note metric.narrowed)', last(ch).outcome.act==='COMPARE_METRIC' && last(ch).state.ctx.frame.rank && last(ch).state.ctx.frame.rank.metric==='watts' && last(ch).outcome.notes.some(n=>n.code==='metric.narrowed'), JSON.stringify([last(ch).outcome.act,last(ch).outcome.reason]));
  const ok=chain(['charger','mas okay']);
  chk('CX.M3 a judgement word never picks a metric silently: CLARIFY with the narrowed chips (price always offered)', last(ok).outcome.act==='CLARIFY' && last(ok).outcome.options.some(o=>o.value==='price'));
  const A=VC.applicability(base()); const none=A.families.find(f=>famCodes(f).length>=3 && !VC.narrowMetrics(['gbps','watts'],[],f,base()).length);
  const nm=none?chain([{ frame:{ intent:'FIND', subject:{ family:none }, constraints:[], fields:[], flags:{}, relax:[], ref:null, metric:null, rank:null, sameBut:false, ledger:[] } },'mas mabilis']):null;
  chk('CX.M4 no speed metric listed for the family ('+none+'): NOT_LISTED (never "wala"), the context is kept', nm && last(nm).outcome.act==='NOT_LISTED' && last(nm).state && last(nm).state.ctx.frame.subject.family===none, nm&&JSON.stringify(last(nm).outcome.act));
  const pend=last(hub).state.ctx.pendingClarification;
  chk('CX.M5 the stored pending clarification holds the narrowed options (the answer binds to what was offered)', pend && JSON.stringify(pend.options.sort())==='["gbps","watts"]'); }

/* ================= CX.G guards ================= */
{ const own=chain(['charger','not a charger']);
  chk('CX.G1 own-family EXCLUDE ("not a charger" inside chargers) clarifies; it never executes family=false (no false "wala"), context kept', last(own).outcome.act==='CLARIFY' && last(own).outcome.reason==='exclude-own-family' && last(own).state.ctx.frame.subject.family==='charger' && last(own).outcome.codes.length===0);
  const fl=VC.step(null,{ intent:'FIND', subject:null, constraints:[{ kind:'colour', slot:'colour', value:'white', polarity:true, hard:true, source:{ span:'s0' } }], fields:[], flags:{}, relax:[], ref:null, metric:null, rank:null, sameBut:false, ledger:[] },base({ now:clock+1000 }));
  chk('CX.G2 no subject-less catalogue flood: a merged frame with no family clarifies the family (no codes)', fl.outcome.act==='CLARIFY' && fl.outcome.reason==='needs-family' && fl.outcome.codes.length===0);
  const usb=chain(['usb-c hub','gen 4']);
  chk('CX.G3 USB "Gen 4" is never canonicalised to USB4: version-unresolved CLARIFY, no usb generation "4" anywhere', last(usb).outcome.act==='CLARIFY' && last(usb).outcome.reason==='version-unresolved' && JSON.stringify(last(usb).state).indexOf('"generation":"4"')<0);
  const pc=chain(['pcie card','gen 4']);
  const pv=last(pc).state.ctx.frame.constraints.find(c=>c.kind==='version');
  chk('CX.G4 PCIe "Gen 4" canonicalises after binding to version:pcie = 4 (note version.canonical)', pv && pv.slot==='version:pcie' && pv.value.generation==='4' && last(pc).outcome.notes.some(n=>n.code==='version.canonical'));
  const sw=chain(['65w charger',{ frame:{ intent:'FIND', subject:{ family:'power_bank' }, constraints:[], fields:[], flags:{ followUp:true }, relax:[], ref:null, metric:null, rank:null, sameBut:false, ledger:[] } }]);
  const A=VC.applicability(base()); const carried=(last(sw).outcome.notes.find(n=>n.code==='carried')||{ slots:[] }).slots;
  const stored=last(sw).state.ctx.frame.constraints.map(c=>c.slot);
  chk('CX.G5 across a family SWITCH only YES slots carry, and a carried numeric equality is soft (note carry.soft)', last(sw).outcome.act==='SWITCH' && stored.every(s=>A.applies3(s,'power_bank')==='YES') && (!carried.includes('num:watts') || last(sw).outcome.notes.some(n=>n.code==='carry.soft')), JSON.stringify([carried,stored]));
  const CC=carryCase(); const cr=CC?chain(CC.turns):null;
  chk('CX.G5b a carried slot that is UNKNOWN for the new family ('+(CC&&CC.slot+' '+CC.from+' -> '+CC.to)+') is dropped, never carried as a filter (note carry.dropped.notApplicable)', cr && last(cr).outcome.act==='SWITCH' && !last(cr).state.ctx.frame.constraints.some(c=>c.slot===CC.slot) && last(cr).outcome.notes.some(n=>n.code==='carry.dropped.notApplicable'), cr&&JSON.stringify(last(cr).outcome.notes.map(n=>n.code)));
  const leak=chain(['65w charger','hdmi cable']);
  chk('CX.G6 no slot leak after a SWITCH: the new search holds none of the previous context\'s slots', last(leak).outcome.act==='SWITCH' && !last(leak).state.ctx.frame.constraints.some(c=>c.slot==='num:watts'));
  const emp=JSON.parse(JSON.stringify(last(chain(['power bank'])).state)); emp.meta.resultState='empty';
  const stock=VC.step(emp,TF('in stock ba?'),base({ now:clock+1000 })), ord=VC.step(emp,TF('yung pangalawa'),base({ now:clock+1000 }));
  chk('CX.G7 after an empty / failed prior search, stock and ordinal references clarify (never answered on an empty set)', stock.outcome.act==='CLARIFY' && stock.outcome.reason==='prior-result-empty' && ord.outcome.reason==='prior-result-empty');
  /* option contract + no prose over a broad chain corpus */
  const Q=['charger','hub','power bank','hdmi cable','cable','usb-c hub','pcie card','65w charger','usb 3.2 gen 1 hub'];
  const F=['white','yung pangalawa','mas mura','mas mabilis','mas okay','the other one','not a charger','gen 4','same wattage','same but white','in stock ba?','ano price nito','any color','yung isa pa','hdmi cable','not hdmi 2.1'];
  const outs=[]; Q.forEach(a=>F.forEach(b=>F.slice(0,6).forEach(c=>{ chain([a,b,c]).forEach(t=>outs.push(t.outcome)); })));
  const badOpt=outs.filter(o=>!optionShapeOk(o)), prose=outs.filter(o=>/\bwala\b|we don.t have|can.t find|"text"|"label"/i.test(JSON.stringify(o)));
  chk('CX.G8 option contract over '+outs.length+' chained turns: every CLARIFY carries options [{id,kind,labelKey,value}] xor an explicit noOptions reason', !badOpt.length, JSON.stringify(badOpt.slice(0,2).map(o=>[o.reason,o.options,o.noOptions])));
  chk('CX.G9 the context layer emits no prose: no "wala" / "we don\'t have" / text / label in any outcome (notes are codes)', !prose.length);
  const famLeak=outs.filter(o=>o.act==='SELECT' && o.codes.some(x=>!G(x)));
  chk('CX.G10 no outcome ever proposes a code that is not in the current published catalogue', !outs.some(o=>o.codes.some(x=>!G(x))) && !famLeak.length); }

/* ================= CX.MUT mutation kills ================= */
{ const mutant=(from,to)=>{ const pairs=Array.isArray(from)?from:[[from,to]]; let src=CTX_SRC;
    pairs.forEach(([a,b])=>{ if(src.split(a).length!==2) throw new Error('mutation anchor not unique: '+a.slice(0,60)); src=src.replace(a,()=>b); });
    const sb={ window:{ VeroDiscourse:D, VeroParse:VP, VeroOntology:O }, module:{ exports:{} } }; vm.runInNewContext(src,sb); return sb.window.VeroContext; };
  const run=(M,turns,o)=>{ let s=(o&&o.state)||null; const out=[]; turns.forEach(t=>{ const x=typeof t==='string'?{ q:t }:t; clock+=60000; const op=base(Object.assign({},(o&&o.opts)||{},x.opts||{},{ now:x.now!==undefined?x.now:clock })); const r=M.step(x.state!==undefined?x.state:s,x.frame||TF(x.q),op); s=r.state; out.push(r); }); return out; };
  const s0=last(chain(['power bank'])).state;
  const CARRY=carryCase();
  const C2=catalogueWith(all=>{ all.find(p=>String(p.item_code)===s0.ctx.shown[1]).disabled=true; });
  const alt={ intent:'ALTERNATIVE', subject:null, constraints:[], fields:[], flags:{ needsContext:true }, relax:[], ref:null, metric:{ metric:'price', dir:'asc' }, rank:null, sameBut:false, ledger:[] };
  const MUT=[
    ['context nulled', "var ctx=state?clone(state.ctx):null;", "var ctx=null;", M=>last(run(M,['power bank','yung pangalawa'])).outcome.act!=='SELECT'],
    ['TTL not enforced', "else if(age>ttl){", "else if(age>ttl*1000){", M=>last(run(M,[{ q:'yung pangalawa', state:s0, now:s0.ctx.at+VC.TTL_MS+1 }])).outcome.ctxStatus!=='expired'],
    ['mode not isolated', "else if(state.ctx.mode!==opts.mode){", "else if(false){", M=>last(run(M,[{ q:'yung pangalawa', state:s0, now:s0.ctx.at+1000, opts:{ mode:'dealer' } }])).outcome.ctxStatus!=='modeChanged'],
    ['stale catalogue not detected', "if(!sameIdentity(state.meta,id)){", "if(false){", M=>!last(run(M,[{ q:'white', state:s0, now:s0.ctx.at+1000, opts:{ dataVersion:'other' } }])).outcome.notes.some(n=>n.code==='data.changed')],
    ['removed ordinal not clarified', "      if(gone.length){\n", "      if(false){\n", M=>last(run(M,[{ q:'yung pangalawa', state:s0, now:s0.ctx.at+1000, opts:{ facts:C2.facts, products:C2.products, allProducts:C2.allProducts } }])).outcome.act==='SELECT'],
    ['applies always true', "applies:function(slot,fam){ return tri(slot,fam)!=='NO'; }", "applies:function(slot,fam){ return true; }", M=>M.applicability(base()).applies('lanes:usb','hub_dock')===true],
    ['applies always false', "applies:function(slot,fam){ return tri(slot,fam)!=='NO'; }", "applies:function(slot,fam){ return false; }", M=>last(run(M,['charger','white'])).outcome.act!=='REFINE'],
    ['unknown treated as NO', "      memo[key]=r; return r; }", "      memo[key]=r==='UNKNOWN'?'NO':r; return memo[key]; }", M=>M.applicability(base()).applies3('ports:charging_output','power_bank')==='NO'],
    ['own-family guard removed', "      if(own.length && fam){", "      if(false){", M=>last(run(M,['charger','not a charger'])).outcome.reason!=='exclude-own-family'],
    ['version not canonicalised', "        if(cv===null){ badV=", "        if(false){ badV=", M=>last(run(M,['usb-c hub','gen 4'])).outcome.reason!=='version-unresolved'],
    ['gen stripped before canonVersion (USB4 hazard)', "var cv=O.canonVersion(c.value.interface,c.value.generation);", "var cv=O.canonVersion(c.value.interface,String(c.value.generation).replace(/^gen/,''));", M=>last(run(M,['usb-c hub','gen 4'])).outcome.reason!=='version-unresolved'],
    ['cheaper-than-focus removed', "codes=codes.filter(function(c){ var p=W.G[c]&&W.G[c].srp;", "codes=codes.filter(function(c){ return true; var p=W.G[c]&&W.G[c].srp;", M=>{ const st=last(run(M,['power bank','yung pangalawa'])).state; const f=st.ctx.focus[0], fp=+G(f).srp; return last(run(M,[{ frame:alt, state:st }])).outcome.codes.some(c=>+G(c).srp>=fp); }],
    ['carry not limited to YES', "var drop=carried.filter(function(s){ return A.applies3(s,fam)!=='YES'; });", "var drop=[];", M=>{ const r=last(run(M,CARRY.turns)); return r.state.ctx.frame.constraints.some(c=>c.slot===CARRY.slot); }],
    ['unresolved text stored (both layers: the unresolved map and the deep strip of text)', [["if(s.ctx){ s.ctx.unresolved=", "if(false){ s.ctx.unresolved="],["answer:1, text:1, html:1,", "answer:1, html:1,"]], null, M=>{ const u=last(run(M,['charger','zqxjv white'])).state; return u.ctx.unresolved.some(x=>'text' in x); }],
    ['forbidden keys not stripped', "if(FORBIDDEN[k.toLowerCase()]){ removed.push(", "if(false){ removed.push(", M=>{ const st=JSON.parse(JSON.stringify(s0)); st.ctx.frame.srp=5; return M.validate(st).ok; }],
    ['metric narrowing removed', "    return uniq(pool).filter(function(m){\n      if(m==='price') return true;", "    return uniq(pool).filter(function(m){\n      return true;", M=>last(run(M,['charger','mas mabilis'])).outcome.act!=='COMPARE_METRIC'],
    ['judgement picks silently', "if(surv.length===1 && !judgement &&", "if(surv.length===1 &&", M=>{ const r=last(run(M,[{ q:'bag' },'mas okay'])); return r.outcome.act!=='CLARIFY' && r.outcome.act!=='NOT_LISTED'; }],
    ['keep focus not excluded', "if(keep.length && ctx && ctx.focus.length===1) codes=codes.filter(function(c){ return c!==ctx.focus[0]; });", "", M=>{ const r=run(M,['65w charger','yung una','same wattage']); return last(r).outcome.codes.indexOf(r[1].state.ctx.focus[0])>=0; }],
    ['injected "Wala" prose', "notes.push({ code:'exclude.ownFamily', family:fam });", "notes.push({ code:'exclude.ownFamily', family:fam, text:'Wala tayong '+fam });", M=>/wala/i.test(JSON.stringify(last(run(M,['charger','not a charger'])).outcome))],
    ['prior-empty guard removed', "if(state && state.meta.resultState!=='ok'){", "if(false){", M=>{ const e=JSON.parse(JSON.stringify(s0)); e.meta.resultState='empty'; return last(run(M,[{ q:'yung pangalawa', state:e, now:s0.ctx.at+1000 }])).outcome.reason!=='prior-result-empty'; }],
    ['executor flood guard removed', "      if(ex.kind==='clarify'){", "      if(false){", M=>{ const r=run(M,[{ frame:{ intent:'FIND', subject:null, constraints:[{ kind:'feature', slot:'feature:dp_alt', value:true, polarity:true, hard:true, source:{ span:'s0' } }], fields:[], flags:{}, relax:[], ref:null, metric:null, rank:null, sameBut:false, ledger:[] } }]); return last(r).outcome.reason!=='needs-family'; }],
    ['subject-less multi-family guard removed', "        if(famsHit.length>1){", "        if(false){", M=>{ const r=run(M,[{ frame:{ intent:'FIND', subject:null, constraints:[{ kind:'colour', slot:'colour', value:'white', polarity:true, hard:true, source:{ span:'s0' } }], fields:[], flags:{}, relax:[], ref:null, metric:null, rank:null, sameBut:false, ledger:[] } }]); return last(r).outcome.reason!=='needs-family'; }] ];
  const survived=MUT.filter(([n,f,t,kill])=>{ try{ return !kill(mutant(f,t)); }catch(e){ return 'error '+e.message; } }).map(x=>x[0]);
  chk('CX.MUT mutation kills: every C2 rule is load-bearing ('+MUT.length+' mutants of vero-context.js, each detected)', !survived.length, survived); }

/* ================= performance (Node proxy) ================= */
{ const t=[]; for(let i=0;i<30;i++){ const a=Date.now(); chain(['charger','white','yung pangalawa']); t.push((Date.now()-a)/3); }
  t.sort((a,b)=>a-b); chk('CX.PERF a context step (parse + resolve + execute + store) median '+t[15].toFixed(1)+' ms per turn (budget 60 ms, Node, warm)', t[15]<=60); }

console.log(`\nVERO v2-2C C2 context tests: ${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
