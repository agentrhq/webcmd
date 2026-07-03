import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthRequiredError, EmptyResultError, ArgumentError } from '@agentrhq/webcmd/errors';
import { getRegistry } from '@agentrhq/webcmd/registry';
import { __test__ } from './search.js';
import { __test__ as collectionTest } from './collection.js';
import { __test__ as guildTest } from './guild.js';
import { __test__ as hotTest } from './hot.js';
import { __test__ as playsTest } from './plays.js';
import { __test__ as thingTest } from './thing.js';
import { __test__ as userTest } from './user.js';
import './collection.js';
import './guild.js';
import './hot.js';
import './plays.js';
import './search.js';
import './thing.js';
import './user.js';

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

describe('boardgamegeek thing', () => {
    const cmd = getRegistry().get('boardgamegeek/thing');

    it('maps thing details and stats', async () => {
        process.env.BOARDGAMEGEEK_TOKEN = 'secret-token';
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(`
            <items>
              <item type="boardgame" id="13">
                <name type="primary" value="CATAN"/>
                <yearpublished value="1995"/>
                <minplayers value="3"/><maxplayers value="4"/><playingtime value="120"/><minage value="10"/>
                <link type="boardgamecategory" value="Negotiation"/>
                <link type="boardgamemechanic" value="Trading"/>
                <statistics><ratings>
                  <usersrated value="132000"/><average value="7.1"/><bayesaverage value="6.9"/>
                </ratings></statistics>
              </item>
            </items>
        `, { status: 200 }))));

        await expect(cmd.func({ id: 13 })).resolves.toMatchObject([{
            id: '13',
            name: 'CATAN',
            minPlayers: 3,
            averageRating: 7.1,
            categories: 'Negotiation',
            mechanics: 'Trading',
        }]);
    });
});

describe('boardgamegeek hot', () => {
    const cmd = getRegistry().get('boardgamegeek/hot');

    it('maps hot list rows', async () => {
        process.env.BOARDGAMEGEEK_TOKEN = 'secret-token';
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(`
            <items>
              <item id="224517" rank="1">
                <thumbnail value="https://cf.geekdo-images.com/demo.jpg"/>
                <name value="Brass: Birmingham"/>
                <yearpublished value="2018"/>
              </item>
            </items>
        `, { status: 200 }))));

        const rows = await cmd.func({ limit: 1 });
        expect(String(fetch.mock.calls[0][0])).toContain('/hot?type=boardgame');
        expect(rows[0]).toMatchObject({ rank: 1, id: '224517', name: 'Brass: Birmingham', yearPublished: 2018 });
    });
});

describe('boardgamegeek collection', () => {
    const cmd = getRegistry().get('boardgamegeek/collection');

    it('maps collection rows and owned filter', async () => {
        process.env.BOARDGAMEGEEK_TOKEN = 'secret-token';
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(`
            <items>
              <item objectid="13" collid="99" subtype="boardgame">
                <name>CATAN</name>
                <yearpublished>1995</yearpublished>
                <status own="1" wishlist="0" fortrade="1" wanttoplay="0"/>
                <numplays>12</numplays>
                <stats><rating value="8"><average value="7.1"/></rating></stats>
              </item>
            </items>
        `, { status: 200 }))));

        const rows = await cmd.func({ username: 'alice', limit: 1 });
        expect(String(fetch.mock.calls[0][0])).toContain('own=1');
        expect(rows[0]).toMatchObject({ rank: 1, id: '13', collectionId: '99', name: 'CATAN', own: true, forTrade: true, numPlays: 12, userRating: 8, averageRating: 7.1 });
    });
});

describe('boardgamegeek plays', () => {
    const cmd = getRegistry().get('boardgamegeek/plays');

    it('maps logged plays', async () => {
        process.env.BOARDGAMEGEEK_TOKEN = 'secret-token';
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(`
            <plays>
              <play id="123" date="2026-07-01" quantity="1" length="45" incomplete="0" nowinstats="1" location="Home">
                <item name="CATAN" objectid="13"/>
              </play>
            </plays>
        `, { status: 200 }))));

        await expect(cmd.func({ username: 'alice', limit: 1, mindate: '2026-07-01' })).resolves.toMatchObject([{
            rank: 1,
            id: '123',
            date: '2026-07-01',
            itemId: '13',
            itemName: 'CATAN',
        }]);
    });
});

describe('boardgamegeek user', () => {
    const cmd = getRegistry().get('boardgamegeek/user');

    it('maps public profile rows', async () => {
        process.env.BOARDGAMEGEEK_TOKEN = 'secret-token';
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(`
            <user id="7" name="alice">
              <firstname value="Alice"/><lastname value="Example"/>
              <country value="US"/><yearregistered value="2010"/>
              <lastlogin value="2026-07-01"/><traderating value="5"/>
            </user>
        `, { status: 200 }))));

        await expect(cmd.func({ username: 'alice' })).resolves.toEqual([{
            id: '7',
            username: 'alice',
            firstName: 'Alice',
            lastName: 'Example',
            stateOrProvince: '',
            country: 'US',
            yearRegistered: '2010',
            lastLogin: '2026-07-01',
            tradeRating: '5',
            marketRating: '',
            url: 'https://boardgamegeek.com/user/alice',
        }]);
    });
});

describe('boardgamegeek guild', () => {
    const cmd = getRegistry().get('boardgamegeek/guild');

    it('maps guild details', async () => {
        process.env.BOARDGAMEGEEK_TOKEN = 'secret-token';
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(`
            <guild id="1229">
              <name>BoardGameGeek XML API</name>
              <created value="2009-01-01"/><manager value="admin"/><category value="Tech"/>
              <website value="https://example.com"/><description>API talk</description>
              <members count="25"><member name="alice"/></members>
            </guild>
        `, { status: 200 }))));

        await expect(cmd.func({ id: 1229 })).resolves.toMatchObject([{
            id: '1229',
            name: 'BoardGameGeek XML API',
            manager: 'admin',
            memberCount: 25,
        }]);
    });
});

describe('boardgamegeek parser helpers', () => {
    it('parses representative XML snippets', () => {
        expect(thingTest.parseThing('<items><item id="1" type="boardgame"><name type="primary" value="One"/></item></items>')[0].name).toBe('One');
        expect(hotTest.parseHot('<items><item id="1" rank="2"><name value="Hot"/></item></items>')[0].rank).toBe(2);
        expect(collectionTest.parseCollection('<items><item objectid="1"><name>Owned</name><status own="1"/></item></items>')[0].own).toBe(true);
        expect(playsTest.parsePlays('<plays><play id="1"><item objectid="2" name="Play"/></play></plays>')[0].itemName).toBe('Play');
        expect(userTest.parseUser('<user id="1" name="u"><country value="US"/></user>')[0].country).toBe('US');
        expect(guildTest.parseGuild('<guild id="1"><name>Guild</name><members count="3"/></guild>')[0].memberCount).toBe(3);
    });
});
