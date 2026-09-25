import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEFAULT_DAEMON_PORT } from './constants.js';
import { EXIT_CODES } from './errors.js';
import { log } from './logger.js';
import { PKG_VERSION } from './version.js';
import { createDaemonServer } from './daemon/server.js';
import { loadWebcmdConfig } from './hosted/config.js';
import { createConfiguredLocalBrowserRuntimeProvider } from './browser/runtime/configured-provider.js';
import { findNoStartupWindowChromeProcesses, terminateChromeProcessTree } from './browser/runtime/local-cloak/chrome-process.js';

export async function sweepOrphanedRegistrationTriggers(deps: {
  findProcesses?: typeof findNoStartupWindowChromeProcesses;
  terminate?: typeof terminateChromeProcessTree;
  platform?: NodeJS.Platform;
} = {}): Promise<void> {
  const findProcesses = deps.findProcesses ?? findNoStartupWindowChromeProcesses;
  const terminate = deps.terminate ?? terminateChromeProcessTree;
  const platform = deps.platform ?? process.platform;
  for (const pid of await findProcesses(platform)) {
    await terminate(pid, platform, true);
  }
}

const isMain = process.argv[1] !== undefined
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  const config = loadWebcmdConfig();
  const provider = createConfiguredLocalBrowserRuntimeProvider(config.mode === 'local' ? config : undefined);
  const daemon = createDaemonServer(provider, { port: DEFAULT_DAEMON_PORT, host: '127.0.0.1', version: PKG_VERSION });

  await sweepOrphanedRegistrationTriggers();

  daemon.listen().then(() => {
    log.info(`[daemon] Listening on http://127.0.0.1:${DEFAULT_DAEMON_PORT}`);
  }).catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      log.error(`[daemon] Port ${DEFAULT_DAEMON_PORT} already in use — another daemon is likely running. Exiting.`);
      process.exit(EXIT_CODES.SERVICE_UNAVAIL);
    }
    log.error(`[daemon] Server error: ${err.message}`);
    process.exit(EXIT_CODES.GENERIC_ERROR);
  });

  function shutdown(): void {
    daemon.close().finally(() => process.exit(EXIT_CODES.SUCCESS));
  }

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
