import type { ConfidenceLevel, TransactionClass } from '@family-finance/contracts';

/**
 * Hebrew for what the classifier says.
 *
 * The words live here rather than beside the rules for the reason every other
 * copy table in this app does: they are read by a family under stress about
 * money, and they have to be reviewable as Hebrew without opening the classifier.
 * The rule table carries codes; this carries the sentences.
 */

export const CLASS_LABEL: Record<TransactionClass, string> = {
  bank_fee: 'עמלת בנק',
  bank_interest: 'ריבית בנק',
  loan_repayment: 'החזר הלוואה',
  loan_received: 'קבלת הלוואה',
  salary: 'משכורת',
  benefit: 'קצבה',
  card_settlement: 'חיוב כרטיס אשראי',
  standing_order: 'הוראת קבע',
  cash_withdrawal: 'משיכת מזומן',
  utility_bill: 'חשבון בית',
  insurance: 'ביטוח',
  tax: 'מס',
  internal_transfer: 'העברה בין חשבונות',
  cheque: 'שיק',
  purchase: 'קנייה',
  refund: 'זיכוי',
  unclassified: 'לא מזוהה',
};

/**
 * What each confidence level says to the family.
 *
 * Deliberately not "high/medium/low" translated. A person reading a review screen
 * needs to know what is being asked of them, so the words describe the action:
 * this one is clear, this one is worth a look, this one is yours to decide.
 */
export const CONFIDENCE_LABEL: Record<ConfidenceLevel, string> = {
  high: 'זיהוי ברור',
  medium: 'כדאי לבדוק',
  low: 'צריך להחליט',
};

export const CATEGORY_LABEL: Record<string, string> = {
  food: 'אוכל',
  housing_and_bills: 'דיור וחשבונות',
  transport_and_fuel: 'תחבורה ודלק',
  health: 'בריאות',
  education: 'חינוך',
  clothing: 'ביגוד',
  celebrations_and_gifts: 'שמחות ומתנות',
  cash_and_small: 'מזומן וקטנות',
  holidays: 'חגים',
  other: 'אחר',
};
