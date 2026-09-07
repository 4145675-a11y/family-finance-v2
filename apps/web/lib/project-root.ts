import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Walks up from the app directory to the workspace root.
 *
 * Next runs with its working directory at `apps/web`, and the data directory
 * belongs at the top of the repository where a person can find it. Walking to the
 * marker rather than hard-coding `../..` means moving the app does not silently
 * write the household's data somewhere else.
 *
 * This lives on its own rather than inside the store module because the sign-in
 * file needs the same directory, and having authentication import the store —
 * which is the thing authentication guards — would be a cycle.
 */
export function findProjectRoot(startAt: string = process.cwd()): string {
  let directory = resolve(startAt);

  for (let depth = 0; depth < 10; depth += 1) {
    const manifest = resolve(directory, 'package.json');
    if (existsSync(manifest)) {
      try {
        const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { workspaces?: unknown };
        if (Array.isArray(parsed.workspaces)) return directory;
      } catch {
        // A malformed manifest on the way up is not this function's problem;
        // keep walking rather than failing the whole application.
      }
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }

  // No workspace root found: fall back to the working directory rather than
  // guessing at a path outside the project.
  return resolve(startAt);
}
