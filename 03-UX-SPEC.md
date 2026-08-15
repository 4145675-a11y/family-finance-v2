# UX SPEC

## עקרונות

- אמת לפני עצה; פעולה לפני מידע; אוטומציה בפיקוח; אפס האשמה.
- Mobile-first אמיתי. מידע מתקדם נפתח ב־progressive disclosure.
- אין ריכוך שמסתיר סכנה: רגוע, ישיר ומעשי.
- כל מספר מרכזי כולל source, freshness, confidence ו־breakdown.

## ניווט

מובייל: בית | אישורים | תנועה | תכנון | עוד. דסקטופ: sidebar ימני.

## Wireframe — בית

1. פס עדכניות: “עודכן לפני…” + רמת אמינות + פעולות חסרות.
2. כרטיס Hero: “בטוח להוצאה עד סוף החודש”. מתחתיו conditional, לעולם לא מעורבב.
3. תחזית: יתרת סוף חודש, נקודת שפל ותאריך.
4. חובות: צרכני נטו, כולל משכנתה, שינוי החודש.
5. שני כרטיסים: בית / עסק. ביניהם safe transfer בלבד.
6. “הפעולה האחת שכדאי לעשות עכשיו”.

לחיצה על מספר פותחת bottom sheet: רכיבים, הנחות, חסרים, snapshot ו“לפני/אחרי” לפעולה מוצעת.

## Onboarding

שאלה אחת בכל מסך; autosave; pause/resume; “לא יודע כרגע”; “השלם אחר כך”. העלאה/צילום קודמים להקלדה. שלבים: משתמשים, חשבונות, כרטיסים, מזומן, עסק, יתרות, חובות, משכנתה, עתידיים, מסים, רזרבות, בדיקת תמונה. אין לדרוש שלמות כדי להתחיל; מציגים מה חסר.

## Approval Inbox

טיוטות מקובץ, צילום, מייל, טקסט, דיבור, recurring ו־CRM. כרטיס טיוטה: מקור, scope, type, amount, dates, merchant, account, category, recurrence, confidence, duplicate. פעולות thumb-friendly: אשר, תקן, דחה, פצל, העברה, כפילות, כלל.

Bulk approval רק high confidence ללא חשד. פעולות חשודות מופרדות. conflict אינו “409” אלא השוואת גרסאות והחלטת משתמש.

## מסכים

- תנועה: חיפוש, סינון, pending/confirmed/reconciled/void, source ו־audit.
- תקציב: planned, actual, pending, committed, remaining, projected. בחודש ראשון draft זמני ו־confidence נמוך.
- חובות: סוגים נפרדים, נתונים חסרים, סדר מוצע, חלופה והשפעה; private debt כולל קשר והבטחה.
- כרטיס קבוע "מה קרה באמת לחוב": בתחילת התקופה, עכשיו, שינוי נטו, נפרע ברוטו, נוצר חדש, מתוכו גלגול וריבית/עמלות. ציר זמן מציג "משה נפרע" ו"נוצר חוב לישראל" כשתי עובדות מקושרות. הצלחה נחגגת רק בירידה נטו או בתקופה ללא חוב חדש, לא רק בהחלפת נושה.
- עסק: received, receivables, expenses, taxes, reserves, accounting profit, realized cash profit, safe transfer.
- Advisor: שלוש שאלות ליבה; תשובה ישירה, נתונים, חסרים, פעולה ותרחיש.
- Imports: מצב עיבוד, extraction חלקי, mapping, review, מחיקה.
- Reports: תקופה, scope, confirmed/unconfirmed, PDF/Excel/print.

## סיכומים

Daily: התקדמות חוב, חיוב גדול, approvals, משימה אחת. Weekly: 2–3 דקות, שינוי נטו, תקציב, עסק, תחזית, עד 3 תובנות, משימה והצלחה אמיתית.

## מצבים מחייבים

לכל core screen: empty, loading/skeleton, partial, stale, error, offline, queued, conflict, success, extreme data. Offline מציג תמיד timestamp ושהמידע עשוי להיות ישן. stale snapshot אינו מאפשר החלטה מחייבת.

## Responsive

- 360/390: כרטיסים בטור, טבלאות הופכות לכרטיסים, bottom navigation.
- 768: grid של עד 2 עמודות, sidebar לפי מקום.
- 1280: sidebar ימני ותוכן ברוחב קריא; לא למתוח מספרים.
- אין horizontal overflow בשום רוחב.

## Microcopy

“בואו נשלים” ולא “לא הזנתם”; “החודש צפוף יותר” ולא “חרגתם שוב”; “כרגע אין סכום בטוח להוצאה נוספת” בלי בושה; “החוב ירד נטו — זו התקדמות אמיתית”. אדום רק בסכנה מיידית.

## קבלה

- `UX-HOME-001`: שלוש תשובות הליבה מובנות בתוך 10 שניות בבדיקת משתמש.
- `UX-TRUST-001`: כל מספר מרכזי מסביר מקור/זמן/confidence.
- `UX-RTL-001`: אין overflow ב־360/390/768/1280.
- `UX-A11Y-001`: WCAG 2.2 AA, מקלדת, focus, labels, reduced motion, text scaling.
- `UX-STATE-001`: כל המצבים המחייבים קיימים ונבדקו.
