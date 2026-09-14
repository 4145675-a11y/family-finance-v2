/**
 * Design tokens — the single source of truth for the visual language.
 *
 * Source: 04-DESIGN-SYSTEM.md. That document instructs "יש לאמת ניגודיות לפני נעילה",
 * so every pair below is asserted in tokens.test.ts and nothing ships without a
 * passing contrast check. Deviations from the draft palette are recorded in
 * ADR-0008 and ADR-0020.
 *
 * The palette was revised once the first screens were seen in a browser: the
 * original values were technically compliant and visually pale, which read as
 * unfinished rather than calm. The revision keeps the same character — warm,
 * familial, not a bank — with more depth: a warm off-white ground, a deep blue for
 * the one answer that matters, and green kept exclusively for real progress.
 *
 * apps/web/app/globals.css mirrors these values into a Tailwind `@theme` block.
 * tokens.test.ts fails if the two drift apart.
 */

import type { HexColor } from './contrast';

export const color = {
  /** Warm off-white. A neutral grey ground made the cards look like a spreadsheet. */
  background: '#FAF7F2',
  surface: '#FFFFFF',
  /** For nested panels and table headers, so a card can have depth without a border. */
  surfaceMuted: '#F3EEE6',
  textPrimary: '#1B2A2C',
  textSecondary: '#586B6C',
  /** Deep soft blue: primary actions and the dominant safe-spend answer. */
  primary: '#1E4F73',
  primaryHover: '#173D5A',
  /** Muted teal-green. Reserved for genuine progress — never for decoration. */
  success: '#2C7A5E',
  attention: '#9A6410',
  /** Restrained red, used only where something is actually at risk. */
  danger: '#AF3A34',
  /** Decorative divider only — never the sole indicator of a control boundary. */
  border: '#E6DED2',
  /** Boundary colour for controls that are identified by their border. */
  borderInteractive: '#87837B',
  focus: '#2B6CB0',
} as const satisfies Record<string, HexColor>;

export type ColorToken = keyof typeof color;

/** Spacing scale in pixels. 04-DESIGN-SYSTEM.md: 4, 8, 12, 16, 24, 32, 48. */
export const space = [4, 8, 12, 16, 24, 32, 48] as const;

/** Corner radii in pixels. */
export const radius = {
  control: 8,
  card: 14,
  hero: 18,
  /** Added, not a deviation: fully round ends for pills and progress bars. */
  pill: 999,
} as const;

/**
 * Elevation.
 *
 * Three steps and no more. Soft, warm-tinted shadows rather than grey ones, so a
 * raised card still belongs to the same room as the background.
 */
export const shadow = {
  card: '0 1px 2px rgba(27, 42, 44, 0.04), 0 2px 8px rgba(27, 42, 44, 0.04)',
  raised: '0 2px 4px rgba(27, 42, 44, 0.05), 0 8px 24px rgba(27, 42, 44, 0.06)',
  hero: '0 4px 12px rgba(30, 79, 115, 0.10), 0 16px 40px rgba(30, 79, 115, 0.10)',
} as const;

/** Motion durations in milliseconds; disabled under prefers-reduced-motion. */
export const motion = {
  fast: 120,
  slow: 200,
} as const;

export const typography = {
  /** Assistant preferred, Heebo fallback, then system sans. */
  fontFamily:
    "'Assistant', 'Heebo', system-ui, -apple-system, 'Segoe UI', 'Noto Sans Hebrew', sans-serif",
  body: { size: 16, lineHeight: 1.55 },
  small: { size: 14, lineHeight: 1.5 },
  /** The safe-spend figure. Large enough to be the answer, not so large it shouts. */
  display: { size: 44, lineHeight: 1.1 },
  heading: { s: 20, m: 24, l: 32 },
} as const;

/** Minimum touch target in pixels, per 04-DESIGN-SYSTEM.md. */
export const minTouchTargetPx = 44;

/**
 * Contrast pairs that must hold for the palette to be usable, with the WCAG rule
 * that drives each minimum. Verified in tokens.test.ts.
 */
export const requiredContrast = [
  {
    foreground: 'textPrimary',
    background: 'background',
    minimum: 4.5,
    rule: '1.4.3 normal text',
  },
  { foreground: 'textPrimary', background: 'surface', minimum: 4.5, rule: '1.4.3 normal text' },
  {
    foreground: 'textPrimary',
    background: 'surfaceMuted',
    minimum: 4.5,
    rule: '1.4.3 normal text',
  },
  {
    foreground: 'textSecondary',
    background: 'background',
    minimum: 4.5,
    rule: '1.4.3 normal text',
  },
  {
    foreground: 'textSecondary',
    background: 'surface',
    minimum: 4.5,
    rule: '1.4.3 normal text',
  },
  {
    foreground: 'textSecondary',
    background: 'surfaceMuted',
    minimum: 4.5,
    rule: '1.4.3 normal text',
  },
  { foreground: 'primary', background: 'background', minimum: 4.5, rule: '1.4.3 normal text' },
  { foreground: 'primary', background: 'surface', minimum: 4.5, rule: '1.4.3 normal text' },
  { foreground: 'surface', background: 'primary', minimum: 4.5, rule: '1.4.3 text on primary' },
  {
    foreground: 'surface',
    background: 'primaryHover',
    minimum: 4.5,
    rule: '1.4.3 text on primary',
  },
  { foreground: 'surface', background: 'success', minimum: 4.5, rule: '1.4.3 text on success' },
  {
    foreground: 'surface',
    background: 'attention',
    minimum: 4.5,
    rule: '1.4.3 text on attention',
  },
  { foreground: 'surface', background: 'danger', minimum: 4.5, rule: '1.4.3 text on danger' },
  {
    foreground: 'attention',
    background: 'background',
    minimum: 4.5,
    rule: '1.4.3 normal text',
  },
  { foreground: 'attention', background: 'surface', minimum: 4.5, rule: '1.4.3 normal text' },
  { foreground: 'success', background: 'surface', minimum: 4.5, rule: '1.4.3 normal text' },
  { foreground: 'success', background: 'background', minimum: 4.5, rule: '1.4.3 normal text' },
  { foreground: 'danger', background: 'background', minimum: 4.5, rule: '1.4.3 normal text' },
  { foreground: 'danger', background: 'surface', minimum: 4.5, rule: '1.4.3 normal text' },
  { foreground: 'focus', background: 'background', minimum: 3, rule: '1.4.11 focus indicator' },
  { foreground: 'focus', background: 'surface', minimum: 3, rule: '1.4.11 focus indicator' },
  {
    foreground: 'borderInteractive',
    background: 'surface',
    minimum: 3,
    rule: '1.4.11 control boundary',
  },
  {
    foreground: 'borderInteractive',
    background: 'background',
    minimum: 3,
    rule: '1.4.11 control boundary',
  },
] as const satisfies readonly {
  foreground: ColorToken;
  background: ColorToken;
  minimum: number;
  rule: string;
}[];
