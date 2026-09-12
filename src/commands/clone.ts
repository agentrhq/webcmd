import path from 'node:path';
import http from 'node:http';
import fs from 'node:fs';
import { exec } from 'node:child_process';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { WebsiteCloner } from '../cloner/cloner.js';

export interface CloneCommandOptions {
  output?: string;
  timeout?: string;
  scroll?: boolean;
  scripts?: boolean;
  serve?: boolean;
  open?: boolean;
  noOpen?: boolean;
  port?: string;
  format?: string;
  json?: boolean;
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

function startLocalServer(dir: string, initialPort: number, autoOpen: boolean) {
  const mimeTypes: Record<string, string> = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.ttf': 'font/ttf',
    '.json': 'application/json',
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
        'Cache-Control': 'no-cache',
      });
      fs.createReadStream(filePath).pipe(res);
    });
  });

  let currentPort = initialPort;
  server.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      currentPort++;
      if (currentPort < initialPort + 25) {
        server.listen(currentPort);
      } else {
        console.error(`[ERROR] Unable to bind preview server on ports ${initialPort}-${currentPort}`);
      }
    }
  });

  server.listen(currentPort, () => {
    const serverUrl = `http://localhost:${currentPort}`;
    console.log(`\n  ┌──────────────────────────────────────────────────────────────┐`);
    console.log(`  │  PREVIEW SERVER READY: ${serverUrl.padEnd(38)}│`);
    console.log(`  │  Press Ctrl+C to stop the server                             │`);
    console.log(`  └──────────────────────────────────────────────────────────────┘\n`);

    if (autoOpen) {
      openInBrowser(serverUrl);
    }
  });
}

async function promptInteractive(): Promise<{
  url: string;
  outputDir: string;
  autoScroll: boolean;
  serve: boolean;
  autoOpen: boolean;
  port: number;
}> {
  const rl = readline.createInterface({ input, output });

  console.log(`\n  ┌──────────────────────────────────────────────────────────────┐`);
  console.log(`  │               WEBCMD UNIVERSAL WEBSITE CLONER                │`);
  console.log(`  │  Full dynamic DOM hydration, asset resolution & formatting   │`);
  console.log(`  └──────────────────────────────────────────────────────────────┘\n`);

  try {
    let url = '';
    while (!url) {
      const answer = await rl.question('  Target website URL : ');
      url = answer.trim();
      if (!url) {
        console.log('  [ERROR] URL cannot be empty. Please enter a valid URL.');
      }
    }

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `https://${url}`;
    }

    let defaultDirName = 'site_clone';
    try {
      const parsed = new URL(url);
      defaultDirName = `${parsed.hostname.replace(/[^a-zA-Z0-9.-]/g, '_')}_${Date.now()}`;
    } catch {
      // fallback
    }

    const defaultOutput = path.resolve(process.cwd(), 'clones', defaultDirName);
    const outAnswer = await rl.question(`  Output folder [${defaultDirName}] : `);
    const outputDir = outAnswer.trim() ? path.resolve(outAnswer.trim()) : defaultOutput;

    const scrollAnswer = await rl.question('  Auto-scroll for lazy components? (Y/n) : ');
    const autoScroll = scrollAnswer.trim().toLowerCase() !== 'n';

    const serveAnswer = await rl.question('  Launch local preview server after cloning? (Y/n) : ');
    const serve = serveAnswer.trim().toLowerCase() !== 'n';

    let port = 3000;
    if (serve) {
      const portAnswer = await rl.question('  Server port [3000] : ');
      port = parseInt(portAnswer.trim(), 10) || 3000;
    }

    const autoOpen = true;

    console.log(`\n  ┌──────────────────────────────────────────────────────────────┐`);
    console.log(`  │  CONFIGURATION                                               │`);
    console.log(`  ├──────────────────────────────────────────────────────────────┤`);
    console.log(`  │  Target URL   : ${url.substring(0, 44).padEnd(45)}│`);
    console.log(`  │  Destination  : ${path.basename(outputDir).substring(0, 44).padEnd(45)}│`);
    console.log(`  │  Auto-Scroll  : ${(autoScroll ? 'Enabled' : 'Disabled').padEnd(45)}│`);
    console.log(`  │  Preview      : ${(serve ? `Enabled (Port ${port})` : 'Disabled').padEnd(45)}│`);
    console.log(`  └──────────────────────────────────────────────────────────────┘\n`);

    return { url, outputDir, autoScroll, serve, autoOpen, port };
  } finally {
    rl.close();
  }
}

export async function executeCloneCommand(cliUrl: string | undefined, options: CloneCommandOptions) {
  try {
    let targetUrl = cliUrl?.trim();
    let outputDir = options.output ? path.resolve(options.output) : '';
    let autoScroll = options.scroll !== false;
    let serve = options.serve !== undefined ? Boolean(options.serve) : true;
    let autoOpen = options.noOpen !== true;
    let port = parseInt(options.port || '3000', 10) || 3000;

    const isJson = Boolean(options.json) || options.format === 'json';

    if (!targetUrl && !isJson) {
      const interactive = await promptInteractive();
      targetUrl = interactive.url;
      outputDir = interactive.outputDir;
      autoScroll = interactive.autoScroll;
      serve = interactive.serve;
      autoOpen = interactive.autoOpen;
      port = interactive.port;
    }

    if (!targetUrl) {
      console.error('  [ERROR] Target URL is required.');
      process.exitCode = 1;
      return;
    }

    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      targetUrl = `https://${targetUrl}`;
    }

    if (!outputDir) {
      const parsed = new URL(targetUrl);
      const defaultDirName = `${parsed.hostname.replace(/[^a-zA-Z0-9.-]/g, '_')}_${Date.now()}`;
      outputDir = path.resolve(process.cwd(), 'clones', defaultDirName);
    }

    if (!isJson) {
      console.log(`  [1/4] Connecting & Rendering DOM ........................`);
    }

    const cloner = new WebsiteCloner({
      url: targetUrl,
      outputDir,
      timeout: parseInt(options.timeout || '45000', 10),
      autoScroll,
      includeScripts: options.scripts !== false,
      formatHtml: true,
      onStep: (step, total, message, status) => {
        if (!isJson) {
          if (status === 'START') {
            const stepNum = `[${step}/${total}]`;
            const dots = '.'.repeat(Math.max(2, 54 - message.length - stepNum.length));
            process.stdout.write(`  ${stepNum} ${message} ${dots} `);
          } else if (status === 'DONE') {
            console.log(`[OK]`);
          } else if (status === 'FAIL') {
            console.log(`[FAILED]`);
          }
        }
      },
    });

    const result = await cloner.clone();

    if (isJson) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    // Print Clean Summary Box
    console.log(`\n  ┌──────────────────────────────────────────────────────────────┐`);
    console.log(`  │                       CLONE SUMMARY                          │`);
    console.log(`  ├──────────────────────────────────────────────────────────────┤`);
    console.log(`  │  Source URL   : ${result.sourceUrl.substring(0, 44).padEnd(45)}│`);
    console.log(`  │  Output Path  : ${result.outputDir.substring(0, 44).padEnd(45)}│`);
    console.log(`  │  Entry File   : index.html (Prettified & Formatted)          │`);
    console.log(`  │  Assets Total : ${String(result.totalAssets).padEnd(45)}│`);
    if (result.assetsByCategory.css) {
      console.log(`  │    • CSS Stylesheets : ${String(result.assetsByCategory.css).padEnd(38)}│`);
    }
    if (result.assetsByCategory.js) {
      console.log(`  │    • JS Scripts      : ${String(result.assetsByCategory.js).padEnd(38)}│`);
    }
    if (result.assetsByCategory.images) {
      console.log(`  │    • Images & SVGs   : ${String(result.assetsByCategory.images).padEnd(38)}│`);
    }
    if (result.assetsByCategory.fonts) {
      console.log(`  │    • Web Fonts       : ${String(result.assetsByCategory.fonts).padEnd(38)}│`);
    }
    console.log(`  │  Duration     : ${((result.durationMs / 1000).toFixed(2) + 's').padEnd(45)}│`);
    console.log(`  └──────────────────────────────────────────────────────────────┘\n`);

    if (serve) {
      startLocalServer(outputDir, port, autoOpen);
    } else if (autoOpen) {
      console.log(`  Opening cloned index.html in your default browser...`);
      openInBrowser(result.htmlPath);
    }
  } catch (err: any) {
    if (options.json || options.format === 'json') {
      console.error(JSON.stringify({ error: err.message }, null, 2));
    } else {
      console.error(`\n  [ERROR] ${err.message}\n`);
    }
    process.exitCode = 1;
  }
}
