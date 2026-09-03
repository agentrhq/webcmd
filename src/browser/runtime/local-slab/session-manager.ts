import type { Browser, BrowserContext, CDPSession, Page as PlaywrightPage } from 'playwright-core';
import type { BrowserSurface, BrowserWindowMode, SiteSessionMode } from '../../protocol.js';
import { normalizeProfileId } from './profiles.js';
import { SlabNetworkCapture } from './network.js';
import { log } from '../../../logger.js';
import { CliError, EXIT_CODES } from '../../../errors.js';
import { isClosedContextError } from '../../run/types.js';
import { disposeHumanizedPage, humanizePage } from '../../humanizer/page.js';
import { attachSlabProfile, type AttachedSlabProfile } from './attachment.js';
import type { DiscoveredBrowserWindowListRow } from '../../sessions.js';

const TARGET_PAGE_MATCH_TIMEOUT_MS = 1_000;
export const PROFILE_IDLE_TIMEOUT_MS = 60_000;
export const PROFILE_CLOSE_TIMEOUT_MS = 3_000;

export type AttachSlabProfile = typeof attachSlabProfile;

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

export type NewPageInput = SessionKeyInput & {
  url?: string;
  /**
   * Playwright `goto` readiness for `url`, already translated from the command
   * vocabulary by the caller. Defaults to 'load'; 'commit' skips waiting for the
   * load event on sites that never go idle.
   */
  waitUntil?: 'load' | 'commit';
};

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
  windowId: number;
  provenance: 'agent-created' | 'human-adopted';
  closeListener?: () => void;
};

export interface SlabPageLease {
  profileId: string;
  leaseKey: string;
  context: BrowserContext;
  page: PlaywrightPage;
  pageId: string;
}

export interface SlabTabInfo {
  id: string;
  page: string;
  index: number;
  title: string;
  url: string;
  profileId: string;
  session?: string;
  sessionId?: string;
  surface: BrowserSurface;
  selected: boolean;
  window: string;
  ownership: 'session' | 'unowned';
  provenance?: 'agent-created' | 'human-adopted';
  targetId?: string;
}

interface DiscoveredPage {
  pageId: string;
  windowId: number;
  targetId: string;
  title: string;
  url: string;
}

interface ProfileRuntime {
  profileId: string;
  attachment: AttachedSlabProfile;
  context: BrowserContext;
  cdp?: CDPSession;
  sessions: Map<string, SessionRuntime>;
  windowOwners: Map<number, string>;
  targetPages: Map<string, PageEntry>;
  anchorTargetId?: string;
  parkingPage?: PlaywrightPage;
  useParkingKeeper: boolean;
  keeperWarningLogged: boolean;
  activeCommands: number;
  idleTimer?: ReturnType<typeof setTimeout>;
  handoffTimer?: ReturnType<typeof setTimeout>;
  closing: boolean;
  disposed: boolean;
  releasePromise?: Promise<void>;
  lastSeenAt: number;
  generation: number;
  discoveredPages: Map<string, DiscoveredPage>;
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

export class AdoptedTabForceRequiredError extends CliError {
  constructor(pageId: string) {
    super(
      'ADOPTED_TAB_FORCE_REQUIRED',
      `Closing adopted human tab ${pageId} is destructive and requires --force.`,
      'Detach the Session normally to leave the human window open.',
      EXIT_CODES.USAGE_ERROR,
    );
  }
}

export class SlabAttachmentLostError extends Error {
  readonly code = 'SLAB_ATTACHMENT_LOST';

  constructor() {
    super('SLAB attachment was lost. Start a new browser session before retrying.');
    this.name = 'SlabAttachmentLostError';
  }
}

export interface SlabSessionManagerOptions {
  baseDir?: string;
  attachProfile?: AttachSlabProfile;
  hasActiveHandoff?: (profileId: string) => boolean;
  humanize?: typeof humanizePage;
}

let pageCounter = 0;
let attachmentGeneration = 0;

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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function daemonShuttingDownError(): Error & { code: 'DAEMON_SHUTTING_DOWN' } {
  return Object.assign(new Error('The browser daemon is shutting down.'), { code: 'DAEMON_SHUTTING_DOWN' as const });
}

function isBlankStartupUrl(url: string): boolean {
  return url === 'about:blank' || url === 'chrome://newtab/' || url === 'chrome://new-tab-page/';
}

export class SlabSessionManager {
  readonly networkCapture = new SlabNetworkCapture();

  private readonly attachProfile: AttachSlabProfile;
  private readonly hasActiveHandoff: (profileId: string) => boolean;
  private readonly humanize: typeof humanizePage;
  private readonly profiles = new Map<string, ProfileRuntime>();
  private readonly detachedSessions = new Map<string, Set<string>>();
  private readonly profileLaunches = new Map<string, Promise<ProfileRuntime>>();
  private readonly profileLifecycleQueues = new Map<string, Promise<void>>();
  private readonly profileActivities = new Map<string, number>();
  private readonly pageCreationQueues = new Map<string, Promise<void>>();
  private readonly pageTargetIds = new WeakMap<PlaywrightPage, string>();
  private readonly pageTargetIdPromises = new WeakMap<PlaywrightPage, Promise<string>>();
  private readonly pendingTargetPages = new WeakMap<ProfileRuntime, Map<string, PlaywrightPage>>();
  private readonly pendingTargetCloseListeners = new WeakMap<ProfileRuntime, Map<string, { page: PlaywrightPage; listener: () => void }>>();
  private readonly targetPageWaiters = new WeakMap<ProfileRuntime, Map<string, {
    resolve(page: PlaywrightPage): void;
    reject(error: Error): void;
    timer: ReturnType<typeof setTimeout>;
  }>>();
  private readonly sessionPageListeners = new WeakMap<SessionRuntime, Set<(page: PlaywrightPage) => void>>();
  private shuttingDown = false;

  constructor(private readonly opts: SlabSessionManagerOptions = {}) {
    this.attachProfile = opts.attachProfile ?? attachSlabProfile;
    this.hasActiveHandoff = opts.hasActiveHandoff ?? (() => false);
    this.humanize = opts.humanize ?? humanizePage;
  }

  profileStatuses() {
    return [...this.profiles.entries()].map(([contextId, runtime]) => ({
      contextId,
      runtimeConnected: true,
      runtimeVersion: runtime.attachment.browserVersion || undefined,
      pending: 0,
      lastSeenAt: runtime.lastSeenAt,
    }));
  }

  activeProfileIds(): string[] {
    return [...this.profiles.keys()];
  }

  async discoveredWindows(profileIdInput: string | undefined): Promise<DiscoveredBrowserWindowListRow[]> {
    const profileId = normalizeProfileId(profileIdInput);
    const runtime = await this.getProfileRuntime(profileId);
    const pages = (await this.discoverPages(runtime))
      .filter(page => runtime.windowOwners.get(page.windowId) === undefined);
    const byWindow = new Map<number, DiscoveredPage[]>();
    for (const page of pages) byWindow.set(page.windowId, [...(byWindow.get(page.windowId) ?? []), page]);
    const rows: DiscoveredBrowserWindowListRow[] = [...byWindow.entries()].map(([windowId, tabs]) => ({
      rowKind: 'discovered',
      profileId,
      runtimeState: 'available',
      window: this.windowIdentity(runtime, windowId),
      page: tabs[0]!.pageId,
      tabCount: tabs.length,
      title: tabs[0]!.title,
      url: tabs[0]!.url,
      ownership: 'unowned',
    }));
    this.scheduleProfileIdle(profileId, runtime);
    return rows;
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

  async getPage(input: SessionKeyInput): Promise<SlabPageLease> {
    const profileId = normalizeProfileId(input.profileId);
    const session = requireSession(input.session);
    const sessionId = requireSessionId(input);
    this.assertSessionAttached(profileId, sessionId);
    const surface = normalizeSurface(input.surface);
    const leaseKey = resolveLeaseKey(input);
    const freshPage = input.freshPage === true;
    return this.withPageCreationLock(profileId, async () => {
      const runtime = await this.getProfileRuntime(profileId, input.windowMode);
      const sessionRuntime = this.getSessionRuntime(runtime, sessionId);
      const existing = sessionRuntime.pages.get(leaseKey);
      if (existing && !pageIsClosed(existing.page) && !freshPage) {
        try {
          await this.assertOwnedWindow(runtime, sessionId, existing);
          runtime.lastSeenAt = Date.now();
          existing.idleTimeout = input.idleTimeout;
          this.refreshIdleTimer(runtime, sessionRuntime, leaseKey, existing);
          return { profileId, leaseKey, context: runtime.context, page: existing.page, pageId: existing.pageId };
        } catch (error) {
          if (!isClosedContextError(error)) throw error;
          // isClosed() reported false, but the liveness probe above shows the
          // underlying CDP connection is actually dead. Invalidate the Profile
          // runtime and fall through to acquire a fresh page instead of handing
          // the same broken lease back out (webcmd#314).
          this.invalidateProfileRuntime(profileId, runtime);
          if (!pageIsClosed(existing.page)) await existing.page.close().catch(() => {});
        }
      }
      const acquired = await this.acquireSessionPage(profileId, sessionId, input.windowMode);
      let entry: PageEntry;
      try {
        entry = await this.registerOwnedPage(acquired.runtime, acquired.session, acquired.page, {
          leaseKey,
          session,
          surface,
          siteSession: input.siteSession,
          sessionKind: input.sessionKind,
          adapterSite: input.adapterSite,
          idleTimeout: input.idleTimeout,
        });
      } catch (error) {
        if (!pageIsClosed(acquired.page)) await acquired.page.close().catch(() => {});
        throw error;
      }
      if (existing && freshPage && existing !== entry) await this.removeEntry(acquired.runtime, sessionRuntime, existing, true);
      this.selectEntry(acquired.session, entry);
      acquired.runtime.lastSeenAt = Date.now();
      return { profileId, leaseKey, context: acquired.runtime.context, page: entry.page, pageId: entry.pageId };
    });
  }

  async findPage(input: SessionKeyInput): Promise<SlabPageLease | null> {
    const profileId = normalizeProfileId(input.profileId);
    const sessionId = requireSessionId(input);
    this.assertSessionAttached(profileId, sessionId);
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

  async findPageById(pageId: string, opts: Pick<SessionKeyInput, 'profileId' | 'session' | 'sessionId' | 'surface' | 'idleTimeout'>): Promise<SlabPageLease | null> {
    const expectedProfileId = normalizeProfileId(opts.profileId);
    const sessionId = requireSessionId(opts);
    this.assertSessionAttached(expectedProfileId, sessionId);
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
    this.assertSessionAttached(profileId, sessionId);
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

  async listPages(input: Pick<SessionKeyInput, 'profileId' | 'session' | 'sessionId' | 'surface'>): Promise<SlabTabInfo[]> {
    const profileId = normalizeProfileId(input.profileId);
    const sessionId = requireSessionId(input);
    this.assertSessionAttached(profileId, sessionId);
    const surface = input.surface ? normalizeSurface(input.surface) : undefined;
    const runtime = await this.getProfileRuntime(profileId);
    const sessionRuntime = runtime.sessions.get(sessionId);
    const entries = (sessionRuntime ? this.openEntries(sessionRuntime) : [])
      .filter(([, entry]) => !surface || entry.surface === surface);
    await Promise.all(entries.map(([, entry]) => this.assertOwnedWindow(runtime, sessionId, entry)));
    const owned = await Promise.all(entries.map(async ([, entry], index) => ({
      id: entry.pageId,
      page: entry.pageId,
      index,
      title: await entry.page.title().catch(() => ''),
      url: entry.page.url(),
      profileId,
      session: entry.session,
      sessionId,
      surface: entry.surface,
      selected: sessionRuntime?.selectedPageId === entry.pageId,
      window: this.windowIdentity(runtime, entry.windowId),
      ownership: 'session' as const,
      provenance: entry.provenance,
      targetId: entry.targetId,
    })));
    const discovered = await this.discoverPages(runtime);
    const unowned = discovered
      .filter(candidate => runtime.windowOwners.get(candidate.windowId) === undefined)
      .map((candidate, index) => ({
        id: candidate.pageId,
        page: candidate.pageId,
        index: owned.length + index,
        title: candidate.title,
        url: candidate.url,
        profileId,
        surface: 'browser' as const,
        selected: false,
        window: this.windowIdentity(runtime, candidate.windowId),
        ownership: 'unowned' as const,
        targetId: candidate.targetId,
      }));
    return [...owned, ...unowned];
  }

  async newPage(input: NewPageInput): Promise<SlabPageLease> {
    return this.newPageAttempt(input, 0);
  }

  async navigatePage(input: SessionKeyInput, url: string, waitUntil: 'load' | 'commit'): Promise<SlabPageLease> {
    return this.navigatePageAttempt(input, url, waitUntil, 0);
  }

  private async newPageAttempt(input: NewPageInput, attempt: number): Promise<SlabPageLease> {
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
        await acquired.page.goto(input.url, { waitUntil: input.waitUntil ?? 'load' });
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
    let entry: PageEntry;
    try {
      entry = await this.registerOwnedPage(acquired.runtime, acquired.sessionRuntime, acquired.page, {
        session,
        surface,
        siteSession: input.siteSession,
        sessionKind: input.sessionKind,
        adapterSite: input.adapterSite,
        idleTimeout: input.idleTimeout,
      });
    } catch (error) {
      if (!pageIsClosed(acquired.page)) await acquired.page.close().catch(() => {});
      throw error;
    }
    const leaseKey = entry.leaseKey;
    this.refreshIdleTimer(acquired.runtime, acquired.sessionRuntime, leaseKey, entry);
    this.selectEntry(acquired.sessionRuntime, entry);
    acquired.runtime.lastSeenAt = Date.now();
    return { profileId, leaseKey, context: acquired.runtime.context, page: acquired.page, pageId: entry.pageId };
  }

  private async navigatePageAttempt(input: SessionKeyInput, url: string, waitUntil: 'load' | 'commit', attempt: number): Promise<SlabPageLease> {
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

  async selectPage(input: Pick<SessionKeyInput, 'profileId' | 'session' | 'sessionId' | 'surface' | 'windowMode'> & { pageId?: string; index?: number }): Promise<SlabPageLease | null> {
    const profileId = normalizeProfileId(input.profileId);
    const sessionId = requireSessionId(input);
    this.assertSessionAttached(profileId, sessionId);
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
    this.selectEntry(session, entry);
    runtime.lastSeenAt = Date.now();
    return true;
  }

  async bindPage(input: SessionKeyInput & { pageId?: string; targetId?: string; index?: number }): Promise<SlabPageLease | null> {
    const profileId = normalizeProfileId(input.profileId);
    const session = requireSession(input.session);
    const sessionId = requireSessionId(input);
    this.assertSessionAttached(profileId, sessionId);
    const surface = normalizeSurface(input.surface);
    const runtime = await this.getProfileRuntime(profileId);
    return this.withPageCreationLock(profileId, async () => {
      if (runtime.disposed || this.profiles.get(profileId) !== runtime) {
        throw new SlabAttachmentLostError();
      }
    const existingSession = runtime.sessions.get(sessionId);
    const discovered = input.pageId ? runtime.discoveredPages.get(input.pageId) : undefined;
    const targetId = input.targetId?.trim() ?? discovered?.targetId;
    const existingEntry = input.pageId
      ? this.findEntryByPageId(runtime, input.pageId)?.[1]
      : targetId
        ? runtime.targetPages.get(targetId)
        : existingSession && this.openEntries(existingSession)[input.index ?? -1]?.[1];
    const page = existingEntry?.page ?? (targetId ? await this.findPageByTargetId(runtime, targetId) : undefined);
    if (!page || pageIsClosed(page)) return null;
    const selectedTargetId = await this.targetIdForPage(runtime, page);
    const windowId = await this.windowIdForTarget(runtime, selectedTargetId, page);
    if (discovered && discovered.windowId !== windowId) return null;
    const owner = runtime.windowOwners.get(windowId);
    if (owner !== undefined && owner !== sessionId) {
      throw new SessionWindowConflictError(input.pageId ?? targetId ?? 'unknown', sessionId, owner);
    }
    if (existingSession && existingSession.windowIds.size > 0 && !existingSession.windowIds.has(windowId)) {
      throw new SessionWindowConflictError(input.pageId ?? targetId ?? 'unknown', sessionId, sessionId);
    }
    const sessionRuntime = existingSession ?? this.getSessionRuntime(runtime, sessionId);
    const canonicalKey = resolveLeaseKey(input);
    const currentCanonical = sessionRuntime.pages.get(canonicalKey);
    const sessionPagesSnapshot = new Map(sessionRuntime.pages);
    const windowIdsSnapshot = new Set(sessionRuntime.windowIds);
    const windowOwnersSnapshot = new Map(runtime.windowOwners);
    const targetPagesSnapshot = new Map(runtime.targetPages);
    const entrySnapshots = new Map([...runtime.targetPages.values()].map(entry => [entry, {
      value: { ...entry, idleTimer: undefined },
      hadIdleTimer: entry.idleTimer !== undefined,
    }]));
    const selectedPageIdSnapshot = sessionRuntime.selectedPageId;
    const restoreTransaction = () => {
      sessionRuntime.pages.clear();
      for (const [key, value] of sessionPagesSnapshot) sessionRuntime.pages.set(key, value);
      sessionRuntime.windowIds.clear();
      for (const id of windowIdsSnapshot) sessionRuntime.windowIds.add(id);
      runtime.windowOwners.clear();
      for (const [id, value] of windowOwnersSnapshot) runtime.windowOwners.set(id, value);
      runtime.targetPages.clear();
      for (const [id, value] of targetPagesSnapshot) runtime.targetPages.set(id, value);
      sessionRuntime.selectedPageId = selectedPageIdSnapshot;
      for (const [entry, snapshot] of entrySnapshots) {
        this.clearIdleTimer(entry);
        Object.assign(entry, snapshot.value);
        if (snapshot.hadIdleTimer) this.refreshIdleTimer(runtime, sessionRuntime, entry.leaseKey, entry);
      }
      if (!existingSession && sessionPagesSnapshot.size === 0) runtime.sessions.delete(sessionId);
    };

    if (input.windowMode === 'foreground') {
      await page.bringToFront?.().catch(() => {});
    }

    if (currentCanonical && currentCanonical.page !== page && !pageIsClosed(currentCanonical.page)) {
      const preservedKey = `${canonicalKey}\u0000${currentCanonical.pageId}`;
      sessionRuntime.pages.delete(canonicalKey);
      currentCanonical.leaseKey = preservedKey;
      sessionRuntime.pages.set(preservedKey, currentCanonical);
      this.refreshIdleTimer(runtime, sessionRuntime, preservedKey, currentCanonical);
    }

    const siblings: PlaywrightPage[] = [];
    for (const candidate of runtime.context.pages()) {
      if (pageIsClosed(candidate)) continue;
      const candidateTargetId = await this.targetIdForPageInWindow(runtime, candidate, windowId);
      if (!candidateTargetId) continue;
      if (candidateTargetId === runtime.anchorTargetId) continue;
      siblings.push(candidate);
    }
    const newlyHumanized: PlaywrightPage[] = [];
    try {
      for (const sibling of siblings) {
        if (!(sibling as unknown as { _original?: unknown })._original) {
          this.humanize(sibling);
          newlyHumanized.push(sibling);
        }
      }
    } catch (error) {
      await Promise.all(newlyHumanized.map(sibling => disposeHumanizedPage(sibling)));
      await Promise.all(siblings.map(sibling => this.detachPageCdp(sibling)));
      restoreTransaction();
      throw error;
    }
    let owned: PageEntry | undefined;
    const registered: PageEntry[] = [];
    try {
      for (const sibling of siblings) {
        if (pageIsClosed(sibling)) throw new Error('SLAB bind target disappeared during window adoption.');
        const entry = await this.registerOwnedPage(runtime, sessionRuntime, sibling, {
        ...(sibling === page ? { leaseKey: canonicalKey } : {}),
        session,
        surface,
        siteSession: input.siteSession,
        sessionKind: input.sessionKind,
        adapterSite: input.adapterSite,
        idleTimeout: input.idleTimeout,
        provenance: [...runtime.targetPages.values()].find(candidate => candidate.page === sibling)?.provenance ?? 'human-adopted',
        humanize: false,
      });
        registered.push(entry);
        if (sibling === page) owned = entry;
      }
    } catch (error) {
      for (const entry of registered) {
        if (!entrySnapshots.has(entry)) await this.removeEntry(runtime, sessionRuntime, entry, false);
      }
      await Promise.all(newlyHumanized.map(sibling => disposeHumanizedPage(sibling)));
      await Promise.all(siblings.map(sibling => this.detachPageCdp(sibling)));
      restoreTransaction();
      throw error;
    }
    if (!owned) {
      for (const entry of registered) {
        if (!entrySnapshots.has(entry)) await this.removeEntry(runtime, sessionRuntime, entry, false);
      }
      await Promise.all(newlyHumanized.map(sibling => disposeHumanizedPage(sibling)));
      await Promise.all(siblings.map(sibling => this.detachPageCdp(sibling)));
      restoreTransaction();
      return null;
    }
    this.selectEntry(sessionRuntime, owned);
    runtime.lastSeenAt = Date.now();
    return { profileId, leaseKey: canonicalKey, context: runtime.context, page: owned.page, pageId: owned.pageId };
    });
  }

  async closePage(input: Pick<SessionKeyInput, 'profileId' | 'session' | 'sessionId' | 'surface'> & { pageId?: string; index?: number; force?: boolean }): Promise<string | null> {
    const profileId = normalizeProfileId(input.profileId);
    const sessionId = requireSessionId(input);
    this.assertSessionAttached(profileId, sessionId);
    const runtime = this.profiles.get(profileId);
    if (!runtime) return null;
    const sessionRuntime = runtime.sessions.get(sessionId);
    if (!sessionRuntime) return null;
    const candidates = this.sessionEntries(sessionRuntime, input);
    const match = input.pageId ? candidates.find(([, entry]) => entry.pageId === input.pageId) : candidates[input.index ?? -1];
    if (!match) return null;
    const [, entry] = match;
    await this.assertOwnedWindow(runtime, sessionId, entry);
    if (entry.provenance === 'human-adopted' && input.force !== true) {
      throw new AdoptedTabForceRequiredError(entry.pageId);
    }
    await this.removeEntry(runtime, sessionRuntime, entry, true, input.force === true);
    runtime.lastSeenAt = Date.now();
    return entry.pageId;
  }

  async release(input: SessionKeyInput): Promise<void> {
    const profileId = normalizeProfileId(input.profileId);
    const sessionId = requireSessionId(input);
    this.assertSessionAttached(profileId, sessionId);
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
      if (entry.siteSession === 'persistent' || entry.provenance === 'human-adopted') continue;
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

  /**
   * Invalidates the Profile runtime backing `context`, if it's still the active
   * one, without evicting or retrying the command that observed it. Used by the
   * `run` action (webcmd#314) when a post-run snapshot capture surfaces a
   * closed-context signature: the run itself may have genuinely succeeded, but
   * the connection is dying, so the next command on this Session shouldn't be
   * handed the same lease.
   */
  invalidateIfClosedContext(profileId: string, context: BrowserContext): void {
    const runtime = this.profiles.get(profileId);
    if (runtime?.context === context) this.invalidateProfileRuntime(profileId, runtime);
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
      await this.closeRuntime(runtime).catch(() => {});
    })));
    this.profiles.clear();
    this.detachedSessions.clear();
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

  private async launchProfileRuntime(profileId: string, _windowMode?: BrowserWindowMode): Promise<ProfileRuntime> {
    const attachment = await this.attachProfile(profileId);
    const { context, browser } = attachment;
    let cdp: CDPSession | undefined;
    let keeperError: unknown;
    try {
      cdp = await browser?.newBrowserCDPSession();
    } catch (error) {
      keeperError = error;
    }
    const runtime: ProfileRuntime = {
      profileId,
      attachment,
      context,
      cdp,
      sessions: new Map(),
      windowOwners: new Map(),
      targetPages: new Map(),
      useParkingKeeper: !cdp,
      keeperWarningLogged: false,
      activeCommands: this.profileActivities.get(profileId) ?? 0,
      closing: false,
      disposed: false,
      lastSeenAt: Date.now(),
      generation: ++attachmentGeneration,
      discoveredPages: new Map(),
    };
    this.pendingTargetPages.set(runtime, new Map());
    this.pendingTargetCloseListeners.set(runtime, new Map());
    this.targetPageWaiters.set(runtime, new Map());
    this.attachRuntimeLifecycle(profileId, runtime);
    if (!cdp) {
      this.warnKeeperFallback(profileId, runtime, keeperError ?? new Error('browser connection unavailable'));
    }
    if (this.shuttingDown) {
      runtime.closing = true;
      await this.closeRuntime(runtime).catch(() => {});
      throw daemonShuttingDownError();
    }
    this.profiles.set(profileId, runtime);
    return runtime;
  }

  private invalidateProfileRuntime(profileId: string, runtime: ProfileRuntime): void {
    if (this.profiles.get(profileId) === runtime) this.profiles.delete(profileId);
    const detached = this.detachedSessions.get(profileId) ?? new Set<string>();
    for (const sessionId of runtime.sessions.keys()) detached.add(sessionId);
    if (detached.size > 0) this.detachedSessions.set(profileId, detached);
    void this.releaseRuntime(runtime, false, true).catch(error => {
      log.warn(`SLAB Profile ${profileId} release failed: ${errorMessage(error)}`);
    });
  }

  private async cleanupRuntime(runtime: ProfileRuntime): Promise<void> {
    if (runtime.disposed) return;
    runtime.disposed = true;
    this.cancelProfileIdle(runtime);
    const humanizerDisposals: Promise<void>[] = [];
    for (const entry of runtime.targetPages.values()) {
      if (entry.idleTimer) clearTimeout(entry.idleTimer);
      this.networkCapture.stop(entry.page);
      humanizerDisposals.push(disposeHumanizedPage(entry.page));
    }
    runtime.targetPages.clear();
    runtime.discoveredPages.clear();
    runtime.sessions.clear();
    runtime.windowOwners.clear();
    this.pendingTargetPages.get(runtime)?.clear();
    for (const { page, listener } of this.pendingTargetCloseListeners.get(runtime)?.values() ?? []) page.off('close', listener);
    this.pendingTargetCloseListeners.get(runtime)?.clear();
    for (const waiter of this.targetPageWaiters.get(runtime)?.values() ?? []) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error('Target page, context or browser has been closed'));
    }
    this.targetPageWaiters.get(runtime)?.clear();
    await Promise.all(humanizerDisposals);
  }

  private attachRuntimeLifecycle(profileId: string, runtime: ProfileRuntime): void {
    runtime.context.on('close', () => this.invalidateProfileRuntime(profileId, runtime));
    runtime.context.on('page', page => {
      void this.handleContextPage(runtime, page).catch(() => {});
    });
    const onCdpEvent = (runtime.cdp as (CDPSession & {
      on?: (event: string, listener: (payload: any) => void) => void;
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

  private async ensureKeeper(runtime: ProfileRuntime): Promise<void> {
    if (runtime.anchorTargetId || runtime.useParkingKeeper || !runtime.cdp) return;
    try {
      runtime.anchorTargetId = (await runtime.cdp.send('Target.createTarget', {
        url: 'about:blank',
        hidden: true,
        background: true,
      }) as { targetId: string }).targetId;
    } catch (error) {
      this.warnKeeperFallback(runtime.profileId, runtime, error);
    }
  }

  private warnKeeperFallback(profileId: string, runtime: ProfileRuntime, error: unknown): void {
    runtime.useParkingKeeper = true;
    if (runtime.keeperWarningLogged) return;
    runtime.keeperWarningLogged = true;
    log.warn(`SLAB Profile ${profileId} hidden keeper unavailable; using a parking page: ${errorMessage(error)}`);
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
        await this.closeRuntime(runtime);
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

  private async closeRuntime(runtime: ProfileRuntime): Promise<void> {
    await this.releaseRuntime(runtime, true);
  }

  private async releaseRuntime(runtime: ProfileRuntime, closePages: boolean, releaseNative = true): Promise<void> {
    if (runtime.releasePromise) return runtime.releasePromise;
    runtime.releasePromise = (async () => {
      this.cancelProfileIdle(runtime);
      for (const entry of runtime.targetPages.values()) this.clearIdleTimer(entry);
      const pages = [...runtime.targetPages.values()].map(entry => entry.page);
      try {
        if (closePages) {
          await Promise.all([...runtime.targetPages.values()].map(entry => (
            pageIsClosed(entry.page) || entry.provenance === 'human-adopted'
              ? undefined
              : entry.page.close().catch(() => {})
          )));
        }
        await this.closeParkingPage(runtime);
        if (runtime.anchorTargetId) {
          await runtime.cdp?.send('Target.closeTarget', { targetId: runtime.anchorTargetId }).catch(() => {});
          runtime.anchorTargetId = undefined;
        }
        await Promise.all([
          ...pages.map(page => this.detachPageCdp(page)),
          runtime.cdp?.detach().catch(() => {}),
        ]);
        if (releaseNative) await runtime.attachment.release();
        else runtime.attachment.closeTransport();
      } finally {
        await this.cleanupRuntime(runtime);
      }
    })();
    return runtime.releasePromise;
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

  private assertSessionAttached(profileId: string, sessionId: string): void {
    if (this.detachedSessions.get(profileId)?.has(sessionId)) throw new SlabAttachmentLostError();
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
    if (!openerEntry) return await this.claimSoleBlankStartupPage(runtime) ?? this.createWindowPage(runtime, windowMode);
    await this.assertOwnedWindow(runtime, session.id, openerEntry);
    const opener = openerEntry.page;
    const openerWindowId = await this.windowIdForTarget(runtime, openerEntry.targetId, opener);
    const targetUrl = `about:blank#webcmd-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const openedPage = this.waitForContextPageForSession(runtime, session.id, openerWindowId, targetUrl, TARGET_PAGE_MATCH_TIMEOUT_MS);

    try {
      await opener.evaluate((url) => window.open(url, '_blank', 'noopener,noreferrer'), targetUrl);
    } catch (error) {
      log.warn(`SLAB window.open failed while creating a Session tab; falling back to a new window: ${errorMessage(error)}`);
    }
    const page = await openedPage;
    if (page) return page;
    throw new Error(`SLAB could not create another tab in Session ${session.id} without opening a second window.`);
  }

  private async claimSoleBlankStartupPage(runtime: ProfileRuntime): Promise<PlaywrightPage | undefined> {
    if (runtime.targetPages.size > 0 || [...runtime.sessions.values()].some(session => session.windowIds.size > 0)) {
      return undefined;
    }
    const unowned = (await this.discoverPages(runtime))
      .filter(candidate => runtime.windowOwners.get(candidate.windowId) === undefined);
    if (unowned.length !== 1 || !isBlankStartupUrl(unowned[0]!.url)) return undefined;
    return await this.findPageByTargetId(runtime, unowned[0]!.targetId);
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
    this.assertSessionAttached(profileId, sessionId);
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
    await this.ensureKeeper(runtime);
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
      this.clearPendingTargetPage(runtime, targetId, page);
      return page;
    }
    return new Promise<PlaywrightPage>((resolve, reject) => {
      let settled = false;
      let interval: ReturnType<typeof setInterval> | undefined;
      const finish = (page: PlaywrightPage) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (interval) clearInterval(interval);
        this.targetPageWaiters.get(runtime)?.delete(targetId);
        resolve(page);
      };
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        if (interval) clearInterval(interval);
        this.targetPageWaiters.get(runtime)?.delete(targetId);
        reject(error);
      };
      const poll = () => {
        void this.findPageByTargetId(runtime, targetId)
          .then(found => {
            if (found && !pageIsClosed(found)) finish(found);
          })
          .catch(() => {});
      };
      const timer = setTimeout(() => {
        fail(new Error(`Timed out waiting for SLAB target ${targetId}`));
      }, TARGET_PAGE_MATCH_TIMEOUT_MS);
      interval = setInterval(poll, 50);
      interval.unref?.();
      this.targetPageWaiters.get(runtime)!.set(targetId, { resolve: finish, reject: fail, timer });
      poll();
    });
  }

  private async findPageByTargetId(runtime: ProfileRuntime, targetId: string): Promise<PlaywrightPage | undefined> {
    const pending = this.pendingTargetPages.get(runtime)?.get(targetId);
    if (pending && !pageIsClosed(pending)) return pending;

    // Resolve only the caller-supplied identity. This never makes visible pages
    // owned unless bindPage subsequently registers the exact matching target.
    for (const page of runtime.context.pages()) {
      if (pageIsClosed(page)) continue;
      const cachedTargetId = this.pageTargetIds.get(page);
      if (cachedTargetId === targetId) return page;
      if (cachedTargetId) continue;
      const probe = await runtime.context.newCDPSession(page).catch(() => undefined);
      if (!probe) continue;
      try {
        const { targetInfo } = await probe.send('Target.getTargetInfo') as { targetInfo: { targetId: string } };
        if (targetInfo.targetId === targetId) {
          this.pageTargetIds.set(page, targetId);
          page.once('close', () => this.pageTargetIds.delete(page));
          return page;
        }
      } finally {
        await probe.detach().catch(() => {});
      }
    }
    return undefined;
  }

  private windowIdentity(runtime: ProfileRuntime, windowId: number): string {
    return `slab-window-${runtime.generation}-${windowId}`;
  }

  private async discoverPages(runtime: ProfileRuntime): Promise<DiscoveredPage[]> {
    if (!runtime.cdp) return [];
    const { targetInfos = [] } = await runtime.cdp.send('Target.getTargets') as {
      targetInfos: Array<{ targetId: string; type: string; title?: string; url?: string }>;
    };
    const live = new Set(targetInfos.map(target => target.targetId));
    for (const [pageId, page] of runtime.discoveredPages) {
      if (!live.has(page.targetId)) runtime.discoveredPages.delete(pageId);
    }
    const result: DiscoveredPage[] = [];
    for (const target of targetInfos) {
      if (target.type !== 'page' || target.targetId === runtime.anchorTargetId) continue;
      if (target.url?.startsWith('devtools://') || target.url?.startsWith('chrome-extension://')) continue;
      const windowId = await this.windowIdForTarget(runtime, target.targetId).catch(() => undefined);
      if (windowId === undefined) continue;
      let page = [...runtime.discoveredPages.values()].find(candidate => candidate.targetId === target.targetId);
      if (!page) {
        page = {
          pageId: `slab-page-${runtime.generation}-${++pageCounter}`,
          windowId,
          targetId: target.targetId,
          title: target.title ?? '',
          url: target.url ?? '',
        };
        runtime.discoveredPages.set(page.pageId, page);
      } else {
        page.windowId = windowId;
        page.title = target.title ?? '';
        page.url = target.url ?? '';
      }
      result.push(page);
    }
    return result;
  }

  private async handleContextPage(runtime: ProfileRuntime, page: PlaywrightPage): Promise<void> {
    // Context `page` events include pre-existing human tabs. Resolve the exact
    // target with a short-lived page probe, which targetIdForPage always
    // detaches; an unowned observation must not leave a debugger attached.
    const targetId = await this.targetIdForPage(runtime, page).catch(() => undefined);
    if (!targetId) return;
    if (targetId === runtime.anchorTargetId) {
      page.once('close', () => {
        this.queueAnchorRepair(runtime.profileId, runtime, targetId);
      });
      return;
    }
    const waiter = this.targetPageWaiters.get(runtime)?.get(targetId);
    if (waiter) {
      this.targetPageWaiters.get(runtime)!.delete(targetId);
      this.clearPendingTargetPage(runtime, targetId);
      clearTimeout(waiter.timer);
      waiter.resolve(page);
    } else {
      this.rememberPendingTargetPage(runtime, targetId, page);
    }

    try {
      await this.withPageCreationLock(runtime.profileId, async () => {
        if (runtime.disposed || this.profiles.get(runtime.profileId) !== runtime) return;
        const windowId = await this.windowIdForTarget(runtime, targetId);
        const windowOwner = runtime.windowOwners.get(windowId);
        const ownedSession = windowOwner ? runtime.sessions.get(windowOwner) : undefined;
        const ownedTemplate = ownedSession ? this.openEntries(ownedSession)[0]?.[1] : undefined;
        const opener = await page.opener().catch(() => null);
        const openerTargetId = opener
          ? undefined
          : await this.openerTargetIdForTarget(runtime, targetId).catch(() => undefined);
        const openerEntry = ownedTemplate ?? (opener
          ? [...runtime.targetPages.values()].find(entry => entry.page === opener)
          : openerTargetId ? runtime.targetPages.get(openerTargetId) : undefined);
        if (!openerEntry?.sessionId) return;
        const session = runtime.sessions.get(openerEntry.sessionId);
        if (!session) return;
        this.clearPendingTargetPage(runtime, targetId, page);
        await this.registerOwnedPage(runtime, session, page, {
          session: openerEntry.session,
          surface: openerEntry.surface,
          siteSession: openerEntry.siteSession,
          sessionKind: openerEntry.sessionKind,
          adapterSite: openerEntry.adapterSite,
          idleTimeout: openerEntry.idleTimeout,
          provenance: openerEntry.provenance,
        });
      });
    } finally {
      this.clearPendingTargetPage(runtime, targetId, page);
    }
  }

  private async registerOwnedPage(
    runtime: ProfileRuntime,
    session: SessionRuntime,
    page: PlaywrightPage,
    input: Pick<PageEntry, 'session' | 'surface' | 'siteSession' | 'sessionKind' | 'adapterSite' | 'idleTimeout'> & {
      leaseKey?: string;
      provenance?: 'agent-created' | 'human-adopted';
      humanize?: boolean;
    },
  ): Promise<PageEntry> {
    const targetId = await this.targetIdForPage(runtime, page);
    this.clearPendingTargetPage(runtime, targetId, page);
    const windowId = await this.windowIdForTarget(runtime, targetId, page);
    const owner = runtime.windowOwners.get(windowId);
    if (owner !== undefined && owner !== session.id) {
      throw new SessionWindowConflictError(runtime.targetPages.get(targetId)?.pageId ?? 'unknown', session.id, owner);
    }
    if (session.windowIds.size > 0 && !session.windowIds.has(windowId)) {
      throw new SessionWindowConflictError(runtime.targetPages.get(targetId)?.pageId ?? 'unknown', session.id, session.id);
    }
    let entry = runtime.targetPages.get(targetId);
    const priorEntry = entry ? { ...entry, idleTimer: undefined } : undefined;
    const priorHadIdleTimer = entry?.idleTimer !== undefined;
    const priorSessionPages = new Map(session.pages);
    const priorWindowIds = new Set(session.windowIds);
    const priorOwner = runtime.windowOwners.get(windowId);
    const wasOwned = Boolean(entry?.sessionId);
    if (entry?.sessionId && entry.sessionId !== session.id) {
      throw new SessionWindowConflictError(entry.pageId, session.id, entry.sessionId);
    }
    try {
    runtime.windowOwners.set(windowId, session.id);
    session.windowIds.add(windowId);
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
        windowId,
        provenance: input.provenance ?? this.openEntries(session)[0]?.[1].provenance ?? 'agent-created',
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
      entry.windowId = windowId;
      entry.provenance = input.provenance ?? entry.provenance;
      entry.leaseKey = input.leaseKey ?? (entry.leaseKey.startsWith('unowned\u0000') ? `page\u0000${entry.pageId}` : entry.leaseKey);
    }
    session.pages.set(entry.leaseKey, entry);
    if (input.humanize !== false) this.humanize(page);
    this.cancelProfileIdle(runtime);
    this.refreshIdleTimer(runtime, session, entry.leaseKey, entry);
    if (!wasOwned) for (const listener of this.sessionPageListeners.get(session) ?? []) listener(page);
    await this.closeParkingPage(runtime);
    return entry;
    } catch (error) {
      if (entry?.idleTimer) clearTimeout(entry.idleTimer);
      session.pages.clear();
      for (const [key, value] of priorSessionPages) session.pages.set(key, value);
      session.windowIds.clear();
      for (const id of priorWindowIds) session.windowIds.add(id);
      if (priorOwner === undefined) runtime.windowOwners.delete(windowId);
      else runtime.windowOwners.set(windowId, priorOwner);
      if (priorEntry && entry) {
        Object.assign(entry, priorEntry);
        entry.idleTimer = undefined;
        if (priorHadIdleTimer) this.refreshIdleTimer(runtime, session, entry.leaseKey, entry);
      } else if (entry) {
        runtime.targetPages.delete(targetId);
        if (entry.closeListener) entry.page.off('close', entry.closeListener);
        await disposeHumanizedPage(entry.page);
      }
      throw error;
    }
  }

  private attachPageLifecycle(runtime: ProfileRuntime, entry: PageEntry): void {
    const closeListener = () => {
      if (runtime.parkingPage === entry.page) runtime.parkingPage = undefined;
      const session = entry.sessionId ? runtime.sessions.get(entry.sessionId) : undefined;
      if (session) void this.removeEntry(runtime, session, entry, false);
      else {
        runtime.targetPages.delete(entry.targetId);
        this.clearIdleTimer(entry);
        void this.detachPageCdp(entry.page);
        this.scheduleProfileIdle(runtime.profileId, runtime);
      }
    };
    entry.closeListener = closeListener;
    entry.page.on('close', closeListener);
  }

  private async targetIdForPage(runtime: ProfileRuntime, page: PlaywrightPage): Promise<string> {
    const cached = this.pageTargetIds.get(page);
    if (cached) return cached;
    const pending = this.pageTargetIdPromises.get(page);
    if (pending) return pending;
    const correlation = (async () => {
      const session = await runtime.context.newCDPSession(page);
      try {
        const { targetInfo } = await session.send('Target.getTargetInfo') as { targetInfo: { targetId: string } };
        if (!targetInfo?.targetId) throw new Error('SLAB page target identity is unavailable.');
        this.pageTargetIds.set(page, targetInfo.targetId);
        page.once('close', () => this.pageTargetIds.delete(page));
        return targetInfo.targetId;
      } finally {
        await session.detach().catch(() => {});
      }
    })();
    this.pageTargetIdPromises.set(page, correlation);
    try {
      return await correlation;
    } finally {
      this.pageTargetIdPromises.delete(page);
    }
  }

  private async targetIdForPageInWindow(
    runtime: ProfileRuntime,
    page: PlaywrightPage,
    expectedWindowId: number,
  ): Promise<string | undefined> {
    const cached = this.pageTargetIds.get(page);
    if (cached) {
      return await this.windowIdForTarget(runtime, cached, page).catch(() => undefined) === expectedWindowId
        ? cached
        : undefined;
    }
    const probe = await runtime.context.newCDPSession(page);
    try {
      const { targetInfo } = await probe.send('Target.getTargetInfo') as { targetInfo: { targetId: string } };
      const windowId = await (runtime.cdp ?? probe).send('Browser.getWindowForTarget', {
        targetId: targetInfo.targetId,
      }).then(result => (result as { windowId: number }).windowId);
      if (windowId !== expectedWindowId) return undefined;
      this.pageTargetIds.set(page, targetInfo.targetId);
      page.once('close', () => this.pageTargetIds.delete(page));
      return targetInfo.targetId;
    } finally {
      await probe.detach().catch(() => {});
    }
  }

  private async openerTargetIdForTarget(runtime: ProfileRuntime, targetId: string): Promise<string | undefined> {
    if (!runtime.cdp) return undefined;
    const { targetInfo } = await runtime.cdp.send('Target.getTargetInfo', { targetId }) as {
      targetInfo: { openerId?: string };
    };
    return targetInfo.openerId;
  }

  private async windowIdForTarget(runtime: ProfileRuntime, targetId: string, page?: PlaywrightPage): Promise<number> {
    const entry = runtime.targetPages.get(targetId);
    const cdp = runtime.cdp;
    if (!cdp) throw new Error('SLAB page has no CDP session.');
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
    if (!entry.idleTimeout || entry.idleTimeout <= 0 || entry.siteSession === 'persistent' || entry.provenance === 'human-adopted') return;
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

  private async removeEntry(runtime: ProfileRuntime, session: SessionRuntime, entry: PageEntry, close: boolean, force = false): Promise<void> {
    const destructiveClose = close && (entry.provenance === 'agent-created' || force);
    const shouldPark = destructiveClose && runtime.useParkingKeeper
      && [...runtime.targetPages.values()].every(candidate => candidate === entry || pageIsClosed(candidate.page));
    const parkingWindowId = shouldPark
      ? await this.windowIdForTarget(runtime, entry.targetId, entry.page).catch(() => undefined)
      : undefined;
    if (session.pages.get(entry.leaseKey) === entry) session.pages.delete(entry.leaseKey);
    runtime.targetPages.delete(entry.targetId);
    this.clearIdleTimer(entry);
    this.clearSelectedPage(session, entry);
    this.networkCapture.stop(entry.page);
    if (entry.closeListener) {
      entry.page.off('close', entry.closeListener);
      entry.closeListener = undefined;
    }
    await this.detachPageCdp(entry.page);
    await disposeHumanizedPage(entry.page);
    if (destructiveClose && !pageIsClosed(entry.page)) {
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
    const windowStillOwned = [...runtime.targetPages.values()].some(candidate => (
      candidate.sessionId === session.id && candidate.windowId === entry.windowId && !pageIsClosed(candidate.page)
    ));
    if (!windowStillOwned) {
      runtime.windowOwners.delete(entry.windowId);
      session.windowIds.delete(entry.windowId);
    }
    if (session.pages.size === 0) runtime.sessions.delete(session.id);
    this.scheduleProfileIdle(runtime.profileId, runtime);
  }

  private async closeParkingPage(runtime: ProfileRuntime): Promise<void> {
    const parkingPage = runtime.parkingPage;
    if (!parkingPage) return;
    runtime.parkingPage = undefined;
    if (!pageIsClosed(parkingPage)) await parkingPage.close().catch(() => {});
    await this.detachPageCdp(parkingPage);
  }

  private detachPageCdp(_page: PlaywrightPage): Promise<void> {
    return Promise.resolve();
  }

  private rememberPendingTargetPage(runtime: ProfileRuntime, targetId: string, page: PlaywrightPage): void {
    this.clearPendingTargetPage(runtime, targetId);
    this.pendingTargetPages.get(runtime)?.set(targetId, page);
    const forget = () => this.clearPendingTargetPage(runtime, targetId, page);
    page.on('close', forget);
    this.pendingTargetCloseListeners.get(runtime)?.set(targetId, { page, listener: forget });
  }

  private clearPendingTargetPage(runtime: ProfileRuntime, targetId: string, expectedPage?: PlaywrightPage): void {
    const pending = this.pendingTargetPages.get(runtime);
    if (expectedPage && pending?.get(targetId) !== expectedPage) return;
    pending?.delete(targetId);
    const closeListeners = this.pendingTargetCloseListeners.get(runtime);
    const closeListener = closeListeners?.get(targetId);
    if (closeListener) closeListener.page.off('close', closeListener.listener);
    closeListeners?.delete(targetId);
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
