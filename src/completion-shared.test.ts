import { describe, expect, it } from 'vitest';
import {
  HOSTED_BUILTIN_COMMANDS,
  HOSTED_ROOT_HELP,
  LOCAL_ONLY_COMMAND_HELP,
} from './completion-shared.js';
import { formatRootHelp } from './command-presentation.js';

describe('hosted root help', () => {
  const advertised = HOSTED_ROOT_HELP.commands.map(command => command.name.split(/\s/, 1)[0]!);
  const localOnly = (HOSTED_ROOT_HELP.localOnlyCommands ?? []).map(command => command.name);

  it.each(['skills', 'update'])('advertises %s, which already runs locally in hosted mode', (name) => {
    expect(advertised).toContain(name);
    expect(localOnly).not.toContain(name);
  });

  it.each(['skills', 'update'])('offers %s in hosted completion', (name) => {
    expect(HOSTED_BUILTIN_COMMANDS).toContain(name);
  });

  it('still lists daemon as local-only', () => {
    expect(localOnly).toContain('daemon');
  });

  it('never lists a command as both advertised and local-only', () => {
    expect(advertised.filter(name => localOnly.includes(name))).toEqual([]);
  });

  it('drops the choose-local-mode footer from root help', () => {
    expect(HOSTED_ROOT_HELP.localOnlyExplanation).toBeUndefined();
    expect(formatRootHelp(HOSTED_ROOT_HELP)).not.toContain(LOCAL_ONLY_COMMAND_HELP);
  });

  it('keeps the footer string exported for the daemon error hint', () => {
    expect(LOCAL_ONLY_COMMAND_HELP).toBe(
      'Run `webcmd setup` and choose local mode to use local-only commands.',
    );
  });
});
