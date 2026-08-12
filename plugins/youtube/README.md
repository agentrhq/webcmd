# webcmd-plugin-youtube

Webcmd commands for youtube.

## Install

```bash
webcmd plugin install github:agentrhq/webcmd/youtube
```

## Commands

| Command | Description |
| --- | --- |
| `webcmd youtube channel` | Get YouTube channel info and recent videos |
| `webcmd youtube comments` | Get YouTube video comments |
| `webcmd youtube feed` | Get YouTube homepage recommended videos |
| `webcmd youtube frames` | Capture timestamped PNG frames from a YouTube video |
| `webcmd youtube history` | Get YouTube watch history |
| `webcmd youtube like` | Like a YouTube video |
| `webcmd youtube login` | Open youtube login |
| `webcmd youtube playlist` | Get YouTube playlist info and video list |
| `webcmd youtube search` | Search YouTube videos |
| `webcmd youtube subscribe` | Subscribe to a YouTube channel |
| `webcmd youtube subscriptions` | List subscribed YouTube channels |
| `webcmd youtube transcript` | Get YouTube video transcript/subtitles |
| `webcmd youtube unlike` | Remove like from a YouTube video |
| `webcmd youtube unsubscribe` | Unsubscribe from a YouTube channel |
| `webcmd youtube video` | Get YouTube video metadata (title, views, description, etc.) |
| `webcmd youtube watch-later` | Get your YouTube Watch Later queue |
| `webcmd youtube whoami` | Show the current logged-in youtube account |

## Capture frames

Capture frames at exact timestamps, in seconds:

```bash
webcmd youtube frames "https://www.youtube.com/watch?v=VIDEO_ID" --timestamps 30,90,150
```

Or capture evenly distributed frames:

```bash
webcmd youtube frames "https://www.youtube.com/watch?v=VIDEO_ID" --count 5
```

If neither option is provided, five frames are captured.
