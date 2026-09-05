import type { EngineNotice } from '@family-finance/finance-engine';

import { count, formatBusinessDate, money } from '../format';
import { copy } from './copy';

/**
 * Turns what the engine said into what the family reads.
 *
 * The engine returns codes and numbers; this is the only place those become
 * sentences. Two consequences worth stating: a code with no entry here is a bug
 * that `copy.test.ts` catches rather than an empty line on a screen, and changing
 * how something is worded never touches the deterministic core.
 */

type Params = Readonly<Record<string, number | string>>;

const num = (params: Params | undefined, key: string): number => {
  const value = params?.[key];
  return typeof value === 'number' ? value : 0;
};

const text = (params: Params | undefined, key: string): string => {
  const value = params?.[key];
  return typeof value === 'string' ? value : '';
};

const categoryName = (key: string): string => copy.budget.categories[key] ?? key;

/** Plain-Hebrew names for the parts of the safe-spend calculation. */
export const BREAKDOWN_LABELS: Readonly<Record<string, string>> = {
  verified_liquid_cash: 'כסף שכבר קיים בחשבונות',
  certain_income: 'כסף שבטוח ייכנס עד סוף החודש',
  approved_business_transfer: 'כסף שאושר להעברה מהעסק',
  essential_needs: 'דברים שחייבים לשלם',
  certain_due_items: 'תשלומים נוספים שכבר סגורים',
  debt_minimums: 'משכנתה והחזרי חובות',
  protected_reserves: 'כסף ששמור למטרה אחרת',
  safety_floor: 'כסף שמשאירים בצד לביטחון',
  reconciliation_gap: 'הפרש בין החשבון לבין מה שרשום',

  manual_floor: 'סכום שקבעתם בעצמכם',
  essentials_until_next_income: 'מה שחייבים עד ההכנסה הבאה',
  incident_buffer: 'כסף לתקלה בלתי צפויה',
  revolving_avoidance: 'כדי לא להיכנס שוב למינוס',

  received_income: 'כמה נכנס בפועל',
  paid_expenses: 'כמה יצא על העסק',
  tax_reserve: 'כמה שמרנו למסים',
  certain_obligations: 'תשלומים שהעסק כבר התחייב אליהם',
  operating_reserve: 'כסף שמשאירים בצד לעסק',
  overdue_payables: 'תשלומים של העסק שכבר איחרו',
  liquid_business_cash: 'כמה יש בחשבון העסק',
  approved_expenses: 'הוצאות מאושרות',
  realized_profit: 'רווח שכבר בידיים',
  available_cash: 'כסף פנוי בעסק',
  household_need: 'מה שהבית צריך עד סוף החודש',
};

export function breakdownLabel(key: string): string {
  return BREAKDOWN_LABELS[key] ?? key;
}

/** Plain-Hebrew names for the parts of the reliability score. */
export const QUALITY_LABELS: Readonly<Record<string, string>> = {
  balance_freshness: 'כמה היתרות מעודכנות',
  approval_backlog: 'כמה פעולות כבר אושרו',
  classification: 'כמה פעולות מסודרות בקטגוריה',
  reconciliation: 'האם הכול מסתדר מול החשבון',
  debt_completeness: 'כמה ידוע על החובות',
};

export function qualityLabel(key: string): string {
  return QUALITY_LABELS[key] ?? key;
}

/** The six things that could go wrong, named the way a person would say them. */
export const SCENARIO_LABELS: Readonly<Record<string, string>> = {
  no_business_income: 'אם לא ייכנס עוד כסף מהעסק החודש',
  receipts_down_30: 'אם ייכנס שליש פחות מהעסק',
  receipt_delayed_14d: 'אם תשלום שבטוח היה מגיע יאחר בשבועיים',
  private_debt_demand: 'אם מישהו יבקש בבת אחת את הכסף שהלווה לנו',
  essential_shock: 'אם תהיה הוצאה גדולה ובלתי צפויה',
  unclassified_card_charge: 'אם יגיע חיוב אשראי גדול שעוד לא ראינו',
};

export function scenarioLabel(key: string): string {
  return SCENARIO_LABELS[key] ?? key;
}

/** What the one recommended action says. */
export const ACTION_COPY: Readonly<Record<string, (params?: Params) => string>> = {
  close_funding_gap: (p) => `להשלים ${money(num(p, 'amountMinor'))} כדי לעבור את החודש בשלום`,
  move_a_payment: (p) => `להזיז תשלום אחד לפני ${formatBusinessDate(text(p, 'date'))}`,
  confirm_balances: () => 'לעדכן יתרות ולסדר כמה פעולות',
  fund_next_step: (p) => `להשלים ${money(num(p, 'amountMinor'))} לתשלום הבא בתור`,
  stop_new_debt: () => 'לעצור לקיחת חוב חדש החודש',
  accelerate_repayment: () => 'להפנות כסף פנוי לחוב היקר ביותר',
  hold_position: () => 'להמשיך כרגיל ולשמור על העדכונים',
};

export const ACTION_WHY: Readonly<Record<string, (params?: Params) => string>> = {
  close_funding_gap: () => 'זה הדבר היחיד שבאמת דוחק כרגע.',
  move_a_payment: () => 'אם נזיז אותו מראש, לא ניכנס למינוס ולא נשלם עמלה.',
  confirm_balances: (p) =>
    num(p, 'missingCount') > 0
      ? `בלי ${count(num(p, 'missingCount'))} הפרטים האלה אי אפשר לתת מספר מדויק.`
      : 'עם נתונים מעודכנים המספרים כאן יהיו מדויקים.',
  fund_next_step: () => 'כשמשלימים לפי הסדר, שאר החודש נשאר יציב.',
  stop_new_debt: () => 'חוב חדש מבטל את מה ששילמנו החודש.',
  accelerate_repayment: () => 'יש מספיק בצד, אז כל שקל נוסף חוסך הכי הרבה כאן.',
  hold_position: () => 'אין כרגע משהו דחוף. זה מצב טוב.',
};

const NOTICE_COPY: Readonly<Record<string, (params?: Params) => string>> = {
  // Assumptions behind the safe amount.
  'assumption.verified_balances_only': () =>
    'הסכום מבוסס על יתרות שאישרתם מול הבנק. יתרה ישנה מורידה את הדיוק.',
  'assumption.certain_income_within_period': () =>
    'הכנסה נחשבת רק אם היא אמורה להיכנס לפני סוף החודש.',
  'assumption.debt_minimums_full_month': () => 'החזרי החובות נספרים במלואם לחודש הנוכחי.',

  // Business.
  'business.none_defined': () => copy.business.none,
  'business.available_cash_negative': () =>
    'בחשבון העסק אין כרגע כסף פנוי — ההתחייבויות גדולות מהיתרה.',
  'business.no_realized_profit': () =>
    'עוד אין רווח שנשאר בידיים, ולכן כל העברה תהיה על חשבון העסק.',
  'business.overdue_payables': (p) =>
    `לעסק יש תשלומים באיחור בסך ${money(num(p, 'amountMinor'))}. הם יורדים לפני כל העברה הביתה.`,

  // Warnings on the home screen.
  'warn.failure_day': (p) =>
    `לפי התחזית, ב־${formatBusinessDate(text(p, 'date'))} הכסף עלול להיגמר.`,
  'warn.private_debt_callable': (p) =>
    `יש ${money(num(p, 'amountMinor'))} שהלוו לנו ועלולים להתבקש בחזרה החודש. לא סמכנו עליהם.`,

  // What is missing.
  'missing.never_verified_accounts': (p) =>
    `${count(num(p, 'count'))} חשבונות שעוד לא אישרתם את היתרה שלהם`,
  'missing.pending_approvals': (p) => `${count(num(p, 'count'))} פעולות שממתינות לאישור`,
  'missing.unclassified_transactions': (p) => `${count(num(p, 'count'))} פעולות בלי קטגוריה`,
  'missing.reconciliation_gap': (p) =>
    `הפרש של ${money(num(p, 'amountMinor'))} בין החשבון לבין מה שרשום`,
  'missing.unclassified_cash': (p) => `${money(num(p, 'amountMinor'))} מזומן שעוד לא סודר`,
  'missing.incomplete_debts': (p) =>
    `${count(num(p, 'count'))} חובות שלא ידועה בהם הריבית או ההחזר החודשי`,

  // Reliability details.
  'quality.freshness.none': () => 'עוד לא אישרתם אף יתרה',
  'quality.freshness.oldest': (p) =>
    `היתרה הישנה ביותר עודכנה לפני ${count(num(p, 'days'))} ימים`,
  'quality.approvals': (p) =>
    `${count(num(p, 'pending'))} מתוך ${count(num(p, 'total'))} ממתינות לאישור`,
  'quality.classification': (p) => `${count(num(p, 'count'))} פעולות בלי קטגוריה`,
  'quality.reconciliation.clean': () => 'הכול מסתדר מול החשבון',
  'quality.reconciliation.open': () => 'יש הפרש או מזומן שעוד לא סודר',
  'quality.debts': (p) =>
    `${count(num(p, 'complete'))} מתוך ${count(num(p, 'total'))} חובות עם כל הפרטים`,

  // Where we stand.
  'mode.gap_within_14_days': (p) =>
    `בשבועיים הקרובים חסרים ${money(num(p, 'amountMinor'))} לתשלום שחייב לצאת.`,
  'mode.low_point_negative': (p) =>
    `בשלב מסוים החודש הכסף עלול להיגמר, בפער של ${money(num(p, 'amountMinor'))}.`,
  'mode.arrears': () => 'יש תשלום חיוני או חוב דחוף שכבר איחר.',
  'mode.minimums_uncovered': () => 'לא כל ההחזרים החודשיים מכוסים כרגע.',
  'mode.no_cushion': (p) =>
    `שום דבר לא נופל כרגע, אבל חסרים ${money(num(p, 'shortfallMinor'))} כדי שיהיה כסף בצד.`,
  'mode.new_debt_this_period': () => 'יש כסף בצד, אבל החודש נוסף חוב חדש.',
  'mode.reserve_but_not_ready': () => 'יש כסף בצד ואין חוב חדש, אבל עוד מוקדם להאיץ החזרים.',
  'mode.blocker.forecast_negative': () => 'התחזית הזהירה מסתיימת במינוס.',
  'mode.blocker.stress_failed': () => 'לפחות מצב אחד שבדקנו לא מסתדר.',
  'mode.no_debt_large_cushion': () => 'אין חוב צרכני והכרית גדולה. אפשר להסתכל קדימה.',
  'mode.debt_falling_cushion_growing': (p) =>
    `החובות ירדו ב־${money(num(p, 'amountMinor'))} והכרית ממשיכה לגדול.`,
  'mode.all_conditions_met': () => 'אין פיגור, ההחזרים מכוסים ויש כסף בצד.',
  'mode.watch.close_gap_first': () => 'סגירת הפער היא הצעד הראשון.',
  'mode.watch.low_point': () => 'אם הכסף עלול להיגמר באמצע החודש, נחזור למצב דחוף.',
  'mode.watch.new_debt': () => 'חוב חדש יחזיר אותנו צעד אחורה.',
  'mode.watch.month_without_new_debt': () => 'חודש שמסתיים בלי חוב חדש פותח את השלב הבא.',
  'mode.watch.repayment_conditions': () => 'כשהתחזית תהיה חיובית, אפשר יהיה להאיץ החזרים.',
  'mode.watch.new_consumer_debt': () => 'חוב צרכני חדש יחזיר אותנו צעד אחורה.',
  'mode.watch.cash_below_floor': () => 'אם הכסף בצד ירד, נחזור לשלב הקודם.',

  // Budget.
  'budget.category_over': (p) =>
    `ב${categoryName(text(p, 'categoryKey'))} יצא ${money(num(p, 'amountMinor'))} יותר ממה שתכננו.`,
  'budget.first_month_draft': () => copy.budget.draftNote,
  'budget.stale': (p) => `הנתונים כאן בני ${count(num(p, 'days'))} ימים. כדאי לעדכן.`,
  'budget.no_verified_data': () => 'עוד לא אישרתם יתרות, ולכן זו הערכה בלבד.',
  'budget.no_lines': () => copy.budget.empty,
  'budget.spend_without_line': (p) =>
    `${count(num(p, 'count'))} קטגוריות שיצא בהן כסף בלי שתכננו להן סכום.`,
  'budget.assumption.pace_from_elapsed_days': () =>
    'התחזית לסוף החודש מבוססת על הקצב מתחילת החודש.',
  'budget.assumption.pending_counted_as_spent': () =>
    'פעולות שממתינות לאישור נספרות כאילו כבר יצאו.',
  'budget.transfer.exceeds_source': (p) =>
    `ב${categoryName(text(p, 'categoryKey'))} יש רק ${money(num(p, 'availableMinor'))} להעביר.`,
  'budget.transfer.below_spent': (p) =>
    `ב${categoryName(text(p, 'categoryKey'))} כבר יצאו ${money(num(p, 'spentMinor'))}. אי אפשר לרדת מתחת לזה.`,

  // Food.
  'food.large_purchase': (p) => copy.food.largePurchase(num(p, 'amountMinor')),
  'food.week_over_pace': (p) => `השבוע יצא ${money(num(p, 'amountMinor'))} יותר מהתכנון.`,
  'food.stale': (p) => `רישומי האוכל בני ${count(num(p, 'days'))} ימים. כדאי לעדכן.`,
  'food.assumption.week_starts_sunday': () => 'השבוע נספר מיום ראשון.',
  'food.assumption.week_capped_by_month': () => 'הסכום השבועי לעולם לא גדול ממה שנשאר לחודש.',
  'food.assumption.large_purchase_excluded_from_pace': () =>
    'קנייה גדולה אחת לא נחשבת כקצב קבוע.',
};

/** Every code the copy layer knows how to say. Used by the coverage test. */
export const KNOWN_NOTICE_CODES = Object.keys(NOTICE_COPY);

/**
 * Says one notice.
 *
 * Falls back to the raw code rather than to an empty string: a missing sentence
 * should be visible in development, not silently swallowed on a screen.
 */
export function sayNotice(item: EngineNotice): string {
  const say = NOTICE_COPY[item.code];
  return say === undefined ? item.code : say(item.params);
}

export function sayNotices(items: readonly EngineNotice[]): string[] {
  return items.map(sayNotice);
}
