/**
 * Webcmd Deterministic Demo Server
 * Provides Version A (standard DOM) and Version B (mutated DOM)
 * to showcase Learn -> Replay -> Break -> Recover -> Remember.
 */

const http = require('http');

function renderVersionA() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>TechVault Store (Version A - Baseline)</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 20px; }
    .navbar { display: flex; justify-content: space-between; align-items: center; background: #1e293b; padding: 15px 25px; border-radius: 8px; margin-bottom: 30px; }
    .brand { font-size: 20px; font-weight: bold; color: #38bdf8; }
    .cart { background: #334155; padding: 8px 16px; border-radius: 6px; font-size: 14px; }
    .badge { background: #38bdf8; color: #0f172a; font-weight: bold; padding: 2px 8px; border-radius: 12px; margin-left: 6px; }
    .search-section { background: #1e293b; padding: 25px; border-radius: 8px; margin-bottom: 30px; text-align: center; }
    .input-search { padding: 12px 18px; width: 350px; border-radius: 6px; border: 1px solid #475569; background: #0f172a; color: white; font-size: 15px; }
    .btn-search { padding: 12px 22px; background: #38bdf8; color: #0f172a; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 15px; margin-left: 8px; }
    .product-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; }
    .product-card { background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 20px; }
    .product-title { font-size: 18px; font-weight: 600; margin-bottom: 8px; }
    .product-price { font-size: 20px; color: #38bdf8; font-weight: bold; margin-bottom: 15px; }
    .add-to-cart-btn { background: #22c55e; color: #0f172a; border: none; padding: 10px 18px; border-radius: 6px; font-weight: bold; cursor: pointer; width: 100%; font-size: 14px; }
    .hidden { display: none; }
  </style>
</head>
<body>
  <div class="navbar">
    <div class="brand">⚡ TechVault Store (v1.0)</div>
    <div class="cart">🛒 Cart: <span id="cart-badge" class="badge">0</span></div>
  </div>

  <div class="search-section">
    <h2>Search Products</h2>
    <form id="search-form" onsubmit="event.preventDefault(); document.getElementById('products-container').classList.remove('hidden');">
      <input type="text" id="search-input" class="input-search" placeholder="Search laptops..." />
      <button type="submit" id="search-btn" class="btn-search">Search</button>
    </form>
  </div>

  <div id="products-container" class="product-grid hidden">
    <div class="product-card" id="card-thinkpad">
      <div class="product-title">ThinkPad X1 Carbon Gen 12</div>
      <div class="product-price">$1,499.00</div>
      <button id="btn-add-thinkpad" class="add-to-cart-btn" data-product="thinkpad-x1" onclick="addToCart('thinkpad')">Add to Cart</button>
    </div>
  </div>

  <script>
    let cartCount = 0;
    function addToCart(item) {
      cartCount++;
      document.getElementById('cart-badge').innerText = cartCount;
    }
  </script>
</body>
</html>`;
}

function renderVersionB() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>TechVault Store (Version B - Mutated DOM)</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 20px; }
    .top-header { display: flex; justify-content: space-between; align-items: center; background: #1e293b; padding: 15px 25px; border-radius: 8px; margin-bottom: 30px; }
    .store-logo { font-size: 20px; font-weight: bold; color: #ec4899; }
    .basket-wrapper { background: #334155; padding: 8px 16px; border-radius: 6px; font-size: 14px; }
    .basket-counter { background: #ec4899; color: white; font-weight: bold; padding: 2px 8px; border-radius: 12px; margin-left: 6px; }
    .finder-panel { background: #1e293b; padding: 25px; border-radius: 8px; margin-bottom: 30px; text-align: center; }
    .txt-query { padding: 12px 18px; width: 350px; border-radius: 6px; border: 1px solid #475569; background: #0f172a; color: white; font-size: 15px; }
    .btn-find { padding: 12px 22px; background: #ec4899; color: white; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 15px; margin-left: 8px; }
    .items-container { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; }
    .item-card { background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 20px; }
    .item-name { font-size: 18px; font-weight: 600; margin-bottom: 8px; }
    .item-cost { font-size: 20px; color: #ec4899; font-weight: bold; margin-bottom: 15px; }
    .buy-action-btn { background: #ec4899; color: white; border: none; padding: 10px 18px; border-radius: 6px; font-weight: bold; cursor: pointer; width: 100%; font-size: 14px; }
    .hidden { display: none; }
  </style>
</head>
<body>
  <!-- MUTATED DOM: Classes renamed, IDs altered, but structure/semantics preserved -->
  <header class="top-header">
    <div class="store-logo">⚡ TechVault Store (v2.0 Redesign)</div>
    <div class="basket-wrapper">🛍️ Items: <span id="cart-badge" class="basket-counter">0</span></div>
  </header>

  <section class="finder-panel">
    <h2>Find Products</h2>
    <form id="finder-form" onsubmit="event.preventDefault(); document.getElementById('search-results-box').classList.remove('hidden');">
      <!-- Changed from #search-input to #product-query -->
      <input type="text" id="product-query" name="query" class="txt-query" placeholder="Search laptops..." />
      <!-- Changed from #search-btn to #btn-find and text 'Search' to 'Find' -->
      <button type="submit" id="btn-find" class="btn-find">Find</button>
    </form>
  </section>

  <div id="search-results-box" class="items-container hidden">
    <div class="item-card" id="item-thinkpad">
      <div class="item-name">ThinkPad X1 Carbon Gen 12</div>
      <div class="item-cost">$1,499.00</div>
      <!-- Changed from .add-to-cart-btn to .buy-action-btn -->
      <button id="btn-purchase-x1" class="buy-action-btn" data-product="thinkpad-x1" onclick="updateBasket()">Add to Cart</button>
    </div>
  </div>

  <script>
    let basketTotal = 0;
    function updateBasket() {
      basketTotal++;
      document.getElementById('cart-badge').innerText = basketTotal;
    }
  </script>
</body>
</html>`;
}

class DemoServer {
  constructor(port = 8089) {
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
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(renderVersionB());
        } else {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(renderVersionA());
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

module.exports = { DemoServer };
