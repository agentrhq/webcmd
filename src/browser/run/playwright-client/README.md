# Playwright QuickJS client

This is the client-only subset of Playwright that runs in Webcmd's QuickJS sandbox. It has no Node APIs and communicates only through injected globals.

## Provenance

- Upstream: `microsoft/playwright` tag `v1.61.1`, commit `39e3553a4f283a41134d75d7e404484bd9e6865a`, Apache-2.0 license.
- Copied upstream paths: `packages/playwright-core/src/client`, `packages/playwright-core/src/protocol/{serializers,validator,validatorPrimitives}.ts`, and `packages/isomorphic`.
- Inspired by dev-browser commit `73fe10f045b9c872f963fe6168de4328857e38cf` (MIT), which established the QuickJS platform seam.

## Local patches

- `bundle-entry.ts` constructs a remote `Connection` with `quickjsPlatform` and sends protocol JSON through `__webcmdTransportSend`.
- `quickjs-platform.ts` replaces filesystem, encoding, artifact, and transport access with injected globals: `__webcmdEncodeBase64`, `__webcmdDecodeBase64`, `__webcmdEncodeText`, `__webcmdDecodeText`, `__webcmdTransportSend`, and `__webcmdWriteArtifact`.
- `vendor/client/stream.ts` is a QuickJS stub; the normal Playwright client object graph stays intact without importing Node streams.
- `vendor/client/artifact.ts` reads artifact protocol streams into `Uint8Array` data and writes only through `__webcmdWriteArtifact`; host paths and server-side `saveAs` are unavailable.
- `vendor/client/elementHandle.ts` accepts only in-memory upload payloads and rejects filesystem paths before attempting any filesystem operation.
- `vendor/protocol/{serializers,validatorPrimitives}.ts` use injected base64 codecs and `Uint8Array` rather than `Buffer`.
- `vendor/client/network.ts` decodes response bodies and post data with the injected UTF-8 codec; `Buffer.prototype.toString('utf8')` is unavailable and `Uint8Array.prototype.toString` would comma-join the bytes.
- `vendor/client/fetch.ts` guards the `URLSearchParams` `instanceof` check behind `globalThis`, decodes `APIResponse.text()` with the injected UTF-8 codec, and treats request/multipart payloads as `Uint8Array`; `URLSearchParams` and `Buffer` are absent from the sandbox.
- `vendor/isomorphic/time.ts` falls back to QuickJS's native `Date` when the browser `performance` global is absent.
- Vendored TypeScript files are marked `@ts-nocheck`: the checked bundle is esbuild's transpiled artifact, while their upstream monorepo type aliases are intentionally not part of Webcmd's host compilation.

Build with `node scripts/build-playwright-sandbox-client.mjs`; CI-style verification is `node scripts/build-playwright-sandbox-client.mjs --check`.
