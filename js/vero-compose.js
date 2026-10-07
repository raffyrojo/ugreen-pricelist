/* VERO Local Brain — answer composer (p2r3a).
   QueryPlan (js/vero-plan.js) -> the SAME `res` object vero.js already renders
   ({ type, codes, note, chips, fields, detail, stockNote, parsed, local, … } + echo, lang, plan, ctxOut).
   Rules
     - Prices never go into text here: cards read live prices for the current role (dealer = Special DP) at render time.
     - Wording comes from VeroLexicon.replies (en / tl). Taglish reply when the user writes Taglish.
     - Evidence labels kept: "Per product features: …", "mentioned only in product descriptions, not confirmed", MagSafe caution,
       device-compatibility caveat. "Listed in the pricelist" is never a stock claim; stock words always add the stock caveat.
     - Never "equivalent / same as / exact replacement".
     - Price history keeps the proven p2r2.1 executor (passed in as `legacy`).
   No network, no storage. Browser: window.VeroCompose; Node: module.exports. */
(function(root){
  'use strict';
  var VERSION='p2r3a';
  var M={};
  function dep(name,file){ if(root[name]) return root[name]; if(!M[name] && typeof require==='function'){ try{ M[name]=require(file); }catch(e){} } return M[name]||null; }
  function LEX(){ return dep('VeroLexicon','./vero-lexicon.js'); }
  function FACTS(){ return dep('VeroFacts','./vero-facts.js'); }
  function PLAN(){ return dep('VeroPlan','./vero-plan.js'); }
  function ready(){ return !!(LEX() && FACTS() && PLAN() && (root.VeroNLU || dep('VeroNLU','./vero-nlu.js'))); }

  function fill(t,o){ return String(t||'').replace(/\{(\w+)\}/g,function(m,k){ return o&&o[k]!=null?o[k]:''; }); }
  function T(lang,key,o){ var R=LEX().replies, s=(R[lang]&&R[lang][key])||R.en[key]||''; return fill(s,o); }
  function fmtNum(n){ return String(n).replace(/\B(?=(\d{3})+(?!\d))/g,','); }
  function uniq(a){ var o=[], s={}; (a||[]).forEach(function(x){ if(!s[x]){ s[x]=1; o.push(x); } }); return o; }
  var CONN0={ usb_c:'USB-C', usb_a:'USB-A', lightning:'Lightning', hdmi:'HDMI', dp:'DisplayPort', vga:'VGA', dvi:'DVI', rj45:'LAN', micro_usb:'Micro USB', aux35:'3.5mm', thunderbolt:'Thunderbolt', usb4:'USB4', sd:'SD', tf:'microSD', m2:'M.2' };
  /* fix-pack 2 #5: one label table (lexicon.connectorLabels) with a readable fallback — a user never sees "undefined" */
  function connLabel(k){ var L=LEX()&&LEX().connectorLabels; return (L&&L[k])||CONN0[k]||String(k==null?'':k).replace(/_/g,' ').replace(/\b\w/g,function(x){ return x.toUpperCase(); }); }
  var CONN=new Proxy({},{ get:function(o,k){ return typeof k==='string'?connLabel(k):undefined; } });
  var RES={ 1:'720p', 2:'1080p', 3:'2K', 4:'4K', 5:'5K', 6:'8K' };

  /* ---------- labels ---------- */
  function niceCase(t){ return String(t||'').replace(/\b(hdmi|usb|lan|nas|dp|vga|dvi|gan|pd|sd|tf)\b/g,function(w){ return w.toUpperCase(); }).replace(/\busb-c\b/gi,'USB-C').replace(/\busb-a\b/gi,'USB-A'); }
  var DEV_CASE={ ps5:'PS5', playstation:'PlayStation', iphone:'iPhone', ipad:'iPad', macbook:'MacBook', imac:'iMac', mac:'Mac', xbox:'Xbox', samsung:'Samsung', galaxy:'Galaxy', pixel:'Pixel', thinkpad:'ThinkPad', chromebook:'Chromebook', air:'Air', pro:'Pro', max:'Max', mini:'mini', plus:'Plus', ultra:'Ultra', nintendo:'Nintendo', 'switch':'Switch', steam:'Steam', deck:'Deck' };
  function devLabel(d){ return String(d||'').split(/\s+/).map(function(w){ return DEV_CASE[w]||(/^[ms]\d/.test(w)?w.toUpperCase():w); }).join(' '); }
  function familyOf(id){ return (LEX().taxonomy.families.filter(function(f){ return f.id===id; })[0])||null; }
  function plural(w){ if(!w) return w; if(/s$|nas$/i.test(w)) return w; if(/(ch|sh|x)$/.test(w)) return w+'es'; if(/y$/.test(w) && !/[aeiou]y$/.test(w)) return w.slice(0,-1)+'ies'; return w+'s'; }
  function nounOf(plan,many){
    var t=plan.type;
    if(t){
      var f0=familyOf(t.family);
      if(t.term && f0 && t.term.toLowerCase()===String(f0.label).toLowerCase()) return niceCase(many?(f0.plural||plural(t.term)):t.term);
      if(t.term && !/^cat/.test(t.term)) return niceCase(many?plural(t.term):t.term);
      var f=familyOf(t.family);
      if(f){ if(t.subtype){ var s=(f.subtypes||[]).filter(function(x){ return x.id===t.subtype; })[0]; if(s) return many?plural(s.label.split('/').pop()):s.label; }
             return many?(f.plural||plural(f.label)):f.label; }
    }
    if(plan.form) return many?plural(plan.form):plan.form;
    return many?'products':'product';
  }
  function label(plan,many){
    var pre=[], post=[], L=LEX(), R0=plan.result;
    plan.filters.forEach(function(f){
      var op=f.op==='ge'?'≥':(f.op==='gt'?'>':(f.op==='le'?'≤':''));
      if(f.attr==='watts') pre.push(op+f.value+'W');
      else if(f.attr==='mah') pre.push(op+fmtNum(f.value)+'mAh');
      else if(f.attr==='lengthM') pre.push(f.op==='between'?(f.value[0]+'–'+f.value[1]+'m'):(op+f.value+'m'));
      else if(f.attr==='price') post.push(f.op==='between'?('₱'+fmtNum(f.value[0])+'–₱'+fmtNum(f.value[1])):((f.op==='le'||f.op==='lt')?'under ₱'+fmtNum(f.value):'over ₱'+fmtNum(f.value)));
      else if(f.attr==='ports') post.push('with '+(f.op==='ge'?'at least ':'')+f.value+' ports');
      else if(f.attr==='videoOut') post.push('for '+(f.op==='ge'?'at least ':'')+f.value+' displays');
    });
    plan.match.forEach(function(m){
      if(m.k==='flag'){ var lab=(L.flags[m.v]||{}).label||m.v; if(/^with /.test(lab)) post.push(lab); else pre.push(lab); }
      else if(m.k==='color') pre.unshift(m.v);
      else if(m.k==='res') pre.push(RES[m.v]+(m.q && !plan.pair?' '+CONN[m.q]:''));
      else if(m.k==='refresh') pre.push((m.label||'')+(m.q?' '+CONN[m.q]:''));
      else if(m.k==='hdmiver') pre.push(m.label);
      else if(m.k==='size') pre.push(m.label);
      else if(m.k==='namephrase'){ if(m.withLabel) post.push('with '+m.label.replace(/^for /,'')); else if(/^for /.test(m.label)) post.push(m.label); else pre.push(m.label); }
      else if(m.k==='nameword' && !(R0 && R0.droppedQualifiers && R0.droppedQualifiers.indexOf(m.v)>=0)) pre.push(m.v);
      else if(m.k==='gbps') pre.push(m.label);
      else if(m.k==='eth') pre.push(m.label);
    });
    (plan.standards||[]).forEach(function(s){ pre.push(s.replace(/^cat/,'Cat')); });
    var noun=nounOf(plan,many);
    if(plan.pair) pre.push(CONN[plan.pair.from]+' to '+CONN[plan.pair.to]);
    else plan.connectors.forEach(function(k){ var lab=CONN[k]||k; if(pre.some(function(x){ return x.toLowerCase().indexOf(lab.toLowerCase())>=0; }) || noun.toLowerCase().indexOf(lab.toLowerCase())>=0) return; pre.push(lab); });
    (plan.ports||[]).forEach(function(p){ post.push('with '+(p.op==='ge'?p.value+'+ ':'')+(CONN[p.kind]||p.kind)+(p.op==='ge'?' ports':'')); });
    return (pre.join(' ')+' '+noun+(post.length?' '+post.join(', '):'')).replace(/\s+/g,' ').trim();
  }
  function article(w){ return /^[aeiou8]|^(11|18)\d?W|^(HDMI|LAN|NAS|USB|SD|M\.2)/i.test(w)?'an':'a'; }

  /* ---------- evidence tail ---------- */
  function evidenceTail(plan,R,lang){
    var parts=[];
    if(R.medium) parts.push(T(lang,'perFeatures',{ n:R.medium }));
    if(R.mentioned&&R.mentioned.length) parts.push(T(lang,'mentioned',{ codes:R.mentioned.slice(0,5).join(', ')+(R.mentioned.length>5?' …':'') }));
    var dev=plan.flags.devices; if(dev.named.length||dev.classes.length) parts.push(T(lang,'compat',{ device:devLabel((dev.named[0]&&dev.named[0].label)||dev.classes[0]) }));
    return parts.length?' ('+parts.join('; ')+')':'';
  }
  function detailMap(R){ var d={}; Object.keys(R.evidence||{}).forEach(function(c){ d[c]='Per product features: “'+String(R.evidence[c]).trim().slice(0,110)+'”'; }); return d; }

  /* ---------- zero-result facets: values that actually exist for that family (not nearest-match scoring) ---------- */
  var FACET_ATTR={ watts:function(F){ return F.attrs.watts.value; }, mah:function(F){ return F.attrs.mah.value; }, lengthM:function(F){ return F.attrs.lengthM.value; } };
  function facets(plan,idx){
    var R=plan.result||{}; if(!plan.type || !R.facet) return null;
    var f=plan.filters.filter(function(x){ return x.attr===R.facet.attr; })[0]; if(!f) return null;
    var vals={};
    R.facet.codes.forEach(function(code){ var F=idx.byCode[code]; if(!F) return; var v=FACET_ATTR[f.attr](F); if(v!=null && v>0) vals[v]=(vals[v]||0)+1; });
    var ks=Object.keys(vals).map(Number).sort(function(a,b){ return a-b; }); if(!ks.length) return null;
    var unit=f.attr==='watts'?'W':(f.attr==='mah'?'mAh':'m');
    var lab=function(v){ return (f.attr==='mah'?fmtNum(v):v)+unit; };
    var askOf=function(v){ var cp={}; for(var k in plan) cp[k]=plan[k]; cp.filters=plan.filters.map(function(x){ return x===f?{ attr:x.attr, op:'eq', value:v }:x; }); return label(cp,false); };
    var rest={}; for(var k in plan) rest[k]=plan[k]; rest.filters=plan.filters.filter(function(x){ return x!==f && x.attr!=='price'; });
    return { attr:f.attr, values:ks, family:label(rest,true), text:ks.slice(0,10).map(lab).join(' · ')+(ks.length>10?' …':''),
      chips:ks.slice(0,8).map(function(v){ return { label:lab(v), ask:askOf(v), count:vals[v] }; }) };
  }

  /* ---------- compose ---------- */
  function compose(plan,env){
    var lang=plan.lang||'en', R=plan.result||{ codes:[], mentioned:[], related:[], evidence:{}, caveats:[] }, idx=env.idx, byCode=env.byCode;
    var res={ query:plan.q, type:'text', codes:[], fields:[], chips:[], note:'', detail:{}, needsAI:false, aiReason:'', local:true, brain:VERSION,
      parsed:{ raw:plan.q, codes:[], content:[], asks:{}, priceField:plan.priceField, local:true, brain:true }, lang:lang,
      echo:plan.echo?T(lang,'using',{ x:plan.echo }):null };
    var I=plan.intent, rt=plan.route.route;
    if(plan.flags.stock) res.stockNote=T(lang,plan.flags.invQty?'stockQty':'stock');
    var hi=plan.greeting?T(lang,'hiPrefix'):'';
    function done(){ if(hi && res.note) res.note=hi+res.note; return res; }

    if(I==='smalltalk'){ res.note=T(lang,plan.smalltalk); res.smalltalk=plan.smalltalk; return res; }
    if(I==='coach' || rt==='COACH_FUTURE'){ res.note=T(lang,'coach'); if(plan.subject.length){ res.type='list'; res.codes=plan.subject.slice(0,4); } return done(); }
    if(I==='price_history'){
      var E=root.VeroEngine||dep('VeroEngine','./vero-engine.js'), H0=plan.history||{}, h;
      var H={ dir:H0.dir, metric:H0.metric||'peso', field:H0.field||'srp', period:H0.period||null, n:H0.n||null, kind:H0.kind==='amount'?'list':(H0.kind||'list'), threshold:null };
      if(E && E.historyFromPlan){
        var poolCodes=null, thing=null;
        if(plan.type && !plan.subject.length){ poolCodes=Object.keys(idx.byCode).filter(function(c){ var F=idx.byCode[c]; return F.type.family===plan.type.family && (!plan.type.subtype || F.type.subtype===plan.type.subtype); }); thing=nounOf(plan,false); }
        h=E.historyFromPlan(env.products,plan.q,H,plan.subject,poolCodes,thing,env.legacyCtx);
      } else h=env.legacy(env.products,plan.q,env.legacyCtx);
      h.brain=VERSION; h.lang=lang; h.echo=res.echo; h.local=true; if(plan.flags.stock) h.stockNote=res.stockNote; return h;
    }
    if(rt==='CLARIFY'){
      res.type='clarify';
      var amb=plan.ambiguity[0]||{};
      if(amb.slot==='number'){ var n=amb.value, lp=(env.conv&&env.conv.lastPlan)||{}, fam=lp.type&&lp.type.family, ks=(LEX().keySpecs||{})[fam]||[], opts=[];
        if(ks.indexOf('watts')>=0) opts.push({ label:n+'W', ask:plan.q.replace(String(n),n+'W') });
        if(ks.indexOf('mah')>=0 && n>=1 && n<=60) opts.push({ label:fmtNum(n*1000)+'mAh', ask:plan.q.replace(String(n),n+'k mAh') });
        if(ks.indexOf('lengthM')>=0 && n<=30) opts.push({ label:n+'m', ask:plan.q.replace(String(n),n+'m') });
        opts.push({ label:'under ₱'+fmtNum(n), ask:plan.q.replace(String(n),'under ₱'+n) });
        res.chips=opts; res.note=T(lang,'clarifyNumber',{ options:opts.map(function(o){ return o.label; }).join(lang==='tl'?' o ':' or ') }); return done(); }
      if(amb.slot==='anchor'){ var un=plan.anchors.filter(function(a){ return !a.codes.length; }).map(function(a){ return a.raw.toUpperCase(); });
        res.type='text'; res.note=T(lang,'nameNotFound',{ x:un.join(', ') }); return done(); }
      if(I==='compare' || (amb.slot==='target' && plan.refs.some(function(r){ return r.kind==='all'; }))){ res.note=T(lang,'clarifyCompare'); return done(); }
      if(amb.slot==='target'){ res.note=T(lang,'clarifyTarget'); return done(); }
      if(amb.slot==='name'){ res.type='text'; res.note=T(lang,'nameNotFound',{ x:amb.value }); return done(); }
      if(amb.slot==='cable'){ var cq=plan.q.replace(/\b(?:with|may|meron|w\/)\s+((?:[a-z0-9-]+\s+)?)(?:cables?|kable)\b/i,'').replace(/\s+/g,' ').trim();
        res.note=T(lang,'cableClarify'); res.chips=[{ label:lang==='tl'?'Built-in cable':'Built-in cable', ask:cq+' built-in cable' },{ label:lang==='tl'?'Kahit ano':'Any', ask:cq }]; return done(); }
      if((I==='recommend' || I==='compat') && /\b(client|clients|customer|customers|kliyente|buyer)\b/i.test(plan.q)){ res.note=T(lang,'clarifyClient');
        res.chips=['Charger','Power bank','Hub / dock','Cable','NAS'].map(function(x){ return { label:x, ask:x==='Hub / dock'?'usb-c hub':x.toLowerCase() }; }); return done(); }
      if(I==='recommend' || I==='compat'){ res.note=T(lang,'clarifyJudgement'); return done(); }
      if(plan.form==='cable'){ res.note=T(lang,'clarifyCable'); res.chips=['HDMI cable','DisplayPort cable','USB-C to HDMI cable','LAN cable'].map(function(x){ return { label:x, ask:x }; }); return done(); }
      res.note=T(lang,'clarifyType'); return done();
    }
    if(I==='compare'){
      var multi=plan.anchors.filter(function(a){ return a.codes.length>1; })[0];
      if(multi && plan.anchors.length>1){ res.type='list'; res.codes=multi.codes.slice();
        res.note=(lang==='tl'?'May '+multi.codes.length+' SKU ang model '+multi.raw.toUpperCase()+'. I-tap ang Compare sa mga gusto mo, o gamitin ang item codes.':'Model '+multi.raw.toUpperCase()+' has '+multi.codes.length+' SKUs. Tap Compare on the ones you want, or use item codes.'); return done(); }
      res.type='compare'; res.codes=plan.subject.slice(0,4);
      var v=R.verdict;
      if(v){ var ml={ srp:'SRP', dp:'DP', dp_volume:'DP Vol', watts:'wattage', mah:'capacity', ports:'port count', nasBays:'bay count', lengthM:'length' }[v.metric]||v.metric;
        if(v.winner){ var other=res.codes.filter(function(x){ return x!==v.winner; })[0], d='';
          if(other!=null && v.values[other]!=null && (v.metric==='srp'||v.metric==='dp'||v.metric==='dp_volume')) d=' (by ₱'+fmtNum(Math.abs(v.values[v.winner]-v.values[other]).toFixed(2).replace(/\.00$/,''))+')';
          var better=v.dir==='min'?((v.metric==='srp'||v.metric==='dp'||v.metric==='dp_volume')?'lower':'smaller'):'higher';
          res.note=T(lang,'verdict',{ winner:v.winner, better:better, betterTl:v.dir==='min'?'mababa':'mataas', metric:ml, diff:d }); }
        else if(v.tie) res.note=T(lang,'verdictTie',{ metric:ml });
        else res.note=T(lang,'verdictUnknown',{ metric:ml, codes:Object.keys(v.values).filter(function(x){ return v.values[x]==null; }).join(', ') }); }
      return done();
    }
    if(I==='alternative'){
      var base=plan.subject[0];
      if(R.executor==='same-but'){
        var SPEC={ watts:function(v){ return 'wattage ('+v+'W)'; }, mah:function(v){ return 'capacity ('+fmtNum(v)+'mAh)'; }, lengthM:function(v){ return 'length ('+v+'m)'; },
                   ports:function(v){ return 'port count ('+v+')'; }, nasBays:function(v){ return 'bays ('+v+')'; } };
        var spec=(R.keep||[]).map(function(k){ return SPEC[k.k]?SPEC[k.k](k.v):k.k; });
        var extra=plan.match.filter(function(m){ return m.k==='flag'; }).map(function(m){ return (LEX().flags[m.v]||{}).label||m.v; });
        var specTxt=(spec.join(' and ')||'product type')+(extra.length?' '+extra.join(', '):'');
        if(plan.alternative.direction!=='cheaper'){ res.type=R.codes.length?'list':'text'; res.codes=R.codes; res.detail=detailMap(R);
          res.note=R.codes.length?((lang==='tl'?R.codes.length+' na option na pareho ang ':R.codes.length+' options with the same ')+specTxt+':'):(lang==='tl'?'Walang option na pareho ang ':'No option with the same ')+specTxt+(lang==='tl'?' sa current pricelist.':' in the current pricelist.'); return done(); }
        if(R.codes.length){ res.type='list'; res.codes=R.codes; res.detail=detailMap(R); res.note=T(lang,'cheaper',{ n:R.codes.length, spec:specTxt }); res.fields=[plan.priceField]; }
        else { res.type='lookup'; res.codes=[base]; res.note=T(lang,'cheaperNone',{ spec:specTxt }); }
        return done();
      }
      res.type='lookup'; res.codes=[base]; res.note=T(lang,'alternativePending',{ code:base }); return done();
    }
    if(I==='attribute'){
      var A=plan.attribute, codes=(plan.subject.length?plan.subject:R.codes).slice();
      if(R.codes && R.codes.length && plan.subject.length) codes=R.codes.slice();
      var FIELDS={ srp:['srp'], dp:['dp'], dp_volume:['dp_volume'], moq:['moq'], price:['srp','dp','dp_volume'], sku:[] };
      if(FIELDS[A]){ var fl=[]; (plan.attributes&&plan.attributes.length?plan.attributes:[A]).forEach(function(a){ (FIELDS[a]||[]).forEach(function(f){ if(fl.indexOf(f)<0) fl.push(f); }); }); res.fields=fl; res.codes=codes; res.type=codes.length===1?'lookup':'list';
        if(A==='sku' && codes.length===1){ var p0=byCode[codes[0]]; res.note='SKU '+codes[0]+' — '+String(p0&&p0.product_name||'').replace(/\s+/g,' ').trim()+':'; }
        else if(A==='sku') res.note=codes.length+' '+label(plan,true)+(lang==='tl'?' — nasa bawat card ang item code:':' — item codes on each card:');
        else if(codes.length>1 && plan.attrFromContext==='results') res.note=(lang==='tl'?'Heto ang '+A.toUpperCase()+' ng huling results:':A.toUpperCase().replace('DP_VOLUME','DP Vol')+' for your last results:');
        else if(codes.length>1){ var ra2=plan.anchors.filter(function(a){ return a.codes.length; }), m0=byCode[codes[0]]; res.note=(ra2.length===1&&m0&&m0.model?'Model '+String(m0.model).toUpperCase()+' has '+codes.length+' SKUs:':(ra2.length>1?codes.length+' SKUs for '+ra2.map(function(a){ return a.raw.toUpperCase(); }).join(' and ')+':':'')); }
        return done(); }
      if(A==='description'){ var pd=byCode[codes[0]]; res.type='lookup'; res.codes=codes.slice(0,1);
        res.note=codes[0]+' — '+String((pd&&(pd.description||pd.short_desc))||(lang==='tl'?'walang description sa pricelist':'no description in the pricelist')).replace(/\s+/g,' ').trim().slice(0,320); return done(); }
      if(A==='colors'){ res.type='list'; res.codes=R.codes.length?R.codes:codes;
        var cols=uniq(res.codes.map(function(c){ return String((byCode[c]||{}).color||'').trim(); }).filter(Boolean));
        res.note=(res.codes.length>1?(lang==='tl'?'Naka-lista sa pricelist ang mga kulay na ':'Listed colours: ')+cols.join(', ')+'.':(lang==='tl'?'Isang kulay lang ang naka-lista':'Only one colour is listed')+(cols.length?' ('+cols[0]+')':'')+'.'); return done(); }
      var vals=R.values||{}, attrName={ speed:'speed', nasBays:'bays', nasCpu:'CPU', nasRam:'RAM' }[A]||A;
      if(codes.length===1 && plan.subject.length){ var v1=vals[codes[0]]; res.type='lookup'; res.codes=codes;
        res.note=v1?T(lang,'attrOne',{ code:codes[0], attr:attrName, value:v1.value, src:v1.tier==='strong'?'':(lang==='tl'?' (ayon sa product features)':' (per product features)') }):T(lang,'attrNone',{ attr:attrName, code:codes[0] }); return done(); }
      res.type=codes.length?'list':'text'; res.codes=codes;
      var dist={}; codes.forEach(function(c){ if(vals[c]){ dist[vals[c].value]=(dist[vals[c].value]||0)+1; res.detail[c]=attrName.replace(/^./,function(x){ return x.toUpperCase(); })+': '+vals[c].value+(vals[c].tier==='strong'?' (product name)':' (per product features)'); } });
      var dk=Object.keys(dist), unknownN=codes.filter(function(c){ return !vals[c]; }).length;
      res.note=codes.length?(T(lang,'attrList',{ label:codes.length+' '+label(plan,true), attr:attrName })+' '+dk.map(function(k){ return k+' ('+dist[k]+')'; }).join(' · ')+(unknownN?(lang==='tl'?' · hindi naka-lista: ':' · not listed: ')+unknownN:'')):T(lang,'none',{ a:article(label(plan,false)), label:label(plan,false) });
      return done();
    }
    /* catalog lists: exist / count / list / rank, and the local part of AI / WEB routes */
    var codes2=(rt==='AI_CATALOG'||rt==='WEB')?(plan.route.candidates.length?plan.route.candidates:R.codes):R.codes;
    if((I==='lookup'||I==='exist'||I==='compat'||I==='recommend') && plan.subject.length){
      codes2=plan.subject.slice(); res.type=codes2.length===1?'lookup':'list'; res.codes=codes2;
      if(plan.flags.stock && (I==='exist'||I==='lookup')){ var ra0=plan.anchors.filter(function(a){ return a.codes.length; }), p0=byCode[codes2[0]];
        var xl=(ra0.length===1 && (ra0[0].via==='model'||ra0[0].via==='name') && p0 && p0.model)?String(p0.model).toUpperCase():(codes2.length===1?(p0&&p0.model?String(p0.model).toUpperCase()+' ('+codes2[0]+')':codes2[0]):codes2.join(', '));
        if(ra0.length===1 && (ra0[0].via==='model'||ra0[0].via==='name') && codes2.length>1) xl+=lang==='tl'?' ('+codes2.length+' SKU)':' ('+codes2.length+' SKUs)';
        res.note=T(lang,'invListed',{ x:xl }); res.type='list'; }                     /* 'list' so the drawer shows this sentence above the card (a 'lookup' card has no note line) */
      else if(I==='exist') res.note=(lang==='tl'?'Oo — ':'Yes — ')+T(lang,'listed').replace(/^./,function(x){ return x.toLowerCase(); });
      else if(codes2.length>1){ var ra=plan.anchors.filter(function(a){ return a.codes.length; }), mm=byCode[codes2[0]];
        res.note=(ra.length===1 && mm && mm.model)?('Model '+String(mm.model).toUpperCase()+' has '+codes2.length+' SKUs:'):(ra.length>1?(lang==='tl'?codes2.length+' na SKU para sa '+ra.map(function(a){ return a.raw.toUpperCase(); }).join(' at ')+':':codes2.length+' SKUs for '+ra.map(function(a){ return a.raw.toUpperCase(); }).join(' and ')+':'):''); }
      if(I==='compat'||I==='recommend'){ var d2=plan.flags.devices; if(d2.named.length||d2.classes.length) res.note=(res.note?res.note+' ':'')+T(lang,'compat',{ device:devLabel((d2.named[0]&&d2.named[0].label)||d2.classes[0]) })+'.'; }
      if(rt==='AI_CATALOG'||rt==='WEB'){ res.needsAI=true; res.aiReason='recommendation/compatibility'; }
      return done();
    }
    var many=codes2.length!==1, lab=label(plan,many), lab1=label(plan,false), tail=evidenceTail(plan,R,lang);
    res.detail=detailMap(R);
    if(plan.sort && plan.sort[0] && /^(srp|dp|dp_volume)$/.test(plan.sort[0].by)) res.fields=[plan.sort[0].by];
    else if(plan.filters.some(function(f){ return f.attr==='price'; })) res.fields=[plan.priceField];
    var related=(R.related||[]).filter(function(c){ return codes2.indexOf(c)<0; });
    if(!codes2.length){
      var fc=facets(plan,idx);
      res.type=related.length?'list':'text';
      if(plan.flags.stock) res.note=T(lang,'invNone',{ label:plan.unknownNoun||lab1 });
      else if(plan.unknownNoun) res.note=T(lang,'noNoun',{ x:plan.unknownNoun });
      else res.note=(I==='count'?'0 — ':'')+T(lang,'existNo',{ a:article(lab1)+' ', label:lab1, tail:'' }).replace('  ',' ');
      if(fc){ var famN=fc.family; res.note+=' '+T(lang,'facets',{ family:lang==='tl'?famN:famN.replace(/^./,function(x){ return x.toUpperCase(); }), values:fc.text }); res.chips=fc.chips; }
      if(related.length){ res.codes=related; related.forEach(function(c){ res.detail[c]='Magnetic wireless (product name) — MagSafe not explicitly confirmed'; });
        res.note+=' '+T(lang,'magnetic',{ n:related.length, label:nounOf(plan,related.length!==1), them:related.length===1?'this item':'these items' }); }
      if(plan.flags.devices.named.length||plan.flags.devices.classes.length) res.note+=' '+T(lang,'compat',{ device:devLabel((plan.flags.devices.named[0]&&plan.flags.devices.named[0].label)||plan.flags.devices.classes[0]) })+'.';
      return done();
    }
    res.type='list'; res.codes=codes2.slice();
    if(related.length){ related.forEach(function(c){ res.codes.push(c); res.detail[c]='Magnetic wireless (product name) — MagSafe not explicitly confirmed'; }); }
    if(rt==='AI_CATALOG'||rt==='WEB'){ res.needsAI=true; res.aiReason='recommendation/compatibility';
      res.note=(lang==='tl'?'Heto ang mga tugmang product sa pricelist':'Matching products from the pricelist')+tail+':'; return done(); }
    if(I==='rank'){
      var S=plan.sort&&plan.sort[0]||{}, word;
      if(plan.cheaperList) res.note=T(lang,'cheaperList');
      else { word={ srp:{ asc:'Cheapest', desc:'Most expensive' }, dp:{ asc:'Lowest DP', desc:'Highest DP' }, dp_volume:{ asc:'Lowest DP Vol', desc:'Highest DP Vol' }, lengthM:{ asc:'Shortest', desc:'Longest' }, watts:{ asc:'Lowest-wattage', desc:'Highest-wattage' }, mah:{ asc:'Smallest-capacity', desc:'Biggest-capacity' } }[S.by];
        word=word?word[S.dir]:'Top';
        res.note=(plan.limit&&plan.limit>1?('Top '+Math.min(plan.limit,codes2.length)+' — '+word.toLowerCase()+' '+label(plan,true)):(word+' '+lab1))+tail+(R.unknown?(lang==='tl'?' ('+R.unknown+' walang naka-listang value)':' ('+R.unknown+' without a listed value not ranked)'):'')+':'; }
      res.rank={ by:S.by, dir:S.dir, n:plan.limit };
      return done();
    }
    if(plan.flags.stock && (I==='exist'||I==='count'||I==='list')) res.note=T(lang,'invListedList',{ label:label(plan,true) }).replace(/:$/,tail?tail+':':':');
    else if(I==='count') res.note=T(lang,'count',{ n:codes2.length, label:lab, tail:tail });
    else if(I==='exist') res.note=T(lang,'existYes',{ n:codes2.length, label:lab, tail:tail });
    else res.note=T(lang,'list',{ n:codes2.length, label:lab, tail:tail });
    if(plan.unconfirmed && plan.unconfirmed.length) res.note=res.note.replace(/:$/,'')+' ('+T(lang,'unconfirmed',{ x:plan.unconfirmed.join(', '), label:nounOf(plan,true) })+'):';
    if(R.droppedQualifiers && R.droppedQualifiers.length) res.note=res.note.replace(/:$/,'')+(lang==='tl'?' (walang product na may “'+R.droppedQualifiers.join(', ')+'” sa pangalan — lahat ng '+nounOf(plan,true)+' ang pinapakita):':' (no product named “'+R.droppedQualifiers.join(', ')+'” — showing all '+nounOf(plan,true)+'):');
    if(related.length) res.note=res.note.replace(/:$/,'.')+' '+T(lang,'magnetic',{ n:related.length, label:nounOf(plan,related.length!==1), them:related.length===1?'this item':'these items' });
    return done();
  }

  /* ---------- entry point used by VeroEngine.answer ---------- */
  function answer(products,query,ctx,legacy){
    ctx=ctx||{};
    var pool=(products||[]).filter(function(p){ return p && !p.disabled; });
    var idx=FACTS().build(pool), byCode={}; pool.forEach(function(p){ byCode[String(p.item_code)]=p; });
    var conv=ctx.conv||null;
    var plan=PLAN().build(query,{ products:pool, facts:idx, ctx:conv, today:ctx.today });
    var legacyCtx={}; Object.keys(ctx).forEach(function(k){ if(k!=='conv') legacyCtx[k]=ctx[k]; });
    var res=compose(plan,{ idx:idx, byCode:byCode, products:pool, conv:conv, legacy:legacy, legacyCtx:legacyCtx });
    res.query=String(query||''); res.plan=plan; res.ctxOut=PLAN().nextContext(plan,conv||{});
    return res;
  }
  function warm(products){ try{ FACTS().build((products||[]).filter(function(p){ return p && !p.disabled; })); return true; }catch(e){ return false; } }

  var API={ version:VERSION, ready:ready, answer:answer, compose:compose, label:label, warm:warm };
  if(typeof module!=='undefined' && module.exports) module.exports=API;
  root.VeroCompose=API;
})(typeof window!=='undefined'?window:globalThis);
