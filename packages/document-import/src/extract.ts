import type {
  DocumentType,
  ExtractionSummary,
  ImportFileKind,
  ImportWarningCode,
  ProposalKind,
  ProposedPayload,
  RawCell,
  RecordScope,
  SourceLocation,
} from '@family-finance/contracts';

import { readCsv } from './csv';
import { detectDocumentType, findAccountHints } from './detect';
import { Deadline, LIMITS, MalformedDocumentError } from './limits';
import {
  cleanDescription,
  inferDateOrder,
  parseAmount,
  parseDate,
  parseDateCandidate,
  resolveDate,
  type DateOrder,
} from './normalize';
import { readPdf } from './pdf';
import { detectFile, sanitiseFileName } from './signature';
import {
  CONFIDENT_ENOUGH,
  columnFor,
  detectTable,
  isBlankRow,
  isRepeatedHeader,
  isTotalsRow,
  type ColumnRole,
  type TableShape,
} from './table';
import { readWorkbook, type SheetCellValue } from './xlsx';

/**
 * The pipeline: bytes in, reviewable proposals out.
 *
 * Every proposal that leaves this module carries four things that make it
 * reviewable rather than merely produced: where in the document it came from, the
 * exact text the document used, what we read that as, and every reason we might be
 * wrong. Nothing here writes to a store, and nothing here decides that a proposal
 * is correct — that decision is a person's, made on the review screen, and this
 * module's whole job is to give them enough to make it.
 */

export interface Cell {
  readonly text: string;
  /** Set when the source itself knew the value was a date. */
  readonly isoDate: string | null;
  /** The exact decimal text, when the source knew the value was a number. */
  readonly numberRaw: string | null;
  readonly fromFormula: boolean;
}

interface Source {
  readonly label: string;
  readonly sheetName: string | null;
  readonly page: number | null;
  readonly rows: readonly (readonly Cell[])[];
  /**
   * The row number each entry of `rows` actually has in the document.
   *
   * Blank rows are not carried forward, so the two arrays are not the same length
   * as the original. A reviewer told "sheet הוצאות, row 7" must be able to open
   * the file and find row 7, which means the number has to come from the document
   * and not from a position in a filtered array.
   */
  readonly rowNumbers: readonly number[];
  /** Text above or around the table: titles, account lines, date ranges. */
  readonly context: readonly string[];
}

export interface ExtractedProposal {
  readonly kind: ProposalKind;
  readonly location: SourceLocation;
  readonly raw: readonly RawCell[];
  readonly proposed: ProposedPayload;
  readonly confidenceBp: number;
  readonly warnings: readonly ImportWarningCode[];
}

/** What one sheet or page turned out to be, for the review screen's summary. */
export interface TableReport {
  readonly label: string;
  readonly sheetName: string | null;
  readonly page: number | null;
  readonly rowCount: number;
  readonly headerRow: number | null;
  readonly columns: readonly { header: string; role: ColumnRole; confidenceBp: number }[];
  readonly needsManualMapping: boolean;
}

export interface ExtractionResult {
  readonly fileKind: ImportFileKind;
  readonly documentType: DocumentType;
  readonly documentTypeConfidenceBp: number;
  readonly summary: ExtractionSummary;
  readonly warnings: readonly ImportWarningCode[];
  readonly proposals: readonly ExtractedProposal[];
  readonly tables: readonly TableReport[];
  /** Present for a CSV: what encoding and separator were used. */
  readonly textEncoding: 'utf-8' | 'windows-1255' | null;
}

export interface ExtractionOptions {
  readonly fileName: string;
  readonly currency: string;
  /** Which side of the household this document belongs to. */
  readonly scope: RecordScope;
  readonly deadline?: Deadline;
}

const textCell = (text: string): Cell => ({
  text: text.trim(),
  isoDate: null,
  numberRaw: null,
  fromFormula: false,
});

/** Turns a workbook into sources, one per sheet. */
function sourcesFromWorkbook(bytes: Uint8Array, deadline: Deadline): Source[] {
  const workbook = readWorkbook(bytes, deadline);

  return workbook.sheets.map((sheet) => {
    const width = sheet.rows.reduce(
      (widest, row) => Math.max(widest, ...row.cells.map((cell) => cell.column + 1), 0),
      0,
    );

    const rows = sheet.rows.map((row) => {
      const cells: Cell[] = Array.from({ length: width }, () => textCell(''));
      for (const cell of row.cells) {
        if (cell.column >= width) continue;
        cells[cell.column] = toCell(cell.value, cell.fromFormula);
      }
      return cells;
    });

    // The first few rows before any table are the context a detector reads.
    const context = rows
      .slice(0, 12)
      .flatMap((row) => row.map((cell) => cell.text))
      .filter((text) => text.length > 0);

    return {
      label: sheet.name,
      sheetName: sheet.name,
      page: null,
      rows,
      rowNumbers: sheet.rows.map((row) => row.number),
      context: [sheet.name, ...context],
    };
  });
}

function toCell(value: SheetCellValue, fromFormula: boolean): Cell {
  switch (value.kind) {
    case 'empty':
      return { text: '', isoDate: null, numberRaw: null, fromFormula };
    case 'text':
      return { text: value.text.trim(), isoDate: null, numberRaw: null, fromFormula };
    case 'number':
      return { text: value.raw, isoDate: null, numberRaw: value.raw, fromFormula };
    case 'date':
      return { text: value.iso, isoDate: value.iso, numberRaw: null, fromFormula };
    case 'boolean':
      return {
        text: value.value ? 'TRUE' : 'FALSE',
        isoDate: null,
        numberRaw: null,
        fromFormula,
      };
    case 'error':
      return { text: value.code, isoDate: null, numberRaw: null, fromFormula };
  }
}

function sourcesFromCsv(bytes: Uint8Array, deadline: Deadline) {
  const document = readCsv(bytes, deadline);
  const rows = document.rows.map((row) => row.map(textCell));
  const context = document.rows
    .slice(0, 12)
    .flat()
    .filter((text) => text.trim().length > 0);

  return {
    sources: [
      {
        label: 'הקובץ',
        sheetName: null,
        page: null,
        rows,
        rowNumbers: document.rowNumbers,
        context,
      } satisfies Source,
    ],
    encoding: document.encoding,
    truncated: document.truncated,
  };
}

function sourcesFromPdf(bytes: Uint8Array, deadline: Deadline) {
  const extraction = readPdf(bytes, deadline);

  const sources: Source[] = extraction.pages.map((page) => ({
    label: `עמוד ${page.pageNumber}`,
    sheetName: null,
    page: page.pageNumber,
    // A tab in a reconstructed line is a column boundary; see `runsToLines`.
    rows: page.lines.map((line) => line.split('\t').map(textCell)),
    rowNumbers: page.lines.map((_line, index) => index + 1),
    context: page.lines.slice(0, 8),
  }));

  return { sources, extraction };
}

/**
 * Reads one document all the way to proposals.
 *
 * The order is deliberate: identify the bytes, parse the format, find the tables,
 * *then* guess the document type from everything that was found. Guessing first
 * and parsing to fit the guess is how an importer ends up reading a loan schedule
 * as a bank statement.
 */
export function extractDocument(
  bytes: Uint8Array,
  options: ExtractionOptions,
): ExtractionResult {
  const deadline = options.deadline ?? new Deadline();
  const detected = detectFile(bytes, options.fileName);

  const warnings = new Set<ImportWarningCode>();
  let sources: Source[] = [];
  let pageCount: number | null = null;
  let hasImageOnlyPages = false;
  let textEncoding: 'utf-8' | 'windows-1255' | null = null;
  let sheetNames: string[] = [];

  if (detected.kind === 'xlsx') {
    sources = sourcesFromWorkbook(bytes, deadline);
    sheetNames = sources.map((source) => source.sheetName ?? source.label);
    if (
      sources.some((source) => source.rows.some((row) => row.some((cell) => cell.fromFormula)))
    ) {
      warnings.add('formula_cell_value_used');
    }
  } else if (detected.kind === 'csv') {
    const result = sourcesFromCsv(bytes, deadline);
    sources = result.sources;
    textEncoding = result.encoding;
    if (result.truncated) warnings.add('truncated_by_limit');
  } else {
    const result = sourcesFromPdf(bytes, deadline);
    sources = result.sources;
    pageCount = result.extraction.pageCount;
    hasImageOnlyPages = result.extraction.imageOnlyPages.length > 0;
    if (hasImageOnlyPages) warnings.add('image_only_page');
    if (result.extraction.noTextLayer) {
      throw new MalformedDocumentError(
        'malformed_document',
        'the pages carry no text, so nothing could be read from them',
      );
    }
    warnings.add('page_text_unreliable');
  }

  const shapes = new Map<Source, TableShape | null>();
  for (const source of sources) {
    deadline.check();
    // The table detector works on plain text: what a header says is the only
    // thing that identifies a column, and cell typing tells it nothing.
    shapes.set(source, detectTable(source.rows.map((row) => row.map((cell) => cell.text))));
  }

  const bestShape =
    [...shapes.values()]
      .filter((shape): shape is TableShape => shape !== null)
      .sort((a, b) => b.confidenceBp - a.confidenceBp)[0] ?? null;

  const context = [
    sanitiseFileName(options.fileName),
    ...sources.flatMap((source) => source.context.slice(0, 20)),
  ];

  const detection = detectDocumentType({ context, shape: bestShape });
  if (detection.confidenceBp < 5_000) warnings.add('low_confidence_document_type');

  const accountHints = findAccountHints(context);
  if (accountHints.length > 1) warnings.add('multiple_accounts_in_file');

  const proposals: ExtractedProposal[] = [];
  const tables: TableReport[] = [];
  let rowsScanned = 0;
  let rowsSkipped = 0;

  for (const source of sources) {
    deadline.check();
    const shape = shapes.get(source) ?? null;

    tables.push({
      label: source.label,
      sheetName: source.sheetName,
      page: source.page,
      rowCount: source.rows.length,
      headerRow: shape?.headerRow ?? null,
      columns: (shape?.columns ?? []).map((column) => ({
        header: column.header,
        role: column.role,
        confidenceBp: column.confidenceBp,
      })),
      needsManualMapping: shape === null || shape.confidenceBp < CONFIDENT_ENOUGH,
    });

    if (shape === null) {
      rowsSkipped += source.rows.length;
      continue;
    }

    const extracted = extractRows(source, shape, detection.type, options, deadline);
    rowsScanned += extracted.scanned;
    rowsSkipped += extracted.skipped;
    for (const warning of extracted.warnings) warnings.add(warning);

    for (const proposal of extracted.proposals) {
      if (proposals.length >= LIMITS.maxProposalsPerBatch) {
        warnings.add('truncated_by_limit');
        break;
      }
      proposals.push(proposal);
    }
  }

  const dates = proposals
    .map((proposal) => dateOf(proposal.proposed))
    .filter((date): date is string => date !== null)
    .sort();

  const summary: ExtractionSummary = {
    sheetNames,
    pageCount,
    rowsScanned,
    rowsProposed: proposals.length,
    rowsSkipped,
    dateRangeStart: dates[0] ?? null,
    dateRangeEnd: dates[dates.length - 1] ?? null,
    accountHints,
    hasImageOnlyPages,
  };

  return {
    fileKind: detected.kind,
    documentType: detection.type,
    documentTypeConfidenceBp: detection.confidenceBp,
    summary,
    warnings: [...warnings],
    proposals,
    tables,
    textEncoding,
  };
}

function dateOf(payload: ProposedPayload): string | null {
  switch (payload.kind) {
    case 'transaction':
      return payload.value.transactionDate;
    case 'balance':
      return payload.value.asOfDate;
    case 'debt':
      return payload.value.openedOn;
    case 'debt_payment':
      return payload.value.occurredOn;
    case 'planned_item':
      return payload.value.expectedDate;
    case 'account':
    case 'budget_line':
      return null;
  }
}

interface RowExtraction {
  readonly proposals: ExtractedProposal[];
  readonly warnings: ImportWarningCode[];
  readonly scanned: number;
  readonly skipped: number;
}

/** Reads the data rows below a detected header. */
function extractRows(
  source: Source,
  shape: TableShape,
  documentType: DocumentType,
  options: ExtractionOptions,
  deadline: Deadline,
): RowExtraction {
  const header = source.rows[shape.headerRow] ?? [];
  const dataRows = source.rows.slice(shape.headerRow + 1);

  const warnings: ImportWarningCode[] = [];
  const proposals: ExtractedProposal[] = [];
  let skipped = 0;

  const dateColumn =
    columnFor(shape, 'transaction_date') ??
    columnFor(shape, 'value_date') ??
    columnFor(shape, 'posting_date');
  const postingColumn =
    columnFor(shape, 'posting_date') ?? columnFor(shape, 'value_date') ?? undefined;
  const descriptionColumn = columnFor(shape, 'description');
  const debitColumn = columnFor(shape, 'debit');
  const creditColumn = columnFor(shape, 'credit');
  const amountColumn = columnFor(shape, 'amount');
  const balanceColumn = columnFor(shape, 'balance');
  const referenceColumn = columnFor(shape, 'reference');
  const installmentColumn = columnFor(shape, 'installment');
  const principalColumn = columnFor(shape, 'principal');
  const interestColumn = columnFor(shape, 'interest');

  // The date convention is settled once, from the whole column.
  const dateSamples =
    dateColumn === undefined
      ? []
      : dataRows
          .map((row) => row[dateColumn.index]?.text ?? '')
          .filter((text) => text.length > 0);
  const dateOrderDecision = inferDateOrder(dateSamples);
  if (!dateOrderDecision.certain && dateSamples.length > 0) warnings.push('ambiguous_date');

  if (shape.confidenceBp < CONFIDENT_ENOUGH) warnings.push('ambiguous_column_mapping');

  const isSchedule = documentType === 'loan_schedule' || documentType === 'mortgage_schedule';
  const isCard = documentType === 'credit_card_statement';

  let previousBalanceMinor: number | null = null;
  let previousBalanceNegative = false;

  dataRows.forEach((row, offset) => {
    if ((offset & 0xff) === 0) deadline.check();

    // The document's own row number, not a position in the filtered array.
    const rowNumber =
      source.rowNumbers[shape.headerRow + 1 + offset] ?? shape.headerRow + offset + 2;
    const texts = row.map((cell) => cell.text);

    if (isBlankRow(texts)) {
      skipped += 1;
      return;
    }
    if (
      isRepeatedHeader(
        texts,
        header.map((cell) => cell.text),
      )
    ) {
      skipped += 1;
      if (!warnings.includes('repeated_header')) warnings.push('repeated_header');
      return;
    }
    if (isTotalsRow(texts)) {
      skipped += 1;
      if (!warnings.includes('footer_total_row')) warnings.push('footer_total_row');
      return;
    }

    const raw: RawCell[] = shape.columns
      .filter((column) => (row[column.index]?.text ?? '').length > 0)
      .slice(0, 40)
      .map((column) => ({
        column: column.header.slice(0, 200) || `עמודה ${column.index + 1}`,
        text: (row[column.index]?.text ?? '').slice(0, 2000),
      }));

    const location: SourceLocation = {
      sheetName: source.sheetName,
      page: source.page,
      row: rowNumber,
      snippet: texts
        .filter((text) => text.length > 0)
        .join(' | ')
        .slice(0, 1000),
    };

    if (isSchedule && (principalColumn !== undefined || interestColumn !== undefined)) {
      const built = buildDebtPayment(
        row,
        { dateColumn, principalColumn, interestColumn },
        dateOrderDecision.order,
        location,
        raw,
        shape.confidenceBp,
      );
      if (built === null) skipped += 1;
      else proposals.push(built);
      return;
    }

    const built = buildTransaction({
      row,
      columns: {
        dateColumn,
        postingColumn,
        descriptionColumn,
        debitColumn,
        creditColumn,
        amountColumn,
        balanceColumn,
        referenceColumn,
        installmentColumn,
      },
      order: dateOrderDecision.order,
      location,
      raw,
      options,
      isCard,
      shapeConfidenceBp: shape.confidenceBp,
      previousBalanceMinor,
      previousBalanceNegative,
    });

    if (built === null) {
      skipped += 1;
      return;
    }

    proposals.push(built.proposal);
    previousBalanceMinor = built.balanceMinor;
    previousBalanceNegative = built.balanceNegative;
  });

  return { proposals, warnings, scanned: dataRows.length, skipped };
}

interface TransactionColumns {
  readonly dateColumn: { index: number } | undefined;
  readonly postingColumn: { index: number } | undefined;
  readonly descriptionColumn: { index: number } | undefined;
  readonly debitColumn: { index: number } | undefined;
  readonly creditColumn: { index: number } | undefined;
  readonly amountColumn: { index: number } | undefined;
  readonly balanceColumn: { index: number } | undefined;
  readonly referenceColumn: { index: number } | undefined;
  readonly installmentColumn: { index: number } | undefined;
}

function readDate(cell: Cell | undefined, order: DateOrder): string | null {
  if (cell === undefined) return null;
  if (cell.isoDate !== null) return cell.isoDate;
  if (cell.text.length === 0) return null;
  const candidate = parseDateCandidate(cell.text);
  return candidate === null ? null : resolveDate(candidate, order);
}

function readAmount(cell: Cell | undefined): ReturnType<typeof parseAmount> {
  if (cell === undefined) return null;
  // A spreadsheet number is already exact text; parse that rather than the display
  // form, which may have been rounded for presentation.
  const text = cell.numberRaw ?? cell.text;
  if (text.length === 0) return null;
  return parseAmount(text);
}

function buildTransaction(input: {
  row: readonly Cell[];
  columns: TransactionColumns;
  order: DateOrder;
  location: SourceLocation;
  raw: readonly RawCell[];
  options: ExtractionOptions;
  isCard: boolean;
  shapeConfidenceBp: number;
  previousBalanceMinor: number | null;
  previousBalanceNegative: boolean;
}): {
  proposal: ExtractedProposal;
  balanceMinor: number | null;
  balanceNegative: boolean;
} | null {
  const { row, columns, order, options } = input;
  const warnings: ImportWarningCode[] = [];

  const transactionDate = readDate(
    columns.dateColumn === undefined ? undefined : row[columns.dateColumn.index],
    order,
  );
  if (transactionDate === null) return null;

  const postingDate =
    columns.postingColumn === undefined
      ? null
      : readDate(row[columns.postingColumn.index], order);

  const descriptionCell =
    columns.descriptionColumn === undefined ? undefined : row[columns.descriptionColumn.index];
  const description = cleanDescription(descriptionCell?.text ?? '');
  if (description.length === 0) warnings.push('missing_description');

  const debit =
    columns.debitColumn === undefined ? null : readAmount(row[columns.debitColumn.index]);
  const credit =
    columns.creditColumn === undefined ? null : readAmount(row[columns.creditColumn.index]);
  const single =
    columns.amountColumn === undefined ? null : readAmount(row[columns.amountColumn.index]);

  let amountMinor: number | null = null;
  let direction: 'inflow' | 'outflow' | null = null;

  if (debit !== null && debit.amountMinor > 0) {
    amountMinor = debit.amountMinor;
    direction = 'outflow';
    if (debit.ambiguousSeparator) warnings.push('unparsed_amount');
  } else if (credit !== null && credit.amountMinor > 0) {
    amountMinor = credit.amountMinor;
    direction = 'inflow';
    if (credit.ambiguousSeparator) warnings.push('unparsed_amount');
  } else if (single !== null && single.amountMinor > 0) {
    amountMinor = single.amountMinor;
    if (single.negative) {
      direction = 'outflow';
    } else if (input.isCard) {
      // A card statement lists charges; an unsigned figure is money going out.
      direction = 'outflow';
      warnings.push('ambiguous_direction');
    } else {
      direction = 'inflow';
      warnings.push('ambiguous_direction');
    }
    if (single.ambiguousSeparator) warnings.push('unparsed_amount');
  }

  if (amountMinor === null || direction === null || amountMinor === 0) {
    return null;
  }

  const balance =
    columns.balanceColumn === undefined ? null : readAmount(row[columns.balanceColumn.index]);

  if (balance !== null && input.previousBalanceMinor !== null) {
    // A running balance is a free consistency check on the amount and its
    // direction. It is reported, never used to alter what the row says.
    const previousSigned = input.previousBalanceNegative
      ? -input.previousBalanceMinor
      : input.previousBalanceMinor;
    const signed = balance.negative ? -balance.amountMinor : balance.amountMinor;
    const movement = direction === 'inflow' ? amountMinor : -amountMinor;
    if (previousSigned + movement !== signed) warnings.push('balance_does_not_follow');
  }

  const reference =
    columns.referenceColumn === undefined
      ? null
      : (row[columns.referenceColumn.index]?.text.slice(0, 120) ?? null);

  const installmentText =
    columns.installmentColumn === undefined
      ? ''
      : (row[columns.installmentColumn.index]?.text ?? '');
  const installment = installmentText.match(/(\d{1,3})\s*(?:מתוך|\/|of)\s*(\d{1,3})/);

  const confidenceBp = Math.max(
    1_000,
    Math.min(9_500, input.shapeConfidenceBp - warnings.length * 800),
  );

  return {
    proposal: {
      kind: 'transaction',
      location: input.location,
      raw: input.raw,
      proposed: {
        kind: 'transaction',
        value: {
          transactionDate,
          postingDate,
          description: description.length > 0 ? description : 'ללא תיאור',
          amountMinor,
          direction,
          currency: options.currency,
          scope: options.scope,
          categoryKey: null,
          reference: reference !== null && reference.length > 0 ? reference : null,
          installmentNumber: installment?.[1] === undefined ? null : Number(installment[1]),
          installmentTotal: installment?.[2] === undefined ? null : Number(installment[2]),
          balanceAfterMinor: balance?.amountMinor ?? null,
          balanceAfterDirection:
            balance === null ? null : balance.negative ? 'outflow' : 'inflow',
        },
      },
      confidenceBp,
      warnings,
    },
    balanceMinor: balance?.amountMinor ?? null,
    balanceNegative: balance?.negative ?? false,
  };
}

function buildDebtPayment(
  row: readonly Cell[],
  columns: {
    dateColumn: { index: number } | undefined;
    principalColumn: { index: number } | undefined;
    interestColumn: { index: number } | undefined;
  },
  order: DateOrder,
  location: SourceLocation,
  raw: readonly RawCell[],
  shapeConfidenceBp: number,
): ExtractedProposal | null {
  const occurredOn = readDate(
    columns.dateColumn === undefined ? undefined : row[columns.dateColumn.index],
    order,
  );
  if (occurredOn === null) return null;

  const principal =
    columns.principalColumn === undefined
      ? null
      : readAmount(row[columns.principalColumn.index]);
  const interest =
    columns.interestColumn === undefined ? null : readAmount(row[columns.interestColumn.index]);

  if (principal === null && interest === null) return null;

  const warnings: ImportWarningCode[] = [];
  if (principal === null) warnings.push('missing_amount');

  return {
    kind: 'debt_payment',
    location,
    raw,
    proposed: {
      kind: 'debt_payment',
      value: {
        // The creditor is not in the schedule's rows; the reviewer attaches it.
        creditorHint: '',
        principalMinor: principal?.amountMinor ?? 0,
        interestMinor: interest?.amountMinor ?? 0,
        feeMinor: 0,
        occurredOn,
      },
    },
    confidenceBp: Math.max(1_000, Math.min(9_000, shapeConfidenceBp - warnings.length * 800)),
    warnings,
  };
}

/** Reads a date from free text, for a document header line. */
export function findDateRange(lines: readonly string[]): {
  start: string | null;
  end: string | null;
} {
  const found: string[] = [];
  for (const line of lines) {
    for (const match of line.matchAll(
      /\b(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{4}-\d{2}-\d{2})\b/g,
    )) {
      const parsed = parseDate(match[0]);
      if (parsed !== null) found.push(parsed);
    }
  }
  found.sort();
  return { start: found[0] ?? null, end: found[found.length - 1] ?? null };
}
