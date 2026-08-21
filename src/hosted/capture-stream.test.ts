import { describe, expect, it } from 'vitest';
import { createCaptureStream } from './capture-stream.js';

async function write(stream: NodeJS.WritableStream, chunk: string | Uint8Array): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    stream.write(chunk, (error) => (error ? reject(error) : resolve()));
  });
}

describe('createCaptureStream', () => {
  it('keeps everything under the limit and reports no truncation', async () => {
    const capture = createCaptureStream(1024);
    await write(capture.stream, 'hello ');
    await write(capture.stream, 'world');
    expect(capture.result()).toEqual({ text: 'hello world', byteSize: 11, truncated: false });
  });

  it('keeps the first limit bytes and counts every byte written', async () => {
    const capture = createCaptureStream(4);
    await write(capture.stream, 'abcdefghij');
    const result = capture.result();
    expect(result.text).toBe('abcd');
    expect(result.byteSize).toBe(10);
    expect(result.truncated).toBe(true);
  });

  it('counts bytes, not characters', async () => {
    const capture = createCaptureStream(1024);
    await write(capture.stream, 'né');
    expect(capture.result()).toEqual({ text: 'né', byteSize: 3, truncated: false });
  });

  it('never emits a partial UTF-8 sequence at the truncation boundary', async () => {
    const capture = createCaptureStream(2);
    await write(capture.stream, 'aé');
    const result = capture.result();
    expect(result.text).toBe('a');
    expect(result.text).not.toContain('\uFFFD');
    expect(result.byteSize).toBe(3);
    expect(result.truncated).toBe(true);
  });

  it('rejects a non-positive limit', () => {
    expect(() => createCaptureStream(0)).toThrow(RangeError);
    expect(() => createCaptureStream(-1)).toThrow(RangeError);
  });

  it('retains the full stream separately when it overflows', async () => {
    const capture = createCaptureStream(4, 1024);
    await write(capture.stream, 'abcdefghij');
    const result = capture.result();
    expect(result.text).toBe('abcd');
    expect(result.full).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(result.full!)).toBe('abcdefghij');
  });

  it('copies retained bytes instead of keeping the source buffer alive', async () => {
    const capture = createCaptureStream(4, 1024);
    const source = Buffer.from('abcdefghij');
    await write(capture.stream, source);
    source.fill('x');
    const result = capture.result();
    expect(result.text).toBe('abcd');
    expect(new TextDecoder().decode(result.full!)).toBe('abcdefghij');
  });

  it('retains nothing extra when the stream fits inline', async () => {
    const capture = createCaptureStream(1024, 4096);
    const source = Buffer.from('small');
    await write(capture.stream, source);
    source.fill('x');
    const result = capture.result();
    expect(result.text).toBe('small');
    expect(result.full).toBeUndefined();
  });

  it('bounds the retained copy too, so a runaway stream cannot exhaust memory', async () => {
    const capture = createCaptureStream(4, 8);
    await write(capture.stream, 'abcdefghijklmnop');
    const result = capture.result();
    expect(result.full!.byteLength).toBe(8);
    expect(result.byteSize).toBe(16);
  });
});
