import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { ArgumentError, CommandExecutionError } from '@agentrhq/webcmd/errors';
import {
    IDEATION_STATE_KEY, MERIDIAN_APP_ORIGIN, MERIDIAN_DOMAIN,
    apiFetch, clearPageState, loadPageState, normalizeText, parseBoolFlag, pollJob, requireBoundedInt,
} from './utils.js';

// Same payload mapping as the app's buildInitiativeDraft — the backend expects
// this exact initiative shape on start-initiative-job.
function buildInitiativePayload(summary) {
    return {
        name: normalizeText(summary.initiative_name)
            || normalizeText(summary.solution || summary.problem_statement || 'New Project').split(/[.!?]/)[0].slice(0, 60),
        problem_statement: summary.problem_statement || '',
        value_proposition: summary.solution || '',
        product_definition: summary.solution || '',
        market_definition: summary.market_opportunity || '',
        current_stage: summary.current_stage || 'IDEATION',
        goal_stage: summary.goal_stage || 'PMF',
        burn_rate_monthly: summary.burn_rate_monthly ?? null,
        operating_capital: summary.operating_capital ?? null,
        goal_eta: summary.goal_eta || '',
        repo_ids: [],
    };
}

export const approveCommand = cli({
    site: 'meridian',
    name: 'approve',
    access: 'write',
    description: 'Approve the ready ideation draft and start the project in your Meridian account (costs Meridian credits)',
    example: 'webcmd meridian approve -f json',
    domain: MERIDIAN_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    siteSession: 'persistent',
    args: [
        { name: 'force', type: 'boolean', default: false, help: 'Start even if Astra has not marked the draft ready' },
        { name: 'timeout', type: 'int', default: 360, help: 'Max seconds to wait for Astra to set the project up (30-600)' },
    ],
    columns: ['status', 'project_id', 'project_name', 'url', 'detail'],
    func: async (page, kwargs) => {
        const timeoutSeconds = requireBoundedInt(kwargs.timeout, 360, 30, 600, 'meridian approve --timeout');
        const state = await loadPageState(page, IDEATION_STATE_KEY, { messages: [] });
        if (!Array.isArray(state.messages) || !state.messages.length || !state.assessment) {
            throw new ArgumentError(
                'no ideation draft found in this browser session',
                'Draft one first: webcmd meridian ideate "<your idea>"',
            );
        }
        if (!state.ready && !parseBoolFlag(kwargs.force)) {
            throw new ArgumentError(
                'the ideation draft has not reached the Approve & Start stage yet',
                'Keep answering Astra via `webcmd meridian ideate "..."` until stage=ready_to_start, or pass --force.',
            );
        }

        const summary = state.assessment.summary && typeof state.assessment.summary === 'object'
            ? state.assessment.summary
            : {};
        const started = await apiFetch(page, '/astra/onboarding/start-initiative-job', {
            method: 'POST',
            body: {
                initiative: buildInitiativePayload(summary),
                messages: state.messages.map((entry) => ({ role: entry.role, content: entry.content })),
                links: Array.isArray(state.links) ? state.links : [],
                documents: Array.isArray(state.documents) ? state.documents : [],
                assessment: state.assessment,
            },
            timeoutSeconds: 90,
            label: 'project start',
        });
        const job = await pollJob(page, started?.job_id, { timeoutSeconds, label: 'project setup' });

        const initiative = job?.result?.initiative;
        const projectId = String(initiative?.id ?? '');
        if (!projectId) {
            throw new CommandExecutionError(
                `Meridian project setup finished without a project id: ${JSON.stringify(job?.result ?? {}).slice(0, 300)}`,
            );
        }
        // The draft became a real project — retire the saved draft card. Best
        // effort: the project already exists even if this cleanup fails.
        if (state.session_id) {
            try {
                await apiFetch(page, `/astra/onboarding/draft-sessions/${encodeURIComponent(state.session_id)}/discard`, {
                    method: 'POST',
                    body: {},
                    timeoutSeconds: 30,
                    label: 'draft discard',
                });
            } catch {
                // Non-fatal cleanup.
            }
        }
        await clearPageState(page, IDEATION_STATE_KEY);

        const redirect = normalizeText(job?.result?.redirect);
        return [{
            status: 'started',
            project_id: projectId,
            project_name: normalizeText(initiative?.name) || null,
            url: `${MERIDIAN_APP_ORIGIN}${redirect || `/app/initiatives/${projectId}/dashboard`}`,
            detail: 'Astra set the project up (starter persona, competitor scan, first signals). Next: webcmd meridian agent-status ' + projectId,
        }];
    },
});
