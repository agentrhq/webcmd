# webcmd-plugin-meridian

Webcmd commands for [Meridian](https://app.getmeridian.tech) (getmeridian.tech), the founder copilot whose Astra agent takes an idea from ideation to validated market intelligence. The plugin drives the same APIs the Meridian app uses, through a logged-in Webcmd browser profile.

## Install

```bash
webcmd plugin install github:agentrhq/webcmd/meridian
```

## Authorize your Meridian account

Every command runs against your Meridian account, so authorize the browser profile first:

```bash
webcmd meridian login
```

This opens Meridian in the Webcmd browser. Sign in — or sign up if you have no account yet (email/password or Google; new email accounts must verify their address before login works). Then confirm:

```bash
webcmd meridian whoami
```

Commands raise a typed auth error (instead of empty results) whenever the session is missing or expired.

## Commands

| Command | Description |
| --- | --- |
| `webcmd meridian login` | Open Meridian sign-in/sign-up to authorize this browser profile |
| `webcmd meridian whoami` | Show the signed-in Meridian account (email, org, credits) |
| `webcmd meridian projects` | List the projects (initiatives) in your account |
| `webcmd meridian ideate` | One turn of the Astra ideation chat; repeat until stage=ready_to_start |
| `webcmd meridian approve` | Approve the ready draft and start the project |
| `webcmd meridian persona` | Build and save an ideal-user persona from behaviours or interview notes |
| `webcmd meridian personas` | List the personas saved on a project |
| `webcmd meridian competitors` | List a project's competitor board, prioritized by relevance |
| `webcmd meridian competitor-add` | Add a competitor by name or website |
| `webcmd meridian competitor-scan` | Rebuild the prioritized competitor landscape |
| `webcmd meridian agent-status` | Show the Astra background agent and its branch states |
| `webcmd meridian agent-start` | Start/resume the Astra market-intelligence agent (`--scan` for an immediate tick) |
| `webcmd meridian agent-pause` | Pause the Astra background agent |

## Workflows

### Ideation → Approve & Start

Astra interviews you about the idea and web-researches the market. Keep answering until the readiness gate opens (it needs `problem_statement`, `solution`, and `market_opportunity` confidence, and at least three founder turns):

```bash
webcmd meridian ideate "AI agents that QA mobile apps before release" -f json
webcmd meridian ideate "Mobile teams at seed-stage startups; they ship weekly" -f json
webcmd meridian ideate "They find UI regressions only after users complain" --research -f json
```

Each turn returns the running summary — problem statement, solution, market opportunity, differentiation — plus readiness scores, tap-to-answer `suggestions`, and the web-research `research_sources` behind Astra's context. When `stage` is `ready_to_start`, the row also carries the three-stage plan. Then:

```bash
webcmd meridian approve -f json
```

Astra creates the project and sets it up (starter persona, competitor scan, first signals). The conversation state lives in the persistent browser session; `--reset` starts a fresh draft.

### Ideal-user personas

From observed behaviour, or from uploaded user-interview notes:

```bash
webcmd meridian persona <project-id> "Churned users all mention onboarding friction" -f json
webcmd meridian persona <project-id> --file ./interviews/batch-3.md -f json
webcmd meridian personas <project-id> -f json
```

When Astra marks the draft ready, the persona is saved to your Meridian account automatically (OCEAN traits included).

To mine a Reddit community for persona signals, compose with the `reddit` plugin: pull the community and its top discussions (`webcmd reddit subreddit-info r/mobiledev`, `webcmd reddit subreddit r/mobiledev --limit 25`), then feed the recurring behaviours and complaints into `webcmd meridian persona`.

### Competitor research

Meridian's own scan builds and prioritizes the board for the project context:

```bash
webcmd meridian competitor-scan <project-id>
webcmd meridian competitors <project-id> -f json
```

To widen the net, source candidates with the research plugins first — `webcmd ycombinator companies "mobile testing"`, `webcmd hackernews search "mobile app QA"`, `webcmd producthunt search "app testing"` — then add the credible ones so the next scan positions them:

```bash
webcmd meridian competitor-add <project-id> acme.ai
webcmd meridian competitor-scan <project-id>
```

### Market intelligence (Astra background agent)

```bash
webcmd meridian agent-start <project-id> --scan
webcmd meridian agent-status <project-id> -f json
webcmd meridian agent-pause <project-id>
```

The agent runs 24×7 server-side across parallel branches (market research, synthesis, planning, execution); `agent-status` shows each branch's state and any checkpoints awaiting a human decision.

## Notes

- Meridian meters some actions in account credits (new project, competitor scan/add, research turns). Commands surface the API's insufficient-credit errors as actionable messages.
- Astra turns can take a while (LLM + web research); every long-running command takes `--timeout`.
- Chat drafts (ideation, persona) keep their conversation state in the persistent Webcmd browser session; ideation drafts are also autosaved to your account so they stay resumable in the Meridian app.
