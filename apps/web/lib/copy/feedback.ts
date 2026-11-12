/**
 * The words of the feedback button and of the platform owner's review screen.
 *
 * The button speaks to a member who wants to say something small and be done.
 * It says plainly who will read the note — the person who runs the service — so
 * that nobody types a balance believing it stays inside the family.
 */
export const feedbackCopy = {
  open: 'משוב',
  openLabel: 'לשלוח משוב על המסך הזה',
  close: 'סגירה',

  chooseTitle: 'על מה ההערה?',
  chooseElement: 'לבחור רכיב',
  chooseElementHint: 'לוחצים על החלק במסך שרוצים לשנות',
  chooseRegion: 'לסמן אזור',
  chooseRegionHint: 'גוררים מלבן סביב מה שרוצים לשנות',
  choosePage: 'הערה על כל המסך',
  choosePageHint: 'בלי לסמן דבר',

  pickingElement: 'לוחצים על רכיב. Escape לביטול.',
  pickingRegion: 'גוררים מלבן. Escape לביטול.',
  outer: 'רכיב עוטף',
  inner: 'רכיב פנימי',
  confirmPick: 'זה הרכיב',

  formTitle: 'מה לשנות?',
  whoReads: 'מי שמנהל את השירות יקרא את זה. אל תכתבו סכומים או פרטים אישיים.',
  textLabel: 'ההערה',
  kindLabel: 'סוג',
  urgencyLabel: 'דחיפות',
  kinds: { design: 'עיצוב', content: 'תוכן', bug: 'תקלה', other: 'אחר' },
  urgencies: { low: 'נמוכה', normal: 'רגילה', high: 'גבוהה' },
  remark: 'סימון מחדש',
  send: 'שליחה',
  sending: 'שולחים…',
  counter: (used: number, max: number) => `${used} / ${max}`,

  privacyTitle: 'רגע לפני ששולחים',
  privacyLead: 'נראה שההערה כוללת',
  privacyHints: {
    amount: 'סכום',
    phone: 'מספר טלפון',
    email: 'כתובת מייל',
    id: 'מספר זהות',
  },
  privacyAction: 'אפשר לתקן, או ללחוץ שוב על שליחה כדי לשלוח בכל זאת.',

  thanks: 'תודה!',
  thanksReference: (reference: string) => `מספר ההערה: ${reference}`,

  refused: {
    invalid: 'משהו בהערה לא נשמר כמו שצריך. אפשר לנסות שוב.',
    limit: 'נשלחו הרבה הערות בשעה האחרונה. אפשר לנסות שוב קצת אחר כך.',
    no_household: 'אפשר לשלוח משוב רק מתוך משק בית.',
    signed_out: 'צריך להיכנס מחדש כדי לשלוח.',
    failed: 'ההערה לא נשלחה. אפשר לנסות שוב.',
  },

  // The review screen, for the platform owner.
  reviewTitle: 'משוב',
  reviewSubtitle: 'הערות שנשלחו מתוך המוצר',
  reviewNavLabel: 'משוב',
  reviewEmpty: 'עוד לא נשלחו הערות.',
  reviewDownload: 'להוריד את כל ההערות (JSON)',
  reviewFilterAll: 'הכול',
  statuses: { new: 'חדש', approved: 'אושר', done: 'בוצע', declined: 'נדחה' },
  reviewMarks: { element: 'רכיב', region: 'אזור', page: 'כל המסך' },
  reviewDevices: { phone: 'טלפון', tablet: 'טאבלט', desktop: 'מחשב' },
  reviewFamily: (name: string | null) => (name === null ? 'משפחה שנמחקה' : name),
  reviewSetStatus: 'לסמן כ־',
  reviewDelete: 'למחוק',
  reviewStatusChanged: 'הסטטוס עודכן.',
  reviewDeleted: 'ההערה נמחקה.',
  reviewUnknown: 'ההערה הזו כבר לא קיימת.',
  reviewNotOwner: 'רק בעלי המערכת יכולים לעשות את זה.',
} as const;
