/**
 * Domain types for Temple darshan slot booking & crowd estimation.
 */

export interface TempleInput {
  destination: string;
  date: string; // ISO format 'YYYY-MM-DD'
  pilgrims: number;
  preferredTimeOfDay?: 'morning' | 'afternoon' | 'evening';
  darshanType?: 'special_entry' | 'general' | 'vip' | 'aarti';
  portalUrl?: string;
}

export interface SlotInfo {
  slotId: string;
  timeWindow: string;
  totalCapacity: number;
  availableSeats: number;
  pricePerPerson: number;
  isSpecialEntry: boolean;
}

export interface CrowdInsight {
  lowCrowdWindow: string;
  crowdLevel: 'low' | 'moderate' | 'high';
  recommendation: string;
  queueEstimateMinutes: number;
  bestSlotId?: string;
}

export interface TempleAvailabilityData {
  destination: string;
  date: string;
  pilgrims: number;
  slots: SlotInfo[];
  crowdInsight: CrowdInsight;
  bookingOpen: boolean;
}
