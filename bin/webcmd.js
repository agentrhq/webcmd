#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distMain = path.resolve(__dirname, '../dist/src/main.js');

if (fs.existsSync(distMain)) {
  await import(pathToFileURL(distMain).href);
} else {
  const { spawn } = await import('node:child_process');
  const isWin = process.platform === 'win32';
  const tsxBin = path.resolve(__dirname, '../node_modules/.bin', isWin ? 'tsx.cmd' : 'tsx');
  const srcMain = path.resolve(__dirname, '../src/main.ts');
  const child = spawn(tsxBin, [srcMain, ...process.argv.slice(2)], {
    stdio: 'inherit',
    shell: isWin
  });
  child.on('exit', (code) => process.exit(code ?? 0));
}
