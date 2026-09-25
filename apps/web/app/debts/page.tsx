import { permanentRedirect } from 'next/navigation';

/**
 * The old debts screen, kept as an address.
 *
 * `/debts` and `/lenders` showed the same seven lenders — one as a table with
 * two forms under it, one as cards — so they were merged into `/lenders`, which
 * is now "חובות ומלווים". The route stays because a link a family saved, a
 * bookmark, or a screen that still points here must not break: it takes them to
 * the screen that answers the question they were asking.
 *
 * Permanent rather than temporary, because the merge is not a detour.
 */
export default function DebtsPage(): never {
  permanentRedirect('/lenders');
}
