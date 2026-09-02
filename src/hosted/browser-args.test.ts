import { describe, expect, it } from 'vitest';
import { CommanderStructuralError } from '../command-surface.js';
import { browserCommandCatalog } from '../browser/command-catalog.js';
import { parseHostedBrowserStructure, validateRawBrowserSession } from './browser-args.js';

function parse(argv: string[]) {
  return parseHostedBrowserStructure(argv);
}

describe('hosted browser argument surface', () => {
  it('requires an opaque root session selector for raw browser dispatch', () => {
    expect(() => validateRawBrowserSession(undefined)).toThrowError(
      expect.objectContaining({ code: 'SESSION_REQUIRED', exitCode: 2 }),
    );
    expect(() => validateRawBrowserSession('work')).toThrowError(
      expect.objectContaining({ code: 'INVALID_SESSION_SELECTOR', exitCode: 2 }),
    );
  });

  it('includes the selected profile in raw-session recovery commands', () => {
    expect(() => validateRawBrowserSession(undefined, 'work')).toThrowError(
      expect.objectContaining({
        hint: expect.stringContaining('webcmd --profile work session create'),
      }),
    );
    expect(() => validateRawBrowserSession(undefined, 'work')).toThrowError(
      expect.objectContaining({
        hint: expect.stringContaining('webcmd --profile work session list'),
      }),
    );
  });

  it('uses the same command catalog as local mode', () => {
    expect(browserCommandCatalog.map(command => command.command)).toEqual(['tabs', 'init', 'bind', 'verify', 'run', 'snapshot', 'close']);
  });

  it('rejects the retired fork command', () => {
    expect(() => parse(['--session', 'session_work', 'browser', 'fork', 'linkedin/search'])).toThrow();
  });

  it('requires a stable page id for bind', () => {
    expect(parse(['--session', 'session_work', 'browser', 'bind', '--page', 'page-123'])).toMatchObject({
      commandName: 'bind',
      session: 'session_work',
      options: { page: 'page-123' },
    });
    expect(() => parse(['--session', 'session_work', 'browser', 'bind'])).toThrow(CommanderStructuralError);
    expect(() => parse(['--session', 'session_work', 'browser', 'bind', '--index', '0'])).toThrow(CommanderStructuralError);
    expect(() => parse(['--session', 'session_work', 'browser', 'bind', '--page', '   '])).toThrow(CommanderStructuralError);
  });

  it('accepts only run program options', () => {
    expect(parse(['--session', 'session_work', 'browser', 'run', '--file', 'job.js', '--timeout', '12', '--max-output', '1000', '--snapshot-mode', 'tree', '--no-snapshot-diff']))
      .toMatchObject({
        commandName: 'run',
        session: 'session_work',
        options: { file: 'job.js', timeout: 12, maxOutput: 1000, snapshotMode: 'tree', noSnapshotDiff: true },
      });
    expect(() => parse(['--session', 'session_work', 'browser', 'run', '--snapshot-mode', 'read'])).toThrow(CommanderStructuralError);
    expect(() => parse(['--session', 'session_work', 'browser', 'run', '--tab', 'page-123'])).toThrow(CommanderStructuralError);
  });

  it('accepts --json as a harmless browser run output alias', () => {
    expect(parse(['--session', 'session_work', 'browser', 'run', '--file', 'job.js', '--json']))
      .toMatchObject({
        commandName: 'run',
        session: 'session_work',
        options: { file: 'job.js' },
      });
  });

  it('parses snapshot inspection options', () => {
    expect(parse(['--session', 'session_work', 'browser', 'snapshot', '--snapshot-mode', 'read', '--max-output', '1000']))
      .toMatchObject({
        commandName: 'snapshot',
        session: 'session_work',
        options: { snapshotMode: 'read', maxOutput: 1000 },
      });
  });
});
