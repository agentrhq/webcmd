# Release Notes, Docs Scaffold, and English Sanitization Design

## Goal

Polish Webcmd's release and repository presentation by adding Gemini-generated GitHub release notes, scaffolding a future Mintlify docs architecture, and making the tracked first-party repository English-only by removing Chinese-first built-in adapters and translating or replacing remaining Chinese text.

## Context

Webcmd is a TypeScript/JavaScript project with a core CLI runtime, a manifest-based command registry, bundled authoring skills, built-in site adapters under `clis/`, and a browser automation layer backed by the local daemon and Cloak runtime.

The current release workflow uses `googleapis/release-please-action@v4` to create release PRs, create GitHub releases, and publish `@agentrhq/webcmd` to npm. The repository already has `docs/superpowers/*` internal planning files but no public docs architecture. A broad Han-character scan shows Chinese text in bundled skills, source/test files, `cli-manifest.json`, external CLI metadata, and hundreds of Chinese-site adapter files.

Reference material:

- Libretto release workflow: https://github.com/saffron-health/libretto/blob/main/.github/workflows/release.yml
- Libretto changelog generator: https://github.com/saffron-health/libretto/blob/main/packages/libretto/scripts/generate-changelog.ts
- Gemini API docs: https://ai.google.dev/gemini-api/docs
- Gemini content generation API: https://ai.google.dev/api/generate-content
- Gemini model docs: https://ai.google.dev/gemini-api/docs/models
- Mintlify monorepo docs path: https://www.mintlify.com/docs/deploy/monorepo

## Approved Scope

Implement one coordinated product-polish pass:

1. Keep `release-please` for versioning, tags, changelog maintenance, GitHub releases, and npm publish.
2. Add Gemini-generated release notes for GitHub release bodies.
3. Scaffold, but do not write, a Mintlify docs architecture.
4. Remove Chinese-first built-in adapters and sanitize remaining first-party tracked text to English.
5. Do not add a CI guard for Chinese text.

## Release Flow

The release workflow keeps its existing `release-please` job and release-time verification. When `steps.release.outputs.release_created` is true, the workflow adds Gemini release-note generation after the current typecheck, build, manifest drift check, test, and package executable checks. The workflow then edits the GitHub release body before running `npm publish`.

Create `scripts/generate-release-notes.ts`. The script:

- Accepts the current release tag as its only required argument.
- Uses `gh release list`, `gh release view`, `gh api repos/<owner>/<repo>/compare/<previous>...<current>`, and `gh pr view` / `gh pr diff` to collect the exact release range.
- Detects squash-merge and merge-commit PR numbers from commit messages.
- Excludes release PRs, PRs labeled `skip-changelog`, and PRs labeled `release`.
- Provides the model with PR titles, labels, merged dates, files, bodies, and diffs.
- Writes Markdown to stdout.

Use Gemini instead of OpenAI. Add `@google/genai` as a dev dependency unless the repository already has a preferred Gemini SDK by implementation time. The script reads:

- `GEMINI_API_KEY` as the required CI secret for enhanced notes.
- `GEMINI_RELEASE_NOTES_MODEL` as an optional model override.

Default model: `gemini-2.5-pro`, based on Google's current stable model docs. The model must remain configurable because model names change over time.

The generated release-note body must always contain these sections in this order:

```markdown
## Highlights
## Improvements
## Fixes
## Contributors
## Reverts
```

If a section has no meaningful entries, the script writes `None.` under that heading so release notes stay predictable. The Contributors section credits PR authors by GitHub handle when available.

Failure behavior:

- If `GEMINI_API_KEY` is missing, print a warning and exit successfully without editing the release.
- If Gemini generation fails, print a warning and exit successfully without editing the release.
- In either fallback path, the `release-please` GitHub release body remains intact.

Workflow update:

- Install dependencies as the release workflow already does.
- Run `npm run generate-release-notes -- "$TAG" > "$RUNNER_TEMP/release-notes.md"` with `GH_TOKEN` and `GEMINI_API_KEY`.
- If the output file is non-empty, run `gh release edit "$TAG" --notes-file "$RUNNER_TEMP/release-notes.md"`.

Add package scripts:

- `generate-release-notes`: `tsx scripts/generate-release-notes.ts`

Testing:

- Unit-test pure helpers for previous-tag selection, PR-number extraction, PR filtering, section normalization, and fallback handling.
- Use mocked `gh` and mocked Gemini responses. Do not call external APIs in tests.

## Docs Scaffold

Add only the architecture needed for future Mintlify docs. Do not migrate README content or write full docs pages in this pass.

Create:

- `docs/docs.json`
- Minimal `.mdx` stubs for the configured nav to resolve, such as `docs/index.mdx`, `docs/quickstart.mdx`, `docs/concepts.mdx`, `docs/cli-reference.mdx`, `docs/browser-sessions.mdx`, `docs/authoring.mdx`, `docs/generated-clis.mdx`, and `docs/plugins-and-skills.mdx`.

Requirements:

- Keep public nav focused on future user docs.
- Keep `docs/superpowers/*` out of Mintlify navigation because those are internal planning artifacts.
- Keep stubs short and plainly marked as placeholders for future docs.
- Do not add a separate website app, build pipeline, or large docs content.

## English-Only Sanitization

The repo should be English-only in tracked first-party files after this pass.

Delete Chinese-first built-in adapter directories under `clis/`. This includes adapters whose target product is Chinese-first, China-specific, or whose implementation depends materially on Chinese UI/API text. The final implementation should derive the exact deletion list from scanning `clis/` and reviewing ambiguous names, but the expected removals include major families such as:

- `12306`, `1688`, `36kr`, `51job`
- `bilibili`, `boss`, `chaoxing`, `cnki`, `ctrip`
- `dianping`, `dongchedi`, `douban`, `douyin`
- `eastmoney`, `gov-law`, `gov-policy`, `guazi`, `hupu`
- `jd`, `jianyu`, `jike`, `jimeng`, `juejin`
- `ke`, `kimi`, `maimai`, `mubu`, `nowcoder`
- `qwen`, `rednote`, `sinablog`, `sinafinance`, `smzdm`
- `taobao`, `tdx`, `ths`, `tieba`, `toutiao`
- `trae-cn`, `uisdc`, `v2ex`, `wanfang`
- `wechat-channels`, `weibo`, `weixin`
- `weread`, `weread-official`, `xianyu`, `xiaoe`
- `xiaohongshu`, `xiaoyuzhou`, `xueqiu`, `yuanbao`, `zhihu`, `zsxq`

Sanitize remaining files:

- Translate bundled `skills/webcmd-*` and `skills/smart-search/*` content to English.
- Remove Chinese external CLI entries or translate them only if they are not China-specific and have English-only metadata.
- Replace Chinese sample data in global adapters/tests with English examples.
- Remove Chinese locale fallbacks in global adapters when they are not required by the now-English target surface.
- Replace Chinese snapshot/test fixtures with English fixtures where the test is about generic formatting behavior.
- Preserve non-Han Unicode that is semantically useful, such as arrows or punctuation, unless it is part of Chinese text.

Regenerate:

- Rebuild `cli-manifest.json` with intentional removals allowed. Use the existing `--allow-removals=N` safety switch or equivalent after counting removed manifest entries.

Verification:

- `npm run build-manifest -- --allow-removals=<count>` or the exact command required by the implemented deletion count.
- `npm run typecheck`
- `npm test`
- Targeted tests for release-note helper logic.
- `rg -n -P '[\p{Han}]'` over tracked first-party files, excluding `node_modules`, `.git`, build artifacts, lockfiles, and any intentionally ignored generated output. Expected result: no matches.

## Risks and Mitigations

Mass adapter deletion can break tests and examples that assume Chinese-site coverage. Update those tests to use global adapters or remove obsolete Chinese-site cases.

Manifest removal safety will block the first rebuild. Count removed manifest entries and pass the explicit removal count rather than disabling the safety net blindly.

Gemini release notes can fail because of missing secrets, model changes, API outages, or rate limits. Treat enhanced notes as best-effort and preserve `release-please` notes on failure.

Docs scaffold can accidentally look like finished documentation. Keep stubs short and visibly placeholder-style.

## Acceptance Criteria

- Release workflow can generate Gemini-written GitHub release notes with sections: Highlights, Improvements, Fixes, Contributors, Reverts.
- Existing `release-please` release and npm publish behavior remains intact if Gemini is unavailable.
- Mintlify docs architecture exists under `docs/` without full docs content.
- Chinese-first built-in adapters are removed from `clis/` and `cli-manifest.json`.
- Bundled skills and remaining first-party tracked files contain no Han characters.
- Typecheck and unit tests pass, or any unrelated pre-existing failures are clearly documented.
