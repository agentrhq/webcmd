# @webcmd/cloner 🌐

> **Universal Website Cloner with Interactive Ink TUI, React + Tailwind TSX Synthesis, and W3C Design Tokens**

`@webcmd/cloner` is an executive-grade website cloner and DOM synthesis engine built with Puppeteer, React, and **Ink**. It downloads complete website pages and dynamically converts them into modular React components, W3C Design Tokens, Figma tokens, and accessibility reports.

---

## 💻 Interactive Terminal UI (Ink TUI)

Launch the interactive terminal interface:
```bash
npm run clone
```
Or run directly with a target URL:
```bash
npx tsx src/cli.ts https://example.com
```

### Slash Commands in the TUI:
* `/react <url>` — Synthesize modular **React + Tailwind** components (`Navbar.tsx`, `Sections.tsx`, `App.tsx`).
* `/design <url>` — Extract **11-step Color Scales & W3C DTCG Tokens** for Figma Design Tokens Manager.
* `/audit <url>` — Perform automated **WCAG 2.1 Contrast & Accessibility Audits**.
* `/clone <url>` — Complete offline replication with all CSS, images, and fonts bundled.

---

## ⚡ CLI Flags

```text
USAGE:
  webcmd-clone [url] [options]

OPTIONS:
  -o, --output <dir>      Destination output directory
  -t, --timeout <ms>      Navigation timeout in ms (default: 45000)
  --no-scroll             Disable auto-scrolling
  --no-scripts            Exclude dynamic script tags
  --design-system         Extract Color Palette & Figma W3C tokens
  --to-react              Decompose cloned site into React TSX components
  --verify                Generate pixel-perfect visual diff comparison
  --zip                   Package cloned site into a portable ZIP archive
  -s, --serve             Launch local preview server after cloning (default: true)
  -p, --port <port>       Server port for preview (default: 3000)
```

---

## 🏗️ Architecture

```text
webcmd-cloner/
├── src/
│   ├── ui/
│   │   ├── App.tsx                    # Full Ink React interactive terminal interface
│   │   └── index.tsx                  # Ink render entry point
│   ├── cloner.ts                      # Core Puppeteer cloner & asset downloader
│   ├── react-converter.ts             # DOM AST parser synthesizing React components
│   ├── design-system-extractor.ts     # Color & W3C DTCG design token extractor
│   ├── visual-verifier.ts             # Screenshot capture & pixel diff analysis
│   ├── zip-bundler.ts                 # ZIP packaging
│   └── cli.ts                         # Commander CLI runner
└── package.json
```
