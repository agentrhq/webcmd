import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyBrowserBinaryOverrideToCloakEnvironment,
  resolveBrowserProfileNamespace,
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

  it('keeps managed and legacy Cloak binaries in the existing namespace', () => {
    expect(resolveBrowserProfileNamespace({})).toBe('cloak');
    expect(resolveBrowserProfileNamespace({
      CLOAKBROWSER_BINARY_PATH: '/opt/cloak/chrome',
    })).toBe('cloak');
  });

  it('derives stable namespaces for ChromiumFish and Clark Browser', () => {
    expect(resolveBrowserProfileNamespace({
      WEBCMD_BROWSER_BINARY_PATH: '/Users/test/Library/Caches/chromiumfish/151/mac-arm64/ChromiumFish.app/Contents/MacOS/ChromiumFish',
    })).toBe('chromiumfish');
    expect(resolveBrowserProfileNamespace({
      WEBCMD_BROWSER_BINARY_PATH: '/Users/test/.clarkbrowser/chromium-148/Chromium.app/Contents/MacOS/Chromium',
    })).toBe('clark');
  });

  it('uses a named app bundle for other custom Chromium builds', () => {
    expect(resolveBrowserProfileNamespace({
      WEBCMD_BROWSER_BINARY_PATH: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    })).toBe('brave');
  });

  it('does not classify browsers from unrelated path substrings', () => {
    expect(resolveBrowserProfileNamespace({
      WEBCMD_BROWSER_BINARY_PATH: '/Users/clarkkent/tools/chrome',
    })).toMatch(/^custom-chromium-[a-f0-9]{8}$/);
  });

  it('keeps unknown custom binaries separate with deterministic namespaces', () => {
    const first = resolveBrowserProfileNamespace({
      WEBCMD_BROWSER_BINARY_PATH: '/opt/fork-one/chrome',
    });
    const second = resolveBrowserProfileNamespace({
      WEBCMD_BROWSER_BINARY_PATH: '/opt/fork-two/chrome',
    });

    expect(first).toMatch(/^custom-chromium-[a-f0-9]{8}$/);
    expect(second).toMatch(/^custom-chromium-[a-f0-9]{8}$/);
    expect(first).not.toBe(second);
    expect(resolveBrowserProfileNamespace({
      WEBCMD_BROWSER_BINARY_PATH: '/opt/fork-one/chrome',
    })).toBe(first);
  });

  it('never lets a custom binary reuse the reserved managed Cloak namespace', () => {
    expect(resolveBrowserProfileNamespace({
      WEBCMD_BROWSER_BINARY_PATH: '/Applications/Cloak.app/Contents/MacOS/Cloak',
    })).toMatch(/^custom-cloak-[a-f0-9]{8}$/);
  });
});
