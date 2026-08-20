/**
 * Output formatting: table, JSON, Markdown, CSV, YAML.
 */

import Table from 'cli-table3';
import yaml from 'js-yaml';
import type { ErrorEnvelope } from './errors.js';
import { writeToStream } from './stream-write.js';

export interface RenderOptions {
  fmt?: string;
  /** True when the user explicitly passed -f on the command line. */
  fmtExplicit?: boolean;
  /** TTY state used by the pure formatter. `render` derives this from stdout. */
  isTTY?: boolean;
  columns?: string[];
  title?: string;
  elapsed?: number;
  source?: string;
  footerExtra?: string;
  /** Command-supplied markdown renderer — see CliCommand.renderMarkdown. */
  markdown?: (data: unknown) => string | undefined;
}

export interface ErrorRenderOptions {
  cmdName?: string;
  traceMode?: unknown;
  fmt?: unknown;
}

export interface StreamRenderOptions extends RenderOptions {
  stdout?: NodeJS.WritableStream;
}

function normalizeRows(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') return [data as Record<string, unknown>];
  return [{ value: data }];
}

function resolveColumns(rows: Record<string, unknown>[], opts: RenderOptions): string[] {
  return opts.columns ?? Object.keys(rows[0] ?? {});
}

/** Format output without writing to process-global streams. */
export function formatOutput(data: unknown, opts: RenderOptions = {}): string {
  let fmt = opts.fmt ?? 'table';
  if (!opts.fmtExplicit && fmt === 'table' && !opts.isTTY) fmt = 'yaml';
  if (data === null || data === undefined) return `${String(data)}\n`;

  switch (fmt) {
    case 'json': return `${JSON.stringify(data, null, 2)}\n`;
    case 'plain': return formatPlain(data);
    case 'md':
    case 'markdown': return formatMarkdown(data, opts);
    case 'csv': return formatCsv(data, opts);
    case 'yaml':
    case 'yml': return `${yaml.dump(data, { sortKeys: false, lineWidth: 120, noRefs: true })}\n`;
    default: return formatTable(data, opts);
  }
}

/** Render to an injected stream, with the legacy console path retained for local callers. */
export async function render(data: unknown, opts: StreamRenderOptions = {}): Promise<void> {
  const { stdout, ...formatOptions } = opts;
  const targetIsTTY = formatOptions.isTTY
    ?? (stdout ? (stdout as NodeJS.WritableStream & { isTTY?: boolean }).isTTY === true : process.stdout.isTTY === true);
  const output = formatOutput(data, { ...formatOptions, isTTY: targetIsTTY });
  if (!output) return;
  if (stdout) {
    await writeToStream(stdout, output);
    return;
  }

  // Existing local command tests and embedders intercept console.log. Passing
  // one string preserves the exact bytes console.log historically emitted.
  console.log(output.endsWith('\n') ? output.slice(0, -1) : output);
}

export function errorEnvelopeFormat(fmt?: unknown): 'json' | 'yaml' {
  return typeof fmt === 'string' && fmt.trim().toLowerCase() === 'json' ? 'json' : 'yaml';
}

export function requestedFormatFromArgv(argv: readonly string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (token === '--') break;
    if (token === '-f' || token === '--format') {
      const value = argv[i + 1];
      return value && !value.startsWith('-') ? value : undefined;
    }
    if (token.startsWith('--format=')) return token.slice('--format='.length) || undefined;
  }
  return undefined;
}

/** Serialize the local error envelope without writing to process-global stderr. */
export function formatErrorEnvelope(envelope: ErrorEnvelope, opts: ErrorRenderOptions = {}): string {
  const fmt = errorEnvelopeFormat(opts.fmt);
  if (fmt === 'json') return formatOutput(envelope, { fmt: 'json', fmtExplicit: true });
  let output = yaml.dump(envelope, { sortKeys: false, lineWidth: 120, noRefs: true });
  const code = envelope.error.code;
  if (
    opts.cmdName
    && opts.traceMode !== 'on'
    && opts.traceMode !== 'retain-on-failure'
    && (code === 'SELECTOR' || code === 'EMPTY_RESULT' || code === 'ADAPTER_LOAD' || code === 'UNKNOWN')
  ) {
    const runnable = opts.cmdName.replace('/', ' ');
    output += '# AutoFix: re-run with --trace=retain-on-failure for trace artifact\n';
    output += `# webcmd ${runnable} --trace retain-on-failure\n`;
  }
  return output;
}

function formatTable(data: unknown, opts: RenderOptions): string {
  const rows = normalizeRows(data);
  if (!rows.length) return '(no data)\n';
  const columns = resolveColumns(rows, opts);
  const table = new Table({
    head: columns.map(capitalize),
    style: { head: [], border: [] },
    wordWrap: true,
    wrapOnWordBoundary: true,
  });

  for (const row of rows) {
    table.push(columns.map((column) => {
      const value = row[column];
      return value === null || value === undefined ? '' : String(value);
    }));
  }

  const output: string[] = [''];
  if (opts.title) output.push(`  ${opts.title}`);
  output.push(table.toString());
  const footer = [`${rows.length} items`];
  if (opts.elapsed !== undefined) footer.push(`${opts.elapsed.toFixed(1)}s`);
  if (opts.source) footer.push(opts.source);
  if (opts.footerExtra) footer.push(opts.footerExtra);
  output.push(footer.join(' | '));
  return `${output.join('\n')}\n`;
}

function formatPlain(data: unknown): string {
  const rows = normalizeRows(data);
  if (!rows.length) return '';

  if (rows.length === 1) {
    const entries = Object.entries(rows[0]!);
    if (entries.length === 1) {
      const [key, value] = entries[0]!;
      if (key === 'response' || key === 'content' || key === 'markdown' || key === 'text' || key === 'value') {
        return `${String(value ?? '')}\n`;
      }
    }
  }

  const output: string[] = [];
  rows.forEach((row, index) => {
    for (const [key, value] of Object.entries(row)) {
      if (value === undefined || value === null || String(value) === '') continue;
      output.push(`${key}: ${value}`);
    }
    if (index < rows.length - 1) output.push('');
  });
  return output.length > 0 ? `${output.join('\n')}\n` : '';
}

function formatMarkdown(data: unknown, opts: RenderOptions): string {
  const custom = opts.markdown?.(data);
  if (custom !== undefined) return custom.endsWith('\n') ? custom : `${custom}\n`;
  const rows = normalizeRows(data);
  if (!rows.length) return '';
  if (rows.length === 1) {
    const entries = Object.entries(rows[0]!);
    if (entries.length === 1) {
      const [key, value] = entries[0]!;
      if (key === 'content' || key === 'markdown' || key === 'text' || key === 'value') {
        return `${String(value ?? '')}\n`;
      }
    }
  }

  const columns = resolveColumns(rows, opts);
  const output = [
    `| ${columns.join(' | ')} |`,
    `| ${columns.map(() => '---').join(' | ')} |`,
    ...rows.map(row => `| ${columns.map(column => String(row[column] ?? '').replace(/\|/g, '\\|')).join(' | ')} |`),
  ];
  return `${output.join('\n')}\n`;
}

function formatCsv(data: unknown, opts: RenderOptions): string {
  const rows = normalizeRows(data);
  if (!rows.length) return '';
  const columns = resolveColumns(rows, opts);
  const output = [
    columns.join(','),
    ...rows.map(row => columns.map(column => csvCell(row[column])).join(',')),
  ];
  return `${output.join('\n')}\n`;
}

function csvCell(value: unknown): string {
  const text = String(value ?? '');
  return /[,"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
