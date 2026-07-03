import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthRequiredError, EmptyResultError, ArgumentError } from '@agentrhq/webcmd/errors';
import { getRegistry } from '@agentrhq/webcmd/registry';
import { __test__ } from './search.js';
import './search.js';

afterEach(() => {
    delete process.env.BOARDGAMEGEEK_TOKEN;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('boardgamegeek search', () => {
    const cmd = getRegistry().get('boardgamegeek/search');

    it('maps XML API2 search results', async () => {
        process.env.BOARDGAMEGEEK_TOKEN = 'secret-token';
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(`
            <items total="2">
              <item type="boardgame" id="13">
                <name type="primary" value="CATAN"/>
                <yearpublished value="1995"/>
              </item>
              <item type="boardgame" id="68448">
                <name type="primary" value="7 Wonders"/>
                <yearpublished value="2010"/>
              </item>
            </items>
        `, { status: 200, headers: { 'content-type': 'text/xml' } }))));

        const rows = await cmd.func({ query: 'catan', limit: 1 });
        expect(String(fetch.mock.calls[0][0])).toContain('query=catan');
        expect(String(fetch.mock.calls[0][0])).toContain('type=boardgame');
        expect(fetch.mock.calls[0][1].headers.authorization).toBe('Bearer secret-token');
        expect(rows).toEqual([{
            rank: 1,
            id: '13',
            name: 'CATAN',
            type: 'boardgame',
            yearPublished: 1995,
            url: 'https://boardgamegeek.com/boardgame/13',
        }]);
    });

    it('omits type filter for all', async () => {
        process.env.BOARDGAMEGEEK_TOKEN = 'secret-token';
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(`
            <items><item type="boardgame" id="1"><name value="Demo"/></item></items>
        `, { status: 200 }))));

        await cmd.func({ query: 'demo', type: 'all' });
        expect(String(fetch.mock.calls[0][0])).not.toContain('type=');
    });

    it('requires BOARDGAMEGEEK_TOKEN', async () => {
        await expect(cmd.func({ query: 'catan' })).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('promotes 401 responses to AuthRequiredError', async () => {
        process.env.BOARDGAMEGEEK_TOKEN = 'bad-token';
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('Unauthorized', { status: 401 }))));
        await expect(cmd.func({ query: 'catan' })).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('rejects empty queries and invalid limits', async () => {
        await expect(cmd.func({ query: '' })).rejects.toBeInstanceOf(ArgumentError);
        await expect(cmd.func({ query: 'catan', limit: 101 })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('promotes empty XML results to EmptyResultError', async () => {
        process.env.BOARDGAMEGEEK_TOKEN = 'secret-token';
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('<items total="0"></items>', { status: 200 }))));
        await expect(cmd.func({ query: 'nope' })).rejects.toBeInstanceOf(EmptyResultError);
    });
});

describe('boardgamegeek XML parser', () => {
    it('decodes XML entities in names', () => {
        expect(__test__.parseSearch(`
            <items>
              <item type="boardgame" id="42"><name value="A &amp; B &quot;Game&quot;"/></item>
            </items>
        `)[0]).toMatchObject({ name: 'A & B "Game"' });
    });
});
