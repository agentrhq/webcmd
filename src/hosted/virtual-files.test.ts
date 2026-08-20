import { describe, expect, it } from 'vitest';
import {
  VirtualPathError,
  createVirtualFileMap,
  createVirtualOutputSink,
  normalizeVirtualPath,
} from './virtual-files.js';

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('normalizeVirtualPath', () => {
  it('keeps a simple relative path', () => {
    expect(normalizeVirtualPath('input.json')).toBe('input.json');
    expect(normalizeVirtualPath('rows/data.csv')).toBe('rows/data.csv');
  });

  it('normalizes redundant segments', () => {
    expect(normalizeVirtualPath('./a/./b.txt')).toBe('a/b.txt');
    expect(normalizeVirtualPath('a/../b.txt')).toBe('b.txt');
  });

  it.each([
    ['', 'empty'],
    ['/etc/passwd', 'absolute'],
    ['../secrets.txt', 'traversal'],
    ['..', 'bare parent'],
    ['a/../../b', 'traversal through a segment'],
    ['C:/Windows/system32', 'windows drive letter'],
    ['a\\b.txt', 'backslash separator'],
    ['bad\u0000name', 'control character'],
    ['dir/', 'directory'],
    ['.', 'current directory'],
  ])('rejects %s (%s)', (input) => {
    expect(() => normalizeVirtualPath(input)).toThrow(VirtualPathError);
  });
});

describe('createVirtualFileMap', () => {
  it('keys files by their normalized path', () => {
    const map = createVirtualFileMap([{ path: './a/../input.json', content: bytes('{}') }]);
    expect([...map.keys()]).toEqual(['input.json']);
    expect(map.get('input.json')?.path).toBe('input.json');
  });

  it('rejects two entries that normalize to the same path', () => {
    expect(() =>
      createVirtualFileMap([
        { path: 'a.txt', content: bytes('1') },
        { path: './a.txt', content: bytes('2') },
      ]),
    ).toThrow(VirtualPathError);
  });
});

describe('createVirtualOutputSink', () => {
  it('collects writes under normalized paths', () => {
    const sink = createVirtualOutputSink();
    sink.write('./out/report.csv', bytes('a,b'), 'text/csv');
    expect(sink.files()).toEqual([
      { path: 'out/report.csv', content: bytes('a,b'), contentType: 'text/csv' },
    ]);
  });

  it('lets a later write replace an earlier one at the same path', () => {
    const sink = createVirtualOutputSink();
    sink.write('out.txt', bytes('first'));
    sink.write('out.txt', bytes('second'));
    expect(sink.files()).toHaveLength(1);
    expect(new TextDecoder().decode(sink.files()[0]!.content)).toBe('second');
  });

  it('rejects an escaping output path', () => {
    const sink = createVirtualOutputSink();
    expect(() => sink.write('../escape.txt', bytes('x'))).toThrow(VirtualPathError);
  });
});
