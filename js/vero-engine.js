/* VERO — local lookup engine (Phase 1; p2r1 adds local ranking / superlatives; p2r2 adds the local intent + attribute layer via js/vero-nlu.js;
   p2r2.1 = P0 correctness fixes: '20k power bank' capacity shorthand, connector-in-name for cable ranking, MagSafe vs magnetic;
   p2r3a = Local Brain switch-over: when VeroCompose (+ VeroPlan, VeroFacts, VeroLexicon) is loaded, answer() and aiRoute() use the
   QueryPlan path; the p2r2.1 path below stays as the per-question fallback and for price history, section chips and the compare tray).
   Pure logic: no DOM, no network, no AI. Works in the browser (window.VeroEngine)
   and in Node (module.exports) for tests.
   Every answer returns item_codes only; the UI reads prices from the live
   product objects at render time, so prices always come from the pricelist. */
(function(root){
  'use strict';
  /* p2r2: local intent + attribute layer (js/vero-nlu.js). Optional — the engine works without it. */
  var NLU_MOD=null;
  if(!root.VeroNLU && typeof require==='function'){ try{ NLU_MOD=require('./vero-nlu.js'); }catch(e){ NLU_MOD=null; } }
  function nlu(){ return root.VeroNLU || NLU_MOD; }

  /* ---------- text helpers ---------- */
  function lc(s){ return String(s==null?'':s).toLowerCase(); }
  function words(s){ return lc(s).replace(/[^a-z0-9.]+/g,' ').split(' ').filter(Boolean); }
  function stem(w){ return (w.length>4 && /s$/.test(w) && !/ss$/.test(w)) ? w.slice(0,-1) : w; }

  var STOP = {};
  ('a an the of for to with and or in on at by is are be me my i you it this that these those '+
   'what whats how much many show find give get need want looking look please pls can could '+
   'do does any some all list item items product products ugreen sku model price prices srp dp '+
   'vol volume dpv moq mcq minimum order dealer retail cost costs magkano presyo yung ung ng na '+
   'po ba lang mga sa ang compare vs versus difference between which one better best under below '+
   'above over less more than up max min maximum at least budget hanggang around about only with '+
   'php peso pesos k there have has is a').split(' ').forEach(function(w){ STOP[w]=1; });

  /* Synonym groups: any word in a group also matches the group's other spellings. */
  var SYN = [
    ['usbc','usb-c','type-c','typec','type c','usb c','c'],
    ['usba','usb-a','usb a'],
    ['powerbank','power bank'],
    ['lan','ethernet','rj45','network'],
    ['hub','dock','docking','multiport','multiport adapter'],
    ['earbud','earbuds','earphone','earphones','headphone','headset','tws'],
    ['aux','3.5mm'],
    ['displayport','display port'],
    ['switcher','switch','kvm'],
    ['enclosure','case'],
    ['ssd','nvme','m.2'],
    ['reader','card reader'],
    ['grey','gray'],
    ['charger','adapter charger','wall charger']
  ];
  var SYN_MAP = {};
  SYN.forEach(function(g){ g.forEach(function(w){ SYN_MAP[w.replace(/[\s-]+/g,'')]=g.map(function(x){return x.replace(/[\s-]+/g,'');}); }); });

  /* Query words -> pricelist sections (sheet_display). Used for ranking + clarify chips. */
  var CAT_HINTS = {
    charger:['Mobile: Charger','Mobile: Car Charger and Accessories'],
    powerbank:['Mobile: Power Bank'],
    hub:['Transmission: Docking and Hub'],
    mouse:['Transmission: Mouse and Keyboard'], keyboard:['Transmission: Mouse and Keyboard'],
    earbud:['Transmission: Bluetooth and Earphone'], earphone:['Transmission: Bluetooth and Earphone'], bluetooth:['Transmission: Bluetooth and Earphone'],
    lan:['Transmission: Lan Cable and Accessories','Transmission: Ethernet Adapter'],
    hdmi:['A&V: Video Cable','A&V: Video Adapter and Extender','A&V: Splitter and Switcher'],
    enclosure:['Flash: Hard Drive Enclosure'], nas:['NAS Storage'], reader:['Transmission: Card Reader'],
    holder:['Mobile: Holder'], car:['Mobile: Car Charger and Accessories']
  };

  /* ---------- number helpers ---------- */
  function num(s){ var n=parseFloat(String(s).replace(/,/g,'')); return isNaN(n)?null:n; }
  function lenMeters(str){
    if(str==null||str==='') return null;
    var m=String(str).trim().toUpperCase().match(/^([\d.]+)\s*(M|CM|MM)?$/);
    if(!m) return null; var n=parseFloat(m[1]);
    return m[2]==='CM'?n/100:(m[2]==='MM'?n/1000:n);
  }
  function productWatts(p){
    var all=String(p.product_name||'').match(/(\d{2,3}(?:\.\d)?)\s?W\b/gi); if(!all) return null;
    return Math.max.apply(null, all.map(function(x){ return parseFloat(x); }));
  }
  function productMah(p){
    var m=String(p.product_name||'').match(/(\d{4,5})\s?mAh/i); return m?parseInt(m[1],10):null;
  }
  /* p2r1: output-port count for ranking filters. Only for wall/car chargers, only from explicit
     naming ("4-Port", "single-port", "2C2A", "4C+1A", "1*USB-A+4*USB-C", "USB-A+USB-C", "1C").
     Anything else (wireless pads, chargers with cables/built-ins, power banks, hubs) -> null = unknown. */
  /* p2r1: structured product type first (section / category), name as fallback.
     Chargers = the "Mobile: Charger" section (wall/desk, wireless, travel adapter) + category "Car Charger".
     Power banks = category "Power Bank". Car items = the car section or "car" in the name. */
  function isCharger(p){ return p.sheet_display==='Mobile: Charger' || p.category==='Car Charger'; }
  function isCarItem(p){ return /\bcar\b/i.test(String(p.sheet_display||'')) || /\bcar\b/i.test(String(p.product_name||'')); }
  var TYPE_CLASS={ charger:isCharger, powerbank:function(p){ return p.category==='Power Bank' || p.sheet_display==='Mobile: Power Bank'; } };
  function productPorts(p){
    var name=String(p.product_name||'');
    if(!isCharger(p)) return null;
    if(p.category==='Wireless Charger' || /wireless|cable|built[\s-]?in/i.test(name)) return null;
    var m;
    if(/single[\s-]?port/i.test(name)) return 1;
    if((m=name.match(/\b(\d)[\s-]?ports?\b/i))) return parseInt(m[1],10);
    if(/\b(?:dual|triple|quad|set)\b/i.test(name)) return null;      /* "Dual USB-A", "Charger Set" (bundled cable): not countable reliably */
    if((m=name.match(/\b(\d)\s*C\s*\+?\s*(\d)\s*A\b/i))) return parseInt(m[1],10)+parseInt(m[2],10);
    if((m=name.match(/\b(\d)\s*A\s*\+?\s*(\d)\s*C\b/i))) return parseInt(m[1],10)+parseInt(m[2],10);
    var n=0, hit=false;
    name.replace(/(?:\b(\d)\s*[*x×]\s*)?USB[\s-]?(?:A|C)\b(?:\s*[*x×]\s*(\d))?/gi,function(mm,k1,k2){ hit=true; n+=k1?parseInt(k1,10):(k2?parseInt(k2,10):1); return mm; });
    if(hit) return n;
    if((m=name.match(/\b(\d)C\b/))) return parseInt(m[1],10);
    return null;
  }

  var MAXW = /(?:under|below|less than|lower than|max(?:imum)?|up to|hanggang|wala pang|<=?|not more than)\s*$/;
  var MINW = /(?:above|over|more than|higher than|at least|min(?:imum)?|>=?|starting|from)\s*$/;
  /* p2r2.1: explicit PRICE cues that make a following "Nk" a peso amount even in a capacity context:
     ₱/budget/price words and budget-direction comparators. Minimum-direction words ("at least", "minimum",
     "above", "more than") are NOT price cues on their own — "power bank at least 20k" = ≥20,000mAh;
     "power bank at least ₱20k" = ≥₱20,000 (the ₱ is the cue). */
  var K_PRICE_BEFORE = /(?:₱|budget(?:\s+(?:of|is|ko|ng))?|under|below|less than|lower than|cheaper than|up to|max(?:imum)?|hanggang|wala pang|within|not more than|price|presyo|srp|dp|magkano|worth|cost|costs)\s*$/;

  /* ---------- p2r1: ranking / superlative intent (local only) ---------- */
  /* stock = clear inventory intent only. Bare "available" (= in the pricelist) is NOT stock. */
  var STOCK_SRC='\\b(?:in[\\s-]?stocks?|on[\\s-]?hand|available\\s+(?:stocks?|inventory|units?|qty|quantity)|stocks?\\s+(?:available|left|on\\s?hand)|meron\\s+pang?\\s+stocks?|may\\s+stocks?|meron\\s+pa|inventory|stocks?)\\b';
  var STOCK_RE=new RegExp(STOCK_SRC), STOCK_RE_G=new RegExp(STOCK_SRC,'g');
  var STOCK_NOTE='I can only see the current pricelist, not live inventory, so I can’t confirm stock. Please check availability before quoting.';
  /* current-pricelist filler; runs AFTER the stock check, so "available stock" is still caught as stock */
  var FILLER_RE=/\b(?:right\s+now|do\s+we\s+have|do\s+you\s+have|we\s+have|we\s+got|currently|current|now|available)\b/g;
  var PRICE_FIELD_AHEAD='(?=\\s+(?:srp|dp|dpv|special\\s?dp|dealer\\s?price|retail\\s?price)\\b)';
  var RANK_RULES=[
    { dim:'price', dir:'max', word:'Most expensive', re:new RegExp('\\b(?:most\\s+expensive|priciest|pinakamahal\\w*|highest[\\s-]+price[ds]?|highest'+PRICE_FIELD_AHEAD+')') },
    { dim:'price', dir:'min', word:'Cheapest', re:new RegExp('\\b(?:cheapest|least\\s+expensive|pinakamura\\w*|lowest[\\s-]+(?:price[ds]?|cost)|lowest'+PRICE_FIELD_AHEAD+')') },
    { dim:'length', dir:'max', word:'Longest', re:/\b(?:longest|pinakamahaba\w*)\b/ },
    { dim:'length', dir:'min', word:'Shortest', re:/\b(?:shortest|pinakamaikli\w*)\b/ },
    { dim:'watts', dir:'max', word:'Highest-wattage', re:/\b(?:(?:highest|biggest|largest|most)\s+(?:wattage|watts?|power\s+output)|most\s+powerful|strongest)\b/ },
    { dim:'watts', dir:'min', word:'Lowest-wattage', re:/\b(?:(?:lowest|smallest|least)\s+(?:wattage|watts?|power\s+output)|least\s+powerful)\b/ },
    { dim:'mah', dir:'max', word:'Biggest-capacity', re:/\b(?:(?:biggest|highest|largest|most)\s+(?:capacity|mah))\b/ },
    { dim:'mah', dir:'min', word:'Smallest-capacity', re:/\b(?:(?:smallest|lowest|least)\s+(?:capacity|mah))\b/ }
  ];
  var NUMW={ two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10 };
  /* "with 3 ports" = exactly 3; "3+ / at least 3 / 3 or more ports" = 3 or more */
  var PORT_RULES=[
    { op:'min', re:/\b(?:at\s+least|minimum(?:\s+of)?|min\.?)\s*(\d{1,2})\s*-?\s*ports?\b/ },
    { op:'min', re:/\b(\d{1,2})\s*(?:\+|or\s+more|or\s+above|and\s+(?:up|above))\s*-?\s*ports?\b/ },
    { op:'min', re:/\b(\d{1,2})\s*-?\s*ports?\s*(?:or\s+more|or\s+above|and\s+(?:up|above)|\+)/ },
    { op:'eq', v:1, re:/\b(?:with\s+)?(?:a\s+)?single[\s-]?port\b/ },
    { op:'eq', re:/\b(?:with\s+)?(?:exactly\s+|only\s+)?(\d{1,2})\s*-?\s*ports?\b/ }
  ];
  var RANK_CAP=10, RANK_NEXT=2;
  var CONN_NAME={ usbc:/\b(?:usb[\s-]?c|type[\s-]?c)\b/i, lightning:/\blightning\b/i };   /* p2r2.1 */

  /* ---------- query parsing ---------- */
  function parse(q){
    var raw=String(q||'');
    var s=lc(raw).replace(/₱|\bphp\b|\bpesos?\b/g,' ₱ ').replace(/(\d),(\d{3})/g,'$1$2');
    /* p2r2.1: "Nk" = N thousand (decimals allowed: "1.5k" = 1,500). In a capacity context (power bank / mAh / capacity /
       battery) a 5k–60k value is mAh unless an explicit price cue is attached: ₱/budget/price words or a budget-direction
       comparator before it (under, below, less than, cheaper than, up to, hanggang …), or ₱/php/pesos/budget after it.
       "20k power bank" / "power bank at least 20k" = mAh; "under 2k", "budget 20k", "at least ₱20k", "2k pesos" = ₱. */
    var capCtx=/power\s?bank|powerbank|\bmah\b|\bcapacity\b|\bbattery\b/.test(s);
    s=s.replace(/(\d+(?:\.\d+)?)\s?k\b(\s?mah\b)?/g,function(all,n,mah,off,str){
      var v=Math.round(parseFloat(n)*1000);
      if(mah) return v+mah;
      var pre=str.slice(Math.max(0,off-24),off).replace(/\b(?:lowest|highest|cheapest|best)\s+(?:price|presyo)\s*$/,' ');   /* "lowest price 20k power bank" = ranking word, not a budget */
      if(capCtx && v>=5000 && v<=60000 && !K_PRICE_BEFORE.test(pre) &&
         !/^\s*(?:₱|(?:php|pesos?|budget)\b)/.test(str.slice(off+all.length,off+all.length+12))) return v+'mah';
      return String(v);
    });
    var P={ raw:raw, norm:s, asks:{}, compare:false, recommend:false, codes:[], content:[] };

    /* code-like tokens (item code / UPC / material / model): >=4 alphanumerics with a digit,
       excluding spec values (65w, 20000mah, 1.5m, 2k) and bare 4-digit numbers (prices). */
    lc(raw).split(/[^a-z0-9]+/).filter(Boolean).forEach(function(t){
      if(t.length<4 || !/\d/.test(t)) return;
      if(/^\d+(w|watts?|mah|m|cm|mm|k|in1|ports?|p|hz|gb|tb)$/.test(t)) return;
      if(/^\d{1,4}$/.test(t)) return;
      if(/^\d+$/.test(t) && new RegExp('(under|below|less than|lower than|up to|max(imum)?|hanggang|budget|within|above|over|more than|at least|min(imum)?|between|\u20B1|php)\\s*\u20B1?\\s*'+t+'\\b').test(lc(raw).replace(/(\\d),(\\d{3})/g,'$1$2'))) return;  /* a budget, not a code */
      if(P.codes.indexOf(t)<0) P.codes.push(t);
    });
    P.codes.forEach(function(t){ s=s.replace(new RegExp('\\b'+t+'\\b','g'),' '); });

    /* p2r1: stock words (VERO has no inventory data -> flag, never imply availability),
       current-pricelist filler, and ranking / superlative intent. */
    if(STOCK_RE.test(s)){ P.stock=true; s=s.replace(STOCK_RE_G,' '); }
    s=s.replace(FILLER_RE,' ');
    for(var ri=0; ri<RANK_RULES.length && !P.rank; ri++){
      var rr=RANK_RULES[ri], mm=rr.re.exec(s);
      if(!mm) continue;
      P.rank={ dim:rr.dim, dir:rr.dir, n:null, word:rr.word };
      var before=s.slice(0,mm.index), after=s.slice(mm.index+mm[0].length);
      var tn=before.match(/(?:\btop\s*)?\b(\d{1,2}|two|three|four|five|six|seven|eight|nine|ten)\s*$/);
      if(tn){ P.rank.n=Math.max(1,Math.min(10, NUMW[tn[1]]||parseInt(tn[1],10))); before=before.slice(0,tn.index); }
      before=before.replace(/\btop\s*$/,' ');
      s=before+' '+after;
    }
    if(!P.rank && /\b(biggest|largest|pinakamalaki\w*)\b/.test(s) && /\bpower\s?bank|\bpowerbank/.test(s)){
      P.rank={ dim:'mah', dir:'max', n:null, word:'Biggest-capacity' }; s=s.replace(/\b(biggest|largest|pinakamalaki\w*)\b/,' ');
    }
    if(P.rank){
      for(var pi=0; pi<PORT_RULES.length && !P.ports; pi++){
        var pr=PORT_RULES[pi], pm=pr.re.exec(s);
        if(pm){ P.ports={ v:pr.v!=null?pr.v:parseInt(pm[1],10), op:pr.op }; s=s.replace(pr.re,' '); }
      }
    }

    /* field asks (vol before dp: "dp vol" must not read as plain DP) */
    if(/\b(dp\s?vol(ume)?|dpv|vol(ume)?\s?(dp|price)|volume)\b/.test(s)) P.asks.dpv=true;
    var sNoVol=s.replace(/\b(dp\s?vol(ume)?|dpv|vol(ume)?\s?(dp|price))\b/g,' ');
    if(/\b(dp|dealer\s?price|dealer)\b/.test(sNoVol)) P.asks.dp=true;
    if(/\b(srp|retail)\b/.test(s)) P.asks.srp=true;
    if(/\b(moq|mcq|minimum\s?(order|qty|quantity))\b/.test(s)) P.asks.moq=true;
    if(/\b(price|prices|presyo|magkano|how much|cost)\b/.test(s)) P.asks.price=true;

    P.compare=/\b(compare|comparison|vs\.?|versus|difference|ikumpara)\b/.test(s);
    P.recommend=/\b(recommend|suggest|best|better|good for|ideal|which (one|is)|compatible|compatibility|work with|works with|support|for my|para sa|pang|bagay)\b/.test(s);

    /* numeric specs (consume them so they don't become price numbers) */
    var specMask=s;
    function rangeOf(prefix){ return MAXW.test(prefix)?'max':(MINW.test(prefix)?'min':'eq'); }
    s.replace(/(\d+(?:\.\d+)?)\s?w(?:att|atts)?\b/g,function(m,n,off){ P.watts={v:num(n),op:rangeOf(s.slice(Math.max(0,off-18),off))}; return m; });
    s.replace(/(\d{3,6})\s?mah\b/g,function(m,n,off){ P.mah={v:num(n),op:rangeOf(s.slice(Math.max(0,off-18),off))}; return m; });
    s.replace(/(\d+(?:\.\d+)?)\s?(m|meters?|metro|cm|mm)\b/g,function(m,n,u,off){
      var v=num(n); if(u==='cm')v=v/100; else if(u==='mm')v=v/1000;
      P.lengthM={v:v,op:rangeOf(s.slice(Math.max(0,off-18),off))}; return m; });
    specMask=s.replace(/\d+(?:\.\d+)?\s?(w(?:att|atts)?|mah|m|meters?|metro|cm|mm|in\s?1|ports?)\b/g,' ');

    /* price bounds: "under 1500", "₱500 to ₱1000", "500-1000 pesos", "budget 2000" */
    var hasPeso=/₱/.test(raw.replace(/php|peso/gi,'₱'))||/₱/.test(s);
    var rng=specMask.match(/₱?\s*(\d{2,6})\s*(?:-|to|hanggang)\s*₱?\s*(\d{2,6})/);
    if(rng && (hasPeso||P.asks.price||P.asks.srp||P.asks.dp||P.asks.dpv||/between/.test(s))){
      P.priceMin=num(rng[1]); P.priceMax=num(rng[2]);
    } else {
      specMask.replace(/(under|below|less than|lower than|up to|max(?:imum)?|hanggang|wala pang|budget(?: of| is)?|within|above|over|more than|at least|min(?:imum)?)\s*₱?\s*(\d{2,6})(?!\d)/g,function(m,w,n){
        if(/above|over|more than|at least|min/.test(w)) P.priceMin=num(n); else P.priceMax=num(n); return m; });
    }
    if(P.priceMin!=null||P.priceMax!=null){
      P.priceField=P.asks.dpv?'dp_volume':(P.asks.dp?'dp':'srp');
    }
    /* price ranking: SRP by default; DP / DP Vol only when asked (dealer mode: dp is Special DP) */
    if(P.rank && P.rank.dim==='price'){ P.rank.field=P.asks.dpv?'dp_volume':(P.asks.dp?'dp':'srp'); P.priceField=P.rank.field; }


    /* content words for text ranking */
    var cleaned=specMask.replace(/₱?\s*\d{2,6}(?!\w)/g,' ');
    cleaned=cleaned.replace(/type[\s-]?c|usb[\s-]?c/g,' usbc ').replace(/usb[\s-]?a/g,' usba ').replace(/power\s?bank/g,' powerbank ').replace(/display\s?port/g,' displayport ').replace(/3\.5\s?mm/g,' 3.5mm ').replace(/card\s?reader/g,' reader ');
    words(cleaned).forEach(function(w){
      if(STOP[w]) return; if(/^\d+$/.test(w)) return;
      if(P.codes.indexOf(w)>=0) return;
      w=stem(w); if(w.length<2) return;
      if(P.content.indexOf(w)<0) P.content.push(w);
    });
    /* device context ("for my MacBook Air M2"): not product vocabulary. Phase 1 can't judge
       compatibility, so drop device words from ranking and flag the question for AI later. */
    var dm=P.norm.match(DEVICE_RE);
    if(dm){
      P.device=dm[0].trim(); P.recommend=true;
      var drop={}; words(P.device).forEach(function(w){ drop[stem(w)]=1; drop[w]=1; });
      P.content=P.content.filter(function(w){ return !drop[w]; });
    }
    if(P.rank){
      var dmm=P.device?raw.match(new RegExp(DEVICE_RE.source,'i')):(raw.match(RE_DEVICE_MODEL)||raw.match(RE_DEVICE));
      if(!P.device){
        var cls=null; String(P.norm).split(/[^a-z0-9]+/).some(function(w){ if(DEV_CLASS[w]){ cls=w; return true; } return false; });
        if(dmm) P.device=lc(dmm[0]).trim(); else if(cls) P.device=cls;
      }
      if(P.device){
        P.deviceLabel=dmm?dmm[0].replace(/\s+/g,' ').trim():P.device;
        var drop2={}; words(P.device).forEach(function(w){ drop2[stem(w)]=1; drop2[w]=1; });
        P.content=P.content.filter(function(w){ return !drop2[w]; });
      }
    }
    return P;
  }

  var DEVICE_RE=/\b(macbook|mac ?mini|imac|laptop|notebook|iphone|ipad|samsung|galaxy|pixel|xiaomi|redmi|oppo|vivo|huawei|realme|infinix|tecno|ps5|xbox|nintendo|steam deck|chromebook|surface)\b(\s+(air|pro|max|plus|ultra|mini|se|fe|lite|m[1-5]|s\d{1,2}|a\d{1,2}|\d{1,2}))*/;

  /* ---------- indexing ---------- */
  function wordSet(s){ var o={}; words(String(s).replace(/type[\s-]?c|usb[\s-]?c/gi,' usbc ').replace(/usb[\s-]?a/gi,' usba ').replace(/power\s?bank/gi,' powerbank ').replace(/display\s?port/gi,' displayport ').replace(/card\s?reader/gi,' reader ').replace(/3\.5\s?mm/gi,' 3.5mm ')).forEach(function(w){ o[stem(w)]=1; o[w]=1; }); return o; }
  function index(p){
    if(p.__vx && p.__vx.src===p) return p.__vx;
    var feats=String(p.features||'');
    var x={
      name:wordSet(p.product_name), model:lc(p.model).trim(), cat:wordSet((p.category||'')+' '+(p.sheet_display||p.sheet||'')),
      color:wordSet(p.color), strong:wordSet((p.short_desc||'')+' '+feats), desc:lc(p.description),
      watts:productWatts(p), mah:productMah(p), len:lenMeters(p.length)
    };
    try{ Object.defineProperty(p,'__vx',{value:{src:p,x:x},enumerable:false,configurable:true,writable:true}); return p.__vx; }catch(e){ return {src:p,x:x}; }
  }
  function ix(p){ var v=index(p); return v.x||v; }

  function variants(w){ return SYN_MAP[w]||[w]; }
  function hitIn(set,w){ var v=variants(w); for(var i=0;i<v.length;i++) if(set[v[i]]) return true; return false; }

  function scoreProduct(p,P){
    /* coverage = share of query words found in the product's identity fields
       (name/model/category/color); features/short_desc are a weaker fallback. */
    var x=ix(p), score=0, covered=0, coveredLoose=0;
    for(var i=0;i<P.content.length;i++){
      var w=P.content[i], hit=false, loose=false;
      if(hitIn(x.name,w)){ score+=6; hit=true; }
      if(x.model===w){ score+=8; hit=true; }
      if(hitIn(x.cat,w)){ score+=4; hit=true; }
      if(hitIn(x.color,w)){ score+=2; hit=true; }
      if(hitIn(x.strong,w)){ score+=1.5; loose=true; }
      if(!hit && !loose && w.length>=4 && x.desc.indexOf(w)>=0){ score+=0.5; }
      if(hit) covered++; if(hit||loose) coveredLoose++;
    }
    var n=P.content.length||1;
    return { score:score, coverage:covered/n, coverageLoose:coveredLoose/n, _hints:true };
  }

  function cmpOp(val,spec,tol){
    if(val==null) return false; tol=tol||0;
    if(spec.op==='max') return val<=spec.v+tol;
    if(spec.op==='min') return val>=spec.v-tol;
    return Math.abs(val-spec.v)<=tol;
  }
  function priceOk(p,P){
    if(P.priceMin==null&&P.priceMax==null) return true;
    var v=Number(p[P.priceField]); if(!v) return false;
    if(P.priceMin!=null&&v<P.priceMin) return false;
    if(P.priceMax!=null&&v>P.priceMax) return false;
    return true;
  }

  /* ---------- exact lookups ---------- */
  function exactMatches(products,P){
    var out=[], seen={};
    P.codes.forEach(function(t){
      products.forEach(function(p){
        var hit = lc(p.item_code)===t || lc(p.upc)===t || lc(p.material_number)===t;
        if(hit && !seen[p.item_code]){ seen[p.item_code]=1; out.push({p:p,via:'code',tok:t}); }
      });
    });
    var codeToks={}; out.forEach(function(o){ codeToks[o.tok]=1; });
    /* model match: token equals model (models may cover several SKUs) */
    P.codes.forEach(function(t){
      if(codeToks[t]) return;
      products.forEach(function(p){
        var m=lc(p.model).trim(), m1=m.split(/\s+/)[0];
        if((m===t||m1===t) && !seen[p.item_code]){ seen[p.item_code]=1; out.push({p:p,via:'model',tok:t}); }
      });
    });
    return out;
  }

  /* ---------- ranking search ---------- */
  function search(products,P,opt){
    opt=opt||{};
    var list=products.filter(function(p){
      if(opt.sheet && p.sheet_display!==opt.sheet) return false;
      if(!priceOk(p,P)) return false;
      var x=ix(p);
      if(P.watts){ var wv=x.watts; if(wv==null && P.nlu && nlu()) wv=nlu().wattsFromFeatures(p); if(!cmpOp(wv,P.watts,0.01)) return false; }
      if(P.mah && !cmpOp(x.mah,P.mah,0)) return false;
      if(P.lengthM && !cmpOp(x.len,P.lengthM,0.001)) return false;
      return true;
    });
    if(!opt.sheet && !P.nlu){
      var hints=[]; P.content.forEach(function(w){ (CAT_HINTS[w]||[]).forEach(function(h){ if(hints.indexOf(h)<0) hints.push(h); }); });
      if(hints.length){
        var inHint=list.filter(function(p){ return hints.indexOf(p.sheet_display)>=0; });
        if(inHint.length) list=inHint;
      }
    }
    if(!P.content.length){
      return list.map(function(p){ return {p:p,score:0,coverage:1}; });
    }
    var scored=list.map(function(p){ var r=scoreProduct(p,P); return {p:p,score:r.score,coverage:r.coverage,loose:r.coverageLoose}; });
    var best=Math.max.apply(null,scored.map(function(r){ return r.coverage; }).concat([0]));
    var key='coverage';
    if(best<0.5){ key='loose'; best=Math.max.apply(null,scored.map(function(r){ return r.loose; }).concat([0])); }
    if(best<0.5) return [];
    scored=scored.filter(function(r){ return r[key]>=best-1e-9; });
    scored.forEach(function(r){ r.coverage=r[key]; });
    scored.sort(function(a,b){ return b.score-a.score; });
    return scored;
  }

  function sheetsOf(rows){
    var c={}; rows.forEach(function(r){ var s=r.p.sheet_display||r.p.sheet||'Other'; c[s]=(c[s]||0)+1; });
    return Object.keys(c).map(function(k){ return {sheet:k,count:c[k]}; }).sort(function(a,b){ return b.count-a.count; });
  }

  function fieldList(P){
    var f=[]; if(P.asks.srp)f.push('srp'); if(P.asks.dp)f.push('dp'); if(P.asks.dpv)f.push('dp_volume'); if(P.asks.moq)f.push('moq');
    if(!f.length && P.asks.price) f=['srp','dp','dp_volume'];
    return f;
  }

  /* ---------- p2r1: ranking (local only; never routed to AI) ---------- */
  var DIM_NOUN={ price:'price', length:'length', watts:'wattage', mah:'capacity' };
  var THING_LABEL={ powerbank:'power bank', usbc:'USB-C', usba:'USB-A', hdmi:'HDMI', lan:'LAN', displayport:'DisplayPort', ssd:'SSD', nas:'NAS', otg:'OTG', vga:'VGA', gan:'GaN', pd:'PD' };
  var LEN_TYPE_RE=/\b(extenders?|extensions?|adapters?|converters?|splitters?|switch(?:er)?s?|hubs?|docks?)\b/;
  function fmtPeso(n){ var s=Number(n).toFixed(2).split('.'); return '₱'+s[0].replace(/\B(?=(\d{3})+(?!\d))/g,',')+'.'+s[1]; }
  function rankValue(p,R){
    if(R.dim==='price'){ var v=Number(p[R.field]); return v>0?v:null; }
    var x=ix(p);
    if(R.dim==='length') return x.len>0?x.len:null;
    if(R.dim==='watts') return x.watts>0?x.watts:null;
    if(R.dim==='mah') return x.mah>0?x.mah:null;
    return null;
  }
  function fmtRank(p,v,R,labels){
    if(R.dim==='price') return fmtPeso(v);
    if(R.dim==='length') return String(p.length||'').trim()||(v+'M');
    if(R.dim==='watts') return v+'W';
    return String(v).replace(/\B(?=(\d{3})+(?!\d))/g,',')+'mAh';
  }
  function thingLabel(P,R,plural){
    if(P.nlu){ var sl=specLabel(P,P.nlu,plural,true); if(R.dim==='length' && !LEN_TYPE_RE.test(P.norm) && !/cable/.test(sl)) sl+=(plural?' cables':' cable'); return sl||'item'; }
    var w=P.content.map(function(x){ return THING_LABEL[x]||x; });
    if(R.dim==='length' && !LEN_TYPE_RE.test(P.norm) && P.content.indexOf('cable')<0) w.push('cable');
    var t=w.join(' ')||'item';
    return plural?(/s$/.test(t)?t:t+'s'):t;
  }
  function rankAnswer(products,P,ctx,res,rows){
    var R=P.rank, labels=ctx.dealer?{srp:'SRP',dp:'Special DP',dp_volume:'DP Vol'}:{srp:'SRP',dp:'DP',dp_volume:'DP Vol'};
    res.rank=R; res.needsAI=false; res.aiReason='';
    if(R.dim==='price') res.fields=[R.field];
    /* no product type, spec or section: ask which type instead of ranking the whole catalog */
    if(!rows && !P.content.length && !ctx.sheet && !P.watts && !P.mah && !P.lengthM){
      res.type='clarify';
      res.note=R.word+' what? Tell me a product type — e.g. “'+R.word.toLowerCase().replace('-',' ')+' '+({price:'power bank',length:'HDMI cable',watts:'charger',mah:'power bank'})[R.dim]+'”.';
      return res;
    }
    var pool=rows||((P.nlu&&nlu())?nluPool(products,P,{sheet:ctx.sheet}):search(products,P,{sheet:ctx.sheet}).map(function(r){ return r.p; }));
    pool=pool.filter(function(p){ return p && !p.disabled; });
    /* product-type nouns: structured section/category first (charger, power bank), product name as fallback */
    var nouns=P.content.filter(function(w){ return CAT_HINTS[w] && w!=='car'; });
    if(nouns.length && !rows && !(P.nlu && nlu())){
      var typed=pool.filter(function(p){ var x=ix(p); return nouns.some(function(w){ return TYPE_CLASS[w]?TYPE_CLASS[w](p):hitIn(x.name,w); }); });
      if(typed.length) pool=typed;
    }
    /* car chargers / mounts only when "car" is asked */
    if(!rows){
      if(P.content.indexOf('car')<0){ var noCar=pool.filter(function(p){ return !isCarItem(p); }); if(noCar.length) pool=noCar; }
      else{ var onlyCar=pool.filter(isCarItem); if(onlyCar.length) pool=onlyCar; }
    }
    /* p2r2.1: a connector named in a cable query must be stated in the product name — "USB-C cable" / "type c cable"
       is a cable whose name says USB-C/Type-C (USB-A extensions, hubs and adapters with a USB-C port do not qualify). */
    if(!rows && P.content.indexOf('cable')>=0){
      Object.keys(CONN_NAME).forEach(function(w){ if(P.content.indexOf(w)>=0) pool=pool.filter(function(p){ return CONN_NAME[w].test(String(p.product_name||'')); }); });
    }
    var extra=[];
    if(P.nlu && nlu() && !rows){                      /* p2r2: data-driven product types + spec constraints */
      pool=nlu().typeFilter(pool,P.content);
      if(P.nlu.attrs.length){
        var confR=[], weakR=0;
        pool.forEach(function(p){ var m=nlu().matchAll(p,P.nlu.attrs); if(m && m.t!=='weak') confR.push(p); else if(m) weakR++; });
        pool=confR; if(weakR) extra.push(weakR+' only mentioned in product descriptions (not confirmed) excluded');
      }
    }
    /* length guard: generic length rankings compare cables only (no wireless range values) */
    if(R.dim==='length' && !rows){
      var lt=P.norm.match(LEN_TYPE_RE);
      if(lt){ var stemT=lt[1].replace(/(e?s)$/,'').slice(0,6); pool=pool.filter(function(p){ return lc(p.product_name).indexOf(stemT)>=0; }); }
      else{
        var hadPool=pool.length;
        pool=pool.filter(function(p){ var n=String(p.product_name||''); return /\bcables?\b/i.test(n) && !/extender|wireless/i.test(n); });
        if(hadPool && !pool.length){
          res.type='text';
          res.note='Length ranking compares cables only, and none of those products is a cable. Name the type to rank it by its listed length — e.g. “longest HDMI extender”.';
          return res;
        }
      }
    }
    if(!pool.length){
      res.type='none'; res.note='No products match that in this pricelist.'; return res;
    }
    if(P.ports){
      var known=pool.filter(function(p){ return productPorts(p)!=null; });
      if(!known.length){
        res.type='text';
        res.note='I can’t rank by port count for these products yet — the pricelist doesn’t state their port count clearly.';
        return res;
      }
      var unknownPorts=pool.length-known.length;
      pool=known.filter(function(p){ return cmpOp(productPorts(p),P.ports,0); });
      if(unknownPorts) extra.push(unknownPorts+' without a clearly listed port count excluded');
      if(!pool.length){
        res.type='none';
        res.note='No '+thingLabel(P,R,true)+' with '+(P.ports.op==='min'?P.ports.v+' or more ports':'exactly '+P.ports.v+(P.ports.v===1?' port':' ports'))+' in this pricelist'+(unknownPorts?' ('+unknownPorts+' without a clearly listed port count excluded)':'')+'.';
        return res;
      }
    }
    var ranked=[], noVal=0;
    pool.forEach(function(p){ var v=rankValue(p,R); if(v==null) noVal++; else ranked.push({p:p,v:v}); });
    if(!ranked.length){
      res.type='text';
      res.note=(R.dim==='price' && R.field==='dp_volume' && ctx.dealer)
        ?'DP Volume is not part of your pricelist. Try SRP or Special DP instead.'
        :'I can’t rank these by '+(R.dim==='price'?labels[R.field]:DIM_NOUN[R.dim])+' yet — the pricelist doesn’t list a comparable '+(R.dim==='price'?labels[R.field]:DIM_NOUN[R.dim])+' for them.';
      return res;
    }
    if(noVal) extra.push(noVal+' without a listed '+(R.dim==='price'?labels[R.field]:DIM_NOUN[R.dim])+' not ranked');
    var sg=R.dir==='max'?-1:1;
    ranked.sort(function(a,b){
      return (sg*(a.v-b.v)) || ((Number(a.p.srp)||0)-(Number(b.p.srp)||0)) || (String(a.p.item_code)<String(b.p.item_code)?-1:1);
    });
    function same(a,b){ return Math.abs(a-b)<1e-9; }
    var by=R.dim==='price'?' by '+labels[R.field]:'';
    var ports=P.ports?(' with '+(P.ports.op==='min'?P.ports.v+'+ ports':'exactly '+P.ports.v+(P.ports.v===1?' port':' ports'))):'';
    var take, head;
    if(R.n){
      var n=Math.min(R.n,RANK_CAP);
      take=ranked.slice(0,n);
      head='Top '+take.length+' '+R.word.toLowerCase()+' '+thingLabel(P,R,true)+ports+by;
      if(ranked.length>n && same(ranked[n].v,ranked[n-1].v)){
        var more=0; for(var k=n;k<ranked.length && same(ranked[k].v,ranked[n-1].v);k++) more++;
        extra.unshift(more+' more tie at '+fmtRank(ranked[n-1].p,ranked[n-1].v,R,labels));
      }
      res.rank.tie=false;
    } else {
      var w=1; while(w<ranked.length && same(ranked[w].v,ranked[0].v)) w++;
      take=ranked.slice(0,w+RANK_NEXT);
      res.rank.winners=w; res.rank.tie=w>1;
      var val=fmtRank(ranked[0].p,ranked[0].v,R,labels);
      head=(w>1?(w+' '+thingLabel(P,R,true)+ports+' tie for '+R.word.toLowerCase().replace('-',' ')+by+' at '+val)
                :(R.word+' '+thingLabel(P,R,false)+ports+by+': '+val));
      if(take.length>w) head+=' — next '+(take.length-w)+' shown after';
    }
    if(P.device){
      /* locally confirmed: the ranking. NOT confirmed: suitability for the named device (never implied). */
      var dv=P.deviceLabel||P.device, inPl=' in the current pricelist', t1=thingLabel(P,R,false), tN=thingLabel(P,R,true);
      var caveat=' I can’t confirm from the local pricelist alone whether '+(R.n||res.rank.tie?'they are':'it is')+' suitable for your '+dv+'.';
      var fv=function(r){ return fmtRank(r.p,r.v,R,labels)+(R.dim==='price'?' ('+labels[R.field]+')':''); };
      if(R.n) head='Top '+take.length+' '+R.word.toLowerCase()+' '+tN+ports+inPl+by+'.'+caveat;
      else if(res.rank.tie) head=res.rank.winners+' '+tN+ports+' tie for '+R.word.toLowerCase().replace('-',' ')+inPl+' at '+fv(take[0])+'.'+caveat;
      else head='The '+R.word.toLowerCase()+' '+t1+ports+inPl+' is '+take[0].p.product_name.replace(/\s+/g,' ').trim()+' at '+fv(take[0])+'.'+caveat;
      if(!R.n && take.length>res.rank.winners) head+=' Next '+(take.length-res.rank.winners)+' shown after';
    }
    res.type='list';
    res.codes=take.map(function(r){ return String(r.p.item_code); });
    res.rank.values=take.map(function(r){ return r.v; });
    res.note=head+(extra.length?' ('+extra.join('; ')+')':'')+':';
    res.note=res.note.replace(/\.:$/,':');
    return res;
  }

  /* ---------- p2r2: spec / existence / count / SKU / list (local only) ---------- */
  var QUAL_ADJ={hdmi:'HDMI',usbc:'USB-C',usba:'USB-A',lightning:'Lightning',displayport:'DisplayPort',vga:'VGA',dvi:'DVI',gan:'GaN',pd:'PD',magnetic:'magnetic',wireless:'wireless',car:'car',desktop:'desktop'};
  var NOUN_W={cable:'cable',adapter:'adapter',converter:'adapter',hub:'hub',dock:'dock',charger:'charger',powerbank:'power bank',lan:'LAN adapter',nas:'NAS',switcher:'switcher',splitter:'splitter',extender:'extender',earbud:'earbuds',mouse:'mouse',keyboard:'keyboard',holder:'holder',stand:'stand',enclosure:'enclosure',reader:'card reader',speaker:'speaker',ssd:'SSD'};
  function specLabel(P,N,plural,noProducts){
    var pre=[], post=[], adj=[], nouns=[], feats=[];
    N.attrs.forEach(function(a){
      if(a.k==='lenRange') post.push(a.label+' long');
      else if(a.k==='flag' && (a.v==='builtin'||a.v==='retractable')) post.push(a.label);
      else pre.push(a.label);
    });
    if(P.watts) pre.push((P.watts.op==='min'?'≥':P.watts.op==='max'?'≤':'')+P.watts.v+'W');
    if(P.mah) pre.push((P.mah.op==='min'?'≥':P.mah.op==='max'?'≤':'')+String(P.mah.v).replace(/\B(?=(\d{3})+(?!\d))/g,',')+'mAh');
    if(P.lengthM) post.push((P.lengthM.op==='min'?'at least ':P.lengthM.op==='max'?'up to ':'')+P.lengthM.v+'m long');
    P.content.forEach(function(w){
      if(/^(an?|the|with|and|that|for|na|is|it|to)$/.test(w)) return;
      if(NOUN_W[w]){ if(nouns.indexOf(NOUN_W[w])<0) nouns.push(NOUN_W[w]); return; }
      var lab=QUAL_ADJ[w]||(THING_LABEL[w]||w);
      if(pre.some(function(x){ return x.toLowerCase().indexOf(lab.toLowerCase())===0; })) return;   /* "HDMI 2.1" already says HDMI */
      if(QUAL_ADJ[w]||/^(white|black|gray|grey|blue|silver|green|red|pink|purple|yellow|beige)$/.test(w)) adj.push(lab); else feats.push(lab);
    });
    if(nouns.indexOf('LAN adapter')>=0) nouns=nouns.filter(function(n){ return n!=='adapter'; });
    var noun=nouns.join(' ');
    if(noun && plural && !/s$/.test(noun)) noun+=(/(ch|sh|x)$/.test(noun)?'es':'s');
    if(!noun) noun=noProducts?'':(plural?'products':'product');
    var head=pre.concat(adj).concat(noun?[noun]:[]).join(' ');
    var tail=[]; if(feats.length) tail.push('with '+feats.join(' and ')); post.forEach(function(x){ tail.push(x); });
    return (head+(tail.length?' '+tail.join(', '):'')).replace(/\s+/g,' ').trim()||(noProducts?'':'products');
  }
  /* p2r2: candidate pool. When every product word is a known data-driven type (HDMI, cable, hub...),
     the type registry selects candidates (handles names like "1xHDMI"); otherwise text coverage as before. */
  function nluPool(products,P,opt){
    var NL=nlu(), ws=P.content||[];
    var allTypes=ws.length && ws.every(function(w){ return NL.types[w] || /^(an?|the|with|and|that|for|na|is|it|to)$/.test(w); });
    var rows=allTypes ? search(products,Object.assign({},P,{content:[]}),opt||{}) : search(products,P,opt||{});
    /* named connectors (USB-C, Lightning, DisplayPort, VGA, DVI) must all appear in the product name */
    var CONN={usbc:/\busb-c\b/,lightning:/\blightning\b/,displayport:/\b(displayport|dp)\b/,vga:/\bvga\b/,dvi:/\bdvi\b/};
    var need=ws.filter(function(w){ return CONN[w]; });
    var list=rows.map(function(r){ return r.p; }).filter(function(p){ return p && !p.disabled; });
    if(need.length) list=list.filter(function(p){ var n=NL.normText(p.product_name||''); return need.every(function(w){ return CONN[w].test(n); }); });
    return NL.typeFilter(list,ws);
  }
  function attrAnswer(products,P,ctx,res){
    var NL=nlu(), N=P.nlu, A=N.attrs;
    P.local=true; res.local=true; res.needsAI=false; res.aiReason='';
    if(!P.content.length && !A.length && !P.watts && !P.mah && !P.lengthM && P.priceMin==null && P.priceMax==null){
      res.type='clarify'; res.note='Tell me the product type or spec — e.g. “do we have an 8K HDMI cable?”'; return res;
    }
    var pool=nluPool(products,P,{sheet:ctx.sheet});
    var conf=[], weak=[], medium=0;
    pool.forEach(function(p){
      if(!A.length){ conf.push({p:p,t:'strong',ev:[]}); return; }
      var m=NL.matchAll(p,A); if(!m) return;
      if(m.t==='weak') weak.push(p); else { conf.push({p:p,t:m.t,ev:m.ev}); if(m.t==='medium') medium++; }
    });
    /* car items only when "car" is asked — unless they are the only matches */
    var carNote='';
    if(P.content.indexOf('car')<0){
      var nonCar=conf.filter(function(c){ return !isCarItem(c.p); });
      if(nonCar.length) conf=nonCar; else if(conf.length) carNote=' (all are car chargers/accessories)';
    }
    conf.sort(function(a,b){ return (a.t===b.t)?0:(a.t==='strong'?-1:1); });
    medium=conf.filter(function(c){ return c.t==='medium'; }).length;
    var label=specLabel(P,N,true), one=specLabel(P,N,false);
    var bud=(P.priceMin!=null&&P.priceMax!=null)?(' '+fmtPeso(P.priceMin)+'–'+fmtPeso(P.priceMax)):(P.priceMax!=null?' under '+fmtPeso(P.priceMax):(P.priceMin!=null?' '+fmtPeso(P.priceMin)+' and up':''));
    if(bud){ label+=bud; one+=bud; }
    res.detail={};
    conf.forEach(function(c){ if(c.t==='medium' && c.ev && c.ev[0]) res.detail[String(c.p.item_code)]='Per product features: “'+c.ev[0].trim().slice(0,110)+'”'; });
    var extras=[];
    if(medium && conf.length) extras.push(medium+' confirmed per product features');
    if(weak.length) extras.push('mentioned only in product descriptions, not confirmed: '+weak.slice(0,5).map(function(p){ return p.item_code; }).join(', ')+(weak.length>5?' …':''));
    if(P.device){ var dmm=String(N.raw||'').match(new RegExp(DEVICE_RE.source,'i')); extras.push('I can’t confirm compatibility with your '+(dmm?dmm[0].replace(/\s+/g,' ').trim():P.device)+' from the pricelist'); }
    var tail=(extras.length?' ('+extras.join('; ')+')':'');
    var codes=conf.map(function(c){ return String(c.p.item_code); });
    var act=N.action||'list';
    /* p2r2.1: "MagSafe" is a certification/compatibility claim. Only name/feature evidence that says MagSafe confirms it.
       Products named "magnetic wireless" are shown separately as magnetic-only — never as MagSafe. */
    var msA=A.filter(function(a){ return a.k==='flag' && a.v==='magsafe'; });
    if(msA.length){
      var restA=A.filter(function(a){ return !(a.k==='flag' && a.v==='magsafe'); }), inConf={};
      conf.forEach(function(c){ inConf[String(c.p.item_code)]=1; });
      var magOnly=pool.filter(function(p){
        var n=String(p.product_name||''); if(inConf[String(p.item_code)] || !/\bmagnetic\b/i.test(n) || !/\bwireless\b/i.test(n)) return false;
        if(P.content.indexOf('car')<0 && isCarItem(p)) return false;
        if(!restA.length) return true; var m=NL.matchAll(p,restA); return !!(m && m.t!=='weak');
      });
      if(magOnly.length){
        var magCodes=magOnly.map(function(p){ return String(p.item_code); });
        magCodes.forEach(function(c){ res.detail[c]='Magnetic wireless (product name) — MagSafe not explicitly confirmed'; });
        var one1=magOnly.length===1, typeWord=P.content.indexOf('powerbank')>=0?(one1?'power bank':'power banks'):(P.content.indexOf('charger')>=0?(one1?'charger':'chargers'):(one1?'product':'products'));
        var weakNote=weak.length?(' MagSafe is mentioned only in product descriptions for: '+weak.slice(0,5).map(function(p){ return p.item_code; }).join(', ')+(weak.length>5?' …':'')+'.'):'';
        var magNote=magOnly.length+' magnetic wireless '+typeWord+' in the current pricelist; MagSafe support/certification is not explicitly confirmed for '+(magOnly.length===1?'this item':'these items')+'.';
        res.local=true; res.type='list';
        if(!conf.length){
          res.codes=magCodes;
          res.note='No product in the pricelist is explicitly listed as a '+one+'. We have '+magNote+weakNote+(P.device?' I can’t confirm compatibility with your device from the pricelist.':'');
        } else {
          res.codes=codes.concat(magCodes);
          res.note=(act==='exist'?'Yes — ':'')+conf.length+' '+(conf.length===1?one:label)+' in the current pricelist (MagSafe stated in the product name or features)'+carNote+tail+'. Also '+magNote;
        }
        return res;
      }
    }
    if(!conf.length){
      res.type='text';
      res.note=(act==='count'?'0 — ':'No — ')+'I can’t find '+(act==='count'?'any ':'a ')+one+' in the current pricelist'+tail+'.';
      return res;
    }
    res.codes=codes; res.type='list';
    if(act==='exist'){
      var secs=sheetsOf(conf.map(function(c){ return {p:c.p}; }));
      if(!A.length && !P.watts && !P.mah && !P.lengthM && conf.length>12 && secs.length>=3 && !ctx.sheet){
        res.type='clarify'; res.note='Yes — '+conf.length+' '+label+' in the current pricelist, across '+secs.length+' sections. Which one?';
        res.chips=secs.slice(0,6).map(function(x){ return {label:x.sheet, sheet:x.sheet, count:x.count}; }); return res;
      }
      res.note='Yes — '+conf.length+' '+(conf.length===1?one:label)+' in the current pricelist'+carNote+tail+':';
    } else if(act==='count'){
      res.note=conf.length+' '+(conf.length===1?one:label)+' in the current pricelist'+carNote+tail+':';
    } else if(act==='sku'){
      res.note=conf.length===1 ? ('SKU '+codes[0]+' — '+String(conf[0].p.product_name).replace(/\s+/g,' ').trim()+tail+':')
                               : (conf.length+' '+label+' match — item codes on each card'+carNote+tail+':');
    } else {
      res.note=conf.length+' '+(conf.length===1?one:label)+carNote+tail+':';
    }
    return res;
  }

  /* ---------- p2r2: price history (effective/past events only; never priceSchedule) ---------- */
  function signPeso(v){ return (v>0?'+':v<0?'−':'')+fmtPeso(Math.abs(v)); }
  function signPct(v){ return v==null?'':((v>0?'+':v<0?'−':'')+Math.abs(v).toFixed(1)+'%'); }
  function historyAnswer(products,P,ctx,res,ex){
    var NL=nlu(), H=P.nlu.hist, today=ctx.today||NL.todayStr();
    P.local=true; res.local=true; res.needsAI=false; res.aiReason=''; res.fields=[];
    var lead='';
    if(ctx.dealer && H.field!=='srp'){ lead='Only SRP history is available in your pricelist view. '; }
    var field=ctx.dealer?'srp':H.field;                         /* dealers: SRP only — never standard DP / DP Vol */
    var FL={srp:'SRP',dp:'DP',vol:'DP Vol'}[field];
    var all=products.filter(function(p){ return p && !p.disabled; });
    if(P.codes.length && !ex.length){ res.type='text'; res.note='No product with item code or model “'+P.codes.join(', ')+'” in this pricelist.'; return res; }
    var pool;
    if(P.poolOverride && !ex.length) pool=P.poolOverride.filter(function(p){ return p && !p.disabled; });      /* p2r3a: type pool from the QueryPlan */
    else if(ex.length) pool=ex.map(function(o){ return o.p; }).filter(function(p){ return !p.disabled; });
    else if(P.content.length || P.watts || P.mah || P.lengthM) pool=nluPool(all,P,{});
    else pool=all;
    var allRows=NL.historyRows(all,{today:today,fields:[field]});
    var earliest=allRows.reduce(function(m,r){ return (!m||r.date<m)?r.date:m; },null);
    var rows=NL.historyRows(pool,{today:today,fields:[field]});
    var rng=NL.periodRange(H.period,today);
    if(rng) rows=rows.filter(function(r){ return r.date>=rng.from && r.date<=rng.to; });
    var dirRows=rows;
    if(H.dir==='up') rows=rows.filter(function(r){ return r.delta>0; });
    if(H.dir==='down') rows=rows.filter(function(r){ return r.delta<0; });
    if(H.threshold) rows=rows.filter(function(r){ return H.threshold.pct ? (r.pct!=null && Math.abs(r.pct)>H.threshold.v) : Math.abs(r.delta)>H.threshold.v; });
    var when=rng?(H.period.k==='since'?' '+rng.label:' effective in '+rng.label):'';
    var cov=(earliest && (!rng || rng.from<earliest))?' Recorded price history starts '+earliest+'.':'';
    function rowText(r){ return FL+' '+fmtPeso(r.old)+' → '+fmtPeso(r['new'])+' ('+signPeso(r.delta)+', '+signPct(r.pct)+') · effective '+r.date; }
    function bySku(rs){ var m={}, order=[]; rs.forEach(function(r){ if(!m[r.code]){ m[r.code]=[]; order.push(r.code); } m[r.code].push(r); }); return {m:m,order:order}; }
    res.detail={};
    var dirWord=H.dir==='up'?'increase':H.dir==='down'?'decrease':'change';

    /* single SKU: previous price / how much did it change */
    if(ex.length){
      var p0=pool[0]; if(!p0){ res.type='text'; res.note='That product is not in this pricelist.'; return res; }
      var mine=rows.filter(function(r){ return r.code===String(p0.item_code); }).sort(function(a,b){ return a.date<b.date?-1:1; });
      res.codes=[String(p0.item_code)]; res.type='list';
      if(!mine.length){ res.note=lead+'No recorded '+FL+' '+dirWord+' for SKU '+p0.item_code+when+' — current '+FL+' is '+fmtPeso(field==='srp'?p0.srp:field==='dp'?p0.dp:p0.dp_volume)+'.'+cov; return res; }
      var last=mine[mine.length-1];
      if(H.kind==='previous' && !/how much/.test(P.nlu.raw.toLowerCase())){
        res.note=lead+'Previous '+FL+' of SKU '+p0.item_code+': '+fmtPeso(last.old)+' (changed to '+fmtPeso(last['new'])+', effective '+last.date+')'+
          (mine.length>1?'. Earlier: '+mine.slice(0,-1).reverse().map(function(r){ return fmtPeso(r.old)+' → '+fmtPeso(r['new'])+' on '+r.date; }).join('; '):'')+'.';
      } else {
        res.note=lead+'SKU '+p0.item_code+' '+mine.map(rowText).join('; ')+'.';
      }
      res.detail[res.codes[0]]=mine.map(rowText).join(' | ');
      return res;
    }
    if(!rows.length){
      res.type='text';
      var lastOut=null;
      if(H.dir){ var outside=NL.historyRows(pool,{today:today,fields:[field]}).filter(function(r){ return H.dir==='up'?r.delta>0:r.delta<0; }).sort(function(a,b){ return a.date<b.date?1:-1; }); lastOut=outside[0]; }
      res.note=lead+'No — no '+FL+' '+dirWord+'s'+when+(H.threshold?' above '+(H.threshold.pct?H.threshold.v+'%':fmtPeso(H.threshold.v)):'')+' in the current pricelist.'+
        (lastOut?' Most recent recorded '+dirWord+': SKU '+lastOut.code+' '+fmtPeso(lastOut.old)+' → '+fmtPeso(lastOut['new'])+' (effective '+lastOut.date+').':'')+cov;
      if(lastOut){ res.type='list'; res.codes=[lastOut.code]; res.detail[lastOut.code]=rowText(lastOut); }
      return res;
    }
    var g=bySku(rows);
    g.order.forEach(function(c){ res.detail[c]=g.m[c].map(rowText).join(' | '); });
    var ups=g.order.filter(function(c){ return g.m[c].some(function(r){ return r.delta>0; }); }).length;
    var downs=g.order.filter(function(c){ return g.m[c].some(function(r){ return r.delta<0; }); }).length;
    var thing=P.thingLabel?(' '+P.thingLabel):(P.content.length?(' '+P.content.map(function(w){ return THING_LABEL[w]||w; }).join(' ')):'');
    if(H.kind==='rank'){
      var pct=H.metric==='pct';
      var key=function(r){ var v=pct?(r.pct==null?0:r.pct):r.delta; return H.dir==='down'?-v:(H.dir==='up'?v:Math.abs(v)); };
      var best={}; rows.forEach(function(r){ if(!best[r.code] || key(r)>key(best[r.code])) best[r.code]=r; });
      var list=Object.keys(best).map(function(c){ return best[c]; }).sort(function(a,b){ return (key(b)-key(a)) || (a.code<b.code?-1:1); });
      var take;
      if(H.n){ take=list.slice(0,H.n); res.note=lead+'Top '+take.length+thing+' '+FL+' '+dirWord+'s'+when+' by '+(pct?'percentage':'peso amount')+(cov?' ('+cov.trim().replace(/\.$/,'')+')':'')+':'; }
      else {
        var w=1; while(w<list.length && Math.abs(key(list[w])-key(list[0]))<1e-9) w++;
        take=list.slice(0,w+2);
        var top=list[0];
        res.note=lead+(w>1?(w+' SKUs tie for the biggest'+thing+' '+FL+' '+dirWord+when+' by '+(pct?'percentage':'peso amount')+': '+rowText(top).replace(FL+' ','')):
          ('Biggest'+thing+' '+FL+' '+dirWord+when+' by '+(pct?'percentage':'peso amount')+': SKU '+top.code+' — '+rowText(top)))+
          (take.length>w?' — next '+(take.length-w)+' shown after':'')+'.'+cov;
        res.rankHist={winners:w};
      }
      res.codes=take.map(function(r){ return r.code; }); res.type='list';
      take.forEach(function(r){ res.detail[r.code]=rowText(r); });
      return res;
    }
    if(H.kind==='aggregate'){
      var cats={}, secOf={};
      g.order.forEach(function(c){ var p=g.m[c][0].p, k=String(p.category||'Other'); (cats[k]=cats[k]||[]).push(c); secOf[k]=secOf[k]||{}; secOf[k][p.sheet_display]=(secOf[k][p.sheet_display]||0)+1; });
      var ranked=Object.keys(cats).sort(function(a,b){ return (cats[b].length-cats[a].length)||(a<b?-1:1); });
      function sec(k){ return Object.keys(secOf[k]).sort(function(a,b){ return secOf[k][b]-secOf[k][a]; })[0]; }
      var tops=ranked.filter(function(k){ return cats[k].length===cats[ranked[0]].length; });
      res.note=lead+(tops.length>1?tops.length+' categories tie for the most '+FL+' '+dirWord+'s'+when+': ':'Category with the most '+FL+' '+dirWord+'s'+when+': ')+
        tops.map(function(k){ return k+' — '+cats[k].length+' SKUs (section: '+sec(k)+')'; }).join('; ')+
        '. Next: '+ranked.slice(tops.length,tops.length+2).map(function(k){ return k+' ('+cats[k].length+')'; }).join(', ')+'.'+cov;
      res.codes=cats[tops[0]].slice(); res.type='list'; return res;
    }
    res.codes=g.order.slice().sort(function(a,b){ var ra=g.m[a][g.m[a].length-1], rb=g.m[b][g.m[b].length-1]; return (ra.date<rb.date?1:ra.date>rb.date?-1:0) || (Math.abs(rb.delta)-Math.abs(ra.delta)); });
    res.type='list';
    var summary=g.order.length+thing+' SKU'+(g.order.length===1?'':'s')+' with an '+FL+' '+dirWord+when+(H.threshold?' above '+(H.threshold.pct?H.threshold.v+'%':fmtPeso(H.threshold.v)):'')+
      (H.dir?'':' ('+ups+' increase'+(ups===1?'':'s')+', '+downs+' decrease'+(downs===1?'':'s')+')');
    var covP=cov?' ('+cov.trim().replace(/\.$/,'')+')':'';
    if(H.kind==='exist') res.note=lead+'Yes — '+summary+covP+':';
    else if(H.kind==='count') res.note=lead+summary+covP+':';
    else res.note=lead+summary+covP+':';
    return res;
  }

  /* ---------- main entry ---------- */
  /* products: the list the user is allowed to see (caller passes ALL_PRODUCTS minus disabled;
     in dealer mode that list is already the dealer's own SKUs).
     ctx: { sheet: restrict to a section (from a clarify chip), compareCodes: [...] } */
  /* p2r3a: Local Brain path first (QueryPlan -> composer); any exception falls back to the p2r2.1 path for that question */
  function brain(){ var C=root.VeroCompose; return (C && C.ready && C.ready())?C:null; }
  function answer(products,query,ctx){
    ctx=ctx||{};
    var C=brain();
    if(C && !(ctx.compareCodes && ctx.compareCodes.length) && !ctx.sheet && !ctx.legacy){
      try{ return C.answer(products,query,ctx,legacyAnswer); }
      catch(e){ try{ console.warn('[VERO] Local Brain fallback to p2r2.1 path:',e); }catch(_){} }
    }
    return legacyAnswer(products,query,ctx);
  }
  function legacyAnswer(products,query,ctx){
    ctx=ctx||{};
    var NL=nlu(), N=null;
    if(NL && !(ctx.compareCodes && ctx.compareCodes.length)){ try{ N=NL.analyze(query); }catch(e){ N=null; } }
    var useN=!!(N && !N.compat && (N.hist || N.attrs.length || N.action || N.rewritten));
    var P=parse(useN ? N.text : query);
    if(useN) P.nlu=N;
    var res={ query:String(query||''), parsed:P, type:'none', codes:[], fields:fieldList(P), chips:[], note:'', needsAI:false, aiReason:'' };
    if(P.recommend){ res.needsAI=true; res.aiReason='recommendation/compatibility'; }
    if(P.stock) res.stockNote=STOCK_NOTE;

    if(ctx.compareCodes && ctx.compareCodes.length){
      res.type='compare'; res.codes=ctx.compareCodes.slice(0,4); return res;
    }

    var ex=exactMatches(products,P);
    var exCodes=ex.map(function(o){ return String(o.p.item_code); });

    /* p2r2: price-history questions (effective/past events only) -> always local */
    if(useN && N.hist) return historyAnswer(products,P,ctx,res,ex);

    /* compare: 2-4 directly identified SKUs (each token must resolve to exactly one SKU) */
    if(P.compare){
      var byTok={}, order=[];
      ex.forEach(function(o){ if(!byTok[o.tok]){ byTok[o.tok]=[]; order.push(o.tok); } byTok[o.tok].push(String(o.p.item_code)); });
      var multi=order.filter(function(t){ return byTok[t].length>1; });
      if(multi.length){
        res.type='list'; res.codes=byTok[multi[0]];
        res.note='Model '+multi[0].toUpperCase()+' has '+byTok[multi[0]].length+' SKUs. Tap Compare on the ones you want, or use item codes.';
        return res;
      }
      var cc=order.map(function(t){ return byTok[t][0]; });
      if(cc.length>=2){
        res.type='compare'; res.codes=cc.slice(0,4);
        if(cc.length>4) res.note='I can compare up to 4 at a time — showing the first 4.';
        return res;
      }
      res.type='clarify'; res.codes=cc;
      res.note=cc.length===1?'I found one of those. Give me at least one more item code or model to compare it with — or tap Compare on any results.'
                            :'Tell me the item codes or models you want to compare (2 to 4), or tap Compare on any results.';
      return res;
    }

    /* p2r1: ranking / superlative -> always answered locally */
    if(P.rank && (ex.length || !P.codes.length)){
      return rankAnswer(products,P,ctx,res,ex.length?ex.map(function(o){ return o.p; }):null);
    }

    /* p2r2: existence / count / SKU / list / spec questions -> always local */
    if(useN && !ex.length && !P.codes.length) return attrAnswer(products,P,ctx,res);

    if(ex.length){
      var rows=ex.map(function(o){ return o.p; });
      if(P.content.length && rows.length>1){
        /* model + words, e.g. "NW102 3m" or "AV102 1m": narrow with specs/text */
        var narrowed=search(rows,P,{});
        if(narrowed.length) rows=narrowed.map(function(r){ return r.p; });
      } else if(P.lengthM||P.watts||P.mah||P.priceMin!=null||P.priceMax!=null){
        var n2=search(rows,P,{}); if(n2.length) rows=n2.map(function(r){ return r.p; });
      }
      res.type=rows.length===1?'lookup':'list';
      res.codes=rows.map(function(p){ return String(p.item_code); });
      if(rows.length>1 && ex[0].via==='model') res.note='Model '+String(rows[0].model).toUpperCase()+' has '+rows.length+' SKUs:';
      return res;
    }

    /* codes typed but nothing matched — don't fall back to fuzzy text for them */
    if(P.codes.length && !P.content.length && !P.watts && !P.lengthM && !P.mah){
      res.type='none';
      res.note='No product with item code, model, UPC or material no. "'+P.codes.join(', ')+'" in this pricelist.';
      return res;
    }

    if(!P.content.length && !P.watts && !P.mah && !P.lengthM && P.priceMin==null && P.priceMax==null){
      res.type='clarify';
      res.note='Tell me an item code, model, or what you need — e.g. a product type, wattage, length, or budget.';
      return res;
    }

    var found=search(products,P,{sheet:ctx.sheet});
    /* device question with no wattage: ask for the wattage instead of guessing compatibility */
    if(P.device && found.length>1 && !P.watts && !ctx.sheet){
      var wset={}; found.forEach(function(r){ var w=ix(r.p).watts; if(w) wset[w]=(wset[w]||0)+1; });
      var ws=Object.keys(wset).map(Number).sort(function(a,b){return a-b;});
      if(ws.length>=2){
        res.type='clarify';
        res.note='I can\'t confirm device compatibility yet. Check the wattage your '+P.device+' needs, then pick one:';
        res.chips=ws.slice(0,8).map(function(w){ return {label:w+'W', append:' '+w+'W', count:wset[w]}; });
        res.codes=found.map(function(r){ return String(r.p.item_code); });
        return res;
      }
    }
    if(!found.length){
      res.type='none';
      res.note='No products match that in this pricelist.';
      return res;
    }
    if(P.priceField){
      var pf=P.priceField; found.sort(function(a,b){ return (b.score-a.score) || (Number(a.p[pf])-Number(b.p[pf])); });
    }
    var sheets=sheetsOf(found);
    /* ambiguous: broad request spread over many sections, no narrowing filters */
    var narrowedByFilter=P.watts||P.mah||P.lengthM||P.priceMin!=null||P.priceMax!=null;
    if(!ctx.sheet && found.length>12 && sheets.length>=3 && !narrowedByFilter){
      res.type='clarify';
      res.note='That matches '+found.length+' products across '+sheets.length+' sections. Which one?';
      res.chips=sheets.slice(0,6).map(function(s){ return {label:s.sheet, sheet:s.sheet, count:s.count}; });
      res.codes=found.map(function(r){ return String(r.p.item_code); });
      return res;
    }
    res.type=found.length===1?'lookup':'list';
    res.codes=found.map(function(r){ return String(r.p.item_code); });
    if(ctx.sheet) res.note='In '+ctx.sheet+':';
    return res;
  }


  /* ======================= Phase 2: AI routing (additive; answer() is unchanged) ======================= */
  /* Web rules — keep identical to backend/vero/worker.js webDecision() (tests/vero-worker.test.mjs W29). */
  var RE_DEVICE = /\b(macbook(?:\s+(?:air|pro|neo))?|imac|mac\s?mini|mac\s?studio|mac\s?pro|iphone|ipad(?:\s+(?:air|pro|mini))?|galaxy|samsung|pixel|surface|thinkpad|xps|zenbook|rog\s?ally|legion\s?go|steam\s?deck|switch\s?2|nintendo\s?switch|ps5|playstation\s?5|xbox|chromebook|matebook|xiaomi|redmi|oppo|vivo|realme|infinix|tecno|huawei|honor|oneplus)\b/i;
  var RE_DEVICE_MODEL = /\b(macbook(?:\s+(?:air|pro|neo))?|imac|mac\s?mini|mac\s?studio|iphone|ipad(?:\s+(?:air|pro|mini))?|galaxy|pixel|surface(?:\s+(?:pro|laptop))?|thinkpad|xps|zenbook|steam\s?deck|xbox|chromebook|matebook|redmi|oppo|vivo|realme|infinix|tecno|huawei|honor|oneplus)((?:\s+(?:m\d{1,2}|\d{1,2}|pro|air|max|ultra|plus|mini|fe|s\d{1,2}|a\d{1,2}|z\s?(?:fold|flip)\s?\d{0,2}|tab\s?s?\d{0,2}|x\d{0,2}|series\s?[xs]))+)\b/i;
  var RE_OS = /\b(?:(?:ios|ipados|watchos)\s?\d{1,2}|macos(?:\s+(?:sequoia|tahoe|sonoma|ventura|monterey|\d{2}))?|windows\s?(?:10|11|12)|android\s?\d{1,2}|chrome\s?os|linux)\b/i;
  var RE_STD = /\b(?:displaylink|drivers?|firmware|thunderbolt\s?[345]|usb\s?4|usb4|mst|dp\s?alt(?:\s?mode)?|hdcp|hdmi\s?2\.1|pd\s?3\.1|epr|qi2|magsafe)\b/i;
  var RE_OFFICIAL = /\b(?:manual|user\s?guide|official|datasheet|spec\s?sheet|support\s?page|website)\b/i;
  var RE_COMPAT = /\b(?:compatible|compatibility|works?\s+(?:with|on)|support(?:s|ed)?|kaya\s+ba|pwede\s+ba|puwede\s+ba|gagana\s+ba)\b/i;
  function normT(x){ return String(x||'').toLowerCase().replace(/[\s-]+/g,' ').trim(); }
  function webDecision(q, candidateTexts){
    var triggers=[], terms=[], m;
    if((m=q.match(RE_DEVICE_MODEL))){ triggers.push('T1'); terms.push(normT(m[0])); }
    if((m=q.match(RE_OS))){ triggers.push('T2'); terms.push(normT(m[0])); }
    if((m=q.match(RE_STD))){ triggers.push('T3'); terms.push(normT(m[0])); }
    if(RE_OFFICIAL.test(q)) triggers.push('T4');
    var dev=q.match(RE_DEVICE);
    if(RE_COMPAT.test(q) && dev){ triggers.push('T5'); if(!terms.length) terms.push(normT(dev[0])); }
    if(!triggers.length) return { web:false, triggers:triggers, terms:terms };
    if(triggers.indexOf('T4')>=0) return { web:true, triggers:triggers, terms:terms };
    var hay=normT((candidateTexts||[]).join(' \n '));
    var all=terms.length>0 && terms.every(function(t){ return hay.indexOf(t)>=0; });
    return { web:!all, triggers:triggers, terms:terms, evidence:all };
  }

  /* Words that only filter/categorise (AI adds nothing for them). */
  var FILTER_WORDS={};
  ('cable cord wire adapter charger charging hub dock docking powerbank mouse keyboard earbud earphone headphone headset bluetooth lan ethernet network hdmi '+
   'usbc usba lightning displayport vga dvi reader card enclosure nas holder stand mount car case switch switcher splitter converter extender otg aux 3.5mm '+
   'ssd hdd gan pd fast wireless magnetic male female port ports in to and black white gray grey blue green red pink gold silver purple beige '+
   'm cm meter meters w watt watts mah inch 4k 8k 1080p 60hz 120hz 144hz').split(' ').forEach(function(w){ FILTER_WORDS[stem(w)]=1; FILTER_WORDS[w]=1; });
  function descriptiveWords(P){ return (P.content||[]).filter(function(w){ return !FILTER_WORDS[w] && !CAT_HINTS[w]; }); }

  /* "Ask VERO AI" is offered only where reasoning can add something. */
  function canEscalate(res){
    if(!res||!res.parsed) return false;
    var P=res.parsed;
    if(P.rank || P.local) return false;                                // p2r1/p2r2: ranking + resolved local intents are always local
    if(P.codes.length) return false;                                   // SKU / model / UPC lookups
    if(res.fields && res.fields.length) return false;                  // SRP / DP / DP Vol / MOQ
    if(res.type==='compare') return false;                             // simple compare-by-code
    if(res.type==='text') return false;
    return descriptiveWords(P).length>0;                               // pure filters/categories -> no
  }

  /* ---------- Phase 2: multi-device / use-case shortlist (AI candidates only; Phase 1 search unchanged) ---------- */
  var DEV_CLASS={ laptop:'laptop', laptops:'laptop', notebook:'laptop', macbook:'laptop', chromebook:'laptop', ultrabook:'laptop',
    phone:'phone', phones:'phone', smartphone:'phone', cellphone:'phone', cp:'phone', selpon:'phone', iphone:'phone', android:'phone',
    tablet:'tablet', tablets:'tablet', ipad:'tablet' };
  var USE_TRAVEL=/\b(travel|travelling|traveling|trip|biyahe|byahe|bakasyon|vacation|on the go|portable|dala|dadalhin)\b/;
  /* A named non-power accessory means the user already chose the product type -> never narrow to chargers. */
  var OTHER_TYPE=/\b(stand|holder|mount|bag|pouch|case|sleeve|cable|cord|adapter|hub|dock|docking|mouse|keyboard|earbuds?|earphones?|headphones?|headset|speaker|stylus|film|protector|enclosure|reader|switch|switcher|splitter|ssd|hdd|nas|lan|ethernet|hdmi|monitor)s?\b/;
  var POWER_SECTIONS={ 'Mobile: Charger':1, 'Mobile: Power Bank':1 };
  function deviceClasses(P){
    var out={}, ws=String(P.norm||'').split(/[^a-z0-9]+/);
    for(var i=0;i<ws.length;i++){ if(DEV_CLASS[ws[i]]) out[DEV_CLASS[ws[i]]]=1; }
    return Object.keys(out);
  }
  function portCount(p){
    var n=0, name=String(p.product_name||'');
    name.replace(/(?:(\d)\s*[*x\u00d7]\s*)?USB[\s-]?(?:A|C)\b/gi, function(m,k){ n+=k?parseInt(k,10):1; return m; });
    var pm=name.match(/(\d)[\s-]?ports?\b/i); if(pm) n=Math.max(n,parseInt(pm[1],10));
    return n;
  }
  /* Fit bonus for products that can serve every device named: laptop -> >=45W (65W+ better), 2+ devices -> 2+ ports. */
  function deviceFit(p,classes){
    var x=ix(p), w=x.watts||0, ports=portCount(p), fit=0;
    if(classes.indexOf('laptop')>=0){ if(w>=45) fit+=10; if(w>=65) fit+=3; }
    else if(classes.indexOf('tablet')>=0){ if(w>=20) fit+=4; }
    if(classes.length>=2){ if(ports>=2) fit+=6; if(ports>=3) fit+=2; }
    else if(ports>=2) fit+=2;
    return fit;
  }

  /* Up to 8 candidates, max 2 per model, honouring price/spec filters already applied locally. */
  function aiCandidates(products, res, max){
    max=max||8;
    var P=res.parsed, codes=[];
    if(res.type==='compare'){ return (res.codes||[]).slice(0,4); }
    if(P.codes.length && res.codes && res.codes.length>=2){ codes=res.codes.slice(); }          /* typed codes/models */
    else {
      var pool=products.filter(function(p){
        if(!priceOk(p,P)) return false; var x=ix(p);
        if(P.watts && !cmpOp(x.watts,P.watts,0.01)) return false;
        if(P.mah && !cmpOp(x.mah,P.mah,0)) return false;
        if(P.lengthM && !cmpOp(x.len,P.lengthM,0.001)) return false;
        return true;
      });
      /* product-type nouns in the question ("charger", "power bank", "hub"...) must appear in the product name,
         so "charger for a laptop and phone" doesn't surface phone holders from the car-accessories section. */
      var nouns=P.content.filter(function(w){ return CAT_HINTS[w]; });
      if(nouns.length){
        var named=pool.filter(function(p){ var x=ix(p); return nouns.some(function(w){ return hitIn(x.name,w); }); });
        if(named.length>=2) pool=named;
      }
      if(P.content.indexOf('car')<0){                                  /* no "car" in the question -> skip car chargers/mounts */
        var noCar=pool.filter(function(p){ return !/\bcar\b/i.test(p.product_name||''); });
        if(noCar.length>=2) pool=noCar;
      }
      /* Use case across devices ("travel, laptop at phone", "charger for tablet and phone"): when no other
         product type is named, shortlist power products (chargers, power banks) and rank the ones that can
         serve every named device first (laptop-capable wattage, enough ports). */
      var classes=deviceClasses(P), useCase=classes.length>=2 || (classes.length>=1 && USE_TRAVEL.test(String(P.norm||'')));
      var powerNamed=nouns.some(function(w){ return w==='charger'||w==='powerbank'; });
      if(useCase && !powerNamed && !OTHER_TYPE.test(String(P.norm||'')) && !nouns.length){
        var power=pool.filter(function(p){ return POWER_SECTIONS[p.sheet_display]; });
        if(power.length>=2) pool=power;
      }
      var fitOn=useCase && (powerNamed || pool.every(function(p){ return POWER_SECTIONS[p.sheet_display]||/\bcar\b/i.test(p.product_name||''); }));
      if(P.content.length || fitOn){
        codes=pool.map(function(p){ var r=scoreProduct(p,P), f=fitOn?deviceFit(p,classes):0; return {c:String(p.item_code),s:r.score+f,f:f}; })
          .filter(function(r){ return r.s>0; }).sort(function(a,b){ return (b.s-a.s)||(b.f-a.f); }).map(function(r){ return r.c; });
      }
      if(res.codes && res.codes.length===1 && codes.indexOf(res.codes[0])<0) codes.unshift(res.codes[0]);
    }
    var byCode={}; products.forEach(function(p){ byCode[String(p.item_code)]=p; });
    var out=[], perModel={};
    for(var i=0;i<codes.length && out.length<max;i++){
      var p=byCode[codes[i]]; if(!p) continue;
      var m=lc(p.model).trim()||codes[i];
      if((perModel[m]||0)>=2) continue;
      perModel[m]=(perModel[m]||0)+1; out.push(codes[i]);
    }
    return out;
  }
  function candidateText(p){ return [p.product_name,p.features,p.description].join(' '); }

  /* LOCAL | AI_WITH_CATALOG | AI_WITH_WEB. opts.manual = user pressed "Ask VERO AI". */
  /* p2r3a: price history from a QueryPlan (Taglish verbs, anchors, type pool) through the proven p2r2.1 executor:
     effective dates only, never priceSchedule, dealers SRP only. */
  function historyFromPlan(products,q,H,codes,poolCodes,thing,ctx){
    var by={}; (products||[]).forEach(function(p){ if(p && !p.disabled) by[String(p.item_code)]=p; });
    var P={ raw:String(q||''), norm:String(q||'').toLowerCase(), codes:[], content:[], asks:{}, nlu:{ hist:H, raw:String(q||'') }, thingLabel:thing||null };
    if(poolCodes) P.poolOverride=poolCodes.map(function(c){ return by[c]; }).filter(Boolean);
    var res={ query:P.raw, parsed:P, type:'none', codes:[], fields:[], chips:[], note:'', needsAI:false, aiReason:'' };
    var ex=(codes||[]).map(function(c){ return { p:by[c] }; }).filter(function(o){ return !!o.p; });
    return historyAnswer(products,P,ctx||{},res,ex);
  }
  /* p2r3a: the QueryPlan route decides; candidates = plan candidates (anchor first, same family, >= 2). Payload schema unchanged. */
  function planRoute(products, res, opts){
    var pl=res.plan, r=pl.route||{}, out={ route:'local', candidates:[], canEscalate:false, web:null, brain:true };
    var have={}, by={}; products.forEach(function(p){ if(p && !p.disabled){ have[String(p.item_code)]=1; by[String(p.item_code)]=p; } });
    var cands=(r.candidates||[]).filter(function(c){ return have[c]; }).slice(0,8);
    if(r.route==='AI_CATALOG' && cands.length>=2){ out.route='catalog'; out.candidates=cands; return out; }
    if(r.route==='WEB' && cands.length>=2){ out.route='web'; out.candidates=cands; return out; }
    if(r.route==='LOCAL' && (pl.intent==='list'||pl.intent==='exist') && (pl.flags.devices.named.length||pl.flags.devices.classes.length) && (res.codes||[]).length>=2) out.canEscalate=true;
    if(opts && opts.manual){                                            /* "Ask VERO AI": shown products, max 2 per model, one family */
      var fam=null, perModel={}, list=[];
      (res.codes||[]).forEach(function(c){ var p=by[c]; if(!p || list.length>=8) return; var f=p.sheet_display; if(fam===null) fam=f; if(f!==fam) return;
        var m=lc(p.model).trim()||c; if((perModel[m]||0)>=2) return; perModel[m]=(perModel[m]||0)+1; list.push(c); });
      if(list.length>=2 && pl.intent!=='smalltalk' && pl.intent!=='price_history' && pl.intent!=='coach'){ out.route='catalog'; out.candidates=list; }
    }
    return out;
  }
  function aiRoute(products, query, res, opts){
    opts=opts||{};
    if(res && res.plan) return planRoute(products, res, opts);
    var out={ route:'local', candidates:[], canEscalate:false, web:null };
    if(!res||!res.parsed) return out;
    var P=res.parsed;
    if(P.rank || P.local) return out;                                  // p2r1/p2r2: ranking, spec and price-history intents -> LOCAL only, never the Worker (even manual)
    var exact = P.codes.length && (res.type==='lookup'||res.type==='list'||res.type==='none') && !P.recommend;
    if(!opts.manual){
      if(exact || (res.fields && res.fields.length) || (res.type==='compare' && !P.recommend)){ return out; }
      var eligible = res.needsAI || (res.type==='none' && descriptiveWords(P).length>=2);
      if(!eligible){ out.canEscalate=canEscalate(res); return out; }
    }
    var cands=aiCandidates(products,res,8);
    if(cands.length<2) return out;
    var byCode={}; products.forEach(function(p){ byCode[String(p.item_code)]=p; });
    var dec=webDecision(String(query||''), cands.map(function(c){ return candidateText(byCode[c]); }));
    out.route=dec.web?'web':'catalog'; out.candidates=cands; out.web=dec;
    return out;
  }

  var API={ parse:parse, answer:answer, search:search, exactMatches:exactMatches,
            productWatts:productWatts, productMah:productMah, productPorts:productPorts, lenMeters:lenMeters,
            webDecision:webDecision, aiRoute:aiRoute, aiCandidates:aiCandidates, canEscalate:canEscalate, legacyAnswer:legacyAnswer, historyFromPlan:historyFromPlan, version:'p2r3a' };
  if(typeof module!=='undefined' && module.exports) module.exports=API;
  root.VeroEngine=API;
})(typeof window!=='undefined'?window:globalThis);
