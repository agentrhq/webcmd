import { ArgumentError } from '../errors.js';

export function parseExecutionArtifactDownloadUrl(
  downloadUrl: string,
  apiBaseUrl: string,
): { executionId: string; artifactId: string } {
  let parsed: URL;
  let api: URL;
  try {
    parsed = new URL(downloadUrl);
    api = new URL(apiBaseUrl);
  } catch {
    throw new ArgumentError('Download URL is not a valid absolute URL.');
  }
  if (parsed.username || parsed.password) {
    throw new ArgumentError('Download URL origin must exactly match the configured Webcmd Cloud API.');
  }
  if (parsed.origin !== api.origin) {
    throw new ArgumentError('Download URL origin must exactly match the configured Webcmd Cloud API.');
  }
  if (parsed.search || parsed.hash) {
    throw new ArgumentError('Download URL path must match /v1/executions/<execution-id>/artifacts/<artifact-id>.');
  }
  const match = /^\/v1\/executions\/([^/]+)\/artifacts\/([^/]+)$/.exec(parsed.pathname);
  if (!match) {
    throw new ArgumentError('Download URL path must match /v1/executions/<execution-id>/artifacts/<artifact-id>.');
  }
  const executionId = decodeURIComponent(match[1]!);
  const artifactId = decodeURIComponent(match[2]!);
  if (!executionId || !artifactId || executionId.includes('/') || artifactId.includes('/')) {
    throw new ArgumentError('Download URL path must match /v1/executions/<execution-id>/artifacts/<artifact-id>.');
  }
  return { executionId, artifactId };
}
