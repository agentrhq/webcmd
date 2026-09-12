/**
 * Webcmd Adaptive Similarity Engine (Scrapling-Inspired)
 * Calculates multi-factor structural and semantic similarity between DOM element fingerprints.
 * Features tunable weights and detailed candidate score breakdowns.
 */

// Normalized Levenshtein distance string similarity ratio [0.0 to 1.0]
function stringSimilarity(s1, s2) {
  if (s1 === s2) return 1.0;
  if (!s1 || !s2) return 0.0;

  s1 = String(s1).trim().toLowerCase();
  s2 = String(s2).trim().toLowerCase();

  if (s1 === s2) return 1.0;
  if (s1.length === 0 || s2.length === 0) return 0.0;

  // Substring bonus
  if (s1.includes(s2) || s2.includes(s1)) {
    const minLen = Math.min(s1.length, s2.length);
    const maxLen = Math.max(s1.length, s2.length);
    return 0.7 + 0.3 * (minLen / maxLen);
  }

  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;
  const longerLength = longer.length;

  // Edit distance calculation
  const costs = [];
  for (let i = 0; i <= shorter.length; i++) {
    let lastValue = i;
    for (let j = 0; j <= longer.length; j++) {
      if (i === 0) {
        costs[j] = j;
      } else if (j > 0) {
        let newValue = costs[j - 1];
        if (shorter.charAt(i - 1) !== longer.charAt(j - 1)) {
          newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
        }
        costs[j - 1] = lastValue;
        lastValue = newValue;
      }
    }
    if (i > 0) costs[longer.length] = lastValue;
  }

  const distance = costs[longerLength];
  return Math.max(0, (longerLength - distance) / longerLength);
}

// Compares two attribute dictionaries (Scrapling __calculate_dict_diff equivalent)
function dictSimilarity(d1 = {}, d2 = {}) {
  const keys1 = Object.keys(d1);
  const keys2 = Object.keys(d2);

  if (keys1.length === 0 && keys2.length === 0) return 1.0;
  if (keys1.length === 0 || keys2.length === 0) return 0.0;

  let keyMatches = 0;
  let valScore = 0;

  for (const k of keys1) {
    if (k in d2) {
      keyMatches++;
      valScore += stringSimilarity(d1[k], d2[k]);
    }
  }

  const keyUnion = new Set([...keys1, ...keys2]).size;
  const keySim = keyMatches / keyUnion;
  const valSim = keyMatches > 0 ? valScore / keyMatches : 0;

  return 0.5 * keySim + 0.5 * valSim;
}

// Array similarity (for DOM hierarchy paths and siblings)
function arraySimilarity(arr1 = [], arr2 = []) {
  if (arr1.length === 0 && arr2.length === 0) return 1.0;
  if (arr1.length === 0 || arr2.length === 0) return 0.0;

  let matches = 0;
  const len = Math.min(arr1.length, arr2.length);
  for (let i = 0; i < len; i++) {
    if (arr1[i] === arr2[i]) matches++;
  }
  return matches / Math.max(arr1.length, arr2.length);
}

const DEFAULT_WEIGHTS = {
  tag: 0.15,
  role: 0.20,
  text: 0.25,
  attributes: 0.20,
  parent: 0.10,
  path: 0.05,
  siblings: 0.05
};

class SimilarityCalculator {
  constructor(weights = DEFAULT_WEIGHTS) {
    this.weights = { ...DEFAULT_WEIGHTS, ...weights };
  }

  calculate(original, candidate) {
    if (!original || !candidate) return { totalScore: 0, breakdown: {} };

    const breakdown = {};

    // 1. Tag match
    breakdown.tag = (original.tag && candidate.tag && original.tag.toLowerCase() === candidate.tag.toLowerCase()) ? 1.0 : 0.0;

    // 2. Role match
    if (original.role && candidate.role) {
      breakdown.role = original.role.toLowerCase() === candidate.role.toLowerCase() ? 1.0 : 0.0;
    } else {
      breakdown.role = breakdown.tag; // Fallback to tag match
    }

    // 3. Text similarity
    if (original.text || candidate.text) {
      breakdown.text = stringSimilarity(original.text || '', candidate.text || '');
    } else {
      breakdown.text = 1.0; // Both have no text (e.g. empty input boxes)
    }

    // 4. Attribute similarity
    breakdown.attributes = dictSimilarity(original.attributes || {}, candidate.attributes || {});

    // 5. Parent similarity
    let parentScore = 0;
    let parentChecks = 0;
    if (original.parent_name || candidate.parent_name) {
      parentScore += (original.parent_name === candidate.parent_name ? 1.0 : 0.0);
      parentChecks++;
      if (original.parent_text || candidate.parent_text) {
        parentScore += stringSimilarity(original.parent_text || '', candidate.parent_text || '');
        parentChecks++;
      }
      breakdown.parent = parentChecks > 0 ? parentScore / parentChecks : 0.0;
    } else {
      breakdown.parent = 1.0;
    }

    // 6. Path hierarchy similarity
    breakdown.path = arraySimilarity(original.path || [], candidate.path || []);

    // 7. Siblings similarity
    breakdown.siblings = arraySimilarity(original.siblings || [], candidate.siblings || []);

    // Compute weighted total
    let totalScore = 0;
    let weightSum = 0;

    for (const [key, weight] of Object.entries(this.weights)) {
      if (key in breakdown) {
        totalScore += breakdown[key] * weight;
        weightSum += weight;
      }
    }

    const normalizedTotal = weightSum > 0 ? totalScore / weightSum : 0;

    return {
      totalScore: Math.round(normalizedTotal * 1000) / 1000,
      breakdown
    };
  }
}

module.exports = {
  SimilarityCalculator,
  stringSimilarity,
  dictSimilarity,
  arraySimilarity,
  DEFAULT_WEIGHTS
};
