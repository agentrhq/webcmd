import * as fs from 'node:fs';
import * as path from 'node:path';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from './errors.js';
import { cli, Strategy, type CommandArgs, type CliOptions } from './registry-api.js';
import type { IPage } from './types.js';

export function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(Math.floor(parsed), max)) : fallback;
}

export function requireNonEmptyQuery(value: unknown, label = 'query'): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new ArgumentError(`${label} cannot be empty`);
  return normalized;
}

export function requireSearchQuery(value: unknown, label = 'keyword'): string {
  const query = String(value ?? '').trim();
  if (!query) throw new ArgumentError(`${label} cannot be empty`);
  return query;
}

export function requireBoundedInteger(
  value: unknown,
  defaultValue: number,
  min: number,
  max: number,
  label: string,
): number {
  const raw = value ?? defaultValue;
  const parsed = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(parsed)) {
    throw new ArgumentError(`${label} must be an integer between ${min} and ${max}, got ${JSON.stringify(value)}`);
  }
  if (parsed < min || parsed > max) {
    throw new ArgumentError(`${label} must be between ${min} and ${max}, got ${parsed}`);
  }
  return parsed;
}

export function requireNonNegativeInteger(value: unknown, defaultValue: number, label: string): number {
  const raw = value ?? defaultValue;
  const parsed = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new ArgumentError(`${label} must be a non-negative integer, got ${JSON.stringify(value)}`);
  }
  return parsed;
}

export function unwrapBrowserResult(value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value) && 'session' in value && 'data' in value) {
    return value.data;
  }
  return value;
}

export function requireRows(value: unknown, label: string): unknown[] {
  const rows = unwrapBrowserResult(value);
  if (!Array.isArray(rows)) {
    throw new CommandExecutionError(`${label} returned an unexpected payload shape; expected an array of result rows.`);
  }
  return rows;
}

export function toHttpsUrl(value: unknown, baseUrl: string): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw, baseUrl);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

export function emptySearchResults(site: string, query: string): EmptyResultError {
  return new EmptyResultError(`${site} search`, `No ${site} results matched "${query}".`);
}

export async function runBrowserStep<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const typedError = error as { code?: unknown; name?: string } | undefined;
    if (typedError?.code || typedError?.name === 'ArgumentError') throw error;
    throw new CommandExecutionError(`${label} failed: ${(error as { message?: unknown } | null)?.message ?? error}`);
  }
}

type DesktopCommandExtra = Partial<Omit<CliOptions, 'site' | 'name' | 'access' | 'description' | 'strategy' | 'browser' | 'args' | 'columns' | 'func'>>;

export function makeScreenshotCommand(site: string, displayName?: string, extra: DesktopCommandExtra = {}) {
  const label = displayName ?? site;
  return cli({
    ...extra,
    site,
    name: 'screenshot',
    access: 'read',
    description: `Capture a snapshot of the current ${label} window (DOM + Accessibility tree)`,
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [{ name: 'output', required: false, help: `Output file path (default: /tmp/${site}-snapshot.txt)` }],
    columns: ['Status', 'File'],
    func: async (page: IPage, kwargs: CommandArgs) => {
      const outputPath = kwargs.output || `/tmp/${site}-snapshot.txt`;
      const snap = await page.snapshot({ compact: true });
      const html = await page.evaluate('document.documentElement.outerHTML');
      const htmlPath = String(outputPath).replace(/\.\w+$/, '') + '-dom.html';
      const snapPath = String(outputPath).replace(/\.\w+$/, '') + '-a11y.txt';
      fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
      fs.mkdirSync(path.dirname(snapPath), { recursive: true });
      fs.writeFileSync(htmlPath, html);
      fs.writeFileSync(snapPath, typeof snap === 'string' ? snap : JSON.stringify(snap, null, 2));
      return [{ Status: 'Success', File: htmlPath }, { Status: 'Success', File: snapPath }];
    },
  });
}

export function makeStatusCommand(site: string, displayName?: string, extra: DesktopCommandExtra = {}) {
  const label = displayName ?? site;
  return cli({
    ...extra,
    site,
    name: 'status',
    access: 'read',
    description: `Check active CDP connection to ${label}`,
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [],
    columns: ['Status', 'Url', 'Title'],
    func: async (page: IPage) => [{
      Status: 'Connected',
      Url: await page.evaluate('window.location.href'),
      Title: await page.evaluate('document.title'),
    }],
  });
}

export function makeNewCommand(site: string, displayName?: string, extra: DesktopCommandExtra = {}) {
  const label = displayName ?? site;
  return cli({
    ...extra,
    site,
    name: 'new',
    access: 'write',
    description: `Start a new ${label} session`,
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [],
    columns: ['Status'],
    func: async (page: IPage) => {
      await page.pressKey(process.platform === 'darwin' ? 'Meta+N' : 'Control+N');
      await page.wait(1);
      return [{ Status: 'Success' }];
    },
  });
}

export function makeDumpCommand(site: string) {
  return cli({
    site,
    name: 'dump',
    access: 'read',
    description: `Dump the DOM and Accessibility tree of ${site} for reverse-engineering`,
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [],
    columns: ['action', 'files'],
    func: async (page: IPage) => {
      const domPath = `/tmp/${site}-dom.html`;
      const snapPath = `/tmp/${site}-snapshot.json`;
      fs.mkdirSync(path.dirname(domPath), { recursive: true });
      fs.mkdirSync(path.dirname(snapPath), { recursive: true });
      fs.writeFileSync(domPath, await page.evaluate('document.body.innerHTML'));
      fs.writeFileSync(snapPath, JSON.stringify(await page.snapshot({ interactive: false }), null, 2));
      return [{ action: 'Dom extraction finished', files: `${domPath}, ${snapPath}` }];
    },
  });
}

type Identity = Record<string, unknown>;
type MaybePromise<T> = T | Promise<T>;
export interface SiteAuthConfig {
  site: string;
  domain: string;
  loginUrl: string;
  verify: (page: IPage, context: { phase: 'identity' }) => MaybePromise<unknown>;
  columns?: string[];
  registerWhoami?: boolean;
  whoamiDescription?: string;
  whoamiAliases?: string[];
  loginDescription?: string;
  openLogin?: (page: IPage) => MaybePromise<void>;
  quickCheck?: (page: IPage) => MaybePromise<unknown>;
  refresh?: (page: IPage, kwargs: CommandArgs) => MaybePromise<unknown>;
}

const LOGIN_ACTION = 'Complete sign-in in the opened Webcmd browser, then tell the agent when you are done.';

function identityColumns(config: SiteAuthConfig): string[] {
  return config.columns ?? ['id', 'username', 'name'];
}

function blankIdentity(config: SiteAuthConfig): Identity {
  return Object.fromEntries(identityColumns(config).map((column) => [column, '']));
}

function normalizeIdentity(config: SiteAuthConfig, identity: unknown): Identity {
  const row = identity && typeof identity === 'object' && !Array.isArray(identity) ? identity : {};
  return { ...blankIdentity(config), ...row, logged_in: true, site: config.site };
}

function commandColumns(config: SiteAuthConfig): string[] {
  return ['logged_in', 'site', ...identityColumns(config)];
}

function loginColumns(config: SiteAuthConfig): string[] {
  return ['status', ...commandColumns(config), 'action', 'verify_command'];
}

function normalizeQuickCheck(result: unknown): Identity {
  if (typeof result === 'boolean') return { logged_in: result };
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const row = result as Identity;
    return { logged_in: !!row.logged_in, ...row };
  }
  return { logged_in: false };
}

function normalizeRefreshResult(result: unknown): Identity {
  return result && typeof result === 'object' && !Array.isArray(result) ? result as Identity : { touched: true };
}

export function registerSiteAuthCommands(config: SiteAuthConfig): void {
  if (!config?.site || !config?.domain || !config?.loginUrl || typeof config.verify !== 'function') {
    throw new Error('registerSiteAuthCommands requires site, domain, loginUrl, and verify(page)');
  }
  const openLogin = typeof config.openLogin === 'function'
    ? config.openLogin
    : async (page: IPage) => { await page.goto(config.loginUrl); };
  const tryProbe = async (page: IPage) => normalizeIdentity(config, await config.verify(page, { phase: 'identity' }));
  const quickCheck = config.quickCheck;
  const refresh = config.refresh;

  if (config.registerWhoami !== false) {
    cli({
      site: config.site,
      name: 'whoami',
      access: 'read',
      description: config.whoamiDescription ?? `Show the current logged-in ${config.site} account`,
      domain: config.domain,
      strategy: Strategy.COOKIE,
      browser: true,
      navigateBefore: false,
      siteSession: 'persistent',
      aliases: config.whoamiAliases ?? [],
      args: [],
      columns: commandColumns(config),
      authStatus: {
        ...(typeof quickCheck === 'function'
          ? { quickCheck: async (page) => normalizeQuickCheck(await quickCheck(page)) }
          : {}),
        ...(typeof refresh === 'function'
          ? { refresh: async (page, kwargs) => normalizeRefreshResult(await refresh(page, kwargs)) }
          : {}),
      },
      func: async (page) => [await tryProbe(page)],
    });
  }

  cli({
    site: config.site,
    name: 'login',
    access: 'write',
    description: config.loginDescription ?? `Open ${config.site} login`,
    domain: config.domain,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    siteSession: 'persistent',
    args: [],
    columns: loginColumns(config),
    func: async (page) => {
      try {
        return [{ status: 'already_logged_in', ...await tryProbe(page), action: '', verify_command: '' }];
      } catch (error) {
        if (!(error instanceof AuthRequiredError)) throw error;
      }
      await openLogin(page);
      return [{
        status: 'action_required',
        logged_in: false,
        site: config.site,
        ...blankIdentity(config),
        action: LOGIN_ACTION,
        verify_command: `webcmd ${config.site} whoami`,
      }];
    },
  });
}
