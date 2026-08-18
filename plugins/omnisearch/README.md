# 🔎 OmniSearch

**OmniSearch is a research assistant that reads the internet for you.**

Ask it what people on **Hacker News, Stack Overflow, GitHub, arXiv, Dev.to, Lobsters, and Bluesky** are saying, asking, and publishing — and it brings back a clear answer with links.

**You never need to touch the command line.** This tool is for your AI agent (Claude Code, Codex, Cursor, ChatGPT), not for you. Just tell your agent what you want to learn, and it handles the rest.

---

## How to use OmniSearch (no coding needed)

There are three steps — and you only do the first one yourself.

**Step 1 — Install once (5 minutes).** You add OmniSearch to your AI assistant, like installing an app once. Your agent runs this for you:

```
webcmd plugin install github:agentrhq/webcmd/omnisearch
```

**Step 2 — Tell your agent what you want to know.**

You don't type commands. You just talk. Say something like:

> "Before I build this, find out what people actually think about it."

Your agent recognizes OmniSearch and runs it for you.

**Step 3 — Read the answer.**

You get a plain-language summary — what people say, where they say it, and links to the actual posts. No folders, no files, nothing to interpret.

---

## What you say. What your agent does.

Here are real conversations, ready to copy-paste. Swap the words in **{braces}** for your topic.

| You say | What your agent finds |
|---|---|
| "**{My idea}** — do people actually want this?" | What people say across Hacker News, GitHub, and developer communities |
| "Find what people complain about when using **{a tool}**." | The real problems people report on Stack Overflow and GitHub |
| "Is **{this idea}** already done? Who's winning?" | The competition and reception across platforms |
| "Is **{this idea}** even technically possible yet?" | What research says is proven vs. still speculative |
| "Before I launch **{product}**, what could kill it?" | The risks, past failures, and strongest arguments for it |
| "What's the reaction to **{a product / a launch / the news}**?" | What people are saying on Hacker News, Lobsters, and Bluesky right now |

### Ready-to-paste prompts for your agent

Pick one, replace **{the brackets}**, and paste it to your agent:

1. "Research **{topic/competitor/product}**. Use OmniSearch to check Hacker News, Stack Overflow, GitHub, arXiv, Dev.to, and Lobsters. Give me a two-paragraph summary and the 5 most-talked-about results with links."

2. "Find what's broken or frustrating about **{topic}**. Look at Stack Overflow questions and GitHub issues, and list the 10 most common problems people mention, each with a source link."

3. "Check if **{my idea}** is technically realistic yet. Scan recent research papers and tech discussions, and tell me what's proven to work vs. still speculative."

4. "Validate my idea: **{one-line pitch}**. Gather what people are saying about it, rate how much real interest there is, and quote 3 real people with links."

5. "Do a pre-mortem on **{my startup/product}**. Find how similar things failed before, the top 3 reasons this could fail, and the strongest argument it could succeed — each with a source."

6. "What do developers complain about when using **{a tool/language}**? Summarize the biggest recurring pain points with links."

7. "Check the reaction to **{a new release / launch}**. What are people on Hacker News, Lobsters, and Bluesky saying right now?"

---

## What you can research

OmniSearch reads **7 public sources** without requiring an account:

| Platform | Best at telling you |
|---|---|
| **Hacker News** 🟠 | what the tech world thinks |
| **Stack Overflow** 📚 | what's actually broken |
| **GitHub** 🐙 | real problems people file |
| **Dev.to** 💜 | what developers are writing |
| **arXiv** 📄 | the latest research |
| **Lobsters** 🦞 | smart developer discussion |
| **Bluesky** 🦋 | fresh public posts |

**No login is needed.** Each command uses a public API or feed.

---

## Start now

**Install OmniSearch once, then ask your agent:**

> *"Before I build this, find out what people actually think about it."*

That's the whole product.

---

## For developers

Everything below is for the agent (and for people who want to dig in). A normal user never reads this.

### The commands

```bash
# Aggregate everything about a topic
webcmd omnisearch research "<topic>" -f json

# 🏆 The community's verdict, distilled
webcmd omnisearch verdict "<topic>" -f json

# One source at a time
webcmd omnisearch hackermind "<q>" -f json
webcmd omnisearch stackoverflow "<q>" -f json
webcmd omnisearch github "<q>" -f json
webcmd omnisearch arxiv "<q>" -f json
webcmd omnisearch research <tag> --sources devto -f json
webcmd omnisearch lobsters -f json
webcmd omnisearch bluesky-posts <handle> -f json

```

### Output

The research and source-search commands return `platform`, `title`, `author`, `score`, `commentCount`, `createdAt`, `url`, and `text`. Feed commands expose source-specific fields.

### How it works

The aggregated research sources live in `sources.js` behind one signature (`search(query, limit)`).

Ships `SKILL.md` so agent harnesses auto-discover OmniSearch.
