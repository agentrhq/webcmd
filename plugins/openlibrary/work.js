// openlibrary work — fetch one public work record by Open Library id.
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { EmptyResultError } from '@agentrhq/webcmd/errors';
import {
    OPENLIBRARY_DOMAIN,
    OPENLIBRARY_ORIGIN,
    joinFirst,
    openLibraryFetch,
    requireWorkId,
    textValue,
} from './utils.js';

cli({
    site: 'openlibrary',
    name: 'work',
    access: 'read',
    description: 'Get Open Library work details by OL work id',
    domain: OPENLIBRARY_DOMAIN,
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'id', positional: true, required: true, help: 'Work id or URL (e.g. OL27448W)' },
    ],
    columns: [
        'workId', 'title', 'authorIds', 'firstPublishDate', 'subjects',
        'description', 'coverUrl', 'links', 'lastModified', 'url',
    ],
    func: async (args) => {
        const workId = requireWorkId(args.id);
        const body = await openLibraryFetch(
            `${OPENLIBRARY_ORIGIN}/works/${workId}.json`,
            'openlibrary work',
        );
        if (!body?.key || !body?.title) {
            throw new EmptyResultError('openlibrary work', `Open Library returned no work for ${workId}.`);
        }

        const authorIds = Array.isArray(body.authors)
            ? body.authors
                .map((entry) => String(entry?.author?.key ?? entry?.key ?? '').replace(/^\/authors\//, '').trim())
                .filter(Boolean)
                .join(', ')
            : '';
        const coverId = Array.isArray(body.covers)
            ? body.covers.find((id) => Number.isInteger(id) && id > 0)
            : null;
        const links = Array.isArray(body.links)
            ? body.links.map((link) => String(link?.url ?? '').trim()).filter(Boolean).slice(0, 5).join(', ')
            : '';

        return [{
            workId,
            title: String(body.title).trim(),
            authorIds,
            firstPublishDate: String(body.first_publish_date ?? '').trim(),
            subjects: joinFirst(body.subjects, 12),
            description: textValue(body.description),
            coverUrl: coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg` : '',
            links,
            lastModified: String(body?.last_modified?.value ?? '').trim(),
            url: `${OPENLIBRARY_ORIGIN}/works/${workId}`,
        }];
    },
});
