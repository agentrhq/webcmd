import { afterEach, describe, expect, it, vi } from 'vitest';
import * as browserBinary from './browser-binary.js';

describe('browser binary configuration', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('uses explicit paths for custom namespaces and never reads the retired Webcmd environment variable', () => {
    vi.stubEnv('WEBCMD_BROWSER_BINARY_PATH', '/Applications/Ignored Browser.app/Contents/MacOS/Ignored Browser');
    expect(browserBinary.resolveBrowserProfileNamespace('/Users/test/Library/Caches/chromiumfish/151/mac-arm64/ChromiumFish.app/Contents/MacOS/ChromiumFish'))
      .toBe('chromiumfish');
    expect(browserBinary.resolveBrowserProfileNamespace('/Users/test/.clarkbrowser/chromium-148/Chromium.app/Contents/MacOS/Chromium'))
      .toBe('clark');
    expect(browserBinary.resolveBrowserProfileNamespace('/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'))
      .toBe('brave');
    expect(browserBinary.resolveBrowserProfileNamespace('/opt/fork-one/chrome'))
      .toMatch(/^custom-chromium-[a-f0-9]{8}$/);
  });

  it('sets the legacy Cloak executable only from persisted configuration and clears it for managed Cloak', () => {
    const configure = (browserBinary as typeof browserBinary & {
      configureCloakBrowserBinary?: (executablePath: string | undefined, env: NodeJS.ProcessEnv) => void;
    }).configureCloakBrowserBinary;
    expect(configure).toBeTypeOf('function');
    const env = {
      WEBCMD_BROWSER_BINARY_PATH: '/opt/ignored/chrome',
      CLOAKBROWSER_BINARY_PATH: '/opt/inherited/cloak',
    } as NodeJS.ProcessEnv;

    configure?.('/opt/configured/chrome', env);
    expect(env.CLOAKBROWSER_BINARY_PATH).toBe('/opt/configured/chrome');

    configure?.(undefined, env);
    expect(env.CLOAKBROWSER_BINARY_PATH).toBeUndefined();
  });

  it('keeps unknown custom binaries separate with deterministic namespaces', () => {
    const first = browserBinary.resolveBrowserProfileNamespace('/opt/fork-one/chrome');
    const second = browserBinary.resolveBrowserProfileNamespace('/opt/fork-two/chrome');

    expect(first).toMatch(/^custom-chromium-[a-f0-9]{8}$/);
    expect(second).toMatch(/^custom-chromium-[a-f0-9]{8}$/);
    expect(first).not.toBe(second);
    expect(browserBinary.resolveBrowserProfileNamespace('/opt/fork-one/chrome')).toBe(first);
  });

  it('never lets a custom binary reuse the reserved managed Cloak namespace', () => {
    expect(browserBinary.resolveBrowserProfileNamespace('/Applications/Cloak.app/Contents/MacOS/Cloak'))
      .toMatch(/^custom-cloak-[a-f0-9]{8}$/);
  });
});
