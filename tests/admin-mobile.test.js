/* M1 regression tests: compact admin dashboard on phones (2026-10-25).
   Run: node tests/admin-mobile.test.js
   Static checks on css/styles.css, js/admin.js and index.html plus a sandbox run of the Quick Actions / UNO shortcut code:
   - no bare `header` element selector is left (the storefront rules target `body > header`; they used to leak into the admin's
     own <header> elements and put the sticky page header above the phone menu drawer);
   - the desktop admin keeps the two properties it used to get from that leak (sticky z-index 100 + shadow; page header 56px),
     and from 760px down the page header is no longer stacked above the drawer;
   - the phone block (<= 640px) is scoped to the admin shell only and sets the approved layout (4 tiles / 4 quick actions per row,
     16px icons, short "Publish" label, viewport-height drawer);
   - Quick Actions keep the 6 existing actions with the same handlers and add the UNO Analytics shortcut to the existing tab;
   - Save & Publish keeps saveCurrentVersion() with an accessible name; KPI values come from the same expressions.
   Ends with mutation checks: each broken rule must make the suite fail. */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const CSS = fs.readFileSync(path.join(ROOT, 'css', 'styles.css'), 'utf8');
const ADMIN = fs.readFileSync(path.join(ROOT, 'js', 'admin.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const MARK = '/* ===================================================================\n   M1 (2026-10-25) - compact admin dashboard on phones.';

function fnSrc(src, name) {
  const lines = src.split('\n');
  const i = lines.findIndex(l => l.startsWith('function ' + name + '('));
  if (i < 0) throw new Error('function not found: ' + name);
  if (lines[i].replace(/\r$/, '').endsWith('}')) return lines[i];
  const j = lines.findIndex((l, k) => k > i && l.replace(/\r$/, '') === '}');
  return lines.slice(i, j + 1).join('\n');
}
function blockSrc(src, first, last) {
  const lines = src.split('\n');
  const i = lines.findIndex(l => l.startsWith(first));
  const j = lines.findIndex((l, k) => k > i && l.replace(/\r$/, '') === last);
  if (i < 0 || j < 0) throw new Error('block not found: ' + first);
  return lines.slice(i, j + 1).join('\n');
}
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '');
/* the body of the first `@media (max-width:<px>px){ ... }` at or after `from` (brace matched) */
function mediaBody(css, px, from) {
  const head = '@media (max-width:' + px + 'px){';
  const i = css.indexOf(head, from || 0);
  if (i < 0) return null;
  let d = 0;
  for (let k = i + head.length - 1; k < css.length; k++) {
    if (css[k] === '{') d++;
    else if (css[k] === '}') { d--; if (d === 0) return css.slice(i + head.length, k); }
  }
  return null;
}
/* the selectors of a flat rule list ("sel{decl}sel{decl}") */
const selectorsOf = body => stripComments(body).split('}').map(x => x.split('{')[0].trim()).filter(Boolean)
  .reduce((a, s) => a.concat(s.split(',').map(t => t.trim())), []);
/* every style rule of a stylesheet (nested @media walked): [{ sels, body }] (fix round 1: whole-file / whole-region scans) */
function rulesOf(css) {
  const c = stripComments(css), out = [], stack = [];
  let buf = '';
  for (let i = 0; i < c.length; i++) {
    const ch = c[i];
    if (ch === '{') { const head = buf.trim(); buf = ''; stack.push(head.startsWith('@') ? null : { head, start: i + 1 }); }
    else if (ch === '}') { const top = stack.pop(); if (top) out.push({ sels: top.head.split(',').map(t => t.trim()).filter(Boolean), body: c.slice(top.start, i) }); buf = ''; }
    else buf += ch;
  }
  return out;
}
const HEADER_TOKEN = /(^|[\s>+~(])header(?![\w-])/;   // the element `header` anywhere in a selector (not .panel-header etc.)

function sandbox(src) {
  const sb = { _tabs: [], _nav: [], document: { querySelector: q => (q === '.adm-rail-item[data-tab="tab-uno"]' ? { q } : null) } };
  sb.admTab = (el, id) => sb._tabs.push([el && el.q, id]);
  // fix round 1 (QA E4): any navigation from the shortcut is recorded
  sb.location = { assign: u => sb._nav.push('assign ' + u), replace: u => sb._nav.push('replace ' + u) };
  sb.window = { open: u => sb._nav.push('open ' + u) };
  sb.open = u => sb._nav.push('open ' + u);
  sb.admOpenUnoAnalytics = () => sb._nav.push('admOpenUnoAnalytics');
  sb.UNO_DASHBOARD_URL = 'https://uno-dashboard.example/';
  vm.createContext(sb);
  vm.runInContext([blockSrc(src, 'var _ADM_ICONS = {', '};'), fnSrc(src, 'admOpenUnoTab'), fnSrc(src, '_admQuickActionsHtml')].join('\n'), sb);
  return sb;
}

function suite(css, admin, index, log) {
  const fails = []; let n = 0;
  const chk = (name, ok, info) => { n++; if (ok) { if (log) console.log('PASS - ' + name); } else { fails.push(name); if (log) console.log('FAIL - ' + name + (info !== undefined ? ' :: ' + JSON.stringify(info) : '')); } };
  const run = (name, fn) => { try { fn(); } catch (e) { chk(name + ' (threw: ' + e.message + ')', false); } };

  run('header', () => {
    const c = stripComments(css);
    // fix round 1 (QA A2 / A3): the element `header` anywhere in any selector of the file, not only at the start
    const withHeader = rulesOf(css).reduce((a, r) => a.concat(r.sels.filter(s => HEADER_TOKEN.test(s))), []);
    const bad = withHeader.filter(s => s !== 'body > header');
    chk('css: no `header` element selector other than `body > header` anywhere (it leaked into the admin <header> elements)', !bad.length, bad);
    chk('css: the 5 storefront header rules target `body > header`', withHeader.length === 5 && (c.match(/body > header\{/g) || []).length === 5, withHeader.length);
  });
  run('desktop', () => {
    const i = css.indexOf(MARK);
    const blk = i >= 0 ? css.slice(i) : '';
    chk('css: M1 block present and last in the file', i > 0 && !/\n\/\* =+\n/.test(blk.slice(MARK.length)));
    chk('css: desktop keeps the admin app bar sticky above the content with the shadow it had (was inherited from `header`)',
      blk.includes('.adm-shell .adm-appbar{position:sticky;top:0;z-index:100;box-shadow:var(--shadow-sm)}'));
    chk('css: desktop keeps the page header at 56px with the same stacking + shadow',
      blk.includes('.adm-shell .adm-main-top{position:sticky;top:0;z-index:100;box-shadow:var(--shadow-sm);height:56px}'));
    const m760 = mediaBody(blk, 760);
    chk('css: <= 760px (drawer) the page header is no longer stacked above the menu drawer',
      !!m760 && /\.adm-shell \.adm-main-top\{position:static;z-index:auto\}/.test(m760));
    chk('css: the short "Publish" label is hidden outside phones', /\n\.adm-shell \.adm-save-short\{display:none\}/.test(blk));
    // fix round 1 (QA B2 / D2 / D3 + Release Guardian note): the WHOLE M1 region, not only its first 640px block
    const reg = rulesOf(blk);
    const unscoped = reg.reduce((a, r) => a.concat(r.sels), []).filter(s => !(s.startsWith('.adm-shell ') || s === '.adm-modal.adm-dash'));
    chk('css: every rule after the M1 marker is scoped to the admin shell (also later @media blocks)', reg.length > 30 && !unscoped.length, unscoped);
    const topStack = reg.filter(r => r.sels.some(s => /\.adm-main-top(?![\w-])/.test(s)) && /(^|;)\s*(position|z-index)\s*:/.test(r.body)).map(r => r.body.trim());
    chk('css: the page header stacking is set only by the two reviewed rules (desktop sticky, <= 760px static)',
      JSON.stringify(topStack) === JSON.stringify(['position:sticky;top:0;z-index:100;box-shadow:var(--shadow-sm);height:56px', 'position:static;z-index:auto']), topStack);
    const railZ = reg.filter(r => r.sels.some(s => /\.adm-rail(?![\w-])/.test(s)) && /(^|;)\s*z-index\s*:/.test(r.body));
    chk('css: the M1 rules never change the menu drawer stacking (no z-index on .adm-rail)', !railZ.length, railZ.map(r => r.sels.join(',')));
    const wide = reg.filter(r => /position\s*:\s*fixed/.test(r.body) || (r.body.match(/(?:^|;)\s*(?:min-|max-)?width\s*:\s*(\d+)px/g) || []).some(x => Number(x.match(/(\d+)px/)[1]) > 320));
    chk('css: no position:fixed and no fixed width over 320px anywhere in the M1 rules', !wide.length, wide.map(r => r.sels.join(',')));
  });
  run('phone', () => {
    const i = css.indexOf(MARK);
    const body = i >= 0 ? mediaBody(css, 640, i) : null;
    chk('css: phone block exists inside @media (max-width:640px)', !!body);
    if (!body) return;
    const sels = selectorsOf(body);
    const bad = sels.filter(s => !(s.startsWith('.adm-shell ') || s === '.adm-modal.adm-dash'));
    chk('css: every phone selector is scoped to the admin shell (desktop / storefront untouched)', sels.length > 30 && !bad.length, bad);
    const has = (sel, decl) => new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{[^}]*' + decl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(body);
    chk('css: 4 dashboard tiles per row', has('.adm-shell #tab-overview .adm-kpi-row.k5', 'grid-template-columns:repeat(4,minmax(0,1fr))'));
    chk('css: tiles ~60px min height, compact padding', has('.adm-shell #tab-overview .adm-kpi', 'min-height:60px') && has('.adm-shell #tab-overview .adm-kpi', 'padding:8px 6px'));
    chk('css: tile icon 16px box / 15px glyph', has('.adm-shell #tab-overview .adm-kpi-ico', 'width:16px;height:16px') && has('.adm-shell #tab-overview .adm-kpi-ico svg', 'width:15px;height:15px'));
    chk('css: tile label on up to 2 lines across the tile (no ellipsis on labels)', has('.adm-shell #tab-overview .adm-kpi-label', 'grid-column:1 / -1') && !/adm-kpi-label\{[^}]*ellipsis/.test(body));
    chk('css: Last Sync is a full-width strip under the tiles', has('.adm-shell #tab-overview .adm-kpi.adm-kpi-wide', 'grid-column:1 / -1'));
    chk('css: Quick Actions 4 per row', has('.adm-shell #tab-overview .adm-qa-grid', 'grid-template-columns:repeat(4,minmax(0,1fr))'));
    // fix round 1 (QA-M1-1): the site's touch rule (pointer:coarse) sets 44px for buttons; the phone rule must not go below it
    const saveH = (body.match(/\.adm-shell \.adm-save-global\{[^}]*min-height:(\d+)px/) || [])[1];
    chk('css: Save & Publish shows the short label with a >= 44px tap height (site touch minimum)', has('.adm-shell .adm-save-full', 'display:none') && has('.adm-shell .adm-save-short', 'display:inline') && Number(saveH) >= 44, saveH);
    chk('css: one-row page header (no wrap) and subtitle hidden', has('.adm-shell .adm-main-top', 'flex-wrap:nowrap') && has('.adm-shell .adm-main-sub', 'display:none'));
    chk('css: drawer / modal sized to the visible viewport (100dvh with 100vh fallback first)', /\.adm-modal\.adm-dash\{height:100vh;height:100dvh;max-height:100vh;max-height:100dvh\}/.test(body));
    chk('css: drawer nav scrolls without chaining to the page', has('.adm-shell .adm-rail-nav', 'overscroll-behavior:contain'));
    chk('css: no position:fixed and no fixed width over 320px in the phone block',
      !/position:fixed/.test(body) && !(body.match(/(?:^|[;{])\s*(?:min-)?width:\s*(\d+)px/g) || []).some(x => Number(x.match(/(\d+)px/)[1]) > 320));
    chk('css: rail items keep their touch height (no height / min-height override on .adm-rail-item)', !/\.adm-rail-item\{/.test(body));
  });
  run('actions', () => {
    const sb = sandbox(admin);
    const html = vm.runInContext('_admQuickActionsHtml()', sb);
    const btns = [...html.matchAll(/<button class="adm-qa[^"]*"(?: id="([^"]+)")? onclick="([^"]*)">[\s\S]*?<span class="adm-qa-label">([^<]+)<\/span><\/button>/g)].map(m => [m[3], m[2], m[1] || '']);
    const expect = [['Add SKU', "openPanel(\\x27add\\x27)"], ['Import Excel', "closeAdminModal();document.getElementById(\\x27excel-upload-input\\x27).click()"],
      ['Export Excel', "closeAdminModal();downloadExcel(\\x27recommended\\x27)"], ['Backup JSON', 'admBackup()'], ['Publish to GitHub', 'closeAdminModal();saveCurrentVersion()'],
      ['Open Pricelist', 'closeAdminModal()'], ['UNO Analytics', 'admOpenUnoTab()']].map(([l, h]) => [l, h.replace(/\\x27/g, "'")]);
    chk('admin.js: Quick Actions = the 6 existing actions (same handlers, same order) + the UNO Analytics shortcut', btns.length === 7 && expect.every((e, i) => btns[i] && btns[i][0] === e[0] && btns[i][1] === e[1]), btns);
    chk('admin.js: the UNO shortcut has id adm-qa-uno and the UNO icon', btns[6] && btns[6][2] === 'adm-qa-uno' && html.includes('<span class="adm-qa-ico">' + vm.runInContext('_ADM_ICONS.uno', sb) + '</span><span class="adm-qa-label">UNO Analytics</span>'));
    vm.runInContext('admOpenUnoTab()', sb);
    chk('admin.js: the shortcut opens the existing UNO Analytics tab through the sidebar item (admTab)', JSON.stringify(sb._tabs) === JSON.stringify([['.adm-rail-item[data-tab="tab-uno"]', 'tab-uno']]), sb._tabs);
    chk('admin.js: the shortcut makes no network call / navigation', !/fetch\(|location\.|window\.open|sendBeacon/.test(fnSrc(admin, 'admOpenUnoTab')));
    // fix round 1 (QA E4): not even indirectly through the live-dashboard launcher
    chk('admin.js: the shortcut never navigates, also not via admOpenUnoAnalytics() / UNO_DASHBOARD_URL', !sb._nav.length && !/admOpenUnoAnalytics|UNO_DASHBOARD_URL|(^|[^\w$.])open\(/.test(fnSrc(admin, 'admOpenUnoTab').replace('function admOpenUnoTab(', '')), sb._nav);
  });
  run('save', () => {
    chk('admin.js: Save & Publish keeps saveCurrentVersion() with title + accessible name',
      admin.includes('<button class="adm-save-global" onclick="saveCurrentVersion()" title="Save &amp; publish all changes" aria-label="Save &amp; Publish">'));
    chk('admin.js: full label kept for desktop, short "Publish" label for phones',
      admin.includes('<span class="adm-save-full">Save &amp; Publish</span><span class="adm-save-short" aria-hidden="true">Publish</span></button>'));
  });
  run('kpi', () => {
    for (const l of ["kpi(_ADM_ICONS.sku, ALL_PRODUCTS.length, 'Total SKUs', 'Active catalog')+", "kpi(_ADM_ICONS.cats, _admSectionCounts().length, 'Categories', 'Sections in use')+",
      "kpi(STAR, newCount, 'New Products', 'Flagged new')+", "kpi(EDIT, pending, 'Pending Changes', 'Unpublished edits')+"])
      chk('admin.js: KPI unchanged - ' + l.split("'")[1], admin.includes(l));
    chk('admin.js: Last Sync tile unchanged (adm-kpi-wide, same value / subtitle)', admin.includes('\'<div class="adm-kpi adm-kpi-wide"><div class="adm-kpi-ico">\'+SYNC+\'</div><div class="adm-kpi-val adm-kpi-val-sm">\'+ls.v+\'</div><div class="adm-kpi-label">Last Sync</div>\'+(ls.s?\'<div class="adm-kpi-sub">\'+ls.s+\'</div>\':\'\')+\'</div>\'+'));
  });
  run('tags', () => {
    chk('index.html: cache tags css/styles.css?v=p41 and js/admin.js?v=p41', index.includes('<link rel="stylesheet" href="css/styles.css?v=p41">') && index.includes('<script src="js/admin.js?v=p41"></script>'));
  });
  return { n, fails };
}

const base = suite(CSS, ADMIN, INDEX, true);

const CSS_MUT = [
  ['bare header selector back', 'body > header{background:var(--surface)', 'header{background:var(--surface)'],
  ['phone header selector back', '  body > header{\n    flex-wrap:wrap;', '  header{\n    flex-wrap:wrap;'],
  ['desktop app bar shadow dropped', '.adm-shell .adm-appbar{position:sticky;top:0;z-index:100;box-shadow:var(--shadow-sm)}', '.adm-shell .adm-appbar{position:sticky;top:0;z-index:100}'],
  ['desktop page header height dropped', 'box-shadow:var(--shadow-sm);height:56px}', 'box-shadow:var(--shadow-sm)}'],
  ['page header stacked above the drawer again', '  .adm-shell .adm-main-top{position:static;z-index:auto}\n', ''],
  ['unscoped phone rule', '  .adm-shell .adm-main-sub{display:none}', '  .adm-main-sub{display:none}'],
  ['tiles back to 2 per row', "  .adm-shell #tab-overview .adm-kpi-row.k5{grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}", "  .adm-shell #tab-overview .adm-kpi-row.k5{grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}"],
  ['large tile icon', '.adm-kpi-ico{width:16px;height:16px;margin:0;', '.adm-kpi-ico{width:34px;height:34px;margin:0;'],
  ['label ellipsis', '.adm-kpi-label{grid-column:1 / -1;font-size:.6rem;', '.adm-kpi-label{grid-column:1 / -1;text-overflow:ellipsis;font-size:.6rem;'],
  ['quick actions 2 per row', '.adm-qa-grid{grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}', '.adm-qa-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}'],
  ['full label on phones', '  .adm-shell .adm-save-full{display:none}\n', ''],
  ['tiny publish tap target', '.adm-save-global{min-height:44px;', '.adm-save-global{min-height:28px;'],
  // fix round 1 (QA-M1-1, A2, B2, D2, D3, Release Guardian G32 note)
  ['publish below the touch minimum (40px)', '.adm-save-global{min-height:44px;', '.adm-save-global{min-height:40px;'],
  ['descendant header selector', '  .adm-shell .adm-rail-user{margin-bottom:.35rem}\n}', '  .adm-shell .adm-rail-user{margin-bottom:.35rem}\n}\n.adm-shell header{position:sticky;z-index:100}'],
  ['header inside a selector list', 'body > header{background:var(--surface)', '.x,header{background:var(--surface)'],
  ['second unscoped phone block', '  .adm-shell .adm-rail-user{margin-bottom:.35rem}\n}', '  .adm-shell .adm-rail-user{margin-bottom:.35rem}\n}\n@media (max-width:640px){.adm-kpi{padding:0}}'],
  ['page header sticky again in the phone block', '  .adm-shell .adm-main-scroll{padding:.6rem;gap:.6rem}', '  .adm-shell .adm-main-scroll{padding:.6rem;gap:.6rem}\n  .adm-shell .adm-main-top{position:sticky;z-index:200}'],
  ['drawer pushed below', '  .adm-shell .adm-rail-nav{overscroll-behavior:contain;', '  .adm-shell .adm-rail{z-index:1}\n  .adm-shell .adm-rail-nav{overscroll-behavior:contain;'],
  ['fixed element in the desktop part', '.adm-shell .adm-save-short{display:none}', '.adm-shell .adm-save-short{display:none;position:fixed}'],
  ['100vh only', '.adm-modal.adm-dash{height:100vh;height:100dvh;max-height:100vh;max-height:100dvh}', '.adm-modal.adm-dash{height:100vh;max-height:100vh}'],
  ['scroll chaining', '.adm-rail-nav{overscroll-behavior:contain;', '.adm-rail-nav{'],
  ['fixed wide element', '  .adm-shell .adm-rail-user{margin-bottom:.35rem}', '  .adm-shell .adm-rail-user{margin-bottom:.35rem;width:360px}'],
  ['rail item shrunk', '  .adm-shell .adm-rail-user{margin-bottom:.35rem}', '  .adm-shell .adm-rail-user{margin-bottom:.35rem}\n  .adm-shell .adm-rail-item{min-height:30px}'],
];
const ADM_MUT = [
  ['UNO shortcut removed', '      \'<button class="adm-qa" id="adm-qa-uno" onclick="admOpenUnoTab()"><span class="adm-qa-ico">\'+_ADM_ICONS.uno+\'</span><span class="adm-qa-label">UNO Analytics</span></button>\'+\n', ''],
  ['shortcut opens another tab', "if(b)admTab(b,'tab-uno'); }", "if(b)admTab(b,'tab-reports'); }"],
  ['shortcut navigates away', "function admOpenUnoTab(){ var b=", "function admOpenUnoTab(){ location.assign(UNO_DASHBOARD_URL); var b="],
  ['shortcut calls the live launcher (indirect navigation)', "function admOpenUnoTab(){ var b=", "function admOpenUnoTab(){ admOpenUnoAnalytics(); var b="],
  ['existing action dropped', '      \'<button class="adm-qa" onclick="admBackup()">', '      \'<button class="adm-qa" onclick="void 0">'],
  ['Save handler changed', '<button class="adm-save-global" onclick="saveCurrentVersion()"', '<button class="adm-save-global" onclick="saveToGitHub()"'],
  ['accessible name dropped', ' aria-label="Save &amp; Publish">', '>'],
  ['KPI changed', "kpi(EDIT, pending, 'Pending Changes', 'Unpublished edits')+", "kpi(EDIT, pending+1, 'Pending Changes', 'Unpublished edits')+"],
];
let killed = 0, survived = 0;
for (const [name, from, to] of CSS_MUT) {
  if (!CSS.includes(from)) { survived++; console.log('FAIL - mutant anchor missing: ' + name); continue; }
  const r = suite(CSS.replace(from, to), ADMIN, INDEX, false);
  if (r.fails.length) { killed++; console.log('PASS - mutant killed: ' + name + ' (' + r.fails.length + ' checks)'); } else { survived++; console.log('FAIL - mutant survived: ' + name); }
}
for (const [name, from, to] of ADM_MUT) {
  if (!ADMIN.includes(from)) { survived++; console.log('FAIL - mutant anchor missing: ' + name); continue; }
  const r = suite(CSS, ADMIN.replace(from, to), INDEX, false);
  if (r.fails.length) { killed++; console.log('PASS - mutant killed: ' + name + ' (' + r.fails.length + ' checks)'); } else { survived++; console.log('FAIL - mutant survived: ' + name); }
}
{
  const name = 'old cache tag';
  const r = suite(CSS, ADMIN, INDEX.replace('css/styles.css?v=p41', 'css/styles.css?v=p40'), false);
  if (r.fails.length) { killed++; console.log('PASS - mutant killed: ' + name); } else { survived++; console.log('FAIL - mutant survived: ' + name); }
}
const total = CSS_MUT.length + ADM_MUT.length + 1;
console.log(`Admin mobile M1 (checks ${base.n - base.fails.length}/${base.n}, mutants ${killed}/${total}): ${base.n - base.fails.length + killed} passed, ${base.fails.length + survived} failed`);
process.exit(base.fails.length + survived ? 1 : 0);
