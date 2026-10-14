/* NEW-ARRIVAL-DATE-FIX regression tests (2026-10-14).
   Run: node tests/new-arrival.test.js
   Loads the real js/helpers.js plus the real saveSku / adminDuplicateProduct /
   pcLogManualEdit source from js/admin.js into a sandbox with a stub DOM, then checks:
   - editing an existing SKU never invents or changes dateAdded / created_at / isNew;
   - genuine adds get precise fresh stamps; duplicates get fresh stamps and no
     inherited price-change metadata, and their first save stamps no price change;
   - bulk Excel update / bulk add / scheduled activation date behaviour;
   - the approved data correction (13 SKUs + 25683) against data/products.json. */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const HELPERS = fs.readFileSync(path.join(ROOT, 'js', 'helpers.js'), 'utf8');
const ADMIN = fs.readFileSync(path.join(ROOT, 'js', 'admin.js'), 'utf8');

let ok = true;
const chk = (n, c, x) => { console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (c || x === undefined ? '' : '  -> ' + JSON.stringify(x))); if (!c) ok = false; };
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/* Top-level function source: from "function NAME(" at column 0 to the next "}" line at column 0. */
function fnSrc(name) {
  const lines = ADMIN.split('\n');
  const i = lines.findIndex(l => l.startsWith('function ' + name + '('));
  if (i < 0) throw new Error('function not found in admin.js: ' + name);
  const j = lines.findIndex((l, k) => k > i && l.replace(/\r$/, '') === '}');
  return lines.slice(i, j + 1).join('\n');
}
function lineSrc(prefix) {
  const l = ADMIN.split('\n').find(x => x.startsWith(prefix));
  if (!l) throw new Error('line not found in admin.js: ' + prefix);
  return l;
}

const FIELDS = ['f-ic','f-name','f-model','f-cat','f-srp','f-dp','f-dpv','f-moq','f-sheet','f-color','f-length','f-upc','f-mat','f-desc','f-feats','f-short','f-img-url'];
function makeSandbox(fixedNow) {
  const RealDate = Date;
  const FixedDate = fixedNow === undefined ? RealDate : class extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(fixedNow); }
    static now() { return fixedNow; }
  };
  const form = {};
  FIELDS.forEach(id => { form[id] = { value: '', style: {}, focus() {} }; });
  const sb = {
    Date: FixedDate, console, JSON, Math, Number, String, Object, Array, isNaN, isFinite, parseFloat, parseInt, RegExp,
    window: { PRICE_SETTINGS: { indicatorDays: 30 } },
    document: { getElementById: id => form[id] || null },
    confirm: () => true, IMAGES: {}, _form: form, _drafts: [], _toasts: [],
  };
  sb.window.IMAGES = sb.IMAGES;
  vm.createContext(sb);
  vm.runInContext(HELPERS, sb);
  vm.runInContext([
    'var ALL_PRODUCTS = []; var editingCode = null; var pendingImgB64 = null; var _recentNewIds = {};',
    'function loadNewSkus(){ return _drafts; } function saveNewSkus(a){ _drafts = a; }',
    'function savePendingImg(){} function updateAll(){} function logActivity(){} function autoSave(){} function markUnsaved(){}',
    'function showToast(m){ _toasts.push(m); } function isAdmin(){ return true; } function openAdminModal(){}',
    'function validateProduct(){ return []; } function findDuplicateByModelName(){ return null; }',
    'function matchCategory(v){ return v; } function matchSection(v){ return v; } function normalizeLength(v){ return v; }',
    'function stripLeadingBullets(l){ return l.replace(/^[\\u2022\\-\\*]\\s?/, ""); }',
    'function adminEditProduct(code){ openEditor(ALL_PRODUCTS.find(function(x){ return String(x.item_code)===String(code); })); }',
    lineSrc('var DUP_PRICE_META_FIELDS'), lineSrc('var _dupFirstSave'),
    fnSrc('saveSku'), fnSrc('adminDuplicateProduct'), fnSrc('pcLogManualEdit'),
  ].join('\n'), sb);
  /* Simulate the editor opening on a product (form filled from the record, editingCode set). */
  sb.openEditor = function (p) {
    const set = (id, v) => { form[id].value = v === null || v === undefined ? '' : String(v); };
    set('f-ic', p ? p.item_code : ''); set('f-name', p && p.product_name); set('f-model', p && p.model);
    set('f-cat', p && p.category); set('f-srp', p && p.srp); set('f-dp', p && p.dp); set('f-dpv', p && p.dp_volume);
    set('f-moq', p && p.moq); set('f-sheet', p && p.sheet); set('f-color', p && p.color); set('f-length', p && p.length);
    set('f-upc', p && p.upc); set('f-mat', p && p.material_number); set('f-desc', p && p.description);
    set('f-feats', p && p.features ? String(p.features).split('\n').filter(l => l !== '*placeholder').map(l => l.replace(/^\*/, '')).join('\n') : '');
    set('f-short', p && p.short_desc); set('f-img-url', '');
    vm.runInContext('editingCode = ' + JSON.stringify(p ? p.item_code : null) + '; pendingImgB64 = null;', sb);
  };
  return sb;
}
const run = (sb, code) => vm.runInContext(code, sb);
const prod = (sb, ic) => run(sb, 'ALL_PRODUCTS').find(x => String(x.item_code) === String(ic));

const BASE = { model: 'M1', product_name: 'Thing', category: 'Cables', sheet: 'Mobile-Cable', sheet_display: 'Mobile: Cable',
  color: 'Black', length: '1M', srp: 1000, dp: 800, dp_volume: 750, moq: 10, upc: '', material_number: '', description: 'old desc',
  short_desc: '', features: '*placeholder\n*f1', remarks: '', image: 'images/x.webp' };
const FIXTURES = {
  NODATE: Object.assign({ item_code: 'NODATE' }, BASE),                                                   // legacy baseline: no date keys
  NULLCA: Object.assign({ item_code: 'NULLCA', dateAdded: '2026-04', created_at: null }, BASE),          // month string, created_at null
  NUMDATE: Object.assign({ item_code: 'NUMDATE', dateAdded: 1785900582886, created_at: '2026-08-05T03:29:42.886Z', isNew: true }, BASE),
  FALSEY: Object.assign({ item_code: 'FALSEY', isNew: false }, BASE),
};
const DATE_KEYS = ['dateAdded', 'created_at', 'isNew'];
const snap = p => DATE_KEYS.map(k => has(p, k) ? k + '=' + JSON.stringify(p[k]) : k + ':absent').join(' ');

/* ---- 1-8: edits of existing SKUs preserve dateAdded / created_at / isNew exactly ---- */
const EDITS = {
  'save with no change': () => {},
  'description only': f => { f['f-desc'].value = 'new description line'; },
  'features only': f => { f['f-feats'].value = 'new feature'; },
  'image only': (f, sb) => { run(sb, 'pendingImgB64 = "data:image/webp;base64,AAAA";'); },
  'price only': f => { f['f-srp'].value = '900'; f['f-dp'].value = '700'; },
  'category only': f => { f['f-cat'].value = 'Chargers'; },
  'model + name': f => { f['f-model'].value = 'M2'; f['f-name'].value = 'Thing 2'; },
};
for (const code of Object.keys(FIXTURES)) {
  for (const label of Object.keys(EDITS)) {
    const sb = makeSandbox();
    const before = JSON.parse(JSON.stringify(FIXTURES[code]));
    run(sb, 'ALL_PRODUCTS.push(' + JSON.stringify(before) + ');');
    sb.openEditor(prod(sb, code)); EDITS[label](sb._form, sb); run(sb, 'saveSku();');
    const after = prod(sb, code), draft = sb._drafts.find(x => x.item_code === code);
    chk(`edit ${code} (${label}): dateAdded/created_at/isNew identical [${snap(before)}]`, snap(after) === snap(before) && snap(draft) === snap(before), { live: snap(after), draft: snap(draft) });
    if (code === 'NODATE') chk(`edit ${code} (${label}): not a New Arrival`, !run(sb, 'isNewArrival')(after));
    if (label === 'image only') chk(`edit ${code} (image only): image changed`, after.image === 'custom_' + code);
    if (label === 'price only') chk(`edit ${code} (price only): real price change still stamped (existing behaviour)`, after.previousSRP === 1000 && after.priceChangeSRP === 'down' && after.srp === 900);
  }
}
/* Edit after the editor stored a draft once (second save, draft merge path) */
{
  const sb = makeSandbox();
  run(sb, 'ALL_PRODUCTS.push(' + JSON.stringify(FIXTURES.NODATE) + ');');
  sb.openEditor(prod(sb, 'NODATE')); sb._form['f-desc'].value = 'a'; run(sb, 'saveSku();');
  sb.openEditor(prod(sb, 'NODATE')); sb._form['f-desc'].value = 'b'; run(sb, 'saveSku();');
  const p = prod(sb, 'NODATE');
  chk('edit twice (draft merge): still no dateAdded / created_at / isNew', !has(p, 'dateAdded') && !has(p, 'created_at') && !has(p, 'isNew') && sb._drafts.length === 1 && !has(sb._drafts[0], 'dateAdded'));
}
/* Item-code rename during edit keeps the original creation fields */
{
  const sb = makeSandbox();
  run(sb, 'ALL_PRODUCTS.push(' + JSON.stringify(FIXTURES.NUMDATE) + ');');
  sb.openEditor(prod(sb, 'NUMDATE')); sb._form['f-ic'].value = 'NUMDATE2'; run(sb, 'saveSku();');
  const p = prod(sb, 'NUMDATE2');
  chk('edit with item-code rename: creation fields copied exactly', p && p.dateAdded === 1785900582886 && p.created_at === '2026-08-05T03:29:42.886Z' && p.isNew === true);
}

/* ---- 9: genuine new SKU through the editor ---- */
{
  const T = Date.UTC(2026, 9, 14, 4, 0, 0);
  const sb = makeSandbox(T);
  sb.openEditor(null);
  Object.assign(sb._form, {}); sb._form['f-ic'].value = 'NEW1'; sb._form['f-name'].value = 'New thing'; sb._form['f-model'].value = 'N1';
  sb._form['f-cat'].value = 'Cables'; sb._form['f-srp'].value = '500'; sb._form['f-dp'].value = '400'; sb._form['f-sheet'].value = 'Mobile-Cable';
  run(sb, 'saveSku();');
  const p = prod(sb, 'NEW1');
  chk('add: dateAdded is a precise numeric timestamp (Date.now), not YYYY-MM', p.dateAdded === T, p.dateAdded);
  chk('add: created_at is the fresh ISO timestamp', p.created_at === new Date(T).toISOString(), p.created_at);
  chk('add: isNew === true', p.isNew === true);
  chk('add: New Arrival badge (isNewArrival) and admin isNewSku semantics', run(sb, 'isNewArrival')(p));
  chk('add: no price-change metadata', !DUP_PRICE_KEYS().some(k => has(p, k)));
  const sbLate = makeSandbox(T + 29 * 86400000); chk('add: still NEW after 29 days', run(sbLate, 'isNewArrival')(p));
  const sbOld = makeSandbox(T + 31 * 86400000); chk('add: expires after 30 days (ms precision, no month-boundary distortion)', !run(sbOld, 'isNewArrival')(p));
}
function DUP_PRICE_KEYS() { return ['previousSRP','priceChangeSRP','srpChangeDate','previousDP','priceChangeDP','dpChangeDate','priceHistory','priceSchedule','pubSRP','pubDP']; }
{
  const sb = makeSandbox();
  chk('DUP_PRICE_META_FIELDS lists exactly the audited price-change metadata fields', JSON.stringify(run(sb, 'DUP_PRICE_META_FIELDS')) === JSON.stringify(DUP_PRICE_KEYS()));
}

/* ---- 10-11: duplicate ---- */
const SRC = Object.assign({ item_code: 'SRC1', dateAdded: '2026-04', created_at: '2026-04-22T05:49:11.310Z',
  previousSRP: 1299, priceChangeSRP: 'up', srpChangeDate: '2026-10-01', previousDP: 1039, priceChangeDP: 'up', dpChangeDate: '2026-10-01',
  priceHistory: [{ effectiveDate: '2026-09-18', createdDate: '2026-09-18', oldSrp: 1199, newSrp: 1299, source: 'seed', seeded: true },
                 { effectiveDate: '2026-10-01', createdDate: '2026-09-30', oldSrp: 1299, newSrp: 1339, source: 'scheduled' }],
  priceSchedule: [{ id: 'pcs_x', effectiveDate: '2099-01-01', createdDate: '2026-10-01', srp: 1500, dp: 1200, dp_volume: null }] },
  BASE, { srp: 1339, dp: 1071, dp_volume: 1004 });
function dupScenario(edit) {
  const T = Date.UTC(2026, 9, 14, 6, 0, 0);
  const sb = makeSandbox(T);
  run(sb, 'ALL_PRODUCTS.push(' + JSON.stringify(SRC) + ');');
  run(sb, 'adminDuplicateProduct("SRC1");');           // pushes the clone and opens the editor on it
  const clone = prod(sb, 'SRC1-COPY');
  const atCreate = JSON.parse(JSON.stringify(clone));
  if (edit) { edit(sb._form); run(sb, 'saveSku();'); }
  return { sb, T, atCreate, clone: prod(sb, sb._form['f-ic'].value || 'SRC1-COPY'), src: prod(sb, 'SRC1') };
}
{
  const { sb, T, atCreate, src } = dupScenario(null);
  chk('duplicate: fresh numeric dateAdded', atCreate.dateAdded === T);
  chk('duplicate: fresh created_at (not the source\'s)', atCreate.created_at === new Date(T).toISOString() && atCreate.created_at !== SRC.created_at);
  chk('duplicate: isNew === true', atCreate.isNew === true);
  chk('duplicate: no inherited price-change badge / history / schedule fields', !DUP_PRICE_KEYS().some(k => has(atCreate, k)), DUP_PRICE_KEYS().filter(k => has(atCreate, k)));
  chk('duplicate: no price-change badge, but New Arrival', !run(sb, 'pcHasRecent')(atCreate) && run(sb, 'isNewArrival')(atCreate));
  chk('duplicate: source record untouched', JSON.stringify(src) === JSON.stringify(SRC));
}
{
  // First save of the clone with a NEW price (the 25683 scenario): no synthetic "Decrease, Before 1,339".
  const { sb, T, clone } = dupScenario(f => { f['f-ic'].value = 'DUPNEW'; f['f-srp'].value = '1239'; f['f-dp'].value = '991'; f['f-dpv'].value = '929'; });
  chk('duplicate first save with changed price: no price-change badge fields', clone && !['previousSRP','priceChangeSRP','srpChangeDate','previousDP','priceChangeDP','dpChangeDate'].some(k => has(clone, k)), clone);
  chk('duplicate first save: no priceHistory / priceSchedule', clone && !has(clone, 'priceHistory') && !has(clone, 'priceSchedule'));
  chk("duplicate first save: prices are the entered ones", clone && clone.srp === 1239 && clone.dp === 991 && clone.dp_volume === 929, clone && [clone.srp, clone.dp, clone.dp_volume]);
  chk('duplicate first save: keeps its fresh creation stamps', clone && clone.dateAdded === T && clone.created_at === new Date(T).toISOString() && clone.isNew === true);
  chk('duplicate first save: New Arrival yes, pcHasRecent no', clone && run(sb, 'isNewArrival')(clone) && !run(sb, 'pcHasRecent')(clone));
  // A later, genuine price change on the (now created) duplicate is stamped normally.
  sb.openEditor(clone); sb._form['f-srp'].value = '1199'; run(sb, 'saveSku();');
  const c2 = prod(sb, 'DUPNEW');
  chk('duplicate second save with a real price change: stamped normally (1239 -> 1199)', c2.previousSRP === 1239 && c2.priceChangeSRP === 'down' && c2.priceHistory && c2.priceHistory.length === 1 && c2.priceHistory[0].oldSrp === 1239);
}

{
  // Same, keeping the -COPY item code (no rename).
  const { sb, clone } = dupScenario(f => { f['f-srp'].value = '1239'; f['f-dp'].value = '991'; });
  chk('duplicate first save (no rename): no synthetic price change, New Arrival yes', clone && clone.item_code === 'SRC1-COPY' && clone.srp === 1239 && !run(sb, 'pcHasRecent')(clone) && !has(clone, 'priceHistory') && run(sb, 'isNewArrival')(clone));
  // Lifecycle: the first save consumes the suppression mark ...
  chk('duplicate first save (no rename): _dupFirstSave mark consumed', !has(run(sb, '_dupFirstSave'), 'SRC1-COPY'), Object.keys(run(sb, '_dupFirstSave')));
  // ... so a SECOND save of the same item code (no rename) with a real price change is stamped normally.
  sb.openEditor(prod(sb, 'SRC1-COPY')); sb._form['f-srp'].value = '1199'; sb._form['f-dp'].value = '959'; run(sb, 'saveSku();');
  const c2 = prod(sb, 'SRC1-COPY');
  chk('duplicate second save (no rename): price-change badge stamped against the first-save price (1239 -> 1199, 991 -> 959)',
      c2.previousSRP === 1239 && c2.priceChangeSRP === 'down' && c2.previousDP === 991 && c2.priceChangeDP === 'down' && run(sb, 'pcHasRecent')(c2), c2);
  chk('duplicate second save (no rename): priceHistory has exactly the one real edit', Array.isArray(c2.priceHistory) && c2.priceHistory.length === 1 && c2.priceHistory[0].oldSrp === 1239 && c2.priceHistory[0].newSrp === 1199 && c2.priceHistory[0].source === 'edit', c2.priceHistory);
  chk('duplicate second save (no rename): creation stamps unchanged', c2.dateAdded === clone.dateAdded && c2.created_at === clone.created_at && c2.isNew === true);
}

/* ---- 12-13: bulk Excel upload (source-level: the handler is DOM / XLSX bound) ---- */
{
  const upd = ADMIN.slice(ADMIN.indexOf('// v1.1.17: SAFE PARTIAL UPDATE'), ADMIN.indexOf('// ADD new product. Per spec'));
  const tracked = [...upd.matchAll(/track(?:Str|Num)\('(\w+)'/g)].map(m => m[1]);
  chk('bulk update: tracked fields found', tracked.length >= 12, tracked);
  chk('bulk update: never writes dateAdded / created_at / isNew', !tracked.some(f => DATE_KEYS.includes(f)) && !/dateAdded|created_at|isNew/.test(upd.replace(/\/\/.*$/gm, '')));
  chk('bulk apply: updates assign only the diffed keys (c.u)', ADMIN.includes("Object.keys(c.u).forEach(function(k){ p[k] = c.u[k]; });"));
  const add = ADMIN.slice(ADMIN.indexOf('// ADD new product. Per spec'), ADMIN.indexOf('// v1.3.0: REJECT entire file if duplicate'));
  chk('bulk add: current behaviour kept — month dateAdded (_da) + ISO created_at, no isNew (documented discrepancy)', /dateAdded: _da, created_at: _now/.test(add) && !/isNew/.test(add) && /var _da\s*=\s*_now\.slice\(0, 7\)/.test(ADMIN));
}

/* ---- 14: scheduled price activation never touches creation fields ---- */
{
  const sb = makeSandbox();
  const ps = [JSON.parse(JSON.stringify(FIXTURES.NODATE)), JSON.parse(JSON.stringify(FIXTURES.NUMDATE))];
  ps.forEach(p => { p.priceSchedule = [{ id: 'pcs_t', effectiveDate: '2000-01-01', createdDate: '2000-01-01', srp: 950, dp: 760, dp_volume: null }]; });
  const before = ps.map(snap);
  const n = run(sb, 'pcResolveSchedule')(ps);
  chk('scheduled activation: changes applied', n === 2 && ps[0].srp === 950 && ps[1].srp === 950);
  chk('scheduled activation: dateAdded / created_at / isNew unchanged', ps.map(snap).join('|') === before.join('|'), ps.map(snap));
}

/* ---- 15-16: approved data correction (13 SKUs + 25683) against data/products.json ----
   NEW-ARRIVAL-DATA-CORRECTION (owner-approved 2026-10-14): 33 key REMOVALS — 13 legacy SKUs lose BOTH dateAdded and
   created_at (both absent before the faulty CMS Publish d0002bb; removed, never set to null), 25683 loses the 7 price
   fields inherited from 95424B / stamped by its first save. Key presence is checked, not just values (NA-14). */
const CORRECT_13 = ['30732','75177','45301','75545','35900','85570','85638','75644','95796','85201','85478','55527','55530'];
const KEYS_13 = ['dateAdded', 'created_at'];
const STRIP_25683 = ['previousSRP','priceChangeSRP','srpChangeDate','previousDP','priceChangeDP','dpChangeDate','priceHistory'];
{
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'products.json'), 'utf8'));
  const find = c => data.find(p => p.item_code === c) || {};
  const state13 = CORRECT_13.map(c => KEYS_13.map(k => has(find(c), k) ? 1 : 0).join('')).join(',');
  const applied = CORRECT_13.every(c => KEYS_13.every(k => !has(find(c), k)));
  const pending = CORRECT_13.every(c => find(c).dateAdded === '2026-10' && has(find(c), 'created_at') && find(c).created_at === null);
  chk('data: 13 SKUs are either fully corrected or fully pre-correction (no partial / null-instead-of-absent state)', applied || pending, state13);
  const fixed = JSON.parse(JSON.stringify(data));
  fixed.forEach(p => {                                     // idempotent: a no-op once the correction is applied
    if (CORRECT_13.includes(p.item_code)) KEYS_13.forEach(k => { delete p[k]; });
    if (p.item_code === '25683') STRIP_25683.forEach(k => { delete p[k]; });
  });
  console.log('INFO data correction ' + (applied ? 'present in data/products.json' : 'NOT yet applied — checking the proposed correction applied to the current data'));
  const sb = makeSandbox(Date.UTC(2026, 9, 14, 15, 0, 0));    // fixed "now" = 2026-10-14 15:00Z (after every 2026-10-14 add) so the window is deterministic
  const isNA = run(sb, 'isNewArrival'), pcRecent = run(sb, 'pcHasRecent');
  const byCode = Object.fromEntries(fixed.map(p => [p.item_code, p]));
  chk('data: all 13 SKUs present', CORRECT_13.every(c => byCode[c]));
  chk('data: 13 corrected SKUs have NEITHER dateAdded NOR created_at key', CORRECT_13.every(c => KEYS_13.every(k => !has(byCode[c], k))));
  chk('data: 13 corrected SKUs are NOT New Arrivals', CORRECT_13.every(c => !isNA(byCode[c])), CORRECT_13.filter(c => isNA(byCode[c])));
  const p = byCode['25683'];
  chk('data: 25683 is a New Arrival', p && isNA(p));
  chk('data: 25683 has no price-change badge / history keys', p && !pcRecent(p) && !STRIP_25683.some(k => has(p, k)));
  chk('data: 25683 keeps its current prices (1239 / 991 / 929)', p && p.srp === 1239 && p.dp === 991 && p.dp_volume === 929);
  chk('data: 25683 keeps its creation fields (dateAdded 1791964097363, created_at null, isNew true)', p && p.dateAdded === 1791964097363 && has(p, 'created_at') && p.created_at === null && p.isNew === true);
  chk('data: 826 products, unique item codes', fixed.length === 826 && new Set(fixed.map(x => String(x.item_code))).size === 826);
  const naCount = fixed.filter(x => !x.disabled && isNA(x)).length;
  chk('data: 18 New Arrivals after the correction (fixed now 2026-10-14 15:00Z)', naCount === 18, naCount);
  // Exactly the approved 33 keys differ (key presence aware) between the current data and the corrected data.
  const diffs = [];
  data.forEach((q, i) => { const r = fixed[i]; new Set([...Object.keys(q), ...Object.keys(r)]).forEach(k => {
    if (has(q, k) !== has(r, k) || JSON.stringify(q[k]) !== JSON.stringify(r[k])) diffs.push(q.item_code + '.' + k); }); });
  const expected = applied ? [] : [...CORRECT_13.flatMap(c => KEYS_13.map(k => c + '.' + k)), ...STRIP_25683.map(k => '25683.' + k)];
  chk('data: correction touches exactly the approved keys (' + (applied ? '0 remaining' : '33') + ')', diffs.slice().sort().join() === expected.slice().sort().join() && fixed.length === data.length && fixed.every((x, i) => x.item_code === data[i].item_code), diffs);
}

/* ---- 17: DUPLICATE-BADGE-CORRECTION (owner-approved 2026-10-14) ----
   10541 / 80430 / 80433 were duplicated before the d5ae7e81 fix; their first save stamped a fake price-change badge
   against the source's price (10540 389/292, 80431 279/195). The 6 badge keys are removed (18 total); the SKUs stay
   genuine New Arrivals with their prices, and the genuine Oct-1 changes of 55988C / 25919C / 75646A are kept. */
{
  const BADGE = ['previousSRP','priceChangeSRP','srpChangeDate','previousDP','priceChangeDP','dpChangeDate'];
  const FAKE = { '10541': [459, 344, 321, 389, 292], '80430': [259, 181, 168, 279, 195], '80433': [569, 398, 370, 279, 195] };
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'products.json'), 'utf8'));
  const find = c => data.find(p => p.item_code === c) || {};
  const applied = Object.keys(FAKE).every(c => BADGE.every(k => !has(find(c), k)));
  const pending = Object.entries(FAKE).every(([c, v]) => find(c).previousSRP === v[3] && find(c).previousDP === v[4] && find(c).srpChangeDate === '2026-09-22');
  chk('dup-badge: 3 SKUs fully corrected or fully pre-correction (no partial state)', applied || pending);
  const fixed = JSON.parse(JSON.stringify(data));
  fixed.forEach(p => { if (FAKE[p.item_code]) BADGE.forEach(k => { delete p[k]; }); });
  console.log('INFO duplicate-badge correction ' + (applied ? 'present in data/products.json' : 'NOT yet applied — checking it against the current data'));
  const sb = makeSandbox(Date.UTC(2026, 9, 14, 15, 0, 0));
  const isNA = run(sb, 'isNewArrival'), pcRecent = run(sb, 'pcHasRecent');
  const byC = Object.fromEntries(fixed.map(p => [p.item_code, p]));
  for (const [c, v] of Object.entries(FAKE)) {
    const p = byC[c];
    chk(`dup-badge: ${c} has no price-change badge keys and no badge`, p && !BADGE.some(k => has(p, k)) && !pcRecent(p));
    chk(`dup-badge: ${c} keeps prices ${v[0]} / ${v[1]} / ${v[2]} and stays a New Arrival`, p && p.srp === v[0] && p.dp === v[1] && p.dp_volume === v[2] && typeof p.dateAdded === 'number' && p.isNew === true && isNA(p));
  }
  for (const c of ['55988C', '25919C', '75646A'])
    chk(`dup-badge: ${c} keeps its genuine 2026-10-01 price-change badge and history`, byC[c] && byC[c].srpChangeDate === '2026-10-01' && pcRecent(byC[c]) && (byC[c].priceHistory || []).length === 1 && byC[c].priceHistory[0].source === 'scheduled');
  chk('dup-badge: New Arrivals still 18 at fixed now 2026-10-14 15:00Z', fixed.filter(x => !x.disabled && isNA(x)).length === 18);
  const diffs = [];
  data.forEach((q, i) => { const r = fixed[i]; new Set([...Object.keys(q), ...Object.keys(r)]).forEach(k => {
    if (has(q, k) !== has(r, k) || JSON.stringify(q[k]) !== JSON.stringify(r[k])) diffs.push(q.item_code + '.' + k); }); });
  const expected = applied ? [] : Object.keys(FAKE).flatMap(c => BADGE.map(k => c + '.' + k));
  chk('dup-badge: correction touches exactly the approved keys (' + (applied ? '0 remaining' : '18') + ')', diffs.slice().sort().join() === expected.slice().sort().join(), diffs);
}

console.log(ok ? '\nALL PASS' : '\nFAILURES'); process.exit(ok ? 0 : 1);
