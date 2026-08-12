import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { installDaemonRunSignalCancellation } from './signal-cancel.js';
import { runWithDaemonRunContext } from './session-lease.js';

describe('installDaemonRunSignalCancellation', () => {
  it('cancels the active daemon run once before exiting on SIGINT', async () => {
    const proc = new EventEmitter() as NodeJS.Process;
    proc.once = proc.once.bind(proc) as NodeJS.Process['once'];
    proc.off = proc.off.bind(proc) as NodeJS.Process['off'];
    const cancelRun = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn();
    let resume!: () => void;
    const gate = new Promise<void>(resolve => { resume = resolve; });
    const pending = runWithDaemonRunContext({ runId: 'run_111_1_1', command: 'browser run' }, async () => {
      await gate;
    });

    installDaemonRunSignalCancellation({ process: proc, cancelRun, exit });
    proc.emit('SIGINT', 'SIGINT');
    proc.emit('SIGTERM', 'SIGTERM');

    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(130));
    expect(cancelRun).toHaveBeenCalledTimes(1);
    expect(cancelRun).toHaveBeenCalledWith('run_111_1_1');
    resume();
    await pending;
  });
});
