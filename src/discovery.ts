/**
 * CLI discovery: finds JS CLI definitions and registers them.
 *
 * Supports two modes:
 * 1. FAST PATH (manifest): If a pre-compiled cli-manifest.json exists,
 *    registers commands instantly. JS modules are loaded lazily only
 *    when their command is executed.
 * 2. FALLBACK (filesystem scan): Traditional runtime discovery for development.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { type InternalCliCommand, Strategy, registerCommand, runWithDiscoverySource } from './registry.js';
import { getErrorMessage } from './errors.js';
import { log } from './logger.js';
import type { ManifestEntry } from './manifest-types.js';
import { findPackageRoot, getCliManifestPath } from './package-paths.js';
import { CLI_COMMAND, CONFIG_DIR_NAME, PACKAGE_NAME, PRODUCT_NAME } from './brand.js';

/** User runtime directory: ~/.webcmd */
export function getUserWebcmdDir(homeDir: string = os.homedir()): string {
  return path.join(homeDir, CONFIG_DIR_NAME);
}

export function getUserClisDir(homeDir: string = os.homedir()): string {
  return path.join(getUserWebcmdDir(homeDir), 'clis');
}

export function getPluginsDir(homeDir: string = os.homedir()): string {
  return path.join(getUserWebcmdDir(homeDir), 'plugins');
}

/** User runtime directory: ~/.webcmd */
export const USER_WEBCMD_DIR = getUserWebcmdDir();
/** User CLIs directory: ~/.webcmd/clis */
export const USER_CLIS_DIR = getUserClisDir();
/** Plugins directory: ~/.webcmd/plugins/ */
export const PLUGINS_DIR = getPluginsDir();
/**
 * Adapter files that failed to import, so run-time errors can name the real
 * cause instead of claiming the site is not installed.
 */
const loadFailures: Array<{ site: string; file: string; error: string }> = [];

export function getAdapterLoadFailures(): ReadonlyArray<{ site: string; file: string; error: string }> {
  return loadFailures;
}

/**
 * Gate discovery on the runtime IMPORT, not on call syntax.
 *
 * A file can only register anything by importing the runtime, so this catches
 * every authoring style — cli(), registerSiteAuthCommands(), hooks — instead of
 * the old `\bcli\s*\(` source regex, which missed real calls it didn't enumerate
 * and matched comments and strings that were not calls at all. Helper modules
 * that never import the runtime are still skipped, so their side effects do not
 * run at startup.
 */
const RUNTIME_IMPORT_PATTERN = new RegExp(
  `${PACKAGE_NAME}/(?:registry|plugin-runtime|hooks)|/(?:registry|registry-api|plugin-runtime|hooks)\\.[jt]s['"\`]`,
);

async function importsRuntime(filePath: string): Promise<boolean> {
  try {
    return RUNTIME_IMPORT_PATTERN.test(await fs.promises.readFile(filePath, 'utf-8'));
  } catch (err) {
    log.warn(`Failed to inspect module ${filePath}: ${getErrorMessage(err)}`);
    return false;
  }
}

/** Import an adapter file, recording (and warning about) any load failure. */
async function loadAdapterModule(site: string, filePath: string): Promise<void> {
  if (!(await importsRuntime(filePath))) return;
  try {
    await runWithDiscoverySource(filePath, () => import(pathToFileURL(filePath).href));
  } catch (err) {
    const error = getErrorMessage(err);
    loadFailures.push({ site, file: filePath, error });
    log.warn(`Failed to load adapter ${filePath}: ${error}`);
  }
}

function parseStrategy(rawStrategy: string | undefined, fallback: Strategy = Strategy.COOKIE): Strategy {
  if (!rawStrategy) return fallback;
  const key = rawStrategy.toUpperCase() as keyof typeof Strategy;
  return Strategy[key] ?? fallback;
}

const PACKAGE_ROOT = findPackageRoot(fileURLToPath(import.meta.url));

function getSourcePackageExports(): Record<string, string> {
  const pkgPath = path.join(PACKAGE_ROOT, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as {
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

async function pathIsSymlink(targetPath: string): Promise<boolean> {
  try {
    return (await fs.promises.lstat(targetPath)).isSymbolicLink();
  } catch {
    return false;
  }
}

async function ensureSourcePackageShim(packageDir: string): Promise<void> {
  const srcLink = path.join(packageDir, 'src');
  const srcTarget = path.join(PACKAGE_ROOT, 'src');
  const pkgJsonPath = path.join(packageDir, 'package.json');
  const pkgJsonContent = `${JSON.stringify({
    name: PACKAGE_NAME,
    private: true,
    type: 'module',
    exports: getSourcePackageExports(),
  }, null, 2)}\n`;

  await fs.promises.mkdir(packageDir, { recursive: true });

  try {
    const existing = await fs.promises.readFile(pkgJsonPath, 'utf-8');
    if (existing !== pkgJsonContent) await fs.promises.writeFile(pkgJsonPath, pkgJsonContent, 'utf-8');
  } catch {
    await fs.promises.writeFile(pkgJsonPath, pkgJsonContent, 'utf-8');
  }

  let needsSrcLink = true;
  try {
    const existing = await fs.promises.readlink(srcLink);
    if (existing === srcTarget) needsSrcLink = false;
  } catch { /* doesn't exist */ }
  if (needsSrcLink) {
    try { await fs.promises.rm(srcLink, { recursive: true, force: true }); } catch { /* doesn't exist */ }
    const symlinkType = process.platform === 'win32' ? 'junction' : 'dir';
    await fs.promises.symlink(srcTarget, srcLink, symlinkType);
  }
}

/**
 * Ensure ~/.webcmd/node_modules/<package> symlink exists so user CLIs can
 * import runtime exports from the installed package.
 *
 * This is the sole resolution mechanism — adapters use package exports and
 * Node.js resolves them through this symlink.
 */
export async function ensureUserCliCompatShims(baseDir: string = USER_WEBCMD_DIR): Promise<void> {
  await fs.promises.mkdir(baseDir, { recursive: true });

  // package.json for ESM resolution in ~/.webcmd/
  const pkgJsonPath = path.join(baseDir, 'package.json');
  const pkgJsonContent = `${JSON.stringify({ name: `${PRODUCT_NAME}-user-runtime`, private: true, type: 'module' }, null, 2)}\n`;
  try {
    const existing = await fs.promises.readFile(pkgJsonPath, 'utf-8');
    if (existing !== pkgJsonContent) await fs.promises.writeFile(pkgJsonPath, pkgJsonContent, 'utf-8');
  } catch {
    await fs.promises.writeFile(pkgJsonPath, pkgJsonContent, 'utf-8');
  }

  // Create node_modules/<package> resolution pointing to the installed package root.
  // Source checkouts do not have dist/, so they need a tiny package shim whose
  // exports target src/ files instead.
  const packageRoot = PACKAGE_ROOT;
  const [scope, name] = PACKAGE_NAME.split('/');
  const symlinkDir = path.join(baseDir, 'node_modules', scope);
  const symlinkPath = path.join(symlinkDir, name);
  const hasBuiltExports = fs.existsSync(path.join(packageRoot, 'dist', 'src', 'registry-api.js'));
  try {
    if (!hasBuiltExports) {
      if (await pathIsSymlink(symlinkPath)) {
        await fs.promises.rm(symlinkPath, { recursive: true, force: true });
      }
      await ensureSourcePackageShim(symlinkPath);
      return;
    }

    let needsUpdate = true;
    try {
      const existing = await fs.promises.readlink(symlinkPath);
      if (existing === packageRoot) needsUpdate = false;
    } catch { /* doesn't exist */ }
    if (needsUpdate) {
      await fs.promises.mkdir(symlinkDir, { recursive: true });
      try { await fs.promises.rm(symlinkPath, { recursive: true, force: true }); } catch { /* doesn't exist */ }
      const symlinkType = process.platform === 'win32' ? 'junction' : 'dir';
      await fs.promises.symlink(packageRoot, symlinkPath, symlinkType);
    }
  } catch (err) {
    log.warn(`Could not create symlink at ${symlinkPath}: ${getErrorMessage(err)}`);
  }
}

/**
 * Ensure the user adapters directory exists.
 *
 * This legacy directory remains available for private adapters and autofix
 * output. Official adapters are installed as plugins instead.
 */
export async function ensureUserAdapters(): Promise<void> {
  await fs.promises.mkdir(USER_CLIS_DIR, { recursive: true });
}

/**
 * Discover and register CLI commands.
 * Uses pre-compiled manifest when available for instant startup.
 */
export async function discoverClis(...dirs: string[]): Promise<void> {
  // Fast path: try manifest first (production / post-build)
  for (const dir of dirs) {
    const manifestPath = getCliManifestPath(dir);
    try {
      await fs.promises.access(manifestPath);
      const loaded = await loadFromManifest(manifestPath, dir);
      if (loaded) continue; // Skip filesystem scan only when manifest is usable
    } catch {
      // Fall through to filesystem scan
    }
    await discoverClisFromFs(dir);
  }
}

/**
 * Fast-path: register commands from pre-compiled manifest.
 * TS modules are deferred — loaded lazily on first execution.
 */
async function loadFromManifest(manifestPath: string, clisDir: string): Promise<boolean> {
  try {
    const raw = await fs.promises.readFile(manifestPath, 'utf-8');
    const manifest = JSON.parse(raw) as ManifestEntry[];
    for (const entry of manifest) {
      if (!entry.modulePath) continue;
      if ([entry.modulePath, entry.sourceFile].some(candidate => candidate && isUnderBaseDir(clisDir, candidate))) continue;
      const modulePath = path.resolve(clisDir, entry.modulePath);
      const cmd: InternalCliCommand = {
        site: entry.site,
        name: entry.name,
        aliases: entry.aliases,
        description: entry.description ?? '',
        access: entry.access,
        example: entry.example,
        domain: entry.domain,
        strategy: parseStrategy(entry.strategy),
        browser: entry.browser,
        args: entry.args ?? [],
        columns: entry.columns,
        ...(entry.tags?.length ? { tags: [...entry.tags] } : {}),
        ...(entry.keywords?.length ? { keywords: [...entry.keywords] } : {}),
        defaultFormat: entry.defaultFormat,
        pipeline: entry.pipeline,
        source: entry.sourceFile ? path.resolve(clisDir, entry.sourceFile) : modulePath,
        navigateBefore: entry.navigateBefore,
        siteSession: entry.siteSession,
        freshPage: entry.freshPage,
        _lazy: true,
        _modulePath: modulePath,
      };
      // normalizeCommand inside registerCommand handles strategy → browser/navigateBefore
      registerCommand(cmd);
    }
    return true;
  } catch (err) {
    log.warn(`Failed to load manifest ${manifestPath}: ${getErrorMessage(err)}`);
    return false;
  }
}

function isUnderBaseDir(clisDir: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(clisDir, '.base'), path.resolve(clisDir, candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * Fallback: traditional filesystem scan (used during development with tsx).
 */
async function discoverClisFromFs(dir: string): Promise<void> {
  try { await fs.promises.access(dir); } catch { return; }
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  
  const sitePromises = entries
    .filter(entry => entry.isDirectory() && entry.name !== '.base')
    .map(async (entry) => {
      const site = entry.name;
      const siteDir = path.join(dir, site);
      const files = await fs.promises.readdir(siteDir);
      await Promise.all(files.map(async (file) => {
        const filePath = path.join(siteDir, file);
        if (file.endsWith('.yaml') || file.endsWith('.yml')) {
          return;
        }
        if (file.endsWith('.ts') && !file.endsWith('.d.ts') && !file.endsWith('.test.ts')) {
          log.warn(`Ignoring TypeScript adapter ${filePath} — .ts adapters are no longer loaded. Rename to .js or convert to JavaScript.`);
          return;
        }
        if (file.endsWith('.js') && !file.endsWith('.d.js') && !file.endsWith('.test.js')) {
          await loadAdapterModule(site, filePath);
        }
      }));
    });
  await Promise.all(sitePromises);
}

/**
 * Discover and register plugins from ~/.webcmd/plugins/.
 * Each subdirectory is treated as a plugin (site = directory name).
 * Files inside are scanned flat (no nested site subdirs).
 */
export async function discoverPlugins(pluginsDir: string = PLUGINS_DIR): Promise<void> {
  try { await fs.promises.access(pluginsDir); } catch { return; }
  const entries = await fs.promises.readdir(pluginsDir, { withFileTypes: true });
  await Promise.all(entries.map(async (entry) => {
    const pluginDir = path.join(pluginsDir, entry.name);
    if (!(await isDiscoverablePluginDir(entry, pluginDir))) return;
    await discoverPluginDir(pluginDir, entry.name);
  }));
}

export function missingPluginGuidance(site: string): string {
  const failures = loadFailures.filter(failure => failure.site === site);
  if (failures.length > 0) {
    return [
      `Site "${site}" has adapter files that failed to load:`,
      ...failures.map(failure => `  ${failure.file}\n    ${failure.error}`),
      `Fix the file, then re-run. Adapters call cli({ ... }) from '${PACKAGE_NAME}/registry'`,
      `and must declare access: 'read' | 'write' and func.`,
    ].join('\n');
  }
  return [
    `Site "${site}" is not installed.`,
    `Search: ${CLI_COMMAND} plugin search ${site}`,
    'Install using the installSource returned by search.',
  ].join('\n');
}

/**
 * Flat scan: read ts/js files directly in a plugin directory.
 * Unlike discoverClisFromFs, this does NOT expect nested site subdirectories.
 */
async function discoverPluginDir(dir: string, site: string): Promise<void> {
  const files = await fs.promises.readdir(dir);
  const fileSet = new Set(files);
  await Promise.all(files.map(async (file) => {
    const filePath = path.join(dir, file);
    if (file.endsWith('.yaml') || file.endsWith('.yml')) {
      return;
    }
    if (file.endsWith('.js') && !file.endsWith('.d.js')) {
      await loadAdapterModule(site, filePath);
    } else if (
      file.endsWith('.ts') && !file.endsWith('.d.ts') && !file.endsWith('.test.ts')
    ) {
      const jsFile = file.replace(/\.ts$/, '.js');
      // Prefer compiled .js — skip the .ts source file
      if (fileSet.has(jsFile)) return;
      // No compiled .js found — cannot import raw .ts in production Node.js.
      // This typically means esbuild transpilation failed during plugin install.
      log.warn(
        `Plugin ${site}/${file}: no compiled .js found. ` +
        `Run "webcmd plugin update ${site}" to re-transpile, or install esbuild.`
      );
    }
  }));
}

async function isDiscoverablePluginDir(entry: fs.Dirent, pluginDir: string): Promise<boolean> {
  if (entry.isDirectory()) return true;
  if (!entry.isSymbolicLink()) return false;

  try {
    return (await fs.promises.stat(pluginDir)).isDirectory();
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT' && code !== 'ENOTDIR') {
      log.warn(`Failed to inspect plugin link ${pluginDir}: ${getErrorMessage(err)}`);
    }
    return false;
  }
}
