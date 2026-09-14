/**
 * Guards for the hand-applied SQL in supabase/manual/.
 *
 * These two files are pasted into a production database by a human. Everything
 * that can be proven about them before that happens, is proven here:
 *
 *  * the diagnostic changes nothing;
 *  *  * the bundle is exactly the migrations, in order, with nothing added,
 *    dropped or reordered;
 *  * the bundle is atomic and re-runnable.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import {
  readMigrations,
  renderBundle,
  beginMarker,
  endMarker,
} from './build-manual-bundle.mjs';
import { findMutations, isReadOnly, stripLiteralsAndComments } from './sql-guard.mjs';

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const MANUAL_DIR = join(REPO_ROOT, 'supabase', 'manual');
const DIAGNOSTIC_PATH = join(MANUAL_DIR, 'diagnostic.sql');
const BUNDLE_PATH = join(MANUAL_DIR, 'apply-all.sql');

const diagnostic = readFileSync(DIAGNOSTIC_PATH, 'utf8');
const bundle = readFileSync(BUNDLE_PATH, 'utf8');
const migrations = readMigrations();

describe('the diagnostic is read-only', () => {
  test('the file exists', () => {
    expect(existsSync(DIAGNOSTIC_PATH)).toBe(true);
  });

  test('contains no mutating keyword or writing function', () => {
    const mutations = findMutations(diagnostic);
    expect(
      mutations,
      `found: ${mutations.map((m) => `${m.kind} ${m.token}`).join(', ')}`,
    ).toEqual([]);
  });

  test.each([
    'insert',
    'update',
    'delete',
    'truncate',
    'create',
    'alter',
    'drop',
    'grant',
    'revoke',
  ])('contains no %s statement', (keyword) => {
    const bare = stripLiteralsAndComments(diagnostic).toLowerCase();
    expect(new RegExp(`(^|[\\s;(])${keyword}[\\s(]`, 'm').test(bare)).toBe(false);
  });

  test('labels that merely mention table or trigger are not mistaken for statements', () => {
    // The diagnostic prints rows such as 'table: profiles'. If the guard scanned
    // raw text these would be false positives, and a real check would be diluted
    // to make them pass.
    expect(diagnostic).toContain("'table: profiles'");
    expect(isReadOnly(diagnostic)).toBe(true);
  });

  test('the guard is not vacuous: it does flag a mutating statement', () => {
    expect(isReadOnly('select 1; drop table public.profiles;')).toBe(false);
    expect(isReadOnly('select 1; insert into t values (1);')).toBe(false);
    expect(isReadOnly('select public.accept_household_invitation($1);')).toBe(false);
  });

  test('is a single select statement', () => {
    const bare = stripLiteralsAndComments(diagnostic).trim();
    expect(bare.toLowerCase().startsWith('select')).toBe(true);
    expect(bare.replace(/;\s*$/, '').includes(';')).toBe(false);
  });
});

describe('the bundle is exactly the migrations', () => {
  test('is up to date with supabase/migrations', () => {
    expect(bundle, 'the bundle drifted from its sources. Run: npm run db:build').toBe(
      renderBundle(migrations),
    );
  });

  test('embeds every migration, and only those', () => {
    const embedded = [...bundle.matchAll(/^-- >>> BEGIN MIGRATION: (.+)$/gm)].map((m) => m[1]);
    expect(embedded).toEqual(migrations.map((m) => m.name));
  });

  test('embeds them in filename order', () => {
    const embedded = [...bundle.matchAll(/^-- >>> BEGIN MIGRATION: (.+)$/gm)].map((m) => m[1]);
    expect(embedded).toEqual([...embedded].sort());
  });

  test.each(migrations.map((m) => m.name))(
    '%s is reproduced verbatim, nothing added or removed',
    (name) => {
      const { sql } = migrations.find((m) => m.name === name);
      const start = bundle.indexOf(beginMarker(name));
      const end = bundle.indexOf(endMarker(name));
      expect(start, `${name}: begin marker missing`).toBeGreaterThanOrEqual(0);
      expect(end, `${name}: end marker missing`).toBeGreaterThan(start);

      const embedded = bundle.slice(start + beginMarker(name).length, end).trim();
      expect(embedded).toBe(sql.trim());
    },
  );

  test('every statement of every migration survives into the bundle', () => {
    // Line-level completeness, independent of the marker extraction above.
    for (const { name, sql } of migrations) {
      const statements = sql
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('--'));
      for (const statement of statements) {
        expect(bundle, `${name}: missing line ${JSON.stringify(statement)}`).toContain(
          statement,
        );
      }
    }
  });

  test('adds nothing executable beyond the transaction wrapper', () => {
    const wrapperLines = bundle
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('--'));

    const migrationLines = new Set(
      migrations.flatMap(({ sql }) =>
        sql
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line.length > 0 && !line.startsWith('--')),
      ),
    );

    const extra = wrapperLines.filter((line) => !migrationLines.has(line));
    expect(extra, 'only begin; and commit; may be added').toEqual(['begin;', 'commit;']);
  });
});

describe('the bundle is atomic', () => {
  test('opens exactly one transaction and commits it once', () => {
    expect((bundle.match(/^begin;$/gm) ?? []).length).toBe(1);
    expect((bundle.match(/^commit;$/gm) ?? []).length).toBe(1);
  });

  test('begin comes before all migration content and commit after all of it', () => {
    const beginIndex = bundle.indexOf('\nbegin;');
    const commitIndex = bundle.lastIndexOf('\ncommit;');
    const firstMigration = bundle.indexOf('-- >>> BEGIN MIGRATION:');
    const lastMigrationEnd = bundle.lastIndexOf('-- <<< END MIGRATION:');

    expect(beginIndex).toBeLessThan(firstMigration);
    expect(commitIndex).toBeGreaterThan(lastMigrationEnd);
  });

  test('contains no intermediate commit or rollback that would break atomicity', () => {
    const inner = bundle.slice(
      bundle.indexOf('-- >>> BEGIN MIGRATION:'),
      bundle.lastIndexOf('-- <<< END MIGRATION:'),
    );
    expect(/^\s*commit;/m.test(inner)).toBe(false);
    expect(/^\s*rollback;/m.test(inner)).toBe(false);
    expect(/^\s*begin;/m.test(inner)).toBe(false);
  });

  test('contains nothing that cannot run inside a transaction block', () => {
    // CREATE INDEX CONCURRENTLY, VACUUM and CREATE DATABASE cannot be wrapped.
    // If one ever appears, the single-transaction promise silently becomes false.
    const bare = stripLiteralsAndComments(bundle).toLowerCase();
    for (const forbidden of ['concurrently', 'vacuum', 'create database', 'alter system']) {
      expect(bare, `${forbidden} cannot run inside a transaction`).not.toContain(forbidden);
    }
  });
});

describe('the bundle is safe to re-run over an existing schema', () => {
  test('every trigger is dropped before it is created', () => {
    const created = [...bundle.matchAll(/^create trigger (\w+)/gim)].map((m) => m[1]);
    expect(created.length).toBeGreaterThan(0);
    for (const trigger of created) {
      const dropIndex = bundle.indexOf(`drop trigger if exists ${trigger}`);
      const createIndex = bundle.indexOf(`create trigger ${trigger}`);
      expect(dropIndex, `${trigger} has no drop`).toBeGreaterThanOrEqual(0);
      expect(dropIndex, `${trigger}: drop must precede create`).toBeLessThan(createIndex);
    }
  });

  test('every policy is dropped before it is created', () => {
    const created = [...bundle.matchAll(/^create policy (\w+)/gim)].map((m) => m[1]);
    expect(created.length).toBeGreaterThanOrEqual(11);
    for (const policy of created) {
      const dropIndex = bundle.indexOf(`drop policy if exists ${policy}`);
      const createIndex = bundle.indexOf(`create policy ${policy}`);
      expect(dropIndex, `${policy} has no drop`).toBeGreaterThanOrEqual(0);
      expect(dropIndex, `${policy}: drop must precede create`).toBeLessThan(createIndex);
    }
  });

  test('tables, indexes and extensions are guarded', () => {
    expect(/^create table (?!if not exists)/gim.test(bundle)).toBe(false);
    expect(/^create index (?!if not exists)/gim.test(bundle)).toBe(false);
    expect(/^create extension (?!if not exists)/gim.test(bundle)).toBe(false);
  });

  test('no bare CREATE TYPE; the enum is created under a check', () => {
    expect(/^create type /gim.test(bundle)).toBe(false);
    expect(bundle).toMatch(/if not exists \(\s*select 1\s*from pg_type/i);
  });

  test('no object is defined twice across the bundle', () => {
    for (const pattern of [/^create trigger (\w+)/gim, /^create policy (\w+)/gim]) {
      const names = [...bundle.matchAll(pattern)].map((m) => m[1]);
      const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
      expect(duplicates, `defined more than once: ${duplicates.join(', ')}`).toEqual([]);
    }
  });
});
