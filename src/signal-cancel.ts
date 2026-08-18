import { EXIT_CODES } from './errors.js';
import { getSignalDaemonRunContext } from './session-lease.js';
import { cancelDaemonRun } from './browser/daemon-client.js';

type SignalName = 'SIGINT' | 'SIGTERM';

export function installDaemonRunSignalCancellation({
  process: proc = process,
  cancelRun = cancelDaemonRun,
  exit = (code: number) => process.exit(code),
}: {
  process?: Pick<NodeJS.Process, 'once' | 'off'>;
  cancelRun?: (runId: string) => Promise<void>;
  exit?: (code: number) => void;
} = {}): () => void {
  let fired = false;
  const cleanup = () => {
    proc.off('SIGINT', onSignal);
    proc.off('SIGTERM', onSignal);
  };
  const onSignal = (signal: SignalName) => {
    if (fired) return;
    fired = true;
    cleanup();
    const run = getSignalDaemonRunContext();
    const leave = () => exit(EXIT_CODES.INTERRUPTED);
    if (!run) {
      leave();
      return;
    }
    void cancelRun(run.runId).finally(leave);
  };

  proc.once('SIGINT', onSignal);
  proc.once('SIGTERM', onSignal);
  return cleanup;
}
