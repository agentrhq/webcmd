import { verify } from 'node:crypto';

// Trust anchor for the signed SLAB release manifest. Left `undefined` so
// verification is fail-closed until a real production key is set: the installer
// refuses any manifest until this holds the operator's own Ed25519 public key.
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
