/**
 * Test Suite for Webcmd Extension Bridge Server
 * Verifies all REST endpoints required by the Chrome Extension.
 */

const assert = require('assert');
const { ExtensionBridgeServer } = require('../src/server/extension-bridge');

async function runTests() {
  console.log('Testing Webcmd Extension Bridge REST API...');

  const server = new ExtensionBridgeServer({ port: 9799 });
  const serverUrl = await server.start();
  console.log(`  Bridge server started at ${serverUrl}`);

  try {
    // 1. Test GET /api/status
    const statusRes = await fetch(`${serverUrl}/api/status`);
    assert.strictEqual(statusRes.status, 200);
    const statusData = await statusRes.json();
    assert.strictEqual(statusData.success, true);
    assert.strictEqual(statusData.status, 'online');
    assert.strictEqual(statusData.stealthEnabled, true);
    console.log('  ✓ GET /api/status verified');

    // 2. Test GET /api/doctor
    const doctorRes = await fetch(`${serverUrl}/api/doctor`);
    assert.strictEqual(doctorRes.status, 200);
    const doctorData = await doctorRes.json();
    assert.strictEqual(doctorData.success, true);
    assert.strictEqual(doctorData.checks.stealthAvailable, true);
    console.log('  ✓ GET /api/doctor verified');

    // 3. Test POST /api/auth/login
    const loginRes = await fetch(`${serverUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'HackathonJudge', profile: 'evaluation' })
    });
    assert.strictEqual(loginRes.status, 200);
    const loginData = await loginRes.json();
    assert.strictEqual(loginData.success, true);
    assert.strictEqual(loginData.profile.username, 'HackathonJudge');
    assert.strictEqual(loginData.profile.name, 'evaluation');
    assert.ok(loginData.token.startsWith('wc_sec_'));
    console.log('  ✓ POST /api/auth/login verified');

    // 4. Test GET /api/profiles
    const profilesRes = await fetch(`${serverUrl}/api/profiles`);
    assert.strictEqual(profilesRes.status, 200);
    const profilesData = await profilesRes.json();
    assert.strictEqual(profilesData.success, true);
    assert.ok(profilesData.profiles.includes('evaluation'));
    assert.strictEqual(profilesData.active, 'evaluation');
    console.log('  ✓ GET /api/profiles verified');

    // 5. Test GET /api/workflows
    const workflowsRes = await fetch(`${serverUrl}/api/workflows`);
    assert.strictEqual(workflowsRes.status, 200);
    // 6. Test POST /api/presentations/generate
    const pptRes = await fetch(`${serverUrl}/api/presentations/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: 'Webcmd Agent', headed: false })
    });
    assert.strictEqual(pptRes.status, 200);
    const pptData = await pptRes.json();
    assert.strictEqual(pptData.success, true);
    assert.ok(pptData.slidesCount >= 3, `Expected at least 3 slides, got ${pptData.slidesCount}`);
    console.log(`  ✓ POST /api/presentations/generate verified (${pptData.slidesCount} slides synthesized)`);

    console.log('\n✓ All Extension Bridge API endpoints PASSED with 100% success!\n');
  } finally {
    await server.stop();
  }
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
