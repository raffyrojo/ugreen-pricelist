/* Rendering: table, grid, expand row, product modal, view toggle.
   Ported from v1.3.23. Table now renders directly (no virtual-scroll) because
   images are lazy-loaded files, not in-memory base64 — 774 rows is snappy. */

function render(){
  applyFilters();
  var _disp=DISPLAYED_PRODUCTS.length, _all=ALL_PRODUCTS.length;
  var _countEl=document.getElementById('count');
  if(_countEl)_countEl.textContent=(_disp===_all)?_disp.toLocaleString():(_disp.toLocaleString()+' / '+_all.toLocaleString());
  if(currentView==='table')renderTable(DISPLAYED_PRODUCTS,currentSearch.trim().toLowerCase());
  else renderGrid(DISPLAYED_PRODUCTS,currentSearch.trim().toLowerCase());
}

function _emptyState(empty,q){
  if(q&&currentFilter.type!=='all'){
    var allMatch=ALL_PRODUCTS.filter(function(p){
      return(p.item_code||'').toLowerCase().includes(q)||(p.model||'').toLowerCase().includes(q)||
            (p.product_name||'').toLowerCase().includes(q)||(p.category||'').toLowerCase().includes(q)||
            (p.color||'').toLowerCase().includes(q);
    });
    if(allMatch.length>0){
      empty.innerHTML='<h3>No products found in this filter</h3><p>'+allMatch.length+' result'+(allMatch.length!==1?'s':'')+' found across all categories.</p>'+
        '<button class="btn-reset-filters" onclick="setFilter(\'all\',\'\')" style="margin-top:.5rem;padding:.4rem 1rem;border:1px solid var(--accent);background:transparent;color:var(--accent);border-radius:6px;cursor:pointer;font-size:.78rem;font-weight:600">Show All Categories</button>';
    }
  }
}

function renderTable(filtered,q){
  var tbody=document.getElementById('tbody');
  var empty=document.getElementById('empty-table');
  activeRow=null;
  if(!filtered.length){tbody.innerHTML='';_emptyState(empty,q);empty.style.display='';return;}
  empty.style.display='none';

  var groupBySec=!q&&currentFilter.type!=='category';
  var lastSec=null, rows=[];
  filtered.forEach(function(p,i){
    var secVal=p.category||p.sheet_display||p.sheet||'Other';
    if(groupBySec&&secVal!==lastSec){lastSec=secVal;rows.push('<tr class="cat-header"><td colspan="9">'+esc(secVal)+'</td></tr>');}
    rows.push(
      '<tr data-key="'+i+'">'+
      thumbCell(p.image)+
      '<td class="td-product"><div class="product-name">'+hl(p.product_name,q)+((typeof isNewArrival==='function'&&isNewArrival(p))?'<span class="sku-new-badge">NEW</span>':'')+(isRecentlyMerged(p.item_code)?'<span class="sku-merged-badge">MERGED</span>':'')+'</div></td>'+
      '<td class="td-model">'+(p.model?hl(p.model,q):'—')+'</td>'+
      '<td class="td-code">'+hl(p.item_code,q)+'</td>'+
      '<td class="td-specs">'+(p.color?'<span class="spec-tag">'+hl(p.color,q)+'</span>':'')+(p.length?'<span class="spec-tag">'+hl(p.length,q)+'</span>':'')+'</td>'+
      '<td class="td-price price-srp">'+fmt(p.srp)+'</td>'+
      '<td class="td-price price-dp">'+fmt(p.dp)+'</td>'+
      '<td class="td-price price-dpv">'+dpvCellHtml(p)+'</td>'+
      '<td class="td-moq">'+esc(p.moq||'—')+'</td>'+
      '</tr>'
    );
  });
  tbody.innerHTML=rows.join('');
}

function renderGrid(filtered,q){
  var grid=document.getElementById('grid-view');
  var empty=document.getElementById('empty-grid');
  if(!filtered.length){grid.innerHTML='';_emptyState(empty,q);empty.style.display='';return;}
  empty.style.display='none';
  grid.innerHTML=filtered.map(function(p){
    return '<div class="grid-card" onclick="openModal(\''+String(p.item_code).replace(/\\/g,'\\\\').replace(/'/g,"\\'")+'\')">'+
      '<div class="grid-img">'+gridImgHtml(p.image)+'</div>'+
      '<div class="grid-body">'+
        '<div class="grid-code">'+hl(p.item_code,q)+'</div>'+
        '<div class="grid-meta">'+(p.color?tag(p.color):'')+(p.length?tag(p.length):'')+'</div>'+
        '<div class="grid-name">'+hl(p.product_name,q)+((typeof isNewArrival==='function'&&isNewArrival(p))?'<span class="sku-new-badge" style="margin-left:6px">NEW</span>':'')+'</div>'+
        ((p.short_desc||p.description)?'<div class="grid-desc">'+esc(p.short_desc||firstBullet(p.description))+'</div>':'')+
        '<div class="grid-prices">'+
          '<div class="grid-price"><div class="plabel" style="opacity:.75">SRP</div><div class="pval price-srp" style="font-size:.7rem;opacity:.8">'+fmtS(p.srp)+'</div></div>'+
          '<div class="grid-price"><div class="plabel" style="color:var(--dp);font-weight:600">Dealer ₱</div><div class="pval price-dp" style="font-size:.85rem;font-weight:700">'+fmtS(p.dp)+'</div></div>'+
          '<div class="grid-price"><div class="plabel" style="opacity:.7">Vol (MOQ)</div><div class="pval price-dpv" style="font-size:.68rem;opacity:.7">'+fmtS(p.dp_volume)+'</div>'+(p.moq?'<div class="dpv-moq-note" style="font-size:.52rem">MOQ: '+esc(String(p.moq))+'</div>':'')+'</div>'+
        '</div>'+
      '</div></div>';
  }).join('');
}

function buildExpandRowHtml(p){
  return '<td colspan="9"><div class="expand-inner">'+
    '<div class="expand-left">'+expandImgHtml(p.image)+'</div>'+
    '<div class="expand-right">'+
      '<div class="expand-meta-grid">'+
        '<div class="expand-field"><label>Category</label><p>'+esc(p.category||'—')+'</p></div>'+
        '<div class="expand-field"><label>Section</label><p>'+esc(p.sheet_display||p.sheet||'—')+'</p></div>'+
        '<div class="expand-field"><label>UPC / Barcode</label><p>'+esc(p.upc||'—')+'</p></div>'+
        '<div class="expand-field"><label>Material Number</label><p>'+esc(p.material_number||'—')+'</p></div>'+
        (p.moq?'<div class="expand-field"><label>MOQ</label><p>'+esc(String(p.moq))+'</p></div>':"")+
        (p.remarks?'<div class="expand-field"><label>Remarks</label><p>'+esc(p.remarks)+'</p></div>':'')+
      '</div>'+
      featsHtml(p.features)+
      (p.description?descBulletsHtml(p.description,'expand'):'')+
      '<div class="sku-action-bar" style="margin-top:.75rem;padding-top:.75rem;border-top:1px solid var(--border)"><button class="btn-screenshot" onclick="event.stopPropagation();captureSkuCard(\''+p.item_code+'\',this)">📸 Screenshot</button></div>'+
      (isAdmin()?'<div class="expand-admin-bar"><button class="btn-admin-edit" onclick="adminEditProduct(\''+p.item_code+'\')">✏️ Edit SKU</button><button class="btn-admin-edit" onclick="adminDuplicateProduct(\''+p.item_code+'\')">⧉ Duplicate</button><button class="btn-admin-del" onclick="adminDeleteProduct(\''+p.item_code+'\')">Remove from List</button></div>':'')+
    '</div>'+
    '</div></td>';
}

function expandRow(tr){
  var key=tr.dataset.key;
  var p=DISPLAYED_PRODUCTS[parseInt(key,10)];
  if(!p)return;
  expandedKey=key;
  tr.classList.add('expanded');
  if(!_expandRowEl){_expandRowEl=document.createElement('tr');_expandRowEl.className='expand-row';}
  _expandRowEl.innerHTML='<td colspan="9"><div class="expand-inner" style="min-height:80px;opacity:0"></div></td>';
  tr.insertAdjacentElement('afterend',_expandRowEl);
  var _captured=_expandRowEl;
  requestAnimationFrame(function(){if(!document.contains(_captured))return;_captured.innerHTML=buildExpandRowHtml(p);});
}
function collapseRow(tr){if(!tr)return;tr.classList.remove('expanded');if(_expandRowEl&&_expandRowEl.parentNode)_expandRowEl.parentNode.removeChild(_expandRowEl);}
function toggleExpand(tr){
  if(tr.classList.contains('cat-header'))return;
  if(activeRow===tr){collapseRow(tr);activeRow=null;expandedKey=null;return;}
  if(activeRow)collapseRow(activeRow);
  expandRow(tr);activeRow=tr;
}

function openModal(itemCode){
  var p=ALL_PRODUCTS.find(function(x){return String(x.item_code)===String(itemCode);});
  if(!p)return;
  try{ if(typeof recordView==='function') recordView(itemCode); }catch(e){}   /* Phase 11: track views for trending fallback */
  var s=imgSrc(p.image);
  document.getElementById('modal-img-panel').innerHTML=s?'<img src="'+s+'" alt="'+esc(p.product_name||'Product image')+'">':'<div class="modal-no-img">No Image</div>';
  document.getElementById('modal-cat').textContent=p.category||'';
  document.getElementById('modal-name').textContent=p.product_name;
  document.getElementById('modal-code').textContent='Item: '+p.item_code+(p.model?' · Model: '+p.model:'');
  document.getElementById('modal-prices').innerHTML=
    '<div class="modal-price"><div class="plabel" style="opacity:.75">SRP</div><div class="pval price-srp">'+fmt(p.srp)+'</div></div>'+
    '<div class="modal-price dp-highlight"><div class="plabel" style="color:var(--dp)">Dealer Price</div><div class="pval price-dp" style="font-size:1.15rem">'+fmt(p.dp)+'</div></div>'+
    '<div class="modal-price"><div class="plabel" style="opacity:.7">DP Volume</div><div class="pval price-dpv">'+fmt(p.dp_volume)+'</div>'+(p.moq?'<div class="dpv-moq-note" style="margin-top:4px;font-size:.58rem">Valid only for orders ≥ '+p.moq+' units</div>':'')+'</div>';
  var bottomParts=[];
  bottomParts.push('<div class="sku-action-bar" style="margin-bottom:.8rem;padding-bottom:.8rem;border-bottom:1px solid var(--border)"><button class="btn-screenshot" onclick="captureSkuCard(\''+p.item_code+'\',this)">📸 Screenshot</button></div>');
  var specs='<div class="modal-specs">'+
    '<div class="modal-field"><label>Category</label><p>'+esc(p.category||'—')+'</p></div>'+
    '<div class="modal-field"><label>Section</label><p>'+esc(p.sheet_display||p.sheet||'—')+'</p></div>'+
    '<div class="modal-field"><label>Color</label><p>'+esc(p.color||'—')+'</p></div>'+
    '<div class="modal-field"><label>Length</label><p>'+esc(p.length||'—')+'</p></div>'+
    '<div class="modal-field"><label>MOQ</label><p>'+esc(p.moq||'—')+'</p></div>'+
    '<div class="modal-field"><label>UPC</label><p>'+esc(p.upc||'—')+'</p></div>'+
    '<div class="modal-field"><label>Material No.</label><p>'+esc(p.material_number||'—')+'</p></div>'+
    (p.remarks?'<div class="modal-field"><label>Remarks</label><p>'+esc(p.remarks)+'</p></div>':'')+
    '</div>';
  bottomParts.push(specs);
  var chips=parseFeats(p.features);
  if(chips.length)bottomParts.push('<div class="desc-block"><div class="desc-section-title">Product Features</div><ul class="bullet-list">'+chips.map(function(c){return '<li>'+esc(c)+'</li>';}).join('')+'</ul></div>');
  if(p.description)bottomParts.push(descBulletsHtml(p.description,'modal'));
  if(isAdmin()){bottomParts.push('<div class="expand-admin-bar" style="margin-top:0.5rem"><button class="btn-admin-edit" onclick="adminEditProduct(\''+p.item_code+'\');closeModal()">✏️ Edit SKU</button><button class="btn-admin-edit" onclick="adminDuplicateProduct(\''+p.item_code+'\');closeModal()">⧉ Duplicate</button><button class="btn-admin-del" onclick="adminDeleteProduct(\''+p.item_code+'\');closeModal()">Remove from List</button></div>');}
  document.getElementById('modal-bottom').innerHTML=bottomParts.join('');
  document.getElementById('modal').classList.add('open');
}
function closeModal(){document.getElementById('modal').classList.remove('open');}
function closeModalOverlay(e){if(e.target===document.getElementById('modal'))closeModal();}

function setView(v){
  currentView=v;
  document.getElementById('table-view').style.display=v==='table'?'':'none';
  document.getElementById('grid-view').classList.toggle('active',v==='grid');
  document.getElementById('empty-grid').style.display='none';
  document.getElementById('btn-table').classList.toggle('active',v==='table');
  document.getElementById('btn-grid').classList.toggle('active',v==='grid');
  render();
}

/* Row-click delegation (attached once; tbody content changes via innerHTML). */
function wireTable(){
  var tbody=document.getElementById('tbody');
  if(!tbody||tbody._wired)return;
  tbody._wired=true;
  var _clicking=false;
  tbody.addEventListener('click',function(e){
    if(_clicking)return;
    var tr=e.target.closest('tr');
    if(!tr||tr.classList.contains('cat-header')||tr.classList.contains('expand-row'))return;
    _clicking=true;setTimeout(function(){_clicking=false;},120);
    toggleExpand(tr);
  });
}
