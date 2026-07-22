import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { HOST, ROOT_URL, loadHomepage, requireRows } from './utils.js';

function extractOverview(doc) {
    const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
    const tagline = clean(doc.querySelector('main h1')?.textContent);
    const paragraphs = Array.from(doc.querySelectorAll('main p')).map((node) => clean(node.textContent)).filter(Boolean);
    const description = paragraphs.find((text) => text.startsWith('Your AI can already think.'))
        || paragraphs.find((text) => text.startsWith('Unsora gives your AI assistant'))
        || null;
    const assistants = Array.from(doc.querySelectorAll('#agents h3'))
        .map((node) => clean(node.textContent))
        .filter(Boolean);
    const faqText = Array.from(doc.querySelectorAll('#faq p'))
        .map((node) => clean(node.textContent))
        .find((text) => text.startsWith('Unsora gives your AI assistant'));

    if (!tagline || !(description || faqText)) return { rows: [] };
    return {
        rows: [{
            name: 'Unsora',
            tagline,
            overview: faqText || description,
            assistants: assistants.join(', ') || null,
            website: ROOT_URL,
        }],
    };
}

cli({
    site: 'unsora',
    name: 'overview',
    access: 'read',
    description: 'Show what Unsora does from its public product page',
    domain: HOST,
    strategy: Strategy.UI,
    navigateBefore: false,
    columns: ['name', 'tagline', 'overview', 'assistants', 'website'],
    func: async (page) => {
        await loadHomepage(page);
        const result = await page.evaluate(`(() => {
          const extractOverview = ${extractOverview.toString()};
          return extractOverview(document);
        })()`);
        return requireRows(result, 'overview');
    },
});
