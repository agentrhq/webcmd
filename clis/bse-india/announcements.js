import { EmptyResultError } from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { BSE_API, BSE_SITE, bseJson, requireLimit, text } from './utils.js';

function newsId(value) {
    return String(value ?? '').split('&')[0].trim();
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
        const body = await bseJson(`${BSE_API}/CorpAnn/w`, 'bse-india announcements');
        const rows = (Array.isArray(body) ? body : [])
            .filter((row) => !query || String(row?.Subject ?? '').toLowerCase().includes(query))
            .slice(0, limit);
        if (!rows.length) throw new EmptyResultError('bse-india announcements', query ? `No announcements matched "${args.query}".` : 'BSE returned no announcements.');
        return rows.map((row, i) => {
            const id = newsId(row?.Newsid);
            return {
                rank: i + 1,
                title: text(row?.Subject),
                newsId: id,
                url: id ? `${BSE_SITE}/corporates/anndet_new.aspx?newsid=${encodeURIComponent(id)}` : null,
            };
        });
    },
});
