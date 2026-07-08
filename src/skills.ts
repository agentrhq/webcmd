import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { ArgumentError } from './errors.js';
import { findPackageRoot } from './package-paths.js';

const MODULE_FILE = fileURLToPath(import.meta.url);

export interface WebcmdSkillInfo {
  name: string;
  description: string;
  version: string;
  path: string;
}

export interface WebcmdSkillInstallOptions {
  provider?: string;
  scope?: string;
  customPath?: string;
  packageRoot?: string;
  homeDir?: string;
  cwd?: string;
}

export interface WebcmdSkillLink {
  name: string;
  source: string;
  stableLink: string;
  destination?: string;
}

export interface WebcmdSkillInstallResult {
  provider?: SkillProvider;
  scope?: SkillScope;
  skills: WebcmdSkillLink[];
}

interface SkillFrontmatter {
  name?: unknown;
  description?: unknown;
  version?: unknown;
}

type SkillProvider = 'agents' | 'codex' | 'claude';
type SkillScope = 'user' | 'project';

export function getSkillsRoot(packageRoot: string = findPackageRoot(MODULE_FILE)): string {
  return path.join(packageRoot, 'skills');
}

export function listWebcmdSkills(packageRoot?: string): WebcmdSkillInfo[] {
  const skillsRoot = getSkillsRoot(packageRoot);
  if (!fs.existsSync(skillsRoot)) return [];

  return fs.readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readSkillInfo(skillsRoot, entry.name))
    .filter((entry): entry is WebcmdSkillInfo => entry !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function installWebcmdSkill(options: WebcmdSkillInstallOptions = {}): WebcmdSkillInstallResult {
  const provider = options.customPath === undefined ? normalizeProvider(options.provider) : undefined;
  const scope = normalizeScope(options.scope);
  const skills = updateStableSkillLinks(options)
    .map((skill) => {
      const destination = destinationFor(skill.name, provider, scope, options);
      replaceDirectorySymlink(skill.stableLink, destination);
      return { ...skill, destination };
    });
  return { provider, scope, skills };
}

export function updateWebcmdSkill(options: WebcmdSkillInstallOptions = {}): WebcmdSkillInstallResult {
  const skills = updateStableSkillLinks(options);
  if (options.provider === undefined && options.scope === undefined && options.customPath === undefined) return { skills };

  const provider = options.customPath === undefined ? normalizeProvider(options.provider) : undefined;
  const scope = normalizeScope(options.scope);
  return {
    provider,
    scope,
    skills: skills.map((skill) => {
      const destination = destinationFor(skill.name, provider, scope, options);
      replaceDirectorySymlink(skill.stableLink, destination);
      return { ...skill, destination };
    }),
  };
}

function updateStableSkillLinks(options: WebcmdSkillInstallOptions): WebcmdSkillLink[] {
  const skillsRoot = getSkillsRoot(options.packageRoot);
  const skills = listWebcmdSkills(options.packageRoot);
  if (skills.length === 0) {
    throw new ArgumentError(`No Webcmd skills found: ${skillsRoot}`, 'Install a package that includes skills/*/SKILL.md.');
  }

  return skills.map((skill) => {
    const source = path.join(skillsRoot, skill.name);
    const stableLink = path.join(options.homeDir ?? os.homedir(), '.webcmd', 'skills', skill.name);
    replaceDirectorySymlink(source, stableLink);
    return { name: skill.name, source, stableLink };
  });
}

function destinationFor(name: string, provider: SkillProvider | undefined, scope: SkillScope, options: WebcmdSkillInstallOptions): string {
  if (options.customPath !== undefined) return path.join(expandHomePath(options.customPath), name);
  const base = scope === 'project' ? options.cwd ?? process.cwd() : options.homeDir ?? os.homedir();
  const agentDir = provider === 'claude' ? '.claude' : provider === 'codex' ? '.codex' : '.agents';
  return path.join(base, agentDir, 'skills', name);
}

function expandHomePath(raw: string): string {
  const value = raw.trim();
  if (!value) throw new ArgumentError('Custom skills path must be non-empty.');
  return path.resolve(value === '~' ? os.homedir() : value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value);
}

function normalizeProvider(raw = 'agents'): SkillProvider {
  const value = raw.trim().toLowerCase();
  if (value === 'agents' || value === 'codex') return value;
  if (value === 'claude' || value === 'claude-code' || value === 'claude_code') return 'claude';
  throw new ArgumentError(`Unsupported skill provider: ${raw}`, 'Use one of: agents, codex, claude.');
}

function normalizeScope(raw = 'user'): SkillScope {
  const value = raw.trim().toLowerCase();
  if (value === 'user' || value === 'global') return 'user';
  if (value === 'project' || value === 'local') return 'project';
  throw new ArgumentError(`Unsupported skill scope: ${raw}`, 'Use one of: user, global, project, local.');
}

function replaceDirectorySymlink(target: string, linkPath: string): void {
  const current = safeLstat(linkPath);
  if (current) {
    if (!current.isSymbolicLink()) {
      throw new ArgumentError(`Refusing to replace non-symlink path: ${linkPath}`, 'Remove it manually or choose a different scope/provider.');
    }
    fs.unlinkSync(linkPath);
  }

  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  fs.symlinkSync(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
}

function safeLstat(filePath: string): fs.Stats | null {
  try {
    return fs.lstatSync(filePath);
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') return null;
    throw err;
  }
}

function readSkillInfo(skillsRoot: string, name: string): WebcmdSkillInfo | null {
  const skillMdPath = path.join(skillsRoot, name, 'SKILL.md');
  if (!fs.existsSync(skillMdPath)) return null;
  const content = fs.readFileSync(skillMdPath, 'utf8');
  const fm = parseFrontmatter(content);
  return {
    name: typeof fm.name === 'string' && fm.name ? fm.name : name,
    description: typeof fm.description === 'string' ? fm.description : firstBodyParagraph(content),
    version: typeof fm.version === 'string' || typeof fm.version === 'number' ? String(fm.version) : '',
    path: `${name}/SKILL.md`,
  };
}

function parseFrontmatter(content: string): SkillFrontmatter {
  if (!content.startsWith('---\n')) return {};
  const end = content.indexOf('\n---', 4);
  if (end < 0) return {};
  try {
    const parsed = yaml.load(content.slice(4, end));
    return parsed && typeof parsed === 'object' ? parsed as SkillFrontmatter : {};
  } catch {
    return parseLooseFrontmatter(content.slice(4, end));
  }
}

function parseLooseFrontmatter(raw: string): SkillFrontmatter {
  const out: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const match = /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, value] = match;
    if (!['name', 'description', 'version'].includes(key)) continue;
    out[key] = value.trim().replace(/^['"]|['"]$/g, '');
  }
  return out;
}

function firstBodyParagraph(content: string): string {
  const body = content.startsWith('---\n')
    ? content.slice(Math.max(content.indexOf('\n---', 4) + 4, 0))
    : content;
  const paragraph = body
    .split(/\n\s*\n/)
    .map((part) => part.replace(/^#+\s*/gm, '').trim())
    .find(Boolean);
  return paragraph ?? '';
}

function isDirectory(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}
