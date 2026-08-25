import { randomInt } from 'node:crypto';
import { CliError, EXIT_CODES } from '../errors.js';

export const SESSION_SUFFIX_ALPHABET = '23456789abcdefghijkmnpqrstuvwxyz';
export const SESSION_SUFFIX_LENGTH = 2;
export const SESSION_GENERATION_ATTEMPTS = 10;
export const ADAPTER_DEFAULT_SESSION_ID = 'adapter-default';

export class InvalidSessionNameError extends CliError {
  constructor(input: string) {
    super(
      'INVALID_SESSION_NAME',
      `Session name must contain at least one letter or number: ${input}`,
      'Use a short readable name such as `work` or `research-2026`.',
      EXIT_CODES.USAGE_ERROR,
    );
  }
}

export class InvalidSessionSelectorError extends CliError {
  constructor(sessionId: string) {
    super(
      'INVALID_SESSION_SELECTOR',
      `Session selector must be a readable Session ID: ${sessionId}`,
      'Run `webcmd session create <name>` and pass the returned readable ID.',
      EXIT_CODES.USAGE_ERROR,
    );
  }
}

export class SessionIdGenerationError extends CliError {
  constructor(name: string) {
    super(
      'SESSION_ID_GENERATION_FAILED',
      `Could not generate a unique readable Session ID for: ${name}`,
      'Choose a different Session name and try again.',
      EXIT_CODES.GENERIC_ERROR,
    );
  }
}

export function normalizeSessionBase(input: string): string {
  return input.trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
}

export function requireSessionName(input: string): string {
  const base = normalizeSessionBase(input);
  if (!base) throw new InvalidSessionNameError(input);
  return base;
}

export function requireSessionIdShape(sessionId: string): void {
  if (sessionId !== ADAPTER_DEFAULT_SESSION_ID && !/^[a-z0-9][a-z0-9-]{0,59}-[23456789abcdefghijkmnpqrstuvwxyz]{2}$/u.test(sessionId)) {
    throw new InvalidSessionSelectorError(sessionId);
  }
}

export function generateSessionSuffix(
  randomIndex: (max: number) => number = randomInt,
): string {
  return Array.from({ length: SESSION_SUFFIX_LENGTH }, () =>
    SESSION_SUFFIX_ALPHABET[randomIndex(SESSION_SUFFIX_ALPHABET.length)]).join('');
}
