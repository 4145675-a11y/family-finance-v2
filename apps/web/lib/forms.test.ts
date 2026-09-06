import { describe, expect, test } from 'vitest';

import { toAmountInput } from './format';
import { FieldReader, errorFor, failed, idleForm, succeeded } from './forms';

/**
 * Reading what a person typed.
 *
 * These are the tests that decide whether a family can enter a number the way
 * they naturally write it. A form that rejects "1,250" and demands "1250" is a
 * form somebody gives up on, and one that accepts "1250" as 12.50 is worse.
 */

function reader(values: Record<string, string>): FieldReader {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.append(key, value);
  return new FieldReader(data);
}

describe('money fields', () => {
  test.each([
    ['1,250', 125_000],
    ['1250', 125_000],
    ['1250.50', 125_050],
    ['1,250.50', 125_050],
    ['₪1,250.50', 125_050],
    ['  1250.50  ', 125_050],
  ])('%s is read as %i minor units', (typed, expected) => {
    const field = reader({ amount: typed });
    expect(field.money('amount', 'סכום')).toBe(expected);
    expect(field.ok).toBe(true);
  });

  test('an amount of nothing is refused, with an example of what to write', () => {
    const field = reader({ amount: 'שלוש מאות' });
    field.money('amount', 'סכום');
    expect(field.ok).toBe(false);
    expect(field.errors[0]?.message).toContain('1,250.50');
  });

  test('zero is refused where money has to move', () => {
    const field = reader({ amount: '0' });
    field.money('amount', 'סכום');
    expect(field.ok).toBe(false);
    expect(field.errors[0]?.message).toContain('גדול מאפס');
  });

  test('zero is allowed where it is a real answer', () => {
    const field = reader({ amount: '0' });
    expect(field.money('amount', 'יתרה', { allowZero: true })).toBe(0);
    expect(field.ok).toBe(true);
  });

  test('an empty optional amount is absent rather than zero', () => {
    const field = reader({ amount: '' });
    expect(field.optionalMoney('amount', 'סכום')).toBeNull();
    expect(field.ok).toBe(true);
  });
});

describe('dates', () => {
  test('the browser format and the Israeli format both work', () => {
    expect(reader({ d: '2026-09-06' }).date('d', 'תאריך')).toBe('2026-09-06');
    expect(reader({ d: '06/09/2026' }).date('d', 'תאריך')).toBe('2026-09-06');
  });

  test('an impossible date is refused', () => {
    const field = reader({ d: '31/02/2026' });
    field.date('d', 'תאריך');
    expect(field.ok).toBe(false);
  });
});

describe('every problem is collected, not just the first', () => {
  test('a form with three mistakes reports three', () => {
    const field = reader({ amount: 'שלוש', date: 'מחר', name: '' });
    field.money('amount', 'סכום');
    field.date('date', 'תאריך');
    field.text('name', 'שם');

    expect(field.errors).toHaveLength(3);
    expect(field.errors.map((error) => error.field)).toEqual(['amount', 'date', 'name']);
  });

  test('an error can be found by the field it belongs to', () => {
    const state = failed('בואו נבדוק', [{ field: 'amount', message: 'הסכום לא ברור' }]);
    expect(errorFor(state, 'amount')).toBe('הסכום לא ברור');
    expect(errorFor(state, 'date')).toBeUndefined();
  });
});

describe('choices and identifiers', () => {
  test('a value outside the allowed set falls back rather than passing through', () => {
    const field = reader({ scope: 'consolidated' });
    expect(
      field.choice('scope', 'שייך ל', ['household', 'business'] as const, 'household'),
    ).toBe('household');
  });

  test('an identifier that is not one is refused', () => {
    const field = reader({ accountId: 'not-an-id' });
    expect(field.id('accountId', 'חשבון')).toBeNull();
    expect(field.ok).toBe(false);
  });

  test('a real identifier passes', () => {
    const id = '11111111-2222-4333-8444-555555555555';
    const field = reader({ accountId: id });
    expect(field.id('accountId', 'חשבון')).toBe(id);
    expect(field.ok).toBe(true);
  });

  test('an absent optional identifier is null and not an error', () => {
    const field = reader({ accountId: '' });
    expect(field.id('accountId', 'חשבון')).toBeNull();
    expect(field.ok).toBe(true);
  });
});

describe('percentages are kept as basis points', () => {
  test.each([
    ['18', 1_800],
    ['18%', 1_800],
    ['9.5', 950],
    ['0', 0],
  ])('%s becomes %i basis points', (typed, expected) => {
    expect(reader({ rate: typed }).percentBp('rate', 'ריבית')).toBe(expected);
  });
});

describe('form state', () => {
  test('an idle form says nothing', () => {
    expect(idleForm.status).toBe('idle');
    expect(idleForm.message).toBe('');
  });

  test('a success can name what it created', () => {
    expect(succeeded('נשמר', 'abc')).toMatchObject({ status: 'success', createdId: 'abc' });
  });
});

describe('a stored amount becomes editable text', () => {
  test.each([
    [125_050, '1250.50'],
    [125_000, '1250.00'],
    [5, '0.05'],
    [0, '0.00'],
    [-1, '-0.01'],
  ])('%i minor units edits as %s', (minor, expected) => {
    expect(toAmountInput(minor)).toBe(expected);
  });

  test('nothing is nothing, not zero', () => {
    expect(toAmountInput(null)).toBe('');
    expect(toAmountInput(undefined)).toBe('');
  });
});
