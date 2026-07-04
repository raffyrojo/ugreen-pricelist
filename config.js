/* UGREEN Pricelist CMS — configuration
   The ONLY file you normally edit. Everything else works automatically.
   Backend fields are used in Phase 5 (GitHub save); harmless until then. */
window.CONFIG = {
  github: {
    owner: "raffyrojo",
    repo: "ugreen-pricelist",
    branch: "main",
    productsPath: "data/products.json"
  },
  backend: {
    // Cloudflare Worker endpoint (deployed 2026-07-04).
    workerEndpoint: "https://ugreen-pricelist-cms.raffyortega-rojo.workers.dev"
  },
  data: {
    products: "data/products.json",
    categories: "data/categories.json",
    settings: "data/settings.json"
  }
};
