"""VERO Phase 2 UI tests (end-to-end, no real AI, no network to Anthropic).

Starts the REAL backend/vero/worker.js inside Node behind a local HTTP server, with:
  - D1 = in-memory SQLite running migrations/0001_init.sql
  - Anthropic = scripted fake (keyword-driven)
  - catalog = this repo's data/products.json
Serves the site from the repo root and overrides config.js so aiEnabled/webEnabled are on and
aiEndpoint points at the local Worker. Production config stays aiEnabled:false / webEnabled:false.

Run from repo root:  python3 tests/vero-ai.playwright.py   (needs node >= 22, playwright)
"""
import json, os, re, subprocess, sys, time, threading, http.server, socketserver, functools
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SITE_PORT, W1, W2 = 8795, 8797, 8798          # site, worker (AI on), worker (AI_ENABLED=false)
SITE = f'http://localhost:{SITE_PORT}/'
SHOTS = os.environ.get('VERO_SHOTS', '/tmp/vero-ai-shots'); os.makedirs(SHOTS, exist_ok=True)
REQLOG = '/tmp/vero_ai_reqs.jsonl'

SERVER_JS = r"""
import http from 'node:http';
import { readFileSync, appendFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
const ROOT = process.env.ROOT;
const worker = (await import(ROOT + '/backend/vero/worker.js')).default;
const { newCode, insertSql } = await import(ROOT + '/tools/vero-code.mjs');
const SCHEMA = readFileSync(ROOT + '/backend/vero/migrations/0001_init.sql', 'utf8') + '\n' + readFileSync(ROOT + '/backend/vero/migrations/0002_product_text_cache.sql', 'utf8');
const PRODUCTS = readFileSync(ROOT + '/data/products.json', 'utf8');
class Stmt { constructor(db, sql, p) { this.db = db; this.sql = sql; this.p = p || []; }
  bind(...a) { return new Stmt(this.db, this.sql, a.map(v => v === undefined ? null : v)); }
  _all() { return this.db.prepare(this.sql).all(...this.p); }
  async first(c) { const r = this._all(); return r.length ? (c ? r[0][c] : r[0]) : null; }
  async all() { return { results: this._all() }; } async run() { this.db.prepare(this.sql).run(...this.p); return { success: true }; } }
class D1 { constructor() { this.db = new DatabaseSync(':memory:'); this.db.exec(SCHEMA); } prepare(s) { return new Stmt(this.db, s); }
  async batch(st) { this.db.exec('BEGIN'); try { const o = st.map(s => ({ results: s._all() })); this.db.exec('COMMIT'); return o; } catch (e) { this.db.exec('ROLLBACK'); throw e; } } }
const SAMSUNG = 'https://www.samsung.com/ph/support/mobile-devices/galaxy-s27-charging/';
const delay = (ms, sig) => new Promise((res, rej) => { const t = setTimeout(res, ms); sig && sig.addEventListener('abort', () => { clearTimeout(t); rej(new Error('abort')); }); });
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  url = String(url);
  if (url.endsWith('/data/products.json')) return new Response(PRODUCTS, { headers: { etag: 'W/"local"' } });
  if (url === 'https://openai.fake/v1/responses') {          // fake OpenAI Responses API (production provider)
    const b = JSON.parse(init.body); const txt = String(b.input || '');
    appendFileSync(process.env.REQLOG, JSON.stringify({ to: 'openai', research: !!b.tools, auth: (init.headers || {}).authorization ? 'bearer' : 'none', body: b }) + '\n');
    const q = (txt.match(/QUESTION: ([^\n]*)/) || [])[1] || '';
    const usage = (i, o) => ({ input_tokens: i, input_tokens_details: { cached_tokens: 0 }, output_tokens: o, output_tokens_details: { reasoning_tokens: Math.floor(o / 3) } });
    const msg = (text, annotations) => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text, annotations: annotations || [] }] });
    if (b.tools) {
      if (/slow/i.test(q)) await delay(30000, init.signal);
      if (/error/i.test(q)) return new Response(JSON.stringify({ error: { type: 'server_error', message: 'The server is overloaded.' } }), { status: 503 });
      if (/ios 27/i.test(q)) return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'web_search_call', status: 'completed', action: { type: 'search', query: 'iOS 27 USB-C charging', sources: [] } }, msg('No official information found.')], usage: usage(6000, 60) }));
      const finding = '- Galaxy S27 supports USB PD PPS Super Fast Charging up to 45W.';
      const cited = 'Super Fast Charging 2.0 (up to 45W) using a USB PD PPS charger';
      const text = finding + ' ' + cited;
      return new Response(JSON.stringify({ status: 'completed', output: [
        { type: 'reasoning', summary: [] },
        { type: 'web_search_call', status: 'completed', action: { type: 'search', query: 'Galaxy S27 charging standard', sources: [{ type: 'url', url: SAMSUNG }, { type: 'url', url: 'https://www.reddit.com/r/x' }] } },
        msg(text, [{ type: 'url_citation', url: SAMSUNG, title: 'Galaxy S27 - Charging and power support', start_index: finding.length + 1, end_index: text.length }])],
        usage: usage(14000, 300) }));
    }
    if (/slowcat/i.test(q)) await delay(30000, init.signal);
    const web = /EVIDENCE/.test(txt);
    const reply = /xss/i.test(q) ? 'Try P1 <img src=x onerror="window.__xss=1"> it is fine.'
      : /price/i.test(q) ? 'P1 is the better buy at ₱1,299 — see https://shop.example.com/deal. P2 is bulkier.'
      : web ? 'Based on the current official device information, P1 supports the Galaxy S27 fast-charging standard (USB PD PPS). Confirm before quoting if the setup is critical.'
      : 'P1 is the better travel pick: it is the most compact of these and still powers a laptop. P2 is a good backup if the customer needs more ports.';
    const out = { reply, picks: [{ ref: 'P1', reason: web ? 'Supports USB PD PPS used by the Galaxy S27.' : 'Most compact; enough for a laptop.', basis: web ? 'web_verified' : 'product_data' },
      { ref: 'P2', reason: 'More ports for multiple devices.', basis: 'general_guidance' }, { ref: 'P8', reason: 'not a candidate', basis: 'product_data' }],
      confidence: /low/i.test(q) ? 'low' : 'high', cannot_confirm: web ? ['Exact charging speed with the customer\u2019s cable'] : [], conflicts: [], language: /pwede|ba |ko\b/i.test(q) ? 'taglish' : 'en', sources: web ? [{ ref: 'S1', supports: 'PPS 45W' }] : [] };
    return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'reasoning', summary: [] }, msg(JSON.stringify(out))], usage: usage(3600, 380) }));
  }
  return realFetch(url, init);
};
const ROLES = { c_sales01: 'sales', c_sales02: 'sales', c_sales03: 'sales', c_sales04: 'sales', c_admin01: 'admin', c_admin02: 'admin', c_dealer01: 'dealer' };
const CODES = Object.fromEntries(Object.keys(ROLES).map(id => [id, newCode()]));
function startServer(port, over) {
  const env = Object.assign({ DB: new D1(), AI_ENABLED: 'true', WEB_ENABLED: 'true', TOKEN_SIGNING_KEY: 'ui-test-signing-key-0123456789abcdef', IP_HASH_SALT: 's',
    PROVIDER: 'openai', MODEL: 'gpt-6-luna', REASONING_EFFORT: 'low', OPENAI_API_KEY: 'fake-openai', OPENAI_BASE_URL: 'https://openai.fake', ALLOW_ORIGIN: process.env.ORIGIN, WEB_TIMEOUT_MS: '1500', TIMEOUT_MS: '1500', IP_PER_MIN: '1000', IP_PER_DAY: '1000' }, over);
  for (const [id, code] of Object.entries(CODES)) env.DB.db.exec(insertSql({ id, role: ROLES[id] }, code));
  const codes = CODES;
  http.createServer(async (req, res) => {
    const chunks = []; for await (const ch of req) chunks.push(ch);
    const body = Buffer.concat(chunks);
    if (req.method === 'POST') appendFileSync(process.env.REQLOG, JSON.stringify({ to: 'worker', port, path: req.url, body: body.toString() }) + '\n');
    const r = await worker.fetch(new Request('http://localhost:' + port + req.url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body }), env, { waitUntil: () => {} });
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
  }).listen(port);
  return codes;
}
const codes = startServer(Number(process.env.W1), {});
startServer(Number(process.env.W2), { AI_ENABLED: 'false' });
console.log('CODES ' + JSON.stringify(codes));
"""

results = []
def chk(n, ok, extra=''):
    results.append((n, bool(ok), str(extra)[:300])); print(('PASS' if ok else 'FAIL') + ' - ' + n + ('' if ok else ' -> ' + str(extra)[:300]))

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
def serve_site():
    h = functools.partial(Quiet, directory=ROOT)
    socketserver.TCPServer.allow_reuse_address = True
    srv = socketserver.ThreadingTCPServer(('127.0.0.1', SITE_PORT), h); threading.Thread(target=srv.serve_forever, daemon=True).start(); return srv

def reqlog():
    try: return [json.loads(l) for l in open(REQLOG)]
    except FileNotFoundError: return []

def main():
    open(REQLOG, 'w').close()
    open('/tmp/vero_ai_server.mjs', 'w').write(SERVER_JS)
    env = dict(os.environ, ROOT=ROOT, REQLOG=REQLOG, ORIGIN=f'http://localhost:{SITE_PORT}', W1=str(W1), W2=str(W2))
    node = subprocess.Popen(['node', '--no-warnings', '/tmp/vero_ai_server.mjs'], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    line = ''
    for _ in range(100):
        line = node.stdout.readline()
        if line.startswith('CODES '): break
    codes = json.loads(line[6:])
    site = serve_site()
    cfg_src = open(os.path.join(ROOT, 'config.js')).read()
    def cfg(port, web=True):
        s = cfg_src.replace('aiEnabled: false', 'aiEnabled: true').replace("aiEndpoint: ''", f"aiEndpoint: 'http://localhost:{port}'")
        return s.replace('webEnabled: false', 'webEnabled: ' + ('true' if web else 'false'))

    def page_for(br, port=W1, web=True, mobile=False):
        ctx = br.new_context(**({'viewport': {'width': 390, 'height': 844}, 'device_scale_factor': 2, 'is_mobile': True, 'has_touch': True} if mobile else {'viewport': {'width': 1440, 'height': 900}, 'device_scale_factor': 2}))
        pg = ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.route('**/config.js*', lambda route: route.fulfill(status=200, content_type='application/javascript', body=cfg(port, web)))
        pg.goto(SITE, wait_until='domcontentloaded')
        pg.wait_for_function("typeof ALL_PRODUCTS!=='undefined'&&ALL_PRODUCTS.length>500", timeout=60000)
        pg.wait_for_timeout(700)
        return ctx, pg, errs

    def ask(pg, q, wait=1200):
        pg.fill('#vero-input', q); pg.press('#vero-input', 'Enter'); pg.wait_for_timeout(wait)
    def last(pg, sel='.vero-msg.vero-bot'):
        return pg.evaluate(f"(()=>{{const b=[...document.querySelectorAll('#vero-log {sel}')].pop();return b?b.innerText:''}})()")
    def asks(): return [r for r in reqlog() if r['to'] == 'worker' and r['path'] == '/ask']
    def unlock(pg, code):
        if pg.locator('#vero-log [data-unlock]').count() == 0 and pg.locator('#vero-log [data-act="gateopen"]').count():
            pg.locator('#vero-log [data-act="gateopen"]').last.click(); pg.wait_for_timeout(150)
        pg.locator('[data-unlock]').last.fill(code); pg.locator('[data-act="unlock"]').last.click(); pg.wait_for_timeout(1500)

    with sync_playwright() as p:
        br = p.chromium.launch()
        ctx, pg, errs = page_for(br)
        pg.click('#vero-fab'); pg.wait_for_timeout(300)
        # ---- local-only queries never call the AI Worker and never offer "Ask VERO AI"
        code = pg.evaluate("String(ALL_PRODUCTS.find(p=>!p.disabled&&p.dp_volume&&p.moq&&ALL_PRODUCTS.filter(x=>x.model===p.model).length===1).item_code)")
        model = pg.evaluate(f"ALL_PRODUCTS.find(p=>String(p.item_code)==='{code}').model")
        multi = pg.evaluate("(()=>{const P=ALL_PRODUCTS.filter(p=>!p.disabled);const c={};P.forEach(p=>c[p.model]=(c[p.model]||0)+1);const m=Object.keys(c).find(k=>c[k]>=4&&/\\d/.test(k));return P.filter(p=>p.model===m).slice(0,3).map(p=>String(p.item_code))})()")
        local_qs = [code, model, 'srp of ' + code, 'dp ' + code, 'dp vol ' + code, 'moq of ' + code, 'power bank under \u20b12,000', '65W charger', 'hdmi 2m', 'card reader', '20000mAh power bank', 'compare ' + ' and '.join(multi[:2]), ' vs '.join(multi), 'cable']
        n0 = len(reqlog())
        offers = 0
        for q in local_qs:
            ask(pg, q, 250)
            offers += pg.evaluate("[...document.querySelectorAll('#vero-log .vero-msg.vero-bot')].pop().querySelectorAll('.vero-askai').length")
        chk('A1 LOCAL route: 14 exact/price/filter/category/compare queries make ZERO AI requests', len(reqlog()) == n0, reqlog()[n0:])
        chk('A1b no "Ask VERO AI" chip on lookups, prices, MOQ, pure filters, compare-by-code', offers == 0, offers)

        # ---- public user (no code): AI-type question -> local results + unlock row, no /ask call
        ask(pg, 'best charger for a laptop and phone', 900)
        t = last(pg)
        chk('A2 public user: AI-type question -> local results + explanatory VERO AI message, no AI request',
            'This question needs VERO AI. AI access is currently available to authorized sales users.' in t and pg.locator('#vero-log .vero-card').count() > 0 and len(asks()) == 0, t[:200])
        chk('A2a access-code field hidden initially; small "Sales AI Access" action shown',
            pg.locator('#vero-log [data-unlock]').count() == 0 and pg.locator('#vero-log [data-act="gateopen"]').count() == 1 and 'Sales AI Access' in pg.locator('#vero-log [data-act="gateopen"]').inner_text())
        chk('A2c no "locked/restricted"/auth wording shown to users', not re.search(r'locked|restricted|unauthori|authenticat|token', pg.inner_text('#vero-log'), re.I))
        pg.locator('#vero-log .vero-ai').last.scroll_into_view_if_needed(); pg.wait_for_timeout(150)
        pg.screenshot(path=SHOTS + '/01_public_ai_prompt.png')
        pg.locator('#vero-log [data-act="gateopen"]').click(); pg.wait_for_timeout(250)
        chk('A2d clicking "Sales AI Access" reveals the compact code field + "Enter your VERO access code."',
            pg.locator('#vero-log [data-unlock]').count() == 1 and 'Enter your VERO access code.' in last(pg) and pg.evaluate("document.activeElement && document.activeElement.hasAttribute('data-unlock')"))
        pg.screenshot(path=SHOTS + '/02_access_code_entry.png')
        unlock(pg, 'VERO-0000-0000-0000-0000')
        chk('A2b invalid code -> "Invalid or inactive VERO access code."', 'Invalid or inactive VERO access code.' in last(pg) and len(asks()) == 0, last(pg))
        pg.screenshot(path=SHOTS + '/02b_invalid_code.png')
        unlock(pg, codes['c_sales01']); pg.wait_for_timeout(1200)
        t = last(pg)
        chk('A3 valid code unlocks and answers (catalog route)', 'Based on UGREEN Pricelist data' in t and 'AI' in t and len(asks()) == 1, t[:200])
        n_cards = pg.evaluate("[...document.querySelectorAll('#vero-log .vero-ai')].pop().querySelectorAll('.vero-card').length"); n_c = len(json.loads(asks()[-1]['body'])['candidates'])
        chk('A3b AI picks rendered as live cards (only candidates; out-of-range P8 dropped)', n_cards == 2 or (n_c == 8 and n_cards == 3), (n_cards, n_c))
        price_ok = pg.evaluate("""(()=>{const b=[...document.querySelectorAll('#vero-log .vero-ai')].pop();const f=n=>'\\u20B1'+Number(n).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
          return [...b.querySelectorAll('.vero-card')].every(c=>{const p=ALL_PRODUCTS.find(x=>String(x.item_code)===c.dataset.code);return c.innerText.includes(f(p.srp))&&c.innerText.includes(f(p.dp));});})()""")
        chk('A3c card prices equal live pricelist data', price_ok)
        chk('A3d basis tags shown (From pricelist data / General guidance)', 'from pricelist data' in t.lower() and 'general guidance' in t.lower(), t)
        chk('A3e footer shows "VERO AI on · Sign out"', 'VERO AI on' in pg.inner_text('#vero-disc'))
        body = json.loads(asks()[-1]['body'])
        chk('A4 request body keys are exactly v,q,candidates,history,route,trigger (no prices/dealer data)', sorted(body.keys()) == ['candidates', 'history', 'q', 'route', 'trigger', 'v'] and 2 <= len(body['candidates']) <= 8 and not re.search(r'srp|dp_vol|special|moq|\u20b1', json.dumps(body), re.I), body)
        lastp = [x for x in reqlog() if x['to'] == 'openai'][-1]; b = lastp['body']
        chk('A4b OpenAI request: Responses API, gpt-6-luna, strict JSON schema, low reasoning, no tools, no price/MOQ data, Bearer key',
            not b.get('tools') and b['model'] == 'gpt-6-luna' and b['text']['format']['type'] == 'json_schema' and b['text']['format']['strict'] is True and b['reasoning']['effort'] == 'low' and b['store'] is False and lastp['auth'] == 'bearer'
            and not re.search(r'srp|dp_volume|moq|\u20b1', b['input'], re.I), b)
        chk('A3f AI answer labelled "VERO AI"', 'VERO AI' in pg.evaluate("[...document.querySelectorAll('#vero-log .vero-ai .vero-ai-badge')].pop().innerText"))
        pg.locator('#vero-log .vero-ai').last.scroll_into_view_if_needed(); pg.wait_for_timeout(200)
        pg.screenshot(path=SHOTS + '/03_unlocked_sales_catalog_ai.png')

        # ---- price/URL stripping + XSS
        ask(pg, 'best charger for travel price', 1500)
        t = pg.evaluate("[...document.querySelectorAll('#vero-log .vero-ai .vero-ai-reply')].pop().innerText")
        chk('A5 AI-quoted price and URL removed from reply (prices only on cards)', '\u20b1' not in t and 'http' not in t and '1,299' not in t, t)
        ask(pg, 'best charger for travel xss', 1500)
        chk('A5b AI text rendered as plain text (no injected HTML)', pg.evaluate("!window.__xss && ![...document.querySelectorAll('#vero-log .vero-ai-reply img')].length"))

        # ---- web route
        ask(pg, 'is the 65W charger compatible with Galaxy S27?', 300)
        pg.screenshot(path=SHOTS + '/04_web_checking_state.png')
        pg.wait_for_timeout(1600)
        t = last(pg)
        srcs = pg.evaluate("[...[...document.querySelectorAll('#vero-log .vero-ai')].pop().querySelectorAll('.vero-sources a')].map(a=>[a.href,a.target,a.rel,a.innerText])")
        chk('A6 web route answer: "Verified with official sources" + Sources list', 'Verified with official sources' in t and 'sources' in t.lower() and len(srcs) == 1, t[:200])
        chk('A6b sources are validated official links only (samsung.com; reddit dropped), open safely', srcs and srcs[0][0].startswith('https://www.samsung.com/') and srcs[0][1] == '_blank' and 'noopener' in srcs[0][2], srcs)
        chk('A6c web-verified pick labelled "Official source"; cannot-confirm note shown', 'official source' in t.lower() and 'Couldn\u2019t confirm' in t, t)
        rq = [x for x in reqlog() if x['to'] == 'openai' and x['research']][-1]['body']
        chk('A6d research call: OpenAI web_search, max 1 tool call, official allowlist filter, no prices',
            rq['tools'][0]['type'] == 'web_search' and rq['max_tool_calls'] == 1 and 'samsung.com' in rq['tools'][0]['filters']['allowed_domains'] and not re.search(r'\u20b1|srp|moq', rq['input'], re.I))
        pg.locator('#vero-log .vero-ai').last.scroll_into_view_if_needed(); pg.wait_for_timeout(200)
        pg.screenshot(path=SHOTS + '/05_web_ai_answer_sources.png')
        box = pg.locator('#vero-log .vero-ai').last.bounding_box()
        pg.screenshot(path=SHOTS + '/06_sources_list_closeup.png', clip={'x': box['x'] - 6, 'y': box['y'] - 6, 'width': box['width'] + 12, 'height': min(box['height'] + 12, 860)})

        # ---- web failures
        ctx1, pg1, _ = page_for(br)
        pg1.click('#vero-fab'); pg1.wait_for_timeout(200)
        ask(pg1, 'best charger for travel', 900); unlock(pg1, codes['c_sales03'])
        ask(pg1, 'is the 65W charger compatible with iOS 27?', 1800)
        t = last(pg1)
        chk('A7 no official source -> neutral "couldn\u2019t verify" message, no guessed answer', 'couldn\u2019t verify the external compatibility details' in t and 'Verified' not in t, t)
        pg1.screenshot(path=SHOTS + '/07_no_official_source.png'); ctx1.close()
        ctx2, pg2, _ = page_for(br)
        pg2.evaluate("sessionStorage.setItem('vero_ai_session', JSON.stringify({token:'x',exp:0}))")
        pg2.click('#vero-fab'); pg2.wait_for_timeout(200)
        ask(pg2, 'best charger for travel', 900); unlock(pg2, codes['c_sales02'])
        ask(pg2, 'is the 65W charger compatible with Galaxy S27 slow?', 2600)
        t = last(pg2)
        chk('A8 web research timeout -> "couldn\u2019t verify" + Retry; local results still visible', 'couldn\u2019t verify' in t and pg2.locator('#vero-log .vero-retry').count() >= 1 and pg2.locator('#vero-log .vero-card').count() > 0, t)
        pg2.screenshot(path=SHOTS + '/08_web_timeout_retry.png')
        ctx2.close()
        ctx2, pg2, _ = page_for(br)
        pg2.click('#vero-fab'); pg2.wait_for_timeout(200)
        ask(pg2, 'best charger for travel', 900); unlock(pg2, codes['c_sales04'])
        ask(pg2, 'is the 65W charger compatible with Galaxy S27 error?', 2500)
        t = last(pg2)
        chk('A9 provider error on research -> "couldn\u2019t verify" + Retry (no guess)', 'couldn\u2019t verify' in t and pg2.locator('#vero-log .vero-retry').count() >= 1, t)
        ctx2.close()

        # ---- rate limit (4/min per code)
        ctx3, pg3, _ = page_for(br)
        pg3.click('#vero-fab'); pg3.wait_for_timeout(200)
        ask(pg3, 'best charger for travel A', 900); unlock(pg3, codes['c_admin01'])
        for qq in ['best power bank for travel B', 'best hub for travel C', 'best cable for travel D', 'best charger for office E',
                   'best power bank for office F', 'best hub for office G', 'best cable for office H', 'best charger for home I']:
            ask(pg3, qq, 1100)
        t = pg3.inner_text('#vero-log')
        chk('A10 per-code rate limit (4/min) -> friendly limit message', 'reached the VERO AI limit' in t, t[-300:])
        pg3.screenshot(path=SHOTS + '/09_rate_limited.png')
        pg3.locator('[data-act="aisignout"]').click(); pg3.wait_for_timeout(200)
        chk('A11 Sign out clears AI session', 'VERO AI on' not in pg3.inner_text('#vero-disc') and pg3.evaluate("sessionStorage.getItem('vero_ai_session')") is None)
        ctx3.close()

        # ---- "Ask VERO AI" manual escalation
        ctx4, pg4, _ = page_for(br)
        pg4.click('#vero-fab'); pg4.wait_for_timeout(200)
        n0 = len(asks())
        ask(pg4, 'usb c hub for travel', 400)
        chip = pg4.locator('#vero-log .vero-askai')
        chk('A12 "Ask VERO AI" offered on a descriptive local answer, no auto AI call', chip.count() == 1 and len(asks()) == n0)
        pg4.screenshot(path=SHOTS + '/10_ask_vero_ai_chip.png')
        chip.click(); pg4.wait_for_timeout(400)
        chk('A12b chip -> explanatory message for a public user (code field still hidden)', pg4.locator('#vero-log [data-unlock]').count() == 0 and 'This question needs VERO AI' in last(pg4))
        ctx4.close()

        # ---- dealer mode: AI off for dealers in the pilot
        ctx5, pg5, _ = page_for(br)
        dsk = pg5.evaluate("ALL_PRODUCTS.filter(p=>!p.disabled&&p.sheet_display==='Mobile: Charger').slice(0,4).map(p=>String(p.item_code))")
        pg5.evaluate(f"enterDealerMode({{name:'Test Dealer',username:'t',discountPct:20,skus:{json.dumps(dsk)}}},true)"); pg5.wait_for_timeout(300)
        pg5.click('#vero-fab'); pg5.wait_for_timeout(200)
        n0 = len(reqlog())
        ask(pg5, 'best charger for a laptop and phone', 900)
        t = last(pg5)
        chk('A13 dealer mode: no AI controls (no message, no "Sales AI Access", no code field), no requests, local answer + "coming soon"',
            pg5.locator('#vero-log [data-unlock]').count() == 0 and pg5.locator('#vero-log [data-act="gateopen"]').count() == 0 and 'needs VERO AI' not in t and len(reqlog()) == n0 and 'coming soon' in t, t[:160])
        ctx5.close()

        # ---- webEnabled false (frontend) -> web question gets the neutral message, no request
        ctx6, pg6, _ = page_for(br, web=False)
        pg6.click('#vero-fab'); pg6.wait_for_timeout(200)
        ask(pg6, 'best charger for travel', 900); unlock(pg6, codes['c_sales01'])
        n0 = len(asks())
        ask(pg6, 'is the 65W charger compatible with Galaxy S28?', 700)
        t = last(pg6)
        chk('A14 webEnabled=false -> "External verification is unavailable right now." and no request', 'External verification is unavailable right now.' in t and len(asks()) == n0, t)
        pg6.screenshot(path=SHOTS + '/11_external_verification_unavailable.png')
        ctx6.close()

        # ---- Worker kill switch (AI_ENABLED=false) -> AI unavailable, local intact
        ctx7, pg7, _ = page_for(br, port=W2)
        pg7.evaluate("sessionStorage.removeItem('vero_ai_session')")
        pg7.click('#vero-fab'); pg7.wait_for_timeout(200)
        ask(pg7, 'best charger for travel', 900); unlock(pg7, codes['c_sales01'])
        t = last(pg7)
        chk('A15 AI unavailable (Worker AI_ENABLED=false) -> "VERO AI is temporarily unavailable. Local product search is still available." + local results stay',
            'VERO AI is temporarily unavailable. Local product search is still available.' in t and pg7.locator('#vero-log .vero-card').count() > 0, t)
        pg7.screenshot(path=SHOTS + '/14_ai_unavailable.png')
        n_before = len(reqlog())
        ask(pg7, 'srp of ' + code, 300)
        chk('A15b local VERO keeps working while AI is unavailable (no AI request)', 'SRP' in last(pg7) and len(reqlog()) == n_before)
        ctx7.close()

        # ---- expired / revoked session -> back to the access step with the expiry message
        ctx8, pg8, _ = page_for(br)
        pg8.evaluate("sessionStorage.setItem('vero_ai_session', JSON.stringify({token:'expired.or.revoked', role:'sales', exp: Date.now()+3600000, web:true}))")
        pg8.click('#vero-fab'); pg8.wait_for_timeout(200)
        chk('A18 (pre) footer shows the saved session', 'VERO AI on' in pg8.inner_text('#vero-disc'))
        ask(pg8, 'best charger for travel', 1500)
        t = last(pg8)
        chk('A18 expired/revoked session -> "Your VERO AI session has expired. Enter your access code again." with the code field open',
            'Your VERO AI session has expired. Enter your access code again.' in t and pg8.locator('#vero-log [data-unlock]').count() == 1 and pg8.evaluate("sessionStorage.getItem('vero_ai_session')") is None and 'VERO AI on' not in pg8.inner_text('#vero-disc'), t)
        pg8.screenshot(path=SHOTS + '/15_session_expired.png')
        unlock(pg8, codes['c_sales02'])
        chk('A18b re-entering a valid code resumes the same question', 'Based on UGREEN Pricelist data' in last(pg8))
        ctx8.close()

        # ---- mobile
        ctxm, pgm, _ = page_for(br, mobile=True)
        pgm.tap('#vero-fab'); pgm.wait_for_timeout(300)
        ask(pgm, 'best charger for travel', 900); unlock(pgm, codes['c_admin02']); pgm.wait_for_timeout(600)
        pgm.locator('#vero-log .vero-ai').last.scroll_into_view_if_needed(); pgm.wait_for_timeout(200)
        pgm.screenshot(path=SHOTS + '/12_mobile_catalog_ai.png')
        ask(pgm, 'is the 65W charger compatible with Galaxy S29?', 1800)
        pgm.locator('#vero-log .vero-ai').last.scroll_into_view_if_needed(); pgm.wait_for_timeout(200)
        pgm.screenshot(path=SHOTS + '/13_mobile_web_ai_sources.png')
        chk('A16 mobile: AI answers render in the full-screen chat', pgm.locator('#vero-log .vero-ai .vero-ai-meta').count() >= 2)
        ctxm.close()
        chk('A17 no page errors during AI flows', not errs, errs)
        ctx.close(); br.close()
    node.terminate(); site.shutdown()
    fails = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(fails)} passed, {len(fails)} failed")
    json.dump(results, open('/tmp/vero_ai_results.json', 'w'))
    sys.exit(1 if fails else 0)

if __name__ == '__main__':
    main()
