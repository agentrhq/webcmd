export const HOSTED_CORE_COMMANDS_CAPABILITY = 'hosted-core-commands-v1' as const;

export const HOSTED_CORE_COMMAND_IDS = [
  'validate',
  'verify',
  'convention-audit',
  'doctor',
  'adapter/status',
  'adapter/reset',
  'profile/create',
  'profile/rename',
  'plugin/catalog/list',
] as const;

export type HostedCoreCommandId = typeof HOSTED_CORE_COMMAND_IDS[number];

export function isHostedCoreCommandId(value: unknown): value is HostedCoreCommandId {
  return typeof value === 'string' && (HOSTED_CORE_COMMAND_IDS as readonly string[]).includes(value);
}

export function hasHostedCoreCommand(
  ids: readonly HostedCoreCommandId[] | undefined,
  id: HostedCoreCommandId,
): boolean {
  return ids?.includes(id) ?? false;
}
