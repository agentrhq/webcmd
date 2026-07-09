import fs from 'node:fs';
import type { BrowserContext, Page as PlaywrightPage } from 'playwright-core';
import { launchPersistentContext as cloakLaunchPersistentContext } from 'cloakbrowser';
import type { BrowserSurface, SiteSessionMode } from '../../protocol.js';
import { normalizeProfileId, resolveCloakProfileDir } from './profiles.js';
import { CloakNetworkCapture } from './network.js';

export type LaunchPersistentContext = typeof cloakLaunchPersistentContext;

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
  private readonly profiles = new Map<string, ProfileRuntime>();

  constructor(private readonly opts: CloakSessionManagerOptions = {}) {
    this.launchPersistentContext = opts.launchPersistentContext ?? cloakLaunchPersistentContext;
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
    const userDataDir = resolveCloakProfileDir(profileId, { baseDir: this.opts.baseDir });
    fs.mkdirSync(userDataDir, { recursive: true });
    const context = await this.launchPersistentContext({
      userDataDir,
      headless: false,
      humanize: true,
    });
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
