# webcmd-plugin-grok

Webcmd commands for grok.

## Install

```bash
webcmd plugin install github:agentrhq/webcmd/grok
```

## Commands

| Command | Description |
| --- | --- |
| `webcmd grok ask` | Send a message to Grok and get response |
| `webcmd grok delete` | Delete a Grok conversation by ID. Grok takes effect immediately with no confirmation dialog — require --yes to actually delete. |
| `webcmd grok detail` | Open a Grok conversation by ID and read its messages |
| `webcmd grok export` | Export all visible Grok conversation history metadata |
| `webcmd grok export-all` | Export Grok conversation history and each conversation transcript |
| `webcmd grok history` | List recent Grok conversations from the sidebar (requires login) |
| `webcmd grok image` | Generate images on grok.com and return image URLs |
| `webcmd grok login` | Open grok login |
| `webcmd grok new` | Start a new conversation in Grok |
| `webcmd grok pin` | Pin a Grok conversation by ID |
| `webcmd grok read` | Read messages in the current Grok conversation |
| `webcmd grok send` | Fire-and-forget: send a prompt to Grok without waiting for the reply |
| `webcmd grok status` | Check Grok page availability, login state, current session and model |
| `webcmd grok unpin` | Unpin a Grok conversation by ID |
| `webcmd grok whoami` | Show the current logged-in grok account |
