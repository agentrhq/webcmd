import { describe, expect, it, vi } from 'vitest';
import { registerNativeChromeProfile, type RegisterNativeChromeProfileDeps } from './chrome-profile-export.js';

function deps(overrides: Partial<RegisterNativeChromeProfileDeps> = {}): RegisterNativeChromeProfileDeps {
  let now = 0;
  return {
    launch: vi.fn().mockResolvedValue(undefined),
    isRegistered: vi.fn().mockReturnValue(false),
    findProcesses: vi.fn().mockResolvedValue([]),
    terminate: vi.fn().mockResolvedValue(undefined),
    delay: vi.fn().mockImplementation(async (ms: number) => { now += ms; }),
    now: vi.fn(() => now),
    platform: 'darwin',
    setDisplayName: vi.fn(),
    ...overrides,
  };
}

describe('registerNativeChromeProfile', () => {
  it('launches invisibly, polls until registered, then kills the matched process', async () => {
    let checks = 0;
    const isRegistered = vi.fn().mockImplementation(() => { checks += 1; return checks >= 3; });
    const findProcesses = vi.fn().mockResolvedValue([4242]);
    const d = deps({ isRegistered, findProcesses });

    const result = await registerNativeChromeProfile(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Users/test/Chrome',
      'webcmd-work',
      d,
    );

    expect(result).toEqual({ registered: true });
    expect(d.launch).toHaveBeenCalledWith(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      expect.arrayContaining([
        '--user-data-dir=/Users/test/Chrome',
        '--profile-directory=webcmd-work',
        '--no-startup-window',
        '--no-first-run',
      ]),
    );
    expect(findProcesses).toHaveBeenCalledWith({
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      userDataDir: '/Users/test/Chrome',
      profileDirectory: 'webcmd-work',
    }, 'darwin');
    expect(d.terminate).toHaveBeenCalledWith(4242, 'darwin', false);
  });

  it('gives up after the bounded timeout without registration, but still kills any matched process', async () => {
    const findProcesses = vi.fn().mockResolvedValue([9]);
    const d = deps({ isRegistered: vi.fn().mockReturnValue(false), findProcesses });

    const result = await registerNativeChromeProfile(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Users/test/Chrome',
      'webcmd-work',
      d,
    );

    expect(result).toEqual({ registered: false });
    expect(d.terminate).toHaveBeenCalledWith(9, 'darwin', false);
  });

  it('does not attempt to terminate anything when no process was actually spawned separately', async () => {
    const d = deps({ isRegistered: vi.fn().mockReturnValue(true), findProcesses: vi.fn().mockResolvedValue([]) });

    const result = await registerNativeChromeProfile(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Users/test/Chrome',
      'webcmd-work',
      d,
    );

    expect(result).toEqual({ registered: true });
    expect(d.terminate).not.toHaveBeenCalled();
  });

  it('sets the Chrome display name to the alias after killing a spawned registration process', async () => {
    const d = deps({
      isRegistered: vi.fn().mockReturnValue(true),
      findProcesses: vi.fn().mockResolvedValue([4242]),
    });

    await registerNativeChromeProfile(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Users/test/Chrome',
      'test1',
      d,
    );

    expect(d.delay).toHaveBeenCalledWith(300);
    expect(d.setDisplayName).toHaveBeenCalledWith('/Users/test/Chrome', 'test1', 'test1');
  });

  // Known limitation: Chrome already running absorbed the request, so the name write is best-effort and may not stick.
  it('still attempts setDisplayName when no process was spawned (absorbed into existing Chrome; best-effort, may not stick)', async () => {
    const d = deps({
      isRegistered: vi.fn().mockReturnValue(true),
      findProcesses: vi.fn().mockResolvedValue([]),
    });

    await registerNativeChromeProfile(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Users/test/Chrome',
      'test1',
      d,
    );

    expect(d.delay).not.toHaveBeenCalledWith(300);
    expect(d.setDisplayName).toHaveBeenCalledWith('/Users/test/Chrome', 'test1', 'test1');
  });

  it('does not set the display name when registration never succeeded', async () => {
    const d = deps({
      isRegistered: vi.fn().mockReturnValue(false),
      findProcesses: vi.fn().mockResolvedValue([9]),
    });

    const result = await registerNativeChromeProfile(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Users/test/Chrome',
      'test1',
      d,
    );

    expect(result).toEqual({ registered: false });
    expect(d.setDisplayName).not.toHaveBeenCalled();
  });
});
