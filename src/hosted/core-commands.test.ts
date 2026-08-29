import { describe, expect, it } from 'vitest';
import {
  hasHostedCoreCommand,
  HOSTED_CORE_COMMAND_IDS,
  HOSTED_COMMAND_ORIGIN_CAPABILITY,
  HOSTED_CORE_COMMANDS_CAPABILITY,
  isHostedCoreCommandId,
} from './core-commands.js';

describe('hosted core command capability', () => {
  it('publishes the v1 capability and canonical command IDs', () => {
    expect(HOSTED_CORE_COMMANDS_CAPABILITY).toBe('hosted-core-commands-v1');
    expect(HOSTED_COMMAND_ORIGIN_CAPABILITY).toBe('hosted-command-origin-v1');
    expect(HOSTED_CORE_COMMAND_IDS).toEqual([
      'validate',
      'verify',
      'convention-audit',
      'doctor',
      'adapter/status',
      'adapter/reset',
      'profile/create',
      'profile/rename',
      'plugin/catalog/list',
    ]);
  });

  it.each(HOSTED_CORE_COMMAND_IDS)('recognizes canonical ID %s', (id) => {
    expect(isHostedCoreCommandId(id)).toBe(true);
  });

  it.each([undefined, null, 1, 'future-command'])('rejects non-canonical ID %j', (value) => {
    expect(isHostedCoreCommandId(value)).toBe(false);
  });

  it('checks optional advertised command membership', () => {
    expect(hasHostedCoreCommand(['validate'], 'validate')).toBe(true);
    expect(hasHostedCoreCommand(['validate'], 'doctor')).toBe(false);
    expect(hasHostedCoreCommand(undefined, 'validate')).toBe(false);
  });
});
