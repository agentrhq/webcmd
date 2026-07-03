import { AuthRequiredError, CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { BASE_URL, HOST, buildExtractStoresScript, parseLimit } from './utils.js';

cli({
    site: 'instacart',
    name: 'stores',
    access: 'read',
    description: 'Visible Instacart nearby stores from the public marketplace page',
    domain: HOST,
    strategy: Strategy.UI,
    siteSession: 'persistent',
    args: [
        { name: 'limit', type: 'int', default: 10, help: 'Maximum stores to return (1-30)' },
    ],
    columns: ['rank', 'slug', 'name', 'delivery', 'pickup', 'tags', 'url'],
    func: async (page, kwargs) => {
        const limit = parseLimit(kwargs.limit);
        await page.goto(BASE_URL, { waitUntil: 'load', settleMs: 2000 });
        await page.wait(2);
        const rows = await page.evaluate(buildExtractStoresScript(limit));
        if (!Array.isArray(rows)) {
            throw new CommandExecutionError('Instacart stores extraction returned an unreadable response');
        }
        const pageText = await page.evaluate('(() => String(document.body?.innerText || document.body?.textContent || "").slice(0, 2000))()');
        if (/log in to continue|sign up to continue|verify you are human|captcha/i.test(String(pageText))) {
            throw new AuthRequiredError(HOST, 'Instacart requires browser access. Open Instacart in CloakBrowser, clear any prompt, then rerun.');
        }
        if (!rows.length) {
            throw new EmptyResultError('instacart stores', 'No visible store cards were found. Instacart may need a location or changed its layout.');
        }
        return rows;
    },
});
