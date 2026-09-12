/**
 * Webcmd Browser Control Subsystem
 * Direct Chrome DevTools Protocol (CDP) WebSocket client & process controller.
 * Zero external dependencies - uses Node 24 native WebSocket and HTTP fetch.
 */

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');

const CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  process.env.CHROME_PATH || '',
  process.env.EDGE_PATH || ''
].filter(Boolean);

function findBrowserPath() {
  for (const p of CHROME_PATHS) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('No supported Chromium browser found (Chrome or Edge). Please install Chrome or Edge.');
}

function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

const { STEALTH_INJECTION } = require('./stealth');

class CDPClient {
  constructor(options = {}) {
    this.options = {
      port: options.port || 0, // 0 = dynamic free port
      headed: options.headed || false,
      viewport: options.viewport || { width: 1280, height: 800 },
      userDataDir: options.userDataDir || null,
      profile: options.profile || null,
      stealth: options.stealth !== false,
      ...options
    };
    this.port = this.options.port;
    this.process = null;
    this.ws = null;
    this.msgId = 1;
    this.callbacks = new Map();
    this.eventHandlers = new Map();
    this.targetId = null;
    this.sessionId = null;
    this.tempUserDataDir = null;
  }

  async launch() {
    const browserPath = findBrowserPath();

    if (!this.port || this.port === 0) {
      this.port = await getAvailablePort();
    }

    if (this.options.profile) {
      const profileDir = path.resolve(process.cwd(), '.webcmd', 'profiles', this.options.profile);
      fs.mkdirSync(profileDir, { recursive: true });
      this.options.userDataDir = profileDir;
    } else if (!this.options.userDataDir) {
      this.tempUserDataDir = path.join(os.tmpdir(), `webcmd-p-${this.port}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      fs.mkdirSync(this.tempUserDataDir, { recursive: true });
    }

    const userDataPath = this.options.userDataDir || this.tempUserDataDir;

    const args = [
      `--remote-debugging-port=${this.port}`,
      `--user-data-dir=${userDataPath}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-client-side-phishing-detection',
      '--disable-default-apps',
      '--disable-hang-monitor',
      '--disable-popup-blocking',
      '--disable-prompt-on-repost',
      '--disable-sync',
      '--disable-translate',
      '--metrics-recording-only',
      '--safebrowsing-disable-auto-update',
      `--window-size=${this.options.viewport.width},${this.options.viewport.height}`
    ];

    if (!this.options.headed) {
      args.push('--headless=new');
    }

    this.process = spawn(browserPath, args, { stdio: 'ignore' });
    this.process.on('exit', () => {
      this.ws = null;
    });

    // Wait for CDP port to be ready
    await this._waitForPort(50, 150);
    await this._connectWebSocket();
    await this._initPage();
  }

  async _waitForPort(maxAttempts = 50, interval = 150) {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${this.port}/json/version`);
        if (res.ok) return;
      } catch (_) {
        // Wait and retry
      }
      await new Promise(r => setTimeout(r, interval));
    }
    throw new Error(`Failed to connect to browser on port ${this.port}`);
  }

  async _connectWebSocket() {
    const listRes = await fetch(`http://127.0.0.1:${this.port}/json/list`);
    const pages = await listRes.json();
    let targetPage = pages.find(p => p.type === 'page');

    if (!targetPage) {
      const newRes = await fetch(`http://127.0.0.1:${this.port}/json/new`);
      targetPage = await newRes.json();
    }

    const wsUrl = targetPage.webSocketDebuggerUrl;
    if (!wsUrl) throw new Error('No WebSocket debugger URL found from browser target');

    this.ws = new WebSocket(wsUrl);

    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.id && this.callbacks.has(data.id)) {
          const { resolve, reject } = this.callbacks.get(data.id);
          this.callbacks.delete(data.id);
          if (data.error) {
            reject(new Error(data.error.message || JSON.stringify(data.error)));
          } else {
            resolve(data.result);
          }
        } else if (data.method) {
          const handlers = this.eventHandlers.get(data.method) || [];
          for (const handler of handlers) {
            handler(data.params);
          }
        }
      } catch (err) {
        console.error('Error handling CDP message:', err);
      }
    };
  }

  async _initPage() {
    await this.send('Page.enable');
    await this.send('DOM.enable');
    await this.send('Runtime.enable');
    await this.send('Accessibility.enable').catch(() => {});
    await this.send('Emulation.setDeviceMetricsOverride', {
      width: this.options.viewport.width,
      height: this.options.viewport.height,
      deviceScaleFactor: 1,
      mobile: false
    });

    if (this.options.stealth) {
      await this.send('Page.addScriptToEvaluateOnNewDocument', {
        source: STEALTH_INJECTION
      }).catch((err) => {
        // Soft fail if browser is older
      });
    }
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return reject(new Error('WebSocket connection is not open'));
      }
      const id = this.msgId++;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(event, handler) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event).push(handler);
  }

  async navigate(url, timeoutMs = 15000) {
    const navPromise = new Promise((resolve) => {
      const handler = (params) => {
        resolve();
      };
      this.on('Page.loadEventFired', handler);
      setTimeout(resolve, timeoutMs);
    });

    await this.send('Page.navigate', { url });
    await navPromise;
    // Allow DOM to settle
    await new Promise(r => setTimeout(r, 200));
  }

  async evaluate(expression, returnByValue = true) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue,
      awaitPromise: true
    });
    if (result.exceptionDetails) {
      const desc = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
      throw new Error(`Evaluation failed: ${desc}`);
    }
    return result.result ? result.result.value : undefined;
  }

  async close() {
    if (this.ws) {
      try {
        this.ws.close();
      } catch (_) {}
      this.ws = null;
    }
    if (this.process && this.process.pid) {
      const pid = this.process.pid;
      try {
        if (process.platform === 'win32') {
          execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' });
        } else {
          this.process.kill('SIGKILL');
        }
      } catch (_) {}
      this.process = null;
    }
    if (this.tempUserDataDir) {
      try {
        fs.rmSync(this.tempUserDataDir, { recursive: true, force: true });
      } catch (_) {}
      this.tempUserDataDir = null;
    }
    await new Promise(r => setTimeout(r, 150));
  }
}

module.exports = { CDPClient, findBrowserPath, getAvailablePort };
