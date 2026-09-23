import { count as countText, formatBusinessDate, formatWeekday, money } from '../format';

const count = countText;

/**
 * Everything this product says, in one place.
 *
 * The rule that produced this module: the family reading these screens may have
 * never managed a budget, is under real pressure, and needs to understand a
 * sentence on the first reading. So the words are ordinary, the tone is calm, and
 * nothing here blames anybody.
 *
 * Keeping it in one module is not tidiness. Copy scattered through components
 * cannot be reviewed as language, cannot be tested for tone, and drifts the moment
 * two screens describe the same thing differently. `tone.test.ts` scans this file
 * and every screen for words we have decided not to use.
 *
 * Numbers inside sentences go through `money()` and `count()`, which isolate the
 * digit run so right-to-left text cannot reorder it.
 */

export const copy = {
  app: {
    name: 'הכסף שלנו',
    household: 'משק הבית',
    tagline: 'תמונה אחת ברורה של הבית, העסק והחובות',
  },

  nav: {
    home: 'בית',
    quick: 'עדכון מהיר',
    entry: 'רישום',
    upload: 'העלאה',
    approvals: 'אישורים',
    accounts: 'חשבונות',
    planning: 'תכנון',
    debts: 'חובות',
    forecast: 'תחזית',
    business: 'עסק',
    tasks: 'משימות',
    reports: 'דוחות',
    activity: 'תנועה',
    more: 'עוד',
    groupToday: 'היום',
    groupPicture: 'התמונה',
    groupKeeping: 'סדר',
    ariaMain: 'ניווט ראשי',
    ariaBottom: 'ניווט תחתון',
    skipToContent: 'דילוג לתוכן',
  },

  demo: {
    title: 'אלה נתוני הדגמה',
    body: 'הם לא הכספים שלכם. הם נועדו להראות איך המסך עובד לפני שמחברים נתונים אמיתיים.',
  },

  home: {
    title: 'בית',
    greeting: 'הנה התמונה של החודש',

    safeTitle: 'כמה אפשר להוציא בלי להסתבך',
    safeUntil: (date: string) => `עד ${formatBusinessDate(date)}`,
    safeMeaning: 'הסכום כולל רק כסף שכבר קיים ורק הכנסות שבטוח ייכנסו.',
    // A very large "0 ₪" is accurate and frightening. The screen says what the
    // zero means, and the arithmetic follows underneath it.
    safeZeroHeadline: 'כרגע לא כדאי להוסיף הוצאות שאינן מתוכננות',
    safeZeroNote: 'כל מה שנכנס החודש כבר מיועד לתשלומים שנקבעו.',
    safeGap: (amountMinor: number) =>
      `לפי הנתונים שיש כרגע, חסרים ${money(amountMinor)} לכיסוי כל התשלומים עד סוף החודש.`,
    safeCannotCalculate: 'עדיין אי אפשר לחשב סכום בטוח.',
    safeCannotCalculateWhy: (missing: number) =>
      missing === 1
        ? 'חסר עוד פרט אחד. בואו נשלים אותו ואז נדע.'
        : `חסרים עוד ${count(missing)} פרטים. בואו נשלים אותם ואז נדע.`,
    howWeCalculated: 'איך הגענו לזה?',
    calculationNote: 'כל שורה כאן מצטרפת לסכום שלמעלה.',

    debtTitle: 'החובות',
    debtDown: (amountMinor: number) => `החוב ירד החודש ב־${money(amountMinor)}`,
    debtUp: (amountMinor: number) => `החוב גדל החודש ב־${money(amountMinor)}`,
    debtFlat: 'סך החוב כמעט לא השתנה',
    // A household with no debts is not a household whose debt did not move.
    debtNone: 'אין חובות רשומים',
    debtNoneNote: 'אם יש הלוואה, מינוס או חוב לאדם קרוב — כדאי לרשום אותם כאן.',
    debtDownNote: 'זו התקדמות אמיתית.',
    debtFlatNote: 'שולם חוב אחד ונפתח חוב חדש, ולכן הסכום הכולל כמעט לא זז.',
    debtUpNote: 'נלקח החודש יותר ממה שהוחזר.',
    debtTotalNow: 'סך החובות היום',
    debtLink: 'לראות את כל החובות',

    monthEndTitle: 'סוף החודש',
    certainIn: 'כסף שבטוח ייכנס',
    mustGoOut: 'תשלומים שחייבים לרדת',
    tightestDay: 'היום הכי צפוף',
    tightestDayOn: (date: string) => `הכי צפוף ב־${formatBusinessDate(date)}`,
    runsOutOn: (date: string) => `ב־${formatBusinessDate(date)} הכסף עלול להיגמר`,
    noTightDay: 'לא צפוי יום שבו הכסף נגמר',
    forecastLink: 'לראות את כל החודש',

    businessTitle: 'העסק',
    businessSafeTransfer: (amountMinor: number) =>
      `כרגע בטוח להעביר לבית עד ${money(amountMinor)}`,
    businessNotSafe: 'עדיין לא בטוח להעביר כסף מהעסק לבית',
    businessNone: 'עוד לא הוגדר עסק',
    businessLink: 'לראות את מצב העסק',

    // A staged import changes no figure on this screen, which is exactly why the
    // screen has to say it is there. Silence would read as "nothing is waiting".
    waitingTitle: 'יש מה לבדוק',
    waitingRows: (rows: number) =>
      rows === 1
        ? 'שורה אחת מקובץ שהעליתם ממתינה לבדיקה. היא עדיין לא נכנסה לשום חישוב.'
        : `${count(rows)} שורות מקובץ שהעליתם ממתינות לבדיקה. הן עדיין לא נכנסו לשום חישוב.`,
    waitingLink: 'לעבור עליהן',

    actionTitle: 'מה כדאי לעשות עכשיו',
    updatesTitle: 'פעולות מהירות',
    moreTitle: 'עוד דברים שאפשר לבדוק',
    moreLink: 'לכל המסכים והפירוטים',
  },

  // The recommendation is a way forward, not a verdict. Each plan lists concrete
  // moves the engine can already point at, so "close the gap" stops being an
  // instruction to conjure money and becomes a short list of real options.
  plan: {
    gapTitle: 'בואו נבנה תוכנית לסגירת הפער',
    gapIntro: 'אף אחד לא משלים סכום כזה ביום אחד. אלה הכיוונים שאפשר לבדוק כבר עכשיו:',
    movePayments: 'לבדוק אילו תשלומים אפשר להזיז',
    movePaymentsWhy: (payments: number) =>
      payments === 1
        ? 'יש תשלום אחד שאינו חיוני החודש. דחייה שלו משנה את התמונה.'
        : `יש ${countText(payments)} תשלומים שאינם חיוניים החודש. דחייה של אחד מהם משנה את התמונה.`,
    noMovable: 'כל התשלומים החודש חיוניים, ולכן אין מה להזיז.',
    businessTransfer: (amountMinor: number) =>
      `אפשר להעביר מהעסק עד ${money(amountMinor)} בבטחה`,
    noBusinessTransfer: 'כרגע אין כסף בעסק שבטוח להעביר לבית.',
    expectedIncome: (amountMinor: number) => `${money(amountMinor)} אמורים להיכנס עד סוף החודש`,
    updateDetails: 'לעדכן פרטים חסרים כדי לדייק את התמונה',
    seeCalculation: 'לראות איך הגענו לזה',
    failureDayTitle: 'בואו נזיז תשלום אחד',
    failureDayIntro: (date: string) =>
      `ב־${formatBusinessDate(date)} הכסף עלול להיגמר. הזזה של תשלום אחד לפני התאריך הזה מספיקה כדי למנוע את זה.`,
    confirmTitle: 'בואו נשלים את הפרטים החסרים',
    confirmIntro: 'עם הפרטים האלה אפשר יהיה לתת מספר מדויק במקום הערכה:',
    holdTitle: 'אין כרגע משהו דחוף',
    holdIntro: 'זה מצב טוב. שווה להמשיך לעדכן יתרות כדי שהתמונה תישאר נכונה.',
  },

  food: {
    title: 'אוכל השבוע',
    remaining: (amountMinor: number, until: string) =>
      // `formatWeekday` already returns "יום שבת"; a second "יום" doubled it once.
      `נשארו ${money(amountMinor)} עד ${formatWeekday(until)}`,
    monthProgress: (spentMinor: number, plannedMinor: number) =>
      `מתחילת החודש יצאו ${money(spentMinor)} מתוך ${money(plannedMinor)}`,
    projection: (amountMinor: number) =>
      `בקצב הזה צפויה הוצאה של ${money(amountMinor)} עד סוף החודש`,
    overPace: (overMinor: number, nextWeekMinor: number) =>
      `השבוע יצא ${money(overMinor)} יותר מהתכנון. כדי להישאר במסגרת החודש, אפשר להוציא עד ${money(nextWeekMinor)} בשבוע הבא.`,
    largePurchase: (amountMinor: number) =>
      `היתה קנייה גדולה של ${money(amountMinor)} — היא כנראה תספיק גם לשבוע הבא, ולכן היא לא נחשבת כקצב רגיל.`,
    onTrack: 'אתם בקצב טוב.',
    overMonth:
      'הסכום החודשי לאוכל כבר נוצל. אפשר להעביר מקטגוריה אחרת, או לרשום את זה ולהמשיך.',
    noPlan: 'עוד לא נקבע סכום חודשי לאוכל.',
    setPlan: 'לקבוע סכום לאוכל',
    budgetLink: 'לתקציב המלא',
    ariaProgress: (spentMinor: number, plannedMinor: number) =>
      `יצאו ${money(spentMinor)} מתוך ${money(plannedMinor)}`,
  },

  budget: {
    title: 'התקציב שלנו',
    subtitle: 'כמה תכננו לכל דבר החודש, וכמה כבר יצא',
    monthTotal: 'סך הכול לחודש',
    planned: 'תכננו',
    spent: 'כבר יצא',
    pending: 'ממתין לאישור',
    committed: 'כבר מחויב',
    remaining: 'נשאר',
    over: 'מעבר לתכנון',
    projected: 'צפוי עד סוף החודש',
    projectedGood: (amountMinor: number) => `בקצב הזה יישארו ${money(amountMinor)} בסוף החודש`,
    projectedShort: (amountMinor: number) =>
      `בקצב הזה חסרים ${money(amountMinor)} עד סוף החודש`,
    statusOnTrack: 'בקצב טוב',
    statusWatch: 'כדאי לשים לב',
    statusOver: 'יצא יותר ממה שתכננו',
    weeklyBadge: 'עם מעקב שבועי',
    empty: 'עוד לא בנינו תקציב לחודש הזה.',
    emptyAction: 'בואו נתחיל מקטגוריה אחת',
    draftNote: 'זו הצעה ראשונה לחודש. אפשר לשנות כל סכום.',
    transferTitle: 'להעביר בין קטגוריות',
    transferExplain: (amountMinor: number, to: string) =>
      `אם נוסיף ${money(amountMinor)} ל${to}, צריך לבחור מאיזו קטגוריה להעביר אותם.`,
    transferKeepsTotal: 'הסכום הכולל של החודש לא משתנה — רק החלוקה בין הקטגוריות.',
    transferNeedsApproval: 'שינוי כזה מחכה לאישור של אחד מכם לפני שהוא נכנס לתוקף.',
    categories: {
      food: 'מזון',
      housing_and_bills: 'דיור וחשבונות',
      transport_and_fuel: 'תחבורה ודלק',
      health: 'בריאות',
      education: 'חינוך',
      clothing: 'ביגוד',
      celebrations_and_gifts: 'שמחות ומתנות',
      cash_and_small: 'מזומן והוצאות קטנות',
      holidays: 'חגים',
      other: 'שונות',
    } as Record<string, string>,
  },

  forecast: {
    title: 'מה צפוי החודש',
    endQuestion: 'כמה יישאר בסוף החודש?',
    tightQuestion: 'מתי יהיה הכי צפוף?',
    certainQuestion: 'מה כבר בטוח?',
    maybeQuestion: 'מה רק כנראה יקרה?',
    alreadyHave: 'כסף שכבר קיים',
    willCertainlyEnter: 'כסף שבטוח ייכנס',
    probablyEnter: 'כסף שכנראה ייכנס',
    maybeEnter: 'כסף שאולי ייכנס',
    onlyFirstTwoCount: 'רק שני הראשונים נכנסים לחשבון של "כמה אפשר להוציא".',
    dayTable: 'ימים שבהם נכנס או יוצא כסף',
    dayColumn: 'תאריך',
    inColumn: 'נכנס',
    outColumn: 'יוצא',
    balanceColumn: 'נשאר בסוף היום',
    whatIfTitle: 'ומה אם משהו ישתבש?',
    whatIfNote: 'בדקנו כמה מצבים סבירים. תחזית היא הערכה, לא הבטחה.',
    holds: 'מסתדר',
    breaks: 'לא מסתדר',
  },

  debts: {
    title: 'החובות שלנו',
    realStoryTitle: 'מה קרה באמת החודש',
    startOfMonth: 'בתחילת החודש',
    now: 'עכשיו',
    change: 'ההפרש',
    repaid: 'שילמנו על חשבון הקרן',
    borrowed: 'לקחנו חוב חדש',
    fromBorrowing: 'מתוך מה ששילמנו — מומן מחוב חדש',
    fromIncome: 'ירידה אמיתית שמומנה מההכנסה',
    interestPaid: 'ריבית ועמלות',
    interestNote: 'תשלום ריבית לא מקטין את הקרן.',
    correction: 'תיקוני יתרה',
    correctionNote: 'תיקון הוא לא הישג ולא כישלון — רק דיוק של המספר.',
    swapTitle: 'החלפות בין נושים',
    swapExplain: (from: string, to: string, amountMinor: number) =>
      `שילמנו ל${from} ${money(amountMinor)}, אבל לקחנו ${money(amountMinor)} מ${to}. לכן החוב ל${from} נסגר, נפתח חוב חדש ל${to}, וסך החובות כמעט לא השתנה.`,
    noSwaps: 'החודש לא היו החלפות בין נושים.',
    urgentTitle: 'מה דורש טיפול',
    callableSoon: (amountMinor: number) => `${money(amountMinor)} עלולים להידרש בחודש הקרוב`,
    noCallable: 'אין כרגע חוב פרטי שעלול להידרש בקרוב',
    allTitle: 'כל החובות',
    creditor: 'למי חייבים',
    balance: 'כמה נשאר',
    monthly: 'תשלום חודשי',
    cost: 'כמה זה עולה בשנה',
    unknownCost: 'לא ידוע',
    unknownCostNote: 'בלי הריבית אי אפשר לדעת איזה חוב הכי יקר.',
    urgency: {
      none: 'רגיל',
      watch: 'לשים לב',
      demanded: 'ביקשו תשלום',
      legal: 'דחוף',
    } as Record<string, string>,
    mortgageTag: 'משכנתה',
  },

  business: {
    title: 'העסק',
    receivedIn: 'כמה נכנס בפועל',
    stillOwed: 'כמה לקוחות עדיין צריכים לשלם',
    wentOut: 'כמה יצא על העסק',
    savedForTax: 'כמה שמרנו למסים',
    reallyLeft: 'כמה נשאר באמת',
    safeToMove: 'כמה בטוח להעביר לבית',
    accountingProfit: 'רווח על הנייר',
    accountingProfitNote: 'מה שהעסק הרוויח, לפני שבודקים כמה מזה באמת בידיים.',
    cashProfit: 'רווח שכבר בידיים',
    cashProfitNote: 'אחרי מה ששולם, מה ששמור למסים ומה שכבר התחייבנו אליו.',
    limitedBy: 'הסכום מוגבל על ידי',
    limits: {
      realized_profit: 'הרווח שכבר בידיים',
      available_cash: 'הכסף שפנוי בחשבון העסק',
      household_need: 'מה שהבית באמת צריך החודש',
      none: 'אין מספיק נתונים',
    } as Record<string, string>,
    proposalNote: 'זו הצעה. ההעברה עצמה נעשית על ידכם בבנק — האפליקציה לא מבצעת העברות.',
    none: 'עוד לא הוגדר עסק. כשיוגדר, יופיעו כאן התקבולים, ההוצאות, המסים ומה שבטוח להעביר הביתה.',
  },

  freshness: {
    today: 'מעודכן להיום',
    yesterday: 'עודכן אתמול',
    days: (days: number) => `עודכן לפני ${count(days)} ימים`,
    never: 'עוד לא עדכנתם אף יתרה',
  },

  confidence: {
    high: 'התמונה אמינה',
    medium: 'התמונה כמעט שלמה',
    low: 'כדאי לעדכן לפני שמחליטים',
    partial: (missing: number) =>
      missing === 1
        ? 'התמונה חלקית — חסר פרט אחד'
        : `התמונה חלקית — חסרים ${count(missing)} פרטים`,
  },

  states: {
    loading: 'רגע, אוספים את הנתונים…',
    noSource: 'אין כרגע נתונים להציג',
    noSourceBody: 'המסך לא ממציא מספרים. כשיהיה חיבור לנתונים, הכול יופיע כאן.',
    error: 'משהו השתבש בדרך',
    errorBody: 'אפשר לנסות לרענן. אם זה חוזר, כדאי לספר לנו מה קרה.',
    comingSoon: 'המסך הזה עוד בבנייה',
    comingSoonBody: 'הוא יגיע בשלב הבא. בינתיים אפשר לראות את התמונה המלאה במסך הבית.',
    offline: 'אין כרגע חיבור. המספרים כאן הם מהפעם האחרונה שהתעדכנו.',
    pending: 'ממתין לאישור',
    devOnly: 'הפעולה הזו עוד לא מחוברת לשמירה אמיתית, ולכן היא כבויה כרגע.',
    soon: 'בקרוב',
    soonUpdates: 'רישום הוצאה, הכנסה או יתרה יופעל כשהנתונים יתחברו למקום קבוע.',
  },

  actions: {
    quickUpdate: 'עדכון מהיר',
    addExpense: 'הוספת הוצאה',
    addIncome: 'הוספת הכנסה',
    updateBalance: 'עדכון יתרה',
    uploadStatement: 'העלאת דוח',
    approve: 'אישור פעולות',
    more: 'עוד פעולות',
  },

  sections: {
    needsAttention: 'דורש טיפול',
    comingUp: 'מה מתקרב',
    ourProgress: 'ההתקדמות שלנו',
    allAccounts: 'כל החשבונות',
    calculation: 'פירוט החישוב',
    technical: 'פרטים טכניים',
  },
} as const;

export type Copy = typeof copy;
