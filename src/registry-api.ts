/**
 * Public API for webcmd plugins.
 *
 * TS plugins should import from '@agentrhq/webcmd/registry' which resolves to
 * this file. It re-exports ONLY the core registration API — no serialization,
 * no transitive side-effects — to avoid circular dependency deadlocks when
 * plugins are dynamically imported during discoverPlugins().
 *
 * cli() is the ONLY authoring entry point. registerCommand() stays internal:
 * it takes the raw/lazy manifest shape and is not a supported way to author
 * an adapter.
 */

export { cli, Strategy, getRegistry, fullName } from './registry.js';
export type { CliCommand, Arg, CliOptions, CommandArgs, SiteSessionMode } from './registry.js';
export type { IPage } from './types.js';
export { onStartup, onBeforeExecute, onAfterExecute } from './hooks.js';
export type { HookFn, HookContext, HookName } from './hooks.js';
