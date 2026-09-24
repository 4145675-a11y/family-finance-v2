import { describe, expect, test } from 'vitest';

import { splitUpdates } from './split';

/**
 * One sentence, or several — and the cost of getting it wrong in each direction.
 *
 * Splitting a sentence that was one thing creates a second record for money that
 * was spent once. Failing to split one that was two loses a record, which a person
 * notices and can redo. The module is deliberately biased towards the second, and
 * the tests below are mostly about the first.
 *
 * Two of them are regressions with real consequences. A comma inside "3,000" is a
 * thousands separator, and treating it as a cut read three thousand shekels as
 * three — silently, with a plausible-looking proposal on the screen. A date is not
 * a sum, and treating "10/10/2026" as one cut the repayment day off the sentence
 * it belonged to.
 */

describe('one sentence stays one sentence', () => {
  test('a plain expense', () => {
    expect(splitUpdates('שילמתי 120 שקל בסופר')).toEqual(['שילמתי 120 שקל בסופר']);
  });

  test('a list of things bought once', () => {
    // One sum, so one purchase, whatever the word "ו" is doing in it.
    expect(splitUpdates('קניתי לחם וחלב ב-30 שקל')).toHaveLength(1);
  });

  test('a grouped number keeps its comma', () => {
    const sentence = 'שילמתי 1,200 שקל בסופר';
    expect(splitUpdates(sentence)).toEqual([sentence]);
  });

  test('a grouped number in the millions too', () => {
    expect(splitUpdates('קיבלתי 1,200,000 שקל')).toHaveLength(1);
  });

  test('a repayment day is not a second update', () => {
    const sentence = 'קיבלתי עוד 3,000 ₪ מגמח לבדיקה, לפירעון ב־10/10/2026';
    expect(splitUpdates(sentence)).toEqual([sentence]);
  });

  test('a clause that names no sum of its own is not a second update', () => {
    const sentence = 'שילמתי 120 שקל בסופר, ליד הבית';
    expect(splitUpdates(sentence)).toEqual([sentence]);
  });

  test('the same sum described twice is one payment', () => {
    expect(splitUpdates('שילמתי 120, בסופר 120')).toHaveLength(1);
  });

  test('and nothing at all is nothing', () => {
    expect(splitUpdates('   ')).toEqual([]);
  });
});

describe('two updates in one breath become two', () => {
  test('joined by the word for and', () => {
    expect(splitUpdates('שילמתי 120 בסופר ו-50 בדלק')).toEqual(['שילמתי 120 בסופר', '50 בדלק']);
  });

  test('joined by a comma, where each side carries its own sum', () => {
    expect(splitUpdates('שילמתי 120 בסופר, 50 בדלק')).toHaveLength(2);
  });

  test('joined by a semicolon', () => {
    expect(splitUpdates('שילמתי 120 בסופר; 50 בדלק')).toHaveLength(2);
  });

  test('each of them with its own grouped number', () => {
    expect(splitUpdates('שילמתי 1,200 בסופר ו-2,500 בדלק')).toEqual([
      'שילמתי 1,200 בסופר',
      '2,500 בדלק',
    ]);
  });

  test('and both keep their own date', () => {
    const parts = splitUpdates('שילמתי 120 בסופר ב-3/9 ו-50 בדלק ב-4/9');
    expect(parts).toHaveLength(2);
    expect(parts[0]).toContain('3/9');
    expect(parts[1]).toContain('4/9');
  });
});

describe('the same sentence always splits the same way', () => {
  test('splitting is deterministic', () => {
    const sentence = 'שילמתי 1,200 בסופר ו-50 בדלק, לפירעון ב־10/10/2026';
    expect(splitUpdates(sentence)).toEqual(splitUpdates(sentence));
  });
});
