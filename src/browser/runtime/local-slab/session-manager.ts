import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser, BrowserContext, CDPSession, Page as PlaywrightPage } from 'playwright-core';
import { launchPersistentContext as cloakLaunchPersistentContext } from 'cloakbrowser';
import type { BrowserSurface, BrowserWindowMode, SiteSessionMode } from '../../protocol.js';
import { activateDarwinBackgroundContext, launchDarwinBackgroundPersistentContext } from './darwin-background-launch.js';
import { normalizeProfileId, resolveCloakProfileDir } from './profiles.js';
import { SlabNetworkCapture } from './network.js';
import { findPackageRoot } from '../../../package-paths.js';
import { findExactCloakProfileProcesses } from './process-matcher.js';
import { log } from '../../../logger.js';
import { CliError, EXIT_CODES } from '../../../errors.js';

const UNRESOLVED = Symbol('unresolved');
const TARGET_PAGE_MATCH_TIMEOUT_MS = 1_000;
export const PROFILE_IDLE_TIMEOUT_MS = 60_000;
export const PROFILE_CLOSE_TIMEOUT_MS = 3_000;
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
  sessionKind?: 'explicit' | 'adapter-default';
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
  sessionKind?: 'explicit' | 'adapter-default';
  adapterSite?: string;
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
  profileId: string;
  context: BrowserContext;
  cdp?: CDPSession;
  sessions: Map<string, SessionRuntime>;
  windowOwners: Map<number, string>;
  targetPages: Map<string, PageEntry>;
  userDataDir: string;
  anchorTargetId?: string;
  parkingPage?: PlaywrightPage;
  useParkingKeeper: boolean;
  keeperWarningLogged: boolean;
  activeCommands: number;
  idleTimer?: ReturnType<typeof setTimeout>;
  handoffTimer?: ReturnType<typeof setTimeout>;
  closing: boolean;
  disposed: boolean;
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

export class SessionWindowConflictError extends CliError {
  constructor(pageId: string, sessionId: string, owner?: string) {
    super(
      'SESSION_WINDOW_CONFLICT',
      `Page ${pageId} is in a window owned by Session ${owner ?? 'unknown'}, not ${sessionId}.`,
      undefined,
      EXIT_CODES.TEMPFAIL,
    );
  }
}

export interface SlabSessionManagerOptions {
  baseDir?: string;
  launchPersistentContext?: LaunchPersistentContext;
  launchBackgroundPersistentContext?: LaunchPersistentContext;
  activateBackgroundContext?: typeof activateDarwinBackgroundContext;
  recoverLockedProfile?: RecoverLockedProfile;
  platform?: NodeJS.Platform;
  hasActiveHandoff?: (profileId: string) => boolean;
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function daemonShuttingDownError(): Error & { code: 'DAEMON_SHUTTING_DOWN' } {
  return Object.assign(new Error('The browser daemon is shutting down.'), { code: 'DAEMON_SHUTTING_DOWN' as const });
}

export class SlabSessionManager {
  readonly networkCapture = new SlabNetworkCapture();

  private readonly launchPersistentContext: LaunchPersistentContext;
  private readonly launchBackgroundPersistentContext: LaunchPersistentContext;
  private readonly activateBackgroundContext: typeof activateDarwinBackgroundContext;
  private readonly platform: NodeJS.Platform;
  private readonly recoverLockedProfile: RecoverLockedProfile;
  private readonly hasActiveHandoff: (profileId: string) => boolean;
  private readonly profiles = new Map<string, ProfileRuntime>();
  private readonly profileLaunches = new Map<string, Promise<ProfileRuntime>>();
  private readonly profileLifecycleQueues = new Map<string, Promise<void>>();
  private readonly profileActivities = new Map<string, number>();
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
  private shuttingDown = false;

  constructor(private readonly opts: SlabSessionManagerOptions = {}) {
    this.launchPersistentContext = opts.launchPersistentContext ?? cloakLaunchPersistentContext;
    this.launchBackgroundPersistentContext = opts.launchBackgroundPersistentContext ?? launchDarwinBackgroundPersistentContext;
    this.activateBackgroundContext = opts.activateBackgroundContext ?? activateDarwinBackgroundContext;
    this.platform = opts.platform ?? process.platform;
    this.recoverLockedProfile = opts.recoverLockedProfile ?? recoverLockedCloakProfile;
    this.hasActiveHandoff = opts.hasActiveHandoff ?? (() => false);
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

  async runWithProfileActivity<T>(profileIdInput: string | undefined, task: () => Promise<T>): Promise<T> {
    const profileId = normalizeProfileId(profileIdInput);
    await this.withProfileLifecycleLock(profileId, async () => {
      this.assertRunning();
      const count = (this.profileActivities.get(profileId) ?? 0) + 1;
      this.profileActivities.set(profileId, count);
      const runtime = this.profiles.get(profileId);
      if (runtime) {
        runtime.activeCommands = count;
        this.cancelProfileIdle(runtime);
      }
    });
    try {
      return await task();
    } finally {
      await this.withProfileLifecycleLock(profileId, async () => {
        const count = Math.max(0, (this.profileActivities.get(profileId) ?? 1) - 1);
        if (count === 0) this.profileActivities.delete(profileId);
        else this.profileActivities.set(profileId, count);
        const runtime = this.profiles.get(profileId);
        if (runtime) {
          runtime.activeCommands = count;
          this.scheduleProfileIdle(profileId, runtime);
        }
      });
    }
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
        sessionKind: input.sessionKind,
        adapterSite: input.adapterSite,
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

  pageOwner(pageId: string): { profileId: string; session: string; surface: BrowserSurface; sessionKind?: 'explicit' | 'adapter-default'; adapterSite?: string } | null {
    for (const [profileId, runtime] of this.profiles.entries()) {
      for (const entry of runtime.targetPages.values()) {
        if (entry.pageId === pageId && !pageIsClosed(entry.page)) {
          return {
            profileId,
            session: entry.session,
            surface: entry.surface,
            sessionKind: entry.sessionKind,
            adapterSite: entry.adapterSite,
          };
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
    return this.newPageAttempt(input, 0);
  }

  async navigatePage(input: SessionKeyInput, url: string, waitUntil: 'load' | 'commit'): Promise<CloakPageLease> {
    return this.navigatePageAttempt(input, url, waitUntil, 0);
  }

  private async newPageAttempt(input: SessionKeyInput & { url?: string }, attempt: number): Promise<CloakPageLease> {
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
        if (attempt === 0 && isClosedContextError(error)) {
          this.invalidateProfileRuntime(profileId, acquired.runtime);
          if (!pageIsClosed(acquired.page)) await acquired.page.close().catch(() => {});
          return this.newPageAttempt(input, 1);
        }
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
      sessionKind: input.sessionKind,
      adapterSite: input.adapterSite,
      idleTimeout: input.idleTimeout,
    });
    const leaseKey = entry.leaseKey;
    this.refreshIdleTimer(acquired.runtime, acquired.sessionRuntime, leaseKey, entry);
    this.selectEntry(acquired.sessionRuntime, entry);
    acquired.runtime.lastSeenAt = Date.now();
    return { profileId, leaseKey, context: acquired.runtime.context, page: acquired.page, pageId: entry.pageId };
  }

  private async navigatePageAttempt(input: SessionKeyInput, url: string, waitUntil: 'load' | 'commit', attempt: number): Promise<CloakPageLease> {
    const profileId = normalizeProfileId(input.profileId);
    const lease = await this.getPage(input);
    const runtime = this.profiles.get(profileId);
    try {
      await lease.page.goto(url, { waitUntil });
      return lease;
    } catch (error) {
      if (attempt !== 0 || !isClosedContextError(error)) throw error;
      if (runtime?.context === lease.context) this.invalidateProfileRuntime(profileId, runtime);
      if (!pageIsClosed(lease.page)) await lease.page.close().catch(() => {});
      return this.navigatePageAttempt(input, url, waitUntil, 1);
    }
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

  async foregroundSession(profileIdInput: string, sessionId: string): Promise<boolean> {
    const profileId = normalizeProfileId(profileIdInput);
    const runtime = this.profiles.get(profileId);
    const session = runtime?.sessions.get(sessionId);
    if (!runtime || !session) return false;
    const entries = this.openEntries(session);
    const match = entries.find(([, entry]) => entry.pageId === session.selectedPageId) ?? entries[0];
    if (!match) return false;
    const entry = match[1];
    await this.assertOwnedWindow(runtime, sessionId, entry);
    await entry.page.bringToFront?.().catch(() => {});
    await this.activateBackgroundContext(runtime.context);
    this.selectEntry(session, entry);
    runtime.lastSeenAt = Date.now();
    return true;
  }

  async bindPage(input: SessionKeyInput & { pageId?: string; index?: number }): Promise<CloakPageLease | null> {
    const profileId = normalizeProfileId(input.profileId);
    const session = requireSession(input.session);
    const sessionId = requireSessionId(input);
    const surface = normalizeSurface(input.surface);
    const runtime = this.profiles.get(profileId);
    if (!runtime) return null;
    const existingSession = runtime.sessions.get(sessionId);
    let match = input.pageId
      ? this.findEntryByPageId(runtime, input.pageId)
      : existingSession && this.openEntries(existingSession)[input.index ?? -1];
    if (!match && input.index !== undefined) {
      const candidates: PlaywrightPage[] = [];
      for (const candidate of runtime.context.pages()) {
        if (pageIsClosed(candidate) || candidate === runtime.parkingPage) continue;
        if (await this.targetIdForPage(runtime, candidate) === runtime.anchorTargetId) continue;
        candidates.push(candidate);
      }
      const page = candidates[input.index];
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
    if (entry.sessionId && entry.sessionId !== sessionId) {
      throw new SessionWindowConflictError(entry.pageId, sessionId, entry.sessionId);
    }
    const sessionRuntime = existingSession ?? this.getSessionRuntime(runtime, sessionId);
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
    await Promise.all(entries.map(async ([, entry]) => {
      try {
        await this.assertOwnedWindow(runtime, session, entry);
      } catch (error) {
        if (!pageIsClosed(entry.page)) throw error;
      }
    }));
    for (const [, entry] of entries) await this.removeEntry(runtime, sessionRuntime, entry, true);
    if (entries.length > 0) runtime.lastSeenAt = Date.now();
    return entries.length;
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    while (this.profileLaunches.size > 0) {
      await Promise.allSettled([...this.profileLaunches.values()]);
    }
    await Promise.all([...this.profiles.keys()].map(profileId => this.withProfileLifecycleLock(profileId, async () => {
      const runtime = this.profiles.get(profileId);
      if (!runtime) return;
      this.profiles.delete(profileId);
      runtime.closing = true;
      await this.closeRuntime(runtime, false).catch(() => {});
    })));
    this.profiles.clear();
    this.profileLaunches.clear();
    this.profileActivities.clear();
  }

  private async getProfileRuntime(profileId: string, windowMode?: BrowserWindowMode): Promise<ProfileRuntime> {
    return this.withProfileLifecycleLock(profileId, async () => {
      this.assertRunning();
      const existing = this.profiles.get(profileId);
      if (existing && !existing.closing) {
        this.cancelProfileIdle(existing);
        return existing;
      }
      const launch = this.launchProfileRuntime(profileId, windowMode);
      this.profileLaunches.set(profileId, launch);
      try {
        return await launch;
      } finally {
        if (this.profileLaunches.get(profileId) === launch) this.profileLaunches.delete(profileId);
      }
    });
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
    let cdp: CDPSession | undefined;
    let keeperError: unknown;
    try {
      cdp = await browser?.newBrowserCDPSession();
    } catch (error) {
      keeperError = error;
    }
    const runtime: ProfileRuntime = {
      profileId,
      context,
      cdp,
      sessions: new Map(),
      windowOwners: new Map(),
      targetPages: new Map(),
      userDataDir,
      useParkingKeeper: this.platform !== 'darwin' || !cdp,
      keeperWarningLogged: false,
      activeCommands: this.profileActivities.get(profileId) ?? 0,
      closing: false,
      disposed: false,
      lastSeenAt: Date.now(),
    };
    this.pendingTargetPages.set(runtime, new Map());
    this.targetPageWaiters.set(runtime, new Map());
    this.attachRuntimeLifecycle(profileId, runtime);
    if (cdp) {
      try {
        runtime.anchorTargetId = (await cdp.send('Target.createTarget', {
          url: 'about:blank',
          hidden: true,
          background: true,
        }) as { targetId: string }).targetId;
      } catch (error) {
        this.warnKeeperFallback(profileId, runtime, error);
      }
    } else {
      this.warnKeeperFallback(profileId, runtime, keeperError ?? new Error('browser connection unavailable'));
    }
    if (this.shuttingDown) {
      runtime.closing = true;
      await this.closeRuntime(runtime, false).catch(() => {});
      throw daemonShuttingDownError();
    }
    this.profiles.set(profileId, runtime);
    return runtime;
  }

  private invalidateProfileRuntime(profileId: string, runtime: ProfileRuntime): void {
    if (this.profiles.get(profileId) === runtime) this.profiles.delete(profileId);
    this.cleanupRuntime(runtime);
  }

  private cleanupRuntime(runtime: ProfileRuntime): void {
    if (runtime.disposed) return;
    runtime.disposed = true;
    this.cancelProfileIdle(runtime);
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
    void runtime.cdp?.detach().catch(() => {});
  }

  private attachRuntimeLifecycle(profileId: string, runtime: ProfileRuntime): void {
    runtime.context.on('close', () => this.invalidateProfileRuntime(profileId, runtime));
    runtime.context.on('page', page => {
      void this.handleContextPage(runtime, page).catch(() => {});
    });
    const onCdpEvent = (runtime.cdp as (CDPSession & {
      on?: (event: string, listener: (payload: { targetId: string }) => void) => void;
    }) | undefined)?.on;
    onCdpEvent?.call(runtime.cdp, 'Target.targetDestroyed', ({ targetId }: { targetId: string }) => {
      this.queueAnchorRepair(profileId, runtime, targetId);
    });
  }

  private queueAnchorRepair(profileId: string, runtime: ProfileRuntime, destroyedTargetId: string): void {
    if (runtime.anchorTargetId !== destroyedTargetId) return;
    runtime.anchorTargetId = undefined;
    void this.withProfileLifecycleLock(profileId, async () => {
      if (this.shuttingDown || runtime.closing || this.profiles.get(profileId) !== runtime) return;
      if (runtime.anchorTargetId !== undefined) return;
      await this.repairAnchor(profileId, runtime);
    });
  }

  private async repairAnchor(profileId: string, runtime: ProfileRuntime): Promise<void> {
    if (!runtime.cdp) return;
    try {
      runtime.anchorTargetId = (await runtime.cdp.send('Target.createTarget', {
        url: 'about:blank',
        hidden: true,
        background: true,
      }) as { targetId: string }).targetId;
    } catch (error) {
      this.warnKeeperFallback(profileId, runtime, error);
    }
  }

  private warnKeeperFallback(profileId: string, runtime: ProfileRuntime, error: unknown): void {
    runtime.useParkingKeeper = true;
    if (runtime.keeperWarningLogged) return;
    runtime.keeperWarningLogged = true;
    log.warn(`Cloak Profile ${profileId} hidden keeper unavailable; using a parking page: ${errorMessage(error)}`);
  }

  private scheduleProfileIdle(profileId: string, runtime: ProfileRuntime): void {
    if (this.profiles.get(profileId) !== runtime || runtime.closing || runtime.idleTimer || runtime.handoffTimer) return;
    if (runtime.activeCommands > 0 || this.hasVisiblePages(runtime)) return;
    if (this.hasActiveHandoff(profileId)) {
      this.scheduleHandoffWake(profileId, runtime);
      return;
    }
    runtime.idleTimer = setTimeout(() => {
      runtime.idleTimer = undefined;
      void this.withProfileLifecycleLock(profileId, async () => {
        if (this.profiles.get(profileId) !== runtime || runtime.closing) return;
        if (runtime.activeCommands > 0 || this.hasVisiblePages(runtime)) return;
        if (this.hasActiveHandoff(profileId)) {
          this.scheduleHandoffWake(profileId, runtime);
          return;
        }
        runtime.closing = true;
        this.profiles.delete(profileId);
        await this.closeRuntime(runtime, true);
      });
    }, PROFILE_IDLE_TIMEOUT_MS);
    runtime.idleTimer.unref?.();
  }

  private scheduleHandoffWake(profileId: string, runtime: ProfileRuntime): void {
    runtime.handoffTimer = setTimeout(() => {
      runtime.handoffTimer = undefined;
      this.scheduleProfileIdle(profileId, runtime);
    }, PROFILE_IDLE_TIMEOUT_MS);
    runtime.handoffTimer.unref?.();
  }

  private cancelProfileIdle(runtime: ProfileRuntime): void {
    if (runtime.idleTimer) clearTimeout(runtime.idleTimer);
    if (runtime.handoffTimer) clearTimeout(runtime.handoffTimer);
    runtime.idleTimer = undefined;
    runtime.handoffTimer = undefined;
  }

  private hasVisiblePages(runtime: ProfileRuntime): boolean {
    for (const session of runtime.sessions.values()) {
      if (this.openEntries(session).length > 0) return true;
    }
    return false;
  }

  private async closeRuntime(runtime: ProfileRuntime, recoverOnTimeout: boolean): Promise<void> {
    this.cancelProfileIdle(runtime);
    for (const entry of runtime.targetPages.values()) this.clearIdleTimer(entry);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        runtime.context.close(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('Cloak Profile close timed out')), PROFILE_CLOSE_TIMEOUT_MS);
          timeout.unref?.();
        }),
      ]);
    } catch (error) {
      if (recoverOnTimeout && error instanceof Error && error.message === 'Cloak Profile close timed out') {
        await this.recoverLockedProfile(runtime.userDataDir);
      } else {
        throw error;
      }
    } finally {
      if (timeout) clearTimeout(timeout);
      this.cleanupRuntime(runtime);
    }
  }

  private async withProfileLifecycleLock<T>(profileId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.profileLifecycleQueues.get(profileId);
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queue = (previous ?? Promise.resolve()).then(() => released);
    this.profileLifecycleQueues.set(profileId, queue);
    if (previous) await previous.catch(() => {});
    try {
      return await operation();
    } finally {
      release();
      if (this.profileLifecycleQueues.get(profileId) === queue) this.profileLifecycleQueues.delete(profileId);
    }
  }

  private assertRunning(): void {
    if (this.shuttingDown) throw daemonShuttingDownError();
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
    const openerEntry = this.openEntries(session)[0]?.[1];
    if (!openerEntry) return await this.findReusableLaunchPage(runtime, session.id) ?? this.createWindowPage(runtime, windowMode);
    await this.assertOwnedWindow(runtime, session.id, openerEntry);
    const opener = openerEntry.page;
    const openerWindowId = await this.windowIdForTarget(runtime, openerEntry.targetId, opener);
    const targetUrl = `about:blank#webcmd-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const openedPage = this.waitForContextPageForSession(runtime, session.id, openerWindowId, targetUrl, TARGET_PAGE_MATCH_TIMEOUT_MS);

    try {
      await opener.evaluate((url) => window.open(url, '_blank', 'noopener,noreferrer'), targetUrl);
    } catch (error) {
      log.warn(`Cloak window.open failed while creating a Session tab; falling back to a new window: ${errorMessage(error)}`);
    }
    const page = await openedPage;
    if (page) return page;
    return this.createWindowPage(runtime, windowMode);
  }

  private async findReusableLaunchPage(runtime: ProfileRuntime, sessionId: string): Promise<PlaywrightPage | undefined> {
    for (const page of runtime.context.pages()) {
      if (pageIsClosed(page) || page === runtime.parkingPage || page.url() !== 'about:blank') continue;
      const targetId = await this.targetIdForPage(runtime, page).catch(() => undefined);
      if (!targetId || targetId === runtime.anchorTargetId || runtime.targetPages.has(targetId)) continue;
      const windowId = await this.windowIdForTarget(runtime, targetId, page).catch(() => undefined);
      if (windowId === undefined) continue;
      const owner = runtime.windowOwners.get(windowId);
      if (owner === undefined || owner === sessionId) return page;
    }
    return undefined;
  }

  private async waitForContextPageForSession(
    runtime: ProfileRuntime,
    sessionId: string,
    openerWindowId: number,
    targetUrl: string,
    timeoutMs: number,
  ): Promise<PlaywrightPage | null> {
    return new Promise((resolve) => {
      let settled = false;
      const done = (page: PlaywrightPage | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        runtime.context.off('page', onPage);
        resolve(page);
      };
      const tryPage = async (page: PlaywrightPage) => {
        if (settled || pageIsClosed(page)) return;
        const targetId = await this.targetIdForPage(runtime, page).catch(() => undefined);
        if (!targetId) return;
        const actualWindowId = await this.windowIdForTarget(runtime, targetId, page).catch(() => undefined);
        if (actualWindowId === undefined) return;
        const owner = runtime.windowOwners.get(actualWindowId);
        if (owner !== undefined && owner !== sessionId) return;
        if (page.url() !== targetUrl) return;
        done(page);
      };
      const onPage = (page: PlaywrightPage) => { void tryPage(page); };
      const timer = setTimeout(() => done(null), timeoutMs);
      runtime.context.on('page', onPage);
      for (const page of this.pendingTargetPages.get(runtime)?.values() ?? []) void tryPage(page);
    });
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

  private async createWindowPage(runtime: ProfileRuntime, windowMode?: BrowserWindowMode, newWindow = true): Promise<PlaywrightPage> {
    if (!runtime.cdp) return runtime.context.newPage();
    const result = await runtime.cdp.send('Target.createTarget', {
      url: 'about:blank',
      newWindow,
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
    if (targetId === runtime.anchorTargetId) {
      page.once('close', () => {
        this.queueAnchorRepair(runtime.profileId, runtime, targetId);
      });
      return;
    }
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
      sessionKind: openerEntry.sessionKind,
      adapterSite: openerEntry.adapterSite,
      idleTimeout: openerEntry.idleTimeout,
    });
  }

  private async registerOwnedPage(
    runtime: ProfileRuntime,
    session: SessionRuntime,
    page: PlaywrightPage,
    input: Pick<PageEntry, 'session' | 'surface' | 'siteSession' | 'sessionKind' | 'adapterSite' | 'idleTimeout'> & { leaseKey?: string },
  ): Promise<PageEntry> {
    const targetId = await this.targetIdForPage(runtime, page);
    this.pendingTargetPages.get(runtime)?.delete(targetId);
    const windowId = await this.windowIdForTarget(runtime, targetId, page);
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
        sessionKind: input.sessionKind,
        adapterSite: input.adapterSite,
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
      entry.sessionKind = input.sessionKind;
      entry.adapterSite = input.adapterSite;
      entry.idleTimeout = input.idleTimeout;
      entry.leaseKey = input.leaseKey ?? (entry.leaseKey.startsWith('unowned\u0000') ? `page\u0000${entry.pageId}` : entry.leaseKey);
    }
    session.pages.set(entry.leaseKey, entry);
    this.cancelProfileIdle(runtime);
    this.refreshIdleTimer(runtime, session, entry.leaseKey, entry);
    if (!wasOwned) for (const listener of this.sessionPageListeners.get(session) ?? []) listener(page);
    await this.closeParkingPage(runtime);
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
      if (runtime.parkingPage === entry.page) runtime.parkingPage = undefined;
      this.scheduleProfileIdle(runtime.profileId, runtime);
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

  private async windowIdForTarget(runtime: ProfileRuntime, targetId: string, page?: PlaywrightPage): Promise<number> {
    const entry = runtime.targetPages.get(targetId);
    const targetPage = page ?? entry?.page;
    const cdp = runtime.cdp ?? (targetPage ? this.pageCdpSessions.get(targetPage) : undefined);
    if (!cdp) throw new Error('Cloak page has no CDP session.');
    const { windowId } = await cdp.send('Browser.getWindowForTarget', { targetId }) as { windowId: number };
    return windowId;
  }

  private async assertOwnedWindow(runtime: ProfileRuntime, sessionId: string, entry: PageEntry): Promise<void> {
    const actual = await this.windowIdForTarget(runtime, entry.targetId, entry.page);
    const owner = runtime.windowOwners.get(actual);
    if (owner !== undefined && owner !== sessionId) {
      throw new SessionWindowConflictError(entry.pageId, sessionId, owner);
    }
    if (!runtime.sessions.get(sessionId)?.windowIds.has(actual)) {
      throw new SessionWindowConflictError(entry.pageId, sessionId, owner);
    }
  }

  private async assertBindableWindow(runtime: ProfileRuntime, session: SessionRuntime, entry: PageEntry): Promise<void> {
    if (entry.sessionId) {
      if (entry.sessionId !== session.id) {
        throw new SessionWindowConflictError(entry.pageId, session.id, entry.sessionId);
      }
      await this.assertOwnedWindow(runtime, session.id, entry);
      return;
    }
    const actual = await this.windowIdForTarget(runtime, entry.targetId, entry.page);
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
    const shouldPark = close && runtime.useParkingKeeper
      && [...runtime.targetPages.values()].every(candidate => candidate === entry || pageIsClosed(candidate.page));
    const parkingWindowId = shouldPark
      ? await this.windowIdForTarget(runtime, entry.targetId, entry.page).catch(() => undefined)
      : undefined;
    if (session.pages.get(entry.leaseKey) === entry) session.pages.delete(entry.leaseKey);
    runtime.targetPages.delete(entry.targetId);
    this.clearIdleTimer(entry);
    this.clearSelectedPage(session, entry);
    this.networkCapture.stop(entry.page);
    if (close && !pageIsClosed(entry.page)) {
      if (shouldPark) {
        await entry.page.goto('about:blank', { waitUntil: 'load' }).catch(() => {});
        entry.sessionId = undefined;
        runtime.parkingPage = pageIsClosed(entry.page) ? undefined : entry.page;
        if (parkingWindowId !== undefined) {
          runtime.windowOwners.delete(parkingWindowId);
          session.windowIds.delete(parkingWindowId);
          await runtime.cdp?.send('Browser.setWindowBounds', {
            windowId: parkingWindowId,
            bounds: { windowState: 'minimized' },
          }).catch(() => {});
        }
      } else {
        await runtime.cdp?.send('Target.closeTarget', { targetId: entry.targetId }).catch(() => {});
        if (!pageIsClosed(entry.page)) await entry.page.close().catch(() => {});
      }
    }
    this.scheduleProfileIdle(runtime.profileId, runtime);
  }

  private async closeParkingPage(runtime: ProfileRuntime): Promise<void> {
    const parkingPage = runtime.parkingPage;
    if (!parkingPage) return;
    runtime.parkingPage = undefined;
    if (!pageIsClosed(parkingPage)) await parkingPage.close().catch(() => {});
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
  const initial = await findExactCloakProfileProcesses(userDataDir);
  if (initial.length === 0) return false;

  signalPids(initial, 'SIGTERM');
  if (await waitForProfileProcessesToExit(userDataDir, 2500)) return true;

  signalPids(await findExactCloakProfileProcesses(userDataDir), 'SIGKILL');
  return waitForProfileProcessesToExit(userDataDir, 1500);
}

async function waitForProfileProcessesToExit(userDataDir: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    if ((await findExactCloakProfileProcesses(userDataDir)).length === 0) return true;
  }
  return (await findExactCloakProfileProcesses(userDataDir)).length === 0;
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
