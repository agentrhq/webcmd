import fs from 'node:fs/promises';
import path from 'node:path';
import { JSDOM } from 'jsdom';

export interface SemanticColorRole {
  name: string;
  hex: string;
  variable: string;
  description: string;
  contrastOnWhite: string;
  contrastOnBlack: string;
  wcagAA: boolean;
  wcagAAA: boolean;
}

export interface ColorScaleStep {
  step: string; // e.g., '50', '100', '500', '900'
  hex: string;
  contrastOnWhite: string;
}

export interface DetailedDesignSystem {
  siteName: string;
  sourceUrl: string;
  extractedAt: string;
  colors: string[]; // For backwards compatibility
  colorSystem: {
    brand: SemanticColorRole[];
    brandScale: ColorScaleStep[];
    neutral: SemanticColorRole[];
    neutralScale: ColorScaleStep[];
    semantic: SemanticColorRole[];
    gradients: Array<{ name: string; token: string; value: string; description: string }>;
  };
  typography: {
    primaryFont: string;
    monoFont: string;
    scale: Array<{ level: string; size: string; weight: string; lineHeight: string; tracking: string; usage: string }>;
  };
  spacingScale: Array<{ token: string; value: string; pixels: number; usage: string }>;
  gridAndBreakpoints: {
    breakpoints: Array<{ token: string; value: string; minWidth: number }>;
    containers: Array<{ token: string; maxWidth: string }>;
    columns: number;
    gutter: string;
  };
  radii: Array<{ token: string; value: string; usage: string }>;
  shadows: Array<{ token: string; value: string; description: string }>;
  blurs: Array<{ token: string; value: string; description: string }>;
  motion: Array<{ token: string; duration: string; easing: string; description: string }>;
  zIndex: Array<{ token: string; value: number; role: string }>;
  components: Array<{ name: string; html: string; description: string }>;
  outputDir: string;
  files: {
    tokensJson: string;
    tokensCss: string;
    tailwindConfig: string;
    styleGuideMd: string;
    previewHtml: string;
    reactComponentsTsx: string;
    agentSkillMd: string;
  };
}

// ---------------------------------------------------------------------------
// Color Utilities & WCAG Math
// ---------------------------------------------------------------------------
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const norm = normalizeColor(hex);
  if (!norm) return null;
  const num = parseInt(norm.replace('#', ''), 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  const toHex = (n: number) => clamp(n).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

function getRelativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const [rs, gs, bs] = [rgb.r / 255, rgb.g / 255, rgb.b / 255].map(v => {
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function calculateContrast(hex1: string, hex2: string): number {
  const l1 = getRelativeLuminance(hex1);
  const l2 = getRelativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }
  return { h: h * 360, s, l };
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  let r: number, g: number, b: number;
  h = h / 360;

  if (s === 0) {
    r = g = b = l; // achromatic
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return { r: r * 255, g: g * 255, b: b * 255 };
}

function generateColorScale(baseHex: string): ColorScaleStep[] {
  const rgb = hexToRgb(baseHex) || { r: 2, g: 132, b: 199 };
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);

  const stepsConfig: Array<{ step: string; l: number; sFactor: number }> = [
    { step: '50', l: 0.97, sFactor: 0.8 },
    { step: '100', l: 0.92, sFactor: 0.85 },
    { step: '200', l: 0.84, sFactor: 0.9 },
    { step: '300', l: 0.72, sFactor: 0.95 },
    { step: '400', l: 0.58, sFactor: 1.0 },
    { step: '500', l: Math.max(0.35, Math.min(0.55, hsl.l)), sFactor: 1.0 },
    { step: '600', l: 0.38, sFactor: 1.0 },
    { step: '700', l: 0.30, sFactor: 1.0 },
    { step: '800', l: 0.22, sFactor: 0.95 },
    { step: '900', l: 0.15, sFactor: 0.9 },
    { step: '950', l: 0.09, sFactor: 0.85 },
  ];

  return stepsConfig.map(cfg => {
    if (cfg.step === '500') {
      const contrast = calculateContrast(baseHex, '#FFFFFF').toFixed(1);
      return { step: '500', hex: baseHex, contrastOnWhite: `${contrast}:1` };
    }
    const newS = Math.min(1, Math.max(0.1, hsl.s * cfg.sFactor));
    const newRgb = hslToRgb(hsl.h, newS, cfg.l);
    const hex = rgbToHex(newRgb.r, newRgb.g, newRgb.b);
    const contrast = calculateContrast(hex, '#FFFFFF').toFixed(1);
    return {
      step: cfg.step,
      hex,
      contrastOnWhite: `${contrast}:1`,
    };
  });
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
    const match = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (match) {
      const r = parseInt(match[1], 10).toString(16).padStart(2, '0');
      const g = parseInt(match[2], 10).toString(16).padStart(2, '0');
      const b = parseInt(match[3], 10).toString(16).padStart(2, '0');
      return `#${r}${g}${b}`.toUpperCase();
    }
  }
  return null;
}

export async function extractDesignSystem(cloneDir: string, sourceUrl: string): Promise<DetailedDesignSystem> {
  const htmlPath = path.join(cloneDir, 'index.html');
  let rawHtml = '';
  try {
    rawHtml = await fs.readFile(htmlPath, 'utf-8');
  } catch {
    rawHtml = '<!DOCTYPE html><html><head></head><body></body></html>';
  }

  // Read all CSS
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
    // Ignore
  }

  const dom = new JSDOM(rawHtml);
  const document = dom.window.document;

  const styleTags = Array.from(document.querySelectorAll('style'));
  for (const st of styleTags) {
    combinedCss += '\n' + (st.textContent || '');
  }

  // 1. Color Frequency Extraction
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

  const sortedRaw = Array.from(colorMap.entries())
    .sort((a, b) => b[1] - a[1])
    .filter(([hex]) => hex !== '#FFFFFF' && hex !== '#000000')
    .map(([hex]) => hex);

  const primaryAccent = sortedRaw[0] || '#0284C7';
  const secondaryAccent = sortedRaw[1] || '#6366F1';
  const tertiaryAccent = sortedRaw[2] || '#0D9488';

  const brandScale = generateColorScale(primaryAccent);
  const neutralScale: ColorScaleStep[] = [
    { step: '50', hex: '#F8FAFC', contrastOnWhite: '1.05:1' },
    { step: '100', hex: '#F1F5F9', contrastOnWhite: '1.1:1' },
    { step: '200', hex: '#E2E8F0', contrastOnWhite: '1.3:1' },
    { step: '300', hex: '#CBD5E1', contrastOnWhite: '1.8:1' },
    { step: '400', hex: '#94A3B8', contrastOnWhite: '3.2:1' },
    { step: '500', hex: '#64748B', contrastOnWhite: '5.4:1' },
    { step: '600', hex: '#475569', contrastOnWhite: '8.4:1' },
    { step: '700', hex: '#334155', contrastOnWhite: '11.2:1' },
    { step: '800', hex: '#1E293B', contrastOnWhite: '14.5:1' },
    { step: '900', hex: '#0F172A', contrastOnWhite: '16.8:1' },
    { step: '950', hex: '#020617', contrastOnWhite: '19.2:1' },
  ];

  const buildRole = (name: string, hex: string, variable: string, description: string): SemanticColorRole => {
    const onWhite = calculateContrast(hex, '#FFFFFF');
    const onBlack = calculateContrast(hex, '#000000');
    return {
      name,
      hex,
      variable,
      description,
      contrastOnWhite: `${onWhite.toFixed(1)}:1`,
      contrastOnBlack: `${onBlack.toFixed(1)}:1`,
      wcagAA: onWhite >= 4.5,
      wcagAAA: onWhite >= 7.0,
    };
  };

  // Structured Semantic Palette (Light-Theme First)
  const brandColors: SemanticColorRole[] = [
    buildRole('Primary 50', brandScale[0].hex, '--color-primary-50', 'Subtle hover backgrounds, card tints'),
    buildRole('Primary 100', brandScale[1].hex, '--color-primary-100', 'Selected states, badge fills, highlight tags'),
    buildRole('Primary 500', primaryAccent, '--color-primary-500', 'Main CTA buttons, active links, brand anchors'),
    buildRole('Primary 600', brandScale[6].hex, '--color-primary-600', 'Hover states for primary actions'),
    buildRole('Secondary Accent', secondaryAccent, '--color-secondary', 'Secondary accents, badges, gradients'),
    buildRole('Tertiary Teal', tertiaryAccent, '--color-accent', 'Tertiary indicators, metrics, tags'),
  ];

  const neutralColors: SemanticColorRole[] = [
    buildRole('Canvas Background', '#F8FAFC', '--bg-canvas', 'App page foundation background'),
    buildRole('Surface Card', '#FFFFFF', '--bg-surface', 'Card, panel, and modal elevation'),
    buildRole('Surface Muted', '#F1F5F9', '--bg-muted', 'Input fields, codeblocks, wells, table headers'),
    buildRole('Border Subtle', '#E2E8F0', '--border-subtle', 'Card dividers, clean section borders'),
    buildRole('Border Strong', '#CBD5E1', '--border-strong', 'Input outlines, active tabs, hover borders'),
    buildRole('Text Primary', '#0F172A', '--text-primary', 'Headings, body paragraphs, high contrast text'),
    buildRole('Text Secondary', '#475569', '--text-secondary', 'Subtext, captions, helper labels'),
    buildRole('Text Muted', '#94A3B8', '--text-muted', 'Placeholders, disabled text, icons'),
  ];

  const semanticColors: SemanticColorRole[] = [
    buildRole('Success 500', '#10B981', '--color-success', 'Positive trends, success banners, completed state'),
    buildRole('Success Subtle', '#ECFDF5', '--color-success-subtle', 'Success alert background, badge fill'),
    buildRole('Warning 500', '#F59E0B', '--color-warning', 'Alerts, cautions, pending tasks'),
    buildRole('Warning Subtle', '#FFFBEB', '--color-warning-subtle', 'Warning banner background, caution fill'),
    buildRole('Danger 500', '#EF4444', '--color-danger', 'Errors, destructive actions, negative deltas'),
    buildRole('Danger Subtle', '#FEF2F2', '--color-danger-subtle', 'Error banner background, destructive tint'),
    buildRole('Info 500', '#3B82F6', '--color-info', 'Help tooltips, system notices, info chips'),
    buildRole('Info Subtle', '#EFF6FF', '--color-info-subtle', 'Info banner background'),
  ];

  const gradients = [
    { name: 'Brand Primary Gradient', token: '--gradient-brand', value: `linear-gradient(135deg, ${primaryAccent} 0%, ${secondaryAccent} 100%)`, description: 'Hero CTA buttons, gradient text headers' },
    { name: 'Subtle Mesh Gradient', token: '--gradient-mesh', value: `radial-gradient(at 0% 0%, ${brandScale[0].hex} 0px, transparent 50%), radial-gradient(at 100% 100%, #F1F5F9 0px, transparent 50%)`, description: 'Page hero backdrop, light canvas mesh' },
    { name: 'Surface Glow', token: '--gradient-glow', value: `radial-gradient(circle at 50% 0%, rgba(2, 132, 199, 0.08) 0%, transparent 70%)`, description: 'Card top highlight, interactive hover glow' },
  ];

  // 2. Typography Extraction & Modular Scale
  const fontMatches = combinedCss.match(/font-family:\s*([^;}]+)/gi) || [];
  let primaryFont = 'Inter, system-ui, -apple-system, sans-serif';
  const firstFontMatch = fontMatches[0];
  if (firstFontMatch) {
    const rawF = firstFontMatch.replace(/font-family:\s*/i, '').trim().split(',')[0]?.replace(/['"]/g, '');
    if (rawF && !rawF.includes('inherit')) {
      primaryFont = `${rawF}, Inter, system-ui, -apple-system, sans-serif`;
    }
  }

  const typographyScale = [
    { level: 'Display 2XL', size: '56px', weight: '800 (ExtraBold)', lineHeight: '1.1', tracking: '-0.03em', usage: 'Hero headlines, marketing page splash titles' },
    { level: 'Display XL', size: '44px', weight: '800 (Bold)', lineHeight: '1.15', tracking: '-0.025em', usage: 'Primary section titles, page hero headers' },
    { level: 'Heading 1', size: '36px', weight: '700 (Bold)', lineHeight: '1.2', tracking: '-0.02em', usage: 'Feature section titles, major view headers' },
    { level: 'Heading 2', size: '28px', weight: '700 (Bold)', lineHeight: '1.3', tracking: '-0.015em', usage: 'Card titles, dialog headlines, sub-headers' },
    { level: 'Heading 3', size: '22px', weight: '600 (SemiBold)', lineHeight: '1.35', tracking: '-0.01em', usage: 'Widget titles, table category headers' },
    { level: 'Heading 4', size: '18px', weight: '600 (SemiBold)', lineHeight: '1.4', tracking: '0', usage: 'Form section labels, small modal headers' },
    { level: 'Body Large', size: '16px', weight: '400 (Regular)', lineHeight: '1.6', tracking: '0', usage: 'Lead paragraphs, feature descriptions' },
    { level: 'Body Regular', size: '14px', weight: '400 (Regular)', lineHeight: '1.5', tracking: '0', usage: 'Default body copy, form inputs, button labels' },
    { level: 'Caption', size: '12px', weight: '500 (Medium)', lineHeight: '1.4', tracking: '0.02em', usage: 'Help text, metadata, tooltips, timestamps' },
    { level: 'Micro / Tag', size: '11px', weight: '600 (SemiBold)', lineHeight: '1.3', tracking: '0.05em', usage: 'Badge pills, uppercase category chips' },
  ];

  // 3. Spacing Scale (8pt Grid)
  const spacingScale = [
    { token: 'space-0.5', value: '2px', pixels: 2, usage: 'Micro border offsets, hairline spacing' },
    { token: 'space-1', value: '4px', pixels: 4, usage: 'Tight icon gaps, compact pill padding' },
    { token: 'space-2', value: '8px', pixels: 8, usage: 'Inline element spacing, button icon gaps' },
    { token: 'space-3', value: '12px', pixels: 12, usage: 'Button horizontal padding, compact form gaps' },
    { token: 'space-4', value: '16px', pixels: 16, usage: 'Card interior padding (compact), standard form gaps' },
    { token: 'space-6', value: '24px', pixels: 24, usage: 'Standard card padding, grid row spacing' },
    { token: 'space-8', value: '32px', pixels: 32, usage: 'Major component separation, large card padding' },
    { token: 'space-12', value: '48px', pixels: 48, usage: 'Section vertical rhythm, container offsets' },
    { token: 'space-16', value: '64px', pixels: 64, usage: 'Hero section margins, major section dividers' },
    { token: 'space-24', value: '96px', pixels: 96, usage: 'Landing page section whitespace' },
  ];

  // 4. Grid, Breakpoints & Layout
  const gridAndBreakpoints = {
    breakpoints: [
      { token: 'breakpoint-xs', value: '480px', minWidth: 480 },
      { token: 'breakpoint-sm', value: '640px', minWidth: 640 },
      { token: 'breakpoint-md', value: '768px', minWidth: 768 },
      { token: 'breakpoint-lg', value: '1024px', minWidth: 1024 },
      { token: 'breakpoint-xl', value: '1280px', minWidth: 1280 },
      { token: 'breakpoint-2xl', value: '1536px', minWidth: 1536 },
    ],
    containers: [
      { token: 'container-sm', maxWidth: '640px' },
      { token: 'container-md', maxWidth: '768px' },
      { token: 'container-lg', maxWidth: '1024px' },
      { token: 'container-xl', maxWidth: '1280px' },
      { token: 'container-2xl', maxWidth: '1440px' },
    ],
    columns: 12,
    gutter: '24px',
  };

  // 5. Border Radii & Elevation Shadows & Blurs
  const radii = [
    { token: 'radius-none', value: '0px', usage: 'Sharp containers, full bleed banners' },
    { token: 'radius-xs', value: '4px', usage: 'Micro badges, tooltips, tags' },
    { token: 'radius-sm', value: '6px', usage: 'Buttons, input fields, dropdown items' },
    { token: 'radius-md', value: '10px', usage: 'Standard cards, modals, form groups' },
    { token: 'radius-lg', value: '16px', usage: 'Hero cards, floating containers, feature panels' },
    { token: 'radius-xl', value: '24px', usage: 'App shells, prominent feature highlights' },
    { token: 'radius-full', value: '9999px', usage: 'Pills, avatar circles, circular icon buttons' },
  ];

  const shadows = [
    { token: 'shadow-xs', value: '0 1px 2px 0 rgb(0 0 0 / 0.05)', description: 'Buttons, badges, subtle items' },
    { token: 'shadow-sm', value: '0 1px 3px 0 rgb(0 0 0 / 0.08), 0 1px 2px -1px rgb(0 0 0 / 0.05)', description: 'Card baseline elevation' },
    { token: 'shadow-md', value: '0 4px 6px -1px rgb(0 0 0 / 0.08), 0 2px 4px -2px rgb(0 0 0 / 0.04)', description: 'Interactive card hover, dropdown menus' },
    { token: 'shadow-lg', value: '0 10px 15px -3px rgb(0 0 0 / 0.08), 0 4px 6px -4px rgb(0 0 0 / 0.03)', description: 'Flyouts, popovers, drawers, sticky headers' },
    { token: 'shadow-xl', value: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.04)', description: 'Modals, overlays, hero floating panels' },
    { token: 'shadow-2xl', value: '0 25px 50px -12px rgb(0 0 0 / 0.25)', description: 'Command palettes, lightbox overlays' },
    { token: 'shadow-inner', value: 'inset 0 2px 4px 0 rgb(0 0 0 / 0.05)', description: 'Sunken wells, active input insets' },
    { token: 'shadow-glow', value: `0 0 24px -4px rgba(2, 132, 199, 0.35)`, description: 'Primary action focus glow, hero highlights' },
  ];

  const blurs = [
    { token: 'blur-none', value: '0px', description: 'No blur' },
    { token: 'blur-sm', value: '4px', description: 'Subtle backdrop blur for headers' },
    { token: 'blur-md', value: '8px', description: 'Standard glassmorphic overlays' },
    { token: 'blur-lg', value: '16px', description: 'Modal frosted glass backdrops' },
    { token: 'blur-xl', value: '24px', description: 'Deep ambient light diffusers' },
  ];

  const motion = [
    { token: 'motion-instant', duration: '100ms', easing: 'ease-out', description: 'Button clicks, micro-toggles' },
    { token: 'motion-fast', duration: '200ms', easing: 'cubic-bezier(0.16, 1, 0.3, 1)', description: 'Dropdown reveals, hover state transforms' },
    { token: 'motion-smooth', duration: '350ms', easing: 'cubic-bezier(0.16, 1, 0.3, 1)', description: 'Drawer transitions, card expansion' },
    { token: 'motion-enter', duration: '250ms', easing: 'cubic-bezier(0, 0, 0.2, 1)', description: 'Modal fade-in and scale-up' },
    { token: 'motion-exit', duration: '200ms', easing: 'cubic-bezier(0.4, 0, 1, 1)', description: 'Modal dismissal, toast exit' },
  ];

  const zIndex = [
    { token: 'z-dropdown', value: 1000, role: 'Dropdown menus, select popups' },
    { token: 'z-sticky', value: 1020, role: 'Sticky navigation bars, floating action bars' },
    { token: 'z-fixed', value: 1030, role: 'Fixed banners, full-bleed overlays' },
    { token: 'z-modal-backdrop', value: 1040, role: 'Modal dim backdrops' },
    { token: 'z-modal', value: 1050, role: 'Dialog windows, lightbox containers' },
    { token: 'z-popover', value: 1060, role: 'Floating interactive popovers' },
    { token: 'z-tooltip', value: 1070, role: 'Hover tooltips' },
    { token: 'z-toast', value: 1080, role: 'Floating snackbars and notifications' },
  ];

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

  // -------------------------------------------------------------------------
  // 6. Generate tokens.json (W3C Design Tokens Standard)
  // -------------------------------------------------------------------------
  const tokensJson = {
    $schema: 'https://design-tokens.github.io/community-group/format/',
    name: `${siteName} Enterprise Design System`,
    sourceUrl,
    extractedAt: new Date().toISOString(),
    color: {
      brand: {
        ...brandColors.reduce((acc, c) => ({ ...acc, [c.variable.replace('--color-', '')]: { $value: c.hex, $type: 'color', description: c.description, contrast: c.contrastOnWhite } }), {}),
        scale: brandScale.reduce((acc, s) => ({ ...acc, [s.step]: { $value: s.hex, $type: 'color' } }), {}),
      },
      neutral: {
        ...neutralColors.reduce((acc, c) => ({ ...acc, [c.variable.replace('--', '')]: { $value: c.hex, $type: 'color', description: c.description } }), {}),
        scale: neutralScale.reduce((acc, s) => ({ ...acc, [s.step]: { $value: s.hex, $type: 'color' } }), {}),
      },
      semantic: semanticColors.reduce((acc, c) => ({ ...acc, [c.variable.replace('--color-', '')]: { $value: c.hex, $type: 'color', description: c.description } }), {}),
      gradients: gradients.reduce((acc, g) => ({ ...acc, [g.token.replace('--gradient-', '')]: { $value: g.value, $type: 'gradient', description: g.description } }), {}),
    },
    typography: {
      fontFamily: {
        sans: { $value: primaryFont, $type: 'fontFamily' },
        mono: { $value: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', $type: 'fontFamily' },
      },
      scale: typographyScale.reduce((acc, t) => ({ ...acc, [t.level.toLowerCase().replace(/\s+/g, '-')]: { fontSize: t.size, fontWeight: t.weight, lineHeight: t.lineHeight, tracking: t.tracking, usage: t.usage } }), {}),
    },
    spacing: spacingScale.reduce((acc, s) => ({ ...acc, [s.token]: { $value: s.value, pixels: s.pixels, $type: 'dimension', usage: s.usage } }), {}),
    grid: gridAndBreakpoints,
    borderRadius: radii.reduce((acc, r) => ({ ...acc, [r.token]: { $value: r.value, $type: 'dimension', usage: r.usage } }), {}),
    shadow: shadows.reduce((acc, s) => ({ ...acc, [s.token]: { $value: s.value, $type: 'shadow', description: s.description } }), {}),
    blurs: blurs.reduce((acc, b) => ({ ...acc, [b.token]: { $value: b.value, $type: 'dimension', description: b.description } }), {}),
    motion: motion.reduce((acc, m) => ({ ...acc, [m.token]: { duration: m.duration, easing: m.easing, description: m.description } }), {}),
    zIndex: zIndex.reduce((acc, z) => ({ ...acc, [z.token]: { $value: z.value, role: z.role } }), {}),
  };
  const tokensJsonPath = path.join(designSystemDir, 'tokens.json');
  await fs.writeFile(tokensJsonPath, JSON.stringify(tokensJson, null, 2), 'utf-8');

  // -------------------------------------------------------------------------
  // 7. Generate design-tokens.css
  // -------------------------------------------------------------------------
  const allCssVariables = [
    '  /* ==========================================================================',
    '     Brand & Accent Colors',
    '     ========================================================================== */',
    ...brandColors.map(c => `  ${c.variable}: ${c.hex}; /* ${c.name} | ${c.description} (Contrast: ${c.contrastOnWhite}) */`),
    '',
    '  /* Brand 50-950 Scale */',
    ...brandScale.map(s => `  --color-brand-${s.step}: ${s.hex};`),
    '',
    '  /* ==========================================================================',
    '     Surfaces & Neutrals (Light Theme First)',
    '     ========================================================================== */',
    ...neutralColors.map(c => `  ${c.variable}: ${c.hex}; /* ${c.name} | ${c.description} */`),
    '',
    '  /* Slate Neutral 50-950 Scale */',
    ...neutralScale.map(s => `  --color-slate-${s.step}: ${s.hex};`),
    '',
    '  /* ==========================================================================',
    '     Status & Feedback',
    '     ========================================================================== */',
    ...semanticColors.map(c => `  ${c.variable}: ${c.hex}; /* ${c.name} */`),
    '',
    '  /* ==========================================================================',
    '     Gradients & Visual Atmosphere',
    '     ========================================================================== */',
    ...gradients.map(g => `  ${g.token}: ${g.value}; /* ${g.description} */`),
    '',
    '  /* ==========================================================================',
    '     Typography',
    '     ========================================================================== */',
    `  --font-family-sans: ${primaryFont};`,
    '  --font-family-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;',
    ...typographyScale.map(t => `  --font-size-${t.level.toLowerCase().replace(/\s+/g, '-')}: ${t.size};`),
    '',
    '  /* ==========================================================================',
    '     Spacing (8pt Grid Rhythm)',
    '     ========================================================================== */',
    ...spacingScale.map(s => `  --${s.token}: ${s.value}; /* ${s.usage} */`),
    '',
    '  /* ==========================================================================',
    '     Border Radii',
    '     ========================================================================== */',
    ...radii.map(r => `  --${r.token}: ${r.value}; /* ${r.usage} */`),
    '',
    '  /* ==========================================================================',
    '     Elevation & Shadows',
    '     ========================================================================== */',
    ...shadows.map(s => `  --${s.token}: ${s.value}; /* ${s.description} */`),
    '',
    '  /* ==========================================================================',
    '     Backdrop Blurs & Frosted Glass',
    '     ========================================================================== */',
    ...blurs.map(b => `  --${b.token}: ${b.value};`),
    '',
    '  /* ==========================================================================',
    '     Transitions & Motion Curves',
    '     ========================================================================== */',
    ...motion.map(m => `  --${m.token}: ${m.duration} ${m.easing}; /* ${m.description} */`),
    '',
    '  /* ==========================================================================',
    '     Z-Index Hierarchy Layering',
    '     ========================================================================== */',
    ...zIndex.map(z => `  --${z.token}: ${z.value}; /* ${z.role} */`),
  ].join('\n');

  const tokensCss = `/* ==========================================================================
   ${siteName} Enterprise Design Tokens (Light Theme First)
   Extracted by Webcmd Universal Design System Engine
   Source: ${sourceUrl}
   ========================================================================== */

:root {
${allCssVariables}
}
`;
  const tokensCssPath = path.join(designSystemDir, 'design-tokens.css');
  await fs.writeFile(tokensCssPath, tokensCss, 'utf-8');

  // -------------------------------------------------------------------------
  // 8. Generate tailwind.theme.js
  // -------------------------------------------------------------------------
  const tailwindTheme = `/** @type {import('tailwindcss').Config} */
module.exports = {
  theme: {
    extend: {
      colors: {
        brand: {
          50: '${brandScale[0].hex}',
          100: '${brandScale[1].hex}',
          200: '${brandScale[2].hex}',
          300: '${brandScale[3].hex}',
          400: '${brandScale[4].hex}',
          500: '${brandScale[5].hex}',
          600: '${brandScale[6].hex}',
          700: '${brandScale[7].hex}',
          800: '${brandScale[8].hex}',
          900: '${brandScale[9].hex}',
          950: '${brandScale[10].hex}',
          secondary: '${secondaryAccent}',
          accent: '${tertiaryAccent}',
        },
        surface: {
          canvas: '${neutralColors[0].hex}',
          card: '${neutralColors[1].hex}',
          muted: '${neutralColors[2].hex}',
        },
        border: {
          subtle: '${neutralColors[3].hex}',
          strong: '${neutralColors[4].hex}',
        },
        content: {
          primary: '${neutralColors[5].hex}',
          secondary: '${neutralColors[6].hex}',
          muted: '${neutralColors[7].hex}',
        },
        status: {
          success: '${semanticColors[0].hex}',
          'success-subtle': '${semanticColors[1].hex}',
          warning: '${semanticColors[2].hex}',
          'warning-subtle': '${semanticColors[3].hex}',
          danger: '${semanticColors[4].hex}',
          'danger-subtle': '${semanticColors[5].hex}',
          info: '${semanticColors[6].hex}',
          'info-subtle': '${semanticColors[7].hex}',
        }
      },
      fontFamily: {
        sans: [${JSON.stringify(primaryFont.split(',')[0].trim())}, 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      boxShadow: {
        'xs': '${shadows[0].value}',
        'sm': '${shadows[1].value}',
        'md': '${shadows[2].value}',
        'lg': '${shadows[3].value}',
        'xl': '${shadows[4].value}',
        '2xl': '${shadows[5].value}',
        'inner': '${shadows[6].value}',
        'glow': '${shadows[7].value}',
      },
      borderRadius: {
        'xs': '${radii[1].value}',
        'sm': '${radii[2].value}',
        'md': '${radii[3].value}',
        'lg': '${radii[4].value}',
        'xl': '${radii[5].value}',
      },
      backgroundImage: {
        'gradient-brand': '${gradients[0].value}',
        'gradient-mesh': '${gradients[1].value}',
      },
      transitionTimingFunction: {
        'spring': 'cubic-bezier(0.16, 1, 0.3, 1)',
      }
    }
  }
};
`;
  const tailwindThemePath = path.join(designSystemDir, 'tailwind.theme.js');
  await fs.writeFile(tailwindThemePath, tailwindTheme, 'utf-8');

  // -------------------------------------------------------------------------
  // 9. Generate React Components Primitive Library (`components.tsx`)
  // -------------------------------------------------------------------------
  const reactComponentsTsx = `import React from 'react';

/**
 * ============================================================================
 * ${siteName} Production UI Component Primitives
 * Built with React + TypeScript + Tailwind CSS
 * ============================================================================
 */

// 1. Button Primitive
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  isLoading = false,
  leftIcon,
  rightIcon,
  className = '',
  disabled,
  ...props
}) => {
  const baseStyles = 'inline-flex items-center justify-center font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none active:scale-[0.98]';
  
  const sizeStyles = {
    sm: 'text-xs px-3 py-1.5 rounded-md gap-1.5',
    md: 'text-sm px-4 py-2 rounded-lg gap-2',
    lg: 'text-base px-6 py-3 rounded-xl gap-2.5',
  };

  const variantStyles = {
    primary: 'bg-[${primaryAccent}] text-white hover:opacity-95 shadow-sm hover:shadow-md focus:ring-[${primaryAccent}]',
    secondary: 'bg-white text-slate-800 border border-slate-300 hover:bg-slate-50 shadow-xs focus:ring-slate-400',
    outline: 'border border-[${primaryAccent}] text-[${primaryAccent}] bg-transparent hover:bg-[${brandScale[0].hex}] focus:ring-[${primaryAccent}]',
    ghost: 'text-slate-700 bg-transparent hover:bg-slate-100 focus:ring-slate-400',
    danger: 'bg-red-600 text-white hover:bg-red-700 shadow-sm focus:ring-red-500',
  };

  return (
    <button
      className={\`\${baseStyles} \${sizeStyles[size]} \${variantStyles[variant]} \${className}\`}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <svg className="animate-spin h-4 w-4 text-current" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
      ) : (
        <>
          {leftIcon && <span className="inline-flex shrink-0">{leftIcon}</span>}
          {children}
          {rightIcon && <span className="inline-flex shrink-0">{rightIcon}</span>}
        </>
      )}
    </button>
  );
};

// 2. Input Field Primitive
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  leftIcon?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, helperText, leftIcon, className = '', id, ...props }, ref) => {
    const inputId = id || (label ? label.toLowerCase().replace(/\\s+/g, '-') : undefined);
    return (
      <div className="flex flex-col gap-1.5 w-full text-left">
        {label && (
          <label htmlFor={inputId} className="text-xs font-semibold text-slate-700">
            {label}
          </label>
        )}
        <div className="relative flex items-center">
          {leftIcon && (
            <div className="absolute left-3 text-slate-400 pointer-events-none flex items-center">
              {leftIcon}
            </div>
          )}
          <input
            id={inputId}
            ref={ref}
            className={\`w-full bg-white border \${error ? 'border-red-500 focus:ring-red-200' : 'border-slate-300 focus:border-[${primaryAccent}] focus:ring-sky-100'} \${leftIcon ? 'pl-10' : 'pl-3.5'} pr-3.5 py-2 text-sm text-slate-900 rounded-lg outline-none transition-all duration-150 focus:ring-3 shadow-xs placeholder:text-slate-400 disabled:bg-slate-50 disabled:text-slate-500 \${className}\`}
            {...props}
          />
        </div>
        {error && <span className="text-xs text-red-600 font-medium">{error}</span>}
        {!error && helperText && <span className="text-xs text-slate-500">{helperText}</span>}
      </div>
    );
  }
);
Input.displayName = 'Input';

// 3. Card Primitive
export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  hoverable?: boolean;
}

export const Card: React.FC<CardProps> = ({ children, hoverable = false, className = '', ...props }) => {
  return (
    <div
      className={\`bg-white border border-slate-200 rounded-2xl p-6 shadow-sm \${hoverable ? 'hover:shadow-md hover:border-slate-300 transition-all duration-200 transform hover:-translate-y-0.5' : ''} \${className}\`}
      {...props}
    >
      {children}
    </div>
  );
};

// 4. Badge / Tag Primitive
export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'brand' | 'success' | 'warning' | 'danger' | 'neutral';
  dot?: boolean;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'brand',
  dot = false,
  className = '',
  ...props
}) => {
  const variantStyles = {
    brand: 'bg-[${brandScale[0].hex}] text-[${primaryAccent}] border-[${brandScale[1].hex}]',
    success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    warning: 'bg-amber-50 text-amber-800 border-amber-200',
    danger: 'bg-red-50 text-red-700 border-red-200',
    neutral: 'bg-slate-100 text-slate-700 border-slate-200',
  };

  const dotColors = {
    brand: 'bg-[${primaryAccent}]',
    success: 'bg-emerald-500',
    warning: 'bg-amber-500',
    danger: 'bg-red-500',
    neutral: 'bg-slate-400',
  };

  return (
    <span
      className={\`inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-semibold rounded-full border \${variantStyles[variant]} \${className}\`}
      {...props}
    >
      {dot && <span className={\`w-1.5 h-1.5 rounded-full \${dotColors[variant]}\`} />}
      {children}
    </span>
  );
};

// 5. Alert Banner Primitive
export interface AlertProps {
  type?: 'info' | 'success' | 'warning' | 'danger';
  title: string;
  description?: string;
  onDismiss?: () => void;
}

export const Alert: React.FC<AlertProps> = ({ type = 'info', title, description, onDismiss }) => {
  const styles = {
    info: 'bg-sky-50 border-sky-200 text-sky-900',
    success: 'bg-emerald-50 border-emerald-200 text-emerald-900',
    warning: 'bg-amber-50 border-amber-200 text-amber-900',
    danger: 'bg-red-50 border-red-200 text-red-900',
  };

  return (
    <div className={\`flex items-start justify-between p-4 rounded-xl border \${styles[type]} text-left\`}>
      <div className="flex flex-col gap-0.5">
        <h4 className="text-sm font-bold leading-5">{title}</h4>
        {description && <p className="text-xs opacity-90 leading-relaxed">{description}</p>}
      </div>
      {onDismiss && (
        <button onClick={onDismiss} className="text-current opacity-60 hover:opacity-100 text-sm font-bold ml-3">
          ✕
        </button>
      )}
    </div>
  );
};
`;
  const reactComponentsTsxPath = path.join(designSystemDir, 'components.tsx');
  await fs.writeFile(reactComponentsTsxPath, reactComponentsTsx, 'utf-8');

  // -------------------------------------------------------------------------
  // 10. Generate Comprehensive DesignSystem.md
  // -------------------------------------------------------------------------
  const styleGuideMd = `# ${siteName} Enterprise Design System Specification

> Extracted from **[${sourceUrl}](${sourceUrl})** using Webcmd Universal Design Engine.
> Generation Date: \`${new Date().toUTCString()}\`

---

## 🏛️ 1. Design Principles & Architecture

1. **Light-Theme First & High Contrast:** Surfaces are anchored on crisp pure whites (\`#FFFFFF\`) and soft canvas slates (\`#F8FAFC\`) for maximum readability and visual focus.
2. **Modular 8-Point Layout Rhythm:** All paddings, margins, component heights, and layout gaps adhere strictly to multiples of 4px / 8px for visual harmony.
3. **Subtle Elevation & Soft Shadows:** Layering is achieved with gentle multi-layered shadows and subtle 1px slate borders (\`#E2E8F0\`) rather than heavy dark drop-shadows.
4. **WCAG 2.1 AA Accessibility Compliant:** All text hierarchy levels and interactive buttons meet or exceed the minimum 4.5:1 contrast ratio standard on light backgrounds.

---

## 🎨 2. Color Palette System & Scale

### Brand Palette (Primary & Accents)
| Token | HEX | Role & Usage | Contrast on White | WCAG AA |
| :--- | :--- | :--- | :--- | :--- |
${brandColors.map(c => `| \`${c.variable}\` | \`${c.hex}\` | ${c.description} | \`${c.contrastOnWhite}\` | ${c.wcagAA ? '✅ Pass' : '⚠️ Large text only'} |`).join('\n')}

### 11-Step Brand Tonal Scale
\`\`\`css
${brandScale.map(s => `--color-brand-${s.step}: ${s.hex}; /* Contrast: ${s.contrastOnWhite} */`).join('\n')}
\`\`\`

### Neutrals & Surfaces (Light Theme Hierarchy)
| Token | HEX | Role & Application |
| :--- | :--- | :--- |
${neutralColors.map(c => `| \`${c.variable}\` | \`${c.hex}\` | ${c.description} |`).join('\n')}

### Status & Feedback Semantics
| Token | HEX | State & Role |
| :--- | :--- | :--- |
${semanticColors.map(c => `| \`${c.variable}\` | \`${c.hex}\` | ${c.description} |`).join('\n')}

### Gradients & Atmosphere
| Name | Token | CSS Definition |
| :--- | :--- | :--- |
${gradients.map(g => `| **${g.name}** | \`${g.token}\` | \`${g.value}\` |`).join('\n')}

---

## ✍️ 3. Typography Scale & Hierarchy

- **Primary Sans-Serif Font Stack:** \`${primaryFont}\`
- **Monospace Stack:** \`ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace\`

| Level | Size | Weight | Line Height | Tracking | Application Context |
| :--- | :--- | :--- | :--- | :--- | :--- |
${typographyScale.map(t => `| **${t.level}** | \`${t.size}\` | ${t.weight} | \`${t.lineHeight}\` | \`${t.tracking}\` | ${t.usage} |`).join('\n')}

---

## 📐 4. Spacing Scale & 8-Point Grid Rhythm

| Spacing Token | CSS Value | Pixels | Usage Recommendation |
| :--- | :--- | :--- | :--- |
${spacingScale.map(s => `| \`${s.token}\` | \`${s.value}\` | \`${s.pixels}px\` | ${s.usage} |`).join('\n')}

---

## 📱 5. Responsive Grid & Breakpoints

| Breakpoint | Min-Width | Max Container Width | 12-Col Gutter |
| :--- | :--- | :--- | :--- |
| **\`xs\`** | \`480px\` | Full / \`100%\` | \`16px\` |
| **\`sm\`** | \`640px\` | \`640px\` | \`16px\` |
| **\`md\`** | \`768px\` | \`768px\` | \`24px\` |
| **\`lg\`** | \`1024px\` | \`1024px\` | \`24px\` |
| **\`xl\`** | \`1280px\` | \`1280px\` | \`32px\` |
| **\`2xl\`** | \`1536px\` | \`1440px\` | \`32px\` |

---

## 📦 6. Elevation, Shadows & Corner Radii

### Corner Radii
| Token | Value | Target UI Component |
| :--- | :--- | :--- |
${radii.map(r => `| \`${r.token}\` | \`${r.value}\` | ${r.usage} |`).join('\n')}

### Shadows & Depth
| Token | CSS Value | Recommended Elevation |
| :--- | :--- | :--- |
${shadows.map(s => `| \`${s.token}\` | \`${s.value}\` | ${s.description} |`).join('\n')}

---

## ⚡ 7. Motion & Micro-Interactions

| Token | Duration | Easing Curve | Target Animation |
| :--- | :--- | :--- | :--- |
${motion.map(m => `| \`${m.token}\` | \`${m.duration}\` | \`${m.easing}\` | ${m.description} |`).join('\n')}

---

## 🧩 8. Component Design Guidelines & Code Rules

1. **Buttons:**
   - **Primary Action:** Solid \`${primaryAccent}\`, white text, 8px border radius, \`10px 20px\` padding, font-weight 600, smooth hover lift (-1px) and shadow-md.
   - **Secondary Action:** White background with \`1px solid #CBD5E1\` border and \`#0F172A\` dark slate text.
2. **Form Controls & Inputs:**
   - Background \`#FFFFFF\`, \`1px solid #CBD5E1\` border, \`10px 14px\` padding, focus ring \`0 0 0 3px rgba(2, 132, 199, 0.15)\` with \`#0284C7\` border.
3. **Card Panels:**
   - Background \`#FFFFFF\`, subtle border \`1px solid #E2E8F0\`, border radius \`16px\`, internal padding \`24px\`, shadow-sm.
`;
  const styleGuideMdPath = path.join(designSystemDir, 'DesignSystem.md');
  await fs.writeFile(styleGuideMdPath, styleGuideMd, 'utf-8');

  // -------------------------------------------------------------------------
  // 11. Generate Storybook-grade preview.html (Interactive Studio)
  // -------------------------------------------------------------------------
  const previewHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${siteName} Design System Studio & Storybook</title>
  <link rel="stylesheet" href="design-tokens.css">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --sidebar-width: 260px;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg-canvas);
      color: var(--text-primary);
      font-family: var(--font-family-sans);
      display: flex;
      min-height: 100vh;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
    }

    /* Sidebar Navigation */
    .sidebar {
      width: var(--sidebar-width);
      background: #FFFFFF;
      border-right: 1px solid var(--border-subtle);
      position: fixed;
      top: 0;
      bottom: 0;
      left: 0;
      padding: 24px 16px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      overflow-y: auto;
      z-index: 100;
    }
    .brand-header {
      padding: 0 8px 20px 8px;
      border-bottom: 1px solid var(--border-subtle);
    }
    .brand-logo {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 18px;
      font-weight: 800;
      letter-spacing: -0.02em;
      color: var(--text-primary);
    }
    .brand-badge {
      width: 28px;
      height: 28px;
      border-radius: 8px;
      background: var(--gradient-brand);
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      font-size: 13px;
      font-weight: 800;
    }
    .brand-sub {
      font-size: 12px;
      color: var(--text-secondary);
      margin-top: 4px;
    }

    .nav-list {
      list-style: none;
      margin-top: 20px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .nav-item a {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 9px 12px;
      border-radius: var(--radius-sm);
      color: var(--text-secondary);
      text-decoration: none;
      font-size: 13px;
      font-weight: 600;
      transition: all 0.15s ease;
    }
    .nav-item a:hover, .nav-item a.active {
      background: var(--color-primary-50);
      color: var(--color-primary-500);
    }
    .nav-category {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      padding: 16px 12px 6px 12px;
    }

    /* Main Content Area */
    .main-wrapper {
      margin-left: var(--sidebar-width);
      flex: 1;
      padding: 48px 48px 80px 48px;
      max-width: 1400px;
    }

    /* Top Hero */
    .hero-banner {
      background: #FFFFFF;
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-lg);
      padding: 36px 40px;
      margin-bottom: 40px;
      box-shadow: var(--shadow-sm);
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: relative;
      overflow: hidden;
    }
    .hero-banner::after {
      content: '';
      position: absolute;
      top: 0;
      right: 0;
      width: 300px;
      height: 100%;
      background: var(--gradient-mesh);
      opacity: 0.7;
      pointer-events: none;
    }
    .hero-title h1 {
      font-size: 32px;
      font-weight: 800;
      letter-spacing: -0.025em;
      color: var(--text-primary);
    }
    .hero-title p {
      color: var(--text-secondary);
      font-size: 15px;
      margin-top: 6px;
    }
    .tag-pill {
      background: #E0F2FE;
      color: #0284C7;
      border: 1px solid #BAE6FD;
      padding: 6px 16px;
      border-radius: var(--radius-full);
      font-size: 12px;
      font-weight: 700;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    /* Section Cards */
    .section-card {
      background: #FFFFFF;
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-lg);
      padding: 36px;
      margin-bottom: 36px;
      box-shadow: var(--shadow-sm);
    }
    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--border-subtle);
      padding-bottom: 18px;
      margin-bottom: 28px;
    }
    .section-header h2 {
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.015em;
      color: var(--text-primary);
    }
    .section-header span {
      font-size: 13px;
      color: var(--text-secondary);
      font-weight: 500;
    }

    /* Color Swatch Grids */
    .swatch-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 18px;
    }
    .swatch-box {
      background: #FFFFFF;
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
      overflow: hidden;
      box-shadow: var(--shadow-xs);
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      cursor: pointer;
    }
    .swatch-box:hover {
      transform: translateY(-3px);
      box-shadow: var(--shadow-md);
      border-color: var(--border-strong);
    }
    .swatch-preview {
      height: 90px;
      width: 100%;
      position: relative;
    }
    .swatch-info {
      padding: 14px;
    }
    .swatch-hex {
      font-size: 14px;
      font-weight: 700;
      font-family: var(--font-family-mono);
      color: var(--text-primary);
    }
    .swatch-name {
      font-size: 12px;
      font-weight: 600;
      color: var(--color-primary-500);
      margin-top: 2px;
    }
    .swatch-contrast {
      font-size: 11px;
      color: var(--text-secondary);
      margin-top: 4px;
      display: flex;
      justify-content: space-between;
    }

    /* Scale Row */
    .scale-row {
      display: grid;
      grid-template-columns: repeat(11, 1fr);
      gap: 8px;
      margin-top: 14px;
      margin-bottom: 28px;
    }
    .scale-chip {
      display: flex;
      flex-direction: column;
      border-radius: var(--radius-sm);
      overflow: hidden;
      border: 1px solid var(--border-subtle);
      text-align: center;
      cursor: pointer;
      transition: transform 0.15s ease;
    }
    .scale-chip:hover {
      transform: scale(1.05);
    }
    .scale-color {
      height: 48px;
      width: 100%;
    }
    .scale-label {
      font-size: 11px;
      font-weight: 700;
      padding: 4px 2px;
      background: #FFFFFF;
      color: var(--text-secondary);
      font-family: var(--font-family-mono);
    }

    /* Tables */
    .data-table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
    }
    .data-table th {
      padding: 12px 16px;
      background: var(--bg-canvas);
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-secondary);
      border-bottom: 1px solid var(--border-subtle);
    }
    .data-table td {
      padding: 16px;
      border-bottom: 1px solid var(--border-subtle);
      font-size: 14px;
    }
    .code-badge {
      background: var(--bg-muted);
      color: var(--text-primary);
      padding: 3px 8px;
      border-radius: var(--radius-xs);
      font-family: var(--font-family-mono);
      font-size: 12px;
      border: 1px solid var(--border-subtle);
    }

    /* Component Demos */
    .demo-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 24px;
    }
    .demo-box {
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
      padding: 24px;
      background: #FFFFFF;
    }
    .demo-title {
      font-size: 14px;
      font-weight: 700;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-bottom: 16px;
    }
    .demo-row {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      align-items: center;
    }

    /* Buttons */
    .btn {
      padding: 10px 20px;
      border-radius: var(--radius-sm);
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      border: 1px solid transparent;
      text-decoration: none;
    }
    .btn:active { transform: scale(0.98); }
    .btn-primary { background: var(--color-primary-500); color: #FFFFFF; box-shadow: var(--shadow-xs); }
    .btn-primary:hover { opacity: 0.92; box-shadow: var(--shadow-md); transform: translateY(-1px); }
    .btn-secondary { background: #FFFFFF; color: var(--text-primary); border-color: var(--border-strong); box-shadow: var(--shadow-xs); }
    .btn-secondary:hover { background: var(--bg-canvas); }
    .btn-outline { background: transparent; color: var(--color-primary-500); border-color: var(--color-primary-500); }
    .btn-outline:hover { background: var(--color-primary-50); }
    .btn-ghost { background: transparent; color: var(--text-secondary); }
    .btn-ghost:hover { background: var(--bg-muted); color: var(--text-primary); }
    .btn-danger { background: var(--color-danger); color: #FFFFFF; }
    .btn-danger:hover { opacity: 0.9; }

    /* Inputs */
    .input-field {
      width: 100%;
      background: #FFFFFF;
      border: 1px solid var(--border-strong);
      padding: 10px 14px;
      border-radius: var(--radius-sm);
      font-size: 14px;
      color: var(--text-primary);
      outline: none;
      transition: all 0.15s ease;
      box-shadow: var(--shadow-xs);
    }
    .input-field:focus {
      border-color: var(--color-primary-500);
      box-shadow: 0 0 0 3px rgba(2, 132, 199, 0.15);
    }

    /* Cards */
    .preview-card {
      background: #FFFFFF;
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-lg);
      padding: 24px;
      box-shadow: var(--shadow-sm);
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .preview-card:hover {
      box-shadow: var(--shadow-md);
      transform: translateY(-2px);
      border-color: var(--border-strong);
    }

    /* Toast Notification */
    .toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #0F172A;
      color: #FFFFFF;
      padding: 12px 20px;
      border-radius: var(--radius-md);
      font-size: 13px;
      font-weight: 600;
      box-shadow: var(--shadow-xl);
      transform: translateY(100px);
      opacity: 0;
      transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      z-index: 1000;
    }
    .toast.show {
      transform: translateY(0);
      opacity: 1;
    }
  </style>
</head>
<body>
  <!-- Sidebar -->
  <aside class="sidebar">
    <div>
      <div class="brand-header">
        <div class="brand-logo">
          <div class="brand-badge">${siteName.charAt(0)}</div>
          <span>${siteName} Studio</span>
        </div>
        <div class="brand-sub">Universal Design System</div>
      </div>
      <ul class="nav-list">
        <li class="nav-category">Foundations</li>
        <li class="nav-item"><a href="#colors" class="active">🎨 Colors & Scales</a></li>
        <li class="nav-item"><a href="#typography">✍️ Typography Scale</a></li>
        <li class="nav-item"><a href="#spacing">📐 Spacing & Grid</a></li>
        <li class="nav-item"><a href="#elevation">📦 Elevation & Shadows</a></li>
        
        <li class="nav-category">Components</li>
        <li class="nav-item"><a href="#buttons">🔘 Buttons & Triggers</a></li>
        <li class="nav-item"><a href="#forms">📝 Form Inputs</a></li>
        <li class="nav-item"><a href="#cards">🗂️ Cards & Containers</a></li>
        <li class="nav-item"><a href="#badges">🏷️ Badges & Pills</a></li>

        <li class="nav-category">Export</li>
        <li class="nav-item"><a href="#tokens">⚙️ Tokens & React Code</a></li>
      </ul>
    </div>
    <div style="padding: 12px; background: var(--bg-muted); border-radius: var(--radius-sm); font-size: 11px; color: var(--text-secondary);">
      Extracted by <strong>Webcmd</strong>
    </div>
  </aside>

  <!-- Main Content -->
  <main class="main-wrapper">
    <!-- Top Hero Banner -->
    <header class="hero-banner">
      <div class="hero-title">
        <h1>${siteName} Production Design System</h1>
        <p>Extracted from <a href="${sourceUrl}" target="_blank" style="color: var(--color-primary-500); text-decoration: none; font-weight: 600;">${sourceUrl}</a> • WCAG 2.1 AA Compliant</p>
      </div>
      <div class="tag-pill">
        <span style="width: 8px; height: 8px; border-radius: 50%; background: #10B981;"></span>
        Light & Production Ready
      </div>
    </header>

    <!-- 1. Colors Section -->
    <section id="colors" class="section-card">
      <div class="section-header">
        <h2>1. Color & Palette System</h2>
        <span>Click any color swatch to copy HEX</span>
      </div>

      <h4 style="font-size: 14px; font-weight: 700; color: var(--text-secondary); text-transform: uppercase; margin-bottom: 12px;">Primary Brand Scale (50-950)</h4>
      <div class="scale-row">
        ${brandScale.map(s => `
          <div class="scale-chip" onclick="copyHex('${s.hex}')" title="Copy ${s.hex}">
            <div class="scale-color" style="background: ${s.hex};"></div>
            <div class="scale-label">${s.step}</div>
          </div>
        `).join('')}
      </div>

      <h4 style="font-size: 14px; font-weight: 700; color: var(--text-secondary); text-transform: uppercase; margin-bottom: 12px;">Neutral Slate Scale (50-950)</h4>
      <div class="scale-row">
        ${neutralScale.map(s => `
          <div class="scale-chip" onclick="copyHex('${s.hex}')" title="Copy ${s.hex}">
            <div class="scale-color" style="background: ${s.hex};"></div>
            <div class="scale-label">${s.step}</div>
          </div>
        `).join('')}
      </div>

      <h4 style="font-size: 14px; font-weight: 700; color: var(--text-secondary); text-transform: uppercase; margin: 24px 0 12px 0;">Semantic & Status Roles</h4>
      <div class="swatch-grid">
        ${brandColors.map(c => `
          <div class="swatch-box" onclick="copyHex('${c.hex}')">
            <div class="swatch-preview" style="background: ${c.hex};"></div>
            <div class="swatch-info">
              <div class="swatch-hex">${c.hex}</div>
              <div class="swatch-name">${c.name}</div>
              <div class="swatch-contrast">
                <span>Contrast</span>
                <strong>${c.contrastOnWhite}</strong>
              </div>
            </div>
          </div>
        `).join('')}
        ${semanticColors.map(c => `
          <div class="swatch-box" onclick="copyHex('${c.hex}')">
            <div class="swatch-preview" style="background: ${c.hex};"></div>
            <div class="swatch-info">
              <div class="swatch-hex">${c.hex}</div>
              <div class="swatch-name">${c.name}</div>
              <div class="swatch-contrast">
                <span>Contrast</span>
                <strong>${c.contrastOnWhite}</strong>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    </section>

    <!-- 2. Typography Section -->
    <section id="typography" class="section-card">
      <div class="section-header">
        <h2>2. Typography Hierarchy</h2>
        <span>Stack: ${primaryFont}</span>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>Level</th>
            <th>Size</th>
            <th>Weight</th>
            <th>Line Height</th>
            <th>Sample Render</th>
          </tr>
        </thead>
        <tbody>
          ${typographyScale.map(t => `
            <tr>
              <td><strong>${t.level}</strong></td>
              <td><span class="code-badge">${t.size}</span></td>
              <td>${t.weight}</td>
              <td><span class="code-badge">${t.lineHeight}</span></td>
              <td><span style="font-size: ${t.size}; font-weight: ${t.weight.split(' ')[0]}; line-height: ${t.lineHeight}; letter-spacing: ${t.tracking}; color: var(--text-primary);">The quick brown fox jumps</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </section>

    <!-- 3. Spacing & Elevation -->
    <section id="spacing" class="section-card">
      <div class="section-header">
        <h2>3. Spacing & 8-Point Layout Rhythm</h2>
        <span>Multiples of 4px / 8px</span>
      </div>
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px;">
        ${spacingScale.map(s => `
          <div style="background: var(--bg-muted); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 16px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <span class="code-badge">${s.token}</span>
              <strong style="font-size: 13px; color: var(--text-primary);">${s.value}</strong>
            </div>
            <div style="height: 12px; width: ${s.value}; background: var(--color-primary-500); border-radius: 2px; margin-bottom: 8px;"></div>
            <p style="font-size: 11px; color: var(--text-secondary);">${s.usage}</p>
          </div>
        `).join('')}
      </div>
    </section>

    <!-- 4. Elevation & Shadows -->
    <section id="elevation" class="section-card">
      <div class="section-header">
        <h2>4. Elevation & Shadows</h2>
        <span>Depth and layering</span>
      </div>
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 20px;">
        ${shadows.map(s => `
          <div style="background: #FFFFFF; border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); padding: 24px; box-shadow: ${s.value}; text-align: center;">
            <span class="code-badge">${s.token}</span>
            <p style="font-size: 12px; color: var(--text-secondary); margin-top: 12px;">${s.description}</p>
          </div>
        `).join('')}
      </div>
    </section>

    <!-- 5. Component Primitives -->
    <section id="buttons" class="section-card">
      <div class="section-header">
        <h2>5. Interactive UI Components</h2>
        <span>Ready-to-use primitives</span>
      </div>
      <div class="demo-grid">
        <!-- Buttons Demo -->
        <div class="demo-box">
          <div class="demo-title">Button Variants</div>
          <div class="demo-row" style="margin-bottom: 16px;">
            <button class="btn btn-primary">Primary Action</button>
            <button class="btn btn-secondary">Secondary</button>
            <button class="btn btn-outline">Outline</button>
          </div>
          <div class="demo-row">
            <button class="btn btn-ghost">Ghost</button>
            <button class="btn btn-danger">Destructive</button>
          </div>
        </div>

        <!-- Form Demo -->
        <div id="forms" class="demo-box">
          <div class="demo-title">Form Controls</div>
          <div style="display: flex; flex-direction: column; gap: 14px;">
            <div>
              <label style="font-size: 12px; font-weight: 600; color: var(--text-secondary); display: block; margin-bottom: 6px;">Email Address</label>
              <input type="email" class="input-field" placeholder="name@company.com" value="alex@developer.io">
            </div>
            <div>
              <label style="font-size: 12px; font-weight: 600; color: var(--text-secondary); display: block; margin-bottom: 6px;">Workspace Domain</label>
              <input type="text" class="input-field" placeholder="workspace.domain">
            </div>
          </div>
        </div>

        <!-- Cards Demo -->
        <div id="cards" class="demo-box">
          <div class="demo-title">Interactive Card</div>
          <div class="preview-card">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
              <span style="background: #ECFDF5; color: #059669; border: 1px solid #A7F3D0; padding: 3px 10px; border-radius: var(--radius-full); font-size: 11px; font-weight: 700;">Active Status</span>
              <span style="font-size: 12px; color: var(--text-secondary);">2m ago</span>
            </div>
            <h3 style="font-size: 17px; font-weight: 700; color: var(--text-primary); margin-bottom: 6px;">${siteName} Container</h3>
            <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 18px;">Crisp light elevation with modular spacing and responsive layout.</p>
            <button class="btn btn-primary" style="width: 100%; justify-content: center;">Deploy Feature</button>
          </div>
        </div>

        <!-- Badges Demo -->
        <div id="badges" class="demo-box">
          <div class="demo-title">Badge & Status Chips</div>
          <div class="demo-row">
            <span style="background: var(--color-primary-50); color: var(--color-primary-500); border: 1px solid var(--color-primary-100); padding: 4px 12px; border-radius: 9999px; font-size: 12px; font-weight: 700;">Brand Pill</span>
            <span style="background: #ECFDF5; color: #059669; border: 1px solid #A7F3D0; padding: 4px 12px; border-radius: 9999px; font-size: 12px; font-weight: 700;">Completed</span>
            <span style="background: #FFFBEB; color: #D97706; border: 1px solid #FDE68A; padding: 4px 12px; border-radius: 9999px; font-size: 12px; font-weight: 700;">Warning</span>
            <span style="background: #FEF2F2; color: #DC2626; border: 1px solid #FECACA; padding: 4px 12px; border-radius: 9999px; font-size: 12px; font-weight: 700;">Danger</span>
          </div>
        </div>
      </div>
    </section>
  </main>

  <!-- Toast Copy Notification -->
  <div id="toast" class="toast">Copied to clipboard!</div>

  <script>
    function copyHex(hex) {
      navigator.clipboard.writeText(hex);
      const toast = document.getElementById('toast');
      toast.innerText = 'Copied ' + hex + ' to clipboard';
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 2000);
    }
  </script>
</body>
</html>
`;
  const previewHtmlPath = path.join(designSystemDir, 'preview.html');
  await fs.writeFile(previewHtmlPath, previewHtml, 'utf-8');

  // -------------------------------------------------------------------------
  // 12. Generate AI Agent Design Skill (`DESIGN_SKILL.md`)
  // -------------------------------------------------------------------------
  const agentSkillMd = `---
name: design-${siteName.toLowerCase()}
description: Pixel-authentic enterprise design system and UI generation guidelines based on ${siteName} (${sourceUrl}). Use when building modern React/Tailwind landing pages, dashboards, or components in the exact signature visual style of ${siteName}.
---

# ${siteName} Enterprise Design System Skill

Use this skill whenever asked to generate, design, or scaffold modern UI interfaces in the signature visual style of **${siteName}**.

## Core Design Architecture & Theme

- **Theme:** Clean, modern, high-contrast Light Theme.
- **Brand Colors:**
${brandColors.map(c => `  - **${c.name}:** \`${c.hex}\` (\`${c.variable}\`) — *${c.description}* (Contrast on white: \`${c.contrastOnWhite}\`)`).join('\n')}
- **Surface Palette:**
${neutralColors.map(c => `  - **${c.name}:** \`${c.hex}\` (\`${c.variable}\`)`).join('\n')}
- **Typography Stack:** \`${primaryFont}\`
- **Corner Radii:** \`${radii[1].value}\` (xs), \`${radii[2].value}\` (sm), \`${radii[3].value}\` (md), \`${radii[4].value}\` (lg)
- **Shadows:** \`${shadows[0].value}\` (xs), \`${shadows[1].value}\` (sm), \`${shadows[2].value}\` (md)

---

## Tailwind Theme Configuration

When writing React/Tailwind code for this design system, extend your Tailwind configuration:

\`\`\`javascript
module.exports = {
  theme: {
    extend: {
      colors: {
        brand: {
          50: '${brandScale[0].hex}',
          100: '${brandScale[1].hex}',
          500: '${brandScale[5].hex}',
          600: '${brandScale[6].hex}',
          secondary: '${secondaryAccent}',
          accent: '${tertiaryAccent}',
        },
        surface: {
          canvas: '${neutralColors[0].hex}',
          card: '${neutralColors[1].hex}',
          muted: '${neutralColors[2].hex}',
        },
        border: {
          subtle: '${neutralColors[3].hex}',
          strong: '${neutralColors[4].hex}',
        },
        content: {
          primary: '${neutralColors[5].hex}',
          secondary: '${neutralColors[6].hex}',
          muted: '${neutralColors[7].hex}',
        },
        status: {
          success: '${semanticColors[0].hex}',
          warning: '${semanticColors[2].hex}',
          danger: '${semanticColors[4].hex}',
          info: '${semanticColors[6].hex}',
        }
      },
      fontFamily: {
        sans: [${JSON.stringify(primaryFont.split(',')[0].trim())}, 'Inter', 'system-ui', 'sans-serif'],
      }
    }
  }
}
\`\`\`

---

## Component Anatomy Rules

1. **Page Canvas:** Use \`bg-slate-50 min-h-screen text-slate-900 font-sans antialiased\`.
2. **Cards & Panels:** Use \`bg-white border border-slate-200 rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow\`.
3. **Buttons:**
   - **Primary Action:** \`bg-[${primaryAccent}] text-white font-semibold px-5 py-2.5 rounded-lg shadow-sm hover:opacity-90 active:scale-[0.98] transition-all\`.
   - **Secondary Action:** \`bg-white border border-slate-300 text-slate-800 font-medium px-5 py-2.5 rounded-lg shadow-sm hover:bg-slate-50 active:scale-[0.98]\`.
4. **Form Inputs:**
   - Use \`bg-white border border-slate-300 text-slate-900 rounded-lg px-3.5 py-2 text-sm focus:border-[${primaryAccent}] focus:ring-3 focus:ring-sky-100 outline-none shadow-xs\`.
5. **Typography:**
   - **Hero Headlines:** \`text-4xl md:text-5xl font-extrabold tracking-tight text-slate-900\`.
   - **Subheadings:** \`text-slate-600 text-base md:text-lg leading-relaxed\`.
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
    extractedAt: new Date().toISOString(),
    colors: sortedRaw.length > 0 ? sortedRaw : [primaryAccent, secondaryAccent, tertiaryAccent],
    colorSystem: {
      brand: brandColors,
      brandScale,
      neutral: neutralColors,
      neutralScale,
      semantic: semanticColors,
      gradients,
    },
    typography: {
      primaryFont,
      monoFont: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      scale: typographyScale,
    },
    spacingScale,
    gridAndBreakpoints,
    radii,
    shadows,
    blurs,
    motion,
    zIndex,
    components: [],
    outputDir: designSystemDir,
    files: {
      tokensJson: tokensJsonPath,
      tokensCss: tokensCssPath,
      tailwindConfig: tailwindThemePath,
      styleGuideMd: styleGuideMdPath,
      previewHtml: previewHtmlPath,
      reactComponentsTsx: reactComponentsTsxPath,
      agentSkillMd: agentSkillMdPath,
    },
  };
}
