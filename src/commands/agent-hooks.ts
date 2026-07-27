import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { log } from '../logger.js';
import { ArgumentError } from '../errors.js';

function getWebcmdBinaryCommand(): string {
  try {
    const which = execSync('which webcmd', { stdio: 'pipe' }).toString().trim();
    if (which) return 'webcmd';
  } catch {
    // Ignore error
  }
  return path.resolve(process.argv[1] || process.execPath);
}

export async function initHooks(): Promise<void> {
  const binary = getWebcmdBinaryCommand();
  const command = `${binary}`;
  const home = os.homedir();
  let installed = 0;

  // 1. Claude Code
  const claudeSettingsDir = path.join(home, '.claude');
  if (fs.existsSync(claudeSettingsDir)) {
    const settingsPath = path.join(claudeSettingsDir, 'settings.json');
    let settings: any = {};
    if (fs.existsSync(settingsPath)) {
      try {
        settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      } catch {
        settings = {};
      }
    }
    settings.hooks = settings.hooks || {};
    settings.hooks.SessionStart = command;
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    log.success(`Injected SessionStart hook into Claude Code (settings.json)`);
    installed++;
  }

  // 2. Codex
  const codexDir = path.join(home, '.codex');
  if (fs.existsSync(codexDir)) {
    // hooks.json
    const hooksPath = path.join(codexDir, 'hooks.json');
    let hooks: any = {};
    if (fs.existsSync(hooksPath)) {
      try {
        hooks = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
      } catch {
        hooks = {};
      }
    }
    hooks.SessionStart = hooks.SessionStart || [];
    if (typeof hooks.SessionStart === 'string') {
      hooks.SessionStart = [hooks.SessionStart];
    }
    if (!hooks.SessionStart.includes(command)) {
      hooks.SessionStart.push(command);
    }
    fs.writeFileSync(hooksPath, JSON.stringify(hooks, null, 2));
    
    // config.toml features.hooks = true
    const tomlPath = path.join(codexDir, 'config.toml');
    if (fs.existsSync(tomlPath)) {
      let toml = fs.readFileSync(tomlPath, 'utf8');
      if (!toml.includes('hooks = true') && !toml.includes('hooks=true')) {
        if (toml.includes('[features]')) {
          toml = toml.replace('[features]', '[features]\nhooks = true');
        } else {
          toml += '\n[features]\nhooks = true\n';
        }
        fs.writeFileSync(tomlPath, toml);
      }
    }
    log.success(`Injected SessionStart hook into Codex (hooks.json)`);
    installed++;
  }

  // 3. OpenCode (assuming ~/.opencode/plugins or similar, will use ~/.opencode/hooks.json for now)
  const openCodeDir = path.join(home, '.opencode');
  if (fs.existsSync(openCodeDir)) {
    const hooksPath = path.join(openCodeDir, 'hooks.json');
    let hooks: any = {};
    if (fs.existsSync(hooksPath)) {
      try {
        hooks = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
      } catch {
        hooks = {};
      }
    }
    hooks.SessionStart = hooks.SessionStart || [];
    if (typeof hooks.SessionStart === 'string') {
      hooks.SessionStart = [hooks.SessionStart];
    }
    if (!hooks.SessionStart.includes(command)) {
      hooks.SessionStart.push(command);
    }
    fs.writeFileSync(hooksPath, JSON.stringify(hooks, null, 2));
    log.success(`Injected SessionStart hook into OpenCode (hooks.json)`);
    installed++;
  }

  if (installed === 0) {
    log.info(`No compatible agent configurations found (.claude, .codex, .opencode) in ${home}`);
  } else {
    log.success(`Successfully initialized hooks for ${installed} agent(s).`);
  }
}
