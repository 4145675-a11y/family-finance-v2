import path, { join, resolve } from 'node:path';

/** `node:path` itself, or its `posix` / `win32` flavours — same surface, different rules. */
type PlatformPath = typeof path;

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
 * Characters that make a name into a path on at least one platform.
 *
 * `/` everywhere; `\` on Windows; `:` because `C:x` is a drive-relative path
 * there, resolved against that drive's current directory and so outside any
 * root. None of them can appear in a name this code generates.
 */
const PATH_CHARACTERS = /[\\/:]/;

/** `.`, `..`, and the longer runs of dots Windows folds into them. */
const ONLY_DOTS = /^\.+$/;

/**
 * Joins a generated identifier onto a directory, refusing anything that escapes.
 *
 * The identifier is expected to be a UUID and a suffix this code chose. The check
 * is here anyway: the cost is one string comparison, and the failure it prevents
 * is writing a family's financial document somewhere outside the data directory.
 */
export function safeJoin(root: string, ...segments: string[]): string {
  return safeJoinOn(path, root, ...segments);
}

/**
 * The rule behind `safeJoin`, with the platform made explicit.
 *
 * Every segment must be a single name, never a path. That is checked before
 * anything is resolved, and it does not depend on which separators the host
 * understands — which is the point. `..\..\windows` is a traversal on Windows
 * and an ordinary, if peculiar, file name on Linux; the same data directory can
 * be reached from both, so the only consistent answer is to refuse it on both.
 * The containment check that follows is the second lock, in case a platform
 * has a spelling of "up" that the first one does not know.
 *
 * Exported so the tests can prove the rule on `path.posix` and `path.win32`
 * alike, whichever machine happens to be running them.
 */
export function safeJoinOn(
  platform: PlatformPath,
  root: string,
  ...segments: string[]
): string {
  if (segments.length === 0) {
    throw new PathEscapeError('(none)', root);
  }
  for (const segment of segments) {
    if (segment.length === 0) {
      throw new PathEscapeError('(empty)', root);
    }
    if (segment.includes('\0')) {
      throw new PathEscapeError(segment, root);
    }
    if (PATH_CHARACTERS.test(segment) || ONLY_DOTS.test(segment)) {
      throw new PathEscapeError(segment, root);
    }
    if (platform.isAbsolute(segment)) {
      throw new PathEscapeError(segment, root);
    }
  }

  const normalisedRoot = platform.resolve(root);
  const candidate = platform.resolve(normalisedRoot, ...segments);
  const withSeparator = normalisedRoot.endsWith(platform.sep)
    ? normalisedRoot
    : `${normalisedRoot}${platform.sep}`;

  // Strictly below the root: a name was joined, so equality would itself be wrong.
  if (!candidate.startsWith(withSeparator)) {
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
