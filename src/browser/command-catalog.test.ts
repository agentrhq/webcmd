import type { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { createProgram } from '../cli.js';
import { browserCommandCatalog, browserOptionValueParser } from './command-catalog.js';

function browserCommand(): Command {
  const browser = createProgram('', '').commands.find(command => command.name() === 'browser');
  if (!browser) throw new Error('Local browser command is not registered');
  return browser;
}

describe('browserCommandCatalog', () => {
  it('exposes the raw browser session commands', () => {
    expect(browserCommandCatalog.map(command => command.command)).toEqual([
      'tabs',
      'bind',
      'fork',
      'run',
      'snapshot',
      'close',
    ]);
  });

  it('exposes hosted adapter fork with a required command name', () => {
    const fork = browserCommandCatalog.find(command => command.command === 'fork');
    expect(fork).toMatchObject({ action: 'fork', sessionPolicy: 'require-existing' });
    expect(fork?.positionals).toEqual([
      expect.objectContaining({ name: 'name', required: true, positional: true }),
    ]);
  });

  it('keeps adapter authoring separate from the raw session catalog', () => {
    expect(browserCommand().commands.map(command => command.name())).toEqual([
      'init',
      'fork',
      'verify',
      'tabs',
      'bind',
      'run',
      'snapshot',
      'close',
    ]);
  });

  it('requires a stable page id for bind and limits run to program options', () => {
    const commands = new Map(browserCommandCatalog.map(command => [command.command, command]));
    expect(commands.get('bind')?.options).toEqual([
      expect.objectContaining({ name: 'page', required: true }),
    ]);
    expect(commands.get('run')?.options.map(option => option.name)).toEqual([
      'stdin',
      'file',
      'timeout',
      'maxOutput',
      'snapshotMode',
      'noSnapshotDiff',
    ]);
  });

  it('includes snapshot as the read-only browser inspection command', () => {
    const snapshot = browserCommandCatalog.find(command => command.command === 'snapshot');
    expect(snapshot).toMatchObject({ action: 'snapshot', sessionPolicy: 'require-existing' });
    expect(snapshot?.options.map(option => option.name)).toEqual(['snapshotMode', 'ref', 'maxOutput']);
  });

  it('parses run snapshot mode as act or tree only', () => {
    expect(browserOptionValueParser('run', 'snapshotMode')?.('act')).toBe('act');
    expect(browserOptionValueParser('run', 'snapshotMode')?.('tree')).toBe('tree');
    expect(() => browserOptionValueParser('run', 'snapshotMode')?.('read')).toThrow(/act or tree/);
  });

  it('parses snapshot mode as act, tree, or read only', () => {
    const parse = browserOptionValueParser('snapshot', 'snapshotMode');
    expect(parse?.('act')).toBe('act');
    expect(parse?.('tree')).toBe('tree');
    expect(browserOptionValueParser('snapshot', 'snapshotMode')?.('read')).toBe('read');
    expect(() => parse?.('full')).toThrow('--snapshot-mode for snapshot must be act, tree, or read');
  });
});
