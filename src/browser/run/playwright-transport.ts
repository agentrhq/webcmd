import { createRequire } from 'node:module';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import {
  BROWSER_RUN_PLAYWRIGHT_VERSION,
  BrowserRunError,
} from './types.js';
import type { BrowserRunSessionScope } from './runner.js';

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

const CLOSE_SESSION = 'end the session with `webcmd session close <session-id>`';
const NO_RAW_CDP = 'raw CDP is not exposed inside browser run; drive the page with the Playwright APIs on `page`';
const ONE_CONTEXT = 'a run is scoped to one context; start another with `webcmd session create`';

const API_REMEDIATIONS: Record<string, string> = {
  'Browser.close': CLOSE_SESSION,
  'Browser.newBrowserCDPSession': NO_RAW_CDP,
  'Browser.newContext': ONE_CONTEXT,
  'Browser.newContextForReuse': ONE_CONTEXT,
  'BrowserContext.close': CLOSE_SESSION,
  'BrowserContext.newCDPSession': NO_RAW_CDP,
  'Page.close': `the session owns its tabs; leave the tab open, or ${CLOSE_SESSION}`,
  'Playwright.newRequest': 'use `page.request` to make HTTP calls in the page\'s context',
};

export function unsupportedApiMessage(api: string): string {
  const remediation = API_REMEDIATIONS[api];
  return remediation
    ? `${api} is unavailable in browser run; ${remediation}.`
    : `${api} is unavailable in browser run.`;
}

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

function scopedContext(
  context: object,
  scope: {
    pages(): object[];
    createPage(): Promise<object>;
    onPage(listener: (page: object) => void): () => void;
  },
): object {
  const pageListeners = new Map<Function, Set<() => void>>();
  const contextListeners = new Map<string, Map<Function, Set<() => void>>>();
  const related = (value: unknown, property: string): unknown => {
    if ((typeof value !== 'object' || value === null) && typeof value !== 'function') return undefined;
    try {
      const candidate = Reflect.get(value as object, property, value);
      return typeof candidate === 'function' ? Reflect.apply(candidate, value, []) : candidate;
    } catch {
      return undefined;
    }
  };
  const requestPage = (request: unknown): unknown => {
    const frame = related(request, 'frame') ?? related(request, '_frame');
    return related(frame, 'page') ?? related(frame, '_page');
  };
  const eventBelongsToScope = (event: string, args: unknown[]): boolean => {
    let eventPage: unknown;
    if (event === 'request' || event === 'requestfailed') {
      eventPage = requestPage(args[0]);
    } else if (event === 'response') {
      eventPage = requestPage(related(args[0], 'request'));
    } else if (event === 'requestfinished') {
      eventPage = requestPage(related(args[0], 'request'));
    } else if (event === 'console') {
      eventPage = related(args[0], 'page');
    } else if (event === 'pageerror') {
      eventPage = args[1];
    } else if (event === 'recorderevent') {
      eventPage = related(args[0], 'page');
    }
    return eventPage !== undefined && scope.pages().includes(eventPage as object);
  };
  const addPageListener = (listener: Function, once = false) => {
    let dispose: () => void = () => undefined;
    const registered = (page: object) => {
      if (once) {
        dispose();
        pageListeners.get(listener)?.delete(dispose);
      }
      listener(page);
    };
    dispose = scope.onPage(registered);
    const disposers = pageListeners.get(listener) ?? new Set();
    disposers.add(dispose);
    pageListeners.set(listener, disposers);
  };
  const removePageListener = (listener: Function) => {
    for (const dispose of pageListeners.get(listener) ?? []) dispose();
    pageListeners.delete(listener);
  };
  const removeAllPageListeners = () => {
    for (const listener of pageListeners.keys()) removePageListener(listener);
  };
  const addContextListener = (event: string, listener: Function, once = false) => {
    let dispose: () => void = () => undefined;
    const registered = (...args: unknown[]) => {
      if (event !== 'close' && !eventBelongsToScope(event, args)) return;
      if (once) {
        dispose();
        contextListeners.get(event)?.get(listener)?.delete(dispose);
      }
      listener(...args);
    };
    Reflect.apply(Reflect.get(context, 'on'), context, [event, registered]);
    dispose = () => Reflect.apply(Reflect.get(context, 'off'), context, [event, registered]);
    const byListener = contextListeners.get(event) ?? new Map();
    const disposers = byListener.get(listener) ?? new Set();
    disposers.add(dispose);
    byListener.set(listener, disposers);
    contextListeners.set(event, byListener);
  };
  const removeContextListener = (event: string, listener: Function) => {
    const byListener = contextListeners.get(event);
    for (const dispose of byListener?.get(listener) ?? []) dispose();
    byListener?.delete(listener);
    if (byListener?.size === 0) contextListeners.delete(event);
  };
  const removeAllContextListeners = (event?: string) => {
    const events = event === undefined ? [...contextListeners.keys()] : [event];
    for (const name of events) {
      for (const listener of contextListeners.get(name)?.keys() ?? []) {
        removeContextListener(name, listener);
      }
    }
  };
  const dialogManager = Reflect.get(context, 'dialogManager', context) as object;
  const dialogHandlers = new Map<Function, Function>();
  const scopedDialogManager = new Proxy(dialogManager, {
    get(target, property) {
      if (property === 'addDialogHandler') {
        return (handler: Function) => {
          const registered = (dialog: object) => {
            const page = related(dialog, 'page');
            return page !== undefined && scope.pages().includes(page as object)
              ? handler(dialog)
              : false;
          };
          dialogHandlers.set(handler, registered);
          Reflect.apply(Reflect.get(target, property), target, [registered]);
        };
      }
      if (property === 'removeDialogHandler') {
        return (handler: Function) => {
          const registered = dialogHandlers.get(handler) ?? handler;
          dialogHandlers.delete(handler);
          Reflect.apply(Reflect.get(target, property), target, [registered]);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  let proxy: object;
  proxy = new Proxy(context, {
    get(target, property) {
      if (property === 'pages') return scope.pages;
      if (property === 'newPage') return scope.createPage;
      if (property === 'dialogManager') return scopedDialogManager;
      if (property === 'backgroundPages' || property === 'serviceWorkers') return () => [];
      if (property === 'on' || property === 'addListener') {
        return (event: string, listener: Function) => {
          if (event === 'page') {
            addPageListener(listener);
            return proxy;
          }
          addContextListener(event, listener);
          return proxy;
        };
      }
      if (property === 'off' || property === 'removeListener') {
        return (event: string, listener: Function) => {
          if (event === 'page') {
            removePageListener(listener);
            return proxy;
          }
          removeContextListener(event, listener);
          return proxy;
        };
      }
      if (property === 'once') {
        return (event: string, listener: Function) => {
          if (event === 'page') {
            addPageListener(listener, true);
            return proxy;
          }
          addContextListener(event, listener, true);
          return proxy;
        };
      }
      if (property === 'removeAllListeners') {
        return (event?: string) => {
          if (event === undefined || event === 'page') removeAllPageListeners();
          if (event !== 'page') removeAllContextListeners(event);
          return proxy;
        };
      }
      if (property === 'waitForEvent') {
        return (event: string, optionsOrPredicate?: object | Function) => {
          const options = typeof optionsOrPredicate === 'object' ? optionsOrPredicate as {
            predicate?: (page: object) => boolean | Promise<boolean>;
            timeout?: number;
          } : undefined;
          const predicate = typeof optionsOrPredicate === 'function' ? optionsOrPredicate : options?.predicate;
          return new Promise<object>((resolve, reject) => {
            let timer: ReturnType<typeof setTimeout> | undefined;
            const removeListener = (listener: Function) => {
              if (event === 'page') removePageListener(listener);
              else removeContextListener(event, listener);
            };
            const listener = async (value: object) => {
              try {
                if (predicate && !await predicate(value)) return;
                removeListener(listener);
                if (timer) clearTimeout(timer);
                resolve(value);
              } catch (error) {
                removeListener(listener);
                if (timer) clearTimeout(timer);
                reject(error);
              }
            };
            if (event === 'page') addPageListener(listener);
            else addContextListener(event, listener);
            if (options?.timeout) {
              timer = setTimeout(() => {
                removeListener(listener);
                reject(new Error(`Timeout while waiting for event "${event}"`));
              }, options.timeout);
            }
          });
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
      if (property === '_defaultContext') return Reflect.get(target, property, target) ? context : undefined;
      if (property === 'contexts') return () => (
        Reflect.get(target, '_defaultContext', target) ? [] : [context]
      );
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
    input: BrowserRunSessionScope,
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
    const context = scopedContext(implementation(input.context) as object, {
      pages: () => input.pages().map(page => implementation(page) as object),
      createPage: async () => implementation(await input.createPage()) as object,
      onPage: listener => input.onPage(page => listener(implementation(page) as object)),
    });
    this.pageGuid = pageGuid(input.page);
    this.#registerPageImpl = page => { implementation(page); };
    for (const page of input.pages()) this.registerPage(page);
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
            message: `BROWSER_RUN_API_UNSUPPORTED: ${unsupportedApiMessage(api)}`,
            stack: '',
          },
        },
      }));
    });
  }
}
