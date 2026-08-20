import path from 'node:path';

export interface HostedVirtualFile {
  path: string;
  content: Uint8Array;
  contentType?: string;
}

export type VirtualFileMap = ReadonlyMap<string, HostedVirtualFile>;

export class VirtualPathError extends Error {
  readonly code = 'INVALID_VIRTUAL_PATH';

  constructor(message: string) {
    super(message);
    this.name = 'VirtualPathError';
  }
}

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const WINDOWS_DRIVE = /^[A-Za-z]:/;

export function normalizeVirtualPath(input: string): string {
  if (typeof input !== 'string' || input.length === 0) {
    throw new VirtualPathError('virtual file path must be a non-empty string');
  }
  if (CONTROL_CHARACTERS.test(input)) {
    throw new VirtualPathError('virtual file path must not contain control characters');
  }
  if (input.includes('\\')) {
    throw new VirtualPathError(`virtual file path must use POSIX separators: ${input}`);
  }
  if (WINDOWS_DRIVE.test(input)) {
    throw new VirtualPathError(`virtual file path must not name a drive: ${input}`);
  }
  if (path.posix.isAbsolute(input)) {
    throw new VirtualPathError(`virtual file path must be relative: ${input}`);
  }
  if (input.endsWith('/')) {
    throw new VirtualPathError(`virtual file path must not name a directory: ${input}`);
  }

  const normalized = path.posix.normalize(input);
  if (normalized === '.' || normalized === './') {
    throw new VirtualPathError(`virtual file path must name a file: ${input}`);
  }
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new VirtualPathError(`virtual file path escapes the virtual root: ${input}`);
  }
  if (normalized.endsWith('/')) {
    throw new VirtualPathError(`virtual file path must not name a directory: ${input}`);
  }
  return normalized;
}

export function createVirtualFileMap(files: readonly HostedVirtualFile[]): VirtualFileMap {
  const map = new Map<string, HostedVirtualFile>();
  for (const file of files) {
    const normalized = normalizeVirtualPath(file.path);
    if (map.has(normalized)) {
      throw new VirtualPathError(`duplicate virtual file path after normalization: ${normalized}`);
    }
    map.set(normalized, { ...file, path: normalized });
  }
  return map;
}

export interface VirtualOutputSink {
  write(path: string, content: Uint8Array, contentType?: string): void;
  files(): HostedVirtualFile[];
}

export function createVirtualOutputSink(): VirtualOutputSink {
  const written = new Map<string, HostedVirtualFile>();
  return {
    write(target, content, contentType) {
      const normalized = normalizeVirtualPath(target);
      written.set(normalized, {
        path: normalized,
        content,
        ...(contentType !== undefined ? { contentType } : {}),
      });
    },
    files() {
      return [...written.values()].sort((a, b) => a.path.localeCompare(b.path));
    },
  };
}
