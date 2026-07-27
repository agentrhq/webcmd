# OpenCLI Late-July Port Design

Date: 2026-07-27

## Goal

Port four recent OpenCLI changes into WebCMD without reintroducing the browser-extension runtime, OpenCLI branding, Chinese text, obsolete documentation structure, or new dependencies.

Upstream commits:

- `9a53369bd62a87f5f6feb8b7069d4adebdbfe3be` — fix Instagram user feeds by fetching directly by username.
- `1cb353d57a9cafbe37178c9becccc8c401f88c59` — add an exact GPT-5.6 Pro ChatGPT model target.
- `0e73c3c2c2b45c91e050e1618b20e2aba22f1a23` — add Google Images search.
- `0124c4eb7d83c1030bc94b4fe091f285e26fc076` — add the international Trip.com adapter.

## Scope

All four changes are relevant:

1. The Instagram fix repairs an existing WebCMD adapter whose current source matches the affected upstream version after the package-name substitution.
2. The ChatGPT change extends an existing adapter and uses browser operations already supported by WebCMD.
3. Google Images adds a public, read-only command using `goto`, `evaluate`, `wait`, `scroll`, tab management, and typed WebCMD errors. The Cloak-backed page implementation supports these operations.
4. Trip.com adds English-language international travel commands. It is distinct from the Chinese Ctrip adapter removed from this fork. Its browser commands use `goto` and `evaluate`; its public commands use ordinary fetch requests.

## Porting Rules

- Work from current `origin/main` in an isolated worktree.
- Preserve the four upstream changes as separate logical commits in upstream order.
- Change imports from `@jackwener/opencli` to `@agentrhq/webcmd`.
- Change OpenCLI command examples or runtime identifiers to WebCMD equivalents.
- Do not import upstream Browser Bridge documentation. WebCMD uses its existing Cloak-backed daemon runtime and its current Mintlify documentation structure.
- Keep the repository free of Chinese characters. For ChatGPT, include the English GPT-5.6 Pro labels and aliases but omit Chinese labels. For Google Images, use locale-independent or English page-state detection.
- Add no dependencies and no new abstraction layer.
- Keep official bundled adapters under `clis/`, matching the existing upstream-port precedent. Community-contribution adapters remain under `plugins/`; that separate policy is unchanged.
- Regenerate `cli-manifest.json` from source instead of hand-editing it.

## Per-Commit Design

### Instagram

Add the upstream regression tests first. Replace the two-request profile-ID lookup with the direct username feed endpoint. Preserve the existing output columns and login-oriented failure.

### ChatGPT

Add tests for:

- CLI discovery of the exact GPT-5.6 Pro target and aliases.
- Backend model-config selection using `gpt-5-6-pro`.
- Rejection of generic `Pro` as proof that GPT-5.6 Pro was selected.
- Detection through the model-specific test ID and English visible labels.

Then add the target to the existing model table and update the command description/help. Existing generic intelligence levels remain unchanged.

### Google Images

Port `clis/google/images.js` and its tests. Retain bounded input validation, typed empty-result and blocked-page errors, original-image resolution, normalized HTTPS output, and the existing navigation recovery path. Adapt only package identity and non-English fallback text.

### Trip.com

Port the twelve commands, shared utility module, and consolidated test file. Keep the upstream split between public endpoints and cookie-backed browser commands. Rename the internal client identifier from `opencli-trip` to `webcmd-trip`. Do not add the upstream VitePress adapter page because that documentation system does not exist in WebCMD.

## Error Handling

Preserve upstream typed errors at trust boundaries:

- `ArgumentError` for malformed or out-of-range CLI inputs.
- `AuthRequiredError` for login or verification gates.
- `EmptyResultError` for valid searches with no rows.
- `CommandExecutionError` for unexpected page shape, navigation failure, or malformed responses.

No errors are swallowed except upstream best-effort recovery operations such as closing a stale browser window before retrying navigation.

## Verification

For each logical port:

1. Add or adapt the upstream tests before production changes.
2. Run the focused test and confirm it fails for the missing behavior.
3. Apply the minimum production change.
4. Run the focused test and confirm it passes.

Final verification:

- Regenerate the manifest with `npm run build-manifest`.
- Confirm the repository contains no Chinese characters under `clis`, `skills`, or `src`.
- Run `npm test`.
- Run `npm run typecheck`.
- Run `npm run build`.
- Inspect the final diff for OpenCLI package names, OpenCLI command examples, Browser Bridge documentation, unrelated files, and unintended generated changes.

## Non-Goals

- No changes to the Cloak daemon, browser provider, command registry, plugin system, hosted runtime, or bundled skills.
- No live authenticated Instagram, ChatGPT, or Trip.com smoke test; the port is verified through deterministic adapter tests and the repository gates.
- No unrelated translation cleanup or adapter refactoring.
