import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

let packageName;
let packageRoot;
let packageExports;

export function initialize(data) {
  packageRoot = data.packageRoot;
  const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
  packageName = manifest.name;
  packageExports = manifest.exports;
}

export function resolve(specifier, context, nextResolve) {
  if (specifier === packageName || specifier.startsWith(`${packageName}/`)) {
    const key = specifier === packageName ? '.' : `.${specifier.slice(packageName.length)}`;
    const target = packageExports[key];
    if (typeof target === 'string' && target.startsWith('./')) {
      return { url: pathToFileURL(path.join(packageRoot, target)).href, shortCircuit: true };
    }
    throw new Error(`${packageName} does not export ${key}`);
  }
  return nextResolve(specifier, context);
}
