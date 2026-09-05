import { writeZip } from '../zip-write';

/**
 * Synthetic documents for the import tests.
 *
 * Every fixture here is invented. 07-SECURITY-PRIVACY.md forbids a real financial
 * document in the repository, and a test suite built on one would also be
 * untestable by anyone else. The names, amounts and account numbers are made up;
 * the *shapes* are the real thing — a title block above the header, Hebrew column
 * names, a semicolon separator, a windows-1255 export, a running balance.
 *
 * These builders are test material and are used only by tests. They are kept in
 * `src` rather than beside the tests so that the type checker covers them: a
 * fixture that no longer compiles is a fixture that has quietly stopped matching
 * the parser it exercises.
 */

const encoder = new TextEncoder();

/** A PDF built by hand, with a text layer this project's reader can read. */
export interface PdfFixtureOptions {
  /** Lines of the page, each a list of `[text, x]` pairs on one baseline. */
  readonly pages: readonly (readonly {
    readonly y: number;
    readonly cells: readonly { text: string; x: number }[];
  }[])[];
  /** When true the page carries no text operators at all: a scan. */
  readonly imageOnly?: boolean;
}

/**
 * Encodes text for the fixture font.
 *
 * Latin characters pass through as themselves. Hebrew is assigned sequential byte
 * codes and declared in a `ToUnicode` CMap, which is exactly how a real Hebrew PDF
 * carries its text and is the path the reader has to get right.
 */
class FixtureFont {
  private readonly codes = new Map<string, number>();
  private next = 0x80;

  encode(text: string): string {
    let out = '';
    for (const character of text) {
      const code = character.codePointAt(0) ?? 0;
      if (code >= 0x20 && code < 0x7f) {
        out += escapePdfString(character);
        continue;
      }
      let assigned = this.codes.get(character);
      if (assigned === undefined) {
        assigned = this.next;
        this.next += 1;
        this.codes.set(character, assigned);
      }
      out += `\\${assigned.toString(8).padStart(3, '0')}`;
    }
    return out;
  }

  toUnicodeCMap(): string {
    const entries = [...this.codes.entries()];
    const lines = entries
      .map(
        ([character, code]) =>
          `<${code.toString(16).padStart(2, '0')}> <${(character.codePointAt(0) ?? 0)
            .toString(16)
            .padStart(4, '0')}>`,
      )
      .join('\n');

    return [
      '/CIDInit /ProcSet findresource begin',
      '12 dict begin',
      'begincmap',
      '/CMapName /Fixture def',
      '1 begincodespacerange',
      '<00> <ff>',
      'endcodespacerange',
      `${entries.length} beginbfchar`,
      lines,
      'endbfchar',
      'endcmap',
      'CMapName currentdict /CMap defineresource pop',
      'end',
      'end',
    ].join('\n');
  }
}

function escapePdfString(text: string): string {
  return text.replace(/[\\()]/g, (match) => `\\${match}`);
}

export function buildPdf(options: PdfFixtureOptions): Uint8Array {
  const font = new FixtureFont();

  const contents = options.pages.map((lines) => {
    if (options.imageOnly === true) {
      // A drawn rectangle and nothing else: the shape of a scanned page.
      return '0.9 0.9 0.9 rg\n50 50 500 700 re\nf\n';
    }
    const operations = lines.flatMap((line) =>
      line.cells.map(
        (piece) =>
          `BT /F1 10 Tf 1 0 0 1 ${piece.x} ${line.y} Tm (${font.encode(piece.text)}) Tj ET`,
      ),
    );
    return `${operations.join('\n')}\n`;
  });

  const cmap = font.toUnicodeCMap();

  const objects: string[] = [];
  const pageCount = options.pages.length;

  // 1: catalogue, 2: page tree, 3..: pages, then contents, then font, then CMap.
  const firstPageObject = 3;
  const firstContentObject = firstPageObject + pageCount;
  const fontObject = firstContentObject + pageCount;
  const cmapObject = fontObject + 1;

  objects.push(`<< /Type /Catalog /Pages 2 0 R >>`);
  objects.push(
    `<< /Type /Pages /Count ${pageCount} /Kids [${options.pages
      .map((_page, index) => `${firstPageObject + index} 0 R`)
      .join(' ')}] >>`,
  );

  options.pages.forEach((_page, index) => {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontObject} 0 R >> >> /Contents ${firstContentObject + index} 0 R >>`,
    );
  });

  contents.forEach((content) => {
    objects.push(
      `<< /Length ${encoder.encode(content).length} >>\nstream\n${content}endstream`,
    );
  });

  objects.push(
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /ToUnicode ${cmapObject} 0 R >>`,
  );
  objects.push(`<< /Length ${encoder.encode(cmap).length} >>\nstream\n${cmap}\nendstream`);

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];

  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefStart = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return encoder.encode(body);
}

/** A believable Hebrew bank statement as a text PDF. */
export function bankStatementPdf(): Uint8Array {
  const rows: {
    date: string;
    description: string;
    debit: string;
    credit: string;
    balance: string;
  }[] = [
    {
      date: '03/09/2026',
      description: 'סופרמרקט',
      debit: '412.30',
      credit: '',
      balance: '8,120.40',
    },
    {
      date: '05/09/2026',
      description: 'משכורת',
      debit: '',
      credit: '12,400.00',
      balance: '20,520.40',
    },
    {
      date: '07/09/2026',
      description: 'חשמל',
      debit: '318.00',
      credit: '',
      balance: '20,202.40',
    },
  ];

  const line = (y: number, cells: readonly { text: string; x: number }[]) => ({ y, cells });

  return buildPdf({
    pages: [
      [
        line(780, [{ text: 'בנק לדוגמה - תנועות בחשבון', x: 300 }]),
        line(760, [{ text: 'מספר חשבון 12-345678', x: 300 }]),
        line(730, [
          { text: 'תאריך', x: 60 },
          { text: 'תיאור', x: 140 },
          { text: 'חובה', x: 300 },
          { text: 'זכות', x: 380 },
          { text: 'יתרה', x: 460 },
        ]),
        ...rows.map((row, index) =>
          line(710 - index * 20, [
            { text: row.date, x: 60 },
            { text: row.description, x: 140 },
            { text: row.debit, x: 300 },
            { text: row.credit, x: 380 },
            { text: row.balance, x: 460 },
          ]),
        ),
      ],
    ],
  });
}

/** A page with no text layer at all: the scan case. */
export function scannedPdf(): Uint8Array {
  return buildPdf({ pages: [[]], imageOnly: true });
}

export interface CsvFixtureOptions {
  readonly delimiter?: string;
  readonly encoding?: 'utf-8' | 'windows-1255';
  readonly preamble?: readonly string[];
  readonly header: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

/** windows-1255, so the Hebrew-code-page path is exercised with real bytes. */
function encodeWindows1255(text: string): Uint8Array {
  const out: number[] = [];
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x80) {
      out.push(code);
    } else if (code >= 0x05d0 && code <= 0x05ea) {
      out.push(code - 0x05d0 + 0xe0);
    } else if (code === 0x20aa) {
      out.push(0xa4); // shekel sign
    } else {
      out.push(0x3f); // question mark: the code page has no room for it
    }
  }
  return Uint8Array.from(out);
}

export function buildCsv(options: CsvFixtureOptions): Uint8Array {
  const delimiter = options.delimiter ?? ',';
  const lines = [
    ...(options.preamble ?? []),
    options.header.join(delimiter),
    ...options.rows.map((row) => row.join(delimiter)),
  ];
  const text = `${lines.join('\r\n')}\r\n`;

  return options.encoding === 'windows-1255' ? encodeWindows1255(text) : encoder.encode(text);
}

export interface XlsxFixtureSheet {
  readonly name: string;
  /** Raw cell XML values, already shaped: text goes in as inline strings. */
  readonly rows: readonly (readonly (string | number | { readonly serial: number })[])[];
}

/**
 * A workbook written with the same low-level pieces a real one uses.
 *
 * Deliberately not built through `writeWorkbook`: the import tests must read a
 * file whose structure they did not also write, or a bug that is symmetric
 * between writer and reader would pass. This builder emits shared strings and a
 * date-styled column, which `writeWorkbook` does not.
 */
export function buildXlsx(sheets: readonly XlsxFixtureSheet[]): Uint8Array {
  const shared: string[] = [];
  const sharedIndex = new Map<string, number>();

  const indexOf = (text: string): number => {
    const existing = sharedIndex.get(text);
    if (existing !== undefined) return existing;
    const index = shared.length;
    shared.push(text);
    sharedIndex.set(text, index);
    return index;
  };

  const escape = (text: string) =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const columnName = (index: number): string => {
    let name = '';
    let remaining = index;
    for (;;) {
      name = String.fromCharCode(65 + (remaining % 26)) + name;
      remaining = Math.floor(remaining / 26) - 1;
      if (remaining < 0) break;
    }
    return name;
  };

  const sheetXml = (sheet: XlsxFixtureSheet) => {
    const rows = sheet.rows
      .map((row, rowIndex) => {
        const cells = row
          .map((value, columnIndex) => {
            const reference = `${columnName(columnIndex)}${rowIndex + 1}`;
            if (typeof value === 'string') {
              if (value === '') return '';
              return `<c r="${reference}" t="s"><v>${indexOf(value)}</v></c>`;
            }
            if (typeof value === 'number') {
              return `<c r="${reference}"><v>${value}</v></c>`;
            }
            return `<c r="${reference}" s="1"><v>${value.serial}</v></c>`;
          })
          .join('');
        return `<row r="${rowIndex + 1}">${cells}</row>`;
      })
      .join('');
    return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
  };

  const sheetParts = sheets.map((sheet) => sheetXml(sheet));

  const sharedStrings = `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">${shared
    .map((text) => `<si><t>${escape(text)}</t></si>`)
    .join('')}</sst>`;

  const styles = `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/></cellXfs></styleSheet>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
    .map(
      (sheet, index) =>
        `<sheet name="${escape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
    )
    .join('')}</sheets></workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
    .map(
      (_sheet, index) =>
        `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
    )
    .join(
      '',
    )}<Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rIdY" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>`;

  return writeZip([
    { name: '[Content_Types].xml', content: contentTypes },
    {
      name: '_rels/.rels',
      content: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    { name: 'xl/workbook.xml', content: workbook },
    { name: 'xl/_rels/workbook.xml.rels', content: workbookRels },
    { name: 'xl/sharedStrings.xml', content: sharedStrings },
    { name: 'xl/styles.xml', content: styles },
    ...sheetParts.map((part, index) => ({
      name: `xl/worksheets/sheet${index + 1}.xml`,
      content: part,
    })),
  ]);
}

/** A calendar date as the serial number a workbook stores. */
export function dateSerial(isoDate: string): { serial: number } {
  const parsed = Date.parse(`${isoDate}T00:00:00Z`);
  return { serial: Math.round(parsed / 86_400_000) + 25_569 };
}

/** A workbook shaped like a household expense sheet, with a title block above. */
export function householdExpensesXlsx(): Uint8Array {
  return buildXlsx([
    {
      name: 'הוצאות',
      rows: [
        ['גיליון הוצאות הבית', '', '', ''],
        ['ספטמבר 2026', '', '', ''],
        ['', '', '', ''],
        ['תאריך', 'תיאור', 'סכום', 'קטגוריה'],
        [dateSerial('2026-09-02'), 'שוק', 240.5, 'מזון'],
        [dateSerial('2026-09-04'), 'דלק', 320, 'תחבורה ודלק'],
        [dateSerial('2026-09-06'), 'ארנונה', 610.25, 'דיור וחשבונות'],
        ['סה"כ', '', 1170.75, ''],
      ],
    },
  ]);
}
