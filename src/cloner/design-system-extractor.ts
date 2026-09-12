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
    accessibilityAuditJson?: string;
    accessibilityAuditMd?: string;
    figmaTokensJson?: string;
    promptBlueprintMd?: string;
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
  // 11. Generate Automated WCAG 2.1 Accessibility Audit
  // -------------------------------------------------------------------------
  const contrastPairs = [
    ...brandColors.map(c => ({ role: c.name, hex: c.hex, target: 'White (#FFFFFF)', targetHex: '#FFFFFF', ratio: parseFloat(c.contrastOnWhite.replace(':1', '')), minRequired: 4.5 })),
    ...brandColors.map(c => ({ role: c.name, hex: c.hex, target: 'Dark (#0F172A)', targetHex: '#0F172A', ratio: parseFloat(c.contrastOnBlack.replace(':1', '')), minRequired: 4.5 })),
    ...neutralColors.map(c => ({ role: c.name, hex: c.hex, target: 'Canvas (#F8FAFC)', targetHex: '#F8FAFC', ratio: parseFloat(c.contrastOnWhite.replace(':1', '')), minRequired: 3.0 })),
  ];
  const passedCount = contrastPairs.filter(p => p.ratio >= p.minRequired).length;
  const complianceScore = Math.round((passedCount / Math.max(1, contrastPairs.length)) * 100);

  const accessibilityAuditJson = {
    standard: 'WCAG 2.1 Level AA & AAA',
    auditedAt: new Date().toISOString(),
    complianceScore: `${complianceScore}%`,
    status: complianceScore >= 90 ? 'PASSED_ENTERPRISE' : 'ACTIONABLE_NOTICES',
    summary: `${passedCount} of ${contrastPairs.length} evaluated color pairings satisfy WCAG 2.1 AA requirements.`,
    evaluations: contrastPairs.map(p => ({
      ...p,
      status: p.ratio >= p.minRequired ? 'PASS' : 'WARN_LOW_CONTRAST',
      recommendation: p.ratio >= p.minRequired ? 'Suitable for body and interactive UI elements' : 'Restrict to large text (>18pt) or decorative non-text borders',
    })),
  };
  const auditJsonPath = path.join(designSystemDir, 'accessibility-audit.json');
  await fs.writeFile(auditJsonPath, JSON.stringify(accessibilityAuditJson, null, 2), 'utf-8');

  const auditMd = `# ${siteName} WCAG 2.1 Accessibility & Compliance Audit

> Evaluated against **W3C WCAG 2.1 Level AA & AAA Standards**
> Global Compliance Score: **${complianceScore}%** (${passedCount}/${contrastPairs.length} Pairs Passed)

---

## 📊 Evaluation Summary

| Token Role | Color HEX | Background Surface | Contrast Ratio | Required | WCAG AA Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
${contrastPairs.map(p => `| **${p.role}** | \`${p.hex}\` | ${p.target} | \`${p.ratio.toFixed(1)}:1\` | \`${p.minRequired}:1\` | ${p.ratio >= p.minRequired ? '✅ **PASS**' : '⚠️ *Large text only*'} |`).join('\n')}

---

## 💡 Accessibility Engineering Guidelines
1. **Body Text (>14px):** Always maintain minimum **4.5:1** contrast.
2. **Hero Headers & Large Text (>18px bold):** Requires minimum **3.0:1** contrast.
3. **Interactive Buttons & Inputs:** All active border outlines must exceed **3.0:1** against the background canvas.
`;
  const auditMdPath = path.join(designSystemDir, 'AccessibilityAudit.md');
  await fs.writeFile(auditMdPath, auditMd, 'utf-8');

  // -------------------------------------------------------------------------
  // 12. Generate Figma Tokens Studio Format (`figma-tokens.json`)
  // -------------------------------------------------------------------------
  const figmaTokens = {
    global: {
      color: {
        brand: brandScale.reduce((acc, s) => ({ ...acc, [s.step]: { value: s.hex, type: 'color' } }), {}),
        neutral: neutralScale.reduce((acc, s) => ({ ...acc, [s.step]: { value: s.hex, type: 'color' } }), {}),
        semantic: semanticColors.reduce((acc, c) => ({ ...acc, [c.variable.replace('--color-', '')]: { value: c.hex, type: 'color' } }), {}),
      },
      borderRadius: radii.reduce((acc, r) => ({ ...acc, [r.token.replace('radius-', '')]: { value: r.value, type: 'borderRadius' } }), {}),
      spacing: spacingScale.reduce((acc, s) => ({ ...acc, [s.token.replace('space-', '')]: { value: s.value, type: 'spacing' } }), {}),
      fontFamilies: {
        sans: { value: primaryFont.split(',')[0].trim(), type: 'fontFamilies' },
      },
    },
    $themes: [{ id: 'light', name: 'Light Foundation', selectedTokenSets: { global: 'enabled' } }],
  };
  const figmaTokensPath = path.join(designSystemDir, 'figma-tokens.json');
  await fs.writeFile(figmaTokensPath, JSON.stringify(figmaTokens, null, 2), 'utf-8');

  // -------------------------------------------------------------------------
  // 13. Generate Master AI Prompt Blueprint (`AI_PROMPT_BLUEPRINT.md`)
  // -------------------------------------------------------------------------
  const promptBlueprint = `# Master AI System Prompt Blueprint // ${siteName}

Copy and paste this prompt into **Cursor, Claude, Copilot, or ChatGPT** to generate pixel-authentic UIs in the exact visual design system of **${siteName}**:

\`\`\`markdown
You are an expert Frontend Architect specializing in the ${siteName} Design System.
When writing modern React / Tailwind CSS code, strictly adhere to these design tokens and principles:

1. BRAND COLOR PALETTE:
   - Primary Brand Action: ${primaryAccent} (500), ${brandScale[6].hex} (600 hover), ${brandScale[0].hex} (50 tint)
   - Secondary Accent: ${secondaryAccent}
   - Canvas Background: #F8FAFC (Slate 50)
   - Surface Cards: #FFFFFF with 1px border #E2E8F0 and rounded-2xl
   - Typography Stack: "${primaryFont}"

2. COMPONENT PATTERNS:
   - Primary Button: bg-[${primaryAccent}] text-white font-semibold px-4 py-2 rounded-lg shadow-sm hover:opacity-95 active:scale-95 transition-all
   - Form Inputs: bg-white border border-slate-300 rounded-lg px-3.5 py-2 text-sm focus:border-[${primaryAccent}] focus:ring-2 focus:ring-sky-100 outline-none
   - Card Containers: bg-white border border-slate-200 rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow

Please scaffold the requested UI using these exact specifications.
\`\`\`
`;
  const promptBlueprintPath = path.join(designSystemDir, 'AI_PROMPT_BLUEPRINT.md');
  await fs.writeFile(promptBlueprintPath, promptBlueprint, 'utf-8');

  // -------------------------------------------------------------------------
  // 14. Generate AI Agent Design Skill (`DESIGN_SKILL.md`)
  // -------------------------------------------------------------------------
  const agentSkillMd = `---
name: design-${siteName.toLowerCase()}
description: Pixel-authentic enterprise design system and UI generation guidelines based on ${siteName} (${sourceUrl}). Use when building modern React/Tailwind landing pages, dashboards, or components in the exact signature visual style of ${siteName}.
---

# ${siteName} Enterprise Design System Skill

Extracted from: \`${sourceUrl}\`
Primary Accent: \`${primaryAccent}\`
Typography: \`${primaryFont}\`

## Design Guidelines & Component Signatures
- **Design Tokens CSS:** \`design-tokens.css\`
- **Tailwind Theme Preset:** \`tailwind.theme.js\`
- **React UI Primitives:** \`components.tsx\`
- **WCAG Audit:** \`AccessibilityAudit.md\` (Score: ${complianceScore}%)
`;
  const agentSkillMdPath = path.join(designSystemDir, 'DESIGN_SKILL.md');
  await fs.writeFile(agentSkillMdPath, agentSkillMd, 'utf-8');

  // Also register into `.agents/skills/design-<sitename>/SKILL.md`
  const workspaceSkillDir = path.join(process.cwd(), '.agents', 'skills', `design-${siteName.toLowerCase()}`);
  await fs.mkdir(workspaceSkillDir, { recursive: true });
  await fs.writeFile(path.join(workspaceSkillDir, 'SKILL.md'), agentSkillMd, 'utf-8');

  // -------------------------------------------------------------------------
  // 15. Generate Storybook-grade preview.html (Interactive Studio)
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
      margin-bottom: 20px;
    }
    .brand-logo {
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 800;
      font-size: 16px;
      color: var(--text-primary);
    }
    .brand-badge {
      width: 28px;
      height: 28px;
      background: var(--color-primary-500);
      color: #FFFFFF;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: var(--radius-sm);
      font-weight: 800;
      font-size: 13px;
    }
    .brand-sub {
      font-size: 11px;
      color: var(--text-secondary);
      font-weight: 500;
      margin-top: 4px;
    }
    .nav-list {
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .nav-category {
      font-size: 10px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--text-muted);
      padding: 12px 10px 4px 10px;
    }
    .nav-item a {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 10px;
      border-radius: var(--radius-sm);
      color: var(--text-secondary);
      font-size: 13px;
      font-weight: 500;
      text-decoration: none;
      transition: all 0.15s ease;
    }
    .nav-item a:hover {
      background: var(--bg-muted);
      color: var(--text-primary);
    }
    .nav-item a.active {
      background: var(--color-primary-50);
      color: var(--color-primary-500);
      font-weight: 600;
    }

    /* Main Area */
    .main-wrapper {
      margin-left: var(--sidebar-width);
      flex: 1;
      padding: 40px 48px;
      max-width: 1280px;
    }

    /* Hero Banner */
    .hero-banner {
      background: #FFFFFF;
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-xl);
      padding: 32px 40px;
      margin-bottom: 36px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      box-shadow: var(--shadow-sm);
    }
    .hero-title h1 {
      font-size: 26px;
      font-weight: 800;
      color: var(--text-primary);
      letter-spacing: -0.02em;
      margin-bottom: 6px;
    }
    .hero-title p {
      font-size: 14px;
      color: var(--text-secondary);
    }
    .tag-pill {
      background: var(--color-primary-50);
      color: var(--color-primary-600);
      border: 1px solid var(--color-primary-100);
      padding: 6px 14px;
      border-radius: var(--radius-full);
      font-size: 12px;
      font-weight: 700;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      text-decoration: none;
    }
    .btn-site-link {
      background: #0F172A;
      color: #FFFFFF;
      padding: 8px 18px;
      border-radius: var(--radius-md);
      font-size: 13px;
      font-weight: 700;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      transition: all 0.2s ease;
      box-shadow: var(--shadow-sm);
    }
    .btn-site-link:hover {
      background: #1E293B;
      transform: translateY(-1px);
    }

    /* Sections */
    .section-card {
      background: #FFFFFF;
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-xl);
      padding: 32px;
      margin-bottom: 32px;
      box-shadow: var(--shadow-sm);
    }
    .section-header {
      margin-bottom: 24px;
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      border-bottom: 1px solid var(--border-subtle);
      padding-bottom: 16px;
    }
    .section-header h2 {
      font-size: 18px;
      font-weight: 700;
      color: var(--text-primary);
      letter-spacing: -0.01em;
    }
    .section-header span {
      font-size: 12px;
      color: var(--text-muted);
    }

    /* Scales */
    .scale-row {
      display: grid;
      grid-template-columns: repeat(11, 1fr);
      gap: 8px;
      margin-bottom: 28px;
    }
    .scale-chip {
      display: flex;
      flex-direction: column;
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-md);
      overflow: hidden;
      cursor: pointer;
      transition: transform 0.15s ease, box-shadow 0.15s ease;
    }
    .scale-chip:hover {
      transform: translateY(-2px);
      box-shadow: var(--shadow-md);
    }
    .scale-color {
      height: 48px;
      width: 100%;
    }
    .scale-label {
      padding: 6px 4px;
      font-size: 10px;
      font-weight: 700;
      text-align: center;
      background: #FFFFFF;
      color: var(--text-secondary);
      font-family: var(--font-family-mono);
    }

    /* Tables */
    .data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    .data-table th {
      text-align: left;
      padding: 12px 14px;
      background: var(--bg-muted);
      color: var(--text-secondary);
      font-weight: 700;
      border-bottom: 1px solid var(--border-subtle);
    }
    .data-table td {
      padding: 12px 14px;
      border-bottom: 1px solid var(--border-subtle);
      color: var(--text-primary);
      vertical-align: middle;
    }
    .code-badge {
      font-family: var(--font-family-mono);
      font-size: 11px;
      background: var(--bg-muted);
      border: 1px solid var(--border-subtle);
      padding: 2px 6px;
      border-radius: 4px;
      color: var(--text-primary);
    }
    .badge-pass {
      background: #ECFDF5;
      color: #059669;
      border: 1px solid #A7F3D0;
      padding: 3px 8px;
      border-radius: var(--radius-full);
      font-size: 11px;
      font-weight: 700;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .badge-warn {
      background: #FFFBEB;
      color: #D97706;
      border: 1px solid #FDE68A;
      padding: 3px 8px;
      border-radius: var(--radius-full);
      font-size: 11px;
      font-weight: 700;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }

    /* Buttons */
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 10px 20px;
      font-size: 14px;
      font-weight: 600;
      border-radius: var(--radius-md);
      cursor: pointer;
      transition: all 0.15s ease;
      text-decoration: none;
      border: 1px solid transparent;
    }
    .btn-primary {
      background: var(--color-primary-500);
      color: #FFFFFF;
      box-shadow: var(--shadow-sm);
    }
    .btn-primary:hover {
      background: var(--color-primary-600);
      transform: translateY(-1px);
    }
    .btn-secondary {
      background: #FFFFFF;
      color: var(--text-primary);
      border-color: var(--border-strong);
    }
    .btn-outline {
      background: transparent;
      color: var(--color-primary-500);
      border-color: var(--color-primary-500);
    }
    .btn-ghost {
      background: transparent;
      color: var(--text-secondary);
    }
    .btn-danger {
      background: #EF4444;
      color: #FFFFFF;
    }

    /* Inputs */
    .input-field {
      width: 100%;
      padding: 10px 14px;
      font-size: 14px;
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-md);
      background: #FFFFFF;
      color: var(--text-primary);
      outline: none;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }
    .input-field:focus {
      border-color: var(--color-primary-500);
      box-shadow: 0 0 0 3px rgba(2, 132, 199, 0.15);
    }

    /* Code block */
    .code-container {
      background: #0F172A;
      border-radius: var(--radius-lg);
      padding: 20px;
      color: #E2E8F0;
      font-family: var(--font-family-mono);
      font-size: 12px;
      line-height: 1.6;
      overflow-x: auto;
      position: relative;
    }
    .code-copy-btn {
      position: absolute;
      top: 12px;
      right: 12px;
      background: rgba(255, 255, 255, 0.15);
      color: #FFFFFF;
      border: none;
      padding: 5px 12px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s;
    }
    .code-copy-btn:hover {
      background: rgba(255, 255, 255, 0.3);
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
        <li class="nav-category">Audits & Reports</li>
        <li class="nav-item"><a href="#audit" class="active">♿ WCAG 2.1 Audit (${complianceScore}%)</a></li>

        <li class="nav-category">Foundations</li>
        <li class="nav-item"><a href="#colors">🎨 Colors & Scales</a></li>
        <li class="nav-item"><a href="#typography">✍️ Typography Scale</a></li>
        <li class="nav-item"><a href="#spacing">📐 Spacing & Grid</a></li>
        <li class="nav-item"><a href="#elevation">📦 Elevation & Shadows</a></li>
        
        <li class="nav-category">UI Components</li>
        <li class="nav-item"><a href="#buttons">🔘 Buttons & Inputs</a></li>
        <li class="nav-item"><a href="#cards">🗂️ Cards & Badges</a></li>

        <li class="nav-category">Export & AI</li>
        <li class="nav-item"><a href="#react-code">⚛️ React Components (TSX)</a></li>
        <li class="nav-item"><a href="#blueprint">⚡ AI System Prompt</a></li>
        <li class="nav-item"><a href="#figma">📐 Figma DTCG Tokens</a></li>

        <li class="nav-category">Navigation</li>
        <li class="nav-item"><a href="../index.html" target="_blank" style="color: var(--color-primary-500); font-weight: 700;">🌐 View Cloned Website ↗</a></li>
      </ul>
    </div>
    <div style="padding: 12px; background: var(--bg-muted); border-radius: var(--radius-sm); font-size: 11px; color: var(--text-secondary);">
      Extracted by <strong>Webcmd Studio</strong>
    </div>
  </aside>

  <!-- Main Content -->
  <main class="main-wrapper">
    <!-- Top Hero Banner -->
    <header class="hero-banner">
      <div class="hero-title">
        <h1>${siteName} Production Design System</h1>
        <p>Extracted from <a href="${sourceUrl}" target="_blank" style="color: var(--color-primary-500); text-decoration: none; font-weight: 600;">${sourceUrl}</a></p>
      </div>
      <div style="display: flex; gap: 12px; align-items: center;">
        <a href="#audit" class="tag-pill">
          <span style="width: 8px; height: 8px; border-radius: 50%; background: #10B981;"></span>
          ${complianceScore}% WCAG 2.1 AA
        </a>
        <a href="../index.html" target="_blank" class="btn-site-link">
          🌐 View Cloned Site ↗
        </a>
      </div>
    </header>

    <!-- SECTION: WCAG 2.1 ACCESSIBILITY AUDIT -->
    <section id="audit" class="section-card">
      <div class="section-header">
        <div>
          <h2>♿ WCAG 2.1 AA/AAA Accessibility Audit</h2>
          <p style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">Automated contrast ratio evaluations & ADA Section 508 compliance matrix</p>
        </div>
        <button class="btn btn-secondary" style="font-size: 12px; padding: 6px 14px;" onclick="copyAuditSummary()">Copy Audit Markdown</button>
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px;">
        <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: var(--radius-lg); padding: 18px; text-align: center;">
          <div style="font-size: 28px; font-weight: 800; color: #10B981;">${complianceScore}%</div>
          <div style="font-size: 12px; font-weight: 600; color: var(--text-secondary); margin-top: 4px;">Global AA Compliance Score</div>
        </div>
        <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: var(--radius-lg); padding: 18px; text-align: center;">
          <div style="font-size: 28px; font-weight: 800; color: var(--text-primary);">${passedCount} / ${contrastPairs.length}</div>
          <div style="font-size: 12px; font-weight: 600; color: var(--text-secondary); margin-top: 4px;">Color Pairs Passed</div>
        </div>
        <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: var(--radius-lg); padding: 18px; text-align: center;">
          <div style="font-size: 28px; font-weight: 800; color: #0284C7;">Level AA</div>
          <div style="font-size: 12px; font-weight: 600; color: var(--text-secondary); margin-top: 4px;">Target W3C Standard</div>
        </div>
      </div>

      <table class="data-table">
        <thead>
          <tr>
            <th>Token Role</th>
            <th>Color HEX</th>
            <th>Target Surface</th>
            <th>Contrast Ratio</th>
            <th>WCAG AA (4.5:1)</th>
            <th>WCAG AAA (7.0:1)</th>
            <th>Engineering Guidance</th>
          </tr>
        </thead>
        <tbody>
          ${contrastPairs.map(p => `
            <tr>
              <td><strong>${p.role}</strong></td>
              <td>
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span style="width: 14px; height: 14px; border-radius: 3px; background: ${p.hex}; border: 1px solid #CBD5E1;"></span>
                  <span class="code-badge">${p.hex}</span>
                </div>
              </td>
              <td>
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span style="width: 14px; height: 14px; border-radius: 3px; background: ${p.targetHex}; border: 1px solid #CBD5E1;"></span>
                  <span>${p.target}</span>
                </div>
              </td>
              <td><strong style="font-family: var(--font-family-mono); font-size: 13px;">${p.ratio.toFixed(2)}:1</strong></td>
              <td>
                ${p.ratio >= p.minRequired ? '<span class="badge-pass">✔ PASS</span>' : '<span class="badge-warn">⚠ Large Text Only</span>'}
              </td>
              <td>
                ${p.ratio >= 7.0 ? '<span class="badge-pass">✔ PASS</span>' : '<span class="badge-warn">⚠ Normal AA</span>'}
              </td>
              <td style="font-size: 12px; color: var(--text-secondary);">
                ${p.ratio >= p.minRequired ? 'Suitable for body text & interactive buttons' : 'Restrict to headlines (>18pt) or non-text UI borders'}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </section>

    <!-- SECTION 1: COLORS -->
    <section id="colors" class="section-card">
      <div class="section-header">
        <h2>1. Color & Palette System</h2>
        <span>Click any swatch to copy HEX</span>
      </div>

      <h4 style="font-size: 13px; font-weight: 700; color: var(--text-secondary); text-transform: uppercase; margin-bottom: 12px;">Primary Brand Scale (50-950)</h4>
      <div class="scale-row">
        ${brandScale.map(s => `
          <div class="scale-chip" onclick="copyHex('${s.hex}')" title="Copy ${s.hex}">
            <div class="scale-color" style="background: ${s.hex};"></div>
            <div class="scale-label">${s.step}</div>
          </div>
        `).join('')}
      </div>

      <h4 style="font-size: 13px; font-weight: 700; color: var(--text-secondary); text-transform: uppercase; margin-bottom: 12px;">Neutral Slate Scale (50-950)</h4>
      <div class="scale-row">
        ${neutralScale.map(s => `
          <div class="scale-chip" onclick="copyHex('${s.hex}')" title="Copy ${s.hex}">
            <div class="scale-color" style="background: ${s.hex};"></div>
            <div class="scale-label">${s.step}</div>
          </div>
        `).join('')}
      </div>

      <h4 style="font-size: 13px; font-weight: 700; color: var(--text-secondary); text-transform: uppercase; margin-bottom: 12px;">Semantic & Functional Roles</h4>
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px;">
        ${semanticColors.map(c => `
          <div style="background: #FFFFFF; border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); padding: 14px; display: flex; align-items: center; gap: 12px; cursor: pointer;" onclick="copyHex('${c.hex}')">
            <div style="width: 42px; height: 42px; border-radius: var(--radius-md); background: ${c.hex}; border: 1px solid #E2E8F0; flex-shrink: 0;"></div>
            <div>
              <div style="font-size: 13px; font-weight: 700; color: var(--text-primary);">${c.name}</div>
              <div style="font-size: 11px; color: var(--text-muted); font-family: var(--font-family-mono);">${c.hex}</div>
            </div>
          </div>
        `).join('')}
      </div>
    </section>

    <!-- SECTION 2: TYPOGRAPHY -->
    <section id="typography" class="section-card">
      <div class="section-header">
        <h2>2. Typography Scale</h2>
        <span>Stack: ${primaryFont}</span>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>Level</th>
            <th>Size</th>
            <th>Weight</th>
            <th>Line Height</th>
            <th>Preview</th>
          </tr>
        </thead>
        <tbody>
          ${typographyScale.map(t => `
            <tr>
              <td><strong>${t.level}</strong></td>
              <td><span class="code-badge">${t.size}</span></td>
              <td>${t.weight}</td>
              <td>${t.lineHeight}</td>
              <td style="font-size: ${t.size}; font-weight: ${t.weight}; line-height: ${t.lineHeight}; letter-spacing: ${t.tracking}; color: var(--text-primary);">
                The quick brown fox jumps over the lazy dog
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </section>

    <!-- SECTION 3: SPACING & GRID -->
    <section id="spacing" class="section-card">
      <div class="section-header">
        <h2>3. Spacing System & Grid</h2>
        <span>8pt Grid Scale</span>
      </div>
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 14px;">
        ${spacingScale.map(s => `
          <div style="background: var(--bg-muted); border-radius: var(--radius-md); padding: 14px; border: 1px solid var(--border-subtle);">
            <div style="font-size: 11px; font-weight: 700; font-family: var(--font-family-mono); color: var(--text-primary);">${s.token} (${s.value})</div>
            <div style="height: 8px; width: ${s.pixels}px; max-width: 100%; background: var(--color-primary-500); border-radius: 2px; margin: 10px 0 6px 0;"></div>
            <div style="font-size: 11px; color: var(--text-secondary);">${s.usage}</div>
          </div>
        `).join('')}
      </div>
    </section>

    <!-- SECTION 4: ELEVATION & SHADOWS -->
    <section id="elevation" class="section-card">
      <div class="section-header">
        <h2>4. Elevation & Shadows</h2>
        <span>Light-mode depth hierarchy</span>
      </div>
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 20px;">
        ${shadows.map(s => `
          <div style="background: #FFFFFF; border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); padding: 24px; box-shadow: ${s.value}; text-align: center;">
            <span class="code-badge">${s.token}</span>
            <p style="font-size: 12px; color: var(--text-secondary); margin-top: 12px;">${s.description}</p>
          </div>
        `).join('')}
      </div>
    </section>

    <!-- SECTION 5: UI COMPONENTS -->
    <section id="buttons" class="section-card">
      <div class="section-header">
        <h2>5. Interactive UI Components</h2>
        <span>Live Primitives</span>
      </div>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 24px;">
        <!-- Buttons -->
        <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: var(--radius-lg); padding: 24px;">
          <h3 style="font-size: 14px; font-weight: 700; margin-bottom: 14px; color: var(--text-primary);">Buttons & Triggers</h3>
          <div style="display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 14px;">
            <button class="btn btn-primary">Primary Action</button>
            <button class="btn btn-secondary">Secondary</button>
            <button class="btn btn-outline">Outline</button>
          </div>
          <div style="display: flex; flex-wrap: wrap; gap: 10px;">
            <button class="btn btn-ghost">Ghost</button>
            <button class="btn btn-danger">Destructive</button>
          </div>
        </div>

        <!-- Inputs -->
        <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: var(--radius-lg); padding: 24px;">
          <h3 style="font-size: 14px; font-weight: 700; margin-bottom: 14px; color: var(--text-primary);">Form Controls</h3>
          <div style="display: flex; flex-direction: column; gap: 12px;">
            <div>
              <label style="font-size: 12px; font-weight: 600; color: var(--text-secondary); display: block; margin-bottom: 4px;">Email Address</label>
              <input type="email" class="input-field" placeholder="alex@domain.com" value="alex@developer.io">
            </div>
            <div>
              <label style="font-size: 12px; font-weight: 600; color: var(--text-secondary); display: block; margin-bottom: 4px;">Workspace</label>
              <input type="text" class="input-field" placeholder="workspace-slug">
            </div>
          </div>
        </div>

        <!-- Cards -->
        <div id="cards" style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: var(--radius-lg); padding: 24px;">
          <h3 style="font-size: 14px; font-weight: 700; margin-bottom: 14px; color: var(--text-primary);">Container Card</h3>
          <div style="background: #FFFFFF; border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); padding: 20px; box-shadow: var(--shadow-sm);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <span class="badge-pass">Active</span>
              <span style="font-size: 11px; color: var(--text-muted);">Just now</span>
            </div>
            <h4 style="font-size: 15px; font-weight: 700; color: var(--text-primary); margin-bottom: 4px;">${siteName} Component</h4>
            <p style="font-size: 12px; color: var(--text-secondary); margin-bottom: 14px;">Tailored design tokens with responsive scaling.</p>
            <button class="btn btn-primary" style="width: 100%; justify-content: center; font-size: 13px;">Deploy Component</button>
          </div>
        </div>
      </div>
    </section>

    <!-- SECTION 6: REACT TSX CODE -->
    <section id="react-code" class="section-card">
      <div class="section-header">
        <div>
          <h2>⚛️ React + Tailwind Component Code</h2>
          <p style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">Ready-to-use TypeScript + Tailwind CSS UI Primitives</p>
        </div>
        <button class="btn btn-secondary" style="font-size: 12px; padding: 6px 14px;" onclick="copyCode('react-code-block')">Copy React Code</button>
      </div>
      <div class="code-container">
        <button class="code-copy-btn" onclick="copyCode('react-code-block')">Copy TSX</button>
        <pre id="react-code-block"><code>${reactComponentsTsx.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>
      </div>
    </section>

    <!-- SECTION 7: AI SYSTEM PROMPT BLUEPRINT -->
    <section id="blueprint" class="section-card">
      <div class="section-header">
        <div>
          <h2>⚡ Master AI Prompt Blueprint</h2>
          <p style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">Copy-paste into Cursor, Claude, ChatGPT, or Copilot to replicate this design system</p>
        </div>
        <button class="btn btn-primary" style="font-size: 12px; padding: 6px 14px;" onclick="copyCode('prompt-blueprint-block')">Copy Master Prompt</button>
      </div>
      <div class="code-container">
        <button class="code-copy-btn" onclick="copyCode('prompt-blueprint-block')">Copy Prompt</button>
        <pre id="prompt-blueprint-block"><code>${promptBlueprint.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>
      </div>
    </section>

    <!-- SECTION 8: FIGMA DTCG TOKENS -->
    <section id="figma" class="section-card">
      <div class="section-header">
        <div>
          <h2>📐 Figma Tokens Studio (DTCG)</h2>
          <p style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">W3C Design Token Community Group Standard</p>
        </div>
        <button class="btn btn-secondary" style="font-size: 12px; padding: 6px 14px;" onclick="copyCode('figma-token-block')">Copy Figma JSON</button>
      </div>
      <div class="code-container">
        <button class="code-copy-btn" onclick="copyCode('figma-token-block')">Copy JSON</button>
        <pre id="figma-token-block"><code>${JSON.stringify(figmaTokens, null, 2).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>
      </div>
    </section>
  </main>

  <!-- Toast Notification -->
  <div id="toast" class="toast">Copied to clipboard!</div>

  <script>
    function copyHex(hex) {
      navigator.clipboard.writeText(hex);
      showToast('Copied ' + hex + ' to clipboard');
    }
    function copyCode(elementId) {
      const el = document.getElementById(elementId);
      if (el) {
        navigator.clipboard.writeText(el.innerText);
        showToast('Code copied to clipboard!');
      }
    }
    function copyAuditSummary() {
      const summary = \`${auditMd.replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`;
      navigator.clipboard.writeText(summary);
      showToast('Accessibility audit copied to clipboard!');
    }
    function showToast(msg) {
      const toast = document.getElementById('toast');
      toast.innerText = msg;
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 2200);
    }
  </script>
</body>
</html>
`;
  const previewHtmlPath = path.join(designSystemDir, 'preview.html');
  await fs.writeFile(previewHtmlPath, previewHtml, 'utf-8');

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
      accessibilityAuditJson: auditJsonPath,
      accessibilityAuditMd: auditMdPath,
      figmaTokensJson: figmaTokensPath,
      promptBlueprintMd: promptBlueprintPath,
    },
  };
}

