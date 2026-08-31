# webcmd Privacy

Local mode keeps Cloak as the bundled default browser. SLAB is a macOS alpha opt-in selected with `webcmd setup --mode local --browser slab`, and a compatible local Chromium fork can be selected with `webcmd setup --mode local --browser /absolute/path/to/browser`.

The SLAB browser communicates with webcmd through owner-scoped local IPC. webcmd does not expose a raw TCP debugging endpoint.

The runtime can access browser pages and cookies because browser automation requires those permissions. Webcmd does not send browser data to AgentR. Commands run locally, and command output is printed to the local CLI process.

Trace artifacts, cache files, plugins, user adapters, and site memory are stored under `~/.webcmd`. Custom browser selections keep their own local profile directories and do not overwrite the managed Cloak profiles.

For attribution and license information, see `LICENSE` and `NOTICE`.
