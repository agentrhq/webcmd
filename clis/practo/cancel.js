import { ArgumentError } from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { cancelAppointment, normalizeAppointmentId, normalizeConfirm } from './utils.js';

cli({
  site: 'practo',
  name: 'cancel',
  access: 'write',
  description: 'Cancel a logged-in Practo Drive appointment after explicit confirmation',
  domain: 'drive.practo.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  defaultWindowMode: 'foreground',
  siteSession: 'persistent',
  args: [
    { name: 'appointment_id', positional: true, required: true, help: 'Appointment id from `practo appointments`' },
    { name: 'confirm', type: 'boolean', default: false, help: 'Required. Set --confirm true to cancel the appointment.' },
  ],
  columns: ['status', 'appointment_id'],
  func: async (page, kwargs) => {
    const id = normalizeAppointmentId(kwargs.appointment_id);
    if (!normalizeConfirm(kwargs.confirm)) {
      throw new ArgumentError('Refusing to cancel appointment without --confirm true', 'Example: webcmd practo cancel <appointment_id> --confirm true');
    }
    await cancelAppointment(page, id);
    return [{ status: 'cancelled', appointment_id: id }];
  },
});
