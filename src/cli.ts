/**
 * CLI entry point: registers built-in commands and wires up Commander.
 *
 * Built-in commands are registered inline here (list, validate, explore, etc.).
 * Dynamic adapter commands are registered via commanderAdapter.ts.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'node:readline/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Command, Option } from 'commander';
import { findPackageRoot, getBuiltEntryCandidates } from './package-paths.js';
import { type CliCommand, getRegistry } from './registry.js';
// Side-effect import: registers client-owned `web fetch` in the core registry
// so it reaches help, `list`, completions and manifests without a plugin.
import './fetch/command.js';
import { commandListPresentation, filterCommandsByTag, toPresentableCommand } from './command-presentation.js';
import { configureCompletionCommandSurface, configureListCommandSurface, configurePluginInstallSurface, configurePluginSearchSurface } from './builtin-command-surface.js';
import { render as renderOutput } from './output.js';
import { PKG_VERSION } from './version.js';
import { printCompletionScript } from './completion.js';
import { loadExternalClis, executeExternalCli, installExternalCli, registerExternalCli, isBinaryInstalled, formatExternalCliLabel } from './external.js';
import { addWebcmdSkills, listWebcmdSkills, removeWebcmdSkills, updateWebcmdSkill, type WebcmdSkillAddResult } from './skills.js';
import { registerAllCommands } from './commanderAdapter.js';
import { buildRootHelpPresentation, classifyAdapter, installCommanderNamespaceStructuredHelp, installRootPresentationHelp, leadingPositionalFromUsage, rootHelpData, type RootAdapterGroups } from './help.js';
import { EXIT_CODES, getErrorMessage, BrowserConnectError, CliError, ArgumentError } from './errors.js';
import { TargetError, type TargetErrorCode } from './browser/target-errors.js';
import { resolveTargetJs, getTextResolvedJs, getValueResolvedJs, getAttributesResolvedJs, selectResolvedJs, isAutocompleteResolvedJs, type ResolveOptions, type TargetMatchLevel } from './browser/target-resolver.js';
import { buildFindJs, buildSemanticFindJs, isFindError, type FindResult, type FindError, type SemanticFindOptions } from './browser/find.js';
import { inferShape } from './browser/shape.js';
import { assignKeys } from './browser/network-key.js';
import { DEFAULT_TTL_MS, findEntry, loadNetworkCache, saveNetworkCache, type CachedNetworkEntry } from './browser/network-cache.js';
import { NETWORK_INTERCEPTOR_JS } from './browser/network-interceptor.js';
import { parseFilter, shapeMatchesFilter } from './browser/shape-filter.js';
import { buildHtmlTreeJs, type HtmlTreeResult } from './browser/html-tree.js';
import { buildExtractHtmlJs, runExtractFromHtml } from './browser/extract.js';
import { analyzeSite, type PageSignals } from './browser/analyze.js';
import { browserOptionValueParser } from './browser/command-catalog.js';
import { registerAuthCommands } from './commands/auth.js';
import { daemonRestart, daemonStatus, daemonStop } from './commands/daemon.js';
import { isVerbose, log } from './logger.js';
import { BrowserCommandError, listExistingBrowserTabs, releaseSiteSessionLease, sendCommand } from './browser/daemon-client.js';
import { fetchDaemonStatus } from './browser/daemon-transport.js';
import { aliasForContextId, loadProfileConfig, profileRouteParams, renameProfile, resolveProfileSelection, setDefaultProfile, type ProfileSelection } from './browser/profile.js';
import { formatDaemonVersion, isDaemonStale } from './browser/daemon-version.js';
import { DEFAULT_BROWSER_CONNECT_TIMEOUT } from './browser/config.js';
import { CLI_COMMAND, PACKAGE_NAME } from './brand.js';
import type { BrowserDownloadWaitResult, IPage, ScreenshotOptions } from './types.js';
import type { BrowserWindowMode } from './runtime.js';
import { configureRootCommandSurface } from './root-command-surface.js';
import { validateRawBrowserSession } from './hosted/browser-args.js';
import { LocalBrowserSessionStore, requireSessionIdShape, type BrowserSessionListRow } from './browser/sessions.js';
import { missingPluginGuidance, PLUGINS_DIR } from './discovery.js';
import { loadBrowserRunSource } from './browser/run/input.js';
import { BrowserRunError } from './browser/run/types.js';
import { classifyCommandOrigin, formatCommandOrigin } from './command-origin.js';
import { readOverrideRecords, removeOverrideRecords } from './override-provenance.js';
import { clearDaemonRunContext, generateRunId, isUnknownOutcomeError, runWithDaemonRunContext } from './session-lease.js';

const CLI_FILE = fileURLToPath(import.meta.url);
const FOLLOW_POLL_MS = 1_000;

function getBrowserCacheDir(): string {
  return process.env.WEBCMD_CACHE_DIR || path.join(os.homedir(), '.webcmd', 'cache');
}

function parsePositiveIntOption(value: string | undefined, _label: string, fallback: number): number {
  const parsed = value === undefined ? fallback : Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseSessionListLimit(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new ArgumentError('Session list limit must be an integer from 1 to 100.');
  }
  return parsed;
}

type BrowserNetworkItem = {
  url: string;
  method: string;
  status: number;
  size: number;
  ct: string;
  body: unknown;
  /** Full body size in chars before any capture-layer truncation. */
  bodyFullSize?: number;
  /** True when the capture layer had to cap the stored body to protect memory. */
  bodyTruncated?: boolean;
  /** Epoch milliseconds when the request was observed. */
  timestamp?: number;
};

function parseDurationMs(raw: unknown, flagName: string): number | null | { error: string } {
  if (raw === undefined || raw === null || raw === '') return null;
  const str = String(raw).trim();
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(str);
  if (!match) return { error: `--${flagName} must be a duration like 500ms, 30s, 2m, got "${str}"` };
  const value = Number.parseFloat(match[1]);
  const unit = match[2] ?? 'ms';
  const multiplier = unit === 'h' ? 3_600_000 : unit === 'm' ? 60_000 : unit === 's' ? 1_000 : 1;
  return Math.round(value * multiplier);
}

function timestampFromRaw(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : Date.now();
}

type SkillLinkCommandOptions = {
  provider?: string;
  scope?: string;
  path?: string;
  json?: boolean;
};

function isInteractiveSkillAdd(opts: SkillLinkCommandOptions): boolean {
  return !opts.json && process.stdin.isTTY === true && process.stdout.isTTY === true;
}

async function resolveSkillAddOptions(opts: SkillLinkCommandOptions): Promise<SkillLinkCommandOptions> {
  if (!isInteractiveSkillAdd(opts)) return opts;

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const scope = opts.scope ?? await choosePrompt(rl, 'Where should Webcmd add skills?', [
      { key: '1', label: 'Global', value: 'user', aliases: ['global', 'user', 'g'] },
      { key: '2', label: 'Local project', value: 'project', aliases: ['local', 'project', 'l'] },
    ], '1');
    const provider = opts.provider ?? (opts.path ? undefined : await choosePrompt(rl, 'Which coding agent should use them?', [
      { key: '1', label: 'Agents', value: 'agents', aliases: ['agents', 'agent', 'a'] },
      { key: '2', label: 'Codex', value: 'codex', aliases: ['codex', 'c'] },
      { key: '3', label: 'Claude', value: 'claude', aliases: ['claude', 'claude-code'] },
      { key: '4', label: 'Custom path', value: 'custom', aliases: ['custom', 'path'] },
    ], '1'));
    const customPath = opts.path ?? (provider === 'custom' ? await nonEmptyPrompt(rl, 'Skills directory path: ') : undefined);
    return { ...opts, scope, provider: provider === 'custom' ? undefined : provider, path: customPath };
  } finally {
    rl.close();
  }
}

async function choosePrompt<T extends string>(
  rl: readline.Interface,
  question: string,
  choices: Array<{ key: string; label: string; value: T; aliases: string[] }>,
  defaultKey: string,
): Promise<T> {
  console.log(question);
  for (const choice of choices) console.log(`  ${choice.key}) ${choice.label}`);
  while (true) {
    const answer = (await rl.question(`Choose [${defaultKey}]: `)).trim().toLowerCase() || defaultKey;
    const choice = choices.find((item) => item.key === answer || item.aliases.includes(answer));
    if (choice) return choice.value;
    console.log(`Choose one of: ${choices.map((item) => item.key).join(', ')}`);
  }
}

async function nonEmptyPrompt(rl: readline.Interface, question: string): Promise<string> {
  while (true) {
    const answer = (await rl.question(question)).trim();
    if (answer) return answer;
    console.log('Path is required.');
  }
}

async function handleSkillLinkCommand(action: () => WebcmdSkillAddResult | Promise<WebcmdSkillAddResult>, json: boolean, verb: string): Promise<void> {
  try {
    const result = await action();
    if (json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(`Webcmd skills ${verb}: ${result.skills.length}`);
    for (const skill of result.skills) {
      console.log(`${skill.name}: ${skill.destination ? `${skill.destination} -> ` : ''}${skill.stableLink}`);
    }
  } catch (err) {
    console.error(`Error: ${getErrorMessage(err)}`);
    if (err instanceof CliError && err.hint) console.error(`Hint: ${err.hint}`);
    process.exitCode = err instanceof CliError ? err.exitCode : EXIT_CODES.GENERIC_ERROR;
  }
}

function handleSkillRemoveCommand(customPath: string | undefined, json: boolean): void {
  try {
    const result = removeWebcmdSkills({ customPath });
    if (json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(`Webcmd skill links removed: ${result.removed.length}`);
    for (const linkPath of result.removed) console.log(linkPath);
  } catch (err) {
    console.error(`Error: ${getErrorMessage(err)}`);
    if (err instanceof CliError && err.hint) console.error(`Hint: ${err.hint}`);
    process.exitCode = err instanceof CliError ? err.exitCode : EXIT_CODES.GENERIC_ERROR;
  }
}

function toIsoTimestamp(timestamp: unknown): string | undefined {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp <= 0) return undefined;
  return new Date(timestamp).toISOString();
}

function filterByTimeWindow<T extends { timestamp?: number }>(items: T[], opts: { sinceMs?: number | null; untilMs?: number | null }, now: number = Date.now()): T[] {
  const sinceTs = opts.sinceMs != null ? now - opts.sinceMs : undefined;
  const untilTs = opts.untilMs != null ? now - opts.untilMs : undefined;
  return items.filter((item) => {
    const ts = item.timestamp ?? now;
    if (sinceTs !== undefined && ts < sinceTs) return false;
    if (untilTs !== undefined && ts > untilTs) return false;
    return true;
  });
}

export function selectFreshByTimestamp<T extends { timestamp?: unknown }>(
  items: T[],
  lastSeenTs: number,
): { fresh: T[]; lastSeenTs: number } {
  const fresh = items.filter((item) => Number(item.timestamp ?? 0) > lastSeenTs);
  const nextSeenTs = fresh.length > 0
    ? Math.max(lastSeenTs, ...fresh.map((item) => Number(item.timestamp ?? 0)).filter(Number.isFinite))
    : lastSeenTs;
  return { fresh, lastSeenTs: nextSeenTs };
}

/**
 * Normalize raw capture entries (from daemon/CDP `readNetworkCapture` or
 * the JS interceptor's `window.__webcmd_net`) into a consistent shape.
 * Response preview is parsed as JSON when possible, otherwise kept as string.
 * `bodyFullSize` / `bodyTruncated` surface capture-layer truncation so the
 * agent-facing envelope can warn when the body isn't whole.
 */
async function captureNetworkItems(page: import('./types.js').IPage): Promise<BrowserNetworkItem[]> {
  if (page.readNetworkCapture) {
    const raw = await page.readNetworkCapture();
    if (Array.isArray(raw) && raw.length > 0) {
      return (raw as Array<Record<string, unknown>>).map((e) => {
        const preview = (e.responsePreview as string) ?? null;
        let body: unknown = null;
        if (preview) {
          try { body = JSON.parse(preview); } catch { body = preview; }
        }
        const fullSize = typeof e.responseBodyFullSize === 'number'
          ? (e.responseBodyFullSize as number)
          : (preview ? preview.length : 0);
        const truncated = e.responseBodyTruncated === true;
        return {
          url: (e.url as string) || '',
          method: (e.method as string) || 'GET',
          status: (e.responseStatus as number) || 0,
          size: fullSize,
          ct: (e.responseContentType as string) || '',
          body,
          bodyFullSize: fullSize,
          bodyTruncated: truncated,
          timestamp: timestampFromRaw(e.timestamp),
        };
      });
    }
  }
  const raw = await page.evaluate(`(function(){ var out = window.__webcmd_net || []; window.__webcmd_net = []; return JSON.stringify(out); })()`) as string;
  try {
    const parsed = JSON.parse(raw) as BrowserNetworkItem[];
    return parsed.map((item) => ({ ...item, timestamp: timestampFromRaw(item.timestamp) }));
  } catch {
    if (isVerbose()) log.warn(`[network] Failed to parse interceptor buffer: ${typeof raw === 'string' ? raw.slice(0, 200) : String(raw)}`);
    return [];
  }
}

/** Drop static-resource / telemetry noise so agents see only API-shaped traffic. */
function filterNetworkItems(items: BrowserNetworkItem[]): BrowserNetworkItem[] {
  return items.filter((r) => {
    const ct = r.ct?.toLowerCase() ?? '';
    return (
      (ct.includes('json') || ct.includes('xml') || ct.includes('text/plain') || ct.includes('javascript')) &&
      !/\.(js|css|png|jpg|gif|svg|woff|ico|map)(\?|$)/i.test(r.url) &&
      !/analytics|tracking|telemetry|beacon|pixel|gtag|fbevents/i.test(r.url)
    );
  });
}

/** Exit codes by network error code — usage errors vs runtime failures. */
const NETWORK_ERROR_EXIT: Record<string, number> = {
  invalid_args: EXIT_CODES.USAGE_ERROR,
  invalid_filter: EXIT_CODES.USAGE_ERROR,
  invalid_max_body: EXIT_CODES.USAGE_ERROR,
};

/** Emit a structured error JSON so agents can branch on `error.code` without regex. */
function emitNetworkError(code: string, message: string, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ error: { code, message, ...extra } }, null, 2));
  process.exitCode = NETWORK_ERROR_EXIT[code] ?? EXIT_CODES.GENERIC_ERROR;
}

/**
 * Check whether the site-memory scaffolding exists under
 * ~/.webcmd/sites/<site>/. Agents have a strong tendency to forget to write
 * endpoints.json / notes.md after a successful verify, which dooms the next
 * agent to redo recon from scratch. Surfacing the current state as part of
 * verify's final report converts that "silent skip" into a visible nudge;
 * `--strict-memory` escalates it to a failure so agents driving a hardened
 * workflow can't forget.
 */
export type SiteMemoryReport = {
  ok: boolean;
  siteDir: string;
  endpoints: { present: boolean; count: number; path: string };
  notes: { present: boolean; path: string };
};

export type SitemapAvailability = {
  site: string;
  available: true;
  source: 'local' | 'global' | 'local+global';
  hint: string;
  paths: {
    local?: string;
    global?: string;
  };
};

type SitemapHintState = {
  seenSites: string[];
  updatedAt: string;
};

type SitemapAvailabilityOptions = {
  homeDir?: string;
  packageRoot?: string;
  registry?: Map<string, CliCommand>;
  fileExists?: (candidate: string) => boolean;
};

const SITEMAP_HINT =
  'Site sitemap available. For navigation context, use the webcmd-browser-sitemap skill; treat browser state as truth if it disagrees.';

function siteNameCandidatesFromUrl(url: string, registry: Map<string, CliCommand> = getRegistry()): string[] {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return [];
  }

  const scored = new Map<string, number>();
  for (const command of registry.values()) {
    if (!command.domain) continue;
    let domainHost = command.domain.toLowerCase().trim();
    try {
      domainHost = new URL(domainHost.includes('://') ? domainHost : `https://${domainHost}`).hostname.toLowerCase();
    } catch {
      domainHost = domainHost.split('/')[0] ?? domainHost;
    }
    domainHost = domainHost.replace(/^www\./, '');
    if (!domainHost) continue;
    if (host === domainHost || host.endsWith(`.${domainHost}`)) {
      scored.set(command.site, Math.max(scored.get(command.site) ?? 0, domainHost.length));
    }
  }

  const registrySites = [...scored.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([site]) => site);

  const hostParts = host.split('.').filter(Boolean);
  const fallback = hostParts.length >= 2 ? hostParts[hostParts.length - 2] : hostParts[0];
  return [...new Set([...registrySites, ...(fallback ? [fallback] : [])])];
}

function firstExistingSitemapPath(paths: string[], fileExists: (candidate: string) => boolean): string | undefined {
  return paths.find((candidate) => fileExists(candidate));
}

function sitemapPathsForSite(site: string, opts: Required<Pick<SitemapAvailabilityOptions, 'homeDir' | 'packageRoot' | 'fileExists'>>): { local?: string; global?: string } {
  const safeSite = site.replace(/[^a-zA-Z0-9_-]+/g, '-');
  if (!safeSite) return {};
  const localBase = path.join(opts.homeDir, '.webcmd', 'sites', safeSite);
  return {
    local: firstExistingSitemapPath([
      path.join(localBase, 'sitemap'),
      path.join(localBase, 'sitemap.md'),
    ], opts.fileExists),
    global: firstExistingSitemapPath([
      path.join(opts.packageRoot, 'sitemaps', safeSite),
      path.join(opts.packageRoot, 'sitemaps', `${safeSite}.md`),
    ], opts.fileExists),
  };
}

export function resolveSitemapAvailabilityForUrl(url: string, options: SitemapAvailabilityOptions = {}): SitemapAvailability | null {
  const homeDir = options.homeDir ?? os.homedir();
  const packageRoot = options.packageRoot ?? findPackageRoot(CLI_FILE);
  const registry = options.registry ?? getRegistry();
  const fileExists = options.fileExists ?? fs.existsSync;

  for (const site of siteNameCandidatesFromUrl(url, registry)) {
    const paths = sitemapPathsForSite(site, { homeDir, packageRoot, fileExists });
    if (!paths.local && !paths.global) continue;
    const source = paths.local && paths.global ? 'local+global' : paths.local ? 'local' : 'global';
    return {
      site,
      available: true,
      source,
      hint: SITEMAP_HINT,
      paths,
    };
  }
  return null;
}

function getBrowserSitemapHintStatePath(scope: string): string {
  const safeScope = scope.replace(/[^a-zA-Z0-9_-]+/g, '_');
  return path.join(getBrowserCacheDir(), 'browser-sitemap-hints', `${safeScope}.json`);
}

function loadBrowserSitemapHintState(scope: string): SitemapHintState {
  try {
    const parsed = JSON.parse(fs.readFileSync(getBrowserSitemapHintStatePath(scope), 'utf-8')) as SitemapHintState;
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.seenSites)) {
      return {
        seenSites: parsed.seenSites.filter((site) => typeof site === 'string'),
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date(0).toISOString(),
      };
    }
  } catch {
    // First command in this browser session has no hint cache yet.
  }
  return { seenSites: [], updatedAt: new Date(0).toISOString() };
}

function markBrowserSitemapHintSeen(scope: string, site: string): void {
  const state = loadBrowserSitemapHintState(scope);
  if (!state.seenSites.includes(site)) state.seenSites.push(site);
  const target = getBrowserSitemapHintStatePath(scope);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify({ seenSites: state.seenSites, updatedAt: new Date().toISOString() }), 'utf-8');
}

function sitemapHintForBrowserUrl(url: string, scope: string, opts: { oncePerSession: boolean }): SitemapAvailability | null {
  const sitemap = resolveSitemapAvailabilityForUrl(url);
  if (!sitemap) return null;
  if (!opts.oncePerSession) return sitemap;
  const state = loadBrowserSitemapHintState(scope);
  if (state.seenSites.includes(sitemap.site)) return null;
  markBrowserSitemapHintSeen(scope, sitemap.site);
  return sitemap;
}

export function checkSiteMemory(site: string): SiteMemoryReport {
  const siteDir = path.join(os.homedir(), '.webcmd', 'sites', site);
  const endpointsPath = path.join(siteDir, 'endpoints.json');
  const notesPath = path.join(siteDir, 'notes.md');
  let endpointsCount = 0;
  let endpointsPresent = fs.existsSync(endpointsPath);
  if (endpointsPresent) {
    try {
      const parsed = JSON.parse(fs.readFileSync(endpointsPath, 'utf-8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        endpointsCount = Object.keys(parsed).length;
      } else if (Array.isArray(parsed)) {
        endpointsCount = parsed.length;
      }
    } catch {
      endpointsPresent = false;
    }
  }
  const notesPresent = fs.existsSync(notesPath);
  return {
    ok: endpointsPresent && endpointsCount > 0 && notesPresent,
    siteDir,
    endpoints: { present: endpointsPresent, count: endpointsCount, path: endpointsPath },
    notes: { present: notesPresent, path: notesPath },
  };
}

export function printSiteMemoryReport(report: SiteMemoryReport, strict: boolean | undefined): void {
  if (report.ok) {
    console.log(`  ✓ Memory: endpoints.json (${report.endpoints.count}), notes.md present at ${report.siteDir}`);
    return;
  }
  const marker = strict ? '✗' : '⚠';
  const missing: string[] = [];
  if (!report.endpoints.present) missing.push('endpoints.json');
  else if (report.endpoints.count === 0) missing.push('endpoints.json (empty)');
  if (!report.notes.present) missing.push('notes.md');
  console.log(`  ${marker} Memory: missing ${missing.join(', ')} under ${report.siteDir}`);
  console.log(`    Write the endpoint you just verified + a 1-line session note so the next agent starts from minute 0, not minute 95.`);
  if (!strict) {
    console.log(`    (Re-run with --strict-memory to fail instead of warn.)`);
  }
}

/** Coerce adapter JSON output into a row array. Accepts `[{...}]`, single `{}`, or `{items:[...]}`-style envelopes. */
export function normalizeVerifyRows(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) {
    return data.map((r) => (r && typeof r === 'object' ? r as Record<string, unknown> : { value: r }));
  }
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    for (const k of ['rows', 'items', 'data', 'results']) {
      if (Array.isArray(obj[k])) {
        return (obj[k] as unknown[]).map((r) => (r && typeof r === 'object' ? r as Record<string, unknown> : { value: r }));
      }
    }
    return [obj];
  }
  return [];
}

/** Render up to 10 rows as a compact padded table for eyeball inspection during verify. */
export function renderVerifyPreview(
  rows: Record<string, unknown>[],
  opts: { maxRows?: number; maxCols?: number; cellMax?: number } = {},
): string {
  const maxRows = opts.maxRows ?? 10;
  const maxCols = opts.maxCols ?? 6;
  const cellMax = opts.cellMax ?? 40;
  if (rows.length === 0) return '  (no rows)';

  const allCols = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const cols = allCols.slice(0, maxCols);
  const shown = rows.slice(0, maxRows);
  const cellOf = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return s.replace(/\s+/g, ' ').slice(0, cellMax);
  };
  const widths = cols.map((c) => Math.max(c.length, ...shown.map((r) => cellOf(r[c]).length)));
  const fmtRow = (vals: string[]): string => vals.map((v, i) => v.padEnd(widths[i])).join('  ');

  const out: string[] = [];
  out.push(`  ${fmtRow(cols)}`);
  out.push(`  ${widths.map((w) => '-'.repeat(w)).join('  ')}`);
  for (const r of shown) out.push(`  ${fmtRow(cols.map((c) => cellOf(r[c])))}`);
  if (rows.length > maxRows) out.push(`  ... and ${rows.length - maxRows} more row(s)`);
  if (allCols.length > maxCols) out.push(`  (${allCols.length - maxCols} more column(s) hidden)`);
  return out.join('\n');
}

function getCommandOption(command: Command | undefined, option: string): unknown {
  let current: Command | undefined = command;
  while (current) {
    const opts = current.opts();
    if (Object.prototype.hasOwnProperty.call(opts, option) && opts[option] !== undefined) return opts[option];
    current = current.parent as Command | undefined;
  }
  return undefined;
}

function getBrowserSession(command?: Command): string {
  return validateRawBrowserSession(getCommandOption(command, 'session'), getCommandOption(command, 'profile') as string | undefined);
}

function getBrowserProfileSelection(command?: Command): ProfileSelection | undefined {
  const raw = getCommandOption(command, 'profile');
  return resolveProfileSelection(typeof raw === 'string' && raw.trim() ? raw.trim() : undefined);
}

function getSelectedProfileId(command?: Command): string {
  return getBrowserProfileSelection(command)?.contextId ?? 'default';
}

function formatHandoff(row: BrowserSessionListRow): string {
  return row.handoff ? `${row.handoff.site} until ${row.handoff.expiresAt}` : '';
}

function sessionCreateOutput(data: unknown): unknown {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  const row = data as Record<string, unknown>;
  return { id: row.id, kind: row.kind, runtimeState: row.runtimeState };
}

function applyVerbose(opts: { verbose?: boolean }): void {
  if (opts.verbose) process.env.WEBCMD_VERBOSE = '1';
}

function formatChildCommandSummary(command: Command): string {
  return [...new Set(command.commands.map(child => child.name()))]
    .sort((a, b) => a.localeCompare(b))
    .join(', ');
}

function applyRootSubcommandSummaries(program: Command): void {
  for (const command of program.commands) {
    if (command.commands.length === 0) continue;
    const summary = formatChildCommandSummary(command);
    if (summary) command.description(summary);
  }
}

async function handleAdapterOverride(commandKey: string): Promise<void> {
  const { createAdapterOverride } = await import('./adapter-override.js');
  try {
    const result = createAdapterOverride(commandKey);
    console.log(`✅ Override created for ${result.commandKey}`);
    console.log(`     yours: ${result.overridePath}`);
    console.log(`     base:  ${result.basePath}`);
    console.log();
    console.log(`  Your copy now takes precedence over plugin "${result.plugin}".`);
    console.log(`  "${CLI_COMMAND} plugin update" keeps updating the plugin copy, not your override,`);
    console.log('  and will tell you when the upstream file changes so you can merge.');
  } catch (err) {
    console.error(`Error: ${getErrorMessage(err)}`);
    process.exitCode = EXIT_CODES.GENERIC_ERROR;
  }
}

export function createProgram(BUILTIN_CLIS: string, USER_CLIS: string, pluginsDir: string = PLUGINS_DIR): Command {
  const program = new Command();
  // enablePositionalOptions: prevents parent from consuming flags meant for subcommands;
  // prerequisite for passThroughOptions to forward --help/--version to external binaries
  program
    .name('webcmd')
    .description('Make any website your CLI. Zero setup. AI-powered.');
  configureRootCommandSurface(program);

  // ── Built-in: list ────────────────────────────────────────────────────────

  configureListCommandSurface(program.command('list'))
    .action((opts) => {
      const externalClis = opts.format === 'table' ? loadExternalClis() : [];
      const overrides = readOverrideRecords();
      const presentation = commandListPresentation(
        filterCommandsByTag([...new Set(getRegistry().values())].map((command) => {
          const commandKey = `${command.site}/${command.name}`;
          const classified = classifyCommandOrigin(command, {
            pluginsDir,
            userClisDir: USER_CLIS,
          });
          const origin = classified.kind === 'local' && overrides[commandKey]
            ? { kind: 'override' as const, plugin: overrides[commandKey].plugin }
            : classified;
          return { ...toPresentableCommand(command), origin: formatCommandOrigin(origin) };
        }), opts.tag),
        opts.format,
        {
          externalClis: externalClis.map((external) => ({
            label: formatExternalCliLabel(external),
            installed: isBinaryInstalled(external.binary),
            ...(external.description ? { description: external.description } : {}),
          })),
        },
      );
      if (presentation.displayLines) {
        for (const line of presentation.displayLines) console.log(line);
        return;
      }
      renderOutput(presentation.rows, {
        fmt: opts.format,
        columns: presentation.columns,
        title: 'webcmd/list',
        source: 'webcmd list',
      });
    });

  // ── Built-in: validate / verify ───────────────────────────────────────────

  program
    .command('validate')
    .description('Validate CLI definitions')
    .argument('[target]', 'site or site/name')
    .action(async (target) => {
      const { validateClisWithTarget, renderValidationReport } = await import('./validate.js');
      console.log(renderValidationReport(validateClisWithTarget([BUILTIN_CLIS, USER_CLIS], target)));
    });

  program
    .command('verify')
    .description('Validate + smoke test')
    .argument('[target]')
    .option('--smoke', 'Run smoke tests', false)
    .action(async (target, opts) => {
      const { verifyClis, renderVerifyReport } = await import('./verify.js');
      const r = await verifyClis({ builtinClis: BUILTIN_CLIS, userClis: USER_CLIS, target, smoke: opts.smoke });
      console.log(renderVerifyReport(r));
      process.exitCode = r.ok ? EXIT_CODES.SUCCESS : EXIT_CODES.GENERIC_ERROR;
    });

  const skillsCmd = program
    .command('skills')
    .description('List, add, update, and remove bundled Webcmd skills')
    .action(() => {
      const rows = listWebcmdSkills();
      renderOutput(rows, {
        fmt: 'table',
        fmtExplicit: false,
        columns: ['name', 'description', 'version', 'path'],
        title: 'webcmd/skills/list',
        source: 'webcmd skills',
      });
    });

  skillsCmd
    .command('list')
    .description('List bundled Webcmd skills')
    .option('-f, --format <fmt>', 'Output format: table, json, yaml, md, csv', 'table')
    .action((opts) => {
      const rows = listWebcmdSkills();
      renderOutput(rows, {
        fmt: opts.format,
        fmtExplicit: !!opts.format,
        columns: ['name', 'description', 'version', 'path'],
        title: 'webcmd/skills/list',
        source: 'webcmd skills list',
      });
    });

  skillsCmd
    .command('add')
    .description('Add bundled Webcmd skills to an agent skills folder')
    .option('-p, --provider <provider>', 'Agent provider: agents, codex, claude')
    .option('-s, --scope <scope>', 'Add scope: user/global or project/local')
    .option('--path <path>', 'Custom agent skills directory')
    .option('--json', 'Output a JSON envelope', false)
    .action(async (opts) => {
      await handleSkillLinkCommand(async () => {
        const resolved = await resolveSkillAddOptions(opts);
        if (resolved.provider === 'custom' && !resolved.path) {
          throw new ArgumentError('Custom skill provider requires --path.', 'Pass --path <skills-dir> or run interactively.');
        }
        return addWebcmdSkills({
          provider: resolved.provider,
          scope: resolved.scope,
          customPath: resolved.path,
        });
      }, opts.json, 'added');
    });

  skillsCmd
    .command('update')
    .description('Refresh bundled Webcmd skill symlinks after updating the package')
    .option('-p, --provider <provider>', 'Also repair provider link: agents, codex, claude')
    .option('-s, --scope <scope>', 'Also repair scoped link: user/global or project/local')
    .option('--path <path>', 'Also repair a custom agent skills directory')
    .option('--json', 'Output a JSON envelope', false)
    .action(async (opts) => {
      await handleSkillLinkCommand(() => updateWebcmdSkill({
        provider: opts.provider,
        scope: opts.scope,
        customPath: opts.path,
      }), opts.json, 'updated');
    });

  skillsCmd
    .command('remove')
    .description('Remove bundled Webcmd skill symlinks from supported locations')
    .option('--path <path>', 'Also remove links from a custom agent skills directory')
    .option('--json', 'Output a JSON envelope', false)
    .action((opts) => handleSkillRemoveCommand(opts.path, opts.json));

  program
    .command('update')
    .description('Update webcmd to the latest version and refresh bundled skills')
    .option('--skip-skills', 'Skip refreshing bundled skill links after updating', false)
    .action(async (opts) => {
      const { buildUpgradeCommand, upgradePackage, getRuntimeUpdateNotice } = await import('./update.js');
      const { cmd, args } = buildUpgradeCommand();
      console.log(`Updating ${PACKAGE_NAME}: ${cmd} ${args.join(' ')}`);
      try {
        upgradePackage();
      } catch (err) {
        console.error(`Error: package update failed: ${getErrorMessage(err)}`);
        console.error(`Hint: check your network connection and that ${cmd} is on PATH.`);
        process.exitCode = EXIT_CODES.GENERIC_ERROR;
        return;
      }
      if (!opts.skipSkills) {
        try {
          const { skills } = updateWebcmdSkill();
          console.log(`Bundled skills refreshed: ${skills.length}`);
        } catch (err) {
          console.error(`Warning: skill refresh failed: ${getErrorMessage(err)}`);
          console.error('Hint: run "webcmd skills update" once the new version is active.');
        }
      }
      // The Cloak runtime/extension ships separately from npm; surface it if stale.
      const runtimeNotice = getRuntimeUpdateNotice();
      if (runtimeNotice) process.stdout.write(runtimeNotice);
      console.log('Update complete.');
    });

  const authCmd = registerAuthCommands(program);

  program
    .command('convention-audit')
    .description('Scan adapters for agent-native convention violations')
    .argument('[target]', 'site or site/name')
    .option('--site <site>', 'Limit audit to one site')
    .option('-f, --format <fmt>', 'Output format: table, json, yaml', 'table')
    .option('--strict', 'Exit non-zero when violations are found', false)
    .action(async (target, opts) => {
      const { runConventionAudit, renderConventionAuditText } = await import('./convention-audit.js');
      const report = runConventionAudit({
        projectRoot: findPackageRoot(CLI_FILE),
        target,
        site: opts.site,
      });
      const fmt = String(opts.format ?? 'table').toLowerCase();
      if (fmt === 'json' || fmt === 'yaml' || fmt === 'yml') {
        renderOutput(report, { fmt });
      } else {
        console.log(renderConventionAuditText(report));
      }
      if (opts.strict && !report.ok) process.exitCode = EXIT_CODES.GENERIC_ERROR;
    });

  const sessionCmd = program.command('session').description('Create, list, and close browser Sessions');

  sessionCmd
    .command('create')
    .description('Create a new opaque browser Session ID for the selected Profile')
    .option('-f, --format <fmt>', 'Output format: table, json, yaml', 'yaml')
    .action(async (opts, command) => {
      const profileId = getSelectedProfileId(command);
      const data = await sendCommand('session-create', { contextId: profileId });
      await renderOutput(sessionCreateOutput(data), { fmt: opts.format, columns: ['id', 'kind', 'runtimeState'] });
    });

  sessionCmd
    .command('list')
    .description('List browser Sessions for the selected Profile')
    .option('--limit <number>', 'Maximum Sessions to return (1-100)', parseSessionListLimit, 20)
    .option('-f, --format <fmt>', 'Output format: table, json, yaml', 'table')
    .action(async (opts, command) => {
      const profileId = getSelectedProfileId(command);
      let rows: BrowserSessionListRow[];
      const status = await fetchDaemonStatus({ contextId: profileId });
      if (status?.runtimeConnected && !isDaemonStale(status, PKG_VERSION)) {
        rows = await sendCommand('session-list', { contextId: profileId, limit: opts.limit }) as BrowserSessionListRow[];
      } else {
        rows = new LocalBrowserSessionStore().list(profileId, opts.limit);
      }
      const output = rows.map((row) => ({ ...row, handoff: formatHandoff(row) }));
      if (output.length === 0 && String(opts.format ?? 'table') === 'table') {
        console.log(`No browser Sessions found for Profile ${profileId}.`);
        return;
      }
      await renderOutput(output, { fmt: opts.format, columns: ['id', 'kind', 'runtimeState', 'handoff'] });
    });

  sessionCmd
    .command('close')
    .description('Close a browser Session runtime without deleting its durable record')
    .argument('<session-id>', 'Existing opaque Session ID from `webcmd session create`')
    .option('-f, --format <fmt>', 'Output format: table, json, yaml', 'yaml')
    .option('--force', 'Close even while the Session is busy or paused for handoff')
    .action(async (sessionId: string, opts: { format?: string; force?: boolean }, command) => {
      const profileId = getSelectedProfileId(command);
      requireSessionIdShape(sessionId);
      const status = await fetchDaemonStatus({ contextId: profileId });
      if (!status || (status.runtimeConnected && !isDaemonStale(status, PKG_VERSION))) {
        try {
          const data = await sendCommand('session-close', {
            contextId: profileId,
            session: sessionId,
            force: opts.force === true,
          });
          await renderOutput(data, { fmt: opts.format });
          return;
        } catch (error) {
          if (status || opts.force === true) throw error;
        }
      }
      if (opts.force === true) {
        const data = await sendCommand('session-close', { contextId: profileId, session: sessionId, force: true });
        await renderOutput(data, { fmt: opts.format });
        return;
      }
      new LocalBrowserSessionStore().require(profileId, sessionId);
      await renderOutput({ closed: false, alreadyIdle: true, session: sessionId }, { fmt: opts.format });
    });

  // ── Built-in: browser (browser control for Claude Code skill) ───────────────
  //
  // Make websites accessible for AI agents.
  // All commands wrapped in browserAction() for consistent error handling.

  const browser = program
    .command('browser')
    .description('Run Playwright programs against an explicit browser Session');
  const originalBrowserDescription = browser.description();

  // ── Init (adapter scaffolding) ──

  browser.command('init')
    .argument('<name>', 'Adapter name in site/command format (e.g. hn/top)')
    .description('Generate adapter scaffold in ~/.webcmd/clis/')
    .action(async (name: string) => {
      try {
        const parts = name.split('/');
        if (parts.length !== 2 || !parts[0] || !parts[1]) {
          console.error('Name must be site/command format (e.g. hn/top)');
          process.exitCode = EXIT_CODES.USAGE_ERROR;
          return;
        }
        const [site, command] = parts;
        if (!/^[a-zA-Z0-9_-]+$/.test(site) || !/^[a-zA-Z0-9_-]+$/.test(command)) {
          console.error('Name parts must be alphanumeric/dash/underscore only');
          process.exitCode = EXIT_CODES.USAGE_ERROR;
          return;
        }

        const os = await import('node:os');
        const fs = await import('node:fs');
        const path = await import('node:path');
        const dir = path.join(os.homedir(), '.webcmd', 'clis', site);
        const filePath = path.join(dir, `${command}.js`);

        if (fs.existsSync(filePath)) {
          console.log(`Adapter already exists: ${filePath}`);
          return;
        }

        let domain = site;

        const template = `import { cli, Strategy } from '@agentrhq/webcmd/registry';

cli({
  site: '${site}',
  name: '${command}',
  description: '', // TODO: describe what this command does
  access: 'read',  // TODO: 'read' for queries, 'write' for remote/account state changes
  example: 'webcmd ${site} ${command} -f yaml',
  domain: '${domain}',
  strategy: Strategy.PUBLIC, // TODO: PUBLIC (no auth), COOKIE (needs login), UI (DOM interaction)
  browser: false,            // TODO: set true if needs browser
  args: [
    { name: 'limit', type: 'int', default: 10, help: 'Number of items' },
  ],
  columns: [], // TODO: field names for table output (e.g. ['title', 'score', 'url'])
  func: async (kwargs) => {
    // TODO: implement data fetching
    // Prefer API calls (fetch) over browser automation
    // If you set browser: true, change this to: async (page, kwargs) => { ... }
    return [];
  },
});
`;
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, template, 'utf-8');
        console.log(`Created: ${filePath}`);
        console.log('First time on this site? Run: webcmd session create, then webcmd --session <session-id> browser run --stdin');
        console.log(`Edit the file to implement your adapter, then run: webcmd browser verify ${name}`);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = EXIT_CODES.GENERIC_ERROR;
      }
    });

  browser.command('fork')
    .argument('<name>', 'Command to fork in site/command format')
    .description('Fork an installed plugin command into a private copy')
    .action(handleAdapterOverride);

  // ── Verify (test adapter) ──

  browser.command('verify')
    .argument('<name>', 'Adapter name in site/command format (e.g. hn/top)')
    .option('--write-fixture', 'Write a starter fixture to ~/.webcmd/sites/<site>/verify/<command>.json if none exists')
    .option('--update-fixture', 'Overwrite an existing fixture with one derived from current output')
    .option('--no-fixture', 'Ignore any fixture file for this run (no value-level validation)')
    .option('--strict-memory', 'Fail (not just warn) when ~/.webcmd/sites/<site>/endpoints.json or notes.md is missing')
    .option('--seed-args <value>', 'Seed args when no fixture exists; use JSON array/object for multiple args or flags')
    .option('--trace <mode>', 'Trace capture for the adapter subprocess: off, on, retain-on-failure', 'off')
    .description('Execute an adapter and validate output; uses fixture at ~/.webcmd/sites/<site>/verify/<cmd>.json when present')
    .action(async (name: string, opts: { fixture?: boolean; writeFixture?: boolean; updateFixture?: boolean; strictMemory?: boolean; seedArgs?: string; trace?: string } = {}) => {
      try {
        const parts = name.split('/');
        if (parts.length !== 2) { console.error('Name must be site/command format'); process.exitCode = EXIT_CODES.USAGE_ERROR; return; }
        const [site, command] = parts;
        if (!/^[a-zA-Z0-9_-]+$/.test(site) || !/^[a-zA-Z0-9_-]+$/.test(command)) {
          console.error('Name parts must be alphanumeric/dash/underscore only');
          process.exitCode = EXIT_CODES.USAGE_ERROR;
          return;
        }

        const { execFileSync } = await import('node:child_process');
        const { loadFixture, writeFixture, deriveFixture, validateRows, validateRowShape, fixturePath, expandFixtureArgs, parseSeedArgs } = await import('./browser/verify-fixture.js');
        const filePath = path.join(os.homedir(), '.webcmd', 'clis', site, `${command}.js`);
        if (!fs.existsSync(filePath)) {
          console.error(`Adapter not found: ${filePath}`);
          console.error(`Run "webcmd browser init ${name}" to create it.`);
          process.exitCode = EXIT_CODES.GENERIC_ERROR;
          return;
        }

        console.log(`🔍 Verifying ${name}...\n`);
        console.log(`  Loading: ${filePath}`);

        const useFixture = opts.fixture !== false;
        let fixture = useFixture ? loadFixture(site, command) : null;

        // Build adapter args: fixture.args override the legacy --limit 3 heuristic.
        //   - object form   { "limit": 3 }            → `--limit 3`
        //   - array form    ["123", "--limit", "3"]   → verbatim (for positional subjects)
        const adapterSrc = fs.readFileSync(filePath, 'utf-8');
        const hasLimitArg = /['"]limit['"]/.test(adapterSrc);
        const seedArgs = parseSeedArgs(opts.seedArgs);
        const explicitArgs = fixture?.args ?? seedArgs;
        const cliArgs: string[] = expandFixtureArgs(explicitArgs);
        if (explicitArgs === undefined && cliArgs.length === 0 && hasLimitArg) cliArgs.push('--limit', '3');

        const traceArgs = opts.trace && opts.trace !== 'off' ? ['--trace', opts.trace] : [];
        const argDisplay = [...cliArgs, ...traceArgs].join(' ');
        const invocation = resolveBrowserVerifyInvocation();

        // Always request JSON so we can validate structurally.
        const execArgs = [...invocation.args, site, command, ...cliArgs, ...traceArgs, '--format', 'json'];

        let rawJson: string;
        try {
          rawJson = execFileSync(invocation.binary, execArgs, {
            cwd: invocation.cwd,
            timeout: 30000,
            encoding: 'utf-8',
            env: process.env,
            stdio: ['pipe', 'pipe', 'pipe'],
            ...(invocation.shell ? { shell: true } : {}),
          });
        } catch (err) {
          console.log(`  Executing: webcmd ${site} ${command} ${argDisplay}\n`);
          const execErr = err as { stdout?: string | Buffer; stderr?: string | Buffer };
          if (execErr.stdout) console.log(String(execErr.stdout));
          if (execErr.stderr) console.error(String(execErr.stderr).slice(0, 500));
          console.log(`\n  ✗ Adapter failed. Fix the code and try again.`);
          process.exitCode = EXIT_CODES.GENERIC_ERROR;
          return;
        }

        console.log(`  Executing: webcmd ${site} ${command} ${argDisplay}\n`);

        let rows: Record<string, unknown>[];
        try {
          rows = normalizeVerifyRows(JSON.parse(rawJson));
        } catch {
          console.log(rawJson);
          console.log('\n  ✗ Could not parse adapter output as JSON. Is `--format json` broken?');
          process.exitCode = EXIT_CODES.GENERIC_ERROR;
          return;
        }

        console.log(renderVerifyPreview(rows));
        console.log(`\n  → ${rows.length} row${rows.length === 1 ? '' : 's'}`);

        const shapeFailures = validateRowShape(rows);
        if (shapeFailures.length > 0) {
          console.log(`\n  ✗ Adapter output violates row shape conventions:`);
          for (const f of shapeFailures.slice(0, 20)) {
            const where = f.rowIndex !== undefined ? `row[${f.rowIndex}] ` : '';
            console.log(`    - [${f.rule}] ${where}${f.detail}`);
          }
          if (shapeFailures.length > 20) {
            console.log(`    ... and ${shapeFailures.length - 20} more failure(s)`);
          }
          console.log(`\n  Keep rows agent-native: <=12 top-level keys, nesting depth <=1, and id-shaped fields at top level.`);
          process.exitCode = EXIT_CODES.GENERIC_ERROR;
          return;
        }

        // ── Fixture handling ───────────────────────────────────────────
        if (opts.writeFixture || opts.updateFixture) {
          if (fixture && !opts.updateFixture) {
            console.log(`\n  Fixture already exists at ${fixturePath(site, command)}.`);
            console.log(`  Use --update-fixture to overwrite.`);
          } else {
            const fixtureArgs = explicitArgs !== undefined
              ? explicitArgs
              : (hasLimitArg ? { limit: 3 } : undefined);
            const derived = deriveFixture(rows, fixtureArgs);
            const p = writeFixture(site, command, derived);
            console.log(`\n  ${fixture ? '↻ Updated' : '✎ Wrote'} fixture: ${p}`);
            console.log(`  Review and hand-tune the derived expectations (add patterns / notEmpty, tighten rowCount).`);
            fixture = derived;
          }
        }

        if (!fixture) {
          console.log(`\n  ✓ Adapter runs. (No fixture at ${fixturePath(site, command)} — consider --write-fixture to seed one.)`);
          const memoryReport = checkSiteMemory(site);
          printSiteMemoryReport(memoryReport, opts.strictMemory);
          if (!memoryReport.ok && opts.strictMemory) {
            process.exitCode = EXIT_CODES.GENERIC_ERROR;
          }
          return;
        }

        const failures = validateRows(rows, fixture);
        if (failures.length === 0) {
          console.log(`\n  ✓ Adapter matches fixture (${fixturePath(site, command)}).`);
          const memoryReport = checkSiteMemory(site);
          printSiteMemoryReport(memoryReport, opts.strictMemory);
          if (!memoryReport.ok && opts.strictMemory) {
            process.exitCode = EXIT_CODES.GENERIC_ERROR;
          }
          return;
        }

        console.log(`\n  ✗ Adapter output does not match fixture:`);
        for (const f of failures.slice(0, 20)) {
          const where = f.rowIndex !== undefined ? `row[${f.rowIndex}] ` : '';
          console.log(`    - [${f.rule}] ${where}${f.detail}`);
        }
        if (failures.length > 20) {
          console.log(`    ... and ${failures.length - 20} more failure(s)`);
        }
        process.exitCode = EXIT_CODES.GENERIC_ERROR;
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = EXIT_CODES.GENERIC_ERROR;
      }
    });

  function rawBrowserAction(fn: (session: string, routing: { contextId?: string; preferredContextId?: string }, opts: Record<string, unknown>) => Promise<unknown>) {
    return async (opts: Record<string, unknown>, command: Command) => {
      const runId = generateRunId();
      const commandName = `browser/${command.name()}`;
      let releaseRun = true;
      try {
        const session = getBrowserSession(command);
        const routing = profileRouteParams(getBrowserProfileSelection(command));
        const result = await runWithDaemonRunContext({ runId, command: commandName }, () => fn(session, routing, opts));
        console.log(JSON.stringify(result, null, 2));
      } catch (error) {
        if (isUnknownOutcomeError(error)) releaseRun = false;
        if (error instanceof BrowserCommandError && error.code) {
          console.log(JSON.stringify({
            error: {
              code: error.code,
              message: error.message,
              ...(error.hint ? { hint: error.hint } : {}),
              ...(error.details !== undefined ? { details: error.details } : {}),
            },
          }, null, 2));
        }
        log.error(error instanceof CliError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : String(error));
        if (error instanceof CliError && error.hint) log.error(error.hint);
        process.exitCode = error instanceof CliError ? error.exitCode : EXIT_CODES.GENERIC_ERROR;
      } finally {
        clearDaemonRunContext(runId);
        if (releaseRun) await releaseSiteSessionLease(runId);
      }
    };
  }

  browser.addCommand(new Command('tabs')
    .description('List pages in the existing browser session')
    .action(rawBrowserAction((session, routing) => listExistingBrowserTabs(session, routing))));

  browser.addCommand(new Command('bind')
    .description('Bind this session to an existing page')
    .addOption(new Option('--page <id>', 'Stable page id returned by tabs')
      .makeOptionMandatory()
      .argParser(browserOptionValueParser('bind', 'page')!))
    .action(rawBrowserAction((session, routing, opts) => {
      const page = typeof opts.page === 'string' ? opts.page.trim() : '';
      if (!page) throw new BrowserCommandError('--page must be a non-empty stable page id', 'invalid_request');
      return sendCommand('bind', { session, surface: 'browser', ...routing, page });
    })));

  const runCommand = new Command('run')
    .description('Run JavaScript with Playwright')
    .option('--stdin', 'Read the program from stdin')
    .option('--file <path>', 'Read the program from a file')
    .addOption(new Option('--timeout <seconds>', 'Execution timeout in seconds').argParser(browserOptionValueParser('run', 'timeout')!))
    .addOption(new Option('--max-output <characters>', 'Maximum returned characters').argParser(browserOptionValueParser('run', 'maxOutput')!))
    .addOption(new Option('--snapshot-mode <mode>', 'Snapshot mode for automatic diff: act or tree').default('act').argParser(browserOptionValueParser('run', 'snapshotMode')!))
    .option('--no-snapshot-diff', 'Skip the automatic before/after snapshot diff');
  runCommand.action(rawBrowserAction(async (session, routing, opts) => {
    let source: string;
    try {
      source = await loadBrowserRunSource({ stdin: opts.stdin === true, file: typeof opts.file === 'string' ? opts.file : undefined });
    } catch (error) {
      if (error instanceof BrowserRunError) throw new BrowserCommandError(error.message, error.code, error.hint);
      throw error;
    }
    const timeout = typeof opts.timeout === 'number' ? opts.timeout : undefined;
    const maxOutput = typeof opts.maxOutput === 'number' ? opts.maxOutput : undefined;
    return sendCommand('run', {
      session,
      surface: 'browser',
      ...routing,
      source,
      ...(timeout !== undefined ? { timeoutMs: timeout * 1000, timeout: timeout + 5 } : {}),
      ...(maxOutput !== undefined ? { maxOutputChars: maxOutput } : {}),
      snapshotMode: opts.snapshotMode === 'tree' ? 'tree' : 'act',
      ...(opts.snapshotDiff === false ? { noSnapshotDiff: true } : {}),
    });
  }));
  browser.addCommand(runCommand);

  browser.addCommand(new Command('snapshot')
    .description('Inspect the current page with a compact accessibility snapshot')
    .addOption(new Option('--snapshot-mode <mode>', 'Snapshot mode: act, tree, or read').default('act').argParser(browserOptionValueParser('snapshot', 'snapshotMode')!))
    .option('--ref <ref>', 'Render only the subtree rooted at this snapshot ref')
    .addOption(new Option('--max-output <characters>', 'Maximum returned characters').argParser(browserOptionValueParser('snapshot', 'maxOutput')!))
    .action(rawBrowserAction((session, routing, opts) => sendCommand('snapshot', {
      session,
      surface: 'browser',
      ...routing,
      snapshotMode: opts.snapshotMode === 'tree' || opts.snapshotMode === 'read' ? opts.snapshotMode : 'act',
      ...(typeof opts.ref === 'string' ? { ref: opts.ref } : {}),
      ...(typeof opts.maxOutput === 'number' ? { maxOutputChars: opts.maxOutput } : {}),
    }))));

  browser.addCommand(new Command('close')
    .description('Close or detach this browser session')
    .action(rawBrowserAction((session, routing) => sendCommand('close-window', {
      session,
      surface: 'browser',
      ...routing,
    }))));
  // ── Built-in: doctor / completion ──────────────────────────────────────────

  program
    .command('doctor')
    .description('Diagnose webcmd browser bridge connectivity')
    .option('-v, --verbose', 'Debug output')
    .action(async (opts) => {
      applyVerbose(opts);
      const { runBrowserDoctor, renderBrowserDoctorReport } = await import('./doctor.js');
      const report = await runBrowserDoctor({ cliVersion: PKG_VERSION });
      console.log(renderBrowserDoctorReport(report));
    });

  configureCompletionCommandSurface(program.command('completion'))
    .action((shell: string) => {
      printCompletionScript(shell);
    });

  // ── Plugin management ──────────────────────────────────────────────────────

  /** Print the "N overrides need reconciliation" report after `plugin update`. Prints nothing when empty. */
  function printReconcileReport(needs: import('./plugin.js').OverrideReconcileNeed[]): void {
    if (needs.length === 0) return;
    console.log();
    console.log(`⚠  ${needs.length} override${needs.length === 1 ? '' : 's'} need${needs.length === 1 ? 's' : ''} reconciliation:`);
    for (const need of needs) {
      console.log(`     ${need.commandKey}`);
      console.log(`       yours:    ${need.yours}`);
      console.log(`       upstream: ${need.upstream}`);
      if (need.base) {
        console.log(`       base:     ${need.base}`);
      } else {
        console.log(`       base:     unavailable (merge base was deleted)`);
      }
    }
    console.log(`     Your override still takes precedence. Merge the upstream change, or run`);
    console.log(`     ${CLI_COMMAND} adapter reset <plugin> to drop the override.`);
  }

  const pluginCmd = program.command('plugin').description(`Manage ${CLI_COMMAND} plugins`);
  // Snapshot before applyRootSubcommandSummaries() rewrites .description() to a child-name listing.
  const originalPluginDescription = pluginCmd.description();

  configurePluginInstallSurface(pluginCmd.command('install'))
    .action(async (source: string) => {
      const { installPlugin } = await import('./plugin.js');
      const { discoverPlugins } = await import('./discovery.js');
      try {
        const result = installPlugin(source);
        await discoverPlugins();
        if (Array.isArray(result)) {
          if (result.length === 0) {
            console.log('No plugins were installed (all skipped or incompatible).');
          } else {
            console.log(`\u2705 Installed ${result.length} plugin(s) from monorepo: ${result.join(', ')}`);
          }
        } else {
          console.log(`\u2705 Plugin "${result}" installed successfully. Commands are ready to use.`);
        }
      } catch (err) {
        console.error(`Error: ${getErrorMessage(err)}`);
        process.exitCode = EXIT_CODES.GENERIC_ERROR;
      }
    });

  pluginCmd
    .command('uninstall')
    .description('Uninstall a plugin')
    .argument('<name>', 'Plugin name')
    .action(async (name: string) => {
      const { uninstallPlugin } = await import('./plugin.js');
      try {
        uninstallPlugin(name);
        console.log(`✅ Plugin "${name}" uninstalled.`);
      } catch (err) {
        console.error(`Error: ${getErrorMessage(err)}`);
        process.exitCode = EXIT_CODES.GENERIC_ERROR;
      }
    });

  pluginCmd
    .command('update')
    .description('Update a plugin (or all plugins) to the latest version')
    .argument('[name]', 'Plugin name (required unless --all is passed)')
    .option('--all', 'Update all installed plugins')
    .option('--force', 'Discard uncommitted changes in the plugin directory')
    .action(async (name: string | undefined, opts: { all?: boolean; force?: boolean }) => {
      if (!name && !opts.all) {
        console.error('Error: Please specify a plugin name or use the --all flag.');
        process.exitCode = EXIT_CODES.USAGE_ERROR;
        return;
      }
      if (name && opts.all) {
        console.error('Error: Cannot specify both a plugin name and --all.');
        process.exitCode = EXIT_CODES.USAGE_ERROR;
        return;
      }

      const { updatePlugin, updateAllPlugins, findOverridesNeedingReconcile } = await import('./plugin.js');
      const { discoverPlugins } = await import('./discovery.js');
      if (opts.all) {
        const results = updateAllPlugins({ force: opts.force === true });
        if (results.length > 0) {
          await discoverPlugins();
        }

        let hasErrors = false;
        console.log('  Update Results:');
        for (const result of results) {
          if (result.success) {
            console.log(`  ✓ ${result.name}`);
            continue;
          }
          hasErrors = true;
          console.log(`  ✗ ${result.name} — ${String(result.error)}`);
        }

        if (results.length === 0) {
          console.log('  No plugins installed.');
          return;
        }

        console.log();
        if (hasErrors) {
          console.error('Completed with some errors.');
          process.exitCode = EXIT_CODES.GENERIC_ERROR;
        } else {
          console.log('✅ All plugins updated successfully.');
        }

        printReconcileReport(findOverridesNeedingReconcile([
          ...new Set(results.flatMap((result) => result.success ? result.updatedPlugins ?? [result.name] : [])),
        ]));
        return;
      }

      try {
        const updatedPlugins = updatePlugin(name!, { force: opts.force === true });
        await discoverPlugins();
        console.log(`✅ Plugin "${name}" updated successfully.`);
        printReconcileReport(findOverridesNeedingReconcile(updatedPlugins));
      } catch (err) {
        console.error(`Error: ${getErrorMessage(err)}`);
        process.exitCode = EXIT_CODES.GENERIC_ERROR;
      }
    });


  pluginCmd
    .command('list')
    .description('List installed plugins')
    .option('-f, --format <fmt>', 'Output format: table, json', 'table')
    .action(async (opts) => {
      const { listPlugins } = await import('./plugin.js');
      const plugins = listPlugins();
      if (plugins.length === 0) {
        if (opts.format === 'json') {
          renderOutput([], { fmt: 'json' });
          return;
        }
        console.log('  No plugins installed.');
        console.log(`  Install one with: ${CLI_COMMAND} plugin install github:user/repo`);
        return;
      }
      if (opts.format === 'json') {
        renderOutput(plugins, {
          fmt: 'json',
          columns: ['name', 'commands', 'source', 'overrides', 'updateAvailable'],
          title: `${CLI_COMMAND}/plugins`,
          source: `${CLI_COMMAND} plugin list`,
        });
        return;
      }
      console.log();
      console.log('  Installed plugins');
      console.log();

      // Group by monorepo
      const standalone = plugins.filter((p) => !p.monorepoName);
      const monoGroups = new Map<string, typeof plugins>();
      for (const p of plugins) {
        if (!p.monorepoName) continue;
        const g = monoGroups.get(p.monorepoName) ?? [];
        g.push(p);
        monoGroups.set(p.monorepoName, g);
      }

      for (const p of standalone) {
        const version = p.version ? ` @${p.version}` : '';
        const desc = p.description ? ` — ${p.description}` : '';
        const cmds = p.commands.length > 0 ? ` (${p.commands.join(', ')})` : '';
        const src = p.source ? ` ← ${p.source}` : '';
        console.log(`  ${p.name}${version}${desc}${cmds}${src}`);
        if (p.overrides.length > 0) {
          console.log(`    ⚠ ${p.overrides.length} override${p.overrides.length === 1 ? '' : 's'}: ${p.overrides.join(', ')}${p.updateAvailable ? ' (upstream changed since fork)' : ''}`);
        }
      }

      for (const [mono, group] of monoGroups) {
        console.log();
        console.log(`  📦 ${mono}` + ' (monorepo)');
        for (const p of group) {
          const version = p.version ? ` @${p.version}` : '';
          const desc = p.description ? ` — ${p.description}` : '';
          const cmds = p.commands.length > 0 ? ` (${p.commands.join(', ')})` : '';
          console.log(`    ${p.name}${version}${desc}${cmds}`);
          if (p.overrides.length > 0) {
            console.log(`      ⚠ ${p.overrides.length} override${p.overrides.length === 1 ? '' : 's'}: ${p.overrides.join(', ')}${p.updateAvailable ? ' (upstream changed since fork)' : ''}`);
          }
        }
      }

      console.log();
      console.log(`  ${plugins.length} plugin(s) installed`);
      console.log();
    });


  const catalogCmd = pluginCmd
    .command('catalog')
    .description('Manage plugin marketplace sources');

  catalogCmd
    .command('list')
    .description('List configured plugin marketplace sources')
    .option('-f, --format <fmt>', 'Output format: table, json', 'table')
    .action(async (opts: { format?: string }) => {
      const { readCatalog } = await import('./plugin-catalog.js');
      try {
        const catalog = readCatalog();
        if (opts.format === 'json') {
          renderOutput(catalog, { fmt: 'json' });
          return;
        }
        renderOutput(catalog.sources, {
          fmt: opts.format,
          columns: ['id', 'source', 'manifestUrl'],
          title: `${CLI_COMMAND}/plugin-catalog`,
          source: `${CLI_COMMAND} plugin catalog list`,
        });
      } catch (err) {
        console.error(`Error: ${getErrorMessage(err)}`);
        process.exitCode = EXIT_CODES.GENERIC_ERROR;
      }
    });

  catalogCmd
    .command('add')
    .description('Add a plugin marketplace source')
    .argument('<source>', 'Marketplace source, e.g. github:owner/repo')
    .option('-f, --format <fmt>', 'Output format: table, json', 'table')
    .action(async (source: string, opts: { format?: string }) => {
      const { addCatalogSource } = await import('./plugin-catalog.js');
      try {
        const added = await addCatalogSource(source);
        renderOutput(opts.format === 'json' ? added : [added], {
          fmt: opts.format,
          columns: ['id', 'source', 'manifestUrl'],
          title: `${CLI_COMMAND}/plugin-catalog`,
          source: `${CLI_COMMAND} plugin catalog add`,
        });
      } catch (err) {
        console.error(`Error: ${getErrorMessage(err)}`);
        process.exitCode = EXIT_CODES.GENERIC_ERROR;
      }
    });

  catalogCmd
    .command('remove')
    .description('Remove a plugin marketplace source')
    .argument('<id>', 'Catalog source id')
    .action(async (id: string) => {
      const { removeCatalogSource } = await import('./plugin-catalog.js');
      try {
        removeCatalogSource(id);
        console.log(`✅ Catalog source "${id}" removed.`);
      } catch (err) {
        console.error(`Error: ${getErrorMessage(err)}`);
        process.exitCode = EXIT_CODES.GENERIC_ERROR;
      }
    });

  configurePluginSearchSurface(pluginCmd.command('search'))
    .action(async (query: string | undefined, opts: { format?: string }) => {
      const { readCatalog, searchCatalogPlugins } = await import('./plugin-catalog.js');
      try {
        const catalog = readCatalog();
        const result = await searchCatalogPlugins(catalog, { query });
        if (opts.format === 'json') {
          renderOutput(result, { fmt: 'json' });
        } else {
          for (const err of result.errors) {
            console.error(`Warning: ${err.sourceId}: ${err.message}`);
          }
          renderOutput(result.plugins, {
            fmt: opts.format,
            columns: ['name', 'description', 'version', 'sourceId', 'installSource', 'webcmd'],
            title: `${CLI_COMMAND}/plugin-search`,
            source: `${CLI_COMMAND} plugin search`,
          });
        }
        if (catalog.sources.length > 0 && result.errors.length === catalog.sources.length) {
          process.exitCode = EXIT_CODES.GENERIC_ERROR;
        }
      } catch (err) {
        console.error(`Error: ${getErrorMessage(err)}`);
        process.exitCode = EXIT_CODES.GENERIC_ERROR;
      }
    });

  pluginCmd
    .command('create')
    .description('Create a new plugin scaffold')
    .argument('<name>', 'Plugin name (lowercase, hyphens allowed)')
    .option('-d, --dir <path>', 'Output directory (default: ./<name>)')
    .option('--description <text>', 'Plugin description')
    .option('--author-name <name>', 'Author display name')
    .option('--author-handle <handle>', 'Author GitHub handle')
    .action(async (name: string, opts: {
      dir?: string;
      description?: string;
      authorName?: string;
      authorHandle?: string;
    }) => {
      const { createPluginScaffold } = await import('./plugin-scaffold.js');
      try {
        let authorName = opts.authorName?.trim();
        let authorHandle = opts.authorHandle?.trim();
        if ((!authorName || !authorHandle) && process.stdin.isTTY && process.stdout.isTTY) {
          const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
          try {
            if (!authorName) authorName = (await rl.question('Author name: ')).trim();
            if (!authorHandle) authorHandle = (await rl.question('GitHub handle: ')).trim();
          } finally {
            rl.close();
          }
        }

        const result = createPluginScaffold(name, {
          dir: opts.dir,
          description: opts.description,
          author: {
            name: authorName ?? '',
            handle: authorHandle ?? '',
          },
        });
        console.log(`✅ Plugin scaffold created at ${result.dir}`);
        console.log();
        console.log('  Files created:');
        for (const f of result.files) {
          console.log(`    ${f}`);
        }
        console.log();
        console.log('  Next steps:');
        console.log(`    cd ${result.dir}`);
        console.log(`    ${CLI_COMMAND} plugin install file://${result.dir}`);
        console.log(`    ${CLI_COMMAND} ${name} hello`);
      } catch (err) {
        console.error(`Error: ${getErrorMessage(err)}`);
        process.exitCode = EXIT_CODES.GENERIC_ERROR;
      }
    });

  // ── Built-in: adapter management ─────────────────────────────────────────
  const adapterCmd = program.command('adapter').description('Manage CLI adapters');
  // Snapshot before applyRootSubcommandSummaries() rewrites .description() to a child-name listing.
  const originalAdapterDescription = adapterCmd.description();

  adapterCmd
    .command('status')
    .description('List local adapters in ~/.webcmd/clis/')
    .option('-f, --format <fmt>', 'Output format: table, json', 'table')
    .action(async (opts: { format?: string }) => {
      let userClisListed = false;
      try {
        const userEntries = await fs.promises.readdir(USER_CLIS, { withFileTypes: true });
        userClisListed = true;
        const userSites = userEntries.filter(e => e.isDirectory() && e.name !== '.base').map(e => e.name).sort();
        if (userSites.length === 0) {
          if (opts.format === 'json') {
            renderOutput([], { fmt: 'json' });
            return;
          }
          console.log('No local adapters installed.');
          return;
        }

        const records = readOverrideRecords();
        const reconcile = new Set((await import('./plugin.js')).findOverridesNeedingReconcile().map(({ commandKey }) => commandKey));
        const adapters: Array<{
          command: string;
          kind: 'user' | 'override';
          plugin: string | null;
          reconciliationNeeded: boolean;
          orphaned: boolean;
        }> = [];
        for (const site of userSites) {
          const files = await fs.promises.readdir(path.join(USER_CLIS, site));
          for (const file of files.filter((entry) => entry.endsWith('.js')).sort()) {
            const command = `${site}/${file.slice(0, -3)}`;
            const record = records[command];
            adapters.push(record
              ? {
                  command,
                  kind: 'override',
                  plugin: record.plugin,
                  reconciliationNeeded: reconcile.has(command),
                  orphaned: !fs.existsSync(path.join(pluginsDir, record.plugin)),
                }
              : { command, kind: 'user', plugin: null, reconciliationNeeded: false, orphaned: false });
          }
        }
        if (opts.format === 'json') {
          renderOutput(adapters, {
            fmt: 'json',
            columns: ['command', 'kind', 'plugin', 'reconciliationNeeded', 'orphaned'],
            title: `${CLI_COMMAND}/adapter-status`,
            source: `${CLI_COMMAND} adapter status`,
          });
          return;
        }
        console.log(`Local adapters in ~/.webcmd/clis/ (${userSites.length} sites):\n`);
        for (const site of userSites) {
          console.log(`  ${site}`);
          for (const adapter of adapters.filter((item) => item.command.startsWith(`${site}/`))) {
            if (adapter.kind === 'user') {
              console.log(`    user adapter: ${adapter.command}`);
            } else if (adapter.orphaned) {
              console.log(`    orphaned override: ${adapter.command} (plugin ${adapter.plugin} is not installed)`);
            } else {
              console.log(`    override: ${adapter.command} (plugin ${adapter.plugin}${adapter.reconciliationNeeded ? ', upstream changed since fork' : ''})`);
            }
          }
        }
      } catch (err) {
        if (!userClisListed && (err as NodeJS.ErrnoException).code === 'ENOENT') {
          if (opts.format === 'json') renderOutput([], { fmt: 'json' });
          else console.log('No local adapters installed.');
          return;
        }
        console.error(`Error: ${getErrorMessage(err)}`);
        process.exitCode = EXIT_CODES.GENERIC_ERROR;
      }
    });

  adapterCmd
    .command('reset')
    .description('Remove a local adapter override')
    .argument('[site]', 'Site name (e.g. twitter, youtube)')
    .option('--all', 'Reset all local overrides')
    .action(async (site: string | undefined, opts: { all?: boolean }) => {
      if (opts.all) {
        let userClisListed = false;
        try {
          const userEntries = await fs.promises.readdir(USER_CLIS, { withFileTypes: true });
          userClisListed = true;
          const dirs = userEntries.filter(e => e.isDirectory() && e.name !== '.base');
          readOverrideRecords();
          if (dirs.length === 0) {
            console.log('No local sites to reset.');
            return;
          }
          let removedRecords = 0;
          for (const dir of dirs) {
            fs.rmSync(path.join(USER_CLIS, dir.name), { recursive: true, force: true });
            removedRecords += removeOverrideRecords(dir.name).length;
          }
          console.log(`✅ Removed ${dirs.length} local adapter override(s) and ${removedRecords} provenance record(s).`);
        } catch (err) {
          if (!userClisListed && (err as NodeJS.ErrnoException).code === 'ENOENT') console.log('No local sites to reset.');
          else {
            console.error(`Error: ${getErrorMessage(err)}`);
            process.exitCode = EXIT_CODES.GENERIC_ERROR;
          }
        }
        return;
      }

      if (!site) {
        console.error('Error: Please specify a site name or use --all.');
        process.exitCode = EXIT_CODES.USAGE_ERROR;
        return;
      }

      const userSiteDir = path.join(USER_CLIS, site);
      try {
        await fs.promises.access(userSiteDir);
      } catch {
        console.error(`Site "${site}" has no local override.`);
        return;
      }

      fs.rmSync(userSiteDir, { recursive: true, force: true });
      const removedRecords = removeOverrideRecords(site).length;
      console.log(`✅ Removed local adapter override "${site}" and ${removedRecords} provenance record(s).`);
    });

  adapterCmd
    .command('override')
    .description('Fork an installed plugin command into ~/.webcmd/clis so you can modify it')
    .argument('<command>', 'Command to override, as <site>/<command>')
    .action(handleAdapterOverride);

  // ── Built-in: browser profile selection ──────────────────────────────────
  const profileCmd = program.command('profile').description('Manage webcmd browser runtime profiles');
  // Snapshot before applyRootSubcommandSummaries() rewrites .description() to a child-name listing.
  const originalProfileDescription = profileCmd.description();

  profileCmd
    .command('list')
    .description('List Chrome and Chromium profiles available through the Cloak runtime')
    .action(async () => {
      const status = await fetchDaemonStatus();
      const config = loadProfileConfig();
      const profiles = status?.profiles ?? [];
      if (!status) {
        console.log('Daemon is not running. Run webcmd doctor after opening Chrome.');
        return;
      }
      if (isDaemonStale(status, PKG_VERSION) || !Array.isArray(status.profiles)) {
        console.log(`Daemon ${formatDaemonVersion(status)} is stale for CLI v${PKG_VERSION}.`);
        console.log('Run: webcmd daemon restart');
        return;
      }
      if (profiles.length === 0) {
        console.log('No Cloak runtime profiles are active.');
        console.log('Run a browser-backed command or webcmd <site> login to create one.');
        return;
      }

      const knownContextIds = new Set(profiles.map((profile) => profile.contextId));
      console.log('Available Cloak profiles');
      console.log();
      for (const profile of profiles) {
        const alias = aliasForContextId(config, profile.contextId);
        const defaultMark = config.defaultContextId === profile.contextId ? ' default' : '';
        const aliasText = alias ? ` ${alias}` : '';
        const version = profile.runtimeVersion ? ` v${profile.runtimeVersion}` : ' version unknown';
        console.log(`  ${profile.contextId}${aliasText}${defaultMark} — connected${version}`);
      }

      const disconnectedAliases = Object.entries(config.aliases)
        .filter(([, contextId]) => !knownContextIds.has(contextId));
      if (disconnectedAliases.length > 0 || (config.defaultContextId && !knownContextIds.has(config.defaultContextId))) {
        console.log();
        console.log('Disconnected saved profiles:');
        const shown = new Set<string>();
        for (const [alias, contextId] of disconnectedAliases) {
          shown.add(contextId);
          console.log(`  ${contextId} ${alias} — not connected`);
        }
        if (config.defaultContextId && !shown.has(config.defaultContextId) && !knownContextIds.has(config.defaultContextId)) {
          console.log(`  ${config.defaultContextId} — default, not connected`);
        }
      }
    });

  profileCmd
    .command('rename')
    .description('Assign a local alias to an available Cloak profile')
    .argument('<contextId>', 'Profile contextId from webcmd profile list')
    .argument('<alias>', 'Local alias, e.g. work or personal')
    .action((contextId: string, alias: string) => {
      try {
        renameProfile(contextId, alias);
        console.log(`Profile ${contextId} is now aliased as ${alias}.`);
      } catch (err) {
        console.error(`Error: ${getErrorMessage(err)}`);
        process.exitCode = EXIT_CODES.USAGE_ERROR;
      }
    });

  profileCmd
    .command('use')
    .description('Set the default Cloak profile for future commands')
    .argument('<profile>', 'Profile alias or contextId')
    .action((profile: string) => {
      try {
        const config = setDefaultProfile(profile);
        console.log(`Default Cloak profile: ${config.defaultContextId ?? profile}`);
      } catch (err) {
        console.error(`Error: ${getErrorMessage(err)}`);
        process.exitCode = EXIT_CODES.USAGE_ERROR;
      }
    });

  // ── Built-in: daemon ──────────────────────────────────────────────────────
  const daemonCmd = program.command('daemon').description('Manage the webcmd daemon');
  // Snapshot before applyRootSubcommandSummaries() rewrites .description() to a child-name listing.
  const originalDaemonDescription = daemonCmd.description();
  daemonCmd
    .command('status')
    .description('Show daemon status')
    .action(async () => { await daemonStatus(); });
  daemonCmd
    .command('stop')
    .description('Stop the daemon')
    .action(async () => { await daemonStop(); });
  daemonCmd
    .command('restart')
    .description('Restart the daemon')
    .action(async () => { await daemonRestart(); });

  // ── External CLIs ─────────────────────────────────────────────────────────

  const externalClis = loadExternalClis();

  const externalCmd = program
    .command('external')
    .description('Manage external CLI passthrough commands');

  externalCmd
    .command('install')
    .description('Install an external CLI')
    .argument('<name>', 'Name of the external CLI')
    .action((name: string) => {
      const ext = externalClis.find(e => e.name === name);
      if (!ext) {
        console.error(`External CLI '${name}' not found in registry.`);
        process.exitCode = EXIT_CODES.USAGE_ERROR;
        return;
      }
      installExternalCli(ext);
    });

  externalCmd
    .command('register')
    .description('Register an external CLI')
    .argument('<name>', 'Name of the CLI')
    .option('--binary <bin>', 'Binary name if different from name')
    .option('--install <cmd>', 'Auto-install command')
    .option('--desc <text>', 'Description')
    .action((name, opts) => {
      registerExternalCli(name, { binary: opts.binary, install: opts.install, description: opts.desc });
    });

  externalCmd
    .command('list')
    .description('List registered external CLIs')
    .option('-f, --format <fmt>', 'Output format: table, json, yaml, md, csv', 'table')
    .action((opts) => {
      const rows = loadExternalClis().map((ext) => ({
        name: ext.name,
        package: ext.package ?? '',
        binary: ext.binary,
        installed: isBinaryInstalled(ext.binary),
        description: ext.description ?? '',
        homepage: ext.homepage ?? '',
        tags: ext.tags?.join(', ') ?? '',
      }));
      renderOutput(rows, {
        fmt: opts.format,
        columns: ['name', 'package', 'binary', 'installed', 'description', 'homepage', 'tags'],
        title: 'webcmd/external/list',
        source: 'webcmd external list',
      });
    });

  function passthroughExternal(name: string, parsedArgs?: string[]) {
    const args = parsedArgs ?? (() => {
      const idx = process.argv.indexOf(name);
      return process.argv.slice(idx + 1);
    })();
    try {
      executeExternalCli(name, args, externalClis);
    } catch (err) {
      console.error(`Error: ${getErrorMessage(err)}`);
      process.exitCode = EXIT_CODES.GENERIC_ERROR;
    }
  }

  for (const ext of externalClis) {
    if (program.commands.some(c => c.name() === ext.name)) continue;
    program
      .command(ext.name)
      .description(`(External) ${ext.description || ext.name}`)
      .argument('[args...]')
      .allowUnknownOption()
      .passThroughOptions()
      .helpOption(false)
      .action((args: string[]) => passthroughExternal(ext.name, args));
  }

  // ── Antigravity serve (long-running, special case) ────────────────────────

  const siteGroups = new Map<string, Command>();
  if (fs.existsSync(path.join(pluginsDir, 'antigravity', 'serve.js'))) {
    const antigravityCmd = program.command('antigravity').description('antigravity commands');
    antigravityCmd
      .command('serve')
      .description('Start Anthropic-compatible API proxy for Antigravity')
      .option('--port <port>', 'Server port (default: 8082)', '8082')
      .option('--timeout <seconds>', 'Maximum time to wait for a reply (default: 120s)')
      .action(async (opts) => {
        const { startServe } = await loadAntigravityServe(pluginsDir);
        await startServe({
          port: parseInt(opts.port, 10),
          timeout: opts.timeout ? parsePositiveIntOption(opts.timeout, '--timeout', 120) : undefined,
        });
      });
    siteGroups.set('antigravity', antigravityCmd);
  }

  // ── Dynamic adapter commands ──────────────────────────────────────────────

  const siteNames = registerAllCommands(program, siteGroups);
  applyRootSubcommandSummaries(program);

  // ── Help-text grouping: External CLIs / App adapters / Site adapters ──
  // Classification derives from each adapter's `domain` field — see classifyAdapter.
  // External CLIs are taken from the externalClis registry (passthrough binaries).
  const externalNames = externalClis.map(ext => ext.name);
  const externalHelpEntries = externalClis.map(ext => ({
    name: ext.name,
    label: formatExternalCliLabel(ext),
  }));
  const siteDomains = new Map<string, string | undefined>();
  for (const [, cmd] of getRegistry()) {
    if (!siteDomains.has(cmd.site)) siteDomains.set(cmd.site, cmd.domain);
  }
  const apps: string[] = [];
  const sites: string[] = [];
  for (const site of siteNames) {
    if (classifyAdapter(siteDomains.get(site)) === 'app') apps.push(site);
    else sites.push(site);
  }
  const adapterGroups: RootAdapterGroups = { external: externalHelpEntries, apps, sites };
  const adapterNameSet = new Set<string>([...externalNames, ...siteNames]);
  installCommanderNamespaceStructuredHelp(browser, { globalCommand: program, description: originalBrowserDescription });
  installCommanderNamespaceStructuredHelp(authCmd, { globalCommand: program, description: 'Inspect website login status' });
  installCommanderNamespaceStructuredHelp(daemonCmd, { globalCommand: program, description: originalDaemonDescription });
  installCommanderNamespaceStructuredHelp(pluginCmd, { globalCommand: program, description: originalPluginDescription });
  installCommanderNamespaceStructuredHelp(adapterCmd, { globalCommand: program, description: originalAdapterDescription });
  installCommanderNamespaceStructuredHelp(profileCmd, { globalCommand: program, description: originalProfileDescription });
  program.configureHelp({
    visibleCommands: (command) => command.commands.filter(child => command !== program || !adapterNameSet.has(child.name())),
  });
  installRootPresentationHelp(
    program,
    () => rootHelpData(program, adapterGroups),
    buildRootHelpPresentation(program, adapterGroups),
  );

  // ── Unknown command fallback ──────────────────────────────────────────────
  // Security: do NOT auto-discover and register arbitrary system binaries.
  // Only explicitly registered external CLIs are allowed.

  program.on('command:*', (operands: string[]) => {
    const binary = operands[0]!;
    console.error(missingPluginGuidance(binary));
    program.outputHelp();
    process.exitCode = EXIT_CODES.USAGE_ERROR;
  });

  return program;
}

export async function loadAntigravityServe(pluginsDir: string = PLUGINS_DIR): Promise<{
  startServe(options: { port: number; timeout?: number }): Promise<void>;
}> {
  return import(pathToFileURL(path.join(pluginsDir, 'antigravity', 'serve.js')).href);
}

export function runCli(BUILTIN_CLIS: string, USER_CLIS: string): void {
  createProgram(BUILTIN_CLIS, USER_CLIS).parse();
}

// ── Helpers ─────────────────────────────────────────────────────────────────

export interface BrowserVerifyInvocation {
  binary: string;
  args: string[];
  cwd: string;
  shell?: boolean;
}

export { findPackageRoot };

export function resolveBrowserVerifyInvocation(opts: {
  projectRoot?: string;
  platform?: NodeJS.Platform;
  fileExists?: (path: string) => boolean;
  readFile?: (path: string) => string;
} = {}): BrowserVerifyInvocation {
  const platform = opts.platform ?? process.platform;
  const fileExists = opts.fileExists ?? fs.existsSync;
  const readFile = opts.readFile ?? ((filePath: string) => fs.readFileSync(filePath, 'utf-8'));
  const projectRoot = opts.projectRoot ?? findPackageRoot(CLI_FILE, fileExists);

  for (const builtEntry of getBuiltEntryCandidates(projectRoot, readFile)) {
    if (fileExists(builtEntry)) {
      return {
        binary: process.execPath,
        args: [builtEntry],
        cwd: projectRoot,
      };
    }
  }

  const sourceEntry = path.join(projectRoot, 'src', 'main.ts');
  if (!fileExists(sourceEntry)) {
    throw new Error(`Could not find webcmd entrypoint under ${projectRoot}. Expected built entry from package.json or src/main.ts.`);
  }

  const localTsxBin = path.join(projectRoot, 'node_modules', '.bin', platform === 'win32' ? 'tsx.cmd' : 'tsx');
  if (fileExists(localTsxBin)) {
    return {
      binary: localTsxBin,
      args: [sourceEntry],
      cwd: projectRoot,
      ...(platform === 'win32' ? { shell: true } : {}),
    };
  }

  return {
    binary: platform === 'win32' ? 'npx.cmd' : 'npx',
    args: ['tsx', sourceEntry],
    cwd: projectRoot,
    ...(platform === 'win32' ? { shell: true } : {}),
  };
}
