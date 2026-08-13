import { describe, expect, it } from 'vitest';
import { rejectMisplacedSessionSelectorArgv, rejectPositionalBrowserSessionArgv } from './cli-argv-preprocess.js';

describe('rejectPositionalBrowserSessionArgv', () => {
  it('rejects retired positional browser sessions with the canonical replacement', () => {
    expect(() => rejectPositionalBrowserSessionArgv(['browser', 'session_a', 'run', '--stdin']))
      .toThrowError(/webcmd --session session_a browser run --stdin/);
  });

  it('keeps the canonical root selector unchanged', () => {
    expect(rejectPositionalBrowserSessionArgv(['--session', 'session_a', 'browser', 'run', '--stdin']))
      .toEqual(['--session', 'session_a', 'browser', 'run', '--stdin']);
  });
});

describe('rejectPositionalBrowserSessionArgv details', () => {
  it('keeps browser subcommands and hoists trailing --window', () => {
    expect(rejectPositionalBrowserSessionArgv(['--session', 'session_a', 'browser', 'state', '--window', 'background'])).toEqual([
      '--session', 'session_a', 'browser', '--window', 'background', 'state',
    ]);
  });

  it('leaves non-browser commands unchanged', () => {
    expect(rejectPositionalBrowserSessionArgv(['twitter', 'browser', 'session_a', 'state']))
      .toEqual(['twitter', 'browser', 'session_a', 'state']);
  });
});

describe('rejectMisplacedSessionSelectorArgv', () => {
  it('rejects trailing --session with a copy-pasteable root-selector command', () => {
    expect(() => rejectMisplacedSessionSelectorArgv(['browser', 'run', '--session', 'session_a']))
      .toThrowError(/SESSION_SELECTOR_POSITION: --session must appear before the command\. Use: webcmd --session session_a browser run/);
    expect(() => rejectMisplacedSessionSelectorArgv(['github', 'issues', '--session=session_b']))
      .toThrowError(/Use: webcmd --session session_b github issues/);
  });

  it('keeps the root --session selector unchanged', () => {
    expect(rejectMisplacedSessionSelectorArgv(['--session', 'session_a', 'browser', 'run']))
      .toEqual(['--session', 'session_a', 'browser', 'run']);
  });
});

import { escapeLeadingDashPositional } from './cli-argv-preprocess.js';

describe('escapeLeadingDashPositional', () => {
  const manifest = [
    { site: 'openreview', name: 'paper', browser: true, args: [{ name: 'id', positional: true, required: true }, { name: 'retry', positional: false, valueRequired: true }] },
    { site: 'openreview', name: 'search', args: [{ name: 'query', positional: true, required: false }, { name: 'limit', positional: false }] },
    { site: 'twitter', name: 'follow', args: [{ name: 'username', positional: true, required: true }] },
    { site: 'twitter', name: 'lists', args: [{ name: 'limit', positional: false }] },
  ];

  it('inserts -- before a required positional starting with `-`', () => {
    expect(escapeLeadingDashPositional(['openreview', 'paper', '-abc123def'], manifest))
      .toEqual(['openreview', 'paper', '--', '-abc123def']);
  });

  it('preserves trailing flags after the dash-leading positional', () => {
    expect(escapeLeadingDashPositional(['openreview', 'paper', '-xyz', '-f', 'json'], manifest))
      .toEqual(['openreview', 'paper', '-f', 'json', '--', '-xyz']);
  });

  it('preserves attached short option values like commander does', () => {
    expect(escapeLeadingDashPositional(['openreview', 'paper', '-fjson', '-xyz'], manifest))
      .toEqual(['openreview', 'paper', '-fjson', '--', '-xyz']);
    expect(escapeLeadingDashPositional(['openreview', 'paper', '-xyz', '-fjson'], manifest))
      .toEqual(['openreview', 'paper', '-fjson', '--', '-xyz']);
  });

  it('handles known options before a dash-leading positional', () => {
    expect(escapeLeadingDashPositional(['openreview', 'paper', '--format', 'json', '--trace=on', '-xyz'], manifest))
      .toEqual(['openreview', 'paper', '--format', 'json', '--trace=on', '--', '-xyz']);
  });

  it('keeps adapter and browser options parseable when they follow the positional', () => {
    expect(escapeLeadingDashPositional(['openreview', 'paper', '-xyz', '--retry', '2', '--window', 'foreground'], manifest))
      .toEqual(['openreview', 'paper', '--retry', '2', '--window', 'foreground', '--', '-xyz']);
  });

  it('protects negative numeric positionals too', () => {
    expect(escapeLeadingDashPositional(['openreview', 'paper', '-42'], manifest))
      .toEqual(['openreview', 'paper', '--', '-42']);
  });

  it('leaves unknown dash options untouched instead of hiding them behind --', () => {
    expect(escapeLeadingDashPositional(['openreview', 'paper', '--unknown', 'value'], manifest))
      .toEqual(['openreview', 'paper', '--unknown', 'value']);
  });

  it('does not touch positional values that do not start with -', () => {
    expect(escapeLeadingDashPositional(['openreview', 'paper', 'normal-id'], manifest))
      .toEqual(['openreview', 'paper', 'normal-id']);
  });

  it('does not touch the recognised short flags -f / -v / -h', () => {
    expect(escapeLeadingDashPositional(['openreview', 'paper', '-f', 'json'], manifest))
      .toEqual(['openreview', 'paper', '-f', 'json']);
    expect(escapeLeadingDashPositional(['openreview', 'paper', '-v'], manifest))
      .toEqual(['openreview', 'paper', '-v']);
  });

  it('does not touch long flags (--*)', () => {
    expect(escapeLeadingDashPositional(['openreview', 'paper', '--format', 'json'], manifest))
      .toEqual(['openreview', 'paper', '--format', 'json']);
  });

  it('does not touch already-escaped --', () => {
    expect(escapeLeadingDashPositional(['openreview', 'paper', '--', '-already-escaped'], manifest))
      .toEqual(['openreview', 'paper', '--', '-already-escaped']);
  });

  it('does not touch commands without a required positional', () => {
    expect(escapeLeadingDashPositional(['openreview', 'search', '-something'], manifest))
      .toEqual(['openreview', 'search', '-something']);
    expect(escapeLeadingDashPositional(['twitter', 'lists', '-something'], manifest))
      .toEqual(['twitter', 'lists', '-something']);
  });

  it('works when --profile or another root flag precedes the site', () => {
    expect(escapeLeadingDashPositional(['--profile', 'work', 'openreview', 'paper', '-abc'], manifest))
      .toEqual(['--profile', 'work', 'openreview', 'paper', '--', '-abc']);
  });

  it('works for another adapter with a required positional', () => {
    expect(escapeLeadingDashPositional(['twitter', 'follow', '-someuser'], manifest))
      .toEqual(['twitter', 'follow', '--', '-someuser']);
  });

  it('returns argv unchanged when the command is unknown', () => {
    expect(escapeLeadingDashPositional(['unknown', 'cmd', '-arg'], manifest))
      .toEqual(['unknown', 'cmd', '-arg']);
  });

  it('returns argv unchanged when argv is too short', () => {
    expect(escapeLeadingDashPositional(['openreview'], manifest)).toEqual(['openreview']);
    expect(escapeLeadingDashPositional(['openreview', 'paper'], manifest)).toEqual(['openreview', 'paper']);
  });
});
