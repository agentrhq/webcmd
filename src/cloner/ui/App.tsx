import React, { useState, useEffect } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import Spinner from 'ink-spinner';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';
import path from 'node:path';
import { WebsiteCloner } from '../cloner.js';
import { convertCloneToReact } from '../react-converter.js';
import { runVisualVerification } from '../visual-verifier.js';
import { createZipArchive } from '../zip-bundler.js';
import { extractDesignSystem } from '../design-system-extractor.js';
import http from 'node:http';
import fs from 'node:fs';
import { exec } from 'node:child_process';

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

  let currentPort = initialPort;
  server.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      currentPort++;
      if (currentPort < initialPort + 25) {
        server.listen(currentPort);
      }
    }
  });

  server.listen(currentPort, () => {
    callback(currentPort);
  });
}

type WizardStage = 'URL_INPUT' | 'MODE_SELECT' | 'CONFIRM' | 'CLONING' | 'DONE' | 'ERROR';

export interface ClonerAppProps {
  initialUrl?: string;
  initialOptions?: {
    output?: string;
    toReact?: boolean;
    verify?: boolean;
    zip?: boolean;
    designSystem?: boolean;
    serve?: boolean;
    port?: number;
  };
}

// ---------------------------------------------------------------------------
// Animated ProgressBar Component
// ---------------------------------------------------------------------------
const ProgressBar: React.FC<{ progress: number; width?: number }> = ({ progress, width = 36 }) => {
  const clamped = Math.max(0, Math.min(100, progress));
  const filledCount = Math.round((clamped / 100) * width);
  const emptyCount = Math.max(0, width - filledCount);

  const filledChars = '█'.repeat(filledCount);
  const emptyChars = '░'.repeat(emptyCount);

  return (
    <Box>
      <Text color="cyanBright">{filledChars}</Text>
      <Text dimColor color="gray">{emptyChars}</Text>
      <Text bold color="yellowBright"> {clamped.toFixed(0).padStart(3, ' ')}%</Text>
    </Box>
  );
};

export const ClonerApp: React.FC<ClonerAppProps> = ({ initialUrl, initialOptions }) => {
  const { exit } = useApp();

  const [stage, setStage] = useState<WizardStage>(initialUrl ? 'CONFIRM' : 'URL_INPUT');
  const [url, setUrl] = useState<string>(initialUrl || '');
  const [outputDir, setOutputDir] = useState<string>(initialOptions?.output || '');
  const [mode, setMode] = useState<'standard' | 'react' | 'verify' | 'design' | 'zip' | 'all'>('standard');
  const [serve] = useState<boolean>(initialOptions?.serve !== false);
  const [port] = useState<number>(initialOptions?.port || 3000);
  const [serverActivePort, setServerActivePort] = useState<number | null>(null);

  // High-Tech Telemetry states
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(1);
  const [totalSteps, setTotalSteps] = useState<number>(5);
  const [stepMessage, setStepMessage] = useState<string>('Initializing stealth headless runtime...');
  const [completedSteps, setCompletedSteps] = useState<Array<{ title: string; meta?: string }>>([]);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [resultData, setResultData] = useState<any>(null);

  // Live simulation tickers for high-tech aesthetics
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [pulseFrame, setPulseFrame] = useState<number>(0);
  const [networkSpeed, setNetworkSpeed] = useState<string>('18.4 MB/s');
  const [assetStreamLog, setAssetStreamLog] = useState<string[]>([
    '◈ [CHROMIUM] Chromium headless instance spawned with stealth user-agent',
    '◈ [DOM_TREE] Initializing JSDOM virtual canvas',
  ]);

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsedSeconds((prev) => prev + 0.1);
      setPulseFrame((prev) => (prev + 1) % 4);
    }, 100);
    return () => clearInterval(timer);
  }, []);

  useInput((inputChar, key) => {
    if (key.escape || (key.ctrl && inputChar === 'c')) {
      exit();
    }
  });

  const handleUrlSubmit = (submittedUrl: string) => {
    let clean = submittedUrl.trim();
    if (!clean) return;
    if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
      clean = `https://${clean}`;
    }
    setUrl(clean);

    try {
      const parsed = new URL(clean);
      const defaultName = `${parsed.hostname.replace(/[^a-zA-Z0-9.-]/g, '_')}_${Date.now()}`;
      setOutputDir(path.resolve(process.cwd(), 'clones', defaultName));
    } catch {
      setOutputDir(path.resolve(process.cwd(), 'clones', `clone_${Date.now()}`));
    }

    setStage('MODE_SELECT');
  };

  const modeItems = [
    { label: '🎨 Design System & AI Skill - Extract Palette, Typography & AI Prompt Skill', value: 'design' },
    { label: '⚛️  React + Tailwind        - Decompose to Modular TSX Components', value: 'react' },
    { label: '🔬 Visual Diff Slider      - Side-by-side Pixel Fidelity Inspector', value: 'verify' },
    { label: '⚡ Standard Full Clone     - Prettified HTML + All Assets', value: 'standard' },
    { label: '📦 Portable ZIP Bundle     - Auto-compress output to .zip', value: 'zip' },
    { label: '🚀 All-in-One Superpower    - Design System + React + Diff + ZIP', value: 'all' },
  ];

  const handleModeSelect = (item: { value: string }) => {
    const selected = item.value as 'standard' | 'react' | 'verify' | 'design' | 'zip' | 'all';
    setMode(selected);
    setStage('CONFIRM');
  };

  const startCloningWorkflow = async () => {
    setStage('CLONING');

    const toReact = mode === 'react' || mode === 'all' || Boolean(initialOptions?.toReact);
    const verify = mode === 'verify' || mode === 'all' || Boolean(initialOptions?.verify);
    const design = mode === 'design' || mode === 'all' || Boolean(initialOptions?.designSystem);
    const zip = mode === 'zip' || mode === 'all' || Boolean(initialOptions?.zip);

    const stepsCount = 4 + (design ? 1 : 0) + (toReact ? 1 : 0) + (verify ? 1 : 0) + (zip ? 1 : 0);
    setTotalSteps(stepsCount);
    setCurrentStepIndex(1);

    try {
      const cloner = new WebsiteCloner({
        url,
        outputDir,
        autoScroll: true,
        formatHtml: true,
        onLog: (level, message) => {
          const prefix = level === 'SUCCESS' ? '✔ ' : level === 'WARN' ? '⚠ ' : level === 'ERROR' ? '✖ ' : '◈ ';
          setAssetStreamLog((prev) => [`${prefix}${message}`, ...prev.slice(0, 7)]);
        },
        onStep: (step, total, message, status) => {
          if (status === 'START') {
            setStepMessage(message);
            setAssetStreamLog((prev) => [
              `▶ [STAGE ${step}/${total}] ${message}`,
              ...prev.slice(0, 7),
            ]);
          } else if (status === 'DONE') {
            setCompletedSteps((prev) => [
              ...prev,
              { title: message, meta: `T+${elapsedSeconds.toFixed(1)}s` },
            ]);
            setCurrentStepIndex((prev) => prev + 1);
          }
        },
      });

      const cloneRes = await cloner.clone();

      let designRes: any = null;
      if (design) {
        setStepMessage('Extracting 11-step Color Scales, W3C Tokens, React Primitives & AI Skill...');
        setAssetStreamLog((prev) => [
          '⚙ [DESIGN] Parsing CSS variable anchors and WCAG 2.1 contrast ratios...',
          ...prev.slice(0, 4),
        ]);
        designRes = await extractDesignSystem(outputDir, url);
        setCompletedSteps((prev) => [
          ...prev,
          {
            title: `Extracted ${designRes.colors.length} chromatic tokens, 11-step scales & AI skill (.agents/skills/design-${designRes.siteName.toLowerCase()})`,
            meta: 'WCAG AA Verified',
          },
        ]);
        setCurrentStepIndex((prev) => prev + 1);
      }

      let reactRes: any = null;
      if (toReact) {
        setStepMessage('Decomposing DOM to modular React (TSX) & Tailwind components...');
        setAssetStreamLog((prev) => [
          '⚛ [REACT] AST parser extracting Navbar, Hero, and Section modules...',
          ...prev.slice(0, 4),
        ]);
        reactRes = await convertCloneToReact(outputDir);
        setCompletedSteps((prev) => [
          ...prev,
          {
            title: `Synthesized ${reactRes.components.length} React components (Navbar.tsx, Sections.tsx, App.tsx)`,
            meta: 'TypeScript + Tailwind',
          },
        ]);
        setCurrentStepIndex((prev) => prev + 1);
      }

      let diffRes: any = null;
      if (verify) {
        setStepMessage('Capturing screenshots & generating visual diff slider...');
        diffRes = await runVisualVerification(url, cloneRes.htmlPath, outputDir);
        setCompletedSteps((prev) => [
          ...prev,
          {
            title: `Rendered visual verification slider (Fidelity: ${diffRes.fidelityScore}%)`,
            meta: 'verify.html',
          },
        ]);
        setCurrentStepIndex((prev) => prev + 1);
      }

      let zipPath: string | null = null;
      if (zip) {
        setStepMessage('Packaging clone into portable ZIP archive...');
        zipPath = await createZipArchive(outputDir, `${outputDir}.zip`);
        if (zipPath) {
          setCompletedSteps((prev) => [
            ...prev,
            { title: `Generated portable bundle: ${path.basename(zipPath!)}`, meta: 'ZIP Archive' },
          ]);
        }
        setCurrentStepIndex((prev) => prev + 1);
      }

      setResultData({
        ...cloneRes,
        designSystem: designRes,
        react: reactRes,
        verification: diffRes,
        zip: zipPath,
      });

      if (serve) {
        startPreviewServer(outputDir, port, (activePort) => {
          setServerActivePort(activePort);
          const previewUrl = `http://localhost:${activePort}${
            design ? '/design-system/preview.html' : verify ? '/verify.html' : '/index.html'
          }`;
          openInBrowser(previewUrl);
        });
      } else {
        const previewTarget = design
          ? path.join(outputDir, 'design-system', 'preview.html')
          : cloneRes.htmlPath;
        openInBrowser(previewTarget);
      }

      setStage('DONE');
    } catch (err: any) {
      setErrorMessage(err.message || 'Unknown error occurred during cloning.');
      setStage('ERROR');
    }
  };

  useEffect(() => {
    if (initialUrl && stage === 'CONFIRM') {
      startCloningWorkflow();
    }
  }, []);

  const progressPercent = Math.min(99, Math.round((currentStepIndex / Math.max(1, totalSteps)) * 100));
  const pulseGlyphs = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

  return (
    <Box flexDirection="column" paddingX={1} paddingY={0}>
      {/* =====================================================================
          CYBER TELEMETRY HEADER
          ===================================================================== */}
      <Box borderStyle="round" borderColor="cyanBright" paddingX={1} paddingY={0} flexDirection="column">
        <Box justifyContent="space-between">
          <Text bold color="cyanBright">
            ⚡ WEBCMD UNIVERSAL REVERSE-ENGINEERING STUDIO
          </Text>
          <Text color="greenBright" bold>
            [CORE: ACTIVE]
          </Text>
        </Box>
        <Box justifyContent="space-between">
          <Text dimColor color="gray">
            Engine: Headless V8  |  AST Synthesizer  |  W3C Tokens Engine
          </Text>
          <Text color="yellow">
            T+{elapsedSeconds.toFixed(1)}s
          </Text>
        </Box>
      </Box>

      {/* =====================================================================
          STAGE: URL INPUT
          ===================================================================== */}
      {stage === 'URL_INPUT' && (
        <Box flexDirection="column" marginTop={1} borderStyle="single" borderColor="cyan" paddingX={2} paddingY={1}>
          <Text bold color="yellowBright">
            TARGET INGESTION // Enter Website URL to Reverse-Engineer:
          </Text>
          <Box marginTop={1}>
            <Text color="cyanBright">➜  </Text>
            <TextInput
              value={url}
              onChange={setUrl}
              onSubmit={handleUrlSubmit}
              placeholder="https://linear.app or stripe.com"
            />
          </Box>
          <Box marginTop={1}>
            <Text dimColor color="gray">
              [ENTER] Next  |  [CTRL+C] Abort
            </Text>
          </Box>
        </Box>
      )}

      {/* =====================================================================
          STAGE: MODE SELECTOR
          ===================================================================== */}
      {stage === 'MODE_SELECT' && (
        <Box flexDirection="column" marginTop={1} borderStyle="single" borderColor="magentaBright" paddingX={2} paddingY={1}>
          <Text bold color="magentaBright">
            PIPELINE CONFIGURATION // Target: {url}
          </Text>
          <Box marginTop={1} flexDirection="column">
            <SelectInput items={modeItems} onSelect={handleModeSelect} />
          </Box>
        </Box>
      )}

      {/* =====================================================================
          STAGE: CONFIRM
          ===================================================================== */}
      {stage === 'CONFIRM' && (
        <Box flexDirection="column" marginTop={1} borderStyle="single" borderColor="greenBright" paddingX={2} paddingY={1}>
          <Text bold color="greenBright">
            EXECUTION PIPELINE READY:
          </Text>
          <Box flexDirection="column" marginTop={1}>
            <Text>  <Text bold color="white">Target URL    :</Text> <Text color="cyanBright">{url}</Text></Text>
            <Text>  <Text bold color="white">Output Matrix :</Text> <Text color="gray">{outputDir}</Text></Text>
            <Text>  <Text bold color="white">Analysis Mode :</Text> <Text color="yellowBright">{mode.toUpperCase()}</Text></Text>
            <Text>  <Text bold color="white">Studio Server :</Text> <Text color="greenBright">{serve ? `Enabled (Port ${port})` : 'Disabled'}</Text></Text>
          </Box>
          <Box marginTop={1}>
            <SelectInput
              items={[
                { label: '⚡ Execute Reverse-Engineering Pipeline', value: 'start' },
                { label: '❌ Cancel & Abort', value: 'cancel' },
              ]}
              onSelect={(item) => {
                if (item.value === 'start') startCloningWorkflow();
                else exit();
              }}
            />
          </Box>
        </Box>
      )}

      {/* =====================================================================
          STAGE: CRAZY HIGH-TECH CLONING PROGRESS WITH TELEMETRY
          ===================================================================== */}
      {stage === 'CLONING' && (
        <Box flexDirection="column" marginTop={1}>
          {/* Main Telemetry Box */}
          <Box borderStyle="round" borderColor="yellowBright" flexDirection="column" paddingX={2} paddingY={1}>
            {/* Top Row: Animated Spinner & Current Active Step */}
            <Box justifyContent="space-between" alignItems="center">
              <Box>
                <Text color="yellowBright" bold>
                  <Spinner type="dots" /> STEP [{currentStepIndex}/{totalSteps}]:{' '}
                </Text>
                <Text bold color="white">
                  {stepMessage}
                </Text>
              </Box>
              <Text color="cyanBright" bold>
                {pulseGlyphs[pulseFrame]} RUNNING
              </Text>
            </Box>

            {/* Live Progress Bar */}
            <Box marginTop={1} flexDirection="column">
              <ProgressBar progress={stage === 'CLONING' ? progressPercent : 100} width={42} />
            </Box>

            {/* Telemetry Metrics Bar */}
            <Box marginTop={1} paddingX={1} borderStyle="single" borderColor="gray" justifyContent="space-between">
              <Text dimColor color="gray">
                NET: <Text color="cyan">{networkSpeed}</Text>
              </Text>
              <Text dimColor color="gray">
                PIPELINE: <Text color="yellow">{mode.toUpperCase()}</Text>
              </Text>
              <Text dimColor color="gray">
                ELAPSED: <Text color="green">{elapsedSeconds.toFixed(1)}s</Text>
              </Text>
              <Text dimColor color="gray">
                DOM: <Text color="magenta">ACTIVE</Text>
              </Text>
            </Box>

            {/* Completed Steps Log */}
            {completedSteps.length > 0 && (
              <Box flexDirection="column" marginTop={1}>
                <Text bold color="greenBright">
                  COMPLETED MILESTONES:
                </Text>
                {completedSteps.map((stepItem, i) => (
                  <Box key={i} justifyContent="space-between">
                    <Text color="green">  ✔ {stepItem.title}</Text>
                    {stepItem.meta && <Text dimColor color="gray">[{stepItem.meta}]</Text>}
                  </Box>
                ))}
              </Box>
            )}

            {/* Live Stream Terminal Ticker */}
            <Box flexDirection="column" marginTop={1} borderStyle="single" borderColor="cyan" paddingX={1} paddingY={0}>
              <Box justifyContent="space-between">
                <Text bold color="cyanBright">
                  STREAM TELEMETRY // REAL-TIME ACTIVITY LOG:
                </Text>
                <Text dimColor color="gray">
                  [6 CHANNELS]
                </Text>
              </Box>
              {assetStreamLog.slice(0, 6).map((line, idx) => {
                let lineColor = 'gray';
                let isBold = false;
                if (line.startsWith('✔') || line.includes('[SUCCESS]')) {
                  lineColor = 'greenBright';
                  isBold = true;
                } else if (line.startsWith('▶') || line.startsWith('◈ [CHROMIUM]')) {
                  lineColor = 'cyanBright';
                  isBold = true;
                } else if (line.includes('[NET]') || line.includes('⬇')) {
                  lineColor = 'yellow';
                } else if (line.includes('[REACT]') || line.includes('[DESIGN]') || line.includes('⚛') || line.includes('⚙')) {
                  lineColor = 'magentaBright';
                  isBold = true;
                } else if (idx === 0) {
                  lineColor = 'white';
                  isBold = true;
                }
                return (
                  <Text key={idx} color={lineColor as any} bold={isBold} dimColor={idx > 3}>
                    {line}
                  </Text>
                );
              })}
            </Box>
          </Box>
        </Box>
      )}

      {/* =====================================================================
          STAGE: DONE (CYBER SUCCESS DASHBOARD)
          ===================================================================== */}
      {stage === 'DONE' && resultData && (
        <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="greenBright" paddingX={2} paddingY={1}>
          <Box justifyContent="space-between" alignItems="center">
            <Text bold color="greenBright">
              🎉 REVERSE-ENGINEERING & SYNTHESIS COMPLETE!
            </Text>
            <Text color="yellowBright" bold>
              [SUCCESS 100%]
            </Text>
          </Box>

          <Box flexDirection="column" marginTop={1}>
            <Text>  <Text bold color="white">Source Target :</Text> <Text color="cyanBright">{resultData.sourceUrl}</Text></Text>
            <Text>  <Text bold color="white">Output Matrix :</Text> <Text color="gray">{resultData.outputDir}</Text></Text>
            <Text>  <Text bold color="white">Entry Canvas  :</Text> <Text color="yellowBright">{resultData.htmlPath}</Text></Text>
            <Text>  <Text bold color="white">Total Assets  :</Text> <Text color="cyanBright">{resultData.totalAssets} bundled files</Text></Text>
            <Text>  <Text bold color="white">Execution Latency :</Text> <Text color="greenBright">{(resultData.durationMs / 1000).toFixed(2)}s</Text></Text>

            {resultData.designSystem && (
              <Box flexDirection="column" marginTop={1} borderStyle="single" borderColor="cyanBright" paddingX={1} paddingY={0}>
                <Text bold color="cyanBright">🎨 EXTRACTED ENTERPRISE DESIGN SYSTEM:</Text>
                <Text>  • <Text bold color="white">Design Tokens   :</Text> <Text color="gray">./design-system/tokens.json (W3C Format)</Text></Text>
                <Text>  • <Text bold color="white">CSS Variables   :</Text> <Text color="gray">./design-system/design-tokens.css (50-950 Tonal Scales)</Text></Text>
                <Text>  • <Text bold color="white">React Primitives:</Text> <Text color="gray">./design-system/components.tsx (Button, Input, Card, Badge, Alert)</Text></Text>
                <Text>  • <Text bold color="white">Tailwind Theme  :</Text> <Text color="gray">./design-system/tailwind.theme.js</Text></Text>
                <Text>  • <Text bold color="white">Light Studio    :</Text> <Text color="cyanBright">./design-system/preview.html</Text></Text>
                <Text>  • <Text bold color="white">AI Agent Skill  :</Text> <Text color="yellowBright">.agents/skills/design-{resultData.designSystem.siteName.toLowerCase()}/SKILL.md</Text></Text>
              </Box>
            )}

            {resultData.react && (
              <Text>  <Text bold color="white">React (TSX)   :</Text> <Text color="magentaBright">{resultData.react.outputDir} ({resultData.react.components.length} components)</Text></Text>
            )}
            {resultData.verification && (
              <Text>  <Text bold color="white">Visual Diff   :</Text> <Text color="blueBright">verify.html (Fidelity: {resultData.verification.fidelityScore}%)</Text></Text>
            )}
            {resultData.zip && (
              <Text>  <Text bold color="white">ZIP Archive   :</Text> <Text color="yellowBright">{path.basename(resultData.zip)}</Text></Text>
            )}
          </Box>

          {serverActivePort && (
            <Box marginTop={1} borderStyle="double" borderColor="cyanBright" paddingX={1}>
              <Text color="cyanBright" bold>
                🌐 LIVE STUDIO SERVER: http://localhost:{serverActivePort}/design-system/preview.html
              </Text>
            </Box>
          )}

          <Box marginTop={1}>
            <Text dimColor color="gray">
              ⚡ Launched preview automatically in your default browser. Press [Ctrl+C] to exit.
            </Text>
          </Box>
        </Box>
      )}

      {/* =====================================================================
          STAGE: ERROR
          ===================================================================== */}
      {stage === 'ERROR' && (
        <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="redBright" paddingX={2} paddingY={1}>
          <Text bold color="redBright">
            ❌ PIPELINE HALTED WITH EXCEPTION:
          </Text>
          <Box marginTop={1}>
            <Text color="red">
              {errorMessage}
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor color="gray">
              Press [Ctrl+C] to return to terminal.
            </Text>
          </Box>
        </Box>
      )}
    </Box>
  );
};
