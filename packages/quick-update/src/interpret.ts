import type {
  BusinessDate,
  ClassificationSuggestion,
  LearnedRule,
  RecordScope,
} from '@family-finance/contracts';
import {
  classifyTransaction,
  containsPhrase,
  normaliseDescription,
  type DebtHint,
} from '@family-finance/transaction-intelligence';
import type { DateReviewReason } from '@family-finance/hebrew-calendar';

import { CURRENCY_WORDS, readAmount } from './amount';
import { readIntent, type QuickIntent } from './intent';
import { splitUpdates } from './split';
import { readWhen } from './when';

/**
 * A sentence in Hebrew, read into something a family can check and approve.
 *
 * Nothing here writes, and nothing here is truth. The output is a **proposal**:
 * it crosses the approval boundary only when a person presses approve, exactly
 * like a row from an uploaded file (01-PRODUCT-SPEC.md, the approval boundary).
 *
 * The module is pure. No clock, no randomness, no network — today's date and the
 * household's own facts arrive as arguments. That is what lets a test state the
 * whole behaviour, and it is also what keeps a family's sentence off any wire:
 * there is nothing here that could call out even by accident.
 */

/** What a proposal is still missing, if anything. */
export type ProposalState =
  /** Complete. A person may approve it. */
  | 'ready'
  /** The sentence named no sum. */
  | 'needs_amount'
  /** More than one account could be meant and the sentence did not say. */
  | 'needs_account'
  /** A repayment whose lender was not named, or matched more than one. */
  | 'needs_debt'
  /** A day was named and it does not read. Never silently today. */
  | 'needs_date'
  /** No intent was recognised at all. */
  | 'not_understood';

export interface QuickAccountHint {
  readonly id: string;
  readonly name: string;
  readonly scope: RecordScope;
  readonly kind: string;
  readonly status: 'open' | 'closed';
}

export interface InterpretContext {
  /** Today, in the household's own time zone. Passed, never read. */
  readonly today: BusinessDate;
  readonly accounts: readonly QuickAccountHint[];
  readonly debts: readonly DebtHint[];
  readonly householdRules: readonly LearnedRule[];
}

export interface QuickProposal {
  /** Stable within one interpretation, so a form can address one proposal. */
  readonly index: number;
  readonly state: ProposalState;
  readonly intent: QuickIntent;
  /** The words this proposal was read from, shown back for checking. */
  readonly sourceText: string;
  readonly amountMinor: number | null;
  readonly direction: 'inflow' | 'outflow' | null;
  readonly date: BusinessDate;
  /** True when no day was named and today was assumed. Said on screen. */
  readonly dateAssumed: boolean;
  /** Why a named day was refused, when one was. */
  readonly dateProblem: DateReviewReason | null;
  /** What is left of the sentence once sum, day and verb are taken out. */
  readonly description: string;
  readonly accountId: string | null;
  readonly scope: RecordScope;
  readonly debtId: string | null;
  /** How many of the household's debts the sentence could have meant. */
  readonly debtCandidates: number;
  readonly classification: ClassificationSuggestion | null;
  /** One Hebrew sentence saying what was understood, or what is missing. */
  readonly explanation: string;
}

const DIRECTION: Readonly<Record<QuickIntent, 'inflow' | 'outflow' | null>> = {
  expense: 'outflow',
  income: 'inflow',
  debt_payment: 'outflow',
  new_debt: 'inflow',
  balance: null,
  unknown: null,
};

/** Words that carry the grammar rather than the meaning, dropped from the label. */
const FILLER: readonly string[] = [
  'שילמתי',
  'שילמנו',
  'קניתי',
  'קנינו',
  'הוצאתי',
  'הוצאנו',
  'חויבתי',
  'משכתי',
  'קיבלתי',
  'קיבלנו',
  'נכנס',
  'נכנסו',
  'החזרתי',
  'החזרנו',
  'פרעתי',
  'פרענו',
  'לקחתי',
  'לוויתי',
  'היום',
  'אתמול',
  'שלשום',
  'הערב',
  'הבוקר',
  'של',
  'את',
  'עוד',
  'על',
];

const LEADING_PREFIX = /^[בלמהוש]?-/u;

function labelFrom(text: string, removals: readonly string[]): string {
  let rest = text;
  for (const removal of removals) {
    if (removal === '') continue;
    rest = rest.split(removal).join(' ');
  }
  const words = rest
    .split(/\s+/)
    .map((word) => word.replace(LEADING_PREFIX, '').trim())
    .filter((word) => word.length > 0)
    .filter((word) => !CURRENCY_WORDS.includes(word))
    .filter((word) => !FILLER.includes(word));
  return words.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * The lender a repayment names, when it names exactly one.
 *
 * The same rule the import classifier holds to, for the same reason: a balance
 * that moves against the wrong lender is wrong in two places at once, and
 * picking the nearest name is how that happens. None or several, and the person
 * chooses.
 */
function resolveLender(
  text: string,
  debts: readonly DebtHint[],
): { debtId: string | null; candidates: number } {
  const folded = normaliseDescription(text);
  const active = debts.filter((debt) => debt.status === 'active');
  const hits = active.filter((debt) => {
    const name = normaliseDescription(debt.creditorName);
    if (name.length < 3) return false;
    return containsPhrase(folded, name) || folded.includes(name);
  });
  return { debtId: hits.length === 1 ? (hits[0]?.id ?? null) : null, candidates: hits.length };
}

/**
 * The account a sentence means.
 *
 * One open account, and that is the one, because there is nothing to choose
 * between. The sentence naming one, and that is the one. Otherwise **null**,
 * and the screen asks: taking the first account in the list would put money in
 * a place nobody said.
 */
function resolveAccount(
  text: string,
  accounts: readonly QuickAccountHint[],
): { accountId: string | null; ambiguous: boolean } {
  const open = accounts.filter((account) => account.status === 'open');
  if (open.length === 0) return { accountId: null, ambiguous: false };

  const folded = normaliseDescription(text);
  const named = open.filter((account) => {
    const name = normaliseDescription(account.name);
    return name.length >= 3 && (containsPhrase(folded, name) || folded.includes(name));
  });
  if (named.length === 1) return { accountId: named[0]?.id ?? null, ambiguous: false };
  if (named.length > 1) return { accountId: null, ambiguous: true };

  if (open.length === 1) return { accountId: open[0]?.id ?? null, ambiguous: false };
  return { accountId: null, ambiguous: true };
}

function explain(state: ProposalState, intent: QuickIntent, candidates: number): string {
  switch (state) {
    case 'needs_amount':
      return 'לא זיהינו סכום במשפט. אפשר להקליד אותו כאן.';
    case 'needs_account':
      return 'לא ברור מאיזה חשבון. צריך לבחור.';
    case 'needs_debt':
      return candidates > 1
        ? 'יש יותר מהלוואה אחת שמתאימה לשם. צריך לבחור לאיזו.'
        : 'לא זיהינו לאיזו הלוואה התשלום שייך. צריך לבחור.';
    case 'needs_date':
      return 'נאמר תאריך שאי אפשר לקרוא בוודאות. צריך לאשר אותו.';
    case 'not_understood':
      return 'לא הבנו מה לרשום. אפשר לנסח אחרת, או למלא טופס רגיל.';
    case 'ready':
      switch (intent) {
        case 'income':
          return 'הבנו: כסף שנכנס.';
        case 'debt_payment':
          return 'הבנו: החזר על חשבון הלוואה. היתרה תיגזר מהאירוע.';
        case 'new_debt':
          return 'הבנו: הלוואה חדשה שנלקחה.';
        case 'balance':
          return 'הבנו: עדכון יתרה, לא הוצאה ולא הכנסה.';
        default:
          return 'הבנו: כסף שיצא.';
      }
  }
}

function interpretOne(
  sourceText: string,
  index: number,
  context: InterpretContext,
): QuickProposal {
  const { intent } = readIntent(sourceText);
  const when = readWhen(sourceText, context.today);

  /*
   * The day is taken out of the sentence before the sum is read. Otherwise the
   * "3" of "3/9" is a perfectly good three shekels, and the family would find a
   * three-shekel expense where a three-hundred-shekel one belonged.
   */
  const withoutDate =
    when.outcome === 'today' ? sourceText : sourceText.split(when.matchedText).join(' ');
  const amount = readAmount(withoutDate);

  const description = labelFrom(withoutDate, [amount?.matchedText ?? '']);
  const account = resolveAccount(sourceText, context.accounts);
  const lender =
    intent === 'debt_payment'
      ? resolveLender(sourceText, context.debts)
      : { debtId: null, candidates: 0 };

  const direction = DIRECTION[intent];
  const date = when.outcome === 'unclear' ? context.today : when.date;

  const classification =
    direction !== null && amount !== null && intent !== 'balance'
      ? classifyTransaction(
          {
            description: description === '' ? sourceText : description,
            amountMinor: amount.amountMinor,
            direction,
            date,
            reference: null,
            bankName: null,
            accountKind:
              context.accounts.find((candidate) => candidate.id === account.accountId)?.kind ??
              null,
          },
          {
            householdRules: context.householdRules,
            debts: context.debts,
            ...(account.accountId === null ? {} : { accountId: account.accountId }),
          },
        )
      : null;

  const state: ProposalState =
    intent === 'unknown'
      ? 'not_understood'
      : when.outcome === 'unclear'
        ? 'needs_date'
        : amount === null
          ? 'needs_amount'
          : intent === 'debt_payment' && lender.debtId === null
            ? 'needs_debt'
            : account.accountId === null
              ? 'needs_account'
              : 'ready';

  const scope: RecordScope =
    context.accounts.find((candidate) => candidate.id === account.accountId)?.scope ??
    'household';

  return {
    index,
    state,
    intent,
    sourceText,
    amountMinor: amount?.amountMinor ?? null,
    direction,
    date,
    dateAssumed: when.outcome === 'today',
    dateProblem: when.outcome === 'unclear' ? when.reason : null,
    description,
    accountId: account.accountId,
    scope,
    debtId: lender.debtId,
    debtCandidates: lender.candidates,
    classification,
    explanation: explain(state, intent, lender.candidates),
  };
}

/**
 * A whole utterance, read into one proposal or several.
 *
 * Each proposal is approved on its own. A sentence that produced two of them
 * where one was correct costs a person one rejection; the reverse would cost
 * them a record they never made, so `splitUpdates` errs towards one.
 */
export function interpretQuickUpdate(
  text: string,
  context: InterpretContext,
): readonly QuickProposal[] {
  return splitUpdates(text).map((part, index) => interpretOne(part, index, context));
}
