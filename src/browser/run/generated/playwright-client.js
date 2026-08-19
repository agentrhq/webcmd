/* Webcmd Playwright QuickJS client: Playwright v1.61.1 (39e3553a4f283a41134d75d7e404484bd9e6865a, Apache-2.0) */
"use strict";
var __WebcmdPlaywrightClient = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/browser/run/playwright-client/bundle-entry.ts
  var bundle_entry_exports = {};
  __export(bundle_entry_exports, {
    convertInputFiles: () => convertInputFiles,
    createConnection: () => createConnection,
    quickjsPlatform: () => quickjsPlatform,
    serializeArgument: () => serializeArgument,
    tBinary: () => tBinary
  });

  // src/browser/run/playwright-client/vendor/isomorphic/stackTrace.ts
  function captureRawStack() {
    const stackTraceLimit = Error.stackTraceLimit;
    Error.stackTraceLimit = 50;
    const error = new Error();
    const stack = error.stack || "";
    Error.stackTraceLimit = stackTraceLimit;
    return stack.split("\n");
  }
  function parseStackFrame(text, pathSeparator, showInternalStackFrames) {
    const match = text && text.match(re);
    if (!match)
      return null;
    let fname = match[2];
    let file = match[7];
    if (!file)
      return null;
    if (!showInternalStackFrames && (file.startsWith("internal") || file.startsWith("node:")))
      return null;
    const line = match[8];
    const column = match[9];
    const closeParen = match[11] === ")";
    const frame = {
      file: "",
      line: 0,
      column: 0
    };
    if (line)
      frame.line = Number(line);
    if (column)
      frame.column = Number(column);
    if (closeParen && file) {
      let closes = 0;
      for (let i = file.length - 1; i > 0; i--) {
        if (file.charAt(i) === ")") {
          closes++;
        } else if (file.charAt(i) === "(" && file.charAt(i - 1) === " ") {
          closes--;
          if (closes === -1 && file.charAt(i - 1) === " ") {
            const before = file.slice(0, i - 1);
            const after = file.slice(i + 1);
            file = after;
            fname += ` (${before}`;
            break;
          }
        }
      }
    }
    if (fname) {
      const methodMatch = fname.match(methodRe);
      if (methodMatch)
        fname = methodMatch[1];
    }
    if (file) {
      if (file.startsWith("file://"))
        file = fileURLToPath(file, pathSeparator);
      frame.file = file;
    }
    if (fname)
      frame.function = fname;
    return frame;
  }
  function rewriteErrorMessage(e, newMessage) {
    const lines = (e.stack?.split("\n") || []).filter((l) => l.startsWith("    at "));
    e.message = newMessage;
    const errorTitle = `${e.name}: ${e.message}`;
    if (lines.length)
      e.stack = `${errorTitle}
${lines.join("\n")}`;
    return e;
  }
  function stringifyStackFrames(frames) {
    const stackLines = [];
    for (const frame of frames) {
      if (frame.function)
        stackLines.push(`    at ${frame.function} (${frame.file}:${frame.line}:${frame.column})`);
      else
        stackLines.push(`    at ${frame.file}:${frame.line}:${frame.column}`);
    }
    return stackLines;
  }
  var re = new RegExp(
    "^(?:\\s*at )?(?:(new) )?(?:(.*?) \\()?(?:eval at ([^ ]+) \\((.+?):(\\d+):(\\d+)\\), )?(?:(.+?):(\\d+):(\\d+)|(native))(\\)?)$"
  );
  var methodRe = /^(.*?) \[as (.*?)\]$/;
  function fileURLToPath(fileUrl, pathSeparator) {
    if (!fileUrl.startsWith("file://"))
      return fileUrl;
    let path = decodeURIComponent(fileUrl.slice(7));
    if (path.startsWith("/") && /^[a-zA-Z]:/.test(path.slice(1)))
      path = path.slice(1);
    return path.replace(/\//g, pathSeparator);
  }

  // src/browser/run/playwright-client/vendor/client/eventEmitter.ts
  var EventEmitter = class {
    _events = void 0;
    _eventsCount = 0;
    _maxListeners = void 0;
    _pendingHandlers = /* @__PURE__ */ new Map();
    _rejectionHandler;
    _platform;
    constructor(platform) {
      this._platform = platform;
      if (this._events === void 0 || this._events === Object.getPrototypeOf(this)._events) {
        this._events = /* @__PURE__ */ Object.create(null);
        this._eventsCount = 0;
      }
      this._maxListeners = this._maxListeners || void 0;
      this.on = this.addListener;
      this.off = this.removeListener;
    }
    setMaxListeners(n) {
      if (typeof n !== "number" || n < 0 || Number.isNaN(n))
        throw new RangeError('The value of "n" is out of range. It must be a non-negative number. Received ' + n + ".");
      this._maxListeners = n;
      return this;
    }
    getMaxListeners() {
      return this._maxListeners === void 0 ? this._platform.defaultMaxListeners() : this._maxListeners;
    }
    emit(type, ...args) {
      const events = this._events;
      if (events === void 0)
        return false;
      const handler = events?.[type];
      if (handler === void 0)
        return false;
      if (typeof handler === "function") {
        this._callHandler(type, handler, args);
      } else {
        const len = handler.length;
        const listeners = handler.slice();
        for (let i = 0; i < len; ++i)
          this._callHandler(type, listeners[i], args);
      }
      return true;
    }
    _callHandler(type, handler, args) {
      const promise = Reflect.apply(handler, this, args);
      if (!(promise instanceof Promise))
        return;
      let set = this._pendingHandlers.get(type);
      if (!set) {
        set = /* @__PURE__ */ new Set();
        this._pendingHandlers.set(type, set);
      }
      set.add(promise);
      promise.catch((e) => {
        if (this._rejectionHandler)
          this._rejectionHandler(e);
        else
          throw e;
      }).finally(() => set.delete(promise));
    }
    addListener(type, listener) {
      return this._addListener(type, listener, false);
    }
    on(type, listener) {
      return this._addListener(type, listener, false);
    }
    _addListener(type, listener, prepend) {
      checkListener(listener);
      let events = this._events;
      let existing;
      if (events === void 0) {
        events = this._events = /* @__PURE__ */ Object.create(null);
        this._eventsCount = 0;
      } else {
        if (events.newListener !== void 0) {
          this.emit("newListener", type, unwrapListener(listener));
          events = this._events;
        }
        existing = events[type];
      }
      if (existing === void 0) {
        existing = events[type] = listener;
        ++this._eventsCount;
      } else {
        if (typeof existing === "function") {
          existing = events[type] = prepend ? [listener, existing] : [existing, listener];
        } else if (prepend) {
          existing.unshift(listener);
        } else {
          existing.push(listener);
        }
        const m = this.getMaxListeners();
        if (m > 0 && existing.length > m && !existing.warned) {
          existing.warned = true;
          const w = new Error("Possible EventEmitter memory leak detected. " + existing.length + " " + String(type) + " listeners added. Use emitter.setMaxListeners() to increase limit");
          w.name = "MaxListenersExceededWarning";
          w.emitter = this;
          w.type = type;
          w.count = existing.length;
          if (!this._platform.isUnderTest()) {
            console.warn(w);
          }
        }
      }
      return this;
    }
    prependListener(type, listener) {
      return this._addListener(type, listener, true);
    }
    once(type, listener) {
      checkListener(listener);
      this.on(type, new OnceWrapper(this, type, listener).wrapperFunction);
      return this;
    }
    prependOnceListener(type, listener) {
      checkListener(listener);
      this.prependListener(type, new OnceWrapper(this, type, listener).wrapperFunction);
      return this;
    }
    removeListener(type, listener) {
      checkListener(listener);
      const events = this._events;
      if (events === void 0)
        return this;
      const list = events[type];
      if (list === void 0)
        return this;
      if (list === listener || list.listener === listener) {
        if (--this._eventsCount === 0) {
          this._events = /* @__PURE__ */ Object.create(null);
        } else {
          delete events[type];
          if (events.removeListener)
            this.emit("removeListener", type, list.listener ?? listener);
        }
      } else if (typeof list !== "function") {
        let position = -1;
        let originalListener;
        for (let i = list.length - 1; i >= 0; i--) {
          if (list[i] === listener || wrappedListener(list[i]) === listener) {
            originalListener = wrappedListener(list[i]);
            position = i;
            break;
          }
        }
        if (position < 0)
          return this;
        if (position === 0)
          list.shift();
        else
          list.splice(position, 1);
        if (list.length === 1)
          events[type] = list[0];
        if (events.removeListener !== void 0)
          this.emit("removeListener", type, originalListener || listener);
      }
      return this;
    }
    off(type, listener) {
      return this.removeListener(type, listener);
    }
    removeAllListeners(type, options) {
      this._removeAllListeners(type);
      if (!options)
        return this;
      if (options.behavior === "wait") {
        const errors = [];
        this._rejectionHandler = (error) => errors.push(error);
        return this._waitFor(type).then(() => {
          if (errors.length)
            throw errors[0];
        });
      }
      if (options.behavior === "ignoreErrors")
        this._rejectionHandler = () => {
        };
      return Promise.resolve();
    }
    _removeAllListeners(type) {
      const events = this._events;
      if (!events)
        return;
      if (!events.removeListener) {
        if (type === void 0) {
          this._events = /* @__PURE__ */ Object.create(null);
          this._eventsCount = 0;
        } else if (events[type] !== void 0) {
          if (--this._eventsCount === 0)
            this._events = /* @__PURE__ */ Object.create(null);
          else
            delete events[type];
        }
        return;
      }
      if (type === void 0) {
        const keys = Object.keys(events);
        let key;
        for (let i = 0; i < keys.length; ++i) {
          key = keys[i];
          if (key === "removeListener")
            continue;
          this._removeAllListeners(key);
        }
        this._removeAllListeners("removeListener");
        this._events = /* @__PURE__ */ Object.create(null);
        this._eventsCount = 0;
        return;
      }
      const listeners = events[type];
      if (typeof listeners === "function") {
        this.removeListener(type, listeners);
      } else if (listeners !== void 0) {
        for (let i = listeners.length - 1; i >= 0; i--)
          this.removeListener(type, listeners[i]);
      }
    }
    listeners(type) {
      return this._listeners(this, type, true);
    }
    rawListeners(type) {
      return this._listeners(this, type, false);
    }
    listenerCount(type) {
      const events = this._events;
      if (events !== void 0) {
        const listener = events[type];
        if (typeof listener === "function")
          return 1;
        if (listener !== void 0)
          return listener.length;
      }
      return 0;
    }
    eventNames() {
      return this._eventsCount > 0 && this._events ? Reflect.ownKeys(this._events) : [];
    }
    async _waitFor(type) {
      let promises = [];
      if (type) {
        promises = [...this._pendingHandlers.get(type) || []];
      } else {
        promises = [];
        for (const [, pending] of this._pendingHandlers)
          promises.push(...pending);
      }
      await Promise.all(promises);
    }
    _listeners(target, type, unwrap) {
      const events = target._events;
      if (events === void 0)
        return [];
      const listener = events[type];
      if (listener === void 0)
        return [];
      if (typeof listener === "function")
        return unwrap ? [unwrapListener(listener)] : [listener];
      return unwrap ? unwrapListeners(listener) : listener.slice();
    }
  };
  function checkListener(listener) {
    if (typeof listener !== "function")
      throw new TypeError('The "listener" argument must be of type Function. Received type ' + typeof listener);
  }
  var OnceWrapper = class {
    _fired = false;
    wrapperFunction;
    _listener;
    _eventEmitter;
    _eventType;
    constructor(eventEmitter, eventType, listener) {
      this._eventEmitter = eventEmitter;
      this._eventType = eventType;
      this._listener = listener;
      this.wrapperFunction = this._handle.bind(this);
      this.wrapperFunction.listener = listener;
    }
    _handle(...args) {
      if (this._fired)
        return;
      this._fired = true;
      this._eventEmitter.removeListener(this._eventType, this.wrapperFunction);
      return this._listener.apply(this._eventEmitter, args);
    }
  };
  function unwrapListener(l) {
    return wrappedListener(l) ?? l;
  }
  function unwrapListeners(arr) {
    return arr.map((l) => wrappedListener(l) ?? l);
  }
  function wrappedListener(l) {
    return l.listener;
  }

  // src/browser/run/playwright-client/vendor/isomorphic/stringUtils.ts
  function escapeWithQuotes(text, char = "'") {
    const stringified = JSON.stringify(text);
    const escapedText = stringified.substring(1, stringified.length - 1).replace(/\\"/g, '"');
    if (char === "'")
      return char + escapedText.replace(/[']/g, "\\'") + char;
    if (char === '"')
      return char + escapedText.replace(/["]/g, '\\"') + char;
    if (char === "`")
      return char + escapedText.replace(/[`]/g, "\\`") + char;
    throw new Error("Invalid escape char");
  }
  function isString(obj) {
    return typeof obj === "string" || obj instanceof String;
  }
  function toTitleCase(name) {
    return name.charAt(0).toUpperCase() + name.substring(1);
  }
  function toSnakeCase(name) {
    return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/([A-Z])([A-Z][a-z])/g, "$1_$2").toLowerCase();
  }
  function normalizeEscapedRegexQuotes(source) {
    return source.replace(/(^|[^\\])(\\\\)*\\(['"`])/g, "$1$2$3");
  }
  function escapeRegexForSelector(re2) {
    if (re2.unicode || re2.unicodeSets)
      return String(re2);
    return String(re2).replace(/(^|[^\\])(\\\\)*(["'`])/g, "$1$2\\$3").replace(/>>/g, "\\>\\>");
  }
  function escapeForTextSelector(text, exact) {
    if (typeof text !== "string")
      return escapeRegexForSelector(text);
    return `${JSON.stringify(text)}${exact ? "s" : "i"}`;
  }
  function escapeForAttributeSelector(value, exact) {
    if (typeof value !== "string")
      return escapeRegexForSelector(value);
    return `"${value.replace(/\\/g, "\\\\").replace(/["]/g, '\\"')}"${exact ? "s" : "i"}`;
  }
  function trimString(input, cap, suffix = "") {
    if (input.length <= cap)
      return input;
    const chars = [...input];
    if (chars.length > cap)
      return chars.slice(0, cap - suffix.length).join("") + suffix;
    return chars.join("");
  }
  function trimStringWithEllipsis(input, cap) {
    return trimString(input, cap, "\u2026");
  }
  var ansiRegex = new RegExp("([\\u001B\\u009B][[\\]()#?]*(?:(?:(?:[a-zA-Z\\d]*(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)|(?:(?:\\d{0,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~])))", "g");

  // src/browser/run/playwright-client/vendor/isomorphic/rtti.ts
  function isRegExp(obj) {
    return obj instanceof RegExp || Object.prototype.toString.call(obj) === "[object RegExp]";
  }
  function isObject(obj) {
    return typeof obj === "object" && obj !== null;
  }
  function isError(obj) {
    return obj instanceof Error || obj && Object.getPrototypeOf(obj)?.name === "Error";
  }

  // src/browser/run/playwright-client/vendor/isomorphic/time.ts
  var clock = globalThis.performance;
  var clockOrigin = clock?.timeOrigin ?? Date.now();
  var clockNow = () => clock?.now() ?? Date.now() - clockOrigin;
  var _timeShift = 0;
  function monotonicTime() {
    return Math.floor((clockNow() + _timeShift) * 1e3) / 1e3;
  }
  var DEFAULT_PLAYWRIGHT_TIMEOUT = 3e4;
  var DEFAULT_PLAYWRIGHT_LAUNCH_TIMEOUT = 3 * 60 * 1e3;

  // src/browser/run/playwright-client/vendor/isomorphic/timeoutRunner.ts
  async function raceAgainstDeadline(cb, deadline) {
    let timer;
    return await Promise.race([
      cb().then((result) => {
        return { result, timedOut: false };
      }),
      new Promise((resolve) => {
        if (!deadline)
          return;
        timer = setTimeout(() => resolve({ timedOut: true }), deadline - monotonicTime());
      })
    ]).finally(() => {
      clearTimeout(timer);
    });
  }

  // src/browser/run/playwright-client/vendor/isomorphic/headers.ts
  function headersObjectToArray(headers, separator, setCookieSeparator) {
    if (!setCookieSeparator)
      setCookieSeparator = separator;
    const result = [];
    for (const name in headers) {
      const values = headers[name];
      if (values === void 0)
        continue;
      if (separator) {
        const sep = name.toLowerCase() === "set-cookie" ? setCookieSeparator : separator;
        for (const value of values.split(sep))
          result.push({ name, value: value.trim() });
      } else {
        result.push({ name, value: values });
      }
    }
    return result;
  }

  // src/browser/run/playwright-client/vendor/isomorphic/urlMatch.ts
  var escapedChars = /* @__PURE__ */ new Set(["$", "^", "+", ".", "*", "(", ")", "|", "\\", "?", "{", "}", "[", "]"]);
  function globToRegexPattern(glob) {
    const tokens = ["^"];
    let inGroup = false;
    for (let i = 0; i < glob.length; ++i) {
      const c = glob[i];
      if (c === "\\" && i + 1 < glob.length) {
        const char = glob[++i];
        tokens.push(escapedChars.has(char) ? "\\" + char : char);
        continue;
      }
      if (c === "*") {
        const charBefore = glob[i - 1];
        let starCount = 1;
        while (glob[i + 1] === "*") {
          starCount++;
          i++;
        }
        if (starCount > 1) {
          const charAfter = glob[i + 1];
          if (charAfter === "/") {
            if (charBefore === "/")
              tokens.push("((.+/)|)");
            else
              tokens.push("(.*/)");
            ++i;
          } else {
            tokens.push("(.*)");
          }
        } else {
          tokens.push("([^/]*)");
        }
        continue;
      }
      switch (c) {
        case "{":
          if (inGroup)
            throw new Error(`Invalid glob pattern ${JSON.stringify(glob)}: nested '{' is not supported`);
          inGroup = true;
          tokens.push("(");
          break;
        case "}":
          if (!inGroup)
            throw new Error(`Invalid glob pattern ${JSON.stringify(glob)}: unmatched '}'`);
          inGroup = false;
          tokens.push(")");
          break;
        case ",":
          if (inGroup) {
            tokens.push("|");
            break;
          }
          tokens.push("\\" + c);
          break;
        default:
          tokens.push(escapedChars.has(c) ? "\\" + c : c);
      }
    }
    if (inGroup)
      throw new Error(`Invalid glob pattern ${JSON.stringify(glob)}: unmatched '{'`);
    tokens.push("$");
    return tokens.join("");
  }
  function isRegExp2(obj) {
    return obj instanceof RegExp || Object.prototype.toString.call(obj) === "[object RegExp]";
  }
  var isURLPattern = (v) => typeof globalThis.URLPattern === "function" && v instanceof globalThis.URLPattern;
  function serializeURLPattern(v) {
    return {
      hash: v.hash,
      hostname: v.hostname,
      password: v.password,
      pathname: v.pathname,
      port: v.port,
      protocol: v.protocol,
      search: v.search,
      username: v.username
    };
  }
  function serializeURLMatch(match) {
    if (isString(match))
      return { glob: match };
    if (isRegExp2(match))
      return { regexSource: match.source, regexFlags: match.flags };
    if (isURLPattern(match))
      return { urlPattern: serializeURLPattern(match) };
    return void 0;
  }
  function urlMatchesEqual(match1, match2) {
    if (isRegExp2(match1) && isRegExp2(match2))
      return match1.source === match2.source && match1.flags === match2.flags;
    return match1 === match2;
  }
  function urlMatches(baseURL, urlString, match, webSocketUrl) {
    if (match === void 0 || match === "")
      return true;
    if (isString(match))
      match = new RegExp(resolveGlobToRegexPattern(baseURL, match, webSocketUrl));
    if (isRegExp2(match)) {
      const r = match.test(urlString);
      return r;
    }
    const url = parseURL(urlString);
    if (!url)
      return false;
    if (isURLPattern(match))
      return match.test(url.href);
    if (typeof match !== "function")
      throw new Error("url parameter should be string, RegExp, URLPattern or function");
    return match(url);
  }
  function resolveGlobToRegexPattern(baseURL, glob, webSocketUrl) {
    if (webSocketUrl)
      baseURL = toWebSocketBaseUrl(baseURL);
    glob = resolveGlobBase(baseURL, glob);
    return globToRegexPattern(glob);
  }
  function toWebSocketBaseUrl(baseURL) {
    if (baseURL && /^https?:\/\//.test(baseURL))
      baseURL = baseURL.replace(/^http/, "ws");
    return baseURL;
  }
  function resolveGlobBase(baseURL, match) {
    if (!match.startsWith("*")) {
      let mapToken2 = function(original, replacement) {
        if (original.length === 0)
          return "";
        tokenMap.set(replacement, original);
        return replacement;
      };
      var mapToken = mapToken2;
      const tokenMap = /* @__PURE__ */ new Map();
      match = match.replaceAll(/\\\\\?/g, "?");
      if (match.startsWith("about:") || match.startsWith("data:") || match.startsWith("chrome:") || match.startsWith("edge:") || match.startsWith("file:"))
        return match;
      const relativePath = match.split("/").map((token, index) => {
        if (token === "." || token === ".." || token === "")
          return token;
        if (index === 0 && token.endsWith(":")) {
          if (token.indexOf("*") !== -1 || token.indexOf("{") !== -1)
            return mapToken2(token, "http:");
          return token;
        }
        const questionIndex = token.indexOf("?");
        if (questionIndex === -1)
          return mapToken2(token, `$_${index}_$`);
        const newPrefix = mapToken2(token.substring(0, questionIndex), `$_${index}_$`);
        const newSuffix = mapToken2(token.substring(questionIndex), `?$_${index}_$`);
        return newPrefix + newSuffix;
      }).join("/");
      const result = resolveBaseURL(baseURL, relativePath);
      let resolved = result.resolved;
      for (const [token, original] of tokenMap) {
        const normalize = result.caseInsensitivePart?.includes(token);
        resolved = resolved.replace(token, normalize ? original.toLowerCase() : original);
      }
      match = resolved;
    }
    return match;
  }
  function parseURL(url) {
    try {
      return new URL(url);
    } catch (e) {
      return null;
    }
  }
  function resolveBaseURL(baseURL, givenURL) {
    try {
      const url = new URL(givenURL, baseURL);
      const resolved = url.toString();
      const caseInsensitivePrefix = url.origin;
      return { resolved, caseInsensitivePart: caseInsensitivePrefix };
    } catch (e) {
      return { resolved: givenURL };
    }
  }

  // src/browser/run/playwright-client/vendor/isomorphic/protocolMetainfo.ts
  var methodMetainfo = /* @__PURE__ */ new Map([
    ["Android.devices", { internal: true }],
    ["AndroidSocket.write", { internal: true }],
    ["AndroidSocket.close", { internal: true }],
    ["AndroidDevice.wait", { title: "Wait" }],
    ["AndroidDevice.fill", { title: 'Fill "{text}"' }],
    ["AndroidDevice.tap", { title: "Tap" }],
    ["AndroidDevice.drag", { title: "Drag" }],
    ["AndroidDevice.fling", { title: "Fling" }],
    ["AndroidDevice.longTap", { title: "Long tap" }],
    ["AndroidDevice.pinchClose", { title: "Pinch close" }],
    ["AndroidDevice.pinchOpen", { title: "Pinch open" }],
    ["AndroidDevice.scroll", { title: "Scroll" }],
    ["AndroidDevice.swipe", { title: "Swipe" }],
    ["AndroidDevice.info", { internal: true }],
    ["AndroidDevice.screenshot", { title: "Screenshot" }],
    ["AndroidDevice.inputType", { title: "Type" }],
    ["AndroidDevice.inputPress", { title: "Press" }],
    ["AndroidDevice.inputTap", { title: "Tap" }],
    ["AndroidDevice.inputSwipe", { title: "Swipe" }],
    ["AndroidDevice.inputDrag", { title: "Drag" }],
    ["AndroidDevice.launchBrowser", { title: "Launch browser" }],
    ["AndroidDevice.open", { title: "Open app" }],
    ["AndroidDevice.shell", { title: "Execute shell command", group: "configuration" }],
    ["AndroidDevice.installApk", { title: "Install apk" }],
    ["AndroidDevice.push", { title: "Push" }],
    ["AndroidDevice.connectToWebView", { title: "Connect to Web View" }],
    ["AndroidDevice.close", { internal: true }],
    ["APIRequestContext.fetch", { title: '{method} "{url}"' }],
    ["APIRequestContext.fetchResponseBody", { title: "Get response body", group: "getter" }],
    ["APIRequestContext.fetchLog", { internal: true }],
    ["APIRequestContext.storageState", { title: "Get storage state", group: "configuration" }],
    ["APIRequestContext.disposeAPIResponse", { internal: true }],
    ["APIRequestContext.dispose", { internal: true, potentiallyClosesScope: true }],
    ["Artifact.pathAfterFinished", { internal: true }],
    ["Artifact.saveAs", { internal: true }],
    ["Artifact.saveAsStream", { internal: true }],
    ["Artifact.failure", { internal: true }],
    ["Artifact.stream", { internal: true }],
    ["Artifact.cancel", { internal: true }],
    ["Artifact.delete", { internal: true, potentiallyClosesScope: true }],
    ["Stream.read", { internal: true }],
    ["Stream.close", { internal: true }],
    ["WritableStream.write", { internal: true }],
    ["WritableStream.close", { internal: true }],
    ["Browser.startServer", { title: "Start server" }],
    ["Browser.stopServer", { title: "Stop server" }],
    ["Browser.close", { title: "Close browser", pause: true, potentiallyClosesScope: true }],
    ["Browser.killForTests", { internal: true, potentiallyClosesScope: true }],
    ["Browser.defaultUserAgentForTest", { internal: true }],
    ["Browser.newContext", { title: "Create context" }],
    ["Browser.newContextForReuse", { internal: true }],
    ["Browser.disconnectFromReusedContext", { internal: true }],
    ["Browser.newBrowserCDPSession", { title: "Create CDP session", group: "configuration" }],
    ["Browser.startTracing", { title: "Start browser tracing", group: "configuration" }],
    ["Browser.stopTracing", { title: "Stop browser tracing", group: "configuration" }],
    ["BrowserContext.addCookies", { title: "Add cookies", group: "configuration" }],
    ["BrowserContext.addInitScript", { title: "Add init script", group: "configuration" }],
    ["BrowserContext.clearCookies", { title: "Clear cookies", group: "configuration" }],
    ["BrowserContext.clearPermissions", { title: "Clear permissions", group: "configuration" }],
    ["BrowserContext.close", { title: "Close context", pause: true, potentiallyClosesScope: true }],
    ["BrowserContext.cookies", { title: "Get cookies", group: "getter" }],
    ["BrowserContext.exposeBinding", { title: "Expose binding", group: "configuration" }],
    ["BrowserContext.grantPermissions", { title: "Grant permissions", group: "configuration" }],
    ["BrowserContext.newPage", { title: "Create page" }],
    ["BrowserContext.registerSelectorEngine", { internal: true }],
    ["BrowserContext.setTestIdAttributeName", { internal: true }],
    ["BrowserContext.setExtraHTTPHeaders", { title: "Set extra HTTP headers", group: "configuration" }],
    ["BrowserContext.setGeolocation", { title: "Set geolocation", group: "configuration" }],
    ["BrowserContext.setHTTPCredentials", { title: "Set HTTP credentials", group: "configuration" }],
    ["BrowserContext.setNetworkInterceptionPatterns", { title: "Route requests", group: "route" }],
    ["BrowserContext.setWebSocketInterceptionPatterns", { title: "Route WebSockets", group: "route" }],
    ["BrowserContext.setOffline", { title: "Set offline mode" }],
    ["BrowserContext.storageState", { title: "Get storage state", group: "configuration" }],
    ["BrowserContext.setStorageState", { title: "Set storage state", group: "configuration" }],
    ["BrowserContext.pause", { title: "Pause" }],
    ["BrowserContext.enableRecorder", { internal: true }],
    ["BrowserContext.disableRecorder", { internal: true }],
    ["BrowserContext.exposeConsoleApi", { internal: true }],
    ["BrowserContext.newCDPSession", { title: "Create CDP session", group: "configuration" }],
    ["BrowserContext.createTempFiles", { internal: true }],
    ["BrowserContext.updateSubscription", { internal: true }],
    ["BrowserContext.clockFastForward", { title: 'Fast forward clock "{ticksNumber|ticksString}"' }],
    ["BrowserContext.clockInstall", { title: 'Install clock "{timeNumber|timeString}"' }],
    ["BrowserContext.clockPauseAt", { title: 'Pause clock "{timeNumber|timeString}"' }],
    ["BrowserContext.clockResume", { title: "Resume clock" }],
    ["BrowserContext.clockRunFor", { title: 'Run clock "{ticksNumber|ticksString}"' }],
    ["BrowserContext.clockSetFixedTime", { title: 'Set fixed time "{timeNumber|timeString}"' }],
    ["BrowserContext.clockSetSystemTime", { title: 'Set system time "{timeNumber|timeString}"' }],
    ["BrowserContext.credentialsInstall", { title: "Install virtual WebAuthn authenticator", group: "configuration" }],
    ["BrowserContext.credentialsCreate", { title: 'Create virtual credential for "{rpId}"', group: "configuration" }],
    ["BrowserContext.credentialsGet", { title: "Get virtual credentials", group: "configuration" }],
    ["BrowserContext.credentialsDelete", { title: "Delete virtual credential", group: "configuration" }],
    ["BrowserType.launch", { title: "Launch browser" }],
    ["BrowserType.launchPersistentContext", { title: "Launch persistent context" }],
    ["BrowserType.connectOverCDP", { title: "Connect over CDP" }],
    ["BrowserType.connectToWorker", { title: "Connect to worker" }],
    ["Disposable.dispose", { internal: true, potentiallyClosesScope: true }],
    ["Electron.launch", { title: "Launch electron" }],
    ["ElectronApplication.browserWindow", { internal: true }],
    ["ElectronApplication.evaluateExpression", { title: "Evaluate" }],
    ["ElectronApplication.evaluateExpressionHandle", { title: "Evaluate" }],
    ["ElectronApplication.updateSubscription", { internal: true }],
    ["Frame.evalOnSelector", { title: "Evaluate", snapshot: true, pause: true }],
    ["Frame.evalOnSelectorAll", { title: "Evaluate", snapshot: true, pause: true }],
    ["Frame.addScriptTag", { title: "Add script tag", snapshot: true, pause: true }],
    ["Frame.addStyleTag", { title: "Add style tag", snapshot: true, pause: true }],
    ["Frame.ariaSnapshot", { title: "Aria snapshot", group: "getter" }],
    ["Frame.blur", { title: "Blur", slowMo: true, snapshot: true, pause: true }],
    ["Frame.check", { title: "Check", slowMo: true, snapshot: true, pause: true, input: true, isAutoWaiting: true }],
    ["Frame.click", { title: "Click", slowMo: true, snapshot: true, pause: true, input: true, isAutoWaiting: true, potentiallyClosesScope: true }],
    ["Frame.content", { title: "Get content", snapshot: true, pause: true }],
    ["Frame.dragAndDrop", { title: "Drag and drop", slowMo: true, snapshot: true, pause: true, input: true, isAutoWaiting: true }],
    ["Frame.drop", { title: "Drop files or data onto an element", slowMo: true, snapshot: true, pause: true, input: true, isAutoWaiting: true }],
    ["Frame.dblclick", { title: "Double click", slowMo: true, snapshot: true, pause: true, input: true, isAutoWaiting: true }],
    ["Frame.dispatchEvent", { title: 'Dispatch "{type}"', slowMo: true, snapshot: true, pause: true }],
    ["Frame.evaluateExpression", { title: "Evaluate", snapshot: true, pause: true }],
    ["Frame.evaluateExpressionHandle", { title: "Evaluate", snapshot: true, pause: true }],
    ["Frame.fill", { title: 'Fill "{value}"', slowMo: true, snapshot: true, pause: true, input: true, isAutoWaiting: true }],
    ["Frame.focus", { title: "Focus", slowMo: true, snapshot: true, pause: true }],
    ["Frame.frameElement", { title: "Get frame element", group: "getter" }],
    ["Frame.resolveSelector", { internal: true }],
    ["Frame.highlight", { internal: true }],
    ["Frame.hideHighlight", { internal: true }],
    ["Frame.getAttribute", { title: 'Get attribute "{name}"', snapshot: true, pause: true, group: "getter" }],
    ["Frame.goto", { title: 'Navigate to "{url}"', slowMo: true, snapshot: true, pause: true }],
    ["Frame.hover", { title: "Hover", slowMo: true, snapshot: true, pause: true, input: true, isAutoWaiting: true }],
    ["Frame.innerHTML", { title: "Get HTML", snapshot: true, pause: true, group: "getter" }],
    ["Frame.innerText", { title: "Get inner text", snapshot: true, pause: true, group: "getter" }],
    ["Frame.inputValue", { title: "Get input value", snapshot: true, pause: true, group: "getter" }],
    ["Frame.isChecked", { title: "Is checked", snapshot: true, pause: true, group: "getter" }],
    ["Frame.isDisabled", { title: "Is disabled", snapshot: true, pause: true, group: "getter" }],
    ["Frame.isEnabled", { title: "Is enabled", snapshot: true, pause: true, group: "getter" }],
    ["Frame.isHidden", { title: "Is hidden", snapshot: true, pause: true, group: "getter" }],
    ["Frame.isVisible", { title: "Is visible", snapshot: true, pause: true, group: "getter" }],
    ["Frame.isEditable", { title: "Is editable", snapshot: true, pause: true, group: "getter" }],
    ["Frame.press", { title: 'Press "{key}"', slowMo: true, snapshot: true, pause: true, input: true, isAutoWaiting: true }],
    ["Frame.querySelector", { title: "Query selector", snapshot: true }],
    ["Frame.querySelectorAll", { title: "Query selector all", snapshot: true }],
    ["Frame.queryCount", { title: "Query count", snapshot: true, pause: true }],
    ["Frame.selectOption", { title: "Select option", slowMo: true, snapshot: true, pause: true, input: true, isAutoWaiting: true }],
    ["Frame.setContent", { title: "Set content", snapshot: true, pause: true }],
    ["Frame.setInputFiles", { title: "Set input files", slowMo: true, snapshot: true, pause: true, input: true, isAutoWaiting: true }],
    ["Frame.tap", { title: "Tap", slowMo: true, snapshot: true, pause: true, input: true, isAutoWaiting: true }],
    ["Frame.textContent", { title: "Get text content", snapshot: true, pause: true, group: "getter" }],
    ["Frame.title", { title: "Get page title", group: "getter" }],
    ["Frame.type", { title: 'Type "{text}"', slowMo: true, snapshot: true, pause: true, input: true, isAutoWaiting: true }],
    ["Frame.uncheck", { title: "Uncheck", slowMo: true, snapshot: true, pause: true, input: true, isAutoWaiting: true }],
    ["Frame.waitForTimeout", { title: "Wait for timeout", snapshot: true }],
    ["Frame.waitForFunction", { title: "Wait for function", snapshot: true, pause: true }],
    ["Frame.waitForSelector", { title: "Wait for selector", snapshot: true }],
    ["Frame.expect", { title: 'Expect "{expression}"', snapshot: true, pause: true }],
    ["JSHandle.dispose", { internal: true, potentiallyClosesScope: true }],
    ["ElementHandle.dispose", { internal: true, potentiallyClosesScope: true }],
    ["JSHandle.evaluateExpression", { title: "Evaluate", snapshot: true, pause: true }],
    ["ElementHandle.evaluateExpression", { title: "Evaluate", snapshot: true, pause: true }],
    ["JSHandle.evaluateExpressionHandle", { title: "Evaluate", snapshot: true, pause: true }],
    ["ElementHandle.evaluateExpressionHandle", { title: "Evaluate", snapshot: true, pause: true }],
    ["JSHandle.getPropertyList", { title: "Get property list", group: "getter" }],
    ["ElementHandle.getPropertyList", { title: "Get property list", group: "getter" }],
    ["JSHandle.getProperty", { title: "Get JS property", group: "getter" }],
    ["ElementHandle.getProperty", { title: "Get JS property", group: "getter" }],
    ["JSHandle.jsonValue", { title: "Get JSON value", group: "getter" }],
    ["ElementHandle.jsonValue", { title: "Get JSON value", group: "getter" }],
    ["ElementHandle.evalOnSelector", { title: "Evaluate", snapshot: true, pause: true }],
    ["ElementHandle.evalOnSelectorAll", { title: "Evaluate", snapshot: true, pause: true }],
    ["ElementHandle.boundingBox", { title: "Get bounding box", snapshot: true, pause: true }],
    ["ElementHandle.check", { title: "Check", slowMo: true, snapshot: true, pause: true, input: true, isAutoWaiting: true }],
    ["ElementHandle.click", { title: "Click", slowMo: true, snapshot: true, pause: true, input: true, isAutoWaiting: true }],
    ["ElementHandle.contentFrame", { title: "Get content frame", group: "getter" }],
    ["ElementHandle.dblclick", { title: "Double click", slowMo: true, snapshot: true, pause: true, input: true, isAutoWaiting: true }],
    ["ElementHandle.dispatchEvent", { title: "Dispatch event", slowMo: true, snapshot: true, pause: true }],
    ["ElementHandle.fill", { title: 'Fill "{value}"', slowMo: true, snapshot: true, pause: true, input: true, isAutoWaiting: true }],
    ["ElementHandle.focus", { title: "Focus", slowMo: true, snapshot: true, pause: true }],
    ["ElementHandle.getAttribute", { title: "Get attribute", snapshot: true, pause: true, group: "getter" }],
    ["ElementHandle.hover", { title: "Hover", slowMo: true, snapshot: true, pause: true, input: true, isAutoWaiting: true }],
    ["ElementHandle.innerHTML", { title: "Get HTML", snapshot: true, pause: true, group: "getter" }],
    ["ElementHandle.innerText", { title: "Get inner text", snapshot: true, pause: true, group: "getter" }],
    ["ElementHandle.inputValue", { title: "Get input value", snapshot: true, pause: true, group: "getter" }],
    ["ElementHandle.isChecked", { title: "Is checked", snapshot: true, pause: true, group: "getter" }],
    ["ElementHandle.isDisabled", { title: "Is disabled", snapshot: true, pause: true, group: "getter" }],
    ["ElementHandle.isEditable", { title: "Is editable", snapshot: true, pause: true, group: "getter" }],
    ["ElementHandle.isEnabled", { title: "Is enabled", snapshot: true, pause: true, group: "getter" }],
    ["ElementHandle.isHidden", { title: "Is hidden", snapshot: true, pause: true, group: "getter" }],
    ["ElementHandle.isVisible", { title: "Is visible", snapshot: true, pause: true, group: "getter" }],
    ["ElementHandle.ownerFrame", { title: "Get owner frame", group: "getter" }],
    ["ElementHandle.press", { title: 'Press "{key}"', slowMo: true, snapshot: true, pause: true, input: true, isAutoWaiting: true }],
    ["ElementHandle.querySelector", { title: "Query selector", snapshot: true }],
    ["ElementHandle.querySelectorAll", { title: "Query selector all", snapshot: true }],
    ["ElementHandle.screenshot", { title: "Screenshot", snapshot: true, pause: true }],
    ["ElementHandle.scrollIntoViewIfNeeded", { title: "Scroll into view", slowMo: true, snapshot: true, pause: true }],
    ["ElementHandle.selectOption", { title: "Select option", slowMo: true, snapshot: true, pause: true, input: true, isAutoWaiting: true }],
    ["ElementHandle.selectText", { title: "Select text", slowMo: true, snapshot: true, pause: true }],
    ["ElementHandle.setInputFiles", { title: "Set input files", slowMo: true, snapshot: true, pause: true, input: true, isAutoWaiting: true }],
    ["ElementHandle.tap", { title: "Tap", slowMo: true, snapshot: true, pause: true, input: true, isAutoWaiting: true }],
    ["ElementHandle.textContent", { title: "Get text content", snapshot: true, pause: true, group: "getter" }],
    ["ElementHandle.type", { title: "Type", slowMo: true, snapshot: true, pause: true, input: true, isAutoWaiting: true }],
    ["ElementHandle.uncheck", { title: "Uncheck", slowMo: true, snapshot: true, pause: true, input: true, isAutoWaiting: true }],
    ["ElementHandle.waitForElementState", { title: "Wait for state", snapshot: true, pause: true }],
    ["ElementHandle.waitForSelector", { title: "Wait for selector", snapshot: true }],
    ["LocalUtils.zip", { internal: true }],
    ["LocalUtils.harOpen", { internal: true }],
    ["LocalUtils.harLookup", { internal: true }],
    ["LocalUtils.harClose", { internal: true }],
    ["LocalUtils.harUnzip", { internal: true }],
    ["LocalUtils.connect", { internal: true }],
    ["LocalUtils.tracingStarted", { internal: true }],
    ["LocalUtils.addStackToTracingNoReply", { internal: true }],
    ["LocalUtils.traceDiscarded", { internal: true }],
    ["LocalUtils.globToRegex", { internal: true }],
    ["Request.response", { internal: true }],
    ["Request.rawRequestHeaders", { internal: true }],
    ["Route.redirectNavigationRequest", { internal: true }],
    ["Route.abort", { title: "Abort request", group: "route" }],
    ["Route.continue", { title: "Continue request", group: "route" }],
    ["Route.fulfill", { title: "Fulfill request", group: "route" }],
    ["WebSocketRoute.connect", { title: "Connect WebSocket to server", group: "route" }],
    ["WebSocketRoute.ensureOpened", { internal: true }],
    ["WebSocketRoute.sendToPage", { title: "Send WebSocket message", group: "route" }],
    ["WebSocketRoute.sendToServer", { title: "Send WebSocket message", group: "route" }],
    ["WebSocketRoute.closePage", { internal: true }],
    ["WebSocketRoute.closeServer", { internal: true }],
    ["Response.body", { title: "Get response body", group: "getter" }],
    ["Response.securityDetails", { internal: true }],
    ["Response.serverAddr", { internal: true }],
    ["Response.rawResponseHeaders", { internal: true }],
    ["Response.httpVersion", { internal: true }],
    ["Response.sizes", { internal: true }],
    ["Page.addInitScript", { title: "Add init script", group: "configuration" }],
    ["Page.close", { title: "Close page", pause: true, potentiallyClosesScope: true }],
    ["Page.runBeforeUnload", { title: "Run beforeunload", pause: true }],
    ["Page.clearConsoleMessages", { title: "Clear console messages" }],
    ["Page.consoleMessages", { title: "Get console messages", group: "getter" }],
    ["Page.emulateMedia", { title: "Emulate media", snapshot: true, pause: true }],
    ["Page.exposeBinding", { title: "Expose binding", group: "configuration" }],
    ["Page.goBack", { title: "Go back", slowMo: true, snapshot: true, pause: true }],
    ["Page.goForward", { title: "Go forward", slowMo: true, snapshot: true, pause: true }],
    ["Page.requestGC", { title: "Request garbage collection", group: "configuration" }],
    ["Page.registerLocatorHandler", { title: "Register locator handler" }],
    ["Page.resolveLocatorHandlerNoReply", { internal: true }],
    ["Page.unregisterLocatorHandler", { title: "Unregister locator handler" }],
    ["Page.reload", { title: "Reload", slowMo: true, snapshot: true, pause: true }],
    ["Page.expectScreenshot", { title: "Expect screenshot", snapshot: true, pause: true }],
    ["Page.screenshot", { title: "Screenshot", snapshot: true, pause: true }],
    ["Page.setExtraHTTPHeaders", { title: "Set extra HTTP headers", group: "configuration" }],
    ["Page.setNetworkInterceptionPatterns", { title: "Route requests", group: "route" }],
    ["Page.setWebSocketInterceptionPatterns", { title: "Route WebSockets", group: "route" }],
    ["Page.setViewportSize", { title: "Set viewport size", snapshot: true, pause: true }],
    ["Page.keyboardDown", { title: 'Key down "{key}"', slowMo: true, snapshot: true, pause: true, input: true }],
    ["Page.keyboardUp", { title: 'Key up "{key}"', slowMo: true, snapshot: true, pause: true, input: true }],
    ["Page.keyboardInsertText", { title: 'Insert "{text}"', slowMo: true, snapshot: true, pause: true, input: true }],
    ["Page.keyboardType", { title: 'Type "{text}"', slowMo: true, snapshot: true, pause: true, input: true }],
    ["Page.keyboardPress", { title: 'Press "{key}"', slowMo: true, snapshot: true, pause: true, input: true }],
    ["Page.mouseMove", { title: "Mouse move", slowMo: true, snapshot: true, pause: true, input: true }],
    ["Page.mouseDown", { title: "Mouse down", slowMo: true, snapshot: true, pause: true, input: true }],
    ["Page.mouseUp", { title: "Mouse up", slowMo: true, snapshot: true, pause: true, input: true }],
    ["Page.mouseClick", { title: "Click", slowMo: true, snapshot: true, pause: true, input: true }],
    ["Page.mouseWheel", { title: "Mouse wheel", slowMo: true, snapshot: true, pause: true, input: true }],
    ["Page.touchscreenTap", { title: "Tap", slowMo: true, snapshot: true, pause: true, input: true }],
    ["Page.clearPageErrors", { title: "Clear page errors" }],
    ["Page.pageErrors", { title: "Get page errors", group: "getter" }],
    ["Page.pdf", { title: "PDF" }],
    ["Page.requests", { title: "Get network requests", group: "getter" }],
    ["Page.startJSCoverage", { title: "Start JS coverage", group: "configuration" }],
    ["Page.stopJSCoverage", { title: "Stop JS coverage", group: "configuration" }],
    ["Page.startCSSCoverage", { title: "Start CSS coverage", group: "configuration" }],
    ["Page.stopCSSCoverage", { title: "Stop CSS coverage", group: "configuration" }],
    ["Page.bringToFront", { title: "Bring to front" }],
    ["Page.pickLocator", { title: "Pick locator", group: "configuration" }],
    ["Page.cancelPickLocator", { title: "Cancel pick locator", group: "configuration" }],
    ["Page.hideHighlight", { title: "Hide all element highlights", group: "configuration" }],
    ["Page.screencastShowOverlay", { title: "Show overlay", group: "configuration" }],
    ["Page.screencastRemoveOverlay", { title: "Remove overlay", group: "configuration" }],
    ["Page.screencastChapter", { title: "Show chapter overlay", group: "configuration" }],
    ["Page.screencastSetOverlayVisible", { title: "Set overlay visibility", group: "configuration" }],
    ["Page.screencastShowActions", { title: "Show actions", group: "configuration" }],
    ["Page.screencastHideActions", { title: "Remove actions", group: "configuration" }],
    ["Page.screencastStart", { title: "Start screencast", group: "configuration" }],
    ["Page.screencastStop", { title: "Stop screencast", group: "configuration" }],
    ["Page.updateSubscription", { internal: true }],
    ["Page.setDockTile", { internal: true }],
    ["Page.webStorageItems", { title: "Get WebStorage items", group: "getter" }],
    ["Page.webStorageGetItem", { title: "Get WebStorage item", group: "getter" }],
    ["Page.webStorageSetItem", { title: "Set WebStorage item", group: "configuration" }],
    ["Page.webStorageRemoveItem", { title: "Remove WebStorage item", group: "configuration" }],
    ["Page.webStorageClear", { title: "Clear WebStorage", group: "configuration" }],
    ["Root.initialize", { internal: true }],
    ["Playwright.newRequest", { title: "Create request context" }],
    ["DebugController.initialize", { internal: true }],
    ["DebugController.setReportStateChanged", { internal: true }],
    ["DebugController.setRecorderMode", { internal: true }],
    ["DebugController.highlight", { internal: true }],
    ["DebugController.hideHighlight", { internal: true }],
    ["DebugController.resume", { internal: true }],
    ["DebugController.kill", { internal: true }],
    ["SocksSupport.socksConnected", { internal: true }],
    ["SocksSupport.socksFailed", { internal: true }],
    ["SocksSupport.socksData", { internal: true }],
    ["SocksSupport.socksError", { internal: true }],
    ["SocksSupport.socksEnd", { internal: true }],
    ["JsonPipe.send", { internal: true }],
    ["JsonPipe.close", { internal: true }],
    ["CDPSession.send", { title: "Send CDP command", group: "configuration" }],
    ["CDPSession.detach", { title: "Detach CDP session", potentiallyClosesScope: true, group: "configuration" }],
    ["BindingCall.reject", { internal: true }],
    ["BindingCall.resolve", { internal: true }],
    ["Debugger.requestPause", { title: "Pause on next call", group: "configuration" }],
    ["Debugger.resume", { title: "Resume", group: "configuration" }],
    ["Debugger.next", { title: "Step to next call", group: "configuration" }],
    ["Debugger.runTo", { title: "Run to location", group: "configuration" }],
    ["Dialog.accept", { title: "Accept dialog" }],
    ["Dialog.dismiss", { title: "Dismiss dialog" }],
    ["Tracing.tracingStart", { title: "Start tracing", group: "configuration" }],
    ["Tracing.tracingStartChunk", { title: "Start tracing", group: "configuration" }],
    ["Tracing.tracingGroup", { title: 'Trace "{name}"' }],
    ["Tracing.tracingGroupEnd", { title: "Group end" }],
    ["Tracing.tracingStopChunk", { title: "Stop tracing", group: "configuration" }],
    ["Tracing.tracingStop", { title: "Stop tracing", group: "configuration" }],
    ["Tracing.harStart", { internal: true }],
    ["Tracing.harExport", { internal: true }],
    ["Worker.disconnect", { title: "Disconnect from worker", potentiallyClosesScope: true }],
    ["Worker.evaluateExpression", { title: "Evaluate" }],
    ["Worker.evaluateExpressionHandle", { title: "Evaluate" }],
    ["Worker.updateSubscription", { internal: true }]
  ]);
  function getMetainfo(metadata) {
    return methodMetainfo.get(metadata.type + "." + metadata.method);
  }

  // src/browser/run/playwright-client/vendor/isomorphic/colors.ts
  var webColors = {
    enabled: true,
    reset: (text) => applyStyle(0, 0, text),
    bold: (text) => applyStyle(1, 22, text),
    dim: (text) => applyStyle(2, 22, text),
    italic: (text) => applyStyle(3, 23, text),
    underline: (text) => applyStyle(4, 24, text),
    inverse: (text) => applyStyle(7, 27, text),
    hidden: (text) => applyStyle(8, 28, text),
    strikethrough: (text) => applyStyle(9, 29, text),
    black: (text) => applyStyle(30, 39, text),
    red: (text) => applyStyle(31, 39, text),
    green: (text) => applyStyle(32, 39, text),
    yellow: (text) => applyStyle(33, 39, text),
    blue: (text) => applyStyle(34, 39, text),
    magenta: (text) => applyStyle(35, 39, text),
    cyan: (text) => applyStyle(36, 39, text),
    white: (text) => applyStyle(37, 39, text),
    gray: (text) => applyStyle(90, 39, text),
    grey: (text) => applyStyle(90, 39, text)
  };
  var applyStyle = (open, close, text) => `\x1B[${open}m${text}\x1B[${close}m`;

  // src/browser/run/playwright-client/quickjs-platform.ts
  var sandbox = globalThis;
  var noopZone = {
    push: () => noopZone,
    pop: () => noopZone,
    run: (callback) => callback(),
    data: () => void 0
  };
  function injected(name) {
    const value = sandbox[name];
    if (typeof value !== "function") throw new Error(`${String(name)} is unavailable in the QuickJS sandbox`);
    return value;
  }
  var quickjsEncoding = {
    encodeBase64: (bytes) => injected("__webcmdEncodeBase64")(bytes),
    decodeBase64: (value) => injected("__webcmdDecodeBase64")(value),
    encodeText: (value) => injected("__webcmdEncodeText")(value),
    decodeText: (bytes) => injected("__webcmdDecodeText")(bytes)
  };
  var sendTransport = (message) => injected("__webcmdTransportSend")(message);
  var sandboxFs = {
    promises: {
      mkdir: async () => void 0,
      writeFile: async (path, bytes) => injected("__webcmdWriteArtifact")(path, bytes)
    }
  };
  var sandboxPath = {
    dirname: () => "",
    isAbsolute: (path) => path.startsWith("/"),
    resolve: (...paths) => paths.join("/")
  };
  var quickjsPlatform = {
    name: "empty",
    boxedStackPrefixes: () => [],
    calculateSha1: async (text) => {
      let hash = 2166136261;
      for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
      return (hash >>> 0).toString(16).padStart(8, "0");
    },
    colors: webColors,
    createGuid: () => "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (token) => {
      const value = Math.floor(Math.random() * 16);
      return (token === "x" ? value : value & 3 | 8).toString(16);
    }),
    defaultMaxListeners: () => 10,
    env: {},
    fs: () => sandboxFs,
    inspectCustom: void 0,
    isDebugMode: () => false,
    isJSDebuggerAttached: () => false,
    isLogEnabled: () => false,
    isUnderTest: () => false,
    log: () => void 0,
    path: () => sandboxPath,
    pathSeparator: "/",
    showInternalStackFrames: () => false,
    streamFile: async () => {
      throw new Error("Streams are unavailable in the QuickJS sandbox");
    },
    streamReadable: () => {
      throw new Error("Streams are unavailable in the QuickJS sandbox");
    },
    streamWritable: () => {
      throw new Error("Streams are unavailable in the QuickJS sandbox");
    },
    zones: { empty: noopZone, current: () => noopZone }
  };

  // src/browser/run/playwright-client/vendor/protocol/validatorPrimitives.ts
  var ValidationError = class extends Error {
  };
  var scheme = {};
  function findValidator(type, method, kind) {
    const validator = maybeFindValidator(type, method, kind);
    if (!validator)
      throw new ValidationError(`Unknown scheme for ${kind}: ${type}.${method}`);
    return validator;
  }
  function maybeFindValidator(type, method, kind) {
    const schemeName = type + (kind === "Initializer" ? "" : method[0].toUpperCase() + method.substring(1)) + kind;
    return scheme[schemeName];
  }
  var tFloat = (arg, path, context) => {
    if (arg instanceof Number)
      return arg.valueOf();
    if (typeof arg === "number")
      return arg;
    throw new ValidationError(`${path}: expected float, got ${typeof arg}`);
  };
  var tInt = (arg, path, context) => {
    let value;
    if (arg instanceof Number)
      value = arg.valueOf();
    else if (typeof arg === "number")
      value = arg;
    else
      throw new ValidationError(`${path}: expected integer, got ${typeof arg}`);
    if (!Number.isInteger(value))
      throw new ValidationError(`${path}: expected integer, got float ${value}`);
    return value;
  };
  var tBoolean = (arg, path, context) => {
    if (arg instanceof Boolean)
      return arg.valueOf();
    if (typeof arg === "boolean")
      return arg;
    throw new ValidationError(`${path}: expected boolean, got ${typeof arg}`);
  };
  var tString = (arg, path, context) => {
    if (arg instanceof String)
      return arg.valueOf();
    if (typeof arg === "string")
      return arg;
    throw new ValidationError(`${path}: expected string, got ${typeof arg}`);
  };
  var tBinary = (arg, path, context) => {
    if (context.binary === "fromBase64") {
      if (arg instanceof String)
        return quickjsEncoding.decodeBase64(arg.valueOf());
      if (typeof arg === "string")
        return quickjsEncoding.decodeBase64(arg);
      throw new ValidationError(`${path}: expected base64-encoded buffer, got ${typeof arg}`);
    }
    if (context.binary === "toBase64") {
      if (!(arg instanceof Uint8Array))
        throw new ValidationError(`${path}: expected Uint8Array, got ${typeof arg}`);
      return quickjsEncoding.encodeBase64(arg);
    }
    if (context.binary === "buffer") {
      if (!(arg instanceof Uint8Array) && !(arg instanceof Object))
        throw new ValidationError(`${path}: expected Uint8Array, got ${typeof arg}`);
      return arg;
    }
    throw new ValidationError(`Unsupported binary behavior "${context.binary}"`);
  };
  var tAny = (arg, path, context) => {
    return arg;
  };
  var tOptional = (v) => {
    return (arg, path, context) => {
      if (Object.is(arg, void 0))
        return arg;
      return v(arg, path, context);
    };
  };
  var tArray = (v) => {
    return (arg, path, context) => {
      if (!Array.isArray(arg))
        throw new ValidationError(`${path}: expected array, got ${typeof arg}`);
      return arg.map((x, index) => v(x, path + "[" + index + "]", context));
    };
  };
  var tObject = (s) => {
    return (arg, path, context) => {
      if (Object.is(arg, null))
        throw new ValidationError(`${path}: expected object, got null`);
      if (typeof arg !== "object")
        throw new ValidationError(`${path}: expected object, got ${typeof arg}`);
      const result = {};
      for (const [key, v] of Object.entries(s)) {
        const value = v(arg[key], path ? path + "." + key : key, context);
        if (!Object.is(value, void 0))
          result[key] = value;
      }
      if (context.isUnderTest()) {
        for (const [key, value] of Object.entries(arg)) {
          if (key.startsWith("__testHook"))
            result[key] = value;
        }
      }
      return result;
    };
  };
  var tEnum = (e) => {
    return (arg, path, context) => {
      if (!e.includes(arg))
        throw new ValidationError(`${path}: expected one of (${e.join("|")})`);
      return arg;
    };
  };
  var tChannel = (names) => {
    return (arg, path, context) => {
      return context.tChannelImpl(names, arg, path, context);
    };
  };
  var tType = (name) => {
    return (arg, path, context) => {
      const v = scheme[name];
      if (!v)
        throw new ValidationError(path + ': unknown type "' + name + '"');
      return v(arg, path, context);
    };
  };

  // src/browser/run/playwright-client/vendor/protocol/validator.ts
  scheme.AndroidInitializer = tOptional(tObject({}));
  scheme.AndroidDevicesParams = tObject({
    host: tOptional(tString),
    port: tOptional(tInt),
    omitDriverInstall: tOptional(tBoolean)
  });
  scheme.AndroidDevicesResult = tObject({
    devices: tArray(tChannel(["AndroidDevice"]))
  });
  scheme.AndroidSocketInitializer = tOptional(tObject({}));
  scheme.AndroidSocketDataEvent = tObject({
    data: tBinary
  });
  scheme.AndroidSocketCloseEvent = tOptional(tObject({}));
  scheme.AndroidSocketWriteParams = tObject({
    data: tBinary
  });
  scheme.AndroidSocketWriteResult = tOptional(tObject({}));
  scheme.AndroidSocketCloseParams = tOptional(tObject({}));
  scheme.AndroidSocketCloseResult = tOptional(tObject({}));
  scheme.AndroidDeviceInitializer = tObject({
    model: tString,
    serial: tString
  });
  scheme.AndroidDeviceCloseEvent = tOptional(tObject({}));
  scheme.AndroidDeviceWebViewAddedEvent = tObject({
    webView: tType("AndroidWebView")
  });
  scheme.AndroidDeviceWebViewRemovedEvent = tObject({
    socketName: tString
  });
  scheme.AndroidDeviceWaitParams = tObject({
    androidSelector: tType("AndroidSelector"),
    state: tOptional(tEnum(["gone"])),
    timeout: tFloat
  });
  scheme.AndroidDeviceWaitResult = tOptional(tObject({}));
  scheme.AndroidDeviceFillParams = tObject({
    androidSelector: tType("AndroidSelector"),
    text: tString,
    timeout: tFloat
  });
  scheme.AndroidDeviceFillResult = tOptional(tObject({}));
  scheme.AndroidDeviceTapParams = tObject({
    androidSelector: tType("AndroidSelector"),
    duration: tOptional(tFloat),
    timeout: tFloat
  });
  scheme.AndroidDeviceTapResult = tOptional(tObject({}));
  scheme.AndroidDeviceDragParams = tObject({
    androidSelector: tType("AndroidSelector"),
    dest: tType("Point"),
    speed: tOptional(tFloat),
    timeout: tFloat
  });
  scheme.AndroidDeviceDragResult = tOptional(tObject({}));
  scheme.AndroidDeviceFlingParams = tObject({
    androidSelector: tType("AndroidSelector"),
    direction: tEnum(["up", "down", "left", "right"]),
    speed: tOptional(tFloat),
    timeout: tFloat
  });
  scheme.AndroidDeviceFlingResult = tOptional(tObject({}));
  scheme.AndroidDeviceLongTapParams = tObject({
    androidSelector: tType("AndroidSelector"),
    timeout: tFloat
  });
  scheme.AndroidDeviceLongTapResult = tOptional(tObject({}));
  scheme.AndroidDevicePinchCloseParams = tObject({
    androidSelector: tType("AndroidSelector"),
    percent: tFloat,
    speed: tOptional(tFloat),
    timeout: tFloat
  });
  scheme.AndroidDevicePinchCloseResult = tOptional(tObject({}));
  scheme.AndroidDevicePinchOpenParams = tObject({
    androidSelector: tType("AndroidSelector"),
    percent: tFloat,
    speed: tOptional(tFloat),
    timeout: tFloat
  });
  scheme.AndroidDevicePinchOpenResult = tOptional(tObject({}));
  scheme.AndroidDeviceScrollParams = tObject({
    androidSelector: tType("AndroidSelector"),
    direction: tEnum(["up", "down", "left", "right"]),
    percent: tFloat,
    speed: tOptional(tFloat),
    timeout: tFloat
  });
  scheme.AndroidDeviceScrollResult = tOptional(tObject({}));
  scheme.AndroidDeviceSwipeParams = tObject({
    androidSelector: tType("AndroidSelector"),
    direction: tEnum(["up", "down", "left", "right"]),
    percent: tFloat,
    speed: tOptional(tFloat),
    timeout: tFloat
  });
  scheme.AndroidDeviceSwipeResult = tOptional(tObject({}));
  scheme.AndroidDeviceInfoParams = tObject({
    androidSelector: tType("AndroidSelector")
  });
  scheme.AndroidDeviceInfoResult = tObject({
    info: tType("AndroidElementInfo")
  });
  scheme.AndroidDeviceScreenshotParams = tOptional(tObject({}));
  scheme.AndroidDeviceScreenshotResult = tObject({
    binary: tBinary
  });
  scheme.AndroidDeviceInputTypeParams = tObject({
    text: tString
  });
  scheme.AndroidDeviceInputTypeResult = tOptional(tObject({}));
  scheme.AndroidDeviceInputPressParams = tObject({
    key: tString
  });
  scheme.AndroidDeviceInputPressResult = tOptional(tObject({}));
  scheme.AndroidDeviceInputTapParams = tObject({
    point: tType("Point")
  });
  scheme.AndroidDeviceInputTapResult = tOptional(tObject({}));
  scheme.AndroidDeviceInputSwipeParams = tObject({
    segments: tArray(tType("Point")),
    steps: tInt
  });
  scheme.AndroidDeviceInputSwipeResult = tOptional(tObject({}));
  scheme.AndroidDeviceInputDragParams = tObject({
    from: tType("Point"),
    to: tType("Point"),
    steps: tInt
  });
  scheme.AndroidDeviceInputDragResult = tOptional(tObject({}));
  scheme.AndroidDeviceLaunchBrowserParams = tObject({
    noDefaultViewport: tOptional(tBoolean),
    viewport: tOptional(tObject({
      width: tInt,
      height: tInt
    })),
    screen: tOptional(tObject({
      width: tInt,
      height: tInt
    })),
    ignoreHTTPSErrors: tOptional(tBoolean),
    clientCertificates: tOptional(tArray(tObject({
      origin: tString,
      cert: tOptional(tBinary),
      key: tOptional(tBinary),
      passphrase: tOptional(tString),
      pfx: tOptional(tBinary)
    }))),
    javaScriptEnabled: tOptional(tBoolean),
    bypassCSP: tOptional(tBoolean),
    userAgent: tOptional(tString),
    locale: tOptional(tString),
    timezoneId: tOptional(tString),
    geolocation: tOptional(tObject({
      longitude: tFloat,
      latitude: tFloat,
      accuracy: tOptional(tFloat)
    })),
    permissions: tOptional(tArray(tString)),
    extraHTTPHeaders: tOptional(tArray(tType("NameValue"))),
    offline: tOptional(tBoolean),
    httpCredentials: tOptional(tObject({
      username: tString,
      password: tString,
      origin: tOptional(tString),
      send: tOptional(tEnum(["always", "unauthorized"]))
    })),
    deviceScaleFactor: tOptional(tFloat),
    isMobile: tOptional(tBoolean),
    hasTouch: tOptional(tBoolean),
    colorScheme: tOptional(tEnum(["dark", "light", "no-preference", "no-override"])),
    reducedMotion: tOptional(tEnum(["reduce", "no-preference", "no-override"])),
    forcedColors: tOptional(tEnum(["active", "none", "no-override"])),
    acceptDownloads: tOptional(tEnum(["accept", "deny", "internal-browser-default"])),
    contrast: tOptional(tEnum(["no-preference", "more", "no-override"])),
    baseURL: tOptional(tString),
    recordVideo: tOptional(tObject({
      dir: tOptional(tString),
      size: tOptional(tObject({
        width: tInt,
        height: tInt
      })),
      showActions: tOptional(tObject({
        duration: tOptional(tFloat),
        position: tOptional(tEnum(["top-left", "top", "top-right", "bottom-left", "bottom", "bottom-right"])),
        fontSize: tOptional(tInt),
        cursor: tOptional(tEnum(["none", "pointer"]))
      }))
    })),
    strictSelectors: tOptional(tBoolean),
    serviceWorkers: tOptional(tEnum(["allow", "block"])),
    selectorEngines: tOptional(tArray(tType("SelectorEngine"))),
    testIdAttributeName: tOptional(tString),
    pkg: tOptional(tString),
    args: tOptional(tArray(tString)),
    proxy: tOptional(tObject({
      server: tString,
      bypass: tOptional(tString),
      username: tOptional(tString),
      password: tOptional(tString)
    }))
  });
  scheme.AndroidDeviceLaunchBrowserResult = tObject({
    context: tChannel(["BrowserContext"])
  });
  scheme.AndroidDeviceOpenParams = tObject({
    command: tString
  });
  scheme.AndroidDeviceOpenResult = tObject({
    socket: tChannel(["AndroidSocket"])
  });
  scheme.AndroidDeviceShellParams = tObject({
    command: tString
  });
  scheme.AndroidDeviceShellResult = tObject({
    result: tBinary
  });
  scheme.AndroidDeviceInstallApkParams = tObject({
    file: tBinary,
    args: tOptional(tArray(tString))
  });
  scheme.AndroidDeviceInstallApkResult = tOptional(tObject({}));
  scheme.AndroidDevicePushParams = tObject({
    file: tBinary,
    path: tString,
    mode: tOptional(tInt)
  });
  scheme.AndroidDevicePushResult = tOptional(tObject({}));
  scheme.AndroidDeviceConnectToWebViewParams = tObject({
    socketName: tString
  });
  scheme.AndroidDeviceConnectToWebViewResult = tObject({
    context: tChannel(["BrowserContext"])
  });
  scheme.AndroidDeviceCloseParams = tOptional(tObject({}));
  scheme.AndroidDeviceCloseResult = tOptional(tObject({}));
  scheme.AndroidWebView = tObject({
    pid: tInt,
    pkg: tString,
    socketName: tString
  });
  scheme.AndroidSelector = tObject({
    checkable: tOptional(tBoolean),
    checked: tOptional(tBoolean),
    clazz: tOptional(tString),
    clickable: tOptional(tBoolean),
    depth: tOptional(tInt),
    desc: tOptional(tString),
    enabled: tOptional(tBoolean),
    focusable: tOptional(tBoolean),
    focused: tOptional(tBoolean),
    hasChild: tOptional(tObject({
      androidSelector: tType("AndroidSelector")
    })),
    hasDescendant: tOptional(tObject({
      androidSelector: tType("AndroidSelector"),
      maxDepth: tOptional(tInt)
    })),
    longClickable: tOptional(tBoolean),
    pkg: tOptional(tString),
    res: tOptional(tString),
    scrollable: tOptional(tBoolean),
    selected: tOptional(tBoolean),
    text: tOptional(tString)
  });
  scheme.AndroidElementInfo = tObject({
    children: tOptional(tArray(tType("AndroidElementInfo"))),
    clazz: tString,
    desc: tString,
    res: tString,
    pkg: tString,
    text: tString,
    bounds: tType("Rect"),
    checkable: tBoolean,
    checked: tBoolean,
    clickable: tBoolean,
    enabled: tBoolean,
    focusable: tBoolean,
    focused: tBoolean,
    longClickable: tBoolean,
    scrollable: tBoolean,
    selected: tBoolean
  });
  scheme.APIRequestContextInitializer = tObject({
    tracing: tChannel(["Tracing"])
  });
  scheme.APIRequestContextFetchParams = tObject({
    url: tString,
    encodedParams: tOptional(tString),
    params: tOptional(tArray(tType("NameValue"))),
    method: tOptional(tString),
    headers: tOptional(tArray(tType("NameValue"))),
    postData: tOptional(tBinary),
    jsonData: tOptional(tString),
    formData: tOptional(tArray(tType("NameValue"))),
    multipartData: tOptional(tArray(tType("FormField"))),
    timeout: tFloat,
    failOnStatusCode: tOptional(tBoolean),
    ignoreHTTPSErrors: tOptional(tBoolean),
    maxRedirects: tOptional(tInt),
    maxRetries: tOptional(tInt)
  });
  scheme.APIRequestContextFetchResult = tObject({
    response: tType("APIResponse")
  });
  scheme.APIRequestContextFetchResponseBodyParams = tObject({
    fetchUid: tString
  });
  scheme.APIRequestContextFetchResponseBodyResult = tObject({
    binary: tOptional(tBinary)
  });
  scheme.APIRequestContextFetchLogParams = tObject({
    fetchUid: tString
  });
  scheme.APIRequestContextFetchLogResult = tObject({
    log: tArray(tString)
  });
  scheme.APIRequestContextStorageStateParams = tObject({
    indexedDB: tOptional(tBoolean)
  });
  scheme.APIRequestContextStorageStateResult = tObject({
    cookies: tArray(tType("NetworkCookie")),
    origins: tArray(tType("OriginStorage"))
  });
  scheme.APIRequestContextDisposeAPIResponseParams = tObject({
    fetchUid: tString
  });
  scheme.APIRequestContextDisposeAPIResponseResult = tOptional(tObject({}));
  scheme.APIRequestContextDisposeParams = tObject({
    reason: tOptional(tString)
  });
  scheme.APIRequestContextDisposeResult = tOptional(tObject({}));
  scheme.APIResponse = tObject({
    fetchUid: tString,
    url: tString,
    status: tInt,
    statusText: tString,
    headers: tArray(tType("NameValue")),
    securityDetails: tOptional(tType("SecurityDetails")),
    serverAddr: tOptional(tType("RemoteAddr"))
  });
  scheme.ArtifactInitializer = tObject({
    absolutePath: tString
  });
  scheme.ArtifactPathAfterFinishedParams = tOptional(tObject({}));
  scheme.ArtifactPathAfterFinishedResult = tObject({
    value: tString
  });
  scheme.ArtifactSaveAsParams = tObject({
    path: tString
  });
  scheme.ArtifactSaveAsResult = tOptional(tObject({}));
  scheme.ArtifactSaveAsStreamParams = tOptional(tObject({}));
  scheme.ArtifactSaveAsStreamResult = tObject({
    stream: tChannel(["Stream"])
  });
  scheme.ArtifactFailureParams = tOptional(tObject({}));
  scheme.ArtifactFailureResult = tObject({
    error: tOptional(tString)
  });
  scheme.ArtifactStreamParams = tOptional(tObject({}));
  scheme.ArtifactStreamResult = tObject({
    stream: tChannel(["Stream"])
  });
  scheme.ArtifactCancelParams = tOptional(tObject({}));
  scheme.ArtifactCancelResult = tOptional(tObject({}));
  scheme.ArtifactDeleteParams = tOptional(tObject({}));
  scheme.ArtifactDeleteResult = tOptional(tObject({}));
  scheme.StreamInitializer = tOptional(tObject({}));
  scheme.StreamReadParams = tObject({
    size: tOptional(tInt)
  });
  scheme.StreamReadResult = tObject({
    binary: tBinary
  });
  scheme.StreamCloseParams = tOptional(tObject({}));
  scheme.StreamCloseResult = tOptional(tObject({}));
  scheme.WritableStreamInitializer = tOptional(tObject({}));
  scheme.WritableStreamWriteParams = tObject({
    binary: tBinary
  });
  scheme.WritableStreamWriteResult = tOptional(tObject({}));
  scheme.WritableStreamCloseParams = tOptional(tObject({}));
  scheme.WritableStreamCloseResult = tOptional(tObject({}));
  scheme.BrowserInitializer = tObject({
    version: tString,
    name: tString,
    browserName: tEnum(["chromium", "firefox", "webkit"])
  });
  scheme.BrowserContextEvent = tObject({
    context: tChannel(["BrowserContext"])
  });
  scheme.BrowserCloseEvent = tOptional(tObject({}));
  scheme.BrowserStartServerParams = tObject({
    title: tString,
    workspaceDir: tOptional(tString),
    metadata: tOptional(tAny),
    host: tOptional(tString),
    port: tOptional(tInt)
  });
  scheme.BrowserStartServerResult = tObject({
    endpoint: tString
  });
  scheme.BrowserStopServerParams = tOptional(tObject({}));
  scheme.BrowserStopServerResult = tOptional(tObject({}));
  scheme.BrowserCloseParams = tObject({
    reason: tOptional(tString)
  });
  scheme.BrowserCloseResult = tOptional(tObject({}));
  scheme.BrowserKillForTestsParams = tOptional(tObject({}));
  scheme.BrowserKillForTestsResult = tOptional(tObject({}));
  scheme.BrowserDefaultUserAgentForTestParams = tOptional(tObject({}));
  scheme.BrowserDefaultUserAgentForTestResult = tObject({
    userAgent: tString
  });
  scheme.BrowserNewContextParams = tObject({
    noDefaultViewport: tOptional(tBoolean),
    viewport: tOptional(tObject({
      width: tInt,
      height: tInt
    })),
    screen: tOptional(tObject({
      width: tInt,
      height: tInt
    })),
    ignoreHTTPSErrors: tOptional(tBoolean),
    clientCertificates: tOptional(tArray(tObject({
      origin: tString,
      cert: tOptional(tBinary),
      key: tOptional(tBinary),
      passphrase: tOptional(tString),
      pfx: tOptional(tBinary)
    }))),
    javaScriptEnabled: tOptional(tBoolean),
    bypassCSP: tOptional(tBoolean),
    userAgent: tOptional(tString),
    locale: tOptional(tString),
    timezoneId: tOptional(tString),
    geolocation: tOptional(tObject({
      longitude: tFloat,
      latitude: tFloat,
      accuracy: tOptional(tFloat)
    })),
    permissions: tOptional(tArray(tString)),
    extraHTTPHeaders: tOptional(tArray(tType("NameValue"))),
    offline: tOptional(tBoolean),
    httpCredentials: tOptional(tObject({
      username: tString,
      password: tString,
      origin: tOptional(tString),
      send: tOptional(tEnum(["always", "unauthorized"]))
    })),
    deviceScaleFactor: tOptional(tFloat),
    isMobile: tOptional(tBoolean),
    hasTouch: tOptional(tBoolean),
    colorScheme: tOptional(tEnum(["dark", "light", "no-preference", "no-override"])),
    reducedMotion: tOptional(tEnum(["reduce", "no-preference", "no-override"])),
    forcedColors: tOptional(tEnum(["active", "none", "no-override"])),
    acceptDownloads: tOptional(tEnum(["accept", "deny", "internal-browser-default"])),
    contrast: tOptional(tEnum(["no-preference", "more", "no-override"])),
    baseURL: tOptional(tString),
    recordVideo: tOptional(tObject({
      dir: tOptional(tString),
      size: tOptional(tObject({
        width: tInt,
        height: tInt
      })),
      showActions: tOptional(tObject({
        duration: tOptional(tFloat),
        position: tOptional(tEnum(["top-left", "top", "top-right", "bottom-left", "bottom", "bottom-right"])),
        fontSize: tOptional(tInt),
        cursor: tOptional(tEnum(["none", "pointer"]))
      }))
    })),
    strictSelectors: tOptional(tBoolean),
    serviceWorkers: tOptional(tEnum(["allow", "block"])),
    selectorEngines: tOptional(tArray(tType("SelectorEngine"))),
    testIdAttributeName: tOptional(tString),
    proxy: tOptional(tObject({
      server: tString,
      bypass: tOptional(tString),
      username: tOptional(tString),
      password: tOptional(tString)
    })),
    storageState: tOptional(tObject({
      cookies: tOptional(tArray(tType("SetNetworkCookie"))),
      origins: tOptional(tArray(tType("SetOriginStorage")))
    }))
  });
  scheme.BrowserNewContextResult = tObject({
    context: tChannel(["BrowserContext"])
  });
  scheme.BrowserNewContextForReuseParams = tObject({
    noDefaultViewport: tOptional(tBoolean),
    viewport: tOptional(tObject({
      width: tInt,
      height: tInt
    })),
    screen: tOptional(tObject({
      width: tInt,
      height: tInt
    })),
    ignoreHTTPSErrors: tOptional(tBoolean),
    clientCertificates: tOptional(tArray(tObject({
      origin: tString,
      cert: tOptional(tBinary),
      key: tOptional(tBinary),
      passphrase: tOptional(tString),
      pfx: tOptional(tBinary)
    }))),
    javaScriptEnabled: tOptional(tBoolean),
    bypassCSP: tOptional(tBoolean),
    userAgent: tOptional(tString),
    locale: tOptional(tString),
    timezoneId: tOptional(tString),
    geolocation: tOptional(tObject({
      longitude: tFloat,
      latitude: tFloat,
      accuracy: tOptional(tFloat)
    })),
    permissions: tOptional(tArray(tString)),
    extraHTTPHeaders: tOptional(tArray(tType("NameValue"))),
    offline: tOptional(tBoolean),
    httpCredentials: tOptional(tObject({
      username: tString,
      password: tString,
      origin: tOptional(tString),
      send: tOptional(tEnum(["always", "unauthorized"]))
    })),
    deviceScaleFactor: tOptional(tFloat),
    isMobile: tOptional(tBoolean),
    hasTouch: tOptional(tBoolean),
    colorScheme: tOptional(tEnum(["dark", "light", "no-preference", "no-override"])),
    reducedMotion: tOptional(tEnum(["reduce", "no-preference", "no-override"])),
    forcedColors: tOptional(tEnum(["active", "none", "no-override"])),
    acceptDownloads: tOptional(tEnum(["accept", "deny", "internal-browser-default"])),
    contrast: tOptional(tEnum(["no-preference", "more", "no-override"])),
    baseURL: tOptional(tString),
    recordVideo: tOptional(tObject({
      dir: tOptional(tString),
      size: tOptional(tObject({
        width: tInt,
        height: tInt
      })),
      showActions: tOptional(tObject({
        duration: tOptional(tFloat),
        position: tOptional(tEnum(["top-left", "top", "top-right", "bottom-left", "bottom", "bottom-right"])),
        fontSize: tOptional(tInt),
        cursor: tOptional(tEnum(["none", "pointer"]))
      }))
    })),
    strictSelectors: tOptional(tBoolean),
    serviceWorkers: tOptional(tEnum(["allow", "block"])),
    selectorEngines: tOptional(tArray(tType("SelectorEngine"))),
    testIdAttributeName: tOptional(tString),
    proxy: tOptional(tObject({
      server: tString,
      bypass: tOptional(tString),
      username: tOptional(tString),
      password: tOptional(tString)
    })),
    storageState: tOptional(tObject({
      cookies: tOptional(tArray(tType("SetNetworkCookie"))),
      origins: tOptional(tArray(tType("SetOriginStorage")))
    }))
  });
  scheme.BrowserNewContextForReuseResult = tObject({
    context: tChannel(["BrowserContext"])
  });
  scheme.BrowserDisconnectFromReusedContextParams = tObject({
    reason: tString
  });
  scheme.BrowserDisconnectFromReusedContextResult = tOptional(tObject({}));
  scheme.BrowserNewBrowserCDPSessionParams = tOptional(tObject({}));
  scheme.BrowserNewBrowserCDPSessionResult = tObject({
    session: tChannel(["CDPSession"])
  });
  scheme.BrowserStartTracingParams = tObject({
    page: tOptional(tChannel(["Page"])),
    screenshots: tOptional(tBoolean),
    categories: tOptional(tArray(tString))
  });
  scheme.BrowserStartTracingResult = tOptional(tObject({}));
  scheme.BrowserStopTracingParams = tOptional(tObject({}));
  scheme.BrowserStopTracingResult = tObject({
    artifact: tChannel(["Artifact"])
  });
  scheme.BrowserContextInitializer = tObject({
    debugger: tChannel(["Debugger"]),
    requestContext: tChannel(["APIRequestContext"]),
    tracing: tChannel(["Tracing"]),
    options: tObject({
      noDefaultViewport: tOptional(tBoolean),
      viewport: tOptional(tObject({
        width: tInt,
        height: tInt
      })),
      screen: tOptional(tObject({
        width: tInt,
        height: tInt
      })),
      ignoreHTTPSErrors: tOptional(tBoolean),
      clientCertificates: tOptional(tArray(tObject({
        origin: tString,
        cert: tOptional(tBinary),
        key: tOptional(tBinary),
        passphrase: tOptional(tString),
        pfx: tOptional(tBinary)
      }))),
      javaScriptEnabled: tOptional(tBoolean),
      bypassCSP: tOptional(tBoolean),
      userAgent: tOptional(tString),
      locale: tOptional(tString),
      timezoneId: tOptional(tString),
      geolocation: tOptional(tObject({
        longitude: tFloat,
        latitude: tFloat,
        accuracy: tOptional(tFloat)
      })),
      permissions: tOptional(tArray(tString)),
      extraHTTPHeaders: tOptional(tArray(tType("NameValue"))),
      offline: tOptional(tBoolean),
      httpCredentials: tOptional(tObject({
        username: tString,
        password: tString,
        origin: tOptional(tString),
        send: tOptional(tEnum(["always", "unauthorized"]))
      })),
      deviceScaleFactor: tOptional(tFloat),
      isMobile: tOptional(tBoolean),
      hasTouch: tOptional(tBoolean),
      colorScheme: tOptional(tEnum(["dark", "light", "no-preference", "no-override"])),
      reducedMotion: tOptional(tEnum(["reduce", "no-preference", "no-override"])),
      forcedColors: tOptional(tEnum(["active", "none", "no-override"])),
      acceptDownloads: tOptional(tEnum(["accept", "deny", "internal-browser-default"])),
      contrast: tOptional(tEnum(["no-preference", "more", "no-override"])),
      baseURL: tOptional(tString),
      recordVideo: tOptional(tObject({
        dir: tOptional(tString),
        size: tOptional(tObject({
          width: tInt,
          height: tInt
        })),
        showActions: tOptional(tObject({
          duration: tOptional(tFloat),
          position: tOptional(tEnum(["top-left", "top", "top-right", "bottom-left", "bottom", "bottom-right"])),
          fontSize: tOptional(tInt),
          cursor: tOptional(tEnum(["none", "pointer"]))
        }))
      })),
      strictSelectors: tOptional(tBoolean),
      serviceWorkers: tOptional(tEnum(["allow", "block"])),
      selectorEngines: tOptional(tArray(tType("SelectorEngine"))),
      testIdAttributeName: tOptional(tString)
    })
  });
  scheme.BrowserContextBindingCallEvent = tObject({
    binding: tChannel(["BindingCall"])
  });
  scheme.BrowserContextConsoleEvent = tObject({
    type: tString,
    text: tString,
    args: tArray(tChannel(["ElementHandle", "JSHandle"])),
    location: tObject({
      url: tString,
      lineNumber: tInt,
      columnNumber: tInt
    }),
    timestamp: tFloat,
    page: tOptional(tChannel(["Page"])),
    worker: tOptional(tChannel(["Worker"]))
  });
  scheme.BrowserContextCloseEvent = tOptional(tObject({}));
  scheme.BrowserContextDialogEvent = tObject({
    dialog: tChannel(["Dialog"])
  });
  scheme.BrowserContextPageEvent = tObject({
    page: tChannel(["Page"])
  });
  scheme.BrowserContextPageErrorEvent = tObject({
    error: tType("SerializedError"),
    page: tChannel(["Page"]),
    location: tObject({
      url: tString,
      line: tInt,
      column: tInt
    })
  });
  scheme.BrowserContextRouteEvent = tObject({
    route: tChannel(["Route"])
  });
  scheme.BrowserContextWebSocketRouteEvent = tObject({
    webSocketRoute: tChannel(["WebSocketRoute"])
  });
  scheme.BrowserContextServiceWorkerEvent = tObject({
    worker: tChannel(["Worker"])
  });
  scheme.BrowserContextRequestEvent = tObject({
    request: tChannel(["Request"]),
    page: tOptional(tChannel(["Page"]))
  });
  scheme.BrowserContextRequestFailedEvent = tObject({
    request: tChannel(["Request"]),
    failureText: tOptional(tString),
    responseEndTiming: tFloat,
    page: tOptional(tChannel(["Page"]))
  });
  scheme.BrowserContextRequestFinishedEvent = tObject({
    request: tChannel(["Request"]),
    response: tOptional(tChannel(["Response"])),
    responseEndTiming: tFloat,
    page: tOptional(tChannel(["Page"]))
  });
  scheme.BrowserContextResponseEvent = tObject({
    response: tChannel(["Response"]),
    page: tOptional(tChannel(["Page"]))
  });
  scheme.BrowserContextRecorderEventEvent = tObject({
    event: tEnum(["actionAdded", "actionUpdated", "signalAdded"]),
    data: tAny,
    page: tChannel(["Page"]),
    code: tString
  });
  scheme.BrowserContextAddCookiesParams = tObject({
    cookies: tArray(tType("SetNetworkCookie"))
  });
  scheme.BrowserContextAddCookiesResult = tOptional(tObject({}));
  scheme.BrowserContextAddInitScriptParams = tObject({
    source: tString
  });
  scheme.BrowserContextAddInitScriptResult = tObject({
    disposable: tChannel(["Disposable"])
  });
  scheme.BrowserContextClearCookiesParams = tObject({
    name: tOptional(tString),
    nameRegexSource: tOptional(tString),
    nameRegexFlags: tOptional(tString),
    domain: tOptional(tString),
    domainRegexSource: tOptional(tString),
    domainRegexFlags: tOptional(tString),
    path: tOptional(tString),
    pathRegexSource: tOptional(tString),
    pathRegexFlags: tOptional(tString)
  });
  scheme.BrowserContextClearCookiesResult = tOptional(tObject({}));
  scheme.BrowserContextClearPermissionsParams = tOptional(tObject({}));
  scheme.BrowserContextClearPermissionsResult = tOptional(tObject({}));
  scheme.BrowserContextCloseParams = tObject({
    reason: tOptional(tString)
  });
  scheme.BrowserContextCloseResult = tOptional(tObject({}));
  scheme.BrowserContextCookiesParams = tObject({
    urls: tArray(tString)
  });
  scheme.BrowserContextCookiesResult = tObject({
    cookies: tArray(tType("NetworkCookie"))
  });
  scheme.BrowserContextExposeBindingParams = tObject({
    name: tString
  });
  scheme.BrowserContextExposeBindingResult = tObject({
    disposable: tChannel(["Disposable"])
  });
  scheme.BrowserContextGrantPermissionsParams = tObject({
    permissions: tArray(tString),
    origin: tOptional(tString)
  });
  scheme.BrowserContextGrantPermissionsResult = tOptional(tObject({}));
  scheme.BrowserContextNewPageParams = tOptional(tObject({}));
  scheme.BrowserContextNewPageResult = tObject({
    page: tChannel(["Page"])
  });
  scheme.BrowserContextRegisterSelectorEngineParams = tObject({
    selectorEngine: tType("SelectorEngine")
  });
  scheme.BrowserContextRegisterSelectorEngineResult = tOptional(tObject({}));
  scheme.BrowserContextSetTestIdAttributeNameParams = tObject({
    testIdAttributeName: tString
  });
  scheme.BrowserContextSetTestIdAttributeNameResult = tOptional(tObject({}));
  scheme.BrowserContextSetExtraHTTPHeadersParams = tObject({
    headers: tArray(tType("NameValue"))
  });
  scheme.BrowserContextSetExtraHTTPHeadersResult = tOptional(tObject({}));
  scheme.BrowserContextSetGeolocationParams = tObject({
    geolocation: tOptional(tObject({
      longitude: tFloat,
      latitude: tFloat,
      accuracy: tOptional(tFloat)
    }))
  });
  scheme.BrowserContextSetGeolocationResult = tOptional(tObject({}));
  scheme.BrowserContextSetHTTPCredentialsParams = tObject({
    httpCredentials: tOptional(tObject({
      username: tString,
      password: tString,
      origin: tOptional(tString)
    }))
  });
  scheme.BrowserContextSetHTTPCredentialsResult = tOptional(tObject({}));
  scheme.BrowserContextSetNetworkInterceptionPatternsParams = tObject({
    patterns: tArray(tObject({
      glob: tOptional(tString),
      regexSource: tOptional(tString),
      regexFlags: tOptional(tString),
      urlPattern: tOptional(tType("URLPattern"))
    }))
  });
  scheme.BrowserContextSetNetworkInterceptionPatternsResult = tOptional(tObject({}));
  scheme.BrowserContextSetWebSocketInterceptionPatternsParams = tObject({
    patterns: tArray(tObject({
      glob: tOptional(tString),
      regexSource: tOptional(tString),
      regexFlags: tOptional(tString),
      urlPattern: tOptional(tType("URLPattern"))
    }))
  });
  scheme.BrowserContextSetWebSocketInterceptionPatternsResult = tOptional(tObject({}));
  scheme.BrowserContextSetOfflineParams = tObject({
    offline: tBoolean
  });
  scheme.BrowserContextSetOfflineResult = tOptional(tObject({}));
  scheme.BrowserContextStorageStateParams = tObject({
    indexedDB: tOptional(tBoolean)
  });
  scheme.BrowserContextStorageStateResult = tObject({
    cookies: tArray(tType("NetworkCookie")),
    origins: tArray(tType("OriginStorage"))
  });
  scheme.BrowserContextSetStorageStateParams = tObject({
    storageState: tOptional(tObject({
      cookies: tOptional(tArray(tType("SetNetworkCookie"))),
      origins: tOptional(tArray(tType("SetOriginStorage")))
    }))
  });
  scheme.BrowserContextSetStorageStateResult = tOptional(tObject({}));
  scheme.BrowserContextPauseParams = tOptional(tObject({}));
  scheme.BrowserContextPauseResult = tOptional(tObject({}));
  scheme.BrowserContextEnableRecorderParams = tObject({
    language: tOptional(tString),
    mode: tOptional(tEnum(["inspecting", "recording"])),
    recorderMode: tOptional(tEnum(["default", "api"])),
    pauseOnNextStatement: tOptional(tBoolean),
    testIdAttributeName: tOptional(tString),
    launchOptions: tOptional(tAny),
    contextOptions: tOptional(tAny),
    device: tOptional(tString),
    saveStorage: tOptional(tString),
    outputFile: tOptional(tString),
    handleSIGINT: tOptional(tBoolean),
    omitCallTracking: tOptional(tBoolean)
  });
  scheme.BrowserContextEnableRecorderResult = tOptional(tObject({}));
  scheme.BrowserContextDisableRecorderParams = tOptional(tObject({}));
  scheme.BrowserContextDisableRecorderResult = tOptional(tObject({}));
  scheme.BrowserContextExposeConsoleApiParams = tOptional(tObject({}));
  scheme.BrowserContextExposeConsoleApiResult = tOptional(tObject({}));
  scheme.BrowserContextNewCDPSessionParams = tObject({
    page: tOptional(tChannel(["Page"])),
    frame: tOptional(tChannel(["Frame"]))
  });
  scheme.BrowserContextNewCDPSessionResult = tObject({
    session: tChannel(["CDPSession"])
  });
  scheme.BrowserContextCreateTempFilesParams = tObject({
    rootDirName: tOptional(tString),
    items: tArray(tObject({
      name: tString,
      lastModifiedMs: tOptional(tFloat)
    }))
  });
  scheme.BrowserContextCreateTempFilesResult = tObject({
    rootDir: tOptional(tChannel(["WritableStream"])),
    writableStreams: tArray(tChannel(["WritableStream"]))
  });
  scheme.BrowserContextUpdateSubscriptionParams = tObject({
    event: tEnum(["console", "dialog", "request", "response", "requestFinished", "requestFailed"]),
    enabled: tBoolean
  });
  scheme.BrowserContextUpdateSubscriptionResult = tOptional(tObject({}));
  scheme.BrowserContextClockFastForwardParams = tObject({
    ticksNumber: tOptional(tFloat),
    ticksString: tOptional(tString)
  });
  scheme.BrowserContextClockFastForwardResult = tOptional(tObject({}));
  scheme.BrowserContextClockInstallParams = tObject({
    timeNumber: tOptional(tFloat),
    timeString: tOptional(tString)
  });
  scheme.BrowserContextClockInstallResult = tOptional(tObject({}));
  scheme.BrowserContextClockPauseAtParams = tObject({
    timeNumber: tOptional(tFloat),
    timeString: tOptional(tString)
  });
  scheme.BrowserContextClockPauseAtResult = tOptional(tObject({}));
  scheme.BrowserContextClockResumeParams = tOptional(tObject({}));
  scheme.BrowserContextClockResumeResult = tOptional(tObject({}));
  scheme.BrowserContextClockRunForParams = tObject({
    ticksNumber: tOptional(tFloat),
    ticksString: tOptional(tString)
  });
  scheme.BrowserContextClockRunForResult = tOptional(tObject({}));
  scheme.BrowserContextClockSetFixedTimeParams = tObject({
    timeNumber: tOptional(tFloat),
    timeString: tOptional(tString)
  });
  scheme.BrowserContextClockSetFixedTimeResult = tOptional(tObject({}));
  scheme.BrowserContextClockSetSystemTimeParams = tObject({
    timeNumber: tOptional(tFloat),
    timeString: tOptional(tString)
  });
  scheme.BrowserContextClockSetSystemTimeResult = tOptional(tObject({}));
  scheme.BrowserContextCredentialsInstallParams = tOptional(tObject({}));
  scheme.BrowserContextCredentialsInstallResult = tOptional(tObject({}));
  scheme.BrowserContextCredentialsCreateParams = tObject({
    rpId: tString,
    id: tOptional(tString),
    userHandle: tOptional(tString),
    privateKey: tOptional(tString),
    publicKey: tOptional(tString)
  });
  scheme.BrowserContextCredentialsCreateResult = tObject({
    credential: tType("VirtualCredential")
  });
  scheme.BrowserContextCredentialsGetParams = tObject({
    rpId: tOptional(tString),
    id: tOptional(tString)
  });
  scheme.BrowserContextCredentialsGetResult = tObject({
    credentials: tArray(tType("VirtualCredential"))
  });
  scheme.BrowserContextCredentialsDeleteParams = tObject({
    id: tString
  });
  scheme.BrowserContextCredentialsDeleteResult = tOptional(tObject({}));
  scheme.BrowserTypeInitializer = tObject({
    executablePath: tString,
    name: tString
  });
  scheme.BrowserTypeLaunchParams = tObject({
    channel: tOptional(tString),
    executablePath: tOptional(tString),
    args: tOptional(tArray(tString)),
    ignoreAllDefaultArgs: tOptional(tBoolean),
    ignoreDefaultArgs: tOptional(tArray(tString)),
    handleSIGINT: tOptional(tBoolean),
    handleSIGTERM: tOptional(tBoolean),
    handleSIGHUP: tOptional(tBoolean),
    timeout: tFloat,
    env: tOptional(tArray(tType("NameValue"))),
    headless: tOptional(tBoolean),
    proxy: tOptional(tObject({
      server: tString,
      bypass: tOptional(tString),
      username: tOptional(tString),
      password: tOptional(tString)
    })),
    downloadsPath: tOptional(tString),
    tracesDir: tOptional(tString),
    artifactsDir: tOptional(tString),
    chromiumSandbox: tOptional(tBoolean),
    firefoxUserPrefs: tOptional(tAny),
    cdpPort: tOptional(tInt),
    slowMo: tOptional(tFloat)
  });
  scheme.BrowserTypeLaunchResult = tObject({
    browser: tChannel(["Browser"])
  });
  scheme.BrowserTypeLaunchPersistentContextParams = tObject({
    channel: tOptional(tString),
    executablePath: tOptional(tString),
    args: tOptional(tArray(tString)),
    ignoreAllDefaultArgs: tOptional(tBoolean),
    ignoreDefaultArgs: tOptional(tArray(tString)),
    handleSIGINT: tOptional(tBoolean),
    handleSIGTERM: tOptional(tBoolean),
    handleSIGHUP: tOptional(tBoolean),
    timeout: tFloat,
    env: tOptional(tArray(tType("NameValue"))),
    headless: tOptional(tBoolean),
    proxy: tOptional(tObject({
      server: tString,
      bypass: tOptional(tString),
      username: tOptional(tString),
      password: tOptional(tString)
    })),
    downloadsPath: tOptional(tString),
    tracesDir: tOptional(tString),
    artifactsDir: tOptional(tString),
    chromiumSandbox: tOptional(tBoolean),
    firefoxUserPrefs: tOptional(tAny),
    cdpPort: tOptional(tInt),
    noDefaultViewport: tOptional(tBoolean),
    viewport: tOptional(tObject({
      width: tInt,
      height: tInt
    })),
    screen: tOptional(tObject({
      width: tInt,
      height: tInt
    })),
    ignoreHTTPSErrors: tOptional(tBoolean),
    clientCertificates: tOptional(tArray(tObject({
      origin: tString,
      cert: tOptional(tBinary),
      key: tOptional(tBinary),
      passphrase: tOptional(tString),
      pfx: tOptional(tBinary)
    }))),
    javaScriptEnabled: tOptional(tBoolean),
    bypassCSP: tOptional(tBoolean),
    userAgent: tOptional(tString),
    locale: tOptional(tString),
    timezoneId: tOptional(tString),
    geolocation: tOptional(tObject({
      longitude: tFloat,
      latitude: tFloat,
      accuracy: tOptional(tFloat)
    })),
    permissions: tOptional(tArray(tString)),
    extraHTTPHeaders: tOptional(tArray(tType("NameValue"))),
    offline: tOptional(tBoolean),
    httpCredentials: tOptional(tObject({
      username: tString,
      password: tString,
      origin: tOptional(tString),
      send: tOptional(tEnum(["always", "unauthorized"]))
    })),
    deviceScaleFactor: tOptional(tFloat),
    isMobile: tOptional(tBoolean),
    hasTouch: tOptional(tBoolean),
    colorScheme: tOptional(tEnum(["dark", "light", "no-preference", "no-override"])),
    reducedMotion: tOptional(tEnum(["reduce", "no-preference", "no-override"])),
    forcedColors: tOptional(tEnum(["active", "none", "no-override"])),
    acceptDownloads: tOptional(tEnum(["accept", "deny", "internal-browser-default"])),
    contrast: tOptional(tEnum(["no-preference", "more", "no-override"])),
    baseURL: tOptional(tString),
    recordVideo: tOptional(tObject({
      dir: tOptional(tString),
      size: tOptional(tObject({
        width: tInt,
        height: tInt
      })),
      showActions: tOptional(tObject({
        duration: tOptional(tFloat),
        position: tOptional(tEnum(["top-left", "top", "top-right", "bottom-left", "bottom", "bottom-right"])),
        fontSize: tOptional(tInt),
        cursor: tOptional(tEnum(["none", "pointer"]))
      }))
    })),
    strictSelectors: tOptional(tBoolean),
    serviceWorkers: tOptional(tEnum(["allow", "block"])),
    selectorEngines: tOptional(tArray(tType("SelectorEngine"))),
    testIdAttributeName: tOptional(tString),
    userDataDir: tString,
    slowMo: tOptional(tFloat)
  });
  scheme.BrowserTypeLaunchPersistentContextResult = tObject({
    browser: tChannel(["Browser"]),
    context: tChannel(["BrowserContext"])
  });
  scheme.BrowserTypeConnectOverCDPParams = tObject({
    endpointURL: tOptional(tString),
    headers: tOptional(tArray(tType("NameValue"))),
    slowMo: tOptional(tFloat),
    timeout: tFloat,
    isLocal: tOptional(tBoolean),
    noDefaults: tOptional(tBoolean),
    artifactsDir: tOptional(tString),
    transport: tOptional(tBinary)
  });
  scheme.BrowserTypeConnectOverCDPResult = tObject({
    browser: tChannel(["Browser"]),
    defaultContext: tOptional(tChannel(["BrowserContext"]))
  });
  scheme.BrowserTypeConnectToWorkerParams = tObject({
    endpoint: tString,
    timeout: tFloat
  });
  scheme.BrowserTypeConnectToWorkerResult = tObject({
    worker: tChannel(["Worker"])
  });
  scheme.Metadata = tObject({
    location: tOptional(tObject({
      file: tString,
      line: tOptional(tInt),
      column: tOptional(tInt)
    })),
    title: tOptional(tString),
    internal: tOptional(tBoolean),
    stepId: tOptional(tString)
  });
  scheme.ClientSideCallMetadata = tObject({
    id: tInt,
    stack: tOptional(tArray(tType("StackFrame")))
  });
  scheme.SDKLanguage = tEnum(["javascript", "python", "java", "csharp"]);
  scheme.DisposableInitializer = tOptional(tObject({}));
  scheme.DisposableDisposeParams = tOptional(tObject({}));
  scheme.DisposableDisposeResult = tOptional(tObject({}));
  scheme.WaitInfo = tObject({
    waitId: tString,
    phase: tEnum(["before", "after", "log"]),
    event: tOptional(tString),
    message: tOptional(tString),
    error: tOptional(tString)
  });
  scheme.ElectronInitializer = tOptional(tObject({}));
  scheme.ElectronLaunchParams = tObject({
    executablePath: tOptional(tString),
    args: tOptional(tArray(tString)),
    chromiumSandbox: tOptional(tBoolean),
    cwd: tOptional(tString),
    env: tOptional(tArray(tType("NameValue"))),
    timeout: tFloat,
    acceptDownloads: tOptional(tEnum(["accept", "deny", "internal-browser-default"])),
    bypassCSP: tOptional(tBoolean),
    colorScheme: tOptional(tEnum(["dark", "light", "no-preference", "no-override"])),
    extraHTTPHeaders: tOptional(tArray(tType("NameValue"))),
    geolocation: tOptional(tObject({
      longitude: tFloat,
      latitude: tFloat,
      accuracy: tOptional(tFloat)
    })),
    httpCredentials: tOptional(tObject({
      username: tString,
      password: tString,
      origin: tOptional(tString)
    })),
    ignoreHTTPSErrors: tOptional(tBoolean),
    locale: tOptional(tString),
    offline: tOptional(tBoolean),
    recordVideo: tOptional(tObject({
      dir: tOptional(tString),
      size: tOptional(tObject({
        width: tInt,
        height: tInt
      })),
      showActions: tOptional(tObject({
        duration: tOptional(tFloat),
        position: tOptional(tEnum(["top-left", "top", "top-right", "bottom-left", "bottom", "bottom-right"])),
        fontSize: tOptional(tInt),
        cursor: tOptional(tEnum(["none", "pointer"]))
      }))
    })),
    strictSelectors: tOptional(tBoolean),
    timezoneId: tOptional(tString),
    tracesDir: tOptional(tString),
    artifactsDir: tOptional(tString),
    selectorEngines: tOptional(tArray(tType("SelectorEngine"))),
    testIdAttributeName: tOptional(tString)
  });
  scheme.ElectronLaunchResult = tObject({
    electronApplication: tChannel(["ElectronApplication"])
  });
  scheme.ElectronApplicationInitializer = tObject({
    context: tChannel(["BrowserContext"])
  });
  scheme.ElectronApplicationCloseEvent = tOptional(tObject({}));
  scheme.ElectronApplicationConsoleEvent = tObject({
    type: tString,
    text: tString,
    args: tArray(tChannel(["ElementHandle", "JSHandle"])),
    location: tObject({
      url: tString,
      lineNumber: tInt,
      columnNumber: tInt
    }),
    timestamp: tFloat
  });
  scheme.ElectronApplicationBrowserWindowParams = tObject({
    page: tChannel(["Page"])
  });
  scheme.ElectronApplicationBrowserWindowResult = tObject({
    handle: tChannel(["ElementHandle", "JSHandle"])
  });
  scheme.ElectronApplicationEvaluateExpressionParams = tObject({
    expression: tString,
    isFunction: tOptional(tBoolean),
    arg: tType("SerializedArgument")
  });
  scheme.ElectronApplicationEvaluateExpressionResult = tObject({
    value: tType("SerializedValue")
  });
  scheme.ElectronApplicationEvaluateExpressionHandleParams = tObject({
    expression: tString,
    isFunction: tOptional(tBoolean),
    arg: tType("SerializedArgument")
  });
  scheme.ElectronApplicationEvaluateExpressionHandleResult = tObject({
    handle: tChannel(["ElementHandle", "JSHandle"])
  });
  scheme.ElectronApplicationUpdateSubscriptionParams = tObject({
    event: tEnum(["console"]),
    enabled: tBoolean
  });
  scheme.ElectronApplicationUpdateSubscriptionResult = tOptional(tObject({}));
  scheme.FrameInitializer = tObject({
    url: tString,
    name: tString,
    parentFrame: tOptional(tChannel(["Frame"])),
    loadStates: tArray(tType("LifecycleEvent"))
  });
  scheme.FrameLoadstateEvent = tObject({
    add: tOptional(tType("LifecycleEvent")),
    remove: tOptional(tType("LifecycleEvent"))
  });
  scheme.FrameNavigatedEvent = tObject({
    url: tString,
    name: tString,
    newDocument: tOptional(tObject({
      request: tOptional(tChannel(["Request"]))
    })),
    error: tOptional(tString)
  });
  scheme.FrameEvalOnSelectorParams = tObject({
    selector: tString,
    strict: tOptional(tBoolean),
    expression: tString,
    isFunction: tOptional(tBoolean),
    arg: tType("SerializedArgument")
  });
  scheme.FrameEvalOnSelectorResult = tObject({
    value: tType("SerializedValue")
  });
  scheme.FrameEvalOnSelectorAllParams = tObject({
    selector: tString,
    expression: tString,
    isFunction: tOptional(tBoolean),
    arg: tType("SerializedArgument")
  });
  scheme.FrameEvalOnSelectorAllResult = tObject({
    value: tType("SerializedValue")
  });
  scheme.FrameAddScriptTagParams = tObject({
    url: tOptional(tString),
    content: tOptional(tString),
    type: tOptional(tString)
  });
  scheme.FrameAddScriptTagResult = tObject({
    element: tChannel(["ElementHandle"])
  });
  scheme.FrameAddStyleTagParams = tObject({
    url: tOptional(tString),
    content: tOptional(tString)
  });
  scheme.FrameAddStyleTagResult = tObject({
    element: tChannel(["ElementHandle"])
  });
  scheme.FrameAriaSnapshotParams = tObject({
    mode: tOptional(tEnum(["ai", "default"])),
    track: tOptional(tString),
    selector: tOptional(tString),
    depth: tOptional(tInt),
    boxes: tOptional(tBoolean),
    timeout: tFloat
  });
  scheme.FrameAriaSnapshotResult = tObject({
    snapshot: tString
  });
  scheme.FrameBlurParams = tObject({
    selector: tString,
    strict: tOptional(tBoolean),
    timeout: tFloat
  });
  scheme.FrameBlurResult = tOptional(tObject({}));
  scheme.FrameCheckParams = tObject({
    selector: tString,
    strict: tOptional(tBoolean),
    force: tOptional(tBoolean),
    position: tOptional(tType("Point")),
    timeout: tFloat,
    trial: tOptional(tBoolean)
  });
  scheme.FrameCheckResult = tOptional(tObject({}));
  scheme.FrameClickParams = tObject({
    selector: tString,
    strict: tOptional(tBoolean),
    force: tOptional(tBoolean),
    noWaitAfter: tOptional(tBoolean),
    modifiers: tOptional(tArray(tEnum(["Alt", "Control", "ControlOrMeta", "Meta", "Shift"]))),
    position: tOptional(tType("Point")),
    delay: tOptional(tFloat),
    button: tOptional(tEnum(["left", "right", "middle"])),
    clickCount: tOptional(tInt),
    timeout: tFloat,
    trial: tOptional(tBoolean),
    steps: tOptional(tInt)
  });
  scheme.FrameClickResult = tOptional(tObject({}));
  scheme.FrameContentParams = tOptional(tObject({}));
  scheme.FrameContentResult = tObject({
    value: tString
  });
  scheme.FrameDragAndDropParams = tObject({
    source: tString,
    target: tString,
    force: tOptional(tBoolean),
    timeout: tFloat,
    trial: tOptional(tBoolean),
    sourcePosition: tOptional(tType("Point")),
    targetPosition: tOptional(tType("Point")),
    strict: tOptional(tBoolean),
    steps: tOptional(tInt)
  });
  scheme.FrameDragAndDropResult = tOptional(tObject({}));
  scheme.FrameDropParams = tObject({
    selector: tString,
    strict: tOptional(tBoolean),
    position: tOptional(tType("Point")),
    payloads: tOptional(tArray(tObject({
      name: tString,
      mimeType: tOptional(tString),
      buffer: tBinary
    }))),
    localPaths: tOptional(tArray(tString)),
    streams: tOptional(tArray(tChannel(["WritableStream"]))),
    data: tOptional(tArray(tObject({
      mimeType: tString,
      value: tString
    }))),
    timeout: tFloat
  });
  scheme.FrameDropResult = tOptional(tObject({}));
  scheme.FrameDblclickParams = tObject({
    selector: tString,
    strict: tOptional(tBoolean),
    force: tOptional(tBoolean),
    modifiers: tOptional(tArray(tEnum(["Alt", "Control", "ControlOrMeta", "Meta", "Shift"]))),
    position: tOptional(tType("Point")),
    delay: tOptional(tFloat),
    button: tOptional(tEnum(["left", "right", "middle"])),
    timeout: tFloat,
    trial: tOptional(tBoolean),
    steps: tOptional(tInt)
  });
  scheme.FrameDblclickResult = tOptional(tObject({}));
  scheme.FrameDispatchEventParams = tObject({
    selector: tString,
    strict: tOptional(tBoolean),
    type: tString,
    eventInit: tType("SerializedArgument"),
    timeout: tFloat
  });
  scheme.FrameDispatchEventResult = tOptional(tObject({}));
  scheme.FrameEvaluateExpressionParams = tObject({
    expression: tString,
    isFunction: tOptional(tBoolean),
    arg: tType("SerializedArgument")
  });
  scheme.FrameEvaluateExpressionResult = tObject({
    value: tType("SerializedValue")
  });
  scheme.FrameEvaluateExpressionHandleParams = tObject({
    expression: tString,
    isFunction: tOptional(tBoolean),
    arg: tType("SerializedArgument")
  });
  scheme.FrameEvaluateExpressionHandleResult = tObject({
    handle: tChannel(["ElementHandle", "JSHandle"])
  });
  scheme.FrameFillParams = tObject({
    selector: tString,
    strict: tOptional(tBoolean),
    value: tString,
    force: tOptional(tBoolean),
    timeout: tFloat
  });
  scheme.FrameFillResult = tOptional(tObject({}));
  scheme.FrameFocusParams = tObject({
    selector: tString,
    strict: tOptional(tBoolean),
    timeout: tFloat
  });
  scheme.FrameFocusResult = tOptional(tObject({}));
  scheme.FrameFrameElementParams = tOptional(tObject({}));
  scheme.FrameFrameElementResult = tObject({
    element: tChannel(["ElementHandle"])
  });
  scheme.FrameResolveSelectorParams = tObject({
    selector: tString
  });
  scheme.FrameResolveSelectorResult = tObject({
    resolvedSelector: tString
  });
  scheme.FrameHighlightParams = tObject({
    selector: tString,
    style: tOptional(tString)
  });
  scheme.FrameHighlightResult = tOptional(tObject({}));
  scheme.FrameHideHighlightParams = tObject({
    selector: tString
  });
  scheme.FrameHideHighlightResult = tOptional(tObject({}));
  scheme.FrameGetAttributeParams = tObject({
    selector: tString,
    strict: tOptional(tBoolean),
    name: tString,
    timeout: tFloat
  });
  scheme.FrameGetAttributeResult = tObject({
    value: tOptional(tString)
  });
  scheme.FrameGotoParams = tObject({
    url: tString,
    timeout: tFloat,
    waitUntil: tOptional(tType("LifecycleEvent")),
    referer: tOptional(tString)
  });
  scheme.FrameGotoResult = tObject({
    response: tOptional(tChannel(["Response"]))
  });
  scheme.FrameHoverParams = tObject({
    selector: tString,
    strict: tOptional(tBoolean),
    force: tOptional(tBoolean),
    modifiers: tOptional(tArray(tEnum(["Alt", "Control", "ControlOrMeta", "Meta", "Shift"]))),
    position: tOptional(tType("Point")),
    timeout: tFloat,
    trial: tOptional(tBoolean)
  });
  scheme.FrameHoverResult = tOptional(tObject({}));
  scheme.FrameInnerHTMLParams = tObject({
    selector: tString,
    strict: tOptional(tBoolean),
    timeout: tFloat
  });
  scheme.FrameInnerHTMLResult = tObject({
    value: tString
  });
  scheme.FrameInnerTextParams = tObject({
    selector: tString,
    strict: tOptional(tBoolean),
    timeout: tFloat
  });
  scheme.FrameInnerTextResult = tObject({
    value: tString
  });
  scheme.FrameInputValueParams = tObject({
    selector: tString,
    strict: tOptional(tBoolean),
    timeout: tFloat
  });
  scheme.FrameInputValueResult = tObject({
    value: tString
  });
  scheme.FrameIsCheckedParams = tObject({
    selector: tString,
    strict: tOptional(tBoolean),
    timeout: tFloat
  });
  scheme.FrameIsCheckedResult = tObject({
    value: tBoolean
  });
  scheme.FrameIsDisabledParams = tObject({
    selector: tString,
    strict: tOptional(tBoolean),
    timeout: tFloat
  });
  scheme.FrameIsDisabledResult = tObject({
    value: tBoolean
  });
  scheme.FrameIsEnabledParams = tObject({
    selector: tString,
    strict: tOptional(tBoolean),
    timeout: tFloat
  });
  scheme.FrameIsEnabledResult = tObject({
    value: tBoolean
  });
  scheme.FrameIsHiddenParams = tObject({
    selector: tString,
    strict: tOptional(tBoolean)
  });
  scheme.FrameIsHiddenResult = tObject({
    value: tBoolean
  });
  scheme.FrameIsVisibleParams = tObject({
    selector: tString,
    strict: tOptional(tBoolean)
  });
  scheme.FrameIsVisibleResult = tObject({
    value: tBoolean
  });
  scheme.FrameIsEditableParams = tObject({
    selector: tString,
    strict: tOptional(tBoolean),
    timeout: tFloat
  });
  scheme.FrameIsEditableResult = tObject({
    value: tBoolean
  });
  scheme.FramePressParams = tObject({
    selector: tString,
    strict: tOptional(tBoolean),
    key: tString,
    delay: tOptional(tFloat),
    noWaitAfter: tOptional(tBoolean),
    timeout: tFloat
  });
  scheme.FramePressResult = tOptional(tObject({}));
  scheme.FrameQuerySelectorParams = tObject({
    selector: tString,
    strict: tOptional(tBoolean)
  });
  scheme.FrameQuerySelectorResult = tObject({
    element: tOptional(tChannel(["ElementHandle"]))
  });
  scheme.FrameQuerySelectorAllParams = tObject({
    selector: tString
  });
  scheme.FrameQuerySelectorAllResult = tObject({
    elements: tArray(tChannel(["ElementHandle"]))
  });
  scheme.FrameQueryCountParams = tObject({
    selector: tString
  });
  scheme.FrameQueryCountResult = tObject({
    value: tInt
  });
  scheme.FrameSelectOptionParams = tObject({
    selector: tString,
    strict: tOptional(tBoolean),
    elements: tOptional(tArray(tChannel(["ElementHandle"]))),
    options: tOptional(tArray(tObject({
      valueOrLabel: tOptional(tString),
      value: tOptional(tString),
      label: tOptional(tString),
      index: tOptional(tInt)
    }))),
    force: tOptional(tBoolean),
    timeout: tFloat
  });
  scheme.FrameSelectOptionResult = tObject({
    values: tArray(tString)
  });
  scheme.FrameSetContentParams = tObject({
    html: tString,
    timeout: tFloat,
    waitUntil: tOptional(tType("LifecycleEvent"))
  });
  scheme.FrameSetContentResult = tOptional(tObject({}));
  scheme.FrameSetInputFilesParams = tObject({
    selector: tString,
    strict: tOptional(tBoolean),
    payloads: tOptional(tArray(tObject({
      name: tString,
      mimeType: tOptional(tString),
      buffer: tBinary
    }))),
    localDirectory: tOptional(tString),
    directoryStream: tOptional(tChannel(["WritableStream"])),
    localPaths: tOptional(tArray(tString)),
    streams: tOptional(tArray(tChannel(["WritableStream"]))),
    timeout: tFloat
  });
  scheme.FrameSetInputFilesResult = tOptional(tObject({}));
  scheme.FrameTapParams = tObject({
    selector: tString,
    strict: tOptional(tBoolean),
    force: tOptional(tBoolean),
    modifiers: tOptional(tArray(tEnum(["Alt", "Control", "ControlOrMeta", "Meta", "Shift"]))),
    position: tOptional(tType("Point")),
    timeout: tFloat,
    trial: tOptional(tBoolean)
  });
  scheme.FrameTapResult = tOptional(tObject({}));
  scheme.FrameTextContentParams = tObject({
    selector: tString,
    strict: tOptional(tBoolean),
    timeout: tFloat
  });
  scheme.FrameTextContentResult = tObject({
    value: tOptional(tString)
  });
  scheme.FrameTitleParams = tOptional(tObject({}));
  scheme.FrameTitleResult = tObject({
    value: tString
  });
  scheme.FrameTypeParams = tObject({
    selector: tString,
    strict: tOptional(tBoolean),
    text: tString,
    delay: tOptional(tFloat),
    timeout: tFloat
  });
  scheme.FrameTypeResult = tOptional(tObject({}));
  scheme.FrameUncheckParams = tObject({
    selector: tString,
    strict: tOptional(tBoolean),
    force: tOptional(tBoolean),
    position: tOptional(tType("Point")),
    timeout: tFloat,
    trial: tOptional(tBoolean)
  });
  scheme.FrameUncheckResult = tOptional(tObject({}));
  scheme.FrameWaitForTimeoutParams = tObject({
    waitTimeout: tFloat
  });
  scheme.FrameWaitForTimeoutResult = tOptional(tObject({}));
  scheme.FrameWaitForFunctionParams = tObject({
    expression: tString,
    isFunction: tOptional(tBoolean),
    arg: tType("SerializedArgument"),
    timeout: tFloat,
    pollingInterval: tOptional(tFloat)
  });
  scheme.FrameWaitForFunctionResult = tObject({
    handle: tChannel(["ElementHandle", "JSHandle"])
  });
  scheme.FrameWaitForSelectorParams = tObject({
    selector: tString,
    strict: tOptional(tBoolean),
    timeout: tFloat,
    state: tOptional(tEnum(["attached", "detached", "visible", "hidden"])),
    omitReturnValue: tOptional(tBoolean)
  });
  scheme.FrameWaitForSelectorResult = tObject({
    element: tOptional(tChannel(["ElementHandle"]))
  });
  scheme.FrameExpectParams = tObject({
    selector: tOptional(tString),
    expression: tString,
    expressionArg: tOptional(tAny),
    pseudo: tOptional(tEnum(["before", "after"])),
    expectedText: tOptional(tArray(tType("ExpectedTextValue"))),
    expectedNumber: tOptional(tFloat),
    expectedValue: tOptional(tType("SerializedArgument")),
    useInnerText: tOptional(tBoolean),
    isNot: tBoolean,
    timeout: tFloat
  });
  scheme.FrameExpectResult = tOptional(tObject({}));
  scheme.FrameExpectErrorDetails = tObject({
    received: tOptional(tObject({
      value: tOptional(tType("SerializedValue")),
      ariaSnapshot: tOptional(tString)
    })),
    timedOut: tOptional(tBoolean),
    customErrorMessage: tOptional(tString)
  });
  scheme.JSHandleInitializer = tObject({
    preview: tString
  });
  scheme.JSHandlePreviewUpdatedEvent = tObject({
    preview: tString
  });
  scheme.ElementHandlePreviewUpdatedEvent = tType("JSHandlePreviewUpdatedEvent");
  scheme.JSHandleDisposeParams = tOptional(tObject({}));
  scheme.ElementHandleDisposeParams = tType("JSHandleDisposeParams");
  scheme.JSHandleDisposeResult = tOptional(tObject({}));
  scheme.ElementHandleDisposeResult = tType("JSHandleDisposeResult");
  scheme.JSHandleEvaluateExpressionParams = tObject({
    expression: tString,
    isFunction: tOptional(tBoolean),
    arg: tType("SerializedArgument")
  });
  scheme.ElementHandleEvaluateExpressionParams = tType("JSHandleEvaluateExpressionParams");
  scheme.JSHandleEvaluateExpressionResult = tObject({
    value: tType("SerializedValue")
  });
  scheme.ElementHandleEvaluateExpressionResult = tType("JSHandleEvaluateExpressionResult");
  scheme.JSHandleEvaluateExpressionHandleParams = tObject({
    expression: tString,
    isFunction: tOptional(tBoolean),
    arg: tType("SerializedArgument")
  });
  scheme.ElementHandleEvaluateExpressionHandleParams = tType("JSHandleEvaluateExpressionHandleParams");
  scheme.JSHandleEvaluateExpressionHandleResult = tObject({
    handle: tChannel(["ElementHandle", "JSHandle"])
  });
  scheme.ElementHandleEvaluateExpressionHandleResult = tType("JSHandleEvaluateExpressionHandleResult");
  scheme.JSHandleGetPropertyListParams = tOptional(tObject({}));
  scheme.ElementHandleGetPropertyListParams = tType("JSHandleGetPropertyListParams");
  scheme.JSHandleGetPropertyListResult = tObject({
    properties: tArray(tObject({
      name: tString,
      value: tChannel(["ElementHandle", "JSHandle"])
    }))
  });
  scheme.ElementHandleGetPropertyListResult = tType("JSHandleGetPropertyListResult");
  scheme.JSHandleGetPropertyParams = tObject({
    name: tString
  });
  scheme.ElementHandleGetPropertyParams = tType("JSHandleGetPropertyParams");
  scheme.JSHandleGetPropertyResult = tObject({
    handle: tChannel(["ElementHandle", "JSHandle"])
  });
  scheme.ElementHandleGetPropertyResult = tType("JSHandleGetPropertyResult");
  scheme.JSHandleJsonValueParams = tOptional(tObject({}));
  scheme.ElementHandleJsonValueParams = tType("JSHandleJsonValueParams");
  scheme.JSHandleJsonValueResult = tObject({
    value: tType("SerializedValue")
  });
  scheme.ElementHandleJsonValueResult = tType("JSHandleJsonValueResult");
  scheme.ElementHandleInitializer = tObject({
    preview: tString
  });
  scheme.ElementHandleEvalOnSelectorParams = tObject({
    selector: tString,
    strict: tOptional(tBoolean),
    expression: tString,
    isFunction: tOptional(tBoolean),
    arg: tType("SerializedArgument")
  });
  scheme.ElementHandleEvalOnSelectorResult = tObject({
    value: tType("SerializedValue")
  });
  scheme.ElementHandleEvalOnSelectorAllParams = tObject({
    selector: tString,
    expression: tString,
    isFunction: tOptional(tBoolean),
    arg: tType("SerializedArgument")
  });
  scheme.ElementHandleEvalOnSelectorAllResult = tObject({
    value: tType("SerializedValue")
  });
  scheme.ElementHandleBoundingBoxParams = tOptional(tObject({}));
  scheme.ElementHandleBoundingBoxResult = tObject({
    value: tOptional(tType("Rect"))
  });
  scheme.ElementHandleCheckParams = tObject({
    force: tOptional(tBoolean),
    position: tOptional(tType("Point")),
    timeout: tFloat,
    trial: tOptional(tBoolean)
  });
  scheme.ElementHandleCheckResult = tOptional(tObject({}));
  scheme.ElementHandleClickParams = tObject({
    force: tOptional(tBoolean),
    noWaitAfter: tOptional(tBoolean),
    modifiers: tOptional(tArray(tEnum(["Alt", "Control", "ControlOrMeta", "Meta", "Shift"]))),
    position: tOptional(tType("Point")),
    delay: tOptional(tFloat),
    button: tOptional(tEnum(["left", "right", "middle"])),
    clickCount: tOptional(tInt),
    timeout: tFloat,
    trial: tOptional(tBoolean),
    steps: tOptional(tInt)
  });
  scheme.ElementHandleClickResult = tOptional(tObject({}));
  scheme.ElementHandleContentFrameParams = tOptional(tObject({}));
  scheme.ElementHandleContentFrameResult = tObject({
    frame: tOptional(tChannel(["Frame"]))
  });
  scheme.ElementHandleDblclickParams = tObject({
    force: tOptional(tBoolean),
    modifiers: tOptional(tArray(tEnum(["Alt", "Control", "ControlOrMeta", "Meta", "Shift"]))),
    position: tOptional(tType("Point")),
    delay: tOptional(tFloat),
    button: tOptional(tEnum(["left", "right", "middle"])),
    timeout: tFloat,
    trial: tOptional(tBoolean),
    steps: tOptional(tInt)
  });
  scheme.ElementHandleDblclickResult = tOptional(tObject({}));
  scheme.ElementHandleDispatchEventParams = tObject({
    type: tString,
    eventInit: tType("SerializedArgument")
  });
  scheme.ElementHandleDispatchEventResult = tOptional(tObject({}));
  scheme.ElementHandleFillParams = tObject({
    value: tString,
    force: tOptional(tBoolean),
    timeout: tFloat
  });
  scheme.ElementHandleFillResult = tOptional(tObject({}));
  scheme.ElementHandleFocusParams = tOptional(tObject({}));
  scheme.ElementHandleFocusResult = tOptional(tObject({}));
  scheme.ElementHandleGetAttributeParams = tObject({
    name: tString
  });
  scheme.ElementHandleGetAttributeResult = tObject({
    value: tOptional(tString)
  });
  scheme.ElementHandleHoverParams = tObject({
    force: tOptional(tBoolean),
    modifiers: tOptional(tArray(tEnum(["Alt", "Control", "ControlOrMeta", "Meta", "Shift"]))),
    position: tOptional(tType("Point")),
    timeout: tFloat,
    trial: tOptional(tBoolean)
  });
  scheme.ElementHandleHoverResult = tOptional(tObject({}));
  scheme.ElementHandleInnerHTMLParams = tOptional(tObject({}));
  scheme.ElementHandleInnerHTMLResult = tObject({
    value: tString
  });
  scheme.ElementHandleInnerTextParams = tOptional(tObject({}));
  scheme.ElementHandleInnerTextResult = tObject({
    value: tString
  });
  scheme.ElementHandleInputValueParams = tOptional(tObject({}));
  scheme.ElementHandleInputValueResult = tObject({
    value: tString
  });
  scheme.ElementHandleIsCheckedParams = tOptional(tObject({}));
  scheme.ElementHandleIsCheckedResult = tObject({
    value: tBoolean
  });
  scheme.ElementHandleIsDisabledParams = tOptional(tObject({}));
  scheme.ElementHandleIsDisabledResult = tObject({
    value: tBoolean
  });
  scheme.ElementHandleIsEditableParams = tOptional(tObject({}));
  scheme.ElementHandleIsEditableResult = tObject({
    value: tBoolean
  });
  scheme.ElementHandleIsEnabledParams = tOptional(tObject({}));
  scheme.ElementHandleIsEnabledResult = tObject({
    value: tBoolean
  });
  scheme.ElementHandleIsHiddenParams = tOptional(tObject({}));
  scheme.ElementHandleIsHiddenResult = tObject({
    value: tBoolean
  });
  scheme.ElementHandleIsVisibleParams = tOptional(tObject({}));
  scheme.ElementHandleIsVisibleResult = tObject({
    value: tBoolean
  });
  scheme.ElementHandleOwnerFrameParams = tOptional(tObject({}));
  scheme.ElementHandleOwnerFrameResult = tObject({
    frame: tOptional(tChannel(["Frame"]))
  });
  scheme.ElementHandlePressParams = tObject({
    key: tString,
    delay: tOptional(tFloat),
    timeout: tFloat,
    noWaitAfter: tOptional(tBoolean)
  });
  scheme.ElementHandlePressResult = tOptional(tObject({}));
  scheme.ElementHandleQuerySelectorParams = tObject({
    selector: tString,
    strict: tOptional(tBoolean)
  });
  scheme.ElementHandleQuerySelectorResult = tObject({
    element: tOptional(tChannel(["ElementHandle"]))
  });
  scheme.ElementHandleQuerySelectorAllParams = tObject({
    selector: tString
  });
  scheme.ElementHandleQuerySelectorAllResult = tObject({
    elements: tArray(tChannel(["ElementHandle"]))
  });
  scheme.ElementHandleScreenshotParams = tObject({
    timeout: tFloat,
    type: tOptional(tEnum(["png", "jpeg"])),
    quality: tOptional(tInt),
    omitBackground: tOptional(tBoolean),
    caret: tOptional(tEnum(["hide", "initial"])),
    animations: tOptional(tEnum(["disabled", "allow"])),
    scale: tOptional(tEnum(["css", "device"])),
    mask: tOptional(tArray(tObject({
      frame: tChannel(["Frame"]),
      selector: tString
    }))),
    maskColor: tOptional(tString),
    style: tOptional(tString)
  });
  scheme.ElementHandleScreenshotResult = tObject({
    binary: tBinary
  });
  scheme.ElementHandleScrollIntoViewIfNeededParams = tObject({
    timeout: tFloat
  });
  scheme.ElementHandleScrollIntoViewIfNeededResult = tOptional(tObject({}));
  scheme.ElementHandleSelectOptionParams = tObject({
    elements: tOptional(tArray(tChannel(["ElementHandle"]))),
    options: tOptional(tArray(tObject({
      valueOrLabel: tOptional(tString),
      value: tOptional(tString),
      label: tOptional(tString),
      index: tOptional(tInt)
    }))),
    force: tOptional(tBoolean),
    timeout: tFloat
  });
  scheme.ElementHandleSelectOptionResult = tObject({
    values: tArray(tString)
  });
  scheme.ElementHandleSelectTextParams = tObject({
    force: tOptional(tBoolean),
    timeout: tFloat
  });
  scheme.ElementHandleSelectTextResult = tOptional(tObject({}));
  scheme.ElementHandleSetInputFilesParams = tObject({
    payloads: tOptional(tArray(tObject({
      name: tString,
      mimeType: tOptional(tString),
      buffer: tBinary
    }))),
    localDirectory: tOptional(tString),
    directoryStream: tOptional(tChannel(["WritableStream"])),
    localPaths: tOptional(tArray(tString)),
    streams: tOptional(tArray(tChannel(["WritableStream"]))),
    timeout: tFloat
  });
  scheme.ElementHandleSetInputFilesResult = tOptional(tObject({}));
  scheme.ElementHandleTapParams = tObject({
    force: tOptional(tBoolean),
    modifiers: tOptional(tArray(tEnum(["Alt", "Control", "ControlOrMeta", "Meta", "Shift"]))),
    position: tOptional(tType("Point")),
    timeout: tFloat,
    trial: tOptional(tBoolean)
  });
  scheme.ElementHandleTapResult = tOptional(tObject({}));
  scheme.ElementHandleTextContentParams = tOptional(tObject({}));
  scheme.ElementHandleTextContentResult = tObject({
    value: tOptional(tString)
  });
  scheme.ElementHandleTypeParams = tObject({
    text: tString,
    delay: tOptional(tFloat),
    timeout: tFloat
  });
  scheme.ElementHandleTypeResult = tOptional(tObject({}));
  scheme.ElementHandleUncheckParams = tObject({
    force: tOptional(tBoolean),
    position: tOptional(tType("Point")),
    timeout: tFloat,
    trial: tOptional(tBoolean)
  });
  scheme.ElementHandleUncheckResult = tOptional(tObject({}));
  scheme.ElementHandleWaitForElementStateParams = tObject({
    state: tEnum(["visible", "hidden", "stable", "enabled", "disabled", "editable"]),
    timeout: tFloat
  });
  scheme.ElementHandleWaitForElementStateResult = tOptional(tObject({}));
  scheme.ElementHandleWaitForSelectorParams = tObject({
    selector: tString,
    strict: tOptional(tBoolean),
    timeout: tFloat,
    state: tOptional(tEnum(["attached", "detached", "visible", "hidden"]))
  });
  scheme.ElementHandleWaitForSelectorResult = tObject({
    element: tOptional(tChannel(["ElementHandle"]))
  });
  scheme.LocalUtilsInitializer = tObject({
    deviceDescriptors: tArray(tObject({
      name: tString,
      descriptor: tObject({
        userAgent: tString,
        viewport: tObject({
          width: tInt,
          height: tInt
        }),
        screen: tOptional(tObject({
          width: tInt,
          height: tInt
        })),
        deviceScaleFactor: tFloat,
        isMobile: tBoolean,
        hasTouch: tBoolean,
        defaultBrowserType: tEnum(["chromium", "firefox", "webkit"])
      })
    }))
  });
  scheme.LocalUtilsZipParams = tObject({
    zipFile: tString,
    entries: tArray(tType("NameValue")),
    stacksId: tOptional(tString),
    mode: tEnum(["write", "append"]),
    includeSources: tBoolean,
    additionalSources: tOptional(tArray(tString))
  });
  scheme.LocalUtilsZipResult = tOptional(tObject({}));
  scheme.LocalUtilsHarOpenParams = tObject({
    file: tString
  });
  scheme.LocalUtilsHarOpenResult = tObject({
    harId: tOptional(tString),
    error: tOptional(tString)
  });
  scheme.LocalUtilsHarLookupParams = tObject({
    harId: tString,
    url: tString,
    method: tString,
    headers: tArray(tType("NameValue")),
    postData: tOptional(tBinary),
    isNavigationRequest: tBoolean
  });
  scheme.LocalUtilsHarLookupResult = tObject({
    action: tEnum(["error", "redirect", "fulfill", "noentry"]),
    message: tOptional(tString),
    redirectURL: tOptional(tString),
    status: tOptional(tInt),
    headers: tOptional(tArray(tType("NameValue"))),
    body: tOptional(tBinary)
  });
  scheme.LocalUtilsHarCloseParams = tObject({
    harId: tString
  });
  scheme.LocalUtilsHarCloseResult = tOptional(tObject({}));
  scheme.LocalUtilsHarUnzipParams = tObject({
    zipFile: tString,
    harFile: tString,
    resourcesDir: tOptional(tString)
  });
  scheme.LocalUtilsHarUnzipResult = tOptional(tObject({}));
  scheme.LocalUtilsConnectParams = tObject({
    endpoint: tString,
    headers: tOptional(tAny),
    exposeNetwork: tOptional(tString),
    slowMo: tOptional(tFloat),
    timeout: tFloat,
    socksProxyRedirectPortForTest: tOptional(tInt)
  });
  scheme.LocalUtilsConnectResult = tObject({
    pipe: tChannel(["JsonPipe"]),
    headers: tArray(tType("NameValue"))
  });
  scheme.LocalUtilsTracingStartedParams = tObject({
    tracesDir: tOptional(tString),
    traceName: tString,
    live: tOptional(tBoolean)
  });
  scheme.LocalUtilsTracingStartedResult = tObject({
    stacksId: tString
  });
  scheme.LocalUtilsAddStackToTracingNoReplyParams = tObject({
    callData: tType("ClientSideCallMetadata")
  });
  scheme.LocalUtilsAddStackToTracingNoReplyResult = tOptional(tObject({}));
  scheme.LocalUtilsTraceDiscardedParams = tObject({
    stacksId: tString
  });
  scheme.LocalUtilsTraceDiscardedResult = tOptional(tObject({}));
  scheme.LocalUtilsGlobToRegexParams = tObject({
    glob: tString,
    baseURL: tOptional(tString),
    webSocketUrl: tOptional(tBoolean)
  });
  scheme.LocalUtilsGlobToRegexResult = tObject({
    regex: tString
  });
  scheme.SetNetworkCookie = tObject({
    name: tString,
    value: tString,
    url: tOptional(tString),
    domain: tOptional(tString),
    path: tOptional(tString),
    expires: tOptional(tFloat),
    httpOnly: tOptional(tBoolean),
    secure: tOptional(tBoolean),
    sameSite: tOptional(tEnum(["Strict", "Lax", "None"])),
    partitionKey: tOptional(tString),
    _crHasCrossSiteAncestor: tOptional(tBoolean)
  });
  scheme.NetworkCookie = tObject({
    name: tString,
    value: tString,
    domain: tString,
    path: tString,
    expires: tFloat,
    httpOnly: tBoolean,
    secure: tBoolean,
    sameSite: tEnum(["Strict", "Lax", "None"]),
    partitionKey: tOptional(tString),
    _crHasCrossSiteAncestor: tOptional(tBoolean)
  });
  scheme.RequestInitializer = tObject({
    frame: tOptional(tChannel(["Frame"])),
    serviceWorker: tOptional(tChannel(["Worker"])),
    url: tString,
    resourceType: tString,
    method: tString,
    postData: tOptional(tBinary),
    headers: tArray(tType("NameValue")),
    isNavigationRequest: tBoolean,
    redirectedFrom: tOptional(tChannel(["Request"]))
  });
  scheme.RequestResponseParams = tOptional(tObject({}));
  scheme.RequestResponseResult = tObject({
    response: tOptional(tChannel(["Response"]))
  });
  scheme.RequestRawRequestHeadersParams = tOptional(tObject({}));
  scheme.RequestRawRequestHeadersResult = tObject({
    headers: tArray(tType("NameValue"))
  });
  scheme.RouteInitializer = tObject({
    request: tChannel(["Request"])
  });
  scheme.RouteRedirectNavigationRequestParams = tObject({
    url: tString
  });
  scheme.RouteRedirectNavigationRequestResult = tOptional(tObject({}));
  scheme.RouteAbortParams = tObject({
    errorCode: tOptional(tString)
  });
  scheme.RouteAbortResult = tOptional(tObject({}));
  scheme.RouteContinueParams = tObject({
    url: tOptional(tString),
    method: tOptional(tString),
    headers: tOptional(tArray(tType("NameValue"))),
    postData: tOptional(tBinary),
    isFallback: tBoolean
  });
  scheme.RouteContinueResult = tOptional(tObject({}));
  scheme.RouteFulfillParams = tObject({
    status: tOptional(tInt),
    headers: tOptional(tArray(tType("NameValue"))),
    body: tOptional(tString),
    isBase64: tOptional(tBoolean),
    fetchResponseUid: tOptional(tString)
  });
  scheme.RouteFulfillResult = tOptional(tObject({}));
  scheme.WebSocketRouteInitializer = tObject({
    url: tString,
    protocols: tArray(tString)
  });
  scheme.WebSocketRouteMessageFromPageEvent = tObject({
    message: tString,
    isBase64: tBoolean
  });
  scheme.WebSocketRouteMessageFromServerEvent = tObject({
    message: tString,
    isBase64: tBoolean
  });
  scheme.WebSocketRouteClosePageEvent = tObject({
    code: tOptional(tInt),
    reason: tOptional(tString),
    wasClean: tBoolean
  });
  scheme.WebSocketRouteCloseServerEvent = tObject({
    code: tOptional(tInt),
    reason: tOptional(tString),
    wasClean: tBoolean
  });
  scheme.WebSocketRouteConnectParams = tOptional(tObject({}));
  scheme.WebSocketRouteConnectResult = tOptional(tObject({}));
  scheme.WebSocketRouteEnsureOpenedParams = tOptional(tObject({}));
  scheme.WebSocketRouteEnsureOpenedResult = tOptional(tObject({}));
  scheme.WebSocketRouteSendToPageParams = tObject({
    message: tString,
    isBase64: tBoolean
  });
  scheme.WebSocketRouteSendToPageResult = tOptional(tObject({}));
  scheme.WebSocketRouteSendToServerParams = tObject({
    message: tString,
    isBase64: tBoolean
  });
  scheme.WebSocketRouteSendToServerResult = tOptional(tObject({}));
  scheme.WebSocketRouteClosePageParams = tObject({
    code: tOptional(tInt),
    reason: tOptional(tString),
    wasClean: tBoolean
  });
  scheme.WebSocketRouteClosePageResult = tOptional(tObject({}));
  scheme.WebSocketRouteCloseServerParams = tObject({
    code: tOptional(tInt),
    reason: tOptional(tString),
    wasClean: tBoolean
  });
  scheme.WebSocketRouteCloseServerResult = tOptional(tObject({}));
  scheme.ResourceTiming = tObject({
    startTime: tFloat,
    domainLookupStart: tFloat,
    domainLookupEnd: tFloat,
    connectStart: tFloat,
    secureConnectionStart: tFloat,
    connectEnd: tFloat,
    requestStart: tFloat,
    responseStart: tFloat
  });
  scheme.ResponseInitializer = tObject({
    request: tChannel(["Request"]),
    url: tString,
    status: tInt,
    statusText: tString,
    headers: tArray(tType("NameValue")),
    timing: tType("ResourceTiming"),
    fromServiceWorker: tBoolean
  });
  scheme.ResponseBodyParams = tOptional(tObject({}));
  scheme.ResponseBodyResult = tObject({
    binary: tBinary
  });
  scheme.ResponseSecurityDetailsParams = tOptional(tObject({}));
  scheme.ResponseSecurityDetailsResult = tObject({
    value: tOptional(tType("SecurityDetails"))
  });
  scheme.ResponseServerAddrParams = tOptional(tObject({}));
  scheme.ResponseServerAddrResult = tObject({
    value: tOptional(tType("RemoteAddr"))
  });
  scheme.ResponseRawResponseHeadersParams = tOptional(tObject({}));
  scheme.ResponseRawResponseHeadersResult = tObject({
    headers: tArray(tType("NameValue"))
  });
  scheme.ResponseHttpVersionParams = tOptional(tObject({}));
  scheme.ResponseHttpVersionResult = tObject({
    value: tString
  });
  scheme.ResponseSizesParams = tOptional(tObject({}));
  scheme.ResponseSizesResult = tObject({
    sizes: tType("RequestSizes")
  });
  scheme.SecurityDetails = tObject({
    issuer: tOptional(tString),
    protocol: tOptional(tString),
    subjectName: tOptional(tString),
    validFrom: tOptional(tFloat),
    validTo: tOptional(tFloat)
  });
  scheme.RequestSizes = tObject({
    requestBodySize: tInt,
    requestHeadersSize: tInt,
    responseBodySize: tInt,
    responseHeadersSize: tInt
  });
  scheme.RemoteAddr = tObject({
    ipAddress: tString,
    port: tInt
  });
  scheme.WebSocketInitializer = tObject({
    url: tString
  });
  scheme.WebSocketOpenEvent = tOptional(tObject({}));
  scheme.WebSocketFrameSentEvent = tObject({
    opcode: tInt,
    data: tString
  });
  scheme.WebSocketFrameReceivedEvent = tObject({
    opcode: tInt,
    data: tString
  });
  scheme.WebSocketSocketErrorEvent = tObject({
    error: tString
  });
  scheme.WebSocketCloseEvent = tOptional(tObject({}));
  scheme.PageInitializer = tObject({
    mainFrame: tChannel(["Frame"]),
    viewportSize: tOptional(tObject({
      width: tInt,
      height: tInt
    })),
    isClosed: tBoolean,
    opener: tOptional(tChannel(["Page"])),
    video: tOptional(tChannel(["Artifact"]))
  });
  scheme.PageBindingCallEvent = tObject({
    binding: tChannel(["BindingCall"])
  });
  scheme.PageCloseEvent = tOptional(tObject({}));
  scheme.PageCrashEvent = tOptional(tObject({}));
  scheme.PageDownloadEvent = tObject({
    url: tString,
    suggestedFilename: tString,
    artifact: tChannel(["Artifact"])
  });
  scheme.PageViewportSizeChangedEvent = tObject({
    viewportSize: tOptional(tObject({
      width: tInt,
      height: tInt
    }))
  });
  scheme.PageFileChooserEvent = tObject({
    element: tChannel(["ElementHandle"]),
    isMultiple: tBoolean
  });
  scheme.PageFrameAttachedEvent = tObject({
    frame: tChannel(["Frame"])
  });
  scheme.PageFrameDetachedEvent = tObject({
    frame: tChannel(["Frame"])
  });
  scheme.PageLocatorHandlerTriggeredEvent = tObject({
    uid: tInt
  });
  scheme.PageRouteEvent = tObject({
    route: tChannel(["Route"])
  });
  scheme.PageScreencastFrameEvent = tObject({
    data: tBinary,
    timestamp: tFloat,
    viewportWidth: tInt,
    viewportHeight: tInt
  });
  scheme.PageWebSocketRouteEvent = tObject({
    webSocketRoute: tChannel(["WebSocketRoute"])
  });
  scheme.PageWebSocketEvent = tObject({
    webSocket: tChannel(["WebSocket"])
  });
  scheme.PageWorkerEvent = tObject({
    worker: tChannel(["Worker"])
  });
  scheme.PageAddInitScriptParams = tObject({
    source: tString
  });
  scheme.PageAddInitScriptResult = tObject({
    disposable: tChannel(["Disposable"])
  });
  scheme.PageCloseParams = tObject({
    reason: tOptional(tString)
  });
  scheme.PageCloseResult = tOptional(tObject({}));
  scheme.PageRunBeforeUnloadParams = tOptional(tObject({}));
  scheme.PageRunBeforeUnloadResult = tOptional(tObject({}));
  scheme.PageClearConsoleMessagesParams = tOptional(tObject({}));
  scheme.PageClearConsoleMessagesResult = tOptional(tObject({}));
  scheme.PageConsoleMessagesParams = tObject({
    filter: tOptional(tType("ConsoleMessagesFilter"))
  });
  scheme.PageConsoleMessagesResult = tObject({
    messages: tArray(tObject({
      type: tString,
      text: tString,
      args: tArray(tChannel(["ElementHandle", "JSHandle"])),
      location: tObject({
        url: tString,
        lineNumber: tInt,
        columnNumber: tInt
      }),
      timestamp: tFloat
    }))
  });
  scheme.PageEmulateMediaParams = tObject({
    media: tOptional(tEnum(["screen", "print", "no-override"])),
    colorScheme: tOptional(tEnum(["dark", "light", "no-preference", "no-override"])),
    reducedMotion: tOptional(tEnum(["reduce", "no-preference", "no-override"])),
    forcedColors: tOptional(tEnum(["active", "none", "no-override"])),
    contrast: tOptional(tEnum(["no-preference", "more", "no-override"]))
  });
  scheme.PageEmulateMediaResult = tOptional(tObject({}));
  scheme.PageExposeBindingParams = tObject({
    name: tString
  });
  scheme.PageExposeBindingResult = tObject({
    disposable: tChannel(["Disposable"])
  });
  scheme.PageGoBackParams = tObject({
    timeout: tFloat,
    waitUntil: tOptional(tType("LifecycleEvent"))
  });
  scheme.PageGoBackResult = tObject({
    response: tOptional(tChannel(["Response"]))
  });
  scheme.PageGoForwardParams = tObject({
    timeout: tFloat,
    waitUntil: tOptional(tType("LifecycleEvent"))
  });
  scheme.PageGoForwardResult = tObject({
    response: tOptional(tChannel(["Response"]))
  });
  scheme.PageRequestGCParams = tOptional(tObject({}));
  scheme.PageRequestGCResult = tOptional(tObject({}));
  scheme.PageRegisterLocatorHandlerParams = tObject({
    selector: tString,
    noWaitAfter: tOptional(tBoolean)
  });
  scheme.PageRegisterLocatorHandlerResult = tObject({
    uid: tInt
  });
  scheme.PageResolveLocatorHandlerNoReplyParams = tObject({
    uid: tInt,
    remove: tOptional(tBoolean)
  });
  scheme.PageResolveLocatorHandlerNoReplyResult = tOptional(tObject({}));
  scheme.PageUnregisterLocatorHandlerParams = tObject({
    uid: tInt
  });
  scheme.PageUnregisterLocatorHandlerResult = tOptional(tObject({}));
  scheme.PageReloadParams = tObject({
    timeout: tFloat,
    waitUntil: tOptional(tType("LifecycleEvent"))
  });
  scheme.PageReloadResult = tObject({
    response: tOptional(tChannel(["Response"]))
  });
  scheme.PageExpectScreenshotParams = tObject({
    expected: tOptional(tBinary),
    timeout: tFloat,
    isNot: tBoolean,
    locator: tOptional(tObject({
      frame: tChannel(["Frame"]),
      selector: tString
    })),
    comparator: tOptional(tString),
    maxDiffPixels: tOptional(tInt),
    maxDiffPixelRatio: tOptional(tFloat),
    threshold: tOptional(tFloat),
    fullPage: tOptional(tBoolean),
    clip: tOptional(tType("Rect")),
    omitBackground: tOptional(tBoolean),
    caret: tOptional(tEnum(["hide", "initial"])),
    animations: tOptional(tEnum(["disabled", "allow"])),
    scale: tOptional(tEnum(["css", "device"])),
    mask: tOptional(tArray(tObject({
      frame: tChannel(["Frame"]),
      selector: tString
    }))),
    maskColor: tOptional(tString),
    style: tOptional(tString)
  });
  scheme.PageExpectScreenshotResult = tObject({
    actual: tOptional(tBinary)
  });
  scheme.PageExpectScreenshotErrorDetails = tObject({
    diff: tOptional(tBinary),
    customErrorMessage: tOptional(tString),
    actual: tOptional(tBinary),
    previous: tOptional(tBinary),
    timedOut: tOptional(tBoolean),
    log: tOptional(tArray(tString))
  });
  scheme.PageScreenshotParams = tObject({
    timeout: tFloat,
    type: tOptional(tEnum(["png", "jpeg"])),
    quality: tOptional(tInt),
    fullPage: tOptional(tBoolean),
    clip: tOptional(tType("Rect")),
    omitBackground: tOptional(tBoolean),
    caret: tOptional(tEnum(["hide", "initial"])),
    animations: tOptional(tEnum(["disabled", "allow"])),
    scale: tOptional(tEnum(["css", "device"])),
    mask: tOptional(tArray(tObject({
      frame: tChannel(["Frame"]),
      selector: tString
    }))),
    maskColor: tOptional(tString),
    style: tOptional(tString)
  });
  scheme.PageScreenshotResult = tObject({
    binary: tBinary
  });
  scheme.PageSetExtraHTTPHeadersParams = tObject({
    headers: tArray(tType("NameValue"))
  });
  scheme.PageSetExtraHTTPHeadersResult = tOptional(tObject({}));
  scheme.PageSetNetworkInterceptionPatternsParams = tObject({
    patterns: tArray(tObject({
      glob: tOptional(tString),
      regexSource: tOptional(tString),
      regexFlags: tOptional(tString),
      urlPattern: tOptional(tType("URLPattern"))
    }))
  });
  scheme.PageSetNetworkInterceptionPatternsResult = tOptional(tObject({}));
  scheme.PageSetWebSocketInterceptionPatternsParams = tObject({
    patterns: tArray(tObject({
      glob: tOptional(tString),
      regexSource: tOptional(tString),
      regexFlags: tOptional(tString),
      urlPattern: tOptional(tType("URLPattern"))
    }))
  });
  scheme.PageSetWebSocketInterceptionPatternsResult = tOptional(tObject({}));
  scheme.PageSetViewportSizeParams = tObject({
    viewportSize: tObject({
      width: tInt,
      height: tInt
    })
  });
  scheme.PageSetViewportSizeResult = tOptional(tObject({}));
  scheme.PageKeyboardDownParams = tObject({
    key: tString
  });
  scheme.PageKeyboardDownResult = tOptional(tObject({}));
  scheme.PageKeyboardUpParams = tObject({
    key: tString
  });
  scheme.PageKeyboardUpResult = tOptional(tObject({}));
  scheme.PageKeyboardInsertTextParams = tObject({
    text: tString
  });
  scheme.PageKeyboardInsertTextResult = tOptional(tObject({}));
  scheme.PageKeyboardTypeParams = tObject({
    text: tString,
    delay: tOptional(tFloat)
  });
  scheme.PageKeyboardTypeResult = tOptional(tObject({}));
  scheme.PageKeyboardPressParams = tObject({
    key: tString,
    delay: tOptional(tFloat)
  });
  scheme.PageKeyboardPressResult = tOptional(tObject({}));
  scheme.PageMouseMoveParams = tObject({
    x: tFloat,
    y: tFloat,
    steps: tOptional(tInt)
  });
  scheme.PageMouseMoveResult = tOptional(tObject({}));
  scheme.PageMouseDownParams = tObject({
    button: tOptional(tEnum(["left", "right", "middle"])),
    clickCount: tOptional(tInt)
  });
  scheme.PageMouseDownResult = tOptional(tObject({}));
  scheme.PageMouseUpParams = tObject({
    button: tOptional(tEnum(["left", "right", "middle"])),
    clickCount: tOptional(tInt)
  });
  scheme.PageMouseUpResult = tOptional(tObject({}));
  scheme.PageMouseClickParams = tObject({
    x: tFloat,
    y: tFloat,
    delay: tOptional(tFloat),
    button: tOptional(tEnum(["left", "right", "middle"])),
    clickCount: tOptional(tInt)
  });
  scheme.PageMouseClickResult = tOptional(tObject({}));
  scheme.PageMouseWheelParams = tObject({
    deltaX: tFloat,
    deltaY: tFloat
  });
  scheme.PageMouseWheelResult = tOptional(tObject({}));
  scheme.PageTouchscreenTapParams = tObject({
    x: tFloat,
    y: tFloat
  });
  scheme.PageTouchscreenTapResult = tOptional(tObject({}));
  scheme.PageClearPageErrorsParams = tOptional(tObject({}));
  scheme.PageClearPageErrorsResult = tOptional(tObject({}));
  scheme.PagePageErrorsParams = tObject({
    filter: tOptional(tType("ConsoleMessagesFilter"))
  });
  scheme.PagePageErrorsResult = tObject({
    errors: tArray(tType("SerializedError"))
  });
  scheme.PagePdfParams = tObject({
    scale: tOptional(tFloat),
    displayHeaderFooter: tOptional(tBoolean),
    headerTemplate: tOptional(tString),
    footerTemplate: tOptional(tString),
    printBackground: tOptional(tBoolean),
    landscape: tOptional(tBoolean),
    pageRanges: tOptional(tString),
    format: tOptional(tString),
    width: tOptional(tString),
    height: tOptional(tString),
    preferCSSPageSize: tOptional(tBoolean),
    margin: tOptional(tObject({
      top: tOptional(tString),
      bottom: tOptional(tString),
      left: tOptional(tString),
      right: tOptional(tString)
    })),
    tagged: tOptional(tBoolean),
    outline: tOptional(tBoolean)
  });
  scheme.PagePdfResult = tObject({
    pdf: tBinary
  });
  scheme.PageRequestsParams = tOptional(tObject({}));
  scheme.PageRequestsResult = tObject({
    requests: tArray(tChannel(["Request"]))
  });
  scheme.PageStartJSCoverageParams = tObject({
    resetOnNavigation: tOptional(tBoolean),
    reportAnonymousScripts: tOptional(tBoolean)
  });
  scheme.PageStartJSCoverageResult = tOptional(tObject({}));
  scheme.PageStopJSCoverageParams = tOptional(tObject({}));
  scheme.PageStopJSCoverageResult = tObject({
    entries: tArray(tObject({
      url: tString,
      scriptId: tString,
      source: tOptional(tString),
      functions: tArray(tObject({
        functionName: tString,
        isBlockCoverage: tBoolean,
        ranges: tArray(tObject({
          startOffset: tInt,
          endOffset: tInt,
          count: tInt
        }))
      }))
    }))
  });
  scheme.PageStartCSSCoverageParams = tObject({
    resetOnNavigation: tOptional(tBoolean)
  });
  scheme.PageStartCSSCoverageResult = tOptional(tObject({}));
  scheme.PageStopCSSCoverageParams = tOptional(tObject({}));
  scheme.PageStopCSSCoverageResult = tObject({
    entries: tArray(tObject({
      url: tString,
      text: tOptional(tString),
      ranges: tArray(tObject({
        start: tInt,
        end: tInt
      }))
    }))
  });
  scheme.PageBringToFrontParams = tOptional(tObject({}));
  scheme.PageBringToFrontResult = tOptional(tObject({}));
  scheme.PagePickLocatorParams = tOptional(tObject({}));
  scheme.PagePickLocatorResult = tObject({
    selector: tString
  });
  scheme.PageCancelPickLocatorParams = tOptional(tObject({}));
  scheme.PageCancelPickLocatorResult = tOptional(tObject({}));
  scheme.PageHideHighlightParams = tOptional(tObject({}));
  scheme.PageHideHighlightResult = tOptional(tObject({}));
  scheme.PageScreencastShowOverlayParams = tObject({
    html: tString,
    duration: tOptional(tFloat)
  });
  scheme.PageScreencastShowOverlayResult = tObject({
    id: tString
  });
  scheme.PageScreencastRemoveOverlayParams = tObject({
    id: tString
  });
  scheme.PageScreencastRemoveOverlayResult = tOptional(tObject({}));
  scheme.PageScreencastChapterParams = tObject({
    title: tString,
    description: tOptional(tString),
    duration: tOptional(tFloat)
  });
  scheme.PageScreencastChapterResult = tOptional(tObject({}));
  scheme.PageScreencastSetOverlayVisibleParams = tObject({
    visible: tBoolean
  });
  scheme.PageScreencastSetOverlayVisibleResult = tOptional(tObject({}));
  scheme.PageScreencastShowActionsParams = tObject({
    duration: tOptional(tFloat),
    position: tOptional(tEnum(["top-left", "top", "top-right", "bottom-left", "bottom", "bottom-right"])),
    fontSize: tOptional(tInt),
    cursor: tOptional(tEnum(["none", "pointer"]))
  });
  scheme.PageScreencastShowActionsResult = tOptional(tObject({}));
  scheme.PageScreencastHideActionsParams = tOptional(tObject({}));
  scheme.PageScreencastHideActionsResult = tOptional(tObject({}));
  scheme.PageScreencastStartParams = tObject({
    size: tOptional(tObject({
      width: tInt,
      height: tInt
    })),
    quality: tOptional(tInt),
    sendFrames: tOptional(tBoolean),
    record: tOptional(tBoolean)
  });
  scheme.PageScreencastStartResult = tObject({
    artifact: tOptional(tChannel(["Artifact"]))
  });
  scheme.PageScreencastStopParams = tOptional(tObject({}));
  scheme.PageScreencastStopResult = tOptional(tObject({}));
  scheme.PageUpdateSubscriptionParams = tObject({
    event: tEnum(["console", "dialog", "fileChooser", "request", "response", "requestFinished", "requestFailed"]),
    enabled: tBoolean
  });
  scheme.PageUpdateSubscriptionResult = tOptional(tObject({}));
  scheme.PageSetDockTileParams = tObject({
    image: tBinary
  });
  scheme.PageSetDockTileResult = tOptional(tObject({}));
  scheme.PageWebStorageItemsParams = tObject({
    kind: tEnum(["local", "session"])
  });
  scheme.PageWebStorageItemsResult = tObject({
    items: tArray(tType("NameValue"))
  });
  scheme.PageWebStorageGetItemParams = tObject({
    kind: tEnum(["local", "session"]),
    name: tString
  });
  scheme.PageWebStorageGetItemResult = tObject({
    value: tOptional(tString)
  });
  scheme.PageWebStorageSetItemParams = tObject({
    kind: tEnum(["local", "session"]),
    name: tString,
    value: tString
  });
  scheme.PageWebStorageSetItemResult = tOptional(tObject({}));
  scheme.PageWebStorageRemoveItemParams = tObject({
    kind: tEnum(["local", "session"]),
    name: tString
  });
  scheme.PageWebStorageRemoveItemResult = tOptional(tObject({}));
  scheme.PageWebStorageClearParams = tObject({
    kind: tEnum(["local", "session"])
  });
  scheme.PageWebStorageClearResult = tOptional(tObject({}));
  scheme.RootInitializer = tOptional(tObject({}));
  scheme.RootInitializeParams = tObject({
    sdkLanguage: tType("SDKLanguage")
  });
  scheme.RootInitializeResult = tObject({
    playwright: tChannel(["Playwright"])
  });
  scheme.PlaywrightInitializer = tObject({
    chromium: tChannel(["BrowserType"]),
    firefox: tChannel(["BrowserType"]),
    webkit: tChannel(["BrowserType"]),
    android: tChannel(["Android"]),
    electron: tChannel(["Electron"]),
    utils: tOptional(tChannel(["LocalUtils"])),
    preLaunchedBrowser: tOptional(tChannel(["Browser"])),
    preConnectedAndroidDevice: tOptional(tChannel(["AndroidDevice"])),
    socksSupport: tOptional(tChannel(["SocksSupport"]))
  });
  scheme.PlaywrightNewRequestParams = tObject({
    baseURL: tOptional(tString),
    userAgent: tOptional(tString),
    ignoreHTTPSErrors: tOptional(tBoolean),
    extraHTTPHeaders: tOptional(tArray(tType("NameValue"))),
    failOnStatusCode: tOptional(tBoolean),
    clientCertificates: tOptional(tArray(tObject({
      origin: tString,
      cert: tOptional(tBinary),
      key: tOptional(tBinary),
      passphrase: tOptional(tString),
      pfx: tOptional(tBinary)
    }))),
    maxRedirects: tOptional(tInt),
    httpCredentials: tOptional(tObject({
      username: tString,
      password: tString,
      origin: tOptional(tString),
      send: tOptional(tEnum(["always", "unauthorized"]))
    })),
    proxy: tOptional(tObject({
      server: tString,
      bypass: tOptional(tString),
      username: tOptional(tString),
      password: tOptional(tString)
    })),
    storageState: tOptional(tObject({
      cookies: tOptional(tArray(tType("NetworkCookie"))),
      origins: tOptional(tArray(tType("SetOriginStorage")))
    })),
    tracesDir: tOptional(tString)
  });
  scheme.PlaywrightNewRequestResult = tObject({
    request: tChannel(["APIRequestContext"])
  });
  scheme.DebugControllerInitializer = tOptional(tObject({}));
  scheme.DebugControllerInspectRequestedEvent = tObject({
    selector: tString,
    locator: tString,
    ariaSnapshot: tString
  });
  scheme.DebugControllerSetModeRequestedEvent = tObject({
    mode: tString
  });
  scheme.DebugControllerStateChangedEvent = tObject({
    pageCount: tInt
  });
  scheme.DebugControllerSourceChangedEvent = tObject({
    text: tString,
    header: tOptional(tString),
    footer: tOptional(tString),
    actions: tOptional(tArray(tString))
  });
  scheme.DebugControllerPausedEvent = tObject({
    paused: tBoolean
  });
  scheme.DebugControllerInitializeParams = tObject({
    codegenId: tString,
    sdkLanguage: tType("SDKLanguage")
  });
  scheme.DebugControllerInitializeResult = tOptional(tObject({}));
  scheme.DebugControllerSetReportStateChangedParams = tObject({
    enabled: tBoolean
  });
  scheme.DebugControllerSetReportStateChangedResult = tOptional(tObject({}));
  scheme.DebugControllerSetRecorderModeParams = tObject({
    mode: tEnum(["inspecting", "recording", "none"]),
    testIdAttributeName: tOptional(tString),
    generateAutoExpect: tOptional(tBoolean)
  });
  scheme.DebugControllerSetRecorderModeResult = tOptional(tObject({}));
  scheme.DebugControllerHighlightParams = tObject({
    selector: tOptional(tString),
    ariaTemplate: tOptional(tString)
  });
  scheme.DebugControllerHighlightResult = tOptional(tObject({}));
  scheme.DebugControllerHideHighlightParams = tOptional(tObject({}));
  scheme.DebugControllerHideHighlightResult = tOptional(tObject({}));
  scheme.DebugControllerResumeParams = tOptional(tObject({}));
  scheme.DebugControllerResumeResult = tOptional(tObject({}));
  scheme.DebugControllerKillParams = tOptional(tObject({}));
  scheme.DebugControllerKillResult = tOptional(tObject({}));
  scheme.SocksSupportInitializer = tOptional(tObject({}));
  scheme.SocksSupportSocksRequestedEvent = tObject({
    uid: tString,
    host: tString,
    port: tInt
  });
  scheme.SocksSupportSocksDataEvent = tObject({
    uid: tString,
    data: tBinary
  });
  scheme.SocksSupportSocksClosedEvent = tObject({
    uid: tString
  });
  scheme.SocksSupportSocksConnectedParams = tObject({
    uid: tString,
    host: tString,
    port: tInt
  });
  scheme.SocksSupportSocksConnectedResult = tOptional(tObject({}));
  scheme.SocksSupportSocksFailedParams = tObject({
    uid: tString,
    errorCode: tString
  });
  scheme.SocksSupportSocksFailedResult = tOptional(tObject({}));
  scheme.SocksSupportSocksDataParams = tObject({
    uid: tString,
    data: tBinary
  });
  scheme.SocksSupportSocksDataResult = tOptional(tObject({}));
  scheme.SocksSupportSocksErrorParams = tObject({
    uid: tString,
    error: tString
  });
  scheme.SocksSupportSocksErrorResult = tOptional(tObject({}));
  scheme.SocksSupportSocksEndParams = tObject({
    uid: tString
  });
  scheme.SocksSupportSocksEndResult = tOptional(tObject({}));
  scheme.JsonPipeInitializer = tOptional(tObject({}));
  scheme.JsonPipeMessageEvent = tObject({
    message: tAny
  });
  scheme.JsonPipeClosedEvent = tObject({
    reason: tOptional(tString)
  });
  scheme.JsonPipeSendParams = tObject({
    message: tAny
  });
  scheme.JsonPipeSendResult = tOptional(tObject({}));
  scheme.JsonPipeCloseParams = tOptional(tObject({}));
  scheme.JsonPipeCloseResult = tOptional(tObject({}));
  scheme.ExpectedTextValue = tObject({
    string: tOptional(tString),
    regexSource: tOptional(tString),
    regexFlags: tOptional(tString),
    matchSubstring: tOptional(tBoolean),
    ignoreCase: tOptional(tBoolean),
    normalizeWhiteSpace: tOptional(tBoolean)
  });
  scheme.SelectorEngine = tObject({
    name: tString,
    source: tString,
    contentScript: tOptional(tBoolean)
  });
  scheme.FormField = tObject({
    name: tString,
    value: tOptional(tString),
    file: tOptional(tObject({
      name: tString,
      mimeType: tOptional(tString),
      buffer: tBinary
    }))
  });
  scheme.LifecycleEvent = tEnum(["load", "domcontentloaded", "networkidle", "commit"]);
  scheme.ConsoleMessagesFilter = tEnum(["all", "since-navigation"]);
  scheme.RecorderSource = tObject({
    isRecorded: tBoolean,
    id: tString,
    label: tString,
    text: tString,
    language: tString,
    highlight: tArray(tObject({
      line: tInt,
      type: tString
    })),
    revealLine: tOptional(tInt),
    group: tOptional(tString)
  });
  scheme.IndexedDBDatabase = tObject({
    name: tString,
    version: tInt,
    stores: tArray(tObject({
      name: tString,
      autoIncrement: tBoolean,
      keyPath: tOptional(tString),
      keyPathArray: tOptional(tArray(tString)),
      records: tArray(tObject({
        key: tOptional(tAny),
        keyEncoded: tOptional(tAny),
        value: tOptional(tAny),
        valueEncoded: tOptional(tAny)
      })),
      indexes: tArray(tObject({
        name: tString,
        keyPath: tOptional(tString),
        keyPathArray: tOptional(tArray(tString)),
        multiEntry: tBoolean,
        unique: tBoolean
      }))
    }))
  });
  scheme.SetOriginStorage = tObject({
    origin: tString,
    localStorage: tArray(tType("NameValue")),
    indexedDB: tOptional(tArray(tType("IndexedDBDatabase")))
  });
  scheme.OriginStorage = tObject({
    origin: tString,
    localStorage: tArray(tType("NameValue")),
    indexedDB: tOptional(tArray(tType("IndexedDBDatabase")))
  });
  scheme.RecordHarOptions = tObject({
    content: tOptional(tEnum(["embed", "attach", "omit"])),
    mode: tOptional(tEnum(["full", "minimal"])),
    urlGlob: tOptional(tString),
    urlRegexSource: tOptional(tString),
    urlRegexFlags: tOptional(tString),
    harPath: tOptional(tString),
    resourcesDir: tOptional(tString)
  });
  scheme.CDPSessionInitializer = tOptional(tObject({}));
  scheme.CDPSessionEventEvent = tObject({
    method: tString,
    params: tOptional(tAny)
  });
  scheme.CDPSessionCloseEvent = tOptional(tObject({}));
  scheme.CDPSessionSendParams = tObject({
    method: tString,
    params: tOptional(tAny)
  });
  scheme.CDPSessionSendResult = tObject({
    result: tAny
  });
  scheme.CDPSessionDetachParams = tOptional(tObject({}));
  scheme.CDPSessionDetachResult = tOptional(tObject({}));
  scheme.BindingCallInitializer = tObject({
    frame: tChannel(["Frame"]),
    name: tString,
    args: tArray(tType("SerializedValue"))
  });
  scheme.BindingCallRejectParams = tObject({
    error: tType("SerializedError")
  });
  scheme.BindingCallRejectResult = tOptional(tObject({}));
  scheme.BindingCallResolveParams = tObject({
    result: tType("SerializedArgument")
  });
  scheme.BindingCallResolveResult = tOptional(tObject({}));
  scheme.DebuggerInitializer = tOptional(tObject({}));
  scheme.DebuggerPausedStateChangedEvent = tObject({
    pausedDetails: tOptional(tObject({
      location: tObject({
        file: tString,
        line: tOptional(tInt),
        column: tOptional(tInt)
      }),
      title: tString,
      stack: tOptional(tString)
    }))
  });
  scheme.DebuggerRequestPauseParams = tOptional(tObject({}));
  scheme.DebuggerRequestPauseResult = tOptional(tObject({}));
  scheme.DebuggerResumeParams = tOptional(tObject({}));
  scheme.DebuggerResumeResult = tOptional(tObject({}));
  scheme.DebuggerNextParams = tOptional(tObject({}));
  scheme.DebuggerNextResult = tOptional(tObject({}));
  scheme.DebuggerRunToParams = tObject({
    location: tObject({
      file: tString,
      line: tOptional(tInt),
      column: tOptional(tInt)
    })
  });
  scheme.DebuggerRunToResult = tOptional(tObject({}));
  scheme.DialogInitializer = tObject({
    page: tOptional(tChannel(["Page"])),
    type: tString,
    message: tString,
    defaultValue: tString
  });
  scheme.DialogAcceptParams = tObject({
    promptText: tOptional(tString)
  });
  scheme.DialogAcceptResult = tOptional(tObject({}));
  scheme.DialogDismissParams = tOptional(tObject({}));
  scheme.DialogDismissResult = tOptional(tObject({}));
  scheme.SerializedValue = tObject({
    n: tOptional(tFloat),
    b: tOptional(tBoolean),
    s: tOptional(tString),
    v: tOptional(tEnum(["null", "undefined", "NaN", "Infinity", "-Infinity", "-0"])),
    d: tOptional(tString),
    u: tOptional(tString),
    bi: tOptional(tString),
    ta: tOptional(tObject({
      b: tBinary,
      k: tEnum(["i8", "ui8", "ui8c", "i16", "ui16", "i32", "ui32", "f32", "f64", "bi64", "bui64"])
    })),
    e: tOptional(tObject({
      m: tString,
      n: tString,
      s: tString
    })),
    r: tOptional(tObject({
      p: tString,
      f: tString
    })),
    a: tOptional(tArray(tType("SerializedValue"))),
    o: tOptional(tArray(tObject({
      k: tString,
      v: tType("SerializedValue")
    }))),
    h: tOptional(tInt),
    id: tOptional(tInt),
    ref: tOptional(tInt)
  });
  scheme.SerializedArgument = tObject({
    value: tType("SerializedValue"),
    handles: tArray(tChannel("*"))
  });
  scheme.SerializedError = tObject({
    error: tOptional(tObject({
      message: tString,
      name: tString,
      stack: tOptional(tString)
    })),
    value: tOptional(tType("SerializedValue"))
  });
  scheme.StackFrame = tObject({
    file: tString,
    line: tInt,
    column: tInt,
    function: tOptional(tString)
  });
  scheme.VirtualCredential = tObject({
    id: tString,
    rpId: tString,
    userHandle: tString,
    privateKey: tString,
    publicKey: tString
  });
  scheme.Point = tObject({
    x: tFloat,
    y: tFloat
  });
  scheme.Rect = tObject({
    x: tFloat,
    y: tFloat,
    width: tFloat,
    height: tFloat
  });
  scheme.URLPattern = tObject({
    hash: tString,
    hostname: tString,
    password: tString,
    pathname: tString,
    port: tString,
    protocol: tString,
    search: tString,
    username: tString
  });
  scheme.NameValue = tObject({
    name: tString,
    value: tString
  });
  scheme.TracingInitializer = tOptional(tObject({}));
  scheme.TracingTracingStartParams = tObject({
    name: tOptional(tString),
    snapshots: tOptional(tBoolean),
    screenshots: tOptional(tBoolean),
    live: tOptional(tBoolean)
  });
  scheme.TracingTracingStartResult = tOptional(tObject({}));
  scheme.TracingTracingStartChunkParams = tObject({
    name: tOptional(tString),
    title: tOptional(tString)
  });
  scheme.TracingTracingStartChunkResult = tObject({
    traceName: tString
  });
  scheme.TracingTracingGroupParams = tObject({
    name: tString,
    location: tOptional(tObject({
      file: tString,
      line: tOptional(tInt),
      column: tOptional(tInt)
    }))
  });
  scheme.TracingTracingGroupResult = tOptional(tObject({}));
  scheme.TracingTracingGroupEndParams = tOptional(tObject({}));
  scheme.TracingTracingGroupEndResult = tOptional(tObject({}));
  scheme.TracingTracingStopChunkParams = tObject({
    mode: tEnum(["archive", "discard", "entries"])
  });
  scheme.TracingTracingStopChunkResult = tObject({
    artifact: tOptional(tChannel(["Artifact"])),
    entries: tOptional(tArray(tType("NameValue")))
  });
  scheme.TracingTracingStopParams = tOptional(tObject({}));
  scheme.TracingTracingStopResult = tOptional(tObject({}));
  scheme.TracingHarStartParams = tObject({
    page: tOptional(tChannel(["Page"])),
    options: tType("RecordHarOptions")
  });
  scheme.TracingHarStartResult = tObject({
    harId: tString
  });
  scheme.TracingHarExportParams = tObject({
    harId: tOptional(tString),
    mode: tEnum(["archive", "entries"])
  });
  scheme.TracingHarExportResult = tObject({
    artifact: tOptional(tChannel(["Artifact"])),
    entries: tOptional(tArray(tType("NameValue")))
  });
  scheme.WorkerInitializer = tObject({
    url: tString
  });
  scheme.WorkerConsoleEvent = tObject({
    type: tString,
    text: tString,
    args: tArray(tChannel(["ElementHandle", "JSHandle"])),
    location: tObject({
      url: tString,
      lineNumber: tInt,
      columnNumber: tInt
    }),
    timestamp: tFloat
  });
  scheme.WorkerCloseEvent = tOptional(tObject({}));
  scheme.WorkerDisconnectParams = tObject({
    reason: tOptional(tString)
  });
  scheme.WorkerDisconnectResult = tOptional(tObject({}));
  scheme.WorkerEvaluateExpressionParams = tObject({
    expression: tString,
    isFunction: tOptional(tBoolean),
    arg: tType("SerializedArgument")
  });
  scheme.WorkerEvaluateExpressionResult = tObject({
    value: tType("SerializedValue")
  });
  scheme.WorkerEvaluateExpressionHandleParams = tObject({
    expression: tString,
    isFunction: tOptional(tBoolean),
    arg: tType("SerializedArgument")
  });
  scheme.WorkerEvaluateExpressionHandleResult = tObject({
    handle: tChannel(["ElementHandle", "JSHandle"])
  });
  scheme.WorkerUpdateSubscriptionParams = tObject({
    event: tEnum(["console"]),
    enabled: tBoolean
  });
  scheme.WorkerUpdateSubscriptionResult = tOptional(tObject({}));

  // src/browser/run/playwright-client/vendor/client/clientStackTrace.ts
  function captureLibraryStackTrace(platform) {
    const stack = captureRawStack();
    let parsedFrames = stack.map((line) => {
      const frame = parseStackFrame(line, platform.pathSeparator, platform.showInternalStackFrames());
      if (!frame || !frame.file)
        return null;
      const isPlaywrightLibrary = !!platform.coreDir && frame.file.startsWith(platform.coreDir);
      const parsed = {
        frame,
        frameText: line,
        isPlaywrightLibrary
      };
      return parsed;
    }).filter(Boolean);
    let apiName = "";
    for (let i = 0; i < parsedFrames.length - 1; i++) {
      const parsedFrame = parsedFrames[i];
      if (parsedFrame.isPlaywrightLibrary && !parsedFrames[i + 1].isPlaywrightLibrary) {
        apiName = apiName || normalizeAPIName(parsedFrame.frame.function);
        break;
      }
    }
    function normalizeAPIName(name) {
      if (!name)
        return "";
      const match = name.match(/(API|JS|CDP|[A-Z])([^\d]+)\d?\.(.*)/);
      if (!match)
        return name;
      return match[1].toLowerCase() + match[2] + "." + match[3];
    }
    const filterPrefixes = platform.boxedStackPrefixes();
    parsedFrames = parsedFrames.filter((f) => {
      if (filterPrefixes.some((prefix) => f.frame.file.startsWith(prefix)))
        return false;
      return true;
    });
    return {
      frames: parsedFrames.map((p) => p.frame),
      apiName
    };
  }

  // src/browser/run/playwright-client/vendor/client/channelOwner.ts
  var ChannelOwner = class _ChannelOwner extends EventEmitter {
    _connection;
    _parent;
    _objects = /* @__PURE__ */ new Map();
    _type;
    _guid;
    _channel;
    _initializer;
    _logger;
    _instrumentation;
    _eventToSubscriptionMapping = /* @__PURE__ */ new Map();
    _wasCollected = false;
    constructor(parent, type, guid, initializer) {
      const connection = parent instanceof _ChannelOwner ? parent._connection : parent;
      super(connection._platform);
      this.setMaxListeners(0);
      this._connection = connection;
      this._type = type;
      this._guid = guid;
      this._parent = parent instanceof _ChannelOwner ? parent : void 0;
      this._instrumentation = this._connection._instrumentation;
      this._connection._objects.set(guid, this);
      if (this._parent) {
        this._parent._objects.set(guid, this);
        this._logger = this._parent._logger;
      }
      this._channel = this._createChannel(new EventEmitter(connection._platform));
      this._initializer = initializer;
    }
    _setEventToSubscriptionMapping(mapping) {
      this._eventToSubscriptionMapping = mapping;
    }
    _updateSubscription(event, enabled) {
      const protocolEvent = this._eventToSubscriptionMapping.get(String(event));
      if (protocolEvent)
        this._channel.updateSubscription({ event: protocolEvent, enabled }).catch(() => {
        });
    }
    on(event, listener) {
      if (!this.listenerCount(event))
        this._updateSubscription(event, true);
      super.on(event, listener);
      return this;
    }
    addListener(event, listener) {
      if (!this.listenerCount(event))
        this._updateSubscription(event, true);
      super.addListener(event, listener);
      return this;
    }
    prependListener(event, listener) {
      if (!this.listenerCount(event))
        this._updateSubscription(event, true);
      super.prependListener(event, listener);
      return this;
    }
    off(event, listener) {
      super.off(event, listener);
      if (!this.listenerCount(event))
        this._updateSubscription(event, false);
      return this;
    }
    removeListener(event, listener) {
      super.removeListener(event, listener);
      if (!this.listenerCount(event))
        this._updateSubscription(event, false);
      return this;
    }
    _adopt(child) {
      child._parent._objects.delete(child._guid);
      this._objects.set(child._guid, child);
      child._parent = this;
    }
    _dispose(reason) {
      if (this._parent)
        this._parent._objects.delete(this._guid);
      this._connection._objects.delete(this._guid);
      this._wasCollected = reason === "gc";
      for (const object of [...this._objects.values()])
        object._dispose(reason);
      this._objects.clear();
    }
    _debugScopeState() {
      return {
        _guid: this._guid,
        objects: Array.from(this._objects.values()).map((o) => o._debugScopeState())
      };
    }
    _validatorToWireContext() {
      return {
        tChannelImpl: tChannelImplToWire,
        binary: this._connection.rawBuffers() ? "buffer" : "toBase64",
        isUnderTest: () => this._platform.isUnderTest()
      };
    }
    _createChannel(base) {
      const channel = new Proxy(base, {
        get: (obj, prop) => {
          if (typeof prop === "string") {
            const validator = maybeFindValidator(this._type, prop, "Params");
            const { internal } = getMetainfo({ type: this._type, method: prop }) || {};
            if (validator) {
              return async (params) => {
                return await this._wrapApiCall(async (apiZone) => {
                  const validatedParams = validator(params, "", this._validatorToWireContext());
                  if (!apiZone.internal && !apiZone.reported) {
                    apiZone.reported = true;
                    this._instrumentation.onApiCallBegin(apiZone, { type: this._type, method: prop, params });
                    logApiCall(this._platform, this._logger, `=> ${apiZone.apiName} started`);
                    return await this._connection.sendMessageToServer(this, prop, validatedParams, apiZone);
                  }
                  return await this._connection.sendMessageToServer(this, prop, validatedParams, { internal: true });
                }, { internal });
              };
            }
          }
          return obj[prop];
        }
      });
      channel._object = this;
      return channel;
    }
    async _wrapApiCall(func, options) {
      const logger = this._logger;
      const existingApiZone = this._platform.zones.current().data();
      if (existingApiZone)
        return await func(existingApiZone);
      const stackTrace = captureLibraryStackTrace(this._platform);
      const apiZone = { title: options?.title, apiName: stackTrace.apiName, frames: stackTrace.frames, internal: options?.internal ?? false, reported: false, userData: void 0, stepId: void 0 };
      try {
        const result = await this._platform.zones.current().push(apiZone).run(async () => await func(apiZone));
        if (!options?.internal) {
          logApiCall(this._platform, logger, `<= ${apiZone.apiName} succeeded`);
          this._instrumentation.onApiCallEnd(apiZone);
        }
        return result;
      } catch (e) {
        const innerError = (this._platform.showInternalStackFrames() || this._platform.isUnderTest()) && e.stack ? "\n<inner error>\n" + e.stack : "";
        if (apiZone.apiName && !apiZone.apiName.includes("<anonymous>"))
          e.message = apiZone.apiName + ": " + e.message;
        const stackFrames = "\n" + stringifyStackFrames(stackTrace.frames).join("\n") + innerError;
        if (stackFrames.trim())
          e.stack = e.message + stackFrames;
        else
          e.stack = "";
        if (!options?.internal) {
          apiZone.error = e;
          logApiCall(this._platform, logger, `<= ${apiZone.apiName} failed`);
          this._instrumentation.onApiCallEnd(apiZone);
        }
        throw e;
      }
    }
    toJSON() {
      return {
        _type: this._type,
        _guid: this._guid
      };
    }
  };
  function logApiCall(platform, logger, message) {
    if (logger && logger.isEnabled("api", "info"))
      logger.log("api", "info", message, [], { color: "cyan" });
    platform.log("api", message);
  }
  function tChannelImplToWire(names, arg, path, context) {
    if (arg._object instanceof ChannelOwner && (names === "*" || names.includes(arg._object._type)))
      return { guid: arg._object._guid };
    throw new ValidationError(`${path}: expected channel ${names.toString()}`);
  }

  // src/browser/run/playwright-client/vendor/client/cdpSession.ts
  var CDPSession = class extends ChannelOwner {
    static from(cdpSession) {
      return cdpSession._object;
    }
    constructor(parent, type, guid, initializer) {
      super(parent, type, guid, initializer);
      this._channel.on("event", (event) => {
        this.emit(event.method, event.params);
        this.emit("event", event);
      });
      this._channel.on("close", () => {
        this.emit("close", this);
      });
      this.on = super.on;
      this.addListener = super.addListener;
      this.off = super.removeListener;
      this.removeListener = super.removeListener;
      this.once = super.once;
    }
    async send(method, params) {
      const result = await this._channel.send({ method, params });
      return result.result;
    }
    async detach() {
      return await this._channel.detach();
    }
  };

  // src/browser/run/playwright-client/vendor/client/clientHelper.ts
  function envObjectToArray(env) {
    const result = [];
    for (const name in env) {
      if (!Object.is(env[name], void 0))
        result.push({ name, value: String(env[name]) });
    }
    return result;
  }
  async function evaluationScript(platform, fun, arg, addSourceUrl = true) {
    if (typeof fun === "function") {
      const source = fun.toString();
      const argString = Object.is(arg, void 0) ? "undefined" : JSON.stringify(arg);
      return `(${source})(${argString})`;
    }
    if (arg !== void 0)
      throw new Error("Cannot evaluate a string with arguments");
    if (isString(fun))
      return fun;
    if (fun.content !== void 0)
      return fun.content;
    if (fun.path !== void 0) {
      let source = await platform.fs().promises.readFile(fun.path, "utf8");
      if (addSourceUrl)
        source = addSourceUrlToScript(source, fun.path);
      return source;
    }
    throw new Error("Either path or content property must be present");
  }
  function addSourceUrlToScript(source, path) {
    return `${source}
//# sourceURL=${path.replace(/\n/g, "")}`;
  }

  // src/browser/run/playwright-client/vendor/client/clock.ts
  var Clock = class {
    _browserContext;
    constructor(browserContext) {
      this._browserContext = browserContext;
    }
    async install(options = {}) {
      await this._browserContext._channel.clockInstall(options.time !== void 0 ? parseTime(options.time) : {});
    }
    async fastForward(ticks) {
      await this._browserContext._channel.clockFastForward(parseTicks(ticks));
    }
    async pauseAt(time) {
      await this._browserContext._channel.clockPauseAt(parseTime(time));
    }
    async resume() {
      await this._browserContext._channel.clockResume({});
    }
    async runFor(ticks) {
      await this._browserContext._channel.clockRunFor(parseTicks(ticks));
    }
    async setFixedTime(time) {
      await this._browserContext._channel.clockSetFixedTime(parseTime(time));
    }
    async setSystemTime(time) {
      await this._browserContext._channel.clockSetSystemTime(parseTime(time));
    }
  };
  function parseTime(time) {
    if (typeof time === "number")
      return { timeNumber: time };
    if (typeof time === "string")
      return { timeString: time };
    if (!isFinite(time.getTime()))
      throw new Error(`Invalid date: ${time}`);
    return { timeNumber: time.getTime() };
  }
  function parseTicks(ticks) {
    return {
      ticksNumber: typeof ticks === "number" ? ticks : void 0,
      ticksString: typeof ticks === "string" ? ticks : void 0
    };
  }

  // src/browser/run/playwright-client/vendor/protocol/serializers.ts
  function parseSerializedValue(value, handles) {
    return innerParseSerializedValue(value, handles, /* @__PURE__ */ new Map(), []);
  }
  function innerParseSerializedValue(value, handles, refs, accessChain) {
    if (value.ref !== void 0)
      return refs.get(value.ref);
    if (value.n !== void 0)
      return value.n;
    if (value.s !== void 0)
      return value.s;
    if (value.b !== void 0)
      return value.b;
    if (value.v !== void 0) {
      if (value.v === "undefined")
        return void 0;
      if (value.v === "null")
        return null;
      if (value.v === "NaN")
        return NaN;
      if (value.v === "Infinity")
        return Infinity;
      if (value.v === "-Infinity")
        return -Infinity;
      if (value.v === "-0")
        return -0;
    }
    if (value.d !== void 0)
      return new Date(value.d);
    if (value.u !== void 0)
      return new URL(value.u);
    if (value.bi !== void 0)
      return BigInt(value.bi);
    if (value.e !== void 0) {
      const error = new Error(value.e.m);
      error.name = value.e.n;
      error.stack = value.e.s;
      return error;
    }
    if (value.r !== void 0)
      return new RegExp(value.r.p, value.r.f);
    if (value.ta !== void 0) {
      const ctor = typedArrayKindToConstructor[value.ta.k];
      return new ctor(value.ta.b.buffer, value.ta.b.byteOffset, value.ta.b.length / ctor.BYTES_PER_ELEMENT);
    }
    if (value.a !== void 0) {
      const result = [];
      refs.set(value.id, result);
      for (let i = 0; i < value.a.length; i++)
        result.push(innerParseSerializedValue(value.a[i], handles, refs, [...accessChain, i]));
      return result;
    }
    if (value.o !== void 0) {
      const result = {};
      refs.set(value.id, result);
      for (const { k, v } of value.o)
        result[k] = innerParseSerializedValue(v, handles, refs, [...accessChain, k]);
      return result;
    }
    if (value.h !== void 0) {
      if (handles === void 0)
        throw new Error("Unexpected handle");
      return handles[value.h];
    }
    throw new Error(`Attempting to deserialize unexpected value${accessChainToDisplayString(accessChain)}: ${value}`);
  }
  function serializeValue(value, handleSerializer) {
    return innerSerializeValue(value, handleSerializer, { lastId: 0, visited: /* @__PURE__ */ new Map() }, []);
  }
  function innerSerializeValue(value, handleSerializer, visitorInfo, accessChain) {
    const handle = handleSerializer(value);
    if ("fallThrough" in handle)
      value = handle.fallThrough;
    else
      return handle;
    if (typeof value === "symbol")
      return { v: "undefined" };
    if (Object.is(value, void 0))
      return { v: "undefined" };
    if (Object.is(value, null))
      return { v: "null" };
    if (Object.is(value, NaN))
      return { v: "NaN" };
    if (Object.is(value, Infinity))
      return { v: "Infinity" };
    if (Object.is(value, -Infinity))
      return { v: "-Infinity" };
    if (Object.is(value, -0))
      return { v: "-0" };
    if (typeof value === "boolean")
      return { b: value };
    if (typeof value === "number")
      return { n: value };
    if (typeof value === "string")
      return { s: value };
    if (typeof value === "bigint")
      return { bi: value.toString() };
    if (isError2(value))
      return { e: { n: value.name, m: value.message, s: value.stack || "" } };
    if (isDate(value))
      return { d: value.toJSON() };
    if (isURL(value))
      return { u: value.toJSON() };
    if (isRegExp3(value))
      return { r: { p: value.source, f: value.flags } };
    const typedArrayKind = constructorToTypedArrayKind.get(value.constructor);
    if (typedArrayKind)
      return { ta: { b: new Uint8Array(value.buffer, value.byteOffset, value.byteLength), k: typedArrayKind } };
    const id = visitorInfo.visited.get(value);
    if (id)
      return { ref: id };
    if (Array.isArray(value)) {
      const a = [];
      const id2 = ++visitorInfo.lastId;
      visitorInfo.visited.set(value, id2);
      for (let i = 0; i < value.length; ++i)
        a.push(innerSerializeValue(value[i], handleSerializer, visitorInfo, [...accessChain, i]));
      return { a, id: id2 };
    }
    if (typeof value === "object") {
      const o = [];
      const id2 = ++visitorInfo.lastId;
      visitorInfo.visited.set(value, id2);
      for (const name of Object.keys(value))
        o.push({ k: name, v: innerSerializeValue(value[name], handleSerializer, visitorInfo, [...accessChain, name]) });
      return { o, id: id2 };
    }
    throw new Error(`Attempting to serialize unexpected value${accessChainToDisplayString(accessChain)}: ${value}`);
  }
  function accessChainToDisplayString(accessChain) {
    const chainString = accessChain.map((accessor, i) => {
      if (typeof accessor === "string")
        return i ? `.${accessor}` : accessor;
      return `[${accessor}]`;
    }).join("");
    return chainString.length > 0 ? ` at position "${chainString}"` : "";
  }
  function isRegExp3(obj) {
    return obj instanceof RegExp || Object.prototype.toString.call(obj) === "[object RegExp]";
  }
  function isDate(obj) {
    return obj instanceof Date || Object.prototype.toString.call(obj) === "[object Date]";
  }
  function isURL(obj) {
    return typeof URL !== "undefined" && obj instanceof URL || Object.prototype.toString.call(obj) === "[object URL]";
  }
  function isError2(obj) {
    const proto = obj ? Object.getPrototypeOf(obj) : null;
    return obj instanceof Error || proto?.name === "Error" || proto && isError2(proto);
  }
  var typedArrayKindToConstructor = {
    i8: Int8Array,
    ui8: Uint8Array,
    ui8c: Uint8ClampedArray,
    i16: Int16Array,
    ui16: Uint16Array,
    i32: Int32Array,
    ui32: Uint32Array,
    f32: Float32Array,
    f64: Float64Array,
    bi64: BigInt64Array,
    bui64: BigUint64Array
  };
  var constructorToTypedArrayKind = new Map(Object.entries(typedArrayKindToConstructor).map(([k, v]) => [v, k]));

  // src/browser/run/playwright-client/vendor/client/errors.ts
  var PlaywrightError = class extends Error {
    log = [];
    details;
    // As declared in the protocol.
  };
  var TimeoutError = class extends PlaywrightError {
    constructor(message) {
      super(message);
      this.name = "TimeoutError";
    }
  };
  var TargetClosedError = class extends PlaywrightError {
    constructor(cause) {
      super(cause || "Target page, context or browser has been closed");
    }
  };
  function isTargetClosedError(error) {
    return error instanceof TargetClosedError;
  }
  function serializeError(e) {
    if (isError(e))
      return { error: { message: e.message, stack: e.stack, name: e.name } };
    return { value: serializeValue(e, (value) => ({ fallThrough: value })) };
  }
  function parseError(error) {
    if (!error.error) {
      if (error.value === void 0)
        throw new Error("Serialized error must have either an error or a value");
      return parseSerializedValue(error.value, void 0);
    }
    let e;
    if (error.error.name === "TimeoutError")
      e = new TimeoutError(error.error.message);
    else if (error.error.name === "TargetClosedError")
      e = new TargetClosedError(error.error.message);
    else
      e = Object.assign(new PlaywrightError(error.error.message), { name: error.error.name });
    e.stack = error.error.stack || "";
    return e;
  }

  // src/browser/run/playwright-client/vendor/client/jsHandle.ts
  var JSHandle = class _JSHandle extends ChannelOwner {
    _preview;
    static from(handle) {
      return handle._object;
    }
    constructor(parent, type, guid, initializer) {
      super(parent, type, guid, initializer);
      this._preview = this._initializer.preview;
      this._channel.on("previewUpdated", ({ preview }) => this._preview = preview);
    }
    async evaluate(pageFunction, arg) {
      const result = await this._channel.evaluateExpression({ expression: String(pageFunction), isFunction: typeof pageFunction === "function", arg: serializeArgument(arg) });
      return parseResult(result.value);
    }
    async evaluateHandle(pageFunction, arg) {
      const result = await this._channel.evaluateExpressionHandle({ expression: String(pageFunction), isFunction: typeof pageFunction === "function", arg: serializeArgument(arg) });
      return _JSHandle.from(result.handle);
    }
    async getProperty(propertyName) {
      const result = await this._channel.getProperty({ name: propertyName });
      return _JSHandle.from(result.handle);
    }
    async getProperties() {
      const map = /* @__PURE__ */ new Map();
      for (const { name, value } of (await this._channel.getPropertyList()).properties)
        map.set(name, _JSHandle.from(value));
      return map;
    }
    async jsonValue() {
      return parseResult((await this._channel.jsonValue()).value);
    }
    asElement() {
      return null;
    }
    async [Symbol.asyncDispose]() {
      await this.dispose();
    }
    async dispose() {
      try {
        await this._channel.dispose();
      } catch (e) {
        if (isTargetClosedError(e))
          return;
        throw e;
      }
    }
    toString() {
      return this._preview;
    }
  };
  function serializeArgument(arg) {
    const handles = [];
    const pushHandle = (channel) => {
      handles.push(channel);
      return handles.length - 1;
    };
    const value = serializeValue(arg, (value2) => {
      if (value2 instanceof JSHandle)
        return { h: pushHandle(value2._channel) };
      return { fallThrough: value2 };
    });
    return { value, handles };
  }
  function parseResult(value) {
    return parseSerializedValue(value, void 0);
  }
  function assertMaxArguments(count, max) {
    if (count > max)
      throw new Error("Too many arguments. If you need to pass more than 1 argument to the function wrap them in an object.");
  }

  // src/browser/run/playwright-client/vendor/client/consoleMessage.ts
  var ConsoleMessage = class {
    _page;
    _worker;
    _event;
    constructor(platform, event, page, worker) {
      this._page = page;
      this._worker = worker;
      this._event = event;
      if (platform.inspectCustom)
        this[platform.inspectCustom] = () => this._inspect();
    }
    worker() {
      return this._worker;
    }
    page() {
      return this._page;
    }
    type() {
      return this._event.type;
    }
    text() {
      return this._event.text;
    }
    args() {
      return this._event.args.map(JSHandle.from);
    }
    location() {
      const { url, lineNumber, columnNumber } = this._event.location;
      return { url, line: lineNumber, column: columnNumber, lineNumber, columnNumber };
    }
    timestamp() {
      return this._event.timestamp;
    }
    _inspect() {
      return this.text();
    }
  };

  // src/browser/run/playwright-client/vendor/client/credentials.ts
  var Credentials = class {
    _browserContext;
    constructor(browserContext) {
      this._browserContext = browserContext;
    }
    async install() {
      await this._browserContext._channel.credentialsInstall({});
    }
    async create(rpId, options = {}) {
      const { credential } = await this._browserContext._channel.credentialsCreate({ ...options, rpId });
      return credential;
    }
    async get(options = {}) {
      const { credentials } = await this._browserContext._channel.credentialsGet(options);
      return credentials;
    }
    async delete(id) {
      await this._browserContext._channel.credentialsDelete({ id });
    }
  };

  // src/browser/run/playwright-client/vendor/client/events.ts
  var Events = {
    AndroidDevice: {
      WebView: "webview",
      Close: "close"
    },
    AndroidSocket: {
      Data: "data",
      Close: "close"
    },
    AndroidWebView: {
      Close: "close"
    },
    Browser: {
      Context: "context",
      Disconnected: "disconnected"
    },
    Debugger: {
      PausedStateChanged: "pausedstatechanged"
    },
    BrowserContext: {
      Console: "console",
      Close: "close",
      Dialog: "dialog",
      Download: "download",
      FrameAttached: "frameattached",
      FrameDetached: "framedetached",
      FrameNavigated: "framenavigated",
      Page: "page",
      PageClose: "pageclose",
      PageLoad: "pageload",
      // Can't use just 'error' due to node.js special treatment of error events.
      // @see https://nodejs.org/api/events.html#events_error_events
      WebError: "weberror",
      BackgroundPage: "backgroundpage",
      // Deprecated in v1.56, never emitted anymore.
      ServiceWorker: "serviceworker",
      Request: "request",
      Response: "response",
      RequestFailed: "requestfailed",
      RequestFinished: "requestfinished"
    },
    BrowserServer: {
      Close: "close"
    },
    Page: {
      Close: "close",
      Crash: "crash",
      Console: "console",
      Dialog: "dialog",
      Download: "download",
      FileChooser: "filechooser",
      DOMContentLoaded: "domcontentloaded",
      // Can't use just 'error' due to node.js special treatment of error events.
      // @see https://nodejs.org/api/events.html#events_error_events
      PageError: "pageerror",
      Request: "request",
      Response: "response",
      RequestFailed: "requestfailed",
      RequestFinished: "requestfinished",
      FrameAttached: "frameattached",
      FrameDetached: "framedetached",
      FrameNavigated: "framenavigated",
      Load: "load",
      Popup: "popup",
      WebSocket: "websocket",
      Worker: "worker"
    },
    WebSocket: {
      Close: "close",
      Error: "socketerror",
      FrameReceived: "framereceived",
      FrameSent: "framesent"
    },
    Worker: {
      Close: "close",
      Console: "console"
    },
    ElectronApplication: {
      Close: "close",
      Console: "console",
      Window: "window"
    }
  };

  // src/browser/run/playwright-client/vendor/client/debugger.ts
  var Debugger = class extends ChannelOwner {
    _pausedDetails = null;
    static from(channel) {
      return channel._object;
    }
    constructor(parent, type, guid, initializer) {
      super(parent, type, guid, initializer);
      this._channel.on("pausedStateChanged", ({ pausedDetails }) => {
        this._pausedDetails = pausedDetails ?? null;
        this.emit(Events.Debugger.PausedStateChanged);
      });
    }
    async requestPause() {
      await this._channel.requestPause();
    }
    async resume() {
      await this._channel.resume();
    }
    async next() {
      await this._channel.next();
    }
    async runTo(location) {
      await this._channel.runTo({ location });
    }
    pausedDetails() {
      return this._pausedDetails;
    }
  };

  // src/browser/run/playwright-client/vendor/isomorphic/assert.ts
  function assert(value, message) {
    if (!value)
      throw new Error(message || "Assertion error");
  }

  // src/browser/run/playwright-client/vendor/isomorphic/manualPromise.ts
  var ManualPromise = class extends Promise {
    _resolve;
    _reject;
    _isDone;
    constructor() {
      let resolve;
      let reject;
      super((f, r) => {
        resolve = f;
        reject = r;
      });
      this._isDone = false;
      this._resolve = resolve;
      this._reject = reject;
    }
    isDone() {
      return this._isDone;
    }
    resolve(t) {
      this._isDone = true;
      this._resolve(t);
    }
    reject(e) {
      this._isDone = true;
      this._reject(e);
    }
    static get [Symbol.species]() {
      return Promise;
    }
    get [Symbol.toStringTag]() {
      return "ManualPromise";
    }
  };
  var LongStandingScope = class {
    _terminateError;
    _closeError;
    _terminatePromises = /* @__PURE__ */ new Map();
    _isClosed = false;
    reject(error) {
      this._isClosed = true;
      this._terminateError = error;
      for (const p of this._terminatePromises.keys())
        p.resolve(error);
    }
    close(error) {
      this._isClosed = true;
      this._closeError = error;
      for (const [p, frames] of this._terminatePromises)
        p.resolve(cloneError(error, frames));
    }
    isClosed() {
      return this._isClosed;
    }
    static async raceMultiple(scopes, promise) {
      return Promise.race(scopes.map((s) => s.race(promise)));
    }
    async race(promise) {
      return this._race(Array.isArray(promise) ? promise : [promise], false);
    }
    async safeRace(promise, defaultValue) {
      return this._race([promise], true, defaultValue);
    }
    async _race(promises, safe, defaultValue) {
      const terminatePromise = new ManualPromise();
      const frames = captureRawStack();
      if (this._terminateError)
        terminatePromise.resolve(this._terminateError);
      if (this._closeError)
        terminatePromise.resolve(cloneError(this._closeError, frames));
      this._terminatePromises.set(terminatePromise, frames);
      try {
        return await Promise.race([
          terminatePromise.then((e) => safe ? defaultValue : Promise.reject(e)),
          ...promises
        ]);
      } finally {
        this._terminatePromises.delete(terminatePromise);
      }
    }
  };
  function cloneError(error, frames) {
    const clone = new Error();
    clone.name = error.name;
    clone.message = error.message;
    clone.stack = [error.name + ":" + error.message, ...frames].join("\n");
    return clone;
  }

  // src/browser/run/playwright-client/vendor/client/stream.ts
  var Stream = class extends ChannelOwner {
    static from(Stream2) {
      return Stream2._object;
    }
    constructor(parent, type, guid, initializer) {
      super(parent, type, guid, initializer);
    }
    stream() {
      return this._platform.streamReadable(this._channel);
    }
  };

  // src/browser/run/playwright-client/vendor/client/artifact.ts
  var Artifact = class extends ChannelOwner {
    static from(channel) {
      return channel._object;
    }
    async pathAfterFinished() {
      throw new Error(`Path is not available in the QuickJS sandbox. Use saveAs() to save a logical artifact.`);
    }
    async saveAs(path) {
      await this._platform.fs().promises.writeFile(path, await this.readIntoBuffer());
    }
    async failure() {
      return (await this._channel.failure()).error || null;
    }
    async createReadStream() {
      throw new Error("Readable streams are not available in the QuickJS sandbox");
    }
    async readIntoBuffer() {
      const result = await this._channel.saveAsStream();
      const stream = Stream.from(result.stream);
      const chunks = [];
      let size = 0;
      while (true) {
        const { binary } = await stream._channel.read({ size: 64 * 1024 });
        if (!binary.byteLength) break;
        chunks.push(binary);
        size += binary.byteLength;
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return bytes;
    }
    async cancel() {
      return await this._channel.cancel();
    }
    async delete() {
      return await this._channel.delete();
    }
  };

  // src/browser/run/playwright-client/vendor/client/coverage.ts
  var Coverage = class {
    _channel;
    constructor(channel) {
      this._channel = channel;
    }
    async startJSCoverage(options = {}) {
      await this._channel.startJSCoverage(options);
    }
    async stopJSCoverage() {
      return (await this._channel.stopJSCoverage()).entries;
    }
    async startCSSCoverage(options = {}) {
      await this._channel.startCSSCoverage(options);
    }
    async stopCSSCoverage() {
      return (await this._channel.stopCSSCoverage()).entries;
    }
  };

  // src/browser/run/playwright-client/vendor/client/disposable.ts
  var DisposableObject = class extends ChannelOwner {
    static from(channel) {
      return channel._object;
    }
    async [Symbol.asyncDispose]() {
      await this.dispose();
    }
    async dispose() {
      try {
        await this._channel.dispose();
      } catch (e) {
        if (isTargetClosedError(e))
          return;
        throw e;
      }
    }
  };
  var DisposableStub = class {
    _dispose;
    constructor(dispose) {
      this._dispose = dispose;
    }
    async [Symbol.asyncDispose]() {
      await this.dispose();
    }
    async dispose() {
      if (!this._dispose)
        return;
      try {
        const dispose = this._dispose;
        this._dispose = void 0;
        await dispose();
      } catch (e) {
        if (isTargetClosedError(e))
          return;
        throw e;
      }
    }
  };

  // src/browser/run/playwright-client/vendor/client/download.ts
  var Download = class {
    _page;
    _url;
    _suggestedFilename;
    _artifact;
    constructor(page, url, suggestedFilename, artifact) {
      this._page = page;
      this._url = url;
      this._suggestedFilename = suggestedFilename;
      this._artifact = artifact;
    }
    page() {
      return this._page;
    }
    url() {
      return this._url;
    }
    suggestedFilename() {
      return this._suggestedFilename;
    }
    async path() {
      return await this._artifact.pathAfterFinished();
    }
    async saveAs(path) {
      return await this._artifact.saveAs(path);
    }
    async failure() {
      return await this._artifact.failure();
    }
    async createReadStream() {
      return await this._artifact.createReadStream();
    }
    async cancel() {
      return await this._artifact.cancel();
    }
    async delete() {
      return await this._artifact.delete();
    }
  };

  // src/browser/run/playwright-client/vendor/isomorphic/mimeType.ts
  function getMimeTypeForPath(path) {
    const dotIndex = path.lastIndexOf(".");
    if (dotIndex === -1)
      return null;
    const extension = path.substring(dotIndex + 1);
    return types.get(extension) || null;
  }
  var types = /* @__PURE__ */ new Map([
    ["ez", "application/andrew-inset"],
    ["aw", "application/applixware"],
    ["atom", "application/atom+xml"],
    ["atomcat", "application/atomcat+xml"],
    ["atomdeleted", "application/atomdeleted+xml"],
    ["atomsvc", "application/atomsvc+xml"],
    ["dwd", "application/atsc-dwd+xml"],
    ["held", "application/atsc-held+xml"],
    ["rsat", "application/atsc-rsat+xml"],
    ["bdoc", "application/bdoc"],
    ["xcs", "application/calendar+xml"],
    ["ccxml", "application/ccxml+xml"],
    ["cdfx", "application/cdfx+xml"],
    ["cdmia", "application/cdmi-capability"],
    ["cdmic", "application/cdmi-container"],
    ["cdmid", "application/cdmi-domain"],
    ["cdmio", "application/cdmi-object"],
    ["cdmiq", "application/cdmi-queue"],
    ["cu", "application/cu-seeme"],
    ["mpd", "application/dash+xml"],
    ["davmount", "application/davmount+xml"],
    ["dbk", "application/docbook+xml"],
    ["dssc", "application/dssc+der"],
    ["xdssc", "application/dssc+xml"],
    ["ecma", "application/ecmascript"],
    ["es", "application/ecmascript"],
    ["emma", "application/emma+xml"],
    ["emotionml", "application/emotionml+xml"],
    ["epub", "application/epub+zip"],
    ["exi", "application/exi"],
    ["exp", "application/express"],
    ["fdt", "application/fdt+xml"],
    ["pfr", "application/font-tdpfr"],
    ["geojson", "application/geo+json"],
    ["gml", "application/gml+xml"],
    ["gpx", "application/gpx+xml"],
    ["gxf", "application/gxf"],
    ["gz", "application/gzip"],
    ["hjson", "application/hjson"],
    ["stk", "application/hyperstudio"],
    ["ink", "application/inkml+xml"],
    ["inkml", "application/inkml+xml"],
    ["ipfix", "application/ipfix"],
    ["its", "application/its+xml"],
    ["ear", "application/java-archive"],
    ["jar", "application/java-archive"],
    ["war", "application/java-archive"],
    ["ser", "application/java-serialized-object"],
    ["class", "application/java-vm"],
    ["js", "application/javascript"],
    ["mjs", "application/javascript"],
    ["json", "application/json"],
    ["map", "application/json"],
    ["json5", "application/json5"],
    ["jsonml", "application/jsonml+json"],
    ["jsonld", "application/ld+json"],
    ["lgr", "application/lgr+xml"],
    ["lostxml", "application/lost+xml"],
    ["hqx", "application/mac-binhex40"],
    ["cpt", "application/mac-compactpro"],
    ["mads", "application/mads+xml"],
    ["webmanifest", "application/manifest+json"],
    ["mrc", "application/marc"],
    ["mrcx", "application/marcxml+xml"],
    ["ma", "application/mathematica"],
    ["mb", "application/mathematica"],
    ["nb", "application/mathematica"],
    ["mathml", "application/mathml+xml"],
    ["mbox", "application/mbox"],
    ["mscml", "application/mediaservercontrol+xml"],
    ["metalink", "application/metalink+xml"],
    ["meta4", "application/metalink4+xml"],
    ["mets", "application/mets+xml"],
    ["maei", "application/mmt-aei+xml"],
    ["musd", "application/mmt-usd+xml"],
    ["mods", "application/mods+xml"],
    ["m21", "application/mp21"],
    ["mp21", "application/mp21"],
    ["m4p", "application/mp4"],
    ["mp4s", "application/mp4"],
    ["doc", "application/msword"],
    ["dot", "application/msword"],
    ["mxf", "application/mxf"],
    ["nq", "application/n-quads"],
    ["nt", "application/n-triples"],
    ["cjs", "application/node"],
    ["bin", "application/octet-stream"],
    ["bpk", "application/octet-stream"],
    ["buffer", "application/octet-stream"],
    ["deb", "application/octet-stream"],
    ["deploy", "application/octet-stream"],
    ["dist", "application/octet-stream"],
    ["distz", "application/octet-stream"],
    ["dll", "application/octet-stream"],
    ["dmg", "application/octet-stream"],
    ["dms", "application/octet-stream"],
    ["dump", "application/octet-stream"],
    ["elc", "application/octet-stream"],
    ["exe", "application/octet-stream"],
    ["img", "application/octet-stream"],
    ["iso", "application/octet-stream"],
    ["lrf", "application/octet-stream"],
    ["mar", "application/octet-stream"],
    ["msi", "application/octet-stream"],
    ["msm", "application/octet-stream"],
    ["msp", "application/octet-stream"],
    ["pkg", "application/octet-stream"],
    ["so", "application/octet-stream"],
    ["oda", "application/oda"],
    ["opf", "application/oebps-package+xml"],
    ["ogx", "application/ogg"],
    ["omdoc", "application/omdoc+xml"],
    ["onepkg", "application/onenote"],
    ["onetmp", "application/onenote"],
    ["onetoc", "application/onenote"],
    ["onetoc2", "application/onenote"],
    ["oxps", "application/oxps"],
    ["relo", "application/p2p-overlay+xml"],
    ["xer", "application/patch-ops-error+xml"],
    ["pdf", "application/pdf"],
    ["pgp", "application/pgp-encrypted"],
    ["asc", "application/pgp-signature"],
    ["sig", "application/pgp-signature"],
    ["prf", "application/pics-rules"],
    ["p10", "application/pkcs10"],
    ["p7c", "application/pkcs7-mime"],
    ["p7m", "application/pkcs7-mime"],
    ["p7s", "application/pkcs7-signature"],
    ["p8", "application/pkcs8"],
    ["ac", "application/pkix-attr-cert"],
    ["cer", "application/pkix-cert"],
    ["crl", "application/pkix-crl"],
    ["pkipath", "application/pkix-pkipath"],
    ["pki", "application/pkixcmp"],
    ["pls", "application/pls+xml"],
    ["ai", "application/postscript"],
    ["eps", "application/postscript"],
    ["ps", "application/postscript"],
    ["provx", "application/provenance+xml"],
    ["pskcxml", "application/pskc+xml"],
    ["raml", "application/raml+yaml"],
    ["owl", "application/rdf+xml"],
    ["rdf", "application/rdf+xml"],
    ["rif", "application/reginfo+xml"],
    ["rnc", "application/relax-ng-compact-syntax"],
    ["rl", "application/resource-lists+xml"],
    ["rld", "application/resource-lists-diff+xml"],
    ["rs", "application/rls-services+xml"],
    ["rapd", "application/route-apd+xml"],
    ["sls", "application/route-s-tsid+xml"],
    ["rusd", "application/route-usd+xml"],
    ["gbr", "application/rpki-ghostbusters"],
    ["mft", "application/rpki-manifest"],
    ["roa", "application/rpki-roa"],
    ["rsd", "application/rsd+xml"],
    ["rss", "application/rss+xml"],
    ["rtf", "application/rtf"],
    ["sbml", "application/sbml+xml"],
    ["scq", "application/scvp-cv-request"],
    ["scs", "application/scvp-cv-response"],
    ["spq", "application/scvp-vp-request"],
    ["spp", "application/scvp-vp-response"],
    ["sdp", "application/sdp"],
    ["senmlx", "application/senml+xml"],
    ["sensmlx", "application/sensml+xml"],
    ["setpay", "application/set-payment-initiation"],
    ["setreg", "application/set-registration-initiation"],
    ["shf", "application/shf+xml"],
    ["sieve", "application/sieve"],
    ["siv", "application/sieve"],
    ["smi", "application/smil+xml"],
    ["smil", "application/smil+xml"],
    ["rq", "application/sparql-query"],
    ["srx", "application/sparql-results+xml"],
    ["gram", "application/srgs"],
    ["grxml", "application/srgs+xml"],
    ["sru", "application/sru+xml"],
    ["ssdl", "application/ssdl+xml"],
    ["ssml", "application/ssml+xml"],
    ["swidtag", "application/swid+xml"],
    ["tei", "application/tei+xml"],
    ["teicorpus", "application/tei+xml"],
    ["tfi", "application/thraud+xml"],
    ["tsd", "application/timestamped-data"],
    ["toml", "application/toml"],
    ["trig", "application/trig"],
    ["ttml", "application/ttml+xml"],
    ["ubj", "application/ubjson"],
    ["rsheet", "application/urc-ressheet+xml"],
    ["td", "application/urc-targetdesc+xml"],
    ["vxml", "application/voicexml+xml"],
    ["wasm", "application/wasm"],
    ["wgt", "application/widget"],
    ["hlp", "application/winhlp"],
    ["wsdl", "application/wsdl+xml"],
    ["wspolicy", "application/wspolicy+xml"],
    ["xaml", "application/xaml+xml"],
    ["xav", "application/xcap-att+xml"],
    ["xca", "application/xcap-caps+xml"],
    ["xdf", "application/xcap-diff+xml"],
    ["xel", "application/xcap-el+xml"],
    ["xns", "application/xcap-ns+xml"],
    ["xenc", "application/xenc+xml"],
    ["xht", "application/xhtml+xml"],
    ["xhtml", "application/xhtml+xml"],
    ["xlf", "application/xliff+xml"],
    ["rng", "application/xml"],
    ["xml", "application/xml"],
    ["xsd", "application/xml"],
    ["xsl", "application/xml"],
    ["dtd", "application/xml-dtd"],
    ["xop", "application/xop+xml"],
    ["xpl", "application/xproc+xml"],
    ["*xsl", "application/xslt+xml"],
    ["xslt", "application/xslt+xml"],
    ["xspf", "application/xspf+xml"],
    ["mxml", "application/xv+xml"],
    ["xhvml", "application/xv+xml"],
    ["xvm", "application/xv+xml"],
    ["xvml", "application/xv+xml"],
    ["yang", "application/yang"],
    ["yin", "application/yin+xml"],
    ["zip", "application/zip"],
    ["*3gpp", "audio/3gpp"],
    ["adp", "audio/adpcm"],
    ["amr", "audio/amr"],
    ["au", "audio/basic"],
    ["snd", "audio/basic"],
    ["kar", "audio/midi"],
    ["mid", "audio/midi"],
    ["midi", "audio/midi"],
    ["rmi", "audio/midi"],
    ["mxmf", "audio/mobile-xmf"],
    ["*mp3", "audio/mp3"],
    ["m4a", "audio/mp4"],
    ["mp4a", "audio/mp4"],
    ["m2a", "audio/mpeg"],
    ["m3a", "audio/mpeg"],
    ["mp2", "audio/mpeg"],
    ["mp2a", "audio/mpeg"],
    ["mp3", "audio/mpeg"],
    ["mpga", "audio/mpeg"],
    ["oga", "audio/ogg"],
    ["ogg", "audio/ogg"],
    ["opus", "audio/ogg"],
    ["spx", "audio/ogg"],
    ["s3m", "audio/s3m"],
    ["sil", "audio/silk"],
    ["wav", "audio/wav"],
    ["*wav", "audio/wave"],
    ["weba", "audio/webm"],
    ["xm", "audio/xm"],
    ["ttc", "font/collection"],
    ["otf", "font/otf"],
    ["ttf", "font/ttf"],
    ["woff", "font/woff"],
    ["woff2", "font/woff2"],
    ["exr", "image/aces"],
    ["apng", "image/apng"],
    ["avif", "image/avif"],
    ["bmp", "image/bmp"],
    ["cgm", "image/cgm"],
    ["drle", "image/dicom-rle"],
    ["emf", "image/emf"],
    ["fits", "image/fits"],
    ["g3", "image/g3fax"],
    ["gif", "image/gif"],
    ["heic", "image/heic"],
    ["heics", "image/heic-sequence"],
    ["heif", "image/heif"],
    ["heifs", "image/heif-sequence"],
    ["hej2", "image/hej2k"],
    ["hsj2", "image/hsj2"],
    ["ief", "image/ief"],
    ["jls", "image/jls"],
    ["jp2", "image/jp2"],
    ["jpg2", "image/jp2"],
    ["jpe", "image/jpeg"],
    ["jpeg", "image/jpeg"],
    ["jpg", "image/jpeg"],
    ["jph", "image/jph"],
    ["jhc", "image/jphc"],
    ["jpm", "image/jpm"],
    ["jpf", "image/jpx"],
    ["jpx", "image/jpx"],
    ["jxr", "image/jxr"],
    ["jxra", "image/jxra"],
    ["jxrs", "image/jxrs"],
    ["jxs", "image/jxs"],
    ["jxsc", "image/jxsc"],
    ["jxsi", "image/jxsi"],
    ["jxss", "image/jxss"],
    ["ktx", "image/ktx"],
    ["ktx2", "image/ktx2"],
    ["png", "image/png"],
    ["sgi", "image/sgi"],
    ["svg", "image/svg+xml"],
    ["svgz", "image/svg+xml"],
    ["t38", "image/t38"],
    ["tif", "image/tiff"],
    ["tiff", "image/tiff"],
    ["tfx", "image/tiff-fx"],
    ["webp", "image/webp"],
    ["wmf", "image/wmf"],
    ["disposition-notification", "message/disposition-notification"],
    ["u8msg", "message/global"],
    ["u8dsn", "message/global-delivery-status"],
    ["u8mdn", "message/global-disposition-notification"],
    ["u8hdr", "message/global-headers"],
    ["eml", "message/rfc822"],
    ["mime", "message/rfc822"],
    ["3mf", "model/3mf"],
    ["gltf", "model/gltf+json"],
    ["glb", "model/gltf-binary"],
    ["iges", "model/iges"],
    ["igs", "model/iges"],
    ["mesh", "model/mesh"],
    ["msh", "model/mesh"],
    ["silo", "model/mesh"],
    ["mtl", "model/mtl"],
    ["obj", "model/obj"],
    ["stpx", "model/step+xml"],
    ["stpz", "model/step+zip"],
    ["stpxz", "model/step-xml+zip"],
    ["stl", "model/stl"],
    ["vrml", "model/vrml"],
    ["wrl", "model/vrml"],
    ["*x3db", "model/x3d+binary"],
    ["x3dbz", "model/x3d+binary"],
    ["x3db", "model/x3d+fastinfoset"],
    ["*x3dv", "model/x3d+vrml"],
    ["x3dvz", "model/x3d+vrml"],
    ["x3d", "model/x3d+xml"],
    ["x3dz", "model/x3d+xml"],
    ["x3dv", "model/x3d-vrml"],
    ["appcache", "text/cache-manifest"],
    ["manifest", "text/cache-manifest"],
    ["ics", "text/calendar"],
    ["ifb", "text/calendar"],
    ["coffee", "text/coffeescript"],
    ["litcoffee", "text/coffeescript"],
    ["css", "text/css"],
    ["csv", "text/csv"],
    ["htm", "text/html"],
    ["html", "text/html"],
    ["shtml", "text/html"],
    ["jade", "text/jade"],
    ["jsx", "text/jsx"],
    ["less", "text/less"],
    ["markdown", "text/markdown"],
    ["md", "text/markdown"],
    ["mml", "text/mathml"],
    ["mdx", "text/mdx"],
    ["n3", "text/n3"],
    ["conf", "text/plain"],
    ["def", "text/plain"],
    ["in", "text/plain"],
    ["ini", "text/plain"],
    ["list", "text/plain"],
    ["log", "text/plain"],
    ["text", "text/plain"],
    ["txt", "text/plain"],
    ["rtx", "text/richtext"],
    ["*rtf", "text/rtf"],
    ["sgm", "text/sgml"],
    ["sgml", "text/sgml"],
    ["shex", "text/shex"],
    ["slim", "text/slim"],
    ["slm", "text/slim"],
    ["spdx", "text/spdx"],
    ["styl", "text/stylus"],
    ["stylus", "text/stylus"],
    ["tsv", "text/tab-separated-values"],
    ["man", "text/troff"],
    ["me", "text/troff"],
    ["ms", "text/troff"],
    ["roff", "text/troff"],
    ["t", "text/troff"],
    ["tr", "text/troff"],
    ["ttl", "text/turtle"],
    ["uri", "text/uri-list"],
    ["uris", "text/uri-list"],
    ["urls", "text/uri-list"],
    ["vcard", "text/vcard"],
    ["vtt", "text/vtt"],
    ["*xml", "text/xml"],
    ["yaml", "text/yaml"],
    ["yml", "text/yaml"],
    ["3gp", "video/3gpp"],
    ["3gpp", "video/3gpp"],
    ["3g2", "video/3gpp2"],
    ["h261", "video/h261"],
    ["h263", "video/h263"],
    ["h264", "video/h264"],
    ["m4s", "video/iso.segment"],
    ["jpgv", "video/jpeg"],
    ["jpm", "video/jpm"],
    ["jpgm", "video/jpm"],
    ["mj2", "video/mj2"],
    ["mjp2", "video/mj2"],
    ["ts", "application/typescript"],
    ["mp4", "video/mp4"],
    ["mp4v", "video/mp4"],
    ["mpg4", "video/mp4"],
    ["m1v", "video/mpeg"],
    ["m2v", "video/mpeg"],
    ["mpe", "video/mpeg"],
    ["mpeg", "video/mpeg"],
    ["mpg", "video/mpeg"],
    ["ogv", "video/ogg"],
    ["mov", "video/quicktime"],
    ["qt", "video/quicktime"],
    ["webm", "video/webm"]
  ]);

  // src/browser/run/playwright-client/vendor/isomorphic/locatorUtils.ts
  function getByAttributeTextSelector(attrName, text, options) {
    return `internal:attr=[${attrName}=${escapeForAttributeSelector(text, options?.exact || false)}]`;
  }
  function encodeTestIdAttributeName(testIdAttributeName2) {
    return testIdAttributeName2.includes(",") ? JSON.stringify(testIdAttributeName2) : testIdAttributeName2;
  }
  function getByTestIdSelector(testIdAttributeName2, testId) {
    return `internal:testid=[${encodeTestIdAttributeName(testIdAttributeName2)}=${escapeForAttributeSelector(testId, true)}]`;
  }
  function getByLabelSelector(text, options) {
    return "internal:label=" + escapeForTextSelector(text, !!options?.exact);
  }
  function getByAltTextSelector(text, options) {
    return getByAttributeTextSelector("alt", text, options);
  }
  function getByTitleSelector(text, options) {
    return getByAttributeTextSelector("title", text, options);
  }
  function getByPlaceholderSelector(text, options) {
    return getByAttributeTextSelector("placeholder", text, options);
  }
  function getByTextSelector(text, options) {
    return "internal:text=" + escapeForTextSelector(text, !!options?.exact);
  }
  function getByRoleSelector(role, options = {}) {
    const props = [];
    if (options.checked !== void 0)
      props.push(["checked", String(options.checked)]);
    if (options.disabled !== void 0)
      props.push(["disabled", String(options.disabled)]);
    if (options.selected !== void 0)
      props.push(["selected", String(options.selected)]);
    if (options.expanded !== void 0)
      props.push(["expanded", String(options.expanded)]);
    if (options.includeHidden !== void 0)
      props.push(["include-hidden", String(options.includeHidden)]);
    if (options.level !== void 0)
      props.push(["level", String(options.level)]);
    if (options.name !== void 0)
      props.push(["name", escapeForAttributeSelector(options.name, !!options.exact)]);
    if (options.description !== void 0)
      props.push(["description", escapeForAttributeSelector(options.description, !!options.exact)]);
    if (options.pressed !== void 0)
      props.push(["pressed", String(options.pressed)]);
    return `internal:role=${role}${props.map(([n, v]) => `[${n}=${v}]`).join("")}`;
  }

  // src/browser/run/playwright-client/vendor/isomorphic/cssTokenizer.ts
  var between = function(num, first, last) {
    return num >= first && num <= last;
  };
  function digit(code) {
    return between(code, 48, 57);
  }
  function hexdigit(code) {
    return digit(code) || between(code, 65, 70) || between(code, 97, 102);
  }
  function uppercaseletter(code) {
    return between(code, 65, 90);
  }
  function lowercaseletter(code) {
    return between(code, 97, 122);
  }
  function letter(code) {
    return uppercaseletter(code) || lowercaseletter(code);
  }
  function nonascii(code) {
    return code >= 128;
  }
  function namestartchar(code) {
    return letter(code) || nonascii(code) || code === 95;
  }
  function namechar(code) {
    return namestartchar(code) || digit(code) || code === 45;
  }
  function nonprintable(code) {
    return between(code, 0, 8) || code === 11 || between(code, 14, 31) || code === 127;
  }
  function newline(code) {
    return code === 10;
  }
  function whitespace(code) {
    return newline(code) || code === 9 || code === 32;
  }
  var maximumallowedcodepoint = 1114111;
  var InvalidCharacterError = class extends Error {
    constructor(message) {
      super(message);
      this.name = "InvalidCharacterError";
    }
  };
  function preprocess(str) {
    const codepoints = [];
    for (let i = 0; i < str.length; i++) {
      let code = str.charCodeAt(i);
      if (code === 13 && str.charCodeAt(i + 1) === 10) {
        code = 10;
        i++;
      }
      if (code === 13 || code === 12)
        code = 10;
      if (code === 0)
        code = 65533;
      if (between(code, 55296, 56319) && between(str.charCodeAt(i + 1), 56320, 57343)) {
        const lead = code - 55296;
        const trail = str.charCodeAt(i + 1) - 56320;
        code = Math.pow(2, 16) + lead * Math.pow(2, 10) + trail;
        i++;
      }
      codepoints.push(code);
    }
    return codepoints;
  }
  function stringFromCode(code) {
    if (code <= 65535)
      return String.fromCharCode(code);
    code -= Math.pow(2, 16);
    const lead = Math.floor(code / Math.pow(2, 10)) + 55296;
    const trail = code % Math.pow(2, 10) + 56320;
    return String.fromCharCode(lead) + String.fromCharCode(trail);
  }
  function tokenize(str1) {
    const str = preprocess(str1);
    let i = -1;
    const tokens = [];
    let code;
    let line = 0;
    let column = 0;
    let lastLineLength = 0;
    const incrLineno = function() {
      line += 1;
      lastLineLength = column;
      column = 0;
    };
    const locStart = { line, column };
    const codepoint = function(i2) {
      if (i2 >= str.length)
        return -1;
      return str[i2];
    };
    const next = function(num) {
      if (num === void 0)
        num = 1;
      if (num > 3)
        throw "Spec Error: no more than three codepoints of lookahead.";
      return codepoint(i + num);
    };
    const consume = function(num) {
      if (num === void 0)
        num = 1;
      i += num;
      code = codepoint(i);
      if (newline(code))
        incrLineno();
      else
        column += num;
      return true;
    };
    const reconsume = function() {
      i -= 1;
      if (newline(code)) {
        line -= 1;
        column = lastLineLength;
      } else {
        column -= 1;
      }
      locStart.line = line;
      locStart.column = column;
      return true;
    };
    const eof = function(codepoint2) {
      if (codepoint2 === void 0)
        codepoint2 = code;
      return codepoint2 === -1;
    };
    const donothing = function() {
    };
    const parseerror = function() {
    };
    const consumeAToken = function() {
      consumeComments();
      consume();
      if (whitespace(code)) {
        while (whitespace(next()))
          consume();
        return new WhitespaceToken();
      } else if (code === 34) {
        return consumeAStringToken();
      } else if (code === 35) {
        if (namechar(next()) || areAValidEscape(next(1), next(2))) {
          const token = new HashToken("");
          if (wouldStartAnIdentifier(next(1), next(2), next(3)))
            token.type = "id";
          token.value = consumeAName();
          return token;
        } else {
          return new DelimToken(code);
        }
      } else if (code === 36) {
        if (next() === 61) {
          consume();
          return new SuffixMatchToken();
        } else {
          return new DelimToken(code);
        }
      } else if (code === 39) {
        return consumeAStringToken();
      } else if (code === 40) {
        return new OpenParenToken();
      } else if (code === 41) {
        return new CloseParenToken();
      } else if (code === 42) {
        if (next() === 61) {
          consume();
          return new SubstringMatchToken();
        } else {
          return new DelimToken(code);
        }
      } else if (code === 43) {
        if (startsWithANumber()) {
          reconsume();
          return consumeANumericToken();
        } else {
          return new DelimToken(code);
        }
      } else if (code === 44) {
        return new CommaToken();
      } else if (code === 45) {
        if (startsWithANumber()) {
          reconsume();
          return consumeANumericToken();
        } else if (next(1) === 45 && next(2) === 62) {
          consume(2);
          return new CDCToken();
        } else if (startsWithAnIdentifier()) {
          reconsume();
          return consumeAnIdentlikeToken();
        } else {
          return new DelimToken(code);
        }
      } else if (code === 46) {
        if (startsWithANumber()) {
          reconsume();
          return consumeANumericToken();
        } else {
          return new DelimToken(code);
        }
      } else if (code === 58) {
        return new ColonToken();
      } else if (code === 59) {
        return new SemicolonToken();
      } else if (code === 60) {
        if (next(1) === 33 && next(2) === 45 && next(3) === 45) {
          consume(3);
          return new CDOToken();
        } else {
          return new DelimToken(code);
        }
      } else if (code === 64) {
        if (wouldStartAnIdentifier(next(1), next(2), next(3)))
          return new AtKeywordToken(consumeAName());
        else
          return new DelimToken(code);
      } else if (code === 91) {
        return new OpenSquareToken();
      } else if (code === 92) {
        if (startsWithAValidEscape()) {
          reconsume();
          return consumeAnIdentlikeToken();
        } else {
          parseerror();
          return new DelimToken(code);
        }
      } else if (code === 93) {
        return new CloseSquareToken();
      } else if (code === 94) {
        if (next() === 61) {
          consume();
          return new PrefixMatchToken();
        } else {
          return new DelimToken(code);
        }
      } else if (code === 123) {
        return new OpenCurlyToken();
      } else if (code === 124) {
        if (next() === 61) {
          consume();
          return new DashMatchToken();
        } else if (next() === 124) {
          consume();
          return new ColumnToken();
        } else {
          return new DelimToken(code);
        }
      } else if (code === 125) {
        return new CloseCurlyToken();
      } else if (code === 126) {
        if (next() === 61) {
          consume();
          return new IncludeMatchToken();
        } else {
          return new DelimToken(code);
        }
      } else if (digit(code)) {
        reconsume();
        return consumeANumericToken();
      } else if (namestartchar(code)) {
        reconsume();
        return consumeAnIdentlikeToken();
      } else if (eof()) {
        return new EOFToken();
      } else {
        return new DelimToken(code);
      }
    };
    const consumeComments = function() {
      while (next(1) === 47 && next(2) === 42) {
        consume(2);
        while (true) {
          consume();
          if (code === 42 && next() === 47) {
            consume();
            break;
          } else if (eof()) {
            parseerror();
            return;
          }
        }
      }
    };
    const consumeANumericToken = function() {
      const num = consumeANumber();
      if (wouldStartAnIdentifier(next(1), next(2), next(3))) {
        const token = new DimensionToken();
        token.value = num.value;
        token.repr = num.repr;
        token.type = num.type;
        token.unit = consumeAName();
        return token;
      } else if (next() === 37) {
        consume();
        const token = new PercentageToken();
        token.value = num.value;
        token.repr = num.repr;
        return token;
      } else {
        const token = new NumberToken();
        token.value = num.value;
        token.repr = num.repr;
        token.type = num.type;
        return token;
      }
    };
    const consumeAnIdentlikeToken = function() {
      const str2 = consumeAName();
      if (str2.toLowerCase() === "url" && next() === 40) {
        consume();
        while (whitespace(next(1)) && whitespace(next(2)))
          consume();
        if (next() === 34 || next() === 39)
          return new FunctionToken(str2);
        else if (whitespace(next()) && (next(2) === 34 || next(2) === 39))
          return new FunctionToken(str2);
        else
          return consumeAURLToken();
      } else if (next() === 40) {
        consume();
        return new FunctionToken(str2);
      } else {
        return new IdentToken(str2);
      }
    };
    const consumeAStringToken = function(endingCodePoint) {
      if (endingCodePoint === void 0)
        endingCodePoint = code;
      let string = "";
      while (consume()) {
        if (code === endingCodePoint || eof()) {
          return new StringToken(string);
        } else if (newline(code)) {
          parseerror();
          reconsume();
          return new BadStringToken();
        } else if (code === 92) {
          if (eof(next()))
            donothing();
          else if (newline(next()))
            consume();
          else
            string += stringFromCode(consumeEscape());
        } else {
          string += stringFromCode(code);
        }
      }
      throw new Error("Internal error");
    };
    const consumeAURLToken = function() {
      const token = new URLToken("");
      while (whitespace(next()))
        consume();
      if (eof(next()))
        return token;
      while (consume()) {
        if (code === 41 || eof()) {
          return token;
        } else if (whitespace(code)) {
          while (whitespace(next()))
            consume();
          if (next() === 41 || eof(next())) {
            consume();
            return token;
          } else {
            consumeTheRemnantsOfABadURL();
            return new BadURLToken();
          }
        } else if (code === 34 || code === 39 || code === 40 || nonprintable(code)) {
          parseerror();
          consumeTheRemnantsOfABadURL();
          return new BadURLToken();
        } else if (code === 92) {
          if (startsWithAValidEscape()) {
            token.value += stringFromCode(consumeEscape());
          } else {
            parseerror();
            consumeTheRemnantsOfABadURL();
            return new BadURLToken();
          }
        } else {
          token.value += stringFromCode(code);
        }
      }
      throw new Error("Internal error");
    };
    const consumeEscape = function() {
      consume();
      if (hexdigit(code)) {
        const digits = [code];
        for (let total = 0; total < 5; total++) {
          if (hexdigit(next())) {
            consume();
            digits.push(code);
          } else {
            break;
          }
        }
        if (whitespace(next()))
          consume();
        let value = parseInt(digits.map(function(x) {
          return String.fromCharCode(x);
        }).join(""), 16);
        if (value > maximumallowedcodepoint)
          value = 65533;
        return value;
      } else if (eof()) {
        return 65533;
      } else {
        return code;
      }
    };
    const areAValidEscape = function(c1, c2) {
      if (c1 !== 92)
        return false;
      if (newline(c2))
        return false;
      return true;
    };
    const startsWithAValidEscape = function() {
      return areAValidEscape(code, next());
    };
    const wouldStartAnIdentifier = function(c1, c2, c3) {
      if (c1 === 45)
        return namestartchar(c2) || c2 === 45 || areAValidEscape(c2, c3);
      else if (namestartchar(c1))
        return true;
      else if (c1 === 92)
        return areAValidEscape(c1, c2);
      else
        return false;
    };
    const startsWithAnIdentifier = function() {
      return wouldStartAnIdentifier(code, next(1), next(2));
    };
    const wouldStartANumber = function(c1, c2, c3) {
      if (c1 === 43 || c1 === 45) {
        if (digit(c2))
          return true;
        if (c2 === 46 && digit(c3))
          return true;
        return false;
      } else if (c1 === 46) {
        if (digit(c2))
          return true;
        return false;
      } else if (digit(c1)) {
        return true;
      } else {
        return false;
      }
    };
    const startsWithANumber = function() {
      return wouldStartANumber(code, next(1), next(2));
    };
    const consumeAName = function() {
      let result = "";
      while (consume()) {
        if (namechar(code)) {
          result += stringFromCode(code);
        } else if (startsWithAValidEscape()) {
          result += stringFromCode(consumeEscape());
        } else {
          reconsume();
          return result;
        }
      }
      throw new Error("Internal parse error");
    };
    const consumeANumber = function() {
      let repr = "";
      let type = "integer";
      if (next() === 43 || next() === 45) {
        consume();
        repr += stringFromCode(code);
      }
      while (digit(next())) {
        consume();
        repr += stringFromCode(code);
      }
      if (next(1) === 46 && digit(next(2))) {
        consume();
        repr += stringFromCode(code);
        consume();
        repr += stringFromCode(code);
        type = "number";
        while (digit(next())) {
          consume();
          repr += stringFromCode(code);
        }
      }
      const c1 = next(1);
      const c2 = next(2);
      const c3 = next(3);
      if ((c1 === 69 || c1 === 101) && digit(c2)) {
        consume();
        repr += stringFromCode(code);
        consume();
        repr += stringFromCode(code);
        type = "number";
        while (digit(next())) {
          consume();
          repr += stringFromCode(code);
        }
      } else if ((c1 === 69 || c1 === 101) && (c2 === 43 || c2 === 45) && digit(c3)) {
        consume();
        repr += stringFromCode(code);
        consume();
        repr += stringFromCode(code);
        consume();
        repr += stringFromCode(code);
        type = "number";
        while (digit(next())) {
          consume();
          repr += stringFromCode(code);
        }
      }
      const value = convertAStringToANumber(repr);
      return { type, value, repr };
    };
    const convertAStringToANumber = function(string) {
      return +string;
    };
    const consumeTheRemnantsOfABadURL = function() {
      while (consume()) {
        if (code === 41 || eof()) {
          return;
        } else if (startsWithAValidEscape()) {
          consumeEscape();
          donothing();
        } else {
          donothing();
        }
      }
    };
    let iterationCount = 0;
    while (!eof(next())) {
      tokens.push(consumeAToken());
      iterationCount++;
      if (iterationCount > str.length * 2)
        throw new Error("I'm infinite-looping!");
    }
    return tokens;
  }
  var CSSParserToken = class {
    tokenType = "";
    value;
    toJSON() {
      return { token: this.tokenType };
    }
    toString() {
      return this.tokenType;
    }
    toSource() {
      return "" + this;
    }
  };
  var BadStringToken = class extends CSSParserToken {
    tokenType = "BADSTRING";
  };
  var BadURLToken = class extends CSSParserToken {
    tokenType = "BADURL";
  };
  var WhitespaceToken = class extends CSSParserToken {
    tokenType = "WHITESPACE";
    toString() {
      return "WS";
    }
    toSource() {
      return " ";
    }
  };
  var CDOToken = class extends CSSParserToken {
    tokenType = "CDO";
    toSource() {
      return "<!--";
    }
  };
  var CDCToken = class extends CSSParserToken {
    tokenType = "CDC";
    toSource() {
      return "-->";
    }
  };
  var ColonToken = class extends CSSParserToken {
    tokenType = ":";
  };
  var SemicolonToken = class extends CSSParserToken {
    tokenType = ";";
  };
  var CommaToken = class extends CSSParserToken {
    tokenType = ",";
  };
  var GroupingToken = class extends CSSParserToken {
    value = "";
    mirror = "";
  };
  var OpenCurlyToken = class extends GroupingToken {
    tokenType = "{";
    constructor() {
      super();
      this.value = "{";
      this.mirror = "}";
    }
  };
  var CloseCurlyToken = class extends GroupingToken {
    tokenType = "}";
    constructor() {
      super();
      this.value = "}";
      this.mirror = "{";
    }
  };
  var OpenSquareToken = class extends GroupingToken {
    tokenType = "[";
    constructor() {
      super();
      this.value = "[";
      this.mirror = "]";
    }
  };
  var CloseSquareToken = class extends GroupingToken {
    tokenType = "]";
    constructor() {
      super();
      this.value = "]";
      this.mirror = "[";
    }
  };
  var OpenParenToken = class extends GroupingToken {
    tokenType = "(";
    constructor() {
      super();
      this.value = "(";
      this.mirror = ")";
    }
  };
  var CloseParenToken = class extends GroupingToken {
    tokenType = ")";
    constructor() {
      super();
      this.value = ")";
      this.mirror = "(";
    }
  };
  var IncludeMatchToken = class extends CSSParserToken {
    tokenType = "~=";
  };
  var DashMatchToken = class extends CSSParserToken {
    tokenType = "|=";
  };
  var PrefixMatchToken = class extends CSSParserToken {
    tokenType = "^=";
  };
  var SuffixMatchToken = class extends CSSParserToken {
    tokenType = "$=";
  };
  var SubstringMatchToken = class extends CSSParserToken {
    tokenType = "*=";
  };
  var ColumnToken = class extends CSSParserToken {
    tokenType = "||";
  };
  var EOFToken = class extends CSSParserToken {
    tokenType = "EOF";
    toSource() {
      return "";
    }
  };
  var DelimToken = class extends CSSParserToken {
    tokenType = "DELIM";
    value = "";
    constructor(code) {
      super();
      this.value = stringFromCode(code);
    }
    toString() {
      return "DELIM(" + this.value + ")";
    }
    toJSON() {
      const json = this.constructor.prototype.constructor.prototype.toJSON.call(this);
      json.value = this.value;
      return json;
    }
    toSource() {
      if (this.value === "\\")
        return "\\\n";
      else
        return this.value;
    }
  };
  var StringValuedToken = class extends CSSParserToken {
    value = "";
    ASCIIMatch(str) {
      return this.value.toLowerCase() === str.toLowerCase();
    }
    toJSON() {
      const json = this.constructor.prototype.constructor.prototype.toJSON.call(this);
      json.value = this.value;
      return json;
    }
  };
  var IdentToken = class extends StringValuedToken {
    constructor(val) {
      super();
      this.value = val;
    }
    tokenType = "IDENT";
    toString() {
      return "IDENT(" + this.value + ")";
    }
    toSource() {
      return escapeIdent(this.value);
    }
  };
  var FunctionToken = class extends StringValuedToken {
    tokenType = "FUNCTION";
    mirror;
    constructor(val) {
      super();
      this.value = val;
      this.mirror = ")";
    }
    toString() {
      return "FUNCTION(" + this.value + ")";
    }
    toSource() {
      return escapeIdent(this.value) + "(";
    }
  };
  var AtKeywordToken = class extends StringValuedToken {
    tokenType = "AT-KEYWORD";
    constructor(val) {
      super();
      this.value = val;
    }
    toString() {
      return "AT(" + this.value + ")";
    }
    toSource() {
      return "@" + escapeIdent(this.value);
    }
  };
  var HashToken = class extends StringValuedToken {
    tokenType = "HASH";
    type;
    constructor(val) {
      super();
      this.value = val;
      this.type = "unrestricted";
    }
    toString() {
      return "HASH(" + this.value + ")";
    }
    toJSON() {
      const json = this.constructor.prototype.constructor.prototype.toJSON.call(this);
      json.value = this.value;
      json.type = this.type;
      return json;
    }
    toSource() {
      if (this.type === "id")
        return "#" + escapeIdent(this.value);
      else
        return "#" + escapeHash(this.value);
    }
  };
  var StringToken = class extends StringValuedToken {
    tokenType = "STRING";
    constructor(val) {
      super();
      this.value = val;
    }
    toString() {
      return '"' + escapeString(this.value) + '"';
    }
  };
  var URLToken = class extends StringValuedToken {
    tokenType = "URL";
    constructor(val) {
      super();
      this.value = val;
    }
    toString() {
      return "URL(" + this.value + ")";
    }
    toSource() {
      return 'url("' + escapeString(this.value) + '")';
    }
  };
  var NumberToken = class extends CSSParserToken {
    tokenType = "NUMBER";
    type;
    repr;
    constructor() {
      super();
      this.type = "integer";
      this.repr = "";
    }
    toString() {
      if (this.type === "integer")
        return "INT(" + this.value + ")";
      return "NUMBER(" + this.value + ")";
    }
    toJSON() {
      const json = super.toJSON();
      json.value = this.value;
      json.type = this.type;
      json.repr = this.repr;
      return json;
    }
    toSource() {
      return this.repr;
    }
  };
  var PercentageToken = class extends CSSParserToken {
    tokenType = "PERCENTAGE";
    repr;
    constructor() {
      super();
      this.repr = "";
    }
    toString() {
      return "PERCENTAGE(" + this.value + ")";
    }
    toJSON() {
      const json = this.constructor.prototype.constructor.prototype.toJSON.call(this);
      json.value = this.value;
      json.repr = this.repr;
      return json;
    }
    toSource() {
      return this.repr + "%";
    }
  };
  var DimensionToken = class extends CSSParserToken {
    tokenType = "DIMENSION";
    type;
    repr;
    unit;
    constructor() {
      super();
      this.type = "integer";
      this.repr = "";
      this.unit = "";
    }
    toString() {
      return "DIM(" + this.value + "," + this.unit + ")";
    }
    toJSON() {
      const json = this.constructor.prototype.constructor.prototype.toJSON.call(this);
      json.value = this.value;
      json.type = this.type;
      json.repr = this.repr;
      json.unit = this.unit;
      return json;
    }
    toSource() {
      const source = this.repr;
      let unit = escapeIdent(this.unit);
      if (unit[0].toLowerCase() === "e" && (unit[1] === "-" || between(unit.charCodeAt(1), 48, 57))) {
        unit = "\\65 " + unit.slice(1, unit.length);
      }
      return source + unit;
    }
  };
  function escapeIdent(string) {
    string = "" + string;
    let result = "";
    const firstcode = string.charCodeAt(0);
    for (let i = 0; i < string.length; i++) {
      const code = string.charCodeAt(i);
      if (code === 0)
        throw new InvalidCharacterError("Invalid character: the input contains U+0000.");
      if (between(code, 1, 31) || code === 127 || i === 0 && between(code, 48, 57) || i === 1 && between(code, 48, 57) && firstcode === 45)
        result += "\\" + code.toString(16) + " ";
      else if (code >= 128 || code === 45 || code === 95 || between(code, 48, 57) || between(code, 65, 90) || between(code, 97, 122))
        result += string[i];
      else
        result += "\\" + string[i];
    }
    return result;
  }
  function escapeHash(string) {
    string = "" + string;
    let result = "";
    for (let i = 0; i < string.length; i++) {
      const code = string.charCodeAt(i);
      if (code === 0)
        throw new InvalidCharacterError("Invalid character: the input contains U+0000.");
      if (code >= 128 || code === 45 || code === 95 || between(code, 48, 57) || between(code, 65, 90) || between(code, 97, 122))
        result += string[i];
      else
        result += "\\" + code.toString(16) + " ";
    }
    return result;
  }
  function escapeString(string) {
    string = "" + string;
    let result = "";
    for (let i = 0; i < string.length; i++) {
      const code = string.charCodeAt(i);
      if (code === 0)
        throw new InvalidCharacterError("Invalid character: the input contains U+0000.");
      if (between(code, 1, 31) || code === 127)
        result += "\\" + code.toString(16) + " ";
      else if (code === 34 || code === 92)
        result += "\\" + string[i];
      else
        result += string[i];
    }
    return result;
  }

  // src/browser/run/playwright-client/vendor/isomorphic/cssParser.ts
  var InvalidSelectorError = class extends Error {
  };
  function parseCSS(selector, customNames) {
    let tokens;
    try {
      tokens = tokenize(selector);
      if (!(tokens[tokens.length - 1] instanceof EOFToken))
        tokens.push(new EOFToken());
    } catch (e) {
      const newMessage = e.message + ` while parsing css selector "${selector}". Did you mean to CSS.escape it?`;
      const index = (e.stack || "").indexOf(e.message);
      if (index !== -1)
        e.stack = e.stack.substring(0, index) + newMessage + e.stack.substring(index + e.message.length);
      e.message = newMessage;
      throw e;
    }
    const unsupportedToken = tokens.find((token) => {
      return token instanceof AtKeywordToken || token instanceof BadStringToken || token instanceof BadURLToken || token instanceof ColumnToken || token instanceof CDOToken || token instanceof CDCToken || token instanceof SemicolonToken || // TODO: Consider using these for something, e.g. to escape complex strings.
      // For example :xpath{ (//div/bar[@attr="foo"])[2]/baz }
      // Or this way :xpath( {complex-xpath-goes-here("hello")} )
      token instanceof OpenCurlyToken || token instanceof CloseCurlyToken || // TODO: Consider treating these as strings?
      token instanceof URLToken || token instanceof PercentageToken;
    });
    if (unsupportedToken)
      throw new InvalidSelectorError(`Unsupported token "${unsupportedToken.toSource()}" while parsing css selector "${selector}". Did you mean to CSS.escape it?`);
    let pos = 0;
    const names = /* @__PURE__ */ new Set();
    function unexpected() {
      return new InvalidSelectorError(`Unexpected token "${tokens[pos].toSource()}" while parsing css selector "${selector}". Did you mean to CSS.escape it?`);
    }
    function skipWhitespace() {
      while (tokens[pos] instanceof WhitespaceToken)
        pos++;
    }
    function isIdent(p = pos) {
      return tokens[p] instanceof IdentToken;
    }
    function isString2(p = pos) {
      return tokens[p] instanceof StringToken;
    }
    function isNumber(p = pos) {
      return tokens[p] instanceof NumberToken;
    }
    function isComma(p = pos) {
      return tokens[p] instanceof CommaToken;
    }
    function isOpenParen(p = pos) {
      return tokens[p] instanceof OpenParenToken;
    }
    function isCloseParen(p = pos) {
      return tokens[p] instanceof CloseParenToken;
    }
    function isFunction(p = pos) {
      return tokens[p] instanceof FunctionToken;
    }
    function isStar(p = pos) {
      return tokens[p] instanceof DelimToken && tokens[p].value === "*";
    }
    function isEOF(p = pos) {
      return tokens[p] instanceof EOFToken;
    }
    function isClauseCombinator(p = pos) {
      return tokens[p] instanceof DelimToken && [">", "+", "~"].includes(tokens[p].value);
    }
    function isSelectorClauseEnd(p = pos) {
      return isComma(p) || isCloseParen(p) || isEOF(p) || isClauseCombinator(p) || tokens[p] instanceof WhitespaceToken;
    }
    function consumeFunctionArguments() {
      const result2 = [consumeArgument()];
      while (true) {
        skipWhitespace();
        if (!isComma())
          break;
        pos++;
        result2.push(consumeArgument());
      }
      return result2;
    }
    function consumeArgument() {
      skipWhitespace();
      if (isNumber())
        return tokens[pos++].value;
      if (isString2())
        return tokens[pos++].value;
      return consumeComplexSelector();
    }
    function consumeComplexSelector() {
      const result2 = { simples: [] };
      skipWhitespace();
      if (isClauseCombinator()) {
        result2.simples.push({ selector: { functions: [{ name: "scope", args: [] }] }, combinator: "" });
      } else {
        result2.simples.push({ selector: consumeSimpleSelector(), combinator: "" });
      }
      while (true) {
        skipWhitespace();
        if (isClauseCombinator()) {
          result2.simples[result2.simples.length - 1].combinator = tokens[pos++].value;
          skipWhitespace();
        } else if (isSelectorClauseEnd()) {
          break;
        }
        result2.simples.push({ combinator: "", selector: consumeSimpleSelector() });
      }
      return result2;
    }
    function consumeSimpleSelector() {
      let rawCSSString = "";
      const functions = [];
      while (!isSelectorClauseEnd()) {
        if (isIdent() || isStar()) {
          rawCSSString += tokens[pos++].toSource();
        } else if (tokens[pos] instanceof HashToken) {
          rawCSSString += tokens[pos++].toSource();
        } else if (tokens[pos] instanceof DelimToken && tokens[pos].value === ".") {
          pos++;
          if (isIdent())
            rawCSSString += "." + tokens[pos++].toSource();
          else
            throw unexpected();
        } else if (tokens[pos] instanceof ColonToken) {
          pos++;
          if (isIdent()) {
            if (!customNames.has(tokens[pos].value.toLowerCase())) {
              rawCSSString += ":" + tokens[pos++].toSource();
            } else {
              const name = tokens[pos++].value.toLowerCase();
              functions.push({ name, args: [] });
              names.add(name);
            }
          } else if (isFunction()) {
            const name = tokens[pos++].value.toLowerCase();
            if (!customNames.has(name)) {
              rawCSSString += `:${name}(${consumeBuiltinFunctionArguments()})`;
            } else {
              functions.push({ name, args: consumeFunctionArguments() });
              names.add(name);
            }
            skipWhitespace();
            if (!isCloseParen())
              throw unexpected();
            pos++;
          } else {
            throw unexpected();
          }
        } else if (tokens[pos] instanceof OpenSquareToken) {
          rawCSSString += "[";
          pos++;
          while (!(tokens[pos] instanceof CloseSquareToken) && !isEOF())
            rawCSSString += tokens[pos++].toSource();
          if (!(tokens[pos] instanceof CloseSquareToken))
            throw unexpected();
          rawCSSString += "]";
          pos++;
        } else {
          throw unexpected();
        }
      }
      if (!rawCSSString && !functions.length)
        throw unexpected();
      return { css: rawCSSString || void 0, functions };
    }
    function consumeBuiltinFunctionArguments() {
      let s = "";
      let balance = 1;
      while (!isEOF()) {
        if (isOpenParen() || isFunction())
          balance++;
        if (isCloseParen())
          balance--;
        if (!balance)
          break;
        s += tokens[pos++].toSource();
      }
      return s;
    }
    const result = consumeFunctionArguments();
    if (!isEOF())
      throw unexpected();
    if (result.some((arg) => typeof arg !== "object" || !("simples" in arg)))
      throw new InvalidSelectorError(`Error while parsing css selector "${selector}". Did you mean to CSS.escape it?`);
    return { selector: result, names: Array.from(names) };
  }

  // src/browser/run/playwright-client/vendor/isomorphic/selectorParser.ts
  var kNestedSelectorNames = /* @__PURE__ */ new Set(["internal:has", "internal:has-not", "internal:and", "internal:or", "internal:chain", "left-of", "right-of", "above", "below", "near"]);
  var kNestedSelectorNamesWithDistance = /* @__PURE__ */ new Set(["left-of", "right-of", "above", "below", "near"]);
  var customCSSNames = /* @__PURE__ */ new Set(["not", "is", "where", "has", "scope", "light", "visible", "text", "text-matches", "text-is", "has-text", "above", "below", "right-of", "left-of", "near", "nth-match"]);
  function parseSelector(selector) {
    const parsedStrings = parseSelectorString(selector);
    const parts = [];
    for (const part of parsedStrings.parts) {
      if (part.name === "css" || part.name === "css:light") {
        if (part.name === "css:light")
          part.body = ":light(" + part.body + ")";
        const parsedCSS = parseCSS(part.body, customCSSNames);
        parts.push({
          name: "css",
          body: parsedCSS.selector,
          source: part.body
        });
        continue;
      }
      if (kNestedSelectorNames.has(part.name)) {
        let innerSelector;
        let distance;
        try {
          const unescaped = JSON.parse("[" + part.body + "]");
          if (!Array.isArray(unescaped) || unescaped.length < 1 || unescaped.length > 2 || typeof unescaped[0] !== "string")
            throw new InvalidSelectorError(`Malformed selector: ${part.name}=` + part.body);
          innerSelector = unescaped[0];
          if (unescaped.length === 2) {
            if (typeof unescaped[1] !== "number" || !kNestedSelectorNamesWithDistance.has(part.name))
              throw new InvalidSelectorError(`Malformed selector: ${part.name}=` + part.body);
            distance = unescaped[1];
          }
        } catch (e) {
          throw new InvalidSelectorError(`Malformed selector: ${part.name}=` + part.body);
        }
        const nested = { name: part.name, source: part.body, body: { parsed: parseSelector(innerSelector), distance } };
        const lastFrame = [...nested.body.parsed.parts].reverse().find((part2) => part2.name === "internal:control" && part2.body === "enter-frame");
        const lastFrameIndex = lastFrame ? nested.body.parsed.parts.indexOf(lastFrame) : -1;
        if (lastFrameIndex !== -1 && selectorPartsEqual(nested.body.parsed.parts.slice(0, lastFrameIndex + 1), parts.slice(0, lastFrameIndex + 1)))
          nested.body.parsed.parts.splice(0, lastFrameIndex + 1);
        parts.push(nested);
        continue;
      }
      parts.push({ ...part, source: part.body });
    }
    if (kNestedSelectorNames.has(parts[0].name))
      throw new InvalidSelectorError(`"${parts[0].name}" selector cannot be first`);
    return {
      capture: parsedStrings.capture,
      parts
    };
  }
  function selectorPartsEqual(list1, list2) {
    return stringifySelector({ parts: list1 }) === stringifySelector({ parts: list2 });
  }
  function stringifySelector(selector, forceEngineName) {
    if (typeof selector === "string")
      return selector;
    return selector.parts.map((p, i) => {
      let includeEngine = true;
      if (!forceEngineName && i !== selector.capture) {
        if (p.name === "css")
          includeEngine = false;
        else if (p.name === "xpath" && p.source.startsWith("//") || p.source.startsWith(".."))
          includeEngine = false;
      }
      const prefix = includeEngine ? p.name + "=" : "";
      return `${i === selector.capture ? "*" : ""}${prefix}${p.source}`;
    }).join(" >> ");
  }
  function parseSelectorString(selector) {
    let index = 0;
    let quote;
    let start = 0;
    const result = { parts: [] };
    const append = () => {
      const part = selector.substring(start, index).trim();
      const eqIndex = part.indexOf("=");
      let name;
      let body;
      if (eqIndex !== -1 && part.substring(0, eqIndex).trim().match(/^[a-zA-Z_0-9-+:*]+$/)) {
        name = part.substring(0, eqIndex).trim();
        body = part.substring(eqIndex + 1);
      } else if (part.length > 1 && part[0] === '"' && part[part.length - 1] === '"') {
        name = "text";
        body = part;
      } else if (part.length > 1 && part[0] === "'" && part[part.length - 1] === "'") {
        name = "text";
        body = part;
      } else if (/^\(*\/\//.test(part) || part.startsWith("..")) {
        name = "xpath";
        body = part;
      } else {
        name = "css";
        body = part;
      }
      let capture = false;
      if (name[0] === "*") {
        capture = true;
        name = name.substring(1);
      }
      result.parts.push({ name, body });
      if (capture) {
        if (result.capture !== void 0)
          throw new InvalidSelectorError(`Only one of the selectors can capture using * modifier`);
        result.capture = result.parts.length - 1;
      }
    };
    if (!selector.includes(">>")) {
      index = selector.length;
      append();
      return result;
    }
    const shouldIgnoreTextSelectorQuote = () => {
      const prefix = selector.substring(start, index);
      const match = prefix.match(/^\s*text\s*=(.*)$/);
      return !!match && !!match[1];
    };
    while (index < selector.length) {
      const c = selector[index];
      if (c === "\\" && index + 1 < selector.length) {
        index += 2;
      } else if (c === quote) {
        quote = void 0;
        index++;
      } else if (!quote && (c === '"' || c === "'" || c === "`") && !shouldIgnoreTextSelectorQuote()) {
        quote = c;
        index++;
      } else if (!quote && c === ">" && selector[index + 1] === ">") {
        append();
        index += 2;
        start = index;
      } else {
        index++;
      }
    }
    append();
    return result;
  }
  function parseAttributeSelector(selector, allowUnquotedStrings) {
    let wp = 0;
    let EOL = selector.length === 0;
    const next = () => selector[wp] || "";
    const eat1 = () => {
      const result2 = next();
      ++wp;
      EOL = wp >= selector.length;
      return result2;
    };
    const syntaxError = (stage) => {
      if (EOL)
        throw new InvalidSelectorError(`Unexpected end of selector while parsing selector \`${selector}\``);
      throw new InvalidSelectorError(`Error while parsing selector \`${selector}\` - unexpected symbol "${next()}" at position ${wp}` + (stage ? " during " + stage : ""));
    };
    function skipSpaces() {
      while (!EOL && /\s/.test(next()))
        eat1();
    }
    function isCSSNameChar(char) {
      return char >= "\x80" || char >= "0" && char <= "9" || char >= "A" && char <= "Z" || char >= "a" && char <= "z" || char >= "0" && char <= "9" || char === "_" || char === "-";
    }
    function readIdentifier() {
      let result2 = "";
      skipSpaces();
      while (!EOL && isCSSNameChar(next()))
        result2 += eat1();
      return result2;
    }
    function readQuotedString(quote) {
      let result2 = eat1();
      if (result2 !== quote)
        syntaxError("parsing quoted string");
      while (!EOL && next() !== quote) {
        if (next() === "\\")
          eat1();
        result2 += eat1();
      }
      if (next() !== quote)
        syntaxError("parsing quoted string");
      result2 += eat1();
      return result2;
    }
    function readRegularExpression() {
      if (eat1() !== "/")
        syntaxError("parsing regular expression");
      let source = "";
      let inClass = false;
      while (!EOL) {
        if (next() === "\\") {
          source += eat1();
          if (EOL)
            syntaxError("parsing regular expression");
        } else if (inClass && next() === "]") {
          inClass = false;
        } else if (!inClass && next() === "[") {
          inClass = true;
        } else if (!inClass && next() === "/") {
          break;
        }
        source += eat1();
      }
      if (eat1() !== "/")
        syntaxError("parsing regular expression");
      let flags = "";
      while (!EOL && next().match(/[dgimsuy]/))
        flags += eat1();
      try {
        return new RegExp(source, flags);
      } catch (e) {
        throw new InvalidSelectorError(`Error while parsing selector \`${selector}\`: ${e.message}`);
      }
    }
    function readAttributeToken() {
      let token = "";
      skipSpaces();
      if (next() === `'` || next() === `"`)
        token = readQuotedString(next()).slice(1, -1);
      else
        token = readIdentifier();
      if (!token)
        syntaxError("parsing property path");
      return token;
    }
    function readOperator() {
      skipSpaces();
      let op = "";
      if (!EOL)
        op += eat1();
      if (!EOL && op !== "=")
        op += eat1();
      if (!["=", "*=", "^=", "$=", "|=", "~="].includes(op))
        syntaxError("parsing operator");
      return op;
    }
    function readAttribute() {
      eat1();
      const jsonPath = [];
      jsonPath.push(readAttributeToken());
      skipSpaces();
      while (next() === ".") {
        eat1();
        jsonPath.push(readAttributeToken());
        skipSpaces();
      }
      if (next() === "]") {
        eat1();
        return { name: jsonPath.join("."), jsonPath, op: "<truthy>", value: null, caseSensitive: false };
      }
      const operator = readOperator();
      let value = void 0;
      let caseSensitive = true;
      skipSpaces();
      if (next() === "/") {
        if (operator !== "=")
          throw new InvalidSelectorError(`Error while parsing selector \`${selector}\` - cannot use ${operator} in attribute with regular expression`);
        value = readRegularExpression();
      } else if (next() === `'` || next() === `"`) {
        value = readQuotedString(next()).slice(1, -1);
        skipSpaces();
        if (next() === "i" || next() === "I") {
          caseSensitive = false;
          eat1();
        } else if (next() === "s" || next() === "S") {
          caseSensitive = true;
          eat1();
        }
      } else {
        value = "";
        while (!EOL && (isCSSNameChar(next()) || next() === "+" || next() === "."))
          value += eat1();
        if (value === "true") {
          value = true;
        } else if (value === "false") {
          value = false;
        } else {
          if (!allowUnquotedStrings) {
            value = +value;
            if (Number.isNaN(value))
              syntaxError("parsing attribute value");
          }
        }
      }
      skipSpaces();
      if (next() !== "]")
        syntaxError("parsing attribute value");
      eat1();
      if (operator !== "=" && typeof value !== "string")
        throw new InvalidSelectorError(`Error while parsing selector \`${selector}\` - cannot use ${operator} in attribute with non-string matching value - ${value}`);
      return { name: jsonPath.join("."), jsonPath, op: operator, value, caseSensitive };
    }
    const result = {
      name: "",
      attributes: []
    };
    result.name = readIdentifier();
    skipSpaces();
    while (next() === "[") {
      result.attributes.push(readAttribute());
      skipSpaces();
    }
    if (!EOL)
      syntaxError(void 0);
    if (!result.name && !result.attributes.length)
      throw new InvalidSelectorError(`Error while parsing selector \`${selector}\` - selector cannot be empty`);
    return result;
  }

  // src/browser/run/playwright-client/vendor/isomorphic/locatorGenerators.ts
  function asLocatorDescription(lang, selector) {
    try {
      const parsed = parseSelector(selector);
      const customDescription = parseCustomDescription(parsed);
      if (customDescription)
        return customDescription;
      return innerAsLocators(new generators[lang](), parsed, false, 1)[0];
    } catch (e) {
      return selector;
    }
  }
  function locatorCustomDescription(selector) {
    try {
      const parsed = parseSelector(selector);
      return parseCustomDescription(parsed);
    } catch (e) {
      return void 0;
    }
  }
  function parseCustomDescription(parsed) {
    const lastPart = parsed.parts[parsed.parts.length - 1];
    if (lastPart?.name === "internal:describe") {
      const description = JSON.parse(lastPart.body);
      if (typeof description === "string")
        return description;
    }
    return void 0;
  }
  function innerAsLocators(factory, parsed, isFrameLocator = false, maxOutputSize = 20) {
    const parts = [...parsed.parts];
    const tokens = [];
    let nextBase = isFrameLocator ? "frame-locator" : "page";
    for (let index = 0; index < parts.length; index++) {
      const part = parts[index];
      const base = nextBase;
      nextBase = "locator";
      if (part.name === "internal:describe")
        continue;
      if (part.name === "nth") {
        if (part.body === "0")
          tokens.push([factory.generateLocator(base, "first", ""), factory.generateLocator(base, "nth", "0")]);
        else if (part.body === "-1")
          tokens.push([factory.generateLocator(base, "last", ""), factory.generateLocator(base, "nth", "-1")]);
        else
          tokens.push([factory.generateLocator(base, "nth", part.body)]);
        continue;
      }
      if (part.name === "visible") {
        tokens.push([factory.generateLocator(base, "visible", part.body), factory.generateLocator(base, "default", `visible=${part.body}`)]);
        continue;
      }
      if (part.name === "internal:text") {
        const { exact, text } = detectExact(part.body);
        tokens.push([factory.generateLocator(base, "text", text, { exact })]);
        continue;
      }
      if (part.name === "internal:has-text") {
        const { exact, text } = detectExact(part.body);
        if (!exact) {
          tokens.push([factory.generateLocator(base, "has-text", text, { exact })]);
          continue;
        }
      }
      if (part.name === "internal:has-not-text") {
        const { exact, text } = detectExact(part.body);
        if (!exact) {
          tokens.push([factory.generateLocator(base, "has-not-text", text, { exact })]);
          continue;
        }
      }
      if (part.name === "internal:has") {
        const inners = innerAsLocators(factory, part.body.parsed, false, maxOutputSize);
        tokens.push(inners.map((inner) => factory.generateLocator(base, "has", inner)));
        continue;
      }
      if (part.name === "internal:has-not") {
        const inners = innerAsLocators(factory, part.body.parsed, false, maxOutputSize);
        tokens.push(inners.map((inner) => factory.generateLocator(base, "hasNot", inner)));
        continue;
      }
      if (part.name === "internal:and") {
        const inners = innerAsLocators(factory, part.body.parsed, false, maxOutputSize);
        tokens.push(inners.map((inner) => factory.generateLocator(base, "and", inner)));
        continue;
      }
      if (part.name === "internal:or") {
        const inners = innerAsLocators(factory, part.body.parsed, false, maxOutputSize);
        tokens.push(inners.map((inner) => factory.generateLocator(base, "or", inner)));
        continue;
      }
      if (part.name === "internal:chain") {
        const inners = innerAsLocators(factory, part.body.parsed, false, maxOutputSize);
        tokens.push(inners.map((inner) => factory.generateLocator(base, "chain", inner)));
        continue;
      }
      if (part.name === "internal:label") {
        const { exact, text } = detectExact(part.body);
        tokens.push([factory.generateLocator(base, "label", text, { exact })]);
        continue;
      }
      if (part.name === "internal:role") {
        const attrSelector = parseAttributeSelector(part.body, true);
        const options = { attrs: [] };
        for (const attr of attrSelector.attributes) {
          if (attr.name === "name") {
            if (options.exact !== void 0 && options.exact !== attr.caseSensitive)
              throw new Error(`Conflicting exactness in internal:role selector: ${stringifySelector({ parts: [part] })}`);
            options.exact = attr.caseSensitive;
            options.name = attr.value;
          } else if (attr.name === "description") {
            if (options.exact !== void 0 && options.exact !== attr.caseSensitive)
              throw new Error(`Conflicting exactness in internal:role selector: ${stringifySelector({ parts: [part] })}`);
            options.exact = attr.caseSensitive;
            options.description = attr.value;
          } else {
            if (attr.name === "level" && typeof attr.value === "string")
              attr.value = +attr.value;
            options.attrs.push({ name: attr.name === "include-hidden" ? "includeHidden" : attr.name, value: attr.value });
          }
        }
        tokens.push([factory.generateLocator(base, "role", attrSelector.name, options)]);
        continue;
      }
      if (part.name === "internal:testid") {
        const attrSelector = parseAttributeSelector(part.body, true);
        const { value } = attrSelector.attributes[0];
        tokens.push([factory.generateLocator(base, "test-id", value)]);
        continue;
      }
      if (part.name === "internal:attr") {
        const attrSelector = parseAttributeSelector(part.body, true);
        const { name, value, caseSensitive } = attrSelector.attributes[0];
        const text = value;
        const exact = !!caseSensitive;
        if (name === "placeholder") {
          tokens.push([factory.generateLocator(base, "placeholder", text, { exact })]);
          continue;
        }
        if (name === "alt") {
          tokens.push([factory.generateLocator(base, "alt", text, { exact })]);
          continue;
        }
        if (name === "title") {
          tokens.push([factory.generateLocator(base, "title", text, { exact })]);
          continue;
        }
      }
      if (part.name === "internal:control" && part.body === "enter-frame") {
        const lastTokens = tokens[tokens.length - 1];
        const lastPart = parts[index - 1];
        const transformed = lastTokens.map((token) => factory.chainLocators([token, factory.generateLocator(base, "frame", "")]));
        if (["xpath", "css"].includes(lastPart.name)) {
          transformed.push(
            factory.generateLocator(base, "frame-locator", stringifySelector({ parts: [lastPart] })),
            factory.generateLocator(base, "frame-locator", stringifySelector({ parts: [lastPart] }, true))
          );
        }
        lastTokens.splice(0, lastTokens.length, ...transformed);
        nextBase = "frame-locator";
        continue;
      }
      const nextPart = parts[index + 1];
      const selectorPart = stringifySelector({ parts: [part] });
      const locatorPart = factory.generateLocator(base, "default", selectorPart);
      if (nextPart && ["internal:has-text", "internal:has-not-text"].includes(nextPart.name)) {
        const { exact, text } = detectExact(nextPart.body);
        if (!exact) {
          const nextLocatorPart = factory.generateLocator("locator", nextPart.name === "internal:has-text" ? "has-text" : "has-not-text", text, { exact });
          const options = {};
          if (nextPart.name === "internal:has-text")
            options.hasText = text;
          else
            options.hasNotText = text;
          const combinedPart = factory.generateLocator(base, "default", selectorPart, options);
          tokens.push([factory.chainLocators([locatorPart, nextLocatorPart]), combinedPart]);
          index++;
          continue;
        }
      }
      let locatorPartWithEngine;
      if (["xpath", "css"].includes(part.name)) {
        const selectorPart2 = stringifySelector(
          { parts: [part] },
          /* forceEngineName */
          true
        );
        locatorPartWithEngine = factory.generateLocator(base, "default", selectorPart2);
      }
      tokens.push([locatorPart, locatorPartWithEngine].filter(Boolean));
    }
    return combineTokens(factory, tokens, maxOutputSize);
  }
  function combineTokens(factory, tokens, maxOutputSize) {
    const currentTokens = tokens.map(() => "");
    const result = [];
    const visit = (index) => {
      if (index === tokens.length) {
        result.push(factory.chainLocators(currentTokens));
        return result.length < maxOutputSize;
      }
      for (const taken of tokens[index]) {
        currentTokens[index] = taken;
        if (!visit(index + 1))
          return false;
      }
      return true;
    };
    visit(0);
    return result;
  }
  function detectExact(text) {
    let exact = false;
    const match = text.match(/^\/(.*)\/([igm]*)$/);
    if (match)
      return { text: new RegExp(match[1], match[2]) };
    if (text.endsWith('"')) {
      text = JSON.parse(text);
      exact = true;
    } else if (text.endsWith('"s')) {
      text = JSON.parse(text.substring(0, text.length - 1));
      exact = true;
    } else if (text.endsWith('"i')) {
      text = JSON.parse(text.substring(0, text.length - 1));
      exact = false;
    }
    return { exact, text };
  }
  var JavaScriptLocatorFactory = class {
    constructor(preferredQuote) {
      this.preferredQuote = preferredQuote;
    }
    preferredQuote;
    generateLocator(base, kind, body, options = {}) {
      switch (kind) {
        case "default":
          if (options.hasText !== void 0)
            return `locator(${this.quote(body)}, { hasText: ${this.toHasText(options.hasText)} })`;
          if (options.hasNotText !== void 0)
            return `locator(${this.quote(body)}, { hasNotText: ${this.toHasText(options.hasNotText)} })`;
          return `locator(${this.quote(body)})`;
        case "frame-locator":
          return `frameLocator(${this.quote(body)})`;
        case "frame":
          return `contentFrame()`;
        case "nth":
          return `nth(${body})`;
        case "first":
          return `first()`;
        case "last":
          return `last()`;
        case "visible":
          return `filter({ visible: ${body === "true" ? "true" : "false"} })`;
        case "role":
          const attrs = [];
          if (isRegExp4(options.name))
            attrs.push(`name: ${this.regexToSourceString(options.name)}`);
          else if (typeof options.name === "string")
            attrs.push(`name: ${this.quote(options.name)}`);
          if (isRegExp4(options.description))
            attrs.push(`description: ${this.regexToSourceString(options.description)}`);
          else if (typeof options.description === "string")
            attrs.push(`description: ${this.quote(options.description)}`);
          if (options.exact && (typeof options.name === "string" || typeof options.description === "string"))
            attrs.push(`exact: true`);
          for (const { name, value } of options.attrs)
            attrs.push(`${name}: ${typeof value === "string" ? this.quote(value) : value}`);
          const attrString = attrs.length ? `, { ${attrs.join(", ")} }` : "";
          return `getByRole(${this.quote(body)}${attrString})`;
        case "has-text":
          return `filter({ hasText: ${this.toHasText(body)} })`;
        case "has-not-text":
          return `filter({ hasNotText: ${this.toHasText(body)} })`;
        case "has":
          return `filter({ has: ${body} })`;
        case "hasNot":
          return `filter({ hasNot: ${body} })`;
        case "and":
          return `and(${body})`;
        case "or":
          return `or(${body})`;
        case "chain":
          return `locator(${body})`;
        case "test-id":
          return `getByTestId(${this.toTestIdValue(body)})`;
        case "text":
          return this.toCallWithExact("getByText", body, !!options.exact);
        case "alt":
          return this.toCallWithExact("getByAltText", body, !!options.exact);
        case "placeholder":
          return this.toCallWithExact("getByPlaceholder", body, !!options.exact);
        case "label":
          return this.toCallWithExact("getByLabel", body, !!options.exact);
        case "title":
          return this.toCallWithExact("getByTitle", body, !!options.exact);
        default:
          throw new Error("Unknown selector kind " + kind);
      }
    }
    chainLocators(locators) {
      return locators.join(".");
    }
    regexToSourceString(re2) {
      return normalizeEscapedRegexQuotes(String(re2));
    }
    toCallWithExact(method, body, exact) {
      if (isRegExp4(body))
        return `${method}(${this.regexToSourceString(body)})`;
      return exact ? `${method}(${this.quote(body)}, { exact: true })` : `${method}(${this.quote(body)})`;
    }
    toHasText(body) {
      if (isRegExp4(body))
        return this.regexToSourceString(body);
      return this.quote(body);
    }
    toTestIdValue(value) {
      if (isRegExp4(value))
        return this.regexToSourceString(value);
      return this.quote(value);
    }
    quote(text) {
      return escapeWithQuotes(text, this.preferredQuote ?? "'");
    }
  };
  var PythonLocatorFactory = class {
    generateLocator(base, kind, body, options = {}) {
      switch (kind) {
        case "default":
          if (options.hasText !== void 0)
            return `locator(${this.quote(body)}, has_text=${this.toHasText(options.hasText)})`;
          if (options.hasNotText !== void 0)
            return `locator(${this.quote(body)}, has_not_text=${this.toHasText(options.hasNotText)})`;
          return `locator(${this.quote(body)})`;
        case "frame-locator":
          return `frame_locator(${this.quote(body)})`;
        case "frame":
          return `content_frame`;
        case "nth":
          return `nth(${body})`;
        case "first":
          return `first`;
        case "last":
          return `last`;
        case "visible":
          return `filter(visible=${body === "true" ? "True" : "False"})`;
        case "role":
          const attrs = [];
          if (isRegExp4(options.name))
            attrs.push(`name=${this.regexToString(options.name)}`);
          else if (typeof options.name === "string")
            attrs.push(`name=${this.quote(options.name)}`);
          if (isRegExp4(options.description))
            attrs.push(`description=${this.regexToString(options.description)}`);
          else if (typeof options.description === "string")
            attrs.push(`description=${this.quote(options.description)}`);
          if (options.exact && (typeof options.name === "string" || typeof options.description === "string"))
            attrs.push(`exact=True`);
          for (const { name, value } of options.attrs) {
            let valueString = typeof value === "string" ? this.quote(value) : value;
            if (typeof value === "boolean")
              valueString = value ? "True" : "False";
            attrs.push(`${toSnakeCase(name)}=${valueString}`);
          }
          const attrString = attrs.length ? `, ${attrs.join(", ")}` : "";
          return `get_by_role(${this.quote(body)}${attrString})`;
        case "has-text":
          return `filter(has_text=${this.toHasText(body)})`;
        case "has-not-text":
          return `filter(has_not_text=${this.toHasText(body)})`;
        case "has":
          return `filter(has=${body})`;
        case "hasNot":
          return `filter(has_not=${body})`;
        case "and":
          return `and_(${body})`;
        case "or":
          return `or_(${body})`;
        case "chain":
          return `locator(${body})`;
        case "test-id":
          return `get_by_test_id(${this.toTestIdValue(body)})`;
        case "text":
          return this.toCallWithExact("get_by_text", body, !!options.exact);
        case "alt":
          return this.toCallWithExact("get_by_alt_text", body, !!options.exact);
        case "placeholder":
          return this.toCallWithExact("get_by_placeholder", body, !!options.exact);
        case "label":
          return this.toCallWithExact("get_by_label", body, !!options.exact);
        case "title":
          return this.toCallWithExact("get_by_title", body, !!options.exact);
        default:
          throw new Error("Unknown selector kind " + kind);
      }
    }
    chainLocators(locators) {
      return locators.join(".");
    }
    regexToString(body) {
      const suffix = body.flags.includes("i") ? ", re.IGNORECASE" : "";
      return `re.compile(r"${normalizeEscapedRegexQuotes(body.source).replace(/\\\//, "/").replace(/"/g, '\\"')}"${suffix})`;
    }
    toCallWithExact(method, body, exact) {
      if (isRegExp4(body))
        return `${method}(${this.regexToString(body)})`;
      if (exact)
        return `${method}(${this.quote(body)}, exact=True)`;
      return `${method}(${this.quote(body)})`;
    }
    toHasText(body) {
      if (isRegExp4(body))
        return this.regexToString(body);
      return `${this.quote(body)}`;
    }
    toTestIdValue(value) {
      if (isRegExp4(value))
        return this.regexToString(value);
      return this.quote(value);
    }
    quote(text) {
      return escapeWithQuotes(text, '"');
    }
  };
  var JavaLocatorFactory = class {
    generateLocator(base, kind, body, options = {}) {
      let clazz;
      switch (base) {
        case "page":
          clazz = "Page";
          break;
        case "frame-locator":
          clazz = "FrameLocator";
          break;
        case "locator":
          clazz = "Locator";
          break;
      }
      switch (kind) {
        case "default":
          if (options.hasText !== void 0)
            return `locator(${this.quote(body)}, new ${clazz}.LocatorOptions().setHasText(${this.toHasText(options.hasText)}))`;
          if (options.hasNotText !== void 0)
            return `locator(${this.quote(body)}, new ${clazz}.LocatorOptions().setHasNotText(${this.toHasText(options.hasNotText)}))`;
          return `locator(${this.quote(body)})`;
        case "frame-locator":
          return `frameLocator(${this.quote(body)})`;
        case "frame":
          return `contentFrame()`;
        case "nth":
          return `nth(${body})`;
        case "first":
          return `first()`;
        case "last":
          return `last()`;
        case "visible":
          return `filter(new ${clazz}.FilterOptions().setVisible(${body === "true" ? "true" : "false"}))`;
        case "role":
          const attrs = [];
          if (isRegExp4(options.name))
            attrs.push(`.setName(${this.regexToString(options.name)})`);
          else if (typeof options.name === "string")
            attrs.push(`.setName(${this.quote(options.name)})`);
          if (isRegExp4(options.description))
            attrs.push(`.setDescription(${this.regexToString(options.description)})`);
          else if (typeof options.description === "string")
            attrs.push(`.setDescription(${this.quote(options.description)})`);
          if (options.exact && (typeof options.name === "string" || typeof options.description === "string"))
            attrs.push(`.setExact(true)`);
          for (const { name, value } of options.attrs)
            attrs.push(`.set${toTitleCase(name)}(${typeof value === "string" ? this.quote(value) : value})`);
          const attrString = attrs.length ? `, new ${clazz}.GetByRoleOptions()${attrs.join("")}` : "";
          return `getByRole(AriaRole.${toSnakeCase(body).toUpperCase()}${attrString})`;
        case "has-text":
          return `filter(new ${clazz}.FilterOptions().setHasText(${this.toHasText(body)}))`;
        case "has-not-text":
          return `filter(new ${clazz}.FilterOptions().setHasNotText(${this.toHasText(body)}))`;
        case "has":
          return `filter(new ${clazz}.FilterOptions().setHas(${body}))`;
        case "hasNot":
          return `filter(new ${clazz}.FilterOptions().setHasNot(${body}))`;
        case "and":
          return `and(${body})`;
        case "or":
          return `or(${body})`;
        case "chain":
          return `locator(${body})`;
        case "test-id":
          return `getByTestId(${this.toTestIdValue(body)})`;
        case "text":
          return this.toCallWithExact(clazz, "getByText", body, !!options.exact);
        case "alt":
          return this.toCallWithExact(clazz, "getByAltText", body, !!options.exact);
        case "placeholder":
          return this.toCallWithExact(clazz, "getByPlaceholder", body, !!options.exact);
        case "label":
          return this.toCallWithExact(clazz, "getByLabel", body, !!options.exact);
        case "title":
          return this.toCallWithExact(clazz, "getByTitle", body, !!options.exact);
        default:
          throw new Error("Unknown selector kind " + kind);
      }
    }
    chainLocators(locators) {
      return locators.join(".");
    }
    regexToString(body) {
      const suffix = body.flags.includes("i") ? ", Pattern.CASE_INSENSITIVE" : "";
      return `Pattern.compile(${this.quote(normalizeEscapedRegexQuotes(body.source))}${suffix})`;
    }
    toCallWithExact(clazz, method, body, exact) {
      if (isRegExp4(body))
        return `${method}(${this.regexToString(body)})`;
      if (exact)
        return `${method}(${this.quote(body)}, new ${clazz}.${toTitleCase(method)}Options().setExact(true))`;
      return `${method}(${this.quote(body)})`;
    }
    toHasText(body) {
      if (isRegExp4(body))
        return this.regexToString(body);
      return this.quote(body);
    }
    toTestIdValue(value) {
      if (isRegExp4(value))
        return this.regexToString(value);
      return this.quote(value);
    }
    quote(text) {
      return escapeWithQuotes(text, '"');
    }
  };
  var CSharpLocatorFactory = class {
    generateLocator(base, kind, body, options = {}) {
      switch (kind) {
        case "default":
          if (options.hasText !== void 0)
            return `Locator(${this.quote(body)}, new() { ${this.toHasText(options.hasText)} })`;
          if (options.hasNotText !== void 0)
            return `Locator(${this.quote(body)}, new() { ${this.toHasNotText(options.hasNotText)} })`;
          return `Locator(${this.quote(body)})`;
        case "frame-locator":
          return `FrameLocator(${this.quote(body)})`;
        case "frame":
          return `ContentFrame`;
        case "nth":
          return `Nth(${body})`;
        case "first":
          return `First`;
        case "last":
          return `Last`;
        case "visible":
          return `Filter(new() { Visible = ${body === "true" ? "true" : "false"} })`;
        case "role":
          const attrs = [];
          if (isRegExp4(options.name))
            attrs.push(`NameRegex = ${this.regexToString(options.name)}`);
          else if (typeof options.name === "string")
            attrs.push(`Name = ${this.quote(options.name)}`);
          if (isRegExp4(options.description))
            attrs.push(`DescriptionRegex = ${this.regexToString(options.description)}`);
          else if (typeof options.description === "string")
            attrs.push(`Description = ${this.quote(options.description)}`);
          if (options.exact && (typeof options.name === "string" || typeof options.description === "string"))
            attrs.push(`Exact = true`);
          for (const { name, value } of options.attrs)
            attrs.push(`${toTitleCase(name)} = ${typeof value === "string" ? this.quote(value) : value}`);
          const attrString = attrs.length ? `, new() { ${attrs.join(", ")} }` : "";
          return `GetByRole(AriaRole.${toTitleCase(body)}${attrString})`;
        case "has-text":
          return `Filter(new() { ${this.toHasText(body)} })`;
        case "has-not-text":
          return `Filter(new() { ${this.toHasNotText(body)} })`;
        case "has":
          return `Filter(new() { Has = ${body} })`;
        case "hasNot":
          return `Filter(new() { HasNot = ${body} })`;
        case "and":
          return `And(${body})`;
        case "or":
          return `Or(${body})`;
        case "chain":
          return `Locator(${body})`;
        case "test-id":
          return `GetByTestId(${this.toTestIdValue(body)})`;
        case "text":
          return this.toCallWithExact("GetByText", body, !!options.exact);
        case "alt":
          return this.toCallWithExact("GetByAltText", body, !!options.exact);
        case "placeholder":
          return this.toCallWithExact("GetByPlaceholder", body, !!options.exact);
        case "label":
          return this.toCallWithExact("GetByLabel", body, !!options.exact);
        case "title":
          return this.toCallWithExact("GetByTitle", body, !!options.exact);
        default:
          throw new Error("Unknown selector kind " + kind);
      }
    }
    chainLocators(locators) {
      return locators.join(".");
    }
    regexToString(body) {
      const suffix = body.flags.includes("i") ? ", RegexOptions.IgnoreCase" : "";
      return `new Regex(${this.quote(normalizeEscapedRegexQuotes(body.source))}${suffix})`;
    }
    toCallWithExact(method, body, exact) {
      if (isRegExp4(body))
        return `${method}(${this.regexToString(body)})`;
      if (exact)
        return `${method}(${this.quote(body)}, new() { Exact = true })`;
      return `${method}(${this.quote(body)})`;
    }
    toHasText(body) {
      if (isRegExp4(body))
        return `HasTextRegex = ${this.regexToString(body)}`;
      return `HasText = ${this.quote(body)}`;
    }
    toTestIdValue(value) {
      if (isRegExp4(value))
        return this.regexToString(value);
      return this.quote(value);
    }
    toHasNotText(body) {
      if (isRegExp4(body))
        return `HasNotTextRegex = ${this.regexToString(body)}`;
      return `HasNotText = ${this.quote(body)}`;
    }
    quote(text) {
      return escapeWithQuotes(text, '"');
    }
  };
  var JsonlLocatorFactory = class {
    generateLocator(base, kind, body, options = {}) {
      return JSON.stringify({
        kind,
        body,
        options
      });
    }
    chainLocators(locators) {
      const objects = locators.map((l) => JSON.parse(l));
      for (let i = 0; i < objects.length - 1; ++i)
        objects[i].next = objects[i + 1];
      return JSON.stringify(objects[0]);
    }
  };
  var generators = {
    javascript: JavaScriptLocatorFactory,
    python: PythonLocatorFactory,
    java: JavaLocatorFactory,
    csharp: CSharpLocatorFactory,
    jsonl: JsonlLocatorFactory
  };
  function isRegExp4(obj) {
    return obj instanceof RegExp;
  }

  // src/browser/run/playwright-client/vendor/client/locator.ts
  var Locator = class _Locator {
    _frame;
    _selector;
    _apiName = "Locator";
    constructor(frame, selector, options) {
      this._frame = frame;
      this._selector = selector;
      if (options?.hasText)
        this._selector += ` >> internal:has-text=${escapeForTextSelector(options.hasText, false)}`;
      if (options?.hasNotText)
        this._selector += ` >> internal:has-not-text=${escapeForTextSelector(options.hasNotText, false)}`;
      if (options?.has) {
        const locator = options.has;
        if (locator._frame !== frame)
          throw new Error(`Inner "has" locator must belong to the same frame.`);
        this._selector += ` >> internal:has=` + JSON.stringify(locator._selector);
      }
      if (options?.hasNot) {
        const locator = options.hasNot;
        if (locator._frame !== frame)
          throw new Error(`Inner "hasNot" locator must belong to the same frame.`);
        this._selector += ` >> internal:has-not=` + JSON.stringify(locator._selector);
      }
      if (options?.visible !== void 0)
        this._selector += ` >> visible=${options.visible ? "true" : "false"}`;
      if (this._frame._platform.inspectCustom)
        this[this._frame._platform.inspectCustom] = () => this._inspect();
    }
    async _withElement(task, options) {
      const timeout = this._frame._timeout({ timeout: options.timeout });
      const deadline = timeout ? monotonicTime() + timeout : 0;
      return await this._frame._wrapApiCall(async () => {
        const result = await this._frame._channel.waitForSelector({ selector: this._selector, strict: true, state: "attached", timeout });
        const handle = ElementHandle.fromNullable(result.element);
        if (!handle)
          throw new Error(`Could not resolve ${this._selector} to DOM Element`);
        try {
          return await task(handle, deadline ? deadline - monotonicTime() : 0);
        } finally {
          await handle.dispose();
        }
      }, { title: options.title, internal: options.internal });
    }
    _equals(locator) {
      return this._frame === locator._frame && this._selector === locator._selector;
    }
    page() {
      return this._frame.page();
    }
    async boundingBox(options) {
      return await this._withElement((h) => h.boundingBox(), { title: "Bounding box", timeout: options?.timeout });
    }
    async check(options = {}) {
      return await this._frame.check(this._selector, { strict: true, ...options });
    }
    async click(options = {}) {
      return await this._frame.click(this._selector, { strict: true, ...options });
    }
    async dblclick(options = {}) {
      await this._frame.dblclick(this._selector, { strict: true, ...options });
    }
    async dispatchEvent(type, eventInit = {}, options) {
      return await this._frame.dispatchEvent(this._selector, type, eventInit, { strict: true, ...options });
    }
    async dragTo(target, options = {}) {
      return await this._frame.dragAndDrop(this._selector, target._selector, {
        strict: true,
        ...options
      });
    }
    async drop(payload, options = {}) {
      await this._frame._drop(this._selector, payload, { strict: true, ...options });
    }
    async evaluate(pageFunction, arg, options) {
      return await this._withElement((h) => h.evaluate(pageFunction, arg), { title: "Evaluate", timeout: options?.timeout });
    }
    async evaluateAll(pageFunction, arg) {
      return await this._frame.$$eval(this._selector, pageFunction, arg);
    }
    async evaluateHandle(pageFunction, arg, options) {
      return await this._withElement((h) => h.evaluateHandle(pageFunction, arg), { title: "Evaluate", timeout: options?.timeout });
    }
    async fill(value, options = {}) {
      return await this._frame.fill(this._selector, value, { strict: true, ...options });
    }
    async clear(options = {}) {
      await this._frame._wrapApiCall(() => this.fill("", options), { title: "Clear" });
    }
    async _highlight() {
      return await this._frame._highlight(this._selector);
    }
    async highlight(options = {}) {
      const style = typeof options.style === "object" ? cssObjectToString(options.style) : options.style;
      await this._frame._highlight(this._selector, style);
      return new DisposableStub(() => this.hideHighlight());
    }
    async hideHighlight() {
      await this._frame._hideHighlight(this._selector);
    }
    locator(selectorOrLocator, options) {
      if (isString(selectorOrLocator))
        return new _Locator(this._frame, this._selector + " >> " + selectorOrLocator, options);
      if (selectorOrLocator._frame !== this._frame)
        throw new Error(`Locators must belong to the same frame.`);
      return new _Locator(this._frame, this._selector + " >> internal:chain=" + JSON.stringify(selectorOrLocator._selector), options);
    }
    getByTestId(testId) {
      return this.locator(getByTestIdSelector(testIdAttributeName(), testId));
    }
    getByAltText(text, options) {
      return this.locator(getByAltTextSelector(text, options));
    }
    getByLabel(text, options) {
      return this.locator(getByLabelSelector(text, options));
    }
    getByPlaceholder(text, options) {
      return this.locator(getByPlaceholderSelector(text, options));
    }
    getByText(text, options) {
      return this.locator(getByTextSelector(text, options));
    }
    getByTitle(text, options) {
      return this.locator(getByTitleSelector(text, options));
    }
    getByRole(role, options = {}) {
      return this.locator(getByRoleSelector(role, options));
    }
    frameLocator(selector) {
      return new FrameLocator(this._frame, this._selector + " >> " + selector);
    }
    filter(options) {
      return new _Locator(this._frame, this._selector, options);
    }
    async elementHandle(options) {
      return await this._frame.waitForSelector(this._selector, { strict: true, state: "attached", ...options });
    }
    async elementHandles() {
      return await this._frame.$$(this._selector);
    }
    contentFrame() {
      return new FrameLocator(this._frame, this._selector);
    }
    describe(description) {
      return new _Locator(this._frame, this._selector + " >> internal:describe=" + JSON.stringify(description));
    }
    description() {
      return locatorCustomDescription(this._selector) || null;
    }
    first() {
      return new _Locator(this._frame, this._selector + " >> nth=0");
    }
    last() {
      return new _Locator(this._frame, this._selector + ` >> nth=-1`);
    }
    nth(index) {
      return new _Locator(this._frame, this._selector + ` >> nth=${index}`);
    }
    and(locator) {
      if (locator._frame !== this._frame)
        throw new Error(`Locators must belong to the same frame.`);
      return new _Locator(this._frame, this._selector + ` >> internal:and=` + JSON.stringify(locator._selector));
    }
    or(locator) {
      if (locator._frame !== this._frame)
        throw new Error(`Locators must belong to the same frame.`);
      return new _Locator(this._frame, this._selector + ` >> internal:or=` + JSON.stringify(locator._selector));
    }
    async focus(options) {
      return await this._frame.focus(this._selector, { strict: true, ...options });
    }
    async blur(options) {
      await this._frame._channel.blur({ selector: this._selector, strict: true, ...options, timeout: this._frame._timeout(options) });
    }
    // options are only here for testing
    async count(_options) {
      return await this._frame._queryCount(this._selector, _options);
    }
    async normalize() {
      const { resolvedSelector } = await this._frame._channel.resolveSelector({ selector: this._selector });
      return new _Locator(this._frame, resolvedSelector);
    }
    async getAttribute(name, options) {
      return await this._frame.getAttribute(this._selector, name, { strict: true, ...options });
    }
    async hover(options = {}) {
      return await this._frame.hover(this._selector, { strict: true, ...options });
    }
    async innerHTML(options) {
      return await this._frame.innerHTML(this._selector, { strict: true, ...options });
    }
    async innerText(options) {
      return await this._frame.innerText(this._selector, { strict: true, ...options });
    }
    async inputValue(options) {
      return await this._frame.inputValue(this._selector, { strict: true, ...options });
    }
    async isChecked(options) {
      return await this._frame.isChecked(this._selector, { strict: true, ...options });
    }
    async isDisabled(options) {
      return await this._frame.isDisabled(this._selector, { strict: true, ...options });
    }
    async isEditable(options) {
      return await this._frame.isEditable(this._selector, { strict: true, ...options });
    }
    async isEnabled(options) {
      return await this._frame.isEnabled(this._selector, { strict: true, ...options });
    }
    async isHidden(options) {
      return await this._frame.isHidden(this._selector, { strict: true, ...options });
    }
    async isVisible(options) {
      return await this._frame.isVisible(this._selector, { strict: true, ...options });
    }
    async press(key, options = {}) {
      return await this._frame.press(this._selector, key, { strict: true, ...options });
    }
    async screenshot(options = {}) {
      const mask = options.mask;
      return await this._withElement((h, timeout) => h.screenshot({ ...options, mask, timeout }), { title: "Screenshot", timeout: options.timeout });
    }
    async ariaSnapshot(options = {}) {
      const result = await this._frame._channel.ariaSnapshot({ timeout: this._frame._timeout(options), mode: options.mode, selector: this._selector, depth: options.depth, boxes: options.boxes });
      return result.snapshot;
    }
    async scrollIntoViewIfNeeded(options = {}) {
      return await this._withElement((h, timeout) => h.scrollIntoViewIfNeeded({ ...options, timeout }), { title: "Scroll into view", timeout: options.timeout });
    }
    async selectOption(values, options = {}) {
      return await this._frame.selectOption(this._selector, values, { strict: true, ...options });
    }
    async selectText(options = {}) {
      return await this._withElement((h, timeout) => h.selectText({ ...options, timeout }), { title: "Select text", timeout: options.timeout });
    }
    async setChecked(checked, options) {
      if (checked)
        await this.check(options);
      else
        await this.uncheck(options);
    }
    async setInputFiles(files, options = {}) {
      return await this._frame.setInputFiles(this._selector, files, { strict: true, ...options });
    }
    async tap(options = {}) {
      return await this._frame.tap(this._selector, { strict: true, ...options });
    }
    async textContent(options) {
      return await this._frame.textContent(this._selector, { strict: true, ...options });
    }
    async type(text, options = {}) {
      return await this._frame.type(this._selector, text, { strict: true, ...options });
    }
    async pressSequentially(text, options = {}) {
      return await this.type(text, options);
    }
    async uncheck(options = {}) {
      return await this._frame.uncheck(this._selector, { strict: true, ...options });
    }
    async all() {
      return new Array(await this.count()).fill(0).map((e, i) => this.nth(i));
    }
    async allInnerTexts() {
      return await this._frame.$$eval(this._selector, (ee) => ee.map((e) => e.innerText));
    }
    async allTextContents() {
      return await this._frame.$$eval(this._selector, (ee) => ee.map((e) => e.textContent || ""));
    }
    async waitFor(options) {
      await this._frame._channel.waitForSelector({ selector: this._selector, strict: true, omitReturnValue: true, ...options, timeout: this._frame._timeout(options) });
    }
    async _expect(expression, options) {
      return this._frame._expect(expression, {
        ...options,
        selector: this._selector
      });
    }
    _inspect() {
      return this.toString();
    }
    toString() {
      return asLocatorDescription("javascript", this._selector);
    }
  };
  var FrameLocator = class _FrameLocator {
    _frame;
    _frameSelector;
    constructor(frame, selector) {
      this._frame = frame;
      this._frameSelector = selector;
    }
    locator(selectorOrLocator, options) {
      if (isString(selectorOrLocator))
        return new Locator(this._frame, this._frameSelector + " >> internal:control=enter-frame >> " + selectorOrLocator, options);
      if (selectorOrLocator._frame !== this._frame)
        throw new Error(`Locators must belong to the same frame.`);
      return new Locator(this._frame, this._frameSelector + " >> internal:control=enter-frame >> " + selectorOrLocator._selector, options);
    }
    getByTestId(testId) {
      return this.locator(getByTestIdSelector(testIdAttributeName(), testId));
    }
    getByAltText(text, options) {
      return this.locator(getByAltTextSelector(text, options));
    }
    getByLabel(text, options) {
      return this.locator(getByLabelSelector(text, options));
    }
    getByPlaceholder(text, options) {
      return this.locator(getByPlaceholderSelector(text, options));
    }
    getByText(text, options) {
      return this.locator(getByTextSelector(text, options));
    }
    getByTitle(text, options) {
      return this.locator(getByTitleSelector(text, options));
    }
    getByRole(role, options = {}) {
      return this.locator(getByRoleSelector(role, options));
    }
    owner() {
      return new Locator(this._frame, this._frameSelector);
    }
    frameLocator(selector) {
      return new _FrameLocator(this._frame, this._frameSelector + " >> internal:control=enter-frame >> " + selector);
    }
    first() {
      return new _FrameLocator(this._frame, this._frameSelector + " >> nth=0");
    }
    last() {
      return new _FrameLocator(this._frame, this._frameSelector + ` >> nth=-1`);
    }
    nth(index) {
      return new _FrameLocator(this._frame, this._frameSelector + ` >> nth=${index}`);
    }
  };
  var _testIdAttributeName = "data-testid";
  function testIdAttributeName() {
    return _testIdAttributeName;
  }
  function setTestIdAttribute(attributeName) {
    _testIdAttributeName = attributeName;
  }
  function cssObjectToString(style) {
    return Object.entries(style).map(([key, value]) => {
      const property = key.startsWith("--") ? key : key.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
      return `${property}: ${value}`;
    }).join("; ");
  }

  // src/browser/run/playwright-client/vendor/isomorphic/multimap.ts
  var MultiMap = class {
    _map;
    constructor() {
      this._map = /* @__PURE__ */ new Map();
    }
    set(key, value) {
      let values = this._map.get(key);
      if (!values) {
        values = [];
        this._map.set(key, values);
      }
      values.push(value);
    }
    get(key) {
      return this._map.get(key) || [];
    }
    has(key) {
      return this._map.has(key);
    }
    delete(key, value) {
      const values = this._map.get(key);
      if (!values)
        return;
      if (values.includes(value))
        this._map.set(key, values.filter((v) => value !== v));
    }
    deleteAll(key) {
      this._map.delete(key);
    }
    hasValue(key, value) {
      const values = this._map.get(key);
      if (!values)
        return false;
      return values.includes(value);
    }
    get size() {
      return this._map.size;
    }
    [Symbol.iterator]() {
      return this._map[Symbol.iterator]();
    }
    keys() {
      return this._map.keys();
    }
    values() {
      const result = [];
      for (const key of this.keys())
        result.push(...this.get(key));
      return result;
    }
    clear() {
      this._map.clear();
    }
  };

  // src/browser/run/playwright-client/vendor/client/timeoutSettings.ts
  var TimeoutSettings = class {
    _parent;
    _defaultTimeout;
    _defaultNavigationTimeout;
    _platform;
    constructor(platform, parent) {
      this._parent = parent;
      this._platform = platform;
    }
    setDefaultTimeout(timeout) {
      this._defaultTimeout = timeout;
    }
    setDefaultNavigationTimeout(timeout) {
      this._defaultNavigationTimeout = timeout;
    }
    defaultNavigationTimeout() {
      return this._defaultNavigationTimeout;
    }
    defaultTimeout() {
      return this._defaultTimeout;
    }
    navigationTimeout(options) {
      if (typeof options.timeout === "number")
        return options.timeout;
      if (this._defaultNavigationTimeout !== void 0)
        return this._defaultNavigationTimeout;
      if (this._platform.isDebugMode())
        return 0;
      if (this._defaultTimeout !== void 0)
        return this._defaultTimeout;
      if (this._parent)
        return this._parent.navigationTimeout(options);
      return DEFAULT_PLAYWRIGHT_TIMEOUT;
    }
    timeout(options) {
      if (typeof options.timeout === "number")
        return options.timeout;
      if (this._platform.isDebugMode())
        return 0;
      if (this._defaultTimeout !== void 0)
        return this._defaultTimeout;
      if (this._parent)
        return this._parent.timeout(options);
      return DEFAULT_PLAYWRIGHT_TIMEOUT;
    }
    launchTimeout(options) {
      if (typeof options.timeout === "number")
        return options.timeout;
      if (this._platform.isDebugMode())
        return 0;
      if (this._parent)
        return this._parent.launchTimeout(options);
      return DEFAULT_PLAYWRIGHT_LAUNCH_TIMEOUT;
    }
  };

  // src/browser/run/playwright-client/vendor/client/waiter.ts
  var Waiter = class _Waiter {
    _dispose;
    _failures = [];
    _immediateError;
    _logs = [];
    _channelOwner;
    _waitId;
    _error;
    _savedZone;
    constructor(channelOwner, event) {
      this._waitId = channelOwner._platform.createGuid();
      this._channelOwner = channelOwner;
      this._savedZone = channelOwner._platform.zones.current().pop();
      const title = `Wait for event "${event}"`;
      this._sendWaitInfo({ waitId: this._waitId, phase: "before", event }, { title });
      this._dispose = [
        () => this._sendWaitInfo({ waitId: this._waitId, phase: "after", error: this._error }, { internal: true })
      ];
    }
    static createForEvent(channelOwner, event) {
      return new _Waiter(channelOwner, event);
    }
    _sendWaitInfo(info, options) {
      const owner = this._channelOwner;
      owner._wrapApiCall(async (apiZone) => {
        if (apiZone.internal || apiZone.reported) {
          void owner._connection.sendMessageToServer(owner, "__waitInfo__", info, { internal: true });
          return;
        }
        apiZone.reported = true;
        if (!apiZone.title)
          apiZone.title = options.title;
        owner._instrumentation.onApiCallBegin(apiZone, { type: owner._type, method: "__waitInfo__", params: info });
        void owner._connection.sendMessageToServer(owner, "__waitInfo__", info, apiZone);
      }, options).catch(() => {
      });
    }
    async waitForEvent(emitter, event, predicate) {
      const { promise, dispose } = waitForEvent(emitter, event, this._savedZone, predicate);
      return await this.waitForPromise(promise, dispose);
    }
    rejectOnEvent(emitter, event, error, predicate) {
      const { promise, dispose } = waitForEvent(emitter, event, this._savedZone, predicate);
      this._rejectOn(promise.then(() => {
        throw typeof error === "function" ? error() : error;
      }), dispose);
    }
    rejectOnTimeout(timeout, message) {
      if (!timeout)
        return;
      const { promise, dispose } = waitForTimeout(timeout);
      this._rejectOn(promise.then(() => {
        throw new TimeoutError(message);
      }), dispose);
    }
    rejectImmediately(error) {
      this._immediateError = error;
    }
    dispose() {
      for (const dispose of this._dispose)
        dispose();
    }
    async waitForPromise(promise, dispose) {
      try {
        if (this._immediateError)
          throw this._immediateError;
        const result = await Promise.race([promise, ...this._failures]);
        if (dispose)
          dispose();
        return result;
      } catch (e) {
        if (dispose)
          dispose();
        this._error = e.message;
        this.dispose();
        rewriteErrorMessage(e, e.message + formatLogRecording(this._logs));
        throw e;
      }
    }
    log(s) {
      this._logs.push(s);
      this._sendWaitInfo({ waitId: this._waitId, phase: "log", message: s }, { internal: true });
    }
    _rejectOn(promise, dispose) {
      this._failures.push(promise);
      if (dispose)
        this._dispose.push(dispose);
    }
  };
  function waitForEvent(emitter, event, savedZone, predicate) {
    let listener;
    const promise = new Promise((resolve, reject) => {
      listener = async (eventArg) => {
        await savedZone.run(async () => {
          try {
            if (predicate && !await predicate(eventArg))
              return;
            emitter.removeListener(event, listener);
            resolve(eventArg);
          } catch (e) {
            emitter.removeListener(event, listener);
            reject(e);
          }
        });
      };
      emitter.addListener(event, listener);
    });
    const dispose = () => emitter.removeListener(event, listener);
    return { promise, dispose };
  }
  function waitForTimeout(timeout) {
    let timeoutId;
    const promise = new Promise((resolve) => timeoutId = setTimeout(resolve, timeout));
    const dispose = () => clearTimeout(timeoutId);
    return { promise, dispose };
  }
  function formatLogRecording(log) {
    if (!log.length)
      return "";
    const header = ` logs `;
    const headerLength = 60;
    const leftLength = (headerLength - header.length) / 2;
    const rightLength = headerLength - header.length - leftLength;
    return `
${"=".repeat(leftLength)}${header}${"=".repeat(rightLength)}
${log.join("\n")}
${"=".repeat(headerLength)}`;
  }

  // src/browser/run/playwright-client/vendor/client/worker.ts
  var Worker = class _Worker extends ChannelOwner {
    _page;
    // Set for web workers.
    _context;
    // Set for service workers.
    _closedScope = new LongStandingScope();
    _closeReason;
    static fromNullable(worker) {
      return worker ? _Worker.from(worker) : null;
    }
    static from(worker) {
      return worker._object;
    }
    constructor(parent, type, guid, initializer) {
      super(parent, type, guid, initializer);
      this._setEventToSubscriptionMapping(/* @__PURE__ */ new Map([
        [Events.Worker.Console, "console"]
      ]));
      this._channel.on("console", (event) => {
        this.emit(Events.Worker.Console, new ConsoleMessage(this._platform, event, null, this));
      });
      this._channel.on("close", () => {
        if (this._page)
          this._page._workers.delete(this);
        if (this._context)
          this._context._serviceWorkers.delete(this);
        this.emit(Events.Worker.Close, this);
      });
      this.once(Events.Worker.Close, () => this._closedScope.close(this._closeErrorWithReason()));
    }
    _closeErrorWithReason() {
      if (this._closeReason)
        return new TargetClosedError(this._closeReason);
      return this._page?._closeErrorWithReason() || new TargetClosedError();
    }
    url() {
      return this._initializer.url;
    }
    async evaluate(pageFunction, arg) {
      assertMaxArguments(arguments.length, 2);
      const result = await this._channel.evaluateExpression({ expression: String(pageFunction), isFunction: typeof pageFunction === "function", arg: serializeArgument(arg) });
      return parseResult(result.value);
    }
    async evaluateHandle(pageFunction, arg) {
      assertMaxArguments(arguments.length, 2);
      const result = await this._channel.evaluateExpressionHandle({ expression: String(pageFunction), isFunction: typeof pageFunction === "function", arg: serializeArgument(arg) });
      return JSHandle.from(result.handle);
    }
    async waitForEvent(event, optionsOrPredicate = {}) {
      return await this._wrapApiCall(async () => {
        const timeoutSettings = this._page?._timeoutSettings ?? this._context?._timeoutSettings ?? new TimeoutSettings(this._platform);
        const timeout = timeoutSettings.timeout(typeof optionsOrPredicate === "function" ? {} : optionsOrPredicate);
        const predicate = typeof optionsOrPredicate === "function" ? optionsOrPredicate : optionsOrPredicate.predicate;
        const waiter = Waiter.createForEvent(this, event);
        waiter.rejectOnTimeout(timeout, `Timeout ${timeout}ms exceeded while waiting for event "${event}"`);
        if (event !== Events.Worker.Close)
          waiter.rejectOnEvent(this, Events.Worker.Close, () => this._closeErrorWithReason());
        const result = await waiter.waitForEvent(this, event, predicate);
        waiter.dispose();
        return result;
      });
    }
    async _disconnect(options = {}) {
      this._closeReason = options.reason;
      try {
        await this._channel.disconnect(options);
      } catch (e) {
        if (isTargetClosedError(e))
          return;
        throw e;
      }
    }
  };

  // src/browser/run/playwright-client/vendor/client/tracing.ts
  var Tracing = class extends ChannelOwner {
    _includeSources = false;
    _additionalSources = /* @__PURE__ */ new Set();
    _isLive = false;
    _tracesDir;
    _stacksId;
    _isTracing = false;
    _harId;
    _harRecorders = /* @__PURE__ */ new Map();
    static from(channel) {
      return channel._object;
    }
    constructor(parent, type, guid, initializer) {
      super(parent, type, guid, initializer);
    }
    async start(options = {}) {
      await this._wrapApiCall(async () => {
        this._includeSources = !!options.sources;
        this._isLive = !!options.live;
        await this._channel.tracingStart({
          name: options.name,
          snapshots: options.snapshots,
          screenshots: options.screenshots,
          live: options.live
        });
        const { traceName } = await this._channel.tracingStartChunk({ name: options.name, title: options.title });
        await this._startCollectingStacks(traceName, this._isLive);
      });
    }
    async startChunk(options = {}) {
      await this._wrapApiCall(async () => {
        const { traceName } = await this._channel.tracingStartChunk(options);
        await this._startCollectingStacks(traceName, this._isLive);
      });
    }
    async group(name, options = {}) {
      if (options.location)
        this._additionalSources.add(options.location.file);
      await this._channel.tracingGroup({ name, location: options.location });
      return new DisposableStub(() => this.groupEnd());
    }
    async groupEnd() {
      await this._channel.tracingGroupEnd();
    }
    async _startCollectingStacks(traceName, live) {
      if (!this._isTracing) {
        this._isTracing = true;
        this._connection.setIsTracing(true);
      }
      const result = await this._connection.localUtils()?.tracingStarted({ tracesDir: this._tracesDir, traceName, live });
      this._stacksId = result?.stacksId;
    }
    async stopChunk(options = {}) {
      await this._wrapApiCall(async () => {
        await this._doStopChunk(options.path);
      });
    }
    async stop(options = {}) {
      await this._wrapApiCall(async () => {
        await this._doStopChunk(options.path);
        await this._channel.tracingStop();
      });
    }
    async startHar(path, options = {}) {
      await this._wrapApiCall(async () => {
        if (this._harId)
          throw new Error("HAR recording has already been started");
        if (options.resourcesDir && path.endsWith(".zip"))
          throw new Error("resourcesDir option is not compatible with a .zip har file");
        const defaultContent = path.endsWith(".zip") ? "attach" : "embed";
        this._harId = await this._recordIntoHAR(path, null, {
          url: options.urlFilter,
          updateContent: options.content ?? defaultContent,
          updateMode: options.mode ?? "full",
          resourcesDir: options.resourcesDir
        });
      });
      return new DisposableStub(() => this.stopHar());
    }
    async stopHar() {
      await this._wrapApiCall(async () => {
        const harId = this._harId;
        if (!harId)
          throw new Error("HAR recording has not been started");
        this._harId = void 0;
        await this._exportHAR(harId);
      });
    }
    async _recordIntoHAR(har, page, options = {}) {
      const isZip = har.endsWith(".zip");
      const { harId } = await this._channel.harStart({
        page: page?._channel,
        options: {
          content: options.updateContent ?? "attach",
          urlGlob: isString(options.url) ? options.url : void 0,
          urlRegexSource: isRegExp(options.url) ? options.url.source : void 0,
          urlRegexFlags: isRegExp(options.url) ? options.url.flags : void 0,
          mode: options.updateMode ?? "minimal",
          harPath: isZip ? void 0 : har,
          resourcesDir: options.resourcesDir
        }
      });
      this._harRecorders.set(harId, { path: har, resourcesDir: options.resourcesDir });
      return harId;
    }
    async _exportHAR(harId) {
      const harParams = this._harRecorders.get(harId);
      if (!harParams)
        return;
      this._harRecorders.delete(harId);
      const isLocal = !this._connection.isRemote();
      const isZip = harParams.path.endsWith(".zip");
      if (isLocal) {
        const { entries } = await this._channel.harExport({ harId, mode: "entries" });
        if (!isZip) {
          return;
        }
        const localUtils2 = this._connection.localUtils();
        if (!localUtils2)
          throw new Error("Cannot save zipped HAR in thin clients");
        await localUtils2.zip({ zipFile: harParams.path, entries, mode: "write", includeSources: false, additionalSources: [] });
        return;
      }
      const { artifact: artifactChannel } = await this._channel.harExport({ harId, mode: "archive" });
      const artifact = Artifact.from(artifactChannel);
      if (isZip) {
        await artifact.saveAs(harParams.path);
        await artifact.delete();
        return;
      }
      const localUtils = this._connection.localUtils();
      if (!localUtils)
        throw new Error("Uncompressed har is not supported in thin clients");
      await artifact.saveAs(harParams.path + ".tmp");
      await localUtils.harUnzip({ zipFile: harParams.path + ".tmp", harFile: harParams.path, resourcesDir: harParams.resourcesDir });
      await artifact.delete();
    }
    async _exportAllHars() {
      await this._wrapApiCall(async () => {
        await Promise.all([...this._harRecorders.keys()].map((harId) => this._exportHAR(harId)));
      }, { internal: true });
    }
    async _doStopChunk(filePath) {
      this._resetStackCounter();
      const additionalSources = [...this._additionalSources];
      this._additionalSources.clear();
      if (!filePath) {
        await this._channel.tracingStopChunk({ mode: "discard" });
        if (this._stacksId)
          await this._connection.localUtils().traceDiscarded({ stacksId: this._stacksId });
        return;
      }
      const localUtils = this._connection.localUtils();
      if (!localUtils)
        throw new Error("Cannot save trace in thin clients");
      const isLocal = !this._connection.isRemote();
      if (isLocal) {
        const result2 = await this._channel.tracingStopChunk({ mode: "entries" });
        await localUtils.zip({ zipFile: filePath, entries: result2.entries, mode: "write", stacksId: this._stacksId, includeSources: this._includeSources, additionalSources });
        return;
      }
      const result = await this._channel.tracingStopChunk({ mode: "archive" });
      if (!result.artifact) {
        if (this._stacksId)
          await localUtils.traceDiscarded({ stacksId: this._stacksId });
        return;
      }
      const artifact = Artifact.from(result.artifact);
      await artifact.saveAs(filePath);
      await artifact.delete();
      await localUtils.zip({ zipFile: filePath, entries: [], mode: "append", stacksId: this._stacksId, includeSources: this._includeSources, additionalSources });
    }
    _resetStackCounter() {
      if (this._isTracing) {
        this._isTracing = false;
        this._connection.setIsTracing(false);
      }
    }
  };

  // src/browser/run/playwright-client/vendor/client/fileUtils.ts
  var fileUploadSizeLimit = 50 * 1024 * 1024;
  async function mkdirIfNeeded(platform, filePath) {
    await platform.fs().promises.mkdir(platform.path().dirname(filePath), { recursive: true }).catch(() => {
    });
  }

  // src/browser/run/playwright-client/vendor/client/fetch.ts
  var APIRequest = class {
    _playwright;
    _contexts = /* @__PURE__ */ new Set();
    constructor(playwright) {
      this._playwright = playwright;
    }
    async newContext(options = {}) {
      options = { ...options };
      await this._playwright._instrumentation.runBeforeCreateRequestContext(options);
      const storageState = typeof options.storageState === "string" ? JSON.parse(await this._playwright._platform.fs().promises.readFile(options.storageState, "utf8")) : options.storageState;
      const context = APIRequestContext.from((await this._playwright._channel.newRequest({
        ...options,
        extraHTTPHeaders: options.extraHTTPHeaders ? headersObjectToArray(options.extraHTTPHeaders) : void 0,
        storageState,
        tracesDir: this._playwright._defaultLaunchOptions?.tracesDir,
        // We do not expose tracesDir in the API, so do not allow options to accidentally override it.
        clientCertificates: await toClientCertificatesProtocol(this._playwright._platform, options.clientCertificates)
      })).request);
      this._contexts.add(context);
      context._request = this;
      context._timeoutSettings.setDefaultTimeout(options.timeout ?? this._playwright._defaultContextTimeout);
      context.tracing._tracesDir = this._playwright._defaultLaunchOptions?.tracesDir;
      await context._instrumentation.runAfterCreateRequestContext(context);
      return context;
    }
  };
  var APIRequestContext = class extends ChannelOwner {
    _request;
    tracing;
    _closeReason;
    _timeoutSettings;
    static from(channel) {
      return channel._object;
    }
    constructor(parent, type, guid, initializer) {
      super(parent, type, guid, initializer);
      this.tracing = Tracing.from(initializer.tracing);
      this._timeoutSettings = new TimeoutSettings(this._platform);
    }
    async [Symbol.asyncDispose]() {
      await this.dispose();
    }
    async dispose(options = {}) {
      this._closeReason = options.reason;
      await this._instrumentation.runBeforeCloseRequestContext(this);
      await this.tracing._exportAllHars();
      try {
        await this._channel.dispose(options);
      } catch (e) {
        if (isTargetClosedError(e))
          return;
        throw e;
      }
      this.tracing._resetStackCounter();
      this._request?._contexts.delete(this);
    }
    async delete(url, options) {
      return await this.fetch(url, {
        ...options,
        method: "DELETE"
      });
    }
    async head(url, options) {
      return await this.fetch(url, {
        ...options,
        method: "HEAD"
      });
    }
    async get(url, options) {
      return await this.fetch(url, {
        ...options,
        method: "GET"
      });
    }
    async patch(url, options) {
      return await this.fetch(url, {
        ...options,
        method: "PATCH"
      });
    }
    async post(url, options) {
      return await this.fetch(url, {
        ...options,
        method: "POST"
      });
    }
    async put(url, options) {
      return await this.fetch(url, {
        ...options,
        method: "PUT"
      });
    }
    async fetch(urlOrRequest, options = {}) {
      const url = isString(urlOrRequest) ? urlOrRequest : void 0;
      const request = isString(urlOrRequest) ? void 0 : urlOrRequest;
      return await this._innerFetch({ url, request, ...options });
    }
    async _innerFetch(options = {}) {
      return await this._wrapApiCall(async () => {
        if (this._closeReason)
          throw new TargetClosedError(this._closeReason);
        assert(options.request || typeof options.url === "string", "First argument must be either URL string or Request");
        assert((options.data === void 0 ? 0 : 1) + (options.form === void 0 ? 0 : 1) + (options.multipart === void 0 ? 0 : 1) <= 1, `Only one of 'data', 'form' or 'multipart' can be specified`);
        assert(options.maxRedirects === void 0 || options.maxRedirects >= 0, `'maxRedirects' must be greater than or equal to '0'`);
        assert(options.maxRetries === void 0 || options.maxRetries >= 0, `'maxRetries' must be greater than or equal to '0'`);
        const url = options.url !== void 0 ? options.url : options.request.url();
        const method = options.method || options.request?.method();
        let encodedParams = void 0;
        if (typeof options.params === "string")
          encodedParams = options.params;
        else if (globalThis.URLSearchParams && options.params instanceof URLSearchParams)
          encodedParams = options.params.toString();
        const headersObj = options.headers || options.request?.headers();
        const headers = headersObj ? headersObjectToArray(headersObj) : void 0;
        let jsonData;
        let formData;
        let multipartData;
        let postDataBuffer;
        if (options.data !== void 0) {
          if (isString(options.data)) {
            if (isJsonContentType(headers))
              jsonData = isJsonParsable(options.data) ? options.data : JSON.stringify(options.data);
            else
              postDataBuffer = quickjsEncoding.encodeText(options.data);
          } else if (options.data instanceof Uint8Array) {
            postDataBuffer = options.data;
          } else if (typeof options.data === "object" || typeof options.data === "number" || typeof options.data === "boolean") {
            jsonData = JSON.stringify(options.data);
          } else {
            throw new Error(`Unexpected 'data' type`);
          }
        } else if (options.form) {
          if (globalThis.FormData && options.form instanceof FormData) {
            formData = [];
            for (const [name, value] of options.form.entries()) {
              if (typeof value !== "string")
                throw new Error(`Expected string for options.form["${name}"], found File. Please use options.multipart instead.`);
              formData.push({ name, value });
            }
          } else {
            formData = objectToArray(options.form);
          }
        } else if (options.multipart) {
          multipartData = [];
          if (globalThis.FormData && options.multipart instanceof FormData) {
            const form = options.multipart;
            for (const [name, value] of form.entries()) {
              if (isString(value)) {
                multipartData.push({ name, value });
              } else {
                const file = {
                  name: value.name,
                  mimeType: value.type,
                  buffer: Buffer.from(await value.arrayBuffer())
                };
                multipartData.push({ name, file });
              }
            }
          } else {
            for (const [name, value] of Object.entries(options.multipart))
              multipartData.push(await toFormField(this._platform, name, value));
          }
        }
        if (postDataBuffer === void 0 && jsonData === void 0 && formData === void 0 && multipartData === void 0)
          postDataBuffer = options.request?.postDataBuffer() || void 0;
        const fixtures = {
          __testHookLookup: options.__testHookLookup
        };
        const result = await this._channel.fetch({
          url,
          params: typeof options.params === "object" ? objectToArray(options.params) : void 0,
          encodedParams,
          method,
          headers,
          postData: postDataBuffer,
          jsonData,
          formData,
          multipartData,
          timeout: this._timeoutSettings.timeout(options),
          failOnStatusCode: options.failOnStatusCode,
          ignoreHTTPSErrors: options.ignoreHTTPSErrors,
          maxRedirects: options.maxRedirects,
          maxRetries: options.maxRetries,
          ...fixtures
        });
        return new APIResponse(this, result.response);
      });
    }
    async storageState(options = {}) {
      const state = await this._channel.storageState({ indexedDB: options.indexedDB });
      if (options.path) {
        await mkdirIfNeeded(this._platform, options.path);
        await this._platform.fs().promises.writeFile(options.path, JSON.stringify(state, void 0, 2), "utf8");
      }
      return state;
    }
  };
  async function toFormField(platform, name, value) {
    const typeOfValue = typeof value;
    if (isFilePayload(value)) {
      const payload = value;
      if (!(payload.buffer instanceof Uint8Array))
        throw new Error(`Unexpected buffer type of 'data.${name}'`);
      return { name, file: filePayloadToJson(payload) };
    } else if (typeOfValue === "string" || typeOfValue === "number" || typeOfValue === "boolean") {
      return { name, value: String(value) };
    } else {
      return { name, file: await readStreamToJson(platform, value) };
    }
  }
  function isJsonParsable(value) {
    if (typeof value !== "string")
      return false;
    try {
      JSON.parse(value);
      return true;
    } catch (e) {
      if (e instanceof SyntaxError)
        return false;
      else
        throw e;
    }
  }
  var APIResponse = class {
    _initializer;
    _headers;
    _request;
    _apiName = "APIResponse";
    constructor(context, initializer) {
      this._request = context;
      this._initializer = initializer;
      this._headers = new RawHeaders(this._initializer.headers);
      if (context._platform.inspectCustom)
        this[context._platform.inspectCustom] = () => this._inspect();
    }
    ok() {
      return this._initializer.status >= 200 && this._initializer.status <= 299;
    }
    url() {
      return this._initializer.url;
    }
    status() {
      return this._initializer.status;
    }
    statusText() {
      return this._initializer.statusText;
    }
    headers() {
      return this._headers.headers();
    }
    headersArray() {
      return this._headers.headersArray();
    }
    async securityDetails() {
      return this._initializer.securityDetails ?? null;
    }
    async serverAddr() {
      return this._initializer.serverAddr ?? null;
    }
    async body() {
      return await this._request._wrapApiCall(async () => {
        try {
          const result = await this._request._channel.fetchResponseBody({ fetchUid: this._fetchUid() });
          if (result.binary === void 0)
            throw new Error("Response has been disposed");
          return result.binary;
        } catch (e) {
          if (isTargetClosedError(e))
            throw new Error("Response has been disposed");
          throw e;
        }
      }, { internal: true });
    }
    async text() {
      const content = await this.body();
      return quickjsEncoding.decodeText(content);
    }
    async json() {
      const content = await this.text();
      return JSON.parse(content);
    }
    async [Symbol.asyncDispose]() {
      await this.dispose();
    }
    async dispose() {
      await this._request._channel.disposeAPIResponse({ fetchUid: this._fetchUid() });
    }
    _inspect() {
      const headers = this.headersArray().map(({ name, value }) => `  ${name}: ${value}`);
      return `APIResponse: ${this.status()} ${this.statusText()}
${headers.join("\n")}`;
    }
    _fetchUid() {
      return this._initializer.fetchUid;
    }
    async _fetchLog() {
      const { log } = await this._request._channel.fetchLog({ fetchUid: this._fetchUid() });
      return log;
    }
  };
  function filePayloadToJson(payload) {
    return {
      name: payload.name,
      mimeType: payload.mimeType,
      buffer: payload.buffer
    };
  }
  async function readStreamToJson(platform, stream) {
    const buffer = await new Promise((resolve, reject) => {
      const chunks = [];
      stream.on("data", (chunk) => chunks.push(chunk));
      stream.on("end", () => resolve(Buffer.concat(chunks)));
      stream.on("error", (err) => reject(err));
    });
    const streamPath = Buffer.isBuffer(stream.path) ? stream.path.toString("utf8") : stream.path;
    return {
      name: platform.path().basename(streamPath),
      buffer
    };
  }
  function isJsonContentType(headers) {
    if (!headers)
      return false;
    for (const { name, value } of headers) {
      if (name.toLocaleLowerCase() === "content-type")
        return value === "application/json";
    }
    return false;
  }
  function objectToArray(map) {
    if (!map)
      return void 0;
    const result = [];
    for (const [name, value] of Object.entries(map)) {
      if (value !== void 0)
        result.push({ name, value: String(value) });
    }
    return result;
  }
  function isFilePayload(value) {
    return typeof value === "object" && value["name"] && value["mimeType"] && value["buffer"];
  }

  // src/browser/run/playwright-client/vendor/client/network.ts
  var Request = class _Request extends ChannelOwner {
    _redirectedFrom = null;
    _redirectedTo = null;
    _failureText = null;
    _response = null;
    _provisionalHeaders;
    _actualHeadersPromise;
    _timing;
    _fallbackOverrides = {};
    static from(request) {
      return request._object;
    }
    static fromNullable(request) {
      return request ? _Request.from(request) : null;
    }
    constructor(parent, type, guid, initializer) {
      super(parent, type, guid, initializer);
      this._redirectedFrom = _Request.fromNullable(initializer.redirectedFrom);
      if (this._redirectedFrom)
        this._redirectedFrom._redirectedTo = this;
      this._provisionalHeaders = new RawHeaders(initializer.headers);
      this._timing = {
        startTime: 0,
        domainLookupStart: -1,
        domainLookupEnd: -1,
        connectStart: -1,
        secureConnectionStart: -1,
        connectEnd: -1,
        requestStart: -1,
        responseStart: -1,
        responseEnd: -1
      };
    }
    url() {
      return this._fallbackOverrides.url || this._initializer.url;
    }
    resourceType() {
      return this._initializer.resourceType;
    }
    method() {
      return this._fallbackOverrides.method || this._initializer.method;
    }
    postData() {
      const buffer = this._fallbackOverrides.postDataBuffer || this._initializer.postData;
      return buffer && quickjsEncoding.decodeText(buffer) || null;
    }
    postDataBuffer() {
      return this._fallbackOverrides.postDataBuffer || this._initializer.postData || null;
    }
    postDataJSON() {
      const postData = this.postData();
      if (!postData)
        return null;
      const contentType = this.headers()["content-type"];
      if (contentType?.includes("application/x-www-form-urlencoded")) {
        const entries = {};
        const parsed = new URLSearchParams(postData);
        for (const [k, v] of parsed.entries())
          entries[k] = v;
        return entries;
      }
      try {
        return JSON.parse(postData);
      } catch (e) {
        throw new Error("POST data is not a valid JSON object: " + postData);
      }
    }
    /**
     * @deprecated
     */
    headers() {
      if (this._fallbackOverrides.headers)
        return RawHeaders._fromHeadersObjectLossy(this._fallbackOverrides.headers).headers();
      return this._provisionalHeaders.headers();
    }
    async _actualHeaders() {
      if (this._fallbackOverrides.headers)
        return RawHeaders._fromHeadersObjectLossy(this._fallbackOverrides.headers);
      if (!this._actualHeadersPromise) {
        this._actualHeadersPromise = this._wrapApiCall(async () => {
          return new RawHeaders((await this._channel.rawRequestHeaders()).headers);
        }, { internal: true });
      }
      return await this._actualHeadersPromise;
    }
    async allHeaders() {
      return (await this._actualHeaders()).headers();
    }
    async headersArray() {
      return (await this._actualHeaders()).headersArray();
    }
    async headerValue(name) {
      return (await this._actualHeaders()).get(name);
    }
    async response() {
      return Response.fromNullable((await this._channel.response()).response);
    }
    async _internalResponse() {
      return Response.fromNullable((await this._channel.response()).response);
    }
    existingResponse() {
      return this._response;
    }
    frame() {
      if (!this._initializer.frame) {
        assert(this.serviceWorker());
        throw new Error("Service Worker requests do not have an associated frame.");
      }
      const frame = Frame.from(this._initializer.frame);
      if (!frame._page) {
        throw new Error([
          "Frame for this navigation request is not available, because the request",
          "was issued before the frame is created. You can check whether the request",
          "is a navigation request by calling isNavigationRequest() method."
        ].join("\n"));
      }
      return frame;
    }
    _safePage() {
      return Frame.fromNullable(this._initializer.frame)?._page || null;
    }
    serviceWorker() {
      return this._initializer.serviceWorker ? Worker.from(this._initializer.serviceWorker) : null;
    }
    isNavigationRequest() {
      return this._initializer.isNavigationRequest;
    }
    redirectedFrom() {
      return this._redirectedFrom;
    }
    redirectedTo() {
      return this._redirectedTo;
    }
    failure() {
      if (this._failureText === null)
        return null;
      return {
        errorText: this._failureText
      };
    }
    timing() {
      return this._timing;
    }
    async sizes() {
      const response = await this.response();
      if (!response)
        throw new Error("Unable to fetch sizes for failed request");
      return (await response._channel.sizes()).sizes;
    }
    _setResponseEndTiming(responseEndTiming) {
      this._timing.responseEnd = responseEndTiming;
      if (this._timing.responseStart === -1)
        this._timing.responseStart = responseEndTiming;
    }
    _finalRequest() {
      return this._redirectedTo ? this._redirectedTo._finalRequest() : this;
    }
    _applyFallbackOverrides(overrides) {
      if (overrides.url)
        this._fallbackOverrides.url = overrides.url;
      if (overrides.method)
        this._fallbackOverrides.method = overrides.method;
      if (overrides.headers)
        this._fallbackOverrides.headers = overrides.headers;
      if (isString(overrides.postData))
        this._fallbackOverrides.postDataBuffer = Buffer.from(overrides.postData, "utf-8");
      else if (overrides.postData instanceof Buffer)
        this._fallbackOverrides.postDataBuffer = overrides.postData;
      else if (overrides.postData)
        this._fallbackOverrides.postDataBuffer = Buffer.from(JSON.stringify(overrides.postData), "utf-8");
    }
    _fallbackOverridesForContinue() {
      return this._fallbackOverrides;
    }
    _targetClosedScope() {
      return this.serviceWorker()?._closedScope || this._safePage()?._closedOrCrashedScope || new LongStandingScope();
    }
  };
  var Route = class extends ChannelOwner {
    _handlingPromise = null;
    _context;
    _didThrow = false;
    static from(route) {
      return route._object;
    }
    constructor(parent, type, guid, initializer) {
      super(parent, type, guid, initializer);
    }
    request() {
      return Request.from(this._initializer.request);
    }
    async _raceWithTargetClose(promise) {
      return await this.request()._targetClosedScope().safeRace(promise);
    }
    async _startHandling() {
      this._handlingPromise = new ManualPromise();
      return await this._handlingPromise;
    }
    async fallback(options = {}) {
      this._checkNotHandled();
      this.request()._applyFallbackOverrides(options);
      this._reportHandled(false);
    }
    async abort(errorCode) {
      await this._handleRoute(async () => {
        await this._raceWithTargetClose(this._channel.abort({ errorCode }));
      });
    }
    async _redirectNavigationRequest(url) {
      await this._handleRoute(async () => {
        await this._raceWithTargetClose(this._channel.redirectNavigationRequest({ url }));
      });
    }
    async fetch(options = {}) {
      return await this._wrapApiCall(async () => {
        return await this._context.request._innerFetch({ request: this.request(), data: options.postData, ...options });
      });
    }
    async fulfill(options = {}) {
      await this._handleRoute(async () => {
        await this._innerFulfill(options);
      });
    }
    async _handleRoute(callback) {
      this._checkNotHandled();
      try {
        await callback();
        this._reportHandled(true);
      } catch (e) {
        this._didThrow = true;
        throw e;
      }
    }
    async _innerFulfill(options = {}) {
      let fetchResponseUid;
      let { status: statusOption, headers: headersOption, body } = options;
      if (options.json !== void 0) {
        assert(options.body === void 0, "Can specify either body or json parameters");
        body = JSON.stringify(options.json);
      }
      if (options.response instanceof APIResponse) {
        statusOption ??= options.response.status();
        headersOption ??= options.response.headers();
        if (body === void 0 && options.path === void 0) {
          if (options.response._request._connection === this._connection)
            fetchResponseUid = options.response._fetchUid();
          else
            body = await options.response.body();
        }
      }
      let isBase64 = false;
      let length = 0;
      if (options.path) {
        const buffer = await this._platform.fs().promises.readFile(options.path);
        body = buffer.toString("base64");
        isBase64 = true;
        length = buffer.length;
      } else if (isString(body)) {
        isBase64 = false;
        length = Buffer.byteLength(body);
      } else if (body) {
        length = body.length;
        body = body.toString("base64");
        isBase64 = true;
      }
      const headers = {};
      for (const header of Object.keys(headersOption || {}))
        headers[header.toLowerCase()] = String(headersOption[header]);
      if (options.contentType)
        headers["content-type"] = String(options.contentType);
      else if (options.json)
        headers["content-type"] = "application/json";
      else if (options.path)
        headers["content-type"] = getMimeTypeForPath(options.path) || "application/octet-stream";
      if (length && !("content-length" in headers))
        headers["content-length"] = String(length);
      await this._raceWithTargetClose(this._channel.fulfill({
        status: statusOption || 200,
        headers: headersObjectToArray(headers),
        body,
        isBase64,
        fetchResponseUid
      }));
    }
    async continue(options = {}) {
      await this._handleRoute(async () => {
        this.request()._applyFallbackOverrides(options);
        await this._innerContinue(
          false
          /* isFallback */
        );
      });
    }
    _checkNotHandled() {
      if (!this._handlingPromise)
        throw new Error("Route is already handled!");
    }
    _reportHandled(done) {
      const chain = this._handlingPromise;
      this._handlingPromise = null;
      chain.resolve(done);
    }
    async _innerContinue(isFallback) {
      const options = this.request()._fallbackOverridesForContinue();
      return await this._raceWithTargetClose(this._channel.continue({
        url: options.url,
        method: options.method,
        headers: options.headers ? headersObjectToArray(options.headers) : void 0,
        postData: options.postDataBuffer,
        isFallback
      }));
    }
  };
  var WebSocketRoute = class extends ChannelOwner {
    static from(route) {
      return route._object;
    }
    _onPageMessage;
    _onPageClose;
    _onServerMessage;
    _onServerClose;
    _server;
    _connected = false;
    constructor(parent, type, guid, initializer) {
      super(parent, type, guid, initializer);
      this._server = {
        onMessage: (handler) => {
          this._onServerMessage = handler;
        },
        onClose: (handler) => {
          this._onServerClose = handler;
        },
        connectToServer: () => {
          throw new Error(`connectToServer must be called on the page-side WebSocketRoute`);
        },
        url: () => {
          return this._initializer.url;
        },
        protocols: () => {
          return [...this._initializer.protocols];
        },
        close: async (options = {}) => {
          await this._channel.closeServer({ ...options, wasClean: true }).catch(() => {
          });
        },
        send: (message) => {
          if (isString(message))
            this._channel.sendToServer({ message, isBase64: false }).catch(() => {
            });
          else
            this._channel.sendToServer({ message: message.toString("base64"), isBase64: true }).catch(() => {
            });
        },
        async [Symbol.asyncDispose]() {
          await this.close();
        }
      };
      this._channel.on("messageFromPage", ({ message, isBase64 }) => {
        if (this._onPageMessage)
          this._onPageMessage(isBase64 ? Buffer.from(message, "base64") : message);
        else if (this._connected)
          this._channel.sendToServer({ message, isBase64 }).catch(() => {
          });
      });
      this._channel.on("messageFromServer", ({ message, isBase64 }) => {
        if (this._onServerMessage)
          this._onServerMessage(isBase64 ? Buffer.from(message, "base64") : message);
        else
          this._channel.sendToPage({ message, isBase64 }).catch(() => {
          });
      });
      this._channel.on("closePage", ({ code, reason, wasClean }) => {
        if (this._onPageClose)
          this._onPageClose(code, reason);
        else
          this._channel.closeServer({ code, reason, wasClean }).catch(() => {
          });
      });
      this._channel.on("closeServer", ({ code, reason, wasClean }) => {
        if (this._onServerClose)
          this._onServerClose(code, reason);
        else
          this._channel.closePage({ code, reason, wasClean }).catch(() => {
          });
      });
    }
    url() {
      return this._initializer.url;
    }
    protocols() {
      return [...this._initializer.protocols];
    }
    async close(options = {}) {
      await this._channel.closePage({ ...options, wasClean: true }).catch(() => {
      });
    }
    connectToServer() {
      if (this._connected)
        throw new Error("Already connected to the server");
      this._connected = true;
      this._channel.connect().catch(() => {
      });
      return this._server;
    }
    send(message) {
      if (isString(message))
        this._channel.sendToPage({ message, isBase64: false }).catch(() => {
        });
      else
        this._channel.sendToPage({ message: message.toString("base64"), isBase64: true }).catch(() => {
        });
    }
    onMessage(handler) {
      this._onPageMessage = handler;
    }
    onClose(handler) {
      this._onPageClose = handler;
    }
    async [Symbol.asyncDispose]() {
      await this.close();
    }
    async _afterHandle() {
      if (this._connected)
        return;
      await this._channel.ensureOpened().catch(() => {
      });
    }
  };
  var WebSocketRouteHandler = class {
    _baseURL;
    url;
    handler;
    constructor(baseURL, url, handler) {
      this._baseURL = baseURL;
      this.url = url;
      this.handler = handler;
      if (typeof url === "string")
        resolveGlobToRegexPattern(baseURL, url, true);
    }
    static prepareInterceptionPatterns(handlers) {
      const patterns = [];
      let all = false;
      for (const handler of handlers) {
        const serialized = serializeURLMatch(handler.url);
        if (serialized)
          patterns.push(serialized);
        else
          all = true;
      }
      if (all)
        return [{ glob: "**/*" }];
      return patterns;
    }
    matches(wsURL) {
      return urlMatches(this._baseURL, wsURL, this.url, true);
    }
    async handle(webSocketRoute) {
      const handler = this.handler;
      await handler(webSocketRoute);
      await webSocketRoute._afterHandle();
    }
  };
  var Response = class _Response extends ChannelOwner {
    _provisionalHeaders;
    _actualHeadersPromise;
    _request;
    _finishedPromise = new ManualPromise();
    static from(response) {
      return response._object;
    }
    static fromNullable(response) {
      return response ? _Response.from(response) : null;
    }
    constructor(parent, type, guid, initializer) {
      super(parent, type, guid, initializer);
      this._provisionalHeaders = new RawHeaders(initializer.headers);
      this._request = Request.from(this._initializer.request);
      this._request._response = this;
      Object.assign(this._request._timing, this._initializer.timing);
    }
    url() {
      return this._initializer.url;
    }
    ok() {
      return this._initializer.status === 0 || this._initializer.status >= 200 && this._initializer.status <= 299;
    }
    status() {
      return this._initializer.status;
    }
    statusText() {
      return this._initializer.statusText;
    }
    fromServiceWorker() {
      return this._initializer.fromServiceWorker;
    }
    /**
     * @deprecated
     */
    headers() {
      return this._provisionalHeaders.headers();
    }
    async _actualHeaders() {
      if (!this._actualHeadersPromise) {
        this._actualHeadersPromise = (async () => {
          return new RawHeaders((await this._channel.rawResponseHeaders()).headers);
        })();
      }
      return await this._actualHeadersPromise;
    }
    async allHeaders() {
      return (await this._actualHeaders()).headers();
    }
    async headersArray() {
      return (await this._actualHeaders()).headersArray().slice();
    }
    async headerValue(name) {
      return (await this._actualHeaders()).get(name);
    }
    async headerValues(name) {
      return (await this._actualHeaders()).getAll(name);
    }
    async finished() {
      return await this.request()._targetClosedScope().race(this._finishedPromise);
    }
    async body() {
      return (await this._channel.body()).binary;
    }
    async text() {
      const content = await this.body();
      return quickjsEncoding.decodeText(content);
    }
    async json() {
      const content = await this.text();
      return JSON.parse(content);
    }
    request() {
      return this._request;
    }
    frame() {
      return this._request.frame();
    }
    async serverAddr() {
      return (await this._channel.serverAddr()).value || null;
    }
    async securityDetails() {
      return (await this._channel.securityDetails()).value || null;
    }
    async httpVersion() {
      return (await this._channel.httpVersion()).value;
    }
  };
  var WebSocket = class extends ChannelOwner {
    _page;
    _isClosed;
    static from(webSocket) {
      return webSocket._object;
    }
    constructor(parent, type, guid, initializer) {
      super(parent, type, guid, initializer);
      this._isClosed = false;
      this._page = parent;
      this._channel.on("frameSent", (event) => {
        if (event.opcode === 1)
          this.emit(Events.WebSocket.FrameSent, { payload: event.data });
        else if (event.opcode === 2)
          this.emit(Events.WebSocket.FrameSent, { payload: Buffer.from(event.data, "base64") });
      });
      this._channel.on("frameReceived", (event) => {
        if (event.opcode === 1)
          this.emit(Events.WebSocket.FrameReceived, { payload: event.data });
        else if (event.opcode === 2)
          this.emit(Events.WebSocket.FrameReceived, { payload: Buffer.from(event.data, "base64") });
      });
      this._channel.on("socketError", ({ error }) => this.emit(Events.WebSocket.Error, error));
      this._channel.on("close", () => {
        this._isClosed = true;
        this.emit(Events.WebSocket.Close, this);
      });
    }
    url() {
      return this._initializer.url;
    }
    isClosed() {
      return this._isClosed;
    }
    async waitForEvent(event, optionsOrPredicate = {}) {
      return await this._wrapApiCall(async () => {
        const timeout = this._page._timeoutSettings.timeout(typeof optionsOrPredicate === "function" ? {} : optionsOrPredicate);
        const predicate = typeof optionsOrPredicate === "function" ? optionsOrPredicate : optionsOrPredicate.predicate;
        const waiter = Waiter.createForEvent(this, event);
        waiter.rejectOnTimeout(timeout, `Timeout ${timeout}ms exceeded while waiting for event "${event}"`);
        if (event !== Events.WebSocket.Error)
          waiter.rejectOnEvent(this, Events.WebSocket.Error, new Error("Socket error"));
        if (event !== Events.WebSocket.Close)
          waiter.rejectOnEvent(this, Events.WebSocket.Close, new Error("Socket closed"));
        waiter.rejectOnEvent(this._page, Events.Page.Close, () => this._page._closeErrorWithReason());
        const result = await waiter.waitForEvent(this, event, predicate);
        waiter.dispose();
        return result;
      });
    }
  };
  function validateHeaders(headers) {
    for (const key of Object.keys(headers)) {
      const value = headers[key];
      if (!Object.is(value, void 0) && !isString(value))
        throw new Error(`Expected value of header "${key}" to be String, but "${typeof value}" is found.`);
    }
  }
  var RouteHandler = class {
    handledCount = 0;
    _baseURL;
    _times;
    url;
    handler;
    _ignoreException = false;
    _activeInvocations = /* @__PURE__ */ new Set();
    _savedZone;
    constructor(platform, baseURL, url, handler, times = Number.MAX_SAFE_INTEGER) {
      this._baseURL = baseURL;
      this._times = times;
      this.url = url;
      this.handler = handler;
      this._savedZone = platform.zones.current().pop();
      if (typeof url === "string")
        resolveGlobToRegexPattern(baseURL, url);
    }
    static prepareInterceptionPatterns(handlers) {
      const patterns = [];
      let all = false;
      for (const handler of handlers) {
        const serialized = serializeURLMatch(handler.url);
        if (serialized)
          patterns.push(serialized);
        else
          all = true;
      }
      if (all)
        return [{ glob: "**/*" }];
      return patterns;
    }
    matches(requestURL) {
      return urlMatches(this._baseURL, requestURL, this.url);
    }
    async handle(route) {
      return await this._savedZone.run(async () => this._handleImpl(route));
    }
    async _handleImpl(route) {
      const handlerInvocation = { complete: new ManualPromise(), route };
      this._activeInvocations.add(handlerInvocation);
      try {
        return await this._handleInternal(route);
      } catch (e) {
        if (this._ignoreException)
          return false;
        if (isTargetClosedError(e)) {
          rewriteErrorMessage(e, `"${e.message}" while running route callback.
Consider awaiting \`await page.unrouteAll({ behavior: 'ignoreErrors' })\`
before the end of the test to ignore remaining routes in flight.`);
        }
        throw e;
      } finally {
        handlerInvocation.complete.resolve();
        this._activeInvocations.delete(handlerInvocation);
      }
    }
    async stop(behavior) {
      if (behavior === "ignoreErrors") {
        this._ignoreException = true;
      } else {
        const promises = [];
        for (const activation of this._activeInvocations) {
          if (!activation.route._didThrow)
            promises.push(activation.complete);
        }
        await Promise.all(promises);
      }
    }
    async _handleInternal(route) {
      ++this.handledCount;
      const handledPromise = route._startHandling();
      const handler = this.handler;
      const [handled] = await Promise.all([
        handledPromise,
        handler(route, route.request())
      ]);
      return handled;
    }
    willExpire() {
      return this.handledCount + 1 >= this._times;
    }
  };
  var RawHeaders = class _RawHeaders {
    _headersArray;
    _headersMap = new MultiMap();
    static _fromHeadersObjectLossy(headers) {
      const headersArray = Object.entries(headers).map(([name, value]) => ({
        name,
        value
      })).filter((header) => header.value !== void 0);
      return new _RawHeaders(headersArray);
    }
    constructor(headers) {
      this._headersArray = headers;
      for (const header of headers)
        this._headersMap.set(header.name.toLowerCase(), header.value);
    }
    get(name) {
      const values = this.getAll(name);
      if (!values || !values.length)
        return null;
      return values.join(name.toLowerCase() === "set-cookie" ? "\n" : ", ");
    }
    getAll(name) {
      return [...this._headersMap.get(name.toLowerCase())];
    }
    headers() {
      const result = {};
      for (const name of this._headersMap.keys())
        result[name] = this.get(name);
      return result;
    }
    headersArray() {
      return this._headersArray;
    }
  };

  // src/browser/run/playwright-client/vendor/client/types.ts
  var kLifecycleEvents = /* @__PURE__ */ new Set(["load", "domcontentloaded", "networkidle", "commit"]);

  // src/browser/run/playwright-client/vendor/client/frame.ts
  var Frame = class _Frame extends ChannelOwner {
    _eventEmitter;
    _loadStates;
    _parentFrame = null;
    _url = "";
    _name = "";
    _detached = false;
    _childFrames = /* @__PURE__ */ new Set();
    _page;
    static from(frame) {
      return frame._object;
    }
    static fromNullable(frame) {
      return frame ? _Frame.from(frame) : null;
    }
    constructor(parent, type, guid, initializer) {
      super(parent, type, guid, initializer);
      this._eventEmitter = new EventEmitter(parent._platform);
      this._eventEmitter.setMaxListeners(0);
      this._parentFrame = _Frame.fromNullable(initializer.parentFrame);
      if (this._parentFrame)
        this._parentFrame._childFrames.add(this);
      this._name = initializer.name;
      this._url = initializer.url;
      this._loadStates = new Set(initializer.loadStates);
      this._channel.on("loadstate", (event) => {
        if (event.add) {
          this._loadStates.add(event.add);
          this._eventEmitter.emit("loadstate", event.add);
        }
        if (event.remove)
          this._loadStates.delete(event.remove);
        if (!this._parentFrame && event.add === "load" && this._page) {
          this._page.emit(Events.Page.Load, this._page);
          this._page.context().emit(Events.BrowserContext.PageLoad, this._page);
        }
        if (!this._parentFrame && event.add === "domcontentloaded" && this._page)
          this._page.emit(Events.Page.DOMContentLoaded, this._page);
      });
      this._channel.on("navigated", (event) => {
        this._url = event.url;
        this._name = event.name;
        this._eventEmitter.emit("navigated", event);
        if (!event.error && this._page) {
          this._page.emit(Events.Page.FrameNavigated, this);
          this._page.context().emit(Events.BrowserContext.FrameNavigated, this);
        }
      });
    }
    page() {
      return this._page;
    }
    _timeout(options) {
      const timeoutSettings = this._page?._timeoutSettings || new TimeoutSettings(this._platform);
      return timeoutSettings.timeout(options || {});
    }
    _navigationTimeout(options) {
      const timeoutSettings = this._page?._timeoutSettings || new TimeoutSettings(this._platform);
      return timeoutSettings.navigationTimeout(options || {});
    }
    async goto(url, options = {}) {
      const waitUntil = verifyLoadState("waitUntil", options.waitUntil === void 0 ? "load" : options.waitUntil);
      return Response.fromNullable((await this._channel.goto({ url, ...options, waitUntil, timeout: this._navigationTimeout(options) })).response);
    }
    _setupNavigationWaiter(options) {
      const waiter = new Waiter(this._page, "");
      if (this._page.isClosed())
        waiter.rejectImmediately(this._page._closeErrorWithReason());
      waiter.rejectOnEvent(this._page, Events.Page.Close, () => this._page._closeErrorWithReason());
      waiter.rejectOnEvent(this._page, Events.Page.Crash, new Error("Navigation failed because page crashed!"));
      waiter.rejectOnEvent(this._page, Events.Page.FrameDetached, new Error("Navigating frame was detached!"), (frame) => frame === this);
      const timeout = this._page._timeoutSettings.navigationTimeout(options);
      waiter.rejectOnTimeout(timeout, `Timeout ${timeout}ms exceeded.`);
      return waiter;
    }
    async waitForNavigation(options = {}) {
      return await this._page._wrapApiCall(async () => {
        const waitUntil = verifyLoadState("waitUntil", options.waitUntil === void 0 ? "load" : options.waitUntil);
        const waiter = this._setupNavigationWaiter(options);
        const toUrl = typeof options.url === "string" ? ` to "${options.url}"` : "";
        waiter.log(`waiting for navigation${toUrl} until "${waitUntil}"`);
        const navigatedEvent = await waiter.waitForEvent(this._eventEmitter, "navigated", (event) => {
          if (event.error)
            return true;
          waiter.log(`  navigated to "${event.url}"`);
          return urlMatches(this._page?.context()._options.baseURL, event.url, options.url);
        });
        if (navigatedEvent.error) {
          const e = new Error(navigatedEvent.error);
          e.stack = "";
          await waiter.waitForPromise(Promise.reject(e));
        }
        if (!this._loadStates.has(waitUntil)) {
          await waiter.waitForEvent(this._eventEmitter, "loadstate", (s) => {
            waiter.log(`  "${s}" event fired`);
            return s === waitUntil;
          });
        }
        const request = navigatedEvent.newDocument ? Request.fromNullable(navigatedEvent.newDocument.request) : null;
        const response = request ? await waiter.waitForPromise(request._finalRequest()._internalResponse()) : null;
        waiter.dispose();
        return response;
      }, { title: "Wait for navigation" });
    }
    async waitForLoadState(state = "load", options = {}) {
      state = verifyLoadState("state", state);
      return await this._page._wrapApiCall(async () => {
        const waiter = this._setupNavigationWaiter(options);
        if (this._loadStates.has(state)) {
          waiter.log(`  not waiting, "${state}" event already fired`);
        } else {
          await waiter.waitForEvent(this._eventEmitter, "loadstate", (s) => {
            waiter.log(`  "${s}" event fired`);
            return s === state;
          });
        }
        waiter.dispose();
      }, { title: `Wait for load state "${state}"` });
    }
    async waitForURL(url, options = {}) {
      if (urlMatches(this._page?.context()._options.baseURL, this.url(), url))
        return await this.waitForLoadState(options.waitUntil, options);
      await this.waitForNavigation({ url, ...options });
    }
    async frameElement() {
      return ElementHandle.from((await this._channel.frameElement()).element);
    }
    async evaluateHandle(pageFunction, arg) {
      assertMaxArguments(arguments.length, 2);
      const result = await this._channel.evaluateExpressionHandle({ expression: String(pageFunction), isFunction: typeof pageFunction === "function", arg: serializeArgument(arg) });
      return JSHandle.from(result.handle);
    }
    async evaluate(pageFunction, arg) {
      assertMaxArguments(arguments.length, 2);
      const result = await this._channel.evaluateExpression({ expression: String(pageFunction), isFunction: typeof pageFunction === "function", arg: serializeArgument(arg) });
      return parseResult(result.value);
    }
    async _evaluateExposeUtilityScript(pageFunction, arg) {
      assertMaxArguments(arguments.length, 2);
      const result = await this._channel.evaluateExpression({ expression: String(pageFunction), isFunction: typeof pageFunction === "function", arg: serializeArgument(arg) });
      return parseResult(result.value);
    }
    async $(selector, options) {
      const result = await this._channel.querySelector({ selector, ...options });
      return ElementHandle.fromNullable(result.element);
    }
    async waitForSelector(selector, options = {}) {
      if (options.visibility)
        throw new Error("options.visibility is not supported, did you mean options.state?");
      if (options.waitFor && options.waitFor !== "visible")
        throw new Error("options.waitFor is not supported, did you mean options.state?");
      const result = await this._channel.waitForSelector({ selector, ...options, timeout: this._timeout(options) });
      return ElementHandle.fromNullable(result.element);
    }
    async dispatchEvent(selector, type, eventInit, options = {}) {
      await this._channel.dispatchEvent({ selector, type, eventInit: serializeArgument(eventInit), ...options, timeout: this._timeout(options) });
    }
    async $eval(selector, pageFunction, arg) {
      assertMaxArguments(arguments.length, 3);
      const result = await this._channel.evalOnSelector({ selector, expression: String(pageFunction), isFunction: typeof pageFunction === "function", arg: serializeArgument(arg) });
      return parseResult(result.value);
    }
    async $$eval(selector, pageFunction, arg) {
      assertMaxArguments(arguments.length, 3);
      const result = await this._channel.evalOnSelectorAll({ selector, expression: String(pageFunction), isFunction: typeof pageFunction === "function", arg: serializeArgument(arg) });
      return parseResult(result.value);
    }
    async $$(selector) {
      const result = await this._channel.querySelectorAll({ selector });
      return result.elements.map((e) => ElementHandle.from(e));
    }
    async _queryCount(selector, options) {
      return (await this._channel.queryCount({ selector, ...options })).value;
    }
    async content() {
      return (await this._channel.content()).value;
    }
    async setContent(html, options = {}) {
      const waitUntil = verifyLoadState("waitUntil", options.waitUntil === void 0 ? "load" : options.waitUntil);
      await this._channel.setContent({ html, ...options, waitUntil, timeout: this._navigationTimeout(options) });
    }
    name() {
      return this._name || "";
    }
    url() {
      return this._url;
    }
    parentFrame() {
      return this._parentFrame;
    }
    childFrames() {
      return Array.from(this._childFrames);
    }
    isDetached() {
      return this._detached;
    }
    async addScriptTag(options = {}) {
      const copy = { ...options };
      if (copy.path) {
        copy.content = (await this._platform.fs().promises.readFile(copy.path)).toString();
        copy.content = addSourceUrlToScript(copy.content, copy.path);
      }
      return ElementHandle.from((await this._channel.addScriptTag({ ...copy })).element);
    }
    async addStyleTag(options = {}) {
      const copy = { ...options };
      if (copy.path) {
        copy.content = (await this._platform.fs().promises.readFile(copy.path)).toString();
        copy.content += "/*# sourceURL=" + copy.path.replace(/\n/g, "") + "*/";
      }
      return ElementHandle.from((await this._channel.addStyleTag({ ...copy })).element);
    }
    async click(selector, options = {}) {
      return await this._channel.click({ selector, ...options, timeout: this._timeout(options) });
    }
    async dblclick(selector, options = {}) {
      return await this._channel.dblclick({ selector, ...options, timeout: this._timeout(options) });
    }
    async dragAndDrop(source, target, options = {}) {
      return await this._channel.dragAndDrop({ source, target, ...options, timeout: this._timeout(options) });
    }
    async _drop(selector, payload, options = {}) {
      let fileParams = {};
      if (payload.files !== void 0) {
        const converted = await convertInputFiles(this._platform, payload.files, this.page().context());
        if (converted.localDirectory || converted.directoryStream)
          throw new Error("Dropping a directory is not supported \u2014 pass individual files.");
        fileParams = { payloads: converted.payloads, localPaths: converted.localPaths, streams: converted.streams };
      }
      const dataArray = payload.data ? Object.entries(payload.data).map(([mimeType, value]) => ({ mimeType, value })) : void 0;
      await this._channel.drop({
        selector,
        ...fileParams,
        data: dataArray,
        ...options,
        timeout: this._timeout(options)
      });
    }
    async tap(selector, options = {}) {
      return await this._channel.tap({ selector, ...options, timeout: this._timeout(options) });
    }
    async fill(selector, value, options = {}) {
      return await this._channel.fill({ selector, value, ...options, timeout: this._timeout(options) });
    }
    async _highlight(selector, style) {
      return await this._channel.highlight({ selector, style });
    }
    async _hideHighlight(selector) {
      return await this._channel.hideHighlight({ selector });
    }
    locator(selector, options) {
      return new Locator(this, selector, options);
    }
    getByTestId(testId) {
      return this.locator(getByTestIdSelector(testIdAttributeName(), testId));
    }
    getByAltText(text, options) {
      return this.locator(getByAltTextSelector(text, options));
    }
    getByLabel(text, options) {
      return this.locator(getByLabelSelector(text, options));
    }
    getByPlaceholder(text, options) {
      return this.locator(getByPlaceholderSelector(text, options));
    }
    getByText(text, options) {
      return this.locator(getByTextSelector(text, options));
    }
    getByTitle(text, options) {
      return this.locator(getByTitleSelector(text, options));
    }
    getByRole(role, options = {}) {
      return this.locator(getByRoleSelector(role, options));
    }
    frameLocator(selector) {
      return new FrameLocator(this, selector);
    }
    async focus(selector, options = {}) {
      await this._channel.focus({ selector, ...options, timeout: this._timeout(options) });
    }
    async textContent(selector, options = {}) {
      const value = (await this._channel.textContent({ selector, ...options, timeout: this._timeout(options) })).value;
      return value === void 0 ? null : value;
    }
    async innerText(selector, options = {}) {
      return (await this._channel.innerText({ selector, ...options, timeout: this._timeout(options) })).value;
    }
    async innerHTML(selector, options = {}) {
      return (await this._channel.innerHTML({ selector, ...options, timeout: this._timeout(options) })).value;
    }
    async getAttribute(selector, name, options = {}) {
      const value = (await this._channel.getAttribute({ selector, name, ...options, timeout: this._timeout(options) })).value;
      return value === void 0 ? null : value;
    }
    async inputValue(selector, options = {}) {
      return (await this._channel.inputValue({ selector, ...options, timeout: this._timeout(options) })).value;
    }
    async isChecked(selector, options = {}) {
      return (await this._channel.isChecked({ selector, ...options, timeout: this._timeout(options) })).value;
    }
    async isDisabled(selector, options = {}) {
      return (await this._channel.isDisabled({ selector, ...options, timeout: this._timeout(options) })).value;
    }
    async isEditable(selector, options = {}) {
      return (await this._channel.isEditable({ selector, ...options, timeout: this._timeout(options) })).value;
    }
    async isEnabled(selector, options = {}) {
      return (await this._channel.isEnabled({ selector, ...options, timeout: this._timeout(options) })).value;
    }
    async isHidden(selector, options = {}) {
      return (await this._channel.isHidden({ selector, ...options })).value;
    }
    async isVisible(selector, options = {}) {
      return (await this._channel.isVisible({ selector, ...options })).value;
    }
    async hover(selector, options = {}) {
      await this._channel.hover({ selector, ...options, timeout: this._timeout(options) });
    }
    async selectOption(selector, values, options = {}) {
      return (await this._channel.selectOption({ selector, ...convertSelectOptionValues(values), ...options, timeout: this._timeout(options) })).values;
    }
    async setInputFiles(selector, files, options = {}) {
      const converted = await convertInputFiles(this._platform, files, this.page().context());
      await this._channel.setInputFiles({ selector, ...converted, ...options, timeout: this._timeout(options) });
    }
    async type(selector, text, options = {}) {
      await this._channel.type({ selector, text, ...options, timeout: this._timeout(options) });
    }
    async press(selector, key, options = {}) {
      await this._channel.press({ selector, key, ...options, timeout: this._timeout(options) });
    }
    async check(selector, options = {}) {
      await this._channel.check({ selector, ...options, timeout: this._timeout(options) });
    }
    async uncheck(selector, options = {}) {
      await this._channel.uncheck({ selector, ...options, timeout: this._timeout(options) });
    }
    async setChecked(selector, checked, options) {
      if (checked)
        await this.check(selector, options);
      else
        await this.uncheck(selector, options);
    }
    async waitForTimeout(timeout) {
      await this._channel.waitForTimeout({ waitTimeout: timeout });
    }
    async waitForFunction(pageFunction, arg, options = {}) {
      if (typeof options.polling === "string")
        assert(options.polling === "raf", "Unknown polling option: " + options.polling);
      const result = await this._channel.waitForFunction({
        ...options,
        pollingInterval: options.polling === "raf" ? void 0 : options.polling,
        expression: String(pageFunction),
        isFunction: typeof pageFunction === "function",
        arg: serializeArgument(arg),
        timeout: this._timeout(options)
      });
      return JSHandle.from(result.handle);
    }
    async title() {
      return (await this._channel.title()).value;
    }
    async _expect(expression, options) {
      const params = { expression, ...options, isNot: !!options.isNot };
      params.expectedValue = serializeArgument(options.expectedValue);
      try {
        await this._channel.expect(params);
        return { matches: !params.isNot };
      } catch (e) {
        if (!(e instanceof PlaywrightError))
          throw e;
        const details = e.details;
        const received = details.received ? {
          value: details.received.value !== void 0 ? parseResult(details.received.value) : void 0,
          ariaSnapshot: details.received.ariaSnapshot
        } : void 0;
        return {
          matches: !!params.isNot,
          received,
          log: e.log,
          timedOut: details.timedOut,
          errorMessage: details.customErrorMessage ? "Error: " + details.customErrorMessage : void 0
        };
      }
    }
  };
  function verifyLoadState(name, waitUntil) {
    if (waitUntil === "networkidle0")
      waitUntil = "networkidle";
    if (!kLifecycleEvents.has(waitUntil))
      throw new Error(`${name}: expected one of (load|domcontentloaded|networkidle|commit)`);
    return waitUntil;
  }

  // src/browser/run/playwright-client/vendor/client/elementHandle.ts
  var ElementHandle = class _ElementHandle extends JSHandle {
    _frame;
    _elementChannel;
    static from(handle) {
      return handle._object;
    }
    static fromNullable(handle) {
      return handle ? _ElementHandle.from(handle) : null;
    }
    constructor(parent, type, guid, initializer) {
      super(parent, type, guid, initializer);
      this._frame = parent;
      this._elementChannel = this._channel;
    }
    asElement() {
      return this;
    }
    async ownerFrame() {
      return Frame.fromNullable((await this._elementChannel.ownerFrame()).frame);
    }
    async contentFrame() {
      return Frame.fromNullable((await this._elementChannel.contentFrame()).frame);
    }
    async getAttribute(name) {
      const value = (await this._elementChannel.getAttribute({ name })).value;
      return value === void 0 ? null : value;
    }
    async inputValue() {
      return (await this._elementChannel.inputValue()).value;
    }
    async textContent() {
      const value = (await this._elementChannel.textContent()).value;
      return value === void 0 ? null : value;
    }
    async innerText() {
      return (await this._elementChannel.innerText()).value;
    }
    async innerHTML() {
      return (await this._elementChannel.innerHTML()).value;
    }
    async isChecked() {
      return (await this._elementChannel.isChecked()).value;
    }
    async isDisabled() {
      return (await this._elementChannel.isDisabled()).value;
    }
    async isEditable() {
      return (await this._elementChannel.isEditable()).value;
    }
    async isEnabled() {
      return (await this._elementChannel.isEnabled()).value;
    }
    async isHidden() {
      return (await this._elementChannel.isHidden()).value;
    }
    async isVisible() {
      return (await this._elementChannel.isVisible()).value;
    }
    async dispatchEvent(type, eventInit = {}) {
      await this._elementChannel.dispatchEvent({ type, eventInit: serializeArgument(eventInit) });
    }
    async scrollIntoViewIfNeeded(options = {}) {
      await this._elementChannel.scrollIntoViewIfNeeded({ ...options, timeout: this._frame._timeout(options) });
    }
    async hover(options = {}) {
      await this._elementChannel.hover({ ...options, timeout: this._frame._timeout(options) });
    }
    async click(options = {}) {
      return await this._elementChannel.click({ ...options, timeout: this._frame._timeout(options) });
    }
    async dblclick(options = {}) {
      return await this._elementChannel.dblclick({ ...options, timeout: this._frame._timeout(options) });
    }
    async tap(options = {}) {
      return await this._elementChannel.tap({ ...options, timeout: this._frame._timeout(options) });
    }
    async selectOption(values, options = {}) {
      const result = await this._elementChannel.selectOption({ ...convertSelectOptionValues(values), ...options, timeout: this._frame._timeout(options) });
      return result.values;
    }
    async fill(value, options = {}) {
      return await this._elementChannel.fill({ value, ...options, timeout: this._frame._timeout(options) });
    }
    async selectText(options = {}) {
      await this._elementChannel.selectText({ ...options, timeout: this._frame._timeout(options) });
    }
    async setInputFiles(files, options = {}) {
      const frame = await this.ownerFrame();
      if (!frame)
        throw new Error("Cannot set input files to detached element");
      const converted = await convertInputFiles(this._platform, files, frame.page().context());
      await this._elementChannel.setInputFiles({ ...converted, ...options, timeout: this._frame._timeout(options) });
    }
    async focus() {
      await this._elementChannel.focus();
    }
    async type(text, options = {}) {
      await this._elementChannel.type({ text, ...options, timeout: this._frame._timeout(options) });
    }
    async press(key, options = {}) {
      await this._elementChannel.press({ key, ...options, timeout: this._frame._timeout(options) });
    }
    async check(options = {}) {
      return await this._elementChannel.check({ ...options, timeout: this._frame._timeout(options) });
    }
    async uncheck(options = {}) {
      return await this._elementChannel.uncheck({ ...options, timeout: this._frame._timeout(options) });
    }
    async setChecked(checked, options) {
      if (checked)
        await this.check(options);
      else
        await this.uncheck(options);
    }
    async boundingBox() {
      const value = (await this._elementChannel.boundingBox()).value;
      return value === void 0 ? null : value;
    }
    async screenshot(options = {}) {
      const mask = options.mask;
      const copy = { ...options, mask: void 0, timeout: this._frame._timeout(options) };
      if (!copy.type)
        copy.type = determineScreenshotType(options);
      if (mask) {
        copy.mask = mask.map((locator) => ({
          frame: locator._frame._channel,
          selector: locator._selector
        }));
      }
      const result = await this._elementChannel.screenshot(copy);
      if (options.path) {
        await mkdirIfNeeded(this._platform, options.path);
        await this._platform.fs().promises.writeFile(options.path, result.binary);
      }
      return result.binary;
    }
    async $(selector) {
      return _ElementHandle.fromNullable((await this._elementChannel.querySelector({ selector })).element);
    }
    async $$(selector) {
      const result = await this._elementChannel.querySelectorAll({ selector });
      return result.elements.map((h) => _ElementHandle.from(h));
    }
    async $eval(selector, pageFunction, arg) {
      const result = await this._elementChannel.evalOnSelector({ selector, expression: String(pageFunction), isFunction: typeof pageFunction === "function", arg: serializeArgument(arg) });
      return parseResult(result.value);
    }
    async $$eval(selector, pageFunction, arg) {
      const result = await this._elementChannel.evalOnSelectorAll({ selector, expression: String(pageFunction), isFunction: typeof pageFunction === "function", arg: serializeArgument(arg) });
      return parseResult(result.value);
    }
    async waitForElementState(state, options = {}) {
      return await this._elementChannel.waitForElementState({ state, ...options, timeout: this._frame._timeout(options) });
    }
    async waitForSelector(selector, options = {}) {
      const result = await this._elementChannel.waitForSelector({ selector, ...options, timeout: this._frame._timeout(options) });
      return _ElementHandle.fromNullable(result.element);
    }
  };
  function convertSelectOptionValues(values) {
    if (values === null)
      return {};
    if (!Array.isArray(values))
      values = [values];
    if (!values.length)
      return {};
    for (let i = 0; i < values.length; i++)
      assert(values[i] !== null, `options[${i}]: expected object, got null`);
    if (values[0] instanceof ElementHandle)
      return { elements: values.map((v) => v._elementChannel) };
    if (isString(values[0]))
      return { options: values.map((valueOrLabel) => ({ valueOrLabel })) };
    return { options: values };
  }
  function filePayloadExceedsSizeLimit(payloads) {
    return payloads.reduce((size, item) => size + (item.buffer ? item.buffer.byteLength : 0), 0) >= fileUploadSizeLimit;
  }
  async function convertInputFiles(platform, files, context) {
    const items = Array.isArray(files) ? files.slice() : [files];
    if (items.some((item) => typeof item === "string")) {
      throw new Error("File paths are unavailable in the QuickJS sandbox; use in-memory file payloads.");
    }
    const payloads = items;
    if (filePayloadExceedsSizeLimit(payloads))
      throw new Error("Cannot set an in-memory file payload larger than 50Mb.");
    return { payloads };
  }
  function determineScreenshotType(options) {
    if (options.path) {
      const mimeType = getMimeTypeForPath(options.path);
      if (mimeType === "image/png")
        return "png";
      else if (mimeType === "image/jpeg")
        return "jpeg";
      throw new Error(`path: unsupported mime type "${mimeType}"`);
    }
    return options.type;
  }

  // src/browser/run/playwright-client/vendor/client/fileChooser.ts
  var FileChooser = class {
    _page;
    _elementHandle;
    _isMultiple;
    constructor(page, elementHandle, isMultiple) {
      this._page = page;
      this._elementHandle = elementHandle;
      this._isMultiple = isMultiple;
    }
    element() {
      return this._elementHandle;
    }
    isMultiple() {
      return this._isMultiple;
    }
    page() {
      return this._page;
    }
    async setFiles(files, options) {
      return await this._elementHandle.setInputFiles(files, options);
    }
  };

  // src/browser/run/playwright-client/vendor/client/harRouter.ts
  var HarRouter = class _HarRouter {
    _localUtils;
    _harId;
    _notFoundAction;
    _options;
    static async create(localUtils, file, notFoundAction, options) {
      const { harId, error } = await localUtils.harOpen({ file });
      if (error)
        throw new Error(error);
      return new _HarRouter(localUtils, harId, notFoundAction, options);
    }
    constructor(localUtils, harId, notFoundAction, options) {
      this._localUtils = localUtils;
      this._harId = harId;
      this._options = options;
      this._notFoundAction = notFoundAction;
    }
    async _handle(route) {
      const request = route.request();
      const response = await this._localUtils.harLookup({
        harId: this._harId,
        url: request.url(),
        method: request.method(),
        headers: await request.headersArray(),
        postData: request.postDataBuffer() || void 0,
        isNavigationRequest: request.isNavigationRequest()
      });
      if (response.action === "redirect") {
        route._platform.log("api", `HAR: ${route.request().url()} redirected to ${response.redirectURL}`);
        await route._redirectNavigationRequest(response.redirectURL);
        return;
      }
      if (response.action === "fulfill") {
        if (response.status === -1)
          return;
        const transformedHeaders = response.headers.reduce((headersMap, { name, value }) => {
          if (name.toLowerCase() !== "set-cookie") {
            headersMap[name] = value;
          } else {
            if (!headersMap["set-cookie"])
              headersMap["set-cookie"] = value;
            else
              headersMap["set-cookie"] += `
${value}`;
          }
          return headersMap;
        }, {});
        await route.fulfill({
          status: response.status,
          headers: transformedHeaders,
          body: response.body
        });
        return;
      }
      if (response.action === "error")
        route._platform.log("api", "HAR: " + response.message);
      if (this._notFoundAction === "abort") {
        await route.abort();
        return;
      }
      await route.fallback();
    }
    async addContextRoute(context) {
      await context.route(this._options.urlMatch || "**/*", (route) => this._handle(route));
    }
    async addPageRoute(page) {
      await page.route(this._options.urlMatch || "**/*", (route) => this._handle(route));
    }
    async [Symbol.asyncDispose]() {
      await this.dispose();
    }
    dispose() {
      this._localUtils.harClose({ harId: this._harId }).catch(() => {
      });
    }
  };

  // src/browser/run/playwright-client/vendor/client/input.ts
  var Keyboard = class {
    _page;
    constructor(page) {
      this._page = page;
    }
    async down(key) {
      await this._page._channel.keyboardDown({ key });
    }
    async up(key) {
      await this._page._channel.keyboardUp({ key });
    }
    async insertText(text) {
      await this._page._channel.keyboardInsertText({ text });
    }
    async type(text, options = {}) {
      await this._page._channel.keyboardType({ text, ...options });
    }
    async press(key, options = {}) {
      await this._page._channel.keyboardPress({ key, ...options });
    }
  };
  var Mouse = class {
    _page;
    constructor(page) {
      this._page = page;
    }
    async move(x, y, options = {}) {
      await this._page._channel.mouseMove({ x, y, ...options });
    }
    async down(options = {}) {
      await this._page._channel.mouseDown({ ...options });
    }
    async up(options = {}) {
      await this._page._channel.mouseUp(options);
    }
    async click(x, y, options = {}) {
      await this._page._channel.mouseClick({ x, y, ...options });
    }
    async dblclick(x, y, options = {}) {
      await this._page._wrapApiCall(async () => {
        await this.click(x, y, { ...options, clickCount: 2 });
      }, { title: "Double click" });
    }
    async wheel(deltaX, deltaY) {
      await this._page._channel.mouseWheel({ deltaX, deltaY });
    }
  };
  var Touchscreen = class {
    _page;
    constructor(page) {
      this._page = page;
    }
    async tap(x, y) {
      await this._page._channel.touchscreenTap({ x, y });
    }
  };

  // src/browser/run/playwright-client/vendor/client/webStorage.ts
  var WebStorage = class {
    _page;
    _kind;
    constructor(page, kind) {
      this._page = page;
      this._kind = kind;
    }
    async items() {
      const { items } = await this._page._channel.webStorageItems({ kind: this._kind });
      return items;
    }
    async getItem(name) {
      const { value } = await this._page._channel.webStorageGetItem({ kind: this._kind, name });
      return value ?? null;
    }
    async setItem(name, value) {
      await this._page._channel.webStorageSetItem({ kind: this._kind, name, value });
    }
    async removeItem(name) {
      await this._page._channel.webStorageRemoveItem({ kind: this._kind, name });
    }
    async clear() {
      await this._page._channel.webStorageClear({ kind: this._kind });
    }
  };

  // src/browser/run/playwright-client/vendor/client/video.ts
  var Video = class extends EventEmitter {
    _artifact;
    _isRemote = false;
    constructor(page, connection, artifact) {
      super(page._platform);
      this._isRemote = connection.isRemote();
      this._artifact = artifact;
    }
    async path() {
      if (this._isRemote)
        throw new Error(`Path is not available when connecting remotely. Use saveAs() to save a local copy.`);
      if (!this._artifact)
        throw new Error("Video recording has not been started.");
      return this._artifact._initializer.absolutePath;
    }
    async saveAs(path) {
      if (!this._artifact)
        throw new Error("Video recording has not been started.");
      return await this._artifact.saveAs(path);
    }
    async delete() {
      if (this._artifact)
        await this._artifact.delete();
    }
  };

  // src/browser/run/playwright-client/vendor/client/screencast.ts
  var Screencast = class {
    _page;
    _started = false;
    _savePath;
    _onFrame = null;
    _artifact;
    constructor(page) {
      this._page = page;
      this._page._channel.on("screencastFrame", ({ data, timestamp, viewportWidth, viewportHeight }) => {
        void this._onFrame?.({ data, timestamp, viewportWidth, viewportHeight });
      });
    }
    async start(options = {}) {
      if (this._started)
        throw new Error("Screencast is already started");
      this._started = true;
      if (options.onFrame)
        this._onFrame = options.onFrame;
      const result = await this._page._channel.screencastStart({
        size: options.size,
        quality: options.quality,
        sendFrames: !!options.onFrame,
        record: !!options.path
      });
      if (result.artifact) {
        this._artifact = Artifact.from(result.artifact);
        this._savePath = options.path;
      }
      return new DisposableStub(() => this.stop());
    }
    async stop() {
      await this._page._wrapApiCall(async () => {
        this._started = false;
        this._onFrame = null;
        await this._page._channel.screencastStop();
        if (this._savePath)
          await this._artifact?.saveAs(this._savePath);
        this._artifact = void 0;
        this._savePath = void 0;
      });
    }
    async showActions(options) {
      await this._page._channel.screencastShowActions({ duration: options?.duration, position: options?.position, fontSize: options?.fontSize, cursor: options?.cursor });
      return new DisposableStub(() => this._page._channel.screencastHideActions());
    }
    async hideActions() {
      await this._page._channel.screencastHideActions();
    }
    async showOverlay(html, options) {
      const { id } = await this._page._channel.screencastShowOverlay({ html, duration: options?.duration });
      return new DisposableStub(() => this._page._channel.screencastRemoveOverlay({ id }));
    }
    async showChapter(title, options) {
      await this._page._channel.screencastChapter({ title, ...options });
    }
    async showOverlays() {
      await this._page._channel.screencastSetOverlayVisible({ visible: true });
    }
    async hideOverlays() {
      await this._page._channel.screencastSetOverlayVisible({ visible: false });
    }
  };

  // src/browser/run/playwright-client/vendor/client/page.ts
  var Page = class _Page extends ChannelOwner {
    _browserContext;
    _ownedContext;
    _apiName = "Page";
    _mainFrame;
    _frames = /* @__PURE__ */ new Set();
    _workers = /* @__PURE__ */ new Set();
    _closed = false;
    _closedOrCrashedScope = new LongStandingScope();
    _viewportSize;
    _routes = [];
    _webSocketRoutes = [];
    coverage;
    keyboard;
    mouse;
    request;
    touchscreen;
    clock;
    screencast;
    localStorage;
    sessionStorage;
    _bindings = /* @__PURE__ */ new Map();
    _timeoutSettings;
    _video;
    _opener;
    _closeReason;
    _closeWasCalled = false;
    _harRouters = [];
    _locatorHandlers = /* @__PURE__ */ new Map();
    static from(page) {
      return page._object;
    }
    static fromNullable(page) {
      return page ? _Page.from(page) : null;
    }
    constructor(parent, type, guid, initializer) {
      super(parent, type, guid, initializer);
      this._instrumentation.onPage(this);
      this._browserContext = parent;
      this._timeoutSettings = new TimeoutSettings(this._platform, this._browserContext._timeoutSettings);
      this.keyboard = new Keyboard(this);
      this.mouse = new Mouse(this);
      this.request = this._browserContext.request;
      this.touchscreen = new Touchscreen(this);
      this.clock = this._browserContext.clock;
      this.localStorage = new WebStorage(this, "local");
      this.sessionStorage = new WebStorage(this, "session");
      this._mainFrame = Frame.from(initializer.mainFrame);
      this._mainFrame._page = this;
      this._frames.add(this._mainFrame);
      this._viewportSize = initializer.viewportSize;
      this._closed = initializer.isClosed;
      this._opener = _Page.fromNullable(initializer.opener);
      this._video = new Video(this, this._connection, initializer.video ? Artifact.from(initializer.video) : void 0);
      this.screencast = new Screencast(this);
      this._channel.on("bindingCall", ({ binding }) => this._onBinding(BindingCall.from(binding)));
      this._channel.on("close", () => this._onClose());
      this._channel.on("crash", () => this._onCrash());
      this._channel.on("download", ({ url, suggestedFilename, artifact }) => {
        const artifactObject = Artifact.from(artifact);
        const download = new Download(this, url, suggestedFilename, artifactObject);
        this.emit(Events.Page.Download, download);
        this._browserContext.emit(Events.BrowserContext.Download, download);
      });
      this._channel.on("fileChooser", ({ element, isMultiple }) => this.emit(Events.Page.FileChooser, new FileChooser(this, ElementHandle.from(element), isMultiple)));
      this._channel.on("frameAttached", ({ frame }) => this._onFrameAttached(Frame.from(frame)));
      this._channel.on("frameDetached", ({ frame }) => this._onFrameDetached(Frame.from(frame)));
      this._channel.on("locatorHandlerTriggered", ({ uid }) => this._onLocatorHandlerTriggered(uid));
      this._channel.on("route", ({ route }) => this._onRoute(Route.from(route)));
      this._channel.on("webSocketRoute", ({ webSocketRoute }) => this._onWebSocketRoute(WebSocketRoute.from(webSocketRoute)));
      this._channel.on("viewportSizeChanged", ({ viewportSize }) => this._viewportSize = viewportSize);
      this._channel.on("webSocket", ({ webSocket }) => this.emit(Events.Page.WebSocket, WebSocket.from(webSocket)));
      this._channel.on("worker", ({ worker }) => this._onWorker(Worker.from(worker)));
      this.coverage = new Coverage(this._channel);
      this.once(Events.Page.Close, () => this._closedOrCrashedScope.close(this._closeErrorWithReason()));
      this.once(Events.Page.Crash, () => this._closedOrCrashedScope.close(new TargetClosedError()));
      this._setEventToSubscriptionMapping(/* @__PURE__ */ new Map([
        [Events.Page.Console, "console"],
        [Events.Page.Dialog, "dialog"],
        [Events.Page.Request, "request"],
        [Events.Page.Response, "response"],
        [Events.Page.RequestFinished, "requestFinished"],
        [Events.Page.RequestFailed, "requestFailed"],
        [Events.Page.FileChooser, "fileChooser"]
      ]));
    }
    _onFrameAttached(frame) {
      frame._page = this;
      this._frames.add(frame);
      if (frame._parentFrame)
        frame._parentFrame._childFrames.add(frame);
      this.emit(Events.Page.FrameAttached, frame);
      this._browserContext.emit(Events.BrowserContext.FrameAttached, frame);
    }
    _onFrameDetached(frame) {
      this._frames.delete(frame);
      frame._detached = true;
      if (frame._parentFrame)
        frame._parentFrame._childFrames.delete(frame);
      this.emit(Events.Page.FrameDetached, frame);
      this._browserContext.emit(Events.BrowserContext.FrameDetached, frame);
    }
    async _onRoute(route) {
      route._context = this.context();
      const routeHandlers = this._routes.slice();
      for (const routeHandler of routeHandlers) {
        if (this._closeWasCalled || this._browserContext.isClosed())
          return;
        if (!routeHandler.matches(route.request().url()))
          continue;
        const index = this._routes.indexOf(routeHandler);
        if (index === -1)
          continue;
        if (routeHandler.willExpire())
          this._routes.splice(index, 1);
        const handled = await routeHandler.handle(route);
        if (!this._routes.length)
          this._updateInterceptionPatterns({ internal: true }).catch(() => {
          });
        if (handled)
          return;
      }
      await this._browserContext._onRoute(route);
    }
    async _onWebSocketRoute(webSocketRoute) {
      const routeHandler = this._webSocketRoutes.find((route) => route.matches(webSocketRoute.url()));
      if (routeHandler)
        await routeHandler.handle(webSocketRoute);
      else
        await this._browserContext._onWebSocketRoute(webSocketRoute);
    }
    async _onBinding(bindingCall) {
      const func = this._bindings.get(bindingCall._initializer.name);
      if (func) {
        await bindingCall.call(func);
        return;
      }
      await this._browserContext._onBinding(bindingCall);
    }
    _onWorker(worker) {
      this._workers.add(worker);
      worker._page = this;
      this.emit(Events.Page.Worker, worker);
    }
    _onClose() {
      this._closed = true;
      this._browserContext._pages.delete(this);
      this._disposeHarRouters();
      this.emit(Events.Page.Close, this);
      this._browserContext.emit(Events.BrowserContext.PageClose, this);
    }
    _onCrash() {
      this.emit(Events.Page.Crash, this);
    }
    context() {
      return this._browserContext;
    }
    async opener() {
      if (!this._opener || this._opener.isClosed())
        return null;
      return this._opener;
    }
    mainFrame() {
      return this._mainFrame;
    }
    frame(frameSelector) {
      const name = isString(frameSelector) ? frameSelector : frameSelector.name;
      const url = isObject(frameSelector) ? frameSelector.url : void 0;
      assert(name || url, "Either name or url matcher should be specified");
      return this.frames().find((f) => {
        if (name)
          return f.name() === name;
        return urlMatches(this._browserContext._options.baseURL, f.url(), url);
      }) || null;
    }
    frames() {
      return [...this._frames];
    }
    setDefaultNavigationTimeout(timeout) {
      this._timeoutSettings.setDefaultNavigationTimeout(timeout);
    }
    setDefaultTimeout(timeout) {
      this._timeoutSettings.setDefaultTimeout(timeout);
    }
    video() {
      if (!this._browserContext._options.recordVideo)
        return null;
      return this._video;
    }
    async pickLocator() {
      const { selector } = await this._channel.pickLocator({});
      return this.locator(selector);
    }
    async cancelPickLocator() {
      await this._channel.cancelPickLocator({});
    }
    async hideHighlight() {
      await this._channel.hideHighlight({});
    }
    async $(selector, options) {
      return await this._mainFrame.$(selector, options);
    }
    async waitForSelector(selector, options) {
      return await this._mainFrame.waitForSelector(selector, options);
    }
    async dispatchEvent(selector, type, eventInit, options) {
      return await this._mainFrame.dispatchEvent(selector, type, eventInit, options);
    }
    async evaluateHandle(pageFunction, arg) {
      assertMaxArguments(arguments.length, 2);
      return await this._mainFrame.evaluateHandle(pageFunction, arg);
    }
    async $eval(selector, pageFunction, arg) {
      assertMaxArguments(arguments.length, 3);
      return await this._mainFrame.$eval(selector, pageFunction, arg);
    }
    async $$eval(selector, pageFunction, arg) {
      assertMaxArguments(arguments.length, 3);
      return await this._mainFrame.$$eval(selector, pageFunction, arg);
    }
    async $$(selector) {
      return await this._mainFrame.$$(selector);
    }
    async addScriptTag(options = {}) {
      return await this._mainFrame.addScriptTag(options);
    }
    async addStyleTag(options = {}) {
      return await this._mainFrame.addStyleTag(options);
    }
    async exposeFunction(name, callback) {
      const result = await this._channel.exposeBinding({ name });
      const binding = (source, ...args) => callback(...args);
      this._bindings.set(name, binding);
      return DisposableObject.from(result.disposable);
    }
    async exposeBinding(name, callback) {
      const result = await this._channel.exposeBinding({ name });
      this._bindings.set(name, callback);
      return DisposableObject.from(result.disposable);
    }
    async setExtraHTTPHeaders(headers) {
      validateHeaders(headers);
      await this._channel.setExtraHTTPHeaders({ headers: headersObjectToArray(headers) });
    }
    url() {
      return this._mainFrame.url();
    }
    async content() {
      return await this._mainFrame.content();
    }
    async setContent(html, options) {
      return await this._mainFrame.setContent(html, options);
    }
    async goto(url, options) {
      return await this._mainFrame.goto(url, options);
    }
    async reload(options = {}) {
      const waitUntil = verifyLoadState("waitUntil", options.waitUntil === void 0 ? "load" : options.waitUntil);
      return Response.fromNullable((await this._channel.reload({ ...options, waitUntil, timeout: this._timeoutSettings.navigationTimeout(options) })).response);
    }
    async addLocatorHandler(locator, handler, options = {}) {
      if (locator._frame !== this._mainFrame)
        throw new Error(`Locator must belong to the main frame of this page`);
      if (options.times === 0)
        return;
      const { uid } = await this._channel.registerLocatorHandler({ selector: locator._selector, noWaitAfter: options.noWaitAfter });
      this._locatorHandlers.set(uid, { locator, handler, times: options.times });
    }
    async _onLocatorHandlerTriggered(uid) {
      let remove = false;
      try {
        const handler = this._locatorHandlers.get(uid);
        if (handler && handler.times !== 0) {
          if (handler.times !== void 0)
            handler.times--;
          await handler.handler(handler.locator);
        }
        remove = handler?.times === 0;
      } finally {
        if (remove)
          this._locatorHandlers.delete(uid);
        this._channel.resolveLocatorHandlerNoReply({ uid, remove }).catch(() => {
        });
      }
    }
    async removeLocatorHandler(locator) {
      for (const [uid, data] of this._locatorHandlers) {
        if (data.locator._equals(locator)) {
          this._locatorHandlers.delete(uid);
          await this._channel.unregisterLocatorHandler({ uid }).catch(() => {
          });
        }
      }
    }
    async waitForLoadState(state, options) {
      return await this._mainFrame.waitForLoadState(state, options);
    }
    async waitForNavigation(options) {
      return await this._mainFrame.waitForNavigation(options);
    }
    async waitForURL(url, options) {
      return await this._mainFrame.waitForURL(url, options);
    }
    async waitForRequest(urlOrPredicate, options = {}) {
      const predicate = async (request) => {
        if (isString(urlOrPredicate) || isRegExp(urlOrPredicate))
          return urlMatches(this._browserContext._options.baseURL, request.url(), urlOrPredicate);
        return await urlOrPredicate(request);
      };
      const trimmedUrl = trimUrl(urlOrPredicate);
      const logLine = trimmedUrl ? `waiting for request ${trimmedUrl}` : void 0;
      return await this._waitForEvent(Events.Page.Request, { predicate, timeout: options.timeout }, logLine);
    }
    async waitForResponse(urlOrPredicate, options = {}) {
      const predicate = async (response) => {
        if (isString(urlOrPredicate) || isRegExp(urlOrPredicate))
          return urlMatches(this._browserContext._options.baseURL, response.url(), urlOrPredicate);
        return await urlOrPredicate(response);
      };
      const trimmedUrl = trimUrl(urlOrPredicate);
      const logLine = trimmedUrl ? `waiting for response ${trimmedUrl}` : void 0;
      return await this._waitForEvent(Events.Page.Response, { predicate, timeout: options.timeout }, logLine);
    }
    async waitForEvent(event, optionsOrPredicate = {}) {
      return await this._waitForEvent(event, optionsOrPredicate, `waiting for event "${event}"`);
    }
    _closeErrorWithReason() {
      return new TargetClosedError(this._closeReason || this._browserContext._effectiveCloseReason());
    }
    async _waitForEvent(event, optionsOrPredicate, logLine) {
      return await this._wrapApiCall(async () => {
        const timeout = this._timeoutSettings.timeout(typeof optionsOrPredicate === "function" ? {} : optionsOrPredicate);
        const predicate = typeof optionsOrPredicate === "function" ? optionsOrPredicate : optionsOrPredicate.predicate;
        const waiter = Waiter.createForEvent(this, event);
        if (logLine)
          waiter.log(logLine);
        waiter.rejectOnTimeout(timeout, `Timeout ${timeout}ms exceeded while waiting for event "${event}"`);
        if (event !== Events.Page.Crash)
          waiter.rejectOnEvent(this, Events.Page.Crash, new Error("Page crashed"));
        if (event !== Events.Page.Close)
          waiter.rejectOnEvent(this, Events.Page.Close, () => this._closeErrorWithReason());
        const result = await waiter.waitForEvent(this, event, predicate);
        waiter.dispose();
        return result;
      });
    }
    async goBack(options = {}) {
      const waitUntil = verifyLoadState("waitUntil", options.waitUntil === void 0 ? "load" : options.waitUntil);
      return Response.fromNullable((await this._channel.goBack({ ...options, waitUntil, timeout: this._timeoutSettings.navigationTimeout(options) })).response);
    }
    async goForward(options = {}) {
      const waitUntil = verifyLoadState("waitUntil", options.waitUntil === void 0 ? "load" : options.waitUntil);
      return Response.fromNullable((await this._channel.goForward({ ...options, waitUntil, timeout: this._timeoutSettings.navigationTimeout(options) })).response);
    }
    async requestGC() {
      await this._channel.requestGC();
    }
    async emulateMedia(options = {}) {
      await this._channel.emulateMedia({
        media: options.media === null ? "no-override" : options.media,
        colorScheme: options.colorScheme === null ? "no-override" : options.colorScheme,
        reducedMotion: options.reducedMotion === null ? "no-override" : options.reducedMotion,
        forcedColors: options.forcedColors === null ? "no-override" : options.forcedColors,
        contrast: options.contrast === null ? "no-override" : options.contrast
      });
    }
    async setViewportSize(viewportSize) {
      this._viewportSize = viewportSize;
      await this._channel.setViewportSize({ viewportSize });
    }
    viewportSize() {
      return this._viewportSize || null;
    }
    async evaluate(pageFunction, arg) {
      assertMaxArguments(arguments.length, 2);
      return await this._mainFrame.evaluate(pageFunction, arg);
    }
    async addInitScript(script, arg) {
      const source = await evaluationScript(this._platform, script, arg);
      return DisposableObject.from((await this._channel.addInitScript({ source })).disposable);
    }
    async route(url, handler, options = {}) {
      this._routes.unshift(new RouteHandler(this._platform, this._browserContext._options.baseURL, url, handler, options.times));
      await this._updateInterceptionPatterns({ title: "Route requests" });
      return new DisposableStub(() => this.unroute(url, handler));
    }
    async routeFromHAR(har, options = {}) {
      const localUtils = this._connection.localUtils();
      if (!localUtils)
        throw new Error("Route from har is not supported in thin clients");
      if (options.update) {
        await this._browserContext.tracing._recordIntoHAR(har, this, options);
        return;
      }
      const harRouter = await HarRouter.create(localUtils, har, options.notFound || "abort", { urlMatch: options.url });
      this._harRouters.push(harRouter);
      await harRouter.addPageRoute(this);
    }
    async routeWebSocket(url, handler) {
      this._webSocketRoutes.unshift(new WebSocketRouteHandler(this._browserContext._options.baseURL, url, handler));
      await this._updateWebSocketInterceptionPatterns({ title: "Route WebSockets" });
    }
    _disposeHarRouters() {
      this._harRouters.forEach((router) => router.dispose());
      this._harRouters = [];
    }
    async unrouteAll(options) {
      await this._unrouteInternal(this._routes, [], options?.behavior);
      this._disposeHarRouters();
    }
    async unroute(url, handler) {
      const removed = [];
      const remaining = [];
      for (const route of this._routes) {
        if (urlMatchesEqual(route.url, url) && (!handler || route.handler === handler))
          removed.push(route);
        else
          remaining.push(route);
      }
      await this._unrouteInternal(removed, remaining, "default");
    }
    async _unrouteInternal(removed, remaining, behavior) {
      this._routes = remaining;
      if (behavior && behavior !== "default") {
        const promises = removed.map((routeHandler) => routeHandler.stop(behavior));
        await Promise.all(promises);
      }
      await this._updateInterceptionPatterns({ title: "Unroute requests" });
    }
    async _updateInterceptionPatterns(options) {
      const patterns = RouteHandler.prepareInterceptionPatterns(this._routes);
      await this._wrapApiCall(() => this._channel.setNetworkInterceptionPatterns({ patterns }), options);
    }
    async _updateWebSocketInterceptionPatterns(options) {
      const patterns = WebSocketRouteHandler.prepareInterceptionPatterns(this._webSocketRoutes);
      await this._wrapApiCall(() => this._channel.setWebSocketInterceptionPatterns({ patterns }), options);
    }
    async screenshot(options = {}) {
      const mask = options.mask;
      const copy = { ...options, mask: void 0, timeout: this._timeoutSettings.timeout(options) };
      if (!copy.type)
        copy.type = determineScreenshotType(options);
      if (mask) {
        copy.mask = mask.map((locator) => ({
          frame: locator._frame._channel,
          selector: locator._selector
        }));
      }
      const result = await this._channel.screenshot(copy);
      if (options.path) {
        await mkdirIfNeeded(this._platform, options.path);
        await this._platform.fs().promises.writeFile(options.path, result.binary);
      }
      return result.binary;
    }
    async _expectScreenshot(options) {
      const mask = options?.mask ? options?.mask.map((locator2) => ({
        frame: locator2._frame._channel,
        selector: locator2._selector
      })) : void 0;
      const locator = options.locator ? {
        frame: options.locator._frame._channel,
        selector: options.locator._selector
      } : void 0;
      try {
        const result = await this._channel.expectScreenshot({
          ...options,
          isNot: !!options.isNot,
          locator,
          mask
        });
        return { actual: result.actual };
      } catch (e) {
        if (!(e instanceof PlaywrightError))
          throw e;
        const details = e.details;
        return { ...details, errorMessage: details.customErrorMessage };
      }
    }
    async title() {
      return await this._mainFrame.title();
    }
    async bringToFront() {
      await this._channel.bringToFront();
    }
    async [Symbol.asyncDispose]() {
      await this.close();
    }
    async close(options = {}) {
      this._closeReason = options.reason;
      if (!options.runBeforeUnload)
        this._closeWasCalled = true;
      try {
        if (this._ownedContext)
          await this._ownedContext.close();
        else if (options.runBeforeUnload)
          await this._channel.runBeforeUnload();
        else
          await this._channel.close({ reason: options.reason });
      } catch (e) {
        if (isTargetClosedError(e) && !options.runBeforeUnload)
          return;
        throw e;
      }
    }
    isClosed() {
      return this._closed;
    }
    async click(selector, options) {
      return await this._mainFrame.click(selector, options);
    }
    async dragAndDrop(source, target, options) {
      return await this._mainFrame.dragAndDrop(source, target, options);
    }
    async dblclick(selector, options) {
      await this._mainFrame.dblclick(selector, options);
    }
    async tap(selector, options) {
      return await this._mainFrame.tap(selector, options);
    }
    async fill(selector, value, options) {
      return await this._mainFrame.fill(selector, value, options);
    }
    async clearConsoleMessages() {
      await this._channel.clearConsoleMessages();
    }
    async consoleMessages(options) {
      const { messages } = await this._channel.consoleMessages({ filter: options?.filter });
      return messages.map((message) => new ConsoleMessage(this._platform, message, this, null));
    }
    async clearPageErrors() {
      await this._channel.clearPageErrors();
    }
    async pageErrors(options) {
      const { errors } = await this._channel.pageErrors({ filter: options?.filter });
      return errors.map((error) => parseError(error));
    }
    locator(selector, options) {
      return this.mainFrame().locator(selector, options);
    }
    getByTestId(testId) {
      return this.mainFrame().getByTestId(testId);
    }
    getByAltText(text, options) {
      return this.mainFrame().getByAltText(text, options);
    }
    getByLabel(text, options) {
      return this.mainFrame().getByLabel(text, options);
    }
    getByPlaceholder(text, options) {
      return this.mainFrame().getByPlaceholder(text, options);
    }
    getByText(text, options) {
      return this.mainFrame().getByText(text, options);
    }
    getByTitle(text, options) {
      return this.mainFrame().getByTitle(text, options);
    }
    getByRole(role, options = {}) {
      return this.mainFrame().getByRole(role, options);
    }
    frameLocator(selector) {
      return this.mainFrame().frameLocator(selector);
    }
    async focus(selector, options) {
      return await this._mainFrame.focus(selector, options);
    }
    async textContent(selector, options) {
      return await this._mainFrame.textContent(selector, options);
    }
    async innerText(selector, options) {
      return await this._mainFrame.innerText(selector, options);
    }
    async innerHTML(selector, options) {
      return await this._mainFrame.innerHTML(selector, options);
    }
    async getAttribute(selector, name, options) {
      return await this._mainFrame.getAttribute(selector, name, options);
    }
    async inputValue(selector, options) {
      return await this._mainFrame.inputValue(selector, options);
    }
    async isChecked(selector, options) {
      return await this._mainFrame.isChecked(selector, options);
    }
    async isDisabled(selector, options) {
      return await this._mainFrame.isDisabled(selector, options);
    }
    async isEditable(selector, options) {
      return await this._mainFrame.isEditable(selector, options);
    }
    async isEnabled(selector, options) {
      return await this._mainFrame.isEnabled(selector, options);
    }
    async isHidden(selector, options) {
      return await this._mainFrame.isHidden(selector, options);
    }
    async isVisible(selector, options) {
      return await this._mainFrame.isVisible(selector, options);
    }
    async hover(selector, options) {
      return await this._mainFrame.hover(selector, options);
    }
    async selectOption(selector, values, options) {
      return await this._mainFrame.selectOption(selector, values, options);
    }
    async setInputFiles(selector, files, options) {
      return await this._mainFrame.setInputFiles(selector, files, options);
    }
    async type(selector, text, options) {
      return await this._mainFrame.type(selector, text, options);
    }
    async press(selector, key, options) {
      return await this._mainFrame.press(selector, key, options);
    }
    async check(selector, options) {
      return await this._mainFrame.check(selector, options);
    }
    async uncheck(selector, options) {
      return await this._mainFrame.uncheck(selector, options);
    }
    async setChecked(selector, checked, options) {
      return await this._mainFrame.setChecked(selector, checked, options);
    }
    async waitForTimeout(timeout) {
      return await this._mainFrame.waitForTimeout(timeout);
    }
    async waitForFunction(pageFunction, arg, options) {
      return await this._mainFrame.waitForFunction(pageFunction, arg, options);
    }
    async requests() {
      const { requests } = await this._channel.requests();
      return requests.map((request) => Request.from(request));
    }
    workers() {
      return [...this._workers];
    }
    async pause(_options) {
      if (this._platform.isJSDebuggerAttached())
        return;
      const defaultNavigationTimeout = this._browserContext._timeoutSettings.defaultNavigationTimeout();
      const defaultTimeout = this._browserContext._timeoutSettings.defaultTimeout();
      this._browserContext.setDefaultNavigationTimeout(0);
      this._browserContext.setDefaultTimeout(0);
      this._instrumentation?.onWillPause({ keepTestTimeout: !!_options?.__testHookKeepTestTimeout });
      await this._closedOrCrashedScope.safeRace(this.context()._channel.pause());
      this._browserContext.setDefaultNavigationTimeout(defaultNavigationTimeout);
      this._browserContext.setDefaultTimeout(defaultTimeout);
    }
    async pdf(options = {}) {
      const transportOptions = { ...options };
      if (transportOptions.margin)
        transportOptions.margin = { ...transportOptions.margin };
      if (typeof options.width === "number")
        transportOptions.width = options.width + "px";
      if (typeof options.height === "number")
        transportOptions.height = options.height + "px";
      for (const margin of ["top", "right", "bottom", "left"]) {
        const index = margin;
        if (options.margin && typeof options.margin[index] === "number")
          transportOptions.margin[index] = transportOptions.margin[index] + "px";
      }
      const result = await this._channel.pdf(transportOptions);
      if (options.path) {
        const platform = this._platform;
        await platform.fs().promises.mkdir(platform.path().dirname(options.path), { recursive: true });
        await platform.fs().promises.writeFile(options.path, result.pdf);
      }
      return result.pdf;
    }
    async ariaSnapshot(options = {}) {
      const result = await this.mainFrame()._channel.ariaSnapshot({ timeout: this._timeoutSettings.timeout(options), track: options._track, mode: options.mode, depth: options.depth, boxes: options.boxes });
      return result.snapshot;
    }
    async _setDockTile(image) {
      await this._channel.setDockTile({ image });
    }
  };
  var BindingCall = class extends ChannelOwner {
    static from(channel) {
      return channel._object;
    }
    constructor(parent, type, guid, initializer) {
      super(parent, type, guid, initializer);
    }
    async call(func) {
      try {
        const frame = Frame.from(this._initializer.frame);
        const source = {
          context: frame._page.context(),
          page: frame._page,
          frame
        };
        const result = await func(source, ...this._initializer.args.map(parseResult));
        this._channel.resolve({ result: serializeArgument(result) }).catch(() => {
        });
      } catch (e) {
        this._channel.reject({ error: serializeError(e) }).catch(() => {
        });
      }
    }
  };
  function trimUrl(param) {
    if (isRegExp(param))
      return `/${trimStringWithEllipsis(param.source, 50)}/${param.flags}`;
    if (isString(param))
      return `"${trimStringWithEllipsis(param, 50)}"`;
  }

  // src/browser/run/playwright-client/vendor/client/dialog.ts
  var Dialog = class extends ChannelOwner {
    static from(dialog) {
      return dialog._object;
    }
    _page;
    constructor(parent, type, guid, initializer) {
      super(parent, type, guid, initializer);
      this._page = Page.fromNullable(initializer.page);
    }
    page() {
      return this._page;
    }
    type() {
      return this._initializer.type;
    }
    message() {
      return this._initializer.message;
    }
    defaultValue() {
      return this._initializer.defaultValue;
    }
    async accept(promptText) {
      await this._channel.accept({ promptText });
    }
    async dismiss() {
      try {
        await this._channel.dismiss();
      } catch (e) {
        if (isTargetClosedError(e))
          return;
        throw e;
      }
    }
  };

  // src/browser/run/playwright-client/vendor/client/webError.ts
  var WebError = class {
    _page;
    _error;
    _location;
    constructor(page, error, location) {
      this._page = page;
      this._error = error;
      this._location = location;
    }
    page() {
      return this._page;
    }
    error() {
      return this._error;
    }
    location() {
      return this._location;
    }
  };

  // src/browser/run/playwright-client/vendor/client/browserContext.ts
  var BrowserContext = class _BrowserContext extends ChannelOwner {
    _pages = /* @__PURE__ */ new Set();
    _routes = [];
    _webSocketRoutes = [];
    // Browser is null for browser contexts created outside of normal browser, e.g. android or electron.
    _browser = null;
    _bindings = /* @__PURE__ */ new Map();
    _timeoutSettings;
    _ownerPage;
    _forReuse = false;
    _closedPromise;
    _options;
    debugger;
    request;
    tracing;
    clock;
    credentials;
    _serviceWorkers = /* @__PURE__ */ new Set();
    _closingStatus = "none";
    _closeReason;
    _harRouters = [];
    _onRecorderEventSink;
    static from(context) {
      return context._object;
    }
    static fromNullable(context) {
      return context ? _BrowserContext.from(context) : null;
    }
    constructor(parent, type, guid, initializer) {
      super(parent, type, guid, initializer);
      this._options = initializer.options;
      this._timeoutSettings = new TimeoutSettings(this._platform);
      this.debugger = Debugger.from(initializer.debugger);
      this.tracing = Tracing.from(initializer.tracing);
      this.request = APIRequestContext.from(initializer.requestContext);
      this.request._timeoutSettings = this._timeoutSettings;
      this.clock = new Clock(this);
      this.credentials = new Credentials(this);
      this._channel.on("bindingCall", ({ binding }) => this._onBinding(BindingCall.from(binding)));
      this._channel.on("close", () => this._onClose());
      this._channel.on("page", ({ page }) => this._onPage(Page.from(page)));
      this._channel.on("route", ({ route }) => this._onRoute(Route.from(route)));
      this._channel.on("webSocketRoute", ({ webSocketRoute }) => this._onWebSocketRoute(WebSocketRoute.from(webSocketRoute)));
      this._channel.on("serviceWorker", ({ worker }) => {
        const serviceWorker = Worker.from(worker);
        serviceWorker._context = this;
        this._serviceWorkers.add(serviceWorker);
        this.emit(Events.BrowserContext.ServiceWorker, serviceWorker);
      });
      this._channel.on("console", (event) => {
        const worker = Worker.fromNullable(event.worker);
        const page = Page.fromNullable(event.page);
        const consoleMessage = new ConsoleMessage(this._platform, event, page, worker);
        worker?.emit(Events.Worker.Console, consoleMessage);
        page?.emit(Events.Page.Console, consoleMessage);
        if (worker && this._serviceWorkers.has(worker)) {
          const scope = this._serviceWorkerScope(worker);
          for (const page2 of this._pages) {
            if (scope && page2.url().startsWith(scope))
              page2.emit(Events.Page.Console, consoleMessage);
          }
        }
        this.emit(Events.BrowserContext.Console, consoleMessage);
      });
      this._channel.on("pageError", ({ error, page, location }) => {
        const pageObject = Page.from(page);
        const parsedError = parseError(error);
        this.emit(Events.BrowserContext.WebError, new WebError(pageObject, parsedError, location));
        if (pageObject)
          pageObject.emit(Events.Page.PageError, parsedError);
      });
      this._channel.on("dialog", ({ dialog }) => {
        const dialogObject = Dialog.from(dialog);
        let hasListeners = this.emit(Events.BrowserContext.Dialog, dialogObject);
        const page = dialogObject.page();
        if (page)
          hasListeners = page.emit(Events.Page.Dialog, dialogObject) || hasListeners;
        if (!hasListeners) {
          if (dialogObject.type() === "beforeunload")
            dialog.accept({}).catch(() => {
            });
          else
            dialog.dismiss().catch(() => {
            });
        }
      });
      this._channel.on("request", ({ request, page }) => this._onRequest(Request.from(request), Page.fromNullable(page)));
      this._channel.on("requestFailed", ({ request, failureText, responseEndTiming, page }) => this._onRequestFailed(Request.from(request), responseEndTiming, failureText, Page.fromNullable(page)));
      this._channel.on("requestFinished", (params) => this._onRequestFinished(params));
      this._channel.on("response", ({ response, page }) => this._onResponse(Response.from(response), Page.fromNullable(page)));
      this._channel.on("recorderEvent", ({ event, data, page, code }) => {
        if (event === "actionAdded")
          this._onRecorderEventSink?.actionAdded?.(Page.from(page), data, code);
        else if (event === "actionUpdated")
          this._onRecorderEventSink?.actionUpdated?.(Page.from(page), data, code);
        else if (event === "signalAdded")
          this._onRecorderEventSink?.signalAdded?.(Page.from(page), data);
      });
      this._closedPromise = new Promise((f) => this.once(Events.BrowserContext.Close, f));
      this._setEventToSubscriptionMapping(/* @__PURE__ */ new Map([
        [Events.BrowserContext.Console, "console"],
        [Events.BrowserContext.Dialog, "dialog"],
        [Events.BrowserContext.Request, "request"],
        [Events.BrowserContext.Response, "response"],
        [Events.BrowserContext.RequestFinished, "requestFinished"],
        [Events.BrowserContext.RequestFailed, "requestFailed"]
      ]));
    }
    async _initializeHarFromOptions(recordHar) {
      if (!recordHar)
        return;
      const defaultContent = recordHar.path.endsWith(".zip") ? "attach" : "embed";
      await this.tracing._recordIntoHAR(recordHar.path, null, {
        url: recordHar.urlFilter,
        updateContent: recordHar.content ?? (recordHar.omitContent ? "omit" : defaultContent),
        updateMode: recordHar.mode ?? "full"
      });
    }
    _onPage(page) {
      this._pages.add(page);
      this.emit(Events.BrowserContext.Page, page);
      if (page._opener && !page._opener.isClosed())
        page._opener.emit(Events.Page.Popup, page);
    }
    _onRequest(request, page) {
      this.emit(Events.BrowserContext.Request, request);
      if (page)
        page.emit(Events.Page.Request, request);
    }
    _onResponse(response, page) {
      this.emit(Events.BrowserContext.Response, response);
      if (page)
        page.emit(Events.Page.Response, response);
    }
    _onRequestFailed(request, responseEndTiming, failureText, page) {
      request._failureText = failureText || null;
      request._setResponseEndTiming(responseEndTiming);
      this.emit(Events.BrowserContext.RequestFailed, request);
      if (page)
        page.emit(Events.Page.RequestFailed, request);
    }
    _onRequestFinished(params) {
      const { responseEndTiming } = params;
      const request = Request.from(params.request);
      const response = Response.fromNullable(params.response);
      const page = Page.fromNullable(params.page);
      request._setResponseEndTiming(responseEndTiming);
      this.emit(Events.BrowserContext.RequestFinished, request);
      if (page)
        page.emit(Events.Page.RequestFinished, request);
      if (response)
        response._finishedPromise.resolve(null);
    }
    async _onRoute(route) {
      route._context = this;
      const page = route.request()._safePage();
      const routeHandlers = this._routes.slice();
      for (const routeHandler of routeHandlers) {
        if (page?._closeWasCalled || this.isClosed())
          return;
        if (!routeHandler.matches(route.request().url()))
          continue;
        const index = this._routes.indexOf(routeHandler);
        if (index === -1)
          continue;
        if (routeHandler.willExpire())
          this._routes.splice(index, 1);
        const handled = await routeHandler.handle(route);
        if (!this._routes.length)
          this._updateInterceptionPatterns({ internal: true }).catch(() => {
          });
        if (handled)
          return;
      }
      await route._innerContinue(
        true
        /* isFallback */
      ).catch(() => {
      });
    }
    async _onWebSocketRoute(webSocketRoute) {
      const routeHandler = this._webSocketRoutes.find((route) => route.matches(webSocketRoute.url()));
      if (routeHandler)
        await routeHandler.handle(webSocketRoute);
      else
        webSocketRoute.connectToServer();
    }
    async _onBinding(bindingCall) {
      const func = this._bindings.get(bindingCall._initializer.name);
      if (!func)
        return;
      await bindingCall.call(func);
    }
    _serviceWorkerScope(serviceWorker) {
      try {
        let url = new URL(".", serviceWorker.url()).href;
        if (!url.endsWith("/"))
          url += "/";
        return url;
      } catch {
        return null;
      }
    }
    setDefaultNavigationTimeout(timeout) {
      this._timeoutSettings.setDefaultNavigationTimeout(timeout);
    }
    setDefaultTimeout(timeout) {
      this._timeoutSettings.setDefaultTimeout(timeout);
    }
    browser() {
      return this._browser;
    }
    pages() {
      return [...this._pages];
    }
    isClosed() {
      return this._closingStatus !== "none";
    }
    async newPage() {
      if (this._ownerPage)
        throw new Error("Please use browser.newContext()");
      return Page.from((await this._channel.newPage()).page);
    }
    async cookies(urls) {
      if (!urls)
        urls = [];
      if (urls && typeof urls === "string")
        urls = [urls];
      return (await this._channel.cookies({ urls })).cookies;
    }
    async addCookies(cookies) {
      await this._channel.addCookies({ cookies });
    }
    async clearCookies(options = {}) {
      await this._channel.clearCookies({
        name: isString(options.name) ? options.name : void 0,
        nameRegexSource: isRegExp(options.name) ? options.name.source : void 0,
        nameRegexFlags: isRegExp(options.name) ? options.name.flags : void 0,
        domain: isString(options.domain) ? options.domain : void 0,
        domainRegexSource: isRegExp(options.domain) ? options.domain.source : void 0,
        domainRegexFlags: isRegExp(options.domain) ? options.domain.flags : void 0,
        path: isString(options.path) ? options.path : void 0,
        pathRegexSource: isRegExp(options.path) ? options.path.source : void 0,
        pathRegexFlags: isRegExp(options.path) ? options.path.flags : void 0
      });
    }
    async grantPermissions(permissions, options) {
      await this._channel.grantPermissions({ permissions, ...options });
    }
    async clearPermissions() {
      await this._channel.clearPermissions();
    }
    async setGeolocation(geolocation) {
      await this._channel.setGeolocation({ geolocation: geolocation || void 0 });
    }
    async setExtraHTTPHeaders(headers) {
      validateHeaders(headers);
      await this._channel.setExtraHTTPHeaders({ headers: headersObjectToArray(headers) });
    }
    async setOffline(offline) {
      await this._channel.setOffline({ offline });
    }
    async setHTTPCredentials(httpCredentials) {
      await this._channel.setHTTPCredentials({ httpCredentials: httpCredentials || void 0 });
    }
    async addInitScript(script, arg) {
      const source = await evaluationScript(this._platform, script, arg);
      return DisposableObject.from((await this._channel.addInitScript({ source })).disposable);
    }
    async exposeBinding(name, callback) {
      const result = await this._channel.exposeBinding({ name });
      this._bindings.set(name, callback);
      return DisposableObject.from(result.disposable);
    }
    async exposeFunction(name, callback) {
      const result = await this._channel.exposeBinding({ name });
      const binding = (source, ...args) => callback(...args);
      this._bindings.set(name, binding);
      return DisposableObject.from(result.disposable);
    }
    async route(url, handler, options = {}) {
      this._routes.unshift(new RouteHandler(this._platform, this._options.baseURL, url, handler, options.times));
      await this._updateInterceptionPatterns({ title: "Route requests" });
      return new DisposableStub(() => this.unroute(url, handler));
    }
    async routeWebSocket(url, handler) {
      this._webSocketRoutes.unshift(new WebSocketRouteHandler(this._options.baseURL, url, handler));
      await this._updateWebSocketInterceptionPatterns({ title: "Route WebSockets" });
    }
    async routeFromHAR(har, options = {}) {
      const localUtils = this._connection.localUtils();
      if (!localUtils)
        throw new Error("Route from har is not supported in thin clients");
      if (options.update) {
        await this.tracing._recordIntoHAR(har, null, options);
        return;
      }
      const harRouter = await HarRouter.create(localUtils, har, options.notFound || "abort", { urlMatch: options.url });
      this._harRouters.push(harRouter);
      await harRouter.addContextRoute(this);
    }
    _disposeHarRouters() {
      this._harRouters.forEach((router) => router.dispose());
      this._harRouters = [];
    }
    async unrouteAll(options) {
      await this._unrouteInternal(this._routes, [], options?.behavior);
      this._disposeHarRouters();
    }
    async unroute(url, handler) {
      const removed = [];
      const remaining = [];
      for (const route of this._routes) {
        if (urlMatchesEqual(route.url, url) && (!handler || route.handler === handler))
          removed.push(route);
        else
          remaining.push(route);
      }
      await this._unrouteInternal(removed, remaining, "default");
    }
    async _unrouteInternal(removed, remaining, behavior) {
      this._routes = remaining;
      if (behavior && behavior !== "default") {
        const promises = removed.map((routeHandler) => routeHandler.stop(behavior));
        await Promise.all(promises);
      }
      await this._updateInterceptionPatterns({ title: "Unroute requests" });
    }
    async _updateInterceptionPatterns(options) {
      const patterns = RouteHandler.prepareInterceptionPatterns(this._routes);
      await this._wrapApiCall(() => this._channel.setNetworkInterceptionPatterns({ patterns }), options);
    }
    async _updateWebSocketInterceptionPatterns(options) {
      const patterns = WebSocketRouteHandler.prepareInterceptionPatterns(this._webSocketRoutes);
      await this._wrapApiCall(() => this._channel.setWebSocketInterceptionPatterns({ patterns }), options);
    }
    _effectiveCloseReason() {
      return this._closeReason || this._browser?._closeReason;
    }
    async waitForEvent(event, optionsOrPredicate = {}) {
      return await this._wrapApiCall(async () => {
        const timeout = this._timeoutSettings.timeout(typeof optionsOrPredicate === "function" ? {} : optionsOrPredicate);
        const predicate = typeof optionsOrPredicate === "function" ? optionsOrPredicate : optionsOrPredicate.predicate;
        const waiter = Waiter.createForEvent(this, event);
        waiter.rejectOnTimeout(timeout, `Timeout ${timeout}ms exceeded while waiting for event "${event}"`);
        if (event !== Events.BrowserContext.Close)
          waiter.rejectOnEvent(this, Events.BrowserContext.Close, () => new TargetClosedError(this._effectiveCloseReason()));
        const result = await waiter.waitForEvent(this, event, predicate);
        waiter.dispose();
        return result;
      });
    }
    async storageState(options = {}) {
      const state = await this._channel.storageState({ indexedDB: options.indexedDB });
      if (options.path) {
        await mkdirIfNeeded(this._platform, options.path);
        await this._platform.fs().promises.writeFile(options.path, JSON.stringify(state, void 0, 2), "utf8");
      }
      return state;
    }
    async setStorageState(storageState) {
      const state = await prepareStorageState(this._platform, storageState);
      await this._channel.setStorageState({ storageState: state });
    }
    backgroundPages() {
      return [];
    }
    serviceWorkers() {
      return [...this._serviceWorkers];
    }
    async newCDPSession(page) {
      if (!(page instanceof Page) && !(page instanceof Frame))
        throw new Error("page: expected Page or Frame");
      const result = await this._channel.newCDPSession(page instanceof Page ? { page: page._channel } : { frame: page._channel });
      return CDPSession.from(result.session);
    }
    _onClose() {
      this._closingStatus = "closed";
      this._browser?._contexts.delete(this);
      this._browser?._browserType._contexts.delete(this);
      this._browser?._browserType._playwright.selectors._contextsForSelectors.delete(this);
      this._disposeHarRouters();
      this.tracing._resetStackCounter();
      this.emit(Events.BrowserContext.Close, this);
    }
    async [Symbol.asyncDispose]() {
      await this.close();
    }
    async close(options = {}) {
      if (this.isClosed())
        return;
      this._closeReason = options.reason;
      this._closingStatus = "closing";
      await this.request.dispose(options);
      await this._instrumentation.runBeforeCloseBrowserContext(this);
      await this.tracing._exportAllHars();
      await this._channel.close(options);
      await this._closedPromise;
    }
    async _enableRecorder(params, eventSink) {
      if (eventSink)
        this._onRecorderEventSink = eventSink;
      await this._channel.enableRecorder(params);
    }
    async _disableRecorder() {
      this._onRecorderEventSink = void 0;
      await this._channel.disableRecorder();
    }
    async _exposeConsoleApi() {
      await this._channel.exposeConsoleApi();
    }
  };
  async function prepareStorageState(platform, storageState) {
    if (typeof storageState !== "string")
      return storageState;
    try {
      return JSON.parse(await platform.fs().promises.readFile(storageState, "utf8"));
    } catch (e) {
      rewriteErrorMessage(e, `Error reading storage state from ${storageState}:
` + e.message);
      throw e;
    }
  }
  async function prepareBrowserContextParams(platform, options) {
    if (options.extraHTTPHeaders)
      validateHeaders(options.extraHTTPHeaders);
    const contextParams = {
      ...options,
      viewport: options.viewport === null ? void 0 : options.viewport,
      noDefaultViewport: options.viewport === null,
      extraHTTPHeaders: options.extraHTTPHeaders ? headersObjectToArray(options.extraHTTPHeaders) : void 0,
      storageState: options.storageState ? await prepareStorageState(platform, options.storageState) : void 0,
      serviceWorkers: options.serviceWorkers,
      colorScheme: options.colorScheme === null ? "no-override" : options.colorScheme,
      reducedMotion: options.reducedMotion === null ? "no-override" : options.reducedMotion,
      forcedColors: options.forcedColors === null ? "no-override" : options.forcedColors,
      contrast: options.contrast === null ? "no-override" : options.contrast,
      acceptDownloads: toAcceptDownloadsProtocol(options.acceptDownloads),
      clientCertificates: await toClientCertificatesProtocol(platform, options.clientCertificates)
    };
    if (contextParams.recordVideo && contextParams.recordVideo.dir)
      contextParams.recordVideo.dir = platform.path().resolve(contextParams.recordVideo.dir);
    return contextParams;
  }
  function toAcceptDownloadsProtocol(acceptDownloads) {
    if (acceptDownloads === void 0)
      return void 0;
    if (acceptDownloads)
      return "accept";
    return "deny";
  }
  async function toClientCertificatesProtocol(platform, certs) {
    if (!certs)
      return void 0;
    const bufferizeContent = async (value, path) => {
      if (value)
        return value;
      if (path)
        return await platform.fs().promises.readFile(path);
    };
    return await Promise.all(certs.map(async (cert) => ({
      origin: cert.origin,
      cert: await bufferizeContent(cert.cert, cert.certPath),
      key: await bufferizeContent(cert.key, cert.keyPath),
      pfx: await bufferizeContent(cert.pfx, cert.pfxPath),
      passphrase: cert.passphrase
    })));
  }

  // src/browser/run/playwright-client/vendor/client/browser.ts
  var Browser = class extends ChannelOwner {
    _contexts = /* @__PURE__ */ new Set();
    _isConnected = true;
    _closedPromise;
    _shouldCloseConnectionOnClose = false;
    _browserType;
    _options = {};
    _name;
    _browserName;
    _path;
    _closeReason;
    static from(browser) {
      return browser._object;
    }
    constructor(parent, type, guid, initializer) {
      super(parent, type, guid, initializer);
      this._name = initializer.name;
      this._browserName = initializer.browserName;
      this._channel.on("context", ({ context }) => this._didCreateContext(BrowserContext.from(context)));
      this._channel.on("close", () => this._didClose());
      this._closedPromise = new Promise((f) => this.once(Events.Browser.Disconnected, f));
    }
    browserType() {
      return this._browserType;
    }
    async newContext(options = {}) {
      return await this._innerNewContext(options, false);
    }
    async _newContextForReuse(options = {}) {
      return await this._innerNewContext(options, true);
    }
    async _disconnectFromReusedContext(reason) {
      const context = [...this._contexts].find((context2) => context2._forReuse);
      if (!context)
        return;
      await this._instrumentation.runBeforeCloseBrowserContext(context);
      for (const page of context.pages())
        page._onClose();
      context._onClose();
      await this._channel.disconnectFromReusedContext({ reason });
    }
    async _innerNewContext(userOptions = {}, forReuse) {
      const options = this._browserType._playwright.selectors._withSelectorOptions(userOptions);
      await this._instrumentation.runBeforeCreateBrowserContext(options);
      const contextOptions = await prepareBrowserContextParams(this._platform, options);
      const response = forReuse ? await this._channel.newContextForReuse(contextOptions) : await this._channel.newContext(contextOptions);
      const context = BrowserContext.from(response.context);
      if (forReuse)
        context._forReuse = true;
      if (options.logger)
        context._logger = options.logger;
      await context._initializeHarFromOptions(options.recordHar);
      await this._instrumentation.runAfterCreateBrowserContext(context);
      return context;
    }
    _connectToBrowserType(browserType, browserOptions, logger) {
      this._browserType = browserType;
      this._options = browserOptions;
      this._logger = logger;
      for (const context of this._contexts)
        this._setupBrowserContext(context);
    }
    _didCreateContext(context) {
      context._browser = this;
      this._contexts.add(context);
      if (this._browserType)
        this._setupBrowserContext(context);
      this.emit(Events.Browser.Context, context);
    }
    _setupBrowserContext(context) {
      context._logger = this._logger;
      context.tracing._tracesDir = this._options.tracesDir;
      this._browserType._contexts.add(context);
      this._browserType._playwright.selectors._contextsForSelectors.add(context);
      context.setDefaultTimeout(this._browserType._playwright._defaultContextTimeout);
      context.setDefaultNavigationTimeout(this._browserType._playwright._defaultContextNavigationTimeout);
    }
    contexts() {
      return [...this._contexts];
    }
    version() {
      return this._initializer.version;
    }
    async bind(title, options = {}) {
      const { endpoint } = await this._channel.startServer({ title, ...options });
      return { endpoint };
    }
    async unbind() {
      await this._channel.stopServer();
    }
    async newPage(options = {}) {
      return await this._wrapApiCall(async () => {
        const context = await this.newContext(options);
        const page = await context.newPage();
        page._ownedContext = context;
        context._ownerPage = page;
        return page;
      }, { title: "Create page" });
    }
    isConnected() {
      return this._isConnected;
    }
    async newBrowserCDPSession() {
      return CDPSession.from((await this._channel.newBrowserCDPSession()).session);
    }
    async startTracing(page, options = {}) {
      this._path = options.path;
      await this._channel.startTracing({ ...options, page: page ? page._channel : void 0 });
    }
    async stopTracing() {
      const artifact = Artifact.from((await this._channel.stopTracing()).artifact);
      const buffer = await artifact.readIntoBuffer();
      await artifact.delete();
      if (this._path) {
        await mkdirIfNeeded(this._platform, this._path);
        await this._platform.fs().promises.writeFile(this._path, buffer);
        this._path = void 0;
      }
      return buffer;
    }
    async [Symbol.asyncDispose]() {
      await this.close();
    }
    async close(options = {}) {
      this._closeReason = options.reason;
      try {
        if (this._shouldCloseConnectionOnClose)
          this._connection.close();
        else
          await this._channel.close(options);
        await this._closedPromise;
      } catch (e) {
        if (isTargetClosedError(e))
          return;
        throw e;
      }
    }
    _didClose() {
      this._isConnected = false;
      this.emit(Events.Browser.Disconnected, this);
    }
  };

  // src/browser/run/playwright-client/vendor/client/connect.ts
  async function connectToBrowser(playwright, params) {
    const deadline = params.timeout ? monotonicTime() + params.timeout : 0;
    const nameParam = params.browserName ? { "x-playwright-browser": params.browserName } : {};
    const headers = { ...nameParam, ...params.headers };
    const connectParams = {
      endpoint: params.endpoint,
      headers,
      exposeNetwork: params.exposeNetwork,
      slowMo: params.slowMo,
      timeout: params.timeout || 0
    };
    if (params.__testHookRedirectPortForwarding)
      connectParams.socksProxyRedirectPortForTest = params.__testHookRedirectPortForwarding;
    const connection = await connectToEndpoint(playwright._connection, connectParams);
    let browser;
    connection.on("close", () => {
      for (const context of browser?.contexts() || []) {
        for (const page of context.pages())
          page._onClose();
        context._onClose();
      }
      setTimeout(() => browser?._didClose(), 0);
    });
    const result = await raceAgainstDeadline(async () => {
      if (params.__testHookBeforeCreateBrowser)
        await params.__testHookBeforeCreateBrowser();
      const playwright2 = await connection.initializePlaywright();
      if (!playwright2._initializer.preLaunchedBrowser) {
        connection.close();
        throw new Error("Malformed endpoint. Did you use BrowserType.launchServer method?");
      }
      playwright2.selectors = playwright2.selectors;
      browser = Browser.from(playwright2._initializer.preLaunchedBrowser);
      browser._shouldCloseConnectionOnClose = true;
      browser.on(Events.Browser.Disconnected, () => connection.close());
      return browser;
    }, deadline);
    if (!result.timedOut) {
      return result.result;
    } else {
      connection.close();
      throw new Error(`Timeout ${params.timeout}ms exceeded`);
    }
  }
  async function connectToEndpoint(parentConnection, params) {
    const localUtils = parentConnection.localUtils();
    const transport = localUtils ? new JsonPipeTransport(localUtils) : new WebSocketTransport();
    const connectHeaders = await transport.connect(params);
    const connection = new Connection(parentConnection._platform, localUtils, parentConnection._instrumentation, connectHeaders);
    connection.markAsRemote();
    connection.on("close", () => transport.close());
    let closeError;
    const onTransportClosed = (reason) => {
      connection.close(reason || closeError);
    };
    transport.onClose((reason) => onTransportClosed(reason));
    connection.onmessage = (message) => transport.send(message).catch(() => onTransportClosed());
    transport.onMessage((message) => {
      try {
        connection.dispatch(message);
      } catch (e) {
        closeError = String(e);
        transport.close().catch(() => {
        });
      }
    });
    return connection;
  }
  var JsonPipeTransport = class {
    _pipe;
    _owner;
    constructor(owner) {
      this._owner = owner;
    }
    async connect(params) {
      const { pipe, headers: connectHeaders } = await this._owner._channel.connect(params);
      this._pipe = pipe;
      return connectHeaders;
    }
    async send(message) {
      await this._pipe.send({ message });
    }
    onMessage(callback) {
      this._pipe.on("message", ({ message }) => callback(message));
    }
    onClose(callback) {
      this._pipe.on("closed", ({ reason }) => callback(reason));
    }
    async close() {
      await this._pipe.close().catch(() => {
      });
    }
  };
  var WebSocketTransport = class {
    _ws;
    async connect(params) {
      this._ws = new window.WebSocket(params.endpoint);
      return [];
    }
    async send(message) {
      this._ws.send(JSON.stringify(message));
    }
    onMessage(callback) {
      this._ws.addEventListener("message", (event) => callback(JSON.parse(event.data)));
    }
    onClose(callback) {
      this._ws.addEventListener("close", () => callback());
    }
    async close() {
      this._ws.close();
    }
  };

  // src/browser/run/playwright-client/vendor/client/android.ts
  var Android = class extends ChannelOwner {
    _playwright;
    _timeoutSettings;
    _serverLauncher;
    static from(android) {
      return android._object;
    }
    constructor(parent, type, guid, initializer) {
      super(parent, type, guid, initializer);
      this._timeoutSettings = new TimeoutSettings(this._platform);
    }
    setDefaultTimeout(timeout) {
      this._timeoutSettings.setDefaultTimeout(timeout);
    }
    async devices(options = {}) {
      const { devices } = await this._channel.devices(options);
      return devices.map((d) => AndroidDevice.from(d));
    }
    async launchServer(options = {}) {
      if (!this._serverLauncher)
        throw new Error("Launching server is not supported");
      return await this._serverLauncher.launchServer(options);
    }
    async connect(endpoint, options = {}) {
      return await this._wrapApiCall(async () => {
        const deadline = options.timeout ? monotonicTime() + options.timeout : 0;
        const headers = { "x-playwright-browser": "android", ...options.headers };
        const connectParams = { endpoint, headers, slowMo: options.slowMo, timeout: options.timeout || 0 };
        const connection = await connectToEndpoint(this._connection, connectParams);
        let device;
        connection.on("close", () => {
          device?._didClose();
        });
        const result = await raceAgainstDeadline(async () => {
          const playwright = await connection.initializePlaywright();
          if (!playwright._initializer.preConnectedAndroidDevice) {
            connection.close();
            throw new Error("Malformed endpoint. Did you use Android.launchServer method?");
          }
          device = AndroidDevice.from(playwright._initializer.preConnectedAndroidDevice);
          device._shouldCloseConnectionOnClose = true;
          device.on(Events.AndroidDevice.Close, () => connection.close());
          return device;
        }, deadline);
        if (!result.timedOut) {
          return result.result;
        } else {
          connection.close();
          throw new Error(`Timeout ${options.timeout}ms exceeded`);
        }
      });
    }
  };
  var AndroidDevice = class extends ChannelOwner {
    _timeoutSettings;
    _webViews = /* @__PURE__ */ new Map();
    _android;
    _shouldCloseConnectionOnClose = false;
    static from(androidDevice) {
      return androidDevice._object;
    }
    input;
    constructor(parent, type, guid, initializer) {
      super(parent, type, guid, initializer);
      this._android = parent;
      this.input = new AndroidInput(this);
      this._timeoutSettings = new TimeoutSettings(this._platform, parent._timeoutSettings);
      this._channel.on("webViewAdded", ({ webView }) => this._onWebViewAdded(webView));
      this._channel.on("webViewRemoved", ({ socketName }) => this._onWebViewRemoved(socketName));
      this._channel.on("close", () => this._didClose());
    }
    _onWebViewAdded(webView) {
      const view = new AndroidWebView(this, webView);
      this._webViews.set(webView.socketName, view);
      this.emit(Events.AndroidDevice.WebView, view);
    }
    _onWebViewRemoved(socketName) {
      const view = this._webViews.get(socketName);
      this._webViews.delete(socketName);
      if (view)
        view.emit(Events.AndroidWebView.Close);
    }
    setDefaultTimeout(timeout) {
      this._timeoutSettings.setDefaultTimeout(timeout);
    }
    serial() {
      return this._initializer.serial;
    }
    model() {
      return this._initializer.model;
    }
    webViews() {
      return [...this._webViews.values()];
    }
    async webView(selector, options) {
      const predicate = (v) => {
        if (selector.pkg)
          return v.pkg() === selector.pkg;
        if (selector.socketName)
          return v._socketName() === selector.socketName;
        return false;
      };
      const webView = [...this._webViews.values()].find(predicate);
      if (webView)
        return webView;
      return await this.waitForEvent("webview", { ...options, predicate });
    }
    async wait(selector, options = {}) {
      await this._channel.wait({ androidSelector: toSelectorChannel(selector), ...options, timeout: this._timeoutSettings.timeout(options) });
    }
    async fill(selector, text, options = {}) {
      await this._channel.fill({ androidSelector: toSelectorChannel(selector), text, ...options, timeout: this._timeoutSettings.timeout(options) });
    }
    async press(selector, key, options = {}) {
      await this.tap(selector, options);
      await this.input.press(key);
    }
    async tap(selector, options = {}) {
      await this._channel.tap({ androidSelector: toSelectorChannel(selector), ...options, timeout: this._timeoutSettings.timeout(options) });
    }
    async drag(selector, dest, options = {}) {
      await this._channel.drag({ androidSelector: toSelectorChannel(selector), dest, ...options, timeout: this._timeoutSettings.timeout(options) });
    }
    async fling(selector, direction, options = {}) {
      await this._channel.fling({ androidSelector: toSelectorChannel(selector), direction, ...options, timeout: this._timeoutSettings.timeout(options) });
    }
    async longTap(selector, options = {}) {
      await this._channel.longTap({ androidSelector: toSelectorChannel(selector), ...options, timeout: this._timeoutSettings.timeout(options) });
    }
    async pinchClose(selector, percent, options = {}) {
      await this._channel.pinchClose({ androidSelector: toSelectorChannel(selector), percent, ...options, timeout: this._timeoutSettings.timeout(options) });
    }
    async pinchOpen(selector, percent, options = {}) {
      await this._channel.pinchOpen({ androidSelector: toSelectorChannel(selector), percent, ...options, timeout: this._timeoutSettings.timeout(options) });
    }
    async scroll(selector, direction, percent, options = {}) {
      await this._channel.scroll({ androidSelector: toSelectorChannel(selector), direction, percent, ...options, timeout: this._timeoutSettings.timeout(options) });
    }
    async swipe(selector, direction, percent, options = {}) {
      await this._channel.swipe({ androidSelector: toSelectorChannel(selector), direction, percent, ...options, timeout: this._timeoutSettings.timeout(options) });
    }
    async info(selector) {
      return (await this._channel.info({ androidSelector: toSelectorChannel(selector) })).info;
    }
    async screenshot(options = {}) {
      const { binary } = await this._channel.screenshot();
      if (options.path)
        await this._platform.fs().promises.writeFile(options.path, binary);
      return binary;
    }
    async [Symbol.asyncDispose]() {
      await this.close();
    }
    async close() {
      try {
        if (this._shouldCloseConnectionOnClose)
          this._connection.close();
        else
          await this._channel.close();
      } catch (e) {
        if (isTargetClosedError(e))
          return;
        throw e;
      }
    }
    _didClose() {
      this.emit(Events.AndroidDevice.Close, this);
    }
    async shell(command) {
      const { result } = await this._channel.shell({ command });
      return result;
    }
    async open(command) {
      return AndroidSocket.from((await this._channel.open({ command })).socket);
    }
    async installApk(file, options) {
      await this._channel.installApk({ file: await loadFile(this._platform, file), args: options && options.args });
    }
    async push(file, path, options) {
      await this._channel.push({ file: await loadFile(this._platform, file), path, mode: options ? options.mode : void 0 });
    }
    async launchBrowser(options = {}) {
      const contextOptions = await prepareBrowserContextParams(this._platform, options);
      const result = await this._channel.launchBrowser(contextOptions);
      const context = BrowserContext.from(result.context);
      const selectors = this._android._playwright.selectors;
      selectors._contextsForSelectors.add(context);
      context.once(Events.BrowserContext.Close, () => selectors._contextsForSelectors.delete(context));
      await context._initializeHarFromOptions(options.recordHar);
      return context;
    }
    async waitForEvent(event, optionsOrPredicate = {}) {
      return await this._wrapApiCall(async () => {
        const timeout = this._timeoutSettings.timeout(typeof optionsOrPredicate === "function" ? {} : optionsOrPredicate);
        const predicate = typeof optionsOrPredicate === "function" ? optionsOrPredicate : optionsOrPredicate.predicate;
        const waiter = Waiter.createForEvent(this, event);
        waiter.rejectOnTimeout(timeout, `Timeout ${timeout}ms exceeded while waiting for event "${event}"`);
        if (event !== Events.AndroidDevice.Close)
          waiter.rejectOnEvent(this, Events.AndroidDevice.Close, () => new TargetClosedError());
        const result = await waiter.waitForEvent(this, event, predicate);
        waiter.dispose();
        return result;
      });
    }
  };
  var AndroidSocket = class extends ChannelOwner {
    static from(androidDevice) {
      return androidDevice._object;
    }
    constructor(parent, type, guid, initializer) {
      super(parent, type, guid, initializer);
      this._channel.on("data", ({ data }) => this.emit(Events.AndroidSocket.Data, data));
      this._channel.on("close", () => this.emit(Events.AndroidSocket.Close));
    }
    async write(data) {
      await this._channel.write({ data });
    }
    async close() {
      await this._channel.close();
    }
    async [Symbol.asyncDispose]() {
      await this.close();
    }
  };
  async function loadFile(platform, file) {
    if (isString(file))
      return await platform.fs().promises.readFile(file);
    return file;
  }
  var AndroidInput = class {
    _device;
    constructor(device) {
      this._device = device;
    }
    async type(text) {
      await this._device._channel.inputType({ text });
    }
    async press(key) {
      await this._device._channel.inputPress({ key });
    }
    async tap(point) {
      await this._device._channel.inputTap({ point });
    }
    async swipe(from, segments, steps) {
      await this._device._channel.inputSwipe({ segments, steps });
    }
    async drag(from, to, steps) {
      await this._device._channel.inputDrag({ from, to, steps });
    }
  };
  function toSelectorChannel(selector) {
    const {
      checkable,
      checked,
      clazz,
      clickable,
      depth,
      desc,
      enabled,
      focusable,
      focused,
      hasChild,
      hasDescendant,
      longClickable,
      pkg,
      res,
      scrollable,
      selected,
      text
    } = selector;
    const toRegex = (value) => {
      if (value === void 0)
        return void 0;
      if (isRegExp(value))
        return value.source;
      return "^" + value.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&").replace(/-/g, "\\x2d") + "$";
    };
    return {
      checkable,
      checked,
      clazz: toRegex(clazz),
      pkg: toRegex(pkg),
      desc: toRegex(desc),
      res: toRegex(res),
      text: toRegex(text),
      clickable,
      depth,
      enabled,
      focusable,
      focused,
      hasChild: hasChild ? { androidSelector: toSelectorChannel(hasChild.selector) } : void 0,
      hasDescendant: hasDescendant ? { androidSelector: toSelectorChannel(hasDescendant.selector), maxDepth: hasDescendant.maxDepth } : void 0,
      longClickable,
      scrollable,
      selected
    };
  }
  var AndroidWebView = class extends EventEmitter {
    _device;
    _data;
    _pagePromise;
    constructor(device, data) {
      super(device._platform);
      this._device = device;
      this._data = data;
    }
    pid() {
      return this._data.pid;
    }
    pkg() {
      return this._data.pkg;
    }
    _socketName() {
      return this._data.socketName;
    }
    async page() {
      if (!this._pagePromise)
        this._pagePromise = this._fetchPage();
      return await this._pagePromise;
    }
    async _fetchPage() {
      const { context } = await this._device._channel.connectToWebView({ socketName: this._data.socketName });
      return BrowserContext.from(context).pages()[0];
    }
  };

  // src/browser/run/playwright-client/vendor/client/browserType.ts
  var BrowserType = class extends ChannelOwner {
    _serverLauncher;
    _contexts = /* @__PURE__ */ new Set();
    _playwright;
    static from(browserType) {
      return browserType._object;
    }
    executablePath() {
      if (!this._initializer.executablePath)
        throw new Error("Browser is not supported on current platform");
      return this._initializer.executablePath;
    }
    name() {
      return this._initializer.name;
    }
    async launch(options = {}) {
      assert(!options.userDataDir, "userDataDir option is not supported in `browserType.launch`. Use `browserType.launchPersistentContext` instead");
      assert(!options.port, "Cannot specify a port without launching as a server.");
      const logger = options.logger || this._playwright._defaultLaunchOptions?.logger;
      options = { ...this._playwright._defaultLaunchOptions, ...options };
      const launchOptions = {
        ...options,
        ignoreDefaultArgs: Array.isArray(options.ignoreDefaultArgs) ? options.ignoreDefaultArgs : void 0,
        ignoreAllDefaultArgs: !!options.ignoreDefaultArgs && !Array.isArray(options.ignoreDefaultArgs),
        env: options.env ? envObjectToArray(options.env) : void 0,
        timeout: new TimeoutSettings(this._platform).launchTimeout(options)
      };
      return await this._wrapApiCall(async () => {
        const browser = Browser.from((await this._channel.launch(launchOptions)).browser);
        browser._connectToBrowserType(this, options, logger);
        return browser;
      });
    }
    async launchServer(options = {}) {
      if (!this._serverLauncher)
        throw new Error("Launching server is not supported");
      options = { ...this._playwright._defaultLaunchOptions, ...options };
      return await this._serverLauncher.launchServer(options);
    }
    async launchPersistentContext(userDataDir, options = {}) {
      assert(!options.port, "Cannot specify a port without launching as a server.");
      options = this._playwright.selectors._withSelectorOptions({
        ...this._playwright._defaultLaunchOptions,
        ...options
      });
      await this._instrumentation.runBeforeCreateBrowserContext(options);
      const logger = options.logger || this._playwright._defaultLaunchOptions?.logger;
      const contextParams = await prepareBrowserContextParams(this._platform, options);
      const persistentParams = {
        ...contextParams,
        ignoreDefaultArgs: Array.isArray(options.ignoreDefaultArgs) ? options.ignoreDefaultArgs : void 0,
        ignoreAllDefaultArgs: !!options.ignoreDefaultArgs && !Array.isArray(options.ignoreDefaultArgs),
        env: options.env ? envObjectToArray(options.env) : void 0,
        channel: options.channel,
        userDataDir: this._platform.path().isAbsolute(userDataDir) || !userDataDir ? userDataDir : this._platform.path().resolve(userDataDir),
        timeout: new TimeoutSettings(this._platform).launchTimeout(options)
      };
      const context = await this._wrapApiCall(async () => {
        const result = await this._channel.launchPersistentContext(persistentParams);
        const browser = Browser.from(result.browser);
        browser._connectToBrowserType(this, options, logger);
        const context2 = BrowserContext.from(result.context);
        await context2._initializeHarFromOptions(options.recordHar);
        return context2;
      });
      await this._instrumentation.runAfterCreateBrowserContext(context);
      return context;
    }
    async connect(optionsOrEndpoint, options) {
      if (typeof optionsOrEndpoint === "string")
        return await this._connect({ ...options, endpoint: optionsOrEndpoint });
      assert(optionsOrEndpoint.wsEndpoint, "options.wsEndpoint is required");
      return await this._connect({ ...options, endpoint: optionsOrEndpoint.wsEndpoint });
    }
    async _connect(params) {
      return await this._wrapApiCall(async () => {
        const browser = await connectToBrowser(this._playwright, { browserName: this.name(), ...params });
        browser._connectToBrowserType(this, {}, void 0);
        return browser;
      });
    }
    async connectOverCDP(overloaded, options) {
      let endpointURL;
      let transport;
      let params;
      if (typeof overloaded === "string") {
        endpointURL = overloaded;
        params = options ?? {};
      } else if (isConnectionTransport(overloaded)) {
        if (this.name() !== "chromium" && this.name() !== "webkit")
          throw new Error("Connecting over CDP is only supported in Chromium and WebKit.");
        if (this._connection.isRemote())
          throw new Error("Passing a ConnectionTransport to connectOverCDP is not supported when connecting remotely.");
        transport = overloaded;
        params = options ?? {};
      } else {
        endpointURL = "endpointURL" in overloaded ? overloaded.endpointURL : overloaded.wsEndpoint;
        assert(endpointURL, "Cannot connect over CDP without wsEndpoint.");
        params = overloaded;
      }
      if (endpointURL && this.name() !== "chromium" && this.name() !== "webkit")
        throw new Error("Connecting over CDP is only supported in Chromium and WebKit.");
      const result = await this._channel.connectOverCDP({
        endpointURL,
        transport,
        headers: params.headers ? headersObjectToArray(params.headers) : void 0,
        slowMo: params.slowMo,
        timeout: new TimeoutSettings(this._platform).timeout(params),
        isLocal: params.isLocal,
        noDefaults: params.noDefaults,
        artifactsDir: params.artifactsDir
      });
      return await this._browserFromConnectResult(result);
    }
    async _browserFromConnectResult(result) {
      const browser = Browser.from(result.browser);
      browser._connectToBrowserType(this, {}, void 0);
      if (result.defaultContext)
        await this._instrumentation.runAfterCreateBrowserContext(BrowserContext.from(result.defaultContext));
      return browser;
    }
    async _connectToWorker(endpoint, options = {}) {
      if (this.name() !== "chromium")
        throw new Error("Connecting to workers is only supported in Chromium.");
      const result = await this._channel.connectToWorker({
        endpoint,
        timeout: new TimeoutSettings(this._platform).timeout(options)
      });
      return Worker.from(result.worker);
    }
  };
  function isConnectionTransport(value) {
    return !!value && typeof value === "object" && typeof value.send === "function" && typeof value.close === "function";
  }

  // src/browser/run/playwright-client/vendor/client/clientInstrumentation.ts
  function createInstrumentation() {
    const listeners = [];
    return new Proxy({}, {
      get: (obj, prop) => {
        if (typeof prop !== "string")
          return obj[prop];
        if (prop === "addListener")
          return (listener) => listeners.push(listener);
        if (prop === "removeListener")
          return (listener) => listeners.splice(listeners.indexOf(listener), 1);
        if (prop === "removeAllListeners")
          return () => listeners.splice(0, listeners.length);
        if (prop.startsWith("run")) {
          return async (...params) => {
            for (const listener of listeners)
              await listener[prop]?.(...params);
          };
        }
        if (prop.startsWith("on")) {
          return (...params) => {
            for (const listener of listeners)
              listener[prop]?.(...params);
          };
        }
        return obj[prop];
      }
    });
  }

  // src/browser/run/playwright-client/vendor/client/electron.ts
  var Electron = class extends ChannelOwner {
    _playwright;
    static from(electron) {
      return electron._object;
    }
    constructor(parent, type, guid, initializer) {
      super(parent, type, guid, initializer);
    }
    async launch(options = {}) {
      options = this._playwright.selectors._withSelectorOptions(options);
      const params = {
        ...await prepareBrowserContextParams(this._platform, options),
        env: envObjectToArray(options.env ? options.env : this._platform.env),
        tracesDir: options.tracesDir,
        artifactsDir: options.artifactsDir,
        timeout: new TimeoutSettings(this._platform).launchTimeout(options)
      };
      const app = ElectronApplication.from((await this._channel.launch(params)).electronApplication);
      this._playwright.selectors._contextsForSelectors.add(app._context);
      app.once(Events.ElectronApplication.Close, () => this._playwright.selectors._contextsForSelectors.delete(app._context));
      await app._context._initializeHarFromOptions(options.recordHar);
      app._context.tracing._tracesDir = options.tracesDir;
      return app;
    }
  };
  var ElectronApplication = class extends ChannelOwner {
    _context;
    _windows = /* @__PURE__ */ new Set();
    _timeoutSettings;
    static from(electronApplication) {
      return electronApplication._object;
    }
    constructor(parent, type, guid, initializer) {
      super(parent, type, guid, initializer);
      this._timeoutSettings = new TimeoutSettings(this._platform);
      this._context = BrowserContext.from(initializer.context);
      for (const page of this._context._pages)
        this._onPage(page);
      this._context.on(Events.BrowserContext.Page, (page) => this._onPage(page));
      this._channel.on("close", () => {
        this.emit(Events.ElectronApplication.Close);
      });
      this._channel.on("console", (event) => this.emit(Events.ElectronApplication.Console, new ConsoleMessage(this._platform, event, null, null)));
      this._setEventToSubscriptionMapping(/* @__PURE__ */ new Map([
        [Events.ElectronApplication.Console, "console"]
      ]));
    }
    process() {
      return this._connection.toImpl?.(this)?.process();
    }
    _onPage(page) {
      this._windows.add(page);
      this.emit(Events.ElectronApplication.Window, page);
      page.once(Events.Page.Close, () => this._windows.delete(page));
    }
    windows() {
      return [...this._windows];
    }
    async firstWindow(options) {
      if (this._windows.size)
        return this._windows.values().next().value;
      return await this.waitForEvent("window", options);
    }
    context() {
      return this._context;
    }
    async [Symbol.asyncDispose]() {
      await this.close();
    }
    async close() {
      try {
        await this._context.close();
      } catch (e) {
        if (isTargetClosedError(e))
          return;
        throw e;
      }
    }
    async waitForEvent(event, optionsOrPredicate = {}) {
      return await this._wrapApiCall(async () => {
        const timeout = this._timeoutSettings.timeout(typeof optionsOrPredicate === "function" ? {} : optionsOrPredicate);
        const predicate = typeof optionsOrPredicate === "function" ? optionsOrPredicate : optionsOrPredicate.predicate;
        const waiter = Waiter.createForEvent(this, event);
        waiter.rejectOnTimeout(timeout, `Timeout ${timeout}ms exceeded while waiting for event "${event}"`);
        if (event !== Events.ElectronApplication.Close)
          waiter.rejectOnEvent(this, Events.ElectronApplication.Close, () => new TargetClosedError());
        const result = await waiter.waitForEvent(this, event, predicate);
        waiter.dispose();
        return result;
      });
    }
    async browserWindow(page) {
      const result = await this._channel.browserWindow({ page: page._channel });
      return JSHandle.from(result.handle);
    }
    async evaluate(pageFunction, arg) {
      const result = await this._channel.evaluateExpression({ expression: String(pageFunction), isFunction: typeof pageFunction === "function", arg: serializeArgument(arg) });
      return parseResult(result.value);
    }
    async evaluateHandle(pageFunction, arg) {
      const result = await this._channel.evaluateExpressionHandle({ expression: String(pageFunction), isFunction: typeof pageFunction === "function", arg: serializeArgument(arg) });
      return JSHandle.from(result.handle);
    }
  };

  // src/browser/run/playwright-client/vendor/client/jsonPipe.ts
  var JsonPipe = class extends ChannelOwner {
    static from(jsonPipe) {
      return jsonPipe._object;
    }
    constructor(parent, type, guid, initializer) {
      super(parent, type, guid, initializer);
    }
    channel() {
      return this._channel;
    }
  };

  // src/browser/run/playwright-client/vendor/client/localUtils.ts
  var LocalUtils = class extends ChannelOwner {
    devices;
    constructor(parent, type, guid, initializer) {
      super(parent, type, guid, initializer);
      this.devices = {};
      for (const { name, descriptor } of initializer.deviceDescriptors)
        this.devices[name] = descriptor;
    }
    async zip(params) {
      return await this._channel.zip(params);
    }
    async harOpen(params) {
      return await this._channel.harOpen(params);
    }
    async harLookup(params) {
      return await this._channel.harLookup(params);
    }
    async harClose(params) {
      return await this._channel.harClose(params);
    }
    async harUnzip(params) {
      return await this._channel.harUnzip(params);
    }
    async tracingStarted(params) {
      return await this._channel.tracingStarted(params);
    }
    async traceDiscarded(params) {
      return await this._channel.traceDiscarded(params);
    }
    async addStackToTracingNoReply(params) {
      return await this._channel.addStackToTracingNoReply(params);
    }
  };

  // src/browser/run/playwright-client/vendor/client/selectors.ts
  var Selectors = class {
    _platform;
    _selectorEngines = [];
    _testIdAttributeName;
    _contextsForSelectors = /* @__PURE__ */ new Set();
    constructor(platform) {
      this._platform = platform;
    }
    async register(name, script, options = {}) {
      if (this._selectorEngines.some((engine) => engine.name === name))
        throw new Error(`selectors.register: "${name}" selector engine has been already registered`);
      const source = await evaluationScript(this._platform, script, void 0, false);
      const selectorEngine = { ...options, name, source };
      for (const context of this._contextsForSelectors)
        await context._channel.registerSelectorEngine({ selectorEngine });
      this._selectorEngines.push(selectorEngine);
    }
    setTestIdAttribute(attributeName) {
      this._testIdAttributeName = attributeName;
      setTestIdAttribute(attributeName);
      for (const context of this._contextsForSelectors) {
        context._options.testIdAttributeName = attributeName;
        context._channel.setTestIdAttributeName({ testIdAttributeName: attributeName }).catch(() => {
        });
      }
    }
    _withSelectorOptions(options) {
      return { ...options, selectorEngines: this._selectorEngines, testIdAttributeName: this._testIdAttributeName };
    }
  };

  // src/browser/run/playwright-client/vendor/client/playwright.ts
  var Playwright = class extends ChannelOwner {
    _android;
    _electron;
    chromium;
    firefox;
    webkit;
    devices;
    selectors;
    request;
    errors;
    // Instrumentation.
    _defaultLaunchOptions;
    _defaultContextTimeout;
    _defaultContextNavigationTimeout;
    constructor(parent, type, guid, initializer) {
      super(parent, type, guid, initializer);
      this.request = new APIRequest(this);
      this.chromium = BrowserType.from(initializer.chromium);
      this.chromium._playwright = this;
      this.firefox = BrowserType.from(initializer.firefox);
      this.firefox._playwright = this;
      this.webkit = BrowserType.from(initializer.webkit);
      this.webkit._playwright = this;
      this._android = Android.from(initializer.android);
      this._android._playwright = this;
      this._electron = Electron.from(initializer.electron);
      this._electron._playwright = this;
      this.devices = this._connection.localUtils()?.devices ?? {};
      this.selectors = new Selectors(this._connection._platform);
      this.errors = { TimeoutError };
    }
    static from(channel) {
      return channel._object;
    }
    _browserTypes() {
      return [this.chromium, this.firefox, this.webkit];
    }
    _preLaunchedBrowser() {
      const browser = Browser.from(this._initializer.preLaunchedBrowser);
      browser._connectToBrowserType(this[browser._name], {}, void 0);
      return browser;
    }
    _allContexts() {
      return this._browserTypes().flatMap((type) => [...type._contexts]);
    }
    _allPages() {
      return this._allContexts().flatMap((context) => context.pages());
    }
  };

  // src/browser/run/playwright-client/vendor/client/writableStream.ts
  var WritableStream = class extends ChannelOwner {
    static from(Stream2) {
      return Stream2._object;
    }
    constructor(parent, type, guid, initializer) {
      super(parent, type, guid, initializer);
    }
    stream() {
      return this._platform.streamWritable(this._channel);
    }
  };

  // src/browser/run/playwright-client/vendor/client/connection.ts
  var Root = class extends ChannelOwner {
    constructor(connection) {
      super(connection, "Root", "", {});
    }
    async initialize() {
      return Playwright.from((await this._channel.initialize({
        sdkLanguage: "javascript"
      })).playwright);
    }
  };
  var DummyChannelOwner = class extends ChannelOwner {
  };
  var Connection = class extends EventEmitter {
    _objects = /* @__PURE__ */ new Map();
    onmessage = (message) => {
    };
    _lastId = 0;
    _callbacks = /* @__PURE__ */ new Map();
    _rootObject;
    _closedError;
    _isRemote = false;
    _localUtils;
    _rawBuffers = false;
    // Some connections allow resolving in-process dispatchers.
    toImpl;
    _tracingCount = 0;
    _instrumentation;
    // Used from @playwright/test fixtures -> TODO remove?
    headers;
    _objectFactories = /* @__PURE__ */ new Map();
    constructor(platform, localUtils, instrumentation, headers = []) {
      super(platform);
      this._instrumentation = instrumentation || createInstrumentation();
      this._localUtils = localUtils;
      this._rootObject = new Root(this);
      this.headers = headers;
      this.registerObjectFactories({
        Android: (parent, type, guid, init) => new Android(parent, type, guid, init),
        AndroidDevice: (parent, type, guid, init) => new AndroidDevice(parent, type, guid, init),
        AndroidSocket: (parent, type, guid, init) => new AndroidSocket(parent, type, guid, init),
        APIRequestContext: (parent, type, guid, init) => new APIRequestContext(parent, type, guid, init),
        Artifact: (parent, type, guid, init) => new Artifact(parent, type, guid, init),
        BindingCall: (parent, type, guid, init) => new BindingCall(parent, type, guid, init),
        Browser: (parent, type, guid, init) => new Browser(parent, type, guid, init),
        BrowserContext: (parent, type, guid, init) => new BrowserContext(parent, type, guid, init),
        BrowserType: (parent, type, guid, init) => new BrowserType(parent, type, guid, init),
        CDPSession: (parent, type, guid, init) => new CDPSession(parent, type, guid, init),
        Debugger: (parent, type, guid, init) => new Debugger(parent, type, guid, init),
        Dialog: (parent, type, guid, init) => new Dialog(parent, type, guid, init),
        Disposable: (parent, type, guid, init) => new DisposableObject(parent, type, guid, init),
        Electron: (parent, type, guid, init) => new Electron(parent, type, guid, init),
        ElectronApplication: (parent, type, guid, init) => new ElectronApplication(parent, type, guid, init),
        ElementHandle: (parent, type, guid, init) => new ElementHandle(parent, type, guid, init),
        Frame: (parent, type, guid, init) => new Frame(parent, type, guid, init),
        JSHandle: (parent, type, guid, init) => new JSHandle(parent, type, guid, init),
        JsonPipe: (parent, type, guid, init) => new JsonPipe(parent, type, guid, init),
        LocalUtils: (parent, type, guid, init) => {
          const result = new LocalUtils(parent, type, guid, init);
          if (!this._localUtils)
            this._localUtils = result;
          return result;
        },
        Page: (parent, type, guid, init) => new Page(parent, type, guid, init),
        Playwright: (parent, type, guid, init) => new Playwright(parent, type, guid, init),
        Request: (parent, type, guid, init) => new Request(parent, type, guid, init),
        Response: (parent, type, guid, init) => new Response(parent, type, guid, init),
        Route: (parent, type, guid, init) => new Route(parent, type, guid, init),
        Stream: (parent, type, guid, init) => new Stream(parent, type, guid, init),
        SocksSupport: (parent, type, guid, init) => new DummyChannelOwner(parent, type, guid, init),
        Tracing: (parent, type, guid, init) => new Tracing(parent, type, guid, init),
        WebSocket: (parent, type, guid, init) => new WebSocket(parent, type, guid, init),
        WebSocketRoute: (parent, type, guid, init) => new WebSocketRoute(parent, type, guid, init),
        Worker: (parent, type, guid, init) => new Worker(parent, type, guid, init),
        WritableStream: (parent, type, guid, init) => new WritableStream(parent, type, guid, init)
      });
    }
    registerObjectFactories(factories) {
      for (const [type, factory] of Object.entries(factories))
        this._objectFactories.set(type, factory);
    }
    markAsRemote() {
      this._isRemote = true;
    }
    isRemote() {
      return this._isRemote;
    }
    useRawBuffers() {
      this._rawBuffers = true;
    }
    rawBuffers() {
      return this._rawBuffers;
    }
    localUtils() {
      return this._localUtils;
    }
    async initializePlaywright() {
      return await this._rootObject.initialize();
    }
    getObjectWithKnownName(guid) {
      return this._objects.get(guid);
    }
    setIsTracing(isTracing) {
      if (isTracing)
        this._tracingCount++;
      else
        this._tracingCount--;
    }
    async sendMessageToServer(object, method, params, options) {
      if (method === "__waitInfo__" && (this._closedError || object._wasCollected))
        return;
      if (this._closedError)
        throw this._closedError;
      if (object._wasCollected)
        throw new Error("The object has been collected to prevent unbounded heap growth.");
      const guid = object._guid;
      const type = object._type;
      const id = ++this._lastId;
      const message = { id, guid, method, params };
      if (this._platform.isLogEnabled("channel")) {
        this._platform.log("channel", "SEND> " + JSON.stringify(message));
      }
      const location = options.frames?.[0] ? { file: options.frames[0].file, line: options.frames[0].line, column: options.frames[0].column } : void 0;
      const metadata = { title: options.title, location, internal: options.internal, stepId: options.stepId };
      if (this._tracingCount && options.frames && type !== "LocalUtils")
        this._localUtils?.addStackToTracingNoReply({ callData: { stack: options.frames ?? [], id } }).catch(() => {
        });
      this._platform.zones.empty.run(() => this.onmessage({ ...message, metadata }));
      if (method === "__waitInfo__")
        return;
      return await new Promise((resolve, reject) => this._callbacks.set(id, { resolve, reject, title: options.title, type, method }));
    }
    _validatorFromWireContext() {
      return {
        tChannelImpl: this._tChannelImplFromWire.bind(this),
        binary: this._rawBuffers ? "buffer" : "fromBase64",
        isUnderTest: () => this._platform.isUnderTest()
      };
    }
    dispatch(message) {
      if (this._closedError)
        return;
      const { id, guid, method, params, result, error, errorDetails, log } = message;
      if (id) {
        if (this._platform.isLogEnabled("channel"))
          this._platform.log("channel", "<RECV " + JSON.stringify(message));
        const callback = this._callbacks.get(id);
        if (!callback)
          throw new Error(`Cannot find command to respond: ${id}`);
        this._callbacks.delete(id);
        if (error && !result) {
          const parsedError = parseError(error);
          parsedError.log = log || [];
          rewriteErrorMessage(parsedError, parsedError.message + formatCallLog(this._platform, log));
          const detailsValidator = maybeFindValidator(callback.type, callback.method, "ErrorDetails");
          if (detailsValidator)
            parsedError.details = detailsValidator(errorDetails ?? {}, "", this._validatorFromWireContext());
          callback.reject(parsedError);
        } else {
          const validator2 = findValidator(callback.type, callback.method, "Result");
          callback.resolve(validator2(result, "", this._validatorFromWireContext()));
        }
        return;
      }
      if (this._platform.isLogEnabled("channel"))
        this._platform.log("channel", "<EVENT " + JSON.stringify(message));
      if (method === "__create__") {
        this._createRemoteObject(guid, params.type, params.guid, params.initializer);
        return;
      }
      const object = this._objects.get(guid);
      if (!object)
        throw new Error(`Cannot find object to "${method}": ${guid}`);
      if (method === "__adopt__") {
        const child = this._objects.get(params.guid);
        if (!child)
          throw new Error(`Unknown new child: ${params.guid}`);
        object._adopt(child);
        return;
      }
      if (method === "__dispose__") {
        object._dispose(params.reason);
        return;
      }
      const validator = findValidator(object._type, method, "Event");
      object._channel.emit(method, validator(params, "", this._validatorFromWireContext()));
    }
    close(cause) {
      if (this._closedError)
        return;
      this._closedError = new TargetClosedError(cause);
      for (const callback of this._callbacks.values())
        callback.reject(this._closedError);
      this._callbacks.clear();
      this.emit("close");
    }
    _tChannelImplFromWire(names, arg, path, context) {
      if (arg && typeof arg === "object" && typeof arg.guid === "string") {
        const object = this._objects.get(arg.guid);
        if (!object)
          throw new Error(`Object with guid ${arg.guid} was not bound in the connection`);
        if (names !== "*" && !names.includes(object._type))
          throw new ValidationError(`${path}: expected channel ${names.toString()}`);
        return object._channel;
      }
      throw new ValidationError(`${path}: expected channel ${names.toString()}`);
    }
    _createRemoteObject(parentGuid, type, guid, initializer) {
      const parent = this._objects.get(parentGuid);
      if (!parent)
        throw new Error(`Cannot find parent object ${parentGuid} to create ${guid}`);
      const validator = findValidator(type, "", "Initializer");
      initializer = validator(initializer, "", this._validatorFromWireContext());
      const factory = this._objectFactories.get(type);
      if (!factory)
        throw new Error("Missing type " + type);
      return factory(parent, type, guid, initializer);
    }
  };
  function formatCallLog(platform, log) {
    if (!log || !log.some((l) => !!l))
      return "";
    return `
Call log:
${platform.colors.dim(log.join("\n"))}
`;
  }

  // src/browser/run/playwright-client/bundle-entry.ts
  function createConnection() {
    const connection = new Connection(quickjsPlatform);
    connection.markAsRemote();
    connection.onmessage = (message) => sendTransport(JSON.stringify(message));
    return connection;
  }
  return __toCommonJS(bundle_entry_exports);
})();
