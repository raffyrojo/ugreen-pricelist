/* UNO branding tests (Node, deterministic, offline). Public assistant name = UNO; internal engineering names stay VERO.
   Run: node tests/uno-branding.test.js
   1. Boots the REAL live UI (index.html load order: helpers + 7 VERO scripts) in a minimal DOM stub with a MOCKED fetch
      (no network) and checks every user-visible string of the assistant surface (innerText, aria-label, title, placeholder,
      alt) in each state: button, drawer, greeting, small talk, AI gate / code form / invalid code, "UNO AI on", thinking,
      answer badge, offer chip, expired session, limit, unavailable.
   2. Source scan: no current user-facing VERO branding in vero.js string literals or the lexicon replies; "and", not "&".
   3. Internal / historical VERO identifiers are kept (allowlist): Vero* globals, vero-* ids/classes, assets/vero/, CONFIG.vero,
      vero_ai_session, [VERO] console tags, window.veroOpen/veroClose/veroAsk, js/vero*.js + css/vero.css, Worker endpoint.
   4. Uno product-line collision: "uno", "uno cable", "uno hub" stay product searches (never small talk; honest "uno" note kept).
   5. Assistant cues: "hi uno", "who is uno", "why is your name uno?", "bakit uno?" … are small talk; VERO cues still work. */
const fs=require('fs'), path=require('path'), vm=require('vm');
const ROOT=path.join(__dirname,'..');
let pass=0, fail=0; const chk=(n,c,x)=>{ if(c){ pass++; console.log('PASS - '+n); } else { fail++; console.log('FAIL - '+n+(x!==undefined?'  -> '+String(typeof x==='string'?x:JSON.stringify(x)).slice(0,400):'')); } };
const rd=f=>fs.readFileSync(path.join(ROOT,f),'utf8');
const RAW=rd('data/products.json');

/* ======================= 1. live UI in a DOM stub ======================= */
const ORDER=['js/vero-lexicon.js','js/vero-nlu.js','js/vero-facts.js','js/vero-plan.js','js/vero-compose.js','js/vero-engine.js','js/vero.js'];
function makeUI(){
  const byId={}, body={ children:[], classList:cls(), appendChild(el){ this.children.push(el); if(el.id) byId[el.id]=el; return el; } };
  function cls(){ const s=new Set(); return { add:(...a)=>a.forEach(x=>s.add(x)), remove:(...a)=>a.forEach(x=>s.delete(x)), contains:x=>s.has(x), toggle:(x,f)=>{ (f===undefined?!s.has(x):f)?s.add(x):s.delete(x); } }; }
  function el(tag){ return { tagName:String(tag).toUpperCase(), id:'', type:'', className:'', title:'', hidden:false, value:'', placeholder:'', innerHTML:'', attrs:{}, listeners:{},
    classList:cls(), style:{ setProperty(){} }, scrollTop:0, scrollHeight:0, clientHeight:0,
    setAttribute(k,v){ this.attrs[k]=String(v); }, getAttribute(k){ return k in this.attrs?this.attrs[k]:null; }, hasAttribute(k){ return k in this.attrs; },
    addEventListener(t,f){ (this.listeners[t]=this.listeners[t]||[]).push(f); }, appendChild(c){ return c; }, focus(){}, querySelector(){ return null; }, querySelectorAll(){ return []; },
    getBoundingClientRect(){ return { top:0, bottom:56, left:0, right:0, width:0, height:0 }; } }; }
  const docListeners={};
  const document={ readyState:'complete', body, documentElement:{ style:{ setProperty(){} } },
    createElement:el, getElementById(id){ if(byId[id]) return byId[id]; if(/^vero-(log|input|disc|cmpbar)$/.test(id) && byId['vero-drawer']) return (byId[id]=el('div')); return null; },
    querySelector(){ return null; }, querySelectorAll(){ return []; }, addEventListener(t,f){ (docListeners[t]=docListeners[t]||[]).push(f); } };
  const net=[], replies=[];
  const store={}; const sessionStorage={ getItem:k=>k in store?store[k]:null, setItem:(k,v)=>{ store[k]=String(v); }, removeItem:k=>{ delete store[k]; } };
  const W={ document, sessionStorage, console, Promise, JSON, Math, Date, Number, String, Array, Object, RegExp, Error, Set, Map, isNaN, parseFloat, parseInt, encodeURIComponent,
    setTimeout:(f)=>{ try{ f(); }catch(_){} return 0; }, clearTimeout(){}, requestAnimationFrame:f=>{ try{ f(); }catch(_){} }, addEventListener(){}, navigator:{ userAgent:'node' },
    fetch(url,opt){ net.push({ url:String(url), body:opt&&opt.body }); const r=replies.shift()||{ status:500, j:{ ok:false, error:'unavailable' } };
      return Promise.resolve({ status:r.status||200, json:()=>Promise.resolve(r.j) }); } };
  W.window=W; W.self=W; W.globalThis=W;
  const ctx=vm.createContext(W);
  vm.runInContext(rd('config.js'),ctx,{ filename:'config.js' });
  vm.runInContext(rd('js/helpers.js'),ctx,{ filename:'helpers.js' });
  vm.runInContext('var ALL_PRODUCTS = '+RAW+'; pcResolveSchedule(ALL_PRODUCTS);',ctx);
  ORDER.forEach(f=>vm.runInContext(rd(f),ctx,{ filename:f }));
  return { W, byId, net, replies, store, docListeners };
}
const flush=()=>new Promise(r=>setImmediate(r));
/* the visible surface: text content + the user-facing attributes of every element inside the assistant UI */
function visible(html){ const h=String(html).replace(/<svg[\s\S]*?<\/svg>/g,' ');
  const attrs=[]; h.replace(/\b(aria-label|title|placeholder|alt)="([^"]*)"/g,(m,k,v)=>{ attrs.push(k+'='+v); return m; });
  const text=h.replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&#39;/g,'\'').replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/\s+/g,' ').trim();
  return { text, attrs }; }
/* the user's own typed messages (.vero-me bubbles) are echoed text, not assistant branding — excluded from the scan */
const noUser=h=>String(h).replace(/<div class="vero-msg vero-me"><div class="vero-bub">[^<]*<\/div><\/div>/g,' ');
function surface(U){ const fab=U.byId['vero-fab'], d=U.byId['vero-drawer'];
  const parts=[visible(fab.innerHTML), visible(d.innerHTML), visible(noUser((U.byId['vero-log']||{}).innerHTML||'')), visible((U.byId['vero-disc']||{}).innerHTML||'')];
  const attrs=[].concat(...parts.map(p=>p.attrs), ['aria-label='+fab.getAttribute('aria-label'), 'title='+fab.title]);
  return { text:parts.map(p=>p.text).join(' | '), attrs }; }
const BAD=/\bvero\b/i;   /* prohibited in the VISIBLE surface (internal ids / classes / file names are not visible and are not scanned) */
const surfaceClean=(U)=>{ const s=surface(U); const hits=[s.text].concat(s.attrs).filter(x=>BAD.test(x)); return { ok:!hits.length, hits }; };
const lastLog=U=>visible(U.byId['vero-log'].innerHTML).text;
function click(U,act,idx){ const d=U.byId['vero-drawer']; const btn={ getAttribute:k=>k==='data-act'?act:(k==='data-idx'?String(idx):null) };
  (d.listeners.click||[]).forEach(f=>f({ target:{ closest:()=>btn }, preventDefault(){} })); }
function enterCode(U,idx,code){ const d=U.byId['vero-drawer'];
  (d.listeners.keydown||[]).forEach(f=>f({ key:'Enter', target:{ hasAttribute:k=>k==='data-unlock', getAttribute:()=>String(idx), value:code }, preventDefault(){} })); }
const idxOf=(U,act)=>{ const m=String(U.byId['vero-log'].innerHTML).match(new RegExp('data-act="'+act+'" data-idx="(\\d+)"')); return m?+m[1]:-1; };

(async function(){
  const U=makeUI(), W=U.W, fab=U.byId['vero-fab'], d=U.byId['vero-drawer'];
  chk('U01 live UI builds from the real load order (button + drawer injected, internal ids kept: #vero-fab, #vero-drawer)', !!fab && !!d && fab.id==='vero-fab' && d.id==='vero-drawer');
  chk('U02 floating button: aria-label "Open UNO, UGREEN Product and Sales Assistant"', fab.getAttribute('aria-label')==='Open UNO, UGREEN Product and Sales Assistant', fab.getAttribute('aria-label'));
  chk('U03 floating button: title + tooltip "Ask UNO"', fab.title==='Ask UNO' && visible(fab.innerHTML).text==='Ask UNO', [fab.title, visible(fab.innerHTML).text]);
  chk('U04 floating button image keeps the unchanged icon asset assets/vero/vero-icon.webp (alt="" decorative)', /src="assets\/vero\/vero-icon\.webp"[^>]*alt=""/.test(fab.innerHTML));
  const dv=visible(d.innerHTML);
  chk('U05 drawer title "UNO ✦" and subtitle "UGREEN Product and Sales Assistant"', /\bUNO ✦/.test(dv.text) && dv.text.includes('UGREEN Product and Sales Assistant') && !/&|AI Product/.test(dv.text.replace('Answers come','')), dv.text);
  chk('U06 drawer aria-labels: "Close UNO", "Ask UNO", "Send"', dv.attrs.includes('aria-label=Close UNO') && dv.attrs.includes('aria-label=Ask UNO') && dv.attrs.includes('aria-label=Send'), dv.attrs);
  W.veroOpen(); await flush();
  chk('U07 greeting "Hi! I’m UNO. …" (happy avatar)', /^Hi! I’m UNO\. I can help you find, compare, and understand UGREEN products\./.test(lastLog(U)) && /vero-happy\.webp/.test(U.byId['vero-log'].innerHTML), lastLog(U));
  let sc=surfaceClean(U); chk('U08 visible surface (text + aria-label/title/placeholder/alt) has no VERO after open', sc.ok, sc.hits);
  W.veroAsk('who are you?'); await flush();
  chk('U09 identity small talk answers as UNO', /I’m UNO, your UGREEN Product and Sales Assistant/.test(lastLog(U)), lastLog(U).slice(-200));
  W.veroAsk('hi vero'); await flush();
  chk('U10 backward-compatible "hi vero" is greeted as UNO (the reply never says VERO)', /Hi! I’m UNO, your UGREEN Product and Sales Assistant/.test(lastLog(U)) && !/I’m VERO/.test(lastLog(U)), lastLog(U).slice(-200));
  chk('U11 no network during local small talk', U.net.length===0, U.net);

  /* AI-routed question, public user without a session -> gate (no request) */
  const E=W.VeroEngine, PUB=JSON.parse(RAW).filter(p=>!p.disabled);
  const aiQ=['MacBook Air dual display, ano pwede?','best charger for a laptop and phone','which hub is best for a macbook pro with two monitors?'].find(q=>{ const r=E.answer(PUB,q,{}); return E.aiRoute(PUB,q,r,{}).route!=='local'; });
  chk('U12 an AI-routed question exists for the gate checks', !!aiQ);
  W.veroAsk(aiQ); await flush();
  chk('U13 AI gate intro: "This question needs UNO AI." + "Sales AI Access", no request', lastLog(U).includes('This question needs UNO AI. AI access is currently available to authorized sales users.') && lastLog(U).includes('Sales AI Access') && U.net.length===0, lastLog(U).slice(-220));
  click(U,'gateopen',idxOf(U,'gateopen')); await flush();
  const form=visible(U.byId['vero-log'].innerHTML);
  chk('U14 code form: "Enter your Sales AI access code." + field aria-label/placeholder "Sales AI access code" (no "UNO access code")',
    form.text.includes('Enter your Sales AI access code.') && form.attrs.includes('aria-label=Sales AI access code') && form.attrs.includes('placeholder=Sales AI access code') && !/UNO access code/i.test(form.text+form.attrs.join()), form.attrs);
  const gi=+(String(U.byId['vero-log'].innerHTML).match(/data-unlock="(\d+)"/)||[])[1];
  U.replies.push({ status:401, j:{ ok:false, error:'invalid_code' } });
  enterCode(U,gi,'VERO-0000-0000-0000-0000'); await flush(); await flush();
  chk('U15 invalid code: "Invalid or inactive Sales AI access code."; the VERO- code format is sent unchanged to /session', lastLog(U).includes('Invalid or inactive Sales AI access code.') && U.net.length===1 && /\/session$/.test(U.net[0].url) && JSON.parse(U.net[0].body).code==='VERO-0000-0000-0000-0000', [lastLog(U).slice(-120), U.net]);
  U.replies.push({ j:{ ok:true, token:'t', role:'sales', exp:Date.now()+3600e3, web:true } }, { j:{ ok:true, route:'catalog', reply:'Here is a pick.', picks:[], sources:[], confidence:'high' } });
  enterCode(U,gi,'VERO-1111-1111-1111-1111'); await flush(); await flush(); await flush();
  chk('U16 session saved under the internal key vero_ai_session; footer shows "UNO AI on · Sign out"', 'vero_ai_session' in U.store && visible(U.byId['vero-disc'].innerHTML).text.includes('UNO AI on'), visible(U.byId['vero-disc'].innerHTML).text);
  chk('U17 AI answer badge "UNO AI"', /vero-ai-badge">UNO AI</.test(U.byId['vero-log'].innerHTML), lastLog(U).slice(-200));
  chk('U18 AI requests go only to the unchanged Worker endpoint (CONFIG.vero.aiEndpoint)', U.net.length===3 && U.net.every(n=>n.url.indexOf(W.CONFIG.vero.aiEndpoint+'/')===0), U.net.map(n=>n.url));
  /* loading state (fetch never resolves) */
  const keep=W.fetch; W.fetch=()=>new Promise(()=>{});
  W.veroAsk(aiQ); await flush();
  chk('U19 loading: "UNO AI is thinking…" / "UNO AI is checking official sources…"', /UNO AI is (thinking|checking official sources)…/.test(lastLog(U)), lastLog(U).slice(-160));
  W.fetch=keep;
  for(const [err,re,n] of [['rate_limited',/You’ve reached the UNO AI limit for now\./,'U20 limit'],['unavailable',/UNO AI is temporarily unavailable\. Local product search is still available\./,'U21 unavailable'],['unauthorized',/Your UNO AI session has expired\. Enter your access code again\./,'U22 expired session']]){
    U.replies.push({ status:err==='unauthorized'?401:(err==='rate_limited'?429:503), j:{ ok:false, error:err } });
    W.veroAsk(aiQ); await flush(); await flush();
    chk(n+': '+re.source.replace(/\\/g,''), re.test(lastLog(U)), lastLog(U).slice(-200));
  }
  sc=surfaceClean(U); chk('U23 visible surface has no VERO after every AI state', sc.ok, sc.hits);
  /* "Ask UNO AI" offer on a descriptive local answer (session present) */
  const U2=makeUI(); U2.store['vero_ai_session']=JSON.stringify({ token:'t', exp:Date.now()+3600e3, web:true });
  const offQ=['pang laptop na charger','charger for macbook','power bank for laptop'].find(q=>{ const r=E.answer(PUB,q,{}); const a=E.aiRoute(PUB,q,r,{}); return a.route==='local'&&a.canEscalate; });
  U2.W.veroOpen(); U2.W.veroAsk(offQ); await flush();
  chk('U24 offer chip "✦ Ask UNO AI" on a descriptive local answer (no automatic AI request)', !!offQ && /✦ Ask UNO AI/.test(lastLog(U2)) && U2.net.length===0, [offQ, lastLog(U2).slice(-120)]);
  sc=surfaceClean(U2); chk('U25 visible surface clean with the offer chip + "UNO AI on" footer', sc.ok && visible(U2.byId['vero-disc'].innerHTML).text.includes('UNO AI on'), sc.hits);

  /* ======================= 2. source scan ======================= */
  const strip=t=>t.replace(/\/\*[\s\S]*?\*\//g,'').replace(/(^|[^:'"\\])\/\/[^\n]*/g,'$1');
  const lits=t=>(strip(t).match(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g)||[]);
  const vjs=rd('js/vero.js'), vlit=lits(vjs);
  const vBad=vlit.filter(s=>/\bVERO\b/.test(s) && s!=="'[VERO]'");
  chk('S01 vero.js: no "VERO" in any string literal except the internal [VERO] console tag', !vBad.length, vBad);
  chk('S02 vero.js: no "& Sales" / "&amp; Sales" descriptor; "UGREEN Product and Sales Assistant" used', !/&(amp;)? Sales/.test(strip(vjs)) && /UGREEN Product and Sales Assistant/.test(vjs));
  chk('S03 vero.js: never "UNO access code"', !/UNO access code/i.test(vjs));
  const L=U.W.VeroLexicon, rep=[].concat(...['en','tl'].map(k=>Object.values(L.replies[k])));
  chk('S04 lexicon replies (en + tl): no VERO, no "Product & Sales"', !rep.some(r=>/vero|Product & Sales/i.test(r)), rep.filter(r=>/vero|Product & Sales/i.test(r)));
  chk('S05 lexicon identity replies say UNO (en + tl greeting / identity / nameWhy)', ['greeting','identity','nameWhy'].every(k=>/\bUNO\b/.test(L.replies.en[k]) && /\bUNO\b/.test(L.replies.tl[k])));
  chk('S06 bare "uno" is NOT small-talk filler; it is listed in assistantNameWords', L.smalltalkFiller.indexOf('uno')<0 && (L.assistantNameWords||[]).indexOf('uno')>=0);
  chk('S07 no small-talk cue is the bare word "uno" (phrase-specific cues only)', !Object.values(L.smalltalk).some(a=>a.indexOf('uno')>=0) && Object.values(L.smalltalk).some(a=>a.indexOf('hi uno')>=0));

  /* ======================= 3. internal identifiers kept (allowlist) ======================= */
  const idx=rd('index.html');
  chk('I01 internal globals kept: VeroEngine, VeroLexicon, VeroNLU, VeroFacts, VeroPlan, VeroCompose, veroOpen / veroClose / veroAsk', ['VeroEngine','VeroLexicon','VeroNLU','VeroFacts','VeroPlan','VeroCompose','veroOpen','veroClose','veroAsk'].every(g=>!!U.W[g]));
  chk('I02 internal names kept in vero.js: CONFIG.vero, vero_ai_session, assets/vero/, [VERO] tag, vero-* ids', /window\.CONFIG\.vero/.test(vjs) && /'vero_ai_session'/.test(vjs) && /'assets\/vero\/'/.test(vjs) && /'\[VERO\]'/.test(vjs) && /id="vero-title"/.test(vjs));
  chk('I03 index.html still loads css/vero.css + the 7 js/vero*.js files in order (dormant v2 files not loaded)', /css\/vero\.css\?v=/.test(idx) && ORDER.map(f=>idx.indexOf(f+'?v=')).every((p,i,a)=>p>0&&(i===0||p>a[i-1])) && !/vero-(ontology|parse|discourse|context)/.test(idx));
  chk('I04 Worker endpoint unchanged (ugreen-vero)', U.W.CONFIG.vero.aiEndpoint==='https://ugreen-vero.raffyortega-rojo.workers.dev');
  chk('I05 assets keep their vero-* file names (icon + 3 avatars present)', ['icon','default','happy','thinking'].every(k=>fs.existsSync(path.join(ROOT,'assets','vero','vero-'+k+'.webp'))));

  /* ======================= 4 + 5. collision and cues (engine, exactly like vero.js ask()) ======================= */
  const run=q=>{ const r=E.answer(PUB,q,{ conv:null }); return { r, a:E.aiRoute(PUB,q,r,{}) }; };
  for(const q of ['uno','uno cable','uno hub','Uno','UNO','uno 100w cable','6-in-1 uno hub','hi uno cable']){
    const x=run(q); chk('C "'+q+'" stays a product search (not small talk, no identity reply)', x.r.plan.intent!=='smalltalk' && !/I’m UNO|UNO is the name/.test(x.r.note||''), [x.r.plan.intent, x.r.note]); }
  const hub=run('uno hub');
  chk('C "uno hub": hubs listed with the honest note that "uno" is not applied (unchanged vs ae4105b)', hub.r.codes.length>0 && /“uno” isn’t confirmed in the pricelist, so it isn’t applied/.test(hub.r.note), hub.r.note);
  chk('C "UNO" alone: still the product-name search ("I can’t find “uno”…"), "uno" not in the planner vocabulary', /can’t find “uno”/.test(run('UNO').r.note||''), run('UNO').r.note);
  for(const q of ['hi uno','hello uno','who is uno','who are you uno','sino si uno','why uno','why is your name uno?','bakit uno?','thanks uno']){
    const x=run(q); chk('T "'+q+'" -> assistant small talk, local, no products', x.r.plan.intent==='smalltalk' && !(x.r.codes||[]).length && x.a.route==='local' && !x.a.candidates.length, [x.r.plan.intent, x.r.note]); }
  chk('T identity / name replies say UNO', /I’m UNO/.test(run('who is uno').r.note) && /^UNO is the name/.test(run('why is your name uno?').r.note) && /^UNO ang/.test(run('bakit uno?').r.note));
  for(const q of ['hi vero','salamat vero','why is your name vero?','who are you vero']){
    const x=run(q); chk('B backward-compatible VERO cue "'+q+'" -> small talk (answered as UNO)', x.r.plan.intent==='smalltalk' && !/VERO/.test(x.r.note), [x.r.plan.intent, x.r.note]); }
  const mix=run('hi uno, may 65W charger?');
  chk('T mixed "hi uno, may 65W charger?" -> product answer with a short greeting', mix.r.plan.intent!=='smalltalk' && mix.r.codes.length>0 && /^Hi! /.test(mix.r.note), mix.r.note);

  console.log(`\nUNO branding tests: ${pass} passed, ${fail} failed`);
  process.exit(fail?1:0);
})().catch(e=>{ console.log('FAIL - test crashed: '+(e&&e.stack||e)); console.log(`\nUNO branding tests: ${pass} passed, ${fail+1} failed`); process.exit(1); });
