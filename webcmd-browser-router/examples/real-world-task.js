/**
 * Real-World Task: Wikipedia Search & Article Extraction
 * Architecture: ACTION -> VERIFY THE INTENDED OUTCOME -> EXTRACT
 * 
 * 1. Open Wikipedia
 * 2. Target search input & fill query
 * 3. Verify input value
 * 4. Submit search
 * 5. Verify arrival on actual destination article (URL is not Main_Page AND heading matches topic)
 * 6. Extract actual article title and lead paragraph
 * 7. Save verified workflow to .webcmd/workflows/
 */

const { CDPClient } = require('../src/browser/cdp');
const { SnapshotEngine } = require('../src/browser/snapshot');
const { ActionExecutor } = require('../src/browser/actions');
const { ActionVerifier } = require('../src/verifier/verifier');
const { WorkflowStore } = require('../src/learning/store');
const { generateOptimalSelector } = require('../src/adaptive/recovery');

async function runWikipediaSearchTask(query = 'Quantum Computing', headed = true) {
  console.log(`\n\x1b[1m\x1b[36m============================================================\x1b[0m`);
  console.log(`\x1b[1m  WEBCMD REAL-WORLD TASK: WIKIPEDIA SEARCH & EXTRACTION\x1b[0m`);
  console.log(`\x1b[1m\x1b[36m============================================================\x1b[0m\n`);

  const cdp = new CDPClient({ headed });
  await cdp.launch();
  const snapshot = new SnapshotEngine(cdp);
  const actions = new ActionExecutor(cdp, snapshot);
  const verifier = new ActionVerifier(cdp, actions);
  const store = new WorkflowStore();

  try {
    // 1. Navigate
    console.log(`  [1/5] 🔎 Navigating to https://en.wikipedia.org...`);
    await actions.navigate('https://en.wikipedia.org');
    const vNav = await verifier.verify({ type: 'url', expected: 'wikipedia.org' });
    if (!vNav.verified) throw new Error(`Navigation verification failed: ${vNav.error}`);
    console.log(`  ✓ Verified page loaded: ${vNav.actual}`);

    // 2. Snapshot & find search input
    console.log(`  [2/5] 🧠 Capturing perception snapshot to target search elements...`);
    const snap = await snapshot.capture();
    const searchInput = snap.data.elements.find(e => 
      e.tag === 'input' && (
        e.attributes.type === 'search' ||
        (e.attributes.name && e.attributes.name.toLowerCase().includes('search')) ||
        (e.attributes.placeholder && e.attributes.placeholder.toLowerCase().includes('search')) ||
        (e.attributes.id && e.attributes.id.toLowerCase().includes('search')) ||
        e.role === 'textbox' ||
        e.role === 'searchbox'
      )
    );

    if (!searchInput) throw new Error('Search input element not found on Wikipedia');
    const searchTarget = generateOptimalSelector(searchInput.fingerprint || searchInput);
    console.log(`  ✓ Targeted search input: ${searchInput.ref} (${searchTarget})`);

    // 3. Fill query
    console.log(`  [3/5] ⚙ Filling search query: "${query}"...`);
    await actions.fill(searchInput.ref, query);
    const vFill = await verifier.verify({ type: 'value', target: searchTarget, expected: query });
    if (!vFill.verified) throw new Error(`Fill verification failed: ${vFill.error}`);
    console.log(`  ✓ Verified input value matches "${query}"`);

    // 4. Submit Search
    console.log(`  [4/5] ⚙ Submitting search for "${query}"...`);
    
    // Find explicit search button or trigger form submit / Enter
    const searchBtn = snap.data.elements.find(e => 
      (e.role === 'button' || e.tag === 'button') && 
      (e.text?.toLowerCase() === 'search' || e.attributes.id === 'searchButton' || e.attributes.type === 'submit')
    );

    if (searchBtn) {
      try {
        await actions.click(searchBtn.ref);
      } catch (_) {
        await actions.press('Enter');
      }
    } else {
      await actions.press('Enter');
    }

    // STRICT VERIFICATION: Verify destination article identity (URL != Main_Page AND Title matches topic)
    console.log(`  ⚙ Verifying destination article identity...`);
    const vDest = await verifier.verify({
      type: 'article_identity',
      expectedTopic: query,
      notUrl: 'Main_Page',
      timeoutMs: 12000
    });

    if (!vDest.verified) {
      console.error(`\x1b[31m  ❌ Verification FAILED: ${vDest.error}\x1b[0m`);
      throw new Error(`Article verification failed: Expected to reach article for "${query}", but ${vDest.error}`);
    }

    console.log(`  ✓ Verified article reached: "${vDest.actualTitle}" at ${vDest.actualUrl}`);

    // 5. Extract actual article title and first meaningful paragraph
    console.log(`  [5/5] 📄 Extracting verified article content...`);
    const title = vDest.actualTitle || await actions.extract('#firstHeading, .mw-page-title-main', 'text');
    
    const summary = await cdp.evaluate(`(() => {
      const ps = Array.from(document.querySelectorAll('#mw-content-text .mw-parser-output > p, #mw-content-text p'));
      const firstMeaningful = ps.find(p => p.innerText && p.innerText.trim().length > 30);
      return firstMeaningful ? firstMeaningful.innerText.trim() : null;
    })()`);

    if (!summary || summary.trim().length === 0) {
      throw new Error('Could not extract meaningful article summary paragraph');
    }

    console.log(`\n\x1b[32m  Article Title:\x1b[0m \x1b[1m${title}\x1b[0m`);
    console.log(`\x1b[32m  Article Summary:\x1b[0m ${summary.slice(0, 300)}...\n`);

    // Save learned workflow
    const cleanId = `wiki-${query.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
    const learnedWf = {
      id: cleanId,
      name: `Wikipedia: ${title}`,
      domain: 'en.wikipedia.org',
      intent: `Search Wikipedia for "${query}" and extract article text`,
      steps: [
        { id: 's1', action: 'navigate', url: 'https://en.wikipedia.org', verify: { type: 'url', expected: 'wikipedia.org' } },
        { id: 's2', action: 'fill', target: searchTarget, value: query, fingerprint: searchInput.fingerprint, verify: { type: 'value', expected: query } },
        { id: 's3', action: 'press', key: 'Enter', verify: { type: 'article_identity', expectedTopic: query, notUrl: 'Main_Page' } }
      ],
      success_count: 1,
      recovery_count: 0,
      extracted: { title, summaryLength: summary.length }
    };

    store.save(learnedWf);
    console.log(`  💾 Saved learned workflow to .webcmd/workflows/${learnedWf.id}.json\n`);
    return { success: true, title, summary, url: vDest.actualUrl };
  } finally {
    await cdp.close();
  }
}

if (require.main === module) {
  const query = process.argv[2] || 'Quantum Computing';
  const headed = process.argv.includes('--headed') || !process.argv.includes('--headless');
  runWikipediaSearchTask(query, headed).catch(err => {
    console.error('\x1b[31m[Task Error]\x1b[0m', err.message);
    process.exit(1);
  });
}

module.exports = { runWikipediaSearchTask };
