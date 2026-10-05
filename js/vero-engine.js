/* VERO — local lookup engine (Phase 1).
   Pure logic: no DOM, no network, no AI. Works in the browser (window.VeroEngine)
   and in Node (module.exports) for tests.
   Every answer returns item_codes only; the UI reads prices from the live
   product objects at render time, so prices always come from the pricelist. */
(function(root){
  'use strict';

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

  var MAXW = /(?:under|below|less than|lower than|max(?:imum)?|up to|hanggang|wala pang|<=?|not more than)\s*$/;
  var MINW = /(?:above|over|more than|higher than|at least|min(?:imum)?|>=?|starting|from)\s*$/;

  /* ---------- query parsing ---------- */
  function parse(q){
    var raw=String(q||'');
    var s=lc(raw).replace(/₱|\bphp\b|\bpesos?\b/g,' ₱ ').replace(/(\d),(\d{3})/g,'$1$2');
    s=s.replace(/(\d+(?:\.\d+)?)\s?k\b/g,function(_,n){ return String(Math.round(parseFloat(n)*1000)); });
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
      if(P.watts && !cmpOp(x.watts,P.watts,0.01)) return false;
      if(P.mah && !cmpOp(x.mah,P.mah,0)) return false;
      if(P.lengthM && !cmpOp(x.len,P.lengthM,0.001)) return false;
      return true;
    });
    if(!opt.sheet){
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

  /* ---------- main entry ---------- */
  /* products: the list the user is allowed to see (caller passes ALL_PRODUCTS minus disabled;
     in dealer mode that list is already the dealer's own SKUs).
     ctx: { sheet: restrict to a section (from a clarify chip), compareCodes: [...] } */
  function answer(products,query,ctx){
    ctx=ctx||{};
    var P=parse(query);
    var res={ query:String(query||''), parsed:P, type:'none', codes:[], fields:fieldList(P), chips:[], note:'', needsAI:false, aiReason:'' };
    if(P.recommend){ res.needsAI=true; res.aiReason='recommendation/compatibility'; }

    if(ctx.compareCodes && ctx.compareCodes.length){
      res.type='compare'; res.codes=ctx.compareCodes.slice(0,4); return res;
    }

    var ex=exactMatches(products,P);
    var exCodes=ex.map(function(o){ return String(o.p.item_code); });

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

  var API={ parse:parse, answer:answer, search:search, exactMatches:exactMatches,
            productWatts:productWatts, productMah:productMah, lenMeters:lenMeters, version:'p1' };
  if(typeof module!=='undefined' && module.exports) module.exports=API;
  root.VeroEngine=API;
})(typeof window!=='undefined'?window:globalThis);
