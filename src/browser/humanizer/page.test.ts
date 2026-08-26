import { describe, expect, it, vi } from 'vitest';
import * as humanizer from './index.js';
import { humanizePage } from './page.js';

function fakePage() {
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
    newCDPSession: vi.fn(),
  };
  const page = {
    context: vi.fn(() => context),
    mainFrame: vi.fn(() => { throw new Error('no frames'); }),
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
  return { browser, context, page };
}

describe('humanizePage', () => {
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
});
