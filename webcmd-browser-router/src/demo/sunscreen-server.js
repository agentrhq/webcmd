/**
 * Webcmd E-Commerce Demo Store: Sunscreen Catalog
 * Provides realistic Indian skincare product listings with Version A and Version B (Mutated DOM)
 * for testing multi-product extraction, filtering, comparison, and Scrapling adaptive recovery.
 */

const http = require('http');

const SUNSCREEN_CATALOG = [
  { id: 'p1', name: 'Minimalist Light Fluid Face Sunscreen SPF 50 PA++++', brand: 'Minimalist', price: 359, spf: 50, pa: 'PA++++', rating: 4.4, reviews: 12450, size: '50ml', skinType: 'All skin types' },
  { id: 'p2', name: 'Foxtale Glow Sunscreen SPF 50 PA++++', brand: 'Foxtale', price: 300, spf: 50, pa: 'PA++++', rating: 4.3, reviews: 8900, size: '50ml', skinType: 'Dull / Normal skin' },
  { id: 'p3', name: "Re'equil Ultra Matte Dry Touch Gel Sunscreen SPF 50", brand: "Re'equil", price: 311, spf: 50, pa: 'PA++++', rating: 4.4, reviews: 15200, size: '50g', skinType: 'Oily / Acne-prone' },
  { id: 'p4', name: 'Deconstruct Lightweight Gel Sunscreen SPF 55+', brand: 'Deconstruct', price: 349, spf: 55, pa: 'PA+++', rating: 4.2, reviews: 6700, size: '50g', skinType: 'Combination skin' },
  { id: 'p5', name: 'The Derma Co 1% Hyaluronic Sunscreen Aqua Gel SPF 50', brand: 'The Derma Co', price: 449, spf: 50, pa: 'PA++++', rating: 4.3, reviews: 18400, size: '50g', skinType: 'Dry / Dehydrated' },
  { id: 'p6', name: 'Neutrogena Ultra Sheer Dry Touch Sunblock SPF 50+', brand: 'Neutrogena', price: 470, spf: 50, pa: 'PA+++', rating: 4.2, reviews: 24500, size: '88ml', skinType: 'All skin types' },
  { id: 'p7', name: 'Dot & Key Watermelon Hyaluronic Cooling Sunscreen SPF 50', brand: 'Dot & Key', price: 395, spf: 50, pa: 'PA+++', rating: 4.1, reviews: 5400, size: '50g', skinType: 'Oily skin' },
  { id: 'p8', name: 'Aqualogica Radiance+ Dewy Sunscreen SPF 50+', brand: 'Aqualogica', price: 389, spf: 50, pa: 'PA++++', rating: 4.2, reviews: 9100, size: '50g', skinType: 'Normal to dry' },
  { id: 'p9', name: 'Blythe Matte Finish Sunscreen Gel SPF 50', brand: 'Blythe', price: 280, spf: 50, pa: 'PA+++', rating: 3.9, reviews: 1200, size: '50g', skinType: 'Oily skin' },
  { id: 'p10', name: 'Fixderma Shadow Sunscreen Gel SPF 30+', brand: 'Fixderma', price: 240, spf: 30, pa: 'PA+++', rating: 4.1, reviews: 4300, size: '40g', skinType: 'Sensitive skin' },
  { id: 'p11', name: 'Plum 2% Niacinamide & Rice Water Sunscreen SPF 50', brand: 'Plum', price: 360, spf: 50, pa: 'PA+++', rating: 4.2, reviews: 7800, size: '50g', skinType: 'Combination' },
  // Over-budget premium items (for testing price filter)
  { id: 'p12', name: 'La Roche-Posay Anthelios Ultra-Light Fluid SPF 50+', brand: 'La Roche-Posay', price: 1850, spf: 50, pa: 'PA++++', rating: 4.7, reviews: 31000, size: '50ml', skinType: 'Sensitive skin' },
  { id: 'p13', name: 'Isntree Hyaluronic Acid Watery Sun Gel SPF 50+', brand: 'Isntree', price: 1450, spf: 50, pa: 'PA++++', rating: 4.6, reviews: 14200, size: '50ml', skinType: 'All skin types' },
  { id: 'p14', name: 'Cetaphil Sun SPF 50+ Very High Protection Light Gel', brand: 'Cetaphil', price: 990, spf: 50, pa: 'PA++++', rating: 4.4, reviews: 8500, size: '50ml', skinType: 'Sensitive skin' }
];

function renderStoreVersionA() {
  const cardsHtml = SUNSCREEN_CATALOG.map(p => `
    <div class="product-card" id="card-${p.id}" data-id="${p.id}" data-price="${p.price}" data-spf="${p.spf}">
      <div class="product-brand">${p.brand}</div>
      <h3 class="product-title">${p.name}</h3>
      <div class="product-meta">
        <span class="spf-badge">SPF ${p.spf}</span>
        <span class="pa-badge">${p.pa}</span>
        <span class="size-text">${p.size}</span>
      </div>
      <div class="rating-row">
        <span class="rating-badge">★ ${p.rating}</span>
        <span class="reviews-count">(${p.reviews.toLocaleString()} reviews)</span>
      </div>
      <div class="price-row">
        <span class="currency">₹</span><span class="product-price">${p.price}</span>
      </div>
      <button class="add-to-cart-btn" data-id="${p.id}" onclick="viewProduct('${p.id}')">View Details</button>
    </div>
  `).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>NykaaVault Skincare Store (Version A - Baseline)</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0b0f19; color: #f1f5f9; margin: 0; padding: 25px; }
    .header { display: flex; justify-content: space-between; align-items: center; background: #1e293b; padding: 18px 30px; border-radius: 12px; margin-bottom: 25px; border: 1px solid #334155; }
    .logo { font-size: 22px; font-weight: 800; color: #f43f5e; letter-spacing: -0.5px; }
    .search-bar { background: #1e293b; padding: 20px; border-radius: 12px; margin-bottom: 30px; text-align: center; border: 1px solid #334155; }
    .search-input { width: 450px; padding: 12px 18px; border-radius: 8px; border: 1px solid #475569; background: #0f172a; color: white; font-size: 15px; }
    .search-btn { padding: 12px 24px; background: #f43f5e; color: white; border: none; border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 15px; margin-left: 10px; }
    .product-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); gap: 20px; }
    .product-card { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 20px; display: flex; flex-direction: column; justify-content: space-between; }
    .product-brand { font-size: 12px; font-weight: bold; color: #94a3b8; text-transform: uppercase; margin-bottom: 4px; }
    .product-title { font-size: 16px; font-weight: 600; margin: 0 0 10px 0; line-height: 1.35; color: #f8fafc; }
    .product-meta { display: flex; gap: 8px; margin-bottom: 12px; }
    .spf-badge { background: #0284c7; color: white; font-size: 11px; font-weight: bold; padding: 3px 8px; border-radius: 4px; }
    .pa-badge { background: #0d9488; color: white; font-size: 11px; font-weight: bold; padding: 3px 8px; border-radius: 4px; }
    .size-text { font-size: 12px; color: #94a3b8; align-self: center; }
    .rating-row { display: flex; align-items: center; gap: 6px; margin-bottom: 12px; }
    .rating-badge { background: #15803d; color: white; font-size: 12px; font-weight: bold; padding: 2px 8px; border-radius: 4px; }
    .reviews-count { font-size: 12px; color: #94a3b8; }
    .price-row { margin-bottom: 15px; }
    .currency { font-size: 16px; color: #f43f5e; font-weight: bold; }
    .product-price { font-size: 22px; font-weight: 800; color: #f43f5e; }
    .add-to-cart-btn { background: #3b82f6; color: white; border: none; padding: 10px; border-radius: 8px; font-weight: 600; cursor: pointer; width: 100%; font-size: 14px; }
    .hidden { display: none; }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo">🛍️ NykaaVault Skincare (v1.0 Baseline)</div>
    <div id="catalog-status">Catalog: <span id="total-count">${SUNSCREEN_CATALOG.length}</span> Sunscreens</div>
  </div>

  <div class="search-bar">
    <form id="store-search-form" onsubmit="event.preventDefault(); filterItems();">
      <input type="text" id="search-input" class="search-input" placeholder="Search sunscreen SPF 50..." value="sunscreen SPF 50" />
      <button type="submit" id="search-btn" class="search-btn">Search</button>
    </form>
  </div>

  <div id="product-catalog-grid" class="product-grid">
    ${cardsHtml}
  </div>

  <script>
    function filterItems() {
      // triggers search rendering
      document.getElementById('product-catalog-grid').classList.remove('hidden');
    }
    function viewProduct(id) {
      console.log('Viewing product', id);
    }
  </script>
</body>
</html>`;
}

function renderStoreVersionB() {
  // MUTATED DOM: renamed classes, altered IDs, redesigned structure
  const cardsHtml = SUNSCREEN_CATALOG.map(p => `
    <article class="item-tile" id="tile-${p.id}" data-item-id="${p.id}">
      <span class="brand-tag">${p.brand}</span>
      <h2 class="item-heading">${p.name}</h2>
      <div class="specifications-box">
        <span class="protection-chip">SPF ${p.spf}</span>
        <span class="pa-chip">${p.pa}</span>
        <span class="volume-label">${p.size}</span>
      </div>
      <div class="feedback-stats">
        <span class="user-score-pill">★ ${p.rating}</span>
        <span class="feedback-count">(${p.reviews.toLocaleString()} reviews)</span>
      </div>
      <div class="cost-container">
        <span class="rupee-symbol">₹</span><span class="current-amount">${p.price}</span>
      </div>
      <button class="inspect-product-action" data-item-id="${p.id}" onclick="inspectItem('${p.id}')">View Details</button>
    </article>
  `).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>NykaaVault Skincare Store (Version B - Redesigned Mutated DOM)</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0b0f19; color: #f1f5f9; margin: 0; padding: 25px; }
    .top-banner { display: flex; justify-content: space-between; align-items: center; background: #1e293b; padding: 18px 30px; border-radius: 12px; margin-bottom: 25px; border: 1px solid #334155; }
    .brand-mark { font-size: 22px; font-weight: 800; color: #ec4899; }
    .finder-section { background: #1e293b; padding: 20px; border-radius: 12px; margin-bottom: 30px; text-align: center; border: 1px solid #334155; }
    .txt-catalog-query { width: 450px; padding: 12px 18px; border-radius: 8px; border: 1px solid #475569; background: #0f172a; color: white; font-size: 15px; }
    .btn-catalog-search { padding: 12px 24px; background: #ec4899; color: white; border: none; border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 15px; margin-left: 10px; }
    .catalog-wrapper { display: grid; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); gap: 20px; }
    .item-tile { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 20px; display: flex; flex-direction: column; justify-content: space-between; }
    .brand-tag { font-size: 12px; font-weight: bold; color: #94a3b8; text-transform: uppercase; margin-bottom: 4px; }
    .item-heading { font-size: 16px; font-weight: 600; margin: 0 0 10px 0; line-height: 1.35; color: #f8fafc; }
    .specifications-box { display: flex; gap: 8px; margin-bottom: 12px; }
    .protection-chip { background: #6366f1; color: white; font-size: 11px; font-weight: bold; padding: 3px 8px; border-radius: 4px; }
    .pa-chip { background: #14b8a6; color: white; font-size: 11px; font-weight: bold; padding: 3px 8px; border-radius: 4px; }
    .volume-label { font-size: 12px; color: #94a3b8; align-self: center; }
    .feedback-stats { display: flex; align-items: center; gap: 6px; margin-bottom: 12px; }
    .user-score-pill { background: #16a34a; color: white; font-size: 12px; font-weight: bold; padding: 2px 8px; border-radius: 4px; }
    .feedback-count { font-size: 12px; color: #94a3b8; }
    .cost-container { margin-bottom: 15px; }
    .rupee-symbol { font-size: 16px; color: #ec4899; font-weight: bold; }
    .current-amount { font-size: 22px; font-weight: 800; color: #ec4899; }
    .inspect-product-action { background: #ec4899; color: white; border: none; padding: 10px; border-radius: 8px; font-weight: 600; cursor: pointer; width: 100%; font-size: 14px; }
  </style>
</head>
<body>
  <!-- MUTATED DOM: .product-card -> .item-tile, .product-price -> .current-amount, #search-input -> #catalog-query -->
  <header class="top-banner">
    <div class="brand-mark">🛍️ NykaaVault Skincare (v2.0 Redesign)</div>
    <div id="catalog-status">Catalog: <span id="total-count">${SUNSCREEN_CATALOG.length}</span> Sunscreens</div>
  </header>

  <section class="finder-section">
    <form id="finder-form" onsubmit="event.preventDefault();">
      <input type="text" id="catalog-query" name="query" class="txt-catalog-query" placeholder="Search sunscreen SPF 50..." value="sunscreen SPF 50" />
      <button type="submit" id="btn-find-catalog" class="btn-catalog-search">Find</button>
    </form>
  </section>

  <div id="catalog-wrapper" class="catalog-wrapper">
    ${cardsHtml}
  </div>

  <script>
    function inspectItem(id) {
      console.log('Inspecting item', id);
    }
  </script>
</body>
</html>`;
}

class SunscreenDemoServer {
  constructor(port = 8094) {
    this.port = port;
    this.server = null;
    this.currentVersion = 'a';
  }

  setVersion(version) {
    this.currentVersion = version.toLowerCase();
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        if (req.url === '/version-b' || (req.url === '/' && this.currentVersion === 'b')) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(renderStoreVersionB());
        } else {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(renderStoreVersionA());
        }
      });

      this.server.listen(this.port, () => {
        resolve(`http://127.0.0.1:${this.port}`);
      });

      this.server.on('error', reject);
    });
  }

  stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(resolve);
        this.server = null;
      } else {
        resolve();
      }
    });
  }
}

module.exports = { SunscreenDemoServer, SUNSCREEN_CATALOG };
