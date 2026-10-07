/* VERO p2r2.1 — P0 correctness regression tests (Phase 2 revision, local engine only).
   Run from the repo root:  node tests/vero-p2r21.test.js
   Uses the REAL data/products.json; expected winners are COMPUTED from the data (no SKU hardcoding in the
   assertions that matter), plus synthetic future SKUs to prove the rules are data-driven.
   P0-1 "cheapest 20k power bank" kept the capacity · P0-2 "longest USB-C cable" = a real USB-C cable ·
   P0-3 "magsafe power bank" never claims MagSafe from "magnetic" wording.
   Refinements: decimal-k price shorthand ("under 1.5k"), capacity-vs-price "k" ("power bank at least 20k" = ≥20,000mAh),
   evidence hierarchy (short_desc / description = mentioned, not confirmed). */
global.window = global;
require('../js/vero-nlu.js');
const E = require('../js/vero-engine.js');
const RAW = require('../data/products.json');
const ALL = RAW.filter(p => !p.disabled);
let pass = 0, fail = 0;
function chk(name, ok, info) { if (ok) { pass++; console.log('PASS - ' + name); } else { fail++; console.log('FAIL - ' + name + (info !== undefined ? '  -> ' + JSON.stringify(info).slice(0, 300) : '')); } }
const A = (q, P, ctx) => E.answer(P || ALL, q, ctx || {});
const byCode = c => ALL.find(p => String(p.item_code) === String(c));
const name = c => String((byCode(c) || {}).product_name || '');
const lenM = p => { const m = String(p.length || '').trim().match(/^([\d.]+)\s*(m|cm)$/i); return m ? (m[2].toLowerCase() === 'cm' ? +m[1] / 100 : +m[1]) : null; };
const isPB = p => p.category === 'Power Bank' || p.sheet_display === 'Mobile: Power Bank';
const mahOf = p => { const m = String(p.product_name).replace(/,/g, '').match(/(\d{4,6})\s*mah/i); return m ? +m[1] : null; };
const USBC = /\b(?:usb[\s-]?c|type[\s-]?c)\b/i;
let syn = 0; const mk = o => Object.assign({ sheet: 'Mobile-Power Bank', sheet_display: 'Mobile: Power Bank', category: 'Power Bank', model: 'ZZT' + (++syn), item_code: 'ZZ' + (900 + syn), color: 'Black', length: '', srp: 999, dp: 799, dp_volume: 749, moq: 10, description: '', features: '', short_desc: '' }, o);

console.log('E.version =', E.version);
chk('V0 engine version label is p2r2.1 or later (p2r3a)', E.version === 'p2r2.1' || E.version === 'p2r3a', E.version);

/* ===================== P0-1: "20k" capacity shorthand ===================== */
const pb20 = ALL.filter(p => isPB(p) && mahOf(p) === 20000);
const cheapest20 = pb20.slice().sort((a, b) => (+a.srp - +b.srp) || (String(a.item_code) < String(b.item_code) ? -1 : 1))[0];
console.log('data: cheapest 20,000mAh power bank =', cheapest20.item_code, cheapest20.srp, '| 20,000mAh count =', pb20.length);
for (const q of ['cheapest 20k power bank', 'pinakamurang 20k powerbank', 'cheapest 20k mah power bank', 'cheapest 20,000mAh power bank', 'cheapest 20000mah powerbank', 'lowest price 20k power bank']) {
  const r = A(q);
  chk(`P1a "${q}" -> cheapest 20,000mAh = ${cheapest20.item_code}`, r.type === 'list' && r.codes[0] === String(cheapest20.item_code) && r.codes.every(c => mahOf(byCode(c)) === 20000), { note: r.note, codes: r.codes });
}
for (const q of ['20k power bank', '20k mah power bank', '20,000mAh power bank', '20000mah powerbank', 'may 20k power bank?', 'meron ba tayong 20k powerbank?']) {
  const r = A(q); const P = r.parsed;
  chk(`P1b "${q}" parses 20,000mAh and every result is a 20,000mAh power bank`, P.mah && P.mah.v === 20000 && r.codes.length > 0 && r.codes.every(c => mahOf(byCode(c)) === 20000), { mah: P.mah, n: r.codes.length });
}
{ const r = A('cheapest 10k power bank'); chk('P1c "cheapest 10k power bank" -> a 10,000mAh power bank', r.parsed.mah && r.parsed.mah.v === 10000 && mahOf(byCode(r.codes[0])) === 10000, r.codes); }
{ const r = A('how many 20k power banks?'); chk('P1d count "how many 20k power banks?" = data count', new RegExp('^' + pb20.length + ' ').test(r.note), r.note); }
/* price shorthand must NOT change */
for (const [q, max] of [['charger under 2k', 2000], ['charger below 2k', 2000], ['charger budget 2k', 2000], ['charger less than 2k', 2000], ['power bank under 2k', 2000], ['power bank below 3k', 3000], ['hub under 2k', 2000], ['power bank under 20k', 20000]]) {
  const P = A(q).parsed;
  chk(`P1e price shorthand kept: "${q}" -> priceMax ₱${max}, no mAh`, P.priceMax === max && !P.mah, { priceMax: P.priceMax, mah: P.mah });
}
{ const P = A('power bank above 3k').parsed; chk('P1f "power bank above 3k" -> priceMin ₱3,000 (comparator = price)', P.priceMin === 3000 && !P.mah, { min: P.priceMin, mah: P.mah }); }
{ const P = A('2k pesos charger').parsed; chk('P1g "2k pesos charger" -> no mAh (peso context)', !P.mah, P.mah); }
{ const r = A('20k power bank under 2k'); const P = r.parsed;
  chk('P1h "20k power bank under 2k" -> 20,000mAh AND under ₱2,000', P.mah && P.mah.v === 20000 && P.priceMax === 2000 && r.codes.length > 0 && r.codes.every(c => mahOf(byCode(c)) === 20000 && +byCode(c).srp <= 2000), { mah: P.mah, max: P.priceMax, codes: r.codes }); }
{ const P = A('20k charger').parsed; chk('P1i "20k charger" (no capacity context) -> not mAh', !P.mah, P.mah); }
{ const P = A('cheapest 4k hdmi cable').parsed; chk('P1j "4k hdmi" untouched (resolution, not capacity/price)', !P.mah && P.priceMax == null, { mah: P.mah }); }
/* synthetic future SKU: a cheaper new 20,000mAh power bank wins automatically */
{ const nw = mk({ item_code: 'ZZ20K', product_name: '20000mAh 22.5W Power Bank (Test)', srp: 999 });
  const r = E.answer(ALL.concat([nw]), 'cheapest 20k power bank', {});
  chk('P1k synthetic new 20,000mAh SKU at ₱999 becomes the winner (data-driven)', r.codes[0] === 'ZZ20K', r.codes); }

/* ===================== P0-2: USB-C cable ranking ===================== */
const usbcCables = ALL.filter(p => /\bcables?\b/i.test(p.product_name) && !/extender|wireless/i.test(p.product_name) && USBC.test(p.product_name) && lenM(p) != null && !(p.sheet_display || '').match(/Car Charger/));
const longestC = Math.max(...usbcCables.map(lenM));
console.log('data: longest USB-C cable length =', longestC, usbcCables.filter(p => lenM(p) === longestC).map(p => p.item_code));
for (const q of ['longest USB-C cable', 'longest type c cable', 'longest usb c cable', 'longest Type-C cable', 'pinakamahabang usb-c cable']) {
  const r = A(q); const top = byCode(r.codes[0]);
  chk(`P2a "${q}" -> a real USB-C cable at the data maximum (${longestC}m)`, r.type === 'list' && top && USBC.test(top.product_name) && /cable/i.test(top.product_name) && lenM(top) === longestC && r.codes.every(c => USBC.test(name(c))), { note: r.note, codes: r.codes });
}
{ const r = A('shortest USB-C cable'); chk('P2b "shortest USB-C cable" -> every ranked item names USB-C', r.codes.length && r.codes.every(c => USBC.test(name(c)) && /cable/i.test(name(c))), r.codes.map(name)); }
{ const r = A('cheapest usb-c cable'); chk('P2c "cheapest usb-c cable" -> no Micro-USB / OTG adapter winners', r.codes.length && r.codes.every(c => USBC.test(name(c))), r.codes.map(name)); }
{ const r = A('longest lightning cable'); chk('P2d "longest lightning cable" -> every ranked item names Lightning', r.codes.length && r.codes.every(c => /lightning/i.test(name(c))), r.codes.map(name)); }
{ const r = A('cheapest usb-c to lightning cable'); chk('P2e "cheapest usb-c to lightning cable" -> names both connectors', r.codes.length && r.codes.every(c => /lightning/i.test(name(c)) && USBC.test(name(c))), r.codes.map(name)); }
{ const ext = ALL.filter(p => /extension/i.test(p.product_name) && /cable/i.test(p.product_name) && lenM(p) != null); const mx = Math.max(...ext.map(lenM));
  for (const q of ['longest USB-A extension cable', 'longest usb extension cable']) { const r = A(q); const top = byCode(r.codes[0]);
    chk(`P2f "${q}" still works -> extension cable at ${mx}m`, top && /extension/i.test(top.product_name) && lenM(top) === mx, r.codes); } }
{ const r = A('USB-A extension cable'); chk('P2g "USB-A extension cable" (no ranking) still returns extension cables', (r.codes || []).some(c => /extension/i.test(name(c))), { type: r.type, n: (r.codes || []).length }); }
{ const r = A('240W USB-C cable'); chk('P2h "240W USB-C cable" -> non-empty, every item names USB-C', r.codes.length > 0 && r.codes.every(c => USBC.test(name(c))), r.codes.length); }
{ const r = A('USB-C cable 2m'); chk('P2i "USB-C cable 2m" -> non-empty list (unchanged path)', r.codes.length > 0, r.type); }
{ const r = A('longest HDMI cable'); const hd = ALL.filter(p => /hdmi/i.test(p.product_name) && /cable/i.test(p.product_name) && !/extender|wireless/i.test(p.product_name) && lenM(p) != null); const mx = Math.max(...hd.map(lenM));
  chk(`P2j "longest HDMI cable" unchanged -> ${mx}m`, lenM(byCode(r.codes[0])) === mx, r.codes); }
{ const r = A('longest cable'); chk('P2k "longest cable" (no connector) unchanged -> any cable allowed', r.codes.length > 0 && /cable/i.test(name(r.codes[0])), r.codes); }
{ const nw = mk({ item_code: 'ZZC6M', sheet: 'Mobile-Charging Cable', sheet_display: 'Mobile: Charging Cable', category: 'USB-C Data Charging Cable', product_name: 'USB-C to USB-C 240W Braided Cable (Test)', length: '6M', srp: 899 });
  const ext = mk({ item_code: 'ZZA30', sheet: 'Transmission-USB Cable and Adapter', sheet_display: 'Transmission: USB Cable and Adapter', category: 'USB Extension', product_name: 'USB 2.0 Active Extension Cable (Test)', length: '30M', srp: 1999 });
  const r = E.answer(ALL.concat([nw, ext]), 'longest usb-c cable', {});
  chk('P2l synthetic: new 6M USB-C cable wins; a 30M USB-A extension never qualifies', r.codes[0] === 'ZZC6M' && r.codes.indexOf('ZZA30') < 0, r.codes); }

/* ===================== P0-3: MagSafe vs magnetic ===================== */
const magPB = ALL.filter(p => isPB(p) && /\bmagnetic\b/i.test(p.product_name) && /\bwireless\b/i.test(p.product_name));
const explicitPB = ALL.filter(p => isPB(p) && /mag\s?safe/i.test(p.product_name + '\n' + p.features + '\n' + p.short_desc));
console.log('data: magnetic-wireless power banks =', magPB.length, '| power banks with MagSafe in name/features/short_desc =', explicitPB.length);
for (const q of ['magsafe power bank', 'meron ba tayong magsafe power bank?', 'may mag safe powerbank?', 'do we have a MagSafe power bank?', 'how many magsafe power banks?']) {
  const r = A(q);
  chk(`P3a "${q}" -> never "Yes … MagSafe"; magnetic list with not-confirmed wording`,
    !/^yes\b/i.test(r.note) && /not explicitly confirmed/i.test(r.note) && /magnetic wireless/i.test(r.note) &&
    r.codes.length === magPB.length + explicitPB.length && magPB.every(p => r.codes.indexOf(String(p.item_code)) >= 0), { note: r.note, n: r.codes.length });
}
{ const r = A('magsafe power bank'); const det = r.detail || {};
  chk('P3b every magnetic-only card carries "MagSafe not explicitly confirmed"', magPB.every(p => /MagSafe not explicitly confirmed/.test(det[String(p.item_code)] || '')), det);
  chk('P3c description-only MagSafe mentions are named as description-only', /mentioned only in product descriptions/i.test(r.note), r.note);
  chk('P3d MagSafe question stays LOCAL (no Worker call for catalog existence)', E.aiRoute(ALL, 'magsafe power bank', r, {}).route === 'local' && E.aiRoute(ALL, 'magsafe power bank', r, { manual: true }).route === 'local'); }
{ const r = A('magsafe charger');
  const first = r.codes[0];
  chk('P3e "magsafe charger" -> explicit MagSafe (name/features) items first, magnetic-only listed separately', /mag\s?safe/i.test(name(first) + byCode(first).features + byCode(first).short_desc) && /MagSafe stated in the product name or features/.test(r.note) && /magnetic wireless/i.test(r.note), { note: r.note, codes: r.codes }); }
{ const r = A('magnetic power bank'); chk('P3f "magnetic power bank" unchanged — no MagSafe claim', !/magsafe/i.test(r.note || '') && r.codes.length >= magPB.length, { note: r.note, n: r.codes.length }); }
{ const r = A('qi2 power bank'); const sdOnly = ALL.filter(p => isPB(p) && /\bqi\s?2\b/i.test(p.short_desc || '') && !/\bqi\s?2\b/i.test(p.product_name + '\n' + (p.features || '')));
  chk('P3g "qi2 power bank" -> no confirmed Qi2 power bank (Qi2 only in short_desc/description); listed as not confirmed', /^No\b/.test(r.note) && /mentioned only in product descriptions/.test(r.note) && sdOnly.every(p => r.note.indexOf(String(p.item_code)) >= 0), { note: r.note, sdOnly: sdOnly.map(p => p.item_code) }); }
{ const nw = mk({ item_code: 'ZZMS1', product_name: '10000mAh MagSafe Magnetic Wireless Power Bank (Test)', srp: 1999 });
  const r = E.answer(ALL.concat([nw]), 'magsafe power bank', {});
  chk('P3h synthetic: a power bank NAMED MagSafe is the confirmed item; magnetic-only ones are "Also …"', r.codes[0] === 'ZZMS1' && /^1 MagSafe power bank in the current pricelist \(MagSafe stated/.test(r.note) && /Also \d+ magnetic wireless power banks/.test(r.note), r.note); }
{ const r = A('magsafe car charger'); chk('P3i "magsafe car charger" -> plain "No" (no magnetic car charger to offer), no Yes', /^No\b/.test(r.note), r.note); }

/* ===================== p2r2.1 refinement 1: decimal "k" price shorthand ===================== */
for (const [q, max] of [['hub under 1.5k', 1500], ['hub below 2.5k', 2500], ['budget 1.5k hub', 1500], ['less than 1.5k hub', 1500], ['charger under 2.5k', 2500]]) {
  const r = A(q); const P = r.parsed; const N = P.nlu;
  chk(`D1 "${q}" -> priceMax ₱${max}; no 5K/2K resolution attribute; results within budget`, P.priceMax === max && !(N && N.attrs.some(a => a.k === 'res' || a.k === 'refresh')) && r.codes.length > 0 && r.codes.every(c => +byCode(c).srp <= max), { max: P.priceMax, attrs: N && N.attrs, n: r.codes.length });
}
for (const q of ['hub ₱1.5k', 'hub 1.5k pesos']) {
  const r = A(q); const P = r.parsed; const N = P.nlu;
  chk(`D2 "${q}" -> read as a ₱1,500 peso amount (not 5K, not mAh)`, /(₱\s*1500|1500\s*₱)/.test(P.norm) && !P.mah && !(N && N.attrs.some(a => a.k === 'res')), { norm: P.norm, attrs: N && N.attrs });
}
for (const [q, lab] of [['5k monitor cable', '5K'], ['may 8K HDMI tayo?', '8K'], ['4k@60hz hdmi adapter', '4K@60Hz'], ['8k hdmi under 2.5k', '8K']]) {
  const r = A(q); const N = r.parsed.nlu;
  chk(`D3 "${q}" keeps resolution ${lab}`, N && N.attrs.some(a => (a.k === 'res' || a.k === 'refresh') && a.label === lab), N && N.attrs);
}
{ const P = A('8k hdmi under 2.5k').parsed; chk('D4 "8k hdmi under 2.5k" -> 8K resolution AND ₱2,500 budget (no stray 5K)', P.priceMax === 2500 && P.nlu.attrs.filter(a => a.k === 'res').length === 1, { max: P.priceMax, attrs: P.nlu.attrs }); }

/* ===================== p2r2.1 refinement 2: capacity-vs-price "k" ===================== */
const pbGE20 = ALL.filter(p => isPB(p) && (mahOf(p) || 0) >= 20000);
for (const q of ['power bank at least 20k', 'powerbank 20k pataas', 'minimum 20k power bank', '20k or higher power bank', 'at least 20k mah power bank', 'power bank minimum 20k', 'power bank 20k and up']) {
  const r = A(q); const P = r.parsed;
  chk(`K1 "${q}" -> capacity ≥20,000mAh (not a price), ${pbGE20.length} results`, P.mah && P.mah.v === 20000 && P.mah.op === 'min' && P.priceMin == null && P.priceMax == null && r.codes.length === pbGE20.length && r.codes.every(c => mahOf(byCode(c)) >= 20000), { mah: P.mah, min: P.priceMin, n: r.codes.length });
}
{ const P = A('power bank at least ₱20k').parsed; chk('K2 "power bank at least ₱20k" -> price ≥ ₱20,000 (₱ is the cue), no mAh', P.priceMin === 20000 && !P.mah, { min: P.priceMin, mah: P.mah }); }
{ const P = A('budget 20k power bank').parsed; chk('K3 "budget 20k power bank" -> budget ₱20,000, no mAh', P.priceMax === 20000 && !P.mah, { max: P.priceMax, mah: P.mah }); }
{ const P = A('power bank more than 20k pesos').parsed; chk('K4 "power bank more than 20k pesos" -> price ≥ ₱20,000 (pesos cue), no mAh', P.priceMin === 20000 && !P.mah, { min: P.priceMin, mah: P.mah }); }
{ const P = A('power bank cheaper than 3k').parsed; chk('K5 "power bank cheaper than 3k" -> not mAh', !P.mah, P.mah); }
{ const r = A('20k power bank under 2k'); const P = r.parsed; chk('K6 "20k power bank under 2k" -> 20,000mAh AND under ₱2,000', P.mah && P.mah.v === 20000 && P.mah.op === 'eq' && P.priceMax === 2000 && r.codes.every(c => mahOf(byCode(c)) === 20000 && +byCode(c).srp <= 2000) && r.codes.length > 0, { mah: P.mah, max: P.priceMax }); }
{ const r = A('cheapest power bank at least 20k'); chk('K7 "cheapest power bank at least 20k" -> cheapest ≥20,000mAh = ' + cheapest20.item_code, r.codes[0] === String(cheapest20.item_code) && r.codes.every(c => mahOf(byCode(c)) >= 20000), r.codes); }

/* ===================== p2r2.1 refinement 3: evidence hierarchy (short_desc = WEAK) ===================== */
const NL = global.window.VeroNLU;
const QI2 = /\bqi\s?2\b/i;
const qi2Feat = ALL.filter(p => QI2.test(p.features || '') || QI2.test(p.product_name));
const qi2SdOnly = ALL.filter(p => QI2.test(p.short_desc || '') && !QI2.test(p.features || '') && !QI2.test(p.product_name));
{ const r = A('qi2'); const codes = new Set(r.codes);
  chk(`E1 short_desc-only Qi2 is NOT confirmed (${qi2SdOnly.length} products)`, qi2SdOnly.length > 0 && qi2SdOnly.every(p => !codes.has(String(p.item_code))), qi2SdOnly.map(p => p.item_code));
  chk(`E2 feature-line Qi2 stays confirmed (${qi2Feat.length} products)`, qi2Feat.length > 0 && qi2Feat.every(p => codes.has(String(p.item_code))), { feat: qi2Feat.map(p => p.item_code), got: r.codes }); }
{ const r = A('may Qi2 charger?'); const exp = qi2Feat.filter(p => p.category === 'Wireless Charger' || /charger/i.test(p.product_name));
  chk(`E3 "may Qi2 charger?" counts only feature/name evidence (${exp.length})`, new RegExp('^Yes — ' + exp.length + ' ').test(r.note) && /mentioned only in product descriptions/.test(r.note), r.note); }
{ const ms = ALL.filter(p => /mag\s?safe/i.test(p.description || '') && !/mag\s?safe/i.test((p.features || '') + '\n' + p.product_name));
  const r = A('magsafe'); const conf = r.codes.slice(0, (r.note.match(/^(?:Yes — )?(\d+)/) || [])[1] | 0);
  chk('E4 description/short_desc-only MagSafe is NOT confirmed', ms.every(p => conf.indexOf(String(p.item_code)) < 0), { conf, descOnly: ms.map(p => p.item_code) }); }
{ const nameP = ALL.find(p => /mag\s?safe/i.test(p.product_name));
  const r = A('magsafe charger'); chk('E5 name-based MagSafe evidence stays confirmed (' + (nameP && nameP.item_code) + ')', nameP && r.codes[0] === String(nameP.item_code), r.codes); }
{ const r = A('HDMI 2.1 3m'); chk('E6 name-based technical evidence (HDMI 2.1 in name) still confirmed', r.codes.length > 0 && r.codes.every(c => /hdmi 2\.1/i.test(name(c))), r.codes); }
{ /* synthetic: same claim in features vs only in short_desc */
  const f = mk({ item_code: 'ZZQF', sheet: 'Mobile-Charger', sheet_display: 'Mobile: Charger', category: 'Wireless Charger', product_name: 'Wireless Charger Pad (Test F)', features: '*Qi2 certified 15W magnetic charging' });
  const d = mk({ item_code: 'ZZQS', sheet: 'Mobile-Charger', sheet_display: 'Mobile: Charger', category: 'Wireless Charger', product_name: 'Wireless Charger Pad (Test S)', short_desc: 'Qi2 15W magnetic wireless charger.' });
  const r = E.answer(ALL.concat([f, d]), 'may Qi2 charger?', {});
  const qa = [{ k: 'flag', v: 'qi2' }], mf = NL.matchAll(f, qa), ms = NL.matchAll(d, qa);
  chk('E7 synthetic: Qi2 in features = confirmed (medium); Qi2 only in short_desc = weak, not listed', r.codes.indexOf('ZZQF') >= 0 && r.codes.indexOf('ZZQS') < 0 && mf && mf.t === 'medium' && ms && ms.t === 'weak', { codes: r.codes, mf, ms }); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
