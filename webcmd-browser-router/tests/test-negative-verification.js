/**
 * Negative Test: Verifier Rejection on Navigation Failure / False Positive Guard
 * Verifies that Webcmd strictly rejects cases where the page remains on the Main Page
 * or does not arrive at the intended article identity.
 */

const assert = require('assert');
const { ActionVerifier } = require('../src/verifier/verifier');

console.log('Testing Negative Verification Contracts (False Positive Prevention)...');

// 1. Mock page stuck on Main Page
const mockStuckOnMainPage = {
  async evaluate(expr) {
    if (expr.includes('window.location.href')) return 'https://en.wikipedia.org/wiki/Main_Page';
    if (expr.includes('#firstHeading')) return 'Main Page';
    return null;
  }
};

const mockActions = {
  _buildLocatorScript(target) { return `document.querySelector('${target}')`; }
};

async function runNegativeTests() {
  const verifierStuck = new ActionVerifier(mockStuckOnMainPage, mockActions);

  // Test 1: Stays on Main_Page -> MUST FAIL
  const res1 = await verifierStuck.verify({
    type: 'article_identity',
    expectedTopic: 'Quantum Computing',
    notUrl: 'Main_Page',
    timeoutMs: 300
  });

  assert.strictEqual(res1.verified, false, 'Must fail when URL remains on Main_Page');
  assert.ok(res1.error.includes('Navigation did not leave starting page'), `Error message expected, got: ${res1.error}`);
  console.log('  ✓ Test 1 Passed: Stuck on Main_Page correctly flagged as FAILED');

  // Test 2: URL changed, but heading is wrong article (e.g. arrived on 'Physics' instead of 'Quantum Computing')
  const mockWrongArticle = {
    async evaluate(expr) {
      if (expr.includes('window.location.href')) return 'https://en.wikipedia.org/wiki/Physics';
      if (expr.includes('#firstHeading')) return 'Physics';
      return null;
    }
  };

  const verifierWrong = new ActionVerifier(mockWrongArticle, mockActions);
  const res2 = await verifierWrong.verify({
    type: 'article_identity',
    expectedTopic: 'Quantum Computing',
    notUrl: 'Main_Page',
    timeoutMs: 300
  });

  assert.strictEqual(res2.verified, false, 'Must fail when heading does not correspond to expected topic');
  assert.ok(res2.error.includes('does not correspond to expected topic'), `Error message expected, got: ${res2.error}`);
  console.log('  ✓ Test 2 Passed: Wrong destination article correctly flagged as FAILED');

  // Test 3: URL_NOT verification rule fails when disallowed segment is present
  const res3 = await verifierStuck.verify({
    type: 'url_not',
    disallowed: 'Main_Page',
    timeoutMs: 300
  });
  assert.strictEqual(res3.verified, false, 'url_not must fail when disallowed segment is present');
  console.log('  ✓ Test 3 Passed: url_not correctly flagged as FAILED');

  console.log('\n✓ All Negative Verification tests PASSED (0 false positives)!\n');
}

runNegativeTests().catch(err => {
  console.error('Negative test failure:', err);
  process.exit(1);
});
