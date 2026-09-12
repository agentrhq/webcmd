/**
 * Test: Scrapling-inspired Adaptive Relocation & Multi-Factor Similarity
 */

const assert = require('assert');
const { SimilarityCalculator, stringSimilarity, dictSimilarity, arraySimilarity } = require('../src/adaptive/similarity');
const { AdaptiveRecoveryEngine, generateOptimalSelector } = require('../src/adaptive/recovery');

console.log('Testing Adaptive Similarity & Recovery Engine...');

// 1. Test stringSimilarity
assert.strictEqual(stringSimilarity('search', 'search'), 1.0, 'Exact match should be 1.0');
assert.ok(stringSimilarity('search', 'search-input') > 0.7, 'Substring should score high');
assert.ok(stringSimilarity('Search Products', 'find products') > 0.4, 'Semantically related strings should have reasonable score');
assert.strictEqual(stringSimilarity('', ''), 1.0, 'Empty strings equal 1.0');

// 2. Test dictSimilarity
const d1 = { id: 'search-input', class: 'input-search', placeholder: 'Search...' };
const d2 = { id: 'search-input', class: 'input-search', placeholder: 'Search...' };
assert.strictEqual(dictSimilarity(d1, d2), 1.0, 'Identical dicts should be 1.0');

const d3 = { id: 'product-query', class: 'txt-query', placeholder: 'Search...' };
const simDict = dictSimilarity(d1, d3);
assert.ok(simDict > 0.3 && simDict < 1.0, `Mutated dict should yield partial similarity (got ${simDict})`);

// 3. Test arraySimilarity
assert.strictEqual(arraySimilarity(['html', 'body', 'form', 'input'], ['html', 'body', 'form', 'input']), 1.0);
assert.ok(arraySimilarity(['html', 'body', 'form', 'input'], ['html', 'body', 'section', 'input']) > 0.5);

// 4. Test Multi-Factor Similarity Calculation
const calc = new SimilarityCalculator();
const original = {
  tag: 'input',
  role: 'textbox',
  text: '',
  attributes: { id: 'search-input', class: 'input-search', placeholder: 'Search laptops...' },
  path: ['html', 'body', 'div', 'form', 'input'],
  parent_name: 'form',
  siblings: ['button']
};

const candidateMutated = {
  tag: 'input',
  role: 'textbox',
  text: '',
  attributes: { id: 'product-query', class: 'txt-query', placeholder: 'Search laptops...' },
  path: ['html', 'body', 'section', 'form', 'input'],
  parent_name: 'form',
  siblings: ['button']
};

const candidateUnrelated = {
  tag: 'div',
  role: 'generic',
  text: 'Contact Us',
  attributes: { class: 'footer-link' },
  path: ['html', 'body', 'footer', 'div'],
  parent_name: 'footer',
  siblings: ['span']
};

const scoreMutated = calc.calculate(original, candidateMutated);
const scoreUnrelated = calc.calculate(original, candidateUnrelated);

console.log(`  Score for Mutated Target: ${(scoreMutated.totalScore * 100).toFixed(1)}%`);
console.log(`  Score for Unrelated Element: ${(scoreUnrelated.totalScore * 100).toFixed(1)}%`);

assert.ok(scoreMutated.totalScore > 0.70, `Mutated target should score high confidence (got ${scoreMutated.totalScore})`);
assert.ok(scoreUnrelated.totalScore < 0.25, `Unrelated element should score low confidence (got ${scoreUnrelated.totalScore})`);

// 5. Test AdaptiveRecoveryEngine Candidate Ranking & Relocation
const engine = new AdaptiveRecoveryEngine({ threshold: 0.40 });
const liveElements = [
  { ref: '@e1', fingerprint: candidateUnrelated },
  { ref: '@e2', fingerprint: candidateMutated },
  { ref: '@e3', fingerprint: { tag: 'button', text: 'Find', attributes: { id: 'btn-find' } } }
];

const recovery = engine.relocate(original, liveElements);
assert.ok(recovery.success, 'Recovery should succeed');
assert.strictEqual(recovery.bestCandidate.ref, '@e2', 'Should select @e2 as top candidate');
assert.strictEqual(recovery.bestCandidate.selector, '#product-query', 'Should generate #product-query selector');

console.log('✓ All Adaptive Similarity & Recovery tests passed!\n');
