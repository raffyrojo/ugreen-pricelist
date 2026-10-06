"""VERO browser regression: same local (non-ranking) VERO questions on the LOCAL build vs the LIVE production site.
Baseline (updated for p2r2): Phase 2 + p2r1 are live with frontend AI enabled; the local build loads the Phase 2 local-engine revision ?v=p2r2.
Every answer must be identical, EXCEPT the questions in P2R2_CHANGED: p2r2 intentionally answers those differently
(local attribute / price-history layer). Each of those must instead match its expected p2r2 answer pattern.
Usage: python3 -I p1_regression.py <repo_root>"""
import json, os, re, sys, threading, http.server, socketserver, functools
from playwright.sync_api import sync_playwright
ROOT = sys.argv[1]
LIVE = 'https://raffyrojo.github.io/ugreen-pricelist/'
prods = [p for p in json.load(open(os.path.join(ROOT, 'data/products.json'))) if not p.get('disabled')]
codes = [str(p['item_code']) for p in prods]
models = []
for p in prods:
    m = str(p.get('model') or '').strip()
    if m and m not in models: models.append(m)
upcs = [str(p['upc']) for p in prods if str(p.get('upc') or '').strip().isdigit()]
Q = [*codes[0:400:40], *models[5:300:37], *upcs[3:200:40],
     f'srp of {models[10]}', f'dp of {codes[50]}', f'dp vol {models[20]}', f'moq of {codes[120]}', f'price of {models[33]}',
     f'what is the srp and moq of {codes[200]}', f'magkano {models[44]}', f'dp volume {codes[300]}',
     '65W charger', 'usb c cable 2m', 'power bank 20000mAh', 'hdmi cable', 'black usb c hub', 'car charger', 'magnetic power bank', 'type c to lightning',
     f'compare {models[1]} vs {models[2]}', f'compare {codes[10]} and {codes[11]}', 'compare CD244 vs X772', f'{models[3]} or {models[4]}',
     'charger for laptop and phone', 'travel charger', 'something for my desk setup', 'best gift for a gamer',
     'Alin mas okay for travel kung laptop at phone ang gagamitin ko?', 'may 100W charger ba kayo', 'pang laptop na charger', 'meron ba kayong hdmi cable',
     'hello', 'help', 'asdfqwer', 'new arrivals', 'price decrease', 'docking station', 'earbuds', 'mouse', 'usb c to usb c cable', 'wireless charger', 'charger for iphone', f'{codes[5]} srp', 'gan charger 100w']
Q = Q[:64]
# p2r2: intentional, reviewed answer changes (live = p2r1). Each must match the p2r2 pattern on the LOCAL build.
P2R2_CHANGED = {
    'black usb c hub': r'^2 black USB-C hubs',                                         # same 2 SKUs, now with a heading
    'may 100W charger ba kayo': r'^Yes — 4 100W chargers in the current pricelist',     # p2r1: "No products match"
    'meron ba kayong hdmi cable': r'^Yes — \d+ HDMI cables in the current pricelist, across 3 sections\. Which one\?',  # HDMI adapters no longer counted as cables
    'price decrease': r'^2 SKUs with an SRP decrease \(Recorded price history starts 2026-09-18\)',  # p2r1: "No products match"
    'gan charger 100w': r'^4 GaN 100W chargers',                                        # adds 45514B ("GaNTech")
}
class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = socketserver.TCPServer(('127.0.0.1', 0), functools.partial(H, directory=ROOT)); port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
LOCAL = f'http://127.0.0.1:{port}/index.html'
def run(url, errs, nets):
    with sync_playwright() as pw:
        b = pw.chromium.launch(); pg = b.new_page(viewport={'width': 1280, 'height': 900})
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('request', lambda r: nets.append(r.url) if 'ugreen-vero' in r.url or 'openai' in r.url else None)
        pg.goto(url, wait_until='networkidle', timeout=90000); pg.wait_for_timeout(1500)
        pg.click('#vero-fab'); pg.wait_for_timeout(400)
        out = []
        for q in Q:
            pg.fill('#vero-input', q); pg.press('#vero-input', 'Enter'); pg.wait_for_timeout(450)
            t = pg.evaluate("(()=>{const b=[...document.querySelectorAll('#vero-log .vero-msg.vero-bot')].pop();return b?b.innerText:''})()")
            out.append(re.sub(r'\s+', ' ', t).strip())
        ver = pg.evaluate("[...document.scripts].map(s=>s.src).filter(s=>/vero/.test(s)).join(' ')")
        cfg = pg.evaluate("JSON.stringify((window.CONFIG||window.APP_CONFIG||{}).vero||null)")
        b.close(); return out, ver, cfg
le, ln, re_, rn = [], [], [], []
lo, lv, lc = run(LOCAL, le, ln); ro, rv, rc = run(LIVE, re_, rn)
same = [(re.search(P2R2_CHANGED[q], a) is not None) if q in P2R2_CHANGED else (a == b) for q, a, b in zip(Q, lo, ro)]
for i, (q, ok) in enumerate(zip(Q, same)):
    tag = ' [p2r2 intended change]' if q in P2R2_CHANGED else ''
    print(('PASS' if ok else 'FAIL') + f' - R{i+1:02d} {q[:60]!r}{tag}' + ('' if ok else f'\n   local: {lo[i][:200]}\n   live : {ro[i][:200]}'))
checks = [('C1 all answers non-empty', all(lo) and all(ro)),
          ('C2 no page errors (local + live)', not le and not re_), ('C3 no AI/Worker/OpenAI requests (local + live)', not ln and not rn),
          ('C4 local loads vero-nlu.js/vero-engine.js/vero.js ?v=p2r2; live loads Phase 2 assets (?v=p2r1 or ?v=p2r2); no p1/p3 tags anywhere', 'vero-nlu.js?v=p2r2' in lv and 'vero-engine.js?v=p2r2' in lv and 'vero.js?v=p2r2' in lv and re.search(r'vero-engine\.js\?v=p2r[12]\b', rv) is not None and not re.search(r'\?v=p[13]\b', lv + ' ' + rv)),
          ('C5 config = live Phase 2 baseline: enabled, aiEnabled=true, webEnabled=true, live endpoint (local and live identical)', '"enabled":true' in lc and '"aiEnabled":true' in lc and '"webEnabled":true' in lc and '"aiEndpoint":"https://ugreen-vero.raffyortega-rojo.workers.dev"' in lc and lc == rc)]
for n, ok in checks: print(('PASS' if ok else 'FAIL') + ' - ' + n + ('' if ok else f'  -> {lv} | {rv} | {lc} | {le[:2]} {re_[:2]} {ln[:2]} {rn[:2]}'))
p = sum(same) + sum(ok for _, ok in checks); n = len(same) + len(checks)
print(f'\nPhase 1 browser regression: {p}/{n} ({sum(same)}/{len(Q)} answers OK: {len(Q)-len(P2R2_CHANGED)} identical-required + {len(P2R2_CHANGED)} p2r2 intended changes; {sum(ok for _, ok in checks)}/{len(checks)} checks)')
srv.shutdown(); sys.exit(0 if p == n else 1)
