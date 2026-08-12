import type { BrowserRuntimeCommand, BrowserRuntimeResult, BrowserRuntimeStatus } from '../../protocol.js';
import type { BrowserRuntimeProvider, RuntimeStatusOptions } from '../provider.js';
import { dispatchCloakAction, resolveCloakCommandProfileId } from './actions.js';
import type { LaunchPersistentContext } from './session-manager.js';
import {
  CloakSessionManager,
  resolveCloakBrowserVersion,
} from './session-manager.js';

export interface LocalCloakRuntimeProviderOptions {
  baseDir?: string;
  launchPersistentContext?: LaunchPersistentContext;
}

export class LocalCloakRuntimeProvider implements BrowserRuntimeProvider {
  private readonly manager: CloakSessionManager;
  private readonly sessionQueues = new Map<string, Promise<void>>();

  constructor(private readonly opts: LocalCloakRuntimeProviderOptions = {}) {
    this.manager = new CloakSessionManager(opts);
  }

  async status(_opts: RuntimeStatusOptions = {}): Promise<BrowserRuntimeStatus> {
    const profiles = this.manager.profileStatuses();
    return {
      runtimeConnected: true,
      runtimeName: 'cloak',
      runtimeVersion: resolveCloakBrowserVersion(),
      profiles,
      pending: 0,
      commandResultUnknown: 0,
    };
  }

  resolveProfileId(command: BrowserRuntimeCommand): string {
    return resolveCloakCommandProfileId(this.manager, command);
  }

  async dispatch(command: BrowserRuntimeCommand): Promise<BrowserRuntimeResult> {
    const key = this.commandQueueKey(command);
    const previous = this.sessionQueues.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.sessionQueues.set(key, current);

    await previous.catch(() => {});
    try {
      return await dispatchCloakAction(this.manager, command);
    } finally {
      release();
      if (this.sessionQueues.get(key) === current) {
        this.sessionQueues.delete(key);
      }
    }
  }

  async shutdown(): Promise<void> {
    await this.manager.shutdown();
  }

  private commandQueueKey(command: BrowserRuntimeCommand): string {
    if (command.page) {
      const profileId = this.manager.profileIdForPage(command.page);
      if (profileId) return `profile\u0000${profileId}`;
    }

    let profileId: string;
    try {
      profileId = this.resolveProfileId(command);
    } catch {
      profileId = command.profileId
        ?? command.contextId
        ?? command.preferredContextId
        ?? 'default';
    }
    return `profile\u0000${profileId.trim() || 'default'}`;
  }
}
