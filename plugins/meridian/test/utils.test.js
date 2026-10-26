import { describe, expect, it } from 'vitest';
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@agentrhq/webcmd/errors';
import {
    IDEATION_STATE_KEY,
    apiFetch, collectTurnSources, formatConfidence, formatSuggestions, loadPageState, normalizeText,
    parseBoolFlag, pollJob, requireBoundedInt, requireNonEmptyText, requireProjectId,
    savePageState, toHttpsUrlOrNull,
} from '../utils.js';
import { failFetch, makeMeridianPage, okFetch } from './helpers.js';

describe('meridian input validation helpers', () => {
    it('normalizeText collapses whitespace', () => {
        expect(normalizeText('  a \n b\t c ')).toBe('a b c');
        expect(normalizeText(null)).toBe('');
    });

    it('requireNonEmptyText throws ArgumentError on blank input', () => {
        expect(() => requireNonEmptyText('  ', 'message')).toThrow(ArgumentError);
        expect(requireNonEmptyText(' hi ', 'message')).toBe('hi');
    });

    it('requireProjectId throws ArgumentError with a discovery hint', () => {
        expect(() => requireProjectId('')).toThrow(ArgumentError);
        expect(requireProjectId(' init_abc123 ')).toBe('init_abc123');
    });

    it('requireBoundedInt enforces bounds and integer-ness', () => {
        expect(requireBoundedInt(undefined, 180, 10, 600, '--timeout')).toBe(180);
        expect(requireBoundedInt(60, 180, 10, 600, '--timeout')).toBe(60);
        expect(() => requireBoundedInt(5, 180, 10, 600, '--timeout')).toThrow(ArgumentError);
        expect(() => requireBoundedInt('abc', 180, 10, 600, '--timeout')).toThrow(ArgumentError);
    });

    it('parseBoolFlag accepts booleans and "true" strings only', () => {
        expect(parseBoolFlag(true)).toBe(true);
        expect(parseBoolFlag('true')).toBe(true);
        expect(parseBoolFlag('false')).toBe(false);
        expect(parseBoolFlag(undefined)).toBe(false);
    });

    it('toHttpsUrlOrNull upgrades bare domains and rejects non-http schemes', () => {
        expect(toHttpsUrlOrNull('acme.ai')).toBe('https://acme.ai/');
        expect(toHttpsUrlOrNull('https://acme.ai/x')).toBe('https://acme.ai/x');
        expect(toHttpsUrlOrNull('javascript:alert(1)')).toBeNull();
        expect(toHttpsUrlOrNull('')).toBeNull();
    });

    it('formatSuggestions handles strings, label/value pairs, and duplicate labels', () => {
        expect(formatSuggestions(['a', { label: 'B', value: 'b-value' }, { label: 'same', value: 'same' }]))
            .toBe('a | B: b-value | same');
        expect(formatSuggestions(undefined)).toBe('');
    });

    it('formatConfidence renders every requested dimension with a numeric score', () => {
        expect(formatConfidence({ problem_statement: 0.9 }, ['problem_statement', 'solution']))
            .toBe('problem_statement=0.90 solution=0.00');
    });

    it('collectTurnSources mirrors the app: agent findings + visual items, deduped by URL', () => {
        const turn = {
            agents: [
                { agent: 'web_browsing', findings: [{ title: 'A', url: 'https://a.com' }] },
                { agent: 'web_browsing', findings: [{ title: 'A again', url: 'https://a.com' }] },
            ],
            visual: { items: [{ name: 'Acme', url: 'https://acme.ai' }, { name: 'No URL' }] },
        };
        expect(collectTurnSources(turn)).toBe('A — https://a.com | Acme — https://acme.ai');
        expect(collectTurnSources({})).toBe('');
    });
});

describe('meridian apiFetch', () => {
    it('returns parsed data on success', async () => {
        const page = makeMeridianPage({ fetchResults: [okFetch({ hello: 'world' })] });
        await expect(apiFetch(page, '/initiatives', { label: 'projects list' })).resolves.toEqual({ hello: 'world' });
    });

    it('throws AuthRequiredError when the session cookie is missing, before any request starts', async () => {
        const page = makeMeridianPage({ cookies: [] });
        await expect(apiFetch(page, '/initiatives')).rejects.toBeInstanceOf(AuthRequiredError);
        expect(page.state.kickoffs).toHaveLength(0);
    });

    it('throws AuthRequiredError on HTTP 401', async () => {
        const page = makeMeridianPage({ fetchResults: [failFetch(401, { detail: 'Not authenticated' })] });
        await expect(apiFetch(page, '/initiatives')).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('maps HTTP 402 to an actionable credits error', async () => {
        const page = makeMeridianPage({ fetchResults: [failFetch(402, { detail: 'Not enough credits' })] });
        await expect(apiFetch(page, '/initiatives')).rejects.toThrow(/credits/);
    });

    it('maps the structured subscription_required 403 to CommandExecutionError', async () => {
        const page = makeMeridianPage({
            fetchResults: [failFetch(403, { detail: { code: 'subscription_required', message: 'Subscribe to continue' } })],
        });
        await expect(apiFetch(page, '/initiatives')).rejects.toThrow(/subscription/);
    });

    it('treats a plain 403 as an auth failure', async () => {
        const page = makeMeridianPage({ fetchResults: [failFetch(403, { detail: 'Forbidden' })] });
        await expect(apiFetch(page, '/initiatives')).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('throws CommandExecutionError with the status on other HTTP failures', async () => {
        const page = makeMeridianPage({ fetchResults: [failFetch(500, { detail: 'boom' })] });
        await expect(apiFetch(page, '/initiatives')).rejects.toThrow(/HTTP 500/);
    });

    it('throws CommandExecutionError when the in-page fetch itself failed', async () => {
        const page = makeMeridianPage({ fetchResults: [{ pending: false, error: 'NetworkError' }] });
        await expect(apiFetch(page, '/initiatives')).rejects.toThrow(/NetworkError/);
    });

    it('keeps polling past pending entries until the request settles', async () => {
        const page = makeMeridianPage({ fetchResults: [{ pending: true }, { pending: true }, okFetch([1, 2])] });
        await expect(apiFetch(page, '/x')).resolves.toEqual([1, 2]);
    });

    it('throws a timeout CommandExecutionError when the deadline elapses', async () => {
        const page = makeMeridianPage();
        await expect(apiFetch(page, '/slow', { timeoutSeconds: 0, label: 'slow call' }))
            .rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('navigates to the Meridian app first when the tab is elsewhere', async () => {
        const page = makeMeridianPage({ href: 'https://example.com/', fetchResults: [okFetch({})] });
        await apiFetch(page, '/initiatives');
        expect(page.goto).toHaveBeenCalledWith('https://app.getmeridian.tech/', expect.anything());
    });
});

describe('meridian pollJob', () => {
    it('polls until the job completes and returns the final job', async () => {
        const page = makeMeridianPage({
            fetchResults: [okFetch({ status: 'running', progress: 40 }), okFetch({ status: 'completed', result: { ok: 1 } })],
        });
        const job = await pollJob(page, 'job_1', { label: 'setup' });
        expect(job.result).toEqual({ ok: 1 });
    });

    it('surfaces a failed job as CommandExecutionError with its error', async () => {
        const page = makeMeridianPage({ fetchResults: [okFetch({ status: 'failed', error: 'setup exploded' })] });
        await expect(pollJob(page, 'job_1', { label: 'setup' })).rejects.toThrow(/setup exploded/);
    });

    it('rejects a missing job id up front', async () => {
        const page = makeMeridianPage();
        await expect(pollJob(page, '', { label: 'setup' })).rejects.toBeInstanceOf(CommandExecutionError);
        expect(page.state.kickoffs).toHaveLength(0);
    });
});

describe('meridian chat state round-trip', () => {
    it('persists and reloads state through the page session storage', async () => {
        const page = makeMeridianPage();
        await savePageState(page, IDEATION_STATE_KEY, { messages: [{ role: 'user', content: 'hi' }], ready: false });
        const state = await loadPageState(page, IDEATION_STATE_KEY, { messages: [] });
        expect(state.messages).toEqual([{ role: 'user', content: 'hi' }]);
        expect(state.ready).toBe(false);
    });

    it('falls back to the provided default on corrupted state', async () => {
        const page = makeMeridianPage({ pageState: { [IDEATION_STATE_KEY]: '{not json' } });
        await expect(loadPageState(page, IDEATION_STATE_KEY, { messages: [] })).resolves.toEqual({ messages: [] });
    });
});
