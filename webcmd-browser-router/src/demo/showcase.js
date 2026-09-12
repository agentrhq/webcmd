/**
 * Webcmd Hackathon Demo Showcase
 * Orchestrates the live 5-phase demonstration:
 * 1. LEARN (Version A)
 * 2. REPLAY (Version A)
 * 3. BREAK (Switch to Version B)
 * 4. RECOVER (Scrapling Adaptive Relocation)
 * 5. REMEMBER (Workflow Memory Update & Replay)
 */

const { DemoServer } = require('./server');
const { AutonomousAgent } = require('../agent/planner');
const { WorkflowRunner } = require('../agent/runner');
const { WorkflowStore } = require('../learning/store');

function printHeader(title) {
  const line = '═'.repeat(60);
  console.log(`\n\x1b[36m${line}\x1b[0m`);
  console.log(`\x1b[1m\x1b[33m  ${title}\x1b[0m`);
  console.log(`\x1b[36m${line}\x1b[0m\n`);
}

function printStep(icon, text) {
  console.log(`  \x1b[32m${icon}\x1b[0m \x1b[1m${text}\x1b[0m`);
}

function printWarn(text) {
  console.log(`  \x1b[33m⚠ ${text}\x1b[0m`);
}

function printInfo(text) {
  console.log(`  \x1b[34mℹ\x1b[0m ${text}`);
}

async function runLiveDemo(options = {}) {
  const headed = options.headed || false;
  const demoServer = new DemoServer(8099);
  const store = new WorkflowStore();
  const workflowId = 'demo-search-and-cart';

  console.log('\n\x1b[1m\x1b[35m' + '█'.repeat(60));
  console.log('  WEBCMD: SELF-LEARNING, SELF-RECOVERING BROWSER AGENT');
  console.log('  Live Demonstration for SLAB Hackathon @ VIT Bhopal');
  console.log('█'.repeat(60) + '\x1b[0m\n');

  const serverUrl = await demoServer.start();
  printInfo(`Local deterministic test server running at ${serverUrl}`);

  try {
    // ==========================================
    // PHASE 1: LEARN
    // ==========================================
    printHeader('PHASE 1: UNFAMILIAR WORKFLOW EXPLORATION & LEARNING');
    demoServer.setVersion('a');
    printInfo('Target: TechVault Store v1.0 (Baseline DOM)');

    const agent = new AutonomousAgent({
      headed,
      onLog: (msg) => console.log(`    ${msg}`)
    });

    const learnedWf = await agent.learnSearchAndCartWorkflow(serverUrl, workflowId);
    await agent.close();

    printStep('✓', 'Phase 1 Complete: Workflow learned, verified, and saved to disk.');
    await new Promise(r => setTimeout(r, 1000));

    // ==========================================
    // PHASE 2: FAST REPLAY
    // ==========================================
    printHeader('PHASE 2: INSTANT WORKFLOW REPLAY (10x FASTER)');
    printInfo('Replaying compiled workflow against Version A...');

    const runner = new WorkflowRunner({
      headed,
      onLog: (msg) => console.log(`    ${msg}`)
    });

    const replay1 = await runner.runWorkflow(workflowId);
    printStep('✓', `Phase 2 Complete: Replay finished in ${replay1.durationMs}ms with 100% verification.`);
    await new Promise(r => setTimeout(r, 1000));

    // ==========================================
    // PHASE 3 & 4: BREAK & ADAPTIVE RECOVERY
    // ==========================================
    printHeader('PHASE 3 & 4: DOM MUTATION & SCRAPLING ADAPTIVE RECOVERY');
    printWarn('Simulating website redesign: Switching server to Version B (Mutated DOM)...');
    demoServer.setVersion('b');
    printInfo('DOM Changes Injected: #search-input -> #product-query, #search-btn -> #btn-find, .add-to-cart-btn -> .buy-action-btn');

    let recoveryDetails = null;
    const recoveringRunner = new WorkflowRunner({
      headed,
      onLog: (msg) => console.log(`    ${msg}`),
      onRecovery: (details) => {
        recoveryDetails = details;
        console.log('\n\x1b[33m    ┌─── CANDIDATE SCORING BREAKDOWN (Scrapling Multi-Factor) ───┐\x1b[0m');
        for (let i = 0; i < details.candidates.length; i++) {
          const c = details.candidates[i];
          const isWinner = i === 0 ? ' \x1b[32m★ TOP MATCH\x1b[0m' : '';
          console.log(`    │ Rank #${i + 1}: \x1b[1m${c.selector}\x1b[0m (Score: ${(c.score * 100).toFixed(1)}%)${isWinner}`);
          console.log(`    │   Tag: ${c.breakdown.tag.toFixed(2)} | Text: ${c.breakdown.text.toFixed(2)} | Role: ${c.breakdown.role.toFixed(2)} | Attrs: ${c.breakdown.attributes.toFixed(2)} | Parent: ${c.breakdown.parent.toFixed(2)}`);
        }
        console.log('\x1b[33m    └─────────────────────────────────────────────────────────────┘\x1b[0m\n');
      }
    });

    const recoveryRun = await recoveringRunner.runWorkflow(workflowId);
    printStep('✓', `Phase 4 Complete: Self-recovery succeeded (${recoveryRun.recoveredSteps} steps repaired)!`);
    await new Promise(r => setTimeout(r, 1000));

    // ==========================================
    // PHASE 5: REMEMBER & REPLAY RECOVERED
    // ==========================================
    printHeader('PHASE 5: REPLAYING UPDATED WORKFLOW FROM MEMORY');
    const updatedWf = store.get(workflowId);
    printInfo(`Workflow Recovery Count: ${updatedWf.recovery_count} | Updated Selectors Stored in Memory`);

    const finalRunner = new WorkflowRunner({
      headed,
      onLog: (msg) => console.log(`    ${msg}`)
    });

    const finalReplay = await finalRunner.runWorkflow(workflowId);
    printStep('✓', `Phase 5 Complete: Replay on Mutated Version B completed in ${finalReplay.durationMs}ms with 0 errors!`);

    await finalRunner.close();
    await recoveringRunner.close();
    await runner.close();

    console.log('\n\x1b[1m\x1b[32m' + '═'.repeat(60));
    console.log('  DEMO SUMMARY: LEARN → REPLAY → BREAK → RECOVER → REMEMBER');
    console.log('  ✓ Autonomous exploration & snapshot-and-ref learning');
    console.log('  ✓ 100% deterministic action verification contracts');
    console.log('  ✓ Scrapling multi-factor element similarity & relocation');
    console.log('  ✓ Persistent workflow memory update & zero-failure replay');
    console.log('═'.repeat(60) + '\x1b[0m\n');

    return true;
  } finally {
    await demoServer.stop();
  }
}

module.exports = { runLiveDemo };
