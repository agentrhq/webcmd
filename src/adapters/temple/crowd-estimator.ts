import { SlotInfo, CrowdInsight } from './types.js';

export class CrowdEstimator {
  /**
   * Turns raw availability slots into an actionable crowd insight.
   */
  estimateCrowd(slots: SlotInfo[], pilgrims: number): CrowdInsight {
    if (!slots || slots.length === 0) {
      return {
        lowCrowdWindow: 'N/A',
        crowdLevel: 'high',
        recommendation: 'No slots available for the selected criteria.',
        queueEstimateMinutes: 120,
      };
    }

    // Filter slots with sufficient capacity for the pilgrim party
    const viableSlots = slots.filter((slot) => slot.availableSeats >= pilgrims);
    const candidateSlots = viableSlots.length > 0 ? viableSlots : slots;

    // Score slots based on availability ratio + time-of-day traffic bias
    const scoredSlots = candidateSlots.map((slot) => {
      const fillRate = 1 - (slot.availableSeats / (slot.totalCapacity || 100));
      const timeBias = this.getTimeOfDayCrowdBias(slot.timeWindow);
      const overallCrowdScore = (fillRate * 0.7) + (timeBias * 0.3);

      return {
        slot,
        crowdScore: overallCrowdScore,
      };
    });

    // Lowest crowd score is best
    scoredSlots.sort((a, b) => a.crowdScore - b.crowdScore);
    const bestCandidate = scoredSlots[0];

    // Determine crowd level
    let crowdLevel: 'low' | 'moderate' | 'high';
    let queueEstimateMinutes: number;

    if (bestCandidate.crowdScore < 0.35) {
      crowdLevel = 'low';
      queueEstimateMinutes = 20;
    } else if (bestCandidate.crowdScore < 0.7) {
      crowdLevel = 'moderate';
      queueEstimateMinutes = 55;
    } else {
      crowdLevel = 'high';
      queueEstimateMinutes = 110;
    }

    const recommendation =
      crowdLevel === 'low'
        ? `Optimal darshan window is ${bestCandidate.slot.timeWindow} with minimal expected wait time (~${queueEstimateMinutes} mins).`
        : crowdLevel === 'moderate'
        ? `Moderate footfall expected during ${bestCandidate.slot.timeWindow}. Expect ~${queueEstimateMinutes} mins queue.`
        : `Heavy rush expected across available slots. Selected ${bestCandidate.slot.timeWindow}; queue may exceed ~${queueEstimateMinutes} mins.`;

    return {
      lowCrowdWindow: bestCandidate.slot.timeWindow,
      crowdLevel,
      recommendation,
      queueEstimateMinutes,
      bestSlotId: bestCandidate.slot.slotId,
    };
  }

  /**
   * Footfall bias (0.0 lowest footfall to 1.0 highest footfall) based on time window.
   */
  private getTimeOfDayCrowdBias(timeWindow: string): number {
    const lower = timeWindow.toLowerCase();
    if (/05:|06:|07:|08:|morning/i.test(lower)) {
      return 0.15; // Early morning
    }
    if (/09:|10:|11:|12:|13:|14:|afternoon|noon/i.test(lower)) {
      return 0.85; // Peak midday rush
    }
    if (/15:|16:|17:|18:|evening/i.test(lower)) {
      return 0.60; // Evening aarti / darshan
    }
    if (/19:|20:|21:|night/i.test(lower)) {
      return 0.30; // Night slots
    }
    return 0.50;
  }
}
