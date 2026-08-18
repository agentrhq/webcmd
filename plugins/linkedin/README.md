# webcmd-plugin-linkedin

LinkedIn profile, network, messaging, job, post, and Sales Navigator commands for WebCMD. Sign in to LinkedIn in the managed browser before running authenticated commands.

## Install

```bash
webcmd plugin install github:agentrhq/webcmd/linkedin
```

## Commands

- Authentication: `linkedin login`, `linkedin whoami`
- Profiles: `linkedin profile-read`, `linkedin profile-experience`, `linkedin profile-projects`, `linkedin profile-analytics`, `linkedin services-read`
- Network: `linkedin people-search`, `linkedin connections`, `linkedin connect`, `linkedin company`, `linkedin sent-invitations`
- Posts: `linkedin posts`, `linkedin post-analytics`, `linkedin post-comments`, `linkedin timeline`
- Jobs: `linkedin search`, `linkedin job-detail`, `linkedin jobs-preferences`
- Messaging: `linkedin inbox`, `linkedin thread-snapshot`, `linkedin safe-send`
- Sales Navigator: `linkedin salesnav-search`, `linkedin salesnav-inbox`, `linkedin salesnav-thread`, `linkedin salesnav-message`

## Examples

```bash
webcmd linkedin profile-read https://www.linkedin.com/in/example/
webcmd linkedin post-comments https://www.linkedin.com/posts/example_activity-123
webcmd linkedin people-search "product manager" --limit 10
```
