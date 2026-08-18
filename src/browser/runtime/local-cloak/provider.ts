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
  launchBackgroundPersistentContext?: LaunchPersistentContext;
}

export class LocalCloakRuntimeProvider implements BrowserRuntimeProvider {
  private readonly manager: CloakSessionManager;
  private readonly sessions: LocalBrowserSessionStore;
  private readonly sessionQueues = new Map<string, Promise<void>>();

  constructor(private readonly opts: LocalCloakRuntimeProviderOptions = {}) {
    this.sessions = new LocalBrowserSessionStore({
      baseDir: opts.baseDir,
      isActive: session => this.manager?.hasSession(session.profileId, session.id) ?? false,
    });
    this.manager = new CloakSessionManager({
      ...opts,
      hasActiveHandoff: profileId => this.sessions.list(profileId, 100).some(session => (
        Boolean(session.handoff) && Date.parse(session.handoff!.expiresAt) > Date.now()
      )),
    });
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
    return this.sessions.create(this.resolveProfileId(command), command.sessionName);
  }

  async requireSession(command: BrowserRuntimeCommand): Promise<BrowserSessionRecord> {
    return this.sessions.require(this.resolveProfileId(command), command.session);
  }

  async resolveAdapterDefault(command: BrowserRuntimeCommand): Promise<BrowserSessionRecord> {
    return this.sessions.resolveAdapterDefault(this.resolveProfileId(command));
  }

  async startSessionHandoff(command: BrowserRuntimeCommand): Promise<BrowserSessionRecord> {
    const profileId = this.resolveProfileId(command);
    const sessionId = command.sessionId!;
    const record = this.sessions.markHandoff(profileId, sessionId, {
      site: command.site!,
      expiresAt: command.expiresAt!,
    });
    await this.manager.foregroundSession(profileId, sessionId);
    return record;
  }

  async clearSessionHandoff(command: BrowserRuntimeCommand): Promise<BrowserSessionRecord> {
    return this.sessions.clearHandoff(this.resolveProfileId(command), command.sessionId!);
  }

  async listSessions(input: { profileId?: string; limit?: number }): Promise<BrowserSessionListRow[]> {
    return this.sessions.list(input.profileId, input.limit).map((session) => ({
      ...session,
      runtimeState: this.manager.hasSession(session.profileId, session.id) ? 'active' : 'idle',
    }));
  }

  async closeSession(command: BrowserRuntimeCommand): Promise<{ closed: boolean; alreadyIdle: boolean; session: string }> {
    const record = this.sessions.require(this.resolveProfileId(command), command.session);
    const closedCount = await this.manager.closeSession(record.profileId, record.id);
    if (command.force && command.discard === true && record.kind === 'explicit' && !record.handoff) this.sessions.remove(record.profileId, record.id);
    else if (command.force && record.handoff) this.sessions.clearHandoff(record.profileId, record.id);
    else this.sessions.touch(record.profileId, record.id);
    return { closed: closedCount > 0, alreadyIdle: closedCount === 0, session: record.id };
  }

  async dispatch(rawCommand: BrowserRuntimeCommand, signal?: AbortSignal): Promise<BrowserRuntimeResult> {
    // Every dispatched command runs in the background unless the caller asked
    // for a window explicitly, so no command steals focus by default. Session
    // handoff bypasses dispatch and still foregrounds through foregroundSession.
    const command: BrowserRuntimeCommand = rawCommand.windowMode
      ? rawCommand
      : { ...rawCommand, windowMode: 'background' };
    const key = this.commandQueueKey(command);
    const previous = this.sessionQueues.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.sessionQueues.set(key, current);

    await previous.catch(() => {});
    try {
      signal?.throwIfAborted();
      if (typeof command.deadlineAt === 'number' && command.deadlineAt > 0 && Date.now() >= command.deadlineAt) {
        return {
          id: command.id,
          ok: false,
          errorCode: 'command_result_unknown',
          error: 'Command deadline expired before browser work started.',
        };
      }
      return await this.manager.runWithProfileActivity(
        this.resolveProfileId(command),
        () => dispatchCloakAction(this.manager, command, signal),
      );
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
      const owner = this.manager.pageOwner(command.page);
      if (owner) {
        const adapterDefaultSite = owner.surface === 'adapter' && owner.sessionKind === 'adapter-default'
          ? owner.adapterSite?.trim()
          : undefined;
        return `session\u0000${owner.profileId}\u0000${owner.session}${adapterDefaultSite ? `\u0000${adapterDefaultSite}` : ''}`;
      }
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
    const adapterDefaultSite = command.surface === 'adapter' && command.sessionKind === 'adapter-default'
      ? command.adapterSite?.trim()
      : undefined;
    return `session\u0000${profileId.trim() || 'default'}\u0000${command.session ?? ''}${adapterDefaultSite ? `\u0000${adapterDefaultSite}` : ''}`;
  }
}
