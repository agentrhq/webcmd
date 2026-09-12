/**
 * Webcmd Stealth & Anti-Bot Evasion Subsystem
 * Patches browser globals to hide automation fingerprints:
 * - navigator.webdriver -> false
 * - window.chrome stub with runtime, loadTimes, csi
 * - navigator.plugins & navigator.languages spoofing
 * - WebGL vendor/renderer masking
 * - Stack trace cleanup for CDP / Puppeteer artifacts
 * - Function.prototype.toString WeakMap disguise
 * 
 * Injected on every new document via CDP Page.addScriptToEvaluateOnNewDocument.
 */

const STEALTH_INJECTION = `(() => {
  // Prevent double injection
  const _gProto = EventTarget.prototype;
  const _gKey = '__wc_stealth';
  if (_gProto[_gKey]) return;
  try {
    Object.defineProperty(_gProto, _gKey, { value: true, enumerable: false, configurable: true });
  } catch {}

  // 1. navigator.webdriver -> false (Real Chrome returns false, not undefined)
  try {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => false,
      configurable: true
    });
  } catch {}

  // 2. window.chrome stub
  try {
    if (!window.chrome) {
      window.chrome = {
        runtime: {
          onConnect: { addListener: () => {}, removeListener: () => {} },
          onMessage: { addListener: () => {}, removeListener: () => {} },
          PlatformOs: { MAC: 'mac', WIN: 'win', ANDROID: 'android', CROS: 'cros', LINUX: 'linux', OPENBSD: 'openbsd' },
          PlatformArch: { ARM: 'arm', X86_32: 'x86-32', X86_64: 'x86-64' }
        },
        loadTimes: () => ({
          requestTime: Date.now() / 1000 - 0.2,
          startLoadTime: Date.now() / 1000 - 0.15,
          commitLoadTime: Date.now() / 1000 - 0.1,
          finishDocumentLoadTime: Date.now() / 1000 - 0.05,
          firstPaintTime: Date.now() / 1000 - 0.04,
          finishLoadTime: Date.now() / 1000 - 0.01,
          wasFetchedViaSpdy: true,
          wasNpnNegotiated: true,
          npnNegotiatedProtocol: 'h2',
          connectionInfo: 'h2'
        }),
        csi: () => ({
          startE: Date.now() - 200,
          onloadT: Date.now() - 50,
          pageT: 150,
          tran: 15
        })
      };
    }
  } catch {}

  // 3. navigator.plugins spoofing
  try {
    if (!navigator.plugins || navigator.plugins.length === 0) {
      const fakePlugins = [
        { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'Microsoft Edge PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        { name: 'WebKit built-in PDF', filename: 'internal-pdf-viewer', description: 'Portable Document Format' }
      ];
      fakePlugins.item = (i) => fakePlugins[i] || null;
      fakePlugins.namedItem = (n) => fakePlugins.find(p => p.name === n) || null;
      fakePlugins.refresh = () => {};
      Object.defineProperty(navigator, 'plugins', {
        get: () => fakePlugins,
        configurable: true
      });
    }
  } catch {}

  // 4. navigator.languages
  try {
    if (!navigator.languages || navigator.languages.length === 0) {
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
        configurable: true
      });
    }
  } catch {}

  // 5. Clean automation artifacts (cdc_, __playwright, __puppeteer)
  try {
    delete window.__playwright;
    delete window.__puppeteer;
    for (const prop of Object.getOwnPropertyNames(window)) {
      if (prop.startsWith('cdc_') || prop.startsWith('__cdc_')) {
        try { delete window[prop]; } catch {}
      }
    }
  } catch {}

  // 6. CDP stack trace cleanup (scrub CDP evaluation traces from Error.stack)
  try {
    const _origDescriptor = Object.getOwnPropertyDescriptor(Error.prototype, 'stack');
    const _cdpPatterns = ['puppeteer_evaluation_script', 'pptr:', 'debugger://', '__playwright', '__puppeteer'];
    if (_origDescriptor && _origDescriptor.get) {
      Object.defineProperty(Error.prototype, 'stack', {
        get: function () {
          const raw = _origDescriptor.get.call(this);
          if (typeof raw !== 'string') return raw;
          return raw.split('\\n').filter(line => !_cdpPatterns.some(p => line.includes(p))).join('\\n');
        },
        configurable: true
      });
    }
  } catch {}

  // 7. WebGL Vendor / Renderer Masking
  try {
    const origGetParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (param) {
      if (param === 37445) return 'Google Inc. (NVIDIA)';
      if (param === 37446) return 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)';
      return origGetParameter.call(this, param);
    };
  } catch {}

  // 8. Shared toString disguise
  const _origToString = Function.prototype.toString;
  const _disguised = new WeakMap();
  try {
    Object.defineProperty(Function.prototype, 'toString', {
      value: function () {
        const override = _disguised.get(this);
        return override !== undefined ? override : _origToString.call(this);
      },
      writable: true,
      configurable: true
    });
  } catch {}
})();`;

module.exports = { STEALTH_INJECTION };
