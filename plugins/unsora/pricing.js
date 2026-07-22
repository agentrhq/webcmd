import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { HOST, loadHomepage, requireRows } from './utils.js';

function extractPricing(doc) {
    const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
    const section = doc.querySelector('#pricing');
    const table = section?.querySelector('table');
    if (!table) return { rows: [] };

    const headers = Array.from(table.querySelectorAll('thead th, tr:first-child th')).slice(1);
    const creditsRow = Array.from(table.querySelectorAll('tr')).find((row) => /^Credits \/ month$/i.test(clean(row.querySelector('th, td')?.textContent)));
    const creditCells = creditsRow ? Array.from(creditsRow.querySelectorAll('th, td')).slice(1).map((cell) => clean(cell.textContent)) : [];
    const planLinks = Array.from(section.querySelectorAll('a[href*="plan="]'));

    const rows = headers.map((header, index) => {
        const text = clean(header.textContent);
        const priceMatch = text.match(/\$(\d+)\s*\/\s*mo/i);
        const plan = clean(text.replace(/MOST POPULAR|BEST VALUE/gi, '').replace(/\$\d+\s*\/\s*mo/i, ''));
        const link = planLinks.find((anchor) => new URL(anchor.href).searchParams.get('plan') === plan.toLowerCase());
        return {
            plan,
            priceUsdMonthly: priceMatch ? Number(priceMatch[1]) : null,
            creditsMonthly: creditCells[index] || null,
            freeTrial: '3 days',
            signupUrl: link?.href || null,
        };
    }).filter((row) => row.plan && row.priceUsdMonthly !== null);

    return { rows };
}

cli({
    site: 'unsora',
    name: 'pricing',
    access: 'read',
    description: 'Compare Unsora public plan prices and monthly credits',
    domain: HOST,
    strategy: Strategy.UI,
    navigateBefore: false,
    columns: ['plan', 'priceUsdMonthly', 'creditsMonthly', 'freeTrial', 'signupUrl'],
    func: async (page) => {
        await loadHomepage(page);
        const result = await page.evaluate(`(() => {
          const extractPricing = ${extractPricing.toString()};
          return extractPricing(document);
        })()`);
        return requireRows(result, 'pricing');
    },
});
