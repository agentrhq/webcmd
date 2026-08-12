/**
 * Shared manifest types — kept in their own module so both runtime code
 * (discovery.ts) and the build-time compiler (build-manifest.ts) can
 * import them without pulling each other in. This is what lets us
 * exclude `src/build-manifest.ts` from `tsc`'s emit set: the only thing
 * runtime code needs from build-manifest is the `ManifestEntry` type,
 * and that lives here.
 */

import type { FileArgumentContract } from './hosted/contract.js';

export interface ManifestEntry {
  site: string;
  name: string;
  aliases?: string[];
  description: string;
  access: 'read' | 'write';
  example?: string;
  domain?: string;
  strategy: string;
  browser: boolean;
  args: Array<{
    name: string;
    type?: string;
    default?: unknown;
    required?: boolean;
    valueRequired?: boolean;
    positional?: boolean;
    help?: string;
    choices?: string[];
    file?: FileArgumentContract;
  }>;
  columns?: string[];
  tags?: string[];
  keywords?: string[];
  pipeline?: Record<string, unknown>[];
  defaultFormat?: 'table' | 'plain' | 'json' | 'yaml' | 'yml' | 'md' | 'markdown' | 'csv';
  type: 'js';
  /** Relative path from clis/ dir, e.g. 'youtube/search.js' */
  modulePath?: string;
  /** Relative path to the source file from clis/ dir (e.g. 'site/cmd.js') */
  sourceFile?: string;
  /**
   * Package subpath export that registers this command, e.g. './fetch/command'.
   *
   * Present only on core-owned commands, which ship in the package's own
   * `dist/` rather than as adapter files under `clis/`. Such an entry has no
   * `modulePath`/`sourceFile`: there is no adapter file to resolve, and
   * consumers that load adapters by path must import this export instead.
   */
  packageExport?: string;
  /** Command runs only in the local client, never in hosted execution. */
  clientOwned?: boolean;
  /** Pre-navigation control — see CliCommand.navigateBefore */
  navigateBefore?: boolean | string;
  /** Site session lifecycle defaults — see CliCommand.siteSession */
  siteSession?: 'ephemeral' | 'persistent';
  /** Fresh page behavior for persistent site sessions — see CliCommand.freshPage */
  freshPage?: boolean;
}
