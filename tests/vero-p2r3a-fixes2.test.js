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

/* ================= J PCIe naming variants (final browser review, 2026-10-07) =================
   Names write "PCI-E3.0X4" and "PCIe Gen 4"; users type pcie / pci-e / pci express. Expected set = every SKU in the
   "PCIe Expansion Card" category (derived from data, never listed). */
const pcieCat=PUB.filter(p=>p.category==='PCIe Expansion Card').map(p=>String(p.item_code));
const noneNote=x=>/don.t have|we do not have|\bwala\b|not in (?:the|this) (?:current )?pricelist/i.test(x.r.note||'');
const J1=['pcie expansion card','pcie card','m.2 to pcie','may pcie card ba?','nvme to pcie adapter','pci-e expansion card','pci express expansion card','pcie adapter'].map(one);
chk('J1 every PCIe spelling / phrasing returns exactly the PCIe Expansion Card SKUs (derived '+pcieCat.length+'), LOCAL, no false "we don\'t have"',
  pcieCat.length>=2 && J1.every(x=>sortedEq(x.r.codes,pcieCat) && local(x) && !noneNote(x)), J1.filter(x=>!(sortedEq(x.r.codes,pcieCat)&&local(x)&&!noneNote(x))).map(txt).join(' || '));
const J2a=one('m.2 to pcie'), J2b=one('pcie to m.2');
chk('J2 "X to Y" is a direction, not a name phrase: "m.2 to pcie" and "pcie to m.2" return the same set', sortedEq(J2a.r.codes,J2b.r.codes) && sortedEq(J2a.r.codes,pcieCat), txt(J2a)+' || '+txt(J2b));
const J3=one('pcie card'), J3m=PUB.filter(p=>pcieCat.includes(String(p.item_code))).map(p=>p.model), fitM=new Set(fit.map(c=>byCode[c].model)), J3f=one('fitbuds');
chk('J3 a name match spanning several models never says "Model X has N SKUs"; a single-model name match still does',
  new Set(J3m).size>1 && !/^Model /.test(J3.r.note||'') && (fitM.size!==1 || /^Model /.test(J3f.r.note||'')), txt(J3)+' || '+txt(J3f));
const J4=one('may stock ba ng pcie card?');
chk('J4 stock wording on PCIe cards: listed + live-inventory caveat, no count, no false "wala"', sortedEq(J4.r.codes,pcieCat) && !!J4.r.stockNote && !noneNote(J4) && !/\b\d+\s*(?:units|pcs|left)\b/i.test(J4.r.note||''), txt(J4));
const J5=['hdmi to vga adapter','usb-c to hdmi adapter','65W charger','m.2 enclosure'].map(one);
chk('J5 no collateral: adapter / charger / enclosure queries never pick up a PCIe Expansion Card', J5.every(x=>x.r.codes.length && !x.r.codes.some(c=>pcieCat.includes(c))), J5.map(txt).join(' || '));
/* J6 generic, not SKU-specific: synthetic SKUs with fresh codes, each spelling, join the same answers with no code change */
const SYN=[['J6SYN01','PCI Express x1 to 4-Port USB 3.0 Card','JSYN1'],['J6SYN02','PCI-E x1 to 2.5G LAN Card','JSYN2'],['J6SYN03','PCIe Gen3 Riser Card','JSYN3']]
  .map(([c,n,m])=>Object.assign({},PUB.find(p=>p.category==='PCIe Expansion Card'),{ item_code:c, model:m, product_name:n, upc:'', material_number:'' }));
const POOL6=PUB.concat(SYN), want6=pcieCat.concat(SYN.map(p=>p.item_code));
const J6=['pcie card','pci-e card','pci express card'].map(q=>({ q, r:E.answer(POOL6,q,{}) }));
chk('J6 normalization is generic: synthetic SKUs spelled "PCI Express" / "PCI-E" / "PCIe" all match every spelling (derived '+want6.length+')',
  J6.every(x=>sortedEq(x.r.codes,want6)), J6.map(x=>x.q+' => '+(x.r.codes||[]).join(',')).join(' || '));

/* ================= K P0 live safety guards (p2r3a.2, 2026-10-08) =================
   K1–K4 guard 1: a count / existence with no product subject never answers a catalogue-empty "0 — Wala … product".
   K5–K6 guard 2: closed-class grammar / stock words are never a product name ("Walang in …").
   K7 guard 3: every code named as "not confirmed" belongs to the family of the products shown.
   Known residuals — NOT fixed by P0, they belong to v2-2 (QueryPlan delta):
     - "which one is Gen 4?" after a PCIe search still answers "I can't find 'gen'"
     - "yung may 3 ports lang" after a charger search loses the context (whole-catalogue search)
     - the 10000mAh constraint is dropped on "yung may built-in cable"
     - stock follow-ups ("in stock ba?", "stock?") ask for the product type instead of inheriting the context
     - RELAX ("kahit ilang ports", "any number of ports") clarifies; it does not yet return the relaxed set */
const emptyCat=x=>/^0\s*—|\b(?:wala tayong|we don.t have (?:a|any)) products?\b/i.test(x.r.note||'');
const clarified=x=>x.r.type==='clarify' && !(x.r.codes||[]).length;
const K1=['ilan?','how many?','ilang ports','kahit ilang ports','any number of ports','may ports ba?'].map(one);
chk('K1 a bare count / field-only question (no product noun) clarifies — never "0 —" / "Wala … product", LOCAL',
  K1.every(x=>clarified(x) && !emptyCat(x) && local(x)), K1.map(txt).join(' || '));
const K2=['100W charger 4 ports','65W charger 3 ports'].map((q,i)=>chat([q,i?'any number of ports':'kahit ilang ports'])[1]);
chk('K2 RELAX-shaped follow-ups after a charger search never give a false catalogue-empty answer (P0 may clarify; RELAX is v2-2)',
  K2.every(x=>!emptyCat(x) && !/^Wala|don.t have/i.test(x.r.note||'') && local(x)), K2.map(txt).join(' || '));
const K3=['how many products do you have','ilang items meron kayo','how many skus do you have'].map(one), total=PUB.length;
chk('K3 a generic catalogue noun gets the listed (published) total, derived from data ('+total+'), LOCAL, no cards',
  K3.every(x=>new RegExp('^'+total.toLocaleString('en-US')+'\\b').test(x.r.note||'') && !(x.r.codes||[]).length && local(x)), K3.map(txt).join(' || '));
const kb=PUB.filter(p=>/\bkeyboard\b/i.test(String(p.product_name))).length;
const K4=['ilan ang keyboard nyo?','how many keyboards do you have','may keyboard kayo?'].map(one), K4x=one('meron ba kayong xyzabc');
chk('K4 an unknown product noun gets the honest per-noun negative for count AND existence (data has '+kb+' keyboard names); never "0 — … product"',
  kb===0 && K4.every(x=>/\bkeyboards?\b/i.test(x.r.note||'') && /^(?:Wala tayong|We don.t have any)/.test(x.r.note||'') && !emptyCat(x) && local(x))
  && /xyzabc/.test(K4x.r.note||'') && /^Wala tayong/.test(K4x.r.note||''), K4.concat([K4x]).map(txt).join(' || '));
const K4r=one('ilan ang power bank?'), pbAll=PUB.filter(p=>fam(p.item_code)==='power_bank').map(p=>String(p.item_code));
chk('K4b a real product count is unchanged (power banks, derived '+pbAll.length+')', sortedEq(K4r.r.codes,pbAll) && new RegExp('^'+pbAll.length+'\\b').test(K4r.r.note||'') && local(K4r), txt(K4r));
const K5=[one('in stock ba?'), chat(['65W charger','in stock ba?'])[1], one('may stock pa ba?')];
chk('K5 "in stock ba?" (standalone / after a search) never names "in" as a product: asks for the product type + live-inventory caveat, no quantity, LOCAL',
  K5.every(x=>!/\bwalang in\b|\bno in\b/i.test(x.r.note||'') && clarified(x) && /live inventory/.test(x.r.stockNote||'') && !/\b\d+\s*(?:units|pcs|left|natitira)\b/i.test((x.r.note||'')+(x.r.stockNote||'')) && local(x)), K5.map(txt).join(' || '));
const K6=one('may stock ba ng 65W charger?');
chk('K6 a stock question WITH a product still lists it + caveat (guard 2 does not swallow real nouns)', K6.r.codes.length>0 && K6.r.codes.every(c=>fam(c)==='charger') && /live inventory/.test(K6.r.stockNote||''), txt(K6));
const codesIn=s=>(String(s||'').match(/[A-Z0-9]{4,}/g)||[]).filter(c=>byCode[c]);
const K7=[chat(['power bank 10000mah','yung may built-in cable'])[1], one('power bank with built-in cable')];
chk('K7 every code named in a "not confirmed" note belongs to the family of the shown products (no off-family enclosure named as a power bank)',
  K7.every(x=>{ const sf=new Set((x.r.codes||[]).map(fam)), named=codesIn(x.r.note).filter(c=>!(x.r.codes||[]).includes(c)); return x.r.codes.length && named.every(c=>sf.has(fam(c))) && local(x); }),
  K7.map(x=>txt(x)+' [named: '+codesIn(x.r.note).map(c=>c+':'+fam(c)).join(',')+']').join(' || '));
const K7raw=(K7[0].r.plan.result.mentioned||[]).filter(c=>fam(c)!=='power_bank');
chk('K7b the guard is exercised: the underlying weak matches DO contain off-family codes ('+K7raw.length+'), and none of them reaches the note',
  K7raw.length>0 && K7raw.every(c=>!(K7[0].r.note||'').includes(c)), K7raw.join(','));
const K8=one('hdmi2.1'), K8g=one('8k hdmi under 2.5k'), K8gRaw=(K8g.r.plan.result.mentioned||[]);
chk('K8 a typed label ("HDMI 2.1 video cables") never cites other families as unconfirmed; a GENERIC label ("8K HDMI products", no type) keeps its mentions',
  K8.r.plan.type && codesIn(K8.r.note).filter(c=>!K8.r.codes.includes(c)).every(c=>fam(c)===K8.r.plan.type.family)
  && !K8g.r.plan.type && !K8g.r.plan.form && K8gRaw.slice(0,5).every(c=>(K8g.r.note||'').includes(c)), txt(K8)+' || '+txt(K8g));
const negWord=x=>/^(?:Wala tayong|We don.t have any)\b/.test(x.r.note||'');
const K9t=['how many products in total','ilan lahat ng products?'].map(one), K9q=['how many new products','how many products for macbook','may products for car?','how many items for iphone'].map(one);
chk('K9 a catalogue noun with a quantifier gets the listed total; with a qualifier it clarifies — never "We don\'t have any products …"',
  K9t.every(x=>new RegExp('^'+total.toLocaleString('en-US')+'\\b').test(x.r.note||'') && local(x)) && K9q.every(x=>!negWord(x) && !emptyCat(x) && local(x)), K9t.concat(K9q).map(txt).join(' || '));
/* K10 generic: for each noun, derive from data whether a published NAME / CATEGORY carries it; the per-noun negative must match that fact */
const inData=w=>{ const st=[w].concat(/s$/.test(w)?[w.slice(0,-1)]:[],/es$/.test(w)?[w.slice(0,-2)]:[]), re=new RegExp('(^|[^a-z0-9])(?:'+st.join('|')+')(?:s|es)?(?![a-z])','i'); return PUB.some(p=>re.test(String(p.product_name||'')+' '+String(p.category||''))); };
const K10n=['bag','stand','headphones','kvm','backpack','dxp','sleeves','drives','phones','cases','keyboards','keyboard','drone'], K10=[];
K10n.forEach(w=>['may '+w+' ba kayo?','how many '+w+' do you have'].forEach(q=>K10.push({ w, has:inData(w), x:one(q) })));
chk('K10 a "Wala / We don\'t have <noun>" is only given when no published product name or category carries the noun (derived per noun); otherwise no negative',
  K10.some(o=>o.has) && K10.some(o=>!o.has) && K10.every(o=>o.has?!negWord(o.x):true) && K10.filter(o=>!o.has).every(o=>negWord(o.x)) && K10.every(o=>local(o.x)),
  K10.filter(o=>o.has?negWord(o.x):!negWord(o.x)).map(o=>o.w+'(has='+o.has+'): '+txt(o.x)).join(' || '));

console.log(`\nVERO p2r3a fix pack 2: ${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
