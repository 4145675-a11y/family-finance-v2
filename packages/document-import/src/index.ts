export type { ImportWarningCode } from '@family-finance/contracts';

export {
  Deadline,
  LIMITS,
  LimitExceededError,
  MalformedDocumentError,
  type Limits,
} from './limits';

export {
  ACCEPTED_EXTENSIONS,
  ACCEPTED_MIME_TYPES,
  detectFile,
  extensionOf,
  sanitiseFileName,
  type DetectedFile,
} from './signature';

export {
  InflationBudget,
  findEntry,
  readZipDirectory,
  readZipEntry,
  type ZipEntry,
} from './zip';

export { stripControlCharacters, stripXmlForbiddenCharacters } from './text-safety';

export { decodeXmlPart, decodeXmlText, localName, scanXml, type XmlToken } from './xml';

export {
  columnIndexFromReference,
  readWorkbook,
  serialToIsoDate,
  type Sheet,
  type SheetCell,
  type SheetCellValue,
  type SheetRow,
  type Workbook,
} from './xlsx';

export {
  decodeText,
  decodeWindows1255,
  detectDelimiter,
  readCsv,
  type CsvDocument,
} from './csv';

export {
  findColumns,
  toColumnGrid,
  toPositionedLines,
  type PositionedCell,
  type PositionedLine,
} from './pdf-columns';

export {
  readPdf,
  unavailableOcrProvider,
  type OcrProvider,
  type PdfExtraction,
  type PdfPageText,
  type TextRun,
} from './pdf';

export {
  cleanDescription,
  inferDateOrder,
  parseAmount,
  parseDate,
  parseDateCandidate,
  resolveDate,
  type DateCandidate,
  type DateOrder,
  type DateOrderDecision,
  type ParsedAmount,
} from './normalize';

export {
  CONFIDENT_ENOUGH,
  classifyHeader,
  columnFor,
  detectTable,
  isBlankRow,
  isRepeatedHeader,
  isTotalsRow,
  normaliseHeader,
  type ColumnAssignment,
  type ColumnRole,
  type TableShape,
} from './table';

export {
  RECOGNITION_THRESHOLD,
  detectDocumentType,
  findAccountHints,
  type DetectionInput,
  type DetectionResult,
} from './detect';

export {
  extractDocument,
  findDateRange,
  type Cell,
  type ExtractedProposal,
  type ExtractionOptions,
  type ExtractionResult,
  type TableReport,
} from './extract';

export {
  assessDuplicate,
  descriptionSimilarity,
  sourceFingerprint,
  type CandidateRecord,
  type DuplicateAssessment,
  type ExistingRecord,
} from './duplicates';

// Synthetic fixtures. Test material only: no real financial data, ever.
export {
  bankStatementPdf,
  buildCsv,
  buildPdf,
  buildXlsx,
  dateSerial,
  householdExpensesXlsx,
  scannedPdf,
  type CsvFixtureOptions,
  type PdfFixtureOptions,
  type XlsxFixtureSheet,
} from './fixtures/documents';

export {
  cell,
  columnName,
  minorToDecimalText,
  safeSheetName,
  writeWorkbook,
  type WriteCellValue,
  type WriteSheet,
} from './xlsx-write';

export { crc32, writeZip, type ZipFile } from './zip-write';
