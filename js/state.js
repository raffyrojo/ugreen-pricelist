/* Shared runtime state.
   Classic scripts share global scope (like the original app) so inline
   onclick="..." handlers resolve, and modules see each other's globals. */
var ALL_PRODUCTS = [];        // loaded from data/products.json
var CATEGORIES   = null;      // loaded from data/categories.json
var SETTINGS     = null;      // loaded from data/settings.json
var DISPLAYED_PRODUCTS = [];  // current filtered+sorted view

var currentFilter = { type: 'all', value: '', section: '' };
var currentSearch = '';
var currentView   = 'table';
var sortCol = null, sortDir = 1;   // null = multi-level sortProducts()
var expandedKey = null;
var activeRow   = null;            // live expanded <tr>, null when none
var _expandRowEl = null;          // reused expand-row element
var searchTimer = null;
