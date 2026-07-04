/* Search — debounced, ported verbatim from v1.3.23. */
function handleSearch(value){
  currentSearch=value||'';
  expandedKey=null;sortCol=null;
  clearTimeout(searchTimer);
  searchTimer=setTimeout(function(){render();},currentSearch.length<3?150:250);
}
