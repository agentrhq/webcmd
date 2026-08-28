export const WEBCMD_BROWSER_BINARY_PATH_ENV = 'WEBCMD_BROWSER_BINARY_PATH';
export const CLOAKBROWSER_BINARY_PATH_ENV = 'CLOAKBROWSER_BINARY_PATH';

export type BrowserBinaryOverride = {
  path: string;
  envVar: typeof WEBCMD_BROWSER_BINARY_PATH_ENV | typeof CLOAKBROWSER_BINARY_PATH_ENV;
};

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
