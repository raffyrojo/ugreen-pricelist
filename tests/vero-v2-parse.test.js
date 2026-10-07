/* VERO Local Brain v2-1 — accountable parse: generative structural matrices (SHADOW ONLY).
   Run: node tests/vero-v2-parse.test.js
   Questions are GENERATED from templates x catalogue values (models, families, connectors, units) with a fixed seed;
   none are copied from the 144 benchmark or the held-out sets. Expectations are derived from data/products.json.
   M1 lexer + span ledger          M2 sense matrix              M3 attribute vs count       M4 connector + version
   M5 port roles                   M6 directionality            M7 coverage ledger          M8 false-negative ladder
   M9 label integrity              M10 compat / device hints    M11 data-driven graph (future SKU, CM763 fixture)
   M12 purity + performance */
const fs=require('fs'), path=require('path');
const ROOT=path.join(__dirname,'..');
global.window={ PRICE_SETTINGS:{ indicatorDays:30 } };
eval(fs.readFileSync(path.join(ROOT,'js','helpers.js'),'utf8'));
['vero-lexicon','vero-nlu','vero-facts'].forEach(f=>require(path.join(ROOT,'js',f+'.js')));
const VF=window.VeroFacts, O=require(path.join(ROOT,'js','vero-ontology.js')), VP=require(path.join(ROOT,'js','vero-parse.js'));
const RAW=fs.readFileSync(path.join(ROOT,'data','products.json'),'utf8');
const ALL=JSON.parse(RAW); pcResolveSchedule(ALL);
const PUB=ALL.filter(p=>!p.disabled), byCode={}; PUB.forEach(p=>byCode[String(p.item_code)]=p);
const FACTS=VF.build(PUB), OPTS={ facts:FACTS, products:PUB };
let pass=0, fail=0; const chk=(n,c,x)=>{ if(c){ pass++; console.log('PASS - '+n); } else { fail++; console.log('FAIL - '+n+(x!==undefined?'  -> '+String(x).slice(0,700):'')); } };
const run=q=>VP.run(q,OPTS), G=c=>VP.graphFor(c,OPTS);
let seed=20261007; const rnd=()=>{ seed=(seed*1103515245+12345)%2147483648; return seed/2147483648; }; const pick=a=>a[Math.floor(rnd()*a.length)];
const spanOf=(P,text)=>P.spans.filter(s=>s.text===text)[0];
const models=uniqBy(PUB.filter(p=>/^[A-Z]{1,3}\d{2,4}[A-Z]?$/i.test(String(p.model||'').trim())),p=>String(p.model).trim()).map(p=>String(p.model).trim());
function uniqBy(a,f){ const s=new Set(); return a.filter(x=>{ const k=f(x); if(s.has(k)) return false; s.add(k); return true; }); }
const famCodes=f=>PUB.filter(p=>FACTS.byCode[p.item_code]&&FACTS.byCode[p.item_code].type.family===f).map(p=>String(p.item_code));
const CORPUS=[]; const keep=P=>{ CORPUS.push(P); return P; };

/* ================= M1 lexer + span ledger ================= */
{ const T=VP.tokenize('65w 20,000mah 2m 15.6inch 3.5mm usb3.0 dp1.4 2xusb-a',OPTS).map(t=>t.t+':'+t.k).join(' ');
  chk('M1.1 glued number+unit split; thousands comma removed; version split from connector word; "2x" count split', T==='65:num w:word 20000:num mah:word 2:num m:word 15.6:num inch:word 3.5:num mm:word usb:word 3.0:num dp:word 1.4:num 2:num *:sym usb:word a:word', T);
  const codeSample=PUB.slice(0,200).filter(p=>/^\d{5}[A-Z]+$/i.test(p.item_code)).slice(0,10).map(p=>p.item_code);
  chk('M1.2 catalogue codes and models are single code tokens (never split as number+unit): '+codeSample.length+' codes + 10 models', codeSample.every(c=>{ const t=VP.tokenize('price ng '+c,OPTS); return t[2].k==='code'; }) && models.slice(0,10).every(m=>VP.tokenize(m+' price',OPTS)[0].k==='code'));
  const single=[['macbook air','DEVICE'],['usb 3.0 a','CONNECTOR'],['3.5mm to rca','CONN_PAIR'],['15.6 inch','NUMUNIT'],['power port','PORTROLE'],['hdmi to vga','CONN_PAIR']];
  single.forEach(([w,type])=>{ const P=run('meron '+w+' ba'); const sp=P.spans.filter(s=>s.text.replace(/ /g,'').indexOf(w.replace(/ /g,''))>=0); chk('M1.3 "'+w+'" is ONE span ('+type+(type==='PORTROLE'?' / power-port feature':'')+')', sp.length===1 && (sp[0].type===type || (type==='PORTROLE' && sp[0].type==='FEATURE' && sp[0].value.id==='power_port')), JSON.stringify(P.spans.map(s=>[s.text,s.type]))); });
  /* product-line names: pick multi-word line phrases from the catalogue itself */
  const C=VP.catalog(FACTS,PUB), lines=Object.keys(C.phrases).filter(k=>k.split(' ').length===2 && /^[a-z]{4,}$/.test(k.split(' ')[0]) && ['mini','pro','plus','max','air'].includes(k.split(' ')[1]) && C.phrases[k].length<=6).slice(0,12);
  const lineOk=lines.filter(l=>{ const P=run('magkano yung '+l+'?'); const s=P.spans.filter(x=>x.type==='NAME')[0]; return s && s.text===l && s.absorbed && s.absorbed[0].sense==='line.'+l.split(' ')[1]; });
  chk('M1.4 catalogue line names ("<line> mini/pro/plus/max/air") are one NAME span with the modifier sense recorded ('+lineOk.length+'/'+lines.length+')', lines.length>=3 && lineOk.length===lines.length, lines.filter(l=>!lineOk.includes(l)));
  let bad=[]; for(let i=0;i<150;i++){ const q=pick(['magkano','ano dp ng','meron ba','pinakamura na','ilang watts ng'])+' '+pick(models)+' '+pick(['','2m','65w','gray','po','?','na may power port']); const P=keep(run(q));
    const cover=new Array(P.tokens.length).fill(0); P.spans.forEach(s=>{ for(let k=s.from;k<s.to;k++) cover[k]++; }); if(cover.some(c=>c!==1)) bad.push(q); }
  chk('M1.5 every token is covered by exactly one span (150 generated questions)', !bad.length, bad.slice(0,5));
  const rec=run('magkano 65w charger').spans.every(s=>'id text from to type state slot conf'.split(' ').every(k=>k in s));
  chk('M1.6 each span records id, surface text, token range, type, state, slot and confidence', rec); }

/* ================= M2 sense matrix ================= */
{ const M=[];
  models.slice(0,30).forEach(m=>{ M.push([`ano dp ng ${m}?`,'dp','field.dp'],[`${m} dp`,'dp','field.dp'],[`magkano dp at srp ng ${m}`,'dp','field.dp'],[`dp ng ${m} po`,'dp','field.dp']); });
  ['hdmi','usb-c','vga','type c'].forEach(c=>{ M.push([`${c} to dp cable`,'dp','connector.dp'],[`dp to ${c} adapter`,'dp','connector.dp'],[`dp cable para sa monitor`,'dp','connector.dp']); });
  M.push(['dp 1.4 cable 3m','dp 1.4','connector.dp(version)']);
  [5,8,16].forEach(n=>M.push([`${n} port switch`,'switch','family.network_switch'],[`gigabit switch ${n} ports`,'switch','family.network_switch']));
  M.push(['hdmi switch 3 in 1 out','switch','family.av_switch'],['usb sharing switch para sa printer','switch','family.usb_switch'],['charger para sa nintendo switch','nintendo switch','DEVICE']);
  models.slice(0,8).forEach(m=>M.push([`available ba ang ${m}?`,'available','inventory.stock'],[`available colors ng ${m}`,'available','catalog.listed'],[`meron pa bang stock ng ${m}`,'meron pa','inventory.stock']));
  M.push(['meron pa bang mas mura?','meron pa','more.options'],['meron pa bang iba?','meron pa','more.options'],['ilan pa ang natira?','ilan pa','inventory.qty']);
  M.push(['ok next question: may hdmi cable kayo?','ok','discourse.ok']);
  M.push(['10k power bank','k','thousand.mah'],['charger under 2k','under 2 k','PRICE'],['10g hub','g','unit.gbps'],['7 in 1 hub','7 in 1','PORTCOUNT'],['laptop bag 15.6 in','15.6 in','NUMUNIT']);
  M.push(['stylus para sa ipad','para sa','target.device'],['cable for macbook air','for','target.device'],['macbook air charger','macbook air','DEVICE'],['dual band wifi adapter','dual band','FEATURE'],['dual monitor dock','dual monitor','USECASE']);
  const wrong=[];
  M.forEach(([q,term,want])=>{ const P=keep(run(q)); let s=spanOf(P,term)||P.spans.find(x=>x.text.split(' ').includes(term)&&x.selected);
    if(!s && want.startsWith('family.')){ const f=P.spans.find(x=>x.type==='FAMILY'&&x.text.split(' ').includes(term)&&'family.'+x.value.family===want); if(f) s={ type:'FAMILY', selected:want }; }
    if(!s && want==='unit.gbps'){ const f=P.spans.find(x=>x.type==='NUMUNIT'&&x.value.dim==='speed'); if(f) s={ type:'NUMUNIT', selected:want }; }
    if(!s && term==='dp'){ const pr=P.spans.find(x=>x.type==='CONN_PAIR' && (x.value.from.id==='dp'||x.value.to.some(t=>t.id==='dp'))); if(pr) s={ type:'CONNECTOR', value:{ id:'dp' }, selected:'connector.dp' }; }
    const got=!s?'(no span)':(/^[A-Z_]+$/.test(want)?s.type:(want.endsWith('(version)')?(s.type==='CONNECTOR'&&s.value.id==='dp'&&s.value.ver?'connector.dp(version)':s.type):s.selected));
    if(got!==want) wrong.push(q+' :: '+term+' -> '+got+' (want '+want+')'); });
  chk('M2.1 sense matrix: '+M.length+' generated (term x context) cases resolve to the contextual sense', !wrong.length, wrong.slice(0,8).join(' | '));
  const P=run('hdmi to dp cable'), ok=P.senses.every(d=>d.scores&&d.state&&typeof d.margin==='number');
  chk('M2.2 every sense decision records candidate scores, fired signals, margin and state', ok && P.senses.length>0, JSON.stringify(P.senses));
  const A1=VP._altSenses(run('hdmi to dp cable')), A2=VP._altSenses(run('magkano dp ng hdmi cable'));
  chk('M2.3 alternative-sense retry is plausibility-gated: no candidate without its own positive signal ("hdmi to dp cable" offers no Dealer-Price retry)', !A1.some(a=>a.sense==='field.dp'), JSON.stringify(A1));
  chk('M2.4 an alternative with its own contextual evidence and a small gap IS offered for retry ("magkano dp ng hdmi cable")', A2.length>0 && A2.every(a=>/own signals/.test(a.why)), JSON.stringify(A2));
  const P5=run('ano dp ng hdmi cable'); const s5=spanOf(P5,'dp');
  chk('M2.5 a close call is surfaced, not hidden: margin < 1 -> SURFACED / AMBIGUOUS with the interpretation text', !s5 || s5.senseState==='CLEAR' || (s5.senseState!=='CLEAR' && (P5.proposal.interpretation.length>0 || P5.ledger.ambiguous.length>0)), JSON.stringify(s5&&[s5.senseState,s5.margin,P5.proposal.interpretation])); }

/* ================= M3 attribute vs count (structural) ================= */
{ const withAttr=a=>PUB.filter(p=>{ const g=G(p.item_code); return g && g[a]!=null; }).map(p=>String(p.model||'').trim()).filter(m=>/^[A-Z]{1,3}\d{2,4}[A-Z]?$/i.test(m));
  const cases=[]; const W=uniqBy(withAttr('watts'),x=>x).slice(0,10), MA=uniqBy(withAttr('mah'),x=>x).slice(0,10);
  W.forEach(m=>cases.push([`ilang watts yung ${m}?`,'ATTRIBUTE','watts'],[`how many watts does ${m} have`,'ATTRIBUTE','watts'],[`ilan ang watts ng ${m}`,'ATTRIBUTE','watts']));
  MA.forEach(m=>cases.push([`ilang mAh yung ${m}`,'ATTRIBUTE','mah'],[`how many mah ${m}`,'ATTRIBUTE','mah']));
  models.slice(40,48).forEach(m=>cases.push([`ilang ports yung ${m}`,'ATTRIBUTE','ports'],[`ilang kulay meron ang ${m}`,'ATTRIBUTE','colour']));
  [20,30,65,100].forEach(w=>cases.push([`ilan ang ${w}W chargers?`,'COUNT',null],[`how many ${w}w chargers do we have`,'COUNT',null]));
  [10000,20000].forEach(m=>cases.push([`ilan ang ${m.toLocaleString('en-US')}mAh power banks?`,'COUNT',null]));
  ['hubs','power banks','hdmi cables','earphones'].forEach(f=>cases.push([`ilang ${f} meron tayo`,'COUNT',null]));
  const wrong=cases.filter(([q,intent,field])=>{ const P=keep(run(q)); return P.frame.intent!==intent || (field && P.frame.field!==field); }).map(([q,i,f])=>{ const P=run(q); return q+' -> '+P.frame.intent+'/'+P.frame.field+' (want '+i+'/'+f+')'; });
  chk('M3.1 count cue + measure noun + concrete subject = ATTRIBUTE; count cue + product noun phrase = COUNT ('+cases.length+' generated)', !wrong.length, wrong.slice(0,8).join(' | '));
  const x=run('ilang watts yung '+W[0]+'?'); chk('M3.2 the ATTRIBUTE answer carries the value from the graph (watts of '+W[0]+')', x.proposal.values.length>0 && x.proposal.values[0].value===G(x.proposal.codes[0]).watts, JSON.stringify(x.proposal.values)); }

/* ================= M4 connectors + versions ================= */
{ const wrong=[];
  Object.keys(O.CONNECTORS).forEach(id=>{ O.CONNECTORS[id].aliases.forEach(a=>{ if(O.CONNECTORS[id].senseTerm===a) return; const P=keep(run('may '+a+' cable ba'));
    const ok=P.frame.constraints.some(c=>c.kind==='connector'&&c.id===id) || (id==='rj45' && P.frame.subject && P.frame.subject.family==='lan_cable');
    if(!ok) wrong.push(a+'->'+JSON.stringify(P.spans.map(x=>[x.text,x.type]))); }); });
  chk('M4.1 every ontology connector alias binds to its connector ('+Object.values(O.CONNECTORS).reduce((n,c)=>n+c.aliases.length,0)+' aliases)', !wrong.length, wrong.slice(0,10));
  const V=[['usb 3.0 a hub','usb_a','3.0'],['usb3.2 c cable','usb_c','3.2'],['hdmi 2.1 cable 2m','hdmi','2.1'],['dp 1.4 cable','dp','1.4'],['thunderbolt 4 cable','thunderbolt','4'],['usb 2.0 a extension','usb_a','2.0']];
  const wv=V.filter(([q,id,ver])=>{ const c=run(q).frame.constraints.find(k=>k.kind==='connector'); return !c || c.id!==id || c.ver!==ver; });
  chk('M4.2 connector versions bind with the connector (usb 3.0 a / usb3.2 c / hdmi 2.1 / dp 1.4 / thunderbolt 4)', !wv.length, JSON.stringify(wv));
  const P=run('hdmi 2.1 cable'), codes=P.proposal.codes;
  chk('M4.3 a version constraint is never satisfied by a different listed version (hdmi 2.1 -> no product whose name says another HDMI version)', codes.length>0 && codes.every(c=>{ const v=G(c).versions.hdmi; return !v || v==='2.1'; }), codes.filter(c=>G(c).versions.hdmi && G(c).versions.hdmi!=='2.1')); }

/* ================= M5 port roles ================= */
{ const powerNamed=PUB.filter(p=>/with (?:usb-c|type-c|micro usb) power\s+port/i.test(p.product_name)).map(p=>String(p.item_code));
  chk('M5.1 graph: "With <conn> Power Port" in a name binds that connector to power_input, not to the main/data connectors ('+powerNamed.length+' products)', powerNamed.length>0 && powerNamed.every(c=>G(c).conns.power.length===1 && G(c).feats.power_port && G(c).feats.power_port.state==='CONFIRMED'), powerNamed.filter(c=>!G(c).conns.power.length));
  const cc=PUB.filter(p=>/usb-c to usb-c .*cable/i.test(p.product_name)&&!/female/i.test(p.product_name)).map(p=>String(p.item_code)).slice(0,20);
  chk('M5.2 graph: "PD fast charging" is a feature, not a power-input port (USB-C to USB-C cables keep USB-C on both ends: '+cc.length+')', cc.length>0 && cc.every(c=>!G(c).conns.power.length && G(c).pair && G(c).pair.to.includes('usb_c')), cc.filter(c=>G(c).conns.power.length));
  const R=[['usb-a hub na may power port','feature','power_port'],['hub with usb-c power port','role','power_input'],['type c to 3.5mm adapter with charging port','feature','passthrough'],['hub na may pd in','role','power_input']];
  const wr=R.filter(([q,k,v])=>!run(q).frame.constraints.some(c=>(c.kind===k && (c.id===v||c.role===v)) || (c.kind==='feature'&&c.id==='power_port'&&v==='power_input') || (c.kind==='role'&&c.role==='power_input'&&v==='power_port')));
  chk('M5.3 port-role phrases bind to a role / evidence constraint (power port, <conn> power port, charging port, pd in)', !wr.length, JSON.stringify(wr));
  const P=run('usb-c hub'); chk('M5.4 a connector that modifies a hub noun is the hub plug: "usb-c hub" never returns a USB-A-plug hub whose only USB-C is its power port', P.proposal.codes.length>0 && P.proposal.codes.every(c=>G(c).plugs.includes('usb_c')), P.proposal.codes.filter(c=>!G(c).plugs.includes('usb_c'))); }

/* ================= M6 directionality ================= */
{ const conv=PUB.map(p=>String(p.item_code)).filter(c=>{ const g=G(c); return g && g.pair && !g.pair.bidi && g.pair.from.length===1 && g.pair.to.length>=1 && g.pair.to[0]!==g.pair.from[0]; });
  let wrong=[];
  conv.forEach(c=>{ const g=G(c), A=g.pair.from[0], B=g.pair.to[0];
    const fwd=VP.evalConstraint(c,{ kind:'pair', from:{id:A}, to:[{id:B}], multiport:true },OPTS), rev=VP.evalConstraint(c,{ kind:'pair', from:{id:B}, to:[{id:A}], multiport:true },OPTS);
    if(fwd!=='CONFIRMED' || (rev!=='CONTRADICTED' && !(g.pair.from.includes(B)))) wrong.push(c+' '+A+'>'+B+' fwd='+fwd+' rev='+rev); });
  chk('M6.1 every directional converter/adapter in the catalogue CONFIRMS A->B and CONTRADICTS B->A ('+conv.length+' products, derived)', conv.length>20 && !wrong.length, wrong.slice(0,6));
  const passive=PUB.map(p=>String(p.item_code)).filter(c=>{ const g=G(c); return g && g.pair && g.pair.bidi && g.pair.to.length && g.pair.to[0]!==g.pair.from[0]; }).slice(0,40);
  chk('M6.2 passive plug-to-plug cables (no female end, not a converter, not video) connect either way round ('+passive.length+' sampled)', passive.length>0 && passive.every(c=>{ const g=G(c); return VP.evalConstraint(c,{ kind:'pair', from:{id:g.pair.to[0]}, to:[{id:g.pair.from[0]}] },OPTS)==='CONFIRMED' && !/female|converter|adapt/.test(g.lname) && !/^video_/.test(g.family); }));
  const H2V=run('hdmi to vga adapter'), V2H=run('vga to hdmi adapter');
  chk('M6.3 HDMI->VGA and VGA->HDMI return disjoint products', H2V.proposal.codes.length>0 && V2H.proposal.codes.length>0 && !H2V.proposal.codes.some(c=>V2H.proposal.codes.includes(c)), JSON.stringify([H2V.proposal.codes,V2H.proposal.codes]));
  const pairs=[['hdmi','vga'],['usb-c','hdmi'],['dp','hdmi'],['usb-c','3.5mm'],['lightning','3.5mm'],['micro usb','usb-c'],['3.5mm','rca']];
  const dirBad=pairs.filter(([a,b])=>{ const f=run(a+' to '+b).frame.constraints.find(c=>c.kind==='pair'); return !f || f.label.toLowerCase().indexOf(' to ')<0 || run(b+' to '+a).frame.constraints.find(c=>c.kind==='pair').from.id===f.from.id; });
  chk('M6.4 the frame keeps A->B order for '+pairs.length+' connector pairs (reversed query = reversed frame)', !dirBad.length, JSON.stringify(dirBad)); }

/* ================= M7 coverage ledger ================= */
{ const nonsense=['zorblat','qwixel','flumbo','kreptis','vandrok'];
  const fams=['charger','power bank','hdmi cable','hub','earphones'];
  let silent=0, bad=[];
  fams.forEach(f=>nonsense.forEach(w=>{ const q=f+' na '+w; const P=keep(run(q));
    const u=P.ledger.unresolved.find(x=>x.text===w); silent+=P.ledger.silentDrops.length;
    if(!u || P.proposal.kind==='exact') bad.push(q+' -> '+(u?'unresolved':'NOT reported')+' / '+P.proposal.kind); }));
  chk('M7.1 an unknown word next to a product noun is UNRESOLVED (reported, never ignored) and blocks a confident exact answer (25 generated)', !bad.length, bad.slice(0,5));
  const P=run('may '+nonsense[0]+' ba kayo?');
  chk('M7.2 an unknown name is never inherited or guessed: "not found" / clarify, no products', P.proposal.codes.length===0 && /not-found|clarify/.test(P.proposal.kind), P.proposal.kind);
  CORPUS.forEach(x=>{ silent+=x.ledger.silentDrops.length; });
  chk('M7.3 zero silent span drops over the whole generated corpus ('+CORPUS.length+' questions)', silent===0, CORPUS.filter(x=>x.ledger.silentDrops.length).slice(0,5).map(x=>x.q+' :: '+JSON.stringify(x.ledger.silentDrops)));
  const st=CORPUS.every(x=>x.spans.every(s=>['BOUND','UNCONFIRMABLE','UNRESOLVED','AMBIGUOUS'].includes(s.state)));
  chk('M7.4 every span of the corpus ends in BOUND / UNCONFIRMABLE / UNRESOLVED / AMBIGUOUS', st);
  const U=run('earphones na may mic'); const um=U.spans.find(s=>s.text==='may mic');
  chk('M7.5 UNKNOWN is not FALSE and not IGNORE: an unconfirmable feature is stated (state UNCONFIRMABLE or none-confirmed note)', (um && um.state==='UNCONFIRMABLE') || U.proposal.kind==='none-confirmed', JSON.stringify([um&&um.state,U.proposal.kind,U.proposal.notes])); }

/* ================= M8 false-negative ladder ================= */
{ const colours=['pink','gold','beige','yellow']; const cases=[];
  ['charger','power bank','hub','hdmi cable'].forEach(f=>colours.forEach(c=>cases.push(c+' '+f)));
  const wrong=cases.filter(q=>{ const P=run(q); return P.proposal.kind==='none' && P.proposal.ladder.length<3; });
  chk('M8.1 "Wala" only after the ladder ran (exact -> alternative sense -> unknown-tolerant -> direction -> relax -> family)', !wrong.length, wrong);
  const relaxed=cases.map(run).filter(P=>P.proposal.kind==='closest');
  chk('M8.2 a wider result is labelled "No exact match for <constraint>; closest options are…" ('+relaxed.length+' generated cases)', relaxed.length>0 && relaxed.every(P=>P.proposal.notes.some(n=>/^No exact match for /.test(n))), relaxed.slice(0,3).map(P=>P.proposal.notes));
  const ALLC=PUB.map(p=>String(p.item_code));
  const rev=ALLC.filter(c=>{ const g=G(c); return g&&g.pair&&!g.pair.bidi&&g.pair.from.length===1&&g.pair.to.length===1&&g.pair.to[0]!==g.pair.from[0]; }).map(c=>G(c))
    .filter(g=>!ALLC.some(c=>VP.evalConstraint(c,{ kind:'pair', from:{id:g.pair.to[0]}, to:[{id:g.pair.from[0]}] },OPTS)==='CONFIRMED'));
  const lab=k=>O.CONNECTORS[k]?O.CONNECTORS[k].aliases[0]:k;
  const rq=rev.slice(0,6).map(g=>run(lab(g.pair.to[0])+' to '+lab(g.pair.from[0])));
  chk('M8.3 a missing direction is never presented as an exact match: the reverse product is offered AND named, or direction-unknown products are shown as unconfirmed (derived one-way pairs: '+rq.length+')', rq.length>0 && rq.every(P=>(P.proposal.kind==='closest' && P.proposal.notes.some(n=>/reverse direction/.test(n))) || (P.proposal.kind==='partial' && P.proposal.unconfirmed.some(u=>/ to /.test(u)))), rq.map(P=>P.q+' :: '+P.proposal.kind+' '+P.proposal.notes[0]).slice(0,4));
  const N=run('meron ba tayong qi2 earphones?');
  chk('M8.4 an UNKNOWN-only constraint gives "none confirmed" (not "wala", not the whole family as if it matched)', N.proposal.kind==='none-confirmed' || N.proposal.codes.every(c=>G(c).feats.qi2), JSON.stringify([N.proposal.kind,N.proposal.notes]));
  const E=run('earphones na may mic na type c'); chk('M8.5 UNKNOWN-tolerant results are presented as partial with the unconfirmed constraint named', E.proposal.kind!=='partial' || E.proposal.unconfirmed.length>0, JSON.stringify(E.proposal.unconfirmed)); }

/* ================= M9 label integrity ================= */
{ const qs=[]; ['usb-c','usb-a','hdmi'].forEach(c=>['hub','cable','adapter'].forEach(f=>qs.push(c+' '+f))); [4,7].forEach(n=>qs.push(n+' port hub')); ['65w charger','20000mah power bank','2m hdmi cable','hdmi to vga adapter','usb-a hub 4 ports na may power port','dock with hdmi and dp'].forEach(q=>qs.push(q));
  const viol=[]; qs.forEach(q=>{ const P=keep(run(q)); const A=VP.auditLabel(P.proposal.label,P.proposal.codes,Object.assign({ isLabel:true },OPTS)); if(A.violations.length||A.wording.length) viol.push(q+' :: '+P.proposal.label+' :: '+JSON.stringify(A.violations.concat(A.wording).slice(0,2))); });
  chk('M9.1 every v2 label is the verified intersection of the shown products (audit: 0 violations over '+qs.length+' generated queries)', !viol.length, viol.slice(0,4));
  const usbcPlugHubs=famCodes('hub_dock').filter(c=>G(c).plugs[0]==='usb_c').slice(0,5);
  chk('M9.2 the auditor catches "USB-A hubs" on USB-C-plug hubs', VP.auditLabel('5 USB-A hubs:',usbcPlugHubs,OPTS).violations.length>0);
  const docks=famCodes('hub_dock').filter(c=>G(c).subtype==='dock'&&!/\bhub\b/.test(G(c).lname)).slice(0,3);
  chk('M9.3 the auditor flags "hub" wording on a docking station', VP.auditLabel('1 USB-C hub with 7 ports:',docks,OPTS).wording.length>0);
  const v2h=PUB.map(p=>String(p.item_code)).filter(c=>{ const g=G(c); return g&&g.pair&&g.pair.from[0]==='vga'&&g.pair.to.includes('hdmi'); });
  chk('M9.4 the auditor flags "HDMI to VGA" on a VGA->HDMI converter', v2h.length>0 && VP.auditLabel('2 HDMI to VGA adapters:',v2h,OPTS).violations.length>0);
  const P=run('hub na may hdmi at rj45'); chk('M9.5 ports are written as "with …", never as the plug ("… hubs with HDMI · RJ45", not "RJ45 hubs")', !/rj45 (hubs|docking)/i.test(P.proposal.label||''), P.proposal.label); }

/* ================= M10 compat parsing / device hints ================= */
{ const anchors=models.filter(m=>{ const c=PUB.find(p=>String(p.model).trim()===m); return c && FACTS.byCode[c.item_code].type.family==='hub_dock'; }).slice(0,4);
  const named=['macbook air','iphone 16 pro','galaxy s24 ultra','nintendo switch','ipad'];
  const bad=[]; anchors.forEach(a=>named.forEach(d=>{ const P=keep(run(`pwede ba ang ${a} sa ${d}?`)); if(P.frame.intent!=='COMPAT'||!P.frame.device||P.frame.device.kind!=='named'||P.proposal.route!=='WEB') bad.push(P.q+' -> '+P.frame.intent+'/'+(P.frame.device&&P.frame.device.kind)+'/'+P.proposal.route); }));
  chk('M10.1 named product + named device + fit verb = COMPAT, named device, official-source route ('+(anchors.length*named.length)+' generated)', !bad.length, bad.slice(0,4));
  const cls=['projector','monitor','tv','laptop'];
  const hint=[]; anchors.slice(0,2).forEach(a=>cls.forEach(d=>{ const P=keep(run(`pwede ba ang ${a} sa ${d}?`)); if(P.frame.device.kind!=='class'||P.proposal.route==='WEB'||!/can.t confirm the/.test(P.proposal.hint||'')) hint.push(P.q+' -> '+P.proposal.route+' :: '+P.proposal.hint); }));
  chk('M10.2 device class = hint only: the reply names the product connection and says it cannot confirm the device without its model/input', !hint.length, hint.slice(0,3));
  const noProof=famCodes('video_adapter').slice(0,30).filter(c=>!G(c).targets.includes('class:projector'));
  chk('M10.3 a device-class target is never CONFIRMED without name evidence (UNKNOWN, not proof): '+noProof.length+' adapters x projector', noProof.every(c=>VP.evalConstraint(c,{ kind:'device', device:{ kind:'class', id:'projector' } },OPTS)==='UNKNOWN'));
  const forIpad=PUB.filter(p=>/\bfor ipad\b/i.test(p.product_name)).map(p=>FACTS.byCode[p.item_code].type.family);
  if(forIpad.length){ const fam0=O&&forIpad[0]; const famWord=require(path.join(ROOT,'js','vero-lexicon.js')).taxonomy.families.find(f=>f.id===fam0).label;
    const P=run(`may ${famWord} para sa ipad?`); chk('M10.4 named device confirmed by product names (bare model) -> LOCAL catalogue answer ("'+famWord+' para sa ipad")', P.proposal.route==='LOCAL' && P.proposal.codes.length>0, JSON.stringify([P.proposal.route,P.proposal.codes]));
    const P2=run(`may ${famWord} para sa ipad pro 13?`); chk('M10.5 a specific device model ("ipad pro 13") is not proven by "for iPad" in the name -> official-source route', P2.proposal.route==='WEB', P2.proposal.route); }
  const K=run('cable for monitor'); chk('M10.6 device class + only a generic form ("cable for monitor") -> clarify with the LIKELY connectors as hints', K.proposal.route==='CLARIFY' && /hint/.test(K.proposal.notes.join(' ')), JSON.stringify(K.proposal)); }

/* ================= M11 data-driven graph: future SKUs, CM763 fixture ================= */
{ const fake={ sheet:'Mobile', category:'Wall Charger/Desk Charger', model:'ZX999', item_code:'99999T', product_name:'Nexora Ultra 140W GaN Fast Charger with Retractable Cable', color:'Black', length:'', srp:'2999', dp:'2299', dp_volume:'', moq:'10', features:'▪ Output: 2*USB-C + 1*USB-A\n▪ Max 140W', description:'', short_desc:'', sheet_display:'Mobile: Charger' };
  const P2=PUB.concat([fake]), F2=VF.build(P2,{ force:true }), O2={ facts:F2, products:P2 };
  const r=VP.run('magkano yung nexora ultra?',O2), g=VP.graphFor('99999T',O2);
  chk('M11.1 a NEW SKU joins automatically: its line name becomes a NAME span and its edges (family, watts, retractable) are derived from data', r.proposal.codes[0]==='99999T' && g.family==='charger' && g.watts===140 && g.feats.retractable && g.feats.retractable.state==='CONFIRMED', JSON.stringify([r.proposal.codes,g&&g.family,g&&g.watts]));
  const r2=VP.run('140w charger na may retractable cable',O2); chk('M11.2 the new SKU answers a constraint query with no code change', r2.proposal.codes.includes('99999T'), r2.proposal.codes);
  const cm=PUB.find(p=>p.model==='CM763'); const fx=PUB.map(p=>p===cm?Object.assign({},p,{ category:'Wireless Ethernet Adapter' }):p); const F3=VF.build(fx,{ force:true });
  const g3=VP.graphFor(cm.item_code,{ facts:F3, products:fx });
  chk('M11.3 CM763 correction (approved in principle) applied ONLY to an in-memory fixture: the subtype follows the data (wifi), products.json untouched', g3.subtype==='wifi' && fs.readFileSync(path.join(ROOT,'data','products.json'),'utf8')===RAW, g3.subtype);
  VF.build(PUB,{ force:true }); VP.catalog(VF.build(PUB),PUB); }

/* ================= M12 purity + performance ================= */
{ chk('M12.1 products.json objects not mutated by the v2 parser', JSON.stringify(ALL)===JSON.stringify((()=>{ const a=JSON.parse(RAW); pcResolveSchedule(a); return a; })()));
  const src=fs.readFileSync(path.join(ROOT,'js','vero-parse.js'),'utf8')+fs.readFileSync(path.join(ROOT,'js','vero-ontology.js'),'utf8');
  const codes=new Set(PUB.map(p=>String(p.item_code))), leak=[...codes].filter(c=>c.length>=5 && src.indexOf("'"+c+"'")>=0);
  chk('M12.2 no catalogue SKU codes hardcoded in vero-parse.js / vero-ontology.js', !leak.length, leak.slice(0,5));
  const BQ=JSON.parse(fs.readFileSync(path.join(__dirname,'vero-sales-questions.json'),'utf8')).questions.map(q=>q.question.toLowerCase());
  const leakQ=BQ.filter(q=>q.length>14 && src.toLowerCase().indexOf(q)>=0);
  chk('M12.3 no benchmark question text inside the v2 source', !leakQ.length, leakQ.slice(0,3));
  const t=[]; for(let i=0;i<400;i++){ const qq=pick(['magkano ','meron ba ','pinakamura na ','ilang ','']) + pick(models.concat(['65w charger','usb-c hub','2m hdmi cable','10000mah power bank','hdmi to vga adapter'])) + pick(['',' po',' na may power port',' 2m',' gray']); const s=process.hrtime.bigint(); VP.run(qq,OPTS); t.push(Number(process.hrtime.bigint()-s)/1e6); }
  t.sort((a,b)=>a-b); const p95=t[Math.floor(t.length*0.95)];
  chk('M12.4 performance: 400 generated turns, p95 '+p95.toFixed(2)+' ms (budget 15 ms, Node)', p95<=15, p95);
  const odd=['','   ','???','12345','₱','😀 charger','a'.repeat(400),'usb-c to to to hdmi','2 2 2 2 port port','ano ba yan hahaha','to','with with may may','dp dp dp','k k k','0w 0mah 0m','-5m cable','99999999999 mah power bank','hdmi to','to hdmi','"quoted" cable','x'.repeat(30)+' 65w'];
  const thrown=[]; odd.forEach(q=>{ try{ const P=VP.run(q,OPTS); if(!P.proposal||!P.ledger) thrown.push(q+' (no proposal)'); if(P.ledger.silentDrops.length) thrown.push(q+' (silent)'); }catch(e){ thrown.push(q+' -> '+e.message); } });
  chk('M12.6 robustness: odd inputs (empty, symbols, emoji, 400-char, dangling "to", repeated words, negative / huge numbers) never throw and never drop spans silently', !thrown.length, thrown);
  chk('M12.5 v2 is not loaded by index.html / vero-engine.js / vero.js (shadow only)', !/vero-parse|vero-ontology/.test(fs.readFileSync(path.join(ROOT,'index.html'),'utf8')+fs.readFileSync(path.join(ROOT,'js','vero-engine.js'),'utf8')+fs.readFileSync(path.join(ROOT,'js','vero.js'),'utf8'))); }

console.log(`\nVERO v2-1 parse tests: ${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
