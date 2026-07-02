/**
 * Shared constants and shell script generators for tab-completion.
 *
 * This module MUST remain lightweight (no registry, no discovery imports).
 * Both completion.ts (full path) and completion-fast.ts (manifest path) import from here.
 */

import { CLI_COMMAND } from './brand.js';

/**
 * Built-in (non-dynamic) top-level commands.
 */
export const BUILTIN_COMMANDS = [
  'list',
  'validate',
  'verify',
  'auth',
  'browser',
  'tab',
  'doctor',
  'plugin',
  'external',
  'completion',
];

// ── Shell script generators ────────────────────────────────────────────────

export function bashCompletionScript(): string {
  return `# Bash completion for ${CLI_COMMAND}
# Add to ~/.bashrc:  eval "$(${CLI_COMMAND} completion bash)"
_${CLI_COMMAND}_completions() {
  local cur words cword
  _get_comp_words_by_ref -n : cur words cword

  local completions
  completions=$(${CLI_COMMAND} --get-completions --cursor "$cword" "\${words[@]:1}" 2>/dev/null)

  COMPREPLY=( $(compgen -W "$completions" -- "$cur") )
  __ltrim_colon_completions "$cur"
}
complete -F _${CLI_COMMAND}_completions ${CLI_COMMAND}
`;
}

export function zshCompletionScript(): string {
  return `# Zsh completion for ${CLI_COMMAND}
# Add to ~/.zshrc:  eval "$(${CLI_COMMAND} completion zsh)"
_${CLI_COMMAND}() {
  local -a completions
  local cword=$((CURRENT - 1))
  completions=(\${(f)"$(${CLI_COMMAND} --get-completions --cursor "$cword" "\${words[@]:1}" 2>/dev/null)"})
  compadd -a completions
}
compdef _${CLI_COMMAND} ${CLI_COMMAND}
`;
}

export function fishCompletionScript(): string {
  return `# Fish completion for ${CLI_COMMAND}
# Add to ~/.config/fish/config.fish:  ${CLI_COMMAND} completion fish | source
complete -c ${CLI_COMMAND} -f -a '(
  set -l tokens (commandline -cop)
  set -l cursor (count (commandline -cop))
  ${CLI_COMMAND} --get-completions --cursor $cursor $tokens[2..] 2>/dev/null
)'
`;
}
