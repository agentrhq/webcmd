import express from 'express';
import { execSync } from 'child_process';
import * as cheerio from 'cheerio';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 8080;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function runPriceAnalysis(query) {
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query + ' price buy online india')}`;
  
  let html = '';
  try {
    html = execSync(`webcmd web fetch --url "${searchUrl}" --raw`, {
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024 * 25
    });
  } catch (err) {
    throw new Error('Failed to fetch store data via webcmd.');
  }

  const $ = cheerio.load(html);
  const items = [];

  $('.result').each((_, el) => {
    const title = $(el).find('.result__title a').text().trim();
    const snippet = $(el).find('.result__snippet').text().trim();
    let link = $(el).find('.result__url').attr('href') || $(el).find('.result__title a').attr('href') || '';

    if (link.includes('uddg=')) {
      const match = link.match(/uddg=([^&]+)/);
      if (match) link = decodeURIComponent(match[1]);
    }

    let store = 'Verified Retailer';
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

    const priceMatch = `${title} ${snippet}`.match(/(?:₹|Rs\.?|INR)\s*([\d,]+(?:\.\d{2})?)/i);

    if (priceMatch && title) {
      const priceNum = parseFloat(priceMatch[1].replace(/,/g, ''));
      if (priceNum >= 500 && priceNum <= 1000000) {
        items.push({
          title,
          store,
          price: priceNum,
          link: link.startsWith('http') ? link : 'https://' + link
        });
      }
    }
  });

  const terms = query.toLowerCase().split(' ');
  const relevant = items.filter(item => {
    const t = item.title.toLowerCase();
    const isAcc = t.includes('case only') || t.includes('cover') || t.includes('cushion') || t.includes('earpad');
    return terms.every(k => t.includes(k)) && !isAcc;
  });

  const finalPool = relevant.length > 0 ? relevant : items;

  if (finalPool.length === 0) return null;

  finalPool.sort((a, b) => a.price - b.price);

  const lowest = finalPool[0];
  const highest = finalPool[finalPool.length - 1];

  return {
    query,
    totalAnalyzed: finalPool.length,
    lowest,
    highest,
    savings: highest.price - lowest.price,
    listings: finalPool
  };
}

app.post('/api/analyze', (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'Query parameter required' });

  try {
    const data = runPriceAnalysis(query);
    if (!data) return res.status(404).json({ error: 'No verifiable market prices found.' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 DealPulse Dashboard running at http://localhost:${PORT}`);
});
