/**
 * SQL classification helpers.
 *
 * Used by the clipboard tool and by tests to prove that the diagnostic script is
 * genuinely read-only. Keyword matching alone gives false positives: the
 * diagnostic contains labels such as `'table: profiles'` inside string literals,
 * and a naive scan would flag them. Literals and comments are therefore removed
 * before any keyword is looked for.
 */

/** Statements that modify data, schema or permissions. */
export const MUTATING_KEYWORDS = [
  'insert',
  'update',
  'delete',
  'truncate',
  'create',
  'alter',
  'drop',
  'grant',
  'revoke',
  'merge',
  'call',
  'do',
  'comment',
  'refresh',
  'reindex',
  'vacuum',
  'copy',
  'set',
  'reset',
  'begin',
  'commit',
  'rollback',
];

/** Functions that write despite appearing inside a SELECT. */
export const MUTATING_FUNCTIONS = [
  'accept_household_invitation',
  'record_audit_event',
  'set_config',
  'pg_terminate_backend',
  'pg_cancel_backend',
  'nextval',
  'setval',
  'dblink_exec',
];

/**
 * Removes single-quoted literals, dollar-quoted blocks and comments, replacing
 * each with a space so token boundaries survive.
 * @param {string} sql
 */
export function stripLiteralsAndComments(sql) {
  return (
    sql
      // dollar-quoted blocks, e.g. $$ ... $$
      .replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, ' ')
      // block comments
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      // line comments
      .replace(/--[^\n]*/g, ' ')
      // single-quoted strings, honouring doubled quotes
      .replace(/'(?:[^']|'')*'/g, ' ')
      // double-quoted identifiers
      .replace(/"(?:[^"]|"")*"/g, ' ')
  );
}

/**
 * Finds mutating constructs in SQL that is expected to be read-only.
 * @param {string} sql
 * @returns {{kind: 'keyword'|'function', token: string}[]}
 */
export function findMutations(sql) {
  const bare = stripLiteralsAndComments(sql).toLowerCase();
  /** @type {{kind: 'keyword'|'function', token: string}[]} */
  const findings = [];

  for (const keyword of MUTATING_KEYWORDS) {
    if (new RegExp(`(^|[\\s;(])${keyword}[\\s(]`, 'm').test(bare)) {
      findings.push({ kind: 'keyword', token: keyword });
    }
  }

  for (const fn of MUTATING_FUNCTIONS) {
    if (new RegExp(`\\b${fn}\\s*\\(`, 'm').test(bare)) {
      findings.push({ kind: 'function', token: fn });
    }
  }

  return findings;
}

/** True when the SQL contains nothing that can change state. */
export function isReadOnly(sql) {
  return findMutations(sql).length === 0;
}
