import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@agentrhq/webcmd/registry';
import {
  ArgumentError,
  AuthRequiredError,
  CommandExecutionError,
  EmptyResultError,
} from '@agentrhq/webcmd/errors';
import './connections.js';

const { mapConnection } = await import('./connections.js').then((module) => module.__test__);

function makePage({ evaluateResults = [false], cookies = [{ name: 'JSESSIONID', value: '"ajax:12345"' }] } = {}) {
  const evaluate = vi.fn();
  for (const result of evaluateResults) evaluate.mockResolvedValueOnce(result);
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    wait: vi.fn().mockResolvedValue(undefined),
    getCookies: vi.fn().mockResolvedValue(cookies),
    evaluate,
  };
}

const connection = (id) => ({
  createdAt: 1700000000000 + id,
  miniProfile: {
    firstName: `First${id}`,
    lastName: `Last${id}`,
    occupation: `Job ${id}`,
    publicIdentifier: `user${id}`,
  },
});

describe('linkedin connections', () => {
  it('registers the connections command', () => {
    const command = getRegistry().get('linkedin/connections');
    expect(command).toMatchObject({
      access: 'read',
      browser: true,
      strategy: 'cookie',
      columns: ['rank', 'name', 'occupation', 'public_id', 'connected_at', 'url'],
    });
  });

  it('maps a connection element to a row', () => {
    expect(mapConnection(connection(1), 0)).toEqual({
      rank: 1,
      name: 'First1 Last1',
      occupation: 'Job 1',
      public_id: 'user1',
      connected_at: 1700000000001,
      url: 'https://www.linkedin.com/in/user1',
    });
  });

  it('requires a miniProfile with a stable public identity', () => {
    expect(() => mapConnection({ createdAt: 1 }, 0)).toThrow(CommandExecutionError);
    expect(() => mapConnection({
      createdAt: 1,
      miniProfile: { firstName: 'Only', lastName: 'Name' },
    }, 0)).toThrow(CommandExecutionError);
    expect(() => mapConnection({
      createdAt: 1,
      miniProfile: { firstName: 'Bad', lastName: 'Id', publicIdentifier: 'bad/id' },
    }, 0)).toThrow(CommandExecutionError);
  });

  it('fails closed for malformed miniProfile scalar fields', () => {
    expect(() => mapConnection({
      createdAt: 1,
      miniProfile: { firstName: { text: 'Alice' }, lastName: 'Example', publicIdentifier: 'alice' },
    }, 0)).toThrow(CommandExecutionError);
  });

  it('returns rows from the Voyager connections API', async () => {
    const command = getRegistry().get('linkedin/connections');
    const page = makePage({ evaluateResults: [false, { json: { elements: [connection(1), connection(2)] } }] });

    const rows = await command.func(page, { limit: 2 });

    expect(rows.map((row) => row.public_id)).toEqual(['user1', 'user2']);
    expect(page.evaluate.mock.calls[1][0]).toContain('/voyager/api/relationships/connections?start=0&count=2');
    expect(page.evaluate.mock.calls[1][0]).toContain('ajax:12345');
  });

  it('paginates with bounded page sizes', async () => {
    const command = getRegistry().get('linkedin/connections');
    const firstPage = Array.from({ length: 40 }, (_, index) => connection(index + 1));
    const page = makePage({
      evaluateResults: [
        false,
        { json: { elements: firstPage } },
        { json: { elements: [connection(41)] } },
      ],
    });

    const rows = await command.func(page, { limit: 41 });

    expect(rows).toHaveLength(41);
    expect(page.evaluate.mock.calls[1][0]).toContain('?start=0&count=40');
    expect(page.evaluate.mock.calls[2][0]).toContain('?start=40&count=1');
  });

  it('maps page and API authentication failures to AuthRequiredError', async () => {
    const command = getRegistry().get('linkedin/connections');
    await expect(command.func(makePage({ evaluateResults: [true] }), { limit: 2 }))
      .rejects.toBeInstanceOf(AuthRequiredError);
    await expect(command.func(makePage({ evaluateResults: [false], cookies: [] }), { limit: 2 }))
      .rejects.toBeInstanceOf(AuthRequiredError);

    for (const error of ['HTTP 403', 'HTML auth/checkpoint response']) {
      const page = makePage({ evaluateResults: [false, { authRequired: true, error }] });
      await expect(command.func(page, { limit: 2 })).rejects.toBeInstanceOf(AuthRequiredError);
    }
  });

  it('fails closed for malformed API responses', async () => {
    const command = getRegistry().get('linkedin/connections');
    for (const result of [
      { error: 'response was not valid JSON' },
      { json: {} },
    ]) {
      const page = makePage({ evaluateResults: [false, result] });
      await expect(command.func(page, { limit: 2 })).rejects.toBeInstanceOf(CommandExecutionError);
    }
  });

  it('throws EmptyResultError when no connections are found', async () => {
    const command = getRegistry().get('linkedin/connections');
    const page = makePage({ evaluateResults: [false, { json: { elements: [] } }] });

    await expect(command.func(page, { limit: 2 })).rejects.toBeInstanceOf(EmptyResultError);
  });

  it('rejects invalid limits', async () => {
    const command = getRegistry().get('linkedin/connections');
    for (const limit of [0, 501, 1.5]) {
      await expect(command.func(makePage(), { limit })).rejects.toBeInstanceOf(ArgumentError);
    }
  });
});
