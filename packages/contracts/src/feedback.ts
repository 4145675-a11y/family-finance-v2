import { z } from 'zod';

/**
 * Feedback from inside the product (ADR-0047).
 *
 * A person marks something on a screen, writes what should change and sends it.
 * What reaches the server is described here, and it is described as a **white
 * list**: the server parses what the browser sent with these schemas and keeps
 * only what they name. Anything else the browser chose to send is dropped
 * without being read further.
 *
 * The one rule that shapes everything below: **nothing that was on the screen
 * is stored.** Not a text excerpt, not a label, not the page title. On this
 * product the screen is made of money — balances, lenders, due dates — and a
 * feedback note is read by the platform owner, who by ADR-0045 does not see a
 * shekel. A component is located by its stable `data-fb` name instead, and a
 * component without one gets a name added rather than its text collected.
 *
 * What the person writes themselves is the one place money can still enter. It
 * cannot be filtered without mangling it, so `privacyHints` warns before it is
 * sent and the person decides.
 */

/** The longest note a person may write. */
export const FEEDBACK_TEXT_MAX = 2000;

/** How deep a chain of `data-fb` names may go, outermost first. */
export const FEEDBACK_CHAIN_MAX = 12;

/** The largest coordinate or size accepted, in CSS pixels. */
export const FEEDBACK_COORDINATE_MAX = 100_000;

/** Below this width the screen is a phone; up to `TABLET_MAX` a tablet. */
export const FEEDBACK_PHONE_MAX = 639;
export const FEEDBACK_TABLET_MAX = 1024;

/** Notes one person may send in an hour, on either backend. */
export const FEEDBACK_HOURLY_LIMIT = 10;

/** The version of the stored shape. Raised when a field changes meaning. */
export const FEEDBACK_SCHEMA_VERSION = 1;

export const feedbackKindSchema = z.enum(['design', 'content', 'bug', 'other']);
export type FeedbackKind = z.infer<typeof feedbackKindSchema>;

export const feedbackUrgencySchema = z.enum(['low', 'normal', 'high']);
export type FeedbackUrgency = z.infer<typeof feedbackUrgencySchema>;

export const feedbackStatusSchema = z.enum(['new', 'approved', 'done', 'declined']);
export type FeedbackStatus = z.infer<typeof feedbackStatusSchema>;

export const feedbackDeviceSchema = z.enum(['phone', 'tablet', 'desktop']);
export type FeedbackDevice = z.infer<typeof feedbackDeviceSchema>;

/**
 * A `data-fb` name: lowercase, digits and hyphens, starting with a letter.
 *
 * Narrow on purpose. A name is chosen by whoever writes the component, never by
 * data, so anything that does not look like one — Hebrew, a number, an
 * identifier — is not a name and is refused rather than stored.
 */
export const FEEDBACK_NAME_PATTERN = /^[a-z][a-z0-9-]{0,62}$/u;
export const feedbackNameSchema = z.string().regex(FEEDBACK_NAME_PATTERN);

const coordinate = z.number().int().min(0).max(FEEDBACK_COORDINATE_MAX);

/** A rectangle in page coordinates: where the component or the region was. */
export const feedbackRectSchema = z.strictObject({
  x: coordinate,
  y: coordinate,
  width: coordinate,
  height: coordinate,
});
export type FeedbackRect = z.infer<typeof feedbackRectSchema>;

const chainSchema = z.array(feedbackNameSchema).max(FEEDBACK_CHAIN_MAX);

/**
 * What was marked: one component, a region the person dragged, or the page.
 *
 * A region still carries the chain of the component at its centre, so a region
 * drawn over a card points at that card's file like a selected component would.
 */
export const feedbackMarkSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('element'), chain: chainSchema, rect: feedbackRectSchema }),
  z.strictObject({ type: z.literal('region'), chain: chainSchema, rect: feedbackRectSchema }),
  z.strictObject({ type: z.literal('page') }),
]);
export type FeedbackMark = z.infer<typeof feedbackMarkSchema>;

export const feedbackViewportSchema = z.strictObject({
  width: z.number().int().min(1).max(FEEDBACK_COORDINATE_MAX),
  height: z.number().int().min(1).max(FEEDBACK_COORDINATE_MAX),
  scrollY: coordinate,
});
export type FeedbackViewport = z.infer<typeof feedbackViewportSchema>;

/**
 * Exactly what the browser may send.
 *
 * `path` is the address the person was on; the server turns it into a template
 * with `routeTemplate` before anything is kept, so an identifier in the address
 * never reaches storage. `website` is the trap a bot fills and a person never
 * sees: the server answers a filled one with success and stores nothing.
 */
export const feedbackSubmissionSchema = z.object({
  kind: feedbackKindSchema,
  urgency: feedbackUrgencySchema,
  text: z.string().trim().min(1).max(FEEDBACK_TEXT_MAX),
  mark: feedbackMarkSchema,
  path: z.string().min(1).max(2048),
  viewport: feedbackViewportSchema,
  website: z.string().max(200).optional(),
});
export type FeedbackSubmission = z.infer<typeof feedbackSubmissionSchema>;

/** Which code was serving when the note was written. Null on a local build. */
export const feedbackBuildSchema = z.strictObject({
  commit: z
    .string()
    .regex(/^[0-9a-f]{7,40}$/u)
    .nullable(),
  branch: z.string().max(200).nullable(),
});
export type FeedbackBuild = z.infer<typeof feedbackBuildSchema>;

/**
 * The note as it is kept, on either backend.
 *
 * Who wrote it and for which household are not here. On the database they are
 * columns the server sets and the reviewer never receives; on the file backend
 * there is one household and one person.
 */
export const feedbackRecordSchema = z.strictObject({
  reference: z.string().regex(/^fb-\d{8}-\d{6}-[0-9a-f]{6}$/u),
  createdAt: z.string().min(1),
  status: feedbackStatusSchema,
  kind: feedbackKindSchema,
  urgency: feedbackUrgencySchema,
  text: z.string().min(1).max(FEEDBACK_TEXT_MAX),
  mark: feedbackMarkSchema,
  route: z.string().min(1).max(512),
  viewport: feedbackViewportSchema,
  device: feedbackDeviceSchema,
  build: feedbackBuildSchema,
  schemaVersion: z.number().int().min(1),
});
export type FeedbackRecord = z.infer<typeof feedbackRecordSchema>;

/** A note as the platform owner reviews it: the record, and whose family sent it. */
export interface FeedbackReviewRow extends FeedbackRecord {
  readonly householdName: string | null;
}

/** The parsed submission, or the reason it was refused — never a thrown error. */
export type FeedbackParse =
  | { readonly ok: true; readonly submission: FeedbackSubmission; readonly trap: boolean }
  | { readonly ok: false };

/**
 * Parses what the browser sent.
 *
 * Unknown top-level keys are stripped (zod's default), unknown keys inside the
 * mark, rectangle and viewport refuse the whole note: those objects are built by
 * the widget and nothing else, so an extra key there is not a widget.
 */
export function parseFeedbackSubmission(input: unknown): FeedbackParse {
  const parsed = feedbackSubmissionSchema.safeParse(input);
  if (!parsed.success) return { ok: false };
  const trap = (parsed.data.website ?? '').trim() !== '';
  return { ok: true, submission: parsed.data, trap };
}

/** Which kind of screen a width is. */
export function deviceForWidth(width: number): FeedbackDevice {
  if (width <= FEEDBACK_PHONE_MAX) return 'phone';
  if (width <= FEEDBACK_TABLET_MAX) return 'tablet';
  return 'desktop';
}

/** A route segment that is a word in the product's own address scheme. */
const STATIC_SEGMENT = /^[a-z][a-z0-9-]{0,39}$/u;

/**
 * The address with every identifier taken out.
 *
 * `/lenders/3f2c…?tab=history#top` becomes `/lenders/[id]`. A segment survives
 * only if it looks like a word this product chose for its own routes —
 * lowercase, Latin, short. A UUID, a number, a Hebrew name, an encoded string:
 * each becomes `[id]`. The rule is deliberately the other way round from "strip
 * what looks like an identifier", because a list of identifier shapes is a list
 * that will one day be missing one.
 */
export function routeTemplate(path: string): string {
  const withoutQuery = path.split(/[?#]/u)[0] ?? '';
  let pathname = withoutQuery;
  // An absolute URL reached here only if a caller passed one; keep its path.
  const schemeAt = pathname.indexOf('://');
  if (schemeAt !== -1) {
    const slash = pathname.indexOf('/', schemeAt + 3);
    pathname = slash === -1 ? '/' : pathname.slice(slash);
  }
  const segments = pathname.split('/').filter((segment) => segment !== '');
  const kept = segments.slice(0, 12).map((segment) => {
    // A static segment that happens to look like a UUID's hex run is still an id.
    if (/^[0-9a-f-]{8,}$/u.test(segment) && /\d/u.test(segment)) return '[id]';
    return STATIC_SEGMENT.test(segment) ? segment : '[id]';
  });
  return `/${kept.join('/')}`;
}

/** What a note looks like it contains that the person may not want to send. */
export type PrivacyHint = 'amount' | 'phone' | 'email' | 'id';

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/u;
/** Israeli phone numbers: 05X, 0X and 07X, with or without separators. */
const PHONE = /(?:\+972[-\s]?|\b0)(?:[23489]|5\d|7\d)[-\s]?\d{3}[-\s]?\d{4}\b/u;
/** Nine digits standing alone: the shape of a teudat zehut. */
const ID_NUMBER = /(?<!\d)\d{9}(?!\d)/u;
/** A currency word or sign, a grouped number, or any number of three digits or more. */
const AMOUNT = /₪|ש["״]ח|שקל|(?<!\d)\d{1,3}(?:,\d{3})+(?!\d)|(?<![\d.])\d{3,}(?![\d])/u;

/**
 * Warns about what a note seems to contain — before it is sent, never after.
 *
 * A hint is a question for the person, not a verdict. It does not change the
 * note and the server does not consult it: the person may send anyway.
 */
export function privacyHints(text: string): PrivacyHint[] {
  const hints: PrivacyHint[] = [];
  const email = EMAIL.test(text);
  const phone = PHONE.test(text);
  const id = ID_NUMBER.test(text);
  // A number already explained as a phone or an ID is not also an amount.
  const withoutExplained = text
    .replace(new RegExp(EMAIL.source, 'gu'), ' ')
    .replace(new RegExp(PHONE.source, 'gu'), ' ')
    .replace(new RegExp(ID_NUMBER.source, 'gu'), ' ');
  if (AMOUNT.test(withoutExplained)) hints.push('amount');
  if (phone) hints.push('phone');
  if (email) hints.push('email');
  if (id) hints.push('id');
  return hints;
}

/**
 * A reference a person can read back and approve by: `fb-20261112-093012-a1b2c3`.
 *
 * The date and time are UTC. The six hex characters come from the caller's
 * random source, so this function stays pure and testable.
 */
export function feedbackReference(at: Date, randomHex: string): string {
  if (!/^[0-9a-f]{6}$/u.test(randomHex)) {
    throw new Error('a feedback reference needs six lowercase hex characters');
  }
  const iso = at.toISOString();
  const date = iso.slice(0, 10).replaceAll('-', '');
  const time = iso.slice(11, 19).replaceAll(':', '');
  return `fb-${date}-${time}-${randomHex}`;
}

/**
 * Builds the record the server keeps from a parsed submission.
 *
 * Every field is rebuilt by name, so the record holds nothing the schema did
 * not name even if a later change loosens a parser. The status is always
 * `new`: the browser has no say in it.
 */
export function buildFeedbackRecord(
  submission: FeedbackSubmission,
  context: {
    readonly reference: string;
    readonly createdAt: string;
    readonly build: FeedbackBuild;
  },
): FeedbackRecord {
  const mark: FeedbackMark =
    submission.mark.type === 'page'
      ? { type: 'page' }
      : {
          type: submission.mark.type,
          chain: [...submission.mark.chain],
          rect: {
            x: submission.mark.rect.x,
            y: submission.mark.rect.y,
            width: submission.mark.rect.width,
            height: submission.mark.rect.height,
          },
        };
  return feedbackRecordSchema.parse({
    reference: context.reference,
    createdAt: context.createdAt,
    status: 'new',
    kind: submission.kind,
    urgency: submission.urgency,
    text: submission.text,
    mark,
    route: routeTemplate(submission.path),
    viewport: {
      width: submission.viewport.width,
      height: submission.viewport.height,
      scrollY: submission.viewport.scrollY,
    },
    device: deviceForWidth(submission.viewport.width),
    build: { commit: context.build.commit, branch: context.build.branch },
    schemaVersion: FEEDBACK_SCHEMA_VERSION,
  });
}
