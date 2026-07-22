// openlibrary search — search public Open Library work records by keyword.
//
// Hits `https://openlibrary.org/search.json` anonymously and returns stable work
// keys that round-trip into canonical Open Library work URLs.
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { EmptyResultError } from '@agentrhq/webcmd/errors';
import {
    OPENLIBRARY_BASE, joinList, normalizeWorkKey, openLibraryFetch, requireBoundedInt, requireString,
} from './utils.js';

cli({
    site: 'openlibrary',
    name: 'search',
    access: 'read',
    description: 'Search Open Library works by title, author, subject, or ISBN',
    domain: 'openlibrary.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'query', positional: true, type: 'string', required: true, help: 'Book title, author, subject, or ISBN to search for' },
        { name: 'limit', type: 'int', default: 20, help: 'Max works to return (1-100)' },
    ],
    columns: [
        'rank', 'workKey', 'title', 'authors', 'firstPublishYear', 'editionCount',
        'languages', 'subjects', 'isbn', 'url',
    ],
    func: async (args) => {
        const query = requireString(args.query, 'query');
        const limit = requireBoundedInt(args.limit, 20, 100);
        const url = `${OPENLIBRARY_BASE}/search.json?`
            + `q=${encodeURIComponent(query)}`
            + `&limit=${limit}`
            + '&fields=key,title,author_name,first_publish_year,edition_count,language,subject,isbn';
        const body = await openLibraryFetch(url, 'openlibrary search');
        const docs = Array.isArray(body?.docs) ? body.docs : [];
        if (docs.length === 0) {
            throw new EmptyResultError('openlibrary search', `No Open Library works matched "${query}".`);
        }
        const rows = docs.slice(0, limit).map((doc, i) => {
            const workKey = normalizeWorkKey(doc?.key);
            return {
                rank: i + 1,
                workKey,
                title: String(doc?.title ?? '').trim(),
                authors: joinList(doc?.author_name, 5),
                firstPublishYear: Number.isInteger(doc?.first_publish_year) ? doc.first_publish_year : null,
                editionCount: Number.isInteger(doc?.edition_count) ? doc.edition_count : null,
                languages: joinList(doc?.language, 5),
                subjects: joinList(doc?.subject, 5),
                isbn: Array.isArray(doc?.isbn) && doc.isbn.length > 0 ? String(doc.isbn[0]).trim() : '',
                url: workKey ? `${OPENLIBRARY_BASE}/works/${workKey}` : '',
            };
        });
        if (rows.length === 0) {
            throw new EmptyResultError('openlibrary search', `Open Library returned no usable works matching "${query}".`);
        }
        return rows;
    },
});
