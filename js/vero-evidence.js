/* UNO Evidence & Retrieval Layer R1 — evidence contracts + missing-evidence classifier + LLM-suppression policy
   (SHADOW ONLY, DORMANT). Internal engineering namespace stays VERO (brand decision 2026-10-11): global VeroEvidence.
   Not loaded by index.html or by any live runtime file; nothing calls it in production (asset gate G23 enforces that).

   Purpose (architecture approved 2026-10-12, Option C "evidence store first"): decide, without any LLM or network,
     1. which exact UGREEN product (item code) a question is about,
     2. whether the local catalogue facts already answer it (CONFIRMED / CONTRADICTED -> LOCAL),
     3. which evidence is missing, as a closed class + attribute (-> EVIDENCE, with an EvidenceRequest),
     4. the future route (LOCAL | EVIDENCE | CLARIFY), and
     5. whether a future answer could avoid an LLM entirely (llmNeeded).
   It also freezes the v1 contracts later checkpoints build on: EvidenceRequest, EvidenceRow, Verdict.

   Pure and deterministic: no DOM, no network, no clock, no storage, no writes to any global except VeroEvidence.
   Reads products read-only and ONLY these fields: item_code, model, upc, product_name, short_desc, features, description,
   length, color (never prices, MOQ, dealer or stock data). Reads the facts graph (VeroFacts.build) read-only.
   Subjects come ONLY from the question text (item code > UPC > exact model + variant) or from the evidence layer's own
   previous turn (opts.ctx.subjects); planner candidates are never used as evidence subjects. A product name alone
   never resolves a subject. opts.plan is read for the planner's route / intent only (the shadow "no evidence ask" path).

   API
     classify(question, opts) -> Decision
       opts: { products (published), facts (VeroFacts.build(products)), plan? (VeroPlan output), ctx? { subjects:[key] } }
       Decision: { v, route, reason, class, subjects:[key], via:{key:via}, entities:[key], needs:[Need], request, llmNeeded,
                   llmRule, llmIfNoEvidence:false, flags, clarify, conflict, nextCtx }
       nextCtx = the ONLY context the next turn may use: { subjects:[key] } or null. A turn that names a different product it
       cannot resolve (name / type only, or an ambiguous model / UPC) invalidates the previous focus (null); a clarification
       about the same subject keeps it.
       Need: { s, cls, a, e?, v?, local: CONFIRMED | CONTRADICTED | UNKNOWN | CONTRADICTED_INTERNAL }
     resolveSubjects(question, opts) -> { status: resolved|ambiguous|none, subjects:[{key,code,via}], ambiguous:[{via,raw,codes}] }
     detectEntities(question) -> [{ kind, key, raw, exact }]
     validateRequest(req) / validateRow(row) / expectedVerdict(basis) / checkVerdict(verdict) -> { ok, errors[] } (or state)
     llmPolicy(decision) -> { llmNeeded, rule }
     capacityStatements(product) -> { state, values:[TB], derived:[TB], stated:[TB], quotes:[] }
     wattStatements(product) -> { state, values:[W], quotes:[] }        (total-output scope only; per-port / input lines skipped)
     displayCount(product) -> N | null                                  (max simultaneous EXTERNAL displays explicitly stated; never port
                                                                       counts; a host-inclusive total counts the host out)
     negativeScopes(product) -> [{ kind, key, text, ... }]             (explicit, scoped catalogue negatives; OS entries carry fam +
                                                                       version range, device entries qualifier alternatives)
     contextSubjects(ctx, opts) -> { subjects:[key], rejected:N, stale:[key], ambiguous:[key] }
                                   (format filter + re-resolution of the previous turn's subjects against the current catalogue)
     Every function is total (second fix round P8): malformed / null / prototype-less input never throws and fails closed;
     third round G1: even objects whose property access throws (Proxy traps, getters) get the documented fail-closed value.
     Third round: a subject change is read from catalogue vocabulary + phrase position (no product-noun list); a video request is
     parsed into display count + per-display modes; a refresh maximum limits only its own resolution tier; OS-scoped display rules
     (Windows-only modes, macOS mirror-only) override the generic ones for a question scoped to that OS.
     Fourth round: two internal intermediate representations make the repeated failure areas explicit -- a TopicMention per turn
     (current-subject reference / new unresolved product / generic device / no product; a discourse pivot "sa X naman", "for the
     X", "how about (for) X" puts its phrase in the topic slot, and the phrase head must name the subject's type) and a
     DisplayRequirement per question (per-display { r, hz, c }, total external displays, simultaneous, mode, host screen), matched
     component by component (count, mode, resolution, OS) against product statements and display rules (mirror-only, SST-only,
     OS-only, OS-scoped modes; host-inclusive marketing totals normalised to external displays). A quantified context reference
     ("both", "pareho") must account for every referenced subject or it clarifies. Catalogue caches are keyed by a content
     signature, not by array identity. External contracts (Decision, EvidenceRequest, EvidenceRow, Verdict) are unchanged.
     Scope rules (second fix round): wattage is compared only within its role (total / port / upstream / input / wireless);
     a video ask is a composite { r, hz, n?, port?, dir? } matched against same-direction, same-port statements; OS asks
     compare family + version ranges; a new unresolved product noun ends the previous subject focus.
     CLASSES, ROUTES, LOCAL_STATES, ROW_STATES, VERDICTS, ATTRS, OPS, UNITS, TIERS, REASONS, LLM_RULES, version */
(function(root){
  'use strict';
  var VERSION='r1';
  function deepFreeze(o){ Object.getOwnPropertyNames(o).forEach(function(k){ var v=o[k]; if(v && typeof v==='object' && !Object.isFrozen(v)) deepFreeze(v); }); return Object.freeze(o); }
  function has(a,x){ return Array.isArray(a) && a.indexOf(x)>=0; }
  function own(o,k){ return o!=null && typeof k==='string' && Object.prototype.hasOwnProperty.call(o,k); }
  function dict(){ return Object.create(null); }
  function uniq(a){ var o=[]; arr(a).forEach(function(x){ if(o.indexOf(x)<0) o.push(x); }); return o; }
  /* P8: total primitives. Every helper reads its inputs only through these, so null / undefined / primitives / arrays /
     prototype-less objects / missing fields give a deterministic fail-closed result instead of a throw. */
  function isObj(x){ return x!==null && typeof x==='object' && !Array.isArray(x); }
  function arr(x){ return Array.isArray(x)?x:[]; }
  function str(x){ return typeof x==='string'?x:((typeof x==='number' && isFinite(x))?String(x):''); }
  function field(o,k){ return isObj(o) && own(o,k)?o[k]:undefined; }

  /* ============================== 1. closed contracts ============================== */
  var CLASSES=['compatibility','external_device_spec','protocol_support','standard_version','performance_limit','official_compat_list',
    'manual_spec_detail','os_platform_support','charging_protocol','display_video','installation_guidance','lifecycle_eol'];
  var CLASS_PRIORITY=['compatibility','official_compat_list','external_device_spec','charging_protocol','display_video','standard_version',
    'protocol_support','os_platform_support','performance_limit','manual_spec_detail','installation_guidance','lifecycle_eol'];
  var ROUTES=['LOCAL','EVIDENCE','CLARIFY'];
  /* local state of one need, from the local catalogue only. CONTRADICTED = a stated value fails the request (an answer: "no").
     CONTRADICTED_INTERNAL = the catalogue states conflicting values for the same attribute (needs external evidence). */
  var LOCAL_STATES=['CONFIRMED','CONTRADICTED','UNKNOWN','CONTRADICTED_INTERNAL'];
  var ROW_STATES=['CONFIRMED','INFERRED','CONTRADICTED'];
  var VERDICTS=['OFFICIALLY_VERIFIED','COMPATIBLE_BY_SPEC','PROBABLY_COMPATIBLE_NEEDS_VERIFICATION','INCOMPATIBLE','UNKNOWN'];
  var OPS=['eq','min','max','in','supports','lists','notlists'];
  var UNITS=['TB','GB','W','V','A','Hz','Gbps','mm','in','m'];
  /* source tier of an evidence row (lower = more authoritative). 7 = secondary: never final evidence (INFERRED only). */
  var TIERS={ 0:'ugreen_pricelist', 1:'ugreen_product_page', 2:'ugreen_support_manual', 3:'ugreen_compat_list', 4:'manufacturer_official',
    5:'platform_official', 6:'standards_body', 7:'secondary' };
  /* attribute registry (closed). kind: num | str | key | list | mode. No commercial attribute exists (price / stock / dealer). */
  var ATTRS={
    'compat.with':{ cls:['compatibility'], ops:['supports'], kind:'key' },
    'compat.list':{ cls:['official_compat_list'], ops:['lists','notlists'], kind:'key' },
    'device.interface':{ cls:['external_device_spec'], ops:['eq','in'], kind:'str' },
    'device.formFactor':{ cls:['external_device_spec'], ops:['eq','in'], kind:'str' },
    'device.capacity':{ cls:['external_device_spec'], ops:['eq'], kind:'num', units:['TB','GB'] },
    'device.recording':{ cls:['external_device_spec'], ops:['eq'], kind:'str' },
    'device.ports':{ cls:['external_device_spec'], ops:['eq','in'], kind:'list' },
    'device.chargeInput':{ cls:['external_device_spec'], ops:['eq','min','max'], kind:'num', units:['W'] },
    'device.video':{ cls:['external_device_spec'], ops:['max','supports'], kind:'mode' },
    'host.driveInterface':{ cls:['compatibility','manual_spec_detail'], ops:['in','eq'], kind:'list' },
    'host.driveFormFactor':{ cls:['compatibility','manual_spec_detail'], ops:['in','eq'], kind:'list' },
    'host.capacityMax':{ cls:['performance_limit','compatibility'], ops:['max'], kind:'num', units:['TB'] },
    'host.bays':{ cls:['performance_limit','manual_spec_detail'], ops:['eq'], kind:'num' },
    'os.support':{ cls:['os_platform_support'], ops:['supports'], kind:'key' },
    'os.driver':{ cls:['os_platform_support','installation_guidance'], ops:['eq'], kind:'str' },
    'protocol.support':{ cls:['protocol_support'], ops:['supports'], kind:'key' },
    'protocol.requirement':{ cls:['charging_protocol','protocol_support'], ops:['eq','min','in'], kind:'str' },
    'standard.version':{ cls:['standard_version'], ops:['supports','eq'], kind:'key' },
    'standard.spec':{ cls:['standard_version'], ops:['eq','min','max'], kind:'str' },
    'charge.protocol':{ cls:['charging_protocol'], ops:['supports'], kind:'key' },
    'charge.watts':{ cls:['performance_limit','charging_protocol'], ops:['max','eq','min'], kind:'num', units:['W'] },
    'video.mode':{ cls:['display_video'], ops:['supports','max'], kind:'mode' },
    'video.displays':{ cls:['display_video'], ops:['max','eq'], kind:'num' },
    'data.rate':{ cls:['performance_limit'], ops:['max','eq','min'], kind:'num', units:['Gbps'] },
    'manual.doc':{ cls:['manual_spec_detail'], ops:['eq'], kind:'str' },
    'install.guide':{ cls:['installation_guidance'], ops:['eq'], kind:'str' },
    'lifecycle.status':{ cls:['lifecycle_eol'], ops:['eq'], kind:'str', values:['active','eol','discontinued','unknown'] },
    'firmware.support':{ cls:['lifecycle_eol'], ops:['eq'], kind:'str' }
  };
  var REASONS=['local_confirmed','local_contradicted','local_plan','catalogue_judgement','commercial_local',
    'external_availability_unsupported','generic_device_class','unclassified_retained','needs_external_evidence','local_unknown','local_conflict',
    'no_exact_subject','ambiguous_model','ambiguous_upc','ambiguous_context','external_model_inexact','plan_clarify'];
  var LLM_RULES=['clarify','local_answer','commercial_local','catalogue_judgement_retained','deterministic_verdict','deterministic_threshold',
    'deterministic_comparison','deterministic_spec','link_or_status','explanation_after_evidence','unclassified_retained'];
  var VENDORS=['seagate','wd','toshiba','samsung','crucial','kingston','sandisk','apple','microsoft','google','sony','nintendo','valve',
    'lenovo','dell','hp','asus','xiaomi','huawei','oppo','vivo','realme','oneplus','lg','meta','asustor','synology'];
  var COMMERCIAL_RE=/price|srp|(^|[^a-z])dp([^a-z]|$)|dp_volume|special_dp|moq|stock|availab|dealer|discount|promo/i;

  /* ============================== 2. text helpers ============================== */
  function normText(s){
    return str(s).replace(/[\u00a0\u2000-\u200b\u3000]/g,' ').replace(/\uff1a/g,':').replace(/[\u2018\u2019\u2032]/g,"'")
      .replace(/[\u201c\u201d\u2033]/g,'"').replace(/\uff08/g,'(').replace(/\uff09/g,')').toLowerCase();
  }
  function textOf(p){ return normText(['product_name','short_desc','features','description'].map(function(k){ return str(field(p,k)); }).join(' \n ')); }
  function nameOf(p){ return normText(field(p,'product_name')); }
  /* clauses of a product text: bullets, lines, sentences (a period not inside a version / decimal number) */
  function clausesOf(t){ return str(t).split(/[\n;▪•]|\.(?!\d)\s*/).map(function(c){ return c.trim(); }).filter(Boolean); }
  function compact(w){ return String(w).replace(/[^a-z0-9]/g,''); }
  function words(qn){ return qn.match(/[a-z0-9]+(?:[-.][a-z0-9]+)*/g)||[]; }
  function slug(s){ return normText(s).replace(/\s+/g,'-').replace(/[^a-z0-9.-]/g,'').replace(/-+/g,'-').replace(/^-|-$/g,''); }

  /* ============================== 3. entity lexicon (closed, generic) ============================== */
  var DRIVE_MODELS=[                                                     /* exact third-party storage model numbers */
    { vendor:'seagate', re:/\b(st\d{3,5}[a-z]{2}\d{3,4}[a-z]?)\b/i },
    { vendor:'wd', re:/\b(wd\d{2,5}[a-z]{2,6}(?:-[a-z0-9]{2,6})?)\b/i },
    { vendor:'toshiba', re:/\b(hdw[a-z]\d{3,4}[a-z]{0,4}|mg\d{2}aca\d{2,3}[a-z]?)\b/i },
    { vendor:'samsung', re:/\b(mz-?[a-z0-9]{6,12})\b/i },
    { vendor:'crucial', re:/\b(ct\d{3,4}[a-z]\d{1,3}[a-z0-9]{2,10})\b/i },
    { vendor:'kingston', re:/\b(snv\d[a-z]?\d?s?\/?\d{3,4}g|sa400s37\/\d{3,4}g)\b/i } ];
  var DRIVE_FAMILIES=/\b(iron\s?wolf(?:\s?pro)?|barracuda|firecuda|skyhawk|exos|wd\s?(?:red|blue|black|green|purple|gold)(?:\s?(?:plus|pro))?|990\s?pro|980\s?pro|970\s?evo(?:\s?plus)?|870\s?evo|samsung\s?(?:ssd|evo)|crucial\s?(?:p3|p5|mx500)|kingston\s?(?:nv2|nv3|a400))\b/i;
  /* device lines. level: exact = one model / variant; family = generation known but variants differ (e.g. a MacBook chip without
     Air / Pro); generic = the line only ("my MacBook"). Only exact entities are fully specified external devices. */
  /* P9a/b generation qualifiers, parsed only where deterministic: a chip (M1-M5), an nth generation ("10th gen", "gen 10") or a
     model year ("2024 iPad Air", "iPad Air (2024)"). A sub-line + generation / year = one generation (exact for iPad; a MacBook
     year still spans chips and sizes = family); a bare iPad + nth generation = the base iPad of that generation (exact); a year or
     chip without the sub-line = family. Year tokens stay in the raw text so year-qualified catalogue negatives can match them. */
  var GEN_RE='(?:\\d{1,2}(?:st|nd|rd|th)?\\s?gen(?:eration)?|gen(?:eration)?\\s?\\d{1,2}|\\d{1,2}(?:st|nd|rd|th))';
  var DEVICES=[
    { vendor:'apple', line:'macbook', re:/\b(?:(20\d{2})\s+)?macbook(?:\s+(air|pro|neo))?(?:\s+(m[1-5])(?:\s*(pro|max|ultra))?)?(?:\s+(\d{2}))?(?:\s*\(?(20\d{2})\)?)?(?![a-z0-9])/i, level:function(m){ return m[3]?(m[2]?'exact':'family'):((m[1]||m[6])?'family':'generic'); } },
    { vendor:'apple', line:'macbook', re:/\b(m[1-5])(?:\s*(pro|max))?\s+macbook(?:\s+(air|pro|neo))?\b/i, level:function(m){ return m[3]?'exact':'family'; } },
    { vendor:'apple', line:'mac', re:/\b(imac|mac\s?mini|mac\s?studio|mac\s?pro)(?:\s+(m[1-5])(?:\s*(pro|max|ultra))?)?\b/i, level:function(m){ return m[2]?'exact':'generic'; } },
    { vendor:'apple', line:'iphone', re:/\biphone\s?(\d{1,2}|se|x[rs]?)(?:\s*(pro\s?max|pro|plus|max|mini|air|e))?\b/i, level:function(){ return 'exact'; } },
    { vendor:'apple', line:'iphone', re:/\biphone\b/i, level:function(){ return 'generic'; } },
    { vendor:'apple', line:'ipad', re:new RegExp('\\b(?:(20\\d{2})\\s+)?ipad(?:\\s+(air|pro|mini))?(?:\\s+(m[1-5]|'+GEN_RE+'|\\d{1,2}(?:\\.\\d)?))?(?:\\s*\\(?(20\\d{2})\\)?)?(?![a-z0-9])','i'),
      level:function(m){ var line=m[2], q=m[3], yr=m[1]||m[4];
        if(line) return (q||yr)?'exact':'generic';
        if(q) return /^m[1-5]$/i.test(q)?'family':'exact';
        return yr?'family':'generic'; } },
    { vendor:'samsung', line:'galaxy', re:/\b(?:samsung\s+)?galaxy\s+(s\d{1,2}|a\d{1,2}|z\s?(?:fold|flip)\s?\d{0,2}|note\s?\d{1,2}|tab\s?s\d{1,2})(?:\s*(ultra|plus|\+|fe))?\b/i, level:function(){ return 'exact'; } },
    { vendor:'samsung', line:'galaxy', re:/\bsamsung\s+(s\d{2}|a\d{2}|z\s?(?:fold|flip)\s?\d{1,2}|note\s?\d{1,2})(?:\s*(ultra|plus|\+|fe))?\b/i, level:function(){ return 'exact'; } },
    { vendor:'google', line:'pixel', re:/\bpixel\s?(\d{1,2})(?:\s*(a|pro\s?xl|pro|xl))?\b/i, level:function(){ return 'exact'; } },
    { vendor:'sony', line:'ps', re:/\b(ps[45]|playstation\s?[45])(?:\s*(pro|slim|digital))?\b/i, level:function(){ return 'exact'; } },
    { vendor:'microsoft', line:'xbox', re:/\bxbox\s+(series\s?[xs]|one\s?[xs]?)\b/i, level:function(){ return 'exact'; } },
    { vendor:'microsoft', line:'xbox', re:/\bxbox\b/i, level:function(){ return 'generic'; } },
    { vendor:'nintendo', line:'switch', re:/\bnintendo\s+switch(?:\s+(2|oled|lite))?\b|\bswitch\s+(2|oled)\b/i, level:function(){ return 'exact'; } },
    { vendor:'valve', line:'steam-deck', re:/\bsteam\s?deck(?:\s+(oled|lcd))?\b/i, level:function(){ return 'exact'; } },
    { vendor:'microsoft', line:'surface', re:/\bsurface\s+(pro|laptop|go)(?:\s+(\d{1,2}))?\b/i, level:function(m){ return m[2]?'exact':'generic'; } }
  ];
  var LEVEL_RANK={ generic:0, family:1, exact:2 };
  var DEVICE_CLASS_RE=/\b(laptop|notebook|phone|cellphone|cp|smartphone|tablet|monitor|tv|television|projector|desktop|pc|computer|console)\b/;
  var OS_LIST=[
    { key:'os:windows-11', re:/\bwindows\s?11\b|\bwin\s?11\b/ }, { key:'os:windows-10', re:/\bwindows\s?10\b|\bwin\s?10\b/ },
    { key:'os:windows-7', re:/\bwindows\s?7\b/ }, { key:'os:windows-rt', re:/\bwindows\s?rt\b/ }, { key:'os:windows', re:/\bwindows\b/ },
    { key:'os:macos', re:/\bmac\s?os\b|\bmacos\b|\bos\s?x\b|\bmac\b(?!\s?(?:mini|studio|pro|book))/ }, { key:'os:ipados', re:/\bipad\s?os\b/ }, { key:'os:ios', re:/\bios\s?\d{0,2}\b/ },
    { key:'os:android', re:/\bandroid\b/ }, { key:'os:chromeos', re:/\bchrome\s?os\b|\bchromebook\b/ },
    { key:'os:linux', re:/\blinux\b|\bubuntu\b/ } ];
  /* standards / interfaces (cls standard_version) and protocols (cls protocol_support); the text pattern is reused for the local check */
  var APPS=[{ key:'app:plex', re:/\bplex\b/ },{ key:'app:jellyfin', re:/\bjellyfin\b/ },{ key:'app:emby', re:/\bemby\b/ },{ key:'app:docker', re:/\bdocker\b/ },
    { key:'app:home-assistant', re:/\bhome\s?assistant\b/ },{ key:'app:immich', re:/\bimmich\b/ },{ key:'app:time-machine', re:/\btime\s?machine\b/ },{ key:'app:vm', re:/\bvirtual\s?machines?\b|\bvms?\b/ }];
  var STANDARDS=[
    { key:'std:thunderbolt-5', re:/\bthunderbolt\s?5\b|\btb\s?5\b/ }, { key:'std:thunderbolt-4', re:/\bthunderbolt\s?4\b|\btb\s?4\b/ },
    { key:'std:thunderbolt-3', re:/\bthunderbolt\s?3\b|\btb\s?3\b/ }, { key:'std:usb4-v2', re:/\busb\s?4\s?(?:v2|version\s?2)/ },
    { key:'std:usb4', re:/\busb\s?4\b/ }, { key:'std:usb-3.2-gen2x2', re:/\busb\s?3\.2\s?gen\s?2\s?x\s?2\b|\b20\s?gbps\b/ },
    { key:'std:usb-3.2-gen2', re:/\busb\s?3\.2\s?gen\s?2\b|\busb\s?3\.1\s?gen\s?2\b/ }, { key:'std:usb-3.2-gen1', re:/\busb\s?3\.2\s?gen\s?1\b|\busb\s?3\.1\s?gen\s?1\b/ },
    { key:'std:hdmi-2.1', re:/\bhdmi\s?2\.1\b/ }, { key:'std:hdmi-2.0', re:/\bhdmi\s?2\.0\b/ }, { key:'std:hdmi-1.4', re:/\bhdmi\s?1\.4\b/ },
    { key:'std:dp-2.1', re:/\b(?:dp|displayport)\s?2\.[01]\b/ }, { key:'std:dp-1.4', re:/\b(?:dp|displayport)\s?1\.4\b/ },
    { key:'std:pcie-4', re:/\bpcie?\s?(?:4\.0|gen\s?4)\b/ }, { key:'std:pcie-3', re:/\bpcie?\s?(?:3\.0|gen\s?3)\b/ } ];
  var PROTOCOLS=[
    { key:'std:dp-alt-mode', re:/\bdp\s?alt(?:ernate)?(?:\s?mode)?\b|\balt\s?mode\b/ }, { key:'std:mst', re:/\bmst\b/ },
    { key:'std:displaylink', re:/\bdisplaylink\b/ }, { key:'std:hdcp', re:/\bhdcp\b/ }, { key:'std:uasp', re:/\buasp\b/ },
    { key:'std:trim', re:/\btrim\b/ }, { key:'std:nvme', re:/\bnvme\b/ }, { key:'std:sata', re:/\bsata\b/ },
    { key:'std:vrr', re:/\bvrr\b/ }, { key:'std:hdr', re:/\bhdr\b/ } ];
  var CHARGING=[
    { key:'std:samsung-sfc-2', re:/\bsuper\s?fast\s?charg(?:e|ing)\s?2(?:\.0)?\b|\bsfc\s?2(?:\.0)?\b/, vendorReq:true },
    { key:'std:samsung-sfc', re:/\bsuper\s?fast\s?charg(?:e|ing)\b|\bsfc\b/, vendorReq:true },
    { key:'std:samsung-afc', re:/\bafc\b|\badaptive\s?fast\s?charg/, vendorReq:true },
    { key:'std:huawei-scp', re:/\bscp\b|\bsuper\s?charge\s?protocol\b/, vendorReq:true },
    { key:'std:oppo-vooc', re:/\b(?:super\s?)?vooc\b|\bwarp\s?charg/, vendorReq:true },
    { key:'std:usb-pd-3.1', re:/\b(?:usb[\s-]?)?pd\s?3\.1\b|\bpower\s?delivery\s?3\.1\b|\bepr\b/ },
    /* P9c: "PD 3A" / "PD 3 A" / "PD 3amps" is a current rating, never the PD 3.0 version */
    { key:'std:usb-pd-3.0', re:/\b(?:usb[\s-]?)?pd\s?3(?:\.0)?(?![.\d])(?!\s?a(?:mps?)?\b)|\bpower\s?delivery\s?3(?:\.0)?(?![.\d])(?!\s?a(?:mps?)?\b)/ }, { key:'std:pps', re:/\bpps\b/ },
    { key:'std:qc-5', re:/\bqc\s?5(?:\.0)?\b|\bquick\s?charge\s?5/ }, { key:'std:qc-4', re:/\bqc\s?4\+?(?:\.0)?\b|\bquick\s?charge\s?4/ },
    { key:'std:qc-3', re:/\bqc\s?3(?:\.0)?\b|\bquick\s?charge\s?3/ }, { key:'std:qc', re:/\bqc\b|\bquick\s?charg(?:e|ing)\b/ },
    { key:'std:usb-pd', re:/\b(?:usb[\s-]?)?pd(?:\s?[1-3](?:\.\d)?)?(?![\w.])|\bpower\s?delivery\b/ }, { key:'std:qi2', re:/\bqi\s?2\b/ }, { key:'std:magsafe', re:/\bmagsafe\b/ },
    { key:'std:qi', re:/\bqi\b/ } ];

  /* ============================== 4. question signals ============================== */
  var RE={
    compat:/\b(compatible|compatibility|work(?:s|ing)?\s+(?:with|on|sa)|gumagana|gagana|kaya\s+ba|pwede\s+ba|puwede\s+ba|pede\s+ba|kasya|fit(?:s)?\s+(?:in|on|with)|support(?:s|ed)?|suportado|sinusuportahan|supported\s+ba|will\s+(?:it|this|these)\s+work)\b/,
    support:/\b(support(?:s|ed)?|suportado|sinusuportahan|kaya\s+(?:ba|nya|niya|ng|nito)|pwede\s+ba|puwede\s+ba|can\s+(?:it|this|this\s+\w+)|does\s+(?:it|this|the|[a-z0-9-]+)(?:\s+[a-z0-9.-]+)?\s+(?:have|do|output|handle|run|charge|need)|output|mag-?output|capable|is\s+(?:it|this|this\s+\w+)|ba\s+(?:ito|yan|to))\b/,
    yesno:/^\s*(?:is|are|does|do|can|will|would|could|has|have)\b|\bba\b/,
    listing:/^\s*may\s|\b(is\s+there|are\s+there|do\s+(?:you|we)\s+have|may\s+(?:ba|kayong|tayong|kayo|tayo)\b|meron\s*(?:ba|kayong|tayong)?|which|anong|alin|recommend|suggest|list|show)\b/,
    explain:/\b(difference|differences|diff|differ|explain|why|bakit|pinagkaiba|kaibahan|pagkakaiba|ano\s+(?:ang\s+)?(?:difference|pinagkaiba))\b/,
    judgement:/\b(best|better|recommend(?:ed|ation)?|suggest|sulit|worth|mas\s+(?:maganda|okay|ok|sulit)|alin\s+(?:ang\s+)?(?:mas\s+)?(?:maganda|okay|ok|best))\b/,
    manual:/\b(manual|user\s?guide|user'?s\s?guide|datasheet|data\s?sheet|spec(?:ification)?s?\s?sheet|quick\s?start\s?guide)\b/,
    install:/\b(how\s+(?:do\s+i\s+|to\s+)?(?:install|set\s?up|setup|connect|pair|reset|configure|mount|update)|paano\s+(?:i-?)?(?:install|set\s?up|setup|ikabit|kabit|gamitin|connect|i-?connect|i-?pair|pair|i-?reset|reset)|installation|set\s?up\s+guide)\b/,
    lifecycle:/\b(discontinued|end\s+of\s+life|eol|phased?\s+out|still\s+supported|firmware\s+(?:update|updates|support)|lifecycle|successor|replacement\s+model|may\s+firmware\s+update)\b/,
    officialList:/\b(compatibility\s+list|compatible\s+list|qvl|supported\s+(?:drives?|hdds?|ssds?|list|devices)\s+list|supported\s+drives|official(?:ly)?\s+(?:compatible|supported|list|compatibility)|certified|listahan)\b/,
    capacity:/\b(max(?:imum)?\s+(?:capacity|storage|hdd|drive)|how\s+many\s+tb|ilang\s+tb|up\s+to\s+how\s+many|max\s+tb|capacity\s+limit)\b/,
    capacitySup:/\b(pinakamalaking\s+(?:hdd|drive|capacity)|largest\s+(?:drive|hdd)|biggest\s+(?:drive|hdd))\b/,
    run:/\b(run|runs|mag-?run|install|i-?install|gamitin|use)\b/,
    speed:/\b(how\s+fast|transfer\s+(?:speed|rate)|max(?:imum)?\s+speed|data\s+(?:speed|rate)|gaano\s+(?:ka\s*)?bilis|mas\s+mabilis|faster)\b/,
    wattsAsk:/\b(how\s+many\s+watts|ilang\s+watts?|max(?:imum)?\s+(?:output|wattage|watts)|total\s+output|gaano\s+kalakas)\b/,
    driver:/\b(driver|drivers|plug\s*(?:and|&|n)\s*play|kailangan\s+(?:ba\s+)?(?:ng\s+)?driver)\b/,
    displays:/\b(dual|double|triple|two|three|quad|four|2|3|4)[-\s]+(?:(?:\d{1,2}k|\d{3,4}p)(?:\s*@?\s*\d{2,3}\s?hz)?[-\s]+|(?:external|extended|separate|independent)[-\s]+)*(?:monitors?|displays?|screens?)\b|\b(multi[-\s]?monitors?|multiple\s+(?:monitors|displays|screens)|extended\s+displays?)\b/,
    commercial:/\b(price|prices|srp|dp|magkano|presyo|discount|promo|how\s+much|cost|stock|stocks|on\s+hand|available\s+(?:pa|ba|stocks?)|may\s+stock)\b/,
    extAvail:/\b(lazada|shopee|amazon|where\s+(?:can\s+i|to)\s+buy|saan\s+(?:makakabili|mabibili|bibili))\b/,
    deictic:/\b(this|it|its|these|those|that|them|both|pareho|parehas|parehong|ito|iyan|yan|yun|yung\s+(?:dalawa|isa|una|pangalawa)|nito|niyan|nyan|dito|dalawa|ganito|ganyan)\b/,
    plural:/\b(these|those|both|them|dalawa|yung\s+dalawa|two\s+products|these\s+two|those\s+two|the\s+two|all\s+of\s+them|all\s+(?:two|three)|pareho|parehas|parehong)\b/,
    followUp:/^\s*(?:and|how\s+about|what\s+about|e|eh|paano\s+(?:naman\s+)?(?:kung|sa)|sa|pano\s+sa|tapos)\b/,
    product:/\b(hub|hubs|dock|docks|docking|cable|cables|kable|charger|chargers|adapter|adaptor|enclosure|nas|nasync|power\s?bank|powerbank|splitter|switcher|card\s?reader|reader|kvm|extender|capture\s?card|earbuds?|headphones?|mouse|holder|stand|converter|ugreen|model|item|sku|product|products)\b/
  };

  function detectEntities(q){
    var qn=normText(q), out=[], seen=dict();
    function add(e){ if(seen[e.key]) return; seen[e.key]=1; out.push(e); }
    DRIVE_MODELS.forEach(function(d){ var m=qn.match(d.re); if(m) add({ kind:'drive', key:d.vendor+':'+m[1].toUpperCase().replace(/\//g,'-'), raw:m[1], exact:true }); });
    if(!out.length){ var f=qn.match(DRIVE_FAMILIES); if(f) add({ kind:'drive', key:'drive-family:'+slug(f[0]), raw:f[0], exact:false }); }
    DEVICES.forEach(function(d){ var m=qn.match(d.re); if(!m) return; var lv=d.level(m);
      add({ kind:'device', key:d.vendor+':'+slug(m[0]), raw:m[0], exact:lv==='exact', level:lv, line:d.vendor+':'+d.line }); });
    /* one entity per device line: the most specific mention wins (an exact model beats its family / generic line) */
    out=out.filter(function(e){ return !(e.kind==='device' && out.some(function(o){ return o!==e && o.kind==='device' && o.line===e.line && LEVEL_RANK[o.level]>LEVEL_RANK[e.level]; })); });
    var osHit=null; OS_LIST.forEach(function(o){ if(!osHit && o.re.test(qn)) osHit=o; });
    if(osHit && !(osHit.key==='os:ios' && /\biphone|ipad\b/.test(qn) && !/\bios\s?\d/.test(qn))){ var ok=osAskKey(qn,osHit.key); add({ kind:'os', key:ok, raw:ok.slice(3), exact:true }); }
    APPS.forEach(function(s){ if(s.re.test(qn)) add({ kind:'app', key:s.key, raw:s.key.slice(4), exact:true }); });
    STANDARDS.forEach(function(s){ if(s.re.test(qn)) add({ kind:'std', key:s.key, raw:s.key.slice(4), exact:true }); });
    PROTOCOLS.forEach(function(s){ if(s.re.test(qn)) add({ kind:'protocol', key:s.key, raw:s.key.slice(4), exact:true }); });
    var chg=null; CHARGING.forEach(function(s){ if(!chg && s.re.test(qn)) chg=s; });    /* most specific charging protocol only */
    if(chg) add({ kind:'charging', key:chg.key, raw:chg.key.slice(4), exact:true, vendorReq:!!chg.vendorReq });
    return out;
  }
  /* resolution tier ("K"): 720p 1, 1080p 2, 1440p 2.5, 2160p 4, 4320p 8. 1440p is its own tier: a 1080p and a 1440p ask never
     share one limit (third round, major 3). */
  var RES_TIERS=[1,2,2.5,4,5,8,10,16];
  function pRes(n){ n=+n; return n>=4320?8:(n>=2160?4:(n>=1440?2.5:(n>=1080?2:1))); }
  /* Display requirement (fourth round, VERO major B; replaces the third round's flat mode list). The question is normalised to
       DisplayRequirement { displays:[{ r, hz, c }], total, simultaneous, mode, host }
     displays      every resolution in the question (K and p forms, "4k120"), with its own refresh -- "@120Hz", "at 120Hz", "120Hz" or a
                   bare 24-480 number right after the resolution ("4K 120", "1440p 144"; never "4K 2m" / "4K 100W") -- and its own
                   count c, read only from a count word ADJACENT to that resolution: "2x 4K", "2 x 4K", "x2 4K", "4K x2", "dual 4K",
                   "two 4K", "dalawang 4K", "triple / three / tatlong ...". A port count ("2 HDMI 4K", "dual HDMI") is never a
                   display count, and several resolutions are never a count by themselves.
     simultaneous  "at the same time", "simultaneously", "sabay", "together": the listed displays form ONE composite setup
                   ("4K and 1080p at the same time" = 1 x 4K + 1 x 1080p, total 2). Without it, several resolutions stay separate
                   single-display asks ("4K at 60Hz and 1440p at 144Hz").
     total         simultaneous external displays: an explicit "N monitors / displays / screens" ("3 monitors", "tatlong
                   monitor"), else the sum of the counted displays, else 2 for "multiple / multi-monitor / extended displays";
                   null = no count. "including my laptop" in the question takes the host screen out of the external total.
     mode          EXTEND ("extended", "expand", "separate / independent / different screens"), MIRROR ("mirror", "duplicate",
                   "same content"), EITHER (both named) or UNKNOWN. A mixed setup keeps one entry per display (never one max
                   scalar); each entry is matched against the product at the setup's total. A refresh rate stated apart from every
                   resolution belongs to the displays that have none when it is the only free one. */
  var COUNT_WORD={ single:1, one:1, isang:1, isa:1, '1':1, dual:2, double:2, two:2, dalawang:2, dalawa:2, '2':2, triple:3, three:3, tatlong:3, tatlo:3, '3':3, quad:4, four:4, apat:4, '4':4 };
  var CNT_ALT='single|one|isang|isa|dual|double|two|dalawang|dalawa|triple|three|tatlong|tatlo|quad|four|apat|[1-4]';
  var DISP_ADJ='(?:na|external|extended|mirrored|separate|independent)';   /* "dual extended 4K", "dalawang external 4K" */
  var CNT_BEFORE_RE=new RegExp('(?:\\b('+CNT_ALT+')(?:\\s*[x\\u00d7]\\s*|[-\\s]+(?:'+DISP_ADJ+'[-\\s]+)*)|\\b[x\\u00d7]\\s?([1-4])\\s+)$');
  var CNT_AFTER_RE=/^\s*[x×]\s?([1-4])(?![\dk.])/;
  var TOTAL_RE=new RegExp('\\b('+CNT_ALT+')[-\\s]+(?:na\\s+)?(?:(?:(?:\\d{1,2}\\s?k(?:\\d{2,3})?|\\d{3,4}p)(?:\\s*(?:@|at|sa)?\\s*\\d{2,3}\\s?(?:hz)?)?|external|extended|mirrored|separate|independent|different|magkaibang?|ibang|or)[-\\s]+)*(?:monitors?|displays?|screens?|tvs?)\\b');   /* M1: "two different displays", Taglish "dalawang magkaibang display" */
  var SIM_RE=/\b(?:at\s+the\s+same\s+time|simultaneous(?:ly)?|sabay(?:-?sabay)?|sabayan|together|concurrent(?:ly)?|at\s+once)\b/;
  var MULTI_RE=/\b(multi[-\s]?monitors?|multiple\s+(?:monitors|displays|screens)|extended\s+displays?)\b/;
  var HOST_Q_RE=/\b(?:including|incl|plus|kasama(?:\s+(?:na|ang|yung))?|counting)\s+(?:the\s+|my\s+|its\s+|ang\s+|yung\s+)?(?:laptop|notebook|macbook|computer|pc|host|built-?in|internal)\b/;
  /* fifth round, VERO major M1: a display MODE asked without a display noun ("dual extended on mac", "extended mode on macOS",
     "mag extend sa mac") is still a display requirement. An adjacent count word gives the count ("dual extended" = 2); a mode with
     no count is ONE external display in that mode (modeOnly). "extend the cable", "extended warranty" are never a mode ask. */
  var MODE_ASK_RE=new RegExp('\\b('+CNT_ALT+')[-\\s]+(?:extended|extend|mirrored|mirror(?:ing)?)\\b|\\b(?:extend(?:ed)?|mirror(?:ed|ing)?|duplicat(?:e|ed)|clone)\\s+(?:mode|displays?|desktops?|view|screens?|monitors?)\\b|\\bmag-?\\s?(?:extend|mirror)\\b|\\bi-(?:extend|mirror)\\b');   /* Taglish "mag extend", "i-extend"; never English "I extend" */
  /* fifth round, VERO major M3: simultaneous use of several video outputs is a display count. "both (HDMI) ports / outputs",
     "using / on / sa <count> <port> (ports)" and, with a simultaneity word, "<count> <port> ports" or "<port> and <port>" name
     n outputs driven together. A port count alone ("2 HDMI 4K", "dual HDMI") stays a port count, never a display count. */
  var VPORT_ALT='hdmi|dp|displayport|usb-?c|type-?c|vga|dvi|thunderbolt|video';
  var BOTH_PORT_RE=new RegExp('\\bboth\\s+(?:of\\s+)?(?:the\\s+|its\\s+)?(?:(?:'+VPORT_ALT+')(?:\\s+(?:ports?|outputs?))?|ports|outputs)\\b');
  var USING_PORT_RE=new RegExp('\\b(?:on|using|via|through|thru|with|sa|from|gamit)\\s+(?:the\\s+|ang\\s+|yung\\s+|all\\s+)?('+CNT_ALT+')\\s+(?:'+VPORT_ALT+')(?:\\s+(?:ports?|outputs?))?\\b');
  var CNT_PORT_RE=new RegExp('\\b('+CNT_ALT+')\\s+(?:'+VPORT_ALT+')\\s+(?:ports|outputs)\\b'), PAIR_PORT_RE=new RegExp('\\b('+VPORT_ALT+')\\s+(?:and|at|&|\\+)\\s+('+VPORT_ALT+')\\b');
  function portUse(qn,sim){
    if(BOTH_PORT_RE.test(qn)) return 2;
    var m=qn.match(USING_PORT_RE); if(m) return COUNT_WORD[m[1]];
    if(!sim) return null;
    m=qn.match(CNT_PORT_RE); if(m) return COUNT_WORD[m[1]];
    m=qn.match(PAIR_PORT_RE); return m && m[1]!==m[2]?2:null;
  }
  var EXT_Q_RE=/\bextend(?:ed|ing)?\b|\bexpand(?:ed)?\b|\b(?:separate|independent|different|magkaibang?)\s+(?:content|screens?|displays?|desktops?|images?|monitors?)\b/, MIR_Q_RE=/\bmirror|\bduplicat|\bsame\s+(?:screen|content|display|image)\b|\bclone\b/;
  function displayRequirement(qn){
    var displays=[], used=[], m, re=/\b(\d{1,2})\s?k(\d{2,3})?(?![a-z0-9])|\b(\d{3,4})p(?![a-z0-9])/g;
    while((m=re.exec(qn))){
      var r=m[1]?+m[1]:pRes(m[3]), hz=m[2]?+m[2]:null, end=m.index+m[0].length, c=null, k, x;
      for(k=0;k<2;k++){                                                     /* refresh and a trailing "x2" in either order */
        var rest=qn.slice(end);
        x=rest.match(/^\s*(?:@|at|sa)?\s*(\d{2,3})\s?(hz)?(?![a-z0-9.])/);
        if(hz==null && x && (x[2] || (+x[1]>=24 && +x[1]<=480))){ hz=+x[1]; end+=x[0].length; continue; }
        x=rest.match(CNT_AFTER_RE); if(c==null && x){ c=+x[1]; end+=x[0].length; }
      }
      used.push([m.index,end]);
      var pre=qn.slice(0,m.index), cm=pre.match(CNT_BEFORE_RE);
      if(cm && !/[\d.]/.test(pre.charAt(cm.index-1)||'')) c=cm[1]?COUNT_WORD[cm[1]]:+cm[2];   /* "HDMI 2.1 4K" is no count */
      if(has(RES_TIERS,r)) displays.push({ r:r, hz:hz, c:c });
    }
    var free=[], hre=/\b(\d{2,3})\s?hz\b/g;
    while((m=hre.exec(qn))){ var at=m.index; if(!used.some(function(u){ return at>=u[0] && at<u[1]; })) free.push(+m[1]); }
    if(!displays.length && free.length) displays.push({ r:null, hz:free[0], c:null });
    else if(free.length===1) displays.forEach(function(v){ if(v.hz==null) v.hz=free[0]; });
    var sim=SIM_RE.test(qn), ext=EXT_Q_RE.test(qn), mir=MIR_Q_RE.test(qn), ma=(ext || mir)?qn.match(MODE_ASK_RE):null;
    var nPort=portUse(qn,sim), outs=nPort>=2 && (displays.length || ma)?nPort:null;   /* M3: n outputs used together */
    if(outs){ sim=true; if(displays.length===1 && displays[0].c==null) displays[0].c=outs; }   /* "4K60 on both HDMI ports" = 2 x 4K60 */
    if(sim) displays.forEach(function(v){ if(v.c==null) v.c=1; });   /* a single display is unaffected (c = 1 never reaches a total of 2) */
    var tm=qn.match(TOTAL_RE), total=null, modeOnly=false;
    var counted=displays.some(function(v){ return v.c; })?displays.reduce(function(s,v){ return s+(v.c||1); },0):null;
    if(tm || counted) total=Math.max(tm?COUNT_WORD[tm[1]]:0, counted||0);   /* "one 8K and one 4K monitor" = 2, not the last "one ... monitor" */
    else if(MULTI_RE.test(qn)) total=2;
    else if(outs) total=outs;                                           /* "extended mode with HDMI and VGA at the same time" */
    else if(ma && ma[1]) total=COUNT_WORD[ma[1]];                       /* "dual extended on mac" = 2 */
    if(total==null && ma) modeOnly=true;                                /* "extended mode on macOS" = one external display in that mode */
    var host=total!=null && HOST_Q_RE.test(qn);
    if(host) total--;
    return { displays:displays, total:total, simultaneous:sim, host:host, modeOnly:modeOnly, mode:ext && mir?'EITHER':(ext?'EXTEND':(mir?'MIRROR':'UNKNOWN')) };
  }
  /* P9d direction of the asked video capability: 'in' only when the question names the input side; otherwise output / display */
  function videoDir(qn){ return /\b(input|source|hdmi\s+in)\b/.test(qn)?'in':'out'; }
  /* output port named for the video ask ("via HDMI", "on the DP port", "HDMI output") */
  var PORT_WORDS={ hdmi:'hdmi', dp:'dp', displayport:'dp', 'usb-c':'usb-c', usbc:'usb-c', 'type-c':'usb-c', vga:'vga', dvi:'dvi' };
  function videoPort(qn){
    var m=qn.match(/\b(?:via|through|thru|on|using|over|sa|from)\s+(?:the\s+|its\s+|ang\s+|yung\s+)?(hdmi|dp|displayport|usb-?c|type-c|vga|dvi)\b/)||qn.match(/\b(hdmi|dp|displayport|usb-?c|type-c|vga|dvi)\s+(?:port|output|out)\b/);
    return m?PORT_WORDS[m[1].replace(/^usb-?c$/,'usb-c')]:null;
  }
  function wattsAsk(qn){ var m=qn.match(/\b(\d{2,3})\s?(?:w|watts?)\b/); return m?+m[1]:null; }
  function gbpsAsk(qn){ var m=qn.match(/\b(\d{1,3})\s?gbps\b/); return m?+m[1]:null; }

  /* ============================== 5. subject resolution (item code > UPC > exact model + variant) ============================== */
  /* Catalogue caches (fourth round, QA 2): the subject index and the catalogue vocabulary are keyed by a content signature of
     exactly the fields they are built from (item_code, upc, model, product_name, category, sheet_display, disabled, in catalogue
     order), never by array or object identity, so an in-place add / remove / disable / rename invalidates them. The index holds
     catalogue POSITIONS, not product objects: a product is always read live from the current list (the signature guarantees the
     item code at each position), so text-only edits never need an invalidation. The signature is computed once per public call
     (catalogue scope, opened by guard()) and the cache keeps the last 4 catalogue states. */
  var SIG_FIELDS=['item_code','upc','model','product_name','category','sheet_display'];
  function catSig(list){
    var a=0x811c9dc5, b=5381, i, j, s;
    for(i=0;i<list.length;i++){ var p=list[i];
      s=isObj(p)?SIG_FIELDS.map(function(k){ return str(field(p,k)); }).join('\u0001')+(field(p,'disabled')===true?'\u0001D':''):'\u0002';
      for(j=0;j<s.length;j++){ var c=s.charCodeAt(j); a=Math.imul(a^c,16777619)>>>0; b=(Math.imul(b,33)^c)>>>0; }
      a=Math.imul(a^0x1f,16777619)>>>0; b=(Math.imul(b,33)^0x1f)>>>0; }
    return list.length+':'+a.toString(16)+':'+b.toString(16);
  }
  var CAT_CACHE=[], CAT_MAX=4, SCOPE=null;
  function catalogue(products){
    var list=arr(products);
    if(SCOPE && SCOPE.list===list && SCOPE.cat) return SCOPE.cat;            /* one signature per public call */
    var sig=catSig(list), c=null, i;
    for(i=0;i<CAT_CACHE.length;i++) if(CAT_CACHE[i].sig===sig){ c=CAT_CACHE[i]; break; }
    if(!c){ c={ sig:sig, ix:null, vocab:null }; CAT_CACHE.unshift(c); if(CAT_CACHE.length>CAT_MAX) CAT_CACHE.pop(); }
    if(SCOPE){ SCOPE.list=list; SCOPE.cat=c; }
    return c;
  }
  function inScope(fn){ return function(){ var outer=SCOPE; if(!outer) SCOPE={ list:null, cat:null }; try{ return fn.apply(null,arguments); } finally { if(!outer) SCOPE=null; } }; }
  function index(products){
    var list=arr(products), c=catalogue(list);
    if(!c.ix){
      var byCode=dict(), byUpc=dict(), byModel=dict(), count=dict();
      list.forEach(function(p,pos){ if(!isObj(p)) return; var c0=str(field(p,'item_code')).trim(); if(!c0) return; byCode[c0.toUpperCase()]=pos; count[c0.toUpperCase()]=(count[c0.toUpperCase()]||0)+1;
        var u=str(field(p,'upc')).trim(); if(/^\d{8,14}$/.test(u)) (byUpc[u]=byUpc[u]||[]).push(c0);
        modelKeys(field(p,'model')).forEach(function(k){ (byModel[k]=byModel[k]||[]); if(byModel[k].indexOf(c0)<0) byModel[k].push(c0); }); });
      c.ix={ byCode:byCode, byUpc:byUpc, byModel:byModel, count:count };
    }
    var ix=c.ix;
    return { byUpc:ix.byUpc, byModel:ix.byModel, count:ix.count, get:function(code){ var pos=ix.byCode[str(code).toUpperCase()]; return pos==null?null:(list[pos]||null); } };
  }
  function modelKeys(model){
    var m=normText(model).trim(); if(!m) return [];
    var full=compact(m), keys=[];
    if(/[a-z]/.test(full) && /\d/.test(full) && full.length>=3) keys.push(full);
    var head=compact(m.split(/\s+/)[0]);
    if(head!==full && /[a-z]/.test(head) && /\d/.test(head) && head.length>=4) keys.push(head);
    return keys;
  }
  var UNIT_AFTER=/^(mah|w|watts?|php|pesos?|pcs|gb|tb|mbps|gbps|rpm|hz|k|m|cm|mm|ft|v|a)$/;
  function lengthM(s){ var m=normText(s).match(/(\d+(?:\.\d+)?)\s?(m|meters?|metro|cm|ft|feet)\b/); if(!m) return null; var v=+m[1]; return m[2]==='cm'?v/100:(/^f/.test(m[2])?v*0.3048:v); }
  var COLORS=['black','white','gray','grey','silver','blue','red','pink','green','purple','gold','space gray','dark gray','beige','yellow','orange'];
  function colorOf(s){ var t=normText(s).replace(/grey/g,'gray'); return COLORS.filter(function(c){ return t.indexOf(c.replace('grey','gray'))>=0; }); }
  function resolveSubjects(q, opts){
    opts=isObj(opts)?opts:{}; var products=arr(opts.products), ix=index(products), qn=normText(q), ws=words(qn), used={}, out=[], amb=[];
    var ext=dict(); detectEntities(q).forEach(function(e){ if(e.kind==='drive' && e.exact) ext[compact(e.raw)]=1; });
    function addSubject(code,via){ if(out.some(function(s){ return s.code===code; })) return; out.push({ key:'ugreen:'+code, code:code, via:via }); }
    ws.forEach(function(w,i){                                                   /* 1. exact item code */
      var p=ix.get(w); if(!p) return;
      var nx=ws[i+1]||'', pv=ws[i-1]||''; if(UNIT_AFTER.test(nx) || /^(php|p|under|below|above|over|less|more)$/.test(pv)) return;
      used[i]=1; addSubject(str(field(p,'item_code')).trim(),'item_code'); });
    ws.forEach(function(w,i){ if(used[i] || !/^\d{12,14}$/.test(w)) return;     /* 2. UPC */
      var cs=ix.byUpc[w]; if(!cs) return; used[i]=1;
      if(cs.length===1) addSubject(cs[0],'upc'); else amb.push({ via:'upc', raw:w, codes:cs.slice() }); });
    var qLen=lengthM(qn), qCol=colorOf(qn);
    for(var n=3;n>=1;n--){                                                      /* 3. exact model (longest token run first) + variant */
      for(var i=0;i+n<=ws.length;i++){
        var idx=[]; for(var k=i;k<i+n;k++){ if(used[k]) break; idx.push(k); } if(idx.length!==n) continue;
        var key=compact(ws.slice(i,i+n).join('')); if(ext[key] || !/[a-z]/.test(key) || !/\d/.test(key)) continue;
        var cs=ix.byModel[key]; if(!cs) continue;
        idx.forEach(function(k){ used[k]=1; });
        if(cs.length===1){ addSubject(cs[0],'model'); continue; }
        var f=cs.filter(function(c){ var p=ix.get(c);
          if(qLen!=null){ var pl=lengthM(field(p,'length')); if(pl==null || Math.abs(pl-qLen)>0.01) return false; }
          if(qCol.length){ var pc=colorOf(field(p,'color')); if(!qCol.every(function(x){ return has(pc,x); })) return false; }
          return true; });
        if((qLen!=null || qCol.length) && f.length===1) addSubject(f[0],'model_variant');
        else amb.push({ via:'model', raw:ws.slice(i,i+n).join(' '), codes:(f.length?f:cs).slice() });
      }
    }
    return { status:amb.length?'ambiguous':(out.length?'resolved':'none'), subjects:out, ambiguous:amb };
  }

  /* ============================== 6. local checks (catalogue facts only) ============================== */
  function factOf(opts,code){ var x=field(field(field(opts,'facts'),'byCode'),str(code)); return isObj(x)?x:null; }
  function prodOf(opts,code){ return index(field(opts,'products')).get(code); }
  function confirmedNum(attr){ if(!isObj(attr) || typeof attr.value!=='number') return null;
    if(attr.conflict) return { conflict:true };
    var ok=arr(attr.evidence).some(function(e){ return isObj(e) && e.confirmed===true && (e.tier==='strong'||e.tier==='medium'); }); return ok?{ value:attr.value }:null; }
  /* Storage capacity, typed by wording (never by guess):
       per-bay      "N T(B) * k"  -> N x k, medium = SSD when preceded by M.2 / SSD / NVMe, else HDD
       stated total "up to / max / supports / total N TB" (not "N TB and above"), "N TB ... storage / capacity", "massive N TB"
       ignored      per-drive examples ("12TB hard disk") and bare numbers without capacity wording.
     Reconcilable sums: HDD total, SSD total, HDD + SSD. Every stated total must equal one of them (or, with no per-bay statement,
     each other); otherwise CONTRADICTED_INTERNAL with every value kept (never resolved here). Several media and no stated total:
     the scope of "max capacity" is unclear -> UNKNOWN. */
  function capacityStatements(p){
    var t=textOf(p), quotes=[], m, re, per=dict(), stated=[];
    re=/(\d+(?:\.\d+)?)\s?t(?:b)?\s?[*x\u00d7]\s?(\d{1,2})(?![\d.])/g;
    while((m=re.exec(t))){ var med=/(?:m\.2|ssd|nvme)\s*$/.test(t.slice(Math.max(0,m.index-12),m.index))?'ssd':'hdd';
      var tot=+m[1]*+m[2]; per[med]=per[med]||[]; if(per[med].indexOf(tot)<0) per[med].push(tot); quotes.push(m[0]); }
    var TOT=[/(?:up\s?to|max(?:imum)?(?:\s+(?:storage\s+)?capacity)?(?:\s+of)?(?:\s+up\s+to)?|supports?(?:\s+up\s+to)?|total(?:\s+(?:storage|capacity))?(?:\s+of)?)\s+(\d+(?:\.\d+)?)\s?tb\b(?!\s*(?:and|or)\s+(?:above|more|larger|bigger))(?!\s*(?:sata\s+)?(?:hard\s+(?:disk|drive)s?|hdds?|ssds?|drives?|disks?)\b)/g,
      /\b(\d+(?:\.\d+)?)\s?tb\s+(?:massive\s+)?(?:data\s+)?(?:storage|capacity)\b/g, /\bmassive\s+(\d+(?:\.\d+)?)\s?tb\b/g];
    TOT.forEach(function(rx){ while((m=rx.exec(t))){ if(stated.indexOf(+m[1])<0) stated.push(+m[1]); quotes.push(m[0]); } });
    var hdd=per.hdd||[], ssd=per.ssd||[], derived=[];
    if(hdd.length<=1 && ssd.length<=1){ var H=hdd[0]||0, S=ssd[0]||0; [H,S,H+S].forEach(function(v){ if(v>0 && derived.indexOf(v)<0) derived.push(v); }); }
    var state='UNKNOWN', values=[];
    if(hdd.length>1 || ssd.length>1){ state='CONTRADICTED_INTERNAL'; values=uniq(hdd.concat(ssd,stated)); }
    else if(stated.length>1){ state='CONTRADICTED_INTERNAL'; values=uniq(derived.concat(stated)); }
    else if(stated.length===1){
      if(!derived.length || derived.indexOf(stated[0])>=0){ state='CONFIRMED'; values=stated.slice(); }
      else { state='CONTRADICTED_INTERNAL'; values=uniq(derived.concat(stated)); } }
    else if(derived.length===1){ state='CONFIRMED'; values=derived.slice(); }
    return { state:state, values:values, derived:derived, stated:stated, quotes:uniq(quotes).slice(0,6) };
  }
  /* ---------- wattage (P6: never compared without its role) ----------
     Total-output scope (F8, unchanged): the product name's single wattage, "total output (power): N W", "max N W output / power",
     "N W max output / power". Segments about one port, input, simultaneous use or an allocation ("45W+20W") are another scope and
     are skipped. Two different total-scope values = CONTRADICTED_INTERNAL. */
  var PORT_SCOPE=/\b(?:input|usb-?c\s?[1-4]|usb-?a\s?[1-2]?|c[1-4]|a[1-2]|single[-\s]?port|per[-\s]port|each\s+port|one\s+port|port\s?[1-4]|both\s+ports|simultaneous(?:ly)?|when\s+(?:using|charging))\b|\d\s?w\s?\+/;
  function wattStatements(p){
    var vals=[], quotes=[], nm=nameOf(p), nw=uniq((nm.match(/\b\d{1,3}(?:\.\d)?\s?w\b/g)||[]).map(function(x){ return parseFloat(x); }));
    if(nw.length===1 && !/\d\s?w\s?\+/.test(nm)){ vals.push(nw[0]); quotes.push(nw[0]+'W (name)'); }
    var segs=normText(['short_desc','features','description'].map(function(k){ return str(field(p,k)); }).join('\n')).split(/[\n*▪•]|\.\s+/);
    var RX=[/\btotal\s+(?:output\s+)?(?:power\s+)?(?:output\s+)?:?\s*(?:up\s+to\s+)?(\d{1,3}(?:\.\d)?)\s?w\b/,
      /\bmax(?:imum)?\s+(\d{1,3}(?:\.\d)?)\s?w\s+(?:total\s+)?(?:output|power)\b/, /\b(\d{1,3}(?:\.\d)?)\s?w\s+max(?:imum)?\s+(?:total\s+)?(?:output|power)\b/];
    segs.forEach(function(sg){ if(PORT_SCOPE.test(sg)) return; RX.forEach(function(rx){ var x=sg.match(rx); if(x){ var v=parseFloat(x[1]); if(vals.indexOf(v)<0) vals.push(v); quotes.push(x[0].trim()); } }); });
    return { state:vals.length>1?'CONTRADICTED_INTERNAL':(vals.length?'CONFIRMED':'UNKNOWN'), values:vals, quotes:uniq(quotes).slice(0,4) };
  }
  /* Every stated wattage with its role. total = whole-device output; port = one output port (incl. a hub's PD output, a power
     bank's built-in cable); upstream = host / laptop charging through a hub or dock (upstream, pass-through); input = power input
     (DC, "Input", power supply); wireless = wireless / Qi output; accessory = an included cable, a recommended adapter, a
     comparison or a reserve (never the product's own rating); unscoped = no role wording. A value never moves between roles.
     The role comes from the clause (label "X: N W" inherits the label's role); allocations ("65W+30W") are skipped. */
  var TOTAL_FAMS=['charger','power_bank','charging_cable'];
  var ROLE_RX=[['accessory',/\brecommend|\bor\s+(?:higher|above|more)\b|\bstandard\s+\d+\s?w\b|\bthan\s+(?:the\s+)?(?:standard|regular|original)\b|\breserves?\b|\bother\s+interfaces?\b|\bsurge\b/],
    ['input',/\binput\b|\bdc\b|\bpower\s+(?:supply|adapter)\b/], ['upstream',/\bupstream\b|\bpass[-\s]?through\b|\bhost\b|\blaptops?\b|\bnotebooks?\b|\bmacbooks?\b/],
    ['total',/\btotal\b|\bcombined\b|\boverall\b/], ['wireless',/\bwireless(?:ly)?\b|\bqi2?(?:\.\d)?\b|\bmagsafe\b/],
    ['port',/\boutput\b|\bports?\b|\busb-?[ac]\d?\b|\btype-?[ac]\b|\b[ac][1-4]\b|\bper\s+port\b|\bsingle\b|\bbuilt-?in\b|\bbuild-?in\b|\bintegrated\b|\bretractable\b|\bwired\b|\bphones?\b|\btablets?\b/]];
  function roleOf(t,fam){ for(var i=0;i<ROLE_RX.length;i++){ if(ROLE_RX[i][1].test(t)){ var r=ROLE_RX[i][0]; return r==='upstream' && has(TOTAL_FAMS,fam)?'unscoped':r; } } return null; }
  function wattRoles(p,fam){
    var R={ total:[], port:[], upstream:[], input:[], wireless:[], accessory:[], unscoped:[] }, tot=has(TOTAL_FAMS,fam);
    function put(role,v){ if(R[role].indexOf(v)<0) R[role].push(v); }
    (nameOf(p).match(/\b\d{1,3}(?:\.\d)?\s?w\b(?!\s?\+)/g)||[]).forEach(function(x){ put(tot?'total':'unscoped',parseFloat(x)); });
    var body=normText(['short_desc','features','description'].map(function(k){ return str(field(p,k)); }).join('\n'));
    body.split(/[\n;,()]|\.(?!\d)\s*|\s[-–—]\s/).forEach(function(cl){
      var ci=cl.indexOf(':'), label=ci>=0?cl.slice(0,ci):'', content=ci>=0?cl.slice(ci+1):cl;
      var shortLabel=label && label.trim().split(/\s+/).length<=5;
      [[label,true],[content,false]].forEach(function(part){ var s=part[0], re=/(\+\s?)?\b(\d{1,3}(?:\.\d)?)\s?w\b(?!\s?\+)/g, ms=[], m;
        while((m=re.exec(s))) ms.push(m);
        ms.forEach(function(x,i){ if(x[1]) return;                       /* allocation "65W+30W" */
          var end=x.index+x[0].length, after=s.slice(end,i+1<ms.length?ms[i+1].index:s.length), before=s.slice(i>0?ms[i-1].index+ms[i-1][0].length:0,x.index);
          var aw=after.trim().split(/\s+/).slice(0,4).join(' '), bw=before.trim().split(/\s+/).slice(-5).join(' '), role;
          if(ROLE_RX[0][1].test(s)) role='accessory';                         /* recommendation / comparison / reserve clause */
          else if(!/built-?in|build-?in|integrated|retractable/.test(s) && /^\s*(?:max\s+)?(?:usb-?c\s+|type-?c\s+|c\s?to\s?c\s+|cc\s+|fast\s+charging\s+)*cables?\b/.test(after)) role='accessory';
          else role=roleOf(aw,fam) || roleOf(bw,fam) || roleOf(s,fam) || (!part[1] && shortLabel?roleOf(label,fam):null) || 'unscoped';
          put(role,parseFloat(x[2])); });
      });
    });
    return R;
  }
  /* Per-port wattage (fifth round, VERO major M4). A charger / power bank question naming one output port ("USB-A", "USB-C2", "the
     C1 port") asks about THAT port, never the total. Port ids: a letter (a | c) plus an optional number. A cable / adapter
     ("USB-C to Lightning", "USB-C cable") is not a port. Evidence: catalogue clauses naming exactly one port letter (the asked
     one; a numbered clause must carry the asked number when one was asked) and no total / combined / input / wireless /
     accessory wording. No such clause = UNKNOWN; the total output is never evidence for one port. */
  var PORT_TOKEN_RE=/\b(?:usb|type)[\s-]?([ac])(?:\s?([1-4]))?\b|\b([ac])([1-4])\b/g;
  function namedPort(qn){
    var m; PORT_TOKEN_RE.lastIndex=0;
    while((m=PORT_TOKEN_RE.exec(qn))){ if(/^\s*(?:to\b|cables?\b|cords?\b|male\b|female\b|plug\b|adapters?\b)/.test(qn.slice(m.index+m[0].length))) continue;
      return (m[1]||m[3])+(m[2]||m[4]||''); }
    return null;
  }
  /* Phase 1 corrective: a sum of ports ("USB-C1+USB-C2: 130W") is never one port's rating */
  var PORT_EXCL_RE=/\b(?:total|combined|overall|shared?|share|input|wireless(?:ly)?|qi2?|magsafe|recommend\w*|cables?|adapter|pass[-\s]?through|upstream)\b|\d\s?w\s?\+|\b(?:usb[\s-]?|type[\s-]?)?[ac]\s?[1-4]?\s?\+\s?(?:usb[\s-]?|type[\s-]?)?[ac](?:\s?[1-4])?\b/;
  function portWattState(p,id,v){
    /* the stated total output bounds every port (a 20W charger has no 65W port), and a conflict between stated totals stays a
       conflict: it is never resolved by one port clause */
    var ws=wattStatements(p);
    if(v!=null && ws.values.length && ws.values.every(function(x){ return x<v; })) return 'CONTRADICTED';
    if(ws.state==='CONTRADICTED_INTERNAL' && !(v!=null && ws.values.every(function(x){ return x>=v; }))) return 'CONTRADICTED_INTERNAL';
    var L=id.charAt(0), N=id.slice(1), vals=[], loose=[];
    var cls=[]; sentencesOf(p).forEach(function(s){ cls=cls.concat(s.split(/[,()]|\s[-–—]\s/)); });   /* a wrapped bullet stays one clause */
    cls.forEach(function(cl){
      var m, letters=[], nums=[]; PORT_TOKEN_RE.lastIndex=0;
      while((m=PORT_TOKEN_RE.exec(cl))){ var l=m[1]||m[3], n=m[2]||m[4]||''; if(letters.indexOf(l)<0) letters.push(l); if(n) nums.push(n); }
      if(letters.length!==1 || letters[0]!==L || PORT_EXCL_RE.test(cl)) return;
      if(N && nums.length && nums.indexOf(N)<0) return;                   /* "USB-C1: 100W" says nothing about C2 */
      /* Phase 1: a numbered ask (C2) is evaluated only by a clause carrying that number; an unnumbered "USB-C ... 100W" never
         confirms it (it may still bound it: below the asked value = no, as before) */
      var into=N && !nums.length?loose:vals;
      var re=/\b(\d{1,3}(?:\.\d+)?)\s?w\b/g; while((m=re.exec(cl))){ var w=parseFloat(m[1]); if(into.indexOf(w)<0) into.push(w); } });
    if(!vals.length) return v!=null && loose.length && Math.max.apply(null,loose)<v?'CONTRADICTED':'UNKNOWN';
    if(v==null) return vals.length===1?'CONFIRMED':'UNKNOWN';
    return Math.max.apply(null,vals)>=v?'CONFIRMED':'CONTRADICTED';
  }
  /* Phase 1 corrective (owner-approved 2026-10-13, single-device wattage): one receiving device ("charge my laptop at 300W", "to
     a single device") on a charger / power bank gets what ONE port delivers. YES only from a single-port clause at or above the
     asked value; the total output still bounds it (below the asked value = no); otherwise UNKNOWN -- the total never proves it */
  var DEV_RCPT_W='(?:laptops?|macbooks?|notebooks?|phones?|iphones?|cellphones?|smartphones?|cp|tablets?|ipads?|devices?|gadgets?|computers?|pcs?|consoles?)';
  var DEV_RCPT_RE=new RegExp('\\b(?:charg(?:e|es|ing)|power|give|gives|deliver|delivers|provide|provides|supply|supplies|for|to|into|sa|ng)\\s+(?:my\\s+|the\\s+|a\\s+|an\\s+|one\\s+|a\\s+single\\s+|single\\s+|isang\\s+|yung\\s+|ang\\s+)?'+DEV_RCPT_W+'\\b|\\b'+DEV_RCPT_W+'\\s+(?:ko|mo)\\b|\\b(?:single|one|isang|iisang)\\s+'+DEV_RCPT_W+'\\b');
  function deviceWattState(p,fam,v){
    if(v==null) return 'UNKNOWN';
    /* a "no" for the whole product (its total, or every stated wattage below the ask) is a "no" for any one port */
    if(wattState(p,fam,null,v)==='CONTRADICTED') return 'CONTRADICTED';
    if(portWattState(p,'c',v)==='CONFIRMED' || portWattState(p,'a',v)==='CONFIRMED') return 'CONFIRMED';
    /* a power bank's built-in cable OUTPUT line ("USB-C1 Cable Output: … 100W Max", "USB-C Output/USB-C Cable Output: … 33W Max")
       also feeds exactly one device (the port reader skips cables: in a question a cable is an accessory) */
    var best=null; sentencesOf(p).forEach(function(s){ s.split(/[,()]/).forEach(function(cl){
      if(!/\b(?:usb|type)[\s-]?c\s?[1-4]?\s+(?:built-?in\s+)?cable(?:\s*\/\s*(?:usb|type)[\s-]?c\s?[1-4]?)?\s+output\b/.test(cl) || /\binput\b|\btotal\b|\bcombined\b|\+/.test(cl)) return;
      var m, re=/\b(\d{1,3}(?:\.\d+)?)\s?w\b/g; while((m=re.exec(cl))){ var w=parseFloat(m[1]); if(best==null || w>best) best=w; } }); });
    return best!=null && best>=v?'CONFIRMED':'UNKNOWN';
  }
  /* Regression stabilization (owner-approved 2026-10-13, R1-PC-QA-R2): "65W on one port / sa iisang port" asks whether SOME
     single port reaches the value. It is never a local YES (the power_port gap); the answer is no or UNKNOWN. No when BOTH the
     USB-C and the USB-A port readings are below the ask (each is already bounded by the stated total output, wattStatements --
     never by the role-free reading, where a recharging-adapter figure "with PD 20W charger" would count); anything else
     UNKNOWN -- never a no from a partial reading. The port-labelled reading still says no when no other output figure could
     reach the ask: no unlabelled
     value (a wrapped bullet's "65.0W Max"), no allocation figure ("100W+45W") and no total / product-name rating ("… 20W Power
     Bank") at or above it. A port OUTPUT clause stating
     the asked value against a lower reading ("USB-C Input/Output … 20W Max" vs "Total Output: 15W Max") is a catalogue
     conflict -> UNKNOWN, never a no */
  function portOutputClaims(p,v){
    var hit=false; sentencesOf(p).forEach(function(s){ s.split(/[,()]|\s[-–—]\s/).forEach(function(cl){ PORT_TOKEN_RE.lastIndex=0;
      if(!PORT_TOKEN_RE.test(cl) || !/\boutput\b/.test(cl) || /\btotal\b|\bcombined\b|\boverall\b|\+|\bwireless\b/.test(cl)) return;
      var m, re=/\b(\d{1,3}(?:\.\d+)?)\s?w\b/g; while((m=re.exec(cl))) if(parseFloat(m[1])>=v) hit=true; }); });
    return hit;
  }
  function onePortWattState(p,fam,v){
    var no=portWattState(p,'c',v)==='CONTRADICTED' && portWattState(p,'a',v)==='CONTRADICTED';
    if(!no){
      if(wattState(p,fam,'port',v)!=='CONTRADICTED') return 'UNKNOWN';
      var R=wattRoles(p,fam), alloc=[], m, re=/(\d{1,3}(?:\.\d+)?)\s?w\s?\+|\+\s?(\d{1,3}(?:\.\d+)?)\s?w\b/g, body=normText(['short_desc','features','description'].map(function(k){ return str(field(p,k)); }).join('\n'));
      while((m=re.exec(body))) alloc.push(parseFloat(m[1]||m[2]));
      no=!R.unscoped.concat(alloc,R.total).some(function(x){ return x>=v; });
    }
    return no && !portOutputClaims(p,v)?'CONTRADICTED':'UNKNOWN';
  }
  /* role the question asks about (null = not stated) */
  function wattAskRole(qn,fam){
    var tot=has(TOTAL_FAMS,fam);
    if(/\b(upstream|pass[-\s]?through)\b/.test(qn)) return 'upstream';
    if(/\b(input|dc\s+in)\b|\b(?:re)?charg(?:e|ing)\s+(?:the\s+|this\s+|my\s+)?(?:power\s?bank|battery)\b/.test(qn)) return 'input';
    if(/\b(wireless(?:ly)?|qi2?|magsafe)\b/.test(qn)) return 'wireless';
    if(/\b(total|combined|all\s+ports|sabay|simultaneous(?:ly)?)\b/.test(qn)) return 'total';
    var np=namedPort(qn); if(np && has(['charger','power_bank'],fam)) return 'port:'+np;   /* M4: "65W on the USB-A port" */
    /* regression stabilization (R1-PC-QA-R2): ONE unnamed port of a charger / power bank is read per port, never from the
       port-labelled values alone (a wrapped "USB-C1/C2 Output … 65.0W Max" bullet loses its label) */
    if(has(['charger','power_bank'],fam) && /\b(single\s+port|one\s+port|i?isang\s+port|isa\s+lang(?:\s+na|ng)?\s+port)\b/.test(qn)) return 'port1';
    if(/\b(per\s+port|each\s+port|single\s+port|one\s+port|i?isang\s+port|isa\s+lang(?:\s+na|ng)?\s+port|port\s+output|pd\s+(?:output|port))\b/.test(qn)) return 'port';
    if(has(['charger','power_bank'],fam) && DEV_RCPT_RE.test(qn)) return 'device';   /* Phase 1 corrective: one receiving device */
    if(!tot && /\b(?:charg(?:e|es|ing)|power|for|sa|ng)\s+(?:my\s+|the\s+|a\s+|yung\s+|ang\s+)?(?:laptops?|macbooks?|notebooks?|host)\b|\b(?:laptops?|macbooks?)\s+(?:ko|charging)\b/.test(qn)) return 'upstream';
    if(!tot && /\b(?:charg(?:e|es|ing)|for|sa)\s+(?:my\s+|the\s+|a\s+|yung\s+|ang\s+)?(?:phones?|iphones?|tablets?|ipads?|cp)\b/.test(qn)) return 'port';
    if(/\bcables?\b/.test(qn) && fam!=='charging_cable' && fam!=='video_cable') return 'accessory';
    if(/\b(output|max(?:imum)?\s+output)\b/.test(qn)) return tot?'total':'port';
    return null;
  }
  function wattState(p,fam,role,v){
    if(/^port:/.test(str(role))) return portWattState(p,role.slice(5),v);   /* M4: one named port */
    if(role==='device') return deviceWattState(p,fam,v);
    if(role==='port1') return v==null?wattState(p,fam,'port',v):onePortWattState(p,fam,v);
    var tot=has(TOTAL_FAMS,fam), R=wattRoles(p,fam);
    if(role==='total' || (role==null && tot)){
      var ws=wattStatements(p);
      if(ws.state==='CONTRADICTED_INTERNAL'){                              /* conflicting total outputs: a threshold is still answerable */
        if(v!=null && ws.values.every(function(x){ return x<v; })) return 'CONTRADICTED';
        if(v!=null && ws.values.every(function(x){ return x>=v; })) return 'CONFIRMED';
        return 'CONTRADICTED_INTERNAL'; }
      if(ws.state==='CONFIRMED') return v==null || ws.values[0]>=v?'CONFIRMED':'CONTRADICTED';
      /* no total-output statement: a total ask falls to the total role ("share a combined power of 100W"), never another role */
    }
    if(role){ var vs=R[role]; if(!vs.length) return 'UNKNOWN';           /* existence: the best port / input of that role */
      if(v==null) return vs.length===1?'CONFIRMED':'UNKNOWN'; return Math.max.apply(null,vs)>=v?'CONFIRMED':'CONTRADICTED'; }
    /* role not stated: clear only when every stated (non-accessory) wattage is one value; several roles / values -> UNKNOWN */
    var all=[]; Object.keys(R).forEach(function(k){ if(k!=='accessory') all=all.concat(R[k]); }); all=uniq(all);
    if(all.length!==1) return 'UNKNOWN';
    return v==null || all[0]>=v?'CONFIRMED':'CONTRADICTED';
  }

  /* ---------- displays (P2: only an explicit simultaneous-display statement is a display count) ----------
     Counted: "dual / triple / N [4K@60Hz] monitors|displays|screens", "up to N displays", "a single display". Never counted: port
     counts ("2×HDMI", "dual DisplayPort"), switch / splitter topology ("1 source to 2 monitors"), partitives ("1 of the 2
     displays"). A clause saying only one output works at a time is an explicit single display. Mirror / identical-content
     statements are kept apart (they never satisfy an extended-display ask).
     Host screen (fourth round, major C-A): a marketing total that includes the laptop / host screen is normalised to EXTERNAL
     displays -- "3 screens including the laptop" = 2 external; a sentence that states N displays and then N+1 "monitors" with no
     resolution and not as an alternative ("dual displays, so you can operate three monitors") counts the host in the larger
     number (host = true, n = N). */
  var DISPLAY_WORD=COUNT_WORD;
  var NONSIM=/\bonly\s+(?:one|1)\s+(?:of\s+the\s+(?:two|2|three|3|\d)\s+)?(?:selected\s+)?(?:displays?|screens?|monitors?|outputs?)\s+(?:is\s+|are\s+|can\s+be\s+)?(?:displayed|works?|shown|active|used|on)\b|\bone\s+(?:display|screen|monitor|output)?\s*at\s+a\s+time\b|\bonly\s+(?:one|1)\b[^,]{0,30}\bat\s+a\s+time\b/;
  var MIRROR_RE=/\bmirror(?:ed|ing)?\b|\bduplicat(?:e|ed|ion)\b|\bidentical\s+(?:content|image|display)\b|\bsame\s+(?:content|image|screen|picture)\b|\bclone\b/;
  var HOST_P_RE=/\b(?:including|incl\.?|plus)\s+(?:the\s+|your\s+|its\s+|a\s+)?(?:laptop|notebook|macbook|computer|pc|host|built-?in|internal|original)(?:'?s)?\b/;
  /* sentences of a product, per field: a bullet's wrapped lines are joined first ("supports dual\n4K@30Hz output" is one statement) */
  function sentencesOf(p){
    var out=[];
    ['product_name','short_desc','features','description'].forEach(function(k){
      normText(field(p,k)).split(/\n\s*(?=[*▪•])|[▪•]|\n\s*\n/).forEach(function(b){
        b.replace(/\s*\n\s*/g,' ').split(/;|\.(?!\d)\s*/).forEach(function(s){ s=s.trim(); if(s) out.push(s); }); }); });
    return out;
  }
  function displayStatements(p){
    var list=[], single=false;
    sentencesOf(p).forEach(function(cl){
      if(NONSIM.test(cl)){ single=true; return; }
      var mir=MIRROR_RE.test(cl), hostAll=HOST_P_RE.test(cl), own=[], m, re=/\b(single|one|1|dual|double|two|2|triple|three|3|quad|four|4)[-\s]+((?:(?:\d{1,2}k(?:\s*@?\s*\d{2,3}\s?hz)?|external|extended|hd|separate|independent)[-\s]+)*)(?:monitors?|displays?|screens?)\b/g;
      while((m=re.exec(cl))){
        if(/\b(?:sources?|inputs?|signals?|devices?|hosts?)\s+to\s+$|\bof\s+the\s+$/.test(cl.slice(Math.max(0,m.index-24),m.index))) continue;
        var rm=(m[2]||'').match(/(\d{1,2})k(?:\s*@?\s*(\d{2,3})\s?hz)?/);
        own.push({ n:DISPLAY_WORD[m[1]], r:rm?+rm[1]:null, hz:rm && rm[2]?+rm[2]:null, mirror:mir, at:m.index, end:m.index+m[0].length });
      }
      re=/\bup\s+to\s+(\d)\s+(?:external\s+)?(?:monitors?|displays?|screens?)\b/g; while((m=re.exec(cl))) own.push({ n:+m[1], r:null, hz:null, mirror:mir, at:m.index, end:m.index+m[0].length });
      own.forEach(function(s){
        var prev=own.filter(function(o){ return o.at<s.at && o.n===s.n-1 && !/\bor\b|\/|\band\b/.test(cl.slice(o.end,s.at)); });
        if(hostAll || (s.r==null && prev.length)){ s.n=s.n-1; s.host=true; }
        if(s.n>=1) list.push({ n:s.n, r:s.r, hz:s.hz, mirror:s.mirror, host:!!s.host }); });
    });
    return { list:list, single:single };
  }
  /* maximum number of simultaneous EXTERNAL displays the product states (null = not stated) */
  function displayCount(p){ var ds=displayStatements(p), n=null; ds.list.forEach(function(s){ if(n==null || s.n>n) n=s.n; }); return n==null && ds.single?1:n; }
  /* Display rules, per sentence (third round OS rules + fourth round, major C). fam = the OS family the rule is scoped to, or '*'
     when the sentence names no OS (it holds for every OS):
       stmt        "dual 4K@30Hz output (Windows)"                        -> { fam, n, r, hz } for that OS only
       mirrorOnly  OS-scoped: "MacBooks only support mirroring mode", "for macOS, the external monitors will display identical
                   content", "Extended Display Limited on macOS"; unscoped ('*'): only the explicit forms "only support(s) mirror
                   (mode)", "mirror mode only", "Extended Mode not supported", "not support Extend Mode" -> no extended multi-display
       sstOnly     "Mac systems are limited to SST", "SST only"           -> no multi-display EXTENDED desktop proven on that OS
       only        "only Windows systems support MST ... for triple display" -> n displays need that OS
     A rule never reaches another OS; a sentence naming two OS families gives no OS-scoped mirror rule. */
  var OS_WORD_RE=/\b(windows|win\d*|mac\s?os(?:\s?x)?|macos|macbooks?|macs?|imacs?|os\s?x)\b/g;
  function osFam(w){ return /^win/.test(w)?'windows':'macos'; }
  var OS_STMT_RE=/\b(single|one|dual|double|two|triple|three|quad|four|[1-4])[-\s]+(\d{1,2})k(?:\s*@?\s*(\d{2,3})\s?hz)?\s+(?:outputs?|displays?|monitors?|screens?)\s*\(\s*(windows|mac\s?os|macos|macbooks?|mac)\s*\)/g;
  var OS_ONLY_RE=/\bonly\s+(windows|mac\s?os|macos|macbooks?|macs?)\s+(?:systems?\s+|devices?\s+|computers?\s+)?(?:supports?|can)\b[^.]{0,80}?\b(single|one|dual|double|two|triple|three|quad|four|[1-4])[-\s]+(?:displays?|monitors?|screens?)\b/;
  var OS_MIRROR_RE=/\bonly\s+supports?\s+mirror(?:ing)?\b|\bmirror(?:ing)?\s+(?:mode\s+)?only\b|\bidentical\s+(?:content|image)\b|\bsame\s+content\b|\bextended\s+displays?\s+(?:is\s+|are\s+)?(?:limited|not\s+supported|unavailable)\b/;
  var ANY_MIRROR_RE=/\bonly\s+supports?\s+mirror(?:ing)?\b|\bmirror(?:ing)?\s+(?:mode\s+)?only\b|\bextend(?:ed)?\s+(?:mode|displays?)\s+(?:is\s+|are\s+)?(?:not\s+supported|unavailable)\b|\bnot\s+support\s+extend(?:ed)?\s+(?:mode|displays?)\b/;
  var SST_OS_RE=/\b(windows|mac\s?os|macos|macbooks?|macs?)\s+(?:systems?\s+|devices?\s+|computers?\s+)?(?:are\s+|is\s+)?(?:limited\s+to|only\s+supports?|supports?\s+only)\s+sst\b/, SST_ANY_RE=/\bsst\s+only\b|\bonly\s+supports?\s+sst\b|\blimited\s+to\s+sst\b/;
  function displayRules(p){
    var out=[];
    sentencesOf(p).forEach(function(s){
      var m; OS_STMT_RE.lastIndex=0;
      while((m=OS_STMT_RE.exec(s))) out.push({ fam:osFam(m[4]), kind:'stmt', n:COUNT_WORD[m[1]], r:+m[2], hz:m[3]?+m[3]:null });
      var fams=uniq((s.match(OS_WORD_RE)||[]).map(osFam));
      if(fams.length===1 && OS_MIRROR_RE.test(s)) out.push({ fam:fams[0], kind:'mirrorOnly' });
      else if(!fams.length && ANY_MIRROR_RE.test(s)) out.push({ fam:'*', kind:'mirrorOnly' });
      var om=s.match(OS_ONLY_RE); if(om) out.push({ fam:osFam(om[1]), kind:'only', n:COUNT_WORD[om[2]] });
      var so=s.match(SST_OS_RE); if(so) out.push({ fam:osFam(so[1]), kind:'sstOnly' });
      else if(fams.length<=1 && SST_ANY_RE.test(s)) out.push({ fam:fams.length?fams[0]:'*', kind:'sstOnly' });
    });
    return out;
  }
  /* Structural display matching (fourth round, section 13): a display ask is split into its REQUIRED components, each CONFIRMED /
     CONTRADICTED / UNKNOWN; any contradicted component = "no", all confirmed = "yes", otherwise UNKNOWN (evidence).
       count  external displays: an OS "only X supports N displays" rule for another OS = no; the asked OS's own statement covering
              n = yes; else the product's stated maximum (mirror statements excluded for an extended ask) decides; none = unknown
       mode   (n >= 2) a mirror-only rule for the asked OS or for every OS: EXTEND = no, MIRROR = yes, unstated = unknown;
              an SST-only rule for the asked OS or every OS: anything but MIRROR = unknown (never a proven extended desktop)
     a = { n, ext, mirror, os } */
  /* M1: a positive statement of the display mode itself ("Support mirror mode and extended mode", "expand mode"); a sentence that
     limits or negates a mode never counts */
  function modeStated(p,kind){
    var re=kind==='ext'?/\b(?:extend(?:ed)?|expand(?:ed)?)\s+(?:mode|display|desktop|screen)s?\b/:/\b(?:mirror(?:ed|ing)?|duplicat(?:e|ed|ion))\s+(?:mode|display|screen)s?\b/;
    return sentencesOf(p).some(function(s){ return re.test(s) && !/\bnot\b|\bunavailable\b|\blimited\b|\bonly\b/.test(s); });
  }
  function combine(states){ return has(states,'CONTRADICTED')?'CONTRADICTED':(states.every(function(s){ return s==='CONFIRMED'; })?'CONFIRMED':'UNKNOWN'); }
  function displayParts(p,a,rules){
    var mine=function(r){ return r.fam==='*' || (!!a.os && r.fam===a.os); }, count=null, mode='CONFIRMED';
    if(a.os && rules.some(function(r){ return r.kind==='only' && r.fam!==a.os && a.n>=r.n; }) && !rules.some(function(r){ return r.kind==='only' && r.fam===a.os; })) count='CONTRADICTED';
    else if(a.os && rules.some(function(r){ return r.kind==='stmt' && r.fam===a.os && r.n>=a.n; })) count='CONFIRMED';
    else { var ds=displayStatements(p), N=null; ds.list.forEach(function(s){ if(!(a.ext && s.mirror) && (N==null || s.n>N)) N=s.n; });
      if(N==null && ds.single) N=1;
      count=N==null?'UNKNOWN':(a.n<=N?'CONFIRMED':'CONTRADICTED'); }
    var mirRule=rules.some(function(r){ return r.kind==='mirrorOnly' && mine(r); }), sstRule=rules.some(function(r){ return r.kind==='sstOnly' && mine(r); });
    if(a.n>=2){
      if(mirRule) mode=a.ext?'CONTRADICTED':(a.mirror?'CONFIRMED':'UNKNOWN');
      else if(!a.mirror && sstRule) mode='UNKNOWN';
    }
    /* fifth round, M1: a mode asked for ONE external display ("extended mode on macOS"). The mirror-only / SST-only rules describe
       multi-monitor setups, so for one display they neither prove nor exclude EXTENDED: unknown (never YES). MIRROR under a
       mirror-only rule is the stated mode. */
    else if(a.n===1 && (a.ext || a.mirror)){
      var multi=displayStatements(p).list.some(function(s){ return s.n>=2 && !s.mirror; });
      var extOk=!mirRule && !sstRule && (modeStated(p,'ext') || multi), mirOk=mirRule || modeStated(p,'mir');
      if((a.ext && extOk) || (a.mirror && mirOk)){ mode='CONFIRMED'; if(count!=='CONTRADICTED') count='CONFIRMED'; }   /* a stated mode implies a display */
      else mode='UNKNOWN';
    }
    return { count:count, mode:mode };
  }
  function displaysState(p,a){ var c=displayParts(p,a,displayRules(p)); return combine([c.count,c.mode]); }

  /* ---------- video modes (P3 composite, P9d direction / port scope) ----------
     Text mentions per clause: { r, hz, bound ("up to" / "max"), dir ('in' | 'out' | '' from the nearest input / output wording),
     ports }. An ask uses mentions of its own direction; undirected mentions too, unless the product states both an input and an
     output side (a capture card, a converter), where only the matching side counts. A named output port uses that port's
     mentions only. */
  var VID_IN_G=/\binput\b|\bhdmi\s?in\b|\bsource\b/g, VID_OUT_G=/\boutput\b|\bout\b|\bcaptur(?:e|es|ing)\b|\brecord(?:s|ing|ed)?\b/g;
  function lastAt(s,re){ var m, i=-1; re.lastIndex=0; while((m=re.exec(s))) i=m.index; return i; }
  function portsIn(cl){ var o=[]; if(/\bhdmi\b/.test(cl)) o.push('hdmi'); if(/\bdp\b|\bdisplay\s?port\b/.test(cl)) o.push('dp');
    if(/\busb-?c\b|\btype-?c\b|\bthunderbolt\b/.test(cl)) o.push('usb-c'); if(/\bvga\b/.test(cl)) o.push('vga'); if(/\bdvi\b/.test(cl)) o.push('dvi'); return o; }
  function vidTextMentions(p){
    var out=[];
    clausesOf(textOf(p)).forEach(function(c0){ c0.split(/,(?!\d)/).forEach(function(cl){
      cl=cl.replace(/\b(\d{1,2}k)\s?[*x×]\s?\d{1,2}k\b/g,'$1');                 /* "4K*2K@60Hz" = one 4K mode */
      var ports=portsIn(cl), m, re=/\b(\d{1,2})k(?:\s*@?\s*(\d{2,3})\s?hz)?(?![a-z0-9])|\b(\d{3,4})p(?:\s*@?\s*(\d{2,3})\s?hz)?(?![a-z0-9])/g;
      while((m=re.exec(cl))){
        var r=m[1]?+m[1]:pRes(m[3]), hz=m[1]?(m[2]?+m[2]:null):(m[4]?+m[4]:null); if(!has(RES_TIERS,r)) continue;
        var before=cl.slice(0,m.index), after=cl.slice(m.index+m[0].length, m.index+m[0].length+16), bi=lastAt(before,VID_IN_G), bo=lastAt(before,VID_OUT_G);
        var dir=/^\s*\)?\s*(?:input|in)\b/.test(after)?'in':(/^\s*\)?\s*(?:output|out)\b/.test(after)?'out':(bi>bo?'in':(bo>bi?'out':'')));
        var bound=/(?:up\s?to|max(?:imum)?(?:\s+(?:output|input))?(?:\s+resolution)?(?:\s+(?:of|up\s+to))?)\s*:?\s*(?:\d{1,2}k(?:\s*@?\s*\d{2,3}\s?hz)?\s+or\s+)?$/.test(before) || /^\s*\)?\s*max\b/.test(after);
        out.push({ r:r, hz:hz, bound:bound, dir:dir, ports:ports });
      } }); });
    return out;
  }
  function vidUsable(opts,code,p,dir,port){
    var tm=vidTextMentions(p), both=tm.some(function(m){ return m.dir==='in'; }) && tm.some(function(m){ return m.dir==='out'; });
    var ms=tm.filter(function(m){ return m.dir===dir || (m.dir==='' && !both); });
    if(port) return ms.filter(function(m){ return has(m.ports,port); });
    if(!both){ var f=factOf(opts,code), at=isObj(field(f,'attrs'))?f.attrs:null, vd=isObj(field(at,'video'))?at.video:null;
      arr(field(vd,'mentions')).forEach(function(x){ if(isObj(x) && x.confirmed===true && typeof x.r==='number') ms.push({ r:x.r, hz:typeof x.hz==='number'?x.hz:null, bound:false, dir:'', ports:[] }); }); }
    return ms;
  }
  function vidModeState(opts,code,p,R,H,dir,port){
    var ms=vidUsable(opts,code,p,dir,port);
    if(ms.some(function(m){ return (R==null || m.r>=R) && (H==null || (m.hz!=null && m.hz>=H)); })) return 'CONFIRMED';
    if(R!=null && !port && negClauseTexts(p).some(function(x){ return new RegExp('\\b'+R+'k\\b').test(x); })) return 'CONTRADICTED';   /* scoped negative naming the resolution */
    var top=0; ms.forEach(function(m){ if(m.r>top) top=m.r; });
    if(R!=null && top<R && ms.some(function(m){ return m.bound; })) return 'CONTRADICTED';   /* a stated maximum below the asked resolution, no higher mention */
    /* major 3: a refresh maximum limits only its OWN resolution tier. 4K@120 says nothing about 1080p / 1440p, 8K@30 nothing about
       4K: "no" only when the asked tier itself has stated maxima, all below the asked refresh; a refresh with no resolution is never
       a "no" (a lower, unstated resolution may reach it) */
    if(R!=null && H!=null){ var b=ms.filter(function(m){ return m.r===R && m.bound && m.hz!=null; }).map(function(m){ return m.hz; });
      if(b.length && Math.max.apply(null,b)<H) return 'CONTRADICTED'; }
    return 'UNKNOWN';
  }
  /* composite: n simultaneous displays at { r, hz } (port / extended / OS if asked) = the display components (count, mode) plus the
     resolution component. Every one of the n displays is read at the asked mode (a mixed setup carries one ask per display, each
     at the setup's total). Resolution: an OS-scoped statement for the asked OS overrides the generic ones -- the same resolution
     at a lower refresh = "no"; an OS statement covering the setup = "yes"; an OS that states its own multi-display modes, none
     covering, is never confirmed by a generic statement (stricter OS-specific statement wins). Otherwise a generic n-display
     statement covering it = "yes" (not for a named port), the mode already failing on a single display = "no", else unknown. */
  function vidMultiState(opts,code,p,a){
    var rules=displayRules(p), parts=displayParts(p,a,rules), res=null;
    var cover=function(s){ return s.n>=a.n && (a.r==null || (s.r!=null && s.r>=a.r)) && (a.hz==null || (s.hz!=null && s.hz>=a.hz)); };
    var strict=false;
    if(a.os){
      var os=rules.filter(function(r){ return r.kind==='stmt' && r.fam===a.os; });
      if(os.some(function(s){ return s.n>=a.n && a.r!=null && s.r===a.r && a.hz!=null && s.hz!=null && s.hz<a.hz; })) res='CONTRADICTED';   /* "dual 4K@30Hz (Windows)" vs dual 4K60 on Windows */
      else if(!a.port && os.some(cover)) res='CONFIRMED';
      else strict=os.some(function(s){ return s.n>=a.n; });
    }
    if(!res){
      var ok=!strict && !a.port && displayStatements(p).list.some(function(s){ return cover(s) && !(a.ext && s.mirror); });
      res=ok?'CONFIRMED':(vidModeState(opts,code,p,a.r,a.hz,a.dir,a.port)==='CONTRADICTED'?'CONTRADICTED':'UNKNOWN');
    }
    return combine([res,parts.mode,parts.count==='CONTRADICTED'?'CONTRADICTED':'CONFIRMED']);
  }

  /* ---------- operating systems: family + version (P4, P5) ----------
     Versions are ranges [lo, hi) on major*1000+minor (macOS names map to numbers; Windows RT / XP / Vista are fixed points).
     Statements: an exact list ("Windows 11/10/8.1"), a lower bound ("10.11 and above", "26 or later", "11+") or an upper bound
     ("Version below 11", "up to 10.15"). Positive statements come from the text without its negative clauses; negatives from the
     scoped negative targets; an exhaustive "only supports X and Y" must be a pure OS list (a "partial version of Windows and macOS"
     is never exhaustive). A family question is answered by a family-level positive / negative; a version question by the ranges. */
  var MAC_NAMES=[['el capitan','10.11'],['high sierra','10.13'],['sierra','10.12'],['mojave','10.14'],['catalina','10.15'],['big sur','11'],['monterey','12'],['ventura','13'],['sonoma','14'],['sequoia','15'],['tahoe','26']];
  var V_ALT='\\d{1,2}(?:\\.(?:\\d{1,2}|x))?(?![\\d.])|el\\s?capitan|high\\s?sierra|sierra|mojave|catalina|big\\s?sur|monterey|ventura|sonoma|sequoia|tahoe|xp|vista|rt';
  var OS_TOKENS=[{ fam:'macos', re:/\b(?:mac\s?os(?:\s?x)?|macos|os\s?x)(?![a-z])/g, loose:/\bmac(?![a-z])/g },{ fam:'windows', re:/\bwin(?:dows)?(?![a-z])/g },
    { fam:'ipados', re:/\bipad\s?os(?![a-z])/g },{ fam:'ios', re:/\bios(?![a-z])/g },{ fam:'android', re:/\bandroid(?![a-z])/g },{ fam:'linux', re:/\blinux\b|\bubuntu\b/g },
    { fam:'chromeos', re:/\bchrome\s?os\b|\bchromebook\b/g }];
  var INF=1e9;
  function verNorm(t){ t=str(t).replace(/\s+/g,' ').trim(); for(var i=0;i<MAC_NAMES.length;i++) if(t.replace(/\s/g,'')===MAC_NAMES[i][0].replace(/\s/g,'')) return MAC_NAMES[i][1]; return t; }
  function verVal(t,fam){
    t=verNorm(t);
    if(fam==='windows'){ if(t==='xp') return [5001,5002]; if(t==='vista') return [6000,6001]; if(t==='rt') return [90000,90001]; }
    var m=t.match(/^(\d{1,2})(?:\.(\d{1,2}|x))?$/); if(!m) return null; var a=+m[1];
    if(m[2]==='x') return [a*1000,(a+1)*1000];
    if(m[2]!=null) return [a*1000+(+m[2]),a*1000+(+m[2])+1];
    return fam==='windows'?[a*1000,a*1000+1]:[a*1000,(a+1)*1000];
  }
  /* version expression right after an OS token -> { ranges:[[lo,hi)], bound, tok } or null */
  function parseVer(s,fam){
    s=str(s); if(!has(['macos','windows','ipados','ios','android'],fam)) return null;
    var m=s.match(new RegExp('^\\s*\\(?\\s*(?:version\\s*:?\\s*)?(below|under|before|lower\\s+than|earlier\\s+than|older\\s+than|prior\\s+to|up\\s+to)\\s+('+V_ALT+')(?![a-z0-9])'));
    if(m){ var b=verVal(m[2],fam); if(!b) return null; return { ranges:[[0,/up\s+to/.test(m[1])?b[1]:b[0]]], bound:true, tok:verNorm(m[2]), op:'below' }; }
    m=s.match(new RegExp('^\\s*\\(?\\s*(?:version\\s*:?\\s*)?('+V_ALT+')((?:\\s*(?:[\\/,&]|\\band\\b|\\bor\\b)\\s*(?:'+V_ALT+'))*)(\\s*(?:\\+|(?:and|or)\\s+(?:above|later|higher|newer|up|after|below|earlier|lower|older)|above|onwards?))?(?![a-z0-9])'));
    if(!m) return null;
    var toks=[m[1]].concat(m[2]?(m[2].match(new RegExp(V_ALT,'g'))||[]):[]), vals=toks.map(function(t){ return verVal(t,fam); }).filter(Boolean);
    if(!vals.length) return null;
    var suf=str(m[3]).trim();
    if(/\+|above|later|higher|newer|\bup\b|after|onward/.test(suf)) return { ranges:[[Math.min.apply(null,vals.map(function(v){ return v[0]; })),INF]], bound:true, tok:verNorm(m[1]), op:'plus' };
    if(/below|earlier|lower|older/.test(suf)) return { ranges:[[0,Math.max.apply(null,vals.map(function(v){ return v[1]; }))]], bound:true, tok:verNorm(m[1]), op:'below' };
    return { ranges:vals, bound:false, tok:verNorm(m[1]), op:'' };
  }
  /* versioned OS statements in a text: [{ fam, ranges, bound }] (a bare "mac" counts only when a version follows it) */
  function osStatements(t){
    var out=[]; t=str(t);
    OS_TOKENS.forEach(function(o){ [o.re,o.loose].forEach(function(re){ if(!re) return; var m; re.lastIndex=0;
      while((m=re.exec(t))){ var pv=parseVer(t.slice(m.index+m[0].length),o.fam); if(pv) out.push({ fam:o.fam, ranges:pv.ranges, bound:pv.bound }); } }); });
    return out;
  }
  /* OS scope of a negative target ("the iOS system", "Windows RT", "macOS 11 and above"): [{ fam, key, range|null }] */
  var OS_GENERIC_REST=/^\s*(?:$|systems?\b|os\b|operating\s+systems?\b|platforms?\b|devices?\b|computers?\b|pcs?\b|laptops?\b|versions?\b)/;
  function osTargets(tg){
    var out=[];
    OS_TOKENS.forEach(function(o){ o.re.lastIndex=0; var m=o.re.exec(tg); if(!m) return; var rest=tg.slice(m.index+m[0].length), pv=parseVer(rest,o.fam);
      if(pv) pv.ranges.forEach(function(r){ out.push({ fam:o.fam, key:'os:'+o.fam+'-'+slug(pv.tok), range:r }); });
      else if(OS_GENERIC_REST.test(rest) || /^\s*[\/,&]|^\s+(?:and|or)\b/.test(rest)) out.push({ fam:o.fam, key:'os:'+o.fam, range:null });   /* family-wide; an unparsed qualifier ("S mode") is not */
    });
    return out;
  }
  /* question side: the asked OS key, version-refined ("os:macos-14", "os:macos-11-plus", "os:windows-8.1") */
  function osAskKey(qn,base){
    var fam=str(base).replace(/^os:/,'').split('-')[0], o=null; OS_TOKENS.forEach(function(x){ if(x.fam===fam) o=x; });
    if(!o) return base;
    var res=[o.re,o.loose].filter(Boolean), pv=null;
    res.forEach(function(re){ var m; re.lastIndex=0; while(!pv && (m=re.exec(qn))) pv=parseVer(qn.slice(m.index+m[0].length),fam); });
    if(!pv) return base;
    return 'os:'+fam+'-'+slug(pv.tok)+(pv.op==='plus'?'-plus':(pv.op==='below'?'-below':''));
  }
  function osAskRange(key){
    var m=str(key).match(/^os:(macos|windows|ipados|ios|android|linux|chromeos)(?:-([a-z0-9.]+?))?(-plus|-below)?$/); if(!m) return null;
    if(!m[2]) return { fam:m[1], range:null };
    var v=verVal(m[2],m[1]); if(!v) return null;
    return { fam:m[1], range:m[3]==='-plus'?[v[0],INF]:(m[3]==='-below'?[0,v[0]]:v) };
  }
  function within(a,b){ return a[0]>=b[0] && a[1]<=b[1]; }
  function overlaps(a,b){ return a[0]<b[1] && b[0]<a[1]; }
  var OS_FAMILY_POS={ macos:/\bmac\s?os\b|\bmacos\b|\bos\s?x\b|\bmac\b(?!\s?(?:mini|studio|pro|book))/, windows:/\bwindows\b/, ipados:/\bipad\s?os\b/, ios:/\bios\b/, android:/\bandroid\b/,
    linux:/\blinux\b|\bubuntu\b/, chromeos:/\bchrome\s?os\b|\bchromebook\b/ };
  function osState(p,key){
    var a=osAskRange(key); if(!a) return 'UNKNOWN';
    var negs=negativeScopes(p), i, n;
    for(i=0;i<negs.length;i++){ n=negs[i];
      if(n.kind==='os' && n.fam===a.fam && (!n.range || (a.range && within(a.range,n.range)))) return 'CONTRADICTED';
      if(n.kind==='os-only'){ if(!has(n.fams,a.fam)) return 'CONTRADICTED';
        var lim=arr(n.ranges[a.fam]); if(a.range && lim.length && !lim.some(function(r){ return overlaps(a.range,r); })) return 'CONTRADICTED'; } }
    var t=stripNegatives(textOf(p)), st=osStatements(t).filter(function(s){ return s.fam===a.fam; });
    if(!a.range) return (OS_FAMILY_POS[a.fam].test(t) || st.length)?'CONFIRMED':'UNKNOWN';
    var inPos=st.some(function(s){ return s.ranges.some(function(r){ return within(a.range,r); }); });
    var inBounds=st.filter(function(s){ return s.bound; }).every(function(s){ return s.ranges.some(function(r){ return within(a.range,r); }); });
    return inPos && inBounds?'CONFIRMED':'UNKNOWN';                       /* a version outside the stated ranges is not a "no" without a negative */
  }
  /* a family-level "yes" that the catalogue limits by version (a versioned negative or a bounded positive): caveat flag */
  function osVersionLimited(p,fam){
    return negativeScopes(p).some(function(n){ return n.kind==='os' && n.fam===fam && n.range; }) ||
      osStatements(stripNegatives(textOf(p))).some(function(s){ return s.fam===fam && s.bound; });
  }

  /* ---------- explicit, scoped catalogue negatives ----------
     ("does not support the iOS system", "Do not support APPLE Device", "X is not supported", "only compatible with Windows ...").
     Scope comes from a closed target table; a negative never reaches beyond its target: "Apple device" covers Apple hardware, not
     the macOS operating system; a versioned OS covers that version range only. */
  var NEG_RX=[/(?:do(?:es)?\s*n[o']?t|don'?t|doesn'?t|cannot|can'?t|not)\s+(?:support|be\s+compatible\s+with|compatible\s+with|work\s+(?:with|for|on))\s+(?:the\s+|any\s+)?([^\/.;,\n】:()]{1,40})/g,
    /([a-z][^\/.;,\n】:()]{0,30}?)\s+(?:is|are)\s+not\s+(?:supported|compatible)/g, /\b(?:incompatible|not\s+compatible)\s+with\s+(?:the\s+|any\s+)?([^\/.;,\n】:()]{1,40})/g];
  /* most specific first; the first matching target is the scope. Qualifier tokens left in the target (a generation, year, chip or
     size: "Switch 2", "Pixel 7", "MacBook with M1", "2018 iPad Pro 11") must all appear in the asked device; alternatives joined by
     "or" / "/" / "," / "and" ("2024 or 2025 iPad models") are separate qualifier sets, any one of which may match (P9a). */
  var DEV_TARGETS=[{ re:/\bipad\s+pro\b/, prefix:'apple:ipad', sub:/\bpro\b/ },{ re:/\bipad\s+air\b/, prefix:'apple:ipad', sub:/\bair\b/ },{ re:/\bipad\b/, prefix:'apple:ipad' },
    { re:/\biphone\b/, prefix:'apple:iphone' },{ re:/\bmacbook\s+pro\b/, line:'apple:macbook', sub:/\bpro\b/ },{ re:/\bmacbook\s+air\b/, line:'apple:macbook', sub:/\bair\b/ },{ re:/\bmacbook\b/, line:'apple:macbook' },
    { re:/\bpixel\b/, prefix:'google:pixel' },{ re:/\bgalaxy\b|\bsamsung\s+(?:phones?|devices?)\b/, line:'samsung:galaxy' },{ re:/\bps5\b|\bplaystation\s?5\b/, prefix:'sony:' },
    { re:/\bnintendo\s+switch\b|\bswitch\s+(?:2|oled|lite)\b/, line:'nintendo:switch' },{ re:/\bapple\s+(?:device|devices|product|products)\b|^apple\b/, vendor:'apple' }];
  var NON_DEVICE=/\b(headsets?|headphones?|earphones?|earbuds?|cables?|chargers?|accessor(?:y|ies)|cases?|adapters?|mics?|microphones?|keyboards?|mouse|remotes?|controllers?|apps?|software)\b/;
  var PARTIAL=/\b(other|some|certain|older|old|previous|specific|most|few|partial)\b/;
  var QUAL_STOP=/^(the|a|an|with|and|or|of|models?|devices?|series|version|gen|generation|inch|in|for|on|ipad|iphone|macbook|pro|air|pixel|galaxy|samsung|nintendo|switch|ps5|playstation|apple|google|sony|phones?|products?)$/;
  function qualAlts(rest){ return str(rest).split(/\s+or\s+|\/|,|\s+and\s+/).map(function(seg){ return (seg.match(/[a-z0-9.]+/g)||[]).filter(function(w){ return /\d/.test(w) && !QUAL_STOP.test(w); }); }).filter(function(a){ return a.length; }); }
  /* exhaustive OS list: only OS names, versions and separators may remain */
  function pureOsList(s){
    var rest=' '+str(s)+' ', fams=[], ranges=dict();
    OS_TOKENS.forEach(function(o){ [o.re].forEach(function(re){ var m; re.lastIndex=0; while((m=re.exec(rest))){ if(fams.indexOf(o.fam)<0) fams.push(o.fam);
      var pv=parseVer(rest.slice(m.index+m[0].length),o.fam); if(pv) ranges[o.fam]=arr(ranges[o.fam]).concat(pv.ranges); } }); });
    var left=rest; OS_TOKENS.forEach(function(o){ left=left.replace(o.re,' '); });
    left=left.replace(new RegExp('(?:'+V_ALT+')','g'),' ').replace(/\b(?:and|or|the|systems?|operating|os|above|later|higher|newer|below|earlier|lower|older|up|to|version)\b|[\/,&+()\s]/g,'');
    return fams.length && !left?{ fams:fams, ranges:ranges }:null;
  }
  function negativeScopes(p){
    var t=textOf(p), out=[], m;
    NEG_RX.forEach(function(rx){ rx.lastIndex=0; while((m=rx.exec(t))){ var tg=m[1].trim(), txt=m[0].trim().slice(0,80);
      if(NON_DEVICE.test(tg) || PARTIAL.test(tg)) continue;                 /* accessories / "other" / "some": not a device or OS scope */
      osTargets(tg).forEach(function(o){ out.push({ kind:'os', key:o.key, fam:o.fam, range:o.range, text:txt }); });
      for(var i=0;i<DEV_TARGETS.length;i++){ var dt=DEV_TARGETS[i]; if(!dt.re.test(tg)) continue;
        out.push({ kind:'device', vendor:dt.vendor||null, prefix:dt.prefix||null, line:dt.line||null, sub:dt.sub||null, alts:qualAlts(tg.replace(dt.re,' ')), text:txt }); break; } } });
    var only=/\bonly\s+(?:support(?:s|ed)?|compatible\s+with|works?\s+(?:with|on))\s+([^.;\n]{1,60})/g;
    while((m=only.exec(t))){ var pl=pureOsList(m[1]); if(pl) out.push({ kind:'os-only', fams:pl.fams, keys:pl.fams.map(function(f){ return 'os:'+f; }), ranges:pl.ranges, text:m[0].trim().slice(0,80) }); }
    return out;
  }
  function negCoversDevice(neg,e){ var raw=normText(e.raw), toks=raw.match(/[a-z0-9.]+/g)||[];
    return neg.some(function(n){ if(n.kind!=='device') return false;
      var hit=(n.vendor && e.key.indexOf(n.vendor+':')===0) || (n.prefix && (e.key.indexOf(n.prefix)===0 || str(e.line).indexOf(n.prefix)===0)) || (n.line && e.line===n.line);   /* line too: a year-first key ("apple:2024-ipad-air") */
      if(!hit) return false;
      if(n.sub && !n.sub.test(raw)) return false;                          /* "iPad Pro" never covers a plain iPad / iPad Air */
      return !n.alts.length || n.alts.some(function(a){ return a.every(function(q){ return toks.indexOf(q)>=0; }); }); }); }
  function stripNegatives(t){ NEG_RX.forEach(function(rx){ t=t.replace(new RegExp(rx.source,'g'),' '); }); return t; }
  function textRateGbps(opts,code){ var p=prodOf(opts,code); if(!p) return null; var t=textOf(p), m, re=/\b(\d+(?:\.\d+)?)\s?(gbps|mbps)\b/g, best=null;
    while((m=re.exec(t))){ var v=m[2]==='gbps'?+m[1]:+m[1]/1000; if(best==null || v>best) best=v; } return best; }
  function textHas(opts,code,re,nameOnly){ var p=prodOf(opts,code); if(!p) return false; return re.test(nameOnly?nameOf(p):textOf(p)); }
  function negClauseTexts(p){ var t=textOf(p), out=[], m; NEG_RX.forEach(function(rx){ var r2=new RegExp(rx.source,'g'); while((m=r2.exec(t))) out.push(m[0]); }); return out; }
  function patternOf(list,key){ for(var i=0;i<list.length;i++) if(list[i].key===key) return list[i].re; return null; }

  function vidOs(ask){ return ask.os==='macos' || ask.os==='windows'?ask.os:null; }
  /* fifth round, VERO major M2: MST asked for one OS ("MST on Mac") is answered only by OS-scoped evidence.
       an SST-only rule for that OS (or every OS)            -> no (SST only = no multi-stream)
       "only <OS> systems support MST"                        -> yes for that OS, no for every other OS
       "MST for <OS>", "<OS> supports MST"                    -> yes for the named OS, unknown for others
       an MST statement naming no OS ("supports MST")         -> unknown: a product-level claim is no proof for a given OS */
  var MST_W='(?:mst|multi[-\\s]?stream(?:\\s+transport)?)', MST_OS='(windows|win\\d*|mac\\s?os(?:\\s?x)?|macos|macbooks?|macs?|linux|ubuntu|chrome\\s?os|chromebooks?)';
  var MST_ONLY_RE=new RegExp('\\bonly\\s+'+MST_OS+'\\s+(?:systems?\\s+|devices?\\s+|computers?\\s+)?(?:supports?|can\\s+use)\\s+'+MST_W+'\\b','g');
  var MST_FOR_RE=new RegExp('\\b'+MST_W+'(?:\\s*\\(mst\\))?\\s+(?:for|on|in|with)\\s+'+MST_OS+'\\b|\\b'+MST_OS+'\\s+(?:systems?\\s+|devices?\\s+|computers?\\s+)?supports?\\s+'+MST_W+'\\b','g');
  function mstFam(w){ return /^win/.test(w)?'windows':(/linux|ubuntu/.test(w)?'linux':(/chrome/.test(w)?'chromeos':'macos')); }
  function mstState(p,fam){
    if(displayRules(p).some(function(r){ return r.kind==='sstOnly' && (r.fam==='*' || r.fam===fam); })) return 'CONTRADICTED';
    var only=[], scoped=[], m;
    sentencesOf(p).forEach(function(s){
      MST_ONLY_RE.lastIndex=0; while((m=MST_ONLY_RE.exec(s))) only.push(mstFam(m[1]));
      MST_FOR_RE.lastIndex=0; while((m=MST_FOR_RE.exec(s))) scoped.push(mstFam(m[1]||m[2])); });
    if(only.length) return has(only,fam)?'CONFIRMED':'CONTRADICTED';
    return has(scoped,fam)?'CONFIRMED':'UNKNOWN';
  }
  function localState(opts,code,ask){
    ask=isObj(ask)?ask:{};
    var f=factOf(opts,code), A=isObj(field(f,'attrs'))?f.attrs:{}, p=prodOf(opts,code);
    switch(ask.a){
      case 'video.mode': {
        var v=isObj(ask.v)?ask.v:{}, R=typeof v.r==='number'?v.r:null, H=typeof v.hz==='number'?v.hz:null, dir=v.dir==='in'?'in':'out', port=typeof v.port==='string'?v.port:null;
        if(!p || (R==null && H==null)) return 'UNKNOWN';
        if(typeof v.n==='number' && v.n>=2) return vidMultiState(opts,code,p,{ r:R, hz:H, n:v.n, ext:ask.ext===true, mirror:ask.mirror===true, os:vidOs(ask), dir:dir, port:port });
        return vidModeState(opts,code,p,R,H,dir,port); }
      case 'video.displays': return p && typeof ask.v==='number'?displaysState(p,{ n:ask.v, ext:ask.ext===true, mirror:ask.mirror===true, os:vidOs(ask) }):'UNKNOWN';
      case 'charge.watts': { if(!p) return 'UNKNOWN'; var fam=familyOf(opts,code);
        return wattState(p,fam,wattAskRole(str(ask.qn),fam),typeof ask.v==='number'?ask.v:null); }
      case 'data.rate': {
        var g=confirmedNum(A.dataGbps); if(!g){ var tr=textRateGbps(opts,code); if(tr==null) return 'UNKNOWN'; g={ value:tr }; }
        if(g.conflict) return 'CONTRADICTED_INTERNAL';
        if(typeof ask.v!=='number') return 'CONFIRMED'; return g.value>=ask.v?'CONFIRMED':'CONTRADICTED'; }
      case 'host.capacityMax': return p?capacityStatements(p).state:'UNKNOWN';
      case 'host.bays': return isObj(A.nas) && A.nas.bays?'CONFIRMED':'UNKNOWN';
      case 'host.driveInterface': return textHas(opts,code,/\bsata\b|\bnvme\b/)?'CONFIRMED':'UNKNOWN';
      case 'host.driveFormFactor': return textHas(opts,code,/\b3\.5\s?(?:"|''|in|inch)|\b2\.5\s?(?:"|''|in|inch)|\bm\.2\b/)?'CONFIRMED':'UNKNOWN';
      case 'charge.protocol': {
        var fl=isObj(A.flags)?A.flags:{};
        if(ask.v==='std:usb-pd' && isObj(fl.pd) && fl.pd.confirmed===true) return 'CONFIRMED';
        var re=patternOf(CHARGING,ask.v); return re && textHas(opts,code,re)?'CONFIRMED':'UNKNOWN'; }
      case 'standard.version': { var rs=patternOf(STANDARDS,ask.v); return rs && textHas(opts,code,rs,true)?'CONFIRMED':'UNKNOWN'; }   /* name only: "works with Thunderbolt 4" in a description is not the product's own standard */
      case 'protocol.support': {
        if(ask.v==='std:mst' && typeof ask.os==='string' && ask.os) return p?mstState(p,ask.os):'UNKNOWN';   /* M2: OS-scoped MST */
        var rp=patternOf(PROTOCOLS,ask.v); return rp && textHas(opts,code,rp)?'CONFIRMED':'UNKNOWN'; }
      case 'os.support': {
        if(/^app:/.test(str(ask.e)) || !p) return 'UNKNOWN';
        return osState(p,str(ask.e)); }
      case 'os.driver': return textHas(opts,code,/plug\s*(?:and|&|n)\s*play|driver[-\s]?free|no\s+drivers?\s+(?:needed|required)|without\s+(?:any\s+)?drivers?/)?'CONFIRMED':'UNKNOWN';
      default: return 'UNKNOWN';                                                /* compat.*, device.*, manual, install, lifecycle: never local */
    }
  }

  /* ============================== 7. classifier ============================== */
  function familyOf(opts,code){ var t=field(factOf(opts,code),'type'); return isObj(t) && typeof t.family==='string'?t.family:null; }
  function deviceAttrFor(fam){
    if(has(['nas','enclosure','card_reader'],fam)) return 'device.interface';
    if(has(['charger','power_bank','charging_cable'],fam)) return 'device.chargeInput';
    if(has(['hub_dock','video_adapter','video_cable','av_switch'],fam)) return 'device.video';
    return 'device.ports';
  }
  /* asks: what the question wants, independent of the subject. bound = needs a UGREEN subject. */
  function collectAsks(qn, ents, fl, nExplicit){
    var asks=[], dev=ents.filter(function(e){ return e.kind==='device' || e.kind==='drive'; });
    var os=ents.filter(function(e){ return e.kind==='os'; }), std=ents.filter(function(e){ return e.kind==='std'; }),
        prot=ents.filter(function(e){ return e.kind==='protocol'; }), chg=ents.filter(function(e){ return e.kind==='charging'; });
    var watts=wattsAsk(qn), gb=gbpsAsk(qn), strong=fl.support || fl.compat, ask=strong || fl.yesno, weak=!strong;
    var apps=ents.filter(function(e){ return e.kind==='app'; });
    if(fl.compat || fl.support){
      dev.forEach(function(e){ asks.push({ kind:'compat', e:e }); });
      os.forEach(function(e){ asks.push({ cls:'os_platform_support', a:'os.support', v:e.key, e:e.key, bound:true }); });
    }
    if(apps.length && (fl.compat || fl.support || fl.run || fl.yesno)) apps.forEach(function(e){ asks.push({ cls:'os_platform_support', a:'os.support', v:e.key, e:e.key, bound:true }); });
    if(fl.officialList) asks.push({ cls:'official_compat_list', a:'compat.list', bound:true, e:dev.length?dev[0].key:null });
    /* P3 composite video requirement: each mode carries the asked display count (n >= 2), output port and input direction when
       stated; the count is its own need; both form one claim (collapsed in classify) */
    var vr=displayRequirement(qn), vext=vr.mode==='EXTEND', vmir=vr.mode==='MIRROR', vport=videoPort(qn), vin=videoDir(qn)==='in', tot=vr.total>=2 && ask?vr.total:null;
    /* major 4: the OS a display question is scoped to ("on macOS", "on Windows", a Mac device) -> OS-specific display rules apply;
       carried in the request need's existing entity key e ("os:<family>") */
    var vos=null; ents.forEach(function(e){ if(!vos && e.kind==='os'){ var f=/^os:(macos|windows)/.exec(e.key); if(f) vos=f[1]; } });
    if(!vos && ents.some(function(e){ return e.kind==='device' && (e.line==='apple:macbook' || e.line==='apple:mac'); })) vos='macos';
    if(vr.displays.length && (ask || /\b(output|display|resolution|play|watch|lumabas)\b/.test(qn)))
      vr.displays.slice(0,3).forEach(function(v){ var mv={ r:v.r, hz:v.hz }; if(tot) mv.n=tot; if(vport) mv.port=vport; if(vin) mv.dir='in';
        asks.push({ cls:'display_video', a:'video.mode', v:mv, e:tot && vos?'os:'+vos:undefined, bound:true, weak:weak, ext:vext, mirror:vmir, os:vos }); });
    if(tot) asks.push({ cls:'display_video', a:'video.displays', v:tot, e:vos?'os:'+vos:undefined, bound:true, ext:vext, mirror:vmir, os:vos });
    else if(vr.modeOnly && ask) asks.push({ cls:'display_video', a:'video.displays', v:1, e:vos?'os:'+vos:undefined, bound:true, ext:vext, mirror:vmir, os:vos });   /* M1 */
    if(ask) chg.forEach(function(e){ asks.push({ cls:'charging_protocol', a:'charge.protocol', v:e.key, bound:true, vendorReq:e.vendorReq, weak:weak }); });
    if(watts!=null && ask) asks.push({ cls:'performance_limit', a:'charge.watts', v:watts, bound:true, weak:weak, qn:qn });   /* qn: the wattage role is read per subject (P6) */
    if(fl.wattsAsk) asks.push({ cls:'performance_limit', a:'charge.watts', v:null, bound:true, qn:qn });
    if(gb!=null && ask) asks.push({ cls:'performance_limit', a:'data.rate', v:gb, bound:true, weak:weak });
    if(fl.speed && gb==null) asks.push({ cls:'performance_limit', a:'data.rate', v:null, bound:true });
    if(fl.capacity || (fl.capacitySup && nExplicit)) asks.push({ cls:'performance_limit', a:'host.capacityMax', v:null, bound:true });
    if(std.length && fl.explain && std.length>=2) std.forEach(function(e){ asks.push({ cls:'standard_version', a:'standard.spec', s:e.key, bound:false }); });
    if(std.length && (ask || fl.explain)) std.forEach(function(e){ asks.push({ cls:'standard_version', a:'standard.version', v:e.key, bound:true, optional:fl.explain && std.length>=2, weak:weak && !fl.explain }); });
    /* M2: the OS family a protocol question is scoped to ("MST on Mac") travels with the ask (internal; the need keys are unchanged) */
    var pos=null; ents.forEach(function(e){ if(!pos && e.kind==='os'){ var f=/^os:([a-z]+)/.exec(e.key); if(f) pos=f[1]; } }); if(!pos && vos) pos=vos;
    prot.forEach(function(e){ if(ask) asks.push({ cls:'protocol_support', a:'protocol.support', v:e.key, bound:true, weak:weak, os:pos }); });
    if(fl.driver) asks.push({ cls:'os_platform_support', a:'os.driver', v:null, bound:true });
    if(fl.manual) asks.push({ cls:'manual_spec_detail', a:'manual.doc', bound:true });
    if(fl.install) asks.push({ cls:'installation_guidance', a:'install.guide', bound:true });
    if(fl.lifecycle) asks.push({ cls:'lifecycle_eol', a:'lifecycle.status', bound:true });
    /* a question only about an external storage model's own spec ("what interface does <drive> use") */
    if(!asks.length && dev.some(function(e){ return e.kind==='drive' && e.exact; }) && /\b(interface|rpm|cache|cmr|smr|form\s?factor|capacity|spec|specs|size)\b/.test(qn))
      asks.push({ cls:'external_device_spec', a:'device.interface', s:dev[0].key, bound:false });
    return asks;
  }
  /* Phase 1 (architecture review §2.1, owner-approved 2026-10-13): claim coverage. A YES needs every material qualifier of the
     question represented AND evaluated against evidence of the right scope. Detection is a small, broad cue lexicon kept apart
     from the precise parsers above; a qualifier family that is detected but not covered by an evaluated ask is a GAP, and a gap
     blocks YES (G-COVER): the decision becomes EVIDENCE with the qualifier's existing attribute open. A NO from the covered part
     stands (the unparsed qualifier only narrows the claim). Gaps:
       mode            a display mode word (extend / expand / mirror / separate screens ...) with no evaluated mode ask
       display_count   several displays / outputs (plural, both / each / dual / at the same time, HDMI 1 + HDMI 2 ...) on a
                       video claim that is evaluated for fewer than 2 displays (a single-display spec never proves a setup)
       display_os      a multi-display / mode claim scoped to a platform the display rules do not evaluate (Linux, iPad, two
                       OS ...); a single-display claim naming two OS, or scoped to an OS on a product with an OS-specific
                       single-display statement (the single-display path reads no OS)
       power_multi     several ports / devices / simultaneous use on a wattage claim with no explicit total wording (the total
                       never proves per-port or simultaneous wattage)
       power_port      a port scope ("the A port", "single / per / one port", an ordinal port, two named ports, a named port on
                       a family whose wattage is not read per port) that the wattage evaluation did not use
       mst / mst_os    MST asked in a form the protocol ask does not carry ("multi-stream transport"), or for a platform the MST
                       evaluation is not scoped to (iPad, DeX, two OS) -- generic OS support never proves MST
     Phase 1 corrective round (owner-approved 2026-10-13):
       power_device    a receiving device ("my laptop", "a single device", "phone") on a charger / power bank wattage claim
                       that was not evaluated per port (the 'device' role or one named port) -- the total never proves it
       display_count   also: a display setup / mode (plural displays, "display mode") on a claim with NO evaluated video ask
                       (generic OS support never proves a display requirement)
     R1 minimal rollback (owner-approved 2026-10-13): the corrective round's display-kind plural reading ("4K monitors" = a kind)
     and the stabilization's quantifier list are removed -- every plural display noun on a video ask counts displays again
     (Phase 1 behaviour: UNKNOWN unless a multi-display statement is evaluated); kind vs count is left to structured profiles */
  var MODE_CUE_RE=/\b(?:extend(?:ed|ing|s)?|extension|expand(?:ed|ing|s)?|mirror(?:ed|ing|s)?|duplicat(?:e|ed|es|ing|ion)|clon(?:e|ed|ing))\b(?!\s+(?:the\s+|your\s+|my\s+|its\s+)?(?:warranty|cables?|cords?|wires?|leads?|signals?|range|distance|length|reach|transmission|storage|capacity|memory|hdds?|ssds?|drives?|disks?|data|hard|up\s+to|to\s+\d|\d(?!\d*(?:\.\d+)?\s?(?:k|p|hz)\b)))|\b(?:separate|independent|different|magkaiba(?:ng)?|hiwalay|magkahiwalay|ibang|iba't[-\s]?ibang|ibat[-\s]?ibang|non[-\s]?identical|unique|individual|distinct)\s+(?:na\s+)?(?:\S+\s+)?(?:content|screens?|displays?|desktops?|images?|monitors?|tvs?|views?)\b|\bsame\s+(?:screen|content|display|image|picture)\b|\bspan(?:s|ned|ning)?\b(?!\s+of\b)|\bside[-\s]?by[-\s]?side\b|\bacross\s+(?:\S+\s+){0,2}(?:monitors|displays|screens|tvs)\b|\bper\s+(?:monitor|display|screen|tv)\b/;
  /* Phase 1 corrective (display / OS qualifier safety): MODE_CUE_RE also reads spanning / side-by-side / across-monitor /
     per-monitor wording and the separate-content forms hiwalay, ibang, unique, non-identical, individual, distinct; a mode word
     followed by a resolution / refresh ("extended 4K", "mirrored 1080p", "extend 60Hz") is a mode (only a length / other number
     after it -- "extend 2m" -- is not) */
  var NEAR_PORT='(?=(?:\\s+[a-z0-9-]+){0,3}?\\s+(?:ports?|outputs?|usb[\\s-]?[ac]\\w*|type[\\s-]?[ac]|[ac][1-4]|sides?|hdmi|dp|displayport|vga|displays?|monitors?|screens?|are|is|ay|used|connected|gamit|plugged))';
  var VMULTI_RE=new RegExp('\\b(?:pair|couple|few|multiple|several|maraming|many|multi[-\\s]?(?:monitors?|displays?|screens?)|dual|double|triple|quad|two|three|four|dalawa(?:ng)?|tatlo(?:ng)?|apat|each|every|simultaneous(?:ly)?|concurrent(?:ly)?|sabay\\w*|together)\\b|\\bat\\s+(?:the\\s+)?same\\s+time\\b|\\bat\\s+once\\b|\\b[2-4]\\s?x\\b|\\bx\\s?[2-4]\\b'+
    '|\\b[2-4]\\s+(?:(?:\\d{1,2}k|\\d{3,4}p|external|extended|separate|hdmi|dp|displayport|usb-?c|type-?c)\\s+)*(?:monitors?|displays?|screens?|tvs?|outputs?|ports?|hdmi|dp|displayport)\\b|\\b(?:both|pareho\\w*|parehas|all|lahat)\\b'+NEAR_PORT+
    '|\\b(?:monitors|displays|screens|tvs)\\b|\\b(?:hdmi|dp|usb-?c)\\s?1\\b.*\\b(?:hdmi|dp|usb-?c)\\s?2\\b|\\b(?:second|third|2nd|3rd|pangalawang?|ikalawang?|ikatlong?)\\s+(?:\\S+\\s+)?(?:monitors?|displays?|screens?|hdmi|outputs?|ports?)\\b');
  var PMULTI_RE=new RegExp('\\b(?:each|every|dual|two|three|four|dalawa(?:ng)?|tatlo(?:ng)?|apat|multiple|several|maraming|sabay\\w*|simultaneous(?:ly)?|concurrent(?:ly)?|together)\\b|\\bat\\s+(?:the\\s+)?same\\s+time\\b|\\bat\\s+once\\b'+
    '|\\b[2-4]\\s*(?:x\\s*)?(?:usb|type|ports?|outputs?|devices?|laptops?|phones?)\\b|\\b(?:both|pareho\\w*|parehas|all|lahat)\\b'+NEAR_PORT+'|\\b(?:ports|outputs)\\b'+
    /* Phase 1 corrective: two receiving devices in one wattage claim ("a laptop and a phone at 65W", "laptop at cellphone") */
    '|\\b'+DEV_RCPT_W+'\\s+(?:and|at|&|\\+|tsaka|saka|plus)\\s+(?:a\\s+|an\\s+|my\\s+|the\\s+|isang\\s+|yung\\s+|ang\\s+)?'+DEV_RCPT_W+'\\b');
  var TOTAL_CUE_RE=/\b(?:total|combined|overall|kabuuan)\b/;
  var DISP_NOUN_RE=/\b(?:monitors?|displays?|screens?|desktops?|tvs?|televisions?|projectors?)\b/;
  /* Phase 1 corrective: a receiving device on a charger / power bank wattage claim (broad cue; covered only by the 'device' or a
     named-port evaluation, never by the total) */
  var DEV_CUE_RE=new RegExp('\\b'+DEV_RCPT_W+'\\b|\\b(?:switch|steam\\s?deck|galaxy|pixel)\\b');
  var PORT_CUE_RE=/\b(?:iisang|isa\s+lang(?:\s+na|ng)?|isa\s+lamang(?:\s+na)?)\s+(?:usb[\s-]?[ac]\s+|type[\s-]?[ac]\s+)?ports?\b|\b(?:single|one|isang|isa|per|each|every|individual|bawat)\s*-?\s*(?:usb[\s-]?[ac]\s+|type[\s-]?[ac]\s+)?ports?\b|\bports?\s?[1-4]\b|\b[ac]\s+port\b|\b(?:second|third|fourth|2nd|3rd|4th|pangalawang?|ikalawang?|ikatlong?)\s+(?:usb[\s-]?[ac]\s+|type[\s-]?[ac]\s+)?(?:ports?|usb|type|outputs?)\b/;
  var MST_CUE_RE=/\b(?:mst|multi[-\s]?stream(?:\s+transport)?|daisy[-\s]?chain(?:ed|ing)?)\b/;
  var PLATFORMS=[['windows',/\bwin(?:dows)?(?:\s?\d{1,2})?\b/],['macos',/\bmac\s?os(?:\s?x)?\b|\bmacos\b|\bos\s?x\b|\bmacs?\b|\bmacbooks?\b|\bimacs?\b/],['ipados',/\bipad\s?os\b|\bipads?\b/],
    ['ios',/\bios\b|\biphones?\b/],['android',/\bandroid\b|\bdex\b|\bgalaxy\b|\bpixel\b/],['linux',/\blinux\b|\bubuntu\b/],['chromeos',/\bchrome\s?os\b|\bchromebooks?\b/]];
  function platformsOf(q){ return PLATFORMS.filter(function(x){ return x[1].test(q); }).map(function(x){ return x[0]; }); }
  function portIds(qn){
    var m, o=[]; PORT_TOKEN_RE.lastIndex=0;
    while((m=PORT_TOKEN_RE.exec(qn))){ if(/^\s*(?:to\b|cables?\b|cords?\b|male\b|female\b|plug\b|adapters?\b)/.test(qn.slice(m.index+m[0].length))) continue;
      var id=(m[1]||m[3])+(m[2]||m[4]||''); if(o.indexOf(id)<0) o.push(id); }
    return o;
  }
  /* the gaps of one subject (empty = every detected qualifier is covered by an evaluated ask) */
  function coverGaps(qn, asks, s, opts){
    /* quantifiers that refer to the context subjects, not to displays / ports ("these two", "how many") */
    var q=qn.replace(/\bhow\s+many\b|\bilang\b/g,' ').replace(/\b(?:these|those|the|all|yung|ang)\s+(?:two|three|dalawa|tatlo)\b|\b(?:two|three)\s+(?:products|items|models)\b/g,' ');
    var gaps=[], plats=platformsOf(q);
    var vAsks=asks.filter(function(a){ return a.a==='video.mode' || a.a==='video.displays'; });
    var multiV=vAsks.some(function(a){ return (a.a==='video.displays' && a.v>=2) || (a.a==='video.mode' && isObj(a.v) && a.v.n>=2); });
    var modeV=vAsks.some(function(a){ return (a.ext || a.mirror) && (a.a==='video.displays' || (isObj(a.v) && a.v.n>=2)); });
    var modeCue=MODE_CUE_RE.test(q);
    if(modeCue && !modeV) gaps.push('mode');
    /* Phase 1 corrective (display / OS qualifier safety): a display setup asked with no evaluated video ask ("several monitors on
       mac", "display modes on mac") is never proven by generic OS support */
    /* (a bare plural is a kind, not a count -- "monitors on mac" -- so it is read as singular here) */
    if(!vAsks.length && asks.some(function(a){ return a.a==='os.support'; }) && DISP_NOUN_RE.test(q) && (VMULTI_RE.test(q.replace(/\b(monitor|display|screen|desktop|tv)s\b/g,'$1')) || /\b(?:display|screen|monitor|video)\s+modes?\b/.test(q))) gaps.push('display_count');
    if(vAsks.length){
      if(VMULTI_RE.test(q) && !multiV) gaps.push('display_count');
      if(multiV || modeV){ if(plats.length>1 || (plats.length===1 && !vAsks.some(function(a){ return a.os===plats[0]; }))) gaps.push('display_os'); }
      else if(vAsks.some(function(a){ return a.os; }) || plats.length){ var p=prodOf(opts,s.code);
        if(plats.length>1 || (p && displayRules(p).some(function(r){ return r.fam!=='*' && r.kind==='stmt' && r.n===1; }))) gaps.push('display_os'); }   /* an OS-specific single-display statement is not read by the single-display path */
    }
    if(asks.some(function(a){ return a.a==='charge.watts'; })){
      var role=wattAskRole(qn,familyOf(opts,s.code)), ids=portIds(qn);
      if(PMULTI_RE.test(q) && !TOTAL_CUE_RE.test(q)) gaps.push('power_multi');
      if(PORT_CUE_RE.test(q) || ids.length){ if(PORT_CUE_RE.test(q) || ids.length!==1 || role!=='port:'+ids[0]) gaps.push('power_port'); }
      if(has(['charger','power_bank'],familyOf(opts,s.code)) && DEV_CUE_RE.test(q) && role!=='device' && !/^port:/.test(str(role))) gaps.push('power_device');
    }
    if(MST_CUE_RE.test(q)){
      var mst=asks.filter(function(a){ return a.a==='protocol.support' && a.v==='std:mst'; });
      if(!mst.length) gaps.push('mst');
      else if(plats.length>1 || (plats.length===1 && !mst.some(function(a){ return a.os===plats[0]; }))) gaps.push('mst_os');
    }
    return gaps;
  }
  /* G-COVER: opens the qualifier's existing attribute for every subject with a gap (no new reason, attribute or key) */
  function applyCover(qn, asks, subjects, needs, opts){
    var plat=platformsOf(qn), e=plat.length===1?'os:'+plat[0]:undefined, any=false;
    subjects.forEach(function(s){
      var gaps=coverGaps(qn,asks,s,opts); if(!gaps.length) return; any=true;
      var mine=function(a,f){ return needs.filter(function(n){ return n.s===s.key && n.a===a && (!f || f(n)); }); };
      function open(a,cls,v,f){ var ns=mine(a,f); if(ns.length) ns.forEach(function(n){ n.local='UNKNOWN'; });
        else { var n={ s:s.key, cls:cls, a:a, local:'UNKNOWN' }; if(v!=null) n.v=v; if(e) n.e=e; needs.push(n); } }
      gaps.forEach(function(g){
        if(g==='mode' || g==='display_count') open('video.displays','display_video');
        else if(g==='display_os'){ if(mine('video.displays').length) open('video.displays','display_video'); else open('video.mode','display_video'); }
        else if(g==='power_multi' || g==='power_port' || g==='power_device') open('charge.watts','performance_limit');
        else open('protocol.support','protocol_support','std:mst',function(n){ return n.v==='std:mst'; });
      });
    });
    return any;
  }
  /* cardinality a quantified context reference states (null = every referenced subject: "these", "them", "all of them") */
  function ctxCount(qn){ return /\b(?:both|dalawa|pareho|parehas|parehong)\b|\b(?:these|those|the|all)\s+two\b|\btwo\s+products\b/.test(qn)?2:(/\b(?:all|these|those|the)\s+three\b|\blahat\s+ng\s+tatlo\b|\btatlong?\s+(?:ito|yan|iyan)\b/.test(qn)?3:null); }
  function flagsOf(qn){
    var fl={}; Object.keys(RE).forEach(function(k){ fl[k]=RE[k].test(qn); }); return fl;
  }
  function primaryClass(needs){ for(var i=0;i<CLASS_PRIORITY.length;i++) if(needs.some(function(n){ return n.cls===CLASS_PRIORITY[i]; })) return CLASS_PRIORITY[i]; return null; }

  /* Topic / subject introduction (fourth round, VERO major A; replaces the third round's boolean subject-change test). Each turn's
     product mention is normalised to ONE TopicMention { kind, text, conflicts }:
       NEW_EXPLICIT_PRODUCT        an item code / UPC / exact model resolved by resolveSubjects (decided before this runs)
       CURRENT_SUBJECT_REFERENCE   a product phrase that fits the context subject ("this hub", "the 2m one") or a pronoun only
       NEW_UNRESOLVED_PRODUCT      a product phrase the context subject cannot account for -> ends the previous focus
       GENERIC_DEVICE              the topic slot names a device class ("sa laptop naman?"): the external device of a follow-up
       NO_PRODUCT_MENTION          no product phrase at all ("what about 8K?", "kaya ba 4k?")
     Topic slot = a run of content words in subject position ("how / what about the X", "e / eh / tapos yung X", "instead of X",
     "compared with / to X", "vs X"), OR the object of a PIVOT preposition ("for", "sa", "para") that opens the turn after optional
     discourse words: "sa X (naman)", "for the X, ...", "and for X", "pano / paano (naman) sa X", "how about for X". A pivot object
     is a topic even though it is a prepositional object; elsewhere a prepositional object ("works with X", "how about with X")
     or an English main-verb object ("support 3 monitors") is not a topic. A run followed by a part word ("its HDMI output",
     "yung USB-C port") names a part of the current subject.
     Product-like: a word of the phrase is catalogue vocabulary or model-like (no product-noun list); an unfamiliar noun framed by
     a determiner or a pivot still names something (unknown product nouns fail safe).
     Fits: the phrase HEAD -- its last word once spec / colour / attribute qualifiers are dropped, so "2m black hdmi cable" and
     "hdmi cable 2m black" both head on "cable" -- must name the context subject's TYPE (name, model, category, section); every
     other word must appear in its identity text (also short description, colour, length; stems and joined forms count); in a turn
     without a predicate the spec / colour qualifiers must fit too ("the usb-c charger 100W"). Anything that does not fit, or cannot
     be verified, conflicts (fail safe: clear, never reuse stale context). "other / another / different / new" + a product always
     conflicts. Planner candidates are never read. */
  function wordSet(s){ var o=dict(); s.split(/\s+/).forEach(function(w){ if(w) o[w]=1; }); return o; }
  var SC_STOP=wordSet('the a an my your our his her their yung ung ang ng mga si ni kay ko mo niya nya naman lang din rin po pa ba na e eh ay and or also too then tapos so ok okay pls please sir mam maam thanks salamat '+
    'how what which who why when where about many much paano pano ano alin saan instead compared comparison vs versus than like kung is are was were be been does do did can could will would should may might meron mayroon '+
    'it its one ones model models item items sku skus product products unit units thing things version versions magkano stock stocks available '+
    'support supports supported work works working compatible compatibility kaya kasya pwede puwede pede '+
    'gagana gumagana suportado sinusuportahan handle handles run runs output outputs input inputs charge charges charging connect connects use uses need needs fit fits have has play plays drive drives display displays monitor monitors '+
    'screen screens tv tvs single dual double triple quad two three four both all lahat dalawa isang extended extend mirror mirrored mirroring up yes no not hindi oo ugreen port ports slot slots jack connector '+
    'plug button led light side end mode naka mag to');
  /* attribute words: they join a phrase ("this power bank", "the fast charger") but never name a product */
  var SC_ATTR=wordSet('price prices presyo speed bilis length haba color colour kulay size laki weight warranty spec specs specification specifications feature features '+
    'capacity resolution refresh rate power wattage watt watts battery fast high max maximum difference differences pinagkaiba kaibahan pagkakaiba');
  var SC_PREP=wordSet('with sa for on via through thru using from at into in by para'), SC_DEIC=wordSet('this that these those ito iyan yan yun iyon nito niyan nyan same said');
  var SC_OTHER=wordSet('other another different new ibang iba bagong'), SC_AUX=wordSet('is are was were does do did can could will would should');
  var SC_MAIN=wordSet('support supports work works handle handles run runs output outputs charge charges connect connects fit fits use uses need needs have has play plays drive drives compatible');
  var SC_PRED_TL=wordSet('kaya kasya pwede puwede pede gagana gumagana suportado sinusuportahan compatible meron');
  var SC_DET=wordSet('the a an my your our yung ung ang ng mga isang this that these those ito iyan yan yun nito niyan nyan same');   /* Phase 1 corrective: Taglish indefinite "isang" ("sa isang charger naman") */
  var COLOR_WORDS=wordSet('black white gray grey silver blue red pink green purple gold beige yellow orange space dark');
  var SPEC_TOK=/^(?:\d+(?:\.\d+)?(?:k|p|hz|w|watts?|gbps|mbps|tb|gb|mb|m|cm|mm|ft|mah|v|a|in|inch|ms)?|\d+k\d+|\d+x\d+|\d+-in-\d+)$/;
  function tokensOf(t){ return normText(t).match(/[a-z0-9]+(?:[-.][a-z0-9]+)*/g)||[]; }
  function stemW(w){ return w.length>5 && /ing$/.test(w)?w.slice(0,-3):(w.length>4 && /(?:ches|shes|xes|sses)$/.test(w)?w.slice(0,-2):(w.length>3 && /s$/.test(w) && !/ss$/.test(w)?w.slice(0,-1):w)); }
  function addWord(o,t,all){ o[t]=1; o[stemW(t)]=1; t.split('-').forEach(function(x){ if(all || x.length>=2){ o[x]=1; o[stemW(x)]=1; } }); }
  function catVocab(products){
    var list=arr(products), c=catalogue(list); if(c.vocab) return c.vocab;   /* same signature as the index (fields read here are signed) */
    var v=dict(); list.forEach(function(p){ if(!isObj(p)) return; ['product_name','category','sheet_display','model'].forEach(function(k){ tokensOf(str(field(p,k))).forEach(function(t){ addWord(v,t,false); }); }); });
    c.vocab=v;
    return v;
  }
  var SC_LEAD=wordSet('and at so ok okay e eh tapos then also how what about pano paano ano naman instead compared comparison vs versus');
  var SC_PART=wordSet('port ports output outputs input inputs slot slots jack connector side end button led light mode');
  var SC_PIVOT_PREP=wordSet('for sa para');
  /* Phase 1 (owner decision 4): a connector qualifier names the subject's type unambiguously only when it is the subject's single
     input connector ("USB-C to HDMI": the USB-C dock) or names all of its output connectors ("the HDMI dock"); one of several
     output connectors ("the USB-C charger" for a USB-A + USB-C charger) is ambiguous and ends the focus */
  var CONN_W=/^(?:usb-?c|usbc|type-?c|typec|usb-?a|usba|type-?a|typea|lightning|micro-?usb|microusb|hdmi|dp|displayport|vga|dvi|thunderbolt)$/;
  function connKind(w){ w=w.replace(/-/g,''); return /^(?:usbc|typec|thunderbolt)$/.test(w)?'c':(/^(?:usba|typea)$/.test(w)?'a':(w==='displayport'?'dp':(w==='microusb'?'micro':w))); }
  function connsIn(t){ var o=[]; tokensOf(t).forEach(function(w,i,a){ var k=CONN_W.test(w)?connKind(w):(/^(?:usb|type)$/.test(w) && /^[ac]$/.test(a[i+1]||'')?a[i+1]:null); if(k && o.indexOf(k)<0) o.push(k); }); return o; }
  function nameConnectors(p){ var nm=nameOf(p), i=nm.search(/\sto\s/); return i<0?{ inK:[], outK:connsIn(nm) }:{ inK:connsIn(nm.slice(0,i)), outK:connsIn(nm.slice(i+4)) }; }
  function connectorFit(run,c){ var ks=connsIn(run.join(' ')); return ks.every(function(k){ return (c.inK.length===1 && c.inK[0]===k) || (c.outK.length===1 && c.outK[0]===k) || (c.outK.length>1 && c.outK.every(function(o){ return ks.indexOf(o)>=0; })); }); }
  var DEVICE_CLASS_W=wordSet('laptop laptops notebook notebooks phone phones cellphone cellphones cp smartphone smartphones tablet tablets desktop desktops pc pcs computer computers console consoles projector projectors');
  function topicMention(qn,ents,cs,opts){
    var toks=tokensOf(qn), n=toks.length, vocab=catVocab(field(opts,'products')), masked=dict(), i, j;
    function mention(kind,text){ return { kind:kind, text:text||'', conflicts:kind==='NEW_UNRESOLVED_PRODUCT' }; }
    ents.forEach(function(e){ tokensOf(e.raw).forEach(function(t){ masked[t]=1; }); });
    /* fifth round, minor context over-resets ("how about for my laptop, PD 3.0 ba?", "for the dock, 4K ba?"):
       (1) a comma ends a topic run -- "the dock, 4K ba" is the topic "the dock" plus the ask "4K ba", never the phrase "dock 4K";
       (2) the words a standard / protocol / charging entity matched ("pd 3.0", "thunderbolt 4") are the ask, not a product head:
           they never make a phrase product-like on their own, but they still have to fit the subject wherever a qualifier must */
    var brk=dict(), seg=0, tk; (qn.match(/[a-z0-9]+(?:[-.][a-z0-9]+)*|,/g)||[]).forEach(function(t){ if(t===',') seg++; else { tk=(tk||0)+1; brk[tk-1]=seg; } });
    var entTok=dict();
    ents.forEach(function(e){ var L=e.kind==='std'?STANDARDS:(e.kind==='protocol'?PROTOCOLS:(e.kind==='charging'?CHARGING:null)), re=L?patternOf(L,e.key):null, hm=re?qn.match(re):null;
      if(hm) tokensOf(hm[0]).forEach(function(t){ entTok[t]=1; }); });
    /* Phase 1 (owner decision 4): the subject's TYPE is its own name, model and category -- never its section label alone
       ("hub" in "Docking and Hub" is not CM843's type); the section still counts as identity text for qualifiers */
    var sTok=dict(), sComp=[], tTok=dict(), tComp=[], tRaw=dict(), secTok=dict();
    cs.forEach(function(k){ var p=prodOf(opts,k.replace(/^ugreen:/,'')), ty=normText(['product_name','model','category'].map(function(f){ return str(field(p,f)); }).join(' ')),
      t=ty+' '+normText(['sheet_display','short_desc','color','length'].map(function(f){ return str(field(p,f)); }).join(' '));
      tokensOf(t).forEach(function(w){ addWord(sTok,w,true); }); sComp.push(compact(t));
      tokensOf(ty).forEach(function(w){ addWord(tTok,w,true); tRaw[w]=1; }); tComp.push(compact(ty));
      tokensOf(normText(field(p,'sheet_display'))).forEach(function(w){ addWord(secTok,w,true); }); });
    var conn=cs.length===1?nameConnectors(prodOf(opts,cs[0].replace(/^ugreen:/,''))):null;
    function inSet(o,c,w){ return !!(o[w] || o[stemW(w)] || (w.length>=2 && c.some(function(x){ return x.indexOf(compact(w))>=0; }))); }
    function fits(w){ return inSet(sTok,sComp,w); }
    function fitsType(w){ return inSet(tTok,tComp,w); }
    function content(k){ var w=toks[k]; return !SC_STOP[w] && !SC_ATTR[w] && !SC_PREP[w] && !SC_DEIC[w] && !SC_OTHER[w] && !masked[w]; }
    function product(w){ return !!(vocab[w] || vocab[stemW(w)] || (/[a-z]/.test(w) && /\d/.test(w) && w.length>=3 && !SPEC_TOK.test(w))); }
    for(i=0;i<n;i++) if(SC_OTHER[toks[i]]) for(j=i+1;j<=i+3 && j<n;j++){                 /* "the other model", "another charger", "a new hub" */
      if(/^(?:one|model|item|product|unit|sku)s?$/.test(toks[j]) || (content(j) && !SPEC_TOK.test(toks[j]) && product(toks[j]))) return mention('NEW_UNRESOLVED_PRODUCT',toks.slice(i,j+1).join(' ')); }
    /* discourse pivot: leading discourse words, then an optional pivot preposition; the topic slot starts after its determiners */
    var lead=0; while(lead<n && SC_LEAD[toks[lead]]) lead++;
    var prep=lead<n && SC_PIVOT_PREP[toks[lead]]?1:0;
    if(prep && toks[lead]==='para' && toks[lead+1]==='sa') prep=2;        /* fifth round: Taglish "para sa X" is one pivot ("for the X") */
    var slot=lead+prep; while(slot<n && SC_DET[toks[slot]]) slot++;
    var pivot=prep>=1 && slot<n?slot:-1;                                  /* only a pivot preposition turns its object into the topic */
    var mv=-1; for(i=0;i<n;i++) if(SC_MAIN[toks[i]]){ mv=i; break; }
    var predicate=toks.slice(0,3).some(function(w){ return SC_AUX[w]; }) || mv>=0 || toks.some(function(w){ return SC_PRED_TL[w]; });
    var opener=pivot>=0 || /^\s*(?:and\s+|at\s+)?(?:how|what)\s+about\b|^\s*(?:e|eh|tapos|paano\s+naman|pano\s+naman|instead|compared|vs|versus)\b/.test(qn);
    var found=null, generic=null;
    i=0;
    while(i<n){
      var inRun=function(k){ return content(k) || !!SC_ATTR[toks[k]]; };
      if(!inRun(i)){ i++; continue; }
      var s=i; while(i<n && brk[i]===brk[s] && (inRun(i) || ((toks[i]==='to' || toks[i]==='na') && i>s && i+1<n && brk[i+1]===brk[s] && content(i+1)))) i++;   /* "type c to hdmi", Taglish linker "100W na charger"; a comma ends the run */
      var run=toks.slice(s,i).filter(function(w){ return w!=='to' && w!=='na'; }), tl=false, framed=false, inSlot=s===pivot;
      for(j=s-1;j>=0 && SC_DET[toks[j]];j--){ framed=true; if(/^(?:ang|ng|yung|ung)$/.test(toks[j])) tl=true; }
      if(!inSlot && j>=0 && SC_PREP[toks[j]] && !(j>0 && /^(?:compared|comparison|vs|versus)$/.test(toks[j-1]))) continue;   /* object of a preposition */
      if(mv>=0 && s>mv && !tl) continue;                        /* object of an English main verb ("support 3 monitors") */
      if(SC_PART[toks[i]||'']) continue;                                   /* "its HDMI output", "yung USB-C port": a part of the subject */
      var qual=run.filter(function(w){ return !SPEC_TOK.test(w) && !COLOR_WORDS[w] && !SC_ATTR[w]; });
      var head=qual.filter(function(w){ return !entTok[w]; });                /* "pd 3.0" alone is an ask, not a product phrase */
      /* a spec-qualified pro-form ("the 100W one", "yung white one"): its qualifiers must fit the subject's own variant */
      if(!head.length && framed && /^ones?$/.test(toks[i]||'') && run.some(function(w){ return !fits(w) && (SPEC_TOK.test(w) || COLOR_WORDS[w]); })) return mention('NEW_UNRESOLVED_PRODUCT',run.join(' ')+' '+toks[i]);
      if(head.length && DEVICE_CLASS_W[head[head.length-1]]){ generic=generic||run.join(' '); continue; }   /* "sa laptop naman?", "for my phone" */
      /* no product word: an ask / attribute phrase -- except an unfamiliar noun in a framed / pivot elliptical turn ("this power bank",
         "how about the gizmo?"), which still names something the subject is not */
      if(!head.length || (!head.some(product) && (predicate || !(framed || opener)))) continue;
      /* Phase 1 (owner decision 4): a CLASS reference never continues the focus -- an indefinite determiner ("a hub", "an
         adapter", "mga charger") or a bare plural category ("hubs", "chargers", "sa hubs naman", "docking stations"). A plural
         after "the / yung / ang" still refers to a context of several subjects; "is it a hub?" (predicative) is no reference. */
      var CTX_Q=/^(?:both|all|lahat|pareho|parehong|parehas|dalawa|dalawang)$/;   /* "both chargers", "lahat ng hub": the context subjects */
      var dets=toks.slice(j+1,s), k2=s-1; while(k2>=0 && (SC_DET[toks[k2]] || toks[k2]==='ugreen' || CTX_Q.test(toks[k2]))){ if(dets.indexOf(toks[k2])<0) dets.push(toks[k2]); k2--; }   /* "this UGREEN hub" */
      /* predicative, not a reference: "is it a charger?", Taglish "isang charger ba ito?" (the pronoun follows the phrase) */
      var hw=head[head.length-1], pred=(j>=0 && /^(?:it|this|that|ito|iyan|yan|yun)$/.test(toks[j])) || /^(?:ba\s+)?(?:ito|iyan|yan|yun|to)$/.test(toks.slice(i,i+2).join(' ')) || /^(?:ba\s+)?(?:ito|iyan|yan|yun|to)$/.test(toks[i]||'');
      var plural=/s$/.test(hw) && stemW(hw)!==hw && !tRaw[hw] && !dets.some(function(w){ return SC_DEIC[w] || CTX_Q.test(w); }) && !(cs.length>=2 && dets.some(function(w){ return /^(?:the|yung|ung|ang)$/.test(w); }));
      if(!pred && (plural || dets.some(function(w){ return /^(?:a|an|mga|isang)$/.test(w); }))) return mention('NEW_UNRESOLVED_PRODUCT',run.join(' '));
      var tail=predicate?qual:run.filter(function(w){ return !SC_ATTR[w]; });   /* entity words in a product phrase must still fit */
      /* a SINGULAR deictic determiner ("this UGREEN hub") points at the subject itself: only there may its section label name the
         type (owner decision 2026-10-13: the reference must identify the current SKU unambiguously; never a plural / indefinite
         reference -- "these hubs", "a hub", "sa hubs naman"; over a context of several subjects the singular reference still
         clarifies downstream, ambiguous_context) */
      var typeOk=fitsType(hw) || (dets.some(function(w){ return /^(?:this|that|ito|iyan|yan|yun|nito|niyan|nyan|same)$/.test(w); }) && !!(secTok[hw] || secTok[stemW(hw)]));
      if(!cs.length || !typeOk || tail.some(function(w){ return !fits(w); }) || (conn && !connectorFit(run,conn))) return mention('NEW_UNRESOLVED_PRODUCT',run.join(' '));
      found=found||run.join(' ');
    }
    if(found) return mention('CURRENT_SUBJECT_REFERENCE',found);
    if(generic || ents.some(function(e){ return e.kind==='device' || e.kind==='drive'; })) return mention('GENERIC_DEVICE',generic||'');
    return mention(RE.deictic.test(qn)?'CURRENT_SUBJECT_REFERENCE':'NO_PRODUCT_MENTION','');
  }

  /* G2 / G3: the context subjects a turn may use. Format filter first (only "ugreen:" + 1-20 letters / digits / hyphens; anything
     else is rejected), then re-resolution against the CURRENT published catalogue: a code that no longer exists, is disabled or is
     no longer unique is dropped (stale / ambiguous) and never replaced by a guess or a planner candidate. */
  var CTX_KEY_RE=/^ugreen:[A-Za-z0-9-]{1,20}$/;
  function contextSubjects(ctx,opts){
    var raw=isObj(ctx) && Array.isArray(ctx.subjects)?ctx.subjects:[], out={ subjects:[], rejected:0, stale:[], ambiguous:[] }, ix=index(field(opts,'products'));
    raw.forEach(function(k){
      if(typeof k!=='string' || !CTX_KEY_RE.test(k)){ out.rejected++; return; }
      var c=k.slice(7).toUpperCase(), cnt=ix.count[c]||0, p=ix.get(c);
      if(!cnt || !p || field(p,'disabled')===true){ out.stale.push(k); return; }
      if(cnt>1){ out.ambiguous.push(k); return; }
      var key='ugreen:'+str(field(p,'item_code')).trim(); if(out.subjects.indexOf(key)<0) out.subjects.push(key); });
    return out;
  }

  function classify(q, opts){
    opts=isObj(opts)?opts:{};
    var qn=normText(q), fl=flagsOf(qn), ents=detectEntities(q), plan=isObj(opts.plan)?opts.plan:null;
    var pr=plan && isObj(plan.route) && typeof plan.route.route==='string'?plan.route.route:null, intent=plan && typeof plan.intent==='string'?plan.intent:null;
    var d={ v:VERSION, route:null, reason:null, 'class':null, subjects:[], via:{}, entities:ents.map(function(e){ return e.key; }), needs:[],
      request:null, llmNeeded:false, llmRule:null, llmIfNoEvidence:false, flags:{ commercial:fl.commercial, explain:fl.explain, judgement:fl.judgement,
      followUp:fl.followUp, deictic:fl.deictic, genericDevice:false, osVersionLimited:false }, clarify:null, conflict:null, nextCtx:null };
    function done(route,reason){ d.route=route; d.reason=reason; var p=llmPolicy(d); d.llmNeeded=p.llmNeeded; d.llmRule=p.rule; d.nextCtx=ctxAfter(); return d; }
    /* F1: the context the next turn may use. Resolved subjects carry over; naming a different product that cannot be resolved
       (name / type only, ambiguous model or UPC) invalidates the previous focus; otherwise (same subject, ordinary clarification,
       no product named) the previous context stays. */
    function ctxAfter(){
      if(d.subjects.length) return { subjects:d.subjects.slice() };
      if(explicit.length) return { subjects:explicit.map(function(s){ return s.key; }) };
      if(res.status==='ambiguous' || namedOther || ctxBroken) return null;
      return cs.length?{ subjects:cs.slice() }:null;
    }
    var ctxBroken=false;

    var res=resolveSubjects(q,opts), explicit=res.status==='resolved'?res.subjects:[];
    var cx=contextSubjects(opts.ctx,opts), cs=cx.subjects;             /* G2 format filter + G3 re-resolution against the current catalogue */
    /* a product named only by name / type ("the uno cable", also inside "how about ..." / "what about ...") is a NEW, unresolved
       subject: never borrow the previous one, and the previous focus ends here (P1) */
    var topic=explicit.length?{ kind:'NEW_EXPLICIT_PRODUCT', text:'', conflicts:false }:topicMention(qn,ents,cs,opts);
    var namedOther=topic.conflicts;
    var ctxUsable=!!cs.length && !namedOther;
    /* elliptical follow-up on a compatibility chain ("how about Galaxy S25 Ultra?") keeps the compatibility question */
    if(!fl.compat && fl.followUp && ctxUsable && !explicit.length && ents.some(function(e){ return e.kind==='device' || e.kind==='drive'; })) fl.compat=true;
    var asks=collectAsks(qn,ents,fl,explicit.length);
    /* spec words that only qualify a catalogue search (a yes / no stock or existence question about "the <N>W <type>") are not evidence asks */
    if(asks.length && !explicit.length && !fl.deictic && !fl.followUp && asks.every(function(a){ return a.weak; })) asks=[];
    /* a product type for an exact named device, no product named ("<device> <type>"): the device spec only */
    var exactDev=ents.filter(function(e){ return (e.kind==='device' || e.kind==='drive') && e.exact; });
    if(!asks.length && !explicit.length && !fl.deictic && exactDev.length && fl.product) asks=[{ kind:'deviceOnly', e:exactDev[0] }];
    function noAsk(){                                                           /* no evidence ask: the planner's local decision stands */
      explicit.forEach(function(s){ d.via[s.key]=s.via; }); d.subjects=explicit.map(function(s){ return s.key; });   /* kept only as the next turn's context */
      if(fl.extAvail) return done('LOCAL','external_availability_unsupported');
      var genericDev=fl.compat && DEVICE_CLASS_RE.test(qn) && (explicit.length>0 || ctxUsable);
      if(genericDev) return done('LOCAL','generic_device_class');
      if(pr==='CLARIFY') return done('CLARIFY','plan_clarify');
      if(fl.commercial) return done('LOCAL','commercial_local');
      if(pr==='AI_CATALOG') return done('LOCAL','catalogue_judgement');
      if(pr==='WEB') return done('LOCAL', intent==='recommend' || fl.judgement ? 'catalogue_judgement' : 'unclassified_retained');   /* R1 never drops an AI call it cannot classify */
      return done('LOCAL','local_plan');
    }
    if(!asks.length) return noAsk();
    /* inexact external device / drive family: never retrieve against a guessed model */
    /* F5 / F7: an inexact drive (family) never resolves; a device that is not one exact model is CLARIFIED only when the question
       depends on variant-specific facts. Otherwise a generic line ("my MacBook") behaves like "my phone / laptop" (UGREEN-side facts
       answer it), and a family ("MacBook M4") proceeds with the open variant noted in the request. */
    /* P7: only conclusions that depend on the external device's own variant (video output, display count, host port speed) need
       the exact model; a UGREEN-side fact (PD 3.0, a wattage, a standard) is answered for "my MacBook" exactly as for "my laptop" */
    var VARIANT_ATTRS=['video.mode','video.displays','data.rate'];
    var variantAsk=asks.some(function(a){ return has(VARIANT_ATTRS,a.a); });
    var badExt=asks.filter(function(a){ return a.kind==='compat' && ((a.e.kind==='drive' && !a.e.exact) || (a.e.kind==='device' && !a.e.exact && variantAsk)); });
    if(badExt.length){ d.clarify={ kind:'external_model', raw:badExt.map(function(a){ return a.e.raw; }) }; return done('CLARIFY','external_model_inexact'); }

    var hasCompat=asks.some(function(a){ return a.kind==='compat'; }), devOnly=asks.length>0 && asks.every(function(a){ return a.kind==='deviceOnly'; });
    var bound=!devOnly && asks.some(function(a){ return a.bound || a.kind==='compat'; }), mustBind=asks.some(function(a){ return a.kind==='compat' || (a.bound && !a.optional); });
    var subjects=[];
    if(bound){
      if(res.status==='ambiguous'){ d.clarify={ kind:res.ambiguous[0].via, raw:res.ambiguous[0].raw, options:res.ambiguous[0].codes.slice(0,8) };
        return done('CLARIFY', res.ambiguous[0].via==='upc'?'ambiguous_upc':'ambiguous_model'); }
      if(explicit.length) subjects=explicit.map(function(s){ d.via[s.key]=s.via; return s; });
      else if(ctxUsable && (fl.deictic || fl.followUp || mustBind)){
        /* QA 1 (fourth round): a context reference must account for EVERY subject it refers to. A quantified reference ("both",
           "these two", "all of them", "pareho", "dalawa") needs exactly its cardinality, and a context of several subjects needs all
           of them still valid (no stale / ambiguous / rejected / duplicate entry). Otherwise CLARIFY -- 2 subjects never silently
           become 1 -- and the broken context is not carried to the next turn. A singular reference to a multi-subject context
           clarifies as before. */
        var want=ctxCount(qn), rawN=arr(field(opts.ctx,'subjects')).length;
        var intact=cs.length===rawN;        /* every raw entry survived: none rejected, stale, ambiguous or duplicate */
        if((fl.plural || (fl.explain && rawN>=2)) && !(intact && cs.length===(want||rawN))){ ctxBroken=true; d.clarify={ kind:'context', options:cs.map(function(k){ return String(k).replace(/^ugreen:/,''); }) }; return done('CLARIFY','ambiguous_context'); }
        if((cs.length===1 && rawN<=1) || fl.plural || fl.explain){ subjects=cs.map(function(k){ var code=String(k).replace(/^ugreen:/,''); d.via['ugreen:'+code]='context'; return { key:'ugreen:'+code, code:code, via:'context' }; }); }
        else { if(!intact) ctxBroken=true; d.clarify={ kind:'context', options:cs.map(function(k){ return String(k).replace(/^ugreen:/,''); }) }; return done('CLARIFY','ambiguous_context'); }
      }
      else if(fl.listing && !fl.deictic && hasCompat){                          /* "do you have a charger for <device>?": the device spec only, no guessed product */
        asks=asks.filter(function(a){ return a.kind==='compat'; }).map(function(a){ return { kind:'deviceOnly', e:a.e }; });
      }
      else if(fl.listing && !fl.deictic) return noAsk();                       /* a catalogue search with a spec filter ("is there a 65W charger?") */
      else if(!cs.length && cx.ambiguous.length && (fl.deictic || fl.followUp || mustBind)){ d.clarify={ kind:'context', options:[] }; return done('CLARIFY','ambiguous_context'); }   /* G3: the context code is no longer unique */
      else if(mustBind){ d.clarify={ kind:'subject' }; return done('CLARIFY','no_exact_subject'); }
    }
    d.subjects=subjects.map(function(s){ return s.key; });

    var needs=[];
    asks.forEach(function(a){
      if(a.kind==='deviceOnly'){
        var ty=/\b(charger|power\s?bank|cable)\b/.test(qn)?'device.chargeInput':(/\b(enclosure|nas|ssd|hdd|drive)\b/.test(qn)?'device.interface':(/\b(hub|dock|adapter|hdmi|monitor)\b/.test(qn)?'device.video':'device.ports'));
        if(!needs.some(function(n){ return n.s===a.e.key && n.a===ty; })) needs.push({ s:a.e.key, cls:'external_device_spec', a:ty, local:'UNKNOWN' });
        return;
      }
      if(a.kind==='compat'){
        subjects.forEach(function(s){
          var fam=familyOf(opts,s.code), ps=prodOf(opts,s.code), neg=ps?negativeScopes(ps):[];
          if(a.e.kind==='device' && negCoversDevice(neg,a.e)){                  /* F6: an explicit, scoped catalogue negative = "no" */
            needs.push({ s:s.key, cls:'compatibility', a:'compat.with', e:a.e.key, local:'CONTRADICTED' }); return; }
          if(a.e.kind==='device' && a.e.level==='generic'){ d.flags.genericDevice=true; return; }   /* UGREEN-side facts only */
          if(a.e.kind==='device' && a.e.level==='family') d.ambiguity=uniq((d.ambiguity||[]).concat(['device_variant:'+a.e.key]));
          needs.push({ s:s.key, cls:'compatibility', a:'compat.with', e:a.e.key, local:'UNKNOWN' });
          if(a.e.kind==='drive'){
            ['device.interface','device.formFactor','device.capacity'].forEach(function(at){ if(!needs.some(function(n){ return n.s===a.e.key && n.a===at; })) needs.push({ s:a.e.key, cls:'external_device_spec', a:at, local:'UNKNOWN' }); });
            if(has(['nas','enclosure'],fam)){
              needs.push({ s:s.key, cls:'compatibility', a:'host.driveInterface', local:localState(opts,s.code,{ a:'host.driveInterface' }) });
              needs.push({ s:s.key, cls:'compatibility', a:'host.driveFormFactor', local:localState(opts,s.code,{ a:'host.driveFormFactor' }) });
              needs.push({ s:s.key, cls:'performance_limit', a:'host.capacityMax', local:localState(opts,s.code,{ a:'host.capacityMax' }) });
            }
            if(fam==='nas') needs.push({ s:s.key, cls:'official_compat_list', a:'compat.list', e:a.e.key, local:'UNKNOWN' });
          } else {
            var at=deviceAttrFor(fam); if(!needs.some(function(n){ return n.s===a.e.key && n.a===at; })) needs.push({ s:a.e.key, cls:'external_device_spec', a:at, local:'UNKNOWN' });
          }
        });
        return;
      }
      if(!a.bound){ needs.push({ s:a.s, cls:a.cls, a:a.a, local:'UNKNOWN' }); return; }
      subjects.forEach(function(s){
        if(a.a==='compat.list' && a.e==null && needs.some(function(n){ return n.s===s.key && n.a==='compat.list'; })) return;
        var n={ s:s.key, cls:a.cls, a:a.a, local:localState(opts,s.code,a) }; if(a.v!=null) n.v=a.v; if(a.e) n.e=a.e;
        if(n.a==='host.capacityMax' && needs.some(function(x){ return x.s===n.s && x.a===n.a; })) return;
        needs.push(n);
        if(a.vendorReq && n.local!=='CONFIRMED' && !needs.some(function(x){ return x.s===a.v && x.a==='protocol.requirement'; }))
          needs.push({ s:a.v, cls:'charging_protocol', a:'protocol.requirement', local:'UNKNOWN' });
      });
    });
    /* P3: display count + mode(s) are one composite claim per subject: one contradicted component answers it ("no"); the other,
       still open components are moot and are not requested */
    if(asks.some(function(a){ return a.a==='video.displays'; })) subjects.forEach(function(s){
      var vg=function(n){ return n.s===s.key && (n.a==='video.displays' || n.a==='video.mode'); };
      /* third round: the claim on a scoped device ("dual extended monitors on MacBook Air M4") is one conjunction too: the open
         compatibility need for that device and the device's own spec needs are moot once a display component is "no" */
      var devs=needs.filter(function(n){ return n.s===s.key && n.a==='compat.with' && n.e; }).map(function(n){ return n.e; });
      /* fourth round: the OS the display setup is scoped to ("on Windows 11") is a component of the same claim -- its open OS-support
         need is moot once a display component is "no" */
      var scoped=asks.some(function(a){ return (a.a==='video.displays' || a.a==='video.mode') && a.os; });
      var moot=function(n){ return vg(n) || (n.s===s.key && n.a==='compat.with') || has(devs,n.s) || (scoped && n.s===s.key && n.a==='os.support'); };
      if(needs.some(function(n){ return vg(n) && n.local==='CONTRADICTED'; })) needs=needs.filter(function(n){ return !(moot(n) && (n.local==='UNKNOWN' || n.local==='CONTRADICTED_INTERNAL')); }); });
    /* P5: a family-level OS "yes" that the catalogue limits by version is flagged (the answer must name the version limit) */
    d.flags.osVersionLimited=needs.some(function(n){ var m=/^os:([a-z]+)$/.exec(str(n.e)); return n.a==='os.support' && n.local==='CONFIRMED' && m && osVersionLimited(prodOf(opts,n.s.replace(/^ugreen:/,'')),m[1]); });
    if(!needs.length && d.flags.genericDevice && subjects.length){ d.subjects=subjects.map(function(s){ return s.key; }); return done('LOCAL','generic_device_class'); }
    if(!needs.length){ d.clarify={ kind:'subject' }; return done('CLARIFY','no_exact_subject'); }
    d.needs=needs; d['class']=primaryClass(needs);
    var cf=needs.filter(function(n){ return n.local==='CONTRADICTED_INTERNAL' && (n.a==='host.capacityMax' || n.a==='charge.watts'); })[0];
    if(cf){ var p=prodOf(opts,cf.s.replace(/^ugreen:/,'')), st=cf.a==='charge.watts'?wattStatements(p):capacityStatements(p);
      d.conflict={ s:cf.s, a:cf.a, values:st.values, unit:cf.a==='charge.watts'?'W':'TB', quotes:st.quotes }; }
    var open=needs.filter(function(n){ return n.local==='UNKNOWN' || n.local==='CONTRADICTED_INTERNAL'; });
    /* Phase 1 G-COVER: a would-be YES with a detected but uncovered qualifier becomes EVIDENCE (a NO is never touched) */
    if(!open.length && !needs.some(function(n){ return n.local==='CONTRADICTED'; }) && applyCover(qn,asks,subjects,needs,opts)){
      d['class']=primaryClass(needs); open=needs.filter(function(n){ return n.local==='UNKNOWN' || n.local==='CONTRADICTED_INTERNAL'; }); }
    if(!open.length) return done('LOCAL', needs.some(function(n){ return n.local==='CONTRADICTED'; })?'local_contradicted':'local_confirmed');
    d.request=buildRequest(d,open);
    return done('EVIDENCE', open.some(function(n){ return n.local==='CONTRADICTED_INTERNAL'; })?'local_conflict':
      (open.some(function(n){ return /^ugreen:/.test(n.s) && n.cls!=='compatibility' && n.cls!=='official_compat_list'; }) && !open.some(function(n){ return !/^ugreen:/.test(n.s); })?'local_unknown':'needs_external_evidence'));
  }

  /* ============================== 8. EvidenceRequest contract ============================== */
  function buildRequest(d,open){
    var ent=null; open.forEach(function(n){ if(!ent && n.e) ent=n.e; if(!ent && !/^ugreen:/.test(n.s)) ent=n.s; });
    var r={ v:VERSION, subjects:d.subjects.slice(), entity:ent, needs:open.map(function(n){ var o={ s:n.s, cls:n.cls, a:n.a }; if(n.e) o.e=n.e; if(n.v!=null) o.v=n.v; return o; }),
      'class':primaryClass(open), reason:open.some(function(n){ return n.local==='CONTRADICTED_INTERNAL'; })?'local_conflict':'needs_external_evidence' };
    if(d.ambiguity && d.ambiguity.length) r.ambiguity=d.ambiguity.slice(0,3);   /* F7: a device family whose variant is open */
    return r;
  }
  var KEY_RE=/^(ugreen:[A-Za-z0-9-]{1,20}|std:[a-z0-9.-]{2,40}|os:[a-z0-9.-]{2,40}|app:[a-z0-9.-]{2,40}|drive-family:[a-z0-9.-]{2,40}|[a-z]{2,12}:[A-Za-z0-9.-]{2,40})$/;
  function validKey(k){ if(typeof k!=='string' || !KEY_RE.test(k)) return false; var pre=k.split(':')[0];
    return pre==='ugreen' || pre==='std' || pre==='os' || pre==='app' || has(VENDORS,pre); }
  function noUrl(o){ var j; try{ j=JSON.stringify(o); }catch(_){ return false; } return typeof j!=='string' || !/https?:|\/\/|www\./i.test(j); }   /* unserializable = fail closed */
  /* Q1: validators always return { ok, errors }; malformed input of any shape fails closed, never throws */
  function failClosed(fn){ return function(x){ try{ return fn(x); }catch(_){ return { ok:false, errors:['malformed input'] }; } }; }
  function attrOf(a){ return own(ATTRS,a)?ATTRS[a]:null; }
  var AMBIG_RE=/^device_variant:[a-z]{2,12}:[a-z0-9.-]{2,40}$/;
  function validateRequestImpl(r){
    var e=[];
    if(!r || typeof r!=='object' || Array.isArray(r)) return { ok:false, errors:['not an object'] };
    Object.keys(r).forEach(function(k){ if(!has(['v','subjects','entity','needs','class','reason','ambiguity'],k)) e.push('extra key '+k); });
    if(r.ambiguity!==undefined && !(Array.isArray(r.ambiguity) && r.ambiguity.length>0 && r.ambiguity.length<=3 && r.ambiguity.every(function(x){ return typeof x==='string' && AMBIG_RE.test(x); }))) e.push('ambiguity');
    if(r.v!==VERSION) e.push('v');
    if(!Array.isArray(r.subjects) || !r.subjects.every(function(s){ return validKey(s) && /^ugreen:/.test(s); })) e.push('subjects');
    if(r.entity!=null && !validKey(r.entity)) e.push('entity');
    if(!has(CLASSES,r['class'])) e.push('class');
    if(!has(['needs_external_evidence','local_conflict'],r.reason)) e.push('reason');
    if(!Array.isArray(r.needs) || !r.needs.length) e.push('needs');
    (Array.isArray(r.needs)?r.needs:[]).forEach(function(n,i){
      if(!n || typeof n!=='object' || Array.isArray(n)){ e.push('need '+i+' not an object'); return; }
      Object.keys(n).forEach(function(k){ if(!has(['s','cls','a','e','v'],k)) e.push('need '+i+' extra key '+k); });
      if(!validKey(n.s)) e.push('need '+i+' subject key');
      if(/^ugreen:/.test(str(n.s)) && arr(r.subjects).indexOf(n.s)<0) e.push('need '+i+' subject not in subjects');
      if(!has(CLASSES,n.cls)) e.push('need '+i+' class');
      var A=attrOf(n.a); if(!A) e.push('need '+i+' attribute'); else if(!has(A.cls,n.cls)) e.push('need '+i+' attribute/class mismatch');
      if(COMMERCIAL_RE.test(str(n.a))) e.push('need '+i+' commercial attribute');
      if(n.e!=null && !validKey(n.e)) e.push('need '+i+' entity');
    });
    if(!noUrl(r)) e.push('contains a URL');
    return { ok:!e.length, errors:e };
  }
  var validateRequest=failClosed(validateRequestImpl);

  /* ============================== 9. EvidenceRow contract (frozen v1; no storage in R1) ============================== */
  var ROW_KEYS=['s','a','op','v','u','lvl','st','src','q','at','exp','cur'];
  var INJECTION_RE=/\b(ignore\s+(?:all|any|the|previous|prior)|disregard\s+(?:all|previous)|system\s+prompt|you\s+are\s+(?:now\s+)?(?:a|an|uno|chatgpt|the)\b|act\s+as|new\s+instructions?|assistant\s*:|developer\s*:)/i;
  function validDate(s){ return typeof s==='string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s+'T00:00:00Z')); }
  /* a video mode value: { r?, hz? } (at least one), optionally the composite scope of P3 / P9d: n = simultaneous displays (2-8),
     port = the output port, dir = 'in' (input side) | 'out'. No other key. */
  var MODE_PORTS=['hdmi','dp','usb-c','vga','dvi'];
  function validMode(v){
    if(!isObj(v) || !Object.keys(v).every(function(k){ return has(['r','hz','n','port','dir'],k); })) return false;
    if(!(v.r==null || (typeof v.r==='number' && v.r>0)) || !(v.hz==null || (typeof v.hz==='number' && v.hz>0)) || (v.r==null && v.hz==null)) return false;
    if(v.n!==undefined && !(typeof v.n==='number' && v.n%1===0 && v.n>=2 && v.n<=8)) return false;
    if(v.port!==undefined && !has(MODE_PORTS,v.port)) return false;
    return v.dir===undefined || v.dir==='in' || v.dir==='out';
  }
  function validateRowImpl(r){
    var e=[];
    if(!r || typeof r!=='object' || Array.isArray(r)) return { ok:false, errors:['not an object'] };
    Object.keys(r).forEach(function(k){ if(!has(ROW_KEYS,k)) e.push('extra key '+k); });
    ROW_KEYS.forEach(function(k){ if(!(k in r)) e.push('missing '+k); });
    if(!validKey(r.s)) e.push('s');
    var A=attrOf(r.a); if(!A) e.push('a'); if(COMMERCIAL_RE.test(str(r.a))) e.push('commercial attribute');
    if(A && !has(A.ops,r.op)) e.push('op');
    if(A){
      var v=r.v;
      if(A.kind==='num' && !(typeof v==='number' && isFinite(v) && v>=0)) e.push('v num');
      if(A.kind==='str' && !(typeof v==='string' && v.length>0 && v.length<=60)) e.push('v str');
      if(A.kind==='key' && !validKey(v)) e.push('v key');
      if(A.kind==='list' && !(Array.isArray(v) && v.length>0 && v.length<=12 && v.every(function(x){ return typeof x==='string' && x.length<=40; }))) e.push('v list');
      if(A.kind==='mode' && !validMode(v)) e.push('v mode');
      if(A.values && !has(A.values,v)) e.push('v value');
      if(A.units){ if(!has(A.units,r.u)) e.push('u'); } else if(r.u!=null && !has(UNITS,r.u)) e.push('u');
    }
    if(!(typeof r.lvl==='number' && r.lvl%1===0 && own(TIERS,String(r.lvl)))) e.push('lvl');
    if(!has(ROW_STATES,r.st)) e.push('st');
    if(r.lvl===7 && (r.st!=='INFERRED' || r.cur)) e.push('secondary source must be INFERRED and not curated');
    if(r.lvl===0 && !/^ugreen:/.test(str(r.s))) e.push('pricelist tier only for UGREEN subjects');
    if(!(typeof r.src==='string' && /^[A-Za-z0-9_.:-]{1,40}$/.test(r.src))) e.push('src');
    if(!(typeof r.q==='string' && r.q.length<=150 && !/[<>\u0000-\u001f\u007f]/.test(r.q) && !/https?:|www\./i.test(r.q))) e.push('q');
    if(typeof r.q==='string' && INJECTION_RE.test(r.q)) e.push('q instruction-like');
    if(!validDate(r.at)) e.push('at'); if(!validDate(r.exp)) e.push('exp');
    if(validDate(r.at) && validDate(r.exp) && !(r.exp>r.at)) e.push('exp must be after at');
    if(typeof r.cur!=='boolean') e.push('cur');
    if(!noUrl(r)) e.push('contains a URL');
    return { ok:!e.length, errors:e };
  }
  var validateRow=failClosed(validateRowImpl);

  /* ============================== 10. Verdict contract ==============================
     basis = { device: key, listing: EvidenceRow|null, checks:[{ a, hard, core, result: MATCH|CONFLICT|UNKNOWN, rows:[EvidenceRow] }] }
     Matching specifications alone never yield OFFICIALLY_VERIFIED: that state needs a valid official listing row for the
     exact device key. A MATCH counts only when every backing row is a valid CONFIRMED row from tier <= 6 (never secondary). */
  function officialListing(b){
    var L=isObj(b)?b.listing:null; if(!L || !validateRow(L).ok) return null;
    if(L.a!=='compat.list' || L.st!=='CONFIRMED' || !(L.lvl>=1 && L.lvl<=5) || L.v!==b.device) return null;
    return L.op==='lists'?'listed':(L.op==='notlists'?'notlisted':null);
  }
  function effective(c){
    if(!isObj(c) || !Array.isArray(c.rows)) return 'UNKNOWN';
    if(c.result==='MATCH'){ var ok=(c.rows||[]).length>0 && c.rows.every(function(r){ return validateRow(r).ok && r.st==='CONFIRMED' && r.lvl<=6; }); return ok?'MATCH':'UNKNOWN'; }
    if(c.result==='CONFLICT'){ var okc=(c.rows||[]).length>0 && c.rows.every(function(r){ return validateRow(r).ok && r.lvl<=6; }); return okc?'CONFLICT':'UNKNOWN'; }
    return 'UNKNOWN';
  }
  function expectedVerdict(b){
    b=isObj(b)?b:{}; var L=officialListing(b), checks=(Array.isArray(b.checks)?b.checks:[]).filter(function(c){ return c && typeof c==='object' && c.hard; });
    if(L==='listed') return 'OFFICIALLY_VERIFIED';
    if(L==='notlisted') return 'INCOMPATIBLE';
    var eff=checks.map(effective);
    if(has(eff,'CONFLICT')) return 'INCOMPATIBLE';
    if(eff.length && eff.every(function(x){ return x==='MATCH'; })) return 'COMPATIBLE_BY_SPEC';
    var core=checks.filter(function(c){ return c.core; });
    if(has(eff,'UNKNOWN') && core.length && core.every(function(c){ return effective(c)==='MATCH'; })) return 'PROBABLY_COMPATIBLE_NEEDS_VERIFICATION';
    return 'UNKNOWN';
  }
  function checkVerdictImpl(v){
    var e=[]; if(!isObj(v)) return { ok:false, errors:['not an object'] };
    if(!has(VERDICTS,v.state)) e.push('state');
    var want=expectedVerdict(v.basis);
    if(v.state==='OFFICIALLY_VERIFIED' && officialListing(v.basis)!=='listed') e.push('OFFICIALLY_VERIFIED requires an official listing for the exact device');
    if(has(VERDICTS,v.state) && v.state!==want) e.push('state '+v.state+' != contract '+want);
    return { ok:!e.length, errors:e, expected:want };
  }
  var checkVerdict=failClosed(checkVerdictImpl);
  var expectedVerdictSafe=function(b){ try{ return expectedVerdict(b); }catch(_){ return 'UNKNOWN'; } };

  /* ============================== 11. LLM-suppression policy (no LLM is ever called here) ============================== */
  function llmPolicy(d){
    function r(rule,need){ return { llmNeeded:need, rule:rule }; }
    if(!isObj(d)) return r('clarify',false);                                  /* P8: a malformed decision can only clarify (no LLM) */
    var subj=arr(d.subjects), fl=isObj(d.flags)?d.flags:{};
    if(d.route==='CLARIFY') return r('clarify',false);
    if(d.route==='LOCAL'){
      if(d.reason==='catalogue_judgement') return r('catalogue_judgement_retained',true);   /* no deterministic ranker yet (later checkpoint) */
      if(d.reason==='unclassified_retained') return r('unclassified_retained',true);
      if(d.reason==='commercial_local' || d.reason==='external_availability_unsupported') return r('commercial_local',false);
      return r('local_answer',false);
    }
    var cls=arr(d.needs).map(function(n){ return isObj(n)?n.cls:null; });
    if(fl.explain || (fl.judgement && subj.length>=2)) return r('explanation_after_evidence',true);
    if(has(cls,'compatibility') || has(cls,'official_compat_list')) return r('deterministic_verdict',false);
    if(subj.length>=2) return r('deterministic_comparison',false);
    if(cls.length && cls.every(function(c){ return has(['manual_spec_detail','installation_guidance','lifecycle_eol'],c); })) return r('link_or_status',false);
    if(!subj.length) return r('deterministic_spec',false);
    return r('deterministic_threshold',false);
  }

  /* ---------- Phase 2 milestone P2-M1 (owner-approved OD-10, 2026-10-13): two read-only TEST exports ----------
     No decision path calls them; classify() and every reader are unchanged. They are views of the CURRENT power readers, used by
     tests/vero-evidence.test.js to measure the current extraction against tests/vero-evidence-power-oracle.json -- they are not the
     Phase 2 profile engine (P2-M2 ... M5 are not authorized).
       powerProfileOf(product, family) -> what the current readers extract from ONE catalogue record (identity = its own item_code;
         never a sibling, model or name fallback)
       powerMatch(req, product, family) -> the current readers' state for one requirement { quantity, watts, port:{letter,num} };
         quantities the current readers cannot represent answer UNKNOWN with a reason (fail closed) */
  var PM_ROLE={ TOTAL:'total', RATING:'total', NAMED_PORT:'port:', ANY_SINGLE:'port1', DEVICE:'device', INPUT:'input', WIRELESS:'wireless', PASSTHROUGH:'upstream' };
  function pmEmpty(reason){ return deepFreeze({ state:'UNKNOWN', engine:'current-readers', role:null, reason:reason }); }
  function powerProfileOf(p,fam){
    var f=typeof fam==='string' && fam?fam:null;
    if(!isObj(p)) return deepFreeze({ sku:null, schema:'p2-m1', engine:'current-readers', family:f, total:{ state:'UNKNOWN', values:[], quotes:[] }, roles:{} });
    var ws=wattStatements(p), R=wattRoles(p,f), roles={};
    Object.keys(R).forEach(function(k){ roles[k]=R[k].slice(); });
    return deepFreeze({ sku:str(field(p,'item_code'))||null, schema:'p2-m1', engine:'current-readers', family:f,
      total:{ state:ws.state, values:ws.values.slice(), quotes:ws.quotes.slice() }, roles:roles });
  }
  function powerMatch(req,p,fam){
    var q=isObj(req)?req:{}, quant=str(field(q,'quantity')), f=typeof fam==='string' && fam?fam:null, w=field(q,'watts');
    var v=typeof w==='number' && isFinite(w) && w>0?w:null;
    if(!isObj(p)) return pmEmpty('no product');
    if(!own(PM_ROLE,quant)) return pmEmpty('quantity not representable by the current readers');
    var role=PM_ROLE[quant];
    if(role==='port:'){ var pt=isObj(field(q,'port'))?q.port:{}, L=str(field(pt,'letter')).toLowerCase(), N=str(field(pt,'num'));
      if(!/^[ac]$/.test(L) || !/^[1-4]?$/.test(N)) return pmEmpty('no port'); role='port:'+L+N; }
    return deepFreeze({ state:wattState(p,f,role,v), engine:'current-readers', role:role, reason:null });
  }

  /* G1: every exported function stays total even for adversarial objects whose property access throws (a Proxy trap, a throwing
     getter). Plain malformed data is handled inside the helpers (P8); anything that still throws returns the documented
     fail-closed value: classify -> CLARIFY, no subject, no request, no LLM; statements -> UNKNOWN / empty; lists -> []. */
  function guard(fn,fallback){ var f=inScope(fn); return function(){ try{ return f.apply(null,arguments); }catch(_){ return fallback(); } }; }
  function failedDecision(){ return { v:VERSION, route:'CLARIFY', reason:'no_exact_subject', 'class':null, subjects:[], via:{}, entities:[], needs:[], request:null,
    llmNeeded:false, llmRule:'clarify', llmIfNoEvidence:false, flags:{ commercial:false, explain:false, judgement:false, followUp:false, deictic:false, genericDevice:false, osVersionLimited:false },
    clarify:{ kind:'subject' }, conflict:null, nextCtx:null }; }
  var API={ version:VERSION, classify:guard(classify,failedDecision), resolveSubjects:guard(resolveSubjects,function(){ return { status:'none', subjects:[], ambiguous:[] }; }),
    detectEntities:guard(detectEntities,function(){ return []; }), validateRequest:validateRequest,
    validateRow:validateRow, expectedVerdict:expectedVerdictSafe, checkVerdict:checkVerdict, llmPolicy:guard(llmPolicy,function(){ return { llmNeeded:false, rule:'clarify' }; }),
    capacityStatements:guard(capacityStatements,function(){ return { state:'UNKNOWN', values:[], derived:[], stated:[], quotes:[] }; }),
    wattStatements:guard(wattStatements,function(){ return { state:'UNKNOWN', values:[], quotes:[] }; }), displayCount:guard(displayCount,function(){ return null; }),
    negativeScopes:guard(negativeScopes,function(){ return []; }), contextSubjects:guard(contextSubjects,function(){ return { subjects:[], rejected:0, stale:[], ambiguous:[] }; }),
    powerProfileOf:guard(powerProfileOf,function(){ return deepFreeze({ sku:null, schema:'p2-m1', engine:'current-readers', family:null, total:{ state:'UNKNOWN', values:[], quotes:[] }, roles:{} }); }),
    powerMatch:guard(powerMatch,function(){ return pmEmpty('malformed input'); }),
    CLASSES:CLASSES, ROUTES:ROUTES, LOCAL_STATES:LOCAL_STATES, ROW_STATES:ROW_STATES, VERDICTS:VERDICTS, ATTRS:ATTRS, OPS:OPS, UNITS:UNITS,
    TIERS:TIERS, REASONS:REASONS, LLM_RULES:LLM_RULES, VENDORS:VENDORS };
  deepFreeze(CLASSES); deepFreeze(ROUTES); deepFreeze(LOCAL_STATES); deepFreeze(ROW_STATES); deepFreeze(VERDICTS); deepFreeze(ATTRS);
  deepFreeze(OPS); deepFreeze(UNITS); deepFreeze(TIERS); deepFreeze(REASONS); deepFreeze(LLM_RULES); deepFreeze(VENDORS);
  Object.freeze(API);
  if(typeof module!=='undefined' && module.exports) module.exports=API;
  root.VeroEvidence=API;
})(typeof window!=='undefined'?window:globalThis);
