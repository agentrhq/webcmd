import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { bookingPreviewFromPageData, prepareBookingPage } from './utils.js';

cli({
  site: 'practo',
  name: 'book-preview',
  access: 'read',
  description: 'Preview Practo booking details for a selected slot without confirming',
  domain: 'www.practo.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  siteSession: 'persistent',
  args: [
    { name: 'practice_doctor_id', positional: true, required: true, help: 'Practo practice_doctor_id' },
    { name: 'time', required: true, help: 'Slot time YYYY-MM-DD HH:mm:ss' },
    { name: 'profile-url', required: false, help: 'Doctor profile_url from `practo search`, used to build a canonical booking URL' },
  ],
  columns: ['practice_doctor_id', 'time', 'amount', 'prepaid', 'payment_mode', 'requires_payment', 'confirm_button', 'booking_url'],
  func: async (page, kwargs) => {
    const prepared = await prepareBookingPage(page, kwargs);
    return bookingPreviewFromPageData(prepared.data, prepared.context);
  },
});
