#!/usr/bin/env node
/*
 * Local pre-publish validator for the UGREEN Pricelist CMS.
 * Run BEFORE publishing to catch truncated / corrupted files.
 *   node tools/verify.mjs
 * Exit 0 = all good, 1 = problems. Dev tool only; never loaded by the site.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

let problems = 0;
const fail = (m) => { console.error('  x ' + m); problems++; };
const ok   = (m) => console.log('  . ' + m);
const NUL  = String.fromCharCode(0);

function balanced(d, open, close, label, file) {
  const o = (d.match(open) || []).length, c = (d.match(close) || []).length;
  if (o !== c) fail(`${file}: ${label} unbalanced (${o} vs ${c})`);
}

console.log('\n== JS modules ==');
for (const f of readdirSync('js').filter(x => x.endsWith('.js'))) {
  const p = 'js/' + f, d = readFileSync(p, 'utf8');
  if (d.includes(NUL)) fail(`${p}: contains NUL byte(s) (mount corruption)`);
  try { execSync(`node --check "${p}"`, { stdio: 'pipe' }); ok(`${p} parses`); }
  catch (e) { fail(`${p} SYNTAX ERROR: ${String(e.stderr || e).split('\n')[0]}`); }
  balanced(d, /\{/g, /\}/g, 'braces {}', p);
  if (d.trim().length && !/[)}\];]\s*$/.test(d.trimEnd()) && !/\*\/\s*$/.test(d.trimEnd()))
    fail(`${p}: may be truncated (does not end on a complete statement)`);
  if (d.includes('</script') && !d.includes('<\\/script')) fail(`${p}: unescaped </script> in a JS string`);
}

console.log('\n== JSON / config ==');
for (const f of ['data/products.json', 'data/categories.json', 'data/settings.json']) {
  if (!existsSync(f)) { console.log('  - ' + f + ' (absent, skipped)'); continue; }
  try { JSON.parse(readFileSync(f, 'utf8')); ok(`${f} parses`); }
  catch (e) { fail(`${f} INVALID JSON: ${e.message}`); }
}
if (existsSync('config.js')) {
  try { execSync('node --check config.js', { stdio: 'pipe' }); ok('config.js parses'); }
  catch { fail('config.js SYNTAX ERROR'); }
}

console.log('\n== Publish wiring (truncated-save regression) ==');
const gh = existsSync('js/github-save.js') ? readFileSync('js/github-save.js', 'utf8') : '';
if (/function\s+saveToGitHub\s*\(/.test(gh) &&
    gh.includes('function saveCurrentVersion(){ saveToGitHub(); }') &&
    gh.includes('function saveAsNewVersion(){ saveToGitHub(); }')) {
  ok('saveCurrentVersion & saveAsNewVersion -> saveToGitHub override present');
} else {
  fail('github-save.js missing publish override -> Save would silently download instead of publish');
}

console.log('\n== index.html ==');
if (existsSync('index.html')) {
  const h = readFileSync('index.html', 'utf8');
  if (h.includes(NUL)) fail('index.html contains NUL byte(s)');
  if (h.includes('</body>') && h.includes('</html>')) ok('closes </body></html>');
  else fail('index.html truncated (missing </body> or </html>)');
  for (const s of ['js/admin.js', 'js/github-save.js', 'css/styles.css']) {
    if (h.includes(s)) ok(`references ${s}`); else fail(`missing reference to ${s}`);
  }
}

console.log('\n' + (problems ? `FAILED - ${problems} problem(s). Do NOT publish.` : 'ALL CHECKS PASSED - safe to publish.'));
process.exit(problems ? 1 : 0);
