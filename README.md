<img width="1280" height="640" alt="Webcmd — stop paying agents to rediscover the web" src="docs/readme-hero.png" />


<p align="center">
  <a href="https://www.npmjs.com/package/@agentrhq/webcmd">
    <img alt="NPM version" src="https://img.shields.io/npm/v/@agentrhq/webcmd.svg?style=for-the-badge&color=1E88E5&labelColor=000000">
  </a>
  <a href="https://www.npmjs.com/package/@agentrhq/webcmd">
    <img alt="NPM downloads" src="https://img.shields.io/npm/dt/@agentrhq/webcmd.svg?style=for-the-badge&color=1E88E5&labelColor=000000">
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

WebCMD learns the navigational context of websites as agents use them, then compiles that knowledge into deterministic commands for faster, cheaper, more reliable browser automation. The goal is simple: stop making agents rediscover the same sites on every run and cut browser-agent token spend by up to 90%.

On top of live browser control, WebCMD adds 3 layers of learnings. Each layer collapses cost and variance for the layer above it.

| Layer | Scenario | What Webcmd Helps With |
| --- | --- | --- |
| 1. Live browser control | The site is unfamiliar. | Use `webcmd browser` to inspect, click, type, extract, capture network calls, and complete the task in a real browser. |
| 2. Sitemap memory | The site is familiar, but the action space is not fully known. | Capture an agent-facing sitemap of observed pages, states, actions, workflows, APIs, pitfalls, and fallback paths. |
| 3. CLI authoring | The action space is known, but the path is still too variable for one fixed sequence. | Explicitly author a reusable `webcmd <site>` adapter with structured output, so future agents spend tokens on the task instead of navigation. |
| 4. Extend existing CLIs | The workflow is deterministic enough to stop browsing. | Extend the `webcmd <site>` adapter with a tailored command so the workflow runs instantly with the least amount of tokens. |

## Demo

https://github.com/user-attachments/assets/04eceadc-d398-4303-984d-ae3197bfa664

## Quick Start

Webcmd requires Node.js 20+.

```bash
npm install -g @agentrhq/webcmd
webcmd skills add
```

When prompted, choose a supported harness such as Codex or Claude, or enter a custom skills path.

In your agent harness, load or tag `webcmd-usage`, then describe the outcome you want.

```text
Use the webcmd-usage skill to find the best way to research the latest discussions about browser automation across Hacker News and Reddit. Reuse existing adapters where possible and return a concise comparison with source links.
```

## What You Can Ask

- “Use `webcmd-usage` to find an existing PubMed adapter, research agentic browser automation, and return the title, authors, publication date, abstract, and URL for each result.”
- “Explore the YC company directory, find active AI infrastructure companies, keep the work read-only, and return company, batch, description, location, profile URL, and source links.”
- “Create a reusable Webcmd CLI for Grainger part lookup by part number that returns price, stock, minimum order quantity, lead time, and product URL.”
- “Use my logged-in `work` profile to summarize unread LinkedIn messages from the last seven days, return sender, subject or opening text, received time, and conversation URL, pause for sign-in, and never store credentials.”
- “Repair `webcmd reddit popular --limit 10`, preserve title, subreddit, score, comment count, and URL, then verify and explain the fix.”
- “Package Grainger part lookup and SAP Ariba purchase-order status into `webcmd-procurement`, run checks, and prepare a community PR without merging or publishing it.”

## See It in Action: X → CLI

```text
Use my logged-in `social` profile to collect my recent X bookmarks, then turn the successful workflow into a reusable Webcmd command that returns author, text, and URL. Verify it before finishing.
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

This list is illustrative; agents can use `webcmd-usage` to discover the current surface.

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
| [`skyscanner`](./plugins/skyscanner/) | Skyscanner flight search commands for Webcmd | [Rishabh](https://github.com/rishabhraj36) |
<!-- webcmd-community-plugins:end -->

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

Released under the terms in [`LICENSE`](./LICENSE).
