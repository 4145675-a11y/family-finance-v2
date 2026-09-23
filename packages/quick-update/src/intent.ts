import { containsPhrase, normaliseDescription } from '@family-finance/transaction-intelligence';

/**
 * What a sentence is asking to record.
 *
 * Five kinds, because those are the five things a family says out loud on the
 * way home. Anything else is `unknown`, which is an answer and not a failure:
 * a screen that says "לא הבנו" and offers the ordinary form is honest, and a
 * screen that guesses "probably an expense" writes money nobody meant.
 */
export type QuickIntent =
  'expense' | 'income' | 'debt_payment' | 'new_debt' | 'balance' | 'unknown';

interface IntentRule {
  readonly intent: QuickIntent;
  readonly phrases: readonly string[];
  /** Read before the others, for a phrase that would otherwise be swallowed. */
  readonly priority: number;
}

/**
 * The phrase table.
 *
 * Ordered by priority rather than by position, so a sentence carrying two
 * signals resolves the same way whichever order it says them in. The debt
 * phrases outrank the plain expense ones on purpose: "החזרתי 500 להלוואה" is a
 * repayment first and an outflow second, and recording it as an ordinary
 * expense would leave the balance untouched — the exact silent wrongness
 * 02-FINANCIAL-RULES.md forbids.
 */
const RULES: readonly IntentRule[] = [
  {
    intent: 'balance',
    priority: 40,
    phrases: ['יתרה', 'היתרה', 'נשאר בחשבון', 'יש בחשבון', 'במינוס', 'עדכון יתרה'],
  },
  {
    intent: 'debt_payment',
    priority: 30,
    phrases: [
      'החזרתי',
      'החזרנו',
      'פרעתי',
      'פרענו',
      'שילמתי להלוואה',
      'על חשבון ההלוואה',
      'על חשבון החוב',
      'החזר הלוואה',
      'תשלום לגמח',
      'תשלום לגמ"ח',
    ],
  },
  {
    intent: 'new_debt',
    priority: 30,
    phrases: ['לקחתי הלוואה', 'לוויתי', 'הלוואה חדשה', 'לקחנו הלוואה', 'קיבלתי הלוואה'],
  },
  {
    intent: 'income',
    priority: 20,
    phrases: [
      'קיבלתי',
      'קיבלנו',
      'נכנס',
      'נכנסו',
      'הכנסה',
      'משכורת',
      'שכר',
      'החזר מס',
      'קצבה',
      'מענק',
      'זיכוי',
    ],
  },
  {
    intent: 'expense',
    priority: 10,
    phrases: [
      'שילמתי',
      'שילמנו',
      'קניתי',
      'קנינו',
      'הוצאתי',
      'הוצאנו',
      'עלה',
      'עלתה',
      'חויבתי',
      'הוצאה',
      'תשלום',
      'משכתי',
    ],
  },
];

export interface IntentReading {
  readonly intent: QuickIntent;
  /** The phrase that decided it, so the screen can say why. */
  readonly matchedPhrase: string | null;
}

/**
 * The intent a sentence carries.
 *
 * The whole table is consulted and the highest priority match wins, rather than
 * the first one found. `readAmount` and `readWhen` are not called from here:
 * the intent is about the verb, and mixing the two is how "3" in "ב-3 לחודש"
 * starts meaning three shekels.
 */
export function readIntent(text: string): IntentReading {
  const folded = normaliseDescription(text);
  let best: { rule: IntentRule; phrase: string } | null = null;

  for (const rule of RULES) {
    for (const phrase of rule.phrases) {
      if (!containsPhrase(folded, phrase)) continue;
      if (best === null || rule.priority > best.rule.priority) {
        best = { rule, phrase };
      }
    }
  }

  if (best === null) return { intent: 'unknown', matchedPhrase: null };
  return { intent: best.rule.intent, matchedPhrase: best.phrase };
}
