"""VERO browser regression: same VERO questions on the LOCAL build vs the LIVE production site, asked in ONE conversation (so follow-up
context is exercised exactly as a user would hit it).
Baseline (updated for p2r3a): live = p2r2.1 (vero-engine/nlu ?v=p2r2.1, vero.js ?v=p2r2). The local build loads the Local Brain
(lexicon -> nlu -> facts -> plan -> compose -> engine -> vero.js, ?v=p2r3a; vero-nlu stays ?v=p2r2.1).
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
# p2r3a: intentional, reviewed answer changes vs live p2r2.1 (Local Brain switch-over). Each must match its pattern on the LOCAL build.
P2R3A_CHANGED = {
    '65W charger': r'^6 65W chargers:',                                          # was "6 products found" (same 6 SKUs)
    'usb c cable 2m': r'^\d+ 2m USB-C cables:',                                 # USB-C must be in the product name (was a loose 45-item text match)
    'power bank 20000mAh': r'^13 20,000mAh power banks:',                        # same 13, labelled
    'hdmi cable': r'^\d+ HDMI cables:',                                         # HDMI cables only (adapters/switchers no longer counted)
    'car charger': r'^\d+ car chargers:',                                       # car-charger category only (no car mounts / accessories)
    'magnetic power bank': r'^18 magnetic power banks:',                         # same 18, labelled
    'type c to lightning': r'^8 USB-C to Lightning charging cables:',            # pair must be in the name (was 34 loose matches)
    'compare 20503 vs AV102': r'^Model AV102 has 7 SKUs\. Tap Compare',          # same guidance; card list differs
    'AV104 or AV108': r'^8 SKUs for AV104 and AV108:',                           # both models listed (was AV104 only)
    'travel charger': r'^1 travel charger:',                                     # no "Ask VERO AI" offer on a plain catalog lookup
    'something for my desk setup': r'^Which product type do you mean\?',         # clarify instead of an AI call with no product intent
    'best gift for a gamer': r'^Happy to help — which product type or SKU',      # clarify instead of an AI call with no product intent
    'may 100W charger ba kayo': r'^Meron — 4 na 100W chargers sa current pricelist:',   # Taglish reply to a Taglish question
    'pang laptop na charger': r'^38 na chargers \(Hindi ko ma-confirm ang compatibility sa laptop',  # local list (>=45W first) + caveat + AI offer, not the AI gate
    'meron ba kayong hdmi cable': r'^Meron — \d+ na HDMI cables sa current pricelist:',  # HDMI cables directly (no section chooser)
    'hello': r'^Hi! I’m VERO, your UGREEN Product & Sales Assistant',            # small talk (was "No products match")
    'help': r'^Yes, I can help!',                                                # small talk (was 2 random products)
    'asdfqwer': r'^Which product type do you mean\?',                            # clarify (was "No products match")
    'new arrivals': r'^Which product type do you mean\?',                        # clarify (was "No products match")
    'docking station': r'^35 docking stations:',                                 # docking-station category only (strict)
    'earbuds': r'^32 earbuds:',                                                  # wireless earbuds only (not every audio product)
    'mouse': r'^22 mice:',                                                       # same 22, labelled
    'usb c to usb c cable': r'^65 USB-C to USB-C charging cables:',              # pair in the name (was a 184-item section chooser)
    'wireless charger': r'^11 wireless chargers:',                               # same 11, labelled
    'gan charger 100w': r'^4 100W GaN chargers:',                                # same 4
}
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
CHANGED = dict(P2R2_CHANGED); CHANGED.update(P2R3A_CHANGED)
same = [(re.search(CHANGED[q], a) is not None) if q in CHANGED else (a == b) for q, a, b in zip(Q, lo, ro)]
for i, (q, ok) in enumerate(zip(Q, same)):
    tag = ' [p2r3a intended change]' if q in P2R3A_CHANGED else (' [p2r2 intended change]' if q in P2R2_CHANGED else '')
    print(('PASS' if ok else 'FAIL') + f' - R{i+1:02d} {q[:60]!r}{tag}' + ('' if ok else f'\n   local: {lo[i][:200]}\n   live : {ro[i][:200]}'))
checks = [('C1 all answers non-empty', all(lo) and all(ro)),
          ('C2 no page errors (local + live)', not le and not re_), ('C3 no AI/Worker/OpenAI requests (local + live)', not ln and not rn),
          ('C4 local loads the Local Brain ?v=p2r3a in order (lexicon, nlu p2r2.1, facts, plan, compose, engine, vero.js); live loads p2r2.1 assets; no p1/p3 tags', all(x in lv for x in ['vero-lexicon.js?v=p2r3a', 'vero-nlu.js?v=p2r2.1', 'vero-facts.js?v=p2r3a', 'vero-plan.js?v=p2r3a.1', 'vero-compose.js?v=p2r3a.1', 'vero-engine.js?v=p2r3a', 'vero.js?v=p2r3a']) and [lv.find(x) for x in ['vero-lexicon', 'vero-nlu', 'vero-facts', 'vero-plan', 'vero-compose', 'vero-engine', 'vero.js']] == sorted(lv.find(x) for x in ['vero-lexicon', 'vero-nlu', 'vero-facts', 'vero-plan', 'vero-compose', 'vero-engine', 'vero.js']) and re.search(r'vero-engine\.js\?v=p2r', rv) is not None and not re.search(r'\?v=p[13]\b', lv + ' ' + rv)),
          ('C5 config = live Phase 2 baseline: enabled, aiEnabled=true, webEnabled=true, live endpoint (local and live identical)', '"enabled":true' in lc and '"aiEnabled":true' in lc and '"webEnabled":true' in lc and '"aiEndpoint":"https://ugreen-vero.raffyortega-rojo.workers.dev"' in lc and lc == rc)]
for n, ok in checks: print(('PASS' if ok else 'FAIL') + ' - ' + n + ('' if ok else f'  -> {lv} | {rv} | {lc} | {le[:2]} {re_[:2]} {ln[:2]} {rn[:2]}'))
p = sum(same) + sum(ok for _, ok in checks); n = len(same) + len(checks)
print(f'\nPhase 1 browser regression: {p}/{n} ({sum(same)}/{len(Q)} answers OK: {len(Q)-len(CHANGED)} identical-required + {len(CHANGED)} reviewed intended changes ({len(P2R3A_CHANGED)} p2r3a); {sum(ok for _, ok in checks)}/{len(checks)} checks)')
srv.shutdown(); sys.exit(0 if p == n else 1)
