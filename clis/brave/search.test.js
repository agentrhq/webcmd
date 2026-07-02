import { describe, it, expect, vi } from 'vitest';

const { __test__ } = await import('./search.js');
const command = __test__.command;

function createPageMock(evaluateResult = []) {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    wait: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(evaluateResult),
  };
}

describe('brave search', () => {
  it('should register as a valid command', () => {
    expect(command).toBeDefined();
    expect(command.site).toBe('brave');
    expect(command.name).toBe('search');
    expect(command.access).toBe('read');
    expect(command.browser).toBe(true);
    expect(command.strategy).toBe('public');
    expect(command.domain).toBe('search.brave.com');
  });

  it('should define keyword positional arg', () => {
    const kwArg = command.args.find(a => a.name === 'keyword');
    expect(kwArg).toBeDefined();
    expect(kwArg.positional).toBe(true);
    expect(kwArg.required).toBe(true);
  });

  it('should define limit arg with default 10', () => {
    const limitArg = command.args.find(a => a.name === 'limit');
    expect(limitArg).toBeDefined();
    expect(limitArg.type).toBe('int');
    expect(limitArg.default).toBe(10);
  });

  it('should define output columns', () => {
    expect(command.columns).toContain('rank');
    expect(command.columns).toContain('title');
    expect(command.columns).toContain('url');
    expect(command.columns).toContain('snippet');
  });

  it('rejects empty query, invalid limit, and invalid offset before navigation', async () => {
    const page = createPageMock();
    await expect(command.func(page, { keyword: '', limit: 5 })).rejects.toMatchObject({ code: 'ARGUMENT' });
    await expect(command.func(page, { keyword: 'webcmd', limit: 19 })).rejects.toMatchObject({ code: 'ARGUMENT' });
    await expect(command.func(page, { keyword: 'webcmd', limit: 5, offset: -1 })).rejects.toMatchObject({ code: 'ARGUMENT' });
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('unwraps browser envelopes and returns ranked HTTPS rows', async () => {
    const page = createPageMock({
      session: 'site:brave',
      data: [['Webcmd', 'https://github.com/agentrhq/webcmd', 'CLI browser tooling']],
    });

    await expect(command.func(page, { keyword: 'webcmd', limit: 1, offset: 1 })).resolves.toEqual([{
      rank: 19,
      title: 'Webcmd',
      url: 'https://github.com/agentrhq/webcmd',
      snippet: 'CLI browser tooling',
    }]);
  });

  it('fails typed instead of silently returning [] for malformed extraction payloads', async () => {
    const page = createPageMock({ rows: [] });

    await expect(command.func(page, { keyword: 'webcmd', limit: 1 })).rejects.toMatchObject({
      code: 'COMMAND_EXEC',
      message: expect.stringContaining('payload shape'),
    });
  });
});
