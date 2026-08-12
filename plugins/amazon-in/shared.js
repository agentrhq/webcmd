import {
  ArgumentError,
  AuthRequiredError,
  CommandExecutionError,
} from '@agentrhq/webcmd/errors';
import { classifyPageState } from './parsers.js';

export const SITE = 'amazon-in';
export const DOMAIN = 'amazon.in';
export const HOME_URL = 'https://www.amazon.in/';
export const WISHLIST_URL = 'https://www.amazon.in/hz/wishlist/ls';

export function argumentValue(fn) {
  try {
    return fn();
  } catch (error) {
    if (error instanceof RangeError) throw new ArgumentError(error.message);
    throw error;
  }
}

export async function assertUsablePage(page, context) {
  const snapshot = await page.evaluate(`
    (() => ({ url: location.href, text: document.body?.innerText || '' }))()
  `);
  const state = classifyPageState(snapshot.url, snapshot.text);
  if (state === 'login') throw new AuthRequiredError(DOMAIN);
  if (state === 'robot') {
    throw new CommandExecutionError(
      `Amazon robot check blocked ${context}`,
      'Complete the visible challenge in the Webcmd browser, then retry.',
    );
  }
}

export async function gotoAmazon(page, url, context) {
  await page.goto(url, { waitUntil: 'load' });
  await page.wait(2);
  await assertUsablePage(page, context);
}
