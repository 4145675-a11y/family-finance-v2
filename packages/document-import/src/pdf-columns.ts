import type { TextRun } from './pdf-text';

/**
 * Putting a drawn table back into columns.
 *
 * A PDF has no cells. It has glyphs at positions, and a table is a visual
 * arrangement of them. The naive reconstruction — sort a line's runs left to
 * right and treat that sequence as the columns — is wrong the first time a cell
 * is empty, because an empty cell draws nothing and every run after it shifts one
 * column to the left.
 *
 * That failure is not cosmetic. On a bank statement with separate debit and
 * credit columns, a salary row has an empty debit cell, so the credit figure
 * slides into the debit position and an income of twelve thousand shekels is read
 * as an expense of twelve thousand shekels. The direction is inverted, silently,
 * and every total after it is wrong by twice the amount.
 *
 * So columns are found from the page, not from each row: every run's horizontal
 * position across the whole table is gathered, positions that cluster together
 * are one column, and each run is placed in the column it actually sits in.
 * A column with no run in a given row stays empty, which is what it is.
 */

export interface PositionedCell {
  readonly text: string;
  readonly x: number;
  readonly endX: number;
}

export interface PositionedLine {
  readonly y: number;
  readonly cells: readonly PositionedCell[];
}

/**
 * Groups runs into lines by baseline, and merges runs that touch.
 *
 * Two runs on the same baseline separated by less than a space belong to the same
 * cell — a PDF frequently splits one word across several show operations.
 */
export function toPositionedLines(runs: readonly TextRun[]): PositionedLine[] {
  if (runs.length === 0) return [];

  const sorted = [...runs].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: PositionedLine[] = [];

  let current: TextRun[] = [];
  let currentY = sorted[0]?.y ?? 0;

  const flush = () => {
    if (current.length === 0) return;
    const ordered = [...current].sort((a, b) => a.x - b.x);
    const cells: PositionedCell[] = [];

    for (const run of ordered) {
      const previous = cells[cells.length - 1];
      const gap = previous === undefined ? Number.POSITIVE_INFINITY : run.x - previous.endX;

      // A gap under roughly one space is the same cell continuing.
      if (previous !== undefined && gap < run.fontSize * 0.9) {
        cells[cells.length - 1] = {
          text:
            gap > run.fontSize * 0.15
              ? `${previous.text} ${run.text}`
              : previous.text + run.text,
          x: previous.x,
          endX: run.x + run.width,
        };
        continue;
      }

      cells.push({ text: run.text, x: run.x, endX: run.x + run.width });
    }

    lines.push({
      y: currentY,
      cells: cells
        .map((cell) => ({ ...cell, text: cell.text.trim() }))
        .filter((cell) => cell.text.length > 0),
    });
    current = [];
  };

  for (const run of sorted) {
    const tolerance = Math.max(1.5, run.fontSize * 0.4);
    if (Math.abs(run.y - currentY) > tolerance) {
      flush();
      currentY = run.y;
    }
    current.push(run);
  }
  flush();

  return lines.filter((line) => line.cells.length > 0);
}

/**
 * The horizontal bands the page's cells fall into.
 *
 * Found by sorting every cell's left edge and splitting where the gap between
 * consecutive positions is larger than the typical spread inside one column. A
 * table drawn at fixed positions produces tight clusters; prose produces one wide
 * band, which is the correct answer for prose.
 */
export function findColumns(lines: readonly PositionedLine[]): number[] {
  const positions = lines
    .flatMap((line) => line.cells.map((cell) => cell.x))
    .sort((a, b) => a - b);

  if (positions.length === 0) return [];

  // Columns are tens of points apart; runs inside one are within a few.
  const TOLERANCE = 8;

  const bands: number[] = [];
  let group: number[] = [positions[0] ?? 0];

  for (let index = 1; index < positions.length; index += 1) {
    const position = positions[index] ?? 0;
    const previous = positions[index - 1] ?? 0;
    if (position - previous > TOLERANCE) {
      bands.push(group.reduce((sum, value) => sum + value, 0) / group.length);
      group = [];
    }
    group.push(position);
  }
  if (group.length > 0) bands.push(group.reduce((sum, value) => sum + value, 0) / group.length);

  return bands;
}

/**
 * Places every line's cells into the page's columns.
 *
 * A cell goes to the nearest band. A band with no cell on that line stays empty —
 * which is the whole point: an empty debit cell must remain an empty debit cell
 * rather than letting the credit figure take its place.
 */
export function toColumnGrid(lines: readonly PositionedLine[]): string[][] {
  const bands = findColumns(lines);
  if (bands.length === 0) return [];

  return lines.map((line) => {
    const row = Array.from({ length: bands.length }, () => '');

    for (const cell of line.cells) {
      let nearest = 0;
      let distance = Number.POSITIVE_INFINITY;
      for (let index = 0; index < bands.length; index += 1) {
        const candidate = Math.abs((bands[index] ?? 0) - cell.x);
        if (candidate < distance) {
          distance = candidate;
          nearest = index;
        }
      }
      // Two cells landing in one band means the layout is not a table there;
      // keeping both, separated, is better than dropping one.
      row[nearest] = row[nearest] === '' ? cell.text : `${row[nearest]} ${cell.text}`;
    }

    return row;
  });
}
