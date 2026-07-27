# TechCrunch Search and Article Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `techcrunch latest` with a dual-mode `search` command and add public article reading.

**Architecture:** Both commands call TechCrunch's anonymous WordPress REST API and map JSON responses into WebCMD rows. Shared parsing and request code lives in a private `lib/` module so the plugin loader exposes only `search` and `article`.

**Tech Stack:** JavaScript ESM, WebCMD registry and typed errors, Node's built-in test runner, native `fetch`, TechCrunch WordPress REST API.

## Global Constraints

- Keep all adapter files under `plugins/techcrunch/`.
- Use `Strategy.PUBLIC`; require no browser and no login.
- Add no dependency.
- `search` accepts either a query or `--latest`, never both.
- `--limit` accepts integers from 1 through 50 and defaults to 20.
- `article` accepts only TechCrunch HTTP(S) article URLs.

---

### Task 1: Shared parser and search command

**Files:**
- Create: `plugins/techcrunch/lib/api.js`
- Create: `plugins/techcrunch/search.js`
- Create: `plugins/techcrunch/test/techcrunch.test.js`
- Delete: `plugins/techcrunch/latest.js`

**Interfaces:**
- Produces: `parseLimit(raw)`, `plainText(html)`, `fetchPosts(params, request)`, and `postSummary(post, rank)` from `lib/api.js`.
- Produces: `searchTechCrunch(args, request)` from `search.js`.

- [ ] **Step 1: Write failing search tests**

Add Node tests asserting:

```js
await assert.rejects(() => searchTechCrunch({}, request), /query or --latest/);
await assert.rejects(
    () => searchTechCrunch({ query: 'AI', latest: true }, request),
    /cannot be combined/,
);
const rows = await searchTechCrunch({ query: 'AI', limit: 1 }, request);
assert.deepEqual(rows[0], {
    rank: 1,
    title: 'AI story',
    author: 'Reporter',
    publishedAt: '2026-07-27T00:00:00',
    description: 'Summary',
    url: 'https://techcrunch.com/2026/07/27/ai-story/',
});
assert.match(request.calls[0], /search=AI/);
assert.match(request.calls[0], /orderby=relevance/);
```

Also assert that `--latest` emits `orderby=date` without a `search` parameter
and that invalid limits are rejected.

- [ ] **Step 2: Run the search tests and verify RED**

Run:

```bash
node --test plugins/techcrunch/test/techcrunch.test.js
```

Expected: FAIL because `search.js` does not exist.

- [ ] **Step 3: Implement the minimum search path**

Create the shared helpers and register:

```js
cli({
    site: 'techcrunch',
    name: 'search',
    access: 'read',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'query', positional: true, required: false, type: 'string' },
        { name: 'latest', type: 'boolean', default: false },
        { name: 'limit', type: 'int', default: 20 },
    ],
    func: searchTechCrunch,
});
```

Use `https://techcrunch.com/wp-json/wp/v2/posts`, `orderby=relevance` for a
query, and `orderby=date&order=desc` for `--latest`. Remove `latest.js`.

- [ ] **Step 4: Run the search tests and verify GREEN**

Run:

```bash
node --test plugins/techcrunch/test/techcrunch.test.js
```

Expected: all search tests pass.

- [ ] **Step 5: Commit the search command**

```bash
git add plugins/techcrunch
git commit -m "feat(techcrunch): replace latest with search"
```

### Task 2: Article command, metadata, and documentation

**Files:**
- Create: `plugins/techcrunch/article.js`
- Modify: `plugins/techcrunch/test/techcrunch.test.js`
- Modify: `plugins/techcrunch/README.md`
- Modify: `plugins/techcrunch/package.json`
- Modify: `plugins/techcrunch/webcmd-plugin.json`
- Modify: `README.md` (generated community-plugin catalog)
- Modify: `webcmd-plugin.json` (generated community-plugin manifest)

**Interfaces:**
- Consumes: `plainText(html)` and `fetchPosts(params, request)` from `lib/api.js`.
- Produces: `articleTechCrunch(args, request)` from `article.js`.

- [ ] **Step 1: Write failing article tests**

Add Node tests asserting:

```js
await assert.rejects(
    () => articleTechCrunch({ url: 'https://example.com/story' }, request),
    /TechCrunch article URL/,
);
const rows = await articleTechCrunch({
    url: 'https://techcrunch.com/2026/07/27/ai-story/',
}, request);
assert.equal(rows[0].title, 'AI story');
assert.equal(rows[0].author, 'Reporter');
assert.deepEqual(rows[0].categories, ['AI', 'Startups']);
assert.equal(rows[0].content, 'First paragraph.\n\nSecond paragraph.');
assert.match(request.calls[0], /slug=ai-story/);
```

Also assert an empty API result raises `EmptyResultError`.

- [ ] **Step 2: Run the article tests and verify RED**

Run:

```bash
node --test plugins/techcrunch/test/techcrunch.test.js
```

Expected: FAIL because `article.js` does not exist.

- [ ] **Step 3: Implement the minimum article path**

Validate the URL with `URL`, accept only `techcrunch.com` and
`www.techcrunch.com`, fetch one post by slug, derive categories from the
`NewsArticle.articleSection` schema field, and convert the returned article
HTML into readable plain text with paragraph breaks.

- [ ] **Step 4: Run article tests and verify GREEN**

Run:

```bash
node --test plugins/techcrunch/test/techcrunch.test.js
```

Expected: all TechCrunch tests pass.

- [ ] **Step 5: Sync and verify the plugin**

Run:

```bash
npm run sync-community-plugins
npm run check-community-plugins
node --test plugins/techcrunch/test/techcrunch.test.js
npm test
npm run build
webcmd techcrunch --help
webcmd techcrunch search --latest --limit 2 -f json
webcmd techcrunch search "artificial intelligence" --limit 2 -f json
webcmd techcrunch article "https://techcrunch.com/2026/07/26/are-brain-waves-the-next-unlock-for-physical-ai/" -f json
```

Expected: checks pass; help lists only `article` and `search`; live commands
return readable rows.

- [ ] **Step 6: Commit the completed plugin**

```bash
git add plugins/techcrunch README.md webcmd-plugin.json
git commit -m "feat(techcrunch): add article reader"
```
