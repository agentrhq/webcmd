import { GoogleGenAI } from '@google/genai';
import { ConfigError } from '../errors.js';
import { validateWorkflow, type Workflow } from './index.js';

export interface GeminiPlannerOptions {
  apiKey?: string;
  model?: string;
  client?: Pick<GoogleGenAI, 'models'>;
}

const WORKFLOW_SCHEMA = {
  type: 'object',
  properties: {
    goal: { type: 'string' },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          site: { type: 'string' },
          action: { type: 'string', enum: ['navigate', 'search', 'extract', 'fill', 'click', 'submit', 'command'] },
          command: { type: 'string' },
          args: { type: 'object' },
          dependsOn: { type: 'array', items: { type: 'string' } },
          outputs: { type: 'object' },
          script: { type: 'string' },
        },
        required: ['id', 'site', 'action', 'command'],
      },
    },
  },
  required: ['goal', 'steps'],
} as const;

export async function planWithGemini(goal: string, options: GeminiPlannerOptions = {}): Promise<Workflow> {
  const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
  if (!apiKey && !options.client) {
    throw new ConfigError('GEMINI_API_KEY is not configured.', 'Set GEMINI_API_KEY in the local environment and retry.');
  }
  const client = options.client ?? new GoogleGenAI({ apiKey: apiKey! });
  const response = await client.models.generateContent({
    model: options.model ?? process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
    contents: [
      'Create an executable Webcmd browser workflow for this user goal:\n\n',
      goal,
      '\n\nReturn only JSON matching the supplied schema. Use one or more steps per website. Prefer a sandboxed Playwright script in `script` for browser actions. Each script must return JSON-serializable data. Use `workflowContext` to consume values extracted by earlier steps. Never invent credentials, and mark external writes as submit actions.',
    ].join(''),
    config: {
      responseMimeType: 'application/json',
      responseSchema: WORKFLOW_SCHEMA,
      systemInstruction: 'You are a careful browser workflow planner. Produce only validated, ordered, executable steps. A step that consumes context must depend on the producing step.',
    },
  });
  const text = response.text?.trim();
  if (!text) throw new ConfigError('Gemini returned an empty workflow.', 'Retry the goal or check Gemini availability.');
  let workflow: Workflow;
  try {
    workflow = JSON.parse(text) as Workflow;
  } catch {
    throw new ConfigError('Gemini returned invalid workflow JSON.', 'Retry the goal; the model response must be JSON matching the workflow schema.');
  }
  validateWorkflow(workflow);
  return workflow;
}
