import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { CommandExecutionError } from '@agentrhq/webcmd/errors';
import { MERIDIAN_DOMAIN, apiFetch, normalizeText, requireProjectId } from './utils.js';

export const agentStatusCommand = cli({
    site: 'meridian',
    name: 'agent-status',
    access: 'read',
    description: 'Show the Astra background agent status and branch states for a Meridian project',
    example: 'webcmd meridian agent-status <project-id> -f json',
    domain: MERIDIAN_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    siteSession: 'persistent',
    args: [
        { name: 'project', positional: true, required: true, help: 'Meridian project id (see: webcmd meridian projects)' },
    ],
    columns: ['branch', 'state', 'stage', 'summary'],
    func: async (page, kwargs) => {
        const projectId = requireProjectId(kwargs.project);
        const overview = await apiFetch(page, `/astra/initiatives/${encodeURIComponent(projectId)}/overview`, {
            label: 'agent status',
        });
        if (!overview || typeof overview !== 'object') {
            throw new CommandExecutionError('Meridian agent status returned an unreadable response');
        }
        const awaiting = Number(overview.awaiting_human);
        const rootSummary = [
            normalizeText(overview.initiative_name),
            Number.isFinite(awaiting) && awaiting > 0 ? `${awaiting} checkpoint(s) awaiting you` : '',
        ].filter(Boolean).join(' — ');
        const rows = [{
            branch: 'root',
            state: normalizeText(overview.status) || 'UNKNOWN',
            stage: normalizeText(overview.root_state) || null,
            summary: rootSummary || null,
        }];
        const branches = overview.branches && typeof overview.branches === 'object' ? overview.branches : {};
        for (const [branch, info] of Object.entries(branches)) {
            rows.push({
                branch,
                state: normalizeText(info?.state) || 'UNKNOWN',
                stage: normalizeText(info?.stage) || null,
                summary: normalizeText(info?.summary) || null,
            });
        }
        return rows;
    },
});
