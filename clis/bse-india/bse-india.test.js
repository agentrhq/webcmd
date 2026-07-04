import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';
import { getRegistry } from '@agentrhq/webcmd/registry';
import './announcements.js';
import './indices.js';
import './movers.js';
import './quote.js';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

function json(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

describe('bse-india indices', () => {
    const cmd = getRegistry().get('bse-india/indices');

    it('maps index rows', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ Table: [{
            indexName: 'BSE SENSEX',
            LTP: 77782.46,
            change: 280.34,
            PERCENTCHG: 0.36,
            DT_TM: '2026-07-03T15:00:46',
            code: 16,
            shortalias: 'SENSEX',
        }] })));

        await expect(cmd.func({ limit: 1 })).resolves.toEqual([{
            rank: 1,
            code: '16',
            name: 'BSE SENSEX',
            alias: 'SENSEX',
            price: 77782.46,
            change: 280.34,
            changePct: 0.36,
            updateTime: '2026-07-03T15:00:46',
            url: 'https://www.bseindia.com/sensex/code/16',
        }]);
    });

    it('rejects invalid limits', async () => {
        vi.stubGlobal('fetch', vi.fn());
        await expect(cmd.func({ limit: 0 })).rejects.toBeInstanceOf(ArgumentError);
        await expect(cmd.func({ limit: 101 })).rejects.toBeInstanceOf(ArgumentError);
        expect(fetch).not.toHaveBeenCalled();
    });
});

describe('bse-india movers', () => {
    const cmd = getRegistry().get('bse-india/movers');

    it('maps gainers', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ Table: [{
            ScripName: 'HCLTECH',
            LONGNAME: 'HCL Technologies Ltd',
            Ltradert: 1141.85,
            change_val: 64.35,
            change_percent: 5.97,
            Trd_val: 120.5,
            Trd_vol: 25000,
            scrip_id: 'HCLTECH',
            scrip_cd: 532281,
            NSUrl: 'https://www.bseindia.com/stock-share-price/hcl-technologies-ltd/hcltech/532281/',
        }] })));

        await expect(cmd.func({ type: 'gainers', limit: 1 })).resolves.toEqual([{
            rank: 1,
            code: '532281',
            symbol: 'HCLTECH',
            name: 'HCL Technologies Ltd',
            price: 1141.85,
            change: 64.35,
            changePct: 5.97,
            turnoverCr: 120.5,
            volume: 25000,
            url: 'https://www.bseindia.com/stock-share-price/hcl-technologies-ltd/hcltech/532281/',
        }]);
    });

    it('rejects unknown mover types', async () => {
        await expect(cmd.func({ type: 'active' })).rejects.toBeInstanceOf(ArgumentError);
    });
});

describe('bse-india announcements', () => {
    const cmd = getRegistry().get('bse-india/announcements');

    it('maps latest corporate announcements', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json([
            { Subject: 'Reliance Industries Ltd - Board Meeting', Newsid: 'abc&flag=1' },
            { Subject: 'Other company update', Newsid: 'def&flag=1' },
        ])));

        await expect(cmd.func({ limit: 1 })).resolves.toEqual([{
            rank: 1,
            title: 'Reliance Industries Ltd - Board Meeting',
            newsId: 'abc',
            url: 'https://www.bseindia.com/corporates/anndet_new.aspx?newsid=abc',
        }]);
    });

    it('uses company search for announcement queries', async () => {
        vi.stubGlobal('fetch', vi.fn()
            .mockResolvedValueOnce(json([{
                strSricpCode: '500325',
                shortName: 'RELIANCE',
                scripName: 'Reliance Industries Ltd',
                Type: 'in Equity T+1',
            }]))
            .mockResolvedValueOnce(json(JSON.stringify([
                { NewsSubj: 'Announcement under Regulation 30 (LODR)-Credit Rating', Newsid: 'abc&flag=1' },
            ]))));

        await expect(cmd.func({ query: 'reliance', limit: 5 })).resolves.toEqual([{
            rank: 1,
            title: 'Announcement under Regulation 30 (LODR)-Credit Rating',
            newsId: 'abc',
            url: 'https://www.bseindia.com/corporates/anndet_new.aspx?newsid=abc',
        }]);
        expect(fetch).toHaveBeenNthCalledWith(
            1,
            'https://api.bseindia.com/BseIndiaAPI/api/GetQuoteAllSearchDatabeta/w?searchString=reliance',
            expect.any(Object),
        );
        expect(fetch).toHaveBeenNthCalledWith(
            2,
            'https://api.bseindia.com/BseIndiaAPI/api/TabResults_PAR/w?scripcode=500325&tabtype=NEWS',
            expect.any(Object),
        );
    });

    it('throws EmptyResultError when filtering removes all announcements', async () => {
        vi.stubGlobal('fetch', vi.fn()
            .mockResolvedValueOnce(json([]))
            .mockResolvedValueOnce(json([{ Subject: 'Other', Newsid: 'def' }])));
        await expect(cmd.func({ query: 'missing', limit: 5 })).rejects.toBeInstanceOf(EmptyResultError);
    });
});

describe('bse-india quote', () => {
    const cmd = getRegistry().get('bse-india/quote');

    it('searches by symbol and maps quote details', async () => {
        vi.stubGlobal('fetch', vi.fn()
            .mockResolvedValueOnce(json([{
                strSricpCode: '500325',
                shortName: 'RELIANCE',
                scripName: 'Reliance Industries Ltd',
                Isin: 'INE002A01018',
                SEOUrl: 'https://www.bseindia.com/stock-share-price/reliance-industries-ltd/reliance/500325/',
                Type: 'in Equity T+1',
            }]))
            .mockResolvedValueOnce(json({
                CurrRate: { LTP: '1304.55', Chg: '+0.75', PcChg: '+0.06' },
                Cmpname: { FullN: 'Reliance Industries Ltd', ShortN: 'RELIANCE', SeriesN: 'A' },
                Header: { PrevClose: '1303.80', Open: '1305.00', High: '1310.00', Low: '1298.00', Ason: '03 Jul 26 | 15:00' },
            })));

        await expect(cmd.func({ symbol: 'RELIANCE' })).resolves.toEqual([{
            code: '500325',
            symbol: 'RELIANCE',
            name: 'Reliance Industries Ltd',
            isin: 'INE002A01018',
            price: 1304.55,
            change: 0.75,
            changePct: 0.06,
            open: 1305,
            high: 1310,
            low: 1298,
            updateTime: '03 Jul 26 | 15:00',
            url: 'https://www.bseindia.com/stock-share-price/reliance-industries-ltd/reliance/500325/',
        }]);
    });

    it('maps HTTP failures to CommandExecutionError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({}, 500)));
        await expect(cmd.func({ symbol: 'RELIANCE' })).rejects.toBeInstanceOf(CommandExecutionError);
    });
});
