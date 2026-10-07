/* VERO p2r3a fix pack (held-out #1 review, 2026-10-07) — regression tests for the approved fixes F1–F6.
   Run: node tests/vero-p2r3a-fixes.test.js
   F1 inventory / stock-like wording (VERO has NO live inventory)   F2 built-in / "sariling" cable stays a hard filter
   F3 drive-size hard constraint (2.5" / 3.5")                      F4 "alin dun / which of those" refine the previous result set
   F5 zero-result names the noun; vague client recommendation clarifies   F6 topic switch + simple existence stays LOCAL
   Expected products are DERIVED from data/products.json + the facts index (no hardcoded SKUs); real SKUs are picked at run time. */
const fs=require('fs'), path=require('path');
const ROOT=path.join(__dirname,'..');
global.window={ PRICE_SETTINGS:{ indicatorDays:30 } };
eval(fs.readFileSync(path.join(ROOT,'js','helpers.js'),'utf8'));
['vero-lexicon','vero-nlu','vero-facts','vero-plan','vero-compose'].forEach(f=>require(path.join(ROOT,'js',f+'.js')));
const E=require(path.join(ROOT,'js','vero-engine.js'));
const F=require(path.join(ROOT,'js','vero-facts.js'));
const ALL=JSON.parse(fs.readFileSync(path.join(ROOT,'data','products.json'),'utf8')); pcResolveSchedule(ALL);
const PUB=ALL.filter(p=>!p.disabled), IDX=F.build(PUB), byCode={}; PUB.forEach(p=>byCode[String(p.item_code)]=p);
let pass=0, fail=0; const chk=(n,c,x)=>{ if(c){ pass++; console.log('PASS - '+n); } else { fail++; console.log('FAIL - '+n+(x!==undefined?'  -> '+String(x).slice(0,400):'')); } };
function chat(turns){ let conv=null; return turns.map(q=>{ const r=E.answer(PUB,q,{ conv }); const a=E.aiRoute(PUB,q,r,{}); if(r.ctxOut) conv=r.ctxOut; return { q, r, a }; }); }
const one=q=>chat([q])[0];
const txt=x=>x.q+' => '+(x.r.note||'')+' | '+(x.r.stockNote||'')+' | '+(x.r.codes||[]).length;
const fam=c=>IDX.byCode[c]&&IDX.byCode[c].type.family, name=c=>String((byCode[c]||{}).product_name||'');
const sortedEq=(a,b)=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
const local=x=>x.a.route==='local' && !x.a.candidates.length;
const COUNT_SENT=/^\s*\d+\s+(?:na\s+)?\S|\b\d+\s+(?:na\s+)?(?:sku|units?|pcs|pieces)\b/i;

/* real SKUs from the data: a model with one SKU, and a model with several colour SKUs */
const byModel={}; PUB.forEach(p=>{ const m=String(p.model||'').trim(); if(m) (byModel[m]=byModel[m]||[]).push(String(p.item_code)); });
const single=Object.keys(byModel).find(m=>byModel[m].length===1 && /^[A-Z]{1,3}\d{3}$/.test(m) && fam(byModel[m][0])==='power_bank');
const multi=Object.keys(byModel).find(m=>byModel[m].length>=3 && /^[A-Z]{1,3}\d{3}$/.test(m) && new Set(byModel[m].map(c=>byCode[c].color)).size>=3);

/* ================= F1 inventory ================= */
const inv=['ilan pa natitira sa '+single+'?','may stock pa ng '+single+'?','how many left of the '+single+'?','ubos na ba ang '+single+'?','sold out na ba yung '+single+'?','is the '+single+' still available?','ilan on hand ng '+single+'?','may natira pa ba sa '+single+'?','remaining units of '+single+'?','availability ng '+single+'?'].map(one);
chk('F1a inventory wording on a named SKU: "listed in the current pricelist" + live-inventory caveat, never a SKU-count sentence, LOCAL, 0 Worker ('+inv.length+')',
  inv.every(x=>/listed in the current pricelist|naka-lista .*sa current pricelist/i.test(x.r.note) && /live inventory/.test(x.r.stockNote||'') && !COUNT_SENT.test(x.r.note) && local(x) && x.r.codes[0]===byModel[single][0]), inv.filter(x=>!(/listed|naka-lista/i.test(x.r.note)&&/live inventory/.test(x.r.stockNote||'')&&!COUNT_SENT.test(x.r.note))).map(txt).join(' || '));
const q15=one('ilan pa natitira sa '+single+'?');
chk('F1b "ilan pa natitira sa X" (held-out HO15): Taglish "Naka-lista ang X…", quantity caveat "kung ilan pa ang natitira", no "1 na …" count', /^Naka-lista ang /.test(q15.r.note) && /kung ilan pa ang natitira/.test(q15.r.stockNote) && !/^1 /.test(q15.r.note), txt(q15));
const qty=['ilan pa natitira na 65W charger?','how many 65W chargers are left?','ilan pa ang stock ng 20000mAh power bank?'].map(one);
chk('F1c type-level inventory questions: list of LISTED items with no leading number, quantity caveat', qty.every(x=>(x.r.codes||[]).length>0 && /listed in the current pricelist|naka-lista sa current pricelist/i.test(x.r.note) && !COUNT_SENT.test(x.r.note) && /live inventory/.test(x.r.stockNote||'') && local(x)), qty.map(txt).join(' || '));
const av=chat(['magkano yung '+single+'?','available ba ito?'])[1];
chk('F1d "available ba ito?" after a lookup: listed (that SKU) + "can’t confirm current stock", no stock claim', /naka-lista/i.test(av.r.note) && /current stock/.test(av.r.stockNote||'') && !/\bin stock\b|meron pang stock/i.test(av.r.note) && av.r.codes[0]===byModel[single][0], txt(av));
const none=one('may stock ba ng keyboard?');
chk('F1e inventory question about something not listed: "not listed" wording (never reads as sold out)', /^(?:Walang|No) .*(?:naka-lista|listed)/.test(none.r.note) && !/sold out|ubos|out of stock/i.test(none.r.note) && /live inventory/.test(none.r.stockNote||''), txt(none));
const neg=[one('meron pa bang mas mura sa '+single+'?'), one('anong colors available ng '+multi+'?'), one('65W charger')];
chk('F1f no inventory caveat on "meron pa bang mas mura" (more options), colour/variant "available", or a plain search', neg.every(x=>!x.r.stockNote), neg.map(txt).join(' || '));
chk('F1g colour answers say "naka-lista", not "available"', /^Naka-lista sa pricelist ang mga kulay/.test(neg[1].r.note) && !/^Available/.test(neg[1].r.note), neg[1].r.note);

/* ================= F2 built-in cable ================= */
const want10=PUB.filter(p=>IDX.byCode[p.item_code].type.family==='power_bank' && IDX.byCode[p.item_code].attrs.mah.value===10000 && F.match(IDX.byCode[p.item_code],{ k:'flag', v:'builtin' })).map(p=>String(p.item_code)).filter(c=>{ const m=F.match(IDX.byCode[c],{ k:'flag', v:'builtin' }); return m && m.t!=='weak'; });
const bi=['10k powerbank na may sariling cable','10k power bank with built-in cable','10k power bank integrated cable','10k powerbank na may cable na nakakabit','10k power bank built in cable','10k power bank na nakakabit na cable'].map(one);
chk('F2a sariling / built-in / integrated / "may cable na nakakabit" = the same hard built-in filter (data-derived set of '+want10.length+')', want10.length>0 && bi.every(x=>x.r.plan.match.some(m=>m.k==='flag'&&m.v==='builtin') && sortedEq(x.r.codes,want10)), bi.map(x=>x.q+' -> '+x.r.codes.join(',')).join(' || '));
const bf=chat(['10k powerbank na may sariling cable','yung pinakamura dun']);
const cheapest=[...want10].sort((a,b)=>Number(byCode[a].srp)-Number(byCode[b].srp))[0];
chk('F2b follow-up "yung pinakamura dun" ranks ONLY inside the built-in set (inherits the flag)', bf[1].r.plan.followUp && bf[1].r.plan.inherited.indexOf('flag:builtin')>=0 && bf[1].r.codes[0]===cheapest && bf[1].r.codes.every(c=>want10.includes(c)), txt(bf[1])+' first='+bf[1].r.codes[0]+' want='+cheapest);
const rt=one('power bank na retractable cable');
chk('F2c retractable stays its own attribute (not folded into generic built-in)', rt.r.plan.match.some(m=>m.v==='retractable') && !rt.r.plan.match.some(m=>m.v==='builtin') && rt.r.codes.length>0, txt(rt));
const wc=one('power bank with cable');
chk('F2d unclear "with cable" on a power bank: CLARIFY (built-in vs included) with chips, never silently dropped', wc.r.type==='clarify' && wc.r.chips.length===2 && local(wc), txt(wc));

/* ================= F3 drive size ================= */
const SZ=v=>new RegExp('(^|[^\\d.])'+v.replace('.','\\.')+'\\s*(?:-\\s*)?(?:inch|in\\b|\'\'|"|“|”|″)','i');
const want25=PUB.filter(p=>IDX.byCode[p.item_code].type.family==='enclosure' && SZ('2.5').test(' '+p.product_name)).map(p=>String(p.item_code));
const s25=['2.5 inch hdd enclosure','2.5" hdd enclosure','2.5-inch hdd enclosure','may 2.5 inch hdd enclosure tayo?','2.5 hdd enclosure'].map(one);
chk('F3a 2.5 inch / 2.5" / 2.5-inch = hard size filter on the product name (data-derived '+want25.length+'); no M.2 / PCIe items', want25.length>0 && s25.every(x=>sortedEq(x.r.codes,want25) && x.r.codes.every(c=>!/pci|m\.2/i.test(name(c)))), s25.map(x=>x.q+' -> '+x.r.codes.length).join(' || '));
const s35=one('3.5 inch enclosure'), want35=PUB.filter(p=>IDX.byCode[p.item_code].type.family==='enclosure' && SZ('3.5').test(' '+p.product_name)).map(p=>String(p.item_code));
chk('F3b 3.5 inch works the same way', sortedEq(s35.r.codes,want35) && want35.length>0, txt(s35));
const g25=one('2.5g lan adapter');
chk('F3c "2.5g" (Ethernet speed) is never read as a drive size', !g25.r.plan.match.some(m=>m.k==='size') && g25.r.plan.match.some(m=>m.k==='eth'&&m.v===2.5), JSON.stringify(g25.r.plan.match));
const st=one('may stock ba ng 2.5 inch hdd enclosure?');
chk('F3d held-out SQ4-1: size kept + inventory caveat, listed wording', sortedEq(st.r.codes,want25) && /live inventory/.test(st.r.stockNote||'') && /naka-lista/i.test(st.r.note), txt(st));

/* ================= F4 follow-up cues ================= */
const cues=['alin dun yung type c?','alin doon yung usb-c?','alin diyan yung usb-c?','alin dyan yung type-c?','yung alin dun yung usb c?','which of those are usb-c?','which one there is usb-c?'];
const f4=cues.map(c=>chat(['may 2.5 inch hdd enclosure tayo?',c]));
chk('F4a "alin dun / doon / diyan / dyan / which of those / which one there" refine the previous enclosure set to USB-C items (no global USB-C search) ('+cues.length+')',
  f4.every(t=>t[1].r.plan.followUp && t[1].r.codes.length>0 && t[1].r.codes.every(c=>t[0].r.codes.includes(c) && IDX.byCode[c].attrs.connectors.named.includes('usb_c'))), f4.map(t=>t[1].q+' -> '+t[1].r.codes.length+' fu='+t[1].r.plan.followUp).join(' || '));
chk('F4b the refinement echoes what it carried over', f4.every(t=>/2\.5"/.test(t[1].r.echo||'')), f4.map(t=>t[1].r.echo).join(' | '));

/* ================= F5 zero result / vague recommendation ================= */
const kb=one('may keyboard kayo?'), kb2=one('do you have a keyboard?');
chk('F5a zero result names the noun in the user’s language: "Wala tayong keyboard sa current UGREEN pricelist." / English', /^Wala tayong keyboard sa current UGREEN pricelist\./.test(kb.r.note) && /keyboard/.test(kb2.r.note) && !/a product in/.test(kb.r.note+kb2.r.note) && local(kb) && !kb.r.codes.length, txt(kb)+' || '+txt(kb2));
const rc=[one('may irerecommend ka for my client?'), one('ano ma-recommend mo sa customer ko?')];
chk('F5b vague client recommendation = local CLARIFY with product chips, 0 Worker calls', rc.every(x=>x.r.type==='clarify' && local(x) && (x.r.chips||[]).length>=4 && /client|customer|charger/i.test(x.r.note)), rc.map(txt).join(' || '));
const ms=one('may stock ba?');
chk('F5c existence with no product noun at all clarifies (and keeps the inventory caveat)', ms.r.type==='clarify' && local(ms) && /live inventory/.test(ms.r.stockNote||''), txt(ms));

/* ================= F6 topic switch + existence ================= */
const ts=chat(['10k powerbank na may sariling cable','ok iba naman, hdmi switch meron?']);
chk('F6a "ok iba naman, hdmi switch meron?" = fresh LOCAL existence (no AI, no echo, HDMI switchers only)', local(ts[1]) && ts[1].r.plan.topicSwitch && !ts[1].r.echo && ts[1].r.codes.length>0 && ts[1].r.codes.every(c=>fam(c)==='av_switch'), txt(ts[1])+' route='+ts[1].a.route);
const ts2=chat(['65W charger','ok, new question: may 8 port switch?']);
chk('F6b "ok, new question: …" also parses the rest normally (LOCAL)', local(ts2[1]) && ts2[1].r.plan.topicSwitch && ts2[1].r.codes.length>0, txt(ts2[1]));
const okb=one('ok ba ito pang laptop?'), okc=one('okay ba ang '+single+' pang laptop?');
chk('F6c "ok ba / okay ba …" is still a judgement question (the discourse-marker rule only strips a leading "ok, …")', okb.r.plan.flags.judgement && okc.r.plan.flags.judgement, okb.r.plan.intent+' / '+okc.r.plan.intent);

console.log(`\nVERO p2r3a fix pack: ${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
