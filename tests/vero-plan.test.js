/* VERO Local Brain — QueryPlan builder unit / safety tests (shadow step qp1).
   Run: node tests/vero-plan.test.js
   Uses the REAL data/products.json plus synthetic future SKUs. Expected SKUs are derived from the data (facts index), never
   hardcoded. Questions here are deliberately NOT the 144 benchmark questions (generalisation probes). */
const fs=require('fs'), path=require('path');
const ROOT=path.join(__dirname,'..');
global.window={ PRICE_SETTINGS:{ indicatorDays:30 } };
eval(fs.readFileSync(path.join(ROOT,'js','helpers.js'),'utf8'));
const NL=require(path.join(ROOT,'js','vero-nlu.js'));
const LEX=require(path.join(ROOT,'js','vero-lexicon.js'));
const F=require(path.join(ROOT,'js','vero-facts.js'));
const VP=require(path.join(ROOT,'js','vero-plan.js'));
const RAW=fs.readFileSync(path.join(ROOT,'data','products.json'),'utf8');
const ALL=JSON.parse(RAW); pcResolveSchedule(ALL);
const PUB=ALL.filter(p=>!p.disabled);
const IDX=F.build(PUB);
let pass=0, fail=0;
const chk=(n,c,x)=>{ if(c){ pass++; console.log('PASS - '+n); } else { fail++; console.log('FAIL - '+n+(x?'  -> '+String(x).slice(0,400):'')); } };
const B=(q,ctx)=>VP.build(q,{ products:PUB, facts:IDX, ctx:ctx||null });
const fam=c=>IDX.byCode[c]&&IDX.byCode[c].type.family, sub=c=>IDX.byCode[c]&&IDX.byCode[c].type.subtype;
const byCode={}; PUB.forEach(p=>byCode[String(p.item_code)]=p);
const sortedEq=(a,b)=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
/* pick real anchors from the data (no hardcoded SKUs) */
const charger=PUB.find(p=>fam(p.item_code)==='charger' && sub(p.item_code)==='wall' && IDX.byCode[p.item_code].attrs.watts.value>=60 && p.model);
const nasP=PUB.find(p=>fam(p.item_code)==='nas' && IDX.byCode[p.item_code].attrs.nas && IDX.byCode[p.item_code].attrs.nas.bays!=null && /\d/.test(p.model||''));
const pbs=PUB.filter(p=>fam(p.item_code)==='power_bank');
const CODE=String(charger.item_code), NASM=String(nasP.model).split(/\s+/)[0];

/* ---------- schema / purity ---------- */
const before=JSON.stringify(ALL);
const p0=B('cheapest power bank');
chk('Q01 plan schema v1: intent, anchors, refs, type, filters, route, result, confidence, trace', p0.v===1 && p0.intent && Array.isArray(p0.anchors) && Array.isArray(p0.refs) && p0.type && Array.isArray(p0.filters) && p0.route && p0.route.route && p0.result && p0.confidence && Array.isArray(p0.trace));
chk('Q02 build never mutates products (no new own properties, JSON identical)', JSON.stringify(ALL)===before && !PUB.some(p=>Object.getOwnPropertyNames(p).some(k=>/^__vplan/.test(k))));
chk('Q03 empty question -> CLARIFY help, no candidates', (()=>{ const p=B('   '); return p.route.route==='CLARIFY' && !p.route.candidates.length; })());
const SRC=fs.readFileSync(path.join(ROOT,'js','vero-plan.js'),'utf8');
chk('Q04 no network / storage APIs in vero-plan.js', !/\bfetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB/.test(SRC));
chk('Q05 lexicon (f2+) still passes the protected-rule check', F.assertLexiconSafe(LEX)===true && /^f[2-9]/.test(LEX.version));

/* ---------- architecture §5.2 examples ---------- */
const e1=B('cheapest 20k power bank with built in cable under 2k');
chk('Q06 §5.2-1 rank power bank: mAh = 20000 (capacity context), built-in flag, SRP <= 2000, sort SRP asc, limit 1',
  e1.intent==='rank' && e1.type.family==='power_bank' && e1.filters.some(f=>f.attr==='mah'&&f.op==='eq'&&f.value===20000) && e1.filters.some(f=>f.attr==='price'&&f.op==='le'&&f.value===2000&&f.field==='srp') &&
  e1.match.some(m=>m.k==='flag'&&m.v==='builtin') && e1.sort[0].by==='srp' && e1.sort[0].dir==='asc' && e1.limit===1 && e1.route.route==='LOCAL', JSON.stringify(e1.filters));
const exp1=pbs.filter(p=>{ const f=IDX.byCode[p.item_code]; return f.attrs.mah.value===20000 && Number(p.srp)<=2000 && F.match(f,{k:'flag',v:'builtin'}) && F.match(f,{k:'flag',v:'builtin'}).t!=='weak'; }).sort((a,b)=>a.srp-b.srp||(a.item_code<b.item_code?-1:1));
chk('Q07 §5.2-1 result = cheapest of the data-derived set', exp1.length ? e1.result.codes[0]===String(exp1[0].item_code) && sortedEq(e1.result.codes,exp1.map(p=>String(p.item_code))) : !e1.result.codes.length, e1.result.codes.join(','));
const e2=B('magkano tinaas ng '+CODE+' this month');
chk('Q08 §5.2-2 anchor does not consume the intent: price_history, anchor, dir up, period this month, LOCAL', e2.intent==='price_history' && e2.subject[0]===CODE && e2.history.dir==='up' && e2.history.period.k==='thisMonth' && e2.route.route==='LOCAL');
const e4=B('ilang bay itong '+NASM);
chk('Q09 §5.2-4 "ilang bay <model>" = attribute nasBays of the anchor (not a count, not a card)', e4.intent==='attribute' && e4.attribute==='nasBays' && e4.subject.includes(String(nasP.item_code)) && e4.route.route==='LOCAL');
const e5=B('can '+NASM+' run Plex');
chk('Q10 §5.2-5 software question about an anchored NAS -> WEB, anchor = candidate #1', e5.intent==='compat' && e5.route.route==='WEB' && e5.route.candidates[0]===String(nasP.item_code));
const e6=B('ano best dito?');
chk('Q11 §5.2-6 vague judgement with no context -> CLARIFY, no AI call', e6.route.route==='CLARIFY' && !e6.route.candidates.length);

/* ---------- context (follow-ups, in-memory codes only) ---------- */
const two=PUB.filter(p=>fam(p.item_code)==='charger' && IDX.byCode[p.item_code].attrs.watts.value && p.model && /\d/.test(p.model)).slice(0,40);
const A=two[0], Bq=two.find(p=>p.model!==A.model && IDX.byCode[p.item_code].attrs.watts.value!==IDX.byCode[A.item_code].attrs.watts.value);
const c0=B('compare '+A.item_code+' and '+Bq.item_code); const ctx1=VP.nextContext(c0,{});
chk('Q12 compare of two anchors -> context.comparison holds both codes', c0.intent==='compare' && sortedEq(ctx1.comparison,[String(A.item_code),String(Bq.item_code)]));
chk('Q13 context stores item codes + pruned plan only (no prices, no question text)', !/srp|dp_volume|"dp"|₱|\d{3,}\.\d\d/.test(JSON.stringify(ctx1.lastPlan)) && !JSON.stringify(ctx1).includes('compare '));
const f1=B('alin mas mataas wattage?',ctx1);
const wA=IDX.byCode[A.item_code].attrs.watts.value, wB=IDX.byCode[Bq.item_code].attrs.watts.value;
chk('Q14 "alin mas mataas wattage?" resolves to the comparison and picks the data-derived winner', f1.intent==='compat'?false: f1.intent==='compare' && f1.route.route==='LOCAL' && f1.result.verdict && f1.result.verdict.winner===String(wA>wB?A.item_code:Bq.item_code), JSON.stringify(f1.result.verdict));
const f2=B('alin mas mura?',ctx1), sA=Number(A.srp), sB=Number(Bq.srp);
chk('Q15 "alin mas mura?" picks the lower SRP from the live catalog', f2.result.verdict && (sA===sB ? f2.result.verdict.tie : f2.result.verdict.winner===String(sA<sB?A.item_code:Bq.item_code)));
chk('Q16 same follow-up with NO context -> CLARIFY (never AI)', B('alin mas mura?').route.route==='CLARIFY');
const l1=B('ano DP ng '+CODE), ctx2=VP.nextContext(l1,{}), l2=B('ano MOQ nito?',ctx2);
chk('Q17 pronoun follow-up "nito" uses the previous focus (attribute moq of the same SKU)', l2.intent==='attribute' && l2.attribute==='moq' && l2.subject.includes(CODE));
chk('Q18 pronoun inside a compat phrase still resolves ("pwede ba ito sa iPad?")', (()=>{ const p=B('pwede ba ito sa iPad?',ctx2); return p.route.route==='WEB' && p.route.candidates[0]===CODE; })());

/* ---------- number grammar ---------- */
chk('Q19 "budget 20k power bank" = ₱20,000 (price cue wins over capacity context)', B('budget 20k power bank').filters.some(f=>f.attr==='price'&&f.value===20000) && !B('budget 20k power bank').filters.some(f=>f.attr==='mah'));
chk('Q20 "power bank at least 20k" = mAh >= 20000', B('power bank at least 20k').filters.some(f=>f.attr==='mah'&&f.op==='ge'&&f.value===20000));
chk('Q21 decimal-k "power bank under 1.5k" = SRP <= 1500 (not 5K)', (()=>{ const p=B('power bank under 1.5k'); return p.filters.some(f=>f.attr==='price'&&f.op==='le'&&f.value===1500) && !p.match.some(m=>m.k==='res'); })());
chk('Q22 "8K" with no price cue is a resolution; "under 8k" is a budget', B('may 8K HDMI ba').match.some(m=>m.k==='res'&&m.v===6) && B('charger under 8k').filters.some(f=>f.attr==='price'&&f.value===8000));
chk('Q23 sentence-final "pataas" turns the spec into a minimum', B('20000mah power bank pataas').filters.some(f=>f.attr==='mah'&&f.op==='ge'));
chk('Q24 "lowest dp" ranks by the DP field; "dp" next to HDMI is DisplayPort', (()=>{ const a=B('lowest dp na 65W charger'), b=B('hdmi to dp cable'); return a.sort&&a.sort[0].by==='dp' && b.pair && b.pair.to==='dp' && b.priceField==='srp'; })());

/* ---------- safety non-equivalences ---------- */
const ms=B('may magsafe na power bank?');
const msBad=ms.result.codes.filter(c=>!/mag\s?safe/i.test(byCode[c].product_name+' '+(byCode[c].features||'')));
chk('Q25 MagSafe: confirmed codes all state MagSafe in name/features; magnetic-only items only in result.related', !msBad.length && ms.result.related.every(c=>!ms.result.codes.includes(c) && /magnetic/i.test(byCode[c].product_name)), msBad.join(','));
chk('Q26 "magnetic" never becomes a MagSafe constraint', !B('magnetic wireless charger').match.some(m=>m.k==='flag'&&m.v==='magsafe'));
chk('Q27 "qi charger" never becomes a Qi2 constraint (recorded as unsupported)', (()=>{ const p=B('qi charger'); return !p.match.some(m=>m.v==='qi2') && p.unsupported.some(u=>u.attr==='qi'); })());
chk('Q28 Qi2 confirmed set only from name/feature evidence', B('may qi2 charger?').result.codes.every(c=>/\bqi\s?2/i.test(byCode[c].product_name+' '+(byCode[c].features||''))));
chk('Q29 a USB-C PORT constraint on a hub is a port, not a USB-C cable', (()=>{ const p=B('hub with usb-c port'); return p.type.family==='hub_dock' && p.ports.some(x=>x.kind==='usb_c') && p.form!=='cable'; })());
chk('Q30 one evidence rule: a cable that states its wattage only in features is included (medium tier)', (()=>{ const p=B('240W cable 2 meters');
  const exp=PUB.filter(x=>{ const f=IDX.byCode[x.item_code]; return f.type.forms.cable && f.attrs.watts.value===240 && f.attrs.lengthM.value===2 && !/car charger/i.test(x.product_name); }).map(x=>String(x.item_code));
  return exp.length && sortedEq(p.result.codes,exp); })());
chk('Q31 stock words never change the route and always add the stock caveat', (()=>{ const p=B('may stock ba ng 100W charger?'); return p.route.route==='LOCAL' && p.result.caveats.includes('stock'); })());

/* ---------- router rules ---------- */
['ano reco mo?','pang office?','customer wants something cheap','which one is better?'].forEach((q,i)=>chk('Q3'+(2+i)+' vague "'+q+'" -> CLARIFY (no AI without product intent)', B(q).route.route==='CLARIFY'));
chk('Q36 judgement with a type and >= 2 candidates -> AI_CATALOG, all candidates same family, <= 8, max 2 per model', (()=>{ const p=B('magandang power bank pang laptop'); const c=p.route.candidates;
  const per={}; c.forEach(x=>{ const m=(IDX.byCode[x].model||x).toLowerCase(); per[m]=(per[m]||0)+1; });
  return p.route.route==='AI_CATALOG' && c.length>=2 && c.length<=8 && c.every(x=>fam(x)==='power_bank') && Object.values(per).every(n=>n<=2); })());
chk('Q37 judgement on ONE anchored SKU -> AI with the anchor first, rest same family', (()=>{ const p=B('sulit ba ang '+CODE+'?'); return p.route.route==='AI_CATALOG' && p.route.candidates[0]===CODE && p.route.candidates.every(x=>fam(x)==='charger'); })());
chk('Q38 compat with an anchored SKU and a named device -> WEB, anchor = candidate #1', (()=>{ const p=B('compatible ba ang '+CODE+' sa macbook air m4?'); return p.route.route==='WEB' && p.route.candidates[0]===CODE; })());
chk('Q39 price history is LOCAL even with a device / judgement word', B('nagtaas ba presyo ng chargers this month').route.route==='LOCAL');
chk('Q40 coach words -> COACH_FUTURE (never AI), even with an anchor', ['ano magandang upsell sa '+CODE,'hero sku for power banks?','ano pwede i-bundle sa '+CODE].every(q=>B(q).route.route==='COACH_FUTURE'));
chk('Q41 p2r3a "may mas mura ba sa X?" = cheaper options: same family/subtype, same key spec, lower SRP, cheapest first (deterministic filter, not the p2r3b scorer)', (()=>{ const p=B('may mas mura ba sa '+CODE+'?'); const base=byCode[CODE], bw=IDX.byCode[CODE].attrs.watts.value;
  const c=p.result.codes; return p.intent==='alternative' && p.alternative.direction==='cheaper' && p.result.executor==='same-but' && p.route.route==='LOCAL' && c.length>0 &&
    c.every(x=>fam(x)==='charger' && sub(x)===sub(CODE) && IDX.byCode[x].attrs.watts.value===bw && Number(byCode[x].srp)<Number(base.srp)) && c.every((x,i)=>i===0||Number(byCode[c[i-1]].srp)<=Number(byCode[x].srp)); })());
chk('Q41b a plain "alternative" with no direction or constraint stays pending (p2r3b scorer)', /pending/.test(B('alternative sa SKU '+CODE).result.executor));

/* ---------- taxonomy (hub / dock, car) — expectations derived from the facts index ---------- */
const hubs=PUB.filter(p=>fam(p.item_code)==='hub_dock'), docks=hubs.filter(p=>sub(p.item_code)==='dock');
chk('Q42 bare "hub" = whole hub_dock family; "docking station" = dock subtype only', (()=>{ const a=B('pinakamahal na hub'), b=B('pinakamahal na docking station');
  return a.type.family==='hub_dock' && !a.type.subtype && a.result.codes.length===hubs.filter(p=>Number(p.srp)>0).length && b.type.subtype==='dock' && b.result.codes.every(c=>sub(c)==='dock'); })());
chk('Q43 "hub only" narrows to the hub subtype', B('hub only na may hdmi').type.subtype==='hub');
const car65=PUB.filter(p=>sub(p.item_code)==='car' && IDX.byCode[p.item_code].attrs.watts.value===65).map(p=>String(p.item_code));
const carW=IDX.byCode[PUB.find(p=>sub(p.item_code)==='car' && IDX.byCode[p.item_code].attrs.watts.value).item_code].attrs.watts.value;
const carWset=PUB.filter(p=>sub(p.item_code)==='car' && IDX.byCode[p.item_code].attrs.watts.value===carW).map(p=>String(p.item_code));
chk('Q44 "<W> car charger" returns exactly the car-charger subtype items at that wattage ('+carW+'W: '+carWset.length+'; 65W: '+car65.length+' — wall chargers never leak in)',
  carWset.length>0 && sortedEq(B('may '+carW+'W car charger ba?').result.codes,carWset) && sortedEq(B('may 65W car charger ba?').result.codes,car65));

/* ---------- synthetic future SKU (monthly additions participate automatically) ---------- */
const base={ sheet:'', category:'', model:'', item_code:'', product_name:'', color:'', length:'', srp:999, dp:799, dp_volume:749, moq:10, upc:'', material_number:'', features:'', description:'', short_desc:'', sheet_display:'' };
const NEW=Object.assign({},base,{ item_code:'99999Z', model:'ZQ999', product_name:'Nexode 150W GaN 4-Port Desktop Charger', sheet_display:'Mobile: Charger', category:'Wall Charger/Desk Charger', srp:1, dp:1, dp_volume:1 });
const POOL=PUB.concat([NEW]), IDX2=F.build(POOL);
const sx=q=>VP.build(q,{ products:POOL, facts:IDX2 });
chk('Q45 synthetic new SKU is anchored by code and by model', sx('price ng 99999Z').subject[0]==='99999Z' && sx('ano DP ng ZQ999').subject[0]==='99999Z');
chk('Q46 synthetic new SKU joins filters + ranking with no code change (150W, 4 ports, cheapest)', sx('150W charger with 4 ports').result.codes.includes('99999Z') && sx('cheapest charger').result.codes[0]==='99999Z');
chk('Q47 removing it again leaves no trace (memo rebuild per catalog)', !B('price ng 99999Z').subject.length);

/* ---------- performance ---------- */
const t0=Date.now(); for(let i=0;i<200;i++) B(['cheapest 65W charger','may 8K HDMI ba','hub with HDMI + Ethernet','magkano tinaas ng '+CODE][i%4]); const per=(Date.now()-t0)/200;
chk('Q48 plan build after the facts index is warm: < 15 ms average (measured '+per.toFixed(2)+' ms)', per<15);

console.log(`\nVERO plan tests: ${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
