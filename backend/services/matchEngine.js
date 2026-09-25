/**
 * matchEngine.js
 * Computes a 0-100 Match % between a student Profile and an Opportunity.
 * Weighted, explainable scoring - no ML needed for the MVP.
 *
 *   Skills overlap        -> 40 pts
 *   Interests overlap      -> 20 pts
 *   CGPA eligibility        -> 20 pts
 *   Preferred type match     -> 15 pts
 *   Has experience listed     -> 5 pts
 */

function normalize(list) {
  return (list || []).map((s) => String(s).trim().toLowerCase()).filter(Boolean);
}

function overlapScore(profileList, oppList, weight) {
  const opp = normalize(oppList);
  if (opp.length === 0) return weight; // nothing specifically required -> free points
  const profileSet = new Set(normalize(profileList));
  const matched = opp.filter((item) => profileSet.has(item));
  return Math.round((matched.length / opp.length) * weight);
}

function computeMatchPercent(profile, opportunity) {
  if (!profile) return 0;

  let score = 0;

  score += overlapScore(profile.skills, opportunity.requiredSkills, 40);
  score += overlapScore(profile.interests, opportunity.relatedInterests, 20);

  // CGPA eligibility
  const minCgpa = opportunity.minCgpa || 0;
  if (minCgpa === 0) {
    score += 20;
  } else if ((profile.cgpa || 0) >= minCgpa) {
    score += 20;
  } else {
    const ratio = Math.max(0, (profile.cgpa || 0) / minCgpa);
    score += Math.round(ratio * 20);
  }

  // Preferred opportunity type
  const preferred = normalize(profile.preferredTypes);
  if (preferred.length === 0 || preferred.includes(opportunity.type.toLowerCase())) {
    score += 15;
  }

  // Experience listed at all
  if (profile.experience && profile.experience.trim().length > 0) {
    score += 5;
  }

  return Math.max(0, Math.min(100, score));
}

module.exports = { computeMatchPercent };
