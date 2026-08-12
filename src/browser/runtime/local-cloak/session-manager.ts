import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import type { Browser, BrowserContext, CDPSession, Page as PlaywrightPage } from 'playwright-core';
import { launchPersistentContext as cloakLaunchPersistentContext } from 'cloakbrowser';
import type { BrowserSurface, BrowserWindowMode, SiteSessionMode } from '../../protocol.js';
import { activateDarwinBackgroundContext, launchDarwinBackgroundPersistentContext } from './darwin-background-launch.js';
import { normalizeProfileId, resolveCloakProfileDir } from './profiles.js';
import { CloakNetworkCapture } from './network.js';
import { findPackageRoot } from '../../../package-paths.js';

const UNRESOLVED = Symbol('unresolved');
const TARGET_PAGE_MATCH_TIMEOUT_MS = 1_000;
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
  sessionId?: string;
  adapterSite?: string;
  runId?: string;
  idleTimeout?: number;
  windowMode?: BrowserWindowMode;
  /** Discard the existing leased page (if any) and create a new one under the same lease. */
  freshPage?: boolean;
}

type PageEntry = {
  page: PlaywrightPage;
  pageId: string;
  targetId: string;
  leaseKey: string;
  sessionId?: string;
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
  sessionId: string;
  surface: BrowserSurface;
  selected: boolean;
}

interface ProfileRuntime {
  context: BrowserContext;
  cdp: CDPSession;
  sessions: Map<string, SessionRuntime>;
  windowOwners: Map<number, string>;
  targetPages: Map<string, PageEntry>;
  lastSeenAt: number;
}

interface SessionRuntime {
  id: string;
  windowIds: Set<number>;
  pages: Map<string, PageEntry>;
  selectedPageId?: string;
}

export interface BrowserRunSessionScope {
  browser: Browser;
  context: BrowserContext;
  page: PlaywrightPage;
  pages(): readonly PlaywrightPage[];
  createPage(): Promise<PlaywrightPage>;
  onPage(listener: (page: PlaywrightPage) => void): () => void;
}

export class SessionWindowConflictError extends Error {
  readonly code = 'SESSION_WINDOW_CONFLICT';

  constructor(pageId: string, sessionId: string, owner?: string) {
    super(`Page ${pageId} is in a window owned by Session ${owner ?? 'unknown'}, not ${sessionId}.`);
  }
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
  const sessionId = input.sessionId?.trim() || session;
  if (surface === 'adapter' && input.siteSession === 'persistent' && input.adapterSite) {
    return `${sessionId}\u0000site:${input.adapterSite}`;
  }
  if (surface === 'adapter' && input.runId) {
    return `${sessionId}\u0000ephemeral:${input.adapterSite ?? 'browser'}:${input.runId}`;
  }
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
  private readonly pageTargetIds = new WeakMap<PlaywrightPage, string>();
  private readonly pageTargetIdPromises = new WeakMap<PlaywrightPage, Promise<string>>();
  private readonly pageCdpSessions = new WeakMap<PlaywrightPage, CDPSession>();
  private readonly pendingTargetPages = new WeakMap<ProfileRuntime, Map<string, PlaywrightPage>>();
  private readonly targetPageWaiters = new WeakMap<ProfileRuntime, Map<string, {
    resolve(page: PlaywrightPage): void;
    reject(error: Error): void;
    timer: ReturnType<typeof setTimeout>;
  }>>();
  private readonly sessionPageListeners = new WeakMap<SessionRuntime, Set<(page: PlaywrightPage) => void>>();

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
    const sessionId = requireSessionId(input);
    const surface = normalizeSurface(input.surface);
    const leaseKey = resolveLeaseKey(input);
    const freshPage = input.freshPage === true;
    return this.withPageCreationLock(profileId, async () => {
      const runtime = await this.getProfileRuntime(profileId, input.windowMode);
      const sessionRuntime = this.getSessionRuntime(runtime, sessionId);
      const existing = sessionRuntime.pages.get(leaseKey);
      if (existing && !pageIsClosed(existing.page) && !freshPage) {
        await this.assertOwnedWindow(runtime, sessionId, existing);
        runtime.lastSeenAt = Date.now();
        existing.idleTimeout = input.idleTimeout;
        this.refreshIdleTimer(runtime, sessionRuntime, leaseKey, existing);
        return { profileId, leaseKey, context: runtime.context, page: existing.page, pageId: existing.pageId };
      }
      const acquired = await this.acquireSessionPage(profileId, sessionId, input.windowMode);
      const entry = await this.registerOwnedPage(acquired.runtime, acquired.session, acquired.page, {
        leaseKey,
        session,
        surface,
        siteSession: input.siteSession,
        idleTimeout: input.idleTimeout,
      });
      if (existing && freshPage && existing !== entry) await this.removeEntry(acquired.runtime, sessionRuntime, existing, true);
      this.selectEntry(acquired.session, entry);
      acquired.runtime.lastSeenAt = Date.now();
      return { profileId, leaseKey, context: acquired.runtime.context, page: entry.page, pageId: entry.pageId };
    });
  }

  async findPage(input: SessionKeyInput): Promise<CloakPageLease | null> {
    const profileId = normalizeProfileId(input.profileId);
    const sessionId = requireSessionId(input);
    const leaseKey = resolveLeaseKey(input);
    const runtime = this.profiles.get(profileId);
    const sessionRuntime = runtime?.sessions.get(sessionId);
    const entry = sessionRuntime?.pages.get(leaseKey);
    if (!runtime || !sessionRuntime || !entry || pageIsClosed(entry.page)) return null;
    await this.assertOwnedWindow(runtime, sessionId, entry);
    runtime.lastSeenAt = Date.now();
    entry.idleTimeout = input.idleTimeout;
    this.refreshIdleTimer(runtime, sessionRuntime, leaseKey, entry);
    return { profileId, leaseKey, context: runtime.context, page: entry.page, pageId: entry.pageId };
  }

  async findPageById(pageId: string, opts: Pick<SessionKeyInput, 'profileId' | 'session' | 'sessionId' | 'surface' | 'idleTimeout'>): Promise<CloakPageLease | null> {
    const expectedProfileId = normalizeProfileId(opts.profileId);
    const sessionId = requireSessionId(opts);
    const expectedSurface = opts.surface ? normalizeSurface(opts.surface) : undefined;
    for (const [profileId, runtime] of this.profiles.entries()) {
      if (expectedProfileId !== profileId) continue;
      const sessionRuntime = runtime.sessions.get(sessionId);
      if (!sessionRuntime) return null;
      for (const [leaseKey, entry] of sessionRuntime.pages.entries()) {
        if (
          entry.pageId === pageId
          && !pageIsClosed(entry.page)
          && (!expectedSurface || entry.surface === expectedSurface)
        ) {
          await this.assertOwnedWindow(runtime, sessionId, entry);
          entry.idleTimeout = opts.idleTimeout;
          this.refreshIdleTimer(runtime, sessionRuntime, leaseKey, entry);
          return { profileId, leaseKey, context: runtime.context, page: entry.page, pageId: entry.pageId };
        }
      }
    }
    return null;
  }

  pageOwner(pageId: string): { profileId: string; session: string; surface: BrowserSurface } | null {
    for (const [profileId, runtime] of this.profiles.entries()) {
      for (const entry of runtime.targetPages.values()) {
        if (entry.pageId === pageId && !pageIsClosed(entry.page)) {
          return { profileId, session: entry.session, surface: entry.surface };
        }
      }
    }
    return null;
  }

  pageIdFor(page: PlaywrightPage): string | undefined {
    for (const runtime of this.profiles.values()) {
      for (const entry of runtime.targetPages.values()) {
        if (entry.page === page) return entry.pageId;
      }
    }
    return undefined;
  }

  async browserRunScope(input: SessionKeyInput, page: PlaywrightPage): Promise<BrowserRunSessionScope> {
    const profileId = normalizeProfileId(input.profileId);
    const sessionId = requireSessionId(input);
    const runtime = this.profiles.get(profileId);
    const sessionRuntime = runtime?.sessions.get(sessionId);
    const entry = runtime && [...runtime.targetPages.values()].find(candidate => candidate.page === page);
    if (!runtime || !sessionRuntime || !entry || entry.sessionId !== sessionId) {
      throw new Error('Browser-run page is outside the selected Session.');
    }
    await Promise.all(this.openEntries(sessionRuntime).map(([, candidate]) => (
      this.assertOwnedWindow(runtime, sessionId, candidate)
    )));
    const browser = runtime.context.browser();
    if (!browser) throw new Error('The selected browser context is not attached to a browser.');
    return {
      browser,
      context: runtime.context,
      page,
      pages: () => this.openEntries(sessionRuntime).map(([, candidate]) => candidate.page),
      createPage: async () => (await this.newPage(input)).page,
      onPage: (listener) => {
        const listeners = this.sessionPageListeners.get(sessionRuntime) ?? new Set();
        listeners.add(listener);
        this.sessionPageListeners.set(sessionRuntime, listeners);
        return () => listeners.delete(listener);
      },
    };
  }

  async listPages(input: Pick<SessionKeyInput, 'profileId' | 'session' | 'sessionId' | 'surface'>): Promise<CloakTabInfo[]> {
    const profileId = normalizeProfileId(input.profileId);
    const sessionId = requireSessionId(input);
    const surface = input.surface ? normalizeSurface(input.surface) : undefined;
    const runtime = this.profiles.get(profileId);
    if (!runtime) return [];
    const sessionRuntime = runtime.sessions.get(sessionId);
    if (!sessionRuntime) return [];
    const entries = this.openEntries(sessionRuntime)
      .filter(([, entry]) => !surface || entry.surface === surface);
    await Promise.all(entries.map(([, entry]) => this.assertOwnedWindow(runtime, sessionId, entry)));
    return Promise.all(entries.map(async ([, entry], index) => ({
      id: entry.pageId,
      page: entry.pageId,
      index,
      title: await entry.page.title().catch(() => ''),
      url: entry.page.url(),
      profileId,
      session: entry.session,
      sessionId,
      surface: entry.surface,
      selected: sessionRuntime.selectedPageId === entry.pageId,
    })));
  }

  async newPage(input: SessionKeyInput & { url?: string }): Promise<CloakPageLease> {
    const profileId = normalizeProfileId(input.profileId);
    const session = requireSession(input.session);
    const sessionId = requireSessionId(input);
    const surface = normalizeSurface(input.surface);
    const acquired = await this.withPageCreationLock(profileId, async () => {
      const result = await this.acquireSessionPage(profileId, sessionId, input.windowMode);
      return { runtime: result.runtime, sessionRuntime: result.session, page: result.page };
    });
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
    const entry = await this.registerOwnedPage(acquired.runtime, acquired.sessionRuntime, acquired.page, {
      session,
      surface,
      siteSession: input.siteSession,
      idleTimeout: input.idleTimeout,
    });
    const leaseKey = entry.leaseKey;
    this.refreshIdleTimer(acquired.runtime, acquired.sessionRuntime, leaseKey, entry);
    this.selectEntry(acquired.sessionRuntime, entry);
    acquired.runtime.lastSeenAt = Date.now();
    return { profileId, leaseKey, context: acquired.runtime.context, page: acquired.page, pageId: entry.pageId };
  }

  async selectPage(input: Pick<SessionKeyInput, 'profileId' | 'session' | 'sessionId' | 'surface' | 'windowMode'> & { pageId?: string; index?: number }): Promise<CloakPageLease | null> {
    const profileId = normalizeProfileId(input.profileId);
    const sessionId = requireSessionId(input);
    const runtime = this.profiles.get(profileId);
    if (!runtime) return null;
    const sessionRuntime = runtime.sessions.get(sessionId);
    if (!sessionRuntime) return null;
    const candidates = this.sessionEntries(sessionRuntime, input);
    const match = input.pageId ? candidates.find(([, entry]) => entry.pageId === input.pageId) : candidates[input.index ?? -1];
    if (!match) return null;
    const [leaseKey, entry] = match;
    await this.assertOwnedWindow(runtime, sessionId, entry);
    if (input.windowMode !== 'background') {
      await entry.page.bringToFront?.().catch(() => {});
      await this.activateBackgroundContext(runtime.context);
    }
    this.selectEntry(sessionRuntime, entry);
    runtime.lastSeenAt = Date.now();
    return { profileId, leaseKey, context: runtime.context, page: entry.page, pageId: entry.pageId };
  }

  async bindPage(input: SessionKeyInput & { pageId?: string; index?: number }): Promise<CloakPageLease | null> {
    const profileId = normalizeProfileId(input.profileId);
    const session = requireSession(input.session);
    const sessionId = requireSessionId(input);
    const surface = normalizeSurface(input.surface);
    const runtime = this.profiles.get(profileId);
    if (!runtime) return null;
    const sessionRuntime = this.getSessionRuntime(runtime, sessionId);
    let match = input.pageId ? this.findEntryByPageId(runtime, input.pageId) : this.openEntries(sessionRuntime)[input.index ?? -1];
    if (!match && input.index !== undefined) {
      const page = runtime.context.pages().filter(candidate => !pageIsClosed(candidate))[input.index];
      if (page) {
        const targetId = await this.targetIdForPage(runtime, page);
        const entry = runtime.targetPages.get(targetId) ?? {
          page,
          pageId: nextPageId(),
          targetId,
          leaseKey: `unowned\u0000${targetId}`,
          session: '',
          surface,
        };
        if (!runtime.targetPages.has(targetId)) {
          runtime.targetPages.set(targetId, entry);
          this.attachPageLifecycle(runtime, entry);
        }
        match = [entry.leaseKey, entry];
      }
    }
    if (!match) return null;

    const entry = match[1];
    await this.assertBindableWindow(runtime, sessionRuntime, entry);
    const sourceSession = entry.sessionId ? runtime.sessions.get(entry.sessionId) : undefined;
    const sourceKey = entry.leaseKey;
    const canonicalKey = resolveLeaseKey(input);
    const currentCanonical = sessionRuntime.pages.get(canonicalKey);

    if (input.windowMode !== 'background') {
      await entry.page.bringToFront?.().catch(() => {});
      await this.activateBackgroundContext(runtime.context);
    }

    if (currentCanonical && currentCanonical !== entry && !pageIsClosed(currentCanonical.page)) {
      const preservedKey = `${canonicalKey}\u0000${currentCanonical.pageId}`;
      sessionRuntime.pages.delete(canonicalKey);
      currentCanonical.leaseKey = preservedKey;
      sessionRuntime.pages.set(preservedKey, currentCanonical);
      this.refreshIdleTimer(runtime, sessionRuntime, preservedKey, currentCanonical);
    }

    sourceSession?.pages.delete(sourceKey);
    entry.sessionId = sessionId;
    entry.leaseKey = canonicalKey;
    entry.session = session;
    entry.surface = surface;
    entry.siteSession = input.siteSession;
    entry.idleTimeout = input.idleTimeout;
    sessionRuntime.pages.set(canonicalKey, entry);
    this.refreshIdleTimer(runtime, sessionRuntime, canonicalKey, entry);
    this.selectEntry(sessionRuntime, entry);
    runtime.lastSeenAt = Date.now();
    return { profileId, leaseKey: canonicalKey, context: runtime.context, page: entry.page, pageId: entry.pageId };
  }

  async closePage(input: Pick<SessionKeyInput, 'profileId' | 'session' | 'sessionId' | 'surface'> & { pageId?: string; index?: number }): Promise<string | null> {
    const profileId = normalizeProfileId(input.profileId);
    const sessionId = requireSessionId(input);
    const runtime = this.profiles.get(profileId);
    if (!runtime) return null;
    const sessionRuntime = runtime.sessions.get(sessionId);
    if (!sessionRuntime) return null;
    const candidates = this.sessionEntries(sessionRuntime, input);
    const match = input.pageId ? candidates.find(([, entry]) => entry.pageId === input.pageId) : candidates[input.index ?? -1];
    if (!match) return null;
    const [, entry] = match;
    await this.assertOwnedWindow(runtime, sessionId, entry);
    await this.removeEntry(runtime, sessionRuntime, entry, true);
    runtime.lastSeenAt = Date.now();
    return entry.pageId;
  }

  async release(input: SessionKeyInput): Promise<void> {
    const profileId = normalizeProfileId(input.profileId);
    const sessionId = requireSessionId(input);
    const runtime = this.profiles.get(profileId);
    if (!runtime) return;
    const sessionRuntime = runtime.sessions.get(sessionId);
    if (!sessionRuntime) return;
    const leaseKey = resolveLeaseKey(input);
    const surface = normalizeSurface(input.surface);
    const entries = this.openEntries(sessionRuntime).filter(([key, entry]) => (
      surface === 'adapter'
        ? key === leaseKey
        : entry.session === requireSession(input.session) && entry.surface === surface
    ));
    await Promise.all(entries.map(([, entry]) => this.assertOwnedWindow(runtime, sessionId, entry)));
    for (const [, entry] of entries) {
      if (entry.siteSession === 'persistent') continue;
      await this.removeEntry(runtime, sessionRuntime, entry, true);
    }
  }

  hasSession(profileIdInput: string | undefined, sessionInput: string | undefined): boolean {
    const profileId = normalizeProfileId(profileIdInput);
    const session = requireSession(sessionInput);
    const runtime = this.profiles.get(profileId);
    return Boolean(runtime?.sessions.get(session) && this.openEntries(runtime.sessions.get(session)!).length > 0);
  }

  async closeSession(profileIdInput: string | undefined, sessionInput: string | undefined): Promise<number> {
    const profileId = normalizeProfileId(profileIdInput);
    const session = requireSession(sessionInput);
    const runtime = this.profiles.get(profileId);
    if (!runtime) return 0;
    const sessionRuntime = runtime.sessions.get(session);
    if (!sessionRuntime) return 0;
    const entries = this.openEntries(sessionRuntime);
    await Promise.all(entries.map(([, entry]) => this.assertOwnedWindow(runtime, session, entry)));
    for (const [, entry] of entries) await this.removeEntry(runtime, sessionRuntime, entry, true);
    if (entries.length > 0) runtime.lastSeenAt = Date.now();
    return entries.length;
  }

  async shutdown(): Promise<void> {
    for (const runtime of this.profiles.values()) {
      for (const entry of runtime.targetPages.values()) this.clearIdleTimer(entry);
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
    const browser = context.browser();
    if (!browser) throw new Error('Cloak page creation requires a Chromium browser connection.');
    const runtime: ProfileRuntime = {
      context,
      cdp: await browser.newBrowserCDPSession(),
      sessions: new Map(),
      windowOwners: new Map(),
      targetPages: new Map(),
      lastSeenAt: Date.now(),
    };
    this.pendingTargetPages.set(runtime, new Map());
    this.targetPageWaiters.set(runtime, new Map());
    this.attachRuntimeLifecycle(profileId, runtime);
    this.profiles.set(profileId, runtime);
    return runtime;
  }

  private invalidateProfileRuntime(profileId: string, runtime: ProfileRuntime): void {
    if (this.profiles.get(profileId) !== runtime) return;
    this.profiles.delete(profileId);
    for (const entry of runtime.targetPages.values()) {
      if (entry.idleTimer) clearTimeout(entry.idleTimer);
      this.networkCapture.stop(entry.page);
      void this.pageCdpSessions.get(entry.page)?.detach().catch(() => {});
    }
    runtime.targetPages.clear();
    runtime.sessions.clear();
    runtime.windowOwners.clear();
    for (const waiter of this.targetPageWaiters.get(runtime)?.values() ?? []) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error('Target page, context or browser has been closed'));
    }
    this.targetPageWaiters.get(runtime)?.clear();
    void runtime.cdp.detach().catch(() => {});
  }

  private attachRuntimeLifecycle(profileId: string, runtime: ProfileRuntime): void {
    runtime.context.on('close', () => this.invalidateProfileRuntime(profileId, runtime));
    runtime.context.on('page', page => {
      void this.handleContextPage(runtime, page).catch(() => {});
    });
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

  private getSessionRuntime(runtime: ProfileRuntime, sessionId: string): SessionRuntime {
    let session = runtime.sessions.get(sessionId);
    if (!session) {
      session = { id: sessionId, windowIds: new Set(), pages: new Map() };
      runtime.sessions.set(sessionId, session);
    }
    return session;
  }

  private async createSessionPage(
    runtime: ProfileRuntime,
    session: SessionRuntime,
    windowMode?: BrowserWindowMode,
  ): Promise<PlaywrightPage> {
    const opener = this.openEntries(session)[0]?.[1].page;
    if (!opener) return this.createWindowPage(runtime, windowMode);

    const popup = opener.waitForEvent('popup', { timeout: 1_000 }).catch(() => null);
    try {
      await opener.evaluate(() => window.open('about:blank', '_blank', 'noopener'));
    } catch {}
    const page = await popup;
    if (page) return page;
    return this.createWindowPage(runtime, windowMode);
  }

  private async acquireSessionPage(
    profileId: string,
    sessionId: string,
    windowMode: BrowserWindowMode | undefined,
    attempt = 0,
  ): Promise<{ runtime: ProfileRuntime; session: SessionRuntime; page: PlaywrightPage }> {
    const runtime = await this.getProfileRuntime(profileId, windowMode);
    const session = this.getSessionRuntime(runtime, sessionId);
    let page: PlaywrightPage;
    try {
      page = await this.createSessionPage(runtime, session, windowMode);
    } catch (error) {
      if (attempt !== 0 || !isClosedContextError(error)) throw error;
      this.invalidateProfileRuntime(profileId, runtime);
      return this.acquireSessionPage(profileId, sessionId, windowMode, 1);
    }
    if (this.profiles.get(profileId) !== runtime) {
      if (!pageIsClosed(page)) await page.close().catch(() => {});
      throw new Error('Target page, context or browser has been closed');
    }
    return { runtime, session, page };
  }

  private async createWindowPage(runtime: ProfileRuntime, windowMode?: BrowserWindowMode): Promise<PlaywrightPage> {
    const result = await runtime.cdp.send('Target.createTarget', {
      url: 'about:blank',
      newWindow: true,
      background: windowMode === 'background',
      focus: windowMode !== 'background',
    }) as { targetId: string };
    return this.waitForTargetPage(runtime, result.targetId);
  }

  private async waitForTargetPage(runtime: ProfileRuntime, targetId: string): Promise<PlaywrightPage> {
    const pending = this.pendingTargetPages.get(runtime)!;
    const page = pending.get(targetId);
    if (page) {
      pending.delete(targetId);
      pending.clear();
      return page;
    }
    return new Promise<PlaywrightPage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.targetPageWaiters.get(runtime)?.delete(targetId);
        reject(new Error(`Timed out waiting for Cloak target ${targetId}`));
      }, TARGET_PAGE_MATCH_TIMEOUT_MS);
      this.targetPageWaiters.get(runtime)!.set(targetId, { resolve, reject, timer });
    });
  }

  private async handleContextPage(runtime: ProfileRuntime, page: PlaywrightPage): Promise<void> {
    const targetId = await this.targetIdForPage(runtime, page);
    const waiter = this.targetPageWaiters.get(runtime)?.get(targetId);
    if (waiter) {
      this.targetPageWaiters.get(runtime)!.delete(targetId);
      this.pendingTargetPages.get(runtime)?.clear();
      clearTimeout(waiter.timer);
      waiter.resolve(page);
    } else {
      this.pendingTargetPages.get(runtime)?.set(targetId, page);
    }

    const opener = await page.opener().catch(() => null);
    const openerEntry = opener && [...runtime.targetPages.values()].find(entry => entry.page === opener);
    if (!openerEntry?.sessionId) return;
    const session = runtime.sessions.get(openerEntry.sessionId);
    if (!session) return;
    this.pendingTargetPages.get(runtime)?.delete(targetId);
    await this.registerOwnedPage(runtime, session, page, {
      session: openerEntry.session,
      surface: openerEntry.surface,
      siteSession: openerEntry.siteSession,
      idleTimeout: openerEntry.idleTimeout,
    });
  }

  private async registerOwnedPage(
    runtime: ProfileRuntime,
    session: SessionRuntime,
    page: PlaywrightPage,
    input: Pick<PageEntry, 'session' | 'surface' | 'siteSession' | 'idleTimeout'> & { leaseKey?: string },
  ): Promise<PageEntry> {
    const targetId = await this.targetIdForPage(runtime, page);
    this.pendingTargetPages.get(runtime)?.delete(targetId);
    const windowId = await this.windowIdForTarget(runtime, targetId);
    const owner = runtime.windowOwners.get(windowId);
    if (owner !== undefined && owner !== session.id) {
      throw new SessionWindowConflictError(runtime.targetPages.get(targetId)?.pageId ?? 'unknown', session.id, owner);
    }
    runtime.windowOwners.set(windowId, session.id);
    session.windowIds.add(windowId);

    let entry = runtime.targetPages.get(targetId);
    const wasOwned = Boolean(entry?.sessionId);
    if (entry?.sessionId && entry.sessionId !== session.id) {
      throw new SessionWindowConflictError(entry.pageId, session.id, entry.sessionId);
    }
    if (!entry) {
      const pageId = nextPageId();
      entry = {
        page,
        pageId,
        targetId,
        leaseKey: input.leaseKey ?? `page\u0000${pageId}`,
        sessionId: session.id,
        session: input.session,
        surface: input.surface,
        siteSession: input.siteSession,
        idleTimeout: input.idleTimeout,
      };
      runtime.targetPages.set(targetId, entry);
      this.attachPageLifecycle(runtime, entry);
    } else {
      if (entry.sessionId) {
        const session = runtime.sessions.get(entry.sessionId);
        if (session?.pages.get(entry.leaseKey) === entry) session.pages.delete(entry.leaseKey);
      }
      entry.sessionId = session.id;
      entry.session = input.session;
      entry.surface = input.surface;
      entry.siteSession = input.siteSession;
      entry.idleTimeout = input.idleTimeout;
      entry.leaseKey = input.leaseKey ?? (entry.leaseKey.startsWith('unowned\u0000') ? `page\u0000${entry.pageId}` : entry.leaseKey);
    }
    session.pages.set(entry.leaseKey, entry);
    this.refreshIdleTimer(runtime, session, entry.leaseKey, entry);
    if (!wasOwned) for (const listener of this.sessionPageListeners.get(session) ?? []) listener(page);
    return entry;
  }

  private attachPageLifecycle(runtime: ProfileRuntime, entry: PageEntry): void {
    entry.page.once('close', () => {
      runtime.targetPages.delete(entry.targetId);
      if (entry.sessionId) {
        const session = runtime.sessions.get(entry.sessionId);
        if (session?.pages.get(entry.leaseKey) === entry) session.pages.delete(entry.leaseKey);
      }
      this.clearIdleTimer(entry);
    });
  }

  private async targetIdForPage(runtime: ProfileRuntime, page: PlaywrightPage): Promise<string> {
    const cached = this.pageTargetIds.get(page);
    if (cached) return cached;
    const pending = this.pageTargetIdPromises.get(page);
    if (pending) return pending;
    const correlation = (async () => {
      const session = await runtime.context.newCDPSession(page);
      const { targetInfo } = await session.send('Target.getTargetInfo') as { targetInfo: { targetId: string } };
      this.pageTargetIds.set(page, targetInfo.targetId);
      this.pageCdpSessions.set(page, session);
      page.once('close', () => {
        this.pageTargetIds.delete(page);
        this.pageCdpSessions.delete(page);
        void session.detach().catch(() => {});
      });
      return targetInfo.targetId;
    })();
    this.pageTargetIdPromises.set(page, correlation);
    try {
      return await correlation;
    } finally {
      this.pageTargetIdPromises.delete(page);
    }
  }

  private async windowIdForTarget(runtime: ProfileRuntime, targetId: string): Promise<number> {
    const { windowId } = await runtime.cdp.send('Browser.getWindowForTarget', { targetId }) as { windowId: number };
    return windowId;
  }

  private async assertOwnedWindow(runtime: ProfileRuntime, sessionId: string, entry: PageEntry): Promise<void> {
    const actual = await this.windowIdForTarget(runtime, entry.targetId);
    const owner = runtime.windowOwners.get(actual);
    if (owner !== undefined && owner !== sessionId) {
      throw new SessionWindowConflictError(entry.pageId, sessionId, owner);
    }
    if (!runtime.sessions.get(sessionId)?.windowIds.has(actual)) {
      throw new SessionWindowConflictError(entry.pageId, sessionId, owner);
    }
  }

  private async assertBindableWindow(runtime: ProfileRuntime, session: SessionRuntime, entry: PageEntry): Promise<void> {
    const actual = await this.windowIdForTarget(runtime, entry.targetId);
    const owner = runtime.windowOwners.get(actual);
    if (owner !== undefined && owner !== session.id) {
      throw new SessionWindowConflictError(entry.pageId, session.id, owner);
    }
    runtime.windowOwners.set(actual, session.id);
    session.windowIds.add(actual);
  }

  private openEntries(runtime: SessionRuntime): [string, PageEntry][] {
    return [...runtime.pages.entries()].filter(([, entry]) => !pageIsClosed(entry.page));
  }

  private findEntryByPageId(runtime: ProfileRuntime, pageId: string): [string, PageEntry] | null {
    const entry = [...runtime.targetPages.values()].find(candidate => candidate.pageId === pageId && !pageIsClosed(candidate.page));
    return entry ? [entry.leaseKey, entry] : null;
  }

  private sessionEntries(runtime: SessionRuntime, input: Pick<SessionKeyInput, 'session' | 'surface'>): [string, PageEntry][] {
    const session = requireSession(input.session);
    const surface = normalizeSurface(input.surface);
    return this.openEntries(runtime).filter(([, entry]) => entry.session === session && entry.surface === surface);
  }

  private selectEntry(runtime: SessionRuntime, entry: PageEntry): void {
    runtime.selectedPageId = entry.pageId;
  }

  private clearSelectedPage(runtime: SessionRuntime, entry: PageEntry): void {
    if (runtime.selectedPageId === entry.pageId) runtime.selectedPageId = undefined;
  }

  private refreshIdleTimer(runtime: ProfileRuntime, session: SessionRuntime, leaseKey: string, entry: PageEntry): void {
    this.clearIdleTimer(entry);
    if (!entry.idleTimeout || entry.idleTimeout <= 0 || entry.siteSession === 'persistent') return;
    entry.idleTimer = setTimeout(() => {
      void this.expireLease(runtime, session, leaseKey, entry);
    }, entry.idleTimeout);
    entry.idleTimer.unref?.();
  }

  private async expireLease(runtime: ProfileRuntime, session: SessionRuntime, leaseKey: string, entry: PageEntry): Promise<void> {
    if (session.pages.get(leaseKey) !== entry) return;
    runtime.lastSeenAt = Date.now();
    if (entry.siteSession !== 'persistent') await this.removeEntry(runtime, session, entry, true);
  }

  private async removeEntry(runtime: ProfileRuntime, session: SessionRuntime, entry: PageEntry, close: boolean): Promise<void> {
    if (session.pages.get(entry.leaseKey) === entry) session.pages.delete(entry.leaseKey);
    runtime.targetPages.delete(entry.targetId);
    this.clearIdleTimer(entry);
    this.clearSelectedPage(session, entry);
    this.networkCapture.stop(entry.page);
    if (close && !pageIsClosed(entry.page)) {
      await runtime.cdp.send('Target.closeTarget', { targetId: entry.targetId }).catch(() => {});
      if (!pageIsClosed(entry.page)) await entry.page.close().catch(() => {});
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

function requireSessionId(input: Pick<SessionKeyInput, 'session' | 'sessionId'>): string {
  return input.sessionId?.trim() || requireSession(input.session);
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
