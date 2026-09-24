/**
 * The words for the quick update.
 *
 * Short on purpose, and much shorter than it was. The screen used to explain
 * which of two readers a person was about to use, quote every fragment it had
 * read each figure from, and carry a paragraph of privacy prose above the fold —
 * so a family typing one sentence had to scroll past an essay to reach the
 * question they needed to answer. All of that was true and none of it was what
 * they came for.
 *
 * What is left on the main path: one question, one field, one button, and a
 * proposal that fits on a phone. The rest sits behind a closed `פרטים`
 * disclosure, which is where a person goes when they want it rather than where
 * it is put in front of them.
 *
 * The microphone sentence stayed in that disclosure rather than disappearing:
 * some browsers do the listening on the device and some send the sound to the
 * company that made them, this product cannot promise which, and a family is
 * entitled to be able to find that out.
 */

export const quick = {
  title: 'עדכון מהיר',
  navLabel: 'עדכון מהיר',

  /** The whole screen, in one question. */
  heading: 'מה לעדכן?',
  captureLabel: 'מה לעדכן?',
  placeholder: 'למשל: שילמתי 120 שקל בסופר היום',

  /** One sentence of transparency, and only one. */
  promise: 'נוצרת הצעה בלבד; שום פעולה אינה נשמרת בלי אישור.',

  /** The one primary action. */
  propose: 'הצע עדכון',
  proposing: 'קוראים…',
  clear: 'ניקוי',

  startDictation: 'הקלטה',
  stopDictation: 'עצירה',
  listening: 'מקשיבים. מה שייקלט יופיע בתיבה, ואפשר לתקן לפני שליחה.',

  /** Everything else lives behind a closed disclosure. */
  detailsSummary: 'פרטים',
  detailsBody:
    'ההקלטה נעשית בדפדפן ואינה נשלחת מכאן; נשלח רק הטקסט שאתם רואים ומאשרים, ורק כשאתם לוחצים. לא נשלחות יתרות, שמות או היסטוריה. כשאין חיבור לשירות חיצוני, המשפט נקרא כאן לפי כללים — ובשני המקרים זו הצעה שממתינה לאישור שלכם.',
  noDictation: 'הדפדפן הזה לא תומך בהכתבה. אפשר להקליד.',

  /** The proposal card. */
  draftBadge: 'טיוטה — עדיין לא נשמרה',
  existingLender: 'כרטיס קיים',
  lenderLabel: 'מלווה',
  /** When it has to go back. A different fact from when it happened. */
  dueLabel: 'פירעון',
  dateLabel: 'תאריך',
  confirm: 'אישור ורישום',
  notUnderstood: 'לא הבנו מה לעדכן. אפשר לנסח אחרת.',

  fieldAmount: 'סכום',
  fieldAccount: 'חשבון',
  fieldDebt: 'הלוואה',
  fieldDate: 'תאריך',
  chooseAccount: 'בחרו חשבון',
  chooseDebt: 'בחרו הלוואה',
  accountQuestion: (amount: string) => `לאיזה חשבון נכנסו ${amount}?`,
  accountQuestionOut: (amount: string) => `מאיזה חשבון יצאו ${amount}?`,
  creditorName: 'למי חייבים',
  creditorHint: 'כרטיס מלווה חדש ייפתח בשם הזה.',

  actionTitle: {
    expense: 'הוצאה',
    income: 'הכנסה',
    transfer: 'העברה בין חשבונות',
    new_principal: 'הלוואה נוספת',
    new_debt: 'הלוואה חדשה',
    debt_repayment: 'החזר הלוואה',
    balance: 'עדכון יתרה',
    note: 'הערה',
    unknown: 'לא ברור',
  } as Record<string, string>,

  /** Two actions this screen deliberately does not record. */
  elsewhere: {
    transfer: 'העברה בין שני חשבונות צריכה לדעת מאיפה ולאן. את זה עושים במסך הרישום.',
    note: 'הערה נרשמת בכרטיס המלווה שהיא שייכת אליו.',
  } as Record<string, string>,
  goToEntry: 'למסך הרישום',
  goToLenders: 'לכרטיסי המלווים',

  emptyTitle: 'עוד אין משק בית',
  emptyReason: 'כדי לרשום עדכון צריך קודם להקים משק בית וחשבון אחד.',
  addAccount: 'הוספת חשבון',
} as const;
