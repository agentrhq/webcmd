import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { exec } from 'node:child_process';
import { WebsiteCloner } from '../cloner/cloner.js';
import { convertCloneToReact } from '../cloner/react-converter.js';
import { runVisualVerification } from '../cloner/visual-verifier.js';
import { createZipArchive } from '../cloner/zip-bundler.js';
import { extractDesignSystem } from '../cloner/design-system-extractor.js';
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
  designSystem?: boolean;
  ui?: boolean;
  noUi?: boolean;
}

export async function executeCloneCommand(cliUrl: string | undefined, options: CloneCommandOptions) {
  let targetUrl = cliUrl?.trim();
  let toReact = Boolean(options.toReact);
  let verify = Boolean(options.verify);
  let zip = Boolean(options.zip);
  let designSystem = Boolean(options.designSystem);

  // Parse slash commands passed as first argument
  if (targetUrl) {
    if (targetUrl.startsWith('/design')) {
      designSystem = true;
      targetUrl = targetUrl.replace('/design', '').trim();
    } else if (targetUrl.startsWith('/react')) {
      toReact = true;
      targetUrl = targetUrl.replace('/react', '').trim();
    } else if (targetUrl.startsWith('/diff') || targetUrl.startsWith('/verify')) {
      verify = true;
      targetUrl = targetUrl.replace(/\/diff|\/verify/, '').trim();
    } else if (targetUrl.startsWith('/zip')) {
      zip = true;
      targetUrl = targetUrl.replace('/zip', '').trim();
    } else if (targetUrl.startsWith('/clone')) {
      targetUrl = targetUrl.replace('/clone', '').trim();
    }
  }

  const isJson = Boolean(options.json) || options.format === 'json';
  const forceNoUi = Boolean(options.noUi) || isJson;

  // If running interactively or requested UI, launch Ink React Terminal UI
  if (!forceNoUi && (!targetUrl || options.ui || process.stdin.isTTY)) {
    startInkCloner(targetUrl, {
      output: options.output,
      toReact,
      verify,
      zip,
      designSystem,
      serve: options.serve !== false && !options.noServe,
      port: parseInt(options.port || '3000', 10) || 3000,
    });
    return;
  }

  // Headless / Non-TTY / JSON Scripted Mode
  try {
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

    let designRes: any = null;
    if (designSystem) {
      designRes = await extractDesignSystem(outputDir, targetUrl);
    }

    let reactRes: any = null;
    if (toReact) {
      reactRes = await convertCloneToReact(outputDir);
    }

    let diffRes: any = null;
    if (verify) {
      diffRes = await runVisualVerification(targetUrl, result.htmlPath, outputDir);
    }

    let zipPath: string | null = null;
    if (zip) {
      zipPath = await createZipArchive(outputDir, `${outputDir}.zip`);
    }

    if (isJson) {
      console.log(
        JSON.stringify(
          { ...result, designSystem: designRes, react: reactRes, verification: diffRes, zip: zipPath },
          null,
          2
        )
      );
    } else {
      console.log(`[DONE] Cloned to: ${outputDir}`);
      if (designRes) {
        console.log(`[DESIGN SYSTEM] Extracted tokens to: ${designRes.outputDir}`);
        console.log(`[AI SKILL] Registered skill: design-${designRes.siteName.toLowerCase()}`);
      }
      console.log(`[DONE] Total assets: ${result.totalAssets}`);

      if (options.open !== false && !options.noOpen) {
        const port = parseInt(options.port || '3000', 10) || 3000;
        const shouldServe = options.serve !== false && !options.noServe;
        if (shouldServe) {
          startPreviewServer(outputDir, port, (activePort) => {
            const previewUrl = `http://localhost:${activePort}${
              designSystem ? '/design-system/preview.html' : verify ? '/verify.html' : '/index.html'
            }`;
            console.log(`[PREVIEW] Server live at: ${previewUrl}`);
            openInBrowser(previewUrl);
          });
        } else {
          const previewTarget = designSystem
            ? path.join(outputDir, 'design-system', 'preview.html')
            : result.htmlPath;
          openInBrowser(previewTarget);
        }
      }
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

function openInBrowser(target: string) {
  const isWindows = process.platform === 'win32';
  const isMac = process.platform === 'darwin';

  if (isWindows) {
    exec(`start "" "${target}"`, () => {});
  } else if (isMac) {
    exec(`open "${target}"`, () => {});
  } else {
    exec(`xdg-open "${target}"`, () => {});
  }
}

function startPreviewServer(dir: string, initialPort: number, callback: (port: number) => void) {
  const mimeTypes: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.ttf': 'font/ttf',
    '.json': 'application/json; charset=utf-8',
  };

  const server = http.createServer((req, res) => {
    let reqPath = decodeURI(req.url || '/').split('?')[0];
    if (reqPath === '/' || reqPath === '') reqPath = '/index.html';

    const filePath = path.join(dir, reqPath);
    if (!filePath.startsWith(path.resolve(dir))) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('File Not Found');
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = mimeTypes[ext] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      });
      fs.createReadStream(filePath).pipe(res);
    });
  });

  server.listen(initialPort, () => {
    callback(initialPort);
  });

  server.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      const nextPort = initialPort + 1;
      server.listen(nextPort, () => {
        callback(nextPort);
      });
    }
  });
}

