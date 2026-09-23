import { buildXlsx, extractDocument } from '@family-finance/document-import';
import { replayDebtBalances } from '@family-finance/finance-engine';
import { describe, expect, test } from 'vitest';

import { recordDebtEvent } from './commands';
import type { StoreDocument } from './document';
import { contextFor, seededHousehold } from './fixtures/household';
import {
  alreadyImported,
  approveBatch,
  checkApproval,
  reviewAll,
  stageExtraction,
} from './imports';

/**
 * A debt list crossing the approval boundary.
 *
 * The question this file answers is the one that matters for money: after a
 * family uploads a spreadsheet of what they owe and presses approve, are the
 * lenders, the debts and the balances exactly what the file said — and are they
 * derived from events rather than written down?
 *
 * The workbook is synthetic. No real lender, amount or file appears here.
 */

const IMPORTED_ON = '2026-09-22';

const debtSheet = buildXlsx([
  {
    name: 'חובות',
    rows: [
      ['מזהה', 'שדה1', 'שדה2', 'שדה3'],
      ['1', 'גמ״ח אור החיים', 12500, 'ז׳ טבת תשפ״ז'],
      ['2', 'קופת חסד בית יעקב', 3200, 'לתשלום ד׳ שבט תשפ״ז'],
      ['3', 'משפחת כהן', 8000, ''],
      ['4', 'הלוואה מדוד', 0, 'שולם'],
      ['5', 'סה״כ', 23700, ''],
    ],
  },
]);

function stageDebts(document: StoreDocument, sha = 'c'.repeat(64), bytes = debtSheet) {
  const extraction = extractDocument(bytes, {
    fileName: 'חובות.xlsx',
    currency: 'ILS',
    scope: 'household',
    importedOn: IMPORTED_ON,
  });

  return stageExtraction(
    document,
    {
      extraction,
      displayName: 'חובות.xlsx',
      storedId: crypto.randomUUID(),
      sha256: sha,
      byteSize: bytes.byteLength,
      declaredMimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      targetAccountId: null,
    },
    contextFor(document),
  );
}

/** Stages, includes every row, and approves. */
function importDebts(start: StoreDocument, sha?: string) {
  const staged = stageDebts(start, sha);
  const batchId = staged.value;
  const reviewed = reviewAll(
    staged.document,
    { batchId, reviewState: 'included', onlyPending: false },
    contextFor(staged.document),
  );
  const approved = approveBatch(reviewed.document, { batchId }, contextFor(reviewed.document));
  return { batchId, document: approved.document, outcome: approved.value };
}

describe('a debt list becomes lenders, debts and opening balances', () => {
  const start = seededHousehold().document;
  const { document, outcome, batchId } = importDebts(start);

  test('nothing is a debt until the batch is approved', () => {
    const staged = stageDebts(start);
    expect(staged.document.debts).toHaveLength(start.debts.length);
    expect(staged.document.debtEvents).toHaveLength(start.debtEvents.length);
  });

  test('every proposed row creates one lender', () => {
    expect(outcome.debtsCreated).toBe(3);
    const created = document.debts.filter(
      (debt) => !start.debts.some((existing) => existing.id === debt.id),
    );
    expect(created.map((debt) => debt.creditorName).sort()).toEqual(
      ['גמ״ח אור החיים', 'קופת חסד בית יעקב', 'משפחת כהן'].sort(),
    );
  });

  test('each new debt carries exactly one opening balance', () => {
    const created = document.debts.filter(
      (debt) => !start.debts.some((existing) => existing.id === debt.id),
    );
    for (const debt of created) {
      const openings = document.debtEvents.filter(
        (event) => event.debtId === debt.id && event.kind === 'opening_balance',
      );
      expect(openings).toHaveLength(1);
      expect(openings[0]?.occurredOn).toBe(IMPORTED_ON);
      expect(openings[0]?.importBatchId).toBe(batchId);
    }
  });

  test('the balance is what the file said, derived from the events', () => {
    const balances = replayDebtBalances(document.debtEvents, '2026-12-31');
    const gemach = document.debts.find((debt) => debt.creditorName === 'גמ״ח אור החיים');
    const kupa = document.debts.find((debt) => debt.creditorName === 'קופת חסד בית יעקב');
    const cohen = document.debts.find((debt) => debt.creditorName === 'משפחת כהן');
    expect(balances.get(gemach?.id ?? '')).toBe(1_250_000);
    expect(balances.get(kupa?.id ?? '')).toBe(320_000);
    expect(balances.get(cohen?.id ?? '')).toBe(800_000);
  });

  test('the due date is stored in both calendars, with the text it came from', () => {
    const gemach = document.debts.find((debt) => debt.creditorName === 'גמ״ח אור החיים');
    expect(gemach?.dueDate?.gregorian).toBe('2026-12-17');
    expect(gemach?.dueDate?.hebrew).toEqual({ day: 7, month: 10, year: 5787 });
    expect(gemach?.dueDate?.isHebrew).toBe(true);
    expect(gemach?.dueDate?.sourceText).toBe('ז׳ טבת תשפ״ז');
  });

  test('a note beside the date is kept on the debt', () => {
    const kupa = document.debts.find((debt) => debt.creditorName === 'קופת חסד בית יעקב');
    expect(kupa?.notes).toBe('לתשלום');
  });

  test('the zero balance and the total never became lenders', () => {
    const names = document.debts.map((debt) => debt.creditorName);
    expect(names).not.toContain('הלוואה מדוד');
    expect(names).not.toContain('סה״כ');
  });

  test('a payment reduces the balance, and the opening balance is untouched', () => {
    const cohen = document.debts.find((debt) => debt.creditorName === 'משפחת כהן');
    const paid = recordDebtEvent(
      document,
      {
        debtId: cohen?.id ?? '',
        kind: 'principal_payment',
        amountMinor: 300_000,
        occurredOn: '2026-10-01',
        correctionEffect: null,
      },
      contextFor(document),
    );
    const balances = replayDebtBalances(paid.document.debtEvents, '2026-12-31');
    expect(balances.get(cohen?.id ?? '')).toBe(500_000);
    // The history is added to, never rewritten.
    expect(
      paid.document.debtEvents.filter(
        (event) => event.debtId === cohen?.id && event.kind === 'opening_balance',
      ),
    ).toHaveLength(1);
  });

  test('a note on the ledger records the fact and moves no money', () => {
    const cohen = document.debts.find((debt) => debt.creditorName === 'משפחת כהן');
    const before = replayDebtBalances(document.debtEvents, '2026-12-31').get(cohen?.id ?? '');
    const noted = recordDebtEvent(
      document,
      {
        debtId: cohen?.id ?? '',
        kind: 'note',
        amountMinor: 0,
        occurredOn: '2026-10-02',
        correctionEffect: null,
        note: 'סיכמנו לדחות בחודש',
      },
      contextFor(document),
    );
    const after = replayDebtBalances(noted.document.debtEvents, '2026-12-31').get(
      cohen?.id ?? '',
    );
    expect(after).toBe(before);
    expect(
      noted.document.debtEvents.some(
        (event) => event.kind === 'note' && event.note === 'סיכמנו לדחות בחודש',
      ),
    ).toBe(true);
  });
});

describe('importing the same debts twice', () => {
  const start = seededHousehold().document;
  const first = importDebts(start);

  test('the same file is recognised as already imported', () => {
    expect(alreadyImported(first.document, 'c'.repeat(64))?.id).toBe(first.batchId);
  });

  test('a second upload of the same lenders will not approve on its own', () => {
    // Different bytes, same lenders: the file-level guard does not apply, so the
    // per-row guard has to. Every row names a lender that now exists.
    const staged = stageDebts(first.document, 'd'.repeat(64));
    const reviewed = reviewAll(
      staged.document,
      { batchId: staged.value, reviewState: 'included', onlyPending: false },
      contextFor(staged.document),
    );
    const check = checkApproval(reviewed.document, staged.value);
    expect(check.canApprove).toBe(false);
    expect(check.blocking.every((row) => row.reason === 'needs_lender_decision')).toBe(true);
    expect(check.blocking).toHaveLength(3);
  });

  test('approval is refused rather than silently doubling the balances', () => {
    const staged = stageDebts(first.document, 'e'.repeat(64));
    const reviewed = reviewAll(
      staged.document,
      { batchId: staged.value, reviewState: 'included', onlyPending: false },
      contextFor(staged.document),
    );
    expect(() =>
      approveBatch(reviewed.document, { batchId: staged.value }, contextFor(reviewed.document)),
    ).toThrow();

    // And the balances are exactly what the first import left.
    const balances = replayDebtBalances(first.document.debtEvents, '2026-12-31');
    const gemach = first.document.debts.find((debt) => debt.creditorName === 'גמ״ח אור החיים');
    expect(balances.get(gemach?.id ?? '')).toBe(1_250_000);
  });

  test('attaching a row to the existing lender adds principal instead of a second card', () => {
    const staged = stageDebts(first.document, 'f'.repeat(64));
    const gemach = first.document.debts.find((debt) => debt.creditorName === 'גמ״ח אור החיים');

    // The reviewer says: this row is the lender we already have.
    const attached: StoreDocument = {
      ...staged.document,
      importProposals: staged.document.importProposals.map((proposal) =>
        proposal.batchId === staged.value
          ? {
              ...proposal,
              reviewState:
                proposal.proposed.kind === 'debt' &&
                proposal.proposed.value.creditorName === 'גמ״ח אור החיים'
                  ? ('included' as const)
                  : ('excluded' as const),
              targetDebtId:
                proposal.proposed.kind === 'debt' &&
                proposal.proposed.value.creditorName === 'גמ״ח אור החיים'
                  ? (gemach?.id ?? null)
                  : null,
            }
          : proposal,
      ),
    };

    const approved = approveBatch(attached, { batchId: staged.value }, contextFor(attached));

    // No new lender, and the balance grew by the amount on the row.
    expect(approved.value.debtsCreated).toBe(0);
    const lenders = approved.document.debts.filter(
      (debt) => debt.creditorName === 'גמ״ח אור החיים',
    );
    expect(lenders).toHaveLength(1);
    const balances = replayDebtBalances(approved.document.debtEvents, '2026-12-31');
    expect(balances.get(gemach?.id ?? '')).toBe(2_500_000);
    expect(
      approved.document.debtEvents.filter(
        (event) => event.debtId === gemach?.id && event.kind === 'opening_balance',
      ),
    ).toHaveLength(1);
  });
});

describe('a debt whose due date could not be read', () => {
  const sheet = buildXlsx([
    {
      name: 'חובות',
      rows: [
        ['מזהה', 'שדה1', 'שדה2', 'שדה3'],
        ['1', 'משפחת לוי', 1000, 'בערך ז׳ טבת תשפ״ז'],
        ['2', 'משפחת מזרחי', 2000, 'ד׳ אדר תשפ״ז'],
      ],
    },
  ]);

  test('is imported with the reason, and with no date at all', () => {
    const start = seededHousehold().document;
    const staged = stageDebts(start, 'a'.repeat(64), sheet);
    const reviewed = reviewAll(
      staged.document,
      { batchId: staged.value, reviewState: 'included', onlyPending: false },
      contextFor(staged.document),
    );
    const approved = approveBatch(
      reviewed.document,
      { batchId: staged.value },
      contextFor(reviewed.document),
    );

    const levi = approved.document.debts.find((debt) => debt.creditorName === 'משפחת לוי');
    expect(levi?.dueDate?.gregorian).toBeNull();
    expect(levi?.dueDate?.reviewReason).toBe('uncertainty_marker');
    expect(levi?.dueDate?.sourceText).toBe('בערך ז׳ טבת תשפ״ז');

    const mizrahi = approved.document.debts.find((debt) => debt.creditorName === 'משפחת מזרחי');
    expect(mizrahi?.dueDate?.reviewReason).toBe('ambiguous_adar');

    // The money is still right: an unreadable date never blocked the balance.
    const balances = replayDebtBalances(approved.document.debtEvents, '2026-12-31');
    expect(balances.get(levi?.id ?? '')).toBe(100_000);
    expect(balances.get(mizrahi?.id ?? '')).toBe(200_000);
  });
});
