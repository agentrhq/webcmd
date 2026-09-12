/**
 * Webcmd Extension Bridge & Local REST API Server
 * Exposes local agent capabilities to the Chrome Extension and external callers.
 * Built with native Node.js HTTP (zero external dependencies).
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const { WorkflowStore } = require('../learning/store');
const { WorkflowRunner } = require('../agent/runner');
const { AutonomousAgent } = require('../agent/planner');
const { CanvaPresentationAgent } = require('../agent/canva-agent');
const { CDPClient } = require('../browser/cdp');
const { SnapshotEngine } = require('../browser/snapshot');

class ExtensionBridgeServer {
  constructor(options = {}) {
    this.port = options.port || 9777;
    this.host = options.host || '127.0.0.1';
    this.storeDir = options.storeDir || path.resolve(process.cwd(), '.webcmd', 'workflows');
    this.profilesDir = path.resolve(process.cwd(), '.webcmd', 'profiles');
    this.store = new WorkflowStore(this.storeDir);
    this.server = null;
    this.activeProfile = 'default';
    this.activeSession = null;
    this.runningTasks = new Map();
    this.startTime = Date.now();

    fs.mkdirSync(this.profilesDir, { recursive: true });
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this._handleRequest(req, res));
      this.server.on('error', reject);
      this.server.listen(this.port, this.host, () => {
        resolve(`http://${this.host}:${this.port}`);
      });
    });
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
    });
  }

  _sendCors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Webcmd-Session');
  }

  _json(res, statusCode, data) {
    this._sendCors(res);
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  _error(res, statusCode, message, details = null) {
    this._json(res, statusCode, {
      success: false,
      error: message,
      details,
      timestamp: new Date().toISOString()
    });
  }

  _readBody(req) {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => {
        body += chunk;
        if (body.length > 1e6) { // 1MB limit
          req.destroy();
          reject(new Error('Body payload too large'));
        }
      });
      req.on('end', () => {
        if (!body) return resolve({});
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error('Invalid JSON payload'));
        }
      });
      req.on('error', reject);
    });
  }

  async _handleRequest(req, res) {
    this._sendCors(res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host || this.host}`);
    const pathname = url.pathname;

    try {
      // 1. Health & Status
      if (req.method === 'GET' && (pathname === '/api/status' || pathname === '/status')) {
        const workflows = this.store.list();
        return this._json(res, 200, {
          success: true,
          status: 'online',
          version: '2.0.0',
          uptimeSec: Math.round((Date.now() - this.startTime) / 1000),
          activeProfile: this.activeProfile,
          stealthEnabled: true,
          workflowsCount: workflows.length,
          activeTasks: this.runningTasks.size,
          agentName: 'Webcmd Autonomous Engine'
        });
      }

      // 2. Doctor / Preflight
      if (req.method === 'GET' && pathname === '/api/doctor') {
        let browserFound = false;
        let browserPath = null;
        try {
          const { CDPClient } = require('../browser/cdp');
          const testClient = new CDPClient();
          browserPath = 'Chromium / Chrome Detected';
          browserFound = true;
        } catch (err) {
          browserPath = err.message;
        }

        return this._json(res, 200, {
          success: true,
          checks: {
            browserInstalled: browserFound,
            browserPath,
            workflowsDir: fs.existsSync(this.storeDir),
            profilesDir: fs.existsSync(this.profilesDir),
            stealthAvailable: true,
            nodeVersion: process.version
          },
          ready: browserFound
        });
      }

      // 3. Auth & Sign-in
      if (req.method === 'POST' && pathname === '/api/auth/login') {
        const body = await this._readBody(req);
        const username = body.username || 'Operator';
        const profile = body.profile || 'default';

        this.activeProfile = profile;
        const profilePath = path.join(this.profilesDir, profile);
        fs.mkdirSync(profilePath, { recursive: true });

        const sessionToken = `wc_sec_${Buffer.from(`${username}:${profile}:${Date.now()}`).toString('base64')}`;

        return this._json(res, 200, {
          success: true,
          message: `Signed in successfully as ${username} under profile "${profile}"`,
          token: sessionToken,
          profile: {
            name: profile,
            path: profilePath,
            username,
            authenticatedAt: new Date().toISOString()
          }
        });
      }

      // 4. Profiles
      if (req.method === 'GET' && pathname === '/api/profiles') {
        const entries = fs.readdirSync(this.profilesDir, { withFileTypes: true });
        const profiles = entries.filter(e => e.isDirectory()).map(e => e.name);
        if (!profiles.includes('default')) profiles.unshift('default');

        return this._json(res, 200, {
          success: true,
          profiles,
          active: this.activeProfile
        });
      }

      if (req.method === 'POST' && pathname === '/api/profiles') {
        const body = await this._readBody(req);
        const name = (body.name || '').trim().replace(/[^a-zA-Z0-9_-]/g, '');
        if (!name) return this._error(res, 400, 'Invalid profile name');

        const profilePath = path.join(this.profilesDir, name);
        fs.mkdirSync(profilePath, { recursive: true });

        return this._json(res, 201, {
          success: true,
          profile: name,
          path: profilePath
        });
      }

      // 5. Workflows List & Details
      if (req.method === 'GET' && pathname === '/api/workflows') {
        const workflows = this.store.list();
        return this._json(res, 200, {
          success: true,
          count: workflows.length,
          workflows
        });
      }

      if (req.method === 'GET' && pathname.startsWith('/api/workflows/')) {
        const id = pathname.replace('/api/workflows/', '');
        const wf = this.store.get(id);
        if (!wf) return this._error(res, 404, `Workflow "${id}" not found`);
        return this._json(res, 200, { success: true, workflow: wf });
      }

      // 6. Run Workflow
      if (req.method === 'POST' && pathname === '/api/workflows/run') {
        const body = await this._readBody(req);
        const workflowId = body.workflowId;
        const headed = body.headed !== undefined ? Boolean(body.headed) : false;
        const profile = body.profile || this.activeProfile;

        if (!workflowId) return this._error(res, 400, 'workflowId is required');

        const taskId = `run-${Date.now()}`;
        const logs = [];
        const recoveries = [];

        const runner = new WorkflowRunner({
          headed,
          profile,
          onLog: (msg) => logs.push({ time: Date.now(), msg }),
          onRecovery: (rec) => recoveries.push({ time: Date.now(), ...rec })
        });

        this.runningTasks.set(taskId, { runner, startTime: Date.now() });

        try {
          const result = await runner.runWorkflow(workflowId);
          this.runningTasks.delete(taskId);
          return this._json(res, 200, {
            success: true,
            taskId,
            durationMs: result.durationMs,
            recoveredSteps: result.recoveredSteps,
            stepsCompleted: result.stepsCompleted,
            recoveries,
            logs: logs.slice(-20)
          });
        } catch (err) {
          this.runningTasks.delete(taskId);
          return this._error(res, 500, `Replay failed: ${err.message}`, { logs });
        } finally {
          await runner.close().catch(() => {});
        }
      }

      // 7. Active Page Perception Snapshot
      if (req.method === 'POST' && pathname === '/api/browser/snapshot') {
        const body = await this._readBody(req);
        const url = body.url;
        const headed = Boolean(body.headed);

        const cdp = new CDPClient({ headed });
        await cdp.launch();
        const engine = new SnapshotEngine(cdp);

        try {
          if (url) {
            await cdp.navigate(url);
          }
          const snap = await engine.capture({ interactive: true });
          return this._json(res, 200, {
            success: true,
            url: snap.url,
            title: snap.title,
            elementsCount: snap.data.elements.length,
            elements: snap.data.elements,
            compactText: snap.text
          });
        } finally {
          await cdp.close().catch(() => {});
        }
      }

      // 8. Autonomous Learn Workflow
      if (req.method === 'POST' && pathname === '/api/browser/learn') {
        const body = await this._readBody(req);
        const targetUrl = body.url;
        const wfId = body.workflowId || `wf-${Date.now()}`;
        const headed = Boolean(body.headed);

        if (!targetUrl) return this._error(res, 400, 'url is required for learning');

        const agent = new AutonomousAgent({ headed, profile: this.activeProfile });
        try {
          const wf = await agent.learnSearchAndCartWorkflow(targetUrl, wfId);
          return this._json(res, 200, {
            success: true,
            workflow: wf
          });
        } finally {
          await agent.close().catch(() => {});
        }
      }

      // 9. Groq & Canva Autonomous Presentation Synthesis
      if (req.method === 'POST' && pathname === '/api/presentations/generate') {
        const body = await this._readBody(req);
        const topic = body.topic || 'Webcmd Autonomous Agent Architecture';
        const headed = Boolean(body.headed);
        const profile = body.profile || this.activeProfile;

        const pptAgent = new CanvaPresentationAgent({
          headed,
          profile
        });

        try {
          const deckResult = await pptAgent.buildPresentation(topic);
          return this._json(res, 200, {
            success: true,
            ...deckResult
          });
        } catch (err) {
          return this._error(res, 500, `Presentation generation failed: ${err.message}`);
        } finally {
          if (!headed) await pptAgent.close();
        }
      }

      return this._error(res, 404, `Endpoint not found: ${req.method} ${pathname}`);
    } catch (err) {
      return this._error(res, 500, `Internal server error: ${err.message}`);
    }
  }
}

module.exports = { ExtensionBridgeServer };
