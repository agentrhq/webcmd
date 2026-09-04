import { inspect } from 'node:util';

export const SLAB_PROTOCOL_MIN_VERSION = 1;
export const SLAB_PROTOCOL_VERSION = 2;
export const SLAB_MAX_CONTROL_LINE_BYTES = 64 * 1024;

export const SLAB_ERROR_CODES = [
  'INVALID_REQUEST',
  'INCOMPATIBLE_PROTOCOL',
  'PROFILE_NOT_FOUND',
  'ATTACH_FAILED',
  'AUTHENTICATION_FAILED',
  'CONNECTION_NOT_FOUND',
  'PROFILE_CREATE_FAILED',
  'PROFILE_GONE',
  'PROFILE_REPAIR_REQUIRED',
] as const;

export type SlabErrorCode = (typeof SLAB_ERROR_CODES)[number];

export const SLAB_ERROR_MESSAGES: Record<SlabErrorCode, string> = {
  INVALID_REQUEST: 'Invalid JSON, framing, shape, size, or params',
  INCOMPATIBLE_PROTOCOL: 'Client range does not include a supported revision',
  PROFILE_NOT_FOUND: 'Requested profile is unavailable',
  ATTACH_FAILED: 'Browser could not create the attachment',
  AUTHENTICATION_FAILED: 'CDP IPC credential was missing or wrong',
  CONNECTION_NOT_FOUND: 'A non-release operation referenced an unknown lease',
  PROFILE_CREATE_FAILED: 'Chromium could not initialize the profile',
  PROFILE_GONE: 'Profile was removed during attachment',
  PROFILE_REPAIR_REQUIRED: 'Saved profile mapping conflicts with native state',
};

const SUCCESS_KEYS = ['id', 'ok', 'result'] as const;
const ERROR_KEYS = ['id', 'ok', 'error'] as const;
const ERROR_OBJ_KEYS = ['code', 'message'] as const;
const HELLO_RESULT_KEYS = ['protocolVersion', 'browserVersion', 'browserPid', 'profiles'] as const;
const ATTACH_RESULT_KEYS = ['connectionId', 'profile', 'transport'] as const;
const TRANSPORT_KEYS = ['kind', 'endpoint', 'credential'] as const;
const PROFILE_KEYS = ['id', 'displayName'] as const;
const CREATE_PROFILE_RESULT_KEYS = ['profile', 'created'] as const;

export class SlabCredential {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return '[REDACTED]';
  }

  toJSON(): string {
    return '[REDACTED]';
  }

  [inspect.custom](): string {
    return '[REDACTED]';
  }
}

export interface SlabProfileInfo {
  id: string;
  displayName: string;
}

export interface SlabHelloResult {
  protocolVersion: number;
  browserVersion: string;
  browserPid: number;
  profiles: SlabProfileInfo[];
}

export interface SlabProtocolRange { min: number; max: number }

export interface SlabCreateProfileResult {
  profile: SlabProfileInfo;
  created: boolean;
}

export interface SlabAttachTransport {
  kind: 'cdp-ipc';
  endpoint: string;
  credential: SlabCredential;
}

export interface SlabAttachResult {
  connectionId: string;
  profile: SlabProfileInfo;
  transport: SlabAttachTransport;
}

export type SlabControlSuccess = { id: string; ok: true; result: unknown };
export type SlabControlFailure = { id: string; ok: false; error: { code: SlabErrorCode; message: string } };
export type SlabControlResponse = SlabControlSuccess | SlabControlFailure;

export class SlabProtocolShapeError extends Error {
  constructor(kind: string) {
    super(`SLAB control ${kind}`);
    this.name = 'SlabProtocolShapeError';
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertExactKeys(obj: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) throw new SlabProtocolShapeError('response has unknown fields');
  }
  for (const key of allowed) {
    if (!Object.hasOwn(obj, key)) throw new SlabProtocolShapeError('response has unknown fields');
  }
}

export function isValidUtf8(bytes: Buffer): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

export function parseControlResponse(line: string): SlabControlResponse {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new SlabProtocolShapeError('response is invalid JSON');
  }
  if (!isPlainObject(value)) throw new SlabProtocolShapeError('response has unknown fields');
  if (typeof value.id !== 'string') throw new SlabProtocolShapeError('response id is unexpected');
  if (value.ok === true) {
    assertExactKeys(value, SUCCESS_KEYS);
    return { id: value.id, ok: true, result: value.result };
  }
  if (value.ok === false) {
    assertExactKeys(value, ERROR_KEYS);
    if (!isPlainObject(value.error)) throw new SlabProtocolShapeError('response has unknown fields');
    assertExactKeys(value.error, ERROR_OBJ_KEYS);
    if (typeof value.error.code !== 'string' || typeof value.error.message !== 'string') {
      throw new SlabProtocolShapeError('response has unknown fields');
    }
    if (!SLAB_ERROR_CODES.includes(value.error.code as SlabErrorCode)) {
      throw new SlabProtocolShapeError('response has unknown fields');
    }
    return {
      id: value.id,
      ok: false,
      error: { code: value.error.code as SlabErrorCode, message: value.error.message },
    };
  }
  throw new SlabProtocolShapeError('response has unknown fields');
}

function parseProfile(value: unknown): SlabProfileInfo {
  if (!isPlainObject(value)) throw new SlabProtocolShapeError('response has unknown fields');
  assertExactKeys(value, PROFILE_KEYS);
  if (typeof value.id !== 'string' || value.id.length === 0
    || typeof value.displayName !== 'string' || value.displayName.length === 0) {
    throw new SlabProtocolShapeError('response has unknown fields');
  }
  return { id: value.id, displayName: value.displayName };
}

export function parseHelloResult(
  value: unknown,
  supported: SlabProtocolRange = { min: SLAB_PROTOCOL_MIN_VERSION, max: SLAB_PROTOCOL_VERSION },
): SlabHelloResult {
  if (!isPlainObject(value)) throw new SlabProtocolShapeError('response has unknown fields');
  assertExactKeys(value, HELLO_RESULT_KEYS);
  if (typeof value.protocolVersion !== 'number' || !Number.isInteger(value.protocolVersion)
    || value.protocolVersion < supported.min || value.protocolVersion > supported.max) {
    throw new SlabProtocolShapeError('negotiated protocol version is outside the supported range');
  }
  if (typeof value.browserVersion !== 'string' || typeof value.browserPid !== 'number' || !Number.isInteger(value.browserPid)) {
    throw new SlabProtocolShapeError('response has unknown fields');
  }
  if (!Array.isArray(value.profiles)) throw new SlabProtocolShapeError('response has unknown fields');
  return {
    protocolVersion: value.protocolVersion,
    browserVersion: value.browserVersion,
    browserPid: value.browserPid,
    profiles: value.profiles.map(parseProfile),
  };
}

export function parseCreateProfileResult(value: unknown): SlabCreateProfileResult {
  if (!isPlainObject(value)) throw new SlabProtocolShapeError('response has unknown fields');
  assertExactKeys(value, CREATE_PROFILE_RESULT_KEYS);
  if (typeof value.created !== 'boolean') throw new SlabProtocolShapeError('response has unknown fields');
  return { profile: parseProfile(value.profile), created: value.created };
}

export function parseAttachResult(value: unknown): SlabAttachResult {
  if (!isPlainObject(value)) throw new SlabProtocolShapeError('response has unknown fields');
  assertExactKeys(value, ATTACH_RESULT_KEYS);
  if (typeof value.connectionId !== 'string' || value.connectionId.length === 0) {
    throw new SlabProtocolShapeError('response has unknown fields');
  }
  if (!isPlainObject(value.transport)) throw new SlabProtocolShapeError('response has unknown fields');
  assertExactKeys(value.transport, TRANSPORT_KEYS);
  if (value.transport.kind !== 'cdp-ipc') throw new SlabProtocolShapeError('response has unknown fields');
  if (typeof value.transport.endpoint !== 'string' || typeof value.transport.credential !== 'string') {
    throw new SlabProtocolShapeError('response has unknown fields');
  }
  return {
    connectionId: value.connectionId,
    profile: parseProfile(value.profile),
    transport: {
      kind: 'cdp-ipc',
      endpoint: value.transport.endpoint,
      credential: new SlabCredential(value.transport.credential),
    },
  };
}

export function parseReleaseResult(value: unknown): null {
  if (value !== null) throw new SlabProtocolShapeError('response has unknown fields');
  return null;
}
