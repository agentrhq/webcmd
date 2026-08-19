import { verify } from 'node:crypto';

export const SLAB_RELEASE_PUBLIC_KEY: string | undefined = undefined;

export interface SlabReleaseManifest {
  url: string;
  sha256: string;
  signature: string;
}

export function verifySlabReleaseManifest(manifest: SlabReleaseManifest): boolean {
  if (!SLAB_RELEASE_PUBLIC_KEY) return false;
  return verify(
    null,
    Buffer.from(`${manifest.url}\n${manifest.sha256}`),
    SLAB_RELEASE_PUBLIC_KEY,
    Buffer.from(manifest.signature, 'base64'),
  );
}
