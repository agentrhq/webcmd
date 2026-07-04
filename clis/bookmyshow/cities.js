// bookmyshow cities — list available cities/regions on BookMyShow.
//
// Fetches the list of all supported cities from BookMyShow. Each row includes
// the city slug (used as input to other commands), display name, and region.
// Cities has its own unwrap logic because the response shape (TopCities +
// OtherCities) is unique across all BMS endpoints.
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { EmptyResultError } from '@agentrhq/webcmd/errors';
import { BMS_BASE, bmsFetch, buildProvenance, cleanText, requireBoundedInt } from './utils.js';


function unwrapCities(body) {
    let topCities = body?.BookMyShow?.TopCities
        ?? body?.TopCities
        ?? body?.regions
        ?? body?.data
        ?? (Array.isArray(body) ? body : []);

    const otherCities = body?.BookMyShow?.OtherCities
        ?? body?.OtherCities
        ?? [];

    if (!Array.isArray(topCities)) topCities = [];

    if (Array.isArray(otherCities) && otherCities.length > 0) {
        const topSet = new Set(topCities.map((c) =>
            String(c.RegionCode ?? c.code ?? c.slug ?? '').toLowerCase(),
        ));
        return [
            ...topCities.map((c) => ({ ...c, _isTop: true })),
            ...otherCities
                .filter((c) => !topSet.has(String(c.RegionCode ?? c.code ?? c.slug ?? '').toLowerCase()))
                .map((c) => ({ ...c, _isTop: false })),
        ];
    }
    return topCities;
}

cli({
    site: 'bookmyshow',
    name: 'cities',
    access: 'read',
    description: 'List available cities and regions on BookMyShow',
    domain: 'in.bookmyshow.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'limit', type: 'int', default: 50, help: 'Max rows to return (1-300)' },
    ],
    columns: ['rank', 'code', 'name', 'region', 'isTopCity', 'sourceUrl', 'fetchedAt', 'url'],
    func: async (page, args) => {
        const limit = requireBoundedInt(args.limit, 50, 1, 300, 'limit');

        const endpoint = `${BMS_BASE}/api/explore/v1/discover/regions`;
        const body = await bmsFetch(page, endpoint, 'bookmyshow cities');
        const cities = unwrapCities(body);

        if (cities.length === 0) {
            throw new EmptyResultError(
                'bookmyshow cities',
                'No cities returned by BookMyShow.',
            );
        }

        const provenance = buildProvenance(endpoint);
        return cities.slice(0, limit).map((c, i) => {
            const code = cleanText(c.RegionCode ?? c.code ?? c.slug ?? '').toLowerCase();
            const name = cleanText(c.RegionName ?? c.RegionText ?? c.name ?? c.text ?? '');
            const region = cleanText(c.SubRegion ?? c.region ?? c.state ?? '');
            const isTop = c._isTop === true
                || c.isTopCity === true
                || c.IsTopCity === 'Y';

            return {
                rank: i + 1,
                code,
                name,
                region,
                isTopCity: isTop,
                ...provenance,
                url: `${BMS_BASE}/${code}`,
            };
        });
    },
});
