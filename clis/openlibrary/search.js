// Open Library search — anonymous book discovery via the official Search API.
// API docs: https://openlibrary.org/dev/docs/api/search
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';

const SEARCH_URL = 'https://openlibrary.org/search.json';
const USER_AGENT = 'webcmd-openlibrary-adapter (+https://github.com/agentrhq/webcmd)';
const FIELDS = [
    'key', 'title', 'author_name', 'first_publish_year',
    'edition_count', 'isbn', 'language',
].join(',');

function requireQuery(value) {
    const query = String(value ?? '').trim();
    if (!query) throw new ArgumentError('openlibrary search query cannot be empty');
    return query;
}

function requireLimit(value) {
    const limit = value == null ? 10 : Number(value);
    if (!Number.isInteger(limit) || limit <= 0) {
        throw new ArgumentError('openlibrary search limit must be a positive integer');
    }
    if (limit > 50) throw new ArgumentError('openlibrary search limit must be <= 50');
    return limit;
}

async function openLibraryFetch(url) {
    let response;
    try {
        response = await fetch(url, {
            headers: { accept: 'application/json', 'user-agent': USER_AGENT },
        });
    } catch (error) {
        throw new CommandExecutionError(
            `openlibrary search request failed: ${error?.message ?? error}`,
            'Check that openlibrary.org is reachable from this network.',
        );
    }
    if (!response.ok) {
        throw new CommandExecutionError(`openlibrary search returned HTTP ${response.status}`);
    }
    try {
        return await response.json();
    } catch (error) {
        throw new CommandExecutionError(`openlibrary search returned malformed JSON: ${error?.message ?? error}`);
    }
}

cli({
    site: 'openlibrary',
    name: 'search',
    access: 'read',
    description: 'Search Open Library books by title, author, ISBN, or keyword',
    domain: 'openlibrary.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'query', positional: true, type: 'string', required: true, help: 'Book title, author, ISBN, or keyword' },
        { name: 'limit', type: 'int', default: 10, help: 'Max results (1-50)' },
    ],
    columns: [
        'rank', 'workId', 'title', 'authors', 'firstPublishYear',
        'editionCount', 'isbn', 'languages', 'url',
    ],
    func: async (args) => {
        const query = requireQuery(args.query);
        const limit = requireLimit(args.limit);
        const params = new URLSearchParams({ q: query, limit: String(limit), fields: FIELDS });
        const payload = await openLibraryFetch(`${SEARCH_URL}?${params}`);
        const docs = Array.isArray(payload?.docs) ? payload.docs : [];
        if (docs.length === 0) {
            throw new EmptyResultError('openlibrary search', `Open Library returned no books matching "${query}".`);
        }
        return docs.slice(0, limit).map((book, index) => {
            const key = typeof book?.key === 'string' ? book.key : '';
            const workId = key.replace(/^\/works\//, '');
            const isbns = Array.isArray(book?.isbn) ? book.isbn.map(String).filter(Boolean) : [];
            return {
                rank: index + 1,
                workId,
                title: String(book?.title ?? '').trim(),
                authors: Array.isArray(book?.author_name) ? book.author_name.filter(Boolean).join(', ') : '',
                firstPublishYear: Number.isFinite(Number(book?.first_publish_year)) ? Number(book.first_publish_year) : null,
                editionCount: Number.isFinite(Number(book?.edition_count)) ? Number(book.edition_count) : null,
                isbn: isbns.find(isbn => isbn.replace(/[^0-9X]/gi, '').length === 13) ?? isbns[0] ?? '',
                languages: Array.isArray(book?.language) ? book.language.filter(Boolean).join(', ') : '',
                url: workId ? `https://openlibrary.org/works/${encodeURIComponent(workId)}` : '',
            };
        });
    },
});
