"""Phase 1 browser regression: same local VERO questions on the LOCAL Phase 2 build (AI off) vs the LIVE Phase 1 site.
Every answer must be identical. Usage: python3 -I p1_regression.py <repo_root>"""
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
same = [a == b for a, b in zip(lo, ro)]
for i, (q, ok) in enumerate(zip(Q, same)):
    print(('PASS' if ok else 'FAIL') + f' - R{i+1:02d} {q[:60]!r}' + ('' if ok else f'\n   local: {lo[i][:200]}\n   live : {ro[i][:200]}'))
checks = [('C1 all answers non-empty', all(lo) and all(ro)),
          ('C2 no page errors (local + live)', not le and not re_), ('C3 no AI/Worker/OpenAI requests (local + live)', not ln and not rn),
          ('C4 local loads Phase 2 assets (?v=p2), live loads Phase 1 (?v=p1)', 'v=p2' in lv and 'v=p1' in rv and 'v=p1' not in lv),
          ('C5 local config: aiEnabled=false, webEnabled=false', '"aiEnabled":false' in lc and '"webEnabled":false' in lc)]
for n, ok in checks: print(('PASS' if ok else 'FAIL') + ' - ' + n + ('' if ok else f'  -> {lv} | {rv} | {lc} | {le[:2]} {re_[:2]} {ln[:2]} {rn[:2]}'))
p = sum(same) + sum(ok for _, ok in checks); n = len(same) + len(checks)
print(f'\nPhase 1 browser regression: {p}/{n} ({sum(same)} identical answers of {len(Q)} + {sum(ok for _, ok in checks)}/{len(checks)} checks)')
srv.shutdown(); sys.exit(0 if p == n else 1)
