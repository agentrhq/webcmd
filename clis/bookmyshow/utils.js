// Shared helpers for the BookMyShow adapters.
//
// BookMyShow uses Cloudflare bot protection, so all API requests run inside the
// browser context via page.fetchJson(). The browser session carries valid
// cf_clearance cookies, bypassing the JS challenge that blocks bare Node fetch.
// Field accessors, response unwrappers, and the movie-listing factory live here
// so each command file stays thin and a BMS schema change is a single-line fix.
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import {
    ArgumentError,
    CommandExecutionError,
    EmptyResultError,
} from '@agentrhq/webcmd/errors';

export const BMS_BASE = 'https://in.bookmyshow.com';

// ─── Input Validators ───

export function requireString(value, label) {
    const s = String(value ?? '').trim();
    if (!s) throw new ArgumentError(`bookmyshow ${label} cannot be empty`);
    return s;
}

export function requireBoundedInt(value, defaultValue, min, max, label = 'limit') {
    const raw = value ?? defaultValue;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(n) || n < min) {
        throw new ArgumentError(`bookmyshow ${label} must be an integer >= ${min}`);
    }
    if (n > max) {
        throw new ArgumentError(`bookmyshow ${label} must be <= ${max}`);
    }
    return n;
}

const KNOWN_CITIES = new Set([
    'mumbai', 'delhi-ncr', 'bengaluru', 'hyderabad', 'ahmedabad',
    'chennai', 'pune', 'kolkata', 'kochi', 'jaipur', 'chandigarh',
    'lucknow', 'goa', 'indore', 'nagpur', 'visakhapatnam',
    'thiruvananthapuram', 'bhopal', 'coimbatore', 'vadodara',
]);

export function normalizeCity(value) {
    const raw = String(value ?? '').trim().toLowerCase().replace(/\s+/g, '-');
    if (!raw) {
        throw new ArgumentError(
            'bookmyshow city is required',
            'Pass a city slug such as "mumbai", "delhi-ncr", or "bengaluru".',
        );
    }
    return raw;
}

export function validateCity(value) {
    return normalizeCity(value);
}

// ─── Browser-Context Fetch ───
// Runs fetch() inside the browser page so Cloudflare sees a real Chrome session
// with valid cf_clearance cookies. page.fetchJson() handles JSON parsing, HTTP
// errors, and network failures — the adapter catches CliError to wrap with
// adapter-specific context when needed.

export async function bmsFetch(page, url, label) {
    try {
        const body = await page.fetchJson(url);

        // Validate response is an object, not null or primitive
        if (body == null || (typeof body !== 'object' && !Array.isArray(body))) {
            throw new CommandExecutionError(
                `${label} returned an unexpected response shape`,
                'BookMyShow may have changed their API. Expected a JSON object or array.',
            );
        }
        return body;
    } catch (err) {
        // Re-throw our own errors as-is
        if (err instanceof ArgumentError || err instanceof EmptyResultError || err instanceof CommandExecutionError) {
            throw err;
        }
        // Wrap framework CliError / unknown errors with adapter context
        const msg = err?.message ?? String(err);
        if (msg.includes('404') || msg.includes('Not Found')) {
            throw new EmptyResultError(label, `BookMyShow returned 404 for ${url}.`);
        }
        throw new CommandExecutionError(
            `${label} fetch failed: ${msg}`,
            'Check that in.bookmyshow.com is reachable and the browser session is active.',
        );
    }
}

// ─── SSR State Extraction ───
// BMS embeds page data in window.__INITIAL_STATE__.exploreApi.queries.
// Navigate to the page and extract the discovery data from the hydration state.
// This bypasses the need for a separate API endpoint.

export async function bmsDiscoverPage(page, pageUrl, label) {
    try {
        await page.goto(pageUrl);
    } catch (err) {
        throw new CommandExecutionError(
            `${label} navigation failed: ${err?.message ?? err}`,
            'Check that in.bookmyshow.com is reachable.',
        );
    }

    const raw = await page.evaluate(`(() => {
        const queries = window.__INITIAL_STATE__?.exploreApi?.queries;
        if (!queries) return JSON.stringify({ error: 'no SSR state' });
        const key = Object.keys(queries)[0];
        if (!key) return JSON.stringify({ error: 'no query key' });
        const data = queries[key]?.data;
        if (!data) return JSON.stringify({ error: 'no data' });
        return JSON.stringify(data);
    })()`);

    let data;
    try {
        data = JSON.parse(typeof raw === 'string' ? raw : JSON.stringify(raw));
    } catch {
        throw new CommandExecutionError(
            `${label} could not parse SSR state`,
            'BookMyShow may have changed their page structure.',
        );
    }

    if (data?.error) {
        throw new CommandExecutionError(`${label}: ${data.error}`);
    }
    return data;
}

// Extract movie cards from the SSR discover page listings.
// Cards live in data.listings[].cards[] — each card has analytics metadata
// with event_code, title, genre, language, and the text[] array has title,
// certification, and language rendered strings.
export function extractMovieCards(data) {
    const listings = data?.listings;
    if (!Array.isArray(listings)) return [];

    const cards = [];
    for (const listing of listings) {
        for (const card of (listing.cards ?? [])) {
            const analytics = card.analytics ?? {};
            const eventCode = analytics.event_code ?? '';
            // Skip non-movie cards (banners, promos)
            if (!eventCode || !eventCode.startsWith('ET')) continue;

            const textParts = (card.text ?? []).map(
                (t) => (t.components ?? []).map((c) => c.text ?? '').join(''),
            );

            cards.push({
                eventCode,
                title: analytics.title || textParts[0] || '',
                genre: analytics.genre || '',
                language: analytics.language || textParts[2] || '',
                certification: textParts[1] || '',
                url: card.ctaUrl || '',
            });
        }
    }
    return cards;
}

// ─── Text Cleaners ───

export function cleanText(value) {
    if (value == null) return '';
    return String(value).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

export function joinList(value) {
    return Array.isArray(value) ? value.filter(Boolean).join(', ') : '';
}

export function formatDuration(minutes) {
    const n = Number(minutes);
    if (!Number.isFinite(n) || n <= 0) return '';
    const h = Math.floor(n / 60);
    const m = n % 60;
    if (h > 0 && m > 0) return `${h}h ${m}m`;
    if (h > 0) return `${h}h`;
    return `${m}m`;
}

export function extractSlug(title) {
    return String(title ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
}

// ─── URL Builders ───

export function buildMovieUrl(city, slug, eventCode) {
    if (!slug || !eventCode) return '';
    return `${BMS_BASE}/${city}/movies/${slug}/${eventCode}`;
}

export function buildEventUrl(city, slug, eventCode) {
    if (!slug || !eventCode) return '';
    return `${BMS_BASE}/${city}/events/${slug}/${eventCode}`;
}

// ─── Provenance ───

export function buildProvenance(sourceUrl) {
    return {
        sourceUrl,
        fetchedAt: new Date().toISOString(),
    };
}

// ─── BMS Field Accessors ───
// Absorb BMS's inconsistent property names. When BMS renames a field, fix it
// once here instead of in every command file.

export function bmsTitle(item) {
    return cleanText(item.EventTitle ?? item.strEventTitle ?? item.Title ?? item.text ?? item.name ?? '');
}

export function bmsEventCode(item) {
    return String(item.EventCode ?? item.strEventCode ?? item.EventId ?? '');
}

export function bmsLanguage(item) {
    return cleanText(item.EventLanguage ?? item.strEventLanguage ?? item.Language ?? '');
}

export function bmsGenre(item) {
    return cleanText(item.EventGenre ?? item.strEventGenre ?? item.Genre ?? '');
}

export function bmsCertification(item) {
    return cleanText(item.EventCensor ?? item.strEventCensor ?? item.Certification ?? '');
}

export function bmsRating(item) {
    const raw = item.avgRating ?? item.fAvgRating ?? item.Rating ?? null;
    return raw != null ? Number(Number(raw).toFixed(1)) : null;
}

export function bmsVotes(item) {
    const raw = item.totalVotes ?? item.dwTotalVotes ?? item.Votes ?? null;
    return raw != null ? Number(raw) : null;
}

export function bmsDate(item) {
    return cleanText(item.EventDate ?? item.dtEventDate ?? item.ReleaseDate ?? item.ShowDate ?? '');
}

export function bmsCategory(item) {
    return cleanText(item.EventGroup ?? item.strEventGroup ?? item.Category ?? '');
}

export function bmsVenue(item) {
    return cleanText(item.VenueName ?? item.strVenueName ?? item.Venue ?? '');
}

export function bmsPrice(item) {
    const raw = cleanText(item.EventMinPrice ?? item.strEventMinPrice ?? item.Price ?? '');
    return raw ? Number(raw) : null;
}

export function bmsSynopsis(item) {
    return cleanText(item.EventSynopsis ?? item.strSynopsis ?? item.Synopsis ?? '');
}

// ─── Response Unwrapper ───
// BMS wraps arrays in several known shapes. This helper navigates the wrapper
// so command files don't need copy-pasted fallback chains.

export function unwrapBmsArray(body, wrapperKey, arrayKey = 'arrEvents') {
    const wrapper = wrapperKey ? body?.[wrapperKey] : body;
    const candidates = [
        wrapper?.BookMyShow?.[arrayKey],
        wrapper?.[arrayKey],
        body?.[arrayKey],
        body?.BookMyShow?.[arrayKey],
    ];
    for (const c of candidates) {
        if (Array.isArray(c) && c.length > 0) return c;
    }
    return Array.isArray(body) ? body : [];
}

// ─── Movie-Listing Factory ───
// movies.js and upcoming.js differ only in URL segment, description, and an
// optional set of extra columns. This factory captures the shared pattern.

export function makeMovieListingCommand({
    name,
    description,
    pageSlug,
    extraColumns = [],
    mapExtra = () => ({}),
}) {
    const baseColumns = ['rank', 'eventCode', 'title', 'language', 'genre', 'certification'];
    return {
        site: 'bookmyshow',
        name,
        access: 'read',
        description,
        domain: 'in.bookmyshow.com',
        strategy: Strategy.COOKIE,
        browser: true,
        args: [
            { name: 'city', positional: true, type: 'string', required: true, help: 'City slug (e.g. mumbai, delhi-ncr, bengaluru)' },
            { name: 'limit', type: 'int', default: 20, help: 'Max rows to return (1-100)' },
        ],
        columns: [...baseColumns, ...extraColumns, 'sourceUrl', 'fetchedAt', 'url'],
        func: async (page, args) => {
            const city = validateCity(args.city);
            const limit = requireBoundedInt(args.limit, 20, 1, 100, 'limit');

            const pageUrl = `${BMS_BASE}/explore/${pageSlug}-${city}`;
            const data = await bmsDiscoverPage(page, pageUrl, `bookmyshow ${name} ${city}`);
            const movies = extractMovieCards(data);

            if (movies.length === 0) {
                throw new EmptyResultError(
                    `bookmyshow ${name}`,
                    `No ${name} movies found for city "${city}".`,
                );
            }

            const provenance = buildProvenance(pageUrl);
            return movies.slice(0, limit).map((m, i) => ({
                rank: i + 1,
                eventCode: m.eventCode,
                title: m.title,
                language: m.language,
                genre: m.genre,
                certification: m.certification,
                ...mapExtra(m),
                ...provenance,
                url: m.url || `${BMS_BASE}/${city}/movies`,
            }));
        },
    };
}

// ─── Test Exports ───

export const __test__ = {
    requireString,
    requireBoundedInt,
    normalizeCity,
    validateCity,
    cleanText,
    joinList,
    formatDuration,
    extractSlug,
    buildMovieUrl,
    buildEventUrl,
    buildProvenance,
    bmsTitle,
    bmsEventCode,
    bmsLanguage,
    bmsGenre,
    bmsCertification,
    bmsRating,
    bmsVotes,
    bmsDate,
    bmsCategory,
    bmsVenue,
    bmsPrice,
    bmsSynopsis,
    unwrapBmsArray,
};
