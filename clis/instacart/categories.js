import { AuthRequiredError, CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { BASE_URL, HOST, buildExtractCollectionsScript, gotoInstacartPage, normalizeRetailer, parseLimit } from './utils.js';

cli({
    site: 'instacart',
    name: 'categories',
    access: 'read',
    description: 'Visible Instacart collection links for a retailer',
    domain: HOST,
    strategy: Strategy.UI,
    siteSession: 'persistent',
    args: [
        { name: 'retailer', positional: true, required: true, help: 'Retailer slug, for example sprouts or costco' },
        { name: 'limit', type: 'int', default: 10, help: 'Maximum collections to return (1-30)' },
    ],
    columns: ['rank', 'slug', 'name', 'url'],
    func: async (page, kwargs) => {
        const retailer = normalizeRetailer(kwargs.retailer);
        const limit = parseLimit(kwargs.limit);
        await gotoInstacartPage(page, `${BASE_URL}/store/${retailer}/storefront`, 2500);
        await page.wait({ selector: `a[href*="/store/${retailer}/collections/"]`, timeout: 8 }).catch(async () => {
            await page.wait(3);
        });
        const rows = await page.evaluate(buildExtractCollectionsScript(retailer, limit));
        if (!Array.isArray(rows)) {
            throw new CommandExecutionError('Instacart categories extraction returned an unreadable response');
        }
        const pageText = await page.evaluate('(() => String(document.body?.innerText || document.body?.textContent || "").slice(0, 2000))()');
        if (/log in to continue|sign up to continue|verify you are human|captcha/i.test(String(pageText))) {
            throw new AuthRequiredError(HOST, 'Instacart requires browser access. Open Instacart in CloakBrowser, clear any prompt, then rerun.');
        }
        if (!rows.length) {
            throw new EmptyResultError('instacart categories', `No visible collection links were found for retailer "${retailer}". Try a retailer from \`webcmd instacart stores\`.`);
        }
        return rows;
    },
});
