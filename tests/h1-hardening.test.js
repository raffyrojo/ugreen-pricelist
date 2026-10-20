/* H1 front-end hardening tests (owner-approved 2026-10-20).
   1. Search overlay: "Top Searches" chips and suggested-product cards carry their value in an HTML-escaped data
      attribute; no value is spliced into an inline JS string (the browser decodes &#39; before the handler runs, so the
      old `onclick="soPickTerm('…')"` pattern let a quote break out of the string). Runs the real js/search-overlay.js in
      a Node vm sandbox with hostile cross-visitor terms (served by the public CMS ?searches=1 endpoint).
   2. SRI: both CDN export libraries in index.html carry the pinned integrity hash + crossorigin="anonymous".
   Each check also runs against mutated sources, which must FAIL (mutants killed).
   Usage: node tests/h1-hardening.test.js  (from the repo root) */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const SO_SRC = fs.readFileSync(path.join(ROOT, 'js/search-overlay.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const SRI = {
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js': 'sha384-JcnsjUPPylna1s1fvi1u12X5qjY5OL56iySh75FdtrwhO/SWXgMjoVqcKyIIWOLk',
  'https://cdn.jsdelivr.net/npm/exceljs@4.3.0/dist/exceljs.min.js': 'sha384-P7KKlGD3Ng66Ds7oTliLzTnol6DbK+k7PafNYXIBDQ4b5eFWtmqctplDVOxslglR'
};

/* hostile terms; each is a substring of a fixture product name, so it passes the overlay's catalogue filter */
const TERMS = ["x');alert(1);//", "2.5'' sata", 'a"b onmouseover="alert(1)', 'back\\slash\'', '</button><img src=x onerror=alert(1)>', 'plain charger'];
const CODES = ["C'1", 'C"2', 'C<3>', '45514B'];
const PRODUCTS = TERMS.map((t, i) => ({ item_code: CODES[i] || ('P' + i), product_name: 'Item ' + t + ' end', category: 'Cat', sheet: 'Sheet', image: '' }));

const decode = s => s.replace(/&(#39|quot|lt|gt|amp);/g, (m, e) => ({ '#39': "'", quot: '"', lt: '<', gt: '>', amp: '&' }[e]));
/* attribute parser for the generated button markup (double-quoted attributes; values HTML-escaped) */
function buttons(html) {
  const out = [], re = /<button\b([^>]*)>/g; let m;
  while ((m = re.exec(html))) {
    const attrs = {}, ar = /([a-z-]+)="([^"]*)"/g; let a;
    while ((a = ar.exec(m[1]))) attrs[a[1]] = decode(a[2]);
    out.push(attrs);
  }
  return out;
}

async function render(src) {
  const els = { 'so-tags': { innerHTML: '' }, 'so-suggest': { innerHTML: '' }, 'search-overlay': { classList: { add() {}, remove() {} } }, search: { value: '', focus() {} } };
  const store = {};
  const win = {
    CONFIG: { backend: { workerEndpoint: 'https://cms.example.invalid/' } },
    ALL_PRODUCTS: PRODUCTS,
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    document: { getElementById: id => els[id] || null, addEventListener() {}, body: { classList: { add() {}, remove() {} } }, activeElement: null },
    navigator: {},
    setTimeout: (f) => 0, clearTimeout() {},
    fetch: url => Promise.resolve({ ok: true, json: () => Promise.resolve(/\?searches=1/.test(url) ? TERMS.slice() : (/\?trending=1/.test(url) ? CODES.slice() : null)) }),
    addEventListener() {}, Blob: function () {}, JSON, String, Object, Array, Promise
  };
  win.window = win;
  vm.createContext(win);
  vm.runInContext(src, win, { filename: 'search-overlay.js' });
  win.openSearchOverlay();
  for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));   /* let the stubbed fetches resolve and re-render */
  win.openSearchOverlay();
  for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));
  return { tags: els['so-tags'].innerHTML, cards: els['so-suggest'].innerHTML };
}

async function overlayChecks(src) {
  const fails = [];
  const { tags, cards } = await render(src);
  const tagBtns = buttons(tags), cardBtns = buttons(cards);
  const termsShown = tagBtns.map(b => b['data-term']);
  for (const t of TERMS) {
    const want = t.toLowerCase().trim();
    if (!termsShown.includes(want)) fails.push('term chip missing or altered: ' + JSON.stringify(want));
  }
  tagBtns.forEach(b => { if (b.onclick !== 'soPickTerm(this.dataset.term)') fails.push('chip handler is not the fixed dataset form: ' + JSON.stringify(b.onclick)); });
  for (const c of CODES) {
    const b = cardBtns.find(x => x['data-code'] === c);
    if (!b) fails.push('product card missing or code altered: ' + JSON.stringify(c));
    else if (b.onclick !== 'soPickProduct(this.dataset.code)') fails.push('card handler is not the fixed dataset form: ' + JSON.stringify(b.onclick));
  }
  /* nothing user-controlled may reach a handler attribute; no raw tag from a term may survive escaping */
  [...tagBtns, ...cardBtns].forEach(b => Object.keys(b).filter(k => /^on/.test(k)).forEach(k => {
    if (/alert|\(\s*'|\\'/.test(b[k])) fails.push('value spliced into ' + k + ': ' + JSON.stringify(b[k]));
  }));
  if (/<img src=x/.test(tags) || /onmouseover="alert/.test(tags)) fails.push('raw markup from a term survived escaping');
  return fails;
}

function sriChecks(html) {
  const fails = [];
  const ext = [...html.matchAll(/<script\b[^>]*\bsrc="(https?:[^"]+)"[^>]*><\/script>/g)];
  if (ext.length !== Object.keys(SRI).length) fails.push('expected ' + Object.keys(SRI).length + ' external scripts, found ' + ext.length);
  for (const m of ext) {
    const tag = m[0], url = m[1];
    const integ = (tag.match(/\bintegrity="([^"]+)"/) || [])[1], co = (tag.match(/\bcrossorigin="([^"]+)"/) || [])[1];
    if (!SRI[url]) fails.push('external script without a pinned hash: ' + url);
    else if (integ !== SRI[url]) fails.push('integrity mismatch for ' + url + ': ' + integ);
    if (co !== 'anonymous') fails.push('crossorigin must be "anonymous" for ' + url + ': ' + co);
  }
  return fails;
}

(async () => {
  let pass = 0, fail = 0;
  const report = (name, fails) => { if (fails.length) { fail++; console.log('FAIL - ' + name + '\n   ' + fails.slice(0, 6).join('\n   ')); } else { pass++; console.log('PASS - ' + name); } };

  report('H1.1 search overlay: chips + cards carry values in data attributes, fixed handlers, hostile terms round-trip exactly', await overlayChecks(SO_SRC));
  report('H1.2 index.html: both CDN export libraries carry the pinned SRI hash + crossorigin="anonymous"', sriChecks(INDEX));
  report('H1.3 search-overlay.js source has no value spliced into an inline JS string', /\\''\+/.test(SO_SRC) ? ['splice pattern found'] : []);

  /* mutants: each must make the matching check FAIL */
  const OLD_CHIP = `'<button type="button" class="so-tag" onclick="soPickTerm(\\''+_esc(t).replace(/'/g,"\\\\'")+'\\')">'`;
  const NEW_CHIP = `'<button type="button" class="so-tag" data-term="'+_esc(t)+'" onclick="soPickTerm(this.dataset.term)">'`;
  const OLD_CARD = `'<button type="button" class="so-card" onclick="soPickProduct(\\''+_esc(String(p.item_code)).replace(/'/g,"\\\\'")+'\\')">'`;
  const NEW_CARD = `'<button type="button" class="so-card" data-code="'+_esc(String(p.item_code))+'" onclick="soPickProduct(this.dataset.code)">'`;
  if (!SO_SRC.includes(NEW_CHIP) || !SO_SRC.includes(NEW_CARD)) { fail++; console.log('FAIL - mutant anchors not found in js/search-overlay.js'); }
  const mutants = [
    ['M1 old chip splice restored', async () => overlayChecks(SO_SRC.replace(NEW_CHIP, OLD_CHIP))],
    ['M2 old card splice restored', async () => overlayChecks(SO_SRC.replace(NEW_CARD, OLD_CARD))],
    ['M3 chip value not escaped', async () => overlayChecks(SO_SRC.replace(`data-term="'+_esc(t)+'"`, `data-term="'+t+'"`))],
    ['M4 card code not escaped', async () => overlayChecks(SO_SRC.replace(`data-code="'+_esc(String(p.item_code))+'"`, `data-code="'+String(p.item_code)+'"`))],
    ['M5 jsPDF hash changed', async () => sriChecks(INDEX.replace('JcnsjUPPylna1s1fvi1u12X5qjY5OL56iySh75FdtrwhO', 'AAAAjUPPylna1s1fvi1u12X5qjY5OL56iySh75FdtrwhO'))],
    ['M6 ExcelJS crossorigin removed', async () => sriChecks(INDEX.replace(/(exceljs\.min\.js" integrity="[^"]+") crossorigin="anonymous"/, '$1'))],
    ['M7 integrity removed from jsPDF', async () => sriChecks(INDEX.replace(/(jspdf\.umd\.min\.js") integrity="[^"]+"/, '$1'))],
    ['M8 extra unpinned external script', async () => sriChecks(INDEX.replace('</head>', '<script src="https://cdn.example.invalid/x.js"></script>\n</head>'))]
  ];
  let killed = 0;
  for (const [name, run] of mutants) {
    const f = await run();
    if (f.length) { killed++; console.log('PASS - mutant killed: ' + name); pass++; }
    else { fail++; console.log('FAIL - mutant survived: ' + name); }
  }
  console.log(`H1 hardening (checks + mutants ${killed}/${mutants.length}): ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL - harness error: ' + (e && e.stack || e)); console.log('H1 hardening: 0 passed, 1 failed'); process.exit(1); });
