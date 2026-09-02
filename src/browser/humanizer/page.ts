/**
 * Page-only facade for the CloakHQ humanizer vendored from cloakbrowser@0.4.5
 * at git commit 5176971f45d02845d3d1c0adbbda0bc93addf747. See NOTICE.
 */
import type { Page } from 'playwright-core';
import { createCursorState, patchPage, resolveConfig, restorePatchedFrames, type HumanConfig } from './index.js';
import { restorePatchedElementHandles } from './elementhandle.js';

const humanizedPages = new WeakSet<Page>();
const pageSnapshots = new WeakMap<Page, {
  page: Map<PropertyKey, PropertyDescriptor | undefined>;
  mouse: Map<PropertyKey, PropertyDescriptor | undefined>;
  keyboard: Map<PropertyKey, PropertyDescriptor | undefined>;
  frames: Array<{ frame: object; descriptors: Map<PropertyKey, PropertyDescriptor | undefined> }>;
}>();
const disposalPromises = new WeakMap<Page, Promise<void>>();

const PAGE_KEYS = [
  'goto', 'click', 'dblclick', 'hover', 'type', 'fill', 'check', 'uncheck',
  'selectOption', 'press', 'pressSequentially', 'tap', 'clear', '_original',
  '$', '$$', 'waitForSelector',
  '_humanCfg', '_stealth', '_humanCursor', '_humanRaw', '_humanRawKb',
  '_humanOriginals', '_humanClickFn', '_humanHoverFn', '_humanClearFn',
  '_humanPressFn', '_humanPressSequentiallyFn', '_humanTapFn', '_ensureCursorInit',
] as const;

const MOUSE_KEYS = ['move', 'click', 'dblclick', 'wheel', 'down', 'up'] as const;
const KEYBOARD_KEYS = ['type', 'down', 'up', 'press', 'insertText'] as const;
const FRAME_KEYS = [
  'click', 'dblclick', 'hover', 'type', 'fill', 'check', 'uncheck',
  'selectOption', 'press', 'pressSequentially', 'tap', 'clear', 'dragAndDrop',
  '$', '$$', 'waitForSelector', '_humanPatched',
] as const;

function currentFrames(page: Page): object[] {
  try {
    const main = page.mainFrame();
    return [main, ...main.childFrames()];
  } catch {
    return [];
  }
}

export function humanizePage(page: Page, config?: Partial<HumanConfig>): Page {
  if (humanizedPages.has(page)) return page;
  disposalPromises.delete(page);
  pageSnapshots.set(page, {
    page: new Map(PAGE_KEYS.map(key => [key, Object.getOwnPropertyDescriptor(page, key)])),
    mouse: new Map(MOUSE_KEYS.map(key => [key, Object.getOwnPropertyDescriptor(page.mouse, key)])),
    keyboard: new Map(KEYBOARD_KEYS.map(key => [key, Object.getOwnPropertyDescriptor(page.keyboard, key)])),
    frames: currentFrames(page).map(frame => ({
      frame,
      descriptors: new Map(FRAME_KEYS.map(key => [key, Object.getOwnPropertyDescriptor(frame, key)])),
    })),
  });
  patchPage(page, resolveConfig('default', config), createCursorState());
  humanizedPages.add(page);
  return page;
}

export function restoreHumanizedPage(page: Page): void {
  const snapshot = pageSnapshots.get(page);
  if (!snapshot) return;
  const restore = (target: object, entries: Map<PropertyKey, PropertyDescriptor | undefined>) => {
    for (const [key, descriptor] of entries) {
      if (descriptor) Object.defineProperty(target, key, descriptor);
      else Reflect.deleteProperty(target, key);
    }
  };
  restore(page, snapshot.page);
  restore(page.mouse, snapshot.mouse);
  restore(page.keyboard, snapshot.keyboard);
  restorePatchedElementHandles(page);
  restorePatchedFrames(page);
  const frames = new Map(snapshot.frames.map(frame => [frame.frame, frame.descriptors]));
  for (const frame of currentFrames(page)) {
    const dynamic = (frame as { _humanRestoreDescriptors?: Map<PropertyKey, PropertyDescriptor | undefined> })._humanRestoreDescriptors;
    if (dynamic) frames.set(frame, dynamic);
  }
  for (const [frame, descriptors] of frames) restore(frame, descriptors);
  pageSnapshots.delete(page);
  humanizedPages.delete(page);
}

export function disposeHumanizedPage(page: Page): Promise<void> {
  const existing = disposalPromises.get(page);
  if (existing) return existing;
  const dispose = (async () => {
    const stealth = (page as unknown as { _stealth?: { dispose?: () => Promise<void> } })._stealth;
    await stealth?.dispose?.();
    restoreHumanizedPage(page);
  })();
  disposalPromises.set(page, dispose);
  return dispose;
}
