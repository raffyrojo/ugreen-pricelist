/* DB2a regression tests: UNO Analytics launcher in the Admin Dashboard (2026-10-24).
   Run: node tests/uno-admin-link.test.js
   Loads the real DB2a functions from js/admin.js into a sandbox (stub DOM, storage, location, history, confirm) and checks:
   - the sidebar lists "UNO Analytics" directly below Reports (before the System group);
   - the tab is a launcher only (no frame, no URL, no data), with a pending-changes note when unpublished edits exist;
   - Open goes to the fixed dashboard URL IN THIS TAB (location.assign; never window.open), asks first when edits are pending;
   - #uno-return drops the fragment and reopens the admin on the UNO Analytics tab only for an active admin session;
   - app.js calls the return hook after the catalogue has loaded; index.html carries the new cache tags.
   Ends with mutation checks: each broken rule must make the suite fail. */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const ADMIN = fs.readFileSync(path.join(ROOT, 'js', 'admin.js'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const URL_ = 'https://uno-dashboard.raffyortega-rojo.workers.dev/';

function fnSrc(src, name) {
  const lines = src.split('\n');
  const i = lines.findIndex(l => l.startsWith('function ' + name + '('));
  if (i < 0) throw new Error('function not found: ' + name);
  if (lines[i].replace(/\r$/, '').endsWith('}')) return lines[i];
  const j = lines.findIndex((l, k) => k > i && l.replace(/\r$/, '') === '}');
  return lines.slice(i, j + 1).join('\n');
}
function lineSrc(src, prefix) {
  const l = src.split('\n').find(x => x.startsWith(prefix));
  if (!l) throw new Error('line not found: ' + prefix);
  return l;
}
function blockSrc(src, first, last) {
  const lines = src.split('\n');
  const i = lines.findIndex(l => l.startsWith(first));
  const j = lines.findIndex((l, k) => k > i && l.replace(/\r$/, '') === last);
  if (i < 0 || j < 0) throw new Error('block not found: ' + first);
  return lines.slice(i, j + 1).join('\n');
}
function dbBlock(src) {
  const a = src.indexOf('/* ================= DB2a - UNO Analytics'), b = src.indexOf('/* ================= PHASE 9 - Settings sections');
  return a > 0 && b > a ? src.slice(a, b) : '';
}

function sandbox(src, o) {
  o = o || {};
  const store = new Map();
  if (o.deleted) store.set('ugreen_deleted', JSON.stringify(o.deleted));
  const sb = {
    JSON, Array, String, Number, Math, Object,
    UGREEN_LOGO_DARK: 'logo.png', APP_VERSION: 'test',
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    loadNewSkus: () => (o.newSkus || []),
    confirm: msg => { sb._confirms.push(msg); return o.confirm === undefined ? true : o.confirm; },
    location: { hash: o.hash === undefined ? '' : o.hash, pathname: '/ugreen-pricelist/', search: o.search || '', assign: u => sb._assigns.push(u) },
    history: { replaceState: (s, t, u) => sb._replaced.push(u) },
    window: { open: u => sb._opens.push(u) },
    isAdmin: () => !!o.admin,
    openAdminModal: () => { sb._opened++; },
    admTab: (el, id) => sb._tabs.push(id),
    document: { querySelector: q => (q === '.adm-rail-item[data-tab="tab-uno"]' ? { q } : null) },
    _confirms: [], _assigns: [], _replaced: [], _opens: [], _opened: 0, _tabs: [],
  };
  vm.createContext(sb);
  if (o.unsaved !== undefined) vm.runInContext('var HAS_UNSAVED_CHANGES = ' + JSON.stringify(o.unsaved) + ';', sb);
  const code = [blockSrc(src, 'var _ADM_ICONS = {', '};'), fnSrc(src, '_admRailItem'), fnSrc(src, '_admRailHtml'),
    lineSrc(src, 'var UNO_DASHBOARD_URL='), lineSrc(src, 'var UNO_RETURN_HASH='), fnSrc(src, '_admUnoPending'), fnSrc(src, '_admUnoUnsaved'), fnSrc(src, '_admUnoWarn'), fnSrc(src, '_admTabUnoHtml'),
    fnSrc(src, 'admOpenUnoAnalytics'), fnSrc(src, 'admUnoReturn')].join('\n');
  vm.runInContext(code, sb);
  return sb;
}

function suite(src, app, index, log) {
  const fails = [];
  let n = 0;
  const chk = (name, ok, info) => { n++; if (ok) { if (log) console.log('PASS - ' + name); } else { fails.push(name); if (log) console.log('FAIL - ' + name + (info !== undefined ? ' :: ' + JSON.stringify(info) : '')); } };
  const run = (name, fn) => { try { fn(); } catch (e) { chk(name + ' (threw: ' + e.message + ')', false); } };

  run('rail', () => {
    const sb = sandbox(src);
    const html = vm.runInContext('_admRailHtml()', sb);
    const tabs = [...html.matchAll(/data-tab="([^"]+)"/g)].map(m => m[1]);
    const r = tabs.indexOf('tab-reports');
    chk('sidebar: UNO Analytics (tab-uno) directly below Reports', r >= 0 && tabs[r + 1] === 'tab-uno', tabs);
    chk('sidebar: tab-uno listed once, before the System group', tabs.filter(t => t === 'tab-uno').length === 1 && html.indexOf('data-tab="tab-uno"') < html.indexOf('>System<'));
    chk('sidebar: the item is labelled "UNO Analytics" with its own icon', /data-tab="tab-uno"[^>]*title="UNO Analytics"/.test(html) && /<span class="adm-rail-txt">UNO Analytics<\/span>/.test(html)
      && vm.runInContext('typeof _ADM_ICONS.uno', sb) === 'string' && vm.runInContext('_ADM_ICONS.uno', sb).indexOf('<svg') === 0);
  });
  run('tab', () => {
    const t0 = vm.runInContext('_admTabUnoHtml()', sandbox(src));
    chk('tab: id tab-uno with the Open button wired to admOpenUnoAnalytics()', /<div class="adm-tab" id="tab-uno">/.test(t0) && /onclick="admOpenUnoAnalytics\(\)">Open UNO Analytics<\/button>/.test(t0), t0.slice(0, 120));
    chk('tab: launcher only - no frame, no URL, no script', !/<iframe|<script|https?:|workers\.dev/i.test(t0));
    chk('tab: says owner-only, same tab and email code', /Owner-only/.test(t0) && /opens in this tab/.test(t0) && /one-time code/.test(t0));
    chk('tab: no pending note without unpublished changes', !/adm-uno-pending/.test(t0));
    const t2 = vm.runInContext('_admTabUnoHtml()', sandbox(src, { newSkus: [{}], deleted: ['A'] }));
    chk('tab: drafts only -> counts new / edited and removed drafts (2), says they stay saved, no loss sentence',
      /id="adm-uno-pending">You have 2 unpublished product changes \(added, edited or removed products\)\. They stay saved in this browser\.<\/p>/.test(t2) && !/lost/.test(t2), t2);
    // fix round 1 (QA-DB2a-1): in-memory changes (HAS_UNSAVED_CHANGES) are counted and described as lost on leaving
    const t3 = vm.runInContext('_admTabUnoHtml()', sandbox(src, { unsaved: true }));
    chk('tab: in-memory changes only -> note says unpublished changes + lost when you leave, never "stay saved"',
      /id="adm-uno-pending">You have unpublished changes\. Other unsaved changes \(Excel uploads, popup ads, settings\), if any, are lost when you leave this page - publish first to keep them\.<\/p>/.test(t3) && !/stay saved/.test(t3), t3);
    const t4 = vm.runInContext('_admTabUnoHtml()', sandbox(src, { unsaved: true, deleted: ['A'] }));
    chk('tab: drafts + in-memory -> both sentences', /You have 1 unpublished product change \(added, edited or removed products\)\. They stay saved in this browser\. Other unsaved changes .* are lost when you leave this page/.test(t4), t4);
    chk('tab: HAS_UNSAVED_CHANGES false / not a strict true -> no note', !/adm-uno-pending/.test(vm.runInContext('_admTabUnoHtml()', sandbox(src, { unsaved: false })))
      && !/adm-uno-pending/.test(vm.runInContext('_admTabUnoHtml()', sandbox(src, { unsaved: 'yes' }))));
  });
  run('open', () => {
    let sb = sandbox(src);
    vm.runInContext('admOpenUnoAnalytics()', sb);
    chk('open: no pending edits -> same-tab location.assign(exact URL), no confirm, never window.open', JSON.stringify(sb._assigns) === JSON.stringify([URL_]) && !sb._confirms.length && !sb._opens.length, sb._assigns);
    sb = sandbox(src, { newSkus: [{}], confirm: false });
    vm.runInContext('admOpenUnoAnalytics()', sb);
    chk('open: pending edits + Cancel -> stays (no navigation)', sb._confirms.length === 1 && !sb._assigns.length && /1 unpublished product change /.test(sb._confirms[0]) && /\n\nOpen UNO Analytics in this tab\?$/.test(sb._confirms[0]), sb._confirms);
    sb = sandbox(src, { unsaved: true, confirm: false });
    vm.runInContext('admOpenUnoAnalytics()', sb);
    chk('open: in-memory changes only + Cancel -> asked with the loss warning, stays', sb._confirms.length === 1 && /are lost when you leave this page/.test(sb._confirms[0]) && !sb._assigns.length, sb._confirms);
    sb = sandbox(src, { unsaved: true, confirm: true });
    vm.runInContext('admOpenUnoAnalytics()', sb);
    chk('open: in-memory changes only + OK -> same-tab navigation', sb._confirms.length === 1 && JSON.stringify(sb._assigns) === JSON.stringify([URL_]));
    sb = sandbox(src, { deleted: ['A', 'B'], confirm: true });
    vm.runInContext('admOpenUnoAnalytics()', sb);
    chk('open: pending edits + OK -> same-tab navigation', sb._confirms.length === 1 && JSON.stringify(sb._assigns) === JSON.stringify([URL_]));
    chk('open: the URL is exactly the dashboard root (https, no query, no fragment, no data)', vm.runInContext('UNO_DASHBOARD_URL', sb) === URL_);
  });
  run('return', () => {
    let sb = sandbox(src, { hash: '#uno-return', admin: true, search: '?x=1' });
    let r = vm.runInContext('admUnoReturn()', sb);
    chk('return: admin session -> fragment dropped, admin reopened on tab-uno', r === true && JSON.stringify(sb._replaced) === JSON.stringify(['/ugreen-pricelist/?x=1']) && sb._opened === 1 && JSON.stringify(sb._tabs) === JSON.stringify(['tab-uno']), [sb._replaced, sb._opened, sb._tabs]);
    sb = sandbox(src, { hash: '#uno-return', admin: false });
    r = vm.runInContext('admUnoReturn()', sb);
    chk('return: no admin session -> fragment dropped, admin NOT opened', r === false && sb._replaced.length === 1 && sb._opened === 0 && !sb._tabs.length);
    for (const h of ['', '#uno-return-x', '#UNO-RETURN', '#other']) {
      sb = sandbox(src, { hash: h, admin: true });
      r = vm.runInContext('admUnoReturn()', sb);
      chk('return: hash ' + JSON.stringify(h) + ' -> nothing happens', r === false && !sb._replaced.length && sb._opened === 0);
    }
  });
  run('static', () => {
    const blk = dbBlock(src).replace(/\/\*[\s\S]*?\*\//g, '');   // code only (the block comment names sessionStorage)
    chk('admin.js: renderAdminContent mounts the tab right after Reports', src.includes('_admTabReportsHtml()+_admTabUnoHtml()+_admTabActivityHtml()'));
    chk('admin.js: DB2a block opens no window, frame, fetch or storage write and reads no session token', !!blk && !/window\.open|<iframe|fetch\(|sessionStorage|setItem\(|postMessage/.test(blk));
    chk('admin.js: the dashboard host appears exactly once', (src.match(/uno-dashboard\.raffyortega-rojo\.workers\.dev/g) || []).length === 1);
    const then = app.slice(app.indexOf('loadData().then(function(){'), app.indexOf('}).catch(function(err){'));
    chk('app.js: return hook runs after the catalogue loaded (after hideLoading), guarded', then.indexOf('hideLoading();') > 0 && then.indexOf("try { if (typeof admUnoReturn === 'function') admUnoReturn(); } catch(e){}") > then.indexOf('hideLoading();'));
    chk('index.html: cache tags admin.js?v=p40 and app.js?v=p5', index.includes('<script src="js/admin.js?v=p40"></script>') && index.includes('<script src="js/app.js?v=p5"></script>'));
    chk('admin.js: DB2a block calls no bare open( (QA round 1 note)', !!blk && !/(^|[^\w$.])open\(/.test(blk));
  });
  return { n, fails };
}

const base = suite(ADMIN, APP, INDEX, true);

const MUT = [
  ['item above Reports', "      _admRailItem('tab-reports','Reports',_ADM_ICONS.reports,false)+\n      _admRailItem('tab-uno','UNO Analytics',_ADM_ICONS.uno,false)+",
    "      _admRailItem('tab-uno','UNO Analytics',_ADM_ICONS.uno,false)+\n      _admRailItem('tab-reports','Reports',_ADM_ICONS.reports,false)+"],
  ['item removed', "      _admRailItem('tab-uno','UNO Analytics',_ADM_ICONS.uno,false)+\n", ''],
  ['new tab instead of same tab', '  location.assign(UNO_DASHBOARD_URL);', "  window.open(UNO_DASHBOARD_URL,'_blank');"],
  ['Cancel ignored', "  if(w&&!confirm(w+'\\n\\nOpen UNO Analytics in this tab?'))return;", "  if(w&&!confirm(w+'\\n\\nOpen UNO Analytics in this tab?'))void 0;"],
  ['pending edits not asked', '  if(w&&!confirm(', '  if(false&&!confirm('],
  // fix round 1 (QA-DB2a-1)
  ['in-memory changes ignored', "function _admUnoUnsaved(){ return typeof HAS_UNSAVED_CHANGES!=='undefined'&&HAS_UNSAVED_CHANGES===true; }", 'function _admUnoUnsaved(){ return false; }'],
  ['in-memory flag read loosely', 'HAS_UNSAVED_CHANGES===true; }', '!!HAS_UNSAVED_CHANGES; }'],
  ['loss sentence dropped', "    (u?' Other unsaved changes (Excel uploads, popup ads, settings), if any, are lost when you leave this page - publish first to keep them.':'');", "    '';"],
  ['claims everything stays saved', "'You have unpublished changes.'", "'You have unpublished changes. They stay saved in this browser.'"],
  ['bare open( in the launcher', '  location.assign(UNO_DASHBOARD_URL);', "  location.assign(UNO_DASHBOARD_URL); if(0)open(UNO_DASHBOARD_URL,'_blank');"],
  ['URL carries a query', "var UNO_DASHBOARD_URL='https://uno-dashboard.raffyortega-rojo.workers.dev/';", "var UNO_DASHBOARD_URL='https://uno-dashboard.raffyortega-rojo.workers.dev/?from=admin';"],
  ['return without admin check', '  if(!isAdmin())return false;\n', ''],
  ['fragment kept', "  try{ history.replaceState(null,'',location.pathname+location.search); }catch(e){}\n", ''],
  ['hash matched loosely', '  if(h!==UNO_RETURN_HASH)return false;', "  if(h.indexOf('uno')<0)return false;"],
  ['return opens another tab', "  if(b)admTab(b,'tab-uno');", "  if(b)admTab(b,'tab-reports');"],
  ['removed drafts not counted', "  try{ var d=JSON.parse(localStorage.getItem('ugreen_deleted')||'[]'); if(Array.isArray(d)) n+=d.length; }catch(e){}\n", ''],
  ['tab not mounted', '_admTabReportsHtml()+_admTabUnoHtml()+_admTabActivityHtml()+', '_admTabReportsHtml()+_admTabActivityHtml()+'],
  ['tab embeds the dashboard', "'<button class=\"btn-primary\" id=\"adm-uno-open\"", "'<iframe src=\"'+UNO_DASHBOARD_URL+'\"></iframe><button class=\"btn-primary\" id=\"adm-uno-open\""],
];
let killed = 0, survived = 0;
for (const [name, from, to] of MUT) {
  if (!ADMIN.includes(from)) { survived++; console.log('FAIL - mutant anchor missing: ' + name); continue; }
  const r = suite(ADMIN.replace(from, to), APP, INDEX, false);
  if (r.fails.length) { killed++; console.log('PASS - mutant killed: ' + name + ' (' + r.fails.length + ' checks)'); }
  else { survived++; console.log('FAIL - mutant survived: ' + name); }
}
const APP_MUT = [['hook before load', "    try { if (typeof admUnoReturn === 'function') admUnoReturn(); } catch(e){}\n", '']];
for (const [name, from, to] of APP_MUT) {
  if (!APP.includes(from)) { survived++; console.log('FAIL - mutant anchor missing: ' + name); continue; }
  const r = suite(ADMIN, APP.replace(from, to), INDEX, false);
  if (r.fails.length) { killed++; console.log('PASS - mutant killed: ' + name); } else { survived++; console.log('FAIL - mutant survived: ' + name); }
}
const total = MUT.length + APP_MUT.length;
console.log(`UNO Analytics admin link (checks ${base.n - base.fails.length}/${base.n}, mutants ${killed}/${total}): ${base.n - base.fails.length + killed} passed, ${base.fails.length + survived} failed`);
process.exit(base.fails.length + survived ? 1 : 0);
