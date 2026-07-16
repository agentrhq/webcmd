import { ArgumentError, CommandExecutionError } from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { BASE_URL, HOST, coverUrl, getJson, requiredText, workUrl } from './common.js';

function normalizeWorkId(raw) {
  const value = requiredText(raw, 'work-id').replace(/^https?:\/\/openlibrary\.org\/works\//i, '').replace(/^\/works\//, '').replace(/\/$/, '');
  if (!/^OL\d+W$/i.test(value)) throw new ArgumentError('work-id must look like OL45883W');
  return value.toUpperCase();
}

function descriptionText(value) {
  if (typeof value === 'string') return value.trim() || null;
  if (value && typeof value.value === 'string') return value.value.trim() || null;
  return null;
}

cli({
  site: 'openlibrary',
  name: 'work',
  access: 'read',
  description: 'Get details for one Open Library work',
  domain: HOST,
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [{ name: 'work-id', positional: true, required: true, help: 'Open Library work ID, for example OL45883W' }],
  columns: ['title', 'workId', 'url', 'description', 'firstPublishDate', 'subjects', 'authorKeys', 'coverUrl'],
  func: async (args) => {
    const workId = normalizeWorkId(args['work-id']);
    const data = await getJson(new URL(`/works/${encodeURIComponent(workId)}.json`, BASE_URL), 'Open Library work lookup');
    if (!data || typeof data !== 'object' || Array.isArray(data) || !data.title) {
      throw new CommandExecutionError('Open Library work lookup returned an unexpected response shape');
    }
    const authorKeys = Array.isArray(data.authors)
      ? data.authors.map((entry) => entry?.author?.key).filter(Boolean).map((key) => key.replace(/^\/authors\//, ''))
      : [];
    return [{
      title: String(data.title),
      workId,
      url: workUrl(workId),
      description: descriptionText(data.description),
      firstPublishDate: typeof data.first_publish_date === 'string' ? data.first_publish_date : null,
      subjects: Array.isArray(data.subjects) ? data.subjects.join(', ') : null,
      authorKeys: authorKeys.length ? authorKeys.join(', ') : null,
      coverUrl: coverUrl(Array.isArray(data.covers) ? data.covers.find(Number.isInteger) : null, 'L'),
    }];
  },
});
