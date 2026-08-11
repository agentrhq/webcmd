import * as fs from 'node:fs';
import * as path from 'node:path';

export interface PackageJsonLike {
  bin?: string | Record<string, string>;
  main?: string;
}

export function findPackageRoot(startFile: string, fileExists: (candidate: string) => boolean = fs.existsSync): string {
  let dir = path.dirname(startFile);

  while (true) {
    if (fileExists(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(`Could not find package.json above ${startFile}`);
    }
    dir = parent;
  }
}

export function getBuiltEntryCandidates(
  packageRoot: string,
  readFile: (filePath: string) => string = (filePath) => fs.readFileSync(filePath, 'utf-8'),
): string[] {
  const candidates: string[] = [];
  try {
    const pkg = JSON.parse(readFile(path.join(packageRoot, 'package.json'))) as PackageJsonLike;

    if (typeof pkg.bin === 'string') {
      candidates.push(path.join(packageRoot, pkg.bin));
    } else if (pkg.bin && typeof pkg.bin === 'object' && typeof pkg.bin.webcmd === 'string') {
      candidates.push(path.join(packageRoot, pkg.bin.webcmd));
    }

    if (typeof pkg.main === 'string') {
      candidates.push(path.join(packageRoot, pkg.main));
    }
  } catch {
    // Fall through to compatibility candidates below.
  }

  // Compatibility fallback for partially-built trees or older layouts.
  candidates.push(
    path.join(packageRoot, 'dist', 'src', 'main.js'),
    path.join(packageRoot, 'dist', 'main.js'),
  );

  return [...new Set(candidates)];
}

/**
 * Directory holding the builtin adapter modules, given the running entry file.
 *
 * In a repo checkout that is `clis/` at the package root. The published package
 * cannot ship adapter source at the root, so the build stages a copy next to the
 * compiled output and this resolves to `dist/src/clis/` there. Shared so the
 * packaging check can load manifest modules through the same resolution the CLI
 * uses at execution time, rather than a copy of it that can drift.
 */
export function resolveBuiltinClisDir(entryFile: string, fileExists: (candidate: string) => boolean = fs.existsSync): string {
  const repoClis = path.join(findPackageRoot(entryFile, fileExists), 'clis');
  return fileExists(repoClis) ? repoClis : path.join(path.dirname(entryFile), 'clis');
}

export function getCliManifestPath(clisDir: string): string {
  return path.resolve(clisDir, '..', 'cli-manifest.json');
}
