import { describe, expect, it } from 'vitest';
import { getRegistry } from '@agentrhq/webcmd/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';
import { IDEATION_STATE_KEY } from '../utils.js';
import { ideateCommand } from '../ideate.js';
import { approveCommand } from '../approve.js';
import { projectsCommand } from '../projects.js';
import { personaCommand } from '../persona.js';
import { personasCommand } from '../personas.js';
import { competitorsCommand } from '../competitors.js';
import { competitorAddCommand } from '../competitor-add.js';
import { competitorScanCommand } from '../competitor-scan.js';
import { agentStatusCommand } from '../agent-status.js';
import { agentStartCommand } from '../agent-start.js';
import { agentPauseCommand } from '../agent-pause.js';
import '../auth.js';
import { makeMeridianPage, okFetch } from './helpers.js';

describe('meridian command registration', () => {
    it('registers login and whoami through the shared auth runtime', () => {
        const registry = getRegistry();
        const login = registry.get('meridian/login');
        const whoami = registry.get('meridian/whoami');
        expect(login).toBeDefined();
        expect(whoami).toBeDefined();
        expect(login.access).toBe('write');
        expect(whoami.access).toBe('read');
        expect(whoami.columns).toEqual(['logged_in', 'site', 'email', 'name', 'org', 'credits']);
    });

    it('declares read/write access to match each command\'s side effects', () => {
        for (const command of [projectsCommand, personasCommand, competitorsCommand, agentStatusCommand]) {
            expect(command.access).toBe('read');
        }
        for (const command of [
            ideateCommand, approveCommand, personaCommand,
            competitorAddCommand, competitorScanCommand, agentStartCommand, agentPauseCommand,
        ]) {
            expect(command.access).toBe('write');
        }
    });

    it('keeps every command on the persistent Meridian site session', () => {
        for (const command of [
            ideateCommand, approveCommand, projectsCommand, personaCommand, personasCommand,
            competitorsCommand, competitorAddCommand, competitorScanCommand,
            agentStatusCommand, agentStartCommand, agentPauseCommand,
        ]) {
            expect(command.siteSession).toBe('persistent');
            expect(command.domain).toBe('getmeridian.tech');
        }
    });
});

describe('meridian ideate', () => {
    it('rejects an empty message with ArgumentError', async () => {
        const page = makeMeridianPage();
        await expect(ideateCommand.func(page, { message: '  ' })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('surfaces the content-safety guardrail as CommandExecutionError', async () => {
        const page = makeMeridianPage({ fetchResults: [okFetch({ blocked: true, phase: 'blocked' })] });
        await expect(ideateCommand.func(page, { message: 'idea' })).rejects.toThrow(/guardrail/);
    });

    it('returns in_progress rows while Astra keeps the Approve & Start gate closed', async () => {
        const turn = {
            reply: 'Tell me who has this problem.',
            phase: 'problem_statement',
            summary: { problem_statement: 'Founders lack validation' },
            confidence: { problem_statement: 0.4, solution: 0.1, market_opportunity: 0.0 },
            ready_to_start: false,
            missing_context: ['solution', 'market_opportunity'],
            suggestions: [{ label: 'Indie hackers', value: 'Indie hackers building B2B tools' }],
        };
        const page = makeMeridianPage({ fetchResults: [okFetch(turn), okFetch({ status: 'saved' })] });
        const rows = await ideateCommand.func(page, { message: 'An idea-validation copilot' });
        expect(rows).toHaveLength(1);
        expect(rows[0].stage).toBe('in_progress');
        expect(rows[0].problem_statement).toBe('Founders lack validation');
        expect(rows[0].missing_context).toBe('solution, market_opportunity');
        expect(rows[0].suggestions).toContain('Indie hackers');
        expect(Object.keys(rows[0]).sort()).toEqual([...ideateCommand.columns].sort());
    });

    it('reports ready_to_start with the stage plan and research sources on the ready turn', async () => {
        const turn = {
            reply: 'Got everything needed. Please approve the plan and start the project.',
            phase: 'ready',
            summary: { problem_statement: 'P', solution: 'S', market_opportunity: 'M' },
            confidence: { problem_statement: 0.9, solution: 0.88, market_opportunity: 0.86 },
            ready_to_start: true,
            missing_context: [],
            differentiation: 'Only player with live validation data',
            stage_plan: { stages: [
                { key: 'research', title: 'Research', description: 'Validate the problem' },
                { key: 'build', title: 'Build', description: 'Ship the MVP' },
                { key: 'release', title: 'Release', description: 'Launch and learn' },
            ] },
            agents: [{ agent: 'web_browsing', findings: [{ title: 'Competitor teardown', url: 'https://example.com/a' }] }],
            visual: { items: [{ name: 'Acme', url: 'https://acme.ai' }] },
        };
        const page = makeMeridianPage({ fetchResults: [okFetch(turn), okFetch({ status: 'saved' })] });
        const rows = await ideateCommand.func(page, { message: 'final answer' });
        expect(rows[0].stage).toBe('ready_to_start');
        expect(rows[0].differentiation).toBe('Only player with live validation data');
        expect(rows[0].plan).toBe('research: Validate the problem | build: Ship the MVP | release: Launch and learn');
        expect(rows[0].research_sources).toBe('Competitor teardown — https://example.com/a | Acme — https://acme.ai');
    });

    it('accumulates conversation history across turns in the page session', async () => {
        const page = makeMeridianPage({
            fetchResults: [
                okFetch({ reply: 'first reply', summary: {}, confidence: {}, ready_to_start: false }),
                okFetch({ status: 'saved' }),
                okFetch({ reply: 'second reply', summary: {}, confidence: {}, ready_to_start: false }),
                okFetch({ status: 'saved' }),
            ],
        });
        await ideateCommand.func(page, { message: 'turn one' });
        await ideateCommand.func(page, { message: 'turn two' });
        const saved = JSON.parse(page.state.storage[IDEATION_STATE_KEY]);
        expect(saved.messages.map((entry) => entry.content)).toEqual([
            'turn one', 'first reply', 'turn two', 'second reply',
        ]);
        expect(saved.session_id).toMatch(/^draft_/);
    });

    it('still returns the turn when the draft autosave mirror fails', async () => {
        const page = makeMeridianPage({
            fetchResults: [
                okFetch({ reply: 'ok', summary: {}, confidence: {}, ready_to_start: false }),
                { pending: false, error: 'NetworkError' },
            ],
        });
        const rows = await ideateCommand.func(page, { message: 'hello' });
        expect(rows[0].stage).toBe('in_progress');
    });
});

describe('meridian approve', () => {
    const readyState = JSON.stringify({
        session_id: 'draft_test1',
        messages: [{ role: 'user', content: 'x' }, { role: 'assistant', content: 'y' }],
        assessment: { summary: { initiative_name: 'Validation Copilot', problem_statement: 'P', solution: 'S' } },
        links: [],
        documents: [],
        ready: true,
    });

    it('requires an existing ideation draft', async () => {
        const page = makeMeridianPage();
        await expect(approveCommand.func(page, {})).rejects.toBeInstanceOf(ArgumentError);
    });

    it('refuses to start before the ready stage unless --force', async () => {
        const page = makeMeridianPage({
            pageState: { [IDEATION_STATE_KEY]: JSON.stringify({ messages: [{ role: 'user', content: 'x' }], assessment: { summary: {} }, ready: false }) },
        });
        await expect(approveCommand.func(page, {})).rejects.toBeInstanceOf(ArgumentError);
    });

    it('runs the setup job, discards the draft, and returns the new project', async () => {
        const page = makeMeridianPage({
            pageState: { [IDEATION_STATE_KEY]: readyState },
            fetchResults: [
                okFetch({ job_id: 'job_9', status: 'pending' }),
                okFetch({ status: 'completed', result: { initiative: { id: 'init_abc123', name: 'Validation Copilot' }, redirect: '/app/initiatives/init_abc123/ideal-customer' } }),
                okFetch({ status: 'discarded' }),
            ],
        });
        const rows = await approveCommand.func(page, {});
        expect(rows[0].status).toBe('started');
        expect(rows[0].project_id).toBe('init_abc123');
        expect(rows[0].url).toBe('https://app.getmeridian.tech/app/initiatives/init_abc123/ideal-customer');
        expect(page.state.storage[IDEATION_STATE_KEY]).toBeUndefined();
    });

    it('throws CommandExecutionError when the job finishes without a project id', async () => {
        const page = makeMeridianPage({
            pageState: { [IDEATION_STATE_KEY]: readyState },
            fetchResults: [okFetch({ job_id: 'job_9' }), okFetch({ status: 'completed', result: {} })],
        });
        await expect(approveCommand.func(page, {})).rejects.toBeInstanceOf(CommandExecutionError);
    });
});

describe('meridian project-scoped reads', () => {
    it('projects maps the bare initiative array onto stable rows', async () => {
        const page = makeMeridianPage({
            fetchResults: [okFetch([{
                id: 'init_1', name: 'Alpha', current_stage: 'IDEATION', workflow_stage: 'RESEARCH',
                pdlc_health: 62, signals_validated: 3,
            }])],
        });
        const rows = await projectsCommand.func(page, {});
        expect(rows).toEqual([{
            id: 'init_1', name: 'Alpha', stage: 'IDEATION', workflow: 'RESEARCH',
            health: 62, signals_validated: 3,
            url: 'https://app.getmeridian.tech/app/initiatives/init_1/dashboard',
        }]);
    });

    it('projects throws EmptyResultError with a next step when the account has none', async () => {
        const page = makeMeridianPage({ fetchResults: [okFetch([])] });
        await expect(projectsCommand.func(page, {})).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('personas requires a project id and rejects unexpected payloads', async () => {
        await expect(personasCommand.func(makeMeridianPage(), { project: '' })).rejects.toBeInstanceOf(ArgumentError);
        const page = makeMeridianPage({ fetchResults: [okFetch({ nope: true })] });
        await expect(personasCommand.func(page, { project: 'init_1' })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('competitors ranks the board by relevance score', async () => {
        const page = makeMeridianPage({
            fetchResults: [okFetch({
                competitors: [
                    { name: 'Beta', relevance_score: 55, website: 'https://beta.io', category: 'Indirect' },
                    {
                        name: 'Acme', relevance_score: 91, website: 'acme.ai', category: 'Direct',
                        unique_features: [{ name: 'Realtime sync', threat_level: 'HIGH' }],
                    },
                ],
                swot: {},
            })],
        });
        const rows = await competitorsCommand.func(page, { project: 'init_1' });
        expect(rows.map((row) => row.name)).toEqual(['Acme', 'Beta']);
        expect(rows[0].rank).toBe(1);
        expect(rows[0].top_threat).toBe('Realtime sync');
        expect(rows[0].website).toBe('https://acme.ai/');
    });
});

describe('meridian persona building', () => {
    it('needs behaviour text or an interview file', async () => {
        const page = makeMeridianPage();
        await expect(personaCommand.func(page, { project: 'init_1' })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('keeps the draft in progress while Astra still needs fields', async () => {
        const page = makeMeridianPage({
            fetchResults: [okFetch({
                reply: 'Who is this persona, in one line?',
                summary: { name: '' },
                ready_to_save: false,
                missing_fields: ['name', 'pains'],
                suggestions: ['A time-starved ops lead'],
            })],
        });
        const rows = await personaCommand.func(page, { project: 'init_1', message: 'users batch tasks at night' });
        expect(rows[0].status).toBe('in_progress');
        expect(rows[0].missing_fields).toBe('name, pains');
    });

    it('saves the persona to the account when Astra marks it ready', async () => {
        const page = makeMeridianPage({
            fetchResults: [
                okFetch({
                    reply: 'Persona ready.',
                    summary: { name: 'Ops Olivia', tagline: 'Automates busywork' },
                    ready_to_save: true,
                }),
                okFetch({ id: 'persona_1', name: 'Ops Olivia', tagline: 'Automates busywork' }),
            ],
        });
        const rows = await personaCommand.func(page, { project: 'init_1', message: 'users batch tasks at night' });
        expect(rows[0].status).toBe('saved');
        expect(rows[0].persona_id).toBe('persona_1');
        expect(page.state.kickoffs).toHaveLength(2);
    });
});

describe('meridian astra agent controls', () => {
    it('agent-status flattens the root state and branch map into rows', async () => {
        const page = makeMeridianPage({
            fetchResults: [okFetch({
                status: 'ACTIVE',
                root_state: 'WORKING',
                initiative_name: 'Alpha',
                awaiting_human: 1,
                branches: {
                    market_research: { state: 'WORKING', stage: 'SIGNAL', summary: 'Scanning competitors' },
                    synthesis: { state: 'IDLE', stage: 'SYNTHESIS' },
                },
            })],
        });
        const rows = await agentStatusCommand.func(page, { project: 'init_1' });
        expect(rows[0]).toEqual({ branch: 'root', state: 'ACTIVE', stage: 'WORKING', summary: 'Alpha — 1 checkpoint(s) awaiting you' });
        expect(rows).toHaveLength(3);
        expect(rows[1]).toEqual({ branch: 'market_research', state: 'WORKING', stage: 'SIGNAL', summary: 'Scanning competitors' });
    });

    it('agent-start resumes the agent and only scans with --scan', async () => {
        const page = makeMeridianPage({
            fetchResults: [okFetch({ status: 'ACTIVE' }), okFetch({ status: 'scanned' })],
        });
        const rows = await agentStartCommand.func(page, { project: 'init_1', scan: true });
        expect(page.state.kickoffs).toHaveLength(2);
        expect(rows[0].status).toBe('ACTIVE');
        expect(rows[0].detail).toContain('scan tick: scanned');
    });

    it('agent commands surface a missing session as AuthRequiredError', async () => {
        const page = makeMeridianPage({ cookies: [] });
        await expect(agentPauseCommand.func(page, { project: 'init_1' })).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('competitor-scan drives the generate job to completion', async () => {
        const page = makeMeridianPage({
            fetchResults: [
                okFetch({ job_id: 'job_c1' }),
                okFetch({ status: 'completed', stage: 'Scored competitors', result: { competitors: [{}, {}, {}] } }),
            ],
        });
        const rows = await competitorScanCommand.func(page, { project: 'init_1' });
        expect(rows[0].status).toBe('completed');
        expect(rows[0].competitor_count).toBe(3);
        expect(rows[0].next).toBe('webcmd meridian competitors init_1');
    });
});
