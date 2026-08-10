/**
 * Discovery entry for client-owned `web fetch`.
 *
 * Execution stays on the main.ts fast path so hosted mode never cloud-routes
 * this command. This module exists so build-manifest, `webcmd list`,
 * completions, and Commander help can see the same registration as the
 * always-available fast path.
 */
import { makeWebFetchCommand } from '@agentrhq/webcmd/fetch/command';

export const command = makeWebFetchCommand();
