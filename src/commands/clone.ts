import path from 'node:path';
import { WebsiteCloner } from '../cloner/cloner.js';
import { convertCloneToReact } from '../cloner/react-converter.js';
import { runVisualVerification } from '../cloner/visual-verifier.js';
import { createZipArchive } from '../cloner/zip-bundler.js';
import { startInkCloner } from '../cloner/ui/index.js';

export interface CloneCommandOptions {
  output?: string;
  timeout?: string;
  scroll?: boolean;
  scripts?: boolean;
  serve?: boolean;
  noServe?: boolean;
  open?: boolean;
  noOpen?: boolean;
  port?: string;
  format?: string;
  json?: boolean;
  toReact?: boolean;
  verify?: boolean;
  zip?: boolean;
  ui?: boolean;
  noUi?: boolean;
}

export async function executeCloneCommand(cliUrl: string | undefined, options: CloneCommandOptions) {
  const isJson = Boolean(options.json) || options.format === 'json';
  const forceNoUi = Boolean(options.noUi) || isJson;

  // If running interactively or requested UI, launch Ink React Terminal UI
  if (!forceNoUi && (!cliUrl || options.ui || process.stdin.isTTY)) {
    startInkCloner(cliUrl, {
      output: options.output,
      toReact: options.toReact,
      verify: options.verify,
      zip: options.zip,
      serve: options.serve !== false && !options.noServe,
      port: parseInt(options.port || '3000', 10) || 3000,
    });
    return;
  }

  // Headless / Non-TTY / JSON Scripted Mode
  try {
    let targetUrl = cliUrl?.trim();
    if (!targetUrl) {
      console.error('[ERROR] Target URL is required.');
      process.exitCode = 1;
      return;
    }

    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      targetUrl = `https://${targetUrl}`;
    }

    const parsed = new URL(targetUrl);
    const defaultDirName = `${parsed.hostname.replace(/[^a-zA-Z0-9.-]/g, '_')}_${Date.now()}`;
    const outputDir = options.output
      ? path.resolve(options.output)
      : path.resolve(process.cwd(), 'clones', defaultDirName);

    const cloner = new WebsiteCloner({
      url: targetUrl,
      outputDir,
      timeout: parseInt(options.timeout || '45000', 10),
      autoScroll: options.scroll !== false,
      includeScripts: options.scripts !== false,
      formatHtml: true,
    });

    const result = await cloner.clone();

    let reactRes: any = null;
    if (options.toReact) {
      reactRes = await convertCloneToReact(outputDir);
    }

    let diffRes: any = null;
    if (options.verify) {
      diffRes = await runVisualVerification(targetUrl, result.htmlPath, outputDir);
    }

    let zipPath: string | null = null;
    if (options.zip) {
      zipPath = await createZipArchive(outputDir, `${outputDir}.zip`);
    }

    if (isJson) {
      console.log(JSON.stringify({ ...result, react: reactRes, verification: diffRes, zip: zipPath }, null, 2));
    } else {
      console.log(`[DONE] Cloned to: ${outputDir}`);
      console.log(`[DONE] Total assets: ${result.totalAssets}`);
    }
  } catch (err: any) {
    if (isJson) {
      console.error(JSON.stringify({ error: err.message }, null, 2));
    } else {
      console.error(`[ERROR] ${err.message}`);
    }
    process.exitCode = 1;
  }
}
