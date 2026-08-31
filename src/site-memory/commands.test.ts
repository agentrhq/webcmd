import { Command } from 'commander';
import { describe, expect, it, vi } from 'vitest';
import { applyUnknownOptionContract, CommanderStructuralError } from '../command-surface.js';
import { ArgumentError, CliError, EXIT_CODES } from '../errors.js';
import {
  readSitePutSource,
  registerSiteCommands,
  type SiteLearningBackend,
  type SiteMemoryBackend,
} from './commands.js';

function backend(overrides: Partial<SiteMemoryBackend> = {}): SiteMemoryBackend {
  return {
    show: vi.fn(async () => [{ path: 'notes.md', body: '# notes' }]),
    list: vi.fn(async () => [{ path: 'notes.md', byteSize: 7, updatedAt: '2026-01-01T00:00:00.000Z', sha256: 'abc' }]),
    note: vi.fn(async () => undefined),
    endpoint: vi.fn(async () => undefined),
    stale: vi.fn(async () => undefined),
    fieldMap: vi.fn(async () => undefined),
    fixture: vi.fn(async () => '{"args":{}}'),
    putFixture: vi.fn(async () => undefined),
    sample: vi.fn(async () => undefined),
    ...overrides,
  };
}

const PRODUCT = {
  key: 'example.test',
  hostname: 'example.test',
  displayHostname: 'example.test',
  registrableDomain: 'example.test',
};

const SUMMARY = {
  id: '20260831T142300Z-aaaa',
  domain: 'example.test',
  hostname: 'example.test',
  observedAt: '2026-08-31T14:23:00.000Z',
  observedDateUtc: '2026-08-31',
  kind: 'access',
  claim: 'Login is optional for /hot',
  consequence: 'Skip auth for listing',
  status: 'pending' as const,
};

function learning(overrides: Partial<SiteLearningBackend> = {}): SiteLearningBackend {
  return {
    context: vi.fn(async () => ({
      resolution: { status: 'new' as const, requested: PRODUCT, product: PRODUCT, readOnly: false },
      revision: 'rev1',
      siteMarkdown: '# Example',
      references: [{ path: 'sitemap/references/alt.md' }],
      draftPath: '/tmp/drafts/task-1/example.test/sitemap',
      readOnly: false,
      diagnostics: [],
    })),
    addCandidate: vi.fn(async () => SUMMARY),
    searchCandidates: vi.fn(async () => [SUMMARY]),
    showCandidate: vi.fn(async () => ({
      schemaVersion: 1 as const,
      ...SUMMARY,
      evidence: 'Opened /hot without login',
      environment: { publicIp: '203.0.113.9', machine: 'secret-host' },
      evidenceRole: null,
      memoryCommit: null,
      reviewedAt: null,
      rejectionReason: null,
    })),
    listCandidates: vi.fn(async () => [SUMMARY]),
    checkpoint: vi.fn(async () => ({ status: 'committed' as const, memoryCommit: 'mem1', provenanceCommit: 'prov1' })),
    classify: vi.fn(async () => ({
      status: 'classified' as const,
      decision: 'same-product' as const,
      requested: PRODUCT,
      product: PRODUCT,
      existing: false,
      revision: 'rev2',
    })),
    ...overrides,
  };
}

function program(
  store: SiteMemoryBackend,
  io?: { readStdin?: () => Promise<string> },
  learn?: SiteLearningBackend,
): Command {
  const root = new Command('webcmd').exitOverride();
  registerSiteCommands(root, store, undefined, io, learn);
  applyUnknownOptionContract(root);
  return root;
}

function leaf(root: Command, path: string[]): Command {
  let command: Command | undefined = root;
  for (const segment of path) command = command?.commands.find(child => child.name() === segment);
  if (!command) throw new Error(`missing command: ${path.join(' ')}`);
  return command;
}

async function jsonOf(argv: string[], learn: SiteLearningBackend = learning()): Promise<unknown> {
  const logged: unknown[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((value: unknown) => { logged.push(value); });
  try {
    await program(backend(), undefined, learn).parseAsync(argv, { from: 'user' });
    return JSON.parse(String(logged[0]));
  } finally {
    spy.mockRestore();
  }
}

describe('site memory format flags', () => {
  it('documents the site argument grammar in site-memory help', () => {
    const help = program(backend()).commands.find(command => command.name() === 'site')!.helpInformation();

    expect(help).toContain('webcmd site <group> <verb> <site>');
    expect(help).toContain('Right: webcmd site field-map add example.com price');
    expect(help).toContain("Agent tip: use '--help -f yaml'");
  });

  it('accepts -f json on site fixture get', async () => {
    const store = backend();
    await program(store).parseAsync(['site', 'fixture', 'get', 'quotes-toscrape/list', '-f', 'json'], { from: 'user' });
    expect(store.fixture).toHaveBeenCalledWith('quotes-toscrape', 'list');
  });

  it.each([
    ['site', 'memory', 'show', 'quotes-toscrape', '--kind', 'endpoints', '-f', 'json'],
    ['site', 'memory', 'list', 'quotes-toscrape', '-f', 'json'],
    ['site', 'note', 'list', 'quotes-toscrape', '--json'],
    ['site', 'endpoint', 'list', 'quotes-toscrape', '-f', 'json'],
  ])('accepts format flags on %s %s %s', async (...argv) => {
    const store = backend();
    await program(store).parseAsync(argv, { from: 'user' });
    expect(vi.mocked(store.show).mock.calls.length + vi.mocked(store.list).mock.calls.length).toBeGreaterThan(0);
  });

  it.each([
    { argv: ['site', 'note', 'add', 'quotes-toscrape', '--text', 'hi'], expected: { ok: true, action: 'note add', site: 'quotes-toscrape' } },
    { argv: ['site', 'endpoint', 'stale', 'quotes-toscrape', 'listing'], expected: { ok: true, action: 'endpoint stale', site: 'quotes-toscrape', endpoint: 'listing' } },
    { argv: ['site', 'field-map', 'add', 'quotes-toscrape', 'q', '--meaning', 'quote', '--source', 'dom'], expected: { ok: true, action: 'field-map add', site: 'quotes-toscrape', key: 'q' } },
  ])('renders a structured result for write command $argv.1 $argv.2', async ({ argv, expected }) => {
    const logged: unknown[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((value: unknown) => { logged.push(value); });
    try {
      await program(backend()).parseAsync(argv, { from: 'user' });
      expect(logged).toEqual([]);
      await program(backend()).parseAsync([...argv, '--json'], { from: 'user' });
      expect(JSON.parse(String(logged[0]))).toEqual(expected);
    } finally {
      spy.mockRestore();
    }
  });

  it('rejects unknown flags with the valid set including --format and --json', async () => {
    try {
      await program(backend()).parseAsync(['site', 'memory', 'show', 'quotes-toscrape', '--nope'], { from: 'user' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(CommanderStructuralError);
      const output = (error as CommanderStructuralError).output;
      expect(output).toContain("unknown option '--nope'");
      expect(output).toContain('--format');
      expect(output).toContain('--json');
    }
  });
});

describe('site fixture put --stdin', () => {
  it('reads stdin when --stdin is set', async () => {
    const store = backend();
    await program(store, { readStdin: async () => '{"args":{}}' })
      .parseAsync(['site', 'fixture', 'put', 'quotes-toscrape/list', '--stdin'], { from: 'user' });
    expect(store.putFixture).toHaveBeenCalledWith('quotes-toscrape', 'list', '{"args":{}}');
  });

  it('reads stdin when the path is -', async () => {
    const store = backend();
    await program(store, { readStdin: async () => '{"ok":true}' })
      .parseAsync(['site', 'sample', 'add', 'quotes-toscrape/list', '-'], { from: 'user' });
    expect(store.sample).toHaveBeenCalledWith('quotes-toscrape', 'list', '{"ok":true}');
  });
});

describe('site command help coverage', () => {
  function walk(command: Command): Command[] {
    return command.commands
      .filter(child => child.name() !== 'help')
      .flatMap(child => [child, ...walk(child)]);
  }

  const site = program(backend()).commands.find(command => command.name() === 'site')!;

  it('gives every command in the site tree a description', () => {
    const missing = walk(site).filter(command => command.description().trim() === '');
    expect(missing.map(command => command.name())).toEqual([]);
  });

  it('gives every site option and positional a help string', () => {
    const missing: string[] = [];
    for (const command of walk(site)) {
      for (const option of command.options) {
        if (!option.description) missing.push(`${command.name()} ${option.flags}`);
      }
      for (const arg of command.registeredArguments) {
        if (!arg.description) missing.push(`${command.name()} <${arg.name()}>`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('documents --text and the site-before-flags order on site note add', () => {
    const help = site.commands.find(command => command.name() === 'note')!
      .commands.find(command => command.name() === 'add')!
      .helpInformation();

    expect(help).toContain('--text <markdown>');
    expect(help).toMatch(/Usage: .*note add \[options\] <site>/);
    expect(help).toContain('Example: webcmd site note add example.com --text');
  });
});

describe('readSitePutSource', () => {
  it('enumerates the valid input shape when neither path nor --stdin is given', async () => {
    await expect(readSitePutSource({})).rejects.toBeInstanceOf(ArgumentError);
    await expect(readSitePutSource({})).rejects.toThrow(/--stdin/);
  });
});

describe('local learning command contract', () => {
  const learn = () => learning();

  it('registers exact positional grammar only when a learning backend is provided', () => {
    expect(() => leaf(program(backend()), ['site', 'memory', 'context'])).toThrow(/missing command/);
    const root = program(backend(), undefined, learn());
    expect(leaf(root, ['site', 'memory', 'context']).helpInformation()).toMatch(/Usage: .*memory context \[options\] <url>/);
    expect(leaf(root, ['site', 'memory', 'candidate', 'add']).helpInformation()).toMatch(/Usage: .*candidate add \[options\] <product>/);
    expect(leaf(root, ['site', 'memory', 'candidate', 'search']).helpInformation()).toMatch(/Usage: .*candidate search \[options\] <product>/);
    expect(leaf(root, ['site', 'memory', 'candidate', 'show']).helpInformation()).toMatch(/Usage: .*candidate show \[options\] <product> <id>/);
    expect(leaf(root, ['site', 'memory', 'candidate', 'list']).helpInformation()).toMatch(/Usage: .*candidate list \[options\] <product>/);
    expect(leaf(root, ['site', 'memory', 'checkpoint']).helpInformation()).toMatch(/Usage: .*memory checkpoint \[options\] <product>/);
    expect(leaf(root, ['site', 'memory', 'classify']).helpInformation()).toMatch(/Usage: .*memory classify \[options\] <host>/);
    expect(leaf(root, ['site', 'memory', 'candidate', 'search']).helpInformation()).toMatch(/capped at 20|at most 20/i);
  });

  it.each([
    { argv: ['site', 'memory', 'context', 'https://example.test/'], flag: '--task-id' },
    { argv: ['site', 'memory', 'candidate', 'add', 'example.test'], flag: '--kind' },
    { argv: ['site', 'memory', 'candidate', 'search', 'example.test'], flag: '--query' },
    { argv: ['site', 'memory', 'checkpoint', 'example.test'], flag: '--expected-revision' },
  ])('rejects $argv.1 $argv.2 without $flag', async ({ argv, flag }) => {
    await expect(program(backend(), undefined, learn()).parseAsync(argv, { from: 'user' }))
      .rejects.toBeInstanceOf(CommanderStructuralError);
    expect(leaf(program(backend(), undefined, learn()), argv.slice(0, -1)).helpInformation()).toContain(flag);
  });

  it('rejects unknown flags with the valid set for candidate add', async () => {
    try {
      await program(backend(), undefined, learn()).parseAsync([
        'site', 'memory', 'candidate', 'add', 'example.test',
        '--kind', 'access', '--claim', 'c', '--evidence', 'e', '--consequence', 'q', '--nope',
      ], { from: 'user' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(CommanderStructuralError);
      const output = (error as CommanderStructuralError).output;
      expect(output).toContain("unknown option '--nope'");
      expect(output).toContain('--kind');
      expect(output).toContain('--json');
    }
  });

  it('enumerates valid candidate kinds', async () => {
    await expect(program(backend(), undefined, learn()).parseAsync([
      'site', 'memory', 'candidate', 'add', 'example.test',
      '--kind', 'secret', '--claim', 'c', '--evidence', 'e', '--consequence', 'q',
    ], { from: 'user' })).rejects.toMatchObject({
      code: 'ARGUMENT',
      message: expect.stringMatching(/action_space, better_path, access, high_consequence, repeated_mistake/),
    });
  });

  it('returns structured JSON for context, candidate inventory, and checkpoint', async () => {
    const store = learn();
    expect(await jsonOf(['site', 'memory', 'context', 'https://example.test/', '--task-id', 'task-1'], store)).toEqual(
      expect.objectContaining({
        revision: 'rev1',
        siteMarkdown: '# Example',
        references: [{ path: 'sitemap/references/alt.md' }],
        draftPath: '/tmp/drafts/task-1/example.test/sitemap',
        readOnly: false,
        diagnostics: [],
      }),
    );
    expect(await jsonOf([
      'site', 'memory', 'candidate', 'add', 'example.test',
      '--kind', 'access', '--claim', 'c', '--evidence', 'e', '--consequence', 'q',
    ], store)).toEqual(SUMMARY);
    expect(await jsonOf(['site', 'memory', 'candidate', 'search', 'example.test', '--query', 'login'], store)).toEqual([SUMMARY]);
    expect(await jsonOf(['site', 'memory', 'candidate', 'list', 'example.test'], store)).toEqual([SUMMARY]);
    expect(JSON.stringify(await jsonOf(['site', 'memory', 'candidate', 'search', 'example.test', '--query', 'login'], store)))
      .not.toMatch(/203\.0\.113\.9|secret-host|environment/);
    const shown = await jsonOf(['site', 'memory', 'candidate', 'show', 'example.test', SUMMARY.id], store) as { environment: unknown };
    expect(shown.environment).toEqual({ publicIp: '203.0.113.9', machine: 'secret-host' });
    expect(await jsonOf([
      'site', 'memory', 'checkpoint', 'example.test',
      '--task-id', 'task-1', '--expected-revision', 'rev1', '--reason', 'direct_correction', '--paths', 'sitemap/SITE.md',
    ], store)).toEqual({ status: 'committed', memoryCommit: 'mem1', provenanceCommit: 'prov1' });
    expect(await jsonOf([
      'site', 'memory', 'classify', 'old.example.test',
      '--same-product', 'example.test', '--expected-revision', 'rev1',
    ], store)).toEqual({
      status: 'classified',
      decision: 'same-product',
      requested: PRODUCT,
      product: PRODUCT,
      existing: false,
      revision: 'rev2',
    });
  });

  it('hides candidates from ordinary memory list and show', async () => {
    const listed = await jsonOf(['site', 'memory', 'list', 'example.test', '-f', 'json']);
    const shown = await jsonOf(['site', 'memory', 'show', 'example.test', '-f', 'json']);
    expect(JSON.stringify({ listed, shown })).not.toMatch(/candidates\/|203\.0\.113\.9/);
    expect(await jsonOf(['site', 'memory', 'candidate', 'list', 'example.test'])).toEqual([SUMMARY]);
  });

  it('enumerates classify decisions and rejects combining --same-product with --distinct', async () => {
    await expect(program(backend(), undefined, learn()).parseAsync([
      'site', 'memory', 'classify', 'old.example.test', '--expected-revision', 'rev1',
    ], { from: 'user' })).rejects.toMatchObject({
      code: 'ARGUMENT',
      message: expect.stringMatching(/--same-product|--distinct/),
    });
    await expect(program(backend(), undefined, learn()).parseAsync([
      'site', 'memory', 'classify', 'old.example.test',
      '--same-product', 'example.test', '--distinct', '--expected-revision', 'rev1',
    ], { from: 'user' })).rejects.toMatchObject({ code: 'ARGUMENT' });
  });

  it('forwards distinct classification', async () => {
    const store = learn();
    await program(backend(), undefined, store).parseAsync([
      'site', 'memory', 'classify', 'news.example.test', '--distinct', '--expected-revision', 'rev1',
    ], { from: 'user' });
    expect(store.classify).toHaveBeenCalledWith({
      requested: 'news.example.test',
      decision: 'distinct',
      expectedRevision: 'rev1',
    });
  });

  it('returns SITE_MEMORY_CONFLICT with revision details', async () => {
    const store = learning({
      checkpoint: vi.fn(async () => ({ status: 'conflict' as const, expectedRevision: 'old', actualRevision: 'new' })),
    });
    await expect(program(backend(), undefined, store).parseAsync([
      'site', 'memory', 'checkpoint', 'example.test',
      '--task-id', 'task-1', '--expected-revision', 'old', '--reason', 'direct_correction', '--paths', 'sitemap/SITE.md',
    ], { from: 'user' })).rejects.toMatchObject({
      code: 'SITE_MEMORY_CONFLICT',
      exitCode: EXIT_CODES.TEMPFAIL,
      details: { expectedRevision: 'old', actualRevision: 'new' },
    });
  });

  it('returns SITE_MEMORY_NOT_FOUND for a missing candidate show', async () => {
    const store = learning({
      showCandidate: vi.fn(async () => { throw new Error('Candidate missing was not found.'); }),
    });
    await expect(program(backend(), undefined, store).parseAsync([
      'site', 'memory', 'candidate', 'show', 'example.test', 'missing',
    ], { from: 'user' })).rejects.toBeInstanceOf(CliError);
    await expect(program(backend(), undefined, store).parseAsync([
      'site', 'memory', 'candidate', 'show', 'example.test', 'missing',
    ], { from: 'user' })).rejects.toMatchObject({
      code: 'SITE_MEMORY_NOT_FOUND',
      exitCode: EXIT_CODES.EMPTY_RESULT,
    });
  });
});

describe('learning command trust-boundary parsers', () => {
  const checkpoint = (...extra: string[]) => [
    'site', 'memory', 'checkpoint', 'example.test',
    '--task-id', 'task-1', '--expected-revision', 'rev1', '--reason', 'direct_correction',
    ...extra,
  ];

  async function expectArgument(argv: string[]): Promise<void> {
    await expect(program(backend(), undefined, learning()).parseAsync(argv, { from: 'user' }))
      .rejects.toMatchObject({ code: 'ARGUMENT' });
  }

  it.each(['1x', '1.5', '+1', '-1', '0', String(Number.MAX_SAFE_INTEGER + 1), '9'.repeat(400)])(
    'rejects --limit %s',
    async (limit) => {
      await expectArgument(['site', 'memory', 'candidate', 'search', 'example.test', '--query', 'login', '--limit', limit]);
    },
  );

  it('forwards a whole positive --limit', async () => {
    const store = learning();
    await program(backend(), undefined, store).parseAsync(
      ['site', 'memory', 'candidate', 'search', 'example.test', '--query', 'login', '--limit', '3'],
      { from: 'user' },
    );
    expect(store.searchCandidates).toHaveBeenCalledWith('example.test', 'login', 3);
  });

  it.each(['', ',', 'sitemap/SITE.md,', ',sitemap/SITE.md', 'sitemap/SITE.md,,other.md', 'a, a', 'a,b,a'])(
    'rejects --paths %s',
    async (paths) => {
      await expectArgument(checkpoint('--paths', paths));
    },
  );

  it('forwards unique nonempty --paths', async () => {
    const store = learning();
    await program(backend(), undefined, store).parseAsync(
      checkpoint('--paths', 'sitemap/SITE.md, sitemap/other.md'),
      { from: 'user' },
    );
    expect(store.checkpoint).toHaveBeenCalledWith(expect.objectContaining({
      paths: ['sitemap/SITE.md', 'sitemap/other.md'],
    }));
  });

  it.each([
    'not-json',
    '{}',
    '[1]',
    '[[]]',
    '[{"status":"rejected"}]',
    '[{"id":"","status":"rejected"}]',
    '[{"id":"cand-1","status":"pending"}]',
    '[{"id":"cand-1","status":"ingested","evidenceRole":"maybe"}]',
    '[{"id":"cand-1","status":"rejected","conflictsWithMemory":"yes"}]',
    '[{"id":"cand-1","status":"rejected","extra":true}]',
    '[{"id":"cand-1","status":"rejected","rejectionReason":"password := hunter2"}]',
  ])('rejects --dispositions %s', async (dispositions) => {
    await expectArgument(checkpoint('--paths', 'sitemap/SITE.md', '--dispositions', dispositions));
  });

  it('forwards typed --dispositions without checkpoint field coupling', async () => {
    const store = learning();
    const dispositions = [
      { id: 'cand-1', status: 'ingested' as const, evidenceRole: 'supporting' as const, conflictsWithMemory: false },
      { id: 'cand-2', status: 'rejected' as const, rejectionReason: 'stale', evidenceRole: null },
    ];
    await program(backend(), undefined, store).parseAsync(
      checkpoint('--paths', 'sitemap/SITE.md', '--dispositions', JSON.stringify(dispositions)),
      { from: 'user' },
    );
    expect(store.checkpoint).toHaveBeenCalledWith(expect.objectContaining({ dispositions }));
  });
});
