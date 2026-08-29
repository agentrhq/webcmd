import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  AdapterAnalysisCommand,
  AdapterAnalysisSourceReader,
} from './adapter-analysis.js';
import { selectAdapterCommands } from './validate.js';

export type ConventionRuleId =
  | 'silent-column-drop'
  | 'camelCase-in-columns'
  | 'missing-access-metadata'
  | 'silent-clamp'
  | 'silent-empty-fallback'
  | 'silent-sentinel'
  | 'write-without-delete-pair';

type ManifestArg = {
  name?: string;
  positional?: boolean;
  required?: boolean;
  help?: string;
};

export type ManifestCommand = {
  site?: string;
  name?: string;
  access?: string;
  args?: ManifestArg[];
  columns?: string[];
  modulePath?: string;
  sourceFile?: string;
};

export type ConventionViolation = {
  rule: ConventionRuleId;
  site: string;
  name: string;
  command: string;
  message: string;
  file?: string;
  line?: number;
  details?: Record<string, unknown>;
};

export type ConventionCategory = {
  rule: ConventionRuleId;
  count: number;
  violations: ConventionViolation[];
};

export type ConventionAuditReport = {
  ok: boolean;
  summary: {
    commands: number;
    sites: number;
    files_scanned: number;
    violations: number;
  };
  categories: ConventionCategory[];
};

export type ConventionAuditOptions = {
  projectRoot: string;
  manifestPath?: string;
  target?: string;
  site?: string;
};

const RULES: ConventionRuleId[] = [
  'silent-column-drop',
  'camelCase-in-columns',
  'missing-access-metadata',
  'silent-clamp',
  'silent-empty-fallback',
  'silent-sentinel',
  'write-without-delete-pair',
];

const COLUMN_DROP_IGNORED_KEYS = new Set([
  'ok',
  'error',
]);

const WRITE_PAIR_RULES: Array<{
  match: RegExp;
  describe: string;
  expected: (name: string) => string[];
}> = [
  {
    match: /(^|[-_])like($|[-_])/,
    describe: 'like',
    expected: (name) => [name.replace(/like/g, 'unlike'), 'unlike'],
  },
  {
    match: /(^|[-_])follow($|[-_])/,
    describe: 'follow',
    expected: (name) => [name.replace(/follow/g, 'unfollow'), 'unfollow'],
  },
  {
    match: /(^|[-_])subscribe($|[-_])/,
    describe: 'subscribe',
    expected: (name) => [name.replace(/subscribe/g, 'unsubscribe'), 'unsubscribe'],
  },
  {
    match: /(^|[-_])bookmark($|[-_])/,
    describe: 'bookmark',
    expected: (name) => [name.replace(/bookmark/g, 'unbookmark'), 'unbookmark'],
  },
  {
    match: /(^|[-_])save($|[-_])/,
    describe: 'save',
    expected: (name) => [name.replace(/save/g, 'unsave'), 'unsave', 'delete', 'remove', 'rm'],
  },
  {
    match: /(^|[-_])create($|[-_])/,
    describe: 'create',
    expected: (name) => [
      name.replace(/create/g, 'delete'),
      name.replace(/create/g, 'remove'),
      'delete',
      'remove',
      'rm',
    ],
  },
  {
    match: /(^|[-_])post($|[-_])/,
    describe: 'post',
    expected: (name) => [name.replace(/post/g, 'delete'), 'delete', 'remove', 'rm'],
  },
];

export function runConventionAudit(opts: ConventionAuditOptions): ConventionAuditReport {
  const manifestPaths = opts.manifestPath
    ? [opts.manifestPath]
    : ['cli-manifest.json', 'plugin-command-manifest.json']
      .map(file => path.join(opts.projectRoot, file))
      .filter(fs.existsSync);
  const manifest = manifestPaths.flatMap(manifestPath => (
    JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as ManifestCommand[]
  ));
  const commands = manifest.flatMap((entry) => {
    const command = toAdapterAnalysisCommand(entry);
    return command ? [command] : [];
  });
  const allowedPaths = new Set(commands.flatMap((command) => {
    const logicalPath = command.sourceFile ?? command.modulePath;
    return logicalPath ? [logicalPath] : [];
  }));
  const projectRoot = fs.realpathSync(opts.projectRoot);
  const rootPrefix = `${projectRoot}${path.sep}`;
  const readSource: AdapterAnalysisSourceReader = (logicalPath) => {
    if (!allowedPaths.has(logicalPath)) return undefined;
    const packageRelative = logicalPath.startsWith('plugins/') || logicalPath.startsWith('clis/')
      ? logicalPath
      : path.join('clis', logicalPath);
    const sourcePath = path.resolve(projectRoot, packageRelative);
    if (sourcePath !== projectRoot && !sourcePath.startsWith(rootPrefix)) return undefined;
    try {
      const realSourcePath = fs.realpathSync(sourcePath);
      if (realSourcePath !== projectRoot && !realSourcePath.startsWith(rootPrefix)) return undefined;
      return fs.readFileSync(realSourcePath, 'utf-8');
    } catch {
      return undefined;
    }
  };

  const target = opts.target?.trim();
  const targetExists = !target || commands.some(command => (
    target.includes('/') ? command.command === target : command.site === target
  ));
  return auditAdapterConventions(targetExists ? commands : [], {
    ...(targetExists && target ? { target } : {}),
    ...(opts.site !== undefined ? { site: opts.site } : {}),
    readSource,
  });
}

export function auditAdapterConventions(
  commands: readonly AdapterAnalysisCommand[],
  options: {
    target?: string;
    site?: string;
    readSource: AdapterAnalysisSourceReader;
  },
): ConventionAuditReport {
  const targeted = selectAdapterCommands(commands, options.target, 'convention-audit');
  const site = options.site?.trim();
  const filtered = site ? targeted.filter(command => command.site === site) : targeted;
  const violations: ConventionViolation[] = [];
  const sourceCache = new Map<string, string | undefined>();
  const scannedFiles = new Set<string>();

  for (const command of filtered) {
    const identity = { site: command.site, name: command.name, command: command.command };
    if (command.access !== 'read' && command.access !== 'write') {
      violations.push({
        rule: 'missing-access-metadata',
        ...identity,
        message: `${command.command} must declare access: 'read' | 'write'`,
      });
    }

    for (const column of command.columns ?? []) {
      if (/[a-z][A-Z]/.test(column)) {
        violations.push({
          rule: 'camelCase-in-columns',
          ...identity,
          message: `${command.command} column "${column}" should use snake_case for agent-stable keys`,
          details: { column },
        });
      }
    }

    const logicalPath = command.sourceFile ?? command.modulePath;
    if (!logicalPath) continue;
    let source = sourceCache.get(logicalPath);
    if (!sourceCache.has(logicalPath)) {
      source = options.readSource(logicalPath);
      sourceCache.set(logicalPath, source);
    }
    if (source === undefined) continue;
    scannedFiles.add(logicalPath);

    violations.push(...auditColumnDrop(identity, command, source, logicalPath));
    violations.push(...auditTypedErrorPatterns(identity, source, logicalPath));
  }

  violations.push(...auditWriteDeletePair(filtered));

  const categories = RULES.map((rule) => {
    const items = violations.filter((violation) => violation.rule === rule);
    return { rule, count: items.length, violations: items };
  });

  const sites = new Set(filtered.map(command => command.site));
  return {
    ok: violations.length === 0,
    summary: {
      commands: filtered.length,
      sites: sites.size,
      files_scanned: scannedFiles.size,
      violations: violations.length,
    },
    categories,
  };
}

export function renderConventionAuditText(report: ConventionAuditReport): string {
  const lines: string[] = [];
  lines.push('Convention Audit Report');
  lines.push(`Scanned ${report.summary.commands} command(s) across ${report.summary.sites} site(s), ${report.summary.files_scanned} source file(s).`);
  lines.push(`Violations: ${report.summary.violations}`);
  lines.push('');
  for (const category of report.categories) {
    const marker = category.count === 0 ? 'OK' : String(category.count);
    lines.push(`${category.rule}: ${marker}`);
    for (const violation of category.violations) {
      const location = violation.file ? ` (${violation.file}${violation.line ? `:${violation.line}` : ''})` : '';
      lines.push(`  - ${violation.command}${location}`);
      lines.push(`    ${violation.message}`);
      const details = formatDetails(violation.details);
      if (details) lines.push(`    ${details}`);
    }
    lines.push('');
  }
  if (report.ok) {
    lines.push('OK - no convention violations found.');
  } else {
    lines.push('Run with -f yaml or -f json for machine-readable output.');
  }
  return lines.join('\n');
}

function toAdapterAnalysisCommand(entry: ManifestCommand): AdapterAnalysisCommand | null {
  if (typeof entry.site !== 'string' || typeof entry.name !== 'string') return null;
  return {
    site: entry.site,
    name: entry.name,
    command: `${entry.site}/${entry.name}`,
    ...(typeof entry.access === 'string' ? { access: entry.access } : {}),
    ...(entry.columns ? { columns: entry.columns } : {}),
    ...(typeof entry.sourceFile === 'string' ? { sourceFile: entry.sourceFile } : {}),
    ...(typeof entry.modulePath === 'string' ? { modulePath: entry.modulePath } : {}),
    runnable: true,
  };
}

function auditColumnDrop(
  command: Pick<ConventionViolation, 'site' | 'name' | 'command'>,
  entry: Pick<AdapterAnalysisCommand, 'columns'>,
  source: string,
  logicalPath: string,
): ConventionViolation[] {
  const columns = new Set(entry.columns ?? []);
  if (columns.size === 0) return [];
  const transformedIntermediateKeys = findTransformedIntermediateKeys(source, columns);
  const seen = new Set<string>();
  const violations: ConventionViolation[] = [];
  for (const object of extractPotentialRowObjects(source)) {
    if (isFailureDiagnosticObject(object.text)) continue;
    const keys = extractObjectKeys(object.text)
      .filter((key) => !COLUMN_DROP_IGNORED_KEYS.has(key));
    if (keys.length < 2) continue;
    if (looksLikeCommandMetadata(keys)) continue;
    const overlap = keys.filter((key) => columns.has(key));
    if (overlap.length === 0) continue;
    const missing = keys.filter((key) => !columns.has(key) && !transformedIntermediateKeys.has(key));
    if (missing.length === 0) continue;
    const signature = missing.sort().join(',');
    if (seen.has(signature)) continue;
    seen.add(signature);
    violations.push({
      rule: 'silent-column-drop',
      ...command,
      file: logicalPath,
      line: lineForIndex(source, object.index),
      message: `${command.command} row emits key(s) not present in columns: ${missing.join(', ')}`,
      details: { emitted_keys: keys, columns: [...columns], missing },
    });
  }
  return violations;
}

function auditTypedErrorPatterns(
  command: Pick<ConventionViolation, 'site' | 'name' | 'command'>,
  source: string,
  logicalPath: string,
): ConventionViolation[] {
  const violations: ConventionViolation[] = [];
  const relative = logicalPath;
  const lines = source.split(/\r?\n/);
  const catchRanges = findCatchBlockRanges(source);
  let offset = 0;
  lines.forEach((line, index) => {
    if (/Math\.min\s*\([^)]*limit[^)]*\)/i.test(line)) {
      violations.push({
        rule: 'silent-clamp',
        ...command,
        file: relative,
        line: index + 1,
        message: 'limit is clamped with Math.min; prefer validating and throwing ArgumentError on invalid input',
        details: { text: line.trim() },
      });
    }
    const emptyReturnIndex = line.search(/\breturn\s+\[\s*\]\s*;?/);
    if (emptyReturnIndex >= 0 && isInsideAnyRange(offset + emptyReturnIndex, catchRanges)) {
      violations.push({
        rule: 'silent-empty-fallback',
        ...command,
        file: relative,
        line: index + 1,
        message: 'empty array fallback hides fetch/parse failures from agents; prefer a typed error when data is expected',
        details: { text: line.trim() },
      });
    }
    const sentinel = /(?:\?\?|\|\|)\s*(['"])(unknown|Unknown|UNKNOWN|N\/A|n\/a|NA|-)\1/.exec(line);
    if (sentinel) {
      if (!isThrowMessageLine(line)) {
        violations.push({
          rule: 'silent-sentinel',
          ...command,
          file: relative,
          line: index + 1,
          message: `sentinel fallback ${sentinel[0].trim()} can turn missing data into fake data; prefer dropping the field or throwing a typed error`,
          details: { text: line.trim() },
        });
      }
    }
    offset += line.length + 1;
  });
  return dedupeViolations(violations);
}

function isThrowMessageLine(line: string): boolean {
  // Only single-line `throw new X(...)` diagnostics are ignored. Multi-line
  // throw expressions with row-like sentinel fallbacks still stay visible.
  return /\bthrow\s+new\b/.test(line);
}

function auditWriteDeletePair(entries: readonly AdapterAnalysisCommand[]): ConventionViolation[] {
  const bySite = new Map<string, AdapterAnalysisCommand[]>();
  for (const entry of entries) {
    if (!entry.site || !entry.name) continue;
    const list = bySite.get(entry.site) ?? [];
    list.push(entry);
    bySite.set(entry.site, list);
  }

  const violations: ConventionViolation[] = [];
  for (const [site, siteEntries] of bySite) {
    const names = new Set(siteEntries.map((entry) => entry.name).filter((name): name is string => typeof name === 'string'));
    for (const entry of siteEntries) {
      if (entry.access !== 'write' || !entry.name) continue;
      const pair = WRITE_PAIR_RULES.find((rule) => rule.match.test(entry.name!));
      if (!pair) continue;
      const expected = [...new Set(pair.expected(entry.name).filter((name) => name !== entry.name))];
      if (expected.some((name) => names.has(name))) continue;
      violations.push({
        rule: 'write-without-delete-pair',
        site,
        name: entry.name,
        command: `${site}/${entry.name}`,
        message: `write command "${entry.name}" looks like ${pair.describe} but no matching undo/delete command exists on this site`,
        details: { expected_any_of: expected },
      });
    }
  }
  return violations;
}

function extractPotentialRowObjects(source: string): Array<{ text: string; index: number }> {
  const objects: Array<{ text: string; index: number }> = [];
  const triggers = [
    /\.push\s*\(\s*{/g,
    /\breturn\s+(?:\(\s*)?{/g,
    /=>\s*\(\s*{/g,
    /\bmap\s*:\s*{/g,
    /\b(?:const|let|var)\s+row\s*=\s*{/g,
  ];
  for (const trigger of triggers) {
    for (const match of source.matchAll(trigger)) {
      const token = match[0];
      const openOffset = token.lastIndexOf('{');
      if (match.index === undefined || openOffset < 0) continue;
      const index = match.index + openOffset;
      const text = readBalancedBlock(source, index);
      if (text) objects.push({ text, index });
    }
  }
  return objects;
}

function findCatchBlockRanges(source: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  for (const match of source.matchAll(/\bcatch\s*(?:\([^)]*\))?\s*{/g)) {
    if (match.index === undefined) continue;
    const openIndex = match.index + match[0].lastIndexOf('{');
    const end = findBalancedBlockEnd(source, openIndex);
    if (end >= 0) ranges.push({ start: openIndex, end });
  }
  return ranges;
}

function findBalancedBlockEnd(source: string, openIndex: number): number {
  let depth = 0;
  let quote: '"' | "'" | '`' | null = null;
  let escaped = false;
  for (let i = openIndex; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function isInsideAnyRange(index: number, ranges: Array<{ start: number; end: number }>): boolean {
  return ranges.some((range) => index >= range.start && index <= range.end);
}

function readBalancedBlock(source: string, openIndex: number): string | null {
  let depth = 0;
  let quote: '"' | "'" | '`' | null = null;
  let escaped = false;
  for (let i = openIndex; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(openIndex, i + 1);
    }
  }
  return null;
}

function extractObjectKeys(objectText: string): string[] {
  return [...new Set(extractObjectProperties(objectText).map((property) => property.key))];
}

function extractObjectProperties(objectText: string): Array<{ key: string; value: string }> {
  const body = objectText.trim().replace(/^\{/, '').replace(/\}$/, '');
  const parts = splitTopLevel(body, ',');
  const properties: Array<{ key: string; value: string }> = [];
  for (const part of parts) {
    const property = extractProperty(part);
    if (property) properties.push(property);
  }
  return properties;
}

function extractProperty(part: string): { key: string; value: string } | null {
  const trimmed = part.trim();
  if (!trimmed || trimmed.startsWith('...') || trimmed.startsWith('[')) return null;
  const colonIndex = findTopLevelChar(trimmed, ':');
  if (colonIndex >= 0) {
    const raw = trimmed.slice(0, colonIndex).trim();
    const value = trimmed.slice(colonIndex + 1).trim();
    if (/^['"][^'"]+['"]$/.test(raw)) return { key: raw.slice(1, -1), value };
    const identifier = /^([A-Za-z_$][\w$]*)$/.exec(raw);
    return identifier ? { key: identifier[1], value } : null;
  }
  const shorthand = /^([A-Za-z_$][\w$]*)\b/.exec(trimmed);
  return shorthand ? { key: shorthand[1], value: shorthand[1] } : null;
}

function isFailureDiagnosticObject(objectText: string): boolean {
  const ok = extractObjectProperties(objectText).find((property) => property.key === 'ok');
  return ok != null && /^false\b/.test(ok.value);
}

function findTransformedIntermediateKeys(source: string, columns: Set<string>): Set<string> {
  const transformed = new Set<string>();
  for (const object of extractArrowReturnObjects(source)) {
    for (const property of extractObjectProperties(object.text)) {
      if (!columns.has(property.key)) continue;
      for (const match of property.value.matchAll(/\b([A-Za-z_$][\w$]*(?:Raw|Class))\b/g)) {
        const rawKey = match[1];
        if (rawKey !== property.key) transformed.add(rawKey);
      }
    }
  }
  return transformed;
}

function extractArrowReturnObjects(source: string): Array<{ text: string; index: number }> {
  const objects: Array<{ text: string; index: number }> = [];
  for (const match of source.matchAll(/=>\s*\(\s*{/g)) {
    const token = match[0];
    const openOffset = token.lastIndexOf('{');
    if (match.index === undefined || openOffset < 0) continue;
    const index = match.index + openOffset;
    const text = readBalancedBlock(source, index);
    if (text) objects.push({ text, index });
  }
  return objects;
}

function splitTopLevel(input: string, separator: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: '"' | "'" | '`' | null = null;
  let escaped = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{' || ch === '[' || ch === '(') depth++;
    if (ch === '}' || ch === ']' || ch === ')') depth--;
    if (depth === 0 && ch === separator) {
      parts.push(input.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(input.slice(start));
  return parts;
}

function findTopLevelChar(input: string, target: string): number {
  let depth = 0;
  let quote: '"' | "'" | '`' | null = null;
  let escaped = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{' || ch === '[' || ch === '(') depth++;
    if (ch === '}' || ch === ']' || ch === ')') depth--;
    if (depth === 0 && ch === target) return i;
  }
  return -1;
}

function looksLikeCommandMetadata(keys: string[]): boolean {
  const set = new Set(keys);
  return set.has('site') && (set.has('description') || set.has('access') || set.has('strategy'));
}

function lineForIndex(source: string, index: number): number {
  return source.slice(0, index).split(/\r?\n/).length;
}

function formatDetails(details: Record<string, unknown> | undefined): string {
  if (!details) return '';
  return Object.entries(details)
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : String(value)}`)
    .join(' | ');
}

function dedupeViolations(violations: ConventionViolation[]): ConventionViolation[] {
  const seen = new Set<string>();
  return violations.filter((violation) => {
    const key = `${violation.rule}:${violation.command}:${violation.file}:${violation.line}:${violation.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
