import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { parseFeedbackSubmission, type FeedbackSubmission } from '@family-finance/contracts';

import { FeedbackLimitError, LocalFeedbackStore } from './feedback-store';

const BUILD = { commit: null, branch: null };

function submission(): FeedbackSubmission {
  const parsed = parseFeedbackSubmission({
    kind: 'bug',
    urgency: 'high',
    text: 'הכפתור לא מגיב',
    mark: { type: 'region', chain: ['lender-card'], rect: { x: 1, y: 2, width: 3, height: 4 } },
    path: '/lenders/0b6a1c2e-5f0d-4a8e-9d3b-1e2f3a4b5c6d',
    viewport: { width: 390, height: 844, scrollY: 10 },
  });
  if (!parsed.ok) throw new Error('fixture must parse');
  return parsed.submission;
}

let root = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'family-finance-feedback-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A store whose clock and random source the test controls. */
function store(options: { now?: () => Date; hex?: () => string; guard?: () => void } = {}) {
  let counter = 0;
  return new LocalFeedbackStore({
    root,
    guard: options.guard ?? (() => undefined),
    now: options.now ?? (() => new Date('2026-11-12T09:30:00.000Z')),
    randomHex:
      options.hex ??
      (() => {
        counter += 1;
        return counter.toString(16).padStart(6, '0');
      }),
  });
}

describe('a note on the file backend', () => {
  test('is written as one file, named by its reference, outside the household document', async () => {
    const reference = await store().submit(submission(), BUILD);
    expect(reference).toBe('fb-20261112-093000-000001');
    expect(await readdir(join(root, 'feedback'))).toEqual([`${reference}.json`]);
    expect(await readdir(root)).toEqual(['feedback']);
  });

  test('holds the template and not the address', async () => {
    const reference = await store().submit(submission(), BUILD);
    const raw = await readFile(join(root, 'feedback', `${reference}.json`), 'utf8');
    expect(raw).toContain('"/lenders/[id]"');
    expect(raw).not.toContain('0b6a1c2e');
  });

  test('never overwrites a note that is already there', async () => {
    const fixed = store({ hex: () => 'abcdef' });
    await fixed.submit(submission(), BUILD);
    await expect(fixed.submit(submission(), BUILD)).rejects.toThrow(/EEXIST/u);
  });

  test('the eleventh in an hour is refused, and an hour later it is not', async () => {
    let now = new Date('2026-11-12T09:00:00.000Z');
    const limited = store({ now: () => now });
    for (let index = 0; index < 10; index += 1) {
      now = new Date(now.getTime() + 1000);
      await limited.submit(submission(), BUILD);
    }
    now = new Date(now.getTime() + 1000);
    await expect(limited.submit(submission(), BUILD)).rejects.toBeInstanceOf(
      FeedbackLimitError,
    );
    now = new Date(now.getTime() + 60 * 60 * 1000);
    await expect(limited.submit(submission(), BUILD)).resolves.toMatch(/^fb-/u);
  });

  test('the lock is asked before anything is written', async () => {
    const locked = store({
      guard: () => {
        throw new Error('locked');
      },
    });
    await expect(locked.submit(submission(), BUILD)).rejects.toThrow('locked');
    await expect(readdir(root)).resolves.toEqual([]);
  });

  test('lists what it wrote, and skips a file that is not a note', async () => {
    const writer = store();
    const first = await writer.submit(submission(), BUILD);
    await writeFile(join(root, 'feedback', 'fb-20261112-093000-ffffff.json'), '{ not json');
    await writeFile(join(root, 'feedback', 'notes.txt'), 'hello');
    const listed = await writer.list();
    expect(listed.map((record) => record.reference)).toEqual([first]);
    expect(listed[0]?.status).toBe('new');
  });
});
