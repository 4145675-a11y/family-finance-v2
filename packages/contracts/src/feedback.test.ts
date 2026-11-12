import { describe, expect, test } from 'vitest';

import {
  FEEDBACK_TEXT_MAX,
  buildFeedbackRecord,
  deviceForWidth,
  feedbackReference,
  parseFeedbackSubmission,
  privacyHints,
  routeTemplate,
} from './feedback';

/** A submission the widget would really send. */
function submission(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'design',
    urgency: 'normal',
    text: 'הכותרת צפופה מדי',
    mark: {
      type: 'element',
      chain: ['dashboard', 'dashboard-today'],
      rect: { x: 10, y: 20, width: 300, height: 120 },
    },
    path: '/lenders/0b6a1c2e-5f0d-4a8e-9d3b-1e2f3a4b5c6d?tab=history#top',
    viewport: { width: 1280, height: 800, scrollY: 0 },
    ...overrides,
  };
}

const BUILD = { commit: 'a409669', branch: 'main' };

describe('what the browser may send', () => {
  test('a real submission parses', () => {
    const parsed = parseFeedbackSubmission(submission());
    expect(parsed.ok).toBe(true);
  });

  test('unknown top-level fields are dropped, not kept', () => {
    const parsed = parseFeedbackSubmission(
      submission({ householdId: 'someone-else', status: 'done', screenText: '₪12,400' }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(Object.keys(parsed.submission)).not.toContain('householdId');
    expect(Object.keys(parsed.submission)).not.toContain('status');
    expect(Object.keys(parsed.submission)).not.toContain('screenText');
  });

  test('an extra key inside the mark refuses the whole note', () => {
    const parsed = parseFeedbackSubmission(
      submission({
        mark: {
          type: 'element',
          chain: ['dashboard'],
          rect: { x: 0, y: 0, width: 1, height: 1 },
          text: 'יתרה: 4,200 ₪',
        },
      }),
    );
    expect(parsed.ok, 'the mark is built by the widget; text inside it is not a widget').toBe(
      false,
    );
  });

  test('a name that is not a name is refused', () => {
    for (const name of ['דשבורד', '1card', 'Card', 'a b', 'x'.repeat(64), '']) {
      const parsed = parseFeedbackSubmission(
        submission({
          mark: { type: 'element', chain: [name], rect: { x: 0, y: 0, width: 1, height: 1 } },
        }),
      );
      expect(parsed.ok, `«${name}» must not pass as a data-fb name`).toBe(false);
    }
  });

  test('the text is trimmed, required and bounded', () => {
    expect(parseFeedbackSubmission(submission({ text: '   ' })).ok).toBe(false);
    expect(
      parseFeedbackSubmission(submission({ text: 'א'.repeat(FEEDBACK_TEXT_MAX) })).ok,
    ).toBe(true);
    expect(
      parseFeedbackSubmission(submission({ text: 'א'.repeat(FEEDBACK_TEXT_MAX + 1) })).ok,
    ).toBe(false);
  });

  test('kind, urgency and coordinates are closed sets', () => {
    expect(parseFeedbackSubmission(submission({ kind: 'praise' })).ok).toBe(false);
    expect(parseFeedbackSubmission(submission({ urgency: 'urgent' })).ok).toBe(false);
    expect(
      parseFeedbackSubmission(submission({ viewport: { width: 0, height: 800, scrollY: 0 } }))
        .ok,
    ).toBe(false);
    expect(
      parseFeedbackSubmission(submission({ viewport: { width: 1.5, height: 800, scrollY: 0 } }))
        .ok,
    ).toBe(false);
  });

  test('the trap is reported, so the server can answer success and keep nothing', () => {
    const parsed = parseFeedbackSubmission(submission({ website: 'http://spam.example' }));
    expect(parsed).toMatchObject({ ok: true, trap: true });
    expect(parseFeedbackSubmission(submission({ website: '' }))).toMatchObject({
      ok: true,
      trap: false,
    });
  });

  test('anything that is not an object is refused without throwing', () => {
    for (const input of [null, undefined, 'text', 42, []]) {
      expect(parseFeedbackSubmission(input).ok).toBe(false);
    }
  });
});

describe('the address without its identifiers', () => {
  test.each([
    ['/lenders/0b6a1c2e-5f0d-4a8e-9d3b-1e2f3a4b5c6d', '/lenders/[id]'],
    ['/debts/42?tab=history', '/debts/[id]'],
    ['/gemach/מלווה', '/gemach/[id]'],
    ['/imports/a1b2c3d4e5f6/review#row-3', '/imports/[id]/review'],
    ['/', '/'],
    ['/admin/feedback', '/admin/feedback'],
    ['https://example.test/lenders/x%20y?a=1', '/lenders/[id]'],
  ])('%s → %s', (input, expected) => {
    expect(routeTemplate(input)).toBe(expected);
  });
});

describe('which screen it was', () => {
  test('phone, tablet and desktop at their edges', () => {
    expect(deviceForWidth(375)).toBe('phone');
    expect(deviceForWidth(639)).toBe('phone');
    expect(deviceForWidth(640)).toBe('tablet');
    expect(deviceForWidth(1024)).toBe('tablet');
    expect(deviceForWidth(1025)).toBe('desktop');
  });
});

describe('the warning before sending', () => {
  test.each([
    ['היתרה 12,400 צריכה להיות מודגשת', ['amount']],
    ['כתוב 350 ₪ ולא 350', ['amount']],
    ['שקל אחד', ['amount']],
    ['תתקשרו 054-1234567', ['phone']],
    ['me@example.test', ['email']],
    ['ת"ז 123456789', ['id']],
    ['הכפתור קטן מדי', []],
    ['שתי שורות ולא 3', []],
  ])('«%s»', (text, expected) => {
    expect(privacyHints(text)).toEqual(expected);
  });
});

describe('the reference a person approves by', () => {
  test('UTC date and time, then six hex characters', () => {
    expect(feedbackReference(new Date('2026-11-07T19:03:28.123Z'), '804210')).toBe(
      'fb-20261107-190328-804210',
    );
  });

  test('anything but six lowercase hex characters is refused', () => {
    expect(() => feedbackReference(new Date(), 'ABCDEF')).toThrow();
    expect(() => feedbackReference(new Date(), '12345')).toThrow();
  });
});

describe('the record the server keeps', () => {
  function record(overrides: Record<string, unknown> = {}) {
    const parsed = parseFeedbackSubmission(submission(overrides));
    if (!parsed.ok) throw new Error('fixture must parse');
    return buildFeedbackRecord(parsed.submission, {
      reference: 'fb-20261112-093012-a1b2c3',
      createdAt: '2026-11-12T09:30:12.000Z',
      build: BUILD,
    });
  }

  test('is always new, whatever the browser hoped', () => {
    expect(record({ status: 'done' }).status).toBe('new');
  });

  test('keeps the route template, not the address', () => {
    const kept = record();
    expect(kept.route).toBe('/lenders/[id]');
    expect(JSON.stringify(kept)).not.toContain('0b6a1c2e');
    expect(JSON.stringify(kept)).not.toContain('tab=history');
  });

  test('derives the device from the width', () => {
    expect(record({ viewport: { width: 390, height: 844, scrollY: 120 } }).device).toBe(
      'phone',
    );
  });

  test('holds exactly the named fields', () => {
    expect(Object.keys(record()).sort()).toEqual(
      [
        'build',
        'createdAt',
        'device',
        'kind',
        'mark',
        'reference',
        'route',
        'schemaVersion',
        'status',
        'text',
        'urgency',
        'viewport',
      ].sort(),
    );
  });

  test('a page note carries no rectangle and no chain', () => {
    expect(record({ mark: { type: 'page' } }).mark).toEqual({ type: 'page' });
  });
});
