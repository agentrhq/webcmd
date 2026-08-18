import { AuthRequiredError, CommandExecutionError } from '@agentrhq/webcmd/errors';
import { registerSiteAuthCommands } from '@agentrhq/webcmd/plugin-runtime';
import { hasAmazonInAuthCookie } from './parsers.js';
import { DOMAIN, HOME_URL, SITE } from './shared.js';

async function hasAmazonInSessionCookies(page) {
  const cookies = await page.getCookies({ url: HOME_URL });
  return hasAmazonInAuthCookie(cookies.map((cookie) => cookie.name));
}

async function verifyAmazonInIdentity(page) {
  if (!await hasAmazonInSessionCookies(page)) {
    throw new AuthRequiredError(DOMAIN, 'Amazon.in authentication cookies are missing');
  }
  await page.goto(HOME_URL, { waitUntil: 'load' });
  await page.wait(2);
  const identity = await page.evaluate(`
    (() => {
      const greeting = (
        document.querySelector('#nav-link-accountList-nav-line-1')?.textContent || ''
      ).trim();
      if (/sign\\s*in/i.test(greeting)) return { kind: 'auth' };
      const match = greeting.match(/^Hello,?\\s+(.+)$/i);
      return match ? { user_name: match[1].trim() } : null;
    })()
  `);
  if (identity?.kind === 'auth') throw new AuthRequiredError(DOMAIN);
  if (!identity?.user_name) {
    throw new CommandExecutionError(
      'Amazon.in account greeting could not be read',
      'Open Amazon.in in the Webcmd browser and check for a robot challenge or layout change.',
    );
  }
  return identity;
}

registerSiteAuthCommands({
  site: SITE,
  domain: DOMAIN,
  loginUrl: HOME_URL,
  columns: ['user_name'],
  quickCheck: hasAmazonInSessionCookies,
  verify: verifyAmazonInIdentity,
  openLogin: async (page) => {
    await page.goto(HOME_URL, { waitUntil: 'load' });
    await page.wait(1);
    const loginUrl = await page.evaluate(`
      (() => document.querySelector('a[href*="/ap/signin"]')?.href || '')()
    `);
    if (!loginUrl) throw new CommandExecutionError('Amazon.in login link could not be found');
    await page.goto(loginUrl, { waitUntil: 'load' });
  },
});
