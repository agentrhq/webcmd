import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { driveJson } from './utils.js';

cli({
  site: 'practo',
  name: 'appointments',
  access: 'read',
  description: 'List logged-in Practo Drive appointments',
  domain: 'drive.practo.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  siteSession: 'persistent',
  args: [],
  columns: ['appointment_id', 'doctor', 'practice', 'time', 'status'],
  func: async (page) => {
    const data = await driveJson(page, '/api/record/v2/appointments');
    const list = Array.isArray(data?.data) ? data.data : [];
    return list.map((item) => ({
      appointment_id: String(item.id || item.appointment_id || item.object_identifier || ''),
      doctor: item.doctor_name || item.provider_name || item.doctor?.name || '',
      practice: item.practice_name || item.establishment_name || item.practice?.name || '',
      time: item.appointment_time || item.scheduled_at || item.from_time || '',
      status: item.status || item.state || '',
    }));
  },
});
