import { ConfigError } from '../errors.js';
import { executeCommand } from '../execution.js';
import { getRegistry, type CliCommand, type CommandArgs } from '../registry.js';
import { sendCommand } from '../browser/daemon-client.js';
import { profileRouteParams, resolveProfileSelection } from '../browser/profile.js';

export type WorkflowAction = 'navigate' | 'search' | 'extract' | 'fill' | 'click' | 'submit' | 'command';

export interface WorkflowStep {
  id: string;
  site: string;
  action: WorkflowAction;
  command: string;
  args?: Record<string, unknown>;
  dependsOn?: string[];
  /** Map context paths to dot paths in the command result. */
  outputs?: Record<string, string>;
  /** Optional sandboxed Playwright program for adapter-free browser work. */
  script?: string;
}

export interface Workflow {
  goal: string;
  steps: WorkflowStep[];
}

export type WorkflowContext = Record<string, unknown>;

export interface WorkflowExecutionOptions {
  context?: WorkflowContext;
  profile?: string;
  session?: string;
  debug?: boolean;
  resolveCommand?: (step: WorkflowStep) => CliCommand | undefined;
  execute?: (command: CliCommand, args: CommandArgs, debug: boolean, step: WorkflowStep) => Promise<unknown>;
  executeScript?: (script: string, step: WorkflowStep, context: WorkflowContext) => Promise<unknown>;
}

export interface NaturalLanguagePlannerOptions {
  commands?: {
    source?: Partial<Record<WorkflowAction, string>>;
    target?: Partial<Record<WorkflowAction, string>>;
  };
}

export interface WorkflowExecutionResult {
  context: WorkflowContext;
  results: Record<string, unknown>;
}

const ACTIONS = new Set<WorkflowAction>(['navigate', 'search', 'extract', 'fill', 'click', 'submit', 'command']);
const TEMPLATE = /^\$\{\{\s*context\.([^}]+?)\s*\}\}$/;

/** Validate the workflow IR before any browser or adapter work starts. */
export function validateWorkflow(workflow: Workflow): void {
  if (!workflow || typeof workflow !== 'object' || !Array.isArray(workflow.steps) || workflow.steps.length === 0) {
    throw new ConfigError('Workflow must contain at least one step.', 'Provide an ordered workflow with executable steps.');
  }

  const ids = new Set<string>();
  const produced = new Set<string>();
  for (let index = 0; index < workflow.steps.length; index++) {
    const step = workflow.steps[index];
    if (!step?.id || ids.has(step.id)) throw invalidWorkflow(`Step IDs must be unique: "${step?.id ?? ''}".`);
    if (!step.site || !step.command || !ACTIONS.has(step.action)) throw invalidWorkflow(`Step "${step.id}" is missing a valid site, action, or command.`);
    ids.add(step.id);

    for (const dependency of step.dependsOn ?? []) {
      const dependencyIndex = workflow.steps.findIndex(candidate => candidate.id === dependency);
      if (dependencyIndex === -1) throw invalidWorkflow(`Step "${step.id}" depends on unknown step "${dependency}".`);
      if (dependencyIndex >= index) throw invalidWorkflow(`Step "${step.id}" depends on "${dependency}", which is not earlier in the workflow.`);
    }
    for (const reference of findContextReferences(step.args)) {
      if (!produced.has(reference)) throw invalidWorkflow(`Step "${step.id}" consumes context.${reference} before it is produced.`);
    }
    for (const key of Object.keys(step.outputs ?? {})) {
      if (!key || produced.has(key)) throw invalidWorkflow(`Workflow output "${key}" is produced more than once.`);
      produced.add(key);
    }
  }
}

/** Execute steps through Webcmd's existing command executor. */
export async function executeWorkflow(workflow: Workflow, options: WorkflowExecutionOptions = {}): Promise<WorkflowExecutionResult> {
  validateWorkflow(workflow);
  const context: WorkflowContext = options.context ?? {};
  const results: Record<string, unknown> = {};
  const resolveCommand = options.resolveCommand ?? ((step: WorkflowStep) => getRegistry().get(step.command) ?? getRegistry().get(`${step.site}/${step.command}`));
  const runCommand = options.execute ?? ((command, args, debug) => executeCommand(command, args, debug, {
    profile: options.profile,
    session: options.session,
  }));

  for (const step of workflow.steps) {
    const browserScript = getBrowserScript(step, context);
    if (browserScript !== undefined) {
      const result = await (options.executeScript ?? executeBrowserScript)(browserScript, step, context);
      results[step.id] = result;
      for (const [key, path] of Object.entries(step.outputs ?? {})) {
        const value = readPath(result, path);
        if (value === undefined || value === null) throw new ConfigError(`Step "${step.id}" did not produce context.${key} at result path "${path}".`, 'Check the browser script return value or workflow output mapping.');
        writePath(context, key, value);
      }
      continue;
    }
    const command = resolveCommand(step);
    if (!command) throw new ConfigError(`Workflow step "${step.id}" references unavailable command "${step.command}".`, 'Load the adapter or provide a resolveCommand function.');
    const args = resolveValue(step.args ?? {}, context) as CommandArgs;
    const result = await runCommand(command, args, options.debug ?? false, step);
    results[step.id] = result;
    for (const [key, path] of Object.entries(step.outputs ?? {})) {
      const value = readPath(result, path);
      if (value === undefined || value === null) throw new ConfigError(`Step "${step.id}" did not produce context.${key} at result path "${path}".`, 'Check the extraction command output or workflow output mapping.');
      writePath(context, key, value);
    }
  }
  return { context, results };
}

/** A deterministic baseline planner for the common find-then-submit shape. */
export function planNaturalLanguageGoal(goal: string, options: NaturalLanguagePlannerOptions = {}): Workflow {
  const match = goal.match(/^(?:find|locate|search for)\s+(.+?)\s+on\s+(.+?)\s+and\s+(?:submit|enter|use)\s+(?:its|the)?\s*(?:details|information|data)?\s*on\s+(.+?)\.?$/i);
  if (!match) throw new ConfigError('Could not decompose the goal into a source search and target submission.', 'Use a structured planner or provide a goal like: Find <item> on <source> and submit its details on <target>.');
  const [, query, sourceLabel, targetLabel] = match;
  const source = slug(sourceLabel);
  const target = slug(targetLabel);
  const sourceCommands = options.commands?.source ?? {};
  const targetCommands = options.commands?.target ?? {};
  const command = (site: 'source' | 'target', action: WorkflowAction): string => {
    const configured = site === 'source' ? sourceCommands[action] : targetCommands[action];
    return configured ?? `${site === 'source' ? source : target}/${action}`;
  };
  const fields = ['name', 'date', 'location'];
  return {
    goal,
    steps: [
      { id: 'source-search', site: source, action: 'search', command: command('source', 'search'), args: { query }, outputs: { 'search.result': 'result' } },
      { id: 'source-extract', site: source, action: 'extract', command: command('source', 'extract'), args: { result: '${{ context.search.result }}', fields }, dependsOn: ['source-search'], outputs: Object.fromEntries(fields.map(field => [`event.${field}`, field])) },
      { id: 'target-navigate', site: target, action: 'navigate', command: command('target', 'navigate') },
      ...fields.map(field => ({ id: `target-fill-${field}`, site: target, action: 'fill' as const, command: command('target', 'fill'), args: { field, value: `\${{ context.event.${field} }}` }, dependsOn: ['source-extract'] })),
      { id: 'target-submit', site: target, action: 'submit', command: command('target', 'submit'), dependsOn: fields.map(field => `target-fill-${field}`) },
    ],
  };
}

export const planGoal = planNaturalLanguageGoal;
export const runWorkflow = executeWorkflow;

/** Execute a planned workflow in an existing Webcmd browser Session. */
export async function runBrowserWorkflow(workflow: Workflow, options: WorkflowExecutionOptions & { session: string }): Promise<WorkflowExecutionResult> {
  const context = options.context ?? {};
  return executeWorkflow(workflow, {
    ...options,
    context,
    executeScript: options.executeScript ?? ((script) => sendCommand('run', {
      session: options.session,
      surface: 'browser',
      ...profileRouteParams(resolveProfileSelection(options.profile)),
      source: script,
      timeoutMs: 120_000,
      timeout: 125,
      snapshotMode: 'act',
    })),
  });
}

function invalidWorkflow(message: string): ConfigError {
  return new ConfigError(`Invalid workflow: ${message}`, 'Fix the workflow dependencies and output references before execution.');
}

function slug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function findContextReferences(value: unknown): string[] {
  const references: string[] = [];
  if (typeof value === 'string') {
    const match = value.match(TEMPLATE);
    if (match) references.push(match[1]);
  } else if (Array.isArray(value)) {
    for (const item of value) references.push(...findContextReferences(item));
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) references.push(...findContextReferences(item));
  }
  return references;
}

function resolveValue(value: unknown, context: WorkflowContext): unknown {
  if (typeof value === 'string') {
    const match = value.match(TEMPLATE);
    if (!match) return value;
    const resolved = readPath(context, match[1]);
    if (resolved === undefined || resolved === null) throw new ConfigError(`Missing workflow context value: context.${match[1]}`, 'Ensure the producing step ran successfully and mapped its output.');
    return resolved;
  }
  if (Array.isArray(value)) return value.map(item => resolveValue(item, context));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveValue(item, context)]));
  return value;
}

function readPath(value: unknown, path: string): unknown {
  const parts = path.replace(/^result\./, '').split('.').filter(Boolean);
  let current = value;
  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) current = (current as Record<string, unknown>)[part];
    else return undefined;
  }
  return current;
}

function writePath(target: WorkflowContext, path: string, value: unknown): void {
  const parts = path.split('.').filter(Boolean);
  let current: Record<string, unknown> = target;
  for (const part of parts.slice(0, -1)) {
    const existing = current[part];
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) current[part] = {};
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]!] = value;
}

function resolveScript(script: string, context: WorkflowContext): string {
  return `const workflowContext = ${JSON.stringify(context)};\n${script}`;
}

async function executeBrowserScript(_script: string, _step: WorkflowStep, _context: WorkflowContext): Promise<unknown> {
  throw new ConfigError('Browser scripts require an explicit Session.', 'Use runBrowserWorkflow with a Webcmd Session ID.');
}

function getBrowserScript(step: WorkflowStep, context: WorkflowContext): string | undefined {
  if (step.script) return resolveScript(step.script, context);
  const args = browserArgs(step, context);
  if (['evaluate', 'browser/run', 'run'].includes(step.command)) {
    const source = args.script ?? args.code ?? args.js;
    return typeof source === 'string' ? resolveScript(source, context) : undefined;
  }
  if (step.command === 'goto' || step.command === 'navigate') {
    const url = args.url ?? args.href ?? args.uri ?? args.destination ?? args.target ?? args.value ?? siteUrl(step.site);
    return typeof url === 'string'
      ? `await page.goto(${JSON.stringify(url)}); return { url: page.url(), title: await page.title() };`
      : undefined;
  }
  if (step.command === 'click') {
    const target = args.selector ?? args.ref ?? args.text;
    return typeof target === 'string'
      ? `await page.locator(${JSON.stringify(target)}).click(); return { clicked: true };`
      : undefined;
  }
  if (step.command === 'fill' || step.command === 'type') {
    const target = args.selector ?? args.ref;
    const value = args.value ?? args.text;
    return typeof target === 'string' && typeof value === 'string'
      ? `await page.locator(${JSON.stringify(target)}).fill(${JSON.stringify(value)}); return { filled: true };`
      : undefined;
  }
  if (step.command === 'press') {
    const key = args.key ?? args.text;
    return typeof key === 'string'
      ? `await page.keyboard.press(${JSON.stringify(key)}); return { pressed: true };`
      : undefined;
  }
  if (step.command === 'submit') {
    const target = args.selector ?? args.ref;
    return typeof target === 'string'
      ? `await page.locator(${JSON.stringify(target)}).click(); return { submitted: true };`
      : `await page.locator('button[type="submit"], input[type="submit"]').first().click(); return { submitted: true };`;
  }
  return undefined;
}

function browserArgs(step: WorkflowStep, context: WorkflowContext): Record<string, unknown> {
  const resolved = resolveValue(step.args ?? {}, context);
  if (!resolved || typeof resolved !== 'object' || Array.isArray(resolved)) return {};
  const record = resolved as Record<string, unknown>;
  for (const key of ['params', 'options', 'input']) {
    const nested = record[key];
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) return { ...record, ...(nested as Record<string, unknown>) };
  }
  return record;
}

function siteUrl(site: string): string | undefined {
  const normalized = site.trim().toLowerCase();
  if (!normalized || !/^[a-z0-9.-]+$/.test(normalized)) return undefined;
  if (normalized.includes('.')) return `https://${normalized}`;
  return `https://${normalized}.com`;
}