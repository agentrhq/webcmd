# DealPulse v2.0

**Autonomous Shopping & Market Spread Analyzer**

DealPulse is a web intelligence application designed to help users "Search once. Uncover the true market spread". The tool extracts verified product listings across various retail channels such as Amazon, Flipkart, and Croma, providing instant arbitrage analytics with zero API walls.

The system utilizes `webcmd` to fetch live search results and parses the data to extract pricing in Indian Rupees (₹, Rs., INR). To ensure accuracy, the analysis engine automatically filters out irrelevant accessories by rejecting listings that contain keywords like "case only", "cover", "cushion", or "earpad".

## Dashboard Interface

The modern web dashboard is hosted locally on `localhost:8080`. When a product query (e.g., "Iphone 16") is executed via the "Scan Deals" button, the UI presents key metrics:

* **Lowest Price (Optimal):** Highlights the best available deal on the market.
* **Peak Store Price (Market High):** Displays the highest recorded price among the analyzed retailers.
* **Total Savings (Spread):** Calculates the potential savings across the verified sources.
* **Actionable Checkout:** A dedicated section displays the verified cheapest listing with a direct "Go to Store" button.

## Project Structure & File Overview

* **`server.js`**: The primary Node.js/Express backend running on port 8080. It serves the static frontend from the `public` directory and exposes a `/api/analyze` POST endpoint. This endpoint executes the `webcmd` fetch command against DuckDuckGo, parses the HTML with Cheerio, filters the results, and returns the highest/lowest pricing data as JSON.


* **`analyzer.js`**: A command-line interface (CLI) script that performs the same DuckDuckGo scraping, parsing, and accessory-filtering logic as the backend. It outputs a formatted "Pricing Analysis Report" directly to the console.


* **`scrapers.js`**: Contains a `getAggregatorScraper` string designed to be evaluated within a browser automation context. It navigates to Google Shopping, handles cookie consent banners, and parses the dynamic DOM to extract product titles, prices, and links.


* **`test-server.js`**: A minimal Express application running on port 8080. It serves a simple `<h1>` tag stating "DealPulse Server is Running!" to verify port availability.


* **`debug.html`**: A raw HTML dump file containing the response from a Google Shopping search query. It currently shows a redirect/bot-verification page indicating that JavaScript execution is required to proceed.


* **`package.json` & `package-lock.json**`: Define the Node.js project (named `shopping-analyzer`), specify the ES module type, and lock the dependency versions for `cheerio` and `express`.


* **`.gitignore`**: Specifies files and directories that Git should not track, such as the `node_modules/` directory, `debug.html`, and `package-lock.json`.
