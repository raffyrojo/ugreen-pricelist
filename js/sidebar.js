/* Sidebar (section-aware) — ported verbatim from v1.3.23. */

function buildSectionCategoryMap(products){
  var map={};
  products.forEach(function(p){
    var sec=normalizeSidebar(p.sheet);
    if(!sec)return;
    var secKey=sec.toLowerCase();
    var displayName=normalizeSidebar(p.sheet_display)||sec
      .replace('A&V-','A&V: ').replace('Mobile-','Mobile: ')
      .replace('Transmission-','Transmission: ').replace('Flash-','Flash: ')
      .replace('Others-','Others: ');
    var cat=normalizeSidebar(p.category)||'Uncategorized';
    if(!map[secKey])map[secKey]={name:displayName,value:sec,count:0,cats:{}};
    map[secKey].count++;
    var catKey=cat.toLowerCase();
    if(!map[secKey].cats[catKey])map[secKey].cats[catKey]={name:cat,count:0};
    map[secKey].cats[catKey].count++;
  });
  return Object.keys(map).map(function(k){return map[k];})
    .filter(function(s){return s.count>0;})
    .sort(function(a,b){return a.name.localeCompare(b.name);});
}

function rebuildSidebar(){
  var container=document.getElementById('sidebar-sections');
  if(!container)return;
  container.innerHTML='';
  var secCatMap=buildSectionCategoryMap(ALL_PRODUCTS);

  secCatMap.forEach(function(sec){
    var cats=Object.keys(sec.cats).map(function(k){return sec.cats[k];})
      .filter(function(c){return c.count>0;})
      .sort(function(a,b){return a.name.localeCompare(b.name);});

    var group=document.createElement('div');
    group.className='sb-group';

    var secActive=currentFilter.type==='sheet'&&currentFilter.value===sec.value;
    var childActive=false;
    cats.forEach(function(c){
      if(currentFilter.type==='category'&&currentFilter.value===c.name&&currentFilter.section===sec.value)childActive=true;
    });
    var isExpanded=secActive||childActive;

    var hd=document.createElement('button');
    hd.className='sb-group-hd'+(isExpanded?' expanded':'')+(secActive?' sec-active':'');
    hd.setAttribute('aria-expanded',isExpanded?'true':'false');
    hd.dataset.secValue=sec.value;
    hd.innerHTML='<span class="sb-arrow">▶</span>'+
      '<span style="flex:1;min-width:0;word-break:break-word">'+esc(sec.name)+'</span>'+
      '<span class="sb-sec-count">'+sec.count+'</span>';

    (function(secVal,hdEl){
      hdEl.onclick=function(){
        if(currentFilter.type==='sheet'&&currentFilter.value===secVal){
          hdEl.classList.toggle('expanded');
          hdEl.setAttribute('aria-expanded',hdEl.classList.contains('expanded')?'true':'false');
        }else{
          setFilter('sheet',secVal);
        }
      };
    })(sec.value,hd);
    group.appendChild(hd);

    if(cats.length>1){
      var children=document.createElement('div');
      children.className='sb-group-children';
      cats.forEach(function(c){
        var b=document.createElement('button');
        b.className='filter-btn';
        b.dataset.filterType='category';
        b.dataset.filterValue=c.name;
        if(currentFilter.type==='category'&&currentFilter.value===c.name&&currentFilter.section===sec.value)b.classList.add('active');
        b.innerHTML='<span style="flex:1;min-width:0;word-break:break-word">'+esc(c.name)+'</span><span class="badge">'+c.count+'</span>';
        (function(catName,secValue){
          b.onclick=function(){setFilter('category',catName,secValue);};
        })(c.name,sec.value);
        children.appendChild(b);
      });
      group.appendChild(children);
    }
    container.appendChild(group);
  });

  var allBtn=document.querySelector('.filter-btn[data-filter-type="all"]');
  if(allBtn){var badge=allBtn.querySelector('.badge');if(badge)badge.textContent=ALL_PRODUCTS.length;}
}

function toggleSidebar(){var aside=document.getElementById('sidebar');if(!aside)return;if(aside.classList.contains('sidebar-open'))closeSidebar();else openSidebar();}
function openSidebar(){var aside=document.getElementById('sidebar');var backdrop=document.getElementById('sidebar-backdrop');if(aside)aside.classList.add('sidebar-open');if(backdrop)backdrop.classList.add('open');document.body.style.overflow='hidden';}
function closeSidebar(){var aside=document.getElementById('sidebar');var backdrop=document.getElementById('sidebar-backdrop');if(aside)aside.classList.remove('sidebar-open');if(backdrop)backdrop.classList.remove('open');document.body.style.overflow='';}
