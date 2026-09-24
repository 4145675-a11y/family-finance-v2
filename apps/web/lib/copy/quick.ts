/**
 * The words for the quick update.
 *
 * The hard sentence on this screen is the one about the microphone. It has to be
 * honest without being frightening: some browsers do the listening on the device
 * and some send the sound to the company that made them, and this product does
 * not know which one a family is holding. So it says that, says what it does
 * with the result, and leaves typing as the complete path rather than as a
 * fallback for the worried.
 *
 * Everything else is written the way the rest of the product is written: what
 * was understood, in a sentence, with what is missing named as a thing to fill
 * in rather than as a mistake that was made.
 */

export const quick = {
  title: 'עדכון מהיר',
  subtitle: 'משפט אחד, ואנחנו נציע מה לרשום',
  navLabel: 'עדכון מהיר',

  /*
   * The promise, in the words the upload screen already uses.
   *
   * A person meeting this screen for the first time has no way to know that
   * pressing "מה הבנתם?" does not save anything — and the one thing they need to
   * know before typing about money is where the point of no return is. The upload
   * screen says it above the file picker; this says it above the box.
   */
  promise: 'שום דבר לא נרשם לפני שתראו מה הבנו ותאשרו.',
  promiseBody:
    'יש שתי דרכים לקרוא את המשפט: ״מה הבנתם?״ קוראת אותו כאן לפי כללים, ו״הבנה חכמה״ שולחת את הטקסט לשירות חיצוני כדי לקרוא ניסוח חופשי. שתיהן מציעות בלבד.',
  proposalNotice: 'זו הצעה. אפשר לתקן כל שדה, ורק לחיצה על ״אישור ורישום״ רושמת.',

  captureLabel: 'מה קרה?',
  placeholder: 'למשל: שילמתי 120 שקל בסופר היום',
  hint: 'אפשר לכתוב כמה עדכונים במשפט אחד. כל אחד יאושר בנפרד.',

  interpret: 'מה הבנתם?',
  reading: 'קוראים…',
  clear: 'ניקוי',

  startDictation: 'הקלטה',
  stopDictation: 'עצירה',
  listening: 'מקשיבים. מה שייקלט יופיע בתיבה, ואפשר לתקן לפני שליחה.',
  dictationNotice:
    'ההכתבה נעשית בידי הדפדפן, ובחלק מהדפדפנים היא מתבצעת בשרתים של יצרן הדפדפן. שום הקלטה לא נשמרת אצלנו, ומה שנשלח הוא רק הטקסט שאתם רואים ומאשרים. מי שמעדיף — יכול להקליד.',
  noDictation: 'הדפדפן הזה לא תומך בהכתבה. אפשר להקליד, וזה בדיוק אותו דבר.',

  proposalsTitle: 'מה הבנו',
  category: 'קטגוריה',
  categoryUndecided: 'בלי קטגוריה — אפשר לקבוע אחר כך',
  approve: 'אישור ורישום',
  nothingYet: 'עוד לא נרשם כלום. תוכלו לבדוק, לתקן ולאשר.',

  fieldAmount: 'סכום',
  fieldAccount: 'חשבון',
  fieldDebt: 'הלוואה',
  fieldDate: 'תאריך',
  chooseAccount: 'בחרו חשבון',
  chooseDebt: 'בחרו הלוואה',

  assumedToday: 'לא נאמר תאריך, אז נרשם להיום. אפשר לשנות.',

  intent: {
    expense: 'כסף שיצא',
    income: 'כסף שנכנס',
    debt_payment: 'החזר הלוואה',
    new_debt: 'הלוואה חדשה',
    balance: 'עדכון יתרה',
    unknown: 'לא זוהה',
  },

  state: {
    ready: 'מוכן לאישור',
    needs_amount: 'חסר סכום',
    needs_account: 'חסר חשבון',
    needs_debt: 'חסרה הלוואה',
    needs_date: 'צריך לאשר תאריך',
    not_understood: 'לא הובן',
  },

  /*
   * The smart reading.
   *
   * Written against one risk: that a person reads "ניתוח חכם" and believes
   * something was saved. So the button says what it does ("להבין את המשפט"), the
   * result is labelled as a suggestion, and the only word that means a record was
   * created appears on the confirmation button and nowhere else.
   *
   * No jargon. A family does not need to know there is a model, a schema, a
   * provider or a key — those words appear in the documentation and in the code,
   * never on the screen.
   */
  aiTitle: 'הבנה חכמה של המשפט',
  aiButton: 'הבנה חכמה',
  aiWorking: 'קוראים את המשפט…',
  aiHint: 'עוזר כשהמשפט מנוסח חופשי. התוצאה תמיד הצעה — לא רישום.',

  aiPrivacy:
    'כשלוחצים על ההבנה החכמה, הטקסט שכתבתם נשלח לשירות חיצוני שמוגדר עבור השירות הזה, כדי לקרוא אותו. נשלח רק הטקסט — לא הקלטה, לא שמות, לא יתרות ולא היסטוריה. ההקלטה, אם השתמשתם בה, נשארת במכשיר ואינה נשלחת מכאן.',

  aiNotConfiguredTitle: 'ההבנה החכמה לא מוגדרת בשירות הזה',
  aiNotConfigured:
    'אף אחד לא הגדיר כאן חיבור לשירות חיצוני, ולכן אין מה לנתח. הקריאה הרגילה של המשפט עובדת כרגיל — היא מבוססת כללים וכולה נשארת כאן.',

  aiUnavailableTitle: 'ההבנה החכמה לא זמינה כרגע',
  aiUnavailable: {
    not_configured: 'ההבנה החכמה לא מוגדרת בשירות הזה.',
    timeout: 'לא קיבלנו תשובה בזמן. אפשר לנסות שוב, או להשתמש בקריאה הרגילה.',
    provider_error: 'השירות החיצוני לא הצליח לענות. הקריאה הרגילה עובדת.',
    rate_limited:
      'ביקשנו הבנה חכמה הרבה פעמים בשעה האחרונה. אפשר להמתין, או להשתמש בקריאה הרגילה.',
    invalid_output: 'התשובה שהתקבלה לא הייתה במבנה שאנחנו מקבלים, ולכן לא השתמשנו בה.',
    empty_input: 'לא היה מה לקרוא.',
  } as Record<string, string>,
  aiFallbackHint: 'אפשר ללחוץ על ״מה הבנתם?״ לקריאה הרגילה, שאינה שולחת שום דבר לשום מקום.',

  aiProposalTitle: 'מה הבנו מהמשפט',
  aiSuggestion: 'זו הצעה של ההבנה החכמה',
  aiNotSaved: 'עוד לא נרשם כלום.',
  aiReadyBadge: 'מוכן לבדיקה שלכם',
  aiNeedsBadge: 'חסר פרט אחד',
  aiNotUnderstoodBadge: 'לא הובן',
  aiConfidence: { high: 'זיהוי ברור', medium: 'כדאי לבדוק', low: 'לא בטוח' } as Record<
    string,
    string
  >,
  aiEvidenceTitle: 'מאיזה מילים קראנו',
  aiEvidenceAmount: 'הסכום',
  aiEvidenceDate: 'התאריך',
  aiEvidenceWho: 'למי או על מה',
  aiWhy: 'למה',
  aiAssumedToday: 'המשפט לא אמר תאריך, ולכן הוצע היום. אפשר לשנות.',
  aiReanalyse: 'לתקן את המשפט ולקרוא שוב',

  aiActionTitle: {
    expense: 'כסף שיצא',
    income: 'כסף שנכנס',
    transfer: 'העברה בין חשבונות',
    new_debt: 'הלוואה חדשה',
    debt_repayment: 'החזר הלוואה',
    balance: 'עדכון יתרה',
    note: 'הערה',
    unknown: 'עוד לא ברור',
  } as Record<string, string>,

  aiNotHere: {
    transfer:
      'העברה בין שני חשבונות צריכה לדעת מאיפה ולאן. את זה עושים במסך הרישום, שבו שני השדות מופיעים.',
    note: 'הערה נרשמת בכרטיס המלווה שהיא שייכת אליו, ולא מכאן.',
    unknown: 'לא זיהינו פעולה כספית במשפט. אפשר לנסח אחרת, או למלא טופס רגיל.',
  } as Record<string, string>,
  aiGoToEntry: 'למסך הרישום',
  aiGoToLenders: 'לכרטיסי המלווים',

  aiLenderLink: 'לכרטיס המלווה',
  aiCreditorName: 'למי חייבים',
  aiCreditorHint: 'שם המלווה נרשם רק ממה שתכתבו כאן. ההבנה החכמה אינה פותחת מלווה חדש.',
  aiConfirm: 'לאשר ולרשום',

  emptyTitle: 'עוד אין משק בית',
  emptyReason: 'כדי לרשום עדכון צריך קודם להקים משק בית וחשבון אחד.',
  addAccount: 'הוספת חשבון',
} as const;
