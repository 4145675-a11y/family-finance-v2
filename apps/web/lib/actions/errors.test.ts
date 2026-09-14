import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { CommandError } from '@family-finance/local-store';
import { describe as group, expect, test } from 'vitest';

import { ERROR_MESSAGES, describe } from './errors';

/**
 * Every refusal the store can produce must have a sentence a family can act on.
 *
 * A thrown error with no entry here shows "לא הצלחנו לשמור את השינוי", which is
 * true and useless. This test reads the store's own source for the codes it
 * throws, so a new refusal cannot be added without the words for it.
 */

const COMMANDS_SOURCE = fileURLToPath(
  new URL('../../../../packages/local-store/src/commands.ts', import.meta.url),
);
const IMPORTS_SOURCE = fileURLToPath(
  new URL('../../../../packages/local-store/src/imports.ts', import.meta.url),
);

/** Every `new CommandError('code', …)` the store contains. */
function thrownCodes(): string[] {
  const sources = [readFileSync(COMMANDS_SOURCE, 'utf8'), readFileSync(IMPORTS_SOURCE, 'utf8')];
  const codes = new Set<string>();
  for (const source of sources) {
    for (const match of source.matchAll(/new CommandError\(\s*'([a-z_]+)'/g)) {
      if (match[1] !== undefined) codes.add(match[1]);
    }
  }
  return [...codes].sort();
}

group('every code the store throws has Hebrew', () => {
  const codes = thrownCodes();

  test('the scan actually found the codes', () => {
    expect(codes.length).toBeGreaterThan(15);
    expect(codes).toContain('already_approved');
    expect(codes).toContain('transfer_needs_counterpart');
  });

  test.each(thrownCodes())('%s has a sentence', (code) => {
    expect(ERROR_MESSAGES[code], `${code} has no Hebrew message`).toBeTruthy();
  });

  test('no message is left over from a code that no longer exists', () => {
    const known = new Set(codes);
    const orphans = Object.keys(ERROR_MESSAGES).filter((code) => !known.has(code));
    expect(orphans, 'these messages describe refusals the store cannot make').toEqual([]);
  });
});

group('what a family is told', () => {
  test('a known refusal is explained', () => {
    const state = describe(new CommandError('same_debt', 'internal wording'));
    expect(state.status).toBe('error');
    expect(state.message).toBe('חוב לא יכול לפרוע את עצמו.');
  });

  test('the internal wording never reaches the screen', () => {
    const state = describe(new CommandError('same_debt', 'a debt cannot pay itself off'));
    expect(state.message).not.toContain('debt cannot pay');
  });

  test('a stale form is explained as a stale form, not as a failure', () => {
    const error = new Error('changed');
    error.name = 'ConcurrentModificationError';
    expect(describe(error).message).toContain('לרענן');
  });

  test('no household is an invitation rather than an error', () => {
    const error = new Error('not set up');
    error.name = 'StoreNotInitialisedError';
    expect(describe(error).message).toContain('הגדרה');
  });

  test('something unexpected still says something useful', () => {
    expect(describe(new TypeError('undefined is not a function')).message).toContain(
      'אפשר לנסות שוב',
    );
  });

  test('an unexpected error never leaks its own text', () => {
    const state = describe(new TypeError('undefined is not a function'));
    expect(state.message).not.toContain('undefined');
  });
});
