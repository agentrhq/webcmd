import { EmptyResultError } from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { BSE_API, BSE_SITE, bseJson, requireLimit, text } from './utils.js';

function newsId(value) {
    return String(value ?? '').split('&')[0].trim();
}

function announcementRows(body) {
    let value = body;
    if (typeof body === 'string') {
        try {
            value = JSON.parse(body);
        } catch {
            value = [];
        }
    }
    return Array.isArray(value) ? value : [];
}

function announcementTitle(row) {
    return text(row?.Subject ?? row?.NewsSubj);
}

async function companyNews(query) {
    const matches = await bseJson(`${BSE_API}/GetQuoteAllSearchDatabeta/w?searchString=${encodeURIComponent(query)}`, 'bse-india announcements company search');
    const rows = Array.isArray(matches) ? matches : [];
    const match = rows.find((row) => /Equity/i.test(String(row?.Type ?? '')));
    const code = String(match?.strSricpCode ?? '').trim();
    if (!code)
        return null;
    const body = await bseJson(`${BSE_API}/TabResults_PAR/w?scripcode=${encodeURIComponent(code)}&tabtype=NEWS`, 'bse-india announcements company news');
    return announcementRows(body);
}

cli({
    site: 'bse-india',
    name: 'announcements',
    access: 'read',
    description: 'Latest BSE corporate announcements, optionally filtered by text',
    domain: 'api.bseindia.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'query', type: 'string', default: '', help: 'Optional company/text filter' },
        { name: 'limit', type: 'int', default: 10, help: 'Max announcements (1-50)' },
    ],
    columns: ['rank', 'title', 'newsId', 'url'],
    func: async (args) => {
        const query = String(args.query ?? '').trim().toLowerCase();
        const limit = requireLimit(args.limit, 10, 50);
        const companyRows = query ? await companyNews(query) : null;
        const body = companyRows ? companyRows : announcementRows(await bseJson(`${BSE_API}/CorpAnn/w`, 'bse-india announcements'));
        const rows = body
            .filter((row) => companyRows || !query || String(row?.Subject ?? '').toLowerCase().includes(query))
            .slice(0, limit);
        if (!rows.length) throw new EmptyResultError('bse-india announcements', query ? `No announcements matched "${args.query}".` : 'BSE returned no announcements.');
        return rows.map((row, i) => {
            const id = newsId(row?.Newsid);
            return {
                rank: i + 1,
                title: announcementTitle(row),
                newsId: id,
                url: id ? `${BSE_SITE}/corporates/anndet_new.aspx?newsid=${encodeURIComponent(id)}` : null,
            };
        });
    },
});
