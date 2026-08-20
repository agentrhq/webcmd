import { mkdirSync, writeFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { CliError, EXIT_CODES } from '../errors.js';
import {
  normalizeVirtualPath,
  type VirtualFileMap,
  type VirtualOutputSink,
} from './virtual-files.js';

/**
 * Every filesystem operation reachable from hosted dispatch goes through this
 * interface. The installed CLI binds it to the real filesystem; the
 * programmatic entrypoint binds it to virtual files, so a CLI path is never
 * treated as a Cloud host path.
 */
export interface HostedFileIo {
  readFile(filePath: string): Promise<Uint8Array>;
  readText(filePath: string): Promise<string>;
  writeFile(filePath: string, body: Uint8Array): Promise<void>;
  writeText(filePath: string, body: string): Promise<void>;
  exists(filePath: string): Promise<boolean>;
}

export class VirtualFileMissingError extends CliError {
  constructor(virtualPath: string) {
    super(
      'VIRTUAL_FILE_MISSING',
      `No file was supplied at ${virtualPath}.`,
      'Pass the file in the invocation’s files list, or reference an existing artifact by URI.',
      EXIT_CODES.USAGE_ERROR,
    );
  }
}

export const realHostedFileIo: HostedFileIo = {
  async readFile(filePath) {
    return new Uint8Array(await readFile(filePath));
  },
  async readText(filePath) {
    return readFile(filePath, 'utf8');
  },
  async writeFile(filePath, body) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, body);
  },
  async writeText(filePath, body) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, body, 'utf8');
  },
  async exists(filePath) {
    try {
      await stat(filePath);
      return true;
    } catch {
      return false;
    }
  },
};

export function createVirtualHostedFileIo(
  files: VirtualFileMap,
  outputs: VirtualOutputSink,
): HostedFileIo {
  const read = (filePath: string): Uint8Array => {
    const key = normalizeVirtualPath(filePath);
    const found = files.get(key);
    if (!found) throw new VirtualFileMissingError(key);
    return found.content;
  };

  return {
    async readFile(filePath) {
      return read(filePath);
    },
    async readText(filePath) {
      return new TextDecoder().decode(read(filePath));
    },
    async writeFile(filePath, body) {
      outputs.write(filePath, body);
    },
    async writeText(filePath, body) {
      outputs.write(filePath, new TextEncoder().encode(body));
    },
    async exists(filePath) {
      return files.has(normalizeVirtualPath(filePath));
    },
  };
}
