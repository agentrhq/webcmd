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
    { name: 'sort', type: 'string', choices: ['updated', 'stars'] },
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
        optionSources: {
          query: 'cli',
          limit: 'cli',
          'include-forks': 'cli',
        },
        format: 'json',
        formatExplicit: true,
        trace: 'on',
        verbose: false,
        help: false,
      });
  });

  it('rejects missing required positional args', () => {
    expect(() => parseHostedInvocation(command, [])).toThrow(/query.*required/i);
  });

  it.each([
    { name: 'partial integers', argv: ['webcmd', '--limit', '12x'], message: /limit.*integer/i },
    { name: 'invalid choices', argv: ['webcmd', '--sort', 'recent'], message: /sort.*one of.*updated.*stars/i },
  ])('rejects $name', ({ argv, message }) => {
    expect(() => parseHostedInvocation(command, argv)).toThrow(message);
  });
});
