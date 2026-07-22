// openlibrary search — search public Open Library book records.
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { EmptyResultError } from '@agentrhq/webcmd/errors';
import {
    OPENLIBRARY_DOMAIN,
    OPENLIBRARY_ORIGIN,
    joinFirst,
    openLibraryFetch,
    requireBoundedInt,
    requireString,
} from './utils.js';

cli({
    site: 'openlibrary',
    name: 'search',
    access: 'read',
    description: 'Search Open Library books by title, author, ISBN, or keyword',
    domain: OPENLIBRARY_DOMAIN,
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'query', positional: true, required: true, help: 'Book title, author, ISBN, or keyword' },
        { name: 'limit', type: 'int', default: 10, help: 'Max results (1-50)' },
    ],
    columns: [
        'rank', 'workId', 'title', 'authors', 'firstPublishYear',
        'editionCount', 'languages', 'isbn', 'coverUrl', 'url',
    ],
    func: async (args) => {
        const query = requireString(args.query, 'search query');
        const limit = requireBoundedInt(args.limit, 10, 50);
        const fields = [
            'key', 'title', 'author_name', 'first_publish_year', 'edition_count',
            'language', 'isbn', 'cover_i',
        ].join(',');
        const endpoint = `${OPENLIBRARY_ORIGIN}/search.json?q=${encodeURIComponent(query)}`
            + `&limit=${limit}&fields=${encodeURIComponent(fields)}`;
        const body = await openLibraryFetch(endpoint, 'openlibrary search');
        const docs = Array.isArray(body?.docs) ? body.docs : [];
        if (!docs.length) {
            throw new EmptyResultError('openlibrary search', `No Open Library books matched "${query}".`);
        }

        return docs.slice(0, limit).map((book, index) => {
            const workId = String(book?.key ?? '').replace(/^\/works\//, '').trim();
            const coverId = Number(book?.cover_i);
            return {
                rank: index + 1,
                workId,
                title: String(book?.title ?? '').trim(),
                authors: joinFirst(book?.author_name, 5),
                firstPublishYear: Number.isInteger(book?.first_publish_year) ? book.first_publish_year : null,
                editionCount: Number.isInteger(book?.edition_count) ? book.edition_count : null,
                languages: joinFirst(book?.language, 5),
                isbn: joinFirst(book?.isbn, 1),
                coverUrl: Number.isInteger(coverId) ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg` : '',
                url: workId ? `${OPENLIBRARY_ORIGIN}/works/${workId}` : '',
            };
        });
    },
});
