import { createConnection } from 'node:net';
import { homedir, platform, userInfo } from 'node:os';
import { join } from 'node:path';
import { SlabUpdateRequiredError } from '../../../errors.js';
import type { SlabAttachment, SlabHelloResult, SlabProfile } from './protocol.js';

const MAX_RESPONSE_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 5_000;
const pipeUser = (process.env.USERNAME ?? userInfo().username).replace(/[^a-zA-Z0-9_.-]/g, '_');
export const DEFAULT_SLAB_SOCKET_PATH = platform() === 'win32'
  ? `\\\\.\\pipe\\slab-bridge-${pipeUser}`
  : join(homedir(), '.slab', 'run', 'slab-bridge.sock');
const PROTOCOL_MIN_VERSION = 1;
const PROTOCOL_MAX_VERSION = 1;

export class SlabBridgeUnavailableError extends Error {}

interface BridgeSocket {
  destroy(): unknown;
  on(event: string, listener: (...args: any[]) => void): unknown;
  write(data: string): unknown;
}

export interface SlabBridgeClientOptions {
  connect?: () => BridgeSocket;
  socketPath?: string;
}

type PendingRequest = {
  reject(error: Error): void;
  resolve(result: unknown): void;
  timer: NodeJS.Timeout;
  validate(result: unknown): unknown;
};

const protocolVersionRange = { min: PROTOCOL_MIN_VERSION, max: PROTOCOL_MAX_VERSION } as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function profile(value: unknown): value is SlabProfile {
  return isRecord(value) && typeof value.id === 'string' && typeof value.displayName === 'string';
}

function helloResult(value: unknown): value is SlabHelloResult {
  return isRecord(value)
    && value.protocolVersion === 1
    && typeof value.browserVersion === 'string'
    && typeof value.browserPid === 'number'
    && Array.isArray(value.profiles)
    && value.profiles.every(profile);
}

function attachment(value: unknown): value is SlabAttachment {
  return isRecord(value)
    && typeof value.connectionId === 'string'
    && profile(value.profile)
    && typeof value.cdpUrl === 'string'
    && typeof value.bearerToken === 'string'
    && typeof value.expiresAt === 'string';
}

export class SlabBridgeClient {
  readonly #connect: () => BridgeSocket;
  #socket: BridgeSocket | undefined;
  #buffer = '';
  #nextId = 1;
  #pending = new Map<string, PendingRequest>();
  #seenIds = new Set<string>();

  constructor(options: SlabBridgeClientOptions = {}) {
    const socketPath = options.socketPath ?? DEFAULT_SLAB_SOCKET_PATH;
    this.#connect = options.connect ?? (() => createConnection(socketPath));
  }

  hello(clientVersion: string): Promise<SlabHelloResult> {
    return this.#request('hello', {
      clientVersion,
      protocolVersion: protocolVersionRange,
    }, (result) => {
      if (!isRecord(result) || typeof result.protocolVersion !== 'number'
        || result.protocolVersion < PROTOCOL_MIN_VERSION || result.protocolVersion > PROTOCOL_MAX_VERSION) {
        const installed = isRecord(result) && typeof result.browserVersion === 'string' ? result.browserVersion : 'unknown';
        throw new SlabUpdateRequiredError(installed, 'protocol v1');
      }
      if (!helloResult(result)) throw new Error('SLAB bridge returned an invalid hello result');
      return result;
    });
  }

  attach(profileId: string): Promise<SlabAttachment> {
    return this.#request('attach', { protocolVersion: protocolVersionRange, profileId }, (result) => {
      if (!attachment(result)) throw new Error('SLAB bridge returned an invalid attachment');
      return result;
    });
  }

  async release(connectionId: string): Promise<void> {
    await this.#request('release', { protocolVersion: protocolVersionRange, connectionId }, (result) => {
      if (result !== null && result !== undefined) throw new Error('SLAB bridge returned an invalid release result');
    });
  }

  #request<T>(method: string, params: Record<string, unknown>, validate: (result: unknown) => T): Promise<T> {
    this.#ensureSocket();
    const id = String(this.#nextId++);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#failAll(new SlabBridgeUnavailableError(`SLAB bridge ${method} request timed out`), true);
      }, REQUEST_TIMEOUT_MS);
      this.#pending.set(id, { resolve, reject, timer, validate });
      this.#socket!.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }

  #ensureSocket(): void {
    if (this.#socket) return;
    const socket = this.#connect();
    this.#socket = socket;
    socket.on('data', (chunk: Buffer | string) => { if (this.#socket === socket) this.#onData(chunk.toString()); });
    socket.on('error', (error: Error) => { if (this.#socket === socket) this.#failAll(error, true); });
    socket.on('close', () => { if (this.#socket === socket) this.#failAll(new Error('SLAB bridge connection closed'), true); });
  }

  #onData(chunk: string): void {
    this.#buffer += chunk;
    let newline: number;
    while ((newline = this.#buffer.indexOf('\n')) >= 0) {
      const line = this.#buffer.slice(0, newline);
      this.#buffer = this.#buffer.slice(newline + 1);
      if (Buffer.byteLength(line) > MAX_RESPONSE_BYTES) return this.#failAll(new Error('SLAB bridge response exceeds 64 KiB'));
      this.#onResponse(line);
    }
    if (Buffer.byteLength(this.#buffer) > MAX_RESPONSE_BYTES) this.#failAll(new Error('SLAB bridge response exceeds 64 KiB'));
  }

  #onResponse(line: string): void {
    let response: unknown;
    try { response = JSON.parse(line); } catch { return this.#failAll(new Error('SLAB bridge returned invalid JSON')); }
    if (!isRecord(response) || typeof response.id !== 'string' || typeof response.ok !== 'boolean') {
      return this.#failAll(new Error('SLAB bridge returned an invalid response'));
    }
    if (this.#seenIds.has(response.id)) return this.#failAll(new Error('SLAB bridge returned a duplicate response ID'));
    this.#seenIds.add(response.id);
    const pending = this.#pending.get(response.id);
    if (!pending) return this.#failAll(new Error('SLAB bridge returned an unknown response ID'));
    this.#pending.delete(response.id);
    clearTimeout(pending.timer);
    if (!response.ok) {
      const message = isRecord(response.error) && typeof response.error.message === 'string' ? response.error.message : 'SLAB bridge request failed';
      pending.reject(new Error(message));
      return;
    }
    try { pending.resolve(pending.validate(response.result)); } catch (error) { pending.reject(error instanceof Error ? error : new Error('SLAB bridge returned an invalid result')); }
  }

  #failAll(error: Error, unavailable = false): void {
    const socket = this.#socket;
    this.#socket = undefined;
    this.#buffer = '';
    socket?.destroy();
    const reason = unavailable && !(error instanceof SlabBridgeUnavailableError)
      ? new SlabBridgeUnavailableError(error.message)
      : error;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(reason);
    }
    this.#pending.clear();
  }
}
