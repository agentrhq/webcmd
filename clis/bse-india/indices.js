import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { BSE_API, BSE_SITE, bseJson, requireLimit, tableRows, text, toNumber } from './utils.js';

cli({
    site: 'bse-india',
    name: 'indices',
    access: 'read',
    description: 'BSE index snapshot, including Sensex and sector indices',
    domain: 'api.bseindia.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Max indices (1-100)' },
    ],
    columns: ['rank', 'code', 'name', 'alias', 'price', 'change', 'changePct', 'updateTime', 'url'],
    func: async (args) => {
        const limit = requireLimit(args.limit, 20, 100);
        const body = await bseJson(`${BSE_API}/IndexMovers/w`, 'bse-india indices');
        return tableRows(body, 'bse-india indices').slice(0, limit).map((row, i) => {
            const code = String(row?.code ?? '');
            return {
                rank: i + 1,
                code,
                name: text(row?.indexName),
                alias: text(row?.shortalias),
                price: toNumber(row?.LTP),
                change: toNumber(row?.change),
                changePct: toNumber(row?.PERCENTCHG),
                updateTime: text(row?.DT_TM),
                url: code ? `${BSE_SITE}/sensex/code/${code}` : null,
            };
        });
    },
});
