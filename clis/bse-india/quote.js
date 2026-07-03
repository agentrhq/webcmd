import { EmptyResultError } from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { BSE_API, bseJson, requireText, text, toNumber } from './utils.js';

async function findEquity(symbol) {
    const query = encodeURIComponent(symbol);
    const rows = await bseJson(`${BSE_API}/GetQuoteAllSearchDatabeta/w?searchString=${query}`, 'bse-india quote search');
    const matches = Array.isArray(rows) ? rows : [];
    const exact = matches.find((row) => String(row?.shortName ?? '').toUpperCase() === symbol.toUpperCase() && /Equity/i.test(String(row?.Type ?? '')));
    const fallback = matches.find((row) => /Equity/i.test(String(row?.Type ?? '')));
    const match = exact ?? fallback;
    if (!match) throw new EmptyResultError('bse-india quote', `No BSE equity matched "${symbol}".`);
    return match;
}

cli({
    site: 'bse-india',
    name: 'quote',
    access: 'read',
    description: 'BSE stock quote by symbol, company name, ISIN, or code',
    domain: 'api.bseindia.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'symbol', positional: true, required: true, help: 'BSE symbol, code, company name, or ISIN' },
    ],
    columns: ['code', 'symbol', 'name', 'isin', 'price', 'change', 'changePct', 'open', 'high', 'low', 'updateTime', 'url'],
    func: async (args) => {
        const symbol = requireText(args.symbol, 'quote symbol');
        const match = await findEquity(symbol);
        const code = String(match.strSricpCode ?? '').trim();
        const body = await bseJson(`${BSE_API}/getScripHeaderData/w?Debtflag=&scripcode=${encodeURIComponent(code)}&seriesid=`, 'bse-india quote');
        return [{
            code,
            symbol: text(match.shortName ?? body?.Cmpname?.ShortN),
            name: text(body?.Cmpname?.FullN ?? match.scripName),
            isin: text(match.Isin),
            price: toNumber(body?.CurrRate?.LTP ?? body?.Header?.LTP),
            change: toNumber(body?.CurrRate?.Chg),
            changePct: toNumber(body?.CurrRate?.PcChg),
            open: toNumber(body?.Header?.Open),
            high: toNumber(body?.Header?.High),
            low: toNumber(body?.Header?.Low),
            updateTime: text(body?.Header?.Ason),
            url: text(match.SEOUrl),
        }];
    },
});
