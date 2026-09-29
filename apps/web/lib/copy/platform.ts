/**
 * The words for the platform owner's screen, and for the person who has no
 * household yet.
 *
 * Two audiences with opposite needs. The owner is administering a service and
 * wants counts and controls; the person at the door wants to know why they
 * cannot get in and what to do about it. The second half is written to be read
 * by somebody who did nothing wrong.
 */
export const platform = {
  title: 'ניהול משקי בית',
  subtitle: 'מי קיים, מי מוזמן, ומי מחכה לתשובה',
  navLabel: 'ניהול',

  notOwner: 'רק בעלי המערכת יכולים לעשות את זה.',
  incomplete: 'בואו נשלים כמה פרטים.',
  badEmail: 'האימייל לא נראה תקין',

  createTitle: 'משק בית חדש',
  createIntro:
    'ייווצר משק בית ריק, ותישלח הזמנה חד־פעמית לכתובת שתקלידו. מי שיממש אותה יהיה הבעלים שלו — ואתם לא תהיו חברים בו ולא תראו את הכספים שלו.',
  fieldHouseholdName: 'שם משק הבית',
  fieldOwnerEmail: 'האימייל של הבעלים הראשון',
  fieldHousehold: 'משק בית',
  fieldInvitation: 'הזמנה',
  fieldRequest: 'בקשה',
  fieldNote: 'משהו שנרצה לדעת',
  create: 'ליצור ולשלוח הזמנה',
  householdCreated:
    'משק הבית נוצר. זה קוד ההזמנה — הוא מוצג פעם אחת בלבד, והוא מאפשר כניסה אחת.',

  listTitle: 'משקי הבית',
  listEmpty: 'עוד לא נוצר אף משק בית.',
  members: (count: number) => `${count} חברים`,
  owners: (count: number) => `${count} בעלים`,
  pending: (count: number) => `${count} הזמנות פתוחות`,
  disabled: 'מושבת',
  disable: 'להשבית',
  enable: 'להפעיל מחדש',
  householdDisabled: 'משק הבית הושבת. החברים בו לא רואים אותו יותר.',
  householdEnabled: 'משק הבית הופעל מחדש.',
  invitationRevoked: 'ההזמנה בוטלה.',

  requestsTitle: 'בקשות',
  requestsIntro:
    'כשהבקשות פתוחות, מי שנכנס בלי הזמנה יכול לבקש משק בית. הבקשה אינה יוצרת דבר — רק אישור שלכם יוצר.',
  requestsOpen: 'הבקשות פתוחות',
  requestsClosedNow: 'הבקשות סגורות',
  openRequests: 'לפתוח בקשות',
  closeRequests: 'לסגור בקשות',
  requestsOpened: 'הבקשות פתוחות.',
  requestsClosed: 'הבקשות סגורות.',
  noRequests: 'אין בקשות שממתינות.',
  approve: 'לאשר וליצור',
  decline: 'לדחות',
  requestApproved: 'אושר. זה קוד ההזמנה לבעלים — מוצג פעם אחת.',
  requestDeclined: 'הבקשה נדחתה.',
  statusPending: 'ממתינה',
  statusApproved: 'אושרה',
  statusDeclined: 'נדחתה',

  /* The door, for somebody who has no household. */
  doorTitle: 'אין כאן עדיין משק בית',
  doorInvitation:
    'אם קיבלתם קוד הזמנה — זה המקום להזין אותו. הוא מצרף אתכם למשק הבית שנשלח עבורו, ורק אליו.',
  doorClosed:
    'משק בית נפתח בידי מי שמנהל את המערכת. אם אתם אמורים להיות כאן, בקשו ממנו הזמנה — היא מגיעה כקוד חד־פעמי.',
  doorRequest: 'אפשר גם לבקש משק בית משלכם. הבקשה אינה פותחת דבר: היא ממתינה לאישור.',
  requestTitle: 'לבקש משק בית',
  request: 'לשלוח בקשה',
  requestSent: 'הבקשה נשלחה. תקבלו הזמנה אם היא תאושר.',
  requestRefused: 'לא ניתן לשלוח בקשה כרגע.',
} as const;
