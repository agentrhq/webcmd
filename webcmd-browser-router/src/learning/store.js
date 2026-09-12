/**
 * Webcmd Self-Learning Workflow Store
 * Persists learned workflows, element fingerprints, verification rules, and recovery history.
 * Stored in human-inspectable JSON under .webcmd/workflows/
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_STORE_DIR = path.resolve(process.cwd(), '.webcmd', 'workflows');

class WorkflowStore {
  constructor(storeDir = DEFAULT_STORE_DIR) {
    this.storeDir = storeDir;
    this._ensureDir();
  }

  _ensureDir() {
    if (!fs.existsSync(this.storeDir)) {
      fs.mkdirSync(this.storeDir, { recursive: true });
    }
  }

  _getFilePath(id) {
    const cleanId = String(id).replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
    return path.join(this.storeDir, `${cleanId}.json`);
  }

  save(workflow) {
    this._ensureDir();
    const id = workflow.id || `wf-${Date.now()}`;
    const data = {
      id,
      name: workflow.name || id,
      domain: workflow.domain || 'localhost',
      intent: workflow.intent || 'Automated task',
      steps: workflow.steps || [],
      success_count: workflow.success_count || 0,
      failure_count: workflow.failure_count || 0,
      recovery_count: workflow.recovery_count || 0,
      created_at: workflow.created_at || new Date().toISOString(),
      last_executed: new Date().toISOString()
    };

    const filePath = this._getFilePath(id);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return data;
  }

  get(id) {
    const filePath = this._getFilePath(id);
    if (!fs.existsSync(filePath)) return null;
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(content);
    } catch (err) {
      console.error(`Error reading workflow ${id}:`, err);
      return null;
    }
  }

  list() {
    this._ensureDir();
    const files = fs.readdirSync(this.storeDir).filter(f => f.endsWith('.json'));
    const workflows = [];
    for (const f of files) {
      try {
        const content = fs.readFileSync(path.join(this.storeDir, f), 'utf8');
        workflows.push(JSON.parse(content));
      } catch (_) {}
    }
    return workflows;
  }

  updateRecovery(id, stepIndex, newSelector, newFingerprint) {
    const wf = this.get(id);
    if (!wf) throw new Error(`Workflow ${id} not found`);

    if (wf.steps && wf.steps[stepIndex]) {
      const step = wf.steps[stepIndex];
      step.selector_history = step.selector_history || [];
      if (step.target) {
        step.selector_history.push(step.target);
      }
      step.target = newSelector;
      if (newFingerprint) {
        step.fingerprint = newFingerprint;
      }
      step.last_recovered = new Date().toISOString();
    }

    wf.recovery_count = (wf.recovery_count || 0) + 1;
    wf.last_executed = new Date().toISOString();

    return this.save(wf);
  }

  recordExecution(id, { success = true, recovered = false } = {}) {
    const wf = this.get(id);
    if (!wf) return null;

    if (success) {
      wf.success_count = (wf.success_count || 0) + 1;
    } else {
      wf.failure_count = (wf.failure_count || 0) + 1;
    }
    if (recovered) {
      wf.recovery_count = (wf.recovery_count || 0) + 1;
    }
    wf.last_executed = new Date().toISOString();

    return this.save(wf);
  }
}

module.exports = { WorkflowStore, DEFAULT_STORE_DIR };
