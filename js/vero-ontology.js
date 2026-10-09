/* VERO Local Brain v2-1 — core ontology (SHADOW ONLY).
   Concept data for the accountable parser (vero-parse.js): connectors with versions, port roles, features with evidence
   patterns, device classes (routing HINTS only, never compatibility proof), named device lines, field concepts, units,
   intent cues, function / discourse words and the sense table for ambiguous terms.
   Product families, subtypes and family aliases are NOT repeated here: they are read from VeroLexicon at run time, so the
   ontology stays one source of truth with the live engine. No catalog codes, no SKU lists: every product edge is derived
   from products.json by vero-parse.js, so new SKUs take part automatically.
   v2-2B adds structural word classes (interfaces + canonVersion, lanes, negation, quantifiers, ordinals, references,
   comparatives, NAME-guard classes) so the parser can emit the A5 turn frame. Still shadow only.
   Not loaded by index.html; nothing here changes what users see.
   Browser: window.VeroOntology; Node: module.exports. */
(function(root){
  'use strict';

  /* ---------- connectors (plug / port kinds) ----------
     aliases are matched as whole phrases on the normalized query and product name; versions are the version strings that
     may follow the connector word ("hdmi 2.1", "usb 3.0 a", "dp 1.4"). 'senseTerm' marks an alias that is ambiguous and
     must go through the sense resolver (dp = DisplayPort or Dealer Price). */
  var CONNECTORS={
    usb_a:{ label:'USB-A', aliases:['usb-a','usb a','usba','type-a','type a','usb type a','usb type-a'], versions:['2.0','3.0','3.1','3.2'], group:'usb' },
    usb_c:{ label:'USB-C', aliases:['usb-c','usb c','usbc','type-c','type c','typec','usb type c','usb type-c','tipe c','c type'], versions:['2.0','3.0','3.1','3.2','gen 1','gen 2'], group:'usb' },
    micro_usb:{ label:'Micro USB', aliases:['micro usb','micro-usb','microusb','micro b','micro-b'], group:'usb' },
    usb_b:{ label:'USB-B', aliases:['usb-b','usb b','type-b','type b','printer port'], group:'usb' },
    lightning:{ label:'Lightning', aliases:['lightning'], group:'apple' },
    hdmi:{ label:'HDMI', aliases:['hdmi'], versions:['1.4','2.0','2.1','2.2'], group:'video' },   /* V2-2C C1: 2.2 is a version token only (no catalogue semantics) */
    mini_hdmi:{ label:'Mini HDMI', aliases:['mini hdmi','mini-hdmi'], group:'video' },
    micro_hdmi:{ label:'Micro HDMI', aliases:['micro hdmi','micro-hdmi'], group:'video' },
    dp:{ label:'DisplayPort', aliases:['displayport','display port','dp'], versions:['1.2','1.4','2.0','2.1'], group:'video', senseTerm:'dp' },
    mini_dp:{ label:'Mini DisplayPort', aliases:['mini dp','mini-dp','mini displayport','mini display port','mdp'], group:'video' },
    vga:{ label:'VGA', aliases:['vga'], group:'video' },
    dvi:{ label:'DVI', aliases:['dvi'], group:'video' },
    rj45:{ label:'RJ45', aliases:['rj45','rj 45','rj-45','ethernet','lan'], group:'network' },
    aux35:{ label:'3.5mm', aliases:['3.5mm','3.5 mm','3.5mm audio','aux','headphone jack','audio jack'], group:'audio' },
    jack635:{ label:'6.35mm', aliases:['6.35mm','6.35 mm','6.5mm','1/4 inch'], group:'audio' },
    rca:{ label:'RCA', aliases:['rca','2rca','2 rca','2*rca'], group:'audio' },
    toslink:{ label:'Toslink (optical)', aliases:['toslink','optical','spdif','s/pdif','fiber optic audio','optical audio'], group:'audio' },
    sd:{ label:'SD', aliases:['sd','sd card'], group:'card' },
    tf:{ label:'TF / microSD', aliases:['tf','micro sd','microsd','tf card','micro sd card'], group:'card' },
    m2:{ label:'M.2', aliases:['m.2','m2','ngff'], group:'storage' },
    sata:{ label:'SATA', aliases:['sata'], group:'storage' },
    thunderbolt:{ label:'Thunderbolt', aliases:['thunderbolt','tbt'], versions:['3','4','5'], group:'usb' },   /* V2-2C C1: "tb4" / "thunderbolt4" are split by the lexer; a bare "tb" is not Thunderbolt (often terabyte) */
    usb4:{ label:'USB4', aliases:['usb4','usb 4'], group:'usb' },
    /* v2-2B: PCIe is an expansion INTERFACE (never a product-line name); "pci-e" / "pci express" are normalized to "pcie" */
    pcie:{ label:'PCIe', aliases:['pcie'], versions:['1.0','2.0','3.0','4.0','5.0','6.0'], group:'expansion' }
  };
  /* generic "usb" with a version and a trailing a / c ("usb 3.0 a", "usb3.2 c") resolves to usb_a / usb_c with that version */
  var USB_VERSIONED=/\busb\s?(2\.0|3\.0|3\.1|3\.2)\s?(a|c)\b/;
  /* standards that behave like versions of a family (cable categories, Wi-Fi generations, Bluetooth versions) */
  var STANDARDS={
    cat5e:{ label:'Cat5e', aliases:['cat5e','cat 5e'], family:'lan_cable' }, cat6:{ label:'Cat6', aliases:['cat6','cat 6'], family:'lan_cable' },
    cat6a:{ label:'Cat6A', aliases:['cat6a','cat 6a'], family:'lan_cable' }, cat7:{ label:'Cat7', aliases:['cat7','cat 7'], family:'lan_cable' },
    cat8:{ label:'Cat8', aliases:['cat8','cat 8'], family:'lan_cable' },
    wifi6:{ label:'Wi-Fi 6', aliases:['wifi 6','wi-fi 6','wifi6','ax'], family:'network_adapter' },
    bt53:{ label:'Bluetooth 5.3', aliases:['bluetooth 5.3','bt 5.3','5.3'], family:null }
  };

  /* ---------- port roles ----------
     plug = the cable/adapter end; input / output = signal direction; data_port = downstream data ports of a hub;
     power_input = a port that powers the device (PD in / DC in / "power port"); charging_output = a port that charges
     another device; display_output; audio; card_slot. 'cues' are query / name phrases that bind a role. */
  var PORT_ROLES={
    plug:{ label:'plug', cues:['male','plug','connector end'] },
    input:{ label:'input', cues:['input','in port','source'] },
    output:{ label:'output', cues:['output','out port','labas'] },
    data_port:{ label:'data port', cues:['data port','usb port','usb ports'] },
    power_input:{ label:'power port', cues:['power port','power input','pd in','pd input','dc in','dc input','power supply','charging port','pass-through','passthrough','pass through','pd port'] },
    charging_output:{ label:'charging port', cues:['charging output','output port','charging ports'] },
    display_output:{ label:'display output', cues:['display output','video output','monitor port'] },
    audio:{ label:'audio port', cues:['audio port','audio jack','headphone jack'] },
    card_slot:{ label:'card slot', cues:['card slot','slot'] }
  };

  /* ---------- features ----------
     'aliases' bind a query phrase to the feature; 'evidence' is matched on the product NAME (strong) and FEATURES lines
     (medium); 'negative' marks an explicit contradiction ("without audio"). The description is never evidence (same
     hierarchy as VeroFacts). A feature with no evidence is UNKNOWN, not false. 'hard' = changes what product is meant. */
  var FEATURES={
    mic:{ label:'built-in mic', aliases:['mic','microphone','with mic','may mic','w/ mic','inline mic','in-line mic','built-in mic','built in mic','builtin mic'], evidence:'\\b(?:mic|microphone|in-?line control|hands-?free calls?)\\b', hard:true },
    anc:{ label:'active noise cancelling', aliases:['anc','noise cancelling','noise canceling','noise cancellation'], evidence:'\\b(?:anc|active noise|noise cancel)', hard:true },
    open_ear:{ label:'open-ear', aliases:['open ear','open-ear','clip-on','clip on','air conduction'], evidence:'\\b(?:open[- ]?ear|open wearable|open[- ]?fit|clip[- ]on|air conduction|ear[- ]?clip)', hard:true },
    fan:{ label:'cooling fan', aliases:['fan','cooling fan','may fan','with fan'], evidence:'\\b(?:fan|cooling)\\b', hard:true },
    audio:{ label:'audio', aliases:['audio','may audio','with audio','sound'], evidence:'\\b(?:audio|3\\.5 ?mm|sound)\\b', negative:'\\bwithout audio\\b|\\bno audio\\b', hard:true },
    power_port:{ label:'power port', aliases:['power port','power input','may power port','with power port','pd in','dc in'], evidence:'\\b(?:power port|power input|pd in|dc in|power supply|pd charging port|charging port)\\b', hard:true },
    passthrough:{ label:'pass-through charging', aliases:['pass-through','passthrough','pass through','charging port','may charging port','with charging port'], evidence:'\\b(?:pass[- ]?through|pd charging|charging port|female adapter|\\+ ?usb-c female|\\+ ?type c female)', hard:true },
    builtin:{ label:'built-in cable', aliases:['built-in cable','built in cable','build in cable','builtin cable','integrated cable','attached cable','sariling cable','nakakabit na cable','may cable na nakakabit','built-in','built in','builtin','build in'], evidence:'\\b(?:built-?in|build-?in|integrated) cable', hard:true },
    retractable:{ label:'retractable cable', aliases:['retractable','retractable cable'], evidence:'\\bretractable\\b', hard:true },
    magnetic:{ label:'magnetic', aliases:['magnetic','magnet'], evidence:'\\bmagnetic\\b', hard:true },
    magsafe:{ label:'MagSafe', aliases:['magsafe','mag safe'], evidence:'\\bmagsafe\\b', hard:true },
    qi2:{ label:'Qi2', aliases:['qi2','qi 2'], evidence:'\\bqi2\\b|\\bqi 2\\b', hard:true },
    gan:{ label:'GaN', aliases:['gan'], evidence:'\\bgan\\b', hard:false },
    pd:{ label:'PD fast charging', aliases:['pd','power delivery','fast charging','fast charge'], evidence:'\\bpd\\b|power delivery|fast charg', hard:false },
    waterproof:{ label:'water resistant', aliases:['waterproof','water resistant','water-resistant'], evidence:'\\bwater ?(?:proof|resistant)|\\bipx?\\d', hard:true },
    rgb:{ label:'RGB lighting', aliases:['rgb'], evidence:'\\brgb\\b', hard:true },
    braided:{ label:'braided', aliases:['braided','nylon braided'], evidence:'\\bbraided\\b', hard:false },
    angled:{ label:'angled / 90°', aliases:['angled','90 degree','right angle','l-shape','l shape','elbow'], evidence:'\\b(?:angled|90 ?(?:°|degree)|right[- ]angle|l[- ]shape|elbow)', hard:true },
    active:{ label:'active (signal booster)', aliases:['active','with chipset','booster'], evidence:'\\b(?:active|chipset|booster|amplifier)\\b', hard:false },
    dual_band:{ label:'dual-band', aliases:['dual band','dual-band','dualband','2.4g/5g','2.4/5ghz'], evidence:'\\bdual[- ]?band\\b', hard:true },
    wireless:{ label:'wireless', aliases:['wireless','cordless'], evidence:'\\bwireless\\b|\\bbluetooth\\b|\\bwi-?fi\\b', hard:true },
    wifi:{ label:'Wi-Fi', aliases:['wifi','wi fi','wlan'], evidence:'\\bwi-?fi\\b|\\bwlan\\b|\\bwireless (?:usb )?adapter\\b', hard:true },
    bluetooth:{ label:'Bluetooth', aliases:['bluetooth','bt'], evidence:'\\bbluetooth\\b', hard:true },
    foldable:{ label:'foldable', aliases:['foldable','folding','collapsible'], evidence:'\\bfold(?:able|ing)\\b', hard:false },
    slim:{ label:'slim', aliases:['slim','thin','compact'], evidence:'\\b(?:slim|thin|compact)\\b', hard:false },
    high_gain:{ label:'high-gain antenna', aliases:['high gain','high-gain','antenna','long range'], evidence:'\\bhigh[- ]?gain\\b|\\bantenna\\b', hard:true },
    air_vent:{ label:'air-vent mount', aliases:['air vent','aircon vent','vent'], evidence:'\\bair ?vent\\b|\\bvent\\b', hard:true },
    hdd:{ label:'HDD / SATA drive', aliases:['hdd','hard drive','hard disk','sata hdd'], evidence:'\\bhdd\\b|hard (?:drive|disk)|\\bsata\\b', hard:false },
    displaylink:{ label:'DisplayLink', aliases:['displaylink','display link'], evidence:'\\bdisplay ?link\\b', hard:true },
    led:{ label:'LED display', aliases:['led','digital display','display screen'], evidence:'\\bled\\b|digital display', hard:false },
    nvme:{ label:'NVMe', aliases:['nvme','pcie nvme'], evidence:'\\bnvme\\b', hard:true },
    sata_proto:{ label:'SATA', aliases:['m.2 sata','sata ssd'], evidence:'\\bsata\\b', hard:true },
    poe:{ label:'PoE', aliases:['poe'], evidence:'\\bpoe\\b', hard:true },
    without_audio:{ label:'without audio', aliases:['without audio','no audio','walang audio'], evidence:'\\bwithout audio\\b', hard:true },
    /* V2-2C C1: DisplayPort Alternate Mode is STATED or MENTIONED only; it is never implied by USB-C or USB4 */
    dp_alt:{ label:'DP Alt Mode', aliases:['dp alt mode','dp alt','dp altmode','displayport alt mode','displayport alternate mode','alt mode','alternate mode'], evidence:'\\b(?:dp|displayport) ?alt(?:ernate)? ?mode\\b|\\balt(?:ernate)? mode\\b', hard:true }
  };
  /* V2-2C C1: governed feature relations. An implied feature is INFERRED (labelled, never exact), never CONFIRMED:
     a retractable cable is a built-in cable; the reverse does not hold. */
  var FEATURE_IMPLIES={ retractable:['builtin'] };

  /* ---------- device classes: HINTS ONLY ----------
     Used for routing, candidate ordering, likely connector needs and the clarification question. Never a compatibility
     proof: "projector" does not tell us which inputs a particular projector has. */
  var DEVICE_CLASSES={
    projector:{ label:'projector', aliases:['projector','projectors','proyektor'], likelyInputs:['hdmi','vga'] },
    monitor:{ label:'monitor', aliases:['monitor','monitors','display','external display','external displays','external monitor','external monitors','screen'], likelyInputs:['hdmi','dp','vga','usb_c'] },
    tv:{ label:'TV', aliases:['tv','tvs','television','smart tv','telebisyon'], likelyInputs:['hdmi'] },
    laptop:{ label:'laptop', aliases:['laptop','laptops','notebook','notebooks'], likelyPorts:['usb_c','usb_a','hdmi'] },
    phone:{ label:'phone', aliases:['phone','phones','smartphone','cellphone','cp','selpon','mobile phone'], likelyPorts:['usb_c','lightning'] },
    tablet:{ label:'tablet', aliases:['tablet','tablets'], likelyPorts:['usb_c','lightning'] },
    desktop:{ label:'desktop PC', aliases:['desktop','pc','computer','cpu unit'], likelyPorts:['usb_a','hdmi','dp','rj45'] },
    console:{ label:'game console', aliases:['console','game console','gaming console'], likelyPorts:['hdmi','usb_c'] },
    car:{ label:'car', aliases:['car','kotse','sasakyan','oto','vehicle'], likelyPorts:['usb_a','usb_c'] },
    printer:{ label:'printer', aliases:['printer','printers'], likelyPorts:['usb_b'] },
    router:{ label:'router / modem', aliases:['router','modem','wifi router'], likelyPorts:['rj45'] },
    speaker:{ label:'speaker / amplifier', aliases:['speaker','speakers','amplifier','amp','soundbar','sound system','stereo'], likelyInputs:['aux35','rca','toslink'] },
    camera:{ label:'camera', aliases:['camera','dslr','action cam'], likelyPorts:['usb_c','micro_usb','sd'] },
    headphones:{ label:'headphones', aliases:['headphones','headphone'], likelyPorts:['aux35'] }
  };
  /* ---------- named device lines ----------
     A named device span absorbs its own model modifiers ("macbook air", "iphone 15 pro max", "galaxy s24 ultra"), so a
     modifier inside a device name is never read as a product line ("air", "pro", "max"). */
  var NAMED_DEVICES={
    macbook:{ label:'MacBook', cls:'laptop', words:['macbook'], mods:['air','pro','m1','m2','m3','m4','m5','13','14','15','16'], prefixMods:['m1','m2','m3','m4','m5','intel'] },
    mac:{ label:'Mac (macOS)', cls:'laptop', words:['mac','macos'], mods:['os'] },
    windows:{ label:'Windows PC', cls:'laptop', words:['windows'], mods:['laptop','pc','11','10'] },
    imac:{ label:'iMac', cls:'desktop', words:['imac'], mods:[] },
    mac_mini:{ label:'Mac mini', cls:'desktop', words:['mac mini'], mods:['m1','m2','m4'] },
    iphone:{ label:'iPhone', cls:'phone', words:['iphone'], mods:['pro','max','plus','mini','se','\\d{1,2}'] },
    ipad:{ label:'iPad', cls:'tablet', words:['ipad'], mods:['pro','air','mini','\\d{1,2}'] },
    galaxy:{ label:'Samsung Galaxy', cls:'phone', words:['galaxy','samsung'], mods:['s\\d{1,2}','a\\d{1,2}','z','fold\\d?','flip\\d?','tab','note\\d{0,2}','ultra','plus','fe'] },
    pixel:{ label:'Google Pixel', cls:'phone', words:['pixel'], mods:['\\d{1,2}','pro','a','xl'] },
    android:{ label:'Android phone', cls:'phone', words:['android'], mods:[] },
    xiaomi:{ label:'Xiaomi / Redmi', cls:'phone', words:['xiaomi','redmi','poco'], mods:['note','\\d{1,2}','pro','plus'] },
    oppo:{ label:'OPPO / vivo / realme', cls:'phone', words:['oppo','vivo','realme','infinix','tecno','huawei','oneplus'], mods:['\\d{1,2}','pro','plus'] },
    thinkpad:{ label:'ThinkPad / Windows laptop', cls:'laptop', words:['thinkpad','zenbook','matebook','chromebook','surface'], mods:['pro','laptop','\\d{1,2}'] },
    ps5:{ label:'PlayStation', cls:'console', words:['ps5','ps4','playstation'], mods:['slim','pro'] },
    xbox:{ label:'Xbox', cls:'console', words:['xbox'], mods:['series','x','s','one'] },
    nintendo_switch:{ label:'Nintendo Switch', cls:'console', words:['nintendo switch','nintendo'], mods:['oled','lite','2'] },
    steam_deck:{ label:'Steam Deck', cls:'console', words:['steam deck'], mods:['oled'] },
    airpods:{ label:'AirPods', cls:'headphones', words:['airpods'], mods:['pro','max','\\d'] }
  };

  /* ---------- field concepts ----------
     Asked-for properties. 'measure' = the word can stand after a count cue as the thing being measured ("ilang watts"),
     which makes the question an ATTRIBUTE of the subject rather than a COUNT of products. */
  var FIELDS={
    srp:{ label:'SRP', aliases:['srp','retail price','suggested retail price'], price:true },
    dp:{ label:'Dealer Price (DP)', aliases:['dealer price','dp'], price:true, senseTerm:'dp' },
    dp_vol:{ label:'DP Volume', aliases:['dp vol','dp volume','dpv','volume price','dp-vol'], price:true },
    moq:{ label:'MOQ', aliases:['moq','mcq','minimum order','minimum qty','minimum order quantity'] },
    price:{ label:'price', aliases:['price','presyo','magkano','how much','cost','halaga','prices'], price:true },
    watts:{ label:'wattage', aliases:['watts','watt','wattage','power output','output power'], measure:true, attr:'watts' },
    mah:{ label:'capacity', aliases:['mah','capacity','kapasidad','battery capacity'], measure:true, attr:'mah' },
    length:{ label:'length', aliases:['length','haba','gaano kahaba','meters','metro','long'], measure:true, attr:'lengthM' },
    connector:{ label:'connector', aliases:['connector','connectors','port type','anong port','what port','saksakan'], attr:'connectors' },
    ports:{ label:'port count', aliases:['ports','port','outputs','output ports'], measure:true, attr:'ports' },
    colour:{ label:'colour', aliases:['color','colors','colour','colours','kulay','ibang kulay','other colors','other color','ibang color','variants'], measure:true, attr:'color' },
    speed:{ label:'speed', aliases:['speed','bilis','gaano kabilis','bandwidth','transfer rate','data rate'], attr:'dataGbps' },
    price_history:{ label:'price history', aliases:['price history','price change','price changes','price increase','price decrease','previous srp','old price','dating presyo','nagbago','tumaas','bumaba','tinaas','binaba','nagtaas','repriced'], history:true },
    sku:{ label:'SKU / item code', aliases:['sku','skus','item code','code'] },
    model:{ label:'model', aliases:['model','model number'] },
    description:{ label:'description', aliases:['description','details','specs','specifications','features','desc'] },
    bays:{ label:'drive bays', aliases:['bays','bay'], measure:true, attr:'nasBays' }
  };

  /* ---------- units ---------- */
  var UNITS={
    W:{ dim:'watts', aliases:['w','watt','watts'] },
    mAh:{ dim:'mah', aliases:['mah','mah.'] },
    m:{ dim:'length', factor:1, aliases:['m','meter','meters','metre','metres','metro','metros','mtr','mtrs'] },
    cm:{ dim:'length', factor:0.01, aliases:['cm','centimeter','centimeters'] },
    mm:{ dim:'length', factor:0.001, aliases:['mm'] },
    ft:{ dim:'length', factor:0.3048, aliases:['ft','feet','foot'] },
    inch:{ dim:'size', aliases:['inch','inches','in','"','pulgada'] },
    Gbps:{ dim:'speed', aliases:['gbps','gb/s','g'] },
    Mbps:{ dim:'speed', factor:0.001, aliases:['mbps','mb/s'] },
    Hz:{ dim:'refresh', aliases:['hz'] },
    TB:{ dim:'storage', aliases:['tb'] },
    GB:{ dim:'storage', factor:0.001, aliases:['gb'] },
    V:{ dim:'volts', aliases:['v','volt','volts'] },
    port:{ dim:'ports', aliases:['port','ports','-port','port hub'] },
    in1:{ dim:'ports', aliases:['in-1','in 1','in1'] },
    peso:{ dim:'price', aliases:['php','peso','pesos','₱','p'] },
    k:{ dim:'thousand', aliases:['k'] }
  };

  /* ---------- intent cues ---------- */
  var INTENT_CUES={
    count:['how many','ilan','ilang','number of','count of','gaano karami','ilan ang','ilan yung'],
    exist:['do we have','do you have','is there','are there','meron ba','mayroon ba','may ganito ba','meron tayong','meron kayo','meron kayong','may tayo','meron','mayroon','may','have','got','kayo'],
    rankMin:['cheapest','least expensive','pinakamura','pinaka mura','pinakamurang','lowest price','pinakamababang presyo','lowest'],
    rankMax:['most expensive','priciest','pinakamahal','pinaka mahal','pinakamahal na','highest price','highest','biggest','largest','pinakamalaki','pinakamalaking','pinaka malaki','pinakamataas','pinakamahaba','pinakamabilis','longest','fastest','strongest','max','pinakamarami','pinakamaraming'],
    compare:['compare','comparison','vs','versus','difference','pinagkaiba','ikumpara','alin mas','which is better','alin ang mas'],
    comparative:['mas mura','cheaper','mas mahal','more expensive','mas mataas','higher','mas mababa','lower','mas mahaba','longer','mas maikli','shorter','mas malaki','bigger','mas mabilis','faster','mas okay','better'],
    history:['nagiba','nagiba ba','nagbago ba','price history','price change','price changes','price increase','price decrease','increase','decrease','increased','decreased','price up','price down','tinaasan','binabaan','nagbago','nagbago presyo','tumaas','bumaba','tinaas','binaba','nagtaas','dating presyo','previous price','repriced'],
    compat:['compatible','compatibility','works with','work with','kaya ba','pwede ba','puwede ba','pwede sa','puwede sa','gagana','gagana ba','gagana sa','fit','kasya','bagay sa','supported','support','supports','support ba','will it work','can i use','magagamit','run','mag-run','gumana','compatible ba'],
    judge:['maganda','magandang','okay ba','ok ba','enough','sapat','suitable','bagay','premium','sulit','worth it','ideal','better','mas ok','mas okay','bakit','why','explain','i-explain','pitch','alin mas ok','alin ang maganda','good for'],
    recommend:['recommend','recommendation','reco','suggest','suggestion','suggestions','best','sulit','what should','ano maganda','anong maganda','irerecommend','i-recommend','i-suggest'],
    inventory:['in stock','in-stock','out of stock','stocks','stock','on hand','onhand','inventory','sold out','soldout','remaining','natitira','natira','any left','left','ubos','ubos na','naubos','may stock pa','warehouse','bodega','supply','supplies','restock'],
    attribute:['ano','anong','what','whats',"what's",'what is','ano ang','ano yung','alin'],
    alternative:['alternative','alternatives','replacement','kapalit','similar','same as','closest','katulad','kahalintulad','other option','iba pang option','iba','ibang','iba pa','ibang option','other','others','instead','same wattage','same capacity','same specs','same length','closest replacement'],
    nodata:['best seller','bestseller','best-seller','top selling','top seller','mabenta','pinakamabenta','sikat','popular','trending','newest','latest','pinakabago','pinakabagong','bagong labas','new arrival','new arrivals'],
    groupby:['category','categories','section','sections','brand','line','product line','per category','by category'],
    coach:['upsell','bundle','i-bundle','hero sku','hero','i-push','push','objection','ano sasabihin','pwede sabihin','sabihin','customer says','says','paano i-explain','pitch','cross-sell','sales talk','script'],
    find:['show','list','give','pakita','patingin','hanap','hanapin','looking for','need','kailangan','gusto','want','search']
  };
  var RANK_METRICS={ /* superlative word -> metric it ranks by (when the query names no other metric) */
    pinakamura:'price', pinakamurang:'price', cheapest:'price', lowest:'price', pinakamahal:'price', priciest:'price',
    pinakamalaki:'size', pinakamalaking:'size', biggest:'size', largest:'size', pinakamahaba:'length', longest:'length',
    pinakamabilis:'speed', fastest:'speed', strongest:'watts', pinakamataas:'value', highest:'value', pinakamarami:'ports', pinakamaraming:'ports'
  };

  /* ---------- function, discourse and Taglish particles ----------
     Bound as FUNCTION/DISCOURSE spans: they carry grammar, not product meaning, so they never count as dropped. */
  var FUNCTION_WORDS=('a an the of to is are am be was were it its this that these those there here and or but with without w/ '+
    'for from in on at by as if so do does did can could would should will shall may might must i you we they he she me us our your my '+
    'ng ang ang mga mga sa na ba po pa naman lang yung ung yun iyon iyan yan ito nito dito diyan doon dun si ni kay kina nina at o '+
    'ano anong alin aling sino saan kailan paano bakit gaano ilan ilang ka ko mo kayo tayo natin namin nila siya sila kami '+
    'din rin daw raw nga kasi eh e ha ho oh ah uy pls please sir maam ma\'am miss boss bro idol mam '+
    'any some all more most also just only still yet already please kindly really talaga sana pala muna ulit again '+
    'meron mayroon may wala walang kung pag kapag para pang pa-ng need kailangan gusto want looking hanap '+
    'what which who whats what\'s how about much many get got have has had give show tell know '+
    'customer customers client clients kliyente buyer ni sabay kesa kaysa using gamit one isa does do is will would can could pa-help paki '+
    'pero lahat something anything sobrang super po pareho mag nag ko ko ang').split(/\s+/);
  var DISCOURSE=['ok','okay','sige','salamat','thanks','thank you','ty','next question','new question','another question','last na','last question','by the way','btw',
    'iba naman','ibang tanong','tanong lang','question','follow up','follow-up','also','tapos','then','hello','hi','hey','good morning','good afternoon','kumusta','kamusta',
    'help','sa help','kanina','ulit','pa more','one more','isa pa','vero','magandang umaga','magandang hapon','magandang gabi','good evening','how are you','musta','yo','hi there','hello there'];
  /* reference / focus words: point at a product already in the conversation or named in the same turn */
  var REFERENCE=['ito','nito','iyan','yan','yun','yung','iyon','this','that','these','those','it','them','this one','that one','yon','un','nyan','niyan','nun','noon','dun','doon','diyan','dyan'];

  /* ---------- sense table (ambiguous terms) ----------
     Each term lists senses; each sense has a prior and contextual signals with weights (positive or negative).
     Signal kinds (evaluated by vero-parse.js over the span ledger):
       near:[words]      a word/phrase within ±3 tokens            nextWord / prevWord:[words]  the adjacent token
       nextType / prevType:[span types]                            hasType:[span types] anywhere in the question
       nextNumber / prevNumber:true  adjacent number token          versionNext:true  a version number follows (1.4, 2.1)
       subjectFamily:[families] / subjectFamilyNot:[families]      the family of the subject (anchor/name/family span)
       atEnd / atStart:true                                        ctxField / ctxFamily:[...] previous turn
     Score = prior + sum(weights of firing signals). Selected = best; margin = best - second. A high-impact term with
     margin < MARGIN_MIN is AMBIGUOUS (clarify or surface the interpretation). */
  var MARGIN_MIN=1.0;
  var SENSES={
    dp:{ impact:'high', senses:[
      { id:'field.dp', concept:'field', value:'dp', prior:0.4, signals:[
        { near:['srp','moq','price','presyo','magkano','dealer','vol','volume','discount','margin','cost'], w:2.5 },
        { prevWord:['ano','anong','what','whats',"what's",'ang','yung','and','at','with','plus','tsaka'], w:1.2 },
        { nextWord:['ng','of','for','nya','niya','sa','price','vol','volume','?'], w:1.5 },
        { prevType:['ANCHOR','NAME','NUMUNIT'], w:1.4 }, { atEnd:true, w:0.6 },
        { subjectFamilyNot:['video_cable','video_adapter','hub_dock','av_switch','capture_card'], w:1.4 },
        { ctxField:['srp','dp','dp_vol','moq','price'], w:1.0 } ]},
      { id:'connector.dp', concept:'connector', value:'dp', prior:0.4, signals:[
        { near:['hdmi','vga','dvi','usb-c','usb c','type c','type-c','cable','adapter','converter','port','monitor','display','4k','8k','144hz','165hz','hz','male','female','dock','hub','kvm','switch'], w:2.0 },
        { nextWord:['to','cable','adapter','port','1.2','1.4','2.0','2.1','male','alt'], w:2.2 }, { prevWord:['to','mini','usb-c','hdmi','mini-'], w:2.2 },
        { versionNext:true, w:2.5 }, { subjectFamily:['video_cable','video_adapter','hub_dock','av_switch'], w:1.5 } ]}
    ]},
    switch:{ impact:'high', senses:[
      { id:'family.network_switch', concept:'family', value:'network_switch', prior:0.2, signals:[ { near:['port','ports','gigabit','ethernet','lan','network','rj45','poe','unmanaged','managed','5','8','16'], w:2.0 }, { prevType:['PORTCOUNT'], w:2.0 } ]},
      { id:'family.av_switch', concept:'family', value:'av_switch', prior:0.2, signals:[ { near:['hdmi','video','dp','displayport','4k','8k','splitter','switcher','monitor','input','in 1 out','tv'], w:2.0 } ]},
      { id:'family.usb_switch', concept:'family', value:'usb_switch', prior:0.1, signals:[ { near:['usb','sharing','kvm','printer','keyboard','mouse','pc','computers'], w:2.0 } ]},
      { id:'device.nintendo_switch', concept:'device', value:'nintendo_switch', prior:0.0, signals:[ { near:['nintendo','oled','lite','joy-con','joycon','game','games','dock'], w:2.5 }, { prevWord:['sa','for','para','pang','with'], w:1.5 } ]}
    ]},
    mini:{ impact:'medium', senses:[
      { id:'line.mini', concept:'nameMod', value:'mini', prior:0.3, signals:[ { prevType:['NAME'], w:2.5 } ]},
      { id:'connector.mod', concept:'connectorMod', value:'mini', prior:0.3, signals:[ { nextType:['CONNECTOR'], w:2.5 } ]},
      { id:'device.mod', concept:'deviceMod', value:'mini', prior:0.0, signals:[ { prevType:['DEVICE'], w:3.0 } ]},
      { id:'feature.small', concept:'qualifier', value:'mini', prior:0.5, signals:[ { hasType:['FAMILY'], w:0.5 } ]}
    ]},
    air:{ impact:'medium', senses:[
      { id:'device.mod', concept:'deviceMod', value:'air', prior:0.0, signals:[ { prevType:['DEVICE'], w:3.0 } ]},
      { id:'feature.air_vent', concept:'feature', value:'air_vent', prior:0.0, signals:[ { nextWord:['vent','aircon'], w:3.0 }, { near:['car','holder','mount'], w:0.8 } ]},
      { id:'line.air', concept:'nameMod', value:'air', prior:0.2, signals:[ { prevType:['NAME'], w:2.5 } ]}
    ]},
    pro:{ impact:'medium', senses:[
      { id:'device.mod', concept:'deviceMod', value:'pro', prior:0.0, signals:[ { prevType:['DEVICE'], w:3.0 } ]},
      { id:'line.pro', concept:'nameMod', value:'pro', prior:0.3, signals:[ { prevType:['NAME'], w:2.5 } ]},
      { id:'qualifier.pro', concept:'qualifier', value:'pro', prior:0.2, signals:[] }
    ]},
    max:{ impact:'medium', senses:[
      { id:'device.mod', concept:'deviceMod', value:'max', prior:0.0, signals:[ { prevType:['DEVICE'], w:3.0 } ]},
      { id:'line.max', concept:'nameMod', value:'max', prior:0.1, signals:[ { prevType:['NAME'], w:2.5 } ]},
      { id:'rank.max', concept:'rank', value:'max', prior:0.4, signals:[ { nextType:['FIELD','NUMUNIT'], w:2.0 }, { near:['watts','output','capacity','speed','mah','power'], w:1.5 } ]}
    ]},
    plus:{ impact:'low', senses:[
      { id:'device.mod', concept:'deviceMod', value:'plus', prior:0.0, signals:[ { prevType:['DEVICE'], w:3.0 } ]},
      { id:'line.plus', concept:'nameMod', value:'plus', prior:0.3, signals:[ { prevType:['NAME'], w:2.5 } ]},
      { id:'conj.plus', concept:'function', value:'and', prior:0.3, signals:[ { nextType:['CONNECTOR','FIELD'], w:1.5 } ]}
    ]},
    dual:{ impact:'medium', senses:[
      { id:'feature.dual_band', concept:'feature', value:'dual_band', prior:0.0, signals:[ { nextWord:['band','band.','bands'], w:3.0 } ]},
      { id:'usecase.dual_monitor', concept:'useCase', value:'dual_monitor', prior:0.0, signals:[ { nextWord:['monitor','monitors','display','displays','screen','screens'], w:3.0 } ]},
      { id:'count.two', concept:'count', value:2, prior:0.5, signals:[ { nextType:['CONNECTOR'], w:1.5 }, { nextWord:['port','ports','usb','usb-c'], w:1.5 } ]}
    ]},
    port:{ impact:'medium', senses:[
      { id:'unit.ports', concept:'portCount', value:'ports', prior:0.2, signals:[ { prevNumber:true, w:3.0 } ]},
      { id:'role.port', concept:'portRole', value:'port', prior:0.2, signals:[ { prevWord:['power','charging','pd','dc','data','audio','display','input','output'], w:3.0 } ]},
      { id:'field.ports', concept:'field', value:'ports', prior:0.2, signals:[ { prevWord:['ilang','ilan','how many','many'], w:3.0 } ]},
      { id:'field.connector', concept:'field', value:'connector', prior:0.1, signals:[ { prevWord:['anong','what','which'], w:2.5 } ]}
    ]},
    available:{ impact:'high', senses:[
      { id:'catalog.listed', concept:'exist', value:'listed', prior:0.3, signals:[ { near:['color','colors','kulay','colour','variant','variants','size','sizes','length','lengths'], w:2.5 }, { near:['in','sa'], w:0.2 } ]},
      { id:'inventory.stock', concept:'inventory', value:'stock', prior:0.8, signals:[ { near:['stock','stocks','now','ngayon','pa','still','today','qty','quantity','left','ilan'], w:2.0 } ]}
    ]},
    'meron pa':{ impact:'high', senses:[
      { id:'inventory.stock', concept:'inventory', value:'stock', prior:0.5, signals:[ { near:['stock','stocks','natira','left','ilan','warehouse','bodega','supply'], w:2.0 }, { prevType:['ANCHOR'], w:0.8 }, { nextType:['ANCHOR'], w:0.8 } ]},
      { id:'more.options', concept:'alternative', value:'more', prior:0.2, signals:[ { nextWord:['bang','ba','bang mas','iba','ibang','mas','other','others','ibang option'], w:1.0 }, { near:['mas','iba','ibang','other','cheaper','mura','mahal','option','options'], w:2.5 } ]}
    ]},
    'ilan pa':{ impact:'high', senses:[
      { id:'inventory.qty', concept:'inventory', value:'qty', prior:0.7, signals:[ { near:['natira','natitira','left','stock','stocks','remaining'], w:2.0 } ]},
      { id:'count.more', concept:'count', value:'more', prior:0.2, signals:[ { near:['option','options','models','klase','kinds'], w:2.0 } ]}
    ]},
    ok:{ impact:'low', senses:[
      { id:'discourse.ok', concept:'discourse', value:'ok', prior:0.6, signals:[ { atStart:true, w:1.5 }, { nextWord:['next','sige','so','salamat','thanks','last'], w:1.5 } ]},
      { id:'judgement.ok', concept:'recommend', value:'ok', prior:0.2, signals:[ { near:['ba','ito','yan','this','for','para','sa'], w:1.0 }, { prevType:['ANCHOR','NAME'], w:1.5 } ]}
    ]},
    k:{ impact:'medium', senses:[
      { id:'thousand.price', concept:'thousand', value:'price', prior:0.4, signals:[ { near:['budget','price','under','below','above','pesos','php','₱','srp','dp','mura','cheaper','around','less'], w:2.0 } ]},
      { id:'thousand.mah', concept:'thousand', value:'mah', prior:0.3, signals:[ { near:['power bank','powerbank','mah','capacity','battery'], w:2.0 }, { subjectFamily:['power_bank'], w:1.5 } ]}
    ]},
    g:{ impact:'low', senses:[
      { id:'unit.gbps', concept:'unit', value:'Gbps', prior:0.4, signals:[ { prevNumber:true, w:2.0 } ]},
      { id:'generation', concept:'version', value:'gen', prior:0.1, signals:[ { nextNumber:true, w:2.0 } ]},
      { id:'band.ghz', concept:'feature', value:'band', prior:0.1, signals:[ { near:['wifi','wi-fi','band','2.4','5'], w:1.5 } ]}
    ]},
    'in':{ impact:'low', senses:[
      { id:'composite.in1', concept:'portCount', value:'in1', prior:0.0, signals:[ { prevNumber:true, w:1.5 }, { nextWord:['1','one'], w:2.5 } ]},
      { id:'unit.inch', concept:'unit', value:'inch', prior:0.0, signals:[ { prevNumber:true, w:1.0 }, { near:['laptop','monitor','tablet','sleeve','bag','screen','drive','hdd','ssd'], w:1.5 } ]},
      { id:'prep.in', concept:'function', value:'in', prior:0.6, signals:[] }
    ]},
    'for':{ impact:'medium', senses:[
      { id:'target.device', concept:'deviceTarget', value:'device', prior:0.1, signals:[ { nextType:['DEVICE','DEVICECLASS'], w:3.0 } ]},
      { id:'target.usecase', concept:'useCase', value:'purpose', prior:0.1, signals:[ { nextType:['USECASE'], w:3.0 } ]},
      { id:'prep.for', concept:'function', value:'for', prior:0.5, signals:[] }
    ]},
    'para sa':{ impact:'medium', senses:[
      { id:'target.device', concept:'deviceTarget', value:'device', prior:0.1, signals:[ { nextType:['DEVICE','DEVICECLASS'], w:3.0 } ]},
      { id:'target.usecase', concept:'useCase', value:'purpose', prior:0.1, signals:[ { nextType:['USECASE'], w:3.0 } ]},
      { id:'prep.para', concept:'function', value:'for', prior:0.5, signals:[] }
    ]},
    sa:{ impact:'low', senses:[
      { id:'target.device', concept:'deviceTarget', value:'device', prior:0.0, signals:[ { nextType:['DEVICE','DEVICECLASS'], w:2.5 } ]},
      { id:'prep.sa', concept:'function', value:'sa', prior:0.6, signals:[] }
    ]}
  };
  /* use cases (purpose words) — route/recommend context, not product constraints */
  var USE_CASES={
    gaming:{ label:'gaming', aliases:['gaming','games','game','gamer','pang gaming','pang-gaming'] },
    travel:{ label:'travel', aliases:['travel','travelling','traveling','biyahe','byahe','trip','bakasyon'] },
    office:{ label:'office / work', aliases:['office','work','wfh','work from home','opisina'] },
    streaming:{ label:'streaming / content', aliases:['streaming','stream','vlog','vlogging','content creation','youtube'] },
    presentation:{ label:'presentation', aliases:['presentation','meeting','meetings','classroom','school'] },
    backup:{ label:'backup / file storage', aliases:['backup','back up','file sharing','file storage','photo backup'] },
    gift:{ label:'gift', aliases:['gift','regalo','pang regalo','present','pasalubong'] },
    charging:{ label:'charging', aliases:['charging','charge','pang charge','pangcharge','mag charge','nagcha charge','nagcharge'] },
    dual_monitor:{ label:'dual monitor', aliases:['dual monitor','dual monitors','dual display','dual displays','dual screen','extended display'] }
  };
  /* superlative / comparative metric words -> metric id */
  var METRIC_WORDS={ price:['price','presyo','srp','dp','mura','mahal','cheap','expensive','cost'], mah:['capacity','mah','battery','kapasidad'], watts:['watts','watt','wattage','power','output'],
    length:['length','haba','mahaba','long','longer'], speed:['speed','bilis','mabilis','fast','faster','gbps'], ports:['ports','port','marami','maraming'], value:['mataas','taas'] };
  /* adjective polarity: "mahabang cable" = prefer longer; "murang charger" = prefer cheaper (a soft sort, never a filter) */
  var METRIC_POLARITY={ mahaba:['length','desc'], long:['length','desc'], longer:['length','desc'], mahabang:['length','desc'], maikli:['length','asc'], short:['length','asc'],
    mura:['price','asc'], cheap:['price','asc'], murang:['price','asc'], mahal:['price','desc'], expensive:['price','desc'], mabilis:['speed','desc'], fast:['speed','desc'], malaki:['size','desc'], big:['size','desc'] };
  var MEASURE_WORDS={ watts:'watts', watt:'watts', w:'watts', wattage:'watts', mah:'mah', capacity:'mah', ports:'ports', port:'ports', meters:'length', metro:'length', haba:'length', length:'length',
    colors:'colour', color:'colour', kulay:'colour', colours:'colour', bays:'bays', bay:'bays', gbps:'speed', speed:'speed' };

  /* =================================================================================================================
     v2-2B additions (SHADOW ONLY): structural vocabulary the parser needs to EMIT the frozen A5 turn-frame contract
     (see js/vero-discourse.js). Word classes only; no catalog codes, no product families, no benchmark phrasing.
     ================================================================================================================= */
  /* versioned interfaces: ONLY interfaces whose products carry a generation / version. A constraint's interfaces[] lists
     only these ids. connectors = the connector ids (above) that belong to the interface. */
  var INTERFACES={
    pcie:{ label:'PCIe', connectors:['pcie'] },
    usb:{ label:'USB', connectors:['usb','usb_a','usb_c','usb_b','micro_usb','usb4'] },
    thunderbolt:{ label:'Thunderbolt', connectors:['thunderbolt'] },
    hdmi:{ label:'HDMI', connectors:['hdmi','mini_hdmi','micro_hdmi'] },
    dp:{ label:'DisplayPort', connectors:['dp','mini_dp'] }
  };
  function interfaceOf(connId){ var k; for(k in INTERFACES){ if(INTERFACES[k].connectors.indexOf(connId)>=0) return k; } return null; }
  /* canonical generation of a version notation FOR ONE INTERFACE; null = impossible for that interface (-> UNRESOLVED).
     Idempotent: canonVersion(i, canonVersion(i, x)) === canonVersion(i, x).
       pcie         "Gen 4" = "4.0" = "4"  -> '4'   (gen 1..6)
       usb          '1.0' '1.1' '2.0' '3.0' '3.1' '3.2' as written; "3.1 Gen 1" -> '3.1g1', "3.2 Gen 2x2" -> '3.2g2x2';
                    bare "Gen 2" (no USB number) -> 'g2'; USB4 -> '4'. USB naming EQUIVALENCES are NOT merged here
                    (see USB_NAMING: modelled only; an inferred match is labelled later, in V2-2C).
       thunderbolt  '3' '4' '5' (no "Gen")      hdmi '1.3' '1.4' '2.0' '2.1'      dp '1.1' .. '2.1'
     A bare "Gen N" with no interface keeps the raw notation 'genN' until an interface is bound (BA1). */
  function canonVersion(iface,raw){
    var r=String(raw==null?'':raw).toLowerCase().replace(/\s+/g,'').replace(/^v(?=\d)/,''), m;
    if(!r) return null;
    switch(iface){
      case 'pcie': m=r.match(/^(?:gen)?([1-6])(?:\.0)?$/); return m?m[1]:null;
      case 'usb':
        if(/^(?:1\.0|1\.1|2\.0|3\.0|3\.1|3\.2)$/.test(r)) return r;
        m=r.match(/^(3\.1|3\.2)?g(?:en)?(1|2|2x2)$/); if(m) return (m[1]==='3.1' && m[2]==='2x2')?null:(m[1]||'')+'g'+m[2];
        if(/^4(?:\.0)?$/.test(r)) return '4';
        return null;
      case 'thunderbolt': m=r.match(/^([345])$/); return m?m[1]:null;
      case 'hdmi': m=r.match(/^(1\.3|1\.4|2\.0|2\.1|2\.2)[ab]?$/); return m?m[1]:(r==='2'?'2.0':null);
      case 'dp': m=r.match(/^(1\.1|1\.2|1\.3|1\.4|2\.0|2\.1)a?$/); return m?m[1]:(r==='2'?'2.0':null);
    }
    return null;
  }
  /* static USB naming-equivalence table (marketing renames of the same signalling rate). MODELLED ONLY in V2-2B: the parser
     never treats one name as another; V2-2C may use it to label an INFERRED match. USB4 and Thunderbolt are distinct. */
  var USB_NAMING=[ { rate:'5Gbps', names:['3.0','3.1g1','3.2g1'] }, { rate:'10Gbps', names:['3.1g2','3.2g2'] }, { rate:'20Gbps', names:['3.2g2x2'] } ];
  /* PCIe lane widths ("x4", "x16"): a separate slot, never a generation; parsed only in PCIe scope (or as an elliptical
     lane-only turn that the resolver binds to an active lanes slot). */
  var LANE_WIDTHS=[1,2,4,8,16];
  /* negation classes.
     clear        always negate the value they scope ("not white", "except white", "charger na hindi white")
     existential  wala / walang / no: negate a RELATIVISED value ("yung walang cable", "charger na walang cable"); followed by
                  ba / bang it is an existence question ("wala bang white?" = is there a white one?); bare it is ambiguous
     relax        "not needed": remove that slot (RELAX), never an exclusion ("no need DisplayLink")
     epistemic    the speaker is unsure; never an exclusion ("not sure kung 65W") */
  var NEGATION={
    clear:['not','hindi','di','without','except','maliban sa','other than','bukod sa','non','ayoko ng','ayaw ko ng','ayaw ng','ayaw','ayaw ko','ayoko','wag','huwag',
      'dont want','do not want','dont like','hindi naman','di naman','hindi po'],
    existential:['wala','walang','no','wala nang','wala ng'],
    relax:['no need','no need for','no need na','hindi kailangan','di kailangan','hindi na kailangan','di na kailangan','hindi na need','di na need','dont need','do not need','not needed','not required',
      'hindi ko kailangan','di ko kailangan','hindi ko po kailangan','hindi ko need','di ko need','di ko na need','hindi ko na kailangan'],
    epistemic:['not sure','not sure if','not sure kung','hindi ko alam','di ko alam','hindi ko alam kung','hindi sigurado','di sigurado','hindi ako sure','di ako sure','i dont know','dont know','not certain']
  };
  /* question particles after a negator ("wala BA", "hindi BA") */
  var QUESTION_PARTICLES=['ba','bang'];
  /* quantifiers: with a slot noun they RELAX that slot ("kahit ilang ports", "any number of ports"); alone they are ambiguous */
  var QUANTIFIERS=['kahit','kahit ano','kahit anong','kahit ilan','kahit ilang','kahit gaano','kahit na anong','any','any number of','any amount of','whatever','regardless of','basta'];
  /* post-noun relax cues ("ports don't matter") */
  var RELAX_AFTER=['dont matter','doesnt matter','does not matter','do not matter','not important','hindi importante','di importante','no preference'];
  /* field concept -> the slot a RELAX of that field removes ('ports' stays unqualified unless the same turn names a family) */
  var RELAX_FIELDS={ ports:'ports', length:'num:lengthM', colour:'colour', watts:'num:watts', mah:'num:mah', speed:'num:gbps', price:'price' };
  /* ordinal references (1-based position in what was shown). "last" has NO from-end contract yet: it is UNRESOLVED, high impact. */
  var ORDINALS={ first:1, '1st':1, una:1, unang:1, 'the first':1, 'first one':1, 'yung una':1, 'yung unang':1, ikauna:1,
    second:2, '2nd':2, pangalawa:2, ikalawa:2, 'the second':2, 'second one':2, 'yung pangalawa':2,
    third:3, '3rd':3, pangatlo:3, ikatlo:3, 'the third':3, 'third one':3, 'yung pangatlo':3,
    fourth:4, '4th':4, pangapat:4, 'pang apat':4, ikaapat:4, fifth:5, '5th':5, panglima:5, ikalima:5 };
  var LAST_WORDS=['last','huli','yung huli','the last','last one','the last one','yung last','pinakahuli'];
  /* structural reference kinds (the parser never looks at what was shown; the resolver does) */
  var REF_KIND={ other:['the other one','the other','other one','yung isa','ung isa'],
    results:['those','these','them','mga yan','mga ito'],
    focus:['ito','nito','iyan','yan','yun','iyon','this','that','it','this one','that one','yon','nyan','niyan','un'] };
  /* select cues over the shown results ("which one is Gen 4?", "alin dito") */
  var SELECT_CUES=['which one','which ones','alin dito','alin sa kanila','alin sa mga yan','alin sa mga ito','which of them'];
  /* comparatives: cue -> metric / direction; candidates = several metrics fit (the resolver clarifies); speed = gbps or watts */
  var COMPARATIVES={ cheaper:{ metric:'price', dir:'asc' }, 'mas mura':{ metric:'price', dir:'asc' }, 'mas murang':{ metric:'price', dir:'asc' },
    'mas mahal':{ metric:'price', dir:'desc' }, 'more expensive':{ metric:'price', dir:'desc' }, pricier:{ metric:'price', dir:'desc' },
    'mas mahaba':{ metric:'length', dir:'desc' }, longer:{ metric:'length', dir:'desc' }, 'mas maikli':{ metric:'length', dir:'asc' }, shorter:{ metric:'length', dir:'asc' },
    'mas mabilis':{ dir:'desc', speed:true }, faster:{ dir:'desc', speed:true }, quicker:{ dir:'desc', speed:true },
    'mas malakas':{ metric:'watts', dir:'desc' }, 'more powerful':{ metric:'watts', dir:'desc' },
    'mas malaki':{ dir:'desc', candidates:['mah','length','watts'] }, bigger:{ dir:'desc', candidates:['mah','length','watts'] }, larger:{ dir:'desc', candidates:['mah','length','watts'] },
    'mas maliit':{ dir:'asc', candidates:['mah','length','watts'] }, smaller:{ dir:'asc', candidates:['mah','length','watts'] },
    'mas mataas':{ dir:'desc', candidates:['price','watts','mah'] }, higher:{ dir:'desc', candidates:['price','watts','mah'] },
    'mas mababa':{ dir:'asc', candidates:['price','watts','mah'] }, lower:{ dir:'asc', candidates:['price','watts','mah'] } };
  /* "more / less + measure noun" ("more ports", "mas maraming ports", "fewer ports") */
  var COMPARE_MORE={ more:'desc', mas:'desc', less:'asc', fewer:'asc', 'mas kaunti':'asc', 'mas konti':'asc' };
  /* evaluative comparatives with no catalogue metric -> judgement (never a metric) */
  var JUDGEMENT_WORDS=['mas okay','mas ok','better','mas maganda','mas magandang','mas sulit','mas bagay','mas mabuti','which is better','alin mas ok'];
  var JUDGEMENT_AFTER=['ok','okay','maganda','sulit','bagay'];   /* after "alin mas" */
  var SPEED_CUES={ watts:['charging','charge','pang charge','magcharge','mag charge'], gbps:['transfer','data','gbps','internet'] };
  /* "same but <comparative>" -> sameBut + metric; "same but <value>" is an ordinary elliptical constraint */
  var SAME_BUT=['same but','same pero','pareho pero','parehas pero','ganun din pero','katulad pero','same lang pero'];
  /* V2-2C C1 (additive A5 amendment): "same <attribute>" keeps that slot of the anchor ("same wattage" -> keep num:watts);
     a SAME_BUT cue with no metric comparative is flags.same ("same but white"). The parser only marks them; the context
     layer (C2) resolves them against the focus / anchor. */
  var SAME_WORDS=['same','pareho','parehong','parehas','kapareho','kaparehong','katulad','kaparehas'];
  var KEEP_SLOTS={ watts:'num:watts', mah:'num:mah', length:'num:lengthM', colour:'colour', ports:'ports', speed:'num:gbps', price:'price' };
  /* NAME guard: words of these classes are never product-line NAME spans, whatever the catalogue contains */
  var NAME_GUARD_CLASSES={
    stock:INTENT_CUES.inventory, reference:REFERENCE.concat(REF_KIND.other,REF_KIND.results,REF_KIND.focus), discourse:DISCOURSE,
    function:FUNCTION_WORDS, quantifier:QUANTIFIERS.concat(RELAX_AFTER), negator:NEGATION.clear.concat(NEGATION.existential,NEGATION.relax,NEGATION.epistemic),
    ordinal:Object.keys(ORDINALS).concat(LAST_WORDS),
    /* interface names + single-token connector aliases of versioned interfaces ("mini" / "type" inside multi-word aliases are not guarded) */
    interface:Object.keys(INTERFACES).concat(['gen','pcie','pci','express'],[].concat.apply([],Object.keys(INTERFACES).map(function(k){ return INTERFACES[k].connectors.map(function(c){ return CONNECTORS[c]?CONNECTORS[c].aliases:[]; }).reduce(function(a,b){ return a.concat(b); },[]); })).filter(function(a){ return /^[a-z0-9]+$/.test(a); })),
    lane:LANE_WIDTHS.map(function(n){ return 'x'+n; }) };

  var API={ version:'v2-2C-C1', CONNECTORS:CONNECTORS, USB_VERSIONED:USB_VERSIONED, STANDARDS:STANDARDS, PORT_ROLES:PORT_ROLES, FEATURES:FEATURES,
    DEVICE_CLASSES:DEVICE_CLASSES, NAMED_DEVICES:NAMED_DEVICES, FIELDS:FIELDS, UNITS:UNITS, INTENT_CUES:INTENT_CUES, RANK_METRICS:RANK_METRICS,
    FUNCTION_WORDS:FUNCTION_WORDS, DISCOURSE:DISCOURSE, REFERENCE:REFERENCE, SENSES:SENSES, MARGIN_MIN:MARGIN_MIN, USE_CASES:USE_CASES,
    METRIC_WORDS:METRIC_WORDS, MEASURE_WORDS:MEASURE_WORDS, METRIC_POLARITY:METRIC_POLARITY,
    INTERFACES:INTERFACES, interfaceOf:interfaceOf, canonVersion:canonVersion, USB_NAMING:USB_NAMING, LANE_WIDTHS:LANE_WIDTHS,
    NEGATION:NEGATION, QUESTION_PARTICLES:QUESTION_PARTICLES, QUANTIFIERS:QUANTIFIERS, RELAX_AFTER:RELAX_AFTER, RELAX_FIELDS:RELAX_FIELDS,
    ORDINALS:ORDINALS, LAST_WORDS:LAST_WORDS, REF_KIND:REF_KIND, SELECT_CUES:SELECT_CUES, COMPARATIVES:COMPARATIVES, COMPARE_MORE:COMPARE_MORE,
    JUDGEMENT_WORDS:JUDGEMENT_WORDS, JUDGEMENT_AFTER:JUDGEMENT_AFTER, SPEED_CUES:SPEED_CUES, SAME_BUT:SAME_BUT, NAME_GUARD_CLASSES:NAME_GUARD_CLASSES,
    FEATURE_IMPLIES:FEATURE_IMPLIES, SAME_WORDS:SAME_WORDS, KEEP_SLOTS:KEEP_SLOTS };
  if(typeof module!=='undefined' && module.exports) module.exports=API;
  root.VeroOntology=API;
})(typeof window!=='undefined'?window:globalThis);
