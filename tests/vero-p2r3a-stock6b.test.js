/* VERO NEW-P2R3A-STOCK-6B (live p2r3a, on top of NEW-P2R3A-STOCK-1 / -2 / -6A) — family + wattage + a named device / device class.
   Run: node tests/vero-p2r3a-stock6b.test.js        (cases, then the built-in mutants; exit 1 on any failure / survivor)
   Owner decision 4 (2026-10-19, wording approved by the owner):
     - a product family + wattage + a device keeps the family and wattage filters (same exact / alternatives / none / count /
       range modes as STOCK-2 / STOCK-6A); the device never narrows the set and is never a compatibility claim
     - answers stay LOCAL (no AI escalation, no web lookup); stock questions keep the no-live-inventory caveat, never a quantity
     - the device disclaimer is its own line (res.compatNote):
         EN "Note: Compatibility with your {device} is not confirmed by the available product information."
         TL "Note: Hindi pa confirmed ang compatibility sa {device} mo base sa available product information."
     - sentences: EN exact "Yes — {n} {Family} {W}W {type} listed in the current pricelist:", count "{n} {Family} {W}W {type} listed
       in the current pricelist:", stock "The following {Family} {W}W {type} are listed in the current pricelist:", alternatives
       "No {Family} {W}W {type} is listed. Here are possible alternatives (not {Family}):", none "No {Family} {W}W {type} is listed
       in the current pricelist."; TL exact "Meron — {n} na {Family} {W}W {type} sa current pricelist:", count "{n} na …", stock
       "Naka-lista sa current pricelist ang mga sumusunod na {Family} {W}W {type}:", alternatives "Walang naka-listang {Family} na
       {W}W. Mga posibleng alternatibo (hindi {Family}):", none "Walang naka-listang {Family} na {W}W sa current pricelist."
     - fix round 1 (owner-approved 2026-10-19, after QA / VERO round 1): FR1 the no-type-word shortcut only for an ALIAS family
       ("gantech 65w") and never when the question names another product form ("… for nintendo switch", "… usb c" keep the
       device-fit clarify); FR2 the device none / alternatives sentence keeps the other qualifiers ("No Nexode 65W charger with
       2 ports is listed …"); FR3 "Yes — / Meron —" only for explicit existence questions — list, price, compatibility, "will it
       charge …" and "safe for …" questions get the count sentence; ranges keep the STOCK-6A forms ("≥65W"; TL "{type} na 65W pataas")
     - fix round 2 (owner-approved 2026-10-19, after QA round 2): FR5 the exact / existence / stock / count sentences keep the
       question's other qualifiers too ("1 Nexode 20W charger with 2 ports listed …", "1 GaN Tech 30W purple charger …") on the family
       and the alias path — the stated count always describes the shown set; FR6 pins below
   Equivalent mutants (documented, not tested; QA round 2 found 0 answer differences over 51,627 probe queries on current data):
   alias-path stock singular "is" → "are" (no single-code GaN Tech set exists), disclaimer also on clarify answers (no clarify answer
   carries a family result or devFamilyQ), alias exact guard every → some (an alias filter only returns alias-named codes), exact
   relabel ignoring the wattage check (R.codes are already wattage-filtered), soft non-alias name phrase counted (soft phrases
   never coexist with the family modes on current data), alias droppedQualifiers guard removed (the aliasDrop branch runs first).
   Unchanged by design: recommendations / judgement questions, questions without a family name phrase or without a wattage,
   STOCK-10 "X to Y" ranges, model anchors (STOCK-6C), mixed-type families and sub-line words (STOCK-6D).
   Expectations are DERIVED from data/products.json (names + the same explicit description-evidence oracle as STOCK-6A). */
const fs=require('fs'), path=require('path'), os=require('os'), cp=require('child_process');
const ROOT=path.join(__dirname,'..'), CODE=process.env.STOCK6B_CODE_ROOT||ROOT, MUTANT=process.env.STOCK6B_MUTANT||'';
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
function ask(q){ const r=E.answer(PUB,q,{}); const x={ q, r }; SEEN.push(x); return x; }
function chain(qs){ let conv=null; return qs.map(q=>{ const r=E.answer(PUB,q,{ conv }); if(r.ctxOut) conv=r.ctxOut; const x={ q, r }; SEEN.push(x); return x; }); }
const fm=x=>x.r.plan.result && x.r.plan.result.family, mode=x=>fm(x)?fm(x).mode:'';
const txt=x=>x.q+' => ['+x.r.plan.intent+(mode(x)?' '+mode(x):'')+' '+x.r.plan.route.route+'] '+(x.r.note||'')+' | '+(x.r.codes||[]).join(',')+' | '+(x.r.compatNote||'-');
const S=a=>JSON.stringify([...a].map(String).sort()), same=(a,b)=>S(a)===S(b);
const W=c=>{ const f=IDX.byCode[c]; return f?f.attrs.watts.value:undefined; }, fam=c=>{ const f=IDX.byCode[c]; return f?f.type.family:undefined; };
const STOCK_CAVEAT=/live inventory/i;
const FAKE_QTY=/\b\d+\s*(?:pcs|pieces|piraso|units?|stocks?|left|remaining|natitira|available)\b|\b(?:in stock|out of stock|available ngayon|may stock pa|ubos na|sold out)\b/i;
const caveatOk=x=>STOCK_CAVEAT.test(x.r.stockNote||'') && !FAKE_QTY.test(x.r.note||'') && !FAKE_QTY.test(x.r.stockNote||'');
const INLINE_COMPAT=/can’t confirm compatibility|ma-confirm ang compatibility/i;
const EN_NOTE=d=>'Note: Compatibility with your '+d+' is not confirmed by the available product information.';
const TL_NOTE=d=>'Note: Hindi pa confirmed ang compatibility sa '+d+' mo base sa available product information.';
const norm=s=>' '+String(s).toLowerCase().replace(/gantech/g,'gan tech').replace(/\s+/g,' ')+' ';
const desc=p=>String(p.description||'')+' '+(Array.isArray(p.features)?p.features.join(' '):String(p.features||''));
const code=p=>String(p.item_code), CH=c=>fam(c)==='charger';
const inR=(op,w,v)=>v!=null && (op==='eq'?v===w:op==='ge'?v>=w:op==='le'?v<=w:false);

/* ---------- derived fixtures (independent of the module; same oracle as tests/vero-p2r3a-stock6a.test.js) ---------- */
function evOracle(phrase,nameSet){ const f=phrase.split(' ').join(' ?');
  return PUB.filter(p=>nameSet.indexOf(code(p))<0 && CH(code(p))).filter(p=>{ const t=norm(desc(p)), w=W(code(p));
    const mW=t.match(new RegExp('[^a-z0-9](?:ugreen )?'+f+' (?:(?:pro|air|mini|max|series) )?(\\d+)w(?![a-z0-9])')); if(mW && w && +mW[1]===w) return true;
    return new RegExp('[^a-z0-9](?:ugreen )?'+f+' (?:(?:pro|air|mini|max|series) )?(?:\\d+w )?(?:usb[- ]?c )?(?:usb[- ]?c )?(?:fast |wall |desktop |gan )*charger(?![a-z0-9])').test(t); }).map(code); }
const byName=re=>PUB.filter(p=>re.test(String(p.product_name).replace(/gantech/ig,'GaN Tech').replace(/\s+/g,' '))).map(code);
const PRO_NAME=byName(/(^|[^a-z0-9])nexode pro([^a-z0-9]|$)/i), PRO_ALL=PRO_NAME.concat(evOracle('nexode pro',PRO_NAME)).filter(CH);
const NEX_NAME=byName(/(^|[^a-z0-9])nexode([^a-z0-9]|$)/i), NEX_ALL=NEX_NAME.concat(evOracle('nexode',NEX_NAME)).filter(CH);
const GT=byName(/(^|[^a-z0-9])gan tech([^a-z0-9]|$)/i).filter(CH);
const LINE=byName(/(^|[^a-z0-9])robot gan([^a-z0-9]|$)/i).filter(CH);
const at=(set,op,w)=>set.filter(c=>inR(op,w,W(c)));
const N65=at(NEX_ALL,'eq',65), N100=at(NEX_ALL,'eq',100), P65=at(PRO_ALL,'eq',65), L65=at(LINE,'eq',65), GT65=at(GT,'eq',65), NGE65=at(NEX_ALL,'ge',65);
chk('F0 fixtures: Nexode 65W / 100W, Nexode Pro 65W, Robot GaN 65W and GaN Tech 65W exist; no Robot GaN 20W / 55W, no GaN Tech 45W, no Nexode Pro 30W (else this test proves nothing)',
  N65.length>=2 && N100.length>=1 && P65.length>=1 && L65.length>=2 && GT65.length>=2 && NGE65.length>N65.length &&
  !at(LINE,'eq',20).length && !at(LINE,'eq',55).length && !at(GT,'eq',45).length && !at(PRO_ALL,'eq',30).length,
  'N65 '+N65+' | N100 '+N100+' | P65 '+P65+' | L65 '+L65+' | GT65 '+GT65);
const devOk=(x,d,tl)=>x.r.compatNote===(tl?TL_NOTE(d):EN_NOTE(d)) && !INLINE_COMPAT.test(x.r.note||'');
const local=x=>x.r.plan.route.route==='LOCAL' && !x.r.needsAI;
const alt20=x=>x.r.codes.length>0 && x.r.codes.every(c=>W(c)===20 && CH(c) && LINE.indexOf(c)<0);

/* ---------- A the five reproduced failures (live afe146e3) ---------- */
const A1=ask('nexode 65w for macbook'), A2=ask('nexode pro 65w for macbook air'), A3=ask('may nexode 65w para sa laptop?'),
  A4=ask('may nexode 100w para sa macbook pro?'), A5=ask('may robot gan 20w para sa iphone ba?');
chk('A1 "nexode 65w for macbook" → the exact Nexode 65W set, owner count sentence (FR3: not an existence question), MacBook disclaimer, local (was a false "We don’t have a 65W charger")',
  mode(A1)==='exact' && same(A1.r.codes,N65) && A1.r.note===N65.length+' Nexode 65W chargers listed in the current pricelist:' && devOk(A1,'MacBook') && local(A1), txt(A1));
chk('A2 "nexode pro 65w for macbook air" → Nexode Pro 65W (description member), card note kept, MacBook Air disclaimer (was a false "wala")',
  mode(A2)==='exact' && same(A2.r.codes,P65) && new RegExp('^'+P65.length+' Nexode Pro 65W chargers? listed in the current pricelist:$').test(A2.r.note) &&
  P65.every(c=>/product description/.test(String((A2.r.detail||{})[c]||''))) && devOk(A2,'MacBook Air') && local(A2), txt(A2));
chk('A3 "may nexode 65w para sa laptop?" → the 2 Nexode 65W, not the 20–45W line (was a false yes)', mode(A3)==='exact' && same(A3.r.codes,N65) &&
  /^(?:Yes|Meron) — /.test(A3.r.note) && (devOk(A3,'laptop',false) || devOk(A3,'laptop',true)) && local(A3), txt(A3));
chk('A4 "may nexode 100w para sa macbook pro?" → Nexode 100W only (was a false yes with 20–45W SKUs)', mode(A4)==='exact' && same(A4.r.codes,N100) &&
  /^(?:Yes|Meron) — /.test(A4.r.note) && (devOk(A4,'MacBook Pro',false) || devOk(A4,'MacBook Pro',true)) && local(A4), txt(A4));
chk('A5 "may robot gan 20w para sa iphone ba?" → labelled 20W alternatives, owner TL alternatives sentence, iPhone disclaimer (was a false "Oo" with 30–100W)',
  mode(A5)==='alternatives' && alt20(A5) && A5.r.note==='Walang naka-listang Robot GaN na 20W. Mga posibleng alternatibo (hindi Robot GaN):' && devOk(A5,'iPhone',true) && local(A5), txt(A5));

/* ---------- B owner sentences per question type ---------- */
const B1=ask('how many nexode 65w for laptop?'), B2=ask('ilan ang nexode 65w para sa laptop?');
chk('B1 EN count sentence', B1.r.note===N65.length+' Nexode 65W chargers listed in the current pricelist:' && same(B1.r.codes,N65) && devOk(B1,'laptop'), txt(B1));
chk('B2 TL count sentence (never "0 — Wala")', B2.r.note===N65.length+' na Nexode 65W charger sa current pricelist:' && same(B2.r.codes,N65) && devOk(B2,'laptop',true), txt(B2));
const B3=ask('is there stock of nexode 65w for macbook?'), B4=ask('may stock ba ng nexode 65w para sa macbook?');
chk('B3 EN stock sentence + stock caveat + disclaimer', B3.r.note==='The following Nexode 65W chargers are listed in the current pricelist:' && same(B3.r.codes,N65) && caveatOk(B3) && devOk(B3,'MacBook'), txt(B3));
chk('B4 TL stock sentence + stock caveat + disclaimer', B4.r.note==='Naka-lista sa current pricelist ang mga sumusunod na Nexode 65W charger:' && same(B4.r.codes,N65) && caveatOk(B4) && devOk(B4,'MacBook',true), txt(B4));
const B5=ask('robot gan 55w for iphone'), B6=ask('may robot gan 55w para sa iphone ba?'), B7=ask('may stock ba ng robot gan 55w para sa iphone?');
chk('B5 EN honest none sentence (facets may follow) + disclaimer', mode(B5)==='none' && !B5.r.codes.length && B5.r.note.indexOf('No Robot GaN 55W charger is listed in the current pricelist.')===0 && devOk(B5,'iPhone'), txt(B5));
chk('B6 TL honest none sentence + disclaimer', mode(B6)==='none' && !B6.r.codes.length && B6.r.note.indexOf('Walang naka-listang Robot GaN na 55W sa current pricelist.')===0 && devOk(B6,'iPhone',true), txt(B6));
chk('B7 TL stock none keeps the caveat + disclaimer', !B7.r.codes.length && B7.r.note.indexOf('Walang naka-listang Robot GaN na 55W sa current pricelist.')===0 && caveatOk(B7) && devOk(B7,'iPhone',true), txt(B7));
const B8=ask('robot gan 20w charger for iphone'), B9=ask('do you have nexode pro 30w for macbook?');
chk('B8 EN alternatives sentence; type word + named device stays a local catalogue question (was AI / web)', mode(B8)==='alternatives' && alt20(B8) &&
  B8.r.note==='No Robot GaN 20W charger is listed. Here are possible alternatives (not Robot GaN):' && devOk(B8,'iPhone') && local(B8), txt(B8));
chk('B9 alternatives never include a family member and stay at the asked wattage', mode(B9)==='alternatives' && B9.r.codes.length>0 && B9.r.codes.every(c=>W(c)===30 && CH(c) && PRO_ALL.indexOf(c)<0) &&
  B9.r.note==='No Nexode Pro 30W charger is listed. Here are possible alternatives (not Nexode Pro):' && devOk(B9,'MacBook'), txt(B9));
const B10=ask('nexode 65w pataas para sa laptop'), B11=ask('may nexode 65w pataas ba para sa macbook?');
chk('B10 EN range keeps the STOCK-6A "≥65W" label', mode(B10)==='exact' && same(B10.r.codes,NGE65) && B10.r.note===NGE65.length+' Nexode ≥65W chargers listed in the current pricelist:' && devOk(B10,'laptop'), txt(B10));
chk('B11 TL range keeps "65W pataas" after the noun', mode(B11)==='exact' && same(B11.r.codes,NGE65) && B11.r.note==='Meron — '+NGE65.length+' na Nexode charger na 65W pataas sa current pricelist:' && devOk(B11,'MacBook',true), txt(B11));
const B12=ask('how much is nexode 65w for macbook?'), B13=ask('magkano nexode 65w para sa macbook');
chk('B12 price question: exact set with prices, count sentence (no bare "Yes"), disclaimer', mode(B12)==='exact' && same(B12.r.codes,N65) && B12.r.fields.length>0 &&
  B12.r.note===N65.length+' Nexode 65W chargers listed in the current pricelist:' && devOk(B12,'MacBook') && local(B12), txt(B12));
chk('B13 TL price question', mode(B13)==='exact' && same(B13.r.codes,N65) && B13.r.fields.length>0 && B13.r.note===N65.length+' na Nexode 65W charger sa current pricelist:' && devOk(B13,'MacBook',true), txt(B13));
const B14=ask('is nexode 100w compatible with macbook pro?'), B15=ask('pwede ba ang robot gan 20w sa iphone?');
chk('B14 compatibility-worded question: exact set, LOCAL (was AI / clarify), never "Yes"', mode(B14)==='exact' && same(B14.r.codes,N100) && !/^(?:Yes|Meron|Oo)\b/.test(B14.r.note) &&
  B14.r.note===N100.length+' Nexode 100W charger'+(N100.length===1?'':'s')+' listed in the current pricelist:' && devOk(B14,'MacBook Pro') && local(B14), txt(B14));
chk('B15 TL compatibility-worded question with no family match → labelled alternatives, local', mode(B15)==='alternatives' && alt20(B15) && devOk(B15,'iPhone',true) && local(B15), txt(B15));
const B16=ask('robot gan 65w charger for iphone'), B17=ask('robot gan 65w for iphone');
chk('B16/B17 Robot GaN 65W with a named device (type word or not) → the 3 SKUs, owner sentence, local', same(B16.r.codes,L65) && same(B17.r.codes,L65) &&
  B16.r.note===L65.length+' Robot GaN 65W chargers listed in the current pricelist:' && B17.r.note===B16.r.note && devOk(B16,'iPhone') && devOk(B17,'iPhone') && local(B16) && local(B17), txt(B16)+' || '+txt(B17));

const B18=ask('how much is robot gan 55w for iphone?');
chk('B18 price question with no family match at the wattage → owner none sentence (price path), disclaimer', mode(B18)==='none' && !B18.r.codes.length && B18.r.note.indexOf('No Robot GaN 55W charger is listed in the current pricelist.')===0 && devOk(B18,'iPhone') && local(B18), txt(B18));

/* ---------- Z synthetic one-SKU name (no family modes): a compatibility-worded question stays local with the disclaimer line only ---------- */
const BASE=PUB.find(p=>CH(code(p)) && W(code(p))===30);
const ZP=PUB.concat([Object.assign({},BASE,{ item_code:'ZZS6B-01', model:'ZZ6B1', product_name:'Zentrix 30W USB-C Charger', description:'', features:'' })]);
const Z1=(()=>{ const r=E.answer(ZP,'pwede ba ang zentrix 30w sa iphone?',{}); const x={ q:'pwede ba ang zentrix 30w sa iphone? [synthetic]', r }; SEEN.push(x); return x; })();
chk('Z1 one-SKU name + wattage + device (not a family) → that SKU, LOCAL, disclaimer line, no duplicated inline clause', !fm(Z1) && same(Z1.r.codes,['ZZS6B-01']) && devOk(Z1,'iPhone',true) && local(Z1), txt(Z1));

/* ---------- G GaN Tech (two-way alias, STOCK-6A) with a device ---------- */
const G1=ask('gantech 65w for macbook'), G2=ask('may gantech 65w para sa laptop?'), G3=ask('gan tech 45w for macbook'), G4=ask('may stock ba ng gantech 65w para sa macbook?'), G5=ask('ilan ang gantech 65w para sa laptop?');
chk('G1 "gantech 65w for macbook" → the GaN Tech 65W set, owner sentence, local (was AI / web)', same(G1.r.codes,GT65) && G1.r.note===GT65.length+' GaN Tech 65W chargers listed in the current pricelist:' && devOk(G1,'MacBook') && local(G1), txt(G1));
chk('G2 device class (laptop): existence question → "Yes —" sentence for the alias family', same(G2.r.codes,GT65) && G2.r.note==='Yes — '+GT65.length+' GaN Tech 65W chargers listed in the current pricelist:' && devOk(G2,'laptop'), txt(G2));
chk('G3 no GaN Tech 45W → labelled 45W GaN alternatives (none named GaN Tech), owner alternatives sentence, local (was unlabelled "Matching products" via web)',
  G3.r.codes.length>0 && G3.r.codes.every(c=>W(c)===45 && CH(c) && GT.indexOf(c)<0) && G3.r.note==='No GaN Tech 45W charger is listed. Here are possible alternatives (not GaN Tech):' && devOk(G3,'MacBook') && local(G3), txt(G3));
chk('G4 TL stock sentence for the alias family + caveat', same(G4.r.codes,GT65) && G4.r.note==='Naka-lista sa current pricelist ang mga sumusunod na GaN Tech 65W charger:' && caveatOk(G4) && devOk(G4,'MacBook',true) && local(G4), txt(G4));
chk('G5 TL count sentence for the alias family', same(G5.r.codes,GT65) && G5.r.note===GT65.length+' na GaN Tech 65W charger sa current pricelist:' && devOk(G5,'laptop',true), txt(G5));

/* ---------- FR fix round 1 (QA / VERO round-1 findings) ---------- */
const FR1=[ask('nexode 65w for nintendo switch'),ask('may nexode 65w ba para sa nintendo switch?'),ask('robot gan 65w for nintendo switch'),ask('gantech 65w para sa nintendo switch'),ask('nexode 65w usb c for macbook')];
/* revised by NEW-P2R3A-STOCK-15 (owner D1 / D3, 2026-10-19): inside the family frame a normal single-type family answers as if the
   type word were typed (the 2 Nexode 65W / 3 Robot GaN 65W, USB-C kept, device disclaimer); the alias GaN Tech path keeps the
   afe146e3 device-fit clarify (D3 deferred) */
chk('FR1 (revised STOCK-15 D1/D3) a normal family + wattage + "nintendo switch" / "usb c for macbook" → the exact family set with the device disclaimer, local; the alias "gantech … nintendo switch" keeps the device-fit clarify, never "We don’t have / Wala"',
  [FR1[0],FR1[1],FR1[4]].every(x=>mode(x)==='exact' && same(x.r.codes,N65) && x.r.plan.devFamilyQ && local(x) && /^Note: /.test(x.r.compatNote||'')) && mode(FR1[2])==='exact' && same(FR1[2].r.codes,L65) && local(FR1[2]) &&
  FR1[0].r.compatNote===EN_NOTE('Nintendo Switch') && FR1[1].r.compatNote===TL_NOTE('Nintendo Switch') && /USB-C chargers listed/.test(FR1[4].r.note) &&
  !FR1[3].r.plan.devFamilyQ && !fm(FR1[3]) && FR1[3].r.plan.route.route==='CLARIFY' && !/We don’t have|Wala tayong|is listed|naka-lista/.test(FR1[3].r.note||''), FR1.map(txt).join(' || '));
const FR1b=ask('nexode 65w charger for nintendo switch');
chk('FR1b with the type word the same question resolves (the 2 Nexode 65W) with a disclaimer line', mode(FR1b)==='exact' && same(FR1b.r.codes,N65) && /^Note: Compatibility with your /.test(FR1b.r.compatNote||'') && local(FR1b), txt(FR1b));
const FR2a=ask('nexode 65w 2 ports for laptop'), FR2b=ask('may nexode 65w na 2 ports para sa laptop?'), FR2c=ask('nexode pro 30w 2 ports for macbook');
chk('FR2 the device none / alternatives sentences keep the port qualifier (never a wider "No Nexode 65W charger")',
  FR2a.r.note.indexOf('No Nexode 65W charger with 2 ports is listed in the current pricelist.')===0 && FR2b.r.note.indexOf('Walang naka-listang Nexode charger with 2 ports na 65W sa current pricelist.')===0 &&
  FR2c.r.note==='No Nexode Pro 30W charger with 2 ports is listed. Here are possible alternatives (not Nexode Pro):' && [FR2a,FR2b,FR2c].every(x=>/^Note: /.test(x.r.compatNote||'')), [FR2a,FR2b,FR2c].map(txt).join(' || '));
const FR3=[ask('will nexode 100w charge my macbook pro?'),ask('is robot gan 65w safe for macbook?'),ask('can the nexode 65w charge my macbook?')];
chk('FR3 "will it charge / safe for / can it charge" → count sentence, never a leading "Yes / Meron / Oo"', FR3.every(x=>fm(x) && !/^(?:Yes|Meron|Oo)\b/.test(x.r.note) && / listed in the current pricelist:$/.test(x.r.note) && local(x)) &&
  FR3[0].r.note===N100.length+' Nexode 100W charger'+(N100.length===1?'':'s')+' listed in the current pricelist:' && FR3[1].r.note===L65.length+' Robot GaN 65W chargers listed in the current pricelist:', FR3.map(txt).join(' || '));
const FR3b=ask('how much is gantech 65w for macbook?'), FR3c=ask('compatible ba ang gantech 65w sa macbook?'), FR3d=ask('is there stock of nexode 100w for macbook?');
chk('FR3b alias price / compatibility questions get the count sentence; EN stock singular reads "is"', same(FR3b.r.codes,GT65) && FR3b.r.note===GT65.length+' GaN Tech 65W chargers listed in the current pricelist:' &&
  same(FR3c.r.codes,GT65) && FR3c.r.note===GT65.length+' na GaN Tech 65W charger sa current pricelist:' && devOk(FR3c,'MacBook',true) &&
  (N100.length!==1 || FR3d.r.note==='The following Nexode 100W charger is listed in the current pricelist:') && caveatOk(FR3d), [FR3b,FR3c,FR3d].map(txt).join(' || '));
const FR3e=[ask('may nexode 65w charger para sa macbook?'),ask('do you have a robot gan 65w charger for iphone?')];
chk('FR3e existence question with a type word + named device stays an existence question ("Yes —"), not a device-fit question', FR3e.every(x=>x.r.plan.intent==='exist' && fm(x) && /^Yes — /.test(x.r.note) && local(x)) &&
  same(FR3e[0].r.codes,N65) && same(FR3e[1].r.codes,L65), FR3e.map(txt).join(' || '));
/* fix round 2 (FR5): the stated count describes the shown set — qualifiers stay in the sentence */
const NX20=at(NEX_ALL,'eq',20), FR5a=ask('nexode 20w 2 ports for iphone'), FR5b=ask('may nexode 20w na 2 ports para sa iphone?'), FR5c=ask('is there stock of nexode 20w 2 ports for iphone?');
chk('FR5 family path: ports qualifier kept in the count / existence / stock sentences (EN + TL), never "1 Nexode 20W charger" while '+NX20.length+' are listed',
  NX20.length>=2 && FR5a.r.codes.length>=1 && FR5a.r.codes.length<NX20.length && FR5a.r.note===FR5a.r.codes.length+' Nexode 20W charger'+(FR5a.r.codes.length===1?'':'s')+' with 2 ports listed in the current pricelist:' &&
  FR5b.r.note==='Meron — '+FR5b.r.codes.length+' na Nexode 20W charger with 2 ports sa current pricelist:' &&
  FR5c.r.note==='The following Nexode 20W charger'+(FR5c.r.codes.length===1?' with 2 ports is':'s with 2 ports are')+' listed in the current pricelist:' && caveatOk(FR5c), [FR5a,FR5b,FR5c].map(txt).join(' || '));
const GT30=at(GT,'eq',30), FR5d=ask('gantech 30w purple for iphone'), FR5e=ask('may gantech 30w with 2 ports ba para sa iphone'), FR5f=ask('gantech 65w 3 ports for macbook');
chk('FR5 alias path: colour / ports qualifiers kept ("1 GaN Tech 30W purple charger", "… with 2 ports", "… with 3 ports")',
  GT30.length>=2 && FR5d.r.codes.length<GT30.length && FR5d.r.note===FR5d.r.codes.length+' GaN Tech 30W purple charger'+(FR5d.r.codes.length===1?'':'s')+' listed in the current pricelist:' &&
  FR5e.r.note==='Meron — '+FR5e.r.codes.length+' na GaN Tech 30W charger with 2 ports sa current pricelist:' &&
  / with 3 ports listed in the current pricelist:$/.test(FR5f.r.note) && [FR5d,FR5e,FR5f].every(x=>/^Note: /.test(x.r.compatNote||'') && local(x)), [FR5d,FR5e,FR5f].map(txt).join(' || '));
const FR6=[ask('robot gan nexode 65w charger for macbook'),ask('gan tech 65w 100w charger for macbook')];
chk('FR6 guards: two family names, or two wattages, are not a STOCK-6B family question (device-fit clarify as on afe146e3, never "We don’t have")',
  FR6.every(x=>!x.r.plan.devFamilyQ && !fm(x) && x.r.plan.route.route==='CLARIFY' && !/We don’t have|Wala tayong/.test(x.r.note||'')), FR6.map(txt).join(' || '));
const FR4=ask('can i bring nexode 65w for macbook on a plane?');
chk('FR4 an external-facts question (airplane) is not a STOCK-6B catalogue question (existing WEB route kept)', !FR4.r.plan.devFamilyQ && FR4.r.plan.route.route==='WEB', txt(FR4));

/* ---------- C follow-ups price only the codes just shown ---------- */
const C1=chain(['nexode 65w for macbook','how much']), C2=chain(['may robot gan 20w para sa iphone ba?','magkano']), C3=chain(['gantech 65w for macbook','how much']), C4=chain(['may nexode 100w para sa macbook pro?','how much']);
chk('C1–C4 "how much" / "magkano" after a device answer prices exactly the shown codes', [C1,C2,C3,C4].every(c=>c[0].r.codes.length && same(c[1].r.codes,c[0].r.codes) && c[1].r.fields.length>0),
  [C1,C2,C3,C4].map(c=>txt(c[0])+' → '+txt(c[1])).join(' || '));

/* ---------- U unchanged controls (no device, or not a family + wattage question) ---------- */
const U1=ask('nexode 65w'), U2=ask('may robot gan 20w ba?'), U3=ask('gantech 45w'), U4=ask('gantech 65w'), U5=ask('65w charger for macbook'), U6=ask('may robot gan para sa iphone?'), U7=ask('recommend nexode 65w for macbook'), U8=ask('nexode charger for macbook');
chk('U1–U4 STOCK-2 / STOCK-6A wording without a device is unchanged and has no device disclaimer',
  U1.r.note===N65.length+' Nexode 65W chargers:' && U2.r.note==='Walang naka-listang Robot GaN na 20W. Mga 20W GaN charger na pwedeng alternatibo (hindi Robot GaN):' &&
  U3.r.note==='No GaN Tech 45W is listed. 45W GaN chargers you could offer instead (not GaN Tech):' && U4.r.note===GT65.length+' 65W GaN Tech chargers:' && [U1,U2,U3,U4].every(x=>!x.r.compatNote), [U1,U2,U3,U4].map(txt).join(' || '));
chk('U5–U8 no family name or no wattage, or a recommendation → not STOCK-6B (no family result, no disclaimer line; existing compatibility handling)',
  [U5,U6,U7,U8].every(x=>!fm(x) && !x.r.compatNote && !x.r.plan.devFamilyQ) && INLINE_COMPAT.test(U5.r.note) && U5.r.plan.intent==='compat', [U5,U6,U7,U8].map(txt).join(' || '));

/* ---------- R rendering (vero.js shows the disclaimer line, before the stock caveat) ---------- */
const VJ=fs.readFileSync(path.join(CODE,'js','vero.js'),'utf8'), iC=VJ.indexOf("if(r.compatNote){ out+='<p class=\"vero-fine\">'+e(r.compatNote)+'</p>'; }"), iS=VJ.indexOf('if(r.stockNote){');
chk('R1 the drawer renders res.compatNote as an escaped fine-print line before the stock caveat', iC>0 && iS>iC, 'compatNote at '+iC+', stockNote at '+iS);

/* ---------- I invariants over every answer in this file ---------- */
const DEV=SEEN.filter(x=>x.r.plan.devFamilyQ || (fm(x) && fm(x).device));
chk('I1 every stock question keeps the caveat; no answer states a quantity or stock state', SEEN.filter(x=>x.r.plan.flags.stock).every(caveatOk) && SEEN.every(x=>!FAKE_QTY.test(x.r.note||'')), SEEN.filter(x=>x.r.plan.flags.stock && !caveatOk(x)).map(txt).join(' || '));
chk('I2 every device family answer is LOCAL with the disclaimer line and no inline compatibility clause', DEV.length>=30 && DEV.every(x=>local(x) && /^Note: /.test(x.r.compatNote||'') && !INLINE_COMPAT.test(x.r.note||'')),
  DEV.filter(x=>!(local(x) && /^Note: /.test(x.r.compatNote||'') && !INLINE_COMPAT.test(x.r.note||''))).map(txt).join(' || '));
chk('I3 alternatives are never framed as exact or as device-compatible ("Yes / Meron / Oo", "compatible")', SEEN.every(x=>!(mode(x)==='alternatives' && (/^(?:Meron|Yes|Oo) —/.test(x.r.note) || /\bcompatible\b/i.test(x.r.note)))), '');
chk('I4 no answer claims compatibility: the disclaimer is the only place the device appears with "compatib…"', DEV.every(x=>!/\bcompatib/i.test(x.r.note||'')), DEV.filter(x=>/\bcompatib/i.test(x.r.note||'')).map(txt).join(' || '));
chk('I5 product names never rewritten; products.json untouched', JSON.stringify(PUB.map(p=>p.product_name))===NAMES_BEFORE && fs.readFileSync(path.join(ROOT,'data','products.json'),'utf8')===RAW);

console.log((MUTANT?'['+MUTANT+'] ':'')+'VERO NEW-P2R3A-STOCK-6B: '+pass+' passed, '+fail+' failed');

/* ===================== mutation tests ===================== */
if(!MUTANT){
  const M=[
    ['device guard restored (device questions unchanged again)','js/vero-plan.js',"var dev=!!(plan.flags.devices.named.length || plan.flags.devices.classes.length);","var dev=!!(plan.flags.devices.named.length || plan.flags.devices.classes.length); if(dev) return null;"],
    ['name members at the wattage with a device keep the old wording','js/vero-plan.js',"if(!dev || !R.codes.every(","if(true || !R.codes.every("],
    ['type word + named device turns into a device-fit question again','js/vero-plan.js',"&& !famWattQ){ I='compat';","){ I='compat';"],
    ['device family questions routed to AI / web again','js/vero-plan.js',"if(!plan.devFamilyQ && (I==='compat'","if((I==='compat'"],
    ['compatibility-worded device family questions not local','js/vero-plan.js',"|| (I==='compat' && plan.devFamilyQ)){","){"],
    ['compatibility-worded questions excluded from the family modes','js/vero-plan.js',"(dev && I==='compat' && plan.devFamilyQ) || ",""],
    ['typeless alias family ("gantech 65w") not recognised','js/vero-plan.js',"var wattFam=plan.type?plan.type.family:(npFam.length===1?npFam[0]:null);","var wattFam=plan.type?plan.type.family:null;"],
    ['device classes ("para sa laptop") excluded from the family question','js/vero-plan.js',"if((X.devices.named.length || X.devices.classes.length) && (famWattQ","if((X.devices.named.length) && (famWattQ"],
    ['disclaimer line removed','js/vero-compose.js',"if(devFam(plan,R) && res.type!=='clarify'){","if(false){"],
    ['EN disclaimer wording changed','js/vero-compose.js',"'Note: Compatibility with your '+dl+' is not confirmed by the available product information.'","'Compatible with your '+dl+'.'"],
    ['TL disclaimer wording changed','js/vero-compose.js',"'Note: Hindi pa confirmed ang compatibility sa '+dl+' mo base sa available product information.'","'Note: Compatible sa '+dl+' mo.'"],
    ['inline compatibility clause duplicated on none answers','js/vero-compose.js',"&& !devFam(plan,R)) res.note+=' '+T(lang,'compat',",") res.note+=' '+T(lang,'compat',"],
    ['inline compatibility clause duplicated on subject answers','js/vero-compose.js',"if((I==='compat'||I==='recommend') && !devFam(plan,R)){","if(I==='compat'||I==='recommend'){"],
    ['"Yes —" on list / price / compatibility questions (FR3 reverted)','js/vero-compose.js',"if(I==='exist') return tl?'Meron — '+n+' na '+dTl","if(true) return tl?'Meron — '+n+' na '+dTl"],
    ['alias path "Yes —" on non-existence questions (FR3 reverted)','js/vero-compose.js',"else if(I==='exist') res.note=lang==='tl'?'Meron — '+nD","else if(true) res.note=lang==='tl'?'Meron — '+nD"],
    ['no-type-word shortcut for any name (FR1 reverted)','js/vero-plan.js',"var npFam=npQ.length===1 && npQ[0].alias && !plan.form?","var npFam=npQ.length===1?"],
    ['other product form ignored by the alias shortcut','js/vero-plan.js',"&& npQ[0].alias && !plan.form?","&& npQ[0].alias?"],
    ['device none / alternatives / exact drop the qualifiers (FR2 + FR5 reverted)','js/vero-compose.js',"return q && q!==nounOf(LP,!!many)?q:'';","return '';"],
    ['device exact sentence drops the qualifiers (FR5 reverted)','js/vero-compose.js',"var dn=devQual(n!==1)||nounOf(LP,n!==1), d1=devQual(false)||nounOf(LP,false),","var dn=nounOf(LP,n!==1), d1=nounOf(LP,false),"],
    ['alias exact sentence drops the qualifiers (FR5 reverted)','js/vero-compose.js',"var eD=fD+' '+wE+' '+aqD(nD!==1);","var eD=fD+' '+wE+' '+nounOf(plan,nD!==1);"],
    ['two family names accepted as one family question','js/vero-plan.js',"var famWattQ=wattQ && !subject.length && npQ.length===1;","var famWattQ=wattQ && !subject.length && npQ.length>=1;"],
    ['two wattages accepted as one family question','js/vero-plan.js',"&& plan.filters.filter(function(f){ return f.attr==='watts'; }).length===1;\n    var famWattQ","&& plan.filters.filter(function(f){ return f.attr==='watts'; }).length>=1;\n    var famWattQ"],
    ['EN stock singular forced to "are"','js/vero-compose.js',"+dn+(n===1?' is':' are')+","+dn+' are'+"],
    ['external-facts guard removed','js/vero-plan.js',"I!=='recommend' && !X.external){ plan.devFamilyQ=true;","I!=='recommend'){ plan.devFamilyQ=true;"],
    ['device exact / alternatives fall back to the STOCK-6A sentences','js/vero-compose.js',"if(FM.device && (FM.mode==='exact' || FM.mode==='alternatives')){","if(false){"],
    ['device none falls back to "We don’t have …"','js/vero-compose.js',"if(FM && FM.device && !plan.catalogTotal && !plan.unknownNoun) res.note=famNoneDev();",""],
    ['price-path device none falls back','js/vero-compose.js',"res.note=FM.device?famNoneDev():(famRange","res.note=(famRange"],
    ['alias device alternatives keep the STOCK-6A sentence','js/vero-compose.js',"if(plan.devFamilyQ) res.note=lang==='tl'?'Walang naka-listang '+an","if(false) res.note=lang==='tl'?'Walang naka-listang '+an"],
    ['alias device exact keeps the generic list sentence','js/vero-compose.js',"else if(plan.devFamilyQ && !FM && !(R.droppedQualifiers||[]).length){","else if(false){"],
    ['TL range drops "pataas" after the noun','js/vero-compose.js',"dTl=famRange?famName+' '+d1+' na '+tw:","dTl=famRange?famName+' '+fw+' '+d1:"],
    ['alternatives labelled as exact ("Yes —")','js/vero-compose.js',"' is listed. Here are possible alternatives (not '+famName+'):'","' is listed. Yes — possible alternatives:'"],
    ['drawer no longer shows the disclaimer line','js/vero.js',"    if(r.compatNote){ out+='<p class=\"vero-fine\">'+e(r.compatNote)+'</p>'; }",""],
    ['stock caveat removed','js/vero-compose.js',"if(plan.flags.stock) res.stockNote=T(lang,plan.flags.invQty?'stockQty':'stock');",""],
  ];
  let killed=0;
  M.forEach(function(m,i){
    const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'stock6b-mut-')); fs.mkdirSync(path.join(tmp,'js'));
    fs.readdirSync(path.join(ROOT,'js')).forEach(f=>fs.copyFileSync(path.join(ROOT,'js',f),path.join(tmp,'js',f)));
    const fp=path.join(tmp,m[1]), src=fs.readFileSync(fp,'utf8');
    if(src.split(m[2]).length!==2){ console.log('FAIL - mutant M'+(i+1)+' anchor not found exactly once: '+m[0]); fail++; fs.rmSync(tmp,{ recursive:true, force:true }); return; }
    fs.writeFileSync(fp,src.replace(m[2],()=>m[3]));
    const r=cp.spawnSync(process.execPath,[__filename],{ env:Object.assign({},process.env,{ STOCK6B_CODE_ROOT:tmp, STOCK6B_MUTANT:'M'+(i+1) }), encoding:'utf8' });
    const out=(r.stdout||'')+(r.stderr||''), firstFail=(out.split('\n').filter(l=>/^FAIL/.test(l))[0]||out.split('\n').filter(Boolean).slice(-1)[0]||'').slice(0,140);
    if(r.status!==0){ killed++; pass++; console.log('PASS - mutant M'+(i+1)+' killed: '+m[0]+'  ['+firstFail+']'); }
    else { fail++; console.log('FAIL - mutant M'+(i+1)+' SURVIVED: '+m[0]); }
    fs.rmSync(tmp,{ recursive:true, force:true });
  });
  console.log('Mutants killed: '+killed+'/'+M.length);
  console.log('VERO NEW-P2R3A-STOCK-6B (cases + mutants): '+pass+' passed, '+fail+' failed');
}
process.exit(fail?1:0);
