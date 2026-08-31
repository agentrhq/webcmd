import { isIP } from 'node:net';
import { domainToUnicode } from 'node:url';
import { getDomain } from 'tldts';
import type { ProductIdentity, ProductManifest, ProductResolution } from './model.js';

export function canonicalProductKey(urlOrHost: string): ProductIdentity {
  const value = urlOrHost.trim();
  if (!value || value.includes('\\')) throw invalidHost(urlOrHost);

  const url = parseUrlOrHost(value);
  if (url.username || url.password || !['http:', 'https:'].includes(url.protocol)) throw invalidHost(urlOrHost);

  const hostname = url.hostname.toLowerCase();
  const labels = hostname.split('.');
  if (!hostname || isIP(hostname.replace(/^\[|\]$/g, '')) || labels.some((label) => !label || label === '.' || label === '..')) {
    throw invalidHost(urlOrHost);
  }

  const registrableDomain = getDomain(hostname, { allowPrivateDomains: true });
  if (!registrableDomain) throw invalidHost(urlOrHost);

  return {
    key: hostname,
    hostname,
    displayHostname: domainToUnicode(hostname) || hostname,
    registrableDomain,
  };
}

export function resolveProduct(url: string, manifests: ProductManifest[]): ProductResolution {
  const requested = canonicalProductKey(url);
  const exact = manifests.find((manifest) => manifest.product.key === requested.key);
  if (exact) return resolved('exact', requested, exact.product, exact, false);

  const interfaceManifest = manifests.find((manifest) => manifest.interfaces.some(({ key }) => key === requested.key));
  if (interfaceManifest) return resolved('confirmed-interface', requested, interfaceManifest.product, interfaceManifest, false);

  const parent = requested.key === requested.registrableDomain
    ? undefined
    : manifests.find((manifest) => manifest.product.key === requested.registrableDomain);
  if (parent) return resolved('provisional-fallback', requested, parent.product, parent, true);

  return resolved('new', requested, requested, undefined, false);
}

function parseUrlOrHost(value: string): URL {
  try {
    if (value.includes('://')) return new URL(value);
    if (value.includes('/') || value.includes('..')) throw invalidHost(value);
    return new URL(`https://${value}`);
  } catch {
    throw invalidHost(value);
  }
}

function invalidHost(value: string): Error {
  return new Error(`Invalid product hostname: ${value}`);
}

function resolved(
  status: ProductResolution['status'],
  requested: ProductIdentity,
  product: ProductIdentity,
  manifest: ProductManifest | undefined,
  readOnly: boolean,
): ProductResolution {
  return { status, requested, product, ...(manifest ? { manifest } : {}), readOnly };
}
