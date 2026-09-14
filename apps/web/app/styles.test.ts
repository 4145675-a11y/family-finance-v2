import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

/**
 * Every colour a screen names must be a colour that exists.
 *
 * This file exists because of one bug, and the bug is worth describing because
 * nothing else in the suite could have caught it.
 *
 * The passkey buttons were written with `bg-brand` and `hover:bg-brand-strong`.
 * Neither is a token in `globals.css`, so Tailwind generated no rule for them,
 * so the buttons had no background — and they were also given `text-white`. The
 * result was white text on a white card: an element present in the DOM, sized
 * 133×45, `visibility: visible`, `opacity: 1`, announced correctly to a screen
 * reader, and completely invisible to a person. The enrolment flow could not be
 * started at all.
 *
 * Every existing check passed. The typechecker does not read class strings, the
 * linter has no opinion on them, the shell gate looks at structure, and the
 * runtime checks I ran read `innerText` — which was correct the whole time.
 *
 * A misspelt utility silently does nothing. That is the property being guarded
 * here: not that the design is good, but that a colour a screen asks for is one
 * the theme can actually give it.
 */

const WEB_ROOT = join(import.meta.dirname, '..');
const THEME = join(WEB_ROOT, 'app', 'globals.css');

/** Token names declared in the theme, e.g. `primary`, `surface-muted`. */
function themeColours(): Set<string> {
  const css = readFileSync(THEME, 'utf8');
  const names = new Set<string>();
  for (const match of css.matchAll(/--color-([a-z0-9-]+):/g)) {
    const name = match[1];
    if (name !== undefined) names.add(name);
  }
  return names;
}

/**
 * Colour keywords Tailwind resolves without a theme token.
 *
 * Deliberately short. The point of a theme is that screens use it, so a long
 * list of escapes here would defeat the exercise.
 */
const BUILT_IN = new Set(['transparent', 'current', 'inherit', 'white', 'black']);

/** Utilities whose prefix looks like a colour but whose value is not one. */
const NOT_A_COLOUR: Readonly<Record<string, readonly string[]>> = {
  // `text-` also carries the type scale and alignment.
  text: [
    'body',
    'small',
    'display',
    'start',
    'end',
    'center',
    'right',
    'left',
    'wrap',
    'nowrap',
  ],
  // `border-` also carries width, side and style: `border-b-0`, `border-dashed`.
  border: [
    '0',
    '2',
    '4',
    '8',
    'collapse',
    'separate',
    'solid',
    'dashed',
    'dotted',
    'double',
    'hidden',
    ...['b', 't', 's', 'e', 'x', 'y', 'l', 'r'].flatMap((side) => [
      side,
      ...['0', '2', '4', '8'].map((width) => `${side}-${width}`),
    ]),
  ],
  bg: ['none', 'cover', 'contain', 'fixed', 'local', 'scroll'],
  outline: ['0', '1', '2', '4', '8', 'none', 'hidden', 'offset-1', 'offset-2', 'offset-4'],
};

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path));
      continue;
    }
    if (entry.endsWith('.tsx')) found.push(path);
  }
  return found;
}

/**
 * Strips comments before scanning.
 *
 * A comment explaining a mistake — including this one's own cause, written out
 * in `passkey.tsx` — must not be read as the mistake being made again.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

interface Reference {
  readonly file: string;
  readonly utility: string;
  readonly prefix: string;
  readonly value: string;
}

function colourReferences(): Reference[] {
  const files = [
    ...sourceFiles(join(WEB_ROOT, 'app')),
    ...sourceFiles(join(WEB_ROOT, 'components')),
  ];

  const references: Reference[] = [];

  for (const file of files) {
    const source = withoutComments(readFileSync(file, 'utf8'));

    // A utility as it appears in a class string: an optional variant prefix,
    // then `bg-`/`text-`/`border-`/`outline-`, then the value, then an optional
    // opacity suffix.
    for (const match of source.matchAll(
      /(?:^|[\s"'`{])(?:[a-z-]+:)*((bg|text|border|outline)-([a-z][a-z0-9-]*))(?:\/\d+)?(?=[\s"'`}]|$)/gm,
    )) {
      const [, utility, prefix, value] = match;
      if (utility === undefined || prefix === undefined || value === undefined) continue;
      references.push({ file: file.slice(WEB_ROOT.length + 1), utility, prefix, value });
    }
  }

  return references;
}

describe('the colours a screen asks for', () => {
  const colours = themeColours();

  test('the theme declares the palette the product was designed around', () => {
    // A guard on the guard: if the token names moved, everything below would
    // pass by finding nothing.
    expect(colours.has('primary')).toBe(true);
    expect(colours.has('surface')).toBe(true);
    expect(colours.has('danger')).toBe(true);
    expect(colours.size).toBeGreaterThanOrEqual(10);
  });

  test('some are actually found in the source, so the scan is not empty', () => {
    const references = colourReferences();
    expect(references.length).toBeGreaterThan(100);
  });

  test('every one of them resolves to a token, a keyword, or a non-colour utility', () => {
    const unresolved = colourReferences().filter((reference) => {
      if (colours.has(reference.value)) return false;
      if (BUILT_IN.has(reference.value)) return false;
      if ((NOT_A_COLOUR[reference.prefix] ?? []).includes(reference.value)) return false;
      return true;
    });

    // Named individually: "some class is wrong" is not something a person can act on.
    expect(
      unresolved.map((reference) => `${reference.file}: ${reference.utility}`),
      'these utilities name a colour the theme does not define, so they render as nothing',
    ).toEqual([]);
  });

  test('the passkey buttons carry a background and a contrasting foreground', () => {
    /*
     * The specific regression. A button whose only colour is `text-surface`
     * would be white on white again, so both halves are asserted together.
     */
    const source = withoutComments(
      readFileSync(join(WEB_ROOT, 'components', 'passkey.tsx'), 'utf8'),
    );

    expect(source).toContain('bg-primary');
    expect(source).toContain('text-surface');
    expect(source).not.toContain('bg-brand');
  });
});
