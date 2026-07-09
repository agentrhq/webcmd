import { EmptyResultError } from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { buildSearchUrl, normalizeLimit, rowsFromSearchState, unwrapBrowserResult } from './utils.js';

cli({
  site: 'practo',
  name: 'search',
  access: 'read',
  description: 'Search Practo doctors by specialty, city, and optional locality',
  domain: 'www.practo.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'specialty', positional: true, required: true, help: 'Doctor specialty, e.g. orthopedist or dermatologist' },
    { name: 'city', default: 'bangalore', help: 'City, e.g. bangalore' },
    { name: 'locality', help: 'Optional locality, e.g. indiranagar' },
    { name: 'limit', type: 'int', default: 10, help: 'Max doctors to return (1-25)' },
  ],
  columns: ['rank', 'practice_doctor_id', 'doctor_id', 'practice_id', 'name', 'specialty', 'experience_years', 'locality', 'clinic', 'fee', 'next_available', 'profile_url'],
  func: async (page, kwargs) => {
    const limit = normalizeLimit(kwargs.limit);
    await page.goto(buildSearchUrl(kwargs));
    await page.wait(2);
    const state = unwrapBrowserResult(await page.evaluate(`(() => window.__REDUX_STATE__ || window.__PRELOADED_STATE__ || null)()`));
    const rows = rowsFromSearchState(state, limit);
    if (rows.length === 0) throw new EmptyResultError('practo search', 'No doctor cards were found in Practo page state.');
    return rows;
  },
});
