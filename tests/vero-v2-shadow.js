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

/* ---------- 1. CURRENT answers BEFORE v2 is loaded ---------- */
const routeOf=(a,r)=>a.route==='local'?((r.type==='clarify')?'CLARIFY':(a.canEscalate?'LOCAL+offer':'LOCAL')):a.route.toUpperCase();
function runCurrent(){ const CTX={}, out={};
  ITEMS.forEach(it=>{ const key=it.set+':'+it.id, conv=it.prev?CTX[it.set+':'+it.prev]:null;
    const r=E.answer(PUB,it.q,{ conv }), a=E.aiRoute(PUB,it.q,r,{}); CTX[key]=r.ctxOut||conv; out[key]={ r, a }; });
  return out; }
const sigOf=C=>JSON.stringify(Object.keys(C).map(k=>{ const {r,a}=C[k]; return [k,r.type,r.codes,r.note,r.echo||null,r.stockNote||null,a.route,a.candidates,a.canEscalate]; }));
const CUR=runCurrent(), BEFORE=sigOf(CUR), productsBefore=JSON.stringify(ALL);

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
const nameOf=p=>String(p.product_name||'');
const NUM={ wattsName:p=>E.productWatts(p),
  wattsAny:p=>{ const n=E.productWatts(p); if(n!=null) return n; let best=null; String(p.features||'').split(/\r?\n|[▪•;|]/).forEach(l=>{ if(!/(max|up to|support|charging|output|power|pd)/i.test(l)) return; (l.match(/(\d{2,3})\s?w\b/gi)||[]).forEach(x=>{ const v=parseInt(x,10); if(best==null||v>best) best=v; }); }); return best; },
  mahName:p=>{ const m=nameOf(p).replace(/,/g,'').match(/(\d{4,6})\s?mAh/i); return m?parseInt(m[1],10):null; }, lengthM:p=>E.lenMeters(p.length), srp:p=>Number(p.srp), dp:p=>Number(p.dp) };
const OPS={'==':(a,b)=>a!=null&&Math.abs(a-b)<1e-9,'>=':(a,b)=>a!=null&&a>=b-1e-9,'<=':(a,b)=>a!=null&&a<=b+1e-9,'>':(a,b)=>a!=null&&a>b+1e-9,'<':(a,b)=>a!=null&&a<b-1e-9};
function clause(p,c){ if(c.any) return c.any.some(x=>clause(p,x)); if(c.field) return c.in.includes(String(p[c.field]||'')); if(c.nameRe) return new RegExp(c.nameRe,'i').test(nameOf(p));
  if(c.nameNotRe) return !new RegExp(c.nameNotRe,'i').test(nameOf(p)); if(c.textRe) return c.fields.some(f=>new RegExp(c.textRe,'i').test(String(p[f]||''))); if(c.num) return OPS[c.op](NUM[c.num](p),c.v);
  if(c.colorRe) return new RegExp(c.colorRe,'i').test(String(p.color||'')); if(c.codeOrModel){ const k=String(c.codeOrModel).toLowerCase().replace(/\s+/g,''); return String(p.item_code).toLowerCase()===k||String(p.model||'').toLowerCase().replace(/\s+/g,'')===k; } throw new Error('clause'); }
function derive(d){ let rows=PUB.filter(p=>d.where.every(c=>clause(p,c)));
  if(d.order) rows.sort((a,b)=>{ for(const [f,dir] of d.order){ const va=NUM[f]?NUM[f](a):a[f], vb=NUM[f]?NUM[f](b):b[f]; const x=va==null?-Infinity:va, y=vb==null?-Infinity:vb; if(x<y) return dir==='asc'?-1:1; if(x>y) return dir==='asc'?1:-1; } return 0; });
  return rows.map(p=>String(p.item_code)); }
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
  row.gold=gold; row.routeOk={ current:curRouteOk, v2:v2RouteOk }; row.cls=it.cls; row.legacy=it.legacy;
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
  const STOCKW=/\b(stocks?|in[- ]stock|inventory|on ?hand|natira|natitira|remaining|sold ?out|ubos|left|warehouse|bodega|available|availability)\b|meron pa\b|ilan pa\b/i;
  { const txt=[].concat(pr.notes||[],pr.hint||[]).join(' '); const claim=/\b\d+\s*(pcs|pieces|units|left|natira|on hand)\b/i.test(txt)||/\bin stock\b|\bmay stock\b|\bavailable pa\b/i.test(txt);
    const stockQ=STOCKW.test(it.q) && !/\b(colou?rs?|kulay|variants?)\b/i.test(it.q) && !/meron pa (bang? )?(mas|iba)/i.test(it.q);
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
chk('RT6 inventory safety 15/15 and no new unresolved / ambiguous turns (<= 4 / <= 1)', A.inventory.v2Safe===15 && A.inventory.of===15 && A.turnsWithUnresolved<=4 && A.turnsWithAmbiguous<=1, JSON.stringify([A.inventory,A.turnsWithUnresolved,A.turnsWithAmbiguous]));
/* ---------- EXCLUDE-integrity audit (gating) over every shadow turn + a generated exclusion matrix ---------- */
const EXM=[]; ['charger','power bank','hub','hdmi cable','earphones'].forEach(f=>{ ['white','black','pink'].forEach(c=>EXM.push(f+' na hindi '+c,'not '+c+' '+f,f+' except '+c,'walang '+c+' '+f)); ['built-in cable','magsafe','hdmi','usb-c'].forEach(v=>EXM.push(f+' na walang '+v,f+' without '+v)); EXM.push('not 65w '+f,'hindi 20000mah '+f,f+' not over 1000 pesos','not sure kung 65w '+f,'dont need 65w '+f,f+' no need talaga','no need talaga 65w '+f); });
const audit=[]; let polNullSeen=0, negSeen=0;
ITEMS.map(it=>({ q:it.q, P:V2[it.set+':'+it.id] })).concat(EXM.map(q=>({ q, P:VP.run(q,{ facts:FACTS, products:PUB }) }))).forEach(({ q, P })=>{ const pr=P.proposal;
  P.frame.constraints.forEach(c=>{ if(c.polNull){ polNullSeen++; if(pr.kind==='exact') audit.push(q+' :: polarity-null labelled exact'); }
    const excluded=c.neg||c.kind==='notConnector'||c.kind==='notFamily'; if(!excluded) return; negSeen++;
    const pos=Object.assign({},c,{ neg:false, kind:c.kind==='notConnector'?'connector':c.kind==='notFamily'?'family':c.kind });
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
  chk('T3 follow-ups stay COVERAGE-ONLY in C1 (no follow-up is scored; scoring is C3) and the honest scorable-context count is reported ('+judgeable.length+'/'+ctx.length+')', F.every(r=>/^(FOLLOWUP_COVERAGE_ONLY|OUT_OF_SCOPE_COACH)$/.test(r.category)) && judgeable.length>=20 && ctx.filter(r=>r.set==='B144' && r.gold).length===0); }
/* single-turn freeze (design §15 C1 tests): sha256 of every STANDALONE v2 proposal (route, kind, codes), pinned at the live baseline
   16a827d, minus a REVIEWED allow-list of intended C1 changes, each pinned to its new value */
{ const crypto=require('crypto');
  /* review round 1: E03 / D07 left the allow-list — with the evidence floor (a proposed row must name or mention every requested
     connector) they are byte-identical to the live baseline again */
  const ALLOW={ 'B144:S05':['LOCAL','inferred',8,'#6: retractable => built-in cable is INFERRED (+1, labelled; the set is no longer "exact")'],
    'B144:B04':['LOCAL','inferred',17,'#6: retractable => built-in (+1 INFERRED)'], 'HO3:T17':['LOCAL','inferred',17,'#6: retractable => built-in (+1 INFERRED)'],
    'B144:A04':['LOCAL','alternative',17,'#6: one more alternative admitted only through retractable => built-in, labelled inferred'],
    'B144:G04':['LOCAL','exact',50,'§7 rule 4: rows with no wattage are kept AFTER the ranked rows (were dropped)'],
    'B144:V01':['LOCAL','exact',61,'§7 rule 4: rows with no length kept after the ranked rows'], 'B144:K06':['LOCAL','exact',129,'§7 rule 4: rows with no length kept last'], 'B144:T05':['LOCAL','exact',129,'§7 rule 4: rows with no length kept last'] };
  const ST=ROWS.filter(r=>!r.follow), sig=JSON.stringify(ST.filter(r=>!ALLOW[r.set+':'+r.id]).map(r=>r.set+':'+r.id).sort().map(k=>{ const p=V2[k].proposal; return [k,p.route,p.kind,p.codes]; }));
  const sha=crypto.createHash('sha256').update(sig).digest('hex'), FREEZE='1225cca49e0c88370a48c15d05a8666dd96ca360eb1e2c14e1202dc7cf95b33d';
  const allowBad=Object.keys(ALLOW).filter(k=>{ const p=V2[k]&&V2[k].proposal, w=ALLOW[k]; return !p || p.route!==w[0] || p.kind!==w[1] || p.codes.length!==w[2]; });
  chk('F1 single-turn freeze: '+(ST.length-Object.keys(ALLOW).length)+' standalone v2 proposals byte-identical to live 16a827d (sha '+sha.slice(0,12)+'…); '+Object.keys(ALLOW).length+' reviewed allow-list changes each at their pinned value', ST.length===225 && sha===FREEZE && !allowBad.length, JSON.stringify([ST.length,sha,allowBad]));
  chk('F2 allow-listed changes never worsen a scored turn (category SAME_OK / V2_BETTER / SAME_FAIL as before; no V2_WORSE)', Object.keys(ALLOW).every(k=>ROWS.find(r=>r.set+':'+r.id===k).category!=='V2_WORSE'));
  /* EV1 (review round 1): structural evidence floor over every shadow turn — a partial / closest / inferred proposal never contains a
     product that neither names nor mentions a requested (affirmed) connector; this catches E03 / D07-style answers without gold */
  const named=(c,k)=>{ const g=VP.graphFor(c,{ facts:FACTS, products:PUB }); return !!g && (g.conns.all.includes(k)||g.conns.feat.includes(k)||(k==='usb'&&g.conns.all.concat(g.conns.feat).some(x=>/^usb|micro_usb/.test(x)))||(g.pair&&(g.pair.from.includes(k)||g.pair.to.includes(k)))); };
  const evb=[]; ROWS.forEach(r=>{ const P=V2[r.set+':'+r.id], pr=P.proposal; if(!/^(partial|closest|inferred)$/.test(pr.kind)) return;
    P.frame.constraints.filter(c=>c.kind==='connector' && !c.polNull && !c.affirmBase && c.label!==pr.relaxed).forEach(c=>{ const bad=(pr.codes||[]).filter(code=>!named(code,c.id)); if(bad.length) evb.push(r.set+':'+r.id+' '+c.id+' '+bad.slice(0,3).join(',')); }); });
  chk('EV1 evidence floor: no partial / closest / inferred proposal lists a product with no trace of a requested connector ('+ROWS.length+' turns)', !evb.length, evb.slice(0,6)); }
console.log(JSON.stringify({ metrics:M, perf:PERF },null,1));
if(arg('--json')) fs.writeFileSync(arg('--json'),JSON.stringify({ ranAt:new Date().toISOString(), note:'Development / regression sets only — no unbiased claim.', metrics:M, perf:PERF, rows:ROWS },null,1));
if(arg('--md')){
  const L=[]; L.push('| set | turns | scorable | SAME_OK | SAME_FAIL | V2_BETTER | V2_WORSE | follow-up (coverage only) | silent drops | label viol. cur / v2 | false wala cur / v2 |','|---|---|---|---|---|---|---|---|---|---|---|');
  sets.concat(['ALL']).forEach(s=>{ const m=M[s]; L.push(`| ${s} | ${m.turns} | ${m.scorable} | ${m.SAME_OK} | ${m.SAME_FAIL} | ${m.V2_BETTER} | ${m.V2_WORSE} | ${m.followUps} | ${m.silentDrops} | ${m.labelViolations.current} / ${m.labelViolations.v2} | ${m.falseWala.current} / ${m.falseWala.v2} |`); });
  fs.writeFileSync(arg('--md'),L.join('\n')+'\n'); }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
