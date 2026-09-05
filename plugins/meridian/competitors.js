import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';
import { MERIDIAN_DOMAIN, apiFetch, normalizeText, requireProjectId, toHttpsUrlOrNull } from './utils.js';

export const competitorsCommand = cli({
    site: 'meridian',
    name: 'competitors',
    access: 'read',
    description: 'List the competitor board of a Meridian project, prioritized by relevance to its context',
    example: 'webcmd meridian competitors <project-id> -f json',
    domain: MERIDIAN_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    siteSession: 'persistent',
    args: [
        { name: 'project', positional: true, required: true, help: 'Meridian project id (see: webcmd meridian projects)' },
    ],
    columns: ['rank', 'name', 'category', 'relevance', 'description', 'top_threat', 'website'],
    func: async (page, kwargs) => {
        const projectId = requireProjectId(kwargs.project);
        const analysis = await apiFetch(page, `/initiatives/${encodeURIComponent(projectId)}/competitors`, {
            label: 'competitors list',
        });
        const items = Array.isArray(analysis?.competitors) ? analysis.competitors : null;
        if (!items) {
            throw new CommandExecutionError('Meridian competitors list returned an unexpected payload shape');
        }
        if (!items.length) {
            throw new EmptyResultError(
                'meridian competitors',
                'No competitors on this project yet. Run `webcmd meridian competitor-scan <project-id>` or add one with competitor-add.',
            );
        }
        const scored = items.map((item) => ({
            item,
            relevance: Number.isFinite(Number(item?.relevance_score)) ? Number(item.relevance_score) : 0,
        }));
        scored.sort((a, b) => b.relevance - a.relevance);
        return scored.map(({ item, relevance }, index) => {
            const threats = Array.isArray(item?.unique_features) ? item.unique_features : [];
            const topThreat = threats.find((feature) => feature?.threat_level === 'HIGH') ?? threats[0];
            return {
                rank: index + 1,
                name: normalizeText(item?.name) || null,
                category: normalizeText(item?.category) || null,
                relevance,
                description: normalizeText(item?.description) || null,
                top_threat: normalizeText(topThreat?.name) || null,
                website: toHttpsUrlOrNull(item?.website),
            };
        });
    },
});
