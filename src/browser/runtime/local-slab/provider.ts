import { homedir } from 'node:os';
import type { BrowserRuntimeCommand, BrowserRuntimeResult, BrowserRuntimeStatus } from '../../protocol.js';
import type { BrowserRuntimeProvider, RuntimeStatusOptions } from '../provider.js';
import { LocalBrowserSessionStore, type BrowserSessionListRow, type BrowserSessionRecord } from '../../sessions.js';
import { SlabBridgeClient } from '../../../slab/bridge-client.js';
import { slabControlEndpoint } from '../../../slab/installation.js';
import type { SlabHelloResult } from '../../../slab/protocol.js';
import { dispatchSlabAction, resolveSlabCommandProfileId } from './actions.js';
import type { AttachSlabProfile } from './session-manager.js';
import { SlabSessionManager } from './session-manager.js';
import { ensureSlabProfile } from '../../../slab/control-bridge.js';

export interface LocalSlabRuntimeProviderOptions {
  baseDir?: string;
  attachProfile?: AttachSlabProfile;
  statusBridge?: () => Promise<Pick<SlabBridgeClient, 'close' | 'hello'>>;
  ensureProfile?: typeof ensureSlabProfile;
}

export function createLocalBrowserRuntimeProvider(opts: LocalSlabRuntimeProviderOptions = {}): LocalSlabRuntimeProvider {
  return new LocalSlabRuntimeProvider(opts);
}

export class LocalSlabRuntimeProvider implements BrowserRuntimeProvider {
  private managerInstance?: SlabSessionManager;
  private readonly sessions: LocalBrowserSessionStore;
  private readonly sessionQueues = new Map<string, Promise<void>>();

  constructor(private readonly opts: LocalSlabRuntimeProviderOptions = {}) {
    this.sessions = new LocalBrowserSessionStore({
      baseDir: opts.baseDir,
      isActive: session => this.managerInstance?.hasSession(session.profileId, session.id) ?? false,
    });
  }

  private get manager(): SlabSessionManager {
    return this.managerInstance ??= new SlabSessionManager({
      ...this.opts,
      hasActiveHandoff: profileId => this.sessions.list(profileId, 100).some(session => (
        Boolean(session.handoff) && Date.parse(session.handoff!.expiresAt) > Date.now()
      )),
    });
  }

  async status(opts: RuntimeStatusOptions = {}): Promise<BrowserRuntimeStatus> {
    const profiles = this.manager.profileStatuses();
    const hello = await this.nativeStatus().catch(() => undefined);
    const profileById = new Map(profiles.map(profile => [profile.contextId, profile]));
    if (hello) {
      for (const profile of hello.profiles) {
        if (!profileById.has(profile.id)) {
          profileById.set(profile.id, {
            contextId: profile.id,
            runtimeConnected: true,
            runtimeVersion: hello.browserVersion,
            pending: 0,
            lastSeenAt: Date.now(),
          });
        }
      }
    }
    const statusProfiles = [...profileById.values()];
    const requestedProfile = opts.contextId?.trim();
    const selectedProfile = requestedProfile
      ? statusProfiles.find(profile => profile.contextId === requestedProfile)
      : undefined;
    const runtimeConnected = requestedProfile
      ? Boolean(selectedProfile?.runtimeConnected)
      : statusProfiles.some(profile => profile.runtimeConnected);
    return {
      runtimeConnected,
      runtimeName: 'SLAB',
      runtimeVersion: statusProfiles.find(profile => profile.runtimeVersion)?.runtimeVersion ?? hello?.browserVersion,
      profiles: statusProfiles,
      ...(requestedProfile && !selectedProfile?.runtimeConnected ? { profileDisconnected: true } : {}),
      pending: 0,
      commandResultUnknown: 0,
      sessions: await this.listSessions({ profileId: opts.contextId, includeDiscovered: false }),
    };
  }

  resolveProfileId(command: BrowserRuntimeCommand): string {
    return resolveSlabCommandProfileId(this.manager, command);
  }

  async createSession(command: BrowserRuntimeCommand): Promise<BrowserSessionRecord> {
    const profileId = this.resolveProfileId(command);
    const hello = await this.nativeStatus();
    if (hello.protocolVersion >= 2 && !hello.profiles.some(profile => profile.id === profileId)) {
      throw Object.assign(
        new Error(`SLAB Profile "${profileId}" no longer exists. Run webcmd profile create to repair it explicitly.`),
        { code: 'PROFILE_GONE' },
      );
    }
    return this.sessions.create(profileId, command.sessionName ?? '');
  }

  async ensureProfile(input: { alias: string; idempotencyKey: string }) {
    return (this.opts.ensureProfile ?? ensureSlabProfile)(input);
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

  async listSessions(input: { profileId?: string; limit?: number; includeDiscovered?: boolean }): Promise<BrowserSessionListRow[]> {
    const managed: BrowserSessionListRow[] = this.sessions.list(input.profileId, input.limit).map((session) => ({
      ...session,
      rowKind: 'session' as const,
      runtimeState: this.manager.hasSession(session.profileId, session.id) ? 'active' : 'idle',
    }));
    if (input.includeDiscovered === false || !input.profileId || managed.length >= (input.limit ?? 20)) return managed;
    const discovered = await this.manager.discoveredWindows(input.profileId);
    return [...managed, ...discovered].slice(0, input.limit ?? 20);
  }

  async closeSession(command: BrowserRuntimeCommand): Promise<{ closed: boolean; alreadyIdle: boolean; session: string }> {
    const record = this.sessions.require(this.resolveProfileId(command), command.session);
    const closedCount = await this.manager.closeSession(record.profileId, record.id);
    if (command.discard === true && record.kind === 'explicit' && !record.handoff) this.sessions.remove(record.profileId, record.id);
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
        () => dispatchSlabAction(this.manager, command, signal),
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

  private async nativeStatus(): Promise<SlabHelloResult> {
    const client = await (this.opts.statusBridge?.()
      ?? SlabBridgeClient.connect(slabControlEndpoint(homedir()), { timeoutMs: 1_000 }));
    try {
      return await client.hello();
    } finally {
      await client.close();
    }
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
