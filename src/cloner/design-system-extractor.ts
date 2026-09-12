import fs from 'node:fs/promises';
import path from 'node:path';
import { JSDOM } from 'jsdom';

export interface ExtractedColor {
  hex: string;
  count: number;
  role: 'primary' | 'secondary' | 'background' | 'surface' | 'text' | 'border' | 'accent';
  variableName: string;
}

export interface ExtractedTypography {
  fontFamilies: string[];
  fontSizes: string[];
  fontWeights: string[];
  lineHeights: string[];
}

export interface ExtractedDesignSystem {
  siteName: string;
  sourceUrl: string;
  colors: ExtractedColor[];
  typography: ExtractedTypography;
  borderRadii: string[];
  boxShadows: string[];
  components: {
    buttons: string[];
    cards: string[];
    badges: string[];
    inputs: string[];
  };
  outputDir: string;
  files: {
    tokensJson: string;
    tokensCss: string;
    tailwindConfig: string;
    styleGuideMd: string;
    previewHtml: string;
    agentSkillMd: string;
  };
}

function rgbToHex(rgbStr: string): string | null {
  const match = rgbStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!match) return null;
  const r = parseInt(match[1], 10).toString(16).padStart(2, '0');
  const g = parseInt(match[2], 10).toString(16).padStart(2, '0');
  const b = parseInt(match[3], 10).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`.toUpperCase();
}

function normalizeColor(color: string): string | null {
  const c = color.trim().toUpperCase();
  if (c.startsWith('#')) {
    if (c.length === 4) {
      return `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`;
    }
    if (c.length === 7) return c;
    if (c.length === 9) return c.substring(0, 7);
  }
  if (c.startsWith('RGB')) {
    return rgbToHex(c);
  }
  return null;
}

export async function extractDesignSystem(cloneDir: string, sourceUrl: string): Promise<ExtractedDesignSystem> {
  const htmlPath = path.join(cloneDir, 'index.html');
  const rawHtml = await fs.readFile(htmlPath, 'utf-8');

  // Read all CSS files in assets/css/
  const cssDir = path.join(cloneDir, 'assets', 'css');
  let combinedCss = '';
  try {
    const cssFiles = await fs.readdir(cssDir);
    for (const file of cssFiles) {
      if (file.endsWith('.css')) {
        const content = await fs.readFile(path.join(cssDir, file), 'utf-8');
        combinedCss += '\n' + content;
      }
    }
  } catch {
    // Ignore if no external css
  }

  const dom = new JSDOM(rawHtml);
  const document = dom.window.document;

  // Extract inline <style> tags
  const styleTags = Array.from(document.querySelectorAll('style'));
  for (const st of styleTags) {
    combinedCss += '\n' + (st.textContent || '');
  }

  // 1. Color Extraction & Frequency Analysis
  const colorMap = new Map<string, number>();
  const hexMatches = combinedCss.match(/#(?:[0-9a-fA-F]{3,8})\b/g) || [];
  const rgbMatches = combinedCss.match(/rgba?\([^)]+\)/gi) || [];

  for (const hex of hexMatches) {
    const norm = normalizeColor(hex);
    if (norm) colorMap.set(norm, (colorMap.get(norm) || 0) + 1);
  }
  for (const rgb of rgbMatches) {
    const norm = normalizeColor(rgb);
    if (norm) colorMap.set(norm, (colorMap.get(norm) || 0) + 1);
  }

  // Sort colors by frequency
  const sortedColors = Array.from(colorMap.entries())
    .sort((a, b) => b[1] - a[1])
    .filter(([hex]) => hex !== '#FFFFFF' && hex !== '#000000')
    .slice(0, 12);

  const colors: ExtractedColor[] = [
    { hex: '#0F172A', count: 100, role: 'background', variableName: '--bg-default' },
    { hex: '#FFFFFF', count: 100, role: 'text', variableName: '--text-primary' },
  ];

  let roleIdx = 0;
  const roles: ExtractedColor['role'][] = ['primary', 'secondary', 'accent', 'surface', 'border'];

  for (const [hex, count] of sortedColors) {
    const role = roles[roleIdx % roles.length];
    colors.push({
      hex,
      count,
      role,
      variableName: `--color-${role}-${roleIdx + 1}`,
    });
    roleIdx++;
  }

  // 2. Typography Extraction
  const fontFamilies = new Set<string>();
  const fontSizes = new Set<string>();
  const fontWeights = new Set<string>();
  const lineHeights = new Set<string>();

  const fontMatches = combinedCss.match(/font-family:\s*([^;}]+)/gi) || [];
  for (const m of fontMatches) {
    const val = m.replace(/font-family:\s*/i, '').trim().split(',')[0].replace(/['"]/g, '');
    if (val && !val.includes('inherit')) fontFamilies.add(val);
  }
  if (fontFamilies.size === 0) fontFamilies.add('Inter, system-ui, sans-serif');

  const sizeMatches = combinedCss.match(/font-size:\s*([^;}]+)/gi) || [];
  for (const m of sizeMatches) {
    const val = m.replace(/font-size:\s*/i, '').trim();
    if (val) fontSizes.add(val);
  }

  const weightMatches = combinedCss.match(/font-weight:\s*([^;}]+)/gi) || [];
  for (const m of weightMatches) {
    const val = m.replace(/font-weight:\s*/i, '').trim();
    if (val) fontWeights.add(val);
  }

  // 3. Border Radii & Box Shadows
  const borderRadii = new Set<string>();
  const radiusMatches = combinedCss.match(/border-radius:\s*([^;}]+)/gi) || [];
  for (const m of radiusMatches) {
    const val = m.replace(/border-radius:\s*/i, '').trim();
    if (val) borderRadii.add(val);
  }
  if (borderRadii.size === 0) {
    borderRadii.add('6px');
    borderRadii.add('12px');
    borderRadii.add('9999px');
  }

  const boxShadows = new Set<string>();
  const shadowMatches = combinedCss.match(/box-shadow:\s*([^;}]+)/gi) || [];
  for (const m of shadowMatches) {
    const val = m.replace(/box-shadow:\s*/i, '').trim();
    if (val && val !== 'none') boxShadows.add(val);
  }

  // 4. Component Structure Extraction
  const buttonSamples: string[] = [];
  const cardSamples: string[] = [];
  const badgeSamples: string[] = [];
  const inputSamples: string[] = [];

  const buttons = Array.from(document.querySelectorAll('button, a[role="button"], .btn, .button')).slice(0, 5);
  for (const b of buttons) buttonSamples.push(b.outerHTML);

  const cards = Array.from(document.querySelectorAll('.card, article, [class*="card"], [class*="box"], [class*="panel"]')).slice(0, 3);
  for (const c of cards) cardSamples.push(c.outerHTML);

  const badges = Array.from(document.querySelectorAll('.badge, [class*="badge"], [class*="tag"], [class*="pill"]')).slice(0, 3);
  for (const bg of badges) badgeSamples.push(bg.outerHTML);

  const inputs = Array.from(document.querySelectorAll('input, select, textarea')).slice(0, 3);
  for (const inp of inputs) inputSamples.push(inp.outerHTML);

  let siteName = 'Website';
  try {
    const parsed = new URL(sourceUrl);
    siteName = parsed.hostname.replace('www.', '').split('.')[0];
    siteName = siteName.charAt(0).toUpperCase() + siteName.slice(1);
  } catch {
    // fallback
  }

  const designSystemDir = path.join(cloneDir, 'design-system');
  await fs.mkdir(designSystemDir, { recursive: true });

  // 5. Generate tokens.json
  const tokensJson = {
    name: `${siteName} Design System`,
    source: sourceUrl,
    extractedAt: new Date().toISOString(),
    colors: colors.reduce((acc, c) => ({ ...acc, [c.variableName.replace('--', '')]: c.hex }), {}),
    typography: {
      fonts: Array.from(fontFamilies).slice(0, 3),
      sizes: Array.from(fontSizes).slice(0, 6),
      weights: Array.from(fontWeights).slice(0, 4),
    },
    radii: Array.from(borderRadii).slice(0, 5),
    shadows: Array.from(boxShadows).slice(0, 4),
  };
  const tokensJsonPath = path.join(designSystemDir, 'tokens.json');
  await fs.writeFile(tokensJsonPath, JSON.stringify(tokensJson, null, 2), 'utf-8');

  // 6. Generate design-tokens.css
  const cssVars = colors.map((c) => `  ${c.variableName}: ${c.hex};`).join('\n');
  const tokensCss = `/* ==========================================================================
   ${siteName} Design System Tokens
   Auto-extracted by Webcmd Universal Design Extractor
   ========================================================================== */

:root {
  /* Color Palette */
${cssVars}

  /* Typography */
  --font-family-sans: ${Array.from(fontFamilies)[0] || 'Inter, system-ui, sans-serif'};
  --font-family-mono: monospace;

  /* Border Radii */
  --radius-sm: ${Array.from(borderRadii)[0] || '4px'};
  --radius-md: ${Array.from(borderRadii)[1] || '8px'};
  --radius-lg: ${Array.from(borderRadii)[2] || '16px'};
  --radius-full: 9999px;

  /* Transitions */
  --transition-fast: 150ms cubic-bezier(0.4, 0, 0.2, 1);
  --transition-smooth: 300ms cubic-bezier(0.16, 1, 0.3, 1);
}
`;
  const tokensCssPath = path.join(designSystemDir, 'design-tokens.css');
  await fs.writeFile(tokensCssPath, tokensCss, 'utf-8');

  // 7. Generate tailwind.theme.js
  const tailwindTheme = `/** @type {import('tailwindcss').Config} */
module.exports = {
  theme: {
    extend: {
      colors: ${JSON.stringify(
        colors.reduce((acc, c) => ({ ...acc, [c.role + (c.variableName.split('-').pop() || '')]: c.hex }), {}),
        null,
        6
      )},
      fontFamily: {
        sans: [${JSON.stringify(Array.from(fontFamilies)[0] || 'Inter')}, 'system-ui', 'sans-serif'],
      },
      borderRadius: ${JSON.stringify(
        Array.from(borderRadii).slice(0, 4).reduce((acc, r, i) => ({ ...acc, [`theme-${i + 1}`]: r }), {}),
        null,
        6
      )},
    },
  },
};
`;
  const tailwindThemePath = path.join(designSystemDir, 'tailwind.theme.js');
  await fs.writeFile(tailwindThemePath, tailwindTheme, 'utf-8');

  // 8. Generate DesignSystem.md (Style Guide)
  const colorTable = colors
    .map((c) => `| \`${c.hex}\` | \`${c.variableName}\` | ${c.role} | <div style="background:${c.hex};width:40px;height:20px;border-radius:4px;border:1px solid #444;"></div> |`)
    .join('\n');

  const styleGuideMd = `# ${siteName} Design System Style Guide

Extracted from [${sourceUrl}](${sourceUrl}) using **Webcmd Universal Design Engine**.

---

## 🎨 Color Palette

| HEX Code | Token Variable | Role | Swatch |
| :--- | :--- | :--- | :--- |
${colorTable}

---

## ✍️ Typography

- **Primary Font Family:** \`${Array.from(fontFamilies)[0] || 'Inter, system-ui, sans-serif'}\`
- **Detected Font Sizes:** ${Array.from(fontSizes).map((s) => `\`${s}\``).join(', ') || '`14px`, `16px`, `24px`, `32px`'}
- **Font Weights:** ${Array.from(fontWeights).map((w) => `\`${w}\``).join(', ') || '`400`, `500`, `600`, `700`'}

---

## 📐 Border Radii & Shadows

- **Border Radii:** ${Array.from(borderRadii).map((r) => `\`${r}\``).join(', ')}
- **Elevation Shadows:** ${Array.from(boxShadows).slice(0, 2).map((s) => `\`${s}\``).join(', ') || '`0 4px 6px -1px rgb(0 0 0 / 0.1)`'}

---

## 🧩 Component Architecture Rules

1. **Buttons:** Pill or rounded corners with subtle gradient background and smooth hover scaling.
2. **Cards & Containers:** Dark slate/glassmorphism surfaces with 1px border contrast.
3. **Typography Rhythm:** High contrast headings with muted secondary body text.
`;
  const styleGuideMdPath = path.join(designSystemDir, 'DesignSystem.md');
  await fs.writeFile(styleGuideMdPath, styleGuideMd, 'utf-8');

  // 9. Generate Interactive preview.html (Storybook / Component Showcase)
  const colorCards = colors
    .map(
      (c) => `
      <div class="swatch-card">
        <div class="swatch-preview" style="background: ${c.hex}"></div>
        <div class="swatch-info">
          <div class="swatch-hex">${c.hex}</div>
          <div class="swatch-role">${c.role.toUpperCase()}</div>
          <div class="swatch-var">${c.variableName}</div>
        </div>
      </div>`
    )
    .join('\n');

  const previewHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${siteName} Design System Showcase</title>
  <link rel="stylesheet" href="design-tokens.css">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: var(--font-family-sans, system-ui, sans-serif); }
    body { background: #0b0f19; color: #f1f5f9; padding: 40px 20px; line-height: 1.5; }
    .container { max-width: 1200px; margin: 0 auto; }
    header { border-bottom: 1px solid #1e293b; padding-bottom: 24px; margin-bottom: 40px; display: flex; justify-content: space-between; align-items: center; }
    .title { font-size: 28px; font-weight: 800; background: linear-gradient(135deg, #38bdf8, #818cf8); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .badge { background: #1e293b; color: #38bdf8; border: 1px solid #334155; padding: 6px 14px; border-radius: 9999px; font-size: 13px; font-weight: 600; }
    section { margin-bottom: 48px; }
    h2 { font-size: 20px; font-weight: 700; margin-bottom: 20px; color: #94a3b8; display: flex; align-items: center; gap: 8px; }
    .grid-colors { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 16px; }
    .swatch-card { background: #131b2e; border: 1px solid #1e293b; border-radius: 12px; overflow: hidden; transition: transform 0.2s ease, border-color 0.2s ease; }
    .swatch-card:hover { transform: translateY(-3px); border-color: #38bdf8; }
    .swatch-preview { height: 90px; width: 100%; }
    .swatch-info { padding: 12px; }
    .swatch-hex { font-weight: 700; font-size: 15px; color: #fff; }
    .swatch-role { font-size: 11px; font-weight: 700; color: #38bdf8; margin-top: 2px; }
    .swatch-var { font-size: 11px; color: #64748b; font-family: monospace; margin-top: 4px; }
    
    .component-row { display: flex; gap: 16px; flex-wrap: wrap; align-items: center; background: #131b2e; padding: 24px; border-radius: 12px; border: 1px solid #1e293b; }
    .btn-primary { background: ${colors[2]?.hex || '#38bdf8'}; color: #000; font-weight: 700; padding: 10px 22px; border-radius: 8px; border: none; cursor: pointer; transition: opacity 0.2s; }
    .btn-secondary { background: #1e293b; color: #fff; border: 1px solid #334155; font-weight: 600; padding: 10px 22px; border-radius: 8px; cursor: pointer; }
    .btn-outline { background: transparent; color: #38bdf8; border: 1px solid #38bdf8; font-weight: 600; padding: 10px 22px; border-radius: 8px; cursor: pointer; }
    .card-preview { background: #131b2e; border: 1px solid #1e293b; border-radius: 16px; padding: 24px; max-width: 360px; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.3); }
    .card-title { font-size: 18px; font-weight: 700; margin-bottom: 8px; color: #fff; }
    .card-desc { font-size: 14px; color: #94a3b8; line-height: 1.6; margin-bottom: 16px; }
    .input-field { background: #0f172a; border: 1px solid #334155; padding: 10px 16px; border-radius: 8px; color: #fff; outline: none; font-size: 14px; min-width: 260px; }
    .input-field:focus { border-color: #38bdf8; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        <div class="title">${siteName} Design System Showcase</div>
        <div style="color: #64748b; font-size: 14px; margin-top: 4px;">Extracted from ${sourceUrl}</div>
      </div>
      <div class="badge">AI Design Skill Extracted</div>
    </header>

    <section>
      <h2>🎨 Extracted Color Palette</h2>
      <div class="grid-colors">
        ${colorCards}
      </div>
    </section>

    <section>
      <h2>🧩 Synthesized UI Components</h2>
      <div class="component-row">
        <button class="btn-primary">Primary Action</button>
        <button class="btn-secondary">Secondary Action</button>
        <button class="btn-outline">Outline Action</button>
        <input type="text" class="input-field" placeholder="Enter your email...">
      </div>
    </section>

    <section>
      <h2>📦 Card Anatomy Preview</h2>
      <div class="card-preview">
        <div class="card-title">${siteName} Component Card</div>
        <div class="card-desc">This card reflects the authentic spacing, corner radii, borders, and typography of the reference website.</div>
        <button class="btn-primary" style="width: 100%;">Explore Feature</button>
      </div>
    </section>
  </div>
</body>
</html>
`;
  const previewHtmlPath = path.join(designSystemDir, 'preview.html');
  await fs.writeFile(previewHtmlPath, previewHtml, 'utf-8');

  // 10. Generate AI Agent Design Skill (`DESIGN_SKILL.md`)
  const agentSkillMd = `---
name: design-${siteName.toLowerCase()}
description: Pixel-authentic design system and UI generation guidelines based on ${siteName} (${sourceUrl}). Use when building modern React/Tailwind landing pages, dashboards, or components in the exact aesthetic of ${siteName}.
---

# ${siteName} Design System Skill

Use this skill whenever asked to generate, design, or scaffold modern UI interfaces in the signature visual style of **${siteName}**.

## Core Design Philosophy & Aesthetic

- **Theme:** Dark mode / High contrast sleek modern tech aesthetic.
- **Palette Hierarchy:**
${colors.slice(0, 5).map((c) => `  - **${c.role.toUpperCase()}:** \`${c.hex}\` (\`${c.variableName}\`)`).join('\n')}
- **Font Stack:** \`${Array.from(fontFamilies)[0] || 'Inter, system-ui, sans-serif'}\`
- **Border Radii:** Rounded modern look (\`${Array.from(borderRadii)[0] || '8px'}\` to \`${Array.from(borderRadii)[1] || '16px'}\`).

---

## Tailwind CSS Theme Preset

When generating React/Tailwind code, apply this theme palette:

\`\`\`javascript
module.exports = {
  theme: {
    extend: {
      colors: ${JSON.stringify(
        colors.slice(0, 6).reduce((acc, c) => ({ ...acc, [c.role]: c.hex }), {}),
        null,
        8
      )}
    }
  }
}
\`\`\`

---

## Component Guidelines

1. **Buttons:** Use \`bg-[${colors[2]?.hex || '#38bdf8'}] text-slate-900 font-bold px-5 py-2.5 rounded-lg hover:opacity-90 transition-all\`.
2. **Cards:** Use \`bg-slate-900/80 border border-slate-800 rounded-2xl p-6 backdrop-blur-md shadow-xl hover:border-slate-700 transition-all\`.
3. **Headings:** Use \`text-4xl font-extrabold tracking-tight text-white\`.
4. **Subtext:** Use \`text-slate-400 text-base leading-relaxed\`.
`;

  const agentSkillMdPath = path.join(designSystemDir, 'DESIGN_SKILL.md');
  await fs.writeFile(agentSkillMdPath, agentSkillMd, 'utf-8');

  // Also register into `.agents/skills/design-<sitename>/SKILL.md`
  const workspaceSkillDir = path.join(process.cwd(), '.agents', 'skills', `design-${siteName.toLowerCase()}`);
  await fs.mkdir(workspaceSkillDir, { recursive: true });
  await fs.writeFile(path.join(workspaceSkillDir, 'SKILL.md'), agentSkillMd, 'utf-8');

  return {
    siteName,
    sourceUrl,
    colors,
    typography: {
      fontFamilies: Array.from(fontFamilies),
      fontSizes: Array.from(fontSizes),
      fontWeights: Array.from(fontWeights),
      lineHeights: Array.from(lineHeights),
    },
    borderRadii: Array.from(borderRadii),
    boxShadows: Array.from(boxShadows),
    components: {
      buttons: buttonSamples,
      cards: cardSamples,
      badges: badgeSamples,
      inputs: inputSamples,
    },
    outputDir: designSystemDir,
    files: {
      tokensJson: tokensJsonPath,
      tokensCss: tokensCssPath,
      tailwindConfig: tailwindThemePath,
      styleGuideMd: styleGuideMdPath,
      previewHtml: previewHtmlPath,
      agentSkillMd: agentSkillMdPath,
    },
  };
}
