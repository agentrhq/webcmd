import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { CommandExecutionError } from '@agentrhq/webcmd/errors';
import {
    IDEATION_STATE_KEY, MERIDIAN_DOMAIN,
    apiFetch, clearPageState, collectTurnSources, formatConfidence, formatSuggestions,
    loadPageState, newDraftSessionId, normalizeText, parseBoolFlag, requireBoundedInt,
    requireNonEmptyText, savePageState,
} from './utils.js';

const CONFIDENCE_FIELDS = ['problem_statement', 'solution', 'market_opportunity'];
const EMPTY_IDEATION_STATE = { messages: [], links: [], documents: [] };

function formatStagePlan(stagePlan) {
    const stages = Array.isArray(stagePlan?.stages) ? stagePlan.stages : [];
    return stages
        .map((stage) => {
            const key = normalizeText(stage?.key ?? stage?.title);
            const description = normalizeText(stage?.description);
            return description ? `${key}: ${description}` : key;
        })
        .filter(Boolean)
        .join(' | ');
}

export const ideateCommand = cli({
    site: 'meridian',
    name: 'ideate',
    access: 'write',
    description: 'Send one turn of the Astra ideation chat; repeat until the draft reaches the Approve & Start stage',
    example: 'webcmd meridian ideate "An AI copilot that validates startup ideas" -f json',
    domain: MERIDIAN_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    siteSession: 'persistent',
    args: [
        { name: 'message', positional: true, required: true, help: 'Your idea, or the answer to Astra\'s last question' },
        { name: 'research', type: 'boolean', default: false, help: 'Ask Astra to run web research on this turn' },
        { name: 'reset', type: 'boolean', default: false, help: 'Discard the current draft conversation and start over' },
        { name: 'timeout', type: 'int', default: 240, help: 'Max seconds to wait for the Astra turn (10-600)' },
    ],
    columns: [
        'stage', 'reply', 'problem_statement', 'solution', 'market_opportunity', 'differentiation',
        'readiness', 'missing_context', 'suggestions', 'plan', 'research_sources',
    ],
    func: async (page, kwargs) => {
        const message = requireNonEmptyText(
            kwargs.message,
            'meridian ideate message',
            'Example: webcmd meridian ideate "AI agents that test mobile apps"',
        );
        const timeoutSeconds = requireBoundedInt(kwargs.timeout, 240, 10, 600, 'meridian ideate --timeout');
        if (parseBoolFlag(kwargs.reset)) await clearPageState(page, IDEATION_STATE_KEY);

        const state = await loadPageState(page, IDEATION_STATE_KEY, EMPTY_IDEATION_STATE);
        const sessionId = state.session_id || newDraftSessionId();
        const messages = [...state.messages, { role: 'user', content: message }];

        const turn = await apiFetch(page, '/astra/onboarding/draft-message', {
            method: 'POST',
            body: {
                messages,
                documents: state.documents,
                previous_confidence: state.confidence ?? Object.fromEntries(CONFIDENCE_FIELDS.map((field) => [field, 0])),
                session_id: sessionId,
                web_search: parseBoolFlag(kwargs.research),
            },
            timeoutSeconds,
            label: 'ideation turn',
        });
        if (!turn || typeof turn !== 'object') {
            throw new CommandExecutionError('Meridian ideation turn returned an unreadable response');
        }
        if (turn.blocked === true || turn.phase === 'blocked') {
            throw new CommandExecutionError(
                'Astra declined this idea (content-safety guardrail). Rephrase the idea and re-run with --reset.',
            );
        }

        const reply = normalizeText(turn.reply);
        const summary = turn.summary && typeof turn.summary === 'object' ? turn.summary : {};
        const ready = turn.ready_to_start === true;
        const nextMessages = [...messages, { role: 'assistant', content: reply }];

        await savePageState(page, IDEATION_STATE_KEY, {
            session_id: sessionId,
            messages: nextMessages,
            documents: state.documents,
            links: state.links,
            confidence: turn.confidence ?? {},
            assessment: turn,
            ready,
        });
        // Mirror the app's autosave so the draft shows up (and stays resumable)
        // in the user's Meridian account; a failure here must not eat the turn.
        try {
            await apiFetch(page, '/astra/onboarding/autosave-session', {
                method: 'POST',
                body: { session_id: sessionId, messages: nextMessages, assessment: turn, documents: state.documents, links: state.links },
                timeoutSeconds: 30,
                label: 'draft autosave',
            });
        } catch {
            // Draft autosave is a convenience mirror; the turn already succeeded.
        }

        return [{
            stage: ready ? 'ready_to_start' : 'in_progress',
            reply,
            problem_statement: normalizeText(summary.problem_statement) || null,
            solution: normalizeText(summary.solution) || null,
            market_opportunity: normalizeText(summary.market_opportunity) || null,
            differentiation: normalizeText(turn.differentiation) || null,
            readiness: formatConfidence(turn.confidence, CONFIDENCE_FIELDS),
            missing_context: Array.isArray(turn.missing_context) ? turn.missing_context.join(', ') || null : null,
            suggestions: formatSuggestions(turn.suggestions) || null,
            plan: formatStagePlan(turn.stage_plan) || null,
            research_sources: collectTurnSources(turn) || null,
        }];
    },
});
