#!/usr/bin/env node
/**
 * webcmd — Make any website your CLI. AI-powered.
 */

// Ensure standard system paths are available for child processes.
// Some environments (GUI apps, cron, IDE terminals) launch with a minimal PATH
// that excludes /usr/local/bin, /usr/sbin, etc., causing external CLIs to fail.
if (process.platform !== 'win32') {
  const std = ['/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'];
  const cur = new Set((process.env.PATH ?? '').split(':').filter(Boolean));
  for (const p of std) cur.add(p);
  process.env.PATH = [...cur].join(':');
}

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCompletionScriptFast, getCompletionsFromManifest, hasAllManifests } from './completion-fast.js';
import { findPackageRoot, getCliManifestPath } from './package-paths.js';
import { PKG_VERSION } from './version.js';
import { EXIT_CODES } from './errors.js';
import { isSupportedNodeVersion, MIN_SUPPORTED_NODE_MAJOR } from './runtime-detect.js';
import { CONFIG_DIR_NAME } from './brand.js';
import { configureHostedWorkspaceOption, parseHostedRootCommandSurface, rootCompletionSentinelIndex } from './root-command-surface.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// The empty core manifest remains next to the retired clis/ location so older
// user-local adapter manifests keep the same lookup contract.
const BUILTIN_CLIS = path.join(findPackageRoot(__filename), 'clis');
const USER_CLIS = path.join(os.homedir(), CONFIG_DIR_NAME, 'clis');
const USER_PLUGINS = path.join(os.homedir(), CONFIG_DIR_NAME, 'plugins');

// ── Ultra-fast path: lightweight commands bypass full discovery ──────────
// These are high-frequency or trivial paths that must not pay the startup tax.
const argv = process.argv.slice(2);

if (typeof (globalThis as { Bun?: unknown }).Bun === 'undefined' && !isSupportedNodeVersion(process.version)) {
  process.stderr.write(
    [
      `Webcmd requires Node.js >= ${MIN_SUPPORTED_NODE_MAJOR}.0.0.`,
      `Current runtime: ${process.version}`,
      'Upgrade Node.js, then retry the same command.',
      '',
    ].join('\n'),
  );
  process.exit(EXIT_CODES.CONFIG_ERROR);
}

// Fast path: --version (only when it's the top-level intent, not passed to a subcommand)
// e.g. `webcmd --version` or `webcmd -V`, but NOT `webcmd gh --version`
let fastPathHandled = false;
if (argv[0] === '--version' || argv[0] === '-V') {
  process.stdout.write(PKG_VERSION + '\n');
  process.exit(EXIT_CODES.SUCCESS);
}

// Fast path: completion <shell> — print shell script without discovery
if (!fastPathHandled && argv[0] === 'completion' && argv.length >= 2) {
  const script = getCompletionScriptFast(argv[1]!);
  if (script !== undefined) {
    process.stdout.write(script);
    process.exit(EXIT_CODES.SUCCESS);
  }
  // Unknown shell — fall through to full path for proper error handling
}

// Hosted setup and hosted dispatch run before local adapter discovery. This is
// the mode boundary: hosted mode must not read ~/.webcmd/clis or local site
// memory just to decide what commands exist. Awaiting the selected branch and
// assigning exitCode lets Node flush pending stdout/stderr before shutdown.
if (!fastPathHandled) {
  const rootSurface = parseRootSurface(argv);
  if (argv[0] === 'setup') {
    const { runHostedSetup } = await import('./hosted/setup.js');
    process.exitCode = await runHostedSetup({ argv: argv.slice(1) });
  } else if (
    rootSurface?.kind === 'dispatch'
    && (rootSurface.argv[0] === 'skills'
      || rootSurface.argv[0] === 'update'
      || rootSurface.argv[0] === 'external')
  ) {
    const { createProgram } = await import('./cli.js');
    const program = createProgram(BUILTIN_CLIS, USER_CLIS);
    if (rootSurface?.kind === 'dispatch' && rootSurface.workspace !== undefined) {
      configureHostedWorkspaceOption(program);
    }
    await program.parseAsync(argv, { from: 'user' });
  } else if (
    rootSurface?.kind === 'dispatch'
    && rootSurface.argv[0] === 'web'
    && rootSurface.argv[1] === 'fetch'
  ) {
    const { runWebFetchCommand } = await import('./fetch/command.js');
    await runWebFetchCommand(argv);
  } else {
    const { shouldUseHostedMode } = await import('./hosted/config.js');
    if (shouldUseHostedMode()) {
      const { runHostedCli } = await import('./hosted/runner.js');
      const { executeExternalCli, loadExternalClis } = await import('./external.js');
      // The installed CLI already owns local web/fetch transport authority.
      // Programmatic embedders remain opt-in and default to no network access.
      const result = await runHostedCli(argv, {
        enableServerWebFetch: true,
        hasLocalClientCommandHandlers: true,
        externals: { list: loadExternalClis, run: executeExternalCli },
        installedLocalCommandRoots: fs.existsSync(path.join(USER_PLUGINS, 'antigravity', 'serve.js'))
          ? new Set(['antigravity'])
          : undefined,
      });
      process.exitCode = result.exitCode;
    } else {
      const { installDaemonRunSignalCancellation } = await import('./signal-cancel.js');
      const uninstallSignalCancellation = installDaemonRunSignalCancellation();
      try {
        await runLocalMain();
      } finally {
        uninstallSignalCancellation();
      }
    }
  }
}

function parseRootSurface(args: readonly string[]) {
  try {
    return parseHostedRootCommandSurface(args);
  } catch {
    return undefined;
  }
}

async function runLocalMain(): Promise<void> {
// Fast path: --get-completions — read from manifest, skip discovery
const getCompIdx = rootCompletionSentinelIndex(argv);
if (getCompIdx !== -1) {
  // Only include manifests that actually exist on disk.
  // With sparse override, the user clis dir may exist but have no manifest.
  // Order matches runtime discovery: plugins before user clis, so an override
  // in ~/.webcmd/clis is what completion advertises last (and thus wins).
  const manifestPaths = [getCliManifestPath(BUILTIN_CLIS)];
  const uncoveredCommandRoots = [USER_PLUGINS];
  const userManifest = getCliManifestPath(USER_CLIS);
  try { fs.accessSync(userManifest); manifestPaths.push(userManifest); } catch { uncoveredCommandRoots.push(USER_CLIS); }
  if (hasAllManifests(manifestPaths, uncoveredCommandRoots)) {
    const rest = argv.slice(getCompIdx + 1);
    let cursor: number | undefined;
    const words: string[] = [];
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '--cursor' && i + 1 < rest.length) {
        cursor = parseInt(rest[i + 1], 10);
        i++;
      } else {
        words.push(rest[i]);
      }
    }
    if (cursor === undefined) cursor = words.length;
    const candidates = getCompletionsFromManifest(words, cursor, manifestPaths);
    process.stdout.write(candidates.join('\n') + '\n');
    process.exit(EXIT_CODES.SUCCESS);
  }
  // No manifest — fall through to full discovery path below
}

// ── Full startup path ───────────────────────────────────────────────────
// Dynamic imports: these are deferred so the fast path above never pays the cost.
const { discoverClis, discoverPlugins, ensureUserCliCompatShims, ensureUserAdapters, PLUGINS_DIR } = await import('./discovery.js');
const { getCompletions } = await import('./completion.js');
const { createProgram, isExternalRootCommand, runCli } = await import('./cli.js');
const { emitHook, shouldEmitStartupHook, shouldEnsureUserCliCompatShims, shouldRunStartupSideEffects } = await import('./hooks.js');
const { installNodeNetwork } = await import('./node-network.js');
const { registerUpdateNoticeOnExit, checkForUpdateBackground } = await import('./update-check.js');

installNodeNetwork();

// Parallelise independent startup I/O:
//  - ensureUserCliCompatShims and ensureUserAdapters operate on different paths
//    (~/.webcmd/node_modules/ vs ~/.webcmd/clis/).
//  - discoverClis(USER_CLIS) runs last: ~/.webcmd/clis holds user adapters and
//    overrides, and registerCommand is last-write-wins, so loading it after
//    plugins is what makes an override actually take effect.
const skipUserDiscovery = argv[0] === 'convention-audit';
const runStartupSideEffects = shouldRunStartupSideEffects(argv);
const ensureCompatShims = shouldEnsureUserCliCompatShims(argv);
if (skipUserDiscovery) {
  await discoverClis(BUILTIN_CLIS);
} else {
  const [, ,] = await Promise.all([
    ensureCompatShims ? ensureUserCliCompatShims() : Promise.resolve(),
    runStartupSideEffects ? ensureUserAdapters() : Promise.resolve(),
    discoverClis(BUILTIN_CLIS),
  ]);
  await discoverPlugins(PLUGINS_DIR);
  await discoverClis(USER_CLIS);
}

if (runStartupSideEffects) {
  // Register exit hook: notice appears after command output (same as npm/gh/yarn)
  registerUpdateNoticeOnExit();
  // Kick off background fetch for next run (non-blocking)
  checkForUpdateBackground();
}

// ── Fallback completion: manifest unavailable, use full registry ─────────
if (getCompIdx !== -1) {
  const rest = argv.slice(getCompIdx + 1);
  let cursor: number | undefined;
  const words: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--cursor' && i + 1 < rest.length) {
      cursor = parseInt(rest[i + 1], 10);
      i++;
    } else {
      words.push(rest[i]);
    }
  }
  if (cursor === undefined) cursor = words.length;
  const candidates = getCompletions(words, cursor);
  process.stdout.write(candidates.join('\n') + '\n');
  process.exit(EXIT_CODES.SUCCESS);
}

const { rejectMisplacedSessionSelectorArgv, rejectPositionalBrowserSessionArgv, BrowserSessionArgvError, escapeLeadingDashPositional } = await import('./cli-argv-preprocess.js');
const program = createProgram(BUILTIN_CLIS, USER_CLIS);
try {
  let rewritten = rejectPositionalBrowserSessionArgv(process.argv.slice(2));
  const rootSurface = parseRootSurface(rewritten);
  if (!(rootSurface?.kind === 'dispatch' && isExternalRootCommand(program, rootSurface.argv[0]))) {
    rewritten = rejectMisplacedSessionSelectorArgv(rewritten);
  }
  // Use the metadata that discovery actually registered. The core manifest is
  // intentionally empty, while installed plugins and legacy user CLIs are not.
  const { getRegistry } = await import('./registry.js');
  rewritten = escapeLeadingDashPositional(rewritten, [...new Set(getRegistry().values())]);
  process.argv.splice(2, process.argv.length - 2, ...rewritten);
} catch (err) {
  if (err instanceof BrowserSessionArgvError) {
    process.stderr.write(`error: ${err.message}\n`);
    process.exit(EXIT_CODES.USAGE_ERROR);
  }
  throw err;
}

if (shouldEmitStartupHook(argv)) {
  await emitHook('onStartup', { command: '__startup__', args: {} });
}
await runCli(BUILTIN_CLIS, USER_CLIS, program);
}
