import type { BrowserRuntimeCommand, BrowserRuntimeResult } from '../../protocol.js';
import { waitForDownload } from './downloads.js';
import type { CloakSessionManager } from './session-manager.js';
import type { Frame, Page as PlaywrightPage } from 'playwright-core';

class CloakActionError extends Error {
  constructor(
    readonly errorCode: string,
    error: string,
    readonly page?: string,
    readonly errorHint?: string,
  ) {
    super(error);
  }
}

function commandProfileId(manager: CloakSessionManager, command: BrowserRuntimeCommand): string {
  const requested = command.profileId ?? command.contextId;
  if (requested?.trim()) return requested.trim();

  const preferred = command.preferredContextId?.trim();
  if (!preferred) return 'default';

  const active = manager.activeProfileIds();
  if (active.includes(preferred)) return preferred;
  if (active.length === 1) return active[0];
  if (active.length > 1) {
    throw new CloakActionError(
      'profile_required',
      `Default Cloak profile "${preferred}" is not active and multiple profiles are running; choose one with --profile.`,
      undefined,
      'Run webcmd profile list, then update the default with webcmd profile use <name> or pass --profile <name>.',
    );
  }
  return preferred;
}

function invalidRequest(command: BrowserRuntimeCommand, error: string): BrowserRuntimeResult {
  return { id: command.id, ok: false, errorCode: 'invalid_request', error };
}

async function resolveLease(manager: CloakSessionManager, command: BrowserRuntimeCommand) {
  if (command.page) {
    const existing = manager.findPageById(command.page, { idleTimeout: command.idleTimeout });
    if (existing) return existing;
    throw new CloakActionError('stale_page_identity', `Page not found: ${command.page} — stale page identity`);
  }
  return manager.getPage({
    profileId: commandProfileId(manager, command),
    session: command.session,
    surface: command.surface,
    siteSession: command.siteSession,
    idleTimeout: command.idleTimeout,
    freshPage: command.freshPage,
    windowMode: command.windowMode,
  });
}

function execTarget(page: PlaywrightPage, frameIndex: number | undefined, pageId: string): PlaywrightPage | Frame {
  if (frameIndex == null) return page;
  const frame = page.frames().slice(1)[frameIndex];
  if (!frame) throw new CloakActionError('frame_not_found', `Frame not found: ${frameIndex}`, pageId);
  return frame;
}

async function applyScreenshotViewport(page: PlaywrightPage, command: BrowserRuntimeCommand): Promise<{ width: number; height: number } | null> {
  const width = Number.isFinite(command.width) && command.width! > 0 ? Math.ceil(command.width!) : undefined;
  const height = !command.fullPage && Number.isFinite(command.height) && command.height! > 0 ? Math.ceil(command.height!) : undefined;
  if (width === undefined && height === undefined) return null;
  const current = page.viewportSize();
  await page.setViewportSize({
    width: width ?? current?.width ?? 1280,
    height: height ?? current?.height ?? 720,
  });
  return current;
}

export async function dispatchCloakAction(manager: CloakSessionManager, command: BrowserRuntimeCommand): Promise<BrowserRuntimeResult> {
  try {
    switch (command.action) {
      case 'navigate': {
        if (!command.url) return invalidRequest(command, 'Missing url');
        const lease = await resolveLease(manager, command);
        await lease.page.goto(command.url, { waitUntil: 'load' });
        return { id: command.id, ok: true, data: { title: await lease.page.title(), url: lease.page.url(), timedOut: false }, page: lease.pageId };
      }
      case 'exec': {
        if (!command.code) return invalidRequest(command, 'Missing code');
        const lease = await resolveLease(manager, command);
        const target = execTarget(lease.page, command.frameIndex, lease.pageId);
        const data = await target.evaluate(command.code);
        return { id: command.id, ok: true, data, page: lease.pageId };
      }
      case 'cookies': {
        const lease = await resolveLease(manager, command);
        const cookies = await lease.context.cookies(command.url ? [command.url] : undefined);
        const data = command.domain ? cookies.filter((cookie) => cookie.domain.includes(command.domain!)) : cookies;
        return { id: command.id, ok: true, data };
      }
      case 'screenshot': {
        const lease = await resolveLease(manager, command);
        const previousViewport = await applyScreenshotViewport(lease.page, command);
        try {
          const buffer = await lease.page.screenshot({
            type: command.format ?? 'png',
            quality: command.format === 'jpeg' ? command.quality : undefined,
            fullPage: command.fullPage,
          });
          return { id: command.id, ok: true, data: buffer.toString('base64'), page: lease.pageId };
        } finally {
          if (previousViewport) await lease.page.setViewportSize(previousViewport);
        }
      }
      case 'close-window': {
        if (command.page) {
          const closed = await manager.closePage({ profileId: commandProfileId(manager, command), pageId: command.page });
          return { id: command.id, ok: true, data: { closed: Boolean(closed), page: closed ?? command.page, session: command.session } };
        } else {
          await manager.release({
            profileId: commandProfileId(manager, command),
            session: command.session,
            surface: command.surface,
          });
          return { id: command.id, ok: true, data: { closed: true, session: command.session } };
        }
      }
      case 'tabs': {
        switch (command.op ?? 'list') {
          case 'list': {
            const tabs = await manager.listPages({ profileId: commandProfileId(manager, command) });
            return { id: command.id, ok: true, data: tabs };
          }
          case 'new': {
            const lease = await manager.newPage({
              profileId: commandProfileId(manager, command),
              session: command.session,
              surface: command.surface,
              siteSession: command.siteSession,
              idleTimeout: command.idleTimeout,
              url: command.url,
              windowMode: command.windowMode,
            });
            return { id: command.id, ok: true, data: { title: await lease.page.title(), url: lease.page.url() }, page: lease.pageId };
          }
          case 'select': {
            const lease = await manager.selectPage({ profileId: commandProfileId(manager, command), pageId: command.page, index: command.index, windowMode: command.windowMode });
            if (!lease) return { id: command.id, ok: false, errorCode: 'runtime_command_failed', error: 'Tab not found' };
            return { id: command.id, ok: true, data: { selected: true, url: lease.page.url() }, page: lease.pageId };
          }
          case 'close': {
            const closed = await manager.closePage({ profileId: commandProfileId(manager, command), pageId: command.page, index: command.index });
            if (!closed) return { id: command.id, ok: false, errorCode: 'runtime_command_failed', error: 'Tab not found' };
            return { id: command.id, ok: true, data: { closed } };
          }
          default:
            return invalidRequest(command, `Unknown tabs op: ${command.op}`);
        }
      }
      case 'set-file-input': {
        if (!command.files?.length) return invalidRequest(command, 'Missing or empty files array');
        const lease = await resolveLease(manager, command);
        const locator = lease.page.locator(command.selector ?? 'input[type="file"]').first();
        await locator.setInputFiles(command.files);
        return { id: command.id, ok: true, data: { count: command.files.length }, page: lease.pageId };
      }
      case 'insert-text': {
        if (typeof command.text !== 'string') return invalidRequest(command, 'Missing text payload');
        const lease = await resolveLease(manager, command);
        await lease.page.keyboard.insertText(command.text);
        return { id: command.id, ok: true, data: { inserted: true }, page: lease.pageId };
      }
      case 'network-capture-start': {
        const lease = await resolveLease(manager, command);
        manager.networkCapture.start(command.pattern ?? '', lease.page);
        return { id: command.id, ok: true, data: { started: true }, page: lease.pageId };
      }
      case 'network-capture-read': {
        const lease = await resolveLease(manager, command);
        return { id: command.id, ok: true, data: await manager.networkCapture.read(lease.page), page: lease.pageId };
      }
      case 'wait-download': {
        const lease = await resolveLease(manager, command);
        const result = await waitForDownload(lease.page, command.pattern ?? '', command.timeoutMs ?? 30_000);
        return { id: command.id, ok: true, data: result, page: lease.pageId };
      }
      case 'cdp': {
        if (!command.cdpMethod) return invalidRequest(command, 'Missing cdpMethod');
        const lease = await resolveLease(manager, command);
        const session = await lease.context.newCDPSession(lease.page);
        const data = await session.send(command.cdpMethod as any, command.cdpParams ?? {});
        return { id: command.id, ok: true, data, page: lease.pageId };
      }
      case 'frames': {
        const lease = await resolveLease(manager, command);
        const frames = lease.page.frames().slice(1).map((frame, index) => ({
          index,
          frameId: frame.name() || String(index),
          url: frame.url(),
          name: frame.name(),
        }));
        return { id: command.id, ok: true, data: frames, page: lease.pageId };
      }
      case 'bind':
        if (!command.page && command.index == null) {
          return {
            id: command.id,
            ok: false,
            errorCode: 'invalid_request',
            error: 'Bind requires --page or --index for a Cloak runtime tab',
            errorHint: 'Run `webcmd browser <session> tab list`, then retry with `webcmd browser <session> bind --page <page-id>`.',
          };
        }
        {
          const lease = await manager.bindPage({
            profileId: commandProfileId(manager, command),
            session: command.session,
            surface: command.surface,
            siteSession: command.siteSession,
            idleTimeout: command.idleTimeout,
            windowMode: command.windowMode,
            pageId: command.page,
            index: command.index,
          });
          if (!lease) {
            return {
              id: command.id,
              ok: false,
              errorCode: 'bound_tab_not_found',
              error: 'Cloak tab not found for bind target',
              errorHint: 'Run `webcmd browser <session> tab list` and choose a current Cloak tab id or index.',
            };
          }
          return {
            id: command.id,
            ok: true,
            page: lease.pageId,
            data: {
              bound: true,
              session: command.session,
              page: lease.pageId,
              url: lease.page.url(),
              title: await lease.page.title().catch(() => ''),
            },
          };
        }
      default:
        return { id: command.id, ok: false, errorCode: 'runtime_command_failed', error: `Unknown action: ${command.action}` };
    }
  } catch (err) {
    if (err instanceof CloakActionError) {
      return { id: command.id, ok: false, errorCode: err.errorCode, error: err.message, ...(err.page && { page: err.page }), ...(err.errorHint && { errorHint: err.errorHint }) };
    }
    return { id: command.id, ok: false, errorCode: 'runtime_command_failed', error: err instanceof Error ? err.message : String(err) };
  }
}
