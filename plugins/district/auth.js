import { CommandExecutionError } from '@agentrhq/webcmd/errors';
import { registerSiteAuthCommands } from '@agentrhq/webcmd/plugin-runtime';
import { BASE, profileProbe } from './_lib.js';

async function navigateHome(page) {
  await page.goto(BASE, { waitUntil: 'none', settleMs: 1000 }).catch((error) => {
    const message = error?.message || String(error);
    if (/net::ERR_ABORTED|timed out|Timeout/i.test(message)) return;
    throw error;
  });
}

async function waitFor(page, label, predicate, timeout = 15) {
  const deadline = Date.now() + timeout * 1000;
  while (Date.now() < deadline) {
    const result = await page.evaluate(predicate);
    if (result) return result;
    await page.wait(0.25);
  }
  throw new CommandExecutionError(`Could not find the District ${label}`);
}

// District's login is an OTP modal opened from the header avatar, not a page.
async function openLoginModal(page) {
  await navigateHome(page);

  await waitFor(page, 'user avatar login entry point', `
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

  await waitFor(page, 'mobile number login modal', `
    (() => Boolean(document.querySelector('input[name="mobileNumber"], input[placeholder*="mobile number" i]')))
  `);
}

registerSiteAuthCommands({
  site: 'district',
  domain: 'www.district.in',
  loginUrl: BASE,
  openLogin: openLoginModal,
  columns: ['user_id', 'name', 'phone_number', 'email'],
  // Identity check needs a district.in page context for the profile fetch.
  verify: async (page) => {
    await navigateHome(page);
    return profileProbe(page);
  },
  quickCheck: async (page) => {
    try {
      await navigateHome(page);
      return { logged_in: true, ...await profileProbe(page) };
    } catch {
      return false;
    }
  },
});
