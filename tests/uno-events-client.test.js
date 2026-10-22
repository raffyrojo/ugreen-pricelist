/* UNO events front-end tests (B2b, owner-approved B0 2026-10-21 = B2b-D1…D10; plan docs/plans/UNO-B2-Implementation-Plan-2026-10-21.md
   §2 in the outer project folder). Run: node tests/uno-events-client.test.js
   Boots the REAL live UI (helpers + the 7 VERO scripts in index.html order) in a DOM stub with spied localStorage / sessionStorage,
   fetch and navigator.sendBeacon (no network). The baseline UI (b0b42cc3 sources via `git show`) runs in the same stub for the
   "identical while dormant" proofs. The real backend/vero/worker.js (read-only) is imported for the redaction parity (C5) and the
   payload contract (C12, on an in-memory SQLite with the real migrations; EVENTS_ENABLED set in the test only).
   C1 dormant · C2 one event per answer, no network in ask() · C3 flush on hide, once · C4 chunking / 100 cap · C5 redaction parity +
   redact before buffering · C6 no persistence · C7 opt-out / GPC / storage errors · C8 payload fields · C9 feedback · C10 dealer
   mode · C11 outcome corpus + 0 answer changes · C12 Worker contract · C13 notice / tap-target CSS (the 375 px browser check is done
   by QA in the browser). */
const fs = require('fs'), path = require('path'), vm = require('vm'), cp = require('child_process'), os = require('os');
const ROOT = path.join(__dirname, '..');
const BASE = process.argv[2] || 'b0b42cc385bf32fbc265d4418a13da53fa923bf8';
let pass = 0, fail = 0; const chk = (n, c, x) => { if (c) { pass++; console.log('PASS - ' + n); } else { fail++; console.log('FAIL - ' + n + (x !== undefined ? '  -> ' + String(typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 400) : '')); } };
const rd = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const rdBase = f => cp.execFileSync('git', ['-C', ROOT, 'show', BASE + ':' + f], { encoding: 'utf8', maxBuffer: 64 << 20 });
const RAW = rd('data/products.json'), PRODUCTS = JSON.parse(RAW);
const ORDER = ['js/vero-lexicon.js', 'js/vero-nlu.js', 'js/vero-facts.js', 'js/vero-plan.js', 'js/vero-compose.js', 'js/vero-engine.js', 'js/vero.js'];
const VJS = rd('js/vero.js');

/* ---------------- DOM stub (same shape as tests/uno-branding.test.js) + storage / beacon spies ---------------- */
function makeUI(o) {
  o = o || {};
  const byId = {}, body = { children: [], classList: cls(), appendChild(el) { this.children.push(el); if (el.id) byId[el.id] = el; return el; } };
  function cls() { const s = new Set(); return { add: (...a) => a.forEach(x => s.add(x)), remove: (...a) => a.forEach(x => s.delete(x)), contains: x => s.has(x), toggle: (x, f) => { (f === undefined ? !s.has(x) : f) ? s.add(x) : s.delete(x); } }; }
  function el(tag) { return { tagName: String(tag).toUpperCase(), id: '', type: '', className: '', title: '', hidden: false, value: '', placeholder: '', innerHTML: '', attrs: {}, listeners: {},
    classList: cls(), style: { setProperty() {} }, scrollTop: 0, scrollHeight: 0, clientHeight: 0,
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }, hasAttribute(k) { return k in this.attrs; },
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }, appendChild(c) { return c; }, focus() {}, querySelector() { return null; }, querySelectorAll() { return []; },
    getBoundingClientRect() { return { top: 0, bottom: 56, left: 0, right: 0, width: 0, height: 0 }; } }; }
  const docL = {}, winL = {};
  const document = { readyState: 'complete', visibilityState: 'visible', body, documentElement: { style: { setProperty() {} } }, createElement: el,
    getElementById(id) { if (byId[id]) return byId[id]; const d = byId['vero-drawer'];
      if (d && (/^vero-(log|input|disc|cmpbar)$/.test(id) || d.innerHTML.indexOf('id="' + id + '"') >= 0)) return (byId[id] = el('div')); return null; },
    querySelector() { return null; }, querySelectorAll() { return []; }, addEventListener(t, f) { (docL[t] = docL[t] || []).push(f); } };
  const net = [], beacons = [], lsLog = [], ssLog = [];
  const ls = o.ls || {};
  const localStorage = { getItem: k => { lsLog.push('get:' + k); if (o.lsThrow) throw new Error('blocked'); return k in ls ? ls[k] : null; },
    setItem: (k, v) => { lsLog.push('set:' + k + '=' + v); if (o.lsThrow) throw new Error('blocked'); ls[k] = String(v); },
    removeItem: k => { lsLog.push('del:' + k); if (o.lsThrow) throw new Error('blocked'); delete ls[k]; } };
  const ss = o.ss || {};
  const sessionStorage = { getItem: k => { ssLog.push('get:' + k); return k in ss ? ss[k] : null; }, setItem: (k, v) => { ssLog.push('set:' + k); ss[k] = String(v); }, removeItem: k => { ssLog.push('del:' + k); delete ss[k]; } };
  const navigator = { userAgent: 'node', sendBeacon(url, data) { beacons.push({ url: String(url), data: String(data) }); return true; } };
  if (o.gpc) navigator.globalPrivacyControl = true;
  const W = { document, localStorage, sessionStorage, navigator, console: { log() {}, warn() {}, error() {} }, crypto: require('crypto').webcrypto,
    setTimeout: (f) => { try { f(); } catch (_) {} return 0; }, clearTimeout() {}, requestAnimationFrame: f => { try { f(); } catch (_) {} },
    addEventListener(t, f) { (winL[t] = winL[t] || []).push(f); },
    fetch(url, opt) { net.push({ url: String(url), body: opt && opt.body }); return Promise.resolve({ status: 500, json: () => Promise.resolve({ ok: false, error: 'unavailable' }) }); } };
  W.window = W; W.self = W; W.globalThis = W;
  const ctx = vm.createContext(W);
  vm.runInContext(rd('config.js'), ctx, { filename: 'config.js' });
  if (o.flag !== undefined) vm.runInContext('CONFIG.vero.eventsEnabled = ' + JSON.stringify(o.flag) + ';', ctx);
  if (o.dealer) vm.runInContext('window.DEALER_MODE = { username: "dealer-test", name: "Dealer Test" };', ctx);
  if (o.noEndpoint) vm.runInContext('CONFIG.vero.aiEndpoint = "";', ctx);
  vm.runInContext(rd('js/helpers.js'), ctx, { filename: 'helpers.js' });
  vm.runInContext('var ALL_PRODUCTS = ' + RAW + '; pcResolveSchedule(ALL_PRODUCTS);', ctx);
  ORDER.forEach(f => vm.runInContext((o.src && o.src[f]) || rd(f), ctx, { filename: f }));
  const U = { W, ctx, byId, net, beacons, lsLog, ssLog, ls, ss, docL, winL, document };
  U.drawer = byId['vero-drawer'];
  return U;
}
const tick = () => new Promise(r => setImmediate(r));
function act(U, a, attrs) { const b = { getAttribute: k => (k === 'data-act' ? a : (attrs && k in attrs ? String(attrs[k]) : null)) };
  (U.drawer.listeners.click || []).forEach(f => f({ target: { closest: () => b }, preventDefault() {} })); }
function hide(U, kind) { U.document.visibilityState = 'hidden';
  if (kind !== 'pagehide') (U.docL.visibilitychange || []).forEach(f => f({}));
  if (kind !== 'visibility') (U.winL.pagehide || []).forEach(f => f({})); }
const sent = U => U.beacons.map(b => JSON.parse(b.data));
const evs = U => [].concat(...sent(U).map(b => b.ev));
const logHtml = U => String((U.byId['vero-log'] || {}).innerHTML || '');
const noteHtml = U => { const n = U.byId['vero-evnote']; return n ? (n.hidden ? '' : String(n.innerHTML)) : ''; };
const idxOf = (U, a) => { const m = logHtml(U).match(new RegExp('data-act="' + a + '" data-idx="(\\d+)"', 'g')); return m ? m.map(x => +x.match(/(\d+)"$/)[1]) : []; };
const Q = ['65W charger', 'may nexode 65w ba?', 'hi', 'ilan?', 'keyboard', 'hdmi 2m', 'compare 25870 15570', 'power bank under ₱2,000', 'magkano ang 25870?', 'in stock ba?'];

(async function () {
  const WK = await import(require('url').pathToFileURL(path.join(ROOT, 'backend/vero/worker.js')).href);

  /* ======================= C1 dormant: identical to the baseline while the flag is absent / false ======================= */
  const baseSrc = { 'js/vero.js': rdBase('js/vero.js'), 'js/vero-compose.js': rdBase('js/vero-compose.js') };
  for (const flag of [undefined, false, 'true', 1]) {
    const A = makeUI({ flag }), B = makeUI({ src: baseSrc });
    const snap = U => [U.byId['vero-fab'].innerHTML, U.drawer.innerHTML, logHtml(U), (U.byId['vero-disc'] || {}).innerHTML].join('\n#\n');
    let same = snap(A) === snap(B);
    A.W.veroOpen(); B.W.veroOpen(); same = same && snap(A) === snap(B);
    for (const q of Q) { A.W.veroAsk(q); B.W.veroAsk(q); await tick(); same = same && snap(A) === snap(B); }
    act(A, 'more', { 'data-idx': 1 }); act(B, 'more', { 'data-idx': 1 }); same = same && snap(A) === snap(B);
    hide(A); hide(B);
    const label = 'flag ' + (flag === undefined ? 'absent' : JSON.stringify(flag));
    chk(`C1a ${label}: button, drawer, every answer and the footer render byte-identical to the baseline UI (${Q.length} questions + "show more")`, same);
    chk(`C1b ${label}: no notice element, no "Wrong answer?" button, no events DOM`, !/vero-ev/.test(A.drawer.innerHTML + logHtml(A)) && !A.byId['vero-evnote']);
    chk(`C1c ${label}: no localStorage access at all, sessionStorage use identical to the baseline`, A.lsLog.length === 0 && JSON.stringify(A.ssLog) === JSON.stringify(B.ssLog), [A.lsLog.slice(0, 3), A.ssLog.length, B.ssLog.length]);
    chk(`C1d ${label}: no beacon, network log identical to the baseline, no pagehide / visibilitychange listener`,
      A.beacons.length === 0 && JSON.stringify(A.net) === JSON.stringify(B.net) && !A.winL.pagehide && !A.docL.visibilitychange, [A.beacons.length, A.net.length, B.net.length]);
  }
  chk('C1e config.js does not set eventsEnabled (activation is ACT1, separately approved)', !/eventsEnabled/.test(rd('config.js')));

  /* ======================= C2 one event per answer; no network during ask() ======================= */
  { const U = makeUI({ flag: true }); U.W.veroOpen();
    for (const q of Q) U.W.veroAsk(q);
    chk('C2a no beacon and no fetch while answering (events stay in page memory)', U.beacons.length === 0 && U.net.length === 0, [U.beacons.length, U.net.length]);
    hide(U, 'pagehide'); const E = evs(U);
    chk(`C2b one answer event per question (${Q.length}), seq 0…${Q.length - 1} in order`, E.length === Q.length && E.every((e, i) => e.kind === 'q' && e.seq === i), E.map(e => e.seq));
    chk('C2c every beacon goes to <aiEndpoint>/events as text', U.beacons.every(b => b.url === 'https://ugreen-vero.raffyortega-rojo.workers.dev/events'));
    const V = makeUI({ flag: true }); V.W.veroOpen(); V.W.veroAsk('cable');
    const ci = idxOf(V, 'chip'); act(V, 'chip', { 'data-idx': ci[0], 'data-chip': 0 }); V.W.veroAsk('hdmi 2m'); hide(V); const F = evs(V);
    chk('C2d a chip answer is logged chip / act chip; the next typed question is chip false / act none (flag reset)', F.length === 3 && F[1].chip === true && F[1].act === 'chip' && F[2].chip === false && F[2].act === 'none' && F[0].chip === false, F.map(e => [e.chip, e.act]));
    const X = makeUI({ flag: true }); X.W.veroOpen();
    act(X, 'cmp', { 'data-code': '25870' }); act(X, 'cmp', { 'data-code': '15570' }); act(X, 'docmp'); hide(X); const G = evs(X);
    chk('C2e compare-bar turn: q is the question text "compare" (never the "Compare 25870, 15570" label), type compare, answered', G.length === 1 && G[0].q === 'compare' && G[0].type === 'compare' && G[0].outcome === 'answered', G); }

  /* ======================= C3 flush on hide only, once ======================= */
  { const U = makeUI({ flag: true }); U.W.veroOpen(); U.W.veroAsk('65W charger'); U.W.veroAsk('hdmi 2m');
    U.document.visibilityState = 'visible'; (U.docL.visibilitychange || []).forEach(f => f({}));
    chk('C3a visibilitychange to "visible" sends nothing', U.beacons.length === 0);
    hide(U);
    chk('C3b visibilitychange(hidden) + pagehide -> exactly one send of the 2 events', U.beacons.length === 1 && evs(U).length === 2, U.beacons.length);
    hide(U); chk('C3c a second hide sends nothing (taken once)', U.beacons.length === 1);
    U.W.veroAsk('keyboard'); hide(U, 'visibility');
    chk('C3d a later answer is sent on the next hide, alone', U.beacons.length === 2 && sent(U)[1].ev.length === 1 && sent(U)[1].ev[0].seq === 2); }

  /* ======================= C4 chunking by UTF-8 bytes; 100-event cap ======================= */
  { const U = makeUI({ flag: true }); U.W.veroOpen();
    const qs = []; for (let i = 0; i < 40; i++) qs.push('power bank ₱' + (1000 + i) + ' piña ñ ' + 'é'.repeat(30) + ' ' + i);
    qs.forEach(q => U.W.veroAsk(q)); hide(U);
    const bytes = U.beacons.map(b => Buffer.byteLength(b.data, 'utf8')), E = evs(U);
    chk('C4a every chunk ≤ 4,096 UTF-8 bytes (₱ / ñ / é counted as bytes) and ≤ 12 events', bytes.every(n => n <= 4096) && sent(U).every(b => b.ev.length >= 1 && b.ev.length <= 12), bytes);
    chk('C4b all 40 events delivered once, in order, across ' + U.beacons.length + ' chunks', E.length === 40 && E.every((e, i) => e.seq === i) && U.beacons.length >= 2);
    const V = makeUI({ flag: true }); V.W.veroOpen(); for (let i = 0; i < 130; i++) V.W.veroAsk('hdmi ' + (i % 9 + 1) + 'm'); hide(V);
    const F = evs(V);
    chk('C4c > 100 events: the oldest are dropped, the newest 100 kept (seq 30…129)', F.length === 100 && F[0].seq === 30 && F[99].seq === 129, [F.length, F[0] && F[0].seq]); }

  /* ======================= C5 redaction parity (client copy == Worker) + redact before buffering ======================= */
  { const a = VJS.indexOf('function evRedactBase('), b = VJS.indexOf('/* \'\' = logging allowed');
    const sb = vm.createContext({}); vm.runInContext(VJS.slice(a, b) + '\nthis.evRedact = evRedact;', sb);
    const CR = sb.evRedact, WR = WK.redactEvent;
    const { newCode } = await import(require('url').pathToFileURL(path.join(ROOT, 'tools/vero-code.mjs')).href);
    const corpus = [];
    const sales = require('./vero-sales-questions.json').questions || [], dev = require('./vero-v2-devsets.json');
    sales.forEach(x => corpus.push(String(x.q || x.question || x.text || '')));
    Object.values(dev.sets || {}).forEach(s => (s.items || []).forEach(x => corpus.push(x.q)));
    (dev.chains || []).forEach(c => c.turns.forEach(t => corpus.push(t.q)));
    PRODUCTS.forEach(p => { corpus.push(String(p.product_name || '')); String(p.features || '').split('\n').forEach(l => corpus.push(l)); String(p.description || '').split(/\n|\. /).forEach(l => corpus.push(l)); });
    ['email me at juan.dela-cruz+x@example.com.ph', 'call 0917 123 4567 or +63 917-123-4567', 'tel (02) 8123-4567 loc 12', 'sku 35265 15124 90749 70307',
     'may usb4 dock with hdmi port ba kayo', '2230 2242 2260 2280', '1000-1600-2400-3200-5000 dpi', '7680*4320@30Hz', 'ab\u0000cd\u202Eef\u200Bgh\u2028ij\u2029kl', '😀'.repeat(70),
     'x'.repeat(119) + '😀', '', '   ', 'VERO -- AB12 -- CD34 -- EF56 -- GH78 -- JK90',
     '1234567890', '123456789', '(02) 812-3456', '+1 234 567 890', '+63 2 8812 3456', '0917-123-4567', '63 917 123 4567', 'a@b.co', 'x@y', '1-800-123-4567'].forEach(s => corpus.push(s));
    const SPELL = [c => c, c => c.toLowerCase(), c => c.replace(/-/g, ''), c => c.replace(/-/g, ' '), c => c.replace(/-/g, '.'), c => c.replace(/-/g, '_'), c => c.replace(/-/g, '/'),
      c => c.replace(/-/g, ' - '), c => c.slice(5), c => c.slice(5).replace(/-/g, ' '), c => 'my code is ' + c + ' thanks', c => 'x'.repeat(200) + ' ' + c];
    const codes = []; for (let i = 0; i < 20000; i++) codes.push(newCode());
    codes.forEach((c, i) => corpus.push(SPELL[i % SPELL.length](c)));
    let diff = [], n = 0; for (const s of corpus) { n++; const x = CR(s), y = WR(s); if (x !== y) diff.push([s, x, y]); }
    chk(`C5a client redactEvent == Worker redactEvent on ${n} strings (catalogue names / features / descriptions, sales + dev questions, edge cases, 20,000 codes × ${SPELL.length} spellings)`, diff.length === 0, diff.slice(0, 2));
    const U = makeUI({ flag: true }); U.W.veroOpen();
    const secret = codes[0], raw = 'pls email juan@example.com, 09171234567, code ' + secret + ' 65W charger';
    U.W.veroAsk(raw); U.W.veroAsk('hdmi ' + 'x'.repeat(300)); hide(U); const E = evs(U);
    chk('C5b the buffered / sent question is the redacted text (email, phone, access code removed), never the raw question', E[0].q === WR(raw) && !E[0].q.includes(secret) && !E[0].q.includes('juan@') && /\[email\]/.test(E[0].q) && /\[code\]/.test(E[0].q), E[0].q);
    chk('C5c q is cut to ≤ 120 characters before buffering', E.every(e => e.q.length <= 120) && E[1].q.length === 120);
    chk('C5d the beacon body never contains the raw question', !U.beacons.some(b => b.data.includes(secret) || b.data.includes('juan@example.com'))); }

  /* ======================= C6 no persistence ======================= */
  { const ls = {}, ss = {}; const U = makeUI({ flag: true, ls, ss }); U.W.veroOpen(); U.W.veroAsk('65W charger'); U.W.veroAsk('keyboard');
    chk('C6a recording writes no sessionStorage key and no localStorage key (only reads the opt-out key)', U.ssLog.filter(x => x.startsWith('set:')).length === 0 && U.lsLog.every(x => x === 'get:uno_events_off'), [U.ssLog, [...new Set(U.lsLog)]]);
    hide(U, 'pagehide');
    const V = makeUI({ flag: true, ls, ss }); V.W.veroOpen(); hide(V, 'pagehide');
    chk('C6b a reload (new page, same storage) re-sends nothing: the old page sent its events once on pagehide', U.beacons.length === 1 && V.beacons.length === 0 && Object.keys(ss).length === 0 && Object.keys(ls).length === 0);
    const sNames = [...new Set((VJS.slice(VJS.indexOf('var EV_ON='), VJS.indexOf('function evFbHtml(')).match(/\b(?:session|local)Storage\b/g) || []))];
    chk('C6c the events code never names sessionStorage', sNames.length === 1 && sNames[0] === 'localStorage', sNames); }

  /* ======================= C7 opt-out / GPC / storage errors ======================= */
  { const U = makeUI({ flag: true, ls: { uno_events_off: '1' } }); U.W.veroOpen(); U.W.veroAsk('65W charger'); hide(U);
    chk('C7a opted out before asking -> nothing recorded or sent; notice shows the "won\'t be logged" line + "Turn logging back on"', U.beacons.length === 0 && /won’t be logged/.test(noteHtml(U)) && /data-act="evon"/.test(noteHtml(U)));
    const V = makeUI({ flag: true }); V.W.veroOpen(); V.W.veroAsk('65W charger'); V.W.veroAsk('hdmi 2m');
    chk('C7b logging on -> footer notice N1 with "Don\'t log my questions" and "About UNO logging"', /UNO saves your questions for about 30 days/.test(noteHtml(V)) && /data-act="evoff"/.test(noteHtml(V)) && /data-act="evabout"/.test(noteHtml(V)));
    act(V, 'evoff'); hide(V);
    chk('C7c opting out empties the pending buffer (nothing sent) and sets uno_events_off = 1', V.beacons.length === 0 && V.ls.uno_events_off === '1');
    act(V, 'evon'); V.W.veroAsk('keyboard'); hide(V);
    chk('C7d turning logging back on clears the key and logs new answers only', !('uno_events_off' in V.ls) && evs(V).length === 1 && evs(V)[0].q === 'keyboard');
    const X = makeUI({ flag: true }); X.W.veroOpen(); X.W.veroAsk('65W charger'); X.ls.uno_events_off = '1'; hide(X);
    chk('C7e opt-out is checked again at flush: set after recording -> nothing sent', X.beacons.length === 0);
    const G = makeUI({ flag: true, gpc: true }); G.W.veroOpen(); G.W.veroAsk('65W charger'); hide(G);
    chk('C7f Global Privacy Control on -> nothing recorded or sent; notice says the browser setting turned it off (no "turn on" button)', G.beacons.length === 0 && /browser’s privacy setting/.test(noteHtml(G)) && !/data-act="evon"/.test(noteHtml(G)) && !/evwrong/.test(logHtml(G)));
    const T = makeUI({ flag: true, lsThrow: true }); T.W.veroOpen(); T.W.veroAsk('65W charger'); hide(T);
    chk('C7g storage unreadable (getItem throws) -> fail closed: nothing sent, no notice, no feedback button', T.beacons.length === 0 && noteHtml(T) === '' && !/evwrong/.test(logHtml(T)));
    const Y = makeUI({ flag: true }); Y.W.veroOpen(); Y.W.veroAsk('65W charger'); Y.W.veroAsk('hdmi 2m'); act(Y, 'evoff'); act(Y, 'evon'); hide(Y);
    chk('C7i opt out -> opt back in with no hide in between: the pre-opt-out answers are never sent and offer no "Wrong answer?"', Y.beacons.length === 0 && idxOf(Y, 'evwrong').length === 0);
    Y.W.veroAsk('keyboard'); hide(Y);
    chk('C7j after opting back in only new answers are logged (one event, seq continues)', evs(Y).length === 1 && evs(Y)[0].q === 'keyboard');
    const Z = makeUI({ flag: true, noEndpoint: true }); Z.W.veroOpen(); Z.W.veroAsk('65W charger'); hide(Z);
    chk('C7k flag on but no aiEndpoint -> nothing recorded or sent, no notice, no feedback (never a relative /events on Pages)', Z.beacons.length === 0 && noteHtml(Z) === '' && idxOf(Z, 'evwrong').length === 0 && Z.lsLog.length === 0);
    act(V, 'evabout'); chk('C7h "About UNO logging" opens the N5 statement (UNO AI paragraph incl. access code and scrambled network identifier)', /UNO AI \(staff with an access code only\)/.test(noteHtml(V)) && /scrambled network identifier/.test(noteHtml(V))); }

  /* ======================= C8 payload fields ======================= */
  { const U = makeUI({ flag: true }); U.W.veroOpen(); Q.forEach(q => U.W.veroAsk(q)); act(U, 'evwrong', { 'data-idx': idxOf(U, 'evwrong')[0] }); act(U, 'evreason', { 'data-idx': idxOf(U, 'evreason')[0], 'data-reason': 'wrong_spec' }); hide(U);
    const B = sent(U), E = evs(U);
    const QK = ['kind', 'seq', 'q', 'chip', 'type', 'outcome', 'codes', 'n_codes', 'route', 'ai_trigger', 'lang', 'followup', 'act'].sort().join(), FK = ['kind', 'seq', 'reason'].sort().join();
    chk('C8a batch keys are exactly v / sid / role / engine / ev; sid matches the Worker pattern; role anon; engine p2r3a', B.every(b => Object.keys(b).sort().join() === 'engine,ev,role,sid,v' && b.v === 1 && /^[A-Za-z0-9_-]{16,32}$/.test(b.sid) && b.role === 'anon' && b.engine === 'p2r3a'), B[0] && Object.keys(B[0]));
    chk('C8b answer events carry exactly the §1.2 fields; feedback events only kind / seq / reason', E.every(e => Object.keys(e).sort().join() === (e.kind === 'q' ? QK : FK)) && E.some(e => e.kind === 'fb'));
    const FORBID = /"(srp|dp|dp_std|dp_volume|special_dp|moq|price|prices|dealer|username|name|mode|token|code_id|ctx|reply|ip|ip_hash|ua)"\s*:/;
    chk('C8c no forbidden field anywhere in any body (prices, dealer, user, mode, token, code id, context, reply, IP)', U.beacons.every(b => !FORBID.test(b.data)));
    const priceStr = new Set(); PRODUCTS.slice(0, 400).forEach(p => ['srp', 'dp', 'dp_volume'].forEach(k => { if (p[k] > 999) priceStr.add(String(p[k])); }));
    chk('C8d answer events never carry a catalogue price value (codes / q only)', E.filter(e => e.kind === 'q').every(e => !e.codes.some(c => priceStr.has(c)) && typeof e.n_codes === 'number'));
    const S = makeUI({ flag: true, ss: { vero_ai_session: JSON.stringify({ token: 'tok-test', role: 'sales', exp: Date.now() + 3600e3, web: true }) } }); S.W.veroOpen(); S.W.veroAsk('which 65W charger is best for a laptop?'); hide(S);
    const SB = sent(S)[0];
    chk('C8e with a UNO AI session: role "sales", the token never appears in the body, the AI route is recorded (route ai / web, trigger auto)', SB && SB.role === 'sales' && !S.beacons[0].data.includes('tok-test') && /^(ai|web)$/.test(SB.ev[0].route) && SB.ev[0].ai_trigger === 'auto', SB && SB.ev[0]);
    const D = makeUI({ flag: true, ss: { vero_ai_session: JSON.stringify({ token: 't', role: 'dealer', exp: Date.now() + 3600e3 }) } }); D.W.veroOpen(); D.W.veroAsk('hdmi 2m'); hide(D);
    chk('C8f any other session role is reported as anon (coarse labels only)', sent(D)[0].role === 'anon');
    const M = makeUI({ flag: true, ss: { vero_ai_session: JSON.stringify({ token: 'tok-m', role: 'admin', exp: Date.now() + 3600e3, web: true }) } }); M.W.veroOpen();
    M.W.veroAsk('nexode 65w charger for switch'); const ai = idxOf(M, 'askai'); act(M, 'askai', { 'data-idx': ai[0] }); hide(M); const ME = evs(M);
    chk('C8g a manual "Ask UNO AI" turn updates that answer\'s event to route ai / web, trigger manual (role admin; no token)', ai.length === 1 && ME.length === 1 && /^(ai|web)$/.test(ME[0].route) && ME[0].ai_trigger === 'manual' && sent(M)[0].role === 'admin' && !M.beacons[0].data.includes('tok-m'), [ai, ME[0]]); }

  /* ======================= C9 feedback ======================= */
  { const U = makeUI({ flag: true }); U.W.veroOpen(); U.W.veroAsk('65W charger'); U.W.veroAsk('ilan?'); U.W.veroAsk('hi');
    const w = idxOf(U, 'evwrong');
    chk('C9a "Wrong answer?" only on answer turns (shown for "65W charger"; not on the clarify or small-talk turn)', w.length === 1 && w[0] === 1, w);
    act(U, 'evwrong', { 'data-idx': 1 });
    chk('C9b the button opens the four reason chips (EN)', /Wrong product.*Wrong spec.*Missing product.*Other/.test(logHtml(U).replace(/\n/g, ' ')) && idxOf(U, 'evreason').length === 4);
    act(U, 'evreason', { 'data-idx': 1, 'data-reason': 'missing_product' }); act(U, 'evreason', { 'data-idx': 1, 'data-reason': 'other' }); act(U, 'evwrong', { 'data-idx': 1 });
    act(U, 'evreason', { 'data-idx': 3, 'data-reason': 'other' }); act(U, 'evreason', { 'data-idx': 1, 'data-reason': 'free text' });
    chk('C9c thanks line after one reason; the turn takes no second feedback', /Thanks — the team will review this\./.test(logHtml(U)) && idxOf(U, 'evwrong').length === 0);
    hide(U); const F = evs(U).filter(e => e.kind === 'fb');
    chk('C9d exactly one feedback event: { kind fb, seq of that answer, reason missing_product } — no text, no other turn', F.length === 1 && F[0].seq === 0 && F[0].reason === 'missing_product' && Object.keys(F[0]).length === 3, F);
    const T = makeUI({ flag: true }); T.W.veroOpen(); T.W.veroAsk('may nexode 65w ba?'); act(T, 'evwrong', { 'data-idx': 1 });
    chk('C9e Tagalog answer -> Tagalog button / chips ("Mali ang sagot?", "Maling produkto", "Kulang na produkto", "Iba pa")', /Maling produkto/.test(logHtml(T)) && /Kulang na produkto/.test(logHtml(T)) && /Iba pa/.test(logHtml(T)));
    const O = makeUI({ flag: true }); O.W.veroOpen(); O.W.veroAsk('65W charger'); act(O, 'evoff');
    chk('C9f opted out -> no "Wrong answer?" button', idxOf(O, 'evwrong').length === 0);
    const R = makeUI({ flag: true }); R.W.veroOpen(); R.W.veroAsk('65W charger'); act(R, 'evwrong', { 'data-idx': 1 });
    act(R, 'evreason', { 'data-idx': 1, 'data-reason': 'free text' }); act(R, 'evreason', { 'data-idx': 1, 'data-reason': 'constructor' }); hide(R);
    chk('C9g an unknown reason (free text, prototype key) on a fresh turn is ignored: no feedback event, chips stay open', evs(R).filter(e => e.kind === 'fb').length === 0 && idxOf(R, 'evreason').length === 4);
    const C = makeUI({ flag: true }); C.W.veroOpen(); act(C, 'cmp', { 'data-code': '25870' }); act(C, 'cmp', { 'data-code': '15570' }); act(C, 'docmp');
    chk('C9h a legacy-path answer (compare bar) offers "Wrong answer?" like any answered turn', idxOf(C, 'evwrong').length === 1); }

  /* ======================= C10 dealer mode ======================= */
  { const U = makeUI({ flag: true, dealer: true }); U.W.veroOpen(); Q.forEach(q => U.W.veroAsk(q)); act(U, 'evwrong', { 'data-idx': 1 }); hide(U);
    chk('C10 dealer mode with the flag on: no notice, no toggle, no "Wrong answer?", no beacon, no opt-out storage read', U.beacons.length === 0 && noteHtml(U) === '' && !/vero-ev-wrong|evreason/.test(logHtml(U)) && U.lsLog.length === 0, [U.beacons.length, U.lsLog.length]); }

  /* ======================= C10b error answers (fix round 2, B2b-R2-2) ======================= */
  { const U = makeUI({ flag: true }); U.W.veroOpen(); vm.runInContext('VeroEngine.answer = function(){ throw new Error("test engine failure"); };', U.ctx);
    U.W.veroAsk('65W charger'); const errShown = /process that\. Try an item code/.test(logHtml(U));
    const L = makeUI({ flag: true }); L.W.veroOpen(); vm.runInContext('ALL_PRODUCTS.length = 0;', L.ctx); L.W.veroAsk('hdmi 2m');
    const btnU = idxOf(U, 'evwrong').length, btnL = idxOf(L, 'evwrong').length; hide(U); hide(L);
    const eu = evs(U), el = evs(L);
    chk('C10b an engine exception and a still-loading pricelist are logged as outcome "error" (type text, no codes) and offer no "Wrong answer?"',
      errShown && eu.length === 1 && eu[0].outcome === 'error' && eu[0].type === 'text' && eu[0].codes.length === 0 && el.length === 1 && el[0].outcome === 'error' && btnU === 0 && btnL === 0,
      [errShown, eu[0], el[0], btnU, btnL]); }

  /* ======================= C11 outcome corpus + 0 answer changes ======================= */
  function engine(src) { const W = { console: { log() {}, warn() {} } }; W.window = W; W.globalThis = W; const c = vm.createContext(W);
    vm.runInContext('var ALL_PRODUCTS = ' + RAW + ';', c); ORDER.slice(0, 6).forEach(f => vm.runInContext((src && src[f]) || rd(f), c, { filename: f }));
    const pool = vm.runInContext('ALL_PRODUCTS.filter(function(p){ return p && !p.disabled; })', c);
    return (q, conv, extra) => vm.runInContext('VeroEngine', c).answer(pool, q, Object.assign({ conv: conv || null }, extra || {})); }
  { const NEW = engine(), OLD = engine({ 'js/vero-compose.js': baseSrc['js/vero-compose.js'] });
    const corpus = [];
    (require('./vero-sales-questions.json').questions || []).forEach(x => corpus.push([String(x.q || x.question || x.text || '')]));
    const dev = require('./vero-v2-devsets.json');
    Object.values(dev.sets || {}).forEach(s => (s.items || []).forEach(x => corpus.push([x.q])));
    (dev.chains || []).forEach(c => corpus.push(c.turns.map(t => t.q)));
    Q.forEach(q => corpus.push([q])); corpus.push(['65W charger', 'yung pinakamura', 'may 100w ba?', 'compare the first two']);
    let n = 0, diffs = [], badOutcome = [];
    const strip = r => JSON.stringify(r, (k, v) => (k === 'outcome' || k === 'ms' ? undefined : v));   /* plan.ms = the planner's own timing */
    for (const chain of corpus) { let cn = null, co = null;
      for (const q of chain) { n++; const a = NEW(q, cn), b = OLD(q, co); if (strip(a) !== strip(b)) diffs.push(q);
        if (['answered', 'clarify', 'honest_negative', 'no_match', 'smalltalk'].indexOf(a.outcome) < 0) badOutcome.push([q, a.outcome]);
        cn = a.ctxOut || cn; co = b.ctxOut || co; } }
    const cmpA = NEW('compare', null, { compareCodes: ['25870', '15570'] }), cmpB = OLD('compare', null, { compareCodes: ['25870', '15570'] });
    chk(`C11a 0 answer changes: ${n} turns (sales benchmark, dev sets, ${dev.chains.length} follow-up chains, smoke questions) produce identical answers baseline vs candidate apart from the new outcome field`, diffs.length === 0 && strip(cmpA) === strip(cmpB), diffs.slice(0, 5));
    chk('C11b every Local Brain answer carries a valid outcome class', badOutcome.length === 0, badOutcome.slice(0, 5));
    const EXP = [['65W charger', 'answered'], ['may nexode 65w ba?', 'answered'], ['hi', 'smalltalk'], ['salamat uno', 'smalltalk'], ['ilan?', 'clarify'], ['keyboard', 'clarify'], ['xqzv plorb', 'clarify'],
      ['may keyboard ba kayo?', 'honest_negative'], ['do you have a keyboard?', 'honest_negative'], ['price of ZZ9999', 'no_match'], ['magkano ang HD999?', 'no_match'], ['ilang products meron kayo?', 'answered'], ['compare 25870 15570', 'answered'], ['magkano ang 25870?', 'answered']];
    const got = EXP.map(([q, x]) => [q, x, NEW(q).outcome]);
    chk('C11c outcome corpus: ' + EXP.map(x => x[0] + ' → ' + x[1]).join(' · '), got.every(g => g[1] === g[2]), got.filter(g => g[1] !== g[2]));
    chk('C11d legacy-path answers (compare bar, section chip) get a class from VeroCompose.outcome(); vero.js marks engine errors "error"', cmpA.outcome === undefined && require(path.join(ROOT, 'js/vero-compose.js')).outcome(cmpA) === 'answered' && (VJS.match(/outcome:'error'/g) || []).length === 2);
    const OC = require(path.join(ROOT, 'js/vero-compose.js')).outcome;
    chk('C11e outcome() on legacy shapes: type none -> no_match, empty text -> honest_negative, null -> error, smalltalk flag wins', OC({ type: 'none', codes: [] }) === 'no_match' && OC({ type: 'text', codes: [] }) === 'honest_negative' && OC(null) === 'error' && OC({ type: 'list', codes: ['1'], smalltalk: 'hi' }) === 'smalltalk'); }

  /* ======================= C12 Worker contract: every payload the client produces is accepted unchanged ======================= */
  { const { DatabaseSync } = require('node:sqlite');
    const MIG = ['0001_init.sql', '0002_product_text_cache.sql', '0003_uno_events.sql'].map(f => rd('backend/vero/migrations/' + f));
    class Stmt { constructor(db, sql, p) { this.db = db; this.sql = sql; this.p = p || []; } bind(...a) { return new Stmt(this.db, this.sql, a.map(v => (v === undefined ? null : v))); }
      _all() { return this.db.prepare(this.sql).all(...this.p); } async first(c) { const r = this._all(); return r.length ? (c ? r[0][c] : r[0]) : null; } async all() { return { results: this._all() }; }
      async run() { const i = this.db.prepare(this.sql).run(...this.p); return { success: true, meta: { changes: i.changes } }; } }
    class D1 { constructor() { this.db = new DatabaseSync(':memory:'); MIG.forEach(s => this.db.exec(s)); } prepare(s) { return new Stmt(this.db, s); }
      async batch(st) { this.db.exec('BEGIN'); try { const o = st.map(s => ({ results: s._all() })); this.db.exec('COMMIT'); return o; } catch (e) { this.db.exec('ROLLBACK'); throw e; } } }
    const env = { DB: new D1(), EVENTS_ENABLED: 'true', AI_ENABLED: 'true', WEB_ENABLED: 'true', TOKEN_SIGNING_KEY: 'test-signing-key-0123456789abcdef-xyz', IP_HASH_SALT: 'salt', ALLOW_ORIGIN: 'https://raffyrojo.github.io' };
    const ins = env.DB.db.prepare('INSERT INTO product_text (item_code, version, name, category) VALUES (?, ?, ?, ?)');
    PRODUCTS.forEach(p => ins.run(String(p.item_code), 'W/"t"', 'n', String(p.sheet_display || '') + ': ' + String(p.category || '')));
    env.DB.db.prepare("INSERT INTO meta (k, v) VALUES ('catalog_version', 'W/\"t\"'), ('catalog_checked_at', ?)").run(String(Date.now()));
    const U = makeUI({ flag: true }); U.W.veroOpen(); Q.concat(['ilang products meron kayo?', 'salamat']).forEach(q => U.W.veroAsk(q));
    act(U, 'evwrong', { 'data-idx': 1 }); act(U, 'evreason', { 'data-idx': 1, 'data-reason': 'wrong_product' }); act(U, 'more', { 'data-idx': 1 }); hide(U);
    const res = []; let ip = 0;
    for (const b of U.beacons) { const r = await WK.default.fetch(new Request('https://ugreen-vero.test/events', { method: 'POST', body: b.data,
        headers: { 'content-type': 'text/plain;charset=UTF-8', origin: 'https://raffyrojo.github.io', 'cf-connecting-ip': '10.1.0.' + (++ip) } }), env, { waitUntil() {} });
      res.push([r.status, await r.json()]); }
    const nq = evs(U).filter(e => e.kind === 'q').length, nf = evs(U).filter(e => e.kind === 'fb').length;
    const rows = env.DB.db.prepare('SELECT seq, q_redacted, type, outcome, act FROM uno_events ORDER BY seq').all(), fbs = env.DB.db.prepare('SELECT seq, reason FROM uno_feedback').all();
    chk(`C12a the real Worker /events accepts every client batch (${U.beacons.length}) with 200 and stores all ${nq} answer events + ${nf} feedback`, res.every(r => r[0] === 200 && r[1].ok) && rows.length === nq && fbs.length === nf, res);
    const E = evs(U).filter(e => e.kind === 'q');
    chk('C12b stored rows equal the client events (Worker redaction is a no-op on client-redacted text; type / outcome / act kept)', rows.every((r, i) => r.q_redacted === E[i].q && r.type === E[i].type && r.outcome === E[i].outcome && r.act === E[i].act) && rows[0].act === 'more', rows.slice(0, 2)); }

  /* ======================= C13 notice wording marked DRAFT; CSS additive with ≥ 44 px coarse-pointer targets ======================= */
  { const css = rd('css/vero.css'), bcss = rdBase('css/vero.css');
    chk('C13a notice / feedback wording is marked DRAFT pending the Iontech privacy review (plan section 4, P1)', VJS.includes("status:'DRAFT pending Iontech privacy review (plan \\u00A74, P1)'") && VJS.includes("DRAFT - pending Iontech's privacy review (plan section 4, P1)"));
    const cl = css.split('\n'), COARSE = '@media (pointer:coarse){ .vero-ev-btn,.vero-ev-wrong,.vero-ev-chips .vero-chip{ min-height:44px; } }', ci = cl.indexOf(COARSE);
    const later = cl.slice(ci + 1).filter(l => /\.vero-ev-(btn|wrong)|\.vero-ev-chips \.vero-chip/.test(l) && /min-height/.test(l));
    chk('C13b css/vero.css is additive (every baseline line kept); the touch-screen 44 px rule for toggle / feedback / chips is the LAST rule setting their min-height (rule order, B2b-F1)',
      bcss.split('\n').every(l => cl.includes(l)) && ci > 0 && later.length === 0 && cl.filter(l => l !== COARSE && /\.vero-ev-(btn|wrong)\{|\.vero-ev-chips \.vero-chip\{/.test(l)).every(l => cl.indexOf(l) < ci), later);
    chk('C13d the notice actions sit on their own row (no 44 px button inside the N1 text line, B2b-F6)', /\.vero-ev-acts\{ display:block;/.test(css) && /'<span class="vero-ev-acts"><button type="button" class="vero-link vero-ev-btn" data-act="evoff">/.test(VJS));
    chk('C13c the notice wraps (no fixed width; overflow-wrap anywhere; N5 panel scrolls inside 40vh)', /\.vero-evnote\{[^}]*overflow-wrap:anywhere/.test(css) && /\.vero-ev-about\{[^}]*max-height:40vh; overflow:auto/.test(css) && !/\.vero-ev[^{]*\{[^}]*\bwidth:\s*\d+px/.test(css)); }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
