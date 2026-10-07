/* VERO sales-question benchmark runner (Local Brain Foundation Step 1).
   Run:  node tests/vero-sales-benchmark.js [--heldout <file>] [--json <out.json>] [--verbose]
   Source of truth: tests/vero-sales-questions.json (144 core questions from the 2026-10-06 stress test).
   What it does
     1. validates the benchmark file (structure, ids, categories, context sequences)
     2. reproduces the recorded p2r2 baseline metrics from the stored ratings / routes
     3. replays every question through the CURRENT engine in Node (same call the browser makes) and checks the
        route against the route recorded live on p2r2.1 (6a5220d) — proves the current answer path is unchanged
     4. evaluates data-derived expectations (expectedSKU.derive) against data/products.json — no hardcoded winners
     5. evaluates safety behaviours on the current answers (report)
     6. checks that no benchmark question text / referenced SKU or model leaks into production js/
     7. held-out set: loaded only from tests/vero-sales-heldout.json (or --heldout); reported separately, never mixed
   Exit code 1 only for structural, baseline, route-replay or leakage failures. Derive / safety results are diagnostic. */
const fs=require('fs'), path=require('path');
const ROOT=path.join(__dirname,'..');
const argv=process.argv.slice(2), arg=(k)=>{ const i=argv.indexOf(k); return i>=0?argv[i+1]:null; };
const VERBOSE=argv.includes('--verbose');

global.window={ PRICE_SETTINGS:{ indicatorDays:30 } };
eval(fs.readFileSync(path.join(ROOT,'js','helpers.js'),'utf8'));
require(path.join(ROOT,'js','vero-nlu.js'));
const E=require(path.join(ROOT,'js','vero-engine.js'));
const ALL=JSON.parse(fs.readFileSync(path.join(ROOT,'data','products.json'),'utf8'));
pcResolveSchedule(ALL);
const PUB=ALL.filter(p=>!p.disabled);
const BENCH=JSON.parse(fs.readFileSync(path.join(__dirname,'vero-sales-questions.json'),'utf8'));

let pass=0, fail=0; const failures=[];
const chk=(n,c,extra)=>{ if(c){ pass++; if(VERBOSE) console.log('PASS - '+n); } else { fail++; failures.push(n); console.log('FAIL - '+n+(extra?'  -> '+String(extra).slice(0,400):'')); } };
const pct=(a,b)=>b?Math.round(a/b*1000)/10:0;

/* ---------------- 1. structure ---------------- */
const ROUTES=['LOCAL','AI','WEB','CLARIFY','COACH'];
const RATINGS=['PASS','PARTIAL','FAIL','WRONG ROUTE','POOR SALES UX','UNSAFE'];
const ACTUAL=['LOCAL','LOCAL+offer','CATALOG','WEB'];
const CHECKS=['lookup','first','top','set','count','contains','empty'];
function validate(items,setName){
  const errs=[], ids=new Set();
  items.forEach((q,i)=>{
    const where=(q&&q.id)||('#'+i);
    ['id','set','question','language','category','expectedRoute','expectedIntent','expectedConstraints','expectedSafetyBehavior'].forEach(k=>{ if(q[k]===undefined) errs.push(where+': missing '+k); });
    if(ids.has(q.id)) errs.push(where+': duplicate id'); ids.add(q.id);
    if(q.set!==setName) errs.push(where+': set must be '+setName);
    if(!ROUTES.includes(q.expectedRoute)) errs.push(where+': bad expectedRoute '+q.expectedRoute);
    if(!['en','taglish'].includes(q.language)) errs.push(where+': bad language');
    if(!Array.isArray(q.expectedSafetyBehavior)) errs.push(where+': expectedSafetyBehavior must be an array');
    if(typeof q.question!=='string'||q.question.trim().length<3) errs.push(where+': empty question');
    if(q.contextFrom!=null){ const j=items.findIndex(x=>x.id===q.contextFrom); if(j<0||j>=i) errs.push(where+': contextFrom must point to an EARLIER question'); }
    if(q.expectedSKU){ if(!Array.isArray(q.expectedSKU.where)||!CHECKS.includes(q.expectedSKU.check)) errs.push(where+': bad expectedSKU derive'); }
    if(setName==='core'){
      const b=q.baseline||{};
      if(!RATINGS.includes(b.rating)) errs.push(where+': bad baseline.rating');
      if(!ACTUAL.includes(b.actualRoute)) errs.push(where+': bad baseline.actualRoute');
      if(!q.recordedP2r21||!ACTUAL.includes(q.recordedP2r21.actualRoute)) errs.push(where+': bad recordedP2r21.actualRoute');
    }
  });
  return errs;
}
const Qs=BENCH.questions;
chk('B01 benchmark loads: 144 core questions', Array.isArray(Qs)&&Qs.length===144, Qs&&Qs.length);
const verr=validate(Qs,'core');
chk('B02 benchmark structure valid (ids, fields, enums, context order, derive shape)', !verr.length, verr.slice(0,5).join(' | '));
const cats=[...new Set(Qs.map(q=>q.category))];
chk('B03 21 categories preserved', cats.length===21, cats.join(','));
const seq={L04:'L03',L06:'L05',P02:'P01',P03:'P01',P04:'P01',T08:'T07',U02:'U01'};
chk('B04 context sequences preserved', Object.entries(seq).every(([a,b])=>(Qs.find(q=>q.id===a)||{}).contextFrom===b));
const er={}; Qs.forEach(q=>er[q.expectedRoute]=(er[q.expectedRoute]||0)+1);
chk('B05 expected routes LOCAL 106 · AI 16 · WEB 11 · CLARIFY 6 · COACH 5', er.LOCAL===106&&er.AI===16&&er.WEB===11&&er.CLARIFY===6&&er.COACH===5, JSON.stringify(er));

/* ---------------- 2. baseline metrics (recorded p2r2 ratings + routes) ---------------- */
function routeOk(exp,act){
  if(exp==='LOCAL') return act==='LOCAL'||act==='LOCAL+offer';
  if(exp==='AI') return act==='CATALOG'||act==='WEB';
  if(exp==='WEB') return act==='WEB';
  if(exp==='CLARIFY') return act==='LOCAL'||act==='LOCAL+offer';
  return null;                                                         /* COACH: excluded */
}
const isAI=a=>a==='CATALOG'||a==='WEB';
function metrics(items,routeOf){
  const m={ n:items.length, pass:0, partial:0, route:{ok:0,of:0}, routeBy:{}, ai:0, wasted:0, ratings:{} };
  items.forEach(q=>{
    const r=q.baseline&&q.baseline.rating; if(r){ m.ratings[r]=(m.ratings[r]||0)+1; if(r==='PASS') m.pass++; if(r==='PARTIAL') m.partial++; }
    const act=routeOf(q), ok=routeOk(q.expectedRoute,act);
    if(ok!==null){ m.route.of++; if(ok) m.route.ok++; const k=q.expectedRoute; m.routeBy[k]=m.routeBy[k]||{ok:0,of:0}; m.routeBy[k].of++; if(ok) m.routeBy[k].ok++; }
    if(isAI(act)){ m.ai++; if(r==='WRONG ROUTE') m.wasted++; }
  });
  return m;
}
const BM=metrics(Qs,q=>q.baseline.actualRoute), BL=BENCH.baselineMetrics;
chk('B06 baseline PASS 63/144 = 43.8%', BM.pass===BL.pass && pct(BM.pass,BM.n)===BL.passPct, BM.pass);
chk('B07 baseline PASS+PARTIAL 89/144 = 61.8%', BM.pass+BM.partial===BL.passOrPartial && pct(BM.pass+BM.partial,BM.n)===BL.passOrPartialPct, BM.pass+BM.partial);
chk('B08 baseline route accuracy excl. COACH 112/139 = 80.6%', BM.route.ok===112&&BM.route.of===139&&pct(BM.route.ok,BM.route.of)===BL.routeAccuracyExclCoach.pct, JSON.stringify(BM.route));
chk('B09 baseline route split LOCAL 99/106 · AI 10/16 · WEB 2/11 · CLARIFY 1/6',
  BM.routeBy.LOCAL.ok===99&&BM.routeBy.AI.ok===10&&BM.routeBy.WEB.ok===2&&BM.routeBy.CLARIFY.ok===1, JSON.stringify(BM.routeBy));
chk('B10 baseline AI calls 32, wasted 17', BM.ai===32&&BM.wasted===17, BM.ai+'/'+BM.wasted);
chk('B11 baseline rating counts 63/26/30/19/4/2', JSON.stringify(BM.ratings)===JSON.stringify({PASS:63,PARTIAL:26,FAIL:30,'WRONG ROUTE':19,'POOR SALES UX':4,UNSAFE:2})||
  ['PASS','PARTIAL','FAIL','WRONG ROUTE','POOR SALES UX','UNSAFE'].every((k,i)=>BM.ratings[k]===[63,26,30,19,4,2][i]), JSON.stringify(BM.ratings));

/* ---------------- 3. current-engine replay (Node) ---------------- */
const byCode={}; PUB.forEach(p=>byCode[String(p.item_code)]=p);
function replay(q){
  const r=E.answer(PUB,q.question,{}), a=E.aiRoute(PUB,q.question,r,{});
  const route=a.route==='local'?(a.canEscalate?'LOCAL+offer':'LOCAL'):a.route.toUpperCase();
  return { r, a, route };
}
const RUN={}; let same=0; const diff=[];
const t0=Date.now();
Qs.forEach(q=>{ const x=replay(q); RUN[q.id]=x; if(x.route===q.recordedP2r21.actualRoute) same++; else diff.push(q.id+' rec='+q.recordedP2r21.actualRoute+' now='+x.route); });
const replayMs=Date.now()-t0;
chk('B12 current engine routes = routes recorded live on p2r2.1 (144/144)', same===Qs.length, diff.slice(0,10).join(' | '));
const CM=metrics(Qs,q=>RUN[q.id].route);

/* ---------------- 4. data-derived expectations ---------------- */
const nameOf=p=>String(p.product_name||'');
const NUM={
  wattsName:p=>E.productWatts(p),
  wattsAny:p=>{ const n=E.productWatts(p); if(n!=null) return n; let best=null; String(p.features||'').split(/\r?\n|[▪•;|]/).forEach(l=>{ if(!/(max|up to|support|charging|output|power|pd)/i.test(l)) return; (l.match(/(\d{2,3})\s?w\b/gi)||[]).forEach(x=>{ const v=parseInt(x,10); if(best==null||v>best) best=v; }); }); return best; },
  mahName:p=>{ const m=nameOf(p).replace(/,/g,'').match(/(\d{4,6})\s?mAh/i); return m?parseInt(m[1],10):null; },
  lengthM:p=>E.lenMeters(p.length), srp:p=>Number(p.srp), dp:p=>Number(p.dp)
};
const OPS={'==':(a,b)=>a!=null&&Math.abs(a-b)<1e-9,'>=':(a,b)=>a!=null&&a>=b-1e-9,'<=':(a,b)=>a!=null&&a<=b+1e-9,'>':(a,b)=>a!=null&&a>b+1e-9,'<':(a,b)=>a!=null&&a<b-1e-9};
function clause(p,c){
  if(c.any) return c.any.some(x=>clause(p,x));
  if(c.field) return c.in.includes(String(p[c.field]||''));
  if(c.nameRe) return new RegExp(c.nameRe,'i').test(nameOf(p));
  if(c.nameNotRe) return !new RegExp(c.nameNotRe,'i').test(nameOf(p));
  if(c.textRe) return c.fields.some(f=>new RegExp(c.textRe,'i').test(String(p[f]||'')));
  if(c.num) return OPS[c.op](NUM[c.num](p),c.v);
  if(c.colorRe) return new RegExp(c.colorRe,'i').test(String(p.color||''));
  if(c.codeOrModel){ const k=String(c.codeOrModel).toLowerCase().replace(/\s+/g,''); return String(p.item_code).toLowerCase()===k || String(p.model||'').toLowerCase().replace(/\s+/g,'')===k; }
  throw new Error('unknown derive clause '+JSON.stringify(c));
}
function derive(d){
  let rows=PUB.filter(p=>d.where.every(c=>clause(p,c)));
  if(d.order) rows.sort((a,b)=>{ for(const [f,dir] of d.order){ const va=NUM[f]?NUM[f](a):a[f], vb=NUM[f]?NUM[f](b):b[f];
    const x=(va==null?-Infinity:va), y=(vb==null?-Infinity:vb); if(x<y) return dir==='asc'?-1:1; if(x>y) return dir==='asc'?1:-1; } return 0; });
  return rows.map(p=>String(p.item_code));
}
function judge(d,exp,codes){
  const s=a=>JSON.stringify([...a].sort());
  switch(d.check){
    case 'lookup': return exp.length>0 && exp.includes(codes[0]);
    case 'first': return exp.length>0 && codes[0]===exp[0];
    case 'top': return exp.length>0 && JSON.stringify(codes.slice(0,d.take))===JSON.stringify(exp.slice(0,d.take));
    case 'set': return s(codes)===s(exp);
    case 'count': return codes.length===exp.length;
    case 'contains': return exp.length>0 && exp.every(c=>codes.includes(c));
    case 'empty': return exp.length===0;
  }
}
const DER=[]; Qs.forEach(q=>{ if(!q.expectedSKU) return; const exp=derive(q.expectedSKU); const codes=RUN[q.id].r.codes||[];
  let confirmed=codes; const note=RUN[q.id].r.note||''; const yes=note.match(/^(?:Yes — )?(\d+) /);
  if(q.expectedSKU.check==='set' && yes && /not explicitly confirmed|mentioned only/.test(note)) confirmed=codes.slice(0,+yes[1]);  /* confirmed part of an evidence-tiered answer */
  if(q.expectedSKU.check==='empty') confirmed=/^No\b/.test(note)?[]:codes;
  DER.push({ id:q.id, check:q.expectedSKU.check, expected:exp.slice(0,12), expectedCount:exp.length, got:confirmed.slice(0,12), ok:q.expectedSKU.check==='empty'?(exp.length===0&&/^No\b/.test(note)):judge(q.expectedSKU,exp,confirmed), baseline:q.baseline.rating }); });
chk('B13 every derive expression evaluates against products.json (lookups resolve)', DER.length>0 && DER.filter(d=>d.check==='lookup').every(d=>d.expectedCount>0), DER.filter(d=>d.check==='lookup'&&!d.expectedCount).map(d=>d.id).join(','));

/* ---------------- 5. safety behaviours (diagnostic) ---------------- */
function refCodes(q){ const c=q.expectedConstraints||{}; const refs=[].concat(c.ref||[],c.refs||[]).filter(r=>r&&r[0]!=='@');
  const out=[]; refs.forEach(r=>{ const k=String(r).toLowerCase().replace(/\s+/g,''); PUB.forEach(p=>{ if(String(p.item_code).toLowerCase()===k||String(p.model||'').toLowerCase().replace(/\s+/g,'')===k) out.push(String(p.item_code)); }); }); return out; }
const SAF={
  no_stock_claim:(q,x)=>!/\b(in stock|we have \d+ (?:units|pcs)|available stocks? (?:is|are)|meron pang stock)\b/i.test(x.r.note||'') || /can’t confirm stock|can't confirm stock/.test(x.r.note||''),
  /* engine-level only: the caveat text is attached by the engine (stockNote/note); whether every UI path renders it is a browser check */
  no_stock_claim_caveat:(q,x)=>!/\b(stock|on hand|in stock)\b/i.test(q.question) || /confirm stock/.test(x.r.note||'')||!!x.r.stockNote,
  magsafe_not_magnetic:(q,x)=>{ const n=x.r.note||''; const m=n.match(/^Yes — (\d+)/); const conf=m?(x.r.codes||[]).slice(0,+m[1]):[]; return conf.every(c=>/mag\s?safe/i.test(nameOf(byCode[c])+' '+(byCode[c].features||''))); },
  qi_not_qi2:(q,x)=>{ const n=x.r.note||''; const m=n.match(/^Yes — (\d+)/); const conf=m?(x.r.codes||[]).slice(0,+m[1]):[]; return conf.every(c=>/\bqi\s?2/i.test(nameOf(byCode[c])+' '+(byCode[c].features||''))); },
  no_compat_guess:(q,x)=>!/\b(is|are) compatible with\b|\bworks with your\b|\bwill work with\b/i.test(x.r.note||''),
  named_sku_in_candidates:(q,x)=>{ if(x.a.route==='local') return true; const want=refCodes(q); return !want.length || want.some(c=>x.a.candidates.includes(c)); },
  no_ai_without_intent:(q,x)=>x.a.route==='local'
};
const SR={}; Qs.forEach(q=>{ (q.expectedSafetyBehavior||[]).forEach(k=>{ if(!SAF[k]) return; SR[k]=SR[k]||{n:0,ok:0,fail:[]}; SR[k].n++; if(SAF[k](q,RUN[q.id])) SR[k].ok++; else SR[k].fail.push(q.id); });
  if(q.category==='Stock'){ const k='no_stock_claim_caveat'; SR[k]=SR[k]||{n:0,ok:0,fail:[]}; SR[k].n++; if(SAF[k](q,RUN[q.id])) SR[k].ok++; else SR[k].fail.push(q.id); } });
chk('B14 no confirmed MagSafe / Qi2 item without name-or-feature evidence (hard safety rule)', ['magsafe_not_magnetic','qi_not_qi2'].every(k=>!SR[k]||!SR[k].fail.length), JSON.stringify(SR.magsafe_not_magnetic)+JSON.stringify(SR.qi_not_qi2));
chk('B15 no affirmative stock claim on any answer', Qs.every(q=>SAF.no_stock_claim(q,RUN[q.id])));

/* ---------------- 6. leakage into production js/ ---------------- */
const JS=fs.readdirSync(path.join(ROOT,'js')).filter(f=>f.endsWith('.js')).map(f=>({f, s:fs.readFileSync(path.join(ROOT,'js',f),'utf8')}));
const norm=s=>s.toLowerCase().replace(/\s+/g,' ');
const leakQ=[]; Qs.forEach(q=>{ const t=norm(q.question).replace(/[?!.]+$/,''); if(t.length<12) return; JS.forEach(j=>{ if(norm(j.s).includes(t)) leakQ.push(q.id+'@'+j.f); }); });
chk('B16 no benchmark question text in production js/', !leakQ.length, leakQ.join(','));
const refTok=new Set(); Qs.forEach(q=>{ const c=q.expectedConstraints||{}; [].concat(c.ref||[],c.refs||[]).filter(r=>r&&r[0]!=='@').forEach(r=>{ refTok.add(String(r).toUpperCase()); refCodes(q).forEach(x=>refTok.add(x.toUpperCase())); }); });
DER.forEach(d=>d.expected.forEach(c=>refTok.add(c.toUpperCase())));
const leakS=[]; JS.filter(j=>/^vero-/.test(j.f)).forEach(j=>{ const toks=new Set((j.s.toUpperCase().match(/\b[0-9A-Z]{4,10}\b/g)||[])); refTok.forEach(t=>{ if(/\d/.test(t)&&toks.has(t)) leakS.push(t+'@'+j.f); }); });
chk('B17 no benchmark SKU / model / derived winner in production js/vero-*.js', !leakS.length, leakS.join(','));
const codes=new Set(ALL.map(p=>String(p.item_code).toUpperCase()));
const leakC=[]; JS.filter(j=>/^vero-/.test(j.f)).forEach(j=>{ (j.s.toUpperCase().match(/\b\d{5}[A-Z]{0,2}\b/g)||[]).forEach(t=>{ if(codes.has(t)) leakC.push(t+'@'+j.f); }); });
chk('B18 no catalog item code anywhere in production js/vero-*.js', !leakC.length, leakC.join(','));

/* ---------------- 7. held-out (reserved) ---------------- */
const HO=arg('--heldout')||path.join(__dirname,'vero-sales-heldout.json');
let held={ file:path.relative(ROOT,HO), loaded:0, note:'not present — reserved for real pilot questions' };
if(fs.existsSync(HO)){
  const H=JSON.parse(fs.readFileSync(HO,'utf8')), hq=H.questions||[], herr=validate(hq,'heldout');
  const coreIds=new Set(Qs.map(q=>q.id)), coreText=new Set(Qs.map(q=>norm(q.question)));
  chk('B19 held-out file valid and disjoint from core', !herr.length && hq.every(q=>!coreIds.has(q.id)&&!coreText.has(norm(q.question))), herr.slice(0,3).join(' | '));
  const hr={}; hq.forEach(q=>{ const x=replay(q); const ok=routeOk(q.expectedRoute,x.route); hr[q.category]=hr[q.category]||{n:0,routeOk:0}; hr[q.category].n++; if(ok) hr[q.category].routeOk++; });
  held={ file:held.file, loaded:hq.length, byCategory:hr };
}

/* ---------------- report ---------------- */
const byCat={}; Qs.forEach(q=>{ const c=byCat[q.category]=byCat[q.category]||{n:0,pass:0,usable:0,routeOkBase:0,routeOkNow:0,routeOf:0,derive:0,deriveOk:0};
  c.n++; if(q.baseline.rating==='PASS') c.pass++; if(q.baseline.rating==='PASS'||q.baseline.rating==='PARTIAL') c.usable++;
  const ob=routeOk(q.expectedRoute,q.baseline.actualRoute), on=routeOk(q.expectedRoute,RUN[q.id].route); if(ob!==null){ c.routeOf++; if(ob) c.routeOkBase++; if(on) c.routeOkNow++; }
  const d=DER.find(x=>x.id===q.id); if(d){ c.derive++; if(d.ok) c.deriveOk++; } });
console.log('\n=== VERO sales benchmark — core set (144) ===');
console.log('Category       | Qs | PASS | usable | route(base) | route(now) | derived ok');
Object.entries(byCat).forEach(([k,c])=>console.log((k+'               ').slice(0,15)+'| '+String(c.n).padStart(2)+' | '+String(c.pass).padStart(4)+' | '+String(c.usable).padStart(6)+' | '+(c.routeOkBase+'/'+c.routeOf).padStart(11)+' | '+(c.routeOkNow+'/'+c.routeOf).padStart(10)+' | '+(c.derive?c.deriveOk+'/'+c.derive:'-')));
const catPassAvg=Math.round(Object.values(byCat).reduce((a,c)=>a+c.pass/c.n,0)/Object.keys(byCat).length*1000)/10;
console.log(`\nBaseline (p2r2 0f4b3eb, recorded): PASS ${BM.pass}/144 (${pct(BM.pass,144)}%) · PASS+PARTIAL ${BM.pass+BM.partial} (${pct(BM.pass+BM.partial,144)}%) · route excl. COACH ${BM.route.ok}/${BM.route.of} (${pct(BM.route.ok,BM.route.of)}%) · AI calls ${BM.ai}, wasted ${BM.wasted}`);
console.log(`Category-balanced PASS (mean of 21 category pass rates): ${catPassAvg}%`);
console.log(`Current engine (${E.version}) replay: routes identical to recorded p2r2.1 ${same}/144 · route excl. COACH ${CM.route.ok}/${CM.route.of} (${pct(CM.route.ok,CM.route.of)}%) · AI calls ${CM.ai} · replay ${replayMs}ms`);
console.log(`Data-derived expectations: ${DER.filter(d=>d.ok).length}/${DER.length} match the current answer. Mismatches: `+DER.filter(d=>!d.ok).map(d=>d.id+'('+d.baseline+')').join(', '));
console.log('Safety behaviours (current answers): '+Object.entries(SR).map(([k,v])=>k+' '+v.ok+'/'+v.n+(v.fail.length?' ['+v.fail.join(',')+']':'')).join(' · '));
console.log('Held-out: '+(held.loaded?held.loaded+' loaded from '+held.file:held.note));
if(arg('--json')) fs.writeFileSync(arg('--json'),JSON.stringify({ baseline:BM, current:CM, byCategory:byCat, derive:DER, safety:SR, heldOut:held, replayRoutes:Object.fromEntries(Qs.map(q=>[q.id,RUN[q.id].route])) },null,1));
console.log(`\nVERO sales benchmark: ${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
