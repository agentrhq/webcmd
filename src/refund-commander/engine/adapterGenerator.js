import fs from 'node:fs';
import path from 'node:path';

/**
 * Adapter & Plugin Generator for healed selectors.
 * Generates deterministic webcmd adapter definitions from Ego-Lite repaired DOM snapshots.
 */
export function generateAdapterFromRepair({ merchant, targetUrl, resolvedSelector, action = 'refund-claim' }) {
  const adapterManifest = {
    site: merchant.toLowerCase(),
    name: action,
    description: `Automated dispute resolution adapter for ${merchant}`,
    url: targetUrl,
    tier: 'hybrid-ego-healed',
    selectors: {
      inputAmount: resolvedSelector || '#refund-amount',
      submitButton: '#submit-dispute'
    },
    generatedAt: new Date().toISOString()
  };

  return adapterManifest;
}

export function saveGeneratedAdapter(adapterManifest, outputDir = './clis') {
  const filePath = path.join(outputDir, `${adapterManifest.site}-${adapterManifest.name}.json`);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(adapterManifest, null, 2), 'utf8');
  return filePath;
}
