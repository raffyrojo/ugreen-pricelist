/* VERO Local Brain — lexicon tests (Foundation Step 1).
   Run: node tests/vero-lexicon.test.js
   Checks: pure-data shape, duplicate phrase groups, alias relations, no catalog data (SKUs, models, names, prices,
   specs), protected non-equivalences enforced in code, hub/dock family + subtypes, taxonomy covers the real catalog,
   and the lexicon is not loaded by the live page in this step. */
const fs=require('fs'), path=require('path');
const ROOT=path.join(__dirname,'..');
require(path.join(ROOT,'js','vero-nlu.js'));
const LEX=require(path.join(ROOT,'js','vero-lexicon.js'));
const F=require(path.join(ROOT,'js','vero-facts.js'));
const P=JSON.parse(fs.readFileSync(path.join(ROOT,'data','products.json'),'utf8'));
let pass=0, fail=0;
const chk=(n,c,extra)=>{ if(c){pass++;console.log('PASS - '+n);} else {fail++;console.log('FAIL - '+n+(extra?'  -> '+String(extra).slice(0,400):''));} };
const clone=o=>JSON.parse(JSON.stringify(o));

/* 1. pure JSON-shaped data */
function pureData(v){ if(v===null) return true; const t=typeof v; if(t==='string'||t==='number'||t==='boolean') return true;
  if(t!=='object'||v instanceof RegExp) return false; if(Array.isArray(v)) return v.every(pureData);
  if(Object.getPrototypeOf(v)!==Object.prototype) return false; return Object.values(v).every(pureData); }
chk('L01 lexicon is pure JSON-shaped data (no functions / RegExp / class instances)', pureData(LEX) && JSON.stringify(clone(LEX))===JSON.stringify(LEX));

/* 2. phrase groups */
const groups=LEX.language, seen={}, dupWithin=[];
Object.entries(groups).forEach(([g,list])=>{ const s=new Set(); list.forEach(ph=>{ const k=ph.toLowerCase().trim(); if(s.has(k)) dupWithin.push(g+':'+k); s.add(k); (seen[k]=seen[k]||[]).push(g); }); });
chk('L02 no duplicate phrase inside a language group', !dupWithin.length, dupWithin.join(','));
const cross=Object.entries(seen).filter(([k,gs])=>gs.length>1);
const undeclared=cross.filter(([k,gs])=>JSON.stringify((LEX.sharedPhrases[k]||[]).slice().sort())!==JSON.stringify(gs.slice().sort()));
chk('L03 a phrase belongs to one group unless declared in sharedPhrases', !undeclared.length, undeclared.map(([k,g])=>k+'→'+g.join('/')).join(', '));
chk('L04 every declared shared phrase really is shared', Object.keys(LEX.sharedPhrases).every(k=>(seen[k]||[]).length>1));
chk('L05 language groups present (existence … filler)', ['existence','count','rankMin','rankMax','comparative','alternative','history','compare','rangeMin','rangeMax','rangeBetween','priceCue','reference','stock','period','judgement','useCase','compat','coach','filler'].every(g=>Array.isArray(groups[g])&&groups[g].length));

/* 3. taxonomy + aliases */
const fam={}, famDup=[]; LEX.taxonomy.families.forEach(f=>{ if(fam[f.id]) famDup.push(f.id); fam[f.id]=f; });
chk('L06 family ids unique', !famDup.length, famDup.join(','));
const badRule=[]; LEX.taxonomy.families.forEach(f=>{ [].concat(f.rules,(f.subtypes||[]).flatMap(s=>s.rules)).forEach(r=>{ Object.keys(r).forEach(k=>{ if(!['sheet_display','category'].includes(k)||!Array.isArray(r[k])) badRule.push(f.id+':'+k); }); }); });
chk('L07 taxonomy rules use structured fields only (sheet_display / category)', !badRule.length, badRule.join(','));
const subDup=LEX.taxonomy.families.filter(f=>{ const ids=(f.subtypes||[]).map(s=>s.id); return new Set(ids).size!==ids.length; });
chk('L08 subtype ids unique inside each family', !subDup.length);
const REL=['same','broader','narrower','related','notEquivalent'];
function targetOk(t){ const [ns,a,b]=String(t).split('.');
  if(fam[ns]) return !a || (fam[ns].subtypes||[]).some(s=>s.id===a);
  if(ns==='connector') return !!LEX.connectors[a] && (!b || b==='cable');
  if(ns==='flag') return !!LEX.flags[a];
  return false; }
const badAl=LEX.aliases.filter(a=>!REL.includes(a.relation)||!targetOk(a.to)||!a.term);
chk('L09 alias relations valid and every target resolves (family[.subtype] / connector / flag)', !badAl.length, JSON.stringify(badAl.slice(0,3)));
const termTo={}, aliasConflict=[]; LEX.aliases.forEach(a=>{ const k=a.term.toLowerCase(); if(termTo[k]&&termTo[k]!==a.to+'|'+a.relation) aliasConflict.push(k); termTo[k]=a.to+'|'+a.relation; });
chk('L10 no alias term mapped twice to different targets', !aliasConflict.length, aliasConflict.join(','));
chk('L11 related / notEquivalent aliases carry a note (why it is not the same)', LEX.aliases.filter(a=>a.relation==='related'||a.relation==='notEquivalent').every(a=>a.note));

/* 4. hub / dock (approved adjustment 1) */
const hd=fam.hub_dock;
chk('L12 hub_dock family has subtypes hub + dock from the structured category', hd && JSON.stringify(hd.subtypes.map(s=>s.id).sort())==='["dock","hub"]' &&
  hd.subtypes.find(s=>s.id==='dock').rules.some(r=>(r.category||[]).includes('Docking Station')) && hd.subtypes.find(s=>s.id==='hub').rules.some(r=>(r.category||[]).includes('Hub')));
const al=t=>LEX.aliases.find(a=>a.term===t)||{};
chk('L13 broad "hub or docking station" / bare "hub" -> shared family', al('hub or docking station').to==='hub_dock' && al('hub').to==='hub_dock' && al('hub/dock').to==='hub_dock');
chk('L14 "hub only" / "not a full dock" -> hub subtype (strict); "docking station" -> dock subtype (strict)',
  al('hub only').to==='hub_dock.hub'&&al('hub only').strict && al('not a full dock').to==='hub_dock.hub'&&al('not a full dock').strict && al('docking station').to==='hub_dock.dock'&&al('docking station').strict);
chk('L15 clarification template for hub vs dock exists', /hub/.test(LEX.templates.hubOrDock)&&/dock/.test(LEX.templates.hubOrDock));

/* 5. no catalog data inside the lexicon */
const strs=[]; (function walk(v,k){ if(typeof v==='string') strs.push({k,v}); else if(v&&typeof v==='object') Object.entries(v).forEach(([kk,vv])=>{ strs.push({k:'key',v:kk}); walk(vv,kk); }); })(LEX,'');
const flagPatterns=new Set(Object.values(LEX.flags).map(f=>f.pattern));
const textStrs=strs.filter(s=>!flagPatterns.has(s.v));
const codes=new Set(P.map(p=>String(p.item_code).toLowerCase())), models=new Set(P.map(p=>String(p.model||'').toLowerCase().trim()).filter(m=>m.length>=4&&/\d/.test(m)));
const hitCode=[]; textStrs.forEach(s=>{ (s.v.toLowerCase().match(/[a-z0-9.\-]+/g)||[]).forEach(t=>{ if(codes.has(t)||models.has(t)) hitCode.push(t); }); });
chk('L16 no item code or model number in the lexicon', !hitCode.length, hitCode.join(','));
const names=P.map(p=>String(p.product_name||'').toLowerCase().trim()).filter(n=>n.split(/\s+/).length>=3);
const hitName=textStrs.filter(s=>s.v.length>=12 && names.some(n=>n===s.v.toLowerCase() || (s.v.split(/\s+/).length>=3 && n.includes(s.v.toLowerCase()) && /\d/.test(s.v))));
chk('L17 no product name in the lexicon', !hitName.length, hitName.map(s=>s.v).join(' | '));
const RESW=new Set(Object.keys(LEX.resolutionWords));
/* connector / standard NAMES (3.5mm jack, RS-232) are vocabulary, not product specs */
Object.values(LEX.connectors).concat(Object.values(LEX.portKinds)).forEach(l=>l.forEach(w=>RESW.add(w.toLowerCase())));
LEX.aliases.filter(a=>/^connector\./.test(a.to)).forEach(a=>RESW.add(a.term.toLowerCase()));
LEX.taxonomy.families.forEach(f=>(f.nameCues||[]).forEach(w=>RESW.add(w.toLowerCase())));
const hitSpec=textStrs.filter(s=>/₱\s*\d|\b\d{3,6}\b(?![.\d])|\b\d+(?:\.\d+)?\s?(?:w|watts?|mah|gbps|mbps|hz|cm|mm|tb|gb)\b/i.test(s.v) && !RESW.has(s.v.toLowerCase()));
chk('L18 no prices or technical spec values in the lexicon', !hitSpec.length, hitSpec.map(s=>s.k+'='+s.v).join(' | '));

/* 6. protected non-equivalences: enforced in CODE */
chk('L19 shipped lexicon passes VeroFacts.assertLexiconSafe', (()=>{ try{ return F.assertLexiconSafe(LEX); }catch(e){ return false; } })());
const throwsWith=(mut)=>{ const L=clone(LEX); mut(L); try{ F.assertLexiconSafe(L); return false; }catch(e){ return /unsafe/.test(e.message); } };
chk('L20 rejects "magnetic wireless" == MagSafe', throwsWith(L=>L.aliases.push({term:'magnetic wireless',to:'flag.magsafe',relation:'same'})));
chk('L21 rejects "magnetic" as narrower/broader of MagSafe', throwsWith(L=>L.aliases.push({term:'magnetic',to:'flag.magsafe',relation:'narrower'})));
chk('L22 rejects Qi == Qi2 (alias and flag pattern)', throwsWith(L=>L.aliases.push({term:'qi',to:'flag.qi2',relation:'same'})) && throwsWith(L=>{ L.flags.qi2.pattern='\\bqi'; }));
chk('L23 rejects USB-C port == USB-C cable', throwsWith(L=>L.aliases.push({term:'usb-c port',to:'connector.usb_c.cable',relation:'same'})));
chk('L24 rejects Thunderbolt == USB4 (alias and shared connector words)', throwsWith(L=>L.aliases.push({term:'thunderbolt',to:'connector.usb4',relation:'same'})) && throwsWith(L=>L.connectors.usb4.push('thunderbolt')));
chk('L25 rejects a MagSafe flag pattern that matches "magnetic wireless"', throwsWith(L=>{ L.flags.magsafe.pattern='\\bmagsafe\\b|\\bmagnetic\\b'; }));
chk('L26 shipped aliases relate (never equate) the protected pairs', ['magnetic wireless','magnetic','qi','thunderbolt'].every(t=>{ const a=al(t); return !a.to || ['related','notEquivalent'].includes(a.relation); }));

/* 7. taxonomy covers the real catalog (structured pairs) */
const pairs=new Set(P.map(p=>p.sheet_display+'||'+p.category));
const covered=pr=>{ const [s,c]=pr.split('||'); const p={sheet_display:s,category:c};
  const hit=r=>Object.keys(r).every(k=>r[k].includes(p[k]));
  return LEX.taxonomy.families.some(f=>f.rules.some(hit)) || LEX.taxonomy.unclassified.some(hit); };
const unc=[...pairs].filter(pr=>!covered(pr));
chk('L27 every (section, category) pair in products.json is covered by a family or the documented unclassified list', !unc.length, unc.join(' ; '));

/* 8. p2r3a: loaded by index.html in dependency order (lexicon -> nlu -> facts -> plan -> compose -> engine -> vero.js) */
const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
const ord=['js/vero-lexicon.js','js/vero-nlu.js','js/vero-facts.js','js/vero-plan.js','js/vero-compose.js','js/vero-engine.js','js/vero.js?'].map(f=>html.indexOf(f));
chk('L28 index.html loads the Local Brain before the engine, in dependency order', ord.every(i=>i>0) && ord.every((v,i)=>i===0||v>ord[i-1]), ord.join(','));
const live=['vero.js','vero-nlu.js'].map(f=>fs.readFileSync(path.join(ROOT,'js',f),'utf8')).join('\n');
chk('L29 UI and NLU never reach into the lexicon / facts directly (engine -> VeroCompose is the only entry point)', !/VeroLexicon|VeroFacts|VeroPlan/.test(live) && /VeroCompose/.test(fs.readFileSync(path.join(ROOT,'js','vero-engine.js'),'utf8')));

console.log(`\nVERO lexicon tests: ${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
