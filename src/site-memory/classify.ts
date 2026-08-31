import { parseProductManifest } from './context.js';
import { openSitesRepository } from './git-store.js';
import { deleteProductFile, listProductKeys, readProductFile, writeProductFile, type LocalStoreOptions } from './local-store.js';
import type {
  ClassifyDecision,
  ClassifyResult,
  MemoryRevision,
  ProductIdentity,
  ProductManifest,
} from './model.js';
import { canonicalProductKey, resolveProduct } from './product-resolver.js';

export interface ClassifyInput extends LocalStoreOptions {
  requested: string;
  decision: ClassifyDecision;
  parent?: string;
  expectedRevision: MemoryRevision | null;
}

export async function classifyProduct(input: ClassifyInput): Promise<ClassifyResult> {
  const requested = canonicalProductKey(input.requested);
  if (input.decision === 'same-product' && !input.parent) {
    throw new Error('same-product classification requires --same-product <parent>.');
  }
  const parent = input.parent ? canonicalProductKey(input.parent) : undefined;
  const repo = await openSitesRepository(input);

  return repo.withRepositoryLock(async () => {
    const actual = await repo.revision();
    if (actual !== input.expectedRevision) {
      return { status: 'conflict', expectedRevision: input.expectedRevision, actualRevision: actual };
    }
    const manifests = await loadManifests(input);
    const resolution = resolveProduct(requested.key, manifests);
    if (input.decision === 'same-product') {
      return classifySameProduct(requested, parent!, resolution, actual, repo, input);
    }
    return classifyDistinct(requested, resolution, actual, repo, input);
  });
}

async function classifySameProduct(
  requested: ProductIdentity,
  parent: ProductIdentity,
  resolution: ReturnType<typeof resolveProduct>,
  actual: MemoryRevision | null,
  repo: Awaited<ReturnType<typeof openSitesRepository>>,
  opts: LocalStoreOptions,
): Promise<ClassifyResult> {
  if (requested.key === parent.key) throw new Error('A product cannot be classified as an interface of itself.');
  if (!resolution.manifest || resolution.product.key !== parent.key) {
    throw new Error(`--same-product must be the provisional parent (got ${resolution.product.key}).`);
  }
  if (resolution.status === 'exact') {
    throw new Error('Host is already a distinct product.');
  }
  if (resolution.status !== 'provisional-fallback' && resolution.status !== 'confirmed-interface') {
    throw new Error('Host is not a fallback or confirmed interface of that parent.');
  }
  const manifest = resolution.manifest;
  if (manifest.interfaces.some((row) => row.key === requested.key)) {
    if (!actual) throw new Error('Refusing to classify without a memory revision.');
    return classified('same-product', requested, parent, true, actual);
  }
  const prior = await readProductFile(parent.key, 'manifest.json', opts);
  const next: ProductManifest = { ...manifest, interfaces: [...manifest.interfaces, requested] };
  try {
    await writeProductFile(parent.key, 'manifest.json', `${JSON.stringify(next, null, 2)}\n`, opts);
    const revision = await repo.commit([`${parent.key}/manifest.json`], `classify ${requested.key} same-product ${parent.key}`);
    return classified('same-product', requested, parent, false, revision);
  } catch (err) {
    try {
      if (prior === null) await deleteProductFile(parent.key, 'manifest.json', opts);
      else await writeProductFile(parent.key, 'manifest.json', prior, opts);
    } catch (cleanupErr) {
      throw new AggregateError([err, cleanupErr], 'Classification failed and rollback also failed');
    }
    throw err;
  }
}

async function classifyDistinct(
  requested: ProductIdentity,
  resolution: ReturnType<typeof resolveProduct>,
  actual: MemoryRevision | null,
  repo: Awaited<ReturnType<typeof openSitesRepository>>,
  opts: LocalStoreOptions,
): Promise<ClassifyResult> {
  if (resolution.status === 'confirmed-interface') {
    throw new Error(`Host is already an interface of ${resolution.product.key}.`);
  }
  if (resolution.status === 'exact' && resolution.manifest) {
    if (!actual) throw new Error('Refusing to classify without a memory revision.');
    return classified('distinct', requested, requested, true, actual);
  }
  const prior = await readProductFile(requested.key, 'manifest.json', opts);
  if (await readProductFile(requested.key, 'sitemap/SITE.md', opts) && !parseProductManifest(prior)) {
    throw new Error('Incompatible beta schema; learning is read-only until this SITE.md is cleared.');
  }
  const manifest: ProductManifest = {
    schemaVersion: 1,
    product: requested,
    interfaces: [],
    seed: { status: 'unattempted' },
  };
  try {
    await writeProductFile(requested.key, 'manifest.json', `${JSON.stringify(manifest, null, 2)}\n`, opts);
    const revision = await repo.commit([`${requested.key}/manifest.json`], `classify ${requested.key} distinct`);
    return classified('distinct', requested, requested, false, revision);
  } catch (err) {
    try {
      if (prior === null) await deleteProductFile(requested.key, 'manifest.json', opts);
      else await writeProductFile(requested.key, 'manifest.json', prior, opts);
    } catch (cleanupErr) {
      throw new AggregateError([err, cleanupErr], 'Classification failed and rollback also failed');
    }
    throw err;
  }
}

function classified(
  decision: ClassifyDecision,
  requested: ProductIdentity,
  product: ProductIdentity,
  existing: boolean,
  revision: MemoryRevision,
): ClassifyResult {
  return { status: 'classified', decision, requested, product, existing, revision };
}

async function loadManifests(opts: LocalStoreOptions): Promise<ProductManifest[]> {
  const manifests: ProductManifest[] = [];
  for (const key of await listProductKeys(opts)) {
    const parsed = parseProductManifest(await readProductFile(key, 'manifest.json', opts));
    if (parsed) manifests.push(parsed);
  }
  return manifests;
}
