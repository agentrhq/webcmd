import { verify } from 'node:crypto';

// Trust anchor for the signed SLAB release manifest. This public key is safe to
// embed; the matching private key stays in the official release environment.
export const SLAB_RELEASE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAoMo7Cbb1CRk2csqvdxMrR3SLBhQ9a8RHeDTRnChTeSQ=
-----END PUBLIC KEY-----
`;

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
