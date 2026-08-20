import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));

function sourceOf(file: string): string {
  return readFileSync(path.join(here, file), 'utf8');
}

function assertNoDirectFilesystemAccess(file: 'runner.ts' | 'files.ts', text: string): void {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const filesystemImports: ts.Node[] = [];
  const readFileSyncReferences: ts.Identifier[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && isFilesystemModule(node.moduleSpecifier.text)) {
      filesystemImports.push(node);
    }
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)
      && node.moduleReference.expression && ts.isStringLiteral(node.moduleReference.expression)
      && isFilesystemModule(node.moduleReference.expression.text)) {
      filesystemImports.push(node);
    }
    if (ts.isCallExpression(node) && isFilesystemModuleLoad(node)) filesystemImports.push(node);
    if (ts.isIdentifier(node) && node.text === 'readFileSync' && !isReadFileSyncImportBinding(node)) {
      readFileSyncReferences.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  if (file === 'files.ts') {
    if (filesystemImports.length > 0 || readFileSyncReferences.length > 0) {
      throw new Error('files.ts must route filesystem access through HostedFileIo');
    }
    return;
  }

  if (filesystemImports.length !== 1 || !isAllowedRunnerFilesystemImport(filesystemImports[0]!)) {
    throw new Error('runner.ts may import only readFileSync from node:fs for the committed hosted contract');
  }
  if (readFileSyncReferences.length !== 1 || !isHostedContractReadReference(readFileSyncReferences[0]!)) {
    throw new Error('runner.ts may read only the committed hosted-contract.json package data directly');
  }
}

function isFilesystemModule(value: string): boolean {
  return value === 'node:fs' || value === 'node:fs/promises' || value === 'fs' || value === 'fs/promises';
}

function isFilesystemModuleLoad(node: ts.CallExpression): boolean {
  const [module] = node.arguments;
  return module !== undefined
    && ts.isStringLiteral(module)
    && isFilesystemModule(module.text)
    && ((ts.isIdentifier(node.expression) && node.expression.text === 'require') || node.expression.kind === ts.SyntaxKind.ImportKeyword);
}

function isAllowedRunnerFilesystemImport(node: ts.Node): boolean {
  if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier) || node.moduleSpecifier.text !== 'node:fs') return false;
  const elements = node.importClause?.namedBindings;
  return !!elements
    && ts.isNamedImports(elements)
    && elements.elements.length === 1
    && elements.elements[0]!.name.text === 'readFileSync'
    && elements.elements[0]!.propertyName === undefined;
}

function isReadFileSyncImportBinding(node: ts.Identifier): boolean {
  return ts.isImportSpecifier(node.parent) && node.parent.name === node;
}

function isHostedContractReadReference(node: ts.Identifier): boolean {
  return ts.isCallExpression(node.parent)
    && node.parent.expression === node
    && isHostedContractRead(node.parent);
}

function isHostedContractRead(node: ts.CallExpression): boolean {
  const [input] = node.arguments;
  return input !== undefined
    && ts.isCallExpression(input)
    && ts.isPropertyAccessExpression(input.expression)
    && ts.isIdentifier(input.expression.expression)
    && input.expression.expression.text === 'path'
    && input.expression.name.text === 'join'
    && input.arguments.some(argument => ts.isIdentifier(argument) && argument.text === 'packageRoot')
    && input.arguments.some(argument => ts.isStringLiteral(argument) && argument.text === 'hosted-contract.json');
}

describe('hosted dispatch filesystem coverage', () => {
  it('runner.ts performs no direct user-file reads or writes', () => {
    expect(() => assertNoDirectFilesystemAccess('runner.ts', sourceOf('runner.ts'))).not.toThrow();
  });

  it('files.ts imports no filesystem module directly', () => {
    expect(() => assertNoDirectFilesystemAccess('files.ts', sourceOf('files.ts'))).not.toThrow();
  });

  it('rejects aliased, namespace, and CommonJS filesystem bypasses', () => {
    expect(() => assertNoDirectFilesystemAccess('files.ts', "import { readFile as read } from 'node:fs/promises';\nvoid read('input.txt');")).toThrow(/HostedFileIo/);
    expect(() => assertNoDirectFilesystemAccess('runner.ts', "import * as fs from 'node:fs';\nfs.writeFileSync('output.txt', 'body');")).toThrow(/readFileSync/);
    expect(() => assertNoDirectFilesystemAccess('runner.ts', "const fs = require('node:fs');\nfs.writeFileSync('output.txt', 'body');")).toThrow(/readFileSync/);
    expect(() => assertNoDirectFilesystemAccess('files.ts', "void import('node:fs/promises');")).toThrow(/HostedFileIo/);
  });

  it('rejects aliases of the otherwise allowed hosted-contract reader', () => {
    const source = [
      "import { readFileSync } from 'node:fs';",
      'const leak = readFileSync;',
      "leak('/secret');",
      "const contract = readFileSync(path.join(packageRoot, 'hosted-contract.json'), 'utf8');",
    ].join('\n');
    expect(() => assertNoDirectFilesystemAccess('runner.ts', source)).toThrow(/hosted-contract.json/);
  });
});
