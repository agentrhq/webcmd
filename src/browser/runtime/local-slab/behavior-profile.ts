import { chmod, mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_CONFIG, type HumanConfig } from '../../humanizer/config.js';
import { resolveSlabProfileDir } from './profiles.js';

export const BEHAVIOR_SCHEMA_VERSION = 1 as const;
export const BEHAVIOR_FILENAME = 'behavior.json';
export const BEHAVIOR_LOCK = 'behavior.lock';

type NumericTrait = Exclude<keyof HumanConfig, 'idle_between_actions'>;
export type BehaviorTraits = Pick<HumanConfig, NumericTrait> & {
  idle_between_actions: false;
};

export type BehaviorDocument = {
  schemaVersion: typeof BEHAVIOR_SCHEMA_VERSION;
  profileId: string;
  traits: BehaviorTraits;
  warning?: string;
};

type Bounds = readonly [number, number];

// This is the complete persistence allowlist. Bounds are the hard limits for
// sampled values; the generated value is additionally constrained to ±20% of
// the default in humanizer/config.ts.
const TRAIT_BOUNDS: Record<NumericTrait, Bounds> = {
  typing_delay: [0, 10_000],
  typing_delay_spread: [0, 10_000],
  typing_pause_chance: [0, 1],
  typing_pause_range: [0, 60_000],
  shift_down_delay: [0, 10_000],
  shift_up_delay: [0, 10_000],
  key_hold: [0, 10_000],
  field_switch_delay: [0, 60_000],
  mistype_chance: [0, 1],
  mistype_delay_notice: [0, 60_000],
  mistype_delay_correct: [0, 60_000],
  mouse_steps_divisor: [0, 1_000],
  mouse_min_steps: [0, 10_000],
  mouse_max_steps: [0, 10_000],
  mouse_wobble_max: [0, 10_000],
  mouse_overshoot_chance: [0, 1],
  mouse_overshoot_px: [0, 10_000],
  mouse_burst_size: [0, 10_000],
  mouse_burst_pause: [0, 60_000],
  click_aim_delay_input: [0, 60_000],
  click_aim_delay_button: [0, 60_000],
  click_hold_input: [0, 60_000],
  click_hold_button: [0, 60_000],
  click_input_x_range: [0, 1],
  idle_drift_px: [0, 10_000],
  idle_pause_range: [0, 60_000],
  scroll_delta_base: [0, 100_000],
  scroll_delta_variance: [0, 1],
  scroll_pause_fast: [0, 60_000],
  scroll_pause_slow: [0, 60_000],
  scroll_accel_steps: [0, 10_000],
  scroll_decel_steps: [0, 10_000],
  scroll_overshoot_chance: [0, 1],
  scroll_overshoot_px: [0, 100_000],
  scroll_settle_delay: [0, 60_000],
  scroll_target_zone: [0, 1],
  scroll_pre_move_delay: [0, 60_000],
  initial_cursor_x: [0, 100_000],
  initial_cursor_y: [0, 100_000],
  idle_between_duration: [0, 60_000],
};

const LOCK_RETRY_MS = 50;
const LOCK_TIMEOUT_MS = 5_000;
const STALE_LOCK_MS = 60_000;

export async function loadOrCreateBehaviorProfile(
  profileId: string,
  opts: {
    baseDir?: string;
    random?: () => number;
    now?: () => number;
  } = {},
): Promise<BehaviorDocument> {
  const profileDir = resolveSlabProfileDir(profileId, { baseDir: opts.baseDir });
  const behaviorPath = path.join(profileDir, BEHAVIOR_FILENAME);
  const lockPath = path.join(profileDir, BEHAVIOR_LOCK);
  const random = opts.random ?? Math.random;
  const now = opts.now ?? Date.now;

  try {
    await mkdir(profileDir, { recursive: true, mode: 0o700 });
    await chmod(profileDir, 0o700);
  } catch (error) {
    throw persistError(profileId, error);
  }

  const existing = await tryLoad(behaviorPath);
  if (existing.kind === 'valid') return existing.document;
  if (existing.kind === 'future') throw futureVersionError();

  const acquired = await acquireLock(lockPath, behaviorPath);
  if (!acquired) {
    const waited = await tryLoad(behaviorPath);
    if (waited.kind === 'valid') return waited.document;
    if (waited.kind === 'future') throw futureVersionError();
    throw new Error(`Timed out waiting for lock "${lockPath}" to initialize behavior profile "${profileId}"`);
  }

  try {
    let warning: string | undefined;
    const afterLock = await tryLoad(behaviorPath);
    if (afterLock.kind === 'valid') return afterLock.document;
    if (afterLock.kind === 'future') throw futureVersionError();
    if (afterLock.kind === 'partial') {
      const document = migrateBehaviorDocument(afterLock.document, random);
      await persist(behaviorPath, document, profileId);
      return document;
    }
    if (afterLock.kind === 'invalid' && afterLock.raw !== undefined) {
      try {
        await rename(behaviorPath, `${behaviorPath}.corrupt-${now()}`);
      } catch (error) {
        throw persistError(profileId, error);
      }
      warning = 'Regenerated malformed behavior profile document.';
    }

    const document: BehaviorDocument = {
      schemaVersion: BEHAVIOR_SCHEMA_VERSION,
      profileId,
      traits: sampleTraits(random),
    };
    await persist(behaviorPath, document, profileId);
    return warning ? { ...document, warning } : document;
  } finally {
    await unlink(lockPath).catch(() => undefined);
  }
}

type LoadResult =
  | { kind: 'missing' }
  | { kind: 'invalid'; raw?: string }
  | { kind: 'future' }
  | { kind: 'partial'; document: unknown }
  | { kind: 'valid'; document: BehaviorDocument };

async function tryLoad(behaviorPath: string): Promise<LoadResult> {
  let raw: string;
  try {
    raw = await readFile(behaviorPath, 'utf8');
  } catch (error: unknown) {
    if (isCode(error, 'ENOENT')) return { kind: 'missing' };
    throw error;
  }

  try {
    const document: unknown = JSON.parse(raw);
    if (hasFutureSchema(document)) return { kind: 'future' };
    if (isBehaviorDocument(document)) return { kind: 'valid', document };
    return isMigratableBehaviorDocument(document) ? { kind: 'partial', document } : { kind: 'invalid', raw };
  } catch {
    return { kind: 'invalid', raw };
  }
}

async function acquireLock(lockPath: string, behaviorPath: string): Promise<boolean> {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  while (true) {
    try {
      const handle = await open(lockPath, 'wx', 0o600);
      await handle.close();
      return true;
    } catch (error: unknown) {
      if (!isCode(error, 'EEXIST')) throw error;
      try {
        const lock = await stat(lockPath);
        if (Date.now() - lock.mtimeMs > STALE_LOCK_MS) {
          await unlink(lockPath);
          continue;
        }
      } catch (staleError: unknown) {
        if (!isCode(staleError, 'ENOENT')) throw staleError;
      }
      if (Date.now() >= deadline) return false;
      await delay(LOCK_RETRY_MS);
      const existing = await tryLoad(behaviorPath);
      if (existing.kind === 'valid' || existing.kind === 'future') return false;
    }
  }
}

async function persist(behaviorPath: string, document: BehaviorDocument, profileId: string): Promise<void> {
  const temporaryPath = `${behaviorPath}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(document)}\n`, { encoding: 'utf8', mode: 0o600 });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, behaviorPath);
    await chmod(behaviorPath, 0o600);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw persistError(profileId, error);
  }
}

function sampleTraits(random: () => number): BehaviorTraits {
  const traits: Record<string, number | [number, number] | false> = { idle_between_actions: false };
  for (const key of Object.keys(TRAIT_BOUNDS) as NumericTrait[]) {
    traits[key] = sampleTrait(key, random);
  }
  return traits as BehaviorTraits;
}

function sampleTrait(key: NumericTrait, random: () => number): number | [number, number] {
  const defaultValue = DEFAULT_CONFIG[key];
  return Array.isArray(defaultValue)
    ? sampleTuple(defaultValue, TRAIT_BOUNDS[key], random)
    : sampleNumber(defaultValue, TRAIT_BOUNDS[key], random);
}

export function migrateBehaviorDocument(raw: unknown, random: () => number = Math.random): BehaviorDocument {
  if (!isMigratableBehaviorDocument(raw)) throw new Error('Cannot migrate invalid behavior profile document');

  const existingTraits = raw.traits as Record<string, unknown>;
  const traits: Record<string, number | [number, number] | false> = {
    idle_between_actions: false,
  };
  for (const key of Object.keys(TRAIT_BOUNDS) as NumericTrait[]) {
    const existing = existingTraits[key];
    if (existing !== undefined) {
      traits[key] = existing as number | [number, number];
      continue;
    }
    traits[key] = sampleTrait(key, random);
  }

  return { schemaVersion: BEHAVIOR_SCHEMA_VERSION, profileId: raw.profileId as string, traits: traits as BehaviorTraits };
}

function sampleTuple(value: [number, number], bounds: Bounds, random: () => number): [number, number] {
  const first = sampleNumber(value[0], bounds, random);
  const second = sampleNumber(value[1], bounds, random);
  return first <= second ? [first, second] : [second, first];
}

function sampleNumber(value: number, bounds: Bounds, random: () => number): number {
  const lower = Math.max(bounds[0], value * 0.8);
  const upper = Math.min(bounds[1], value * 1.2);
  return lower + Math.min(1, Math.max(0, random())) * (upper - lower);
}

function isBehaviorDocument(value: unknown): value is BehaviorDocument {
  return isMigratableBehaviorDocument(value)
    && Object.keys((value as BehaviorDocument).traits).length === Object.keys(TRAIT_BOUNDS).length + 1;
}

function isMigratableBehaviorDocument(value: unknown): value is Record<string, unknown> & {
  schemaVersion: typeof BEHAVIOR_SCHEMA_VERSION;
  profileId: string;
  traits: Record<string, unknown>;
} {
  if (!value || typeof value !== 'object') return false;
  const document = value as Record<string, unknown>;
  if (document.schemaVersion !== BEHAVIOR_SCHEMA_VERSION || typeof document.profileId !== 'string') return false;
  if (!document.traits || typeof document.traits !== 'object') return false;
  const traits = document.traits as Record<string, unknown>;
  const allowedKeys = [...Object.keys(TRAIT_BOUNDS), 'idle_between_actions'].sort();
  if (Object.keys(traits).some(key => !allowedKeys.includes(key))) return false;
  if (traits.idle_between_actions !== false) return false;
  return Object.keys(traits).every(key => {
    if (key === 'idle_between_actions') return true;
    const numericKey = key as NumericTrait;
    const bounds = TRAIT_BOUNDS[numericKey];
    const trait = traits[key];
    return Array.isArray(DEFAULT_CONFIG[numericKey])
      ? Array.isArray(trait)
        && trait.length === 2
        && trait.every(item => isBoundedNumber(item, bounds))
        && trait[0] <= trait[1]
      : isBoundedNumber(trait, bounds);
  });
}

function hasFutureSchema(value: unknown): boolean {
  return !!value
    && typeof value === 'object'
    && typeof (value as Record<string, unknown>).schemaVersion === 'number'
    && (value as Record<string, number>).schemaVersion > BEHAVIOR_SCHEMA_VERSION;
}

function isBoundedNumber(value: unknown, bounds: Bounds): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= bounds[0] && value <= bounds[1];
}

function futureVersionError(): Error {
  return new Error(`Behavior profile uses a newer schema version than supported (${BEHAVIOR_SCHEMA_VERSION})`);
}

function persistError(profileId: string, cause: unknown): Error {
  return new Error(`Unable to persist behavior profile "${profileId}": ${cause instanceof Error ? cause.message : String(cause)}`);
}

function isCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === code;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
