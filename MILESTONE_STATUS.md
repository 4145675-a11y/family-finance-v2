# MILESTONE STATUS

מצב הפרויקט מול `09-MILESTONES.md`. מתעדכן בסוף כל milestone, לפני העצירה לאישור.

- **תאריך עדכון אחרון**: 2026-08-15
- **Milestone פעיל**: 0 — Bootstrap
- **סטטוס**: הושלם ונשמר. ממתין לאישור מפורש להתחלת Milestone 1.
- **Commit של יישום M0**: `273d8a9` — `chore: complete milestone 0 bootstrap` (26 קבצים)
- **Commit בסיס קודם**: `7ac6d78` — `chore: add planning and safety baseline`
- **Branch**: `main` (שונה שמו מ־`master`; אין remote ולא בוצע push)

## מקרא

`Not started` · `In progress` · `Complete — evidenced` · `Blocked`

אין `Complete` בלי דוח Checkpoint עם פקודות שהורצו ותוצאות. אין `Complete` חלקי — milestone שלא הושלם במלואו נשאר `In progress` עם רשימת פערים.

## טבלת מצב

| # | Milestone | סטטוס | Checkpoint | הערה |
|---:|---|---|---|---|
| 0 | Bootstrap | **Complete — evidenced** | [milestone-0](docs/checkpoints/milestone-0.md) | נשמר ב־`273d8a9`; 4 שערים פעילים, 5 ADRs, 23 דרישות ממופות |
| 1 | Repository Foundation | Not started | — | דורש אישור מפורש |
| 2 | Identity & Isolation | Not started | — | דורש חשבון Supabase — ראה חסמים |
| 3 | Financial Accounts & Opening Picture | Not started | — | |
| 4 | Debt Domain | Not started | — | |
| 5 | Finance Engine | Not started | — | |
| 6 | Dashboard Source of Truth | Not started | — | |
| 7 | PWA & Offline | Not started | — | |
| 8 | Imports & Approval Inbox | Not started | — | |
| 9 | OCR/Voice/Email Adapters | Not started | — | דורש credentials — ראה חסמים |
| 10 | Budget & Sinking Funds | Not started | — | |
| 11 | Business & Safe Transfer | Not started | — | |
| 12 | Debt Plan & Advisor | Not started | — | דורש AI credentials — ראה חסמים |
| 13 | Summaries, Notifications & Reports | Not started | — | |
| 14 | Hardening & Production | Not started | — | דורש החלטת אירוח ו־RPO/RTO |

## שערי איכות — מצב נוכחי

| שער | סטטוס | ראיה |
|---|---|---|
| Install | Active | `npm ci --ignore-scripts`, exit 0 |
| Unit | Active | `node --test`, 18/18 עוברות |
| Forbidden scan | Active | exit 0 נקי; exit 1 מאומת על קובץ מלוכלך |
| Traceability | Active | 23/23 מתואמים; exit 1 מאומת על מזהה לא רשום |
| Format / Typecheck / Lint / Build | Defined, לא פעיל | Milestone 1 — `ADR-0003` |
| Integration / RLS | Defined, לא פעיל | Milestone 2 |
| Property | Defined, לא פעיל | Milestone 5 |
| E2E / a11y / RTL visual | Defined, לא פעיל | Milestone 6 |

## פערים ידועים שנפתחו ב־Milestone 0

| # | פער | השפעה | טיפול |
|---:|---|---|---|
| 1 | דרישות ב־`04`, `05`, `07`, `08`, `11` ללא תוויות מזהה | traceability חלקי מחוץ ל־23 המזהים הרשומים | כל milestone רושם מזהים לדרישות שהוא מממש — `ADR-0004` |
| 2 | `UX-DEBT-001` אינו מוקצה | אין | המזהה שמור, לא ימוחזר |
| 3 | אין מסמך `06` | אין | פער מספור עקבי בכל המסמכים, לא קובץ חסר |
| 4 | אין git remote | CI לא רץ בפועל | אותם שערים רצים מקומית; יופעל עם חיבור המאגר |
| 5 | נקודת עיוורון בשני קבצי הסורק | סמן עבודה לא גמורה בתוכם לא ייתפס אוטומטית | כוסה ב־18 בדיקות + code review — `ADR-0005` |

## חסמים שדורשים החלטה או גישה של המשתמש

אלה **אינם** חסמים ל־Milestone 1. הם נרשמים מראש כדי שלא יתגלו באמצע milestone.

| Milestone | מה נדרש | למה קלוד לא יכול להשיג זאת |
|---:|---|---|
| 2 | פרויקט Supabase, URL ו־anon key; service role key בסביבת שרת בלבד | חשבון חיצוני וסודות. יש להניח `.env.local` בתוך הפרויקט; אין להעביר סודות בצ׳אט |
| 9 | Gmail OAuth credentials, ספק OCR | חשבונות חיצוניים; עד אז — adapters מאחורי feature flag כבוי |
| 12 | מפתח API של ספק ה־AI | סוד חיצוני |
| 14 | בחירת תוכנית אירוח, יעדי RPO/RTO, אנשי קשר לאירוע | החלטה עסקית |

## הצעד הבא

Milestone 1 — Repository Foundation. אין להתחיל בלי הוראה מפורשת: **"המשך ל־Milestone 1"**.
