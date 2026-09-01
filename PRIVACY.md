# webcmd Privacy

The webcmd-managed CloakBrowser runtime communicates only with the local Webcmd daemon on `localhost:9777`.

The runtime can access browser pages and cookies because browser automation requires those permissions. Webcmd does not send page contents or cookies to AgentR. Except for the site-memory seed lookup and the optional candidate public-IP lookup below, Webcmd does not send browser data to AgentR. Commands run locally, and command output is printed to the local CLI process.

Trace artifacts, cache files, plugins, user adapters, and site memory are stored under `~/.webcmd`.

## Local site-memory seed lookup

`WEBCMD_GLOBAL_MEMORY_URL` enables a public unauthenticated GET `<base>/v1/site-memory/seeds/<punycode-product-key>` on first access when no local memory exists. The request uses a 2-second timeout and no retry. It discloses the resolved product/domain.

With no URL configured, learning is local-only and Webcmd makes no seed request. `WEBCMD_GLOBAL_MEMORY=off` disables even a configured URL.

## Candidate public-IP provenance

When capturing candidate evidence, local Webcmd makes a best-effort unauthenticated GET `https://api.ipify.org` with a 2-second timeout and no credentials. It records the public egress IP in local candidate JSON only. Inability to resolve it does not block capture.

`WEBCMD_CANDIDATE_PUBLIC_IP=off` disables the lookup.

## What stays local

Candidate provenance stays local under `~/.webcmd/sites`. It includes local machine/network metadata, is excluded from ordinary output, and is never uploaded or pushed by this design. The local sites Git repository never pushes.

Learning is invisible in normal output. Diagnostics appear on request, verbose mode, or a material warning-retention failure.

## Beta memory clean break

If you used beta site memory, remove that product's old `~/.webcmd/sites/<product>/sitemap/SITE.md` before first use, or remove that entire beta product directory if you do not want it. There is no migration guarantee. Do not delete unrelated product directories.

For attribution and license information, see `LICENSE` and `NOTICE`.
