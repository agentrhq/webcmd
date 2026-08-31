import { access, mkdir, readdir, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { openSitesRepository, type SitesRepository } from './git-store.js';
import { atomicWrite, containedRelativePath, listProductKeys, readProductFile, sitesRoot, writeProductFile } from './local-store.js';
import type { LocalStoreOptions } from './local-store.js';
import type {
  MemoryContext,
  PersistedSeedResult,
  ProductIdentity,
  ProductManifest,
  SeedLookupResult,
} from './model.js';
import { canonicalProductKey, resolveProduct } from './product-resolver.js';
import { createHttpSeedProvider, type GlobalSeedProvider } from './seed-client.js';

export interface MemoryContextInput extends LocalStoreOptions {
  url: string;
  taskId: string;
  seedProvider?: GlobalSeedProvider;
}

export async function getMemoryContext(input: MemoryContextInput): Promise<MemoryContext> {
  const opts: LocalStoreOptions = { homeDir: input.homeDir };
  const taskId = memorySegment(input.taskId);
  const diagnostics: string[] = [];
  const git = await openGit(opts, diagnostics);
  let resolution = resolveProduct(input.url, await loadManifests(opts));
  const legacy = await isLegacySite(resolution.requested.key, opts);
  if (legacy) diagnostics.push('Incompatible beta schema; learning is read-only until this SITE.md is cleared.');

  let persistFailed = false;
  let transient: Extract<SeedLookupResult, { status: 'available' }> | undefined;
  const storedUnattempted = resolution.manifest?.seed.status === 'unattempted';
  if (!legacy && (resolution.status === 'new' || storedUnattempted)) {
    const product = storedUnattempted ? resolution.product : resolution.requested;
    const seed = await (input.seedProvider ?? createHttpSeedProvider()).lookup(product.key);
    if (storedUnattempted && seed.status === 'unattempted') {
      // already recorded; lookup stayed disabled
    } else if (git) {
      try {
        await persistSeed(product, seed, git, opts);
        resolution = resolveProduct(input.url, await loadManifests(opts));
      } catch (err) {
        persistFailed = true;
        diagnostics.push(err instanceof Error ? err.message : String(err));
        if (seed.status === 'available') transient = seed;
      }
    } else if (!git && seed.status === 'available') {
      transient = seed;
    }
  }

  const productKey = resolution.product.key;
  const siteMarkdown = transient?.site ?? await readProductFile(productKey, 'sitemap/SITE.md', opts);
  const references = transient
    ? Object.keys(transient.references ?? {}).sort().map((name) => ({ path: `sitemap/references/${name}` }))
    : await listReferences(productKey, opts);
  const draftPath = join(sitesRoot(opts), '.drafts', taskId, memorySegment(productKey), 'sitemap');
  if (git) await writeDraft(draftPath, productKey, siteMarkdown, references, transient?.references, opts);

  return {
    resolution,
    ...(resolution.manifest ? { manifest: resolution.manifest } : {}),
    revision: git ? await git.revision() : null,
    siteMarkdown,
    references,
    draftPath,
    readOnly: resolution.readOnly || !git || legacy || persistFailed,
    diagnostics,
  };
}

async function persistSeed(
  product: ProductIdentity,
  seed: SeedLookupResult,
  repo: SitesRepository,
  opts: LocalStoreOptions,
): Promise<void> {
  await repo.withRepositoryLock(async () => {
    const existing = parseProductManifest(await readProductFile(product.key, 'manifest.json', opts));
    if (existing && existing.seed.status !== 'unattempted') return;
    if (existing && seed.status === 'unattempted') return;
    const persisted: PersistedSeedResult = seed.status === 'available' ? { status: 'available', revision: seed.revision } : seed;
    const manifest: ProductManifest = existing
      ? { ...existing, seed: persisted }
      : { schemaVersion: 1, product, interfaces: [], seed: persisted };
    const prior = existing ? await readProductFile(product.key, 'manifest.json', opts) : null;
    const files = ['manifest.json'];
    try {
      await writeProductFile(product.key, 'manifest.json', `${JSON.stringify(manifest, null, 2)}\n`, opts);
      if (seed.status === 'available') {
        if (await readProductFile(product.key, 'sitemap/SITE.md', opts) == null) {
          await writeProductFile(product.key, 'sitemap/SITE.md', seed.site, opts);
          files.push('sitemap/SITE.md');
        }
        for (const [name, body] of Object.entries(seed.references ?? {})) {
          const path = `sitemap/references/${name}`;
          if (await readProductFile(product.key, path, opts) == null) {
            await writeProductFile(product.key, path, body, opts);
            files.push(path);
          }
        }
      }
      await repo.commit(
        files.map((file) => `${product.key}/${file}`),
        existing ? `seed ${product.key}` : `initialize ${product.key}`,
      );
    } catch (err) {
      if (prior === null) await Promise.all(files.map((file) => unlinkProductFile(product.key, file, opts)));
      else {
        await writeProductFile(product.key, 'manifest.json', prior, opts);
        await Promise.all(files.filter((file) => file !== 'manifest.json').map((file) => unlinkProductFile(product.key, file, opts)));
      }
      throw err;
    }
  });
}

async function unlinkProductFile(productKey: string, path: string, opts: LocalStoreOptions): Promise<void> {
  const productRoot = join(sitesRoot(opts), productKey);
  const relative = containedRelativePath(productRoot, path);
  try {
    await unlink(join(productRoot, ...relative.split('/')));
  } catch (err) {
    if (!(err instanceof Error) || !('code' in err) || err.code !== 'ENOENT') throw err;
  }
}

async function writeDraft(
  draftPath: string,
  productKey: string,
  siteMarkdown: string | null,
  references: { path: string }[],
  transientRefs: Record<string, string> | undefined,
  opts: LocalStoreOptions,
): Promise<void> {
  await mkdir(draftPath, { recursive: true });
  const draftRoot = join(draftPath, '..');
  if (siteMarkdown != null) await writeContained(draftRoot, 'sitemap/SITE.md', siteMarkdown);
  for (const { path } of references) {
    const body = transientRefs?.[path.slice('sitemap/references/'.length)] ?? await readProductFile(productKey, path, opts);
    if (body != null) await writeContained(draftRoot, path, body);
  }
}

async function writeContained(root: string, path: string, body: string): Promise<void> {
  const relative = containedRelativePath(root, path);
  const target = join(root, ...relative.split('/'));
  try {
    await access(target);
    return;
  } catch (err) {
    if (!(err instanceof Error) || !('code' in err) || err.code !== 'ENOENT') throw err;
  }
  await mkdir(dirname(target), { recursive: true });
  await atomicWrite(target, body);
}

async function loadManifests(opts: LocalStoreOptions): Promise<ProductManifest[]> {
  const manifests: ProductManifest[] = [];
  for (const key of await listProductKeys(opts)) {
    const parsed = parseProductManifest(await readProductFile(key, 'manifest.json', opts));
    if (parsed) manifests.push(parsed);
  }
  return manifests;
}

export function parseProductManifest(raw: string | null): ProductManifest | undefined {
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as unknown;
    return isProductManifest(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function isProductManifest(value: unknown): value is ProductManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.schemaVersion === 1
    && isProductIdentity(candidate.product)
    && Array.isArray(candidate.interfaces)
    && candidate.interfaces.every(isProductIdentity)
    && isPersistedSeed(candidate.seed);
}

function isProductIdentity(value: unknown): value is ProductIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return [candidate.key, candidate.hostname, candidate.displayHostname, candidate.registrableDomain]
    .every((field) => typeof field === 'string' && field.length > 0);
}

function isPersistedSeed(value: unknown): value is PersistedSeedResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.status === 'unattempted' || candidate.status === 'absent' || candidate.status === 'lookup-failed') return true;
  return candidate.status === 'available' && typeof candidate.revision === 'string' && candidate.revision.length > 0;
}

async function isLegacySite(productKey: string, opts: LocalStoreOptions): Promise<boolean> {
  const site = await readProductFile(productKey, 'sitemap/SITE.md', opts);
  if (!site) return false;
  return !parseProductManifest(await readProductFile(productKey, 'manifest.json', opts));
}

async function listReferences(productKey: string, opts: LocalStoreOptions): Promise<{ path: string }[]> {
  try {
    const names = await readdir(join(sitesRoot(opts), productKey, 'sitemap', 'references'));
    return names.filter((name) => name.endsWith('.md')).sort().map((name) => ({ path: `sitemap/references/${name}` }));
  } catch {
    return [];
  }
}

async function openGit(opts: LocalStoreOptions, diagnostics: string[]): Promise<SitesRepository | null> {
  try {
    return await openSitesRepository(opts);
  } catch (err) {
    diagnostics.push(err instanceof Error ? err.message : String(err));
    return null;
  }
}

function memorySegment(value: string): string {
  if (!value || value.includes('/') || value.includes('\\') || value === '.' || value === '..' || value.startsWith('.')) {
    throw new Error(`Invalid site memory path: ${value}`);
  }
  return value;
}
