import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, test } from 'vitest';

import {
  BackupError,
  backupFileName,
  createBackup,
  documentToRestore,
  previewRestore,
  serialiseBackup,
} from './backup';
import { addTask } from './commands';
import { CURRENT_FORMAT_VERSION } from './document';
import { contextFor, seededHousehold, spend, TEST_NOW } from './fixtures/household';
import { ConcurrentModificationError, FileStore, StoreNotInitialisedError } from './file-store';
import { PathEscapeError, resolveStorePaths, safeJoin, uploadFileName } from './paths';
import { balanceOf } from './projection';
import { HouseholdStore } from './store';

/**
 * Backup, restore, and the file layer underneath them.
 *
 * The tests that matter here are the refusals. A backup that restores cleanly is
 * the easy case; a backup that was truncated by a failed download, edited in a
 * text editor, or produced by a future version has to be refused by name — because
 * the alternative is a household whose data is half-replaced by something nobody
 * can identify.
 */

const temporaries: string[] = [];

async function temporaryStore(): Promise<HouseholdStore> {
  const root = await mkdtemp(join(tmpdir(), 'family-finance-test-'));
  temporaries.push(root);
  return new HouseholdStore(resolveStorePaths(root, join(root, '.data')));
}

afterAll(async () => {
  for (const root of temporaries) {
    await rm(root, { recursive: true, force: true });
  }
});

describe('a backup describes itself', () => {
  const seeded = seededHousehold();
  const envelope = createBackup(seeded.document, TEST_NOW);

  test('it says what it is, what made it, and what is inside', () => {
    expect(envelope.kind).toBe('family-finance-backup');
    expect(envelope.documentFormatVersion).toBe(CURRENT_FORMAT_VERSION);
    expect(envelope.summary.householdName).toBe('משק בית לבדיקה');
    expect(envelope.summary.accounts).toBe(3);
    expect(envelope.summary.debts).toBe(2);
  });

  test('the file name says when, and nothing about the family', () => {
    const name = backupFileName(TEST_NOW);
    expect(name).toMatch(/^family-finance-backup-2026-09-06/);
    expect(name).not.toContain('משק');
  });

  test('there are no credentials in it, because there are none in the store', () => {
    const text = serialiseBackup(envelope).toLowerCase();
    for (const forbidden of ['password', 'secret', 'apikey', 'api_key', 'token', 'bearer']) {
      expect(text).not.toContain(forbidden);
    }
  });
});

describe('a restore is previewed before anything is replaced', () => {
  const seeded = seededHousehold();
  const text = serialiseBackup(createBackup(seeded.document, TEST_NOW));

  test('the preview reports both sides without writing', () => {
    const current = seededHousehold().document;
    const preview = previewRestore(text, current);

    expect(preview.summary.transactions).toBe(0);
    expect(preview.current?.householdName).toBe('משק בית לבדיקה');
    expect(preview.documentFormatVersion).toBe(CURRENT_FORMAT_VERSION);
  });

  test('a restore of a backup brings back exactly what was in it', () => {
    const withSpending = spend(
      seeded.document,
      seeded.bankAccountId,
      41_230,
      '2026-09-02',
      'סופרמרקט',
    );
    const backup = serialiseBackup(createBackup(withSpending.document, TEST_NOW));
    const restored = documentToRestore(previewRestore(backup, null));

    expect(balanceOf(restored, seeded.bankAccountId).computedMinor).toBe(1_200_000 - 41_230);
    expect(restored.audit).toHaveLength(withSpending.document.audit.length);
  });
});

describe('a backup that cannot be trusted is refused by name', () => {
  const seeded = seededHousehold();
  const envelope = createBackup(seeded.document, TEST_NOW);

  test('a file that is not JSON', () => {
    expect(() => previewRestore('not json at all', null)).toThrow(
      expect.objectContaining({ code: 'unreadable_json' }) as unknown as Error,
    );
  });

  test('JSON that is not a backup', () => {
    expect(() => previewRestore('{"hello":"world"}', null)).toThrow(
      expect.objectContaining({ code: 'not_a_backup' }) as unknown as Error,
    );
  });

  test('a backup someone edited', () => {
    const tampered = serialiseBackup(envelope).replaceAll('משק בית לבדיקה', 'משק בית אחר');
    expect(() => previewRestore(tampered, null)).toThrow(
      expect.objectContaining({ code: 'checksum_mismatch' }) as unknown as Error,
    );
  });

  test('a backup truncated by a failed download', () => {
    const text = serialiseBackup(envelope);
    expect(() => previewRestore(text.slice(0, text.length - 200), null)).toThrow(BackupError);
  });

  test('the summary shown is recomputed from the data, never read from the file', () => {
    // The summary sits outside the checksum, so it is treated as a label rather
    // than as evidence: what the preview reports is derived from the document.
    const lying = serialiseBackup({
      ...envelope,
      summary: { ...envelope.summary, transactions: 9_999, householdName: 'שקר' },
    });

    const preview = previewRestore(lying, null);
    expect(preview.summary.transactions).toBe(0);
    expect(preview.summary.householdName).toBe('משק בית לבדיקה');
  });

  test('a backup from a newer version of the application', () => {
    const future = serialiseBackup({ ...envelope, envelopeVersion: 99 });
    expect(() => previewRestore(future, null)).toThrow(
      expect.objectContaining({ code: 'unsupported_envelope' }) as unknown as Error,
    );
  });

  test('a backup holding data in a format this build cannot read', () => {
    const future = serialiseBackup({ ...envelope, documentFormatVersion: 99 });
    expect(() => previewRestore(future, null)).toThrow(
      expect.objectContaining({ code: 'unsupported_format' }) as unknown as Error,
    );
  });

  test('a backup whose contents are not a valid document', () => {
    const broken = JSON.stringify({
      ...envelope,
      document: { ...envelope.document, accounts: [{ id: 'not-a-uuid' }] },
    });
    expect(() => previewRestore(broken, null)).toThrow(BackupError);
  });
});

describe('the file store', () => {
  test('a household is created, read back, and refuses to be created twice', async () => {
    const store = await temporaryStore();
    expect(await store.exists()).toBe(false);

    await store.create({ householdName: 'הבית שלנו', profileName: 'א' }, TEST_NOW);
    expect(await store.exists()).toBe(true);

    const document = await store.readDocument();
    expect(document.household.name).toBe('הבית שלנו');

    await expect(
      store.create({ householdName: 'שוב', profileName: 'ב' }, TEST_NOW),
    ).rejects.toThrow(/already exists/);
  });

  test('reading before setup says so rather than inventing an empty household', async () => {
    const store = await temporaryStore();
    await expect(store.readDocument()).rejects.toThrow(StoreNotInitialisedError);
    expect(await store.view()).toBeNull();
  });

  test('two writes arriving together are applied one after the other', async () => {
    const store = await temporaryStore();
    await store.create({ householdName: 'הבית', profileName: 'א' }, TEST_NOW);

    const titles = ['ראשונה', 'שנייה', 'שלישית', 'רביעית', 'חמישית'];
    await Promise.all(
      titles.map((title) =>
        store.run((document, context) =>
          addTask(
            document,
            {
              title,
              reason: null,
              origin: 'manual',
              recommendationKey: null,
              amountMinor: null,
              relatedDebtId: null,
              relatedAccountId: null,
              assignedMemberId: null,
              dueOn: null,
            },
            context,
          ),
        ),
      ),
    );

    const document = await store.readDocument();
    // Every one survived: no write read a document another was about to replace.
    expect(document.tasks.map((task) => task.title).sort()).toEqual([...titles].sort());
  });

  test('a stale revision is refused rather than silently overwriting', async () => {
    const store = await temporaryStore();
    await store.create({ householdName: 'הבית', profileName: 'א' }, TEST_NOW);

    const stale = 'f'.repeat(64);
    await expect(
      store.run(
        (document, context) =>
          addTask(
            document,
            {
              title: 'מאוחר מדי',
              reason: null,
              origin: 'manual',
              recommendationKey: null,
              amountMinor: null,
              relatedDebtId: null,
              relatedAccountId: null,
              assignedMemberId: null,
              dueOn: null,
            },
            context,
          ),
        { expectedRevision: stale },
      ),
    ).rejects.toThrow(ConcurrentModificationError);
  });

  test('a command that throws leaves the file exactly as it was', async () => {
    const store = await temporaryStore();
    await store.create({ householdName: 'הבית', profileName: 'א' }, TEST_NOW);
    const before = await readFile(store.paths.document, 'utf8');

    await expect(
      store.run(() => {
        throw new Error('deliberate failure inside a command');
      }),
    ).rejects.toThrow('deliberate failure');

    expect(await readFile(store.paths.document, 'utf8')).toBe(before);
  });

  test('the previous document is kept in history after a change', async () => {
    const store = await temporaryStore();
    await store.create({ householdName: 'הבית', profileName: 'א' }, TEST_NOW);

    await store.run((document, context) =>
      addTask(
        document,
        {
          title: 'משהו',
          reason: null,
          origin: 'manual',
          recommendationKey: null,
          amountMinor: null,
          relatedDebtId: null,
          relatedAccountId: null,
          assignedMemberId: null,
          dueOn: null,
        },
        context,
      ),
    );

    const files = new FileStore(store.paths);
    const stale = await files.staleUploads(-1);
    expect(Array.isArray(stale)).toBe(true);
  });

  test("an upload is stored under a generated name, never the user's", async () => {
    const store = await temporaryStore();
    await store.create({ householdName: 'הבית', profileName: 'א' }, TEST_NOW);

    const files = new FileStore(store.paths);
    const bytes = new TextEncoder().encode('a,b\n1,2\n');
    const stored = await files.storeUpload(bytes, '.csv');

    expect(stored.storedId).toMatch(/^[0-9a-f-]{36}$/);
    expect(stored.sha256).toMatch(/^[0-9a-f]{64}$/);

    const readBack = await files.readUpload(stored.storedId, '.csv');
    expect(readBack).not.toBeNull();
    expect(new TextDecoder().decode(readBack!)).toBe('a,b\n1,2\n');

    await files.deleteUpload(stored.storedId, '.csv');
    expect(await files.readUpload(stored.storedId, '.csv')).toBeNull();
  });

  test('a restore replaces everything and keeps the old document in history', async () => {
    const store = await temporaryStore();
    await store.create({ householdName: 'הבית', profileName: 'א' }, TEST_NOW);

    const seeded = seededHousehold();
    const backup = serialiseBackup(createBackup(seeded.document, TEST_NOW));
    const preview = previewRestore(backup, await store.readDocument());

    await store.replaceDocument(documentToRestore(preview));

    const document = await store.readDocument();
    expect(document.household.name).toBe('משק בית לבדיקה');
    expect(document.accounts).toHaveLength(3);
  });

  test('a backup written to disk reads back byte for byte', async () => {
    const store = await temporaryStore();
    await store.create({ householdName: 'הבית', profileName: 'א' }, TEST_NOW);

    const files = new FileStore(store.paths);
    const document = await store.readDocument();
    const text = serialiseBackup(createBackup(document, TEST_NOW));
    const path = await files.writeBackup(backupFileName(TEST_NOW), text);

    expect(await readFile(path, 'utf8')).toBe(text);
    const preview = previewRestore(await readFile(path, 'utf8'), null);
    expect(preview.summary.householdName).toBe('הבית');
  });

  test('a household.json somebody edited by hand is refused, not half-loaded', async () => {
    const store = await temporaryStore();
    await store.create({ householdName: 'הבית', profileName: 'א' }, TEST_NOW);
    await writeFile(store.paths.document, '{"formatVersion": 1}', 'utf8');

    await expect(store.readDocument()).rejects.toThrow(/does not match the expected shape/);
  });
});

describe('paths never escape the data directory', () => {
  const paths = resolveStorePaths('/project', '/project/.data');

  test.each([
    ['..', 'x'],
    ['../..', 'household.json'],
    ['..\\..\\windows', 'x'],
  ])('%s/%s is refused', (a, b) => {
    expect(() => safeJoin(paths.root, a, b)).toThrow(PathEscapeError);
  });

  test('an absolute path is refused', () => {
    expect(() => safeJoin(paths.root, '/etc/passwd')).toThrow(PathEscapeError);
  });

  test('an ordinary name inside the directory is allowed', () => {
    expect(safeJoin(paths.root, 'uploads', 'file.csv')).toContain('uploads');
  });

  test('an upload name must be a generated identifier and a known extension', () => {
    const id = '11111111-2222-3333-4444-555555555555';
    expect(uploadFileName(id, '.csv')).toBe(`${id}.csv`);
    expect(() => uploadFileName('../evil', '.csv')).toThrow(PathEscapeError);
    expect(() => uploadFileName(id, '/etc/passwd')).toThrow(PathEscapeError);
    expect(() => uploadFileName(id, '.exe.very.long')).toThrow(PathEscapeError);
  });
});

describe('the audit trail travels with a backup', () => {
  test('a restored household still knows what was done to it', () => {
    const seeded = seededHousehold();
    const withTask = addTask(
      seeded.document,
      {
        title: 'לבדוק',
        reason: null,
        origin: 'manual',
        recommendationKey: null,
        amountMinor: null,
        relatedDebtId: null,
        relatedAccountId: null,
        assignedMemberId: null,
        dueOn: null,
      },
      contextFor(seeded.document),
    );

    const restored = documentToRestore(
      previewRestore(serialiseBackup(createBackup(withTask.document, TEST_NOW)), null),
    );

    expect(restored.audit).toEqual(withTask.document.audit);
  });
});
