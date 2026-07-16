# Changelog

## [0.4.0](https://github.com/agentrhq/webcmd/compare/webcmd-v0.3.2...webcmd-v0.4.0) (2026-07-16)


### Features

* add persistent session lease domain ([b18f849](https://github.com/agentrhq/webcmd/commit/b18f849fbbec683654e5fc18745cb4e1d971a280))
* add skills add and remove commands ([c6dff29](https://github.com/agentrhq/webcmd/commit/c6dff29525bf032604705c13e1b0bb542f7b0773))
* add skills add and remove commands ([3951675](https://github.com/agentrhq/webcmd/commit/3951675a93a434105e7a46432cc255c13eac3449))
* add support for local command execution in hosted mode ([98c232c](https://github.com/agentrhq/webcmd/commit/98c232cdb03e17cc6b4bb108e535e5245d6ea3d2))
* arbitrate persistent writes in Cloak daemon ([fa0997f](https://github.com/agentrhq/webcmd/commit/fa0997fbbeeebc1d6c6928868af4111ea3ca6c2c))
* hold session lease for logical adapter runs ([342a22e](https://github.com/agentrhq/webcmd/commit/342a22e67882b7f501a632db15b1c9248b2ce538))
* remove bundled skill links ([9eddc7b](https://github.com/agentrhq/webcmd/commit/9eddc7bd1e18dbd757847d8ad10ab013992fdc55))
* update HOSTED_LOCAL_COMMANDS to derive from HOSTED_ROOT_HELP for consistency ([a26fbd7](https://github.com/agentrhq/webcmd/commit/a26fbd7ba13f4036ea543463aa066354c2107bdc))


### Bug Fixes

* accept hosted freshPage metadata ([ef732b1](https://github.com/agentrhq/webcmd/commit/ef732b1fcffa73e13423ff2533acb206f18b2a6d))
* allow docs sync review to comment on pull requests ([77b26b2](https://github.com/agentrhq/webcmd/commit/77b26b295884a68b9d22019188bdb9c07f57f89f))
* classify Product Hunt verification pages ([671f4d5](https://github.com/agentrhq/webcmd/commit/671f4d58152b146414f61185fb488601bdbfe70f))
* extend docs sync review model timeout ([f3d8584](https://github.com/agentrhq/webcmd/commit/f3d85846d48005dffc0f7c3df2bc6b3416b8a528))
* isolate logical adapter run contexts ([2555450](https://github.com/agentrhq/webcmd/commit/25554502652efb0892f4d13c6ddb6f60173b9792))
* keep hosted commands on cloud ([b09cfbe](https://github.com/agentrhq/webcmd/commit/b09cfbee5e76d29203fdf09905ff00ff9d03169f))
* keep site-blocked errors edge-safe ([67cf5c8](https://github.com/agentrhq/webcmd/commit/67cf5c817fa64be67e325010d02404b3ad47334b))
* make session release best effort ([9b7fef3](https://github.com/agentrhq/webcmd/commit/9b7fef31ed92e01f3a49436bc888bbbb6b263f17))
* preserve cloud parity for blocked sites and fresh pages ([164d1ec](https://github.com/agentrhq/webcmd/commit/164d1eccbbc27820ff48121d078fa6152868f85f))
* preserve hosted routing for local-only commands ([d58db4d](https://github.com/agentrhq/webcmd/commit/d58db4d6b58f378467c9652bed8a6b5922d074b2))
* recover Cloak sessions and arbitrate persistent writes ([118cfff](https://github.com/agentrhq/webcmd/commit/118cfff4760778324bb63cd6b42c7d3e42c19db8))
* recover closed Cloak profile contexts ([3a44f36](https://github.com/agentrhq/webcmd/commit/3a44f36d50b8322adca9e1c555c842debd6e16b3))
* release safe late adapter outcomes ([46ace0b](https://github.com/agentrhq/webcmd/commit/46ace0b4e79725effd46bc200c8d6bf7a8854957))
* resolve cloak browser version in LocalCloakRuntimeProvider and CloakSessionManager ([#102](https://github.com/agentrhq/webcmd/issues/102)) ([115447b](https://github.com/agentrhq/webcmd/commit/115447b0a4d4838ae4dc17446f7a25ff8ef863ab))
* restrict Windows diagnostic artifacts ([89e0915](https://github.com/agentrhq/webcmd/commit/89e091553989834a799c2c284562b75a48ab59b3))
* retain daemon liveness after response timeout ([b5aca5a](https://github.com/agentrhq/webcmd/commit/b5aca5aaea7d5d8083e2de162ae80b063d52ea36))
* run package bin checks through Windows shell ([a94574c](https://github.com/agentrhq/webcmd/commit/a94574cc6cfe2a19b85eaaacc7d8d35ea83e38ac))
* tighten Cloak page recovery boundaries ([dad0d3b](https://github.com/agentrhq/webcmd/commit/dad0d3b86ec6e7046c984af48032937e77f77e54))
* validate session lease process ids ([7f76cf5](https://github.com/agentrhq/webcmd/commit/7f76cf5c76490643be32892bbc4cf866d3ed6995))

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
