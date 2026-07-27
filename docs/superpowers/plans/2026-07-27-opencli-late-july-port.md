# OpenCLI Late-July Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port four selected OpenCLI commits into WebCMD while preserving the Cloak runtime, English-only source, WebCMD package identity, and generated manifest contract.

**Architecture:** Apply the upstream adapter tests and implementation hunks rather than rewriting them. Adapt only fork boundaries: package imports, OpenCLI identity strings, Chinese fallback text, obsolete Browser Bridge documentation, and generated manifests. Each upstream commit remains an independently tested WebCMD commit.

**Tech Stack:** JavaScript ES modules, TypeScript 6, Vitest 4, WebCMD adapter registry, Cloak-backed browser `Page`, npm.

## Global Constraints

- Work only in `/Users/ankitranjan/Work/webcmd/.worktrees/port-opencli-late-july-updates`.
- Add no dependencies and no new abstraction layer.
- Keep official bundled adapters under `clis/`.
- Keep `clis`, `skills`, and `src` free of Chinese characters.
- Use `@agentrhq/webcmd` package imports; do not add `@jackwener/opencli`.
- Use WebCMD command names and runtime identifiers; do not add `opencli` command examples or `opencli-trip`.
- Do not port VitePress adapter documentation or Browser Bridge extension instructions.
- Generate `cli-manifest.json` with `npm run build-manifest`; never hand-edit it.
- Preserve upstream typed errors and existing Cloak browser APIs.

## File Map

- `clis/instagram/user.js`: fetch recent Instagram posts directly by username.
- `clis/instagram/user.test.js`: regression coverage for the direct username endpoint.
- `clis/chatgpt/model.js`: expose exact model names in command metadata.
- `clis/chatgpt/model.test.js`: command metadata coverage for GPT-5.6 Pro.
- `clis/chatgpt/utils.js`: model target aliases, backend slug selection, and read-back detection.
- `clis/chatgpt/utils.test.js`: exact-selection and model-detection regression coverage.
- `clis/google/images.js`: Google Images navigation, extraction, normalization, and typed errors.
- `clis/google/images.test.js`: deterministic Google Images DOM and command tests.
- `clis/trip/*.js`: twelve Trip.com commands, shared parsers/extractors, and consolidated tests.
- `cli-manifest.json`: generated command metadata for ChatGPT, Google Images, and Trip.com.

---

### Task 1: Instagram direct username feed

**Files:**
- Create: `clis/instagram/user.test.js`
- Modify: `clis/instagram/user.js`

**Interfaces:**
- Consumes: existing `instagram/user` registry command and browser-evaluated `fetch`.
- Produces: one request to `https://www.instagram.com/api/v1/feed/user/<encoded-username>/username/?count=<limit>` and the existing row shape `{ index, caption, likes, comments, type, date }`.

- [ ] **Step 1: Fetch the four upstream commits into the local object database**

```bash
git fetch https://github.com/jackwener/OpenCLI.git \
  9a53369bd62a87f5f6feb8b7069d4adebdbfe3be \
  1cb353d57a9cafbe37178c9becccc8c401f88c59 \
  0e73c3c2c2b45c91e050e1618b20e2aba22f1a23 \
  0124c4eb7d83c1030bc94b4fe091f285e26fc076
```

- [ ] **Step 2: Apply and adapt the upstream Instagram test**

```bash
git show 9a53369bd62a87f5f6feb8b7069d4adebdbfe3be -- clis/instagram/user.test.js | git apply --3way
```

Change its registry import to:

```js
import { getRegistry } from '@agentrhq/webcmd/registry';
```

- [ ] **Step 3: Run the focused test and verify RED**

Run:

```bash
npx vitest run --project adapter clis/instagram/user.test.js
```

Expected: the direct-endpoint assertion fails because the current command first calls `web_profile_info`.

- [ ] **Step 4: Apply the upstream production fix**

```bash
git show 9a53369bd62a87f5f6feb8b7069d4adebdbfe3be -- clis/instagram/user.js | git apply --3way
```

The resulting evaluate block must make one request:

```js
const r2 = await fetch(
  'https://www.instagram.com/api/v1/feed/user/' + encodeURIComponent(username) + '/username/?count=' + limit,
  opts
);
if (!r2.ok) throw new Error('HTTP ' + r2.status + ' - make sure you are logged in to Instagram');
```

- [ ] **Step 5: Run the focused test and verify GREEN**

```bash
npx vitest run --project adapter clis/instagram/user.test.js
```

Expected: 2 tests pass.

- [ ] **Step 6: Commit**

```bash
git add clis/instagram/user.js clis/instagram/user.test.js
git commit -m "fix(instagram): fetch user feed by username"
```

---

### Task 2: Exact GPT-5.6 Pro model target

**Files:**
- Modify: `clis/chatgpt/model.js`
- Modify: `clis/chatgpt/model.test.js`
- Modify: `clis/chatgpt/utils.js`
- Modify: `clis/chatgpt/utils.test.js`
- Modify: `cli-manifest.json`

**Interfaces:**
- Consumes: `CHATGPT_MODEL_TARGETS`, `CHATGPT_MODEL_CHOICES`, `selectChatGPTModel`, and `getCurrentChatGPTModel`.
- Produces: canonical key `gpt-5.6-pro`, backend slug `gpt-5-6-pro`, standard effort, English labels, aliases, and model-specific read-back.

- [ ] **Step 1: Apply the upstream test hunks**

```bash
git show 1cb353d57a9cafbe37178c9becccc8c401f88c59 -- \
  clis/chatgpt/model.test.js clis/chatgpt/utils.test.js | git apply --3way
```

Keep the new assertions for:

```js
expect(modelCommand.description).toContain('GPT-5.6 Pro');
expect(CHATGPT_MODEL_CHOICES).toEqual(expect.arrayContaining([
  'gpt-5.6-pro',
  'gpt-5-6-pro',
  'gpt-5.6-sol-pro',
  'gpt-5.6',
  '5.6',
]));
```

- [ ] **Step 2: Run the focused tests and verify RED**

```bash
npx vitest run --project adapter clis/chatgpt/model.test.js clis/chatgpt/utils.test.js
```

Expected: GPT-5.6 Pro metadata, alias, or selection assertions fail because the target is absent.

- [ ] **Step 3: Update command metadata**

In `clis/chatgpt/model.js`, set:

```js
description: 'Switch ChatGPT web model or intelligence level (GPT-5.6 Pro, fast, balanced, advanced, very-high, pro)',
```

and:

```js
{ name: 'model', required: true, positional: true, help: 'ChatGPT model or intelligence level to switch to', choices: CHATGPT_MODEL_CHOICES },
```

- [ ] **Step 4: Add the English-only model target**

Insert into `CHATGPT_MODEL_TARGETS` before generic `pro`:

```js
'gpt-5.6-pro': {
  label: 'GPT-5.6 Pro',
  labels: ['GPT-5.6 Pro', 'GPT-5.6 Sol Pro'],
  optionLabels: ['GPT-5.6 Pro', 'GPT-5.6 Sol Pro'],
  testIds: ['model-switcher-gpt-5-6-pro'],
  aliases: ['gpt-5-6-pro', 'gpt-5.6-sol-pro', 'gpt-5-6-sol-pro', 'gpt-5.6', 'gpt-5-6', '5.6-pro', '5.6'],
  modelConfig: { modelSlug: 'gpt-5-6-pro', effort: 'standard' },
},
```

- [ ] **Step 5: Regenerate the manifest and run focused tests**

```bash
npm run build-manifest
npx vitest run --project adapter clis/chatgpt/model.test.js clis/chatgpt/utils.test.js
```

Expected: focused tests pass and the manifest lists the new aliases without Chinese text.

- [ ] **Step 6: Commit**

```bash
git add clis/chatgpt/model.js clis/chatgpt/model.test.js clis/chatgpt/utils.js clis/chatgpt/utils.test.js cli-manifest.json
git commit -m "feat(chatgpt): add GPT-5.6 Pro model target"
```

---

### Task 3: Google Images search adapter

**Files:**
- Create: `clis/google/images.js`
- Create: `clis/google/images.test.js`
- Modify: `cli-manifest.json`

**Interfaces:**
- Consumes: `requireBoundedInteger`, `requireRows`, `requireSearchQuery`, `runBrowserStep`, `toHttpsUrl`, `unwrapBrowserResult`, and the existing browser `Page` methods.
- Produces: `google/images` rows with `rank`, `title`, `imageUrl`, `thumbnailUrl`, `sourceUrl`, `source`, `width`, and `height`.

- [ ] **Step 1: Apply and adapt the upstream test file**

```bash
git show 0e73c3c2c2b45c91e050e1618b20e2aba22f1a23 -- clis/google/images.test.js | git apply --3way
```

Change imports from `@jackwener/opencli` to `@agentrhq/webcmd`.

- [ ] **Step 2: Run the focused test and verify RED**

```bash
npx vitest run --project adapter clis/google/images.test.js
```

Expected: module loading fails because `clis/google/images.js` does not exist.

- [ ] **Step 3: Apply and adapt the upstream adapter**

```bash
git show 0e73c3c2c2b45c91e050e1618b20e2aba22f1a23 -- clis/google/images.js | git apply --3way
```

Change imports to:

```js
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';
```

Keep the blocked-page test English and locale-independent:

```js
const explicitNoResults = /did not match any documents|no results found|no images found/.test(bodyText);
```

- [ ] **Step 4: Run the focused tests and regenerate the manifest**

```bash
npx vitest run --project adapter clis/google/images.test.js
npm run build-manifest
```

Expected: Google Images tests pass and `google/images` appears once in `cli-manifest.json`.

- [ ] **Step 5: Commit**

```bash
git add clis/google/images.js clis/google/images.test.js cli-manifest.json
git commit -m "feat(google): add images search adapter"
```

---

### Task 4: Trip.com international adapter

**Files:**
- Create: `clis/trip/attraction.js`
- Create: `clis/trip/car.js`
- Create: `clis/trip/deals.js`
- Create: `clis/trip/flight-round.js`
- Create: `clis/trip/flight.js`
- Create: `clis/trip/hotel-search.js`
- Create: `clis/trip/hotel.js`
- Create: `clis/trip/package.js`
- Create: `clis/trip/search.js`
- Create: `clis/trip/tour.js`
- Create: `clis/trip/train.js`
- Create: `clis/trip/transfer.js`
- Create: `clis/trip/utils.js`
- Create: `clis/trip/trip.test.js`
- Modify: `cli-manifest.json`

**Interfaces:**
- Consumes: WebCMD registry/errors, ordinary `fetch`, and browser `goto`/`evaluate`.
- Produces: twelve `trip/*` commands for destination lookup, flights, hotels, attractions, trains, cars, transfers, tours, packages, and deals.

- [ ] **Step 1: Apply and adapt the consolidated test file**

```bash
git show 0124c4eb7d83c1030bc94b4fe091f285e26fc076 -- clis/trip/trip.test.js | git apply --3way
```

Change the registry import to:

```js
import { getRegistry } from '@agentrhq/webcmd/registry';
```

Change the expected package client ID from `opencli-trip` to `webcmd-trip`.

- [ ] **Step 2: Run the focused test and verify RED**

```bash
npx vitest run --project adapter clis/trip/trip.test.js
```

Expected: module loading fails because the Trip.com command and utility files do not exist.

- [ ] **Step 3: Apply the upstream production files without docs, manifest, or the already-added test**

```bash
git show 0124c4eb7d83c1030bc94b4fe091f285e26fc076 -- \
  clis/trip/attraction.js clis/trip/car.js clis/trip/deals.js \
  clis/trip/flight-round.js clis/trip/flight.js clis/trip/hotel-search.js \
  clis/trip/hotel.js clis/trip/package.js clis/trip/search.js \
  clis/trip/tour.js clis/trip/train.js clis/trip/transfer.js \
  clis/trip/utils.js | git apply --3way
```

- [ ] **Step 4: Adapt fork identity**

Across `clis/trip/*.js`:

```text
@jackwener/opencli -> @agentrhq/webcmd
opencli-trip       -> webcmd-trip
```

Do not change data fields named `extension`; those are Trip.com API response fields, not browser-extension references.

- [ ] **Step 5: Run the focused tests and regenerate the manifest**

```bash
npx vitest run --project adapter clis/trip/trip.test.js
npm run build-manifest
```

Expected: Trip.com tests pass and exactly twelve `trip/*` commands appear in `cli-manifest.json`.

- [ ] **Step 6: Commit**

```bash
git add clis/trip cli-manifest.json
git commit -m "feat(trip): add international adapter"
```

---

### Task 5: Repository-wide verification

**Files:**
- Verify: all files changed since `origin/main`

**Interfaces:**
- Consumes: the four independently committed ports.
- Produces: a clean branch whose generated artifacts and repository gates pass.

- [ ] **Step 1: Check fork boundaries**

```bash
rg -n --pcre2 '[\x{4E00}-\x{9FFF}]' clis skills src
rg -n '@jackwener/opencli|opencli trip|opencli-trip|Browser Bridge extension' clis/instagram clis/chatgpt clis/google clis/trip
```

Expected: both commands return no matches.

- [ ] **Step 2: Check generated command counts**

```bash
node -e "const m=require('./cli-manifest.json'); console.log(m.filter(x=>x.site==='google'&&x.name==='images').length, m.filter(x=>x.site==='trip').length)"
```

Expected: `1 12`.

- [ ] **Step 3: Run full tests**

```bash
npm test
```

Expected: all unit and adapter tests pass.

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck
```

Expected: exit code 0.

- [ ] **Step 5: Run a clean build**

```bash
npm run build
```

Expected: TypeScript compilation and manifest generation succeed.

- [ ] **Step 6: Inspect the final branch**

```bash
git diff --check origin/main...HEAD
git diff --stat origin/main...HEAD
git status --short --branch
```

Expected: no whitespace errors, only the spec, plan, four adapter ports, tests, and generated manifest; the worktree is clean.
