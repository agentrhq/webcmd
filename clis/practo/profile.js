import { EmptyResultError } from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { PRACTO, unwrapBrowserResult } from './utils.js';

cli({
  site: 'practo',
  name: 'profile',
  access: 'read',
  description: 'Read public details from a Practo doctor profile URL',
  domain: 'www.practo.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [{ name: 'url', positional: true, required: true, help: 'Practo doctor profile URL' }],
  columns: ['name', 'specialty', 'experience', 'fee', 'profile_url'],
  func: async (page, kwargs) => {
    const url = new URL(String(kwargs.url), PRACTO).toString();
    await page.goto(url);
    await page.wait(2);
    const row = unwrapBrowserResult(await page.evaluate(`(() => {
      const text = document.body?.innerText || '';
      const title = document.querySelector('h1')?.textContent?.trim() || document.title.replace(/ - Practo.*/, '').trim();
      const specialty = (text.match(/(Orthopedist|Dentist|Dermatologist|Gynecologist|Pediatrician|General Physician|Cardiologist)/i) || [,''])[1];
      const experience = (text.match(/(\\d+\\s+Years? Experience)/i) || [,''])[1];
      const fee = (text.match(/(?:₹|Rs\\.?\\s*)([0-9,]+)/i) || [,''])[1];
      return { name: title, specialty, experience, fee: fee ? Number(fee.replace(/,/g, '')) : '', profile_url: location.href };
    })()`));
    if (!row?.name) throw new EmptyResultError('practo profile');
    return [row];
  },
});
