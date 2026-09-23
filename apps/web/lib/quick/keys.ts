import { createHash } from 'node:crypto';

/**
 * The second record's identifier, derived from the submission's.
 *
 * A repayment approved from the quick screen writes two records — the money
 * leaving the account, and the balance moving — and two records cannot share a
 * primary key. Deriving the second from the first is what keeps ADR-0038's
 * guarantee whole across both: the same submission always produces the same
 * pair, so a double press finds both already recorded, and two different
 * submissions can never land on each other.
 *
 * A hash rather than an edit of the original, because flipping a character
 * could produce a key some other submission legitimately minted. Formatted as a
 * uuid because that is what the column is.
 */
export function debtEventKey(submissionKey: string): string {
  const digest = createHash('sha256').update(`debt-event:${submissionKey}`).digest('hex');
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `4${digest.slice(13, 16)}`,
    `8${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join('-');
}
