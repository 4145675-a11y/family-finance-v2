import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import { contrastRatio, WCAG_AA } from './contrast.js';
import {
  color,
  minTouchTargetPx,
  motion,
  radius,
  requiredContrast,
  space,
  typography,
} from './tokens.js';

/** The Tailwind theme block that mirrors these tokens. */
const GLOBALS_CSS = fileURLToPath(
  new URL('../../../apps/web/app/globals.css', import.meta.url),
);

describe('palette contrast (UX-A11Y-001)', () => {
  test.each(requiredContrast)(
    '$foreground on $background meets $minimum:1 ($rule)',
    ({ foreground, background, minimum }) => {
      const ratio = contrastRatio(color[foreground], color[background]);
      expect(
        ratio,
        `${foreground} (${color[foreground]}) on ${background} (${color[background]}) = ${ratio.toFixed(2)}:1, needs ${minimum}:1`,
      ).toBeGreaterThanOrEqual(minimum);
    },
  );

  test('every colour token is a six-digit hex value', () => {
    for (const [name, value] of Object.entries(color)) {
      expect(value, `${name} must be #RRGGBB`).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  test('the decorative border is deliberately below the 3:1 component threshold', () => {
    // Recorded intent, not an oversight: `border` is a divider, never the sole
    // indicator of a control. Controls use `borderInteractive`, which is asserted
    // above. If someone raises `border` to 3:1 this test tells them to reconsider
    // which token they actually need.
    expect(contrastRatio(color.border, color.surface)).toBeLessThan(WCAG_AA.nonText);
    expect(contrastRatio(color.borderInteractive, color.surface)).toBeGreaterThanOrEqual(
      WCAG_AA.nonText,
    );
  });
});

describe('scales', () => {
  test('spacing matches the specified scale', () => {
    expect(space).toEqual([4, 8, 12, 16, 24, 32, 48]);
  });

  test('spacing increases strictly', () => {
    for (let i = 1; i < space.length; i += 1) {
      expect(space[i]!).toBeGreaterThan(space[i - 1]!);
    }
  });

  test('radii and motion match the specification', () => {
    expect(radius).toEqual({ control: 8, card: 14, hero: 18 });
    expect(motion.fast).toBe(120);
    expect(motion.slow).toBe(200);
  });

  test('motion stays inside the 120–200ms band', () => {
    expect(motion.fast).toBeGreaterThanOrEqual(120);
    expect(motion.slow).toBeLessThanOrEqual(200);
  });

  test('typography matches the specification', () => {
    expect(typography.body).toEqual({ size: 16, lineHeight: 1.55 });
    expect(typography.small.size).toBe(14);
    expect(typography.heading).toEqual({ s: 20, m: 24, l: 32 });
  });

  test('the Hebrew-first font stack is ordered Assistant, Heebo, system', () => {
    const stack = typography.fontFamily;
    expect(stack.indexOf('Assistant')).toBeLessThan(stack.indexOf('Heebo'));
    expect(stack.indexOf('Heebo')).toBeLessThan(stack.indexOf('system-ui'));
  });

  test('minimum touch target is 44px', () => {
    expect(minTouchTargetPx).toBe(44);
  });
});

describe('globals.css mirrors the token source', () => {
  const css = readFileSync(GLOBALS_CSS, 'utf8');

  /** `--color-text-primary` from `textPrimary`. */
  const cssVariableName = (token: string) =>
    `--color-${token.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

  test.each(Object.entries(color))('%s is declared with the same value', (token, value) => {
    const declaration = new RegExp(`${cssVariableName(token)}:\\s*${value};`, 'i');
    expect(css, `expected globals.css to declare ${cssVariableName(token)}: ${value};`).toMatch(
      declaration,
    );
  });

  test('declares no colour variable that the token source does not define', () => {
    const declared = [...css.matchAll(/--color-([a-z-]+):/g)].map((m) => m[1]!);
    const expected = Object.keys(color).map((token) =>
      token.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`),
    );
    expect(declared.sort()).toEqual(expected.sort());
  });
});
