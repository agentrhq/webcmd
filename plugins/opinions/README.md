# webcmd-plugin-opinions

No-login social opinions & problems research across **public** platforms.
Research what people think about a topic, product, or problem — no browser, no
login, no credentials.

## Install

```bash
webcmd plugin install github:rishetmehra/webcmd-plugin-opinions
```

## Commands

| Command | Type | Description |
|---------|------|-------------|
| `opinions bluesky-posts <handle>` | public | Recent posts from a public Bluesky account (no login) |
| `opinions hackermind <query>` | public | Search Hacker News stories & comments for opinions (no login) |
| `opinions lobsters [--sort newest\|active\|hot]` | public | Lobste.rs newest / active / hot discussions (no login) |
| `opinions research <topic>` | public | Aggregate opinions/problems across Hacker News + Lobste.rs in one feed |

## Examples

```bash
# Read what a public Bluesky account (Twitter/X-like) is saying, no login
webcmd opinions bluesky-posts paulgraham.bsky.social --limit 10 -f json

# Search Hacker News for what people think about a product/problem
webcmd opinions hackermind "saas pricing" --limit 10 -f json

# Search comment text specifically for problem reports
webcmd opinions hackermind "billing is confusing" --limit 10 --scope comment -f json

# One command, opinions across platforms
webcmd opinions research "LLM" --limit 10 -f json
```

## Full multi-platform research setup (current state)

This machine has the `social` profile logged into **X/Twitter, Instagram,
Reddit, LinkedIn, and YouTube** (TikTok and Facebook are skipped — TikTok is
banned in India, Facebook not needed). All commands below run **headless**
(background browser) after the one-time login.

### How authentication works (important)

webcmd does **not** use your password in code or `.env`. It uses a one-time
interactive login per platform into a saved browser **profile** (`social`).
The profile stores the session cookies (`auth_token` for X, `sessionid` for
Instagram, `reddit_session` for Reddit, etc.). Commands read cookies from the
profile — never your credentials. This is why a one-time login is required and
why `.env` passwords don't work with the official plugins.

### Two tiers of access

**Tier 1 — no login (public APIs), always headless:**
```bash
webcmd opinions bluesky-posts <handle> --limit 10 -f json
webcmd opinions hackermind "<topic>" --limit 10 -f json
webcmd opinions lobsters --limit 10 -f json
webcmd opinions research "<topic>" --limit 10 -f json   # aggregate
```

**Tier 2 — logged-in platforms (uses `social` profile):**
```bash
# X / Twitter
webcmd --profile social twitter search "<query>" --limit 10 -f json
webcmd --profile social twitter tweets <username> --limit 10 -f json
webcmd --profile social twitter trending -f json

# Reddit (public opinion goldmine)
webcmd --profile social reddit search "<query>" --limit 10 -f json
webcmd --profile social reddit subreddit <name> --limit 10 -f json
webcmd --profile social reddit read <post-url> -f json

# Instagram
webcmd --profile social instagram search "<query>" -f json
webcmd --profile social instagram profile <username> -f json

# LinkedIn
webcmd --profile social linkedin people-search "<keyword>" -f json
webcmd --profile social linkedin timeline -f json

# YouTube
webcmd --profile social youtube search "<query>" --limit 10 -f json
webcmd --profile social youtube comments <video-url> -f json
```

### Re-authenticating after a session expires

If a platform returns `AUTH_REQUIRED`, redo the one-time login for that site:
```bash
webcmd --profile social <site> login    # sign in in the browser window
webcmd --profile social <site> whoami   # verify
```

## Development

```bash
# Install locally for development (symlinked, changes reflect immediately)
webcmd plugin install file:///Users/rishetmehra/webcmd-opinions

# Verify commands are registered
webcmd list | grep -A12 opinions

# Validate definitions
webcmd validate opinions
```
