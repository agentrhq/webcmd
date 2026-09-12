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

      res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache' });
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

export const ClonerApp: React.FC<ClonerAppProps> = ({ initialUrl, initialOptions }) => {
  const { exit } = useApp();

  const [stage, setStage] = useState<WizardStage>(initialUrl ? 'CONFIRM' : 'URL_INPUT');
  const [url, setUrl] = useState<string>(initialUrl || '');
  const [outputDir, setOutputDir] = useState<string>(initialOptions?.output || '');
  const [mode, setMode] = useState<'standard' | 'react' | 'verify' | 'design' | 'zip' | 'all'>('standard');
  const [serve] = useState<boolean>(initialOptions?.serve !== false);
  const [port] = useState<number>(initialOptions?.port || 3000);
  const [serverActivePort, setServerActivePort] = useState<number | null>(null);

  // Progress states
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(1);
  const [totalSteps, setTotalSteps] = useState<number>(4);
  const [stepMessage, setStepMessage] = useState<string>('Initializing cloner engine...');
  const [completedSteps, setCompletedSteps] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [resultData, setResultData] = useState<any>(null);

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

    const stepsCount = 4 + (toReact ? 1 : 0) + (verify ? 1 : 0) + (design ? 1 : 0) + (zip ? 1 : 0);
    setTotalSteps(stepsCount);
    setCurrentStepIndex(1);

    try {
      const cloner = new WebsiteCloner({
        url,
        outputDir,
        autoScroll: true,
        formatHtml: true,
        onStep: (step, total, message, status) => {
          if (status === 'START') {
            setStepMessage(message);
          } else if (status === 'DONE') {
            setCompletedSteps((prev: string[]) => [...prev, message]);
            setCurrentStepIndex((prev: number) => prev + 1);
          }
        },
      });

      const cloneRes = await cloner.clone();

      let designRes: any = null;
      if (design) {
        setStepMessage('Extracting Design Tokens, Color Palette, Typography & AI Skill...');
        designRes = await extractDesignSystem(outputDir, url);
        setCompletedSteps((prev: string[]) => [
          ...prev,
          `Extracted ${designRes.colors.length} color tokens & generated AI design skill (design-${designRes.siteName.toLowerCase()})`,
        ]);
        setCurrentStepIndex((prev: number) => prev + 1);
      }

      let reactRes: any = null;
      if (toReact) {
        setStepMessage('Decomposing DOM to modular React (TSX) & Tailwind components...');
        reactRes = await convertCloneToReact(outputDir);
        setCompletedSteps((prev: string[]) => [...prev, `Generated ${reactRes.components.length} React components`]);
        setCurrentStepIndex((prev: number) => prev + 1);
      }

      let diffRes: any = null;
      if (verify) {
        setStepMessage('Capturing screenshots & generating visual diff slider...');
        diffRes = await runVisualVerification(url, cloneRes.htmlPath, outputDir);
        setCompletedSteps((prev: string[]) => [...prev, `Visual fidelity score: ${diffRes.fidelityScore}%`]);
        setCurrentStepIndex((prev: number) => prev + 1);
      }

      let zipPath: string | null = null;
      if (zip) {
        setStepMessage('Packaging clone into portable ZIP archive...');
        zipPath = await createZipArchive(outputDir, `${outputDir}.zip`);
        if (zipPath) {
          setCompletedSteps((prev: string[]) => [...prev, `Created ${path.basename(zipPath!)}`]);
        }
        setCurrentStepIndex((prev: number) => prev + 1);
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

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      {/* Header Banner */}
      <Box borderStyle="round" borderColor="cyan" paddingX={2} paddingY={0} flexDirection="column">
        <Text bold color="cyanBright">
          WEBCMD UNIVERSAL SITE CLONER & REVERSE-ENGINEERING STUDIO
        </Text>
        <Text dimColor color="gray">
          Stealth Engine: Active  |  Design System Extractor  |  React & Tailwind Synthesizer
        </Text>
      </Box>

      {/* Stage: URL Input */}
      {stage === 'URL_INPUT' && (
        <Box flexDirection="column" marginTop={1} borderStyle="single" borderColor="blue" padding={1}>
          <Text bold color="yellowBright">
            Enter Target Website URL:
          </Text>
          <Box marginTop={1}>
            <Text color="cyan">➜  </Text>
            <TextInput
              value={url}
              onChange={setUrl}
              onSubmit={handleUrlSubmit}
              placeholder="https://example.com or news.ycombinator.com"
            />
          </Box>
          <Box marginTop={1}>
            <Text dimColor color="gray">
              (Press Enter to confirm, Ctrl+C to exit)
            </Text>
          </Box>
        </Box>
      )}

      {/* Stage: Mode Selector */}
      {stage === 'MODE_SELECT' && (
        <Box flexDirection="column" marginTop={1} borderStyle="single" borderColor="magenta" padding={1}>
          <Text bold color="magentaBright">
            Select Cloning & Analysis Mode for {url}:
          </Text>
          <Box marginTop={1} flexDirection="column">
            <SelectInput items={modeItems} onSelect={handleModeSelect} />
          </Box>
        </Box>
      )}

      {/* Stage: Confirm Configuration */}
      {stage === 'CONFIRM' && (
        <Box flexDirection="column" marginTop={1} borderStyle="single" borderColor="green" padding={1}>
          <Text bold color="greenBright">
            Ready to Clone:
          </Text>
          <Box flexDirection="column" marginTop={1}>
            <Text>  <Text bold color="white">Target URL    :</Text> <Text color="cyan">{url}</Text></Text>
            <Text>  <Text bold color="white">Destination   :</Text> <Text color="gray">{outputDir}</Text></Text>
            <Text>  <Text bold color="white">Mode          :</Text> <Text color="yellow">{mode.toUpperCase()}</Text></Text>
            <Text>  <Text bold color="white">Local Preview :</Text> <Text color="green">{serve ? `Enabled (Port ${port})` : 'Disabled'}</Text></Text>
          </Box>
          <Box marginTop={1}>
            <SelectInput
              items={[
                { label: '🚀 Start Cloning & Analysis', value: 'start' },
                { label: '❌ Cancel & Exit', value: 'cancel' },
              ]}
              onSelect={(item) => {
                if (item.value === 'start') startCloningWorkflow();
                else exit();
              }}
            />
          </Box>
        </Box>
      )}

      {/* Stage: Cloning Progress */}
      {stage === 'CLONING' && (
        <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="yellow" padding={1}>
          <Box>
            <Text color="yellow">
              <Spinner type="dots" />
            </Text>
            <Text bold color="yellowBright">
              {' '}Step [{currentStepIndex}/{totalSteps}]: {stepMessage}
            </Text>
          </Box>

          <Box flexDirection="column" marginTop={1}>
            {completedSteps.map((msg: string, i: number) => (
              <Box key={i}>
                <Text color="greenBright"> ✔ {msg}</Text>
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {/* Stage: Complete Success Summary */}
      {stage === 'DONE' && resultData && (
        <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="green" padding={1}>
          <Text bold color="greenBright">
            🎉 CLONE & DESIGN EXTRACTION COMPLETED!
          </Text>
          <Box flexDirection="column" marginTop={1}>
            <Text>  <Text bold color="white">Source URL    :</Text> <Text color="cyan">{resultData.sourceUrl}</Text></Text>
            <Text>  <Text bold color="white">Output Folder :</Text> <Text color="gray">{resultData.outputDir}</Text></Text>
            <Text>  <Text bold color="white">Entrypoint    :</Text> <Text color="yellow">{resultData.htmlPath}</Text></Text>
            <Text>  <Text bold color="white">Duration      :</Text> <Text color="green">{(resultData.durationMs / 1000).toFixed(2)}s</Text></Text>
            <Text>  <Text bold color="white">Total Assets  :</Text> <Text color="cyan">{resultData.totalAssets} files</Text></Text>

            {resultData.designSystem && (
              <Box flexDirection="column" marginTop={1} borderStyle="single" borderColor="magenta" paddingX={1}>
                <Text bold color="magentaBright">🎨 Extracted Design System & AI Skill:</Text>
                <Text>  • <Text bold color="white">Tokens JSON     :</Text> <Text color="gray">./design-system/tokens.json</Text></Text>
                <Text>  • <Text bold color="white">Tailwind Theme  :</Text> <Text color="gray">./design-system/tailwind.theme.js</Text></Text>
                <Text>  • <Text bold color="white">Style Guide     :</Text> <Text color="gray">./design-system/DesignSystem.md</Text></Text>
                <Text>  • <Text bold color="white">Showcase Story  :</Text> <Text color="cyan">./design-system/preview.html</Text></Text>
                <Text>  • <Text bold color="white">Agent Skill     :</Text> <Text color="yellow">.agents/skills/design-{resultData.designSystem.siteName.toLowerCase()}/SKILL.md</Text></Text>
              </Box>
            )}

            {resultData.react && (
              <Text>  <Text bold color="white">React (TSX)   :</Text> <Text color="magenta">{resultData.react.outputDir} ({resultData.react.components.length} components)</Text></Text>
            )}
            {resultData.verification && (
              <Text>  <Text bold color="white">Visual Diff   :</Text> <Text color="blueBright">verify.html (Fidelity: {resultData.verification.fidelityScore}%)</Text></Text>
            )}
            {resultData.zip && (
              <Text>  <Text bold color="white">ZIP Bundle    :</Text> <Text color="yellow">{path.basename(resultData.zip)}</Text></Text>
            )}
          </Box>

          {serverActivePort && (
            <Box marginTop={1} borderStyle="single" borderColor="cyan" paddingX={1}>
              <Text color="cyanBright" bold>
                🌐 Interactive Preview Server: http://localhost:{serverActivePort}
              </Text>
            </Box>
          )}

          <Box marginTop={1}>
            <Text dimColor color="gray">
              Showcase opened automatically in your default browser. Press Ctrl+C to exit.
            </Text>
          </Box>
        </Box>
      )}

      {/* Stage: Error */}
      {stage === 'ERROR' && (
        <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="red" padding={1}>
          <Text bold color="redBright">
            ❌ CLONING ENCOUNTERED AN ERROR:
          </Text>
          <Box marginTop={1}>
            <Text color="red">
              {errorMessage}
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor color="gray">
              Press Ctrl+C to return to terminal.
            </Text>
          </Box>
        </Box>
      )}
    </Box>
  );
};
