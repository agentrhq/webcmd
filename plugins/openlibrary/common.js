import { ArgumentError, CommandExecutionError } from '@agentrhq/webcmd/errors';

export const HOST = 'openlibrary.org';
export const BASE_URL = `https://${HOST}`;
export const MAX_LIMIT = 100;

export function requiredText(raw, label) {
  const value = String(raw ?? '').trim();
  if (!value) throw new ArgumentError(`${label} is required`);
  return value;
}

export function parseLimit(raw, fallback = 20) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > MAX_LIMIT) {
    throw new ArgumentError(`--limit must be an integer between 1 and ${MAX_LIMIT}`);
  }
  return value;
}

export function parseOffset(raw) {
  if (raw === undefined || raw === null || raw === '') return 0;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 10000) {
    throw new ArgumentError('--offset must be an integer between 0 and 10000');
  }
  return value;
}

export function workIdFromKey(key) {
  return String(key ?? '').replace(/^\/works\//, '');
}

export function workUrl(key) {
  const id = workIdFromKey(key);
  return id ? `${BASE_URL}/works/${encodeURIComponent(id)}` : null;
}

export function coverUrl(coverId, size = 'M') {
  return Number.isInteger(coverId) ? `https://covers.openlibrary.org/b/id/${coverId}-${size}.jpg` : null;
}

export async function getJson(url, command) {
  let response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'Webcmd Open Library plugin' },
    });
  } catch (error) {
    throw new CommandExecutionError(`${command} request failed: ${error.message}`);
  }
  if (!response.ok) {
    throw new CommandExecutionError(`${command} request failed: HTTP ${response.status}`);
  }
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('json')) {
    throw new CommandExecutionError(`${command} returned an unexpected non-JSON response`);
  }
  try {
    return await response.json();
  } catch {
    throw new CommandExecutionError(`${command} returned invalid JSON`);
  }
}
