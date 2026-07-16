/* UGREEN Pricelist CMS — Admin "Special Dealers" tab.
   Classic global scope (matches admin.js) so onclick handlers resolve.
   Data lives in the Cloudflare Worker's DEALERS KV (never in the public repo).
   A dealer = { id, name, username, password, discountPct (percent off SRP), active, skus:[item_code] }.
   The main pricelist stays the single source of truth: the dealer view inherits
   every field from products.json and only overrides DP = round(SRP*(1-pct/100)). */

var _DLR = { loaded: false, pw: '', dealers: [], editing: null, q: '', cat: '__all' };

function _dlrEsc(s){ return (typeof _admEsc==='function') ? _admEsc(s) : String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
function _dlrEndpoint(){ var BE=(window.CONFIG&&window.CONFIG.backend)||{}; return BE.workerEndpoint||''; }
function _dlrToast(m){ if(typeof showToast==='function') showToast(m); }

function _dlrInjectCss(){
  if(document.getElementById('dlr-admin-css')) return;
  var st=document.createElement('style'); st.id='dlr-admin-css';
  st.textContent=[
   '.dlr-wrap{max-width:960px}',
   '.dlr-actions{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px}',
   '.dlr-btn{border:1px solid var(--border,#2a2f3a);background:var(--surface,#151922);color:var(--text,#e7ebf3);padding:9px 14px;border-radius:9px;font-size:.82rem;font-weight:600;cursor:pointer}',
   '.dlr-btn.primary{background:#007934;border-color:#007934;color:#fff}',
   '.dlr-btn.danger{color:#ff6b6b;border-color:#5a2a2a}',
   '.dlr-btn:disabled{opacity:.5;cursor:not-allowed}',
   '.dlr-list{display:flex;flex-direction:column;gap:10px}',
   '.dlr-card{border:1px solid var(--border,#2a2f3a);border-radius:11px;padding:13px 15px;background:var(--surface,#151922);display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}',
   '.dlr-card h4{margin:0 0 3px;font-size:.95rem;color:var(--text,#e7ebf3)}',
   '.dlr-meta{font-size:.74rem;color:var(--text-muted,#8b93a5);display:flex;gap:12px;flex-wrap:wrap}',
   '.dlr-pill{background:rgba(0,121,52,.14);color:#2ecc71;border-radius:20px;padding:2px 9px;font-weight:700;font-size:.7rem}',
   '.dlr-off{color:#ff6b6b}',
   '.dlr-form{border:1px solid var(--border,#2a2f3a);border-radius:12px;padding:16px;background:var(--surface,#151922)}',
   '.dlr-frow{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:14px}',
   '.dlr-field{flex:1;min-width:180px;display:flex;flex-direction:column;gap:5px}',
   '.dlr-field label{font-size:.72rem;color:var(--text-muted,#8b93a5);font-weight:600;text-transform:uppercase;letter-spacing:.4px}',
   '.dlr-field input{background:var(--bg,#0e1117);border:1px solid var(--border,#2a2f3a);border-radius:8px;padding:9px 11px;color:var(--text,#e7ebf3);font-size:.86rem}',
   '.dlr-code-row{display:flex;gap:8px}',
   '.dlr-code-row input{flex:1}',
   '.dlr-picker{border:1px solid var(--border,#2a2f3a);border-radius:10px;overflow:hidden}',
   '.dlr-picker-bar{display:flex;gap:8px;flex-wrap:wrap;padding:10px;border-bottom:1px solid var(--border,#2a2f3a);background:var(--bg,#0e1117)}',
   '.dlr-picker-bar input,.dlr-picker-bar select{background:var(--surface,#151922);border:1px solid var(--border,#2a2f3a);border-radius:7px;padding:7px 9px;color:var(--text,#e7ebf3);font-size:.8rem}',
   '.dlr-picker-bar input{flex:1;min-width:150px}',
   '.dlr-count{font-size:.74rem;color:var(--text-muted,#8b93a5);align-self:center;margin-left:auto}',
   '.dlr-bulk{border:1px solid var(--border,#2a2f3a);border-radius:10px;padding:12px;margin-bottom:12px;background:var(--bg,#0e1117)}',
   '.dlr-bulk-head{font-size:.74rem;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:var(--text-muted,#8b93a5);margin-bottom:4px}',
   '.dlr-bulk-sub{font-size:.72rem;color:var(--text-dim,#6b7280);margin-bottom:8px}',
   '.dlr-bulk-ta{width:100%;min-height:66px;background:var(--surface,#151922);border:1px solid var(--border,#2a2f3a);border-radius:8px;padding:9px 11px;color:var(--text,#e7ebf3);font-size:.82rem;font-family:ui-monospace,Menlo,monospace;resize:vertical;box-sizing:border-box}',
   '.dlr-bulk-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px}',
   '.dlr-file-label{cursor:pointer;margin:0}',
   '.dlr-bulk-status{font-size:.76rem;color:var(--text-muted,#8b93a5);flex:1;min-width:160px;line-height:1.5}',
   '.dlr-picker-list{max-height:46vh;overflow-y:auto;padding:4px 0}',
   '.dlr-opt{display:flex;align-items:center;gap:10px;padding:7px 12px;font-size:.82rem;cursor:pointer;border-bottom:1px solid rgba(255,255,255,.03)}',
   '.dlr-opt:hover{background:rgba(255,255,255,.03)}',
   '.dlr-opt input{width:16px;height:16px;accent-color:#007934}',
   '.dlr-opt .c{color:var(--text-muted,#8b93a5);font-size:.72rem;margin-left:auto;white-space:nowrap}',
   '.dlr-opt.on{background:rgba(0,121,52,.07)}',
   '.dlr-empty{padding:26px;text-align:center;color:var(--text-muted,#8b93a5);font-size:.85rem}',
   '.dlr-note{font-size:.74rem;color:var(--text-muted,#8b93a5);margin:2px 0 14px;line-height:1.5}'
  ].join('');
  document.head.appendChild(st);
}

/* ---- entry: called by admTab when tab-dealers opens ---- */
function renderDealersTab(){
  _dlrInjectCss();
  var el=document.getElementById('tab-dealers'); if(!el) return;
  if(!_dlrEndpoint()){ el.innerHTML='<div class="dlr-wrap"><div class="dlr-empty">No backend configured (config.js → backend.workerEndpoint).</div></div>'; return; }
  if(_DLR.editing){ el.innerHTML=_dlrEditorHtml(); _dlrBindPicker(); return; }
  if(!_DLR.loaded){
    el.innerHTML='<div class="dlr-wrap">'+
      '<div class="dlr-note">Private per-dealer pricelists. Each dealer gets a Special Margin (%) off SRP on the SKUs you assign. '+
      'The main pricelist stays the single source of truth — SRP edits and SKU deletions flow through automatically. '+
      'Dealer data is stored securely in the Worker (never in the public repo).</div>'+
      '<button class="dlr-btn primary" onclick="dlrLoad()">Load dealer list</button>'+
      '<span class="dlr-note" style="display:block;margin-top:10px">You’ll be asked for the admin save password (same one used to publish).</span>'+
    '</div>';
    return;
  }
  var rows=_DLR.dealers.map(function(d){
    var n=(d.skus||[]).length;
    return '<div class="dlr-card">'+
      '<div><h4>'+_dlrEsc(d.name)+(d.active===false?' <span class="dlr-off">(disabled)</span>':'')+'</h4>'+
      '<div class="dlr-meta"><span class="dlr-pill">'+(Number(d.discountPct)||0)+'% margin</span>'+
      '<span>'+n+' SKU'+(n===1?'':'s')+' assigned</span>'+
      '<span>user: '+_dlrEsc(d.username)+'</span></div></div>'+
      '<div style="display:flex;gap:8px">'+
      '<button class="dlr-btn" onclick="dlrEdit(\''+_dlrEsc(d.id)+'\')">Edit</button>'+
      '<button class="dlr-btn danger" onclick="dlrDelete(\''+_dlrEsc(d.id)+'\')">Delete</button></div>'+
    '</div>';
  }).join('');
  el.innerHTML='<div class="dlr-wrap">'+
    '<div class="dlr-actions">'+
      '<button class="dlr-btn primary" onclick="dlrNew()">+ Add dealer</button>'+
      '<button class="dlr-btn" onclick="dlrLoad()">Refresh</button>'+
    '</div>'+
    (rows? '<div class="dlr-list">'+rows+'</div>' : '<div class="dlr-empty"><b>Loaded — no dealers yet.</b><br>Click <b>+ Add dealer</b> above to create your first dealer.</div>')+
  '</div>';
}

function _dlrRenderMsg(html){ var el=document.getElementById('tab-dealers'); if(el) el.innerHTML='<div class="dlr-wrap"><div class="dlr-note" style="font-size:.9rem;line-height:1.6;padding:16px 0">'+html+'</div></div>'; }
function dlrLoad(){
  var ep=_dlrEndpoint(); if(!ep){ _dlrRenderMsg('No backend configured (config.js → backend.workerEndpoint).'); return; }
  var pw=window.prompt('Enter the admin save password to load dealers:');
  if(pw===null){ if(!_DLR.loaded) renderDealersTab(); return; }
  if(!pw){ _dlrRenderMsg('No password entered. <button class="dlr-btn" onclick="dlrLoad()">Try again</button>'); return; }
  _dlrRenderMsg('Loading dealers…');
  fetch(ep,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'dealersGet',password:pw})})
    .then(function(r){ return r.json().catch(function(){return {};}).then(function(j){return {status:r.status,body:j};}); })
    .then(function(res){
      if(res.status===401){ _dlrRenderMsg('Wrong save password. <button class="dlr-btn" onclick="dlrLoad()">Try again</button>'); return; }
      if(res.status!==200||!res.body||!res.body.ok){ _dlrRenderMsg('Load failed: '+((res.body&&res.body.error)||('HTTP '+res.status))+'. <button class="dlr-btn" onclick="dlrLoad()">Try again</button>'); return; }
      _DLR.pw=pw; _DLR.loaded=true; _DLR.dealers=res.body.dealers||[];
      try{ renderDealersTab(); }catch(e){ _dlrRenderMsg('Loaded '+_DLR.dealers.length+' dealer(s) but hit a render error: '+_dlrEsc(e.message||String(e))); return; }
      _dlrToast('Loaded '+_DLR.dealers.length+' dealer'+(_DLR.dealers.length===1?'':'s')+'.');
    })
    .catch(function(e){ _dlrRenderMsg('Network error: '+_dlrEsc(e.message||String(e))+'. <button class="dlr-btn" onclick="dlrLoad()">Try again</button>'); });
}

function _dlrId(){ return 'd'+Date.now().toString(36)+Math.random().toString(36).slice(2,6); }
function dlrGenPass(){
  var a='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789', out='';
  for(var i=0;i<10;i++) out+=a[Math.floor(Math.random()*a.length)];
  var inp=document.getElementById('dlr-pass'); if(inp){ inp.value=out; if(_DLR.editing) _DLR.editing.password=out; }
}
function dlrNew(){ _DLR.editing={ id:_dlrId(), name:'', username:'', password:'', discountPct:40, active:true, skus:[] }; _DLR.q=''; _DLR.cat='__all'; renderDealersTab(); }
function dlrEdit(id){ var d=_DLR.dealers.filter(function(x){return x.id===id;})[0]; if(!d) return; _DLR.editing=JSON.parse(JSON.stringify(d)); if(!Array.isArray(_DLR.editing.skus))_DLR.editing.skus=[]; _DLR.q=''; _DLR.cat='__all'; renderDealersTab(); }
function dlrCancelEdit(){ _DLR.editing=null; renderDealersTab(); }

function dlrDelete(id){
  var d=_DLR.dealers.filter(function(x){return x.id===id;})[0]; if(!d) return;
  if(!confirm('Delete dealer “'+d.name+'”?\nThis removes their private pricelist access. Cannot be undone.')) return;
  _DLR.dealers=_DLR.dealers.filter(function(x){return x.id!==id;});
  _dlrPersist('Dealer deleted.');
}

/* ---- editor ---- */
function _dlrCats(){
  var seen={}, out=[];
  (ALL_PRODUCTS||[]).forEach(function(p){ var c=(p.sheet||'')+' › '+(p.category||''); if(!seen[c]){seen[c]=1;out.push(c);} });
  out.sort();
  return out;
}
function _dlrMatch(p){
  var q=(_DLR.q||'').toLowerCase().trim();
  if(_DLR.cat!=='__all'){ var c=(p.sheet||'')+' › '+(p.category||''); if(c!==_DLR.cat) return false; }
  if(!q) return true;
  return (String(p.item_code||'').toLowerCase().indexOf(q)>=0) ||
         (String(p.product_name||'').toLowerCase().indexOf(q)>=0) ||
         (String(p.model||'').toLowerCase().indexOf(q)>=0);
}
function _dlrEditorHtml(){
  var d=_DLR.editing, sel={}; (d.skus||[]).forEach(function(c){ sel[c]=1; });
  var cats=_dlrCats().map(function(c){ return '<option value="'+_dlrEsc(c)+'"'+(_DLR.cat===c?' selected':'')+'>'+_dlrEsc(c)+'</option>'; }).join('');
  var matched=(ALL_PRODUCTS||[]).filter(_dlrMatch);
  var opts=matched.slice(0,1200).map(function(p){
    var on=sel[p.item_code]?' on':'';
    return '<label class="dlr-opt'+on+'"><input type="checkbox" onchange="dlrToggleSku(\''+_dlrEsc(p.item_code)+'\',this.checked)" '+(sel[p.item_code]?'checked':'')+'>'+
      '<span>'+_dlrEsc(p.product_name||p.item_code)+' <span style="color:var(--text-muted,#8b93a5)">('+_dlrEsc(p.item_code)+')</span></span>'+
      '<span class="c">SRP ₱'+_dlrNum(p.srp)+'</span></label>';
  }).join('');
  var overflow = matched.length>1200 ? '<div class="dlr-note" style="padding:8px 12px;margin:0">Showing first 1200 of '+matched.length+' — refine the search to see more.</div>' : '';
  return '<div class="dlr-wrap"><div class="dlr-form">'+
    '<div class="dlr-frow">'+
      '<div class="dlr-field" style="flex:2"><label>Dealer name</label><input id="dlr-name" value="'+_dlrEsc(d.name)+'" oninput="_DLR.editing.name=this.value" placeholder="e.g. Acme Corp"></div>'+
      '<div class="dlr-field"><label>Special Margin (%)</label><input id="dlr-pct" type="number" min="0" max="95" value="'+(Number(d.discountPct)||0)+'" oninput="_DLR.editing.discountPct=this.value"></div>'+
    '</div>'+
    '<div class="dlr-frow">'+
      '<div class="dlr-field"><label>Username (dealer signs in with this)</label>'+
        '<input id="dlr-user" value="'+_dlrEsc(d.username)+'" oninput="_DLR.editing.username=this.value" placeholder="e.g. acme" autocomplete="off"></div>'+
      '<div class="dlr-field"><label>Password</label>'+
        '<div class="dlr-code-row"><input id="dlr-pass" value="'+_dlrEsc(d.password)+'" oninput="_DLR.editing.password=this.value" placeholder="password" autocomplete="off"><button class="dlr-btn" type="button" onclick="dlrGenPass()">Generate</button></div></div>'+
      '<div class="dlr-field" style="max-width:150px"><label>Status</label><select id="dlr-active" onchange="_DLR.editing.active=(this.value===\'1\')" style="background:var(--bg,#0e1117);border:1px solid var(--border,#2a2f3a);border-radius:8px;padding:9px 11px;color:var(--text,#e7ebf3);font-size:.86rem"><option value="1"'+(d.active!==false?' selected':'')+'>Active</option><option value="0"'+(d.active===false?' selected':'')+'>Disabled</option></select></div>'+
    '</div>'+
    '<div class="dlr-field" style="margin-bottom:8px"><label>Assigned SKUs</label></div>'+
    '<div class="dlr-bulk">'+'<div class="dlr-bulk-head">Bulk assign by Item Code</div>'+'<div class="dlr-bulk-sub">Paste Item Codes (one per line, or comma/space separated) or upload a .txt/.csv. Matched codes are added to the list below.</div>'+'<textarea id="dlr-bulk-ta" class="dlr-bulk-ta" placeholder="40189&#10;20503&#10;10561"></textarea>'+'<div class="dlr-bulk-actions">'+'<label class="dlr-btn dlr-file-label">Upload .txt/.csv<input id="dlr-bulk-file" type="file" accept=".txt,.csv" style="display:none" onchange="dlrBulkFile(this)"></label>'+'<button class="dlr-btn primary" type="button" onclick="dlrBulkAdd()">Match &amp; add</button>'+'<span class="dlr-bulk-status" id="dlr-bulk-status"></span>'+'</div>'+'</div>'+
    '<div class="dlr-picker">'+
      '<div class="dlr-picker-bar">'+
        '<input id="dlr-q" value="'+_dlrEsc(_DLR.q)+'" placeholder="Search SKU, name or model…" oninput="dlrPickerSearch(this.value)">'+
        '<select onchange="dlrPickerCat(this.value)"><option value="__all"'+(_DLR.cat==='__all'?' selected':'')+'>All categories</option>'+cats+'</select>'+
        '<button class="dlr-btn" type="button" onclick="dlrSelectFiltered(true)">Select shown</button>'+
        '<button class="dlr-btn" type="button" onclick="dlrSelectFiltered(false)">Clear shown</button>'+
        '<span class="dlr-count" id="dlr-count">'+(d.skus||[]).length+' selected</span>'+
      '</div>'+
      overflow+
      '<div class="dlr-picker-list" id="dlr-picker-list">'+(opts||'<div class="dlr-empty">No products match.</div>')+'</div>'+
    '</div>'+
    '<div class="dlr-actions" style="margin-top:16px">'+
      '<button class="dlr-btn primary" onclick="dlrSaveEditor()">Save dealer</button>'+
      '<button class="dlr-btn" onclick="dlrCancelEdit()">Cancel</button>'+
    '</div>'+
  '</div></div>';
}
function _dlrBindPicker(){ /* reserved for future keyboard nav */ }

function dlrBulkFile(inp){
  var f=inp.files&&inp.files[0]; if(!f) return;
  var rd=new FileReader();
  rd.onload=function(){ var ta=document.getElementById('dlr-bulk-ta'); if(ta){ ta.value=(ta.value.trim()?ta.value.replace(/\s+$/,'')+'\n':'')+String(rd.result||''); } var st=document.getElementById('dlr-bulk-status'); if(st) st.textContent='Loaded "'+f.name+'" — click Match & add.'; };
  rd.onerror=function(){ var st=document.getElementById('dlr-bulk-status'); if(st) st.textContent='Could not read that file.'; };
  rd.readAsText(f); inp.value='';
}
function dlrBulkAdd(){
  if(!_DLR.editing) return;
  var ta=document.getElementById('dlr-bulk-ta'); if(!ta) return;
  var codes=(ta.value||'').split(/[\s,;]+/).map(function(c){return c.trim();}).filter(Boolean);
  if(!codes.length){ _dlrBulkStatus('Paste or upload some Item Codes first.'); return; }
  var byCode={}; (ALL_PRODUCTS||[]).forEach(function(p){ byCode[String(p.item_code).toLowerCase()]=String(p.item_code); });
  var cur={}; (_DLR.editing.skus||[]).forEach(function(c){ cur[String(c)]=1; });
  var added=0, dup=0, notFound=[], seen={};
  codes.forEach(function(c){
    var key=c.toLowerCase(); if(seen[key]) return; seen[key]=1;
    var actual=byCode[key];
    if(!actual){ notFound.push(c); return; }
    if(cur[actual]){ dup++; return; }
    _DLR.editing.skus.push(actual); cur[actual]=1; added++;
  });
  var msg='Added '+added+' new SKU'+(added===1?'':'s')+'.';
  if(dup) msg+=' '+dup+' already assigned.';
  if(notFound.length) msg+=' '+notFound.length+' not found: '+notFound.slice(0,20).join(', ')+(notFound.length>20?' …':'');
  _dlrRepaintPicker();
  _dlrBulkStatus(msg);
}
function _dlrBulkStatus(m){ var s=document.getElementById('dlr-bulk-status'); if(s) s.textContent=m; }
function dlrToggleSku(code,on){
  var s=_DLR.editing.skus||[];
  if(on){ if(s.indexOf(code)<0) s.push(code); } else { s=s.filter(function(c){return c!==code;}); }
  _DLR.editing.skus=s; _dlrUpdateCount();
}
function _dlrUpdateCount(){ var c=document.getElementById('dlr-count'); if(c) c.textContent=(_DLR.editing.skus||[]).length+' selected'; }
function dlrPickerSearch(v){ _DLR.q=v; _dlrRepaintPicker(); }
function dlrPickerCat(v){ _DLR.cat=v; _dlrRepaintPicker(); }
function _dlrRepaintPicker(){
  var host=document.getElementById('tab-dealers'); if(!host) return;
  // re-render only the picker list + count without losing form field focus is hard;
  // simplest: re-render the whole editor (fields are backed by _DLR.editing, so no data loss).
  host.innerHTML=_dlrEditorHtml();
  var q=document.getElementById('dlr-q'); if(q){ q.focus(); q.setSelectionRange(q.value.length,q.value.length); }
}
function dlrSelectFiltered(on){
  var matched=(ALL_PRODUCTS||[]).filter(_dlrMatch);
  var s=_DLR.editing.skus||[], set={}; s.forEach(function(c){set[c]=1;});
  matched.forEach(function(p){ if(on){ set[p.item_code]=1; } else { delete set[p.item_code]; } });
  _DLR.editing.skus=Object.keys(set);
  _dlrRepaintPicker();
}

function dlrSaveEditor(){
  var d=_DLR.editing;
  d.name=String(d.name||'').trim();
  d.username=String(d.username||'').trim();
  d.password=String(d.password||'').trim();
  d.discountPct=Math.max(0,Math.min(95,Number(d.discountPct)||0));
  if(!d.name){ _dlrToast('Dealer needs a name.'); return; }
  if(!d.username){ _dlrToast('Dealer needs a username.'); return; }
  if(!d.password){ _dlrToast('Dealer needs a password.'); return; }
  var dup=_DLR.dealers.some(function(x){ return x.id!==d.id && String(x.username||'').toLowerCase()===d.username.toLowerCase(); });
  if(dup){ _dlrToast('That username is already used by another dealer.'); return; }
  if(!(d.skus||[]).length && !confirm('No SKUs assigned — this dealer will see an empty list. Save anyway?')) return;
  var i=-1; _DLR.dealers.forEach(function(x,idx){ if(x.id===d.id) i=idx; });
  if(i>=0) _DLR.dealers[i]=d; else _DLR.dealers.push(d);
  _DLR.editing=null;
  _dlrPersist('Dealer saved.');
}

function _dlrPersist(okMsg){
  var ep=_dlrEndpoint();
  var pw=_DLR.pw || window.prompt('Enter the admin save password to save dealers:');
  if(pw===null) return;
  if(!pw){ _dlrToast('Cancelled — no password.'); return; }
  _dlrToast('Saving…');
  fetch(ep,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'dealersSave',password:pw,dealers:_DLR.dealers})})
    .then(function(r){ return r.json().catch(function(){return {};}).then(function(j){return {status:r.status,body:j};}); })
    .then(function(res){
      if(res.status===401){ _dlrToast('Wrong password.'); return; }
      if(res.status!==200||!res.body||!res.body.ok){ _dlrToast('Save failed: '+((res.body&&res.body.error)||('HTTP '+res.status))); return; }
      _DLR.pw=pw; _DLR.loaded=true; _dlrToast(okMsg+' ('+res.body.count+' dealer'+(res.body.count===1?'':'s')+')'); renderDealersTab();
    })
    .catch(function(e){ _dlrToast('Save error: '+(e.message||e)); });
}

function _dlrNum(n){ n=Number(n)||0; return n.toLocaleString('en-PH'); }
