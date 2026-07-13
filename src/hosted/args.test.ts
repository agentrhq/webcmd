import { describe, expect, it } from 'vitest';
import { parseHostedInvocation } from './args.js';
import type { HostedCommand } from './types.js';

const command: HostedCommand = {
  site: 'github',
  name: 'search',
  command: 'github/search',
  description: 'Search GitHub',
  access: 'read',
  strategy: 'PUBLIC',
  browser: false,
  args: [
    { name: 'query', positional: true, required: true, type: 'string' },
    { name: 'limit', type: 'int', default: 10 },
    { name: 'include-forks', type: 'boolean', default: false },
  ],
  columns: ['name'],
};

describe('parseHostedInvocation', () => {
  it('parses positional args, value flags, boolean flags, and output options', () => {
    expect(parseHostedInvocation(command, ['webcmd', '--limit', '5', '--include-forks', '-f', 'json', '--trace', 'on']))
      .toEqual({
        args: {
          query: 'webcmd',
          limit: 5,
          'include-forks': true,
        },
        format: 'json',
        trace: 'on',
        help: false,
      });
  });

  it('rejects missing required positional args', () => {
    expect(() => parseHostedInvocation(command, [])).toThrow('Missing required argument');
  });
});
