import { deflateRawSync } from 'node:zlib';

/**
 * Writing a ZIP archive.
 *
 * The counterpart to `zip.ts`, and it exists for two reasons that turned out to be
 * the same reason. The product has to *produce* an `.xlsx` — a family exporting a
 * report should get a file their accountant can open — and the import tests have
 * to build workbooks to read, because a test that only exercises a parser against
 * fixtures somebody else generated is testing the fixtures.
 *
 * Everything is deflated and everything is deterministic: the same content always
 * produces the same bytes, so an export can be compared and a fixture can be
 * checked in without churn. That means no timestamps — the DOS date field is
 * fixed, which is a real trade (a file manager shows 1980) taken knowingly in
 * exchange for reproducibility.
 */

export interface ZipFile {
  readonly name: string;
  readonly content: string | Uint8Array;
}

/** CRC-32, the checksum the ZIP format requires. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const encoder = new TextEncoder();

function toBytes(content: string | Uint8Array): Uint8Array {
  return typeof content === 'string' ? encoder.encode(content) : content;
}

function writeU16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}

function writeU32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}

/** A fixed DOS timestamp: 1 January 1980, 00:00. Reproducibility over metadata. */
const DOS_TIME = 0;
const DOS_DATE = 33;

export function writeZip(files: readonly ZipFile[]): Uint8Array {
  const entries = files.map((file) => {
    const raw = toBytes(file.content);
    const compressed = deflateRawSync(raw, { level: 9 });
    return {
      nameBytes: encoder.encode(file.name),
      raw,
      compressed: new Uint8Array(
        compressed.buffer,
        compressed.byteOffset,
        compressed.byteLength,
      ),
      crc: crc32(raw),
    };
  });

  const localSize = entries.reduce(
    (total, entry) => total + 30 + entry.nameBytes.length + entry.compressed.length,
    0,
  );
  const centralSize = entries.reduce((total, entry) => total + 46 + entry.nameBytes.length, 0);

  const out = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(out.buffer);

  let offset = 0;
  const offsets: number[] = [];

  for (const entry of entries) {
    offsets.push(offset);

    writeU32(view, offset, 0x04034b50);
    writeU16(view, offset + 4, 20); // version needed
    writeU16(view, offset + 6, 0x0800); // UTF-8 names
    writeU16(view, offset + 8, 8); // deflate
    writeU16(view, offset + 10, DOS_TIME);
    writeU16(view, offset + 12, DOS_DATE);
    writeU32(view, offset + 14, entry.crc);
    writeU32(view, offset + 18, entry.compressed.length);
    writeU32(view, offset + 22, entry.raw.length);
    writeU16(view, offset + 26, entry.nameBytes.length);
    writeU16(view, offset + 28, 0);

    out.set(entry.nameBytes, offset + 30);
    out.set(entry.compressed, offset + 30 + entry.nameBytes.length);
    offset += 30 + entry.nameBytes.length + entry.compressed.length;
  }

  const centralStart = offset;

  entries.forEach((entry, index) => {
    writeU32(view, offset, 0x02014b50);
    writeU16(view, offset + 4, 20); // version made by
    writeU16(view, offset + 6, 20); // version needed
    writeU16(view, offset + 8, 0x0800);
    writeU16(view, offset + 10, 8);
    writeU16(view, offset + 12, DOS_TIME);
    writeU16(view, offset + 14, DOS_DATE);
    writeU32(view, offset + 16, entry.crc);
    writeU32(view, offset + 20, entry.compressed.length);
    writeU32(view, offset + 24, entry.raw.length);
    writeU16(view, offset + 28, entry.nameBytes.length);
    writeU16(view, offset + 30, 0); // extra
    writeU16(view, offset + 32, 0); // comment
    writeU16(view, offset + 34, 0); // disk
    writeU16(view, offset + 36, 0); // internal attributes
    writeU32(view, offset + 38, 0); // external attributes
    writeU32(view, offset + 42, offsets[index] ?? 0);
    out.set(entry.nameBytes, offset + 46);
    offset += 46 + entry.nameBytes.length;
  });

  writeU32(view, offset, 0x06054b50);
  writeU16(view, offset + 4, 0);
  writeU16(view, offset + 6, 0);
  writeU16(view, offset + 8, entries.length);
  writeU16(view, offset + 10, entries.length);
  writeU32(view, offset + 12, offset - centralStart);
  writeU32(view, offset + 16, centralStart);
  writeU16(view, offset + 20, 0);

  return out;
}
