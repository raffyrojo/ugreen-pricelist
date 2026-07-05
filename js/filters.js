/* Filtering + sorting — ported verbatim from v1.3.23 (section-aware). */

function getFiltered(){
  var q=currentSearch.trim().toLowerCase();
  var f=ALL_PRODUCTS.filter(function(p){
    if(currentFilter.type==='new'){if(!(typeof isNewArrival==='function'&&isNewArrival(p)))return false;}
    if(currentFilter.type==='sheet'&&p.sheet!==currentFilter.value)return false;
    if(currentFilter.type==='category'){if(p.category!==currentFilter.value)return false;if(currentFilter.section&&p.sheet!==currentFilter.section)return false;}
    if(!q)return true;
    return String(p.item_code||'').toLowerCase().includes(q)||String(p.model||'').toLowerCase().includes(q)||
           String(p.product_name||'').toLowerCase().includes(q)||String(p.upc||'').toLowerCase().includes(q)||
           String(p.material_number||'').toLowerCase().includes(q)||String(p.category||'').toLowerCase().includes(q)||
           String(p.color||'').toLowerCase().includes(q)||String(p.length||'').toLowerCase().includes(q)||String(p.features||'').toLowerCase().includes(q)||
           String(p.description||'').toLowerCase().includes(q);
  });
  if(sortCol===null){
    sortProducts(f);
  }else{
    f.sort(function(a,b){
      if(sortCol==='length')return (parseLength(a.length)-parseLength(b.length))*sortDir;
      if(sortCol==='item_code')return cmpCode(a.item_code||'',b.item_code||'')*sortDir;
      var av=a[sortCol],bv=b[sortCol];
      if(typeof av==='number'&&typeof bv==='number')return (av-bv)*sortDir;
      return String(av||'').localeCompare(String(bv||''))*sortDir;
    });
  }
  return f;
}

function applyFilters(){DISPLAYED_PRODUCTS=getFiltered();return DISPLAYED_PRODUCTS;}

function setFilter(type,value,section){
  currentFilter={type:type,value:value,section:section||''};
  expandedKey=null;sortCol=null;
  rebuildSidebar();
  render();
}

function resetAllFilters(){
  currentFilter={type:'all',value:'',section:''};
  currentSearch='';expandedKey=null;sortCol=null;
  var searchEl=document.getElementById('search');
  if(searchEl)searchEl.value='';
  rebuildSidebar();
  render();
}

/* Multi-level default sort: Category → Model → Product Name → Color → Length → Item Code */
function sortProducts(arr){
  var normalize=function(val){return (val==null?'':String(val)).toLowerCase().trim();};
  var cmpNorm=function(a,b){var sa=normalize(a),sb=normalize(b);if(sa===sb)return 0;if(!sa)return 1;if(!sb)return -1;return sa.localeCompare(sb);};
  return arr.sort(function(a,b){
    var v=cmpNorm(a.category,b.category);if(v!==0)return v;
    v=cmpNorm(a.model,b.model);if(v!==0)return v;
    v=cmpNorm(a.product_name,b.product_name);if(v!==0)return v;
    v=cmpNorm(a.color,b.color);if(v!==0)return v;
    var lenA=getLengthValue(a.length),lenB=getLengthValue(b.length);if(lenA!==lenB)return lenA-lenB;
    return cmpCode(a.item_code,b.item_code);
  });
}

function sortBy(col){
  if(sortCol===col)sortDir*=-1;else{sortCol=col;sortDir=1;}
  document.querySelectorAll('th').forEach(function(th){
    th.classList.remove('sorted');var sa=th.querySelector('.sa');if(sa)sa.textContent='↕';
    if(th.dataset.col===col){th.classList.add('sorted');if(sa)sa.textContent=sortDir===1?'↑':'↓';}
  });
  expandedKey=null;render();
}
