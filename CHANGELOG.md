# Changelog

## [0.7.0](https://github.com/agentrhq/webcmd/compare/webcmd-v0.6.2...webcmd-v0.7.0) (2026-08-14)

_webcmd v0.7.0: The Multiverse of Agents Is Here._

### Highlights

Webcmd 0.7.0 is the multi-agent browser runtime release.

Browser work is no longer organized around one shared window. Agents can create explicit, persistent Sessions inside a profile, work concurrently in isolated Cloak windows, carry authentication state safely, recover stale leases, and close their workspaces deterministically. Authentication handoffs are scoped to the Session that started them, so humans can complete login, MFA, or CAPTCHA challenges without one agent disrupting another.

```bash
webcmd --profile work session create
webcmd --session session_abc browser run --stdin
webcmd --session session_abc browser snapshot --snapshot-mode read
webcmd session list
webcmd session close session_abc
```

The agent multiverse now extends across development environments. Webcmd adds a native Claude Code plugin marketplace alongside Codex, carrying the same seven bundled authoring and browser skills. Onboarding was rewritten across Claude Code, Codex, Cursor, Hermes, OpenCode, OpenClaw, and Pi so agents can install Webcmd, understand which existing tools to keep, and route compatible browser work through one deterministic command surface.

Research workflows also become agent-native. The new OmniSearch plugin searches seven public communities without login, while Smart Search now recognizes site-specific requests and goes directly to an installed adapter instead of wasting time on generic search engines.

### Improvements

- Added explicit browser Sessions with `session create`, `session list`, and `session close`, plus the root-level `--session` selector. Agents sharing one profile can now work concurrently in separate browser workspaces. [#291](https://github.com/agentrhq/webcmd/pull/291)
- Added session isolation across Cloak windows, browser actions, dialogs, adapter execution, authentication handoffs, leases, cancellation, and daemon disconnects.
- Brought the Session model to hosted browser execution with local/hosted contract and command parity.
- Made `web fetch` a client-owned core command. It now follows a deterministic HTTP-only ladder before any explicit browser fallback: plain HTTP, Chrome TLS impersonation, then Firefox TLS impersonation.
- Added a site-named fast path to Smart Search. Requests naming Hacker News, Reddit, or another supported site now try that site's adapter before a generic search engine. [#269](https://github.com/agentrhq/webcmd/pull/269)
- Improved plugin search so spaced, hyphenated, punctuated, concatenated, and reordered multi-word queries can find the intended plugin while still requiring every search term. [#285](https://github.com/agentrhq/webcmd/pull/285)
- Added a native Claude Code marketplace and synchronized Claude Code, Codex, and npm package version metadata. [#273](https://github.com/agentrhq/webcmd/pull/273)
- Streamlined copyable onboarding prompts and restored the manual quick start for users who prefer direct CLI installation. [#272](https://github.com/agentrhq/webcmd/pull/272) [#275](https://github.com/agentrhq/webcmd/pull/275)
- Reworked tool-routing guidance across seven agent harnesses. Webcmd now distinguishes tools that should be replaced from native search or development tools that should remain available.
- Made plugin updates ignore only untracked npm-generated artifacts such as `node_modules` and `package-lock.json`, while continuing to protect genuine user changes. [#267](https://github.com/agentrhq/webcmd/pull/267)
- Added an explicit confirmation boundary before promoting private adapters into the public repository, plus CI protection against unrelated changes in new-plugin pull requests. [#234](https://github.com/agentrhq/webcmd/pull/234) [#304](https://github.com/agentrhq/webcmd/pull/304)
- **Breaking:** invalid `-f` or `--format` values now fail consistently with exit code 2 instead of silently falling back to a table. Supported formats are `table`, `plain`, `json`, `yaml`, `md`, and `csv`. [#190](https://github.com/agentrhq/webcmd/pull/190)

### Fixes

- Enforced `web fetch --timeout` across the complete request lifecycle, including proxy teardown, DNS resolution, keep-alive tunnels, and late socket errors. A timed-out request now exits at its declared deadline with a structured `TIMEOUT` error. [#265](https://github.com/agentrhq/webcmd/pull/265)
- Fixed browser-run commands returning JavaScript `undefined`; deterministic output now serializes it as `null`. [#278](https://github.com/agentrhq/webcmd/pull/278)
- Repaired `webcmd doctor` session cleanup and first-window selection so diagnostic probes do not leak into normal browser work. [#298](https://github.com/agentrhq/webcmd/pull/298)
- Made the verify row-shape top-level key limit configurable for commands with legitimately wide structured output. [#230](https://github.com/agentrhq/webcmd/pull/230)
- Restored 44 browser test files containing 596 tests to CI coverage, and made the Playwright vendor digest stable across Windows and POSIX paths. [#238](https://github.com/agentrhq/webcmd/pull/238)
- Replaced a real 31 MB test write with a sparse file, preserving coverage while avoiding Windows CI timeouts. [#268](https://github.com/agentrhq/webcmd/pull/268)
- Corrected plugin promotion documentation, repository paths, community-sync guidance, and Hermes formatting.

### Adapters

- Added **OmniSearch**, a no-login research plugin spanning Hacker News, Stack Overflow, GitHub, arXiv, Dev.to, Lobsters, and Bluesky. Its `research` command aggregates evidence, while `verdict` distills community reception for agent workflows. [#270](https://github.com/agentrhq/webcmd/pull/270)

```bash
webcmd omnisearch research "browser agents" -f json
webcmd omnisearch verdict "browser agents" -f json
```

- Added `youtube frames` for capturing timestamped PNG frames at exact timestamps or evenly across a video. [#297](https://github.com/agentrhq/webcmd/pull/297)

```bash
webcmd youtube frames "<video-url>" --timestamps 30,90,150
webcmd youtube frames "<video-url>" --count 5
```

- Added authenticated Amazon India cart inspection and guarded cart additions, including explicit product-variant verification. [#241](https://github.com/agentrhq/webcmd/pull/241)

```bash
webcmd amazon-in cart
webcmd amazon-in cart-add
```

### Contributors

[@adot-7](https://github.com/adot-7) | [@Agnik47](https://github.com/Agnik47) | [@ankitranjan7](https://github.com/ankitranjan7) | [@anshula-100](https://github.com/anshula-100) | [@ayushsingh82](https://github.com/ayushsingh82) | [@beubax](https://github.com/beubax) | [@ngaurav](https://github.com/ngaurav) | [@Rishet11](https://github.com/Rishet11) | [@rishabhraj36](https://github.com/rishabhraj36) | [@Sneh30](https://github.com/Sneh30) | [@yashkhatri012](https://github.com/yashkhatri012)

## [0.6.2](https://github.com/agentrhq/webcmd/compare/webcmd-v0.6.1...webcmd-v0.6.2) (2026-08-12)

### Highlights
- Added explicit browser Sessions for local and hosted browser workflows.
- Added the `browser run` code executor path, including hosted routing and file transfer support.
- Moved CLI surfaces into plugins, with marketplace search/install and command discovery metadata.
- Added plugin override precedence and reconciliation: local `~/.webcmd/clis` overrides installed plugins, update detection is content-based, and override status is actionable.
- Expanded Webcmd Cloud parity for browser commands, hosted manifests, profiles/workspaces, auth handoff, and verify fixture evaluation.

### Fixes
- Hardened session admission/cancellation, background tab focus, Cloak process matching, and browser run timeout behavior.
- Fixed plugin discovery/install edge cases, adapter status output, hosted output flushing, and local override reconciliation.
- Restored and hardened adapter behavior across Amazon, Facebook, Twitter, TikTok, YouTube, and others.

## [0.6.1](https://github.com/agentrhq/webcmd/compare/webcmd-v0.6.0...webcmd-v0.6.1) (2026-08-12)

### Highlights
- Added explicit raw browser Sessions for parallel agents.
- Kept adapter commands on an adapter-default Session unless `--session` is supplied.
- Isolated local Cloak Session windows and pages, and fixed page/admission partitioning by adapter site.
- Scoped auth handoff and Session close behavior so active work is not interrupted.
- Updated bundled documentation and skills for Session usage.

## [0.6.0](https://github.com/agentrhq/webcmd/compare/webcmd-v0.5.4...webcmd-v0.6.0) (2026-08-10)

_webcmd v0.6.0: Code Is All You Need._

### Highlights
Webcmd 0.6.0 is the plugin architecture release. Site CLIs now live as independently installable plugins instead of being bundled into the core package, so the CLI runtime can stay small while adapters evolve on their own cadence. Agents should search the catalog first with `webcmd plugin search <site> -f json`, then install the returned `installSource`.

The new browser-run executor turns browser automation into code. `webcmd browser <session> run` executes sandboxed Playwright-style JavaScript against a real Webcmd browser session, letting agents inspect pages, reuse state, collect artifacts, and verify UI behavior without hand-assembling brittle one-off commands.

Plugin overrides are safer and more deterministic. Local command overrides in `~/.webcmd/clis` take precedence over installed plugin commands, override update detection is content-based, and installing a newly added monorepo sub-plugin refreshes stale local catalog state instead of incorrectly reporting that the plugin does not exist.

### Improvements
- Added `webcmd update` to upgrade the CLI and refresh linked skills from one command.
- Added `webcmd adapter override <site>/<command>` for forking an installed plugin command into an editable local override.
- Moved the core `web` adapter into the new command layout and kept fetch/read workflows available through the same runtime surface.
- Reworked agent onboarding docs around the new plugin-first flow, including Codex, Claude Code, Cursor, Hermes, OpenCode, Pi, OpenClaw, and custom SDK setup.
- Migrated enhanced release-note generation to OpenAI-backed tooling and hardened the structured docs-review flow.

### Fixes
- Fixed stale monorepo plugin installs so a new sub-plugin added to `agentrhq/webcmd` can be found and installed without manually refreshing local cache state.
- Repaired adapter drift and markdown/console output escaping issues across affected site commands.
- Hardened docs-review parsing for fenced JSON and switched it to a lighter review model.
- Hosted browser responses now tolerate additional cloud fields such as `expiresAt`.
- Cached browser runtime version checks to make status and doctor-style commands faster.

### Adapters
- All site adapters now install through the plugin catalog instead of shipping inside the npm package.
- Added postgraduate course export plugins for University of Cincinnati, Concordia University, University of Gottingen, Heidelberg University, HFT Stuttgart, Illinois Institute of Technology, Johns Hopkins University, University of Alberta, and Yale University.
- Added a `luma` plugin for events, guests, and registration-question workflows.
- Updated Skyscanner docs with required flags and current examples.
- Moved and repaired web/social adapter coverage touched by the plugin migration, including Amazon, Facebook, TikTok, Twitter/X, and the built-in web fetch commands.

### Contributors
[@ankitranjan7](https://github.com/ankitranjan7) | [@anshula-100](https://github.com/anshula-100) | [@askadityapandey](https://github.com/askadityapandey) | [@beubax](https://github.com/beubax) | [@ngaurav](https://github.com/ngaurav) | [@rajarshidattapy](https://github.com/rajarshidattapy) | [@rishabhraj36](https://github.com/rishabhraj36)

## [0.5.4](https://github.com/agentrhq/webcmd/compare/webcmd-v0.5.3...webcmd-v0.5.4) (2026-08-09)

### Highlights
- All site adapters are now independent plugins and are no longer bundled with the core `webcmd` package. This major architectural change allows adapters to be updated individually without requiring a new `webcmd` release. Previously bundled commands can be installed using `webcmd plugin install github:agentrhq/webcmd/plugins/<site-name>`. (#216)

### Improvements
- A new `webcmd update` command allows you to upgrade `webcmd` to the latest version and refresh bundled skill links directly from the CLI. (#224)
- The new `webcmd adapter override <site>/<command>` command lets you create a local, editable copy of a command from an installed plugin, making it easier to customize or iterate on existing adapters. (#245)
- The `browser run` command now uses a sandboxed Playwright environment, improving the reliability and capability of browser-based automations. (#196)
- Documentation has been updated to:
    - Add the `webcmd skills` subcommands to the CLI reference. (#200)
    - Document the `-f plain` output format and aliases for `yaml` and `md`. (#202)
    - Improve the clarity and correctness of the main README file. (#205, #207)

### Fixes
- Hosted browser commands will no longer fail when the Webcmd Cloud API includes an `expiresAt` field in its response. (#194)
- Improved the performance of status-checking commands like `webcmd doctor` by caching the browser runtime version, reducing unnecessary file reads. (#213)

### Adapters
- Nine new adapters have been added for exporting postgraduate course data from the following universities: University of Cincinnati, Concordia University, University of Göttingen, Heidelberg University, HFT Stuttgart, Illinois Institute of Technology, Johns Hopkins University, University of Alberta, and Yale University. (#192)
- A new `luma` adapter allows you to manage Luma events, guests, and registration questions. (#195)
- The documentation for the `skyscanner` adapter has been updated to include required flags and provide current examples. (#209)

### Reverts
- Reverted the addition of the one-click "Copy prompt" feature for AI agent setup from the documentation homepage. (#221)

### Contributors
[@ankitranjan7](https://github.com/ankitranjan7) | [@askadityapandey](https://github.com/askadityapandey) | [@beubax](https://github.com/beubax) | [@rajarshidattapy](https://github.com/rajarshidattapy) | [@rishabhraj36](https://github.com/rishabhraj36)

## [0.5.3](https://github.com/agentrhq/webcmd/compare/webcmd-v0.5.2...webcmd-v0.5.3) (2026-08-03)

### Fixes
- Keep the local Cloak wrapper on `0.4.5`, which targets the latest free stealth Chromium release (`146.0.7680.177.5`) on supported platforms.

### Contributors
[@beubax](https://github.com/beubax)

## [0.5.2](https://github.com/agentrhq/webcmd/compare/webcmd-v0.5.1...webcmd-v0.5.2) (2026-07-31)

### Improvements
-   Commands running in the background will no longer cause the browser window to steal focus.

### Adapters
-   **District**: Fixed an issue where the `district/login` command could fail to open the site's login modal. The command is now more resilient to site loading delays.

### Contributors
[@ankitranjan7](https://github.com/ankitranjan7) | [@beubax](https://github.com/beubax)

## [0.5.1](https://github.com/agentrhq/webcmd/compare/webcmd-v0.5.0...webcmd-v0.5.1) (2026-07-30)

### Adapters
*   The `district checkout` adapter now automatically proceeds to the payment page to open the UPI QR scanner. A new `--payment` argument can be set to `review` to stop on the order review page instead. New output columns have been added to report payment status (`paymentMethod`, `paymentState`, `upiQrVisible`, `paymentAmount`).
*   The seat selection logic for the `district checkout` adapter has been hardened to handle cases where the site hides selected seat labels, making the command more reliable.

### Contributors
[@beubax](https://github.com/beubax)

## [0.5.0](https://github.com/agentrhq/webcmd/compare/webcmd-v0.4.3...webcmd-v0.5.0) (2026-07-30)

_webcmd v0.5.0: A Native Codex Plugin and Expanded Discovery_

### Highlights
Webcmd is now available as a native plugin for Codex. In Codex, open **Plugins**, choose **Add plugin marketplace**, and enter `agentrhq/webcmd` to find and install the new plugin. It bundles all seven core Webcmd skills for a seamless agent setup and, on first use, will help install the Webcmd CLI if it is missing.

### Improvements
- The `smart-search` skill has been updated with improved guidance, helping agents make better use of Webcmd's expanding set of search adapters.

### Fixes
- `webcmd doctor` no longer brings the browser window to the foreground on startup, respecting the background window mode.
- Verbose logging is now correctly disabled when the `WEBCMD_VERBOSE` environment variable is set to `0`, `false`, or other "false-y" values.

### Adapters
- A new `pypi` adapter has been added to inspect public Python package metadata. Use `webcmd pypi package <name>` for project details and `webcmd pypi releases <name>` to list recent release files.
- The new `web fetch` command provides a fast, non-browser way to retrieve the content of a URL.
- The browser-based `web read` command has been renamed to `web fetch-browser` to distinguish it from the new non-browser fetch command.
- Over 70 existing commands have been tagged as `search` adapters, improving command discovery and the effectiveness of the `smart-search` skill.

### Contributors
[@ankitranjan7](https://github.com/ankitranjan7) | [@beubax](https://github.com/beubax) | [@ngaurav](https://github.com/ngaurav) | [@Savyasachi-2005](https://github.com/Savyasachi-2005) | [@yoldaolmak](https://github.com/yoldaolmak)

## [0.4.3](https://github.com/agentrhq/webcmd/compare/webcmd-v0.4.2...webcmd-v0.4.3) (2026-07-27)

### Improvements
*   Browser-based commands now run in a background window by default. Use the `--window foreground` flag to show a visible browser for interactive workflows.

### Adapters
*   **ChatGPT**: The `chatgpt model` command adds support for selecting the `GPT-5.6 Pro` model.
*   **Google**: Adds the new `google images` command to perform public, browser-based image searches.
*   **Instagram**: The `instagram user` command can now fetch a user's feed directly by username.
*   **Trip.com**: Adds a new `trip` adapter with twelve commands for searching flights, hotels, attractions, trains, cars, packages, and deals.

### Contributors
[@ankitranjan7](https://github.com/ankitranjan7)

## [0.4.2](https://github.com/agentrhq/webcmd/compare/webcmd-v0.4.1...webcmd-v0.4.2) (2026-07-27)

### Improvements
*   **Workspace-Scoped Profiles for Webcmd Cloud**: Hosted commands can now be scoped to a workspace using the new `--workspace <id>` flag or the `WEBCMD_WORKSPACE` environment variable. This allows for better isolation of user data, especially in multi-tenant applications. Within a workspace, profiles are created lazily on first use.
*   **Simplified Hosted Profile Management**: The `webcmd profile` command for hosted mode has been simplified. It now only supports `list` and `delete` subcommands, as profile creation is now handled automatically within the ambient workspace.

### Adapters
*   **Amazon India (`amazon-in`)**: Adds a new adapter for Amazon.in with support for product search, viewing product details, managing wishlists, and a guarded checkout process. New commands include `amazon-in search`, `product`, `wishlist`, `login`, `whoami`, `checkout`, and `checkout-status`.
*   **BMWBLOG (`bmwblog`)**: Adds a new read-only adapter to search and read articles from BMWBLOG. New commands are `bmwblog latest`, `search`, and `article`.
*   **TechCrunch (`techcrunch`)**: Adds a new read-only adapter for TechCrunch. New commands `techcrunch search` and `article` allow you to find and read the latest tech news.
*   **Y Combinator (`ycombinator`)**: Adds a new read-only adapter for browsing the Y Combinator startup directory. New commands include `ycombinator companies` to search for startups and `ycombinator company` to view a specific company's profile.

### Contributors
[@ankitranjan7](https://github.com/ankitranjan7) | [@beubax](https://github.com/beubax)

## [0.4.1](https://github.com/agentrhq/webcmd/compare/webcmd-v0.4.0...webcmd-v0.4.1) (2026-07-24)

### Highlights
- **Hosted Profile Management**: The `webcmd profile` command now manages hosted browser profiles in Webcmd Cloud.
  - Create named profiles with `webcmd profile create <name>`. You can also associate a public external user ID using the `--user-id` flag.
  - View profiles with `webcmd profile list` and `webcmd profile get <selector>`. Profiles can be looked up by their immutable ID, name, or external user ID.
  - Delete profiles with `webcmd profile delete <id>`. Deletion requires the profile's immutable ID to prevent accidental data loss.
  - Unlike in local mode, custom hosted profiles must be created before use. An unknown `--profile` selector will fail instead of creating a new profile on the fly.

### Contributors
[@beubax](https://github.com/beubax)

## [0.4.0](https://github.com/agentrhq/webcmd/compare/webcmd-v0.3.4...webcmd-v0.4.0) (2026-07-23)


### Features

* add grayscale color palette variables to root stylesheet ([7fc2b0a](https://github.com/agentrhq/webcmd/commit/7fc2b0ae3a8b6777a5c7b4e812241569de0e4df2))
* add local auth handoff protocol ([ea93b63](https://github.com/agentrhq/webcmd/commit/ea93b630a1835fbd65478ae28050a714ca770510))
* enhance screenshot functionality to restore viewport size and support CDP overrides ([0ba71d6](https://github.com/agentrhq/webcmd/commit/0ba71d66dcfebde9d0ab70d1ecb8491ec417e714))
* enhance screenshot functionality to restore viewport size and support CDP overrides ([6caae1b](https://github.com/agentrhq/webcmd/commit/6caae1b8924da5f5821a21db7f31fa2d9fe5d128))
* return local login handoffs immediately ([9749f3f](https://github.com/agentrhq/webcmd/commit/9749f3fcef5ea9a65f0312d8edb52be956b61bb0))
* update documentation theme with custom styling, typography, and site logo ([b51153b](https://github.com/agentrhq/webcmd/commit/b51153b6e5559c3a2f545853844b00a8ba4261a2))


### Bug Fixes

* condition autofix auth handoff ([423966e](https://github.com/agentrhq/webcmd/commit/423966ed2232db915184fd0f8c5990d7f8bbeb84))
* **docs:** show navigation logo ([bffe1e5](https://github.com/agentrhq/webcmd/commit/bffe1e5f49856f2515f477ca78b57c2a48865f40))
* **docs:** show navigation logo ([1b9fad7](https://github.com/agentrhq/webcmd/commit/1b9fad74fe0e343c6e193f644090a8b47416c36b))
* harden local auth handoff ([f08ce77](https://github.com/agentrhq/webcmd/commit/f08ce7702c64a8b507e7eca299052e5683cfb462))
* keep auth handoff skills mode neutral ([60dc2f5](https://github.com/agentrhq/webcmd/commit/60dc2f58c7d38a7d459d69260464261463bfcba5))
* keep pack JSON stdout clean ([087a398](https://github.com/agentrhq/webcmd/commit/087a3984c155f1fb577bbb5b3dff002cb9cf5353))
* normalize Hacker News job URLs ([98ca921](https://github.com/agentrhq/webcmd/commit/98ca921a177a046594df9fe28c4688647fe71c4e))
* require auth handoff verification ([79fc72f](https://github.com/agentrhq/webcmd/commit/79fc72fe9d5cc900be456b3548c2546ea6a3677b))

## [0.3.4](https://github.com/agentrhq/webcmd/compare/webcmd-v0.3.3...webcmd-v0.3.4) (2026-07-17)

### Improvements
*   The accessibility tree snapshot now reveals actionable elements even when their parent containers are ignored by assistive technologies, providing a more complete view of the page.
*   Documentation has been updated with safer patterns for adapter discovery, recommending that users filter the `webcmd list` command to prevent incomplete results from truncated output.
*   Accessibility snapshot helpers are now exported for developers using `webcmd` as a library.

### Fixes
*   The accessibility tree snapshot is now more robust and will no longer hang when processing malformed pages that contain cycles or very deep chains of ignored elements.

### Contributors
[@beubax](https://github.com/beubax)

## [0.3.3](https://github.com/agentrhq/webcmd/compare/webcmd-v0.3.2...webcmd-v0.3.3) (2026-07-16)

### Highlights
*   Skill management has been improved with new and renamed commands. Use `webcmd skills add` (formerly `install`) to add bundled skills to your agent environment, and the new `webcmd skills remove` to safely remove them.

### Improvements
*   Browser sessions are now more robust. `webcmd` can recover sessions after an unexpected closure and will prevent multiple commands from writing to the same persistent session at the same time. Blocked commands will now exit with a status code of 75 to signal that the session is busy.
*   Commands can now be authored with `freshPage: true` metadata, allowing them to run in a new, clean browser tab while preserving an existing login session.
*   The project's `README.md` now includes prominent links to the full documentation site at [webcmd.dev/docs](https://webcmd.dev/docs).
*   Corrected the adapter authoring documentation for `webcmd browser init` to remove a non-existent `--strategy` flag.

### Fixes
*   The `webcmd doctor` command now correctly reports the installed version of the Cloak browser runtime instead of "version unknown".
*   Local-only commands, such as `webcmd skills`, now run correctly when `webcmd` is configured for hosted (cloud) mode.

### Adapters
*   The `producthunt` adapter now correctly detects and reports security verification pages, preventing commands from failing unexpectedly.

### Contributors
[@ankitranjan7](https://github.com/ankitranjan7) | [@beubax](https://github.com/beubax) | [@rajarshidattapy](https://github.com/rajarshidattapy)

## [0.3.2](https://github.com/agentrhq/webcmd/compare/webcmd-v0.3.1...webcmd-v0.3.2) (2026-07-15)

### Adapters
*   The `spotify` adapter has been restored. All `spotify` commands are now available for use again.
*   The `producthunt hot` command is now more reliable.

### Contributors
[@beubax](https://github.com/beubax)

## [0.3.1](https://github.com/agentrhq/webcmd/compare/webcmd-v0.3.0...webcmd-v0.3.1) (2026-07-15)

### Improvements
* The `webcmd plugin create` command now prompts for an author name and GitHub handle to include in the new plugin's metadata.
* The `webcmd-autofix` skill for AI agents has been updated with a workflow to report unresolved, reproducible `webcmd` failures to the development team.

### Fixes
* On macOS, running a browser-based command with `--window background` will no longer bring the browser to the foreground on its first launch.

### Adapters
* **LinkedIn**: Two new adapters have been added:
    * `linkedin company`: Reads a company's profile page for details like industry, size, headquarters, and follower count.
    * `linkedin connections`: Lists your first-degree connections with their names, headlines, and profile URLs.
* **ChatGPT**:
    * `chatgpt deep-research-result`: This command can now report the progress of an ongoing Deep Research task, not just the final completed report.
    * `chatgpt ask`: Improved reliability when waiting for a response to finish generating.
* **Facebook**:
    * `facebook search`: The reliability of the search workflow has been improved.

### Contributors
[@ankitranjan7](https://github.com/ankitranjan7) | [@beubax](https://github.com/beubax) | [@rishabhraj36](https://github.com/rishabhraj36)

## [0.3.0](https://github.com/agentrhq/webcmd/compare/webcmd-v0.2.5...webcmd-v0.3.0) (2026-07-13)

### Highlights
- Introduces a new hosted execution mode, allowing `webcmd` to operate as a thin client against the Webcmd Cloud API. This offloads command execution and browser automation to the cloud service and can be configured with a new `setup` command.

### Improvements
- Agent skill documentation has been updated to improve command discovery and error handling:
  - Adds a fallback to search for installable plugins (`webcmd plugin search`) when a command is not found locally.
  - Clarifies that running `webcmd` with no arguments lists all available commands.
  - Provides better guidance on handling network errors during `webcmd plugin search`, prompting users to retry if a fetch fails.

### Fixes
- The `--window background` flag now correctly prevents browser-backed commands from stealing focus.

### Adapters
- Authentication commands (like `whoami` and `login`) that use the shared site-auth helper now correctly wrap their JSON output in an array, making them compatible with agent workflows expecting structured rows.
- The `antigravity` adapter no longer incorrectly registers itself as an installable agent skill.

### Contributors
[@ankitranjan7](https://github.com/ankitranjan7) | [@beubax](https://github.com/beubax) | [@ngaurav](https://github.com/ngaurav) | [@rishabhraj36](https://github.com/rishabhraj36)

## [0.2.5](https://github.com/agentrhq/webcmd/compare/webcmd-v0.2.4...webcmd-v0.2.5) (2026-07-10)

### Improvements
- Added new commands for plugin discovery and management. Use `webcmd plugin search` to find new community plugins, and `webcmd plugin catalog` subcommands to manage the marketplace sources where `webcmd` searches.
- Documentation has been updated to explain the new plugin monorepo model, where community adapters can be promoted directly into the main repository. This makes them easier to discover and install.

### Adapters
- The BikeWale adapter has been promoted to the main repository as a community plugin.

## [0.2.4](https://github.com/agentrhq/webcmd/compare/webcmd-v0.2.3...webcmd-v0.2.4) (2026-07-10)

### Highlights
- Introduced a plugin marketplace for discovering and installing new adapters. Use the new `webcmd plugin search` command to find available plugins and `webcmd plugin catalog` to manage marketplace sources.

### Fixes
- Fixed failures to launch a browser session when the profile was locked or left in a stale state from a previous run.

### Adapters
- Hardened the `practo login` command to wait for manual sign-in to complete, and added a `--timeout` option.

## [0.2.3](https://github.com/agentrhq/webcmd/compare/webcmd-v0.2.2...webcmd-v0.2.3) (2026-07-09)

### Highlights
- Added four new e-commerce and booking adapters: Blinkit, Zepto, BigBasket, and Practo, enabling automated workflows for groceries, deliveries, and appointments.
- Hardened the District adapter's checkout command to prevent incorrect seat selection, ensuring payment flows are initiated with the exact items requested.

### Improvements
- Introduced a new plugin catalog to support community-developed commands, starting with the `skyscanner` plugin for flight searches.
- The adapter-author skill now provides a more interactive scaffolding experience by asking for user use cases before recommending and generating subsequent commands.
- Improved the release automation workflow to auto-generate more detailed release notes and update the `CHANGELOG.md` file.

### Fixes
None.

### Adapters
- **BigBasket**: Added the `bigbasket` adapter for online grocery shopping, with commands for `search`, `product`, `category`, `add-to-cart`, `cart`, and a review-only `checkout`.
- **Blinkit**: Added a new `blinkit` adapter for grocery delivery, with commands for the full buying path: `login`, `search`, `product`, `add-to-cart`, `cart`, `checkout`, and `place-order`.
- **District**: Hardened the `district checkout` command by adding two new guards. It now reconciles the selected seats with the requested seats to prevent auto-selection of extra tickets, and adds a final assertion on the review page to ensure order accuracy before payment.
- **Practo**: Added a comprehensive `practo` adapter for healthcare appointments. It supports doctor discovery (`search`, `profile`), slot booking (`slots`, `book-preview`, `book-confirm`), and appointment management (`appointments`, `appointment`, `cancel`).
- **Zepto**: Introduced the `zepto` adapter for quick commerce, including commands for `login`, `location`, `search`, `product`, `add-to-cart`, `cart`, `checkout`, and `place-order`.

### Contributors
- @ankitranjan7
- @beubax
- @ngaurav
- @rishabhraj36

### Reverts
None.

## [0.2.2](https://github.com/agentrhq/webcmd/compare/webcmd-v0.2.1...webcmd-v0.2.2) (2026-07-09)

### Highlights

- Bundled Webcmd skills are now much easier to add and refresh through `webcmd skills add` and `webcmd skills update`.
- Persistent-session commands gained a cleaner authoring model with `freshPage`, which keeps login/profile state while avoiding stale page state.
- District booking support moved from local-only adapters into the repo.

### Improvements

- Added `freshPage: true` for persistent site-session commands so adapter authors can start from a clean tab without throwing away cookies or profile state.
- Added bundled Webcmd skill installation and update flows for supported agents.
- Repaired the plugin-management e2e test by replacing a deleted test plugin repository with a live plugin repository.
- Refreshed README guidance around the current project positioning.

### Fixes

- Preserved `freshPage` in generated CLI manifests.
- Fixed District output validation so adapter columns such as `number`, `row`, `seat`, and `_score` are not silently dropped.
- Quoted sitemap author skill frontmatter for strict YAML parsers.
- Fixed Reddit popular HTML response handling.

### Adapters

- Promoted the District (`district.in`) movie and event booking adapters into `clis/district`.
- Added and hardened District flows for search, listings, showtimes, seats, checkout, locations, location switching, and auth status checks.
- Hardened District checkout with clean-start sessions, a login gate before seat selection, stale-session refresh, and payment-handoff behavior.
- Added the shared site-auth `openLogin(page)` hook for modal-based login flows such as District.

## [0.2.1](https://github.com/agentrhq/webcmd/compare/webcmd-v0.2.0...webcmd-v0.2.1) (2026-07-07)

### Highlights

- Browser profile routing became more forgiving for saved defaults while keeping explicit profile selections strict.
- Twitter adapter output and deletion workflows became more useful and reliable.
- Windows command shim handling was fixed for external CLI passthrough.

### Improvements

- Routed default browser profiles as preferred profiles instead of strict requirements.
- Stabilized headed browser e2e coverage and normalized Cloak profile path expectations.
- Refreshed README positioning, branding, social links, and agent-focused docs.

### Fixes

- Handled Windows `.cmd` shims for external command execution.
- Hardened tweet deletion against delayed page loading, stale menus, and runtime response wrappers.
- Removed the daemon port environment override in favor of the fixed daemon port behavior.

### Adapters

- Added quote and bookmark counts to Twitter timeline output.
- Hardened the Twitter tweet deletion flow.

## [0.2.0](https://github.com/agentrhq/webcmd/compare/webcmd-v0.1.2...webcmd-v0.2.0) (2026-07-03)

### Highlights

- Added the release-note helper library and Gemini-backed release-note generation flow.
- Ported upstream transport deadline handling into the Cloak runtime.
- Moved the repository toward English-first docs, skills, and release materials.

### Improvements

- Added reusable release-note helper utilities.
- Added Gemini release-note generation with workflow fallback behavior.
- Scaffolded Mintlify docs and release documentation.
- Rewrote the README for the Webcmd project direction.
- Added repository security documentation.

### Fixes

- Scoped release-note failures so release-please notes remain intact when enhanced generation cannot run.
- Addressed release-note review findings.
- Ported upstream transport deadlines to the Cloak runtime.
- Preserved skill guidance during translation.
- Synced the npm lockfile peer dependency.
- Removed stale deleted-adapter references from docs and tests.

### Adapters

- Cleaned up the adapter catalog by removing Chinese-first built-in adapters.
- Removed references and tests for adapters that had already been deleted.

## [0.1.2](https://github.com/agentrhq/webcmd/compare/webcmd-v0.1.1...webcmd-v0.1.2) (2026-07-03)

### Highlights

- Focused patch release for making the npm package install and execute correctly.

### Improvements

- Relaxed the doctor runtime version warning so compatible runtimes are not reported too aggressively.

### Fixes

- Included the executable in the npm package.
- Parsed `npm pack` JSON correctly even when lifecycle output is present.
- Relaxed the doctor runtime version warning.

## [0.1.1](https://github.com/agentrhq/webcmd/compare/webcmd-v0.1.0...webcmd-v0.1.1) (2026-07-03)

### Highlights

- Published the next installable npm version after the initial package release.

### Fixes

- Released the next publishable npm version.

## 0.1.0 (2026-07-03)

### Highlights

- Initial Webcmd release.
- Introduced a TypeScript/JavaScript toolkit for turning websites, browser sessions, desktop apps, APIs, and local tools into deterministic CLI commands.

### Improvements

- Established the core CLI runtime.
- Added the command registry and manifest foundation.
- Introduced the adapter/plugin architecture and authoring workflow.
- Added the Cloak-backed browser automation layer for inspecting pages, executing browser actions, capturing context, and exposing stable command surfaces.

### Adapters

- Introduced the adapter foundation for building repeatable command surfaces over target sites, apps, APIs, and tools.
