# UGREEN Pricelist — CMS

Modular, web-based pricelist **CMS** for UGREEN products distributed by **Iontech**
(Philippines). Static GitHub Pages front end + Cloudflare Worker backend. Product
data lives in JSON and is loaded at runtime — **no product data inside the HTML**.

- **Live site:** https://raffyrojo.github.io/ugreen-pricelist/
- **Repo:** https://github.com/raffyrojo/ugreen-pricelist (branch `main`)
- **Status:** **LIVE in production.** (This repo superseded the old single-file
  `iontech-ugreen-pricelist_vX.X.X.html` app — that architecture is retired.)

## Architecture (current)

Modular front end + JSON data + Cloudflare Worker:

```
index.html          app shell (loads config.js + css + all js/*, cache-busted ?v=pN per file)
config.js           github {owner,repo,branch} + backend {workerEndpoint} + data paths
css/styles.css      styles
js/
  state.js          shared runtime state (ALL_PRODUCTS, etc.)
  helpers.js        formatting + image/render helpers + price-change helpers
  sidebar.js        section-aware sidebar (counts exclude disabled SKUs)
  filters.js        filter + sort + global search + customer price-change filter
  search.js         debounced search
  render.js         table, grid, expand row, product modal, price-change indicators
  app.js            bootstrap: fetch JSON, wire events
  exports.js        Quick/Styled/Catalog PDF, Excel (Data/Full), SKU screenshot, Price Change Report
  admin.js          admin dashboard: SKU mgmt, categories, pricing, images, import/export,
                    Price Changes, dealers hook, login modal, global Save
  dealers-admin.js  Special Dealers admin tab
  dealer-mode.js    dealer sign-in + dealer view controller
  github-save.js    Publish → Cloudflare Worker (commits products.json + images);
                    also runs price-change detection at publish
  search-overlay.js search overlay
data/
  products.json     canonical product dataset (single source of truth)
  categories.json   sections / categories
  settings.json     brand, currency, app.dataVersion, export filenames
  price-settings.json  price-change indicator window (default 30 days)
  promo.json        promo popup config
images/             *.webp product images
backend/            Cloudflare Worker (worker.js) + wrangler.toml
```

## Data model

`products.json` is the single source of truth. Each product may carry optional,
backward-compatible fields:

- `disabled` — hides the SKU from all public surfaces + exports; stays in Admin.
- `priceHistory[]`, `pubSRP`, `pubDP` — price-change history + last-published
  baselines (see `CHANGELOG.md` → "Price Change Indicator & Price History").

## Publish flow

Admin edits are in-memory; **Publish** (`saveToGitHub`, wired to every "Save"
button) sends `products.json` (+ new images, + `promo.json`, +
`price-settings.json`) to the Cloudflare Worker, which commits them to the repo.
Pages redeploys in ~1–2 min. GitHub token + admin save password never reach the
client — the admin types the save password per publish.

## Run locally

GitHub Pages serves over https where `fetch()` works. Locally use a static server
(`file://` blocks fetch); a `data/data.js` mirror is the fallback.

```
cd ugreen-pricelist-cms
python3 -m http.server 8080      # then open http://localhost:8080
```

## Docs

- `CHANGELOG.md` — feature/change history for the CMS (newest first).
- Project-root `CLAUDE.md` — authoritative project instructions (current architecture).
- Project-root `PROJECT_STATUS.md` — current live status snapshot.
- Project-root `docs/changelog.md` — deep pre-CMS history.
