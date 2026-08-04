import { ArgumentError } from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';

import { normalizeCreateEventArgs } from './event-write-utils.js';

function toArgumentError(error) {
  if (error instanceof TypeError) return new ArgumentError(error.message);
  return error;
}

export async function createEvent(page, args) {
  try {
    return normalizeCreateEventArgs(args);
  } catch (error) {
    throw toArgumentError(error);
  }
}

export const createEventCommand = cli({
  site: 'luma',
  name: 'create-event',
  description: 'Create a free single-session Luma event',
  strategy: Strategy.UI,
  domain: 'luma.com',
  browser: true,
  navigateBefore: false,
  freshPage: true,
  siteSession: 'persistent',
  access: 'write',
  args: [
    { name: 'name', type: 'str', required: true },
    { name: 'start', type: 'str', required: true },
    { name: 'end', type: 'str', required: true },
    { name: 'timezone', type: 'str', required: true },
    { name: 'calendar', type: 'str' },
    { name: 'description', type: 'str' },
    { name: 'location', type: 'str' },
    { name: 'virtual-url', type: 'str' },
    { name: 'visibility', type: 'str', choices: ['public', 'private', 'members-only'], default: 'public' },
    { name: 'capacity', type: 'int' },
    { name: 'require-approval', type: 'boolean', default: false },
    { name: 'confirm', type: 'boolean', default: false },
  ],
  columns: [
    'eventId', 'name', 'startsAt', 'endsAt', 'timezone', 'visibility',
    'requireApproval', 'capacity', 'eventUrl', 'manageUrl',
  ],
  func: createEvent,
});
