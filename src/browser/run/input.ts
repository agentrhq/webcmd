import { readFile } from 'node:fs/promises';
import { stdin as processStdin } from 'node:process';
import {
  BROWSER_RUN_MAX_SOURCE_BYTES,
  BrowserRunError,
} from './types.js';

export interface BrowserRunSourceInput {
  stdin?: boolean;
  file?: string;
}

export interface BrowserRunSourceIo {
  readStdin(): Promise<string>;
  readFile(filePath: string): Promise<string>;
}

export async function readProcessStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of processStdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

const defaultBrowserRunSourceIo: BrowserRunSourceIo = {
  readStdin: readProcessStdin,
  readFile: (filePath) => readFile(filePath, 'utf8'),
};

function validateSource(source: string): string {
  if (!source.trim()) {
    throw new BrowserRunError(
      'BROWSER_RUN_INVALID_INPUT',
      'Browser run source must not be empty.',
      'Pass JavaScript through --stdin or --file <path>; return structured data, console.log concise evidence, or call writeArtifact(filename, bytes).',
    );
  }
  const bytes = Buffer.byteLength(source, 'utf8');
  if (bytes > BROWSER_RUN_MAX_SOURCE_BYTES) {
    throw new BrowserRunError(
      'BROWSER_RUN_SOURCE_LIMIT',
      `Browser run source exceeds the ${BROWSER_RUN_MAX_SOURCE_BYTES}-byte limit.`,
      'Split the task into smaller decision-sized programs.',
    );
  }
  return source;
}

export async function loadBrowserRunSource(
  input: BrowserRunSourceInput,
  io: BrowserRunSourceIo = defaultBrowserRunSourceIo,
): Promise<string> {
  const useStdin = input.stdin === true;
  const file = typeof input.file === 'string' && input.file.trim()
    ? input.file
    : undefined;
  if (Number(useStdin) + Number(file !== undefined) !== 1) {
    throw new BrowserRunError(
      'BROWSER_RUN_INVALID_INPUT',
      'Choose exactly one browser run source: --stdin or --file <path>.',
    );
  }

  if (useStdin) {
    return validateSource(await io.readStdin());
  }

  try {
    return validateSource(await io.readFile(file!));
  } catch (error) {
    if (error instanceof BrowserRunError) throw error;
    throw new BrowserRunError(
      'BROWSER_RUN_INVALID_INPUT',
      'Could not read the browser run source file.',
      'Check that the file exists and is readable by the local Webcmd CLI.',
    );
  }
}
