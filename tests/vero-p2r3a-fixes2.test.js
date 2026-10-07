/* VERO p2r3a fix pack 2 (held-out #2 review, 2026-10-07) — regression tests A–G + the approved data correction.
   Run: node tests/vero-p2r3a-fixes2.test.js
   A product-name / line-name anchors      B context safety (a new name never inherits old results)
   C car mounts                            D hard qualifiers never silently dropped
   E inch dimensions are never a price     F connector labels never undefined / null
   G named product + named device = compatibility      H inventory boundary still green      I data correction (NVMe / PCIe)
   Expectations are DERIVED from data/products.json + the facts index; no SKU lists are hardcoded. */
const fs=require('fs'), path=require('path');
const ROOT=path.join(__dirname,'..');
global.window={ PRICE_SETTINGS:{ indicatorDays:30 } };
eval(fs.readFileSync(path.join(ROOT,'js','helpers.js'),'utf8'));
['vero-lexicon','vero-nlu','vero-facts','vero-plan','vero-compose'].forEach(f=>require(path.join(ROOT,'js',f+'.js')));
const E=require(path.join(ROOT,'js','vero-engine.js'));
const F=require(path.join(ROOT,'js','vero-facts.js'));
const LEX=require(path.join(ROOT,'js','vero-lexicon.js'));
const ALL=JSON.parse(fs.readFileSync(path.join(ROOT,'data','products.json'),'utf8')); pcResolveSchedule(ALL);
const PUB=ALL.filter(p=>!p.disabled), IDX=F.build(PUB), byCode={}; PUB.forEach(p=>byCode[String(p.item_code)]=p);
let pass=0, fail=0; const chk=(n,c,x)=>{ if(c){ pass++; console.log('PASS - '+n); } else { fail++; console.log('FAIL - '+n+(x!==undefined?'  -> '+String(x).slice(0,400):'')); } };
function chat(turns){ let conv=null; return turns.map(q=>{ const r=E.answer(PUB,q,{ conv }); const a=E.aiRoute(PUB,q,r,{}); if(r.ctxOut) conv=r.ctxOut; return { q, r, a }; }); }
const one=q=>chat([q])[0];
const txt=x=>x.q+' => '+(x.r.note||'')+' | '+(x.r.stockNote||'')+' | '+(x.r.codes||[]).join(',');
const fam=c=>IDX.byCode[c]&&IDX.byCode[c].type.family, sub=c=>IDX.byCode[c]&&IDX.byCode[c].type.subtype, name=c=>String((byCode[c]||{}).product_name||'');
const sortedEq=(a,b)=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
const local=x=>x.a.route==='local' && !x.a.candidates.length;
const byName=re=>PUB.filter(p=>re.test(String(p.product_name))).map(p=>String(p.item_code));

/* ================= A product names ================= */
const studio=byName(/\bStudio Max5s\b/i), hitune6=byName(/\bHiTune Max 6\b/i), fit=byName(/\bFitBuds\b/i);
const A1=[['magkano ang Studio Max5s?',studio],['MAX5S price',studio],['available pa ba yung HiTune Max 6?',hitune6],['FitBuds MOQ',fit],['fitbuds dp',fit]].map(([q,w])=>({ x:one(q), w }));
chk('A1 product-name anchors resolve to exactly the SKUs whose NAME carries that line (derived: Studio Max5s '+studio.length+', HiTune Max 6 '+hitune6.length+', FitBuds '+fit.length+')',
  studio.length && hitune6.length && fit.length && A1.every(o=>sortedEq(o.x.r.codes,o.w) && local(o.x)), A1.map(o=>txt(o.x)).join(' || '));
chk('A2 a name anchor does not consume the intent: price → SRP/DP fields, MOQ → MOQ field, stock words → inventory wording',
  A1[0].x.r.plan.intent==='attribute' && A1[3].x.r.fields.includes('moq') && /naka-lista/i.test(A1[2].x.r.note) && /live inventory/.test(A1[2].x.r.stockNote||''), A1.map(o=>o.x.r.plan.intent+':'+o.x.r.fields.join('/')).join(' | '));
const finders=PUB.filter(p=>fam(p.item_code)==='smart_finder').map(p=>String(p.item_code));
const tr=['may tracker ba?','smart finder','bluetooth tracker'].map(one);
chk('A3 "tracker" / "smart finder" = the smart-finder family (derived '+finders.length+')', tr.every(x=>x.r.codes.length && x.r.codes.every(c=>finders.includes(c))), tr.map(txt).join(' || '));
const gal=finders.filter(c=>/\bgalaxy\b/i.test(name(c))), st=one('may samsung tracker kayo?');
chk('A4 "may samsung tracker kayo?" = trackers NAMED for Galaxy, LOCAL (a catalogue fact, not a web compatibility call)', gal.length && sortedEq(st.r.codes,gal) && local(st), txt(st)+' route='+st.a.route);
const hit=one('may hitune ba?'), hitAll=byName(/\bHiTune\b/i);
chk('A5 a broad line name ("hitune") lists that line (name filter), never "Wala tayong hitune"', sortedEq(hit.r.codes,hitAll) && !/^Wala/.test(hit.r.note), txt(hit));
const nf=one('magkano ang Zorbix 9?');
chk('A6 a product-like name that is not in the pricelist: honest "can’t find" (no SKU, model or product name matches), no products, no AI', /Hindi ko makita|can’t find/.test(nf.r.note) && !nf.r.codes.length && local(nf), txt(nf));

/* ================= B context safety ================= */
const fb=chat(['55137 vs 75288','e yung FitBuds magkano?']);
chk('B1 previous comparison, then "e yung FitBuds magkano?": FitBuds only (never the old products)', sortedEq(fb[1].r.codes,fit) && !fb[1].r.codes.some(c=>['55137','75288'].includes(c)), txt(fb[1]));
const fx=chat(['65W charger','e yung Zorbix magkano?']);
chk('B2 previous results, then an unknown product-like name: clarify "can’t find", no inherited products', !fx[1].r.codes.length && !fx[1].r.plan.followUp && /Hindi ko makita|can’t find/.test(fx[1].r.note), txt(fx[1]));
const fs2=chat(['may 100W na wall charger tayo?','how about Studio Max5s?']);
chk('B3 "how about <product name>?" switches to that product (anchor wins over the follow-up cue)', sortedEq(fs2[1].r.codes,studio) && !fs2[1].r.plan.followUp, txt(fs2[1]));
const fok=chat(['65W charger','how about 100W?']);
chk('B4 ordinary follow-ups still inherit (no over-blocking)', fok[1].r.plan.followUp && /charger/.test(fok[1].r.echo||''), txt(fok[1]));

/* ================= C car mounts ================= */
const cars=PUB.filter(p=>sub(p.item_code)==='car_mount').map(p=>String(p.item_code)), carMag=cars.filter(c=>/magnetic/i.test(name(c)));
const C=['need ko ng phone holder sa kotse na magnetic','magnetic car holder','pang kotse na phone holder','phone holder for car'].map(one);
chk('C1 holder + kotse / car → car mounts only (derived '+cars.length+'); magnetic → the magnetic car mounts (derived '+carMag.length+'); never "Wala"',
  carMag.length && sortedEq(C[0].r.codes,carMag) && sortedEq(C[1].r.codes,carMag) && C[2].r.codes.length && C[2].r.codes.every(c=>cars.includes(c)) && C[3].r.codes.every(c=>cars.includes(c)) && C.every(x=>!/^Wala|We don/.test(x.r.note)), C.map(txt).join(' || '));
const cc=one('charger sa kotse 30w');
chk('C2 "sa kotse" with a charger = car charger (kotse → car), holders untouched', cc.r.codes.length && cc.r.codes.every(c=>sub(c)==='car'), txt(cc));
const lp=one('laptop stand');
chk('C3 no car mapping without car words (laptop stand stays a laptop stand)', lp.r.codes.length && lp.r.codes.every(c=>sub(c)==='laptop_stand'), txt(lp));

/* ================= D hard qualifiers ================= */
const openE=PUB.filter(p=>fam(p.item_code)==='earphone' && /\bopen\b/i.test(name(p.item_code))).map(p=>String(p.item_code));
const D=['pinakamurang open ear earbuds','open-ear earbuds','open wearable earbuds'].map(one);
chk('D1 open ear / open-ear / open wearable → only earphones with "open" in the NAME (derived '+openE.length+'); cheapest first for the rank', openE.length && D.every(x=>x.r.codes.length && x.r.codes.every(c=>openE.includes(c))) && Number(byCode[D[0].r.codes[0]].srp)===Math.min(...openE.map(c=>Number(byCode[c].srp))), D.map(txt).join(' || '));
const fanW=PUB.filter(p=>fam(p.item_code)==='charger' && /\bfan\b/i.test(name(p.item_code))).map(p=>String(p.item_code));
const Df=['wireless charger na may fan','wireless charger with fan','sobrang init, may wireless charger na may fan?'].map(one);
chk('D2 may fan / with fan → only chargers named "with fan" (derived '+fanW.length+')', fanW.length && Df.every(x=>sortedEq(x.r.codes,fanW)), Df.map(txt).join(' || '));
const sil=one('silent mouse');
chk('D3 a qualifier with no catalogue evidence is SAID ("isn’t confirmed … not applied"), never silently dropped', /silent/.test(sil.r.note) && /confirmed/.test(sil.r.note), txt(sil));
const wp=one('waterproof usb c cable');
chk('D4 a qualifier whose only name hit is another product type gives an honest no-match, not that product', !wp.r.codes.length && /waterproof/i.test(wp.r.note), txt(wp));

/* ================= E dimensions ================= */
const bags=PUB.filter(p=>sub(p.item_code)==='laptop_bag');
const inRange=(c,v)=>{ const m=name(c).match(/(\d{1,2}(?:\.\d)?)\s*[“"”″']+\s*-\s*(\d{1,2}(?:\.\d)?)/); return m && v>=+m[1] && v<=+m[2]; };
const Ed=[['laptop bag 15.6 inch',15.6],['13.3" laptop bag',13.3],['14 inch laptop bag',14],['laptop bag 15.6in',15.6]].map(([q,v])=>({ x:one(q), v }));
chk('E1 15.6 inch / 13.3" / 14 inch → the laptop bag whose NAME range contains that size; never a price, never a clarify',
  Ed.every(o=>o.x.r.codes.length && o.x.r.codes.every(c=>inRange(c,o.v)) && !o.x.r.plan.filters.some(f=>f.attr==='price') && o.x.r.type!=='clarify'), Ed.map(o=>txt(o.x)).join(' || '));
const sl=one('14 inch laptop sleeve');
chk('E2 "14 inch laptop sleeve": the 14" size is kept and no ₱14 / "under ₱14" appears', sl.r.plan.match.some(m=>m.k==='size'&&m.v==='14') && !/₱\s?14\b/.test(sl.r.note) && !(sl.r.chips||[]).some(c=>/₱/.test(c.label)), txt(sl));
const e25=one('2.5" enclosure'), want25=PUB.filter(p=>fam(p.item_code)==='enclosure' && /2\.5\s*(?:''|"|“|”|″)/.test(' '+p.product_name)).map(p=>String(p.item_code));
chk('E3 drive size 2.5" unchanged', sortedEq(e25.r.codes,want25), txt(e25));
const k15=one('power bank under 1.5k'), k2=one('20k power bank under 2k');
chk('E4 decimal-k / k budgets unaffected (1.5k = ₱1,500; 20k = 20,000mAh)', k15.r.plan.filters.some(f=>f.attr==='price'&&f.value===1500) && k2.r.plan.filters.some(f=>f.attr==='mah'&&f.value===20000) && k2.r.plan.filters.some(f=>f.attr==='price'&&f.value===2000), JSON.stringify([k15.r.plan.filters,k2.r.plan.filters]));

/* ================= F connector labels ================= */
const V=window.VeroCompose||require(path.join(ROOT,'js','vero-compose.js'));
const BAD=/undefined|null|\[object Object\]/;
const keys=Object.keys(LEX.connectors);
const labs=[]; keys.forEach(a=>keys.forEach(b=>{ if(a!==b) labs.push(V.label({ type:null, form:'adapter', filters:[], match:[], standards:[], connectors:[], ports:[], pair:{ from:a, to:b }, result:{} },true)); }));
keys.forEach(k=>labs.push(V.label({ type:null, form:'cable', filters:[], match:[], standards:[], connectors:[k], ports:[{ kind:k, op:'has' }], pair:null, result:{} },true)));
chk('F1 every connector key gives a defined user label in pairs, connector lists and port lists ('+labs.length+' labels)', labs.every(l=>!BAD.test(l) && l.length>3), labs.filter(l=>BAD.test(l)).slice(0,4).join(' | '));
const md=one('mini displayport to hdmi 4k'), md2=one('mini dp to hdmi adapter');
chk('F2 "mini displayport to hdmi 4k" reads "Mini DisplayPort to HDMI" (no undefined)', /Mini DisplayPort to HDMI/.test(md.r.note) && !BAD.test(md.r.note) && !BAD.test(md2.r.note) && md.r.codes.length, md.r.note+' | '+md2.r.note);
const echoes=chat(['mini dp to hdmi','how about 4k?']);
chk('F3 the "Using: …" echo never shows a raw key / undefined', !BAD.test(echoes[1].r.echo||'') && !/mini_dp/.test(echoes[1].r.echo||''), echoes[1].r.echo);

/* ================= G compatibility ================= */
const w720=String(PUB.find(p=>String(p.model).trim()==='W720').item_code);
const G=['pwede ba yung W720 sa iPhone 16 Pro?','gagana ba ang W720 sa Galaxy S25?','W720 compatible with iPhone 15?','kaya ba ng W720 i-charge ang Pixel 9?'].map(one);
chk('G1 named SKU + named device + pwede / gagana / compatible / kaya → compatibility: WEB intent, the SKU = candidate #1, >= 2 candidates, no local claim',
  G.every(x=>x.r.plan.intent==='compat' && x.a.route==='web' && x.a.candidates[0]===w720 && x.a.candidates.length>=2 && !/\b(compatible|works with|gagana)\b/i.test((x.r.note||'').replace(/can’t confirm compatibility|ma-confirm ang compatibility/g,''))), G.map(x=>x.q+' -> '+x.r.plan.intent+'/'+x.a.route+' '+x.a.candidates.join(',')).join(' || '));
const g2=one('magkano ang W720?');
chk('G2 a plain price question about the same SKU stays a LOCAL card', local(g2) && g2.r.codes[0]===w720, txt(g2));

/* ================= H inventory boundary still green ================= */
const H=['may stock pa ng W720?','ilan pa natitira sa W720?','ubos na ba ang W720?','on hand pa ba ang W720?','available pa ba ang W720?'].map(one);
chk('H1 inventory wording on a named SKU: listed + live-inventory caveat, no count', H.every(x=>/naka-lista|listed/i.test(x.r.note) && /live inventory/.test(x.r.stockNote||'') && !/^\d/.test(x.r.note)), H.map(txt).join(' || '));
const Hn=[one('anong colors available ng W720?'), one('meron pa bang mas mura sa W720?')];
chk('H2 approved: colour "available" and "meron pa bang mas mura" carry NO inventory caveat', Hn.every(x=>!x.r.stockNote), Hn.map(txt).join(' || '));

/* ================= I data correction ================= */
const pcie=PUB.filter(p=>/\bpci-?e\b|\bpcie\b/i.test(p.product_name) && /card/i.test(p.product_name)).map(p=>String(p.item_code));
chk('I1 no PCIe expansion card is classified as a drive enclosure', pcie.length && pcie.every(c=>fam(c)!=='enclosure'), pcie.map(c=>c+':'+fam(c)).join(','));
const nv=one('nvme enclosure 10gbps pinakamura');
const nvWant=PUB.filter(p=>fam(p.item_code)==='enclosure' && /\bnvme\b/i.test(p.product_name) && /10\s?gbps/i.test(p.product_name)).sort((a,b)=>a.srp-b.srp).map(p=>String(p.item_code));
chk('I2 "nvme enclosure 10gbps pinakamura" → cheapest real 10Gbps NVMe enclosure first (derived '+nvWant[0]+'), no PCIe card', nv.r.codes[0]===nvWant[0] && !nv.r.codes.some(c=>pcie.includes(c)), txt(nv));

console.log(`\nVERO p2r3a fix pack 2: ${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
