/**
 * Row-shape conversions between the database (snake_case columns, PostgreSQL
 * timestamp text) and the contracts (camelCase, ISO-8601 in UTC with
 * milliseconds — the shape `toISOString()` writes and every local document
 * already carries).
 *
 * Only the top level of a row is converted. Nested JSON payloads — an import
 * proposal's raw cells, its proposed record, a batch summary — are the
 * family's data as the parser produced it and pass through untouched: a
 * spreadsheet cell that happens to look like a timestamp must not be rewritten.
 */

export type JsonRow = Record<string, unknown>;

const TIMESTAMP_TEXT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function camelCase(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

export function snakeCase(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/** PostgreSQL emits `2026-09-14T17:08:25.123456+00:00`; the contracts want `…Z` with milliseconds. */
export function normaliseTimestamp(value: unknown): unknown {
  if (typeof value === 'string' && TIMESTAMP_TEXT.test(value)) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }
  return value;
}

/** Database row → contract-shaped object. Keys converted, timestamps normalised, nothing nested touched. */
export function rowToCamel(
  row: JsonRow,
  passThrough: ReadonlySet<string> = new Set(),
): JsonRow {
  const out: JsonRow = {};
  for (const [key, value] of Object.entries(row)) {
    out[camelCase(key)] = passThrough.has(key) ? value : normaliseTimestamp(value);
  }
  return out;
}

/** Contract-shaped object → database row. Keys converted; values as they are. */
export function rowToSnake(row: JsonRow): JsonRow {
  const out: JsonRow = {};
  for (const [key, value] of Object.entries(row)) {
    out[snakeCase(key)] = value;
  }
  return out;
}

/** Deterministic text for equality: keys sorted at every level. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as JsonRow)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(',')}}`;
}
