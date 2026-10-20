/* VERO NEW-P2R3A-STOCK-15 (+ STOCK-16) (live p2r3a, on top of NEW-P2R3A-STOCK-1 / -2 / -6A / -6B) — the family frame.
   Run: node tests/vero-p2r3a-stock15.test.js        (cases, then the built-in mutants; exit 1 on any failure / survivor)
   Owner decisions (2026-10-19, audit Deliverables/VERO-Phase2/NEW-P2R3A-STOCK-15-Audit-2026-10-19.md §6):
     - the FAMILY FRAME = exactly one wattage + exactly one (non-alias) family name phrase whose named products are all one wattage
       type (charger / power bank) + no other product-form word once the device phrase is set aside. Inside it the family supplies
       the product type, so "nexode 65w usb c" / "… para sa switch" / "… for airpods" answer exactly like "nexode 65w charger …"
     - D1 revises STOCK-6B FR1 for normal single-type families ("nexode 65w for nintendo switch", "… usb c for macbook" → the exact
       family set with the device disclaimer); D3 keeps the GaN Tech alias path outside this checkpoint (FR1 clarify kept)
     - D2 "switch" is a device only with clear device context ("for switch", "para sa switch", "Nintendo Switch") and only inside the
       frame; never globally ("65w charger for switch", "hdmi switch", "nexode 65w switch" unchanged)
     - D4 AirPods and Apple Watch are device references only inside the frame (labels "AirPods", "Apple Watch"); genuine AirPods
       wireless-charger searches keep their answers
     - D5 an explicit USB-C requirement stays in the family sentence ("2 Nexode 65W USB-C chargers"); the shown codes carry USB-C in
       their product NAME (the existing connector filter) — no port, protocol or compatibility is inferred
     - safeguards: exact SKU matching kept; cable / hub / case / power-bank / wireless / car questions are never turned into charger
       answers by this change; never a compatibility claim (disclaimer line only); listing ≠ live stock (caveat, no quantity)
   Fix round 1 (owner-approved 2026-10-19, QA F1 / VERO N1): the frame's other-form guard is DERIVED, not a hand list — a leftover
     word blocks the frame when it is a lexicon word of a non-power type, a lexicon product form or display word, a product-NAME
     word found only outside chargers / power banks, a charger subtype or name-qualifier word ("wireless", "magnetic"), or any word
     that is neither a charger / power-bank name word nor a grammar / intent word ("kable", "hdd", "plug"); a non-power connector,
     an "A to B" pair, another resolved type or a typed subtype ("wireless charger") block it too; spec / colour words stay.
   Fix round 2 (owner-approved 2026-10-19, QA G1 / G2): the family type's own words ("chargers") are accepted; tests for the plural
     (EN / TL), "display", the particle "po" and USB-A, with their mutants.
   Equivalent mutants (documented, not tested): family type also for mixed-type families — no family name phrase on current data
   spans two wattage types, so the frame's single-type check cannot change an answer today; the guard's "another resolved type /
   typed subtype" check removed — over every lexicon alias term it never decides alone (the word rules already block), kept as
   defence in depth for future lexicon additions.
   Not in scope (separate tickets): the GaN Tech alias residuals (D3) and the pre-existing family + wattage + other-form false yes
   ("nexode 20w case" → 20W chargers) — pinned here as UNCHANGED only.
   Expectations are DERIVED from data/products.json (names, the connector named in the product name, the same explicit
   description-evidence oracle as STOCK-6A / 6B) and from the typed-"charger" form of each question. */
const fs=require('fs'), path=require('path'), os=require('os'), cp=require('child_process');
const ROOT=path.join(__dirname,'..'), CODE=process.env.STOCK15_CODE_ROOT||ROOT, MUTANT=process.env.STOCK15_MUTANT||'';
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
const usbc=c=>{ const f=IDX.byCode[c]; return !!f && f.attrs.connectors.named.indexOf('usb_c')>=0; };
const STOCK_CAVEAT=/live inventory/i;
const FAKE_QTY=/\b\d+\s*(?:pcs|pieces|piraso|units?|stocks?|left|remaining|natitira|available)\b|\b(?:in stock|out of stock|available ngayon|may stock pa|ubos na|sold out)\b/i;
const caveatOk=x=>STOCK_CAVEAT.test(x.r.stockNote||'') && !FAKE_QTY.test(x.r.note||'') && !FAKE_QTY.test(x.r.stockNote||'');
const EN_NOTE=d=>'Note: Compatibility with your '+d+' is not confirmed by the available product information.';
const TL_NOTE=d=>'Note: Hindi pa confirmed ang compatibility sa '+d+' mo base sa available product information.';
const norm=s=>' '+String(s).toLowerCase().replace(/gantech/g,'gan tech').replace(/\s+/g,' ')+' ';
const desc=p=>String(p.description||'')+' '+(Array.isArray(p.features)?p.features.join(' '):String(p.features||''));
const code=p=>String(p.item_code), CH=c=>fam(c)==='charger';
const local=x=>x.r.plan.route.route==='LOCAL' && !x.r.needsAI;
const noDev=x=>!x.r.compatNote && !x.r.plan.flags.devices.named.some(d=>/airpods|apple watch|^switch$/.test(d.label));

/* ---------- derived fixtures (independent of the module; same oracle as tests/vero-p2r3a-stock6b.test.js) ---------- */
function evOracle(phrase,nameSet){ const f=phrase.split(' ').join(' ?');
  return PUB.filter(p=>nameSet.indexOf(code(p))<0 && CH(code(p))).filter(p=>{ const t=norm(desc(p)), w=W(code(p));
    const mW=t.match(new RegExp('[^a-z0-9](?:ugreen )?'+f+' (?:(?:pro|air|mini|max|series) )?(\\d+)w(?![a-z0-9])')); if(mW && w && +mW[1]===w) return true;
    return new RegExp('[^a-z0-9](?:ugreen )?'+f+' (?:(?:pro|air|mini|max|series) )?(?:\\d+w )?(?:usb[- ]?c )?(?:usb[- ]?c )?(?:fast |wall |desktop |gan )*charger(?![a-z0-9])').test(t); }).map(code); }
const byName=re=>PUB.filter(p=>re.test(String(p.product_name).replace(/gantech/ig,'GaN Tech').replace(/\s+/g,' '))).map(code);
const NEX_NAME=byName(/(^|[^a-z0-9])nexode([^a-z0-9]|$)/i), NEX_ALL=NEX_NAME.concat(evOracle('nexode',NEX_NAME)).filter(CH);
const LINE=byName(/(^|[^a-z0-9])robot gan([^a-z0-9]|$)/i).filter(CH);
const AIRPODS_NAMED=byName(/(^|[^a-z0-9])airpods([^a-z0-9]|$)/i);
const at=(set,w)=>set.filter(c=>W(c)===w);
const N65=at(NEX_ALL,65), N20=at(NEX_ALL,20), L65=at(LINE,65), N65C=N65.filter(usbc);
chk('F0 fixtures: Nexode 65W (description members) and 20W, Robot GaN 65W exist; the Nexode 65W have USB-C in the name; AirPods-named chargers exist (else this test proves nothing)',
  N65.length>=2 && N20.length>=2 && L65.length>=2 && N65C.length===N65.length && AIRPODS_NAMED.length>=2 && AIRPODS_NAMED.every(CH) && !NEX_NAME.some(c=>W(c)===65),
  'N65 '+N65+' | N20 '+N20+' | L65 '+L65+' | AirPods '+AIRPODS_NAMED);

/* ---------- A the reproduced false negatives (live 1bd1c6e8) ---------- */
const A1=ask('nexode 20w for airpods'), A2=ask('may nexode 65w para sa switch?'), A3=ask('how many robot gan 65w for nintendo switch'),
  A4=ask('nexode 65w type c para sa laptop'), A5=ask('nexode 65w usb c'), A6=ask('nexode 65w for nintendo switch'), A7=ask('nexode 65w usb c for macbook');
chk('A1 "nexode 20w for airpods" → the Nexode 20W set (not the AirPods-named 45023 alternative), AirPods disclaimer, local',
  mode(A1)==='exact' && same(A1.r.codes,N20) && A1.r.note===N20.length+' Nexode 20W chargers listed in the current pricelist:' && A1.r.compatNote===EN_NOTE('AirPods') && local(A1), txt(A1));
chk('A2 "may nexode 65w para sa switch?" → "Yes —" the Nexode 65W set, Switch disclaimer (was "We don’t have a 65W switch")',
  mode(A2)==='exact' && same(A2.r.codes,N65) && A2.r.note==='Yes — '+N65.length+' Nexode 65W chargers listed in the current pricelist:' && A2.r.compatNote===EN_NOTE('Switch') && local(A2), txt(A2));
chk('A3 "how many robot gan 65w for nintendo switch" → the Robot GaN 65W count (was "0 —"), Nintendo Switch disclaimer',
  mode(A3)==='exact' && same(A3.r.codes,L65) && A3.r.note===L65.length+' Robot GaN 65W chargers listed in the current pricelist:' && A3.r.compatNote===EN_NOTE('Nintendo Switch') && local(A3), txt(A3));
chk('A4 "nexode 65w type c para sa laptop" → the Nexode 65W USB-C set, USB-C kept in the sentence (D5), laptop disclaimer',
  mode(A4)==='exact' && same(A4.r.codes,N65C) && A4.r.note===N65C.length+' Nexode 65W USB-C chargers listed in the current pricelist:' && A4.r.compatNote===EN_NOTE('laptop'), txt(A4));
chk('A5 STOCK-16 "nexode 65w usb c" (no device) → the Nexode 65W USB-C set, USB-C kept (D5), no disclaimer',
  mode(A5)==='exact' && same(A5.r.codes,N65C) && A5.r.note===N65C.length+' Nexode 65W USB-C chargers:' && !A5.r.compatNote && local(A5), txt(A5));
chk('A6/A7 D1: "nexode 65w for nintendo switch" and "nexode 65w usb c for macbook" → exact family set + disclaimer (was the device-fit clarify)',
  mode(A6)==='exact' && same(A6.r.codes,N65) && A6.r.compatNote===EN_NOTE('Nintendo Switch') && mode(A7)==='exact' && same(A7.r.codes,N65C) && A7.r.compatNote===EN_NOTE('MacBook') && local(A6) && local(A7), [A6,A7].map(txt).join(' || '));

/* ---------- B labels, Taglish, price / stock / follow-ups ---------- */
const B1=ask('nexode 20w for apple watch'), B2=ask('nexode 20w for airpods pro'), B3=ask('may nexode 65w ba para sa nintendo switch?'), B4=ask('ilan ang nexode 65w type c?'),
  B5=ask('robot gan 65w para sa switch ba?'), B6=ask('may nexode 65w usb c ba?'), B7=ask('is there stock of nexode 20w for airpods?'), B8=ask('magkano nexode 65w para sa switch');
chk('B1/B2 D4 device labels: "Apple Watch" (not the ecosystem word "apple"), "AirPods Pro"', B1.r.compatNote===EN_NOTE('Apple Watch') && same(B1.r.codes,N20) && B2.r.compatNote===EN_NOTE('AirPods Pro') && same(B2.r.codes,N20), [B1,B2].map(txt).join(' || '));
chk('B3 TL existence + Nintendo Switch (FR1 revised): "Meron —" + TL disclaimer', same(B3.r.codes,N65) && B3.r.note==='Meron — '+N65.length+' na Nexode 65W charger sa current pricelist:' && B3.r.compatNote===TL_NOTE('Nintendo Switch'), txt(B3));
chk('B4/B6 TL count / existence with USB-C keep the connector (D5)', B4.r.note===N65C.length+' na Nexode 65W USB-C charger sa current pricelist:' && same(B4.r.codes,N65C) && B6.r.note==='Meron — '+N65C.length+' na Nexode 65W USB-C charger sa current pricelist:' && same(B6.r.codes,N65C), [B4,B6].map(txt).join(' || '));
chk('B5 TL "para sa switch ba?" → the Robot GaN 65W set + TL Switch disclaimer', same(B5.r.codes,L65) && B5.r.compatNote===TL_NOTE('Switch') && local(B5), txt(B5));
chk('B7 stock question: "listed" sentence + no-live-inventory caveat, never a quantity; AirPods disclaimer', same(B7.r.codes,N20) && /^The following Nexode 20W chargers are listed in the current pricelist:$/.test(B7.r.note) && caveatOk(B7) && B7.r.compatNote===EN_NOTE('AirPods'), txt(B7));
/* a "magkano" question without a subject answers like its typed "… charger …" form (the family set as a list; the missing price
   line on typed family questions is pre-existing on 1bd1c6e8 and not part of this checkpoint) */
const B8t=ask('magkano nexode 65w charger para sa switch');
chk('B8 "magkano nexode 65w para sa switch" → the family set + TL Switch disclaimer, same intent / codes as the typed form (was a false none)', same(B8.r.codes,N65) && mode(B8)==='exact' && B8.r.plan.intent===B8t.r.plan.intent && same(B8.r.codes,B8t.r.codes) && B8.r.compatNote===TL_NOTE('Switch') && local(B8), [B8,B8t].map(txt).join(' || '));
const C1=chain(['nexode 20w for airpods','magkano?']), C2=chain(['may nexode 65w para sa switch?','how much']);
chk('B9 follow-ups price exactly the shown family codes', same(C1[1].r.codes,N20) && same(C2[1].r.codes,N65) && (C1[1].r.fields||[]).length>0, [C1[1],C2[1]].map(txt).join(' || '));

/* ---------- O the typed-"charger" oracle: inside the frame the type word changes nothing ---------- */
const OF=['nexode','robot gan','nexode pro','nexode mini'], OW=['20w','30w','45w','65w','100w'], OT=['for airpods','for airpods pro','para sa switch','for nintendo switch','for apple watch','usb c','type c para sa laptop','usb c for iphone'];
const odiff=[]; let on=0;
OF.forEach(f=>OW.forEach(w=>OT.forEach(t=>{ const conn=/^(usb c|type c)/.exec(t), rest=conn?t.slice(conn[0].length).trim():t;
  const qa=f+' '+w+' '+t, qb=f+' '+w+(conn?' '+conn[0]:'')+' charger'+(rest?' '+rest:''); const a=E.answer(PUB,qa,{}), b=E.answer(PUB,qb,{}); on++;
  if(!same(a.codes||[],b.codes||[]) || (a.compatNote||'')!==(b.compatNote||'') || a.plan.route.route!=='LOCAL') odiff.push(qa+' => '+(a.codes||[]).join(',')+' vs '+qb+' => '+(b.codes||[]).join(',')); })));
chk('O1 '+OF.length*OW.length*OT.length+' frame questions: same codes, same disclaimer and LOCAL as the typed "… charger …" form (no false none, no wrong set)', on===OF.length*OW.length*OT.length && !odiff.length, odiff.slice(0,4).join(' || '));

/* ---------- U unchanged outside the frame (D2 / D4 / safeguards) ---------- */
const U1=[ask('charger for airpods'),ask('wireless charger for airpods'),ask('may charger for airpods ba?'),ask('airpods'),ask('magkano airpods')];
chk('U1 D4 genuine AirPods searches keep the AirPods-named wireless chargers, no device reading, no disclaimer', U1.every(x=>same(x.r.codes,AIRPODS_NAMED) && noDev(x) && !x.r.plan.famFrame && local(x)), U1.map(txt).join(' || '));
const U2=ask('20w charger for airpods');
chk('U2 "20w charger for airpods" (no family) keeps the AirPods-named 20W charger(s) only', U2.r.codes.length>=1 && U2.r.codes.every(c=>AIRPODS_NAMED.indexOf(c)>=0 && W(c)===20) && noDev(U2), txt(U2));
const U3=[ask('65w charger for switch'),ask('magkano 65w charger para sa switch'),ask('20w charger para sa switch')];
chk('U3 D2 "switch" is not reinterpreted without a family frame: plain LOCAL lists, no Switch device, no disclaimer', U3.every(x=>local(x) && noDev(x) && !x.r.plan.famFrame && x.r.codes.length>0 && x.r.codes.every(CH)), U3.map(txt).join(' || '));
const U4=[ask('hdmi switch'),ask('4 port switch'),ask('nexode 65w switch'),ask('kvm switch for airpods')];
chk('U4 product switches and "nexode 65w switch" (no device context) never become a family frame or a Switch device', U4.every(x=>!x.r.plan.famFrame && noDev(x)) && !U4[2].r.codes.some(CH), U4.map(txt).join(' || '));
const PF=['cable','usb c cable','hub','usb c hub','power bank','dock','adapter','wireless charger','car charger','extender'], pfBad=[];
['nexode 65w','nexode 20w','robot gan 65w'].forEach(f=>PF.forEach(k=>['', ' for airpods',' para sa switch',' for nintendo switch'].forEach(t=>{ const x=ask(f+' '+k+t);
  if(x.r.plan.famFrame || mode(x)==='exact' && !/charger/.test(k) || (!/charger/.test(k) && x.r.codes.some(CH))) pfBad.push(txt(x)); })));
chk('U5 safeguard: cable / hub / power bank / dock / adapter / extender / wireless / car questions are never a family frame and never answered with chargers by it', !pfBad.length, pfBad.slice(0,3).join(' || '));
/* fix round 1 (owner-approved 2026-10-19, QA F1 / VERO N1): the guard is DERIVED (lexicon words of non-power types, product-name
   words found only outside chargers / power banks, unknown words, non-power connectors, "A to B" pairs) — so accessory and Taglish
   words that no hand list names keep the question out of the frame; with a "switch" device tail they never become a charger answer */
const ACC=['kable','cord','wire','cover','pouch','sleeve','bag','grip','controller','ssd','card','screen protector','tempered glass','film','strap','band','skin','mount','sticker','kit','brick','station','keyboard','speaker','stylus','monitor','mouse','headset','earphones','hdmi','ethernet','usb c to lightning','usb a to usb c','usb c to usb c','displayport','thunderbolt','tf','hdd','plug','wireless','magnetic','car','slim','display'], accBad=[];
['nexode 65w','nexode 20w','robot gan 65w'].forEach(f=>ACC.forEach(k=>['',' for airpods',' para sa switch',' for nintendo switch',' for apple watch'].forEach(t=>{ const x=ask(f+' '+k+t);
  if(x.r.plan.famFrame || (/switch$/.test(t) && (x.r.codes.some(CH) || /^(?:Yes|Meron) —/.test(x.r.note||'')))) accBad.push(txt(x)); })));
['may nexode 65w kable ba para sa switch?','ilan ang nexode 65w screen protector para sa switch?'].forEach(q=>{ const x=ask(q); if(x.r.plan.famFrame || x.r.codes.some(CH) || /^(?:Yes|Meron) —/.test(x.r.note||'')) accBad.push(txt(x)); });
{ const x=ask('may nexode 20w cover ba para sa airpods?'); if(x.r.plan.famFrame || /^(?:Yes|Meron) —/.test(x.r.note||'') || x.r.compatNote) accBad.push(txt(x)); }   /* outside the frame: the pre-existing 1bd1c6e8 answer (labelled 45023 alternative) is kept */
chk('U5b fix round 1: '+(ACC.length*15+3)+' accessory / cable / Taglish "kable" / non-power-connector questions are never a family frame; with a switch tail never a charger answer or "Yes / Meron"', !accBad.length, accBad.slice(0,4).join(' || '));
const Q1=ask('nexode 65w 3 ports para sa switch'), Q2=ask('nexode 65w 1m for switch'), Q3=ask('nexode 20w for airpods max');
chk('U5c qualifiers stay inside the frame (ports / length / device-line suffix): "3 ports" → the 3-port Nexode 65W only, "1m" → the 1m one', Q1.r.plan.famFrame && Q1.r.codes.length>=1 && Q1.r.codes.every(c=>N65.indexOf(c)>=0) && Q1.r.compatNote===EN_NOTE('Switch') && Q2.r.plan.famFrame && Q2.r.codes.length>=1 && Q2.r.codes.every(c=>N65.indexOf(c)>=0) && Q3.r.plan.famFrame && Q3.r.compatNote===EN_NOTE('AirPods Max') && same(Q3.r.codes,N20), [Q1,Q2,Q3].map(txt).join(' || '));
/* fix round 2 (owner-approved 2026-10-19, QA G1 / G2): the family type's own plural word, polite particles and USB-A stay inside the frame */
const P1=ask('nexode 65w chargers for airpods'), P2=ask('how many nexode 65w chargers for airpods'), P3=ask('ilan ang nexode 65w chargers para sa airpods'), P4=ask('nexode 65w po para sa switch sir'), P5=ask('nexode 65w usb a');
chk('U5d plural "chargers" (EN / TL), the particle "po", the filler "sir" and USB-A stay in the frame: the family set (USB-A only where the product NAME carries it), device disclaimer, never the live false "We don’t have … chargers"',
  [P1,P2,P3,P4].every(x=>x.r.plan.famFrame && same(x.r.codes,N65) && local(x)) && P1.r.compatNote===EN_NOTE('AirPods') && P3.r.compatNote===TL_NOTE('AirPods') && P4.r.compatNote===TL_NOTE('Switch') &&
  P5.r.plan.famFrame && P5.r.codes.length>=1 && P5.r.codes.every(c=>N65.indexOf(c)>=0 && IDX.byCode[c].attrs.connectors.named.indexOf('usb_a')>=0) && [P1,P2,P3].every(x=>!/We don’t have|Wala tayong/.test(x.r.note||'')), [P1,P2,P3,P4,P5].map(txt).join(' || '));
const U6=[ask('gantech 65w para sa nintendo switch'),ask('gan tech 65w for nintendo switch')];
chk('U6 D3 the GaN Tech alias path is outside this checkpoint: device-fit clarify kept, no frame', U6.every(x=>!x.r.plan.famFrame && !fm(x) && x.r.plan.route.route==='CLARIFY'), U6.map(txt).join(' || '));
const U7=[ask('nexode 20w 65w for airpods'),ask('nexode robot gan 65w para sa switch')];
chk('U7 two wattages or two family names are not a frame', U7.every(x=>!x.r.plan.famFrame), U7.map(txt).join(' || '));
const U8=ask('nexode 20w case'), U8b=ask('nexode 20w case for airpods');
chk('U8 pre-existing other-form false yes ("case", separate ticket) is not extended: no frame, no AirPods device', !U8.r.plan.famFrame && !U8b.r.plan.famFrame && noDev(U8b), [U8,U8b].map(txt).join(' || '));
/* "55527 for airpods" (a SKU + the AirPods name word, no wattage) is a pre-existing false none on 1bd1c6e8 outside the frame —
   recorded as its own finding, not changed here */
const X1=ask('magkano 55527'), X2=ask('55527 for iphone'), X3=ask('25870 for nintendo switch'), X4=ask('may 55527 ba para sa switch?');
chk('X1 exact SKU matching preserved: SKU questions answer that SKU only and never become a family frame', same(X1.r.codes,['55527']) && same(X2.r.codes,['55527']) && same(X3.r.codes,['25870']) && same(X4.r.codes,['55527']) && [X1,X2,X3,X4].every(x=>!x.r.plan.famFrame), [X1,X2,X3,X4].map(txt).join(' || '));

/* ---------- I invariants over every answer in this file ---------- */
const FR=SEEN.filter(x=>x.r.plan.famFrame && (x.r.plan.flags.devices.named.length || x.r.plan.flags.devices.classes.length));
chk('I1 every stock question keeps the caveat; no answer states a quantity or stock state', SEEN.filter(x=>x.r.plan.flags.stock).every(caveatOk) && SEEN.every(x=>!FAKE_QTY.test(x.r.note||'')), SEEN.filter(x=>x.r.plan.flags.stock && !caveatOk(x)).map(txt).join(' || '));
const FRbad=FR.filter(x=>!(local(x) && /^Note: /.test(x.r.compatNote||'') && !/\bcompatib/i.test(x.r.note||'')));
chk('I2 every frame + device answer is LOCAL with the disclaimer line and never claims compatibility in the sentence ('+FR.length+' answers; the O1 oracle covers '+on+' more)', FR.length>=12 && !FRbad.length, FRbad.slice(0,4).map(txt).join(' || '));
chk('I3 product names never rewritten; products.json untouched', JSON.stringify(PUB.map(p=>p.product_name))===NAMES_BEFORE && fs.readFileSync(path.join(ROOT,'data','products.json'),'utf8')===RAW);

console.log((MUTANT?'['+MUTANT+'] ':'')+'VERO NEW-P2R3A-STOCK-15: '+pass+' passed, '+fail+' failed');

/* ===================== mutation tests ===================== */
if(!MUTANT){
  const M=[
    ['frame without the leftover-word guard','js/vero-plan.js',"&& famN.length===1 && frameLeftoverOk(tFo,famN[0].text,idx.byCode[famN[0].codes[0]].type.family,X,c,products,idx);","&& famN.length===1;"],
    ['guard: unknown words admitted ("kable", "brick")','js/vero-plan.js',"return !!FW.gram[w]; });","return true; });"],
    ['guard: any lexicon vocabulary admitted ("hdd", "plug")','js/vero-plan.js',"return !!FW.gram[w]; });","return !!(FW.gram[w] || c.vocab[w] || c.nameGeneric[w]); });"],
    ['guard: charger subtype words admitted ("wireless", "car")','js/vero-plan.js',"if(POWER[f.id]) (f.subtypes||[]).forEach(function(s){ if(s.id!=='wall') words(s.label,lex); });","if(false) (f.subtypes||[]).forEach(function(s){ if(s.id!=='wall') words(s.label,lex); });"],
    ['guard: name qualifiers admitted ("magnetic", "slim")','js/vero-plan.js',"Object.keys(c.L.nameQualifiers||{}).forEach(function(w){ words(w,lex); });",""],
    ['guard: non-power product-NAME words admitted ("cover", "pouch")','js/vero-plan.js',"if(FW.names[w]) return (FW.names[w]&1)===1;","if(FW.names[w]) return true;"],
    ['guard: lexicon words of other product types admitted','js/vero-plan.js',"if(FW.lex[w]) return false;",""],
    ['guard: non-power connectors / "A to B" pairs admitted','js/vero-plan.js',"if(X.pair || X.connectors.some(function(k){ return k.k!=='usb_c' && k.k!=='usb_a'; })) return false;",""],
    ['guard: spec / colour words block the frame ("3 ports")','js/vero-plan.js',"if(FW.spec[w]) return true;",""],
    ['guard: device class words ("laptop") block the frame','js/vero-plan.js',"c.L.devices.classes[k].forEach(function(w){ tFo=","c.L.devices.classes[k].forEach(function(w){ tFo=tFo||"],
    ['guard: the family type own words ("chargers") block the frame','js/vero-plan.js',"if((FW.own[famType]||{})[w]) return true;",""],
    ['guard: display words admitted ("display")','js/vero-plan.js',"(c.L.displayWords||[]).forEach(function(x){ words(x,lex); });",""],
    ['guard: conversation fillers block the frame ("sir")','js/vero-plan.js',"[c.L.smalltalkFiller,c.L.followUpCues,c.L.topicSwitchCues,c.L.inventoryWords,c.L.taglishMarkers,","[[],[],[],[],[],"],
    ['guard: USB-A treated as a non-power connector','js/vero-plan.js',"return k.k!=='usb_c' && k.k!=='usb_a'; })) return false;","return k.k!=='usb_c'; })) return false;"],
    ['guard: device-line words left in ("apple watch" → "watch")','js/vero-plan.js',"if(dLine) dLine.w.split(' ').concat(['pro','max','ultra','se']).forEach(","if(false) dLine.w.split(' ').concat(['pro','max','ultra','se']).forEach("],
    ['family type step removed (STOCK-16 back)','js/vero-plan.js',"if(plan.famFrame && !plan.type && !subject.length){","if(false){"],
    ['family type for alias names too (D3 breached)','js/vero-plan.js',"var famN=names.filter(function(n){ if(n.alias || lineOf(n.text)) return false;","var famN=names.filter(function(n){ if(lineOf(n.text)) return false;"],
    ['device lines read as devices outside the frame (D4 breached)','js/vero-plan.js',"    if(plan.famFrame){\n      if(dLine){","    if(true){\n      if(dLine){"],
    ['device lines never devices (AirPods stays a name filter)','js/vero-plan.js',"      if(dLine){ var dm=","      if(false){ var dm="],
    ['"for switch" device outside the frame (D2 breached)','js/vero-plan.js',"    if(plan.famFrame){\n      if(dLine){","    if(plan.famFrame || /switch/.test(X.t)){\n      if(dLine){"],
    ['"for switch" never a device','js/vero-plan.js',"X.devices.named.push({ kind:'console', label:'switch' });",""],
    ['two wattages accepted as a frame','js/vero-plan.js',"plan.famFrame=X.filters.filter(function(f){ return f.attr==='watts'; }).length===1 &&","plan.famFrame=X.filters.filter(function(f){ return f.attr==='watts'; }).length>=1 &&"],
    ['two family names accepted as a frame','js/vero-plan.js',"&& famN.length===1 && frameLeftoverOk(","&& famN.length>=1 && frameLeftoverOk("],
    ['D5 connector dropped from the family sentence','js/vero-compose.js',"var cq=function(many){ return devQual(many)||nounOf(LP,many); }","var cq=function(many){ return nounOf(LP,many); }"],
    ['D4 AirPods casing removed','js/vero-compose.js',"DEV_CASE.airpods='AirPods';",""],
    ['D4 Apple Watch label falls back to "apple"','js/vero-plan.js',"X.devices.named=X.devices.named.filter(function(d){ return dlab.indexOf(d.label)!==0; }); X.devices.named.unshift(","X.devices.named.push("],
    ['lexicon device lines removed','js/vero-lexicon.js',"lines:{ audio:['airpods'], wearable:['apple watch'] },","lines:{},"],
  ];
  let killed=0;
  M.forEach(function(m,i){
    const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'stock15-mut-')); fs.mkdirSync(path.join(tmp,'js'));
    fs.readdirSync(path.join(ROOT,'js')).forEach(f=>fs.copyFileSync(path.join(ROOT,'js',f),path.join(tmp,'js',f)));
    const fp=path.join(tmp,m[1]), src=fs.readFileSync(fp,'utf8');
    if(src.split(m[2]).length!==2){ console.log('FAIL - mutant M'+(i+1)+' anchor not found exactly once: '+m[0]); fail++; fs.rmSync(tmp,{ recursive:true, force:true }); return; }
    fs.writeFileSync(fp,src.replace(m[2],()=>m[3]));
    const r=cp.spawnSync(process.execPath,[__filename],{ env:Object.assign({},process.env,{ STOCK15_CODE_ROOT:tmp, STOCK15_MUTANT:'M'+(i+1) }), encoding:'utf8' });
    const out=(r.stdout||'')+(r.stderr||''), firstFail=(out.split('\n').filter(l=>/^FAIL/.test(l))[0]||out.split('\n').filter(Boolean).slice(-1)[0]||'').slice(0,140);
    if(r.status!==0){ killed++; pass++; console.log('PASS - mutant M'+(i+1)+' killed: '+m[0]+'  ['+firstFail+']'); }
    else { fail++; console.log('FAIL - mutant M'+(i+1)+' SURVIVED: '+m[0]); }
    fs.rmSync(tmp,{ recursive:true, force:true });
  });
  console.log('Mutants killed: '+killed+'/'+M.length);
  console.log('VERO NEW-P2R3A-STOCK-15 (cases + mutants): '+pass+' passed, '+fail+' failed');
}
process.exit(fail?1:0);
