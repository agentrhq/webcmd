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
    throw new ArgumentError('Download URL path must match the configured execution-artifact download route.');
  }
  const prefix = api.pathname.replace(/\/+$/, '');
  const expected = `${prefix}/v1/executions/`;
  if (!parsed.pathname.startsWith(expected)) {
    throw new ArgumentError('Download URL path must match the configured execution-artifact download route.');
  }
  const rest = parsed.pathname.slice(prefix.length);
  const match = /^\/v1\/executions\/([^/]+)\/artifacts\/([^/]+)$/.exec(rest);
  if (!match) {
    throw new ArgumentError('Download URL path must match the configured execution-artifact download route.');
  }
  let executionId: string;
  let artifactId: string;
  try {
    executionId = decodeURIComponent(match[1]!);
    artifactId = decodeURIComponent(match[2]!);
  } catch {
    throw new ArgumentError('Download URL path must match the configured execution-artifact download route.');
  }
  if (!executionId || !artifactId || executionId.includes('/') || artifactId.includes('/')) {
    throw new ArgumentError('Download URL path must match the configured execution-artifact download route.');
  }
  return { executionId, artifactId };
}
