import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { MERIDIAN_DOMAIN, apiFetch, normalizeText, parseBoolFlag, requireBoundedInt, requireProjectId } from './utils.js';

export const agentStartCommand = cli({
    site: 'meridian',
    name: 'agent-start',
    access: 'write',
    description: 'Start (or resume) the Astra market-intelligence background agent on a Meridian project',
    example: 'webcmd meridian agent-start <project-id> --scan',
    domain: MERIDIAN_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    siteSession: 'persistent',
    args: [
        { name: 'project', positional: true, required: true, help: 'Meridian project id (see: webcmd meridian projects)' },
        { name: 'scan', type: 'boolean', default: false, help: 'Also run one blocking market-research scan tick right now' },
        { name: 'timeout', type: 'int', default: 240, help: 'Max seconds to wait for the --scan tick (30-600)' },
    ],
    columns: ['status', 'detail', 'next'],
    func: async (page, kwargs) => {
        const projectId = requireProjectId(kwargs.project);
        const timeoutSeconds = requireBoundedInt(kwargs.timeout, 240, 30, 600, 'meridian agent-start --timeout');
        const instance = await apiFetch(page, `/astra/initiatives/${encodeURIComponent(projectId)}/resume`, {
            method: 'POST',
            body: {},
            label: 'agent resume',
        });
        let detail = `Astra agent is ${normalizeText(instance?.status) || 'ACTIVE'}; it keeps researching, validating, and positioning in the background`;
        if (parseBoolFlag(kwargs.scan)) {
            const scanned = await apiFetch(page, `/astra/initiatives/${encodeURIComponent(projectId)}/scan-now`, {
                method: 'POST',
                body: {},
                timeoutSeconds,
                label: 'agent scan',
            });
            detail += ` | scan tick: ${normalizeText(scanned?.status) || 'done'}`;
        }
        return [{
            status: normalizeText(instance?.status) || 'ACTIVE',
            detail,
            next: `webcmd meridian agent-status ${projectId}`,
        }];
    },
});
