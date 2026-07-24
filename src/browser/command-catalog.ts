import { InvalidArgumentError } from 'commander';
import type {
  HostedArgumentContract,
  HostedBrowserCommandContract,
  HostedSessionPolicy,
} from '../hosted/contract.js';

type ArgumentMetadata = {
  required?: boolean;
  variadic?: boolean;
  default?: unknown;
  choices?: string[];
};

function argument(
  name: string,
  type: HostedArgumentContract['type'],
  description: string,
  positional: boolean,
  metadata: ArgumentMetadata = {},
): HostedArgumentContract {
  return {
    name,
    type,
    description,
    positional,
    required: metadata.required === true,
    variadic: metadata.variadic === true,
    ...(metadata.default !== undefined ? { default: metadata.default } : {}),
    ...(metadata.choices?.length ? { choices: [...metadata.choices] } : {}),
  };
}

function positional(
  name: string,
  description = '',
  metadata: ArgumentMetadata = {},
): HostedArgumentContract {
  return argument(name, 'string', description, true, metadata);
}

function option(
  name: string,
  description: string,
  metadata: ArgumentMetadata = {},
): HostedArgumentContract {
  return argument(name, 'string', description, false, metadata);
}

function flag(
  name: string,
  description: string,
  defaultValue?: boolean,
): HostedArgumentContract {
  return argument(name, 'boolean', description, false, {
    ...(defaultValue !== undefined ? { default: defaultValue } : {}),
  });
}

const BROWSER_OPTION_VALUE_NAMES: Readonly<Record<string, string>> = {
  amount: 'pixels',
  as: 'format',
  childrenMax: 'n',
  chunkSize: 'chars',
  css: 'selector',
  depth: 'n',
  detail: 'key',
  filter: 'fields',
  format: 'fmt',
  frame: 'index',
  fromLabel: 'text',
  fromName: 'text',
  fromNth: 'n',
  fromRole: 'role',
  fromTestid: 'id',
  fromText: 'text',
  height: 'n',
  index: 'n',
  label: 'text',
  level: 'level',
  limit: 'n',
  max: 'n',
  maxBody: 'chars',
  name: 'text',
  nth: 'n',
  page: 'id',
  role: 'role',
  seedArgs: 'value',
  selector: 'css',
  since: 'duration',
  source: 'source',
  start: 'char',
  tab: 'targetId',
  testid: 'id',
  text: 'text',
  textMax: 'n',
  timeout: 'ms',
  toLabel: 'text',
  toName: 'text',
  toNth: 'n',
  toRole: 'role',
  toTestid: 'id',
  toText: 'text',
  trace: 'mode',
  ttl: 'ms',
  until: 'duration',
  width: 'n',
};

/** Exact local Commander flags for every catalogued browser option. */
export function browserOptionFlags(option: HostedArgumentContract): string {
  const longName = option.name.replace(/[A-Z]/g, character => `-${character.toLowerCase()}`);
  if (option.type === 'boolean') return option.name === 'fixture' ? '--no-fixture' : `--${longName}`;
  const valueName = BROWSER_OPTION_VALUE_NAMES[option.name];
  if (!valueName) throw new Error(`Browser option --${longName} is missing its Commander value name`);
  if (option.name === 'format') return `-f, --${longName} <${valueName}>`;
  return `--${longName} <${valueName}>`;
}

/** Shared Commander value parser for browser options with structural coercion. */
export function browserOptionValueParser(
  commandPath: string,
  optionName: string,
): ((value: string) => unknown) | undefined {
  if (commandPath !== 'screenshot' || (optionName !== 'width' && optionName !== 'height')) return undefined;
  return (value: string): number => {
    if (!/^\d+$/.test(value) || Number.parseInt(value, 10) <= 0) {
      throw new InvalidArgumentError(`--${optionName} must be a positive integer (got "${value}")`);
    }
    return Number.parseInt(value, 10);
  };
}

function command(
  commandPath: string,
  description: string,
  action: string | undefined,
  positionals: HostedArgumentContract[] = [],
  options: HostedArgumentContract[] = [],
  sessionPolicy: HostedSessionPolicy = 'require-existing',
): HostedBrowserCommandContract {
  return {
    command: commandPath,
    aliases: [],
    description,
    positionals,
    options,
    sessionPolicy,
    ...(action !== undefined ? { action } : {}),
  };
}

const TAB_TARGET_HELP = 'Target tab/page identity returned by "browser open", "browser tab new", or "browser tab list"';
const TARGET_HELP = 'Numeric ref (from browser state / find), CSS selector, or omit when using --role/--name/etc.';
const WRITE_NTH_HELP = 'When <target> is a multi-match CSS selector, pick the nth match (0-based)';
const READ_NTH_HELP = 'Pick the nth match (0-based) when <target> is a multi-match CSS selector';

const tabOption = option('tab', TAB_TARGET_HELP);
const semanticLocatorOptions = [
  option('role', 'Semantic role (button, link, textbox, option, etc.)'),
  option('name', 'Accessible name contains text (aria-label, label, title, placeholder, or visible text)'),
  option('label', 'Associated label contains text'),
  option('text', 'Visible text contains text'),
  option('testid', 'data-testid / data-test / test-id contains id'),
];
const semanticWriteOptions = [
  ...semanticLocatorOptions,
  option('nth', WRITE_NTH_HELP),
  tabOption,
];
const semanticReadOptions = [
  ...semanticLocatorOptions,
  option('nth', READ_NTH_HELP),
  tabOption,
];

export const browserCommandCatalog: readonly HostedBrowserCommandContract[] = [
  command(
    'analyze',
    'Classify site: anti-bot vendor, real-data API candidates, pattern (A/B/C/D), nearest adapter, next step',
    'analyze',
    [positional('url', '', { required: true })],
    [tabOption],
    'create-or-reuse',
  ),
  command('back', 'Go back in browser history', 'back', [], [tabOption]),
  command(
    'bind',
    'Bind an existing Cloak runtime tab to the browser session named by <session>',
    undefined,
    [],
    [
      option('page', 'Cloak tab page id from `webcmd browser <session> tab list`'),
      option('index', 'Cloak tab index from `webcmd browser <session> tab list`'),
    ],
    'local-only',
  ),
  command(
    'check',
    'Ensure a checkbox/radio/aria-checked control is checked — JSON envelope {checked, changed, target, matches_n}',
    'check',
    [positional('target', TARGET_HELP)],
    semanticWriteOptions,
  ),
  command(
    'click',
    'Click element — JSON envelope {clicked, target, matches_n}',
    'click',
    [positional('target', TARGET_HELP)],
    semanticWriteOptions,
  ),
  command('close', 'Release the current browser session tab lease', 'close-window', [], [], 'close-existing'),
  command(
    'console',
    'Read recent browser console messages',
    'console',
    [],
    [
      tabOption,
      option('level', 'Console level: all, error, warning, log, info, debug', { default: 'all' }),
      option('since', 'Only include messages from the last duration (for example: 30s, 2m)'),
      option('until', 'Only include messages older than the duration from now'),
      flag('follow', 'Continuously print new console messages as JSON lines', false),
    ],
  ),
  command(
    'dblclick',
    'Double-click element — JSON envelope {dblclicked, target, matches_n}',
    'dblclick',
    [positional('target', TARGET_HELP)],
    semanticWriteOptions,
  ),
  command(
    'dialog/accept',
    'Accept the currently open JavaScript dialog',
    'dialog-accept',
    [],
    [option('text', 'Prompt text to submit for prompt() dialogs'), tabOption],
  ),
  command(
    'dialog/dismiss',
    'Dismiss the currently open JavaScript dialog',
    'dialog-dismiss',
    [],
    [tabOption],
  ),
  command(
    'drag',
    'Drag one element to another — JSON envelope {dragged, source, target, source_matches_n, target_matches_n}',
    'drag',
    [
      positional('source', 'Numeric ref/CSS selector to drag from, or omit with --from-role/--from-name/etc.'),
      positional('target', 'Numeric ref/CSS selector to drop onto, or omit with --to-role/--to-name/etc.'),
    ],
    [
      option('fromRole', 'from semantic role'),
      option('fromName', 'from accessible name contains text'),
      option('fromLabel', 'from associated label contains text'),
      option('fromText', 'from visible text contains text'),
      option('fromTestid', 'from data-testid / data-test / test-id contains id'),
      option('toRole', 'to semantic role'),
      option('toName', 'to accessible name contains text'),
      option('toLabel', 'to associated label contains text'),
      option('toText', 'to visible text contains text'),
      option('toTestid', 'to data-testid / data-test / test-id contains id'),
      option('fromNth', 'When <source> is a multi-match CSS selector, pick the nth match (0-based)'),
      option('toNth', 'When <target> is a multi-match CSS selector, pick the nth match (0-based)'),
      tabOption,
    ],
  ),
  command(
    'eval',
    'Execute JS in page context, return result',
    'exec',
    [positional('js', 'JavaScript code', { required: true })],
    [option('frame', 'Cross-origin iframe index from "browser frames"'), tabOption],
  ),
  command(
    'extract',
    'Extract page content as markdown, paragraph-aware chunks for long pages',
    'extract',
    [],
    [
      option('format', 'Output format: json', { choices: ['json'] }),
      option('selector', 'CSS selector scope; defaults to <main>/<article>/<body>'),
      option('chunkSize', 'Target chunk size in chars', { default: '20000' }),
      option('start', 'Start offset (use next_start_char from a previous extract)', { default: '0' }),
      tabOption,
    ],
  ),
  command(
    'fill',
    'Set input/textarea/contenteditable text exactly and verify the value — JSON envelope {filled, verified, text, actual}',
    'fill',
    [
      positional('targetOrText', 'Numeric ref/CSS target, or text when using --role/--name/etc.'),
      positional('text', 'Text to set exactly'),
    ],
    semanticWriteOptions,
  ),
  command(
    'find',
    'Find DOM elements by CSS or semantic locator — returns JSON {matches_n, entries[]}',
    'find',
    [],
    [
      ...semanticLocatorOptions,
      option('css', 'CSS selector (required)'),
      option('limit', 'Max entries returned', { default: '50' }),
      option('textMax', 'Max chars of trimmed text per entry', { default: '120' }),
      tabOption,
    ],
  ),
  command(
    'focus',
    'Focus an element — JSON envelope {focused, target, matches_n}',
    'focus',
    [positional('target', TARGET_HELP)],
    semanticWriteOptions,
  ),
  command('frames', 'List cross-origin iframe targets in snapshot order', 'frames', [], [tabOption]),
  command(
    'get/attributes',
    'Element attributes — JSON envelope {value, matches_n}',
    'get-attributes',
    [positional('target', TARGET_HELP)],
    semanticReadOptions,
  ),
  command(
    'get/html',
    'Page HTML (or scoped); use --as json for a {tag, attrs, text, children} tree',
    'get-html',
    [],
    [
      option('selector', 'CSS selector scope (first match)'),
      option('as', 'Output format: "html" (default) or "json" for structured tree', { default: 'html' }),
      option('max', 'Max characters of raw HTML to return (0 = unlimited)', { default: '0' }),
      option('depth', '(--as json) Max tree depth below root (0 = root only, 0 disables = unlimited via empty)', { default: '' }),
      option('childrenMax', '(--as json) Max element children kept per node (empty = unlimited)', { default: '' }),
      option('textMax', '(--as json) Max chars of direct text kept per node (empty = unlimited)', { default: '' }),
      tabOption,
    ],
  ),
  command(
    'get/text',
    'Element text content — JSON envelope {value, matches_n}',
    'get-text',
    [positional('target', TARGET_HELP)],
    semanticReadOptions,
  ),
  command('get/title', 'Page title', 'get-title', [], [tabOption]),
  command('get/url', 'Current page URL', 'get-url', [], [tabOption]),
  command(
    'get/value',
    'Input/textarea value — JSON envelope {value, matches_n}',
    'get-value',
    [positional('target', TARGET_HELP)],
    semanticReadOptions,
  ),
  command(
    'hover',
    'Move the mouse over an element — JSON envelope {hovered, target, matches_n}',
    'hover',
    [positional('target', TARGET_HELP)],
    semanticWriteOptions,
  ),
  command(
    'init',
    'Generate adapter scaffold in ~/.webcmd/clis/',
    'init',
    [positional('name', 'Adapter name in site/command format (e.g. hn/top)', { required: true })],
  ),
  command(
    'keys',
    'Press keyboard key',
    'press-key',
    [positional('key', 'Key to press (Enter, Escape, Tab, Control+a)', { required: true })],
    [tabOption],
  ),
  command(
    'network',
    'Capture network requests as shape previews; retrieve full bodies by key',
    'network',
    [],
    [
      tabOption,
      option('detail', 'Emit full body for the entry with this key'),
      flag('all', 'Include static resources (js/css/images/telemetry)'),
      flag('raw', 'Emit full bodies for every entry (skip shape preview)'),
      option('filter', 'Comma-separated field names; keep only entries whose body shape has ALL names as path segments'),
      option('since', 'Only include entries from the last duration (for example: 30s, 2m)'),
      option('until', 'Only include entries older than the duration from now'),
      flag('follow', 'Continuously print new matching entries as JSON lines', false),
      flag('failed', 'Only include failed HTTP requests (status 0 or >= 400)', false),
      option('maxBody', 'With --detail: cap the emitted body at N chars (0 = unlimited, default)', { default: '0' }),
      option('ttl', 'Cache TTL in ms for --detail lookups', { default: '86400000' }),
    ],
  ),
  command(
    'open',
    'Open URL in the browser session',
    'navigate',
    [positional('url', '', { required: true })],
    [tabOption],
    'create-or-reuse',
  ),
  command(
    'screenshot',
    'Take screenshot',
    'screenshot',
    [positional('path', 'Save to file (base64 if omitted)')],
    [
      tabOption,
      flag('fullPage', 'Capture the full scrollable page, not just the viewport', false),
      flag('annotate', 'Overlay visible browser state ref labels on the screenshot', false),
      option('width', 'Override viewport width in CSS pixels for this screenshot only'),
      option('height', 'Override viewport height in CSS pixels for this screenshot only (ignored with --full-page)'),
    ],
  ),
  command(
    'scroll',
    'Scroll page',
    'scroll',
    [positional('direction', 'up or down', { required: true })],
    [option('amount', 'Pixels to scroll', { default: '500' }), tabOption],
  ),
  command(
    'select',
    'Select dropdown option — JSON envelope {selected, target, matches_n}',
    'select',
    [
      positional('targetOrOption', 'Numeric ref/CSS target, or option text when using --role/--name/etc.'),
      positional('option', 'Option text (or value) to select'),
    ],
    semanticWriteOptions,
  ),
  command(
    'state',
    'Page state: URL, title, interactive elements with [N] indices',
    'snapshot',
    [],
    [
      option('format', 'Output format: json', { choices: ['json'] }),
      option('source', 'Snapshot backend: dom (default) or ax prototype', { default: 'dom' }),
      flag('compareSources', 'Print DOM vs AX snapshot metrics for observation promotion decisions', false),
      tabOption,
    ],
  ),
  command(
    'tab/close',
    'Close a tab by target ID',
    'tabs',
    [positional('targetId', TAB_TARGET_HELP)],
    [tabOption],
  ),
  command('tab/list', 'List tabs in the browser session with target IDs', 'tabs'),
  command(
    'tab/new',
    'Create a new tab and print its target ID',
    'tabs',
    [positional('url', 'Optional URL to open in the new tab')],
  ),
  command(
    'tab/select',
    'Select a tab by target ID and make it the default browser tab',
    'tabs',
    [positional('targetId', TAB_TARGET_HELP)],
    [tabOption],
  ),
  command(
    'type',
    'Click element, then type text — JSON envelope {typed, text, target, matches_n, autocomplete}',
    'type',
    [
      positional('targetOrText', 'Numeric ref/CSS target, or text when using --role/--name/etc.'),
      positional('text', 'Text to type'),
    ],
    semanticWriteOptions,
  ),
  command(
    'unbind',
    'Compatibility command; release the Cloak browser session named by <session>',
    'close-window',
    [],
    [],
    'close-existing',
  ),
  command(
    'uncheck',
    'Ensure a checkbox/aria-checked control is unchecked — JSON envelope {checked, changed, target, matches_n}',
    'uncheck',
    [positional('target', TARGET_HELP)],
    semanticWriteOptions,
  ),
  command(
    'upload',
    'Attach local files to a file input — JSON envelope {uploaded, files, file_names, target, matches_n}',
    'set-file-input',
    [
      positional('targetOrFile', 'Numeric ref/CSS target, or first file when using --role/--name/etc.'),
      positional('files', 'Local file path(s) to attach', { variadic: true }),
    ],
    semanticWriteOptions,
  ),
  command(
    'verify',
    'Execute an adapter and validate output; uses fixture at ~/.webcmd/sites/<site>/verify/<cmd>.json when present',
    'verify',
    [positional('name', 'Adapter name in site/command format (e.g. hn/top)', { required: true })],
    [
      flag('writeFixture', 'Write a starter fixture to ~/.webcmd/sites/<site>/verify/<command>.json if none exists'),
      flag('updateFixture', 'Overwrite an existing fixture with one derived from current output'),
      flag('fixture', 'Ignore any fixture file for this run (no value-level validation)'),
      flag('strictMemory', 'Fail (not just warn) when ~/.webcmd/sites/<site>/endpoints.json or notes.md is missing'),
      option('seedArgs', 'Seed args when no fixture exists; use JSON array/object for multiple args or flags'),
      option('trace', 'Trace capture for the adapter subprocess: off, on, retain-on-failure', { default: 'off' }),
    ],
  ),
  command(
    'wait',
    'Wait for selector, text, time, matching XHR, or browser download (e.g. wait selector ".loaded", wait text "Success", wait time 3, wait xhr "/api/search", wait download receipt.pdf)',
    'wait',
    [
      positional('type', 'selector, text, time, xhr, or download', { required: true }),
      positional('value', 'CSS selector, text string, seconds, XHR URL regex, or download filename/URL pattern'),
    ],
    [tabOption, option('timeout', 'Timeout in milliseconds', { default: '10000' })],
  ),
];
