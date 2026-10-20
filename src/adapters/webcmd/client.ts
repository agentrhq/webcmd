import type { IPage } from '../../types.js';
import type { IBrowserFactory } from '../../runtime.js';
import { BrowserBridge } from '../../browser/bridge.js';
import { LocalBrowserSessionStore } from '../../browser/sessions.js';
import { resolveProfileSelection } from '../../browser/profile.js';

export interface WebcmdClientConnectOptions {
  session: string;
  surface?: 'browser' | 'adapter';
  windowMode?: 'foreground' | 'background';
  idleTimeout?: number;
  siteSession?: 'ephemeral' | 'persistent';
  freshPage?: boolean;
  contextId?: string;
  preferredContextId?: string;
  timeout?: number;
}

export interface WebcmdHandoffDetails {
  site: string;
  expiresAt: string;
  reason?: string;
}

export interface WebcmdClientApi {
  connect: (opts: WebcmdClientConnectOptions) => Promise<{ page: IPage; factory: IBrowserFactory }>;
  close: (page?: IPage, factory?: IBrowserFactory) => Promise<void>;
  markHandoff?: (sessionId: string, details: WebcmdHandoffDetails) => Promise<void>;
  clearHandoff?: (sessionId: string) => Promise<void>;
}

export interface IWebcmdClient {
  connect(opts: WebcmdClientConnectOptions): Promise<{ page: IPage; factory: IBrowserFactory }>;
  close(page?: IPage, factory?: IBrowserFactory): Promise<void>;
  markHandoff(sessionId: string, details: WebcmdHandoffDetails): Promise<void>;
  clearHandoff(sessionId: string): Promise<void>;
}

export interface WebcmdBrowserClientOptions {
  api?: WebcmdClientApi;
  factory?: IBrowserFactory;
  factorySupplier?: () => IBrowserFactory;
  sessionStore?: LocalBrowserSessionStore;
}

/**
 * WebcmdBrowserClient provides a thin wrapper around the repository's real Webcmd session/browser API.
 * Integrates directly with BrowserBridge, IBrowserFactory, and LocalBrowserSessionStore.
 */
export class WebcmdBrowserClient implements IWebcmdClient {
  private readonly factorySupplier: () => IBrowserFactory;
  private readonly sessionStore: LocalBrowserSessionStore;
  private readonly api?: WebcmdClientApi;

  constructor(options?: WebcmdBrowserClientOptions) {
    if (options?.factory) {
      const fixedFactory = options.factory;
      this.factorySupplier = () => fixedFactory;
    } else {
      this.factorySupplier = options?.factorySupplier ?? (() => new BrowserBridge());
    }
    this.sessionStore = options?.sessionStore ?? new LocalBrowserSessionStore();
    this.api = options?.api;
  }

  async connect(opts: WebcmdClientConnectOptions): Promise<{ page: IPage; factory: IBrowserFactory }> {
    if (this.api?.connect) {
      return this.api.connect(opts);
    }

    if (opts.surface === 'adapter' && opts.session) {
      const profileId = opts.contextId ?? resolveProfileSelection()?.contextId ?? 'default';
      this.sessionStore.ensure(profileId, opts.session);
    }

    const factory = this.factorySupplier();
    const connectParams: Record<string, unknown> = {
      surface: opts.surface ?? 'adapter',
    };
    if (opts.session) connectParams.session = opts.session;
    if (opts.windowMode !== undefined) connectParams.windowMode = opts.windowMode;
    if (opts.idleTimeout !== undefined) connectParams.idleTimeout = opts.idleTimeout;
    if (opts.siteSession !== undefined) connectParams.siteSession = opts.siteSession;
    if (opts.freshPage !== undefined) connectParams.freshPage = opts.freshPage;
    if (opts.contextId !== undefined) connectParams.contextId = opts.contextId;
    if (opts.preferredContextId !== undefined) connectParams.preferredContextId = opts.preferredContextId;
    if (opts.timeout !== undefined) connectParams.timeout = opts.timeout;

    const page = await factory.connect(connectParams as Parameters<IBrowserFactory['connect']>[0]);

    return { page, factory };
  }

  async close(page?: IPage, factory?: IBrowserFactory): Promise<void> {
    if (this.api?.close) {
      return this.api.close(page, factory);
    }

    if (page && typeof (page as unknown as Record<string, unknown>).closeWindow === 'function') {
      await (page as unknown as { closeWindow: () => Promise<void> }).closeWindow().catch(() => {});
    }
    if (factory && typeof factory.close === 'function') {
      await factory.close().catch(() => {});
    }
  }

  async markHandoff(sessionId: string, details: WebcmdHandoffDetails): Promise<void> {
    if (this.api?.markHandoff) {
      return this.api.markHandoff(sessionId, details);
    }

    const profileId = resolveProfileSelection()?.contextId ?? 'default';
    try {
      const existing = this.sessionStore.find(profileId, sessionId);
      if (!existing) {
        try {
          this.sessionStore.create(profileId, sessionId);
        } catch {
          // Session naming or existing record fallback
        }
      }
      this.sessionStore.markHandoff(profileId, sessionId, {
        site: details.site,
        expiresAt: details.expiresAt,
      });
    } catch {
      // Ephemeral or test sessions without store entries ignore store errors gracefully
    }
  }

  async clearHandoff(sessionId: string): Promise<void> {
    if (this.api?.clearHandoff) {
      return this.api.clearHandoff(sessionId);
    }

    const profileId = resolveProfileSelection()?.contextId ?? 'default';
    try {
      this.sessionStore.clearHandoff(profileId, sessionId);
    } catch {
      // Best-effort clear
    }
  }
}

export const RealWebcmdClient = WebcmdBrowserClient;

/**
 * FakeWebcmdClient for isolated unit testing of session lifecycle,
 * handoff persistence, and browser delegation without launching a real browser.
 */
export class FakeWebcmdClient implements IWebcmdClient {
  public connectedSessions: string[] = [];
  public closedPages: IPage[] = [];
  public closedFactories: IBrowserFactory[] = [];
  public handoffs = new Map<string, WebcmdHandoffDetails>();
  public clearedHandoffs: string[] = [];
  public mockPage: IPage;
  public mockFactory: IBrowserFactory;

  constructor(mockPage?: Partial<IPage>, mockFactory?: Partial<IBrowserFactory>) {
    this.mockPage = {
      goto: async () => {},
      evaluate: async (fn: unknown) => {
        const fnStr = typeof fn === 'function' ? fn.toString() : String(fn);
        if (fnStr.includes('document.title')) return 'Mock Page Title';
        if (fnStr.includes('innerText')) return 'Mock page body content preview';
        return '';
      },
      closeWindow: async () => {},
      wait: async () => {},
      sleep: async () => {},
      ...mockPage,
    } as unknown as IPage;

    this.mockFactory = {
      connect: async () => this.mockPage,
      close: async () => {},
      ...mockFactory,
    } as unknown as IBrowserFactory;
  }

  async connect(opts: WebcmdClientConnectOptions): Promise<{ page: IPage; factory: IBrowserFactory }> {
    this.connectedSessions.push(opts.session);
    const page = await this.mockFactory.connect({
      session: opts.session,
      surface: opts.surface ?? 'adapter',
    });
    return { page, factory: this.mockFactory };
  }

  async close(page?: IPage, factory?: IBrowserFactory): Promise<void> {
    if (page) {
      this.closedPages.push(page);
      if (typeof (page as unknown as Record<string, unknown>).closeWindow === 'function') {
        await (page as unknown as { closeWindow: () => Promise<void> }).closeWindow();
      }
    }
    if (factory) {
      this.closedFactories.push(factory);
      if (typeof factory.close === 'function') {
        await factory.close();
      }
    }
  }

  async markHandoff(sessionId: string, details: WebcmdHandoffDetails): Promise<void> {
    this.handoffs.set(sessionId, details);
  }

  async clearHandoff(sessionId: string): Promise<void> {
    this.clearedHandoffs.push(sessionId);
    this.handoffs.delete(sessionId);
  }
}
