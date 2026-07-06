# JSDOM Fixture Pattern

Use this when a browser adapter extracts DOM inside `page.evaluate` and a mocked-evaluate unit test is too weak to catch silent parser bugs.

## When To Use

Use a JSDOM fixture when:

- DOM parsing is complex.
- The page mixes repeated labels, counts, or nested cards.
- A previous bug passed verify but extracted the wrong value.
- The parser depends on sibling relationships or scoped selectors.

Do not add JSDOM fixtures for simple JSON adapters.

## Fixture Location

Commit intentional review fixtures under:

```text
clis/<site>/__fixtures__/<command>.html
```

Temporary debug dumps still belong only in:

```text
~/.webcmd/sites/<site>/fixtures/
/tmp/
```

## Five-Step Workflow

### 1. Capture Minimal HTML

Use the browser to capture the specific DOM region, not the entire page.

```bash
webcmd browser eval "document.querySelector('<root-selector>')?.outerHTML"
```

Save only the required HTML for the parser.

### 2. Tighten Blank Lines

Run the mandatory blank-line tightening before committing:

```bash
awk 'NF>0' clis/<site>/__fixtures__/<command>.html > /tmp/<command>.html
mv /tmp/<command>.html clis/<site>/__fixtures__/<command>.html
```

This prevents fixture bloat and makes diffs readable.

### 3. Extract Parser Logic

Move DOM parsing into a helper that can run both in `page.evaluate` and in JSDOM.

Keep helper input explicit:

```js
export function parseCards(root) {
  return [...root.querySelectorAll('[data-testid="card"]')].map((card) => ({
    title: card.querySelector('a')?.textContent?.trim() || '',
  }));
}
```

### 4. Add JSDOM Test

```js
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { parseCards } from './parse.js';

describe('parseCards', () => {
  it('extracts scoped card values from fixture HTML', () => {
    const html = fs.readFileSync(path.join(import.meta.dirname, '__fixtures__/search.html'), 'utf8');
    const dom = new JSDOM(html);

    expect(parseCards(dom.window.document)).toMatchObject([
      { title: 'Expected first title' },
    ]);
  });
});
```

### 5. Reverse-Validate

Temporarily break the parser and confirm the test fails for the intended reason. Then restore the correct parser and confirm it passes.

This proves the test is guarding the real bug rather than only exercising code.

## Scoped Selector Rule

Every selector inside a repeated component must be scoped to that component root.

Bad:

```js
document.querySelector('[data-testid="like"]')
```

Good:

```js
card.querySelector('[data-testid="like"]')
```

If a partial fixture represents a reusable component, write its scope root at the top of the fixture or test.

## Common Bugs This Catches

- Page-level first match selects the first card instead of the target card.
- Head text from adjacent elements fuses numbers into a wrong count.
- Locale-specific labels disappear or change.
- Hidden template content is parsed as visible content.
- A missing selector silently becomes an empty string.

## Review Bar

Committed JSDOM fixtures are not temporary dumps. They are review artifacts. Keep them:

- minimal
- readable
- free of private data
- blank-line tightened
- paired with reverse-validation
