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

/* ================= L p2r3a.3 post-match car rule (2026-10-08) =================
   "car items only when car is asked, unless they are the only matches" is applied AFTER matching (as in p2r2.1).
   The old pre-match pool filter hid car-only wattages / features ("may 36W charger ba?" → false "Wala").
   Intentional policy: the soft-qualifier rerun ("travel charger 36W"), the facet rerun and the MagSafe related list keep
   the non-car pool. Out of scope (known residuals): subtype narrowing ("magnetic phone holder", "gravity phone holder",
   "phone holder with suction cup", "phone mount"), "bluetooth 5.0" read as a price, qc 3.0 / 12V / 24V / truck
   qualifier drops, vent / waterfall / dashboard / headrest holders, CM763 / 35265 data. All sets derived from data. */
const isCarP=p=>!!p && (sub(String(p.item_code))==='car' || /\bcar\b/i.test(String(p.product_name||'')) || /\bcar\b/i.test(String(p.sheet_display||'')));
const isCarC=c=>isCarP(byCode[c]);
const carNote=x=>/all matching items are car chargers\/accessories|car chargers\/accessories lahat ng tugmang items/.test(x.r.note||'');
const falseNeg=x=>/\bWala\b|We don.t have|^0\s*—/.test(x.r.note||'');
const chargers=PUB.filter(p=>fam(p.item_code)==='charger'), wOf=c=>IDX.byCode[c].attrs.watts.value;
const wSet={}; chargers.forEach(p=>{ const c=String(p.item_code), w=wOf(c); if(w==null) return; (wSet[w]=wSet[w]||[]).push(c); });
const carOnlyW=Object.keys(wSet).map(Number).filter(w=>wSet[w].every(isCarC)).sort((a,b)=>a-b);
const mixedW=Object.keys(wSet).map(Number).filter(w=>wSet[w].some(isCarC) && wSet[w].some(c=>!isCarC(c))).sort((a,b)=>a-b);
const wallOnlyW=Object.keys(wSet).map(Number).filter(w=>wSet[w].every(c=>!isCarC(c)));
chk('L0 derived sets: car-only charger wattages ['+carOnlyW.join(',')+'] (expected today 36,60,63,75,90,130,145); mixed ['+mixedW.join(',')+']',
  carOnlyW.length>0 && mixedW.length>0 && JSON.stringify(carOnlyW)==='[36,60,63,75,90,130,145]', carOnlyW.join(','));
const L1=[], L1bad=[];
carOnlyW.forEach(w=>{ const want=wSet[w];
  ['%W charger','may %W charger ba?','how many %W chargers do you have?','ilan ang %W charger nyo?','cheapest %W charger'].forEach(t=>{ const x=one(t.replace('%',w)); L1.push(x);
    if(!(sortedEq(x.r.codes,want) && carNote(x) && !falseNeg(x) && local(x))) L1bad.push(txt(x)); });
  /* bare "<W>" (no type): if any NON-car product in any family has that wattage, the rule keeps those (no car item, no note);
     otherwise only the car chargers match → the car set + note */
  const anyNC=PUB.some(p=>!isCarP(p) && IDX.byCode[String(p.item_code)].attrs.watts.value===w), xb=one(w+'W'); L1.push(xb);
  if(!(anyNC ? (xb.r.codes.length && !xb.r.codes.some(isCarC) && !carNote(xb)) : (sortedEq(xb.r.codes,want) && carNote(xb))) || falseNeg(xb) || !local(xb)) L1bad.push('bare '+txt(xb));
  const two=want.filter(c=>{ const pv=IDX.byCode[c].attrs.ports.value; return pv && pv.total===2; });
  if(two.length){ const x=one(w+'W charger 2 ports'); L1.push(x); if(!(sortedEq(x.r.codes,two) && carNote(x) && local(x))) L1bad.push(txt(x)); }
  const uc=want.filter(c=>IDX.byCode[c].attrs.connectors.named.indexOf('usb_c')>=0);
  if(uc.length){ const x=one(w+'W usb c charger'); L1.push(x); if(!(sortedEq(x.r.codes,uc) && carNote(x) && local(x))) L1bad.push(txt(x)); } });
chk('L1 every car-only wattage (derived): bare / charger / exist / count EN+TL / cheapest / 2 ports / USB-C return exactly the car set + car note, never "Wala" / "0 —", LOCAL ('+L1.length+' queries)',
  L1.length>=40 && !L1bad.length, L1bad.join(' || '));
const L2=[]; carOnlyW.forEach(w=>[w+'W car charger','car charger '+w+'W'].forEach(q=>L2.push({ x:one(q), want:wSet[w] })));
chk('L2 explicit car queries for those wattages: same car set, no extra car-only note, LOCAL',
  L2.every(o=>sortedEq(o.x.r.codes,o.want) && !carNote(o.x) && !falseNeg(o.x) && local(o.x)), L2.filter(o=>!(sortedEq(o.x.r.codes,o.want)&&!carNote(o.x))).map(o=>txt(o.x)).join(' || '));
const L3=mixedW.map(w=>({ w, x:one(w+'W charger'), want:wSet[w].filter(c=>!isCarC(c)) }));
chk('L3 mixed wattages ['+mixedW.join(',')+']: "<W> charger" shows only the non-car chargers (derived), no car item, no car-only note',
  L3.every(o=>sortedEq(o.x.r.codes,o.want) && !o.x.r.codes.some(isCarC) && !carNote(o.x)), L3.map(o=>txt(o.x)).join(' || '));
const L4=[45,65,100].map(w=>({ x:one(w+'W charger'), want:wSet[w] })), L4p=[one('65W charger 3 ports'),one('100W charger 4 ports')];
chk('L4 wall-only controls: 45W / 65W / 100W charger = the derived set, no car note; port-count queries unchanged and car-free',
  [45,65,100].every(w=>wallOnlyW.includes(w)) && L4.every(o=>sortedEq(o.x.r.codes,o.want) && !carNote(o.x)) && L4p.every(x=>x.r.codes.length && !x.r.codes.some(isCarC) && !carNote(x)), L4.map(o=>txt(o.x)).concat(L4p.map(txt)).join(' || '));
const nonCarCh=chargers.filter(p=>!isCarP(p)).map(p=>String(p.item_code)), carCh=chargers.filter(isCarP).map(p=>String(p.item_code));
const L5=['how many chargers do you have?','car charger','wall charger','cheapest charger','highest wattage charger','pinakamurang charger'].map(one);
chk('L5 generic counts / ranks unchanged: chargers = non-car ('+nonCarCh.length+'), car charger = car ('+carCh.length+'), wall charger has no car item, ranks car-free, no car note',
  sortedEq(L5[0].r.codes,nonCarCh) && sortedEq(L5[1].r.codes,carCh) && L5[2].r.codes.length && !L5[2].r.codes.some(isCarC) && L5.slice(3).every(x=>x.r.codes.length && !x.r.codes.some(isCarC)) && L5.every(x=>!carNote(x)),
  L5.map(x=>x.q+' => '+x.r.codes.length+' '+(x.r.note||'').slice(0,60)).join(' || '));
/* L6 the "not ranked" caption counts only the set that is shown: with non-car matches, car items with no listed value never add to it */
const L6=['cheapest 65W charger','cheapest 100W charger','highest wattage charger'].map(one);
const unkNC=w=>chargers.filter(p=>!isCarP(p) && (w==null || true) && wOf(String(p.item_code))==null).length;
chk('L6 "(N without a listed value not ranked)" = non-car chargers with no listed wattage ('+unkNC()+'); car chargers never inflate it',
  L6.every(x=>{ const m=(x.r.note||'').match(/\((\d+) without a listed value not ranked\)/); return m && Number(m[1])===unkNC(); }), L6.map(txt).join(' || '));
const retr=chargers.filter(p=>IDX.byCode[String(p.item_code)].attrs.flags.retractable).map(p=>String(p.item_code));
const L7=['retractable charger','charger with retractable cable','may charger na may retractable cable ba?'].map(one), L7b=[one('1c1a charger'),one('2c1a charger')];
chk('L7 car-only feature queries: retractable (derived '+retr.length+', all car = '+retr.every(isCarC)+') → that set + car note; 1C1A / 2C1A → car chargers + car note, never "Wala"',
  retr.length && retr.every(isCarC) && L7.every(x=>sortedEq(x.r.codes,retr) && carNote(x) && local(x)) && L7b.every(x=>x.r.codes.length && x.r.codes.every(isCarC) && carNote(x) && !falseNeg(x)), L7.concat(L7b).map(txt).join(' || '));
const holders=PUB.filter(p=>fam(p.item_code)==='holder'), magH=holders.filter(p=>/\bmagnetic\b/i.test(String(p.product_name))).map(p=>String(p.item_code));
const L8=[one('magnetic holder'),one('may magnetic holder ba?'),one('suction cup holder'),one('gravity holder')];
chk('L8 holder cases of the SAME rule (broad "holder" type): magnetic (derived '+magH.length+', all car mounts) / suction cup / gravity → car mounts + note, never "Wala"',
  magH.length && magH.every(isCarC) && sortedEq(L8[0].r.codes,magH) && sortedEq(L8[1].r.codes,magH) && L8.every(x=>x.r.codes.length && x.r.codes.every(isCarC) && carNote(x) && !falseNeg(x) && local(x)), L8.map(txt).join(' || '));
const L9=one('36W travel charger');
chk('L9 soft-qualifier policy (intentional): "36W travel charger" keeps the conservative answer — no car chargers surfaced, no car note',
  !L9.r.codes.some(isCarC) && !carNote(L9) && /travel/i.test(L9.r.note||''), txt(L9));
const L10=one('magsafe charger');
chk('L10 MagSafe related list keeps the non-car pool (no car item listed as related)', !(L10.r.codes||[]).some(isCarC), txt(L10));
const L11=one('36W charger'), L11f=one('200W charger');
chk('L11 facet rerun keeps the non-car pool: a zero-result wall-family facet ("Chargers we carry") lists no car-only wattage; "36W charger" is no longer a zero result',
  L11.r.codes.length && (!/we carry/i.test(L11f.r.note||'') || !carOnlyW.some(w=>new RegExp('\\b'+w+'W\\b').test((L11f.r.note||'').split(/we carry/i)[1]||''))), txt(L11)+' || '+txt(L11f));
const L12=[chat(['36W charger','alin dun yung type c?'])[1], chat(['65W charger','how about 36W'])[1], chat(['car charger','how about 30W'])[1]];
const ucCar36=wSet[36].filter(c=>IDX.byCode[c].attrs.connectors.named.indexOf('usb_c')>=0);
chk('L12 follow-ups after / into a car-only result stay consistent: 36W → type c = the USB-C car charger(s) + note; "how about 36W" = the 36W car set; car charger → 30W stays car, no extra note; LOCAL',
  sortedEq(L12[0].r.codes,ucCar36) && carNote(L12[0]) && sortedEq(L12[1].r.codes,wSet[36]) && carNote(L12[1]) && L12[2].r.codes.length && L12[2].r.codes.every(isCarC) && !carNote(L12[2]) && L12.every(local), L12.map(txt).join(' || '));
/* L13–L15 ACCEPTED (2026-10-08): a compatibility question on a car-only wattage routes through the EXISTING WEB/AI
   compatibility path with the car-only catalog candidates — same policy as "65W charger compatible ba sa iphone 15?".
   Deterministic: checks routing + candidate / payload construction only, never an external AI answer. */
const vjs=fs.readFileSync(path.join(ROOT,'js','vero.js'),'utf8'), vbody=vjs.slice(vjs.indexOf('var body='),vjs.indexOf('fetch(a.url+\'/ask\''));   /* same slice as p2r3a A23 */
const PRICEY=/\b(srp|dp|dp_volume|dpvol|moq|price|presyo|dealer|special)\b/i;
function compatOk(x,matchSet,carOnlyCase){
  const a=x.a, R=x.r.plan.result, cand=a.candidates;
  return x.r.plan.route.route==='WEB' && /^R3 compat/.test(x.r.plan.route.rule||'') && a.route==='web'      // intentional compat route, not a Local Brain failure
    && sortedEq(R.codes,matchSet) && !!R.carOnly===carOnlyCase && !falseNeg(x)                           // correct catalog match set, no false "Wala"
    && cand.length>=2 && cand.length<=8 && cand.every(c=>typeof c==='string' && !!byCode[c])                // valid published item codes only (Worker min 2 / max 8)
    && JSON.stringify(cand.slice(0,matchSet.length).slice().sort())===JSON.stringify(matchSet.slice().sort())// the match set leads the candidates
    && cand.every(c=>fam(c)==='charger') && (!carOnlyCase || cand.every(isCarC))                           // padding = same family (car-only case: car items only)
    && !PRICEY.test(JSON.stringify(a)) && !x.r.plan.flags.stock && !x.r.stockNote;                          // no prices / dealer fields in the route object; no stock inference
}
const L13=[one('36W charger compatible ba sa iphone 15?'), one('36W charger para sa iphone')];
chk('L13 accepted: car-only wattage compatibility (36W, iPhone) → existing WEB compat route, candidates = exactly the derived 36W car set, car note, no "Wala", no stock, no price fields',
  L13.every(x=>compatOk(x,wSet[36],true) && sortedEq(x.a.candidates,wSet[36]) && carNote(x)), L13.map(x=>txt(x)+' route='+x.a.route+' cands='+x.a.candidates.join(',')+' rule='+x.r.plan.route.rule).join(' || '));
const L14=one('60W charger for macbook');
chk('L14 accepted: "60W charger for macbook" → WEB compat route; the single 60W car charger is candidate #1, padding (Worker minimum) is car chargers only, ≤ 8, valid codes, no price fields',
  compatOk(L14,wSet[60],true) && L14.a.candidates[0]===wSet[60][0], txt(L14)+' cands='+L14.a.candidates.join(','));
const L15=one('65W charger compatible ba sa iphone 15?');
chk('L15 control: "65W charger compatible ba sa iphone 15?" follows the same existing policy (WEB compat route, the derived 65W wall set as candidates, no car item, no car note)',
  compatOk(L15,wSet[65],false) && sortedEq(L15.a.candidates,wSet[65]) && !L15.a.candidates.some(isCarC) && !carNote(L15), txt(L15)+' cands='+L15.a.candidates.join(','));
chk('L16 AI payload schema unchanged (vero.js): exactly v, q, candidates (codes, max 8), history, route, trigger — no SRP / DP / DP Vol / MOQ / dealer field',
  /v:1,\s*q:/.test(vbody) && /candidates:am\.candidates\.slice\(0,8\)/.test(vbody) && /history:/.test(vbody) && /route:am\.route/.test(vbody) && /trigger:am\.trigger/.test(vbody) && !/srp|\bdp|moq|price|dealer/i.test(vbody), vbody);

console.log(`\nVERO p2r3a fix pack 2: ${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
