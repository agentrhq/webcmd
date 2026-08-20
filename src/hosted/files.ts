import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { CliError, EXIT_CODES } from '../errors.js';
import type { HostedClient } from './client.js';
import { realHostedFileIo, type HostedFileIo } from './file-io.js';
import type {
  HostedArtifactReceipt,
  HostedArtifactReference,
  HostedCommand,
  HostedCommandArg,
  HostedExecuteResponse,
  HostedPrepareExecutionResponse,
} from './types.js';

export interface HostedPreparedFiles {
  executionId: string;
  args: Record<string, unknown>;
  outputs: HostedOutputTarget[];
}

export interface HostedOutputTarget {
  argument: string;
  pathKind: 'file' | 'directory';
  localPath: string;
}

export interface HostedMaterializedOutput {
  argument: string;
  artifact: HostedArtifactReceipt;
  localPath: string;
}

export async function prepareHostedFiles(input: {
  client: HostedClient;
  command: HostedCommand;
  args: Record<string, unknown>;
  cwd?: string;
  profile?: string;
  session?: string;
  executionScope?: 'profile' | 'stateless';
  onPrepared?: (prepared: HostedPrepareExecutionResponse) => Promise<void>;
}, io: HostedFileIo = realHostedFileIo): Promise<HostedPreparedFiles> {
  const fileArgs = input.command.args.filter(hasFileMetadata);
  const cwd = input.cwd ?? process.cwd();
  const remoteArgs: Record<string, unknown> = { ...input.args };
  const inputs: Array<{
    argument: string;
    multiple: boolean;
    filename: string;
    contentType: string;
    body: Uint8Array;
    localPath: string;
  }> = [];
  const mutable: Array<{
    argument: string;
    multiple: boolean;
    localPath: string;
    contentType: string;
  }> = [];
  const outputs: HostedOutputTarget[] = [];

  for (const arg of fileArgs) {
    if (arg.file.direction === 'input') {
      const values = valuesForFileArg(arg, input.args[arg.name]);
      if (arg.required && values.length === 0) {
        throw new CliError(
          'HOSTED_FILE_INPUT_REQUIRED',
          `Argument "${arg.name}" requires a local file path.`,
          `Pass --${arg.name} <path>.`,
          EXIT_CODES.USAGE_ERROR,
        );
      }
      for (const value of values) {
        const localPath = resolveLocalPath(cwd, value, arg.name, io);
        const body = await readLocalFile(localPath, arg.name, io);
        assertLocalInputWithinLimit(arg, body);
        const contentType = contentTypeForPath(localPath);
        assertContentTypeAllowed(arg, contentType);
        inputs.push({
          argument: arg.name,
          multiple: arg.file.multiple === true,
          filename: path.basename(localPath),
          contentType,
          body,
          localPath,
        });
      }
      continue;
    }

    const rawValue = input.args[arg.name] ?? arg.default ?? arg.file.defaultPath;
    if (rawValue === undefined || rawValue === null || rawValue === '') continue;
    const values = valuesForFileArg(arg, rawValue);
    const references: HostedArtifactReference[] = [];
    for (const value of values) {
      const localPath = resolveOutputPath(cwd, value, arg.name, io);
      outputs.push({ argument: arg.name, pathKind: arg.file.pathKind, localPath });
      if (arg.file.direction === 'input-output') {
        const contentType = contentTypeForPath(localPath);
        mutable.push({ argument: arg.name, multiple: arg.file.multiple === true, localPath, contentType });
        if (await io.exists(localPath)) {
          const body = await readLocalFile(localPath, arg.name, io);
          assertLocalInputWithinLimit(arg, body);
          assertContentTypeAllowed(arg, contentType);
          inputs.push({
            argument: arg.name,
            multiple: arg.file.multiple === true,
            filename: path.basename(localPath),
            contentType,
            body,
            localPath,
          });
        }
        continue;
      }
      references.push({
        $webcmdArtifact: {
          direction: 'output',
          filename: path.basename(localPath) || arg.name,
          contentType: 'application/octet-stream',
        },
      });
    }
    if (references.length > 0) {
      remoteArgs[arg.name] = arg.file.multiple ? references : references[0];
    }
  }

  const prepared = await input.client.prepareExecution({
    command: input.command.command,
    ...(input.profile !== undefined ? { profile: input.profile } : {}),
    ...(input.session !== undefined ? { session: input.session } : {}),
    ...(input.executionScope !== undefined ? { executionScope: input.executionScope } : {}),
  });
  await input.onPrepared?.(prepared);
  const referencesByArgument = new Map<string, HostedArtifactReference[]>();
  const inputIdByPath = new Map<string, string>();
  for (const upload of inputs) {
    const uploaded = await input.client.uploadExecutionArtifact({
      executionId: prepared.execution.id,
      argument: upload.argument,
      filename: upload.filename,
      contentType: upload.contentType,
      body: upload.body,
    });
    const references = referencesByArgument.get(upload.argument) ?? [];
    references.push(uploaded.reference);
    referencesByArgument.set(upload.argument, references);
    if (uploaded.reference.$webcmdArtifact.id) inputIdByPath.set(`${upload.argument}\0${upload.localPath}`, uploaded.reference.$webcmdArtifact.id);
  }
  for (const [argument, references] of referencesByArgument) {
    const original = inputs.find(upload => upload.argument === argument);
    remoteArgs[argument] = original?.multiple ? references : references[0];
  }
  const mutableByArgument = new Map<string, HostedArtifactReference[]>();
  for (const output of mutable) {
    const inputId = inputIdByPath.get(`${output.argument}\0${output.localPath}`);
    const references = mutableByArgument.get(output.argument) ?? [];
    references.push({ $webcmdArtifact: {
      direction: 'input-output',
      filename: path.basename(output.localPath) || output.argument,
      contentType: output.contentType,
      ...(inputId ? { inputId } : {}),
    } });
    mutableByArgument.set(output.argument, references);
  }
  for (const [argument, references] of mutableByArgument) {
    const output = mutable.find(item => item.argument === argument);
    remoteArgs[argument] = output?.multiple ? references : references[0];
  }

  return {
    executionId: prepared.execution.id,
    args: remoteArgs,
    outputs,
  };
}

export async function materializeHostedOutputs(input: {
  client: HostedClient;
  response: HostedExecuteResponse;
  outputs: HostedOutputTarget[];
}, io: HostedFileIo = realHostedFileIo): Promise<HostedMaterializedOutput[]> {
  if (!input.outputs.length) return [];
  const receipts = input.response.artifacts ?? [];
  const receiptsByArgument = new Map<string, HostedArtifactReceipt[]>();
  for (const receipt of receipts) {
    if (receipt.direction !== 'output') continue;
    const bucket = receiptsByArgument.get(receipt.argument) ?? [];
    bucket.push(receipt);
    receiptsByArgument.set(receipt.argument, bucket);
  }

  const materialized: HostedMaterializedOutput[] = [];
  for (const output of input.outputs) {
    const receipts = receiptsByArgument.get(output.argument) ?? [];
    const targets = input.outputs.filter(target => target.argument === output.argument && target.pathKind === 'file');
    const outputReceipts = output.pathKind === 'file' && targets.length > 1
      ? receipts.filter(receipt => receipt.filename === path.basename(output.localPath))
      : receipts;
    if (outputReceipts.length > 1 && targets.length > 1) {
      throw new CliError('HOSTED_FILE_OUTPUT_INVALID', 'Webcmd Cloud returned ambiguous mutable file output artifacts.');
    }
    const seenRelativePaths = new Set<string>();
    for (const receipt of outputReceipts) {
      const target = targetPathForReceipt(output, receipt, seenRelativePaths, io);
      const body = await input.client.downloadExecutionArtifact({
        executionId: input.response.execution.id,
        artifactId: receipt.artifactId,
      });
      assertReceiptBody(receipt, body);
      await io.writeFile(target, body);
      materialized.push({ argument: output.argument, artifact: receipt, localPath: target });
    }
  }
  return materialized;
}

export function rewriteHostedOutputResultPaths(
  value: unknown,
  materialized: readonly HostedMaterializedOutput[],
): unknown {
  if (!materialized.length) return value;
  if (typeof value === 'string') return rewritePathString(value, materialized);
  if (Array.isArray(value)) return value.map(entry => rewriteHostedOutputResultPaths(entry, materialized));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, rewriteHostedOutputResultPaths(entry, materialized)]),
  );
}

function hasFileMetadata(arg: HostedCommandArg): arg is HostedCommandArg & {
  file: NonNullable<HostedCommandArg['file']>;
} {
  return !!arg.file;
}

function valuesForFileArg(arg: HostedCommandArg & { file: NonNullable<HostedCommandArg['file']> }, value: unknown): string[] {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) {
    if (!value.every(item => typeof item === 'string')) {
      throw new CliError('HOSTED_FILE_ARGUMENT', `Argument "${arg.name}" must contain file path strings.`, undefined, EXIT_CODES.USAGE_ERROR);
    }
    return value;
  }
  if (typeof value !== 'string') {
    throw new CliError('HOSTED_FILE_ARGUMENT', `Argument "${arg.name}" must be a file path string.`, undefined, EXIT_CODES.USAGE_ERROR);
  }
  if (arg.file.multiple && arg.file.separator === ',') {
    return value.split(',').map(item => item.trim()).filter(Boolean);
  }
  return [value];
}

function resolveLocalPath(cwd: string, value: string, argName: string, io: HostedFileIo): string {
  if (!value.trim()) {
    throw new CliError('HOSTED_FILE_ARGUMENT', `Argument "${argName}" must be a non-empty file path.`, undefined, EXIT_CODES.USAGE_ERROR);
  }
  return resolveUserPath(cwd, value, io);
}

function resolveOutputPath(cwd: string, value: string, argName: string, io: HostedFileIo): string {
  if (!value.trim()) {
    throw new CliError('HOSTED_FILE_ARGUMENT', `Argument "${argName}" must be a non-empty output path.`, undefined, EXIT_CODES.USAGE_ERROR);
  }
  return resolveUserPath(cwd, value, io);
}

function resolveUserPath(cwd: string, value: string, io: HostedFileIo): string {
  if (io !== realHostedFileIo) return value;
  if (value === '~') return homedir();
  if (value.startsWith('~/')) return path.join(homedir(), value.slice(2));
  return path.resolve(cwd, value);
}

async function readLocalFile(localPath: string, argName: string, io: HostedFileIo): Promise<Uint8Array> {
  if (!await io.exists(localPath)) {
    throw new CliError(
      'HOSTED_FILE_NOT_FOUND',
      `Input file for "${argName}" was not found.`,
      `Check the local path and try again.`,
      EXIT_CODES.USAGE_ERROR,
    );
  }
  try {
    return await io.readFile(localPath);
  } catch {
    throw new CliError(
      'HOSTED_FILE_NOT_FILE',
      `Input path for "${argName}" must be a regular file.`,
      undefined,
      EXIT_CODES.USAGE_ERROR,
    );
  }
}

function contentTypeForPath(localPath: string): string {
  const extension = path.extname(localPath).toLowerCase();
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.png') return 'image/png';
  if (extension === '.gif') return 'image/gif';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.mp4') return 'video/mp4';
  if (extension === '.pdf') return 'application/pdf';
  if (extension === '.json') return 'application/json';
  if (extension === '.csv') return 'text/csv';
  if (extension === '.md' || extension === '.markdown') return 'text/markdown';
  if (extension === '.txt') return 'text/plain';
  return 'application/octet-stream';
}

function assertLocalInputWithinLimit(
  arg: HostedCommandArg & { file: NonNullable<HostedCommandArg['file']> },
  body: Uint8Array,
): void {
  if (arg.file.maxBytes !== undefined && body.byteLength > arg.file.maxBytes) {
    throw new CliError(
      'HOSTED_FILE_TOO_LARGE',
      `Input file for "${arg.name}" exceeds the hosted argument size limit.`,
      `Maximum size is ${arg.file.maxBytes} bytes.`,
      EXIT_CODES.USAGE_ERROR,
    );
  }
}

function assertContentTypeAllowed(
  arg: HostedCommandArg & { file: NonNullable<HostedCommandArg['file']> },
  contentType: string,
): void {
  const allowed = arg.file.contentTypes;
  if (!allowed?.length) return;
  const normalized = contentType.toLowerCase();
  const ok = allowed.some((entry) => {
    const expected = entry.toLowerCase();
    if (expected === '*/*') return true;
    if (expected.endsWith('/*')) return normalized.startsWith(`${expected.slice(0, -1)}`);
    return normalized === expected;
  });
  if (!ok) {
    throw new CliError(
      'HOSTED_FILE_CONTENT_TYPE',
      `Input file for "${arg.name}" has unsupported content type ${contentType}.`,
      `Allowed content types: ${allowed.join(', ')}`,
      EXIT_CODES.USAGE_ERROR,
    );
  }
}

function targetPathForReceipt(
  output: HostedOutputTarget,
  receipt: HostedArtifactReceipt,
  seenRelativePaths: Set<string>,
  io: HostedFileIo,
): string {
  if (output.pathKind === 'file') return output.localPath;
  const relativePath = receipt.relativePath;
  if (!relativePath || !isSafeRelativePath(relativePath) || seenRelativePaths.has(relativePath)) {
    throw new CliError(
      'HOSTED_FILE_OUTPUT_INVALID',
      'Webcmd Cloud returned an unsafe output artifact path.',
      undefined,
      EXIT_CODES.GENERIC_ERROR,
    );
  }
  seenRelativePaths.add(relativePath);
  return io === realHostedFileIo
    ? path.resolve(output.localPath, ...relativePath.split('/'))
    : path.posix.join(output.localPath, relativePath);
}

function isSafeRelativePath(relativePath: string): boolean {
  if (path.posix.isAbsolute(relativePath) || relativePath.includes('\0')) return false;
  const parts = relativePath.split('/');
  return parts.length > 0 && parts.every(part => part.length > 0 && part !== '.' && part !== '..');
}

function assertReceiptBody(receipt: HostedArtifactReceipt, body: Uint8Array): void {
  if (body.byteLength !== receipt.byteSize) {
    throw new CliError('HOSTED_FILE_HASH_MISMATCH', 'Downloaded artifact size did not match the hosted receipt.');
  }
  if (receipt.sha256 && sha256Hex(body) !== receipt.sha256) {
    throw new CliError('HOSTED_FILE_HASH_MISMATCH', 'Downloaded artifact hash did not match the hosted receipt.');
  }
}

function sha256Hex(body: Uint8Array): string {
  return createHash('sha256').update(body).digest('hex');
}

function rewritePathString(value: string, materialized: readonly HostedMaterializedOutput[]): string {
  let next = value;
  for (const output of materialized) {
    const displayPath = displayLocalPath(output.localPath);
    const tokens = [output.artifact.relativePath, output.artifact.filename]
      .filter((token): token is string => typeof token === 'string' && token.length > 0);
    for (const token of tokens) {
      const pattern = new RegExp(
        `(?:~|/|[A-Za-z]:[\\\\/])[^\\s"'<>|]*${escapeRegExp(token).replaceAll('/', '[\\\\/]')}`,
        'g',
      );
      next = next.replace(pattern, displayPath);
    }
  }
  return next;
}

function displayLocalPath(localPath: string): string {
  const home = homedir();
  return localPath === home || localPath.startsWith(`${home}${path.sep}`)
    ? `~${localPath.slice(home.length)}`
    : localPath;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
