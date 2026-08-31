import { createHash } from 'node:crypto';

export const WEBCMD_BROWSER_BINARY_PATH_ENV = 'WEBCMD_BROWSER_BINARY_PATH';
export const CLOAKBROWSER_BINARY_PATH_ENV = 'CLOAKBROWSER_BINARY_PATH';

export type BrowserBinaryOverride = {
  path: string;
  envVar: typeof WEBCMD_BROWSER_BINARY_PATH_ENV | typeof CLOAKBROWSER_BINARY_PATH_ENV;
};

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
 * Managed Cloak and its legacy override retain the historical `cloak` path.
 */
export function resolveBrowserProfileNamespace(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const genericPath = env[WEBCMD_BROWSER_BINARY_PATH_ENV]?.trim();
  if (!genericPath) return 'cloak';

  const components = genericPath.split(/[\\/]+/).filter(Boolean);
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
      return safeCustomNamespace(appNamespace, genericPath);
    }
  }

  if (executable && !['chrome', 'chromium'].includes(executable)) {
    return safeCustomNamespace(executable, genericPath);
  }
  return `custom-chromium-${browserPathHash(genericPath)}`;
}

/**
 * Resolve the browser executable selected by the user.
 *
 * The Webcmd-owned name takes precedence. The CloakBrowser-specific name stays
 * supported so existing installations continue to launch the same binary.
 */
export function resolveBrowserBinaryOverride(
  env: NodeJS.ProcessEnv = process.env,
): BrowserBinaryOverride | undefined {
  if (env[WEBCMD_BROWSER_BINARY_PATH_ENV]) {
    return { path: env[WEBCMD_BROWSER_BINARY_PATH_ENV], envVar: WEBCMD_BROWSER_BINARY_PATH_ENV };
  }
  if (env[CLOAKBROWSER_BINARY_PATH_ENV]) {
    return { path: env[CLOAKBROWSER_BINARY_PATH_ENV], envVar: CLOAKBROWSER_BINARY_PATH_ENV };
  }
  return undefined;
}

/**
 * CloakBrowser resolves its managed executable before applying raw Playwright
 * launch options. Mirror Webcmd's generic override into the legacy variable so
 * the wrapper short-circuits that download and platform-resolution path.
 */
export function applyBrowserBinaryOverrideToCloakEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): BrowserBinaryOverride | undefined {
  const override = resolveBrowserBinaryOverride(env);
  if (override?.envVar === WEBCMD_BROWSER_BINARY_PATH_ENV) {
    env[CLOAKBROWSER_BINARY_PATH_ENV] = override.path;
  }
  return override;
}
