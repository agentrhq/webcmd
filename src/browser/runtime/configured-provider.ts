import type { LocalWebcmdConfig } from '../../hosted/config.js';
import { configureCloakBrowserBinary, resolveBrowserProfileNamespace } from '../browser-binary.js';
import { LocalCloakRuntimeProvider } from './local-cloak/provider.js';
import { LocalSlabRuntimeProvider } from './local-slab/provider.js';
import type { BrowserRuntimeProvider } from './provider.js';

export function createConfiguredLocalBrowserRuntimeProvider(
  config?: LocalWebcmdConfig,
): BrowserRuntimeProvider {
  const browser = config?.browser ?? { kind: 'cloak' };
  if (browser.kind === 'slab') return new LocalSlabRuntimeProvider();

  const executablePath = browser.kind === 'custom' || browser.kind === 'chrome'
    ? browser.executablePath
    : undefined;
  configureCloakBrowserBinary(executablePath);
  return new LocalCloakRuntimeProvider({
    executablePath,
    profileNamespace: browser.kind === 'chrome' ? 'chrome' : resolveBrowserProfileNamespace(executablePath),
    runtimeName: browser.kind,
  });
}
