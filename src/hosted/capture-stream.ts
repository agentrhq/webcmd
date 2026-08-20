import { Writable } from 'node:stream';

export interface CaptureResult {
  text: string;
  byteSize: number;
  truncated: boolean;
  /**
   * The retained copy of the whole stream, present only when it overflowed
   * `limitBytes` and bounded by `spillLimitBytes`. Callers that must not lose
   * oversized output — the MCP overflow artifact — write this, never `text`.
   */
  full?: Uint8Array;
}

export interface CaptureStream {
  stream: NodeJS.WritableStream;
  result(): CaptureResult;
}

/**
 * Drop a trailing multi-byte UTF-8 sequence that the byte-level cut left
 * incomplete. Without this the boundary decodes to U+FFFD, which would put
 * a character the CLI never wrote into the agent's transcript.
 */
function trimIncompleteUtf8(buf: Buffer): Buffer {
  for (let back = 1; back <= 4 && back <= buf.byteLength; back += 1) {
    const byte = buf[buf.byteLength - back]!;
    if ((byte & 0b1100_0000) === 0b1000_0000) continue; // continuation byte
    if ((byte & 0b1000_0000) === 0) return buf; // ASCII: nothing pending
    const needed =
      (byte & 0b1110_0000) === 0b1100_0000 ? 2
      : (byte & 0b1111_0000) === 0b1110_0000 ? 3
      : (byte & 0b1111_1000) === 0b1111_0000 ? 4
      : 0;
    return needed === back ? buf : buf.subarray(0, buf.byteLength - back);
  }
  return buf;
}

export const DEFAULT_SPILL_LIMIT_BYTES = 16 * 1024 * 1024;

export function createCaptureStream(
  limitBytes: number,
  spillLimitBytes: number = DEFAULT_SPILL_LIMIT_BYTES,
): CaptureStream {
  if (!Number.isInteger(limitBytes) || limitBytes <= 0) {
    throw new RangeError(`capture limit must be a positive integer, received ${limitBytes}`);
  }
  if (!Number.isInteger(spillLimitBytes) || spillLimitBytes < limitBytes) {
    throw new RangeError(`spill limit must be an integer no smaller than the inline limit`);
  }

  const kept: Buffer[] = [];
  let keptBytes = 0;
  let spilled: Buffer[] | undefined;
  let spilledBytes = 0;
  let byteSize = 0;

  const stream = new Writable({
    write(chunk: Buffer | string, encoding: BufferEncoding, callback: (error?: Error | null) => void) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
      const previousByteSize = byteSize;
      byteSize += buf.byteLength;

      if (keptBytes < limitBytes) {
        const room = limitBytes - keptBytes;
        const slice = buf.byteLength <= room ? buf : buf.subarray(0, room);
        kept.push(Buffer.from(slice));
        keptBytes += slice.byteLength;
      }

      // Retain a separately bounded copy only after the stream overflows. It
      // starts with the already-owned inline bytes, then captures the rest of
      // this and subsequent chunks without retaining source backing buffers.
      if (spilled === undefined && byteSize > limitBytes) {
        spilled = kept.map((part) => Buffer.from(part));
        spilledBytes = keptBytes;
        const overflowStart = Math.max(0, limitBytes - previousByteSize);
        const overflow = buf.subarray(overflowStart);
        if (spilledBytes < spillLimitBytes && overflow.byteLength > 0) {
          const room = spillLimitBytes - spilledBytes;
          spilled.push(Buffer.from(overflow.subarray(0, room)));
          spilledBytes += Math.min(room, overflow.byteLength);
        }
      } else if (spilled !== undefined && spilledBytes < spillLimitBytes) {
        const room = spillLimitBytes - spilledBytes;
        const slice = buf.subarray(0, room);
        spilled.push(Buffer.from(slice));
        spilledBytes += slice.byteLength;
      }

      callback();
    },
  });

  return {
    stream,
    result(): CaptureResult {
      const joined = Buffer.concat(kept, keptBytes);
      const truncated = byteSize > keptBytes;
      const usable = truncated ? trimIncompleteUtf8(joined) : joined;
      return {
        text: usable.toString('utf8'),
        byteSize,
        truncated,
        ...(truncated && spilled !== undefined
          ? { full: new Uint8Array(Buffer.concat(spilled, spilledBytes)) }
          : {}),
      };
    },
  };
}
