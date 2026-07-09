import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { normalizePracticeDoctorId, practoJson } from './utils.js';

cli({
  site: 'practo',
  name: 'contact',
  access: 'read',
  description: 'Get Practo virtual contact number for a practice_doctor_id',
  domain: 'www.practo.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [{ name: 'practice_doctor_id', positional: true, required: true, help: 'Practo practice_doctor_id from search results' }],
  columns: ['practice_doctor_id', 'phone', 'raw'],
  func: async (page, kwargs) => {
    const id = normalizePracticeDoctorId(kwargs.practice_doctor_id);
    const data = await practoJson(page, `/health/api/vn/vnpractice?practice_doctor_id=${id}`);
    const phone = data?.phone_number || data?.phone || data?.number || data?.data?.phone_number || '';
    return [{ practice_doctor_id: id, phone, raw: phone ? '' : JSON.stringify(data).slice(0, 500) }];
  },
});
