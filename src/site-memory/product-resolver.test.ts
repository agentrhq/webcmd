import { describe, expect, it } from 'vitest';
import type { ProductManifest } from './model.js';
import { canonicalProductKey, resolveProduct } from './product-resolver.js';

const manifest = (url: string, interfaces: string[] = []): ProductManifest => ({
  schemaVersion: 1,
  product: canonicalProductKey(url),
  interfaces: interfaces.map(canonicalProductKey),
  seed: { status: 'unattempted' },
});

describe('product identity resolution', () => {
  it('uses lowercase ASCII IDNA keys while retaining a Unicode display hostname', () => {
    expect(canonicalProductKey('https://BÜCHER.Example/Books')).toEqual({
      key: 'xn--bcher-kva.example',
      hostname: 'xn--bcher-kva.example',
      displayHostname: 'bücher.example',
      registrableDomain: 'xn--bcher-kva.example',
    });
  });

  it.each([
    '',
    '../example.test',
    'example.test/../private',
    'https://127.0.0.1/',
    'https://[::1]/',
    'localhost',
    'https://example.test@evil.test/',
    'https://example.test\\private',
  ])('rejects non-contained host input %j', (input) => {
    expect(() => canonicalProductKey(input)).toThrow(/Invalid product hostname/);
  });

  it('uses an exact product manifest before a parent fallback', () => {
    const resolution = resolveProduct('https://old.reddit.com/r/typescript', [
      manifest('reddit.com'),
      manifest('old.reddit.com'),
    ]);

    expect(resolution).toMatchObject({
      status: 'exact',
      readOnly: false,
      product: { key: 'old.reddit.com' },
    });
  });

  it('returns the registrable-domain product as a read-only provisional fallback', () => {
    const resolution = resolveProduct('https://old.reddit.com/r/typescript', [manifest('reddit.com')]);

    expect(resolution).toMatchObject({
      status: 'provisional-fallback',
      readOnly: true,
      product: { key: 'reddit.com' },
      requested: { key: 'old.reddit.com' },
    });
  });

  it('chooses the nearest existing parent inside the registrable-domain boundary', () => {
    const resolution = resolveProduct('https://admin.eu.example.com/', [
      manifest('example.com'),
      manifest('eu.example.com'),
    ]);

    expect(resolution).toMatchObject({
      status: 'provisional-fallback',
      readOnly: true,
      product: { key: 'eu.example.com' },
      requested: { key: 'admin.eu.example.com' },
    });
  });

  it('does not look beyond the PSL-aware registrable-domain boundary', () => {
    const resolution = resolveProduct('https://news.ycombinator.com/', [manifest('ycombinator.com')]);

    expect(resolution).toMatchObject({
      status: 'provisional-fallback',
      product: { key: 'ycombinator.com' },
      requested: { key: 'news.ycombinator.com', registrableDomain: 'ycombinator.com' },
    });
  });

  it('distinguishes a confirmed interface from a distinct exact product', () => {
    const interfaceResolution = resolveProduct('https://old.reddit.com/', [manifest('reddit.com', ['old.reddit.com'])]);
    const productResolution = resolveProduct('https://news.ycombinator.com/', [
      manifest('ycombinator.com', ['www.ycombinator.com']),
      manifest('news.ycombinator.com'),
    ]);

    expect(interfaceResolution).toMatchObject({
      status: 'confirmed-interface',
      readOnly: false,
      product: { key: 'reddit.com' },
      requested: { key: 'old.reddit.com' },
    });
    expect(productResolution).toMatchObject({
      status: 'exact',
      readOnly: false,
      product: { key: 'news.ycombinator.com' },
    });
  });
});
