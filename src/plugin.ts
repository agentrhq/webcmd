/**
 * Plugin management: install, uninstall, and list plugins.
 *
 * Plugins live in ~/.webcmd/plugins/<name>/.
 * Monorepo clones live in ~/.webcmd/monorepos/<repo-name>/.
 * Install source format: "github:user/repo", "github:user/repo/subplugin",
 * "https://github.com/user/repo", "file:///local/plugin", or a local directory path.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getPluginsDir, PLUGINS_DIR } from './discovery.js';
import { getErrorMessage, PluginError } from './errors.js';
import { log } from './logger.js';
import { isRecord } from './utils.js';
import { PACKAGE_NAME } from './brand.js';
import { fileSha256, readOverrideRecords } from './override-provenance.js';
import {
  readPluginManifest,
  isMonorepo,
  getEnabledPlugins,
  checkCompatibility,
  type PluginManifest,
} from './plugin-manifest.js';

const isWindows = process.platform === 'win32';
const LOCAL_PLUGIN_SOURCE_PREFIX = 'local:';

/** Get home directory, respecting HOME environment variable for test isolation. */
function getHomeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || os.homedir();
}

/** Path to the lock file that tracks installed plugin versions. */
export function getLockFilePath(): string {
  return path.join(getHomeDir(), '.webcmd', 'plugins.lock.json');
}

/** Monorepo clones directory: ~/.webcmd/monorepos/ */
export function getMonoreposDir(): string {
  return path.join(getHomeDir(), '.webcmd', 'monorepos');
}

export type PluginSourceRecord =
  | { kind: 'git'; url: string }
  | { kind: 'local'; path: string }
  | { kind: 'monorepo'; url: string; repoName: string; subPath: string };

export interface LockEntry {
  source: PluginSourceRecord;
  commitHash: string;
  installedAt: string;
  updatedAt?: string;
}

export interface PluginInfo {
  name: string;
  path: string;
  commands: string[];
  source?: string;
  version?: string;
  installedAt?: string;
  /** If from a monorepo, the monorepo name. */
  monorepoName?: string;
  /** Description from webcmd-plugin.json. */
  description?: string;
  /** Commands forked into ~/.webcmd/clis with upstream provenance. */
  overrides: string[];
  /** An override's upstream command changed since it was forked. */
  updateAvailable: boolean;
}

interface ParsedSource {
  type: 'git' | 'local';
  name: string;
  subPlugin?: string;
  cloneUrl?: string;
  localPath?: string;
}

function parseStoredPluginSource(source?: string): PluginSourceRecord | undefined {
  if (!source) return undefined;
  if (source.startsWith(LOCAL_PLUGIN_SOURCE_PREFIX)) {
    return {
      kind: 'local',
      path: path.resolve(source.slice(LOCAL_PLUGIN_SOURCE_PREFIX.length)),
    };
  }
  return { kind: 'git', url: source };
}

function isLocalPluginSource(source?: string): boolean {
  return parseStoredPluginSource(source)?.kind === 'local';
}

function toStoredPluginSource(source: PluginSourceRecord): string {
  if (source.kind === 'local') {
    return `${LOCAL_PLUGIN_SOURCE_PREFIX}${path.resolve(source.path)}`;
  }
  return source.url;
}

function toLocalPluginSource(pluginDir: string): string {
  return toStoredPluginSource({ kind: 'local', path: pluginDir });
}

// isRecord is imported from './utils.js'

function normalizeLegacyMonorepo(
  value: unknown,
): { name: string; subPath: string } | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.name !== 'string' || typeof value.subPath !== 'string') return undefined;
  return { name: value.name, subPath: value.subPath };
}

function normalizePluginSource(
  source: unknown,
  legacyMonorepo?: { name: string; subPath: string },
): PluginSourceRecord | undefined {
  if (typeof source === 'string') {
    const parsed = parseStoredPluginSource(source);
    if (!parsed) return undefined;
    if (parsed.kind === 'git' && legacyMonorepo) {
      return {
        kind: 'monorepo',
        url: parsed.url,
        repoName: legacyMonorepo.name,
        subPath: legacyMonorepo.subPath,
      };
    }
    return parsed;
  }

  if (!isRecord(source) || typeof source.kind !== 'string') return undefined;
  switch (source.kind) {
    case 'git':
      return typeof source.url === 'string'
        ? { kind: 'git', url: source.url }
        : undefined;
    case 'local':
      return typeof source.path === 'string'
        ? { kind: 'local', path: path.resolve(source.path) }
        : undefined;
    case 'monorepo':
      return typeof source.url === 'string'
        && typeof source.repoName === 'string'
        && typeof source.subPath === 'string'
        ? {
            kind: 'monorepo',
            url: source.url,
            repoName: source.repoName,
            subPath: source.subPath,
          }
        : undefined;
    default:
      return undefined;
  }
}

function normalizeLockEntry(value: unknown): LockEntry | undefined {
  if (!isRecord(value)) return undefined;

  const legacyMonorepo = normalizeLegacyMonorepo(value.monorepo);
  const source = normalizePluginSource(value.source, legacyMonorepo);
  if (!source) return undefined;
  if (typeof value.commitHash !== 'string' || typeof value.installedAt !== 'string') {
    return undefined;
  }

  const entry: LockEntry = {
    source,
    commitHash: value.commitHash,
    installedAt: value.installedAt,
  };

  if (typeof value.updatedAt === 'string') {
    entry.updatedAt = value.updatedAt;
  }

  return entry;
}

function resolvePluginSource(lockEntry: LockEntry | undefined, pluginDir: string): PluginSourceRecord | undefined {
  if (lockEntry) {
    return lockEntry.source;
  }
  return parseStoredPluginSource(getPluginSource(pluginDir));
}

function resolveStoredPluginSource(lockEntry: LockEntry | undefined, pluginDir: string): string | undefined {
  const source = resolvePluginSource(lockEntry, pluginDir);
  return source ? toStoredPluginSource(source) : undefined;
}

// ── Filesystem helpers ──────────────────────────────────────────────────────

/**
 * Move a directory, with EXDEV fallback.
 * fs.renameSync fails when source and destination are on different
 * filesystems (e.g. /tmp → ~/.webcmd). In that case we copy then remove.
 */
type MoveDirFsOps = Pick<typeof fs, 'renameSync' | 'cpSync' | 'rmSync'>;

function moveDir(src: string, dest: string, fsOps: MoveDirFsOps = fs): void {
  try {
    fsOps.renameSync(src, dest);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
      try {
        fsOps.cpSync(src, dest, { recursive: true });
      } catch (copyErr) {
        try { fsOps.rmSync(dest, { recursive: true, force: true }); } catch {}
        throw copyErr;
      }
      fsOps.rmSync(src, { recursive: true, force: true });
    } else {
      throw err;
    }
  }
}

type ReplaceDirFsOps = MoveDirFsOps & Pick<typeof fs, 'existsSync' | 'mkdirSync'>;

function createSiblingTempPath(dest: string, kind: 'tmp' | 'bak'): string {
  const suffix = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return path.join(path.dirname(dest), `.${path.basename(dest)}.${kind}-${suffix}`);
}

function cloneRepoToTemp(cloneUrl: string): string {
  const tmpCloneDir = path.join(
    os.tmpdir(),
    `webcmd-clone-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );

  try {
    execFileSync('git', ['clone', '--depth', '1', cloneUrl, tmpCloneDir], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    throw new PluginError(`Failed to clone plugin: ${getErrorMessage(err)}`, 'Check the repository URL and your network connection.');
  }

  return tmpCloneDir;
}

function withTempClone<T>(cloneUrl: string, work: (cloneDir: string) => T): T {
  const tmpCloneDir = cloneRepoToTemp(cloneUrl);
  try {
    return work(tmpCloneDir);
  } finally {
    try { fs.rmSync(tmpCloneDir, { recursive: true, force: true }); } catch {}
  }
}

function resolveRemotePluginSource(lockEntry: LockEntry | undefined, dir: string): string {
  const source = resolvePluginSource(lockEntry, dir);
  if (!source || source.kind === 'local') {
    throw new Error(`Unable to determine remote source for plugin at ${dir}`);
  }
  return source.url;
}

function pathExistsSync(p: string): boolean {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

function resolveRepoContainedPath(repoRoot: string, subPath: string): string {
  const resolved = path.resolve(repoRoot, subPath);
  if (!resolved.startsWith(repoRoot + path.sep) && resolved !== repoRoot) {
    throw new PluginError(`Plugin path "${subPath}" escapes repo root.`);
  }
  return resolved;
}

function removePathSync(p: string): void {
  try {
    const stat = fs.lstatSync(p);
    if (stat.isSymbolicLink()) {
      fs.unlinkSync(p);
      return;
    }
    fs.rmSync(p, { recursive: true, force: true });
  } catch {}
}

interface TransactionHandle {
  finalize(): void;
  rollback(): void;
}

class Transaction {
  #handles: TransactionHandle[] = [];
  #settled = false;

  track<T extends TransactionHandle>(handle: T): T {
    this.#handles.push(handle);
    return handle;
  }

  commit(): void {
    if (this.#settled) return;
    this.#settled = true;
    for (const handle of this.#handles) {
      handle.finalize();
    }
  }

  rollback(): void {
    if (this.#settled) return;
    this.#settled = true;
    for (const handle of [...this.#handles].reverse()) {
      handle.rollback();
    }
  }
}

function runTransaction<T>(work: (tx: Transaction) => T): T {
  const tx = new Transaction();
  try {
    const result = work(tx);
    tx.commit();
    return result;
  } catch (err) {
    tx.rollback();
    throw err;
  }
}

function beginReplaceDir(
  stagingDir: string,
  dest: string,
  fsOps: ReplaceDirFsOps = fs,
): TransactionHandle {
  const destExisted = fsOps.existsSync(dest);
  fsOps.mkdirSync(path.dirname(dest), { recursive: true });

  const tempDest = createSiblingTempPath(dest, 'tmp');
  const backupDest = destExisted ? createSiblingTempPath(dest, 'bak') : null;
  let settled = false;

  try {
    moveDir(stagingDir, tempDest, fsOps);
    if (backupDest) {
      fsOps.renameSync(dest, backupDest);
    }
    fsOps.renameSync(tempDest, dest);
  } catch (err) {
    try { fsOps.rmSync(tempDest, { recursive: true, force: true }); } catch {}
    if (backupDest && !fsOps.existsSync(dest)) {
      try { fsOps.renameSync(backupDest, dest); } catch {}
    }
    throw err;
  }

  return {
    finalize() {
      if (settled) return;
      settled = true;
      if (backupDest) {
        try { fsOps.rmSync(backupDest, { recursive: true, force: true }); } catch {}
      }
    },
    rollback() {
      if (settled) return;
      settled = true;
      try { fsOps.rmSync(dest, { recursive: true, force: true }); } catch {}
      if (backupDest) {
        try { fsOps.renameSync(backupDest, dest); } catch {}
      }
      try { fsOps.rmSync(tempDest, { recursive: true, force: true }); } catch {}
    },
  };
}

function beginReplaceSymlink(target: string, linkPath: string): TransactionHandle {
  const linkExists = pathExistsSync(linkPath);
  if (linkExists && !isSymlinkSync(linkPath)) {
    throw new Error(`Expected monorepo plugin link at ${linkPath} to be a symlink`);
  }

  fs.mkdirSync(path.dirname(linkPath), { recursive: true });

  const tempLink = createSiblingTempPath(linkPath, 'tmp');
  const backupLink = linkExists ? createSiblingTempPath(linkPath, 'bak') : null;
  const linkType = isWindows ? 'junction' : 'dir';
  let settled = false;

  try {
    fs.symlinkSync(target, tempLink, linkType);
    if (backupLink) {
      fs.renameSync(linkPath, backupLink);
    }
    fs.renameSync(tempLink, linkPath);
  } catch (err) {
    removePathSync(tempLink);
    if (backupLink && !pathExistsSync(linkPath)) {
      try { fs.renameSync(backupLink, linkPath); } catch {}
    }
    throw err;
  }

  return {
    finalize() {
      if (settled) return;
      settled = true;
      if (backupLink) {
        removePathSync(backupLink);
      }
    },
    rollback() {
      if (settled) return;
      settled = true;
      removePathSync(linkPath);
      if (backupLink && !pathExistsSync(linkPath)) {
        try { fs.renameSync(backupLink, linkPath); } catch {}
      }
      removePathSync(tempLink);
    },
  };
}

// ── Validation helpers ──────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// ── Lock file helpers ───────────────────────────────────────────────────────

function readLockFileWithWriter(
  writeLock: (lock: Record<string, LockEntry>) => void = writeLockFile,
): Record<string, LockEntry> {
  try {
    const raw = fs.readFileSync(getLockFilePath(), 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return {};

    const lock: Record<string, LockEntry> = {};
    let changed = false;

    for (const [name, entry] of Object.entries(parsed)) {
      const normalized = normalizeLockEntry(entry);
      if (!normalized) {
        changed = true;
        continue;
      }

      lock[name] = normalized;
      if (JSON.stringify(entry) !== JSON.stringify(normalized)) {
        changed = true;
      }
    }

    if (changed) {
      try {
        writeLock(lock);
      } catch {}
    }

    return lock;
  } catch {
    return {};
  }
}

export function readLockFile(): Record<string, LockEntry> {
  return readLockFileWithWriter(writeLockFile);
}

type WriteLockFileFsOps = Pick<typeof fs, 'mkdirSync' | 'writeFileSync' | 'renameSync' | 'rmSync'>;

function writeLockFileWithFs(
  lock: Record<string, LockEntry>,
  fsOps: WriteLockFileFsOps = fs,
): void {
  const lockPath = getLockFilePath();
  fsOps.mkdirSync(path.dirname(lockPath), { recursive: true });
  const tempPath = createSiblingTempPath(lockPath, 'tmp');

  try {
    fsOps.writeFileSync(tempPath, JSON.stringify(lock, null, 2) + '\n');
    fsOps.renameSync(tempPath, lockPath);
  } catch (err) {
    try { fsOps.rmSync(tempPath, { force: true }); } catch {}
    throw err;
  }
}

export function writeLockFile(lock: Record<string, LockEntry>): void {
  writeLockFileWithFs(lock, fs);
}

/** Get the HEAD commit hash of a git repo directory. */
export function getCommitHash(dir: string): string | undefined {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: dir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return undefined;
  }
}

function retainMonorepoBaseline(repoDir: string, cloneDir: string, commitHash: string): void {
  execFileSync(
    'git',
    ['fetch', '--no-tags', cloneDir, `${commitHash}:refs/webcmd/baselines/${commitHash}`],
    {
      cwd: repoDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
}

/** True only for git's "this directory has no repository at all" failure. */
function isNotAGitRepositoryError(error: unknown): boolean {
  const stderr = typeof (error as { stderr?: unknown })?.stderr === 'string'
    ? (error as { stderr: string }).stderr
    : (error as { stderr?: Buffer })?.stderr?.toString('utf-8') ?? '';
  const message = (error as Error)?.message ?? '';
  return /not a git repository/i.test(stderr) || /not a git repository/i.test(message);
}

function describeGitError(error: unknown): string {
  const stderr = typeof (error as { stderr?: unknown })?.stderr === 'string'
    ? (error as { stderr: string }).stderr
    : (error as { stderr?: Buffer })?.stderr?.toString('utf-8') ?? '';
  return stderr.trim() || (error as Error)?.message || String(error);
}

/**
 * Report tracked-file modifications and untracked files within `dir` in a git checkout.
 *
 * Untracked files are included on purpose: anything untracked is real, unsaved
 * user work — e.g. a new command file that hasn't been `git add`ed yet — which
 * updating would destroy just as surely as an uncommitted edit to a tracked
 * file. The exception is `installArtifacts`: those are ours, not the user's.
 *
 * The `-- .` pathspec on `git status` restricts the report to `dir` itself.
 * Without it, git reports the *entire enclosing repository* — e.g. a plugin
 * living inside a dotfiles repo, or any plugin directory that isn't itself a
 * repo root, would surface unrelated dirty files from elsewhere in the repo.
 *
 * Returns an empty array only when `dir` is genuinely not inside a git
 * repository: a plugin installed without git history has no baseline to
 * compare against, so there is nothing to protect. Any other failure (git
 * missing, "detected dubious ownership in repository", permission errors,
 * ...) is a failure to determine dirtiness, not evidence of cleanliness, and
 * must fail closed — this guard exists to prevent silent data loss, so an
 * inconclusive check must refuse the update rather than proceed as if clean.
 */
export function getDirtyFiles(dir: string, options: { pathspec?: string; against?: string } = {}): string[] {
  const pathspec = options.pathspec ?? '.';
  try {
    execFileSync('git', ['rev-parse', '--git-dir'], {
      cwd: dir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error) {
    if (isNotAGitRepositoryError(error)) return [];
    throw new PluginError(
      `Could not determine whether "${dir}" has uncommitted changes: git failed with: ${describeGitError(error)}`,
      'This can happen when git is not installed, or refuses to run here (e.g. "detected dubious ownership in repository"). Re-run with --force to update anyway — this accepts the risk of discarding uncommitted work, which is why it is not the default.',
    );
  }
  try {
    if (options.against) {
      const diff = execFileSync('git', ['diff', '--name-status', options.against, '--', pathspec], {
        cwd: dir,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '--', pathspec], {
        cwd: dir,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return [
        ...diff.split('\n').filter((line) => line.trim()).map(fromNameStatus),
        ...untracked.split('\n').filter((line) => line.trim()).map((file) => `?? ${file.trim()}`),
      ].filter((line) => !isInstallArtifact(line));
    }
    const out = execFileSync('git', ['status', '--porcelain', '--', pathspec], {
      cwd: dir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return out.split('\n').filter((line) => line.trim())
      .filter((line) => !isInstallArtifact(line))
      .map((line) => line.trim());
  } catch (error) {
    throw new PluginError(
      `Could not determine whether "${dir}" has uncommitted changes: git failed with: ${describeGitError(error)}`,
      'This can happen when git refuses to run here (e.g. "detected dubious ownership in repository"). Re-run with --force to update anyway — this accepts the risk of discarding uncommitted work, which is why it is not the default.',
    );
  }
}

/**
 * Artifacts `installDependencies` creates by running `npm install` in the
 * checkout, at the repo root and in every sub-plugin of a monorepo. A plugin
 * repo without a .gitignore reports them as dirty, so without this the guard
 * fires on webcmd's own output and every such plugin is permanently
 * un-updatable — blaming the user for work they never did.
 */
const installArtifacts = /(?:^|\/)(?:node_modules(?:\/|$)|package-lock\.json$)/;

/**
 * True only for an artifact npm itself created: a `??` (untracked) porcelain
 * entry at an artifact path. The status columns are read from the raw line
 * before any trimming, because every other status — ` M`, `M `, ` D`, `A `,
 * `R `, `UU` — is tracked work the user could lose when `updatePlugin`
 * replaces the directory, no matter what the path looks like.
 */
function isInstallArtifact(line: string): boolean {
  if (line.slice(0, 2) !== '??') return false;
  return installArtifacts.test(line.slice(2).trim());
}

/** Path portion of a `git status --porcelain` entry (already trimmed of its leading space). */
function dirtyEntryPath(entry: string): string {
  return entry.startsWith('??') ? entry.slice(2).trim() : entry.replace(/^[MADRCU!]{1,2}\s+/, '');
}

function describeDirtyEntry(entry: string): string {
  const file = dirtyEntryPath(entry);
  return entry.startsWith('??') ? `${file} (new, unstaged)` : `${file} (modified)`;
}

function fromNameStatus(line: string): string {
  const match = line.trim().match(/^([A-Z])\t?(.*)$/);
  if (!match) return `M ${line.trim()}`;
  const file = match[2]!.trim();
  return match[1] === 'A' ? `?? ${file}` : `M ${file}`;
}

function dirtyPathIsInside(entry: string, subPath: string): boolean {
  const file = dirtyEntryPath(entry).replace(/\\/g, '/');
  const prefix = subPath.replace(/\\/g, '/').replace(/\/+$/, '');
  return file === prefix || file.startsWith(`${prefix}/`);
}

function formatDirtyPaths(dirty: string[]): string {
  return dirty.slice(0, 10).map(describeDirtyEntry).join('\n  ');
}

function assertPluginNotDirty(name: string, dirty: string[], force: boolean): string[] {
  if (dirty.length === 0) return [];
  if (force) return dirty;
  throw new PluginError(
    `Plugin "${name}" has uncommitted changes that updating would destroy:\n  ${formatDirtyPaths(dirty)}`,
    'Commit or stash them, re-run with --force to discard them, or develop against a symlinked checkout with "webcmd plugin install file:///path".',
  );
}

function inspectPluginDirtiness(name: string, force: boolean, readDirty: () => string[]): string[] {
  if (force) {
    try {
      return readDirty();
    } catch {
      return [];
    }
  }
  return assertPluginNotDirty(name, readDirty(), false);
}

/**
 * Validate that a downloaded plugin directory is a structurally valid plugin.
 * Checks for at least one command file (.ts, .js) and a valid
 * package.json if it contains .ts files.
 */
export function validatePluginStructure(pluginDir: string): ValidationResult {
  const errors: string[] = [];

  if (!fs.existsSync(pluginDir)) {
    return { valid: false, errors: ['Plugin directory does not exist'] };
  }

  const files = fs.readdirSync(pluginDir);
  const hasTs = files.some(f => f.endsWith('.ts') && !f.endsWith('.d.ts') && !f.endsWith('.test.ts'));
  const hasJs = files.some(f => f.endsWith('.js') && !f.endsWith('.d.js'));

  if (!hasTs && !hasJs) {
    errors.push('No command files found in plugin directory. A plugin must contain at least one .ts or .js command file.');
  }

  if (hasTs) {
    const pkgJsonPath = path.join(pluginDir, 'package.json');
    if (!fs.existsSync(pkgJsonPath)) {
      errors.push('Plugin contains .ts files but no package.json. A package.json with "type": "module" and "@agentrhq/webcmd" peer dependency is required for TS plugins.');
    } else {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
        if (pkg.type !== 'module') {
          errors.push('Plugin package.json must have "type": "module" for TypeScript plugins.');
        }
      } catch {
        errors.push('Plugin package.json is malformed or invalid JSON.');
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/** Check whether a directory has its own production dependencies in package.json. */
function hasOwnDependencies(dir: string): boolean {
  const pkgPath = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgPath)) return false;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    return pkg.dependencies != null && Object.keys(pkg.dependencies).length > 0;
  } catch {
    return false;
  }
}

function installDependencies(dir: string): void {
  const pkgJsonPath = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgJsonPath)) return;

  try {
    // Plugin repositories and their transitive dependencies are untrusted.
    // Webcmd adapters do not require install-time lifecycle scripts, so deny
    // preinstall/install/postinstall execution with the user's privileges.
    execFileSync('npm', ['install', '--omit=dev', '--ignore-scripts'], {
      cwd: dir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      ...(isWindows && { shell: true }),
    });
  } catch (err) {
    throw new PluginError(`npm install failed in ${dir}: ${getErrorMessage(err)}`, 'Check your network connection and npm configuration.');
  }
}

function finalizePluginRuntime(pluginDir: string): void {
  // Symlink host webcmd so TS plugins resolve '@agentrhq/webcmd/registry'
  // against the running host, not a stale npm-published version.
  linkHostWebcmd(pluginDir);

  // Transpile .ts → .js via esbuild (production node can't load .ts directly).
  transpilePluginTs(pluginDir);
}

/**
 * Shared post-install lifecycle for standalone plugins.
 */
function postInstallLifecycle(pluginDir: string): void {
  installDependencies(pluginDir);
  finalizePluginRuntime(pluginDir);
}

/**
 * Monorepo lifecycle: install shared deps at repo root, then install and finalize each sub-plugin.
 *
 * The root install covers monorepos that use npm workspaces to hoist dependencies.
 * For monorepos that do NOT use workspaces, sub-plugins may declare their own
 * production dependencies in their package.json.  We install those per sub-plugin
 * so that runtime imports (e.g. `undici`) can be resolved from the sub-plugin
 * directory.  When the root already satisfies all deps this is a fast no-op.
 */
function postInstallMonorepoLifecycle(repoDir: string, pluginDirs: string[]): void {
  installDependencies(repoDir);
  for (const pluginDir of pluginDirs) {
    if (pluginDir !== repoDir && hasOwnDependencies(pluginDir)) {
      installDependencies(pluginDir);
    }
    finalizePluginRuntime(pluginDir);
  }
}

function ensureStandalonePluginReady(pluginDir: string): void {
  const validation = validatePluginStructure(pluginDir);
  if (!validation.valid) {
    throw new PluginError(`Invalid plugin structure:\n- ${validation.errors.join('\n- ')}`);
  }

  postInstallLifecycle(pluginDir);
}

type LockEntryInput = Omit<LockEntry, 'installedAt'> & Partial<Pick<LockEntry, 'installedAt'>>;

function upsertLockEntry(
  lock: Record<string, LockEntry>,
  name: string,
  entry: LockEntryInput,
): void {
  lock[name] = {
    ...entry,
    installedAt: entry.installedAt ?? new Date().toISOString(),
  };
}

function publishStandalonePlugin(
  stagingDir: string,
  targetDir: string,
  writeLock: (commitHash: string | undefined) => void,
  ): void {
  runTransaction((tx) => {
    tx.track(beginReplaceDir(stagingDir, targetDir));
    writeLock(getCommitHash(targetDir));
  });
}

interface MonorepoPublishPlugin {
  name: string;
  subPath: string;
}

function publishMonorepoPlugins(
  repoDir: string,
  pluginsDir: string,
  plugins: MonorepoPublishPlugin[],
  publishRepo?: {
    stagingDir: string;
    parentDir: string;
    replaceSubPath?: string;
    sharedNodeModulesDir?: string;
  },
  writeLock?: (commitHash: string | undefined) => void,
): void {
  runTransaction((tx) => {
    if (publishRepo?.replaceSubPath) {
      tx.track(beginReplaceDir(publishRepo.stagingDir, resolveRepoContainedPath(repoDir, publishRepo.replaceSubPath)));
      if (publishRepo.sharedNodeModulesDir && fs.existsSync(publishRepo.sharedNodeModulesDir)) {
        tx.track(beginReplaceDir(publishRepo.sharedNodeModulesDir, path.join(repoDir, 'node_modules')));
      }
    } else if (publishRepo) {
      fs.mkdirSync(publishRepo.parentDir, { recursive: true });
      tx.track(beginReplaceDir(publishRepo.stagingDir, repoDir));
    }

    const commitHash = getCommitHash(repoDir);
    for (const plugin of plugins) {
      const linkPath = path.join(pluginsDir, plugin.name);
      const subDir = resolveRepoContainedPath(repoDir, plugin.subPath);
      tx.track(beginReplaceSymlink(subDir, linkPath));
    }

    writeLock?.(commitHash);
  });
}

/**
 * Install a plugin from a source.
 * Supports:
 *   "github:user/repo"            — single plugin or full monorepo
 *   "github:user/repo/subplugin"  — specific sub-plugin from a monorepo
 *   "https://github.com/user/repo"
 *   "file:///absolute/path"       — local plugin directory (symlinked)
 *   "/absolute/path"              — local plugin directory (symlinked)
 *
 * Returns the installed plugin name(s).
 */
export function installPlugin(source: string, options: { all?: boolean } = {}): string | string[] {
  const parsed = parseSource(source);
  if (!parsed) {
    throw new InvalidPluginSourceError(source);
  }
  return installParsedPlugin(parsed, source, options);
}

/** A bare token like `openfda` — a plugin NAME, not a source. Worth a catalog lookup. */
export function looksLikePluginName(source: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/i.test(source);
}

/**
 * Raised when `plugin install` is handed something that is not a source.
 *
 * Agents reliably type the plugin name here, because that is what `plugin
 * search` shows them first. The format list alone left them guessing; the CLI
 * layer catches this and resolves the real installSource from the catalog.
 */
export class InvalidPluginSourceError extends Error {
  readonly source: string;

  constructor(source: string) {
    super(
      `Invalid plugin source: "${source}"\n` +
      `Supported formats:\n` +
      `  github:user/repo\n` +
      `  github:user/repo/subplugin\n` +
      `  https://github.com/user/repo\n` +
      `  https://<host>/<path>/repo.git\n` +
      `  ssh://git@<host>/<path>/repo.git\n` +
      `  git@<host>:user/repo.git\n` +
      `  file:///absolute/path\n` +
      `  /absolute/path`
    );
    this.name = 'InvalidPluginSourceError';
    this.source = source;
  }
}

function installParsedPlugin(
  parsed: NonNullable<ReturnType<typeof parseSource>>,
  source: string,
  options: { all?: boolean } = {},
): string | string[] {
  const { name: repoName, subPlugin } = parsed;

  if (parsed.type === 'local') {
    return installLocalPlugin(parsed.localPath!, repoName);
  }

  return withTempClone(parsed.cloneUrl!, (tmpCloneDir) => {
    const manifest = readPluginManifest(tmpCloneDir);

    // Check top-level compatibility
    if (manifest?.webcmd && !checkCompatibility(manifest.webcmd)) {
      throw new Error(
        `Plugin requires webcmd ${manifest.webcmd}, but current version is incompatible.`
      );
    }

    if (manifest && isMonorepo(manifest)) {
      return installMonorepo(tmpCloneDir, parsed.cloneUrl!, repoName, manifest, subPlugin, options.all === true);
    }

    // Single plugin mode
    return installSinglePlugin(tmpCloneDir, parsed.cloneUrl!, repoName, manifest);
  });
}

/** Install a single (non-monorepo) plugin. */
function installSinglePlugin(
  cloneDir: string,
  cloneUrl: string,
  name: string,
  manifest: PluginManifest | null,
): string {
  const pluginName = manifest?.name ?? name;
  const targetDir = path.join(PLUGINS_DIR, pluginName);

  if (fs.existsSync(targetDir)) {
    throw new PluginError(`Plugin "${pluginName}" is already installed at ${targetDir}`, 'Use "webcmd plugin uninstall" first, or pick a different name.');
  }

  ensureStandalonePluginReady(cloneDir);
  publishStandalonePlugin(cloneDir, targetDir, (commitHash) => {
    const lock = readLockFile();
    if (commitHash) {
      upsertLockEntry(lock, pluginName, {
        source: { kind: 'git', url: cloneUrl },
        commitHash,
      });
      writeLockFile(lock);
    }
  });

  return pluginName;
}

/**
 * Install a local plugin by creating a symlink.
 * Used for plugin development: the source directory is symlinked into
 * the plugins dir so changes are reflected immediately.
 */
function installLocalPlugin(localPath: string, name: string): string {
  if (!fs.existsSync(localPath)) {
    throw new PluginError(`Local plugin path does not exist: ${localPath}`);
  }

  const stat = fs.statSync(localPath);
  if (!stat.isDirectory()) {
    throw new PluginError(`Local plugin path is not a directory: ${localPath}`);
  }

  const manifest = readPluginManifest(localPath);

  if (manifest?.webcmd && !checkCompatibility(manifest.webcmd)) {
    throw new PluginError(
      `Plugin requires webcmd ${manifest.webcmd}, but current version is incompatible.`,
      'Upgrade webcmd to a compatible version.',
    );
  }

  const pluginName = manifest?.name ?? name;
  const targetDir = path.join(PLUGINS_DIR, pluginName);

  if (fs.existsSync(targetDir)) {
    throw new PluginError(`Plugin "${pluginName}" is already installed at ${targetDir}`, 'Use "webcmd plugin uninstall" first, or pick a different name.');
  }

  const validation = validatePluginStructure(localPath);
  if (!validation.valid) {
    throw new PluginError(`Invalid plugin structure:\n- ${validation.errors.join('\n- ')}`);
  }

  fs.mkdirSync(PLUGINS_DIR, { recursive: true });

  const resolvedPath = path.resolve(localPath);
  const linkType = isWindows ? 'junction' : 'dir';
  fs.symlinkSync(resolvedPath, targetDir, linkType);

  installDependencies(localPath);
  finalizePluginRuntime(localPath);

  const lock = readLockFile();
  const commitHash = getCommitHash(localPath);
  upsertLockEntry(lock, pluginName, {
    source: { kind: 'local', path: resolvedPath },
    commitHash: commitHash ?? 'local',
  });
  writeLockFile(lock);

  return pluginName;
}

function updateLocalPlugin(
  name: string,
  targetDir: string,
  lock: Record<string, LockEntry>,
  lockEntry?: LockEntry,
): void {
  const pluginDir = fs.realpathSync(targetDir);

  const validation = validatePluginStructure(pluginDir);
  if (!validation.valid) {
    log.warn(`Plugin "${name}" structure invalid:\n- ${validation.errors.join('\n- ')}`);
  }

  postInstallLifecycle(pluginDir);

  upsertLockEntry(lock, name, {
    source: lockEntry?.source ?? { kind: 'local', path: pluginDir },
    commitHash: getCommitHash(pluginDir) ?? 'local',
    installedAt: lockEntry?.installedAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  writeLockFile(lock);
}

/** Install sub-plugins from a monorepo. */
function installMonorepo(
  cloneDir: string,
  cloneUrl: string,
  repoName: string,
  manifest: PluginManifest,
  subPlugin?: string,
  installAll = false,
): string[] {
  const monoreposDir = getMonoreposDir();
  const repoDir = path.join(monoreposDir, repoName);
  const repoAlreadyInstalled = fs.existsSync(repoDir);
  let repoRoot = repoAlreadyInstalled ? repoDir : cloneDir;
  let effectiveManifest = repoAlreadyInstalled ? readPluginManifest(repoDir) : manifest;
  let publishRepo = repoAlreadyInstalled ? undefined : { stagingDir: cloneDir, parentDir: monoreposDir };

  if (
    repoAlreadyInstalled
    && subPlugin
    && (!effectiveManifest?.plugins?.[subPlugin] || effectiveManifest.plugins[subPlugin].disabled)
    && manifest.plugins?.[subPlugin]
    && !manifest.plugins[subPlugin].disabled
  ) {
    repoRoot = cloneDir;
    effectiveManifest = manifest;
    publishRepo = { stagingDir: cloneDir, parentDir: monoreposDir };
  }

  if (!effectiveManifest || !isMonorepo(effectiveManifest)) {
    throw new PluginError(`Monorepo manifest missing or invalid at ${repoRoot}`);
  }

  let pluginsToInstall = getEnabledPlugins(effectiveManifest);
  if (!subPlugin && !installAll) {
    throw new PluginError(
      `This source has ${pluginsToInstall.length} plugins; install one with github:user/repo/<plugin>, or pass --all to install every plugin.`,
    );
  }

  // If a specific sub-plugin was requested, filter to just that one
  if (subPlugin) {
    pluginsToInstall = pluginsToInstall.filter((p) => p.name === subPlugin);
    if (pluginsToInstall.length === 0) {
      // Check if it exists but is disabled
      const disabled = effectiveManifest.plugins?.[subPlugin];
      if (disabled) {
        throw new PluginError(`Sub-plugin "${subPlugin}" is disabled in the manifest.`);
      }
      throw new PluginError(
        `Sub-plugin "${subPlugin}" not found in monorepo. Available: ${Object.keys(effectiveManifest.plugins ?? {}).join(', ')}`
      );
    }
  }

  const installedNames: string[] = [];
  const lock = readLockFile();
  const eligiblePlugins: Array<{ name: string; entry: typeof pluginsToInstall[number]['entry'] }> = [];

  fs.mkdirSync(PLUGINS_DIR, { recursive: true });

  for (const { name, entry } of pluginsToInstall) {
    // Check sub-plugin level compatibility (overrides top-level)
    if (entry.webcmd && !checkCompatibility(entry.webcmd)) {
      log.warn(`Skipping "${name}": requires webcmd ${entry.webcmd}`);
      continue;
    }

    let subDir: string;
    try {
      subDir = resolveRepoContainedPath(repoRoot, entry.path);
    } catch {
      log.warn(`Skipping "${name}": path "${entry.path}" escapes repo root.`);
      continue;
    }
    if (!fs.existsSync(subDir)) {
      log.warn(`Skipping "${name}": path "${entry.path}" not found in repo.`);
      continue;
    }

    const validation = validatePluginStructure(subDir);
    if (!validation.valid) {
      log.warn(`Skipping "${name}": invalid structure — ${validation.errors.join(', ')}`);
      continue;
    }

    const linkPath = path.join(PLUGINS_DIR, name);
    if (fs.existsSync(linkPath)) {
      log.warn(`Skipping "${name}": already installed at ${linkPath}`);
      continue;
    }

    eligiblePlugins.push({ name, entry });
  }

  if (eligiblePlugins.length === 0) {
    return installedNames;
  }

  const publishPlugins = eligiblePlugins.map(({ name, entry }) => ({ name, subPath: entry.path }));

  postInstallMonorepoLifecycle(
    repoRoot,
    eligiblePlugins.map((p) => resolveRepoContainedPath(repoRoot, p.entry.path)),
  );

  publishMonorepoPlugins(
    repoDir,
    PLUGINS_DIR,
    publishPlugins,
    publishRepo,
    (commitHash) => {
      for (const { name, entry } of eligiblePlugins) {
        if (commitHash) {
          upsertLockEntry(lock, name, {
            source: {
              kind: 'monorepo',
              url: cloneUrl,
              repoName,
              subPath: entry.path,
            },
            commitHash,
          });
        }
        installedNames.push(name);
      }
      writeLockFile(lock);
    },
  );

  return installedNames;
}

function collectUpdatedMonorepoPlugins(
  monoName: string,
  lock: Record<string, LockEntry>,
  manifest: PluginManifest,
  cloneUrl: string,
  tmpCloneDir: string,
  only?: string,
): Array<{
  name: string;
  lockEntry: LockEntry;
  manifestEntry: NonNullable<PluginManifest['plugins']>[string];
}> {
  const updatedPlugins: Array<{
    name: string;
    lockEntry: LockEntry;
    manifestEntry: NonNullable<PluginManifest['plugins']>[string];
  }> = [];

  for (const [pluginName, entry] of Object.entries(lock)) {
    if (only && pluginName !== only) continue;
    if (entry.source.kind !== 'monorepo' || entry.source.repoName !== monoName) continue;
    const manifestEntry = manifest.plugins?.[pluginName];
    if (!manifestEntry || manifestEntry.disabled) {
      throw new Error(`Installed sub-plugin "${pluginName}" no longer exists in ${cloneUrl}`);
    }
    if (manifestEntry.webcmd && !checkCompatibility(manifestEntry.webcmd)) {
      throw new Error(`Sub-plugin "${pluginName}" requires webcmd ${manifestEntry.webcmd}`);
    }

    const subDir = resolveRepoContainedPath(tmpCloneDir, manifestEntry.path);
    const validation = validatePluginStructure(subDir);
    if (!validation.valid) {
      throw new Error(`Updated sub-plugin "${pluginName}" is invalid:\n- ${validation.errors.join('\n- ')}`);
    }
    updatedPlugins.push({ name: pluginName, lockEntry: entry, manifestEntry });
  }

  return updatedPlugins;
}

function updateMonorepoLockEntries(
  lock: Record<string, LockEntry>,
  plugins: Array<{
    name: string;
    lockEntry: LockEntry;
    manifestEntry: NonNullable<PluginManifest['plugins']>[string];
  }>,
  cloneUrl: string,
  monoName: string,
  commitHash: string | undefined,
): void {
  for (const plugin of plugins) {
    if (!commitHash) continue;
    upsertLockEntry(lock, plugin.name, {
      ...plugin.lockEntry,
      source: {
        kind: 'monorepo',
        url: cloneUrl,
        repoName: monoName,
        subPath: plugin.manifestEntry.path,
      },
      commitHash,
      updatedAt: new Date().toISOString(),
    });
  }
}

function updateStandaloneLockEntry(
  lock: Record<string, LockEntry>,
  name: string,
  cloneUrl: string,
  existing: LockEntry | undefined,
  commitHash: string | undefined,
): void {
  if (!commitHash) return;

  upsertLockEntry(lock, name, {
    source: { kind: 'git', url: cloneUrl },
    commitHash,
    installedAt: existing?.installedAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Uninstall a plugin by name.
 * For monorepo sub-plugins: removes symlink and cleans up the monorepo
 * directory when no more sub-plugins reference it.
 */
export function uninstallPlugin(name: string): void {
  const targetDir = path.join(PLUGINS_DIR, name);
  if (!fs.existsSync(targetDir)) {
    throw new Error(`Plugin "${name}" is not installed.`);
  }

  const lock = readLockFile();
  const lockEntry = lock[name];

  // Check if this is a symlink (monorepo sub-plugin)
  const isSymlink = isSymlinkSync(targetDir);

  if (isSymlink) {
    // Remove symlink only (not the actual directory)
    fs.unlinkSync(targetDir);
  } else {
    fs.rmSync(targetDir, { recursive: true, force: true });
  }

  // Clean up monorepo directory if no more sub-plugins reference it
  if (lockEntry?.source.kind === 'monorepo') {
    delete lock[name];
    const monoName = lockEntry.source.repoName;
    const stillReferenced = Object.values(lock).some(
      (entry) => entry.source.kind === 'monorepo' && entry.source.repoName === monoName,
    );
    if (!stillReferenced) {
      const monoDir = path.join(getMonoreposDir(), monoName);
      try { fs.rmSync(monoDir, { recursive: true, force: true }); } catch {}
    }
  } else if (lock[name]) {
    delete lock[name];
  }

  writeLockFile(lock);
}

/** Synchronous check if a path is a symlink. */
function isSymlinkSync(p: string): boolean {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Update a plugin by name (git pull + re-install lifecycle).
 * For monorepo sub-plugins: updates only the named plugin's subdirectory.
 */
export function updatePlugin(name: string, options: { force?: boolean } = {}): string[] {
  const targetDir = path.join(PLUGINS_DIR, name);
  if (!fs.existsSync(targetDir)) {
    throw new Error(`Plugin "${name}" is not installed.`);
  }
  const lock = readLockFile();
  const lockEntry = lock[name];
  const source = resolvePluginSource(lockEntry, targetDir);

  if (source?.kind === 'local') {
    // Local installs are symlinked to the user's own checkout, not replaced
    // wholesale, so dirty edits there are the intended workflow, not a hazard.
    updateLocalPlugin(name, targetDir, lock, lockEntry);
    return [name];
  }

  if (source?.kind === 'monorepo') {
    const monoDir = path.join(getMonoreposDir(), source.repoName);
    const monoName = source.repoName;
    const cloneUrl = source.url;
    const discarded = inspectPluginDirtiness(name, options.force === true, () => getDirtyFiles(monoDir, {
      pathspec: source.subPath,
      ...(lockEntry?.commitHash ? { against: lockEntry.commitHash } : {}),
    }));
    if (options.force === true && discarded.length > 0) {
      console.error(`--force will discard uncommitted changes in "${name}":\n  ${formatDirtyPaths(discarded)}`);
    }
    const siblingDirty = inspectPluginDirtiness(name, true, () => getDirtyFiles(monoDir))
      .filter((entry) => !dirtyPathIsInside(entry, source.subPath));
    if (siblingDirty.length > 0) {
      console.error(`Shared monorepo has uncommitted files outside "${name}"; leaving them in place:\n  ${formatDirtyPaths(siblingDirty)}`);
    }
    return withTempClone(cloneUrl, (tmpCloneDir) => {
      const manifest = readPluginManifest(tmpCloneDir);
      if (!manifest || !isMonorepo(manifest)) {
        throw new Error(`Updated source is no longer a monorepo: ${cloneUrl}`);
      }

      if (manifest.webcmd && !checkCompatibility(manifest.webcmd)) {
        throw new Error(
          `Plugin requires webcmd ${manifest.webcmd}, but current version is incompatible.`
        );
      }

      const updatedPlugins = collectUpdatedMonorepoPlugins(
        monoName,
        lock,
        manifest,
        cloneUrl,
        tmpCloneDir,
        name,
      );

      if (updatedPlugins.length > 0) {
        postInstallMonorepoLifecycle(
          tmpCloneDir,
          updatedPlugins.map((plugin) => resolveRepoContainedPath(tmpCloneDir, plugin.manifestEntry.path)),
        );
      }

      const plugin = updatedPlugins[0];
      if (!plugin) return [];
      const commitHash = getCommitHash(tmpCloneDir);
      if (commitHash) retainMonorepoBaseline(monoDir, tmpCloneDir, commitHash);
      publishMonorepoPlugins(
        monoDir,
        PLUGINS_DIR,
        [{ name: plugin.name, subPath: plugin.manifestEntry.path }],
        {
          stagingDir: resolveRepoContainedPath(tmpCloneDir, plugin.manifestEntry.path),
          parentDir: path.dirname(monoDir),
          replaceSubPath: plugin.manifestEntry.path,
          sharedNodeModulesDir: path.join(tmpCloneDir, 'node_modules'),
        },
        () => {
          updateMonorepoLockEntries(lock, updatedPlugins, cloneUrl, monoName, commitHash);
          writeLockFile(lock);
        },
      );
      return updatedPlugins.map((item) => item.name);
    });
  }

  const discarded = inspectPluginDirtiness(name, options.force === true, () => getDirtyFiles(targetDir));
  if (options.force === true && discarded.length > 0) {
    console.error(`--force will discard uncommitted changes in "${name}":\n  ${formatDirtyPaths(discarded)}`);
  }

  const cloneUrl = resolveRemotePluginSource(lockEntry, targetDir);
  withTempClone(cloneUrl, (tmpCloneDir) => {
    const manifest = readPluginManifest(tmpCloneDir);
    if (manifest && isMonorepo(manifest)) {
      throw new Error(`Updated source is now a monorepo: ${cloneUrl}`);
    }

    if (manifest?.webcmd && !checkCompatibility(manifest.webcmd)) {
      throw new Error(
        `Plugin requires webcmd ${manifest.webcmd}, but current version is incompatible.`
      );
    }

    ensureStandalonePluginReady(tmpCloneDir);
    publishStandalonePlugin(tmpCloneDir, targetDir, (commitHash) => {
      updateStandaloneLockEntry(lock, name, cloneUrl, lock[name], commitHash);
      if (commitHash) {
        writeLockFile(lock);
      }
    });
  });
  return [name];
}

export interface UpdateResult {
  name: string;
  success: boolean;
  error?: string;
  updatedPlugins?: string[];
}

/**
 * Update all installed plugins.
 * Continues even if individual plugin updates fail.
 */
export function updateAllPlugins(options: { force?: boolean } = {}): UpdateResult[] {
  return listPlugins().map((plugin): UpdateResult => {
    try {
      return { name: plugin.name, success: true, updatedPlugins: updatePlugin(plugin.name, options) };
    } catch (err) {
      return {
        name: plugin.name,
        success: false,
        error: getErrorMessage(err),
      };
    }
  });
}

export interface OverrideReconcileNeed {
  commandKey: string;
  plugin: string;
  yours: string;
  upstream: string;
  base: string | null;
}

/**
 * Find overrides whose upstream plugin file has changed since the fork.
 *
 * Content-based, not commit-based: a plugin's commitHash moves whenever
 * *any* of its commands change, so comparing commitHash would flag every
 * override on every unrelated update. Comparing the file's own sha256
 * against the override record's sourceSha256 only flags overrides whose
 * actual upstream content changed.
 */
export function findOverridesNeedingReconcile(pluginNames?: string[]): OverrideReconcileNeed[] {
  const homeDir = getHomeDir();
  const records = readOverrideRecords(homeDir);
  const needs: OverrideReconcileNeed[] = [];

  for (const [commandKey, record] of Object.entries(records)) {
    if (pluginNames && !pluginNames.includes(record.plugin)) continue;
    // Plugin was uninstalled: no upstream to reconcile against. Task 7's
    // `adapter status` surfaces these separately as orphaned.
    if (!fs.existsSync(record.sourcePath)) continue;
    if (fileSha256(record.sourcePath) === record.sourceSha256) continue;

    needs.push({
      commandKey,
      plugin: record.plugin,
      yours: path.join(homeDir, '.webcmd', 'clis', `${commandKey}.js`),
      upstream: record.sourcePath,
      base: fs.existsSync(record.basePath) ? record.basePath : null,
    });
  }

  return needs;
}

/**
 * List all installed plugins.
 * Reads webcmd-plugin.json for description/version when available.
 */
export function listPlugins(): PluginInfo[] {
  const pluginsDir = getPluginsDir(getHomeDir());
  if (!fs.existsSync(pluginsDir)) return [];

  const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
  const lock = readLockFile();
  const records = readOverrideRecords(getHomeDir());
  const updates = new Set(findOverridesNeedingReconcile().map(({ commandKey }) => commandKey));
  const plugins: PluginInfo[] = [];

  for (const entry of entries) {
    // Accept both real directories and symlinks (monorepo sub-plugins)
    const pluginDir = path.join(pluginsDir, entry.name);
    const isDir = entry.isDirectory() || isSymlinkSync(pluginDir);
    if (!isDir) continue;

    const commands = scanPluginCommands(pluginDir);
    const lockEntry = lock[entry.name];

    // Try to read manifest for metadata
    const manifest = readPluginManifest(pluginDir);
    // For monorepo sub-plugins, also check the monorepo root manifest
    let description = manifest?.description;
    let version = manifest?.version;
    if (lockEntry?.source.kind === 'monorepo' && !description) {
      const monoDir = path.join(getMonoreposDir(), lockEntry.source.repoName);
      const monoManifest = readPluginManifest(monoDir);
      const subEntry = monoManifest?.plugins?.[entry.name];
      if (subEntry) {
        description = description ?? subEntry.description;
        version = version ?? subEntry.version;
      }
    }

    const source = resolveStoredPluginSource(lockEntry, pluginDir);
    const overrideKeys = Object.keys(records)
      .filter((commandKey) => records[commandKey]!.plugin === entry.name)
      .sort();

    plugins.push({
      name: entry.name,
      path: pluginDir,
      commands,
      source,
      version: version ?? lockEntry?.commitHash?.slice(0, 7),
      installedAt: lockEntry?.installedAt,
      monorepoName: lockEntry?.source.kind === 'monorepo' ? lockEntry.source.repoName : undefined,
      description,
      overrides: overrideKeys.map((commandKey) => commandKey.slice(commandKey.indexOf('/') + 1)),
      updateAvailable: overrideKeys.some((commandKey) => updates.has(commandKey)),
    });
  }

  return plugins;
}

/** Scan a plugin directory for command files */
function scanPluginCommands(dir: string): string[] {
  try {
    const files = fs.readdirSync(dir);
    const names = new Set(
      files
        .filter(f =>
          (f.endsWith('.ts') && !f.endsWith('.d.ts') && !f.endsWith('.test.ts')) ||
          (f.endsWith('.js') && !f.endsWith('.d.js'))
        )
        .map(f => path.basename(f, path.extname(f)))
    );
    return [...names];
  } catch {
    return [];
  }
}

/** Get git remote origin URL */
function getPluginSource(dir: string): string | undefined {
  try {
    return execFileSync('git', ['config', '--get', 'remote.origin.url'], {
      cwd: dir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return undefined;
  }
}

/** Parse a plugin source string into clone URL, repo name, and optional sub-plugin. */
function parseSource(
  source: string,
): ParsedSource | null {
  if (source.startsWith('file://')) {
    try {
      const localPath = path.resolve(fileURLToPath(source));
      return {
        type: 'local',
        localPath,
        name: path.basename(localPath).replace(/^webcmd-plugin-/, ''),
      };
    } catch {
      return null;
    }
  }

  if (path.isAbsolute(source)) {
    const localPath = path.resolve(source);
    return {
      type: 'local',
      localPath,
      name: path.basename(localPath).replace(/^webcmd-plugin-/, ''),
    };
  }

  // github:user/repo/subplugin  (monorepo specific sub-plugin)
  const githubSubMatch = source.match(
    /^github:([\w.-]+)\/([\w.-]+)\/([\w.-]+)$/,
  );
  if (githubSubMatch) {
    const [, user, repo, sub] = githubSubMatch;
    const name = repo.replace(/^webcmd-plugin-/, '');
    return {
      type: 'git',
      cloneUrl: `https://github.com/${user}/${repo}.git`,
      name,
      subPlugin: sub,
    };
  }

  // github:user/repo
  const githubMatch = source.match(/^github:([\w.-]+)\/([\w.-]+)$/);
  if (githubMatch) {
    const [, user, repo] = githubMatch;
    const name = repo.replace(/^webcmd-plugin-/, '');
    return {
      type: 'git',
      cloneUrl: `https://github.com/${user}/${repo}.git`,
      name,
    };
  }

  // https://github.com/user/repo (or .git)
  const urlMatch = source.match(
    /^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?$/,
  );
  if (urlMatch) {
    const [, user, repo] = urlMatch;
    const name = repo.replace(/^webcmd-plugin-/, '');
    return {
      type: 'git',
      cloneUrl: `https://github.com/${user}/${repo}.git`,
      name,
    };
  }

  // ── Generic git URL support ─────────────────────────────────────────────

  // ssh://git@host/path/to/repo.git
  const sshUrlMatch = source.match(/^ssh:\/\/[^/]+\/(.*?)(?:\.git)?$/);
  if (sshUrlMatch) {
    const pathPart = sshUrlMatch[1];
    const segments = pathPart.split('/');
    const repoSegment = segments.pop()!;
    const name = repoSegment.replace(/^webcmd-plugin-/, '');
    return { type: 'git', cloneUrl: source, name };
  }

  // git@host:user/repo.git (SCP-style)
  const scpMatch = source.match(/^git@[^:]+:(.+?)(?:\.git)?$/);
  if (scpMatch) {
    const pathPart = scpMatch[1];
    const segments = pathPart.split('/');
    const repoSegment = segments.pop()!;
    const name = repoSegment.replace(/^webcmd-plugin-/, '');
    return { type: 'git', cloneUrl: source, name };
  }

  // Generic https/http git URL (non-GitHub hosts)
  const genericHttpMatch = source.match(
    /^https?:\/\/[^/]+\/(.+?)(?:\.git)?$/,
  );
  if (genericHttpMatch) {
    const pathPart = genericHttpMatch[1];
    const segments = pathPart.split('/');
    const repoSegment = segments.pop()!;
    const name = repoSegment.replace(/^webcmd-plugin-/, '');
    // Ensure clone URL ends with .git
    const cloneUrl = source.endsWith('.git') ? source : `${source}.git`;
    return { type: 'git', cloneUrl, name };
  }

  return null;
}

/**
 * Symlink the host webcmd package into a plugin's node_modules.
 * This ensures TS plugins resolve '@agentrhq/webcmd/registry' against
 * the running host installation rather than a stale npm-published version.
 */
function linkHostWebcmd(pluginDir: string): void {
  try {
    const hostRoot = resolveHostWebcmdRoot();

    const targetLink = path.join(pluginDir, 'node_modules', '@agentrhq', 'webcmd');
    ensureHostWebcmdPackageLink(targetLink, hostRoot);
    log.debug(`Linked host webcmd into plugin: ${targetLink} → ${hostRoot}`);
  } catch (err) {
    log.warn(`Failed to link host webcmd into plugin: ${getErrorMessage(err)}`);
  }
}

function getHostSourcePackageExports(hostRoot: string): Record<string, string> {
  const pkg = JSON.parse(fs.readFileSync(path.join(hostRoot, 'package.json'), 'utf-8')) as {
    exports?: Record<string, string>;
  };
  const exports = pkg.exports ?? {};
  return Object.fromEntries(
    Object.entries(exports).map(([key, target]) => [
      key,
      target
        .replace(/^\.\/dist\//, './')
        .replace(/\.js$/, '.ts'),
    ]),
  );
}

function writeFileIfChanged(filePath: string, content: string): void {
  try {
    if (fs.readFileSync(filePath, 'utf-8') === content) return;
  } catch {}
  fs.writeFileSync(filePath, content, 'utf-8');
}

function ensureSourcePackageShim(targetLink: string, hostRoot: string): void {
  const srcLink = path.join(targetLink, 'src');
  const srcTarget = path.join(hostRoot, 'src');
  const pkgJsonContent = `${JSON.stringify({
    name: PACKAGE_NAME,
    private: true,
    type: 'module',
    exports: getHostSourcePackageExports(hostRoot),
  }, null, 2)}\n`;

  if (pathExistsSync(targetLink) && !fs.lstatSync(targetLink).isDirectory()) {
    removePathSync(targetLink);
  }

  fs.mkdirSync(targetLink, { recursive: true });
  writeFileIfChanged(path.join(targetLink, 'package.json'), pkgJsonContent);

  let needsSrcLink = true;
  try {
    if (fs.readlinkSync(srcLink) === srcTarget) needsSrcLink = false;
  } catch {}
  if (needsSrcLink) {
    removePathSync(srcLink);
    const linkType = isWindows ? 'junction' : 'dir';
    fs.symlinkSync(srcTarget, srcLink, linkType);
  }
}

function ensureHostWebcmdPackageLink(targetLink: string, hostRoot: string): void {
  const hasBuiltExports = fs.existsSync(path.join(hostRoot, 'dist', 'src', 'registry-api.js'));

  if (!hasBuiltExports) {
    if (pathExistsSync(targetLink) && fs.lstatSync(targetLink).isSymbolicLink()) {
      removePathSync(targetLink);
    }
    ensureSourcePackageShim(targetLink, hostRoot);
    return;
  }

  let needsUpdate = true;
  try {
    if (fs.readlinkSync(targetLink) === hostRoot) needsUpdate = false;
  } catch {}
  if (!needsUpdate) return;

  removePathSync(targetLink);
  fs.mkdirSync(path.dirname(targetLink), { recursive: true });
  const linkType = isWindows ? 'junction' : 'dir';
  fs.symlinkSync(hostRoot, targetLink, linkType);
}

/**
 * Resolve the path to the esbuild CLI executable with fallback strategies.
 */
export function resolveEsbuildBin(): string | null {
  const hostRoot = resolveHostWebcmdRoot();

  // Strategy 1 (Windows): prefer the .cmd wrapper which is executable via shell
  if (isWindows) {
    const cmdPath = path.join(hostRoot, 'node_modules', '.bin', 'esbuild.cmd');
    if (fs.existsSync(cmdPath)) {
      return cmdPath;
    }
  }

  // Strategy 2: resolve esbuild binary via import.meta.resolve
  // (On Unix, shebang scripts are directly executable; on Windows they are not,
  //  so this strategy is skipped on Windows in favour of the .cmd wrapper above.)
  if (!isWindows) {
    try {
      const pkgUrl = import.meta.resolve('esbuild/package.json');
      if (pkgUrl.startsWith('file://')) {
        const pkgPath = fileURLToPath(pkgUrl);
        const pkgRaw = fs.readFileSync(pkgPath, 'utf8');
        const pkg = JSON.parse(pkgRaw);
        if (pkg.bin && typeof pkg.bin === 'object' && pkg.bin.esbuild) {
          const binPath = path.resolve(path.dirname(pkgPath), pkg.bin.esbuild);
          if (fs.existsSync(binPath)) return binPath;
        } else if (typeof pkg.bin === 'string') {
          const binPath = path.resolve(path.dirname(pkgPath), pkg.bin);
          if (fs.existsSync(binPath)) return binPath;
        }
      }
    } catch {
      // ignore package resolution failures
    }
  }

  // Strategy 3: fallback to node_modules/.bin/esbuild (Unix)
  const binFallback = path.join(hostRoot, 'node_modules', '.bin', 'esbuild');
  if (fs.existsSync(binFallback)) {
    return binFallback;
  }

  // Strategy 4: global esbuild in PATH
  try {
    const lookupCmd = isWindows ? 'where esbuild' : 'which esbuild';
    // `where` on Windows may return multiple lines; take only the first match.
    const globalBin = execSync(lookupCmd, { encoding: 'utf-8', stdio: 'pipe' }).trim().split('\n')[0].trim();
    if (globalBin && fs.existsSync(globalBin)) {
      return globalBin;
    }
  } catch {
    // ignore PATH lookup failures
  }

  return null;
}

function resolveHostWebcmdRoot(startFile = fileURLToPath(import.meta.url)): string {
  let dir = path.dirname(startFile);

  while (true) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkg?.name === '@agentrhq/webcmd') {
          return dir;
        }
      } catch {
        // Keep walking; a malformed package.json should not hide an ancestor package root.
      }
    }

    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return path.resolve(path.dirname(startFile), '..');
}

/**
 * Transpile TS plugin files to JS so they work in production mode.
 * Uses esbuild from the host webcmd's node_modules for fast single-file transpilation.
 */
function transpilePluginTs(pluginDir: string): void {
  try {
    const esbuildBin = resolveEsbuildBin();

    if (!esbuildBin) {
      log.warn(
        'esbuild not found. TS plugin files will not be transpiled and may fail to load. ' +
        'Install esbuild (`npm i -g esbuild`) or ensure it is available in the webcmd host node_modules.'
      );
      return;
    }

    const files = fs.readdirSync(pluginDir);
    const tsFiles = files.filter(f =>
      f.endsWith('.ts') && !f.endsWith('.d.ts') && !f.endsWith('.test.ts')
    );

    for (const tsFile of tsFiles) {
      const jsFile = tsFile.replace(/\.ts$/, '.js');
      const jsPath = path.join(pluginDir, jsFile);

      // Skip if .js already exists (plugin may ship pre-compiled)
      if (fs.existsSync(jsPath)) continue;

      try {
        execFileSync(esbuildBin, [tsFile, `--outfile=${jsFile}`, '--format=esm', '--platform=node'], {
          cwd: pluginDir,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
          ...(isWindows && { shell: true }),
        });
        log.debug(`Transpiled plugin file: ${tsFile} → ${jsFile}`);
      } catch (err) {
        log.warn(`Failed to transpile ${tsFile}: ${getErrorMessage(err)}`);
      }
    }
  } catch (err) {
    log.warn(`TS transpilation setup failed: ${getErrorMessage(err)}`);
  }
}

export {
  ensureHostWebcmdPackageLink as _ensureHostWebcmdPackageLink,
  resolveHostWebcmdRoot as _resolveHostWebcmdRoot,
  resolveEsbuildBin as _resolveEsbuildBin,
  getCommitHash as _getCommitHash,
  installDependencies as _installDependencies,
  parseSource as _parseSource,
  postInstallMonorepoLifecycle as _postInstallMonorepoLifecycle,
  readLockFile as _readLockFile,
  readLockFileWithWriter as _readLockFileWithWriter,
  updateAllPlugins as _updateAllPlugins,
  validatePluginStructure as _validatePluginStructure,
  writeLockFile as _writeLockFile,
  writeLockFileWithFs as _writeLockFileWithFs,
  isSymlinkSync as _isSymlinkSync,
  getMonoreposDir as _getMonoreposDir,
  installLocalPlugin as _installLocalPlugin,
  isLocalPluginSource as _isLocalPluginSource,
  moveDir as _moveDir,
  resolvePluginSource as _resolvePluginSource,
  resolveStoredPluginSource as _resolveStoredPluginSource,
  toStoredPluginSource as _toStoredPluginSource,
  toLocalPluginSource as _toLocalPluginSource,
};
