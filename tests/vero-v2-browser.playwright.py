"""VERO v2-1 accountable parse — browser SHADOW check. Run: python3 -I tests/vero-v2-browser.playwright.py <repo root>
1. Opens the REAL index.html (Local Brain p2r3a as shipped) and confirms window.VeroParse / VeroOntology are NOT loaded.
2. Captures the live engine answers for the 144 benchmark questions, then injects vero-ontology.js + vero-parse.js,
   builds the v2 catalog graph and runs v2 on all 144 questions (desktop, then with 4x CPU throttling as a mid-range
   phone proxy), and confirms the engine answers are byte-identical afterwards (shadow purity) with no page errors.
Worker / OpenAI requests are blocked and counted (must stay 0)."""
import sys, json, threading, http.server, socketserver, functools
from playwright.sync_api import sync_playwright
ROOT = sys.argv[1]
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = socketserver.TCPServer(('127.0.0.1', 0), functools.partial(Q, directory=ROOT)); port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
QS = [q['question'] for q in json.load(open(ROOT + '/tests/vero-sales-questions.json'))['questions']]
res = []
def chk(n, ok, x=''):
    res.append(bool(ok)); print(('PASS' if ok else 'FAIL') + ' - ' + n + ('' if ok else f'  -> {str(x)[:400]}'))
RUN = """(qs)=>{ const t0=performance.now(); const idx=VeroFacts.build(PUBX,{force:true}); const fb=performance.now()-t0;
  VeroParse.resetCache(); const t1=performance.now(); VeroParse.catalog(idx,PUBX); const cb=performance.now()-t1;
  const ts=[]; let silent=0; qs.forEach(q=>{ const t=performance.now(); const P=VeroParse.run(q,{facts:idx,products:PUBX}); ts.push(performance.now()-t); silent+=P.ledger.silentDrops.length; });
  ts.sort((a,b)=>a-b); return { factsMs:Math.round(fb), catalogMs:Math.round(cb), median:+ts[Math.floor(ts.length/2)].toFixed(2), p95:+ts[Math.floor(ts.length*0.95)].toFixed(2), max:+ts[ts.length-1].toFixed(2), silent }; }"""
with sync_playwright() as pw:
    b = pw.chromium.launch(); ctx = b.new_context(); pg = ctx.new_page(); errs = []; blocked = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    ctx.route('**/*workers.dev/**', lambda r: ((blocked.append(r.request.url) if 'ugreen-vero' in r.request.url else None), r.abort()))
    ctx.route('**/api.openai.com/**', lambda r: (blocked.append(r.request.url), r.abort()))
    pg.goto(f'http://127.0.0.1:{port}/index.html'); pg.wait_for_function('window.VeroEngine && window.VeroFacts && window.VeroPlan', timeout=60000)
    loaded = pg.evaluate("({ parse: typeof window.VeroParse, ont: typeof window.VeroOntology, scripts: [...document.scripts].map(s=>s.src).filter(s=>/vero/.test(s)) })")
    chk('B01 live index.html does NOT load vero-parse.js / vero-ontology.js (shadow only)', loaded['parse'] == 'undefined' and loaded['ont'] == 'undefined' and not any('vero-parse' in s or 'vero-ontology' in s for s in loaded['scripts']), loaded)
    pg.evaluate("fetch('data/products.json').then(r=>r.json()).then(a=>{ pcResolveSchedule(a); window.PUBX=a.filter(p=>!p.disabled); })"); pg.wait_for_function('window.PUBX')
    sig = "(qs)=>qs.map(q=>{ const r=VeroEngine.answer(PUBX,q,{}); const a=VeroEngine.aiRoute(PUBX,q,r,{}); return JSON.stringify([r.type,r.codes,r.note,r.echo||null,a.route,a.candidates]); })"
    pre = pg.evaluate(sig, QS)
    for f in ['js/vero-ontology.js', 'js/vero-parse.js']: pg.add_script_tag(url=f'/{f}')
    desk = pg.evaluate(RUN, QS)
    cdp = ctx.new_cdp_session(pg); cdp.send('Emulation.setCPUThrottlingRate', {'rate': 4})
    slow = pg.evaluate(RUN, QS)
    cdp.send('Emulation.setCPUThrottlingRate', {'rate': 1})
    post = pg.evaluate(sig, QS)
    b.close()
srv.shutdown()
same = sum(1 for a, c in zip(pre, post) if a == c)
print('desktop:', desk); print('4x throttle:', slow)
chk(f'B02 engine answers identical before/after v2 injection ({same}/{len(pre)})', same == len(pre))
chk('B03 zero silent span drops in the browser run', desk['silent'] == 0 and slow['silent'] == 0)
chk('B04 desktop: v2 catalog build <= 400 ms, turn p95 <= 15 ms', desk['catalogMs'] <= 400 and desk['p95'] <= 15, desk)
chk('B05 4x CPU throttle: v2 catalog build <= 1500 ms, turn p95 <= 50 ms', slow['catalogMs'] <= 1500 and slow['p95'] <= 50, slow)
chk('B06 no page errors and zero VERO Worker / OpenAI requests (all workers.dev traffic blocked)', not errs and not blocked, (errs, blocked))
print(f'VERO v2-1 browser shadow: {sum(res)}/{len(res)} passed')
sys.exit(0 if all(res) else 1)
