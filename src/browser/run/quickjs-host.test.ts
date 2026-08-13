import { afterEach, describe, expect, it } from 'vitest';
import { QuickJSHost } from './quickjs-host.js';

const hosts = new Set<QuickJSHost>();

async function createHost(
  options: Parameters<typeof QuickJSHost.create>[0] = {},
): Promise<QuickJSHost> {
  const host = await QuickJSHost.create(options);
  hosts.add(host);
  return host;
}

afterEach(() => {
  for (const host of hosts) host.dispose();
  hosts.clear();
});

describe('QuickJSHost', () => {
  it('executes async JavaScript and captures console values', async () => {
    const logs: Array<{ level: string; args: unknown[] }> = [];
    const host = await createHost({
      onConsole: (level, args) => logs.push({ level, args }),
    });

    await expect(host.executeScript(`
      (async () => {
        console.log("ok", 42, { nested: true });
        return 7;
      })()
    `)).resolves.toBe(7);
    expect(logs).toEqual([{
      level: 'log',
      args: ['ok', 42, { nested: true }],
    }]);
  });

  it('has no Node, network, module-loading, or host-call globals by default', async () => {
    const host = await createHost();

    await expect(host.executeScript(`({
      process: typeof process,
      require: typeof require,
      module: typeof module,
      fetch: typeof fetch,
      XMLHttpRequest: typeof XMLHttpRequest,
      WebSocket: typeof WebSocket,
      hostCall: typeof __webcmdHostCall
    })`)).resolves.toEqual({
      process: 'undefined',
      require: 'undefined',
      module: 'undefined',
      fetch: 'undefined',
      XMLHttpRequest: 'undefined',
      WebSocket: 'undefined',
      hostCall: 'undefined',
    });
  });

  it('bridges an explicitly configured asynchronous host call', async () => {
    const host = await createHost({
      onHostCall: async (name, args) => ({ name, args }),
    });
    host.installHostCall();

    await expect(host.executeScript(`
      __webcmdHostCall("demo", JSON.stringify([1, "two"]))
    `)).resolves.toEqual({
      name: 'demo',
      args: [1, 'two'],
    });
  });

  it('bridges protocol messages in both directions', async () => {
    const sent: string[] = [];
    const host = await createHost({
      onTransportSend: message => sent.push(message),
    });

    await host.executeScript(`
      globalThis.received = [];
      globalThis.__webcmdTransportReceive = message => received.push(message);
      __webcmdTransportSend('{"id":1}');
    `);
    host.deliverTransport('{"id":1,"result":{}}');

    expect(sent).toEqual(['{"id":1}']);
    await expect(host.executeScript('received')).resolves.toEqual([
      '{"id":1,"result":{}}',
    ]);
  });

  it('drops protocol replies after disposal', async () => {
    const host = await createHost({ onTransportSend: () => undefined });
    await host.executeScript(`
      globalThis.__webcmdTransportReceive = () => {
        throw new Error('late delivery');
      };
    `);
    host.dispose();

    expect(() => host.deliverTransport('{"id":1,"result":{}}')).not.toThrow();
  });

  it('supports timers without exposing Node timer handles', async () => {
    const host = await createHost();

    await expect(host.executeScript(`
      new Promise(resolve => setTimeout(() => resolve("done"), 5))
    `)).resolves.toBe('done');
  });

  it('interrupts an infinite synchronous loop', async () => {
    const host = await createHost({ cpuTimeoutMs: 20 });

    await expect(host.executeScript('while (true) {}')).rejects.toThrow();
  });

  it('enforces a configured memory ceiling', async () => {
    const host = await createHost({ memoryLimitBytes: 2 * 1024 * 1024 });

    await expect(host.executeScript(
      'new ArrayBuffer(8 * 1024 * 1024)',
    )).rejects.toThrow(/memory|allocation|interrupted/i);
  });

  it('refuses use after disposal', async () => {
    const host = await createHost();
    host.dispose();

    await expect(host.executeScript('1 + 1')).rejects.toThrow(/disposed/i);
  });
});
