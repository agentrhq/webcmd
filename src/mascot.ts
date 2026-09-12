/**
 * Weaver — the webcmd mascot.
 *
 * A chunky block spider. webcmd crawls a site once and weaves what it learns
 * into local memory, so the character is a picture of the product's own pitch:
 * explore once, execute forever.
 *
 * The art is drawn with filled block glyphs rather than box-drawing outlines so
 * that the silhouette survives with color stripped — piped output, NO_COLOR,
 * and CI logs all still show a character. Color is layered on top and is always
 * *purely additive*: stripping ANSI from a colored render yields the plain
 * render byte for byte. `command-presentation.test.ts` asserts that property for
 * the whole help screen, and the mascot is part of the help banner.
 *
 * Glyphs carry palette roles, which is what keeps color additive:
 *   █  body      accent      ▓  leg     shade
 *   ●  eye       white       ─  blink   white
 *   ▾  mouth     accent      │  thread  accent
 */

import { ACCENT_RGB, SHADE_RGB } from './brand.js';

/** Display width of every mascot row. */
export const MASCOT_WIDTH = 18;
/** Row count of the resting sprite. */
export const MASCOT_HEIGHT = 6;
/** Row count of every animation frame (sprite plus headroom for the thread). */
export const MASCOT_FRAME_HEIGHT = 9;

const BLANK = ' '.repeat(MASCOT_WIDTH);
const THREAD = '        ││        ';

/** Top leg pair, alternated to make the idle loop breathe. */
const LEGS_TOP = [
  '    ▓▓      ▓▓    ',
  '   ▓▓        ▓▓   ',
] as const;

/** Bottom leg row, alternated in step with {@link LEGS_TOP}. */
const LEGS_BOTTOM = [
  ' ▓▓  ▓▓    ▓▓  ▓▓ ',
  '  ▓▓ ▓▓    ▓▓ ▓▓  ',
] as const;

const HEAD = '    ██████████    ';
const EYES_OPEN = '  ▓▓██ ●  ● ██▓▓  ';
const EYES_SHUT = '  ▓▓██ ─  ─ ██▓▓  ';
const MOUTH = '  ▓▓██  ▾   ██▓▓  ';
const BELLY = '    ██████████    ';

export interface SpriteOptions {
  /** Eyes closed. */
  blink?: boolean;
  /** Which of the two leg positions to stand in. */
  stance?: 0 | 1;
}

/** The six-row sprite in a given pose. */
export function weaverSprite({ blink = false, stance = 0 }: SpriteOptions = {}): string[] {
  return [
    LEGS_TOP[stance],
    HEAD,
    blink ? EYES_SHUT : EYES_OPEN,
    MOUTH,
    BELLY,
    LEGS_BOTTOM[stance],
  ];
}

/** Weaver at rest — the pose used wherever a single static mascot is shown. */
export const WEAVER: readonly string[] = Object.freeze(weaverSprite());

/**
 * Pad a sprite into a full-height frame, hanging from `dropped` rows of thread.
 * Every frame is {@link MASCOT_FRAME_HEIGHT} rows so an in-place redraw can move
 * the cursor up by a constant.
 */
function frame(sprite: readonly string[], dropped: number): string[] {
  const rows = [
    ...Array.from({ length: dropped }, () => THREAD),
    ...sprite,
  ];
  while (rows.length < MASCOT_FRAME_HEIGHT) rows.push(BLANK);
  return rows;
}

/**
 * The install/setup animation: Weaver drops in on a thread, lands with a
 * bounce, then blinks and settles.
 */
export const WEAVER_FRAMES: readonly (readonly string[])[] = Object.freeze([
  frame(weaverSprite({ stance: 1 }), 1),
  frame(weaverSprite({ stance: 1 }), 2),
  frame(weaverSprite({ stance: 0 }), 3),
  frame(weaverSprite({ stance: 1 }), 3),
  frame(weaverSprite({ stance: 0 }), 3),
  frame(weaverSprite({ blink: true, stance: 0 }), 3),
  frame(weaverSprite({ stance: 0 }), 3),
].map((rows) => Object.freeze(rows)));

// ── Color ──────────────────────────────────────────────────────────────────

const RESET = '\u001b[0m';
const ACCENT = `\u001b[38;2;${ACCENT_RGB.r};${ACCENT_RGB.g};${ACCENT_RGB.b}m`;
const SHADE = `\u001b[38;2;${SHADE_RGB.r};${SHADE_RGB.g};${SHADE_RGB.b}m`;
const WHITE = '\u001b[97m';

/** Glyph → color. Glyphs absent here are left uncolored. */
const GLYPH_COLOR: Readonly<Record<string, string>> = Object.freeze({
  '█': ACCENT,
  '│': ACCENT,
  '▓': SHADE,
  '▾': ACCENT,
  '●': WHITE,
  '─': WHITE,
});

/**
 * Color one row, coalescing runs of same-colored glyphs so a sprite costs a
 * handful of escape sequences rather than one per character.
 */
function paintRow(row: string): string {
  let out = '';
  let run = '';
  let runColor: string | undefined;

  const flush = (): void => {
    if (run === '') return;
    out += runColor === undefined ? run : `${runColor}${run}${RESET}`;
    run = '';
  };

  for (const glyph of row) {
    const color = GLYPH_COLOR[glyph];
    if (color !== runColor) {
      flush();
      runColor = color;
    }
    run += glyph;
  }
  flush();
  return out;
}

export interface RenderOptions {
  color: boolean;
}

/** Render arbitrary mascot rows. Color is additive — stripping ANSI restores `rows`. */
export function renderRows(rows: readonly string[], { color }: RenderOptions): string {
  return (color ? rows.map(paintRow) : [...rows]).join('\n');
}

/** Render Weaver at rest. */
export function renderWeaver(options: RenderOptions): string {
  return renderRows(WEAVER, options);
}

// ── Animation ──────────────────────────────────────────────────────────────

export interface AnimateOptions extends RenderOptions {
  /** Milliseconds between frames. Ignored when `animate` is false. */
  frameMs?: number;
  /**
   * Play the frames. When false the final frame is written once with no
   * escapes and no timers, which is what piped output and CI logs should get.
   */
  animate: boolean;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Play the drop-in animation, redrawing in place through `write`.
 *
 * Takes a writer rather than a stream so callers with an injected I/O seam
 * (`hosted/setup.ts`) can animate through it and assert on the bytes in tests.
 *
 * Redraw uses the same escapes as `tui.ts`: hide the cursor, then move up a
 * fixed number of rows and clear forward. The row count is a constant because
 * every frame is `MASCOT_FRAME_HEIGHT` tall.
 */
export async function animateWeaver(
  write: (chunk: string) => void | Promise<void>,
  { frameMs = 90, animate, color, sleep = defaultSleep }: AnimateOptions,
): Promise<void> {
  const frames = WEAVER_FRAMES;

  if (!animate) {
    await write(`${renderRows(frames[frames.length - 1] as readonly string[], { color })}\n`);
    return;
  }

  await write('\u001b[?25l'); // Hide cursor
  try {
    for (const [index, rows] of frames.entries()) {
      if (index > 0) await write(`\u001b[${MASCOT_FRAME_HEIGHT}A\u001b[J`);
      await write(`${renderRows(rows, { color })}\n`);
      if (index < frames.length - 1) await sleep(frameMs);
    }
  } finally {
    // Always restore the cursor, even if a write throws mid-animation.
    await write('\u001b[?25h');
  }
}
