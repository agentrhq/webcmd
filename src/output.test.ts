import { createHash } from 'node:crypto';
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { formatErrorEnvelope, formatOutput, render } from './output.js';

function sink(isTTY: boolean): { stream: Writable; text: () => string } {
  let data = '';
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      data += String(chunk);
      callback();
    },
  });
  Object.defineProperty(stream, 'isTTY', { value: isTTY });
  return { stream, text: () => data };
}

function rendered(data: unknown, options: Parameters<typeof formatOutput>[1], isTTY: boolean): string {
  const stdout = sink(isTTY);
  render(data, { ...options, stdout: stdout.stream });
  return stdout.text();
}

describe('formatOutput', () => {
  it.each([
    { name: 'null', data: null, options: { fmt: 'json', fmtExplicit: true }, isTTY: false },
    { name: 'empty arrays', data: [], options: { fmt: 'table', fmtExplicit: true }, isTTY: true },
    { name: 'one scalar field', data: { value: 'hello' }, options: { fmt: 'plain', fmtExplicit: true }, isTTY: false },
    {
      name: 'multiple rows',
      data: [{ name: 'alice', score: 10 }, { name: 'bob', score: 20 }],
      options: { fmt: 'table', fmtExplicit: true, columns: ['name', 'score'] },
      isTTY: true,
    },
  ])('renders $name byte-identically through the pure and stream APIs', ({ data, options, isTTY }) => {
    expect(rendered(data, options, isTTY)).toBe(formatOutput(data, { ...options, isTTY }));
  });

  it('escapes commas, quotes, and newlines in CSV', () => {
    expect(formatOutput([
      { name: 'a,b', note: 'said "hello"' },
      { name: 'plain', note: 'line 1\nline 2' },
    ], { fmt: 'csv', fmtExplicit: true, columns: ['name', 'note'], isTTY: false })).toBe(
      'name,note\n"a,b","said ""hello"""\nplain,"line 1\nline 2"\n',
    );
  });

  it('preserves the legacy literal Markdown table cells', () => {
    expect(formatOutput([
      { name: 'a|b', note: 'line 1\nline 2' },
    ], { fmt: 'md', fmtExplicit: true, columns: ['name', 'note'], isTTY: false })).toBe(
      '| name | note |\n| --- | --- |\n| a|b | line 1\nline 2 |\n',
    );
  });

  it('uses TOON for an implicit table format on a non-TTY stream', () => {
    expect(rendered([{ name: 'alice', score: 10 }], {
      fmt: 'table',
      fmtExplicit: false,
      columns: ['name', 'score'],
    }, false)).toBe('items[1]{name,score}:\n  alice,10\n');
  });

  it('uses a table for an implicit table format on a TTY stream', () => {
    const output = rendered([{ name: 'alice', score: 10 }], {
      fmt: 'table',
      fmtExplicit: false,
      columns: ['name', 'score'],
    }, true);
    expect(output).toContain('alice');
    expect(output).toContain('1 items');
    expect(output).not.toContain('name: alice');
  });

  it('honors an explicit table format on a non-TTY stream', () => {
    const output = rendered([{ name: 'alice' }], {
      fmt: 'table',
      fmtExplicit: true,
      columns: ['name'],
    }, false);
    expect(output).toContain('alice');
    expect(output).not.toContain('name: alice');
  });

  it('honors an explicit JSON format on a non-TTY stream', () => {
    expect(rendered([{ name: 'alice' }], {
      fmt: 'json',
      fmtExplicit: true,
    }, false)).toBe('[\n  {\n    "name": "alice"\n  }\n]\n');
  });

  it('writes values larger than 1 MiB completely', () => {
    const value = 'x'.repeat((1024 * 1024) + 17);
    const expected = `${value}\n`;
    const output = rendered({ value }, { fmt: 'plain', fmtExplicit: true }, false);
    expect(output.length).toBe(expected.length);
    expect(createHash('sha256').update(output).digest('hex'))
      .toBe(createHash('sha256').update(expected).digest('hex'));
  });

  it('does not resolve stream rendering before the write callback and drain', async () => {
    let release: (() => void) | undefined;
    const stdout = new Writable({
      highWaterMark: 1,
      write(_chunk, _encoding, callback) {
        release = callback;
      },
    });
    let settled = false;
    const rendering = render({ value: 'slow' }, {
      fmt: 'plain',
      fmtExplicit: true,
      stdout,
    }).then(() => { settled = true; });
    await new Promise(resolve => setImmediate(resolve));

    expect(settled).toBe(false);
    release?.();
    await rendering;
    expect(settled).toBe(true);
  });

  it('shows elapsed time when elapsed is zero', () => {
    expect(formatOutput([{ name: 'alice' }], {
      fmt: 'table',
      fmtExplicit: true,
      columns: ['name'],
      elapsed: 0,
      isTTY: true,
    })).toContain('0.0s');
  });

  it('prints single Markdown payloads without wrapping them in a table', () => {
    expect(formatOutput([{ markdown: '# Title\n\nBody' }], {
      fmt: 'md',
      fmtExplicit: true,
      isTTY: false,
    })).toBe('# Title\n\nBody\n');
  });

  describe('formatToon', () => {
    it('serializes nested objects safely', () => {
      expect(formatOutput([{ name: 'bob', profile: { age: 30 } }], {
        fmt: 'toon',
        fmtExplicit: true,
        columns: ['name', 'profile'],
      })).toBe('items[1]{name,profile}:\n  bob,"{""age"":30}"\n');
    });

    it('preserves single item root structure', () => {
      expect(formatOutput({ name: 'alice', active: true }, {
        fmt: 'toon',
        fmtExplicit: true,
        columns: ['name', 'active'],
      })).toBe('name: alice\nactive: true\n');
    });

    it('escapes newlines in values', () => {
      expect(formatOutput([{ note: 'hello\nworld' }], {
        fmt: 'toon',
        fmtExplicit: true,
        columns: ['note'],
      })).toBe('items[1]{note}:\n  "hello\\nworld"\n');
    });

    it('supports custom nouns for empty states and root arrays', () => {
      expect(formatOutput([], { fmt: 'toon', fmtExplicit: true, noun: 'tasks' }))
        .toBe('tasks: 0 found\n');
      expect(formatOutput([{ id: 1 }], { fmt: 'toon', fmtExplicit: true, noun: 'tasks', columns: ['id'] }))
        .toBe('tasks[1]{id}:\n  1\n');
    });
  });
});

describe('formatErrorEnvelope', () => {
  it('returns the local TOON/YAML envelope bytes without writing to stderr', () => {
    expect(formatErrorEnvelope({
      ok: false,
      error: {
        code: 'AUTH_REQUIRED',
        message: 'Sign in first',
        help: 'Run webcmd github login.',
        exitCode: 77,
      },
    })).toBe([
      'ok: false',
      'error:',
      '  code: AUTH_REQUIRED',
      '  message: Sign in first',
      '  help: Run webcmd github login.',
      '  exitCode: 77',
      '',
    ].join('\n'));
  });
});
