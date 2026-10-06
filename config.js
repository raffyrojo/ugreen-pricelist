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
  vero: {
    // VERO assistant. enabled=false hides it completely (kill switch).
    // aiEnabled must stay false in Phase 1 — no AI/API calls exist in this build.
    enabled: true,
    aiEnabled: false,      // Phase 2 AI (catalog). Stays false until the pilot is approved.
    webEnabled: false,     // Phase 2 web-verified answers. Stays false until the pilot is approved.
    aiEndpoint: ''         // https://ugreen-vero.<subdomain>.workers.dev — set when the Worker exists
  },
  data: {
    products: "data/products.json",
    categories: "data/categories.json",
    settings: "data/settings.json"
  }
};
