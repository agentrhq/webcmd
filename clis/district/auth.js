import { CommandExecutionError } from '@agentrhq/webcmd/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';
import { BASE, profileProbe, safeGoto } from './_lib.js';

// District's login is an OTP modal opened from the header avatar, not a page.
async function openLoginModal(page) {
  await safeGoto(page, BASE);
  await page.wait(1);

  const clicked = await page.evaluate(`
    (() => {
      const candidates = [
        ...document.querySelectorAll('[role="button"][aria-label="User Avatar"]'),
        ...document.querySelectorAll('[aria-label="User Avatar"]')
      ];
      const target = candidates.find((el) => el instanceof HTMLElement);
      if (!target) return false;
      target.click();
      return true;
    })()
  `);

  if (!clicked) {
    throw new CommandExecutionError('Could not find the District user avatar login entry point');
  }
}

registerSiteAuthCommands({
  site: 'district',
  domain: 'www.district.in',
  loginUrl: BASE,
  openLogin: openLoginModal,
  columns: ['user_id', 'name', 'phone_number', 'email'],
  // Identity check needs a district.in page context for the profile fetch.
  verify: async (page) => {
    await safeGoto(page, BASE);
    await page.wait(1);
    return profileProbe(page);
  },
  // While the OTP modal is open, probe without navigating away from it.
  poll: async (page) => profileProbe(page),
  quickCheck: async (page) => {
    try {
      return { logged_in: true, ...await profileProbe(page) };
    } catch {
      return false;
    }
  },
});
