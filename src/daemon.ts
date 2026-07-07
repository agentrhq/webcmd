import { DEFAULT_DAEMON_PORT } from './constants.js';
import { EXIT_CODES } from './errors.js';
import { log } from './logger.js';
import { PKG_VERSION } from './version.js';
import { createDaemonServer } from './daemon/server.js';
import { LocalCloakRuntimeProvider } from './browser/runtime/local-cloak/provider.js';

const provider = new LocalCloakRuntimeProvider();
const daemon = createDaemonServer(provider, { port: DEFAULT_DAEMON_PORT, host: '127.0.0.1', version: PKG_VERSION });

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
