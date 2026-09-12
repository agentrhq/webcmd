import { describe, it, expect } from 'vitest';
import { WebsiteCloner } from './cloner.js';

describe('WebsiteCloner', () => {
  it('instantiates correctly with options', () => {
    const cloner = new WebsiteCloner({
      url: 'https://example.com',
      outputDir: './clones/example',
    });
    expect(cloner).toBeDefined();
  });

  it('correctly registers and categorizes assets', () => {
    const cloner = new WebsiteCloner({
      url: 'https://example.com',
      outputDir: './clones/example',
    });

    const cssAsset = cloner.registerAsset(
      'https://example.com/style.css',
      Buffer.from('body { color: red; }'),
      'text/css'
    );
    expect(cssAsset.category).toBe('css');
    expect(cssAsset.relativePath).toContain('assets/css/');

    const imgAsset = cloner.registerAsset(
      'https://example.com/logo.png',
      Buffer.from('fake-png'),
      'image/png'
    );
    expect(imgAsset.category).toBe('images');
    expect(imgAsset.relativePath).toContain('assets/images/');
  });

  it('rewrites html links using JSDOM', async () => {
    const cloner = new WebsiteCloner({
      url: 'https://example.com',
      outputDir: './clones/example',
    });

    cloner.registerAsset(
      'https://example.com/main.css',
      Buffer.from('h1 { font-size: 20px; }'),
      'text/css'
    );

    const rawHtml = `<!DOCTYPE html><html><head><link rel="stylesheet" href="main.css"></head><body><img src="logo.png"></body></html>`;
    const rewritten = await cloner.rewriteDom(rawHtml, 'https://example.com');

    expect(rewritten).toContain('assets/css/');
  });
});
