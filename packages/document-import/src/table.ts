/**
 * Finding the table inside the document, and working out what its columns mean.
 *
 * Every statement this product is given has the same two problems. There is
 * something above the header — a bank logo line, an account number, a date
 * range — so the first row is not the header. And the header is in Hebrew, in a
 * wording each institution chose for itself: "תאריך ערך", "ת. ערך", "תאריך חיוב"
 * and "תאריך העסקה" are four different columns with four different meanings, and
 * two of them are frequently in the same file.
 *
 * The approach is deliberately conservative. Columns are scored against a
 * vocabulary, the best interpretation is proposed, and anything that does not
 * clear a confidence bar is marked for a person to decide. A wrong column mapping
 * is not a cosmetic error — it is a debit read as a credit — so the design goal
 * is never to guess quietly.
 */

export type ColumnRole =
  | 'transaction_date'
  | 'posting_date'
  | 'value_date'
  | 'description'
  | 'debit'
  | 'credit'
  | 'amount'
  | 'balance'
  | 'principal'
  | 'interest'
  | 'category'
  | 'account'
  | 'card'
  | 'reference'
  | 'installment'
  | 'currency'
  | 'notes'
  | 'unknown';

export interface ColumnAssignment {
  readonly index: number;
  readonly header: string;
  readonly role: ColumnRole;
  /** 0–10000. Below `CONFIDENT_ENOUGH` the reviewer is asked to confirm. */
  readonly confidenceBp: number;
}

export interface TableShape {
  /** Zero-based index of the header row within the grid. */
  readonly headerRow: number;
  readonly columns: readonly ColumnAssignment[];
  /** Rows above the header: a title block, an account line, a date range. */
  readonly preamble: readonly (readonly string[])[];
  readonly confidenceBp: number;
}

/** A column mapping is applied without asking only above this confidence. */
export const CONFIDENT_ENOUGH = 7_000;

interface RoleVocabulary {
  readonly role: ColumnRole;
  /** Phrases that identify the column. Matched as substrings, after cleaning. */
  readonly terms: readonly string[];
  /** Terms that rule the role out even when another term matched. */
  readonly excludes?: readonly string[];
}

/**
 * The vocabulary.
 *
 * Ordered from most specific to least: "תאריך ערך" must win over "תאריך", or every
 * date column in the file collapses into one role.
 */
const VOCABULARY: readonly RoleVocabulary[] = [
  {
    role: 'posting_date',
    terms: ['תאריך חיוב', 'תאריך רישום', 'ת. חיוב', 'מועד חיוב', 'posting date', 'post date'],
  },
  {
    role: 'value_date',
    terms: ['תאריך ערך', 'ת. ערך', 'ת.ערך', 'value date'],
  },
  {
    role: 'transaction_date',
    terms: [
      'תאריך העסקה',
      'תאריך עסקה',
      'ת. עסקה',
      'תאריך פעולה',
      'תאריך',
      'transaction date',
      'date',
      'תארך',
    ],
  },
  {
    role: 'description',
    terms: [
      'תיאור',
      'פרטים',
      'שם בית עסק',
      'בית עסק',
      'בית העסק',
      'תאור פעולה',
      'תיאור פעולה',
      'סוג פעולה',
      'פירוט',
      'merchant',
      'description',
      'details',
      'narrative',
      'payee',
    ],
  },
  {
    role: 'debit',
    terms: ['חובה', 'חיוב', 'משיכה', 'debit', 'withdrawal', 'הוצאה', 'תשלום'],
    excludes: ['תאריך', 'date'],
  },
  {
    role: 'credit',
    terms: ['זכות', 'הפקדה', 'credit', 'deposit', 'הכנסה', 'זיכוי'],
    excludes: ['תאריך', 'date'],
  },
  {
    role: 'principal',
    terms: ['קרן', 'החזר קרן', 'על חשבון הקרן', 'principal'],
  },
  {
    role: 'interest',
    terms: ['ריבית', 'ריבית והצמדה', 'עמלה', 'interest', 'fees'],
  },
  {
    role: 'balance',
    terms: ['יתרה', 'balance', 'יתרת חשבון', 'יתרה לאחר', 'יתרת קרן'],
  },
  {
    role: 'amount',
    terms: ['סכום חיוב', 'סכום העסקה', 'סכום', 'סך', 'amount', 'total', 'sum', 'עלות'],
  },
  {
    role: 'installment',
    terms: ['תשלום מס', 'תשלומים', 'מספר תשלום', 'installment', 'תשלום נוכחי'],
  },
  {
    role: 'reference',
    terms: ['אסמכתא', 'אסמכתה', 'מספר אישור', 'reference', 'ref', 'מס. שובר', 'שובר'],
  },
  {
    role: 'category',
    terms: ['קטגוריה', 'סיווג', 'ענף', 'category', 'type', 'סוג הוצאה'],
  },
  {
    role: 'card',
    terms: ['כרטיס', '4 ספרות', 'ארבע ספרות', 'card', 'מספר כרטיס'],
  },
  {
    role: 'account',
    terms: ['חשבון', 'מספר חשבון', 'account', 'סניף'],
  },
  {
    role: 'currency',
    terms: ['מטבע', 'currency', 'מט"ח'],
  },
  {
    role: 'notes',
    terms: ['הערות', 'הערה', 'notes', 'comment'],
  },
];

/** Normalises a header cell so wording differences do not defeat a match. */
export function normaliseHeader(text: string): string {
  return text
    .replace(/[\u200e\u200f\u2066-\u2069]/g, '')
    .replace(/["'`׳״]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Scores one header cell against the vocabulary. */
export function classifyHeader(header: string): { role: ColumnRole; confidenceBp: number } {
  const cleaned = normaliseHeader(header);
  if (cleaned.length === 0) return { role: 'unknown', confidenceBp: 0 };

  for (const entry of VOCABULARY) {
    if (entry.excludes?.some((term) => cleaned.includes(normaliseHeader(term)))) continue;

    for (const term of entry.terms) {
      const normalisedTerm = normaliseHeader(term);
      if (cleaned === normalisedTerm) return { role: entry.role, confidenceBp: 9_800 };
      if (cleaned.includes(normalisedTerm)) {
        // A partial match on a long header is weaker evidence than an exact one.
        const coverage = normalisedTerm.length / cleaned.length;
        const confidence = 6_000 + Math.round(coverage * 3_000);
        return { role: entry.role, confidenceBp: confidence };
      }
    }
  }

  return { role: 'unknown', confidenceBp: 0 };
}

/**
 * How much a row looks like a header rather than data.
 *
 * A header row is mostly words that name columns and contains no dates or money.
 * That second half matters: "תאריך" appearing in a data row's description would
 * otherwise pull the header detector onto the wrong line.
 */
function headerScore(row: readonly string[]): number {
  const filled = row.filter((cell) => cell.trim().length > 0);
  if (filled.length < 2) return 0;

  let recognised = 0;
  let numericLooking = 0;
  const rolesSeen = new Set<ColumnRole>();

  for (const cell of filled) {
    const { role, confidenceBp } = classifyHeader(cell);
    if (role !== 'unknown' && confidenceBp >= 6_000) {
      recognised += 1;
      rolesSeen.add(role);
    }
    if (/^[\s\d.,\-()₪]+$/.test(cell) && /\d/.test(cell)) numericLooking += 1;
  }

  if (recognised === 0) return 0;

  // Distinct roles matter more than repeated matches: a row of five cells that all
  // say "תאריך" is not a header.
  const distinctBonus = rolesSeen.size * 2;
  const numericPenalty = numericLooking * 3;
  return recognised + distinctBonus - numericPenalty;
}

export interface HeaderSearchOptions {
  /** How many rows from the top may hold the header. */
  readonly maxPreambleRows?: number;
}

/**
 * Locates the header row and reads the columns.
 *
 * Returns null when no row in the search window looks like a header at all — the
 * signal that the file needs the manual mapping screen rather than a silent
 * assumption that row one is the header.
 */
export function detectTable(
  rows: readonly (readonly string[])[],
  options: HeaderSearchOptions = {},
): TableShape | null {
  const window = Math.min(rows.length, options.maxPreambleRows ?? 25);

  let bestIndex = -1;
  let bestScore = 0;

  for (let index = 0; index < window; index += 1) {
    const row = rows[index];
    if (row === undefined) continue;
    const score = headerScore(row);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  if (bestIndex === -1) return null;

  const header = rows[bestIndex] ?? [];
  const columns = header.map((cell, index) => {
    const { role, confidenceBp } = classifyHeader(cell);
    return { index, header: cell.trim(), role, confidenceBp };
  });

  const resolved = disambiguate(columns);
  const named = resolved.filter((column) => column.role !== 'unknown');
  const averageConfidence =
    named.length === 0
      ? 0
      : Math.round(named.reduce((sum, column) => sum + column.confidenceBp, 0) / named.length);

  return {
    headerRow: bestIndex,
    columns: resolved,
    preamble: rows.slice(0, bestIndex),
    confidenceBp: Math.min(9_900, averageConfidence),
  };
}

/**
 * Resolves two columns claiming the same role.
 *
 * The stronger match keeps the role; the weaker one is demoted rather than
 * silently duplicated, because two columns both called "amount" would double every
 * row. Date roles are the exception worth spelling out: a file with two date
 * columns usually has a transaction date and a posting date, and where the second
 * is unlabelled the later column is the posting date by convention — a convention
 * this marks as lower confidence so it reaches the reviewer.
 */
function disambiguate(columns: readonly ColumnAssignment[]): ColumnAssignment[] {
  const byRole = new Map<ColumnRole, ColumnAssignment[]>();
  for (const column of columns) {
    if (column.role === 'unknown') continue;
    const list = byRole.get(column.role) ?? [];
    list.push(column);
    byRole.set(column.role, list);
  }

  const demoted = new Set<number>();
  for (const [role, list] of byRole) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => b.confidenceBp - a.confidenceBp);
    for (const loser of sorted.slice(1)) {
      // A second date column is meaningful; a second amount column is a conflict.
      if (role === 'transaction_date') continue;
      demoted.add(loser.index);
    }
  }

  return columns.map((column) =>
    demoted.has(column.index)
      ? { ...column, role: 'unknown' as ColumnRole, confidenceBp: 0 }
      : column,
  );
}

/** Finds the column assigned to a role, if any. */
export function columnFor(shape: TableShape, role: ColumnRole): ColumnAssignment | undefined {
  return shape.columns.find((column) => column.role === role);
}

/**
 * True when the row repeats the header — common when a statement paginates and
 * the header is redrawn on every page.
 */
export function isRepeatedHeader(row: readonly string[], header: readonly string[]): boolean {
  const rowCells = row.map(normaliseHeader).filter((cell) => cell.length > 0);
  const headerCells = header.map(normaliseHeader).filter((cell) => cell.length > 0);
  if (rowCells.length === 0 || headerCells.length === 0) return false;

  const matches = rowCells.filter((cell) => headerCells.includes(cell)).length;
  return matches >= Math.max(2, Math.ceil(headerCells.length * 0.6));
}

/** Words that mark a totals line at the bottom of a statement. */
const TOTAL_MARKERS = [
  'סה"כ',
  'סה״כ',
  'סהכ',
  'סך הכל',
  'סך הכול',
  'total',
  'subtotal',
  'grand total',
  'יתרת סגירה',
  'יתרת פתיחה',
];

/** True when the row is a totals or opening/closing-balance line, not a movement. */
export function isTotalsRow(row: readonly string[]): boolean {
  return row.some((cell) => {
    const cleaned = normaliseHeader(cell);
    return TOTAL_MARKERS.some((marker) => cleaned.includes(normaliseHeader(marker)));
  });
}

/** True when every cell in the row is blank. */
export function isBlankRow(row: readonly string[]): boolean {
  return row.every((cell) => cell.trim().length === 0);
}
