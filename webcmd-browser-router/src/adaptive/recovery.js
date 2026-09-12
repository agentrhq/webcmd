/**
 * Webcmd Adaptive Relocation & Self-Recovery Engine
 * Scans live page candidates, scores each against stored element fingerprints,
 * and recovers actionable targets when website DOM changes occur.
 */

const { SimilarityCalculator } = require('./similarity');

function generateOptimalSelector(candidate) {
  const attrs = candidate.attributes || {};
  const tag = (candidate.tag || 'div').toLowerCase();

  // 1. If has unique ID
  if (attrs.id && !/\d{5,}/.test(attrs.id)) {
    return `#${attrs.id}`;
  }

  // 2. If has data-testid
  if (attrs['data-testid']) {
    return `[data-testid="${attrs['data-testid']}"]`;
  }

  // 3. If has unique name
  if (attrs.name) {
    return `${tag}[name="${attrs.name}"]`;
  }

  // 4. If has placeholder
  if (attrs.placeholder) {
    return `${tag}[placeholder="${attrs.placeholder}"]`;
  }

  // 5. If has class
  if (attrs.class) {
    const classes = attrs.class.trim().split(/\s+/).filter(c => !c.includes(':') && c.length > 2);
    if (classes.length > 0) {
      return `${tag}.${classes.join('.')}`;
    }
  }

  // 6. If has text and is a button/link
  if (candidate.text && (tag === 'button' || tag === 'a')) {
    return `text="${candidate.text.slice(0, 30)}"`;
  }

  // 7. Fallback to @eN ref if available
  if (candidate.ref) {
    return candidate.ref;
  }

  // 8. Fallback to tag
  return tag;
}

class AdaptiveRecoveryEngine {
  constructor(options = {}) {
    this.threshold = options.threshold !== undefined ? options.threshold : 0.40;
    this.calculator = new SimilarityCalculator(options.weights);
  }

  relocate(originalFingerprint, liveElements) {
    if (!originalFingerprint || !Array.isArray(liveElements) || liveElements.length === 0) {
      return {
        success: false,
        candidates: [],
        bestCandidate: null,
        reason: 'Missing original fingerprint or live page elements'
      };
    }

    const scoredCandidates = [];

    for (const el of liveElements) {
      const candidateData = el.fingerprint || el;
      const { totalScore, breakdown } = this.calculator.calculate(originalFingerprint, candidateData);

      const selector = generateOptimalSelector(candidateData);

      scoredCandidates.push({
        ref: el.ref || candidateData.ref,
        tag: candidateData.tag,
        role: candidateData.role,
        text: candidateData.text,
        attributes: candidateData.attributes,
        selector,
        score: totalScore,
        breakdown,
        candidateData
      });
    }

    // Sort descending by score
    scoredCandidates.sort((a, b) => b.score - a.score);

    const qualifying = scoredCandidates.filter(c => c.score >= this.threshold);

    if (qualifying.length === 0) {
      return {
        success: false,
        candidates: scoredCandidates.slice(0, 5),
        bestCandidate: null,
        topScore: scoredCandidates[0]?.score || 0,
        reason: `No candidate met the confidence threshold of ${this.threshold} (Highest score: ${scoredCandidates[0]?.score || 0})`
      };
    }

    const best = qualifying[0];

    return {
      success: true,
      bestCandidate: best,
      candidates: qualifying.slice(0, 5),
      confidence: best.score,
      recoveredSelector: best.selector,
      newFingerprint: best.candidateData
    };
  }
}

module.exports = {
  AdaptiveRecoveryEngine,
  generateOptimalSelector
};
