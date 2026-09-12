export interface RefundCommanderOptions {
  merchant?: string;
  orderId?: string;
  amount?: string;
  reason?: string;
  tier?: string;
  simulateNative?: boolean;
  yes?: boolean;
  autoApprove?: boolean;
  url?: string;
  exitOnComplete?: boolean;
}

export interface RefundCommanderResult {
  approved: boolean;
  dispute: {
    merchant: string;
    orderId: string;
    amount: string;
    reason?: string;
    tier?: string;
    fallbackTriggered?: boolean;
    tokensSaved?: number;
  };
  res: unknown;
}

export function executeRefundCommander(options?: RefundCommanderOptions): Promise<RefundCommanderResult>;
