import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { buildBookingUrl, findSlot, normalizePracticeDoctorId, rowsForSlots } from './utils.js';

cli({
  site: 'practo',
  name: 'booking-link',
  access: 'read',
  description: 'Build a Practo booking URL for a selected slot without confirming it',
  domain: 'www.practo.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'practice_doctor_id', positional: true, required: true, help: 'Practo practice_doctor_id' },
    { name: 'time', required: true, help: 'Slot time YYYY-MM-DD HH:mm:ss' },
    { name: 'profile-url', required: false, help: 'Doctor profile_url from `practo search`, used to build a canonical booking URL' },
  ],
  columns: ['practice_doctor_id', 'time', 'booking_url'],
  func: async (page, kwargs) => {
    const practiceDoctorId = normalizePracticeDoctorId(kwargs.practice_doctor_id);
    const slot = findSlot(await rowsForSlots(page, practiceDoctorId), kwargs.time);
    return [{ practice_doctor_id: practiceDoctorId, time: slot.time, booking_url: buildBookingUrl({ practiceDoctorId, slotTime: slot.time, appointmentToken: slot.appointment_token, amount: slot.amount, prepaid: slot.prepaid, profileUrl: kwargs['profile-url'] }) }];
  },
});
