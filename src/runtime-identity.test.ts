import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import { unsupportedDaemonPortEnvMessage } from './constants.js';
import { getUserWebcmdDir, getUserClisDir, getPluginsDir } from './discovery.js';

describe('webcmd runtime identity', () => {
  it('uses webcmd runtime directories', async () => {
    expect(getUserWebcmdDir('/home/tester')).toBe(path.join('/home/tester', '.webcmd'));
    expect(getUserClisDir('/home/tester')).toBe(path.join('/home/tester', '.webcmd', 'clis'));
    expect(getPluginsDir('/home/tester')).toBe(path.join('/home/tester', '.webcmd', 'plugins'));
  });

  it('reports unsupported daemon port with WEBCMD env names', () => {
    const legacyEnvName = ['OPEN', 'CLI_DAEMON_PORT'].join('');
    expect(unsupportedDaemonPortEnvMessage('1234')).toContain('WEBCMD_DAEMON_PORT');
    expect(unsupportedDaemonPortEnvMessage('1234')).toContain('Webcmd');
    expect(unsupportedDaemonPortEnvMessage('1234')).toContain('rerun webcmd');
    expect(unsupportedDaemonPortEnvMessage('1234')).not.toContain(legacyEnvName);
  });
});
