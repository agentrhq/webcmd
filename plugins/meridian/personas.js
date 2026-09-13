import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';
import { MERIDIAN_DOMAIN, apiFetch, normalizeText, requireProjectId } from './utils.js';

export const personasCommand = cli({
    site: 'meridian',
    name: 'personas',
    access: 'read',
    description: 'List the ideal-user personas saved on a Meridian project',
    example: 'webcmd meridian personas <project-id> -f json',
    domain: MERIDIAN_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    siteSession: 'persistent',
    args: [
        { name: 'project', positional: true, required: true, help: 'Meridian project id (see: webcmd meridian projects)' },
    ],
    columns: ['id', 'name', 'tagline', 'identity', 'pains', 'completeness', 'source'],
    func: async (page, kwargs) => {
        const projectId = requireProjectId(kwargs.project);
        const items = await apiFetch(page, `/initiatives/${encodeURIComponent(projectId)}/personas`, {
            label: 'personas list',
        });
        if (!Array.isArray(items)) {
            throw new CommandExecutionError('Meridian personas list returned an unexpected payload shape');
        }
        if (!items.length) {
            throw new EmptyResultError(
                'meridian personas',
                'No personas on this project yet. Build one with `webcmd meridian persona <project-id> "<observed behaviour>"`.',
            );
        }
        return items.map((item) => {
            const completeness = Number(item?.completeness);
            return {
                id: String(item?.id ?? ''),
                name: normalizeText(item?.name) || null,
                tagline: normalizeText(item?.tagline) || null,
                identity: normalizeText(item?.identity) || null,
                pains: Array.isArray(item?.pains) ? item.pains.map(normalizeText).filter(Boolean).join('; ') || null : null,
                completeness: Number.isFinite(completeness) ? completeness : null,
                source: normalizeText(item?.source) || null,
            };
        });
    },
});
