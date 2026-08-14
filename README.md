<img width="1280" height="640" alt="Webcmd — stop paying agents to rediscover the web" src="docs/readme-hero.png" />


<p align="center">
  <a href="https://www.npmjs.com/package/@agentrhq/webcmd">
    <img alt="NPM version" src="https://img.shields.io/npm/v/@agentrhq/webcmd.svg?style=for-the-badge&color=1E88E5&labelColor=000000">
  </a>
  <a href="https://webcmd.dev/docs">
    <img alt="Documentation" src="https://img.shields.io/badge/docs-webcmd.dev-7C3AED.svg?style=for-the-badge&labelColor=000000">
  </a>
  <a href="https://github.com/agentrhq/webcmd/blob/main/LICENSE">
    <img alt="License" src="https://img.shields.io/badge/license-Apache%202.0-1E88E5.svg?style=for-the-badge&labelColor=000000">
  </a>
  <a href="https://discord.gg/9YP2C9tvMp">
    <img alt="Join the community on Discord" src="https://img.shields.io/badge/Join%20the%20community-5865F2.svg?style=for-the-badge&logo=discord&logoColor=white&labelColor=000000&logoWidth=20">
  </a>
  <a href="https://x.com/agentrhq">
    <img alt="Follow AgentR on X" src="https://img.shields.io/badge/Built%20by%20%40agentrhq-000000.svg?style=for-the-badge&logo=x&logoColor=white&labelColor=000000&logoWidth=20">
  </a>
</p>

# Webcmd

**Self-learning browser infra for AI agents.**

Webcmd learns the navigational context of websites as agents use them, then compiles that knowledge into deterministic commands for faster, cheaper, more reliable browser automation. The goal is simple: stop making agents rediscover the same sites on every run and cut browser-agent token spend by up to 90%.

On top of live browser control, Webcmd adds 3 layers of learnings. Each layer collapses cost and variance for the layer above it.

| Layer | Scenario | What Webcmd Helps With |
| --- | --- | --- |
| 0. Live browser control | The site is unfamiliar. | Use `webcmd browser` to inspect, click, type, extract, capture network calls, and complete the task in a real browser. |
| 1. Sitemap memory | The site is familiar, but the action space is not fully known. | Capture an agent-facing sitemap of observed pages, states, actions, workflows, APIs, pitfalls, and fallback paths. |
| 2. CLI authoring | The action space is known, but the path is still too variable for one fixed sequence. | Explicitly author a reusable `webcmd <site>` adapter with structured output, so future agents spend tokens on the task instead of navigation. |
| 3. Extend existing CLIs | The workflow is deterministic enough to stop browsing. | Extend the `webcmd <site>` adapter with a tailored command so the workflow runs instantly with the least amount of tokens. |

For local, multi-step browser exploration, agents can send one sandboxed
Playwright-style program to an explicit browser session:

```bash
webcmd session create -f json
webcmd --session session_abc browser run --file explore.js
printf 'return await page.title();' \
  | webcmd --session session_abc browser run --stdin
webcmd session close session_abc
```

Profiles are cookie jars; Sessions are independent browser windows within a
profile, so parallel agents should create separate Sessions. Adapter commands
use an adapter-default Session unless `--session` intentionally routes them to
an explicit one.

## Demo

https://github.com/user-attachments/assets/04eceadc-d398-4303-984d-ae3197bfa664

## Quick Start

### Agent prompt

```text
Fetch and follow https://raw.githubusercontent.com/agentrhq/webcmd/main/start.md to set up Webcmd end to end.
```

### Manual

Webcmd requires Node.js 20.6+.

```bash
npm install -g @agentrhq/webcmd
```

The npm package ships the Webcmd core and browser commands, but no site
adapters. Search the plugin catalog and explicitly install the adapter you
need:

```bash
webcmd plugin search <site> -f json
webcmd plugin install <installSource-from-search>
```

```bash
webcmd skills add
```

When prompted, choose Claude, Codex, another supported harness, or a custom
skills path.

In your agent harness, load or tag `webcmd-usage`, then describe the outcome you want.

```text
Use webcmd to research the latest discussions about browser automation across Hacker News and Reddit, then return a concise comparison with source links.
```

## What You Can Ask

- “Use webcmd to research agentic browser automation on PubMed and return the title, authors, publication date, abstract, and URL for each result.”
- “Use webcmd to find active AI infrastructure companies in the YC company directory and return the company, batch, description, location, profile URL, and source links. Keep it read-only.”
- “Use webcmd to look up parts on Grainger by part number and return price, stock, minimum order quantity, lead time, and product URL.”
- “Use webcmd with my logged-in `work` profile to summarize unread LinkedIn messages from the last seven days and return the sender, subject or opening text, received time, and conversation URL.”
- “Repair `webcmd reddit popular --limit 10` and keep returning the title, subreddit, score, comment count, and URL.”
- “Use webcmd to check Grainger part prices and SAP Ariba purchase-order status, then return a combined summary.”

## See It in Action: X → CLI

```text
Use webcmd with my logged-in `social` profile to collect my recent X bookmarks and return the author, text, and URL.
```

The agent explores the X workflow once using the logged-in profile.
It creates a stable command that returns the requested bookmark fields.
Later agents reuse that command instead of repeating browser exploration; learn the pattern in [X → CLI](https://webcmd.dev/docs/x-session-cli).

## Where Webcmd Works

Beyond website adapters, Webcmd can work through authenticated browser sessions, APIs, desktop apps, and local tools.

| Group | Supported surfaces | Representative outcomes |
| --- | --- | --- |
| research and communities | Hacker News, Reddit, PubMed | Compare current discussions, find primary research, and return concise summaries with source links. |
| social and professional | X/Twitter, LinkedIn, TikTok | Collect bookmarks, monitor public posts, or research people and creators with a named profile when needed. |
| AI tools | ChatGPT, Claude, Gemini, NotebookLM | Retrieve conversations, research outputs, notebooks, and generated materials from the tools you already use. |
| shopping and bookings | Amazon, Blinkit, Zepto, BigBasket, District, Practo | Compare products, availability, prices, appointments, events, and delivery options. |

This list is illustrative; availability comes from installed plugins. Ask your
agent to search and install the relevant plugin when a site is not installed.

## Learn More

Webcmd Cloud can run supported commands and browser sessions on hosted infrastructure. It is in active development and is not yet stable.

- [Prompt Cookbook](https://webcmd.dev/docs/agent-prompts)
- [How Webcmd Works](https://webcmd.dev/docs/concepts)
- [Local or Cloud](https://webcmd.dev/docs/local-or-cloud)
- [Publish a Community Plugin](https://webcmd.dev/docs/publish-community-plugin)
- [X → CLI](https://webcmd.dev/docs/x-session-cli)
- [Command Surface](https://webcmd.dev/docs/cli-reference)

## Community

<!-- webcmd-community-plugins:start -->
### Community plugins

| Plugin | Description | Author |
| --- | --- | --- |
| [`omnisearch`](./plugins/omnisearch/) | No-login research across Hacker News, Stack Overflow, GitHub, arXiv, Dev.to, Lobsters, and Bluesky | [Rishet Mehra](https://github.com/Rishet11) |
| [`pypi`](./plugins/pypi/) | Inspect public Python package metadata, downloads, and releases from PyPI | [Kemal Kaya](https://github.com/yoldaolmak) |
| [`skyscanner`](./plugins/skyscanner/) | Skyscanner flight search commands for Webcmd | [Rishabh](https://github.com/rishabhraj36) |
<!-- webcmd-community-plugins:end -->

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

Released under the terms in [`LICENSE`](./LICENSE).
