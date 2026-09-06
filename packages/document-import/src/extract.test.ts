import { describe, expect, test } from 'vitest';

import { assessDuplicate, sourceFingerprint, type ExistingRecord } from './duplicates';
import { extractDocument } from './extract';
import {
  bankStatementPdf,
  buildCsv,
  buildXlsx,
  dateSerial,
  householdExpensesXlsx,
  scannedPdf,
} from './fixtures/documents';
import { MalformedDocumentError } from './limits';

/**
 * The whole pipeline, from bytes to proposals.
 *
 * What these assert, above everything else: a proposal knows where it came from,
 * carries the text the document used, and states what might be wrong with it.
 * Those three are what make the review screen a real review rather than a
 * confirmation dialog.
 */

const options = { fileName: 'statement.csv', currency: 'ILS', scope: 'household' } as const;

describe('a bank statement in CSV', () => {
  const bytes = buildCsv({
    delimiter: ';',
    preamble: ['בנק לדוגמה - תנועות בחשבון', 'מספר חשבון 12-345678'],
    header: ['תאריך', 'תיאור', 'חובה', 'זכות', 'יתרה'],
    rows: [
      ['03/09/2026', 'סופרמרקט', '412.30', '', '8,120.40'],
      ['05/09/2026', 'משכורת', '', '12,400.00', '20,520.40'],
      ['07/09/2026', 'חשמל', '318.00', '', '20,202.40'],
      ['', '', '', '', ''],
      ['סה"כ', '', '730.30', '12,400.00', ''],
    ],
  });

  const result = extractDocument(bytes, options);

  test('it is recognised as a bank statement', () => {
    expect(result.documentType).toBe('bank_statement');
    expect(result.documentTypeConfidenceBp).toBeGreaterThan(3_500);
  });

  test('the movements become proposals and the totals row does not', () => {
    expect(result.proposals).toHaveLength(3);
    expect(result.summary.rowsSkipped).toBeGreaterThanOrEqual(1);
  });

  test('debit and credit become directions, not signs', () => {
    const values = result.proposals.map((proposal) =>
      proposal.proposed.kind === 'transaction' ? proposal.proposed.value : null,
    );
    expect(values[0]).toMatchObject({
      transactionDate: '2026-09-03',
      description: 'סופרמרקט',
      amountMinor: 41_230,
      direction: 'outflow',
    });
    expect(values[1]).toMatchObject({
      transactionDate: '2026-09-05',
      amountMinor: 1_240_000,
      direction: 'inflow',
    });
  });

  test('every amount is a non-negative integer', () => {
    for (const proposal of result.proposals) {
      if (proposal.proposed.kind !== 'transaction') continue;
      expect(Number.isInteger(proposal.proposed.value.amountMinor)).toBe(true);
      expect(proposal.proposed.value.amountMinor).toBeGreaterThanOrEqual(0);
    }
  });

  test('each proposal names the row it came from and quotes the source', () => {
    const first = result.proposals[0]!;
    expect(first.location.row).toBe(4);
    expect(first.location.snippet).toContain('סופרמרקט');
    expect(first.raw.map((cell) => cell.column)).toContain('תאריך');
    expect(first.raw.find((cell) => cell.column === 'חובה')?.text).toBe('412.30');
  });

  test('the account number in the title block is picked up as a hint', () => {
    expect(result.summary.accountHints.length).toBeGreaterThan(0);
  });

  test('the date range is reported', () => {
    expect(result.summary.dateRangeStart).toBe('2026-09-03');
    expect(result.summary.dateRangeEnd).toBe('2026-09-07');
  });
});

describe('a running balance that does not add up is reported', () => {
  const bytes = buildCsv({
    header: ['תאריך', 'תיאור', 'חובה', 'זכות', 'יתרה'],
    rows: [
      ['03/09/2026', 'ראשון', '100.00', '', '900.00'],
      ['04/09/2026', 'שני', '100.00', '', '700.00'],
    ],
  });

  test('the second row carries the warning, not a corrected amount', () => {
    const result = extractDocument(bytes, options);
    const second = result.proposals[1]!;
    expect(second.warnings).toContain('balance_does_not_follow');
    // The amount is still exactly what the document said.
    expect(second.proposed.kind === 'transaction' && second.proposed.value.amountMinor).toBe(
      10_000,
    );
  });
});

describe('a household expense workbook', () => {
  const result = extractDocument(householdExpensesXlsx(), {
    ...options,
    fileName: 'הוצאות.xlsx',
  });

  test('the title block is skipped and the rows are read', () => {
    expect(result.fileKind).toBe('xlsx');
    expect(result.proposals).toHaveLength(3);
    expect(result.summary.sheetNames).toEqual(['הוצאות']);
  });

  test('a spreadsheet date is taken from the cell, not re-parsed from text', () => {
    const first = result.proposals[0]!;
    expect(first.proposed.kind === 'transaction' && first.proposed.value.transactionDate).toBe(
      '2026-09-02',
    );
  });

  test('an unsigned single amount column says its direction was assumed', () => {
    expect(result.proposals[0]!.warnings).toContain('ambiguous_direction');
  });

  test('the table report says which sheet needs a person to map it', () => {
    expect(result.tables).toHaveLength(1);
    expect(result.tables[0]!.headerRow).toBe(2);
    expect(result.tables[0]!.columns.map((column) => column.role)).toContain('amount');
  });
});

describe('a PDF statement', () => {
  test('rows are proposed with the page they came from', () => {
    const result = extractDocument(bankStatementPdf(), {
      ...options,
      fileName: 'statement.pdf',
    });
    expect(result.fileKind).toBe('pdf');
    expect(result.proposals.length).toBeGreaterThan(0);
    expect(result.proposals[0]!.location.page).toBe(1);
    // The reader never claims it understood the visual layout.
    expect(result.warnings).toContain('page_text_unreliable');
  });

  test('a scanned document fails honestly rather than producing nothing quietly', () => {
    expect(() => extractDocument(scannedPdf(), { ...options, fileName: 'scan.pdf' })).toThrow(
      MalformedDocumentError,
    );
  });
});

describe('a file we cannot make sense of', () => {
  test('a table with no recognisable header is reported, not guessed at', () => {
    const bytes = buildXlsx([
      {
        name: 'גיליון1',
        rows: [
          ['אאא', 'בבב'],
          [1, 2],
          [3, 4],
        ],
      },
    ]);
    const result = extractDocument(bytes, { ...options, fileName: 'unknown.xlsx' });
    expect(result.proposals).toHaveLength(0);
    expect(result.tables[0]!.needsManualMapping).toBe(true);
    expect(result.documentType).toBe('unrecognised');
  });

  test('a workbook of dates and amounts with no header names is still not invented', () => {
    const bytes = buildXlsx([
      {
        name: 'S',
        rows: [
          [dateSerial('2026-01-01'), 10],
          [dateSerial('2026-01-02'), 20],
        ],
      },
    ]);
    const result = extractDocument(bytes, { ...options, fileName: 'x.xlsx' });
    expect(result.proposals).toHaveLength(0);
  });
});

describe('reimporting the same file', () => {
  const bytes = buildCsv({
    header: ['תאריך', 'תיאור', 'סכום'],
    rows: [['03/09/2026', 'מכולת', '-240.50']],
  });

  test('the same row of the same file is recognised with certainty', () => {
    const first = extractDocument(bytes, options);
    const second = extractDocument(bytes, options);

    const fingerprintOf = (proposal: (typeof first.proposals)[number]) =>
      sourceFingerprint('a'.repeat(64), proposal.location);

    const existing: ExistingRecord[] = first.proposals.map((proposal, index) => ({
      id: `record-${index}`,
      accountId: 'account-1',
      date:
        proposal.proposed.kind === 'transaction' ? proposal.proposed.value.transactionDate : '',
      amountMinor:
        proposal.proposed.kind === 'transaction' ? proposal.proposed.value.amountMinor : 0,
      direction:
        proposal.proposed.kind === 'transaction'
          ? proposal.proposed.value.direction
          : 'outflow',
      description:
        proposal.proposed.kind === 'transaction' ? proposal.proposed.value.description : '',
      reference: null,
      sourceFingerprint: fingerprintOf(proposal),
    }));

    const candidate = second.proposals[0]!;
    const assessment = assessDuplicate(
      {
        accountId: 'account-1',
        date:
          candidate.proposed.kind === 'transaction'
            ? candidate.proposed.value.transactionDate
            : '',
        amountMinor:
          candidate.proposed.kind === 'transaction' ? candidate.proposed.value.amountMinor : 0,
        direction:
          candidate.proposed.kind === 'transaction'
            ? candidate.proposed.value.direction
            : 'outflow',
        description:
          candidate.proposed.kind === 'transaction' ? candidate.proposed.value.description : '',
        reference: null,
        sourceFingerprint: fingerprintOf(candidate),
      },
      existing,
    );

    expect(assessment).toMatchObject({
      verdict: 'likely_duplicate',
      reason: 'same_file_same_row',
    });
  });
});

describe('duplicate judgement never decides on its own', () => {
  const existing: ExistingRecord[] = [
    {
      id: 'tx-1',
      accountId: 'account-1',
      date: '2026-09-03',
      amountMinor: 41_230,
      direction: 'outflow',
      description: 'סופרמרקט רמי לוי',
      reference: 'REF-9001',
      sourceFingerprint: null,
    },
  ];

  const base = {
    accountId: 'account-1',
    date: '2026-09-03',
    amountMinor: 41_230,
    direction: 'outflow' as const,
    description: 'סופרמרקט רמי לוי',
    reference: null,
    sourceFingerprint: null,
  };

  test('same account, date, amount and wording is likely', () => {
    expect(assessDuplicate(base, existing).verdict).toBe('likely_duplicate');
  });

  test('the same amount on the same day with different wording is only possible', () => {
    expect(assessDuplicate({ ...base, description: 'תחנת דלק' }, existing).verdict).toBe(
      'possible_duplicate',
    );
  });

  test('a card posting two days later is raised without being claimed', () => {
    expect(assessDuplicate({ ...base, date: '2026-09-05' }, existing).verdict).toBe(
      'possible_duplicate',
    );
  });

  test('a different amount is a new record', () => {
    expect(assessDuplicate({ ...base, amountMinor: 41_231 }, existing).verdict).toBe('new');
  });

  test("a bank's own reference identifies a movement", () => {
    expect(
      assessDuplicate({ ...base, date: '2026-08-01', reference: 'REF-9001' }, existing),
    ).toMatchObject({ verdict: 'likely_duplicate', reason: 'same_reference' });
  });

  test('two identical purchases on different days are both real', () => {
    expect(assessDuplicate({ ...base, date: '2026-09-20' }, existing).verdict).toBe('new');
  });
});

describe('a signed value in a column named for charges', () => {
  const bytes = buildCsv({
    header: ['תאריך', 'תיאור', 'סכום חיוב'],
    rows: [
      ['02/09/2026', 'מכולת', '318.40'],
      ['05/09/2026', 'זיכוי', '-150.00'],
    ],
  });

  const result = extractDocument(bytes, options);

  test('the positive row goes out', () => {
    expect(result.proposals[0]?.proposed).toMatchObject({
      kind: 'transaction',
      value: { amountMinor: 31_840, direction: 'outflow' },
    });
  });

  test('the minus is believed over the column name', () => {
    // A file that writes a minus inside a charge column is telling us the column
    // is really a signed amount. Forcing every row outward would turn a refund
    // into a purchase.
    expect(result.proposals[1]?.proposed).toMatchObject({
      kind: 'transaction',
      value: { amountMinor: 15_000, direction: 'inflow' },
    });
  });

  test('and it says the reading was not obvious', () => {
    expect(result.proposals[1]?.warnings).toContain('ambiguous_direction');
    expect(result.proposals[0]?.warnings).not.toContain('ambiguous_direction');
  });
});

describe('a PDF row with an empty cell', () => {
  /*
   * The failure this exists to prevent, found by uploading a statement and
   * reading the screen: a PDF draws nothing for an empty cell, so on a salary row
   * — where the debit column is empty — every figure after it shifted one column
   * left, the credit landed under "חובה", and an income of 12,400 was recorded as
   * an expense of 12,400. The direction was inverted silently and every total
   * after it was wrong by twice the amount.
   */
  const result = extractDocument(bankStatementPdf(), {
    ...options,
    fileName: 'statement.pdf',
  });

  const valueOf = (description: string) => {
    const found = result.proposals.find(
      (proposal) =>
        proposal.proposed.kind === 'transaction' &&
        proposal.proposed.value.description.includes(description),
    );
    return found?.proposed.kind === 'transaction' ? found.proposed.value : null;
  };

  test('the three movements are read', () => {
    expect(result.proposals).toHaveLength(3);
  });

  test('a row with money in the debit column goes out', () => {
    expect(valueOf('סופרמרקט')).toMatchObject({ amountMinor: 41_230, direction: 'outflow' });
  });

  test('a row whose debit cell is empty comes in', () => {
    expect(valueOf('משכורת')).toMatchObject({ amountMinor: 1_240_000, direction: 'inflow' });
  });

  test('the row after the empty cell is still read correctly', () => {
    expect(valueOf('חשמל')).toMatchObject({ amountMinor: 31_800, direction: 'outflow' });
  });

  test('the running balance is read from the balance column, not the credit column', () => {
    expect(valueOf('סופרמרקט')?.balanceAfterMinor).toBe(812_040);
    expect(valueOf('משכורת')?.balanceAfterMinor).toBe(2_052_040);
  });
});
