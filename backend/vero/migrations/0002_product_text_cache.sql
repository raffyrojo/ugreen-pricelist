-- ugreen-vero D1 schema, migration 0002 (2026-10-06): AI-safe product-text cache.
-- Apply once in the Cloudflare D1 console after 0001. Safe to re-run (IF NOT EXISTS / upsert).
--
-- A DERIVED copy of the catalog, used only so /ask does not download the 1.7 MB data/products.json
-- (Workers Free: 10 ms CPU per request). data/products.json remains the single source of truth.
-- The Worker rebuilds all rows in one transaction when the catalog ETag changes (refreshProductCache).
--
-- One row per ENABLED product, only the fields VERO already allows near the model:
--   item_code, name, model, category, section, color, length, summary  -> as in the catalog
--   features, description -> stored in full; the prompt still gets <=400 / <=600 chars (productText),
--                            the full text is used only for the existing web/catalog routing check
--   version  -> catalog ETag the row was built from; rows are used only when it equals meta.catalog_version
-- NEVER stored: SRP, DP, DP Volume, Special DP, MOQ, stock, dealer data, assigned-SKU lists, credentials.

CREATE TABLE IF NOT EXISTS product_text (
  item_code   TEXT PRIMARY KEY,
  version     TEXT NOT NULL,
  name        TEXT NOT NULL,
  model       TEXT NOT NULL DEFAULT '',
  category    TEXT NOT NULL DEFAULT '',
  section     TEXT NOT NULL DEFAULT '',
  color       TEXT NOT NULL DEFAULT '',
  length      TEXT NOT NULL DEFAULT '',
  summary     TEXT NOT NULL DEFAULT '',
  features    TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_product_text_version ON product_text(version);

-- meta keys written by the Worker (not here):
--   catalog_version, catalog_checked_at (epoch ms), catalog_rows, catalog_refresh_try ("<etag>|<epoch ms>")
INSERT INTO meta (k, v) VALUES ('schema_version', '2') ON CONFLICT (k) DO UPDATE SET v = '2';
