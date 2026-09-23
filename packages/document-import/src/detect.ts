import type { DocumentType } from '@family-finance/contracts';

import { detectDebtTable } from './debt-table';
import { normaliseHeader, type TableShape } from './table';

/**
 * Guessing what kind of financial document this is.
 *
 * The guess steers the review screen — which fields it shows first, which
 * proposals it offers — and it does nothing else. It never changes a number, never
 * skips a confirmation, and a wrong guess costs the reviewer one dropdown.
 *
 * That constraint is what lets the detector be simple. It reads the words above
 * the table and the shape of the columns, scores each document type, and reports
 * its confidence honestly. Below a threshold it says `unrecognised`, which is a
 * real answer that opens the generic mapping screen rather than a failure.
 *
 * Adding a bank-specific detector means adding a `TypeSignature` here. Nothing
 * downstream changes, which is the whole point of keeping recognition apart from
 * the approval pipeline.
 */

export interface DetectionResult {
  readonly type: DocumentType;
  readonly confidenceBp: number;
  /** The phrases that led to the guess, for the reviewer's summary. */
  readonly evidence: readonly string[];
}

interface TypeSignature {
  readonly type: DocumentType;
  /** Phrases in the text above or around the table. */
  readonly phrases: readonly string[];
  /** Column roles whose presence supports this type. */
  readonly roles?: readonly string[];
  readonly weight: number;
}

const SIGNATURES: readonly TypeSignature[] = [
  {
    type: 'credit_card_statement',
    phrases: [
      'פירוט חיובים',
      'כרטיס אשראי',
      'עסקאות בכרטיס',
      'סכום החיוב',
      'ישראכרט',
      'מאסטרקארד',
      'ויזה',
      'דיינרס',
      'credit card',
      'card statement',
      'תשלומים',
      'מועד החיוב',
    ],
    roles: ['card', 'installment'],
    weight: 3,
  },
  {
    type: 'bank_statement',
    phrases: [
      'תנועות בחשבון',
      'עובר ושב',
      'פירוט תנועות',
      'יתרה בחשבון',
      'מספר חשבון',
      'סניף',
      'bank statement',
      'account statement',
      'זכות',
      'חובה',
    ],
    roles: ['balance', 'debit', 'credit'],
    weight: 3,
  },
  {
    type: 'mortgage_schedule',
    phrases: ['משכנתה', 'משכנתא', 'לוח סילוקין', 'mortgage', 'קרן וריבית'],
    weight: 4,
  },
  {
    type: 'loan_schedule',
    phrases: [
      'לוח תשלומים',
      'הלוואה',
      'סילוקין',
      'loan schedule',
      'amortisation',
      'יתרת הלוואה',
    ],
    weight: 3,
  },
  {
    type: 'private_debt_list',
    phrases: ['חוב פרטי', 'הלוואות מאנשים', 'חייבים לנו', 'אנחנו חייבים', 'מלווה'],
    weight: 3,
  },
  {
    type: 'business_income_expense',
    phrases: ['הכנסות והוצאות עסק', 'חשבונית', 'עוסק מורשה', 'עוסק פטור', 'תקבולים', 'ספקים'],
    weight: 2,
  },
  {
    type: 'household_income_expense',
    phrases: ['הכנסות והוצאות', 'הוצאות הבית', 'משק בית', 'household expenses'],
    weight: 2,
  },
  {
    type: 'balance_summary',
    phrases: ['ריכוז יתרות', 'סיכום יתרות', 'balances summary', 'יתרות'],
    weight: 2,
  },
  {
    type: 'budget_file',
    phrases: ['תקציב', 'budget', 'תכנון חודשי'],
    weight: 2,
  },
];

/** Below this the answer is `unrecognised` rather than a low-confidence guess. */
export const RECOGNITION_THRESHOLD = 3_500;

export interface DetectionInput {
  /** Text found above or beside the table: titles, account lines, the file name. */
  readonly context: readonly string[];
  readonly shape: TableShape | null;
  /**
   * The rows below the header.
   *
   * Only consulted when the words have failed: a file whose headers are
   * `שדה1 | שדה2` says nothing about itself, and the values are then the only
   * evidence there is. Supplying this never changes a document type that the
   * phrases above already recognised — see the guard in `detectDocumentType`.
   */
  readonly dataRows?: readonly (readonly string[])[];
  /** The header row itself, used as supporting evidence for a placeholder header. */
  readonly headerRow?: readonly string[];
}

export function detectDocumentType(input: DetectionInput): DetectionResult {
  const haystack = input.context.map(normaliseHeader).join(' | ');
  const roles = new Set((input.shape?.columns ?? []).map((column) => column.role));

  let best: DetectionResult = { type: 'unrecognised', confidenceBp: 0, evidence: [] };

  for (const signature of SIGNATURES) {
    const matched = signature.phrases.filter((phrase) =>
      haystack.includes(normaliseHeader(phrase)),
    );
    const roleHits = (signature.roles ?? []).filter((role) => roles.has(role as never));

    if (matched.length === 0 && roleHits.length === 0) continue;

    // Each phrase is worth its signature's weight; a supporting column role is
    // worth one. The scale is capped well below certainty: this is a hint.
    const score = matched.length * signature.weight + roleHits.length;
    const confidenceBp = Math.min(9_000, score * 1_200);

    if (confidenceBp > best.confidenceBp) {
      best = {
        type: signature.type,
        confidenceBp,
        evidence: [...matched, ...roleHits.map((role) => `column:${role}`)].slice(0, 6),
      };
    }
  }

  const readableColumns =
    input.shape !== null && input.shape.columns.some((column) => column.role !== 'unknown');

  /*
   * What the values look like, when the headers named no column.
   *
   * Two guards keep this narrow, and neither is optional:
   *
   *   * `readableColumns` — a household expense sheet also has a text column
   *     beside a numeric one. What tells the two apart is that the expense
   *     sheet's headers say "תאריך" and "סכום", so its columns carry roles.
   *     Without this the value test is true of almost every table.
   *   * the confidence comparison — the value reading only wins where it is the
   *     stronger evidence. A bank statement announcing itself in four phrases
   *     scores far above it and keeps its type.
   *
   * The comparison is what makes this robust rather than lucky. A phrase match
   * is one word found somewhere in the file, and a lender called "הלוואה מדוד"
   * puts the word "הלוואה" in a data cell — enough, on its own, to score a debt
   * list as a loan schedule and read nothing from it. The shape of every row in
   * the table is better evidence than one word in one cell, and here it is
   * allowed to say so.
   */
  if (!readableColumns && input.dataRows !== undefined && input.dataRows.length > 0) {
    const debts = detectDebtTable(input.dataRows, input.headerRow ?? []);
    if (debts.detected && debts.confidenceBp > best.confidenceBp) {
      return {
        type: 'private_debt_list',
        confidenceBp: debts.confidenceBp,
        evidence: debts.evidence.slice(0, 6),
      };
    }
  }

  if (best.confidenceBp < RECOGNITION_THRESHOLD) {
    // A table we can read but cannot name is still useful: the generic mapper
    // handles it, and the reviewer says what it is.
    if (readableColumns) {
      return { type: 'general_table', confidenceBp: 2_000, evidence: best.evidence };
    }
    return { type: 'unrecognised', confidenceBp: 0, evidence: best.evidence };
  }

  return best;
}

/** Pulls an account or card hint out of the text above the table. */
export function findAccountHints(context: readonly string[]): string[] {
  const hints = new Set<string>();

  for (const line of context) {
    // A masked card: four digits at the end of a run of dots or asterisks.
    for (const match of line.matchAll(/(?:[*x•.]{2,}\s*)(\d{4})\b/gi)) {
      if (match[1] !== undefined) hints.add(`****${match[1]}`);
    }
    // An account number written as branch/account.
    for (const match of line.matchAll(/\b(\d{2,3})[-/](\d{3,9})\b/g)) {
      hints.add(`${match[1]}-${match[2]}`);
    }
    // An explicit label followed by digits.
    for (const match of line.matchAll(/(?:חשבון|כרטיס|account|card)\D{0,12}(\d{4,12})\b/gi)) {
      if (match[1] !== undefined) hints.add(match[1]);
    }
  }

  return [...hints].slice(0, 10);
}
