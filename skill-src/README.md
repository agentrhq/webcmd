# Skill sources

Edit here. The installable copies live in [`skills/`](../skills/) and are
generated — do not hand-edit them.

```
skill-src/<skill-name>/SKILL.src.md   <- edit this, never installed
skills/<skill-name>/SKILL.md          <- generated, committed, installed
```

Sources carry internal notes and learnings that must not reach an installation.
[litprompt](https://github.com/tgvashworth/litprompt) strips them on the way out.

## Build

```bash
make install-tool   # go install github.com/tgvashworth/litprompt@latest
make build          # skill-src/**/*.src.md -> skills/**/*.md
make check          # imports resolve, no cycles, nothing written
make verify         # rebuild and fail if skills/ is stale or orphaned
make clean          # delete skills/ (it is fully machine-owned)
```

`skills/` **is committed**, so `webcmd skills add`, the Codex/Claude plugins,
and the npm package all work without a toolchain. CI runs `make verify` on
every push and PR.

## Author-only notes

Wrap anything that should not ship in an `<!-- @ ... -->` block. litprompt
deletes it at build time, so it costs zero context tokens and never lands in
anyone's install:

```markdown
Prefer an installed adapter over a live browser session.

<!-- @
TRIED: "always start in the browser to confirm the page" — agents then never
graduated to the adapter and burned a session on every run.
-->
```

This is where the accumulated learnings go: anti-practices, approaches that
were tried and rejected, why a rule is worded the way it is, links to the
conversation that produced it. Recording the failure is the point. Without it,
the next pass over the skill re-proposes the thing that already lost.

Each skill keeps a dated **Learnings log** inside an author-only block at the
bottom of its `SKILL.src.md`. Append to it whenever a correction lands.

Standard `<!-- ... -->` comments (no `@`) survive the build, so use those for
anything the agent *should* read.

Two gotchas, both verified:

- **Put the comment on its own line.** A trailing author-only comment at the end
  of a content line swallows the newline and joins that line to the next one.
  Mid-line and own-line are both safe.
- **Never write the closing `-` `-` `>` sequence inside a note**, not even quoted
  as an example. It closes the block early and leaks the rest into the output.

Author-only comments are stripped **inside fenced code blocks too**, which is
what makes them usable in template files: you can annotate a block the agent is
meant to copy verbatim, and the copy comes out clean.

## Why sources use the `.src.md` suffix

Skill installers discover skills by matching the literal filename `SKILL.md`,
walking the whole repo. They do not respect hidden directories, and there is no
ignore file. A source tree containing `SKILL.md` would therefore be discovered
as a second copy of every skill.

The `.src.md` suffix is what makes sources invisible to them. Keep it. CI
asserts that no file named `SKILL.md` exists inside `skill-src/`.

## Shared fragments

Text reused across skills goes in `skill-src/shared/` and is pulled in with an
import. The imported file's frontmatter is stripped; only the root file's is
kept:

```markdown
@[session-budget](../shared/session-budget.md)
```

## Reference files

References mirror the same way, so a skill's whole directory has one source:

```
skill-src/webcmd-browser/
  SKILL.src.md
  references/browser-run-playwright.src.md

skills/webcmd-browser/          <- generated
  SKILL.md
  references/browser-run-playwright.md
```

`SKILL.md` links to the `references/` path, since that is what the agent reads.

## Adding a skill

1. `mkdir -p skill-src/<skill-name>`
2. Write `skill-src/<skill-name>/SKILL.src.md` with frontmatter (`name`, `description`).
3. `make build` — every `*.src.md` under `skill-src/` is picked up automatically.
4. Commit the source and the generated output, and add the skill to the table in
   [`docs/skills.mdx`](../docs/skills.mdx) plus the expected list in
   [`scripts/check-codex-plugin.mjs`](../scripts/check-codex-plugin.mjs).
