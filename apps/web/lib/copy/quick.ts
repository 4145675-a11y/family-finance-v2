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

  emptyTitle: 'עוד אין משק בית',
  emptyReason: 'כדי לרשום עדכון צריך קודם להקים משק בית וחשבון אחד.',
  addAccount: 'הוספת חשבון',
} as const;
