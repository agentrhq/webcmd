/**
 * Unit Test: ActionVerifier Subsystem
 */

const assert = require('assert');
const { ActionVerifier } = require('../src/verifier/verifier');

console.log('Testing ActionVerifier Subsystem...');

// Mock CDP & Actions
const mockCdp = {
  evaluations: {},
  async evaluate(expr) {
    if (expr.includes('window.location.href')) return 'http://127.0.0.1:8080/dashboard';
    if (expr.includes('value')) return 'ThinkPad X1';
    if (expr.includes('getBoundingClientRect')) return true;
    if (expr.includes('document.body.innerText') || expr.includes('innerText')) return 'Order Confirmed - Total: $1,499';
    if (expr.includes('Boolean')) return true;
    return null;
  }
};

const mockActions = {
  _buildLocatorScript(target) {
    return `document.querySelector('${target}')`;
  }
};

async function runVerifierTests() {
  const verifier = new ActionVerifier(mockCdp, mockActions);

  // 1. URL Rule
  const urlCheck = await verifier.verify({ type: 'url', expected: 'dashboard' });
  assert.strictEqual(urlCheck.verified, true);

  const urlFail = await verifier.verify({ type: 'url', expected: 'checkout', timeoutMs: 200 });
  assert.strictEqual(urlFail.verified, false);

  // 2. Value Rule
  const valCheck = await verifier.verify({ type: 'value', target: '#search', expected: 'ThinkPad X1' });
  assert.strictEqual(valCheck.verified, true);

  // 3. Selector Visibility Rule
  const visCheck = await verifier.verify({ type: 'selector_visible', target: '.results' });
  assert.strictEqual(visCheck.verified, true);

  // 4. Text Contains Rule
  const textCheck = await verifier.verify({ type: 'text_contains', expected: 'Order Confirmed' });
  assert.strictEqual(textCheck.verified, true);

  // 5. Custom JS Rule
  const customCheck = await verifier.verify({ type: 'custom_js', expression: 'window.cartCount > 0' });
  assert.strictEqual(customCheck.verified, true);

  console.log('✓ All ActionVerifier tests passed!\n');
}

runVerifierTests().catch(err => {
  console.error('Verifier test failed:', err);
  process.exit(1);
});
