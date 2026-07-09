import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { ArgumentError, CommandExecutionError } from '@agentrhq/webcmd/errors';
import {
  applyLocationViaPicker,
  validateTimeout,
} from './_lib.js';

const DEFAULT_TIMEOUT_SECONDS = 45;

function validateLocation(raw) {
  const location = String(raw || '').trim();
  if (!location) throw new ArgumentError('location is required');
  if (location.length > 120) throw new ArgumentError('location must be 120 characters or fewer');
  return location;
}

function validateRank(raw) {
  const rank = Number(raw ?? 1);
  if (!Number.isInteger(rank) || rank < 1 || rank > 20) {
    throw new ArgumentError('rank must be an integer from 1 to 20');
  }
  return rank;
}

cli({
  site: 'district',
  name: 'set-location',
  aliases: ['setlocation'],
  access: 'write',
  description: 'Set the District browser session location for movie booking filters',
  domain: 'www.district.in',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  defaultWindowMode: 'foreground',
  siteSession: 'persistent',
  args: [
    {
      name: 'location',
      positional: true,
      required: true,
      help: 'City, area, mall, or locality, for example "Bangalore" or "Indiranagar"',
    },
    {
      name: 'rank',
      type: 'int',
      default: 1,
      help: 'Pick the Nth District location result (1-20), default: 1',
    },
    {
      name: 'timeout',
      type: 'int',
      default: DEFAULT_TIMEOUT_SECONDS,
      help: 'Maximum seconds to wait for the picker and location change',
    },
  ],
  columns: [
    'status',
    'name',
    'city',
    'state',
    'cityKey',
    'cityId',
    'placeId',
    'subzoneId',
    'lat',
    'lng',
    'availableTabs',
    'source',
  ],
  func: async (page, args) => {
    const location = validateLocation(args.location);
    const rank = validateRank(args.rank);
    const timeout = validateTimeout(args.timeout, { def: DEFAULT_TIMEOUT_SECONDS, min: 10, max: 180 });

    const row = await applyLocationViaPicker(page, location, timeout, rank);
    if (!row.cityKey || !row.cityId) {
      throw new CommandExecutionError('District location was selected, but normalized city metadata could not be read');
    }
    return row;
  },
});
