/**
 * Human-like behavioral layer for cloakbrowser (JS/TS).
 *
 * Activated via humanize: true in launch() / launchContext().
 * Patches page methods to use Bezier mouse curves, realistic typing, and smooth scrolling.
 *
 * Stealth-aware (fixes #110):
 *   - isInputElement / isSelectorFocused use CDP Isolated Worlds instead of page.evaluate
 *   - Shift symbol typing uses CDP Input.dispatchKeyEvent for isTrusted=true events
 *   - Falls back to page.evaluate only when CDP session is unavailable
 *
 * Patches all interaction methods:
 * click, dblclick, hover, type, fill, check, uncheck, selectOption,
 * press, pressSequentially, tap, dragTo, clear + Frame-level equivalents.
 *
 * ELEMENTHANDLE-LEVEL:
 *   click, dblclick, hover, type, fill, press, selectOption,
 *   check, uncheck, setChecked, tap, focus
 *   + $, $$, waitForSelector (nested elements are also patched)
 *
 * page.$(), page.$$(), page.waitForSelector() and Frame equivalents
 * return patched ElementHandles automatically.
 */

import type { Browser, BrowserContext, Page, Frame, CDPSession } from 'playwright-core';
import type { HumanConfig, HumanActionOptions } from './config.js';
import { resolveConfig, mergeConfig, rand, randRange, sleep } from './config.js';
import { RawMouse, RawKeyboard, humanMove, humanClick, clickTarget, humanIdle } from './mouse.js';
import { humanType, type HumanTypeTarget } from './keyboard.js';
import { scrollToElement, humanScrollIntoView } from './scroll.js';
import { patchPageElementHandles, patchFrameElementHandles, patchSingleElementHandle } from './elementhandle.js';
import {
  ensureActionable, ensureStable, checkPointerEvents,
  CHECKS_CLICK, CHECKS_HOVER, CHECKS_INPUT, CHECKS_FOCUS, CHECKS_CHECK,
  type CheckName,
} from './actionability.js';

export type { HumanConfig } from './config.js';
export { resolveConfig, mergeConfig } from './config.js';
export { humanMove, humanClick, clickTarget, humanIdle } from './mouse.js';
export { humanType } from './keyboard.js';
export { scrollToElement, humanScrollIntoView } from './scroll.js';
export { patchSingleElementHandle } from './elementhandle.js';

// --- Platform-aware select-all shortcut (macOS uses Meta, others use Control) ---
const SELECT_ALL = process.platform === 'darwin' ? 'Meta+a' : 'Control+a';


// ============================================================================
// CDP Isolated World — stealth DOM evaluation
// ============================================================================

/**
 * Manages a CDP isolated execution context for DOM reads.
 * Produces clean Error.stack traces (no 'eval at evaluate :302:')
 * and is invisible to querySelector monkey-patches in the main world.
 *
 * Context ID is invalidated on navigation and auto-recreated on next call.
 */
class StealthEval {
  private cdp: CDPSession | null = null;
  private cdpPromise: Promise<CDPSession> | null = null;
  private contextId: number | null = null;
  private page: Page;
  private disposed = false;

  constructor(page: Page) {
    this.page = page;
  }

  private async ensureCdp(): Promise<CDPSession> {
    if (this.disposed) throw new Error('Humanizer has been disposed.');
    if (this.cdp) return this.cdp;
    if (!this.cdpPromise) {
      this.cdpPromise = this.page.context().newCDPSession(this.page).then(async cdp => {
        if (this.disposed) {
          await cdp.detach().catch(() => {});
          throw new Error('Humanizer has been disposed.');
        }
        this.cdp = cdp;
        return cdp;
      });
    }
    return this.cdpPromise;
  }

  private async createWorld(): Promise<number> {
    const cdp = await this.ensureCdp();
    const tree = await cdp.send('Page.getFrameTree');
    const frameId = tree.frameTree.frame.id;
    const result = await cdp.send('Page.createIsolatedWorld', {
      frameId,
      worldName: '',
      grantUniveralAccess: true,
    });
    const ctxId = result.executionContextId;
    this.contextId = ctxId;
    return ctxId;
  }

  /**
   * Evaluate a JS expression in the isolated world.
   * Auto-recreates the world if the context was invalidated (navigation).
   * Returns the result value, or undefined on failure.
   */
  async evaluate(expression: string): Promise<any> {
    if (this.contextId === null) {
      await this.createWorld();
    }

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const cdp = await this.ensureCdp();
        const result = await cdp.send('Runtime.evaluate', {
          expression,
          contextId: this.contextId!,
          returnByValue: true,
        });

        if (result.exceptionDetails) {
          // Context was likely invalidated by navigation
          if (attempt === 0) {
            await this.createWorld();
            continue;
          }
          return undefined;
        }

        return result.result?.value;
      } catch {
        if (attempt === 0) {
          this.contextId = null;
          try {
            await this.createWorld();
          } catch {
            return undefined;
          }
          continue;
        }
        return undefined;
      }
    }
    return undefined;
  }

  /** Mark context as stale — call after navigation. */
  invalidate(): void {
    this.contextId = null;
  }

  /** Get the underlying CDP session (reused for Input.dispatchKeyEvent etc.). */
  async getCdpSession(): Promise<CDPSession> {
    return this.ensureCdp();
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    const cdp = this.cdp;
    const pending = this.cdpPromise;
    this.cdp = null;
    this.cdpPromise = null;
    this.contextId = null;
    if (cdp) await cdp.detach().catch(() => {});
    else await pending?.catch(() => {});
  }
}


// ============================================================================
// Cursor state
// ============================================================================

class CursorState {
  x = 0;
  y = 0;
  initialized = false;
}

const patchedFrames = new WeakMap<Page, Set<Frame>>();

export function restorePatchedFrames(page: Page): void {
  for (const frame of patchedFrames.get(page) ?? []) {
    const descriptors = (frame as any)._humanRestoreDescriptors as Map<PropertyKey, PropertyDescriptor | undefined> | undefined;
    if (!descriptors) continue;
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(frame, key, descriptor);
      else Reflect.deleteProperty(frame, key);
    }
  }
  patchedFrames.delete(page);
}

export function createCursorState(): CursorState {
  return new CursorState();
}


// ============================================================================
// Stealth DOM queries — isolated world with evaluate fallback
// ============================================================================

/**
 * Check if selector matches an input/textarea/contenteditable element.
 * Uses CDP Isolated World when available — invisible to main world.
 */
async function isInputElement(
  stealth: StealthEval | null,
  page: Page,
  selector: string,
): Promise<boolean> {
  if (stealth) {
    try {
      const escaped = JSON.stringify(selector);
      const result = await stealth.evaluate(`
        (() => {
          const el = document.querySelector(${escaped});
          if (!el) return false;
          const tag = el.tagName.toLowerCase();
          return tag === 'input' || tag === 'textarea'
            || el.getAttribute('contenteditable') === 'true';
        })()
      `);
      return !!result;
    } catch {
      // Fall through to page.evaluate
    }
  }

  // Fallback: page.evaluate (detectable — should only happen if CDP fails)
  return page.evaluate((sel: string) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const tag = el.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea'
      || el.getAttribute('contenteditable') === 'true';
  }, selector).catch(() => false);
}

async function selectorHumanTypeTarget(
  stealth: StealthEval | null,
  page: Page,
  selector: string,
  sensitive?: boolean,
): Promise<HumanTypeTarget | undefined> {
  if (stealth) {
    try {
      const escaped = JSON.stringify(selector);
      const target = await stealth.evaluate(`
        (() => {
          const el = document.querySelector(${escaped});
          return el ? {
            tag: el.tagName.toLowerCase(),
            type: el.getAttribute('type'),
            autocomplete: el.getAttribute('autocomplete'),
            contentEditable: el.isContentEditable,
            sensitive: ${Boolean(sensitive)},
          } : undefined;
        })()
      `);
      if (target) return target;
    } catch {
      // Fall through to page.evaluate.
    }
  }

  return page.evaluate(({ selector, sensitive }) => {
    const el = document.querySelector(selector);
    return el ? {
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type'),
      autocomplete: el.getAttribute('autocomplete'),
      contentEditable: (el as HTMLElement).isContentEditable,
      sensitive,
    } : undefined;
  }, { selector, sensitive: Boolean(sensitive) }).catch(() => undefined);
}

/**
 * Check if the element matching selector is currently focused.
 * Uses CDP Isolated World when available — invisible to main world.
 */
async function isSelectorFocused(
  stealth: StealthEval | null,
  page: Page,
  selector: string,
): Promise<boolean> {
  if (stealth) {
    try {
      const escaped = JSON.stringify(selector);
      const result = await stealth.evaluate(`
        (() => {
          const el = document.querySelector(${escaped});
          return el === document.activeElement;
        })()
      `);
      return !!result;
    } catch {
      // Fall through to page.evaluate
    }
  }

  return page.evaluate((sel: string) => {
    const el = document.querySelector(sel);
    return el === document.activeElement;
  }, selector).catch(() => false);
}


// ============================================================================
// Page-level patching
// ============================================================================

/**
 * Replace page methods with human-like implementations.
 */
export function patchPage(page: Page, cfg: HumanConfig, cursor: CursorState, signal?: AbortSignal): void {
  const originals = {
    click: page.click.bind(page),
    dblclick: page.dblclick.bind(page),
    hover: page.hover.bind(page),
    type: page.type.bind(page),
    fill: page.fill.bind(page),
    check: page.check.bind(page),
    uncheck: page.uncheck.bind(page),
    selectOption: page.selectOption.bind(page),
    press: page.press.bind(page),
    goto: page.goto.bind(page),
    isChecked: page.isChecked.bind(page),
    mouseMove: page.mouse.move.bind(page.mouse),
    mouseClick: page.mouse.click.bind(page.mouse),
    mouseDblclick: page.mouse.dblclick.bind(page.mouse),
    mouseWheel: page.mouse.wheel.bind(page.mouse),
    mouseDown: page.mouse.down.bind(page.mouse),
    mouseUp: page.mouse.up.bind(page.mouse),
    keyboardType: page.keyboard.type.bind(page.keyboard),
    keyboardDown: page.keyboard.down.bind(page.keyboard),
    keyboardUp: page.keyboard.up.bind(page.keyboard),
    keyboardPress: page.keyboard.press.bind(page.keyboard),
    keyboardInsertText: page.keyboard.insertText.bind(page.keyboard),
  };

  (page as any)._original = originals;
  (page as any)._humanCfg = cfg;

  // --- Stealth infrastructure ---
  const stealth = new StealthEval(page);
  (page as any)._stealth = stealth;

  // CDP session for shift symbol typing (lazy-initialized, reuses stealth's session)
  let cdpSession: CDPSession | null = null;
  const ensureCdp = async (): Promise<CDPSession | null> => {
    if (!cdpSession) {
      try {
        cdpSession = await stealth.getCdpSession();
      } catch {}
    }
    return cdpSession;
  };

  const raw: RawMouse = {
    move: originals.mouseMove,
    down: originals.mouseDown,
    up: originals.mouseUp,
    wheel: originals.mouseWheel,
  };

  const rawKb: RawKeyboard = {
    down: originals.keyboardDown,
    up: originals.keyboardUp,
    type: originals.keyboardType,
    insertText: originals.keyboardInsertText,
  };

  async function ensureCursorInit(): Promise<void> {
    if (!cursor.initialized) {
      cursor.x = rand(cfg.initial_cursor_x[0], cfg.initial_cursor_x[1]);
      cursor.y = rand(cfg.initial_cursor_y[0], cfg.initial_cursor_y[1]);
      await originals.mouseMove(cursor.x, cursor.y);
      cursor.initialized = true;
    }
  }

  // --- goto (invalidate isolated world on navigation) ---
  const humanGoto = async (url: string, options?: {
    referer?: string;
    timeout?: number;
    waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit';
  }) => {
    const response = await originals.goto(url, options);
    stealth.invalidate();
    patchFrames(page, cfg, cursor, raw, rawKb, originals, stealth, signal);
    return response;
  };

  // --- click ---
  const humanClickFn = async (selector: string, options?: HumanActionOptions & { _skipChecks?: boolean }) => {
    await ensureCursorInit();
    const callCfg = mergeConfig(cfg, options?.human_config ?? options);
    const timeout = options?.timeout ?? 30000;
    const force = options?.force ?? false;
    const skipChecks = (options as any)?._skipChecks ?? false;
    const deadline = Date.now() + timeout;
    const remainingMs = () => Math.max(0, deadline - Date.now());

    if (!force && !skipChecks) {
      await ensureActionable(page, selector, CHECKS_CLICK, remainingMs(), force);
    }
    if (callCfg.idle_between_actions) {
      await humanIdle(raw, cursor.x, cursor.y, callCfg, signal);
    }
    const { box, cursorX, cursorY, didScroll } = await scrollToElement(page, raw, selector, cursor.x, cursor.y, callCfg, remainingMs(), signal);
    cursor.x = cursorX;
    cursor.y = cursorY;
    const isInput = await isInputElement(stealth, page, selector);
    let finalBox = box;
    if (!force && didScroll) {
      await ensureStable(page, selector, remainingMs());
      finalBox = await page.locator(selector).first().boundingBox({ timeout: Math.max(1, remainingMs()) }) ?? box;
    }
    const target = clickTarget(finalBox, isInput, callCfg);
    if (!force) {
      await checkPointerEvents(page, selector, target.x, target.y, stealth, remainingMs());
    }
    await humanMove(raw, cursor.x, cursor.y, target.x, target.y, callCfg, signal);
    cursor.x = target.x;
    cursor.y = target.y;
    await humanClick(raw, isInput, callCfg, signal);
  };

  // --- dblclick ---
  const humanDblclickFn = async (selector: string, options?: HumanActionOptions) => {
    await ensureCursorInit();
    const callCfg = mergeConfig(cfg, options?.human_config ?? options);
    const timeout = options?.timeout ?? 30000;
    const force = options?.force ?? false;
    const deadline = Date.now() + timeout;
    const remainingMs = () => Math.max(0, deadline - Date.now());

    if (!force) await ensureActionable(page, selector, CHECKS_CLICK, remainingMs(), force);
    if (callCfg.idle_between_actions) {
      await humanIdle(raw, cursor.x, cursor.y, callCfg, signal);
    }
    const { box, cursorX, cursorY, didScroll } = await scrollToElement(page, raw, selector, cursor.x, cursor.y, callCfg, remainingMs(), signal);
    cursor.x = cursorX;
    cursor.y = cursorY;
    const isInput = await isInputElement(stealth, page, selector);
    let finalBox = box;
    if (!force && didScroll) {
      await ensureStable(page, selector, remainingMs());
      finalBox = await page.locator(selector).first().boundingBox({ timeout: Math.max(1, remainingMs()) }) ?? box;
    }
    const target = clickTarget(finalBox, isInput, callCfg);
    if (!force) {
      await checkPointerEvents(page, selector, target.x, target.y, stealth, remainingMs());
    }
    await humanMove(raw, cursor.x, cursor.y, target.x, target.y, callCfg, signal);
    cursor.x = target.x;
    cursor.y = target.y;
    await raw.down({ clickCount: 2 });
    await sleep(rand(30, 60), signal);
    await raw.up({ clickCount: 2 });
  };

  // --- hover ---
  const humanHoverFn = async (selector: string, options?: HumanActionOptions & { _skipChecks?: boolean }) => {
    await ensureCursorInit();
    const callCfg = mergeConfig(cfg, options?.human_config ?? options);
    const timeout = options?.timeout ?? 30000;
    const force = options?.force ?? false;
    const skipChecks = (options as any)?._skipChecks ?? false;
    const deadline = Date.now() + timeout;
    const remainingMs = () => Math.max(0, deadline - Date.now());

    if (!force && !skipChecks) await ensureActionable(page, selector, CHECKS_HOVER, remainingMs(), force);
    if (callCfg.idle_between_actions) {
      await humanIdle(raw, cursor.x, cursor.y, callCfg, signal);
    }
    const { box, cursorX, cursorY, didScroll } = await scrollToElement(page, raw, selector, cursor.x, cursor.y, callCfg, remainingMs(), signal);
    cursor.x = cursorX;
    cursor.y = cursorY;
    let finalBox = box;
    if (!force && didScroll) {
      await ensureStable(page, selector, remainingMs());
      finalBox = await page.locator(selector).first().boundingBox({ timeout: Math.max(1, remainingMs()) }) ?? box;
    }
    const target = clickTarget(finalBox, false, callCfg);
    if (!force) {
      await checkPointerEvents(page, selector, target.x, target.y, stealth, remainingMs());
    }
    await humanMove(raw, cursor.x, cursor.y, target.x, target.y, callCfg, signal);
    cursor.x = target.x;
    cursor.y = target.y;
  };

  // --- type ---
  const humanTypeFn = async (selector: string, text: string, options?: HumanActionOptions) => {
    const callCfg = mergeConfig(cfg, options?.human_config ?? options);
    const timeout = options?.timeout ?? 30000;
    const force = options?.force ?? false;
    const deadline = Date.now() + timeout;
    const remainingMs = () => Math.max(0, deadline - Date.now());

    if (!force) await ensureActionable(page, selector, CHECKS_INPUT, remainingMs(), force);
    await sleep(randRange(callCfg.field_switch_delay), signal);
    await humanClickFn(selector, { _skipChecks: true, timeout: remainingMs(), force, human_config: options?.human_config } as any);
    await sleep(rand(100, 250), signal);
    const cdp = await ensureCdp();
    const target = await selectorHumanTypeTarget(stealth, page, selector, options?.sensitive);
    await humanType(page, rawKb, text, callCfg, cdp, target, undefined, signal);
  };

  // --- fill (clears existing content first) ---
  const humanFillFn = async (selector: string, value: string, options?: HumanActionOptions) => {
    const callCfg = mergeConfig(cfg, options?.human_config ?? options);
    const timeout = options?.timeout ?? 30000;
    const force = options?.force ?? false;
    const deadline = Date.now() + timeout;
    const remainingMs = () => Math.max(0, deadline - Date.now());

    if (!force) await ensureActionable(page, selector, CHECKS_INPUT, remainingMs(), force);
    await sleep(randRange(callCfg.field_switch_delay), signal);
    await humanClickFn(selector, { _skipChecks: true, timeout: remainingMs(), force, human_config: options?.human_config } as any);
    await sleep(rand(100, 250), signal);
    await originals.keyboardPress(SELECT_ALL);
    await sleep(rand(30, 80), signal);
    await originals.keyboardPress('Backspace');
    await sleep(rand(50, 150), signal);
    const cdp = await ensureCdp();
    const target = await selectorHumanTypeTarget(stealth, page, selector, options?.sensitive);
    await humanType(page, rawKb, value, callCfg, cdp, target, undefined, signal);
  };

  // --- clear ---
  const humanClearFn = async (selector: string, options?: HumanActionOptions) => {
    const timeout = options?.timeout ?? 30000;
    const force = options?.force ?? false;
    const deadline = Date.now() + timeout;
    const remainingMs = () => Math.max(0, deadline - Date.now());

    if (!force) await ensureActionable(page, selector, CHECKS_FOCUS, remainingMs(), force);
    if (!await isSelectorFocused(stealth, page, selector)) {
      await humanClickFn(selector, { _skipChecks: true, timeout: remainingMs(), force, human_config: options?.human_config } as any);
    }
    await sleep(rand(50, 150), signal);
    await originals.keyboardPress(SELECT_ALL);
    await sleep(rand(30, 80), signal);
    await originals.keyboardPress('Backspace');
  };

  // --- check ---
  const humanCheckFn = async (selector: string, options?: HumanActionOptions) => {
    const callCfg = mergeConfig(cfg, options?.human_config ?? options);
    const timeout = options?.timeout ?? 30000;
    const force = options?.force ?? false;
    const deadline = Date.now() + timeout;
    const remainingMs = () => Math.max(0, deadline - Date.now());

    if (!force) await ensureActionable(page, selector, CHECKS_CHECK, remainingMs(), force);
    if (callCfg.idle_between_actions) {
      await humanIdle(raw, cursor.x, cursor.y, callCfg, signal);
    }
    const checked = await originals.isChecked(selector).catch(() => false);
    if (!checked) {
      await humanClickFn(selector, { _skipChecks: true, timeout: remainingMs(), force, human_config: options?.human_config } as any);
    }
  };

  // --- uncheck ---
  const humanUncheckFn = async (selector: string, options?: HumanActionOptions) => {
    const callCfg = mergeConfig(cfg, options?.human_config ?? options);
    const timeout = options?.timeout ?? 30000;
    const force = options?.force ?? false;
    const deadline = Date.now() + timeout;
    const remainingMs = () => Math.max(0, deadline - Date.now());

    if (!force) await ensureActionable(page, selector, CHECKS_CHECK, remainingMs(), force);
    if (callCfg.idle_between_actions) {
      await humanIdle(raw, cursor.x, cursor.y, callCfg, signal);
    }
    const checked = await originals.isChecked(selector).catch(() => true);
    if (checked) {
      await humanClickFn(selector, { _skipChecks: true, timeout: remainingMs(), force, human_config: options?.human_config } as any);
    }
  };

  // --- selectOption ---
  const humanSelectOptionFn = async (selector: string, values: any, options?: HumanActionOptions) => {
    const timeout = options?.timeout ?? 30000;
    const force = options?.force ?? false;
    const deadline = Date.now() + timeout;
    const remainingMs = () => Math.max(0, deadline - Date.now());

    if (!force) await ensureActionable(page, selector, CHECKS_FOCUS, remainingMs(), force);
    await humanHoverFn(selector, { _skipChecks: true, timeout: remainingMs(), force, human_config: options?.human_config } as any);
    await sleep(rand(100, 300), signal);
    return originals.selectOption(selector, values, options);
  };

  // --- press (checks focus first — avoids redundant mouse moves) ---
  const humanPressFn = async (selector: string, key: string, options?: HumanActionOptions) => {
    const timeout = options?.timeout ?? 30000;
    const force = options?.force ?? false;
    const deadline = Date.now() + timeout;
    const remainingMs = () => Math.max(0, deadline - Date.now());

    if (!force) await ensureActionable(page, selector, CHECKS_FOCUS, remainingMs(), force);
    if (!await isSelectorFocused(stealth, page, selector)) {
      await humanClickFn(selector, { _skipChecks: true, timeout: remainingMs(), force, human_config: options?.human_config } as any);
    }
    await sleep(rand(50, 150), signal);
    await originals.keyboardPress(key);
  };

  // --- pressSequentially ---
  const humanPressSequentiallyFn = async (selector: string, text: string, options?: HumanActionOptions) => {
    const callCfg = mergeConfig(cfg, options?.human_config ?? options);
    const timeout = options?.timeout ?? 30000;
    const force = options?.force ?? false;
    const deadline = Date.now() + timeout;
    const remainingMs = () => Math.max(0, deadline - Date.now());

    if (!force) await ensureActionable(page, selector, CHECKS_FOCUS, remainingMs(), force);
    if (!await isSelectorFocused(stealth, page, selector)) {
      await humanClickFn(selector, { _skipChecks: true, timeout: remainingMs(), force, human_config: options?.human_config } as any);
    }
    await sleep(rand(100, 250), signal);
    const cdp = await ensureCdp();
    const target = await selectorHumanTypeTarget(stealth, page, selector, options?.sensitive);
    await humanType(page, rawKb, text, callCfg, cdp, target, undefined, signal);
  };

  // --- tap ---
  const humanTapFn = async (selector: string, options?: HumanActionOptions) => {
    await humanClickFn(selector, options);
  };

  // Assign page-level patches
  (page as any).goto = humanGoto;
  (page as any).click = humanClickFn;
  (page as any).dblclick = humanDblclickFn;
  (page as any).hover = humanHoverFn;
  (page as any).type = humanTypeFn;
  (page as any).fill = humanFillFn;
  (page as any).check = humanCheckFn;
  (page as any).uncheck = humanUncheckFn;
  (page as any).selectOption = humanSelectOptionFn;
  (page as any).press = humanPressFn;
  (page as any).pressSequentially = humanPressSequentiallyFn;
  (page as any).tap = humanTapFn;
  (page as any).clear = humanClearFn;

  // --- mouse patches ---
  page.mouse.move = async (x: number, y: number, options?: {
    steps?: number;
  }) => {
    await ensureCursorInit();
    await humanMove(raw, cursor.x, cursor.y, x, y, cfg, signal);
    cursor.x = x;
    cursor.y = y;
  };

  page.mouse.click = async (x: number, y: number, options?: {
    button?: 'left' | 'right' | 'middle';
    clickCount?: number;
    delay?: number;
  }) => {
    await ensureCursorInit();
    await humanMove(raw, cursor.x, cursor.y, x, y, cfg, signal);
    cursor.x = x;
    cursor.y = y;
    await humanClick(raw, false, cfg, signal);
  };

  // --- keyboard patches ---
  page.keyboard.type = async (text: string, options?: { delay?: number }) => {
    const cdp = await ensureCdp();
    await humanType(page, rawKb, text, cfg, cdp, undefined, undefined, signal);
  };

  // Store helpers for frame patching
  (page as any)._humanCursor = cursor;
  (page as any)._humanRaw = raw;
  (page as any)._humanRawKb = rawKb;
  (page as any)._humanOriginals = originals;
  (page as any)._humanClickFn = humanClickFn;
  (page as any)._humanHoverFn = humanHoverFn;
  (page as any)._humanClearFn = humanClearFn;
  (page as any)._humanPressFn = humanPressFn;
  (page as any)._humanPressSequentiallyFn = humanPressSequentiallyFn;
  (page as any)._humanTapFn = humanTapFn;
  (page as any)._ensureCursorInit = ensureCursorInit;

  // Initialize cursor immediately so it doesn't visibly jump from (0,0)
  cursor.x = rand(cfg.initial_cursor_x[0], cfg.initial_cursor_x[1]);
  cursor.y = rand(cfg.initial_cursor_y[0], cfg.initial_cursor_y[1]);
  originals.mouseMove(cursor.x, cursor.y).then(() => {
    cursor.initialized = true;
  }).catch(() => {});

  // --- Patch Frame-level methods (for sub-frames) ---
  patchFrames(page, cfg, cursor, raw, rawKb, originals, stealth, signal);

  // --- Patch ElementHandle selectors (page.$, page.$$, page.waitForSelector) ---
  patchPageElementHandles(page, cfg, cursor, raw, rawKb, originals, stealth, signal);
}


// ============================================================================
// Frame-level patching
// ============================================================================

/**
 * Patch Frame methods so Locator-based calls go through humanization.
 * All 13 methods patched: click, dblclick, hover, type, fill, check, uncheck,
 * selectOption, press, pressSequentially, tap, clear, dragAndDrop.
 */
function patchFrames(
  page: Page,
  cfg: HumanConfig,
  cursor: CursorState,
  raw: RawMouse,
  rawKb: RawKeyboard,
  originals: any,
  stealth: StealthEval,
  signal?: AbortSignal,
): void {
  for (const frame of iterFrames(page)) {
    patchSingleFrame(frame, page, cfg, cursor, raw, rawKb, originals, stealth, signal);
    // Patch frame-level ElementHandle selectors ($, $$, waitForSelector)
    patchFrameElementHandles(frame, page, cfg, cursor, raw, rawKb, originals, stealth, signal);
  }
}

function firstFrameLocator(frame: Frame, selector: string): any {
  const locator = frame.locator(selector) as any;
  return typeof locator.first === 'function' ? locator.first() : locator;
}

async function frameHumanTypeTarget(
  frame: Frame,
  selector: string,
  sensitive?: boolean,
): Promise<HumanTypeTarget | undefined> {
  return firstFrameLocator(frame, selector).evaluate((el: Element, sensitive: boolean) => ({
    tag: el.tagName.toLowerCase(),
    type: el.getAttribute('type'),
    autocomplete: el.getAttribute('autocomplete'),
    contentEditable: (el as HTMLElement).isContentEditable,
    sensitive,
  }), Boolean(sensitive)).catch(() => undefined);
}

async function isFrameInputElement(frame: Frame, selector: string): Promise<boolean> {
  return firstFrameLocator(frame, selector).evaluate((el: Element) => {
    const tag = el.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea'
      || el.getAttribute('contenteditable') === 'true';
  }).catch(() => false);
}

async function isFrameSelectorFocused(frame: Frame, selector: string): Promise<boolean> {
  return firstFrameLocator(frame, selector).evaluate((el: Element) => el === document.activeElement)
    .catch(() => false);
}

function patchSingleFrame(
  frame: Frame,
  page: Page,
  cfg: HumanConfig,
  cursor: CursorState,
  raw: RawMouse,
  rawKb: RawKeyboard,
  originals: any,
  stealth: StealthEval,
  signal?: AbortSignal,
): void {
  if ((frame as any)._humanPatched) return;
  const frameKeys = [
    'click', 'dblclick', 'hover', 'type', 'fill', 'check', 'uncheck',
    'selectOption', 'press', 'pressSequentially', 'tap', 'clear', 'dragAndDrop',
    '$', '$$', 'waitForSelector', '_humanPatched', '_humanRestoreDescriptors',
  ] as const;
  (frame as any)._humanRestoreDescriptors = new Map(
    frameKeys.map(key => [key, Object.getOwnPropertyDescriptor(frame, key)]),
  );
  const frames = patchedFrames.get(page) ?? new Set<Frame>();
  frames.add(frame);
  patchedFrames.set(page, frames);
  (frame as any)._humanPatched = true;

  // Save originals for methods that need fallback
  const origFrameClick = frame.click.bind(frame);
  const origFrameDblclick = frame.dblclick.bind(frame);
  const origFrameHover = frame.hover.bind(frame);
  const origFrameType = frame.type.bind(frame);
  const origFrameFill = frame.fill.bind(frame);
  const origFrameCheck = frame.check.bind(frame);
  const origFrameUncheck = frame.uncheck.bind(frame);
  const origFrameSelectOption = frame.selectOption.bind(frame);
  const origFramePress = frame.press.bind(frame);
  const origFramePressSequentially = (frame as any).pressSequentially?.bind(frame);
  const origFrameTap = (frame as any).tap?.bind(frame);
  const origFrameDragAndDrop = frame.dragAndDrop.bind(frame);

  const moveToFrameSelector = async (
    selector: string,
    options: HumanActionOptions | undefined,
    inputBias: boolean,
    remainingMs: () => number,
  ) => {
    const callCfg = mergeConfig(cfg, options?.human_config ?? options);
    if (callCfg.idle_between_actions) {
      await humanIdle(raw, cursor.x, cursor.y, callCfg, signal);
    }

    const locator = firstFrameLocator(frame, selector);
    if (typeof locator.scrollIntoViewIfNeeded === 'function') {
      await locator.scrollIntoViewIfNeeded({ timeout: Math.max(1, remainingMs()) }).catch(() => undefined);
    }
    const box = await locator.boundingBox({ timeout: Math.max(1, remainingMs()) }).catch(() => null);
    if (!box) return null;

    const isInput = inputBias || await isFrameInputElement(frame, selector);
    const target = clickTarget(box, isInput, callCfg);
    await humanMove(raw, cursor.x, cursor.y, target.x, target.y, callCfg, signal);
    cursor.x = target.x;
    cursor.y = target.y;
    return { callCfg, isInput };
  };

  const frameClick = async (selector: string, options?: HumanActionOptions) => {
    const timeout = options?.timeout ?? 30000;
    const deadline = Date.now() + timeout;
    const remainingMs = () => Math.max(0, deadline - Date.now());
    const moved = await moveToFrameSelector(selector, options, false, remainingMs);
    if (!moved) return origFrameClick(selector, { ...options, timeout: Math.max(1, remainingMs()) });
    await humanClick(raw, moved.isInput, moved.callCfg, signal);
  };

  const getFrameCdp = async () => stealth.getCdpSession().catch(() => null);

  const frameHover = async (selector: string, options?: HumanActionOptions) => {
    const timeout = options?.timeout ?? 30000;
    const deadline = Date.now() + timeout;
    const remainingMs = () => Math.max(0, deadline - Date.now());
    const moved = await moveToFrameSelector(selector, options, false, remainingMs);
    if (!moved) return origFrameHover(selector, { ...options, timeout: Math.max(1, remainingMs()) });
  };

  (frame as any).click = frameClick;

  (frame as any).dblclick = async (selector: string, options?: HumanActionOptions) => {
    const timeout = options?.timeout ?? 30000;
    const deadline = Date.now() + timeout;
    const remainingMs = () => Math.max(0, deadline - Date.now());
    const moved = await moveToFrameSelector(selector, options, false, remainingMs);
    if (!moved) return origFrameDblclick(selector, { ...options, timeout: Math.max(1, remainingMs()) });
    await raw.down({ clickCount: 2 });
    await sleep(rand(30, 60), signal);
    await raw.up({ clickCount: 2 });
  };

  (frame as any).hover = frameHover;

  (frame as any).type = async (selector: string, text: string, options?: HumanActionOptions) => {
    const callCfg = mergeConfig(cfg, options?.human_config ?? options);
    await sleep(randRange(callCfg.field_switch_delay), signal);
    await frameClick(selector, options);
    await sleep(rand(100, 250), signal);
    const cdp = await getFrameCdp();
    const target = await frameHumanTypeTarget(frame, selector, options?.sensitive);
    await humanType(page, rawKb, text, callCfg, cdp, target, undefined, signal)
      .catch(error => {
        if (signal?.aborted) throw error;
        return origFrameType(selector, text, options);
      });
  };

  (frame as any).fill = async (selector: string, value: string, options?: HumanActionOptions) => {
    const callCfg = mergeConfig(cfg, options?.human_config ?? options);
    await sleep(randRange(callCfg.field_switch_delay), signal);
    await frameClick(selector, options);
    await sleep(rand(100, 250), signal);
    await originals.keyboardPress(SELECT_ALL);
    await sleep(rand(30, 80), signal);
    await originals.keyboardPress('Backspace');
    await sleep(rand(50, 150), signal);
    const cdp = await getFrameCdp();
    const target = await frameHumanTypeTarget(frame, selector, options?.sensitive);
    await humanType(page, rawKb, value, callCfg, cdp, target, undefined, signal)
      .catch(error => {
        if (signal?.aborted) throw error;
        return origFrameFill(selector, value, options);
      });
  };

  (frame as any).check = async (selector: string, options?: HumanActionOptions) => {
    const locator = firstFrameLocator(frame, selector);
    if (typeof locator.isChecked !== 'function') return origFrameCheck(selector, options);
    const checked = await locator.isChecked();
    if (!checked) await frameClick(selector, options).catch(error => {
      if (signal?.aborted) throw error;
      return origFrameCheck(selector, options);
    });
  };

  (frame as any).uncheck = async (selector: string, options?: HumanActionOptions) => {
    const locator = firstFrameLocator(frame, selector);
    if (typeof locator.isChecked !== 'function') return origFrameUncheck(selector, options);
    const checked = await locator.isChecked();
    if (checked) await frameClick(selector, options).catch(error => {
      if (signal?.aborted) throw error;
      return origFrameUncheck(selector, options);
    });
  };

  (frame as any).selectOption = async (selector: string, values: any, options?: HumanActionOptions) => {
    await frameHover(selector, options);
    await sleep(rand(100, 300), signal);
    return origFrameSelectOption(selector, values, options);
  };

  (frame as any).press = async (selector: string, key: string, options?: HumanActionOptions) => {
    if (!await isFrameSelectorFocused(frame, selector)) {
      await frameClick(selector, options);
    }
    await sleep(rand(50, 150), signal);
    await originals.keyboardPress(key);
  };

  (frame as any).pressSequentially = async (selector: string, text: string, options?: HumanActionOptions) => {
    const callCfg = mergeConfig(cfg, options?.human_config ?? options);
    if (!await isFrameSelectorFocused(frame, selector)) {
      await frameClick(selector, options);
    }
    await sleep(rand(100, 250), signal);
    const cdp = await getFrameCdp();
    const target = await frameHumanTypeTarget(frame, selector, options?.sensitive);
    await humanType(page, rawKb, text, callCfg, cdp, target, undefined, signal)
      .catch(error => {
        if (signal?.aborted) throw error;
        return origFramePressSequentially?.(selector, text, options);
      });
  };

  (frame as any).tap = async (selector: string, options?: HumanActionOptions) => {
    await frameClick(selector, options).catch(error => {
      if (signal?.aborted) throw error;
      return origFrameTap?.(selector, options);
    });
  };

  (frame as any).clear = async (selector: string, options?: HumanActionOptions) => {
    if (!await isFrameSelectorFocused(frame, selector)) {
      await frameClick(selector, options);
    }
    await sleep(rand(50, 150), signal);
    await originals.keyboardPress(SELECT_ALL);
    await sleep(rand(30, 80), signal);
    await originals.keyboardPress('Backspace');
  };

  (frame as any).dragAndDrop = async (source: string, target: string, options?: {
    force?: boolean;
    noWaitAfter?: boolean;
    sourcePosition?: { x: number; y: number };
    strict?: boolean;
    targetPosition?: { x: number; y: number };
    timeout?: number;
    trial?: boolean;
  }) => {
    const timeout = options?.timeout ?? 30000;
    const deadline = Date.now() + timeout;
    const remainingMs = () => Math.max(1, deadline - Date.now());
    const srcBox = await firstFrameLocator(frame, source).boundingBox({ timeout: remainingMs() }).catch(() => null);
    const tgtBox = await firstFrameLocator(frame, target).boundingBox({ timeout: remainingMs() }).catch(() => null);

    if (srcBox && tgtBox) {
      const sx = srcBox.x + srcBox.width / 2;
      const sy = srcBox.y + srcBox.height / 2;
      const tx = tgtBox.x + tgtBox.width / 2;
      const ty = tgtBox.y + tgtBox.height / 2;

      await page.mouse.move(sx, sy);
      await sleep(rand(100, 200), signal);
      await originals.mouseDown();
      await sleep(rand(80, 150), signal);
      await page.mouse.move(tx, ty);
      await sleep(rand(80, 150), signal);
      await originals.mouseUp();
    } else {
      return origFrameDragAndDrop(source, target, { ...options, timeout: Math.max(1, remainingMs()) });
    }
  };
}


function* iterFrames(page: Page): Generator<Frame> {
  try {
    const mainFrame = page.mainFrame();
    yield mainFrame;
    for (const child of mainFrame.childFrames()) {
      yield child;
    }
  } catch {}
}


// ============================================================================
// Context-level patching
// ============================================================================

function patchContext(context: BrowserContext, cfg: HumanConfig): void {
  const cursor = new CursorState();
  for (const page of context.pages()) {
    patchPage(page, cfg, cursor);
  }
  context.on('page', (page: Page) => {
    if (!(page as any)._original) {
      patchPage(page, cfg, new CursorState());
    }
  });

  const origNewPage = context.newPage.bind(context);
  (context as any).newPage = async () => {
    const page = await origNewPage();
    if (!(page as any)._original) {
      patchPage(page, cfg, new CursorState());
    }
    return page;
  };
}


// ============================================================================
// Browser-level patching
// ============================================================================

function patchBrowser(browser: Browser, cfg: HumanConfig): void {
  for (const context of browser.contexts()) {
    patchContext(context, cfg);
  }

  const origNewContext = browser.newContext.bind(browser);
  (browser as any).newContext = async (options?: Parameters<typeof origNewContext>[0]) => {
    const context = await origNewContext(options);
    patchContext(context, cfg);
    return context;
  };

  const origNewPage = browser.newPage.bind(browser);
  (browser as any).newPage = async (options?: Parameters<typeof origNewPage>[0]) => {
    const page = await origNewPage(options);
    if (!(page as any)._original) {
      const ctx = page.context();
      if (!(ctx as any)._humanPatched) {
        patchContext(ctx, cfg);
        (ctx as any)._humanPatched = true;
      }
      patchPage(page, cfg, new CursorState());
    }
    return page;
  };
}

export { humanizePage } from './page.js';
