import { describe, expect, test } from 'vitest';

import { contrastRatio, meetsContrast, parseHex, relativeLuminance } from './contrast.js';

describe('parseHex', () => {
  test('splits a six-digit colour into channels', () => {
    expect(parseHex('#FFFFFF')).toEqual([255, 255, 255]);
    expect(parseHex('#000000')).toEqual([0, 0, 0]);
    expect(parseHex('#285E61')).toEqual([40, 94, 97]);
  });

  test('accepts lower-case input', () => {
    expect(parseHex('#285e61')).toEqual([40, 94, 97]);
  });

  test.each(['#FFF', '285E61', '#GGGGGG', '#FFFFFFF', ''])('rejects %s', (bad) => {
    expect(() => parseHex(bad as `#${string}`)).toThrow(/expected a #RRGGBB colour/);
  });
});

describe('relativeLuminance', () => {
  test('anchors at the WCAG reference values', () => {
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 10);
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 10);
  });

  test('increases monotonically with lightness', () => {
    const ramp = ['#000000', '#404040', '#808080', '#C0C0C0', '#FFFFFF'] as const;
    const luminances = ramp.map(relativeLuminance);
    for (let i = 1; i < luminances.length; i += 1) {
      expect(luminances[i]!).toBeGreaterThan(luminances[i - 1]!);
    }
  });
});

describe('contrastRatio', () => {
  test('black on white is the maximum ratio of 21', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
  });

  test('a colour against itself is 1', () => {
    expect(contrastRatio('#285E61', '#285E61')).toBeCloseTo(1, 10);
  });

  test('argument order does not change the result', () => {
    expect(contrastRatio('#18302B', '#F7F8F5')).toBeCloseTo(
      contrastRatio('#F7F8F5', '#18302B'),
      10,
    );
  });

  test('matches an independently known value', () => {
    // #767676 on white is the canonical 4.54:1 example of a minimum AA grey.
    expect(contrastRatio('#767676', '#FFFFFF')).toBeCloseTo(4.54, 2);
  });
});

describe('meetsContrast', () => {
  test('applies the threshold inclusively', () => {
    const ratio = contrastRatio('#767676', '#FFFFFF');
    expect(meetsContrast('#767676', '#FFFFFF', ratio)).toBe(true);
    expect(meetsContrast('#767676', '#FFFFFF', ratio + 0.01)).toBe(false);
  });

  test('rejects a pair that is too close', () => {
    expect(meetsContrast('#DDE5E1', '#FFFFFF', 3)).toBe(false);
  });
});
