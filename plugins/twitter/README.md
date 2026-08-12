# webcmd-plugin-twitter

Webcmd commands for twitter.

## Install

```bash
webcmd plugin install github:agentrhq/webcmd/twitter
```

## Commands

| Command | Description |
| --- | --- |
| `webcmd twitter accept` | Auto-accept DM requests containing specific keywords |
| `webcmd twitter article` | Fetch a Twitter Article (long-form content) and export as Markdown |
| `webcmd twitter block` | Block a Twitter user |
| `webcmd twitter bookmark` | Bookmark a tweet |
| `webcmd twitter bookmark-folder` | Read the tweets inside a single Twitter/X bookmark folder. Get the folder id from `webcmd twitter bookmark-folders`. |
| `webcmd twitter bookmark-folders` | List your Twitter/X bookmark folders (the user-created collections under Bookmarks). Returns folder id, name, item count, and created_at. |
| `webcmd twitter bookmarks` | Fetch your Twitter/X bookmarks (the logged-in user's saved tweets, newest first) |
| `webcmd twitter collection` | Fetch a user timeline with relationship facts and a bounded completion receipt. |
| `webcmd twitter delete` | Delete a specific tweet by URL |
| `webcmd twitter device-follow` | Read the /i/timeline device-follow notification stream (tweets aggregated under a bell-icon "new posts from @userA and N others" notification) |
| `webcmd twitter download` | Download Twitter/X media (images and videos). Provide either <username> to fetch every media item from their profile via the GraphQL UserMedia endpoint with cursor pagination, or --tweet-url to download a single tweet. |
| `webcmd twitter follow` | Follow a Twitter user |
| `webcmd twitter follow-batch` | Follow multiple Twitter/X users from a comma-separated username list |
| `webcmd twitter followers` | Get accounts following a Twitter/X user (defaults to the logged-in user when no user is given) |
| `webcmd twitter following` | Get accounts a Twitter/X user is following (defaults to the logged-in user when no user is given) |
| `webcmd twitter hide-reply` | Hide a reply on your tweet (useful for hiding bot/spam replies) |
| `webcmd twitter like` | Like a specific tweet |
| `webcmd twitter likes` | Fetch liked tweets of a Twitter user (defaults to the logged-in user when no username is given) |
| `webcmd twitter list-add` | Add a user to a Twitter/X list you own (no-op if already a member) |
| `webcmd twitter list-add-batch` | Add multiple users to a Twitter/X list you own from a comma-separated username list |
| `webcmd twitter list-create` | Create a new Twitter/X list (returns the new list id) |
| `webcmd twitter list-delete` | Delete a Twitter/X list you own after explicit confirmation |
| `webcmd twitter list-remove` | Remove a user from a Twitter/X list you own (toggles via UI; no-op if not currently a member) |
| `webcmd twitter list-remove-batch` | Remove multiple users from a Twitter/X list you own from a comma-separated username list |
| `webcmd twitter list-tweets` | Fetch tweets from a Twitter/X list timeline |
| `webcmd twitter lists` | Get Twitter/X lists for the logged-in user (owned + subscribed) |
| `webcmd twitter login` | Open twitter login |
| `webcmd twitter notifications` | Get your Twitter/X notifications (the logged-in user's likes/replies/follows feed, newest first) |
| `webcmd twitter post` | Post a new tweet/thread |
| `webcmd twitter profile` | Fetch a Twitter user profile — bio, stats, etc. (defaults to the logged-in user when no username is given) |
| `webcmd twitter quote` | Quote-tweet a specific tweet with your own text, optionally with a local or remote image |
| `webcmd twitter reply` | Reply to a specific tweet, optionally with a local or remote image |
| `webcmd twitter reply-dm` | Send a message to recent DM conversations |
| `webcmd twitter retweet` | Retweet a specific tweet |
| `webcmd twitter search` | Search Twitter/X for tweets, with optional --from / --has / --exclude / --product filters mapped to X's search operators |
| `webcmd twitter thread` | Get a tweet thread (original + all replies) |
| `webcmd twitter timeline` | Fetch the logged-in user's home timeline (for-you algorithmic feed by default; pass --type following for the chronological feed of accounts you follow) |
| `webcmd twitter trending` | Twitter/X trending topics |
| `webcmd twitter tweets` | Fetch a Twitter user's most recent tweets (chronological, excludes pinned; defaults to the logged-in user when no username is given) |
| `webcmd twitter unblock` | Unblock a Twitter user |
| `webcmd twitter unbookmark` | Remove a tweet from bookmarks |
| `webcmd twitter unfollow` | Unfollow a Twitter user |
| `webcmd twitter unlike` | Remove a like from a specific tweet |
| `webcmd twitter unretweet` | Undo a retweet on a specific tweet |
| `webcmd twitter whoami` | Show the current logged-in twitter account |
