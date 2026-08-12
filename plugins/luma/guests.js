import {
  ArgumentError,
  AuthRequiredError,
  CommandExecutionError,
} from '@agentrhq/webcmd/errors';
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
  name: 'guests',
  description: 'List guests and all custom registration answers for a managed Luma event',
  access: 'read',
  example: 'webcmd luma guests evt-abc --status pending_approval --limit 100 -f json',
  domain: 'luma.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  siteSession: 'persistent',
  args: [
    {
      name: 'eventId',
      type: 'str',
      required: true,
      positional: true,
      help: 'Luma event ID returned by webcmd luma events',
    },
    {
      name: 'status',
      type: 'str',
      default: 'all',
      choices: ['all', 'approved', 'pending_approval', 'declined', 'waitlist', 'invited'],
      help: 'Filter by guest approval status',
    },
    { name: 'limit', type: 'int', default: 100, help: 'Maximum matching guests to return' },
    { name: 'query', type: 'str', default: '', help: 'Search text passed to Luma guest search' },
  ],
  columns: [
    'eventId',
    'guestId',
    'userId',
    'name',
    'email',
    'phone',
    'status',
    'registeredAt',
    'profiles',
    'answers',
  ],
  func: async (page, kwargs) => {
    const eventId = String(kwargs.eventId || '').trim();
    const status = String(kwargs.status || 'all');
    const limit = Number(kwargs.limit || 100);
    const query = String(kwargs.query || '');
    if (!/^evt-[A-Za-z0-9_-]+$/.test(eventId)) {
      throw new ArgumentError('Invalid Luma event ID', 'Use an eventId returned by webcmd luma events');
    }
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new ArgumentError('Guest limit must be a positive integer');
    }

    const evaluated = await page.evaluate(`(async () => {
      const eventId = ${JSON.stringify(eventId)};
      const wantedStatus = ${JSON.stringify(status)};
      const wantedLimit = ${JSON.stringify(limit)};
      const searchQuery = ${JSON.stringify(query)};
      const matches = [];
      let cursor = '';
      let pageCount = 0;

      try {
        while (matches.length < wantedLimit) {
          pageCount += 1;
          if (pageCount > 100) return { kind: 'pagination', detail: 'Exceeded 100 guest pages' };
          const params = new URLSearchParams({
            event_api_id: eventId,
            pagination_limit: '100',
            query: searchQuery,
            sort_column: 'registered_or_created_at',
            sort_direction: 'desc',
          });
          if (cursor) params.set('pagination_cursor', cursor);
          const response = await fetch('https://api.luma.com/event/admin/get-guests?' + params, {
            credentials: 'include',
          });
          if (response.status === 401 || response.status === 403) {
            return { kind: 'auth', status: response.status };
          }
          if (!response.ok) return { kind: 'http', status: response.status };
          const payload = await response.json();
          if (!Array.isArray(payload.entries)) return { kind: 'shape' };
          for (const entry of payload.entries) {
            if (wantedStatus === 'all' || entry.approval_status === wantedStatus) matches.push(entry);
            if (matches.length >= wantedLimit) break;
          }
          if (!payload.has_more) break;
          if (!payload.next_cursor || payload.next_cursor === cursor) {
            return { kind: 'pagination', detail: 'Missing or repeated next_cursor' };
          }
          cursor = payload.next_cursor;
        }
        return { kind: 'ok', entries: matches.slice(0, wantedLimit) };
      } catch (error) {
        return { kind: 'exception', detail: String(error?.message || error) };
      }
    })()`);
    const result = unwrapBrowserResult(evaluated);

    if (result?.kind === 'auth') {
      throw new AuthRequiredError('luma.com', `Luma guests request returned HTTP ${result.status}`);
    }
    if (result?.kind === 'http') {
      throw new CommandExecutionError(`Luma guests request returned HTTP ${result.status}`);
    }
    if (result?.kind === 'pagination') {
      throw new CommandExecutionError(`Luma guest pagination failed: ${result.detail}`);
    }
    if (result?.kind === 'exception') {
      throw new CommandExecutionError(`Luma guests request failed: ${result.detail}`);
    }
    if (result?.kind !== 'ok' || !Array.isArray(result.entries)) {
      throw new CommandExecutionError('Luma guests returned an unexpected response');
    }

    return result.entries.map((guest) => ({
      eventId: String(guest.event_api_id || eventId),
      guestId: String(guest.api_id || ''),
      userId: String(guest.user_api_id || ''),
      name: String(guest.name || ''),
      email: String(guest.email || ''),
      phone: String(guest.phone_number || ''),
      status: String(guest.approval_status || ''),
      registeredAt: String(guest.registered_at || guest.registered_or_created_at || guest.created_at || ''),
      profiles: JSON.stringify({
        instagram: guest.instagram_handle ?? null,
        linkedin: guest.linkedin_handle ?? null,
        tiktok: guest.tiktok_handle ?? null,
        twitter: guest.twitter_handle ?? null,
        youtube: guest.youtube_handle ?? null,
        website: guest.website ?? null,
      }),
      answers: JSON.stringify(Array.isArray(guest.registration_answers)
        ? guest.registration_answers.map((answer) => ({
            questionId: answer?.question_id ?? null,
            label: answer?.label ?? '',
            type: answer?.question_type ?? '',
            value: Object.prototype.hasOwnProperty.call(answer || {}, 'value') ? answer.value : null,
            answer: Object.prototype.hasOwnProperty.call(answer || {}, 'answer') ? answer.answer : null,
          }))
        : []),
    }));
  },
});
