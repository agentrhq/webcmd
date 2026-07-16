import { EmptyResultError, CommandExecutionError } from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { BASE_URL, HOST, coverUrl, getJson, parseLimit, requiredText, workUrl } from './common.js';

cli({
  site: 'openlibrary',
  name: 'search',
  access: 'read',
  description: 'Search Open Library books by title, author, ISBN, or keywords',
  domain: HOST,
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'query', positional: true, required: true, help: 'Book title, author, ISBN, or keywords' },
    { name: 'limit', type: 'int', default: 20, help: 'Maximum results to return (1-100)' },
  ],
  columns: ['title', 'workId', 'url', 'authors', 'firstPublishYear', 'editionCount', 'coverUrl'],
  func: async (args) => {
    const query = requiredText(args.query, 'query');
    const limit = parseLimit(args.limit);
    const url = new URL('/search.json', BASE_URL);
    url.searchParams.set('q', query);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('fields', 'key,title,author_name,first_publish_year,edition_count,cover_i');
    const data = await getJson(url, 'Open Library search');
    if (!Array.isArray(data?.docs)) {
      throw new CommandExecutionError('Open Library search returned an unexpected response shape');
    }
    if (!data.docs.length) throw new EmptyResultError('openlibrary search', `No books matched ${JSON.stringify(query)}`);
    return data.docs.map((book) => ({
      title: String(book.title ?? ''),
      workId: String(book.key ?? '').replace(/^\/works\//, ''),
      url: workUrl(book.key),
      authors: Array.isArray(book.author_name) ? book.author_name.join(', ') : null,
      firstPublishYear: Number.isInteger(book.first_publish_year) ? book.first_publish_year : null,
      editionCount: Number.isInteger(book.edition_count) ? book.edition_count : null,
      coverUrl: coverUrl(book.cover_i),
    }));
  },
});
