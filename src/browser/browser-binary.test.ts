import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyBrowserBinaryOverrideToCloakEnvironment,
  resolveBrowserBinaryOverride,
} from './browser-binary.js';

describe('browser binary override', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('prefers the Webcmd-owned variable over the legacy CloakBrowser variable', () => {
    expect(resolveBrowserBinaryOverride({
      WEBCMD_BROWSER_BINARY_PATH: '/opt/chromium-fork/chrome',
      CLOAKBROWSER_BINARY_PATH: '/opt/cloak/chrome',
    })).toEqual({
      path: '/opt/chromium-fork/chrome',
      envVar: 'WEBCMD_BROWSER_BINARY_PATH',
    });
  });

  it('mirrors the generic override so CloakBrowser skips managed resolution', () => {
    const env = {
      WEBCMD_BROWSER_BINARY_PATH: '/opt/chromium-fork/chrome',
      CLOAKBROWSER_BINARY_PATH: '/opt/cloak/chrome',
    };

    applyBrowserBinaryOverrideToCloakEnvironment(env);

    expect(env.CLOAKBROWSER_BINARY_PATH).toBe('/opt/chromium-fork/chrome');
  });

  it('leaves the environment unchanged when only the legacy variable is set', () => {
    const env = { CLOAKBROWSER_BINARY_PATH: '/opt/cloak/chrome' };

    applyBrowserBinaryOverrideToCloakEnvironment(env);

    expect(env).toEqual({ CLOAKBROWSER_BINARY_PATH: '/opt/cloak/chrome' });
  });
});
