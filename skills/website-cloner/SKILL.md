---
name: website-cloner
description: Universal Website Cloner skill to clone any website (React, Next.js, Vue, SPAs, static sites) with full rendered HTML, CSS, JS, fonts, images, SVGs, and rewritten local asset paths into a local directory.
---

# Universal Website Cloner & Reverse-Engineering Studio

Use this skill when you or the user want to clone, reverse-engineer, replicate, or extract design systems from any modern website into a local directory.

## Terminal Slash Commands & Modes

When running `webcmd clone`, you can select interactive modes or type slash commands directly:

| Command | Superpower & Artifacts Generated |
| :--- | :--- |
| **`/design <url>`** | **Extracts Design Tokens (`tokens.json`), Color Palette, Typography, Tailwind Theme (`tailwind.theme.js`), Interactive Showcase (`preview.html`), and generates a reusable AI Prompt Skill (`design-<site>/SKILL.md`)** |
| **`/react <url>`** | Automatically decomposes the website into **modular React (TSX) + Tailwind CSS components** (`./react/src/App.tsx`) |
| **`/diff <url>`** | Generates a **Pixel-Perfect Visual Diff Comparison Slider** (`./verify.html`) with fidelity percentage score |
| **`/zip <url>`** | Packages the cloned website into a portable **`.zip` archive** |
| **`/clone <url>`** | Standard full site clone with formatted HTML & local assets |

---

## Direct CLI Usage

```bash
# 1. Extract Design System & Generate AI Design Skill:
webcmd clone https://linear.app -o ./clones/linear --design-system

# 2. Decompose site into React + Tailwind Components:
webcmd clone https://stripe.com -o ./clones/stripe --to-react

# 3. Generate Visual Diff Comparison Slider:
webcmd clone https://webcmd.dev -o ./clones/webcmd --verify

# 4. Run All-in-One Superpower Bundle:
webcmd clone https://news.ycombinator.com -o ./clones/hn --design-system --to-react --verify --zip
```

---

## Generated Design System Structure

```
clones/<site-name>/
├── index.html              # Hydrated & Prettified HTML
├── metadata.json           # Assets breakdown & duration
├── design-system/          # (Generated via --design-system / /design)
│   ├── tokens.json         # Standard W3C Design Tokens format
│   ├── design-tokens.css   # CSS Custom Properties (:root variables)
│   ├── tailwind.theme.js   # Ready-to-use Tailwind theme preset
│   ├── DesignSystem.md     # Markdown Style Guide with color swatches
│   ├── preview.html        # Interactive Storybook-like Component Showcase
│   └── DESIGN_SKILL.md     # AI Prompt Skill for generating UIs in this style
├── react/                  # (Generated via --to-react / /react)
│   ├── src/
│   │   ├── App.tsx
│   │   └── components/     # Decomposed TSX components
│   └── tailwind.config.js
└── verify.html             # (Generated via --verify / /diff)
```
