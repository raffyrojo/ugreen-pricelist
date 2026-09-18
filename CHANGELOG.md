# UGREEN Pricelist CMS — Changelog

Newest first. This is the modular CMS (GitHub Pages + Cloudflare Worker), the
current production system. For the deep pre-CMS history see the project-root
`docs/changelog.md`.

---

## 2026-09-18 — Price Change SIMPLIFIED (supersedes the baseline design below)

**Status: implemented + tested; publishing.** The original publish-time / baseline
design (next section) is **RETIRED**. `pubSRP`, `pubDP`, `priceHistory`, `_pcDetect`,
and the mandatory **baseline-only publish are all removed.**

### New model — per-SKU indicator metadata (like the NEW flag)
Stamped ONLY when a price actually changes, comparing against the price that existed
immediately before the change:
- `previousSRP`, `priceChangeSRP` (`up|down`), `srpChangeDate`
- `previousDP`,  `priceChangeDP`  (`up|down`), `dpChangeDate`

Rules: SRP/DP independent; **multiple changes overwrite** the metadata with the
immediate-prior price (999→1099 then 1099→1049 stores `previousSRP=1099`, never 999);
`new=prev` does nothing and does not reset the date; new SKUs / non-price edits /
volume-only changes never stamp; indicator auto-expires after `indicatorDays` (default
30), price stays.

### Where stamped
`saveSku` (manual edit) and `bpuApply` (Bulk Price Update) both call the same
`pcStamp(p, oldSRP, oldDP, effDate)` in `helpers.js`. **No detection at publish** —
`github-save.js` just publishes. Reference price = the current price immediately before
the change; **no baseline-only publish is ever required.**

### Files
`helpers.js` (pcStamp + reimplemented pcBadge/pcHasRecent/pcRecentEntry), `admin.js`
(stamp on edit + bulk; `_pcAllRows` from metadata), `exports.js` (`_pcReportRows` from
metadata), `github-save.js` (price-change logic removed). `render.js`/`filters.js`
unchanged. Tests: `tests/price-change.test.js`.

### Deferred (unchanged)
Inline Price Change columns inside the Excel Full Details export — standalone report covers this.

---

## [SUPERSEDED 2026-09-18] Price Change Indicator & Price History (baseline design)

> **This design was replaced the same day by the simplified per-SKU indicator model above.
> `pubSRP`/`pubDP`/`priceHistory`/baseline-only-publish are no longer used. Kept for history.**

## 2026-09-18 — Price Change Indicator & Price History (LIVE)

**Status: LIVE and verified in production.**

Automatic per-SKU price-change detection with a permanent, immutable price
history, on-card ↑/↓ indicators, an Admin "Price Changes" section, a
customer-facing filter, and a standalone Price Change Report.

### Production commits
- `52b3ce6` — detection, per-SKU history, card indicators, Admin Price Changes tab, customer filter (helpers.js p4, filters.js p5, render.js p11, admin.js p32, exports.js p9, github-save.js p7)
- `e04b78f` — styles.css p36 (card badges, filter select, Price Changes tab)
- `b31671a` — data/price-settings.json (indicator window default 30 days)
- `4747b6e` — index.html (customer filter in legend + cache-busters)

### Architecture — price history (no migration, no Worker change, backward-compatible)
Everything rides the existing `products.json` publish channel. Two optional
per-SKU fields, added lazily:

- `priceHistory[]` — immutable array of change entries:
  `{ type:'SRP'|'DP', prev, new, diff, pct, dir:'up'|'down', effectiveDate, dateChanged, user }`
- `pubSRP` / `pubDP` — the last **published** SRP/DP baseline for that SKU.

Rules:
- **SRP and DP are tracked independently** (separate baselines and entries).
- **History entries are immutable** — new changes append; existing entries are never overwritten or deleted.
- **Comparison is against the last *published* price** (`pubSRP`/`pubDP`), **not** draft edits. Detection runs at **Publish**, on the deep-copied products, then mirrors the price fields back to live `ALL_PRODUCTS` on success (same pattern as the image `rewrites`).
- The indicator-days setting persists to `data/price-settings.json` via the same `newImages` channel `promo.json` already uses (no Worker change).

>
> **ROLLOUT BASELINE (mandatory):** Price Change rollout baseline initialized before first bulk price update. Future price updates must compare against `pubSRP`/`pubDP` and must never silently reseed an existing baseline. Do a **baseline-only publish** (current prices, no edits) FIRST to seed baselines with 0 history; only then run the bulk price update. Never combine baseline initialization with the first real price change.

### First-publish rollout behavior (safe)
On the first publish after this feature shipped, existing SKUs have no
`pubSRP`/`pubDP`. Detection **initializes those baselines silently to the
current prices and creates NO price-history entries.** No false history for the
existing catalog. New SKUs behave the same — creation never generates history.

### Effective Date
- One editable Effective Date per publish batch (default = today / publish date), set in Admin → Price Changes.
- Applied to all changes recorded in that publish. Future-dating and back-dating are allowed (the label is metadata; the published price is always the current SRP/DP).

### Increase / decrease calculation
- `Price Difference = New − Previous`
- `Percentage Change = ((New − Previous) / Previous) × 100`, rounded to 2 decimals.
- `New > Previous` → increase (↑); `New < Previous` → decrease (↓); `New = Previous` → no record.
- If the previous price is 0/blank → baseline is set silently (no divide-by-zero, no record). If the new price is blank → skipped (baseline kept, no record).

### Customer-facing indicator
- On-card ↑/↓ badge with the % change (previous price shown small/strikethrough in the modal), for SRP and DP independently.
- **Default indicator duration = 30 days** from the Effective Date, admin-configurable.
- After the window expires the badge is removed from cards, **but the price history is NEVER deleted** — it remains permanent in Admin.

### Customer Price Changes filter (pricelist legend)
- Dropdown: **All prices / ↑ Price increased / ↓ Price decreased**.
- Composes with category and search; shows only SKUs with a recent (in-window) change of the chosen direction. "All prices" restores the full list.

### Admin → Price Changes section
- Rail item "Price Changes" (`#tab-pricechanges`).
- Table: SKU, Product, Type, Previous, New, Diff, % Change, Direction, Effective, Changed.
- Filters: **All / ↑ Increase / ↓ Decrease / SRP / DP**; search by **SKU or Product Name**.
- Settings: indicator-days (default 30) and Effective-date-for-next-publish.
- Button: **Export Price Change Report**.

### Standalone Price Change Report
- Own workbook (ExcelJS `.xlsx`, CSV fallback) — **does not touch the main pricelist exporters**, so existing Quick/Styled/Catalog PDF and Excel Data-Only/Full exports are unaffected.
- Columns: SKU, Product Name, Price Type, Previous Price, New Price, Difference, % Change, Effective Date, Date Changed.
- Filename: `Iontech-UGREEN-Price-Change-Report.xlsx` (version-free, per naming rules).

### Admin identity
- No per-user admin login exists (single admin PIN), so history records `user: "Admin"`.

### Edge cases validated
Previous price blank/null; previous 0; new price blank/null; newly created SKU; SKU deleted then recreated; price changed multiple times before publish (net change only); revert to previous value before publish (no record); SRP-only change; DP-only change; both change; back-to-previous across publishes (records a real reverse change); multiple historical changes per SKU; future-dated and back-dated effective dates.

### Automated validation
- Detection algorithm: **15/15** passing (against real product data).
- Indicator / expiry helpers: **14/14** passing.
- `node --check` clean on all changed JS; zero NUL bytes; working tree limited to the feature files.

### Files changed
`js/helpers.js` (p4), `js/filters.js` (p5), `js/render.js` (p11), `js/admin.js` (p32), `js/exports.js` (p9), `js/github-save.js` (p7), `css/styles.css` (p36), `index.html`, **new** `data/price-settings.json`.

### Deferred
- Optional inline Price Change columns (Previous SRP, SRP %, Previous DP, DP %, Price Effective Date) **inside the existing Excel Full Details export**. Deliberately deferred to avoid risk to the byte-sensitive shared exporter; the standalone Price Change Report covers this release.

### Remaining manual verification
- The Admin Price Changes UI (tab, settings, report button) sits behind the admin PIN — verified in code/wiring, not opened live.
- Full end-to-end will be validated on the **next genuine price change** (no test/fake price changes are to be recorded in the immutable history).

### Existing exports
No regression. The Price Change Report is standalone; the four existing exporters were untouched.
