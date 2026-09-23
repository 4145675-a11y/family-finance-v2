/**
 * Migration re-runnability guard (ADR-0015).
 *
 * A migration that fails when applied twice turns any mistake — a partial run, a
 * duplicated paste, a retry after a network drop — into a confusing error that
 * looks like a schema problem but is not one. The first manual application of
 * Milestone 2 hit exactly that: `create trigger` has no IF NOT EXISTS, so
 * re-running a file failed with 42710 and the real cause (editor buffer holding
 * two files) was invisible in the message.
 *
 * PostgreSQL offers IF NOT EXISTS for tables, indexes and extensions, but not for
 * triggers, policies or types. Those need an explicit drop-then-create, or a
 * guarded DO block. This test asserts every one of them has it.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

const MIGRATIONS_DIR = fileURLToPath(new URL('../supabase/migrations/', import.meta.url));

/** @returns {{name: string, sql: string}[]} in application order */
function migrations() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS_DIR, name), 'utf8') }));
}

const files = migrations();

describe('migration files', () => {
  test('at least one migration exists', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  test('every filename carries a sortable timestamp prefix', () => {
    for (const { name } of files) {
      expect(name, `${name} must start with a 14-digit timestamp`).toMatch(
        /^\d{14}_[a-z0-9_]+\.sql$/,
      );
    }
  });

  test('timestamp prefixes are unique, so application order is unambiguous', () => {
    const prefixes = files.map(({ name }) => name.slice(0, 14));
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });
});

describe('triggers are re-runnable', () => {
  const triggers = files.flatMap(({ name, sql }) =>
    [
      ...sql.matchAll(
        /^create trigger (\w+)\s*\n\s*(?:before|after|instead of)[^\n]*\n\s*on ([\w.]+)|^create trigger (\w+)\s*\n\s*(?:before|after)[^\n]*on ([\w.]+)/gim,
      ),
    ].map((match) => ({ file: name, trigger: match[1] ?? match[3] })),
  );

  test('the suite actually found the triggers it means to check', () => {
    // Guards against a regex that silently matches nothing and passes vacuously.
    const created = files.reduce(
      (total, { sql }) => total + (sql.match(/^create trigger /gim) ?? []).length,
      0,
    );
    expect(created).toBeGreaterThan(0);
    expect(triggers.length, 'every CREATE TRIGGER must be parsed by this test').toBe(created);
  });

  test.each(files.map(({ name }) => name))(
    '%s drops each trigger before creating it',
    (name) => {
      const { sql } = files.find((f) => f.name === name);
      const created = [...sql.matchAll(/^create trigger (\w+)/gim)].map((m) => m[1]);
      const dropped = [...sql.matchAll(/^drop trigger if exists (\w+)/gim)].map((m) => m[1]);

      for (const trigger of created) {
        expect(
          dropped,
          `${name}: "create trigger ${trigger}" needs a preceding "drop trigger if exists ${trigger}". PostgreSQL has no CREATE TRIGGER IF NOT EXISTS, so without it the file cannot be applied twice.`,
        ).toContain(trigger);
      }
    },
  );

  test('each drop precedes its create', () => {
    for (const { name, sql } of files) {
      for (const match of sql.matchAll(/^create trigger (\w+)/gim)) {
        const trigger = match[1];
        const dropIndex = sql.indexOf(`drop trigger if exists ${trigger}`);
        expect(dropIndex, `${name}: drop for ${trigger} is missing`).toBeGreaterThanOrEqual(0);
        expect(
          dropIndex,
          `${name}: drop for ${trigger} must come before its create`,
        ).toBeLessThan(match.index);
      }
    }
  });
});

describe('policies are re-runnable', () => {
  test.each(files.map(({ name }) => name))(
    '%s drops each policy before creating it',
    (name) => {
      const { sql } = files.find((f) => f.name === name);
      const created = [...sql.matchAll(/^create policy (\w+)/gim)].map((m) => m[1]);
      const dropped = [...sql.matchAll(/^drop policy if exists (\w+)/gim)].map((m) => m[1]);

      for (const policy of created) {
        expect(
          dropped,
          `${name}: "create policy ${policy}" needs a preceding "drop policy if exists ${policy}".`,
        ).toContain(policy);
      }
    },
  );

  test('the RLS migration defines the policies this milestone relies on', () => {
    const rls = files.find((f) => f.name.includes('rls_policies'));
    expect(rls, 'an RLS migration must exist').toBeTruthy();
    const created = [...rls.sql.matchAll(/^create policy (\w+)/gim)].map((m) => m[1]);
    expect(created.length).toBeGreaterThanOrEqual(11);
    // The absence of an INSERT policy here is a security decision (ADR-0014),
    // not an omission: joining a household goes through the invitation function.
    expect(created).not.toContain('household_members_insert');
  });
});

describe('types are created under a guard', () => {
  test('no bare CREATE TYPE at the start of a line', () => {
    for (const { name, sql } of files) {
      const bare = [...sql.matchAll(/^create type /gim)];
      expect(
        bare.length,
        `${name}: CREATE TYPE has no IF NOT EXISTS. Wrap it in a DO block that checks pg_type first.`,
      ).toBe(0);
    }
  });

  test('the membership enum is created inside an existence check', () => {
    const withEnum = files.find(({ sql }) => sql.includes('membership_status'));
    expect(withEnum).toBeTruthy();
    expect(withEnum.sql).toMatch(/do \$\$[\s\S]*membership_status[\s\S]*\$\$;/i);
    expect(withEnum.sql).toMatch(/if not exists \(\s*select 1\s*from pg_type/i);
  });
});

describe('objects are defined once across the whole migration set', () => {
  /** @param {RegExp} pattern */
  function definitionsOf(pattern) {
    /** @type {Map<string, string[]>} */
    const byName = new Map();
    for (const { name, sql } of files) {
      for (const match of sql.matchAll(pattern)) {
        const object = match[1];
        byName.set(object, [...(byName.get(object) ?? []), name]);
      }
    }
    return byName;
  }

  test('no trigger is created in two different files', () => {
    for (const [trigger, inFiles] of definitionsOf(/^create trigger (\w+)/gim)) {
      expect(inFiles, `trigger ${trigger} is created in ${inFiles.join(' and ')}`).toHaveLength(
        1,
      );
    }
  });

  test('no policy is created in two different files', () => {
    for (const [policy, inFiles] of definitionsOf(/^create policy (\w+)/gim)) {
      expect(inFiles, `policy ${policy} is created in ${inFiles.join(' and ')}`).toHaveLength(
        1,
      );
    }
  });

  test('no table is created in two different files', () => {
    for (const [table, inFiles] of definitionsOf(/^create table if not exists ([\w.]+)/gim)) {
      expect(inFiles, `table ${table} is created in ${inFiles.join(' and ')}`).toHaveLength(1);
    }
  });

  test('profiles_touch_updated_at belongs to exactly one migration', () => {
    // The concrete object from the failed manual application. It is defined in
    // the profiles/households migration and must never appear anywhere else.
    const owners = files.filter(({ sql }) =>
      sql.includes('create trigger profiles_touch_updated_at'),
    );
    expect(owners).toHaveLength(1);
    expect(owners[0].name).toContain('profiles_households');
  });
});

describe('tables and indexes use the IF NOT EXISTS that PostgreSQL does offer', () => {
  test('every CREATE TABLE is guarded', () => {
    for (const { name, sql } of files) {
      const unguarded = [...sql.matchAll(/^create table (?!if not exists)/gim)];
      expect(unguarded.length, `${name}: use CREATE TABLE IF NOT EXISTS`).toBe(0);
    }
  });

  test('every CREATE INDEX is guarded', () => {
    for (const { name, sql } of files) {
      const unguarded = [...sql.matchAll(/^create index (?!if not exists)/gim)];
      expect(unguarded.length, `${name}: use CREATE INDEX IF NOT EXISTS`).toBe(0);
    }
  });

  test('functions use CREATE OR REPLACE', () => {
    for (const { name, sql } of files) {
      const unguarded = [...sql.matchAll(/^create function /gim)];
      expect(unguarded.length, `${name}: use CREATE OR REPLACE FUNCTION`).toBe(0);
    }
  });
});

describe('enumerations are created under an existence check', () => {
  test('every enum a migration creates names itself in a pg_type guard', () => {
    for (const { name, sql } of files) {
      const created = [...sql.matchAll(/create type public\.(\w+) as enum/gi)].map((m) => m[1]);
      expect(
        created.length,
        `${name}: expected at least one enum or none at all`,
      ).toBeGreaterThanOrEqual(0);
      for (const type of created) {
        expect(
          sql,
          `${name}: create type public.${type} needs a guard that checks pg_type for '${type}'`,
        ).toContain(`t.typname = '${type}'`);
      }
    }
  });
});

describe('constraint triggers are re-runnable too', () => {
  test('each CREATE CONSTRAINT TRIGGER has a preceding drop', () => {
    for (const { name, sql } of files) {
      for (const match of sql.matchAll(/^create constraint trigger (\w+)/gim)) {
        const trigger = match[1];
        const dropIndex = sql.indexOf(`drop trigger if exists ${trigger}`);
        expect(
          dropIndex,
          `${name}: constraint trigger ${trigger} needs "drop trigger if exists ${trigger}" before it`,
        ).toBeGreaterThanOrEqual(0);
        expect(dropIndex).toBeLessThan(match.index);
      }
    }
  });
});

describe('every table is protected by row level security', () => {
  const allSql = files.map((f) => f.sql).join('\n');
  const tables = [
    ...new Set(
      [...allSql.matchAll(/^create table if not exists (public\.\w+)/gim)].map((m) => m[1]),
    ),
  ];

  test('the suite found the tables it means to check', () => {
    // A regex that matches nothing would make every assertion below vacuous.
    expect(tables.length).toBeGreaterThanOrEqual(12);
  });

  test.each(tables)('%s has RLS enabled', (table) => {
    expect(allSql).toContain(`alter table ${table} enable row level security`);
  });

  test.each(tables)('%s has RLS forced, so the owner is subject to policy too', (table) => {
    expect(allSql).toContain(`alter table ${table} force row level security`);
  });

  test.each(tables)('%s has at least one policy', (table) => {
    const bare = table.replace('public.', '');
    const policies = [
      ...allSql.matchAll(/create policy (\w+)\s*\n\s*on (public\.\w+)/gim),
    ].filter(([, , on]) => on === table);
    expect(
      policies.length,
      `${bare} has no policy, so it is closed by accident rather than by design`,
    ).toBeGreaterThan(0);
  });
});

describe('money rows are never deleted', () => {
  const allSql = files.map((f) => f.sql).join('\n');

  test('transaction_splits is the only table with a DELETE policy', () => {
    const deletePolicies = [
      ...allSql.matchAll(/create policy (\w+)\s*\n\s*on (public\.\w+)\s*\n\s*for delete/gim),
    ].map((m) => m[2]);
    expect(deletePolicies).toEqual(['public.transaction_splits']);
  });

  test('no DELETE grant reaches a money table', () => {
    const grants = [...allSql.matchAll(/^grant ([^)]+?) on (public\.\w+) to authenticated/gim)];
    const withDelete = grants
      .filter(([, verbs]) => /\bdelete\b/i.test(verbs))
      .map(([, , table]) => table);
    expect(withDelete).toEqual(['public.transaction_splits']);
  });
});

describe('security definer functions pin their search path', () => {
  test('every SECURITY DEFINER function sets search_path to empty', () => {
    for (const { name, sql } of files) {
      const definers = [
        ...sql.matchAll(/create or replace function ([\w.]+)\s*\([\s\S]*?\$\$/gi),
      ].filter(([body]) => /security definer/i.test(body));

      for (const [body, fn] of definers) {
        expect(
          body,
          `${name}: ${fn} is SECURITY DEFINER and must pin "set search_path = ''"`,
        ).toMatch(/set search_path = ''/);
      }
    }
  });
});

/**
 * A restated function must not lose what the previous one returned.
 *
 * `load_household_document` builds the whole document the application reads. A
 * migration that adds one key to it has to restate the entire function, and a
 * restatement is a transcription — which is exactly how a key got replaced by an
 * empty array and every household that had ever imported a file stopped loading.
 *
 * The rule enforced here: the last definition of that function in migration order
 * carries every key any earlier definition carried. Adding keys is fine; losing
 * one, or quietly turning one into a literal, is not.
 */
describe('load_household_document never loses a key', () => {
  /** The keys a definition builds, and whether each reads from a table. */
  function keysOf(definition) {
    const keys = new Map();
    for (const match of definition.matchAll(
      /'([A-Za-z][A-Za-z0-9]*)',\s*(\(select[\s\S]*?from\s+(public\.[a-z_]+)|'\[\]'::jsonb|to_jsonb)/g,
    )) {
      const [, key, body, table] = match;
      keys.set(key, { readsTable: table ?? null, literal: body.startsWith("'[]'") });
    }
    return keys;
  }

  /** Every definition of the function, in the order the migrations apply. */
  function definitions() {
    const found = [];
    for (const { name, sql } of migrations()) {
      let at = sql.indexOf('create or replace function public.load_household_document');
      while (at >= 0) {
        const end = sql.indexOf('$$;', at);
        found.push({ name, definition: sql.slice(at, end) });
        at = sql.indexOf('create or replace function public.load_household_document', end);
      }
    }
    return found;
  }

  test('there is at least one definition to check', () => {
    expect(definitions().length).toBeGreaterThan(0);
  });

  test('the final definition carries every key an earlier one did', () => {
    const all = definitions();
    const final = keysOf(all[all.length - 1].definition);

    const lost = [];
    for (const { name, definition } of all.slice(0, -1)) {
      for (const [key] of keysOf(definition)) {
        if (!final.has(key)) lost.push(`${key} (last seen in ${name})`);
      }
    }

    expect(lost, 'these keys were dropped by a later restatement').toEqual([]);
  });

  test('a key that once read a table is not later an empty literal', () => {
    const all = definitions();
    const final = keysOf(all[all.length - 1].definition);

    const emptied = [];
    for (const { name, definition } of all.slice(0, -1)) {
      for (const [key, shape] of keysOf(definition)) {
        if (shape.readsTable === null) continue;
        const now = final.get(key);
        if (now !== undefined && now.literal) {
          emptied.push(`${key}: read ${shape.readsTable} in ${name}, now always empty`);
        }
      }
    }

    expect(emptied, 'these keys silently stopped returning their rows').toEqual([]);
  });
});
