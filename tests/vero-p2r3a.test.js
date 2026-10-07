/* VERO p2r3a acceptance tests (Node) — A01–A28 (Node-checkable parts) + real-usage conversation tests UA–UE.
   Run: node tests/vero-p2r3a.test.js
   Drives VeroEngine.answer / aiRoute exactly like vero.js: each turn passes the previous res.ctxOut as `conv`.
   Expected products are DERIVED from data/products.json (facts index), never hardcoded SKUs — except where a test needs "a real SKU",
   which is picked from the data at run time.
   Browser-only parts (A16 rendering, A17 mode/idle clearing, A26 regression, A28 throttled timing) are in tests/vero-p2r3a.playwright.py;
   A24 = existing suites, A25 = tests/vero-p2r3a-benchmark.js, A27 = tests/vero-asset-checks.py. */
const fs=require('fs'), path=require('path');
const ROOT=path.join(__dirname,'..');
global.window={ PRICE_SETTINGS:{ indicatorDays:30 } };
eval(fs.readFileSync(path.join(ROOT,'js','helpers.js'),'utf8'));
['vero-lexicon','vero-nlu','vero-facts','vero-plan','vero-compose'].forEach(f=>require(path.join(ROOT,'js',f+'.js')));
const E=require(path.join(ROOT,'js','vero-engine.js'));
const F=require(path.join(ROOT,'js','vero-facts.js'));
const RAW=fs.readFileSync(path.join(ROOT,'data','products.json'),'utf8');
const ALL=JSON.parse(RAW); pcResolveSchedule(ALL); const SNAP=JSON.stringify(ALL);
const PUB=ALL.filter(p=>!p.disabled), IDX=F.build(PUB), byCode={}; PUB.forEach(p=>byCode[String(p.item_code)]=p);
let pass=0, fail=0; const chk=(n,c,x)=>{ if(c){ pass++; console.log('PASS - '+n); } else { fail++; console.log('FAIL - '+n+(x!==undefined?'  -> '+String(x).slice(0,400):'')); } };
const fam=c=>IDX.byCode[c]&&IDX.byCode[c].type.family, sub=c=>IDX.byCode[c]&&IDX.byCode[c].type.subtype, W=c=>IDX.byCode[c]&&IDX.byCode[c].attrs.watts.value;
const sortedEq=(a,b)=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
/* conversation driver (same as vero.js ask()) */
function chat(turns,opts){ opts=opts||{}; let conv=opts.conv||null; const out=[];
  for(const q of turns){ const r=E.answer(opts.pool||PUB,q,Object.assign({ conv },opts.ctx||{})); const a=E.aiRoute(opts.pool||PUB,q,r,{}); if(r.ctxOut) conv=r.ctxOut; out.push({ q, r, a, conv }); }
  return out; }
const one=(q,o)=>chat([q],o)[0];
const txt=x=>(x.r.echo||'')+' | '+(x.r.note||'');
const NOMATCH=/No products match/i;
/* real SKUs picked from data */
const modelP=PUB.find(p=>fam(p.item_code)==='charger'&&/^[a-z]+\d+$/i.test(String(p.model||'').trim())), X755=String(modelP.model).trim();
const twoChargers=PUB.filter(p=>fam(p.item_code)==='charger'&&sub(p.item_code)==='wall'&&W(p.item_code)&&p.model&&/\d/.test(p.model));
const cA=twoChargers[0], cB=twoChargers.find(p=>p.model!==cA.model && W(p.item_code)!==W(cA.item_code) && Number(p.srp)!==Number(cA.srp));
const anyAnchor=String(PUB.find(p=>fam(p.item_code)==='charger'&&sub(p.item_code)==='wall'&&W(p.item_code)>=60).item_code);

/* ================= UA–UE: real usage (from user testing) ================= */
const SMALL=['hi','hello','can you help me?','can you really help me with my questions?','why is your name VERO?'];
const ua=SMALL.map(q=>one(q));
chk('UA greeting/help: warm local answer, 0 catalog results, 0 Worker routes, never "No products match" ('+SMALL.length+')',
  ua.every(x=>x.r.plan&&x.r.plan.intent==='smalltalk'&&!(x.r.codes||[]).length&&x.a.route==='local'&&!x.a.candidates.length&&!NOMATCH.test(x.r.note)&&x.r.note.length>10), ua.map(txt).join(' || '));
chk('UA "why is your name VERO?" uses the approved wording (no acronym / origin story)', /VERO is the name of your UGREEN Product & Sales Assistant — built to help you find the right product faster and answer product questions with confidence\./.test(ua[4].r.note), ua[4].r.note);
const ub=chat(['do we have a wall charger 160w?','how about 140w?']);
const wall140=PUB.filter(p=>fam(p.item_code)==='charger'&&sub(p.item_code)==='wall'&&W(p.item_code)===140).map(p=>String(p.item_code));
chk('UB follow-up: "how about 140w?" inherits wall charger, replaces 160W -> 140W, shows "Using: wall charger · 140W", never returns a 140W cable',
  ub[1].r.echo==='Using: wall charger · 140W' && ub[1].r.plan.followUp && ub[1].r.plan.type.subtype==='wall' && ub[1].r.plan.filters.some(f=>f.attr==='watts'&&f.value===140) && !ub[1].r.plan.filters.some(f=>f.attr==='watts'&&f.value===160) &&
  sortedEq(ub[1].r.codes,wall140) && (ub[1].r.codes||[]).every(c=>fam(c)==='charger') && (ub[1].r.chips||[]).every(ch=>!/cable/i.test(ch.ask)), txt(ub[1])+' codes='+ub[1].r.codes);
const uc=one('ano yung speed ng cat6 cable?');
chk('UC "ano yung speed ng cat6 cable?" -> LAN cable + Cat6 + speed attribute, one family, not a multi-section result',
  uc.r.plan.intent==='attribute'&&uc.r.plan.attribute==='speed'&&uc.r.plan.type.family==='lan_cable'&&uc.r.plan.standards[0]==='cat6'&&uc.r.codes.length>0&&uc.r.codes.every(c=>fam(c)==='lan_cable'&&/cat\s?6(?![a-z0-9])/i.test(byCode[c].product_name))&&/speed/i.test(uc.r.note)&&uc.r.type!=='clarify', txt(uc));
const ud=chat(['65W charger','how about 100W?','new question: HDMI cable 2m']);
chk('UD topic switch: "how about 100W?" inherits charger; "new question: HDMI cable 2m" clears the charger context',
  ud[1].r.plan.followUp&&ud[1].r.plan.type.family==='charger'&&ud[1].r.plan.filters.some(f=>f.attr==='watts'&&f.value===100)&&/Using: charger · 100W/.test(ud[1].r.echo||'') &&
  !ud[2].r.plan.followUp&&!ud[2].r.echo&&!ud[2].r.plan.filters.some(f=>f.attr==='watts')&&ud[2].r.codes.every(c=>fam(c)==='video_cable'), txt(ud[1])+' || '+txt(ud[2]));
const ue=one('hi, may 65W charger?');
chk('UE mixed small talk + product: product answer (with a short greeting), not only a greeting', ue.r.plan.intent==='exist'&&ue.r.codes.length>0&&/^Hi! /.test(ue.r.note)&&ue.r.codes.every(c=>fam(c)==='charger'&&W(c)===65), txt(ue));

/* ================= A01–A28 ================= */
const A01=['hi','hello','how are you','can you help me?','can you really help me with my questions?','who are you?','why is your name VERO?','thank you','thanks','kumusta','salamat po','bye'].map(q=>one(q));
chk('A01 small talk x12: local reply, no products, no search, no Worker call, never "No products match"', A01.every(x=>x.r.plan.intent==='smalltalk'&&!x.r.codes.length&&x.a.route==='local'&&!NOMATCH.test(x.r.note)), A01.filter(x=>!(x.r.plan.intent==='smalltalk')).map(x=>x.q).join(','));
chk('A01b small talk never changes the conversation context', (()=>{ const c=chat(['65W charger','thanks','how about 100W?']); return c[2].r.plan.followUp && /charger · 100W/.test(c[2].r.echo||''); })());
chk('A02 "hi, may 65W charger?" -> product answer', ue.r.codes.length>0 && ue.r.plan.intent!=='smalltalk');
chk('A03 wall charger 160W -> 140W (see UB)', ub[1].r.echo==='Using: wall charger · 140W');
const a04=chat(['65W charger','how about black?','same but built-in cable']);
chk('A04 "65W charger" -> "how about black?" -> "same but built-in cable": each step inherits and adds',
  a04[1].r.plan.filters.some(f=>f.attr==='watts'&&f.value===65)&&a04[1].r.plan.match.some(m=>m.k==='color'&&m.v==='black')&&
  a04[2].r.plan.filters.some(f=>f.attr==='watts'&&f.value===65)&&a04[2].r.plan.match.some(m=>m.k==='color'&&m.v==='black')&&a04[2].r.plan.match.some(m=>m.k==='flag'&&m.v==='builtin'), txt(a04[1])+' || '+txt(a04[2]));
const a05=chat(['20000mAh power bank','how about 20k?','how about under 2k?']);
chk('A05 power bank context: "how about 20k?" = mAh (not ₱); "how about under 2k?" = SRP ≤ ₱2,000',
  a05[1].r.plan.filters.some(f=>f.attr==='mah'&&f.value===20000)&&!a05[1].r.plan.filters.some(f=>f.attr==='price')&&a05[2].r.plan.filters.some(f=>f.attr==='price'&&f.op==='le'&&f.value===2000)&&a05[2].r.codes.every(c=>Number(byCode[c].srp)<=2000&&IDX.byCode[c].attrs.mah.value===20000), txt(a05[1])+' || '+txt(a05[2]));
const a06=chat(['ano DP ng '+X755,'what about MOQ?','how about DP?']);
const x755codes=PUB.filter(p=>String(p.model||'').trim().toLowerCase()===String(X755).toLowerCase()).map(p=>String(p.item_code));
chk('A06 "ano DP ng <model>" -> "what about MOQ?" -> "how about DP?": attributes of the same focus product',
  a06[0].r.fields.join()==='dp'&&a06[1].r.fields.join()==='moq'&&a06[2].r.fields.join()==='dp'&&sortedEq(a06[1].r.codes,x755codes)&&sortedEq(a06[2].r.codes,x755codes)&&/Using: SKU/.test(a06[1].r.echo||''), txt(a06[1])+' || '+txt(a06[2]));
const a07=one('may 65W car charger ba?'), car65=PUB.filter(p=>sub(p.item_code)==='car'&&W(p.item_code)===65).map(p=>String(p.item_code)), carWs=[...new Set(PUB.filter(p=>sub(p.item_code)==='car'&&W(p.item_code)).map(p=>W(p.item_code)))];
chk('A07 "may 65W car charger ba?" -> no confirmed 65W car charger (data: '+car65.length+'); 0 wall chargers; facet chips = car-charger wattages that exist',
  car65.length===0 && !a07.r.codes.length && /^Wala|^We don/.test(a07.r.note) && (a07.r.chips||[]).length>0 && a07.r.chips.every(ch=>carWs.includes(parseFloat(ch.label))) && !/wall/i.test(a07.r.note), txt(a07)+' chips='+(a07.r.chips||[]).map(c=>c.label));
const a08=chat(['HDMI cable 3m','the second one?']);
chk('A08 "HDMI cable 3m" -> "the second one?" = lookup of result #2', a08[1].r.type==='lookup'&&a08[1].r.codes[0]===a08[0].r.codes[1]&&/result #2/.test(a08[1].r.echo||''), txt(a08[1]));
const a09=chat(['compare '+cA.item_code+' and '+cB.item_code,'alin mas mura?','alin mas mataas wattage?','which one is cheaper?']);
const cheaper=Number(cA.srp)<Number(cB.srp)?String(cA.item_code):String(cB.item_code), stronger=W(cA.item_code)>W(cB.item_code)?String(cA.item_code):String(cB.item_code);
chk('A09 compare follow-ups pick the data-derived winner (cheaper '+cheaper+', higher wattage '+stronger+')',
  a09[1].r.type==='compare'&&a09[1].r.note.indexOf(cheaper)>=0&&a09[2].r.note.indexOf(stronger)>=0&&a09[3].r.note.indexOf(cheaper)>=0&&a09.slice(1).every(x=>/your comparison/.test(x.r.echo||'')), a09.slice(1).map(txt).join(' || '));
const a10=chat(['65W charger','same but cheaper']);
chk('A10 list context: "same but cheaper" keeps the filters and sorts by SRP ascending', a10[1].r.plan.filters.some(f=>f.attr==='watts'&&f.value===65)&&sortedEq(a10[1].r.codes,a10[0].r.codes)&&a10[1].r.codes.every((c,i,a)=>i===0||Number(byCode[a[i-1]].srp)<=Number(byCode[c].srp)), txt(a10[1]));
const a10b=chat(['ano DP ng '+anyAnchor,'same but cheaper']), base=byCode[anyAnchor];
chk('A10b focused product: "same but cheaper" = same family/subtype, same key spec, lower SRP, cheapest first; worded "cheaper options with the same …"',
  a10b[1].r.plan.intent==='alternative'&&a10b[1].r.codes.every(c=>fam(c)==='charger'&&sub(c)===sub(anyAnchor)&&W(c)===W(anyAnchor)&&Number(byCode[c].srp)<Number(base.srp))&&
  a10b[1].r.codes.every((c,i,a)=>i===0||Number(byCode[a[i-1]].srp)<=Number(byCode[c].srp))&&(a10b[1].r.codes.length?/cheaper options with the same wattage/.test(a10b[1].r.note):/No cheaper option/.test(a10b[1].r.note)), txt(a10b[1]));
const a11=chat(['65W charger','how about 100?']);
chk('A11 "how about 100?" (no unit) -> CLARIFY with chips (100W / under ₱100)', a11[1].r.type==='clarify'&&a11[1].a.route==='local'&&(a11[1].r.chips||[]).some(c=>c.label==='100W')&&(a11[1].r.chips||[]).some(c=>/₱100/.test(c.label)), txt(a11[1]));
const a12=chat(['65W charger','usb-c hub with hdmi']);
chk('A12 new family -> no 65W inherited, no echo', !a12[1].r.plan.followUp&&!a12[1].r.echo&&!a12[1].r.plan.filters.some(f=>f.attr==='watts')&&a12[1].r.codes.every(c=>fam(c)==='hub_dock'), txt(a12[1]));
const a13=chat(['65W charger','price ng '+anyAnchor]);
chk('A13 new anchor -> topic switch, lookup of that SKU only', !a13[1].r.plan.followUp&&a13[1].r.codes.join()===anyAnchor&&!a13[1].r.echo, txt(a13[1]));
const a14=chat(['65W charger','new question: hdmi cable 2m']);
chk('A14 explicit "new question" cue -> fresh plan', a14[1].r.plan.topicSwitch==='topic cue'&&!a14[1].r.echo&&!a14[1].r.plan.filters.some(f=>f.attr==='watts'));
const a15=chat(['65W charger','magkano tinaas ng '+anyAnchor,'how about 100W?']);
chk('A15 price-history turn replaces the context (the next follow-up does not inherit the charger list)', a15[1].r.plan.intent==='price_history'&&a15[1].a.route==='local'&&!(a15[2].r.plan.followUp && a15[2].r.plan.inherited.indexOf('type')>=0 && /65W/.test(a15[2].r.echo||'')), txt(a15[1]).slice(0,120)+' || '+txt(a15[2]));
const fresh=['65W charger','HDMI cable 3m','compare '+cA.item_code+' and '+cB.item_code,'cheapest power bank','may 8K HDMI ba?'].map(q=>one(q));
chk('A16 echo appears on inherited answers only (never on a fresh question)', fresh.every(x=>!x.r.echo) && [ub[1],a04[1],a05[1],a06[1],a08[1],a09[1],a10[1]].every(x=>/^Using: /.test(x.r.echo||'')));
/* A17: context hygiene (Node part; mode switch + idle are in the browser test) */
const ctxs=[...ub,...a05,...a06,...a09,...a10b].map(x=>x.conv);
chk('A17 context holds item codes + user constraints only: no catalog prices, no answer text, no question text', ctxs.every(c=>{ const s=JSON.stringify(c); return !/srp"\s*:\s*\d|"dp"\s*:\s*\d|dp_volume"\s*:\s*\d|note|product_name|description/.test(s) && !/how about|alin mas/.test(s); }));
chk('A17b catalog change: a context code that is no longer in the pool is dropped (never answered)', (()=>{ const c=chat(['ano DP ng '+anyAnchor]); const pool=PUB.filter(p=>String(p.item_code)!==anyAnchor); const r=E.answer(pool,'what about MOQ?',{ conv:c[0].conv }); return !(r.codes||[]).includes(anyAnchor); })());
chk('A18 cat6 speed (see UC)', uc.r.plan.attribute==='speed'&&uc.r.plan.type.family==='lan_cable');
const tl=one('may 100W charger ba?'), en=one('do we have a 100W charger?');
chk('A19 Taglish question -> Taglish lead; English question -> English lead', /^Meron/.test(tl.r.note)&&/^Yes/.test(en.r.note), tl.r.note+' || '+en.r.note);
const stockQs=['may stock ba ng 100W charger?','in stock ba yung '+anyAnchor+'?','on hand pa ba yung 65W charger?','cheapest power bank in stock','meron pa bang stock ng hdmi cable 2m','stock ng '+anyAnchor];
const a20=stockQs.map(q=>one(q)), av=one('available ba ang '+anyAnchor+'?');
chk('A20 inventory caveat on every path with stock words (exist, lookup, rank, list, anchor) and no stock claim; "available ba X" = listed + inventory caveat (fix 1)', a20.every(x=>x.r.stockNote&&/live inventory/.test(x.r.stockNote))&&/listed|naka-lista/i.test(av.r.note)&&/live inventory/.test(av.r.stockNote||'')&&!/\bin stock\b/i.test(av.r.note), a20.filter(x=>!x.r.stockNote).map(x=>x.q).join(','));
/* A21 safety */
const ms=one('may magsafe na power bank?'), qi=one('may qi2 charger?');
chk('A21a MagSafe: confirmed codes all say MagSafe in name/features; magnetic-only items carry the caution line', ms.r.plan.result.codes.every(c=>/mag\s?safe/i.test(byCode[c].product_name+' '+(byCode[c].features||'')))&&(ms.r.plan.result.related||[]).every(c=>/MagSafe not explicitly confirmed/.test(ms.r.detail[c]||'')));
chk('A21b Qi2: confirmed only from name/feature evidence; plain "qi" never becomes Qi2', qi.r.plan.result.codes.every(c=>/\bqi\s?2/i.test(byCode[c].product_name+' '+(byCode[c].features||'')))&&!one('qi charger').r.plan.match.some(m=>m.v==='qi2'));
const many=[...ua,...ub,ue,...A01,...a04,...a05,...a06,a07,...a08,...a09,...a10,...a10b,...a11,...a12,...a13,...a14,...a15,...a20,ms,qi];
chk('A21c no "equivalent / exact replacement / same as" wording, no "No products match", in any reply of this suite ('+many.length+')', many.every(x=>!/\b(equivalent|exact replacement|same as)\b/i.test(x.r.note||'')&&!NOMATCH.test(x.r.note||'')));
const dealerH=one('ano previous DP ng '+anyAnchor,{ ctx:{ dealer:true } });
chk('A21d dealer: price history is SRP only', /Only SRP history is available/.test(dealerH.r.note)||!/\bDP\b.*→/.test(dealerH.r.note), dealerH.r.note);
const SRC=['vero-plan.js','vero-compose.js','vero-lexicon.js','vero-facts.js'].map(f=>fs.readFileSync(path.join(ROOT,'js',f),'utf8')).join('\n').replace(/\/\*[\s\S]*?\*\//g,'');
chk('A21e no priceSchedule read and no network call in the Local Brain files', !/priceSchedule/.test(SRC)&&!/\bfetch\s*\(|XMLHttpRequest|sendBeacon/.test(SRC));
const dis=PUB.find(p=>fam(p.item_code)==='charger'&&W(p.item_code)===65), poolD=ALL.map(p=>String(p.item_code)===String(dis.item_code)?Object.assign({},p,{ disabled:true }):p);
chk('A21f a disabled SKU never appears (code lookup, list, follow-up)', (()=>{ const c=chat(['65W charger','price ng '+dis.item_code,'same but cheaper'],{ pool:poolD }); return c.every(x=>!(x.r.codes||[]).includes(String(dis.item_code))); })());
/* A22 AI routing */
const named=['compatible ba ang '+anyAnchor+' sa iPhone 17?','will '+anyAnchor+' work with MacBook Air M4?','sulit ba ang '+anyAnchor+'?'].map(q=>one(q));
chk('A22a named SKU = candidate #1, >= 2 candidates (Worker minimum), all same family', named.every(x=>x.a.route!=='local'&&x.a.candidates[0]===anyAnchor&&x.a.candidates.length>=2&&x.a.candidates.every(c=>fam(c)==='charger')), named.map(x=>x.a.route+':'+x.a.candidates).join(' | '));
const vague=['ano best dito?','alin mas okay?','ano reco mo?','pang office?','customer wants something cheap'].map(q=>one(q));
chk('A22b vague questions -> CLARIFY, 0 Worker calls', vague.every(x=>x.a.route==='local'&&x.r.type==='clarify'), vague.map(x=>x.q+'='+x.r.type+'/'+x.a.route).join(','));
const coach=['ano hero SKU natin sa 65W?','ano magandang upsell sa '+anyAnchor+'?','ano magandang i-push for travel?'].map(q=>one(q));
chk('A22c coach questions -> COACH_FUTURE message, 0 Worker calls', coach.every(x=>x.a.route==='local'&&x.r.plan.route.route==='COACH_FUTURE'));
const vj=fs.readFileSync(path.join(ROOT,'js','vero.js'),'utf8'), body=vj.slice(vj.indexOf('var body='),vj.indexOf('fetch(a.url+\'/ask\''));
chk('A23 AI payload unchanged: exactly v, q, candidates, history, route, trigger (item codes only)', /v:1,\s*q:/.test(body)&&/candidates:am\.candidates\.slice\(0,8\)/.test(body)&&/history:/.test(body)&&/route:am\.route/.test(body)&&/trigger:am\.trigger/.test(body)&&!/srp|\bdp|moq|price|dealer/i.test(body), body);
/* A28 (Node part): timing */
const t0=Date.now(); F.build(PUB,{ force:true }); const cold=Date.now()-t0;
const qs=['65W charger','may 8K HDMI ba?','ano yung speed ng cat6 cable?','compare '+cA.item_code+' and '+cB.item_code,'magkano tinaas ng '+anyAnchor,'hi'], ts=[];
for(let i=0;i<120;i++){ const s=process.hrtime.bigint(); E.answer(PUB,qs[i%qs.length],{}); ts.push(Number(process.hrtime.bigint()-s)/1e6); } ts.sort((a,b)=>a-b);
chk('A28 Node: facts cold build < 1500 ms ('+cold+' ms); warm answer p95 < 50 ms ('+ts[Math.floor(ts.length*0.95)].toFixed(1)+' ms)', cold<1500 && ts[Math.floor(ts.length*0.95)]<50);
/* fallback safety */
chk('A29 any Local Brain exception falls back to the p2r2.1 path for that question (no blank answer)', (()=>{ const C=window.VeroCompose, orig=C.answer; C.answer=()=>{ throw new Error('boom'); }; const w=console.warn; console.warn=()=>{}; try{ const r=E.answer(PUB,'65W charger',{}); return !r.plan && r.codes.length>0; } finally { C.answer=orig; console.warn=w; } })());
chk('A30 the product objects are not mutated by any of the above (no cached fields, no price writes)', JSON.stringify(ALL)===SNAP);

console.log(`\nVERO p2r3a acceptance: ${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
