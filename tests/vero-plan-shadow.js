/* VERO Local Brain — QueryPlan SHADOW comparison (step qp1).
   Run:  node tests/vero-plan-shadow.js [--json <out.json>] [--md <out.md>] [--verbose]
   For every benchmark question (tests/vero-sales-questions.json, 144 core) this builds the NEW QueryPlan beside the
   CURRENT engine answer (vero-engine.js p2r2.1, still authoritative) and compares both against the benchmark:
     route (benchmark rule + strict CLARIFY), intent, type, constraints, anchors, data-derived SKU expectations,
     AI/WEB candidate rules (named SKU first, family purity, no AI without intent) and safety behaviours.
   Follow-ups (contextFrom) are replayed as a sequence: the plan of the earlier question becomes the context.
   Shadow purity: engine answers are captured BEFORE any plan is built and compared AFTER — they must be identical, and
   products.json must not be mutated. Nothing here changes what users see.
   Exit 1 only on: purity failure, structural failure, safety failure, or leakage (catalog codes / question text in
   js/vero-plan.js). Per-question regressions are REPORTED for review, not hidden. */
const fs=require('fs'), path=require('path');
const ROOT=path.join(__dirname,'..');
const argv=process.argv.slice(2), arg=k=>{ const i=argv.indexOf(k); return i>=0?argv[i+1]:null; };
const VERBOSE=argv.includes('--verbose');
global.window={ PRICE_SETTINGS:{ indicatorDays:30 } };
eval(fs.readFileSync(path.join(ROOT,'js','helpers.js'),'utf8'));
const NL=require(path.join(ROOT,'js','vero-nlu.js'));
const E=require(path.join(ROOT,'js','vero-engine.js'));
const RAW=fs.readFileSync(path.join(ROOT,'data','products.json'),'utf8');
const ALL=JSON.parse(RAW); pcResolveSchedule(ALL);
const PUB=ALL.filter(p=>!p.disabled);
const BENCH=JSON.parse(fs.readFileSync(path.join(__dirname,'vero-sales-questions.json'),'utf8')), Qs=BENCH.questions;
const byCode={}; PUB.forEach(p=>byCode[String(p.item_code)]=p);
let pass=0, fail=0; const chk=(n,c,x)=>{ if(c){ pass++; if(VERBOSE) console.log('PASS - '+n); } else { fail++; console.log('FAIL - '+n+(x?'  -> '+String(x).slice(0,500):'')); } };
const pct=(a,b)=>b?Math.round(a/b*1000)/10:0;

/* ---------- 1. current engine answers BEFORE the Local Brain is loaded ---------- */
const sig=()=>JSON.stringify(Qs.map(q=>{ const r=E.answer(PUB,q.question,{}), a=E.aiRoute(PUB,q.question,r,{}); return [r.type,r.codes,r.note,r.stockNote||null,a.route,a.candidates,a.canEscalate]; }));
const BEFORE=sig(), productsBefore=JSON.stringify(ALL);
const CUR={}; Qs.forEach(q=>{ const r=E.answer(PUB,q.question,{}), a=E.aiRoute(PUB,q.question,r,{});
  CUR[q.id]={ r, a, route:a.route==='local'?(a.canEscalate?'LOCAL+offer':'LOCAL'):a.route.toUpperCase(), clarify:a.route==='local'&&r.type==='clarify' }; });

/* ---------- 2. build plans (shadow) ---------- */
const VF=require(path.join(ROOT,'js','vero-facts.js'));
const VP=require(path.join(ROOT,'js','vero-plan.js'));
const tF=Date.now(); const IDX=VF.build(PUB,{force:true}); const factsMs=Date.now()-tF;
const PLAN={}, CTX={}, times=[];
Qs.forEach(q=>{
  const ctx=q.contextFrom?CTX[q.contextFrom]:null;
  const t0=process.hrtime.bigint(); const pl=VP.build(q.question,{ products:PUB, facts:IDX, ctx }); times.push(Number(process.hrtime.bigint()-t0)/1e6);
  PLAN[q.id]=pl; CTX[q.id]=VP.nextContext(pl,ctx||{});
});
const AFTER=sig();
chk('S01 shadow purity: engine answers identical before/after building 144 plans (type, codes, note, route, candidates)', BEFORE===AFTER);
chk('S02 shadow purity: products.json objects not mutated by facts index or plans', JSON.stringify(ALL)===productsBefore);
chk('S03 one plan per question, schema v1 (intent + route always set)', Qs.every(q=>{ const p=PLAN[q.id]; return p&&p.v===1&&p.intent&&p.route&&p.route.route&&Array.isArray(p.anchors)&&Array.isArray(p.filters)&&p.result; }));

/* ---------- 3. comparison helpers ---------- */
const PR={ LOCAL:'LOCAL', AI_CATALOG:'CATALOG', WEB:'WEB', CLARIFY:'CLARIFY', COACH_FUTURE:'COACH' };
function routeOkBench(exp,act){ /* benchmark rule (baseline 80.6%): LOCAL=LOCAL(+offer); AI=CATALOG|WEB; WEB=WEB; CLARIFY=no AI call */
  if(exp==='LOCAL') return act==='LOCAL'||act==='LOCAL+offer';
  if(exp==='AI') return act==='CATALOG'||act==='WEB';
  if(exp==='WEB') return act==='WEB';
  if(exp==='CLARIFY') return act==='LOCAL'||act==='LOCAL+offer'||act==='CLARIFY';
  return null; }
function routeOkStrict(exp,act,isClarify){ if(exp==='COACH') return act==='COACH'; if(exp==='CLARIFY') return act==='CLARIFY'||!!isClarify; if(exp==='LOCAL') return (act==='LOCAL'||act==='LOCAL+offer')&&!isClarify; return routeOkBench(exp,act); }
/* intent vocabulary: benchmark -> QueryPlan. exist / list / stock share one executor (a bare noun phrase is a list request that
   answers the same "N in the pricelist"); a filter that also names a superlative is a rank; judgement may be a device-fit (compat). */
const INTENT_MAP={ field:['attribute'], description:['attribute'], variants:['attribute'], exist:['exist','list'], count:['count'], rank:['rank'], history:['price_history'],
  filter:['list','exist'], compare:['compare'], compare_followup:['compare'], judgement:['recommend','compat'], alternative:['alternative'], compat:['compat'],
  clarify:[], stock:['exist','lookup','list'], coach:['coach'] };
function intentOk(q,pl){
  if(q.expectedIntent==='clarify') return pl.route.route==='CLARIFY';
  if(q.expectedIntent==='filter' && (q.expectedConstraints||{}).rank && pl.intent==='rank') return true;
  return (INTENT_MAP[q.expectedIntent]||[]).includes(pl.intent); }
function typeOk(q,pl){
  if(!q.expectedType) return null;
  const exp=q.expectedType.split('|'), t=pl.type; if(!t) return false;
  return exp.some(e=>{ const [f,s]=e.split('.'); return t.family===f && (!s || t.subtype===s); }); }
const OPM={ eq:'eq', min:'ge', max:'le', gt:'gt' };
function numOk(pl,attr,spec){ const f=pl.filters.filter(x=>x.attr===attr); return Object.entries(spec).every(([k,v])=>f.some(x=>x.op===OPM[k] && Math.abs(x.value-v)<1e-6)); }
function matchHas(pl,k,pred){ return pl.match.some(m=>m.k===k && pred(m)); }
const RESR={'8K':6,'4K':4,'2K':3,'1080P':2};
function refCodes(r){ const k=String(r).toLowerCase().replace(/\s+/g,''); return PUB.filter(p=>{ const m=String(p.model||'').toLowerCase().trim(); return String(p.item_code).toLowerCase()===k||m.replace(/\s+/g,'')===k||m.split(/\s+/)[0]===k; }).map(p=>String(p.item_code)); }
function constraintScore(q,pl){
  const c=q.expectedConstraints||{}, res={};
  const set=(k,v)=>{ res[k]=v; };
  const alt=pl.alternative||{};
  if(c.watts) set('watts',typeof c.watts==='object'?numOk(pl,'watts',c.watts):(c.watts==='same'&&(alt.keep||[]).includes('watts')));
  if(c.mah) set('mah',typeof c.mah==='object'?numOk(pl,'mah',c.mah):(c.mah==='same'&&(alt.keep||[]).includes('mah')));
  if(c.lengthM) set('lengthM',numOk(pl,'lengthM',c.lengthM));
  if(c.srp) set('price',typeof c.srp==='object'?(numOk(pl,'price',c.srp) && pl.filters.some(f=>f.attr==='price'&&f.field==='srp')):(c.srp==='lower'&&alt.direction==='cheaper'));
  if(c.color) set('color',matchHas(pl,'color',m=>m.v===c.color));
  if(c.flag) set('flag',matchHas(pl,'flag',m=>m.v===c.flag));
  if(c.eth) set('eth',matchHas(pl,'eth',m=>m.v>=c.eth.min-1e-9));
  if(c.dataGbps) set('dataGbps',matchHas(pl,'gbps',m=>m.v>=c.dataGbps.min-1e-9));
  if(c.hdmiVersion) set('hdmiVersion',matchHas(pl,'hdmiver',m=>m.v>=c.hdmiVersion.min-1e-9));
  if(c.res) set('res',matchHas(pl,'res',m=>m.v===RESR[c.res.toUpperCase()] && (!c.port||m.q===c.port)));
  if(c.refresh){ const mm=c.refresh.match(/(\d+K)@(\d+)Hz/i); set('refresh',matchHas(pl,'refresh',m=>m.r===RESR[mm[1].toUpperCase()]&&m.hz===+mm[2])); }
  if(c.connector) set('connector',pl.connectors.includes(c.connector)||!!(pl.pair&&(pl.pair.from===c.connector||pl.pair.to===c.connector))||pl.ports.some(p=>p.kind===c.connector));
  if(c.from) set('pair',!!pl.pair && pl.pair.from===c.from && pl.pair.to===c.to);
  if(c.rank){ const [dim,dir]=c.rank.split(':'); const by={srp:'srp',dp:'dp',lengthM:'lengthM',watts:'watts',mah:'mah'}[dim]; set('rank',!!pl.sort&&pl.sort[0].by===by&&pl.sort[0].dir===(dir==='min'?'asc':'desc')); }
  if(c.n) set('n',pl.history?pl.history.n===c.n:pl.limit===c.n);
  if(c.ports){ const p=c.ports;
    if(p.eq!=null) set('ports',pl.filters.some(f=>f.attr==='ports'&&f.op==='eq'&&f.value===p.eq));
    else if(p.min!=null) set('ports',pl.filters.some(f=>f.attr==='ports'&&f.op==='ge'&&f.value===p.min));
    else if(p.has) set('ports',p.has.every(k=>pl.ports.some(x=>x.kind===k&&x.op==='has')));
    else set('ports',Object.entries(p).every(([k,v])=>pl.ports.some(x=>x.kind===k&&x.op==='ge'&&x.value===v.min))); }
  if(c.displays) set('displays',pl.filters.some(f=>f.attr==='videoOut'&&f.value===c.displays.min));
  if(c.ref){ if(c.ref==='@context') set('ref',pl.refs.some(r=>r.codes&&r.codes.length)); else { const w=refCodes(c.ref); set('ref',w.length>0 && w.every(x=>pl.subject.includes(x))); } }
  if(c.refs){ if(c.refs==='@context') set('refs',pl.refs.some(r=>r.codes&&r.codes.length>=2)); else set('refs',c.refs.every(r=>{ const w=refCodes(r); return w.length && w.some(x=>pl.subject.includes(x)); })); }
  if(c.field && pl.history) set('field',pl.history.field===c.field);
  else if(c.field){ const F={sku:'sku',srp:'srp',dp:'dp',dp_volume:'dp_volume',price:'price',moq:'moq',description:'description'}[c.field]; set('field',pl.attribute===F); }
  if(c.attr) set('attr',pl.attribute===c.attr);
  if(c.dim){ const D={watts:'watts',srp:'srp',ports:'ports',mah:'mah',nasBays:'nasBays'}[c.dim]; set('dim',!!pl.metric&&pl.metric.attr===D); }
  if(c.dir && pl.history) set('dir',pl.history.dir===c.dir);
  if(c.period && pl.history) set('period',!!pl.history.period&&pl.history.period.k===c.period);
  if(c.kind && pl.history) set('kind',pl.history.kind===c.kind || (c.kind==='amount'&&pl.history.kind==='list'));
  if(c.device) set('device',pl.flags.devices.named.length>0||pl.flags.devices.classes.length>0);
  if(c.devices) set('devices',c.devices.every(d=>pl.flags.devices.classes.includes(d)));
  return res;
}
/* data-derived expectations (same language as tests/vero-sales-benchmark.js) */
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
function judge(d,exp,codes){ const s=a=>JSON.stringify([...a].sort());
  switch(d.check){ case 'lookup': return exp.length>0&&exp.includes(codes[0]); case 'first': return exp.length>0&&codes[0]===exp[0]; case 'top': return exp.length>0&&JSON.stringify(codes.slice(0,d.take))===JSON.stringify(exp.slice(0,d.take));
    case 'set': return s(codes)===s(exp); case 'count': return codes.length===exp.length; case 'contains': return exp.length>0&&exp.every(c=>codes.includes(c)); case 'empty': return codes.length===0&&exp.length===0; } }
function curConfirmed(q){ const x=CUR[q.id], codes=x.r.codes||[], note=x.r.note||'', yes=note.match(/^(?:Yes — )?(\d+) /);
  if(q.expectedSKU.check==='set'&&yes&&/not explicitly confirmed|mentioned only/.test(note)) return codes.slice(0,+yes[1]);
  if(q.expectedSKU.check==='empty') return /^No\b/.test(note)?[]:codes; return codes; }
function planCodes(pl){ const R=pl.result||{codes:[]}; if(pl.intent==='attribute'||pl.intent==='lookup'||pl.intent==='exist'&&pl.subject.length) return R.codes.length?R.codes:pl.subject; return R.codes; }

/* ---------- 4. evaluate ---------- */
const ROWS=[];
Qs.forEach(q=>{
  const pl=PLAN[q.id], cur=CUR[q.id], pr=PR[pl.route.route];
  const curB=routeOkBench(q.expectedRoute,cur.route), curS=routeOkStrict(q.expectedRoute,cur.route,cur.clarify);
  const plB=routeOkBench(q.expectedRoute,pr), plS=routeOkStrict(q.expectedRoute,pr,false);
  const cs=constraintScore(q,pl), ck=Object.keys(cs), cOk=ck.filter(k=>cs[k]).length;
  let der=null; if(q.expectedSKU){ const exp=derive(q.expectedSKU); der={ check:q.expectedSKU.check, expected:exp.length, cur:judge(q.expectedSKU,exp,curConfirmed(q)), plan:judge(q.expectedSKU,exp,planCodes(pl)), expFirst:exp.slice(0,3), planFirst:planCodes(pl).slice(0,3) }; }
  const io=intentOk(q,pl), to=typeOk(q,pl);
  const planGood=plS && io, curGood=curS;
  const cls=q.expectedRoute==='COACH'?(plS?(curS?'AGREE':'IMPROVED'):(curS?'REGRESSED':'BOTH WRONG')):(planGood&&curGood?'AGREE':(planGood&&!curGood?'IMPROVED':(!planGood&&curGood?'REGRESSED':'BOTH WRONG')));
  ROWS.push({ id:q.id, cat:q.category, q:q.question, exp:{ route:q.expectedRoute, intent:q.expectedIntent, type:q.expectedType||null }, baseline:q.baseline.rating,
    cur:{ route:cur.route, clarify:cur.clarify, okBench:curB, okStrict:curS, codes:(cur.r.codes||[]).length },
    plan:{ route:pl.route.route, rule:pl.route.rule, intent:pl.intent, type:pl.type?pl.type.id:null, anchors:pl.anchors.map(a=>a.raw+'→'+(a.codes.join('/')||'?')), refs:pl.refs.map(r=>r.kind+'→'+((r.codes||[]).join('/')||'?')),
      filters:pl.filters.map(f=>f.attr+' '+f.op+' '+JSON.stringify(f.value)), match:pl.match.map(m=>m.k+':'+(m.label||m.v)), ports:pl.ports.map(p=>p.kind+' '+p.op+(p.value?' '+p.value:'')), connectors:pl.connectors, pair:pl.pair,
      attribute:pl.attribute, sort:pl.sort, metric:pl.metric, history:pl.history, executor:pl.result.executor, codes:pl.result.codes.length, top:(pl.result.top||pl.result.codes).slice(0,3), mentioned:pl.result.mentioned.length, related:pl.result.related.length,
      verdict:pl.result.verdict||null, candidates:pl.route.candidates, purity:pl.route.purity, ambiguity:pl.ambiguity, unsupported:pl.unsupported, caveats:pl.result.caveats, ms:Math.round(times[Qs.indexOf(q)]*10)/10 },
    okBench:plB, okStrict:plS, intentOk:io, typeOk:to, constraints:cs, constraintOk:cOk+'/'+ck.length, derive:der, cls });
});

/* ---------- 5. hard safety / rule checks on plans ---------- */
const isAI=r=>r==='AI_CATALOG'||r==='WEB';
const aiNoIntent=ROWS.filter(r=>isAI(r.plan.route) && !(PLAN[r.id].subject.length||PLAN[r.id].type||PLAN[r.id].useCase));
chk('S04 no AI/WEB route without an identified product (anchor, type, use case or context)', !aiNoIntent.length, aiNoIntent.map(r=>r.id).join(','));
const named=ROWS.filter(r=>isAI(r.plan.route) && PLAN[r.id].anchors.some(a=>a.codes.length));
const namedMiss=named.filter(r=>{ const pl=PLAN[r.id]; const want=[].concat(...pl.anchors.map(a=>a.codes)); return !want.some(c=>pl.route.candidates.slice(0,Math.max(1,pl.anchors.length*2)).includes(c)); });
chk('S05 named SKU / model is among the first AI/WEB candidates ('+named.length+' anchored escalations)', !namedMiss.length, namedMiss.map(r=>r.id).join(','));
const aiFew=ROWS.filter(r=>r.plan.route==='AI_CATALOG' && r.plan.candidates.length<2);
chk('S06 AI_CATALOG always has >= 2 candidates; WEB has >= 1', !aiFew.length && ROWS.filter(r=>r.plan.route==='WEB').every(r=>r.plan.candidates.length>=1), aiFew.map(r=>r.id).join(','));
const impure=ROWS.filter(r=>r.plan.purity && r.plan.purity.pure<r.plan.purity.of);
chk('S07 AI/WEB candidates stay inside the plan family (no other family used to fill)', !impure.length, impure.map(r=>r.id).join(','));
/* MagSafe / Qi2: no confirmed item without name-or-feature evidence */
const msBad=[], qiBad=[];
Qs.forEach(q=>{ const pl=PLAN[q.id];
  if(pl.match.some(m=>m.k==='flag'&&m.v==='magsafe')) pl.result.codes.forEach(c=>{ if(!/mag\s?safe/i.test(nameOf(byCode[c])+' '+(byCode[c].features||''))) msBad.push(q.id+':'+c); });
  if(pl.match.some(m=>m.k==='flag'&&m.v==='qi2')) pl.result.codes.forEach(c=>{ if(!/\bqi\s?2/i.test(nameOf(byCode[c])+' '+(byCode[c].features||''))) qiBad.push(q.id+':'+c); }); });
chk('S08 MagSafe: confirmed set only from name/feature evidence; magnetic-only items kept in "related"', !msBad.length, msBad.join(','));
chk('S09 Qi2: confirmed set only from name/feature evidence (plain Qi never counts)', !qiBad.length, qiBad.join(','));
const stockQ=Qs.filter(q=>/\b(stock|on hand)\b/i.test(q.question));
chk('S10 stock words always carry the stock caveat in the plan ('+stockQ.length+' questions)', stockQ.every(q=>PLAN[q.id].result.caveats.includes('stock')), stockQ.filter(q=>!PLAN[q.id].result.caveats.includes('stock')).map(q=>q.id).join(','));
const histBad=Qs.filter(q=>PLAN[q.id].intent==='price_history' && PLAN[q.id].route.route!=='LOCAL');
chk('S11 price history is always LOCAL', !histBad.length, histBad.map(q=>q.id).join(','));
const coachQ=Qs.filter(q=>q.expectedRoute==='COACH');
chk('S12 coach questions never reach AI (COACH_FUTURE or LOCAL only)', coachQ.every(q=>!isAI(PLAN[q.id].route.route)), coachQ.filter(q=>isAI(PLAN[q.id].route.route)).map(q=>q.id).join(','));
/* leakage: no catalog code / benchmark text in the new module */
const SRC=fs.readFileSync(path.join(ROOT,'js','vero-plan.js'),'utf8');
const codesSet=new Set(ALL.map(p=>String(p.item_code).toUpperCase()));
const leakC=(SRC.toUpperCase().match(/\b\d{5}[A-Z]{0,2}\b/g)||[]).filter(t=>codesSet.has(t));
chk('S13 no catalog item code in js/vero-plan.js', !leakC.length, leakC.join(','));
const modelsSet=new Set(ALL.map(p=>String(p.model||'').toLowerCase().trim()).filter(m=>m.length>=4&&/\d/.test(m)));
const leakM=(SRC.toLowerCase().match(/\b[a-z0-9]{4,}\b/g)||[]).filter(t=>modelsSet.has(t)&&/[a-z]/.test(t));
chk('S14 no product model number in js/vero-plan.js', !leakM.length, [...new Set(leakM)].join(','));
const leakQ=Qs.filter(q=>{ const t=q.question.toLowerCase().replace(/[?!.]+$/,''); return t.length>=12 && SRC.toLowerCase().includes(t); });
chk('S15 no benchmark question text in js/vero-plan.js', !leakQ.length, leakQ.map(q=>q.id).join(','));
chk('S16 no network call in js/vero-plan.js (no fetch / XMLHttpRequest / import())', !/\bfetch\s*\(|XMLHttpRequest|\bimport\s*\(/.test(SRC));
const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8'), live=['vero.js','vero-engine.js','vero-nlu.js'].map(f=>fs.readFileSync(path.join(ROOT,'js',f),'utf8')).join('\n');
chk('S17 p2r3a: index.html loads vero-plan.js after vero-facts.js and before vero-engine.js; UI/NLU do not call VeroPlan directly', html.indexOf('js/vero-facts.js')>0 && html.indexOf('js/vero-facts.js')<html.indexOf('js/vero-plan.js') && html.indexOf('js/vero-plan.js')<html.indexOf('js/vero-engine.js') && !/VeroPlan/.test(fs.readFileSync(path.join(ROOT,'js','vero.js'),'utf8')+fs.readFileSync(path.join(ROOT,'js','vero-nlu.js'),'utf8')));

/* ---------- 6. metrics ---------- */
function M(sel){ const rs=ROWS.filter(sel), x={ n:rs.length };
  const nc=rs.filter(r=>r.exp.route!=='COACH');
  x.curBench=nc.filter(r=>r.cur.okBench).length; x.planBench=nc.filter(r=>r.okBench).length; x.of=nc.length;
  x.curStrict=rs.filter(r=>r.cur.okStrict).length; x.planStrict=rs.filter(r=>r.okStrict).length;
  x.intent=rs.filter(r=>r.intentOk).length;
  const tq=rs.filter(r=>r.typeOk!==null); x.type=tq.filter(r=>r.typeOk).length; x.typeOf=tq.length;
  let cOk=0,cAll=0; rs.forEach(r=>{ Object.values(r.constraints).forEach(v=>{ cAll++; if(v) cOk++; }); }); x.cons=cOk; x.consOf=cAll;
  const dq=rs.filter(r=>r.derive); x.derCur=dq.filter(r=>r.derive.cur).length; x.derPlan=dq.filter(r=>r.derive.plan).length; x.derOf=dq.length;
  x.cls={}; rs.forEach(r=>x.cls[r.cls]=(x.cls[r.cls]||0)+1);
  return x; }
const ALLM=M(()=>true);
const curAI=ROWS.filter(r=>r.cur.route==='CATALOG'||r.cur.route==='WEB'), planAI=ROWS.filter(r=>isAI(r.plan.route));
const wasted=rs=>rs.filter(r=>r.exp.route==='LOCAL'||r.exp.route==='CLARIFY'||r.exp.route==='COACH').length;
const byExp={}; ['LOCAL','AI','WEB','CLARIFY','COACH'].forEach(k=>{ const rs=ROWS.filter(r=>r.exp.route===k); byExp[k]={ n:rs.length, cur:rs.filter(r=>r.cur.okStrict).length, plan:rs.filter(r=>r.okStrict).length }; });
const cats=[...new Set(Qs.map(q=>q.category))], byCat={}; cats.forEach(c=>byCat[c]=M(r=>r.cat===c));
times.sort((a,b)=>a-b); const p95=times[Math.floor(times.length*0.95)], tmax=times[times.length-1], tmed=times[Math.floor(times.length/2)];

console.log('\n=== VERO QueryPlan shadow comparison — core set (144) ===');
console.log('Category    | Qs | route cur→plan (strict) | intent | type  | constraints | derived cur→plan | AGREE IMPR REGR BOTHX');
cats.forEach(c=>{ const x=byCat[c]; console.log((c+'            ').slice(0,12)+'| '+String(x.n).padStart(2)+' | '+(x.curStrict+'→'+x.planStrict).padStart(23)+' | '+(x.intent+'/'+x.n).padStart(6)+' | '+(x.typeOf?x.type+'/'+x.typeOf:'-').padStart(5)+' | '+(x.consOf?x.cons+'/'+x.consOf:'-').padStart(11)+' | '+(x.derOf?x.derCur+'→'+x.derPlan+' /'+x.derOf:'-').padStart(16)+' | '+[x.cls.AGREE||0,x.cls.IMPROVED||0,x.cls.REGRESSED||0,x.cls['BOTH WRONG']||0].map(v=>String(v).padStart(4)).join(' ')); });
console.log(`\nRoute accuracy excl. COACH (benchmark rule): current ${ALLM.curBench}/${ALLM.of} (${pct(ALLM.curBench,ALLM.of)}%) → plan ${ALLM.planBench}/${ALLM.of} (${pct(ALLM.planBench,ALLM.of)}%)`);
console.log(`Route accuracy strict (CLARIFY must clarify, COACH must be COACH_FUTURE, LOCAL must not be a clarifier): current ${ALLM.curStrict}/144 → plan ${ALLM.planStrict}/144`);
console.log('  by expected route (strict, cur→plan): '+Object.entries(byExp).map(([k,v])=>k+' '+v.cur+'→'+v.plan+'/'+v.n).join(' · '));
console.log(`AI/WEB calls: current ${curAI.length} (wasted ${wasted(curAI)}) → plan ${planAI.length} (wasted ${wasted(planAI)})  [wasted = AI/WEB on a question expected LOCAL / CLARIFY / COACH]`);
console.log(`Intent agreement ${ALLM.intent}/144 · type ${ALLM.type}/${ALLM.typeOf} · constraints ${ALLM.cons}/${ALLM.consOf} · data-derived SKU checks current ${ALLM.derCur}/${ALLM.derOf} → plan ${ALLM.derPlan}/${ALLM.derOf}`);
console.log(`Named-SKU inclusion in plan AI/WEB candidates: ${named.length-namedMiss.length}/${named.length} · candidate family purity: ${planAI.filter(r=>!r.plan.purity||r.plan.purity.pure===r.plan.purity.of).length}/${planAI.length}`);
console.log(`Classification: AGREE ${ALLM.cls.AGREE||0} · IMPROVED ${ALLM.cls.IMPROVED||0} · REGRESSED ${ALLM.cls.REGRESSED||0} · BOTH WRONG ${ALLM.cls['BOTH WRONG']||0}`);
const reg=ROWS.filter(r=>r.cls==='REGRESSED'), both=ROWS.filter(r=>r.cls==='BOTH WRONG');
console.log('REGRESSED: '+(reg.map(r=>r.id+'('+r.exp.route+'/'+r.exp.intent+' → plan '+r.plan.route+'/'+r.plan.intent+')').join(', ')||'none'));
console.log('BOTH WRONG: '+(both.map(r=>r.id+'(plan '+r.plan.route+'/'+r.plan.intent+')').join(', ')||'none'));
const dReg=ROWS.filter(r=>r.derive&&r.derive.cur&&!r.derive.plan), dImp=ROWS.filter(r=>r.derive&&!r.derive.cur&&r.derive.plan);
console.log('Derived-SKU improved: '+(dImp.map(r=>r.id).join(', ')||'none')+' · regressed: '+(dReg.map(r=>r.id).join(', ')||'none'));
console.log(`Timing: facts build ${factsMs}ms (once) · plan build median ${tmed.toFixed(1)}ms · p95 ${p95.toFixed(1)}ms · max ${tmax.toFixed(1)}ms`);
if(VERBOSE) ROWS.forEach(r=>console.log(JSON.stringify(r)));
const OUT={ summary:{ all:ALLM, byExpectedRoute:byExp, ai:{ current:curAI.length, currentWasted:wasted(curAI), plan:planAI.length, planWasted:wasted(planAI) }, namedSku:{ of:named.length, ok:named.length-namedMiss.length }, timing:{ factsMs, medianMs:tmed, p95Ms:p95, maxMs:tmax } }, byCategory:byCat, rows:ROWS };
if(arg('--json')) fs.writeFileSync(arg('--json'),JSON.stringify(OUT,null,1));
console.log(`\nVERO QueryPlan shadow: ${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
