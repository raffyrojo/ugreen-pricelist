"""Static asset / integrity checks for VERO frontend changes, against the CURRENT production baseline.
Usage: python3 -I tests/vero-asset-checks.py <repo_root> [baseline_ref]
  baseline_ref = the commit GitHub Pages serves (default 8f3982b: p2r2.1 live + Local Brain files present but NOT loaded).
  p2r3a (Local Brain switch-over) changes index.html (VERO script/css tags), css/vero.css (one rule), js/vero.js (context + echo),
  js/vero-engine.js (adapter), js/vero-lexicon.js, js/vero-plan.js, NEW js/vero-compose.js, and tests.
  js/vero-nlu.js and js/vero-facts.js are unchanged (loaded, not edited).

DEPLOY GATE = the "G" checks. All must pass before a frontend deploy.
INFO checks are reported separately and never counted in the gate (known, non-live items).
History: p2r1/p2r2/p2r2.1 versions of this script checked only the engine + NLU (see git history)."""
import hashlib, os, re, subprocess, sys
R = sys.argv[1]
BASE = sys.argv[2] if len(sys.argv) > 2 else '8f3982b'

# Production baselines (VERO-Phase2 handoff 2026-10-06 + project status doc)
VERO_WORKER_SHA = '594f9606da22ed353d5d82a7f78ae9bb0c6ea082d9a05c6bdbf860046e342d99'   # Worker ugreen-vero
PUBLISH_WORKER_SHA = 'f3d7159f5bf7152e798b98afbd02af1e28da5255f6bf06a194d679a3ce2510e8'  # Worker ugreen-pricelist-cms
AI_ENDPOINT = 'https://ugreen-vero.raffyortega-rojo.workers.dev'
# Files this frontend change is allowed to touch (everything else must be byte-identical to the baseline)
ALLOWED = {'data/products.json', 'index.html', 'css/vero.css', 'js/vero.js', 'js/vero-engine.js', 'js/vero-lexicon.js', 'js/vero-plan.js', 'js/vero-compose.js',
           'tests/vero-asset-checks.py', 'tests/vero-p1-regression.playwright.py', 'tests/vero-p2r21.test.js', 'tests/vero-plan.test.js', 'tests/vero-plan-shadow.js',
           'tests/vero-lexicon.test.js', 'tests/vero-facts-shadow.playwright.py', 'tests/vero-plan-browser.playwright.py',
           'tests/vero-p2r3a.test.js', 'tests/vero-p2r3a-benchmark.js', 'tests/vero-p2r3a.playwright.py',
           'tests/vero-p2r3a-fixes.test.js', 'tests/vero-p2r3a-fixes2.test.js'}
VER = {'css/vero.css': 'p2r3a', 'js/vero-lexicon.js': 'p2r3a', 'js/vero-nlu.js': 'p2r2.1', 'js/vero-facts.js': 'p2r3a', 'js/vero-plan.js': 'p2r3a',
       'js/vero-compose.js': 'p2r3a', 'js/vero-engine.js': 'p2r3a', 'js/vero.js': 'p2r3a'}
ORDER = ['js/vero-lexicon.js', 'js/vero-nlu.js', 'js/vero-facts.js', 'js/vero-plan.js', 'js/vero-compose.js', 'js/vero-engine.js', 'js/vero.js']
VJS = ['js/vero-lexicon.js', 'js/vero-nlu.js', 'js/vero-facts.js', 'js/vero-plan.js', 'js/vero-compose.js', 'js/vero-engine.js', 'js/vero.js']

sha = lambda b: hashlib.sha256(b).hexdigest()
rd = lambda f: open(os.path.join(R, f), 'rb').read()
def git(*a): return subprocess.run(['git', '-C', R, *a], capture_output=True)
def base(f): r = git('show', f'{BASE}:{f}'); return r.stdout if r.returncode == 0 else None

gate, info = [], []
def chk(n, ok, x=''): ok = bool(ok); gate.append(ok); print(('PASS' if ok else 'FAIL') + ' - ' + n + ('' if ok else f'  -> {x}'))
def inf(n, ok, x=''): ok = bool(ok); info.append(ok); print(('INFO ok ' if ok else 'INFO -- ') + n + ('' if ok else f'  ({x})'))

root = rd('index.html').decode('utf-8')
print(f'Baseline: {BASE}\n--- deploy gate ---')
for a, v in VER.items(): chk(f'G01 {a} referenced with exactly ?v={v}', re.search(re.escape(a) + r'\?v=' + re.escape(v) + r'"', root) is not None)
chk('G02 no stale VERO tags (engine / vero.js / css not left at p1/p2/p2r1/p2r2/p2r2.1; nothing at p3)', not re.search(r'vero(-engine)?\.js\?v=p(1|2|2r1|2r2|2r2\.1)"', root) and not re.search(r'css/vero\.css\?v=p2"', root) and not re.search(r'vero[\w.-]*\?v=p3', root))
refs = sorted(set(re.findall(r'(?:src|href)="((?:js|css)/[^"?]+)', root)))
missing = [x for x in refs if not os.path.isfile(os.path.join(R, x))]
chk(f'G03 all {len(refs)} local js/css references exist', not missing, missing)
b_idx = (base('index.html') or b'').decode('utf-8')
strip = lambda h: re.sub(r'<script src="js/vero[\w-]*\.js\?v=[\w.]+"></script>\n?|<link rel="stylesheet" href="css/vero\.css\?v=[\w.]+">', '', h)
pos = [root.find(f + '?v=') for f in ORDER]
chk('G04 index.html differs from baseline ONLY in the VERO script/css tags; Local Brain loads lexicon -> nlu -> facts -> plan -> compose -> engine -> vero.js',
    strip(root) == strip(b_idx) and root != b_idx and all(p > 0 for p in pos) and pos == sorted(pos) and all(root.count(f + '?v=') == 1 for f in ORDER), pos)
chk('G04b vero-nlu.js and vero-facts.js byte-identical to baseline (loaded, not edited in p2r3a)', base('js/vero-nlu.js') == rd('js/vero-nlu.js') and base('js/vero-facts.js') == rd('js/vero-facts.js'))
for f in VJS + ['config.js']:
    r = subprocess.run(['node', '--check', os.path.join(R, f)], capture_output=True, text=True); chk(f'G05 node --check {f}', r.returncode == 0, r.stderr[:200])
chk('G06 no NUL bytes in frontend files', all(b'\x00' not in rd(f) for f in ['index.html', 'config.js', 'css/vero.css'] + VJS))
chk('G07 no raw </script> inside VERO JS', all('</script>' not in rd(f).decode('utf-8') for f in VJS))
cfg = rd('config.js').decode('utf-8')
chk('G08 config.js = live Phase 2 pilot config (enabled, aiEnabled:true, webEnabled:true, live endpoint)',
    re.search(r'aiEnabled:\s*true', cfg) and re.search(r'webEnabled:\s*true', cfg) and f"aiEndpoint: '{AI_ENDPOINT}'" in cfg and re.search(r'enabled:\s*true', cfg))
chk('G09 config.js byte-identical to baseline (no config change in this deploy)', base('config.js') == rd('config.js'))
changed = set(git('diff', '--name-only', BASE).stdout.decode().split()) | set(git('ls-files', '--others', '--exclude-standard').stdout.decode().split())
chk('G10 only the approved files differ from the live baseline', changed <= ALLOWED, sorted(changed - ALLOWED))
# G11: data/ unchanged vs baseline, EXCEPT the approved 2026-10-07 data-quality correction (5 fields; a SEPARATE data deploy, not part of the frontend change)
APPROVED_DATA = {('70503', 'category'): ('Hard Drive Enclosure', 'PCIe Expansion Card'), ('70504', 'category'): ('Hard Drive Enclosure', 'PCIe Expansion Card'),
                 ('30715', 'category'): ('Hard Drive Enclosure', 'PCIe Expansion Card'),
                 ('10902', 'product_name'): ('M.2NVME Hard Drive Enclosure(10Gbps)', 'M.2 NVMe Hard Drive Enclosure (10Gbps)'),
                 ('15512', 'product_name'): ('M.2NVME Hard Drive Enclosure(10Gbps)', 'M.2 NVMe Hard Drive Enclosure (10Gbps)')}
import json as _json
_other = git('diff', '--name-only', BASE, '--', 'data/').stdout.decode().split()
_pb, _pn = _json.loads(base('data/products.json').decode('utf-8')), _json.loads(rd('data/products.json').decode('utf-8'))
_dd = set()
if len(_pb) == len(_pn):
    for _a, _b in zip(_pb, _pn):
        for _k in set(_a) | set(_b):
            if _a.get(_k) != _b.get(_k): _dd.add((str(_a.get('item_code')), _k, str(_a.get(_k)), str(_b.get(_k))))
_ok = len(_pb) == len(_pn) and all(APPROVED_DATA.get((c, k)) == (o, n) for c, k, o, n in _dd) and set(_other) <= {'data/products.json'}
chk(f'G11 data/: unchanged except the approved data correction ({len(_dd)} field change(s) found, all approved)', _ok, sorted(_dd)[:6])
DATA_CHANGED = len(_dd) > 0
bcss = (base('css/vero.css') or b'').decode('utf-8').splitlines(); ncss = rd('css/vero.css').decode('utf-8').splitlines()
chk('G12 css/vero.css: additive only (every baseline line kept; only .vero-echo added)', all(l in ncss for l in bcss) and all(l in bcss or '.vero-echo' in l for l in ncss))
chk('G13 VERO Worker source sha256 == deployed ugreen-vero baseline 594f9606…2d99', sha(rd('backend/vero/worker.js')) == VERO_WORKER_SHA)
chk('G14 publish Worker source sha256 == deployed ugreen-pricelist-cms baseline f3d7159f…', sha(rd('backend/worker.js')) == PUBLISH_WORKER_SHA)
chk('G15 backend/ (both Workers, wrangler configs = budgets/limits/vars) unchanged vs baseline', git('diff', '--quiet', BASE, '--', 'backend/').returncode == 0)
mig = sorted(os.listdir(os.path.join(R, 'backend/vero/migrations')))
chk('G16 D1 migrations: only 0001/0002, unchanged (no schema change)', mig == ['0001_init.sql', '0002_product_text_cache.sql'] and all(base(f'backend/vero/migrations/{m}') == rd(f'backend/vero/migrations/{m}') for m in mig), mig)
vjs = rd('js/vero.js').decode('utf-8'); bvjs = (base('js/vero.js') or b'').decode('utf-8')
payload = lambda t: t[t.find('var body='):t.find("fetch(a.url+'/ask'")]
chk('G17 AI request payload (vero.js body) identical to baseline', payload(vjs) and payload(vjs) == payload(bvjs))
chk('G18 AI request payload has no price/MOQ/dealer fields', not re.search(r'srp|\bdp|dp_volume|special_dp|moq|dealer|price', payload(vjs), re.I), payload(vjs))
nocom = lambda t: re.sub(r'/\*[\s\S]*?\*/|//[^\n]*', '', t)
brain = {f: nocom(rd(f).decode('utf-8')) for f in VJS if f != 'js/vero.js'}
chk('G19 no Local Brain / engine file reads priceSchedule (future prices cannot leak)', not any('priceSchedule' in t for t in brain.values()))
chk('G20 VERO local scripts make no network calls (no fetch/XMLHttpRequest/sendBeacon in lexicon/nlu/facts/plan/compose/engine)', not any(re.search(r'\bfetch\s*\(|XMLHttpRequest|sendBeacon', t) for t in brain.values()))
import json
codes = {str(p['item_code']).upper() for p in json.load(open(os.path.join(R, 'data/products.json'), encoding='utf-8'))}
leak = sorted({(f, t) for f, t0 in brain.items() for t in re.findall(r'\b\d{5}[A-Z]{0,2}\b', t0.upper()) if t in codes})
chk('G21 no catalog item code hardcoded in any Local Brain / engine file', not leak, leak[:5])
chk('G22 vero.js stores no prices in the conversation context (keepCtx/convCtx carry codes + plan only)', 'keepCtx' in vjs and not re.search(r'ctx[^;]{0,80}\.(srp|dp|dp_volume)\b', vjs))

print('--- informational (not part of the deploy gate) ---')
mirror = os.path.join(R, 'ugreen-pricelist-cms/index.html')
inf('I01 mirror ugreen-pricelist-cms/index.html identical to root index.html (mirror is NOT the live page; known backlog item)',
    os.path.isfile(mirror) and open(mirror, encoding='utf-8').read() == root, 'mirror not synced — not served, not a deploy blocker')
inf('I02 mirror unchanged vs baseline (this deploy does not touch it)', os.path.isfile(mirror) and base('ugreen-pricelist-cms/index.html') == rd('ugreen-pricelist-cms/index.html'))

print(f'\nDeploy gate: {sum(gate)}/{len(gate)} PASS' + ('' if all(gate) else '  <-- BLOCKED'))
print(f'Informational: {sum(info)}/{len(info)} (not gating)')
sys.exit(0 if all(gate) else 1)
