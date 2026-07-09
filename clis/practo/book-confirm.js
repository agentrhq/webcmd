import { ArgumentError, CommandExecutionError } from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { bookingPreviewFromPageData, normalizeConfirm, prepareBookingPage, submitBookingPage } from './utils.js';

cli({
  site: 'practo',
  name: 'book-confirm',
  access: 'write',
  description: 'Confirm a Practo clinic visit booking after explicit confirmation',
  domain: 'www.practo.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  defaultWindowMode: 'foreground',
  siteSession: 'persistent',
  args: [
    { name: 'practice_doctor_id', positional: true, required: true, help: 'Practo practice_doctor_id' },
    { name: 'time', required: true, help: 'Slot time YYYY-MM-DD HH:mm:ss' },
    { name: 'profile-url', required: false, help: 'Doctor profile_url from `practo search`, used to build a canonical booking URL' },
    { name: 'confirm', type: 'boolean', default: false, help: 'Required. Set --confirm true to create the appointment.' },
  ],
  columns: ['status', 'practice_doctor_id', 'time', 'url'],
  func: async (page, kwargs) => {
    if (!normalizeConfirm(kwargs.confirm)) {
      throw new ArgumentError('Refusing to book appointment without --confirm true', 'Example: webcmd practo book-confirm 859054 --time "2026-07-10 10:30:00" --confirm true');
    }
    const prepared = await prepareBookingPage(page, kwargs);
    const preview = bookingPreviewFromPageData(prepared.data, prepared.context)[0];
    if (preview.requires_payment) {
      throw new CommandExecutionError('This Practo slot appears to require online payment; stopping before payment.');
    }
    const result = await submitBookingPage(page);
    return [{ status: 'submitted', practice_doctor_id: prepared.context.practiceDoctorId, time: prepared.context.slotTime, url: result.url || prepared.context.url }];
  },
});
