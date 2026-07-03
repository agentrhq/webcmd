import { ArgumentError, CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';

export const SITE = 'bookmyshow';
export const HOST = 'https://in.bookmyshow.com';
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 20;

const CITY_ALIASES = new Map([
    ['mumbai', { slug: 'mumbai', regionCode: 'MUMBAI' }],
    ['delhi', { slug: 'national-capital-region-ncr', regionCode: 'NCR' }],
    ['delhi ncr', { slug: 'national-capital-region-ncr', regionCode: 'NCR' }],
    ['ncr', { slug: 'national-capital-region-ncr', regionCode: 'NCR' }],
    ['national capital region ncr', { slug: 'national-capital-region-ncr', regionCode: 'NCR' }],
    ['bangalore', { slug: 'bengaluru', regionCode: 'BANG' }],
    ['bengaluru', { slug: 'bengaluru', regionCode: 'BANG' }],
    ['hyderabad', { slug: 'hyderabad', regionCode: 'HYD' }],
    ['chennai', { slug: 'chennai', regionCode: 'CHEN' }],
    ['pune', { slug: 'pune', regionCode: 'PUNE' }],
    ['kolkata', { slug: 'kolkata', regionCode: 'KOLK' }],
    ['ahmedabad', { slug: 'ahmedabad', regionCode: 'AHD' }],
    ['kochi', { slug: 'kochi', regionCode: 'KOCH' }],
]);

export function cleanText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function resolveCity(value = 'mumbai') {
    const raw = cleanText(value || 'mumbai').toLowerCase();
    if (!raw)
        throw new ArgumentError('bookmyshow --city cannot be empty', 'Example: webcmd bookmyshow movies --city mumbai');
    const known = CITY_ALIASES.get(raw);
    if (known)
        return { ...known };
    const slug = raw.replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!slug)
        throw new ArgumentError(`bookmyshow --city "${value}" is not valid`, 'Use a city name or BookMyShow city slug, for example: mumbai');
    return { slug, regionCode: slug.toUpperCase().replace(/-/g, '_') };
}

export function parseLimit(value, commandName) {
    const n = value == null || value === '' ? DEFAULT_LIMIT : Number(value);
    if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) {
        throw new ArgumentError(`${commandName} --limit must be an integer between 1 and ${MAX_LIMIT}`, `Example: webcmd ${commandName} --limit 5`);
    }
    return n;
}

export function parseDateCode(value) {
    if (value == null || value === '') {
        const d = new Date();
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${yyyy}${mm}${dd}`;
    }
    const raw = String(value).trim();
    if (!/^\d{8}$/.test(raw)) {
        throw new ArgumentError('bookmyshow shows --date must be in YYYYMMDD format', 'Example: webcmd bookmyshow shows alpha --city mumbai --date 20260703');
    }
    return raw;
}

export function parseMovieRef(value) {
    const raw = cleanText(value);
    const eventCode = raw.match(/ET\d{6,}/i)?.[0]?.toUpperCase() || '';
    let slug = '';
    try {
        const url = new URL(raw, HOST);
        const parts = url.pathname.split('/').filter(Boolean);
        const movieIndex = parts.indexOf('movies');
        if (movieIndex >= 0 && parts[movieIndex + 2])
            slug = parts[movieIndex + 2];
    }
    catch {
        slug = '';
    }
    return { eventCode, slug };
}

export function slugFromTitle(value) {
    return cleanText(value).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function requireRows(result, commandName) {
    if (!result || typeof result !== 'object') {
        throw new CommandExecutionError(`${commandName} page returned malformed extraction data`, 'BookMyShow may have changed the page structure.');
    }
    if (result.ok === false) {
        throw new CommandExecutionError(`${commandName} extraction failed: ${result.error || 'unknown error'}`, 'Open the same BookMyShow page in Chrome and retry.');
    }
    const rows = Array.isArray(result.rows) ? result.rows : [];
    if (!rows.length) {
        throw new EmptyResultError(commandName, 'No visible BookMyShow rows were found. Try another city or open the page in Chrome once.');
    }
    return rows;
}

export function addRankAndLimit(rows, limit, citySlug, url, mapRow) {
    return rows.slice(0, limit).map((row, index) => ({
        rank: index + 1,
        ...mapRow(row),
        city: citySlug,
        url: row.url || url,
    }));
}

export async function openAndExtract(page, url, extractScript, commandName) {
    await page.goto(url);
    await page.wait(2);
    return requireRows(await page.evaluate(extractScript), commandName);
}

export const __test__ = {
    cleanText,
    resolveCity,
    parseLimit,
    parseDateCode,
    parseMovieRef,
    slugFromTitle,
    requireRows,
};
