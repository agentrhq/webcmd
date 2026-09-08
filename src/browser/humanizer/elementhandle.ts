/**
 * ElementHandle humanization for Playwright.
 *
 * Mirrors Puppeteer's ElementHandle patching architecture.
 * Patches page.$(), page.$$(), page.waitForSelector() to return humanized handles,
 * and patches all interaction methods on each ElementHandle instance.
 *
 * Playwright ElementHandle methods patched:
 *   click, dblclick, hover, type, fill, press, selectOption,
 *   check, uncheck, setChecked, tap, focus
 *   + $, $$, waitForSelector (nested elements are also patched)
 *
 * Stealth-aware:
 *   - Uses CDP DOM.describeNode when available to check element type
 *     (no main-world JS execution)
 *   - Falls back to el.evaluate() only when CDP is unavailable
 */

import type { Page, Frame, ElementHandle, CDPSession } from 'playwright-core';
import type { HumanConfig, HumanActionOptions } from './config.js';
import { rand, randRange, sleep, mergeConfig } from './config.js';
import { RawMouse, RawKeyboard, humanMove, humanClick, clickTarget, humanIdle } from './mouse.js';
import { humanType, type HumanTypeTarget } from './keyboard.js';
import { humanScrollIntoView } from './scroll.js';
import {
  ensureActionableHandle, checkPointerEventsHandle,
  CHECKS_CLICK, CHECKS_HOVER, CHECKS_INPUT, CHECKS_FOCUS, CHECKS_CHECK,
} from './actionability.js';

const patchedHandles = new WeakMap<Page, Map<ElementHandle, Map<PropertyKey, PropertyDescriptor | undefined>>>();
const ELEMENT_HANDLE_KEYS = [
  '$', '$$', 'waitForSelector', 'click', 'dblclick', 'hover', 'type', 'fill',
  'press', 'selectOption', 'check', 'uncheck', 'setChecked', 'tap', 'focus',
  'scrollIntoViewIfNeeded', '_humanPatched',
] as const;

export function restorePatchedElementHandles(page: Page): void {
  const handles = patchedHandles.get(page);
  if (!handles) return;
  for (const [handle, descriptors] of handles) {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(handle, key, descriptor);
      else Reflect.deleteProperty(handle, key);
    }
  }
  patchedHandles.delete(page);
}

// --- Platform-aware select-all shortcut ---
const SELECT_ALL = process.platform === 'darwin' ? 'Meta+a' : 'Control+a';

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new Error('Humanizer has been disposed.');
}


// ============================================================================
// Stealth ElementHandle input check — uses CDP DOM.describeNode
// ============================================================================

async function isInputElementHandle(
  stealth: any, // StealthEval from index.ts
  el: ElementHandle,
): Promise<boolean> {
  // Try CDP DOM.describeNode first (no main-world JS execution)
  if (stealth) {
    try {
      const cdp: CDPSession = await stealth.getCdpSession();
      // Playwright exposes the JSHandle's internal preview via _objectId or similar
      // We need the remote object ID. Try to get it via internal API.
      const impl = (el as any)._impl ?? (el as any)._object ?? el;
      const guid = (impl as any)._guid;

      // Use el.evaluate as a reliable fallback within stealth context
      // Playwright doesn't expose remoteObject directly like Puppeteer
    } catch { /* fallthrough */ }
  }

  // Fallback: el.evaluate (works reliably in Playwright)
  try {
    return await el.evaluate((node: any) => {
      const tag = node.tagName?.toLowerCase();
      return tag === 'input' || tag === 'textarea'
        || node.getAttribute?.('contenteditable') === 'true';
    });
  } catch {
    return false;
  }
}

async function elementHumanTypeTarget(
  cdp: CDPSession | null,
  el: ElementHandle,
  sensitive?: boolean,
): Promise<HumanTypeTarget | undefined> {
  if (cdp) {
    const objectId = (el as any)._objectId ?? (el as any)._impl?._objectId;
    if (!objectId) return undefined;
    try {
      const result = await cdp.send('DOM.describeNode', { objectId, depth: 0 });
      const node = (result as any).node;
      const attributes = new Map<string, string>();
      for (let index = 0; index < (node?.attributes?.length ?? 0); index += 2) {
        attributes.set(node.attributes[index], node.attributes[index + 1]);
      }
      return {
        tag: node?.nodeName?.toLowerCase(),
        type: attributes.get('type') ?? null,
        autocomplete: attributes.get('autocomplete') ?? null,
        contentEditable: attributes.get('contenteditable') === 'true',
        sensitive: Boolean(sensitive),
      };
    } catch {
      return undefined;
    }
  }
  return el.evaluate((node: Element, sensitive: boolean) => ({
    tag: node.tagName.toLowerCase(),
    type: node.getAttribute('type'),
    autocomplete: node.getAttribute('autocomplete'),
    contentEditable: (node as HTMLElement).isContentEditable,
    sensitive,
  }), Boolean(sensitive)).catch(() => undefined);
}


// ============================================================================
// CursorState type (matches index.ts)
// ============================================================================

interface CursorState {
  x: number;
  y: number;
  initialized: boolean;
}


// ============================================================================
// Patch a single Playwright ElementHandle
// ============================================================================

export function patchSingleElementHandle(
  el: ElementHandle,
  page: Page,
  cfg: HumanConfig,
  cursor: CursorState,
  raw: RawMouse,
  rawKb: RawKeyboard,
  originals: any,
  stealth: any,
  signal?: AbortSignal,
): void {
  if ((el as any)._humanPatched) return;
  const handles = patchedHandles.get(page) ?? new Map();
  handles.set(el, new Map(ELEMENT_HANDLE_KEYS.map(key => [key, Object.getOwnPropertyDescriptor(el, key)])));
  patchedHandles.set(page, handles);
  (el as any)._humanPatched = true;

  // Save originals
  const origElClick = el.click.bind(el);
  const origElDblclick = el.dblclick.bind(el);
  const origElHover = el.hover.bind(el);
  const origElType = el.type.bind(el);
  const origElFill = el.fill.bind(el);
  const origElPress = el.press.bind(el);
  const origElSelectOption = el.selectOption.bind(el);
  const origElCheck = el.check.bind(el);
  const origElUncheck = el.uncheck.bind(el);
  const origElSetChecked = (el as any).setChecked?.bind(el);
  const origElTap = el.tap.bind(el);
  const origElFocus = el.focus.bind(el);
  const origElScrollIntoViewIfNeeded = (el as any).scrollIntoViewIfNeeded?.bind(el);

  // Nested selectors
  const origEl$ = el.$.bind(el);
  const origEl$$ = el.$$.bind(el);
  const origElWaitForSelector = el.waitForSelector.bind(el);

  // --- Nested elements are also patched ---
  (el as any).$ = async (selector: string) => {
    const child = await origEl$(selector);
    if (child) patchSingleElementHandle(child, page, cfg, cursor, raw, rawKb, originals, stealth, signal);
    return child;
  };

  (el as any).$$ = async (selector: string) => {
    const children = await origEl$$(selector);
    for (const child of children) {
      patchSingleElementHandle(child, page, cfg, cursor, raw, rawKb, originals, stealth, signal);
    }
    return children;
  };

  (el as any).waitForSelector = async (selector: string, options?: {
    state?: 'attached' | 'detached' | 'visible' | 'hidden';
    strict?: boolean;
    timeout?: number;
  }) => {
    const child = await origElWaitForSelector(selector, options ?? {});
    if (child) patchSingleElementHandle(child, page, cfg, cursor, raw, rawKb, originals, stealth, signal);
    return child;
  };

  // --- Helper: get bounding box and move cursor to element ---
  // Accepts a per-call ``callCfg`` so type/fill overrides like
  // ``el.type(text, { human_config: { typing_delay: 30 } })`` or
  // ``el.type(text, { typing_delay: 30 })`` carry through to mouse movement
  // & idle timing for that single call.
  // Also scrolls the element into view first so off-screen elements work
  // (#129, #172 follow-up): otherwise boundingBox() returns null and we'd
  // silently fall back to the unpatched native method.
  const moveToElement = async (callCfg: HumanConfig = cfg) => {
    // Ensure cursor is initialized
    const ensureCursorInit = (page as any)._ensureCursorInit;
    if (ensureCursorInit) await ensureCursorInit();

    // Scroll into view first so boundingBox() returns coordinates even when
    // the element starts below the fold. Best-effort — if humanScrollIntoView
    // throws (e.g. detached element), we let boundingBox() decide whether to
    // proceed or fall back to the original method.
    try {
      const { cursorX, cursorY } = await humanScrollIntoView(
        page, raw,
        () => el.boundingBox(),
        cursor.x, cursor.y, callCfg, signal,
      );
      cursor.x = cursorX;
      cursor.y = cursorY;
    } catch (error) {
      if (signal?.aborted) throw error;
      // Let boundingBox() decide whether to proceed or fall back.
    }

    const box = await el.boundingBox();
    if (!box) return null;

    const isInp = await isInputElementHandle(stealth, el);
    const target = clickTarget(box, isInp, callCfg);

    if (callCfg.idle_between_actions) {
      await humanIdle(raw, cursor.x, cursor.y, callCfg, signal);
    }

    await humanMove(raw, cursor.x, cursor.y, target.x, target.y, callCfg, signal);
    cursor.x = target.x;
    cursor.y = target.y;
    return { box, isInp };
  };

  // --- el.click() ---
  (el as any).click = async (options?: HumanActionOptions & {
    button?: 'left' | 'right' | 'middle';
    clickCount?: number;
    delay?: number;
    force?: boolean;
    modifiers?: Array<'Alt' | 'Control' | 'ControlOrMeta' | 'Meta' | 'Shift'>;
    noWaitAfter?: boolean;
    position?: { x: number; y: number };
    trial?: boolean;
  }) => {
    const callCfg = mergeConfig(cfg, options?.human_config ?? options);
    const force = options?.force ?? false;
    const timeout = options?.timeout ?? 30000;
    const deadline = Date.now() + timeout;
    const remainingMs = () => Math.max(0, deadline - Date.now());
    if (!force) await ensureActionableHandle(el, CHECKS_CLICK, remainingMs(), force);
    const info = await moveToElement(callCfg);
    if (!info) {
      throwIfAborted(signal);
      return origElClick(options);
    }
    if (!force) await checkPointerEventsHandle(el, cursor.x, cursor.y, Math.min(remainingMs(), 5000));
    await humanClick(raw, info.isInp, callCfg, signal);
  };

  // --- el.dblclick() ---
  (el as any).dblclick = async (options?: HumanActionOptions & {
    button?: 'left' | 'right' | 'middle';
    delay?: number;
    force?: boolean;
    modifiers?: Array<'Alt' | 'Control' | 'ControlOrMeta' | 'Meta' | 'Shift'>;
    noWaitAfter?: boolean;
    position?: { x: number; y: number };
    trial?: boolean;
  }) => {
    const callCfg = mergeConfig(cfg, options?.human_config ?? options);
    const force = options?.force ?? false;
    const timeout = options?.timeout ?? 30000;
    const deadline = Date.now() + timeout;
    const remainingMs = () => Math.max(0, deadline - Date.now());
    if (!force) await ensureActionableHandle(el, CHECKS_CLICK, remainingMs(), force);
    const info = await moveToElement(callCfg);
    if (!info) {
      throwIfAborted(signal);
      return origElDblclick(options);
    }
    if (!force) await checkPointerEventsHandle(el, cursor.x, cursor.y, Math.min(remainingMs(), 5000));
    await raw.down({ clickCount: 2 });
    await sleep(rand(30, 60), signal);
    await raw.up({ clickCount: 2 });
  };

  // --- el.hover() ---
  (el as any).hover = async (options?: HumanActionOptions & {
    force?: boolean;
    modifiers?: Array<'Alt' | 'Control' | 'ControlOrMeta' | 'Meta' | 'Shift'>;
    position?: { x: number; y: number };
    trial?: boolean;
  }) => {
    const callCfg = mergeConfig(cfg, options?.human_config ?? options);
    const force = options?.force ?? false;
    const timeout = options?.timeout ?? 30000;
    const deadline = Date.now() + timeout;
    const remainingMs = () => Math.max(0, deadline - Date.now());
    if (!force) await ensureActionableHandle(el, CHECKS_HOVER, remainingMs(), force);
    const info = await moveToElement(callCfg);
    if (!info) {
      throwIfAborted(signal);
      return origElHover(options);
    }
  };

  // --- el.type() ---
  (el as any).type = async (text: string, options?: HumanActionOptions & {
    delay?: number;
    noWaitAfter?: boolean;
  }) => {
    const callCfg = mergeConfig(cfg, options?.human_config ?? options);
    const force = (options as any)?.force ?? false;
    const timeout = options?.timeout ?? 30000;
    const deadline = Date.now() + timeout;
    const remainingMs = () => Math.max(0, deadline - Date.now());
    if (!force) await ensureActionableHandle(el, CHECKS_INPUT, remainingMs(), force);
    const info = await moveToElement(callCfg);
    if (!info) {
      throwIfAborted(signal);
      return origElType(text, options);
    }
    if (!force) await checkPointerEventsHandle(el, cursor.x, cursor.y, Math.min(remainingMs(), 5000));
    await humanClick(raw, info.isInp, callCfg, signal);
    await sleep(rand(100, 250), signal);
    let cdpSession: CDPSession | null = null;
    try { cdpSession = await stealth?.getCdpSession(); } catch {}
    const target = await elementHumanTypeTarget(cdpSession, el, options?.sensitive);
    await humanType(page, rawKb, text, callCfg, cdpSession, target, undefined, signal);
  };

  // --- el.fill() ---
  (el as any).fill = async (value: string, options?: HumanActionOptions & {
    force?: boolean;
    noWaitAfter?: boolean;
  }) => {
    const callCfg = mergeConfig(cfg, options?.human_config ?? options);
    const force = options?.force ?? false;
    const timeout = options?.timeout ?? 30000;
    const deadline = Date.now() + timeout;
    const remainingMs = () => Math.max(0, deadline - Date.now());
    if (!force) await ensureActionableHandle(el, CHECKS_INPUT, remainingMs(), force);
    const info = await moveToElement(callCfg);
    if (!info) {
      throwIfAborted(signal);
      return origElFill(value, options);
    }
    if (!force) await checkPointerEventsHandle(el, cursor.x, cursor.y, Math.min(remainingMs(), 5000));
    await humanClick(raw, info.isInp, callCfg, signal);
    await sleep(rand(100, 250), signal);
    await originals.keyboardPress(SELECT_ALL);
    await sleep(rand(30, 80), signal);
    await originals.keyboardPress('Backspace');
    await sleep(rand(50, 150), signal);
    let cdpSession: CDPSession | null = null;
    try { cdpSession = await stealth?.getCdpSession(); } catch {}
    const target = await elementHumanTypeTarget(cdpSession, el, options?.sensitive);
    await humanType(page, rawKb, value, callCfg, cdpSession, target, undefined, signal);
  };

  // --- el.press() ---
  (el as any).press = async (key: string, options?: { delay?: number; noWaitAfter?: boolean; timeout?: number }) => {
    await sleep(rand(20, 60), signal);
    await originals.keyboardDown(key);
    await sleep(randRange(cfg.key_hold), signal);
    await originals.keyboardUp(key);
  };

  // --- el.selectOption() ---
  (el as any).selectOption = async (values: any, options?: {
    force?: boolean;
    noWaitAfter?: boolean;
    timeout?: number;
  }) => {
    const force = options?.force ?? false;
    const timeout = options?.timeout ?? 30000;
    const deadline = Date.now() + timeout;
    const remainingMs = () => Math.max(0, deadline - Date.now());
    if (!force) await ensureActionableHandle(el, CHECKS_FOCUS, remainingMs(), force);
    const info = await moveToElement();
    if (!info) {
      throwIfAborted(signal);
      return origElSelectOption(values, options);
    }
    await humanClick(raw, false, cfg, signal);
    await sleep(rand(100, 300), signal);
    return origElSelectOption(values, options);
  };

  // --- el.check() ---
  (el as any).check = async (options?: {
    force?: boolean;
    noWaitAfter?: boolean;
    position?: { x: number; y: number };
    timeout?: number;
    trial?: boolean;
  }) => {
    const force = options?.force ?? false;
    const timeout = options?.timeout ?? 30000;
    const deadline = Date.now() + timeout;
    const remainingMs = () => Math.max(0, deadline - Date.now());
    if (!force) await ensureActionableHandle(el, CHECKS_CHECK, remainingMs(), force);
    try {
      const checked = await el.isChecked();
      if (checked) return;
    } catch {}
    const info = await moveToElement();
    if (!info) {
      throwIfAborted(signal);
      return origElCheck(options);
    }
    if (!force) await checkPointerEventsHandle(el, cursor.x, cursor.y, Math.min(remainingMs(), 5000));
    await humanClick(raw, info.isInp, cfg, signal);
  };

  // --- el.uncheck() ---
  (el as any).uncheck = async (options?: {
    force?: boolean;
    noWaitAfter?: boolean;
    position?: { x: number; y: number };
    timeout?: number;
    trial?: boolean;
  }) => {
    const force = options?.force ?? false;
    const timeout = options?.timeout ?? 30000;
    const deadline = Date.now() + timeout;
    const remainingMs = () => Math.max(0, deadline - Date.now());
    if (!force) await ensureActionableHandle(el, CHECKS_CHECK, remainingMs(), force);
    try {
      const checked = await el.isChecked();
      if (!checked) return;
    } catch {}
    const info = await moveToElement();
    if (!info) {
      throwIfAborted(signal);
      return origElUncheck(options);
    }
    if (!force) await checkPointerEventsHandle(el, cursor.x, cursor.y, Math.min(remainingMs(), 5000));
    await humanClick(raw, info.isInp, cfg, signal);
  };

  // --- el.setChecked() ---
  if (origElSetChecked) {
    (el as any).setChecked = async (checked: boolean, options?: {
      force?: boolean;
      noWaitAfter?: boolean;
      position?: { x: number; y: number };
      timeout?: number;
      trial?: boolean;
    }) => {
      const force = options?.force ?? false;
      const timeout = options?.timeout ?? 30000;
      const deadline = Date.now() + timeout;
      const remainingMs = () => Math.max(0, deadline - Date.now());
      if (!force) await ensureActionableHandle(el, CHECKS_CHECK, remainingMs(), force);
      try {
        const current = await el.isChecked();
        if (current === checked) return;
      } catch {}
      const info = await moveToElement();
      if (!info) {
        throwIfAborted(signal);
        return origElSetChecked(checked, options);
      }
      if (!force) await checkPointerEventsHandle(el, cursor.x, cursor.y, Math.min(remainingMs(), 5000));
      await humanClick(raw, info.isInp, cfg, signal);
    };
  }

  // --- el.tap() ---
  (el as any).tap = async (options?: {
    force?: boolean;
    modifiers?: Array<'Alt' | 'Control' | 'ControlOrMeta' | 'Meta' | 'Shift'>;
    noWaitAfter?: boolean;
    position?: { x: number; y: number };
    timeout?: number;
    trial?: boolean;
  }) => {
    const info = await moveToElement();
    if (!info) {
      throwIfAborted(signal);
      return origElTap(options);
    }
    await humanClick(raw, info.isInp, cfg, signal);
  };

  // --- el.focus() ---
  // Move cursor humanly but use programmatic focus (no click side-effects).
  // Stock Playwright el.focus() never clicks — clicking would trigger onclick,
  // submit forms, navigate links, etc.
  (el as any).focus = async () => {
    await moveToElement();  // human-like Bézier cursor movement
    await origElFocus();    // programmatic focus, no click
  };

  // --- el.scrollIntoViewIfNeeded() ---
  // Playwright's native version snaps the page — a strong bot signal.
  // Replace with the same accelerate → cruise → decelerate → overshoot
  // wheel sequence used by page.click() etc. Falls back to the native
  // method if the element is detached or scrolling fails.
  if (origElScrollIntoViewIfNeeded) {
    (el as any).scrollIntoViewIfNeeded = async (options?: HumanActionOptions) => {
      const callCfg = mergeConfig(cfg, options?.human_config ?? options);
      const ensureCursorInit = (page as any)._ensureCursorInit;
      if (ensureCursorInit) await ensureCursorInit();
      try {
        const { cursorX, cursorY } = await humanScrollIntoView(
          page, raw,
          () => el.boundingBox(),
          cursor.x, cursor.y, callCfg, signal,
        );
        cursor.x = cursorX;
        cursor.y = cursorY;
      } catch (error) {
        if (signal?.aborted) throw error;
        return origElScrollIntoViewIfNeeded(options);
      }
    };
  }
}


// ============================================================================
// Page-level ElementHandle patching
// ============================================================================

export function patchPageElementHandles(
  page: Page,
  cfg: HumanConfig,
  cursor: CursorState,
  raw: RawMouse,
  rawKb: RawKeyboard,
  originals: any,
  stealth: any,
  signal?: AbortSignal,
): void {
  // Patch page.$() — only if the method exists
  if (typeof page.$ === 'function') {
    const orig$ = page.$.bind(page);
    (page as any).$ = async (selector: string) => {
      const el = await orig$(selector);
      if (el) patchSingleElementHandle(el, page, cfg, cursor, raw, rawKb, originals, stealth, signal);
      return el;
    };
  }

  // Patch page.$$()
  if (typeof page.$$ === 'function') {
    const orig$$ = page.$$.bind(page);
    (page as any).$$ = async (selector: string) => {
      const els = await orig$$(selector);
      for (const el of els) {
        patchSingleElementHandle(el, page, cfg, cursor, raw, rawKb, originals, stealth, signal);
      }
      return els;
    };
  }

  // Patch page.waitForSelector()
  if (typeof page.waitForSelector === 'function') {
    const origWaitForSelector = page.waitForSelector.bind(page);
    (page as any).waitForSelector = async (selector: string, options?: {
      state?: 'attached' | 'detached' | 'visible' | 'hidden';
      strict?: boolean;
      timeout?: number;
    }) => {
      const el = await origWaitForSelector(selector, options ?? {});
      if (el) patchSingleElementHandle(el, page, cfg, cursor, raw, rawKb, originals, stealth, signal);
      return el;
    };
  }
}


// ============================================================================
// Frame-level ElementHandle patching
// ============================================================================

export function patchFrameElementHandles(
  frame: Frame,
  page: Page,
  cfg: HumanConfig,
  cursor: CursorState,
  raw: RawMouse,
  rawKb: RawKeyboard,
  originals: any,
  stealth: any,
  signal?: AbortSignal,
): void {
  // Patch frame.$() — only if the method exists
  if (typeof frame.$ === 'function') {
    const origFrame$ = frame.$.bind(frame);
    (frame as any).$ = async (selector: string) => {
      const el = await origFrame$(selector);
      if (el) patchSingleElementHandle(el, page, cfg, cursor, raw, rawKb, originals, stealth, signal);
      return el;
    };
  }

  // Patch frame.$$()
  if (typeof frame.$$ === 'function') {
    const origFrame$$ = frame.$$.bind(frame);
    (frame as any).$$ = async (selector: string) => {
      const els = await origFrame$$(selector);
      for (const el of els) {
        patchSingleElementHandle(el, page, cfg, cursor, raw, rawKb, originals, stealth, signal);
      }
      return els;
    };
  }

  // Patch frame.waitForSelector()
  if (typeof frame.waitForSelector === 'function') {
    const origFrameWaitForSelector = frame.waitForSelector.bind(frame);
    (frame as any).waitForSelector = async (selector: string, options?: {
      state?: 'attached' | 'detached' | 'visible' | 'hidden';
      strict?: boolean;
      timeout?: number;
    }) => {
      const el = await origFrameWaitForSelector(selector, options ?? {});
      if (el) patchSingleElementHandle(el, page, cfg, cursor, raw, rawKb, originals, stealth, signal);
      return el;
    };
  }
}
