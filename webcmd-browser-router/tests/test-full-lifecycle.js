/**
 * End-to-End Test: Full Lifecycle (Learn -> Replay -> Break -> Recover -> Remember)
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { DemoServer } = require('../src/demo/server');
const { AutonomousAgent } = require('../src/agent/planner');
const { WorkflowRunner } = require('../src/agent/runner');
const { WorkflowStore } = require('../src/learning/store');

async function testFullLifecycle() {
  console.log('Testing Full Lifecycle End-to-End...');
  const port = 8092;
  const demoServer = new DemoServer(port);
  const serverUrl = await demoServer.start();

  const tempStoreDir = path.join(__dirname, '.temp-lifecycle-wf');
  if (fs.existsSync(tempStoreDir)) fs.rmSync(tempStoreDir, { recursive: true, force: true });
  const store = new WorkflowStore(tempStoreDir);

  const wfId = 'lifecycle-e2e-test';

  try {
    // 1. LEARN (Version A)
    demoServer.setVersion('a');
    const agent = new AutonomousAgent({
      storeDir: tempStoreDir,
      onLog: msg => console.log(`    [Learn] ${msg}`)
    });

    const learned = await agent.learnSearchAndCartWorkflow(serverUrl, wfId);
    assert.ok(learned !== null, 'Learned workflow must exist');
    assert.strictEqual(learned.steps.length, 4, 'Must have 4 steps');
    await agent.close();
    console.log('  ✓ Step 1: Learning completed & verified.');

    // 2. REPLAY (Version A)
    const runner1 = new WorkflowRunner({
      storeDir: tempStoreDir,
      onLog: msg => console.log(`    [Replay 1] ${msg}`)
    });

    const res1 = await runner1.runWorkflow(wfId);
    assert.strictEqual(res1.success, true);
    assert.strictEqual(res1.recoveredSteps, 0, 'No recoveries needed on original version');
    await runner1.close();
    console.log('  ✓ Step 2: Fast replay completed.');

    // 3. BREAK & RECOVER (Version B)
    demoServer.setVersion('b');
    let recoveryOccurred = false;
    const runner2 = new WorkflowRunner({
      storeDir: tempStoreDir,
      onLog: msg => console.log(`    [Recover Run] ${msg}`),
      onRecovery: details => {
        recoveryOccurred = true;
        console.log(`    [Recovery Event] Best match: ${details.bestCandidate.selector} (Confidence: ${details.confidence})`);
      }
    });

    const res2 = await runner2.runWorkflow(wfId);
    assert.strictEqual(res2.success, true);
    assert.ok(recoveryOccurred, 'Recovery event must have fired');
    assert.ok(res2.recoveredSteps > 0, 'Must have recovered broken steps');
    await runner2.close();
    console.log('  ✓ Step 3: Self-recovery succeeded on mutated DOM.');

    // 4. REMEMBER & REPLAY (Version B)
    const updated = store.get(wfId);
    assert.ok(updated.recovery_count > 0, 'Recovery count must be incremented');

    const runner3 = new WorkflowRunner({
      storeDir: tempStoreDir,
      onLog: msg => console.log(`    [Replay 2] ${msg}`)
    });

    const res3 = await runner3.runWorkflow(wfId);
    assert.strictEqual(res3.success, true);
    assert.strictEqual(res3.recoveredSteps, 0, 'Updated workflow should run with 0 additional recoveries');
    await runner3.close();
    console.log('  ✓ Step 4: Replay of updated workflow completed with 0 errors.');

    console.log('\n✓ Complete Lifecycle Test PASSED with 100% verification!\n');
  } finally {
    await demoServer.stop();
    if (fs.existsSync(tempStoreDir)) fs.rmSync(tempStoreDir, { recursive: true, force: true });
  }
}

testFullLifecycle().catch(err => {
  console.error('Lifecycle Test Failed:', err);
  process.exit(1);
});
