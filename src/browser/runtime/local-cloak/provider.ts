import type { BrowserRuntimeCommand, BrowserRuntimeResult, BrowserRuntimeStatus } from '../../protocol.js';
import type { BrowserRuntimeProvider, RuntimeStatusOptions } from '../provider.js';
import { dispatchCloakAction, resolveCloakCommandProfileId } from './actions.js';
import type { LaunchPersistentContext } from './session-manager.js';
import { CloakSessionManager } from './session-manager.js';

export interface LocalCloakRuntimeProviderOptions {
  baseDir?: string;
  launchPersistentContext?: LaunchPersistentContext;
}

export class LocalCloakRuntimeProvider implements BrowserRuntimeProvider {
  private readonly manager: CloakSessionManager;

  constructor(private readonly opts: LocalCloakRuntimeProviderOptions = {}) {
    this.manager = new CloakSessionManager(opts);
  }

  async status(_opts: RuntimeStatusOptions = {}): Promise<BrowserRuntimeStatus> {
    const profiles = this.manager.profileStatuses();
    return {
      runtimeConnected: true,
      runtimeName: 'cloak',
      runtimeVersion: undefined,
      profiles,
      pending: 0,
      commandResultUnknown: 0,
    };
  }

  resolveProfileId(command: BrowserRuntimeCommand): string {
    return resolveCloakCommandProfileId(this.manager, command);
  }

  async dispatch(command: BrowserRuntimeCommand): Promise<BrowserRuntimeResult> {
    return dispatchCloakAction(this.manager, command);
  }

  async shutdown(): Promise<void> {
    await this.manager.shutdown();
  }
}
