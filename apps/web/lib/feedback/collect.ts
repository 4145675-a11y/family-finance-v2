import {
  FEEDBACK_CHAIN_MAX,
  FEEDBACK_COORDINATE_MAX,
  FEEDBACK_NAME_PATTERN,
  type FeedbackKind,
  type FeedbackMark,
  type FeedbackRect,
  type FeedbackUrgency,
} from '@family-finance/contracts';

/**
 * What the feedback button collects from the page — and the proof of what it
 * does not (ADR-0047 § 3).
 *
 * Every function here takes the few properties it needs and nothing more. None
 * of them is handed an element's text, its value or the page title, so none of
 * them can put one in a submission: the narrow parameter types are the rule,
 * and `collect.test.ts` checks it against an element that is full of money.
 */

/** The two things a `data-fb` walk needs from an element. */
export interface NamedNode {
  getAttribute(name: string): string | null;
  readonly parentElement: NamedNode | null;
}

/**
 * The `data-fb` names from the outermost to this element.
 *
 * A value that is not a valid name is skipped rather than sent: the server
 * would refuse the whole note for it, and one mistyped attribute should not
 * cost a person what they wrote.
 */
export function fbChain(element: NamedNode | null): string[] {
  const names: string[] = [];
  for (let node = element; node !== null; node = node.parentElement) {
    const name = node.getAttribute('data-fb');
    if (name !== null && FEEDBACK_NAME_PATTERN.test(name)) names.push(name);
  }
  return names.reverse().slice(-FEEDBACK_CHAIN_MAX);
}

/** The nearest ancestor-or-self that carries a valid `data-fb` name, or null. */
export function nearestNamed<T extends NamedNode>(element: T | null): T | null {
  for (let node: NamedNode | null = element; node !== null; node = node.parentElement) {
    const name = node.getAttribute('data-fb');
    if (name !== null && FEEDBACK_NAME_PATTERN.test(name)) return node as T;
  }
  return null;
}

function clampCoordinate(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(FEEDBACK_COORDINATE_MAX, Math.max(0, Math.round(value)));
}

/** A viewport rectangle moved into page coordinates and made whole. */
export function pageRect(
  viewport: { left: number; top: number; width: number; height: number },
  scroll: { x: number; y: number },
): FeedbackRect {
  return {
    x: clampCoordinate(viewport.left + scroll.x),
    y: clampCoordinate(viewport.top + scroll.y),
    width: clampCoordinate(viewport.width),
    height: clampCoordinate(viewport.height),
  };
}

/** The rectangle between two corners of a drag, whichever way it was dragged. */
export function dragRect(
  start: { x: number; y: number },
  end: { x: number; y: number },
): { left: number; top: number; width: number; height: number } {
  return {
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

/** Below this size a drag was a click, not a region. */
export const MIN_REGION = 8;

/** The screen, without anything on it. */
export interface ScreenFacts {
  readonly pathname: string;
  readonly width: number;
  readonly height: number;
  readonly scrollY: number;
}

/**
 * The object the button sends. Built from named fields only — there is no
 * spread of anything the page produced.
 */
export function buildSubmission(input: {
  readonly kind: FeedbackKind;
  readonly urgency: FeedbackUrgency;
  readonly text: string;
  readonly mark: FeedbackMark;
  readonly screen: ScreenFacts;
  readonly website: string;
}): Record<string, unknown> {
  return {
    kind: input.kind,
    urgency: input.urgency,
    text: input.text,
    mark:
      input.mark.type === 'page'
        ? { type: 'page' }
        : {
            type: input.mark.type,
            chain: [...input.mark.chain],
            rect: {
              x: input.mark.rect.x,
              y: input.mark.rect.y,
              width: input.mark.rect.width,
              height: input.mark.rect.height,
            },
          },
    // Only the path: the query and fragment never leave the browser.
    path: input.screen.pathname.split(/[?#]/u)[0] || '/',
    viewport: {
      width: Math.max(1, clampCoordinate(input.screen.width)),
      height: Math.max(1, clampCoordinate(input.screen.height)),
      scrollY: clampCoordinate(input.screen.scrollY),
    },
    website: input.website,
  };
}
