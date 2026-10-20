import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MASCOT_FRAME_HEIGHT,
  MASCOT_HEIGHT,
  MASCOT_WIDTH,
  WEAVER,
  WEAVER_FRAMES,
  animateWeaver,
  renderWeaver,
} from './mascot.js';

const ANSI_RE = /\u001b\[[0-9;?]*[A-Za-z]/g;

function recorder(): { chunks: string[]; write: (chunk: string) => void } {
  const chunks: string[] = [];
  return { chunks, write: (chunk: string) => void chunks.push(chunk) };
}

describe('weaver geometry', () => {
  it('is a rectangle — every resting row is exactly MASCOT_WIDTH', () => {
    expect(WEAVER).toHaveLength(MASCOT_HEIGHT);
    for (const row of WEAVER) expect([...row]).toHaveLength(MASCOT_WIDTH);
  });

  it('keeps every animation frame the same size', () => {
    // The redraw moves the cursor up by a constant, so a frame of a different
    // height would tear the animation instead of replacing it.
    for (const frame of WEAVER_FRAMES) {
      expect(frame).toHaveLength(MASCOT_FRAME_HEIGHT);
      for (const row of frame) expect([...row]).toHaveLength(MASCOT_WIDTH);
    }
  });

  it('stays narrow enough for the 80-column help banner', () => {
    // The WEB CMD wordmark takes ~52 columns; the mascot plus its gutter must
    // fit in what is left.
    expect(MASCOT_WIDTH + 2).toBeLessThanOrEqual(28);
  });

  it('blinks and shifts stance across the idle frames', () => {
    const rendered = WEAVER_FRAMES.map((frame) => frame.join('\n'));
    expect(new Set(rendered).size).toBeGreaterThan(1);
    expect(rendered.some((frame) => frame.includes('─  ─'))).toBe(true);
    expect(rendered.some((frame) => frame.includes('●  ●'))).toBe(true);
  });
});

describe('weaver color', () => {
  it('emits no escapes when color is off', () => {
    expect(renderWeaver({ color: false })).not.toMatch(/\u001b\[/);
  });

  it('is purely additive — stripping ANSI restores the plain render', () => {
    // command-presentation.test.ts asserts this for the whole help screen, and
    // the mascot is part of the help banner.
    const plain = renderWeaver({ color: false });
    const colored = renderWeaver({ color: true });

    expect(colored).toMatch(/\u001b\[/);
    expect(colored.replace(ANSI_RE, '')).toBe(plain);
  });

  it('paints the body in the brand accent and the legs in the shade', () => {
    const colored = renderWeaver({ color: true });
    expect(colored).toContain('\u001b[38;2;86;197;255m');
    expect(colored).toContain('\u001b[38;2;0;107;154m');
  });
});

describe('animateWeaver', () => {
  it('writes one static frame and no escapes when animation is off', async () => {
    const { chunks, write } = recorder();
    await animateWeaver(write, { animate: false, color: false });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).not.toMatch(/\u001b\[/);
    expect(chunks[0]).toBe(`${WEAVER_FRAMES[WEAVER_FRAMES.length - 1].join('\n')}\n`);
  });

  it('plays every frame and restores the cursor', async () => {
    const { chunks, write } = recorder();
    await animateWeaver(write, { animate: true, color: false, sleep: async () => {} });

    expect(chunks[0]).toBe('\u001b[?25l');
    expect(chunks[chunks.length - 1]).toBe('\u001b[?25h');

    const frames = chunks.filter((chunk) => chunk.includes('█'));
    expect(frames).toHaveLength(WEAVER_FRAMES.length);
  });

  it('rewinds by exactly one frame height between frames', async () => {
    const { chunks, write } = recorder();
    await animateWeaver(write, { animate: true, color: false, sleep: async () => {} });

    const rewinds = chunks.filter((chunk) => chunk === `\u001b[${MASCOT_FRAME_HEIGHT}A\u001b[J`);
    expect(rewinds).toHaveLength(WEAVER_FRAMES.length - 1);
  });

  it('restores the cursor even when a write throws', async () => {
    const chunks: string[] = [];
    let failed = false;
    const write = (chunk: string): void => {
      chunks.push(chunk);
      // Fail once, on the first frame, after the cursor has been hidden.
      if (!failed && chunk.includes('█')) {
        failed = true;
        throw new Error('stream closed');
      }
    };

    await expect(animateWeaver(write, { animate: true, color: false })).rejects.toThrow('stream closed');
    expect(chunks[chunks.length - 1]).toBe('\u001b[?25h');
  });
});

describe('postinstall copy', () => {
  // scripts/postinstall.js must run with no build step, so it cannot import
  // src/mascot.ts and keeps its own copy of the art. This is the guard against
  // the two drifting apart.
  const source = readFileSync(join(import.meta.dirname, '..', 'scripts', 'postinstall.js'), 'utf8');

  it('inlines every sprite row verbatim', () => {
    const rows = new Set(WEAVER_FRAMES.flat().filter((row) => row.trim() !== ''));
    expect(rows.size).toBeGreaterThan(0);
    for (const row of rows) expect(source).toContain(row);
  });

  it('inlines the same frame height', () => {
    expect(source).toContain(`const MASCOT_FRAME_HEIGHT = ${MASCOT_FRAME_HEIGHT};`);
  });

  it('inlines the same palette', () => {
    // Match the SGR bodies, not the escape prefix: this file spells the escape
    // as a real control character while postinstall.js spells it in source form.
    expect(source).toContain('[38;2;86;197;255m');
    expect(source).toContain('[38;2;0;107;154m');
  });
});
