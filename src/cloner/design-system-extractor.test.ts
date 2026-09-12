import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { extractDesignSystem } from './design-system-extractor.js';

describe('DesignSystemExtractor', () => {
  it('extracts colors, typography and generates design system files', async () => {
    const testDir = path.resolve('./clones/test-design-system');
    await fs.mkdir(testDir, { recursive: true });

    const sampleHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            :root { --primary: #38BDF8; }
            body { background: #0F172A; color: #FFFFFF; font-family: Inter, sans-serif; }
            h1 { font-size: 32px; font-weight: 700; color: #38BDF8; }
            .btn { background: #818CF8; border-radius: 8px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }
          </style>
        </head>
        <body>
          <h1>Title</h1>
          <button class="btn">Click me</button>
        </body>
      </html>
    `;

    await fs.writeFile(path.join(testDir, 'index.html'), sampleHtml, 'utf-8');

    const result = await extractDesignSystem(testDir, 'https://testsite.com');

    expect(result).toBeDefined();
    expect(result.siteName).toBe('Testsite');
    expect(result.colors.length).toBeGreaterThan(0);
    expect(result.files.tokensJson).toBeDefined();
    expect(result.files.agentSkillMd).toBeDefined();

    // Verify tokens.json file exists
    const tokensContent = await fs.readFile(result.files.tokensJson, 'utf-8');
    expect(tokensContent).toContain('Testsite Enterprise Design System');
    expect(result.files.reactComponentsTsx).toBeDefined();

    // Clean up
    await fs.rm(testDir, { recursive: true, force: true });
  });
});
