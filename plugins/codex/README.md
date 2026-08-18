# webcmd-plugin-codex

Webcmd commands for codex.

## Install

```bash
webcmd plugin install github:agentrhq/webcmd/codex
```

## Commands

| Command | Description |
| --- | --- |
| `webcmd codex archive` | Archive (Codex's term for delete) the selected conversation via the Chat actions header menu. No confirmation in UI — pass --yes to actually archive. |
| `webcmd codex ask` | Send a prompt to the current or selected Codex conversation and wait for the AI response |
| `webcmd codex dump` | Dump the DOM and Accessibility tree of codex for reverse-engineering |
| `webcmd codex export` | Export the current Codex conversation to a Markdown file |
| `webcmd codex extract-diff` | Extract visual code review diff patches from Codex |
| `webcmd codex history` | List visible Codex conversation threads grouped by project |
| `webcmd codex model` | Read, list, or switch the active model / reasoning level in Codex Desktop. The composer toolbar button toggles a menu that mixes model variants (GPT-5.5, Speed) with reasoning levels (Low/Medium/High/Extra High). |
| `webcmd codex new` | Start a new Codex conversation session |
| `webcmd codex pin` | Pin the selected Codex conversation via the Chat actions header menu. |
| `webcmd codex projects` | List Codex projects and visible conversations from the sidebar |
| `webcmd codex read` | Read the contents of the current or selected Codex conversation thread |
| `webcmd codex rename` | Rename the selected Codex conversation. Opens the Chat actions menu → "Rename chat", then types the new title. |
| `webcmd codex screenshot` | Capture a snapshot of the current Codex window (DOM + Accessibility tree) |
| `webcmd codex send` | Send text/commands to the current or selected Codex AI composer |
| `webcmd codex status` | Check active CDP connection to OpenAI Codex App |
| `webcmd codex unpin` | Unpin the selected Codex conversation via the Chat actions header menu. |
