import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { MERIDIAN_DOMAIN, apiFetch, normalizeText, pollJob, requireBoundedInt, requireProjectId } from './utils.js';

export const competitorScanCommand = cli({
    site: 'meridian',
    name: 'competitor-scan',
    access: 'write',
    description: 'Run Meridian\'s competitor landscape scan so the board is rebuilt and prioritized for the project context (costs Meridian credits)',
    example: 'webcmd meridian competitor-scan <project-id>',
    domain: MERIDIAN_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    siteSession: 'persistent',
    args: [
        { name: 'project', positional: true, required: true, help: 'Meridian project id (see: webcmd meridian projects)' },
        { name: 'timeout', type: 'int', default: 300, help: 'Max seconds to wait for the scan job (30-600)' },
    ],
    columns: ['status', 'competitor_count', 'detail', 'next'],
    func: async (page, kwargs) => {
        const projectId = requireProjectId(kwargs.project);
        const timeoutSeconds = requireBoundedInt(kwargs.timeout, 300, 30, 600, 'meridian competitor-scan --timeout');
        const started = await apiFetch(page, `/initiatives/${encodeURIComponent(projectId)}/competitors/generate`, {
            method: 'POST',
            body: {},
            timeoutSeconds: 90,
            label: 'competitor scan',
        });
        const job = await pollJob(page, started?.job_id, { timeoutSeconds, label: 'competitor scan' });
        const competitors = Array.isArray(job?.result?.competitors) ? job.result.competitors.length : null;
        return [{
            status: 'completed',
            competitor_count: competitors,
            detail: normalizeText(job?.stage) || 'Competitor landscape rebuilt for the project context',
            next: `webcmd meridian competitors ${projectId}`,
        }];
    },
});
