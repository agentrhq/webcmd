import { InvalidArgumentError } from 'commander';
import { TRACE_MODES } from '../command-surface.js';
import type {
  HostedArgumentContract,
  HostedBrowserCommandContract,
  HostedSessionPolicy,
} from '../hosted/contract.js';

export const BROWSER_RUN_HELP_TEXT = `
Examples:
  Navigate and extract:
    await page.goto('https://example.com');
    return await page.title();

  Use a data URL for tiny fixtures:
    await page.goto('data:text/html,<button>Save</button>');

  Capture a download:
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Download' }).click();
    const download = await downloadPromise;
    await download.saveAs(download.suggestedFilename());

  Upload a file:
    await page.locator('input[type=file]').setInputFiles('/tmp/upload.pdf');

  Track popups and new pages:
    const popupPromise = context.waitForEvent('page', { timeout: 5000 });
    await page.getByRole('link', { name: 'Open' }).click();
    const popup = await popupPromise;
    await popup.waitForLoadState();

  Chrome blocks top-level data: navigation, so window.open('data:...') creates no
  tab and no popup event ever fires. Open one yourself instead:
    const receipt = await context.newPage();
    await receipt.goto(receiptUrl);

Sandbox:
  Node require/fs are not available inside browser run. Return structured data,
  console.log concise evidence, or call writeArtifact(filename, bytes) to save files.
`;

type ArgumentMetadata = {
  required?: boolean;
  default?: unknown;
};

function option(
  name: string,
  description: string,
  metadata: ArgumentMetadata = {},
): HostedArgumentContract {
  return {
    name,
    type: 'string',
    description,
    positional: false,
    required: metadata.required === true,
    variadic: false,
    ...(metadata.default !== undefined ? { default: metadata.default } : {}),
  };
}

function flag(name: string, description: string): HostedArgumentContract {
  return { name, type: 'boolean', description, positional: false, required: false, variadic: false };
}

/**
 * `-v` for a browser leaf that performs bridge/CDP I/O, whose diagnostics are
 * already gated on `isVerbose()` (`src/browser/cdp.ts`).
 *
 * Declared here as well as in `cli.ts` because hosted help is rendered from this
 * catalog while local help comes from Commander, and the two are asserted to be
 * byte-identical. The explicit `false` default reproduces local's
 * "(default: false)" suffix.
 */
function verboseFlag(): HostedArgumentContract {
  return {
    name: 'verbose',
    type: 'boolean',
    description: 'Debug output',
    positional: false,
    required: false,
    variadic: false,
    default: false,
  };
}

function command(
  commandPath: string,
  description: string,
  action: NonNullable<HostedBrowserCommandContract['action']>,
  positionals: HostedArgumentContract[] = [],
  options: HostedArgumentContract[] = [],
  sessionPolicy: HostedSessionPolicy,
): HostedBrowserCommandContract {
  return { command: commandPath, aliases: [], description, action, positionals, options, sessionPolicy };
}

function runSnapshotModeParser(value: string): 'act' | 'tree' {
  if (value === 'act' || value === 'tree') return value;
  throw new InvalidArgumentError(`--snapshot-mode for run must be act or tree (got "${value}")`);
}

function snapshotModeParser(value: string): 'act' | 'tree' | 'read' {
  if (value === 'act' || value === 'tree' || value === 'read') return value;
  throw new InvalidArgumentError(`--snapshot-mode for snapshot must be act, tree, or read (got "${value}")`);
}

function positiveIntegerParser(optionName: string): (value: string) => number {
  return (value: string): number => {
    if (!/^\d+$/.test(value) || Number.parseInt(value, 10) <= 0) {
      throw new InvalidArgumentError(`--${optionName} must be a positive integer (got "${value}")`);
    }
    return Number.parseInt(value, 10);
  };
}

function traceModeParser(value: string): string {
  if (TRACE_MODES.includes(value as (typeof TRACE_MODES)[number])) return value;
  throw new InvalidArgumentError(`--trace must be one of: ${TRACE_MODES.join(', ')} (got "${value}")`);
}

const adapterNamePositional: HostedArgumentContract = {
  name: 'name',
  type: 'string',
  description: 'Adapter name in site/command format',
  positional: true,
  required: true,
  variadic: false,
};

/** Exact local Commander flags for every catalogued browser option. */
export function browserOptionFlags(option: HostedArgumentContract, commandPath?: string): string {
  const longName = option.name.replace(/[A-Z]/g, character => `-${character.toLowerCase()}`);
  if (option.name === 'verbose') return '-v, --verbose';
  if (option.type === 'boolean') return `--${longName}`;
  const valueName = option.name === 'page' ? 'id'
    : option.name === 'file' ? 'path'
      : option.name === 'timeout' && commandPath === 'run' ? 'seconds'
        : option.name === 'maxOutput' ? 'characters'
          : option.name === 'snapshotMode' ? 'mode'
          : option.name === 'seedArgs' ? 'value'
            : option.name === 'trace' ? 'mode'
              : option.name === 'maxTopLevelKeys' ? 'n'
                : option.name;
  return `--${longName} <${valueName}>`;
}

/** Shared positive-integer parser for browser-run limits. */
export function browserOptionValueParser(
  commandPath: string,
  optionName: string,
): ((value: string) => unknown) | undefined {
  if (commandPath === 'bind' && optionName === 'page') {
    return (value: string): string => {
      const page = value.trim();
      if (!page) throw new InvalidArgumentError('--page must be a non-empty stable page id');
      return page;
    };
  }
  if (optionName === 'snapshotMode' && commandPath === 'run') return runSnapshotModeParser;
  if (optionName === 'snapshotMode' && commandPath === 'snapshot') return snapshotModeParser;
  if (commandPath === 'verify' && optionName === 'trace') return traceModeParser;
  if ((commandPath === 'run' && ['timeout', 'maxOutput'].includes(optionName))
    || (commandPath === 'snapshot' && optionName === 'maxOutput')
    || (commandPath === 'verify' && optionName === 'maxTopLevelKeys')) {
    return positiveIntegerParser(optionName === 'maxOutput'
      ? 'max-output'
      : optionName === 'maxTopLevelKeys'
        ? 'max-top-level-keys'
        : optionName);
  }
  return undefined;
}

export const browserCommandCatalog: readonly HostedBrowserCommandContract[] = [
  command('tabs', 'List pages in the existing browser session', 'tabs', [], [
    verboseFlag(),
  ], 'require-existing'),
  command('init', 'Generate an adapter scaffold. Does not take --session.', 'init', [adapterNamePositional], [], 'sessionless'),
  command('bind', 'Bind this session to an existing page', 'bind', [], [
    option('page', 'Stable page id returned by tabs', { required: true }),
    verboseFlag(),
  ], 'require-existing'),
  command('verify', 'Verify an adapter against its fixture. Does not take --session.', 'verify', [adapterNamePositional], [
    flag('noFixture', 'Run without comparing a fixture'),
    flag('writeFixture', 'Write the observed result as the fixture'),
    flag('updateFixture', 'Replace an existing fixture with the observed result'),
    flag('strictMemory', 'Fail when notes or endpoint memory is absent'),
    option('seedArgs', 'Seed arguments used to invoke the command'),
    option('trace', 'Trace capture: off, on, or retain-on-failure', { default: 'off' }),
    option('maxTopLevelKeys', 'Maximum allowed top-level keys', { default: 12 }),
  ], 'sessionless'),
  command('run', 'Run JavaScript with Playwright. A second overlapping run returns SESSION_BUSY; wait and retry.', 'run', [], [
    flag('stdin', 'Read the program from stdin'),
    option('file', 'Read the program from a file'),
    option('timeout', 'Execution timeout in seconds'),
    option('maxOutput', 'Maximum returned characters'),
    option('snapshotMode', 'Snapshot mode for automatic diff: act or tree', { default: 'act' }),
    flag('noSnapshotDiff', 'Skip the automatic before/after snapshot diff'),
    verboseFlag(),
  ], 'create-or-reuse'),
  command('snapshot', 'Inspect the current page with a compact accessibility snapshot', 'snapshot', [], [
    option('snapshotMode', 'Snapshot mode: act, tree, or read', { default: 'act' }),
    option('ref', 'Render only the subtree rooted at this snapshot ref'),
    option('maxOutput', 'Maximum returned characters'),
    verboseFlag(),
  ], 'require-existing'),
  command('close', 'Close or detach this browser session', 'close-window', [], [
    verboseFlag(),
  ], 'close-existing'),
] as const;
