/**
 * WCAG 2.2 relative luminance and contrast ratio.
 *
 * 04-DESIGN-SYSTEM.md requires contrast to be verified before the palette is locked,
 * and 03-UX-SPEC.md binds the product to WCAG 2.2 AA (UX-A11Y-001). These functions
 * make that verifiable in a test instead of by eye.
 *
 * Reference: https://www.w3.org/TR/WCAG22/#dfn-relative-luminance
 */

/** Minimum contrast ratios required by WCAG 2.2 AA. */
export const WCAG_AA = {
  /** 1.4.3 — normal-size text. */
  normalText: 4.5,
  /** 1.4.3 — text at 18.66px bold or 24px regular and larger. */
  largeText: 3,
  /** 1.4.11 — boundaries of user interface components and meaningful graphics. */
  nonText: 3,
} as const;

/** A colour written as `#RRGGBB`. */
export type HexColor = `#${string}`;

const HEX_PATTERN = /^#[0-9A-Fa-f]{6}$/;

/**
 * Splits `#RRGGBB` into channel values in the 0–255 range.
 * @throws if the input is not a six-digit hex colour.
 */
export function parseHex(color: HexColor): [number, number, number] {
  if (!HEX_PATTERN.test(color)) {
    throw new Error(`expected a #RRGGBB colour, received: ${color}`);
  }
  return [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
  ];
}

/** Relative luminance of a colour, per WCAG 2.2. */
export function relativeLuminance(color: HexColor): number {
  const channels = parseHex(color).map((value) => {
    const srgb = value / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];

  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/**
 * Contrast ratio between two colours, from 1 (identical) to 21 (black on white).
 * Order of arguments does not matter.
 */
export function contrastRatio(foreground: HexColor, background: HexColor): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

/** True when the pair meets the given minimum ratio. */
export function meetsContrast(
  foreground: HexColor,
  background: HexColor,
  minimum: number,
): boolean {
  return contrastRatio(foreground, background) >= minimum;
}
