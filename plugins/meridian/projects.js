import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';
import { MERIDIAN_APP_ORIGIN, MERIDIAN_DOMAIN, apiFetch, normalizeText } from './utils.js';

export const projectsCommand = cli({
    site: 'meridian',
    name: 'projects',
    access: 'read',
    description: 'List the projects (initiatives) in your Meridian account',
    example: 'webcmd meridian projects -f json',
    domain: MERIDIAN_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    siteSession: 'persistent',
    args: [],
    columns: ['id', 'name', 'stage', 'workflow', 'health', 'signals_validated', 'url'],
    func: async (page) => {
        const items = await apiFetch(page, '/initiatives', { label: 'projects list' });
        if (!Array.isArray(items)) {
            throw new CommandExecutionError('Meridian projects list returned an unexpected payload shape');
        }
        if (!items.length) {
            throw new EmptyResultError(
                'meridian projects',
                'No projects yet. Draft one with `webcmd meridian ideate "<your idea>"`, then `webcmd meridian approve`.',
            );
        }
        return items.map((item) => {
            const id = String(item?.id ?? '');
            const health = Number(item?.pdlc_health);
            const validated = Number(item?.signals_validated);
            return {
                id,
                name: normalizeText(item?.name) || null,
                stage: normalizeText(item?.current_stage) || null,
                workflow: normalizeText(item?.workflow_stage) || null,
                health: Number.isFinite(health) ? health : null,
                signals_validated: Number.isFinite(validated) ? validated : null,
                url: id ? `${MERIDIAN_APP_ORIGIN}/app/initiatives/${id}/dashboard` : null,
            };
        });
    },
});
