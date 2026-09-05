import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { CommandExecutionError } from '@agentrhq/webcmd/errors';
import {
    MERIDIAN_DOMAIN, apiFetch, normalizeText, requireBoundedInt, requireNonEmptyText, requireProjectId,
} from './utils.js';

export const competitorAddCommand = cli({
    site: 'meridian',
    name: 'competitor-add',
    access: 'write',
    description: 'Add a competitor to a Meridian project by name or website (e.g. one found via the ycombinator/hackernews/producthunt plugins)',
    example: 'webcmd meridian competitor-add <project-id> acme.ai',
    domain: MERIDIAN_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    siteSession: 'persistent',
    args: [
        { name: 'project', positional: true, required: true, help: 'Meridian project id (see: webcmd meridian projects)' },
        {
            name: 'competitor',
            positional: true,
            required: true,
            help: 'Competitor website URL or bare company name (Meridian resolves the official site)',
        },
        { name: 'timeout', type: 'int', default: 120, help: 'Max seconds to wait for enrichment (10-600)' },
    ],
    columns: ['status', 'competitor', 'detail', 'next'],
    func: async (page, kwargs) => {
        const projectId = requireProjectId(kwargs.project);
        const competitor = requireNonEmptyText(
            kwargs.competitor,
            'competitor name or URL',
            'Example: webcmd meridian competitor-add <project-id> acme.ai',
        );
        const timeoutSeconds = requireBoundedInt(kwargs.timeout, 120, 10, 600, 'meridian competitor-add --timeout');
        const result = await apiFetch(page, `/initiatives/${encodeURIComponent(projectId)}/competitors/add-manual`, {
            method: 'POST',
            body: { website: competitor },
            timeoutSeconds,
            label: 'competitor add',
        });
        if (!result || typeof result !== 'object') {
            throw new CommandExecutionError('Meridian competitor add returned an unreadable response');
        }
        return [{
            status: 'added',
            competitor,
            detail: normalizeText(result.message ?? result.status) || `Competitor queued on project ${projectId}`,
            next: `webcmd meridian competitors ${projectId}`,
        }];
    },
});
