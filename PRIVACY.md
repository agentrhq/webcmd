# webcmd Privacy

Local mode keeps Cloak as the bundled default browser. SLAB is a macOS alpha opt-in selected with `webcmd setup --mode local --browser slab`, and a compatible local Chromium fork can be selected with `webcmd setup --mode local --browser /absolute/path/to/browser`.

The SLAB browser communicates with webcmd through owner-scoped local IPC. webcmd does not expose a raw TCP debugging endpoint.

The runtime can access browser pages and cookies because browser automation requires those permissions. Webcmd does not send page contents or cookies to AgentR. Except for the site-memory seed lookup and the optional candidate public-IP lookup below, Webcmd does not send browser data to AgentR. Commands run locally, and command output is printed to the local CLI process.

Trace artifacts, cache files, plugins, user adapters, and site memory are stored under `~/.webcmd`. Custom browser selections keep their own local profile directories and do not overwrite the managed Cloak profiles.

## Local site-memory seed lookup

Webcmd defaults to a public unauthenticated GET `https://api.webcmd.dev/v1/site-memory/seeds/<punycode-product-key>` on first access when no local product memory exists. The request discloses only the resolved product/domain; it sends no credentials, page contents, local memory, or candidate evidence. `WEBCMD_GLOBAL_MEMORY=off` disables the request. `WEBCMD_GLOBAL_MEMORY_URL` is only a developer/test override.

The lookup uses a 2-second timeout and no retry, and never refreshes initialized memory.

## Candidate public-IP provenance

When capturing candidate evidence, local Webcmd makes a best-effort unauthenticated GET `https://api.ipify.org` with a 2-second timeout and no credentials. It records the public egress IP in local candidate JSON only. Inability to resolve it does not block capture.

`WEBCMD_CANDIDATE_PUBLIC_IP=off` disables the lookup.

## What stays local

Candidate provenance stays local under `~/.webcmd/sites`. It includes local machine/network metadata, is excluded from ordinary output, and is never uploaded or pushed by this design. The local sites Git repository never pushes.

Learning is invisible in normal output. Diagnostics appear on request, verbose mode, or a material warning-retention failure.

## Beta memory clean break

If you used beta site memory, remove that product's old `~/.webcmd/sites/<product>/sitemap/SITE.md` before first use, or remove that entire beta product directory if you do not want it. There is no migration guarantee. Do not delete unrelated product directories.

For attribution and license information, see `LICENSE` and `NOTICE`.
