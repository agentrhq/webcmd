import { spawn } from 'node:child_process';

export interface WebcmdExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface WebcmdClientOptions {
  command?: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
}

export class WebcmdClient {
  private readonly command: string;
  private readonly cwd?: string;
  private readonly env?: Record<string, string | undefined>;
  private readonly timeoutMs: number;

  constructor(options: WebcmdClientOptions = {}) {
    this.command = options.command ?? 'webcmd';
    this.cwd = options.cwd;
    this.env = options.env;
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  async exec(args: string[], stdin?: string): Promise<WebcmdExecResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.command, args, {
        cwd: this.cwd,
        env: { ...process.env, ...this.env },
        windowsHide: true,
        stdio: 'pipe',
      });

      let stdout = '';
      let stderr = '';
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill();
        reject(new Error(`Webcmd command timed out after ${this.timeoutMs}ms: ${this.command} ${args.join(' ')}`));
      }, this.timeoutMs);

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => { stdout += chunk; });
      child.stderr.on('data', (chunk: string) => { stderr += chunk; });

      child.on('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });

      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const exitCode = code ?? 1;
        if (exitCode !== 0) {
          const message = stderr.trim() || stdout.trim() || `Webcmd exited with code ${exitCode}`;
          reject(new Error(message));
          return;
        }
        resolve({ stdout, stderr, exitCode });
      });

      if (stdin !== undefined) {
        child.stdin.write(stdin);
      }
      child.stdin.end();
    });
  }

  async doctor(): Promise<string> {
    const result = await this.exec(['doctor']);
    return result.stdout.trim();
  }

  async createSession(name: string, profile?: string): Promise<{ id: string; raw: unknown }> {
    const args = profile ? ['--profile', profile, 'session', 'create', name, '-f', 'json'] : ['session', 'create', name, '-f', 'json'];
    const result = await this.exec(args);
    const raw = parseJsonLoose(result.stdout);
    const id = findSessionId(raw, result.stdout);
    if (!id) throw new Error(`Could not determine Webcmd session id from output: ${result.stdout}`);
    return { id, raw };
  }

  async closeSession(sessionId: string, profile?: string): Promise<void> {
    const args = profile ? ['--profile', profile, 'session', 'close', sessionId] : ['session', 'close', sessionId];
    await this.exec(args);
  }

  async browserRun(sessionId: string, script: string, profile?: string): Promise<unknown> {
    const prefix = profile ? ['--profile', profile, '--session', sessionId] : ['--session', sessionId];
    const result = await this.exec([...prefix, 'browser', 'run', '--stdin'], script);
    return parseJsonLoose(result.stdout) ?? result.stdout.trim();
  }

  async browserTabs(sessionId: string, profile?: string): Promise<unknown> {
    const prefix = profile ? ['--profile', profile, '--session', sessionId] : ['--session', sessionId];
    const result = await this.exec([...prefix, 'browser', 'tabs']);
    return parseJsonLoose(result.stdout) ?? result.stdout.trim();
  }
}

function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const candidates = ['{', '[']
      .map((c) => trimmed.indexOf(c))
      .filter((idx) => idx >= 0);
    const start = candidates.length ? Math.min(...candidates) : Number.POSITIVE_INFINITY;
    const end = Math.max(trimmed.lastIndexOf('}'), trimmed.lastIndexOf(']'));
    if (Number.isFinite(start) && end >= start) {
      try { return JSON.parse(trimmed.slice(start, end + 1)); } catch { return null; }
    }
    return null;
  }
}

function findSessionId(raw: unknown, fallback: string): string | null {
  if (raw && typeof raw === 'object') {
    const object = raw as Record<string, unknown>;
    for (const key of ['id', 'session_id', 'sessionId']) {
      if (typeof object[key] === 'string') return object[key] as string;
    }
    for (const value of Object.values(object)) {
      const nested = findSessionId(value, '');
      if (nested) return nested;
    }
  }
  const match = fallback.match(/\bid\s*[:=]\s*([A-Za-z0-9._-]+)/i);
  return match?.[1] ?? null;
}
