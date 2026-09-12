import React from 'react';

export interface DashboardProps {
  dispute?: {
    merchant?: string;
    orderId?: string;
    amount?: string;
    reason?: string;
    tokensSaved?: number;
    tier?: string;
    status?: string;
    fallbackTriggered?: boolean;
    autoApprove?: boolean;
  };
  onApprove?: () => void;
  onReject?: () => void;
}

export const Dashboard: React.FC<DashboardProps>;
