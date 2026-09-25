import { createHash } from 'node:crypto';

export const CLOAKBROWSER_BINARY_PATH_ENV = 'CLOAKBROWSER_BINARY_PATH';

function normalizeBrowserNamespace(value: string): string {
  return value
    .replace(/\.app$/i, '')
    .replace(/[._\s]+/g, '-')
    .replace(/-?browser$/i, '')
    .replace(/[^a-zA-Z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function browserPathHash(binaryPath: string): string {
  return createHash('sha256').update(binaryPath).digest('hex').slice(0, 8);
}

function safeCustomNamespace(candidate: string, binaryPath: string): string {
  return candidate === 'cloak'
    ? `custom-cloak-${browserPathHash(binaryPath)}`
    : candidate;
}

/**
 * Select the on-disk namespace that owns local Chromium profile data.
 * Managed Cloak retains the historical `cloak` path.
 */
export function resolveBrowserProfileNamespace(
  executablePath?: string,
): string {
  const binaryPath = executablePath?.trim();
  if (!binaryPath) return 'cloak';

  const components = binaryPath.split(/[\\/]+/).filter(Boolean);
  const appBundle = [...components].reverse().find(component => /\.app$/i.test(component));
  const executable = normalizeBrowserNamespace(components.at(-1) ?? '');
  const appNamespace = normalizeBrowserNamespace(appBundle ?? '');
  if (appNamespace === 'chromiumfish' || executable === 'chromiumfish') return 'chromiumfish';
  if (
    appNamespace === 'clark'
    || executable === 'clark'
    || components.some(component => component.toLowerCase() === '.clarkbrowser')
  ) return 'clark';

  if (appBundle) {
    if (appNamespace && appNamespace !== 'chromium') {
      return safeCustomNamespace(appNamespace, binaryPath);
    }
  }

  if (executable && !['chrome', 'chromium'].includes(executable)) {
    return safeCustomNamespace(executable, binaryPath);
  }
  return `custom-chromium-${browserPathHash(binaryPath)}`;
}

export function configureCloakBrowserBinary(
  executablePath: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (executablePath) env[CLOAKBROWSER_BINARY_PATH_ENV] = executablePath;
  else delete env[CLOAKBROWSER_BINARY_PATH_ENV];
}
