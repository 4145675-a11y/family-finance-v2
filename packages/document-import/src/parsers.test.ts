import { deflateRawSync } from 'node:zlib';

import { describe, expect, test } from 'vitest';

import { readCsv, decodeText, detectDelimiter } from './csv';
import {
  bankStatementPdf,
  buildCsv,
  buildXlsx,
  dateSerial,
  householdExpensesXlsx,
  scannedPdf,
} from './fixtures/documents';
import { Deadline, LimitExceededError, MalformedDocumentError } from './limits';
import { readPdf } from './pdf';
import { detectFile, sanitiseFileName } from './signature';
import { detectTable, columnFor } from './table';
import { readWorkbook, serialToIsoDate } from './xlsx';
import { InflationBudget, readZipDirectory, readZipEntry } from './zip';
import { writeZip } from './zip-write';
import { readWorkbook as readWorkbookAgain } from './xlsx';

/**
 * The parsers, against files this suite builds itself.
 *
 * Two things are being proved. The ordinary path works on the shapes real Israeli
 * documents have — a title block, Hebrew headers, a semicolon separator, an old
 * code page. And the hostile path fails safely: a bomb, a macro, a program
 * renamed to `.csv`, a traversal attempt in a name.
 */

describe('a file is what its bytes say, not what its name says', () => {
  test('a workbook is recognised from its archive header', () => {
    expect(detectFile(householdExpensesXlsx(), 'anything.txt').kind).toBe('xlsx');
  });

  test('a PDF is recognised from its marker', () => {
    expect(detectFile(bankStatementPdf(), 'statement.csv').kind).toBe('pdf');
  });

  test('plain text with a csv name is a csv', () => {
    expect(detectFile(new TextEncoder().encode('a,b\n1,2\n'), 'x.csv').kind).toBe('csv');
  });

  test('a Windows program renamed to .csv is refused', () => {
    const executable = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]);
    expect(() => detectFile(executable, 'statement.csv')).toThrow(MalformedDocumentError);
  });

  test('the old binary .xls is refused by name, with the way out stated', () => {
    const ole2 = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00]);
    expect(() => detectFile(ole2, 'old.xls')).toThrow(/\.xlsx/);
  });

  test('an empty file is refused', () => {
    expect(() => detectFile(new Uint8Array(0), 'empty.csv')).toThrow(MalformedDocumentError);
  });

  test('a binary blob that is not a known format is refused', () => {
    const blob = Uint8Array.from({ length: 64 }, (_value, index) => (index === 10 ? 0 : 200));
    expect(() => detectFile(blob, 'weird.csv')).toThrow(MalformedDocumentError);
  });
});

describe('a file name can never become a path', () => {
  test.each([
    ['../../etc/passwd', 'passwd'],
    ['..\\..\\windows\\system32\\config', 'config'],
    ['/absolute/path/statement.csv', 'statement.csv'],
    ['....//....//x.csv', 'x.csv'],
    ['C:\\Users\\someone\\bank.xlsx', 'bank.xlsx'],
  ])('%s is sanitised to %s', (input, expected) => {
    const safe = sanitiseFileName(input);
    expect(safe).toBe(expected);
    expect(safe).not.toContain('/');
    expect(safe).not.toContain('\\');
    expect(safe).not.toContain('..');
  });

  test('a name that sanitises to nothing still gets a name', () => {
    expect(sanitiseFileName('...')).toBe('document');
    expect(sanitiseFileName('')).toBe('document');
  });
});

describe('workbooks', () => {
  test('a household sheet is read, dates and all', () => {
    const workbook = readWorkbook(householdExpensesXlsx());
    expect(workbook.sheets).toHaveLength(1);

    const sheet = workbook.sheets[0]!;
    expect(sheet.name).toBe('הוצאות');

    const dateCell = sheet.rows
      .flatMap((row) => row.cells)
      .find((cell) => cell.value.kind === 'date');
    expect(dateCell?.value).toMatchObject({ kind: 'date', iso: '2026-09-02' });
  });

  test('the exact stored decimal survives, not a rounded display value', () => {
    const workbook = readWorkbook(householdExpensesXlsx());
    const numbers = workbook.sheets[0]!.rows.flatMap((row) =>
      row.cells.filter((cell) => cell.value.kind === 'number'),
    );
    const raws = numbers.map((cell) => (cell.value.kind === 'number' ? cell.value.raw : ''));
    expect(raws).toContain('240.5');
    expect(raws).toContain('610.25');
  });

  test('the header row is found below the title block', () => {
    const workbook = readWorkbook(householdExpensesXlsx());
    const rows = workbook.sheets[0]!.rows.map((row) => {
      const width = Math.max(...row.cells.map((cell) => cell.column + 1), 0);
      const cells = Array.from({ length: width }, () => '');
      for (const cell of row.cells) {
        cells[cell.column] =
          cell.value.kind === 'text'
            ? cell.value.text
            : cell.value.kind === 'number'
              ? cell.value.raw
              : cell.value.kind === 'date'
                ? cell.value.iso
                : '';
      }
      return cells;
    });

    const shape = detectTable(rows);
    expect(shape).not.toBeNull();
    expect(columnFor(shape!, 'transaction_date')?.header).toBe('תאריך');
    expect(columnFor(shape!, 'description')?.header).toBe('תיאור');
    expect(columnFor(shape!, 'amount')?.header).toBe('סכום');
  });

  test('a macro-enabled workbook is refused, not opened', () => {
    const archive = writeZip([
      {
        name: '[Content_Types].xml',
        content:
          '<Types><Override ContentType="application/vnd.ms-excel.sheet.macroEnabled.main+xml"/></Types>',
      },
      { name: 'xl/workbook.xml', content: '<workbook/>' },
    ]);
    expect(() => readWorkbook(archive)).toThrow(/macro/i);
  });

  test('a workbook with a vbaProject part is refused', () => {
    const archive = writeZip([
      { name: '[Content_Types].xml', content: '<Types/>' },
      { name: 'xl/vbaProject.bin', content: new Uint8Array([1, 2, 3]) },
      { name: 'xl/workbook.xml', content: '<workbook/>' },
    ]);
    expect(() => readWorkbook(archive)).toThrow(/macro/i);
  });

  test('a formula cell yields its cached value and is flagged, never evaluated', () => {
    const sheetXml =
      '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
      '<row r="1"><c r="A1"><f>SUM(B1:B9)</f><v>42.5</v></c></row>' +
      '</sheetData></worksheet>';

    const archive = writeZip([
      { name: '[Content_Types].xml', content: '<Types/>' },
      {
        name: 'xl/workbook.xml',
        content:
          '<workbook xmlns:r="r"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>',
      },
      {
        name: 'xl/_rels/workbook.xml.rels',
        content:
          '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
      },
      { name: 'xl/worksheets/sheet1.xml', content: sheetXml },
    ]);

    const workbook = readWorkbookAgain(archive);
    const cell = workbook.sheets[0]!.rows[0]!.cells[0]!;
    expect(cell.fromFormula).toBe(true);
    expect(cell.value).toEqual({ kind: 'number', raw: '42.5' });
    expect(workbook.usedFormulas).toBe(true);
  });

  test('an XML part that declares entities is refused', () => {
    const archive = writeZip([
      { name: '[Content_Types].xml', content: '<Types/>' },
      {
        name: 'xl/workbook.xml',
        content:
          '<!DOCTYPE workbook [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><workbook>&xxe;</workbook>',
      },
    ]);
    expect(() => readWorkbook(archive)).toThrow(/entit/i);
  });

  test('a decompression bomb is stopped by the ratio guard', () => {
    // A megabyte of zeroes compresses to almost nothing: a ratio far past the cap.
    const payload = new Uint8Array(4 * 1024 * 1024);
    const compressed = deflateRawSync(payload, { level: 9 });

    // Hand-build a local entry claiming the real (huge) uncompressed size.
    const name = new TextEncoder().encode('xl/workbook.xml');
    const local = new Uint8Array(30 + name.length + compressed.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(8, 8, true);
    localView.setUint32(18, compressed.length, true);
    localView.setUint32(22, payload.length, true);
    localView.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(compressed, 30 + name.length);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(10, 8, true);
    centralView.setUint32(20, compressed.length, true);
    centralView.setUint32(24, payload.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, 0, true);
    central.set(name, 46);

    const eocd = new Uint8Array(22);
    const eocdView = new DataView(eocd.buffer);
    eocdView.setUint32(0, 0x06054b50, true);
    eocdView.setUint16(8, 1, true);
    eocdView.setUint16(10, 1, true);
    eocdView.setUint32(12, central.length, true);
    eocdView.setUint32(16, local.length, true);

    const archive = new Uint8Array(local.length + central.length + eocd.length);
    archive.set(local, 0);
    archive.set(central, local.length);
    archive.set(eocd, local.length + central.length);

    const entries = readZipDirectory(archive);
    expect(entries).toHaveLength(1);
    expect(() =>
      readZipEntry(archive, entries[0]!, new InflationBudget(), new Deadline()),
    ).toThrow(LimitExceededError);
  });

  test('the archive-wide budget stops a bomb built from many small members', () => {
    const budget = new InflationBudget(1024);
    const archive = writeZip([
      { name: 'a.xml', content: 'x'.repeat(4096) },
      { name: 'b.xml', content: 'x'.repeat(4096) },
    ]);
    const entries = readZipDirectory(archive);
    expect(() => {
      for (const entry of entries) readZipEntry(archive, entry, budget, new Deadline());
    }).toThrow(LimitExceededError);
  });

  test('a password-protected archive is refused rather than half-read', () => {
    const archive = writeZip([{ name: 'x.xml', content: '<x/>' }]);
    const entries = readZipDirectory(archive);
    const encrypted = { ...entries[0]!, encrypted: true };
    expect(() =>
      readZipEntry(archive, encrypted, new InflationBudget(), new Deadline()),
    ).toThrow(/password/i);
  });

  test('the 1900 phantom leap day is reported unreadable rather than shifted', () => {
    expect(serialToIsoDate(60, false)).toBeNull();
    expect(serialToIsoDate(59, false)).toBe('1900-02-28');
    expect(serialToIsoDate(61, false)).toBe('1900-03-01');
    expect(serialToIsoDate(46_271, false)).toBe('2026-09-06');
  });

  test('the 1904 epoch shifts every date, and is honoured', () => {
    expect(serialToIsoDate(0, true)).toBe('1904-01-01');
  });
});

describe('delimited text', () => {
  test('a semicolon file with comma thousands separators is split correctly', () => {
    const bytes = buildCsv({
      delimiter: ';',
      preamble: ['בנק לדוגמה', 'חשבון 12-345678'],
      header: ['תאריך', 'תיאור', 'חובה', 'זכות', 'יתרה'],
      rows: [
        ['03/09/2026', 'סופרמרקט', '1,412.30', '', '8,120.40'],
        ['05/09/2026', 'משכורת', '', '12,400.00', '20,520.40'],
      ],
    });

    const document = readCsv(bytes);
    expect(document.delimiter).toBe(';');
    expect(document.rows[3]).toEqual(['03/09/2026', 'סופרמרקט', '1,412.30', '', '8,120.40']);
  });

  test('windows-1255 Hebrew is decoded rather than mangled', () => {
    const bytes = buildCsv({
      encoding: 'windows-1255',
      header: ['תאריך', 'תיאור', 'סכום'],
      rows: [['03/09/2026', 'מכולת', '240.50']],
    });

    const { text, encoding } = decodeText(bytes);
    expect(encoding).toBe('windows-1255');
    expect(text).toContain('תאריך');
    expect(text).toContain('מכולת');
  });

  test('a quoted field containing the delimiter stays one field', () => {
    const bytes = new TextEncoder().encode('a,b,c\n1,"two, and a half",3\n');
    const document = readCsv(bytes);
    expect(document.rows[1]).toEqual(['1', 'two, and a half', '3']);
  });

  test('a quoted newline does not end the row', () => {
    const bytes = new TextEncoder().encode('a,b\n"line one\nline two",2\n');
    const document = readCsv(bytes);
    expect(document.rows).toHaveLength(2);
    expect(document.rows[1]?.[0]).toContain('line two');
  });

  test('the delimiter is chosen by consistency, not by count', () => {
    // Commas appear more often, but only the semicolon splits every line evenly.
    const text = 'a;b;c\nx, y, z, w;q;r\nm;n;o\n';
    expect(detectDelimiter(text)).toBe(';');
  });

  test('a file with no rows is refused', () => {
    expect(() => readCsv(new TextEncoder().encode('   \n  \n'))).toThrow(
      MalformedDocumentError,
    );
  });
});

describe('PDF', () => {
  test('a text statement yields its rows with page provenance', () => {
    const extraction = readPdf(bankStatementPdf());
    expect(extraction.pageCount).toBe(1);
    expect(extraction.noTextLayer).toBe(false);

    const page = extraction.pages[0]!;
    expect(page.pageNumber).toBe(1);
    const joined = page.lines.join('\n');
    expect(joined).toContain('סופרמרקט');
    expect(joined).toContain('12,400.00');
    expect(joined).toContain('תנועות בחשבון');
  });

  test('columns on one baseline become one line with separators', () => {
    const extraction = readPdf(bankStatementPdf());
    const row = extraction.pages[0]!.lines.find((line) => line.includes('סופרמרקט'));
    expect(row).toBeDefined();
    expect(row?.split('\t').length).toBeGreaterThanOrEqual(4);
  });

  test('a scanned page is reported as image-only, not as empty text', () => {
    const extraction = readPdf(scannedPdf());
    expect(extraction.noTextLayer).toBe(true);
    expect(extraction.imageOnlyPages).toEqual([1]);
  });

  test('something that is not a PDF at all is refused', () => {
    expect(() => readPdf(new TextEncoder().encode('%PDF-1.4\nnothing here'))).toThrow(
      MalformedDocumentError,
    );
  });
});

describe('the table detector', () => {
  test('a title block above the header does not become the header', () => {
    const shape = detectTable([
      ['דוח תנועות', '', ''],
      ['לתקופה 01/09/2026 - 30/09/2026', '', ''],
      [],
      ['תאריך', 'תיאור', 'סכום'],
      ['03/09/2026', 'מכולת', '240.50'],
    ]);
    expect(shape?.headerRow).toBe(3);
    expect(shape?.preamble).toHaveLength(3);
  });

  test('value date and posting date stay two different columns', () => {
    const shape = detectTable([['תאריך ערך', 'תאריך חיוב', 'תיאור', 'סכום']]);
    expect(columnFor(shape!, 'value_date')?.index).toBe(0);
    expect(columnFor(shape!, 'posting_date')?.index).toBe(1);
  });

  test('a grid with no recognisable header returns nothing to guess from', () => {
    expect(
      detectTable([
        ['1', '2'],
        ['3', '4'],
      ]),
    ).toBeNull();
  });

  test('an English header is understood too', () => {
    const shape = detectTable([['Date', 'Description', 'Debit', 'Credit', 'Balance']]);
    expect(columnFor(shape!, 'debit')?.index).toBe(2);
    expect(columnFor(shape!, 'credit')?.index).toBe(3);
    expect(columnFor(shape!, 'balance')?.index).toBe(4);
  });
});

describe('the workbook fixture builder produces a real archive', () => {
  test('what the writer writes, the reader reads', () => {
    const bytes = buildXlsx([
      {
        name: 'בדיקה',
        rows: [
          ['תאריך', 'סכום'],
          [dateSerial('2026-01-15'), 12.34],
        ],
      },
    ]);
    const workbook = readWorkbook(bytes);
    expect(workbook.sheetNames).toEqual(['בדיקה']);
    expect(workbook.sheets[0]!.rows[1]!.cells[0]!.value).toMatchObject({
      kind: 'date',
      iso: '2026-01-15',
    });
    expect(workbook.sheets[0]!.rows[1]!.cells[1]!.value).toMatchObject({
      kind: 'number',
      raw: '12.34',
    });
  });
});
