# webcmd-plugin-slock

Webcmd commands for slock.

## Install

```bash
webcmd plugin install github:agentrhq/webcmd/slock
```

## Commands

| Command | Description |
| --- | --- |
| `webcmd slock attachment-download` | Download an attachment to a local file. Resolves a signed CDN URL in the page, then fetches bytes node-side (no CORS). |
| `webcmd slock attachment-upload` | Upload a local file to Slock attachments. Prints the attachmentId for use with `message-send --attach`. |
| `webcmd slock attachment-url` | Get a short-lived signed CDN URL for an attachment (does not download bytes). |
| `webcmd slock bookmark-add` | Bookmark a message (POST /channels/saved). Requires full messageId UUID. |
| `webcmd slock bookmark-list` | List bookmarks (saved messages) in the active server |
| `webcmd slock bookmark-remove` | Remove a bookmark (DELETE /channels/saved/:messageId). 404 is treated as already-removed. |
| `webcmd slock channel-archive` | Archive a channel — admin only (POST /channels/:id/archive) |
| `webcmd slock channel-create` | Create a channel — admin only (POST /channels/). Public unless --private. |
| `webcmd slock channel-files` | List files shared in a channel (GET /channels/:id/files) |
| `webcmd slock channel-info` | Show one channel's details (GET /channels/:id) |
| `webcmd slock channel-join` | Join a public channel (POST /channels/:id/join) |
| `webcmd slock channel-leave` | Leave a channel (POST /channels/:id/leave) |
| `webcmd slock channel-list` | List channels in the active slock server |
| `webcmd slock channel-mark` | Mark a channel read (default), read up to --seq, or --unread. |
| `webcmd slock channel-members` | List members of a channel |
| `webcmd slock channel-unarchive` | Unarchive a channel — admin only (POST /channels/:id/unarchive). #name lookups exclude archived channels; pass the channelId UUID for archived ones. |
| `webcmd slock dm-list` | List DM channels in the active server (GET /channels/dm) |
| `webcmd slock inbox` | List unified inbox items (channels, DMs, followed threads) that need attention. |
| `webcmd slock inbox-done` | Mark one chat as done / clear it from the inbox (POST /channels/inbox/done) |
| `webcmd slock inbox-read-all` | Mark the entire inbox as read (POST /channels/inbox/read-all) |
| `webcmd slock login` | Open slock login |
| `webcmd slock message-read` | Read messages in a channel or thread. Thread form: "#channel:msgIdOrShort". Use --after seq\|UUID for cursor. |
| `webcmd slock message-search` | Search messages |
| `webcmd slock message-send` | Send a message to a channel, DM, or thread (content sent verbatim) |
| `webcmd slock reaction-add` | Add an emoji reaction to a message (POST /messages/:id/reactions). Idempotent server-side. |
| `webcmd slock reaction-remove` | Remove your emoji reaction from a message (DELETE /messages/:id/reactions). |
| `webcmd slock server-list` | List slock servers you belong to; marks active per localStorage slug |
| `webcmd slock server-use` | Set the active slock server (writes localStorage.slock_last_server_slug) |
| `webcmd slock task-claim` | Claim a chat task (PATCH /tasks/:id/claim). Requires full task UUID (= message id). |
| `webcmd slock task-convert` | Convert a message into a chat task (POST /tasks/convert-message). Accepts a message UUID or "#channel:shortId". |
| `webcmd slock task-create` | Create a task in a channel (single title; batch 1-50 is server-supported but client surface is single — see backlog R4). |
| `webcmd slock task-delete` | Delete a chat task (DELETE /tasks/:taskId). Requires --confirm — destructive, irreversible. |
| `webcmd slock task-get` | Fetch a task by channel + taskNumber (GET /tasks/channel/:channelId/number/:taskNumber). |
| `webcmd slock task-list` | List tasks (chat tasks = messages with task fields) attached to a channel. Optional --status filter. |
| `webcmd slock task-list-server` | List tasks across all channels in the active server (GET /tasks/server). Optional --status filter. |
| `webcmd slock task-status` | Set a task's status (PATCH /tasks/:taskId/status, body {status}). One of todo\|in_progress\|in_review\|done\|closed. |
| `webcmd slock task-unclaim` | Release ownership of a chat task (PATCH /tasks/:id/unclaim). |
| `webcmd slock thread-done` | Mark a thread as done / hide it from the active list (POST /channels/threads/done) |
| `webcmd slock thread-follow` | Follow the thread on a parent message (POST /channels/threads/follow) |
| `webcmd slock thread-list` | List followed threads in the active server (GET /channels/threads/followed) |
| `webcmd slock thread-undone` | Restore a done thread to the active list (POST /channels/threads/undone) |
| `webcmd slock thread-unfollow` | Stop following a thread (POST /channels/threads/unfollow) |
| `webcmd slock unread-summary` | Global unread counts across every server you belong to. |
| `webcmd slock whoami` | Show the current logged-in slock account |
