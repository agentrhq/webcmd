import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
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
  /** Reads only a regular file, never following a symlink on supported platforms. */
  readRegularFile(filePath: string): Promise<Uint8Array>;
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

interface AtomicFileHandle {
  writeFile(body: Uint8Array): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

interface AtomicFileOperations {
  mkdir(directory: string, options: { recursive: true; mode: number }): Promise<unknown>;
  open(filePath: string, flags: number, mode: number): Promise<AtomicFileHandle>;
  rename(oldPath: string, newPath: string): Promise<void>;
  rm(filePath: string, options: { force: true }): Promise<unknown>;
}

const nodeAtomicFileOperations: AtomicFileOperations = { mkdir, open, rename, rm };

/** Creates the real-filesystem adapter; the optional operations keep atomic writes regression-testable. */
export function createRealHostedFileIo(operations: AtomicFileOperations = nodeAtomicFileOperations): HostedFileIo {
  return {
    async readFile(filePath) {
      return new Uint8Array(await readFile(filePath));
    },
    async readRegularFile(filePath) {
      const entry = await lstat(filePath);
      if (entry.isSymbolicLink() || !entry.isFile()) throw new Error('Hosted input must be a regular file.');

      const flags = constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW);
      const handle = await open(filePath, flags);
      try {
        const opened = await handle.stat();
        if (!opened.isFile()) throw new Error('Hosted input must be a regular file.');
        return new Uint8Array(await handle.readFile());
      } finally {
        await handle.close().catch(() => undefined);
      }
    },
    async readText(filePath) {
      return readFile(filePath, 'utf8');
    },
    async writeFile(filePath, body) {
      await writeAtomicFile(filePath, body, operations);
    },
    async writeText(filePath, body) {
      await writeAtomicFile(filePath, new TextEncoder().encode(body), operations);
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
}

export const realHostedFileIo: HostedFileIo = createRealHostedFileIo();

async function writeAtomicFile(
  filePath: string,
  body: Uint8Array,
  operations: AtomicFileOperations,
): Promise<void> {
  const directory = path.dirname(filePath);
  await operations.mkdir(directory, { recursive: true, mode: 0o700 });
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`,
  );
  let temporaryCreated = false;
  try {
    const flags = constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW);
    const handle = await operations.open(temporaryPath, flags, 0o600);
    temporaryCreated = true;
    try {
      await handle.writeFile(body);
      await handle.sync();
    } finally {
      await handle.close().catch(() => undefined);
    }
    await operations.rename(temporaryPath, filePath);
    temporaryCreated = false;
  } finally {
    if (temporaryCreated) await operations.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}
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
    async readRegularFile(filePath) {
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
