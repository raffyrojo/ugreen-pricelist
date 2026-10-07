/* VERO Local Brain — facts index tests (Foundation Step 1, PARITY MODE).
   Run: node tests/vero-facts.test.js
   Uses the REAL data/products.json plus synthetic future SKUs. Expected values are derived from the data, not hardcoded.
   Parity: the facts index must reproduce today's NLU type words and evidence tiers exactly before any parser logic moves. */
const fs=require('fs'), path=require('path');
const ROOT=path.join(__dirname,'..');
const NL=require(path.join(ROOT,'js','vero-nlu.js'));
const E=require(path.join(ROOT,'js','vero-engine.js'));
const F=require(path.join(ROOT,'js','vero-facts.js'));
const RAWTXT=fs.readFileSync(path.join(ROOT,'data','products.json'),'utf8');
const P=JSON.parse(RAWTXT);
let pass=0, fail=0;
const chk=(n,c,extra)=>{ if(c){pass++;console.log('PASS - '+n);} else {fail++;console.log('FAIL - '+n+(extra?'  -> '+String(extra).slice(0,500):''));} };
const by=c=>P.find(p=>String(p.item_code)===String(c));
const base={ sheet:'', category:'', model:'', item_code:'', product_name:'', color:'', length:'', srp:999, dp:799, dp_volume:749, moq:10, image:'', upc:'', material_number:'', remarks:'', features:'', description:'', short_desc:'', sheet_display:'' };
const mk=o=>Object.assign({},base,o);

/* ---------- build + performance ---------- */
const t0=Date.now(); const IDX=F.build(P,{force:true}); const buildMs=Date.now()-t0;
const t1=Date.now(); const IDX2=F.build(P); const memoMs=Date.now()-t1;
const facts=Object.values(IDX.byCode);
chk('F01 one fact per product ('+P.length+')', facts.length===P.length && P.every(p=>IDX.byCode[String(p.item_code)]));
chk('F02 memoized per catalog version (same index object, < 50ms)', IDX2===IDX && memoMs<50, memoMs+'ms');
chk('F03 build time reasonable (< 3000ms in Node; reported: '+buildMs+'ms)', buildMs<3000, buildMs);
chk('F04 build does not mutate the catalog (products.json round-trips unchanged)', JSON.stringify(P)===JSON.stringify(JSON.parse(RAWTXT)));
const S=IDX.stats;
chk('F05 coverage stats add up (classified + other = total)', S.classified+S.other===S.total && S.total===P.length, JSON.stringify(S));

/* ---------- structured classification (data-derived) ---------- */
const famRules=[
  ['Docking Station category -> hub_dock.dock', p=>p.category==='Docking Station', f=>f.type.family==='hub_dock'&&f.type.subtype==='dock'],
  ['Hub category -> hub_dock.hub', p=>p.category==='Hub', f=>f.type.family==='hub_dock'&&f.type.subtype==='hub'],
  ['Power Bank -> power_bank', p=>p.category==='Power Bank', f=>f.type.family==='power_bank'],
  ['Mobile: Charger section / Car Charger -> charger', p=>p.sheet_display==='Mobile: Charger'||p.category==='Car Charger', f=>f.type.family==='charger'],
  ['Wireless Charger -> charger.wireless', p=>p.category==='Wireless Charger', f=>f.type.subtype==='wireless'],
  ['Car Charger -> charger.car', p=>p.category==='Car Charger', f=>f.type.subtype==='car'],
  ['NAS Storage -> nas (line = category)', p=>p.sheet_display==='NAS Storage', f=>f.type.family==='nas'&&!!f.type.line],
  ['Ethernet Adapter section -> network_adapter', p=>p.sheet_display==='Transmission: Ethernet Adapter', f=>f.type.family==='network_adapter'],
  ['USB-C Data Charging Cable -> charging_cable.usb_c', p=>p.category==='USB-C Data Charging Cable', f=>f.type.family==='charging_cable'&&f.type.subtype==='usb_c']
];
famRules.forEach(([n,sel,ok],i)=>{ const sel2=P.filter(sel); const bad=sel2.filter(p=>!ok(IDX.byCode[String(p.item_code)])); chk('F'+String(6+i).padStart(2,'0')+' '+n+' ('+sel2.length+')', sel2.length>0&&!bad.length, bad.map(p=>p.item_code).join(',')); });
chk('F15 structured sources only for real-catalog families (no family from name/description when fields match)', facts.filter(f=>f.type.family!=='other').every(f=>f.type.source==='category'||f.type.source==='sheet_display'));
const dmut=P.slice(0,60).map(p=>Object.assign({},p,{description:'best power bank charger hub docking station nas', short_desc:'power bank hub'}));
chk('F16 description / short_desc never assign a family or type', dmut.every(p=>{ const a=F.factFor(p), b=IDX.byCode[String(p.item_code)]; return a.type.family===b.type.family&&a.type.subtype===b.type.subtype&&JSON.stringify(a.type.forms)===JSON.stringify(b.type.forms); }));

/* ---------- parity: type words ---------- */
const typeMis=[]; P.forEach(p=>{ const L=F.legacyTypes(IDX.byCode[String(p.item_code)]); Object.keys(NL.types).forEach(k=>{ if(!!NL.types[k](p)!==L[k]) typeMis.push(p.item_code+':'+k); }); });
chk('F17 PARITY type words: facts reproduce VeroNLU.types for every product × '+Object.keys(NL.types).length+' types', !typeMis.length, typeMis.slice(0,10).join(','));
const chMis=P.filter(p=>E.productWatts(p)!=null && IDX.byCode[String(p.item_code)].type.family!=='charger' && E.productPorts(p)!=null);
chk('F18 PARITY engine charger class == facts charger family', P.every(p=>(p.sheet_display==='Mobile: Charger'||p.category==='Car Charger')===(IDX.byCode[String(p.item_code)].type.family==='charger')) && !chMis.length);

/* ---------- parity: evidence tiers ---------- */
const grid=[];
for(const q of [null,'hdmi','dp','vga']){ for(let v=1;v<=6;v++) grid.push({k:'res',v,q});
  for(const [r,hz] of [[null,60],[null,120],[null,144],[null,240],[4,60],[4,120],[4,144],[2,120],[2,144],[3,120],[6,30],[6,60]]) grid.push({k:'refresh',r,hz,q}); }
[1.4,2.0,2.1].forEach(v=>grid.push({k:'hdmiver',v})); [1,2,5,10,20,40,80].forEach(v=>grid.push({k:'gbps',v})); [0.1,1,2.5,5,10].forEach(v=>grid.push({k:'eth',v}));
Object.keys(NL.flags).forEach(v=>grid.push({k:'flag',v}));
['gray','grey','white','black','blue','silver','green','red','pink','purple','yellow','beige','gold'].forEach(v=>grid.push({k:'color',v}));
[[0,0.5],[1,1],[1,2],[2,3],[3,5],[5,100],[0.1,0.3]].forEach(([lo,hi])=>grid.push({k:'lenRange',lo,hi}));
let nChecks=0; const evMis=[]; const tierCount={strong:0,medium:0,weak:0};
P.forEach(p=>{ const f=IDX.byCode[String(p.item_code)]; grid.forEach(a=>{ nChecks++; const x=NL.match(p,a), y=F.match(f,a); const tx=x?x.t:null, ty=y?y.t:null; if(ty) tierCount[ty]++; if(tx!==ty) evMis.push(p.item_code+' '+JSON.stringify(a)+' nlu='+tx+' facts='+ty); }); });
chk('F19 PARITY evidence tiers: facts.match == VeroNLU.match on '+nChecks+' product × constraint checks (strong '+tierCount.strong+', medium '+tierCount.medium+', weak '+tierCount.weak+')', !evMis.length, evMis.slice(0,5).join(' | '));
const pm=P.filter(p=>E.productPorts(p)!==((IDX.byCode[String(p.item_code)].attrs.ports.value||{}).total ?? null) && IDX.byCode[String(p.item_code)].type.family==='charger');
chk('F20 PARITY charger port totals == engine productPorts', !pm.length, pm.map(p=>p.item_code).join(','));
const wm=P.filter(p=>{ const f=IDX.byCode[String(p.item_code)]; const n=f.attrs.watts.evidence.find(e=>e.source==='name'), m=f.attrs.mah.evidence.find(e=>e.source==='name'), ft=f.attrs.watts.evidence.find(e=>e.source==='features');
  return (E.productWatts(p)??null)!==(n?n.value:null) || (E.productMah(p)??null)!==(m?m.value:null) || (NL.wattsFromFeatures(p)??null)!==(ft?ft.value:null); });
chk('F21 PARITY watts (name + feature rule) and mAh (name) == engine / NLU', !wm.length, wm.map(p=>p.item_code).join(','));

/* ---------- evidence hierarchy (synthetic) ---------- */
const sx=(o)=>F.factFor(mk(Object.assign({sheet_display:'Mobile: Charger',category:'Wireless Charger',item_code:'99901',model:'ZZ1'},o)));
let f=sx({product_name:'Qi2 Magnetic Wireless Charger'});
chk('F22 STRONG: product name -> confirmed', f.attrs.flags.qi2&&f.attrs.flags.qi2.tier==='strong'&&f.attrs.flags.qi2.confirmed&&f.attrs.flags.qi2.evidence[0].source==='name');
f=sx({product_name:'15W Wireless Charging Pad', features:'*Input: USB-C\n*Qi2.2 certified 15W magnetic charging'});
chk('F23 MEDIUM: feature line -> confirmed, evidence text kept', f.attrs.flags.qi2&&f.attrs.flags.qi2.tier==='medium'&&f.attrs.flags.qi2.confirmed&&/qi2/.test(f.attrs.flags.qi2.evidence[0].text));
f=sx({product_name:'15W Wireless Charging Pad', short_desc:'Qi2 fast wireless charging'});
chk('F24 WEAK: short_desc only -> mentioned, NOT confirmed (source short_desc)', f.attrs.flags.qi2&&f.attrs.flags.qi2.tier==='weak'&&!f.attrs.flags.qi2.confirmed&&f.attrs.flags.qi2.evidence[0].source==='short_desc');
f=sx({product_name:'15W Wireless Charging Pad', description:'Works with Qi2 phones'});
chk('F25 WEAK: description only -> mentioned, NOT confirmed (source description)', f.attrs.flags.qi2&&!f.attrs.flags.qi2.confirmed&&f.attrs.flags.qi2.evidence[0].source==='description');
f=sx({product_name:'10000mAh Magnetic Wireless Power Bank', sheet_display:'Mobile: Power Bank', category:'Power Bank'});
chk('F26 SAFETY: "magnetic wireless" is NOT MagSafe (magnetic_wireless flag only)', !f.attrs.flags.magsafe && !!f.attrs.flags.magnetic_wireless);
f=sx({product_name:'Qi Wireless Charging Pad 15W'});
chk('F27 SAFETY: Qi is NOT Qi2', !f.attrs.flags.qi2);
f=F.factFor(mk({sheet_display:'Transmission: Docking and Hub',category:'Docking Station',item_code:'99902',product_name:'Thunderbolt 4 Dock with USB-C Ports'}));
chk('F28 SAFETY: Thunderbolt is NOT USB4; a USB-C port is NOT a USB-C cable', f.attrs.connectors.value.includes('thunderbolt') && !f.attrs.connectors.value.includes('usb4') && f.attrs.connectors.value.includes('usb_c') && !f.type.forms.cable);

/* ---------- unknown stays unknown ---------- */
f=F.factFor(mk({sheet_display:'Mobile: Power Bank',category:'Power Bank',item_code:'99903',product_name:'Compact Power Bank'}));
chk('F29 unknown: power bank with no capacity anywhere -> mah null + listed unknown (no inference)', f.attrs.mah.value===null && f.unknown.includes('mah') && f.unknown.includes('watts'));
f=F.factFor(mk({sheet_display:'Mobile: Power Bank',category:'Power Bank',item_code:'99904',product_name:'Compact Power Bank',description:'Large 20000mAh battery'}));
chk('F30 description-only capacity -> value null, mentioned (weak), still unknown', f.attrs.mah.value===null && f.attrs.mah.mentioned===20000 && f.unknown.includes('mah'));
f=F.factFor(mk({sheet_display:'Transmission: Docking and Hub',category:'Hub',item_code:'99905',product_name:'USB-C Hub'}));
chk('F31 unknown: hub with no port evidence -> ports unknown', f.attrs.ports.value===null && f.unknown.includes('ports'));

/* ---------- conflicting evidence ---------- */
f=F.factFor(mk({sheet_display:'Mobile: Power Bank',category:'Power Bank',item_code:'99906',product_name:'10000mAh 22.5W Power Bank',features:'*Capacity: 20000mAh'}));
chk('F32 conflict: name 10000mAh vs feature 20000mAh -> name kept, conflict flagged', f.attrs.mah.value===10000 && f.attrs.mah.conflict && f.conflicts.includes('mah'));
f=F.factFor(mk({sheet_display:'Mobile: Power Bank',category:'Power Bank',item_code:'99907',product_name:'10000mAh 22.5W Power Bank',features:'*Rated capacity: 6250mAh (5V 3A)'}));
chk('F33 rated / cell capacity is a different quantity (mahRated), not a conflict', f.attrs.mah.value===10000 && !f.attrs.mah.conflict && f.attrs.mah.rated && f.attrs.mah.rated.value===6250);
f=F.factFor(mk({sheet_display:'Mobile: Charging Cable',category:'USB-C Data Charging Cable',item_code:'99908',product_name:'USB-C to USB-C Cable 2m',length:'1M'}));
chk('F34 conflict: length field 1M vs name 2m -> structured field kept, conflict flagged', f.attrs.lengthM.value===1 && f.attrs.lengthM.conflict);
const realConf=facts.filter(x=>x.conflicts.length);
chk('F35 real-catalog conflicts are reported with both sides of the evidence ('+realConf.length+')', realConf.every(x=>x.conflicts.every(k=>k==='type'?!!x.type.conflict:x.attrs[k].evidence.length>=2)));

/* ---------- port inventory by type ---------- */
f=F.factFor(mk({sheet_display:'Transmission: Docking and Hub',category:'Docking Station',item_code:'99909',product_name:'USB-C to 2*HDMI+3*USB-A+RJ45+SD/TF+PD Converter (9-in-1)'}));
const pv=f.attrs.ports.value||{};
chk('F36 port inventory from name: 2 HDMI, 3 USB-A, 1 RJ45, SD+TF, PD; total excludes PD; N-in-1 kept separately', pv.byKind&&pv.byKind.hdmi===2&&pv.byKind.usb_a===3&&pv.byKind.rj45===1&&pv.byKind.sd===1&&pv.byKind.tf===1&&pv.byKind.pd===1&&pv.total===8&&pv.inOne===9, JSON.stringify(pv));
f=F.factFor(mk({sheet_display:'Transmission: Docking and Hub',category:'Hub',item_code:'99910',product_name:'4-Port USB Hub',features:'*Input: 1×USB-C\n*Output: 4×USB-A'}));
chk('F37 port inventory: name total + feature "Output:" line by kind (medium)', f.attrs.ports.value.total===4 && f.attrs.ports.evidence.some(e=>e.source==='features'&&e.value.byKind.usb_a===4));
f=F.factFor(mk({sheet_display:'Mobile: Charger',category:'Wall Charger/Desk Charger',item_code:'99911',product_name:'65W 2C1A GaN Charger'}));
chk('F38 charger "2C1A" -> 3 ports (engine rule)', f.attrs.ports.value.total===3 && F.chargerPortTotal(mk({product_name:'65W 2C1A GaN Charger'}),'charger')===3);
const hd=facts.filter(x=>x.type.family==='hub_dock'), both=hd.filter(x=>x.attrs.ports.evidence.length===2);
const agree=both.filter(x=>{ const nv=x.attrs.ports.evidence[0].value, ov=x.attrs.ports.evidence[1].value, n=nv.byKind, o=ov.byKind;
  return n ? ['hdmi','dp','vga','rj45'].every(k=>(n[k]||0)===(o[k]||0)) : nv.total===ov.total; });
chk('F39 real hubs/docks: name and Output-line video/LAN counts agree or the product is flagged as a conflict ('+agree.length+'/'+both.length+' agree)', both.every(x=>agree.includes(x)||x.attrs.ports.conflict), both.filter(x=>!agree.includes(x)&&!x.attrs.ports.conflict).map(x=>x.code).join(','));
chk('F40 real hubs/docks with a port inventory: '+hd.filter(x=>x.attrs.ports.value).length+'/'+hd.length, hd.filter(x=>x.attrs.ports.value).length>=Math.floor(hd.length*0.9));

/* ---------- NAS (data-derived from the Bays/CPU/RAM feature lines) ---------- */
const nas=facts.filter(x=>x.type.family==='nas');
const nasBad=nas.filter(x=>{ const p=by(x.code), m=String(p.features||'').match(/Bays?\s*[:：]\s*(\d+)/i); return !m || x.attrs.nas.bays!==+m[1] || !x.attrs.nas.cpu || !x.attrs.nas.ram || x.attrs.nas.evidence.some(e=>e.tier!=='medium'); });
chk('F41 NAS bays / CPU / RAM read from feature lines (medium, confirmed) for all '+nas.length+' NAS', nas.length>0 && !nasBad.length, nasBad.map(x=>x.code).join(','));

/* ---------- synthetic future SKUs + monthly participation ---------- */
f=F.factFor(mk({sheet_display:'Mobile: Power Bank',category:'Slim Power Bank 2027',item_code:'99912',product_name:'5000mAh Slim Power Bank'}));
chk('F42 future SKU: new category inside a known section -> family by section (structured)', f.type.family==='power_bank'&&f.type.source==='sheet_display'&&f.attrs.mah.value===5000);
f=F.factFor(mk({sheet_display:'Transmission: New Desk Accessories',category:'Desk Gear',item_code:'99913',product_name:'USB-C Docking Station 12-in-1'}));
chk('F43 future SKU: unknown section/category -> name fallback (source name), never description', f.type.family==='hub_dock'&&f.type.source==='name');
f=F.factFor(mk({sheet_display:'Transmission: New Desk Accessories',category:'Desk Gear',item_code:'99914',product_name:'Desk Organizer Tray',description:'perfect with your power bank, charger and hub'}));
chk('F44 future SKU: no structured or name cue -> other (unclassified), description ignored', f.type.family==='other'&&f.type.source==='none');
const NEW=mk({sheet_display:'Mobile: Charger',category:'Wall Charger/Desk Charger',item_code:'99915',model:'ZZ15',product_name:'100W 3C1A GaN Fast Charger',dateAdded:'2026-10-01',isNew:true});
const P2=P.concat([NEW]); const I2=F.build(P2);
chk('F45 monthly new SKU participates after the next build (new key, classified, ports + watts)', I2!==IDX && I2.key!==IDX.key && I2.byCode['99915'] && I2.byCode['99915'].type.family==='charger' && I2.byCode['99915'].attrs.watts.value===100 && I2.byCode['99915'].attrs.ports.value.total===4);
const P3=P.map(p=>p); P3[0]=Object.assign({},P3[0],{product_name:P3[0].product_name+' V2'});
chk('F46 an edited product (same SKU count) changes the catalog signature -> rebuild', F.signature(P3)!==F.signature(P));
chk('F47 explicit version option changes the memo key', F.build(P,{version:'2026-10-07'}).key!==F.build(P,{version:'2026-11-01'}).key);

console.log(`\nfacts build ${buildMs}ms (memo ${memoMs}ms) · ${S.total} products · classified ${S.classified} · other ${S.other} · type conflicts ${S.conflicting} · attribute conflicts ${realConf.filter(x=>x.conflicts.some(k=>k!=='type')).length}`);
console.log(`VERO facts tests: ${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
