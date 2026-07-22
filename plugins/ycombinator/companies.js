import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';

const HOST = 'www.ycombinator.com';
const DIRECTORY_URL = `https://${HOST}/companies`;
const MAX_LIMIT = 40;

function normalizeText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function parseLimit(raw, fallback = 10) {
    if (raw === undefined || raw === null || raw === '') return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1 || value > MAX_LIMIT) {
        throw new ArgumentError(`--limit must be an integer between 1 and ${MAX_LIMIT}, got ${JSON.stringify(raw)}`);
    }
    return value;
}

function parseText(raw, label, maxLength, { optional = false } = {}) {
    const value = normalizeText(raw);
    if (!value && !optional) throw new ArgumentError(`${label} is required`);
    if (value.length > maxLength) throw new ArgumentError(`${label} must be at most ${maxLength} characters`);
    return value;
}

function buildDirectoryUrl({ query, batch, industry }) {
    const url = new URL(DIRECTORY_URL);
    const search = parseText(query, 'query', 200, { optional: true });
    const batchName = parseText(batch, '--batch', 100, { optional: true });
    const industryName = parseText(industry, '--industry', 100, { optional: true });
    if (search) url.searchParams.set('query', search);
    if (batchName) url.searchParams.set('batch', batchName);
    if (industryName) url.searchParams.set('industry', industryName);
    return url.href;
}

function extractCompaniesFromDocument(doc, limit = 10) {
    const bodyText = normalizeText(doc?.body?.textContent ?? '');
    const pageUrl = doc?.location?.href || doc?.URL || DIRECTORY_URL;
    if (/captcha|verify you are human|human verification|access denied|request blocked/i.test(`${pageUrl} ${bodyText.slice(0, 2000)}`)) {
        return { blocked: true, loading: false, rows: [] };
    }

    const rows = [];
    const seen = new Set();
    const cards = Array.from(doc.querySelectorAll('a[href^="/companies/"]'));
    for (const card of cards) {
        if (rows.length >= limit) break;
        const href = card.getAttribute('href') || '';
        if (!/^\/companies\/[^/?#]+\/?$/.test(href)) continue;
        const name = normalizeText(card.querySelector('[class*="_coName_"]')?.textContent);
        if (!name || seen.has(href)) continue;

        const descriptionNode = Array.from(card.querySelectorAll('div')).find((node) =>
            String(node.className || '').includes('mb-1.5') && node.querySelector('span')
        );
        const batchLink = card.querySelector('a[href*="batch="]');
        const industryLinks = Array.from(card.querySelectorAll('a[href*="industry="]'));
        let url = null;
        try {
            url = new URL(href, pageUrl).href;
        } catch {
            continue;
        }

        seen.add(href);
        rows.push({
            rank: rows.length + 1,
            name,
            batch: normalizeText(batchLink?.textContent) || null,
            location: normalizeText(card.querySelector('[class*="_coLocation_"]')?.textContent) || null,
            description: normalizeText(descriptionNode?.textContent) || null,
            industries: industryLinks.map((link) => normalizeText(link.textContent)).filter(Boolean).join(', ') || null,
            url,
        });
    }
    return {
        blocked: false,
        loading: /loading companies/i.test(bodyText),
        rows,
    };
}

function buildExtractScript(limit) {
    return `(() => {
      const extractCompaniesFromDocument = ${extractCompaniesFromDocument.toString()};
      const normalizeText = ${normalizeText.toString()};
      const DIRECTORY_URL = ${JSON.stringify(DIRECTORY_URL)};
      return extractCompaniesFromDocument(document, ${limit});
    })()`;
}

function buildRecentSortScript() {
    return `(() => {
      const select = document.querySelector('select');
      if (!select) return false;
      const option = Array.from(select.options).find((item) => /By_Launch_Date/i.test(item.value) || /Launch Date/i.test(item.textContent));
      if (!option) return false;
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`;
}

async function readCompaniesFromPage(page, limit, timeoutSeconds = 15) {
    let lastResult = null;
    for (let second = 0; second <= timeoutSeconds; second += 1) {
        const result = await page.evaluate(buildExtractScript(limit));
        if (result && typeof result === 'object') {
            lastResult = result;
            if (result.blocked || (Array.isArray(result.rows) && result.rows.length > 0) || result.loading === false) {
                return result;
            }
        }
        if (second < timeoutSeconds) await page.wait(1);
    }
    return lastResult;
}

cli({
    site: 'ycombinator',
    name: 'companies',
    access: 'read',
    description: 'Search the public Y Combinator startup directory',
    domain: HOST,
    strategy: Strategy.UI,
    navigateBefore: false,
    args: [
        { name: 'query', positional: true, required: false, help: 'Company name, product, or keyword such as AI' },
        { name: 'batch', help: 'Exact YC batch, for example Spring 2026' },
        { name: 'industry', help: 'Exact YC industry, for example B2B' },
        { name: 'recent', type: 'boolean', default: false, help: 'Sort matches by launch date, newest first' },
        { name: 'limit', type: 'int', default: 10, help: `Maximum companies to return (1-${MAX_LIMIT})` },
    ],
    columns: ['rank', 'name', 'batch', 'location', 'description', 'industries', 'url'],
    func: async (page, kwargs) => {
        const limit = parseLimit(kwargs.limit);
        const url = buildDirectoryUrl({
            query: kwargs.query,
            batch: kwargs.batch,
            industry: kwargs.industry,
        });

        await page.goto(url, { waitUntil: 'load', settleMs: 1000 });
        if (kwargs.recent) {
            const sorted = await page.evaluate(buildRecentSortScript());
            if (!sorted) throw new CommandExecutionError('Y Combinator launch-date sorting is unavailable');
            await page.wait(2);
        }

        const result = await readCompaniesFromPage(page, limit);
        if (!result || typeof result !== 'object') {
            throw new CommandExecutionError('Y Combinator company extraction returned an unreadable response');
        }
        if (result.blocked) {
            throw new AuthRequiredError(HOST, 'Y Combinator blocked anonymous directory access. Open the company directory in CloakBrowser, complete any verification, then rerun the command.');
        }
        const rows = Array.isArray(result.rows) ? result.rows : [];
        if (!rows.length) {
            throw new EmptyResultError('ycombinator companies', 'No public YC companies matched these filters.');
        }
        return rows;
    },
});
