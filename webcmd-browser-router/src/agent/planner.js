/**
 * Webcmd Autonomous Agent & Workflow Learner
 * Explores unfamiliar pages, executes actions via compact snapshots,
 * verifies state changes, records fingerprints, and compiles reusable workflows.
 */

const { CDPClient } = require('../browser/cdp');
const { SnapshotEngine } = require('../browser/snapshot');
const { ActionExecutor } = require('../browser/actions');
const { ActionVerifier } = require('../verifier/verifier');
const { WorkflowStore } = require('../learning/store');
const { generateOptimalSelector } = require('../adaptive/recovery');

class AutonomousAgent {
  constructor(options = {}) {
    this.options = {
      headed: options.headed || false,
      port: options.port || 0,
      storeDir: options.storeDir,
      onLog: options.onLog || (() => {}),
      ...options
    };
    this.store = new WorkflowStore(this.options.storeDir);
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

  /**
   * Explores and learns an e-commerce / search workflow deterministically
   */
  async learnSearchAndCartWorkflow(url, workflowId = 'search-and-add-to-cart') {
    if (!this.cdp) await this.init();

    this.log(`🔎 Navigating to unfamiliar target: ${url}`);
    await this.actions.navigate(url);

    this.log(`🧠 Capturing compact perception snapshot...`);
    const snap1 = await this.snapshot.capture({ interactive: true });
    this.log(`  Snapshots extracted (${snap1.data.elements.length} interactive elements tagged with @eN)`);

    // Find search input
    const searchInput = snap1.data.elements.find(e => 
      e.role === 'textbox' || e.tag === 'input' || (e.attributes.placeholder && e.attributes.placeholder.toLowerCase().includes('search'))
    );
    if (!searchInput) throw new Error('Could not identify search input from snapshot');

    const searchTarget = generateOptimalSelector(searchInput.fingerprint || searchInput);
    this.log(`⚙ Identified search input: ${searchInput.ref} (${searchTarget})`);

    // Step 1: Fill search input
    this.log(`⚙ Action: fill ${searchTarget} with "ThinkPad X1"`);
    await this.actions.fill(searchInput.ref, 'ThinkPad X1');
    const verifyFill = await this.verifier.verify({ type: 'value', target: searchTarget, expected: 'ThinkPad X1' });
    if (!verifyFill.verified) throw new Error(`Fill verification failed: ${verifyFill.error}`);
    this.log(`✓ Verification passed: Input value matches "ThinkPad X1"`);

    // Re-snapshot
    const snap2 = await this.snapshot.capture();
    const searchBtn = snap2.data.elements.find(e => 
      e.role === 'button' && (e.text?.toLowerCase().includes('search') || e.attributes.type === 'submit' || e.attributes.id?.includes('search'))
    );
    if (!searchBtn) throw new Error('Could not identify search button from snapshot');

    const btnTarget = generateOptimalSelector(searchBtn.fingerprint || searchBtn);
    this.log(`⚙ Action: click search button ${searchBtn.ref} (${btnTarget})`);
    await this.actions.click(searchBtn.ref);

    // Wait for search results
    await this.actions.wait(300);
    const snap3 = await this.snapshot.capture();

    // Find Add to Cart button
    const addToCartBtn = snap3.data.elements.find(e => 
      e.role === 'button' && (e.text?.toLowerCase().includes('add to cart') || e.attributes['data-product'])
    );
    if (!addToCartBtn) throw new Error('Could not identify Add to Cart button from results');

    const addCartTarget = generateOptimalSelector(addToCartBtn.fingerprint || addToCartBtn);
    this.log(`⚙ Action: click ${addToCartBtn.ref} (${addCartTarget})`);
    await this.actions.click(addToCartBtn.ref);

    // Verify cart badge changed from 0 to 1
    const verifyCart = await this.verifier.verify({ type: 'text_contains', target: '#cart-badge', expected: '1' });
    if (!verifyCart.verified) throw new Error(`Cart verification failed: ${verifyCart.error}`);
    this.log(`✓ Verification passed: Cart count incremented to 1`);

    // Compile into learned workflow
    const learnedWorkflow = {
      id: workflowId,
      name: 'Search Product and Add to Cart',
      domain: new URL(url).hostname,
      intent: 'Search for ThinkPad X1 and add to shopping cart',
      steps: [
        {
          id: 'step-navigate',
          action: 'navigate',
          url: url,
          verify: { type: 'url', expected: url }
        },
        {
          id: 'step-fill-query',
          action: 'fill',
          target: searchTarget,
          value: 'ThinkPad X1',
          fingerprint: searchInput.fingerprint,
          verify: { type: 'value', expected: 'ThinkPad X1' }
        },
        {
          id: 'step-click-search',
          action: 'click',
          target: btnTarget,
          fingerprint: searchBtn.fingerprint,
          verify: { type: 'selector_visible', expected: '#products-container, .product-grid, .items-container, #search-results-box' }
        },
        {
          id: 'step-add-cart',
          action: 'click',
          target: addCartTarget,
          fingerprint: addToCartBtn.fingerprint,
          verify: { type: 'text_contains', target: '#cart-badge', expected: '1' }
        }
      ],
      success_count: 1,
      recovery_count: 0,
      created_at: new Date().toISOString()
    };

    const saved = this.store.save(learnedWorkflow);
    this.log(`💾 Workflow compiled and saved to .webcmd/workflows/${saved.id}.json`);

    return saved;
  }
}

module.exports = { AutonomousAgent };
