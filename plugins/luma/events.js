import { AuthRequiredError, CommandExecutionError } from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';

function unwrapBrowserResult(value) {
  if (
    value
    && typeof value === 'object'
    && typeof value.session === 'string'
    && Object.prototype.hasOwnProperty.call(value, 'data')
  ) {
    return value.data;
  }
  return value;
}

cli({
  site: 'luma',
  name: 'events',
  description: 'List upcoming or past Luma events managed by the logged-in account',
  access: 'read',
  example: 'webcmd luma events --period future --limit 25 -f json',
  domain: 'luma.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  siteSession: 'persistent',
  args: [
    {
      name: 'period',
      type: 'str',
      default: 'future',
      choices: ['future', 'past'],
      help: 'List future or past events',
    },
    { name: 'limit', type: 'int', default: 25, help: 'Maximum number of events to request' },
  ],
  columns: [
    'eventId',
    'name',
    'startsAt',
    'endsAt',
    'timezone',
    'guestCount',
    'requireApproval',
    'managerLevel',
    'location',
    'manageUrl',
    'eventUrl',
  ],
  func: async (page, kwargs) => {
    const period = String(kwargs.period || 'future');
    const limit = Number(kwargs.limit || 25);
    const endpoint = `https://api.luma.com/home/get-events?pagination_limit=${encodeURIComponent(limit)}&period=${encodeURIComponent(period)}`;
    const evaluated = await page.evaluate(`(async () => {
      try {
        const response = await fetch(${JSON.stringify(endpoint)}, { credentials: 'include' });
        if (response.status === 401 || response.status === 403) {
          return { kind: 'auth', status: response.status };
        }
        if (!response.ok) return { kind: 'http', status: response.status };
        return { kind: 'ok', payload: await response.json() };
      } catch (error) {
        return { kind: 'exception', detail: String(error?.message || error) };
      }
    })()`);
    const result = unwrapBrowserResult(evaluated);

    if (result?.kind === 'auth') {
      throw new AuthRequiredError('luma.com', `Luma events request returned HTTP ${result.status}`);
    }
    if (result?.kind === 'http') {
      throw new CommandExecutionError(`Luma events request returned HTTP ${result.status}`);
    }
    if (result?.kind === 'exception') {
      throw new CommandExecutionError(`Luma events request failed: ${result.detail}`);
    }
    if (result?.kind !== 'ok' || !Array.isArray(result.payload?.entries)) {
      throw new CommandExecutionError('Luma events returned an unexpected response');
    }

    return result.payload.entries
      .filter((entry) => entry?.manager_info || entry?.host_info?.access_level)
      .map((entry) => {
        const event = entry.event || {};
        const location = event.geo_address_info?.full_address
          || event.geo_address_info?.address
          || event.location_type
          || '';
        return {
          eventId: String(event.api_id || entry.api_id || ''),
          name: String(event.name || ''),
          startsAt: String(event.start_at || entry.start_at || ''),
          endsAt: String(event.end_at || ''),
          timezone: String(event.timezone || ''),
          guestCount: Number(entry.guest_count || 0),
          requireApproval: Boolean(entry.ticket_info?.require_approval),
          managerLevel: String(entry.manager_info?.level || entry.host_info?.access_level || ''),
          location: String(location),
          manageUrl: event.api_id ? `https://luma.com/event/manage/${event.api_id}` : '',
          eventUrl: event.url ? `https://luma.com/${event.url}` : '',
        };
      });
  },
});
