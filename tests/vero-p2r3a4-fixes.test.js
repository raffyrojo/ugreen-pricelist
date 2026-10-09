/* VERO p2r3a.4 (P-track live fix, baseline cfb87aa) — regression tests for three live p2r3a.3 defects.
   Run: node tests/vero-p2r3a4-fixes.test.js
   A  alternative cue with no single base product → clarify (never a null / undefined code, never "Here's ;"); a single
      focused product is the base; the conversation context is kept on the clarification
   B  negation safety, phase 1: a negated term is NEVER applied positively and never produces a false "wala"; negated
      price comparators flip direction; a negated product TYPE alone → clarify; a negated qualifier is reported as
      "not applied yet" (exclusion itself is not evaluated in p2r3a.4); guard phrases are untouched
   C  version / model numbers ("gen 4", "usb 3.2 gen 1", "bluetooth 5.3", "iphone 15") are never a unit-less price
      question; legitimate bare-number and price questions are unchanged
   Expectations are DERIVED from data/products.json and the live answer path; no SKU lists are hardcoded. */
const fs=require('fs'), path=require('path');
const ROOT=path.join(__dirname,'..');
global.window={ PRICE_SETTINGS:{ indicatorDays:30 } };
eval(fs.readFileSync(path.join(ROOT,'js','helpers.js'),'utf8'));
['vero-lexicon','vero-nlu','vero-facts','vero-plan','vero-compose'].forEach(f=>require(path.join(ROOT,'js',f+'.js')));
const E=require(path.join(ROOT,'js','vero-engine.js'));
const F=require(path.join(ROOT,'js','vero-facts.js'));
const ALL=JSON.parse(fs.readFileSync(path.join(ROOT,'data','products.json'),'utf8')); pcResolveSchedule(ALL);
const PUB=ALL.filter(p=>!p.disabled), IDX=F.build(PUB), byCode={}; PUB.forEach(p=>byCode[String(p.item_code)]=p);
let pass=0, fail=0; const chk=(n,c,x)=>{ if(c){ pass++; console.log('PASS - '+n); } else { fail++; console.log('FAIL - '+n+(x!==undefined?'  -> '+String(x).slice(0,600):'')); } };
const SEEN=[];   /* every turn answered in this file feeds the global invariants at the end */
function chat(turns){ let conv=null; return turns.map(q=>{ const prev=conv; const r=E.answer(PUB,q,{ conv }); const a=E.aiRoute(PUB,q,r,{}); if(r.ctxOut) conv=r.ctxOut; const x={ q, r, a, prev, ctx:conv }; SEEN.push(x); return x; }); }
const one=q=>chat([q])[0], last=t=>{ const o=chat(t); return o[o.length-1]; };
const txt=x=>x.q+' => ['+(x.r.plan&&x.r.plan.intent)+'] '+(x.r.note||'')+' | '+(x.r.codes||[]).slice(0,8).join(',')+((x.r.codes||[]).length>8?'…('+x.r.codes.length+')':'');
const fam=c=>IDX.byCode[c]&&IDX.byCode[c].type.family;
const srp=c=>Number((byCode[c]||{}).srp)||0;
const sortedEq=(a,b)=>JSON.stringify([...a].map(String).sort())===JSON.stringify([...b].map(String).sort());
const local=x=>x.a.route==='local' && !x.a.candidates.length;
const isClarify=x=>x.r.type==='clarify' || (x.r.plan && x.r.plan.route && x.r.plan.route.route==='CLARIFY');
const FALSE_WALA=/We don’t have|Wala tayong|Walang .* sa current|Hindi ko makita|can’t find|0 —|no longer in this pricelist/;
const NOT_APPLIED=/isn’t applied yet|hindi pa na-apply/;
const MALFORMED=/Here’s ;|Heto ang ;|\{[a-z]+\}|\bundefined\b|\bnull\b|\[object Object\]/;
const priceChip=x=>(x.r.chips||[]).some(c=>/₱/.test(c.label)) || /under ₱\d/.test(x.r.note||'') && /Did you mean|ba ang ibig/.test(x.r.note||'');
const numAmb=x=>((x.r.plan&&x.r.plan.ambiguity)||[]).some(a=>a.slot==='number');

/* runtime-picked fixtures (derived, never hardcoded) */
const c65=one('65W charger').r.codes.slice();
const BASE=c65.slice().sort((a,b)=>srp(b)-srp(a))[0];                 /* most expensive 65W charger: cheaper same-wattage options exist */
const PAIR=c65.slice(0,2);

/* ================= A  alternative cue without a single base product ================= */
const CUES=['alternative','alternatives','similar','replacement','kapalit','same as','same wattage','same capacity','closest','katulad','kahalintulad','other option','iba pang option'];
const A1=CUES.map(q=>one(q));
chk('A1 all 13 alternative cues standalone → clarify "which product", no codes, never a null code or "Here’s ;"',
  A1.every(x=>isClarify(x) && !x.r.codes.length && /alternatives for|Para saang product/.test(x.r.note) && !MALFORMED.test(x.r.note) && local(x)), A1.filter(x=>!(isClarify(x)&&!x.r.codes.length)).map(txt).join(' || '));
const A2=CUES.map(q=>last(['65W charger',q])), A2b=CUES.map(q=>last(['hdmi cable',q]));
chk('A2 after a LIST (no single focus): every cue → clarify, no codes, no null', A2.concat(A2b).every(x=>isClarify(x) && !x.r.codes.length && !MALFORMED.test(x.r.note)), A2.concat(A2b).filter(x=>!isClarify(x)).map(txt).join(' || '));
chk('A2b the clarification KEEPS the conversation context (the previous results stay for the next turn)',
  A2.every(x=>x.ctx && x.prev && sortedEq(x.ctx.results||[],x.prev.results||[]) && x.ctx.lastPlan===x.prev.lastPlan), A2.map(x=>x.q+':'+((x.ctx||{}).results||[]).length).join(' '));
const A3=CUES.map(q=>last([BASE,q]));
chk('A3 after a single focused SKU ('+BASE+', runtime-picked): the focus is the base — codes are that SKU or its same-spec options, never null',
  A3.every(x=>x.r.codes.length && x.r.codes.every(c=>c!=null && byCode[c]) && (x.r.codes.indexOf(BASE)>=0 || (x.r.plan.alternative && x.r.plan.alternative.base===BASE)) && !MALFORMED.test(x.r.note)), A3.map(txt).join(' || '));
const sw=last([BASE,'same wattage']), wv=IDX.byCode[BASE].attrs.watts.value;
chk('A3b "<SKU>" → "same wattage" lists same-family items with the same derived wattage ('+wv+'W)', sw.r.codes.length && sw.r.codes.every(c=>fam(c)===fam(BASE) && IDX.byCode[c].attrs.watts.value===wv), txt(sw));
const A4=CUES.map(q=>last([PAIR.join(' vs '),q]));
chk('A4 after a 2-item comparison: every cue → clarify (no single base), no null', A4.every(x=>isClarify(x) && !x.r.codes.length && !MALFORMED.test(x.r.note)), A4.filter(x=>!isClarify(x)).map(txt).join(' || '));
const A5=['similar charger','alternative hdmi cable','closest hub','same wattage charger','kapalit na power bank'].map(one);
chk('A5 a typed family + an alternative cue with no base product → clarify, no null', A5.every(x=>isClarify(x) && !x.r.codes.length && !MALFORMED.test(x.r.note)), A5.map(txt).join(' || '));
const A6=last([BASE,'hub similar']);
chk('A6 the focus is NOT used as the base for a different named family ("<charger SKU>" → "hub similar") → clarify', isClarify(A6) && !A6.r.codes.length, txt(A6));
const ch=chat([BASE,'similar','cheaper']), ch3=ch[2], cheaperDerived=PUB.filter(p=>fam(String(p.item_code))===fam(BASE) && IDX.byCode[String(p.item_code)].attrs.watts.value===wv && srp(String(p.item_code))<srp(BASE)).map(p=>String(p.item_code));
chk('A7 3-turn "<SKU>" → "similar" → "cheaper": the focus survives; cheaper same-wattage options (derived '+cheaperDerived.length+'), no false "wala"',
  ch[1].r.codes.indexOf(BASE)>=0 && ch3.r.codes.length && ch3.r.codes.every(c=>srp(c)<srp(BASE) && fam(c)===fam(BASE)) && !FALSE_WALA.test(ch3.r.note), ch.map(txt).join(' || '));
const ch2=chat(['65W charger','alternative','same but cheaper']);
chk('A8 "65W charger" → "alternative" (clarify) → "same but cheaper": the 65W search is still there (no false "We don’t have")',
  ch2[2].r.codes.length && sortedEq(ch2[2].r.codes,c65) && !FALSE_WALA.test(ch2[2].r.note), ch2.map(txt).join(' || '));
const A9=[one('alternative sa SKU '+BASE), one('may mas mura ba sa '+BASE+'?'), one('same wattage as '+BASE)];
chk('A9 controls unchanged: a named SKU keeps the alternative path (pending names the SKU; cheaper / same-wattage run)',
  A9[0].r.codes[0]===BASE && /pending/.test(A9[0].r.plan.result.executor) && A9[1].r.codes.length && A9[2].r.codes.length, A9.map(txt).join(' || '));
chk('A10 no new reply uses "equivalent / exact replacement / same as" wording', A1.concat(A2,A3,A4,A5).every(x=>!/equivalent|exact replacement|\bsame as\b/i.test(x.r.note)), '');

/* ================= B  negation safety (phase 1) ================= */
const base=q=>one(q);
/* B1 price negation: a negated comparator flips direction (EN + Taglish); legitimate price phrasings unchanged */
const pr=(q)=>{ const x=one(q), f=(x.r.plan.filters||[]).filter(y=>y.attr==='price')[0]; return { x, f }; };
const LE=['cable not more than 500','cable no more than 500','cable not over 500','cable not above 500','cable hindi lalampas sa 500','cable hindi hihigit sa 500'].map(pr);
const GE=['cable not less than 500','cable not below 500','cable not under 500','cable hindi bababa sa 500'].map(pr);
const cablesLE=pr('cable under 500').x.r.codes;
chk('B1 "not more than / no more than / not over / not above / hindi lalampas sa N" = at most N (same set as "under N")',
  LE.every(o=>o.f && o.f.op==='le' && o.f.value===500 && sortedEq(o.x.r.codes,cablesLE)), LE.map(o=>txt(o.x)).join(' || '));
chk('B1b "not less than / not below / not under / hindi bababa sa N" = at least N, every result priced ≥ N',
  GE.every(o=>o.f && o.f.op==='ge' && o.x.r.codes.length && o.x.r.codes.every(c=>srp(c)>=500)), GE.map(o=>txt(o.x)).join(' || '));
const P4=['charger under 4k','charger below 4000','charger less than ₱4,000'].map(pr), P5=['charger budget 500','charger hanggang 500','charger wala pang 500'].map(pr);
chk('B1c legitimate price phrasings unchanged: under 4k = below 4000 = less than ₱4,000 (≤4,000); budget / hanggang / wala pang 500 (≤500)',
  P4.every(o=>o.f && o.f.op==='le' && o.f.value===4000 && sortedEq(o.x.r.codes,P4[0].x.r.codes)) && P5.every(o=>o.f && o.f.op==='le' && o.f.value===500 && sortedEq(o.x.r.codes,P5[0].x.r.codes)),
  P4.concat(P5).map(o=>txt(o.x)).join(' || '));
const u8=pr('charger under 8k'), k8=one('may 8K HDMI ba');
chk('B1d "under 8k" is a budget, "may 8K HDMI ba" is a resolution (no price filter)', u8.f && u8.f.value===8000 && !(k8.r.plan.filters||[]).some(f=>f.attr==='price') && k8.r.codes.length, txt(u8.x)+' || '+txt(k8));
/* review round 1: Taglish caps with di / wag / huwag and particles (po, na, dapat), and a bare "lalampas sa N" (no budget claim) */
const TLE=['cable di lalampas sa 500','cable hindi po lalampas sa 500','cable hindi dapat lalampas sa 500','cable wag lalampas sa 500','cable huwag lalagpas sa 500','cable di hihigit sa 500','cable never more than 500',"cable isn't over 500"].map(pr);
const TGE=['cable di bababa sa 500','cable hindi po bababa sa 500'].map(pr), bare=pr('cable lalampas sa 500');
chk('B1f Taglish / particle caps ("di / hindi po / hindi dapat / wag / huwag lalampas sa N", "never more than", "isn’t over") = at most N; "di bababa sa N" = at least N; bare "lalampas sa N" sets no price',
  TLE.every(o=>o.f && o.f.op==='le' && sortedEq(o.x.r.codes,cablesLE)) && TGE.every(o=>o.f && o.f.op==='ge') && !bare.f, TLE.concat(TGE,[bare]).map(o=>txt(o.x)).join(' || '));
const pb2k=pr('power bank hindi lalampas sa 2k'), fpr=last(['65W charger','di lalampas sa 1500']);
chk('B1g "power bank hindi lalampas sa 2k" is a ₱2,000 cap (not a 2,000mAh capacity, no false "wala"); "65W charger" → "di lalampas sa 1500" keeps the 65W search',
  pb2k.f && pb2k.f.value===2000 && pb2k.f.op==='le' && pb2k.x.r.codes.length && !FALSE_WALA.test(pb2k.x.r.note) && fpr.r.codes.length && fpr.r.codes.every(c=>c65.indexOf(c)>=0 && srp(c)<=1500), txt(pb2k.x)+' || '+txt(fpr));
const w65=one('charger not more than 65w');
chk('B1e a negated comparator on a unit flips too ("not more than 65w" = at most 65W)', (w65.r.plan.filters||[]).some(f=>f.attr==='watts' && f.op==='le' && f.value===65), txt(w65));
/* B2 family-only negation → clarify (no list of that family, no catalogue-wide exclusion, no "wala", no invented family) */
const FAMNEG=['not a charger','hindi charger','ayoko ng charger','except chargers','not a power bank','hindi power bank','not a hub','not an hdmi cable','not a cable','hindi po charger','di po charger','hindi naman charger','hindi po power bank'];
const B2=FAMNEG.map(one);
chk('B2 a negated product type with no positive target → clarify asking what they want instead; no codes, no "wala"',
  B2.every(x=>isClarify(x) && !x.r.codes.length && /Which product type are you looking for instead|Anong product type ang hanap mo/.test(x.r.note) && !FALSE_WALA.test(x.r.note) && local(x)), B2.map(txt).join(' || '));
const B2c=last(['65W charger','not a charger']);
chk('B2b "65W charger" → "not a charger": clarify, the 65W search is kept for the next turn', isClarify(B2c) && sortedEq((B2c.ctx||{}).results||[],(B2c.prev||{}).results||[]), txt(B2c));
/* B3 qualifier negation: never applied positively; the positive family stays; the reply says the exclusion is not applied */
const bc=q=>one(q).r.codes;
const NAMED=[['hub na walang hdmi','hub'],['hub without hdmi','hub'],['charger na walang usb a','charger'],['charger without usb-a','charger'],['charger not car charger','charger'],
  ['charger pero hindi car charger','charger'],['charger hindi car','charger'],['charger not white','charger'],['not white charger','charger'],['earbuds not pink','earbuds'],
  ['power bank na hindi magsafe','power bank'],['charger not 200w','charger'],['hdmi cable not 4k','hdmi cable'],['hub na walang magnetic','hub'],
  ['hub na walang lan','hub'],['walang lan na hub','hub'],['dock na walang lan','dock'],['hindi po white na charger','charger'],['charger hindi po white','charger'],['hub na wala pong hdmi','hub'],['hdmi cable na walang hdmi','hdmi cable']];
const B3=NAMED.map(([q,b])=>({ x:one(q), b:bc(b) }));
chk('B3 named negations: the result is the plain positive family (negated term NOT applied), the reply says “… isn’t applied yet”, no false "wala"',
  B3.every(o=>sortedEq(o.x.r.codes,o.b) && NOT_APPLIED.test(o.x.r.note) && !FALSE_WALA.test(o.x.r.note)), B3.filter(o=>!(sortedEq(o.x.r.codes,o.b)&&NOT_APPLIED.test(o.x.r.note))).map(o=>txt(o.x)).join(' || '));
/* review round 1: the negated term ends where a new product phrase starts, so positive specs are kept */
const KEEP=[['not white 65w charger','65W charger'],['walang hdmi 4 port hub','4 port hub'],['no hdmi usb-c hub','usb-c hub'],['non magnetic 10000mah power bank','10000mah power bank'],
  ['without cable 20000mah power bank','20000mah power bank'],['not 8k 2m hdmi cable','2m hdmi cable'],['not braided 2m usb-c cable','2m usb-c cable']].map(([q,b])=>({ x:one(q), b:bc(b) }));
chk('B3c a negated qualifier never swallows the positive specs after it: the answer is the positive search ("not white 65w charger" = the 65W chargers) + note',
  KEEP.every(o=>o.b.length && sortedEq(o.x.r.codes,o.b) && NOT_APPLIED.test(o.x.r.note)), KEEP.filter(o=>!sortedEq(o.x.r.codes,o.b)).map(o=>txt(o.x)).join(' || '));
const EXQ=[['walang nas?','nas'],['walang hdmi cable?','hdmi cable'],['walang 65w charger?','65w charger'],['walang 100w charger kayo?','100w charger'],['no 2m hdmi cable?','2m hdmi cable'],['do you not have a 65w charger?','65w charger']]
  .map(([q,b])=>({ x:one(q), b:bc(b) }));
chk('B3d "walang X?" / "no X?" / "do you not have X?" are existence questions (answered with X), never a negation',
  EXQ.every(o=>o.b.length && sortedEq(o.x.r.codes,o.b) && !(o.x.r.plan.negated||[]).length), EXQ.map(o=>txt(o.x)).join(' || '));
/* review round 2: several negations / coordinated features / connector pairs — no negated feature is ever applied as a "with" filter */
const MULTI=[['hub no hdmi no vga','hub'],['hub no hdmi nor vga','hub'],['hub walang hdmi walang ethernet','hub'],['hub without vga without lan','hub'],['hub wag hdmi wag lan','hub'],
  ['charger no usb-a no usb-c','charger'],['hub without hdmi or vga','hub'],['hub na walang hdmi at vga','hub'],['hub walang usb-c to hdmi','hub'],['charger not car and not white','charger'],
  ['hub no hdmi and 4 ports','4 ports hub'],['white charger at hindi car','white charger'],
  /* review round 3: connectors that can also start a product phrase (hdmi, lan, ethernet), two-word connectors, "ni", 3-way */
  ['hub no vga nor hdmi','hub'],['hub walang vga o hdmi','hub'],['hub walang vga ni hdmi','hub'],['hub without vga or lan','hub'],['hub walang vga at lan','hub'],
  ['hub without vga or ethernet','hub'],['hub without usb-a or hdmi','hub'],['hub walang hdmi ni vga','hub'],['charger walang usb-a ni usb-c','charger'],['hub no hdmi or vga or lan','hub'],
  ['hub without hdmi or charger','hub'],['charger no usb-a or 65w','65w charger'],
  /* review round 4: two-word features, resolutions, a skipped existence phrase never hides a later negation */
  ['hub without sd card or hdmi','hub'],['hub walang sd card at hdmi','hub'],['hdmi cable walang 4k or 8k','hdmi cable'],['kayo walang hub na walang vga?','hub'],
  ['walang hub na walang vga?','hub'],['do you not have hub without vga?','hub'],['hub no hdmi or usb-c hub','hub with usb-c']].map(([q,b])=>({ x:one(q), b:bc(b) }));
chk('B3e multiple / coordinated negations and connector pairs: the positive search only (every negated feature reported, none applied)',
  MULTI.every(o=>o.b.length && sortedEq(o.x.r.codes,o.b) && NOT_APPLIED.test(o.x.r.note)), MULTI.filter(o=>!sortedEq(o.x.r.codes,o.b)).map(o=>txt(o.x)).join(' || '));
const NCOUNT=[['hub no hdmi no vga',2],['hub walang vga o hdmi',2],['hub no hdmi or vga or lan',3],['charger walang usb-a ni usb-c',2],['hub without hdmi and 4 ports',1],['hub without hdmi or charger',1]].map(([q,n])=>({ x:one(q), n }));
chk('B3e2 every negated feature is reported separately (plan.negated count), product phrases / number specs after "and/or" are not negated',
  NCOUNT.every(o=>(o.x.r.plan.negated||[]).length===o.n), NCOUNT.map(o=>o.x.q+':'+(o.x.r.plan.negated||[]).map(n=>n.phrase).join('|')).join(' ; '));
const mu=one('cable walang lightning o micro usb');
chk('B3e3 a two-word connector is coordinated too ("walang lightning o micro usb": never Micro USB cables)', (mu.r.plan.negated||[]).length===2 && !mu.r.codes.some(c=>/micro/i.test(String(byCode[c].product_name))) , txt(mu));
const STRICT=['not white nor black cable','not usb-a nor usb-c cable','not hdmi nor dp cable','not white or black cable','cable walang micro usb','cable no micro usb or lightning'].map(one);
chk('B3e4 after "nor" nothing stays positive; "or black cable" (colour + form) is negated; a two-word connector is one negated term — never a list of the excluded item',
  STRICT.every(x=>(x.r.plan.negated||[]).length>=1 && NOT_APPLIED.test(x.r.note) && !x.r.codes.some(c=>/black|usb-c|displayport|micro/i.test(String(byCode[c].product_name)+' '+String(byCode[c].color||'')))),
  STRICT.map(x=>txt(x)+' neg='+(x.r.plan.negated||[]).map(n=>n.phrase).join('|')).join(' || '));
const EXQ2=[['you have no 65w charger?','65w charger'],['kayo walang 65w charger?','65w charger'],['kayo po walang hub?','hub'],['i have no hdmi port, need adapter','hdmi adapter'],
  ['kayo ba walang hub?','hub'],['kayo ba walang 65w charger?','65w charger'],['kayo po ba walang hub?','hub'],['sir kayo walang hub?','hub'],['ikaw walang hub?','hub'],['you guys have no hub?','hub'],
  ['do you not have a 65w charger?','65w charger']].map(([q,b])=>({ x:one(q), b:bc(b) }));
chk('B3f existence / own-device phrasings ("you have no …?", "kayo (po) walang …?", "i have no hdmi port, need adapter") are never product negations',
  EXQ2.every(o=>!(o.x.r.plan.negated||[]).length && o.x.r.codes.length && sortedEq(o.x.r.codes,o.b)), EXQ2.map(o=>txt(o.x)).join(' || '));
const cel=one('cable except lightning');
chk('B3b "cable except lightning" (bare form): asks which cable AND keeps the not-applied note', isClarify(cel) && NOT_APPLIED.test(cel.r.note) && !FALSE_WALA.test(cel.r.note), txt(cel));
/* B4 follow-up negation inherits the last search (never "We don't have", never keeps a negated inherited constraint) */
const F1=last(['65W charger','not white']), F2=last(['hub','walang hdmi']), F3=last(['white charger','not white']), F4=last(['65W charger','hindi car']);
chk('B4 "65W charger" → "not white": the 65W search again + not-applied note (was a false "We don’t have a white 65W charger")', sortedEq(F1.r.codes,c65) && NOT_APPLIED.test(F1.r.note) && !FALSE_WALA.test(F1.r.note), txt(F1));
chk('B4b "hub" → "walang hdmi": the hub search again, never only HDMI hubs', sortedEq(F2.r.codes,bc('hub')) && NOT_APPLIED.test(F2.r.note), txt(F2));
chk('B4c "white charger" → "not white": the inherited "white" is dropped (never white-only), plain chargers + note', sortedEq(F3.r.codes,bc('charger')) && NOT_APPLIED.test(F3.r.note), txt(F3));
chk('B4d "65W charger" → "hindi car": the 65W search again + note', sortedEq(F4.r.codes,c65) && NOT_APPLIED.test(F4.r.note), txt(F4));
/* review round 5: a negation follow-up introduced by a supported cue keeps the conversation ("how about …", "alin dun …", "which of those …") */
const CUEF=[[['65W charger','how about not white?'],'65W charger'],[['hub','how about no vga?'],'hub'],[['hub','alin dun walang vga'],'hub'],[['hub','which of those no hdmi'],'hub'],
  [['hub','which of those has no vga'],'hub'],[['hdmi cable','how about not 8k?'],'hdmi cable'],[['charger','how about hindi white o black'],'charger']].map(([t,b])=>({ x:last(t), b:bc(b) }));
chk('B4f a negation follow-up after a cue ("how about not white?", "alin dun walang vga", "which of those no hdmi") re-answers the last search + note (never a generic clarify)',
  CUEF.every(o=>o.b.length && sortedEq(o.x.r.codes,o.b) && NOT_APPLIED.test(o.x.r.note)), CUEF.filter(o=>!sortedEq(o.x.r.codes,o.b)).map(o=>txt(o.x)).join(' || '));
const CUEN=[last(['65W charger','how about a power bank?']), last(['65W charger','how about 100w?'])];
chk('B4g cue follow-ups without a negation are unchanged ("how about a power bank?" = power banks, "how about 100w?" = 100W chargers)',
  CUEN[0].r.codes.length && CUEN[0].r.codes.every(c=>fam(c)==='power_bank') && CUEN[1].r.codes.length && CUEN[1].r.codes.every(c=>IDX.byCode[c].attrs.watts.value===100) && CUEN.every(x=>!(x.r.plan.negated||[]).length), CUEN.map(txt).join(' || '));
/* review round 6: pronoun-subject questions + a negation never fall into a per-noun "We don't have any one / Wala tayong isa" */
const PRON=[['hub','do you have one without vga'],['hub','do you have one with no vga'],['charger','do you have one with no cable'],['charger','do you have one without cable'],['power bank','do you have one with no cable'],
  ['65W charger','do you have one that is not white'],['65W charger','do you have one not white'],['hub','may isa ba na walang hdmi'],['charger','meron ba kayong isa na walang usb-a'],['do you have one with no cable'],
  ['do you have anything without vga'],['do you have something without vga'],['hub','is there anything without vga']].map(t=>last(t));
chk('B4h "do you have one / anything / something …", "may isa ba na …", "meron ba kayong isa na …" + a negation: never a "We don’t have any one" / "Wala tayong isa" — the last search + note, or a clarify',
  PRON.every(x=>!FALSE_WALA.test(x.r.note) && !/any one|any anything|any something|tayong isa/.test(x.r.note) && (x.r.codes.length ? NOT_APPLIED.test(x.r.note) : isClarify(x))), PRON.filter(x=>FALSE_WALA.test(x.r.note)||/any one|tayong isa/.test(x.r.note)).map(txt).join(' || '));
const PRC=last(['hub','do you have one without vga']);
chk('B4i "hub" → "do you have one without vga" re-answers the hub search', sortedEq(PRC.r.codes,bc('hub')), txt(PRC));
const qo=one('walang hdmi');
chk('B4e a negated qualifier with no product and no context → clarify the product type (+ note), no codes', isClarify(qo) && !qo.r.codes.length && NOT_APPLIED.test(qo.r.note), txt(qo));
/* B5 guards: these are NOT product negations and behave as before (nothing reported as negated) */
const adapterModel=String((PUB.find(p=>fam(String(p.item_code))==='video_adapter' && p.model)||{}).model||'');
const GUARDS=['dock no need DisplayLink','hub no need displaylink','wala pang 500 cable','cable not more than 500','walang anuman','wala ba kayong 65w charger','hindi ba compatible sa iphone ang '+BASE,
  'di ba may 65w charger kayo','hindi ko alam','not sure','no thanks','hub kahit ilang ports','hub any number of ports','pwede ba ang '+adapterModel+' sa projector na walang wifi?',
  'para sa laptop na walang hdmi','same capacity as '+BASE+' pero may built-in cable','not a full dock','may keyboard kayo?','hindi po, 65w charger','noise cancelling earbuds'];
const B5=GUARDS.map(one).concat(['walang stock?','in stock ba?','hindi kailangan ng hdmi','hindi po','wala po','tv ko walang wifi'].map(q=>last(['65w charger',q])));
chk('B5 guard phrases are never treated as product negation (nothing negated, no not-applied note)', adapterModel && B5.every(x=>!(x.r.plan.negated||[]).length && !NOT_APPLIED.test(x.r.note)), B5.filter(x=>(x.r.plan.negated||[]).length).map(txt).join(' || '));
const dl=B5[0], fd=B5[16], kb=B5[17], hp=B5[18];
chk('B5b guard behaviour: DisplayLink relax lists docks; "not a full dock" = hub alias; "may keyboard kayo?" stays an honest negative; "hindi po, 65w charger" = 65W chargers',
  dl.r.codes.length && fd.r.plan.type && fd.r.plan.type.id==='hub_dock.hub' && fd.r.codes.length && /keyboard/i.test(kb.r.note) && !kb.r.codes.length && sortedEq(hp.r.codes,c65), [dl,fd,kb,hp].map(txt).join(' || '));
/* B6 generated inversion grid: "<type> <negator> <feature>" never returns the positive "<type> with <feature>" set; it is the plain type
   (not applied, said so) or a clarification; the negated sweep has 0 false "wala" */
const TY=['charger','hub','power bank','hdmi cable','usb c cable','earbuds'], FE=['hdmi','usb a','usb-c','built-in cable','white','car','wireless','magnetic','pd','65w','lightning','pink'];
const TPL=['%T na walang %F','%T without %F','%T no %F','%T not %F','%T pero hindi %F','%T except %F','%T na hindi %F','not %F %T','ayoko ng %F na %T','%T maliban sa %F','%T other than %F'];
let cells=0, inverted=[], wrong=[], fw=[], silent=[];
TY.forEach(t=>{ const b=bc(t); FE.forEach(f=>{ const pos=bc(t+' with '+f); const informative=pos.length && !sortedEq(pos,b);
  TPL.forEach(p=>{ const q=p.replace('%T',t).replace('%F',f), x=one(q); cells++;
    if(informative && x.r.codes.length && sortedEq(x.r.codes,pos)) inverted.push(q);
    if(!(isClarify(x) && !x.r.codes.length) && !sortedEq(x.r.codes,b)) wrong.push(txt(x));
    if(FALSE_WALA.test(x.r.note)) fw.push(txt(x));
    if(!NOT_APPLIED.test(x.r.note) && !/instead|hanap mo/.test(x.r.note)) silent.push(q); }); }); });
chk('B6 inversion grid ('+cells+' generated cells): 0 cells return the positive "<type> with <feature>" set', !inverted.length, inverted.slice(0,12).join(' | '));
chk('B6b every grid cell is the plain type set (negated term not applied) or a clarification', !wrong.length, wrong.slice(0,6).join(' || '));
chk('B6c false-"wala" sweep over the grid: 0 "We don’t have / Wala tayong / can’t find" answers', !fw.length, fw.slice(0,6).join(' || '));
chk('B6d every negated grid answer says the exclusion is not applied (or asks what they want instead)', !silent.length, silent.slice(0,12).join(' | '));

/* ================= C  version / model numbers are not a price question ================= */
const VERS=['Gen 4','gen 3','gen 5','usb 3.2 gen 1','usb 3.0','bluetooth 5.3','bt 5.3','wifi 6','iphone 15','ipad 10','windows 11','qc 3.0','pd 3.0','pcie gen 4','macbook pro 14','sata 3','pixel 8','version 2'];
const C1=VERS.map(one);
chk('C1 version / model numbers standalone: no "under ₱N" chip or question, no number ambiguity', C1.every(x=>!priceChip(x) && !numAmb(x)), C1.filter(x=>priceChip(x)||numAmb(x)).map(txt).join(' || '));
const CTX=[['pcie card','gen 4'],['pcie card','Gen 3'],['usb c hub','gen 2'],['usb c hub','usb 3.2 gen 2'],['earbuds','bluetooth 5.3'],['usb c cable','usb 3.2 gen 1'],['usb c cable','usb 3.0'],['65W charger','qc 3.0'],['65W charger','gen 4'],['power bank','gen 4'],['hdmi cable','gen 4']];
const C2=CTX.map(t=>({ t, x:last(t), fams:new Set(one(t[0]).r.codes.map(fam)) }));
const inCtx=o=>o.x.r.codes.length && o.x.r.codes.every(c=>o.fams.has(fam(c)));
chk('C2 as follow-ups: no price chip / question and the context is kept (results stay within the previous search’s families)',
  C2.every(o=>!priceChip(o.x) && !numAmb(o.x) && inCtx(o)), C2.filter(o=>!inCtx(o) || priceChip(o.x)).map(o=>txt(o.x)).join(' || '));
const ip=last(['charger','iphone 15']);
chk('C2b "charger" → "iphone 15": a device question, never "under ₱15"', !priceChip(ip) && !numAmb(ip), txt(ip));
/* controls: real unit-less numbers still clarify, with the same chips */
const n4=last(['hdmi cable','4']), n100=last(['65W charger','how about 100?']), s100=one('100'), n20=last(['power bank','20']);
const lab=x=>(x.r.chips||[]).map(c=>c.label);
chk('C3 bare numbers unchanged: "hdmi cable" → "4" = 4m or under ₱4; "how about 100?" = 100W / under ₱100; "100" = under ₱100; "power bank" → "20" = 20,000mAh',
  lab(n4).includes('4m') && lab(n4).some(l=>/₱4$/.test(l)) && lab(n100).includes('100W') && lab(n100).some(l=>/₱100$/.test(l)) && lab(s100).some(l=>/₱100$/.test(l)) && lab(n20).includes('20,000mAh'),
  [n4,n100,s100,n20].map(x=>txt(x)+' chips='+lab(x).join('/')).join(' || '));
const pro=last(['charger','pro 100']);
chk('C3c a number after a non-version word stays a real bare number ("charger" → "pro 100" still offers 100W / under ₱100)', lab(pro).includes('100W'), txt(pro)+' chips='+lab(pro).join('/'));
const c4=['charger 4 ports','hdmi cable 4m'].map(one);
chk('C3b numbers with units unchanged ("4 ports", "4m" are specs, never a price)', c4.every(x=>!priceChip(x) && !(x.r.plan.filters||[]).some(f=>f.attr==='price')), c4.map(txt).join(' || '));

/* ================= global invariants over every turn answered above ================= */
const nullTurns=SEEN.filter(x=>(x.r.codes||[]).some(c=>c==null || String(c)==='' || !byCode[String(c)]));
chk('G1 null-code invariant: '+SEEN.length+' turns — no null / undefined / unknown code in any response', !nullTurns.length, nullTurns.slice(0,5).map(txt).join(' || '));
const bad=SEEN.filter(x=>[x.r.note,x.r.stockNote,x.r.echo].some(s=>s && MALFORMED.test(s)));
chk('G2 no malformed text ("Here’s ;", "Heto ang ;", "{code}", "undefined", "null") in any note / stock note / echo', !bad.length, bad.slice(0,5).map(txt).join(' || '));
const ctxBad=SEEN.filter(x=>x.ctx && ['focus','results','comparison'].some(k=>(x.ctx[k]||[]).some(c=>c==null)));
chk('G3 the next-turn context never stores a null code', !ctxBad.length, ctxBad.slice(0,5).map(txt).join(' || '));
const aiLeak=SEEN.filter(x=>x.a.route!=='local' && !/compat|recommend/.test(x.r.plan.intent));
chk('G4 every A / B / C turn stays LOCAL except device-compatibility questions (no new AI routing)', !aiLeak.length, aiLeak.slice(0,5).map(txt).join(' || '));

console.log('\nVERO p2r3a.4 fixes: '+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
