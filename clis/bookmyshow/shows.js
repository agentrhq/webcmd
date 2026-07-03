import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { ArgumentError, EmptyResultError } from '@agentrhq/webcmd/errors';
import { buildMoviesExtractScript } from './movies.js';
import {
    HOST,
    SITE,
    addRankAndLimit,
    cleanText,
    openAndExtract,
    parseDateCode,
    parseLimit,
    parseMovieRef,
    resolveCity,
    slugFromTitle,
} from './utils.js';

function movieMatches(row, query) {
    const q = cleanText(query).toLowerCase();
    if (!q)
        return false;
    return String(row.eventCode || '').toLowerCase() === q
        || cleanText(row.title).toLowerCase().includes(q)
        || slugFromTitle(row.title) === slugFromTitle(query);
}

export function buildShowsExtractScript(movieTitle, eventCode) {
    return `(() => {
    const movie = ${JSON.stringify(movieTitle)};
    const eventCode = ${JSON.stringify(eventCode)};
    const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
    const timeRe = /^\\d{1,2}:\\d{2}\\s?(?:AM|PM)$/i;
    const ignored = new Set([
      'Search for Movies, Events, Plays, Sports and Activities',
      'Movies', 'Stream', 'Events', 'Plays', 'Sports', 'Activities',
      'ListYourShow', 'Corporates', 'Offers', 'Gift Cards',
      'Price Range', 'Special Formats', 'Other Filters', 'Preferred Time',
      'Sort By', 'Late night shows', 'Early morning shows',
      'Cancellation available', 'Non-cancellable', 'Cinema servers are not reachable',
    ]);
    const lines = (document.body.innerText || '').split('\\n').map(clean).filter(Boolean);
    const rows = [];
    let cinema = '';
    let status = 'AVAILABLE';
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (line === 'AVAILABLE' || line === 'FAST FILLING') {
        status = line;
        continue;
      }
      if (ignored.has(line) || /^\\w{3}$/.test(line) || /^\\d{2}$/.test(line)) continue;
      if (timeRe.test(line)) {
        if (!cinema) continue;
        const next = lines[i + 1] || '';
        const format = next && !timeRe.test(next) && !ignored.has(next) && !next.includes(':') ? next : '';
        rows.push({
          movie,
          eventCode,
          cinema,
          showTime: line.toUpperCase(),
          format,
          status,
          url: location.href,
        });
        continue;
      }
      if (line.includes(':') && !timeRe.test(line) && !/^https?:/i.test(line)) {
        cinema = line;
      }
    }
    return { ok: true, rows };
  })()`;
}

export const command = cli({
    site: SITE,
    name: 'shows',
    access: 'read',
    description: 'BookMyShow movie showtimes in a city',
    example: 'webcmd bookmyshow shows alpha --city mumbai --limit 5',
    domain: 'in.bookmyshow.com',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'movie', type: 'string', required: true, positional: true, help: 'Movie title, event code, or BookMyShow movie URL' },
        { name: 'city', type: 'string', default: 'mumbai', help: 'BookMyShow city name or slug' },
        { name: 'date', type: 'string', help: 'Show date as YYYYMMDD; defaults to today' },
        { name: 'limit', type: 'int', default: 10, help: 'Number of showtimes to return (max 20)' },
    ],
    columns: ['rank', 'eventCode', 'movie', 'cinema', 'showTime', 'format', 'status', 'city', 'url'],
    func: async (page, kwargs) => {
        const city = resolveCity(kwargs.city);
        const limit = parseLimit(kwargs.limit, 'bookmyshow shows');
        const dateCode = parseDateCode(kwargs.date);
        const movieQuery = cleanText(kwargs.movie);
        if (!movieQuery) {
            throw new ArgumentError('bookmyshow shows requires a movie title, event code, or movie URL', 'Example: webcmd bookmyshow shows alpha --city mumbai');
        }

        const parsedRef = parseMovieRef(movieQuery);
        let match = null;
        const homeUrl = `${HOST}/explore/home/${city.slug}`;
        const movieRows = await openAndExtract(page, homeUrl, buildMoviesExtractScript(city.slug), 'bookmyshow movies');
        if (parsedRef.eventCode) {
            match = movieRows.find((row) => row.eventCode === parsedRef.eventCode) || {
                title: movieQuery,
                eventCode: parsedRef.eventCode,
                url: `${HOST}/movies/${city.slug}/${parsedRef.slug || slugFromTitle(movieQuery)}/${parsedRef.eventCode}`,
            };
        }
        else {
            match = movieRows.find((row) => movieMatches(row, movieQuery));
        }
        if (!match || !match.eventCode) {
            throw new EmptyResultError('bookmyshow shows', `No BookMyShow movie matched "${movieQuery}" in ${city.slug}. Try an event code from "bookmyshow movies --city ${city.slug}".`);
        }

        const slug = parsedRef.slug || slugFromTitle(match.title);
        const showUrl = `${HOST}/movies/${city.slug}/${slug}/buytickets/${match.eventCode}/${dateCode}`;
        const rows = await openAndExtract(page, showUrl, buildShowsExtractScript(match.title, match.eventCode), 'bookmyshow shows');
        return addRankAndLimit(rows, limit, city.slug, showUrl, (row) => ({
            eventCode: row.eventCode || match.eventCode,
            movie: row.movie || match.title,
            cinema: row.cinema || '',
            showTime: row.showTime || '',
            format: row.format || '',
            status: row.status || '',
        }));
    },
});

export const __test__ = {
    command,
    buildShowsExtractScript,
    movieMatches,
};
