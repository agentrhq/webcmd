import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { driveJson, normalizeAppointmentId } from './utils.js';

cli({
  site: 'practo',
  name: 'appointment',
  access: 'read',
  description: 'Show logged-in Practo Drive appointment details',
  domain: 'drive.practo.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  siteSession: 'persistent',
  args: [{ name: 'appointment_id', positional: true, required: true, help: 'Appointment id from `practo appointments`' }],
  columns: ['appointment_id', 'status', 'summary'],
  func: async (page, kwargs) => {
    const id = normalizeAppointmentId(kwargs.appointment_id);
    const data = await driveJson(page, `/api/record/v2/appointment/${encodeURIComponent(id)}`);
    return [{ appointment_id: id, status: data?.status || data?.data?.status || '', summary: JSON.stringify(data?.data ?? data).slice(0, 1000) }];
  },
});
