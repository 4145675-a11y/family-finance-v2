import { describe, expect, test } from 'vitest';

import { parseFeedbackSubmission } from '@family-finance/contracts';

import {
  buildSubmission,
  dragRect,
  fbChain,
  nearestNamed,
  pageRect,
  type NamedNode,
} from './collect';

/** A stand-in element: attributes, a parent, and — deliberately — text full of money. */
function node(
  attributes: Record<string, string>,
  parent: NamedNode | null = null,
): NamedNode & { textContent: string; value: string } {
  return {
    getAttribute: (name) => attributes[name] ?? null,
    parentElement: parent,
    textContent: 'יתרה: ₪12,400 · משה כהן · 054-1234567',
    value: '987654321',
  };
}

describe('the chain of names', () => {
  test('runs from the outermost name to the innermost', () => {
    const screen = node({ 'data-fb': 'screen' });
    const card = node({ 'data-fb': 'lender-card' }, screen);
    const plain = node({}, card);
    const button = node({ 'data-fb': 'lender-card-pay' }, plain);
    expect(fbChain(button)).toEqual(['screen', 'lender-card', 'lender-card-pay']);
  });

  test('skips a value that is not a name instead of sending it', () => {
    const outer = node({ 'data-fb': 'screen' });
    const inner = node({ 'data-fb': 'כרטיס' }, outer);
    expect(fbChain(inner)).toEqual(['screen']);
  });

  test('keeps the innermost twelve when the page nests deeper', () => {
    let current: NamedNode | null = null;
    for (let index = 0; index < 20; index += 1) {
      current = node({ 'data-fb': `level-${index}` }, current);
    }
    const chain = fbChain(current);
    expect(chain).toHaveLength(12);
    expect(chain.at(-1)).toBe('level-19');
  });

  test('finds the nearest named element', () => {
    const card = node({ 'data-fb': 'lender-card' });
    const plain = node({}, card);
    expect(nearestNamed(plain)).toBe(card);
    expect(nearestNamed(node({}))).toBeNull();
  });
});

describe('rectangles', () => {
  test('a viewport rectangle becomes a whole page rectangle', () => {
    expect(
      pageRect({ left: 10.4, top: 20.6, width: 99.5, height: 50 }, { x: 0, y: 300 }),
    ).toEqual({ x: 10, y: 321, width: 100, height: 50 });
  });

  test('nothing negative and nothing infinite reaches the server', () => {
    expect(
      pageRect({ left: -40, top: Number.NaN, width: 1e9, height: 2 }, { x: 0, y: 0 }),
    ).toEqual({ x: 0, y: 0, width: 100_000, height: 2 });
  });

  test('a drag up and to the left is the same rectangle as down and to the right', () => {
    expect(dragRect({ x: 100, y: 100 }, { x: 40, y: 10 })).toEqual({
      left: 40,
      top: 10,
      width: 60,
      height: 90,
    });
  });
});

describe('the submission', () => {
  const screen = node({ 'data-fb': 'screen' });
  const card = node({ 'data-fb': 'balance-card' }, screen);

  const submission = buildSubmission({
    kind: 'design',
    urgency: 'normal',
    text: 'להגדיל את הכותרת',
    mark: {
      type: 'element',
      chain: fbChain(card),
      rect: pageRect({ left: 0, top: 0, width: 200, height: 80 }, { x: 0, y: 0 }),
    },
    screen: { pathname: '/lenders/abc123?tab=history#x', width: 390, height: 844, scrollY: 12 },
    website: '',
  });

  test('carries nothing that was on the screen', () => {
    const sent = JSON.stringify(submission);
    for (const leaked of ['12,400', 'משה', '054', '987654321', 'יתרה']) {
      expect(sent, `«${leaked}» was on the screen and must not be sent`).not.toContain(leaked);
    }
  });

  test('drops the query and the fragment before sending', () => {
    expect(submission['path']).toBe('/lenders/abc123');
  });

  test('is exactly what the server accepts', () => {
    expect(parseFeedbackSubmission(submission).ok).toBe(true);
  });
});
