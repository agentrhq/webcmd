import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';

const HOST = 'www.skyscanner.com';
const MAX_LIMIT = 30;

function normalizeText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function parseLimit(raw, fallback = 10) {
    if (raw === undefined || raw === null || raw === '') return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value)) {
        throw new ArgumentError(`--limit must be an integer between 1 and ${MAX_LIMIT}, got ${JSON.stringify(raw)}`);
    }
    if (value < 1 || value > MAX_LIMIT) {
        throw new ArgumentError(`--limit must be between 1 and ${MAX_LIMIT}, got ${value}`);
    }
    return value;
}

function normalizeRouteCode(raw, label) {
    const value = String(raw ?? '').trim().toLowerCase();
    if (!value) throw new ArgumentError(`${label} is required`);
    if (!/^[a-z0-9-]+$/.test(value)) {
        throw new ArgumentError(`${label} must be a Skyscanner route code like "nyca" or "lond"`);
    }
    return value;
}

function normalizeDate(raw, label) {
    const value = String(raw ?? '').trim();
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) throw new ArgumentError(`${label} must use YYYY-MM-DD format`);
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
        throw new ArgumentError(`${label} is not a valid calendar date`);
    }
    return `${String(year).slice(2)}${match[2]}${match[3]}`;
}

function buildFlightsUrl({ origin, destination, departDate, returnDate }) {
    const from = normalizeRouteCode(origin, 'origin');
    const to = normalizeRouteCode(destination, 'destination');
    const outbound = normalizeDate(departDate, '--depart-date');
    const inbound = normalizeDate(returnDate, '--return-date');
    return `https://${HOST}/transport/flights/${from}/${to}/${outbound}/${inbound}/`;
}

function absoluteUrl(href, baseUrl) {
    const value = String(href ?? '').trim();
    if (!value) return null;
    try {
        return new URL(value, baseUrl || 'https://www.skyscanner.com').href;
    } catch {
        return null;
    }
}

function unique(values) {
    const seen = new Set();
    const result = [];
    for (const value of values.map(normalizeText).filter(Boolean)) {
        if (seen.has(value)) continue;
        seen.add(value);
        result.push(value);
    }
    return result;
}

function squashRuns(values) {
    const result = [];
    for (const value of values.map(normalizeText).filter(Boolean)) {
        if (result[result.length - 1] === value) continue;
        result.push(value);
    }
    return result;
}

function extractFlightsFromDocument(doc, limit = 10) {
    const bodyText = normalizeText(doc?.body?.textContent ?? '');
    const pageUrl = doc?.location?.href || doc?.URL || 'https://www.skyscanner.com';
    if (/\/captcha(?:-|\/)|captcha|verify you are human|human verification|access to this page has been denied/i.test(`${pageUrl} ${bodyText.slice(0, 2000)}`)) {
        return { blocked: true, rows: [] };
    }

    const tickets = Array.from(doc.querySelectorAll('[data-testid="ticket"]'));
    const rows = [];
    for (const ticket of tickets) {
        if (rows.length >= limit) break;
        const text = normalizeText(ticket.textContent || '');
        const priceMatches = text.match(/\$[\d,]+(?:\.\d{2})?/g) || [];
        const priceText = priceMatches[priceMatches.length - 1] || null;
        const airlineAlts = Array.from(ticket.querySelectorAll('img[alt]')).map((img) => img.getAttribute('alt'));
        const airlines = unique(airlineAlts).join(', ') || null;
        const spanTexts = Array.from(ticket.querySelectorAll('span')).map((span) => normalizeText(span.textContent));
        const times = squashRuns(spanTexts.filter((value) => /^\d{1,2}:\d{2}\s*(AM|PM)$/i.test(value)));
        const airportCodes = squashRuns(spanTexts.filter((value) => /^[A-Z]{3}$/.test(value)));
        const durations = squashRuns(spanTexts.filter((value) => /^\d+h\s+\d{2}$/.test(value)));
        const stops = squashRuns(spanTexts.filter((value) => /^(Direct|1 stop|2\+ stops)$/i.test(value)));
        const link = ticket.closest('a[href]') || ticket.querySelector('a[href]');
        const url = absoluteUrl(link?.getAttribute('href'), pageUrl);

        if (!priceText || !airlines) continue;
        const row = {
            rank: 0,
            priceText,
            airlines,
            outboundTime: times[0] && times[1] ? `${times[0]}-${times[1]}` : null,
            outboundRoute: airportCodes.length >= 2 ? `${airportCodes[0]}-${airportCodes[1]}` : null,
            outboundDuration: durations[0] || null,
            outboundStops: stops[0] || null,
            returnTime: times[2] && times[3] ? `${times[2]}-${times[3]}` : null,
            returnRoute: airportCodes.length >= 4 ? `${airportCodes[2]}-${airportCodes[3]}` : (airportCodes.length >= 3 ? `${airportCodes[1]}-${airportCodes[2]}` : null),
            returnDuration: durations[1] || null,
            returnStops: stops[1] || stops[0] || null,
            url,
        };
        if (!row.outboundTime || !row.outboundRoute || !row.outboundDuration || !row.returnTime || !row.returnRoute || !row.returnDuration || !row.url) {
            continue;
        }
        row.rank = rows.length + 1;
        rows.push(row);
    }
    return { blocked: false, rows };
}

function buildExtractScript(limit) {
    return `(() => {
      const extractFlightsFromDocument = ${extractFlightsFromDocument.toString()};
      const normalizeText = ${normalizeText.toString()};
      const absoluteUrl = ${absoluteUrl.toString()};
      const unique = ${unique.toString()};
      const squashRuns = ${squashRuns.toString()};
      return extractFlightsFromDocument(document, ${limit});
    })()`;
}

async function readFlightsFromPage(page, limit, timeoutSeconds = 20) {
    let lastResult = null;
    for (let second = 0; second <= timeoutSeconds; second += 1) {
        const result = await page.evaluate(buildExtractScript(limit));
        if (result && typeof result === 'object') {
            lastResult = result;
            if (result.blocked || (Array.isArray(result.rows) && result.rows.length > 0)) {
                return result;
            }
        }
        if (second < timeoutSeconds) await page.wait(1);
    }
    return lastResult;
}

cli({
    site: 'skyscanner',
    name: 'flights',
    access: 'read',
    description: 'Skyscanner visible round-trip flight results from a warmed browser session',
    domain: HOST,
    strategy: Strategy.UI,
    navigateBefore: false,
    args: [
        { name: 'origin', positional: true, required: true, help: 'Skyscanner origin route code, for example nyca' },
        { name: 'destination', positional: true, required: true, help: 'Skyscanner destination route code, for example lond' },
        { name: 'depart-date', required: true, help: 'Outbound date as YYYY-MM-DD' },
        { name: 'return-date', required: true, help: 'Return date as YYYY-MM-DD' },
        { name: 'limit', type: 'int', default: 10, help: `Maximum flight rows to return (1-${MAX_LIMIT})` },
    ],
    columns: ['rank', 'priceText', 'airlines', 'outboundTime', 'outboundRoute', 'outboundDuration', 'outboundStops', 'returnTime', 'returnRoute', 'returnDuration', 'returnStops', 'url'],
    func: async (page, kwargs) => {
        const limit = parseLimit(kwargs.limit);
        const url = buildFlightsUrl({
            origin: kwargs.origin,
            destination: kwargs.destination,
            departDate: kwargs['depart-date'],
            returnDate: kwargs['return-date'],
        });

        await page.goto(url, { waitUntil: 'load', settleMs: 2000 });
        const result = await readFlightsFromPage(page, limit);
        if (!result || typeof result !== 'object') {
            throw new CommandExecutionError('Skyscanner flight extraction returned an unreadable response');
        }
        if (result.blocked) {
            throw new AuthRequiredError(HOST, 'Skyscanner requires browser verification. Open this route in CloakBrowser, solve the CAPTCHA, then rerun the command.');
        }
        const rows = Array.isArray(result.rows) ? result.rows : [];
        if (!rows.length) {
            throw new EmptyResultError('skyscanner flights', 'No visible flight cards were found. The page may still be loading, blocked, or Skyscanner changed its layout.');
        }
        return rows;
    },
});

export const __test__ = {
    buildFlightsUrl,
    extractFlightsFromDocument,
    parseLimit,
    readFlightsFromPage,
    squashRuns,
};
