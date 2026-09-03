import { createConnection, type Socket } from 'node:net';
import { StringDecoder } from 'node:string_decoder';
import { PKG_VERSION } from '../version.js';
import {
  parseAttachResult,
  parseCreateProfileResult,
  parseControlResponse,
  parseHelloResult,
  parseReleaseResult,
  isValidUtf8,
  SLAB_ERROR_MESSAGES,
  SLAB_MAX_CONTROL_LINE_BYTES,
  SLAB_PROTOCOL_VERSION,
  SLAB_PROTOCOL_MIN_VERSION,
  type SlabAttachResult,
  type SlabErrorCode,
  type SlabHelloResult,
  type SlabCreateProfileResult,
} from './protocol.js';

export interface SlabBridgeClientOptions {
  timeoutMs?: number;
  clientVersion?: string;
}

export class SlabProtocolError extends Error {
  readonly code: SlabErrorCode;

  constructor(code: SlabErrorCode) {
    super(SLAB_ERROR_MESSAGES[code]);
    this.name = 'SlabProtocolError';
    this.code = code;
  }
}

interface PendingRequest {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}

function isValidDisplayName(value: string): boolean {
  if (!value) return false;
  let count = 0;
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
    count += 1;
    if (count > 128) return false;
  }
  return true;
}

function parseResultForMethod(method: string, result: unknown): unknown {
  if (method === 'hello') return parseHelloResult(result);
  if (method === 'createProfile') return parseCreateProfileResult(result);
  if (method === 'attach') return parseAttachResult(result);
  if (method === 'release') return parseReleaseResult(result);
  throw new Error('SLAB control response has unknown fields');
}

export class SlabBridgeClient {
  private readonly socket: Socket;
  private readonly decoder = new StringDecoder('utf8');
  private readonly pending = new Map<string, PendingRequest>();
  private readonly timeoutMs: number;
  private readonly clientVersion: string;
  private pendingBytes = Buffer.alloc(0);
  private nextId = 0;
  private closed = false;
  private negotiatedVersion?: number;

  private constructor(socket: Socket, options: SlabBridgeClientOptions = {}) {
    this.socket = socket;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.clientVersion = options.clientVersion ?? `webcmd/${PKG_VERSION}`;
    socket.on('data', (chunk) => this.onData(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    socket.on('close', () => this.failOpen('connection closed'));
    socket.on('error', () => this.failOpen('connection closed'));
  }

  static connect(endpoint: string, options: SlabBridgeClientOptions = {}): Promise<SlabBridgeClient> {
    return new Promise((resolve, reject) => {
      const socket = createConnection({ path: endpoint });
      const client = new SlabBridgeClient(socket, options);
      const onError = (error: Error) => reject(error);
      socket.once('error', onError);
      socket.once('connect', () => {
        socket.off('error', onError);
        resolve(client);
      });
    });
  }

  hello(): Promise<SlabHelloResult> {
    return (this.request('hello', {
      protocolVersion: { min: SLAB_PROTOCOL_MIN_VERSION, max: SLAB_PROTOCOL_VERSION },
      clientVersion: this.clientVersion,
    }) as Promise<SlabHelloResult>).then(result => {
      this.negotiatedVersion = result.protocolVersion;
      return result;
    });
  }

  createProfile(displayName: string, idempotencyKey: string): Promise<SlabCreateProfileResult> {
    if ((this.negotiatedVersion ?? 0) < 2) {
      return Promise.reject(Object.assign(
        new Error('Installed SLAB does not support native Profile creation; update SLAB and retry.'),
        { code: 'SLAB_UPGRADE_REQUIRED' },
      ));
    }
    if (!isValidDisplayName(displayName)
      || !/^[A-Za-z0-9:._-]{1,256}$/.test(idempotencyKey)) {
      return Promise.reject(new SlabProtocolError('INVALID_REQUEST'));
    }
    return this.request('createProfile', {
      protocolVersion: { min: 2, max: 2 },
      displayName,
      idempotencyKey,
    }) as Promise<SlabCreateProfileResult>;
  }

  attach(profile: string | { id: string }): Promise<SlabAttachResult> {
    if (this.negotiatedVersion === undefined) return Promise.reject(new Error('SLAB control hello is required before attach.'));
    const profileId = typeof profile === 'string' ? profile : profile.id;
    return this.request('attach', {
      protocolVersion: negotiatedProtocolVersionParam(this.negotiatedVersion),
      profileId,
    }) as Promise<SlabAttachResult>;
  }

  release(connectionId: string): Promise<null> {
    if (this.negotiatedVersion === undefined) return Promise.reject(new Error('SLAB control hello is required before release.'));
    return this.request('release', {
      protocolVersion: negotiatedProtocolVersionParam(this.negotiatedVersion),
      connectionId,
    }) as Promise<null>;
  }

  async close(): Promise<void> {
    this.failOpen('connection closed');
  }

  private request(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('SLAB control connection closed'));
    const id = String(++this.nextId);
    if (this.pending.has(id)) return Promise.reject(new Error('SLAB control request id is already pending'));
    return new Promise((resolve, reject) => {
      const timer = this.timeoutMs > 0
        ? setTimeout(() => this.failOpen('request timeout'), this.timeoutMs)
        : undefined;
      this.pending.set(id, { method, resolve, reject, timer });
      this.socket.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }

  private onData(chunk: Buffer): void {
    if (this.closed) return;
    let offset = 0;
    while (offset < chunk.byteLength) {
      const newline = chunk.indexOf(0x0a, offset);
      if (newline === -1) {
        this.appendPending(chunk.subarray(offset));
        return;
      }
      const line = Buffer.concat([this.pendingBytes, chunk.subarray(offset, newline)]);
      this.pendingBytes = Buffer.alloc(0);
      offset = newline + 1;
      this.handleLine(line);
      if (this.closed) return;
    }
  }

  private appendPending(piece: Buffer): void {
    this.pendingBytes = Buffer.concat([this.pendingBytes, piece]);
    if (this.pendingBytes.byteLength > SLAB_MAX_CONTROL_LINE_BYTES) {
      this.failOpen('line exceeds 64 KiB');
    }
  }

  private handleLine(line: Buffer): void {
    if (line.byteLength > SLAB_MAX_CONTROL_LINE_BYTES) {
      this.failOpen('line exceeds 64 KiB');
      return;
    }
    if (!isValidUtf8(line)) {
      this.failOpen('response is invalid UTF-8');
      return;
    }
    const text = this.decoder.write(Buffer.concat([line, Buffer.from([0x0a])])).replace(/\n$/, '');
    let response;
    try {
      response = parseControlResponse(text);
    } catch (error) {
      this.failOpen(error instanceof Error ? error.message.replace(/^SLAB control /, '') : 'response is invalid JSON');
      return;
    }
    const pending = this.pending.get(response.id);
    if (!pending) {
      const kind = [...this.pending.keys()].length === 0 && this.nextId > 0
        ? 'response is a duplicate'
        : 'response id is unexpected';
      this.failOpen(kind);
      return;
    }
    if (!response.ok) {
      this.finish(response.id);
      pending.reject(new SlabProtocolError(response.error.code));
      return;
    }
    let result: unknown;
    try {
      result = parseResultForMethod(pending.method, response.result);
    } catch (error) {
      this.failOpen(error instanceof Error ? error.message.replace(/^SLAB control /, '') : 'response has unknown fields');
      return;
    }
    this.finish(response.id);
    pending.resolve(result);
  }

  private finish(id: string): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    if (pending.timer) clearTimeout(pending.timer);
    this.pending.delete(id);
  }

  private failOpen(kind: string): void {
    if (this.closed) return;
    this.closed = true;
    const error = kind.startsWith('SLAB control ') ? new Error(kind) : new Error(`SLAB control ${kind}`);
    for (const [id, pending] of this.pending) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
    this.socket.destroy();
  }
}

function negotiatedProtocolVersionParam(revision: number): number | { min: number; max: number } {
  return revision === 1 ? 1 : { min: revision, max: revision };
}
