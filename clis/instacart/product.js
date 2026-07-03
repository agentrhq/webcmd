import { AuthRequiredError, CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { HOST, buildExtractProductDetailScript, buildProductUrl, gotoInstacartPage } from './utils.js';

cli({
    site: 'instacart',
    name: 'product',
    access: 'read',
    description: 'Visible Instacart product detail by product URL or id',
    domain: HOST,
    strategy: Strategy.UI,
    siteSession: 'persistent',
    args: [
        { name: 'product', positional: true, required: true, help: 'Instacart product URL or numeric product id' },
        { name: 'retailer', type: 'string', default: '', help: 'Retailer slug required when product is a numeric id, for example sprouts' },
    ],
    columns: ['productId', 'title', 'priceText', 'originalPriceText', 'discount', 'size', 'stock', 'retailer', 'url'],
    func: async (page, kwargs) => {
        const url = buildProductUrl(kwargs.product, kwargs.retailer);
        await gotoInstacartPage(page, url, 3000);
        await page.wait({ selector: 'h1', timeout: 8 }).catch(async () => {
            await page.wait(3);
        });
        const row = await page.evaluate(buildExtractProductDetailScript());
        if (!row || typeof row !== 'object') {
            throw new CommandExecutionError('Instacart product extraction returned an unreadable response');
        }
        const pageText = await page.evaluate('(() => String(document.body?.innerText || document.body?.textContent || "").slice(0, 2000))()');
        if (/log in to continue|sign up to continue|verify you are human|captcha/i.test(String(pageText))) {
            throw new AuthRequiredError(HOST, 'Instacart requires browser access. Open Instacart in CloakBrowser, clear any prompt, then rerun.');
        }
        if (!row.productId || !row.title || !row.priceText) {
            throw new EmptyResultError('instacart product', `No visible product detail was found at ${url}. Try a product URL from \`webcmd instacart storefront\` or \`webcmd instacart collection\`.`);
        }
        return [row];
    },
});
