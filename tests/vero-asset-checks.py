"""Static asset checks for the Phase 2 package. Usage: python3 -I asset_checks.py <repo_root> <zip_dir>"""
import hashlib, os, re, subprocess, sys
R, Z = sys.argv[1], sys.argv[2]
sha = lambda p: hashlib.sha256(open(p, 'rb').read()).hexdigest()
res = []
def chk(n, ok, x=''): res.append(ok); print(('PASS' if ok else 'FAIL') + ' - ' + n + ('' if ok else f'  -> {x}'))
root = open(os.path.join(R, 'index.html'), encoding='utf-8').read()
mirror = open(os.path.join(R, 'ugreen-pricelist-cms/index.html'), encoding='utf-8').read()
chk('A01 root and mirror index.html identical', root == mirror)
for a in ['css/vero.css', 'js/vero-engine.js', 'js/vero.js']: chk(f'A0x {a} referenced with ?v=p2', f'{a}?v=p2' in root)
chk('A05 no ?v=p1 VERO asset references left', not re.search(r'vero[\w.-]*\?v=p1', root))
refs = sorted(set(re.findall(r'(?:src|href)="((?:js|css)/[^"?]+)', root)))
missing = [r for r in refs if not os.path.isfile(os.path.join(R, r))]
chk(f'A06 all {len(refs)} local js/css references exist', not missing, missing)
for f in ['js/vero-engine.js', 'js/vero.js', 'config.js']:
    r = subprocess.run(['node', '--check', os.path.join(R, f)], capture_output=True, text=True); chk(f'A07 node --check {f}', r.returncode == 0, r.stderr[:200])
cfg = open(os.path.join(R, 'config.js'), encoding='utf-8').read()
chk('A10 config.js aiEnabled:false', re.search(r'aiEnabled:\s*false', cfg) is not None)
chk('A11 config.js webEnabled:false', re.search(r'webEnabled:\s*false', cfg) is not None)
chk("A12 config.js aiEndpoint ''", re.search(r"aiEndpoint:\s*''", cfg) is not None)
chk('A13 no NUL bytes in frontend files', all(b'\x00' not in open(os.path.join(R, f), 'rb').read() for f in ['index.html', 'config.js', 'js/vero.js', 'js/vero-engine.js', 'css/vero.css']))
chk('A14 no raw </script> inside VERO JS', all('</script>' not in open(os.path.join(R, f), encoding='utf-8').read() for f in ['js/vero.js', 'js/vero-engine.js']))
same = [f for f in ['index.html', 'config.js', 'js/vero.js', 'js/vero-engine.js', 'css/vero.css', 'ugreen-pricelist-cms/index.html'] if sha(os.path.join(R, f)) == sha(os.path.join(Z, f))]
chk('A15 frontend files byte-identical to the approved 06c package (frontend untouched)', len(same) == 6, same)
chk('A16 data/products.json unchanged vs 949fa7b', subprocess.run(['git', '-C', R, 'diff', '--quiet', '949fa7b', '--', 'data/'], capture_output=True).returncode == 0)
chk('A17 publish Worker backend/worker.js unchanged vs 949fa7b', subprocess.run(['git', '-C', R, 'diff', '--quiet', '949fa7b', '--', 'backend/worker.js'], capture_output=True).returncode == 0)
chk('A18 migrations byte-identical to the package (no schema change)', all(sha(os.path.join(R, 'backend/vero/migrations', m)) == sha(os.path.join(Z, 'backend/vero/migrations', m)) for m in ['0001_init.sql', '0002_product_text_cache.sql']) and sorted(os.listdir(os.path.join(R, 'backend/vero/migrations'))) == ['0001_init.sql', '0002_product_text_cache.sql'])
chk('A19 wrangler.toml byte-identical to the package (vars/limits/budgets unchanged)', sha(os.path.join(R, 'backend/vero/wrangler.toml')) == sha(os.path.join(Z, 'backend/vero/wrangler.toml')))
chk('A20 frontend-changes diff still applies cleanly to 949fa7b', subprocess.run(['git', '-C', R, 'apply', '--check', '-R', os.path.join(Z, 'frontend-changes-vs-949fa7b.diff')], capture_output=True).returncode == 0)
print(f'\nAsset checks: {sum(res)}/{len(res)}'); sys.exit(0 if all(res) else 1)
