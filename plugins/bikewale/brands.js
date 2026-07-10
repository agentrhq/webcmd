import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';

const HOME_URL = 'https://www.bikewale.com/';
const IMAGE_HOST = 'https://imgd.aeplcdn.com/0x0';

function extractInitialState(html) {
  const marker = 'window.__INITIAL_STATE__';
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) {
    throw new CommandExecutionError('BikeWale page did not contain window.__INITIAL_STATE__');
  }

  const start = html.indexOf('{', markerIndex + marker.length);
  if (start < 0) {
    throw new CommandExecutionError('BikeWale initial state did not contain a JSON object');
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < html.length; index += 1) {
    const char = html[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, index + 1));
        } catch (error) {
          throw new CommandExecutionError(`Could not parse BikeWale initial state: ${error.message}`);
        }
      }
    }
  }

  throw new CommandExecutionError('BikeWale initial state JSON was incomplete');
}

cli({
  site: 'bikewale',
  name: 'brands',
  description: 'List motorcycle and scooter brands available on BikeWale',
  access: 'read',
  example: 'webcmd bikewale brands -f yaml',
  domain: 'www.bikewale.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'limit', type: 'int', default: 10, help: 'Number of items' },
  ],
  columns: ['rank', 'id', 'name', 'url', 'logoUrl', 'popularity', 'isScooterOnly'],
  func: async (args) => {
    const limit = Number(args.limit ?? 10);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new ArgumentError('limit must be an integer from 1 to 100');
    }

    const response = await fetch(HOME_URL, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': 'Mozilla/5.0 (compatible; webcmd/1.0)',
      },
      redirect: 'follow',
    });
    if (!response.ok) {
      throw new CommandExecutionError(`BikeWale homepage request failed: HTTP ${response.status}`);
    }

    const html = await response.text();
    const state = extractInitialState(html);
    const sourceRows = state?.homePage?.makeList;
    if (!Array.isArray(sourceRows)) {
      throw new CommandExecutionError('BikeWale initial state did not contain homePage.makeList');
    }
    if (!sourceRows.length) {
      throw new EmptyResultError('bikewale brands', 'BikeWale returned no brands');
    }

    return sourceRows.slice(0, limit).map((brand, index) => {
      if (!Number.isInteger(brand.makeId) || !brand.makeName || !brand.maskingName) {
        throw new CommandExecutionError(`BikeWale brand row ${index + 1} is missing required fields`);
      }
      return {
        rank: index + 1,
        id: brand.makeId,
        name: brand.makeName,
        url: `${HOME_URL}${brand.maskingName}-bikes/`,
        logoUrl: brand.logoPath ? `${IMAGE_HOST}${brand.logoPath}` : '',
        popularity: Number(brand.popularity),
        isScooterOnly: Boolean(brand.isScooterOnlyMake),
      };
    });
  },
});
