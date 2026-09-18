/* Automated tests for the simplified Price Change indicator model.
   Run: node tests/price-change.test.js   (from ugreen-pricelist-cms/)
   Loads the real js/helpers.js and exercises pcStamp / pcBadge / expiry, with
   emphasis on the MULTIPLE-CHANGE rule (previous price = the price immediately
   before the latest change, never the original). */
global.window = { PRICE_SETTINGS: { indicatorDays: 30 } };
eval(require('fs').readFileSync(require('path').join(__dirname,'..','js','helpers.js'),'utf8'));
let ok = true; const chk = (n,c)=>{ console.log((c?'PASS':'FAIL')+' - '+n); if(!c) ok=false; };
const today = pcToday();
const daysAgo = n => { const d=new Date(); d.setDate(d.getDate()-n); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };

// single change
let p={item_code:'A',srp:999,dp:749};
p.srp=1099; pcStamp(p,999,749,daysAgo(3));
chk('single SRP up: prev=999 dir=up', p.previousSRP===999 && p.priceChangeSRP==='up');
chk('DP unchanged -> no DP meta', p.previousDP===undefined);

// MULTIPLE changes: 999->1099 (up) then 1099->1049 (down)
let o=p.srp; p.srp=1049; pcStamp(p,o,p.dp,today);
chk('multi: previousSRP=1099 (NOT 999)', p.previousSRP===1099);
chk('multi: dir=down srp=1049 date=new', p.priceChangeSRP==='down' && p.srp===1049 && p.srpChangeDate===today);
/* New layout (2026-09-18): badge = "↓ Decrease" + "Before: ₱1,099.00". The
   current price (1,049) is rendered by the card, NOT the badge. Old price must be
   the immediate prior (1,099), never the original (999). */
chk('multi: badge shows ↓ Decrease + Before ₱1,099 (not 999, no current price)', (function(){var b=pcBadge(p,'SRP');return b.includes('Decrease') && b.includes('Before') && b.includes('1,099') && !b.includes('999') && !b.includes('1,049');})());

// DP tracked independently
o=p.dp; p.dp=700; pcStamp(p,p.srp,o,today);
chk('DP independent: DP down, SRP meta intact', p.priceChangeDP==='down' && p.previousDP===749 && p.previousSRP===1099);

// volume-only -> no SRP/DP meta
let v={item_code:'V',srp:500,dp:400,dp_volume:300}; v.dp_volume=280; pcStamp(v,500,400,today);
chk('volume-only -> no SRP/DP meta', v.priceChangeSRP===undefined && v.priceChangeDP===undefined);

// unchanged -> date not reset
let u={item_code:'U',srp:1099,dp:749,previousSRP:999,priceChangeSRP:'up',srpChangeDate:daysAgo(5)};
const d0=u.srpChangeDate; pcStamp(u,1099,749,today);
chk('unchanged -> date NOT reset', u.srpChangeDate===d0);

// non-price edit preserves meta (saveSku merge: fresh form obj has no meta keys)
let ex={item_code:'E',srp:1099,dp:749,previousSRP:999,priceChangeSRP:'up',srpChangeDate:daysAgo(2),product_name:'old'};
let form={item_code:'E',srp:1099,dp:749,product_name:'new'}; pcStamp(form,ex.srp,ex.dp,today); Object.assign(ex,form);
chk('non-price edit preserves meta', ex.previousSRP===999 && ex.priceChangeSRP==='up' && ex.srpChangeDate===daysAgo(2) && ex.product_name==='new');

// new SKU -> no indicator
let n={item_code:'N',srp:300,dp:250}; pcStamp(n,null,null,today);
chk('new SKU -> no indicator', n.priceChangeSRP===undefined);

// expiry: 40 days old -> no badge, price kept
let e={item_code:'X',srp:1099,previousSRP:999,priceChangeSRP:'up',srpChangeDate:daysAgo(40)};
chk('expired -> no badge, price kept', pcBadge(e,'SRP')==='' && e.srp===1099);

console.log(ok ? '\nALL PASS' : '\nFAILURES'); process.exit(ok?0:1);
