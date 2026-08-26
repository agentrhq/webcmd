# webcmd Privacy

The SLAB browser communicates with webcmd through owner-scoped local IPC. webcmd does not expose a raw TCP debugging endpoint.

The runtime can access browser pages and cookies because browser automation requires those permissions. Webcmd does not send browser data to AgentR. Commands run locally, and command output is printed to the local CLI process.

Trace artifacts, cache files, plugins, user adapters, and site memory are stored under `~/.webcmd`.

For attribution and license information, see `LICENSE` and `NOTICE`.
