/* VERO Local Brain v2-1 — SHADOW comparison: CURRENT (p2r3a, authoritative) vs V2 (accountable parse, shadow only).
   Run:  node tests/vero-v2-shadow.js [--json <out.json>] [--md <out.md>] [--verbose]
   Sets: tests/vero-sales-questions.json (144 benchmark) + tests/vero-v2-devsets.json (Held-Out #1/#2/#3).
   ALL FOUR ARE DEVELOPMENT / REGRESSION SETS (already used for tuning). Nothing here is an unbiased accuracy claim.
   Per question it records:
     CURRENT  route, intent, plan constraints, codes, answer type, header label (+ label audit against its own codes)
     V2       spans (type / senses / slot / state), unresolved spans, sense decisions, SemanticFrame, coverage, confidence,
              proposed route / kind / codes / label / notes / ladder
     DIFF     SAME_OK / SAME_FAIL / V2_BETTER / V2_WORSE on gold (route + code check); constraints v2 bound that the current
              plan has no slot for ("current silent drop"); misleading-label and false-"wala" checks for both sides.
   Follow-up turns (contextFrom / seq position > 1) are COVERAGE-ONLY in v2-1: discourse/delta is v2-2.
   V2-2B: S03 reads the gate SHADOW map (fail closed); RT1-RT6 ratchets and the EX1 EXCLUDE-integrity audit are gating.
   V2-2C C1: one authoritative follow-up taxonomy (T1-T3, plan §10.8 reworded), every gold check implemented and a null judge =
   UNSCORED (J1-J2), and a single-turn freeze of all standalone v2 proposals with a reviewed allow-list (F1-F2).
   Shadow purity: engine answers are captured BEFORE vero-ontology / vero-parse are loaded and compared AFTER the run.
   Exit 1 on: purity failure, any silent span drop, any V2_WORSE turn, any v2 label-integrity violation, any v2 false
   "wala", any v2 inventory-safety failure. */
const fs=require('fs'), path=require('path');
const ROOT=path.join(__dirname,'..');
const argv=process.argv.slice(2), arg=k=>{ const i=argv.indexOf(k); return i>=0?argv[i+1]:null; };
const VERBOSE=argv.includes('--verbose');
global.window={ PRICE_SETTINGS:{ indicatorDays:30 } };
eval(fs.readFileSync(path.join(ROOT,'js','helpers.js'),'utf8'));
['vero-lexicon','vero-nlu','vero-facts','vero-plan','vero-compose'].forEach(f=>require(path.join(ROOT,'js',f+'.js')));
const E=require(path.join(ROOT,'js','vero-engine.js'));
const RAW=fs.readFileSync(path.join(ROOT,'data','products.json'),'utf8');
const ALL=JSON.parse(RAW); pcResolveSchedule(ALL);
const PUB=ALL.filter(p=>!p.disabled), byCode={}; PUB.forEach(p=>byCode[String(p.item_code)]=p);
const BENCH=JSON.parse(fs.readFileSync(path.join(__dirname,'vero-sales-questions.json'),'utf8')).questions;
const DEV=JSON.parse(fs.readFileSync(path.join(__dirname,'vero-v2-devsets.json'),'utf8'));
let pass=0, fail=0; const chk=(n,c,x)=>{ if(c){ pass++; if(VERBOSE) console.log('PASS - '+n); } else { fail++; console.log('FAIL - '+n+(x?'  -> '+String(x).slice(0,600):'')); } };

/* ---------- unified item list ---------- */
/* V2-2C C1 — ONE authoritative follow-up taxonomy (design §15.1). Before C1 three definitions disagreed: positional (a turn after
   an earlier turn of the same sequence / a B144 contextFrom: 35), devsets contextTurns + B144 contextFrom (32) and the item flag
   followUp (19). Every turn now has exactly one class, derived from the data in that order of authority:
     STANDALONE         not a follow-up (no earlier turn in its sequence)
     TOPIC_SWITCH       a follow-up position flagged topicSwitch (leakage negative; wins over a contextTurns listing)
     CONTEXT            a follow-up listed in contextTurns (HO) or carrying contextFrom (B144)
     STANDALONE_IN_SEQ  a follow-up position that is neither (it does not use the earlier turn)
   CONTEXT turns whose gold route is WEB / AI are CONTEXT_COMPAT: context-anchored compatibility questions that legitimately use
   the existing WEB / AI route (plan §10.8 reworded: the LOCAL + 0-candidate criterion applies to the other CONTEXT turns only).
   followUp is descriptive only (a subset of CONTEXT + TOPIC_SWITCH). In C1 every follow-up stays COVERAGE-ONLY (scoring is C3). */
function classOf(pos,listed,topicSwitch,exp){ if(!pos) return 'STANDALONE'; if(topicSwitch) return 'TOPIC_SWITCH'; if(listed) return /^(WEB|AI)$/.test(exp)?'CONTEXT_COMPAT':'CONTEXT'; return 'STANDALONE_IN_SEQ'; }
const ITEMS=[];
BENCH.forEach(q=>ITEMS.push({ set:'B144', id:q.id, q:q.question, prev:q.contextFrom||null, follow:!!q.contextFrom, expRoute:q.expectedRoute, gold:q.expectedSKU||null, bench:q, inventory:/stock|inventory/i.test(JSON.stringify(q.expectedSafetyBehavior||[])),
  cls:classOf(!!q.contextFrom,!!q.contextFrom,false,q.expectedRoute), legacy:{ positional:!!q.contextFrom, contextTurn:!!q.contextFrom, followUpFlag:false } }));
Object.keys(DEV.sets).forEach(k=>{ const S=DEV.sets[k], seen={};
  S.items.forEach(it=>{ const corr=S.corrections[it.id]; const prevId=it.seq?seen[it.seq]:null, listed=(S.contextTurns||[]).includes(it.id);
    ITEMS.push({ set:k, id:it.id, q:it.q, prev:prevId||null, follow:!!prevId, expRoute:it.exp, expCodes:corr?corr.codes:it.expCodes, check:corr?corr.check:it.check, inventory:!!it.inventory, behavior:it.behavior,
      cls:classOf(!!prevId,listed,!!it.topicSwitch,it.exp), legacy:{ positional:!!prevId, contextTurn:listed, followUpFlag:!!it.followUp } });
    if(it.seq) seen[it.seq]=it.id; }); });

/* ---------- gold oracle (independent data clauses over products.json; never calls the system under test) ---------- */
const nameOf=p=>String(p.product_name||'');
const NUM={ wattsName:p=>E.productWatts(p),
  wattsAny:p=>{ const n=E.productWatts(p); if(n!=null) return n; let best=null; String(p.features||'').split(/\r?\n|[▪•;|]/).forEach(l=>{ if(!/(max|up to|support|charging|output|power|pd)/i.test(l)) return; (l.match(/(\d{2,3})\s?w\b/gi)||[]).forEach(x=>{ const v=parseInt(x,10); if(best==null||v>best) best=v; }); }); return best; },
  mahName:p=>{ const m=nameOf(p).replace(/,/g,'').match(/(\d{4,6})\s?mAh/i); return m?parseInt(m[1],10):null; }, lengthM:p=>E.lenMeters(p.length), srp:p=>Number(p.srp), dp:p=>Number(p.dp),
  /* V2-2C C3: port count / data rate read from the NAME only ("4-Port", "4C+1A", "USB-A+2*USB-C", "single-port"; "(10Gbps)") */
  portsName:p=>{ const s=nameOf(p); let m=s.match(/(\d+)\s*-?\s*ports?\b/i); if(m) return +m[1]; if(/single[- ]port/i.test(s)) return 1; m=s.match(/\b(\d+)C\s*\+?\s*(\d+)A\b/i); if(m) return +m[1]+ +m[2];
    let n=0; (s.match(/(?:\d+\s*\*\s*)?USB-?[AC]\b(?:\s*\*\s*\d+)?/gi)||[]).forEach(x=>{ const k=x.match(/(\d+)\s*\*|\*\s*(\d+)/); n+=k?+(k[1]||k[2]):1; }); return n||null; },
  gbpsName:p=>{ const m=nameOf(p).match(/(\d+(?:\.\d+)?)\s?Gbps/i); return m?parseFloat(m[1]):null; },
  gbpsAny:p=>{ const v=(String(p.product_name||'')+'\n'+String(p.features||'')).match(/(\d+(?:\.\d+)?)\s?Gbps/gi); return v?Math.max(...v.map(x=>parseFloat(x))):null; } };
/* V2-2C C3 (design §15): the TEST-OWNED USB naming equivalence (checked against VeroOntology.USB_NAMING by C3.U1, never read from it) */
const USB_EQ={ '5Gbps':{ names:['3.0','3.1g1','3.2g1'], re:/USB(?:-?[ABC])? ?3\.0(?![\d.])|USB(?:-?[ABC])? ?3\.[12] ?Gen ?1\b|\b5 ?Gbps\b/i },
  '10Gbps':{ names:['3.1g2','3.2g2'], re:/USB(?:-?[ABC])? ?3\.[12] ?Gen ?2\b(?!x2)|\b10 ?Gbps\b/i }, '20Gbps':{ names:['3.2g2x2'], re:/Gen ?2x2|\b20 ?Gbps\b/i } };
const OPS={'==':(a,b)=>a!=null&&Math.abs(a-b)<1e-9,'>=':(a,b)=>a!=null&&a>=b-1e-9,'<=':(a,b)=>a!=null&&a<=b+1e-9,'>':(a,b)=>a!=null&&a>b+1e-9,'<':(a,b)=>a!=null&&a<b-1e-9};
function clause(p,c){ if(c.any) return c.any.some(x=>clause(p,x)); if(c.field) return c.in.includes(String(p[c.field]||'')); if(c.nameRe) return new RegExp(c.nameRe,'i').test(nameOf(p));
  if(c.nameNotRe) return !new RegExp(c.nameNotRe,'i').test(nameOf(p)); if(c.textRe) return c.fields.some(f=>new RegExp(c.textRe,'i').test(String(p[f]||''))); if(c.num) return OPS[c.op](NUM[c.num](p),c.v);
  if(c.colorRe) return new RegExp(c.colorRe,'i').test(String(p.color||'')); if(c.colorNotRe) return !new RegExp(c.colorNotRe,'i').test(String(p.color||'')); if(c.usbClass) return USB_EQ[c.usbClass].re.test(nameOf(p));
  if(c.codeOrModel){ const k=String(c.codeOrModel).toLowerCase().replace(/\s+/g,''); return String(p.item_code).toLowerCase()===k||String(p.model||'').toLowerCase().replace(/\s+/g,'')===k; } throw new Error('clause'); }
function derive(d,pub){ let rows=(pub||PUB).filter(p=>d.where.every(c=>clause(p,c)));
  if(d.order) rows.sort((a,b)=>{ for(const [f,dir] of d.order){ const va=NUM[f]?NUM[f](a):a[f], vb=NUM[f]?NUM[f](b):b[f]; const x=va==null?-Infinity:va, y=vb==null?-Infinity:vb; if(x<y) return dir==='asc'?-1:1; if(x>y) return dir==='asc'?1:-1; } return 0; });
  if(d.pick){ const [mm,f]=d.pick.split(':'), val=p=>NUM[f]?NUM[f](p):Number(p[f]); const vs=rows.map(val).filter(v=>v!=null&&!isNaN(v)); if(!vs.length) return [];
    const best=mm==='min'?Math.min(...vs):Math.max(...vs); rows=rows.filter(p=>{ const v=val(p); return v!=null&&Math.abs(v-best)<1e-9; }); }
  return rows.map(p=>String(p.item_code)); }
/* V2-2C C3: in-memory catalogue edits for stale fixtures (clones only; nothing is written). The edited product is named by the
   PREVIOUS turn's data-derived gold (prevGold: 1-based, negative = from the end), so both sides edit the same product. */
const BASE_CAT={ all:ALL, pub:PUB, edited:null };
const EDIT_CACHE=new Map();   /* one clone per (edit, product): both sides and every run share it read-only */
function applyEdit(cat,ed,prevGold){ const code=ed.prevGold>0?prevGold[ed.prevGold-1]:prevGold[prevGold.length+ed.prevGold]; if(!code) throw new Error('edit target missing');
  const ck=cat===BASE_CAT?JSON.stringify(ed)+'@'+code:null; if(ck&&EDIT_CACHE.has(ck)) return EDIT_CACHE.get(ck); const res=applyEdit0(cat,ed,code); if(ck) EDIT_CACHE.set(ck,res); return res; }
function applyEdit0(cat,ed,code){
  let all=JSON.parse(JSON.stringify(cat.all)); const p=all.find(x=>String(x.item_code)===code);
  if(ed.op==='disable') p.disabled=true; else if(ed.op==='remove') all=all.filter(x=>x!==p); else if(ed.op==='reclassify'){ p.category=ed.category; p.sheet=ed.sheet; } else if(ed.op==='price') p.srp=ed.srp; else throw new Error('edit op');
  pcResolveSchedule(all); return { all, pub:all.filter(x=>!x.disabled), edited:code }; }
const goldWhere=(t,cat)=>t&&t.gold&&t.gold.where?derive(t.gold,cat.pub):[];
/* V2-2C C3 chains (DEV): one list for the 3 HO sets' sequences, the 7 B144 follow-ups and the authored dev chains */
if(DEV.schema!=='vero-v2-devsets/2') throw new Error('devsets schema '+DEV.schema+' (expected vero-v2-devsets/2)');
const CHAINS=[];
Object.keys(DEV.sets).forEach(k=>{ const S=DEV.sets[k], bySeq={}; S.items.forEach(it=>{ if(!it.seq) return; (bySeq[it.seq]=bySeq[it.seq]||[]).push(it); });
  Object.keys(bySeq).forEach(s=>CHAINS.push({ id:k+':'+s, set:k, kind:'HO', turns:bySeq[s].map(it=>{ const corr=S.corrections[it.id]; return { id:it.id, key:k+':'+it.id, q:it.q, cls:it.cls, exp:it.exp, topicSwitch:!!it.topicSwitch, ho:{ exp:corr?corr.codes:it.expCodes, check:corr?corr.check:it.check } }; }) })); });
BENCH.filter(q=>q.contextFrom).forEach(q=>{ const g=DEV.b144FollowUps[q.id]; const p=BENCH.find(x=>x.id===q.contextFrom);
  CHAINS.push({ id:'B144:'+q.id, set:'B144', kind:'B144', turns:[{ id:p.id, key:'B144:'+p.id, q:p.question, cls:'STANDALONE', exp:p.expectedRoute, noScore:true }, { id:q.id, key:'B144:'+q.id, q:q.question, cls:g&&g.cls, exp:q.expectedRoute, act:g&&g.act, gold:g&&g.gold, declared:!!g }] }); });
DEV.chains.forEach(c=>CHAINS.push({ id:'DEV:'+c.id, set:'DEV', kind:'DEV', src:c.src, contextTurns:c.contextTurns, turns:c.turns.map(t=>Object.assign({ key:'DEV:'+t.id },t)) }));

/* ---------- 1. CURRENT answers BEFORE v2 is loaded ---------- */
const routeOf=(a,r)=>a.route==='local'?((r.type==='clarify')?'CLARIFY':(a.canEscalate?'LOCAL+offer':'LOCAL')):a.route.toUpperCase();
function runCurrent(){ const CTX={}, out={};
  ITEMS.forEach(it=>{ const key=it.set+':'+it.id, conv=it.prev?CTX[it.set+':'+it.prev]:null;
    const r=E.answer(PUB,it.q,{ conv }), a=E.aiRoute(PUB,it.q,r,{}); CTX[key]=r.ctxOut||conv; out[key]={ r, a }; });
  return out; }
const sigOf=C=>JSON.stringify(Object.keys(C).map(k=>{ const {r,a}=C[k]; return [k,r.type,r.codes,r.note,r.echo||null,r.stockNote||null,a.route,a.candidates,a.canEscalate]; }));
const CUR=runCurrent(), BEFORE=sigOf(CUR), productsBefore=JSON.stringify(ALL);
/* V2-2C C3: the current engine over the authored dev chains (same catalogue edits as the v2 side), captured BEFORE v2 is loaded */
function runCurrentChains(){ const out={};
  CHAINS.filter(c=>c.kind==='DEV').forEach(c=>{ let conv=null, cat=BASE_CAT, prevGold=[];
    c.turns.forEach(t=>{ if(t.edit) cat=applyEdit(cat,t.edit,prevGold);
      const r=E.answer(cat.pub,t.q,{ conv }), a=E.aiRoute(cat.pub,t.q,r,{}); conv=r.ctxOut||conv; out[t.key]={ r, a, cat }; prevGold=goldWhere(t,cat); }); });
  return out; }
const sigCh=C=>JSON.stringify(Object.keys(C).map(k=>{ const {r,a}=C[k]; return [k,r.type,r.codes,r.note,r.echo||null,r.stockNote||null,a.route,a.candidates,a.canEscalate]; }));
const CURCH=runCurrentChains(), BEFORE_CH=sigCh(CURCH);

/* ---------- 2. V2 (shadow) ---------- */
const VF=window.VeroFacts; const O2=require(path.join(ROOT,'js','vero-ontology.js')); const VP=require(path.join(ROOT,'js','vero-parse.js'));
const t0=Date.now(); const FACTS=VF.build(PUB); const factsMs=Date.now()-t0;
const tC=process.hrtime.bigint(); VP.catalog(FACTS,PUB); const catalogMs=Number(process.hrtime.bigint()-tC)/1e6;
const V2={}, times=[], lastField={};
ITEMS.forEach(it=>{ const key=it.set+':'+it.id; const ctx=it.prev?{ lastField:lastField[it.set+':'+it.prev]||null }:null;
  const s=process.hrtime.bigint(); const P=VP.run(it.q,{ facts:FACTS, products:PUB, ctx }); times.push(Number(process.hrtime.bigint()-s)/1e6);
  V2[key]=P; lastField[key]=P.frame.field||null; });
const AFTER=sigOf(runCurrent());
chk('S01 shadow purity: current engine answers identical before/after v2 ('+ITEMS.length+' turns: type, codes, note, echo, stock note, route, candidates)', BEFORE===AFTER);
chk('S02 shadow purity: products.json objects not mutated', JSON.stringify(ALL)===productsBefore);
/* S03 (generalised, BA9): the dormant-module list is READ from the gate's single SHADOW map + ORDER (fail closed); same token
   semantics as gate G23 (exact basenames without .js + exact-case globals, escaped) over index.html + all 7 load-order files */
const GATE=fs.readFileSync(path.join(__dirname,'vero-asset-checks.py'),'utf8');
function gateMaps(src){
  const sh=src.split(/\r?\n/).filter(l=>/^\s*SHADOW\s*(=|\[|\.|\+)/.test(l)), or=src.split(/\r?\n/).filter(l=>/^\s*ORDER\s*(=|\[|\.|\+)/.test(l));
  if(sh.length!==1 || or.length!==1) throw new Error('SHADOW / ORDER definitions: '+sh.length+' / '+or.length);
  const sm=sh[0].match(/^SHADOW\s*=\s*\{([^{}]*)\}\s*(?:#.*)?$/), om=or[0].match(/^ORDER\s*=\s*\[([^\[\]]*)\]\s*(?:#.*)?$/); if(!sm||!om) throw new Error('not one-line literals');
  const shadow=[], order=[]; const r1=sm[1].replace(/'([^'\\]+)'\s*:\s*'([^'\\]+)'\s*(?:,|$)/g,(m,a,b)=>{ shadow.push([a,b]); return ''; }), r2=om[1].replace(/'([^'\\]+)'\s*(?:,|$)/g,(m,a)=>{ order.push(a); return ''; });
  if(r1.trim()||r2.trim()||!shadow.length) throw new Error('malformed entries');
  if(order.length!==7 || new Set(order).size!==7) throw new Error('ORDER must list 7 distinct runtime files');
  if(new Set(shadow.map(x=>x[0])).size!==shadow.length || new Set(shadow.map(x=>x[1])).size!==shadow.length) throw new Error('duplicate SHADOW entry');
  shadow.forEach(([a,b])=>{ if(!/^js\/[\w-]+\.js$/.test(a)||!/^[A-Z][A-Za-z0-9]+$/.test(b)||!fs.existsSync(path.join(ROOT,a))) throw new Error('bad SHADOW entry '+a); });
  order.forEach(a=>{ if(!fs.existsSync(path.join(ROOT,a))) throw new Error('ORDER file missing '+a); });
  [['js/vero-ontology.js','VeroOntology'],['js/vero-parse.js','VeroParse'],['js/vero-discourse.js','VeroDiscourse']].forEach(k=>{ if(!shadow.some(x=>x[0]===k[0]&&x[1]===k[1])) throw new Error('known v2 module missing '+k[0]); });
  return { shadow, order }; }
let GM=null; try{ GM=gateMaps(GATE); }catch(e){ GM={ err:e.message }; }
const G23T=GM.err?[]:[...new Set(GM.shadow.map(x=>path.basename(x[0]).slice(0,-3)).concat(GM.shadow.map(x=>x[1])))], G23R=new RegExp(G23T.map(t=>t.replace(/[.*+?^$\{}()|[\]\\]/g,'\\$&')).join('|')||'(?!)','g');
const s03hits=GM.err?['('+GM.err+')']:['index.html'].concat(GM.order).reduce((a,f)=>a.concat((fs.readFileSync(path.join(ROOT,f),'utf8').match(G23R)||[]).map(m=>f+':'+m)),[]);
chk('S03 shadow purity: gate SHADOW files/globals ('+G23T.join(', ')+') referenced by NO live file (index.html + '+(GM.order?GM.order.length:0)+' load-order scripts)', !GM.err && G23T.length>=6 && !s03hits.length, s03hits);
const GL=GATE.split(/\r?\n/), iS=GL.findIndex(l=>/^SHADOW\s*=/.test(l)), iO=GL.findIndex(l=>/^ORDER\s*=/.test(l)), mut=(i,fn)=>GL.map((l,k)=>k===i?fn(l):l).join('\n');
const S03MAL=[GL.filter((l,k)=>k!==iS).join('\n'),GL.concat([GL[iS]]).join('\n'),mut(iS,l=>l.replace(": 'VeroParse'"," 'VeroParse'")),mut(iS,l=>l.replace("'js/vero-parse.js'","'js/missing-x.js'")),mut(iS,l=>l.replace(/, 'js\/vero-discourse\.js': 'VeroDiscourse'/,'')),mut(iO,l=>l.replace(", 'js/vero.js'",'')),GL.filter((l,k)=>k!==iO).join('\n'),mut(iS,l=>l.replace('}',", 'js/vero-parse.js': 'VeroP2'}"))];
chk('S03b extractor fails closed on every malformed gate copy ('+S03MAL.length+')', S03MAL.every(m=>{ try{ gateMaps(m); return false; }catch(e){ return true; } }));

/* ---------- 3. gold ---------- */
function judgeBench(d,exp,codes){ const s=a=>JSON.stringify([...a].sort());
  switch(d.check){ case 'lookup': return exp.length>0&&exp.includes(codes[0]); case 'first': return exp.length>0&&codes[0]===exp[0]; case 'top': return exp.length>0&&JSON.stringify(codes.slice(0,d.take))===JSON.stringify(exp.slice(0,d.take));
    case 'set': return s(codes)===s(exp); case 'count': return codes.length===exp.length; case 'contains': return exp.length>0&&exp.every(c=>codes.includes(c)); case 'empty': return codes.length===0&&exp.length===0; }
  throw new Error('unknown B144 gold check "'+d.check+'"'); }   /* V2-2C C1: an unknown judge never passes silently */
/* V2-2C C1 (design §15.2): every HO check name is implemented; an unknown name throws (J1). A judge that has nothing to judge
   returns null and the turn is UNSCORED, never SAME_OK.
     none          the gold names no products (route / behaviour only): the code dimension is judged true
     cands         >= 2 candidate products offered (AI / WEB routes judge the candidate list)
     candsNas      >= 2 candidates, all NAS;   candsMouse   >= 2 candidates, all mice
     noCat5eClaim  nothing presented as Cat5e: no shown product named Cat5e, and a non-empty answer's label does not claim Cat5e
   These are documented MINIMUMS, weaker than some behaviour texts (C3 tightens them with derived gold): cands does not check
   the ">= 45W" rating (HO09); none does not judge "must not name a best seller / newest product" (HO14, N31); noCat5eClaim does
   not require the "we don't have Cat5e" statement. */
function judgeHO(exp,check,codes,cand,cards,label){ const names=cs=>cs.map(c=>String((byCode[c]||{}).product_name||''));
  switch(check){ case 'first': return codes[0]===exp[0]; case 'firstIn': return exp.includes(codes[0]); case 'set': return JSON.stringify([...codes].sort())===JSON.stringify([...exp].sort());
  case 'empty': return codes.length===0; case 'ordered': return JSON.stringify(codes.slice(0,exp.length))===JSON.stringify(exp); case 'subsetNonEmpty': return codes.length>0&&codes.every(c=>exp.includes(c));
  case 'anchorFirst': return cand[0]===exp[0]; case 'subsetOrEmpty': return codes.every(c=>exp.includes(c)); case 'allFamilyMouse': return codes.length>0&&cards.every(c=>/mouse/i.test(c)); case 'history': return exp.every(c=>codes.includes(c));
  case 'none': return true;
  case 'cands': return cand.length>=2;
  case 'candsNas': return cand.length>=2 && names(cand).every(n=>/\bnas(?:ync)?\b|network attached/i.test(n));   /* the product line is "NASync" */
  case 'candsMouse': return cand.length>=2 && names(cand).every(n=>/\bmouse\b|\bmice\b/i.test(n));
  case 'noCat5eClaim': return !names(codes).some(n=>/cat\s?5e/i.test(n)) && !(codes.length && /cat\s?5e/i.test(String(label||'')) && !/don.?t have|\bwala\b|we have no|\bno cat\s?5e/i.test(String(label||'')));
  } throw new Error('unknown HO gold check "'+check+'"'); }
/* route: benchmark/HO vocabulary -> current route / v2 route */
function routeOkCur(exp,route,intent,codes){ if(exp==='LOCAL') return route==='LOCAL'||route==='LOCAL+offer'; if(exp==='CLARIFY') return route==='CLARIFY'; if(exp==='AI') return route==='CATALOG'||route==='WEB'; if(exp==='WEB') return route==='WEB';
  if(exp==='NOT_AI') return route!=='CATALOG'&&route!=='WEB'; if(exp==='SMALLTALK') return intent==='smalltalk'&&!codes.length; if(exp==='NOT_CLARIFY_LOCAL_OR_AI') return route!=='CLARIFY'; if(exp==='COACH') return route==='COACH'; return null; }
function routeOkV2(exp,P){ const r=P.proposal.route, k=P.proposal.kind; if(exp==='LOCAL') return r==='LOCAL'; if(exp==='CLARIFY') return r==='CLARIFY'; if(exp==='AI') return r==='AI_CATALOG'||r==='WEB'; if(exp==='WEB') return r==='WEB';
  if(exp==='NOT_AI') return r!=='AI_CATALOG'&&r!=='WEB'; if(exp==='SMALLTALK') return k==='smalltalk'; if(exp==='NOT_CLARIFY_LOCAL_OR_AI') return r!=='CLARIFY'; if(exp==='COACH') return r==='COACH'; return null; }

/* ---------- 4. "did the current plan have a slot for this v2 constraint?" (approximate concept presence) ---------- */
function curHas(pl,c){
  const F=pl.filters||[], M=pl.match||[], conns=(pl.connectors||[]).concat((pl.ports||[]).map(p=>p.kind)), unc=(pl.unconfirmed||[]).join(' '), tr=JSON.stringify(pl.trace||[]).toLowerCase();
  const phr=M.filter(m=>m.k==='namephrase'||m.k==='nameword').map(m=>String(m.v).toLowerCase()).join(' ');
  switch(c.kind){
    case 'num': return F.some(f=>f.attr===c.attr||(c.attr==='lengthM'&&/len/i.test(f.attr))||(c.attr==='gbps'&&/gbps|speed/.test(f.attr)))||(c.attr==='gbps'&&M.some(m=>m.k==='gbps'||m.k==='eth'));
    case 'connector': return conns.includes(c.id)||(O2.CONNECTORS[c.id]&&O2.CONNECTORS[c.id].aliases.some(a=>phr.indexOf(a)>=0))||(c.id==='usb'&&conns.some(x=>/usb/.test(x)))||!!(pl.pair&&(pl.pair.from===c.id||pl.pair.to===c.id))||(pl.type&&pl.type.family==='lan_cable'&&c.id==='rj45');
    case 'pair': return !!(pl.pair&&pl.pair.from===c.from.id&&c.to.some(t=>t.id===pl.pair.to));
    case 'ports': return F.some(f=>f.attr==='ports')||(pl.ports||[]).length>0;
    case 'feature': return (O2.FEATURES[c.id]&&O2.FEATURES[c.id].aliases.some(a=>phr.indexOf(a)>=0||phr.indexOf(a.split(' ').pop())>=0))||M.some(m=>m.v===c.id||(m.k==='flag'&&m.v===c.id)||(m.label&&String(m.label).toLowerCase().indexOf(String(c.label).toLowerCase().split(' ')[0])>=0))||unc.indexOf(c.id)>=0||new RegExp(String(c.label).split(' ')[0],'i').test(unc);
    case 'colour': return M.some(m=>m.k==='color');
    case 'form': return !!(pl.form||pl.formStrict)||!!(pl.type&&pl.type.term&&new RegExp(c.form).test(pl.type.term));
    case 'family': return !!pl.type;
    case 'size': return M.some(m=>m.k==='size');
    case 'price': return F.some(f=>/price|srp|dp/.test(f.attr));
    case 'standard': return (pl.standards||[]).includes(c.id);
    case 'device': return !!(pl.deviceNamed||pl.intent==='compat'||pl.useCase||(pl.devices&&pl.devices.length))||tr.indexOf(String(c.device.text||'').toLowerCase())>=0||tr.indexOf('device')>=0;
    case 'res': case 'hz': return M.some(m=>m.k==='res'||m.k==='refresh');
    case 'nametext': case 'nametoken': case 'name': return M.some(m=>m.k==='namephrase'||m.k==='nameword')||(pl.names||[]).length>0||(pl.anchors||[]).length>0||unc.length>0;
    case 'role': return M.some(m=>/power|pd|charging/.test(String(m.v)+String(m.label)))||/power|charging/.test(unc)||(pl.ports||[]).some(p=>/pd|power/.test(JSON.stringify(p)));
    case 'notConnector': case 'notFamily': return false;
  }
  return false; }

/* stock wording (shared by the single-turn G06 / RT6 and the C3 stock gate) */
const STOCKW=/\b(stocks?|in[- ]stock|inventory|on ?hand|natira|natitira|remaining|sold ?out|ubos|left|warehouse|bodega|available|availability)\b|meron pa\b|ilan pa\b/i;
const stockWorded=q=>STOCKW.test(q) && !/\b(colou?rs?|kulay|variants?)\b/i.test(q) && !/meron pa (bang? )?(mas|iba)/i.test(q);
/* ---------- 5. evaluate every turn ---------- */
const ROWS=[], JUDGE_ERR=[];
ITEMS.forEach(it=>{
  const key=it.set+':'+it.id, cur=CUR[key], P=V2[key], pr=P.proposal, pl=cur.r.plan||{};
  const curRoute=routeOf(cur.a,cur.r), curCodes=cur.r.codes||[], curCand=cur.a.candidates||[];
  const v2Codes=pr.codes||[];
  /* what v2 presents AS the answer: exact / partial (stated unconfirmed) results. "closest" results are offered under an explicit
     "No exact match for …" note, and not-found / clarify / needs-context present nothing — none of those count as a match. */
  const NOANS=/^(none|none-confirmed|clarify|needs-context|not-found|closest|smalltalk|coach)$/;
  const v2Ans=NOANS.test(pr.kind)?[]:v2Codes;
  const row={ set:it.set, id:it.id, q:it.q, follow:it.follow, inventory:it.inventory, expRoute:it.expRoute,
    current:{ route:curRoute, intent:pl.intent||cur.r.type, type:cur.r.type, codes:curCodes.slice(0,15), nCodes:curCodes.length, cand:curCand.slice(0,8), echo:cur.r.echo||null, header:String(cur.r.note||'').split('\n')[0].slice(0,160), stockNote:cur.r.stockNote||null,
      plan:{ type:pl.type&&pl.type.id, form:pl.form||null, connectors:pl.connectors, pair:pl.pair, filters:(pl.filters||[]).map(f=>f.attr+f.op+f.value), match:(pl.match||[]).map(m=>m.k+':'+(m.v||m.label)), unconfirmed:pl.unconfirmed||null } },
    v2:VP.report(P) };
  /* gold */
  let gold=null, curOk=null, v2Ok=null, curRouteOk=routeOkCur(it.expRoute,(pl.route&&pl.route.route==='COACH_FUTURE')?'COACH':curRoute,pl.intent,curCodes), v2RouteOk=routeOkV2(it.expRoute,P);
  if(it.set==='B144'){
    if(it.gold && it.gold.where){ const exp=derive(it.gold); gold={ check:it.gold.check, expected:exp.slice(0,15), nExpected:exp.length };
      const note=cur.r.note||'', yes=note.match(/^(?:Yes — )?(\d+) /); let cc=curCodes; if(it.gold.check==='set'&&yes&&/not explicitly confirmed|mentioned only/.test(note)) cc=curCodes.slice(0,+yes[1]); if(it.gold.check==='empty') cc=/^No\b/.test(note)?[]:curCodes;
      const routeAI=it.expRoute==='AI'||it.expRoute==='WEB';
      try{ curOk=judgeBench(it.gold,exp,routeAI&&curCand.length?curCand:cc); v2Ok=judgeBench(it.gold,exp,routeAI?v2Codes:v2Ans); }catch(e){ JUDGE_ERR.push(key+': '+e.message); curOk=null; v2Ok=null; } }
  } else if(it.check){ gold={ check:it.check, expected:it.expCodes };
    try{ curOk=judgeHO(it.expCodes,it.check,curCodes,curCand,curCodes.map(c=>nameOf(byCode[c]||{})),[cur.r.echo,String(cur.r.note||'').split('\n')[0]].filter(Boolean).join(' | '));
      v2Ok=judgeHO(it.expCodes,it.check,v2Ans,v2Codes,v2Ans.map(c=>nameOf(byCode[c]||{})),pr.label); }catch(e){ JUDGE_ERR.push(key+': '+e.message); curOk=null; v2Ok=null; } }
  row.gold=gold; row.routeOk={ current:curRouteOk, v2:v2RouteOk }; row.cls=it.cls; row.legacy=it.legacy; row.judge={ curOk, curRouteOk };   /* C3 reuses the current side's judgement */
  const scorable=!it.follow;
  /* V2-2C C1 (design §15.2): a side with no judgeable dimension (code judge and route judge both null) is UNSCORED, never OK */
  const cJ=[curOk,curRouteOk].filter(x=>x!==null&&x!==undefined).length, vJ=[v2Ok,v2RouteOk].filter(x=>x!==null&&x!==undefined).length; row.judged={ current:cJ, v2:vJ };
  const cOK=(curOk!==false)&&(curRouteOk!==false), vOK=(v2Ok!==false)&&(v2RouteOk!==false);
  row.category=!scorable?(it.expRoute==='COACH'?'OUT_OF_SCOPE_COACH':'FOLLOWUP_COVERAGE_ONLY'):((!cJ||!vJ)?'UNSCORED':(cOK&&vOK?'SAME_OK':(!cOK&&!vOK?'SAME_FAIL':(vOK?'V2_BETTER':'V2_WORSE'))));
  /* silent drops, unresolved, senses */
  row.silentDrops=P.ledger.silentDrops; row.unresolved=P.ledger.unresolved; row.ambiguous=P.ledger.ambiguous; row.senses=P.senses;
  /* current silent drops: v2 bound a constraint the current plan has no slot for */
  row.currentMissing=P.frame.constraints.filter(c=>!curHas(pl,c)).map(c=>c.kind+':'+c.label);
  /* label integrity: audit both headers against the products each side shows */
  const curLabel=[cur.r.echo,row.current.header].filter(Boolean).join(' | ');
  row.labelAudit={ current:VP.auditLabel(curLabel,curCodes.slice(0,12),{ facts:FACTS, products:PUB }), v2:VP.auditLabel(pr.label,v2Codes,{ facts:FACTS, products:PUB, isLabel:true }) };
  /* false "wala": v2 says none while the gold expects products */
  const expNonEmpty=gold&&((gold.expected&&gold.expected.length)||(gold.nExpected>0))&&!/empty|subsetOrEmpty/.test(gold.check);
  row.falseWala={ current:!!(expNonEmpty&&!curCodes.length&&/wala|we don.t have|no .* in the current|not in the current/i.test(cur.r.note||'')), v2:!!(expNonEmpty&&(pr.kind==='none'||pr.kind==='not-found')) };
  /* confident exact with an unresolved hard span */
  row.confidentDespiteUnresolved=pr.kind==='exact' && P.ledger.unresolved.some(u=>u.kind==='name-like'||/FAMILY|NAME|FORM|ANCHOR/.test(u.adjacentTo));
  /* inventory safety (v2 proposal) */
  /* inventory safety: a stock-worded question must get INVENTORY + the no-live-inventory caveat; no turn may claim stock or a quantity */
  { const txt=[].concat(pr.notes||[],pr.hint||[]).join(' '); const claim=/\b\d+\s*(pcs|pieces|units|left|natira|on hand)\b/i.test(txt)||/\bin stock\b|\bmay stock\b|\bavailable pa\b/i.test(txt);
    const stockQ=stockWorded(it.q);
    if(it.inventory||stockQ){ row.inventorySafety={ stockWorded:stockQ, v2:!claim && (!stockQ || (P.frame.intent==='INVENTORY' && /live inventory/.test(txt))), current:/live inventory|inventory data/i.test((cur.r.note||'')+' '+(cur.r.stockNote||'')) }; } }
  /* the five diff questions, answered per turn */
  const curLab=row.labelAudit.current.violations.length+row.labelAudit.current.wording.length, v2Lab=row.labelAudit.v2.violations.length+row.labelAudit.v2.wording.length;
  row.diff={ understoodMore:row.currentMissing.length?row.currentMissing:false,
    newWrongInterpretation:row.category==='V2_WORSE'||v2Lab>0||row.falseWala.v2||row.confidentDespiteUnresolved,
    preservedCorrect:row.category==='SAME_OK'?true:(row.category==='V2_WORSE'?false:null),
    unexplainedPhrases:{ silent:row.silentDrops.map(x=>x.text), reportedUnresolved:row.unresolved.map(x=>x.text), ambiguous:row.ambiguous.map(x=>x.text) },
    wouldPreventMislabel:curLab>0&&v2Lab===0, wouldPreventFalseWala:row.falseWala.current&&!row.falseWala.v2 };
  ROWS.push(row);
});

/* ---------- 6. metrics + gates ---------- */
const pct=(a,b)=>b?Math.round(a/b*1000)/10:0;
const sets=['B144','HO1','HO2','HO3'], M={};
sets.concat(['ALL']).forEach(s=>{ const R=ROWS.filter(r=>s==='ALL'||r.set===s), sc=R.filter(r=>/^(SAME|V2)/.test(r.category));
  const cnt=c=>R.filter(r=>r.category===c).length;
  const cls=c=>R.filter(r=>r.cls===c).length;
  M[s]={ turns:R.length, scorable:sc.length, followUps:cnt('FOLLOWUP_COVERAGE_ONLY'), coach:cnt('OUT_OF_SCOPE_COACH'), UNSCORED:cnt('UNSCORED'),
    taxonomy:{ STANDALONE:cls('STANDALONE'), CONTEXT:cls('CONTEXT'), CONTEXT_COMPAT:cls('CONTEXT_COMPAT'), TOPIC_SWITCH:cls('TOPIC_SWITCH'), STANDALONE_IN_SEQ:cls('STANDALONE_IN_SEQ') },
    SAME_OK:cnt('SAME_OK'), SAME_FAIL:cnt('SAME_FAIL'), V2_BETTER:cnt('V2_BETTER'), V2_WORSE:cnt('V2_WORSE'),
    currentCorrect:sc.filter(r=>r.category==='SAME_OK'||r.category==='V2_WORSE').length, v2Correct:sc.filter(r=>r.category==='SAME_OK'||r.category==='V2_BETTER').length,
    silentDrops:R.reduce((a,r)=>a+r.silentDrops.length,0), turnsWithUnresolved:R.filter(r=>r.unresolved.length).length, turnsWithAmbiguous:R.filter(r=>r.ambiguous.length).length,
    currentMissingTurns:R.filter(r=>r.currentMissing.length).length,
    labelViolations:{ current:R.filter(r=>r.labelAudit.current.violations.length).length, v2:R.filter(r=>r.labelAudit.v2.violations.length).length },
    labelWording:{ current:R.filter(r=>r.labelAudit.current.wording.length).length, v2:R.filter(r=>r.labelAudit.v2.wording.length).length },
    falseWala:{ current:R.filter(r=>r.falseWala.current).length, v2:R.filter(r=>r.falseWala.v2).length },
    confidentDespiteUnresolved:R.filter(r=>r.confidentDespiteUnresolved).length,
    inventory:{ of:R.filter(r=>r.inventorySafety).length, flagged:R.filter(r=>r.inventory).length, v2Safe:R.filter(r=>r.inventorySafety&&r.inventorySafety.v2).length },
    coverageMean:Math.round(R.reduce((a,r)=>a+r.v2.ledger.coverage,0)/(R.length||1)*1000)/1000,
    boundCoverageMean:Math.round(R.reduce((a,r)=>a+r.v2.ledger.boundCoverage,0)/(R.length||1)*1000)/1000,
    senseDecisions:R.reduce((a,r)=>a+r.senses.length,0) }; });
const sorted=times.slice().sort((a,b)=>a-b), q=f=>Math.round(sorted[Math.min(sorted.length-1,Math.floor(sorted.length*f))]*100)/100;
const PERF={ factsColdMs:factsMs, v2CatalogColdMs:Math.round(catalogMs), turnMedianMs:q(0.5), turnP95Ms:q(0.95), turnMaxMs:Math.round(sorted[sorted.length-1]*100)/100, turns:times.length };
const A=M.ALL;
chk('G01 zero silent span drops on all dev sets ('+A.silentDrops+')', A.silentDrops===0, JSON.stringify(ROWS.filter(r=>r.silentDrops.length).slice(0,8).map(r=>[r.set,r.id,r.silentDrops])));
chk('G02 zero V2_WORSE turns vs p2r3a on previously correct turns ('+A.V2_WORSE+')', A.V2_WORSE===0, JSON.stringify(ROWS.filter(r=>r.category==='V2_WORSE').map(r=>[r.set,r.id,r.q])));
chk('G03 zero v2 label-integrity violations: hard '+A.labelViolations.v2+', hub/dock wording '+A.labelWording.v2, A.labelViolations.v2===0 && A.labelWording.v2===0, JSON.stringify(ROWS.filter(r=>r.labelAudit.v2.violations.length).slice(0,6).map(r=>[r.set,r.id,r.v2.proposal.label,r.labelAudit.v2.violations])));
chk('G04 zero v2 false "wala" ('+A.falseWala.v2+')', A.falseWala.v2===0, JSON.stringify(ROWS.filter(r=>r.falseWala.v2).map(r=>[r.set,r.id,r.q])));
chk('G05 zero confident exact answers with an unresolved hard span', A.confidentDespiteUnresolved===0, JSON.stringify(ROWS.filter(r=>r.confidentDespiteUnresolved).map(r=>[r.set,r.id,r.q])));
chk('G06 inventory safety: every inventory turn proposes listed + no-live-inventory, no quantity ('+A.inventory.v2Safe+'/'+A.inventory.of+')', A.inventory.v2Safe===A.inventory.of, JSON.stringify(ROWS.filter(r=>r.inventorySafety&&!r.inventorySafety.v2).map(r=>[r.set,r.id,r.q,r.v2.frame.intent,r.v2.proposal.notes])));
chk('G07 every sense decision is in the report (span, candidates, scores, margin, state)', ROWS.every(r=>r.senses.every(s=>s.span&&s.selected&&Array.isArray(s.scores)&&typeof s.margin==='number'&&s.state)));
chk('G08 every span has exactly one final state', ROWS.every(r=>r.v2.spans.every(s=>['BOUND','UNCONFIRMABLE','UNRESOLVED','AMBIGUOUS','UNUSED'].includes(s.state))));
chk('G09 performance: v2 turn p95 <= 15 ms and catalog cold build <= 1500 ms (Node)', PERF.turnP95Ms<=15 && PERF.v2CatalogColdMs<=1500, JSON.stringify(PERF));

/* ---------- V2-2B shadow RATCHETS (gating) ---------- */
const PIN_BETTER=['B144:E07','HO3:T03','HO3:T07','HO3:T09','HO3:T11','HO3:T14','HO3:T19','HO3:T22','HO3:S1-1','HO3:S2-1','HO3:S5-1','HO3:S6-1'];
const PIN_SAME_OK=['C03','M04','V02','D04','A02','A03','A04','T06','P07'];
const PIN_CODES={ C03:['80401','80402','80403','80404','80405','45430','45432','45433','45434','45437'], M04:['80404','45433'], V02:['80404','45433'] };   /* exact v2 proposal codes at baseline 0df3212 (test expectations) */
const rowOf=k=>ROWS.find(r=>r.set+':'+r.id===k);
chk('RT1 V2_BETTER >= 12 and every pinned better turn is still V2_BETTER ('+A.V2_BETTER+')', A.V2_BETTER>=12 && PIN_BETTER.every(k=>rowOf(k)&&rowOf(k).category==='V2_BETTER'), PIN_BETTER.filter(k=>!rowOf(k)||rowOf(k).category!=='V2_BETTER'));
chk('RT2 SAME_FAIL <= 1 ('+A.SAME_FAIL+')', A.SAME_FAIL<=1, JSON.stringify(ROWS.filter(r=>r.category==='SAME_FAIL').map(r=>r.set+':'+r.id)));
chk('RT3 pinned scored turns stay SAME_OK: '+PIN_SAME_OK.join(' '), PIN_SAME_OK.every(id=>rowOf('B144:'+id).category==='SAME_OK'), PIN_SAME_OK.filter(id=>rowOf('B144:'+id).category!=='SAME_OK'));
chk('RT4 C03 / M04 / V02 keep IDENTICAL proposal codes (HDMI 2.1 representation change is projection-only, BA6)', Object.keys(PIN_CODES).every(id=>JSON.stringify(rowOf('B144:'+id).v2.proposal.codes)===JSON.stringify(PIN_CODES[id])), Object.keys(PIN_CODES).map(id=>id+':'+rowOf('B144:'+id).v2.proposal.codes.join(',')));
chk('RT5 coverage mean = 1 and bound coverage >= 0.988 ('+A.coverageMean+' / '+A.boundCoverageMean+')', A.coverageMean===1 && A.boundCoverageMean>=0.988);
/* V2-2C C3 (design §15): the RT6 stock count is derived from the data (inventory flag or stock wording), never a literal; 15 stays a floor */
const STOCK_EXPECTED=ITEMS.filter(it=>it.inventory||stockWorded(it.q)).length;
chk('RT6 inventory safety '+A.inventory.v2Safe+'/'+A.inventory.of+' = data-derived '+STOCK_EXPECTED+' (>= 15) and no new unresolved / ambiguous turns (<= 4 / <= 1)', A.inventory.v2Safe===A.inventory.of && A.inventory.of===STOCK_EXPECTED && STOCK_EXPECTED>=15 && A.turnsWithUnresolved<=4 && A.turnsWithAmbiguous<=1, JSON.stringify([A.inventory,A.turnsWithUnresolved,A.turnsWithAmbiguous]));
/* ---------- EXCLUDE-integrity audit (gating) over every shadow turn + a generated exclusion matrix ---------- */
const EXM=[]; ['charger','power bank','hub','hdmi cable','earphones'].forEach(f=>{ ['white','black','pink'].forEach(c=>EXM.push(f+' na hindi '+c,'not '+c+' '+f,f+' except '+c,'walang '+c+' '+f)); ['built-in cable','magsafe','hdmi','usb-c'].forEach(v=>EXM.push(f+' na walang '+v,f+' without '+v)); EXM.push('not 65w '+f,'hindi 20000mah '+f,f+' not over 1000 pesos','not sure kung 65w '+f,'dont need 65w '+f,f+' no need talaga','no need talaga 65w '+f); });
EXM.push('hub not usb 3.2 gen 2','hindi usb 3.2 gen 1 hub','not usb 3.1 gen 1 cable','cable hindi usb 3.1 gen 2','hub except usb 3.2 gen 2');   /* V2-2C C1 remote review N1: negated full USB versions */
const audit=[]; let polNullSeen=0, negSeen=0;
ITEMS.map(it=>({ q:it.q, P:V2[it.set+':'+it.id] })).concat(EXM.map(q=>({ q, P:VP.run(q,{ facts:FACTS, products:PUB }) }))).forEach(({ q, P })=>{ const pr=P.proposal;
  P.frame.constraints.forEach(c=>{ if(c.polNull){ polNullSeen++; if(pr.kind==='exact') audit.push(q+' :: polarity-null labelled exact'); }
    const excluded=c.neg||c.kind==='notConnector'||c.kind==='notFamily'||c.kind==='notVersion'; if(!excluded) return; negSeen++;
    const pos=c.kind==='notVersion'?{ kind:'ifaceVersion', iface:c.iface, gen:c.ver, label:c.label }:Object.assign({},c,{ neg:false, kind:c.kind==='notConnector'?'connector':c.kind==='notFamily'?'family':c.kind });
    (pr.codes||[]).forEach(code=>{ if(VP.evalConstraint(code,pos,{ facts:FACTS, products:PUB })==='CONFIRMED') audit.push(q+' :: proposed '+code+' carries the excluded '+c.label); }); });
  if(P.ledger.unresolved.some(u=>u.kind==='neg'||u.kind==='relaxneg') && pr.kind==='exact') audit.push(q+' :: unresolved negator but exact'); });
chk('EX1 EXCLUDE-integrity: no proposed product carries an excluded value; polarity null never exact; an unresolved negator never exact ('+(ITEMS.length+EXM.length)+' turns, '+negSeen+' exclusions, '+polNullSeen+' null-polarity constraints)', !audit.length && negSeen>=40 && polNullSeen>=10, audit.slice(0,6));
/* ---------- V2-2C C1: test-spec corrections + single-turn freeze (gating) ---------- */
chk('J1 every gold check name has an implemented judge (none, cands, candsNas, candsMouse, noCat5eClaim added; unknown names throw)', !JUDGE_ERR.length, JUDGE_ERR.slice(0,6));
chk('J2 a null judge is UNSCORED, never SAME_OK: every scored turn has >= 1 judged dimension per side ('+A.UNSCORED+' UNSCORED)', ROWS.filter(r=>/^(SAME|V2)/.test(r.category)).every(r=>r.judged.current>0 && r.judged.v2>0) && ROWS.filter(r=>r.category==='UNSCORED').every(r=>!r.judged.current||!r.judged.v2));
{ const F=ROWS.filter(r=>r.legacy.positional), byC=c=>F.filter(r=>r.cls===c), keys=a=>a.map(r=>r.set+':'+r.id).sort();
  const ctx=byC('CONTEXT').concat(byC('CONTEXT_COMPAT')), ts=byC('TOPIC_SWITCH'), sis=byC('STANDALONE_IN_SEQ');
  const listed=ROWS.filter(r=>r.legacy.contextTurn), flag=ROWS.filter(r=>r.legacy.followUpFlag);
  chk('T1 ONE follow-up taxonomy: the '+F.length+' positional follow-ups partition into CONTEXT '+ctx.length+' (incl. '+byC('CONTEXT_COMPAT').length+' compat) + TOPIC_SWITCH '+ts.length+' + STANDALONE_IN_SEQ '+sis.length+'; the legacy contextTurns ('+listed.length+') = CONTEXT + TOPIC_SWITCH; followUp flags ('+flag.length+') are a subset; no follow-up is STANDALONE',
    F.length===35 && ctx.length===28 && ts.length===4 && sis.length===3 && ctx.length+ts.length+sis.length===F.length && listed.length===32 && JSON.stringify(keys(listed))===JSON.stringify(keys(ctx.concat(ts))) && flag.length===19 && flag.every(r=>/^(CONTEXT|CONTEXT_COMPAT|TOPIC_SWITCH)$/.test(r.cls)) && !ROWS.some(r=>!r.legacy.positional && r.cls!=='STANDALONE'),
    JSON.stringify(M.ALL.taxonomy));
  chk('T2 plan §10.8 reworded: context-anchored compatibility turns (gold WEB / AI) are their own class CONTEXT_COMPAT = HO1:SQ3-2, HO3:S5-2, B144:T08; the LOCAL + 0-candidate criterion applies to the other '+byC('CONTEXT').length+' CONTEXT turns',
    JSON.stringify(keys(byC('CONTEXT_COMPAT')))==='["B144:T08","HO1:SQ3-2","HO3:S5-2"]' && byC('CONTEXT').every(r=>!/^(WEB|AI)$/.test(r.expRoute)), keys(byC('CONTEXT_COMPAT')));
  const judgeable=ctx.filter(r=>r.gold && ((r.gold.expected&&r.gold.expected.length)||r.gold.nExpected>0||/^(none|cands|candsNas|candsMouse|noCat5eClaim|empty)$/.test(r.gold.check)));
  console.log('C1 taxonomy: '+judgeable.length+' of '+ctx.length+' CONTEXT turns have judgeable gold today (scored in C3); B144 context turns with gold: '+ctx.filter(r=>r.set==='B144' && r.gold).length+'/7');
  chk('T3 follow-ups stay COVERAGE-ONLY in the single-turn table (single-turn v2 has no context; the C3 chained section scores them) and the honest scorable-context count is reported ('+judgeable.length+'/'+ctx.length+')', F.every(r=>/^(FOLLOWUP_COVERAGE_ONLY|OUT_OF_SCOPE_COACH)$/.test(r.category)) && judgeable.length>=20 && ctx.filter(r=>r.set==='B144' && r.gold).length===0); }
/* single-turn freeze (design §15 C1 tests): sha256 of every STANDALONE v2 proposal (route, kind, codes), pinned at the live baseline
   16a827d, minus a REVIEWED allow-list of intended C1 changes, each pinned to its new value */
{ const crypto=require('crypto');
  /* review round 1: E03 / D07 left the allow-list — with the evidence floor (a proposed row must name or mention every requested
     connector) they are byte-identical to the live baseline again */
  /* re-baseline 6672902d (2026-10-15, NA-11): causal audit on d87c6e99 vs 6672902d trees with identical code -- every differing item is explained by the catalogue (15 added SKUs, 55988B re-enabled, rewritten 75177 / power-bank text, catalogue-size counters); 0 route / act changes outside those items. Allow-list: route / kind / category unchanged; counts grow only by new or re-enabled SKUs
     (S05 +55988B; B04 / T17 / A04 +35604B +55988B; G04 +35856 +25418B +85252B +45089; V01 +90592; K06 / T05 +60114 +35604B); was 8 / 17 / 17 / 17 / 50 / 61 / 129 / 129 */
  const ALLOW={ 'B144:S05':['LOCAL','inferred',9,'#6: retractable => built-in cable is INFERRED (+1, labelled; the set is no longer "exact")'],
    'B144:B04':['LOCAL','inferred',19,'#6: retractable => built-in (+1 INFERRED)'], 'HO3:T17':['LOCAL','inferred',19,'#6: retractable => built-in (+1 INFERRED)'],
    'B144:A04':['LOCAL','alternative',19,'#6: one more alternative admitted only through retractable => built-in, labelled inferred'],
    'B144:G04':['LOCAL','exact',54,'§7 rule 4: rows with no wattage are kept AFTER the ranked rows (were dropped)'],
    'B144:V01':['LOCAL','exact',62,'§7 rule 4: rows with no length kept after the ranked rows'], 'B144:K06':['LOCAL','exact',131,'§7 rule 4: rows with no length kept last'], 'B144:T05':['LOCAL','exact',131,'§7 rule 4: rows with no length kept last'] };
  const ST=ROWS.filter(r=>!r.follow), sig=JSON.stringify(ST.filter(r=>!ALLOW[r.set+':'+r.id]).map(r=>r.set+':'+r.id).sort().map(k=>{ const p=V2[k].proposal; return [k,p.route,p.kind,p.codes]; }));
  /* re-pinned 2026-10-13 (owner-approved tests-only V2 CMS baseline reconciliation): the authorized CMS reorder (live 1164f6be) changed
     only the catalogue ORDER of the 796-code proposals B144:H03 / B144:H05 (same codes, route LOCAL, kind exact; new list = old list
     re-sorted by the new catalogue positions). Old content in the new order reproduces this value; new content in the old order
     reproduces the 16a827d value 1225cca49e0c88370a48c15d05a8666dd96ca360eb1e2c14e1202dc7cf95b33d (report
     UNO-V2-CMS-Baseline-Reconciliation-2026-10-13.md). The allow-list below is unchanged. */
  const sha=crypto.createHash('sha256').update(sig).digest('hex'), FREEZE='c7aff1e3e6d4ccd9a94d77d05a185b98e4323181556e49d8c733ed85e7313e6a';   /* re-baseline 6672902d; was d5b8f544…06d7 on 1164f6be */
  const allowBad=Object.keys(ALLOW).filter(k=>{ const p=V2[k]&&V2[k].proposal, w=ALLOW[k]; return !p || p.route!==w[0] || p.kind!==w[1] || p.codes.length!==w[2]; });
  chk('F1 single-turn freeze: '+(ST.length-Object.keys(ALLOW).length)+' standalone v2 proposals byte-identical to live 16a827d behaviour on catalogue 6672902d (sha '+sha.slice(0,12)+'…); '+Object.keys(ALLOW).length+' reviewed allow-list changes each at their pinned value', ST.length===225 && sha===FREEZE && !allowBad.length, JSON.stringify([ST.length,sha,allowBad]));
  chk('F2 allow-listed changes never worsen a scored turn (category SAME_OK / V2_BETTER / SAME_FAIL as before; no V2_WORSE)', Object.keys(ALLOW).every(k=>ROWS.find(r=>r.set+':'+r.id===k).category!=='V2_WORSE'));
  /* EV1 (review round 1): structural evidence floor over every shadow turn — a partial / closest / inferred proposal never contains a
     product that neither names nor mentions a requested (affirmed) connector; this catches E03 / D07-style answers without gold */
  const named=(c,k)=>{ const g=VP.graphFor(c,{ facts:FACTS, products:PUB }); return !!g && (g.conns.all.includes(k)||g.conns.feat.includes(k)||(k==='usb'&&g.conns.all.concat(g.conns.feat).some(x=>/^usb|micro_usb/.test(x)))||(g.pair&&(g.pair.from.includes(k)||g.pair.to.includes(k)))); };
  const evb=[]; ROWS.forEach(r=>{ const P=V2[r.set+':'+r.id], pr=P.proposal; if(!/^(partial|closest|inferred)$/.test(pr.kind)) return;
    P.frame.constraints.filter(c=>c.kind==='connector' && !c.polNull && !c.affirmBase && c.label!==pr.relaxed).forEach(c=>{ const bad=(pr.codes||[]).filter(code=>!named(code,c.id)); if(bad.length) evb.push(r.set+':'+r.id+' '+c.id+' '+bad.slice(0,3).join(',')); }); });
  chk('EV1 evidence floor: no partial / closest / inferred proposal lists a product with no trace of a requested connector ('+ROWS.length+' turns)', !evb.length, evb.slice(0,6)); }
/* ---------- V2-2C C3: frozen PRE-C3 baseline ratchet (single-turn; recorded before any C3 edit) ---------- */
/* Deliverables\VERO-Phase2\VERO-v2-2C-C3-PreC3-Baseline-2026-10-10.json (sha256 d4729c3b…), unmodified harness at 99dd595 */
const PRE_C3={ scorable:225, SAME_OK:212, SAME_FAIL:1, V2_BETTER:12, V2_WORSE:0, UNSCORED:0, v2Correct:224 };
chk('PB1 single-turn quality never below the frozen PRE-C3 baseline (scorable 225, V2_WORSE 0, SAME_FAIL <= 1, V2_BETTER >= 12, v2 correct >= 224, UNSCORED 0)',
  A.scorable===PRE_C3.scorable && A.V2_WORSE<=PRE_C3.V2_WORSE && A.SAME_FAIL<=PRE_C3.SAME_FAIL && A.V2_BETTER>=PRE_C3.V2_BETTER && A.v2Correct>=PRE_C3.v2Correct && A.UNSCORED<=PRE_C3.UNSCORED, JSON.stringify([A.scorable,A.SAME_OK,A.SAME_FAIL,A.V2_BETTER,A.V2_WORSE,A.UNSCORED,A.v2Correct]));

/* ======================================================================================================================
   V2-2C C3 — CHAINED SCORING / DEV GOLD SHADOW HARNESS (measurement only; owner decisions D1 / D2, 2026-10-10)
   The harness MEASURES the dormant chain  VeroParse.turnFrame -> VeroContext.step (-> VeroDiscourse.resolve -> executeFrame).
   It never changes, patches or re-implements the system under test, and holds no logic production would need.
   REALISTIC  each chain consumes its own prior context.
   ORACLE     before turn t the previous state's shown / candidates / focus are replaced by turn t-1's gold-derived set
              ("v2's own previous frame + the correct previous result set", design §15.4). Runs on clones; never feeds REALISTIC.
   Verdicts   PASS / FAIL / UNSCORED per turn and side. UNSCORED (no judgeable dimension, incl. a null judge) is first-class:
              never PASS, FAIL, 0 or success. Quality % = PASS / (PASS + FAIL); UNSCORED is always reported beside it.
   HARD gates (D1) fail the suite: purity, determinism, no catalogue / state mutation, UNSCORED discipline, structural
              false-negative detector (+ its integrity), label integrity, independent code-in-note, evidence safety (no
              INFERRED->CONFIRMED, no UNKNOWN->CONTRADICTED without stated evidence), stock safety, LOCAL / no AI / no price in
              context, no leakage after SWITCH / across modes / after TTL, dev / held-out separation, no activation.
   QUALITY    context V2_WORSE, overall / per-act %, realistic vs oracle gap: REPORT + RATCHET against the INITIAL C3 BASELINE
              (first C3 values, 2026-10-10). The V2-2 exit bars (V2_WORSE 0 on context turns, >= 95% overall, >= 90% per act)
              are V2-2E switch-on blockers and are only reported here.
   HELDOUT    --holdout <path> (outside the repo; sha256 reported; never merged into dev; results labelled HELDOUT; no text
              written). Authored independently AFTER C3 is frozen (owner decision D2); this file contains none of it.
   ====================================================================================================================== */
const VC=require(path.join(ROOT,'js','vero-context.js')), VDI=require(path.join(ROOT,'js','vero-discourse.js'));
const crypto3=require('crypto'), T0C=1e12, DV=(JSON.parse(fs.readFileSync(path.join(ROOT,'data','settings.json'),'utf8')).app||{}).dataVersion||'dv';
const RESULT_ACTS={ SWITCH:1, REFINE:1, REPLACE:1, RELAX:1, EXCLUDE:1, ALTERNATIVE:1, COMPARE_METRIC:1 }, TARGET_ACTS={ SELECT:1, ATTRIBUTE_OF_FOCUS:1, STOCK_OF_CONTEXT:1 };
const CONF='CONFIRMED', INF='INFERRED', UNK='UNKNOWN', CONTRA='CONTRADICTED', RANK={ CONFIRMED:3, INFERRED:2, UNKNOWN:1 };
const insideRepo=p=>{ const a=path.resolve(p).toLowerCase(), r=path.resolve(ROOT).toLowerCase(); return a===r||a.startsWith(r+path.sep); };
const deepKeys=(x,acc)=>{ acc=acc||[]; if(Array.isArray(x)) x.forEach(v=>deepKeys(v,acc)); else if(x&&typeof x==='object') Object.keys(x).forEach(k=>{ acc.push(k); deepKeys(x[k],acc); }); return acc; };
const deepVals=(x,acc)=>{ acc=acc||[]; if(Array.isArray(x)) x.forEach(v=>deepVals(v,acc)); else if(x&&typeof x==='object') Object.keys(x).forEach(k=>deepVals(x[k],acc)); else if(x!=null) acc.push(String(x)); return acc; };
const sha=x=>crypto3.createHash('sha256').update(x).digest('hex');
const FACTS_BY=new Map(); const factsOf=cat=>{ if(cat===BASE_CAT) return FACTS; if(!FACTS_BY.has(cat)) FACTS_BY.set(cat,VF.build(cat.pub)); return FACTS_BY.get(cat); };
const graphOf=(code,cat)=>VP.graphFor(code,{ facts:factsOf(cat), products:cat.pub });
const CODESET=new Set(ALL.map(p=>String(p.item_code)));
const srpIn=(cat,c)=>{ const p=cat.pub.find(x=>String(x.item_code)===c); return p?Number(p.srp):null; };

/* ---------- C3.1 gold: expected set per turn (independent of the system under test) ---------- */
const CODE_BEARING=/^(first|firstIn|set|subsetNonEmpty|contains|ordered|prevShown|prevFocus|otherOfPair|editedFirst|anchorFirst|cheaperThanPrevFocus|history|subsetOrHonestEmpty)$/;
/* hctx: { prevShown, prevFocus, prevPrevShown, prevCodes, cat } of THIS side and run */
function expectedOf(t,h){ const g=t.gold, cat=h.cat;
  if(t.ho){ const e=t.ho.exp||[]; return { codes:e, check:t.ho.check, codeBearing:e.length>0 && !/^(empty|subsetOrEmpty|none|cands|candsNas|candsMouse|noCat5eClaim)$/.test(t.ho.check) }; }
  if(!g) return { codes:[], check:null, codeBearing:false };
  let codes=[];
  if(g.where) codes=derive(g,cat.pub); else if(g.codes) codes=g.codes.slice();
  else if(g.check==='prevShown') codes=h.prevShown[g.n-1]?[h.prevShown[g.n-1]]:[];
  else if(g.check==='prevFocus') codes=h.prevFocus.slice();
  else if(g.check==='otherOfPair') codes=h.prevPrevShown.length===2?h.prevPrevShown.filter(c=>!h.prevCodes.includes(c)):[];
  else if(g.check==='editedFirst') codes=cat.edited?[cat.edited]:[];
  else if(g.check==='cheaperThanPrevFocus'){ /* "a cheaper one like this": same category AND, when the focus states a wattage, the same wattage */
    const f=h.prevFocus[0], fp=f?srpIn(cat,f):null, fo=f?cat.pub.find(x=>String(x.item_code)===f):null, fw=fo?NUM.wattsName(fo):null;
    codes=fp==null||!fo?[]:cat.pub.filter(p=>p.category===fo.category && Number(p.srp)<fp && (fw==null || NUM.wattsName(p)===fw)).map(p=>String(p.item_code)); }
  return { codes, check:g.check, codeBearing:CODE_BEARING.test(g.check) && codes.length>0, fp:g.check==='cheaperThanPrevFocus'&&h.prevFocus[0]?srpIn(cat,h.prevFocus[0]):null }; }
function judgeC3(x,ans,cand,cat){ const has=c=>x.codes.includes(c), s=a=>JSON.stringify([...a].sort());
  switch(x.check){ case 'first': case 'prevShown': case 'editedFirst': return x.codes.length>0 && ans[0]===x.codes[0];
    case 'firstIn': case 'prevFocus': case 'otherOfPair': return x.codes.length>0 && has(ans[0]);
    case 'set': return x.codes.length>0 && s(ans)===s(x.codes); case 'subsetNonEmpty': return ans.length>0 && ans.every(has); case 'subsetOrEmpty': return ans.every(has);
    case 'contains': return x.codes.length>0 && x.codes.every(c=>ans.includes(c)); case 'empty': return ans.length===0; case 'none': return null;   /* gold names no products: the code dimension is not judged */
    case 'anchorFirst': return x.codes.length>0 && cand[0]===x.codes[0];
    case 'cheaperThanPrevFocus': return x.fp!=null && x.codes.length>0 && ans.length>0 && ans.every(has);   /* every offered alternative is a cheaper same-kind product (the focus itself is never one) */
    case 'subsetOrHonestEmpty': return x.codes.length?(ans.length>0 && ans.every(has)):ans.length===0; }
  throw new Error('unknown C3 gold check "'+x.check+'"'); }   /* an unknown judge never passes silently */
const verdictOf=dims=>{ dims.forEach(d=>{ if(d!==true && d!==false && d!==null) throw new Error('judge returned '+d); }); const j=dims.filter(d=>d!==null); return !j.length?'UNSCORED':(j.every(Boolean)?'PASS':'FAIL'); };
const categoryOf=(c,v)=>(c==='UNSCORED'||v==='UNSCORED')?'UNSCORED':(c==='PASS'?(v==='PASS'?'SAME_OK':'V2_WORSE'):(v==='PASS'?'V2_BETTER':'SAME_FAIL'));
/* v2 "presented answer": the result / target codes; closest / none / clarify present nothing as the answer (as in the single-turn table) */
const answerOf=o=>(!o.act||!(RESULT_ACTS[o.act]||TARGET_ACTS[o.act])||/^(none|none-confirmed|clarify|needs-context|not-found|closest)$/.test(String(o.kind||'')))?[]:(o.codes||[]);
function routeV2(exp,o){ const a=o.act, res=!!(RESULT_ACTS[a]||TARGET_ACTS[a]);
  if(exp==='LOCAL') return res||a==='NOT_LISTED'; if(exp==='CLARIFY') return a==='CLARIFY'; if(exp==='SMALLTALK') return a===null; if(exp==='NOT_CLARIFY_LOCAL_OR_AI') return a!=='CLARIFY';
  return null; }   /* WEB / AI / COACH / NOT_AI: the dormant chain has no AI route before V2-2E -> not judgeable (UNSCORED dimension) */
function expectOk(t,o,prev){ const e=t.expect; if(!e) return null; let ok=true;
  if(e.ctxStatus) ok=ok&&o.ctxStatus===e.ctxStatus; if(e.notesAny) ok=ok&&(o.notes||[]).some(n=>e.notesAny.includes(n.code));
  if(e.options) ok=ok&&Array.isArray(o.options)&&o.options.length>0; if(e.stock) ok=ok&&o.stock===true;
  if(e.fullReexec) ok=ok&&!!prev&&(o.codes||[]).some(c=>!prev.ctx.candidates.includes(c));
  return ok; }

/* ---------- C3.2 the chain runner (REALISTIC / ORACLE); every input state is checked for mutation ---------- */
/* a target act (SELECT / ATTRIBUTE / STOCK) leaves the displayed list unchanged and moves the focus: its gold replaces the focus only */
function oracleState(st,codes,check,cat,targetGold){ const s=JSON.parse(JSON.stringify(st));
  if(targetGold){ s.ctx.focus=codes.slice(0,6); return s; }
  const sh=codes.slice(0,12); s.ctx.shown=sh; s.ctx.candidates=codes.slice(0,50); s.ctx.focus=codes.length===1||/^(first|firstIn|editedFirst|anchorFirst)$/.test(check)?[codes[0]]:[];
  s.meta.shownFam=sh.map(c=>{ const g=graphOf(c,cat); return g?g.family:null; }); s.meta.resultState='ok'; return s; }
const isTargetGold=t=>!!(t && ((t.act && t.act.length && t.act.every(a=>TARGET_ACTS[a])) || (t.gold && /^(prevShown|prevFocus|otherOfPair)$/.test(t.gold.check))));
function runV2Chain(ch,mode,vc){ vc=vc||VC; let st=null, cat=BASE_CAT, clock=T0C, md='public', dv=DV; const H=[];
  ch.turns.forEach((t,i)=>{ clock+=t.dt!==undefined?t.dt:60000; if(t.mode) md=t.mode; if(t.dataVersion) dv=t.dataVersion;
    if(t.edit) cat=applyEdit(cat,t.edit,H[i-1].exp.codes);
    let anchored=null;
    if(mode==='ORACLE' && i>0){ const pe=H[i-1].exp; anchored=false;
      if(st && pe.codes.length && pe.codeBearing){ const o=oracleState(st,pe.codes,pe.check,cat,isTargetGold(H[i-1].t)); if(VC.validate(o).ok){ st=o; anchored=true; } } }
    const F=factsOf(cat), opts={ now:clock, mode:md, facts:F, products:cat.pub, allProducts:cat.all, dataVersion:dv };
    const tf=VP.turnFrame(VP.parse(t.q,{ facts:F, products:cat.pub })), prev=st, prevJ=JSON.stringify(prev);
    const r=vc.step(prev,tf,opts); const mutated=JSON.stringify(prev)!==prevJ; st=r.state;
    const hp=H[i-1]; const hctx={ cat, prevShown:prev?prev.ctx.shown:[], prevFocus:prev?prev.ctx.focus:[], prevPrevShown:hp&&hp.prev?hp.prev.ctx.shown:[], prevCodes:hp?hp.outcome.codes||[]:[] };
    H.push({ t, i, outcome:r.outcome, prev, next:st, tf, opts, cat, mutated, anchored, exp:expectedOf(t,hctx), modeChange:!!t.mode, ttl:t.dt!==undefined&&t.dt>VC.TTL_MS }); });
  return H; }
/* current side (already answered BEFORE v2 was loaded: CUR for HO / B144, CURCH for the dev chains) */
function currentOf(ch){ const H=[];
  ch.turns.forEach((t,i)=>{ const x=ch.kind==='DEV'?CURCH[t.key]:CUR[t.key]; const cat=x.cat||BASE_CAT, hp=H[i-1], hpp=H[i-2];
    const hctx={ cat, prevShown:hp?hp.codes:[], prevFocus:hp?hp.codes.slice(0,1):[], prevPrevShown:hpp?hpp.codes.slice(0,2):[], prevCodes:hp?hp.codes:[] };
    /* a current compare answer states its winner in the first sentence ("Mas mataas ang wattage ng 95405B."): that is its answer */
    let codes=x.r.codes||[]; if(x.r.type==='compare'){ const s1=String(x.r.note||'').split(/(?<=\.)\s|\n/)[0], win=codes.filter(c=>s1.indexOf(c)>=0); if(win.length===1) codes=win.concat(codes.filter(c=>c!==win[0])); }
    H.push({ r:x.r, a:x.a, cat, codes, exp:expectedOf(t,hctx), noClock:!!t.mode || (t.dt!==undefined && t.dt>VC.TTL_MS) }); });
  return H; }

/* ---------- C3.3 per-turn scoring ---------- */
const JUDGE3_ERR=[];
function scoreV2(rec,cls){ const t=rec.t, o=rec.outcome, ans=answerOf(o); let codeOk=null;
  try{ if(t.ho) codeOk=judgeHO(t.ho.exp,t.ho.check,ans,o.codes||[],ans.map(c=>nameOf(byCode[c]||{})),'');
       else if(t.gold) codeOk=judgeC3(rec.exp,ans,o.codes||[],rec.cat); }catch(e){ JUDGE3_ERR.push(t.key+': '+e.message); }
  if(t.ho && t.ho.check==='none') codeOk=null;   /* single-turn 'none' judges route / behaviour only: no code dimension */
  if(/^(WEB|AI)$/.test(t.exp)) codeOk=null;       /* CONTEXT_COMPAT: the AI / WEB candidate list does not exist in the dormant chain before V2-2E -> not judgeable */
  const dims=[codeOk,routeV2(t.exp,o),t.act?t.act.includes(o.act):null,expectOk(t,o,rec.prev)];
  return { verdict:verdictOf(dims), dims:{ code:codeOk, route:dims[1], act:dims[2], expect:dims[3] } }; }
function scoreCur(t,c,rowJudge){ let codeOk=null, routeOk=null;
  if(rowJudge){ codeOk=rowJudge.curOk===undefined?null:rowJudge.curOk; routeOk=rowJudge.curRouteOk===undefined?null:rowJudge.curRouteOk; if(t.ho&&t.ho.check==='none') codeOk=null; }
  else { const route=routeOf(c.a,c.r); routeOk=routeOkCur(t.exp,route,(c.r.plan||{}).intent,c.codes);
    try{ if(t.gold) codeOk=judgeC3(c.exp,/^(AI|WEB)$/.test(t.exp)&&(c.a.candidates||[]).length?c.a.candidates:c.codes,c.a.candidates||[],c.cat); }catch(e){ JUDGE3_ERR.push(t.key+' (current): '+e.message); } }
  if(c.noClock){ codeOk=null; routeOk=null; }   /* the current engine has no clock / mode input: a TTL or mode fixture cannot be judged on it */
  return { verdict:verdictOf([codeOk===undefined?null:codeOk,routeOk===undefined?null:routeOk]), dims:{ code:codeOk, route:routeOk } }; }
function failReason(rec,sc){ const o=rec.outcome, t=rec.t, why=[];
  if(sc.dims.act===false) why.push('act '+(t.act||[]).join('|')+' -> '+o.act+(o.reason?' ('+o.reason+')':''));
  if(sc.dims.code===false){ const got=o.codes||[], exp=rec.exp.codes, extra=got.filter(c=>!exp.includes(c)), miss=exp.filter(c=>!got.includes(c));
    why.push('codes: expected '+(rec.exp.check||'')+' ['+exp.length+'] '+exp.slice(0,6).join(',')+(exp.length>6?'…':'')+' got ['+got.length+'] '+got.slice(0,6).join(',')+(got.length>6?'…':'')+' ('+(o.kind||o.act)+')'+(extra.length?' extra '+extra.slice(0,6).join(','):'')+(miss.length?' missing '+miss.slice(0,6).join(','):'')); }
  if(sc.dims.route===false) why.push('route '+t.exp+' -> act '+o.act);
  if(sc.dims.expect===false) why.push('expect '+JSON.stringify(t.expect)+' got ctxStatus '+o.ctxStatus+' notes '+(o.notes||[]).map(n=>n.code).join(','));
  return why.join('; '); }
const ev0=(o)=>{ const c=(o.shown||[])[0]; return c&&o.evidence&&o.evidence[c]?c+' '+JSON.stringify(o.evidence[c]):null; };

/* ---------- C3.4 derived follow-up class (independent of the declared label) ---------- */
const derivedCls=(ch,t,i)=>{ if(ch.kind==='HO'){ const it=ITEMS.find(x=>x.set+':'+x.id===t.key); return it?it.cls:null; } if(ch.kind==='B144') return i===0?'STANDALONE':classOf(true,true,false,t.exp);
  return classOf(i>0,(ch.contextTurns||[]).includes(t.id),!!t.topicSwitch,t.exp); };

/* ---------- C3.5 run REALISTIC (twice, determinism), ORACLE (twice), score ---------- */
const purityStateBefore=JSON.stringify(ALL), FACTS_KEY0=FACTS.key;
const runAll=mode=>CHAINS.map(ch=>({ ch, H:runV2Chain(ch,mode) }));
const sigRuns=R=>sha(JSON.stringify(R.map(x=>x.H.map(h=>[h.t.key,h.outcome,h.next,h.anchored]))));
const REAL=runAll('REALISTIC'), REAL_SIG=sigRuns(REAL), ORAC=runAll('ORACLE'), ORAC_SIG=sigRuns(ORAC);
const REAL2_SIG=sigRuns(runAll('REALISTIC')), ORAC2_SIG=sigRuns(runAll('ORACLE'));
const C3ROWS=[], CLS_MISMATCH=[];
REAL.forEach(({ ch, H },ci)=>{ const CH=currentOf(ch), OH=ORAC[ci].H;
  H.forEach((rec,i)=>{ const t=rec.t; if(t.noScore) return; const dc=derivedCls(ch,t,i); if(t.cls!==dc) CLS_MISMATCH.push(t.key+' declared '+t.cls+' derived '+dc);
    if(ch.kind==='B144' && !t.declared) CLS_MISMATCH.push(t.key+' has no dev gold');
    const row=ROWS.find(r=>r.set+':'+r.id===t.key&&ch.kind==='HO'), real=scoreV2(rec,dc), orac=scoreV2(OH[i],dc), cur=scoreCur(t,CH[i],ch.kind==='HO'&&row?row.judge:null);
    C3ROWS.push({ chain:ch.id, set:ch.set, key:t.key, turn:i+1, q:t.q, cls:dc, expAct:t.act?t.act.map(a=>a===null?'NONE':a).join('|'):'n/a', expRoute:t.exp,
      realistic:{ verdict:real.verdict, dims:real.dims, act:rec.outcome.act, kind:rec.outcome.kind||null, reason:rec.outcome.reason||null, ctxStatus:rec.outcome.ctxStatus, shown:(rec.outcome.shown||[]).slice(0,6), evidence0:ev0(rec.outcome), why:real.verdict==='FAIL'?failReason(rec,real):'' },
      oracle:{ verdict:orac.verdict, anchored:OH[i].anchored, act:OH[i].outcome.act, why:orac.verdict==='FAIL'?failReason(OH[i],orac):'' },
      current:{ verdict:cur.verdict, dims:cur.dims, type:CH[i].r.type, codes:CH[i].codes.slice(0,6) },
      category:categoryOf(cur.verdict,real.verdict), expected:{ check:rec.exp.check, codes:rec.exp.codes.slice(0,8), n:rec.exp.codes.length } }); }); });

/* ---------- C3.6 generative matrix (DEV templates; act x family; data-derived gold) + performance chains ---------- */
const MX=DEV.matrixDev; if(!MX || MX.group!=='DEV') throw new Error('matrixDev must be the DEV group');
const MCH=[], PCH=[];
MX.families.forEach(f=>{ const base={ q:f.q, cls:'STANDALONE', exp:'LOCAL', act:['SWITCH'], gold:{ where:f.where, check:'subsetNonEmpty' } };
  MX.followUps.forEach(g=>g.qs.forEach(([q,v])=>{ let gold;
    if(g.kind==='colour') gold={ where:f.where.concat([{ colorRe:v }]), check:g.check }; else if(g.kind==='notColour') gold={ where:f.where.concat([{ colorNotRe:v }]), check:g.check };
    else if(g.kind==='price') gold={ where:f.where, pick:g.pick, check:g.check }; else if(g.kind==='ordinal') gold={ check:'prevShown', n:v };
    else if(g.kind==='stock') gold={ where:f.where, check:g.check }; else if(g.kind==='topic') gold={ where:g.where, check:g.check }; else throw new Error('matrix kind '+g.kind);
    const id='M:'+f.id+':'+q, fu={ q, cls:g.topicSwitch?'TOPIC_SWITCH':'CONTEXT', exp:'LOCAL', act:[g.act], gold, topicSwitch:!!g.topicSwitch, expect:g.expect };
    const turns=[base,fu].concat(g.kind==='ordinal'?[{ q:MX.afterSelect.q, cls:'CONTEXT', exp:'LOCAL', act:[MX.afterSelect.act], gold:{ check:MX.afterSelect.check } }]:[]);
    MCH.push({ id, kind:'MATRIX', family:f.id, mact:g.act, turns:turns.map((t,i)=>Object.assign({ key:id+'#'+(i+1), id:id+'#'+(i+1) },t)) });
    MX.perfSecond.forEach(q2=>PCH.push({ id:'P:'+f.id+':'+q+':'+q2, kind:'PERF', turns:[base,{ q, cls:'CONTEXT', exp:'LOCAL' },{ q:q2, cls:'CONTEXT', exp:'LOCAL' }].map((t,i)=>Object.assign({ key:'P#'+i },t)) })); })); });
const MREAL=MCH.map(ch=>({ ch, H:runV2Chain(ch,'REALISTIC') })), MORAC=MCH.map(ch=>({ ch, H:runV2Chain(ch,'ORACLE') }));
const MREAL2_SIG=sigRuns(MCH.map(ch=>({ ch, H:runV2Chain(ch,'REALISTIC') })));
const MROWS=[]; MREAL.forEach(({ ch, H },ci)=>H.forEach((rec,i)=>{ if(!i) return; const r=scoreV2(rec,rec.t.cls), o=scoreV2(MORAC[ci].H[i],rec.t.cls);
  MROWS.push({ chain:ch.id, family:ch.family, turn:i+1, q:rec.t.q, act:rec.t.act[0], realistic:r.verdict, oracle:o.verdict, got:rec.outcome.act, kind:rec.outcome.kind||null, why:r.verdict==='FAIL'?failReason(rec,r):'' }); }));
/* performance (Node proxies, design §15): >= 400 generated chains, warm-up + 3 reps; p95 of VeroDiscourse.resolve alone and of the
   whole v2 turn (parse + turnFrame + VeroContext.step); the median of the 3 reps' p95 is reported */
const APP=VC.applicability({ now:T0C, mode:'public', facts:FACTS, products:PUB, allProducts:ALL, dataVersion:DV });
function perfRep(){ const disc=[], tot=[], prs=[], stp=[], sig=[];
  PCH.forEach(ch=>{ let st=null, clock=T0C;
    ch.turns.forEach(t=>{ clock+=60000; const opts={ now:clock, mode:'public', facts:FACTS, products:PUB, allProducts:ALL, dataVersion:DV };
      const a=process.hrtime.bigint(); const tf=VP.turnFrame(VP.parse(t.q,{ facts:FACTS, products:PUB })); const m=process.hrtime.bigint(); const r=VC.step(st,tf,opts); const z=process.hrtime.bigint();
      tot.push(Number(z-a)/1e6); prs.push(Number(m-a)/1e6); stp.push(Number(z-m)/1e6);
      const b=process.hrtime.bigint(); VDI.resolve(tf,st?st.ctx:null,{ now:clock, mode:'public', ttlMs:VC.TTL_MS, applies:APP.applies, families:APP.families, qualify:APP.qualify }); disc.push(Number(process.hrtime.bigint()-b)/1e6);
      sig.push(r.outcome.act+':'+(r.outcome.codes||[]).join(',')); st=r.state; }); });
  const p95=a=>{ const s=a.slice().sort((x,y)=>x-y); return s[Math.min(s.length-1,Math.floor(s.length*0.95))]; };
  return { disc:p95(disc), tot:p95(tot), parse:p95(prs), step:p95(stp), sig:sha(sig.join('|')) }; }
perfRep(); const PR=[perfRep(),perfRep(),perfRep()], med=a=>a.slice().sort((x,y)=>x-y)[1], r3=x=>Math.round(x*1000)/1000;
const PERF3={ chains:PCH.length, turns:PCH.length*3, discourseP95Ms:r3(med(PR.map(x=>x.disc))), totalP95Ms:r3(med(PR.map(x=>x.tot))), parseTurnFrameP95Ms:r3(med(PR.map(x=>x.parse))), contextStepP95Ms:r3(med(PR.map(x=>x.step))),
  reps:PR.map(x=>[r3(x.disc),r3(x.tot)]), targets:{ discourseP95Ms:2, totalP95Ms:4, note:'plan §10.11 exit targets (V2-2E); discourse gated, total reported + regression guard' } };
const PERF_REC=PCH.map(ch=>({ ch, H:runV2Chain(ch,'REALISTIC') }));

/* ---------- C3.7 HARD GATES (D1) over every v2 turn: REALISTIC, ORACLE, MATRIX (both), PERF ---------- */
const FN_RE=/\bwala(?:ng)?\b|we don.?t have|can.?t find|hindi ko makita|(^|\n)\s*0\s*[—–-]/i;   /* shared false-negative wording (current side text) */
/* structural false negative (v2 has no rendered text before V2-2E): nothing / NOT_LISTED while the independently derived set is non-empty */
function structuralFalseNegative(o,exp){ if(!exp||!exp.codeBearing||!exp.codes.length) return false; return o.act==='NOT_LISTED' || (!!RESULT_ACTS[o.act] && !(o.codes||[]).length) || /^(none|not-found)$/.test(String(o.kind||'')); }
/* the no-live-inventory caveat ("Wala akong live inventory data …") is a stock disclaimer, not a product negative: its sentence is skipped */
const textFalseNegative=(txt,exp)=>!!(exp&&exp.codeBearing&&exp.codes.length) && FN_RE.test(String(txt||'').split(/(?<=[.!?])\s+|\n/).filter(s=>!/live inventory|inventory data|current stock/i.test(s)).join('\n'));
const affirmed=fr=>(fr&&fr.constraints||[]).filter(c=>c.polarity===true);
const slotCount=(fr,slot)=>(fr&&fr.constraints||[]).filter(c=>c.slot===slot).length;
const NUMATTR={ watts:g=>g.watts, mah:g=>g.mah, lengthM:g=>g.lengthM, gbps:g=>g.gbps!=null?g.gbps:g.ethGbps };
const QTY_KEY=/^(qty|quantity|instock|in_stock|onhand|on_hand|stockqty|stockcount|stockstate|available|availability|units)$/i, PRICE_KEY=/^(srp|dp|dp_volume|dpvolume|moq|special_dp|dealer_price|price_value)$/i, AI_KEY=/^(route|airoute|aicandidates|candidatesai|web|aianswer)$/i;
const C3G={ falseNeg:[], label:[], codeInNote:[], evidence:[], stock:[], local:[], leak:[], mode:[], mutation:[] };
function gateTurn(run,rec){ const o=rec.outcome, t=rec.t, tag=run+' '+(t.key||t.q)+' "'+t.q+'"', fr=rec.next&&rec.next.ctx&&rec.next.ctx.frame;
  if(rec.mutated) C3G.mutation.push(tag+' :: VeroContext mutated its input state');
  if(structuralFalseNegative(o,rec.exp)) C3G.falseNeg.push(tag+' :: '+o.act+'/'+(o.kind||'')+' with '+rec.exp.codes.length+' derived');
  /* label integrity: an 'exact' result never lists a code that is not CONFIRMED on an affirmed constraint; an 'inferred' result keeps
     its exactCodes CONFIRMED and never lists a CONTRADICTED code (target acts: missing evidence is UNKNOWN, NEW-C2-C, not checked) */
  if(RESULT_ACTS[o.act] && fr && /^(exact|inferred)$/.test(String(o.kind||''))){ const aff=affirmed(fr).filter(c=>slotCount(fr,c.slot)===1);
    (o.shown||[]).forEach(code=>{ const e=(o.evidence||{})[code]||{}; aff.forEach(c=>{ const s=e[c.slot]; if(s===undefined) return;
      const inExact=o.kind==='exact'||(o.exactCodes||[]).includes(code);
      if(inExact && s!==CONF) C3G.label.push(tag+' :: '+o.kind+' lists '+code+' with '+c.slot+'='+s);
      if(!inExact && s===CONTRA) C3G.label.push(tag+' :: inferred lists '+code+' CONTRADICTED on '+c.slot); }); }); }
  /* target acts (SELECT / ATTRIBUTE / STOCK) never present a row CONTRADICTED on an affirmed constraint (VERO review 2026-10-10);
     a MISSING or UNKNOWN slot is not checked (NEW-C2-C: absent evidence is UNKNOWN, never negative) */
  if(TARGET_ACTS[o.act] && fr){ const aff=affirmed(fr).filter(c=>slotCount(fr,c.slot)===1);
    (o.shown||[]).forEach(code=>{ const e=(o.evidence||{})[code]||{}; aff.forEach(c=>{ if(e[c.slot]===CONTRA) C3G.label.push(tag+' :: '+o.act+' presents '+code+' CONTRADICTED on '+c.slot); }); }); }
  /* independent code-in-note extractor: every catalogue code anywhere in notes / options / noOptions / reason / target must be
     shown / derived / in the prior context, and belong to the merged or the prior context family */
  { const prev=rec.prev&&rec.prev.ctx, scan=deepVals([o.notes,o.options,o.noOptions,o.reason,o.target]), found=[...new Set(scan.filter(v=>CODESET.has(v)))];
    const allowed=new Set([].concat(o.codes||[],rec.exp.codes||[],prev?prev.shown:[],prev?prev.candidates:[],prev?prev.focus:[],prev?prev.comparison:[]));
    const fams=[rec.next&&rec.next.meta.family,rec.prev&&rec.prev.meta.family].filter(Boolean);
    found.forEach(c=>{ if(!allowed.has(c)) C3G.codeInNote.push(tag+' :: '+c+' named but never shown / derived');
      const g=graphOf(c,rec.cat); if(g && fams.length && !fams.includes(g.family)) C3G.codeInNote.push(tag+' :: '+c+' ('+g.family+') outside '+fams.join('/')); }); }
  /* evidence safety: never stronger than the governed graph supports, and never stronger than the executor's own evidence */
  if(fr && o.evidence){ const ex2=RESULT_ACTS[o.act]?VP.executeFrame(fr,rec.opts):null;
    Object.keys(o.evidence).forEach(code=>{ const e=o.evidence[code]||{}, g=graphOf(code,rec.cat); if(!g) return;
      Object.keys(e).forEach(slot=>{ const s=e[slot], c=(fr.constraints||[]).find(x=>x.slot===slot); if(!c || slotCount(fr,slot)!==1) return;
        const bad=m=>C3G.evidence.push(tag+' :: '+code+' '+slot+' '+s+' '+m);
        if(c.kind==='num'){ const f=NUMATTR[String(slot).split(':')[1]]; if(f && (s===CONF||s===CONTRA) && f(g)==null) bad('without a stated value'); if(s===INF) bad('(no governed numeric inference)'); }
        else if(c.kind==='colour'){ if((s===CONF||s===CONTRA) && !g.color) bad('without a stated colour'); }
        else if(c.kind==='connector' && c.polarity===true && c.value && c.value.id){ const k=c.value.id, stated=(g.conns.all||[]).includes(k)||!!(g.pair&&((g.pair.from||[]).includes(k)||(g.pair.to||[]).includes(k)));
          if(s===CONTRA && !stated) bad('= absence turned into contradiction'); }
        else if(c.kind==='feature'){ const id=String(slot).split(':')[1], fs0=g.feats&&g.feats[id]; if(s===CONF && !(fs0&&fs0.state===CONF)) bad('without a stated feature'); if(s===CONTRA && c.polarity===true && !fs0) bad('= absence turned into contradiction'); }
        if(ex2 && ex2.evidence && ex2.evidence[code] && ex2.evidence[code][slot]!==undefined){ const x=ex2.evidence[code][slot];
          if(s===CONTRA && x!==CONTRA) bad('but the executor says '+x+' (UNKNOWN->CONTRADICTED)'); else if(s!==CONTRA && x!==CONTRA && RANK[s]>RANK[x]) bad('but the executor says '+x+' (promotion)'); } }); }); }
  /* stock: no quantity / stock state anywhere; a stock act carries the stock flag (the composer adds the no-live-inventory caveat) */
  { const ks=deepKeys([o,rec.next]).filter(k=>QTY_KEY.test(k)); if(ks.length) C3G.stock.push(tag+' :: stock / quantity key '+ks.join(','));
    if(o.act==='STOCK_OF_CONTEXT' && o.stock!==true) C3G.stock.push(tag+' :: STOCK_OF_CONTEXT without the stock flag'); }
  /* LOCAL / no AI / no price in any context-bearing output */
  { const ks=deepKeys([o,rec.next]); const ai=ks.filter(k=>AI_KEY.test(k)), pr=ks.filter(k=>PRICE_KEY.test(k)); if(ai.length||pr.length) C3G.local.push(tag+' :: '+ai.concat(pr).join(',')); }
  /* leakage: an explicit topic switch never reads or inherits the old context */
  if(t.topicSwitch){ const tfs=new Set((rec.tf.constraints||[]).map(c=>c.slot));
    if(TARGET_ACTS[o.act]) C3G.leak.push(tag+' :: topic switch answered from the old context ('+o.act+')');
    if(RESULT_ACTS[o.act]){ if(o.act!=='SWITCH') C3G.leak.push(tag+' :: topic switch executed as '+o.act); const extra=(fr.constraints||[]).map(c=>c.slot).filter(s=>!tfs.has(s)); if(extra.length) C3G.leak.push(tag+' :: inherited '+extra.join(',')); } }
  /* mode / TTL: the dropped context is never read */
  if(rec.modeChange||rec.ttl){ const want=rec.modeChange?'modeChanged':'expired'; if(o.ctxStatus!==want) C3G.mode.push(tag+' :: ctxStatus '+o.ctxStatus+' (want '+want+')');
    if(TARGET_ACTS[o.act]) C3G.mode.push(tag+' :: answered from the dropped context');
    if(RESULT_ACTS[o.act]){ const tfs=new Set((rec.tf.constraints||[]).map(c=>c.slot)), extra=(fr.constraints||[]).map(c=>c.slot).filter(s=>!tfs.has(s)); if(extra.length) C3G.mode.push(tag+' :: inherited across '+want+': '+extra.join(',')); } } }
REAL.forEach(x=>x.H.forEach(r=>gateTurn('REALISTIC',r))); ORAC.forEach(x=>x.H.forEach(r=>gateTurn('ORACLE',r)));
MREAL.forEach(x=>x.H.forEach(r=>gateTurn('MATRIX',r))); MORAC.forEach(x=>x.H.forEach(r=>gateTurn('MATRIX-ORACLE',r))); PERF_REC.forEach(x=>x.H.forEach(r=>gateTurn('PERF',r)));
const allV2Turns=[REAL,ORAC,MREAL,MORAC,PERF_REC].reduce((a,R)=>a+R.reduce((b,x)=>b+x.H.length,0),0);

/* current side (live engine, report only): text false negatives, code-in-note, context-turn AI routing */
const CURREP={ falseNeg:[], codeInNote:[], aiOnContext:[] };
REAL.forEach(({ ch })=>{ const CH=currentOf(ch); ch.turns.forEach((t,i)=>{ if(t.noScore) return; const c=CH[i], txt=[c.r.note,c.r.echo,c.r.stockNote].filter(Boolean).join('\n');
  if(textFalseNegative(txt,c.exp)) CURREP.falseNeg.push(t.key+' "'+t.q+'"');
  const toks=[...new Set((String(c.r.note||'').match(/[A-Za-z0-9]+/g)||[]).filter(x=>CODESET.has(x)))], allow=new Set([].concat(c.codes,(CH[i-1]||{codes:[]}).codes,c.exp.codes));
  toks.forEach(x=>{ if(!allow.has(x)) CURREP.codeInNote.push(t.key+' '+x); });
  if(i>0 && /^CONTEXT$/.test(derivedCls(ch,t,i)) && (c.a.route!=='local'||(c.a.candidates||[]).length)) CURREP.aiOnContext.push(t.key+' '+c.a.route); }); });

chk('C3.H01 purity: current engine answers identical before / after the whole C3 run ('+ITEMS.length+' items + '+Object.keys(CURCH).length+' dev-chain turns); products.json objects and the facts key unchanged',
  sigOf(runCurrent())===BEFORE && sigCh(runCurrentChains())===BEFORE_CH && JSON.stringify(ALL)===purityStateBefore && JSON.stringify(ALL)===productsBefore && FACTS.key===FACTS_KEY0);
chk('C3.H02 determinism: REALISTIC, ORACLE and MATRIX runs byte-identical on repeat; the 3 performance reps give identical outcomes', REAL_SIG===REAL2_SIG && ORAC_SIG===ORAC2_SIG && sigRuns(MREAL)===MREAL2_SIG && PR.every(x=>x.sig===PR[0].sig), JSON.stringify([REAL_SIG.slice(0,8),REAL2_SIG.slice(0,8),ORAC_SIG.slice(0,8),ORAC2_SIG.slice(0,8)]));
chk('C3.H03 no state mutation: VeroContext.step never mutated an input state ('+allV2Turns+' v2 turns)', !C3G.mutation.length, C3G.mutation.slice(0,4));
{ let selfOk=true; try{ selfOk=verdictOf([null,null])==='UNSCORED' && verdictOf([true,null])==='PASS' && verdictOf([false,true])==='FAIL' && categoryOf('UNSCORED','PASS')==='UNSCORED' && categoryOf('PASS','UNSCORED')==='UNSCORED'; try{ verdictOf([undefined]); selfOk=false; }catch(e){} try{ judgeC3({ check:'nope', codes:[] },[],[],BASE_CAT); selfOk=false; }catch(e){} }catch(e){ selfOk=false; }
  const bad=C3ROWS.filter(r=>![r.realistic.verdict,r.oracle.verdict,r.current.verdict].every(v=>/^(PASS|FAIL|UNSCORED)$/.test(v)) || (r.category==='UNSCORED')!==(r.current.verdict==='UNSCORED'||r.realistic.verdict==='UNSCORED'));
  chk('C3.H04 UNSCORED discipline: null judge = UNSCORED (never PASS / FAIL / 0); every gold check has a judge (unknown names throw); categories never hide UNSCORED', selfOk && !bad.length && !JUDGE3_ERR.length, JSON.stringify([selfOk,bad.slice(0,3).map(r=>r.key),JUDGE3_ERR.slice(0,4)])); }
{ /* detector integrity: fixtures from plan §2 (F, S1, P1, H2, H3 must be caught; P2 honest negatives must not) + structural cases */
  const ne={ codeBearing:true, codes:['x'] }, em={ codeBearing:false, codes:[] };
  const pos=["I can't find 'gen' in the current pricelist","Walang in na naka-lista sa pricelist","0 — Wala tayong product na ganyan","0 — Wala tayong product…","0 — We don't have a product with that"].every(s=>textFalseNegative(s,ne));
  const neg=!textFalseNegative('Wala tayong keyboard sa current UGREEN pricelist',em) && !textFalseNegative("We don't have any keyboard",em) && !textFalseNegative('Here are 6 chargers',ne)
    && !textFalseNegative('6 65W chargers. Wala akong live inventory data kaya hindi ko ma-confirm ang current stock.',ne) && textFalseNegative('Wala tayong mas mura. Wala akong live inventory data.',ne);
  const st=structuralFalseNegative({ act:'NOT_LISTED' },ne) && structuralFalseNegative({ act:'REFINE', codes:[] },ne) && structuralFalseNegative({ act:'SWITCH', codes:[], kind:'none' },ne)
    && !structuralFalseNegative({ act:'CLARIFY', codes:[] },ne) && !structuralFalseNegative({ act:'NOT_LISTED' },em) && !structuralFalseNegative({ act:'REFINE', codes:['1'] },ne);
  const indep=!/\bVP\.|\bVC\.|VeroParse|VeroContext/.test(structuralFalseNegative.toString()+textFalseNegative.toString());
  chk('C3.H05 false-negative detector integrity: catches plan §2 F / S1 / P1 / H2 / H3 wording, keeps P2 honest negatives, structural cases correct, independent of the system under test', pos && neg && st && indep);
  chk('C3.H06 zero v2 structural false negatives (NOT_LISTED / nothing while the derived set is non-empty) over '+allV2Turns+' v2 turns', !C3G.falseNeg.length, C3G.falseNeg.slice(0,6)); }
chk('C3.H07 label integrity: exact / inferred results list only CONFIRMED rows (inferred: exactCodes CONFIRMED, no CONTRADICTED row)', !C3G.label.length, C3G.label.slice(0,6));
chk('C3.H08 independent code-in-note: every catalogue code in notes / options / reasons is shown / derived / in the prior context and in the merged or prior family', !C3G.codeInNote.length, C3G.codeInNote.slice(0,6));
chk('C3.H09 evidence safety: no INFERRED->CONFIRMED promotion, no UNKNOWN->CONTRADICTED, no evidence without a stated graph value (missing slots = UNKNOWN, NEW-C2-C)', !C3G.evidence.length, C3G.evidence.slice(0,6));
chk('C3.H10 stock safety: no quantity / stock state in any outcome or stored state; every STOCK_OF_CONTEXT carries the stock flag', !C3G.stock.length, C3G.stock.slice(0,6));
chk('C3.H11 LOCAL only: no AI route / candidate key and no price / MOQ / dealer key in any outcome or stored context', !C3G.local.length, C3G.local.slice(0,6));
chk('C3.H12 no leakage after an explicit topic SWITCH (no old-context target, no inherited slot)', !C3G.leak.length, C3G.leak.slice(0,6));
chk('C3.H13 no cross-mode / TTL leakage: a dropped context reports modeChanged / expired and is never read', !C3G.mode.length && C3ROWS.some(r=>r.realistic.ctxStatus==='modeChanged') && C3ROWS.some(r=>r.realistic.ctxStatus==='expired'), C3G.mode.slice(0,6));
chk('C3.H14 taxonomy: every declared follow-up class equals the independently derived class; all 7 B144 follow-ups have dev gold', !CLS_MISMATCH.length && DEV.sets && Object.keys(DEV.b144FollowUps||{}).length===7, CLS_MISMATCH.slice(0,6));
{ /* dev / held-out separation + the C3 VeroContext leak / isolation check (M12.3 / S6 equivalent; those files are out of C3 scope) */
  const prov=DEV.provenance||{}, provOk=['HO1','HO2','HO3','b144FollowUps','chains','matrixDev'].every(k=>/^dev:/.test(String(prov[k]||''))) && MX.group==='DEV';
  const noHeld=!deepKeys(DEV).some(k=>/held.?out|holdout/i.test(k));
  const DQ=[].concat(DEV.chains.reduce((a,c)=>a.concat(c.turns.map(t=>t.q)),[]),MX.families.map(f=>f.q),MX.followUps.reduce((a,g)=>a.concat(g.qs.map(x=>x[0])),[]),[MX.afterSelect.q],MX.perfSecond).map(q=>q.toLowerCase().trim()).filter(q=>q.length>10);
  /* executable code only (block / line comments stripped): a comment quoting a plan example is documentation; it is reported, not hidden */
  const RAWSRC=['vero-context','vero-parse','vero-ontology','vero-discourse'].map(f=>fs.readFileSync(path.join(ROOT,'js',f+'.js'),'utf8').toLowerCase()).join('\n');
  const SRC=RAWSRC.replace(/\/\*[\s\S]*?\*\//g,' ').replace(/^\s*\/\/.*$/gm,' ');
  /* a phrase that occurs in code ONLY as an exact quoted vocabulary literal ('the other one', 'mas mabilis') is an ontology word, not
     tuned question text; any other occurrence (inside a longer string, a regex, a special case) fails */
  const occ=(src,q)=>src.split(q).length-1, litOcc=(src,q)=>occ(src,"'"+q+"'")+occ(src,'"'+q+'"');
  const CATN=new Set(ALL.map(p=>String(p.category||'').toLowerCase().trim()));   /* a phrase equal to a catalogue category name is data vocabulary ("card reader") */
  const isVocab=q=>litOcc(SRC,q)===occ(SRC,q) || CATN.has(q);
  const hits=[...new Set(DQ)].filter(q=>SRC.indexOf(q)>=0), vocab=hits.filter(isVocab), leak=hits.filter(q=>!isVocab(q));
  const inComments=[...new Set(DQ)].filter(q=>SRC.indexOf(q)<0 && RAWSRC.indexOf(q)>=0);
  if(inComments.length||vocab.length) console.log('C3 OBSERVATION (no tuned text): dev phrasings quoted only in v2 source comments: '+JSON.stringify(inComments)+'; exact ontology vocabulary literals: '+JSON.stringify(vocab));
  const ctxSrc=fs.readFileSync(path.join(ROOT,'js','vero-context.js'),'utf8'), codeLeak=(ctxSrc.match(/['"]([A-Za-z0-9]{4,8})['"]/g)||[]).map(x=>x.slice(1,-1)).filter(x=>CODESET.has(x));
  const outs=['--json','--md'].map(arg).filter(Boolean), outBad=outs.filter(insideRepo);
  chk('C3.H15 dev / held-out separation: devsets provenance all DEV, no held-out key or content in the repo, no dev chain / matrix text ('+new Set(DQ).size+') or catalogue code inside the v2 sources (incl. vero-context.js), report outputs outside the repo',
    provOk && noHeld && !leak.length && !codeLeak.length && !outBad.length, JSON.stringify([provOk,noHeld,leak.slice(0,3),codeLeak.slice(0,3),outBad])); }
chk('C3.H16 no production activation: index.html and the 7 load-order files reference no v2 module (S03 tokens incl. vero-context / VeroContext); the live engine answers are unchanged by loading it (C3.H01)', !GM.err && !s03hits.length && G23T.includes('VeroContext') && G23T.includes('vero-context'));

/* ---------- C3.M mutation kills: every hard gate catches a deliberately broken copy of vero-context.js (vm sandbox; the real file
   is only read) and a synthetic violating record; a gate that catches nothing is not a gate ---------- */
{ const vm=require('vm'), SRC0=fs.readFileSync(path.join(ROOT,'js','vero-context.js'),'utf8');
  const foreign=PUB.map(p=>String(p.item_code)).find(c=>{ const g=graphOf(c,BASE_CAT); return g && g.family==='mouse'; });
  const load=src=>{ const sb={ window:{ VeroDiscourse:VDI, VeroParse:VP, VeroOntology:O2 }, module:{ exports:{} } }; vm.runInNewContext(src,sb); return sb.window.VeroContext; };
  const swap=(a,b)=>s=>{ if(s.split(a).length!==2) throw new Error('mutant anchor: '+a.slice(0,50)); return s.replace(a,()=>b); };
  const MUT=[
    ['evidence','INFERRED / UNKNOWN promoted to CONFIRMED',swap("codes.forEach(function(c){ if(ex.evidence && ex.evidence[c]) out.evidence[c]=clone(ex.evidence[c]); });","codes.forEach(function(c){ if(ex.evidence && ex.evidence[c]){ var e=clone(ex.evidence[c]); Object.keys(e).forEach(function(k){ if(e[k]==='INFERRED'||e[k]==='UNKNOWN') e[k]='CONFIRMED'; }); out.evidence[c]=e; } });")],
    ['evidence','UNKNOWN turned into CONTRADICTED',swap("codes.forEach(function(c){ if(ex.evidence && ex.evidence[c]) out.evidence[c]=clone(ex.evidence[c]); });","codes.forEach(function(c){ if(ex.evidence && ex.evidence[c]){ var e=clone(ex.evidence[c]); Object.keys(e).forEach(function(k){ if(e[k]==='UNKNOWN') e[k]='CONTRADICTED'; }); out.evidence[c]=e; } });")],
    ['falseNeg','result set emptied',swap("out.codes=codes; out.shown=codes.slice(0,shownN); out.kind=ex.kind;","out.codes=[]; out.shown=[]; out.kind=ex.kind;")],
    ['label','closest / partial labelled exact',swap("out.codes=codes; out.shown=codes.slice(0,shownN); out.kind=ex.kind;","out.codes=codes; out.shown=codes.slice(0,shownN); out.kind=(ex.kind==='closest'||ex.kind==='partial'||ex.kind==='inferred')?'exact':ex.kind;")],
    ['mode','TTL not enforced',swap("else if(age>ttl){","else if(false){")],
    ['mode','mode change not enforced',swap("else if(state.ctx.mode!==opts.mode){","else if(false){")],
    ['stock','stock flag dropped',swap("if(res.delta.stock) out.stock=true;","")],
    ['stock','quantity reported',swap("if(res.delta.stock) out.stock=true;","if(res.delta.stock){ out.stock=true; out.qty=5; }")],
    ['local','price written into the outcome',swap("out.codes=codes; out.shown=codes.slice(0,shownN); out.kind=ex.kind;","out.codes=codes; out.shown=codes.slice(0,shownN); out.kind=ex.kind; out.srp=1;")],
    ['codeInNote','foreign code named in a note',swap("if(dataChanged) notes.push({ code:'reexecuted' });","notes.push({ code:'x', codes:['"+foreign+"'] }); if(dataChanged) notes.push({ code:'reexecuted' });")],
    ['leak','topic switch resolved as a context refinement',swap("var res=D.resolve(frame,ctx,dopts);","var res=D.resolve(ctx?Object.assign({},frame,{ subject:null, flags:Object.assign({},frame.flags,{ needsContext:true, elliptical:true }) }):frame,ctx,dopts);")],
    ['mutation','input state mutated',swap("    opts=opts||{};","    opts=opts||{}; if(stateIn && stateIn.ctx) stateIn.ctx.at=stateIn.ctx.at+0.5;")] ];
  const survived=[], save=JSON.parse(JSON.stringify(C3G));
  MUT.forEach(([gate,name,fn])=>{ Object.keys(C3G).forEach(k=>C3G[k]=[]); let vc;
    try{ vc=load(fn(SRC0)); }catch(e){ survived.push(name+' (load: '+e.message+')'); return; }
    CHAINS.filter(c=>c.kind==='DEV').forEach(ch=>{ try{ runV2Chain(ch,'REALISTIC',vc).forEach(r=>gateTurn('MUTANT',r)); }catch(e){ /* a crashing mutant is detected by the run itself */ C3G[gate].push('crash'); } });
    if(!C3G[gate].length) survived.push(name+' -> '+gate); });
  Object.keys(C3G).forEach(k=>C3G[k]=save[k]);
  chk('C3.M1 mutation kills: '+(MUT.length-survived.length)+'/'+MUT.length+' broken vero-context.js copies are caught by the intended hard gate (evidence, false negative, label, TTL / mode, stock, LOCAL, code-in-note, leakage, state mutation)', !survived.length, survived); }

/* ---------- C3.8 quality: REPORT + RATCHET (INITIAL C3 BASELINE, 2026-10-10) ---------- */
const FOLLOW=/^(CONTEXT|CONTEXT_COMPAT|TOPIC_SWITCH|STANDALONE_IN_SEQ)$/;
const tally=(rows,f)=>{ const o={ PASS:0, FAIL:0, UNSCORED:0 }; rows.forEach(r=>o[f(r)]++); o.qualityPct=o.PASS+o.FAIL?Math.round(o.PASS/(o.PASS+o.FAIL)*1000)/10:null; return o; };
const CTXR=C3ROWS.filter(r=>FOLLOW.test(r.cls));
const cnt=c=>CTXR.filter(r=>r.category===c).length;
const byAct=(rows,actOf,vf)=>{ const o={}; rows.forEach(r=>{ const a=actOf(r); (o[a]=o[a]||[]).push(r); }); const out={}; Object.keys(o).sort().forEach(a=>out[a]=tally(o[a],vf)); return out; };
const Q={ contextTurns:CTXR.length, byClass:['CONTEXT','CONTEXT_COMPAT','TOPIC_SWITCH','STANDALONE_IN_SEQ'].reduce((o,c)=>(o[c]=CTXR.filter(r=>r.cls===c).length,o),{}),
  realistic:tally(CTXR,r=>r.realistic.verdict), oracle:tally(CTXR,r=>r.oracle.verdict), current:tally(CTXR,r=>r.current.verdict),
  categories:{ SAME_OK:cnt('SAME_OK'), SAME_FAIL:cnt('SAME_FAIL'), V2_BETTER:cnt('V2_BETTER'), V2_WORSE:cnt('V2_WORSE'), UNSCORED:cnt('UNSCORED') },
  allChainTurns:{ realistic:tally(C3ROWS,r=>r.realistic.verdict), oracle:tally(C3ROWS,r=>r.oracle.verdict) },
  perActRealistic:byAct(CTXR.filter(r=>r.expAct!=='n/a'),r=>r.expAct.split('|')[0],r=>r.realistic.verdict), perActOracle:byAct(CTXR.filter(r=>r.expAct!=='n/a'),r=>r.expAct.split('|')[0],r=>r.oracle.verdict),
  matrix:{ chains:MCH.length, turns:MROWS.length, realistic:tally(MROWS,r=>r.realistic), oracle:tally(MROWS,r=>r.oracle), perActRealistic:byAct(MROWS,r=>r.act,r=>r.realistic), perActOracle:byAct(MROWS,r=>r.act,r=>r.oracle) },
  oracleAnchored:C3ROWS.filter(r=>r.oracle.anchored===true).length, oracleUnanchored:C3ROWS.filter(r=>r.oracle.anchored===false).length,
  attribution:{ propagated:CTXR.filter(r=>r.realistic.verdict==='FAIL'&&r.oracle.verdict==='PASS').length, turnLocal:CTXR.filter(r=>r.realistic.verdict==='FAIL'&&r.oracle.verdict==='FAIL').length,
    oracleOnlyFail:CTXR.filter(r=>r.realistic.verdict==='PASS'&&r.oracle.verdict==='FAIL').length, bothPass:CTXR.filter(r=>r.realistic.verdict==='PASS'&&r.oracle.verdict==='PASS').length },
  currentSide:{ textFalseNegatives:CURREP.falseNeg.length, codeInNote:CURREP.codeInNote.length, aiOnContextTurns:CURREP.aiOnContext.length },
  perf:PERF3,
  exitTargets:{ note:'V2-2E switch-on blockers; reported, not gated in C3', contextV2_WORSE:{ target:0, now:cnt('V2_WORSE') }, overallPct:{ target:95, now:null }, perActPct:{ target:90 } } };
Q.realisticOracleGapPct=Q.realistic.qualityPct!=null&&Q.oracle.qualityPct!=null?Math.round((Q.oracle.qualityPct-Q.realistic.qualityPct)*10)/10:null;
Q.exitTargets.overallPct.now=Q.realistic.qualityPct;
/* INITIAL C3 BASELINE (first C3 values, 2026-10-10; no historical pre-C3 equivalent): quality may only improve */
/* pinned after the VERO review corrected the dev gold / current-side compare scoring (the first pin rested on those defects) */
const C3_BASE={ ctxV2_WORSE_max:9, ctxRealPASS_min:79, ctxRealFAIL_max:17, ctxOraclePASS_min:80, ctxUNSCORED_max:4, matrixRealPASS_min:112, matrixOraclePASS_min:112,
  perActRealPASS_min:{ ALTERNATIVE:0, ATTRIBUTE_OF_FOCUS:4, CLARIFY:11, COMPARE_METRIC:9, EXCLUDE:1, NONE:1, NOT_LISTED:1, REFINE:10, RELAX:4, REPLACE:2, SELECT:10, STOCK_OF_CONTEXT:4, SWITCH:5 },
  matrixPerActRealPASS_min:{ ATTRIBUTE_OF_FOCUS:24, COMPARE_METRIC:8, EXCLUDE:16, REFINE:16, SELECT:24, STOCK_OF_CONTEXT:16, SWITCH:8 } };
const RAT=[]; const rat=(n,ok,x)=>{ RAT.push([n,ok]); chk(n,ok,x); };
if(C3_BASE.ctxV2_WORSE_max===null) console.log('C3 RATCHET VALUES NOT YET PINNED (first run)');
else {
  rat('CR1 context V2_WORSE <= '+C3_BASE.ctxV2_WORSE_max+' ('+Q.categories.V2_WORSE+')', Q.categories.V2_WORSE<=C3_BASE.ctxV2_WORSE_max);
  rat('CR2 context realistic PASS >= '+C3_BASE.ctxRealPASS_min+', FAIL <= '+C3_BASE.ctxRealFAIL_max+', UNSCORED <= '+C3_BASE.ctxUNSCORED_max+' ('+JSON.stringify(Q.realistic)+')', Q.realistic.PASS>=C3_BASE.ctxRealPASS_min && Q.realistic.FAIL<=C3_BASE.ctxRealFAIL_max && Q.realistic.UNSCORED<=C3_BASE.ctxUNSCORED_max);
  rat('CR3 context oracle PASS >= '+C3_BASE.ctxOraclePASS_min+' ('+Q.oracle.PASS+')', Q.oracle.PASS>=C3_BASE.ctxOraclePASS_min);
  rat('CR4 matrix realistic PASS >= '+C3_BASE.matrixRealPASS_min+', oracle PASS >= '+C3_BASE.matrixOraclePASS_min+' ('+Q.matrix.realistic.PASS+' / '+Q.matrix.oracle.PASS+')', Q.matrix.realistic.PASS>=C3_BASE.matrixRealPASS_min && Q.matrix.oracle.PASS>=C3_BASE.matrixOraclePASS_min);
  const pa=Object.keys(C3_BASE.perActRealPASS_min).filter(a=>!(Q.perActRealistic[a]&&Q.perActRealistic[a].PASS>=C3_BASE.perActRealPASS_min[a]));
  const pm=Object.keys(C3_BASE.matrixPerActRealPASS_min).filter(a=>!(Q.matrix.perActRealistic[a]&&Q.matrix.perActRealistic[a].PASS>=C3_BASE.matrixPerActRealPASS_min[a]));
  rat('CR5 per-act PASS never below the initial C3 baseline (chains + matrix)', !pa.length && !pm.length, JSON.stringify([pa,pm])); }
/* CR6: discourse p95 <= 2 ms is gated (design target); the total-turn target (<= 4 ms, a plan §10.11 V2-2 exit bar) is REPORTED
   (exitTargets) and guarded against regression at 2x the INITIAL C3 BASELINE (machine-noise tolerant) */
const C3_PERF_TOTAL_INITIAL=4.192;   /* INITIAL C3 BASELINE, 2026-10-10, this machine (Node proxy) */
rat('CR6 performance (Node proxy, median of 3 reps over '+PERF3.chains+' generated chains): discourse p95 '+PERF3.discourseP95Ms+' ms <= 2; total v2 turn p95 '+PERF3.totalP95Ms+' ms (exit target 4, reported) <= 2x initial C3 baseline '+C3_PERF_TOTAL_INITIAL,
  PERF3.chains>=400 && PERF3.discourseP95Ms<=2 && (C3_PERF_TOTAL_INITIAL===null || PERF3.totalP95Ms<=2*C3_PERF_TOTAL_INITIAL), JSON.stringify(PERF3));
Q.exitTargets.totalTurnP95Ms={ target:4, now:PERF3.totalP95Ms, met:PERF3.totalP95Ms<=4 };
{ /* C3.U1 test-owned USB equivalence vs the ontology (independent table, same classes) */
  const ont=(O2.USB_NAMING||[]).reduce((o,r)=>(o[r.rate]=r.names.slice().sort(),o),{}), own=Object.keys(USB_EQ).reduce((o,k)=>(o[k]=USB_EQ[k].names.slice().sort(),o),{});
  const reOk=USB_EQ['5Gbps'].re.test('USB-A 3.0') && USB_EQ['5Gbps'].re.test('USB 3.2 Gen 1') && !USB_EQ['5Gbps'].re.test('USB 3.2 Gen 2') && USB_EQ['10Gbps'].re.test('USB 3.2 Gen 2') && !USB_EQ['10Gbps'].re.test('USB 3.2 Gen 2x2') && !USB_EQ['5Gbps'].re.test('USB4');
  chk('C3.U1 the test-owned USB equivalence table equals VeroOntology.USB_NAMING class by class (5 / 10 / 20 Gbps) and its name patterns separate the classes (USB4 is none of them)', JSON.stringify(ont)===JSON.stringify(own) && reOk, JSON.stringify([ont,own,reOk])); }

/* ---------- C3.9 HELDOUT (optional, external; V2-2D input; never merged into DEV; no text written) ---------- */
let HELD=null;
if(arg('--holdout')){ const hp=path.resolve(arg('--holdout')), bytes0=fs.readFileSync(hp), sha0=sha(bytes0); let H0=null, perr=null;
  try{ H0=JSON.parse(bytes0.toString('utf8')); }catch(e){ perr=e.message; }
  const devQ=new Set([].concat(ITEMS.map(it=>it.q),DEV.chains.reduce((a,c)=>a.concat(c.turns.map(t=>t.q)),[]),MX.families.map(f=>f.q),MX.followUps.reduce((a,g)=>a.concat(g.qs.map(x=>x[0])),[])).map(q=>String(q).toLowerCase().trim()));
  const hch=(H0&&Array.isArray(H0.chains))?H0.chains:[], hq=hch.reduce((a,c)=>a.concat((c.turns||[]).map(t=>String(t.q||'').toLowerCase().trim())),[]), overlap=hq.filter(q=>devQ.has(q)).length;
  const harnessSrc=fs.readFileSync(__filename,'utf8').toLowerCase(), inHarness=hq.filter(q=>q.length>10 && harnessSrc.indexOf(q)>=0).length;
  const HROWS=[]; let hgate=null;
  if(!perr && H0.schema==='vero-v2-holdout/1' && !overlap){
    const Gsave=JSON.parse(JSON.stringify(C3G)); Object.keys(C3G).forEach(k=>C3G[k]=[]);
    hch.forEach((c,ci)=>{ const ch={ id:'HELDOUT:'+(c.id||ci), kind:'HELDOUT', contextTurns:c.contextTurns||[], turns:(c.turns||[]).map((t,i)=>Object.assign({ key:'HELDOUT:'+(c.id||ci)+'#'+(i+1), id:t.id||String(i+1) },t)) };
      const R=runV2Chain(ch,'REALISTIC'), OR=runV2Chain(ch,'ORACLE');
      R.forEach((rec,i)=>{ gateTurn('HELDOUT',rec); const dc=derivedCls(ch,rec.t,i), a=scoreV2(rec,dc), b=scoreV2(OR[i],dc); HROWS.push({ key:rec.t.key, cls:dc, realistic:a.verdict, oracle:b.verdict, act:rec.outcome.act }); }); });
    hgate=Object.keys(C3G).reduce((o,k)=>(o[k]=C3G[k].length,o),{}); Object.keys(C3G).forEach(k=>C3G[k]=Gsave[k]); }
  const sha1=sha(fs.readFileSync(hp));
  HELD={ label:'HELDOUT', sha256:sha0, unchanged:sha0===sha1, outsideRepo:!insideRepo(hp), schema:H0&&H0.schema||null, parseError:perr, chains:hch.length, turns:hq.length, overlapWithDev:overlap, textInHarness:inHarness,
    realistic:tally(HROWS.filter(r=>FOLLOW.test(r.cls)),r=>r.realistic), oracle:tally(HROWS.filter(r=>FOLLOW.test(r.cls)),r=>r.oracle), allTurns:tally(HROWS,r=>r.realistic), safetyViolations:hgate, rows:HROWS };
  console.log('HELDOUT (separate; never merged into DEV; no text recorded): '+JSON.stringify(Object.assign({},HELD,{ rows:undefined })));
  chk('C3.H17 held-out input integrity: outside the repo, unchanged by the run, schema vero-v2-holdout/1, no overlap with DEV text, not present in the harness', HELD.outsideRepo && HELD.unchanged && HELD.schema==='vero-v2-holdout/1' && !perr && !overlap && !inHarness, JSON.stringify(Object.assign({},HELD,{ rows:undefined }))); }
else console.log('HELDOUT: not provided (no --holdout). Held-out evaluation is V2-2D, authored independently after C3 is frozen.');

console.log('C3 SUMMARY '+JSON.stringify(Q,null,1));
if(VERBOSE) C3ROWS.filter(r=>r.realistic.verdict==='FAIL'||r.oracle.verdict==='FAIL').forEach(r=>console.log('C3 FAIL-TRACE '+r.key+' ['+r.cls+'] "'+r.q+'" exp '+r.expAct+' :: REAL '+r.realistic.verdict+' '+r.realistic.why+' :: ORACLE '+r.oracle.verdict+' '+r.oracle.why+' :: ev '+r.realistic.evidence0));

console.log(JSON.stringify({ metrics:M, perf:PERF },null,1));
if(arg('--json')) fs.writeFileSync(arg('--json'),JSON.stringify({ ranAt:new Date().toISOString(), note:'Development / regression sets only — no unbiased claim.', metrics:M, perf:PERF, rows:ROWS,
  c3:{ summary:Q, preC3Baseline:PRE_C3, initialC3Baseline:C3_BASE, gates:Object.keys(C3G).reduce((o,k)=>(o[k]=C3G[k],o),{}), currentSide:CURREP, rows:C3ROWS, matrix:MROWS, heldout:HELD?Object.assign({},HELD):null } },null,1));
if(arg('--md')){
  const L=[]; L.push('| set | turns | scorable | SAME_OK | SAME_FAIL | V2_BETTER | V2_WORSE | follow-up (coverage only) | silent drops | label viol. cur / v2 | false wala cur / v2 |','|---|---|---|---|---|---|---|---|---|---|---|');
  sets.concat(['ALL']).forEach(s=>{ const m=M[s]; L.push(`| ${s} | ${m.turns} | ${m.scorable} | ${m.SAME_OK} | ${m.SAME_FAIL} | ${m.V2_BETTER} | ${m.V2_WORSE} | ${m.followUps} | ${m.silentDrops} | ${m.labelViolations.current} / ${m.labelViolations.v2} | ${m.falseWala.current} / ${m.falseWala.v2} |`); });
  L.push('','C3 chained (context turns): realistic '+JSON.stringify(Q.realistic)+' · oracle '+JSON.stringify(Q.oracle)+' · gap '+Q.realisticOracleGapPct+' pts · categories '+JSON.stringify(Q.categories),'',
    '| key | class | question | expected act | realistic | oracle | current | category | why (realistic) |','|---|---|---|---|---|---|---|---|---|');
  C3ROWS.forEach(r=>L.push(`| ${r.key} | ${r.cls} | ${r.q.replace(/\|/g,'/')} | ${r.expAct} | ${r.realistic.verdict} (${r.realistic.act}) | ${r.oracle.verdict} | ${r.current.verdict} | ${r.category} | ${String(r.realistic.why).replace(/\|/g,'/')} |`));
  fs.writeFileSync(arg('--md'),L.join('\n')+'\n'); }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
