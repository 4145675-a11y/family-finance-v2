import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, test } from 'vitest';

/**
 * The persistence boundary, checked against the source (ADR-0032 §5–6).
 *
 * Three statements, each of which would fail silently at runtime if it stopped
 * being true, so they are checked here where a failure is loud:
 *
 *   1. The Supabase-backed store never touches a file. Its package imports
 *      nothing from the file store, the paths module, or node:fs.
 *   2. The application reaches the file store through one module only,
 *      lib/store/server.ts — plus the local authentication file, whose own
 *      module refuses to open it under the database backend.
 *   3. No client component imports the store or the persistence package.
 */

const WEB_ROOT = join(import.meta.dirname, '..', '..');
const REPO_ROOT = join(WEB_ROOT, '..', '..');

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === 'node_modules' || entry === '.next') continue;
    if (statSync(full).isDirectory()) sources(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe('the Supabase-backed store is file-free', () => {
  const files = sources(join(REPO_ROOT, 'packages', 'household-store', 'src'));

  test('the package has sources', () => {
    expect(files.length).toBeGreaterThan(3);
  });

  test.each(files.map((f) => relative(REPO_ROOT, f)))('%s imports no file access', (file) => {
    const text = readFileSync(join(REPO_ROOT, file), 'utf8');
    expect(text).not.toMatch(/from ['"]node:fs/);
    expect(text).not.toMatch(/from ['"]fs['"]/);
    expect(text).not.toMatch(/\bFileStore\b/);
    expect(text).not.toMatch(/\bresolveStorePaths\b/);
    expect(text).not.toMatch(/\bsafeJoin\b/);
  });
});

describe('the application reaches the file store through one door', () => {
  const files = sources(join(WEB_ROOT, 'app')).concat(
    sources(join(WEB_ROOT, 'lib')),
    sources(join(WEB_ROOT, 'components')),
  );
  const allowed = new Set(['lib/store/server.ts', 'lib/auth/store.ts']);

  test.each(files.map((f) => relative(WEB_ROOT, f).replace(/\\/g, '/')))(
    '%s does not construct the file store',
    (file) => {
      if (allowed.has(file)) return;
      const text = readFileSync(join(WEB_ROOT, file), 'utf8');
      expect(text).not.toMatch(/new HouseholdStore\(/);
      expect(text).not.toMatch(/\bresolveStorePaths\b/);
      expect(text).not.toMatch(/\bFileStore\b/);
    },
  );

  test('a client component never imports the store or the persistence package', () => {
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      if (!/^['"]use client['"]/m.test(text)) continue;
      expect(text, relative(WEB_ROOT, file)).not.toMatch(/lib\/store\/server/);
      expect(text, relative(WEB_ROOT, file)).not.toMatch(/@family-finance\/household-store/);
      expect(text, relative(WEB_ROOT, file)).not.toMatch(/lib\/supabase\/server/);
    }
  });
});
