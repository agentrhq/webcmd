# Set Up Webcmd

Install Webcmd and verify that it runs end to end.

## 1. Choose the target

Inspect the current environment and ask only for missing information:

- Install globally (recommended) or into a project package?
- Which agent harness is in use: opencode, claude, codex, hermes, cursor, or another? Each has a per-agent guide under `docs/agents/`.

If the user already chose a path, location, name, or harness, treat that as binding.

## 2. Set up the package

For a global install:

```bash
npm install -g @agentrhq/webcmd
webcmd doctor
```

For a project install, run the equivalent commands with the project's package manager (npm, pnpm, yarn, bun).

`webcmd doctor` must be green before browser commands will work. Fix only the setup issue `doctor` reports; do not proceed until it passes.

## 3. Read installed guidance

Install the Webcmd skills for your harness:

```bash
webcmd skills add
```

When prompted, choose the provider that matches your agent. Then read the repo-level skill that was copied into the project before creating or editing browser automation. Use whichever path exists:

```text
.agents/skills/webcmd-usage/SKILL.md
.claude/skills/webcmd-usage/SKILL.md
.codex/skills/webcmd-usage/SKILL.md
```

If none of those paths exist because the project has no `.agents/`, `.claude/`, or `.codex/` directory, create the appropriate agent directory and rerun `webcmd skills add`. Follow the per-agent guide under `docs/agents/` for harness-specific configuration, including disabling the agent's native browser tools.

## 4. Verify

For this smoke check, copy the program below directly; do not inspect additional references unless validation fails. Run it against a real page:

```bash
webcmd browser work run --stdin <<'JS'
await page.goto('https://example.com');
return { title: await page.title(), url: page.url() };
JS
```

Then release the session:

```bash
webcmd browser work close
```

The run must return the page title and URL.

## 5. Finish

After verifying Webcmd is set up and working properly, summarize the steps you took and offer some sample browser automations you could build next, such as:

- Research a topic across a site and return a concise comparison with source links.
- Collect bookmarks, messages, or profile data using a logged-in profile.
- Check product prices, availability, or delivery options.
- Turn a proven browser workflow into a reusable `webcmd <site>` command.

## Important Instructions and Constraints to be Successful

- Fix only setup-related failures.
- Do not make unrelated changes or invent secrets.
- Adapter first, browser second: before opening a raw browser session, check `webcmd list -f json` for an adapter that covers the task. Use raw `webcmd browser` only when no adapter exists.
- Never ask for or type passwords, OTPs, cookies, credentials, or session secrets. Use Webcmd's human handoff for login walls.
