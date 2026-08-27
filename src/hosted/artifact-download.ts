import { ArgumentError } from '../errors.js';
import { CLI_COMMAND } from '../brand.js';
import { parseOutputFormat } from '../command-surface.js';
import { render as renderOutput } from '../output.js';
import { writeToStream } from '../stream-write.js';
import type { HostedClient } from './client.js';
import type { HostedFileIo } from './file-io.js';

const HELP = `Usage: ${CLI_COMMAND} artifact download <download-url> --output <local-path>

Download a hosted execution artifact using Webcmd authentication.
--output is required. Ordinary curl is not authenticated.
`;

export async function runHostedArtifactDownload(
  argv: readonly string[],
  client: HostedClient,
  stdout: NodeJS.WritableStream,
  fileIo: HostedFileIo,
): Promise<void> {
  const parsed = parseArtifactDownloadArgv(argv);
  if (parsed.kind === 'help') {
    await writeToStream(stdout, HELP);
    return;
  }
  const body = await client.downloadArtifactFromUrl(parsed.url);
  await fileIo.writeFile(parsed.output, body);
  const payload = { output: parsed.output, bytes: body.byteLength };
  if (parsed.formatExplicit) {
    await renderOutput(payload, { fmt: parsed.format, fmtExplicit: true, stdout });
    return;
  }
  await writeToStream(stdout, `${parsed.output}\n`);
}

function parseArtifactDownloadArgv(
  argv: readonly string[],
): { kind: 'help' } | { kind: 'run'; url: string; output: string; format: string; formatExplicit: boolean } {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') return { kind: 'help' };
  if (argv[0] !== 'download') {
    throw new ArgumentError(
      `unknown artifact command '${argv[0]}'`,
      `Use: ${CLI_COMMAND} artifact download <download-url> --output <local-path>`,
    );
  }
  const rest = argv.slice(1);
  if (rest.includes('--help') || rest.includes('-h')) return { kind: 'help' };
  let url: string | undefined;
  let output: string | undefined;
  let format: string | undefined;
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i]!;
    if (token === '--output' || token === '-o') {
      const value = rest[i + 1];
      if (value === undefined) throw new ArgumentError('option \'--output <local-path>\' argument missing');
      output = value;
      i += 1;
      continue;
    }
    if (token.startsWith('--output=')) {
      output = token.slice('--output='.length);
      continue;
    }
    if (token === '--format' || token === '-f') {
      const value = rest[i + 1];
      if (value === undefined) throw new ArgumentError('option \'--format <format>\' argument missing');
      format = parseOutputFormat(value);
      i += 1;
      continue;
    }
    if (token.startsWith('--format=')) {
      format = parseOutputFormat(token.slice('--format='.length));
      continue;
    }
    if (token === '--json') {
      format = 'json';
      continue;
    }
    if (token.startsWith('-')) {
      throw new ArgumentError(`unknown option '${token}'`);
    }
    if (url !== undefined) throw new ArgumentError(`unexpected argument '${token}'`);
    url = token;
  }
  if (!url) {
    throw new ArgumentError(
      'missing required argument \'download-url\'',
      `Use: ${CLI_COMMAND} artifact download <download-url> --output <local-path>`,
    );
  }
  if (!output) {
    throw new ArgumentError(
      '--output is required',
      `Use: ${CLI_COMMAND} artifact download <download-url> --output <local-path>`,
    );
  }
  return { kind: 'run', url, output, format: format ?? 'table', formatExplicit: format !== undefined };
}
