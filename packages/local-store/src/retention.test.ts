import { mkdtemp, readdir, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, test } from 'vitest';

import { FileStore } from './file-store';
import { resolveStorePaths } from './paths';

/**
 * The retention window on uploaded originals.
 *
 * 05-ARCHITECTURE-DATA.md § Imports: an undecided file is deleted within 24
 * hours. The bytes go; the record of the upload — name, size, type, hash — stays,
 * because that is what an audit needs and it is not a copy of the statement.
 *
 * The sweep is tested here, at the file layer, rather than through the page that
 * triggers it: what matters is which files it selects and which it leaves.
 */

const temporaries: string[] = [];

async function temporaryStore(): Promise<FileStore> {
  const root = await mkdtemp(join(tmpdir(), 'family-finance-retention-'));
  temporaries.push(root);
  return new FileStore(resolveStorePaths(root, join(root, '.data')));
}

afterAll(async () => {
  for (const root of temporaries) await rm(root, { recursive: true, force: true });
});

const DAY = 24 * 60 * 60 * 1000;

describe('uploads older than a day are swept', () => {
  test('a fresh upload is left alone', async () => {
    const files = new FileStore((await temporaryStore()).paths);
    const stored = await files.storeUpload(new TextEncoder().encode('a,b\n1,2\n'), '.csv');

    expect(await files.staleUploads(DAY)).toEqual([]);
    expect(await files.readUpload(stored.storedId, '.csv')).not.toBeNull();
  });

  test('an upload older than the window is listed', async () => {
    const files = new FileStore((await temporaryStore()).paths);
    const stored = await files.storeUpload(new TextEncoder().encode('a,b\n1,2\n'), '.csv');

    // Age the file rather than waiting a day for it.
    const path = join(files.paths.uploads, `${stored.storedId}.csv`);
    const old = new Date(Date.now() - 2 * DAY);
    await utimes(path, old, old);

    const stale = await files.staleUploads(DAY);
    expect(stale).toEqual([`${stored.storedId}.csv`]);
  });

  test('sweeping removes the bytes and nothing else', async () => {
    const files = new FileStore((await temporaryStore()).paths);
    const oldFile = await files.storeUpload(new TextEncoder().encode('old'), '.csv');
    const newFile = await files.storeUpload(new TextEncoder().encode('new'), '.csv');

    const path = join(files.paths.uploads, `${oldFile.storedId}.csv`);
    const old = new Date(Date.now() - 2 * DAY);
    await utimes(path, old, old);

    for (const name of await files.staleUploads(DAY)) await files.removeUploadByName(name);

    expect(await files.readUpload(oldFile.storedId, '.csv')).toBeNull();
    expect(await files.readUpload(newFile.storedId, '.csv')).not.toBeNull();
    expect(await readdir(files.paths.uploads)).toEqual([`${newFile.storedId}.csv`]);
  });

  test('an empty uploads directory sweeps to nothing rather than failing', async () => {
    const files = new FileStore((await temporaryStore()).paths);
    expect(await files.staleUploads(DAY)).toEqual([]);
  });

  test('a name that is not one of ours cannot be removed', async () => {
    const files = new FileStore((await temporaryStore()).paths);
    await files.storeUpload(new TextEncoder().encode('x'), '.csv');
    await expect(files.removeUploadByName('../household.json')).rejects.toThrow();
  });
});

describe('deleting a decided upload', () => {
  test('removes the file the moment the decision is made', async () => {
    const files = new FileStore((await temporaryStore()).paths);
    const stored = await files.storeUpload(new TextEncoder().encode('a,b\n'), '.csv');

    await files.deleteUpload(stored.storedId, '.csv');
    expect(await files.readUpload(stored.storedId, '.csv')).toBeNull();
  });

  test('deleting one that is already gone is not an error', async () => {
    const files = new FileStore((await temporaryStore()).paths);
    await expect(
      files.deleteUpload('11111111-2222-4333-8444-555555555555', '.csv'),
    ).resolves.toBeUndefined();
  });
});
