'use server';

import type { AiProposal } from '@family-finance/ai-proposal';
import type { StoreDocument } from '@family-finance/local-store';

import { buildAnalysisRequest } from '../ai/context';
import { aiConfigured, provider, withinRateLimit } from '../ai/server';
import { verifyProposal } from '../ai/verify';
import { FieldReader, failed, submissionKey, succeeded, type FormState } from '../forms';
import { applyQuickUpdate, type ApprovedIntent } from '../quick/apply';
import { fallbackProposal } from '../quick/fallback';
import { todayInIsrael } from '@family-finance/hebrew-calendar';
import { MAX_QUICK_TEXT, idleQuick, type QuickState } from '../quick/state';
import { splitUpdates } from '@family-finance/quick-update';
import { householdStore } from '../store/server';
import { ALREADY_RECORDED, describe, refreshMoneyScreens, repeatWatch } from './errors';

/**
 * The quick update: reading a sentence, and recording what it meant.
 *
 * Two actions, and the line between them is the approval boundary. One reads and
 * **writes nothing at all**; the other records, and it is the only one in this
 * file that touches a command.
 *
 * There used to be two reading actions, one per reader, and a screen that asked a
 * family which of them to use. That question had no answer anybody could give,
 * so the choice is gone: one action reads the sentence with whichever reader can
 * answer, and the person sees one proposal either way.
 *
 * The approval never trusts what the browser says a proposal was. Every submitted
 * value is re-checked against the household that was just loaded — an account
 * that has since closed, a lender that has since settled and an amount that was
 * edited in the page all fail here rather than reaching a command.
 */

/**
 * Reading a sentence. The only reading action, and it writes nothing.
 *
 * One action because there is one flow. A person types or dictates, presses one
 * button, and gets one proposal — they are never asked to choose which machinery
 * reads their sentence, because that is not a question anybody can answer and
 * the answer would not change what can happen to their money.
 *
 * Inside, the smart reader is tried first and the rule table catches everything
 * it cannot do: no key configured, a timeout, a rate limit, an answer that did
 * not parse. The fallback is **resilience, not a second product**, and it is
 * silent for that reason.
 *
 * The order of operations is the safety argument, so it is worth reading as a
 * list:
 *
 *   1. the text is trimmed and capped — a paragraph is not a sentence;
 *   2. the household is read on the server, as the signed-in person;
 *   3. a **deliberately small** context is built from it (`ai/context.ts`);
 *   4. the provider is asked, with a timeout it cannot exceed;
 *   5. the answer is parsed against the contract, and anything else discarded;
 *   6. every field is re-verified against this household (`ai/verify.ts`), the
 *      lender is resolved from words by the one matcher, and `safeToConfirm` is
 *      decided **there**, never by the model.
 *
 * At no point does this function call a command, and there is no branch in which
 * it could: it has no writer in scope.
 */
export async function analyseQuickUpdateAction(
  _previous: QuickState,
  data: FormData,
): Promise<QuickState> {
  const raw = data.get('text');
  const text = typeof raw === 'string' ? raw.trim().slice(0, MAX_QUICK_TEXT) : '';
  const configured = aiConfigured();

  const base = { ...idleQuick, text, aiConfigured: configured, status: 'read' as const };

  if (text === '') {
    return { ...base, status: 'error', message: 'צריך לכתוב או להקריא משהו קודם.' };
  }

  try {
    const store = await householdStore();
    const document = await store.readDocument();
    const today = todayInIsrael();

    const ai = await readWithBestReader(text, document, today);

    const open = document.accounts.filter((account) => account.closedAt === null);

    /*
     * One card, and a sentence that carried two updates says so.
     *
     * The screen used to show a card per update, which is a shape the smart
     * reader has no way to produce — it answers with one proposal. Rather than
     * keep two card shapes, the flow reads one update and **says** that the rest
     * was not read. Dropping the remainder silently would be the quiet wrongness
     * 02-FINANCIAL-RULES.md forbids; saying it costs a person one more sentence.
     */
    const several = splitUpdates(text).length > 1;

    return {
      ...base,
      ai,
      message: several
        ? 'יש כאן יותר מעדכון אחד. ההצעה מתייחסת לעדכון אחד — את השאר אפשר לשלוח בנפרד.'
        : '',
      accounts: open.map((account) => ({ id: account.id, name: account.name })),
      debts: document.debts
        .filter((debt) => debt.status === 'active')
        .map((debt) => ({ id: debt.id, creditorName: debt.creditorName })),
    };
  } catch (error) {
    const described = describe(error);
    return { ...base, status: 'error', message: described.message };
  }
}

/**
 * The smart reader if it can answer, the rule table if it cannot.
 *
 * Every way the first can fail ends in the second, and the person is not told
 * which ran — they asked for a proposal, and a proposal is what they get. What
 * they *are* told, when neither could read the sentence, is that it was not
 * understood.
 */
async function readWithBestReader(
  text: string,
  document: StoreDocument,
  today: string,
): Promise<AiProposal> {
  const fallback = (): AiProposal => fallbackProposal(text, document, today);

  const engine = provider();
  if (engine === null) return fallback();
  if (!withinRateLimit(document.household.id)) return fallback();

  const request = buildAnalysisRequest(text, document, { today });
  const outcome = await engine.analyse(request);
  if (outcome.kind !== 'answered') return fallback();

  const proposal = verifyProposal(outcome.output, { document, today, sentence: text });

  /*
   * A smart reading that understood nothing is worth a second opinion: the rule
   * table recognises a set of plain sentences exactly, and there is no reason to
   * show "not understood" when it would have succeeded.
   */
  if (proposal.state === 'not_understood') {
    const local = fallback();
    if (local.state !== 'not_understood') return local;
  }

  return proposal;
}

/**
 * Confirming. The only action here that writes.
 *
 * One path, because there is one card. Whatever the reading produced decided only
 * what the card was pre-filled with; every value arrives here as a named form
 * field and is checked against the household read a moment ago. What reaches
 * `applyQuickUpdate` is values this server established.
 */
export async function confirmQuickUpdateAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const reader = new FieldReader(data);
  const sourceText = reader.text('sourceText', 'המשפט', { max: MAX_QUICK_TEXT });

  // Every value the card is offering, as named fields.
  const amountOverride = reader.optionalMoney('amountMinor', 'סכום');
  const accountOverride = reader.id('accountId', 'חשבון');
  const debtOverride = reader.id('debtId', 'הלוואה');
  const dateOverride = reader.optionalDate('occurredOn', 'תאריך');
  /*
   * When a borrowed sum comes due.
   *
   * Read as an ordinary optional date, and it is the one date here allowed to be
   * in the future — that is what a repayment day is. It identifies nothing and
   * authorises nothing: it ends up as words on the lender's ledger line.
   */
  const dueOverride = reader.optionalDate('dueDate', 'פירעון');
  // Only a person supplies this, and only for a new debt.
  const creditorName = reader.optionalText('creditorName', 'שם המלווה', 160);
  /*
   * What the record is labelled with — the shop, the payer, the thing bought.
   *
   * It comes from the person's own words, quoted back to them on the review card
   * before they press confirm, and it is read here as ordinary bounded text. It
   * names nothing and authorises nothing: no id is derived from it and no lender
   * is matched by it.
   */
  const merchantField = reader.optionalText('merchant', 'על מה', 160);
  const proposedIntent = reader.choice(
    'aiIntent',
    'סוג הפעולה',
    ['expense', 'income', 'balance', 'debt_repayment', 'new_principal', 'new_debt'] as const,
    'expense',
  );

  if (!reader.ok) return failed('בואו נשלים כמה פרטים.', reader.errors);
  if (sourceText === '') return failed('אין מה לרשום.');

  const watch = repeatWatch();

  try {
    const store = await householdStore();
    const document = await store.readDocument();
    const open = document.accounts.filter((account) => account.closedAt === null);

    /*
     * Everything below is a named form field, read by the same `FieldReader`
     * every other form in the product uses. Nothing is taken on the browser's
     * word: what the reading produced only decided what the card was *pre-filled*
     * with, and each value is checked against the document just loaded.
     */
    const intent: ApprovedIntent = proposedIntent;
    const amountMinor = amountOverride ?? 0;
    const accountId = accountOverride ?? (open.length === 1 ? (open[0]?.id ?? null) : null);
    const debtId = debtOverride;
    const occurredOn = dateOverride ?? '';
    const merchant =
      intent === 'new_debt'
        ? creditorName === ''
          ? null
          : creditorName
        : merchantField === ''
          ? null
          : merchantField;
    if (occurredOn === '') return failed('צריך תאריך.');

    /*
     * The checks, against the document just read. An id that no longer names an
     * open account or an active debt fails here, which is what makes a stale
     * proposal safe to submit rather than dangerous.
     */
    if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
      return failed('צריך סכום גדול מאפס.');
    }
    if (accountId === null) return failed('צריך לבחור חשבון.');
    const account = open.find((row) => row.id === accountId);
    if (account === undefined) return failed('החשבון שנבחר כבר לא קיים.');

    if (intent === 'debt_repayment' || intent === 'new_principal') {
      if (debtId === null) return failed('צריך לבחור לאיזו הלוואה זה שייך.');
      const debt = document.debts.find((row) => row.id === debtId && row.status === 'active');
      if (debt === undefined) return failed('החוב שנבחר כבר לא קיים.');
    }
    if (intent === 'new_debt' && (creditorName === null || creditorName.trim() === '')) {
      return failed('צריך לכתוב למי חייבים.');
    }

    await applyQuickUpdate(
      {
        intent,
        amountMinor,
        accountId,
        scope: account.scope,
        debtId: intent === 'debt_repayment' || intent === 'new_principal' ? debtId : null,
        // Only borrowing has a repayment day, and only as a note on the event.
        dueDate: intent === 'new_principal' || intent === 'new_debt' ? dueOverride : null,
        creditorName: intent === 'new_debt' ? creditorName : null,
        occurredOn,
        merchant,
        sourceText,
        idempotencyKey: submissionKey(data),
      },
      watch,
    );
  } catch (error) {
    return describe(error);
  }

  refreshMoneyScreens();
  if (watch.repeated) return succeeded(ALREADY_RECORDED);
  return succeeded('נרשם.');
}
