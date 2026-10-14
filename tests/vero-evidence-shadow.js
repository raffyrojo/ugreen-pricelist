/* UNO Evidence & Retrieval Layer R1 — SHADOW routing report (no production change, no network, no LLM).
   For every question: the CURRENT live route (VeroEngine.answer -> aiRoute -> Worker webDecision, exactly as
   tests/vero-p2r3a-benchmark.js simulates it) next to the PROPOSED evidence-layer decision (js/vero-evidence.js, dormant).
   Corpora: the 144-question sales benchmark (tests/vero-sales-questions.json), the existing VERO v2 dev questions
   (tests/vero-v2-devsets.json: chains + HO1/HO2/HO3 items) and the R1 dev set (tests/vero-evidence-devset.json).
   Conversations are replayed: the live path gets the previous turn's ctxOut; the evidence layer gets only its own previous
   decision's subjects (never planner candidates).
   Run: node tests/vero-evidence-shadow.js [--md <out.md>] [--json <out.json>] [--verbose]
   Exit 1 on: a live route that changes when the evidence layer is loaded, nondeterminism, a price-field read, a network call,
   an invalid EvidenceRequest, or a CLARIFY that carries a subject. Percentages are SHADOW ESTIMATES, not measured savings. */
const fs=require('fs'), path=require('path'), crypto=require('crypto');
const ROOT=path.join(__dirname,'..');
const argv=process.argv.slice(2), arg=k=>{ const i=argv.indexOf(k); return i>=0?argv[i+1]:null; };
let pass=0, fail=0; const chk=(n,c,x)=>{ if(c){ pass++; if(argv.includes('--verbose')) console.log('PASS - '+n); } else { fail++; console.log('FAIL - '+n+(x!==undefined?'  -> '+JSON.stringify(x).slice(0,400):'')); } };
const h=o=>crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex');
const pct=(a,b)=>b?Math.round(a/b*1000)/10:0;

let netCalls=0; global.fetch=function(){ netCalls++; throw new Error('network'); }; global.XMLHttpRequest=function(){ netCalls++; throw new Error('xhr'); };
global.window={ PRICE_SETTINGS:{ indicatorDays:30 } };
eval(fs.readFileSync(path.join(ROOT,'js','helpers.js'),'utf8'));
['vero-lexicon','vero-nlu','vero-facts','vero-plan','vero-compose'].forEach(f=>require(path.join(ROOT,'js',f+'.js')));
const E=require(path.join(ROOT,'js','vero-engine.js'));
const ALL=JSON.parse(fs.readFileSync(path.join(ROOT,'data','products.json'),'utf8')); pcResolveSchedule(ALL);
const PUB=ALL.filter(p=>!p.disabled), byCode={}; PUB.forEach(p=>byCode[String(p.item_code)]=p);

/* ---------- corpora (turn lists; ctx = index of the previous turn in the same conversation, or -1) ---------- */
const turns=[];
const B=JSON.parse(fs.readFileSync(path.join(__dirname,'vero-sales-questions.json'),'utf8')).questions;
const bIdx={}; B.forEach(q=>{ bIdx[q.id]=turns.length; turns.push({ corpus:'sales-benchmark', id:q.id, q:q.question, lang:q.language, prev:q.contextFrom?bIdx[q.contextFrom]:-1 }); });
const V2=JSON.parse(fs.readFileSync(path.join(__dirname,'vero-v2-devsets.json'),'utf8'));
V2.chains.forEach(c=>{ let prev=-1; c.turns.forEach(t=>{ const i=turns.length; turns.push({ corpus:'v2-chains', id:t.id, q:t.q, prev:prev }); prev=i; }); });
Object.keys(V2.sets).forEach(k=>{ let prev=-1; V2.sets[k].items.forEach(t=>{ const i=turns.length; turns.push({ corpus:'v2-'+k, id:t.id, q:t.q, prev:t.cls==='CONTEXT'?prev:-1 }); prev=i; }); });
const DS=JSON.parse(fs.readFileSync(path.join(__dirname,'vero-evidence-devset.json'),'utf8')).questions;
const chainLast={}; DS.forEach(t=>{ const i=turns.length; turns.push({ corpus:'r1-devset', id:t.id, q:t.q, lang:t.lang, prev:t.chain&&chainLast[t.chain]!=null?chainLast[t.chain]:-1, expect:t.expect }); if(t.chain) chainLast[t.chain]=i; });

(async()=>{
const W=await import(require('url').pathToFileURL(path.join(ROOT,'backend','vero','worker.js')).href);
/* ---------- 1. CURRENT live routes (evidence layer NOT loaded yet) ---------- */
function liveRoutes(){
  const out=[];
  turns.forEach((t,i)=>{
    const conv=t.prev>=0?out[t.prev].ctxOut:null;
    const r=E.answer(PUB,t.q,{ conv }), a=E.aiRoute(PUB,t.q,r,{});
    let cur;
    if(a.route==='local') cur=r.type==='clarify'||(r.plan&&r.plan.route&&r.plan.route.route==='CLARIFY')?'CLARIFY':'LOCAL';
    else if(a.candidates.length<2) cur='REJECTED';
    else { const dec=W.webDecision(t.q,a.candidates.map(c=>[byCode[c].product_name,byCode[c].features,byCode[c].description].join(' '))); cur=(a.route==='web'&&dec.web)?'WEB':'CATALOG'; }
    out.push({ cur, plan:r.plan||null, ctxOut:r.ctxOut||conv, nCand:a.candidates.length, planRoute:r.plan&&r.plan.route?r.plan.route.route:null });
  });
  return out;
}
const L0=liveRoutes();
const liveSig=h(L0.map(x=>[x.cur,x.nCand,x.planRoute]));
/* ---------- 2. PROPOSED (evidence layer loaded now) ---------- */
const V=require(path.join(ROOT,'js','vero-evidence.js'));
const RF=require(path.join(ROOT,'js','vero-facts.js')).build(PUB);
let priceReads=0; const FORBID=/^(srp|dp|dp_volume|special_dp|moq|priceSchedule|priceHistory)$/;
const PROXY=PUB.map(p=>new Proxy(p,{ get(t,k){ if(typeof k==='string'&&FORBID.test(k)) priceReads++; return t[k]; } }));
function shadow(prods){
  const out=[];
  turns.forEach((t,i)=>{
    const ctx=t.prev>=0?out[t.prev].nextCtx:null;                       /* the evidence layer's own nextCtx only (F1) */
    const d=V.classify(t.q,{ products:prods, facts:RF, plan:L0[i].plan, ctx });
    out.push({ route:d.route, reason:d.reason, cls:d['class'], subjects:d.subjects, needs:d.needs.map(n=>({ s:n.s, cls:n.cls, a:n.a, local:n.local })),
      request:d.request, llmNeeded:d.llmNeeded, llmRule:d.llmRule, nextCtx:d.nextCtx });
  });
  return out;
}
const S1=shadow(PROXY), S2=shadow(PUB);
const L1=liveRoutes();                                                    /* live path again, with the evidence layer loaded */

chk('S01 live routes identical with and without the evidence layer loaded ('+turns.length+' turns)', h(L1.map(x=>[x.cur,x.nCand,x.planRoute]))===liveSig);
chk('S02 shadow decisions deterministic (two runs, proxy vs plain products)', h(S1)===h(S2));
chk('S03 no price / MOQ / dealer field read by the evidence layer', priceReads===0, priceReads);
chk('S04 no network call', netCalls===0, netCalls);
chk('S05 every EVIDENCE decision carries a valid EvidenceRequest; LOCAL / CLARIFY carry none', S2.every(d=>(d.route==='EVIDENCE')===!!d.request && (!d.request||V.validateRequest(d.request).ok)));
chk('S06 CLARIFY never carries a subject or a need', S2.every(d=>d.route!=='CLARIFY'||(!d.subjects.length&&!d.needs.length)));
const devRows=turns.map((t,i)=>[t,S2[i]]).filter(([t])=>t.corpus==='r1-devset');
const goldBad=devRows.filter(([t,d])=>d.route!==t.expect.route||d.llmNeeded!==t.expect.llm||(t.expect.reason&&d.reason!==t.expect.reason));
chk('S07 R1 dev set route / reason / llmNeeded gold (replayed in corpus order): '+(devRows.length-goldBad.length)+'/'+devRows.length, !goldBad.length, goldBad.map(([t,d])=>t.id+':'+d.route+'/'+d.reason));

/* ---------- 3. report ---------- */
const AI=x=>x==='CATALOG'||x==='WEB';
function stats(rows){
  const n=rows.length, m={ n, cur:{}, prop:{}, trans:{}, curAI:0, curWEB:0, curCAT:0, propLLM:0, propEV:0, propCL:0, propLOC:0,
    aiAvoid:0, aiAvoidLocal:0, aiAvoidClarify:0, aiAvoidEvidence:0, aiKeep:0, webToLocalClarify:0, webToEvidence:0, webToEvidenceLLM:0, newEvidence:0, evClasses:{}, reasons:{}, llmRules:{} };
  rows.forEach(([t,L,d])=>{
    m.cur[L.cur]=(m.cur[L.cur]||0)+1; m.prop[d.route]=(m.prop[d.route]||0)+1;
    const k=(L.cur==='CATALOG'?'AI_CATALOG':L.cur)+' -> '+d.route+(d.llmNeeded?' (+LLM)':''); m.trans[k]=(m.trans[k]||0)+1;
    m.reasons[d.reason]=(m.reasons[d.reason]||0)+1; m.llmRules[d.llmRule]=(m.llmRules[d.llmRule]||0)+1;
    if(d.cls) m.evClasses[d.cls]=(m.evClasses[d.cls]||0)+1;
    if(d.llmNeeded) m.propLLM++; if(d.route==='EVIDENCE') m.propEV++; if(d.route==='CLARIFY') m.propCL++; if(d.route==='LOCAL') m.propLOC++;
    if(AI(L.cur)){ m.curAI++; if(L.cur==='WEB') m.curWEB++; else m.curCAT++;
      if(d.llmNeeded) m.aiKeep++; else { m.aiAvoid++; if(d.route==='LOCAL') m.aiAvoidLocal++; else if(d.route==='CLARIFY') m.aiAvoidClarify++; else m.aiAvoidEvidence++; } }
    if(L.cur==='WEB'){ if(d.route==='EVIDENCE'){ m.webToEvidence++; if(d.llmNeeded) m.webToEvidenceLLM++; } else m.webToLocalClarify++; }
    if(!AI(L.cur) && d.route==='EVIDENCE') m.newEvidence++;
  });
  return m;
}
const ROWS=turns.map((t,i)=>[t,L0[i],S2[i]]);
const corpora=['ALL','sales-benchmark','v2-chains','v2-HO1','v2-HO2','v2-HO3','r1-devset'];
const ST={}; corpora.forEach(c=>{ ST[c]=stats(ROWS.filter(([t])=>c==='ALL'||t.corpus===c)); });
const EX=ST['ALL'], EXnoDev=stats(ROWS.filter(([t])=>t.corpus!=='r1-devset'));
function line(c,m){ return '| '+c+' | '+m.n+' | '+m.curAI+' ('+pct(m.curAI,m.n)+'%) | '+m.curCAT+' / '+m.curWEB+' | '+pct(m.propLOC,m.n)+'% / '+pct(m.propEV,m.n)+'% / '+pct(m.propCL,m.n)+'% | '+
  m.aiAvoid+'/'+m.curAI+' ('+pct(m.aiAvoid,m.curAI)+'%) | '+m.propLLM+' vs '+m.curAI+' ('+(m.curAI?(m.propLLM<=m.curAI?'-':'+')+pct(Math.abs(m.curAI-m.propLLM),m.curAI)+'%':'n/a')+') | '+
  m.webToLocalClarify+' – '+(m.webToLocalClarify+m.webToEvidence-m.webToEvidenceLLM)+' of '+m.curWEB+' | '+m.newEvidence+' |'; }
const md=[];
md.push('# UNO Evidence & Retrieval Layer R1 — shadow routing report','',
 '_Generated by `tests/vero-evidence-shadow.js` (deterministic; no network, no LLM, no production change). SHADOW ESTIMATES ONLY — not measured savings; nothing is switched on._','',
 'Current route = the live p2r3a.4 path in Node (answer → aiRoute → Worker webDecision): LOCAL / CLARIFY / CATALOG (= AI_CATALOG call) / WEB (= web AI call) / REJECTED (< 2 candidates).',
 'Proposed = `VeroEvidence.classify` (LOCAL / EVIDENCE / CLARIFY) + `llmNeeded` (a future LLM call, only after evidence exists).','',
 '## Summary by corpus','',
 '| corpus | turns | current AI calls | current CATALOG / WEB | proposed LOCAL / EVIDENCE / CLARIFY | current AI calls that would avoid the LLM | proposed LLM calls vs current AI calls | current WEB calls removed (lower – upper bound) | new evidence asks on non-AI turns |',
 '|---|---|---|---|---|---|---|---|---|');
corpora.forEach(c=>md.push(line(c,ST[c])));
md.push('| ALL excl. R1 dev set | '+EXnoDev.n+' | '+EXnoDev.curAI+' ('+pct(EXnoDev.curAI,EXnoDev.n)+'%) | '+EXnoDev.curCAT+' / '+EXnoDev.curWEB+' | '+pct(EXnoDev.propLOC,EXnoDev.n)+'% / '+pct(EXnoDev.propEV,EXnoDev.n)+'% / '+pct(EXnoDev.propCL,EXnoDev.n)+'% | '+EXnoDev.aiAvoid+'/'+EXnoDev.curAI+' ('+pct(EXnoDev.aiAvoid,EXnoDev.curAI)+'%) | '+EXnoDev.propLLM+' vs '+EXnoDev.curAI+' | '+EXnoDev.webToLocalClarify+' – '+(EXnoDev.webToLocalClarify+EXnoDev.webToEvidence-EXnoDev.webToEvidenceLLM)+' of '+EXnoDev.curWEB+' | '+EXnoDev.newEvidence+' |');
md.push('','Lower bound of WEB removal = current WEB calls whose proposed route is LOCAL or CLARIFY (never needs the web). Upper bound adds EVIDENCE decisions that need no LLM (they need the web only on an evidence-store miss).','');
function tableOf(title,obj){ md.push('## '+title,'','| value | count |','|---|---|'); Object.keys(obj).sort((a,b)=>obj[b]-obj[a]).forEach(k=>md.push('| '+k+' | '+obj[k]+' |')); md.push(''); }
tableOf('Current route → proposed route (ALL corpora)',EX.trans);
tableOf('Current route → proposed route (existing corpora only, excl. R1 dev set)',EXnoDev.trans);
tableOf('Proposed reasons (ALL)',EX.reasons);
tableOf('LLM rules (ALL)',EX.llmRules);
tableOf('Primary evidence class of EVIDENCE / LOCAL-with-needs decisions (ALL)',EX.evClasses);
md.push('## Every current AI / WEB call (existing corpora) and its proposed route','','| corpus | id | question | current | proposed | reason | llmNeeded | class |','|---|---|---|---|---|---|---|---|');
ROWS.filter(([t,L])=>t.corpus!=='r1-devset'&&AI(L.cur)).forEach(([t,L,d])=>md.push('| '+t.corpus+' | '+t.id+' | '+t.q.replace(/\|/g,'/')+' | '+L.cur+' | '+d.route+' | '+d.reason+' | '+d.llmNeeded+' | '+(d.cls||'')+' |'));
md.push('','## New evidence asks on turns that are LOCAL / CLARIFY today (existing corpora)','','| corpus | id | question | current | proposed | reason | class |','|---|---|---|---|---|---|---|');
ROWS.filter(([t,L,d])=>t.corpus!=='r1-devset'&&!AI(L.cur)&&d.route==='EVIDENCE').forEach(([t,L,d])=>md.push('| '+t.corpus+' | '+t.id+' | '+t.q.replace(/\|/g,'/')+' | '+L.cur+' | '+d.route+' | '+d.reason+' | '+(d.cls||'')+' |'));
md.push('','## R1 dev set — every decision','','| id | question | current | proposed | reason | class | subjects | llmNeeded |','|---|---|---|---|---|---|---|---|');
ROWS.filter(([t])=>t.corpus==='r1-devset').forEach(([t,L,d])=>md.push('| '+t.id+' | '+t.q.replace(/\|/g,'/')+' | '+L.cur+' | '+d.route+' | '+d.reason+' | '+(d.cls||'')+' | '+d.subjects.map(s=>s.replace('ugreen:','')).join(', ')+' | '+d.llmNeeded+' |'));

console.log('turns: '+EX.n+' (sales-benchmark '+ST['sales-benchmark'].n+', v2-chains '+ST['v2-chains'].n+', v2-HO '+(ST['v2-HO1'].n+ST['v2-HO2'].n+ST['v2-HO3'].n)+', r1-devset '+ST['r1-devset'].n+')');
corpora.concat(['EXISTING']).forEach(c=>{ const m=c==='EXISTING'?EXnoDev:ST[c];
  console.log((c+'            ').slice(0,16)+' n='+m.n+' curAI='+m.curAI+' (CAT '+m.curCAT+', WEB '+m.curWEB+') | proposed LOCAL '+pct(m.propLOC,m.n)+'% EVIDENCE '+pct(m.propEV,m.n)+'% CLARIFY '+pct(m.propCL,m.n)+
    '% | AI avoided '+m.aiAvoid+'/'+m.curAI+' ('+pct(m.aiAvoid,m.curAI)+'%) | LLM calls '+m.curAI+' -> '+m.propLLM+' | WEB removed '+m.webToLocalClarify+'..'+(m.webToLocalClarify+m.webToEvidence-m.webToEvidenceLLM)+'/'+m.curWEB+' | new evidence asks '+m.newEvidence); });
console.log('transitions (existing corpora): '+JSON.stringify(EXnoDev.trans));
if(arg('--md')) fs.writeFileSync(arg('--md'),md.join('\n')+'\n');
if(arg('--json')) fs.writeFileSync(arg('--json'),JSON.stringify({ stats:ST, existing:EXnoDev, rows:ROWS.map(([t,L,d])=>({ corpus:t.corpus, id:t.id, q:t.q, current:L.cur, proposed:d.route, reason:d.reason, cls:d.cls, llmNeeded:d.llmNeeded, subjects:d.subjects })) },null,1));
console.log('\nvero-evidence shadow: '+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
})();
