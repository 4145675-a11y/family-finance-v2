/**
 * The words for when a loan is expected to be repaid, and for being asked.
 *
 * Two subjects that a family feels very differently about, so they are worded
 * very differently.
 *
 * **The expectation** is a plan, and the screen must let a plan be absent. The
 * hardest sentence here is the one that says a loan with no repayment date is a
 * perfectly ordinary loan and not an unfinished form: "ללא צפי לפירעון" is
 * offered as an answer, not as a blank. A family that borrowed from a relative
 * on no terms at all has told us something true, and a product that keeps asking
 * them to fix it is calling them careless.
 *
 * **A demand** is somebody asking for their money, which is frightening. It is
 * written as a fact with a date and no adjective — no "warning", no "overdue",
 * no exclamation mark — because a date is actionable and an adjective is only
 * pressure. And the screen says plainly that writing one down changes nothing
 * about the loan, since the fear that recording a demand will somehow reopen a
 * debt already paid is exactly what stops people from writing it down.
 */

export const repayment = {
  expectation: {
    heading: 'צפי לפירעון',
    /**
     * The other two states, as a person reads them. The dated state needs no
     * word of its own: it shows the date, under the heading above.
     */
    none: 'ללא צפי לפירעון',
    unrecorded: 'לא נרשם צפי',
    unrecordedHint: 'אפשר לרשום תאריך, או לרשום שלא נקבע תאריך. שתי התשובות תקפות.',
    noneHint: 'כך זה סוכם — אין תאריך, וזה לא פרט חסר.',
    editSummary: 'לעדכן את הצפי לפירעון',
    choiceLabel: 'מה סוכם על הפירעון',
    choiceDated: 'יש תאריך צפוי',
    choiceNone: 'סוכם בלי תאריך',
    choiceUnrecorded: 'למחוק את מה שנרשם',
    dateLabel: 'תאריך הפירעון הצפוי',
    dateNeeded: 'בחרתם ״יש תאריך צפוי״ — צריך גם תאריך',
    saved: 'הצפי לפירעון עודכן.',
    unchanged: 'לא היה מה לשנות — הצפי נשאר כפי שהיה.',
    closedRefusal: 'החוב הזה נסגר, ואין בו עוד פירעון צפוי. דרישת פירעון אפשר לרשום גם עליו.',
  },
  demand: {
    heading: 'דרישות פירעון',
    /** Said on every screen that records one, because this is the fear. */
    harmless:
      'רישום דרישה אינו משנה דבר בחוב: לא את היתרה, לא את ההיסטוריה ולא את המצב. הוא רק שומר מה נתבקש ומתי.',
    empty: 'לא נרשמו דרישות פירעון.',
    addSummary: 'לרשום דרישת פירעון',
    demandedOn: 'מתי נתבקש',
    requestedDeadline: 'עד מתי ביקשו',
    requestedDeadlineHint: 'אם לא ננקב תאריך — אפשר להשאיר ריק.',
    amount: 'סכום שנתבקש',
    amountHint: 'אם לא ננקב סכום — אפשר להשאיר ריק. לא נרשום אפס.',
    note: 'מה נאמר',
    noDeadline: 'לא ננקב תאריך',
    noAmount: 'לא ננקב סכום',
    saved: 'דרישת הפירעון נרשמה. שום דבר בחוב לא השתנה.',
    deadlineBeforeDemand: 'התאריך שביקשו קודם ליום שבו נתבקש. אפשר לבדוק את שני התאריכים.',
    /** Shown on a card whose loan is already repaid. */
    onClosedDebt: 'החוב הזה נסגר. אפשר לרשום דרישה גם עליו, והוא יישאר סגור.',
  },
} as const;
