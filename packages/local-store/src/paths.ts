import { isAbsolute, join, normalize, resolve, sep } from 'node:path';

/**
 * Where the household's data lives, and the rule that nothing escapes it.
 *
 * One directory, inside the project, holding the truth document, its backups and
 * the temporary area an upload passes through. Keeping it in one place makes two
 * things possible that matter more than tidiness: a person can see exactly what
 * the application stores, and they can delete it.
 *
 * Every path this module produces is checked to be inside the root before it is
 * returned. That check is not the only defence — nothing here ever builds a path
 * from a user-supplied file name, because uploads are keyed by generated
 * identifiers — but a traversal defence that depends on a convention being
 * remembered is not a defence.
 */

export class PathEscapeError extends Error {
  constructor(candidate: string, root: string) {
    super(`refusing a path outside the data directory: ${candidate} is not inside ${root}`);
    this.name = 'PathEscapeError';
  }
}

export interface StorePaths {
  readonly root: string;
  /** The one document holding the household's truth. */
  readonly document: string;
  /** Where a document is written before it replaces the live one. */
  readonly staging: string;
  /** Kept copies of previous documents, newest last. */
  readonly history: string;
  /** Uploaded originals, named by generated identifier only. */
  readonly uploads: string;
  /** Backups the family asked for. */
  readonly backups: string;
  /**
   * Passkey credentials, sessions and the authentication log.
   *
   * Deliberately a separate file from the household document. A passkey is bound
   * to this device and this origin, while the household document is the thing
   * that gets backed up and carried elsewhere — keeping credentials inside it
   * would mean a restore could remove the family's passkey or install somebody
   * else's. See ADR-0028.
   */
  readonly auth: string;
  /** Where the authentication file is written before it replaces the live one. */
  readonly authStaging: string;
}

/** The directory name, relative to the project root. Gitignored. */
export const DATA_DIRECTORY = '.data';

/**
 * Resolves the data root.
 *
 * `FAMILY_FINANCE_DATA_DIR` exists so a test can point at a temporary directory
 * without the tests writing over the developer's own household. It is read once,
 * at resolution, and is never derived from anything a request carries.
 */
export function resolveStorePaths(projectRoot: string, override?: string): StorePaths {
  const configured = override ?? process.env['FAMILY_FINANCE_DATA_DIR'];
  const root =
    configured === undefined || configured.trim() === ''
      ? resolve(projectRoot, DATA_DIRECTORY)
      : resolve(configured);

  return {
    root,
    document: join(root, 'household.json'),
    staging: join(root, 'household.json.writing'),
    history: join(root, 'history'),
    uploads: join(root, 'uploads'),
    backups: join(root, 'backups'),
    auth: join(root, 'auth.json'),
    authStaging: join(root, 'auth.json.writing'),
  };
}

/**
 * Joins a generated identifier onto a directory, refusing anything that escapes.
 *
 * The identifier is expected to be a UUID and a suffix this code chose. The check
 * is here anyway: the cost is one string comparison, and the failure it prevents
 * is writing a family's financial document somewhere outside the data directory.
 */
export function safeJoin(root: string, ...segments: string[]): string {
  for (const segment of segments) {
    if (segment.length === 0) {
      throw new PathEscapeError('(empty)', root);
    }
    if (isAbsolute(segment)) {
      throw new PathEscapeError(segment, root);
    }
    if (segment.includes('\0')) {
      throw new PathEscapeError(segment, root);
    }
  }

  const candidate = resolve(root, join(...segments));
  const normalisedRoot = normalize(resolve(root));
  const withSeparator = normalisedRoot.endsWith(sep)
    ? normalisedRoot
    : `${normalisedRoot}${sep}`;

  if (candidate !== normalisedRoot && !candidate.startsWith(withSeparator)) {
    throw new PathEscapeError(candidate, normalisedRoot);
  }

  return candidate;
}

/** The file name an uploaded original is stored under: an identifier, nothing else. */
export function uploadFileName(storedId: string, extension: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(storedId)) {
    throw new PathEscapeError(storedId, 'uploads');
  }
  if (!/^\.[a-z0-9]{1,8}$/.test(extension)) {
    throw new PathEscapeError(extension, 'uploads');
  }
  return `${storedId}${extension}`;
}
