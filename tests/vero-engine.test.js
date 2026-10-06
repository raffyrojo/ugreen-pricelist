/* VERO engine tests (Phase 1, local lookup only).
   Run: node tests/vero-engine.test.js
   Uses the REAL data/products.json, with scheduled price changes resolved exactly
   the way the app does at load (pcResolveSchedule from js/helpers.js). */
const fs=require('fs'), path=require('path');
const ROOT=path.join(__dirname,'..');
global.window={ PRICE_SETTINGS:{ indicatorDays:30 } };
eval(fs.readFileSync(path.join(ROOT,'js','helpers.js'),'utf8'));
const E=require(path.join(ROOT,'js','vero-engine.js'));

const ALL=JSON.parse(fs.readFileSync(path.join(ROOT,'data','products.json'),'utf8'));
pcResolveSchedule(ALL);
const PUB=ALL.filter(p=>!p.disabled);
const by=c=>PUB.find(p=>String(p.item_code)===String(c));
let pass=0, fail=0;
const chk=(n,c,extra)=>{ if(c){pass++;console.log('PASS - '+n);} else {fail++;console.log('FAIL - '+n+(extra?'  -> '+extra:''));} };
const A=(q,ctx,list)=>E.answer(list||PUB,q,ctx);

/* pick fixtures from the data instead of hard-coding prices */
const single=PUB.find(p=>p.dp_volume&&p.moq&&PUB.filter(x=>x.model===p.model).length===1);
const multiModel=Object.entries(PUB.reduce((m,p)=>{m[p.model]=(m[p.model]||0)+1;return m;},{})).find(([m,n])=>n>=3&&/\d/.test(m))[0];

// 1 exact item code
let r=A(String(single.item_code));
chk('1 exact item code -> single lookup', r.type==='lookup'&&r.codes[0]===String(single.item_code));
chk('1b item code with letters (55212B)', A('55212b').codes[0]==='55212B');

// 2 exact model (unique + shared)
r=A(single.model);
chk('2 exact unique model -> its SKU', r.type==='lookup'&&r.codes[0]===String(single.item_code), JSON.stringify(r.codes));
r=A(multiModel);
chk('2b shared model -> list of all its SKUs', r.type==='list'&&r.codes.length===PUB.filter(p=>p.model===multiModel).length);
chk('2c model with stray spaces in data (LP339 ) matches', A('LP339').type==='lookup');

// 3 UPC + material number
chk('3 UPC lookup', A(String(single.upc)).codes[0]===String(single.item_code));
chk('3b material number lookup', A(String(single.material_number)).codes[0]===String(single.item_code));
chk('3c code pasted inside a sentence', A('pls check UGREEN '+single.item_code+' thanks').codes[0]===String(single.item_code));

// 4-7 field asks
r=A('srp of '+single.item_code); chk('4 SRP ask -> fields [srp]', r.type==='lookup'&&r.fields.join()==='srp');
r=A('dp '+single.item_code); chk('5 DP ask -> fields [dp]', r.fields.join()==='dp');
r=A('dp vol '+single.item_code); chk('6 DP Vol ask -> fields [dp_volume] (not dp)', r.fields.join()==='dp_volume');
r=A('volume price '+single.item_code); chk('6b "volume price" -> dp_volume', r.fields.join()==='dp_volume');
r=A('moq of '+single.item_code); chk('7 MOQ ask -> fields [moq]', r.fields.join()==='moq');
r=A('magkano '+single.item_code); chk('7b Taglish price ask -> all price fields', r.fields.join()==='srp,dp,dp_volume');

// 8 price filter
r=A('power bank under ₱2,000');
chk('8 price filter: every result SRP <= 2000 and is a power bank', r.codes.length>0&&r.codes.every(c=>by(c).srp<=2000&&by(c).sheet_display==='Mobile: Power Bank'), r.codes.length);
chk('8b price filter is exhaustive (no power bank <=2000 missed)', r.codes.length===PUB.filter(p=>p.sheet_display==='Mobile: Power Bank'&&p.srp<=2000).length);
r=A('charger above 2k'); chk('8c "2k" + above -> SRP >= 2000', r.codes.length>0&&r.codes.every(c=>by(c).srp>=2000));
r=A('dp under 500 hdmi cable'); chk('8d DP budget uses DP field', r.parsed.priceField==='dp'&&r.codes.every(c=>by(c).dp<=500));

// 9 wattage
r=A('65W charger');
chk('9 wattage: all results are 65W chargers', r.codes.length>0&&r.codes.every(c=>E.productWatts(by(c))===65&&/Charger/.test(by(c).sheet_display)), r.codes.join());
chk('9b 65W not misread as price', A('65W charger').parsed.priceMax==null);
r=A('charger at least 100w'); chk('9c min wattage', r.codes.length>0&&r.codes.every(c=>E.productWatts(by(c))>=100));

// 10 length
r=A('hdmi 2m'); chk('10 length 2m: every result length = 2M and HDMI', r.codes.length>0&&r.codes.every(c=>E.lenMeters(by(c).length)===2&&/hdmi/i.test(by(c).product_name)));
r=A('usb c cable 15cm'); chk('10b cm length', r.codes.length>0&&r.codes.every(c=>Math.abs(E.lenMeters(by(c).length)-0.15)<1e-9));
r=A(multiModel+' '+(PUB.find(p=>p.model===multiModel&&p.length)||{}).length);
chk('10c model + length narrows the model list', r.codes.length>=1&&r.codes.length<PUB.filter(p=>p.model===multiModel).length);

// 11 category
r=A('card reader'); chk('11 category: card readers', r.codes.length>0&&r.codes.every(c=>/reader/i.test(by(c).product_name+by(c).sheet_display)));
r=A('usb c hub'); chk('11b hub query stays in Docking and Hub', r.codes.length>0&&r.codes.every(c=>by(c).sheet_display==='Transmission: Docking and Hub'));

// 12 spec filtering
r=A('20000mah power bank'); chk('12 capacity filter 20000mAh', r.codes.length>0&&r.codes.every(c=>E.productMah(by(c))===20000));
r=A('black mouse'); chk('12b colour + type', r.codes.length>0&&r.codes.every(c=>/black/i.test(by(c).color)&&/mouse/i.test(by(c).product_name)));

// 13-14 compare
const cmp4=PUB.filter(p=>p.model===multiModel).slice(0,4).map(p=>String(p.item_code));
r=A('compare '+cmp4[0]+' and '+cmp4[1]); chk('13 compare 2', r.type==='compare'&&r.codes.join()===cmp4.slice(0,2).join());
r=A(cmp4.slice(0,3).join(' vs ')); chk('14 compare 3 (vs)', r.type==='compare'&&r.codes.length===3);
r=A('compare '+cmp4.join(', ')); chk('14b compare 4', r.type==='compare'&&r.codes.length===4);
r=A('compare '+PUB.slice(0,5).map(p=>p.item_code).join(' ')); chk('14c compare caps at 4 with note', r.type==='compare'&&r.codes.length===4&&/up to 4/.test(r.note));
r=A('compare '+cmp4[0]); chk('14d compare with one product -> asks for more', r.type==='clarify');
r=A('compare '+multiModel+' and '+single.item_code); chk('14e compare with a multi-SKU model -> lets user pick SKUs', r.type==='list');
r=A('x',{compareCodes:cmp4.slice(0,2)}); chk('14f compare from UI selection', r.type==='compare'&&r.codes.length===2);

// 15 no result
r=A('zzqxw widget'); chk('15 no-result text', r.type==='none'&&r.codes.length===0);
r=A('99999999'); chk('15b unknown code -> none (no fuzzy guess)', r.type==='none');

// 16 ambiguous -> clarify chips
r=A('cable'); chk('16 ambiguous "cable" -> clarify with section chips', r.type==='clarify'&&r.chips.length>=3&&r.chips.every(c=>c.sheet));
const chip=r.chips[0]; const r2=A('cable',{sheet:chip.sheet});
chk('16b picking a chip restricts to that section', r2.codes.length===chip.count&&r2.codes.every(c=>by(c).sheet_display===chip.sheet));
r=A('best charger for macbook air'); chk('16c device question -> wattage clarify, flagged for AI later', r.type==='clarify'&&r.chips.every(c=>/W$/.test(c.label))&&r.needsAI===true);
r=A('?'); chk('16d empty/meaningless -> clarify prompt', r.type==='clarify');

// 17 dealer restriction: engine only sees the list it is given
const dealerSkus=[single.item_code, cmp4[0], cmp4[1]].map(String);
const DL=PUB.filter(p=>dealerSkus.includes(String(p.item_code))).map(p=>Object.assign({},p,{dp_std:p.dp,dp:Math.round(p.srp*0.8),special_dp:Math.round(p.srp*0.8),dp_volume:''}));
const outside=PUB.find(p=>!dealerSkus.includes(String(p.item_code)));
chk('17 dealer: SKU outside assignment not found', A(String(outside.item_code),null,DL).type==='none');
chk('17b dealer: assigned SKU found', A(String(single.item_code),null,DL).codes[0]===String(single.item_code));
r=A(multiModel,null,DL); chk('17c dealer: model lookup limited to assigned SKUs', r.codes.every(c=>dealerSkus.includes(c)));
r=A('cable',null,DL); chk('17d dealer: free text never leaks other SKUs', r.codes.every(c=>dealerSkus.includes(c)));

// 18 dealer price filter uses Special DP
r=A('dp under 100000 '+multiModel,null,DL); chk('18 dealer DP budget reads Special DP field', r.parsed.priceField==='dp');

// misc safety
chk('disabled SKUs never searchable', ALL.filter(p=>p.disabled).every(p=>!A(String(p.item_code)).codes.includes(String(p.item_code))));
chk('engine has no network code', !/fetch\(|XMLHttpRequest|sendBeacon|WebSocket/.test(fs.readFileSync(path.join(ROOT,'js','vero-engine.js'),'utf8')));
{ const ui=fs.readFileSync(path.join(ROOT,'js','vero.js'),'utf8');
  const fetches=ui.match(/fetch\(/g)||[];
  chk('UI network code limited to the 2 gated VERO AI calls (/ask, /session) on config aiEndpoint', fetches.length===2 && /fetch\(a\.url\+'\/ask'/.test(ui) && /fetch\(a\.url\+'\/session'/.test(ui) && !/XMLHttpRequest|sendBeacon|WebSocket|import\(/.test(ui) && /CFG\.aiEnabled===true && !!CFG\.aiEndpoint/.test(ui)); }
chk('schedules resolved (current prices, not stale JSON)', ALL.every(p=>!(p.priceSchedule||[]).some(s=>s.effectiveDate<=pcToday())));

/* ---------- Phase 2: AI shortlist for multi-device / use-case questions (live 2026-10-06 regression) ---------- */
{
  const shortlist=q=>{ const res=A(q); let d=E.aiRoute(PUB,q,res,{}); if(d.route==='local') d=E.aiRoute(PUB,q,res,{manual:true}); return d.candidates.map(by); };
  const W=p=>E.productWatts(p)||0;
  const ports=p=>{ let n=0; String(p.product_name).replace(/(?:(\d)\s*\*\s*)?USB[\s-]?(?:A|C)\b/gi,(m,k)=>{ n+=k?+k:1; return m; }); const pm=String(p.product_name).match(/(\d)[\s-]?ports?\b/i); return Math.max(n,pm?+pm[1]:0); };
  const power=p=>p.sheet_display==='Mobile: Charger'||p.sheet_display==='Mobile: Power Bank';
  const invariants=(l,carOk)=>l.length>=2&&l.length<=8&&l.every(Boolean)&&l.every(p=>!p.disabled)
    &&Object.values(l.reduce((m,p)=>{ m[p.model]=(m[p.model]||0)+1; return m; },{})).every(n=>n<=2)
    &&(carOk||l.every(p=>!/\bcar\b/i.test(p.product_name)));
  const names=l=>l.map(p=>p.model.trim()+' '+W(p)+'W/'+ports(p)+'p').join(', ');

  let l=shortlist('Alin mas okay for travel kung laptop at phone ang gagamitin ko?');
  chk('P2-1 Taglish "travel, laptop at phone": no stands/holders, only chargers/power banks', l.length && l.every(power) && !l.some(p=>p.sheet_display==='Mobile: Holder'), names(l));
  chk('P2-1b ... top 3 are laptop-capable (>=45W) multi-port', l.slice(0,3).every(p=>W(p)>=45&&ports(p)>=2), names(l));
  chk('P2-1c ... invariants (<=8, <=2 per model, no disabled, no car)', invariants(l,false), names(l));

  l=shortlist('Which UGREEN charger is better for a laptop and phone?');
  chk('P2-2 "charger ... laptop and phone": chargers only, top 3 >=45W with 2+ ports', l.every(p=>/charger/i.test(p.product_name)) && l.slice(0,3).every(p=>W(p)>=45&&ports(p)>=2) && invariants(l,false), names(l));
  chk('P2-2b ... single-port / phone-only chargers (<45W) not ahead of laptop-capable ones', l.findIndex(p=>W(p)<45) < 0 || l.findIndex(p=>W(p)<45) >= l.filter(p=>W(p)>=45&&ports(p)>=2).length, names(l));

  l=shortlist('travel charger for laptop and phone');
  chk('P2-3 "travel charger for laptop and phone": chargers first, laptop-capable top 3', l.every(p=>/charger/i.test(p.product_name)) && l.slice(0,3).every(p=>W(p)>=45) && invariants(l,false), names(l));

  l=shortlist('charger for tablet and phone');
  chk('P2-4 "charger for tablet and phone": chargers, top 3 multi-port', l.every(p=>/charger/i.test(p.product_name)) && l.slice(0,3).every(p=>ports(p)>=2) && invariants(l,false), names(l));

  l=shortlist('best for laptop and ipad');
  chk('P2-5 "best for laptop and ipad" (no type named): power products, laptop-capable first', l.every(power) && l.slice(0,3).every(p=>W(p)>=45) && invariants(l,false), names(l));

  l=shortlist('power bank for phone and laptop');
  chk('P2-6 "power bank for phone and laptop": power banks, top 3 >=45W', l.every(p=>p.sheet_display==='Mobile: Power Bank') && l.slice(0,3).every(p=>W(p)>=45) && invariants(l,false), names(l));

  l=shortlist('laptop stand for laptop and tablet');
  chk('P2-7 named non-power type ("stand") is never replaced by chargers', l.length && l.every(p=>!power(p)) && invariants(l,false), names(l));

  l=shortlist('car charger for phone and tablet');
  chk('P2-8 car items only when "car" is asked', l.length && l.every(p=>/\bcar\b/i.test(p.product_name)) && invariants(l,true), names(l));

  const before=JSON.stringify(A('Alin mas okay for travel kung laptop at phone ang gagamitin ko?').codes);
  chk('P2-9 Phase 1 local answer for the same question is unchanged by the AI shortlist', before===JSON.stringify(A('Alin mas okay for travel kung laptop at phone ang gagamitin ko?').codes) && typeof E.aiCandidates==='function');
}


/* ======================= p2r1 (Phase 2 local-engine revision): LOCAL ranking / superlatives ======================= */
{
  const ps=PUB, isPB=p=>p.sheet_display==='Mobile: Power Bank';
  const srp=p=>Number(p.srp), dpOf=p=>Number(p.dp);
  const minBy=(list,f)=>Math.min(...list.map(f)), maxBy=(list,f)=>Math.max(...list.map(f));
  const route=(q,res,list)=>E.aiRoute(list||PUB,q,res,{});
  const local=(q,res,list)=>{ const d=route(q,res,list); return d.route==='local' && !d.candidates.length && !E.canEscalate(res); };
  const PB=ps.filter(isPB), CH=ps.filter(p=>p.sheet_display==='Mobile: Charger' && /charger/i.test(p.product_name) && !/\bcar\b/i.test(p.product_name));
  const HDMI_CABLES=ps.filter(p=>/hdmi/i.test(p.product_name)&&/\bcables?\b/i.test(p.product_name)&&!/extender|wireless/i.test(p.product_name)&&E.lenMeters(p.length));
  const len=p=>E.lenMeters(p.length);

  // R1/R2: the two pilot failures
  let q='what is the cheapest powerbank now?'; r=A(q);
  chk('R1 pilot "cheapest powerbank now?" -> ranked list, winner = min SRP power bank', r.type==='list' && r.parsed.rank && isPB(by(r.codes[0])) && srp(by(r.codes[0]))===minBy(PB,srp), r.note);
  chk('R1b ... answered LOCALLY (no Worker route, no AI gate, no Ask-AI offer)', local(q,r), JSON.stringify(route(q,r)));
  chk('R1c ... "now" not left as a search word', r.parsed.content.indexOf('now')<0 && r.parsed.content.indexOf('cheapest')<0, r.parsed.content);
  q='what is the longest hdmi we have right now?'; r=A(q);
  chk('R2 pilot "longest hdmi we have right now?" -> longest HDMI CABLE', r.type==='list' && len(by(r.codes[0]))===maxBy(HDMI_CABLES,len) && /cable/i.test(by(r.codes[0]).product_name), r.note);
  chk('R2b ... answered LOCALLY', local(q,r));
  chk('R2c ... filler "we have right now" stripped', ['we','right','now','longest'].every(w=>r.parsed.content.indexOf(w)<0), r.parsed.content);

  // R3 required examples, all local
  const ex=['cheapest power bank','top 3 cheapest power banks','cheapest 20,000mAh power bank','most expensive charger','shortest USB-C cable','highest wattage charger','highest wattage charger with 3 ports','highest wattage charger with at least 3 ports','biggest capacity power bank','pinakamurang power bank','pinakamahal na charger','top 2 most expensive power banks','lowest wattage charger','smallest capacity power bank','most mah power bank','least mah power bank','priciest charger','lowest price charger','highest price power bank','most powerful charger','top 3 longest hdmi cables','top 3 shortest usb-c cables'];
  const bad=ex.filter(x=>{ const rr=A(x); return !(rr.parsed.rank && rr.type==='list' && rr.codes.length && local(x,rr)); });
  chk('R3 all '+ex.length+' required superlative examples rank locally (list, no AI)', !bad.length, bad.join(' | '));

  // R4 top N
  r=A('top 3 cheapest power banks');
  const pbSorted=PB.slice().sort((a,b)=>srp(a)-srp(b));
  chk('R4 top 3 cheapest power banks = exactly 3, ascending SRP, = 3 lowest', r.codes.length===3 && r.codes.every((c,i)=>srp(by(c))===srp(pbSorted[i])), r.codes);
  r=A('top 25 cheapest chargers'); chk('R4b top N capped at 10', r.codes.length===10 && r.parsed.rank.n===10, r.codes.length);
  r=A('3 cheapest power banks'); chk('R4c "3 cheapest" also means top 3', r.codes.length===3 && r.parsed.rank.n===3);
  r=A('top 2 most expensive power banks'); chk('R4d top 2 most expensive descending', r.codes.length===2 && srp(by(r.codes[0]))===maxBy(PB,srp) && srp(by(r.codes[0]))>=srp(by(r.codes[1])));

  // R5 ties (real data: several power banks share the smallest capacity)
  const minMah=minBy(PB,E.productMah), tiedMah=PB.filter(p=>E.productMah(p)===minMah).length;
  r=A('smallest capacity power bank');
  chk('R5 tie: all '+tiedMah+' power banks at '+minMah+'mAh returned as winners, flagged as a tie', tiedMah>1 && r.parsed.rank.tie===true && r.parsed.rank.winners===tiedMah && r.codes.slice(0,tiedMah).every(c=>E.productMah(by(c))===minMah) && /tie/.test(r.note), r.note);
  chk('R5b tie: next 2 after the tie also shown', r.codes.length===tiedMah+2 && r.codes.slice(tiedMah).every(c=>E.productMah(by(c))>minMah));
  // synthetic tie on price
  const T=[PB[0],PB[1],PB[2]].map((p,i)=>Object.assign({},p,{srp:i<2?100:200}));
  r=E.answer(T,'cheapest power bank',{}); chk('R5c synthetic price tie: both ₱100 items are winners (not chosen arbitrarily)', r.parsed.rank.winners===2 && r.codes.length===3 && /2 power banks tie/.test(r.note), r.note);
  r=A('cheapest power bank'); chk('R5d no tie: single winner + next 2', r.parsed.rank.winners===1 && r.codes.length===3);

  // R6 ports: exact vs at least, unknown never 0
  const ports=E.productPorts;
  r=A('highest wattage charger with 3 ports');
  chk('R6 "with 3 ports" = exactly 3 (every result has 3 parsed ports)', r.codes.length && r.codes.every(c=>ports(by(c))===3), r.codes.map(c=>ports(by(c))));
  const ch3=CH.filter(p=>ports(p)===3); chk('R6b ... winner = max wattage among exactly-3-port chargers', E.productWatts(by(r.codes[0]))===maxBy(ch3,E.productWatts));
  r=A('highest wattage charger with at least 3 ports');
  const ch3p=CH.filter(p=>ports(p)!=null&&ports(p)>=3);
  chk('R6c "at least 3 ports" = 3 or more; winner = max wattage among them', r.codes.every(c=>ports(by(c))>=3) && E.productWatts(by(r.codes[0]))===maxBy(ch3p,E.productWatts) && ports(by(r.codes[0]))>3, r.note);
  chk('R6d0 "with exactly 4 ports" = exact 4, "exactly" not left as a search word', (pp=>pp.ports.op==='eq'&&pp.ports.v===4&&pp.content.join()==='charger')(A('highest wattage charger with exactly 4 ports').parsed));
  chk('R6d "3+ ports" and "3 or more ports" parse as min 3', ['highest wattage charger 3+ ports','highest wattage charger with 3 or more ports'].every(x=>{ const pp=A(x).parsed.ports; return pp && pp.op==='min' && pp.v===3; }));
  chk('R6e unreadable port counts: null (unknown), never 0', ['18W 1A Fast Charger','Nexode Mini 30W PD GaN Tech Charger (Robot Gan)','2-in-1 wireless charger','QC 3.0+QC 3.0 Dual USB-A 36W Fast Car Charger','25W USB-C GaN Fast Charger Set','145W 2C1A with 1 Retractable Cable Car Charger'].every(n=>ports(/Car/.test(n)?{product_name:n,sheet_display:'Mobile: Car Charger and Accessories',category:'Car Charger'}:{product_name:n,sheet_display:'Mobile: Charger',category:'Wall Charger/Desk Charger'})===null));
  chk('R6e2 no real charger ever parses to 0 ports', PUB.every(p=>ports(p)!==0));
  chk('R6f readable port counts parse correctly', [['1*USB-A+4*USB-C 300W Desktop Fast Charger',5],['100W 4C+1A GaN Fast Charger',5],['100W 4-Port GaN Fast Charger',4],['USB-A+2*USB-C 65W GaN Tech Fast Charger',3],['45W 1C GaN Fast Charger',1],['65W single-port GaN fast charger + USB-C*1',1]].every(([n,v])=>ports({product_name:n,sheet_display:'Mobile: Charger'})===v));
  const unknownCh=CH.filter(p=>ports(p)==null).length; r=A('highest wattage charger with 3 ports');
  chk('R6g unknown-port chargers excluded and the count is mentioned', unknownCh>0 && r.codes.every(c=>ports(by(c))!=null) && /without a clearly listed port count excluded/.test(r.note), r.note);
  r=A('highest wattage power bank with 2 ports'); chk('R6h port filter where no port data exists -> local "can\'t rank" text, no AI', r.type==='text' && /port count/.test(r.note) && local('highest wattage power bank with 2 ports',r), r.note);

  // R7 length guard
  r=A('longest hdmi');
  chk('R7 length guard: Wireless HDMI Extender range never competes with cable length', r.codes.every(c=>!/extender|wireless/i.test(by(c).product_name)) && r.codes.every(c=>/cable/i.test(by(c).product_name)), r.codes.map(c=>by(c).product_name));
  r=A('longest hdmi extender');
  chk('R7b explicit "extender" ranks within extenders', r.codes.length && r.codes.every(c=>/extender/i.test(by(c).product_name)) && len(by(r.codes[0]))===maxBy(ps.filter(p=>/hdmi/i.test(p.product_name)&&/extender/i.test(p.product_name)&&len(p)),len), r.note);
  r=A('shortest USB-C cable'); const uc=ps.filter(p=>/usb[\s-]?c|type[\s-]?c/i.test(p.product_name)&&/\bcables?\b/i.test(p.product_name)&&!/extender|wireless/i.test(p.product_name)&&len(p));
  chk('R7c shortest USB-C cable = min length among USB-C cables (no 15cm hubs)', /cable/i.test(by(r.codes[0]).product_name) && len(by(r.codes[0]))===minBy(uc,len), r.note);
  r=A('longest charger'); chk('R7d length ranking on non-cables -> local explanation, no AI', r.type==='text' && /cables only/.test(r.note) && local('longest charger',r), r.note);

  // R8 price field rules
  r=A('cheapest power bank'); chk('R8 default price ranking uses SRP', r.parsed.rank.field==='srp' && r.fields.join()==='srp' && /by SRP/.test(r.note));
  r=A('cheapest dp power bank'); chk('R8b explicit DP -> ranks by DP', r.parsed.rank.field==='dp' && dpOf(by(r.codes[0]))===minBy(PB,dpOf) && /by DP:/.test(r.note), r.note);
  r=A('lowest dp vol power bank'); chk('R8c explicit DP Vol -> ranks by DP Vol', r.parsed.rank.field==='dp_volume' && /by DP Vol/.test(r.note), r.note);
  r=A('lowest price charger'); chk('R8d "lowest price" -> SRP (no DP leakage into ranking)', r.parsed.rank.field==='srp' && r.parsed.rank.dir==='min');

  // R9 dealer: Special DP, all local
  const DPB=PB.slice(0,8).map(p=>Object.assign({},p,{dp_std:p.dp,dp:Math.round(srp(p)*(p.item_code.length%2?0.7:0.9)),special_dp:Math.round(srp(p)*(p.item_code.length%2?0.7:0.9)),dp_volume:''}));
  r=E.answer(DPB,'cheapest special dp power bank',{dealer:true});
  chk('R9 dealer: explicit Special DP ranks by the dealer\'s Special DP and labels it so', r.parsed.rank.field==='dp' && Number(DPB.find(p=>p.item_code===r.codes[0]).dp)===minBy(DPB,dpOf) && /by Special DP/.test(r.note), r.note);
  r=E.answer(DPB,'cheapest power bank',{dealer:true});
  chk('R9b dealer: default still SRP, results only from the dealer\'s own SKUs', r.parsed.rank.field==='srp' && r.codes.every(c=>DPB.some(p=>p.item_code===c)));
  chk('R9c dealer ranking never routes to the Worker', E.aiRoute(DPB,'cheapest special dp power bank',E.answer(DPB,'cheapest special dp power bank',{dealer:true}),{}).route==='local' && E.aiRoute(DPB,'x',r,{manual:true}).route==='local');
  r=E.answer(DPB,'lowest dp vol power bank',{dealer:true}); chk('R9d dealer: DP Vol ranking -> "not part of your pricelist" (local)', r.type==='text' && /not part of your pricelist/.test(r.note), r.note);

  // R10 filler vs stock
  chk('R10 filler (now / right now / currently / we have / do we have) removed', ['now','right now','currently','current','we have','do we have'].every(f=>{ const pp=A('cheapest power bank '+f).parsed; return pp.rank && pp.content.join()==='powerbank'; }));
  r=A('what is the cheapest power bank in stock?');
  chk('R10b "in stock": still ranks the pricelist, but flags that stock cannot be confirmed', r.parsed.stock===true && /can’t confirm stock/.test(r.stockNote) && r.type==='list' && local('what is the cheapest power bank in stock?',r), r.stockNote);
  chk('R10c "available stock" / "available inventory" / "stock" also flagged, never silently dropped', ['cheapest power bank available stock','cheapest charger available inventory','power bank stock'].every(x=>A(x).parsed.stock===true && !!A(x).stockNote));
  chk('R10d plain filler does NOT add a stock note', !A('cheapest power bank now').stockNote);

  // R11 disabled excluded (engine is defensive even if the caller passes disabled items)
  const cheapestPB=pbSorted[0], fake=Object.assign({},cheapestPB,{item_code:'ZZTEST1',srp:1,disabled:true});
  r=E.answer(PUB.concat([fake]),'cheapest power bank',{}); chk('R11 disabled products never ranked', r.codes.indexOf('ZZTEST1')<0 && r.codes[0]===String(cheapestPB.item_code));
  const disabledAll=ALL.filter(p=>p.disabled); chk('R11b real disabled SKUs absent from all example results', !ex.some(x=>A(x).codes.some(c=>disabledAll.some(d=>String(d.item_code)===c))));

  // R12 no AI gate even when unrankable / manual "Ask VERO AI"
  r=A('cheapest'); chk('R12 bare "cheapest" -> local clarify (product type), no AI', r.type==='clarify' && local('cheapest',r), r.note);
  r=A('cheapest power bank'); chk('R12b manual Ask-AI path also refuses to send a ranking query', E.aiRoute(PUB,'cheapest power bank',r,{manual:true}).route==='local');
  r=A('highest wattage charger'); chk('R12c unreadable wattages excluded and counted', /without a listed wattage not ranked/.test(r.note) && r.codes.every(c=>E.productWatts(by(c))));

  // R14 decision 1: bare "available" = in the pricelist, not stock
  r=A('cheapest power bank available');
  chk('R14 "cheapest power bank available": ranks normally, NO stock warning', r.parsed.rank && !r.parsed.stock && !r.stockNote && r.parsed.content.join()==='powerbank' && srp(by(r.codes[0]))===minBy(PB,srp), r.note);
  r=A('cheapest power bank in stock');
  chk('R14b "cheapest power bank in stock": ranks locally AND states stock cannot be confirmed', r.parsed.rank && r.type==='list' && /can’t confirm stock/.test(r.stockNote) && local('cheapest power bank in stock',r));
  chk('R14c clear inventory phrases flagged (stock available / on hand / available units / may stock / meron pa / meron pang stock)', ['power bank stock available','power bank on hand','cheapest power bank available units','may stock ba ng power bank','meron pa ba ng power bank','meron pang stock na power bank'].every(x=>A(x).parsed.stock===true), ['power bank stock available','power bank on hand','cheapest power bank available units','may stock ba ng power bank','meron pa ba ng power bank','meron pang stock na power bank'].filter(x=>!A(x).parsed.stock));
  chk('R14d "available" alone never flags stock', ['hdmi cable available','what chargers are available','available power banks'].every(x=>!A(x).parsed.stock));

  // R15 decision 5: device-specific ranking — price confirmed locally, compatibility NOT implied
  q='cheapest charger for my MacBook Air'; r=A(q); const plain=A('cheapest charger');
  chk('R15 device question ranks locally (no Worker, no AI gate, no second AI request)', r.parsed.rank && r.type==='list' && local(q,r) && r.needsAI===false);
  chk('R15b ranking not filtered by guessed compatibility (same result as "cheapest charger")', JSON.stringify(r.codes)===JSON.stringify(plain.codes), r.codes+' vs '+plain.codes);
  chk('R15c wording: "cheapest charger in the current pricelist is <product> at <SRP>"', /^The cheapest charger in the current pricelist is .+ at ₱[\d,]+\.\d\d \(SRP\)\./.test(r.note), r.note);
  chk('R15d wording: explicitly says compatibility with the MacBook Air is NOT confirmed', /I can’t confirm from the local pricelist alone whether it is suitable for your MacBook Air\./.test(r.note), r.note);
  chk('R15e never phrased as "cheapest charger for your MacBook Air is"', !/for (your|my) macbook air (is|:)/i.test(r.note) && !/cheapest charger for/i.test(r.note), r.note);
  r=A('top 3 cheapest chargers for my iPhone 16');
  chk('R15f top N + device: "in the current pricelist" and plural caveat', /in the current pricelist/.test(r.note) && /whether they are suitable for your iPhone 16/.test(r.note) && r.codes.length===3, r.note);
  r=A('highest wattage charger for my thinkpad');
  chk('R15g non-price device ranking also caveated; device word not used as a product term', /can’t confirm from the local pricelist alone/.test(r.note) && r.parsed.content.join()==='charger', r.note);
  chk('R15h no device mentioned -> no compatibility caveat', !/suitable for your/.test(A('cheapest charger').note));

  // R16 decision 6: structured product type (section/category first)
  const TA=PUB.find(p=>/Universal Travel Adapter/i.test(p.product_name));
  chk('R16 live data: travel adapter sits in the charger section (structured type)', TA && TA.sheet_display==='Mobile: Charger');
  r=A('highest wattage charger with exactly 4 ports');
  chk('R16b travel adapter (no "charger" in its name) participates in charger rankings; 2C2A = 4 ports', ports(TA)===4 && r.codes.indexOf(String(TA.item_code))>=0, r.codes);
  const boosted=PUB.map(p=>p===TA?Object.assign({},p,{srp:999999}):p);
  r=E.answer(boosted,'most expensive charger',{}); chk('R16c structural check decides eligibility (boosted travel adapter wins "most expensive charger")', r.codes[0]===String(TA.item_code), r.codes[0]);
  r=A('top 10 most expensive chargers');
  chk('R16d no unrelated adapters/hubs/cables/cases enter charger rankings', r.codes.length===10 && r.codes.every(c=>by(c).sheet_display==='Mobile: Charger'), r.codes.map(c=>by(c).sheet_display));
  const tenCh=E.answer(PUB,'top 10 cheapest chargers',{}); chk('R16e ... same for cheapest chargers', tenCh.codes.every(c=>by(c).sheet_display==='Mobile: Charger'));

  // R17 decision 2: car items only when asked
  const generic=['cheapest charger','most expensive charger','highest wattage charger','top 10 cheapest chargers','lowest wattage charger'];
  chk('R17 generic charger rankings exclude car chargers and car mounts', generic.every(x=>A(x).codes.every(c=>!/car/i.test(by(c).sheet_display) && !/\bcar\b/i.test(by(c).product_name))), generic.filter(x=>A(x).codes.some(c=>/car/i.test(by(c).sheet_display))));
  r=A('cheapest car charger'); chk('R17b "car charger" ranks car chargers only (no car mounts / holders)', r.codes.length && r.codes.every(c=>by(c).category==='Car Charger'), r.codes.map(c=>by(c).category));
  const carMax=maxBy(PUB.filter(p=>p.category==='Car Charger'&&E.productWatts(p)),E.productWatts);
  r=A('highest wattage car charger'); chk('R17c highest wattage car charger = max among Car Charger category', E.productWatts(by(r.codes[0]))===carMax);

  // R18 every ranking/superlative example stays local; nothing reaches the Worker
  const allRank=ex.concat(['cheapest powerbank now','what is the longest hdmi we have right now?','cheapest power bank available','cheapest power bank in stock','cheapest charger for my MacBook Air','cheapest','longest','highest wattage','longest charger','highest wattage power bank with 2 ports','cheapest car charger']);
  const leaks=allRank.filter(x=>{ const rr=A(x); const d1=E.aiRoute(PUB,x,rr,{}), d2=E.aiRoute(PUB,x,rr,{manual:true}); return !(rr.parsed.rank && d1.route==='local' && d2.route==='local' && !d1.candidates.length && !d2.candidates.length && !E.canEscalate(rr)); });
  chk('R18 all '+allRank.length+' ranking queries: route LOCAL (auto + manual), 0 candidates, no Ask-AI offer', !leaks.length, leaks);
  r=A('cheapest'); chk('R18b bare "cheapest"/"longest"/"highest wattage" -> "<word> what?" clarification', ['cheapest','longest','highest wattage'].every(x=>{ const rr=A(x); return rr.type==='clarify' && / what\?/.test(rr.note) && !rr.codes.length; }));

  // R13 non-ranking queries unchanged
  chk('R13 non-ranking queries have no rank intent', ['65W charger','HDMI 2m','power bank under 2000','compare CD244 CD271','charger with 3 ports'].every(x=>!A(x).parsed.rank));
}

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
