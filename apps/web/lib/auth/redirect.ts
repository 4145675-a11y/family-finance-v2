/**
 * Where to send a person after sign-in, sign-up or a link — and never
 * anywhere else.
 *
 * A `next` value arrives from a query string or a form and is therefore
 * hostile until proven otherwise. Only a path on this site is followed: it
 * must start with one slash, may not be protocol-relative (`//evil`), may not
 * smuggle a scheme or a backslash the browser would normalise into one, and
 * may not carry control characters. Anything else is the home page.
 */
export function safeNextPath(value: unknown, fallback = '/'): string {
  if (typeof value !== 'string' || value === '') return fallback;
  if (!value.startsWith('/')) return fallback;
  if (value.startsWith('//') || value.startsWith('/\\')) return fallback;
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) return fallback;
  }
  // A path on this site never carries a colon before its query: refusing one
  // closes the scheme-smuggling family of tricks in a single line.
  const pathOnly = value.split(/[?#]/)[0] ?? '';
  if (pathOnly.includes(':')) return fallback;
  return value;
}

/** The absolute URL for a redirect target on this deployment. */
export function absoluteOnOrigin(origin: string, path: string): string {
  return new URL(safeNextPath(path), origin).toString();
}

export type LinkKind = 'code' | 'token_hash' | 'none';

export interface LinkDecision {
  readonly kind: LinkKind;
  readonly code: string | null;
  readonly tokenHash: string | null;
  readonly type: string | null;
  /** Where to go after the link is redeemed. Already made safe. */
  readonly next: string;
}

const OTP_TYPES = new Set([
  'invite',
  'recovery',
  'email',
  'magiclink',
  'signup',
  'email_change',
]);
const TOKEN_SHAPE = /^[A-Za-z0-9._~-]{8,512}$/;

/**
 * Reads an auth link's query into a decision the route can act on.
 *
 * Two shapes reach `/auth/callback`: a PKCE `code` (sign-in and OAuth-style
 * flows) or a `token_hash` with its `type` (the email templates documented in
 * docs/HOSTING-RENDER.md). Anything else is "no link", which the route turns
 * into the sign-in screen rather than an error that names what was missing.
 */
export function decideAuthLink(params: URLSearchParams): LinkDecision {
  const next = safeNextPath(params.get('next'));
  const code = params.get('code');
  if (code !== null && TOKEN_SHAPE.test(code)) {
    return { kind: 'code', code, tokenHash: null, type: null, next };
  }
  const tokenHash = params.get('token_hash');
  const type = params.get('type');
  if (
    tokenHash !== null &&
    TOKEN_SHAPE.test(tokenHash) &&
    type !== null &&
    OTP_TYPES.has(type)
  ) {
    return { kind: 'token_hash', code: null, tokenHash, type, next };
  }
  return { kind: 'none', code: null, tokenHash: null, type: null, next };
}
