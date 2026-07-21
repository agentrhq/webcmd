// bookmyshow movie — get details for a specific movie by event code.
//
// Fetches detailed information about a single movie from BookMyShow, including
// cast, crew, synopsis, duration, and ratings. The event code (e.g. ET00412327)
// is obtained from the `bookmyshow movies` or `bookmyshow search` commands.
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { ArgumentError, EmptyResultError } from '@agentrhq/webcmd/errors';
import {
    BMS_BASE, bmsFetch, buildProvenance, cleanText, formatDuration, joinList,
    validateCity, bmsTitle, bmsLanguage, bmsGenre, bmsCertification,
    bmsRating, bmsVotes, bmsDate, bmsSynopsis,
} from './utils.js';

function requireEventCode(value) {
    const raw = String(value ?? '').trim().toUpperCase();
    if (!raw) {
        throw new ArgumentError(
            'bookmyshow event code is required',
            'Event codes look like "ET00412327". Get them from `bookmyshow movies` or `bookmyshow search`.',
        );
    }
    return raw;
}

function extractPeople(list) {
    if (!Array.isArray(list)) return '';
    return list
        .map((c) => cleanText(c.name ?? c.RoleName ?? ''))
        .filter(Boolean)
        .slice(0, 8)
        .join(', ');
}

function extractDirectors(crewList) {
    if (!Array.isArray(crewList)) return '';
    return crewList
        .filter((c) => String(c.role ?? c.RoleType ?? '').toLowerCase().includes('director'))
        .map((c) => cleanText(c.name ?? c.RoleName ?? ''))
        .filter(Boolean)
        .join(', ');
}

cli({
    site: 'bookmyshow',
    name: 'movie',
    access: 'read',
    description: 'Get movie details by event code from BookMyShow',
    domain: 'in.bookmyshow.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'code', positional: true, type: 'string', required: true, help: 'Movie event code (e.g. ET00412327)' },
        { name: 'city', type: 'string', default: 'mumbai', help: 'City slug for regional data (e.g. mumbai, delhi-ncr)' },
    ],
    columns: ['field', 'value'],
    func: async (page, args) => {
        const code = requireEventCode(args.code);
        const city = validateCity(args.city);

        const endpoint = `${BMS_BASE}/api/movies-data/movie-details/${code}/${city}`;
        const body = await bmsFetch(page, endpoint, `bookmyshow movie ${code}`);

        const movie = body?.movieData ?? body?.data ?? body?.movie ?? body ?? {};
        const title = bmsTitle(movie);

        if (!title) {
            throw new EmptyResultError(
                'bookmyshow movie',
                `No movie found with event code "${code}" in ${city}.`,
            );
        }

        const rating = bmsRating(movie);
        const votes = bmsVotes(movie);
        const provenance = buildProvenance(endpoint);

        const fields = {
            title,
            eventCode: code,
            language: bmsLanguage(movie),
            genre: bmsGenre(movie),
            certification: bmsCertification(movie),
            duration: formatDuration(movie.Length ?? movie.dwLength ?? movie.Duration ?? ''),
            releaseDate: bmsDate(movie),
            rating: rating != null ? String(rating) : '',
            votes: votes != null ? String(votes) : '',
            director: extractDirectors(movie.crew ?? movie.arrCrew ?? []),
            cast: extractPeople(movie.cast ?? movie.arrCast ?? []),
            synopsis: bmsSynopsis(movie),
            sourceUrl: provenance.sourceUrl,
            fetchedAt: provenance.fetchedAt,
            url: `${BMS_BASE}/${city}/movies/${code}`,
        };

        return Object.entries(fields)
            .filter(([, value]) => value !== '')
            .map(([field, value]) => ({ field, value }));
    },
});
