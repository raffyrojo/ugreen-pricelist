/* VERO NEW-P2R3A-STOCK-1 (live p2r3a fix, baseline d6b8bd34) — product line + wattage + stock / existence wording must compose.
   Run: node tests/vero-p2r3a-stock1.test.js        (runs the cases, then the built-in mutants; exit 1 on any failure / survivor)
   Root causes fixed:
     1  js/vero-plan.js findNames: a parsed wattage at the EDGE of a name window glued itself into the name phrase
        ("65w robot gan" matched only the one name that spells "65W Robot GaN" contiguously) — word-order dependent.
     2  js/vero-compose.js: an existence question about a line showed the whole subject verbatim and dropped the executor's
        wattage-narrowed set ("may stock ba ng robot gan 65w?" listed the 30W SKUs too).
     3  (fix round 1) a stock-count question ("ilan ang stock ng robot gan 65w?", "how many robot gan 65w in stock?") is planned
        as a stock LOOKUP and had the same compose defect; it follows the same rule and keeps the "listed" framing (never a
        bare "3 …" that reads like a stock count).
   Equivalent mutants (documented, not tested): dropping R.executor==='subject' or reducing the set comparison to a length
   check (a subject executor only ever returns a subset of the subject); narrowing every non-stock lookup too (0 of 5,630
   generated queries reach a non-stock lookup narrowed by wattage); a spec guard at any window position; removing only the
   TRAILING half of the edge guard (specToks[win[win.length-1]]) — defensive: no current product name has a name phrase
   directly followed by a wattage, so a trailing "65w" never extends a window today (0 of 61,065 QA-generated queries differ).
   Stock / existence intent only frames the answer (listed + no-live-inventory caveat); it never changes product eligibility.
   Expectations are DERIVED from data/products.json (product line by name, wattage from the facts index); no SKU list is
   hardcoded. A zero result on a line (a wattage that removes every SKU), single-SKU feature questions and non-wattage qualifiers
   (length, colour — out of this checkpoint's scope) keep the baseline answer. */
const fs=require('fs'), path=require('path'), os=require('os'), cp=require('child_process');
const ROOT=path.join(__dirname,'..'), CODE=process.env.STOCK1_CODE_ROOT||ROOT, MUTANT=process.env.STOCK1_MUTANT||'';
global.window={ PRICE_SETTINGS:{ indicatorDays:30 } };
eval(fs.readFileSync(path.join(CODE,'js','helpers.js'),'utf8'));
['vero-lexicon','vero-nlu','vero-facts','vero-plan','vero-compose'].forEach(f=>require(path.join(CODE,'js',f+'.js')));
const E=require(path.join(CODE,'js','vero-engine.js'));
const F=require(path.join(CODE,'js','vero-facts.js'));
const ALL=JSON.parse(fs.readFileSync(path.join(ROOT,'data','products.json'),'utf8')); pcResolveSchedule(ALL);
const PUB=ALL.filter(p=>!p.disabled), IDX=F.build(PUB);
let pass=0, fail=0; const chk=(n,c,x)=>{ if(c){ pass++; if(!MUTANT) console.log('PASS - '+n); } else { fail++; console.log('FAIL - '+n+(x!==undefined?'  -> '+String(x).slice(0,500):'')); } };
function chat(turns){ let conv=null; return turns.map(q=>{ const r=E.answer(PUB,q,{ conv }); if(r.ctxOut) conv=r.ctxOut; return { q, r, ctx:conv }; }); }
const one=q=>chat([q])[0];
const txt=x=>x.q+' => ['+(x.r.plan&&x.r.plan.intent)+'] '+(x.r.note||'')+' | '+(x.r.codes||[]).join(',');
const S=a=>JSON.stringify([...a].map(String).sort());
const sameSet=(a,b)=>S(a)===S(b);
const watts=c=>IDX.byCode[c]&&IDX.byCode[c].attrs.watts.value;

/* derived fixtures: the "Robot GaN" line = published names carrying the words "robot gan"; per-wattage subsets from the index */
const LINE=PUB.filter(p=>/\brobot\s+gan\b/i.test(String(p.product_name).replace(/\s+/g,' '))).map(p=>String(p.item_code));
const W65=LINE.filter(c=>watts(c)===65), W30=LINE.filter(c=>watts(c)===30);
chk('F0 fixtures derived from the catalogue: a Robot GaN line with both 65W and 30W SKUs (else this test proves nothing)',
  W65.length>=2 && W30.length>=1 && LINE.length>W65.length, 'line '+LINE.join(',')+' | 65W '+W65.join(',')+' | 30W '+W30.join(','));

const STOCK_CAVEAT=/live inventory/i;
const FAKE_QTY=/\b\d+\s*(?:pcs|pieces|piraso|units?|stocks?|left|remaining|natitira|available)\b|\b(?:in stock|out of stock|available ngayon|may stock pa|ubos na|sold out)\b/i;
const FALSE_WALA=/We don’t have|Wala tayong|Walang .* sa current|No .* is listed|Hindi ko makita|can’t find|0 —/;
const noFake=x=>!FAKE_QTY.test(x.r.note||'') && !FAKE_QTY.test(x.r.stockNote||'');
const stockOk=x=>STOCK_CAVEAT.test(x.r.stockNote||'') && (x.r.plan.result.caveats||[]).indexOf('stock')>=0 && noFake(x);

/* A baseline family + wattage */
const A=one('robot gan 65w');
chk('A "robot gan 65w" → exactly the derived 65W Robot GaN set ('+W65.length+')', sameSet(A.r.codes,W65), txt(A));
/* B Tagalog stock phrasing */
const B=one('may stock ba ng robot gan 65w?');
chk('B "may stock ba ng robot gan 65w?" → same set as A', sameSet(B.r.codes,A.r.codes), txt(B));
chk('B2 stock caveat present (no live inventory), no fake quantity, listed framing', stockOk(B) && /Naka-lista|listed/i.test(B.r.note), txt(B)+' | '+B.r.stockNote);
/* C Tagalog existence phrasing (no stock word) */
const C=one('may robot gan 65w ba?');
chk('C "may robot gan 65w ba?" → same set as A, honest yes framing (no "wala")', sameSet(C.r.codes,A.r.codes) && !FALSE_WALA.test(C.r.note), txt(C));
const C2=one('do you have robot gan 65w?');
chk('C2 a narrowed existence question WITHOUT stock wording keeps the existence framing ("Meron — …" / "Yes — …"), not the stock "listed" sentence, and no stock caveat',
  /^Meron — /.test(C.r.note) && /^Yes — /.test(C2.r.note) && sameSet(C2.r.codes,A.r.codes) && !C.r.stockNote && !C2.r.stockNote, [C,C2].map(txt).join(' || '));
/* D English stock phrasing, wattage BEFORE the line name */
const D=one('is there stock of 65w robot gan?');
chk('D "is there stock of 65w robot gan?" → same set as A', sameSet(D.r.codes,A.r.codes), txt(D));
chk('D2 stock caveat present, no fake quantity', stockOk(D), txt(D)+' | '+D.r.stockNote);
/* D3 word order alone (no stock wording) */
const D3=[one('65w robot gan'),one('meron ba kayong 65w robot gan?'),one('do you have robot gan 65w?'),one('any 65w robot gan in stock?'),one('may stock ba ng robot gan 65 w?')];
chk('D3 word order / phrasing variants ("65w robot gan", "meron ba kayong 65w robot gan?", "do you have robot gan 65w?", "any 65w robot gan in stock?", "65 w") → same set as A',
  D3.every(x=>sameSet(x.r.codes,A.r.codes)), D3.filter(x=>!sameSet(x.r.codes,A.r.codes)).map(txt).join(' || '));
chk('D4 the name phrase never absorbs the parsed wattage: anchor is the line name, the watts filter stays a filter',
  [A,B,C,D].concat(D3).every(x=>x.r.plan.anchors.every(a=>!/\b65\s?w\b/.test(a.raw)) && x.r.plan.filters.some(f=>f.attr==='watts'&&f.value===65)), [A,B,C,D].concat(D3).map(x=>x.q+':'+JSON.stringify(x.r.plan.anchors.map(a=>a.raw))).join(' '));
/* E generic wattage stock query (no line name) keeps its existing behaviour */
const E1=one('may stock ba ng 65w charger?'), E0=one('65W charger');
chk('E "may stock ba ng 65w charger?" → the same set as "65W charger", every code 65W, stock caveat', sameSet(E1.r.codes,E0.r.codes) && E1.r.codes.length && E1.r.codes.every(c=>watts(c)===65) && stockOk(E1), txt(E1));
/* F / G 30W */
const Fq=one('robot gan 30w');
chk('F "robot gan 30w" → exactly the derived 30W Robot GaN set ('+W30.length+')', sameSet(Fq.r.codes,W30), txt(Fq));
const G=[one('may stock ba ng robot gan 30w?'),one('may stock ba ng 30w robot gan?'),one('is there stock of robot gan 30w?')];
chk('G 30W stock phrasings → same set as F, no 65W leakage, stock caveat', G.every(x=>sameSet(x.r.codes,Fq.r.codes) && x.r.codes.every(c=>watts(c)===30) && stockOk(x)), G.map(txt).join(' || '));
chk('G2 30W and 65W never mixed in any answer above', [A,B,C,D,Fq].concat(D3,G).every(x=>new Set(x.r.codes.map(watts)).size===1), [A,B,C,D,Fq].concat(D3,G).map(txt).join(' || '));
/* H no wattage: the existing broad line answer is preserved (all line SKUs, same "listed" sentence) */
const H=one('may stock ba ng robot gan?'), H2=one('is there stock of robot gan?');
const lineSubject=H.r.plan.subject;
chk('H "may stock ba ng robot gan?" → the whole line (subject verbatim, both wattages), "Naka-lista ang …" sentence, stock caveat',
  lineSubject.length===W65.length+W30.length && sameSet(H.r.codes,lineSubject) && /^Naka-lista ang /.test(H.r.note) && stockOk(H), txt(H));
chk('H2 English no-wattage line stock question keeps the subject answer', sameSet(H2.r.codes,lineSubject) && / is listed in the current pricelist\.$/.test(H2.r.note) && stockOk(H2), txt(H2));
/* I no-inventory safety on every stock query in this file */
const STOCKQ=[B,D,E1,H,H2].concat(G,[D3[3],D3[4]]);   /* J* stock-count answers are checked in J2 */
chk('I every stock question keeps the no-live-inventory caveat and never states a quantity / stock state', STOCKQ.every(stockOk), STOCKQ.filter(x=>!stockOk(x)).map(x=>txt(x)+' | '+x.r.stockNote).join(' || '));
/* controls: what the fix must NOT change */
const Z=[one('may stock ba ng robot gan 100w?'),one('may robot gan 20w ba?')];
chk('Z1 a spec that removes every line SKU never becomes a "wala" (name anchors only partly identify a line; baseline subject answer kept)',
  Z.every(x=>!FALSE_WALA.test(x.r.note) && sameSet(x.r.codes,lineSubject)), Z.map(txt).join(' || '));
const SK=[one('May PD ba ang X755?')];
chk('Z2 single-SKU feature question ("May PD ba ang X755?") keeps the subject answer (never a "wala" from unknown evidence)',
  SK.every(x=>x.r.codes.length===1 && !FALSE_WALA.test(x.r.note)), SK.map(txt).join(' || '));
/* J (fix round 1) stock-count wording → same sets, "listed" framing, quantity caveat, never a count */
const J65=['ilan ang stock ng robot gan 65w?','how many robot gan 65w in stock?','how many stock of robot gan 65w?','ilan ang stock ng 65w robot gan?'].map(one);
chk('J stock-count phrasings ("ilan ang stock ng …", "how many … in stock?", word order) → same set as A', J65.every(x=>sameSet(x.r.codes,A.r.codes)), J65.filter(x=>!sameSet(x.r.codes,A.r.codes)).map(txt).join(' || '));
const J30=one('ilan ang stock ng robot gan 30w?');
chk('J1 "ilan ang stock ng robot gan 30w?" → same set as F, no 65W', sameSet(J30.r.codes,Fq.r.codes), txt(J30));
const JJ=J65.concat([J30]);
chk('J2 stock-count answers use the "listed" framing (never a leading number that reads as a stock count) + the quantity caveat, no fake quantity',
  JJ.every(x=>/Naka-lista|listed/i.test(x.r.note) && !/^\s*\d/.test(x.r.note) && stockOk(x) && /ilan|how many/i.test(x.r.stockNote)), JJ.map(x=>txt(x)+' | '+x.r.stockNote).join(' || '));
const JH=one('ilan ang stock ng robot gan?'), JZ=one('ilan ang stock ng robot gan 100w?');
chk('J3 stock-count without wattage / with a wattage that removes every line SKU keeps the baseline subject answer', sameSet(JH.r.codes,lineSubject) && /^Naka-lista ang /.test(JH.r.note) && sameSet(JZ.r.codes,lineSubject) && !FALSE_WALA.test(JZ.r.note), [JH,JZ].map(txt).join(' || '));
/* scope controls (derived): a model whose SKUs differ in length / colour — those qualifiers are NOT part of this fix */
const MODELS={}; PUB.forEach(p=>{ const m=String(p.model||'').trim(); if(m) (MODELS[m]=MODELS[m]||[]).push(String(p.item_code)); });
const partial=q=>Object.keys(MODELS).filter(m=>MODELS[m].length>=2).map(m=>one(q.replace('{m}',m))).filter(x=>x.r.plan.intent==='exist' && x.r.plan.subject.length>=2 && x.r.plan.result.executor==='subject' && x.r.plan.result.codes.length>0 && x.r.plan.result.codes.length<x.r.plan.subject.length)[0];
const LEN=partial('may 2m ba ng {m}?'), COL=partial('may black ba ng {m}?');
chk('Z5 out of scope, unchanged: a length qualifier on a model existence question keeps the model answer ('+(LEN?LEN.q:'no fixture')+')', LEN && sameSet(LEN.r.codes,LEN.r.plan.subject), LEN&&txt(LEN));
chk('Z6 out of scope, unchanged: a colour qualifier on a model existence question keeps the model answer ('+(COL?COL.q:'no fixture')+')', COL && sameSet(COL.r.codes,COL.r.plan.subject), COL&&txt(COL));
const TS=PUB.some(p=>/\btripod stand 1\.7m\b/i.test(String(p.product_name).replace(/\s+/g,' '))), Z7=one('may stock ba ng tripod stand 1.7m?');
chk('Z7 out of scope, unchanged: a LENGTH at the edge of a name phrase still belongs to the name phrase (only a parsed wattage is kept out)',
  TS && Z7.r.plan.anchors.some(a=>/\b1\.7m\b/.test(a.raw)), TS?JSON.stringify(Z7.r.plan.anchors.map(a=>a.raw))+' '+txt(Z7):'fixture missing: no "tripod stand 1.7m" product name');
const ch=chat(['may stock ba ng robot gan 65w?','how much']);
chk('Z3 the follow-up after B uses the narrowed 65W set as context', sameSet(ch[0].ctx.results||[],A.r.codes) && sameSet(ch[1].r.codes,A.r.codes), ch.map(txt).join(' || '));
chk('Z4 every answer is local (no AI route, no network) for these catalogue questions', [A,B,C,D,E1,Fq,H].concat(D3,G).every(x=>x.r.plan.route.route==='LOCAL'), '');

console.log((MUTANT?'['+MUTANT+'] ':'')+'VERO NEW-P2R3A-STOCK-1: '+pass+' passed, '+fail+' failed');

/* ===================== mutation tests: each broken variant must fail at least one case above ===================== */
if(!MUTANT){
  const M=[
    ['wattage dropped under stock intent (compose shows the line subject for every existence question)','js/vero-compose.js',
      "var subjNarrowed=(I==='exist' || (I==='lookup' && plan.flags.stock)) && plan.subject.length","var subjNarrowed=false && plan.subject.length"],
    ['stock-count lookup not narrowed (fix round 1 reverted)','js/vero-compose.js',
      "var subjNarrowed=(I==='exist' || (I==='lookup' && plan.flags.stock))","var subjNarrowed=(I==='exist')"],
    ['stock-count answer framed as a bare count ("3 65W GaN chargers:")','js/vero-compose.js',
      "if(plan.flags.stock && (I==='exist'||I==='count'||I==='list'||subjNarrowed)) res.note=","if(plan.flags.stock && (I==='exist'||I==='count'||I==='list')) res.note="],
    ['stock "listed" framing used for every narrowed answer, even without stock wording','js/vero-compose.js',
      "if(plan.flags.stock && (I==='exist'||I==='count'||I==='list'||subjNarrowed)) res.note=","if((plan.flags.stock||subjNarrowed) && (I==='exist'||I==='count'||I==='list'||subjNarrowed)) res.note="],
    ['length also kept out of name phrases (name guard widened beyond wattage)','js/vero-plan.js',
      "if(f.attr==='watts') nameToks","if(f.attr==='watts'||f.attr==='lengthM'||f.attr==='mah') nameToks"],
    ['wattage glued into the name phrase before the filter runs (edge guard removed)','js/vero-plan.js',
      "if(win.length>1 && (specToks[win[0]] || specToks[win[win.length-1]])) continue;",""],
    ['English word order: only a trailing spec is kept out of the name phrase','js/vero-plan.js',
      "(specToks[win[0]] || specToks[win[win.length-1]])","(specToks[win[win.length-1]])"],
    ['family alias dropped under stock / existence intent','js/vero-plan.js',
      "plan.anchors.push({ raw:n.text, via:'name', codes:n.codes.slice() });","if(!/\\b(?:stock|may|there)\\b/.test(X.t)) plan.anchors.push({ raw:n.text, via:'name', codes:n.codes.slice() });"],
    ['30W and 65W mixed (watts filter ignored on a subject)','js/vero-plan.js',
      "plan.filters.forEach(function(f){ if(!fail) take(numCheck(F,f,p)); });","plan.filters.forEach(function(f){ if(!fail && !(fromSubject && f.attr==='watts')) take(numCheck(F,f,p)); });"],
    ['stock caveat removed','js/vero-compose.js',
      "if(plan.flags.stock) res.stockNote=T(lang,plan.flags.invQty?'stockQty':'stock');",""],
    ['fake inventory quantity introduced','js/vero-compose.js',
      "if(plan.flags.stock) res.stockNote=T(lang,plan.flags.invQty?'stockQty':'stock');","if(plan.flags.stock) res.stockNote=T(lang,plan.flags.invQty?'stockQty':'stock')+' 12 units left.';"],
    ['zero-result narrowing turned into a "wala" (R.codes.length>0 guard removed)','js/vero-compose.js',
      "R.executor==='subject' && R.codes.length>0 &&","R.executor==='subject' &&"],
    ['any qualifier narrows an existence answer (wattage-only guard removed)','js/vero-compose.js',
      "plan.filters.some(function(f){ return f.attr==='watts'; }) &&",""],
    ['length / mAh also narrow an existence answer (guard widened beyond wattage)','js/vero-compose.js',
      "plan.filters.some(function(f){ return f.attr==='watts'; })","plan.filters.some(function(f){ return f.attr==='watts'||f.attr==='mah'||f.attr==='lengthM'; })"],
  ];
  let killed=0;
  M.forEach(function(m,i){
    const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'stock1-mut-')); fs.mkdirSync(path.join(tmp,'js'));
    fs.readdirSync(path.join(ROOT,'js')).forEach(f=>fs.copyFileSync(path.join(ROOT,'js',f),path.join(tmp,'js',f)));
    const fp=path.join(tmp,m[1]), src=fs.readFileSync(fp,'utf8');
    if(src.split(m[2]).length!==2){ console.log('FAIL - mutant M'+(i+1)+' anchor not found exactly once: '+m[0]); fail++; fs.rmSync(tmp,{ recursive:true, force:true }); return; }
    fs.writeFileSync(fp,src.replace(m[2],m[3]));
    const r=cp.spawnSync(process.execPath,[__filename],{ env:Object.assign({},process.env,{ STOCK1_CODE_ROOT:tmp, STOCK1_MUTANT:'M'+(i+1) }), encoding:'utf8' });
    const out=(r.stdout||'')+(r.stderr||''), died=r.status!==0;
    const firstFail=(out.split('\n').filter(l=>/^FAIL/.test(l))[0]||out.split('\n').filter(Boolean).slice(-1)[0]||'').slice(0,140);
    if(died){ killed++; console.log('PASS - mutant M'+(i+1)+' killed: '+m[0]+'  ['+firstFail+']'); pass++; }
    else { console.log('FAIL - mutant M'+(i+1)+' SURVIVED: '+m[0]); fail++; }
    fs.rmSync(tmp,{ recursive:true, force:true });
  });
  console.log('Mutants killed: '+killed+'/'+M.length);
  console.log('VERO NEW-P2R3A-STOCK-1 (cases + mutants): '+pass+' passed, '+fail+' failed');
}
process.exit(fail?1:0);
