"""VERO p2r3a browser acceptance (real UI, LOCAL build). Run: python3 -I tests/vero-p2r3a.playwright.py <repo root>
Covers the browser parts of A01–A28 and the real-usage conversations UA–UE:
  small talk in the drawer, follow-up continuity + "Using: …" line, Cat6 speed, topic switch, mixed greeting + product,
  facet chips are clickable, context cleared on mode change (public -> dealer) and after 15 min idle,
  zero Worker / OpenAI requests for every local question, no page errors from VERO,
  facts-index build + answer timing on desktop and with 4x CPU throttling (mid-range phone proxy).
Worker / OpenAI are blocked (requests counted, never sent)."""
import sys, re, json, threading, http.server, socketserver, functools
from playwright.sync_api import sync_playwright
ROOT = sys.argv[1]
class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = socketserver.TCPServer(('127.0.0.1', 0), functools.partial(H, directory=ROOT)); port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f'http://127.0.0.1:{port}/index.html'
res = []
def chk(n, ok, x=''):
    res.append(bool(ok)); print(('PASS' if ok else 'FAIL') + ' - ' + n + ('' if ok else f'  -> {str(x)[:400]}'))
LAST = "(()=>{const b=[...document.querySelectorAll('#vero-log .vero-msg.vero-bot')].pop(); if(!b) return null; const e=b.querySelector('.vero-echo');" \
       "return {text:b.innerText.replace(/\\s+/g,' ').trim(), echo:e?e.innerText.trim():null, cards:[...b.querySelectorAll('.vero-card')].map(c=>(c.querySelector('.vero-card-name')||c).innerText.trim()), chips:[...b.querySelectorAll('.vero-chip')].map(c=>c.innerText.trim())};})()"
TIMING = """(qs)=>{ const pool=ALL_PRODUCTS.filter(p=>!p.disabled); const t0=performance.now(); VeroFacts.build(pool,{force:true}); const cold=performance.now()-t0;
  const ts=[]; for(let i=0;i<60;i++){ const q=qs[i%qs.length]; const s=performance.now(); VeroEngine.answer(pool,q,{}); ts.push(performance.now()-s); }
  ts.sort((a,b)=>a-b); return {cold:Math.round(cold), median:+ts[30].toFixed(1), p95:+ts[57].toFixed(1), max:+ts[59].toFixed(1)}; }"""
TQ = ['65W charger', 'may 8K HDMI ba?', 'ano yung speed ng cat6 cable?', 'cheapest 20k power bank', 'magkano tinaas ng 90872B', 'hi', 'compare X755 and X772', 'hub with HDMI + Ethernet']
with sync_playwright() as pw:
    b = pw.chromium.launch()
    def page():
        pg = b.new_page(viewport={'width': 1280, 'height': 900}); st = {'err': [], 'net': []}
        pg.on('pageerror', lambda e: st['err'].append(str(e)))
        pg.on('console', lambda m: st['err'].append('console: ' + m.text) if m.type == 'warning' and 'VERO' in m.text else None)
        pg.route(re.compile(r'.*(ugreen-vero|openai).*'), lambda r, q: (st['net'].append(q.url), r.abort()))
        pg.goto(URL, wait_until='networkidle'); pg.wait_for_timeout(1000)
        pg.click('#vero-fab'); pg.wait_for_timeout(500)
        return pg, st
    def ask(pg, q, wait=450):
        pg.fill('#vero-input', q); pg.press('#vero-input', 'Enter'); pg.wait_for_timeout(wait); return pg.evaluate(LAST)
    pg, st = page()
    loaded = pg.evaluate("[...document.scripts].map(s=>s.src.split('/').pop()).filter(s=>/vero/.test(s))")
    chk('B00 page loads the Local Brain in order and VeroEngine reports p2r3a', [x.split('?')[0] for x in loaded] == ['vero-lexicon.js', 'vero-nlu.js', 'vero-facts.js', 'vero-plan.js', 'vero-compose.js', 'vero-engine.js', 'vero.js'] and pg.evaluate('VeroEngine.version') == 'p2r3a', loaded)
    # UA / A01 small talk
    small = ['hi', 'hello', 'can you help me?', 'can you really help me with my questions?', 'why is your name VERO?', 'who are you?', 'thank you']
    out = [ask(pg, q) for q in small]
    chk('UA/A01 small talk in the drawer: warm reply, no product cards, never "No products match"', all(o and not o['cards'] and 'No products match' not in o['text'] and len(o['text']) > 10 for o in out), [o['text'][:60] for o in out])
    chk('UA "why is your name VERO?" shows the approved wording', 'built to help you find the right product faster and answer product questions with confidence' in out[4]['text'], out[4]['text'])
    # UB / A03 follow-up continuity
    o1 = ask(pg, 'do we have a wall charger 160w?'); o2 = ask(pg, 'how about 140w?')
    chk('UB/A03 "how about 140w?" shows "Using: wall charger · 140W" and no cable cards', o2['echo'] == 'Using: wall charger · 140W' and not any(re.search(r'cable', c, re.I) for c in o2['cards']), o2)
    chk('A07-style zero result shows facet chips that are clickable', len(o2['chips']) > 0)
    pg.click('#vero-log .vero-msg.vero-bot:last-of-type .vero-chip'); pg.wait_for_timeout(450); o3 = pg.evaluate(LAST)
    chk('B01 clicking a facet chip asks that wattage (wall charger) and returns wall chargers', o3 and len(o3['cards']) > 0 and re.search(r'wall charger', o3['text'], re.I), o3 and o3['text'][:200])
    # UC / A18
    o = ask(pg, 'ano yung speed ng cat6 cable?')
    chk('UC/A18 Cat6 speed: one family (Cat6 LAN cables), speed summary, no "Using:" from the charger context', o['echo'] is None and re.search(r'Cat6 LAN cables', o['text']) and re.search(r'speed', o['text'], re.I) and all(re.search(r'cat\s?6(?![a-z0-9])', c, re.I) for c in o['cards']), o['text'][:200])
    # UD / A14
    d1 = ask(pg, '65W charger'); d2 = ask(pg, 'how about 100W?'); d3 = ask(pg, 'new question: HDMI cable 2m')
    chk('UD/A14 "how about 100W?" inherits charger; "new question: …" starts fresh', (d2['echo'] or '').startswith('Using: charger · 100W') and d3['echo'] is None and all(re.search(r'hdmi', c, re.I) for c in d3['cards']), [d2['echo'], d3['echo'], d3['text'][:80]])
    # UE / A02
    e = ask(pg, 'hi, may 65W charger?')
    chk('UE/A02 mixed greeting + product: product cards with a short greeting', e['text'].startswith('Hi!') and len(e['cards']) > 0, e['text'][:120])
    # A07 car charger
    c7 = ask(pg, 'may 65W car charger ba?')
    chk('A07 "may 65W car charger ba?" -> no product cards, "Wala…", car-charger wattage chips', not c7['cards'] and c7['text'].startswith('Wala') and len(c7['chips']) > 0, c7['text'][:160])
    # A20 stock caveat
    s = ask(pg, 'may stock ba ng 100W charger?')
    chk('A20 stock words show the stock caveat line', re.search(r'live inventory', s['text']), s['text'][-200:])
    # fix pack (held-out #1): rendered in the drawer
    x1 = ask(pg, 'ilan pa natitira sa PB552?')
    chk('FX1 inventory question renders "Naka-lista ang PB552…" + the live-inventory line, one card, no "1 na …" count', x1['text'].startswith('Naka-lista ang PB552') and 'live inventory' in x1['text'] and len(x1['cards']) == 1 and not re.match(r'^1 ', x1['text']), x1['text'][:220])
    x2 = ask(pg, 'may irerecommend ka for my client?')
    chk('FX2 vague client recommendation renders a local clarify with clickable product chips', len(x2['chips']) >= 4 and not x2['cards'] and re.search(r'client', x2['text']), x2)
    x3 = ask(pg, 'may 2.5 inch hdd enclosure tayo?'); x4 = ask(pg, 'alin dun yung type c?')
    chk('FX3 "alin dun yung type c?" refines the 2.5" enclosure list in the UI (echo shows 2.5", only USB-C cards)', x4['echo'] and '2.5"' in x4['echo'] and 0 < len(x4['cards']) < len(x3['cards']), [x4['echo'], len(x3['cards']), len(x4['cards'])])
    y1 = ask(pg, '55137 vs 75288'); y2 = ask(pg, 'e yung FitBuds magkano?')
    chk('FX5 after a comparison, "e yung FitBuds magkano?" shows FitBuds cards only (no old products)', len(y2['cards']) > 0 and all(re.search(r'FitBuds', c, re.I) for c in y2['cards']), y2)
    y3 = ask(pg, 'mini displayport to hdmi 4k')
    chk('FX6 Mini DP label renders ("Mini DisplayPort to HDMI"), never "undefined"', 'Mini DisplayPort to HDMI' in y3['text'] and 'undefined' not in y3['text'], y3['text'][:160])
    y4 = ask(pg, 'need ko ng phone holder sa kotse na magnetic')
    chk('FX7 magnetic car holders render as cards (no false "Wala")', len(y4['cards']) > 0 and not y4['text'].startswith('Wala'), y4['text'][:160])
    x5 = ask(pg, 'may keyboard kayo?')
    chk('FX4 zero result names the noun: "Wala tayong keyboard sa current UGREEN pricelist."', x5['text'].startswith('Wala tayong keyboard sa current UGREEN pricelist.') and not x5['cards'], x5['text'][:160])
    # A16 echo only when inherited
    f = ask(pg, 'cheapest power bank')
    chk('A16 a fresh question shows no "Using:" line', f['echo'] is None, f['echo'])
    # A17 mode change clears context
    ask(pg, '65W charger')
    pg.evaluate("window.DEALER_MODE={username:'qa-dealer',name:'QA'}")
    m = ask(pg, 'how about 100W?')
    pg.evaluate("window.DEALER_MODE=null")
    chk('A17a switching public -> dealer clears the conversation context (no "Using:" after the switch)', m['echo'] is None, m)
    # A17 idle > 15 min clears context
    ask(pg, '65W charger'); pg.evaluate("(()=>{ const o=Date.now.bind(Date); Date.now=()=>o()+16*60*1000; })()")
    i = ask(pg, 'how about 100W?')
    chk('A17b after 15 minutes idle the context is gone (no "Using:")', i['echo'] is None, i)
    # AI-routed questions in the public view: gate, no request
    g = ask(pg, 'MacBook Air dual display, ano pwede?', 700)
    chk('B02 public view: an AI/WEB-routed question shows the Sales AI gate and sends nothing', re.search(r'Sales AI Access|needs VERO AI', g['text']) is not None, g['text'][:160])
    chk('A22/B03 zero Worker / OpenAI requests during the whole local session', not st['net'], st['net'][:3])
    chk('B04 no page errors and no Local Brain fallback warnings', not st['err'], st['err'][:3])
    desk = pg.evaluate(TIMING, TQ)
    pg.close()
    # A28 throttled (4x CPU) — mid-range phone proxy
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    pm = ctx.new_page(); cdp = ctx.new_cdp_session(pm); cdp.send('Emulation.setCPUThrottlingRate', {'rate': 4})
    pm.route(re.compile(r'.*(ugreen-vero|openai).*'), lambda r, q: r.abort())
    pm.goto(URL, wait_until='networkidle'); pm.wait_for_timeout(1500)
    mob = pm.evaluate(TIMING, TQ)
    ctx.close(); b.close()
srv.shutdown()
print('timing desktop:', desk, '| throttled 4x:', mob)
chk(f'A28 desktop: facts cold build < 400 ms ({desk["cold"]} ms), answer p95 < 50 ms ({desk["p95"]} ms)', desk['cold'] < 400 and desk['p95'] < 50)
chk(f'A28 4x CPU throttle: facts cold build < 1500 ms ({mob["cold"]} ms), answer p95 < 150 ms ({mob["p95"]} ms)', mob['cold'] < 1500 and mob['p95'] < 150)
print(f'\nVERO p2r3a browser acceptance: {sum(res)}/{len(res)} passed')
sys.exit(0 if all(res) else 1)
