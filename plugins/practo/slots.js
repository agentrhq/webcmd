import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { normalizeLimit, rowsForSlots } from './utils.js';

cli({
  site: 'practo',
  name: 'slots',
  access: 'read',
  description: 'List available Practo appointment slots for a practice_doctor_id',
  domain: 'www.practo.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'practice_doctor_id', positional: true, required: true, help: 'Practo practice_doctor_id from search results' },
    { name: 'limit', type: 'int', default: 20, help: 'Max slots to return (1-25)' },
  ],
  columns: ['practice_doctor_id', 'time', 'available', 'amount', 'prepaid', 'appointment_token'],
  func: async (page, kwargs) => (await rowsForSlots(page, kwargs.practice_doctor_id)).filter((row) => row.available).slice(0, normalizeLimit(kwargs.limit, 20)),
});
