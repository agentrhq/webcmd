import { execSync } from 'child_process';
import * as cheerio from 'cheerio';

async function analyzeProduct(query) {
  console.log(`\n🔍 Searching web for: "${query}"...`);

  // Target DuckDuckGo HTML endpoint (no JS execution or CAPTCHA walls required)
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query + ' price buy online india')}`;

  let html = '';
  try {
    console.log(`[1/1] Fetching live shopping results via webcmd...`);
    html = execSync(
      `webcmd web fetch --url "${searchUrl}" --raw`,
      { encoding: 'utf-8', maxBuffer: 1024 * 1024 * 25 }
    );
  } catch (err) {
    console.error("❌ Failed to fetch via webcmd.");
    return;
  }

  const $ = cheerio.load(html);
  const items = [];

  // Parse DuckDuckGo search result blocks
  $('.result').each((_, el) => {
    const title = $(el).find('.result__title a').text().trim();
    const snippet = $(el).find('.result__snippet').text().trim();
    let link = $(el).find('.result__url').attr('href') || $(el).find('.result__title a').attr('href') || '';

    // Unpack direct URL if redirected
    if (link.includes('uddg=')) {
      const match = link.match(/uddg=([^&]+)/);
      if (match) link = decodeURIComponent(match[1]);
    }

    const fullText = `${title} ${snippet}`;

    // Identify store from link domain
    let store = 'Online Retailer';
    if (link.includes('amazon.')) store = 'Amazon India';
    else if (link.includes('flipkart.')) store = 'Flipkart';
    else if (link.includes('croma.')) store = 'Croma';
    else if (link.includes('reliancedigital.')) store = 'Reliance Digital';
    else if (link.includes('tatacliq.')) store = 'Tata CLiQ';
    else if (link.includes('vijaysales.')) store = 'Vijay Sales';
    else {
      try {
        const domain = new URL(link.startsWith('http') ? link : `https://${link}`).hostname;
        store = domain.replace('www.', '');
      } catch {}
    }

    // Match INR price patterns: ₹ 24,990 or Rs. 26,990
    const priceMatch = fullText.match(/(?:₹|Rs\.?|INR)\s*([\d,]+(?:\.\d{2})?)/i);

    if (priceMatch && title) {
      const num = parseFloat(priceMatch[1].replace(/,/g, ''));
      // Filter out irrelevant low-priced accessories (< ₹1,000) or erroneous values
      if (num >= 1000 && num <= 500000) {
        items.push({
          title,
          store,
          price: num,
          link: link.startsWith('http') ? link : 'https://' + link
        });
      }
    }
  });

  // Filter out accessories (cases, ear pads, covers)
  const keywords = query.toLowerCase().split(' ');
  const relevant = items.filter(item => {
    const t = item.title.toLowerCase();
    const isAccessory = t.includes('case only') || t.includes('cover') || t.includes('cushion') || t.includes('earpad');
    return keywords.every(kw => t.includes(kw)) && !isAccessory;
  });

  const finalPool = relevant.length > 0 ? relevant : items;

  if (finalPool.length === 0) {
    console.log("\n❌ Could not find exact listings with clear prices. Try searching: 'Sony WH-1000XM5'");
    return;
  }

  // Sort by price ascending
  finalPool.sort((a, b) => a.price - b.price);

  const lowest = finalPool[0];
  const highest = finalPool[finalPool.length - 1];

  console.log("\n=======================================================");
  console.log(`               PRICING ANALYSIS REPORT                 `);
  console.log("=======================================================");
  console.log(`Product:           ${query}`);
  console.log(`Sources Found:     ${finalPool.length} verified sellers`);
  console.log("-------------------------------------------------------");
  console.log(`🟢 LOWEST PRICE:   ₹ ${lowest.price.toLocaleString('en-IN')}`);
  console.log(`   Seller:         ${lowest.store}`);
  console.log(`   Title:          ${lowest.title}`);
  console.log(`   Product Link:   ${lowest.link}`);
  console.log("-------------------------------------------------------");
  console.log(`🔴 HIGHEST PRICE:  ₹ ${highest.price.toLocaleString('en-IN')}`);
  console.log(`   Seller:         ${highest.store}`);
  console.log("=======================================================\n");
}

const userQuery = process.argv.slice(2).join(' ') || 'Sony WH-1000XM5';
analyzeProduct(userQuery);
