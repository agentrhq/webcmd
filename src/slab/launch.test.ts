import { describe, expect, it, vi } from 'vitest';
import { ConfigError } from '../errors.js';
import { launchSlab } from './launch.js';

const helloResult = { protocolVersion: 1, browserVersion: '1', browserPid: 1234, profiles: [] };
const app = {
  platform: 'darwin' as const,
  appPath: '/Applications/SLAB.app',
  executablePath: '/Applications/SLAB.app/Contents/MacOS/SLAB',
};

describe('SLAB launch', () => {
  it('uses an already-running preliminary app without requiring installation discovery', async () => {
    const io = {
      findInstallation: vi.fn(() => { throw new Error('must not discover'); }),
      isRunning: vi.fn(),
      launch: vi.fn(),
      hello: vi.fn().mockResolvedValue(helloResult),
      wait: vi.fn(),
      now: vi.fn().mockReturnValueOnce(0).mockReturnValue(5_000),
    };

    await expect(launchSlab(io)).resolves.toEqual(helloResult);
    expect(io.findInstallation).not.toHaveBeenCalled();
    expect(io.launch).not.toHaveBeenCalled();
  });

  it('fails closed when no installed app is available after the control socket is unavailable', async () => {
    const io = {
      findInstallation: vi.fn(() => null),
      isRunning: vi.fn(),
      launch: vi.fn(),
      hello: vi.fn().mockRejectedValue(new Error('control socket unavailable')),
      wait: vi.fn(),
      now: vi.fn(),
    };

    await expect(launchSlab(io)).rejects.toBeInstanceOf(ConfigError);
    expect(io.launch).not.toHaveBeenCalled();
  });

  it('does not launch when hello reports an invalid control response', async () => {
    const responseError = new Error('SLAB control response is invalid');
    const io = {
      findInstallation: vi.fn(() => app),
      isRunning: vi.fn(),
      launch: vi.fn(),
      hello: vi.fn().mockRejectedValue(responseError),
      wait: vi.fn(),
      now: vi.fn().mockReturnValueOnce(0).mockReturnValue(5_000),
    };

    await expect(launchSlab(io)).rejects.toBe(responseError);
    expect(io.launch).not.toHaveBeenCalled();
  });

  it('opens only the installed normal app and waits for hello', async () => {
    const io = {
      findInstallation: vi.fn(() => app),
      isRunning: vi.fn(() => false),
      launch: vi.fn(async () => {}),
      hello: vi.fn()
        .mockRejectedValueOnce(new Error('control socket unavailable'))
        .mockRejectedValueOnce(new Error('control socket unavailable'))
        .mockResolvedValue(helloResult),
      wait: vi.fn(async () => {}),
      now: vi.fn(() => 0),
    };

    await expect(launchSlab(io)).resolves.toEqual(helloResult);
    expect(io.launch).toHaveBeenCalledWith('/Applications/SLAB.app');
    expect(io.wait).toHaveBeenCalledOnce();
  });

  it('does not relaunch an already-running installed app while waiting for its control socket', async () => {
    const io = {
      findInstallation: vi.fn(() => app),
      isRunning: vi.fn(() => true),
      launch: vi.fn(async () => {}),
      hello: vi.fn()
        .mockRejectedValueOnce(new Error('control socket unavailable'))
        .mockRejectedValueOnce(new Error('control socket unavailable'))
        .mockResolvedValue(helloResult),
      wait: vi.fn(async () => {}),
      now: vi.fn(() => 0),
    };

    await expect(launchSlab(io)).resolves.toEqual(helloResult);
    expect(io.launch).not.toHaveBeenCalled();
    expect(io.wait).toHaveBeenCalledOnce();
  });

  it('times out after five seconds when the owner-scoped control socket never becomes ready', async () => {
    const io = {
      findInstallation: vi.fn(() => app),
      isRunning: vi.fn(() => true),
      launch: vi.fn(async () => {}),
      hello: vi.fn(async () => { throw new Error('control socket unavailable'); }),
      wait: vi.fn(async () => {}),
      now: vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(5_000),
    };

    await expect(launchSlab(io)).rejects.toMatchObject({ hint: 'Open SLAB and retry the browser command.' });
    expect(io.launch).not.toHaveBeenCalled();
    expect(io.wait).toHaveBeenCalledOnce();
  });
});
