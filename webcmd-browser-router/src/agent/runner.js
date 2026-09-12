/**
 * Webcmd Workflow Replay & Self-Recovery Runner
 * Replays learned workflows with deterministic verification and automatic Scrapling adaptive recovery.
 */

const { CDPClient } = require('../browser/cdp');
const { SnapshotEngine } = require('../browser/snapshot');
const { ActionExecutor } = require('../browser/actions');
const { ActionVerifier } = require('../verifier/verifier');
const { AdaptiveRecoveryEngine } = require('../adaptive/recovery');
const { WorkflowStore } = require('../learning/store');

class WorkflowRunner {
  constructor(options = {}) {
    this.options = {
      headed: options.headed || false,
      port: options.port || 0,
      recoveryThreshold: options.recoveryThreshold || 0.40,
      storeDir: options.storeDir,
      onLog: options.onLog || (() => {}),
      onRecovery: options.onRecovery || (() => {}),
      ...options
    };
    this.store = new WorkflowStore(this.options.storeDir);
    this.recoveryEngine = new AdaptiveRecoveryEngine({ threshold: this.options.recoveryThreshold });
    this.cdp = null;
    this.snapshot = null;
    this.actions = null;
    this.verifier = null;
  }

  log(msg, data) {
    this.options.onLog(msg, data);
  }

  async init() {
    this.cdp = new CDPClient({ headed: this.options.headed, port: this.options.port, profile: this.options.profile });
    await this.cdp.launch();
    this.snapshot = new SnapshotEngine(this.cdp);
    this.actions = new ActionExecutor(this.cdp, this.snapshot);
    this.verifier = new ActionVerifier(this.cdp, this.actions);
  }

  async close() {
    if (this.cdp) {
      await this.cdp.close();
      this.cdp = null;
    }
  }

  async runWorkflow(workflowOrId) {
    const startTime = Date.now();
    let workflow = typeof workflowOrId === 'string' ? this.store.get(workflowOrId) : workflowOrId;
    if (!workflow) throw new Error(`Workflow not found: ${workflowOrId}`);

    if (!this.cdp) {
      await this.init();
    }

    this.log(`Loaded workflow "${workflow.name || workflow.id}" (${workflow.steps.length} steps)`);
    let recoveredSteps = 0;

    for (let i = 0; i < workflow.steps.length; i++) {
      const step = workflow.steps[i];
      const stepNum = i + 1;
      this.log(`[Step ${stepNum}/${workflow.steps.length}] Action: ${step.action} ${step.target || step.url || ''}`);

      let actionSuccess = false;
      let targetToUse = step.target;

      // 1. Try normal action execution
      try {
        await this._executeAction(step.action, targetToUse, step);
        const verResult = await this.verifier.verify(step.verify, { target: targetToUse });
        if (verResult.verified) {
          actionSuccess = true;
          this.log(`  ✓ Verified step ${stepNum}`);
        } else {
          this.log(`  ⚠ Step ${stepNum} verification failed: ${verResult.error}`);
        }
      } catch (err) {
        this.log(`  ⚠ Step ${stepNum} execution failed: ${err.message}`);
      }

      // 2. If failed and we have a fingerprint, trigger ADAPTIVE RECOVERY
      if (!actionSuccess && step.fingerprint) {
        this.log(`  🔍 Triggering Scrapling Adaptive Relocation for step ${stepNum}...`);
        
        // Capture live page state
        const snap = await this.snapshot.capture();
        const liveElements = snap.data.elements;

        const recovery = this.recoveryEngine.relocate(step.fingerprint, liveElements);

        if (recovery.success) {
          this.options.onRecovery({
            stepIndex: i,
            originalTarget: step.target,
            bestCandidate: recovery.bestCandidate,
            candidates: recovery.candidates,
            confidence: recovery.confidence
          });

          this.log(`  🧠 Adaptive Recovery Found Match: "${recovery.recoveredSelector}" (Confidence: ${recovery.confidence})`);

          // Attempt action with recovered candidate
          try {
            await this._executeAction(step.action, recovery.recoveredSelector, step);
            const verResult = await this.verifier.verify(step.verify, { target: recovery.recoveredSelector });

            if (verResult.verified) {
              this.log(`  ✓ Recovered action verified successfully!`);
              actionSuccess = true;
              recoveredSteps++;

              // Update learned workflow store
              this.store.updateRecovery(workflow.id, i, recovery.recoveredSelector, recovery.newFingerprint);
              this.log(`  💾 Updated workflow memory with new selector "${recovery.recoveredSelector}"`);
            } else {
              this.log(`  ❌ Recovered candidate failed verification: ${verResult.error}`);
            }
          } catch (recErr) {
            this.log(`  ❌ Error executing recovered action: ${recErr.message}`);
          }
        } else {
          this.log(`  ❌ Adaptive recovery could not find matching candidate above threshold: ${recovery.reason}`);
        }
      }

      if (!actionSuccess) {
        this.store.recordExecution(workflow.id, { success: false });
        throw new Error(`Workflow stopped at step ${stepNum} (${step.action})`);
      }
    }

    const durationMs = Date.now() - startTime;
    this.store.recordExecution(workflow.id, { success: true, recovered: recoveredSteps > 0 });
    this.log(`✓ Workflow "${workflow.id}" completed in ${durationMs}ms (Recoveries: ${recoveredSteps})`);

    return {
      success: true,
      workflowId: workflow.id,
      stepsCount: workflow.steps.length,
      recoveredSteps,
      durationMs
    };
  }

  async _executeAction(action, target, stepData) {
    switch (action) {
      case 'navigate':
        return await this.actions.navigate(stepData.url || target);
      case 'click':
        return await this.actions.click(target);
      case 'fill':
        return await this.actions.fill(target, stepData.value);
      case 'press':
        return await this.actions.press(stepData.key || 'Enter');
      case 'select':
        return await this.actions.select(target, stepData.value);
      case 'scroll':
        return await this.actions.scroll(stepData.direction, stepData.amount);
      case 'wait':
        return await this.actions.wait(stepData.condition || 1000);
      default:
        throw new Error(`Unknown action "${action}"`);
    }
  }
}

module.exports = { WorkflowRunner };
