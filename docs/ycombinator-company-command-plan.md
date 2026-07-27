# Y Combinator Company Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one anonymous, read-only `webcmd ycombinator company <slug-or-url>` command that turns a YC company profile into one structured row.

**Architecture:** Keep the existing `companies` search command unchanged and add a focused `plugins/ycombinator/company.js`. The new command uses YC's server-rendered `data-page` state through the existing browser runtime (`Strategy.UI`), validates the target host/path before navigation, and maps only public company fields.

**Tech Stack:** JavaScript ESM, WebCMD registry/errors, Node's built-in test runner, the existing Cloak browser runtime.

## Global Constraints

- Keep every YC adapter file under `plugins/ycombinator/`.
- Add no dependency or shared abstraction.
- Accept a company slug or full `https://www.ycombinator.com/companies/...` URL.
- Remain anonymous and read-only.
- Return exactly: `name`, `description`, `batch`, `status`, `location`, `founded`, `teamSize`, `website`, `founders`, `jobCount`, `url`.
- Use typed WebCMD errors for invalid input, blocking, missing profiles, and malformed page state.

---

### Task 1: Add and verify the company drill-down command

**Files:**
- Create: `plugins/ycombinator/company.js`
- Create: `plugins/ycombinator/company.test.js`
- Modify: `plugins/ycombinator/README.md`

**Interfaces:**
- Consumes: YC profile `data-page` JSON at `https://www.ycombinator.com/companies/<slug>`.
- Produces: registered command `ycombinator/company` and test exports `normalizeCompanyUrl` and `extractCompanyFromDocument`.

- [ ] **Step 1: Write the failing tests**

Use `node:test`, `node:assert/strict`, and the already-installed `jsdom`.
Dynamically import `./company.js`, then verify:

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

test('normalizes YC company slugs and URLs', async () => {
  const { __test__ } = await import('./company.js');
  assert.equal(
    __test__.normalizeCompanyUrl('fenrock-ai'),
    'https://www.ycombinator.com/companies/fenrock-ai',
  );
  assert.equal(
    __test__.normalizeCompanyUrl('https://www.ycombinator.com/companies/fenrock-ai'),
    'https://www.ycombinator.com/companies/fenrock-ai',
  );
  assert.throws(() => __test__.normalizeCompanyUrl('https://example.com/companies/fenrock-ai'));
});

test('extracts one company row from YC page state', async () => {
  const { __test__ } = await import('./company.js');
  const dom = new JSDOM('<div id="ycdc_new/pages/Companies/ShowPage-react-component-test"></div>');
  dom.window.document.querySelector('div').setAttribute('data-page', JSON.stringify({
    props: {
      company: {
        slug: 'fenrock-ai',
        name: 'Fenrock AI',
        long_description: 'We build AI agents for banks.',
        batch_name: 'Winter 2026',
        ycdc_status: 'Active',
        location: 'San Francisco',
        year_founded: 2026,
        team_size: 2,
        website: 'https://fenrock.ai/',
        founders: [{ full_name: 'Charu Sharma' }, { full_name: 'Michael M' }],
      },
      jobPostings: [{}, {}],
    },
  }));

  assert.deepEqual(__test__.extractCompanyFromDocument(dom.window.document).row, {
    name: 'Fenrock AI',
    description: 'We build AI agents for banks.',
    batch: 'Winter 2026',
    status: 'Active',
    location: 'San Francisco',
    founded: 2026,
    teamSize: 2,
    website: 'https://fenrock.ai/',
    founders: 'Charu Sharma, Michael M',
    jobCount: 2,
    url: 'https://www.ycombinator.com/companies/fenrock-ai',
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
node --test plugins/ycombinator/company.test.js
```

Expected: FAIL because `plugins/ycombinator/company.js` does not exist.

- [ ] **Step 3: Implement the minimum command**

In `company.js`:

```js
import {
  ArgumentError,
  AuthRequiredError,
  CommandExecutionError,
  EmptyResultError,
} from '@agentrhq/webcmd/errors';
import { cli, Strategy } from '@agentrhq/webcmd/registry';

const HOST = 'www.ycombinator.com';
const BASE_URL = `https://${HOST}`;
const COMPANY_PATH = /^\/companies\/([a-z0-9][a-z0-9-]*)\/?$/;

function normalizeCompanyUrl(raw) {
  const value = String(raw ?? '').trim();
  if (!value) throw new ArgumentError('company is required');

  let url;
  try {
    url = value.includes('://')
      ? new URL(value)
      : new URL(value.replace(/^\/+/, ''), `${BASE_URL}/companies/`);
  } catch {
    throw new ArgumentError('company must be a YC company slug or URL');
  }

  const match = url.pathname.match(COMPANY_PATH);
  if (url.protocol !== 'https:' || url.host !== HOST || !match) {
    throw new ArgumentError('company must be a YC company slug or URL');
  }
  return `${BASE_URL}/companies/${match[1]}`;
}

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function extractCompanyFromDocument(doc) {
  const bodyText = normalizeText(doc?.body?.textContent);
  const pageUrl = doc?.location?.href || BASE_URL;
  if (/captcha|verify you are human|access denied|request blocked/i.test(`${pageUrl} ${bodyText.slice(0, 2000)}`)) {
    return { blocked: true, notFound: false, malformed: false, row: null };
  }

  const root = doc.querySelector('[id^="ycdc_new/pages/Companies/ShowPage-react-component-"][data-page]');
  if (!root) {
    return {
      blocked: false,
      notFound: /not found|does not exist/i.test(bodyText),
      malformed: !/not found|does not exist/i.test(bodyText),
      row: null,
    };
  }

  let page;
  try {
    page = JSON.parse(root.getAttribute('data-page'));
  } catch {
    return { blocked: false, notFound: false, malformed: true, row: null };
  }

  const company = page?.props?.company;
  const slug = normalizeText(company?.slug);
  const name = normalizeText(company?.name);
  if (!company || !name || !COMPANY_PATH.test(`/companies/${slug}`)) {
    return { blocked: false, notFound: false, malformed: true, row: null };
  }

  return {
    blocked: false,
    notFound: false,
    malformed: false,
    row: {
      name,
      description: normalizeText(company.long_description || company.one_liner) || null,
      batch: normalizeText(company.batch_name) || null,
      status: normalizeText(company.ycdc_status) || null,
      location: normalizeText(company.location) || null,
      founded: Number.isInteger(company.year_founded) ? company.year_founded : null,
      teamSize: Number.isInteger(company.team_size) ? company.team_size : null,
      website: normalizeText(company.website) || null,
      founders: Array.isArray(company.founders)
        ? company.founders.map((founder) => normalizeText(founder?.full_name)).filter(Boolean).join(', ') || null
        : null,
      jobCount: Array.isArray(page.props.jobPostings) ? page.props.jobPostings.length : null,
      url: `${BASE_URL}/companies/${slug}`,
    },
  };
}

function buildExtractScript() {
  return `(() => {
    const BASE_URL = ${JSON.stringify(BASE_URL)};
    const COMPANY_PATH = ${COMPANY_PATH.toString()};
    const normalizeText = ${normalizeText.toString()};
    const extractCompanyFromDocument = ${extractCompanyFromDocument.toString()};
    return extractCompanyFromDocument(document);
  })()`;
}

cli({
  site: 'ycombinator',
  name: 'company',
  access: 'read',
  description: 'Read a public Y Combinator company profile',
  domain: 'www.ycombinator.com',
  strategy: Strategy.UI,
  navigateBefore: false,
  args: [{ name: 'company', positional: true, required: true, help: 'YC company slug or full company URL' }],
  columns: ['name', 'description', 'batch', 'status', 'location', 'founded', 'teamSize', 'website', 'founders', 'jobCount', 'url'],
  func: async (page, args) => {
    const url = normalizeCompanyUrl(args.company);
    await page.goto(url, { waitUntil: 'load', settleMs: 500 });
    const result = await page.evaluate(buildExtractScript());
    if (result?.blocked) throw new AuthRequiredError(HOST, 'Y Combinator blocked anonymous company access.');
    if (result?.notFound) throw new EmptyResultError('ycombinator company', `No public YC company found at ${url}`);
    if (!result || result.malformed || !result.row) {
      throw new CommandExecutionError('Y Combinator company page returned malformed profile state');
    }
    return [result.row];
  },
});

export const __test__ = { normalizeCompanyUrl, extractCompanyFromDocument };
```

Use `ArgumentError`, `AuthRequiredError`, `EmptyResultError`, and `CommandExecutionError`; do not return sentinel rows or silently accept another host/path.

- [ ] **Step 4: Run the test and verify GREEN**

Run:

```bash
node --test plugins/ycombinator/company.test.js
```

Expected: 2 tests pass.

- [ ] **Step 5: Document command discovery and usage**

Add `company <slug-or-url>` to the plugin README command table and this example:

```bash
webcmd ycombinator company fenrock-ai
```

- [ ] **Step 6: Run repository and plugin verification**

Run:

```bash
npm run sync-community-plugins
npm test
npm run build
git diff --check
```

Then install the worktree plugin locally, confirm `webcmd ycombinator --help` lists both commands, and run:

```bash
webcmd ycombinator company fenrock-ai -f json --trace on --keep-tab true --window foreground
```

Compare `name`, `batch`, `status`, `teamSize`, `founders`, and `jobCount` with the visible YC page. Run `webcmd browser verify ycombinator/company --write-fixture`, tighten the generated fixture, and run verify again.

- [ ] **Step 7: Commit**

```bash
git add plugins/ycombinator docs/ycombinator-company-command-plan.md
git commit -m "feat(plugin): add ycombinator company profiles"
```
