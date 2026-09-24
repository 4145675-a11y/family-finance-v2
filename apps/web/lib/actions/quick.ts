'use server';

import { unavailableProposal, type AiProposal } from '@family-finance/ai-proposal';

import { buildAnalysisRequest } from '../ai/context';
import { aiConfigured, provider, withinRateLimit } from '../ai/server';
import { verifyProposal } from '../ai/verify';
import { FieldReader, failed, submissionKey, succeeded, type FormState } from '../forms';
import { applyQuickUpdate, type ApprovedIntent } from '../quick/apply';
import { readQuickUpdate } from '../quick/read';
import { MAX_QUICK_TEXT, idleQuick, type QuickState } from '../quick/state';
import { householdStore } from '../store/server';
import { ALREADY_RECORDED, describe, refreshMoneyScreens, repeatWatch } from './errors';

/**
 * The quick update: reading a sentence, and recording what it meant.
 *
 * Three actions now, and the split between them is still the approval boundary.
 * Two of them read — the deterministic rule table, and the smart reader — and
 * **neither writes anything at all**. The third records, and it is the only one
 * that touches a command.
 *
 * The smart reader does not get its own write path. Its proposal ends up in the
 * same confirmation form, carrying the same fields, and confirming it runs
 * `applyQuickUpdate` exactly as the deterministic route does. That is deliberate:
 * a second path would be a second place for the rule "nothing is recorded without
 * a person" to be relaxed.
 *
 * The approval never trusts what the browser says a proposal was. The
 * deterministic route re-reads the sentence; the smart route re-validates every
 * submitted field against the household that was just loaded. In both cases the
 * values that reach a command are values this server established.
 */

/** Reading with the rule table. Writes nothing. */
export async function interpretQuickUpdateAction(
  _previous: QuickState,
  data: FormData,
): Promise<QuickState> {
  const raw = data.get('text');
  const text = typeof raw === 'string' ? raw.trim().slice(0, MAX_QUICK_TEXT) : '';
  const configured = aiConfigured();

  if (text === '') {
    return {
      ...idleQuick,
      status: 'error',
      aiConfigured: configured,
      message: 'צריך לכתוב או להקריא משהו קודם.',
    };
  }

  try {
    const reading = await readQuickUpdate(text);
    return {
      status: 'read',
      text,
      proposals: reading.proposals,
      accounts: reading.accounts.map((account) => ({ id: account.id, name: account.name })),
      debts: reading.debts,
      message: reading.proposals.length === 0 ? 'לא מצאנו כאן עדכון. אפשר לנסח אחרת.' : '',
      ai: null,
      aiConfigured: configured,
    };
  } catch (error) {
    const described = describe(error);
    return {
      ...idleQuick,
      status: 'error',
      text,
      aiConfigured: configured,
      message: described.message,
    };
  }
}

/**
 * Reading with the smart reader. Writes nothing either.
 *
 * The order of operations *is* the safety argument, so it is worth reading as a
 * list:
 *
 *   1. the text is trimmed and capped — a paragraph is not a sentence;
 *   2. the household is read on the server, as the signed-in person;
 *   3. a **deliberately small** context is built from it (`ai/context.ts`);
 *   4. the provider is asked, with a timeout it cannot exceed;
 *   5. the answer is parsed against the contract, and anything else is discarded;
 *   6. every field is re-verified against this household (`ai/verify.ts`), and
 *      `safeToConfirm` is decided **there**, never by the model.
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

  const engine = provider();
  if (engine === null) return { ...base, ai: unavailableProposal('not_configured') };

  try {
    const store = await householdStore();
    const document = await store.readDocument();

    if (!withinRateLimit(document.household.id)) {
      return { ...base, ai: unavailableProposal('rate_limited') };
    }

    const request = buildAnalysisRequest(text, document);
    const outcome = await engine.analyse(request);

    const ai: AiProposal =
      outcome.kind === 'answered'
        ? verifyProposal(outcome.output, { document, today: request.today })
        : unavailableProposal(outcome.reason);

    const open = document.accounts.filter((account) => account.closedAt === null);

    return {
      ...base,
      ai,
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
 * Confirming. The only action here that writes.
 *
 * Two sources of a proposal arrive at one set of checks. `proposalSource` says
 * which screen sent it, and the difference is only in where the *starting* values
 * come from: re-read from the sentence, or submitted as named fields. After that
 * both are identical — every value is checked against the household that was just
 * loaded, and the same writer runs.
 */
export async function confirmQuickUpdateAction(
  _previous: FormState,
  data: FormData,
): Promise<FormState> {
  const reader = new FieldReader(data);
  const sourceText = reader.text('sourceText', 'המשפט', { max: MAX_QUICK_TEXT });
  const index = reader.integer('proposalIndex', 'מספר ההצעה', { min: 0, max: 20 }) ?? 0;
  const source = reader.choice(
    'proposalSource',
    'מקור ההצעה',
    ['deterministic', 'ai'] as const,
    'deterministic',
  );

  // The corrections a person made on the screen. Optional for the deterministic
  // route, where the sentence supplies whatever was not edited.
  const amountOverride = reader.optionalMoney('amountMinor', 'סכום');
  const accountOverride = reader.id('accountId', 'חשבון');
  const debtOverride = reader.id('debtId', 'הלוואה');
  const dateOverride = reader.optionalDate('occurredOn', 'תאריך');
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
  const aiIntent = reader.choice(
    'aiIntent',
    'סוג הפעולה',
    ['expense', 'income', 'balance', 'debt_repayment', 'new_debt'] as const,
    'expense',
  );

  if (!reader.ok) return failed('בואו נשלים כמה פרטים.', reader.errors);
  if (sourceText === '') return failed('אין מה לרשום.');

  const watch = repeatWatch();

  try {
    const store = await householdStore();
    const document = await store.readDocument();
    const open = document.accounts.filter((account) => account.closedAt === null);

    let intent: ApprovedIntent;
    let amountMinor: number;
    let accountId: string | null;
    let debtId: string | null;
    let occurredOn: string;
    let merchant: string | null;

    if (source === 'ai') {
      /*
       * Nothing here is taken on trust: these are named form fields, read by the
       * same `FieldReader` every other form uses, and each one is checked against
       * the document below. What the model produced only decided what the form
       * was *pre-filled* with.
       */
      intent = aiIntent;
      amountMinor = amountOverride ?? 0;
      accountId = accountOverride ?? (open.length === 1 ? (open[0]?.id ?? null) : null);
      debtId = debtOverride;
      occurredOn = dateOverride ?? '';
      merchant =
        intent === 'new_debt'
          ? creditorName === ''
            ? null
            : creditorName
          : merchantField === ''
            ? null
            : merchantField;
      if (occurredOn === '') return failed('צריך תאריך.');
    } else {
      const reading = await readQuickUpdate(sourceText);
      const proposal = reading.proposals[index];
      if (proposal === undefined) {
        return failed('ההצעה הזו כבר לא קיימת. כדאי לקרוא את המשפט מחדש.');
      }
      intent = mapIntent(proposal.intent);
      amountMinor = amountOverride ?? proposal.amountMinor ?? 0;
      accountId = accountOverride ?? proposal.accountId;
      debtId = debtOverride ?? proposal.debtId;
      occurredOn = dateOverride ?? proposal.date;
      merchant = proposal.description === '' ? null : proposal.description;
    }

    /*
     * The same checks for both routes, against the document just read. An id that
     * no longer names an open account or an active debt fails here, which is what
     * makes a stale proposal safe to submit rather than dangerous.
     */
    if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
      return failed('צריך סכום גדול מאפס.');
    }
    if (accountId === null) return failed('צריך לבחור חשבון.');
    const account = open.find((row) => row.id === accountId);
    if (account === undefined) return failed('החשבון שנבחר כבר לא קיים.');

    if (intent === 'debt_repayment') {
      if (debtId === null) return failed('צריך לבחור לאיזו הלוואה התשלום שייך.');
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
        debtId: intent === 'debt_repayment' ? debtId : null,
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

/** The deterministic reader's own intent names, mapped onto the writer's. */
function mapIntent(intent: string): ApprovedIntent {
  switch (intent) {
    case 'income':
      return 'income';
    case 'balance':
      return 'balance';
    case 'new_debt':
      return 'new_debt';
    case 'debt_payment':
      return 'debt_repayment';
    default:
      return 'expense';
  }
}
