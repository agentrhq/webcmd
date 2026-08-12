import { ArgumentError } from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';

import {
  loadQuestionsFile,
  requireConfirmation,
  validateEventId,
} from './event-write-utils.js';

function validateMode(value) {
  if (value !== 'append' && value !== 'replace') {
    throw new TypeError('mode must be append or replace');
  }
  return value;
}

function toArgumentError(error) {
  if (error instanceof TypeError) return new ArgumentError(error.message);
  return error;
}

export async function setRegistrationQuestions(page, args) {
  try {
    const eventId = validateEventId(args?.eventId);
    const questions = await loadQuestionsFile(args?.['questions-file']);
    const mode = validateMode(args?.mode);
    requireConfirmation(args?.confirm);

    return { eventId, mode, questions };
  } catch (error) {
    throw toArgumentError(error);
  }
}

export const setRegistrationQuestionsCommand = cli({
  site: 'luma',
  name: 'set-registration-questions',
  description: 'Append or replace custom registration questions on a managed Luma event',
  strategy: Strategy.UI,
  domain: 'luma.com',
  browser: true,
  navigateBefore: false,
  freshPage: true,
  siteSession: 'persistent',
  access: 'write',
  args: [
    { name: 'eventId', type: 'str', required: true, positional: true },
    { name: 'questions-file', type: 'str', required: true },
    { name: 'mode', type: 'str', choices: ['append', 'replace'], required: true },
    { name: 'confirm', type: 'boolean', default: false },
  ],
  columns: ['eventId', 'mode', 'previousCount', 'questionCount', 'questions', 'registrationUrl'],
  func: setRegistrationQuestions,
});
