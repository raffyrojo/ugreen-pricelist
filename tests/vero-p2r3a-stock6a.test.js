/* VERO NEW-P2R3A-STOCK-6A (live p2r3a, on top of NEW-P2R3A-STOCK-1 + -2) — family + wattage outside the STOCK-2 scope guards.
   Run: node tests/vero-p2r3a-stock6a.test.js        (cases, then the built-in mutants; exit 1 on any failure / survivor)
   Owner decisions S6-1 … S6-4 (2026-10-16, docs/DECISIONS.md; audit Deliverables/VERO-Phase2/NEW-P2R3A-STOCK-6-Audit-2026-10-16.md):
     S6-1 a single-SKU NAME family ("Nexode Pro" = one SKU by name) resolves when explicit description evidence adds >= 1 member
          (same strict rule as STOCK-2 O1), shown "per product description"; a single SKU with no description member is unchanged
     S6-2 GaNTech ≡ GaN Tech is two-way: a typed "gantech" / "gan tech" names the products whose NAME carries the phrase in either
          form (matching only; names and query text never rewritten; plain "gan" stays the GaN feature)
     S6-3 count questions answer with the count of the exact set; stock-worded counts keep "listed" + the no-live-inventory caveat
          and never a stock quantity; zero → labelled alternatives / honest none, never "0 — Wala" while alternatives exist
     S6-4 wattage ranges (≥ / > / ≤ / < / between) use the same exact / alternatives / none modes, inclusive like the filters
   Unchanged (STOCK-6B … 6D): device-named questions, model anchors, mixed-type families, sub-line words.
   Expectations are DERIVED from data/products.json; synthetic in-memory SKUs (prefix ZZS6-) test the single-SKU boundary. */
const fs=require('fs'), path=require('path'), os=require('os'), cp=require('child_process');
const ROOT=path.join(__dirname,'..'), CODE=process.env.STOCK6A_CODE_ROOT||ROOT, MUTANT=process.env.STOCK6A_MUTANT||'';
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
function chain(qs,P){ let conv=null; return qs.map(q=>{ const r=E.answer(P||PUB,q,{ conv }); if(r.ctxOut) conv=r.ctxOut; const x={ q, r }; SEEN.push(x); return x; }); }
const fm=x=>x.r.plan.result && x.r.plan.result.family, mode=x=>fm(x)?fm(x).mode:'';
const txt=x=>x.q+' => ['+x.r.plan.intent+(mode(x)?' '+mode(x):'')+'] '+(x.r.note||'')+' | '+(x.r.codes||[]).join(',');
const S=a=>JSON.stringify([...a].map(String).sort()), same=(a,b)=>S(a)===S(b);
const W=(c,I)=>{ const f=(I||IDX).byCode[c]; return f?f.attrs.watts.value:undefined; }, fam=(c,I)=>{ const f=(I||IDX).byCode[c]; return f?f.type.family:undefined; };
const STOCK_CAVEAT=/live inventory/i;
const FAKE_QTY=/\b\d+\s*(?:pcs|pieces|piraso|units?|stocks?|left|remaining|natitira|available)\b|\b(?:in stock|out of stock|available ngayon|may stock pa|ubos na|sold out)\b/i;
const caveatOk=x=>STOCK_CAVEAT.test(x.r.stockNote||'') && !FAKE_QTY.test(x.r.note||'') && !FAKE_QTY.test(x.r.stockNote||'');
const stockOk=x=>caveatOk(x) && !/^\s*\d/.test(x.r.note||'');
const card=(x,c)=>String((x.r.detail||{})[c]||'');
const norm=s=>' '+String(s).toLowerCase().replace(/gantech/g,'gan tech').replace(/\s+/g,' ')+' ';
const desc=p=>String(p.description||'')+' '+(Array.isArray(p.features)?p.features.join(' '):String(p.features||''));
const code=p=>String(p.item_code), CH=c=>fam(c)==='charger';
const inR=(op,w,v)=>v!=null && (op==='eq'?v===w:op==='ge'?v>=w:op==='le'?v<=w:false);

/* ---------- derived fixtures (independent of the module) ---------- */
/* explicit description evidence for a family phrase: the full phrase in a self-reference + the product's own wattage, or + its type noun */
function evOracle(phrase,nameSet){ const f=phrase.split(' ').join(' ?');
  return PUB.filter(p=>nameSet.indexOf(code(p))<0 && CH(code(p))).filter(p=>{ const t=norm(desc(p)), w=W(code(p));
    const mW=t.match(new RegExp('[^a-z0-9](?:ugreen )?'+f+' (?:(?:pro|air|mini|max|series) )?(\\d+)w(?![a-z0-9])')); if(mW && w && +mW[1]===w) return true;
    return new RegExp('[^a-z0-9](?:ugreen )?'+f+' (?:(?:pro|air|mini|max|series) )?(?:\\d+w )?(?:usb[- ]?c )?(?:usb[- ]?c )?(?:fast |wall |desktop |gan )*charger(?![a-z0-9])').test(t); }).map(code); }
const byName=re=>PUB.filter(p=>re.test(String(p.product_name).replace(/gantech/ig,'GaN Tech').replace(/\s+/g,' '))).map(code);
const PRO_NAME=byName(/(^|[^a-z0-9])nexode pro([^a-z0-9]|$)/i), PRO_ALL=PRO_NAME.concat(evOracle('nexode pro',PRO_NAME)).filter(CH);
const NEX_NAME=byName(/(^|[^a-z0-9])nexode([^a-z0-9]|$)/i), NEX_ALL=NEX_NAME.concat(evOracle('nexode',NEX_NAME)).filter(CH);
const GT=byName(/(^|[^a-z0-9])gan tech([^a-z0-9]|$)/i).filter(CH), GLUED=PUB.filter(p=>/gantech/i.test(p.product_name)).map(code);
const LINE=byName(/(^|[^a-z0-9])robot gan([^a-z0-9]|$)/i).filter(CH);
const at=(set,op,w)=>set.filter(c=>inR(op,w,W(c)));
chk('F0 fixtures: "Nexode Pro" is ONE SKU by name with description members at other wattages; GaN Tech names incl. a glued "GaNTech"; Nexode members ≥ 65W (else this test proves nothing)',
  PRO_NAME.length===1 && at(PRO_ALL,'eq',65).length>=1 && at(PRO_ALL,'eq',100).length>=1 && PRO_NAME.every(c=>W(c)!==65 && W(c)!==100) &&
  GLUED.length>=1 && GLUED.every(c=>GT.indexOf(c)>=0) && GT.length>GLUED.length && at(NEX_ALL,'ge',65).length>=2,
  'pro name '+PRO_NAME+' | pro all '+PRO_ALL+' | GT '+GT+' | glued '+GLUED+' | nexode ≥65 '+at(NEX_ALL,'ge',65));

/* ---------- A S6-2 two-way GaN Tech alias ---------- */
const A1=[65,100].map(w=>[ask('gantech '+w+'w'),ask('gan tech '+w+'w'),ask('may gantech '+w+'w ba?'),ask(w+'w gantech charger'),ask('ilan ang gantech '+w+'w?')]);
chk('A1 "gantech" / "gan tech" + wattage → exactly the derived chargers NAMED GaN Tech (either form) at that wattage, glued and spaced forms equal',
  A1.every((g,i)=>g.every(x=>same(x.r.codes,at(GT,'eq',[65,100][i])))), A1.flat().map(txt).join(' || '));
chk('A1b the alias label uses the catalogue casing "GaN Tech", never the typed lower case, never "GaN GaN"', A1.flat().every(x=>/GaN Tech/.test(x.r.note) && !/gan tech|GaN GaN/.test(x.r.note)), A1.flat().map(txt).join(' || '));
const A2=ask('gantech'), A2b=ask('robot gantech');
chk('A2 bare "gantech" → every charger named GaN Tech (the glued SKU still included); "robot gantech" → the Robot GaN Tech names in both forms',
  same(A2.r.codes,GT) && GLUED.every(c=>A2.r.codes.indexOf(c)>=0) && same(A2b.r.codes,byName(/(^|[^a-z0-9])robot gan tech([^a-z0-9]|$)/i)), txt(A2)+' || '+txt(A2b));
const GAN65=PUB.filter(p=>/\bgan\b/i.test(p.product_name) && !/gan\s?tech/i.test(p.product_name) && CH(code(p)) && W(code(p))===65).map(code), A3=ask('gan charger 65w');
chk('A3 plain "gan" stays the GaN feature: "gan charger 65w" still includes the 65W GaN chargers not named GaN Tech', GAN65.length>=1 && GAN65.every(c=>A3.r.codes.indexOf(c)>=0), txt(A3)+' | expected ⊇ '+GAN65);
/* fix round 1 (VERO F1 / owner F3 wording): no GaN Tech NAME at the wattage → labelled GaN alternatives at that wattage, the same for
   the glued and the spaced spelling and for every question form; never other product types, never "Meron / Yes", never "no product named" */
const GANAT=w=>PUB.filter(p=>/\bgan\b/i.test(String(p.product_name).replace(/gantech/ig,'GaN Tech')) && CH(code(p)) && W(code(p))===w).map(code);
const A5=[25,45].map(w=>({ w, xs:['gantech '+w+'w','gan tech '+w+'w','do you have gantech '+w+'w?','how many gantech '+w+'w?','may gantech '+w+'w ba?','may gan tech '+w+'w ba?','ilan ang gantech '+w+'w?','may stock ba ng gantech '+w+'w?','magkano ang gantech '+w+'w?','gantech charger '+w+'w'].map(q=>ask(q)) }));
const altEN=w=>new RegExp('^No GaN Tech '+w+'W is listed\\. '+w+'W GaN chargers you could offer instead \\(not GaN Tech\\):$'), altTL=w=>new RegExp('^Walang naka-listang GaN Tech na '+w+'W\\. Mga '+w+'W GaN charger na pwedeng alternatibo \\(hindi GaN Tech\\):$');
chk('A5 no GaN Tech name at 25W / 45W → exactly the derived GaN chargers at that wattage for glued + spaced, EN + TL, list / exist / count / stock / price, with the approved alternatives sentence',
  A5.every(g=>at(GT,'eq',g.w).length===0 && GANAT(g.w).length>=1 && g.xs.every(x=>same(x.r.codes,GANAT(g.w)) && x.r.codes.every(CH) && (x.r.lang==='tl'?altTL(g.w):altEN(g.w)).test(x.r.note))),
  A5.map(g=>g.xs.map(txt).join(' || ')).join(' ### '));
chk('A5b the stock form keeps the caveat; no alternatives sentence is a "Meron / Yes" or says "no product named"', A5.every(g=>caveatOk(g.xs[7]) && g.xs.every(x=>!/^(?:Meron|Yes|Oo) —|no product named|walang product na may/.test(x.r.note))), A5.map(g=>txt(g.xs[7])).join(' || '));
const A6=[55,67,140].map(w=>[ask('may gantech '+w+'w ba?'),ask('do you have gantech '+w+'w?'),ask('how many gantech '+w+'w?')]);
const chAt=w=>PUB.filter(p=>CH(code(p)) && W(code(p))===w).map(code);
chk('A6 glued "gantech" at a wattage with no charger at all → honest none, never power banks / cables of that wattage', [55,67,140].every((w,i)=>chAt(w).length===0 && A6[i].every(x=>!x.r.codes.length)), A6.flat().map(txt).join(' || '));
const A7=[ask('gantech charger'),ask('may gantech charger ba?'),ask('gantech chargers'),ask('ilan ang gantech charger?')];
chk('A7 (QA) the typed glued word is applied, never reported as unconfirmed', A7.every(x=>same(x.r.codes,GT) && !/isn’t confirmed|Hindi confirmed/.test(x.r.note)), A7.map(txt).join(' || '));
const A8=ask('gantech nexode 65w');
chk('A8 a real name word next to the alias builds the name window itself ("gantech nexode 65w" → the Nexode 65W set)', same(A8.r.codes,at(NEX_ALL,'eq',65)), txt(A8));
const A4=ask('may stock ba ng gantech 65w?');
chk('A4 stock wording: the same GaN Tech 65W set, "listed" framing, caveat, no quantity', same(A4.r.codes,at(GT,'eq',65)) && stockOk(A4), txt(A4)+' | '+A4.r.stockNote);

/* ---------- B S6-1 single-SKU name family + description evidence ---------- */
const B1=[ask('nexode pro 65w'),ask('do you have nexode pro 65w?'),ask('may nexode pro 65w ba?')], B2=[ask('nexode pro 100w'),ask('may nexode pro 100w ba?')];
chk('B1 "nexode pro 65W / 100W" (EN + TL) → exactly the derived Nexode Pro members at that wattage (description members), never the 45W name SKU, never "wala"',
  B1.every(x=>mode(x)==='exact' && same(x.r.codes,at(PRO_ALL,'eq',65))) && B2.every(x=>mode(x)==='exact' && same(x.r.codes,at(PRO_ALL,'eq',100))) && B1.concat(B2).every(x=>!/don’t have|Wala/.test(x.r.note)), B1.concat(B2).map(txt).join(' || '));
chk('B1b TL exist sentence exactly: "Meron — N na Nexode Pro 65W sa current pricelist:"; evidence members carry "— ayon sa product description"',
  /^Meron — \d+ na Nexode Pro 65W sa current pricelist:$/.test(B1[2].r.note) && B1[2].r.codes.every(c=>PRO_NAME.indexOf(c)>=0 || / — ayon sa product description$/.test(card(B1[2],c))), txt(B1[2])+' | '+B1[2].r.codes.map(c=>card(B1[2],c)).join(' | '));
const B3=ask('may stock ba ng nexode pro 65w?'), B4=ask('magkano ang nexode pro 100w?');
chk('B3 stock wording keeps "listed" + caveat, no quantity; B4 price question → the same exact set with price fields',
  same(B3.r.codes,at(PRO_ALL,'eq',65)) && stockOk(B3) && same(B4.r.codes,at(PRO_ALL,'eq',100)) && (B4.r.fields||[]).indexOf('srp')>=0, txt(B3)+' || '+txt(B4));
const B5=[ask('may nexode pro 30w ba?'),ask('nexode pro 30w')];
chk('B5 no Nexode Pro at the wattage → labelled same-type alternatives at that wattage, never a Pro member, never framed as exact',
  B5.every(x=>mode(x)==='alternatives' && x.r.codes.length && x.r.codes.every(c=>W(c)===30 && CH(c) && PRO_ALL.indexOf(c)<0) && /\((?:hindi|not) Nexode Pro\):$/.test(x.r.note) && !/^(?:Meron|Yes|Oo) —/.test(x.r.note)), B5.map(txt).join(' || '));
const B6=ask('nexode pro 45w');
chk('B6 the name SKU at its own wattage keeps the STOCK-1 path (no family resolution)', same(B6.r.codes,at(PRO_NAME,'eq',45)) && !fm(B6), txt(B6));
const B7=chain(['may nexode pro 65w ba?','how much']);
chk('B7 follow-up "how much" prices exactly the codes just shown', same(B7[1].r.codes,B7[0].r.codes) && B7[0].r.codes.length>=1, B7.map(txt).join(' || '));

/* single-SKU boundary (synthetic, in memory) */
const SYN=[{ item_code:'ZZS6-01', model:'ZZ601', product_name:'Quorbex 45W USB-C GaN Charger', description:'' },
           { item_code:'ZZS6-02', model:'ZZ602', product_name:'65W USB-C GaN Fast Charger', description:'UGREEN Quorbex 65W charger for travel.' },
           { item_code:'ZZS6-03', model:'ZZ603', product_name:'Vexlor 45W USB-C GaN Charger', description:'' },
           { item_code:'ZZS6-04', model:'ZZ604', product_name:'65W USB-C GaN Fast Charger', description:'Works with Vexlor 65W chargers.' }]
  .map(p=>Object.assign({ color:'Black', length:'', srp:999, dp:899, dp_volume:849, moq:1, features:'', sheet:'Mobile-Charger', category:'Wall Charger/Desk Charger' },p));
const PS=PUB.concat(SYN), X1=ask('may quorbex 65w ba?',PS), X2=ask('may vexlor 65w ba?',PS);
chk('X1 a one-SKU name + an explicit description member → exact family answer with that member', mode(X1)==='exact' && same(X1.r.codes,['ZZS6-02']) && /product description/.test(card(X1,'ZZS6-02')), txt(X1));
chk('X2 a one-SKU name whose only mention is comparison wording → NOT a family (unchanged pre-STOCK-6A behaviour)', !fm(X2), txt(X2));

/* ---------- C S6-3 count questions ---------- */
const C1=[ask('ilan ang nexode 65w?'),ask('ilang nexode 65w meron?'),ask('how many nexode 100w?'),ask('how many nexode pro 65w?')], C1e=[at(NEX_ALL,'eq',65),at(NEX_ALL,'eq',65),at(NEX_ALL,'eq',100),at(PRO_ALL,'eq',65)];
chk('C1 count → the exact set, the note leads with its count and names the family + wattage, never "0 —" / "Wala" / "don’t have"',
  C1.every((x,i)=>mode(x)==='exact' && same(x.r.codes,C1e[i]) && x.r.note.indexOf(String(x.r.codes.length)+' ')===0 && /Nexode (?:Pro )?(?:65|100)W/.test(x.r.note) && !/^0 —|Wala|don’t have/.test(x.r.note)), C1.map(txt).join(' || '));
chk('C1b count sentences exactly (TL "N na Nexode 65W charger sa current pricelist:", EN "N Nexode 100W charger(s) in the current pricelist:")',
  /^\d+ na Nexode 65W charger sa current pricelist:$/.test(C1[0].r.note) && /^\d+ Nexode 100W chargers? in the current pricelist:$/.test(C1[2].r.note), C1.map(txt).join(' || '));
const C2=ask('ilan ang stock ng nexode 65w?');
chk('C2 a stock count is never a stock quantity: the exact set with "listed" framing + caveat, not count-led', same(C2.r.codes,at(NEX_ALL,'eq',65)) && stockOk(C2), txt(C2)+' | '+C2.r.stockNote);
const C3=ask('ilan ang robot gan 20w?');
chk('C3 count with no family member at the wattage → labelled alternatives, never "0 — Wala"', mode(C3)==='alternatives' && C3.r.codes.length && C3.r.codes.every(c=>W(c)===20 && LINE.indexOf(c)<0) && /\(hindi Robot GaN\):$/.test(C3.r.note) && !/^0 —/.test(C3.r.note), txt(C3));
const C4=ask('how many robot gan 55w?');
chk('C4 count with nothing of that type at the wattage → honest none, no codes, and the wattages that do exist are offered', C4.r.codes.length===0 && mode(C4)==='none' && /GaN chargers we carry: /.test(C4.r.note), txt(C4));

/* ---------- D S6-4 ranges ---------- */
const D1=[ask('may nexode 65w pataas ba?'),ask('nexode 65w and above'),ask('nexode 65w or more')], D2=ask('robot gan 65w pataas'), D3=ask('nexode pro 65w and above'), D4=ask('nexode pro 50w pababa');
chk('D1 "nexode 65W pataas / and above / or more" → every derived Nexode member ≥ 65W (inclusive), never the 20–45W line; English "≥65W", Tagalog "65W pataas" (owner wording)',
  D1.every(x=>mode(x)==='exact' && same(x.r.codes,at(NEX_ALL,'ge',65)) && (x.r.lang==='tl'?/65W pataas/.test(x.r.note) && !/≥/.test(x.r.note):/≥65W/.test(x.r.note))), D1.map(txt).join(' || '));
/* owner wording 2026-10-16: Tagalog ranges read "{N}W pataas" / "{N}W pababa" after the noun — never the ≥ / ≤ symbols */
const D6=[ask('may nexode 65w pataas ba?'),ask('ilan ang nexode 65w pataas?'),ask('may stock ba ng nexode 65w pataas?'),ask('may robot gan 20w pababa ba?'),ask('ilan ang robot gan 300w pataas?'),ask('magkano ang robot gan 300w pataas?')];
chk('D6 Tagalog range sentences exactly as approved (exist / count / stock / alternatives / none), no ≥ / ≤ symbol',
  /^Meron — \d+ na Nexode charger na 65W pataas sa current pricelist:$/.test(D6[0].r.note) && /^\d+ na Nexode charger na 65W pataas sa current pricelist:$/.test(D6[1].r.note) &&
  /^Naka-lista sa current pricelist ang mga Nexode charger na 65W pataas na ito:$/.test(D6[2].r.note) && stockOk(D6[2]) &&
  /^Walang naka-listang Robot GaN na 20W pababa\. Mga GaN charger na 20W pababa na pwedeng alternatibo \(hindi Robot GaN\):$/.test(D6[3].r.note) &&
  /^0 — Wala tayong GaN charger na 300W pataas sa current pricelist\./.test(D6[4].r.note) && /^Wala tayong GaN charger na 300W pataas sa current pricelist\./.test(D6[5].r.note) && D6.every(x=>x.r.lang==='tl' && !/[≥≤]/.test(x.r.note)), D6.map(txt).join(' || '));
const D7=[ask('do you have nexode 65w and above?'),ask('robot gan 20w pababa')];
chk('D7 English range sentences unchanged ("Yes — N Nexode ≥65W chargers …", "No Robot GaN ≤20W is listed. ≤20W GaN chargers you could offer instead (not Robot GaN):")',
  /^Yes — \d+ Nexode ≥65W chargers in the current pricelist:$/.test(D7[0].r.note) && /^No Robot GaN ≤20W is listed\. ≤20W GaN chargers you could offer instead \(not Robot GaN\):$/.test(D7[1].r.note), D7.map(txt).join(' || '));
chk('D2 / D3 ranges on a 2+-SKU line and on the single-SKU Pro family', same(D2.r.codes,at(LINE,'ge',65)) && same(D3.r.codes,at(PRO_ALL,'ge',65)) && mode(D3)==='exact', txt(D2)+' || '+txt(D3));
chk('D4 an upper bound that only the name SKU meets keeps that SKU (STOCK-1 path)', same(D4.r.codes,at(PRO_ALL,'le',50)), txt(D4));
const D4b=[ask('may nexode pro 65w pababa ba?'),ask('nexode pro 100w pababa')];   /* QA fix round 1: the ≤ bound is inclusive like ≥ */
chk('D4b inclusive upper bound keeps the description member AT the bound ("nexode pro 65w pababa" includes the 65W member)', same(D4b[0].r.codes,at(PRO_ALL,'le',65)) && same(D4b[1].r.codes,at(PRO_ALL,'le',100)) && at(PRO_ALL,'eq',65).every(c=>D4b[0].r.codes.indexOf(c)>=0), D4b.map(txt).join(' || '));
const D5=ask('may nexode pro 200w pataas ba?');
chk('D5 no family member in the range → labelled same-type alternatives in the range (or honest none)', (mode(D5)==='alternatives' && D5.r.codes.every(c=>W(c)>=200 && CH(c) && PRO_ALL.indexOf(c)<0) && /\(hindi Nexode Pro\):$/.test(D5.r.note)) || (mode(D5)==='none' && !D5.r.codes.length), txt(D5));

/* ---------- G unchanged by design (STOCK-6B … 6D) ---------- */
const G=[ask('nexode 65w for macbook'),ask('may nexode 65w para sa laptop?'),ask('may nexode 100w para sa macbook pro?'),ask('CD361 30w'),ask('may CD361 30w ba?'),ask('how many star rail 20w in stock?'),ask('star rail 20w'),
  ask('robot gan 65w'),ask('may stock ba ng robot gan 65w?'),ask('nexode 20w'),ask('may nexode 45w ba?'),ask('recommend nexode 65w'),ask('nexode 65w details')];
chk('G1 STOCK-6A never fires for device-named / device-class questions, model anchors, mixed-type families, name members at the wattage, recommendations or details', G.every(x=>!fm(x)), G.filter(fm).map(txt).join(' || '));
const G2=[ask('may nexode 65w ba?'),ask('may robot gan 100w ba?'),ask('may robot gan 20w ba?')];
chk('G2 STOCK-2 answers keep their sets (Nexode 65W exact, Robot GaN 100W, Robot GaN 20W alternatives)', same(G2[0].r.codes,at(NEX_ALL,'eq',65)) && same(G2[1].r.codes,at(LINE,'eq',100)) && mode(G2[2])==='alternatives', G2.map(txt).join(' || '));

/* ---------- I invariants over every answer in this file ---------- */
chk('I1 every stock question keeps the caveat; no answer states a quantity or stock state', SEEN.filter(x=>x.r.plan.flags.stock).every(caveatOk) && SEEN.every(x=>!FAKE_QTY.test(x.r.note||'')), SEEN.filter(x=>x.r.plan.flags.stock && !caveatOk(x)).map(txt).join(' || '));
chk('I2 every family answer is local (no AI / web route)', SEEN.filter(fm).length>=25 && SEEN.filter(fm).every(x=>x.r.plan.route.route==='LOCAL'), SEEN.filter(fm).filter(x=>x.r.plan.route.route!=='LOCAL').map(txt).join(' || '));
chk('I3 alternatives are never framed as exact; no "0 — Wala" while alternatives are shown', SEEN.every(x=>!(mode(x)==='alternatives' && (/^(?:Meron|Yes|Oo) —/.test(x.r.note) || /^0 —/.test(x.r.note)))), '');
chk('I4 product names never rewritten; products.json untouched', JSON.stringify(PUB.map(p=>p.product_name))===NAMES_BEFORE && fs.readFileSync(path.join(ROOT,'data','products.json'),'utf8')===RAW);

console.log((MUTANT?'['+MUTANT+'] ':'')+'VERO NEW-P2R3A-STOCK-6A: '+pass+' passed, '+fail+' failed');

/* ===================== mutation tests ===================== */
if(!MUTANT){
  const M=[
    ['typed glued alias no longer expanded (S6-2 one-way again)','js/vero-plan.js',"else if(NAME_ALIAS[w]) q.push.apply(q,NAME_ALIAS[w]); else q.push(w); });","else q.push(w); });"],
    ['alias phrase never names products (generic words only)','js/vero-plan.js',"var aw=nameWord(q[a],c,ni)?0:aliasAt(a);","var aw=0;"],
    ['alias label shows the typed lower case','js/vero-plan.js',"var core=n.alias?aliasCase(n.text,products):(words.filter(function(w){ return nameWord(w,c,NI); }).join(' ')||n.text), withQ=","var core=n.text, withQ="],
    ['typed "gantech" no longer sets the GaN feature (fix round 1 F1 reverted)','js/vero-plan.js',"if(/\\bgan\\b/.test(aliasSpaced(t))) X.match.push","if(/\\bgan\\b/.test(t)) X.match.push"],
    ['typed glued alias reported as an unconfirmed qualifier (fix round 1 F2 reverted)','js/vero-plan.js',"return (NAME_ALIAS[x]||[x]).every(function(y){ return vw.indexOf(y)>=0; });","return vw.indexOf(x)>=0;"],
    ['alias no-match falls back to the generic dropped-qualifier note (fix round 1 F3 reverted)','js/vero-compose.js',"    if(aliasDrop){ var an=","    if(false){ var an="],
    ['alias alternatives sentence loses "(not GaN Tech)"','js/vero-compose.js',"' you could offer instead (not '+an+'):'; }","' you could offer instead:'; }"],
    ['upper range bound exclusive','js/vero-plan.js',"case 'le': return v<=x;","case 'le': return v<x;"],
    ['alias consumed although a real name word is next to it','js/vero-plan.js',"        if(hasName) continue;","        if(false) continue;"],
    ['alias phrase with no match is a hard filter (false "wala" for "gan tech 25w")','js/vero-plan.js',"withLabel:withQ, soft:!!n.alias, alias:!!n.alias });","withLabel:withQ, alias:!!n.alias });"],
    ['dropped alias phrase kept in the label ("GaN Tech chargers (no product named gan tech …)")','js/vero-compose.js',"else if(m.k==='namephrase'){ if(!kept(m)) return; if(m.withLabel)","else if(m.k==='namephrase'){ if(m.withLabel)"],
    ['flag repeated next to the alias label ("GaN GaN Tech")','js/vero-compose.js',"if(npLab && new RegExp(","if(false && new RegExp("],
    ['single-SKU family disabled (S6-1 reverted)','js/vero-plan.js',"if(famCodes.length<2 && !ev.admit.length) return null;","if(famCodes.length<2) return null;"],
    ['single SKU without a description member treated as a family','js/vero-plan.js',"if(famCodes.length<2 && !ev.admit.length) return null;",""],
    ['count questions excluded (S6-3 reverted)','js/vero-plan.js',"I==='list' || I==='count' || (I==='lookup'","I==='list' || (I==='lookup'"],
    ['count sentence without the number','js/vero-compose.js',"if(I==='count') return tl?n+' na '+famName","if(I==='count') return tl?'Mga '+famName"],
    ['ranges excluded (S6-4 reverted)','js/vero-plan.js',"wf=wfs.length===1 && W_OPS[wfs[0].op]?wfs[0]:null;","wf=wfs.length===1 && wfs[0].op==='eq'?wfs[0]:null;"],
    ['range lower bound exclusive','js/vero-plan.js',"case 'ge': return v>=x;","case 'ge': return v>x;"],
    ['Tagalog range sentences use the ≥ / ≤ symbols again','js/vero-compose.js',"if(tl && famRange){ var nr=nounOf(LP,false);","if(false){ var nr=nounOf(LP,false);"],
    ['Tagalog "pababa" / "pataas" swapped','js/vero-compose.js',"ge:wv+'W pataas', le:wv+'W pababa'","ge:wv+'W pababa', le:wv+'W pataas'"],
    ['Tagalog range none answer uses the symbol label','js/vero-compose.js',"res.note=(famRange && lang==='tl')?famNoneTl():T(lang,'existNo'","res.note=T(lang,'existNo'"],
    ['range shown as an exact wattage in the sentence','js/vero-compose.js',"var fw=FM.wLabel||(FM.watts+'W'), tl=lang==='tl';","var fw=FM.watts+'W', tl=lang==='tl';"],
    ['description evidence admitted at any wattage','js/vero-plan.js',"var evAt=ev.admit.filter(function(e){ return wIn(wf,idx.byCode[e.code].attrs.watts.value); });","var evAt=ev.admit.slice();"],
    ['device-named questions included','js/vero-plan.js',"if(plan.flags.devices.named.length || plan.flags.devices.classes.length) return null;",""],
    ['model anchors included','js/vero-plan.js',"if(an.length!==1 || an[0].via!=='name' || (plan.refs||[]).length) return null;","if(an.length!==1 || (plan.refs||[]).length) return null;"],
    ['stock caveat removed','js/vero-compose.js',"if(plan.flags.stock) res.stockNote=T(lang,plan.flags.invQty?'stockQty':'stock');",""],
  ];
  let killed=0;
  M.forEach(function(m,i){
    const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'stock6a-mut-')); fs.mkdirSync(path.join(tmp,'js'));
    fs.readdirSync(path.join(ROOT,'js')).forEach(f=>fs.copyFileSync(path.join(ROOT,'js',f),path.join(tmp,'js',f)));
    const fp=path.join(tmp,m[1]), src=fs.readFileSync(fp,'utf8');
    if(src.split(m[2]).length!==2){ console.log('FAIL - mutant M'+(i+1)+' anchor not found exactly once: '+m[0]); fail++; fs.rmSync(tmp,{ recursive:true, force:true }); return; }
    fs.writeFileSync(fp,src.replace(m[2],()=>m[3]));
    const r=cp.spawnSync(process.execPath,[__filename],{ env:Object.assign({},process.env,{ STOCK6A_CODE_ROOT:tmp, STOCK6A_MUTANT:'M'+(i+1) }), encoding:'utf8' });
    const out=(r.stdout||'')+(r.stderr||''), firstFail=(out.split('\n').filter(l=>/^FAIL/.test(l))[0]||out.split('\n').filter(Boolean).slice(-1)[0]||'').slice(0,140);
    if(r.status!==0){ killed++; pass++; console.log('PASS - mutant M'+(i+1)+' killed: '+m[0]+'  ['+firstFail+']'); }
    else { fail++; console.log('FAIL - mutant M'+(i+1)+' SURVIVED: '+m[0]); }
    fs.rmSync(tmp,{ recursive:true, force:true });
  });
  console.log('Mutants killed: '+killed+'/'+M.length);
  console.log('VERO NEW-P2R3A-STOCK-6A (cases + mutants): '+pass+' passed, '+fail+' failed');
}
process.exit(fail?1:0);
