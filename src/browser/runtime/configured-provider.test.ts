import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeLocalConfig } from '../../hosted/config.js';
import { LocalCloakRuntimeProvider } from './local-cloak/provider.js';
import { LocalSlabRuntimeProvider } from './local-slab/provider.js';
import { createConfiguredLocalBrowserRuntimeProvider } from './configured-provider.js';

describe('configured local browser provider', () => {
  afterEach(() => {
    vi.doUnmock('./local-cloak/provider.js');
    vi.doUnmock('./local-slab/provider.js');
    vi.resetModules();
  });

  it('selects Cloak or custom Cloak directly, and selects SLAB directly', async () => {
    const cloak = createConfiguredLocalBrowserRuntimeProvider(makeLocalConfig(new Date(0), { kind: 'cloak' }));
    const custom = createConfiguredLocalBrowserRuntimeProvider(makeLocalConfig(new Date(0), {
      kind: 'custom', executablePath: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    }));
    const slab = createConfiguredLocalBrowserRuntimeProvider(makeLocalConfig(new Date(0), { kind: 'slab' }));

    expect(cloak).toBeInstanceOf(LocalCloakRuntimeProvider);
    expect(custom).toBeInstanceOf(LocalCloakRuntimeProvider);
    expect(await custom.status()).toMatchObject({ runtimeName: 'custom' });
    expect(process.env.CLOAKBROWSER_BINARY_PATH).toBe('/Applications/Brave Browser.app/Contents/MacOS/Brave Browser');
    expect(slab).toBeInstanceOf(LocalSlabRuntimeProvider);
  });

  it('passes the persisted custom path and canonical namespace to Cloak', async () => {
    const LocalCloakRuntimeProvider = vi.fn();
    vi.doMock('./local-cloak/provider.js', () => ({ LocalCloakRuntimeProvider }));
    const { createConfiguredLocalBrowserRuntimeProvider: createProvider } = await import('./configured-provider.js');
    const executablePath = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';

    createProvider(makeLocalConfig(new Date(0), { kind: 'custom', executablePath }));

    expect(LocalCloakRuntimeProvider).toHaveBeenCalledWith({
      executablePath,
      profileNamespace: 'brave',
      runtimeName: 'custom',
    });
  });

  it('runs configured Google Chrome with the stable chrome profile namespace', async () => {
    const LocalCloakRuntimeProvider = vi.fn();
    vi.doMock('./local-cloak/provider.js', () => ({ LocalCloakRuntimeProvider }));
    const { createConfiguredLocalBrowserRuntimeProvider: createProvider } = await import('./configured-provider.js');
    const executablePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

    createProvider(makeLocalConfig(new Date(0), { kind: 'chrome', executablePath }));

    expect(LocalCloakRuntimeProvider).toHaveBeenCalledWith({
      executablePath,
      profileNamespace: 'chrome',
      runtimeName: 'chrome',
    });
  });

  it('does not fall back to Cloak when SLAB construction fails', async () => {
    const cloak = vi.fn();
    const failure = new Error('SLAB startup failed');
    vi.doMock('./local-cloak/provider.js', () => ({ LocalCloakRuntimeProvider: cloak }));
    vi.doMock('./local-slab/provider.js', () => ({
      LocalSlabRuntimeProvider: class {
        constructor() {
          throw failure;
        }
      },
    }));
    const { createConfiguredLocalBrowserRuntimeProvider: createProvider } = await import('./configured-provider.js');

    expect(() => createProvider(makeLocalConfig(new Date(0), { kind: 'slab' }))).toThrow(failure);
    expect(cloak).not.toHaveBeenCalled();
  });
});
