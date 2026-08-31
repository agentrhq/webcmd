/**
 * Page-only facade for the CloakHQ humanizer vendored from cloakbrowser@0.4.5
 * at git commit 5176971f45d02845d3d1c0adbbda0bc93addf747. See NOTICE.
 */
import type { Page } from 'playwright-core';
import { createCursorState, patchPage, resolveConfig, type HumanConfig } from './index.js';

const humanizedPages = new WeakSet<Page>();

export function humanizePage(page: Page, config?: Partial<HumanConfig>): Page {
  if (humanizedPages.has(page)) return page;
  patchPage(page, resolveConfig('default', config), createCursorState());
  humanizedPages.add(page);
  return page;
}
