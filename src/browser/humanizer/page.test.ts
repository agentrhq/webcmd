import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HumanConfig } from './config.js';
import * as humanizer from './index.js';
import { disposeHumanizedPage, humanizePage } from './page.js';

const FAST_HUMAN_CONFIG: Partial<HumanConfig> = {
  initial_cursor_x: [0, 0],
  initial_cursor_y: [0, 0],
  mouse_min_steps: 6,
  mouse_max_steps: 6,
  mouse_steps_divisor: 1,
  mouse_wobble_max: 0,
  mouse_overshoot_chance: 0,
  mouse_burst_size: [100, 100],
  mouse_burst_pause: [0, 0],
  click_aim_delay_input: [0, 0],
  click_aim_delay_button: [0, 0],
  click_hold_input: [0, 0],
  click_hold_button: [0, 0],
  key_hold: [0, 0],
  field_switch_delay: [0, 0],
  shift_down_delay: [0, 0],
  shift_up_delay: [0, 0],
  typing_delay: 20,
  typing_delay_spread: 10,
  typing_pause_chance: 0,
  typing_pause_range: [0, 0],
  mistype_chance: 0,
  scroll_delta_base: [100, 100],
  scroll_delta_variance: 0,
  scroll_pause_fast: [0, 0],
  scroll_pause_slow: [0, 0],
  scroll_accel_steps: [1, 1],
  scroll_decel_steps: [1, 1],
  scroll_overshoot_chance: 0,
  scroll_settle_delay: [0, 0],
  scroll_pre_move_delay: [0, 0],
  scroll_target_zone: [0.5, 0.5],
  idle_between_actions: false,
};

function fakeCdpSession() {
  return {
    detach: vi.fn().mockResolvedValue(undefined),
    send: vi.fn(async (method: string) => {
      if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'frame-1' } } };
      if (method === 'Page.createIsolatedWorld') return { executionContextId: 7 };
      if (method === 'Runtime.evaluate') return { result: { value: false } };
      return {};
    }),
  };
}

function fakeLocator(boxes: Array<{ x: number; y: number; width: number; height: number }> = [{ x: 10, y: 10, width: 20, height: 10 }]) {
  let boxIndex = 0;
  const node = {
    tagName: 'BUTTON',
    getAttribute: vi.fn(() => null),
  };
  const locator: any = {
    first: vi.fn(() => locator),
    waitFor: vi.fn().mockResolvedValue(undefined),
    isVisible: vi.fn().mockResolvedValue(true),
    isEnabled: vi.fn().mockResolvedValue(true),
    isEditable: vi.fn().mockResolvedValue(true),
    isChecked: vi.fn().mockResolvedValue(false),
    scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
    boundingBox: vi.fn(async () => boxes[Math.min(boxIndex++, boxes.length - 1)]),
    evaluate: vi.fn(async (fn: unknown) => {
      if (typeof fn === 'string') return { hit: true };
      return (fn as (el: typeof node) => unknown)(node);
    }),
  };
  return locator;
}

function fakeElement(box = { x: 10, y: 10, width: 20, height: 10 }) {
  const node = {
    tagName: 'BUTTON',
    getAttribute: vi.fn(() => null),
  };
  const child = {
    boundingBox: vi.fn().mockResolvedValue(box),
    evaluate: vi.fn(async (fn: unknown) => {
      if (typeof fn === 'string') return { hit: true };
      return (fn as (el: typeof node) => unknown)(node);
    }),
    waitForElementState: vi.fn().mockResolvedValue(undefined),
    click: vi.fn(),
    dblclick: vi.fn(),
    hover: vi.fn(),
    type: vi.fn(),
    fill: vi.fn(),
    press: vi.fn(),
    selectOption: vi.fn(),
    check: vi.fn(),
    uncheck: vi.fn(),
    setChecked: vi.fn(),
    tap: vi.fn(),
    focus: vi.fn(),
    scrollIntoViewIfNeeded: vi.fn(),
    isChecked: vi.fn().mockResolvedValue(false),
    $: vi.fn().mockResolvedValue(null),
    $$: vi.fn().mockResolvedValue([]),
    waitForSelector: vi.fn().mockResolvedValue(null),
  };
  return child;
}

function fakeFrame(locator = fakeLocator()): any {
  return {
    childFrames: vi.fn(() => []),
    locator: vi.fn(() => locator),
    click: vi.fn(),
    dblclick: vi.fn(),
    hover: vi.fn(),
    type: vi.fn(),
    fill: vi.fn(),
    check: vi.fn(),
    uncheck: vi.fn(),
    selectOption: vi.fn(),
    press: vi.fn(),
    pressSequentially: vi.fn(),
    tap: vi.fn(),
    clear: vi.fn(),
    dragAndDrop: vi.fn(),
    $: vi.fn().mockResolvedValue(null),
    $$: vi.fn().mockResolvedValue([]),
    waitForSelector: vi.fn().mockResolvedValue(null),
  };
}

function fakePage(input?: { locator?: any; mainFrame?: any; cdp?: ReturnType<typeof fakeCdpSession> }) {
  const cdp = input?.cdp ?? fakeCdpSession();
  const locator = input?.locator ?? fakeLocator();
  const mainFrame = input?.mainFrame;
  const browser = {
    contexts: vi.fn(),
    newContext: vi.fn(),
    newPage: vi.fn(),
  };
  const context = {
    browser: vi.fn(() => browser),
    pages: vi.fn(),
    on: vi.fn(),
    newPage: vi.fn(),
    newCDPSession: vi.fn().mockResolvedValue(cdp),
  };
  const page = {
    context: vi.fn(() => context),
    mainFrame: mainFrame ? vi.fn(() => mainFrame) : vi.fn(() => { throw new Error('no frames'); }),
    locator: vi.fn(() => locator),
    viewportSize: vi.fn(() => ({ width: 100, height: 100 })),
    evaluate: vi.fn().mockResolvedValue({ width: 100, height: 100 }),
    click: vi.fn(),
    dblclick: vi.fn(),
    hover: vi.fn(),
    type: vi.fn(),
    fill: vi.fn(),
    check: vi.fn(),
    uncheck: vi.fn(),
    selectOption: vi.fn(),
    press: vi.fn(),
    pressSequentially: vi.fn(),
    tap: vi.fn(),
    clear: vi.fn(),
    goto: vi.fn(),
    isChecked: vi.fn(),
    $: vi.fn(),
    $$: vi.fn(),
    waitForSelector: vi.fn(),
    mouse: {
      move: vi.fn().mockResolvedValue(undefined),
      click: vi.fn(),
      dblclick: vi.fn(),
      wheel: vi.fn(),
      down: vi.fn(),
      up: vi.fn(),
    },
    keyboard: {
      type: vi.fn(),
      down: vi.fn(),
      up: vi.fn(),
      press: vi.fn(),
      insertText: vi.fn(),
    },
  };
  return { browser, context, cdp, locator, page };
}

function mockRandom(values: number[]) {
  let index = 0;
  return vi.spyOn(Math, 'random').mockImplementation(() => {
    const value = values[Math.min(index, values.length - 1)] ?? 0.5;
    index += 1;
    return value;
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('humanizePage', () => {
  it('awaits an exactly-once disposer that restores Page, mouse, keyboard, and Frame wrappers and detaches stealth CDP', async () => {
    const childFrame = fakeFrame();
    const mainFrame = fakeFrame();
    mainFrame.childFrames.mockReturnValue([childFrame]);
    const owned = fakePage({ mainFrame });
    const pageClick = owned.page.click;
    const mouseMove = owned.page.mouse.move;
    const keyboardType = owned.page.keyboard.type;
    const pageDollar = owned.page.$;
    const pageDollars = owned.page.$$;
    const pageWaitForSelector = owned.page.waitForSelector;
    const frameClick = childFrame.click;
    const frameDollar = childFrame.$;

    humanizePage(owned.page as any, FAST_HUMAN_CONFIG);
    await (owned.page as any)._stealth.getCdpSession();

    await Promise.all([
      disposeHumanizedPage(owned.page as any),
      disposeHumanizedPage(owned.page as any),
    ]);

    expect(owned.page.click).toBe(pageClick);
    expect(owned.page.mouse.move).toBe(mouseMove);
    expect(owned.page.keyboard.type).toBe(keyboardType);
    expect(owned.page.$).toBe(pageDollar);
    expect(owned.page.$$).toBe(pageDollars);
    expect(owned.page.waitForSelector).toBe(pageWaitForSelector);
    expect(childFrame.click).toBe(frameClick);
    expect(childFrame.$).toBe(frameDollar);
    expect((childFrame as any)._humanPatched).toBeUndefined();
    expect(owned.cdp.detach).toHaveBeenCalledOnce();
  });

  it('restores Frame wrappers added after navigation', async () => {
    const mainFrame = fakeFrame();
    const owned = fakePage({ mainFrame });
    humanizePage(owned.page as any, FAST_HUMAN_CONFIG);
    const lateFrame = fakeFrame();
    const lateClick = lateFrame.click;
    mainFrame.childFrames.mockReturnValue([lateFrame]);

    await owned.page.goto('https://example.test/');
    expect(lateFrame.click).not.toBe(lateClick);
    mainFrame.childFrames.mockReturnValue([]);
    await disposeHumanizedPage(owned.page as any);

    expect(lateFrame.click).toBe(lateClick);
    expect((lateFrame as any)._humanPatched).toBeUndefined();
  });
  it('patches only the supplied Page once without touching its context, browser, or other pages', () => {
    const owned = fakePage();
    const human = fakePage();
    const actionMethods = ['click', 'dblclick', 'hover', 'type', 'fill', 'check', 'uncheck', 'selectOption', 'press', 'pressSequentially', 'tap', 'clear'] as const;
    const original = {
      ownedPrototype: Object.getPrototypeOf(owned.page),
      unrelatedPrototype: Object.getPrototypeOf(human.page),
      actions: Object.fromEntries(actionMethods.map(method => [method, owned.page[method]])),
      mouse: { move: owned.page.mouse.move, click: owned.page.mouse.click },
      keyboard: { type: owned.page.keyboard.type },
      contextPages: owned.context.pages,
      browserContexts: owned.browser.contexts,
      unrelatedActions: Object.fromEntries(actionMethods.map(method => [method, human.page[method]])),
      unrelatedMouse: { move: human.page.mouse.move, click: human.page.mouse.click },
      unrelatedKeyboard: { type: human.page.keyboard.type },
    };

    expect(humanizePage(owned.page as any)).toBe(owned.page);
    for (const method of actionMethods) expect(owned.page[method]).not.toBe(original.actions[method]);
    expect(owned.page.mouse.move).not.toBe(original.mouse.move);
    expect(owned.page.mouse.click).not.toBe(original.mouse.click);
    expect(owned.page.keyboard.type).not.toBe(original.keyboard.type);
    expect(Object.getPrototypeOf(owned.page)).toBe(original.ownedPrototype);
    expect(owned.context.pages).toBe(original.contextPages);
    expect(owned.browser.contexts).toBe(original.browserContexts);
    expect(owned.context.pages).not.toHaveBeenCalled();
    expect(owned.context.on).not.toHaveBeenCalled();
    expect(owned.context.newPage).not.toHaveBeenCalled();
    expect(owned.browser.contexts).not.toHaveBeenCalled();
    expect(owned.browser.newContext).not.toHaveBeenCalled();
    expect(owned.browser.newPage).not.toHaveBeenCalled();
    for (const method of actionMethods) expect(human.page[method]).toBe(original.unrelatedActions[method]);
    expect(human.page.mouse.move).toBe(original.unrelatedMouse.move);
    expect(human.page.mouse.click).toBe(original.unrelatedMouse.click);
    expect(human.page.keyboard.type).toBe(original.unrelatedKeyboard.type);
    expect(Object.getPrototypeOf(human.page)).toBe(original.unrelatedPrototype);

    const patched = { click: owned.page.click, mouseMove: owned.page.mouse.move, keyboardType: owned.page.keyboard.type };
    expect(humanizePage(owned.page as any)).toBe(owned.page);
    expect(owned.page.click).toBe(patched.click);
    expect(owned.page.mouse.move).toBe(patched.mouseMove);
    expect(owned.page.keyboard.type).toBe(patched.keyboardType);
  });

  it('does not export context or browser patch helpers', () => {
    expect(humanizer).not.toHaveProperty('patchContext');
    expect(humanizer).not.toHaveProperty('patchBrowser');
  });

  it('moves the registered Page mouse through a non-collinear path instead of a direct jump', async () => {
    mockRandom([1]);
    const owned = fakePage();
    const rawMove = owned.page.mouse.move;

    humanizePage(owned.page as any, FAST_HUMAN_CONFIG);
    await Promise.resolve();
    rawMove.mockClear();
    await owned.page.mouse.move(120, 0);

    const path = rawMove.mock.calls.map(([x, y]) => [x, y]);
    expect(path).toHaveLength(7);
    expect(path.at(0)).toEqual([0, 0]);
    expect(path.at(-1)).toEqual([120, 0]);
    expect(path.slice(1, -1).some(([, y]) => y !== 0)).toBe(true);
  });

  it('types through the registered Page keyboard with nonconstant inter-character cadence', async () => {
    mockRandom([
      0, 0,
      0.9, 0.5, 0.9, 0,
      0.9, 0.5, 0.9, 1,
      0.9, 0.5,
    ]);
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const owned = fakePage();

    humanizePage(owned.page as any, { ...FAST_HUMAN_CONFIG, key_hold: [1, 1] });
    await owned.page.keyboard.type('abc');

    const interCharacterDelays = timeoutSpy.mock.calls
      .map(([, ms]) => Number(ms))
      .filter(ms => ms >= 10);
    expect(interCharacterDelays).toEqual([10, 30]);
    expect(owned.page.keyboard.down.mock.calls.map(([key]) => key)).toEqual(['a', 'b', 'c']);
    expect(owned.page.keyboard.up.mock.calls.map(([key]) => key)).toEqual(['a', 'b', 'c']);
  });

  it('uses CDP dispatchKeyEvent for shift symbols on the trusted-event path', async () => {
    const owned = fakePage();

    humanizePage(owned.page as any, FAST_HUMAN_CONFIG);
    await owned.page.keyboard.type('@');

    expect(owned.cdp.send).toHaveBeenCalledWith('Input.dispatchKeyEvent', expect.objectContaining({
      type: 'keyDown',
      key: '@',
      code: 'Digit2',
      modifiers: 8,
    }));
    expect(owned.cdp.send).toHaveBeenCalledWith('Input.dispatchKeyEvent', expect.objectContaining({
      type: 'keyUp',
      key: '@',
      code: 'Digit2',
      modifiers: 8,
    }));
    expect(owned.page.keyboard.insertText).not.toHaveBeenCalled();
    expect(owned.page.evaluate).not.toHaveBeenCalled();
  });

  it('keeps Page click scrolling bounded when the target stays outside the viewport', async () => {
    const locator = fakeLocator([{ x: 20, y: 250, width: 20, height: 10 }]);
    const owned = fakePage({ locator });
    const rawClick = owned.page.click;

    humanizePage(owned.page as any, FAST_HUMAN_CONFIG);
    await owned.page.click('#outside', { force: true, timeout: 1000 });

    const totalWheelY = owned.page.mouse.wheel.mock.calls
      .reduce((sum, [, deltaY]) => sum + Math.abs(Number(deltaY)), 0);
    expect(totalWheelY).toBeGreaterThan(0);
    expect(totalWheelY).toBeLessThanOrEqual(300);
    expect(rawClick).not.toHaveBeenCalled();
    expect(owned.page.mouse.down).toHaveBeenCalledOnce();
    expect(owned.page.mouse.up).toHaveBeenCalledOnce();
  });

  it('humanizes existing child frame interactions on the registered Page', async () => {
    const childLocator = fakeLocator([{ x: 25, y: 25, width: 30, height: 12 }]);
    const childFrame = fakeFrame(childLocator);
    const mainFrame = fakeFrame();
    mainFrame.childFrames.mockReturnValue([childFrame]);
    const owned = fakePage({ mainFrame });
    const rawChildClick = childFrame.click;

    humanizePage(owned.page as any, FAST_HUMAN_CONFIG);
    await childFrame.click('#frame-button', { timeout: 1000 });

    expect(childLocator.scrollIntoViewIfNeeded).toHaveBeenCalledWith({ timeout: expect.any(Number) });
    expect(rawChildClick).not.toHaveBeenCalled();
    expect(owned.page.mouse.down).toHaveBeenCalledOnce();
    expect(owned.page.mouse.up).toHaveBeenCalledOnce();
  });

  it('patches ElementHandles returned by the registered Page without touching handles from other pages', async () => {
    const ownedHandle = fakeElement({ x: 30, y: 30, width: 20, height: 10 });
    const humanHandle = fakeElement({ x: 30, y: 30, width: 20, height: 10 });
    const owned = fakePage();
    const human = fakePage();
    const rawOwnedHandleClick = ownedHandle.click;
    owned.page.$.mockResolvedValue(ownedHandle);
    human.page.$.mockResolvedValue(humanHandle);

    humanizePage(owned.page as any, FAST_HUMAN_CONFIG);
    const patchedHandle = await owned.page.$('#owned');
    const untouchedHandle = await human.page.$('#human');
    await patchedHandle.click({ force: true, timeout: 1000 });

    expect((patchedHandle as any)._humanPatched).toBe(true);
    expect((untouchedHandle as any)._humanPatched).toBeUndefined();
    expect(rawOwnedHandleClick).not.toHaveBeenCalled();
    expect(owned.page.mouse.down).toHaveBeenCalledOnce();
    expect(owned.page.mouse.up).toHaveBeenCalledOnce();

    await disposeHumanizedPage(owned.page as any);
    expect(patchedHandle.click).toBe(rawOwnedHandleClick);
    expect((patchedHandle as any)._humanPatched).toBeUndefined();
  });
});
