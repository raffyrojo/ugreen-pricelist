/* VERO NEW-P2R3A-STOCK-2 (live p2r3a, on top of NEW-P2R3A-STOCK-1) — product family + exact wattage.
   Run: node tests/vero-p2r3a-stock2.test.js        (cases, then the built-in mutants; exit 1 on any failure / survivor)
   Owner decisions O1–O8 (2026-10-15):
     - "GaNTech" ≡ "GaN Tech" for NAME matching only (both forms indexed; names and query text never rewritten)
     - family membership = product-name members ∪ EXPLICIT description evidence (full family phrase in a self-reference with
       the product's own wattage or own type noun; never after comparison / compatibility wording); evidence is used only to
       resolve family + wattage questions (O1), never as a wattage source, never to make a negative
     - answer = exact family matches | labelled alternatives (same type + wattage, "(not {Family})", cap 8, never framed as
       exact) | "can't confirm" (a same-type family member has no listed wattage) | honest "nothing at that wattage"
     - exist / list / stock lookup / price questions (O6); single SKU / model anchors, mixed-type families (Star Rail),
       ranges and non-wattage qualifiers unchanged; stock caveat on every stock answer, never a quantity
     NEW-P2R3A-STOCK-6B (owner decision 4, 2026-10-19) supersedes the device-named scope limit (rows removed from G1, the two
     device-guard mutants retired; device behaviour + mutants in tests/vero-p2r3a-stock6b.test.js)
     NEW-P2R3A-STOCK-6A (owner S6-1 … S6-4, 2026-10-16) supersedes three of these scope limits — tested in
     tests/vero-p2r3a-stock6a.test.js: the alias is two-way (A2 below), count questions and wattage ranges resolve (removed
     from G), and a single-SKU name resolves when description evidence adds a member (the one-SKU mutant now targets that guard)
   Expectations are DERIVED from data/products.json; synthetic in-memory SKUs (prefix ZZS2-) test the evidence rules, the
   alternatives cap and "can't confirm" without touching the catalogue file.
   Equivalent mutants (documented, not tested): O1 "evidence only with a wattage" is structural (familyWattage returns null
   without an exact-wattage filter, so no reachable mutant changes it); excluding family members from the alternatives is
   defensive (the alternatives rerun applies the same constraints, so a family member at the asked wattage would already be an
   exact match); the same-type guard is unreachable today (a mixed family has no plan.type on the anchor path, and the
   name-phrase path already keeps only members of the asked type).
   Scope guards added during implementation (blast-radius review): only chargers / power banks (a hub's "100W" is PD
   pass-through), a line has >= 2 SKUs, a name-phrase FILTER resolves only when every member has a listed wattage
   ("can't confirm" is reserved for a product-line anchor), and device-named questions stay compatibility questions. */
const fs=require('fs'), path=require('path'), os=require('os'), cp=require('child_process');
const ROOT=path.join(__dirname,'..'), CODE=process.env.STOCK2_CODE_ROOT||ROOT, MUTANT=process.env.STOCK2_MUTANT||'';
global.window={ PRICE_SETTINGS:{ indicatorDays:30 } };
eval(fs.readFileSync(path.join(CODE,'js','helpers.js'),'utf8'));
['vero-lexicon','vero-nlu','vero-facts','vero-plan','vero-compose'].forEach(f=>require(path.join(CODE,'js',f+'.js')));
const E=require(path.join(CODE,'js','vero-engine.js'));
const F=require(path.join(CODE,'js','vero-facts.js'));
const RAW=fs.readFileSync(path.join(ROOT,'data','products.json'),'utf8');
const ALL=JSON.parse(RAW); pcResolveSchedule(ALL);
const PUB=ALL.filter(p=>!p.disabled), IDX=F.build(PUB);
const NAMES_BEFORE=JSON.stringify(PUB.map(p=>p.product_name));
let pass=0, fail=0; const chk=(n,c,x)=>{ if(c){ pass++; if(!MUTANT) console.log('PASS - '+n); } else { fail++; console.log('FAIL - '+n+(x!==undefined?'  -> '+String(x).slice(0,500):'')); } };
const SEEN=[];
function ask(q,P){ const r=E.answer(P||PUB,q,{}); const x={ q, r }; SEEN.push(x); return x; }
const txt=x=>x.q+' => ['+x.r.plan.intent+(x.r.plan.result.family?' '+x.r.plan.result.family.mode:'')+'] '+(x.r.note||'')+' | '+(x.r.codes||[]).join(',');
const S=a=>JSON.stringify([...a].map(String).sort()), same=(a,b)=>S(a)===S(b);
const W=(c,I)=>{ const f=(I||IDX).byCode[c]; return f?f.attrs.watts.value:undefined; }, fam=(c,I)=>{ const f=(I||IDX).byCode[c]; return f?f.type.family:undefined; };
const STOCK_CAVEAT=/live inventory/i;
const FAKE_QTY=/\b\d+\s*(?:pcs|pieces|piraso|units?|stocks?|left|remaining|natitira|available)\b|\b(?:in stock|out of stock|available ngayon|may stock pa|ubos na|sold out)\b/i;
const caveatOk=x=>STOCK_CAVEAT.test(x.r.stockNote||'') && !FAKE_QTY.test(x.r.note||'') && !FAKE_QTY.test(x.r.stockNote||'');
const stockOk=x=>caveatOk(x) && !/^\s*\d/.test(x.r.note||'');   /* STOCK-2 answers: also never a count-led sentence */
const card=(x,c)=>String((x.r.detail||{})[c]||'');
const norm=s=>' '+String(s).toLowerCase().replace(/gantech/g,'gan tech').replace(/\s+/g,' ')+' ';
const desc=p=>String(p.description||'')+' '+(Array.isArray(p.features)?p.features.join(' '):String(p.features||''));

/* ---------- derived fixtures ---------- */
const LINE=PUB.filter(p=>/\brobot\s+gan\b/i.test(String(p.product_name).replace(/gantech/ig,'GaN Tech').replace(/\s+/g,' '))).map(p=>String(p.item_code));
const L100=LINE.filter(c=>W(c)===100), GLUED=PUB.filter(p=>/gantech/i.test(p.product_name)).map(p=>String(p.item_code));
const NEX_NAME=PUB.filter(p=>/(^|[^a-z0-9])nexode([^a-z0-9]|$)/i.test(p.product_name)).map(p=>String(p.item_code));
/* independent oracle for EXPLICIT Nexode description evidence (own wattage or own type noun right after the phrase) */
const NEX_EV=PUB.filter(p=>NEX_NAME.indexOf(String(p.item_code))<0).filter(p=>{ const t=norm(desc(p)), w=W(String(p.item_code)), f=fam(String(p.item_code));
  const mW=t.match(/[^a-z0-9](?:ugreen )?nexode (?:(?:pro|air|mini|max|series) )?(\d+)w(?![a-z0-9])/); if(mW && w && +mW[1]===w) return true;
  const tn={ charger:'(?:usb[- ]?c )?(?:fast |wall |desktop |gan )*charger', power_bank:'power ?bank', charging_cable:'(?:charging )?cable' }[f];
  return !!(tn && new RegExp('[^a-z0-9](?:ugreen )?nexode (?:(?:pro|air|mini|max|series) )?(?:\\d+w )?(?:usb[- ]?c )?'+tn+'(?![a-z0-9])').test(t)); }).map(p=>String(p.item_code));
const NEX_ALL=NEX_NAME.concat(NEX_EV);
const nexAt=w=>NEX_ALL.filter(c=>fam(c)==='charger' && W(c)===w);
chk('F0 fixtures: Robot GaN line incl. a glued "GaNTech" 100W member; Nexode with explicit description members at wattages no Nexode NAME has (else this test proves nothing)',
  L100.length>=1 && GLUED.length>=1 && L100.every(c=>GLUED.indexOf(c)>=0) && nexAt(65).length>=1 && nexAt(100).length>=1 && NEX_NAME.every(c=>W(c)!==65 && W(c)!==100),
  'line '+LINE+' | 100W '+L100+' | nexode name '+NEX_NAME+' | nexode evidence '+NEX_EV);
console.log('INFO evidence audit — Nexode members by explicit description: '+NEX_EV.map(c=>c+'('+fam(c)+','+W(c)+'W)').join(', '));

/* ---------- A GaNTech ≡ GaN Tech (matching only) ---------- */
const A1=['robot gan 100w','100w robot gan','may robot gan 100w ba?','may stock ba ng robot gan 100w?','is there stock of 100w robot gan?','ilan ang stock ng robot gan 100w?'].map(q=>ask(q));
chk('A1 every Robot GaN 100W phrasing → exactly the derived 100W member(s) of the line (the "GaNTech" SKU)', A1.every(x=>same(x.r.codes,L100)), A1.map(txt).join(' || '));
chk('A1b the stock phrasings keep the "listed" framing + the no-live-inventory caveat, never a quantity', A1.filter(x=>x.r.plan.flags.stock).every(stockOk) && A1.filter(x=>x.r.plan.flags.stock).length>=3, A1.map(x=>txt(x)+' | '+x.r.stockNote).join(' || '));
const A2=[ask('gantech'),ask('gantech 100w'),ask('robot gantech')];
/* STOCK-6A (S6-2): the typed glued word now also finds names written "GaN Tech" — the glued product must still be in every answer */
chk('A2 the literal glued word still finds the glued product ("gantech", "gantech 100w", "robot gantech")', A2.every(x=>GLUED.every(c=>x.r.codes.indexOf(c)>=0)), A2.map(txt).join(' || '));
const pasted=PUB.filter(p=>/\bGaN\s+Tech\b/.test(p.product_name) && W(String(p.item_code)) && fam(String(p.item_code))==='charger').slice(0,6).map(p=>ask(String(p.product_name)));
chk('A3 pasted product names with "GaN Tech" are never glued into "gantech" (no false "wala"; the pasted SKU is in the answer)', pasted.length>=3 && pasted.every(x=>x.r.codes.length && x.r.codes.some(c=>norm((PUB.find(p=>String(p.item_code)===c)||{}).product_name)===norm(x.q))), pasted.map(txt).join(' || '));
chk('A4 product names are never rewritten (catalogue objects unchanged after every query)', JSON.stringify(PUB.map(p=>p.product_name))===NAMES_BEFORE);

/* ---------- B exact family matches incl. explicit description evidence (O1) ---------- */
const B1=ask('may nexode 65w ba?'), B2=ask('is there stock of 65w nexode?'), B3=ask('ilan ang stock ng nexode 100w?'), B4=ask('nexode 65w charger'), B4b=ask('nexode 300w');
chk('B1 "may nexode 65w ba?" → exactly the derived Nexode 65W chargers (description members), "Meron — N na Nexode 65W sa current pricelist:"',
  same(B1.r.codes,nexAt(65)) && /^Meron — \d+ na Nexode 65W sa current pricelist:$/.test(B1.r.note), txt(B1));
chk('B1b every description member shows its evidence on the card ("… — ayon sa product description"); no name member does',
  B1.r.codes.every(c=>NEX_EV.indexOf(c)>=0?/ — ayon sa product description$/.test(card(B1,c)):!/product description/.test(card(B1,c))), B1.r.codes.map(c=>c+':'+card(B1,c)).join(' | '));
/* fix round 2 (QA pin): the card names the evidence phrase in catalogue casing ("Nexode Pro 65W", wattage upper-case), and the description really says it */
const ownW=c=>W(c), cardOk=(x,c)=>{ const m=card(x,c).match(/^(Nexode(?: (?:Pro|Air|Mini|Max|Series))?)(?: (\d+)W)? — (?:ayon sa|per) product description$/); if(!m) return false; const d=norm(desc(PUB.find(p=>String(p.item_code)===c)));
  return d.indexOf(' '+m[1].toLowerCase()+(m[2]?' '+m[2]+'w':''))>=0 && (!m[2] || +m[2]===ownW(c)); };
chk('B1c evidence cards use the catalogue casing of the phrase found in that product\'s description (e.g. "Nexode Pro 65W"), never raw lower-case', [B1,B2,B3,B4,B4b].every(x=>x.r.codes.filter(c=>NEX_EV.indexOf(c)>=0).every(c=>cardOk(x,c))) && /^Nexode Pro 65W — /.test(card(B1,nexAt(65).find(c=>/nexode pro 65w/.test(norm(desc(PUB.find(p=>String(p.item_code)===c)))))||'')), [B1,B2,B3,B4,B4b].map(x=>x.r.codes.map(c=>c+':'+card(x,c)).join(' | ')).join(' || '));
chk('B2 English stock: same set, "These Nexode 65W chargers are listed in the current pricelist:", caveat', same(B2.r.codes,nexAt(65)) && /^These Nexode 65W chargers are listed in the current pricelist:$/.test(B2.r.note) && stockOk(B2) && /per product description/.test(card(B2,B2.r.codes[0])), txt(B2));
chk('B3 stock count: the Nexode 100W charger(s), "Naka-lista … Nexode 100W charger na ito:", quantity caveat', same(B3.r.codes,nexAt(100)) && /^Naka-lista sa current pricelist ang mga Nexode 100W charger na ito:$/.test(B3.r.note) && stockOk(B3) && /ilan/.test(B3.r.stockNote), txt(B3));
chk('B4 the type-word path ("nexode 65w charger") and other wattages ("nexode 300w") resolve the same way', same(B4.r.codes,nexAt(65)) && same(B4b.r.codes,nexAt(300)) && nexAt(300).length>=1, [B4,B4b].map(txt).join(' || '));
const B4t=ask('nexode 300w po');
chk('B4b (fix round 2, QA pin) the list sentence names the family in English and Tagalog ("1 Nexode 300W charger:" / "1 na Nexode 300W charger:")', /^\d+ Nexode 300W chargers?:$/.test(B4b.r.note) && /^\d+ na Nexode 300W charger:$/.test(B4t.r.note) && same(B4t.r.codes,nexAt(300)), [B4b,B4t].map(txt).join(' || '));
/* power banks are in scope too (fix round 2, QA pin): a mixed line (Star Rail) narrowed by the typed type word "power bank" */
const PB=[ask('star rail 20w power bank'),ask('may star rail 20w power bank ba?')], SR=PUB.filter(p=>/star rail/i.test(p.product_name)).map(p=>String(p.item_code));
chk('B7 power-bank family: no Star Rail power bank at 20W → labelled power-bank alternatives at 20W (never a Star Rail code), cap 8',
  PB.every(x=>x.r.plan.result.family && x.r.plan.result.family.mode==='alternatives' && x.r.codes.length && x.r.codes.length<=8 && x.r.codes.every(c=>fam(c)==='power_bank' && W(c)===20 && SR.indexOf(c)<0)) &&
  /^No Star Rail 20W is listed\. 20W power banks you could offer instead \(not Star Rail\):$/.test(PB[0].r.note) && /^Walang naka-listang Star Rail na 20W\. Mga 20W power bank na pwedeng alternatibo \(hindi Star Rail\):$/.test(PB[1].r.note), PB.map(txt).join(' || '));
const B5=ask('may stock ba ng nexode?');
chk('B5 O1: a plain family question (no wattage) stays NAME-based — description members are not added', same(B5.r.codes,NEX_NAME) && !B5.r.plan.result.family, txt(B5));
chk('B6 description evidence never adds a member of another product type (no power bank / cable in a charger answer)', [B1,B2,B3,B4,B4b].every(x=>x.r.codes.every(c=>fam(c)==='charger')), '');

/* ---------- C labelled alternatives (O2) ---------- */
const alt20=ask('20w gan charger').r.codes.filter(c=>LINE.indexOf(c)<0);
const C=['may robot gan 20w ba?','robot gan 20w','do you have robot gan 20w?','may stock ba ng robot gan 20w?','ilan ang stock ng robot gan 20w?','robot gan 20w charger'].map(q=>ask(q));
chk('C1 no Robot GaN at 20W → the same-type 20W GaN chargers outside the line (derived), never a Robot GaN code', alt20.length>=1 && C.every(x=>same(x.r.codes,alt20.slice(0,8)) && x.r.codes.every(c=>LINE.indexOf(c)<0 && W(c)===20)), C.map(txt).join(' || '));
const tlAlt=/^Walang naka-listang Robot GaN na 20W\. Mga 20W GaN charger na pwedeng alternatibo \(hindi Robot GaN\):$/, enAlt=/^No Robot GaN 20W is listed\. 20W GaN chargers you could offer instead \(not Robot GaN\):$/;
chk('C2 approved wording, labelled "(hindi Robot GaN)" / "(not Robot GaN)", never "Meron —" / "Yes —" / "Oo —"', C.every(x=>(tlAlt.test(x.r.note)||enAlt.test(x.r.note)) && !/^(?:Meron|Yes|Oo) —/.test(x.r.note)), C.map(txt).join(' || '));
chk('C3 stock phrasings of the alternatives answer keep the caveat, no quantity', C.filter(x=>x.r.plan.flags.stock).every(stockOk) && C.filter(x=>x.r.plan.flags.stock).length>=2, '');

/* ---------- D nothing at that wattage ---------- */
const g55=ask('55w gan charger').r.codes;
const D=[ask('may stock ba ng robot gan 55w?'),ask('robot gan 55w')];
chk('D1 no GaN charger at 55W at all (derived) → no codes, an honest negative naming the wattage, with the GaN wattages that exist', g55.length===0 && D.every(x=>!x.r.codes.length && /55W GaN charger/.test(x.r.note) && /GaN chargers (?:we carry|natin)/i.test(x.r.note) && !/Robot/i.test(x.r.note)), D.map(txt).join(' || '));

/* ---------- E price questions (O6) ---------- */
const E1=ask('magkano robot gan 20w'), E2=ask('magkano robot gan 55w'), E3=ask('magkano nexode 65w'), E4=ask('magkano robot gan 65w');
chk('E1 price + family + wattage without a family match → the labelled alternatives with price fields', same(E1.r.codes,alt20.slice(0,8)) && tlAlt.test(E1.r.note) && (E1.r.fields||[]).indexOf('srp')>=0, txt(E1));
chk('E2 price question with nothing at that wattage → no codes (never the whole line with prices), and the GaN wattages that DO exist are suggested', !E2.r.codes.length && /55W/.test(E2.r.note) && /GaN chargers (?:we carry|natin)/i.test(E2.r.note) && (E2.r.chips||[]).length>0, txt(E2));
/* ---------- F follow-ups (fix round 1, VERO N1): "how much" after a STOCK-2 answer prices exactly the codes just shown ---------- */
function chain(qs){ let conv=null; return qs.map(q=>{ const r=E.answer(PUB,q,{ conv }); if(r.ctxOut) conv=r.ctxOut; const x={ q, r }; SEEN.push(x); return x; }); }
const FU=[chain(['may nexode 65w ba?','how much']),chain(['nexode 65w','price of those']),chain(['robot gan 20w','how much']),chain(['may stock ba ng robot gan 20w?','magkano'])];
chk('F1 a price follow-up after an exact-evidence or alternatives answer prices the SHOWN codes (never other family SKUs), with price fields',
  FU.every(c=>c[0].r.codes.length && same(c[1].r.codes,c[0].r.codes) && (c[1].r.fields||[]).indexOf('srp')>=0), FU.map(c=>c.map(txt).join(' >> ')).join(' || '));
const FN=chain(['may stock ba ng robot gan 55w?','how much']);
chk('F2 after an honest "nothing at that wattage" answer a price follow-up never prices the family line (no codes)', !FN[0].r.codes.length && !FN[1].r.codes.length, FN.map(txt).join(' >> '));
const F3=[chain(['may robot gan 100w ba?','how much']),chain(['robot gan 100w','magkano']),chain(['may stock ba ng robot gan 100w?','price of those']),chain(['is there stock of 100w robot gan?','how much'])];
chk('F3 (fix round 2, QA) a wattage-narrowed LINE answer (Robot GaN 100W via "GaNTech") → the price follow-up prices exactly the shown code(s), never the first 6 line SKUs',
  F3.every(c=>same(c[0].r.codes,L100) && same(c[1].r.codes,L100) && (c[1].r.fields||[]).indexOf('srp')>=0), F3.map(c=>c.map(txt).join(' >> ')).join(' || '));
const F4=[chain(['may stock ba ng robot gan 65w?','magkano']),chain(['may robot gan 65w ba?','how much'])], L65f=LINE.filter(c=>W(c)===65);
chk('F4 STOCK-1 narrowed answers keep pricing exactly the shown 65W set', F4.every(c=>same(c[0].r.codes,L65f) && same(c[1].r.codes,L65f)), F4.map(c=>c.map(txt).join(' >> ')).join(' || '));
chk('E3 price question resolves description members too (Nexode 65W) with the card note', same(E3.r.codes,nexAt(65)) && E3.r.codes.some(c=>/product description/.test(card(E3,c))), txt(E3));
const L65=LINE.filter(c=>W(c)===65);
chk('E4 price question with name members at that wattage is unchanged (the 65W Robot GaN set)', same(E4.r.codes,L65) && !E4.r.plan.result.family, txt(E4));

/* ---------- G unchanged by design (scope) ---------- */
const G=[ask('robot gan 65w'),ask('may stock ba ng robot gan 65w?'),ask('CD361 30w'),ask('may CD361 30w ba?'),ask('how many star rail 20w in stock?'),ask('May PD ba ang X755?'),ask('may 2m ba ng AV102?'),ask('65W charger'),
  ask('7-in-1 USB-C hub, 4K HDMI, USB-A/USB-C data, SD reader, 100W.'),ask('7-in-1 magnetic USB-C hub, 4K@60Hz HDMI, SD 4.0, 100W PD.'),ask('may gantech 65w ba?'),ask('20,000mAh power bank, 20W two-way USB-C, charges 3 devices.'),ask('*Wireless Charging Output Power: iPhone 25.0W Max, AirPods 5.0W Max'),
  /* fix round 1 (QA pins): device class, ranges, other question types, name members at the wattage in a family that HAS description evidence */
  /* STOCK-6A (S6-3 / S6-4): "may nexode 65w pataas ba?", "nexode 65w pababa", "ilan ang nexode 65w?" now resolve — see tests/vero-p2r3a-stock6a.test.js C / D */
  /* STOCK-6B (owner decision 4, 2026-10-19): device-named / device-class questions now resolve — see tests/vero-p2r3a-stock6b.test.js */
  ask('recommend nexode 65w'),ask('best robot gan 20w'),ask('nexode 65w details'),
  ask('nexode 20w'),ask('may nexode 20w ba?'),ask('may stock ba ng nexode 20w?'),ask('may nexode 45w ba?')];
chk('G1 STOCK-2 never fires for name members at the wattage, model / SKU anchors, mixed-type families (Star Rail), feature or length questions, plain type questions, hubs (PD pass-through), a one-SKU "line", a name fragment with an unlisted wattage', G.every(x=>!x.r.plan.result.family), G.filter(x=>x.r.plan.result.family).map(txt).join(' || '));
chk('G2 the 65W Robot GaN answers keep the STOCK-1 set', same(G[0].r.codes,L65) && same(G[1].r.codes,L65), '');

/* ---------- synthetic catalogue: evidence rules E1–E4, alternatives cap, "can't confirm" ---------- */
const SYN=[
  { item_code:'ZZS2-01', model:'ZZ01', product_name:'22W USB-C GaN Fast Charger', description:'Works with UGREEN Nexode 22W charger cables.' },   /* comparison context → not Nexode */
  { item_code:'ZZS2-02', model:'ZZ02', product_name:'22W USB-C GaN Fast Charger', description:'UGREEN Robot charger with an LED face.' },       /* one word of "robot gan" → not Robot GaN */
  { item_code:'ZZS2-03', model:'ZZ03', product_name:'22W USB-C GaN Fast Charger', description:'Built on Nexode Pro 65W technology.' },        /* wattage ≠ own 22W, no own type noun → not Nexode */
  { item_code:'ZZS2-04', model:'ZZ04', product_name:'22W USB-C GaN Fast Charger', description:'UGREEN Nexode Mini 22W charger for travel.' }  /* explicit self-reference → Nexode */
].concat(Array.from({ length:9 },(_,i)=>({ item_code:'ZZS2-1'+i, model:'ZZ1'+i, product_name:'22W USB-C GaN Wall Charger', description:'Compact wall charger.' })),
  [{ item_code:'ZZS2-Z1', model:'ZZZ1', product_name:'Zorbex 30W USB-C GaN Charger', description:'' }, { item_code:'ZZS2-Z2', model:'ZZZ2', product_name:'Zorbex 30W USB-C GaN Charger', description:'' }])   /* a 2-SKU line (boundary) */
 .map(p=>Object.assign({ color:'Black', length:'', srp:999, dp:899, dp_volume:849, moq:1, features:'', sheet:'Mobile-Charger', category:'Wall Charger/Desk Charger' },p));
const PS=PUB.concat(SYN), IS=F.build(PS);
const X1=ask('may nexode 22w ba?',PS), X2=ask('may robot gan 22w ba?',PS);
chk('X1 explicit description evidence: only the self-reference ("Nexode Mini 22W charger") joins Nexode; comparison wording, a mismatched wattage and incidental mentions do not',
  same(X1.r.codes,['ZZS2-04']) && X1.r.plan.result.family && X1.r.plan.result.family.mode==='exact' && /product description/.test(card(X1,'ZZS2-04')), txt(X1));
chk('X2 one word of a multi-word family ("Robot charger") is not Robot GaN membership → alternatives, capped at 8, labelled', X2.r.plan.result.family && X2.r.plan.result.family.mode==='alternatives' && X2.r.codes.length===8 && X2.r.codes.every(c=>W(c,IS)===22) && /\(hindi Robot GaN\):$/.test(X2.r.note), txt(X2));
const X4=ask('may zorbex 22w ba?',PS);
chk('X4 boundary: a 2-SKU line is a family (no Zorbex at 22W → labelled alternatives, never a Zorbex code)', X4.r.plan.result.family && X4.r.plan.result.family.mode==='alternatives' && X4.r.codes.length && X4.r.codes.every(c=>W(c,IS)===22 && !/^ZZS2-Z/.test(c)) && /\(hindi Zorbex\):$/.test(X4.r.note), txt(X4));
const PS2=PUB.concat(SYN.filter(p=>p.item_code!=='ZZS2-04')), X5=ask('may nexode 22w ba?',PS2);
chk('X5 "can\'t confirm" also when the only mentions at the asked wattage failed the explicit-evidence rule (no "wala", no alternatives as the answer)', X5.r.plan.result.family && X5.r.plan.result.family.mode==='insufficient' && X5.r.codes.length && X5.r.codes.every(c=>c==='ZZS2-01'||c==='ZZS2-03'), txt(X5));
const PU=PUB.map(p=>L100.indexOf(String(p.item_code))>=0?Object.assign({},p,{ product_name:String(p.product_name).replace(/\d+\s?W\b/ig,'').replace(/\s+/g,' ').trim(), description:'', features:'' }):p);
const U1=ask('may robot gan 100w ba?',PU), U2=ask('may stock ba ng robot gan 100w?',PU), U3=ask('do you have robot gan 100w?',PU);
chk('X3b (fix round 2, QA pin) the English "can\'t confirm" sentence, exactly as approved', U3.r.plan.result.family && U3.r.plan.result.family.mode==='insufficient' && same(U3.r.codes,L100) && /^I can’t confirm a 100W Robot GaN from the pricelist — these have no listed wattage:$/.test(U3.r.note), txt(U3));
chk('X3 "can\'t confirm": a family member without a listed wattage → the approved sentence + that member, never "wala", never alternatives as the answer',
  [U1,U2].every(x=>x.r.plan.result.family && x.r.plan.result.family.mode==='insufficient' && same(x.r.codes,L100) && /^(?:Hindi ko makumpirma sa pricelist kung may Robot GaN na 100W — walang naka-listang wattage ang mga ito:|I can’t confirm a 100W Robot GaN from the pricelist — these have no listed wattage:)$/.test(x.r.note)) && stockOk(U2), [U1,U2].map(txt).join(' || '));

/* ---------- I invariants over every answer in this file ---------- */
chk('I1 every stock question keeps the no-live-inventory caveat; no answer states a quantity or stock state; no STOCK-2 stock answer is count-led', SEEN.filter(x=>x.r.plan.flags.stock).every(caveatOk) && SEEN.filter(x=>x.r.plan.flags.stock && x.r.plan.result.family).every(stockOk) && SEEN.every(x=>!FAKE_QTY.test(x.r.note||'')), SEEN.filter(x=>x.r.plan.flags.stock && !caveatOk(x)).map(txt).join(' || '));
const FAMSEEN=SEEN.filter(x=>x.r.plan.result.family || FU.some(c=>c[1]===x));   /* STOCK-2 answers + their follow-ups (out-of-scope controls keep their own routes) */
chk('I2 every STOCK-2 answer and its price follow-up is local (no AI / web route)', FAMSEEN.length>=20 && FAMSEEN.every(x=>x.r.plan.route.route==='LOCAL'), FAMSEEN.filter(x=>x.r.plan.route.route!=='LOCAL').map(txt).join(' || '));
chk('I3 alternatives are never framed as exact matches anywhere', SEEN.every(x=>!(x.r.plan.result.family && x.r.plan.result.family.mode==='alternatives' && /^(?:Meron|Yes|Oo) —/.test(x.r.note))), '');
ask('is there stock of 100w nexode?'); ask('do you have nexode 300w?');
chk('I5 no singular noun with a plural verb in any English answer ("These … charger are")', SEEN.every(x=>!/\b(?:charger|bank|cable) are\b/.test(x.r.note||'')), SEEN.filter(x=>/\b(?:charger|bank|cable) are\b/.test(x.r.note||'')).map(txt).join(' || '));
chk('I4 products.json untouched by the test (synthetic SKUs are in memory only)', fs.readFileSync(path.join(ROOT,'data','products.json'),'utf8')===RAW);

console.log((MUTANT?'['+MUTANT+'] ':'')+'VERO NEW-P2R3A-STOCK-2: '+pass+' passed, '+fail+' failed');

/* ===================== mutation tests ===================== */
if(!MUTANT){
  const M=[
    ['GaNTech equivalence removed','js/vero-plan.js',"var NAME_ALIAS={ gantech:['gan','tech'] };","var NAME_ALIAS={};"],
    ['split-word join glues an aliased pair again ("gan tech" → "gantech")','js/vero-plan.js',"if(!NAME_ALIAS[j] && ni.df[j] && ","if(ni.df[j] && "],
    ['alternate token stream ignored (alias postings matched against the original tokens)','js/vero-plan.js',"var tk=pp[2]?ni.alt[pp[0]]:ni.toks[pp[0]];","var tk=ni.toks[pp[0]];"],
    ['description evidence disabled','js/vero-plan.js',"var W=wf.value, ev=familyEvidence(phrase,T,products,idx,famCodes);","var W=wf.value, ev={ admit:[], reject:[] };"],
    ['comparison / compatibility context accepted as evidence','js/vero-plan.js',"EV_NEG=/(?:compatible with","EV_NEG=/(?!)(?:compatible with"],
    ['evidence wattage not compared with the product\'s own wattage','js/vero-plan.js',"w && +m[3]===w) hit=","w) hit="],
    ['one word of a multi-word family accepted as evidence','js/vero-plan.js',"var f=phrase.split(' ').map(esc).join(' ?'), tn=EV_TYPE[T]","var f=esc(phrase.split(' ')[0]), tn=EV_TYPE[T]"],
    ['alternatives framed as exact ("Meron —")','js/vero-compose.js',"return tl?'Walang naka-listang '+famName+' na '+fw+'. Mga '","return tl?'Meron — walang naka-listang '+famName+' na '+fw+'. Mga '"],
    ['alternatives label "(not {Family})" dropped','js/vero-compose.js',"function altTl(){ return ' na pwedeng alternatibo (hindi '+famName+'):'; }","function altTl(){ return ' na pwedeng alternatibo:'; }"],
    ['alternatives cap removed','js/vero-plan.js',"return famAll.indexOf(x)<0; }).slice(0,8);","return famAll.indexOf(x)<0; });"],
    ['"can\'t confirm" removed (unknown-wattage member → alternatives / negative)','js/vero-plan.js',"    if(unk.length){ var ui=","    if(false){ var ui="],
    ['model / SKU anchors included','js/vero-plan.js',"if(an.length!==1 || an[0].via!=='name' || (plan.refs||[]).length) return null;","if(an.length!==1 || (plan.refs||[]).length) return null;"],
    ['wattage families widened to hubs (PD pass-through)','js/vero-plan.js',"WATT_TYPES={ charger:1, power_bank:1 }","WATT_TYPES={ charger:1, power_bank:1, hub_dock:1 }"],
    ['name fragment with an unlisted member wattage resolved (cannot-confirm outside a product-line anchor)','js/vero-plan.js',"if(!fromSubject && !famCodes.every(function(x){ return idx.byCode[x].attrs.watts.value; })) return null;",""],
    ['price questions excluded (O6 reverted)','js/vero-plan.js',"|| (I==='attribute' && PRICE_ATTR[plan.attribute])))","))"],
    ['zero-result family + wattage falls back to the whole line (STOCK-2 resolution disabled)','js/vero-plan.js',"var fw=familyWattage(plan,products,idx,subject,X,c,R,fromSubject); if(fw) return fw;","var fw=null;"],
    ['evidence card note removed','js/vero-compose.js',"res.detail[cd]=ph+(lang==='tl'?' — ayon sa product description':' — per product description');","res.detail[cd]='';"],
    ['family name missing from the exact sentence','js/vero-compose.js',"if(I==='exist') return tl?'Meron — '+n+' na '+famName+' '+fw+' sa current pricelist:'","if(I==='exist') return tl?'Meron — '+n+' na '+fw+' sa current pricelist:'"],
    ['English stock sentence uses a singular noun for one result ("These … charger are")','js/vero-compose.js',"':'These '+famName+' '+fw+' '+nounOf(LP,true)+' are listed","':'These '+famName+' '+fw+' '+nn+' are listed"],
    ['follow-up focus keeps the name-matched line (fix round 1 reverted)','js/vero-plan.js',"    if(plan.result && plan.result.family) ctx.focus=res.length===1?res.slice():[];",""],
    ['question-type limit dropped (count / recommend / details resolved too)','js/vero-plan.js',"if(!wf || !(I==='exist' || I==='list' || I==='count' || (dev && I==='compat' && plan.devFamilyQ) || (I==='lookup' && plan.flags.stock) || (I==='attribute' && PRICE_ATTR[plan.attribute]))) return null;","if(!wf) return null;"],
    ['description evidence admitted at any wattage','js/vero-plan.js',"var evAt=ev.admit.filter(function(e){ return wIn(wf,idx.byCode[e.code].attrs.watts.value); });","var evAt=ev.admit.slice();"],
    ['price no-match drops the wattages that exist','js/vero-compose.js',"var fc0=facets(LP,idx); if(fc0){","var fc0=null; if(fc0){"],
    ['a 2-SKU line no longer a family (minimum raised to 3)','js/vero-plan.js',"if(famCodes.length<2 && !ev.admit.length) return null;","if(famCodes.length<3 && !ev.admit.length) return null;"],
    ['failed description mentions at the asked wattage ignored by "can\'t confirm"','js/vero-plan.js',".concat(ev.reject.filter(function(e){ return wIn(wf,idx.byCode[e.code].attrs.watts.value); }).map(function(e){ return e.code; }))",""],
    ['wattage-narrowed line answers keep the first 6 line SKUs as follow-up focus (fix round 2 reverted)','js/vero-plan.js',"(plan.intent==='exist' || plan.intent==='lookup' || plan.intent==='list')) ctx.focus=res.slice(0,6);","(plan.intent==='exist' || plan.intent==='lookup' || plan.intent==='list')) ctx.focus=ctx.focus;"],
    ['power banks dropped from the wattage families','js/vero-plan.js',"WATT_TYPES={ charger:1, power_bank:1 }","WATT_TYPES={ charger:1 }"],
    ['evidence card shows the raw lower-case phrase','js/vero-compose.js',"res.detail[cd]=ph+(lang==='tl'","res.detail[cd]=FM.evidence[cd]+(lang==='tl'"],
    ['English "can\'t confirm" sentence changed','js/vero-compose.js',"'I can’t confirm a '+fw+' '+famName+' from the pricelist — these have no listed wattage:'","'No '+fw+' '+famName+' could be confirmed:'"],
    ['family name dropped from the list sentence','js/vero-compose.js',"return tl?n+' na '+famName+' '+fw+' '+nounOf(LP,false)+':':n+' '+famName+' '+fw+' '+nn+':'; }","return tl?n+' na '+fw+' '+nounOf(LP,false)+':':n+' '+fw+' '+nn+':'; }"],
    ['stock caveat removed','js/vero-compose.js',"if(plan.flags.stock) res.stockNote=T(lang,plan.flags.invQty?'stockQty':'stock');",""],
    ['fake inventory quantity introduced','js/vero-compose.js',"if(plan.flags.stock) res.stockNote=T(lang,plan.flags.invQty?'stockQty':'stock');","if(plan.flags.stock) res.stockNote=T(lang,plan.flags.invQty?'stockQty':'stock')+' 12 units left.';"],
  ];
  let killed=0;
  M.forEach(function(m,i){
    const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'stock2-mut-')); fs.mkdirSync(path.join(tmp,'js'));
    fs.readdirSync(path.join(ROOT,'js')).forEach(f=>fs.copyFileSync(path.join(ROOT,'js',f),path.join(tmp,'js',f)));
    const fp=path.join(tmp,m[1]), src=fs.readFileSync(fp,'utf8');
    if(src.split(m[2]).length!==2){ console.log('FAIL - mutant M'+(i+1)+' anchor not found exactly once: '+m[0]); fail++; fs.rmSync(tmp,{ recursive:true, force:true }); return; }
    fs.writeFileSync(fp,src.replace(m[2],()=>m[3]));
    const r=cp.spawnSync(process.execPath,[__filename],{ env:Object.assign({},process.env,{ STOCK2_CODE_ROOT:tmp, STOCK2_MUTANT:'M'+(i+1) }), encoding:'utf8' });
    const out=(r.stdout||'')+(r.stderr||''), firstFail=(out.split('\n').filter(l=>/^FAIL/.test(l))[0]||out.split('\n').filter(Boolean).slice(-1)[0]||'').slice(0,140);
    if(r.status!==0){ killed++; pass++; console.log('PASS - mutant M'+(i+1)+' killed: '+m[0]+'  ['+firstFail+']'); }
    else { fail++; console.log('FAIL - mutant M'+(i+1)+' SURVIVED: '+m[0]); }
    fs.rmSync(tmp,{ recursive:true, force:true });
  });
  console.log('Mutants killed: '+killed+'/'+M.length);
  console.log('VERO NEW-P2R3A-STOCK-2 (cases + mutants): '+pass+' passed, '+fail+' failed');
}
process.exit(fail?1:0);
