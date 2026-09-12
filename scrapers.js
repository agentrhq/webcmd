export const getAggregatorScraper = (query) => `
  // Set real desktop viewport
  await page.setViewportSize({ width: 1280, height: 800 });

  try {
    await page.goto('https://www.google.com/search?tbm=shop&q=' + encodeURIComponent('${query}'), { 
      waitUntil: 'commit', 
      timeout: 15000 
    });
  } catch (e) {}

  // Handle EU/Global cookie consent if it appears
  try {
    const consentBtn = await page.$('button:has-text("Accept all"), button:has-text("I agree"), #L2AGLb');
    if (consentBtn) {
      await consentBtn.click();
      await new Promise(r => setTimeout(r, 1500));
    }
  } catch(e) {}

  // Wait briefly for network idle or products to render
  await new Promise(r => setTimeout(r, 4000));

  // Extract results using resilient generic selectors
  return await page.evaluate(() => {
    const items = [];
    // Google shopping cards across different regions & layouts
    const nodes = document.querySelectorAll('.sh-dgr__grid-result, .sh-dgr__content, .sh-pr__product-results > div, div[data-docid]');

    for (const el of nodes) {
      const titleEl = el.querySelector('h3, h4, .tAxDx, [role="heading"]');
      const priceEl = el.querySelector('.a8Pemb, .kHdaDu, span[aria-hidden="false"], .OFFP7b');
      const storeEl = el.querySelector('.aULzUe, .IuHnof, .eaLbx');
      const linkEl = el.querySelector('a');

      if (titleEl && priceEl) {
        const title = titleEl.innerText.trim();
        const rawPrice = priceEl.innerText.trim();
        const store = storeEl ? storeEl.innerText.trim() : 'Online Store';
        const href = linkEl ? linkEl.href : '';

        // Extract currency symbol
        const currencyMatch = rawPrice.match(/([₹$€£]|Rs\.?)/i);
        const currency = currencyMatch ? currencyMatch[0] : '$';

        // Extract float
        const priceNum = parseFloat(rawPrice.replace(/[^0-9.]/g, ''));

        if (!isNaN(priceNum) && priceNum > 5) {
          items.push({
            store,
            title,
            currency,
            price: priceNum,
            link: href
          });
        }
      }
    }
    return items;
  });
`;
