/* UNO Evidence & Retrieval Layer R1 — the 66 reviewer-reported failures of round 5 (SHADOW ONLY, DORMANT).
   Run: node tests/vero-evidence-regressions.test.js [--verbose]
   Source: the round-5 VERO and QA reviews (59 wrong YES + 7 wrong subject), re-verified on the frozen round-5 tree
   (fingerprint 2154ca3d…53d7) and collected in the R1 architecture review (2026-10-12).
   Every case keeps its CORRECT expected outcome and the catalogue evidence for it -- never just "not YES":
     expect      the right answer from the catalogue text: NO | UNKNOWN (the question is ambiguous or the catalogue is silent) |
                 CLARIFY (a new, unidentified product: the previous subject must not be reused)
     residual    an outcome accepted for now because it is fail-closed (UNKNOWN = an evidence request, never a claim) while
                 the exact answer needs a later approved phase (Phase 2 power profile, Phase 3 display profile)
   A case FAILS on any outcome outside { expect, residual }: a YES, a NO where the right answer is UNKNOWN, or an answer about
   the previous subject. The summary separates exact answers from fail-closed residuals so residual gaps stay visible.
   Outcome of a decision: LOCAL/local_confirmed = YES, LOCAL/local_contradicted = NO, EVIDENCE = UNKNOWN, CLARIFY = CLARIFY.
   Phase 1 corrective round (2026-10-13): CASES_P1 adds the 20 failures of the Phase 1 VERO / QA reviews (tallied separately).
   Regression stabilization (2026-10-13): CASES_PC adds the corrective round's new wrong-YES repros (R1-PC-VERO-F1 / QA-R1:
   a quantified or conjoined kind plural is a display count, never a simple kind question; tallied separately).
   No network, no LLM, no price reads. Exit 1 on any failure. */
const fs=require('fs'), path=require('path');
const ROOT=path.join(__dirname,'..');
const VERBOSE=process.argv.includes('--verbose');
let pass=0, fail=0;
const chk=(n,c,x)=>{ if(c){ pass++; if(VERBOSE) console.log('PASS - '+n); } else { fail++; console.log('FAIL - '+n+(x!==undefined?'  -> '+String(typeof x==='string'?x:JSON.stringify(x)).slice(0,400):'')); } };
let netCalls=0;
global.fetch=function(){ netCalls++; throw new Error('network call from the evidence layer'); };
global.XMLHttpRequest=function(){ netCalls++; throw new Error('XHR from the evidence layer'); };
global.window={ PRICE_SETTINGS:{ indicatorDays:30 } };
eval(fs.readFileSync(path.join(ROOT,'js','helpers.js'),'utf8'));
['vero-lexicon','vero-nlu','vero-facts','vero-plan','vero-compose'].forEach(f=>require(path.join(ROOT,'js',f+'.js')));
const E=require(path.join(ROOT,'js','vero-engine.js'));
const FACTS=require(path.join(ROOT,'js','vero-facts.js'));
const V=require(path.join(ROOT,'js','vero-evidence.js'));
const ALL=JSON.parse(fs.readFileSync(path.join(ROOT,'data','products.json'),'utf8')); pcResolveSchedule(ALL);
const PUB=ALL.filter(p=>!p.disabled), RF=FACTS.build(PUB);
let priceReads=0; const FORBID=/^(srp|dp|dp_volume|special_dp|moq|priceSchedule|priceHistory)$/;
const PROXY=PUB.map(p=>new Proxy(p,{ get(t,k){ if(typeof k==='string' && FORBID.test(k)) priceReads++; return t[k]; } }));
const real=(q,ctx)=>{ const r=E.answer(PUB,q,{}); return V.classify(q,{ products:PROXY, facts:RF, plan:r.plan, ctx }); };
const outcome=d=>d.route==='CLARIFY'?'CLARIFY':(d.route==='EVIDENCE'?'UNKNOWN':(d.reason==='local_confirmed'?'YES':(d.reason==='local_contradicted'?'NO':'OTHER:'+d.reason)));

/* evidence quotes (catalogue text, data/products.json) */
const Q={
  CM843:'85489 CM843: "Extended Display Limited on macOS" / "For macOS, the external monitors will display identical content"',
  CM639_35625:'35625 CM639: "only Windows systems support MST-Multi Stream Transport for triple display, while Mac systems are limited to SST"',
  CM639_15534:'15534 CM639: "When using two HDMI ports at the same time, the product supports dual 4K@30Hz output (Windows)" / "MacBooks only support mirroring mode"',
  CM639_45380:'45380 CM639: "MST for Windows" (no statement for macOS)',
  MM121:'30841 MM121 Type C To HDMI Cable: one HDMI output, "Support mirror mode and extended mode" (one display)',
  DP112:'60842 DP112 DP 1.4 cable: one display link, "Support mirror mode and extend mode"',
  X755:'25870 X755: "USB-C1 Output … 65W Max", "USB-C2 Output … 65W Max", "USB-A output … 22.5W Max", "Total Output: 65W Max"',
  EC703:'35024 EC703: "USB-C1 Output … 30W Max", "USB-C2 Output … 65W Max", "Total Output: 75W Max"',
  PB723:'55365B PB723: "USB-C1 Cable Output … 100W Max", "USB-C2 Output … 30W Max", "(USB-C1+USB-C2): 130W"',
  X772:'95405B X772: "USB-C1/C2 Output … 100.0W Max", "USB-C3 Output … 65.0W Max"',
  X773:'65619B X773: "USB-C1/C2/C3 Output … 100.0W Max", "USB-C 4 Output … 30.0W Max"',
  PB770:'25286 PB770: largest single port "USB-C1 Output … 140W Max"; 300W only as "Multi-port Output (USB-C1+USB-C2+USB-C3)"',
  CD271:'40913 CD271: largest single port "USB-C1/C2 Output … 100W Max"; "Total Output Power: 200W Max"',
  CD333:'90872B CD333: largest single port "USB-C1 Output … 140.0W Max"; "Total Output Power: 300W Max"',
  PB552:'55995B PB552: largest single port "USB-C1 Cable Output … 140W Max"; 165W only as "Multi-port Output"',
  PB726:'95670B PB726: single ports "100W Max"; 165W only as "Multi-port Output (USB-C Cable+USB-C)"',
  MD112:'40360 MD112 Mini DP to HDMI adapter: one HDMI output, "Support 4K@30Hz" (one display)',
  CM843_8K:'85489 CM843: "Single 8K, Triple 4K Display Versatility" (8K on one monitor only)'
};
/* [family, question, context subject codes or null, expect, residual (or null), rationale] */
const CASES=[
  /* M1 display mode (16): the YES came from os.support alone; the mode was never represented */
  ['M1','does 85489 support extended on mac?',null,'UNKNOWN',null,Q.CM843+'; the display count is not stated (one external display is not covered by the multi-monitor limit)'],
  ['M1','does 85489 support expand mode on mac?',null,'UNKNOWN',null,Q.CM843+'; count not stated'],
  ['M1','does 85489 support expanded display on mac?',null,'UNKNOWN',null,Q.CM843+'; one display: the catalogue states no single-display mode on macOS'],
  ['M1','does 85489 support extending on mac?',null,'UNKNOWN',null,Q.CM843+'; count not stated'],
  ['M1','does 85489 support extension mode on mac?',null,'UNKNOWN',null,Q.CM843+'; count not stated'],
  ['M1','does 85489 support separate screens on mac?',null,'NO','UNKNOWN',Q.CM843+'; separate (different-content) screens on macOS are excluded'],
  ['M1','does 85489 support independent displays on mac?',null,'NO','UNKNOWN',Q.CM843+'; independent displays on macOS are excluded'],
  ['M1','supported ba ang extended sa mac ng 85489?',null,'UNKNOWN',null,Q.CM843+'; Taglish, count not stated'],
  ['M1','does 35625 support extended on mac?',null,'UNKNOWN',null,Q.CM639_35625+'; SST on Mac proves no multi-display extended desktop; one display is not stated'],
  ['M1','does 15534 support extended on macOS?',null,'NO','UNKNOWN',Q.CM639_15534+'; mirror only on MacBooks'],
  ['M1','does it support extended on mac?',['15534'],'NO','UNKNOWN',Q.CM639_15534+'; context subject 15534'],
  ['M1','does it do extended on mac?',['35625'],'UNKNOWN',null,Q.CM639_35625+'; context subject 35625'],
  ['M1','does it do extended on mac?',['85489'],'UNKNOWN',null,Q.CM843+'; context subject 85489'],
  ['M1','does 85489 support different displays on mac?',null,'NO','UNKNOWN',Q.CM843+'; different content on several displays is excluded on macOS'],
  ['M1','does 35625 support different screens on macOS?',null,'UNKNOWN',null,Q.CM639_35625+'; several different screens on Mac: SST-limited (UNKNOWN is exact; Phase 1 corrective: a NO is no longer accepted as a residual)'],
  ['M1','kaya ba ng 35625 ang magkaibang display sa mac?',null,'UNKNOWN',null,Q.CM639_35625+'; Taglish "different displays" (UNKNOWN is exact; no NO residual)'],
  /* M1 plural (5, round-5 regression QA-F1): a plural display noun read as ONE display */
  ['M1n','does 30841 support multiple extended monitors?',null,'NO','UNKNOWN',Q.MM121+'; several monitors need several outputs'],
  ['M1n','does 30841 support extended monitors?',null,'UNKNOWN',null,Q.MM121+'; plural without a count: one extended monitor YES, several NO -> ambiguous'],
  ['M1n','does 60842 support extended screens?',null,'UNKNOWN',null,Q.DP112+'; plural without a count -> ambiguous'],
  ['M1n','pwede ba mag extend sa maraming monitor ang 30841?',null,'NO','UNKNOWN',Q.MM121+'; Taglish "many monitors"'],
  ['M1n','does 30841 support mirrored displays?',null,'UNKNOWN',null,Q.MM121+'; mirror mode is stated for one display; several mirrored external displays are not'],
  /* M2 MST (7): generic OS support or an unscoped MST claim proved MST for a platform */
  ['M2','does 35625 support multi-stream transport on mac?',null,'NO','UNKNOWN',Q.CM639_35625],
  ['M2','does 35625 support multi stream on mac?',null,'NO','UNKNOWN',Q.CM639_35625],
  ['M2','does 45380 support multi-stream transport on mac?',null,'UNKNOWN',null,Q.CM639_45380],
  ['M2','does 35625 support MST on my iPad Pro?',null,'NO','UNKNOWN',Q.CM639_35625+'; iPadOS is not Windows'],
  ['M2','does 35625 support MST on my iPad?',null,'NO','UNKNOWN',Q.CM639_35625+'; iPadOS is not Windows'],
  ['M2','does 35625 support MST with Samsung DeX?',null,'NO','UNKNOWN',Q.CM639_35625+'; DeX (Android) is not Windows'],
  ['M2','does 35625 support MST on Linux and Windows?',null,'NO','UNKNOWN',Q.CM639_35625+'; Linux is excluded, so the conjunction is NO'],
  /* M3 simultaneous outputs (8): a single-display 4K60 spec proved a simultaneous setup */
  ['M3','does 15534 support 4K60 on each HDMI port at the same time on windows?',null,'NO','UNKNOWN',Q.CM639_15534],
  ['M3','does 15534 support 4K60 on each HDMI port simultaneously on windows?',null,'NO','UNKNOWN',Q.CM639_15534],
  ['M3','does 15534 support 4K60 on HDMI 1 and HDMI 2 on windows?',null,'UNKNOWN',null,Q.CM639_15534+'; no simultaneity word: each port alone does 4K60, both together do 4K30 -> ambiguous'],
  ['M3','does 15534 support 4K60 on HDMI 1 and HDMI 2 at the same time on windows?',null,'NO','UNKNOWN',Q.CM639_15534],
  ['M3','does 15534 support 4K60 on HDMI when both are used on windows?',null,'NO','UNKNOWN',Q.CM639_15534],
  ['M3','does 15534 support 4K60 sa parehong HDMI sa windows?',null,'NO','UNKNOWN',Q.CM639_15534+'; Taglish "on both HDMI"'],
  ['M3','kaya ba 4K60 sa parehong HDMI port ng 15534 sa windows?',null,'NO','UNKNOWN',Q.CM639_15534+'; Taglish "on both HDMI ports"'],
  ['M3','does 15534 do 4K60 on HDMI and HDMI at the same time on windows?',null,'NO','UNKNOWN',Q.CM639_15534],
  /* M4 per-port power (23): the total (or an unnumbered / wrong port clause) proved a per-port or simultaneous wattage */
  ['M4','does X755 output 65W on the A port?',null,'NO','UNKNOWN',Q.X755+'; the A port is 22.5W'],
  ['M4','does X755 output 65W on both USB-C ports?',null,'UNKNOWN',null,Q.X755+'; each port alone 65W, both together share 65W -> ambiguous'],
  ['M4','does X755 output 65W on each USB-C port at the same time?',null,'NO','UNKNOWN',Q.X755+'; 2 x 65W > 65W total'],
  ['M4','does X755 output 65W on two ports at once?',null,'UNKNOWN',null,Q.X755+'; 65W combined YES, 65W each NO -> ambiguous'],
  ['M4','does X755 output 65W on all ports?',null,'UNKNOWN',null,Q.X755+'; combined YES, each NO (USB-A 22.5W) -> ambiguous'],
  ['M4','can X755 charge two laptops at 65W each?',null,'NO','UNKNOWN',Q.X755+'; 2 x 65W > 65W total'],
  ['M4','does X755 support 65W on both USB-C ports at the same time?',null,'NO','UNKNOWN',Q.X755+'; 2 x 65W > 65W total'],
  ['M4','can X755 do 65W on each USB-C port simultaneously?',null,'NO','UNKNOWN',Q.X755+'; 2 x 65W > 65W total'],
  ['M4','does 35024 support 65W on both USB-C ports?',null,'NO','UNKNOWN',Q.EC703+'; USB-C1 is 30W'],
  ['M4','kaya ba ng 35024 ang 65W sa dalawang USB-C sabay?',null,'NO','UNKNOWN',Q.EC703+'; USB-C1 is 30W'],
  ['M4','does 55365B output 100W on USB-C2?',null,'NO','UNKNOWN',Q.PB723],
  ['M4','does 55365B output 100W on the USB-C2 port?',null,'NO','UNKNOWN',Q.PB723],
  ['M4','does 55365B output 100W on the second USB-C port?',null,'NO','UNKNOWN',Q.PB723+'; the second USB-C port = USB-C2'],
  ['M4','does 95405B output 100W on USB-C3?',null,'NO','UNKNOWN',Q.X772],
  ['M4','does 65619B output 100W on USB-C4?',null,'NO','UNKNOWN',Q.X773],
  ['M4','does 25286 output 300W on a single port?',null,'NO','UNKNOWN',Q.PB770],
  ['M4','does 25286 output 300W per port?',null,'NO','UNKNOWN',Q.PB770],
  ['M4','does 40913 output 200W on a single port?',null,'NO','UNKNOWN',Q.CD271],
  ['M4','does 90872B output 300W on a single port?',null,'NO','UNKNOWN',Q.CD333],
  ['M4','does 55995B output 165W on one port?',null,'NO','UNKNOWN',Q.PB552],
  ['M4','does 95670B output 165W on a single port?',null,'NO','UNKNOWN',Q.PB726],
  ['M4','does 55365B output 130W on one port?',null,'NO','UNKNOWN',Q.PB723+'; 130W only as USB-C1+USB-C2'],
  ['M4','kaya ba ng 25286 ang 300W sa isang port?',null,'NO','UNKNOWN',Q.PB770+'; Taglish "one port"'],
  /* context (7, round-5 regression VERO-F5): a class / indefinite / section-only / partial reference kept the old subject */
  ['CTX','how about a hub, 4K ba?',['85489'],'CLARIFY',null,'indefinite "a hub" is a class reference (owner decision 4, 2026-10-13)'],
  ['CTX','how about hubs, 4K ba?',['85489'],'CLARIFY',null,'bare plural "hubs" is a class reference (owner decision 4)'],
  ['CTX','e yung hub, 4K ba?',['85489'],'CLARIFY',null,'definite "yung hub": "hub" is only CM843\'s section label ("Docking and Hub"), not its type (Docking Station)'],
  ['CTX','sa hub, 4K ba?',['85489'],'CLARIFY',null,'"sa hub": section-label-only match (owner decision 4)'],
  ['CTX','how about chargers, PD 3.0 ba?',['25870'],'CLARIFY',null,'bare plural "chargers" is a class reference (owner decision 4)'],
  ['CTX','how about a 65W charger, PD 3.0 ba?',['25870'],'CLARIFY',null,'indefinite "a 65W charger" is a class reference'],
  ['CTX','how about the usb-c charger, PD 3.0 ba?',['25870'],'CLARIFY',null,'X755 is a USB-A + 2xUSB-C charger: "the USB-C charger" names one of its output connectors, not its type -> ambiguous']
];
/* Phase 1 reviewer failures (2026-10-13 VERO + QA reviews of the frozen Phase 1 tree 7380059c...; owner-approved corrective round):
   VERO-F1 single-device wattage read from the total, VERO-F2 Taglish indefinite "isang", QA-F1 paraphrases outside the Phase 1
   cue lexicon (single port / single device / two devices; display-mode paraphrases answered from os.support alone).
   Same columns and rules as CASES. */
const CASES_P1=[
  ['PF1','can 25286 charge my laptop at 300W?',null,'NO','UNKNOWN',Q.PB770+'; one laptop gets one port: 140W max'],
  ['PF1','can 90872B charge my laptop at 300W?',null,'NO','UNKNOWN',Q.CD333],
  ['PF1','can 40913 charge my MacBook Pro at 200W?',null,'NO','UNKNOWN',Q.CD271],
  ['PF1','can 55995B charge my laptop at 165W?',null,'NO','UNKNOWN',Q.PB552],
  ['PF1','can 95670B charge my laptop at 165W?',null,'NO','UNKNOWN',Q.PB726],
  ['PF1','can 55365B charge my laptop at 130W?',null,'NO','UNKNOWN',Q.PB723],
  ['PF1','can 35024 charge my laptop at 75W?',null,'NO','UNKNOWN',Q.EC703+'; one device gets one port: 65W max'],
  ['PF2','sa isang charger naman, PD 3.0 ba?',['25870'],'CLARIFY',null,'Taglish indefinite "isang charger" is a class reference: the previous X755 is not reused'],
  ['PF2','sa isang dock naman, 4K ba?',['85489'],'CLARIFY',null,'Taglish indefinite "isang dock" (CM843 is a dock: the type fits, the reference is still indefinite)'],
  ['QF1','kaya ba ng 25286 ang 300W sa iisang port?',null,'NO','UNKNOWN',Q.PB770+'; Taglish "iisang port" = one port'],
  ['QF1','kaya ba ng 25286 ang 300W sa isa lang na port?',null,'NO','UNKNOWN',Q.PB770+'; Taglish "isa lang na port" = only one port'],
  ['QF1','does 25286 output 300W to one laptop?',null,'NO','UNKNOWN',Q.PB770],
  ['QF1','does 25286 output 300W to a single device?',null,'NO','UNKNOWN',Q.PB770],
  ['QF1','can X755 charge a laptop and a phone at 65W?',null,'UNKNOWN',null,Q.X755+'; 65W shared by both YES, 65W each NO -> ambiguous'],
  ['QF1','does 85489 support side by side screens on mac?',null,'NO','UNKNOWN',Q.CM843+'; several screens with different content on macOS are excluded'],
  ['QF1','does 85489 support spanning on mac?',null,'UNKNOWN',null,Q.CM843+'; a spanned desktop, display count not stated (as "extended on mac")'],
  ['QF1','does 15534 support a wide desktop across monitors on mac?',null,'NO','UNKNOWN',Q.CM639_15534],
  ['QF1','does 35625 support hiwalay na screen sa mac?',null,'UNKNOWN',null,Q.CM639_35625+'; Taglish "separate screen" on Mac: SST-limited'],
  ['QF1','does 85489 support unique content per monitor on mac?',null,'NO','UNKNOWN',Q.CM843],
  ['QF1','does 85489 support non-identical displays on mac?',null,'NO','UNKNOWN',Q.CM843]
];
/* Regression stabilization: the corrective round's kind-plural wrong YES (VERO-F1 / QA-R1). Phase 1 answered all of them UNKNOWN */
const CASES_PC=[
  ['PCK','does 30841 support both 4K monitors?',null,'NO','UNKNOWN',Q.MM121+'; "both" = two monitors at once'],
  ['PCK','does 40360 support both 4K monitors?',null,'NO','UNKNOWN',Q.MD112+'; "both" = two monitors at once'],
  ['PCK','does 15534 support both 4K60 monitors on windows?',null,'NO','UNKNOWN',Q.CM639_15534+'; two at once = 4K@30, not 4K60'],
  ['PCK','does 85489 support both 8K monitors?',null,'NO','UNKNOWN',Q.CM843_8K],
  ['PCK','does 85489 support both 4K monitors on mac?',null,'UNKNOWN',null,Q.CM843+'; two monitors on macOS only mirrored -> depends on the mode wanted'],
  ['PCK','does 30841 support my 4K monitors?',null,'UNKNOWN',null,Q.MM121+'; "my monitors" may mean several at once (no) or each in turn (yes)'],
  ['PCK','does 30841 support all 4K monitors?',null,'UNKNOWN',null,Q.MM121+'; every 4K monitor in turn (yes) or all at once (no) -> ambiguous'],
  ['PCK','can 30841 do mirroring to 4K TVs?',null,'UNKNOWN',null,Q.MM121+'; mirroring to one TV yes, to several at once no -> ambiguous'],
  ['PCK','kaya ba ng 30841 ang pareho kong 4K monitors?',null,'NO','UNKNOWN',Q.MM121+'; Taglish "pareho kong" = both of my monitors'],
  ['PCK','kaya ba ng 30841 ang lahat ng 4K monitors?',null,'UNKNOWN',null,Q.MM121+'; Taglish "lahat ng" = all (at once or each) -> ambiguous'],
  ['PCK','does 30841 support 4K monitors and 1080p monitors?',null,'UNKNOWN',null,Q.MM121+'; conjoined displays: at once (no) or each (yes) -> ambiguous']
];

chk('R0 the regression file holds the 66 reviewer-reported failures (16 M1, 5 M1 plural, 7 M2, 8 M3, 23 M4, 7 context)',
  CASES.length===66 && ['M1','M1n','M2','M3','M4','CTX'].map(f=>CASES.filter(c=>c[0]===f).length).join()==='16,5,7,8,23,7');
chk('R0c the Phase 1 reviewer failures: 7 single-device wattage (VERO-F1), 2 Taglish "isang" (VERO-F2), 11 cue-lexicon paraphrases (QA-F1); same rules as R0b',
  CASES_P1.length===20 && ['PF1','PF2','QF1'].map(f=>CASES_P1.filter(c=>c[0]===f).length).join()==='7,2,11' &&
  CASES_P1.every(c=>['NO','UNKNOWN','CLARIFY'].includes(c[3]) && (c[4]===null || c[4]==='UNKNOWN') && c[4]!==c[3] && typeof c[5]==='string' && c[5].length>10));
chk('R0d the stabilization cases: 11 quantified / conjoined kind plurals (VERO-F1 / QA-R1); same rules as R0b',
  CASES_PC.length===11 && CASES_PC.every(c=>c[0]==='PCK' && ['NO','UNKNOWN','CLARIFY'].includes(c[3]) && (c[4]===null || c[4]==='UNKNOWN') && c[4]!==c[3] && typeof c[5]==='string' && c[5].length>10));
chk('R0b every case has an expected outcome from the catalogue and a rationale; YES is never an accepted outcome; a residual is only the fail-closed UNKNOWN',
  CASES.every(c=>['NO','UNKNOWN','CLARIFY'].includes(c[3]) && (c[4]===null || c[4]==='UNKNOWN') && c[4]!==c[3] && typeof c[5]==='string' && c[5].length>10));   /* Phase 1 corrective: a residual is fail-closed UNKNOWN only */
const tally={ exact:0, residual:0, wrong:0 }, byFam={}, tallyP1={ exact:0, residual:0, wrong:0 }, tallyPC={ exact:0, residual:0, wrong:0 };
CASES.concat(CASES_P1,CASES_PC).forEach(([fam,q,ctx,expect,residual,why],ci)=>{
  const d=real(q,ctx?{ subjects:ctx.map(x=>'ugreen:'+x) }:null), o=outcome(d);
  /* context family: the old subject must never be reused; a pronoun follow-up (M1 with a context) must bind that subject */
  const old=ctx?'ugreen:'+ctx[0]:null;
  const subjOk=!old || (fam==='CTX' || fam==='PF2'?(!d.subjects.includes(old) && !(d.nextCtx && d.nextCtx.subjects.includes(old))):d.subjects.join()===old);
  const kind=o===expect && subjOk?'exact':(o===residual && subjOk?'residual':'wrong');
  (ci<CASES.length?tally:(ci<CASES.length+CASES_P1.length?tallyP1:tallyPC))[kind]++; byFam[fam]=byFam[fam]||{ exact:0, residual:0, wrong:0 }; byFam[fam][kind]++;
  chk('R1 ['+fam+'] "'+q+'"'+(ctx?' (context '+ctx.join()+')':'')+' -> '+o+' (expected '+expect+(residual?', fail-closed residual '+residual:'')+'): '+why, kind!=='wrong', { outcome:o, route:d.route+'/'+d.reason, subjects:d.subjects, next:d.nextCtx });
});
/* the context cases also as real conversations (the reviewers' repro: the product turn, then the follow-up) */
[['CM843','how about a hub, 4K ba?'],['CM843','how about hubs, 4K ba?'],['CM843','e yung hub, 4K ba?'],['CM843','sa hub, 4K ba?'],['X755','how about chargers, PD 3.0 ba?'],['X755','how about a 65W charger, PD 3.0 ba?'],['X755','how about the usb-c charger, PD 3.0 ba?'],
 ['X755','sa isang charger naman, PD 3.0 ba?'],['CM843','sa isang dock naman, 4K ba?']].forEach(([a,b])=>{
  const x=real(a), y=real(b,x.nextCtx), z=real('is it 4K?',y.nextCtx);
  chk('R2 real chain "'+a+'" -> "'+b+'" -> "is it 4K?": CLARIFY, the old subject is never reused', x.nextCtx && y.route==='CLARIFY' && !y.subjects.length && y.nextCtx===null && z.route==='CLARIFY' && !z.subjects.length, [y.route+'/'+y.reason,y.nextCtx,z.route]);
});
/* every EVIDENCE decision carries a valid request */
CASES.concat(CASES_P1,CASES_PC).forEach(([fam,q,ctx])=>{ const d=real(q,ctx?{ subjects:ctx.map(x=>'ugreen:'+x) }:null); if(d.route==='EVIDENCE') chk('R3 valid EvidenceRequest for "'+q+'"', V.validateRequest(d.request).ok, V.validateRequest(d.request).errors); });
chk('R4 determinism: two runs give identical decisions', CASES.concat(CASES_P1,CASES_PC).every(([f,q,ctx])=>{ const c=ctx?{ subjects:ctx.map(x=>'ugreen:'+x) }:null; return JSON.stringify(real(q,c))===JSON.stringify(real(q,c)); }));
chk('R5 no network call, no price-field read', netCalls===0 && priceReads===0, { netCalls, priceReads });

console.log('Phase 1 reviewer failures: exact '+tallyP1.exact+', fail-closed residual '+tallyP1.residual+', wrong '+tallyP1.wrong+' | '+['PF1','PF2','QF1'].map(f=>f+' '+byFam[f].exact+'/'+byFam[f].residual+'/'+byFam[f].wrong).join(', '));
console.log('stabilization cases (kind plurals): exact '+tallyPC.exact+', fail-closed residual '+tallyPC.residual+', wrong '+tallyPC.wrong);
console.log('reviewer regressions: exact '+tally.exact+', fail-closed residual '+tally.residual+', wrong '+tally.wrong+' | '+Object.keys(byFam).filter(f=>!/^(?:PF|QF|PC)/.test(f)).map(f=>f+' '+byFam[f].exact+'/'+byFam[f].residual+'/'+byFam[f].wrong).join(', ')+' (exact/residual/wrong)');
console.log('\nvero-evidence regressions: '+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
