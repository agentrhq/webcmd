# Changelog

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
