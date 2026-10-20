"""Static asset / integrity checks for VERO frontend releases, against the CURRENT production baseline.
Usage: python3 -I tests/vero-asset-checks.py <repo_root> [baseline_ref]
  baseline_ref = the commit GitHub Pages serves now (default 56296068: UNO Phase E AI Worker identity on 69b9d4a UNO front-end branding (VERO p2r3a.4 runtime + dormant v2-2A / v2-2B / V2-2C C1+N1+G3+C2+C2F + C3 tests; v2 shadow files present but NOT loaded); live Worker source = backend/vero/worker.js 368d7430).
  Always pass the baseline explicitly for a release; a CMS Publish moves main and makes any default stale.
  If origin/main moved since (e.g. a CMS Publish commit), re-baseline to the current origin/main.

Two modes, decided automatically, same checks in both (nothing is skipped):
  BASELINE VERIFICATION - the tree equals the baseline: every invariant must hold on the live tree.
  RELEASE DELTA         - files differ: every changed path must be in RELEASE_SCOPE (G10), data changes must be in
                          APPROVED_DATA (G11), every changed js/css must carry a new ?v= tag (G01), plus all invariants.
Per release: edit ONLY the RELEASE SCOPE block below (reviewed together with the release) - list the files the
release may change and any approved data fields. Leave it empty between releases.

DEPLOY GATE = the "G" checks. All must pass before a frontend deploy.
INFO checks are reported separately and never counted in the gate (known, non-live items).
History: the p2r3a release version (baseline 8f3982b, 38/38) hardcoded that release's tags, files and data fixes; see git history."""
import hashlib, os, re, subprocess, sys
R = sys.argv[1]
BASE = sys.argv[2] if len(sys.argv) > 2 else '9bd5273d'

# Production baselines (deployed Workers + live config; change only with an approved Worker / config release)
VERO_WORKER_SHA = '368d74301d0427ab0699d288b7bbc27300a369cb717bf4cddfa8573ff3941b2c'   # Worker ugreen-vero, UNO Phase E source (prompt v5); deployed baseline was 594f9606…2d99 until the approved Worker deploy
PUBLISH_WORKER_SHA = 'f3d7159f5bf7152e798b98afbd02af1e28da5255f6bf06a194d679a3ce2510e8'  # Worker ugreen-pricelist-cms
# Worker configs = mirrors of the live dashboard settings (NEW-DEPLOY-1-FIX, live audit 2026-10-20); re-pin only in an approved config release
VERO_WRANGLER_SHA = 'a2ba39911254294d44df42a24b8ea97e7274729da8bb3c68b6f2f7c1e5685e22'     # backend/vero/wrangler.toml
PUBLISH_WRANGLER_SHA = 'bd2cc181f81301627bbd4f3f6fc6f95c0946c15ac8d706ced9c87fa8434bbfde'  # backend/wrangler.toml
AI_ENDPOINT = 'https://ugreen-vero.raffyortega-rojo.workers.dev'

# ===================== RELEASE SCOPE (edit per release; empty between releases) =====================
# Files this release is allowed to change vs the baseline (everything else must be byte-identical). The gate itself is
# always allowed so that a reviewed gate edit can travel with its release.
RELEASE_SCOPE = {'tests/vero-asset-checks.py',
                 # NEW-DEPLOY-1-FIX (baseline 9bd5273d = live; owner-approved rows 1–6, 2026-10-20): both wrangler.toml files
                 # mirror the live dashboard settings (AI_ENABLED / WEB_ENABLED "true", keep_vars, CMS [observability]);
                 # G15b pins their sha256. No Worker source, migration, front-end or data change; nothing is deployed. NO data.
                 'backend/vero/wrangler.toml', 'backend/wrangler.toml'}
# Approved data/products.json field changes for this release: {(item_code, field): (old, new)}. Empty = no data change.
# ABSENT marks a key that does not exist on that side (key removal / addition); it never equals a stored null ('None').
ABSENT = '<absent>'
APPROVED_DATA = {}
# Approved product ADDITIONS (item codes) for this release; each added record must be byte-identical (JSON) to the record with
# the same item_code at APPROVED_ADDITIONS_REF, and every pre-existing product must keep its position and values. Empty = none.
APPROVED_ADDITIONS = set()
APPROVED_ADDITIONS_REF = 'f5e12baf2d8479b2aaf8f2c230556a80636128f6'
# ======================================================================================================

ORDER = ['js/vero-lexicon.js', 'js/vero-nlu.js', 'js/vero-facts.js', 'js/vero-plan.js', 'js/vero-compose.js', 'js/vero-engine.js', 'js/vero.js']   # live load order
VJS = list(ORDER)
# v2 shadow assets: ONE authoritative map file -> browser global. Every entry must stay unloaded and unreferenced (G23).
# js/vero-evidence.js = UNO Evidence & Retrieval Layer R1 (shadow / dormant). Keep this map a one-line literal (parsed by tests).
SHADOW = {'js/vero-ontology.js': 'VeroOntology', 'js/vero-parse.js': 'VeroParse', 'js/vero-discourse.js': 'VeroDiscourse', 'js/vero-context.js': 'VeroContext', 'js/vero-evidence.js': 'VeroEvidence'}

sha = lambda b: hashlib.sha256(b).hexdigest()
rd = lambda f: open(os.path.join(R, f), 'rb').read()
def git(*a): return subprocess.run(['git', '-C', R, *a], capture_output=True)
def base(f): r = git('show', f'{BASE}:{f}'); return r.stdout if r.returncode == 0 else None

gate, info = [], []
def chk(n, ok, x=''): ok = bool(ok); gate.append(ok); print(('PASS' if ok else 'FAIL') + ' - ' + n + ('' if ok else f'  -> {x}'))
def inf(n, ok, x=''): ok = bool(ok); info.append(ok); print(('INFO ok ' if ok else 'INFO -- ') + n + ('' if ok else f'  ({x})'))

root = rd('index.html').decode('utf-8')
if git('cat-file', '-e', f'{BASE}^{{commit}}').returncode != 0: print(f'Baseline {BASE} is not a commit in this repo'); sys.exit(2)
changed = set(git('diff', '--name-only', BASE).stdout.decode().split()) | set(git('ls-files', '--others', '--exclude-standard').stdout.decode().split())
delta = changed - {'tests/vero-asset-checks.py'}   # the gate's own (reviewed) edits are gate maintenance, not a release delta; G10 still checks them
print(f'Baseline: {BASE}')
print('Mode: BASELINE VERIFICATION (no release delta vs the baseline' + ('; gate script itself edited' if changed else '') + ')' if not delta else
      f'Mode: RELEASE DELTA ({len(delta)} path(s) differ from the baseline): ' + ', '.join(sorted(delta)))
print('--- deploy gate ---')
b_idx = (base('index.html') or b'').decode('utf-8')
refs = sorted(set(re.findall(r'(?:src|href)="((?:js|css)/[^"?]+)', root)))
TAG = r'(?:src|href)="((?:js|css)/[^"?]+)\?v=([^"]+)"'
tags, btags = dict(re.findall(TAG, root)), dict(re.findall(TAG, b_idx))
for a in refs:   # cache-buster integrity: EVERY local js/css (tagged or not) whose bytes differ from the baseline must carry a new ?v= tag
    t, same = tags.get(a), os.path.isfile(os.path.join(R, a)) and base(a) == rd(a)
    one = len({v for k, v in re.findall(TAG, root) if k == a}) <= 1   # a file referenced twice must not carry two different tags
    chk(f'G01 {a}' + (f'?v={t}' if t else ' (no ?v= tag)') + ': ' + ('unchanged vs baseline' if same else f'content changed -> needs a new ?v= tag (baseline: {btags.get(a)})'),
        one and (same or (t is not None and t != btags.get(a))), 'conflicting tags for one file' if not one else (f'file changed but tag is ' + (f'still ?v={t}' if t else 'missing')))
chk('G02 no retired VERO tags (engine / vero.js not at p1/p2/p2r1/p2r2/p2r2.1; css not at p2)', not re.search(r'vero(-engine)?\.js\?v=p(1|2|2r1|2r2|2r2\.1)"', root) and not re.search(r'css/vero\.css\?v=p2"', root))
missing = [x for x in refs if not os.path.isfile(os.path.join(R, x))]
chk(f'G03 all {len(refs)} local js/css references exist', not missing, missing)
strip = lambda h: re.sub(r'((?:src|href)="(?:js|css)/[^"?]+)(?:\?v=[^"]*)?"', r'\1"', re.sub(r'<script src="js/vero[\w-]*\.js\?v=[\w.]+"></script>\n?|<link rel="stylesheet" href="css/vero\.css\?v=[\w.]+">', '', h))
pos = [root.find(f + '?v=') for f in ORDER]
chk('G04 index.html differs from baseline ONLY in VERO script/css lines and ?v= tags; Local Brain loads lexicon -> nlu -> facts -> plan -> compose -> engine -> vero.js (each once)',
    strip(root) == strip(b_idx) and all(p > 0 for p in pos) and pos == sorted(pos) and all(root.count(f + '?v=') == 1 for f in ORDER), pos)
outside = [f for f in VJS + list(SHADOW) if f not in RELEASE_SCOPE and base(f) != (rd(f) if os.path.isfile(os.path.join(R, f)) else None)]
chk('G04b VERO runtime + shadow files outside RELEASE_SCOPE are byte-identical to the baseline', not outside, outside)
CHK_JS = sorted(set(VJS + [f for f in list(SHADOW) if os.path.isfile(os.path.join(R, f))] + [f for f in changed if f.endswith('.js') and f.startswith('js/') and os.path.isfile(os.path.join(R, f))]))
for f in CHK_JS + ['config.js']:
    r = subprocess.run(['node', '--check', os.path.join(R, f)], capture_output=True, text=True); chk(f'G05 node --check {f}', r.returncode == 0, r.stderr[:200])
chk('G06 no NUL bytes in frontend files', all(b'\x00' not in rd(f) for f in ['index.html', 'config.js', 'css/vero.css'] + CHK_JS))
chk('G07 no raw </script> inside VERO JS', all('</script>' not in rd(f).decode('utf-8') for f in CHK_JS))
cfg = rd('config.js').decode('utf-8')
chk('G08 config.js = live Phase 2 pilot config (enabled, aiEnabled:true, webEnabled:true, live endpoint)',
    re.search(r'aiEnabled:\s*true', cfg) and re.search(r'webEnabled:\s*true', cfg) and f"aiEndpoint: '{AI_ENDPOINT}'" in cfg and re.search(r'enabled:\s*true', cfg))
chk('G09 config.js byte-identical to baseline (no config change in this deploy)', base('config.js') == rd('config.js'))
chk('G10 only RELEASE_SCOPE files differ from the live baseline (no unapproved changed or new repo paths)', changed <= RELEASE_SCOPE, sorted(changed - RELEASE_SCOPE))
# G11: data/ unchanged vs baseline, except field changes listed in APPROVED_DATA for this release
import json as _json
_other = git('diff', '--name-only', BASE, '--', 'data/').stdout.decode().split()
_pb, _pn = _json.loads(base('data/products.json').decode('utf-8')), _json.loads(rd('data/products.json').decode('utf-8'))
_dd = set()
_bcodes = {str(x.get('item_code')) for x in _pb}
_added = [str(x.get('item_code')) for x in _pn if str(x.get('item_code')) not in _bcodes]
_add_bad = []
if _added or APPROVED_ADDITIONS:
    _ref = {str(x.get('item_code')): x for x in (_json.loads(git('show', f'{APPROVED_ADDITIONS_REF}:data/products.json').stdout.decode('utf-8')) if APPROVED_ADDITIONS else [])}
    if sorted(_added) != sorted(APPROVED_ADDITIONS): _add_bad.append(f'added {sorted(_added)} != approved {sorted(APPROVED_ADDITIONS)}')
    for _c in _added:
        _r = _ref.get(_c); _x = next(x for x in _pn if str(x.get('item_code')) == _c)
        if _r is None or _json.dumps(_r, sort_keys=False, ensure_ascii=False) != _json.dumps(_x, sort_keys=False, ensure_ascii=False): _add_bad.append(f'{_c} differs from {APPROVED_ADDITIONS_REF[:8]}')
    _nc = [str(x.get('item_code')) for x in _pn]
    _rc = [c for c in _ref if c in set(_nc)]
    if [c for c in _nc if c in _ref] != _rc: _add_bad.append(f'added products not at their {APPROVED_ADDITIONS_REF[:8]} positions (relative order differs)')
_pn = [x for x in _pn if str(x.get('item_code')) not in set(_added)]   # pre-existing products, in their new order
if len(_pb) == len(_pn):
    for _a, _b in zip(_pb, _pn):
        for _k in set(_a) | set(_b):
            # key presence counts (NA-13): an absent key is ABSENT, never confused with a stored null (str(None) == 'None')
            _ov, _nv = (str(_a[_k]) if _k in _a else ABSENT), (str(_b[_k]) if _k in _b else ABSENT)
            if _ov != _nv: _dd.add((str(_a.get('item_code')), _k, _ov, _nv))
# APPROVED_DATA is the EXACT data-change manifest: the actual change map must equal it (no extra, no missing, exact old/new).
# Values are compared as str() of the products.json value, so write them as stored (e.g. 999 vs '999.0' differ -> fails safe).
# A removed or added key is written with the ABSENT marker on that side (e.g. ('25683', 'previousSRP'): ('1339', ABSENT)).
_actual = {(c, k): (o, n) for c, k, o, n in _dd}
_want = {(str(c), k): (str(o), str(n)) for (c, k), (o, n) in APPROVED_DATA.items()}
_extra = sorted(f'{c}.{k}: {o!r} -> {n!r} (not approved)' for (c, k), (o, n) in _actual.items() if _want.get((c, k)) != (o, n))
_miss = sorted(f'{c}.{k}: expected {o!r} -> {n!r} (missing / differs)' for (c, k), (o, n) in _want.items() if _actual.get((c, k)) != (o, n))
_ok = (not _add_bad and [str(x.get('item_code')) for x in _pb] == [str(x.get('item_code')) for x in _pn] and len(_pb) == len(_pn) and len(_actual) == len(_dd) and len(_want) == len(APPROVED_DATA) and _actual == _want
       and set(_other) <= {'data/products.json'})
_why = _add_bad + ([f'pre-existing product count {len(_pb)} -> {len(_pn)}'] if len(_pb) != len(_pn) else []) + \
       (['pre-existing product order changed'] if len(_pb) == len(_pn) and [str(x.get('item_code')) for x in _pb] != [str(x.get('item_code')) for x in _pn] else []) + \
       (['duplicate (item_code, field) in the actual changes'] if len(_actual) != len(_dd) else []) + \
       (['APPROVED_DATA has keys that collide after str() normalisation'] if len(_want) != len(APPROVED_DATA) else []) + \
       ([f'other data/ file changed: {sorted(set(_other) - {"data/products.json"})}'] if not set(_other) <= {'data/products.json'} else [])
chk(f'G11 data/: field changes == APPROVED_DATA exactly ({len(_dd)} found, {len(_want)} approved; additions {len(_added)} == {len(APPROVED_ADDITIONS)} approved, identical to ref; pre-existing count + order kept; no other data/ file)', _ok,
    (_why + ([] if len(_pb) != len(_pn) else _extra + _miss))[:6])
DATA_CHANGED = len(_dd) > 0 or bool(_added)
bcss = (base('css/vero.css') or b'').decode('utf-8').splitlines(); ncss = rd('css/vero.css').decode('utf-8').splitlines()
chk('G12 css/vero.css: additive only (every baseline line kept; new rules only if css/vero.css is in RELEASE_SCOPE)', all(l in ncss for l in bcss) and (ncss == bcss or 'css/vero.css' in RELEASE_SCOPE))
chk('G13 VERO Worker source sha256 == pinned ugreen-vero source 368d7430…1b2c (UNO Phase E, prompt v5)', sha(rd('backend/vero/worker.js')) == VERO_WORKER_SHA)
chk('G14 publish Worker source sha256 == deployed ugreen-pricelist-cms baseline f3d7159f…', sha(rd('backend/worker.js')) == PUBLISH_WORKER_SHA)
chk('G15b Worker configs == pinned live mirrors (backend/vero/wrangler.toml a2ba3991…, backend/wrangler.toml bd2cc181…)',
    sha(rd('backend/vero/wrangler.toml')) == VERO_WRANGLER_SHA and sha(rd('backend/wrangler.toml')) == PUBLISH_WRANGLER_SHA,
    [f for f, h in (('backend/vero/wrangler.toml', VERO_WRANGLER_SHA), ('backend/wrangler.toml', PUBLISH_WRANGLER_SHA)) if sha(rd(f)) != h])
# G15: backend/ paths may differ only if listed in RELEASE_SCOPE (this release: exactly the two wrangler.toml files); empty = all unchanged
BACKEND_SCOPE = {f for f in RELEASE_SCOPE if f.startswith('backend/')}
backend_changed = {f for f in changed if f.startswith('backend/')}
chk('G15 backend/ (both Workers, wrangler configs = budgets/limits/vars) unchanged vs baseline except ' + (', '.join(sorted(BACKEND_SCOPE)) or 'nothing'),
    backend_changed <= BACKEND_SCOPE, sorted(backend_changed - BACKEND_SCOPE))
mig = sorted(os.listdir(os.path.join(R, 'backend/vero/migrations')))
chk('G16 D1 migrations: only 0001/0002, unchanged (no schema change)', mig == ['0001_init.sql', '0002_product_text_cache.sql'] and all(base(f'backend/vero/migrations/{m}') == rd(f'backend/vero/migrations/{m}') for m in mig), mig)
vjs = rd('js/vero.js').decode('utf-8'); bvjs = (base('js/vero.js') or b'').decode('utf-8')
payload = lambda t: t[t.find('var body='):t.find("fetch(a.url+'/ask'")]
chk('G17 AI request payload (vero.js body) identical to baseline', payload(vjs) and payload(vjs) == payload(bvjs))
chk('G18 AI request payload has no price/MOQ/dealer fields', not re.search(r'srp|\bdp|dp_volume|special_dp|moq|dealer|price', payload(vjs), re.I), payload(vjs))
nocom = lambda t: re.sub(r'/\*[\s\S]*?\*/|//[^\n]*', '', t)
brain = {f: nocom(rd(f).decode('utf-8')) for f in VJS + list(SHADOW) if f != 'js/vero.js' and os.path.isfile(os.path.join(R, f))}
chk('G19 no Local Brain / engine file reads priceSchedule (future prices cannot leak)', not any('priceSchedule' in t for t in brain.values()))
chk('G20 VERO local scripts make no network calls (no fetch/XMLHttpRequest/sendBeacon in lexicon/nlu/facts/plan/compose/engine)', not any(re.search(r'\bfetch\s*\(|XMLHttpRequest|sendBeacon', t) for t in brain.values()))
import json
codes = {str(p['item_code']).upper() for p in json.load(open(os.path.join(R, 'data/products.json'), encoding='utf-8'))}
leak = sorted({(f, t) for f, t0 in brain.items() for t in re.findall(r'\b\d{5}[A-Z]{0,2}\b', t0.upper()) if t in codes})
chk('G21 no catalog item code hardcoded in any Local Brain / engine file', not leak, leak[:5])
# G23: tokens derived from SHADOW (exact basenames without .js + exact-case globals), escaped and case-sensitive; scanned in
# index.html and EVERY live load-order file. Never a bare word such as "discourse" (live comments may contain it).
G23_TOKENS = sorted({os.path.basename(f)[:-3] for f in SHADOW} | set(SHADOW.values()))
G23_RE = re.compile('|'.join(re.escape(t) for t in G23_TOKENS))
g23_hits = sorted({(f, m) for f, t in [('index.html', root)] + [(f, rd(f).decode('utf-8')) for f in ORDER] for m in G23_RE.findall(t)})
chk(f'G23 v2 shadow assets ({", ".join(os.path.basename(f) for f in SHADOW)}; globals {", ".join(SHADOW.values())}) are NOT referenced by index.html or any of the {len(ORDER)} live load-order files',
    bool(G23_TOKENS) and not g23_hits, g23_hits[:5])
chk('G22 vero.js stores no prices in the conversation context (keepCtx/convCtx carry codes + plan only)', 'keepCtx' in vjs and not re.search(r'ctx[^;]{0,80}\.(srp|dp|dp_volume)\b', vjs))
# G24: the evidence layer (shadow) never reads commercial fields - the pricelist stays the only commercial authority
_ev = brain.get('js/vero-evidence.js', '')
chk('G24 evidence layer js/vero-evidence.js reads no commercial field (srp / dp / dp_volume / special_dp / moq / priceSchedule / priceHistory)',
    bool(_ev) and not re.search(r'\.(srp|dp|dp_volume|special_dp|moq|priceSchedule|priceHistory)\b|\[\s*[\'"](srp|dp|dp_volume|special_dp|moq)[\'"]\s*\]', _ev))

print('--- informational (not part of the deploy gate) ---')
mirror = os.path.join(R, 'ugreen-pricelist-cms/index.html')
inf('I01 mirror ugreen-pricelist-cms/index.html identical to root index.html (mirror is NOT the live page; known backlog item)',
    os.path.isfile(mirror) and open(mirror, encoding='utf-8').read() == root, 'mirror not synced — not served, not a deploy blocker')
inf('I02 mirror unchanged vs baseline (this deploy does not touch it)', os.path.isfile(mirror) and base('ugreen-pricelist-cms/index.html') == rd('ugreen-pricelist-cms/index.html'))

print(f'\nDeploy gate: {sum(gate)}/{len(gate)} PASS' + ('' if all(gate) else '  <-- BLOCKED') + ('  [baseline verification]' if not delta else '  [release delta]'))
print(f'Informational: {sum(info)}/{len(info)} (not gating)')
sys.exit(0 if all(gate) else 1)
