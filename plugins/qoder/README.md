# webcmd-plugin-qoder

Webcmd commands for qoder.

## Install

```bash
webcmd plugin install github:agentrhq/webcmd/qoder
```

## Commands

| Command | Description |
| --- | --- |
| `webcmd qoder account` | Click the account button (username) in the Qoder sidebar and return the visible account dropdown items. |
| `webcmd qoder add-workspace` | Click "Add Workspace" — opens the folder picker. Note: this opens a system file-picker dialog that Qoder controls; the actual folder selection must be done in the UI by the user. |
| `webcmd qoder ask` | Send a prompt to Qoder and wait up to --timeout seconds for the reply (best-effort: polls for the chat turn count to grow + stabilize). |
| `webcmd qoder credits` | Click "Credits Usage" and return the credits-usage display text. |
| `webcmd qoder history` | List Quests visible in the Qoder sidebar. Returns title + visible metadata. |
| `webcmd qoder knowledge` | Open the Knowledge view (Qoder's personal/team knowledge base). |
| `webcmd qoder marketplace` | Open the Qoder Marketplace. |
| `webcmd qoder more-actions` | Click the "More Actions" button and list its menu items. |
| `webcmd qoder new` | Start a new Qoder Quest (conversation). Clicks the "New Quest" button in the sidebar (or its ⌘N variant). |
| `webcmd qoder open-editor` | Click "Open Editor" — opens the current draft in a full editor pane. |
| `webcmd qoder open-panel` | Open / close the Qoder bottom panel (Output / Terminal / Debug Console). ⌥⌘B equivalent. |
| `webcmd qoder prompt-enhance` | Click "Prompt Enhance" — Qoder rewrites the current composer draft for better LLM consumption. |
| `webcmd qoder read` | Read messages in the current Qoder Quest. Returns role + text for each visible turn. |
| `webcmd qoder search` | Open Qoder Search palette (⌘P), type a query, return matched options. |
| `webcmd qoder send` | Type text into the Qoder composer and click "Send message" (fire-and-forget). |
| `webcmd qoder settings` | Click the Settings button in the Qoder sidebar. |
| `webcmd qoder sidebar-toggle` | Collapse / Expand the Qoder Quest List sidebar (⌘B). |
| `webcmd qoder status` | Check Qoder CDP connection and report the current renderer URL + title. |
| `webcmd qoder view-all` | Click "View all" to show all Quests. |
