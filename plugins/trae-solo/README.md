# webcmd-plugin-trae-solo

Webcmd commands for trae-solo.

## Install

```bash
webcmd plugin install github:agentrhq/webcmd/trae-solo
```

## Commands

| Command | Description |
| --- | --- |
| `webcmd trae-solo automation-list` | List Trae SOLO Automation tab content. Default tab is "Configured"; pass --tab to switch. |
| `webcmd trae-solo cookies` | List cookies on the Trae SOLO renderer (JS-visible via document.cookie; httpOnly cookies not shown). |
| `webcmd trae-solo extensions-list` | List VSCode extensions installed in Trae SOLO (~/.trae/extensions/extensions.json). Works while Trae is closed. |
| `webcmd trae-solo history` | List Trae SOLO projects and the tasks within each (from the project-list view sidebar). |
| `webcmd trae-solo idb-list` | List IndexedDB databases on the Trae SOLO renderer. Trae ships an @byted/ve-rtc DB used by the Volcengine RTC voice/video infrastructure. |
| `webcmd trae-solo mode` | Read or switch TRAE SOLO between Code mode and Work mode. |
| `webcmd trae-solo model` | Read or switch the current AI model in TRAE SOLO. Without arguments, reports the current model. With <name> argument (substring, case-insensitive), switches to a matching model. Pass --list to enumerate available models. |
| `webcmd trae-solo recent-workspaces` | Show Trae SOLO's recently-opened workspaces (the File → Open Recent menu, stored under key "history.recentlyOpenedPathsList" in state.vscdb). |
| `webcmd trae-solo settings-read` | Parse and pretty-print Trae SOLO user settings.json (~/Library/Application Support/TRAE SOLO/User/settings.json). Handles VSCode JSONC syntax (line comments + trailing commas). |
| `webcmd trae-solo skill-category` | Filter Skills Marketplace by category. Pass --list to see categories. |
| `webcmd trae-solo skill-fs-installed` | List INSTALLED Trae SOLO skills (managedSkills entry in ~/.trae/skill-config.json). |
| `webcmd trae-solo skill-fs-list` | List all Trae SOLO skills present on disk under ~/.trae/skills/. Reads SKILL.md front-matter for descriptions. Works while Trae is closed. |
| `webcmd trae-solo skill-fs-show` | Print a skill's SKILL.md content + on-disk path. |
| `webcmd trae-solo skill-list` | List Trae SOLO Skills — by default the Marketplace; pass --installed to list installed ones. |
| `webcmd trae-solo skill-search` | Filter Skills Marketplace by keyword. |
| `webcmd trae-solo state-get` | Read a single key from Trae SOLO's globalStorage state.vscdb. Pass --workspace <ws-id> to query a per-workspace DB instead. Returns parsed JSON if the value is JSON. |
| `webcmd trae-solo state-keys` | List all keys present in Trae SOLO's globalStorage state.vscdb (VSCode-style UI/agent state). Pass --workspace <ws-id> to query a per-workspace DB instead. Use state-get to read a specific value. (See renderer storage-keys for browser-side LS/SS.) |
| `webcmd trae-solo status` | Check active CDP connection to Trae SOLO Desktop |
| `webcmd trae-solo storage-get` | Read a single localStorage / sessionStorage value on the Trae SOLO renderer. |
| `webcmd trae-solo storage-keys` | List localStorage / sessionStorage keys on the Trae SOLO renderer (CDP). For the on-disk VSCode state.vscdb, see state-keys. |
| `webcmd trae-solo task-fs-list` | List Trae SOLO task ids from disk (snapshot/<uuid> + agentconfig/<uuid>.json). Works while Trae is closed. |
| `webcmd trae-solo task-fs-show` | Show the workspace tree at a given chat-turn ref (via git ls-tree). Pass --turn <turn-id> to pick a turn; otherwise the latest after-chat-turn ref. |
| `webcmd trae-solo task-fs-turns` | Show the chat-turn timeline for a Trae SOLO task as git tags (before-chat-turn-* / after-chat-turn-*). |
| `webcmd trae-solo user-rules` | Print Trae SOLO user rules (~/.trae/user_rules.md). |
| `webcmd trae-solo workspaces-list` | List Trae SOLO workspaceStorage entries (~/Library/.../TRAE SOLO/User/workspaceStorage/<uuid>/), resolving each workspace.json to its single-folder path or multi-folder workspace target. Works while Trae is closed. |
