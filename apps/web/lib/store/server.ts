import 'server-only';

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { HouseholdStore, resolveStorePaths } from '@family-finance/local-store';

/**
 * The application's single door to the household's data.
 *
 * `server-only` is the first line for a reason: this module reaches the
 * filesystem, and 05-ARCHITECTURE-DATA.md keeps data access out of client
 * components. Importing it from a `'use client'` file is a build error rather
 * than a runtime surprise.
 *
 * There is exactly one store instance per process, because the store serialises
 * its own writes and two instances would each think they were alone.
 */

/**
 * Walks up from the app directory to the workspace root.
 *
 * Next runs with its working directory at `apps/web`, and the data directory
 * belongs at the top of the repository where a person can find it. Walking to the
 * marker rather than hard-coding `../..` means moving the app does not silently
 * write the household's data somewhere else.
 */
function findProjectRoot(startAt: string = process.cwd()): string {
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

let instance: HouseholdStore | null = null;

export function householdStore(): HouseholdStore {
  if (instance === null) {
    instance = new HouseholdStore(resolveStorePaths(findProjectRoot()));
  }
  return instance;
}

/** Where the data lives, for the screen that explains what is stored and where. */
export function dataDirectory(): string {
  return householdStore().paths.root;
}

export { findProjectRoot };
