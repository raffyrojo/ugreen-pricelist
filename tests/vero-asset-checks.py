"""Static asset / integrity checks for VERO frontend changes, against the CURRENT production baseline.
Usage: python3 -I tests/vero-asset-checks.py <repo_root> [baseline_ref]
  baseline_ref = the live production commit (default 5a0ce73: Phase 2 + p2r1 live, AI + web ON).

DEPLOY GATE = the "G" checks. All must pass before a frontend deploy.
INFO checks are reported separately and never counted in the gate (known, non-live items).

History (p2r1/p2r2, Phase 2 local-engine revisions — not Phase 3): the Phase 2 package version of this script compared against a pre-enable package zip
(AI off, mirror synced, 06c package files). Those expectations went stale when Phase 2 went live
(ea6f94a). They are replaced here by checks against the authoritative production baseline."""
import hashlib, os, re, subprocess, sys
R = sys.argv[1]
BASE = sys.argv[2] if len(sys.argv) > 2 else '5a0ce73'

# Production baselines (VERO-Phase2 handoff 2026-10-06 + project status doc)
VERO_WORKER_SHA = '594f9606da22ed353d5d82a7f78ae9bb0c6ea082d9a05c6bdbf860046e342d99'   # Worker ugreen-vero
PUBLISH_WORKER_SHA = 'f3d7159f5bf7152e798b98afbd02af1e28da5255f6bf06a194d679a3ce2510e8'  # Worker ugreen-pricelist-cms
AI_ENDPOINT = 'https://ugreen-vero.raffyortega-rojo.workers.dev'
# Files this frontend change is allowed to touch (everything else must be byte-identical to the baseline)
ALLOWED = {'index.html', 'js/vero-nlu.js', 'js/vero-engine.js', 'js/vero.js', 'tests/vero-nlu.test.js', 'tests/vero-engine.test.js', 'tests/vero-asset-checks.py', 'tests/vero-p1-regression.playwright.py'}
VER = {'css/vero.css': 'p2', 'js/vero-nlu.js': 'p2r2', 'js/vero-engine.js': 'p2r2', 'js/vero.js': 'p2r2'}

sha = lambda b: hashlib.sha256(b).hexdigest()
rd = lambda f: open(os.path.join(R, f), 'rb').read()
def git(*a): return subprocess.run(['git', '-C', R, *a], capture_output=True)
def base(f): r = git('show', f'{BASE}:{f}'); return r.stdout if r.returncode == 0 else None

gate, info = [], []
def chk(n, ok, x=''): ok = bool(ok); gate.append(ok); print(('PASS' if ok else 'FAIL') + ' - ' + n + ('' if ok else f'  -> {x}'))
def inf(n, ok, x=''): ok = bool(ok); info.append(ok); print(('INFO ok ' if ok else 'INFO -- ') + n + ('' if ok else f'  ({x})'))

root = rd('index.html').decode('utf-8')
print(f'Baseline: {BASE}\n--- deploy gate ---')
# Asset references / versions
for a, v in VER.items(): chk(f'G01 {a} referenced with exactly ?v={v}', re.search(re.escape(a) + r'\?v=' + v + r'"', root) is not None)
chk('G02 no stale/Phase-3 tags on the VERO scripts (?v=p1 / p2 / p2r1 / p3)', not re.search(r'vero[\w.-]*\?v=p1', root) and not re.search(r'vero(-engine|-nlu)?\.js\?v=p(2|2r1|3)"', root) and not re.search(r'vero[\w.-]*\?v=p3', root))
refs = sorted(set(re.findall(r'(?:src|href)="((?:js|css)/[^"?]+)', root)))
missing = [x for x in refs if not os.path.isfile(os.path.join(R, x))]
chk(f'G03 all {len(refs)} local js/css references exist', not missing, missing)
b_idx = (base('index.html') or b'').decode('utf-8')
norm = lambda h: re.sub(r'(js/vero-engine|js/vero)\.js\?v=[\w]+', r'\1.js?v=X', h)
NLU_TAG = '<script src="js/vero-nlu.js?v=p2r2"></script>\n'
root_wo_nlu = root.replace(NLU_TAG, '', 1)
chk('G04 index.html differs from baseline ONLY in the VERO script versions + the one added vero-nlu.js line (before vero-engine.js)',
    norm(root_wo_nlu) == norm(b_idx) and root != b_idx and root.count('js/vero-nlu.js') == 1 and root.find('js/vero-nlu.js') < root.find('js/vero-engine.js') < root.find('js/vero.js?'))
# Syntax / file hygiene
for f in ['js/vero-nlu.js', 'js/vero-engine.js', 'js/vero.js', 'config.js']:
    r = subprocess.run(['node', '--check', os.path.join(R, f)], capture_output=True, text=True); chk(f'G05 node --check {f}', r.returncode == 0, r.stderr[:200])
chk('G06 no NUL bytes in frontend files', all(b'\x00' not in rd(f) for f in ['index.html', 'config.js', 'js/vero.js', 'js/vero-nlu.js', 'js/vero-engine.js', 'css/vero.css']))
chk('G07 no raw </script> inside VERO JS', all('</script>' not in rd(f).decode('utf-8') for f in ['js/vero.js', 'js/vero-nlu.js', 'js/vero-engine.js']))
# Production config (was A10-A12: stale "AI off" expectations -> current live baseline)
cfg = rd('config.js').decode('utf-8')
chk('G08 config.js = live Phase 2 pilot config (enabled, aiEnabled:true, webEnabled:true, live endpoint)',
    re.search(r'aiEnabled:\s*true', cfg) and re.search(r'webEnabled:\s*true', cfg) and f"aiEndpoint: '{AI_ENDPOINT}'" in cfg and re.search(r'enabled:\s*true', cfg))
chk('G09 config.js byte-identical to baseline (no config change in this deploy)', base('config.js') == rd('config.js'))
# Scope (was A15 "byte-identical to 06c package" -> only allowed files may differ from the live baseline)
changed = set(git('diff', '--name-only', BASE).stdout.decode().split()) | set(git('ls-files', '--others', '--exclude-standard').stdout.decode().split())
chk('G10 only the approved files differ from the live baseline', changed <= ALLOWED, sorted(changed - ALLOWED))
chk('G11 data/ (products.json, dealer data) unchanged vs baseline', git('diff', '--quiet', BASE, '--', 'data/').returncode == 0)
chk('G12 css/vero.css unchanged vs baseline', base('css/vero.css') == rd('css/vero.css'))
# Backend / infrastructure (was A17-A20 vs package -> vs live baseline + deployed hashes)
chk('G13 VERO Worker source sha256 == deployed ugreen-vero baseline 594f9606…2d99', sha(rd('backend/vero/worker.js')) == VERO_WORKER_SHA)
chk('G14 publish Worker source sha256 == deployed ugreen-pricelist-cms baseline f3d7159f…', sha(rd('backend/worker.js')) == PUBLISH_WORKER_SHA)
chk('G15 backend/ (both Workers, wrangler configs = budgets/limits/vars) unchanged vs baseline', git('diff', '--quiet', BASE, '--', 'backend/').returncode == 0)
mig = sorted(os.listdir(os.path.join(R, 'backend/vero/migrations')))
chk('G16 D1 migrations: only 0001/0002, unchanged (no schema change)', mig == ['0001_init.sql', '0002_product_text_cache.sql'] and all(base(f'backend/vero/migrations/{m}') == rd(f'backend/vero/migrations/{m}') for m in mig), mig)
# AI privacy: the only Worker request payload is unchanged and carries no price fields
body = re.search(r'var body=\{[^;]*\};', rd('js/vero.js').decode('utf-8'), re.S)
b_body = re.search(r'var body=\{[^;]*\};', (base('js/vero.js') or b'').decode('utf-8'), re.S)
chk('G17 AI request payload (vero.js body) identical to baseline', body and b_body and body.group(0) == b_body.group(0))
chk('G18 AI request payload has no price/MOQ/dealer fields', body and not re.search(r'srp|\bdp|dp_volume|special_dp|moq|dealer|price', body.group(0), re.I), body.group(0) if body else '')

nlu_src = rd('js/vero-nlu.js').decode('utf-8'); eng_src = rd('js/vero-engine.js').decode('utf-8')
chk('G19 local history layer never reads priceSchedule (future prices cannot leak)', 'priceSchedule' not in re.sub(r'/\*[\s\S]*?\*/|//[^\n]*', '', nlu_src) and 'priceSchedule' not in re.sub(r'/\*[\s\S]*?\*/|//[^\n]*', '', eng_src))
chk('G20 VERO local scripts make no network calls (no fetch/XMLHttpRequest in vero-nlu.js / vero-engine.js)', not re.search(r'\bfetch\s*\(|XMLHttpRequest|sendBeacon', nlu_src + eng_src))

print('--- informational (not part of the deploy gate) ---')
mirror = os.path.join(R, 'ugreen-pricelist-cms/index.html')
inf('I01 mirror ugreen-pricelist-cms/index.html identical to root index.html (mirror is NOT the live page; known backlog item)',
    os.path.isfile(mirror) and open(mirror, encoding='utf-8').read() == root, 'mirror not synced — not served, not a deploy blocker')
inf('I02 mirror unchanged vs baseline (this deploy does not touch it)', os.path.isfile(mirror) and base('ugreen-pricelist-cms/index.html') == rd('ugreen-pricelist-cms/index.html'))

print(f'\nDeploy gate: {sum(gate)}/{len(gate)} PASS' + ('' if all(gate) else '  <-- BLOCKED'))
print(f'Informational: {sum(info)}/{len(info)} (not gating)')
sys.exit(0 if all(gate) else 1)
