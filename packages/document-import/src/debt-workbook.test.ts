import { describe, expect, test } from 'vitest';

import { extractDocument } from './extract';
import { buildXlsx } from './fixtures/documents';

/**
 * The whole path for a debt sheet whose headers say nothing: bytes in,
 * reviewable debt proposals out.
 *
 * The workbook is synthetic. Invented lenders, invented amounts; no real name,
 * balance or file from the household is in this repository.
 */
const DEBT_SHEET = buildXlsx([
  {
    name: 'חובות',
    rows: [
      ['מזהה', 'שדה1', 'שדה2', 'שדה3'],
      ['1', 'גמ״ח אור החיים', 12500, 'ז׳ טבת תשפ״ז'],
      ['2', 'קופת חסד בית יעקב', 3200, 'לתשלום ד׳ שבט תשפ״ז'],
      ['3', 'משפחת כהן', 8000, ''],
      ['4', 'ספק ציוד משרדי', 450.5, '17/12/2026'],
      ['5', 'הלוואה מדוד', 0, 'שולם'],
      ['6', 'סה״כ', 24150.5, ''],
    ],
  },
]);

const options = {
  fileName: 'חובות.xlsx',
  currency: 'ILS',
  scope: 'household',
  importedOn: '2026-09-22',
} as const;

describe('a debt workbook with meaningless headers', () => {
  const result = extractDocument(DEBT_SHEET, options);

  test('is recognised as a debt list', () => {
    expect(result.documentType).toBe('private_debt_list');
    expect(result.documentTypeConfidenceBp).toBeGreaterThan(0);
  });

  test('produces a debt proposal for each real row', () => {
    const debts = result.proposals.filter((proposal) => proposal.kind === 'debt');
    // Six data rows: four debts, one zero balance, one total.
    expect(debts).toHaveLength(4);
    expect(result.proposals).toHaveLength(4);
  });

  test('reads the lender name and the exact balance', () => {
    const first = result.proposals[0];
    expect(first?.proposed.kind).toBe('debt');
    if (first?.proposed.kind !== 'debt') return;
    expect(first.proposed.value.creditorName).toBe('גמ״ח אור החיים');
    expect(first.proposed.value.balanceMinor).toBe(1_250_000);
    expect(first.proposed.value.currency).toBe('ILS');
  });

  test('dates the opening balance on the day of the import', () => {
    const first = result.proposals[0];
    if (first?.proposed.kind !== 'debt') return;
    expect(first.proposed.value.openedOn).toBe('2026-09-22');
  });

  test('carries the Hebrew due date in both calendars', () => {
    const first = result.proposals[0];
    if (first?.proposed.kind !== 'debt') return;
    const due = first.proposed.value.dueDate;
    expect(due?.gregorian).toBe('2026-12-17');
    expect(due?.hebrew).toEqual({ day: 7, month: 10, year: 5787 });
    expect(due?.isHebrew).toBe(true);
    expect(due?.sourceText).toBe('ז׳ טבת תשפ״ז');
    expect(due?.reviewReason).toBeNull();
  });

  test('keeps a note that sat beside the date', () => {
    const second = result.proposals[1];
    if (second?.proposed.kind !== 'debt') return;
    expect(second.proposed.value.note).toBe('לתשלום');
    expect(second.proposed.value.dueDate?.gregorian).toBe('2027-01-12');
  });

  test('a Gregorian due date is carried in both calendars too', () => {
    const fourth = result.proposals[3];
    if (fourth?.proposed.kind !== 'debt') return;
    expect(fourth.proposed.value.dueDate?.gregorian).toBe('2026-12-17');
    expect(fourth.proposed.value.dueDate?.isHebrew).toBe(false);
  });

  test('a row with no due date carries none, and no reason either', () => {
    const third = result.proposals[2];
    if (third?.proposed.kind !== 'debt') return;
    expect(third.proposed.value.dueDate?.gregorian).toBeNull();
    expect(third.proposed.value.dueDate?.reviewReason).toBeNull();
  });

  test('the zero balance and the total are not proposed', () => {
    const names = result.proposals.flatMap((proposal) =>
      proposal.proposed.kind === 'debt' ? [proposal.proposed.value.creditorName] : [],
    );
    expect(names).not.toContain('הלוואה מדוד');
    expect(names).not.toContain('סה״כ');
    expect(result.summary.rowsSkipped).toBeGreaterThanOrEqual(2);
  });

  test('every proposal can be traced back to its row in the sheet', () => {
    for (const proposal of result.proposals) {
      expect(proposal.location.sheetName).toBe('חובות');
      expect(proposal.location.row).toBeGreaterThan(1);
      expect(proposal.raw.length).toBeGreaterThan(0);
    }
  });

  test('the raw cells are kept verbatim beside the reading', () => {
    const first = result.proposals[0];
    const texts = (first?.raw ?? []).map((cell) => cell.text);
    expect(texts).toContain('גמ״ח אור החיים');
    expect(texts).toContain('ז׳ טבת תשפ״ז');
  });

  test('the reviewer is told the mapping was inferred', () => {
    expect(result.warnings).toContain('ambiguous_column_mapping');
  });

  test('reading the same bytes twice reads the same thing', () => {
    const again = extractDocument(DEBT_SHEET, options);
    expect(again.proposals).toStrictEqual(result.proposals);
  });
});

describe('a debt workbook whose dates cannot be trusted', () => {
  const sheet = buildXlsx([
    {
      name: 'חובות',
      rows: [
        ['מזהה', 'שדה1', 'שדה2', 'שדה3'],
        ['1', 'משפחת לוי', 1000, 'בערך ז׳ טבת תשפ״ז'],
        ['2', 'משפחת מזרחי', 2000, 'ד׳ אדר תשפ״ז'],
        ['3', 'משפחת פרץ', 3000, 'ל׳ כסלו תשפ״ד'],
      ],
    },
  ]);

  const result = extractDocument(sheet, options);

  test('the debts are still proposed — the amount is certain', () => {
    expect(result.proposals).toHaveLength(3);
    const balances = result.proposals.flatMap((proposal) =>
      proposal.proposed.kind === 'debt' ? [proposal.proposed.value.balanceMinor] : [],
    );
    expect(balances).toEqual([100_000, 200_000, 300_000]);
  });

  test('a hedged date is recorded as a reason, never as a date', () => {
    const first = result.proposals[0];
    if (first?.proposed.kind !== 'debt') return;
    expect(first.proposed.value.dueDate?.gregorian).toBeNull();
    expect(first.proposed.value.dueDate?.reviewReason).toBe('uncertainty_marker');
    expect(first.proposed.value.dueDate?.sourceText).toBe('בערך ז׳ טבת תשפ״ז');
  });

  test('an unspecified Adar in a leap year asks rather than picks', () => {
    const second = result.proposals[1];
    if (second?.proposed.kind !== 'debt') return;
    expect(second.proposed.value.dueDate?.reviewReason).toBe('ambiguous_adar');
  });

  test('a day the month does not have that year is refused', () => {
    const third = result.proposals[2];
    if (third?.proposed.kind !== 'debt') return;
    expect(third.proposed.value.dueDate?.reviewReason).toBe('day_not_in_month');
  });

  test('the batch is flagged so the review screen shows the dates', () => {
    expect(result.warnings).toContain('ambiguous_date');
  });
});

describe('a word in a data cell does not decide the document type', () => {
  /*
   * A lender called "הלוואה מדוד" puts the word "הלוואה" into a data cell, and
   * that single word scores the file as a loan schedule — above the recognition
   * threshold, from one cell, with nothing else supporting it. The file then
   * yields no rows at all. The shape of every row has to outweigh it.
   */
  const sheet = buildXlsx([
    {
      name: 'חובות',
      rows: [
        ['מזהה', 'שדה1', 'שדה2', 'שדה3'],
        ['1', 'גמ״ח אור החיים', 12500, 'ז׳ טבת תשפ״ז'],
        ['2', 'קופת חסד בית יעקב', 3200, ''],
        ['3', 'הלוואה מדוד', 8000, ''],
      ],
    },
  ]);

  test('the file is still read as a debt list', () => {
    const result = extractDocument(sheet, options);
    expect(result.documentType).toBe('private_debt_list');
  });

  test('and every lender is proposed, including the one named for a loan', () => {
    const result = extractDocument(sheet, options);
    const names = result.proposals.flatMap((proposal) =>
      proposal.proposed.kind === 'debt' ? [proposal.proposed.value.creditorName] : [],
    );
    expect(names).toEqual(['גמ״ח אור החיים', 'קופת חסד בית יעקב', 'הלוואה מדוד']);
  });
});

describe('documents that are not debt lists keep the reading they had', () => {
  test('a sheet whose headers name its columns is not re-read as debts', () => {
    const expenses = buildXlsx([
      {
        name: 'הוצאות',
        rows: [
          ['תאריך', 'תיאור', 'סכום'],
          ['2026-09-01', 'סופרמרקט', 250],
          ['2026-09-02', 'דלק', 300],
          ['2026-09-03', 'חשמל', 410],
        ],
      },
    ]);
    const result = extractDocument(expenses, { ...options, fileName: 'הוצאות.xlsx' });
    expect(result.documentType).not.toBe('private_debt_list');
    expect(result.proposals.every((proposal) => proposal.kind !== 'debt')).toBe(true);
  });
});
