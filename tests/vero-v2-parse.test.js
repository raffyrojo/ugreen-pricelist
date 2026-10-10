/* VERO Local Brain v2-1 / v2-2B — accountable parse + A5 turn-frame emission: generative structural matrices (SHADOW ONLY).
   Run: node tests/vero-v2-parse.test.js
   Questions are GENERATED from templates x catalogue values (models, families, connectors, units) with a fixed seed;
   none are copied from the 144 benchmark or the held-out sets. Expectations are derived from data/products.json.
   M1 lexer + span ledger          M2 sense matrix              M3 attribute vs count       M4 connector + version
   M5 port roles                   M6 directionality            M7 coverage ledger          M8 false-negative ladder
   M9 label integrity              M10 compat / device hints    M11 data-driven graph (future SKU, CM763 fixture)
   M12 purity + performance
   V2-2B: A5 validator · R RELAX · X EXCLUDE · O ordinals/references · V version/interface/lanes · K comparatives ·
          NG name guard · H end-to-end chains through VeroDiscourse · I robustness + contract-drift pin
   V2-2C C1: C1.P parser follow-ups · C1.A additive A5 amendment (flags.same, keep) · C1.O ontology concepts · C1.E frame executor +
          evidence / USB matrices + price-cache fixture · C1.H discourse chain · C1.MUT mutation kills */
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
  const DVS=JSON.parse(fs.readFileSync(path.join(__dirname,'vero-v2-devsets.json'),'utf8')), HOQ=[]; Object.keys(DVS.sets).forEach(k=>DVS.sets[k].items.forEach(it=>HOQ.push(String(it.q).toLowerCase())));
  const leakQ=BQ.concat(HOQ).filter(q=>q.length>10 && src.toLowerCase().indexOf(q)>=0);
  chk('M12.3 no benchmark or HO1-3 question text inside the v2 source ('+(BQ.length+HOQ.length)+' questions, any longer than 10 chars)', !leakQ.length, leakQ.slice(0,3));
  const t=[]; for(let i=0;i<400;i++){ const qq=pick(['magkano ','meron ba ','pinakamura na ','ilang ','']) + pick(models.concat(['65w charger','usb-c hub','2m hdmi cable','10000mah power bank','hdmi to vga adapter'])) + pick(['',' po',' na may power port',' 2m',' gray']); const s=process.hrtime.bigint(); VP.run(qq,OPTS); t.push(Number(process.hrtime.bigint()-s)/1e6); }
  t.sort((a,b)=>a-b); const p95=t[Math.floor(t.length*0.95)];
  chk('M12.4 performance: 400 generated turns, p95 '+p95.toFixed(2)+' ms (budget 15 ms, Node)', p95<=15, p95);
  const odd=['','   ','???','12345','₱','😀 charger','a'.repeat(400),'usb-c to to to hdmi','2 2 2 2 port port','ano ba yan hahaha','to','with with may may','dp dp dp','k k k','0w 0mah 0m','-5m cable','99999999999 mah power bank','hdmi to','to hdmi','"quoted" cable','x'.repeat(30)+' 65w'];
  const thrown=[]; odd.forEach(q=>{ try{ const P=VP.run(q,OPTS); if(!P.proposal||!P.ledger) thrown.push(q+' (no proposal)'); if(P.ledger.silentDrops.length) thrown.push(q+' (silent)'); }catch(e){ thrown.push(q+' -> '+e.message); } });
  chk('M12.6 robustness: odd inputs (empty, symbols, emoji, 400-char, dangling "to", repeated words, negative / huge numbers) never throw and never drop spans silently', !thrown.length, thrown);
  /* M12.5 (generalised, BA9): the dormant-module list comes from the gate's ONE authoritative SHADOW map + ORDER; fail closed */
  const GATE_SRC=fs.readFileSync(path.join(__dirname,'vero-asset-checks.py'),'utf8');
  let gm=null; try{ gm=gateMaps(GATE_SRC); }catch(e){ gm={ err:e.message }; }
  chk('M12.5a gate SHADOW + ORDER extracted exactly (1 SHADOW map incl. the known v2 modules, 7 ORDER files, all exist)', gm && !gm.err && gm.order.length===7 && ['VeroOntology','VeroParse','VeroDiscourse'].every(g=>gm.shadow.some(s=>s[1]===g)), gm&&gm.err);
  const hits=gm&&!gm.err?shadowHits(gm):['(no map)'];
  chk('M12.5 v2 shadow files/globals ('+(gm&&gm.shadow?gm.shadow.map(s=>s[1]).join(', '):'?')+') are referenced by NO live file: index.html + all '+(gm&&gm.order?gm.order.length:'?')+' load-order scripts (case-sensitive, derived tokens)', !hits.length, hits);
  const MAL=gateMalformedCopies(GATE_SRC), survived=MAL.filter(([n,s])=>{ try{ gateMaps(s); return true; }catch(e){ return false; } }).map(([n])=>n);
  chk('M12.5b extractor self-test: every malformed gate copy is rejected ('+MAL.length+': '+MAL.map(m=>m[0]).join(', ')+')', MAL.length>=9 && !survived.length, survived); }

/* ---------- gate SHADOW / ORDER extractor (shared shape with tests/vero-v2-shadow.js S03; reads, never hardcodes, the module list) ---------- */
function gateMaps(src){
  const shLines=src.split(/\r?\n/).filter(l=>/^\s*SHADOW\s*(=|\[|\.|\+)/.test(l)), orLines=src.split(/\r?\n/).filter(l=>/^\s*ORDER\s*(=|\[|\.|\+)/.test(l));
  if(shLines.length!==1) throw new Error('SHADOW definitions: '+shLines.length);
  if(orLines.length!==1) throw new Error('ORDER definitions: '+orLines.length);
  const sm=shLines[0].match(/^SHADOW\s*=\s*\{([^{}]*)\}\s*(?:#.*)?$/); if(!sm) throw new Error('SHADOW not a one-line dict literal');
  const shadow=[]; const restS=sm[1].replace(/'([^'\\]+)'\s*:\s*'([^'\\]+)'\s*(?:,|$)/g,(m,f,g)=>{ shadow.push([f,g]); return ''; });
  if(restS.trim()) throw new Error('malformed SHADOW entry: '+restS.trim());
  if(!shadow.length) throw new Error('empty SHADOW');
  const om=orLines[0].match(/^ORDER\s*=\s*\[([^\[\]]*)\]\s*(?:#.*)?$/); if(!om) throw new Error('ORDER not a one-line list literal');
  const order=[]; const restO=om[1].replace(/'([^'\\]+)'\s*(?:,|$)/g,(m,f)=>{ order.push(f); return ''; });
  if(restO.trim()) throw new Error('malformed ORDER entry: '+restO.trim());
  if(order.length!==7) throw new Error('ORDER must list exactly 7 runtime files, got '+order.length);
  const seenF=new Set(), seenG=new Set();
  shadow.forEach(([f,g])=>{ if(!/^js\/[\w-]+\.js$/.test(f) || !/^[A-Z][A-Za-z0-9]+$/.test(g)) throw new Error('malformed SHADOW pair '+f+':'+g);
    if(seenF.has(f)||seenG.has(g)) throw new Error('duplicate SHADOW entry '+f); seenF.add(f); seenG.add(g);
    if(!fs.existsSync(path.join(ROOT,f))) throw new Error('SHADOW file missing: '+f); });
  [['js/vero-ontology.js','VeroOntology'],['js/vero-parse.js','VeroParse'],['js/vero-discourse.js','VeroDiscourse']].forEach(([f,g])=>{ if(!shadow.some(s=>s[0]===f && s[1]===g)) throw new Error('known v2 module missing from SHADOW: '+f); });
  order.forEach(f=>{ if(!/^js\/[\w-]+\.js$/.test(f) || !fs.existsSync(path.join(ROOT,f))) throw new Error('ORDER file missing / malformed: '+f); if(seenF.has(f)) throw new Error('runtime file in SHADOW: '+f); });
  if(new Set(order).size!==order.length) throw new Error('duplicate ORDER entry');
  return { shadow, order }; }
function shadowHits(gm){ /* G23 semantics: exact basenames without .js + exact-case globals, regex-escaped, over index.html + every ORDER file */
  const toks=[...new Set(gm.shadow.map(([f])=>path.basename(f).slice(0,-3)).concat(gm.shadow.map(s=>s[1])))], re=new RegExp(toks.map(t=>t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|'),'g'), out=[];
  ['index.html'].concat(gm.order).forEach(f=>{ (fs.readFileSync(path.join(ROOT,f),'utf8').match(re)||[]).forEach(m=>out.push(f+':'+m)); }); return out; }
function gateMalformedCopies(src){ const L=src.split(/\r?\n/), iS=L.findIndex(l=>/^SHADOW\s*=/.test(l)), iO=L.findIndex(l=>/^ORDER\s*=/.test(l)), sub=(i,f)=>L.map((l,k)=>k===i?f(l):l).join('\n');
  return [['no SHADOW',L.filter((l,k)=>k!==iS).join('\n')],['two SHADOW',L.slice(0,iS+1).concat([L[iS]],L.slice(iS+1)).join('\n')],['SHADOW update line',L.concat(["SHADOW['js/x.js'] = 'X'"]).join('\n')],
    ['malformed SHADOW pair',sub(iS,l=>l.replace("'js/vero-parse.js': 'VeroParse'","'js/vero-parse.js' 'VeroParse'"))],['duplicate SHADOW key',sub(iS,l=>l.replace('}',", 'js/vero-parse.js': 'VeroParseB'}"))],
    ['missing SHADOW file',sub(iS,l=>l.replace("'js/vero-parse.js'","'js/vero-parse-missing.js'"))],['known module dropped',sub(iS,l=>l.replace(/, 'js\/vero-discourse\.js': 'VeroDiscourse'/,''))],
    ['ORDER with 6 files',sub(iO,l=>l.replace(", 'js/vero.js'",''))],['no ORDER',L.filter((l,k)=>k!==iO).join('\n')],['lower-case global',sub(iS,l=>l.replace("'VeroParse'","'veroParse'"))]]; }

/* =====================================================================================================================
   V2-2B — the parser EMITS the frozen A5 turn frame (VeroParse.turnFrame). Shadow only; js/vero-discourse.js unchanged.
   ===================================================================================================================== */
const crypto=require('crypto');
const DISC_PATH=path.join(ROOT,'js','vero-discourse.js'), DISC_SRC=fs.readFileSync(DISC_PATH,'utf8');
const D=require(DISC_PATH);
const TF=q=>VP.turnFrame(VP.parse(q,OPTS));
const PR=q=>{ const P=VP.run(q,OPTS); return { P, T:VP.turnFrame(P) }; };
const ifIds=Object.keys(O.INTERFACES);
/* ---------- closed-world A5 validator (independent of the parser: derived from the contract header + discourse source) ---------- */
const FORBID=new Set((DISC_SRC.match(/var FORBIDDEN_KEYS=\{([\s\S]*?)\};/)||[,''])[1].match(/\b\w+(?=:1)/g)||[]);
/* V2-2C C1 additive A5 amendment (design §12-D, DECISIONS): optional top-level keep:[{ slot, span? }] and flags.same — exactly
   these two keys; VeroDiscourse ignores both (sanitizeFrame drops keep; flags pass through) and its bytes are unchanged (I3) */
const A5={ top:['intent','subject','constraints','fields','flags','relax','ref','metric','rank','sameBut','ledger'], optTop:['choice','keep'],
  subject:['family','subtype','interface','anchors'], anchor:['kind','codes'], anchorKinds:['sku','model','name'],
  constraint:['kind','slot','value','op','polarity','hard','interfaces','typed','origin','source'], source:['span'],
  flags:['needsContext','elliptical','refPronoun','selectCue','followUp','same'], relax:['slot','span'], keep:['slot','span'], ref:['kind','n'], refKinds:['focus','results','ordinal','other'],
  metric:['metric','dir','candidates','judgement'], rank:['metric','dir'], ledger:['span','state','nameShaped','impact'], states:['BOUND','UNCONFIRMABLE','UNRESOLVED','AMBIGUOUS'],
  intents:['FIND','ATTRIBUTE','INVENTORY','COMPARE','ALTERNATIVE','RANK','SMALLTALK','NODATA','COUNT','EXIST','RECOMMEND','COMPAT','CLARIFY','COACH','PRICE_HISTORY'],
  kinds:['num','ports','connector','feature','colour','standard','form','price','name','pair','version','lanes','family','component','role','res','hz','size','nametoken','nametext'],
  numOps:['=','>=','<=','>','<'] };
function validateA5(T){ const bad=[]; const B=(w)=>bad.push(w), keys=(o,allowed,where)=>Object.keys(o).forEach(k=>{ if(!allowed.includes(k)) B(where+': key '+k+' not in contract'); });
  const isO=x=>!!x && typeof x==='object' && !Array.isArray(x);
  if(!isO(T)) return ['frame not an object'];
  keys(T,A5.top.concat(A5.optTop),'top'); A5.top.forEach(k=>{ if(!(k in T)) B('top: missing '+k); });
  (function walk(x,p){ if(Array.isArray(x)) x.forEach((v,i)=>walk(v,p+'['+i+']')); else if(isO(x)) Object.keys(x).forEach(k=>{ if(FORBID.has(k.toLowerCase())) B('forbidden key '+p+'.'+k); walk(x[k],p+'.'+k); }); })(T,'');
  if(!A5.intents.includes(T.intent)) B('intent '+T.intent);
  const S=T.subject; if(S!==null){ if(!isO(S)) B('subject not object'); else { keys(S,A5.subject,'subject');
    if('family' in S && S.family!==null && typeof S.family!=='string') B('subject.family');
    if('interface' in S && !ifIds.includes(S.interface)) B('subject.interface '+S.interface);
    if('anchors' in S){ if(!Array.isArray(S.anchors)||!S.anchors.length) B('anchors'); else S.anchors.forEach((a,i)=>{ if(!isO(a)) return B('anchor '+i); keys(a,A5.anchor,'anchor'); if(!A5.anchorKinds.includes(a.kind)) B('anchor kind '+a.kind); if(!Array.isArray(a.codes)||!a.codes.length||!a.codes.every(c=>typeof c==='string')) B('anchor codes'); }); } } }
  const explicitFam=S && typeof S.family==='string' && !S.anchors;
  if(!Array.isArray(T.constraints)) B('constraints'); else T.constraints.forEach((c,i)=>{ const w='constraint '+i+' ('+(c&&c.slot)+')'; if(!isO(c)) return B(w);
    keys(c,A5.constraint,w); if(!A5.kinds.includes(c.kind)) B(w+' kind '+c.kind); if(typeof c.slot!=='string'||!c.slot) B(w+' slot');
    if(![true,false,null].includes(c.polarity)) B(w+' polarity '+c.polarity); if(typeof c.hard!=='boolean') B(w+' hard');
    if(!isO(c.source) || typeof c.source.span!=='string') B(w+' source'); else keys(c.source,A5.source,w+'.source');
    if('op' in c && !(c.kind==='num'||c.kind==='ports'||c.kind==='price')) B(w+' op on '+c.kind);
    if('op' in c && !(A5.numOps.includes(c.op) || (c.kind==='price' && c.op==='~'))) B(w+' op '+c.op);
    if('interfaces' in c){ if(!Array.isArray(c.interfaces)||!c.interfaces.length||!c.interfaces.every(x=>ifIds.includes(x))) B(w+' interfaces'); if(c.polarity!==true) B(w+' interfaces on a non-affirmed constraint'); }
    if(('typed' in c || 'origin' in c) && c.kind!=='price') B(w+' typed/origin on '+c.kind);
    const sl=c.slot, v=c.value;
    switch(c.kind){
      case 'num': if(!/^num:[a-zA-Z]+$/.test(sl)||typeof v!=='number') B(w+' num shape'); break;
      case 'ports': if(!(sl==='ports'||/^ports:[a-z_0-9]+$/.test(sl))||typeof v!=='number') B(w+' ports shape');
        if(/^ports:/.test(sl) && sl!=='ports:in1' && !explicitFam) B(w+' C1: qualified ports without a family named in this turn'); break;
      case 'connector': if(!isO(v)||sl!=='connector:'+v.id) B(w+' connector shape'); break;
      case 'version': if(!isO(v)||!('interface' in v)||v.generation===undefined||v.generation===null) B(w+' version shape');
        else if(v.interface===null){ if(sl!=='version') B(w+' C2: generation-only version must use slot "version"'); if(!/^gen\d(x\d)?$/.test(v.generation)) B(w+' BA1: raw generation expected'); }
        else { if(sl!=='version:'+v.interface) B(w+' version slot/interface mismatch'); if(O.canonVersion(v.interface,v.generation)!==v.generation) B(w+' non-canonical generation '+v.generation); } break;
      case 'lanes': if(!(sl==='lanes'||sl==='lanes:pcie')||!O.LANE_WIDTHS.includes(v)) B(w+' lanes shape');
        if(sl==='lanes:pcie' && !T.constraints.some(x=>x.slot==='connector:pcie' || (x.kind==='pair' && (x.interfaces||[]).includes('pcie')))) B(w+' C1: qualified lanes without PCIe in this turn'); break;
      case 'price': if(sl!=='price'||typeof v!=='number'||c.typed!==true) B(w+' price shape / C3 typed'); break;
      case 'colour': if(sl!=='colour'||typeof v!=='string') B(w+' colour shape'); break;
      case 'form': if(sl!=='form') B(w+' form slot'); break;
      case 'feature': if(!/^feature:\w+$/.test(sl)) B(w+' feature slot'); break;
      case 'standard': if(sl!=='standard:'+v) B(w+' standard slot'); break;
      case 'family': if(sl!=='family'||!isO(v)||typeof v.family!=='string') B(w+' family shape'); break;
      case 'pair': if(sl!=='pair'||!isO(v)) B(w+' pair shape'); break;
    } });
  if(!Array.isArray(T.fields)||!T.fields.every(f=>typeof f==='string'&&/^[a-z_]+$/.test(f))) B('fields');
  if(!isO(T.flags)) B('flags'); else { keys(T.flags,A5.flags,'flags'); Object.keys(T.flags).forEach(k=>{ if(T.flags[k]!==true) B('flag '+k+' not boolean true'); }); }
  if(!Array.isArray(T.relax)) B('relax'); else T.relax.forEach((r,i)=>{ if(!isO(r)) return B('relax '+i); keys(r,A5.relax,'relax'); if(typeof r.slot!=='string'||!r.slot) B('relax slot'); if('span' in r && typeof r.span!=='string') B('relax span'); if(/^ports:/.test(r.slot) && !explicitFam) B('C1: qualified ports RELAX without a family named in this turn'); });
  if('keep' in T){ if(!Array.isArray(T.keep)||!T.keep.length) B('keep must be a non-empty array when present'); else T.keep.forEach((r,i)=>{ if(!isO(r)) return B('keep '+i); keys(r,A5.keep,'keep'); if(typeof r.slot!=='string'||!/^(num:[a-zA-Z]+|ports(:[a-z_0-9]+)?|colour|price)$/.test(r.slot)) B('keep slot '+r.slot); if('span' in r && typeof r.span!=='string') B('keep span'); if(/^ports:/.test(r.slot) && !explicitFam) B('C1: qualified ports KEEP without a family named in this turn'); }); }
  if(T.ref!==null){ if(!isO(T.ref)) B('ref'); else { keys(T.ref,A5.ref,'ref'); if(!A5.refKinds.includes(T.ref.kind)) B('ref kind '+T.ref.kind); if(T.ref.kind==='ordinal'?!(Number.isInteger(T.ref.n)&&T.ref.n>=1):('n' in T.ref)) B('ref n'); } }
  if(T.metric!==null){ const m=T.metric; if(!isO(m)) B('metric'); else { keys(m,A5.metric,'metric');
    if('judgement' in m && (m.judgement!==true || 'metric' in m)) B('metric judgement shape');
    if('candidates' in m && (!Array.isArray(m.candidates)||m.candidates.length<2||'metric' in m)) B('metric candidates');
    if('dir' in m && !['asc','desc'].includes(m.dir)) B('metric dir'); if(!('metric' in m)&&!('candidates' in m)&&!m.judgement) B('metric empty'); } }
  if(T.rank!==null){ if(!isO(T.rank)) B('rank'); else { keys(T.rank,A5.rank,'rank'); if(typeof T.rank.metric!=='string'||!['asc','desc'].includes(T.rank.dir)) B('rank shape'); } }
  if(typeof T.sameBut!=='boolean') B('sameBut'); else if(T.sameBut && !(T.metric && !T.metric.judgement && (T.metric.metric || T.metric.candidates))) B('BA8: sameBut without a metric comparative');
  if(!Array.isArray(T.ledger)) B('ledger'); else T.ledger.forEach((l,i)=>{ if(!isO(l)) return B('ledger '+i); keys(l,A5.ledger,'ledger'); if(typeof l.span!=='string') B('ledger span'); if(!A5.states.includes(l.state)) B('ledger state '+l.state);
    if('nameShaped' in l && typeof l.nameShaped!=='boolean') B('ledger nameShaped'); if('impact' in l && !['high','low'].includes(l.impact)) B('ledger impact'); });
  return bad; }
/* NEGATOR INVARIANT (BA2): a constraint whose span is governed by a negator is never affirmed */
const negViol=(P,T)=>T.constraints.filter(c=>{ const sp=P.spans.find(s=>s.id===c.source.span); return sp && (sp.negGov||sp.negated||sp.polNull) && c.polarity===true; });

/* ================= A5  closed-world validator ================= */
{ const good=TF('65W charger');
  chk('A5.1 validator accepts a real turn frame ("65W charger")', !validateA5(good).length, validateA5(good));
  chk('A5.2 forbidden-key list read from the frozen discourse contract ('+FORBID.size+' keys incl. text, qty, srp, dp, stock)', FORBID.size>=20 && ['text','qty','srp','dp','stock','inventory','dealer'].every(k=>FORBID.has(k)));
  const g=()=>JSON.parse(JSON.stringify(TF('100W charger 4 ports'))), neg=[
    ['extra top-level key',x=>{ x.label='x'; }],['extra constraint key',x=>{ x.constraints[0].label='65W'; }],['extra subject key',x=>{ x.subject.kind='family'; }],
    ['forbidden key at depth',x=>{ x.subject.anchors=[{ kind:'model', codes:['A'], text:'t' }]; delete x.subject.family; }],['forbidden key qty',x=>{ x.flags.qty=true; }],
    ['invalid ref kind',x=>{ x.ref={ kind:'code', code:'A1' }; }],['ordinal without n',x=>{ x.ref={ kind:'ordinal' }; }],['n on a focus ref',x=>{ x.ref={ kind:'focus', n:1 }; }],
    ['C1 amendment: empty keep',x=>{ x.keep=[]; }],['C1 amendment: keep with text',x=>{ x.keep=[{ slot:'num:watts', text:'same wattage' }]; }],['C1 amendment: keep of an unkeepable slot',x=>{ x.keep=[{ slot:'family' }]; }],
    ['C1 amendment: flags.same not boolean true',x=>{ x.flags.same='yes'; }],['C1 amendment: unknown flag',x=>{ x.flags.sameAs=true; }],
    ['invalid polarity',x=>{ x.constraints[0].polarity='no'; }],['C1 qualified ports without a turn family',x=>{ x.subject=null; }],
    ['C2 generation-only with a qualified slot',x=>{ x.constraints.push({ kind:'version', slot:'version:pcie', value:{ interface:null, generation:'gen4' }, polarity:true, hard:true, source:{ span:'s9' } }); }],
    ['non-canonical generation',x=>{ x.constraints.push({ kind:'version', slot:'version:pcie', value:{ interface:'pcie', generation:'4.0' }, polarity:true, hard:true, source:{ span:'s9' } }); }],
    ['unknown interface',x=>{ x.constraints[0].interfaces=['sata']; }],['interfaces on an excluded constraint',x=>{ x.constraints.push({ kind:'connector', slot:'connector:hdmi', value:{ id:'hdmi' }, polarity:false, hard:true, interfaces:['hdmi'], source:{ span:'s9' } }); }],
    ['ledger state UNUSED (silent drop)',x=>{ x.ledger[0].state='UNUSED'; }],['ledger text',x=>{ x.ledger[0].text='100'; }],['flag carries text',x=>{ x.flags.followUp='same but'; }],
    ['metric judgement + metric',x=>{ x.metric={ judgement:true, metric:'price' }; }],['single-candidate metric',x=>{ x.metric={ candidates:['gbps'] }; }],
    ['sameBut without metric (BA8)',x=>{ x.sameBut=true; }],['untyped price (C3)',x=>{ x.constraints.push({ kind:'price', slot:'price', value:999, op:'<=', polarity:true, hard:false, source:{ span:'s9' } }); }],
    ['unknown intent',x=>{ x.intent='SHOP'; }],['missing ledger',x=>{ delete x.ledger; }],['lanes outside PCIe',x=>{ x.constraints.push({ kind:'lanes', slot:'lanes:pcie', value:4, polarity:true, hard:true, source:{ span:'s9' } }); }],
    ['op on a colour',x=>{ x.constraints.push({ kind:'colour', slot:'colour', value:'white', op:'=', polarity:true, hard:false, source:{ span:'s9' } }); }] ];
  const missed=neg.filter(([n,f])=>{ const x=g(); f(x); return !validateA5(x).length; }).map(([n])=>n);
  chk('A5.3 validator negative self-tests: every mutated frame is rejected ('+neg.length+' cases)', !missed.length, missed);
  const BENCH_Q=JSON.parse(fs.readFileSync(path.join(__dirname,'vero-sales-questions.json'),'utf8')).questions.map(q=>q.question), DEV_Q=[], DVS=JSON.parse(fs.readFileSync(path.join(__dirname,'vero-v2-devsets.json'),'utf8')); Object.keys(DVS.sets).forEach(k=>DVS.sets[k].items.forEach(it=>DEV_Q.push(it.q)));
  const all=BENCH_Q.concat(DEV_Q,CORPUS.map(x=>x.q)), inval=[], nv=[];
  all.forEach(q=>{ const { P, T }=PR(q); const b=validateA5(T); if(b.length) inval.push(q+' :: '+b.slice(0,2).join('; ')); if(negViol(P,T).length) nv.push(q); });
  chk('A5.4 every benchmark / HO1-3 / generated turn projects to a VALID A5 frame ('+all.length+' turns)', !inval.length, inval.slice(0,4));
  chk('A5.5 NEGATOR INVARIANT holds on all of them (no governed constraint affirmed)', !nv.length, nv.slice(0,4));
  const T1=TF('which one is Gen 4?'), T2=TF('which one is Gen 4?');
  chk('A5.6 deterministic and JSON-safe (same turn twice -> deep-equal; survives a JSON round trip)', JSON.stringify(T1)===JSON.stringify(T2) && JSON.stringify(JSON.parse(JSON.stringify(T1)))===JSON.stringify(T1)); }

/* ================= R  RELAX matrix ================= */
{ const R1=[['kahit ilang ports','ports'],['any number of ports','ports'],['ports dont matter','ports'],["ports don't matter",'ports'],['hindi na kailangan yung ports','ports'],
    ['kahit gaano kahaba','num:lengthM'],['any length','num:lengthM'],['kahit anong kulay','colour'],['any color','colour'],['kahit ilang watts','num:watts'],['kahit magkano','price']];
  const bad=R1.filter(([q,s])=>{ const T=TF(q); return !(T.relax.length===1 && T.relax[0].slot===s && !T.constraints.length && !T.fields.length && !/^(ATTRIBUTE|COUNT)$/.test(T.intent) && !validateA5(T).length); }).map(([q,s])=>q+' -> '+JSON.stringify(TF(q).relax)+' '+TF(q).intent);
  chk('R1 quantifier / "don\'t matter" / "not needed" + slot noun -> RELAX of that slot; a count cue + quantifier is RELAX, not ATTRIBUTE ('+R1.length+')', !bad.length, bad);
  const R2=[['100W charger kahit ilang ports','ports:charging_output'],['power bank any number of ports','ports:charging_output'],['hub kahit ilang ports','ports:data_port'],['card reader kahit ilang ports','ports']];
  const b2=R2.filter(([q,s])=>{ const T=TF(q); return !(T.relax.length===1 && T.relax[0].slot===s); }).map(([q])=>q+' -> '+JSON.stringify(TF(q).relax));
  chk('R2 ports RELAX is qualified ONLY from a family named in the same turn with a safe role (charger / power bank / hub); otherwise unqualified (card reader)', !b2.length, b2);
  const amb=['kahit ano','any','whatever'].map(q=>({ q, P:VP.parse(q,OPTS) })).filter(x=>{ const T=VP.turnFrame(x.P); return T.relax.length || !T.ledger.some(l=>l.state==='AMBIGUOUS' && l.impact==='high'); }).map(x=>x.q);
  chk('R3 a quantifier with no slot noun is never a RELAX: AMBIGUOUS high impact (resolver clarifies)', !amb.length, amb);
  const neg=[['any left of the NW301 splitter?','INVENTORY'],['do you have any hdmi cable','EXIST'],['meron pa bang stock kahit ano','INVENTORY']].filter(([q,i])=>{ const T=TF(q); return T.relax.length || T.intent!==i; }).map(([q])=>q+' -> '+TF(q).intent+' '+JSON.stringify(TF(q).relax));
  chk('R4 stock / existence wording with "any" stays a stock or find question, never a RELAX', !neg.length, neg);
  const T=TF('dock no need DisplayLink');
  chk('R5 "no need <feature>" relaxes that feature slot (not required), never an EXCLUDE', T.relax.some(r=>r.slot==='feature:displaylink') && !T.constraints.some(c=>c.slot==='feature:displaylink'), JSON.stringify(T)); }

/* ================= X  EXCLUDE / negation matrix ================= */
{ const pol=(q,slot)=>{ const c=TF(q).constraints.find(x=>x.slot===slot); return c?c.polarity:'(none)'; };
  const X1=[['not white','colour',false],['except white','colour',false],['charger na hindi white','colour',false],['white lang pero hindi white',null,null],
    ['yung walang built-in cable','feature:builtin',false],['charger na walang built-in cable','feature:builtin',false],['without magsafe','feature:magsafe',false],
    ['without HDMI','connector:hdmi',false],['hub na walang hdmi','connector:hdmi',false],['not a cable','form',false],['hindi charger','family',false]].filter(x=>x[1]);
  const b1=X1.filter(([q,s,p])=>pol(q,s)!==p).map(([q,s])=>q+' -> '+pol(q,s));
  chk('X1 colour / feature / connector / form / family under a clear or relativised negator -> polarity false ('+X1.length+')', !b1.length, b1);
  const T2=TF('wala bang white?'); chk('X2 existence question "wala bang white?" -> asks for white (polarity true, EXIST), never an exclusion', T2.intent==='EXIST' && pol('wala bang white?','colour')===true && !T2.constraints.some(c=>c.polarity===false), JSON.stringify(T2));
  const T3=TF('hindi ba white?'); chk('X3 yes/no question "hindi ba white?" -> attribute of the focus (colour), no colour constraint either way', T3.intent==='ATTRIBUTE' && T3.fields.includes('colour') && T3.ref && T3.ref.kind==='focus' && !T3.constraints.length, JSON.stringify(T3));
  chk('X4 bare "walang white" -> polarity null (ambiguous scope)', pol('walang white','colour')===null);
  const ep=[['not sure kung 65w','num:watts'],['hindi ko alam kung 65w','num:watts'],['not sure kung white','colour'],['hindi ko alam kung white charger','colour'],['not sure if built-in cable','feature:builtin']].filter(([q,s])=>pol(q,s)!==null);
  chk('X5 epistemic negation never EXCLUDEs (and never affirms): "not sure kung 65W" -> null; "hindi ko alam" -> nothing', !ep.length && !TF('hindi ko alam').constraints.length, ep);
  const model=models.find(m=>{ const c=PUB.find(p=>String(p.model).trim()===m); return c && FACTS.byCode[c.item_code].type.family==='video_adapter'; })||models[0];
  const dv=[`pwede ba ang ${model} sa projector na walang wifi?`,'para sa laptop na walang hdmi'].filter(q=>TF(q).constraints.some(c=>c.slot==='feature:wifi'||c.slot==='connector:hdmi'));
  chk('X6 a negation describing the USER\'S device is a device qualifier, never a product exclusion', !dv.length, dv);
  chk('X7 negated number -> polarity null ("not 65W", "hindi 65w")', pol('not 65w','num:watts')===null && pol('hindi 65w','num:watts')===null);
  chk('X8 negated price -> polarity null ("not over 1000 pesos"); the operator "hindi lalagpas 1000" stays an affirmed <= limit', pol('not over 1000 pesos','price')===null && pol('hindi lalagpas 1000','price')===true && TF('hindi lalagpas 1000').constraints[0].op==='<=');
  const st=['walang stock','no stock','out of stock','wala nang stock','wala ng stock'].filter(q=>{ const T=TF(q); return T.intent!=='INVENTORY' || T.constraints.length; });
  chk('X9 stock wording ("walang stock", "no stock", "out of stock") -> INVENTORY only, never an EXCLUDE constraint', !st.length, st);
  const allQ=X1.map(x=>x[0]).concat(['wala bang white?','hindi ba white?','walang white','not sure kung 65w','not 65w','not over 1000 pesos','walang stock']);
  const viol=allQ.filter(q=>{ const { P, T }=PR(q); return negViol(P,T).length || validateA5(T).length; });
  chk('X10 NEGATOR INVARIANT + validity over the whole EXCLUDE matrix', !viol.length, viol);
  /* executor side: an excluded value is never in the proposal; polarity null never exact */
  const ex=run('charger na hindi white');
  chk('X11 v2-1 proposal never carries an excluded value ("charger na hindi white": no white charger listed)', ex.proposal.codes.length>0 && ex.proposal.codes.every(c=>!/white/.test(G(c).color)), ex.proposal.codes.filter(c=>/white/.test(G(c).color)));
  const pn=run('walang white charger'), nn=run('not 65w charger');
  chk('X12 polarity null is never labelled exact (bare / numeric negation)', pn.proposal.kind!=='exact' && nn.proposal.kind!=='exact', [pn.proposal.kind,nn.proposal.kind]);
  const NG=[['ayaw ko white','colour'],['dont want white','colour'],['do not want white charger','colour'],['wag white','colour'],['huwag white na charger','colour'],['hindi naman white','colour'],['ayoko ng white','colour']];
  const ngb=NG.filter(([q,s])=>pol(q,s)!==false).map(([q,s])=>q+' -> '+pol(q,s));
  chk('X14 common negators ("ayaw ko", "dont want", "wag / huwag", "hindi naman", "ayoko ng") EXCLUDE the value, never affirm it ('+NG.length+')', !ngb.length, ngb);
  const rn=[['di ko need ng cable','form'],['hindi ko po kailangan ng hdmi','connector:hdmi']].filter(([q,s])=>{ const T=TF(q); return T.constraints.some(c=>c.slot===s && c.polarity===true) || !T.relax.length; }).map(([q])=>q+' -> '+JSON.stringify(TF(q).relax));
  chk('X15 "di ko need" / "hindi ko kailangan" + value -> RELAX (not required), never an affirmed constraint', !rn.length, rn);
  /* V2-2C C1 (#1, allow-listed change): a relativised "with cable" is the built-in-cable FEATURE, never the product form */
  const RV=[['power bank na ayaw ko ng may cable','feature:builtin'],['ayaw ko yung may cable','feature:builtin'],['huwag yung may cable','feature:builtin'],['hindi yung may built-in cable','feature:builtin'],['not the one with hdmi','connector:hdmi'],['dont want one with cable','feature:builtin'],['ayoko ng may white','colour']];
  const rvb=RV.filter(([q,s])=>pol(q,s)!==false || TF(q).constraints.some(c=>c.slot==='form')).map(([q,s])=>q+' -> '+pol(q,s));
  chk('X17 negator + relativiser ("ayaw ko ng MAY cable", "not THE ONE WITH hdmi") -> the relativised value is EXCLUDED; "with cable" = built-in cable, never form ('+RV.length+')', !rvb.length, rvb);
  const NN=[['dont need 65w charger','num:watts'],['no need 65w','num:watts'],['hindi kailangan ng 65w','num:watts'],['charger, no need 20000mah','num:mah'],['no need 2m','num:lengthM'],['di ko need ng 65w','num:watts'],['hindi ko kailangan ng 65w','num:watts'],['hindi na kailangan 100w','num:watts'],['no need 4 ports','ports'],['no need under 1000 pesos','price']];
  const nnb=NN.filter(([q,s])=>{ const { P, T }=PR(q); return T.constraints.some(c=>c.polarity===true && (c.slot===s || c.kind===s.split(':')[0])) || !T.relax.some(r=>r.slot===s); }).map(([q])=>{ const { P, T }=PR(q); return q+' -> relax '+JSON.stringify(T.relax)+' cons '+T.constraints.map(c=>c.slot+':'+c.polarity)+' '+P.proposal.kind; });
  chk('X19 "not needed" + number / price / port count -> RELAX of that slot (not required), never an affirmed constraint ('+NN.length+')', !nnb.length, nnb);
  const CB=[['hindi po, may white ba?','colour'],['hindi, yung may hdmi','connector:hdmi'],['no, the one with hdmi','connector:hdmi'],['wala na, yung may hdmi na lang','connector:hdmi'],['hindi po, 65w charger','num:watts']];
  const cbb=CB.filter(([q,s])=>pol(q,s)!==true).map(([q,s])=>q+' -> '+pol(q,s));
  chk('X21 negation never crosses a clause boundary: an answer-word "no," before a request leaves the request affirmed ('+CB.length+')', !cbb.length, cbb);
  const aw=TF('hindi po, may white ba?');
  chk('X21a the answer word itself is BOUND (no unresolved negator left to force a clarify on the follow-up request)', !aw.ledger.some(l=>l.state==='UNRESOLVED'), JSON.stringify(aw.ledger));
  chk('X21b a clause conjunction ("pero") also bounds scope: "hindi white pero 65w charger" -> white excluded, 65W affirmed', pol('hindi white pero 65w charger','colour')===false && pol('hindi white pero 65w charger','num:watts')===true);
  const PV=[['white not needed','colour'],['white no need','colour'],['white hindi kailangan','colour'],['65w not needed','num:watts'],['hdmi not needed','connector:hdmi'],['built-in cable not needed','feature:builtin'],['built-in cable hindi na kailangan','feature:builtin'],['65w charger, white not needed','colour']];
  const pvb=PV.filter(([q,s])=>{ const T=TF(q); return !T.relax.some(r=>r.slot===s) || T.constraints.some(c=>c.slot===s && c.polarity===true); }).map(([q])=>q+' -> '+JSON.stringify(TF(q).relax));
  chk('X22 "not needed" AFTER the value ("white not needed") relaxes that value, never affirms it ('+PV.length+')', !pvb.length, pvb);
  const rn2=run('charger 65w sige no need');   /* nothing relaxable next to the cue and no family noun adjacent: only the relaxneg guard can block exact */
  chk('X20 an unresolved "not needed" cue never yields an exact answer (coverage guard knows relaxneg)', rn2.proposal.kind!=='exact' || !rn2.ledger.unresolved.some(u=>u.kind==='relaxneg'), [rn2.proposal.kind,JSON.stringify(rn2.ledger.unresolved)]);
  const sn=VP.parse('hindi talaga sigurado white',OPTS), snT=VP.turnFrame(sn);
  chk('X18 safety net: a negator with unresolved scope never leaves a nearby value affirmed', !snT.constraints.some(c=>c.slot==='colour' && c.polarity===true), JSON.stringify(snT.constraints.map(c=>c.slot+':'+c.polarity)));
  { const P=VP.parse('65W charger',OPTS); const P2=Object.assign({},P,{ spans:P.spans.map(s=>s.type==='NUMUNIT'?Object.assign({},s,{ negGov:'sX' }):s), frame:Object.assign({},P.frame,{ constraints:P.frame.constraints.map(c=>c.kind==='num'?Object.assign({},c,{ negGov:'sX' }):c) }) });
    chk('X16 defensive guard: a constraint marked as governed by a negator is never emitted affirmed, even if scope() left it positive', VP.turnFrame(P2).constraints.find(c=>c.slot==='num:watts').polarity===null); }
  const sc=TF('not white charger with built-in cable'), sc2=TF('charger na may built-in cable pero hindi white');
  chk('X13 negation scope is exactly the governed value: "not white charger with built-in cable" excludes white, keeps built-in cable affirmed (either order)', pol('not white charger with built-in cable','colour')===false && sc.constraints.find(c=>c.slot==='feature:builtin').polarity===true && sc2.constraints.find(c=>c.slot==='feature:builtin').polarity===true && pol('charger na may built-in cable pero hindi white','colour')===false, JSON.stringify([sc.constraints,sc2.constraints].map(a=>a.map(c=>c.slot+':'+c.polarity)))); }

/* ================= O  ordinals / references ================= */
{ const O1=[['first',1],['yung una',1],['una',1],['1st',1],['the first one',1],['second',2],['pangalawa',2],['yung pangalawa',2],['2nd',2],['the second one',2],['third',3],['pangatlo',3],['3rd',3]];
  const b=O1.filter(([q,n])=>{ const r=TF(q).ref; return !(r && r.kind==='ordinal' && r.n===n); }).map(([q])=>q+' -> '+JSON.stringify(TF(q).ref));
  chk('O1 ordinals (EN / TL / numeric) -> ref {ordinal, n} 1-based ('+O1.length+')', !b.length, b);
  const R=[['that one','focus'],['magkano yun?','focus'],['this one','focus'],['alin dun yung may 3 ports?','results'],['which one is Gen 4?','results'],['those','results'],['the other one','other'],['yung isa','other']];
  const br=R.filter(([q,k])=>{ const r=TF(q).ref; return !(r && r.kind===k); }).map(([q])=>q+' -> '+JSON.stringify(TF(q).ref));
  chk('O2 structural references: focus / results (+ select cue) / other', !br.length, br);
  chk('O3 select cues carry flags.selectCue with a results ref ("alin dun", "which one", "alin dito")', ['alin dun yung may 3 ports?','which one is Gen 4?','alin dito ang 65W'].every(q=>{ const T=TF(q); return T.flags.selectCue===true && T.ref && T.ref.kind==='results'; }));
  const L=['last','yung last','the last one'].map(q=>({ q, T:TF(q) })).filter(x=>x.T.ref || !x.T.ledger.some(l=>l.state==='UNRESOLVED' && l.impact==='high' && l.nameShaped===false)).map(x=>x.q);
  chk('O4 "last" has no from-end contract yet: UNRESOLVED, high impact, never an ordinal, never a name search (BA3)', !L.length, L);
  const nonOrd=['last na','last na, may 1m na usb c to lightning ba?','one more question','last question','last week price changes'].filter(q=>{ const T=TF(q); return T.ref && T.ref.kind==='ordinal'; });
  chk('O5 "last na" / "one more question" / "last week" are never ordinals', !nonOrd.length, nonOrd);
  chk('O6 "first 3 chargers" stays a limit, not an ordinal reference', !TF('first 3 chargers').ref);
  const qs=['yung pangalawa','the other one','alin dun yung may 3 ports?','magkano yun?','which one is Gen 4?','yung una'], ctxs=[null,{ lastField:null },{ lastField:null, shown:['A','B','C'], focus:['B'], comparison:['A','B'], candidates:['A','B','C','D'] },{ lastField:null, shown:[], focus:[] }];
  const dep=qs.filter(q=>new Set(ctxs.map(c=>JSON.stringify(VP.turnFrame(VP.parse(q,Object.assign({},OPTS,{ ctx:c })))))).size!==1);
  chk('O7 turn frames are independent of any shown / focus / comparison / candidate set passed in (parser never reads results)', !dep.length, dep);
  const psrc=fs.readFileSync(path.join(ROOT,'js','vero-parse.js'),'utf8');
  chk('O8 static: vero-parse.js reads nothing from opts.ctx except lastField, and never a shown / focus / comparison list', !/opts\.ctx\.(?!lastField\b)\w+/.test(psrc) && !/\.(shown|comparison)\b/.test(psrc) && !/\bctx\.(focus|candidates)\b/.test(psrc)); }

/* ================= V  version / interface / lanes ================= */
{ const ver=(q,s)=>{ const c=TF(q).constraints.find(x=>x.slot===s); return c?c.value.generation:'(none)'; };
  const V1=[['PCIe Gen 4','version:pcie','4'],['pcie 4.0 card','version:pcie','4'],['PCI-E3.0X4','version:pcie','3'],['pci express gen 3','version:pcie','3'],
    ['usb 3.0 hub','version:usb','3.0'],['usb 3.1 gen 1 cable','version:usb','3.1g1'],['usb 3.2 gen 1 hub','version:usb','3.2g1'],['usb 3.2 gen 2','version:usb','3.2g2'],['usb 3.2 gen 2x2','version:usb','3.2g2x2'],
    ['usb-c 3.1 gen 2 cable','version:usb','3.1g2'],['usb4 cable','version:usb','4'],['thunderbolt 4 cable','version:thunderbolt','4'],['hdmi 2.1 cable','version:hdmi','2.1'],['dp 1.4 cable','version:dp','1.4']];
  const b1=V1.filter(([q,s,g])=>ver(q,s)!==g).map(([q,s])=>q+' -> '+ver(q,s));
  chk('V1 versions bind to their interface with a canonical generation ('+V1.length+': PCIe Gen N = N.0; USB 3.x Gen; USB4; Thunderbolt; HDMI; DP)', !b1.length, b1);
  chk('V2 "PCIe Gen 4" and "PCIe 4.0" are the same version concept', ver('PCIe Gen 4','version:pcie')===ver('pcie 4.0','version:pcie'));
  const lane=TF('PCI-E3.0X4');
  chk('V3 PCI-E3.0X4 -> PCIe generation 3 AND PCIe lanes 4 (two slots)', lane.constraints.some(c=>c.slot==='lanes:pcie'&&c.value===4) && ver('PCI-E3.0X4','version:pcie')==='3');
  const g4=TF('Gen 4').constraints.find(c=>c.kind==='version');
  chk('V4 bare "Gen 4" keeps raw notation and NO default interface (BA1: {interface:null, generation:"gen4"}, slot "version")', g4 && g4.slot==='version' && g4.value.interface===null && g4.value.generation==='gen4');
  const x16=TF('x16'); chk('V5 a lane-only turn "x16" is an unqualified lanes slot (C1), never a version', x16.constraints.length===1 && x16.constraints[0].slot==='lanes' && x16.constraints[0].value===16);
  const nonLane=['2x hdmi','3x1 hdmi switch','2x4 cable','hdmi x4','4 port hub x4'].filter(q=>TF(q).constraints.some(c=>c.kind==='lanes'));
  chk('V6 NxM switcher notation, connector counts and lane words outside PCIe scope are never lane widths (BA7)', !nonLane.length, nonLane);
  const pX4=TF('pcie x4'), pG4=TF('pcie gen 4'), both=TF('pcie x16 gen 4');
  chk('V7 lane values never become a generation and generations never become lanes ("pcie x4" no version; "pcie gen 4" no lanes; "pcie x16 gen 4" -> gen 4 + x16)', !pX4.constraints.some(c=>c.kind==='version') && !pG4.constraints.some(c=>c.kind==='lanes') && ver('pcie x16 gen 4','version:pcie')==='4' && both.constraints.some(c=>c.slot==='lanes:pcie'&&c.value===16));
  chk('V8 invalid USB 2.1 / 2.4 are rejected (no version constraint; the number stays UNRESOLVED)', ['usb 2.1','usb 2.4'].every(q=>{ const P=VP.parse(q,OPTS), T=VP.turnFrame(P); return !T.constraints.some(c=>c.kind==='version') && T.ledger.some(l=>l.state==='UNRESOLVED'); }) && O.canonVersion('usb','2.1')===null && O.canonVersion('usb','2.4')===null);
  const imp=[['hdmi gen 2','UNRESOLVED'],['pcie gen 9','UNRESOLVED'],['gen 9','UNRESOLVED'],['usb-c to hdmi gen 2','AMBIGUOUS']].filter(([q,st])=>{ const T=TF(q); return T.constraints.some(c=>c.kind==='version') || !T.ledger.some(l=>l.state===st); });
  chk('V9 impossible interface / generation combinations are UNRESOLVED; a generation with two interfaces in the turn is AMBIGUOUS', !imp.length, imp);
  const CV=[['pcie','gen4','4'],['pcie','4.0','4'],['pcie','4','4'],['pcie','gen7',null],['usb','3.2gen2','3.2g2'],['usb','3.0g1',null],['usb','3.1g2x2',null],['usb','gen2','g2'],['usb','4','4'],['usb','2.0','2.0'],['thunderbolt','gen4',null],['thunderbolt','4','4'],['hdmi','2.1','2.1'],['hdmi','gen2',null],['dp','1.4','1.4']];
  const cvb=CV.filter(([i,r,w])=>O.canonVersion(i,r)!==w || (w!==null && O.canonVersion(i,O.canonVersion(i,r))!==w)).map(x=>x.join(':'));
  chk('V10 canonVersion table + idempotence ('+CV.length+')', !cvb.length, cvb);
  chk('V11 USB naming equivalence is MODELLED only: "usb 3.0" stays 3.0 (not merged into 3.2g1); table groups 3.0 / 3.1g1 / 3.2g1', ver('usb 3.0 hub','version:usb')==='3.0' && O.USB_NAMING.some(r=>['3.0','3.1g1','3.2g1'].every(n=>r.names.includes(n))));
  const H=TF('hdmi 2.1 cable'); const h8=TF('8k hdmi cable');
  chk('V12 HDMI 2.1 = connector:hdmi + version:hdmi (BA6; no competing standard: form); "8K" never implies HDMI 2.1', H.constraints.some(c=>c.slot==='connector:hdmi') && H.constraints.some(c=>c.slot==='version:hdmi') && !H.constraints.some(c=>c.kind==='standard') && !h8.constraints.some(c=>c.kind==='version'));
  const tb=TF('thunderbolt 4'), u4=TF('usb4');
  chk('V13 Thunderbolt 4 and USB4 are distinct interfaces', tb.constraints.some(c=>c.slot==='version:thunderbolt') && !tb.constraints.some(c=>c.slot==='version:usb') && u4.constraints.some(c=>c.slot==='version:usb'));
  const lanesOf=['70503','70504','30715'].map(c=>G(c)&&G(c).lanes), px16=run('pcie x16');
  chk('V15 graph reads PCIe lane widths from product names (70503 / 70504 x4, 30715 x16 — catalogue expectations) and "pcie x16" CONTRADICTS the x4 cards', JSON.stringify(lanesOf)==='[4,4,16]' && ['70503','70504'].every(c=>VP.evalConstraint(c,{ kind:'lanes', n:16 },OPTS)==='CONTRADICTED') && VP.evalConstraint('30715',{ kind:'lanes', n:16 },OPTS)==='CONFIRMED' && !px16.proposal.codes.some(c=>c==='70503'||c==='70504'), JSON.stringify([lanesOf,px16.proposal.kind,px16.proposal.codes]));
  const pc=VP.parse('nvme to pcie adapter',OPTS);
  chk('V14 PCIe is an interface, never a NAME (BA4): connector:pcie with interfaces [pcie]', !pc.spans.some(s=>s.type==='NAME' && /pcie/.test(s.text)) && VP.turnFrame(pc).constraints.some(c=>c.slot==='connector:pcie' && (c.interfaces||[]).join()==='pcie')); }

/* ================= K  comparatives ================= */
{ const m=q=>TF(q).metric;
  chk('K1 cheaper / mas mura -> metric price asc', ['cheaper','mas mura','meron bang mas mura?'].every(q=>{ const x=m(q); return x && x.metric==='price' && x.dir==='asc'; }));
  chk('K2 faster -> ambiguous speed: candidates [gbps, watts]; "faster charging" -> watts', JSON.stringify(m('faster').candidates)==='["gbps","watts"]' && m('faster charging').metric==='watts');
  const sb=TF('same but cheaper'), sw=TF('same but white');
  chk('K3 "same but cheaper" -> sameBut + metric price asc (ALTERNATIVE)', sb.sameBut===true && sb.metric.metric==='price' && sb.intent==='ALTERNATIVE');
  chk('K4 "same but white" -> ordinary elliptical colour constraint (no sameBut, BA8)', sw.sameBut===false && sw.constraints.some(c=>c.slot==='colour' && c.polarity===true) && sw.flags.elliptical===true);
  chk('K5 "mas okay" / "better" -> judgement only, never a metric', ['mas okay','better','yung mas okay','alin mas ok'].every(q=>{ const x=m(q); return x && x.judgement===true && !('metric' in x) && !('candidates' in x); }));
  const r=TF('pinakamurang power bank'); chk('K6 superlative -> rank {price, asc}, no comparative metric', r.rank && r.rank.metric==='price' && r.rank.dir==='asc' && r.metric===null);
  chk('K7 "alin mas mura?" price asc; "alin mas maraming ports?" / "more ports" ports desc (field consumed); "fewer ports" asc', m('alin mas mura?').dir==='asc' && m('alin mas maraming ports?').metric==='ports' && m('more ports').metric==='ports' && !TF('more ports').fields.includes('ports') && m('fewer ports').dir==='asc');
  chk('K8 "same but faster" -> sameBut with ambiguous candidates (resolver clarifies the metric)', TF('same but faster').sameBut===true && TF('same but faster').metric.candidates.length===2);
  const sw2=TF('same wattage pero mas mura sa 95405B');
  chk('K9 V2-2C C1 closes the recorded gap: "same wattage" carries the A5 amendment keep [num:watts] (no sameBut, no constraint), price comparative unchanged', sw2.sameBut===false && JSON.stringify(sw2.keep)==='[{"slot":"num:watts","span":"s0"}]' && !sw2.constraints.some(c=>/^keep/.test(c.slot)) && sw2.metric && sw2.metric.metric==='price', JSON.stringify([sw2.keep,sw2.metric])); }

/* ================= NG  NAME / function-word guard ================= */
{ const GC=O.NAME_GUARD_CLASSES, need=['stock','reference','discourse','function','quantifier','negator','ordinal','interface','lane'], guard=VP._nameGuard();
  chk('NG1 the guard declares every required class: '+need.join(', '), need.every(k=>Array.isArray(GC[k]) && GC[k].length>0) && Object.keys(GC).sort().join()===need.slice().sort().join());
  const miss=need.map(k=>[k,GC[k].filter(w=>!VP.tokenize(w).map(t=>t.t).every(t=>guard[t]))]).filter(x=>x[1].length);
  chk('NG2 every word of every class is in the parser\'s name guard (structural; removing a class fails this)', !miss.length, miss.map(x=>x[0]+':'+x[1].slice(0,3)));
  const C0=VP.catalog(FACTS,PUB), leakP=Object.keys(C0.phrases).filter(k=>k.split(' ').some(t=>guard[t]));
  chk('NG3 no catalogue NAME phrase contains a guarded word ('+Object.keys(C0.phrases).length+' phrases)', !leakP.length, leakP.slice(0,5));
  const fake={ sheet:'Computer', category:'Hub', model:'ZQ1', item_code:'98989T', product_name:'Kahit Pangalawa Except Huli PCIe X16 Gen Stocks Yun Pareho Hub', color:'Black', length:'', srp:'999', dp:'800', dp_volume:'', moq:'1', features:'', description:'', short_desc:'', sheet_display:'Computer: Hub' };
  const P2=PUB.concat([fake]), F2=VF.build(P2,{ force:true }), O2={ facts:F2, products:P2 }, C2=VP.catalog(F2,P2);
  const words=['kahit','pangalawa','except','huli','pcie','x16','gen','stocks','yun','pareho'], fl=words.filter(w=>C2.phrases[w] || Object.keys(C2.phrases).some(k=>k.split(' ').includes(w)));
  const qn=['kahit pangalawa','except huli x16','gen stocks yun','pareho pcie'].filter(q=>VP.parse(q,O2).spans.some(s=>s.type==='NAME'));
  chk('NG4 behavioural fixture: a product NAMED with guarded words never makes them NAME phrases or NAME spans', !fl.length && !qn.length, [fl,qn]);
  VF.build(PUB,{ force:true }); VP.catalog(VF.build(PUB),PUB);
  const single=[].concat.apply([],need.map(k=>GC[k])).filter(w=>/^[a-z0-9]+$/.test(w)&&w.length>1), nameHit=single.filter(w=>VP.parse(w+' charger',OPTS).spans.some(s=>s.type==='NAME' && s.text.split(' ').includes(w)));
  chk('NG5 no guarded word ('+single.length+' single-token words) parses as a NAME span next to a product noun', !nameHit.length, nameHit.slice(0,8));
  const dpq=[['ano dp ng '+models[0],'fields','dp'],['dp ng '+models[1]+' po','fields','dp'],['dp cable','connector','dp'],['dp 1.4 cable','version','dp'],['hdmi to dp adapter','pair','dp']].filter(([q,k,v])=>{ const P=VP.parse(q,OPTS), T=VP.turnFrame(P);
    if(P.spans.some(s=>s.type==='NAME' && /\bdp\b/.test(s.text))) return true;
    if(k==='fields') return !T.fields.includes('dp'); if(k==='connector') return !T.constraints.some(c=>c.slot==='connector:dp'); if(k==='version') return !T.constraints.some(c=>c.slot==='version:dp'); return !T.constraints.some(c=>c.kind==='pair' && (c.value.from==='dp'||c.value.to.includes('dp'))); });
  chk('NG6 "dp": dealer-price terminology vs DisplayPort is a sense decision, never a NAME span (5 contexts)', !dpq.length, dpq); }

/* ================= H  end-to-end shadow chains: parser -> turnFrame -> VeroDiscourse.resolve -> buildContext ================= */
{ const T0=1e12, FAMS=['charger','power_bank','hub_dock','video_cable','serial_card'];
  const APP={ charger:/^(num:watts|ports:charging_output|feature:\w+|colour|price|form|connector:(usb_c|usb_a|usb)|version:usb)$/, power_bank:/^(num:watts|num:mah|ports:charging_output|feature:\w+|colour|price|connector:(usb_c|usb_a|usb))$/,
    hub_dock:/^(ports:data_port|connector:\w+|version:\w+|feature:\w+|colour|price)$/, video_cable:/^(connector:(hdmi|dp)|version:(hdmi|dp)|num:lengthM|res|colour|price|form)$/, serial_card:/^(connector:pcie|version:pcie|lanes:pcie|feature:nvme|form|price)$/ };
  const OP={ now:T0, mode:'public', families:FAMS, applies:(slot,f)=>!!(APP[f] && APP[f].test(slot)), qualify:(k,f)=>({ 'ports|charger':'charging_output', 'ports|power_bank':'charging_output', 'ports|hub_dock':'data_port', 'lanes|serial_card':'pcie' })[k+'|'+f]||null };
  const famCodesOf=f=>PUB.map(p=>String(p.item_code)).filter(c=>G(c) && G(c).family===f);
  const chain=(qs,execs)=>{ let c=null; const out=[]; qs.forEach((q,i)=>{ const T=TF(q), v=validateA5(T); const r=D.resolve(T,c,OP); out.push({ q, T, r, valid:!v.length }); c=D.buildContext(c,r,execs&&execs[i]||{},OP); out[out.length-1].ctx=c; }); return out; };
  const shownFor=(T)=>{ const f=T.subject&&T.subject.family; return f?famCodesOf(f).slice(0,6):[]; };
  const run2=(q1,q2)=>{ const t1=TF(q1); return chain([q1,q2],[{ shown:shownFor(t1), candidates:shownFor(t1) }]); };
  const vals=r=>r.mergedFrame?Object.fromEntries(r.mergedFrame.constraints.map(c=>[c.slot,c.value])):{};
  let x=run2('65W charger','yung may 3 ports lang');
  chk('H.B "65W charger" -> "yung may 3 ports lang": REFINE, ports bound to charging_output, 65W kept (unqualified ports emitted, C1)', x[1].r.act==='REFINE' && vals(x[1].r)['ports:charging_output']===3 && vals(x[1].r)['num:watts']===65 && x[1].T.constraints.some(c=>c.slot==='ports'), JSON.stringify(x[1].r.delta));
  x=run2('power bank 10000mah','yung may built-in cable');
  chk('H.D "power bank 10000mah" -> "yung may built-in cable": REFINE ADD feature, mAh kept', x[1].r.act==='REFINE' && vals(x[1].r)['num:mah']===10000 && vals(x[1].r)['feature:builtin']===true && x[1].r.mergedFrame.subject.family==='power_bank', JSON.stringify(x[1].r.delta));
  const t1=TF('nvme to pcie adapter'), fam=t1.subject&&t1.subject.family, famC=fam?famCodesOf(fam):[];
  chk('H.F1 turn 1 "nvme to pcie adapter": parser subject keeps ALL PCIe cards represented (family covers 70503, 70504, 30715 — expectation from current catalogue, not parser logic)', ['70503','70504','30715'].every(c=>famC.includes(c)) && t1.subject.interface==='pcie' && !t1.subject.anchors, JSON.stringify(t1.subject));
  const pcieShown=famC.filter(c=>G(c).conns.all.includes('pcie'));
  const xf=chain(['nvme to pcie adapter','which one is Gen 4?'],[{ shown:pcieShown, candidates:pcieShown }]);
  const vb=vals(xf[1].r)['version:pcie'];
  chk('H.F2 "which one is Gen 4?" -> SELECT over the shown PCIe cards; generation bound to the context interface (C2) and canonicalised after binding (BA1)', xf[1].r.act==='SELECT' && vb && vb.interface==='pcie' && O.canonVersion('pcie',vb.generation)==='4' && JSON.stringify(xf[1].r.delta.target.codes.slice().sort())===JSON.stringify(pcieShown.slice().sort()), JSON.stringify(xf[1].r.delta));
  chk('H.F3 the bound version selects only the Gen 4 card among the shown (graph versions; 70503/70504 are PCIe 3)', JSON.stringify(pcieShown.filter(c=>G(c).versions.pcie===O.canonVersion('pcie',vb&&vb.generation)))==='["30715"]', pcieShown.map(c=>c+':'+G(c).versions.pcie));
  x=run2('100W charger 4 ports','kahit ilang ports');
  chk('H.H2 "100W charger 4 ports" -> "kahit ilang ports": RELAX removes ports, keeps 100W (no false "wala")', x[1].r.act==='RELAX' && x[1].r.delta.ops.some(o=>o.op==='REMOVE' && o.slot==='ports:charging_output') && vals(x[1].r)['num:watts']===100, JSON.stringify(x[1].r.delta));
  x=run2('65W charger 3 ports','any number of ports');
  chk('H.H3 "65W charger 3 ports" -> "any number of ports": RELAX', x[1].r.act==='RELAX' && vals(x[1].r)['ports:charging_output']===undefined && vals(x[1].r)['num:watts']===65);
  const s1=run2('65W charger','in stock ba?'), s2=run2('65W charger','stock?'), s3=run2('65W charger','may stock pa ba yung may 3 ports?');
  chk('H.S1-S3 stock follow-ups -> STOCK_OF_CONTEXT (S3 also ADDs ports=3); "in" is never a name; no stock state stored', [s1,s2,s3].every(z=>z[1].r.act==='STOCK_OF_CONTEXT' && z[1].r.delta.stock===true && !/stock/i.test(Object.keys(z[1].ctx).join())) && vals(s3[1].r)['ports:charging_output']===3 && !VP.parse('in stock ba?',OPTS).spans.some(s=>s.type==='NAME'), [s1,s2,s3].map(z=>z[1].r.act));
  x=run2('65W charger','yung mas okay');
  chk('H.R8 "65W charger" -> "yung mas okay": CLARIFY inside the context (judgement needs a metric), context frame kept', x[1].r.act==='CLARIFY' && x[1].r.delta.clarify.reason==='judgement-needs-metric' && x[1].r.mergedFrame.subject.family==='charger');
  const pb=chain(['power bank 10000mah','yung may built-in cable','hdmi2.1'],[{ shown:famCodesOf('power_bank').slice(0,5) },{ shown:famCodesOf('power_bank').slice(0,3) }]);
  chk('H.PB "power bank 10000mah" -> "yung may built-in cable" -> "hdmi2.1": a standalone HDMI 2.1 query SWITCHes (no "no HDMI 2.1 power bank")', pb[2].r.act==='SWITCH' && !pb[2].r.mergedFrame.constraints.some(c=>c.slot==='num:mah') && pb[2].r.mergedFrame.constraints.some(c=>c.slot==='version:hdmi') && !(pb[2].r.mergedFrame.subject && pb[2].r.mergedFrame.subject.family==='power_bank'), JSON.stringify(pb[2].r.delta));
  const ex=run2('65W charger','not white'), last=run2('65W charger','last'), o2=run2('65W charger','yung pangalawa');
  chk('H.X "not white" -> EXCLUDE inside the context; "last" -> CLARIFY (unresolved high impact); "yung pangalawa" -> SELECT shown[1]', ex[1].r.act==='EXCLUDE' && last[1].r.act==='CLARIFY' && o2[1].r.act==='SELECT' && o2[1].r.delta.target.codes[0]===o2[0].ctx.shown[1]);
  const allC=[x,s1,s2,s3,pb,ex,last,o2,xf]; chk('H.V every turn of every chain is a valid A5 frame and VeroDiscourse never throws', allC.every(z=>z.every(y=>y.valid && y.r && y.r.act!==undefined))); }

/* =====================================================================================================================
   V2-2C C1 — parser follow-ups (design §13 #1/2/3/5/6/15), additive A5 amendment (flags.same, keep), ontology concepts,
   frame executor (executeFrame) with the §7 evidence model, USB / interface relations, price-cache fixture, mutation kills.
   Current turn only: nothing here reads a result set. C2 (context layer) and C3 (chained scoring) are NOT part of this block.
   ===================================================================================================================== */
{ const pol=(q,s)=>{ const c=TF(q).constraints.find(x=>x.slot===s); return c?c.polarity:'(none)'; };
  /* ---- parser follow-ups ---- */
  const P1=['not the one with cable','yung walang cable','ayaw ko yung may cable','dont want one with cable'].filter(q=>{ const T=TF(q); return pol(q,'feature:builtin')!==false || T.constraints.some(c=>c.slot==='form') || !(T.flags.elliptical||T.flags.needsContext); });
  chk('C1.P1 (#1) "not the one with cable" / "yung walang cable" -> elliptical EXCLUDE of feature:builtin, never form:cable', !P1.length, P1.map(q=>q+' -> '+JSON.stringify(TF(q).constraints.map(c=>c.slot+':'+c.polarity))+' '+JSON.stringify(TF(q).flags)));
  chk('C1.P1b control: "not a cable" (no relativiser) keeps the FORM exclusion; "charger na walang built-in cable" unchanged', pol('not a cable','form')===false && pol('charger na walang built-in cable','feature:builtin')===false);
  const P2=[['white, not needed','colour'],['65w, not needed','num:watts'],['hdmi, hindi kailangan','connector:hdmi'],['white, no need','colour']].filter(([q,s])=>{ const T=TF(q); return !T.relax.some(r=>r.slot===s) || T.constraints.some(c=>c.slot===s && c.polarity===true); });
  chk('C1.P2 (#2) a trailing "not needed" across a comma relaxes the preceding value, never affirms it', !P2.length, P2.map(([q])=>q+' -> '+JSON.stringify(TF(q).relax)+' '+JSON.stringify(TF(q).constraints.map(c=>c.slot+':'+c.polarity))));
  const p2b=TF('white, not needed ang cable');
  chk('C1.P2b the comma reach-back applies only when nothing relaxable follows: "white, not needed ang cable" relaxes the cable form, white stays affirmed', p2b.relax.map(r=>r.slot).join()==='form' && p2b.constraints.some(c=>c.slot==='colour' && c.polarity===true), JSON.stringify([p2b.relax,p2b.constraints.map(c=>c.slot+':'+c.polarity)]));
  const P3=[['white pero no need white','colour'],['65w pero kahit ilang watts','num:watts'],['65w charger, kahit ilang watts','num:watts']].filter(([q,s])=>{ const { P, T }=PR(q); return T.constraints.some(c=>c.slot===s) || T.relax.some(r=>r.slot===s) || T.ledger.filter(l=>l.state==='AMBIGUOUS' && l.impact==='high').length<2 || P.proposal.kind==='exact'; });
  chk('C1.P3 (#3) one turn that requires AND relaxes a slot keeps neither: two AMBIGUOUS (high) spans, no constraint, no relax, never exact', !P3.length, P3.map(([q])=>q+' -> '+JSON.stringify(TF(q))));
  const h1=TF('not hdmi 2.1'), h2=TF('hdmi cable not hdmi 2.1'), hv=T=>T.constraints.find(c=>c.slot==='version:hdmi');
  chk('C1.P5 (#5) "not HDMI 2.1" -> EXCLUDE version:hdmi 2.1 with connector:hdmi affirmed; the connector is never excluded', [h1,h2].every(T=>hv(T) && hv(T).polarity===false && hv(T).value.generation==='2.1' && T.constraints.some(c=>c.slot==='connector:hdmi' && c.polarity===true) && !T.constraints.some(c=>c.slot==='connector:hdmi' && c.polarity===false)) && h1.flags.elliptical===true, JSON.stringify([h1.constraints,h2.constraints]));
  const hx=run('hdmi cable not hdmi 2.1');
  chk('C1.P5b executor: no proposed product states HDMI 2.1; products that do not state a version are kept and labelled "not stated"', hx.proposal.codes.length>0 && hx.proposal.codes.every(c=>G(c).versions.hdmi!=='2.1') && (hx.proposal.notStated||[]).length===1, JSON.stringify([hx.proposal.kind,hx.proposal.codes.length,hx.proposal.notStated]));
  const b0=VP.parse('built-in',OPTS), b1=TF('built-in'), bm=TF('built-in mic');
  chk('C1.P6 (#6) "built-in" alone = feature:builtin (BOUND, never a NAME / UNKNOWN span); "built-in mic" = mic; retractable stays its own feature', b1.constraints.length===1 && b1.constraints[0].slot==='feature:builtin' && b1.constraints[0].polarity===true && !b0.spans.some(s=>s.type==='NAME'||s.type==='UNKNOWN') && bm.constraints.map(c=>c.slot).join()==='feature:mic' && TF('retractable').constraints.map(c=>c.slot).join()==='feature:retractable', JSON.stringify([b1.constraints,bm.constraints]));
  const retr=PUB.map(p=>String(p.item_code)).filter(c=>G(c) && G(c).feats.retractable && G(c).feats.retractable.state==='CONFIRMED' && !G(c).feats.builtin);
  chk('C1.P6b retractable => built-in is INFERRED (never CONFIRMED), and only in that direction ('+retr.length+' retractable products without a stated built-in cable)', retr.length>0 && retr.every(c=>VP.evalConstraint(c,{ kind:'feature', id:'builtin' },OPTS)==='INFERRED') && retr.every(c=>VP.evalConstraint(c,{ kind:'feature', id:'builtin', neg:true },OPTS)==='CONTRADICTED') && VP.evalConstraint(PUB.map(p=>String(p.item_code)).find(c=>G(c)&&G(c).feats.builtin&&G(c).feats.builtin.state==='CONFIRMED'&&!G(c).feats.retractable),{ kind:'feature', id:'retractable' },OPTS)==='UNKNOWN', retr);
  const cd=TF('card'), C0=VP.catalog(FACTS,PUB), one=Object.keys(C0.phrases).find(k=>!k.includes(' ') && C0.phrases[k].length>=2 && new Set(C0.phrases[k].map(c=>G(c).family)).size===1 && TF(k).subject);
  chk('C1.P15 (#15) a generic name word over several families ("card") is a name: constraint, never the subject; a single-family name ("'+one+'") stays the subject', cd.subject===null && cd.constraints.some(c=>c.slot==='name:card') && new Set(cd.constraints.find(c=>c.slot==='name:card').value.codes.map(c=>G(c).family)).size>1 && TF(one).subject && TF(one).subject.anchors, JSON.stringify(cd));
  chk('C1.P4 (#4, NOT a bug, pinned) "hindi po, 65w charger" is a genuine new 65W request: watts 65 affirmed (never null), charger subject', pol('hindi po, 65w charger','num:watts')===true && TF('hindi po, 65w charger').subject.family==='charger');
  /* ---- additive A5 amendment ---- */
  const same=['same but white','pareho pero white','same pero black'].filter(q=>{ const T=TF(q); return T.flags.same!==true || T.sameBut!==false || validateA5(T).length; });
  chk('C1.A1 flags.same: a same-but cue with no metric comparative ("same but white") -> flags.same, no sameBut', !same.length, same);
  chk('C1.A2 a metric comparative keeps the V2-2B sameBut and never sets flags.same ("same but cheaper")', TF('same but cheaper').sameBut===true && !TF('same but cheaper').flags.same && !TF('65W charger').flags.same);
  const KP=[['same wattage','num:watts'],['parehong capacity','num:mah'],['same color','colour'],['same length','num:lengthM'],['same ports','ports'],['charger same ports','ports:charging_output'],['kaparehong kulay','colour']];
  const kb=KP.filter(([q,s])=>{ const T=TF(q); return !(T.keep && T.keep.length===1 && T.keep[0].slot===s) || validateA5(T).length || T.constraints.some(c=>c.slot===s); }).map(([q])=>q+' -> '+JSON.stringify(TF(q).keep));
  chk('C1.A3 keep: "same <attribute>" -> keep [{slot}] only (no constraint); ports unqualified unless this turn names a family (C1) ('+KP.length+')', !kb.length, kb);
  chk('C1.A4 no keep without a same-word + attribute ("65W charger", "same but white", "same", "white wattage")', ['65W charger','same but white','same','white wattage'].every(q=>!('keep' in TF(q))));
  const kctx=['same wattage','same but white','not the one with cable'].filter(q=>new Set([null,{ lastField:'watts', shown:['A'], focus:['A'] }].map(c=>JSON.stringify(VP.turnFrame(VP.parse(q,Object.assign({},OPTS,{ ctx:c })))))).size!==1);
  chk('C1.A5 keep / flags.same are structural: identical for any context passed in (the parser never resolves them)', !kctx.length, kctx);
  const strip=T=>{ const x=JSON.parse(JSON.stringify(T)); delete x.keep; delete x.flags.same; return x; };
  const dIgn=['same wattage','same but white'].filter(q=>{ const T=TF(q), OPd={ now:1e12, mode:'public' }; return JSON.stringify(D.resolve(T,null,OPd))!==JSON.stringify(D.resolve(strip(T),null,OPd)); });
  chk('C1.A6 VeroDiscourse (byte-identical) ignores keep and flags.same: resolve() with and without them is identical', !dIgn.length, dIgn);
  /* ---- ontology concepts ---- */
  const tb=TF('tb4'), tb2=TF('thunderbolt4 cable'), dpa=TF('usb-c hub with dp alt mode'), h22=TF('hdmi 2.2 cable');
  chk('C1.O1 TB4 aliases ("tb4", "thunderbolt4") -> version:thunderbolt 4, never USB4; DP Alt Mode is a feature concept; HDMI 2.2 is a version token', [tb,tb2].every(T=>T.constraints.some(c=>c.slot==='version:thunderbolt' && c.value.generation==='4') && !T.constraints.some(c=>c.slot==='version:usb')) && dpa.constraints.some(c=>c.slot==='feature:dp_alt') && h22.constraints.some(c=>c.slot==='version:hdmi' && c.value.generation==='2.2') && O.canonVersion('hdmi','2.2')==='2.2', JSON.stringify([tb.constraints,dpa.constraints,h22.constraints]));
  const ug=['usb gen 4','usb-c gen 4 cable','usb 3.2 gen 4'].filter(q=>{ const T=TF(q); return T.constraints.some(c=>c.kind==='version' && c.value.generation==='4') || !T.ledger.some(l=>l.state==='UNRESOLVED'); });
  chk('C1.O2 USB "Gen 4" never becomes USB4 (no version constraint; the notation stays UNRESOLVED)', !ug.length, ug);
  chk('C1.O3 PCIe lane width is never a generation; 8K never implies HDMI 2.1; HDMI = connector:hdmi + version:hdmi', !TF('pcie x16').constraints.some(c=>c.kind==='version') && !TF('8k hdmi cable').constraints.some(c=>c.kind==='version') && TF('hdmi 2.1').constraints.map(c=>c.slot).sort().join()==='connector:hdmi,version:hdmi');
  chk('C1.O4 PORT_ROLE_BY_FAMILY is exported once and frozen (single source for C2 qualify)', VP.PORT_ROLE_BY_FAMILY && Object.isFrozen(VP.PORT_ROLE_BY_FAMILY) && VP.PORT_ROLE_BY_FAMILY.charger==='charging_output' && TF('charger 3 ports').constraints.some(c=>c.slot==='ports:charging_output'));
  /* ---- executor + evidence model ---- */
  const A=(kind,slot,value,polarity,x)=>Object.assign({ kind, slot, value, polarity, hard:true, source:{ span:'s0' } },x||{});
  const xpb=VP.executeFrame({ subject:{ family:'power_bank' }, constraints:[A('connector','connector:usb_a',{ id:'usb_a' },false)] },OPTS);
  const pbAll=famCodes('power_bank'), hasA=c=>G(c).conns.all.includes('usb_a')||G(c).conns.feat.includes('usb_a');
  chk('C1.E1 EXCLUDE needs governed evidence: "power bank without USB-A" removes every listing that names or lists USB-A ('+pbAll.filter(hasA).length+'), keeps the rest UNKNOWN + "not stated", never "exact without"', xpb.codes.length===pbAll.filter(c=>!hasA(c)).length && xpb.codes.every(c=>!hasA(c) && xpb.evidence[c]['connector:usb_a']==='UNKNOWN') && (xpb.notStated||[]).length===1, JSON.stringify([xpb.kind,xpb.codes.length,xpb.notStated]));
  const pairs=[]; PUB.slice(0,400).forEach(p=>{ const c=String(p.item_code), g=G(c); if(!g) return; ['vga','rj45','hdmi','dp','sd'].forEach(k=>{ if(!g.conns.all.includes(k) && !g.conns.feat.includes(k) && !g.pair) pairs.push([c,k]); }); });
  const absBad=pairs.filter(([c,k])=>VP.evalConstraint(c,{ kind:'connector', id:k },OPTS)!=='UNKNOWN');
  const formBad=PUB.slice(0,300).map(p=>String(p.item_code)).filter(c=>G(c) && !/\bcables?\b|\bcord\b/.test(G(c).lname) && !/\bcable\b/i.test(G(c).category)).filter(c=>VP.evalConstraint(c,{ kind:'form', form:'cable' },OPTS)!=='CONTRADICTED');
  chk('C1.E2 absence is never CONTRADICTED ('+pairs.length+' product x unnamed-connector pairs -> UNKNOWN) except name-defined slots (form absent -> CONTRADICTED)', pairs.length>200 && !absBad.length && !formBad.length, JSON.stringify([absBad.slice(0,4),formBad.slice(0,4)]));
  const u1=run('usb 3.2 gen 1 hub'), inf=u1.proposal.inferred||[];
  chk('C1.E3 USB naming equivalence: "USB 3.2 Gen 1 hub" lists USB 3.0 hubs as INFERRED (labelled), never exact', u1.proposal.kind==='inferred' && inf.length>0 && inf.every(c=>['3.0','3.1g1'].includes(O.canonVersion('usb',G(c).versions.usb||G(c).versions.usb_a||G(c).versions.usb_c))) && /Inferred, not stated/.test(u1.proposal.notes.join(' ')), JSON.stringify([u1.proposal.kind,inf.length,u1.proposal.notes]));
  const xf=VP.executeFrame({ subject:{ family:'hub_dock' }, constraints:[A('version','version:usb',{ interface:'usb', generation:'3.2g1' },true)] },OPTS);
  chk('C1.E3b executeFrame: version:usb evaluated against graph versions; INFERRED evidence recorded per product; a set with an inferred row is never "exact"', xf.kind==='inferred' && (xf.inferred||[]).every(c=>xf.evidence[c]['version:usb']==='INFERRED'), JSON.stringify([xf.kind,(xf.inferred||[]).length]));
  const usbV=O.INTERFACES.usb.connectors, tbV=O.INTERFACES.thunderbolt.connectors, v4=PUB.map(p=>String(p.item_code)).filter(c=>G(c) && G(c).versions.usb4!=null);
  chk('C1.E4 USB4 and Thunderbolt 4 never imply each other (interfaces disjoint; no product evaluates TB4 from a USB4 version or vice versa)', !usbV.some(k=>tbV.includes(k)) && PUB.slice(0,811).every(p=>{ const c=String(p.item_code); if(!G(c)) return true; const t=VP.evalConstraint(c,{ kind:'ifaceVersion', iface:'thunderbolt', gen:'4' },OPTS), u=VP.evalConstraint(c,{ kind:'ifaceVersion', iface:'usb', gen:'4' },OPTS); return !(t==='CONFIRMED' && !G(c).versions.thunderbolt) && !(u==='CONFIRMED' && G(c).versions.thunderbolt && !G(c).versions.usb4); }), v4.length);
  const tbFeat=PUB.map(p=>String(p.item_code)).filter(c=>G(c) && /thunderbolt/i.test(byCode[c].features||'') && !/thunderbolt/i.test(G(c).lname));
  chk('C1.E5 MENTIONED stays UNKNOWN: products that mention Thunderbolt only in their features ('+tbFeat.length+') are never CONFIRMED Thunderbolt', tbFeat.length>0 && tbFeat.every(c=>VP.evalConstraint(c,{ kind:'connector', id:'thunderbolt' },OPTS)!=='CONFIRMED' && VP.evalConstraint(c,{ kind:'ifaceVersion', iface:'thunderbolt', gen:'4' },OPTS)!=='CONFIRMED'), tbFeat.slice(0,5));
  const vs=VP.executeFrame({ subject:{ family:'hub_dock' }, constraints:[A('version','version:usb',{ interface:'usb', generation:'3.2g2' },true)] },OPTS);
  const vs2=VP.executeFrame({ subject:{ family:'hub_dock' }, constraints:[A('version','version:usb',{ interface:'usb', generation:'3.2g2x2' },true)] },OPTS);
  chk('C1.E6 a version request lists only items that STATE it as exact (USB 3.2 Gen 2: CONFIRMED); a version no listing states is never a match (Gen 2x2: no exact, no row CONFIRMED; a relaxed closest set is labelled)', (vs.kind!=='exact' || vs.codes.every(c=>vs.evidence[c]['version:usb']==='CONFIRMED')) && vs2.kind!=='exact' && !vs2.codes.some(c=>vs2.evidence[c]['version:usb']==='CONFIRMED'), JSON.stringify([vs.kind,vs.codes.length,vs2.kind,vs2.codes.length]));
  const fl=[run('tb4'),run('hdmi 2.2'),run('same wattage')].map(P=>P.proposal), fe=VP.executeFrame({ subject:null, constraints:[A('feature','feature:dp_alt',true,true)] },OPTS);
  chk('C1.E7 no subject-less catalogue flood: "tb4" / "hdmi 2.2" / bare "same wattage" / a subject-less merged frame clarify instead of listing unrelated families', fl.every(p=>p.kind==='clarify' && !p.codes.length) && fe.kind==='clarify' && !fe.codes.length, JSON.stringify(fl.map(p=>[p.kind,p.codes.length]).concat([[fe.kind,fe.codes.length]])));
  const lg=run('longest HDMI cable'), noLen=lg.proposal.codes.filter(c=>G(c).lengthM==null), firstNo=lg.proposal.codes.findIndex(c=>G(c).lengthM==null);
  chk('C1.E8 a ranked set keeps rows with no value for the metric AFTER the ranked rows and says so (never silently dropped)', noLen.length>0 && lg.proposal.codes.slice(firstNo).every(c=>G(c).lengthM==null) && lg.proposal.unrankedTail===noLen.length, JSON.stringify([noLen.length,firstNo,lg.proposal.codes.length]));
  const pn=VP.executeFrame({ subject:{ family:'charger' }, constraints:[A('colour','colour','white',null)] },OPTS);
  chk('C1.E9 polarity null is never confirmed by the executor (unclear negation scope -> no exact answer)', pn.kind!=='exact', pn.kind);
  const big=VP.executeFrame({ subject:{ family:'video_cable' }, constraints:[] },OPTS), bad=VP.executeFrame({ subject:{ family:'charger' }, constraints:[A('mystery','mystery:x',1,true)] },OPTS);
  chk('C1.E10 executor evaluates the FULL published catalogue (no 50-candidate cap) and reports unsupported constraint kinds (never silently ignored)', big.codes.length===famCodes('video_cable').length && big.codes.length>50 && bad.frameErrors.length===1 && bad.frameErrors[0].slot==='mystery:x', JSON.stringify([big.codes.length,bad.frameErrors]));
  /* ---- price-cache fixture (no resetCache): an in-memory price edit is read at execution time ---- */
  { const P2=PUB.map(p=>Object.assign({},p)), F2=VF.build(P2), O2={ facts:F2, products:P2 }, fr={ subject:{ family:'charger' }, rank:{ metric:'price', dir:'asc' }, constraints:[] };
    const r1=VP.executeFrame(fr,O2), cheapest=r1.codes[0], row=P2.find(p=>String(p.item_code)===cheapest), old=row.srp, cap=Number(P2.find(p=>String(p.item_code)===r1.codes[5]).srp); row.srp='99999';
    const r2=VP.executeFrame(fr,O2), r3=VP.executeFrame({ subject:{ family:'charger' }, constraints:[A('price','price',cap,true,{ op:'<=', typed:true })] },O2);
    chk('C1.E11 price cache (QA F4.5): after an in-memory SRP edit (same facts key, no resetCache) ranking and price filters use the LIVE price', r2.codes[0]!==cheapest && r2.codes.slice(r2.codes.indexOf(cheapest)+1).every(c=>!isFinite(parseFloat(P2.find(p=>String(p.item_code)===c).srp))) && r3.kind==='exact' && r3.codes.length>=5 && !r3.codes.includes(cheapest), JSON.stringify([cheapest,r2.codes.slice(0,3),r2.codes.indexOf(cheapest),r3.kind,r3.codes.length]));
    row.srp=old; VP.executeFrame(fr,OPTS); }
  /* ---- review fixes (QA + VERO round 1 on fingerprint 1080f744…) ---- */
  { const pbB=famCodes('power_bank').filter(c=>G(c).feats.builtin && G(c).feats.builtin.state==='CONFIRMED').length, pbI=famCodes('power_bank').filter(c=>!G(c).feats.builtin && G(c).feats.retractable && G(c).feats.retractable.state==='CONFIRMED').length;
    const cnt=['how many power banks with built-in cable','ilan power bank na may built-in cable'].map(q=>run(q).proposal);
    chk('C1.R1 a COUNT with inferred matches counts the STATED ones ('+pbB+') and reports the inferred ones separately ('+pbI+'), never 0', pbB>0 && cnt.every(p=>p.count===pbB && p.inferredCount===pbI && /not counted/.test(p.notes.join(' '))), JSON.stringify(cnt.map(p=>[p.kind,p.count,p.inferredCount])));
    const alt=run('same capacity as 25286 pero may built-in cable').proposal, ai=alt.inferred||[];
    chk('C1.R2 alternatives: an INFERRED alternative is listed AFTER the stated ones and labelled (main and closest-same-spec paths)', alt.kind==='alternative' && ai.length>0 && JSON.stringify(alt.codes.slice(-ai.length))===JSON.stringify(ai) && /inferred, not stated, listed last/.test(alt.notes.join(' ')), JSON.stringify([alt.codes.length,ai,alt.notes]));
    const named=(c,k)=>{ const g=G(c); return g.conns.all.includes(k)||g.conns.feat.includes(k)||(g.pair&&(g.pair.from.includes(k)||g.pair.to.includes(k))); };
    const floorQ=[['hub with 3 HDMI ports','hdmi'],['meron 2.5G LAN adapter?','rj45'],['thunderbolt 4 cable','thunderbolt'],['hdmi 2.2 cable','hdmi'],['usb-c to hdmi dp alt mode','hdmi']];
    const fb=floorQ.filter(([q,k])=>{ const p=run(q).proposal; return !p.codes.length || !p.codes.every(c=>named(c,k)); }).map(([q])=>{ const p=run(q).proposal; return q+' -> '+p.kind+' '+p.codes.length; });
    chk('C1.R3 evidence floor: partial / closest rows always name or mention every requested connector (no "partial" product with no trace of the request: E03 Wi-Fi adapter, D07 plain USB hubs)', !fb.length, fb);
    const e03=run('meron 2.5G LAN adapter?').proposal, d07=run('hub with 3 HDMI ports').proposal;
    chk('C1.R3b E03 / D07 are back to the live-baseline answers (closest gigabit RJ45 adapters; the 3 HDMI docks), never the Wi-Fi adapter or plain USB hubs', e03.kind==='closest' && !e03.codes.includes('35265') && d07.kind==='partial' && d07.codes.length===3, JSON.stringify([e03.kind,e03.codes,d07.kind,d07.codes]));
    const dp=run('usb-c to hdmi dp alt mode').proposal, tbc=run('thunderbolt 4 cable').proposal, tb=run('tb4').proposal;
    chk('C1.R4 the flood guard never fires when a proposed product confirms a defining constraint (pair / form / connector); its wording never claims "no product type" when one was named', dp.kind!=='clarify' && dp.codes.length>0 && tbc.kind!=='clarify' && tb.kind==='clarify' && /No listed product states Thunderbolt 4/.test(tb.notes.join(' ')) && !/no product type/.test(tb.notes.join(' ')), JSON.stringify([dp.kind,tbc.kind,tb.notes]));
    const sw=run('switch without usb-a').proposal;
    chk('C1.R5 an exclusion that removes every match says so ("every listed … has USB-A"), never a false "wala" / "No exact match"', sw.kind==='none' && /Every listed .* has USB-A/.test(sw.notes.join(' ')) && !/Wala|No exact match/.test(sw.notes.join(' ')), JSON.stringify(sw.notes));
    const g2=PUB.map(p=>String(p.item_code)).filter(c=>G(c) && /usb 3\.[12] gen ?2/i.test(G(c).lname)), u2=run('usb 3.2 gen 2 hub').proposal;
    chk('C1.R6 a stated USB Gen ("USB 3.2 Gen 2", "USB-C 3.1 GEN2") is part of the graph version and CONFIRMED ('+g2.length+' products)', g2.length>0 && g2.every(c=>/g2$/.test(Object.values(G(c).versions).join(' '))) && u2.kind==='exact' && u2.codes.every(c=>/3\.2 gen 2/i.test(G(c).lname)), JSON.stringify([g2.map(c=>c+':'+JSON.stringify(G(c).versions)),u2.kind,u2.codes]));
    chk('C1.R7 a bare "tb" is never Thunderbolt ("tb ssd" = terabyte context); "tb4" still is', !TF('tb ssd').constraints.some(c=>/thunderbolt/.test(c.slot)) && TF('tb4').constraints.some(c=>c.slot==='version:thunderbolt'));
    /* review round 2 (VERO R2-1 / R2-2) */
    const NG=[['charger not 65w','charger','watts',65],['charger hindi 65w','charger','watts',65],['hindi 20w na charger','charger','watts',20],['power bank not 10000mah','power_bank','mah',10000],['power bank not 2m','power_bank','lengthM',2],['hub not 2m','hub_dock','lengthM',2]];
    const ngb=NG.filter(([q,f,a,v])=>{ const p=run(q).proposal, all=famCodes(f); return p.kind==='exact' || p.codes.length<all.length*0.8 || (p.codes.length && p.codes.every(c=>G(c)[a]===v)); }).map(([q])=>{ const p=run(q).proposal; return q+' -> '+p.kind+' '+p.codes.length; });
    chk('C1.R9 an unclear negated number ("charger not 65w", "power bank not 2m") keeps the whole family, labelled; never "nearest" to the negated value, never exact', !ngb.length, ngb);
    const g1=run('usb-c 3.1 gen 1 cable').proposal;
    chk('C1.R10 a GEN token later in the name binds to the single USB 3.x version ("USB-C 3.1 Male To Male GEN1" = 3.1 Gen 1, CONFIRMED and listed first)', /g1$/.test(Object.values(G('50751').versions).join(' ')) && (g1.exactCodes||g1.codes)[0]==='50751', JSON.stringify([G('50751').versions,g1.kind,g1.exactCodes,g1.codes]));
    /* review round 3 (VERO R3): bare USB "Gen N" without a 3.x number */
    const stG=(c,g)=>new RegExp(g+'$').test(Object.values(G(c).versions).join(' '));
    const BG=[['usb-c gen 1 cable','g1'],['usb c gen2 cable','g2'],['usb-c gen 1 ethernet adapter','g1'],['usb-c gen1 to ethernet','g1'],['usb gen 2 hub','g2']];
    const bgb=BG.filter(([q,g])=>{ const p=run(q).proposal, st=(p.exactCodes||p.codes); return !st.length || !st.every(c=>stG(c,g)); }).map(([q])=>{ const p=run(q).proposal; return q+' -> '+p.kind+' '+(p.exactCodes||p.codes).join(','); });
    chk('C1.R11 a bare Gen request ("usb-c gen 1 cable", "usb gen 2 hub") matches the products whose names STATE that Gen (stated first; USB 3.0 = Gen 1 only INFERRED; never contradicted)', !bgb.length, bgb);
    const ng=['gen 2 hub','hub gen 1','usb gen 4 cable'].map(q=>run(q).proposal).filter(p=>/No exact match for Gen/i.test(p.notes.join(' ')));
    chk('C1.R12 a generation with no interface is never relaxed into a "No exact match for Gen N" claim', !ng.length, ng.map(p=>p.notes));
    const negG=['usb-c cable not gen 1','hub hindi gen 2','not gen 2'].filter(q=>TF(q).constraints.some(c=>(c.kind==='version' || /^version:/.test(c.slot)) && c.polarity===true) || TF(q).constraints.some(c=>c.kind==='connector' && /gen/i.test(JSON.stringify(c.value))));
    chk('C1.R13 a negated bare generation ("not gen 1", "hindi gen 2") is never applied as a requirement (UNRESOLVED, as before)', !negG.length && ['usb-c cable not gen 1','hub hindi gen 2'].every(q=>TF(q).ledger.some(l=>l.state==='UNRESOLVED')), negG);
    const ch=run('cheapest usb 3.0 hub').proposal;
    chk('C1.R14 in a ranking, stated matches come before inferred ones ("cheapest usb 3.0 hub": an inferred 3.2 Gen 1 hub is never first)', ch.kind==='inferred' && JSON.stringify(ch.codes.slice(0,(ch.exactCodes||[]).length).sort())===JSON.stringify((ch.exactCodes||[]).slice().sort()), JSON.stringify([ch.codes.slice(0,4),ch.exactCodes&&ch.exactCodes.length]));
    chk('C1.R15 a version exclusion keeps the Gen in its label ("not USB 3.1 Gen 1")', /not USB 3\.1 Gen 1/.test((run('not usb 3.1 gen 1 cable').proposal.notStated||[]).join(' ')));
    /* remote review (VERO N1): a negated FULL USB version must not also emit its absorbed Gen as an affirmed requirement */
    const N1=[['hub not usb 3.2 gen 2','3.2g2'],['hindi usb 3.2 gen 1 hub','3.2g1'],['not usb 3.1 gen 1 cable','3.1g1'],['cable hindi usb 3.1 gen 2','3.1g2'],['hub except usb 3.2 gen 2','3.2g2']];
    const n1b=N1.filter(([q,full])=>{ const T=TF(q), vs=T.constraints.filter(c=>c.kind==='version');
      return validateA5(T).length || vs.some(c=>c.polarity===true) || !vs.some(c=>c.slot==='version:usb' && c.value.generation===full && c.polarity===false)
        || T.constraints.some(c=>c.slot==='connector:usb4' || (c.value && c.value.generation==='4')) || !T.constraints.some(c=>c.slot==='connector:usb' && c.polarity===true); }).map(([q])=>q+' :: '+JSON.stringify(TF(q).constraints.map(c=>[c.slot,c.value&&c.value.generation,c.polarity])));
    const n1x=VP.executeFrame(TF('hub not usb 3.2 gen 2'),OPTS);
    chk('C1.R16 a negated full USB version ("hub not usb 3.2 gen 2", "hindi usb 3.2 gen 1 hub", "not usb 3.1 gen 1 cable", "cable hindi usb 3.1 gen 2", "hub except usb 3.2 gen 2") keeps ONLY the negated full version: no affirmed bare Gen, no USB4, base USB connector kept; the executor excludes the stated 3.2 Gen 2 hub and no longer degrades to partial', !n1b.length && n1x.kind!=='partial' && !n1x.codes.includes('35584'), n1b.concat([n1x.kind+' '+n1x.codes.includes('35584')]));
    /* generic invariant: a negated version span never also yields a positive version constraint (same span or negator-governed span) */
    const NV=['usb 3.2 gen 2','usb 3.2 gen 1','usb 3.1 gen 1','usb 3.1 gen 2','usb-c 3.2 gen 2','usb-c 3.1 gen 1','usb 3.0','usb 3.1','usb4','tb4','thunderbolt 4','hdmi 2.1','hdmi 2.0','dp 1.4','pcie gen 4','pcie 4.0','gen 1','gen 2'];
    const NN=['not','hindi','without','walang','except','no','ayaw ng'], NF=['hub','cable','adapter','ssd enclosure','dock',''];
    const nvq=[]; NF.forEach(f=>NN.forEach(n=>NV.forEach(v=>{ nvq.push((f+' '+n+' '+v).trim()); if(f) nvq.push(n+' '+v+' '+f); })));
    const nvb=nvq.filter(q=>{ const P=VP.parse(q,OPTS), T=VP.turnFrame(P), vs=T.constraints.filter(c=>c.kind==='version');
      return vs.some(c=>c.polarity===true && (vs.some(d=>d.polarity===false && d.source.span===c.source.span) || (P.spans.find(s=>s.id===c.source.span)||{}).negated)); });
    const ctl=[['usb 3.2 gen 2 hub','3.2g2',true],['usb-c gen 1 cable','g1',true],['not usb4 cable','4',false],['thunderbolt 4 cable','4',true]].filter(([q,g,p])=>!TF(q).constraints.some(c=>c.kind==='version' && c.value.generation===g && c.polarity===p)).map(x=>x[0]);
    chk('C1.R17 NEGATED VERSION INVARIANT ('+nvq.length+' negator x family x version phrasings): a negated version span never also emits a positive version constraint; affirmed and negated controls keep their polarity', !nvb.length && !ctl.length, nvb.slice(0,10).concat(ctl));
    const kb=run('cheapest keyboard built-in').proposal;
    chk('C1.R8 an inferred-only set over unrelated families with no subject clarifies (never 23 cross-family items)', kb.kind==='clarify' && !kb.codes.length, JSON.stringify([kb.kind,kb.codes.length])); }
  /* ---- discourse chain with the C1 parser output (structure only; context guards are C2) ---- */
  { const OPc={ now:1e12, mode:'public', families:['power_bank','charger','video_cable'], applies:()=>true, qualify:()=>null };
    const T1=TF('power bank 10000mah'), r1=D.resolve(T1,null,OPc), c1=D.buildContext(null,r1,{ shown:famCodes('power_bank').slice(0,6) },OPc);
    const T2=TF('not the one with cable'), r2=D.resolve(T2,c1,OPc), mv=Object.fromEntries((r2.mergedFrame?r2.mergedFrame.constraints:[]).map(c=>[c.slot,c.polarity]));
    chk('C1.H1 "power bank 10000mah" -> "not the one with cable": the C1 frame reaches discourse as an elliptical EXCLUDE of feature:builtin inside the power-bank context (own-family retention is C2)', r2.act==='EXCLUDE' && mv['feature:builtin']===false && mv['num:mah']===true && !('form' in mv), JSON.stringify([r2.act,mv])); }
  /* ---- mutation kills: every new rule is load-bearing (a mutated vero-parse.js must fail its check) ---- */
  { const vm=require('vm'), PSRC=fs.readFileSync(path.join(ROOT,'js','vero-parse.js'),'utf8');
    const mutant=(from,to)=>{ if(PSRC.split(from).length!==2) throw new Error('mutation anchor not unique: '+from.slice(0,50)); const sb={ module:{ exports:{} }, window:{ VeroOntology:O, VeroLexicon:window.VeroLexicon, VeroFacts:VF }, performance, console }; vm.runInNewContext(PSRC.replace(from,()=>to),sb); return sb.module.exports; };
    const tf=(M,q)=>M.turnFrame(M.parse(q,OPTS)), rn=(M,q)=>M.run(q,OPTS).proposal;
    const retrC=retr[0], v32=PUB.map(p=>String(p.item_code)).find(c=>G(c) && G(c).family==='hub_dock' && (inf||[]).includes(c));
    const MUT=[
      ['#1 relativised cable rebind', "if(relObj && t.type==='FORM'", "if(false && t.type==='FORM'", M=>tf(M,'not the one with cable').constraints.some(c=>c.slot==='form')],
      ['#2 comma relax', "if(!ns && !ps && pv && !pv.negGov", "if(false && !ns && !ps && pv && !pv.negGov", M=>!tf(M,'white, not needed').relax.length],
      ['#3 require+relax conflict', "if(relaxSlotOf(v)===r.value.relaxSlot){", "if(false){", M=>tf(M,'white pero no need white').constraints.some(c=>c.slot==='colour')],
      ['#5 versioned negation', "var nIf=s.negated && (s.value.ver||s.value.gen)", "var nIf=false && (s.value.ver||s.value.gen)", M=>tf(M,'not hdmi 2.1').constraints.some(c=>c.slot==='connector:hdmi' && c.polarity===false)],
      ['#15 generic name guard', "if(nf.length<=1) return true;", "return true;", M=>!!tf(M,'card').subject],
      ['keep emission', "if(keep.length) T.keep=keep;", "", M=>!('keep' in tf(M,'same wattage'))],
      ['flags.same emission', "if(sameCue && !T.sameBut) T.flags.same=true;", "", M=>!tf(M,'same but white').flags.same],
      ['notConnector absence', "(g.conns.all.indexOf(c.id)>=0 || g.conns.feat.indexOf(c.id)>=0)?CONTRA:UNK", "(g.conns.all.indexOf(c.id)>=0 || g.conns.feat.indexOf(c.id)>=0)?CONTRA:CONF", M=>!(M.executeFrame({ subject:{ family:'power_bank' }, constraints:[A('connector','connector:usb_a',{ id:'usb_a' },false)] },OPTS).notStated)],
      ['connector absence', "var st=inMain?CONF:(g.conns.power.indexOf(c.id)>=0?CONTRA:UNK);", "var st=inMain?CONF:(g.conns.power.indexOf(c.id)>=0?CONTRA:(g.conns.main.length?CONTRA:UNK));", M=>pairs.slice(0,60).some(([c,k])=>M.evalConstraint(c,{ kind:'connector', id:k },OPTS)==='CONTRADICTED')],
      ['INFERRED counted as exact', "if(r===CONF) conf++; else if(r===INF) inf++;", "if(r===CONF||r===INF) conf++;", M=>rn(M,'usb 3.2 gen 1 hub').kind==='exact'],
      ['USB naming -> CONFIRMED', "if(usbSame(h,want)) return INF;", "if(usbSame(h,want)) return CONF;", M=>v32 && M.evalConstraint(v32,{ kind:'ifaceVersion', iface:'usb', gen:'3.2g1' },OPTS)==='CONFIRMED'],
      ['retractable => built-in as CONFIRMED', "g.feats[k].state===CONF) s=INF;", "g.feats[k].state===CONF) s=CONF;", M=>M.evalConstraint(retrC,{ kind:'feature', id:'builtin' },OPTS)==='CONFIRMED'],
      ['subject-less flood guard (ladder sets)', "if(!F.subject && chosen.length && kind!=='exact'", "if(false && chosen.length && kind!=='exact'", M=>rn(M,'same wattage').kind!=='clarify'],
      ['subject-less flood guard (none-confirmed)', "if(floods(partialRows.map(function(x){ return x.code; }))) return flood(partialRows.length);", "", M=>M.executeFrame({ subject:null, constraints:[A('feature','feature:dp_alt',true,true)] },OPTS).kind!=='clarify'],
      ['rank keeps null-metric rows', "return withV.concat(noV);", "return withV;", M=>rn(M,'longest HDMI cable').codes.some(c=>G(c).lengthM==null)===false],
      ['evidence floor (partial step)', "var posRows=partialRows.filter(function(x){ return admissible(x.code,cons,true); });", "var posRows=partialRows;", M=>rn(M,'hub with 3 HDMI ports').codes.length!==3],
      ['evidence floor (relax ladder)', "return x.contra===0 && admissible(x.code,keep); });", "return x.contra===0; });", M=>rn(M,'meron 2.5G LAN adapter?').codes.length!==5],
      ['COUNT counts stated matches', "out.count=(out.exactCodes||[]).length;", "out.count=0;", M=>rn(M,'how many power banks with built-in cable').count===0],
      ['flood exemption for confirmed defining constraints', "!codes.some(function(code){ return defCons.some(", "!codes.some(function(code){ return false && defCons.some(", M=>rn(M,'usb-c to hdmi dp alt mode').kind==='clarify'],
      ['USB Gen in graph versions', "if(a && a.t==='gen' && b && b.k==='num' && /^[12]$/.test(b.t)) return { v:ver+'g'+b.t, n:2 };", "", M=>rn(M,'usb 3.2 gen 2 hub').kind==='exact'===false],
      ['negated value is never a requirement (R2-1)', "!c.polNull && !c.negGov; })); };", "true; })); };", M=>rn(M,'power bank not 2m').kind!=='partial'],
      ['later GEN token binding (R2-2)', "for(var gi=u3[0].end;gi<toks.length;gi++){", "for(var gi=toks.length;gi<toks.length;gi++){", M=>!/g1$/.test(Object.values(M.graphFor('50751',OPTS).versions).join(' '))],
      ['bare Gen matches a stated Gen (R3)', "var hg=(h.match(/g(\\d(?:x\\d)?)$/)||[])[1]; if(hg) return 'g'+hg===want?CONF:CONTRA;", "var hg=null;", M=>!(M.run('usb c gen2 cable',OPTS).proposal.codes||[]).includes('80150')],
      ['negated bare generation unresolved (R3)', "if(vb>=0 && (spans[vb].type==='NEG' || spans[vb].type==='RELAXNEG') && !cut(spans[vb],v)){ v._unres=true; v.impact='high'; return; }", "", M=>tf(M,'usb-c cable not gen 1').constraints.some(c=>/^version:/.test(c.slot) && c.polarity===true)],
      ['negated full version emits no affirmed Gen (N1)', "if(cv && !c.affirmBase) add('version'", "if(cv) add('version'", M=>tf(M,'hub not usb 3.2 gen 2').constraints.some(c=>c.kind==='version' && c.polarity===true)],
      ['ranking puts stated before inferred (R3)', "(kind==='inferred'&&out.exactCodes?rankCodes(out.exactCodes,F.rank,C).concat(rankCodes(out.inferred||[],F.rank,C)):rankCodes(chosen,F.rank,C))", "rankCodes(chosen,F.rank,C)", M=>{ const p=M.run('cheapest usb 3.0 hub',OPTS).proposal; return (p.inferred||[]).includes(p.codes[0]); }],
      ['price cache refresh', "if(CAT.priceSig!==ps){ refreshPrices(CAT,products); CAT.priceSig=ps; }", "", M=>{ const P2=PUB.map(p=>Object.assign({},p)), O2={ facts:VF.build(P2), products:P2 }, fr={ subject:{ family:'charger' }, rank:{ metric:'price', dir:'asc' }, constraints:[] };
        const a=M.executeFrame(fr,O2).codes[0]; P2.find(p=>String(p.item_code)===a).srp='99999'; return M.executeFrame(fr,O2).codes[0]===a; }] ];
    const survived=MUT.filter(([n,f,t,kill])=>{ try{ return !kill(mutant(f,t)); }catch(e){ return 'error '+e.message; } }).map(x=>x[0]);
    chk('C1.MUT mutation kills: every C1 rule is load-bearing ('+MUT.length+' mutants of vero-parse.js, each detected)', !survived.length, survived); }
}

/* ================= I  robustness + contract drift ================= */
{ const odd=['','   ','???','12345','₱','😀 charger','a'.repeat(400),'usb-c to to to hdmi','2 2 2 2 port port','ano ba yan hahaha','to','with with may may','dp dp dp','k k k','0w 0mah 0m','-5m cable','99999999999 mah power bank','hdmi to','to hdmi','"quoted" cable','x'.repeat(30)+' 65w',
    'gen gen gen','x16 x16','not not white','walang walang','kahit kahit','last last','pangalawa pangalawa','pcie pcie pcie','same but','mas','hindi','wala','any','x0','gen0','usb 9.9 gen 9x9'];
  const bad=[]; odd.forEach(q=>{ try{ const P=VP.run(q,OPTS), T=VP.turnFrame(P), v=validateA5(T); if(v.length) bad.push(q+' :: '+v[0]); if(P.ledger.silentDrops.length) bad.push(q+' (silent)'); if(negViol(P,T).length) bad.push(q+' (negator)'); }catch(e){ bad.push(q+' -> '+e.message); } });
  chk('I1 (M12.6 via turnFrame) '+odd.length+' odd inputs: no throw, valid A5 frame, no silent drop, negator invariant', !bad.length, bad);
  const short=['ilan?','ok','x4','gen 4','hindi','last','una','yun','mas','any','kahit'].filter(q=>{ try{ return validateA5(TF(q)).length>0; }catch(e){ return true; } });
  chk('I2 short inputs project to valid frames', !short.length, short);
  const sha=crypto.createHash('sha256').update(fs.readFileSync(DISC_PATH)).digest('hex');
  chk('I3 CONTRACT DRIFT: js/vero-discourse.js byte-identical to deployed V2-2A (sha256 f5b766d715410c7998fd7dd5bfc4b48d74284311103b3962d4d778c3fdf27f04)', sha==='f5b766d715410c7998fd7dd5bfc4b48d74284311103b3962d4d778c3fdf27f04', sha);
  const t=[]; for(let i=0;i<300;i++){ const q=pick(['kahit ilang ports','not white','yung pangalawa','which one is Gen 4?','same but cheaper','PCI-E3.0X4','usb 3.2 gen 2 hub','charger na walang built-in cable'])+pick(['',' po','?']); const s=process.hrtime.bigint(); VP.turnFrame(VP.run(q,OPTS)); t.push(Number(process.hrtime.bigint()-s)/1e6); }
  t.sort((a,b)=>a-b); chk('I4 performance incl. turnFrame: 300 B-matrix turns p95 '+t[Math.floor(t.length*0.95)].toFixed(2)+' ms (budget 15 ms)', t[Math.floor(t.length*0.95)]<=15); }

console.log(`\nVERO v2-1/v2-2B/v2-2C-C1 parse tests: ${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
