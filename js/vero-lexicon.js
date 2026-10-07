/* VERO Local Brain — lexicon (Foundation Step 1, p2r3-f1).
   PURE DATA. JSON-shaped: strings, numbers, booleans, arrays and plain objects only — no functions, no RegExp objects.
   Holds the language VERO understands (taxonomy, aliases, sales-language groups, units, intent cues, clarification
   templates). It must NOT hold catalog data: no SKU / item-code / model lists, no product names, no prices, no product
   specs. Product facts come only from products.json via js/vero-facts.js.
   Safety-critical non-equivalences (MagSafe vs magnetic wireless, Qi vs Qi2, USB-C port vs USB-C cable,
   Thunderbolt vs USB4) are enforced in code (VeroFacts.assertLexiconSafe), not here.
   NOT loaded by index.html in this step (shadow / test use only). Browser: window.VeroLexicon; Node: module.exports. */
(function(root){
  'use strict';
  var LEX = {
    version: 'f2',   /* f2 (QueryPlan shadow step): attribute / metric words, history direction, use cases, devices, external-fact words, a few Taglish phrases */

    /* ---------------- taxonomy ----------------
       family / subtype assignment from STRUCTURED fields only (sheet_display, category); a rule matches when every
       field listed in it matches. More fields in a rule = more specific. Product NAME cues are a fallback for SKUs whose
       section/category is not covered yet, and a cross-check (conflict report). Description text never assigns a type.
       'expects' = attributes the facts index reports as unknown when no evidence exists. */
    taxonomy: {
      families: [
        { id:'charger', label:'charger', plural:'chargers',
          rules:[ { sheet_display:['Mobile: Charger'] }, { category:['Car Charger'] } ],
          subtypes:[
            { id:'wall', label:'wall/desk charger', rules:[ { category:['Wall Charger/Desk Charger'] } ] },
            { id:'wireless', label:'wireless charger', rules:[ { category:['Wireless Charger'] } ] },
            { id:'car', label:'car charger', rules:[ { category:['Car Charger'] } ] },
            { id:'power_strip', label:'power strip', rules:[ { category:['Power Strip'] } ] } ],
          nameCues:['charger','charging station','power strip','travel adapter'], expects:['watts','ports'] },
        { id:'power_bank', label:'power bank', plural:'power banks',
          rules:[ { category:['Power Bank'] }, { sheet_display:['Mobile: Power Bank'] } ],
          nameCues:['power bank','powerbank'], expects:['mah','watts'] },
        { id:'hub_dock', label:'hub or docking station', plural:'hubs and docking stations',
          rules:[ { sheet_display:['Transmission: Docking and Hub'] } ],
          subtypes:[
            { id:'dock', label:'docking station', rules:[ { category:['Docking Station'] } ] },
            { id:'hub', label:'hub', rules:[ { category:['Hub'] } ] } ],
          nameCues:['hub','dock','docking station','docking'], expects:['ports'] },
        { id:'charging_cable', label:'charging cable', plural:'charging cables',
          rules:[ { sheet_display:['Mobile: Charging Cable'] } ],
          subtypes:[
            { id:'usb_c', label:'USB-C charging cable', rules:[ { category:['USB-C Data Charging Cable'] } ] },
            { id:'lightning', label:'Lightning charging cable', rules:[ { category:['Lightning Data Charging Cable'] } ] },
            { id:'usb', label:'USB charging cable', rules:[ { category:['USB Charging Cable'] } ] } ],
          nameCues:['cable'], expects:['lengthM','connectors'] },
        { id:'video_cable', label:'video cable', plural:'video cables',
          rules:[ { sheet_display:['A&V: Video Cable'] }, { sheet_display:['A&V: Video Adapter and Extender'], category:['Video Cable'] } ],
          nameCues:['cable'], expects:['lengthM','connectors','video'] },
        { id:'video_adapter', label:'video adapter', plural:'video adapters',
          rules:[ { category:['Video Converter'] } ],
          nameCues:['adapter','converter','extender'], expects:['connectors','video'] },
        { id:'capture_card', label:'capture card', plural:'capture cards',
          rules:[ { category:['Audio And Video Capture Card'] } ], nameCues:['capture'], expects:['connectors'] },
        { id:'webcam', label:'webcam', plural:'webcams', rules:[ { category:['Webcam'] } ], nameCues:['webcam','web camera'], expects:[] },
        { id:'screen_projector', label:'wireless screen projector', plural:'wireless screen projectors',
          rules:[ { category:['Wireless Screen Projector'] } ], nameCues:['projector','screen mirroring'], expects:[] },
        { id:'av_switch', label:'splitter / switcher', plural:'splitters and switchers',
          rules:[ { sheet_display:['A&V: Splitter and Switcher'] } ], nameCues:['splitter','switcher','switch'], expects:['connectors','video'] },
        { id:'audio_cable', label:'audio cable', plural:'audio cables',
          rules:[ { category:['Audio Cable'] } ], nameCues:['audio','aux'], expects:['lengthM','connectors'] },
        { id:'sound_card', label:'sound card / audio adapter', plural:'sound cards and audio adapters',
          rules:[ { category:['Sound Card'] } ], nameCues:['sound card','audio adapter'], expects:['connectors'] },
        { id:'enclosure', label:'drive enclosure', plural:'drive enclosures',
          rules:[ { sheet_display:['Flash: Hard Drive Enclosure'], category:['Hard Drive Enclosure'] } ],
          nameCues:['enclosure'], expects:['connectors','dataGbps'] },
        { id:'usb_data', label:'USB cable / adapter', plural:'USB cables and adapters',
          rules:[ { category:['Data Cable'] } ], nameCues:['otg'], expects:['connectors'] },
        { id:'lan_cable', label:'LAN cable', plural:'LAN cables',
          rules:[ { category:['Cat Cable'] }, { category:['Network Cables'] } ], nameCues:['lan cable','ethernet cable','network cable','patch cord'], expects:['lengthM'] },
        { id:'network_tool', label:'network accessory / tool', plural:'network accessories and tools',
          rules:[ { category:['Network Accessories And Tools'] } ], nameCues:['crimp','tester','coupler','connector'], expects:[] },
        { id:'network_switch', label:'network switch', plural:'network switches',
          rules:[ { sheet_display:['Transmission: Lan Cable and Accessories'], category:['Switch'] } ], nameCues:['switch'], expects:['ethGbps'] },
        { id:'serial_card', label:'serial / expansion card', plural:'serial and expansion cards',
          rules:[ { category:['Serial Conversion/Expansion Card'] } ], nameCues:['rs232','rs-232','serial','pci'], expects:['connectors'] },
        { id:'network_adapter', label:'network adapter', plural:'network adapters',
          rules:[ { sheet_display:['Transmission: Ethernet Adapter'] } ],
          subtypes:[
            { id:'ethernet', label:'ethernet adapter', rules:[ { category:['Ethernet Adapter'] } ] },
            { id:'wifi', label:'Wi-Fi adapter', rules:[ { category:['Wireless Ethernet Adapter'] } ] } ],
          nameCues:['ethernet adapter','lan adapter','wifi adapter','wi-fi adapter','wireless adapter'], expects:['ethGbps'] },
        { id:'card_reader', label:'card reader', plural:'card readers',
          rules:[ { sheet_display:['Transmission: Card Reader'] } ], nameCues:['card reader'], expects:['connectors'] },
        { id:'mouse', label:'mouse', plural:'mice', rules:[ { category:['Mouse'] } ], nameCues:['mouse'], expects:[] },
        { id:'usb_switch', label:'USB sharing switch', plural:'USB sharing switches',
          rules:[ { category:['Share Switcher'] } ], nameCues:['sharing switch','kvm'], expects:['ports'] },
        { id:'earphone', label:'earphone / headset', plural:'earphones and headsets',
          rules:[ { category:['Bluetooth Earphone'] }, { category:['Wired Headset'] } ],
          subtypes:[
            { id:'wireless', label:'wireless earphone', rules:[ { category:['Bluetooth Earphone'] } ] },
            { id:'wired', label:'wired headset', rules:[ { category:['Wired Headset'] } ] } ],
          nameCues:['earbuds','earphones','earphone','headphones','headset'], expects:[] },
        { id:'bt_adapter', label:'Bluetooth receiver / transmitter', plural:'Bluetooth receivers and transmitters',
          rules:[ { category:['Bluetooth Receiver And Transmitter'] } ], nameCues:['bluetooth receiver','bluetooth transmitter','bluetooth adapter'], expects:[] },
        { id:'smart_finder', label:'smart finder', plural:'smart finders',
          rules:[ { category:['Smart Finder'] } ], nameCues:['finder','tracker'], expects:[] },
        { id:'stylus', label:'stylus pen', plural:'stylus pens', rules:[ { category:['Stylus Pen'] } ], nameCues:['stylus'], expects:[] },
        { id:'holder', label:'holder / stand', plural:'holders and stands',
          rules:[ { category:['Mobile Phone&Tablet Holder'] }, { category:['Mobile Phone and Tablet Holder'] }, { category:['Laptop Stand'] },
                  { category:['Car Mount'] }, { category:['Other Digital Product Stand'] } ],
          subtypes:[
            { id:'phone_tablet', label:'phone / tablet holder', rules:[ { category:['Mobile Phone&Tablet Holder'] }, { category:['Mobile Phone and Tablet Holder'] } ] },
            { id:'laptop_stand', label:'laptop stand', rules:[ { category:['Laptop Stand'] } ] },
            { id:'car_mount', label:'car mount', rules:[ { category:['Car Mount'] } ] },
            { id:'stand', label:'device stand', rules:[ { category:['Other Digital Product Stand'] } ] } ],
          nameCues:['holder','stand','mount'], expects:[] },
        { id:'phone_case', label:'phone case / film', plural:'phone cases and films',
          rules:[ { sheet_display:['Mobile: Phonecase and Film'] } ],
          subtypes:[ { id:'case', label:'phone case', rules:[ { category:['Cellphone Protective Case'] } ] } ],
          nameCues:['case','screen protector','tempered glass','film'], expects:[] },
        { id:'bag', label:'storage bag', plural:'storage bags',
          rules:[ { category:['Other Storage Bags'] }, { category:['Notebook Storage Bag'] } ],
          subtypes:[ { id:'laptop_bag', label:'laptop / notebook bag', rules:[ { category:['Notebook Storage Bag'] } ] } ],
          nameCues:['bag','pouch','sleeve','organizer'], expects:[] },
        { id:'microphone', label:'microphone', plural:'microphones', rules:[ { category:['Microphone'] } ], nameCues:['microphone','mic'], expects:[] },
        { id:'nas', label:'NAS', plural:'NAS units',
          rules:[ { sheet_display:['NAS Storage'] } ], lineField:'category',
          nameCues:['nasync','nas'], expects:['nasBays'] }
      ],
      /* sections/categories intentionally left unclassified (mixed content): reported as 'other' */
      unclassified:[ { sheet_display:['Others: Storage and Home life'], category:['Others','Home & Living Supplies'] } ]
    },

    /* how a user-language family / subtype term relates to the taxonomy.
       relation: same = exact synonym; broader = term covers more than the target; narrower = term is one part of the
       target; related = discovery hint only, NEVER confirmed equivalence; notEquivalent = must never be treated as same. */
    aliases: [
      { term:'hub or docking station', to:'hub_dock', relation:'same' },
      { term:'hub or dock', to:'hub_dock', relation:'same' },
      { term:'hub/dock', to:'hub_dock', relation:'same' },
      { term:'multiport adapter', to:'hub_dock', relation:'same' },
      { term:'hub', to:'hub_dock', relation:'same', note:'sales usage: a bare "hub" covers USB-C hubs, multiport converters and docks. "hub only" / "not a full dock" narrow it' },
      { term:'usb hub', to:'hub_dock.hub', relation:'narrower', familyFallback:true },
      { term:'hub only', to:'hub_dock.hub', relation:'narrower', strict:true },
      { term:'not a full dock', to:'hub_dock.hub', relation:'narrower', strict:true },
      { term:'simple hub', to:'hub_dock.hub', relation:'narrower', strict:true },
      { term:'docking station', to:'hub_dock.dock', relation:'narrower', strict:true },
      { term:'dock', to:'hub_dock.dock', relation:'narrower', familyFallback:true },
      { term:'docking', to:'hub_dock.dock', relation:'narrower', familyFallback:true },
      { term:'charger', to:'charger', relation:'same' },
      { term:'wall charger', to:'charger.wall', relation:'narrower' },
      { term:'desk charger', to:'charger.wall', relation:'narrower' },
      { term:'travel charger', to:'charger.wall', relation:'related', note:'travel use case; not a separate structured subtype' },
      { term:'wireless charger', to:'charger.wireless', relation:'narrower' },
      { term:'car charger', to:'charger.car', relation:'narrower' },
      { term:'power bank', to:'power_bank', relation:'same' },
      { term:'powerbank', to:'power_bank', relation:'same' },
      { term:'battery pack', to:'power_bank', relation:'same' },
      { term:'nas', to:'nas', relation:'same' },
      { term:'nasync', to:'nas', relation:'same' },
      { term:'network storage', to:'nas', relation:'same' },
      { term:'lan adapter', to:'network_adapter.ethernet', relation:'same' },
      { term:'ethernet adapter', to:'network_adapter.ethernet', relation:'same' },
      { term:'wifi adapter', to:'network_adapter.wifi', relation:'same' },
      { term:'lan cable', to:'lan_cable', relation:'same' },
      { term:'ethernet cable', to:'lan_cable', relation:'same' },
      { term:'network cable', to:'lan_cable', relation:'same' },
      { term:'card reader', to:'card_reader', relation:'same' },
      { term:'enclosure', to:'enclosure', relation:'same' },
      { term:'ssd enclosure', to:'enclosure', relation:'narrower' },
      { term:'earbuds', to:'earphone.wireless', relation:'same' },
      { term:'tws', to:'earphone.wireless', relation:'same' },
      { term:'earphones', to:'earphone', relation:'same' },
      { term:'headset', to:'earphone', relation:'same' },
      { term:'hdmi cable', to:'video_cable', relation:'narrower' },
      { term:'video cable', to:'video_cable', relation:'same' },
      { term:'capture card', to:'capture_card', relation:'same' },
      { term:'kvm', to:'usb_switch', relation:'related', note:'KVM can also mean a video switcher (av_switch)' },
      { term:'phone holder', to:'holder.phone_tablet', relation:'same' },
      { term:'laptop stand', to:'holder.laptop_stand', relation:'same' },
      { term:'car mount', to:'holder.car_mount', relation:'same' },

      /* connector / feature terms */
      { term:'type c', to:'connector.usb_c', relation:'same' },
      { term:'type-c', to:'connector.usb_c', relation:'same' },
      { term:'usb c', to:'connector.usb_c', relation:'same' },
      { term:'usbc', to:'connector.usb_c', relation:'same' },
      { term:'usb a', to:'connector.usb_a', relation:'same' },
      { term:'iphone cable', to:'connector.lightning', relation:'related', note:'newer iPhones use USB-C; never assume' },
      { term:'display port', to:'connector.dp', relation:'same' },
      { term:'aux', to:'connector.aux35', relation:'same' },
      { term:'3.5mm', to:'connector.aux35', relation:'same' },
      { term:'rj45', to:'connector.rj45', relation:'same' },
      { term:'gan', to:'flag.gan', relation:'same' },
      { term:'power delivery', to:'flag.pd', relation:'same' },
      { term:'mag safe', to:'flag.magsafe', relation:'same' },
      { term:'magnetic wireless', to:'flag.magsafe', relation:'related', note:'magnetic wireless is NOT MagSafe; show as magnetic-only, not confirmed' },
      { term:'magnetic', to:'flag.magsafe', relation:'related', note:'discovery hint only' },
      { term:'qi', to:'flag.qi2', relation:'notEquivalent', note:'Qi is not Qi2' },
      { term:'qi 2', to:'flag.qi2', relation:'same' },
      { term:'thunderbolt', to:'connector.usb4', relation:'related', note:'Thunderbolt is not automatically USB4' },
      { term:'usb 4', to:'connector.usb4', relation:'same' },
      { term:'built in cable', to:'flag.builtin', relation:'same' },
      { term:'build in cable', to:'flag.builtin', relation:'same' },
      { term:'integrated cable', to:'flag.builtin', relation:'same' }
    ],

    /* connector vocabulary as it appears in product names / feature lines (not a product list) */
    connectors: {
      usb_c:['usb-c','usb c','usbc','type-c','type c','typec'],
      usb_a:['usb-a','usb a','usba'],
      lightning:['lightning'],
      micro_usb:['micro usb','micro-usb','micro b'],
      hdmi:['hdmi'],
      mini_hdmi:['mini hdmi'],
      micro_hdmi:['micro hdmi'],
      dp:['displayport','display port','dp'],
      mini_dp:['mini dp','mini displayport'],
      vga:['vga'],
      dvi:['dvi'],
      rj45:['rj45','ethernet','lan','gigabit'],
      aux35:['3.5mm','3.5 mm','aux'],
      sd:['sd'],
      tf:['tf','micro sd','microsd'],
      thunderbolt:['thunderbolt','tbt'],
      usb4:['usb4','usb 4'],
      m2:['m.2','nvme']
    },
    /* port tokens used to read a port inventory from a name / "Output:" line */
    portKinds: {
      usb_c:['usb-c','usb c','type-c','type c','typec','usb 3.2 c','usb3.2 c','usb 3.1 c','usb 3.0 c','usb-c3.0','usb-c3.2'],
      usb_a:['usb-a','usb a','usb 3.0 a','usb3.0 a','usb 2.0 a','usb 3.2 a','usb3.2 a','usb-a3.2','usb-a3.0','usb-a2.0','usb2.0 a','usb3.0a','usb2.0a','usb3.2a'],
      usb:['usb 3.0','usb3.0','usb 2.0','usb2.0','usb 3.2','usb3.2','usb'],
      hdmi:['hdmi'], dp:['displayport','dp'], vga:['vga'],
      rj45:['rj45','gigabitrj45','gigabit','ethernet'],
      sd:['sd'], tf:['tf'], aux35:['3.5mm','aux3.5mm','aux'], pd:['pd'], m2:['m.2','nvme'], dc:['dc']
    },
    /* name wording that describes the product's form (used for type words such as "cable", "adapter") */
    forms: {
      cable:['cable','cables'],
      adapter:['adapter','adaptor','converter'],
      hub:['hub','dock','docking'],
      extender:['extender'],
      splitter:['splitter'],
      switch:['switch','switcher'],
      charger:['charger'],
      enclosure:['enclosure'],
      stand:['stand','holder','mount']
    },

    /* product feature flags: phrase patterns (regex source strings, evaluated on normalized text) */
    flags: {
      builtin:{ label:'with built-in cable', pattern:'\\bbuilt-in\\s+(?:\\d+\\s?w\\s+)?(?:usb-c\\s+|lightning\\s+|usb\\s+)?(cable|connector|usb-c|lightning|c\\b)|\\bintegrated cable' },
      retractable:{ label:'with retractable cable', pattern:'\\bretractable\\b' },
      qi2:{ label:'Qi2', pattern:'\\bqi2(?:\\.\\d)?\\b' },
      magsafe:{ label:'MagSafe', pattern:'\\bmagsafe\\b' },
      magnetic_wireless:{ label:'magnetic wireless', pattern:'\\bmagnetic\\b[^.;|]{0,30}\\bwireless\\b|\\bwireless\\b[^.;|]{0,30}\\bmagnetic\\b', nameOnly:true },
      gan:{ label:'GaN', pattern:'\\bgan' },
      pd:{ label:'PD', pattern:'\\bpd\\b|power delivery' }
    },

    /* units: user/product spelling -> canonical unit */
    units: {
      W:['w','watt','watts'],
      mAh:['mah','k mah','kmah'],
      m:['m','meter','meters','metre','metres','metro','metros'],
      cm:['cm'],
      mm:['mm'],
      Gbps:['gbps','gb/s','g'],
      Mbps:['mbps'],
      Hz:['hz'],
      thousand:['k']
    },
    /* colour words -> colour family (matched against the structured colour field first, then the product name) */
    colors: { gray:['gray','grey'], white:['white'], black:['black'], blue:['blue'], silver:['silver'], green:['green'], red:['red'],
              pink:['pink'], purple:['purple'], yellow:['yellow'], beige:['beige'], gold:['gold'] },
    resolutionWords: { '720p':1, '1080p':2, 'fhd':2, '2k':3, '1440p':3, 'qhd':3, '4k':4, 'uhd':4, '5k':5, '8k':6 },
    resolutionLabels: { '1':'720p', '2':'1080p', '3':'2K', '4':'4K', '5':'5K', '6':'8K' },
    numberWords: { one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10, isa:1, dalawa:2, tatlo:3, apat:4, lima:5 },

    /* ---------------- sales-language groups (English + Taglish). A phrase belongs to exactly one group. ---------------- */
    language: {
      existence:['do we have','do you have','is there','are there','meron ba','mayroon ba','may ganito ba','available ba','meron tayong','may tayo','meron','mayroon'],
      count:['how many','ilan','ilang','number of','count of','gaano karami'],
      rankMin:['cheapest','least expensive','pinakamura','pinaka mura','lowest price','lowest cost','pinakamababang presyo','mura'],
      rankMax:['most expensive','priciest','pinakamahal','pinaka mahal','highest price'],
      rankLongest:['longest','pinakamahaba','pinaka mahaba','mahaba'],
      rankShortest:['shortest','pinakamaikli','pinaka maikli'],
      rankPower:['highest wattage','most powerful','strongest','pinakamalakas','pinakamabilis','mabilis'],
      rankCapacity:['biggest capacity','largest capacity','highest capacity','pinakamalaki'],
      comparative:['mas mura','cheaper','mas mahal','more expensive','mas mataas','higher','mas mababa','lower','mas mahaba','longer','mas maikli','shorter','mas maraming','more','mas malaki','bigger'],
      alternative:['alternative','alternatives','replacement','kapalit','similar','same as','same wattage','same capacity','closest','katulad','kahalintulad','other option','iba pang option'],
      history:['price increase','price decrease','price change','price history','previous srp','previous price','old price','tinaas','tumaas','nagtaas','binaba','bumaba','nagbago','dating presyo','repriced','pagtaas','pagbaba'],
      compare:['compare','comparison','vs','versus','difference','pinagkaiba','ikumpara','alin mas'],
      rangeMin:['at least','minimum','or more','and above','and up','pataas','above','over','more than','longer than'],
      rangeMax:['under','below','less than','up to','or less','and below','pababa','hanggang','wala pang','within','not more than','shorter than'],
      rangeBetween:['between','to','hanggang'],
      priceCue:['₱','php','peso','pesos','budget','srp','dp','price','presyo','magkano','cost','worth'],
      reference:['ito','nito','iyan','yan','yun','yung','iyon','this','that','these','those','dito','diyan','it','them','previous one','same one'],
      stock:['in stock','on hand','may stock','meron pang stock','available stock','stocks','inventory','meron pa'],
      period:['this month','last month','this year','ngayong buwan','nakaraang buwan','ngayong taon','since'],
      judgement:['best','reco','recommend','recommendation','recomendation','suggest','suggestion','okay','ok','maganda','premium','sulit','worth it','ideal','suitable','bagay','mas okay','better','enough','sapat','bakit','why','explain','i-explain'],
      useCase:['pang','para sa','for','gamit sa','pang-'],
      compat:['compatible','compatibility','works with','work with','kaya ba','pwede ba sa','puwede ba sa','pwede ba ito sa','pwede sa','puwede sa','gagana ba','gagana sa','support','supports'],
      coach:['upsell','bundle','i-bundle','hero sku','i-push','push','objection','ano sasabihin','pwede sabihin','customer says','paano i-explain','pitch','cross-sell'],
      filler:['po','lang','naman','sana','pala','kasi','yung','ung','na','ng','ba','right now','currently','available','sa pricelist','in the pricelist']
    },
    /* ---------------- QueryPlan vocabulary (f2) — data only; meanings applied in js/vero-plan.js ---------------- */
    /* direction of a price-history question */
    historyDir: { up:['increase','increases','increased','hike','tinaas','tumaas','nagtaas','pagtaas','went up','go up'],
                  down:['decrease','decreases','decreased','drop','binaba','bumaba','pagbaba','went down','go down'] },
    /* words that ask for one field / attribute of a product */
    attributes: {
      sku:['sku','skus','item code'], srp:['srp','retail price'], dp:['dp','dealer price'], dp_volume:['dp vol','dp volume','dpv','volume price'],
      moq:['moq','mcq','minimum order','minimum qty'], price:['price','presyo','magkano','how much','cost'],
      description:['description','details','desc'], colors:['ibang color','other color','other colors','ibang kulay','colors','color','colour','kulay'],
      nasBays:['bays','bay'], nasCpu:['cpu','processor'], nasRam:['ram','memory']
    },
    /* comparison metric nouns (direction comes from the comparative word) */
    metrics: { srp:['mura','mahal','cheaper','price','presyo'], watts:['wattage','watts','watt'], ports:['ports','port'],
               mah:['capacity','mah'], nasBays:['bays','bay'], lengthM:['length','haba','mahaba','longer'] },
    /* use cases that narrow candidates to families (ordering hints only — never a claim in the answer) */
    useCases: {
      travel:{ terms:['travel','travelling','traveling','biyahe','byahe','trip','bakasyon'], families:['charger','power_bank'] },
      dual_monitor:{ terms:['dual monitor','dual monitors','dual display','dual displays','dual screen','extended display'], families:['hub_dock'], minVideoOut:2 },
      multi_device:{ terms:[], families:['charger','power_bank'], note:'applied in code when two or more device classes are named (laptop + phone ...)' }
    },
    /* display words used with a count ("for 2 monitors") */
    displayWords:['monitor','monitors','display','displays','screen','screens'],
    /* devices: generic classes vs named brands/lines (a named device needs external facts -> WEB) */
    devices: {
      classes:{ laptop:['laptop','laptops','notebook'], phone:['phone','phones','smartphone','cellphone','cp','selpon'], tablet:['tablet','tablets'] },
      brands:{ laptop:['macbook','chromebook','thinkpad','zenbook','matebook'], phone:['iphone','samsung','galaxy','pixel','xiaomi','redmi','oppo','vivo','realme','infinix','tecno','huawei','oneplus'],
               tablet:['ipad'], console:['ps5','playstation','xbox','nintendo switch','steam deck'], desktop:['imac','mac mini','mac studio','mac'] }
    },
    /* external facts the pricelist cannot hold (software / travel regulations) -> WEB */
    external:['plex','jellyfin','docker','eroplano','airplane','plane','flight','airline','airlines','hand carry'],

    /* phrases allowed to appear in more than one group (documented overlaps; tests enforce this list) */
    sharedPhrases: { 'hanggang':['rangeMax','rangeBetween'], 'yung':['reference','filler'] },

    /* ambiguous terms: the same spelling, two meanings */
    ambiguous: [
      { term:'dp', senses:['connector.dp','price.dp'], rule:'price sense when it is asked as a field (dp, dp vol, dealer price) or next to a price cue; connector sense next to hdmi/usb-c/cable/adapter words' },
      { term:'k', senses:['thousand.price','thousand.mah'], rule:'mAh only in a capacity context with no price cue (engine K_PRICE_BEFORE rule)' },
      { term:'g', senses:['Gbps','generation'], rule:'Gbps when attached to a number (10g); "gen" stays generation' },
      { term:'switch', senses:['family.av_switch','family.network_switch','family.usb_switch','device.nintendo_switch'], rule:'clarify when no qualifier' },
      { term:'available', senses:['in the pricelist','stock'], rule:'bare "available" = in the pricelist; "available stock" = stock (never claim stock)' }
    ],

    /* ---------------- clarification / caveat templates ({x} = filled at runtime) ---------------- */
    templates: {
      needType:'Which product type do you mean — {options}?',
      needReference:'Which product do you mean? Send the SKU or model and I’ll check it.',
      needDevice:'Which device or laptop model is it for?',
      hubOrDock:'Do you need a simple hub (extra USB ports) or a docking station (display + charging + LAN for a desk setup)?',
      needBudget:'What budget should I keep it under?',
      needUseCase:'What will the customer use it for?',
      notConfirmed:'{attr} is not explicitly confirmed for {count} item(s) in the pricelist.',
      stockCaveat:'I can only see the current pricelist, not live inventory, so I can’t confirm stock. Please check availability before quoting.',
      compatCaveat:'I can’t confirm compatibility with your device from the pricelist.'
    }
  };
  if(typeof module!=='undefined' && module.exports) module.exports=LEX;
  root.VeroLexicon=LEX;
})(typeof window!=='undefined'?window:globalThis);
