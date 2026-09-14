import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Loads the integration suite's local connection string.
 *
 * The isolation tests have always told a reader to put `SUPABASE_DB_URL` in
 * `.env.integration.local` and run `npm run integration`. Nothing actually read
 * that file, so following the instructions produced the same failure as not
 * following them — a gap that only appears the first time somebody has a
 * database to point at, which is exactly when it is most confusing.
 *
 * Two rules this file keeps:
 *
 *   1. **A value already in the environment wins.** CI supplies the connection
 *      string directly; a file on a developer's disk must not override it.
 *   2. **Nothing is ever printed.** Not the value, not a prefix, not a length.
 *      A connection string carries the database password, and a test log is one
 *      of the easiest places for it to end up.
 *
 * The file is git-ignored by `.env.*`. It is never committed, never read by the
 * application, and never sent anywhere.
 */

const ENV_FILE = fileURLToPath(new URL('../../.env.integration.local', import.meta.url));

/**
 * Parses `KEY=VALUE` lines.
 *
 * Deliberately small: comments, blank lines, `export` prefixes and surrounding
 * quotes, and nothing else. A connection string can contain `=` in its query
 * string, so only the first separator splits the line.
 */
function parse(contents: string): Map<string, string> {
  const values = new Map<string, string>();

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^export\s+/, '');
    if (line === '' || line.startsWith('#')) continue;

    const separator = line.indexOf('=');
    if (separator <= 0) continue;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }

    if (key !== '') values.set(key, value);
  }

  return values;
}

if (existsSync(ENV_FILE)) {
  for (const [key, value] of parse(readFileSync(ENV_FILE, 'utf8'))) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
