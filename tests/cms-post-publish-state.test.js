/* CMS-POST-PUBLISH-STATE-FIX regression tests (2026-10-15; NA-21 / NA-22).
   Run: node tests/cms-post-publish-state.test.js
   Loads the real migration / overlay / indicator source from js/admin.js and the whole of
   js/github-save.js into a sandbox with stub localStorage, DOM, timers and fetch (the CMS Worker
   and GitHub are never contacted), then checks:
   - the one-time NA-22 migration removes ONLY 35605B / 45089 / 35856 from ugreen_deleted, once;
   - a confirmed publish clears exactly the published removals / unchanged drafts;
   - a failed / cancelled publish keeps every local key byte-identical and the unsaved indicator;
   - 5xx / timeout adopt the publish only after a count + hash read-back match;
   - the indicator never shows "Unsaved changes" after a confirmed publish with nothing left;
   - a Version-History restore of a snapshot older than the clean-up drops the 3 stale codes (NA-26).
   Ends with mutation checks: each broken guard must make the suite fail. */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const ADMIN = fs.readFileSync(path.join(ROOT, 'js', 'admin.js'), 'utf8');
const SAVE = fs.readFileSync(path.join(ROOT, 'js', 'github-save.js'), 'utf8');
const CATALOG = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'products.json'), 'utf8'));
const STALE = ['35605B', '45089', '35856'];
const KEYS = ['ugreen_deleted', 'ugreen_new_skus', 'ugreen_pending_imgs'];
const UNSAVED = '● Unsaved changes';

function fnSrc(src, name) {
  const lines = src.split('\n');
  const i = lines.findIndex(l => l.startsWith('function ' + name + '('));
  if (i < 0) throw new Error('function not found: ' + name);
  if (lines[i].replace(/\r$/, '').endsWith('}')) return lines[i];          // one-line function
  const j = lines.findIndex((l, k) => k > i && l.replace(/\r$/, '') === '}');
  return lines.slice(i, j + 1).join('\n');
}
function lineSrc(src, prefix) {
  const l = src.split('\n').find(x => x.startsWith(prefix));
  if (!l) throw new Error('line not found: ' + prefix);
  return l;
}

function makeSandbox(adminSrc, saveSrc, opts) {
  opts = opts || {};
  const store = new Map();
  const timers = [];
  const ind = { textContent: '', className: '', style: {} };
  const sb = {
    console: { log() {}, warn() {}, info() {}, error() {} }, JSON, Math, Date, Number, String, Object, Array, Promise,
    isNaN, parseInt, parseFloat, RegExp, Error, AbortController, encodeURIComponent, unescape,
    btoa: s => Buffer.from(s, 'binary').toString('base64'),
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: k => { store.delete(k); },
    },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: () => {},
    document: {
      getElementById: id => (id === 'save-indicator' ? ind : null),
      querySelector: () => null,
    },
    _toasts: [], _fetches: [],
    confirm: () => (opts.confirm === undefined ? true : opts.confirm),
    location: { reload() { sb._reloaded = (sb._reloaded || 0) + 1; } },
    prompt: () => (opts.prompt === undefined ? 'pw' : opts.prompt),
  };
  sb.window = sb;
  sb.window.CONFIG = { backend: { workerEndpoint: 'https://cms.invalid/save' }, github: { owner: 'o', repo: 'r', branch: 'main' } };
  sb.showToast = m => sb._toasts.push(m);
  sb.showLoading = () => {}; sb.hideLoading = () => {};
  sb.fetch = (url, init) => { sb._fetches.push({ url, init }); return sb._fetchImpl(url, init); };
  sb._fetchImpl = () => Promise.reject(new Error('no fetch stub'));
  vm.createContext(sb);
  vm.runInContext([
    lineSrc(adminSrc, 'var _errLog'), lineSrc(adminSrc, 'function _logErr('),
    lineSrc(adminSrc, 'var LS_KEY'), fnSrc(adminSrc, 'loadNewSkus'), fnSrc(adminSrc, 'saveNewSkus'),
    lineSrc(adminSrc, 'var PENDING_IMGS_KEY'), fnSrc(adminSrc, 'loadPendingImgs'), fnSrc(adminSrc, 'clearPendingImgs'),
    lineSrc(adminSrc, 'var NA22_MIGR_KEY'), lineSrc(adminSrc, 'var NA22_STALE_CODES'),
    fnSrc(adminSrc, 'migrateStaleDeletionsNA22'), fnSrc(adminSrc, 'na22FilterSnapshotDeletions'), fnSrc(adminSrc, 'applyPendingOverlay'),
    lineSrc(adminSrc, 'var VERSION_HISTORY_KEY'), fnSrc(adminSrc, 'loadVersionHistory'), fnSrc(adminSrc, 'restoreVersionSnapshot'),
    lineSrc(adminSrc, 'var DELETED_PRODUCTS'), 'var ALL_PRODUCTS = [];',
    lineSrc(adminSrc, 'var HAS_UNSAVED_CHANGES'), fnSrc(adminSrc, 'markUnsaved'), fnSrc(adminSrc, 'updateSaveIndicator'),
    fnSrc(adminSrc, 'highlightDownloadButton'), fnSrc(adminSrc, 'removeDownloadHighlight'),
  ].join('\n'), sb);
  vm.runInContext(saveSrc, sb);
  sb._store = store; sb._ind = ind;
  sb._runTimers = ms => { const due = timers.filter(t => t.ms === ms); due.forEach(t => timers.splice(timers.indexOf(t), 1)); due.forEach(t => t.fn()); };
  return sb;
}
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); };
const snapKeys = sb => KEYS.map(k => sb._store.has(k) ? sb._store.get(k) : null);
const codes = sb => vm.runInContext('ALL_PRODUCTS.map(function(p){return String(p.item_code);})', sb);
const delCodes = sb => vm.runInContext('DELETED_PRODUCTS.map(function(p){return String(p.item_code);})', sb);
const ev = (sb, s) => vm.runInContext(s, sb);
const json = o => JSON.stringify(o);
const respond = (status, body) => () => Promise.resolve({ status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body) });

async function suite(adminSrc, saveSrc, log) {
  let fails = 0;
  const chk = (n, c, x) => { if (log) console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (c || x === undefined ? '' : '  -> ' + JSON.stringify(x))); if (!c) fails++; };
  const T = (n, fn) => { try { return fn(); } catch (e) { chk(n + ' (threw: ' + e.message + ')', false); } };

  /* ---- A. one-time NA-22 migration ---- */
  T('A1', () => {
    const sb = makeSandbox(adminSrc, saveSrc);
    sb._store.set('ugreen_deleted', json(['35605B', '45089', '35856', 'X1', 12345]));
    const n = ev(sb, 'migrateStaleDeletionsNA22()');
    chk('A1 migration removes only the 3 stale codes, keeps others in order', sb._store.get('ugreen_deleted') === json(['X1', 12345]), sb._store.get('ugreen_deleted'));
    chk('A1 migration reports 3 removed', n === 3, n);
    chk('A1 marker set', !!sb._store.get('ugreen_migr_na22_v1'));
  });
  T('A2', () => {
    const sb = makeSandbox(adminSrc, saveSrc);
    sb._store.set('ugreen_deleted', json([45089, 35856, 'X2']));
    ev(sb, 'migrateStaleDeletionsNA22()');
    chk('A2 numeric entries 45089 / 35856 are removed', sb._store.get('ugreen_deleted') === json(['X2']), sb._store.get('ugreen_deleted'));
  });
  T('A3', () => {
    const sb = makeSandbox(adminSrc, saveSrc);
    sb._store.set('ugreen_deleted', json(['35856', 'X3']));
    ev(sb, 'migrateStaleDeletionsNA22()');
    sb._store.set('ugreen_deleted', json(['X3', '35856']));   // owner deliberately removes 35856 again later
    const n = ev(sb, 'migrateStaleDeletionsNA22()');
    chk('A3 second run is a no-op (deliberate later removal survives)', sb._store.get('ugreen_deleted') === json(['X3', '35856']) && n === 0, sb._store.get('ugreen_deleted'));
  });
  T('A4', () => {
    const cases = [['missing', undefined], ['empty string', ''], ['empty list', '[]'], ['malformed JSON', '{oops'], ['non-list JSON', '{"a":1}']];
    cases.forEach(([label, v]) => {
      const sb = makeSandbox(adminSrc, saveSrc);
      if (v !== undefined) sb._store.set('ugreen_deleted', v);
      let threw = false;
      try { ev(sb, 'migrateStaleDeletionsNA22()'); } catch (e) { threw = true; }
      const after = sb._store.has('ugreen_deleted') ? sb._store.get('ugreen_deleted') : undefined;
      chk('A4 ' + label + ': no throw, value unchanged', !threw && after === v, after);
      const bad = label === 'malformed JSON' || label === 'non-list JSON';
      chk('A4 ' + label + ': marker ' + (bad ? 'NOT set (retry next load)' : 'set'), bad ? !sb._store.has('ugreen_migr_na22_v1') : sb._store.has('ugreen_migr_na22_v1'));
    });
  });
  T('A5', () => {
    const sb = makeSandbox(adminSrc, saveSrc);
    sb._store.set('ugreen_new_skus', json([{ item_code: 'D1', srp: 1 }]));
    sb._store.set('ugreen_pending_imgs', json({ k: 'data:x' }));
    sb._store.set('ugreen_other', 'keep');
    sb._store.set('ugreen_deleted', json(['35605B']));
    ev(sb, 'migrateStaleDeletionsNA22()');
    chk('A5 migration leaves other keys untouched', sb._store.get('ugreen_new_skus') === json([{ item_code: 'D1', srp: 1 }]) &&
      sb._store.get('ugreen_pending_imgs') === json({ k: 'data:x' }) && sb._store.get('ugreen_other') === 'keep');
  });
  /* ---- A6. migration runs before the overlay (real catalogue) ---- */
  T('A6', () => {
    const sb = makeSandbox(adminSrc, saveSrc);
    const other = String(CATALOG[0].item_code);
    chk('A6 catalogue has 826 products incl. the 3 restored SKUs', CATALOG.length === 826 && STALE.every(c => CATALOG.some(p => String(p.item_code) === c)), CATALOG.length);
    sb.ALL_PRODUCTS = JSON.parse(JSON.stringify(CATALOG));
    sb._store.set('ugreen_deleted', json(['35605B', '45089', '35856', other]));
    ev(sb, 'applyPendingOverlay()');
    const c = codes(sb);
    chk('A6 after load the 3 SKUs are visible', STALE.every(x => c.includes(x)), STALE.filter(x => !c.includes(x)));
    chk('A6 the other deletion is still applied (825 shown)', c.length === 825 && !c.includes(other), c.length);
    chk('A6 Removed Products holds only the other code', json(delCodes(sb)) === json([other]), delCodes(sb));
    chk('A6 storage keeps only the other code', sb._store.get('ugreen_deleted') === json([other]));
    sb.ALL_PRODUCTS = JSON.parse(JSON.stringify(CATALOG)); ev(sb, 'DELETED_PRODUCTS.length = 0; applyPendingOverlay()');
    chk('A6 reload: still 825 and the 3 SKUs visible', codes(sb).length === 825 && STALE.every(x => codes(sb).includes(x)));
  });

  /* ---- R. NA-26 Version-History restore ---- */
  const restore = (sb, snap, marker) => {
    if (marker !== undefined) sb._store.set('ugreen_migr_na22_v1', String(marker));
    sb._store.set('ugreen_version_history', json([Object.assign({ version: 'v1', customSkus: [] }, snap)]));
    ev(sb, 'restoreVersionSnapshot(0)');
    return sb._store.get('ugreen_deleted');
  };
  T('R1', () => {
    const got = restore(makeSandbox(adminSrc, saveSrc), { timestamp: 1000, deletedIds: ['35605B', 'X1', 45089, '35856', 77] }, 2000);
    chk('R1 snapshot older than the clean-up: 3 stale codes dropped, others kept in order', got === json(['X1', 77]), got);
  });
  T('R2', () => {
    const got = restore(makeSandbox(adminSrc, saveSrc), { timestamp: 3000, deletedIds: ['35856', 'X1'] }, 2000);
    chk('R2 snapshot taken after the clean-up is restored verbatim (deliberate removal kept)', got === json(['35856', 'X1']), got);
  });
  T('R3', () => {
    const got = restore(makeSandbox(adminSrc, saveSrc), { timestamp: 1000, deletedIds: ['35605B', 'X1'] });
    chk('R3 clean-up not yet run: restored verbatim (the next load migrates it)', got === json(['35605B', 'X1']), got);
    const got2 = restore(makeSandbox(adminSrc, saveSrc), { deletedIds: ['35605B', 'X1'] });
    chk('R3 clean-up not yet run, snapshot without timestamp: restored verbatim', got2 === json(['35605B', 'X1']), got2);
  });
  T('R4', () => {
    const got = restore(makeSandbox(adminSrc, saveSrc), { deletedIds: ['45089', 'X1'] }, 2000);
    chk('R4 snapshot without a timestamp is treated as old: stale code dropped', got === json(['X1']), got);
  });
  T('R5', () => {
    const sb = makeSandbox(adminSrc, saveSrc);
    const got = restore(sb, { timestamp: 1000, deletedIds: ['35605B'], customSkus: [{ item_code: 'D9' }] }, 2000);
    chk('R5 drafts restored unchanged and the page reloads', got === '[]' && sb._store.get('ugreen_new_skus') === json([{ item_code: 'D9' }]) && sb._reloaded === undefined);
    sb._runTimers(1400);
    chk('R5 reload scheduled', sb._reloaded === 1);
  });
  T('R6', () => {
    const sb = makeSandbox(adminSrc, saveSrc, { confirm: false });
    sb._store.set('ugreen_deleted', json(['KEEP']));
    const got = restore(sb, { timestamp: 1000, deletedIds: ['X1'] }, 2000);
    chk('R6 restore cancelled: ugreen_deleted untouched', got === json(['KEEP']), got);
  });

  /* ---- B/C/D. publish outcomes ---- */
  // Setup: catalogue P1..P4, removal of P9 (published) and draft P2 edit.
  function pubSandbox(o) {
    const sb = makeSandbox(adminSrc, saveSrc, o);
    sb.ALL_PRODUCTS = [{ item_code: 'P1' }, { item_code: 'P2', srp: 2 }, { item_code: 'P3' }];
    ev(sb, 'DELETED_PRODUCTS.push({item_code:"P9"})');
    sb._store.set('ugreen_deleted', json(['P9', 'STALE1']));
    sb._store.set('ugreen_new_skus', json([{ item_code: 'P2', srp: 2 }]));
    sb._store.set('ugreen_pending_imgs', json({ img1: 'data:image/png;base64,AA' }));
    ev(sb, 'markUnsaved()');
    return sb;
  }
  const publish = sb => { const built = ev(sb, '_buildSavePayload()'); sb._built = built; ev(sb, '_doPublish("https://cms.invalid/save", window.CONFIG, "pw", _built)'); return built; };

  await (async () => {
    const sb = pubSandbox();
    sb._fetchImpl = respond(200, { ok: true, commit: 'abcdef1234' });
    publish(sb);
    // a removal and an edit made while the request is in flight
    sb._store.set('ugreen_deleted', json(['P9', 'STALE1', 'P3']));
    await flush();
    chk('B1 success removes published removals only; in-flight removal P3 kept', sb._store.get('ugreen_deleted') === json(['P3']), sb._store.get('ugreen_deleted'));
    chk('B1 success clears the unchanged draft', sb._store.get('ugreen_new_skus') === '[]', sb._store.get('ugreen_new_skus'));
    chk('B1 Removed Products in memory drops the published P9', !delCodes(sb).includes('P9'), delCodes(sb));
    chk('B1 in-flight removal pending -> indicator stays unsaved', sb._ind.textContent === UNSAVED && ev(sb, 'HAS_UNSAVED_CHANGES') === true, sb._ind.textContent);
    chk('B1 only the Worker was called (one POST)', sb._fetches.length === 1 && sb._fetches[0].init.method === 'POST');
  })();
  await (async () => {
    const sb = pubSandbox();
    sb._fetchImpl = respond(200, { ok: true, commit: 'abcdef1234' });
    publish(sb);
    sb._store.set('ugreen_new_skus', json([{ item_code: 'P2', srp: 3 }]));   // edited again in flight
    await flush();
    chk('B2 a draft edited in flight survives', sb._store.get('ugreen_new_skus') === json([{ item_code: 'P2', srp: 3 }]), sb._store.get('ugreen_new_skus'));
  })();
  await (async () => {
    const sb = pubSandbox();
    sb._fetchImpl = respond(200, { ok: true, commit: 'abcdef1234' });
    publish(sb);
    await flush();
    chk('D1 NA-21: nothing left -> indicator is not "Unsaved changes"', sb._ind.textContent !== UNSAVED && sb._ind.className.indexOf('unsaved') < 0, sb._ind.textContent);
    chk('D1 indicator shows Published and HAS_UNSAVED_CHANGES false', sb._ind.textContent === '✓ Published' && ev(sb, 'HAS_UNSAVED_CHANGES') === false, sb._ind.textContent);
    chk('B3 all local keys cleared', sb._store.get('ugreen_deleted') === '[]' && sb._store.get('ugreen_new_skus') === '[]' && !sb._store.has('ugreen_pending_imgs'));
    chk('B3 baseline + last-publish stamp updated', ev(sb, 'window._UG_BASELINE.count') === 3 && sb._store.has('ugreen_last_publish'));
  })();
  await (async () => {
    // a removal entry whose code is still in the published payload is not cleared
    const sb = pubSandbox();
    sb._store.set('ugreen_deleted', json(['P9', 'P1']));
    sb._fetchImpl = respond(200, { ok: true });
    publish(sb);
    await flush();
    chk('B4 removal of a code still published (P1) is kept', sb._store.get('ugreen_deleted') === json(['P1']), sb._store.get('ugreen_deleted'));
  })();
  await (async () => {
    const sb = pubSandbox();
    sb._store.set('ugreen_deleted', '{broken');
    sb._fetchImpl = respond(200, { ok: true });
    publish(sb);
    await flush();
    chk('B5 unreadable ugreen_deleted is never rewritten on success', sb._store.get('ugreen_deleted') === '{broken');
  })();

  for (const [label, impl] of [
    ['401', respond(401, { error: 'bad pw' })], ['409', respond(409, {})], ['413', respond(413, {})], ['400', respond(400, { error: 'x' })],
    ['network error', () => Promise.reject(new Error('offline'))],
  ]) {
    await (async () => {
      const sb = pubSandbox();
      const before = snapKeys(sb);
      sb._fetchImpl = impl;
      publish(sb);
      await flush(); sb._runTimers(5000); await flush();
      chk('C ' + label + ': all local keys byte-identical', json(snapKeys(sb)) === json(before), snapKeys(sb));
      chk('C ' + label + ': indicator still unsaved', sb._ind.textContent === UNSAVED && ev(sb, 'HAS_UNSAVED_CHANGES') === true, sb._ind.textContent);
      chk('C ' + label + ': Removed Products in memory unchanged', json(delCodes(sb)) === json(['P9']));
    })();
  }
  for (const [label, o] of [['cancel at confirm', { confirm: false }], ['password prompt cancelled', { prompt: null }], ['empty password', { prompt: '' }]]) {
    const sb = pubSandbox(o);
    const before = snapKeys(sb);
    ev(sb, 'saveToGitHub()');
    await flush();
    chk('C ' + label + ': nothing sent, keys identical, still unsaved', sb._fetches.length === 0 && json(snapKeys(sb)) === json(before) && sb._ind.textContent === UNSAVED);
  }

  /* ---- 5xx / timeout: adopt only after a count + hash read-back match ---- */
  const readBack = (sb, products) => (url, init) => (init && init.method === 'POST') ? sb._post() :
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(products) });
  for (const [label, post] of [['5xx', () => respond(502, {})()], ['timeout', () => Promise.reject({ name: 'AbortError' })]]) {
    await (async () => {
      const sb = pubSandbox();
      sb._post = post;
      sb._fetchImpl = (u, i) => readBack(sb, sb._built.products)(u, i);
      publish(sb); await flush();
      chk(label + ' before read-back: nothing cleared', sb._store.get('ugreen_deleted') === json(['P9', 'STALE1']));
      sb._runTimers(5000); await flush();
      chk(label + ' + read-back match: published state cleared and indicator not unsaved',
        sb._store.get('ugreen_deleted') === '[]' && sb._store.get('ugreen_new_skus') === '[]' && sb._ind.textContent !== UNSAVED, [sb._store.get('ugreen_deleted'), sb._ind.textContent]);
    })();
    await (async () => {
      const sb = pubSandbox();
      const before = snapKeys(sb);
      sb._post = post;
      sb._fetchImpl = (u, i) => readBack(sb, sb._built.products.concat([{ item_code: 'EXTRA' }]))(u, i);
      publish(sb); await flush(); sb._runTimers(5000); await flush();
      chk(label + ' + read-back mismatch: keys identical, still unsaved', json(snapKeys(sb)) === json(before) && sb._ind.textContent === UNSAVED);
    })();
    await (async () => {
      // NA-29: same product count, one field differs -> hash mismatch -> never adopt
      const sb = pubSandbox();
      const before = snapKeys(sb);
      sb._post = post;
      sb._fetchImpl = (u, i) => readBack(sb, sb._built.products.map((p, k) => k === 0 ? Object.assign({}, p, { srp: 999999 }) : p))(u, i);
      publish(sb); await flush(); sb._runTimers(5000); await flush();
      chk(label + ' + read-back same count, different hash: keys identical, still unsaved', json(snapKeys(sb)) === json(before) && sb._ind.textContent === UNSAVED && sb._store.get('ugreen_deleted') === json(['P9', 'STALE1']));
    })();
    await (async () => {
      const sb = pubSandbox();
      const before = snapKeys(sb);
      sb._post = post;
      sb._fetchImpl = (u, i) => (i && i.method === 'POST') ? sb._post() : Promise.reject(new Error('raw down'));
      publish(sb); await flush(); sb._runTimers(5000); await flush();
      chk(label + ' + read-back failed: keys identical, still unsaved', json(snapKeys(sb)) === json(before) && sb._ind.textContent === UNSAVED);
    })();
  }
  await (async () => {
    const sb = pubSandbox();
    let called = 0;
    sb._cb = () => { called++; };
    sb._fetchImpl = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([{}, {}, {}]) });
    ev(sb, '_verifyPublished(3, null, _cb)');
    sb._runTimers(5000); await flush();
    chk('V1 count-only match (no hash) never adopts', called === 0, called);
  })();

  return fails;
}

const MUTANTS = [
  ['migration removes every entry', 'a', 'return NA22_STALE_CODES.indexOf(String(ic)) < 0;', 'return false;'],
  ['migration ignores the marker', 'a', 'if (localStorage.getItem(NA22_MIGR_KEY)) return 0;', ''],
  ['migration compares without String()', 'a', 'NA22_STALE_CODES.indexOf(String(ic))', 'NA22_STALE_CODES.indexOf(ic)'],
  ['migration not run before the overlay', 'a', '  migrateStaleDeletionsNA22();\n', ''],
  ['migration overwrites a malformed list', 'a', "if (!Array.isArray(list)) { _logErr(", "if (!Array.isArray(list)) { localStorage.setItem('ugreen_deleted','[]'); _logErr("],
  ['migration sets the marker on a malformed list', 'a', "left unchanged'); return 0; }", "left unchanged'); localStorage.setItem(NA22_MIGR_KEY,'1'); return 0; }"],
  ['success clears every removal', 's', 'if (inSnap[k] && !sent[k])', 'if (true)'],
  ['success ignores published codes', 's', 'if (inSnap[k] && !sent[k])', 'if (inSnap[k])'],
  ['success blanket-clears drafts', 's', 'return !inDr[JSON.stringify(d)];', 'return false;'],
  ['success leaves the old indicator call (NA-21)', 's', "updateSaveIndicator('published');", 'updateSaveIndicator();'],
  ['success always resets HAS_UNSAVED_CHANGES', 's', 'if (left) {', 'if (false) {'],
  ['success no longer clears removals (NA-22)', 's', "if (keep.length !== cur.length) localStorage.setItem('ugreen_deleted', JSON.stringify(keep));", ''],
  ['409 adopts the publish', 's', "showToast('products.json changed on GitHub", "_adoptPublished(built, sentHash); showToast('products.json changed on GitHub"],
  ['5xx adopts without read-back', 's', "verifying…');\n      _verifyPublished(built.products.length, sentHash, function(){ _adoptPublished(built, sentHash); });", "verifying…');\n      _adoptPublished(built, sentHash);"],
  ['5xx never adopts after a match', 's', "if(onConfirmed && sentHash){ try{ onConfirmed(); }catch(e){} }", ''],
  ['read-back adopts on count only', 's', 'if(onConfirmed && sentHash)', 'if(onConfirmed)'],
  ['read-back drops the hash comparison (NA-29)', 's', "(!sentHash || _ugHash(JSON.stringify(j))===sentHash)", '(true)'],
  ['snapshot restore never filters (NA-26)', 'a', 'JSON.stringify(na22FilterSnapshotDeletions(entry.deletedIds, entry.timestamp))', 'JSON.stringify(entry.deletedIds)'],
  ['snapshot restore filters even newer snapshots', 'a', 'if (Number(snapTs) >= ran) return ids;', ''],
  ['snapshot restore filters before the clean-up ran', 'a', 'if (!Array.isArray(ids) || !ran) return ids;', 'if (!Array.isArray(ids)) return ids;'],
  ['snapshot restore compares without String()', 'a', 'return ids.filter(function(ic){ return NA22_STALE_CODES.indexOf(String(ic)) < 0; });', 'return ids.filter(function(ic){ return NA22_STALE_CODES.indexOf(ic) < 0; });'],
  ['snapshot restore treats a missing timestamp as new', 'a', 'if (Number(snapTs) >= ran) return ids;', 'if (!(Number(snapTs) < ran)) return ids;'],
];

(async () => {
  const fails = await suite(ADMIN, SAVE, true);
  let killed = 0;
  for (const [name, which, from, to] of MUTANTS) {
    const a = which === 'a' ? ADMIN : SAVE;
    if (!a.includes(from)) { console.log('FAIL - mutant anchor missing: ' + name); killed = -999; continue; }
    const m = a.replace(from, to);
    let f;
    try { f = await suite(which === 'a' ? m : ADMIN, which === 's' ? m : SAVE, false); } catch (e) { f = 1; }
    console.log((f > 0 ? 'PASS' : 'FAIL') + ' - mutant killed: ' + name + (f > 0 ? ' (' + f + ' failing checks)' : ''));
    if (f > 0) killed++;
  }
  const allKilled = killed === MUTANTS.length;
  const total = fails + (allKilled ? 0 : 1);
  console.log('\n' + (total === 0 ? 'ALL PASSED' : 'FAILED') + ' (suite failures ' + fails + ', mutants killed ' + Math.max(killed, 0) + '/' + MUTANTS.length + ')');
  process.exit(total === 0 ? 0 : 1);
})();
