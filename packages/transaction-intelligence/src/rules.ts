import type {
  BudgetCategoryKey,
  ConfidenceLevel,
  TransactionClass,
} from '@family-finance/contracts';

/**
 * What the bank's own words mean.
 *
 * A table, not a model. Every suggestion this product makes about a statement
 * line can be traced to one row here, reproduced from the same input, and argued
 * with by a person reading the row. That is the whole reason it is written this
 * way: `AI לא מחשב`, and a family that is told "this is a bank charge" is
 * entitled to know why.
 *
 * Each rule matches on the *folded* description (see `normalise.ts`), so one row
 * covers the four ways a bank writes the same charge. A rule may also require a
 * direction, because the same words mean different things coming in and going
 * out: "העברה" leaving the account is a payment, arriving it is income.
 *
 * Confidence is part of the rule, not computed from it:
 *
 *   * `high` — the phrase is the bank's own term for exactly this thing. "מסלול"
 *     on an Israeli current account is an account-plan fee and nothing else.
 *   * `medium` — the phrase names a family of things and the row is probably one
 *     of them. "הוראת קבע" says how the money left, not what it paid for.
 *   * `low` — a hint worth showing, never worth acting on.
 *
 * Adding a bank means adding rows here. Nothing downstream changes, which is why
 * recognition is kept apart from the approval pipeline.
 */
export interface BuiltInRule {
  /** Stable id. Appears in the audit trail, so it must not be renamed lightly. */
  readonly id: string;
  /** Any one of these, matched as whole words against the folded description. */
  readonly phrases: readonly string[];
  readonly class: TransactionClass;
  readonly budgetCategoryKey: BudgetCategoryKey | null;
  /** Null when the words mean the same in both directions. */
  readonly direction: 'inflow' | 'outflow' | null;
  readonly confidence: ConfidenceLevel;
  /** One short Hebrew sentence. Names the evidence; never a number. */
  readonly explanation: string;
  /** Restrict to a bank, when the term is that bank's own. */
  readonly banks?: readonly string[];
}

/**
 * Ordered by specificity: the first rule that matches wins.
 *
 * So "עמלה מסלול מורחב" is a bank fee rather than merely a fee, and "חיוב
 * הלוואה" is a repayment rather than a standing order, even though a looser rule
 * further down would also have matched.
 */
export const BUILT_IN_RULES: readonly BuiltInRule[] = [
  // ---- Bank charges -------------------------------------------------------
  {
    id: 'fee.account_plan',
    // "ע. מסלול מורחב" folds to "עמלה מסלול מורחב"; the plan names vary, the word
    // מסלול does not. This is the account-plan charge every Israeli bank makes.
    phrases: ['עמלה מסלול', 'מסלול מורחב', 'מסלול בסיסי', 'עמלת מסלול', 'דמי מסלול'],
    class: 'bank_fee',
    budgetCategoryKey: null,
    direction: 'outflow',
    confidence: 'high',
    explanation: 'הבנק גובה עמלה על מסלול החשבון — כך הוא קורא לה בדף.',
  },
  {
    id: 'fee.management',
    phrases: [
      'עמלת ניהול',
      'דמי ניהול',
      'עמלה ניהול חשבון',
      'עמלת שורה',
      'דמי כרטיס',
      'עמלת כרטיס',
      'עמלה מינימום',
    ],
    class: 'bank_fee',
    budgetCategoryKey: null,
    direction: 'outflow',
    confidence: 'high',
    explanation: 'זו עמלה של הבנק, לא הוצאה של הבית.',
  },
  {
    id: 'fee.generic',
    phrases: ['עמלה'],
    class: 'bank_fee',
    budgetCategoryKey: null,
    direction: 'outflow',
    confidence: 'medium',
    explanation: 'השורה נקראת "עמלה", אבל לא כתוב עמלה על מה.',
  },
  {
    id: 'interest.charged',
    phrases: ['ריבית חובה', 'ריבית חריגה', 'הפרשי ריבית', 'ריבית על יתרה'],
    class: 'bank_interest',
    budgetCategoryKey: null,
    direction: 'outflow',
    confidence: 'high',
    explanation: 'ריבית שהבנק חייב על היתרה — לא קרן ולא הוצאה של הבית.',
  },

  // ---- Loans --------------------------------------------------------------
  {
    id: 'loan.repayment',
    // The line the requirement names. It says a loan was charged; it does not say
    // whose. The lender is resolved separately, and never guessed.
    phrases: [
      'חיוב הלוואה',
      'החזר הלוואה',
      'פרעון הלוואה',
      'תשלום הלוואה',
      'הלוואה חיוב',
      'גרירת הלוואה',
    ],
    class: 'loan_repayment',
    budgetCategoryKey: null,
    direction: 'outflow',
    confidence: 'high',
    explanation: 'השורה אומרת שזו הלוואה שנפרעה. את ההלוואה עצמה צריך לבחור.',
  },
  {
    id: 'loan.mortgage',
    phrases: ['משכנתא', 'משכנתה', 'החזר משכנתא'],
    class: 'loan_repayment',
    budgetCategoryKey: 'housing_and_bills',
    direction: 'outflow',
    confidence: 'high',
    explanation: 'החזר משכנתא — צריך לבחור לאיזו משכנתא זה שייך.',
  },
  {
    id: 'loan.received',
    phrases: ['קבלת הלוואה', 'הלוואה זיכוי', 'מימוש הלוואה'],
    class: 'loan_received',
    budgetCategoryKey: null,
    direction: 'inflow',
    confidence: 'high',
    explanation: 'כסף של הלוואה שנכנס לחשבון — זו אינה הכנסה.',
  },

  // ---- Income -------------------------------------------------------------
  {
    id: 'income.salary',
    phrases: ['משכורת', 'שכר', 'תלוש', 'שכר עבודה'],
    class: 'salary',
    budgetCategoryKey: null,
    direction: 'inflow',
    confidence: 'high',
    explanation: 'הכנסה שנקראת משכורת או שכר.',
  },
  {
    id: 'income.benefit',
    phrases: ['ביטוח לאומי', 'קצבה', 'קצבת', 'מזונות', 'הבטחת הכנסה'],
    class: 'benefit',
    budgetCategoryKey: null,
    direction: 'inflow',
    confidence: 'high',
    explanation: 'קצבה או תשלום מהמדינה.',
  },
  {
    id: 'income.refund',
    phrases: ['זיכוי', 'החזר', 'ביטול עסקה', 'השבה'],
    class: 'refund',
    budgetCategoryKey: null,
    direction: 'inflow',
    confidence: 'medium',
    explanation: 'כסף שחוזר — נראה כמו זיכוי או החזר.',
  },

  // ---- Cards and cash -----------------------------------------------------
  {
    id: 'card.settlement',
    phrases: [
      'כרטיס אשראי',
      'ישראכרט',
      'מאסטרקארד',
      'ויזה',
      'דיינרס',
      'כאל',
      'מקס',
      'לאומי קארד',
    ],
    class: 'card_settlement',
    budgetCategoryKey: null,
    direction: 'outflow',
    confidence: 'high',
    explanation: 'חיוב מרוכז של כרטיס האשראי — הפירוט עצמו בדף הכרטיס.',
  },
  {
    id: 'cash.withdrawal',
    phrases: ['כספומט', 'משיכה במזומן', 'משיכת מזומן', 'משיכה כספומט'],
    class: 'cash_withdrawal',
    budgetCategoryKey: 'cash_and_small',
    direction: 'outflow',
    confidence: 'high',
    explanation: 'מזומן שנמשך — מה נעשה בו לא כתוב בדף.',
  },
  {
    id: 'cheque.presented',
    phrases: ['שיק', "צ'ק", 'שק מס'],
    class: 'cheque',
    budgetCategoryKey: null,
    direction: 'outflow',
    confidence: 'medium',
    explanation: 'שיק שנפרע מהחשבון.',
  },

  // ---- Bills --------------------------------------------------------------
  {
    id: 'bill.utility',
    phrases: [
      'חברת החשמל',
      'חשמל',
      'מקורות',
      'מים',
      'ארנונה',
      'עיריית',
      'גז',
      'בזק',
      'הוט',
      'פרטנר',
      'סלקום',
      'יס',
    ],
    class: 'utility_bill',
    budgetCategoryKey: 'housing_and_bills',
    direction: 'outflow',
    confidence: 'high',
    explanation: 'חשבון שוטף של הבית — חשמל, מים, ארנונה או תקשורת.',
  },
  {
    id: 'bill.insurance',
    phrases: ['ביטוח', 'הפניקס', 'הראל', 'מגדל', 'כלל ביטוח', 'מנורה', 'איילון'],
    class: 'insurance',
    budgetCategoryKey: 'housing_and_bills',
    direction: 'outflow',
    confidence: 'medium',
    explanation: 'נראה כמו פרמיית ביטוח.',
  },
  {
    id: 'bill.tax',
    phrases: ['מס הכנסה', 'מעם', 'מס ערך מוסף', 'רשות המסים', 'מקדמות'],
    class: 'tax',
    budgetCategoryKey: null,
    direction: 'outflow',
    confidence: 'high',
    explanation: 'תשלום מס.',
  },

  // ---- Movement without a purpose ----------------------------------------
  {
    id: 'transfer.standing_order',
    phrases: ['הוראת קבע'],
    class: 'standing_order',
    budgetCategoryKey: null,
    direction: 'outflow',
    confidence: 'medium',
    explanation: 'הוראת קבע — כתוב איך הכסף יצא, לא על מה.',
  },
  {
    id: 'transfer.between_accounts',
    phrases: ['העברה בין חשבונות', 'העברה עצמית', 'העברה לחשבון'],
    class: 'internal_transfer',
    budgetCategoryKey: null,
    direction: null,
    confidence: 'medium',
    explanation: 'נראית כמו העברה בין חשבונות של הבית — לא הוצאה ולא הכנסה.',
  },
];

/** Where a counterparty can be read off the line, and how. */
export const COUNTERPARTY_PREFIXES: readonly string[] = [
  'העברה ל',
  'העברה מ',
  'זיכוי מ',
  'חיוב ל',
  'תשלום ל',
  'לפקודת',
];
