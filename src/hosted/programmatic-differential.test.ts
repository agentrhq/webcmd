import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, lstat, mkdir, mkdtemp, opendir, readFile, readlink, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runHostedProgrammatic, type HostedVirtualFile } from './programmatic.js';
import { startDifferentialBackend, type DifferentialBackend } from './__fixtures__/differential-backend.js';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const cliEntry = path.join(repoRoot, 'dist', 'src', 'main.js');
const packageRoot = path.join(repoRoot, 'dist');
const sourceText = 'export const fixture = true;\n';
const sourceFile: HostedVirtualFile = { path: 'source.js', content: new TextEncoder().encode(sourceText) };

let backend: DifferentialBackend;
let configDir: string;

beforeAll(async () => {
  backend = await startDifferentialBackend();
  configDir = await mkdtemp(path.join(tmpdir(), 'webcmd-differential-'));
  await mkdir(configDir, { recursive: true });
  await writeFile(path.join(configDir, 'config.json'), `${JSON.stringify({
    mode: 'hosted', updatedAt: '1970-01-01T00:00:00.000Z',
    hosted: { apiBaseUrl: backend.url, apiKey: 'fixture-token' },
  }, null, 2)}\n`, { mode: 0o600 });
  await writeFile(path.join(configDir, sourceFile.path), sourceFile.content);
});

afterAll(async () => {
  await backend.close();
  await rm(configDir, { recursive: true, force: true });
});

/** Pin rendering inputs so this compares CLI behaviour, not the terminal. */
async function runInstalled(argv: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [cliEntry, ...argv], {
      cwd: configDir,
      env: {
        PATH: process.env.PATH ?? '', HOME: configDir, WEBCMD_CONFIG_DIR: configDir,
        NO_COLOR: '1', COLUMNS: '80', CI: '1', WEBCMD_NO_UPDATE_CHECK: '1',
      },
      maxBuffer: 32 * 1024 * 1024,
    });
    return { exitCode: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { exitCode: failure.code ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
  }
}

function runProgrammatic(argv: string[], files?: readonly HostedVirtualFile[]) {
  return runHostedProgrammatic({ argv, apiBaseUrl: backend.url, accessToken: 'fixture-token', enableServerWebFetch: true, ...(files ? { files } : {}) });
}

const FIXTURES: { name: string; argv: string[]; files?: readonly HostedVirtualFile[] }[] = [
  { name: 'root help', argv: ['--help'] },
  { name: 'version', argv: ['--version'] },
  { name: 'list', argv: ['list'] },
  { name: 'list json', argv: ['list', '-f', 'json'] },
  { name: 'list by tag', argv: ['list', '--tag', 'search', '-f', 'json'] },
  { name: 'command help', argv: ['acme', 'search', '--help'] },
  { name: 'adapter read', argv: ['acme', 'search', '--query', 'widgets'] },
  { name: 'adapter read json', argv: ['acme', 'search', '--query', 'widgets', '-f', 'json'] },
  { name: 'adapter write', argv: ['acme', 'create', '--title', 'New item'] },
  { name: 'auth status', argv: ['auth', 'status'] },
  { name: 'auth refresh', argv: ['auth', 'refresh', '--site', 'acme'] },
  { name: 'browser tabs', argv: ['browser', 'tabs', '--session', 'session_fixture'] },
  { name: 'browser snapshot', argv: ['browser', 'snapshot', '--session', 'session_fixture', '-f', 'json'] },
  { name: 'session create', argv: ['session', 'create', '-f', 'json'] },
  { name: 'session list', argv: ['session', 'list'] },
  { name: 'session close', argv: ['session', 'close', 'session_fixture'] },
  { name: 'profile list', argv: ['profile', 'list'] },
  { name: 'profile delete', argv: ['profile', 'delete', 'profile_fixture'] },
  { name: 'plugin search', argv: ['plugin', 'search', 'acme'] },
  { name: 'plugin list', argv: ['plugin', 'list'] },
  { name: 'site memory list', argv: ['site', 'memory', 'list', 'acme'] },
  { name: 'site memory read', argv: ['site', 'memory', 'show', 'acme', '--kind', 'notes'] },
  { name: 'adapter source get', argv: ['adapter', 'source', 'get', 'acme/search', '--output', '-'] },
  { name: 'adapter source put', argv: ['adapter', 'source', 'put', 'acme/search', 'source.js'], files: [sourceFile] },
  { name: 'usage failure: missing required argument', argv: ['acme', 'search'] },
  { name: 'usage failure: unknown command', argv: ['acme', 'nonexistent'] },
  { name: 'usage failure: unknown flag', argv: ['acme', 'search', '--query', 'x', '--nope'] },
  { name: 'completion failure: unsupported shell', argv: ['completion', 'powershell'] },
  { name: 'completion failure: literal help-shaped shell', argv: ['--', 'completion', '--help'] },
  { name: 'completion failure: separator help-shaped shell', argv: ['completion', '--', '--help'] },
  { name: 'command failure', argv: ['acme', 'search', '--query', 'trigger-failure'] },
  { name: 'timeout', argv: ['acme', 'search', '--query', 'trigger-timeout'] },
  { name: 'action-required handoff', argv: ['acme', 'search', '--query', 'trigger-login-wall'] },
  { name: 'local-only rejection', argv: ['doctor'] },
  { name: 'shell metacharacters stay literal', argv: ['acme', 'search', '--query', 'a; rm -rf / && $(id)'] },
];

describe('programmatic runner matches the installed hosted CLI', () => {
  it.each(FIXTURES)('$name', async ({ argv, files }) => {
    const installed = await runInstalled(argv);
    const programmatic = await runProgrammatic(argv, files);
    expect(programmatic.exitCode).toBe(installed.exitCode);
    expect(programmatic.stdout).toBe(installed.stdout);
    expect(programmatic.stderr).toBe(installed.stderr);
  }, 20_000);
});

describe('programmatic runner isolation', () => {
  it('keeps shell metacharacters as literal execute input', async () => {
    const query = 'a; rm -rf / && $(id)';
    await runProgrammatic(['acme', 'search', '--query', query]);
    const execute = backend.requests.at(-1);
    expect(JSON.parse(execute?.body ?? '{}')).toMatchObject({ args: { query } });
  });

  it('keeps writer output virtual without changing the checkout or built package roots', async () => {
    const scratch = await mkdtemp(path.join(tmpdir(), 'webcmd-isolation-'));
    const packageBefore = await fingerprintTree(packageRoot);
    const before = process.cwd();
    process.chdir(scratch);
    try {
      const plugin = await runProgrammatic(['plugin', 'create', 'acme-widgets', '--author-name', 'Ada', '--author-handle', 'ada']);
      const source = await runProgrammatic(['adapter', 'source', 'get', 'acme/search', '--output', 'adapter.js']);
      expect(plugin.exitCode).toBe(0);
      expect(source.exitCode).toBe(0);
      expect(plugin.outputFiles.map(file => file.path).sort()).toEqual([
        'acme-widgets/README.md', 'acme-widgets/greet.ts', 'acme-widgets/hello.ts',
        'acme-widgets/package.json', 'acme-widgets/webcmd-plugin.json',
      ]);
      expect(source.outputFiles).toEqual([{ path: 'adapter.js', content: new TextEncoder().encode('export default {};\n') }]);
      expect(await readdir(scratch)).toEqual([]);
      expect(await fingerprintTree(packageRoot)).toBe(packageBefore);
    } finally {
      process.chdir(before);
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it('returns plugin scaffolding and adapter source output as virtual files', async () => {
    const plugin = await runProgrammatic(['plugin', 'create', 'acme-widgets', '--author-name', 'Ada', '--author-handle', 'ada']);
    expect(plugin.exitCode).toBe(0);
    expect(plugin.outputFiles.map(file => file.path).sort()).toEqual([
      'acme-widgets/README.md', 'acme-widgets/greet.ts', 'acme-widgets/hello.ts',
      'acme-widgets/package.json', 'acme-widgets/webcmd-plugin.json',
    ]);
    const source = await runProgrammatic(['adapter', 'source', 'get', 'acme/search', '--output', 'adapter.js']);
    expect(source.outputFiles).toEqual([{ path: 'adapter.js', content: new TextEncoder().encode('export default {};\n') }]);
  });

  it('preserves installed --dir and collision behavior while virtual paths stay relative', async () => {
    const pluginName = 'differential-scaffold';
    const installedDir = 'installed-scaffolds/custom';
    const collisionDir = 'installed-scaffolds/non-empty';
    await mkdir(path.join(configDir, collisionDir), { recursive: true });
    await writeFile(path.join(configDir, collisionDir, 'existing.txt'), 'occupied');
    try {
      const installed = await runInstalled(['plugin', 'create', pluginName, '--dir', installedDir,
        '--author-name', 'Ada', '--author-handle', 'ada']);
      expect(installed.exitCode).toBe(0);
      await expect(access(path.join(configDir, installedDir, 'README.md'))).resolves.toBeUndefined();

      const installedCollision = await runInstalled(['plugin', 'create', `${pluginName}-collision`, '--dir', collisionDir,
        '--author-name', 'Ada', '--author-handle', 'ada']);
      expect(installedCollision.exitCode).not.toBe(0);
      expect(installedCollision.stderr).toContain('not empty');

      const programmatic = await runProgrammatic(['plugin', 'create', pluginName, '--dir', 'virtual-scaffolds/custom',
        '--author-name', 'Ada', '--author-handle', 'ada']);
      expect(programmatic.exitCode).toBe(installed.exitCode);
      expect(programmatic.outputFiles.map(file => file.path)).toContain('virtual-scaffolds/custom/README.md');
      expect(programmatic.stdout).not.toContain(process.cwd());
      expect(programmatic.outputFiles.every(file => !path.isAbsolute(file.path))).toBe(true);

      const virtualCollision = await runHostedProgrammatic({
        argv: ['plugin', 'create', `${pluginName}-collision`, '--dir', 'virtual-scaffolds/non-empty',
          '--author-name', 'Ada', '--author-handle', 'ada'],
        apiBaseUrl: backend.url,
        accessToken: 'fixture-token',
        files: [{ path: 'virtual-scaffolds/non-empty/existing.txt', content: new Uint8Array([1]) }],
      });
      expect(virtualCollision.exitCode).toBe(installedCollision.exitCode);
      expect(virtualCollision.stderr).toContain('not empty');
      expect(virtualCollision.outputFiles).toEqual([]);
    } finally {
      await rm(path.join(configDir, 'installed-scaffolds'), { recursive: true, force: true });
      await rm(path.join(configDir, pluginName), { recursive: true, force: true });
      await rm(path.join(configDir, `${pluginName}-collision`), { recursive: true, force: true });
    }
  }, 20_000);

  it('uploads identical adapter source bytes from host and virtual inputs', async () => {
    const argv = ['adapter', 'source', 'put', 'acme/search', 'source.js'];
    const installed = await runInstalled(argv);
    const programmatic = await runProgrammatic(argv, [sourceFile]);
    expect(programmatic.exitCode).toBe(installed.exitCode);
    expect(programmatic.stdout).toBe(installed.stdout);
    expect(programmatic.stderr).toBe(installed.stderr);
    const bodies = backend.requests
      .filter(request => request.method === 'PUT' && request.path === '/v1/adapters/pkg_fixture/source/search.js')
      .slice(-2)
      .map(request => request.body);
    expect(bodies).toEqual([sourceText, sourceText]);
  });

  it('reports an error when the backend rejects an empty virtual adapter source', async () => {
    const result = await runProgrammatic(
      ['adapter', 'source', 'put', 'acme/search', 'source.js'],
      [{ path: 'source.js', content: new Uint8Array() }],
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('Fixture adapter source does not match expected bytes.');
  });

  it('rejects an input path that escapes the virtual root', async () => {
    await expect(runHostedProgrammatic({
      argv: ['acme', 'search', '--query', 'x'], apiBaseUrl: backend.url, accessToken: 't',
      files: [{ path: '../../etc/passwd', content: new Uint8Array() }],
    })).rejects.toThrow(/escapes the virtual root/);
  });

  it('rejects an output path that escapes the virtual root without writing it', async () => {
    const tempParent = await mkdtemp(path.join(tmpdir(), 'webcmd-output-traversal-parent-'));
    const scratch = path.join(tempParent, 'nested', 'scratch');
    await mkdir(scratch, { recursive: true });
    const output = `../../${path.basename(tempParent)}-escaped-target.js`;
    const target = path.resolve(scratch, output);
    const relativeTarget = path.relative(tempParent, target);
    if (!relativeTarget || relativeTarget.startsWith('..') || path.isAbsolute(relativeTarget)) {
      throw new Error(`Refusing to clean a target outside this test's temporary parent: ${target}`);
    }
    const before = process.cwd();
    process.chdir(scratch);
    try {
      await expect(access(target)).rejects.toMatchObject({ code: 'ENOENT' });
      const result = await runProgrammatic(['adapter', 'source', 'get', 'acme/search', '--output', output]);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toMatch(/escapes the virtual root|virtual file path/i);
      expect(result.outputFiles).toEqual([]);
      expect(await readdir(scratch)).toEqual([]);
      await expect(access(target)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      process.chdir(before);
      await rm(target, { force: true });
      await rm(scratch, { recursive: true, force: true });
      await rm(tempParent, { recursive: true, force: true });
    }
  });

  it('propagates cancellation to the injected transport', async () => {
    const controller = new AbortController();
    let started: () => void = () => undefined;
    const requestStarted = new Promise<void>(resolve => { started = resolve; });
    const result = runHostedProgrammatic({
      argv: ['list'], apiBaseUrl: backend.url, accessToken: 'fixture-token', signal: controller.signal,
      fetchImpl: ((_url, init) => new Promise((_resolve, reject) => {
        started();
        init?.signal?.addEventListener('abort', () => reject(new Error('cancelled by client disconnect')), { once: true });
      })) as typeof fetch,
    });
    await requestStarted;
    controller.abort();
    await expect(result).resolves.toMatchObject({
      exitCode: 130,
      stdout: '',
      stderr: expect.stringContaining('INTERRUPTED'),
    });
  });
});

async function fingerprintTree(root: string, excludedTopLevel = new Set<string>()): Promise<string> {
  const hash = createHash('sha256');
  async function visit(directory: string, relativeDirectory: string): Promise<void> {
    const entries = [];
    for await (const entry of await opendir(directory)) entries.push(entry);
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (!relativeDirectory && excludedTopLevel.has(entry.name)) continue;
      const relative = path.posix.join(relativeDirectory, entry.name);
      const absolute = path.join(directory, entry.name);
      const metadata = await lstat(absolute);
      hash.update(`${relative}\0${metadata.mode}\0${metadata.size}\0`);
      if (metadata.isDirectory()) await visit(absolute, relative);
      else if (metadata.isSymbolicLink()) hash.update(await readlink(absolute));
      else if (metadata.isFile()) hash.update(await readFile(absolute));
    }
  }
  await visit(root, '');
  return hash.digest('hex');
}
