---
name: website-cloner
description: Universal Website Cloner skill to clone any website (React, Next.js, Vue, SPAs, static sites) with full rendered HTML, CSS, JS, fonts, images, SVGs, and rewritten local asset paths into a local directory.
---

# Universal Website Cloner

Use this skill when you or the user want to clone, replicate, or archive any modern website, web application, or landing page into a local directory.

## Execution Methods

### 1. Native Webcmd Interactive Mode (Recommended)
Run without arguments to trigger interactive prompts directly in the terminal:
```bash
webcmd clone
```
The CLI will interactively ask for:
1. Target website URL (e.g. `https://example.com`)
2. Output folder path (default: `./clones/<domain>_<timestamp>`)
3. Auto-scroll toggle (to trigger lazy-loaded images/fonts)
4. Local preview server toggle

---

### 2. Direct Webcmd CLI Command
```bash
webcmd clone <url> [options]
```

### Options

| Option | Description | Default |
| :--- | :--- | :--- |
| `-o, --output <dir>` | Destination folder for the clone | `./clones/<domain>_<timestamp>` |
| `-t, --timeout <ms>` | Navigation timeout in milliseconds | `45000` |
| `--no-scroll` | Disable automatic scrolling | `false` |
| `--no-scripts` | Exclude dynamic JavaScript execution | `false` |
| `-s, --serve` | Start a local HTTP preview server after cloning | `false` |
| `-p, --port <port>` | Port for local preview server | `3000` |
| `-f, --format <fmt>` | Output format: `table`, `json`, `yaml`, `md` | `table` |
| `--json` | Output machine-readable JSON summary only | `false` |

---

### Examples

```bash
# Interactive prompt
webcmd clone

# Clone directly to a custom folder
webcmd clone https://news.ycombinator.com -o ./clones/hackernews

# Clone and immediately launch local preview server
webcmd clone https://webcmd.dev -o ./clones/webcmd-docs --serve
```

---

## Output Structure

The cloned site is created with a clean hierarchy:
```
clones/
└── <site-name>/
    ├── index.html          # Hydrated HTML with rewritten relative asset links
    ├── metadata.json       # Clone metadata, duration, and asset breakdown
    └── assets/
        ├── css/            # All downloaded stylesheets
        ├── js/             # All script files
        ├── images/         # All PNG, JPG, WebP, SVG images & icons
        ├── fonts/          # All WOFF2, TTF, OTF webfonts
        └── media/          # Videos and audio assets
```
