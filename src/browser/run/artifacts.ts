import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { BrowserRunArtifactReceipt, BrowserRunArtifactSink } from './types.js';
import { BrowserRunError } from './types.js';

export interface LocalBrowserRunArtifactSinkOptions {
  baseDir?: string;
}

function defaultArtifactBaseDir(): string {
  const cacheDir = process.env.WEBCMD_CACHE_DIR
    || path.join(os.homedir(), '.webcmd', 'cache');
  return path.join(cacheDir, 'browser-run');
}

function logicalFilename(filename: string): string {
  const normalized = filename.replace(/\\/g, '/');
  if (
    !normalized
    || path.posix.isAbsolute(normalized)
    || path.win32.isAbsolute(filename)
    || normalized.split('/').includes('..')
  ) {
    throw new BrowserRunError(
      'BROWSER_RUN_INVALID_INPUT',
      'Artifact paths must be relative logical filenames without "..".',
    );
  }
  return normalized;
}

/** Persists sandbox artifacts beneath Webcmd's private cache directory. */
export class LocalBrowserRunArtifactSink implements BrowserRunArtifactSink {
  readonly #baseDir: string;

  constructor(options: LocalBrowserRunArtifactSinkOptions = {}) {
    this.#baseDir = path.resolve(options.baseDir ?? defaultArtifactBaseDir());
  }

  async write(input: {
    filename: string;
    contentType: string;
    bytes: Uint8Array;
  }): Promise<BrowserRunArtifactReceipt> {
    const filename = logicalFilename(input.filename);
    const artifactId = `artifact_${randomBytes(12).toString('hex')}`;
    const outputPath = path.join(this.#baseDir, artifactId, filename);
    const runDir = path.dirname(outputPath);
    const bytes = Buffer.from(input.bytes);

    await fs.mkdir(runDir, { recursive: true, mode: 0o700 });
    await fs.writeFile(outputPath, bytes, { mode: 0o600 });

    return {
      artifactId,
      filename,
      contentType: input.contentType,
      byteSize: bytes.byteLength,
      locator: `browser-run://${artifactId}/${encodeURIComponent(filename)}`,
    };
  }
}
