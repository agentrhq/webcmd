import fs from 'node:fs';
import { execFile } from 'node:child_process';
import type { BrowserContext, Page as PlaywrightPage } from 'playwright-core';
import { launchPersistentContext as cloakLaunchPersistentContext } from 'cloakbrowser';
import type { BrowserSurface, SiteSessionMode } from '../../protocol.js';
import { normalizeProfileId, resolveCloakProfileDir } from './profiles.js';
import { CloakNetworkCapture } from './network.js';

export type LaunchPersistentContext = typeof cloakLaunchPersistentContext;
export type RecoverLockedProfile = (userDataDir: string) => Promise<boolean>;

export interface SessionKeyInput {
  profileId?: string;
  session?: string;
  surface?: BrowserSurface;
  siteSession?: SiteSessionMode;
  idleTimeout?: number;
  /** Discard the existing leased page (if any) and create a new one under the same lease. */
  freshPage?: boolean;
}

type PageEntry = {
  page: PlaywrightPage;
  pageId: string;
  session: string;
  surface: BrowserSurface;
  siteSession?: SiteSessionMode;
  idleTimeout?: number;
  idleTimer?: ReturnType<typeof setTimeout>;
};

export interface CloakPageLease {
  profileId: string;
  leaseKey: string;
  context: BrowserContext;
  page: PlaywrightPage;
  pageId: string;
}

export interface CloakTabInfo {
  id: string;
  page: string;
  index: number;
  title: string;
  url: string;
  profileId: string;
  session: string;
  surface: BrowserSurface;
  selected: boolean;
}

interface ProfileRuntime {
  context: BrowserContext;
  pages: Map<string, PageEntry>;
  selectedPageId?: string;
  runtimeVersion?: string;
  lastSeenAt: number;
}

export interface CloakSessionManagerOptions {
  baseDir?: string;
  launchPersistentContext?: LaunchPersistentContext;
  recoverLockedProfile?: RecoverLockedProfile;
}

let pageCounter = 0;

export function resolveLeaseKey(input: SessionKeyInput): string {
  const surface = input.surface === 'adapter' ? 'adapter' : 'browser';
  const session = input.session?.trim();
  if (!session) throw new Error('Browser session is required.');
  return `${surface}\u0000${encodeURIComponent(session)}`;
}

function pageIsClosed(page: PlaywrightPage): boolean {
  return page.isClosed?.() === true;
}

export class CloakSessionManager {
  readonly networkCapture = new CloakNetworkCapture();

  private readonly launchPersistentContext: LaunchPersistentContext;
  private readonly recoverLockedProfile: RecoverLockedProfile;
  private readonly profiles = new Map<string, ProfileRuntime>();
  private readonly profileLaunches = new Map<string, Promise<ProfileRuntime>>();

  constructor(private readonly opts: CloakSessionManagerOptions = {}) {
    this.launchPersistentContext = opts.launchPersistentContext ?? cloakLaunchPersistentContext;
    this.recoverLockedProfile = opts.recoverLockedProfile ?? recoverLockedCloakProfile;
  }

  profileStatuses() {
    return [...this.profiles.entries()].map(([contextId, runtime]) => ({
      contextId,
      runtimeConnected: true,
      runtimeVersion: runtime.runtimeVersion,
      pending: 0,
      lastSeenAt: runtime.lastSeenAt,
    }));
  }

  activeProfileIds(): string[] {
    return [...this.profiles.keys()];
  }

  async getPage(input: SessionKeyInput): Promise<CloakPageLease> {
    const profileId = normalizeProfileId(input.profileId);
    const session = requireSession(input.session);
    const surface = normalizeSurface(input.surface);
    const leaseKey = resolveLeaseKey(input);
    const runtime = await this.getProfileRuntime(profileId);
    const freshPage = input.freshPage === true;
    const existing = runtime.pages.get(leaseKey);
    if (existing && !pageIsClosed(existing.page) && !freshPage) {
      runtime.lastSeenAt = Date.now();
      existing.idleTimeout = input.idleTimeout;
      this.refreshIdleTimer(runtime, leaseKey, existing);
      return { profileId, leaseKey, context: runtime.context, page: existing.page, pageId: existing.pageId };
    }
    if (existing && freshPage) {
      runtime.pages.delete(leaseKey);
      this.clearIdleTimer(existing);
      if (runtime.selectedPageId === existing.pageId) runtime.selectedPageId = undefined;
      if (!pageIsClosed(existing.page)) await existing.page.close().catch(() => {});
    }

    const existingPages = runtime.context.pages();
    // freshPage must never adopt a leftover tab — its whole point is a clean DOM.
    const page = !freshPage && existingPages[0] && runtime.pages.size === 0 ? existingPages[0] : await runtime.context.newPage();
    const pageId = nextPageId();
    const entry: PageEntry = { page, pageId, session, surface, siteSession: input.siteSession, idleTimeout: input.idleTimeout };
    runtime.pages.set(leaseKey, entry);
    this.refreshIdleTimer(runtime, leaseKey, entry);
    runtime.selectedPageId = pageId;
    runtime.lastSeenAt = Date.now();
    return { profileId, leaseKey, context: runtime.context, page, pageId };
  }

  findPageById(pageId: string, opts: Pick<SessionKeyInput, 'idleTimeout'> = {}): CloakPageLease | null {
    for (const [profileId, runtime] of this.profiles.entries()) {
      for (const [leaseKey, entry] of runtime.pages.entries()) {
        if (entry.pageId === pageId && !pageIsClosed(entry.page)) {
          entry.idleTimeout = opts.idleTimeout;
          this.refreshIdleTimer(runtime, leaseKey, entry);
          return { profileId, leaseKey, context: runtime.context, page: entry.page, pageId: entry.pageId };
        }
      }
    }
    return null;
  }

  pageIdFor(page: PlaywrightPage): string | undefined {
    for (const runtime of this.profiles.values()) {
      for (const entry of runtime.pages.values()) {
        if (entry.page === page) return entry.pageId;
      }
    }
    return undefined;
  }

  registerPage(input: SessionKeyInput, page: PlaywrightPage): string {
    const profileId = normalizeProfileId(input.profileId);
    const session = requireSession(input.session);
    const surface = normalizeSurface(input.surface);
    const runtime = this.profiles.get(profileId);
    if (!runtime) throw new Error(`Profile ${profileId} is not running`);
    const pageId = nextPageId();
    const leaseKey = `${resolveLeaseKey(input)}\u0000${pageId}`;
    const entry: PageEntry = { page, pageId, session, surface, siteSession: input.siteSession, idleTimeout: input.idleTimeout };
    runtime.pages.set(leaseKey, entry);
    this.refreshIdleTimer(runtime, leaseKey, entry);
    runtime.selectedPageId = pageId;
    runtime.lastSeenAt = Date.now();
    return pageId;
  }

  async listPages(input: Pick<SessionKeyInput, 'profileId'>): Promise<CloakTabInfo[]> {
    const profileId = normalizeProfileId(input.profileId);
    const runtime = this.profiles.get(profileId);
    if (!runtime) return [];
    const entries = this.openEntries(runtime);
    return Promise.all(entries.map(async ([, entry], index) => ({
      id: entry.pageId,
      page: entry.pageId,
      index,
      title: await entry.page.title().catch(() => ''),
      url: entry.page.url(),
      profileId,
      session: entry.session,
      surface: entry.surface,
      selected: runtime.selectedPageId === entry.pageId,
    })));
  }

  async newPage(input: SessionKeyInput & { url?: string }): Promise<CloakPageLease> {
    const profileId = normalizeProfileId(input.profileId);
    const session = requireSession(input.session);
    const surface = normalizeSurface(input.surface);
    const runtime = await this.getProfileRuntime(profileId);
    const page = await runtime.context.newPage();
    if (input.url) {
      await page.goto(input.url, { waitUntil: 'load' });
    }
    const pageId = nextPageId();
    const leaseKey = `${resolveLeaseKey(input)}\u0000${pageId}`;
    const entry: PageEntry = { page, pageId, session, surface, siteSession: input.siteSession, idleTimeout: input.idleTimeout };
    runtime.pages.set(leaseKey, entry);
    this.refreshIdleTimer(runtime, leaseKey, entry);
    runtime.lastSeenAt = Date.now();
    return { profileId, leaseKey, context: runtime.context, page, pageId };
  }

  async selectPage(input: Pick<SessionKeyInput, 'profileId'> & { pageId?: string; index?: number }): Promise<CloakPageLease | null> {
    const profileId = normalizeProfileId(input.profileId);
    const runtime = this.profiles.get(profileId);
    if (!runtime) return null;
    const match = input.pageId ? this.findEntryByPageId(runtime, input.pageId) : this.openEntries(runtime)[input.index ?? -1];
    if (!match) return null;
    const [leaseKey, entry] = match;
    await entry.page.bringToFront?.().catch(() => {});
    runtime.selectedPageId = entry.pageId;
    runtime.lastSeenAt = Date.now();
    return { profileId, leaseKey, context: runtime.context, page: entry.page, pageId: entry.pageId };
  }

  async bindPage(input: SessionKeyInput & { pageId?: string; index?: number }): Promise<CloakPageLease | null> {
    const profileId = normalizeProfileId(input.profileId);
    const session = requireSession(input.session);
    const surface = normalizeSurface(input.surface);
    const runtime = this.profiles.get(profileId);
    if (!runtime) return null;

    const match = input.pageId ? this.findEntryByPageId(runtime, input.pageId) : this.openEntries(runtime)[input.index ?? -1];
    if (!match) return null;

    const [sourceKey, entry] = match;
    const canonicalKey = resolveLeaseKey({ profileId, session, surface });
    const currentCanonical = runtime.pages.get(canonicalKey);

    if (currentCanonical && currentCanonical !== entry && !pageIsClosed(currentCanonical.page)) {
      const preservedKey = `${canonicalKey}\u0000${currentCanonical.pageId}`;
      runtime.pages.delete(canonicalKey);
      runtime.pages.set(preservedKey, currentCanonical);
      this.refreshIdleTimer(runtime, preservedKey, currentCanonical);
    }

    if (sourceKey !== canonicalKey) runtime.pages.delete(sourceKey);
    entry.session = session;
    entry.surface = surface;
    entry.siteSession = input.siteSession;
    entry.idleTimeout = input.idleTimeout;
    runtime.pages.set(canonicalKey, entry);
    await entry.page.bringToFront?.().catch(() => {});
    this.refreshIdleTimer(runtime, canonicalKey, entry);
    runtime.selectedPageId = entry.pageId;
    runtime.lastSeenAt = Date.now();
    return { profileId, leaseKey: canonicalKey, context: runtime.context, page: entry.page, pageId: entry.pageId };
  }

  async closePage(input: Pick<SessionKeyInput, 'profileId'> & { pageId?: string; index?: number }): Promise<string | null> {
    const profileId = normalizeProfileId(input.profileId);
    const runtime = this.profiles.get(profileId);
    if (!runtime) return null;
    const match = input.pageId ? this.findEntryByPageId(runtime, input.pageId) : this.openEntries(runtime)[input.index ?? -1];
    if (!match) return null;
    const [leaseKey, entry] = match;
    runtime.pages.delete(leaseKey);
    this.clearIdleTimer(entry);
    if (runtime.selectedPageId === entry.pageId) runtime.selectedPageId = undefined;
    if (!pageIsClosed(entry.page)) await entry.page.close().catch(() => {});
    runtime.lastSeenAt = Date.now();
    return entry.pageId;
  }

  async release(input: SessionKeyInput): Promise<void> {
    const profileId = normalizeProfileId(input.profileId);
    const runtime = this.profiles.get(profileId);
    if (!runtime) return;
    const leaseKey = resolveLeaseKey(input);
    const exactEntry = runtime.pages.get(leaseKey);
    const entries = exactEntry
      ? [[leaseKey, exactEntry] as const]
      : this.openEntries(runtime).filter(([, entry]) => entry.session === requireSession(input.session) && entry.surface === normalizeSurface(input.surface));
    for (const [key, entry] of entries) {
      runtime.pages.delete(key);
      this.clearIdleTimer(entry);
      if (runtime.selectedPageId === entry.pageId) runtime.selectedPageId = undefined;
      if (entry.siteSession !== 'persistent' && !pageIsClosed(entry.page)) {
        await entry.page.close().catch(() => {});
      }
    }
  }

  async shutdown(): Promise<void> {
    for (const runtime of this.profiles.values()) {
      for (const entry of runtime.pages.values()) this.clearIdleTimer(entry);
      await runtime.context.close().catch(() => {});
    }
    this.profiles.clear();
  }

  private async getProfileRuntime(profileId: string): Promise<ProfileRuntime> {
    const existing = this.profiles.get(profileId);
    if (existing) return existing;
    const pending = this.profileLaunches.get(profileId);
    if (pending) return pending;

    const launch = this.launchProfileRuntime(profileId);
    this.profileLaunches.set(profileId, launch);
    try {
      return await launch;
    } finally {
      this.profileLaunches.delete(profileId);
    }
  }

  private async launchProfileRuntime(profileId: string): Promise<ProfileRuntime> {
    const userDataDir = resolveCloakProfileDir(profileId, { baseDir: this.opts.baseDir });
    fs.mkdirSync(userDataDir, { recursive: true });
    const launchOptions = {
      userDataDir,
      headless: false,
      humanize: true,
    };
    let context: BrowserContext;
    try {
      context = await this.launchPersistentContext(launchOptions);
    } catch (err) {
      if (!isProfileAlreadyInUseError(err) || !(await this.recoverLockedProfile(userDataDir))) throw err;
      context = await this.launchPersistentContext(launchOptions);
    }
    const runtime = { context, pages: new Map(), lastSeenAt: Date.now() };
    this.profiles.set(profileId, runtime);
    return runtime;
  }

  private openEntries(runtime: ProfileRuntime): [string, PageEntry][] {
    return [...runtime.pages.entries()].filter(([, entry]) => !pageIsClosed(entry.page));
  }

  private findEntryByPageId(runtime: ProfileRuntime, pageId: string): [string, PageEntry] | null {
    return this.openEntries(runtime).find(([, entry]) => entry.pageId === pageId) ?? null;
  }

  private refreshIdleTimer(runtime: ProfileRuntime, leaseKey: string, entry: PageEntry): void {
    this.clearIdleTimer(entry);
    if (!entry.idleTimeout || entry.idleTimeout <= 0 || entry.siteSession === 'persistent') return;
    entry.idleTimer = setTimeout(() => {
      void this.expireLease(runtime, leaseKey, entry);
    }, entry.idleTimeout);
    entry.idleTimer.unref?.();
  }

  private async expireLease(runtime: ProfileRuntime, leaseKey: string, entry: PageEntry): Promise<void> {
    if (runtime.pages.get(leaseKey) !== entry) return;
    runtime.pages.delete(leaseKey);
    this.clearIdleTimer(entry);
    if (runtime.selectedPageId === entry.pageId) runtime.selectedPageId = undefined;
    runtime.lastSeenAt = Date.now();
    if (entry.siteSession !== 'persistent' && !pageIsClosed(entry.page)) {
      await entry.page.close().catch(() => {});
    }
  }

  private clearIdleTimer(entry: PageEntry): void {
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    entry.idleTimer = undefined;
  }
}

function nextPageId(): string {
  return `page-${Date.now()}-${++pageCounter}`;
}

function normalizeSurface(surface: BrowserSurface | undefined): BrowserSurface {
  return surface === 'adapter' ? 'adapter' : 'browser';
}

function requireSession(session: string | undefined): string {
  const normalized = session?.trim();
  if (!normalized) throw new Error('Browser session is required.');
  return normalized;
}

function isProfileAlreadyInUseError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes('Opening in existing browser session')
    || message.includes('Failed to create a ProcessSingleton for your profile directory');
}

async function recoverLockedCloakProfile(userDataDir: string): Promise<boolean> {
  if (process.platform === 'win32') return false;
  const initial = await findCloakProfileProcesses(userDataDir);
  if (initial.length === 0) return false;

  signalPids(initial, 'SIGTERM');
  if (await waitForProfileProcessesToExit(userDataDir, 2500)) return true;

  signalPids(await findCloakProfileProcesses(userDataDir), 'SIGKILL');
  return waitForProfileProcessesToExit(userDataDir, 1500);
}

async function waitForProfileProcessesToExit(userDataDir: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    if ((await findCloakProfileProcesses(userDataDir)).length === 0) return true;
  }
  return (await findCloakProfileProcesses(userDataDir)).length === 0;
}

function signalPids(pids: number[], signal: NodeJS.Signals): void {
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch {
      // Already exited or not signalable; the follow-up poll decides recovery.
    }
  }
}

async function findCloakProfileProcesses(userDataDir: string): Promise<number[]> {
  const profileDirs = profileDirAliases(userDataDir);
  const stdout = await psOutput();
  const pids: number[] = [];
  for (const line of stdout.split('\n')) {
    const match = line.match(/^\s*(\d+)\s+(.+)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    const command = match[2];
    if (!Number.isInteger(pid) || pid === process.pid) continue;
    if (!isCloakBrowserCommand(command)) continue;
    if (!commandUsesProfileDir(command, profileDirs)) continue;
    pids.push(pid);
  }
  return [...new Set(pids)];
}

function commandUsesProfileDir(command: string, profileDirs: string[]): boolean {
  for (const dir of profileDirs) {
    const marker = `--user-data-dir=${dir}`;
    const index = command.indexOf(marker);
    if (index < 0) continue;
    const next = command[index + marker.length];
    if (next === undefined || /\s/.test(next)) return true;
  }
  return false;
}

function profileDirAliases(userDataDir: string): string[] {
  const aliases = new Set([userDataDir]);
  try {
    aliases.add(fs.realpathSync.native(userDataDir));
  } catch {
    // The launch path is still useful even if realpath cannot resolve it.
  }
  return [...aliases];
}

function isCloakBrowserCommand(command: string): boolean {
  return command.includes('/.cloakbrowser/') || command.includes('\\.cloakbrowser\\');
}

function psOutput(): Promise<string> {
  return new Promise((resolve) => {
    execFile('ps', ['-axo', 'pid=,command='], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, timeout: 2000 }, (err, stdout) => {
      resolve(err ? '' : String(stdout));
    });
  });
}
