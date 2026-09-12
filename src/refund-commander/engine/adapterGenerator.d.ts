export interface GenerateAdapterOptions {
  merchant: string;
  targetUrl: string;
  resolvedSelector?: string;
  action?: string;
}

export interface AdapterManifest {
  site: string;
  name: string;
  description: string;
  url: string;
  tier: string;
  selectors: {
    inputAmount: string;
    submitButton: string;
  };
  generatedAt: string;
}

export function generateAdapterFromRepair(options: GenerateAdapterOptions): AdapterManifest;
export function saveGeneratedAdapter(adapterManifest: AdapterManifest, outputDir?: string): string;
