import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import type { BrowserContext, Page as PlaywrightPage } from 'playwright-core';
import { launchPersistentContext as cloakLaunchPersistentContext } from 'cloakbrowser';
import type { BrowserSurface, BrowserWindowMode, SiteSessionMode } from '../../protocol.js';
import { activateDarwinBackgroundContext, launchDarwinBackgroundPersistentContext } from './darwin-background-launch.js';
import { normalizeProfileId, resolveCloakProfileDir } from './profiles.js';
import { CloakNetworkCapture } from './network.js';
import { findPackageRoot } from '../../../package-paths.js';

const UNRESOLVED = Symbol('unresolved');
let cachedCloakBrowserVersion: string | undefined | typeof UNRESOLVED = UNRESOLVED;

/**
 * Installed `cloakbrowser` npm package version, for doctor/status display.
 *
 * Resolved once per process. The version cannot change while we are running, and
 * `profileStatuses()` calls this per profile, so an uncached read meant N+1
 * synchronous resolve-read-parse cycles on every status poll. The sentinel keeps
 * a genuine `undefined` (the catch path) cached too, so an unresolvable
 * `cloakbrowser` is not retried on every call.
 */
export function resolveCloakBrowserVersion(): string | undefined {
  if (cachedCloakBrowserVersion !== UNRESOLVED) return cachedCloakBrowserVersion;
  try {
    const entryPath = fileURLToPath(import.meta.resolve('cloakbrowser'));
    const pkg = JSON.parse(fs.readFileSync(path.join(findPackageRoot(entryPath), 'package.json'), 'utf-8')) as { version?: unknown };
    cachedCloakBrowserVersion = typeof pkg.version === 'string' ? pkg.version : undefined;
  } catch {
    cachedCloakBrowserVersion = undefined;
  }
  return cachedCloakBrowserVersion;
}

export type LaunchPersistentContext = typeof cloakLaunchPersistentContext;
export type RecoverLockedProfile = (userDataDir: string) => Promise<boolean>;

export interface SessionKeyInput {
  profileId?: string;
  session?: string;
  surface?: BrowserSurface;
  siteSession?: SiteSessionMode;
  idleTimeout?: number;
  windowMode?: BrowserWindowMode;
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
  selectedPageIds: Map<string, string>;
  lastSeenAt: number;
}

export interface CloakSessionManagerOptions {
  baseDir?: string;
  launchPersistentContext?: LaunchPersistentContext;
  launchBackgroundPersistentContext?: LaunchPersistentContext;
  activateBackgroundContext?: typeof activateDarwinBackgroundContext;
  recoverLockedProfile?: RecoverLockedProfile;
  platform?: NodeJS.Platform;
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

function isClosedContextError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Target page, context or browser has been closed/i.test(message);
}

export class CloakSessionManager {
  readonly networkCapture = new CloakNetworkCapture();

  private readonly launchPersistentContext: LaunchPersistentContext;
  private readonly launchBackgroundPersistentContext: LaunchPersistentContext;
  private readonly activateBackgroundContext: typeof activateDarwinBackgroundContext;
  private readonly platform: NodeJS.Platform;
  private readonly recoverLockedProfile: RecoverLockedProfile;
  private readonly profiles = new Map<string, ProfileRuntime>();
  private readonly profileLaunches = new Map<string, Promise<ProfileRuntime>>();
  private readonly pageCreationQueues = new Map<string, Promise<void>>();

  constructor(private readonly opts: CloakSessionManagerOptions = {}) {
    this.launchPersistentContext = opts.launchPersistentContext ?? cloakLaunchPersistentContext;
    this.launchBackgroundPersistentContext = opts.launchBackgroundPersistentContext ?? launchDarwinBackgroundPersistentContext;
    this.activateBackgroundContext = opts.activateBackgroundContext ?? activateDarwinBackgroundContext;
    this.platform = opts.platform ?? process.platform;
    this.recoverLockedProfile = opts.recoverLockedProfile ?? recoverLockedCloakProfile;
  }

  profileStatuses() {
    return [...this.profiles.entries()].map(([contextId, runtime]) => ({
      contextId,
      runtimeConnected: true,
      runtimeVersion: resolveCloakBrowserVersion(),
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
    const freshPage = input.freshPage === true;
    return this.withPageCreationLock(profileId, async () => {
      const runtime = await this.getProfileRuntime(profileId, input.windowMode);
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
        this.clearSelectedPage(runtime, existing);
        if (!pageIsClosed(existing.page)) await existing.page.close().catch(() => {});
      }

      return this.createPageWithRecoveryAttempt(
        profileId,
        input.windowMode,
        (candidate) => {
          const existingPages = candidate.context.pages();
          // freshPage must never adopt a leftover tab — its whole point is a clean DOM.
          return !freshPage && existingPages[0] && candidate.pages.size === 0
            ? existingPages[0]
            : this.createPage(candidate.context, input.windowMode);
        },
        (candidate, page) => {
          const pageId = nextPageId();
          const entry: PageEntry = { page, pageId, session, surface, siteSession: input.siteSession, idleTimeout: input.idleTimeout };
          candidate.pages.set(leaseKey, entry);
          this.refreshIdleTimer(candidate, leaseKey, entry);
          this.setSelectedPage(candidate, entry);
          candidate.lastSeenAt = Date.now();
          return { profileId, leaseKey, context: candidate.context, page, pageId };
        },
      );
    });
  }

  findPage(input: SessionKeyInput): CloakPageLease | null {
    const profileId = normalizeProfileId(input.profileId);
    const leaseKey = resolveLeaseKey(input);
    const runtime = this.profiles.get(profileId);
    const entry = runtime?.pages.get(leaseKey);
    if (!runtime || !entry || pageIsClosed(entry.page)) return null;
    runtime.lastSeenAt = Date.now();
    entry.idleTimeout = input.idleTimeout;
    this.refreshIdleTimer(runtime, leaseKey, entry);
    return { profileId, leaseKey, context: runtime.context, page: entry.page, pageId: entry.pageId };
  }

  findPageById(pageId: string, opts: Pick<SessionKeyInput, 'profileId' | 'session' | 'surface' | 'idleTimeout'> = {}): CloakPageLease | null {
    const expectedProfileId = opts.profileId ? normalizeProfileId(opts.profileId) : undefined;
    const expectedSession = opts.session?.trim();
    const expectedSurface = opts.surface ? normalizeSurface(opts.surface) : undefined;
    for (const [profileId, runtime] of this.profiles.entries()) {
      if (expectedProfileId && expectedProfileId !== profileId) continue;
      for (const [leaseKey, entry] of runtime.pages.entries()) {
        if (
          entry.pageId === pageId
          && !pageIsClosed(entry.page)
          && (!expectedSession || entry.session === expectedSession)
          && (!expectedSurface || entry.surface === expectedSurface)
        ) {
          entry.idleTimeout = opts.idleTimeout;
          this.refreshIdleTimer(runtime, leaseKey, entry);
          return { profileId, leaseKey, context: runtime.context, page: entry.page, pageId: entry.pageId };
        }
      }
    }
    return null;
  }

  pageOwner(pageId: string): { profileId: string; session: string; surface: BrowserSurface } | null {
    for (const [profileId, runtime] of this.profiles.entries()) {
      for (const entry of runtime.pages.values()) {
        if (entry.pageId === pageId && !pageIsClosed(entry.page)) {
          return { profileId, session: entry.session, surface: entry.surface };
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
    this.setSelectedPage(runtime, entry);
    runtime.lastSeenAt = Date.now();
    return pageId;
  }

  sessionPages(input: Pick<SessionKeyInput, 'profileId' | 'session' | 'surface'>): PlaywrightPage[] {
    const profileId = normalizeProfileId(input.profileId);
    const session = input.session?.trim();
    const surface = input.surface ? normalizeSurface(input.surface) : undefined;
    const runtime = this.profiles.get(profileId);
    if (!runtime || !session) return [];
    return this.openEntries(runtime)
      .filter(([, entry]) => entry.session === session && (!surface || entry.surface === surface))
      .map(([, entry]) => entry.page);
  }

  async listPages(input: Pick<SessionKeyInput, 'profileId' | 'session' | 'surface'>): Promise<CloakTabInfo[]> {
    const profileId = normalizeProfileId(input.profileId);
    const session = input.session?.trim();
    const surface = input.surface ? normalizeSurface(input.surface) : undefined;
    const runtime = this.profiles.get(profileId);
    if (!runtime) return [];
    const entries = this.openEntries(runtime)
      .filter(([, entry]) => (!session || entry.session === session) && (!surface || entry.surface === surface));
    return Promise.all(entries.map(async ([, entry], index) => ({
      id: entry.pageId,
      page: entry.pageId,
      index,
      title: await entry.page.title().catch(() => ''),
      url: entry.page.url(),
      profileId,
      session: entry.session,
      surface: entry.surface,
      selected: runtime.selectedPageIds.get(selectionKey(entry)) === entry.pageId,
    })));
  }

  async newPage(input: SessionKeyInput & { url?: string }): Promise<CloakPageLease> {
    const profileId = normalizeProfileId(input.profileId);
    const session = requireSession(input.session);
    const surface = normalizeSurface(input.surface);
    const acquired = await this.createPageWithRecovery(
      profileId,
      input.windowMode,
      (candidate) => this.createPage(candidate.context, input.windowMode),
      (runtime, page) => ({ runtime, page }),
    );
    if (input.url) {
      try {
        await acquired.page.goto(input.url, { waitUntil: 'load' });
      } catch (error) {
        if (!pageIsClosed(acquired.page)) await acquired.page.close().catch(() => {});
        throw error;
      }
    }
    if (this.profiles.get(profileId) !== acquired.runtime) {
      if (!pageIsClosed(acquired.page)) await acquired.page.close().catch(() => {});
      throw new Error('Target page, context or browser has been closed');
    }
    const pageId = nextPageId();
    const leaseKey = `${resolveLeaseKey(input)}\u0000${pageId}`;
    const entry: PageEntry = {
      page: acquired.page,
      pageId,
      session,
      surface,
      siteSession: input.siteSession,
      idleTimeout: input.idleTimeout,
    };
    acquired.runtime.pages.set(leaseKey, entry);
    this.refreshIdleTimer(acquired.runtime, leaseKey, entry);
    acquired.runtime.lastSeenAt = Date.now();
    return { profileId, leaseKey, context: acquired.runtime.context, page: acquired.page, pageId };
  }

  async selectPage(input: Pick<SessionKeyInput, 'profileId' | 'session' | 'surface' | 'windowMode'> & { pageId?: string; index?: number }): Promise<CloakPageLease | null> {
    const profileId = normalizeProfileId(input.profileId);
    const runtime = this.profiles.get(profileId);
    if (!runtime) return null;
    const candidates = this.sessionEntries(runtime, input);
    const match = input.pageId ? candidates.find(([, entry]) => entry.pageId === input.pageId) : candidates[input.index ?? -1];
    if (!match) return null;
    const [leaseKey, entry] = match;
    if (input.windowMode !== 'background') {
      await entry.page.bringToFront?.().catch(() => {});
      await this.activateBackgroundContext(runtime.context);
    }
    this.setSelectedPage(runtime, entry);
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

    if (input.windowMode !== 'background') {
      await entry.page.bringToFront?.().catch(() => {});
      await this.activateBackgroundContext(runtime.context);
    }

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
    this.refreshIdleTimer(runtime, canonicalKey, entry);
    this.setSelectedPage(runtime, entry);
    runtime.lastSeenAt = Date.now();
    return { profileId, leaseKey: canonicalKey, context: runtime.context, page: entry.page, pageId: entry.pageId };
  }

  async closePage(input: Pick<SessionKeyInput, 'profileId' | 'session' | 'surface'> & { pageId?: string; index?: number }): Promise<string | null> {
    const profileId = normalizeProfileId(input.profileId);
    const runtime = this.profiles.get(profileId);
    if (!runtime) return null;
    const candidates = this.sessionEntries(runtime, input);
    const match = input.pageId ? candidates.find(([, entry]) => entry.pageId === input.pageId) : candidates[input.index ?? -1];
    if (!match) return null;
    const [leaseKey, entry] = match;
    runtime.pages.delete(leaseKey);
    this.clearIdleTimer(entry);
    this.clearSelectedPage(runtime, entry);
    if (!pageIsClosed(entry.page)) await entry.page.close().catch(() => {});
    runtime.lastSeenAt = Date.now();
    return entry.pageId;
  }

  async release(input: SessionKeyInput): Promise<void> {
    const profileId = normalizeProfileId(input.profileId);
    const runtime = this.profiles.get(profileId);
    if (!runtime) return;
    const leaseKey = resolveLeaseKey(input);
    const entries = this.openEntries(runtime)
      .filter(([key, entry]) => key === leaseKey || (
        entry.session === requireSession(input.session)
        && entry.surface === normalizeSurface(input.surface)
      ));
    for (const [key, entry] of entries) {
      runtime.pages.delete(key);
      this.clearIdleTimer(entry);
      this.clearSelectedPage(runtime, entry);
      if (entry.siteSession !== 'persistent' && !pageIsClosed(entry.page)) {
        await entry.page.close().catch(() => {});
      }
    }
  }

  hasSession(profileIdInput: string | undefined, sessionInput: string | undefined): boolean {
    const profileId = normalizeProfileId(profileIdInput);
    const session = requireSession(sessionInput);
    const runtime = this.profiles.get(profileId);
    return Boolean(runtime && this.openEntries(runtime).some(([, entry]) => entry.session === session));
  }

  async closeSession(profileIdInput: string | undefined, sessionInput: string | undefined): Promise<number> {
    const profileId = normalizeProfileId(profileIdInput);
    const session = requireSession(sessionInput);
    const runtime = this.profiles.get(profileId);
    if (!runtime) return 0;
    const entries = this.openEntries(runtime).filter(([, entry]) => entry.session === session);
    for (const [key, entry] of entries) {
      runtime.pages.delete(key);
      this.clearIdleTimer(entry);
      this.clearSelectedPage(runtime, entry);
      if (!pageIsClosed(entry.page)) await entry.page.close().catch(() => {});
    }
    if (entries.length > 0) runtime.lastSeenAt = Date.now();
    return entries.length;
  }

  async shutdown(): Promise<void> {
    for (const runtime of this.profiles.values()) {
      for (const entry of runtime.pages.values()) this.clearIdleTimer(entry);
      await runtime.context.close().catch(() => {});
    }
    this.profiles.clear();
  }

  private async getProfileRuntime(profileId: string, windowMode?: BrowserWindowMode): Promise<ProfileRuntime> {
    const existing = this.profiles.get(profileId);
    if (existing) return existing;
    const pending = this.profileLaunches.get(profileId);
    if (pending) return pending;

    const launch = this.launchProfileRuntime(profileId, windowMode);
    this.profileLaunches.set(profileId, launch);
    try {
      return await launch;
    } finally {
      this.profileLaunches.delete(profileId);
    }
  }

  private async launchProfileRuntime(profileId: string, windowMode?: BrowserWindowMode): Promise<ProfileRuntime> {
    const userDataDir = resolveCloakProfileDir(profileId, { baseDir: this.opts.baseDir });
    fs.mkdirSync(userDataDir, { recursive: true });
    const launchOptions = {
      userDataDir,
      headless: false,
      humanize: true,
    };
    const launchPersistentContext = this.platform === 'darwin' && windowMode === 'background'
      ? this.launchBackgroundPersistentContext
      : this.launchPersistentContext;
    let context: BrowserContext;
    try {
      context = await launchPersistentContext(launchOptions);
    } catch (err) {
      if (!isProfileAlreadyInUseError(err) || !(await this.recoverLockedProfile(userDataDir))) throw err;
      context = await launchPersistentContext(launchOptions);
    }
    const runtime = { context, pages: new Map(), selectedPageIds: new Map(), lastSeenAt: Date.now() };
    this.attachRuntimeLifecycle(profileId, runtime);
    this.profiles.set(profileId, runtime);
    return runtime;
  }

  private invalidateProfileRuntime(profileId: string, runtime: ProfileRuntime): void {
    if (this.profiles.get(profileId) !== runtime) return;
    this.profiles.delete(profileId);
    for (const entry of runtime.pages.values()) {
      if (entry.idleTimer) clearTimeout(entry.idleTimer);
      this.networkCapture.stop(entry.page);
    }
    runtime.pages.clear();
    runtime.selectedPageIds.clear();
  }

  private attachRuntimeLifecycle(profileId: string, runtime: ProfileRuntime): void {
    runtime.context.on('close', () => this.invalidateProfileRuntime(profileId, runtime));
  }

  private async createPageWithRecovery<T>(
    profileId: string,
    windowMode: BrowserWindowMode | undefined,
    createPage: (runtime: ProfileRuntime) => PlaywrightPage | Promise<PlaywrightPage>,
    commitPage: (runtime: ProfileRuntime, page: PlaywrightPage) => T,
  ): Promise<T> {
    return this.withPageCreationLock(profileId, () => this.createPageWithRecoveryAttempt(
      profileId,
      windowMode,
      createPage,
      commitPage,
    ));
  }

  private async createPageWithRecoveryAttempt<T>(
    profileId: string,
    windowMode: BrowserWindowMode | undefined,
    createPage: (runtime: ProfileRuntime) => PlaywrightPage | Promise<PlaywrightPage>,
    commitPage: (runtime: ProfileRuntime, page: PlaywrightPage) => T,
    attempt = 0,
  ): Promise<T> {
    const runtime = await this.getProfileRuntime(profileId, windowMode);
    let page: PlaywrightPage;
    try {
      page = await createPage(runtime);
    } catch (error) {
      if (attempt !== 0 || !isClosedContextError(error)) throw error;
      this.invalidateProfileRuntime(profileId, runtime);
      return this.createPageWithRecoveryAttempt(profileId, windowMode, createPage, commitPage, 1);
    }
    if (this.profiles.get(profileId) !== runtime) {
      if (!pageIsClosed(page)) await page.close().catch(() => {});
      throw new Error('Target page, context or browser has been closed');
    }
    return commitPage(runtime, page);
  }

  private async withPageCreationLock<T>(profileId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.pageCreationQueues.get(profileId) ?? Promise.resolve();
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queue = previous.then(() => released);
    this.pageCreationQueues.set(profileId, queue);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.pageCreationQueues.get(profileId) === queue) this.pageCreationQueues.delete(profileId);
    }
  }

  private async createPage(context: BrowserContext, windowMode?: BrowserWindowMode): Promise<PlaywrightPage> {
    if (windowMode !== 'background') return context.newPage();

    const browser = context.browser();
    if (!browser) throw new Error('Background page creation requires a Chromium browser connection.');
    const cdp = await browser.newBrowserCDPSession();
    try {
      const [page] = await Promise.all([
        context.waitForEvent('page'),
        cdp.send('Target.createTarget', {
          url: 'about:blank',
          background: true,
          focus: false,
        }),
      ]);
      return page;
    } finally {
      await cdp.detach().catch(() => {});
    }
  }

  private openEntries(runtime: ProfileRuntime): [string, PageEntry][] {
    return [...runtime.pages.entries()].filter(([, entry]) => !pageIsClosed(entry.page));
  }

  private findEntryByPageId(runtime: ProfileRuntime, pageId: string): [string, PageEntry] | null {
    return this.openEntries(runtime).find(([, entry]) => entry.pageId === pageId) ?? null;
  }

  private sessionEntries(runtime: ProfileRuntime, input: Pick<SessionKeyInput, 'session' | 'surface'>): [string, PageEntry][] {
    const session = requireSession(input.session);
    const surface = normalizeSurface(input.surface);
    return this.openEntries(runtime).filter(([, entry]) => entry.session === session && entry.surface === surface);
  }

  private setSelectedPage(runtime: ProfileRuntime, entry: PageEntry): void {
    runtime.selectedPageIds.set(selectionKey(entry), entry.pageId);
  }

  private clearSelectedPage(runtime: ProfileRuntime, entry: PageEntry): void {
    const key = selectionKey(entry);
    if (runtime.selectedPageIds.get(key) === entry.pageId) runtime.selectedPageIds.delete(key);
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
    this.clearSelectedPage(runtime, entry);
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

function selectionKey(entry: Pick<PageEntry, 'surface' | 'session'>): string {
  return `${entry.surface}\u0000${encodeURIComponent(entry.session)}`;
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
