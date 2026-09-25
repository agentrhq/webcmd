import type {
  HealthResponse,
  BrowserSession,
  SiteSummary,
  SiteMemoryFile,
  StoredWorkflow,
  CandidateItem,
  CheckpointItem,
  TaskExecutionResponse,
  CliCommandResult,
} from './types';

const API_BASE = '/api';

async function fetchJson<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `HTTP error ${res.status}`);
  }
  return data;
}

export const api = {
  // System Health
  getHealth: () => fetchJson<HealthResponse>('/health'),

  // Browser Sessions
  getSessions: () => fetchJson<{ ok: boolean; sessions: BrowserSession[] }>('/sessions'),
  createSession: (name: string) =>
    fetchJson<{ ok: boolean; session: BrowserSession }>('/sessions', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  closeSession: (id: string) =>
    fetchJson<{ ok: boolean; message: string }>(`/sessions/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  getSessionTabs: (id: string) =>
    fetchJson<{ ok: boolean; tabs: any[] }>(`/sessions/${encodeURIComponent(id)}/tabs`),
  getSessionSnapshot: (id: string, mode: 'act' | 'tree' = 'act') =>
    fetchJson<{ ok: boolean; snapshot: any }>(`/sessions/${encodeURIComponent(id)}/snapshot?mode=${mode}`),

  // Browser Execution
  runScript: (session: string, script: string, timeout?: number) =>
    fetchJson<{ ok: boolean; result: any }>('/browser/run', {
      method: 'POST',
      body: JSON.stringify({ session, script, timeout }),
    }),

  // Universal Task Execution
  executeTask: (payload: { url: string; task: string; session?: string }) =>
    fetchJson<TaskExecutionResponse>('/task/execute', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Replay Workflow
  replayTask: (payload: { session?: string; workflowId?: string; script?: string }) =>
    fetchJson<{ ok: boolean; session: string; durationMs: number; result: any; limits?: any; timings?: any }>(
      '/task/replay',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  // Learned Sites
  getSites: () => fetchJson<{ ok: boolean; sites: SiteSummary[] }>('/sites'),
  getSiteMemory: (site: string) =>
    fetchJson<{ ok: boolean; site: string; memory: SiteMemoryFile[] }>(`/sites/${encodeURIComponent(site)}`),
  addSiteNote: (site: string, text: string, author?: string) =>
    fetchJson<{ ok: boolean; message: string }>(`/sites/${encodeURIComponent(site)}/notes`, {
      method: 'POST',
      body: JSON.stringify({ text, author }),
    }),

  // Workflows
  getWorkflows: () => fetchJson<{ ok: boolean; workflows: StoredWorkflow[] }>('/workflows'),
  saveWorkflow: (workflow: Partial<StoredWorkflow>) =>
    fetchJson<{ ok: boolean; workflow: StoredWorkflow }>('/workflows', {
      method: 'POST',
      body: JSON.stringify(workflow),
    }),

  // Candidates
  getCandidates: (product?: string) =>
    fetchJson<{ ok: boolean; candidates: CandidateItem[] }>(
      product ? `/candidates?product=${encodeURIComponent(product)}` : '/candidates'
    ),
  addCandidate: (candidate: Partial<CandidateItem>) =>
    fetchJson<{ ok: boolean; candidate: any }>('/candidates', {
      method: 'POST',
      body: JSON.stringify(candidate),
    }),

  // Checkpoints
  getCheckpoints: (product?: string) =>
    fetchJson<{ ok: boolean; checkpoints: CheckpointItem[] }>(
      product ? `/checkpoints?product=${encodeURIComponent(product)}` : '/checkpoints'
    ),

  // Developer Console
  execCommand: (command: string, stdin?: string) =>
    fetchJson<CliCommandResult>('/terminal/exec', {
      method: 'POST',
      body: JSON.stringify({ command, stdin }),
    }),
};
