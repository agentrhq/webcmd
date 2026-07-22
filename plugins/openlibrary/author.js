// openlibrary author — fetch one public author record by Open Library id.
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { EmptyResultError } from '@agentrhq/webcmd/errors';
import {
    OPENLIBRARY_DOMAIN,
    OPENLIBRARY_ORIGIN,
    joinFirst,
    openLibraryFetch,
    requireAuthorId,
    textValue,
} from './utils.js';

cli({
    site: 'openlibrary',
    name: 'author',
    access: 'read',
    description: 'Get Open Library author details by OL author id',
    domain: OPENLIBRARY_DOMAIN,
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'id', positional: true, required: true, help: 'Author id or URL (e.g. OL26320A)' },
    ],
    columns: [
        'authorId', 'name', 'fullerName', 'birthDate', 'deathDate',
        'alternateNames', 'bio', 'photoUrl', 'wikidata', 'links', 'url',
    ],
    func: async (args) => {
        const authorId = requireAuthorId(args.id);
        const body = await openLibraryFetch(
            `${OPENLIBRARY_ORIGIN}/authors/${authorId}.json`,
            'openlibrary author',
        );
        if (!body?.key || !body?.name) {
            throw new EmptyResultError('openlibrary author', `Open Library returned no author for ${authorId}.`);
        }

        const photoId = Array.isArray(body.photos)
            ? body.photos.find((id) => Number.isInteger(id) && id > 0)
            : null;
        const links = Array.isArray(body.links)
            ? body.links.map((link) => String(link?.url ?? '').trim()).filter(Boolean).slice(0, 5).join(', ')
            : '';

        return [{
            authorId,
            name: String(body.name).trim(),
            fullerName: String(body.fuller_name ?? body.personal_name ?? '').trim(),
            birthDate: String(body.birth_date ?? '').trim(),
            deathDate: String(body.death_date ?? '').trim(),
            alternateNames: joinFirst(body.alternate_names, 8),
            bio: textValue(body.bio),
            photoUrl: photoId ? `https://covers.openlibrary.org/a/id/${photoId}-L.jpg` : '',
            wikidata: String(body?.remote_ids?.wikidata ?? '').trim(),
            links,
            url: `${OPENLIBRARY_ORIGIN}/authors/${authorId}`,
        }];
    },
});
