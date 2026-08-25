# Webcmd Adapter Authoring through MCP

Author a deterministic adapter only after reconnaissance proves a reusable
workflow. Use `webcmd_cli_run` for every interaction; source is tenant-owned
virtual content, never a local checkout.

@[adapter conventions](../shared/adapter-conventions.src.md)
@[safety rules](../shared/safety-rules.src.md)

## Reconnaissance and strategy

Start with live capability and command help, then inspect site memory and a
bounded browser session. Prefer public or documented APIs, then stable UI/DOM
semantics; use internal page requests or interception only when the page proves
they are necessary. Record the observed request/state, authentication source,
replay result, and why a simpler strategy cannot work.

Create a named Session and keep its immutable, Profile-scoped readable ID for
raw browser evidence:

    { "argv": ["list", "-f", "json"] }
    { "argv": ["site", "memory", "show", "example", "-f", "json"] }
    { "argv": ["--profile", "work", "session", "create", "Work Project", "-f", "json"] }
    { "argv": ["--profile", "work", "--session", "work-project-k7", "browser", "snapshot", "--snapshot-mode", "tree", "-f", "json"] }

Do not bypass authentication, CAPTCHA, rate limits, or access controls. An
`action_required` response belongs to the user; provide its view URL and run its
returned verifier after the user completes it.

## Virtual adapter source

Get the scaffold or existing source as an artifact-backed virtual file:

    { "argv": ["adapter", "source", "get", "example/search", "--output", "adapter.ts"] }

The command materializes source at the virtual relative path `adapter.ts`. Read
that virtual file, edit it in the tool call, then put it back using the same
path and a virtual file attachment:

    {
      "argv": ["adapter", "source", "put", "example/search", "adapter.ts"],
      "files": [{ "path": "adapter.ts", "artifactUri": "webcmd://artifacts/exec_.../ea_..." }]
    }

The scaffold, traces, fixtures, and verification output are artifacts. Do not
ask for an editor or repository path, and do not create a plugin directory.

## Verify and retain evidence

Run validation and a bounded verification after each meaningful source update:

    { "argv": ["validate", "example/search", "-f", "json"] }
    { "argv": ["browser", "verify", "example/search", "-f", "json"] }

Compare returned values against a visible page or captured response. Preserve
sanitized endpoint samples and field evidence in hosted site memory, not an
agent machine. On failure, use `webcmd-autofix`; do not guess field mappings or
silently turn failures into empty rows.
