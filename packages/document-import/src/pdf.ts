import { Deadline, MalformedDocumentError } from './limits';
import { PdfDocument } from './pdf-objects';
import { extractPages, type PdfPageText } from './pdf-text';

/**
 * The public face of PDF reading, and the place where its limits are stated.
 *
 * This reader extracts a *text layer*. When a bank produced the PDF from its own
 * records, that layer is there and the numbers come out exactly. When somebody
 * photographed or scanned a paper statement, there is no text layer at all — the
 * page is a picture of letters — and no amount of parsing will produce one.
 *
 * The product's answer to that second case is to say so. `imageOnly` is reported
 * per page and surfaced in Hebrew on the review screen, alongside the two things
 * that actually help: enter the figures by hand, or fetch the searchable version
 * from the bank's site. Optical character recognition is a separate capability
 * behind `OcrProvider`, which is deliberately left unimplemented locally rather
 * than filled with something that pretends to read a page.
 */

export interface PdfExtraction {
  readonly pages: readonly PdfPageText[];
  readonly pageCount: number;
  /** Pages that carried no text at all. */
  readonly imageOnlyPages: readonly number[];
  /** True when no page in the document produced a single character. */
  readonly noTextLayer: boolean;
}

/**
 * The seam a cloud OCR service would attach to.
 *
 * Written now, implemented never locally: 07-SECURITY-PRIVACY.md forbids sending a
 * family's financial document to an outside service, and there is no offline
 * engine inside this project's dependency policy. The interface exists so that
 * connecting one later is a configuration change rather than a rewrite of the
 * import pipeline, and so the unavailable state has something concrete to name.
 */
export interface OcrProvider {
  readonly name: string;
  /** Whether the provider is configured and permitted to run. */
  available(): boolean;
  recognise(page: Uint8Array): Promise<string>;
}

/**
 * The only OCR provider that ships.
 *
 * It does not stand in for a working one. It reports itself unavailable and
 * refuses to be called, so nothing downstream can mistake an empty result for a
 * recognised page.
 */
export const unavailableOcrProvider: OcrProvider = {
  name: 'none',
  available: () => false,
  recognise: () =>
    Promise.reject(
      new Error('no OCR provider is configured; image-only pages are not read locally'),
    ),
};

export function readPdf(bytes: Uint8Array, deadline = new Deadline()): PdfExtraction {
  const document = PdfDocument.parse(bytes, deadline);

  if (document.encrypted) {
    throw new MalformedDocumentError(
      'encrypted_file',
      'the document is protected, so its contents cannot be read',
    );
  }

  const pages = extractPages(document, deadline);

  if (pages.length === 0) {
    throw new MalformedDocumentError(
      'malformed_document',
      'the document has no readable pages',
    );
  }

  const imageOnlyPages = pages.filter((page) => page.imageOnly).map((page) => page.pageNumber);

  return {
    pages,
    pageCount: pages.length,
    imageOnlyPages,
    noTextLayer: imageOnlyPages.length === pages.length,
  };
}

export type { PdfPageText, TextRun } from './pdf-text';
