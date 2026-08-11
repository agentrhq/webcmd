import { createRequire } from 'node:module';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import {
  BROWSER_RUN_PLAYWRIGHT_VERSION,
  BrowserRunError,
} from './types.js';

interface DispatcherConnection {
  onmessage: (message: Record<string, unknown>) => void;
  dispatch(message: Record<string, unknown>): Promise<void>;
  _dispatcherByGuid: Map<string, { _type: string; _object?: unknown }>;
}

interface RootDispatcher {
  stopPendingOperations(error: Error): Promise<void>;
  _dispose(): void;
}

interface PlaywrightServer {
  DispatcherConnection: new () => DispatcherConnection;
  RootDispatcher: new (
    connection: DispatcherConnection,
    createPlaywright: (scope: unknown, params: { sdkLanguage: string }) => Promise<unknown>,
  ) => RootDispatcher;
  PlaywrightDispatcher: new (
    scope: unknown,
    playwright: unknown,
    options: Record<string, unknown>,
  ) => unknown;
  createPlaywright(options: Record<string, unknown>): unknown;
  nullProgress: unknown;
}

interface PlaywrightClientObject {
  _connection?: { toImpl?: (object: unknown) => unknown };
  _guid?: string;
}

function pageGuid(page: Page): string {
  const client = page as Page & PlaywrightClientObject & { guid?: string };
  return client.guid ?? client._guid ?? '';
}

const coreBundle = createRequire(import.meta.url)(
  'playwright-core/lib/coreBundle',
) as { getPlaywrightVersion(): string; server: PlaywrightServer };
const { server } = coreBundle;
if (coreBundle.getPlaywrightVersion() !== BROWSER_RUN_PLAYWRIGHT_VERSION) {
  throw new Error(
    `Browser-run Playwright protocol requires ${BROWSER_RUN_PLAYWRIGHT_VERSION}.`,
  );
}

const DENIED_METHODS = new Map<string, Set<string>>([
  ['Browser', new Set([
    'close',
    'killForTests',
    'newBrowserCDPSession',
    'newContext',
    'newContextForReuse',
    'startServer',
    'stopServer',
  ])],
  ['BrowserContext', new Set(['close', 'newCDPSession'])],
  ['Page', new Set(['close'])],
  ['Playwright', new Set(['newRequest'])],
]);

function implementation<T>(object: T): unknown {
  const client = object as T & PlaywrightClientObject;
  const value = client._connection?.toImpl?.(object);
  if (!value) {
    throw new BrowserRunError(
      'BROWSER_RUN_API_UNSUPPORTED',
      'The supplied browser connection cannot be shared with browser run.',
    );
  }
  return value;
}

function scopedContext(context: object, pages: () => object[]): object {
  const pageListeners = new WeakMap<Function, Function>();
  const isAllowedPage = (candidate: object) => {
    const allowed = pages();
    if (allowed.includes(candidate)) return true;
    const opener = Reflect.get(candidate, 'opener', candidate);
    if (typeof opener !== 'function') return false;
    try {
      return allowed.includes(Reflect.apply(opener, candidate, []));
    } catch {
      return false;
    }
  };
  let proxy: object;
  proxy = new Proxy(context, {
    get(target, property) {
      if (property === 'pages') return pages;
      if (property === 'on' || property === 'addListener') {
        return (event: string, listener: Function) => {
          let registered = listener;
          if (event === 'page') {
            registered = (candidate: object, ...args: unknown[]) => {
              if (isAllowedPage(candidate)) listener(candidate, ...args);
            };
            pageListeners.set(listener, registered);
          }
          Reflect.apply(Reflect.get(target, property), target, [event, registered]);
          return proxy;
        };
      }
      if (property === 'off' || property === 'removeListener') {
        return (event: string, listener: Function) => {
          const registered = pageListeners.get(listener) ?? listener;
          Reflect.apply(Reflect.get(target, property), target, [event, registered]);
          pageListeners.delete(listener);
          return proxy;
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return proxy;
}

function scopedBrowser(browser: object, context: object): object {
  const contextListeners = new WeakMap<Function, Function>();
  let proxy: object;
  proxy = new Proxy(browser, {
    get(target, property) {
      if (property === 'contexts') return () => [context];
      if (property === 'on' || property === 'addListener') {
        return (event: string, listener: Function) => {
          let registered = listener;
          if (event === 'context') {
            registered = (candidate: object, ...args: unknown[]) => {
              if (candidate === context) listener(candidate, ...args);
            };
            contextListeners.set(listener, registered);
          }
          Reflect.apply(Reflect.get(target, property), target, [event, registered]);
          return proxy;
        };
      }
      if (property === 'off' || property === 'removeListener') {
        return (event: string, listener: Function) => {
          const registered = contextListeners.get(listener) ?? listener;
          Reflect.apply(Reflect.get(target, property), target, [event, registered]);
          contextListeners.delete(listener);
          return proxy;
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return proxy;
}

export class PlaywrightTransport {
  readonly pageGuid: string;
  readonly #connection: DispatcherConnection;
  readonly #root: RootDispatcher;
  readonly #deliver: (message: string) => void;
  #registerPageImpl: (page: Page) => void;
  #cancellation: Promise<void> | undefined;
  #disposed = false;
  #browserWaitMs = 0;

  constructor(
    input: { browser: Browser; context: BrowserContext; page: Page; pages?: Page[] },
    deliver: (message: string) => void,
  ) {
    if (
      !input.browser.contexts().includes(input.context)
      || !input.context.pages().includes(input.page)
    ) {
      throw new BrowserRunError(
        'BROWSER_RUN_API_UNSUPPORTED',
        'The supplied page is outside the supplied browser context.',
      );
    }

    const browser = implementation(input.browser) as object;
    const allowedPages = new Set<object>();
    const context = scopedContext(implementation(input.context) as object, () => [...allowedPages]);
    this.pageGuid = pageGuid(input.page);
    this.#registerPageImpl = page => allowedPages.add(implementation(page) as object);
    for (const page of input.pages?.length ? input.pages : [input.page]) this.registerPage(page);
    this.#deliver = deliver;
    this.#connection = new server.DispatcherConnection();
    this.#connection.onmessage = message => {
      if (!this.#disposed) this.#deliver(JSON.stringify(message));
    };
    this.#root = new server.RootDispatcher(
      this.#connection,
      async (scope, { sdkLanguage }) => new server.PlaywrightDispatcher(
        scope,
        server.createPlaywright({ sdkLanguage, isServer: true }),
        {
          denyLaunch: true,
          preLaunchedBrowser: scopedBrowser(browser, context),
          sharedBrowser: true,
        },
      ),
    );
  }

  send(message: string): void {
    if (this.#disposed) return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(message) as Record<string, unknown>;
    } catch {
      throw new BrowserRunError(
        'BROWSER_RUN_API_UNSUPPORTED',
        'Browser-run sent an invalid Playwright protocol message.',
      );
    }

    const dispatcher = typeof parsed.guid === 'string'
      ? this.#connection._dispatcherByGuid.get(parsed.guid)
      : undefined;
    const method = typeof parsed.method === 'string' ? parsed.method : '';
    if (
      dispatcher?._type === 'BrowserType'
      || dispatcher?._type === 'Android'
      || dispatcher?._type === 'Electron'
      || DENIED_METHODS.get(dispatcher?._type ?? '')?.has(method)
    ) {
      this.#unsupported(parsed.id, `${dispatcher?._type}.${method}`);
      return;
    }
    const startedAt = Date.now();
    void this.#connection.dispatch(parsed).finally(() => {
      this.#browserWaitMs += Math.max(0, Date.now() - startedAt);
    });
  }

  get browserWaitMs(): number {
    return this.#browserWaitMs;
  }

  registerPage(page: Page): void {
    this.#registerPageImpl(page);
  }

  cancel(error: Error): Promise<void> {
    if (this.#disposed) return Promise.resolve();
    this.#cancellation ??= this.#root.stopPendingOperations(error).catch(() => undefined);
    return this.#cancellation;
  }

  async dispose(error: Error = new Error('Browser run ended')): Promise<void> {
    if (this.#disposed) return;
    await this.cancel(error);
    this.#disposed = true;
    this.#connection.onmessage = () => undefined;
    this.#root._dispose();
  }

  #unsupported(id: unknown, api: string): void {
    queueMicrotask(() => {
      if (this.#disposed) return;
      this.#deliver(JSON.stringify({
        id,
        error: {
          error: {
            name: 'BrowserRunError',
            message: `BROWSER_RUN_API_UNSUPPORTED: ${api} is unavailable in browser run.`,
            stack: '',
          },
        },
      }));
    });
  }
}
