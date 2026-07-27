import {
    ArgumentError,
    AuthRequiredError,
    CommandExecutionError,
    EmptyResultError,
} from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';

const HOST = 'www.ycombinator.com';
const BASE_URL = `https://${HOST}`;
const COMPANY_PATH = /^\/companies\/([a-z0-9][a-z0-9-]*)\/?$/;

function normalizeCompanyUrl(raw) {
    const value = String(raw ?? '').trim();
    if (!value) throw new ArgumentError('company is required');

    let url;
    try {
        url = value.includes('://')
            ? new URL(value)
            : new URL(value.replace(/^\/+/, ''), `${BASE_URL}/companies/`);
    } catch {
        throw new ArgumentError('company must be a YC company slug or URL');
    }

    const match = url.pathname.match(COMPANY_PATH);
    if (url.protocol !== 'https:' || url.host !== HOST || !match) {
        throw new ArgumentError('company must be a YC company slug or URL');
    }
    return `${BASE_URL}/companies/${match[1]}`;
}

function normalizeText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function extractCompanyFromDocument(doc) {
    const bodyText = normalizeText(doc?.body?.textContent);
    const pageUrl = doc?.location?.href || BASE_URL;
    if (/captcha|verify you are human|access denied|request blocked/i.test(`${pageUrl} ${bodyText.slice(0, 2000)}`)) {
        return { blocked: true, notFound: false, malformed: false, row: null };
    }

    const root = doc.querySelector('[id^="ycdc_new/pages/Companies/ShowPage-react-component-"][data-page]');
    if (!root) {
        const notFound = /not found|does not exist/i.test(bodyText);
        return { blocked: false, notFound, malformed: !notFound, row: null };
    }

    let page;
    try {
        page = JSON.parse(root.getAttribute('data-page'));
    } catch {
        return { blocked: false, notFound: false, malformed: true, row: null };
    }

    const company = page?.props?.company;
    const slug = normalizeText(company?.slug);
    const name = normalizeText(company?.name);
    if (!company || !name || !COMPANY_PATH.test(`/companies/${slug}`)) {
        return { blocked: false, notFound: false, malformed: true, row: null };
    }

    return {
        blocked: false,
        notFound: false,
        malformed: false,
        row: {
            name,
            description: normalizeText(company.long_description || company.one_liner) || null,
            batch: normalizeText(company.batch_name) || null,
            status: normalizeText(company.ycdc_status) || null,
            location: normalizeText(company.location) || null,
            founded: Number.isInteger(company.year_founded) ? company.year_founded : null,
            teamSize: Number.isInteger(company.team_size) ? company.team_size : null,
            website: normalizeText(company.website) || null,
            founders: Array.isArray(company.founders)
                ? company.founders.map((founder) => normalizeText(founder?.full_name)).filter(Boolean).join(', ') || null
                : null,
            jobCount: Array.isArray(page.props.jobPostings) ? page.props.jobPostings.length : null,
            url: `${BASE_URL}/companies/${slug}`,
        },
    };
}

function buildExtractScript() {
    return `(() => {
      const BASE_URL = ${JSON.stringify(BASE_URL)};
      const COMPANY_PATH = ${COMPANY_PATH.toString()};
      const normalizeText = ${normalizeText.toString()};
      const extractCompanyFromDocument = ${extractCompanyFromDocument.toString()};
      return extractCompanyFromDocument(document);
    })()`;
}

cli({
    site: 'ycombinator',
    name: 'company',
    access: 'read',
    description: 'Read a public Y Combinator company profile',
    domain: HOST,
    strategy: Strategy.UI,
    navigateBefore: false,
    args: [
        { name: 'company', positional: true, required: true, help: 'YC company slug or full company URL' },
    ],
    columns: ['name', 'description', 'batch', 'status', 'location', 'founded', 'teamSize', 'website', 'founders', 'jobCount', 'url'],
    func: async (page, args) => {
        const url = normalizeCompanyUrl(args.company);
        await page.goto(url, { waitUntil: 'load', settleMs: 500 });
        const result = await page.evaluate(buildExtractScript());
        if (result?.blocked) {
            throw new AuthRequiredError(HOST, 'Y Combinator blocked anonymous company access.');
        }
        if (result?.notFound) {
            throw new EmptyResultError('ycombinator company', `No public YC company found at ${url}`);
        }
        if (!result || result.malformed || !result.row) {
            throw new CommandExecutionError('Y Combinator company page returned malformed profile state');
        }
        return [result.row];
    },
});

export const __test__ = { normalizeCompanyUrl, extractCompanyFromDocument };
