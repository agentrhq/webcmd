# webcmd-plugin-luma

Manage hosted Luma events, registration questions, and guests through the account signed in to the Webcmd browser profile.

## Install

```bash
webcmd plugin install github:agentrhq/webcmd/luma
```

## Authentication

```bash
webcmd luma login
webcmd luma whoami -f json
```

Complete passwords, MFA, and CAPTCHA directly in the opened browser. The CLI never accepts those secrets.

## Commands

| Command | Access | Description |
| --- | --- | --- |
| `webcmd luma login` | Write | Open Luma sign in when the browser profile is logged out |
| `webcmd luma whoami` | Read | Show the current logged-in Luma account |
| `webcmd luma events` | Read | List upcoming or past managed events |
| `webcmd luma guests <eventId>` | Read | List guests and their registration answers |
| `webcmd luma create-event` | Write | Create a free single-session event |
| `webcmd luma set-registration-questions <eventId>` | Write | Append or replace custom registration questions |
| `webcmd luma update-guest-status <eventId> <guestId>` | Write | Approve or decline a pending guest |

The three state-changing event and guest commands require `--confirm true`.

## Examples

```bash
webcmd luma events --period future --limit 25 -f json
webcmd luma guests evt-abc --status pending_approval --limit 100 -f json
webcmd luma update-guest-status evt-abc gst-abc --status approved --confirm true -f json
```
