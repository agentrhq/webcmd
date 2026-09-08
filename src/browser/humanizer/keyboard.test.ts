import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from './config.js';
import type { RawKeyboard } from './mouse.js';
import { humanType, shouldAllowIntentionalMistype } from './keyboard.js';

const FAST_CONFIG = {
  ...DEFAULT_CONFIG,
  key_hold: [0, 0] as [number, number],
  mistype_delay_notice: [0, 0] as [number, number],
  mistype_delay_correct: [0, 0] as [number, number],
  typing_pause_chance: 0,
  typing_delay: 0,
  typing_delay_spread: 0,
  mistype_chance: 1,
};

function rawKeyboard(): RawKeyboard {
  return {
    down: vi.fn().mockResolvedValue(undefined),
    up: vi.fn().mockResolvedValue(undefined),
    type: vi.fn().mockResolvedValue(undefined),
    insertText: vi.fn().mockResolvedValue(undefined),
  };
}

describe('shouldAllowIntentionalMistype', () => {
  it.each([
    [{ tag: 'input', type: 'text', autocomplete: '' }, true],
    [{ tag: 'input', type: 'password' }, false],
    [{ tag: 'input', type: 'text', autocomplete: 'cc-number' }, false],
    [{ tag: 'input', type: 'text', autocomplete: 'one-time-code' }, false],
    [{ tag: 'textarea', autocomplete: 'new-password' }, false],
    [{ tag: 'div', contentEditable: true }, false],
    [{ tag: 'input', type: 'text', sensitive: true }, false],
  ] as const)('classifies %o as %s', (target, expected) => {
    expect(shouldAllowIntentionalMistype(target)).toBe(expected);
  });
});

describe('humanType intentional mistypes', () => {
  it('suppresses mistypes for sensitive targets', async () => {
    const raw = rawKeyboard();

    await humanType(
      {} as any, raw, 'a', FAST_CONFIG, null, { tag: 'input', type: 'password' }, () => 0,
    );

    expect(raw.down).toHaveBeenCalledWith('a');
    expect(raw.down).not.toHaveBeenCalledWith('Backspace');
  });

  it('makes and corrects mistypes for text inputs', async () => {
    const raw = rawKeyboard();

    await humanType(
      {} as any, raw, 'a', FAST_CONFIG, null, { tag: 'input', type: 'text' }, () => 0,
    );

    expect(raw.down).toHaveBeenCalledWith('s');
    expect(raw.down).toHaveBeenCalledWith('Backspace');
    expect(raw.down).toHaveBeenCalledWith('a');
  });
});
