# webcmd-plugin-antigravity

Webcmd commands for antigravity.

## Install

```bash
webcmd plugin install github:agentrhq/webcmd/antigravity
```

## Commands

| Command | Description |
| --- | --- |
| `webcmd antigravity add-context` | Click the Add context button in the composer (opens file/URL picker for context attachment). |
| `webcmd antigravity cookies` | List cookies on the Antigravity renderer (JS-visible via document.cookie). |
| `webcmd antigravity copy-code` | Return the text of a code block in the current conversation. Default: last code block; pass --index N (1-based from top) to pick a specific one. |
| `webcmd antigravity copy-message` | Return the text of the last assistant message (best-effort: walks up from the last visible Copy button). |
| `webcmd antigravity delete` | Delete an Antigravity conversation by ID. Antigravity asks for confirmation; we click through it. Require --yes to actually delete. |
| `webcmd antigravity display-options` | Open the Display Options menu and list its items. |
| `webcmd antigravity dump` | Dump the DOM to help AI understand the UI |
| `webcmd antigravity extract-code` | Extract multi-line code blocks from the current Antigravity conversation |
| `webcmd antigravity history` | List visible Antigravity conversations from the sidebar |
| `webcmd antigravity idb-list` | List IndexedDB databases on the Antigravity renderer. |
| `webcmd antigravity mark-read` | Mark an unread Antigravity conversation as read. Fails if the row is already read or the postcondition cannot be verified. |
| `webcmd antigravity model` | Read or switch the active model in Antigravity. Without arguments, reports the current model. With <name> (substring, case-insensitive), switches. |
| `webcmd antigravity nav` | Click Go Back or Go Forward (Antigravity in-app history). |
| `webcmd antigravity new` | Start a new conversation / clear context in Antigravity |
| `webcmd antigravity react` | Click "Good response" or "Bad response" on the LAST assistant message. |
| `webcmd antigravity read` | Read the latest chat messages from Antigravity AI |
| `webcmd antigravity recent-paths` | Show Antigravity's recently-opened folders/files (history.recentlyOpenedPathsList). |
| `webcmd antigravity rename` | Rename an Antigravity conversation by ID (NOT YET IMPLEMENTED — see source comment). |
| `webcmd antigravity revert` | Click the revert button (per-message revert for agent changes). Requires --yes (this modifies your workspace). |
| `webcmd antigravity send` | Send a message to Antigravity AI via the internal Lexical editor |
| `webcmd antigravity settings` | Click the Antigravity settings button (matched by data-testid="settings-button"). |
| `webcmd antigravity settings-read` | Read Antigravity's user settings.json (theme, proxy, agCockpit, tfa.system.autoAccept, etc.). |
| `webcmd antigravity sidebar-toggle` | Click Toggle Sidebar (collapses/expands the Antigravity sidebar). |
| `webcmd antigravity state-get` | Read one value from Antigravity's state.vscdb. Pass --workspace <id> for per-workspace. |
| `webcmd antigravity state-keys` | List keys in Antigravity's globalStorage state.vscdb (VSCode-style). Pass --workspace <id> to query a per-workspace DB. Works while Antigravity is closed. |
| `webcmd antigravity status` | Check Antigravity CDP connection and get current page state |
| `webcmd antigravity storage-get` | Read a single localStorage / sessionStorage value on the Antigravity renderer. |
| `webcmd antigravity storage-keys` | List localStorage / sessionStorage keys on the Antigravity renderer (CDP). |
| `webcmd antigravity toggle-aux` | Toggle the Auxiliary Pane (Antigravity's secondary panel for code/preview). |
| `webcmd antigravity watch` | Stream new chat messages from Antigravity in real-time |
| `webcmd antigravity workspaces-list` | List Antigravity workspaceStorage entries (each represents a previously-opened folder). |
