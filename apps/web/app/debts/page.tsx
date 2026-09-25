import { permanentRedirect } from 'next/navigation';

import { requireUnlocked } from '../../lib/auth/guard';

/**
 * The old debts screen, kept as an address.
 *
 * `/debts` and `/lenders` showed the same seven lenders — one as a table with
 * two forms under it, one as cards — so they were merged into `/lenders`, which
 * is now "חובות ומלווים". The route stays because a link a family saved, a
 * bookmark, or a screen that still points here must not break: it takes them to
 * the screen that answers the question they were asking.
 *
 * The guard runs **before** the redirect, and that ordering is the point. A bare
 * redirect would answer a stranger — telling them, in a small way, what this
 * application contains — and it would be the one path in the product that does.
 * The production smoke check asserts that every application path sends an
 * anonymous visitor to sign in, and it caught exactly this.
 *
 * Permanent rather than temporary, because the merge is not a detour.
 */

/*
 * Per request, because the guard reads the session. A prerendered copy would
 * have to decide at build time whether the visitor is signed in, which is a
 * question that has no answer then.
 */
export const dynamic = 'force-dynamic';

export default async function DebtsPage(): Promise<never> {
  await requireUnlocked();
  permanentRedirect('/lenders');
}
