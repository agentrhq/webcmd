/**
 * Reject the retired positional browser-session grammar before Commander parses
 * the canonical root `--session` selector.
 */

/**
 * Browser subcommand names. If `<session>` would collide with one of these,
 * we treat it as a missing-positional error and leave argv alone so commander
 * reports a usable diagnostic.
 *
 * Keep in sync with the subcommands declared on the `browser` command in cli.ts.
 */
const BROWSER_SUBCOMMAND_NAMES: ReadonlySet<string> = new Set([
  'analyze',
  'back',
  'bind',
  'check',
  'click',
  'close',
  'console',
  'dblclick',
  'dialog',
  'drag',
  'eval',
  'extract',
  'fill',
  'find',
  'focus',
  'fork',
  'frames',
  'get',
  'help',
  'hover',
  'init',
  'keys',
  'network',
  'open',
  'run',
  'screenshot',
  'scroll',
  'select',
  'snapshot',
  'state',
  'tab',
  'tabs',
  'type',
  'unbind',
  'uncheck',
  'upload',
  'verify',
  'wait',
]);

/**
 * Root program options that consume the following token as their value. Used by
 * the preprocessor to identify which token is the root command name (so e.g.
 * `webcmd --profile work browser foo state` is recognised as the `browser`
 * command with `<session>=foo`, not the value of --profile).
 *
 * Keep in sync with `program.option(...)` calls in cli.ts.
 */
const ROOT_VALUE_FLAGS: ReadonlySet<string> = new Set(['--profile', '--session', '--workspace']);

/**
 * Returns the set of reserved subcommand names (exposed for tests so they stay
 * synced with the actual registrations in cli.ts).
 */
export function getBrowserSubcommandNames(): ReadonlySet<string> {
  return BROWSER_SUBCOMMAND_NAMES;
}

/** Rejects retired `browser <session> ...` while preserving canonical argv. */
export function rejectPositionalBrowserSessionArgv(argv: readonly string[]): string[] {
  const result = [...argv];
  const commandIndex = findRootCommandIndex(result);
  if (result[commandIndex] !== 'browser') return result;
  const candidate = result[commandIndex + 1];
  if (!candidate || candidate.startsWith('-') || BROWSER_SUBCOMMAND_NAMES.has(candidate)) {
    hoistBrowserWindowOption(result, commandIndex + 1);
    return result;
  }
  const replacement = [
    ...result.slice(0, commandIndex),
    '--session', candidate,
    'browser',
    ...result.slice(commandIndex + 2),
  ];
  throw new BrowserSessionArgvError(
    `Browser sessions are root selectors. Use: webcmd ${replacement.join(' ')}`,
  );
}

function findRootCommandIndex(argv: readonly string[]): number {
  let index = 0;
  while (index < argv.length) {
    const token = argv[index]!;
    if (!token.startsWith('-')) return index;
    index += token.includes('=') || !ROOT_VALUE_FLAGS.has(token) ? 1 : 2;
  }
  return index;
}

/**
 * Move one trailing `--window <mode>` / `--window=<mode>` from after the browser
 * subcommand to just before it. Stops at `--` so literal browser arguments are
 * untouched. Mutates `argv` in place.
 */
function hoistBrowserWindowOption(argv: string[], fromIndex: number): void {
  const subcommandIdx = argv.findIndex((tok, idx) => idx >= fromIndex && BROWSER_SUBCOMMAND_NAMES.has(tok));
  if (subcommandIdx === -1) return;

  for (let i = subcommandIdx + 1; i < argv.length; i += 1) {
    const tok = argv[i];
    if (tok === '--') return;
    if (tok.startsWith('--window=')) {
      const removed = argv.splice(i, 1);
      argv.splice(subcommandIdx, 0, ...removed);
      return;
    }
    if (tok === '--window') {
      const value = argv[i + 1];
      if (value === undefined || value === '--') return;
      const removed = argv.splice(i, 2);
      argv.splice(subcommandIdx, 0, ...removed);
      return;
    }
  }
}

/**
 * Thrown by the preprocessor when user argv uses a retired/old form that we
 * intentionally refuse to accept. main.ts catches this and exits with a
 * usage error so it does not bubble up as an internal stacktrace.
 */
export class BrowserSessionArgvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrowserSessionArgvError';
  }
}

/**
 * Minimal manifest shape consumed by escapeLeadingDashPositional. Imported
 * lazily by main.ts so this module stays dependency-free.
 */
export interface DashPositionalManifestEntry {
  site: string;
  name: string;
  args?: Array<{ name: string; positional?: boolean; required?: boolean; valueRequired?: boolean; default?: unknown }>;
  browser?: boolean;
}

type OptionValueMode = 'none' | 'required' | 'optional';
type OptionParse = { values: string[]; nextIndex: number };

function knownCommandOptions(cmd: DashPositionalManifestEntry): Map<string, OptionValueMode> {
  const options = new Map<string, OptionValueMode>([
    ['-h', 'none'],
    ['--help', 'none'],
    ['-v', 'none'],
    ['--verbose', 'none'],
    ['-f', 'required'],
    ['--format', 'required'],
    ['--trace', 'required'],
  ]);
  if (cmd.browser) {
    options.set('--window', 'required');
    options.set('--site-session', 'required');
    options.set('--keep-tab', 'required');
  }
  for (const arg of cmd.args ?? []) {
    if (arg.positional) continue;
    // Keep in sync with commanderAdapter.ts:
    // required/valueRequired -> `<value>`; otherwise -> `[value]`.
    options.set(`--${arg.name}`, arg.required || arg.valueRequired ? 'required' : 'optional');
  }
  return options;
}

function consumeKnownOption(argv: readonly string[], index: number, options: ReadonlyMap<string, OptionValueMode>): OptionParse | null {
  const token = argv[index];
  if (!token || token === '--') return null;
  const eq = token.indexOf('=');
  const key = eq === -1 ? token : token.slice(0, eq);
  const mode = options.get(key);
  if (!mode && eq === -1 && token.startsWith('-') && !token.startsWith('--') && token.length > 2) {
    const shortKey = token.slice(0, 2);
    const shortMode = options.get(shortKey);
    if (shortMode === 'required') {
      return { values: [token], nextIndex: index + 1 };
    }
  }
  if (!mode) return null;
  if (eq !== -1 || mode === 'none') return { values: [token], nextIndex: index + 1 };
  const next = argv[index + 1];
  if (mode === 'required') {
    return next === undefined
      ? { values: [token], nextIndex: index + 1 }
      : { values: [token, next], nextIndex: index + 2 };
  }
  if (next !== undefined && !next.startsWith('-')) {
    return { values: [token, next], nextIndex: index + 2 };
  }
  return { values: [token], nextIndex: index + 1 };
}

/**
 * `webcmd openreview paper -abc123def` fails because commander parses
 * `-abc123def` as an unknown option rather than the required
 * `<id>` positional. Some adapter identifiers are opaque
 * strings that can legitimately start with `-` (issue #1160), and the
 * same shape can show up in any adapter that takes an opaque-id
 * positional. Insert a `--` separator so commander treats the next
 * token as the positional value.
 */
export function escapeLeadingDashPositional(
  argv: readonly string[],
  manifest: readonly DashPositionalManifestEntry[],
): string[] {
  const result = [...argv];
  const requiredFirstPositional = new Map<string, DashPositionalManifestEntry>();
  for (const cmd of manifest) {
    const first = cmd.args?.find((a) => a.positional);
    if (first?.required) requiredFirstPositional.set(cmd.site + '/' + cmd.name, cmd);
  }
  let i = 0;
  while (i < result.length) {
    const tok = result[i];
    if (!tok.startsWith('-')) break;
    if (tok.includes('=')) { i += 1; continue; }
    if (ROOT_VALUE_FLAGS.has(tok) && i + 1 < result.length) { i += 2; }
    else { i += 1; }
  }
  const site = result[i];
  const cmd = result[i + 1];
  const positionalIdx = i + 2;
  if (!site || !cmd || positionalIdx >= result.length) return result;
  const entry = requiredFirstPositional.get(site + '/' + cmd);
  if (!entry) return result;
  const options = knownCommandOptions(entry);

  const beforePositional: string[] = [];
  let j = positionalIdx;
  while (j < result.length) {
    const token = result[j];
    if (token === '--') return result;
    const consumed = consumeKnownOption(result, j, options);
    if (consumed) {
      beforePositional.push(...consumed.values);
      j = consumed.nextIndex;
      continue;
    }
    if (!token.startsWith('-')) return result;
    if (token.startsWith('--')) return result;
    break;
  }
  if (j >= result.length) return result;

  const positional = result[j];
  const trailingOptions: string[] = [];
  const trailingRest: string[] = [];
  j += 1;
  while (j < result.length) {
    const consumed = consumeKnownOption(result, j, options);
    if (consumed) {
      trailingOptions.push(...consumed.values);
      j = consumed.nextIndex;
      continue;
    }
    trailingRest.push(result[j]);
    j += 1;
  }
  return [
    ...result.slice(0, positionalIdx),
    ...beforePositional,
    ...trailingOptions,
    '--',
    positional,
    ...trailingRest,
  ];
}
