import { describe, expect, test } from 'vitest';

import { detectDebtTable, readDebtRow, readDebtTable } from './debt-table';
import { detectDocumentType } from './detect';

/**
 * A synthetic debt sheet in the shape the real file arrives in.
 *
 * Invented lenders and invented amounts. No real name, balance or file from the
 * household appears in this repository, here or anywhere else.
 */
const HEADER = ['מזהה', 'שדה1', 'שדה2', 'שדה3'];

const ROWS: readonly (readonly string[])[] = [
  ['1', 'גמ״ח אור החיים', '12,500.00', 'ז׳ טבת תשפ״ז'],
  ['2', 'קופת חסד בית יעקב', '3,200', 'לתשלום ד׳ שבט תשפ״ז'],
  ['3', 'משפחת כהן', '8,000', ''],
  ['4', 'ספק ציוד משרדי', '450.50', '17/12/2026'],
  ['5', 'הלוואה מדוד', '0', 'שולם'],
];

describe('detectDebtTable', () => {
  test('a table of names beside amounts is recognised as debts', () => {
    const detection = detectDebtTable(ROWS, HEADER);
    expect(detection.detected).toBe(true);
    expect(detection.mapping).toEqual({
      sourceRowIdIndex: 0,
      lenderNameIndex: 1,
      balanceIndex: 2,
      dueDateOrNoteIndex: 3,
    });
  });

  test('the generic headers raise confidence but are not what decides it', () => {
    const withHeaders = detectDebtTable(ROWS, HEADER);
    const withoutHeaders = detectDebtTable(ROWS, []);
    expect(withoutHeaders.detected).toBe(true);
    expect(withoutHeaders.mapping).toEqual(withHeaders.mapping);
    expect(withHeaders.confidenceBp).toBeGreaterThan(withoutHeaders.confidenceBp);
  });

  test('the evidence names the columns it read', () => {
    const detection = detectDebtTable(ROWS, HEADER);
    expect(detection.evidence).toContain('placeholder-headers:3');
    expect(detection.evidence.some((item) => item.startsWith('names-column:1'))).toBe(true);
    expect(detection.evidence.some((item) => item.startsWith('amounts-column:2'))).toBe(true);
  });

  test('a table of only numbers is not a debt list', () => {
    const numeric = [
      ['1', '10', '20', '30'],
      ['2', '11', '21', '31'],
      ['3', '12', '22', '32'],
    ];
    expect(detectDebtTable(numeric, HEADER).detected).toBe(false);
  });

  test('a table of only text is not a debt list either', () => {
    const textual = [
      ['1', 'אלף', 'בית', 'גימל'],
      ['2', 'דלת', 'הא', 'וו'],
      ['3', 'זין', 'חית', 'טית'],
    ];
    expect(detectDebtTable(textual, HEADER).detected).toBe(false);
  });

  test('one row is not a shape', () => {
    expect(detectDebtTable([ROWS[0] ?? []], HEADER).detected).toBe(false);
  });

  test('a two-column file with no due-date column is still a debt list', () => {
    const narrow = [
      ['גמ״ח אור החיים', '12,500.00'],
      ['משפחת כהן', '8,000'],
      ['ספק ציוד', '450.50'],
    ];
    const detection = detectDebtTable(narrow, []);
    expect(detection.detected).toBe(true);
    expect(detection.mapping).toEqual({
      sourceRowIdIndex: null,
      lenderNameIndex: 0,
      balanceIndex: 1,
      dueDateOrNoteIndex: null,
    });
  });
});

describe('the document type a generic-header debt file is given', () => {
  test('a file whose headers say nothing is still recognised as debts', () => {
    const result = detectDocumentType({
      context: ['debts.xlsx'],
      shape: null,
      dataRows: ROWS,
      headerRow: HEADER,
    });
    expect(result.type).toBe('private_debt_list');
    expect(result.confidenceBp).toBeGreaterThan(0);
  });

  test('without the values it is unrecognised, exactly as before', () => {
    // The behaviour that existed before this feature, unchanged.
    const result = detectDocumentType({ context: ['debts.xlsx'], shape: null });
    expect(result.type).toBe('unrecognised');
  });

  test('a file the words already identify keeps the type the words gave it', () => {
    // Values that look like a debt table must not override a document the
    // phrases recognised: a bank statement stays a bank statement.
    const result = detectDocumentType({
      context: ['תנועות בחשבון', 'פירוט תנועות', 'יתרה בחשבון', 'מספר חשבון'],
      shape: null,
      dataRows: ROWS,
      headerRow: HEADER,
    });
    expect(result.type).toBe('bank_statement');
  });

  test('a table of numbers with meaningless headers stays unrecognised', () => {
    const result = detectDocumentType({
      context: ['file.xlsx'],
      shape: null,
      dataRows: [
        ['1', '10', '20', '30'],
        ['2', '11', '21', '31'],
      ],
      headerRow: HEADER,
    });
    expect(result.type).toBe('unrecognised');
  });
});

describe('readDebtTable', () => {
  const mapping = {
    sourceRowIdIndex: 0,
    lenderNameIndex: 1,
    balanceIndex: 2,
    dueDateOrNoteIndex: 3,
  } as const;

  const readings = readDebtTable(ROWS, mapping, HEADER);

  test('the amount is read into exact minor units', () => {
    const first = readings[0];
    expect(first?.outcome).toBe('debt');
    if (first?.outcome !== 'debt') return;
    expect(first.lenderName).toBe('גמ״ח אור החיים');
    expect(first.balanceMinor).toBe(1_250_000);
    expect(first.sourceRowId).toBe('1');
  });

  test('a Hebrew due date is resolved into both calendars', () => {
    const first = readings[0];
    if (first?.outcome !== 'debt') throw new Error('expected a debt row');
    expect(first.due?.outcome).toBe('resolved');
    if (first.due?.outcome !== 'resolved') return;
    expect(first.due.source).toBe('hebrew');
    expect(first.due.gregorian).toBe('2026-12-17');
    expect(first.due.hebrew).toEqual({ day: 7, month: 10, year: 5787 });
    expect(first.due.originalText).toBe('ז׳ טבת תשפ״ז');
  });

  test('a note beside the date is kept apart from it', () => {
    const second = readings[1];
    if (second?.outcome !== 'debt') throw new Error('expected a debt row');
    expect(second.due?.outcome).toBe('resolved');
    expect(second.note).toBe('לתשלום');
    if (second.due?.outcome !== 'resolved') return;
    expect(second.due.gregorian).toBe('2027-01-12');
  });

  test('a blank due-date cell is simply no due date', () => {
    const third = readings[2];
    if (third?.outcome !== 'debt') throw new Error('expected a debt row');
    expect(third.due).toBeNull();
    expect(third.note).toBeNull();
  });

  test('a Gregorian due date is resolved into both calendars too', () => {
    const fourth = readings[3];
    if (fourth?.outcome !== 'debt') throw new Error('expected a debt row');
    expect(fourth.due?.outcome).toBe('resolved');
    if (fourth.due?.outcome !== 'resolved') return;
    expect(fourth.due.source).toBe('gregorian');
    expect(fourth.due.hebrew).toEqual({ day: 7, month: 10, year: 5787 });
  });

  test('a zero balance is excluded, with the reason recorded', () => {
    const fifth = readings[4];
    expect(fifth?.outcome).toBe('excluded');
    if (fifth?.outcome !== 'excluded') return;
    expect(fifth.reason).toBe('zero_balance');
    // The row is still shown on the review screen, so nothing disappears silently.
    expect(fifth.lenderName).toBe('הלוואה מדוד');
    expect(fifth.rawAmount).toBe('0');
  });

  test('four of the five rows become debts', () => {
    expect(readings.filter((row) => row.outcome === 'debt')).toHaveLength(4);
    expect(readings.filter((row) => row.outcome === 'excluded')).toHaveLength(1);
  });

  test('the rows keep the order of the file', () => {
    expect(readings.map((row) => row.rowIndex)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('rows that are not debts', () => {
  const mapping = {
    sourceRowIdIndex: 0,
    lenderNameIndex: 1,
    balanceIndex: 2,
    dueDateOrNoteIndex: 3,
  } as const;

  test.each([
    [['', '', '', ''], 'blank_row'],
    [['6', '', '1,000', ''], 'missing_lender_name'],
    [['7', 'משפחת לוי', 'לא ידוע', ''], 'unparsed_amount'],
    [['8', 'משפחת לוי', '0.00', ''], 'zero_balance'],
    [['9', 'משפחת לוי', '-500', ''], 'negative_balance'],
    [['10', 'סה״כ', '20,000', ''], 'totals_row'],
  ])('%j is excluded as %s', (row, reason) => {
    const reading = readDebtRow(row as readonly string[], 0, mapping, HEADER);
    expect(reading.outcome).toBe('excluded');
    if (reading.outcome !== 'excluded') return;
    expect(reading.reason).toBe(reason);
  });

  test('a repeated header row is excluded', () => {
    const reading = readDebtRow(HEADER, 0, mapping, HEADER);
    expect(reading).toMatchObject({ outcome: 'excluded', reason: 'repeated_header' });
  });

  test('a hedged due date does not stop the debt from being imported', () => {
    // The balance is certain even when the date is not: the debt is proposed and
    // only the date is sent to review.
    const reading = readDebtRow(
      ['11', 'משפחת לוי', '1,000', 'בערך ז׳ טבת תשפ״ז'],
      0,
      mapping,
      HEADER,
    );
    expect(reading.outcome).toBe('debt');
    if (reading.outcome !== 'debt') return;
    expect(reading.balanceMinor).toBe(100_000);
    expect(reading.due).toMatchObject({
      outcome: 'needs_review',
      reason: 'uncertainty_marker',
    });
  });

  test('a note with no date leaves the debt with no due date', () => {
    const reading = readDebtRow(
      ['12', 'משפחת לוי', '1,000', 'לשלם כשאפשר'],
      0,
      mapping,
      HEADER,
    );
    expect(reading.outcome).toBe('debt');
    if (reading.outcome !== 'debt') return;
    expect(reading.due?.outcome).toBe('no_date');
    expect(reading.note).toBe('לשלם כשאפשר');
  });
});
