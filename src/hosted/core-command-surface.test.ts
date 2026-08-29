import { describe, expect, it } from 'vitest';
import { CommanderStructuralError } from '../command-surface.js';
import { parseHostedCoreCommand } from './core-command-surface.js';

describe('hosted core command surface', () => {
  it.each([
    {
      argv: ['validate', 'github', '-f', 'json'],
      expected: { command: 'validate', target: 'github', format: 'json', formatExplicit: true },
    },
    {
      argv: ['verify', 'github/list', '--smoke'],
      expected: { command: 'verify', target: 'github/list', smoke: true, format: 'table', formatExplicit: false },
    },
    {
      argv: ['convention-audit', '--site', 'github', '--strict'],
      expected: { command: 'convention-audit', site: 'github', strict: true, format: 'table', formatExplicit: false },
    },
    {
      argv: ['doctor', '--verbose', '-f', 'yaml'],
      expected: { command: 'doctor', verbose: true, format: 'yaml', formatExplicit: true },
    },
  ])('parses $argv', ({ argv, expected }) => {
    expect(parseHostedCoreCommand(argv, false)).toEqual(expected);
  });

  it.each([
    ['validate', '--unknown'],
    ['verify', '--smoke=false'],
    ['convention-audit', 'a', 'b'],
    ['doctor', '--profile', 'work'],
  ])('rejects invalid grammar before dispatch: %j', (...argv) => {
    expect(() => parseHostedCoreCommand(argv, false)).toThrow(CommanderStructuralError);
    try {
      parseHostedCoreCommand(argv, false);
    } catch (error) {
      expect(error).toMatchObject({ exitCode: 2 });
      expect((error as CommanderStructuralError).output).toContain('error:');
      expect((error as CommanderStructuralError).output).toContain('help:');
    }
  });
});
