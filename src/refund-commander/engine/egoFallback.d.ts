export interface EgoFallbackResult {
  success: boolean;
  repaired?: boolean;
  data?: unknown;
  snapshot?: string;
  error?: string;
}

export function runEgoFallback(targetUrl: string, repairScript: string): Promise<EgoFallbackResult>;
