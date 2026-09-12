---
name: website-cloner
description: Universal Website Cloner skill to clone any website (React, Next.js, Vue, SPAs, static sites) with full rendered HTML, CSS, JS, fonts, images, SVGs, and rewritten local asset paths into a local directory.
---

# Universal Website Cloner

Use this skill when you or the user want to clone, replicate, or archive any modern website, web application, or landing page into a local directory.

## Terminal Slash Commands

When running `webcmd clone`, you can type slash commands directly in the prompt or in the CLI:

| Command | Action |
| :--- | :--- |
| `/clone <url>` | Standard full site clone with dynamic DOM hydration & formatted HTML |
| `/react <url>` | Clone + automatically decompose to **React (TSX) + Tailwind CSS components** |
| `/diff <url>` or `/verify <url>` | Clone + generate **Pixel-Perfect Visual Diff Comparison Slider** |
| `/zip <url>` | Clone + automatically package into a portable `.zip` archive |

---

## Direct CLI Usage

```bash
# 1. Standard clone
webcmd clone https://news.ycombinator.com -o ./clones/hackernews

# 2. Clone and convert into React + Tailwind Components
webcmd clone https://linear.app -o ./clones/linear --to-react

# 3. Clone and generate side-by-side Visual Diff verification slider
webcmd clone https://webcmd.dev -o ./clones/webcmd --verify

# 4. Clone and package into a portable ZIP archive
webcmd clone https://example.com -o ./clones/example --zip
```

---

## Output Structure

```
clones/
└── <site-name>/
    ├── index.html          # Hydrated & Prettified HTML
    ├── verify.html         # Interactive Before/After Visual Diff Slider (if --verify)
    ├── metadata.json       # Clone metadata, duration, and asset breakdown
    ├── assets/
    │   ├── css/            # Downloaded stylesheets
    │   ├── js/             # Script files
    │   ├── images/         # PNG, JPG, WebP, SVG images & icons
    │   └── fonts/          # WOFF2, TTF webfonts
    └── react/              # (if --to-react)
        ├── src/
        │   ├── App.tsx
        │   ├── main.tsx
        │   └── components/ # Decomposed modular TSX components
        ├── package.json
        └── tailwind.config.js
```
