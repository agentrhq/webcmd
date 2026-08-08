import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockExecFile } = vi.hoisted(() => ({ mockExecFile: vi.fn() }));

vi.mock('node:child_process', () => ({ execFile: mockExecFile }));

import { commandUsesProfileDir, findCloakProfileProcesses, isCloakBrowserCommand } from './profile-processes.js';

const CLOAK_BINARY = '/home/u/.cloakbrowser/chromium-1234/chrome-linux/chrome';
const PROFILES = '/home/u/.webcmd/cloak/profiles';

// Offsets keep these apart from the running process, whose pid is filtered out.
const OWNER_PID = process.pid + 1;
const SIBLING_PID = process.pid + 2;
const USER_CHROME_PID = process.pid + 3;

function mockPs(stdout: string): void {
  mockExecFile.mockImplementation((_command, _args, _options, callback) => callback(null, stdout));
}

beforeEach(() => {
  mockExecFile.mockReset();
});

describe('commandUsesProfileDir', () => {
  it('does not match a profile dir that is a prefix of another', () => {
    const command = `${CLOAK_BINARY} --user-data-dir=${PROFILES}/work-2 about:blank`;

    expect(commandUsesProfileDir(command, [`${PROFILES}/work`])).toBe(false);
    expect(commandUsesProfileDir(command, [`${PROFILES}/work-2`])).toBe(true);
  });

  it('matches the flag at the end of the command line', () => {
    expect(commandUsesProfileDir(`${CLOAK_BINARY} --user-data-dir=${PROFILES}/work`, [`${PROFILES}/work`])).toBe(true);
  });
});

describe('isCloakBrowserCommand', () => {
  it('ignores a Chromium that is not the Cloak build', () => {
    expect(isCloakBrowserCommand(`/opt/google/chrome/chrome --user-data-dir=${PROFILES}/work`)).toBe(false);
    expect(isCloakBrowserCommand(`${CLOAK_BINARY} --user-data-dir=${PROFILES}/work`)).toBe(true);
  });
});

describe('findCloakProfileProcesses', () => {
  it('returns only the Cloak process owning the exact profile dir', async () => {
    mockPs([
      `  ${OWNER_PID} ${CLOAK_BINARY} --user-data-dir=${PROFILES}/work about:blank`,
      `  ${SIBLING_PID} ${CLOAK_BINARY} --user-data-dir=${PROFILES}/work-2 about:blank`,
      `  ${USER_CHROME_PID} /opt/google/chrome/chrome --user-data-dir=${PROFILES}/work`,
      `  ${process.pid} node webcmd daemon`,
      '',
    ].join('\n'));

    expect(await findCloakProfileProcesses(`${PROFILES}/work`)).toEqual([OWNER_PID]);
  });

  it('reports no processes when ps fails', async () => {
    mockExecFile.mockImplementation((_command, _args, _options, callback) => callback(new Error('ps failed'), ''));

    expect(await findCloakProfileProcesses(`${PROFILES}/work`)).toEqual([]);
  });
});
