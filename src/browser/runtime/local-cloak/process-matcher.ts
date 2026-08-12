import fs from 'node:fs';
import { execFile } from 'node:child_process';

export function matchCloakProfileCommand(command: string, userDataDir: string): boolean {
  const args = splitCommand(command);
  if (!args[0]?.includes('/.cloakbrowser/') && !args[0]?.includes('\\.cloakbrowser\\')) return false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--user-data-dir' && args[index + 1] === userDataDir) return true;
    if (args[index] === `--user-data-dir=${userDataDir}`) return true;
  }
  return false;
}

export async function findExactCloakProfileProcesses(userDataDir: string): Promise<number[]> {
  const aliases = new Set([userDataDir]);
  try {
    aliases.add(fs.realpathSync.native(userDataDir));
  } catch {
    // The launch path is still useful when the directory does not exist yet.
  }
  const stdout = await psOutput();
  const pids = stdout.split('\n').flatMap((line) => {
    const match = line.match(/^\s*(\d+)\s+(.+)$/);
    if (!match) return [];
    const pid = Number(match[1]);
    if (!Number.isInteger(pid) || pid === process.pid) return [];
    return [...aliases].some(dir => matchCloakProfileCommand(match[2], dir)) ? [pid] : [];
  });
  return [...new Set(pids)];
}

function splitCommand(command: string): string[] {
  const args: string[] = [];
  let current = '';
  let quote = '';
  for (const char of command) {
    if (quote) {
      if (char === quote) quote = '';
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (/\s/u.test(char)) {
      if (current) {
        args.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }
  if (current) args.push(current);
  return args;
}

function psOutput(): Promise<string> {
  return new Promise((resolve) => {
    execFile('ps', ['-axo', 'pid=,command='], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, timeout: 2000 }, (err, stdout) => {
      resolve(err ? '' : String(stdout));
    });
  });
}
