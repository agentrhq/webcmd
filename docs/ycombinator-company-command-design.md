# Y Combinator Company Command

## Goal

Complete the existing startup discovery flow with one public, read-only
drill-down command:

```bash
webcmd ycombinator company <slug-or-url>
```

The existing `companies` command remains the search and filtering entry point.
No duplicate `latest` or AI-specific commands are added. YC jobs remain outside
this change.

## Command contract

`company` accepts either a YC company slug such as `fenrock-ai` or a full
`https://www.ycombinator.com/companies/...` URL. Other hosts, malformed paths,
and missing identifiers fail with `ArgumentError`.

The command returns one row with:

- `name`
- `description`
- `batch`
- `status`
- `location`
- `founded`
- `teamSize`
- `website`
- `founders`
- `jobCount`
- `url`

Nullable public fields return `null`; an unavailable or blocked profile fails
with the appropriate typed WebCMD error.

## Data flow

The command navigates anonymously to the canonical YC company page and extracts
the visible public profile fields. It reuses the existing plugin conventions
and dependencies; no package or shared abstraction is added.

## Verification

Add one focused adapter test covering slug/URL normalization and profile
extraction, then run the plugin validation, repository tests, and live command
against a current YC company page. Compare representative returned values with
the visible page before declaring the PR merge-ready.
