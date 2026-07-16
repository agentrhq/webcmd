import { EmptyResultError, CommandExecutionError } from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { BASE_URL, HOST, coverUrl, getJson, parseLimit, parseOffset, requiredText, workUrl } from './common.js';

cli({
  site: 'openlibrary',
  name: 'subject',
  access: 'read',
  description: 'Browse Open Library works in a subject',
  domain: HOST,
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'subject', positional: true, required: true, help: 'Subject slug, for example science_fiction' },
    { name: 'limit', type: 'int', default: 20, help: 'Maximum works to return (1-100)' },
    { name: 'offset', type: 'int', default: 0, help: 'Number of works to skip (0-10000)' },
  ],
  columns: ['title', 'workId', 'url', 'authors', 'firstPublishYear', 'editionCount', 'coverUrl'],
  func: async (args) => {
    const subject = requiredText(args.subject, 'subject').toLowerCase().replace(/\s+/g, '_');
    const limit = parseLimit(args.limit);
    const offset = parseOffset(args.offset);
    const url = new URL(`/subjects/${encodeURIComponent(subject)}.json`, BASE_URL);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(offset));
    const data = await getJson(url, 'Open Library subject browse');
    if (!Array.isArray(data?.works)) {
      throw new CommandExecutionError('Open Library subject browse returned an unexpected response shape');
    }
    if (!data.works.length) throw new EmptyResultError('openlibrary subject', `No works found for subject ${JSON.stringify(subject)}`);
    return data.works.map((work) => ({
      title: String(work.title ?? ''),
      workId: String(work.key ?? '').replace(/^\/works\//, ''),
      url: workUrl(work.key),
      authors: Array.isArray(work.authors) ? work.authors.map((author) => author?.name).filter(Boolean).join(', ') || null : null,
      firstPublishYear: Number.isInteger(work.first_publish_year) ? work.first_publish_year : null,
      editionCount: Number.isInteger(work.edition_count) ? work.edition_count : null,
      coverUrl: coverUrl(work.cover_id),
    }));
  },
});
