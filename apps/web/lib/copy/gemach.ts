/**
 * The words for gemach loans and post-dated checks.
 *
 * The hardest thing this screen has to say is that money the family has already
 * promised is still in their account. Every sentence here is written against the
 * two ways that goes wrong: language that makes an ordinary arrangement sound
 * like a crisis, and language so soft that somebody spends the money.
 *
 * So: no exclamation marks, no "warning", no "danger", no blame. The alarming
 * thing is stated as a fact with a number and a date, because a fact with a date
 * is actionable and an adjective is not.
 */

export const gemach = {
  title: 'גמ״ח וצ׳קים',
  subtitle: 'הלוואות ללא ריבית שנפרעות בצ׳קים שנמסרו מראש',
  navLabel: 'גמ״ח וצ׳קים',

  details: 'לפרטים ולפעולות',
  emptyTitle: 'עוד לא רשום כאן גמ״ח',
  emptyBody:
    'אם לקחתם הלוואה מגמ״ח ומסרתם צ׳קים מראש, כאן רואים כמה צ׳קים עדיין בחוץ ומתי הם עשויים לרדת.',
  addLoan: 'להוסיף הלוואת גמ״ח',

  /* The figures the loan screen must show, in the specified words. */
  loanAmount: 'סכום ההלוואה',
  outstandingDebt: 'יתרה שעדיין חייבים',
  checksDelivered: 'צ׳קים שנמסרו מראש',
  checksOutstanding: 'צ׳קים שעדיין בחוץ',
  checksDueSoon: 'צ׳קים שעשויים לרדת בקרוב',
  nextCheck: 'הצ׳ק הבא',
  cleared: 'נפרע בפועל',
  returned: 'חזר ולא נפרע',
  cancelled: 'בוטל',
  replaced: 'הוחלף בצ׳ק אחר',

  /** The prominent line for a check that is out and has not cleared. */
  stillOut: 'הצ׳ק עדיין בחוץ ועשוי לרדת מהחשבון.',

  outstandingCount: (count: number, amountText: string) =>
    count === 1
      ? `צ׳ק אחד שנמסר ועדיין לא נפרע, בסך ${amountText}.`
      : `יש ${count} צ׳קים שנמסרו ועדיין לא נפרעו, בסך ${amountText}.`,
  nextCheckLine: (dateText: string, amountText: string) =>
    `הצ׳ק הבא עשוי לרדת ב־${dateText}: ${amountText}.`,
  overdueLine: (count: number, amountText: string) =>
    count === 1
      ? `צ׳ק אחד עבר את התאריך ועדיין לא נפרע, בסך ${amountText}.`
      : `${count} צ׳קים עברו את התאריך ועדיין לא נפרעו, בסך ${amountText}.`,
  returnedLine: (count: number) =>
    count === 1 ? 'צ׳ק אחד חזר וצריך לטפל בו.' : `${count} צ׳קים חזרו וצריך לטפל בהם.`,

  /** Said on the forecast, so nobody subtracts the checks a second time. */
  forecastIncluded: 'הצ׳קים האלה כבר נספרו בתחזית שלמעלה, כל אחד פעם אחת.',

  /* Coverage: do the checks cover what is left? */
  coverageTitle: 'האם הצ׳קים מכסים את מה שנשאר',
  coverageFull: 'הצ׳קים שבחוץ מכסים את כל היתרה.',
  coverageShort: (amountText: string) => `חסרים צ׳קים בסך ${amountText} כדי לכסות את היתרה.`,
  coverageExcess: (amountText: string) =>
    `יש צ׳קים בסך ${amountText} מעבר ליתרה. ייתכן שצ׳ק נפרע ולא נרשם.`,

  /* The states, as a person reads them. */
  states: {
    prepared: 'נכתב, עוד לא נמסר',
    delivered: 'נמסר',
    due: 'התאריך היום',
    overdue: 'עבר התאריך',
    deposited: 'הופקד בבנק',
    cleared: 'נפרע',
    returned: 'חזר',
    cancelled: 'בוטל',
    replaced: 'הוחלף',
  } as Readonly<Record<string, string>>,

  stateNotes: {
    prepared: 'הצ׳ק עדיין אצלכם. אף אחד לא יכול להפקיד אותו.',
    delivered: 'הצ׳ק אצל הגמ״ח. אפשר להפקיד אותו בכל רגע.',
    due: 'התאריך שכתוב על הצ׳ק הוא היום.',
    overdue: 'התאריך עבר והצ׳ק עדיין לא ירד. הוא עשוי לרדת בכל רגע.',
    deposited: 'הצ׳ק בבנק. עוד לא ידוע אם נפרע.',
    cleared: 'הכסף יצא מהחשבון והחוב קטן בהתאם.',
    returned: 'הבנק לא פרע את הצ׳ק. החוב לא קטן.',
    cancelled: 'הצ׳ק בוטל בהסכמה.',
    replaced: 'הוחלף בצ׳ק אחר.',
  } as Readonly<Record<string, string>>,

  /* Creating the loan. */
  newLoanTitle: 'הלוואת גמ״ח חדשה',
  lenderName: 'שם הגמ״ח',
  principal: 'סכום ההלוואה',
  startDate: 'תאריך ההלוואה',
  interestNote: 'גמ״ח לא גובה ריבית. נרשום אפס — וזה שונה מ״לא ידוע״.',
  agreement: 'ההסכם במילים שלכם',
  agreementHint: 'למשל: שישה תשלומים של 1,500 ₪, צ׳קים נמסרו מראש.',

  /* The plan. */
  planTitle: 'תוכנית ההחזר',
  planNone: 'עוד לא נרשמה תוכנית החזר.',
  installmentCount: 'כמה תשלומים',
  installmentAmount: 'סכום לתשלום',
  finalInstallment: 'תשלום אחרון שונה',
  finalInstallmentHint: 'למלא רק אם התשלום האחרון שונה מהשאר.',
  firstDueDate: 'תאריך התשלום הראשון',
  planTotal: 'סך התוכנית',
  savePlan: 'לשמור את התוכנית',
  planSaved: 'תוכנית ההחזר נשמרה.',
  planNote:
    'התוכנית היא מה שסוכם. הצ׳קים הם הנייר. התחזית סופרת את הצ׳קים בלבד, כדי לא לספור פעמיים.',

  /* Checks. */
  checksTitle: 'הצ׳קים',
  checksNone: 'עוד לא נרשמו צ׳קים להלוואה הזו.',
  addOne: 'להוסיף צ׳ק בודד',
  addSeries: 'ליצור סדרת צ׳קים',
  checkNumber: 'מספר הצ׳ק',
  checkNumberHint: 'לא חובה. אם תמלאו, נוכל להתאים אוטומטית לדף החשבון.',
  firstCheckNumber: 'מספר הצ׳ק הראשון',
  fromAccount: 'מאיזה חשבון',
  amount: 'סכום',
  dueDate: 'התאריך שכתוב על הצ׳ק',
  howMany: 'כמה צ׳קים',
  amountPerCheck: 'סכום לכל צ׳ק',
  finalCheckAmount: 'סכום הצ׳ק האחרון',
  intendedTotal: 'סך הכול שאמורים להחזיר',
  intendedTotalHint: 'נבדוק שהצ׳קים מסתכמים בדיוק לסכום הזה.',
  deliveredAlready: 'הצ׳קים כבר נמסרו',
  deliveredOn: 'תאריך המסירה',
  seriesCreated: (count: number) => `נוצרו ${count} צ׳קים.`,
  checkAdded: 'הצ׳ק נרשם.',

  previewTitle: 'לפני שיוצרים',
  previewNote: 'כך תיראה הסדרה. שום דבר לא נשמר עד שתאשרו.',
  previewTotalMatches: 'הסכומים מסתדרים בדיוק.',

  seriesWarnings: {
    total_does_not_match: 'סך הצ׳קים לא שווה לסכום שרשמתם. כדאי לבדוק לפני שיוצרים.',
    final_check_larger_than_others: 'הצ׳ק האחרון גדול מהשאר.',
    no_intended_total: 'לא נרשם סכום כולל, אז אין לנו מול מה לבדוק.',
    due_date_clamped: 'בחודשים קצרים התאריך עבר ליום האחרון בחודש.',
  } as Readonly<Record<string, string>>,

  /* Actions on a single check. */
  markDelivered: 'לסמן שנמסר',
  markDeliveredAll: 'לסמן שכל הצ׳קים נמסרו',
  markDeposited: 'לסמן שהופקד',
  markCleared: 'לסמן שנפרע',
  markReturned: 'לסמן שחזר',
  markCancelled: 'לבטל את הצ׳ק',
  markReplaced: 'להחליף בצ׳ק אחר',
  correct: 'לתקן טעות',

  clearedOn: 'תאריך הפירעון',
  returnedOn: 'תאריך החזרה',
  reason: 'מה קרה',
  reasonHint: 'משפט קצר. זה נשמר ביומן ואפשר יהיה לחזור אליו.',
  replacementTitle: 'הצ׳ק החדש',
  correctTitle: 'תיקון',
  correctNote:
    'התיקון מחזיר את המצב לאחור: אם הצ׳ק נרשם כנפרע בטעות, הכסף חוזר והחוב חוזר. שום דבר לא נמחק — היומן שומר גם את הטעות וגם את התיקון.',

  delivered: 'נמסרו',
  deliveredNone: 'עוד לא נמסר אף צ׳ק.',
  deliverAllNote: 'מסירת צ׳ק לא מקטינה את היתרה בבנק ולא את החוב. רק פירעון בפועל מקטין.',

  /* What clearing actually does, stated where the button is. */
  clearNote: 'סימון פירעון מוציא את הכסף מהחשבון ומקטין את החוב — פעם אחת.',

  closeTitle: 'לסגור את ההלוואה',
  closeReady: 'החוב אפס ואין צ׳קים בחוץ. אפשר לסגור.',
  closeNotReady: 'אי אפשר לסגור עדיין:',
  closeBlockDebt: (amountText: string) => `נשארה יתרה של ${amountText}.`,
  closeBlockChecks: (count: number) => `יש עוד ${count} צ׳קים שלא הוכרעו.`,
  close: 'לסגור את ההלוואה',
  closed: 'ההלוואה נסגרה.',

  historyTitle: 'מה קרה עם ההלוואה הזו',
  historyEmpty: 'עוד לא נרשמה פעילות.',
  historyActions: {
    'check.added': 'נרשם צ׳ק',
    'check.delivered': 'צ׳ק נמסר',
    'check.deposited': 'צ׳ק הופקד',
    'check.represented': 'צ׳ק הוגש שוב',
    'check.cleared': 'צ׳ק נפרע',
    'check.returned': 'צ׳ק חזר',
    'check.cancelled': 'צ׳ק בוטל',
    'check.replaced': 'צ׳ק הוחלף',
    'check.corrected': 'תוקן רישום של צ׳ק',
    'repayment_plan.set': 'נרשמה תוכנית החזר',
    'repayment_plan.updated': 'עודכנה תוכנית החזר',
  } as Readonly<Record<string, string>>,

  /* Matching an imported bank line to a check. */
  matchTitle: 'נראה שזו ירידה של צ׳ק',
  matchIntro: 'מצאנו צ׳קים שיכולים להתאים לשורה הזו. צריך שתבחרו — לא נחליט במקומכם.',
  matchNone: 'לא מצאנו צ׳ק שמתאים לשורה הזו.',
  matchAmbiguous:
    'יש יותר מצ׳ק אחד שמתאים באותה מידה. אתם יודעים איזה צ׳ק זה — אנחנו לא, ולא ננחש.',
  matchChoose: 'לשייך לצ׳ק הזה',
  matchClear: 'לבטל את השיוך',
  matchChosen: 'השורה משויכת לצ׳ק. באישור היבוא הצ׳ק ייסגר והחוב יקטן — פעם אחת.',
  matchConfidence: 'רמת התאמה',
  matchReasons: {
    same_account: 'אותו חשבון',
    exact_amount: 'אותו סכום בדיוק',
    check_number_in_reference: 'מספר הצ׳ק מופיע בשורה',
    due_date_exact: 'התאריך מתאים',
    due_date_within_window: 'התאריך בטווח סביר',
    presented_outside_expected_window: 'ירד רחוק מהתאריך שכתוב על הצ׳ק',
    payee_in_reference: 'שם הגמ״ח מופיע בשורה',
    only_candidate: 'הצ׳ק היחיד שמתאים',
  } as Readonly<Record<string, string>>,

  errors: {
    unknown_check: 'הצ׳ק הזה כבר לא קיים.',
    check_already_cleared: 'הצ׳ק הזה כבר סומן כנפרע.',
    clear_date_in_future:
      'אי אפשר לרשום פירעון בתאריך שעוד לא הגיע. אם הצ׳ק ירד, בחרו את היום שבו ירד.',
    check_transition_not_allowed: 'אי אפשר לעשות את זה למצב הנוכחי של הצ׳ק.',
    check_cannot_be_reverted: 'את המצב הזה אי אפשר לתקן ככה.',
    duplicate_check_number: 'מספר הצ׳ק הזה כבר רשום בחשבון הזה.',
    reason_required: 'צריך לכתוב מה קרה.',
    debt_not_closable: 'עדיין אי אפשר לסגור את ההלוואה.',
  } as Readonly<Record<string, string>>,
} as const;
