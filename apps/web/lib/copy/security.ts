/**
 * The words the lock uses.
 *
 * Two rules govern this file. The first is the product's general one: plain
 * Hebrew, calm, no jargon, no blame. The second is specific to security copy and
 * pulls the other way — a person deciding whether to trust an application with
 * their household's money is owed the truth about what it does and does not
 * protect, and "your data is secure" is not the truth.
 *
 * So the sentences here say exactly three things and keep saying them: Windows
 * Hello checks the fingerprint and the application never receives it; the lock
 * keeps somebody out of the screens; and the files on the disk are not encrypted
 * by it. Nobody should learn the third one from a blog post after a laptop is
 * stolen.
 */

export const authScreen = {
  /** What the passkey is called inside Windows Hello's own prompt. */
  credentialUserName: 'משק הבית',

  title: 'כניסה מאובטחת',
  lockTitle: 'האפליקציה נעולה',
  lockIntro: 'צריך לאשר שזה אתם לפני שרואים את הנתונים.',
  signIn: 'כניסה באמצעות Windows Hello',
  signingIn: 'ממתינים ל־Windows Hello…',
  signedIn: 'נכנסתם. ברוכים השבים.',
  signOut: 'נעילה עכשיו',
  signedOut: 'האפליקציה ננעלה.',

  setupTitle: 'הגדרת כניסה בטביעת אצבע או Windows Hello',
  setupIntro:
    'אפשר לנעול את האפליקציה כך שרק מי שעובר את בדיקת Windows Hello במחשב הזה יוכל לפתוח אותה.',
  setupExplainTitle: 'מה קורה בפועל',
  setupExplain: [
    'טביעת האצבע נשארת אצל Windows. האפליקציה לא מקבלת אותה, לא שומרת אותה ולא שולחת אותה לשום מקום.',
    'מה שנשמר כאן הוא מפתח ציבורי — מספר שאפשר לבדוק איתו חתימה, ואי אפשר לחתום איתו.',
    'כל בדיקה נעשית מול המחשב הזה בלבד. אין שרת, אין ענן, אין חשבון.',
  ],
  enrol: 'להגדיר עכשיו',
  enrolling: 'ממתינים ל־Windows Hello…',
  enrolled: 'המפתח נוסף. מעכשיו האפליקציה תבקש אישור בכניסה.',
  enrolLabel: 'איך לקרוא למפתח הזה',
  enrolLabelHint: 'למשל: המחשב בבית. השם הזה נשאר אצלכם.',

  addAnother: 'להוסיף מפתח נוסף',
  addAnotherNote:
    'כדאי מפתח שני במחשב אחר או מפתח אבטחה פיזי. אם המחשב הזה יאבד, זו הדרך להיכנס בלעדיו.',

  passkeysTitle: 'המפתחות שמוגדרים כאן',
  passkeyAdded: 'נוסף ב־',
  passkeyLastUsed: 'שימוש אחרון',
  passkeyNeverUsed: 'עוד לא היה בשימוש',
  passkeySynced: 'מסונכרן בין מכשירים',
  passkeyThisDevice: 'שמור במחשב הזה בלבד',
  remove: 'להסיר מפתח',
  removed: 'המפתח הוסר.',

  lockOffTitle: 'לבטל את הנעילה',
  lockOffExplain:
    'הסרת המפתח האחרון מכבה את הנעילה. אחרי זה האפליקציה תיפתח בלי לשאול. הקבצים עצמם לא משתנים.',
  lockOffConfirm: 'הבנתי — לבטל את הנעילה',
  lockOff: 'הנעילה בוטלה. האפליקציה נפתחת עכשיו בלי לשאול.',

  settingsTitle: 'מתי לנעול מחדש',
  idleLabel: 'לנעול אחרי חוסר פעילות (בדקות)',
  idleHint: 'ברירת מחדל: 15 דקות. בכל מקרה נעילה מלאה אחרי 12 שעות.',
  settingsSaved: 'ההגדרה נשמרה.',

  reauthTitle: 'צריך לאשר שוב',
  reauthIntro: 'הפעולה הזו נוגעת בכל הנתונים, אז נבקש את Windows Hello עוד פעם אחת.',
  reauthAction: 'לאשר עם Windows Hello',
  reauthenticated: 'אושר. אפשר להמשיך.',
  reauthNeeded: 'צריך לאשר עם Windows Hello לפני הפעולה הזו.',
  reauthActions: {
    backup_create: 'יצירת גיבוי של כל הנתונים',
    backup_restore: 'שחזור מגיבוי — דורס את מה שקיים',
    export_all: 'ייצוא כל הנתונים לקובץ',
    passkey_add: 'הוספת מפתח כניסה',
    passkey_remove: 'הסרת מפתח כניסה',
    lock_off: 'ביטול הנעילה',
    lock_settings: 'שינוי הגדרות הנעילה',
  } as Readonly<Record<string, string>>,

  /* The origin problem, explained rather than hidden behind a failed ceremony. */
  originTitle: 'הכתובת הזו לא תומכת בכניסה מאובטחת',
  originExplain:
    'הדפדפן מאפשר מפתחות כניסה רק בכתובת עם שם, לא במספר IP. הכתובת 127.0.0.1 היא מספר, ולכן Windows Hello לא ייפתח בה.',
  originFix: (origin: string) => `אפשר לפתוח את אותה אפליקציה בכתובת ${origin} ולהגדיר שם.`,
  originSameMachine:
    'זה אותו שרת ואותו מחשב. הוא לא נפתח לרשת — השם הזה מפנה לאותה כתובת מקומית.',
  openAtAuthOrigin: 'לפתוח בכתובת הנתמכת',

  unsupportedTitle: 'המחשב הזה לא מציע כרגע מפתח כניסה',
  unsupportedExplain:
    'לא נמצא במחשב אמצעי זיהוי שאפשר להשתמש בו — Windows Hello לא מוגדר, או שהדפדפן לא תומך.',
  unsupportedNext:
    'אפשר להגדיר Windows Hello בהגדרות Windows (חשבונות → אפשרויות כניסה) ולנסות שוב. עד אז האפליקציה פועלת ללא נעילה.',

  /* The threat model, in the words of the person who has to live with it. */
  protectsTitle: 'ממה זה מגן',
  protects: [
    'מישהו שמתיישב מול המחשב הפתוח ומנסה לפתוח את האפליקציה.',
    'תוכנה אחרת בדפדפן שמנסה לפנות לאפליקציה — היא לא יכולה לחתום בשמכם.',
    'ניסיון לחזור על כניסה שהוקלטה: כל אתגר תקף פעם אחת בלבד.',
  ],
  notProtectsTitle: 'ממה זה לא מגן',
  notProtects: [
    'הקבצים במחשב אינם מוצפנים. מי שיש לו גישה לתיקייה יכול לקרוא אותם גם בלי להיכנס לאפליקציה.',
    'למי שיש הרשאת מנהל במחשב יש גישה לכל דבר, כולל לקבצים האלה.',
    'גיבוי שהוצאתם לקובץ אינו מוגן בנעילה הזו. שמרו אותו במקום בטוח.',
  ],
  storedTitle: 'מה נשמר כאן',
  stored: [
    'מזהה של המפתח ומפתח ציבורי.',
    'מונה חתימות, כדי לזהות מפתח שהועתק.',
    'רישום של כניסות והגדרות — בלי תוכן, בלי חתימות, בלי טביעות אצבע.',
  ],
  biometricNever: 'טביעת אצבע: לא נשמרת, לא מתקבלת, לא נשלחת. אף פעם.',

  recoveryTitle: 'אם אין גישה למפתח',
  recovery: [
    'הדרך הבטוחה היא מפתח שני שהוגדר מראש — במחשב אחר או מפתח אבטחה פיזי.',
    'אם אין מפתח שני, אפשר לאפס את הנעילה מהמחשב עצמו: npm run auth:reset בתיקיית הפרויקט.',
    'האיפוס מוחק את המפתחות בלבד. הנתונים הכספיים נשארים כמו שהם.',
  ],
  recoveryHonest:
    'אין קוד עוקף ואין סיסמה חלופית. מי שיש לו גישה לקבצים במחשב יכול לאפס את הנעילה — לכן הנעילה שומרת על המסכים, לא על הדיסק.',

  logTitle: 'מה קרה כאן',
  logEmpty: 'עוד לא נרשם דבר.',
  logEvents: {
    passkey_enrolled: 'מפתח כניסה נוסף',
    passkey_removed: 'מפתח כניסה הוסר',
    passkey_renamed: 'שם המפתח שונה',
    signed_in: 'כניסה מוצלחת',
    sign_in_failed: 'ניסיון כניסה נכשל',
    reauthenticated: 'אישור חוזר',
    reauthentication_failed: 'אישור חוזר נכשל',
    signed_out: 'יציאה',
    session_expired: 'תוקף הכניסה פג',
    settings_changed: 'הגדרות הנעילה שונו',
    recovery_reset: 'הנעילה אופסה מהמחשב',
  } as Readonly<Record<string, string>>,

  errors: {
    locked: 'צריך להיכנס שוב.',
    session_idle: 'עבר זמן בלי פעילות, אז נעלנו. אפשר להיכנס שוב.',
    reauthentication_required: 'צריך לאשר עם Windows Hello לפני הפעולה הזו.',
    unknown_challenge: 'הבקשה כבר נוצלה או שפג תוקפה. אפשר לנסות שוב.',
    challenge_expired: 'זה לקח קצת יותר מדי זמן. אפשר לנסות שוב.',
    wrong_challenge_purpose: 'הבקשה הזו נוצרה למשהו אחר.',
    wrong_challenge_session: 'הבקשה הזו שייכת לחלון אחר.',
    unknown_passkey: 'המפתח הזה לא מוגדר כאן.',
    passkey_already_enrolled: 'המפתח הזה כבר מוגדר כאן.',
    too_many_passkeys: 'יש כבר מספיק מפתחות מוגדרים.',
    last_passkey: 'זה המפתח האחרון. כדי להסיר אותו צריך לבטל את הנעילה במפורש.',
    no_passkey: 'עוד לא הוגדר כאן מפתח כניסה.',
    origin_unusable: 'בכתובת הזו אי אפשר להשתמש במפתח כניסה.',
    confirm_required: 'צריך לאשר במפורש.',
    bad_timeout: 'צריך מספר דקות בין 1 ל־480.',
    auth_file_unreadable: 'קובץ הכניסה במחשב פגום. לא שינינו אותו.',
    ceremony_failed: 'לא הצלחנו לאמת. אפשר לנסות שוב.',
    cancelled: 'הפעולה בוטלה.',
    generic: 'משהו השתבש. אפשר לנסות שוב.',
  } as Readonly<Record<string, string>>,
} as const;
