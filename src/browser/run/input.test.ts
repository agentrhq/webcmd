import { describe, expect, it } from 'vitest';
import { loadBrowserRunSource, type BrowserRunSourceIo } from './input.js';
import { BROWSER_RUN_MAX_SOURCE_BYTES } from './types.js';

function fakeIo(opts: {
  stdin?: string;
  files?: Record<string, string>;
} = {}): BrowserRunSourceIo {
  return {
    readStdin: async () => opts.stdin ?? '',
    readFile: async (filePath) => {
      const value = opts.files?.[filePath];
      if (value === undefined) throw new Error(`ENOENT: ${filePath}`);
      return value;
    },
  };
}

describe('loadBrowserRunSource', () => {
  it('requires exactly one source input', async () => {
    await expect(loadBrowserRunSource({ stdin: false }, fakeIo())).rejects.toMatchObject({
      code: 'BROWSER_RUN_INVALID_INPUT',
    });
    await expect(loadBrowserRunSource(
      { stdin: true, file: 'task.js' },
      fakeIo({ stdin: 'return 1;', files: { 'task.js': 'return 2;' } }),
    )).rejects.toMatchObject({
      code: 'BROWSER_RUN_INVALID_INPUT',
    });
  });

  it('reads a file in the CLI process', async () => {
    await expect(loadBrowserRunSource(
      { file: 'task.js' },
      fakeIo({ files: { 'task.js': 'return 42;' } }),
    )).resolves.toBe('return 42;');
  });

  it('reads standard input when selected', async () => {
    await expect(loadBrowserRunSource(
      { stdin: true },
      fakeIo({ stdin: 'const page = await browser.currentPage();' }),
    )).resolves.toBe('const page = await browser.currentPage();');
  });

  it('rejects empty source', async () => {
    await expect(loadBrowserRunSource(
      { stdin: true },
      fakeIo({ stdin: ' \n\t' }),
    )).rejects.toMatchObject({
      code: 'BROWSER_RUN_INVALID_INPUT',
      hint: expect.stringContaining('return structured data'),
    });
  });

  it('enforces the UTF-8 byte limit for stdin and files', async () => {
    const oversized = '😀'.repeat(Math.floor(BROWSER_RUN_MAX_SOURCE_BYTES / 4) + 1);

    await expect(loadBrowserRunSource(
      { stdin: true },
      fakeIo({ stdin: oversized }),
    )).rejects.toMatchObject({
      code: 'BROWSER_RUN_SOURCE_LIMIT',
    });

    await expect(loadBrowserRunSource(
      { file: 'task.js' },
      fakeIo({ files: { 'task.js': oversized } }),
    )).rejects.toMatchObject({
      code: 'BROWSER_RUN_SOURCE_LIMIT',
    });
  });

  it('does not include a client file path in file-read failures', async () => {
    await expect(loadBrowserRunSource(
      { file: '/Users/example/private/task.js' },
      fakeIo(),
    )).rejects.toMatchObject({
      code: 'BROWSER_RUN_INVALID_INPUT',
      message: 'Could not read the browser run source file.',
    });
  });
});
