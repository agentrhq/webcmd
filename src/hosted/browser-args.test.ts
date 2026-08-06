import { describe, expect, it } from 'vitest';
import { CommanderStructuralError } from '../command-surface.js';
import { browserCommandCatalog } from '../browser/command-catalog.js';
import { rewriteBrowserArgv } from '../cli-argv-preprocess.js';
import { parseHostedBrowserStructure } from './browser-args.js';

function parse(argv: string[]) {
  return parseHostedBrowserStructure(rewriteBrowserArgv(argv));
}

describe('hosted browser argument surface', () => {
  it('uses the same command catalog as local mode', () => {
    expect(browserCommandCatalog.map(command => command.command)).toEqual(['tabs', 'bind', 'run', 'snapshot', 'close']);
  });

  it('requires a stable page id for bind', () => {
    expect(parse(['browser', 'work', 'bind', '--page', 'page-123'])).toMatchObject({
      commandName: 'bind',
      session: 'work',
      options: { page: 'page-123' },
    });
    expect(() => parse(['browser', 'work', 'bind'])).toThrow(CommanderStructuralError);
    expect(() => parse(['browser', 'work', 'bind', '--index', '0'])).toThrow(CommanderStructuralError);
    expect(() => parse(['browser', 'work', 'bind', '--page', '   '])).toThrow(CommanderStructuralError);
  });

  it('accepts only run program options', () => {
    expect(parse(['browser', 'work', 'run', '--file', 'job.js', '--timeout', '12', '--max-output', '1000', '--snapshot-mode', 'tree', '--no-snapshot-diff']))
      .toMatchObject({
        commandName: 'run',
        session: 'work',
        options: { file: 'job.js', timeout: 12, maxOutput: 1000, snapshotMode: 'tree', noSnapshotDiff: true },
      });
    expect(() => parse(['browser', 'work', 'run', '--snapshot-mode', 'read'])).toThrow(CommanderStructuralError);
    expect(() => parse(['browser', 'work', 'run', '--tab', 'page-123'])).toThrow(CommanderStructuralError);
  });

  it('parses snapshot inspection options', () => {
    expect(parse(['browser', 'work', 'snapshot', '--snapshot-mode', 'read', '--max-output', '1000']))
      .toMatchObject({
        commandName: 'snapshot',
        session: 'work',
        options: { snapshotMode: 'read', maxOutput: 1000 },
      });
  });
});
