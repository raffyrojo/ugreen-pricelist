/* VERO p2r2 — local intent + attribute layer tests.
   Run: node tests/vero-nlu.test.js
   Uses the REAL data/products.json (scheduled prices resolved exactly like the app) with "today"
   pinned to 2026-10-06 so history answers are reproducible. Expected values are derived
   independently (helpers.js pcAllChangeRows, raw field regexes) — not copied from the engine.
   Synthetic SKUs prove the engine is data-driven (no SKU lists in the engine). */
const fs=require('fs'), path=require('path');
const ROOT=path.join(__dirname,'..');
global.window={ PRICE_SETTINGS:{ indicatorDays:30 } };
eval(fs.readFileSync(path.join(ROOT,'js','helpers.js'),'utf8'));
const NL=require(path.join(ROOT,'js','vero-nlu.js'));
const E=require(path.join(ROOT,'js','vero-engine.js'));
const TODAY='2026-10-06';
const RAW=JSON.parse(fs.readFileSync(path.join(ROOT,'data','products.json'),'utf8'));
const ALL=JSON.parse(JSON.stringify(RAW)); pcResolveSchedule(ALL);
const PUB=ALL.filter(p=>!p.disabled);
const by=c=>PUB.find(p=>String(p.item_code)===String(c));
let pass=0, fail=0;
const chk=(n,c,extra)=>{ if(c){pass++;console.log('PASS - '+n);} else {fail++;console.log('FAIL - '+n+(extra!==undefined?'  -> '+(typeof extra==='string'?extra:JSON.stringify(extra)).slice(0,300):''));} };
const A=(q,list,ctx)=>E.answer(list||PUB,q,Object.assign({today:TODAY},ctx||{}));
const local=(q,r,list)=>{ const d1=E.aiRoute(list||PUB,q,r,{}), d2=E.aiRoute(list||PUB,q,r,{manual:true}); return d1.route==='local' && d2.route==='local' && !d1.candidates.length && !E.canEscalate(r); };
const name=c=>String((by(c)||{}).product_name||'');
const T=(p,f)=>String(p[f]||'');

/* independent history truth from the app's own helpers */
const HIST=pcAllChangeRows(PUB).history.filter(r=>String(r.effectiveDate)<=TODAY);
const SRP=HIST.filter(r=>r.type==='SRP').map(r=>({...r,d:r.newPrice-r.oldPrice,pct:(r.newPrice-r.oldPrice)/r.oldPrice*100}));
const OCT=SRP.filter(r=>r.effectiveDate.startsWith('2026-10')), SEP=SRP.filter(r=>r.effectiveDate.startsWith('2026-09'));
const uniq=a=>[...new Set(a)];
const maxBy=(a,f)=>a.reduce((m,x)=>!m||f(x)>f(m)?x:m,null), minBy=(a,f)=>a.reduce((m,x)=>!m||f(x)<f(m)?x:m,null);

/* ===================== N1 normalization / intent parsing ===================== */
let N=NL.analyze('do we have an 8k hdmi?'); chk('N1 "8k" is a resolution (8K), not ₱8,000', N.attrs.some(a=>a.k==='res'&&a.v===6) && N.action==='exist', N);
N=NL.analyze('power bank under 4k'); chk('N1b "under 4k" stays a budget', !N.attrs.length && /under 4k/.test(N.text), N);
chk('N1c "4k60" / "4K@60Hz" / "4K 60Hz" -> refresh pair 4K@60Hz', ['4k60 hdmi','4K@60Hz hdmi','4K 60Hz hdmi'].every(q=>{ const a=NL.analyze(q).attrs; return a.length===1&&a[0].k==='refresh'&&a[0].r===4&&a[0].hz===60; }));
chk('N1d "hdmi2.1" / "hdmi 2.1" -> HDMI 2.1', ['hdmi2.1','hdmi 2.1'].every(q=>NL.analyze('do we have '+q).attrs.some(a=>a.k==='hdmiver'&&a.v===2.1)));
chk('N1e "2.5g LAN" / "2.5Gbps LAN" -> Ethernet 2.5Gbps; "10g hub" -> data 10Gbps', NL.analyze('2.5g lan adapter').attrs.some(a=>a.k==='eth'&&a.v===2.5) && NL.analyze('may 2.5Gbps LAN adapter').attrs.some(a=>a.k==='eth'&&a.v===2.5) && NL.analyze('10g hub').attrs.some(a=>a.k==='gbps'&&a.v===10));
chk('N1f "20k mah" -> 20000mAh (engine)', A('how many 20k mah power banks').parsed.mah.v===20000);
chk('N1g "build-in" / "built in" -> built-in cable flag', ['power bank with build-in cable','power bank with built in cable'].every(q=>NL.analyze(q).attrs.some(a=>a.v==='builtin')));
chk('N1h "usb c" / "type c" / "usb-c" normalized', ['usb c','type c','usb-c'].every(x=>/usb-c/.test(NL.normText(x))));
chk('N1i Taglish / sales filler does not pollute matching', ['meron ba tayong 8k hdmi','may 8k hdmi ba','do we have 8k hdmi','do we have 8k hdmi available in the pricelist'].every(q=>{ const r=A(q); return r.parsed.content.join()==='hdmi' && r.parsed.nlu.action==='exist'; }));
chk('N1j actions: exist / count / sku / list', NL.analyze('do we have 8k hdmi').action==='exist' && NL.analyze('how many 8k hdmi cables').action==='count' && NL.analyze('which sku is the 300w charger').action==='sku' && NL.analyze('show all hdmi 2.1 cables').action==='list');
chk('N1k compatibility questions are NOT resolved locally', NL.analyze('is the 8K HDMI compatible with PS5?').compat===true);
chk('N1l history intent: direction / metric / period / kind', (h=>h.dir==='up'&&h.metric==='peso'&&h.period.k==='thisMonth'&&h.kind==='rank')(NL.analyze('which sku has the biggest price increase this month?').hist) && NL.analyze('biggest price increase in percent').hist.metric==='pct' && NL.analyze('which category had the most price changes').hist.kind==='aggregate');
chk('N1m "X pataas" / "longer than" rewrites', /at least 100w/.test(NL.analyze('power bank 100W pataas').text) && /at least 2m/.test(NL.analyze('cable longer than 2m').text));

/* ===================== N2 segmentation / evidence tiers ===================== */
const segs=NL.segments('7-in-1 USB-C dock, 4K HDMI, 8K DP, 10Gbps ports\n*Video:HDMI:Up to 4K@60Hz\nHDMI 4K@60Hz DP 8K@30Hz');
chk('N2 "4K HDMI, 8K DP" and same-line "HDMI 4K DP 8K" split per port', segs.includes('4k hdmi') && segs.includes('8k dp') && segs.some(s=>/^dp 8k@30hz/.test(s)) && !segs.some(s=>/hdmi/.test(s)&&/8k/.test(s)), segs);
const mk=(o)=>Object.assign({sheet:'X',category:'Video Cable',model:'TST',item_code:'T'+Math.random().toString(36).slice(2,7).toUpperCase(),product_name:'',color:'Black',length:'',srp:999,dp:799,dp_volume:750,moq:10,image:'',upc:'',material_number:'',remarks:'',features:'',description:'',short_desc:'',sheet_display:'A&V: Video Cable'},o);
const crossLine=mk({product_name:'USB-C to HDMI+DP Adapter',category:'Video Converter',sheet_display:'A&V: Video Adapter and Extender',features:'*Video:HDMI:Up to 4K@60Hz\n*:DP:Up to 8K@30Hz'});
chk('N2b cross-line: HDMI 4K line + DP 8K line is NOT 8K HDMI', NL.match(crossLine,{k:'res',v:6,q:'hdmi'})===null && NL.match(crossLine,{k:'res',v:6,q:'dp'}).t==='medium');
chk('N2c live 75902 (HDMI 4K / DP 8K) is not an 8K HDMI product', !A('do we have an 8K HDMI?').codes.includes('75902'));
const weakOnly=mk({product_name:'HDMI Cable 2m Zeta',length:'2M',description:'Great for 8K TVs over HDMI.'});
let r=A('do we have an 8K HDMI cable?',[weakOnly]);
chk('N2d description-only evidence is never a confirmed Yes ("mentioned … not confirmed")', r.type==='text' && /^No/.test(r.note) && /mentioned only in product descriptions, not confirmed/.test(r.note) && /^T/.test(weakOnly.item_code) && r.note.includes(weakOnly.item_code), r.note);
const featOnly=mk({product_name:'HDMI Cable Omega',length:'2M',features:'*Resolution: HDMI 8K@60Hz'});
r=A('do we have an 8K HDMI cable?',[featOnly]);
chk('N2e feature-segment evidence = confirmed Yes, labelled "per product features"', /^Yes/.test(r.note) && /per product features/.test(r.note) && /Per product features/.test(r.detail[featOnly.item_code]), r);

/* N2f–N2k: precision rules found while validating the live matrix */
const R4K60={k:'refresh',r:4,hz:60,q:'hdmi'};
const shared=mk({item_code:'40001',product_name:'USB-C To HDMI Female Converter',category:'Video Converter',features:'*Input: DP Male\n*40003 supports 4K@60Hz long distance'});
chk('N2f a feature line naming a DIFFERENT item code is never evidence for this SKU', NL.match(shared,R4K60)===null);
const own=mk({item_code:'40003',product_name:'USB-C To HDMI Female Converter',category:'Video Converter',features:'*40003 supports 4K@60Hz long distance'});
chk('N2g … but a line naming the SKU itself is kept', (NL.match(own,R4K60)||{}).t==='medium');
const lowName=mk({product_name:'DP To HDMI Converter 4K*2K@30Hz',category:'Video Converter',features:'*1080P@60Hz or 4K@30Hz or 4K@60Hz'});
chk('N2h the name states a lower spec (4K*2K@30Hz) -> authoritative, shared feature text ignored', NL.match(lowName,R4K60)===null);
const single=mk({product_name:'Mini HDMI Male To HDMI Female Adapter',features:'*HDMI 2.0\n*4K@60Hz max'});
chk('N2i single-port HDMI adapter: unqualified "4K@60Hz max" line counts (medium)', (NL.match(single,R4K60)||{}).t==='medium');
const hubU=mk({product_name:'USB-C To HDMI+2*USB 3.0 A+USB-C Female Converter',category:'Docking Station',sheet_display:'Computer: Docking and Hub',features:'*USB-C female data & video transfer up to 4K@60Hz'});
chk('N2j multi-port hub: unqualified 4K@60Hz line is NOT HDMI evidence', NL.match(hubU,R4K60)===null);
r=A('may 4K@60Hz HDMI adapter?',[single,hubU]);
chk('N2k "adapter" excludes hubs/docks named "… Converter (N-in-1)"', r.codes.length===1 && r.codes[0]===single.item_code, r.codes);
const l1=mk({product_name:'USB-C to Lightning Cable 1M',category:'Data Cable',sheet_display:'Mobile: Data Cable'}), l2=mk({product_name:'USB-C to 3.5mm Audio Cable',category:'Audio Cable',sheet_display:'Audio'}), l3=mk({product_name:'USB-A to Lightning Cable',category:'Data Cable',sheet_display:'Mobile: Data Cable'});
r=A('do we have a USB-C to Lightning cable?',[l1,l2,l3]);
chk('N2l named connectors must all appear in the name (USB-C AND Lightning)', r.codes.length===1 && r.codes[0]===l1.item_code, r.codes);

/* ===================== N3 price history safety ===================== */
const engRows=NL.historyRows(PUB,{today:TODAY,fields:['srp']});
chk('N3 history rows == helpers.js pcAllChangeRows (SRP, effective ≤ today)', engRows.length===SRP.length, [engRows.length,SRP.length]);
const fut=mk({item_code:'FUT01',product_name:'HDMI Future Cable',srp:500,priceHistory:[{effectiveDate:'2026-10-20',oldSrp:400,newSrp:500,oldDp:300,newDp:380}],priceSchedule:[{id:'x',effectiveDate:'2026-11-01',srp:9999,dp:8888,prevSRP:500,prevDP:380}]});
const withFut=PUB.concat([fut]);
const leaks=['which sku has the biggest price increase this month?','top 10 price increases','which SKUs changed price this month?','what was the previous SRP of FUT01','how much did SKU FUT01 increase?','price changes since June','show products with an SRP increase above ₱100'].filter(q=>{ const x=A(q,withFut); return JSON.stringify([x.note,x.detail]).match(/9,999|8,888|2026-11-01|2026-10-20|₱400\.00 → ₱500/); });
chk('N3b future scheduled / future-dated changes NEVER leak (any role)', !leaks.length, leaks);
r=A('what was the previous SRP of FUT01',withFut); chk('N3c SKU whose only change is future-dated -> "No recorded … change", no fabricated previous price', /No recorded SRP change for SKU FUT01/.test(r.note), r.note);
const fresh=mk({item_code:'NEW01',product_name:'Brand New Cable',srp:333});
r=A('what was the previous SRP of NEW01',PUB.concat([fresh])); chk('N3d brand-new SKU (no history) -> no previous price invented', /No recorded SRP change for SKU NEW01/.test(r.note) && !/Previous SRP of SKU NEW01/.test(r.note), r.note);
const seedOnly=mk({item_code:'SEED1',product_name:'Seed Cable',srp:120,previousSRP:100,priceChangeSRP:'up',srpChangeDate:'2026-10-02'});
r=A('how much did SKU SEED1 increase?',PUB.concat([seedOnly])); chk('N3e approved seed fallback (badge metadata, no priceHistory) is used', /₱100\.00 → ₱120\.00/.test(r.note), r.note);
const DL=PUB.slice(0,800).map(p=>Object.assign({},p,{dp_std:p.dp,dp:Math.round(p.srp*0.8),special_dp:Math.round(p.srp*0.8),dp_volume:''}));
const dlQs=['which sku has the biggest dp increase this month?','show dp price changes this month','what was the previous dp of 90872B','dp vol price changes','how much did SKU 20503 increase?','top 5 price increases'];
/* independent: every per-SKU detail must be an SRP line, and the note may mention DP only in the "Only SRP history" lead */
const dpLeak=dlQs.filter(q=>{ const x=A(q,DL,{dealer:true}); const note=String(x.note||'').replace(/Only SRP history is available[^.]*\./g,''); return /\bDP\b|DP Vol|dp_vol/i.test(note) || Object.values(x.detail||{}).some(d=>!/^SRP ₱/.test(d)); });
chk('N3f dealer mode: history never exposes standard DP / DP Vol (SRP only)', !dpLeak.length, dpLeak);
r=A('show dp price changes this month',DL,{dealer:true}); chk('N3g dealer asking for DP history is told only SRP history is available', /Only SRP history is available in your pricelist view/.test(r.note) && /SRP/.test(r.note), r.note);
r=A('show dp price changes this month'); chk('N3h public/sales: DP history may be shown', /DP change/.test(r.note) && Object.values(r.detail).some(d=>/^DP ₱/.test(d)), r.note);
const disabledHist=RAW.filter(p=>p.disabled&&(p.priceHistory||[]).length).map(p=>String(p.item_code));
r=A('which SKUs changed price this month?'); chk('N3i disabled SKUs with history ('+disabledHist.length+') never appear', disabledHist.length>0 && !r.codes.some(c=>disabledHist.includes(c)) && !A('top 10 price increases').codes.some(c=>disabledHist.includes(c)));

/* ===================== N4 the 44-question matrix (live data) ===================== */
const M=[]; const m=(q,f)=>M.push([q,f]);
const oTop=maxBy(OCT,x=>x.d);
m('which sku has the biggest price increase this month?',r=>r.codes[0]===oTop.code && /by peso amount/.test(r.note) && /October 2026/.test(r.note) && r.codes[0]==='90872B');
m('top 5 price increases this month',r=>{ const exp=uniq(OCT.slice().sort((a,b)=>b.d-a.d).map(x=>x.code)).slice(0,5); return JSON.stringify(r.codes)===JSON.stringify(exp); });
m('biggest price increase in percent',r=>r.codes[0]===maxBy(SRP,x=>x.pct).code && /by percentage/.test(r.note));
m('what product had the biggest price decrease?',r=>r.codes[0]===minBy(SRP,x=>x.d).code && minBy(SRP,x=>x.d).d<0 && /by peso amount/.test(r.note) && r.codes[0]==='45065');
m('may bumaba ba ang presyo this month?',r=>OCT.every(x=>x.d>0) && /^No — no SRP decreases effective in October 2026/.test(r.note) && /Most recent recorded decrease: SKU 80430/.test(r.note));
m('which SKUs changed price this month?',r=>r.codes.length===uniq(OCT.map(x=>x.code)).length && r.codes.length===253);
m('how many SKUs changed price this month?',r=>new RegExp('^'+uniq(OCT.map(x=>x.code)).length+' SKUs with an SRP change effective in October 2026').test(r.note));
m('how much did SKU 20503 increase?',r=>/SKU 20503 SRP ₱79\.00 → ₱89\.00 \(\+₱10\.00/.test(r.note) && /2026-10-01/.test(r.note));
m('what was the previous SRP of 90872B?',r=>/Previous SRP of SKU 90872B: ₱6,039\.00/.test(r.note) && /Earlier: ₱5,999\.00 → ₱6,039\.00/.test(r.note));
m('show products with an SRP increase above ₱500',r=>JSON.stringify(r.codes.slice().sort())===JSON.stringify(uniq(SRP.filter(x=>x.d>500).map(x=>x.code)).sort()));
m('which category had the most price changes this month?',r=>{ const c={}; uniq(OCT.map(x=>x.code)).forEach(k=>{ const cat=by(k).category; c[cat]=(c[cat]||0)+1; }); const top=Object.entries(c).sort((a,b)=>b[1]-a[1])[0]; return r.note.includes(top[0]+' — '+top[1]+' SKUs (section: Mobile: Power Bank)') && top[0]==='Power Bank'; });
m('ilang power bank ang tumaas ang presyo?',r=>{ const n=uniq(SRP.filter(x=>x.d>0 && by(x.code).category==='Power Bank').map(x=>x.code)).length; return new RegExp('^'+n+' power bank SKUs with an SRP increase').test(r.note); });
m('price changes last month',r=>r.codes.length===uniq(SEP.map(x=>x.code)).length && /September 2026/.test(r.note));
m('price changes since June',r=>/since June 2026/.test(r.note) && /Recorded price history starts 2026-09-18/.test(r.note));
const has8k=p=>/\b8k\b/i.test(T(p,'product_name'))&&/hdmi/i.test(T(p,'product_name'));
m('do we have an 8K HDMI?',r=>/^Yes/.test(r.note) && PUB.filter(has8k).every(p=>r.codes.includes(String(p.item_code))) && r.codes.includes('90325') && !r.codes.includes('75902'));
m('how many 8K HDMI cables do we have?',r=>{ const n=PUB.filter(p=>has8k(p)&&/\bcable/i.test(p.product_name)).length; return new RegExp('^'+n+' 8K HDMI cables').test(r.note) && r.codes.every(c=>/cable/i.test(name(c))); });
m('which SKU is our cheapest 8K HDMI cable?',r=>{ const c=PUB.filter(p=>has8k(p)&&/\bcable/i.test(p.product_name)); return Number(by(r.codes[0]).srp)===Math.min(...c.map(p=>+p.srp)) && /8K HDMI cable/.test(r.note); });
m('do we have HDMI 2.1?',r=>/^Yes/.test(r.note) && PUB.filter(p=>/hdmi\s?2\.1/i.test(p.product_name)).every(p=>r.codes.includes(String(p.item_code))));
m('show all HDMI 2.1 cables',r=>r.codes.every(c=>/cable/i.test(name(c))) && PUB.filter(p=>/hdmi\s?2\.1/i.test(p.product_name)&&/cable/i.test(p.product_name)).every(p=>r.codes.includes(String(p.item_code))));
m('may 4K@60Hz HDMI adapter?',r=>/^Yes/.test(r.note) && r.codes.every(c=>/adapt|convert/i.test(name(c)+by(c).category) && !/docking and hub/i.test(T(by(c),'sheet_display')) && !/\b(hub|dock)\b/i.test(name(c))) && r.codes.every(c=>/(4k|5k|8k|3840\s?[x*×]\s?2160|7680\s?[x*×]\s?4320)\s?@\s?(60|120|144|165|240)\s?hz/i.test(T(by(c),'product_name')+' '+T(by(c),'features')+' '+T(by(c),'short_desc'))) && r.codes.every(c=>!/(1080p|2k|4k\*2k)@30hz|1080p@60hz/i.test(name(c))));
m('do we have a 240W USB-C cable?',r=>/^Yes/.test(r.note) && PUB.filter(p=>/\b240\s?w/i.test(p.product_name)&&/usb-c/i.test(p.product_name)&&/cable/i.test(p.product_name)).every(p=>r.codes.includes(String(p.item_code))));
m('longest 240W cable',r=>/longest/.test(r.note) && r.codes.length>=1 && /\b240\s?w/i.test(name(r.codes[0])));
m('do we have a 100W cable longer than 2m?',r=>/^Yes/.test(r.note) && r.codes.every(c=>E.lenMeters(by(c).length)>=2 && (E.productWatts(by(c))===100||!E.productWatts(by(c)))));
m('may 2.5Gbps LAN adapter?',r=>r.type==='text' && /^No/.test(r.note));
m('do we have a gigabit LAN adapter?',r=>/^Yes/.test(r.note) && r.codes.includes('50737') && r.codes.includes('50922'));
m('do we have a 10Gbps hub?',r=>/^Yes/.test(r.note) && r.codes.includes('90325') && r.codes.includes('85489'));
m('cheapest 10Gbps hub',r=>/Cheapest 10Gbps hub/.test(r.note) && r.codes.length>=1);
m('may Qi2 charger ba?',r=>/^Yes/.test(r.note) && r.codes.every(c=>/qi\s?2/i.test(T(by(c),'product_name')+T(by(c),'features')+T(by(c),'short_desc'))));
m('do we have a MagSafe charger?',r=>/^Yes/.test(r.note) && r.codes.includes('35565'));
m('do we have a power bank with built-in cable?',r=>/^Yes/.test(r.note) && r.codes.every(c=>by(c).category==='Power Bank') && r.codes.includes('55995B'));
m('do we have a charger with retractable cable?',r=>/^Yes/.test(r.note) && /car chargers/.test(r.note) && r.codes.every(c=>/retractable/i.test(name(c))));
m('meron ba tayong GaN charger na 65W?',r=>/^Yes/.test(r.note) && r.codes.every(c=>/gan/i.test(name(c))&&E.productWatts(by(c))===65));
m('how many 20000mAh power banks?',r=>new RegExp('^'+PUB.filter(p=>p.category==='Power Bank'&&E.productMah(p)===20000).length+' 20,000mAh power banks').test(r.note));
m('biggest power bank with built-in cable',r=>/biggest capacity/.test(r.note) && E.productMah(by(r.codes[0]))===25000);
m('white 65W charger',r=>r.type==='text' && /^No/.test(r.note) && !PUB.some(p=>p.sheet_display==='Mobile: Charger'&&/white/i.test(p.color)&&E.productWatts(p)===65));
m('gray hub under ₱2,000',r=>r.codes.length>0 && r.codes.every(c=>/gr[ae]y/i.test(by(c).color) && +by(c).srp<=2000));
m('power bank 100W pataas',r=>r.codes.length>0 && r.codes.every(c=>E.productWatts(by(c))>=100 && by(c).category==='Power Bank'));
m('HDMI cable 3m to 5m',r=>r.codes.length>0 && r.codes.every(c=>{ const l=E.lenMeters(by(c).length); return l>=3&&l<=5&&/hdmi/i.test(name(c))&&/cable/i.test(name(c)); }));
m('which sku is the 300W charger?',r=>/^SKU 90872B/.test(r.note));
m('anong SKU ng 48000mAh power bank?',r=>/^SKU 25286/.test(r.note));
m('do we have a USB-C to Lightning cable?',r=>/^Yes/.test(r.note) && r.codes.every(c=>/lightning/i.test(name(c))&&/(usb-c|type-c)/i.test(name(c))));
m('do we have a hub with 4K@60Hz HDMI and ethernet?',r=>/^Yes/.test(r.note) && r.codes.every(c=>/rj45|ethernet|gigabit/i.test(name(c)+T(by(c),'features'))));
m('do we have a 10G cable for my MacBook?',r=>/^Yes/.test(r.note) && /can’t confirm compatibility with your MacBook/.test(r.note) && r.codes.every(c=>!/\b(dp|hdmi)\b/i.test(name(c))));
m('is the 8K HDMI compatible with PS5?',r=>true);  /* routing asserted below */
M.forEach(([q,f],i)=>{ let x; try{ x=A(q); }catch(e){ x={note:'THREW '+e.message,codes:[]}; } let ok=false; try{ ok=!!f(x); }catch(e){ ok=false; }
  const rt=E.aiRoute(PUB,q,x,{});
  const routeOk = i===43 ? rt.route!=='local' : local(q,x);
  chk('M'+String(i+1).padStart(2,'0')+' '+q+(i===43?' -> AI/web route (not local)':' -> local'), ok && routeOk, (x.note||'')+' | '+(x.codes||[]).slice(0,4).join(',')+' | route '+rt.route); });

/* ===================== N5 future SKUs are data-driven ===================== */
const new8k=mk({item_code:'ZZ8K1',product_name:'HDMI 2.1 Ultra Cable (8K) 7M',length:'7M',srp:1500});
r=A('do we have an 8K HDMI?',PUB.concat([new8k])); chk('F1 new 8K HDMI SKU automatically matches', r.codes.includes('ZZ8K1'));
const new240=mk({item_code:'ZZ240',product_name:'USB-C to USB-C 240W Super Cable',category:'USB-C Data Charging Cable',sheet_display:'Mobile: Charging Cable',length:'1.5M',srp:700});
r=A('do we have a 240W USB-C cable?',PUB.concat([new240])); chk('F2 new 240W cable automatically matches', r.codes.includes('ZZ240'));
const newPB=mk({item_code:'ZZPB1',product_name:'50000mAh 300W Mega Power Bank',category:'Power Bank',sheet_display:'Mobile: Power Bank',srp:9000});
const before=PUB.filter(p=>p.category==='Power Bank'&&E.productMah(p)>=20000).length;
r=A('how many power banks at least 20000mAh?',PUB.concat([newPB])); chk('F3 new power bank capacity participates in count', new RegExp('^'+(before+1)+' ').test(r.note), r.note);
r=A('biggest capacity power bank',PUB.concat([newPB])); chk('F3b … and in ranking', r.codes[0]==='ZZPB1');
const newHist=mk({item_code:'ZZH01',product_name:'Brand New Hub',sheet_display:'Transmission: Docking and Hub',srp:5000,priceHistory:[{effectiveDate:'2026-10-05',createdDate:'2026-10-04',oldSrp:3000,newSrp:5000,oldDp:2400,newDp:4000,source:'edit'}]});
r=A('which sku has the biggest price increase this month?',PUB.concat([newHist])); chk('F4 new price-history event automatically participates in this-month ranking', r.codes[0]==='ZZH01' && /₱3,000\.00 → ₱5,000\.00/.test(r.note), r.note);
const noSpec=mk({item_code:'ZZNS1',product_name:'Video Cable Lite',length:'2M',features:'*Material: PVC'});
r=A('do we have an 8K HDMI cable?',PUB.concat([noSpec])); chk('F5 new SKU with missing spec is not guessed', !r.codes.includes('ZZNS1'));
r=A('how many power banks at least 20000mAh?',PUB.concat([Object.assign({},newPB,{disabled:true})])); chk('F6 newly disabled SKU is excluded', new RegExp('^'+before+' ').test(r.note), r.note);
r=A('which sku has the biggest price increase this month?',PUB.concat([Object.assign({},newHist,{disabled:true})])); chk('F6b … also from price history', r.codes[0]!=='ZZH01');

/* ===================== N6 guards ===================== */
r=A('do we have 8k hdmi in stock?'); chk('G1 explicit stock wording keeps the stock-not-confirmed caveat', /can’t confirm stock/.test(r.stockNote||'') && /^Yes/.test(r.note));
r=A('do we have an 8k hdmi?'); chk('G2 "do we have" = in the pricelist; no stock caveat', !r.stockNote && /in the current pricelist/.test(r.note));
chk('G3 every matrix question except compatibility is LOCAL (auto + manual), 0 Worker candidates', M.slice(0,43).every(([q])=>local(q,A(q))));
const req=E.aiRoute(PUB,'is the 8K HDMI compatible with PS5?',A('is the 8K HDMI compatible with PS5?'),{});
chk('G4 compatibility question still goes to AI (catalog/web), candidates are item codes only', req.route!=='local' && req.candidates.every(c=>typeof c==='string' && !/₱|\d+\.\d\d/.test(c)), req);
chk('G5 p2r1 ranking still works unchanged through the new layer', A('cheapest powerbank now').codes[0]==='25742' && A('what is the longest hdmi we have right now?').codes[0]==='10114');

console.log('\n'+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
