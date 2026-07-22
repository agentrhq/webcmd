import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { HOST, loadHomepage, requireRows } from './utils.js';

function extractTools(doc) {
    const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
    const section = doc.querySelector('#tools');
    if (!section) return { rows: [] };

    const rows = [];
    let category = 'Create';
    for (const heading of section.querySelectorAll('h3, h4')) {
        const name = clean(heading.textContent);
        if (!name) continue;

        if (heading.tagName === 'H3' && !heading.closest('[role="button"]')) {
            category = name;
            continue;
        }

        const container = heading.tagName === 'H4' ? heading.parentElement?.parentElement : heading.parentElement;
        const description = clean(container?.querySelector('p')?.textContent);
        if (!description) continue;
        rows.push({ rank: rows.length + 1, category, name, description });
    }
    return { rows };
}

cli({
    site: 'unsora',
    name: 'tools',
    access: 'read',
    description: 'List Unsora creative tools from its public toolkit',
    domain: HOST,
    strategy: Strategy.UI,
    navigateBefore: false,
    columns: ['rank', 'category', 'name', 'description'],
    func: async (page) => {
        await loadHomepage(page);
        const result = await page.evaluate(`(() => {
          const extractTools = ${extractTools.toString()};
          return extractTools(document);
        })()`);
        return requireRows(result, 'tools');
    },
});
