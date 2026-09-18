#!/usr/bin/env node

/**
 * postinstall script — install shell completion files and print setup instructions.
 *
 * Detects the user's default shell and writes the completion script to the
 * standard completion directory.  For zsh and bash, the script prints manual
 * instructions instead of modifying rc files (~/.zshrc, ~/.bashrc) — this
 * avoids breaking multi-line shell commands and other fragile rc structures.
 * Fish completions work automatically without rc changes.
 *
 * Supported shells: bash, zsh, fish.
 *
 * This script is intentionally plain Node.js (no TypeScript, no imports from
 * the main source tree) so that it can run without a build step.
 */

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';

// ── Weaver, the webcmd mascot ──────────────────────────────────────────────
//
// Deliberately duplicated from src/mascot.ts: this script must run with no
// build step and no imports from the source tree, so it cannot reuse the
// module. src/mascot.test.ts asserts the two copies stay identical.

const MASCOT_FRAME_HEIGHT = 9;
const BLANK = ' '.repeat(18);
const THREAD = '        ││        ';
const LEGS_TOP = ['    ▓▓      ▓▓    ', '   ▓▓        ▓▓   '];
const LEGS_BOTTOM = [' ▓▓  ▓▓    ▓▓  ▓▓ ', '  ▓▓ ▓▓    ▓▓ ▓▓  '];
const HEAD = '    ██████████    ';
const EYES_OPEN = '  ▓▓██ ●  ● ██▓▓  ';
const EYES_SHUT = '  ▓▓██ ─  ─ ██▓▓  ';
const MOUTH = '  ▓▓██  ▾   ██▓▓  ';
const BELLY = '    ██████████    ';

function weaverSprite(blink, stance) {
  return [LEGS_TOP[stance], HEAD, blink ? EYES_SHUT : EYES_OPEN, MOUTH, BELLY, LEGS_BOTTOM[stance]];
}

function frame(sprite, dropped) {
  const rows = [...Array.from({ length: dropped }, () => THREAD), ...sprite];
  while (rows.length < MASCOT_FRAME_HEIGHT) rows.push(BLANK);
  return rows;
}

export const WEAVER_FRAMES = [
  frame(weaverSprite(false, 1), 1),
  frame(weaverSprite(false, 1), 2),
  frame(weaverSprite(false, 0), 3),
  frame(weaverSprite(false, 1), 3),
  frame(weaverSprite(false, 0), 3),
  frame(weaverSprite(true, 0), 3),
  frame(weaverSprite(false, 0), 3),
];

const ACCENT = '\u001b[38;2;86;197;255m';
const SHADE = '\u001b[38;2;0;107;154m';
const WHITE = '\u001b[97m';
const RESET = '\u001b[0m';
const GLYPH_COLOR = { '█': ACCENT, '│': ACCENT, '▓': SHADE, '▾': ACCENT, '●': WHITE, '─': WHITE };

function paintRow(row) {
  let out = '';
  let run = '';
  let runColor;
  const flush = () => {
    if (run === '') return;
    out += runColor === undefined ? run : `${runColor}${run}${RESET}`;
    run = '';
  };
  for (const glyph of row) {
    const color = GLYPH_COLOR[glyph];
    if (color !== runColor) {
      flush();
      runColor = color;
    }
    run += glyph;
  }
  flush();
  return out;
}

/** Accent text, unless the user asked for no color. */
function accent(text) {
  return process.env.NO_COLOR ? text : `${ACCENT}${text}${RESET}`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Greet the install with Weaver.
 *
 * Animates only on an interactive terminal — npm sometimes pipes lifecycle
 * script output, and in-place redraw needs a real cursor. Everywhere else the
 * final frame is printed once, so the mascot still shows up without leaving
 * escape sequences in a log. CI is already excluded by the caller.
 */
async function playWeaver() {
  if (process.env.WEBCMD_NO_MASCOT) return;

  const color = !process.env.NO_COLOR;
  const paint = (rows) => rows.map(color ? paintRow : (row) => row).join('\n');

  if (!process.stdout.isTTY) {
    process.stdout.write(`${paint(WEAVER_FRAMES[WEAVER_FRAMES.length - 1])}\n`);
    return;
  }

  process.stdout.write('\u001b[?25l'); // Hide cursor
  try {
    for (let i = 0; i < WEAVER_FRAMES.length; i++) {
      if (i > 0) process.stdout.write(`\u001b[${MASCOT_FRAME_HEIGHT}A\u001b[J`);
      process.stdout.write(`${paint(WEAVER_FRAMES[i])}\n`);
      if (i < WEAVER_FRAMES.length - 1) await sleep(90);
    }
  } finally {
    process.stdout.write('\u001b[?25h'); // Show cursor
  }
}

import { join } from 'node:path';
import { homedir } from 'node:os';


// ── Completion script content ──────────────────────────────────────────────

const BASH_COMPLETION = `# Bash completion for webcmd (auto-installed)
_webcmd_completions() {
  local cur words cword
  _get_comp_words_by_ref -n : cur words cword

  local completions
  completions=$(webcmd --get-completions --cursor "$cword" "\${words[@]:1}" 2>/dev/null)

  COMPREPLY=( $(compgen -W "$completions" -- "$cur") )
  __ltrim_colon_completions "$cur"
}
complete -F _webcmd_completions webcmd
`;

const ZSH_COMPLETION = `#compdef webcmd
# Zsh completion for webcmd (auto-installed)
_webcmd() {
  local -a completions
  local cword=$((CURRENT - 1))
  completions=(\${(f)"$(webcmd --get-completions --cursor "$cword" "\${words[@]:1}" 2>/dev/null)"})
  compadd -a completions
}
_webcmd
`;

const FISH_COMPLETION = `# Fish completion for webcmd (auto-installed)
complete -c webcmd -f -a '(
  set -l tokens (commandline -cop)
  set -l cursor (count (commandline -cop))
  webcmd --get-completions --cursor $cursor $tokens[2..] 2>/dev/null
)'
`;

// ── Helpers ────────────────────────────────────────────────────────────────

function detectShell() {
  const shell = process.env.SHELL || '';
  if (shell.includes('zsh')) return 'zsh';
  if (shell.includes('bash')) return 'bash';
  if (shell.includes('fish')) return 'fish';
  return null;
}

function ensureDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  // Skip in CI environments
  if (process.env.CI || process.env.CONTINUOUS_INTEGRATION) {
    return;
  }

  // Only install completion for global installs and npm link
  const isGlobal = process.env.npm_config_global === 'true';
  if (!isGlobal) {
    return;
  }

  await playWeaver();
  console.log(`  ${accent('Webcmd installed.')} Weaver crawls a site once so your agents never have to rediscover it.`);
  console.log('');

  const shell = detectShell();
  if (!shell) {
    // Cannot determine shell; silently skip
    return;
  }

  const home = homedir();

  try {
    switch (shell) {
      case 'zsh': {
        const completionsDir = join(home, '.zsh', 'completions');
        const completionFile = join(completionsDir, '_webcmd');
        ensureDir(completionsDir);
        writeFileSync(completionFile, ZSH_COMPLETION, 'utf8');

        console.log(`✓ Zsh completion installed to ${completionFile}`);
        console.log('');
        console.log('  \x1b[1mTo enable, add these lines to your ~/.zshrc:\x1b[0m');
        console.log(`    fpath=(${completionsDir} $fpath)`);
        console.log('    autoload -Uz compinit && compinit');
        console.log('');
        console.log('  If you already have compinit (oh-my-zsh, zinit, etc.), just add the fpath line \x1b[1mbefore\x1b[0m it.');
        console.log('  Then restart your shell or run: \x1b[36mexec zsh\x1b[0m');
        break;
      }
      case 'bash': {
        const userCompDir = join(home, '.bash_completion.d');
        const completionFile = join(userCompDir, 'webcmd');
        ensureDir(userCompDir);
        writeFileSync(completionFile, BASH_COMPLETION, 'utf8');

        console.log(`✓ Bash completion installed to ${completionFile}`);
        console.log('');
        console.log('  \x1b[1mTo enable, add this line to your ~/.bashrc:\x1b[0m');
        console.log(`    [ -f "${completionFile}" ] && source "${completionFile}"`);
        console.log('');
        console.log('  Then restart your shell or run: \x1b[36msource ~/.bashrc\x1b[0m');
        break;
      }
      case 'fish': {
        const completionsDir = join(home, '.config', 'fish', 'completions');
        const completionFile = join(completionsDir, 'webcmd.fish');
        ensureDir(completionsDir);
        writeFileSync(completionFile, FISH_COMPLETION, 'utf8');

        console.log(`✓ Fish completion installed to ${completionFile}`);
        console.log(`  Restart your shell to activate.`);
        break;
      }
    }
  } catch (err) {
    // Completion install is best-effort; never fail the package install
    if (process.env.WEBCMD_VERBOSE) {
      console.error(`Warning: Could not install shell completion: ${err.message}`);
    }
  }

  // ── Plugin discovery hint ───────────────────────────────────────────
  console.log('');
  console.log('  \x1b[1mNext step — install a site plugin\x1b[0m');
  console.log('  Search:  \x1b[36mwebcmd plugin search <site> -f json\x1b[0m');
  console.log('  Install: \x1b[36mwebcmd plugin install <installSource-from-search>\x1b[0m');
  console.log('');
  console.log('  Then run \x1b[36mwebcmd doctor\x1b[0m to verify.');
  console.log('');

}

main().catch(() => {});
