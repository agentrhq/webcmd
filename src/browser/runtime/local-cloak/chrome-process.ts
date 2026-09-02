import fs from 'node:fs';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface ChromeProcessIdentity {
  executablePath: string;
  userDataDir: string;
  port?: number;
}

function commandStartsWithExecutable(command: string, executablePath: string): boolean {
  return command.startsWith(`${executablePath} `)
    || command.startsWith(`"${executablePath}" `)
    || command.startsWith(`'${executablePath}' `);
}

export function matchChromeProcessCommand(command: string, identity: ChromeProcessIdentity): boolean {
  if (!commandStartsWithExecutable(command.trim(), identity.executablePath)) return false;
  if (extractArgumentValue(command, '--user-data-dir') !== identity.userDataDir) return false;
  return identity.port === undefined
    || extractArgumentValue(command, '--remote-debugging-port') === String(identity.port);
}

function extractArgumentValue(command: string, name: string): string | undefined {
  const marker = ` ${name}=`;
  const start = command.indexOf(marker);
  if (start < 0) return undefined;
  const valueStart = start + marker.length;
  const quote = command[valueStart];
  if (quote === '"' || quote === "'") {
    const end = command.indexOf(quote, valueStart + 1);
    return end < 0 ? undefined : command.slice(valueStart + 1, end);
  }
  const nextArgument = command.indexOf(' --', valueStart);
  const nextUrl = command.indexOf(' about:', valueStart);
  const candidates = [nextArgument, nextUrl].filter(index => index >= 0);
  const end = candidates.length > 0 ? Math.min(...candidates) : command.length;
  return command.slice(valueStart, end).trimEnd();
}

export async function findExactChromeProcesses(
  identity: ChromeProcessIdentity,
  platform: NodeJS.Platform = process.platform,
): Promise<number[]> {
  const canonicalIdentity = {
    ...identity,
    executablePath: canonicalPath(identity.executablePath),
    userDataDir: canonicalPath(identity.userDataDir),
  };
  const commands = await processCommands(platform);
  const matches = commands.flatMap(({ pid, command }) => {
    if (pid === process.pid) return [];
    if (matchChromeProcessCommand(command, identity)) return [pid];
    if (matchChromeProcessCommand(command, canonicalIdentity)) return [pid];
    return platform === 'linux' && linuxWrapperProcessMatches(pid, command, canonicalIdentity) ? [pid] : [];
  });
  return [...new Set(matches)];
}

function linuxWrapperProcessMatches(pid: number, command: string, identity: ChromeProcessIdentity): boolean {
  if (extractArgumentValue(command, '--user-data-dir') !== identity.userDataDir) return false;
  if (identity.port !== undefined
    && extractArgumentValue(command, '--remote-debugging-port') !== String(identity.port)) return false;
  let actualExecutable = '';
  try { actualExecutable = fs.realpathSync.native(`/proc/${pid}/exe`); } catch { return false; }
  const configuredName = path.basename(identity.executablePath).toLowerCase();
  const actualName = path.basename(actualExecutable).toLowerCase();
  return path.dirname(actualExecutable) === path.dirname(identity.executablePath)
    && /^google-chrome(?:-stable)?$/u.test(configuredName)
    && actualName === 'chrome';
}

export async function listenerBelongsToProcess(
  port: number,
  pid: number,
  platform: NodeJS.Platform = process.platform,
): Promise<boolean> {
  if (!Number.isInteger(port) || port <= 0 || !Number.isInteger(pid) || pid <= 0) return false;
  if (platform === 'win32') return windowsListenerBelongsToProcess(port, pid);
  if (platform === 'linux') return linuxListenerBelongsToProcess(port, pid);
  return lsofListenerBelongsToProcess(port, pid);
}

export async function terminateChromeProcessTree(
  pid: number,
  platform: NodeJS.Platform = process.platform,
  force = false,
): Promise<void> {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return;
  if (platform === 'win32') {
    await execFileAsync('taskkill', ['/PID', String(pid), '/T', ...(force ? ['/F'] : [])]).catch(() => {});
    return;
  }
  try {
    process.kill(pid, force ? 'SIGKILL' : 'SIGTERM');
  } catch {
    // Already exited or not signalable. Callers decide whether a retry is needed.
  }
}

async function processCommands(platform: NodeJS.Platform): Promise<Array<{ pid: number; command: string }>> {
  if (platform === 'win32') {
    const script = 'Get-CimInstance Win32_Process | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress';
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, timeout: 3000,
    }).catch(() => ({ stdout: '' }));
    try {
      const parsed = JSON.parse(String(stdout)) as unknown;
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      return rows.flatMap((row) => {
        const value = row as { ProcessId?: unknown; CommandLine?: unknown };
        const pid = Number(value.ProcessId);
        return Number.isInteger(pid) && typeof value.CommandLine === 'string'
          ? [{ pid, command: value.CommandLine }]
          : [];
      });
    } catch {
      return [];
    }
  }
  const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,command='], {
    encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, timeout: 3000,
  }).catch(() => ({ stdout: '' }));
  return String(stdout).split('\n').flatMap((line) => {
    const match = line.match(/^\s*(\d+)\s+(.+)$/u);
    return match ? [{ pid: Number(match[1]), command: match[2] }] : [];
  });
}

async function lsofListenerBelongsToProcess(port: number, pid: number): Promise<boolean> {
  const { stdout } = await execFileAsync('lsof', ['-nP', '-a', '-p', String(pid), `-iTCP:${port}`, '-sTCP:LISTEN'], {
    encoding: 'utf8', timeout: 3000,
  }).catch(() => ({ stdout: '' }));
  return String(stdout).split('\n').some(line => new RegExp(`^\\S+\\s+${pid}\\s`, 'u').test(line));
}

async function linuxListenerBelongsToProcess(port: number, pid: number): Promise<boolean> {
  const inode = linuxListeningSocketInode(port);
  if (!inode) return false;
  try {
    return fs.readdirSync(`/proc/${pid}/fd`).some((fd) => {
      try {
        return fs.readlinkSync(`/proc/${pid}/fd/${fd}`) === `socket:[${inode}]`;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

function linuxListeningSocketInode(port: number): string | undefined {
  const portHex = port.toString(16).toUpperCase().padStart(4, '0');
  for (const file of ['/proc/net/tcp', '/proc/net/tcp6']) {
    let content = '';
    try { content = fs.readFileSync(file, 'utf8'); } catch { continue; }
    for (const line of content.split('\n').slice(1)) {
      const fields = line.trim().split(/\s+/u);
      const local = fields[1]?.split(':');
      if (local?.[1] === portHex && fields[3] === '0A' && fields[9]) return fields[9];
    }
  }
  return undefined;
}

async function windowsListenerBelongsToProcess(port: number, pid: number): Promise<boolean> {
  const { stdout } = await execFileAsync('netstat', ['-ano', '-p', 'tcp'], {
    encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, timeout: 3000,
  }).catch(() => ({ stdout: '' }));
  return String(stdout).split(/\r?\n/u).some((line) => {
    const fields = line.trim().split(/\s+/u);
    return fields.length >= 5
      && fields[0]?.toUpperCase() === 'TCP'
      && fields[1]?.endsWith(`:${port}`) === true
      && fields[3]?.toUpperCase() === 'LISTENING'
      && Number(fields[4]) === pid;
  });
}

function canonicalPath(input: string): string {
  try { return fs.realpathSync.native(input); } catch { return input; }
}
