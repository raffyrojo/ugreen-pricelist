/* VERO NLU — local intent + attribute parsing layer (Phase 2 revision p2r2).
   Pure logic: no DOM, no network, no AI. Browser: window.VeroNLU; Node: module.exports.
   Everything here is derived at runtime from the live catalog fields (structured fields,
   category, section, name, features, description, priceHistory) — no SKU lists, so newly
   published SKUs are understood automatically.
   Evidence tiers for specs: 'strong' = structured field / product name; 'medium' = one
   feature segment holding both the spec and its port/type qualifier; 'weak' =
   description only (never a confirmed Yes). Price history: effective/past events only,
   from priceHistory[] (or the approved seed fallback); priceSchedule[] is NEVER read. */
(function(root){
  'use strict';
  function lc(s){ return String(s==null?'':s).toLowerCase(); }
  function txt(p,f){ return String((p&&p[f])==null?'':p[f]); }

  /* ======================= text normalization ======================= */
  function normText(s){
    return lc(s).replace(/[   ]/g,' ').replace(/[：]/g,':').replace(/\b(8k|4k)\s*[x\u00d7*]\s*(4k|2k)\b/g,'$1').replace(/(\d)\s*[x\u00d7*]\s*(?=[a-z])/g,'$1x ')
      .replace(/\bbuild[\s-]?in\b/g,'built-in').replace(/\bbuilt\s+in\b/g,'built-in')
      .replace(/\bmag\s?safe\b/g,'magsafe').replace(/\bqi\s+2\b/g,'qi2')
      .replace(/\bhdmi\s*(2\.1|2\.0|1\.4)\b/g,'hdmi $1')
      .replace(/\btype[\s-]?c\b/g,'usb-c').replace(/\busb\s+c\b/g,'usb-c');
  }

  /* ======================= feature segmentation ======================= */
  var VIDEO_Q=/\b(hdmi|displayport|dp|vga|dvi|mini\s?dp)\b/g;
  /* Split feature text into segments: lines, bullets (▪ • *), ';' and '|'. A segment that
     names two or more different video ports is split again at each port token, so
     "HDMI 4K@60Hz, DP 8K@30Hz" never makes a product "8K HDMI". */
  function videoKinds(s){ var k={}, m; VIDEO_Q.lastIndex=0; while((m=VIDEO_Q.exec(s))) k[m[1].replace(/\s/g,'').replace('displayport','dp')]=1; return Object.keys(k).length; }
  function splitAtPorts(s){
    var hits=[], m; VIDEO_Q.lastIndex=0;
    while((m=VIDEO_Q.exec(s))){ var k=m[1].replace(/\s/g,'').replace('displayport','dp'); if(!hits.length||hits[hits.length-1].k!==k) hits.push({k:k,i:m.index}); }
    var out=[]; if(hits[0].i>0) out.push(s.slice(0,hits[0].i));
    for(var j=0;j<hits.length;j++) out.push(s.slice(hits[j].i, j+1<hits.length?hits[j+1].i:s.length));
    return out;
  }
  /* Split feature text into segments: lines, bullets (▪ • *), ';' and '|'. A segment naming two or
     more different video ports is split again — first at commas ("4K HDMI, 8K DP"), then at port
     tokens ("HDMI 4K@60Hz DP 8K@30Hz") — so a spec is never attributed to the wrong port. */
  function segments(text){
    var parts=String(text||'').split(/\r?\n|[▪•;|]|\s\*(?=\s*[A-Za-z:])|^\*/m), out=[];
    parts.forEach(function(raw){
      var s=normText(raw).trim().replace(/^\*+/,'').trim(); if(!s) return;
      if(videoKinds(s)<2){ out.push(s); return; }
      s.split(/,/).forEach(function(c){ c=c.trim(); if(!c) return; if(videoKinds(c)>=2) splitAtPorts(c).forEach(function(x){ out.push(x); }); else out.push(c); });
    });
    return out.filter(function(x){ return x.trim(); });
  }

  /* ======================= resolution / refresh helpers ======================= */
  var RES_RANK={'720p':1,'1080p':2,'fhd':2,'2k':3,'1440p':3,'qhd':3,'4k':4,'uhd':4,'5k':5,'8k':6};
  var RES_LABEL={1:'720p',2:'1080p',3:'2K',4:'4K',5:'5K',6:'8K'};
  function pixRank(w,h){ w=+w; h=+h; var big=Math.max(w,h); return big>=7680?6:big>=5120?5:big>=3840?4:big>=2560?3:big>=1920?2:big>=1280?1:0; }
  /* every resolution mention in a string -> [{r:rank,hz:number|null}] */
  function resMentions(s){
    var out=[], m, re=/\b(8k|5k|4k|2k|1080p|1440p|720p|uhd|qhd)\b(?:\s*@\s*|\s+)?(\d{2,3})?\s*(hz)?|\b(\d{3,4})\s*[x*×]\s*(\d{3,4})\s*(?:@\s*(\d{2,3})\s*hz)?/g;
    while((m=re.exec(s))){
      if(m[1]){ var hz=(m[2]&&(m[3]||/@/.test(m[0])))?+m[2]:null; out.push({r:RES_RANK[m[1]]||0,hz:hz}); }
      else { var r=pixRank(m[4],m[5]); if(r) out.push({r:r,hz:m[6]?+m[6]:null}); }
    }
    return out;
  }
  function hzMentions(s){ var out=[],m,re=/\b(\d{2,3})\s*hz\b/g; while((m=re.exec(s))) out.push(+m[1]); return out; }

  /* ======================= product attribute evidence ======================= */
  var LAN_Q=/\b(rj45|ethernet|lan|gigabit|network|cat\s?[5-8]e?|1000\s?mbps|2\.5\s?g(?:bps)?|10\/100)\b/;
  function isLanProduct(p){ return /ethernet adapter/i.test(txt(p,'sheet_display'))||/\b(ethernet|lan|network)\s+(cable|adapter|adaptor|converter|switch|coupler)\b|\bcat\s?[5-8]e?\b/i.test(txt(p,'product_name')); }
  /* a video cable (HDMI/DP/VGA/DVI cable without a data function): its 'Gbps' is video bandwidth */
  function isVideoCable(p){ var n=normText(txt(p,'product_name')); return /\bcables?\b/.test(n) && /\b(hdmi|dp|displayport|vga|dvi)\b/.test(n) && !/\b(data|hub|dock)\b|usb\s?3|gen\s?2/.test(n); }
  function cache(p){
    if(p.__vnlu && p.__vnlu.src===p) return p.__vnlu.x;
    var own=normText(txt(p,'item_code'));
    /* a feature line that names a DIFFERENT item code describes that other SKU (shared copy) — never evidence for this one */
    var foreign=function(s){ var m,re=/\b(\d{5}[a-z]?)\b(?!\s?(?:mah|w|mm|m|hz|mbps|gbps|p|k)\b)/g; while((m=re.exec(s))) if(m[1]!==own) return true; return false; };
    /* p2r2.1 evidence hierarchy: STRONG = structured fields / product name; MEDIUM (confirmed) = authoritative feature
       lines only; WEAK (mentioned, not confirmed) = short_desc + full description. short_desc can be AI-written in the
       CMS, so it is never confirmed evidence for a technical claim. */
    var x={ name:normText(txt(p,'product_name')), segs:segments(txt(p,'features')).filter(function(s){ return !foreign(s); }), desc:normText(txt(p,'description')+'\n'+txt(p,'short_desc')) };
    /* single-function video product: one video port kind in the name and not a multi-port hub/dock */
    x.single = videoKinds(x.name)===1 && !/\+|\d-in-1|\b(hub|dock|docking)\b/.test(x.name) && !/docking and hub/i.test(txt(p,'sheet_display'));
    try{ Object.defineProperty(p,'__vnlu',{value:{src:p,x:x},enumerable:false,configurable:true,writable:true}); }catch(e){}
    return x;
  }
  /* x given = feature/description text: when the product NAME has exactly one video port kind and it is the asked one, every
     line of that product describes that port (e.g. "Mini HDMI to HDMI Adapter" + line "4K@60Hz max"). */
  function qualOk(s,q,x){ if(!q) return true; if(x && x.single && qualOk(x.name,q)) return true; if(q==='hdmi') return /\bhdmi\b/.test(s); if(q==='dp') return /\b(dp|displayport|mini\s?dp)\b/.test(s); if(q==='vga') return /\bvga\b/.test(s); return true; }

  /* Matchers: return 'strong' | 'medium' | 'weak' | null, plus .ev (evidence snippet) */
  var MATCH={
    res:function(p,a){ var x=cache(p);
      function okIn(s,x){ return qualOk(s,a.q,x) && resMentions(s).some(function(m){ return m.r>=a.v; }); }
      if(okIn(x.name)) return {t:'strong'};
      if(qualOk(x.name,a.q) && resMentions(x.name).length) return null; /* the name states a lower resolution: authoritative */
      for(var i=0;i<x.segs.length;i++) if(okIn(x.segs[i],x)) return {t:'medium',ev:x.segs[i]};
      if(okIn(x.desc,x)) return {t:'weak'};
      return null; },
    refresh:function(p,a){ var x=cache(p);
      function okIn(s,x){ if(!qualOk(s,a.q,x)) return false;
        if(a.r) return resMentions(s).some(function(m){ return m.r>=a.r && m.hz!=null && m.hz>=a.hz; });
        return hzMentions(s).some(function(h){ return h>=a.hz; }); }
      if(okIn(x.name)) return {t:'strong'};
      if(qualOk(x.name,a.q) && (a.r ? resMentions(x.name).some(function(m){ return m.hz!=null; }) : hzMentions(x.name).length)) return null; /* name states a lower spec */
      for(var i=0;i<x.segs.length;i++) if(okIn(x.segs[i],x)) return {t:'medium',ev:x.segs[i]};
      if(okIn(x.desc,x)) return {t:'weak'};
      return null; },
    hdmiver:function(p,a){ var x=cache(p);
      function okIn(s){ var m=s.match(/\bhdmi (2\.1|2\.0|1\.4)\b/g); return !!m && m.some(function(t){ return parseFloat(t.slice(5))>=a.v-1e-9; }); }
      if(okIn(x.name)) return {t:'strong'};
      for(var i=0;i<x.segs.length;i++) if(okIn(x.segs[i])) return {t:'medium',ev:x.segs[i]};
      if(okIn(x.desc)) return {t:'weak'};
      return null; },
    gbps:function(p,a){ /* data speed (USB/Thunderbolt). Ethernet speed and video bandwidth are not data speed. */
      if(isLanProduct(p) || isVideoCable(p)) return null; var x=cache(p);
      function nameMax(s){ var v=0,m,re=/(\d+(?:\.\d+)?)\s?g(?:bps)?\b/g; while((m=re.exec(s))) v=Math.max(v,+m[1]); return v; }
      function segMax(s){ if(LAN_Q.test(s) || /\b(hdmi|displayport|dp)\b/.test(s)) return 0; var v=0,m,re=/(\d+(?:\.\d+)?)\s?(?:gbps|gb\/s)\b/g; while((m=re.exec(s))) v=Math.max(v,+m[1]); return v; }
      if(nameMax(x.name)>=a.v) return {t:'strong'};
      for(var i=0;i<x.segs.length;i++) if(segMax(x.segs[i])>=a.v) return {t:'medium',ev:x.segs[i]};
      if(segMax(x.desc)>=a.v) return {t:'weak'};
      return null; },
    eth:function(p,a){ var x=cache(p);
      function speed(s){ if(!LAN_Q.test(s)) return 0; var v=0,m;
        if(/gigabit|1000\s?mbps|\b1\s?g(bps)?\b/.test(s)) v=Math.max(v,1);
        var re=/\b(2\.5|5|10|25|40)\s?(?:gbe|g(?:bps)?\s*(?:base-?t\s*)?(?:ethernet|lan|rj45|network)|gbps?\s*(?:ethernet|lan|rj45|network))\b|\b(?:ethernet|lan|rj45|network)(?:\s+port)?\s*(?:[:\-]|up to|speed(?: of)?)?\s*(2\.5|5|10|25|40)\s?g(?:bps|be)?\b/g;
        while((m=re.exec(s))) v=Math.max(v,+(m[1]||m[2]));
        if(!v && /\b100\s?mbps|10\/100\b/.test(s)) v=0.1; return v; }
      if(speed(x.name)>=a.v) return {t:'strong'};
      for(var i=0;i<x.segs.length;i++) if(speed(x.segs[i])>=a.v) return {t:'medium',ev:x.segs[i]};
      if(speed(x.desc)>=a.v) return {t:'weak'};
      return null; },
    flag:function(p,a){ var x=cache(p), re=FLAGS[a.v].re;
      if(re.test(x.name)) return {t:'strong'};
      for(var i=0;i<x.segs.length;i++) if(re.test(x.segs[i])) return {t:'medium',ev:x.segs[i]};
      if(re.test(x.desc)) return {t:'weak'};
      return null; },
    color:function(p,a){ /* structured color field first, product name second */
      var fam=COLOR_FAM[a.v]||[a.v], c=lc(p.color);
      if(c) return fam.some(function(f){ return new RegExp('\\b'+f+'\\b').test(c); })?{t:'strong'}:null;
      return fam.some(function(f){ return new RegExp('\\b'+f+'\\b').test(cache(p).name); })?{t:'strong'}:null; },
    lenRange:function(p,a){ /* structured length field only */
      var m=String(p.length==null?'':p.length).trim().toUpperCase().match(/^([\d.]+)\s*(M|CM|MM)?$/); if(!m) return null;
      var v=parseFloat(m[1]); v=m[2]==='CM'?v/100:(m[2]==='MM'?v/1000:v);
      return (v>=a.lo-1e-9 && v<=a.hi+1e-9)?{t:'strong'}:null; },
    wattsFeat:function(p,a){ /* only used when the name carries no wattage */
      var x=cache(p), best=0;
      x.segs.forEach(function(s){ if(!/(max|up to|support|charging|output|power|pd)/.test(s)) return; var m,re=/(\d{2,3})\s?w\b/g; while((m=re.exec(s))) best=Math.max(best,+m[1]); });
      return best||null; }
  };
  var FLAGS={
    builtin:{ re:/\bbuilt-in\s+(?:\d+\s?w\s+)?(?:usb-c\s+|lightning\s+|usb\s+)?(cable|connector|usb-c|lightning|c\b)|\bintegrated cable/, label:'with built-in cable' },
    retractable:{ re:/\bretractable\b/, label:'with retractable cable' },
    qi2:{ re:/\bqi2(?:\.\d)?\b/, label:'Qi2' },
    magsafe:{ re:/\bmagsafe\b/, label:'MagSafe' },
    gan:{ re:/\bgan/, label:'GaN' },
    pd:{ re:/\bpd\b|power delivery/, label:'PD' }
  };
  var COLOR_FAM={ gray:['gray','grey'], grey:['gray','grey'], white:['white'], black:['black'], blue:['blue'], silver:['silver'], green:['green'], red:['red'], pink:['pink'], purple:['purple'], yellow:['yellow'], beige:['beige'], gold:['gold'] };
  var RANK_TIER={strong:3,medium:2,weak:1};
  /* Combined evidence for all constraints: weakest tier wins; null if any constraint unmet. */
  function matchAll(p,attrs){
    var worst='strong', evs=[];
    for(var i=0;i<attrs.length;i++){
      var r=MATCH[attrs[i].k](p,attrs[i]);
      if(!r) return null;
      if(RANK_TIER[r.t]<RANK_TIER[worst]) worst=r.t;
      if(r.ev) evs.push(r.ev);
    }
    return {t:worst, ev:evs};
  }

  /* ======================= product types (data-driven) ======================= */
  var TYPES={
    cable:function(p){ var n=cache(p).name; return /\bcables?\b/.test(n) && !/\bcar charger\b/.test(n); },
    hub:function(p){ return /docking and hub/i.test(txt(p,'sheet_display')) || /\b(hub|dock|docking)\b/.test(cache(p).name); },
    dock:function(p){ return TYPES.hub(p); },
    /* UGREEN names multi-port hubs "… Converter (N-in-1)": a hub is not an adapter unless the question also says hub/dock */
    adapter:function(p){ return (/\b(adapt(?:e|o)r|converter)\b/.test(cache(p).name) || /adapter|converter/i.test(txt(p,'category'))) && !TYPES.hub(p); },
    converter:function(p){ return TYPES.adapter(p); },
    lan:function(p){ return /ethernet adapter/i.test(txt(p,'sheet_display')) || /\b(ethernet|rj45|lan|gigabit)\b/.test(cache(p).name); },
    hdmi:function(p){ return /\bhdmi\b/.test(cache(p).name); },
    charger:function(p){ return p.sheet_display==='Mobile: Charger' || p.category==='Car Charger'; },
    powerbank:function(p){ return p.category==='Power Bank' || p.sheet_display==='Mobile: Power Bank'; },
    nas:function(p){ return /nas/i.test(txt(p,'sheet_display')) || /\bnasync\b/.test(cache(p).name); }
  };
  var TYPE_LABEL={cable:'cable',hub:'hub',dock:'dock',adapter:'adapter',converter:'adapter',lan:'LAN adapter',hdmi:'HDMI',charger:'charger',powerbank:'power bank',nas:'NAS'};
  function typeWords(content){ return (content||[]).filter(function(w){ return TYPES[w]; }); }
  function typeFilter(pool,content){
    var ws=typeWords(content); if(!ws.length) return pool;
    var hubAsked=ws.some(function(w){ return w==='hub'||w==='dock'; });
    return pool.filter(function(p){ return ws.every(function(w){ return (hubAsked && (w==='adapter'||w==='converter')) ? true : TYPES[w](p); }); });
  }

  /* ======================= query analysis ======================= */
  var PRICE_BEFORE=/(₱|php|peso|pesos|budget|under|below|over|above|less than|more than|hanggang|within|price|srp|dp|at least|up to|max|min)\s*$/;
  /* p2r2.1: token starts right after "<digit>." -> it is the decimal part of an amount ("1.5k", "2.5k"), not a resolution */
  function decimalTail(s,idx){ return idx>=2 && s.charAt(idx-1)==='.' && /\d/.test(s.charAt(idx-2)); }
  function priceContext(s,idx,len){ var pre=s.slice(Math.max(0,idx-16),idx), post=s.slice(idx+len,idx+len+10); return PRICE_BEFORE.test(pre)||/^\s*(php|pesos?|budget)\b/.test(post)||/₱\s*$/.test(pre); }
  var NUMW={ two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10 };
  var MONTHS=['january','february','march','april','may','june','july','august','september','october','november','december'];
  var MON_RE=/\b(?:since|from|after)\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/;

  function analyze(query){
    var raw=String(query||''), s=' '+normText(raw)+' ';
    var N={ raw:raw, attrs:[], action:null, hist:null, compat:false, text:'' };
    N.compat=/\b(compatible|compatibility|works? (?:with|on)|gagana ba|pwede ba sa|kaya ba ng)\b/.test(s);
    function cut(re,rep){ s=s.replace(re, rep==null?' ':rep); }

    /* ---------- "X pataas / and up" -> at least X; "longer than" -> at least ---------- */
    var before=s;
    cut(/(\d[\d.,]*\s?(?:k\s?mah|k|w|mah|m|cm|gbps|g|ports?)?)\s+(?:pataas|and up|and above|or more|or higher|or above)\b/g,' at least $1 ');   /* p2r2.1: + "20k pataas" */
    cut(/(\d[\d.,]*\s?(?:k\s?mah|k|w|mah|m|cm|gbps|g)?)\s+(?:pababa|or less|and below|or lower|and under)\b/g,' up to $1 ');
    cut(/\blonger than\b/g,' at least '); cut(/\bshorter than\b/g,' up to ');
    N.rewritten=(s!==before);

    /* ---------- price history intent ---------- */
    var HIST=/\b(price (?:increase|decrease|change|changes|hike|drop|history|movement|update|updates)|price (?:went|go) (?:up|down)|(?:increase|decrease)[ds]?|tumaas|bumaba|nagbago|repriced|changed (?:its )?price|price changed|previous (?:srp|dp|price)|old (?:srp|dp|price)|dating presyo|price before|before price)\b/;
    if(HIST.test(s) && !N.compat){
      var H={ dir:null, metric:'peso', field:'srp', period:null, n:null, kind:null, threshold:null };
      if(/\b(increase[ds]?|hike|tumaas|went up|go up|pagtaas)\b/.test(s)) H.dir='up';
      if(/\b(decrease[ds]?|drop|bumaba|went down|go down|cheaper|reduc\w*|pagbaba)\b/.test(s)) H.dir=(H.dir==='up'?null:'down');
      if(/%|\bpercent(?:age)?\b|\bporsyento\b/.test(s)) H.metric='pct';
      if(/\bdp\s?vol(?:ume)?\b|\bdpv\b/.test(s)) H.field='vol'; else if(/\b(dp|dealer price)\b/.test(s)) H.field='dp';
      if(/\b(previous|old|dating|before)\b/.test(s)) H.kind='previous';
      var tm;
      if(/\b(this month|ngayong buwan|current month)\b/.test(s)) H.period={k:'thisMonth'};
      else if(/\b(last month|previous month|nakaraang buwan)\b/.test(s)) H.period={k:'lastMonth'};
      else if(/\b(this year|ngayong taon)\b/.test(s)) H.period={k:'thisYear'};
      else if((tm=s.match(MON_RE))){ var mi=MONTHS.findIndex(function(m){ return m.indexOf(tm[1].slice(0,3))===0; }); H.period={k:'since',m:mi}; }
      var th=s.match(/\b(?:above|over|more than|greater than|at least|higher than|>)\s*₱?\s*(\d[\d,]*(?:\.\d+)?)\s*(%|percent)?/);
      if(th) H.threshold={v:parseFloat(th[1].replace(/,/g,'')), pct:!!th[2]};
      var topm=s.match(/\btop\s*(\d{1,2}|two|three|four|five|six|seven|eight|nine|ten)\b/);
      if(topm) H.n=Math.max(1,Math.min(10, NUMW[topm[1]]||parseInt(topm[1],10)));
      if(/\b(category|categories|section|sections)\b/.test(s) && /\b(most|highest|pinakamaraming|biggest)\b/.test(s)) H.kind='aggregate';
      else if(!H.kind && (H.n || /\b(biggest|largest|highest|greatest|most|pinakamalaki|pinakamataas)\b/.test(s))) H.kind='rank';
      if(!H.kind && /\b(how many|ilan|ilang|number of|count)\b/.test(s)) H.kind='count';
      if(!H.kind && (/^\s*(may|meron|mayroon)\b/.test(s) || /\b(is there|are there|any|did any|were there|meron ba|may .{0,20}ba)\b/.test(s))) H.kind='exist';
      if(!H.kind && /\bhow much\b/.test(s)) H.kind='previous';
      if(!H.kind) H.kind='list';
      N.hist=H;
      /* strip history vocabulary so only product words remain for the catalog filter */
      cut(/\b(which|what|anong?|ano ang)\s+(sku|skus|product|products|item|items)\b/g); cut(/\b(skus?|products?|items?|our|we|us)\b/g);
      cut(/\b(top\s*(?:\d{1,2}|two|three|four|five|six|seven|eight|nine|ten)|biggest|largest|highest|greatest|most|pinakamalaki|pinakamataas|pinakamaraming|how many|how much|ilan|ilang|number of|count|category|categories|section|sections|had|have|has|did|does|do|is there|are there|any|were there|meron ba|mayroon ba|may|ba|ang|ng|sa|this month|ngayong buwan|current month|last month|previous month|nakaraang buwan|this year|ngayong taon|percent(?:age)?|porsyento|%|price(?:s)?|presyo|srp|dp\s?vol(?:ume)?|dpv|dp|dealer price|increase[ds]?|decrease[ds]?|change[ds]?|hike|drop|history|movement|updates?|tumaas|bumaba|nagbago|repriced|previous|old|dating|before|went|go|up|down|cheaper|by|in|of|was|were|the|a|an|show|list|me|all|with|and|amount|pagtaas|pagbaba)\b/g);
      cut(MON_RE); cut(/\b(?:above|over|more than|greater than|at least|higher than|>)\s*₱?\s*\d[\d,]*(?:\.\d+)?\s*(?:%|percent)?/g);
      N.text=s.replace(/[?!.,]+/g,' ').replace(/\s+/g,' ').trim();
      return N;
    }

    /* ---------- spec attributes ---------- */
    var hasQ=/\bhdmi\b/.test(s)?'hdmi':(/\b(displayport|dp)\b/.test(s)&&!/\bdp\s?vol/.test(s)?'dp':null);
    var m, refreshDone=false;
    /* resolution + refresh pair: 4k60, 4k@60hz, 4k 60hz */
    s=s.replace(/\b(8k|4k|2k|1080p|1440p)(\s*@\s*|\s+|)(\d{2,3})\s*(hz)?\b/g,function(all,r,sep,hz,unit,off,str){
      if(decimalTail(str,off)) return all;                                          /* p2r2.1: "1.2k 60hz" -> 1.2k is an amount */
      if(!unit && sep.trim()!=='@' && sep!=='') return all;                       /* "4k 60" without hz/@ -> not a refresh pair */
      N.attrs.push({k:'refresh',r:RES_RANK[r],hz:+hz,q:hasQ,label:RES_LABEL[RES_RANK[r]]+'@'+hz+'Hz'}); refreshDone=true; return ' ';
    });
    s=s.replace(/\b(8k|5k|4k|2k|1080p|1440p)\b/g,function(all,r,off,str){
      if(decimalTail(str,off)) return all;                                          /* p2r2.1: "under 1.5k" = ₱1,500, not 5K */
      if(/^[2458]k$/.test(r) && priceContext(str,off,all.length)) return all;          /* "under 4k" = budget */
      N.attrs.push({k:'res',v:RES_RANK[r],q:hasQ,label:RES_LABEL[RES_RANK[r]]}); return ' ';
    });
    if(!refreshDone) s=s.replace(/\b(\d{2,3})\s?hz\b/g,function(all,hz){ N.attrs.push({k:'refresh',r:null,hz:+hz,q:hasQ,label:hz+'Hz'}); return ' '; });
    s=s.replace(/\bhdmi (2\.1|2\.0|1\.4)\b/g,function(all,v){ N.attrs.push({k:'hdmiver',v:parseFloat(v),label:'HDMI '+v}); return ' hdmi '; });
    var lanQ=/\b(lan|ethernet|rj45|network|gigabit)\b/.test(s);
    if(lanQ){
      if(/\bgigabit\b/.test(s)&&!/\b(2\.5|5|10)\s?g/.test(s)){ N.attrs.push({k:'eth',v:1,label:'Gigabit'}); s=s.replace(/\bgigabit\b/g,' lan '); }
      s=s.replace(/\b(2\.5|5|10|25)\s?(?:gbps|gb\/s|g)\b/g,function(all,v){ N.attrs.push({k:'eth',v:+v,label:v+'Gbps'}); return ' '; });
    } else {
      s=s.replace(/\b(\d+(?:\.\d+)?)\s?(?:gbps|gb\/s|g)\b/g,function(all,v,off,str){ if(+v<1||+v>120) return all; N.attrs.push({k:'gbps',v:+v,label:v+'Gbps'}); return ' '; });
    }
    if(/\bbuilt-in\b/.test(s)){ N.attrs.push({k:'flag',v:'builtin',label:FLAGS.builtin.label}); cut(/\bbuilt-in(?:\s+(?:usb-c|lightning))?(?:\s+(?:cable|connector|cord))?\b/g); }
    if(/\bretractable\b/.test(s)){ N.attrs.push({k:'flag',v:'retractable',label:FLAGS.retractable.label}); cut(/\bretractable(?:\s+(?:cable|cord))?\b/g); }
    [['qi2',/\bqi2\b/],['magsafe',/\bmagsafe\b/],['gan',/\bgan\b/],['pd',/\bpd\b(?!\s?vol)/]].forEach(function(f){
      if(f[1].test(s)){ N.attrs.push({k:'flag',v:f[0],label:FLAGS[f[0]].label}); s=s.replace(f[1],' '); }
    });
    /* colour (structured field) */
    s=s.replace(/\b(white|black|gr[ae]y|blue|silver|green|red|pink|purple|yellow|beige|gold)\b/g,function(all,c){ if(!N.attrs.some(function(a){ return a.k==='color'; })) N.attrs.push({k:'color',v:c==='grey'?'gray':c,label:c==='grey'?'gray':c}); return ' '; });
    /* length range "3m to 5m" / "3 to 5m" */
    s=s.replace(/\b(\d+(?:\.\d+)?)\s?(m|cm)?\s*(?:to|-|hanggang|and)\s*(\d+(?:\.\d+)?)\s?(m|cm)\b/g,function(all,a,u1,b,u2){
      var f=function(v,u){ v=+v; return u==='cm'?v/100:v; }; var lo=f(a,u1||u2), hi=f(b,u2);
      N.attrs.push({k:'lenRange',lo:Math.min(lo,hi),hi:Math.max(lo,hi),label:a+(u1||u2)+'–'+b+u2}); return ' '; });

    /* ---------- action ---------- */
    var stockish=/\b(may stocks?|meron pa\b|meron pang stocks?|in stock|on hand|available stocks?)/.test(s);
    if(/\b(how many|ilan|ilang|number of|count of)\b/.test(s)){ N.action='count'; cut(/\b(how many|ilan|ilang|number of|count of)\b/g); }
    else if(/\b(which|what|anong?|ano ang)\s+(sku|skus|item code)\b|\bsku\s+(of|ng)\b/.test(s)){ N.action='sku'; cut(/\b(which|what|anong?|ano ang)\s+(sku|skus|item code)\s*(is|are|has|ang|ng)?\b|\bsku\s+(of|ng)\b/g); }
    else if(/\b(do (we|you) have|does the pricelist have|is there|are there|meron ba|mayroon ba|may ganito ba|available ba)\b/.test(s) || (/^\s*may\b/.test(s)&&!stockish) || (/\bba\b/.test(s)&&/^\s*(meron|mayroon)\b/.test(s))){
      N.action='exist';
      cut(/\b(do (we|you) have|does the pricelist have|is there|are there|meron ba (tayong|tayo|kayong|kayo)?|mayroon ba (tayong|tayo|kayong|kayo)?|may ganito ba|available ba)\b/g);
      if(!stockish){ s=s.replace(/^\s*(may|meron|mayroon)\b/,' ').replace(/\bba\b/g,' '); }
      cut(/\b(tayong|tayo|kayong|kayo)\b/g);
    }
    else if(/\b(show( me)?( all)?|list( all)?|lahat ng|all the)\b/.test(s)){ N.action='list'; cut(/\b(show( me)?( all)?|list( all)?|lahat ng|all the)\b/g); }
    cut(/\b(available in the pricelist|in the pricelist|in our pricelist|sa pricelist)\b/g); cut(/\b(our|natin|namin)\b/g);
    N.text=s.replace(/[?!]+/g,' ').replace(/\s+/g,' ').trim();
    return N;
  }

  /* ======================= price history (effective/past only) ======================= */
  function num(v){ if(v===''||v===null||v===undefined) return null; var n=Number(v); return isNaN(n)?null:n; }
  /* Mirrors helpers.js pcSeedEventFromMeta: one event reconstructed from badge metadata. */
  function seedEvent(p){
    var hasS=(p.priceChangeSRP&&p.previousSRP!=null), hasD=(p.priceChangeDP&&p.previousDP!=null);
    if(!hasS&&!hasD) return null;
    return { effectiveDate:(p.srpChangeDate||p.dpChangeDate||null), oldSrp:hasS?num(p.previousSRP):null, newSrp:hasS?num(p.srp):null,
      oldDp:hasD?num(p.previousDP):null, newDp:hasD?num(p.dp):null, oldVol:null, newVol:null, source:'seed' };
  }
  /* Rows {p,field,old,new,delta,pct,date}. fields: ['srp'] or ['srp','dp','vol'].
     Only events with an effectiveDate <= today. priceSchedule is never touched. */
  function historyRows(products,opts){
    opts=opts||{}; var today=opts.today||todayStr(), fields=opts.fields||['srp'], out=[];
    var KEY={srp:['oldSrp','newSrp'],dp:['oldDp','newDp'],vol:['oldVol','newVol']};
    (products||[]).forEach(function(p){
      if(!p||p.disabled) return;
      var evs=(p.priceHistory&&p.priceHistory.length)?p.priceHistory:[]; if(!evs.length){ var sd=seedEvent(p); if(sd) evs=[sd]; }
      evs.forEach(function(e){
        if(!e||!e.effectiveDate||String(e.effectiveDate)>today) return;
        fields.forEach(function(f){
          var o=num(e[KEY[f][0]]), n=num(e[KEY[f][1]]);
          if(o===null||n===null||o===n) return;
          out.push({p:p, code:String(p.item_code), field:f, old:o, 'new':n, delta:n-o, pct:o?((n-o)/o*100):null, date:String(e.effectiveDate)});
        });
      });
    });
    return out;
  }
  function todayStr(d){ d=d||new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
  function periodRange(period,today){
    if(!period) return null;
    var y=+today.slice(0,4), mo=+today.slice(5,7);
    function ym(yy,mm){ return yy+'-'+String(mm).padStart(2,'0'); }
    if(period.k==='thisMonth') return {from:ym(y,mo)+'-01', to:today, label:MONTHS[mo-1].replace(/^./,function(c){return c.toUpperCase();})+' '+y};
    if(period.k==='lastMonth'){ var py=mo===1?y-1:y, pm=mo===1?12:mo-1; return {from:ym(py,pm)+'-01', to:ym(py,pm)+'-31', label:MONTHS[pm-1].replace(/^./,function(c){return c.toUpperCase();})+' '+py}; }
    if(period.k==='thisYear') return {from:y+'-01-01', to:today, label:String(y)};
    if(period.k==='since'){ var sy=(period.m+1)>mo?y-1:y; return {from:ym(sy,period.m+1)+'-01', to:today, label:'since '+MONTHS[period.m].replace(/^./,function(c){return c.toUpperCase();})+' '+sy}; }
    return null;
  }

  var API={ version:'p2r2.1', analyze:analyze, normText:normText, segments:segments, resMentions:resMentions,
    match:function(p,a){ return MATCH[a.k](p,a); }, matchAll:matchAll, wattsFromFeatures:function(p){ return MATCH.wattsFeat(p); },
    types:TYPES, typeLabel:TYPE_LABEL, typeWords:typeWords, typeFilter:typeFilter, flags:FLAGS,
    historyRows:historyRows, seedEvent:seedEvent, todayStr:todayStr, periodRange:periodRange };
  if(typeof module!=='undefined' && module.exports) module.exports=API;
  root.VeroNLU=API;
})(typeof window!=='undefined'?window:globalThis);
