import { ArgumentError, CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';

const SEARCH_URL = 'https://images-api.nasa.gov/search';
const UA = 'webcmd-nasa-images-adapter (+https://github.com/agentrhq/webcmd)';

function requireQuery(value) {
    const query = String(value ?? '').trim();
    if (!query) throw new ArgumentError('nasa-images query is required');
    return query;
}

function intArg(value, defaultValue, maxValue, label) {
    const raw = value == null || value === '' ? defaultValue : value;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > maxValue) {
        throw new ArgumentError(`nasa-images ${label} must be an integer between 1 and ${maxValue}`);
    }
    return n;
}

function yearArg(value, label) {
    if (value == null || value === '') return null;
    const year = Number(value);
    if (!Number.isInteger(year) || year < 1900 || year > 2100) {
        throw new ArgumentError(`nasa-images ${label} must be a year between 1900 and 2100`);
    }
    return year;
}

async function fetchJson(url) {
    let resp;
    try {
        resp = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
    } catch (err) {
        throw new CommandExecutionError(`nasa-images search request failed: ${err?.message ?? err}`);
    }
    if (!resp.ok) {
        throw new CommandExecutionError(`nasa-images search returned HTTP ${resp.status}`);
    }
    try {
        return await resp.json();
    } catch (err) {
        throw new CommandExecutionError(`nasa-images search returned malformed JSON: ${err?.message ?? err}`);
    }
}

function firstData(item) {
    return Array.isArray(item?.data) && item.data.length ? item.data[0] : {};
}

function firstPreview(item) {
    const link = Array.isArray(item?.links) ? item.links.find((l) => l?.href) : null;
    return String(link?.href ?? '').trim();
}

function join(values, max = 5) {
    return Array.isArray(values) ? values.slice(0, max).filter(Boolean).join(', ') : '';
}

cli({
    site: 'nasa-images',
    name: 'search',
    access: 'read',
    description: 'Search NASA Images and Video Library media',
    domain: 'images-api.nasa.gov',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'query', positional: true, required: true, help: 'Search terms, e.g. "apollo 11"' },
        { name: 'media-type', default: 'image', choices: ['image', 'video', 'audio', 'all'], help: 'image, video, audio, or all' },
        { name: 'limit', type: 'int', default: 20, help: 'Max results (1-100)' },
        { name: 'page', type: 'int', default: 1, help: 'Result page (1-1000)' },
        { name: 'year-start', type: 'int', help: 'Filter start year, e.g. 1969' },
        { name: 'year-end', type: 'int', help: 'Filter end year, e.g. 1972' },
        { name: 'center', help: 'NASA center filter, e.g. JSC' },
    ],
    columns: ['rank', 'nasaId', 'title', 'mediaType', 'center', 'dateCreated', 'description', 'keywords', 'previewUrl', 'assetUrl', 'url'],
    func: async (args) => {
        const query = requireQuery(args.query);
        const limit = intArg(args.limit, 20, 100, 'limit');
        const page = intArg(args.page, 1, 1000, 'page');
        const yearStart = yearArg(args['year-start'], 'year-start');
        const yearEnd = yearArg(args['year-end'], 'year-end');
        const mediaType = String(args['media-type'] ?? 'image').trim();

        const url = new URL(SEARCH_URL);
        url.searchParams.set('q', query);
        url.searchParams.set('page_size', String(limit));
        url.searchParams.set('page', String(page));
        if (mediaType !== 'all') url.searchParams.set('media_type', mediaType);
        if (yearStart != null) url.searchParams.set('year_start', String(yearStart));
        if (yearEnd != null) url.searchParams.set('year_end', String(yearEnd));
        if (String(args.center ?? '').trim()) url.searchParams.set('center', String(args.center).trim());

        const body = await fetchJson(url);
        const items = Array.isArray(body?.collection?.items) ? body.collection.items : [];
        if (!items.length) {
            throw new EmptyResultError('nasa-images search', `No NASA media matched "${query}".`);
        }

        return items.slice(0, limit).map((item, i) => {
            const data = firstData(item);
            const nasaId = String(data.nasa_id ?? '').trim();
            return {
                rank: (page - 1) * limit + i + 1,
                nasaId,
                title: String(data.title ?? '').trim(),
                mediaType: String(data.media_type ?? '').trim(),
                center: String(data.center ?? '').trim(),
                dateCreated: String(data.date_created ?? '').trim(),
                description: String(data.description ?? '').trim(),
                keywords: join(data.keywords),
                previewUrl: firstPreview(item),
                assetUrl: nasaId ? `https://images-api.nasa.gov/asset/${encodeURIComponent(nasaId)}` : '',
                url: nasaId ? `https://images.nasa.gov/details/${encodeURIComponent(nasaId)}` : '',
            };
        });
    },
});
