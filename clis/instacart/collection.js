import { AuthRequiredError, CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { BASE_URL, HOST, buildExtractProductsScript, gotoInstacartPage, normalizeCollection, normalizeRetailer, parseLimit } from './utils.js';

async function ensureCollectionRoute(page, retailer, collection) {
    const path = `/store/${retailer}/collections/${collection}`;
    const currentUrl = await page.evaluate('window.location.href').catch(() => '');
    if (String(currentUrl).includes(path)) return;

    await gotoInstacartPage(page, `${BASE_URL}/store/${retailer}/storefront`, 2500);
    await page.wait({ selector: `a[href*="${path}"]`, timeout: 8 }).catch(async () => {
        await page.wait(3);
    });
    const clicked = await page.evaluate(`(() => {
      const path = ${JSON.stringify(path)};
      const link = Array.from(document.querySelectorAll('a[href*="/collections/"]')).find((node) => {
        try { return new URL(node.getAttribute('href') || '', location.href).pathname === path; } catch { return false; }
      });
      if (!link) return false;
      link.click();
      return true;
    })()`);
    if (clicked) {
        await page.wait(3);
    }
    const nextUrl = await page.evaluate('window.location.href').catch(() => '');
    if (!String(nextUrl).includes(path)) {
        throw new CommandExecutionError(`Instacart did not navigate to collection "${retailer}/${collection}"`);
    }
}

cli({
    site: 'instacart',
    name: 'collection',
    access: 'read',
    description: 'Visible Instacart product cards from a retailer collection',
    domain: HOST,
    strategy: Strategy.UI,
    siteSession: 'persistent',
    args: [
        { name: 'retailer', positional: true, required: true, help: 'Retailer slug, for example sprouts or costco' },
        { name: 'collection', positional: true, required: true, help: 'Collection slug, for example produce or fresh-fruits' },
        { name: 'limit', type: 'int', default: 10, help: 'Maximum products to return (1-30)' },
    ],
    columns: ['rank', 'productId', 'title', 'priceText', 'originalPriceText', 'discount', 'size', 'stock', 'url'],
    func: async (page, kwargs) => {
        const retailer = normalizeRetailer(kwargs.retailer);
        const collection = normalizeCollection(kwargs.collection);
        const limit = parseLimit(kwargs.limit);
        await gotoInstacartPage(page, `${BASE_URL}/store/${retailer}/collections/${collection}`, 2500);
        await ensureCollectionRoute(page, retailer, collection);
        await page.wait({ selector: 'a[href*="/products/"]', timeout: 8 }).catch(async () => {
            await page.wait(3);
        });
        const rows = await page.evaluate(buildExtractProductsScript(limit));
        if (!Array.isArray(rows)) {
            throw new CommandExecutionError('Instacart collection extraction returned an unreadable response');
        }
        const pageText = await page.evaluate('(() => String(document.body?.innerText || document.body?.textContent || "").slice(0, 2000))()');
        if (/log in to continue|sign up to continue|verify you are human|captcha/i.test(String(pageText))) {
            throw new AuthRequiredError(HOST, 'Instacart requires browser access. Open Instacart in CloakBrowser, clear any prompt, then rerun.');
        }
        if (!rows.length) {
            throw new EmptyResultError('instacart collection', `No visible product cards were found for "${retailer}/${collection}". Try a collection from \`webcmd instacart categories ${retailer}\`.`);
        }
        return rows;
    },
});
