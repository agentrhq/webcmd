export interface DaemonInfo {
  connected: boolean;
  running: boolean;
  port: number;
  version: string;
  runtimeName: string;
}

export interface SystemStats {
  activeSessions: number;
  totalSessions: number;
  learnedSitesCount: number;
  workflowsCount: number;
}

export interface HealthResponse {
  ok: boolean;
  webcmdVersion: string;
  daemon: DaemonInfo;
  stats: SystemStats;
  nodeVersion: string;
  platform: string;
}

export interface BrowserSession {
  id: string;
  profileId: string;
  kind: 'explicit' | 'adapter-default';
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string;
  rowKind?: 'session' | 'discovered';
  runtimeState: 'idle' | 'active' | 'available';
  window?: string;
  page?: string;
  tabCount?: number;
  ownership?: string;
  title?: string;
  url?: string;
  handoff?: string;
}

export interface SiteSummary {
  key: string;
  domain: string;
  hasNotes: boolean;
  hasSitemap: boolean;
  hasEndpoints: boolean;
  updatedAt: string;
}

export interface SiteMemoryFile {
  path: string;
  body: string;
}

export interface StoredWorkflow {
  id: string;
  site: string;
  name: string;
  task: string;
  url: string;
  steps: string[];
  locators: Record<string, string>;
  script: string;
  lastRunAt: string;
  lastDurationMs: number;
  status: 'verified' | 'ready' | 'pending';
  sampleResults?: any[];
}

export interface CandidateItem {
  id: string;
  product?: string;
  domain?: string;
  hostname?: string;
  kind: string;
  claim: string;
  evidence: string;
  consequence: string;
  status: 'pending' | 'ingested' | 'rejected';
  observed_at?: string;
  observedDateUtc?: string;
}

export interface CheckpointItem {
  product: string;
  revision: string;
  reason: string;
  timestamp: string;
  paths: string[];
  status: string;
}

export interface TaskLogEntry {
  timestamp: string;
  stage: 'DISCOVER' | 'OBSERVE' | 'LEARN' | 'VALIDATE' | 'CHECKPOINT' | 'REUSE';
  message: string;
  data?: any;
}

export interface TaskExecutionResponse {
  ok: boolean;
  session: string;
  domain: string;
  task: string;
  durationMs: number;
  logs: TaskLogEntry[];
  discoveredLocators: Record<string, string>;
  extractedItems: any[];
  page: {
    title: string;
    url: string;
  };
  snapshot?: any;
  workflow: StoredWorkflow;
  savedSiteMemory: {
    site: string;
    note: string;
  };
  error?: string;
}

export interface CliCommandResult {
  ok: boolean;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}
