import { ArgumentError } from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { BSE_API, bseJson, requireLimit, tableRows, text, toNumber } from './utils.js';

const TYPES = {
    gainers: 'G',
    losers: 'L',
    turnover: 'T',
};

cli({
    site: 'bse-india',
    name: 'movers',
    access: 'read',
    description: 'BSE gainers, losers, or top turnover securities',
    domain: 'api.bseindia.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'type', type: 'string', default: 'gainers', help: 'gainers / losers / turnover' },
        { name: 'limit', type: 'int', default: 10, help: 'Max rows (1-10)' },
    ],
    columns: ['rank', 'code', 'symbol', 'name', 'price', 'change', 'changePct', 'turnoverCr', 'volume', 'url'],
    func: async (args) => {
        const type = String(args.type ?? 'gainers').trim().toLowerCase();
        const flag = TYPES[type];
        if (!flag) throw new ArgumentError(`Unknown bse-india movers type "${args.type}". Valid: gainers, losers, turnover`);
        const limit = requireLimit(args.limit, 10, 10);
        const body = await bseJson(`${BSE_API}/HoTurnover/w?flag=${flag}`, 'bse-india movers');
        return tableRows(body, 'bse-india movers').slice(0, limit).map((row, i) => ({
            rank: i + 1,
            code: String(row?.scrip_cd ?? row?.SCRIPCODE ?? ''),
            symbol: text(row?.scrip_id ?? row?.ScripName),
            name: text(row?.LONGNAME ?? row?.LONGNAME1 ?? row?.ScripName),
            price: toNumber(row?.Ltradert),
            change: toNumber(row?.change_val),
            changePct: toNumber(row?.change_percent),
            turnoverCr: toNumber(row?.Trd_val),
            volume: toNumber(row?.Trd_vol),
            url: text(row?.NSUrl),
        }));
    },
});
