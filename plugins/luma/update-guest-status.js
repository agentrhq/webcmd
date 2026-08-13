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

function normalizeBoolean(value) {
  return value === true || value === 'true';
}

cli({
  site: 'luma',
  name: 'update-guest-status',
  description: 'Approve or decline a pending Luma guest after explicit confirmation',
  access: 'write',
  example: 'webcmd luma update-guest-status evt-abc gst-abc --status approved --confirm true -f json',
  domain: 'luma.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  freshPage: true,
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
      name: 'guestId',
      type: 'str',
      required: true,
      positional: true,
      help: 'Luma guest ID returned by webcmd luma guests',
    },
    {
      name: 'status',
      type: 'str',
      required: true,
      choices: ['approved', 'declined'],
      help: 'New guest status',
    },
    {
      name: 'suppress-email',
      type: 'boolean',
      default: false,
      help: 'Set true to prevent Luma from emailing the guest',
    },
    {
      name: 'confirm',
      type: 'boolean',
      default: false,
      help: 'Required. Set --confirm true to change the real guest status',
    },
  ],
  columns: [
    'eventId',
    'guestId',
    'name',
    'email',
    'previousStatus',
    'status',
    'emailSuppressed',
  ],
  func: async (page, kwargs) => {
    const eventId = String(kwargs.eventId || '').trim();
    const guestId = String(kwargs.guestId || '').trim();
    const status = String(kwargs.status || '').trim();
    const suppressEmail = normalizeBoolean(kwargs['suppress-email']);
    if (!/^evt-[A-Za-z0-9_-]+$/.test(eventId)) {
      throw new ArgumentError('Invalid Luma event ID', 'Use an eventId returned by webcmd luma events');
    }
    if (!/^gst-[A-Za-z0-9_-]+$/.test(guestId)) {
      throw new ArgumentError('Invalid Luma guest ID', 'Use a guestId returned by webcmd luma guests');
    }
    if (!normalizeBoolean(kwargs.confirm)) {
      throw new ArgumentError(
        'Refusing to change Luma guest status without --confirm true',
        'Example: webcmd luma update-guest-status <eventId> <guestId> --status approved --confirm true',
      );
    }

    await page.goto('https://luma.com/home');
    await page.wait(1);

    const evaluated = await page.evaluate(`(async () => {
      const eventId = ${JSON.stringify(eventId)};
      const guestId = ${JSON.stringify(guestId)};
      const wantedStatus = ${JSON.stringify(status)};
      const suppressEmail = ${JSON.stringify(suppressEmail)};

      const findGuest = async () => {
        let cursor = '';
        for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
          const params = new URLSearchParams({
            event_api_id: eventId,
            pagination_limit: '100',
            query: '',
            sort_column: 'registered_or_created_at',
            sort_direction: 'desc',
          });
          if (cursor) params.set('pagination_cursor', cursor);
          const response = await fetch('https://api.luma.com/event/admin/get-guests?' + params, {
            credentials: 'include',
          });
          if (response.status === 401 || response.status === 403) {
            return { error: { kind: 'auth', status: response.status } };
          }
          if (!response.ok) return { error: { kind: 'http', status: response.status } };
          const payload = await response.json();
          if (!Array.isArray(payload.entries)) return { error: { kind: 'shape' } };
          const guest = payload.entries.find((entry) => entry.api_id === guestId);
          if (guest) return { guest };
          if (!payload.has_more) return { guest: null };
          if (!payload.next_cursor || payload.next_cursor === cursor) {
            return { error: { kind: 'pagination' } };
          }
          cursor = payload.next_cursor;
        }
        return { error: { kind: 'pagination' } };
      };

      try {
        const before = await findGuest();
        if (before.error) return before.error;
        if (!before.guest) return { kind: 'not_found' };
        if (!['pending_approval', 'waitlist'].includes(before.guest.approval_status)) {
          return { kind: 'state', currentStatus: before.guest.approval_status };
        }

        const response = await fetch('https://api.luma.com/event/admin/update-guest-status', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event_api_id: eventId,
            rsvp_api_id: guestId,
            suppress_email: suppressEmail,
            approval_status: wantedStatus,
            should_refund: false,
            event_ticket_type_api_id: null,
          }),
        });
        if (response.status === 401 || response.status === 403) {
          return { kind: 'auth', status: response.status };
        }
        if (!response.ok) {
          return { kind: 'write_http', status: response.status, detail: (await response.text()).slice(0, 500) };
        }

        await new Promise((resolve) => setTimeout(resolve, 500));
        const after = await findGuest();
        if (after.error) return after.error;
        if (!after.guest || after.guest.approval_status !== wantedStatus) {
          return {
            kind: 'verify',
            actualStatus: after.guest?.approval_status || 'missing',
          };
        }
        return {
          kind: 'ok',
          guest: {
            name: before.guest.name || '',
            email: before.guest.email || '',
            previousStatus: before.guest.approval_status || '',
            status: after.guest.approval_status || '',
          },
        };
      } catch (error) {
        return { kind: 'exception', detail: String(error?.message || error) };
      }
    })()`);
    const result = unwrapBrowserResult(evaluated);

    if (result?.kind === 'auth') {
      throw new AuthRequiredError('luma.com', `Luma guest status request returned HTTP ${result.status}`);
    }
    if (result?.kind === 'http') {
      throw new CommandExecutionError(`Luma guest lookup returned HTTP ${result.status}`);
    }
    if (result?.kind === 'write_http') {
      throw new CommandExecutionError(`Luma status update returned HTTP ${result.status}: ${result.detail}`);
    }
    if (result?.kind === 'not_found') {
      throw new CommandExecutionError(`Guest ${guestId} was not found in event ${eventId}`);
    }
    if (result?.kind === 'state') {
      throw new CommandExecutionError(
        `Guest ${guestId} has status ${result.currentStatus}; only pending_approval or waitlist guests can be changed`,
      );
    }
    if (result?.kind === 'pagination' || result?.kind === 'shape') {
      throw new CommandExecutionError('Could not safely locate the Luma guest');
    }
    if (result?.kind === 'verify') {
      throw new CommandExecutionError(
        `Luma accepted the update but verification returned status ${result.actualStatus}`,
      );
    }
    if (result?.kind === 'exception') {
      throw new CommandExecutionError(`Luma status update failed: ${result.detail}`);
    }
    if (result?.kind !== 'ok' || !result.guest) {
      throw new CommandExecutionError('Luma status update returned an unexpected response');
    }

    return [{
      eventId,
      guestId,
      name: String(result.guest.name || ''),
      email: String(result.guest.email || ''),
      previousStatus: String(result.guest.previousStatus || ''),
      status: String(result.guest.status || ''),
      emailSuppressed: suppressEmail,
    }];
  },
});
