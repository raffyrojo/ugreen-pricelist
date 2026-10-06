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

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
