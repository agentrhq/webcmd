# Webcmd Launch Campaign — X Demo Day

Single-day launch: one video (cost-question hook → genuine task race → generation reveal), community CLI-request bot as the CTA, paid influencer amplification.

---

## The story

1. **Hook — the cost question**: "how much does it cost to run a browser agent?" over two live terminals.
2. **The race**: a genuine task (SF rentals under $5k, filtered) runs on both sides. One finishes in seconds; one grinds.
3. **The reveal**: "same task. same agent. one of them learned." → learning montage (agent explores Zillow once, compiles a CLI).
4. **The answer**: back to the race; final cost/token/time numbers close the loop on the opening question.
5. **The CTA (the bot)**: reply with any website; the most-liked request gets its CLI built, verified, and shipped as a plugin the same day — by a bot that itself runs on webcmd.

---

## Video — locked shot list (~60s)

Structure: question → race → midpoint reveal → montage → payoff → answer → CTA. The question opener closes its loop at 0:37–0:46, which drives watch-through.

| Time | Shot | Overlay copy (exact) |
|---|---|---|
| 0:00–0:02 | Both terminals idle, cost meters at `$0.00`, question overlaid **on top of live terminals** (motion under text from frame one — a static question card is scroll-past-able) | `how much does it cost to run a browser agent?` |
| 0:02–0:05 | The task appears; both sides launch simultaneously | `find rentals in SF under $5k — 2bd, pet-friendly, parking` |
| 0:05–0:12 | **The race.** Left: browser agent clicking through filter UI, screenshots flashing, meter climbing `$0.40… $1.10…`. Right: **DONE ✓ 2.3s · $0.03** with a real listings table by ~0:07. Hold — left keeps grinding while right sits finished | *(none — the asymmetry is the copy)* |
| 0:12–0:15 | Hard cut to clean card | `same task. same agent. one of them learned.` |
| 0:15–0:30 | Learning montage at 4–6×: the prompt, `webcmd browser` exploring Zillow, adapter file writing itself, smoke test flipping green. Real wall-clock in corner | `the night before:` → `it browsed the site once` → `and compiled what it learned into a CLI` |
| 0:30–0:37 | Payoff: rerun `webcmd zillow rentals "san francisco" --max 5000 --beds 2 --pets --parking` → instant table. **Run it twice.** | `now it never browses zillow again` |
| 0:37–0:46 | Return to the race; left finally finishes. Final numbers slam in — **this answers the opening question** | `$4.83 vs $0.03` → `47,112 tokens vs 312` → `every. single. run.` |
| 0:46–0:60 | CTA card, static | `reply with any website.` `most-liked gets its CLI built today — live, by a bot running on webcmd.` `npm i -g @agentrhq/webcmd` |

**Production notes**

- Entire video must work muted — all text + motion, no narration required.
- First frame = thumbnail: question + both terminals + `$0.00` meters.
- Payoff asymmetry (right DONE, left grinding) must land by ~0:08 or scrollers are gone. Question 2s, task 2s, no breathing room in the setup.
- CLI flags must mirror the spoken filters exactly (`--max 5000 --beds 2 --pets --parking`) — that symmetry is what makes the task feel genuine.
- **Verify the filter combo returns 15+ listings on Zillow rentals before recording** — a sparse result table kills the payoff. Filters should look demanding but return a healthy table.
- One honest recording of each segment, re-ordered — not fabricated. Keep real timestamps visible in both halves.
- Replace all placeholder numbers with **real measured values** from the actual runs. The replies will fact-check; surviving the fact-check is the distribution.
- Terminal font huge; speed up waits 4–6×; no dead time.

---

## Copy pack

### Main tweet (Nishant · standalone + native video) — S-tier

> zillow is a unix command now.
>
> i didn't write it. my agent did — browsed the site once, compiled what it learned into a CLI, and never browses it again.
>
> 47,000 tokens → 312. per run. forever.
>
> taking requests in the replies: most-liked website gets its CLI built live today 👀

Why: "X is a Y now" hook in the first six words; concrete numbers; the request mechanic pulls replies (27× weight) as a real product mechanic, not engagement bait; no link in body.

### A-tier alternates

> my AI agent got tired of browsing zillow, so it wrote itself a zillow CLI.
>
> one run to learn the site. every run after: 312 tokens instead of 47,000.
>
> this is what agent infra should do — stop paying your agent to rediscover the same website every run.
>
> requests open in the replies. most-liked ships today.

> every time your agent browses a website, you pay for it to rediscover everything it already knew.
>
> so we made agents compile what they learn into CLIs. watch it learn zillow in 40 minutes, then run it in 2 seconds:
>
> most-liked site in the replies gets built live today.

### First reply — seed within 60 seconds of posting

> rules for today's build bot:
>
> — reply with any public website
> — most-liked request wins. the bot explores it, builds the CLI, verifies it, ships it as a plugin — replies here with proof
> — read-only commands only. no logins, no checkouts
>
> try it yourself: npm i -g @agentrhq/webcmd
> github.com/agentrhq/webcmd

(Link lives here, never in the tweet body — links in the body are penalized 30–50%.)

### T+24h self-quote

> day 1: you asked for N sites. the bot shipped M.
>
> here's the catalog: [marketplace screenshot]

---

## Influencer briefs — one angle each, staggered over 3–4 hours

Never the same copy twice; ten near-identical QTs in an hour reads as botted and suppresses reach. Each person gets an angle + a sample line to rewrite in their own voice.

1. **The economics QT** (AI builders/founders):
   *"the token math on this is brutal. browser agents re-spend ~47k tokens per task on navigation alone. compiling it once changes the unit economics of every agent product."*
2. **The infra-take QT** (agent-infra crowd):
   *"quietly the most interesting pattern in agents right now: tools that learn → compile → never repeat. this is what 'self-improving' actually looks like in production, not benchmarks."*
3. **The participant** (builders — highest value): doesn't QT first. **Requests a site in the replies** ("do instacart"), then QTs the bot's fulfilled reply an hour later:
   *"i asked for this at 10am. it shipped by 11. what."*
   This models the CTA behavior for their entire audience.
4. **The skeptic-converted** (everyone): installs it for real, runs one command, QTs with their own screenshot:
   *"assumed this was a staged demo. ran it myself. it's real."*
   Third-party receipts convert better than anything first-party.

**Compliance notes**: varied timing, varied copy, genuine interaction (requests > reshares) keeps this on the safe side of X's coordinated-engagement detection. Paid promotion formally requires disclosure from the influencers' side.

---

## The bot — architecture (all exists in the repo today)

- **Intake**: poll `webcmd twitter notifications -f json` (or mentions search) for replies naming a site.
- **Build**: each request spawns a Claude Code session with the `webcmd-adapter-author` skill (includes the interactive command-scoping step, PR #46) → adapter goes into a public community plugin repo.
- **Ship**: publish via the plugin system; plugin marketplace catalog commands (PR #61) put every bot-built CLI in a browsable catalog. Each reply grows the marketplace; the marketplace is itself content.
- **Reply**: `webcmd twitter post` with a screenshot of the working command + `webcmd plugin install github:agentrhq/community-clis`.

**Guardrails (day one, non-negotiable)**

- Read-only, public-strategy adapters only. No login flows, no checkout, nothing touching accounts. Stated in the pinned rules.
- **Human approval queue before any reply posts** — at least for launch week. Seconds per approval; eliminates the worst failure mode (publicly shipping something broken while the thread is hot).
- Most-liked-wins caps build load and adds a game mechanic.
- Every shipped CLI needs `webcmd verify --smoke` green before the reply goes out. Failed builds get an honest "this one fought back, here's why" reply — often more viral than successes.

---

## Run-of-show

**T-minus days (not day-of)**

- [ ] Pre-build + verify the Zillow rentals adapter with the exact demo flags. Record the *real* first run for the video (dry-run the flow on a different site first).
- [ ] Pre-build 2–3 seed adapters (Instacart first — it gets its grocery moment as a bot fulfillment, not the lead video).
- [ ] Test the full bot loop end-to-end (poll → build → verify → approval → reply) on a burner thread.
- [ ] Measure real token/cost/time numbers for the split screen; substitute into video overlays and tweet copy.
- [ ] Brief influencers: one angle each, staggered slots.

**Launch day** (target Wednesday, 8–10am ET — first 30–60 min decides reach)

| Time | Action |
|---|---|
| T+0 | Post video + main tweet. Seed the CTA/rules reply within 60s. |
| T+0–30m | Seeded friendlies request the pre-built sites; bot fulfills within ~30 min — proof before organic requesters commit. |
| T+1–4h | Influencer wave, staggered. Founder lives in the replies via `webcmd twitter post` (author-replies weighted ~150×; replying via CLI is itself a flex). |
| T+rest | Bot fulfills top-liked organic request(s), each with a quotable screenshot. Approval queue on. |
| T+24h | Self-quote with day-1 numbers + marketplace catalog. |

---

## Open flags

- Placeholder numbers ($4.83 / $0.03 / 47,112 / 312 / 2.3s) must be replaced with measured values before recording.
- Posting webcmd from @itsnishantg (bio: authsome) will draw "which company is this" replies — have a one-line answer ready.
- The bot loop running unattended in public is the riskiest dependency; the approval queue is the mitigation.
