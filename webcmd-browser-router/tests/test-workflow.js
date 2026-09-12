/**
 * Test: WorkflowStore Persistence & History Tracking
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { WorkflowStore } = require('../src/learning/store');

console.log('Testing WorkflowStore Subsystem...');

const testStoreDir = path.join(__dirname, '.temp-workflows');
if (fs.existsSync(testStoreDir)) {
  fs.rmSync(testStoreDir, { recursive: true, force: true });
}

const store = new WorkflowStore(testStoreDir);

// 1. Save workflow
const wf = {
  id: 'test-search-flow',
  name: 'Test Search Flow',
  domain: 'localhost',
  intent: 'Search for item',
  steps: [
    { id: 's1', action: 'navigate', url: 'http://127.0.0.1:8080' },
    {
      id: 's2',
      action: 'fill',
      target: '#search-box',
      value: 'laptop',
      fingerprint: { tag: 'input', role: 'textbox', attributes: { id: 'search-box' } },
      verify: { type: 'value', expected: 'laptop' }
    }
  ]
};

const saved = store.save(wf);
assert.strictEqual(saved.id, 'test-search-flow');
assert.strictEqual(saved.steps.length, 2);

// 2. Retrieve workflow
const retrieved = store.get('test-search-flow');
assert.ok(retrieved !== null);
assert.strictEqual(retrieved.name, 'Test Search Flow');

// 3. Update recovery
const updated = store.updateRecovery('test-search-flow', 1, '#mutated-search-query', { tag: 'input', attributes: { id: 'mutated-search-query' } });
assert.strictEqual(updated.recovery_count, 1);
assert.strictEqual(updated.steps[1].target, '#mutated-search-query');
assert.deepStrictEqual(updated.steps[1].selector_history, ['#search-box']);

// 4. Record execution
const recorded = store.recordExecution('test-search-flow', { success: true });
assert.strictEqual(recorded.success_count, 1);

// 5. List workflows
const list = store.list();
assert.strictEqual(list.length, 1);
assert.strictEqual(list[0].id, 'test-search-flow');

// Cleanup
fs.rmSync(testStoreDir, { recursive: true, force: true });
console.log('✓ All WorkflowStore tests passed!\n');
