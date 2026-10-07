"""VERO Local Brain shadow check (Foundation Step 1). Run: python3 tests/vero-facts-shadow.playwright.py <repo root>
Shadow check: load the LOCAL build, then (re-)inject vero-lexicon.js + vero-facts.js by hand. Since p2r3a index.html loads them itself.
Measures in-browser facts build time and confirms VERO answers are identical before/after injection. Worker/OpenAI blocked."""
import sys, re, json, threading, http.server, socketserver, functools
from playwright.sync_api import sync_playwright
ROOT = sys.argv[1]
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = socketserver.TCPServer(('127.0.0.1', 0), functools.partial(Q, directory=ROOT)); port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
QS = json.load(open(ROOT + '/tests/vero-sales-questions.json'))['questions']
with sync_playwright() as pw:
    b = pw.chromium.launch(); pg = b.new_page(); errs = []; reqs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route(re.compile(r'.*(ugreen-vero|openai).*'), lambda r, q: (reqs.append(q.url), r.abort()))
    pg.goto(f'http://127.0.0.1:{port}/index.html', wait_until='networkidle'); pg.wait_for_timeout(1200)
    loaded = pg.evaluate("[...document.scripts].map(s=>s.src.split('/').pop()).filter(s=>/vero/.test(s))")
    pre = pg.evaluate("""(qs)=>{ const all=ALL_PRODUCTS.filter(p=>!p.disabled); return qs.map(q=>{ const r=VeroEngine.answer(all,q,{}); const a=VeroEngine.aiRoute(all,q,r,{}); return JSON.stringify([r.type,r.codes,r.note,a.route,a.candidates]); }); }""", [q['question'] for q in QS])
    present = pg.evaluate("[typeof VeroLexicon, typeof VeroFacts]")
    pg.add_script_tag(url='js/vero-lexicon.js'); pg.add_script_tag(url='js/vero-facts.js'); pg.wait_for_timeout(300)
    t = pg.evaluate("""()=>{ const out=[]; for(let i=0;i<5;i++){ const t0=performance.now(); VeroFacts.build(ALL_PRODUCTS,{force:true}); out.push(Math.round(performance.now()-t0)); }
       const t1=performance.now(); const idx=VeroFacts.build(ALL_PRODUCTS); const memo=performance.now()-t1; return {runs:out, memo:Math.round(memo*10)/10, stats:idx.stats}; }""")
    post = pg.evaluate("""(qs)=>{ const all=ALL_PRODUCTS.filter(p=>!p.disabled); return qs.map(q=>{ const r=VeroEngine.answer(all,q,{}); const a=VeroEngine.aiRoute(all,q,r,{}); return JSON.stringify([r.type,r.codes,r.note,a.route,a.candidates]); }); }""", [q['question'] for q in QS])
    b.close()
srv.shutdown()
same = sum(1 for a, c in zip(pre, post) if a == c)
print('scripts loaded by index.html:', loaded)
print('VeroLexicon/VeroFacts before injection:', present)
print('browser facts build ms (5 cold runs):', t['runs'], 'memo ms:', t['memo'], 'stats:', {k: t['stats'][k] for k in ('total', 'classified', 'other', 'conflicting')})
print(f'answers identical before/after facts build: {same}/{len(pre)}')
print('page errors:', errs, '| worker/openai requests:', len(reqs))
# p2r3a: index.html now loads vero-lexicon.js + vero-facts.js itself (Local Brain switch-over); re-injecting them must not change any answer
ok = same == len(pre) and not errs and not reqs and present == ['object', 'object'] and any('lexicon' in s for s in loaded) and any('facts' in s for s in loaded)
print('SHADOW CHECK:', 'PASS' if ok else 'FAIL')
