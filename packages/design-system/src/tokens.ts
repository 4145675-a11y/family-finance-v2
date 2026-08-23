/**
 * Design tokens — the single source of truth for the visual language.
 *
 * Source: 04-DESIGN-SYSTEM.md. That document instructs "יש לאמת ניגודיות לפני נעילה"
 * (verify contrast before locking), so two values differ from the draft palette. Both
 * deviations, and the reason for each, are recorded in ADR-0008 and enforced by
 * tokens.test.ts — no pair ships without a passing contrast assertion.
 *
 * apps/web/app/globals.css mirrors these values into a Tailwind `@theme` block.
 * tokens.test.ts fails if the two drift apart.
 */

import type { HexColor } from './contrast';

export const color = {
  background: '#F7F8F5',
  surface: '#FFFFFF',
  textPrimary: '#18302B',
  textSecondary: '#5E706C',
  primary: '#285E61',
  primaryHover: '#204E50',
  success: '#2F7D62',
  /** Darkened from the draft #A66A16, which reached only 4.47:1 as text. See ADR-0008. */
  attention: '#9E6515',
  danger: '#B43A3A',
  /** Decorative divider only — never the sole indicator of a control boundary. */
  border: '#DDE5E1',
  /** Boundary colour for controls that are identified by their border. See ADR-0008. */
  borderInteractive: '#8B908E',
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
  heading: { s: 20, m: 24, l: 32 },
} as const;

/** Minimum touch target in pixels, per 04-DESIGN-SYSTEM.md. */
export const minTouchTargetPx = 44;

/**
 * Contrast pairs that must hold for the palette to be usable, with the WCAG rule that
 * drives each minimum. Verified in tokens.test.ts.
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
