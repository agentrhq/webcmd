import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { MERIDIAN_DOMAIN, apiFetch, normalizeText, requireProjectId } from './utils.js';

export const agentPauseCommand = cli({
    site: 'meridian',
    name: 'agent-pause',
    access: 'write',
    description: 'Pause the Astra background agent on a Meridian project',
    example: 'webcmd meridian agent-pause <project-id>',
    domain: MERIDIAN_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    siteSession: 'persistent',
    args: [
        { name: 'project', positional: true, required: true, help: 'Meridian project id (see: webcmd meridian projects)' },
    ],
    columns: ['status', 'detail', 'next'],
    func: async (page, kwargs) => {
        const projectId = requireProjectId(kwargs.project);
        const instance = await apiFetch(page, `/astra/initiatives/${encodeURIComponent(projectId)}/pause`, {
            method: 'POST',
            body: {},
            label: 'agent pause',
        });
        return [{
            status: normalizeText(instance?.status) || 'PAUSED',
            detail: 'Astra background agent paused; resume any time to continue market intelligence',
            next: `webcmd meridian agent-start ${projectId}`,
        }];
    },
});
