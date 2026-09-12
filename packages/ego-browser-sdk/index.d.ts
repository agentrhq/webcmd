export interface TaskSpaceNavigateResult {
  status: number;
  url: string;
  profile: string;
  isolationId: string;
  timestamp: number;
}

export interface TaskSpaceJsResult {
  executed: boolean;
  scriptLength: number;
  selectorPatched: string;
  injectedValue: string;
  domMutationSuccess: boolean;
}

export interface TaskSpaceCloseResult {
  spaceId: string;
  closed: boolean;
}

export class EgoTaskSpace {
  spaceId: string;
  constructor(spaceId: string, options?: Record<string, unknown>);
  navigate(url: string): Promise<TaskSpaceNavigateResult>;
  snapshotText(): Promise<string>;
  js(script: string): Promise<TaskSpaceJsResult>;
  close(): Promise<TaskSpaceCloseResult>;
}

export class EgoBrowser {
  constructor(options?: Record<string, unknown>);
  useOrCreateTaskSpace(spaceId?: string): Promise<EgoTaskSpace>;
}
