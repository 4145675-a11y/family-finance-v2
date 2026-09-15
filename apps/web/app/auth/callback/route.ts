import { NextResponse, type NextRequest } from 'next/server';

import { activeBackend } from '../../../lib/auth/backend';
import { absoluteOnOrigin, decideAuthLink } from '../../../lib/auth/redirect';
import { redeemCode, redeemTokenHash } from '../../../lib/auth/supabase';
import { readDeploymentConfig } from '../../../lib/config/deployment';

export const dynamic = 'force-dynamic';

/**
 * Where an auth link lands: an invitation, a recovery email, a magic link.
 *
 * The link carries either a PKCE `code` or a `token_hash` with its `type`.
 * Either is exchanged for a session — the ssr client writes the cookies — and
 * the person continues to `next`, which is made safe before it is followed.
 * A link that cannot be redeemed goes to the sign-in screen with a generic
 * marker; nothing about why is put in the URL or on the screen.
 *
 * Redirects are built on the configured origin, never on the request's Host
 * header, so a forged header cannot turn this route into an open redirect.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const origin = readDeploymentConfig().appOrigin;
  const to = (path: string) => NextResponse.redirect(absoluteOnOrigin(origin, path), 303);

  if (activeBackend() !== 'supabase') return to('/');

  const decision = decideAuthLink(request.nextUrl.searchParams);
  if (decision.kind === 'none') return to('/login');

  const redeemed =
    decision.kind === 'code'
      ? await redeemCode(decision.code ?? '')
      : await redeemTokenHash(decision.tokenHash ?? '', decision.type ?? '');

  if (!redeemed.ok) return to('/login?link=invalid');
  return to(decision.next);
}
