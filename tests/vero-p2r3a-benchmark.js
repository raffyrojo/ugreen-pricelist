/* VERO p2r3a benchmark — the 144 core questions through the NEW answer path (Local Brain loaded), exactly as the browser calls it:
   VeroEngine.answer(pool, q, {conv}) -> res, then VeroEngine.aiRoute(pool, q, res) -> route + candidates.
   Follow-ups (contextFrom) are replayed as a conversation: the earlier question's ctxOut becomes the context.
   Also: the p2r2.1 answer for the same question (legacy path, same process) so every behaviour change is listed,
   and a Worker-final route simulation (backend/vero/worker.js webDecision — the Worker keeps the final web/catalog say).
   Run: node tests/vero-p2r3a-benchmark.js [--json out.json] [--verbose]
   Exit 1 on: structural failure, safety failure, AI/WEB without a product, < 2 candidates on an AI/WEB call, named SKU not first. */
const fs=require('fs'), path=require('path');
const ROOT=path.join(__dirname,'..');
const argv=process.argv.slice(2), arg=k=>{ const i=argv.indexOf(k); return i>=0?argv[i+1]:null; };
global.window={ PRICE_SETTINGS:{ indicatorDays:30 } };
eval(fs.readFileSync(path.join(ROOT,'js','helpers.js'),'utf8'));
['vero-lexicon','vero-nlu','vero-facts','vero-plan','vero-compose'].forEach(f=>require(path.join(ROOT,'js',f+'.js')));
const E=require(path.join(ROOT,'js','vero-engine.js'));
const ALL=JSON.parse(fs.readFileSync(path.join(ROOT,'data','products.json'),'utf8')); pcResolveSchedule(ALL);
const PUB=ALL.filter(p=>!p.disabled), byCode={}; PUB.forEach(p=>byCode[String(p.item_code)]=p);
const Qs=JSON.parse(fs.readFileSync(path.join(__dirname,'vero-sales-questions.json'),'utf8')).questions;
let pass=0, fail=0; const chk=(n,c,x)=>{ if(c){ pass++; if(argv.includes('--verbose')) console.log('PASS - '+n); } else { fail++; console.log('FAIL - '+n+(x?'  -> '+String(x).slice(0,500):'')); } };
const pct=(a,b)=>b?Math.round(a/b*1000)/10:0;

(async()=>{
const W=await import(require('url').pathToFileURL(path.join(ROOT,'backend','vero','worker.js')).href);
const route=(a,r)=>a.route==='local'?((r.type==='clarify')?'CLARIFY':(a.canEscalate?'LOCAL+offer':'LOCAL')):a.route.toUpperCase();
function workerFinal(q,a){ if(a.route==='local') return null; if(a.candidates.length<2) return 'REJECTED(422)';
  const dec=W.webDecision(q,a.candidates.map(c=>[byCode[c].product_name,byCode[c].features,byCode[c].description].join(' ')));
  return (a.route==='web' && dec.web)?'WEB':'CATALOG'; }
const NEW={}, OLD={}, CTX={};
const t0=Date.now(), times=[];
Qs.forEach(q=>{
  const conv=q.contextFrom?CTX[q.contextFrom]:null;
  const s=process.hrtime.bigint(); const r=E.answer(PUB,q.question,{ conv }); const a=E.aiRoute(PUB,q.question,r,{}); times.push(Number(process.hrtime.bigint()-s)/1e6);
  CTX[q.id]=r.ctxOut||conv; NEW[q.id]={ r, a, route:route(a,r), worker:workerFinal(q.question,a) };
  const lr=E.legacyAnswer(PUB,q.question,{}), la=E.aiRoute(PUB,q.question,lr,{});            /* p2r2.1 path, no context (as live today) */
  OLD[q.id]={ r:lr, a:la, route:route(la,lr) };
});
const ms=Date.now()-t0;

/* ---------- route accuracy (strict) ---------- */
function ok(exp,act){ if(exp==='LOCAL') return act==='LOCAL'||act==='LOCAL+offer'; if(exp==='AI') return act==='CATALOG'||act==='WEB'; if(exp==='WEB') return act==='WEB'; if(exp==='CLARIFY') return act==='CLARIFY'; if(exp==='COACH') return act==='LOCAL'; return false; }
function okBench(exp,act){ if(exp==='CLARIFY') return act!=='CATALOG'&&act!=='WEB'; if(exp==='COACH') return null; return ok(exp,act); }
const isAI=x=>x==='CATALOG'||x==='WEB';
const M={ new:{ok:0,bench:0,of:0,ai:0,wasted:0,by:{}}, old:{ok:0,bench:0,of:0,ai:0,wasted:0,by:{}} };
Qs.forEach(q=>{ [['new',NEW],['old',OLD]].forEach(([k,S])=>{ const x=S[q.id], m=M[k];
  const o=q.expectedRoute==='COACH'?(k==='new'?x.r.plan&&x.r.plan.route.route==='COACH_FUTURE':false):ok(q.expectedRoute,x.route);
  if(o) m.ok++; m.by[q.expectedRoute]=m.by[q.expectedRoute]||{ok:0,of:0}; m.by[q.expectedRoute].of++; if(o) m.by[q.expectedRoute].ok++;
  const b=okBench(q.expectedRoute,x.route); if(b!==null){ m.of++; if(b) m.bench++; }
  if(isAI(x.route)){ m.ai++; if(['LOCAL','CLARIFY','COACH'].includes(q.expectedRoute)) m.wasted++; } }); });
const wf={ WEB:0, CATALOG:0, REJECTED:0 }; Qs.forEach(q=>{ const w=NEW[q.id].worker; if(!w) return; if(/REJ/.test(w)) wf.REJECTED++; else wf[w]++; });
const webExp=Qs.filter(q=>q.expectedRoute==='WEB'), webFinal=webExp.filter(q=>NEW[q.id].worker==='WEB').length;

/* ---------- rules on AI/WEB calls ---------- */
const aiRows=Qs.filter(q=>isAI(NEW[q.id].route));
chk('P01 every AI/WEB call has >= 2 candidates (Worker minimum)', aiRows.every(q=>NEW[q.id].a.candidates.length>=2), aiRows.filter(q=>NEW[q.id].a.candidates.length<2).map(q=>q.id).join(','));
chk('P02 no AI/WEB call without an identified product (anchor, type, use case or context)', aiRows.every(q=>{ const p=NEW[q.id].r.plan; return p && (p.subject.length||p.type||p.useCase); }));
const anch=aiRows.filter(q=>NEW[q.id].r.plan.anchors.some(a=>a.codes.length));
chk('P03 named SKU / model = candidate #1 on every anchored AI/WEB call ('+anch.length+')', anch.every(q=>{ const p=NEW[q.id].r.plan, want=[].concat(...p.anchors.map(a=>a.codes)); return want.includes(NEW[q.id].a.candidates[0]); }), anch.filter(q=>{ const p=NEW[q.id].r.plan, want=[].concat(...p.anchors.map(a=>a.codes)); return !want.includes(NEW[q.id].a.candidates[0]); }).map(q=>q.id).join(','));
const pure=aiRows.filter(q=>{ const p=NEW[q.id].r.plan, c=NEW[q.id].a.candidates; const fams=p.type?[p.type.family]:(p.useCase?p.useCase.families:null);
  const F=require(path.join(ROOT,'js','vero-facts.js')).build(PUB); return !fams || c.every(x=>fams.includes(F.byCode[x].type.family)); });
chk('P04 AI/WEB candidates stay in the plan family', pure.length===aiRows.length, aiRows.filter(q=>!pure.includes(q)).map(q=>q.id).join(','));
chk('P05 coach questions never reach AI', Qs.filter(q=>q.expectedRoute==='COACH').every(q=>!isAI(NEW[q.id].route)));
chk('P06 vague questions (expected CLARIFY) never reach AI', Qs.filter(q=>q.expectedRoute==='CLARIFY').every(q=>!isAI(NEW[q.id].route)));
chk('P07 the AI payload candidates are item codes that exist in the pool', aiRows.every(q=>NEW[q.id].a.candidates.every(c=>!!byCode[c])));

/* ---------- safety on every answer ---------- */
const nameOf=p=>String(p.product_name||'');
const bad=[];
Qs.forEach(q=>{ const r=NEW[q.id].r, note=(r.note||'')+' '+(r.stockNote||'');
  if(/\b(in stock|we have \d+ (?:units|pcs)|available stocks? (?:is|are))\b/i.test(note) && !/confirm stock/.test(note)) bad.push(q.id+':stock-claim');
  if(/\b(stock|on hand|in stock)\b/i.test(q.question) && !r.stockNote && !(r.plan&&r.plan.intent==='price_history')) bad.push(q.id+':no-stock-caveat');
  if(/\b(equivalent|exact replacement|same as)\b/i.test(r.note||'')) bad.push(q.id+':equivalent-wording');
  if(/No products match/i.test(r.note||'')) bad.push(q.id+':robotic-no-match');
  const p=r.plan; if(!p) return;
  if(p.match.some(m=>m.k==='flag'&&m.v==='magsafe')) (p.result.codes||[]).forEach(c=>{ if(!/mag\s?safe/i.test(nameOf(byCode[c])+' '+(byCode[c].features||''))) bad.push(q.id+':magsafe-'+c); });
  if(p.match.some(m=>m.k==='flag'&&m.v==='qi2')) (p.result.codes||[]).forEach(c=>{ if(!/\bqi\s?2/i.test(nameOf(byCode[c])+' '+(byCode[c].features||''))) bad.push(q.id+':qi2-'+c); });
});
chk('P08 safety: no stock claim, stock caveat on every stock question, no "equivalent" wording, no "No products match", MagSafe/Qi2 only with name/feature evidence', !bad.length, bad.join(', '));

/* ---------- data-derived SKU checks (same language as vero-sales-benchmark.js) ---------- */
const NUM={ wattsName:p=>E.productWatts(p), wattsAny:p=>{ const n=E.productWatts(p); if(n!=null) return n; let best=null; String(p.features||'').split(/\r?\n|[▪•;|]/).forEach(l=>{ if(!/(max|up to|support|charging|output|power|pd)/i.test(l)) return; (l.match(/(\d{2,3})\s?w\b/gi)||[]).forEach(x=>{ const v=parseInt(x,10); if(best==null||v>best) best=v; }); }); return best; },
  mahName:p=>{ const m=nameOf(p).replace(/,/g,'').match(/(\d{4,6})\s?mAh/i); return m?parseInt(m[1],10):null; }, lengthM:p=>E.lenMeters(p.length), srp:p=>Number(p.srp), dp:p=>Number(p.dp) };
const OPS={'==':(a,b)=>a!=null&&Math.abs(a-b)<1e-9,'>=':(a,b)=>a!=null&&a>=b-1e-9,'<=':(a,b)=>a!=null&&a<=b+1e-9,'>':(a,b)=>a!=null&&a>b+1e-9,'<':(a,b)=>a!=null&&a<b-1e-9};
function clause(p,c){ if(c.any) return c.any.some(x=>clause(p,x)); if(c.field) return c.in.includes(String(p[c.field]||'')); if(c.nameRe) return new RegExp(c.nameRe,'i').test(nameOf(p)); if(c.nameNotRe) return !new RegExp(c.nameNotRe,'i').test(nameOf(p));
  if(c.textRe) return c.fields.some(f=>new RegExp(c.textRe,'i').test(String(p[f]||''))); if(c.num) return OPS[c.op](NUM[c.num](p),c.v); if(c.colorRe) return new RegExp(c.colorRe,'i').test(String(p.color||''));
  if(c.codeOrModel){ const k=String(c.codeOrModel).toLowerCase().replace(/\s+/g,''); return String(p.item_code).toLowerCase()===k||String(p.model||'').toLowerCase().replace(/\s+/g,'')===k; } throw new Error('clause'); }
function derive(d){ let rows=PUB.filter(p=>d.where.every(c=>clause(p,c))); if(d.order) rows.sort((a,b)=>{ for(const [f,dir] of d.order){ const va=NUM[f]?NUM[f](a):a[f], vb=NUM[f]?NUM[f](b):b[f]; const x=va==null?-Infinity:va, y=vb==null?-Infinity:vb; if(x<y) return dir==='asc'?-1:1; if(x>y) return dir==='asc'?1:-1; } return 0; }); return rows.map(p=>String(p.item_code)); }
function judge(d,exp,codes){ const s=a=>JSON.stringify([...a].sort()); switch(d.check){ case 'lookup': return exp.length>0&&exp.includes(codes[0]); case 'first': return exp.length>0&&codes[0]===exp[0]; case 'top': return exp.length>0&&JSON.stringify(codes.slice(0,d.take))===JSON.stringify(exp.slice(0,d.take)); case 'set': return s(codes)===s(exp); case 'count': return codes.length===exp.length; case 'contains': return exp.length>0&&exp.every(c=>codes.includes(c)); case 'empty': return codes.length===0; } }
function confirmedOld(q,r){ const codes=r.codes||[], note=r.note||'', yes=note.match(/^(?:Yes — )?(\d+) /); if(q.expectedSKU.check==='set'&&yes&&/not explicitly confirmed|mentioned only/.test(note)) return codes.slice(0,+yes[1]); if(q.expectedSKU.check==='empty') return /^No\b/.test(note)?[]:codes; return codes; }
function confirmedNew(r){ const p=r.plan; if(p && p.result && p.intent!=='attribute' && p.intent!=='lookup' && !(p.subject||[]).length) return p.result.codes; return r.codes||[]; }
const DER=[]; Qs.forEach(q=>{ if(!q.expectedSKU) return; const exp=derive(q.expectedSKU); DER.push({ id:q.id, cur:judge(q.expectedSKU,exp,confirmedOld(q,OLD[q.id].r)), now:judge(q.expectedSKU,exp,confirmedNew(NEW[q.id].r)) }); });

/* ---------- behaviour changes vs p2r2.1 (same process, no context for the old path) ---------- */
const norm=s=>String(s||'').replace(/\s+/g,' ').trim();
const CH=Qs.map(q=>{ const n=NEW[q.id], o=OLD[q.id];
  const kinds=[]; if(n.route!==o.route) kinds.push('route'); if(JSON.stringify(n.r.codes||[])!==JSON.stringify(o.r.codes||[])) kinds.push('codes'); if(norm(n.r.note)!==norm(o.r.note)) kinds.push('note'); if(n.r.type!==o.r.type) kinds.push('type');
  return { id:q.id, cat:q.category, q:q.question, kinds, old:{ route:o.route, type:o.r.type, n:(o.r.codes||[]).length, note:norm(o.r.note).slice(0,160) }, now:{ route:n.route, type:n.r.type, n:(n.r.codes||[]).length, echo:n.r.echo||null, note:norm(n.r.note).slice(0,160), worker:n.worker, cands:n.a.candidates } }; });
const changed=CH.filter(c=>c.kinds.length);

/* ---------- report ---------- */
times.sort((a,b)=>a-b);
console.log('\n=== VERO p2r3a benchmark — 144 core questions through the new path (follow-ups replayed with context) ===');
console.log(`Route accuracy, strict (CLARIFY must clarify, COACH must not reach AI and must be COACH_FUTURE): p2r2.1 ${M.old.ok}/144 → p2r3a ${M.new.ok}/144`);
console.log('  by expected route: '+Object.keys(M.new.by).map(k=>k+' '+M.old.by[k].ok+'→'+M.new.by[k].ok+'/'+M.new.by[k].of).join(' · '));
console.log(`Route accuracy excl. COACH (benchmark rule): p2r2.1 ${M.old.bench}/${M.old.of} (${pct(M.old.bench,M.old.of)}%) → p2r3a ${M.new.bench}/${M.new.of} (${pct(M.new.bench,M.new.of)}%)`);
console.log(`AI/WEB calls (frontend): p2r2.1 ${M.old.ai} (wasted ${M.old.wasted}) → p2r3a ${M.new.ai} (wasted ${M.new.wasted})  [wasted = AI/WEB on a question expected LOCAL / CLARIFY / COACH]`);
console.log(`Worker-final route of p2r3a AI/WEB calls (Worker unchanged): WEB ${wf.WEB} · CATALOG ${wf.CATALOG} · rejected ${wf.REJECTED} · expected-WEB questions that reach official-source web: ${webFinal}/${webExp.length}`);
console.log(`Data-derived SKU checks: p2r2.1 ${DER.filter(d=>d.cur).length}/${DER.length} → p2r3a ${DER.filter(d=>d.now).length}/${DER.length}. Fixed: ${DER.filter(d=>!d.cur&&d.now).map(d=>d.id).join(', ')||'none'} · regressed: ${DER.filter(d=>d.cur&&!d.now).map(d=>d.id).join(', ')||'none'} · still failing: ${DER.filter(d=>!d.now).map(d=>d.id).join(', ')||'none'}`);
console.log(`Behaviour changes vs p2r2.1: ${changed.length}/144 questions (route ${changed.filter(c=>c.kinds.includes('route')).length} · codes ${changed.filter(c=>c.kinds.includes('codes')).length} · wording ${changed.filter(c=>c.kinds.includes('note')).length}) — full list in --json`);
console.log(`Timing (Node, warm facts index): replay ${ms}ms incl. legacy · answer median ${times[72].toFixed(1)}ms · p95 ${times[136].toFixed(1)}ms · max ${times[143].toFixed(1)}ms`);
if(arg('--json')) fs.writeFileSync(arg('--json'),JSON.stringify({ metrics:M, workerFinal:wf, webFinal:{ ok:webFinal, of:webExp.length }, derive:DER, changes:CH, timing:{ median:times[72], p95:times[136], max:times[143] } },null,1));
console.log(`\nVERO p2r3a benchmark: ${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
})();
