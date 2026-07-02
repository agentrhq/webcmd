# webcmd

`webcmd` turns websites, browser sessions, desktop apps, and local tools into deterministic CLI surfaces for humans and AI agents.

## Install

```bash
node --version
npm install -g @agentrhq/webcmd
webcmd doctor
```

Node.js 20 or newer is required.

## Browser Runtime

Browser-backed commands use a webcmd-managed CloakBrowser runtime. No Chrome extension is required.

On first use, CloakBrowser downloads its Chromium binary. Existing Chrome logins are not imported, so run the site login command again:

```bash
webcmd instagram login
webcmd daemon status
```

## Examples

```bash
webcmd list
webcmd hackernews top --limit 5
webcmd bilibili hot --limit 5
webcmd browser work open https://example.com
```

## Agent Skills

Bundled skills live under `skills/webcmd-*`:

- `webcmd-browser`
- `webcmd-browser-sitemap`
- `webcmd-adapter-author`
- `webcmd-autofix`
- `webcmd-sitemap-author`
- `webcmd-usage`
