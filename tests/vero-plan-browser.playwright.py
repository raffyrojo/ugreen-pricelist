"""VERO Local Brain QueryPlan browser check (shadow step qp1). Run: python3 tests/vero-plan-browser.playwright.py <repo root>
Loads helpers + vero-nlu + vero-engine as browser globals, captures 144 engine answers, then injects vero-lexicon + vero-facts + vero-plan,
builds 144 plans, and confirms engine answers are identical. index.html is not used or changed."""
import sys, json, threading, http.server, socketserver, functools
from playwright.sync_api import sync_playwright
ROOT=sys.argv[1]
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*a): pass
srv=socketserver.TCPServer(('127.0.0.1',0),functools.partial(Q,directory=ROOT)); port=srv.server_address[1]
threading.Thread(target=srv.serve_forever,daemon=True).start()
QS=[q['question'] for q in json.load(open(ROOT+'/tests/vero-sales-questions.json'))['questions']]
with sync_playwright() as pw:
    b=pw.chromium.launch(); pg=b.new_page(); errs=[]
    pg.on('pageerror',lambda e: errs.append(str(e)))
    pg.set_content('<html><body></body></html>'); pg.goto(f'http://127.0.0.1:{port}/tests/')
    pg.evaluate("window.PRICE_SETTINGS={indicatorDays:30}")
    for f in ['js/helpers.js','js/vero-nlu.js','js/vero-engine.js']: pg.add_script_tag(url=f'/{f}')
    pg.evaluate("fetch('/data/products.json').then(r=>r.json()).then(a=>{ window.ALL=a; pcResolveSchedule(a); window.PUBX=a.filter(p=>!p.disabled); })"); pg.wait_for_function("window.PUBX")
    sig="(qs)=>qs.map(q=>{ const r=VeroEngine.answer(PUBX,q,{}); const a=VeroEngine.aiRoute(PUBX,q,r,{}); return JSON.stringify([r.type,r.codes,r.note,a.route,a.candidates]); })"
    pre=pg.evaluate(sig,QS)
    for f in ['js/vero-lexicon.js','js/vero-facts.js','js/vero-plan.js']: pg.add_script_tag(url=f'/{f}')
    out=pg.evaluate("""(qs)=>{ const t0=performance.now(); const idx=VeroFacts.build(PUBX,{force:true}); const fb=performance.now()-t0;
       const ts=[], routes={}; let ctx=null; qs.forEach(q=>{ const t=performance.now(); const p=VeroPlan.build(q,{products:PUBX,facts:idx}); ts.push(performance.now()-t); routes[p.route.route]=(routes[p.route.route]||0)+1; });
       ts.sort((a,b)=>a-b); return { factsMs:Math.round(fb), median:+ts[Math.floor(ts.length/2)].toFixed(2), p95:+ts[Math.floor(ts.length*0.95)].toFixed(2), routes }; }""",QS)
    post=pg.evaluate(sig,QS)
    b.close()
srv.shutdown()
same=sum(1 for a,c in zip(pre,post) if a==c)
print('browser:',out,'| answers identical before/after plan build:',f'{same}/{len(pre)}','| page errors:',errs)
print('BROWSER PLAN CHECK:','PASS' if same==len(pre) and not errs else 'FAIL')
