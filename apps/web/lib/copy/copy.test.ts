import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import { copy } from './copy';
import {
  KNOWN_NOTICE_CODES,
  ACTION_COPY,
  ACTION_WHY,
  breakdownLabel,
  sayNotice,
} from './notices';

/**
 * The copy layer has to cover the engine completely.
 *
 * The engine returns codes; if one has no sentence here, a screen shows a raw
 * identifier to a family. That is a bug a test should catch, not something a
 * person discovers on the home screen, so this reads the engine source and
 * demands a sentence for every code it can emit.
 */

const ENGINE_SRC = fileURLToPath(
  new URL('../../../../packages/finance-engine/src/', import.meta.url),
);

/** Every `notice('…')` the engine can produce. */
function emittedCodes(): string[] {
  const codes = new Set<string>();
  for (const entry of readdirSync(ENGINE_SRC)) {
    if (!entry.endsWith('.ts') || entry.includes('.test.')) continue;
    const source = readFileSync(join(ENGINE_SRC, entry), 'utf8');
    for (const match of source.matchAll(/notice\(\s*'([^']+)'/g)) {
      const code = match[1];
      if (code !== undefined) codes.add(code);
    }
  }
  return [...codes].sort();
}

const codes = emittedCodes();

describe('coverage of what the engine says', () => {
  test('the scan found the engine codes', () => {
    expect(codes.length).toBeGreaterThan(30);
  });

  test.each(codes)('%s has a sentence', (code) => {
    expect(KNOWN_NOTICE_CODES, `no Hebrew sentence for engine code ${code}`).toContain(code);
  });

  test('every code produces something a person can read', () => {
    for (const code of codes) {
      const said = sayNotice({
        code,
        params: {
          amountMinor: 12_345,
          count: 2,
          days: 3,
          total: 9,
          pending: 1,
          complete: 4,
          shortfallMinor: 500,
          availableMinor: 500,
          spentMinor: 500,
          categoryKey: 'food',
          date: '2026-08-15',
        },
      });
      expect(said, `${code} fell through to its raw code`).not.toBe(code);
      expect(said.length).toBeGreaterThan(3);
    }
  });

  test('no sentence is defined for a code the engine cannot emit', () => {
    const unreachable = KNOWN_NOTICE_CODES.filter((code) => !codes.includes(code));
    expect(unreachable, 'dead copy drifts; remove it or emit it').toEqual([]);
  });
});

describe('numbers inside sentences are isolated', () => {
  const ISOLATE_START = '⁨';
  const ISOLATE_END = '⁩';

  test('a money amount inside Hebrew text carries isolate marks', () => {
    const said = sayNotice({
      code: 'warn.private_debt_callable',
      params: { amountMinor: 500_000 },
    });
    expect(said).toContain(ISOLATE_START);
    expect(said).toContain(ISOLATE_END);
  });

  test('a count inside Hebrew text carries isolate marks', () => {
    const said = sayNotice({ code: 'missing.pending_approvals', params: { count: 7 } });
    expect(said).toContain(ISOLATE_START);
    expect(said).toContain(ISOLATE_END);
  });

  test('screen copy with an amount is isolated too', () => {
    expect(copy.home.safeGap(120_000)).toContain(ISOLATE_START);
    expect(copy.food.remaining(62_000, '2026-08-15')).toContain(ISOLATE_START);
  });

  test('copy without a number needs no isolate mark', () => {
    expect(copy.home.safeMeaning).not.toContain(ISOLATE_START);
  });
});

describe('the recommended action', () => {
  const ACTION_KEYS = [
    'close_funding_gap',
    'move_a_payment',
    'confirm_balances',
    'fund_next_step',
    'stop_new_debt',
    'accelerate_repayment',
    'hold_position',
  ];

  test.each(ACTION_KEYS)('%s has both a sentence and a reason', (key) => {
    expect(ACTION_COPY[key]).toBeDefined();
    expect(ACTION_WHY[key]).toBeDefined();
  });

  test('each one reads as an instruction, not a label', () => {
    for (const key of ACTION_KEYS) {
      const said = ACTION_COPY[key]?.({
        amountMinor: 50_000,
        date: '2026-08-15',
        missingCount: 2,
      });
      expect(said?.length ?? 0).toBeGreaterThan(8);
    }
  });
});

describe('breakdown labels', () => {
  test('every part of the safe-spend calculation is named in plain words', () => {
    for (const key of [
      'verified_liquid_cash',
      'certain_income',
      'approved_business_transfer',
      'essential_needs',
      'certain_due_items',
      'debt_minimums',
      'protected_reserves',
      'safety_floor',
      'reconciliation_gap',
    ]) {
      expect(breakdownLabel(key), `${key} is shown as a raw key`).not.toBe(key);
    }
  });

  test('an unknown key falls back visibly rather than to an empty line', () => {
    expect(breakdownLabel('not_a_real_key')).toBe('not_a_real_key');
  });
});

describe('the category names a family recognises', () => {
  test('all ten are named', () => {
    for (const key of [
      'food',
      'housing_and_bills',
      'transport_and_fuel',
      'health',
      'education',
      'clothing',
      'celebrations_and_gifts',
      'cash_and_small',
      'holidays',
      'other',
    ]) {
      expect(copy.budget.categories[key], `${key} has no Hebrew name`).toBeTruthy();
    }
  });

  test('religious and educational spending are ordinary categories, not targets', () => {
    // 01-PRODUCT-SPEC.md § מחוץ לתכולה forbids recommending their elimination, so
    // they are named neutrally and never carry a cut-me label.
    expect(copy.budget.categories.education).toBe('חינוך');
    expect(copy.budget.categories.holidays).toBe('חגים');
  });
});

describe('sentences read correctly, not just correctly assembled', () => {
  test('the weekly food line names the day once', () => {
    // The Hebrew locale returns "יום שבת" for a weekday, so a literal "יום"
    // prefix produced "עד יום יום שבת" on the running screen.
    const said = copy.food.remaining(62_000, '2026-08-15');
    expect(said).not.toMatch(/יום\s+יום/);
    expect(said).toContain('שבת');
  });

  test('no screen sentence repeats a word immediately', () => {
    const sentences = [
      copy.food.remaining(62_000, '2026-08-15'),
      copy.food.monthProgress(120_000, 400_000),
      copy.home.safeGap(50_000),
      copy.home.tightestDayValue('2026-08-15', 10_000),
    ];
    for (const sentence of sentences) {
      expect(sentence, sentence).not.toMatch(/\b(\S+)\s+\1\b/u);
    }
  });
});
