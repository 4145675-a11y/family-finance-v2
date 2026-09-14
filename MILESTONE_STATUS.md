# MILESTONE STATUS

מצב הפרויקט מול `09-MILESTONES.md`. מתעדכן בסוף כל milestone, לפני העצירה לאישור.

- **תאריך עדכון אחרון**: 2026-09-15
- **Milestone פעיל**: Production Data Layer (ADR-0032) — ענף `production-data-layer`, ממתין לאישור ולמיזוג
- **סטטוס**: **מוצר מקומי שלם ושמיש, עם נעילה אמיתית.** משפחה יכולה להקים משק בית, להזין
  הכול ידנית, להעלות קובץ בנק, לעבור עליו ולאשר, לראות תמונה יומית, לנהל תקציב וחובות,
  לנהל הלוואת גמ״ח שנפרעת בצ׳קים דחויים, להפיק דוחות, לייצא ולגבות — הכול על המחשב הזה,
  בלי שום חשבון חיצוני. הכניסה מוגנת ב־WebAuthn מול Windows Hello, בכתובת `http://localhost:3100`
  (ולא ב־`127.0.0.1` — ראה ADR-0029). **הסכמה מוחלת על Supabase ובדיקות הבידוד
  רצו מולו** (2026-09-14): 32/32 טבלאות RLS forced, 94 policies, 38/38 בדיקות עברו,
  המסד נקי — ראה [milestone-2](docs/checkpoints/milestone-2.md).
- **Branch**: `milestone-2-identity-isolation` — **השם מיושן.** M2 עד M9 נבנו עליו.
  remote `origin` מוגדר.
- **מוזג ל־`main`**: Milestone 0 ו־Milestone 1 בלבד.

## מקרא

`Not started` · `In progress` · `Complete — evidenced` · `Blocked`

אין `Complete` בלי דוח Checkpoint עם פקודות שהורצו ותוצאות. אין `Complete` חלקי — milestone
שלא הושלם במלואו נשאר `In progress` עם רשימת פערים.

## טבלת מצב

| # | Milestone | סטטוס | Checkpoint | הערה |
|---:|---|---|---|---|
| 0 | Bootstrap | **Complete — evidenced** | [milestone-0](docs/checkpoints/milestone-0.md) | 4 שערים, 5 ADRs, 23 דרישות |
| 1 | Repository Foundation | **Complete — evidenced** | [milestone-1](docs/checkpoints/milestone-1.md) | 9 שערים, 88 בדיקות |
| 2 | Identity & Isolation | **Complete — evidenced** | [milestone-2](docs/checkpoints/milestone-2.md) | **38/38 בדיקות בידוד מול Supabase** (2026-09-14); החבילה ב־rollback, המסד נקי |
| 3 | Financial Accounts & Opening Picture | **Complete — evidenced** | [milestone-7](docs/checkpoints/milestone-7-local-product.md) | החוזים נבדקו ב־M3; **התמונה הפותחת עובדת בפועל מ־M7** מעל החנות המקומית |
| 4 | Debt Domain | **Complete — evidenced** | [milestone-7](docs/checkpoints/milestone-7-local-product.md) | אירועי חוב, גלגולים ומד נטו עובדים על נתונים אמיתיים; המיגרציה מוחלת (2026-09-14), בדיקות allow/deny למסד טרם |
| 5 | Finance Engine | **Complete — evidenced** | [milestone-5](docs/checkpoints/milestone-5.md) | 13 מודולים; טהור, ללא תלות במסד |
| 6 | Dashboard Source of Truth | **Complete — evidenced** | [milestone-7](docs/checkpoints/milestone-7-local-product.md) | המסכים קוראים נתונים אמיתיים; fixture הפיתוח נשאר fail-closed |
| 6b | Product & UX Refinement | **Complete — evidenced** | [milestone-6b](docs/checkpoints/milestone-6b-product-refinement.md) | שפה פשוטה, מסך יומי, עיצוב |
| **7** | **Local Product** | **Complete — evidenced** | [milestone-7](docs/checkpoints/milestone-7-local-product.md) | **חנות מקומית, יבוא מסמכים, אישור, דוחות, גיבוי, PWA** |
| 8 | Imports & Approval Inbox | **Complete — evidenced** | [milestone-7](docs/checkpoints/milestone-7-local-product.md) | הוקדם ל־M7; `IMP-DRAFT-001` מאומת |
| 9 | OCR/Voice/Email Adapters | **Blocked** | — | ממשק `OcrProvider` קיים ומסרב; דורש credentials |
| 10 | Budget & Sinking Funds | **In progress** | [milestone-7](docs/checkpoints/milestone-7-local-product.md) | תקציב עובד; קרנות ומטרות (שלבי מפל 8 ו־10) עדיין תובעים 0 |
| 11 | Business & Safe Transfer | **Complete — evidenced** | [milestone-7](docs/checkpoints/milestone-7-local-product.md) | חישוב, מסך והעברה שנרשמת בשני צדדים ומתאפסת מאוחד |
| 12 | Debt Plan & Advisor | Not started | — | דורש AI credentials |
| 13 | Summaries, Notifications & Reports | **In progress** | [milestone-7](docs/checkpoints/milestone-7-local-product.md) | דוחות וייצוא קיימים; התראות מקומיות בלבד |
| 14 | Hardening & Production | **In progress** | [milestone-8](docs/checkpoints/milestone-8-access-and-gemach.md) | נעילת גישה מקומית עובדת; אירוח, TLS ו־RPO/RTO עדיין פתוחים |
| — | **Local Access & Gemach** | **Complete — evidenced** | [milestone-8](docs/checkpoints/milestone-8-access-and-gemach.md) | **WebAuthn מול Windows Hello; גמ״ח וצ׳קים דחויים** |
| — | **Production Data Layer** | **Complete — evidenced (on branch, not merged)** | [production-data-layer](docs/checkpoints/production-data-layer.md) | **האפליקציה קוראת וכותבת דרך Supabase כמשתמש מחובר; RLS מוכח על 32 טבלאות; ריצה חיה 13/13; ממתין למיזוג** |

## שערי איכות — מצב נוכחי

הרצה אחת של `npm run verify`, exit 0 אמיתי, 2026-09-07.

| שער | סטטוס | ראיה |
|---|---|---|
| Install | Active | `npm ci --ignore-scripts`, 0 vulnerabilities |
| Format | Active | `prettier --check .`, exit 0 |
| Typecheck | Active | שורש + 7 workspaces |
| Lint | Active | `--max-warnings=0`, type-aware |
| **Unit** | Active | **1810/1810**, 53 קבצים, 0 מדולגות |
| **Property** | Active | **41/41**, כולל אינווריאנטים של צ׳קים תחת רצפי פעולות שרירותיים |
| Build | Active | 26 מסלולים |
| **Built-shell** | Active | **14/14 מול השרת הרץ** — 5 מסלולים, משק בית מוזרע (`ADR-0027`) |
| Client-secret boundary | Active | 0 ממצאים |
| Manual bundle | Active | 10 מיגרציות, תואם למקורות (`ADR-0019`) |
| Forbidden scan | Active | 177 קבצים, 0 errors |
| Traceability | Active | 66/66 |
| **Integration / RLS** | Active (מקומי, `npm run integration`) | **233/233 מול Supabase** (8 קבצים, 32 טבלאות, 9 תחומי store), 2026-09-15; לא חלק מ־`verify` — דורש `SUPABASE_DB_URL` מקומי |
| **Production path (live)** | Active (מקומי, `npm run validate:production-path`) | **13/13** דרך Supabase Auth + PostgREST, 2026-09-15 |
| **Fail-closed + readiness** | Active | **9/9** |
| E2E / axe אוטומטי | Defined, לא פעיל | Playwright לא מותקן; ביקורת מבנית הורצה במקום ומוצהרת ככזו |

## פערים פתוחים

| # | פער | השפעה | טיפול |
|---:|---|---|---|
| 1 | דרישות ב־`04`, `05`, `07`, `08`, `11` ללא תוויות מזהה | traceability חלקי מחוץ ל־46 המזהים הרשומים | כל milestone רושם מזהים למה שהוא מממש — `ADR-0004` |
| 2 | `UX-DEBT-001` אינו מוקצה | אין | המזהה שמור |
| 3 | CI ירוק ב־GitHub Actions על `main` ועל `production-data-layer`; בדיקות האינטגרציה מול המסד אינן ב־CI | RLS מוכח מקומית בלבד | סוד DB ל־CI — החלטה לפני שילוב |
| 11 | אין UI לעריכת שם הפרופיל של מוזמן (השם נגזר מהאימייל בהצטרפות) | קוסמטי | מסך פרופיל — milestone הבא |
| 4 | axe ומקלדת אוטומטיים לא הורצו | `UX-A11Y-001` חלקי | ביקורת מבנית על 17 מסלולים × 4 רוחבים הורצה; axe דורש Playwright |
| 5 | גופני Assistant/Heebo לא מוטמעים | טקסט עברי נופל לגופן מערכת | milestone עיצוב; קשור ל־`ADR-0026` |
| 6 | `.nvmrc` נועל Node 24.18.1; המכונה מריצה 24.19.0 | CI ירוץ על גרסה אחרת מהמקומית | נדרשת החלטה; לא שונה בלי ADR |
| 7 | `UX-STATE-001` כמעט מלא | offline קיים; queued/conflict אינם רלוונטיים בלי סנכרון | ייפתח כשיהיה שרת משותף |
| 8 | שלבים 8 ו־10 במפל תובעים 0 | אין קרנות ומטרות | Milestone 10; השלבים מוצגים ריקים ולא מוסתרים |
| 9 | אין הצפנה במנוחה | הקובץ מוגן בהרשאות מערכת ההפעלה בלבד | נאמר במסך הפרטיות; ייבחן ב־M14 |
| 10 | תהליך אחד בלבד | התור מגן מפני בקשות מקבילות, לא מפני שני תהליכים | מקובל למוצר מקומי; המסד פותר |

## חסמים שדורשים פעולה או החלטה שלך

| Milestone | מה נדרש | למה קלוד לא יכול להשיג זאת |
|---:|---|---|
| 9 | ספק OCR, Gmail OAuth | חשבונות חיצוניים; שליחת מסמך החוצה היא החלטה שלכם |
| 12 | מפתח API של ספק AI | סוד חיצוני |
| 14 | תוכנית אירוח, RPO/RTO, אנשי קשר | החלטה עסקית |

**המוצר אינו ממתין לאף אחד מאלה.** הוא עובד במלואו ידנית, היום.

## לצפייה במוצר

```
npm run dev -- --hostname 127.0.0.1 --port 3100
```

השרת מאזין על 127.0.0.1 בלבד. בכניסה ראשונה המסכים מציעים להקים משק בית; משם הכול נשמר
ב־`.data/` בשורש הפרויקט.

`NEXT_PUBLIC_DEV_DATA_SOURCE=on` ב־`apps/web/.env.local` מפעיל את fixture הפיתוח — **רק**
כשאין משק בית, ורק בבנייה שאינה ייצור. משק בית אמיתי גובר עליו תמיד.
