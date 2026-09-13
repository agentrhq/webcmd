import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { ArgumentError, CommandExecutionError } from '@agentrhq/webcmd/errors';
import {
    MERIDIAN_DOMAIN,
    apiFetch, clearPageState, formatSuggestions, loadPageState, normalizeText, parseBoolFlag,
    personaStateKey, requireBoundedInt, requireProjectId, savePageState,
} from './utils.js';

const MAX_INTERVIEW_BYTES = 262_144;
const EMPTY_PERSONA_STATE = { messages: [] };

async function readInterviewFile(filePath) {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const absPath = path.default.resolve(String(filePath));
    if (!fs.default.existsSync(absPath)) {
        throw new ArgumentError(`interview file not found: ${absPath}`);
    }
    const stats = fs.default.statSync(absPath);
    if (stats.size > MAX_INTERVIEW_BYTES) {
        throw new ArgumentError(
            `interview file is ${(stats.size / 1024).toFixed(0)} KB; max is ${MAX_INTERVIEW_BYTES / 1024} KB of plain text`,
        );
    }
    return {
        filename: path.default.basename(absPath),
        text: fs.default.readFileSync(absPath, 'utf8'),
    };
}

export const personaCommand = cli({
    site: 'meridian',
    name: 'persona',
    access: 'write',
    description: 'Build and save an ideal-user persona from observed behaviours or user-interview notes',
    example: 'webcmd meridian persona <project-id> "Power users batch tasks on Sunday nights" -f json',
    domain: MERIDIAN_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    siteSession: 'persistent',
    args: [
        { name: 'project', positional: true, required: true, help: 'Meridian project id (see: webcmd meridian projects)' },
        {
            name: 'message',
            positional: true,
            required: false,
            help: 'Observed user behaviour, or the answer to Astra\'s last persona question',
        },
        {
            name: 'file',
            help: 'Plain-text user-interview notes to fold into the persona (txt/md, max 256 KB)',
            file: {
                direction: 'input',
                pathKind: 'file',
                multiple: false,
                contentTypes: ['text/plain', 'text/markdown'],
                maxBytes: MAX_INTERVIEW_BYTES,
            },
        },
        { name: 'reset', type: 'boolean', default: false, help: 'Discard the in-progress persona draft for this project' },
        { name: 'timeout', type: 'int', default: 180, help: 'Max seconds to wait for the persona turn (10-600)' },
    ],
    columns: ['status', 'reply', 'persona_id', 'persona_name', 'tagline', 'missing_fields', 'suggestions'],
    func: async (page, kwargs) => {
        const projectId = requireProjectId(kwargs.project);
        const timeoutSeconds = requireBoundedInt(kwargs.timeout, 180, 10, 600, 'meridian persona --timeout');
        const stateKey = personaStateKey(projectId);
        if (parseBoolFlag(kwargs.reset)) await clearPageState(page, stateKey);

        const message = normalizeText(kwargs.message);
        const documents = [];
        if (kwargs.file) documents.push(await readInterviewFile(kwargs.file));
        if (!message && !documents.length) {
            throw new ArgumentError(
                'meridian persona needs observed behaviour text or --file interview notes',
                'Example: webcmd meridian persona <project-id> "Churned users all mention onboarding friction"',
            );
        }

        const state = await loadPageState(page, stateKey, EMPTY_PERSONA_STATE);
        const messages = [
            ...state.messages,
            { role: 'user', content: message || 'Build the persona from the attached user-interview notes.' },
        ];
        const turn = await apiFetch(page, `/initiatives/${encodeURIComponent(projectId)}/personas/chat`, {
            method: 'POST',
            body: { messages, documents, summary: state.summary ?? {} },
            timeoutSeconds,
            label: 'persona turn',
        });
        if (!turn || typeof turn !== 'object') {
            throw new CommandExecutionError('Meridian persona turn returned an unreadable response');
        }

        const reply = normalizeText(turn.reply);
        const summary = turn.summary && typeof turn.summary === 'object' ? turn.summary : {};
        const missingFields = Array.isArray(turn.missing_fields) ? turn.missing_fields.join(', ') : '';

        if (turn.ready_to_save !== true) {
            await savePageState(page, stateKey, {
                messages: [...messages, { role: 'assistant', content: reply }],
                summary,
            });
            return [{
                status: 'in_progress',
                reply,
                persona_id: null,
                persona_name: normalizeText(summary.name) || null,
                tagline: normalizeText(summary.tagline) || null,
                missing_fields: missingFields || null,
                suggestions: formatSuggestions(turn.suggestions) || null,
            }];
        }

        // Astra committed a full draft — save it to the account, like the app's
        // chat drawer does on ready_to_save.
        const saved = await apiFetch(page, `/initiatives/${encodeURIComponent(projectId)}/personas`, {
            method: 'POST',
            body: { summary, source: 'astra' },
            timeoutSeconds: 60,
            label: 'persona save',
        });
        await clearPageState(page, stateKey);
        return [{
            status: 'saved',
            reply,
            persona_id: String(saved?.id ?? '') || null,
            persona_name: normalizeText(saved?.name ?? summary.name) || null,
            tagline: normalizeText(saved?.tagline ?? summary.tagline) || null,
            missing_fields: null,
            suggestions: null,
        }];
    },
});
