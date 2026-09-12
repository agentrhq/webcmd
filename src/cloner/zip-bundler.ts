import fs from 'node:fs/promises';
import path from 'node:path';
import { exec } from 'node:child_process';

export async function createZipArchive(sourceDir: string, zipPath: string): Promise<string> {
  const isWindows = process.platform === 'win32';
  
  if (isWindows) {
    // Use PowerShell Compress-Archive on Windows
    await new Promise<void>((resolve, reject) => {
      const cmd = `powershell -Command "Compress-Archive -Path '${sourceDir}\\*' -DestinationPath '${zipPath}' -Force"`;
      exec(cmd, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  } else {
    // Use standard zip command on Unix/macOS
    await new Promise<void>((resolve, reject) => {
      const parentDir = path.dirname(sourceDir);
      const baseName = path.basename(sourceDir);
      const cmd = `cd "${parentDir}" && zip -r "${zipPath}" "${baseName}"`;
      exec(cmd, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  return zipPath;
}
