import { createConnection, type Socket } from 'node:net';
import type { ConnectOverCDPTransport } from 'playwright-core';
import { type SlabCredential } from './protocol.js';

const MAX_FRAME_BYTES = 64 * 1024 * 1024;

export interface CdpIpcTransportOptions {
  endpoint: string;
  credential: SlabCredential;
  timeoutMs?: number;
}

type State = 'ready' | 'open' | 'closed';

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function encodeFrame(value: object): Buffer {
  const body = Buffer.from(JSON.stringify(value));
  if (body.byteLength === 0 || body.byteLength > MAX_FRAME_BYTES) {
    throw new Error('SLAB CDP IPC frame exceeds 64 MiB');
  }
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32BE(body.byteLength);
  return Buffer.concat([header, body]);
}

export class CdpIpcTransport implements ConnectOverCDPTransport {
  onmessage?: (message: object) => void;
  onclose?: (reason?: string) => void;

  private readonly chunks: Buffer[] = [];
  private pendingMessages: object[] = [];
  private bufferedBytes = 0;
  private expectedLength?: number;
  private state: State = 'ready';
  private authenticated = false;
  private resolveAuthentication?: () => void;
  private rejectAuthentication?: (error: Error) => void;
  private authenticationTimer?: ReturnType<typeof setTimeout>;

  private constructor(private readonly socket: Socket) {
    socket.on('data', (chunk) => this.onData(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    socket.on('error', () => this.fail('connection closed'));
    socket.on('close', () => this.fail('connection closed'));
  }

  static connect(options: CdpIpcTransportOptions): Promise<ConnectOverCDPTransport> {
    return new Promise((resolve, reject) => {
      const socket = createConnection({ path: options.endpoint });
      const transport = new CdpIpcTransport(socket);
      const timeoutMs = options.timeoutMs ?? 30_000;
      let settled = false;

      const finishReject = (error: Error) => {
        if (settled) return;
        settled = true;
        if (transport.authenticationTimer) clearTimeout(transport.authenticationTimer);
        reject(error);
      };
      const finishResolve = () => {
        if (settled) return;
        settled = true;
        if (transport.authenticationTimer) clearTimeout(transport.authenticationTimer);
        resolve(transport);
      };
      const onConnectError = (error: Error) => finishReject(error);

      transport.rejectAuthentication = finishReject;
      socket.once('error', onConnectError);
      socket.once('connect', () => {
        if (settled) return;
        socket.off('error', onConnectError);
        transport.resolveAuthentication = finishResolve;
        transport.rejectAuthentication = finishReject;
        if (timeoutMs > 0) {
          transport.authenticationTimer = setTimeout(() => transport.fail('authentication timeout'), timeoutMs);
        }
        try {
          socket.write(encodeFrame({ type: 'authenticate', credential: options.credential.reveal() }));
        } catch (error) {
          transport.fail(error instanceof Error ? error.message.replace(/^SLAB CDP IPC /, '') : 'authentication failed');
        }
      });
      if (timeoutMs > 0) {
        const connectTimer = setTimeout(() => transport.fail('connection timeout'), timeoutMs);
        socket.once('connect', () => clearTimeout(connectTimer));
        socket.once('error', () => clearTimeout(connectTimer));
      }
    });
  }

  open(): void {
    if (this.state !== 'ready') return;
    this.state = 'open';
    for (const message of this.pendingMessages) this.onmessage?.(message);
    this.pendingMessages = [];
  }

  send(message: object): void {
    if (this.state === 'closed') throw new Error('SLAB CDP IPC transport is closed');
    if (this.state !== 'open') throw new Error('SLAB CDP IPC transport is not open');
    if (!isObject(message)) throw new Error('SLAB CDP IPC message must be an object');
    this.socket.write(encodeFrame(message));
  }

  close(): void {
    this.fail('connection closed');
  }

  private onData(chunk: Buffer): void {
    if (this.state === 'closed') return;
    this.chunks.push(chunk);
    this.bufferedBytes += chunk.byteLength;
    this.parseFrames();
  }

  private parseFrames(): void {
    while (this.state !== 'closed') {
      if (this.expectedLength === undefined) {
        if (this.bufferedBytes < 4) return;
        const header = this.read(4);
        const length = header.readUInt32BE(0);
        if (length === 0 || length > MAX_FRAME_BYTES) {
          this.fail('frame exceeds 64 MiB');
          return;
        }
        this.expectedLength = length;
      }
      if (this.bufferedBytes < this.expectedLength) return;
      const body = this.read(this.expectedLength);
      this.expectedLength = undefined;
      this.handleFrame(body);
    }
  }

  private read(length: number): Buffer {
    const first = this.chunks[0];
    if (first && first.byteLength >= length) {
      const value = first.subarray(0, length);
      if (first.byteLength === length) this.chunks.shift();
      else this.chunks[0] = first.subarray(length);
      this.bufferedBytes -= length;
      return value;
    }

    const value = Buffer.allocUnsafe(length);
    let offset = 0;
    while (offset < length) {
      const chunk = this.chunks.shift();
      if (!chunk) throw new Error('SLAB CDP IPC parser lost buffered data');
      const size = Math.min(chunk.byteLength, length - offset);
      chunk.copy(value, offset, 0, size);
      offset += size;
      if (size < chunk.byteLength) this.chunks.unshift(chunk.subarray(size));
    }
    this.bufferedBytes -= length;
    return value;
  }

  private handleFrame(body: Buffer): void {
    let message: unknown;
    try {
      message = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
    } catch {
      this.fail('frame contains invalid JSON');
      return;
    }
    if (!isObject(message)) {
      this.fail('frame must contain a JSON object');
      return;
    }
    if (!this.authenticated) {
      if (Object.keys(message).length !== 1 || !Object.hasOwn(message, 'type') || (message as { type?: unknown }).type !== 'authenticated') {
        this.fail('authentication failed');
        return;
      }
      this.authenticated = true;
      const resolve = this.resolveAuthentication;
      this.resolveAuthentication = undefined;
      this.rejectAuthentication = undefined;
      if (this.authenticationTimer) clearTimeout(this.authenticationTimer);
      resolve?.();
      return;
    }
    if (this.state === 'open') this.onmessage?.(message);
    else this.pendingMessages.push(message);
  }

  private fail(reason: string): void {
    if (this.state === 'closed') return;
    this.state = 'closed';
    if (this.authenticationTimer) clearTimeout(this.authenticationTimer);
    const reject = this.rejectAuthentication;
    this.resolveAuthentication = undefined;
    this.rejectAuthentication = undefined;
    reject?.(new Error(`SLAB CDP IPC ${reason}`));
    this.socket.destroy();
    this.onclose?.(`SLAB CDP IPC ${reason}`);
  }
}
