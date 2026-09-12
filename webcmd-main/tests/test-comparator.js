/**
 * Unit Test: ProductComparator and Recommendation Engine
 */

const assert = require('assert');
const { ProductComparator, parseNumber, parsePaScore } = require('../src/agent/comparator');

console.log('Testing ProductComparator Subsystem...');

// 1. Test parseNumber
assert.strictEqual(parseNumber('₹359.00'), 359);
assert.strictEqual(parseNumber('SPF 50+'), 50);
assert.strictEqual(parseNumber('12,450 reviews'), 12450);

// 2. Test parsePaScore
assert.strictEqual(parsePaScore('PA++++'), 1.0);
assert.strictEqual(parsePaScore('PA+++'), 0.75);

// 3. Test evaluateAndRank
const sampleProducts = [
  { name: 'Minimalist Light Fluid SPF 50 PA++++', price: 359, spf: 50, pa: 'PA++++', rating: 4.4, reviews: 12000 },
  { name: 'Foxtale Glow Sunscreen SPF 50 PA++++', price: 300, spf: 50, pa: 'PA++++', rating: 4.3, reviews: 8000 },
  { name: 'Luxury Imported SPF 50', price: 1800, spf: 50, pa: 'PA++++', rating: 4.8, reviews: 30000 }, // over budget
  { name: 'Low Protection Cream SPF 30', price: 250, spf: 30, pa: 'PA++', rating: 4.0, reviews: 2000 } // low spf
];

const comparator = new ProductComparator({ maxBudget: 500, minSpf: 50 });
const result = comparator.evaluateAndRank(sampleProducts);

assert.strictEqual(result.totalAnalyzed, 4);
assert.strictEqual(result.underBudgetCount, 3);
assert.strictEqual(result.qualifyingCount, 2); // only 2 meet both budget <= 500 and SPF >= 50
assert.ok(result.bestMatch !== null);
assert.ok(result.bestMatch.name.includes('Minimalist') || result.bestMatch.name.includes('Foxtale'));
assert.strictEqual(result.bestMatch.isUnderBudget, true);
assert.strictEqual(result.bestMatch.meetsSpfCriteria, true);

console.log('✓ All ProductComparator tests passed!\n');
