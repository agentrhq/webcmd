import type { BrowserRuntimeCommand, BrowserRuntimeResult, BrowserRuntimeStatus } from '../../protocol.js';
import type { BrowserRuntimeProvider, RuntimeStatusOptions } from '../provider.js';
import { LocalBrowserSessionStore, type BrowserSessionListRow, type BrowserSessionRecord } from '../../sessions.js';
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
  private readonly sessions: LocalBrowserSessionStore;
  private readonly sessionQueues = new Map<string, Promise<void>>();

  constructor(private readonly opts: LocalCloakRuntimeProviderOptions = {}) {
    this.manager = new CloakSessionManager(opts);
    this.sessions = new LocalBrowserSessionStore({ baseDir: opts.baseDir });
  }

  async status(opts: RuntimeStatusOptions = {}): Promise<BrowserRuntimeStatus> {
    const profiles = this.manager.profileStatuses();
    return {
      runtimeConnected: true,
      runtimeName: 'cloak',
      runtimeVersion: resolveCloakBrowserVersion(),
      profiles,
      pending: 0,
      commandResultUnknown: 0,
      sessions: await this.listSessions({ profileId: opts.contextId }),
    };
  }

  resolveProfileId(command: BrowserRuntimeCommand): string {
    return resolveCloakCommandProfileId(this.manager, command);
  }

  async createSession(command: BrowserRuntimeCommand): Promise<BrowserSessionRecord> {
    return this.sessions.create(this.resolveProfileId(command));
  }

  async requireSession(command: BrowserRuntimeCommand): Promise<BrowserSessionRecord> {
    return this.sessions.require(this.resolveProfileId(command), command.session);
  }

  async resolveAdapterDefault(command: BrowserRuntimeCommand): Promise<BrowserSessionRecord> {
    return this.sessions.resolveAdapterDefault(this.resolveProfileId(command));
  }

  async listSessions(input: { profileId?: string }): Promise<BrowserSessionListRow[]> {
    return this.sessions.list(input.profileId).map((session) => ({
      ...session,
      runtimeState: this.manager.hasSession(session.profileId, session.id) ? 'active' : 'idle',
    }));
  }

  async closeSession(command: BrowserRuntimeCommand): Promise<{ closed: boolean; alreadyIdle: boolean; session: string }> {
    const record = this.sessions.require(this.resolveProfileId(command), command.session);
    const closedCount = await this.manager.closeSession(record.profileId, record.id);
    this.sessions.touch(record.profileId, record.id);
    return { closed: closedCount > 0, alreadyIdle: closedCount === 0, session: record.id };
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
