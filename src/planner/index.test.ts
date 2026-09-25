import { afterEach, describe, expect, it } from 'vitest';
import { cli, getRegistry } from '../registry.js';
import {
  executeWorkflow,
  planNaturalLanguageGoal,
  validateWorkflow,
  type Workflow,
} from './index.js';
import { planWithGemini } from './gemini.js';

const registered = [
  'p3-source/search',
  'p3-source/extract',
  'p3-target/navigate',
  'p3-target/fill',
  'p3-target/submit',
];

afterEach(() => {
  for (const name of registered) getRegistry().delete(name);
});

describe('cross-site planner', () => {
  it('plans a natural-language goal and passes extracted Site A data to Site B', async () => {
    const fills: Array<Record<string, unknown>> = [];
    const submitted: Array<Record<string, unknown>> = [];
    cli({ site: 'p3-source', name: 'search', browser: false, access: 'read', description: '', args: [], func: async () => ({ result: 'event-42' }) });
    cli({
      site: 'p3-source', name: 'extract', browser: false, access: 'read', description: '', args: [],
      func: async args => ({ name: 'OB Fitness Challenge', date: '2026-10-04', location: 'Old Barracks', received: args.result }),
    });
    cli({ site: 'p3-target', name: 'navigate', browser: false, access: 'read', description: '', args: [], func: async () => ({ navigated: true }) });
    cli({ site: 'p3-target', name: 'fill', browser: false, access: 'write', description: '', args: [], func: async args => { fills.push(args); return { filled: true }; } });
    cli({ site: 'p3-target', name: 'submit', browser: false, access: 'write', description: '', args: [], func: async args => { submitted.push(args); return { submitted: true }; } });

    const workflow = planNaturalLanguageGoal(
      'Find the OB Fitness Challenge on Site A and submit its details on Site B.',
      {
        commands: {
          source: { search: 'p3-source/search', extract: 'p3-source/extract' },
          target: { navigate: 'p3-target/navigate', fill: 'p3-target/fill', submit: 'p3-target/submit' },
        },
      },
    );
    const execution = await executeWorkflow(workflow);

    expect(execution.context).toMatchObject({
      search: { result: 'event-42' },
      event: { name: 'OB Fitness Challenge', date: '2026-10-04', location: 'Old Barracks' },
    });
    expect(fills).toEqual([
      { field: 'name', value: 'OB Fitness Challenge' },
      { field: 'date', value: '2026-10-04' },
      { field: 'location', value: 'Old Barracks' },
    ]);
    expect(submitted).toEqual([{}]);
  });

  it('rejects a missing extracted value before execution', () => {
    const workflow = baseWorkflow({ outputs: { 'event.name': 'name' } });
    expect(() => validateWorkflow(workflow)).not.toThrow();
    return expect(executeWorkflow(workflow, {
      resolveCommand: () => ({ site: 'a', name: 'extract', browser: false, access: 'read', description: '', args: [] }),
      execute: async () => ({}),
    })).rejects.toThrow(/did not produce context\.event\.name/);
  });

  it('rejects unknown and future dependencies', () => {
    const unknown = baseWorkflow({ dependsOn: ['does-not-exist'] });
    expect(() => validateWorkflow(unknown)).toThrow(/unknown step/);

    const future: Workflow = {
      goal: 'invalid',
      steps: [
        { id: 'first', site: 'a', action: 'command', command: 'a/first', dependsOn: ['second'] },
        { id: 'second', site: 'a', action: 'command', command: 'a/second' },
      ],
    };
    expect(() => validateWorkflow(future)).toThrow(/not earlier/);
  });

  it('rejects consuming context before the producing step', () => {
    const workflow: Workflow = {
      goal: 'invalid',
      steps: [{ id: 'consumer', site: 'b', action: 'fill', command: 'b/fill', args: { value: '${{ context.event.name }}' } }],
    };
    expect(() => validateWorkflow(workflow)).toThrow(/consumes context\.event\.name before it is produced/);
  });

  it('runs browser scripts with context produced by an earlier script', async () => {
    const calls: Array<{ script: string; step: string }> = [];
    const workflow: Workflow = {
      goal: 'cross-site browser task',
      steps: [
        { id: 'source', site: 'site-a', action: 'extract', command: 'browser/run', script: 'return { name: "OB Fitness Challenge" };', outputs: { 'event.name': 'name' } },
        { id: 'target', site: 'site-b', action: 'fill', command: 'browser/run', dependsOn: ['source'], script: 'return { filled: workflowContext.event.name };' },
      ],
    };
    const result = await executeWorkflow(workflow, {
      executeScript: async (script, step) => {
        calls.push({ script, step: step.id });
        return step.id === 'source' ? { name: 'OB Fitness Challenge' } : { filled: 'OB Fitness Challenge' };
      },
    });
    expect(result.context.event).toEqual({ name: 'OB Fitness Challenge' });
    expect(calls[1]?.script).toContain('OB Fitness Challenge');
  });

  it('runs an evaluate step returned by Gemini without requiring an adapter', async () => {
    const workflow: Workflow = {
      goal: 'browser evaluate',
      steps: [{
        id: 'evaluate',
        site: 'site-a',
        action: 'extract',
        command: 'evaluate',
        args: { code: 'return { title: "OB Fitness Challenge" };' },
        outputs: { 'event.name': 'title' },
      }],
    };
    const result = await executeWorkflow(workflow, {
      executeScript: async script => {
        expect(script).toContain('return { title: "OB Fitness Challenge" }');
        return { title: 'OB Fitness Challenge' };
      },
    });
    expect(result.context.event).toEqual({ name: 'OB Fitness Challenge' });
  });

  it('translates a Gemini goto step into browser navigation', async () => {
    const workflow: Workflow = {
      goal: 'navigate',
      steps: [{ id: 'navigate', site: 'site-a', action: 'navigate', command: 'goto', args: { url: 'https://example.com' } }],
    };
    await expect(executeWorkflow(workflow, {
      executeScript: async script => {
        expect(script).toContain('page.goto("https://example.com")');
        return { url: 'https://example.com' };
      },
    })).resolves.toBeDefined();
  });

  it('derives a basic site URL when Gemini omits goto arguments', async () => {
    await expect(executeWorkflow({
      goal: 'open amazon',
      steps: [{ id: 'open', site: 'amazon', action: 'navigate', command: 'goto' }],
    }, {
      executeScript: async script => {
        expect(script).toContain('https://amazon.com');
        return { opened: true };
      },
    })).resolves.toBeDefined();
  });

  it('accepts only validated structured JSON from Gemini', async () => {
    const client = {
      models: {
        generateContent: async () => ({
          text: JSON.stringify({
            goal: 'find an event',
            steps: [{ id: 'find', site: 'site-a', action: 'search', command: 'browser/run', script: 'return { ok: true };' }],
          }),
        }),
      },
    } as never;
    const workflow = await planWithGemini('Find an event on Site A.', { client });
    expect(workflow.steps[0]?.command).toBe('browser/run');
  });
});

function baseWorkflow(overrides: Partial<Workflow['steps'][number]>): Workflow {
  return {
    goal: 'test',
    steps: [
      { id: 'source', site: 'a', action: 'extract', command: 'a/extract', ...overrides },
    ],
  };
}