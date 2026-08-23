import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import { BANNED_TERMS, findBannedTerms } from './banned-terms';

/**
 * The tone gate.
 *
 * A family under debt pressure does not need to be told they "חרגו" or to work out
 * what "נזילות" means. 03-UX-SPEC.md § Microcopy asks for calm, plain and blameless
 * language, and a rule that lives only in a document drifts the first time somebody
 * is in a hurry. This makes it fail a test instead.
 *
 * The rule table and this file are excluded from the scan for the reason
 * `ADR-0005` gives for the forbidden-artifact scanner: a list of forbidden words
 * has to contain them. The blind spot is closed by the fixture tests below, which
 * prove every rule actually fires.
 */

const WEB_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Paths whose job is to name the forbidden words. */
const SELF_EXCLUDED = ['lib/copy/banned-terms.ts', 'lib/copy/tone.test.ts'];

const SCANNED_EXTENSIONS = ['.ts', '.tsx'];

/**
 * Comments are removed before scanning.
 *
 * A comment that cites "02-FINANCIAL-RULES.md § נזילות מול ודאות" is naming a
 * section of the specification, not speaking to a family. What ships is the string
 * literals and the JSX text, and those are what this gate judges.
 */
function withoutComments(source: string): string {
  const withoutBlocks = source.replace(/\/\*[\s\S]*?\*\//g, ' ');
  // The `[^:]` guard keeps `https://` and other URLs from being read as a comment.
  return withoutBlocks.replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, acc);
      continue;
    }
    if (SCANNED_EXTENSIONS.some((extension) => entry.endsWith(extension))) acc.push(full);
  }
  return acc;
}

const files = [
  ...sourceFiles(join(WEB_ROOT, 'app')),
  ...sourceFiles(join(WEB_ROOT, 'lib')),
  ...sourceFiles(join(WEB_ROOT, 'components')),
]
  .map((file) => file.slice(WEB_ROOT.length).split('\\').join('/'))
  .filter((file) => !SELF_EXCLUDED.includes(file));

describe('the scan covers what it claims to', () => {
  test('it found the screens and the copy module', () => {
    expect(files).toContain('app/page.tsx');
    expect(files).toContain('app/budget/page.tsx');
    expect(files).toContain('lib/copy/copy.ts');
    expect(files).toContain('lib/copy/notices.ts');
    expect(files.length).toBeGreaterThan(10);
  });
});

describe('no screen speaks like an economist', () => {
  test.each(files)('%s uses no forbidden term', (file) => {
    const found = findBannedTerms(withoutComments(readFileSync(join(WEB_ROOT, file), 'utf8')));
    expect(
      found.map((entry) => `${entry.term} → ${entry.instead}`),
      `${file} uses language this product does not use`,
    ).toEqual([]);
  });
});

describe('the rule is not vacuous', () => {
  test('every listed term is detected in a positive fixture', () => {
    for (const entry of BANNED_TERMS) {
      expect(
        findBannedTerms(`טקסט לדוגמה עם ${entry.term} בתוכו`).map((found) => found.term),
        `${entry.term} is listed but not detected`,
      ).toContain(entry.term);
    }
  });

  test('clean, warm copy passes', () => {
    const good = [
      'החודש צפוף יותר, אבל עדיין אפשר לבחור מה לעשות עכשיו.',
      'כדי לחשב סכום בטוח, בואו נשלים עוד שני פרטים.',
      'החוב ירד — זו התקדמות אמיתית.',
      'השבוע יצא קצת יותר על אוכל. נשארו 1,340 ₪ עד סוף החודש.',
      'שולם חוב אחד, אבל נפתח חוב חדש באותו סכום. לכן סך החובות עדיין לא ירד.',
    ];
    for (const sentence of good) {
      expect(findBannedTerms(sentence)).toEqual([]);
    }
  });

  test('the two kinds of problem are both represented', () => {
    expect(BANNED_TERMS.some((entry) => entry.kind === 'jargon')).toBe(true);
    expect(BANNED_TERMS.some((entry) => entry.kind === 'blame')).toBe(true);
  });

  test('every rule offers something to say instead, except where silence is the answer', () => {
    for (const entry of BANNED_TERMS) {
      expect(typeof entry.instead).toBe('string');
    }
  });
});
