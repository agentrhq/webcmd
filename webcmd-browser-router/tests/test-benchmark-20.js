/**
 * 20/20 Reliability Benchmark for Hackathon
 * Executes 20 full cycles of Learn -> Replay -> Break -> Recover -> Remember
 * to verify 100% deterministic success with zero flakiness.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { DemoServer } = require('../src/demo/server');
const { AutonomousAgent } = require('../src/agent/planner');
const { WorkflowRunner } = require('../src/agent/runner');
const { WorkflowStore } = require('../src/learning/store');

async function runBenchmark(iterations = 20) {
  console.log(`\n\x1b[1m\x1b[36m============================================================\x1b[0m`);
  console.log(`\x1b[1m  STARTING ${iterations}-RUN RELIABILITY BENCHMARK FOR WEBCMD\x1b[0m`);
  console.log(`\x1b[1m\x1b[36m============================================================\x1b[0m\n`);

  const port = 8095;
  const demoServer = new DemoServer(port);
  const serverUrl = await demoServer.start();

  const tempStoreDir = path.join(__dirname, '.temp-benchmark-wf');
  if (fs.existsSync(tempStoreDir)) fs.rmSync(tempStoreDir, { recursive: true, force: true });
  const store = new WorkflowStore(tempStoreDir);

  let passedRuns = 0;
  let failedRuns = 0;
  const timings = [];

  for (let i = 1; i <= iterations; i++) {
    const cycleStart = Date.now();
    const wfId = `benchmark-wf-${i}`;
    process.stdout.write(`  [Run ${i.toString().padStart(2, ' ')}/${iterations}] `);

    try {
      // 1. Learn (Version A)
      demoServer.setVersion('a');
      const agent = new AutonomousAgent({ storeDir: tempStoreDir });
      await agent.learnSearchAndCartWorkflow(serverUrl, wfId);
      await agent.close();

      // 2. Replay (Version A)
      const runner1 = new WorkflowRunner({ storeDir: tempStoreDir });
      const r1 = await runner1.runWorkflow(wfId);
      assert.strictEqual(r1.success, true);
      await runner1.close();

      // 3. Break & Recover (Version B)
      demoServer.setVersion('b');
      const runner2 = new WorkflowRunner({ storeDir: tempStoreDir });
      const r2 = await runner2.runWorkflow(wfId);
      assert.strictEqual(r2.success, true);
      assert.ok(r2.recoveredSteps > 0);
      await runner2.close();

      // 4. Remember & Replay (Version B)
      const runner3 = new WorkflowRunner({ storeDir: tempStoreDir });
      const r3 = await runner3.runWorkflow(wfId);
      assert.strictEqual(r3.success, true);
      assert.strictEqual(r3.recoveredSteps, 0);
      await runner3.close();

      const duration = Date.now() - cycleStart;
      timings.push(duration);
      passedRuns++;
      console.log(`\x1b[32m✓ PASSED\x1b[0m (${duration}ms)`);
    } catch (err) {
      failedRuns++;
      console.log(`\x1b[31m✗ FAILED:\x1b[0m ${err.message}`);
    }
  }

  await demoServer.stop();
  if (fs.existsSync(tempStoreDir)) fs.rmSync(tempStoreDir, { recursive: true, force: true });

  const avgTime = timings.length > 0 ? Math.round(timings.reduce((a, b) => a + b, 0) / timings.length) : 0;

  console.log(`\n\x1b[1m\x1b[35m============================================================\x1b[0m`);
  console.log(`\x1b[1m  BENCHMARK SUMMARY\x1b[0m`);
  console.log(`\x1b[1m  Passed: ${passedRuns}/${iterations} (${Math.round((passedRuns / iterations) * 100)}%)\x1b[0m`);
  console.log(`\x1b[1m  Failed: ${failedRuns}/${iterations}\x1b[0m`);
  console.log(`\x1b[1m  Average Full Lifecycle Time: ${avgTime}ms\x1b[0m`);
  console.log(`\x1b[1m\x1b[35m============================================================\x1b[0m\n`);

  if (failedRuns > 0) {
    process.exit(1);
  }
}

runBenchmark(20).catch(err => {
  console.error('Benchmark error:', err);
  process.exit(1);
});
