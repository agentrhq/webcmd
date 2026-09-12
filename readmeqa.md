# 🕵️ VibeQA — The QA Agent for Vibe-Coded Apps

**Built for the webcmd Hackathon — Browser Agents Theme**

> An AI agent that clicks every button and link on your site, tells you which ones are silently broken, suggests a fix, and gets faster and cheaper every time it runs — thanks to [webcmd](https://webcmd.dev)'s self-learning browser infrastructure.

---

## 🎯 Problem Statement

AI has made it trivially easy to "vibe code" a working app in an afternoon. But speed comes at a cost: these apps are full of buttons, links, and forms that **look interactive but silently do nothing** when clicked. No error, no feedback — just a dead end for the user.

- Manually clicking every element on every page to check this is tedious and nobody does it.
- Traditional QA scripts can tell you if a page loads or a link 404s — but they can't tell you a button is *silently* non-functional.
- Generic browser agents can catch this, but they re-explore the same site from scratch on every single run, burning tokens and time on navigation they've already figured out.

## 💡 Why This, Why Now

We wanted an agent that does two things at once:
1. **Reasons** about which elements on a page are suspicious (not just pattern-matches a fixed selector list).
2. **Remembers** what it learns about a site, so a second QA pass is dramatically faster and cheaper than the first — instead of paying full exploration cost every time.

That second part is exactly what webcmd is built for: turn one-time browser exploration into durable, reusable site memory.

## 🛠️ How We Solve It

VibeQA is a browser agent that:

1. **Loads the target site** and pulls any existing `webcmd site memory` for it — instant context on repeat runs, zero context on the first.
2. **Inspects every clickable element** (buttons, links, `role=button`, form controls) using a live browser snapshot.
3. **Clicks each one and watches for a real effect**: DOM change, URL change, a network request firing, a dialog appearing, or a new tab opening.
4. **Flags anything with zero effect as "dead"** and generates a plain-English suggested fix (e.g. missing `on_click` handler, placeholder `href="#"`).
5. **Never auto-clicks anything dangerous** — buttons labeled delete / buy / pay / subscribe / logout / confirm are skipped and listed separately for human review.
6. **Stops and asks for explicit human approval** before any payment, submission, message, or destructive action — a hard rule of this build, not an afterthought.
7. **Writes what it learned back to webcmd's site memory**, so the next QA pass on the same app skips re-exploration and runs faster and cheaper.

## 🧠 Architecture

```
┌─────────────────┐      ┌──────────────────┐      ┌────────────────────┐
│   Target site     │ <── │   webcmd browser   │ <── │   Coding agent       │
│ (Streamlit / any  │     │   (live Chrome via  │     │   (Claude Code +     │
│  public web app)   │ ──>│    CloakBrowser)     │ ──>│   webcmd-browser     │
└─────────────────┘      └──────────────────┘      │   skill, reasoning   │
                                   │                   │   about the page)   │
                                   ▼                   └────────────────────┘
                          ┌──────────────────┐
                          │  webcmd site       │
                          │  memory (learned    │
                          │  navigation, dead    │
                          │  clicks, fixes)      │
                          └──────────────────┘
```

- **First run**: agent explores the page live, reasons about which elements look off, clicks and evaluates each candidate. Slower, costs more tokens.
- **Every run after**: webcmd already knows the site's structure and prior findings. The same QA sweep is near-instant and near-free — no relearning.

## 📦 Tech Stack

| Layer | Tool |
|---|---|
| Browser control & memory | [webcmd](https://webcmd.dev) (`@agentrhq/webcmd`) |
| Live browser engine | CloakBrowser (stealth Chromium, bundled with webcmd) |
| Agent reasoning | Claude Code + the `webcmd-browser` skill |
| Fallback / prototyping | Python + Playwright |

## 🚀 Setup

```bash
# 1. Install webcmd
npm install -g @agentrhq/webcmd

# 2. Verify the browser bridge (needs a real display on your machine)
webcmd doctor

# 3. Wire the webcmd-browser skill into your coding agent
webcmd skills add

# 4. Create a profile + session
webcmd profile create qa
webcmd --profile qa session create qa-session
```

## ▶️ Usage

Give your coding agent (e.g. Claude Code) a task like:

```
Use webcmd to QA-test https://your-app.streamlit.app.
Find every button and link, click each one, and tell me which ones do
nothing (no DOM change, no navigation, no network request).
Skip anything that looks like delete/buy/pay/subscribe/logout — list
those separately and ask me before touching them.
Give me a markdown report at the end.
```

Or, for a standalone Python/Playwright fallback (no live agent reasoning, fixed heuristics):

```bash
python qa_tester.py --url https://your-app.streamlit.app
```

Flags: `--headless`, `--max-pages N` (crawl internal links), `--skip-approval` (auto-approve prompts).

## 🛡️ Safety Rules (non-negotiable)

- No payment, checkout, submission, message, or destructive action is ever taken without **explicit human confirmation**.
- Elements with dangerous-sounding labels are **never auto-clicked** — they're surfaced for manual review instead.
- Forms are inspected for validation issues **without ever calling `.submit()`** — no real data is ever sent.
- CAPTCHA and login walls trigger a hard stop for human handoff, never an automated bypass.

## 📊 Example Output

| Tag | Label | Suggested Fix |
|---|---|---|
| `<button>` | "Calculate My Footprint" | No effect detected — check that `st.button()`'s return value is being checked in an `if` block. |
| `<a>` | "Learn More" | `href="#"` placeholder — link was never wired to a real destination. |

## 🎬 Demo Story

We run the QA sweep twice on camera: the **first run** shows the agent live-exploring and reasoning through the page (visible cost, visible thinking). The **second run**, powered by webcmd's site memory, replays the learned navigation and re-checks known trouble spots almost instantly — showing the "learn once, run cheap forever" promise in action on our own app.

## 🙌 Team

Built solo/team for the webcmd Hackathon — Browser Agents Edition.