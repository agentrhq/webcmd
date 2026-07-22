// gutenberg search — search Project Gutenberg's public eBook catalog.
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';
import {
    GUTENBERG_DOMAIN,
    GUTENBERG_ORIGIN,
    gutenbergFetch,
    requireLimit,
    requireQuery,
    textFromHtml,
} from './utils.js';

cli({
    site: 'gutenberg',
    name: 'search',
    access: 'read',
    description: 'Search Project Gutenberg eBooks by title, author, or keyword',
    domain: GUTENBERG_DOMAIN,
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'query', positional: true, required: true, help: 'Book title, author, or keyword' },
        { name: 'limit', type: 'int', default: 10, help: 'Max results (1-25)' },
    ],
    columns: ['rank', 'bookId', 'title', 'author', 'downloads', 'url'],
    func: async (args) => {
        const query = requireQuery(args.query);
        const limit = requireLimit(args.limit);
        const html = await gutenbergFetch(`/ebooks/search/?query=${encodeURIComponent(query)}`, 'gutenberg search');
        const books = [];
        const itemPattern = /<li\b[^>]*class=["'][^"']*\bbooklink\b[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi;
        let match;
        while ((match = itemPattern.exec(html)) !== null && books.length < limit) {
            const block = match[1];
            const href = block.match(/<a\b[^>]*href=["']\/ebooks\/(\d+)["'][^>]*>/i);
            const title = block.match(/<span\b[^>]*class=["'][^"']*\btitle\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
            if (!href || !title) continue;
            const author = block.match(/<span\b[^>]*class=["'][^"']*\bsubtitle\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
            const extra = block.match(/<span\b[^>]*class=["'][^"']*\bextra\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
            const downloadsMatch = textFromHtml(extra?.[1]).match(/([\d,]+)\s+downloads?/i);
            books.push({
                rank: books.length + 1,
                bookId: href[1],
                title: textFromHtml(title[1]),
                author: textFromHtml(author?.[1]),
                downloads: downloadsMatch ? Number(downloadsMatch[1].replace(/,/g, '')) : null,
                url: `${GUTENBERG_ORIGIN}/ebooks/${href[1]}`,
            });
        }
        if (!books.length && !/Displaying results\s+0|No (?:results|records) found/i.test(html)) {
            throw new CommandExecutionError('gutenberg search returned an unrecognized catalog page');
        }
        if (!books.length) {
            throw new EmptyResultError('gutenberg search', `No Project Gutenberg eBooks matched "${query}".`);
        }
        return books;
    },
});
