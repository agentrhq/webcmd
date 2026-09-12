export interface AdapterRunResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export function runWebcmdAdapter(command: string, args?: string[]): Promise<AdapterRunResult>;
