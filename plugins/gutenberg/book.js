// gutenberg book — fetch public catalog metadata for one eBook.
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';
import {
    GUTENBERG_DOMAIN,
    GUTENBERG_ORIGIN,
    gutenbergFetch,
    requireBookId,
    textFromHtml,
} from './utils.js';

function parseMetadata(html) {
    const metadata = new Map();
    const rowPattern = /<tr\b[^>]*>[\s\S]*?<th\b[^>]*>([\s\S]*?)<\/th>[\s\S]*?<td\b[^>]*>([\s\S]*?)<\/td>[\s\S]*?<\/tr>/gi;
    let match;
    while ((match = rowPattern.exec(html)) !== null) {
        const key = textFromHtml(match[1]).replace(/:$/, '');
        const value = textFromHtml(match[2]);
        if (!key || !value) continue;
        const values = metadata.get(key) ?? [];
        values.push(value);
        metadata.set(key, values);
    }
    return metadata;
}

cli({
    site: 'gutenberg',
    name: 'book',
    access: 'read',
    description: 'Get Project Gutenberg eBook metadata and reading links by numeric id',
    domain: GUTENBERG_DOMAIN,
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'id', positional: true, required: true, help: 'Numeric eBook id or Gutenberg book URL (e.g. 1342)' },
    ],
    columns: [
        'bookId', 'title', 'author', 'language', 'subjects', 'releaseDate',
        'lastUpdate', 'copyright', 'downloads', 'htmlUrl', 'textUrl', 'epubUrl', 'url',
    ],
    func: async (args) => {
        const bookId = requireBookId(args.id);
        const html = await gutenbergFetch(`/ebooks/${bookId}`, 'gutenberg book');
        const metadata = parseMetadata(html);
        const returnedId = metadata.get('eBook-No.')?.[0] ?? '';
        if (!returnedId) {
            throw new EmptyResultError('gutenberg book', `Project Gutenberg returned no public metadata for eBook ${bookId}.`);
        }
        if (returnedId !== bookId) {
            throw new CommandExecutionError(`gutenberg book returned metadata for eBook ${returnedId} instead of ${bookId}`);
        }
        const downloadsText = metadata.get('Downloads')?.[0] ?? '';
        const downloadsMatch = downloadsText.match(/([\d,]+)\s+downloads?/i);
        return [{
            bookId,
            title: metadata.get('Title')?.[0] ?? '',
            author: (metadata.get('Author') ?? []).join(', '),
            language: (metadata.get('Language') ?? []).join(', '),
            subjects: (metadata.get('Subject') ?? []).join('; '),
            releaseDate: metadata.get('Release Date')?.[0] ?? '',
            lastUpdate: metadata.get('Last Update')?.[0] ?? '',
            copyright: metadata.get('Copyright')?.[0] ?? '',
            downloads: downloadsMatch ? Number(downloadsMatch[1].replace(/,/g, '')) : null,
            htmlUrl: `${GUTENBERG_ORIGIN}/cache/epub/${bookId}/pg${bookId}-images.html`,
            textUrl: `${GUTENBERG_ORIGIN}/ebooks/${bookId}.txt.utf-8`,
            epubUrl: `${GUTENBERG_ORIGIN}/ebooks/${bookId}.epub3.images`,
            url: `${GUTENBERG_ORIGIN}/ebooks/${bookId}`,
        }];
    },
});
