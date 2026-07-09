# Adapter Template

Use this after recon, endpoint verification, field decoding, output design, and strategy-note writing are complete.

## Create The File

For private iteration:

```bash
webcmd browser init <site>/<name> --strategy <strategy>
```

Write the working file at:

```text
~/.webcmd/clis/<site>/<name>.js
```

Copy it to the repo only when preparing a PR:

```text
clis/<site>/<name>.js
```

## Minimal Registry Shape

Adapters register commands with `cli` and `Strategy` from `@agentrhq/webcmd/registry`.

```js
import { cli, Strategy } from '@agentrhq/webcmd/registry';

cli({
  site: 'hackernews',
  name: 'top',
  access: 'read',
  description: 'Hacker News top stories',
  domain: 'news.ycombinator.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'limit', type: 'int', default: 20, help: 'Number of rows' },
  ],
  columns: ['rank', 'title', 'url', 'score', 'author', 'commentCount'],
  pipeline: [
    { navigate: 'https://news.ycombinator.com/' },
    {
      evaluate: `(async () => {
        const rows = [...document.querySelectorAll('.athing')].slice(0, \${{ args.limit }});
        return rows.map((row, index) => {
          const subtext = row.nextElementSibling;
          const titleLink = row.querySelector('.titleline a');
          return {
            rank: index + 1,
            title: titleLink?.textContent?.trim() || '',
            url: titleLink?.href || '',
            score: Number((subtext?.querySelector('.score')?.textContent || '').match(/\\d+/)?.[0] || 0),
            author: subtext?.querySelector('.hnuser')?.textContent?.trim() || '',
            commentCount: Number((subtext?.textContent || '').match(/(\\d+)\\s+comments?/)?.[1] || 0),
          };
        });
      })()`,
    },
    {
      map: {
        rank: '${{ item.rank }}',
        title: '${{ item.title }}',
        url: '${{ item.url }}',
        score: '${{ item.score }}',
        author: '${{ item.author }}',
        commentCount: '${{ item.commentCount }}',
      },
    },
    { limit: '${{ args.limit }}' },
  ],
});
```

Treat this as shape guidance, not a universal solution. Prefer the closest existing adapter for the same site or source type.

## Imports

Allowed imports:

```js
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import {
  ArgumentError,
  AuthRequiredError,
  CommandExecutionError,
  EmptyResultError,
  TimeoutError,
} from '@agentrhq/webcmd/errors';
```

Rules:

- Do not add third-party dependencies.
- Do not import private repo internals unless an established neighboring adapter already does so.
- Keep helpers local unless there is real duplication in the same site directory.

## Required Fields

| Field | Rule |
| --- | --- |
| `site` | Directory/site id. Keep lowercase and stable. |
| `name` | Command id. Keep lowercase and stable. |
| `access` | Usually `read`; use write-like access only for commands that mutate state. |
| `description` | One clear sentence. |
| `domain` | Primary domain for auth and help output. |
| `strategy` | Use a registry enum such as `Strategy.PUBLIC` or `Strategy.COOKIE`; align it with the strategy note. |
| `browser` | `false` for plain Node-side adapters; `true` when the adapter needs the page, cookie jar, or browser runtime. |
| `args` | Include type, default, and help for every external parameter. |
| `columns` | Must exactly match row keys, including order. |
| `pipeline` or `func` | Use the style already established by nearby adapters. |
| `siteSession` | `'persistent'` shares one tab per site across commands (multi-step flows); `'ephemeral'` gets a fresh isolated tab per run. Persistent tabs keep leftover DOM (modals, drawers) between commands — see "Persistent Sessions and State Hygiene" in docs/authoring.mdx. |
| `freshPage` | With `siteSession: 'persistent'`, set `true` to start the command on a newly created tab under the same lease: profile state (cookies, login, location) survives, stale DOM does not. Recommended for state-sensitive write commands such as checkout flows. |

## Strategy Enum Examples

The strategy note uses discovery names such as `PUBLIC_API` and `COOKIE_API`. The adapter declaration records the runtime choice with `Strategy` enum values.

Use `Strategy.PUBLIC` when an anonymous, stable endpoint can be fetched directly from Node:

```js
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';

cli({
  site: 'example',
  name: 'public-list',
  access: 'read',
  description: 'Example public listing',
  domain: 'api.example.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [{ name: 'limit', type: 'int', default: 20, help: 'Number of rows' }],
  columns: ['index', 'title', 'url'],
  func: async (args) => {
    const limit = Number(args.limit ?? 20);
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new ArgumentError('limit must be a positive integer');
    }

    const resp = await fetch(`https://api.example.com/items?limit=${limit}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!resp.ok) throw new CommandExecutionError(`example request failed: HTTP ${resp.status}`);

    const data = await resp.json();
    const items = Array.isArray(data?.items) ? data.items : [];
    if (!items.length) throw new EmptyResultError('example public-list', 'API returned no rows');

    return items.map((item, index) => ({
      index: index + 1,
      title: item.title,
      url: item.url,
    }));
  },
});
```

Use `Strategy.COOKIE` when the endpoint or HTML page needs the user's existing browser session. Read cookies with `page.getCookies()` and pass them to Node-side `fetch`; do not rely on `document.cookie` for HttpOnly auth cookies.

```js
import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@agentrhq/webcmd/errors';

const BASE = 'https://www.example.com';
const HOST = 'www.example.com';
const ROOT = '.example.com';

async function cookieHeader(page) {
  const seen = new Map();
  for (const opts of [{ domain: HOST }, { domain: ROOT }]) {
    for (const cookie of await page.getCookies(opts).catch(() => [])) {
      if (!seen.has(cookie.name)) seen.set(cookie.name, cookie.value);
    }
  }
  return [...seen].map(([name, value]) => `${name}=${value}`).join('; ');
}

function parseRowsFromHtml(html) {
  return [...html.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((match, index) => ({
    index: index + 1,
    title: match[2].trim(),
    time: '',
  }));
}

cli({
  site: 'example',
  name: 'private-list',
  access: 'read',
  description: 'Example private listing',
  domain: HOST,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [{ name: 'limit', type: 'int', default: 20, help: 'Number of rows' }],
  columns: ['index', 'title', 'time'],
  func: async (page, args) => {
    const limit = Number(args.limit ?? 20);
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new ArgumentError('limit must be a positive integer');
    }

    const cookie = await cookieHeader(page);
    const resp = await fetch(`${BASE}/inbox`, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        Referer: `${BASE}/`,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      redirect: 'follow',
    });
    if (!resp.ok) throw new CommandExecutionError(`example request failed: HTTP ${resp.status}`);

    const html = await resp.text();
    if (/login required|sign in/i.test(html)) throw new AuthRequiredError(HOST);

    const rows = parseRowsFromHtml(html).slice(0, limit);
    if (!rows.length) throw new EmptyResultError('example private-list', 'page returned no rows');
    return rows;
  },
});
```

## Parameter Safety

- Validate user-facing numbers before use.
- Throw `ArgumentError` for invalid external parameters.
- Do not silently clamp with `Math.max` / `Math.min` unless the user explicitly requested clamping and the output says so.
- Do not let a failed selector or missing field become a valid empty result.

## Row Safety

Before mapping rows:

- Confirm the response contains the expected shape.
- Throw `EmptyResultError` only when the site truly reports no results.
- Throw `CommandExecutionError` when the response shape is wrong, parsing fails, or an endpoint returns HTML instead of expected data.
- Use `AuthRequiredError` when login is required or session expired.
- Use `TimeoutError` when the page or endpoint did not settle in time.

## Column Alignment Checklist

Before verify:

```text
[ ] columns array and row keys match exactly
[ ] no intermediate object key overlaps a column accidentally
[ ] values use documented units
[ ] percentage scale is consistent
[ ] dates are ISO or clearly documented
[ ] URLs are absolute when users need to click them
[ ] one row was compared with the visible page
```

## Verify

Run:

```bash
webcmd browser verify <site>/<name> --trace retain-on-failure
```

After the first passing run, write a fixture:

```bash
webcmd browser verify <site>/<name> --write-fixture
```

Then tighten the fixture manually:

- Add `notEmpty` for essential columns.
- Add `patterns` for URL, ID, date, or slug formats.
- Set realistic `rowCount`.
- Keep `types` narrow.

Run verify again and confirm the fixture matches.
