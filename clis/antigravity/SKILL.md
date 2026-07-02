---
description: How to automate Antigravity using Webcmd
---

# Antigravity Automation Skill

This skill allows AI agents to control the [Antigravity](https://github.com/chengazhen/Antigravity) desktop app (and any Electron app with CDP enabled) programmatically via Webcmd.

## Requirements
webcmd automatically detects, launches (with `--remote-debugging-port=9234`), and connects to Antigravity.
If Antigravity is already running without CDP, webcmd will prompt to restart it.

If the endpoint exposes multiple inspectable targets, set:
\`\`\`bash
export WEBCMD_CDP_TARGET="antigravity"
\`\`\`

## High-Level Capabilities
1. **Send Messages (`webcmd antigravity send <message>`)**: Type and send a message directly into the chat UI.
2. **Read History (`webcmd antigravity read`)**: Scrape the raw chat transcript from the main UI container.
3. **Extract Code (`webcmd antigravity extract-code`)**: Automatically isolate and extract source code text blocks from the AI's recent answers.
4. **Switch Models (`webcmd antigravity model <name>`)**: Instantly toggle the active LLM (e.g., \`gemini\`, \`claude\`).
5. **Clear Context (`webcmd antigravity new`)**: Start a fresh conversation.

## Examples for Automated Workflows

### Generating and Saving Code
\`\`\`bash
webcmd antigravity send "Write a python script to fetch HN top stories"
# wait ~10-15 seconds for output to render
webcmd antigravity extract-code > hn_fetcher.py
\`\`\`

### Reading Real-time Logs
Agents can run long-running streaming watch instances:
\`\`\`bash
webcmd antigravity watch
\`\`\`
