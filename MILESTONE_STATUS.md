# MILESTONE STATUS

מצב הפרויקט מול `09-MILESTONES.md`. מתעדכן בסוף כל milestone, לפני העצירה לאישור.

- **תאריך עדכון אחרון**: 2026-08-23
- **Milestone פעיל**: 6 — Dashboard Source of Truth
- **סטטוס**: **מוצר מקומי פעיל.** finance-engine מלא ונבדק; הדשבורד רץ בדפדפן על נתוני הדגמה מסומנים. **המיגרציות עדיין לא הוחלו על שום מסד** — ראה חסמים.
- **Branch**: `milestone-2-identity-isolation` — M2 עד M6 נבנו עליו. אין remote ולא בוצע push.
- **מוזג ל־`main`**: Milestone 0 ו־Milestone 1 בלבד.

## מקרא

`Not started` · `In progress` · `Complete — evidenced` · `Blocked`

אין `Complete` בלי דוח Checkpoint עם פקודות שהורצו ותוצאות. אין `Complete` חלקי — milestone שלא הושלם במלואו נשאר `In progress` עם רשימת פערים.

## טבלת מצב

| # | Milestone | סטטוס | Checkpoint | הערה |
|---:|---|---|---|---|
| 0 | Bootstrap | **Complete — evidenced** | [milestone-0](docs/checkpoints/milestone-0.md) | 4 שערים, 5 ADRs, 23 דרישות |
| 1 | Repository Foundation | **Complete — evidenced** | [milestone-1](docs/checkpoints/milestone-1.md) | 9 שערים, 88 בדיקות |
| 2 | Identity & Isolation | **In progress — blocked** | [milestone-2](docs/checkpoints/milestone-2.md) | קוד, migrations, RLS ו־24 בדיקות בידוד; **החלה חסומה** |
| 3 | Financial Accounts & Opening Picture | **In progress — blocked** | [milestone-3](docs/checkpoints/milestone-3.md) | 7 טבלאות + RLS + חוזים נבדקו; **מיגרציה לא הוחלה** |
| 4 | Debt Domain | **In progress — blocked** | [milestone-4](docs/checkpoints/milestone-4.md) | 3 טבלאות, טריגר אימות גלגולים; **מיגרציה לא הוחלה** |
| 5 | Finance Engine | **Complete — evidenced** | [milestone-5](docs/checkpoints/milestone-5.md) | 13 מודולים, 206 unit + 24 property; טהור, ללא תלות במסד |
| 6 | Dashboard Source of Truth | **In progress** | [milestone-6](docs/checkpoints/milestone-6.md) | 4 מסכים רצים; נתוני הדגמה בלבד; axe/RTL visual לא הורצו |
| 7 | PWA & Offline | Not started | — | |
| 8 | Imports & Approval Inbox | Not started | — | |
| 9 | OCR/Voice/Email Adapters | Not started | — | דורש credentials |
| 10 | Budget & Sinking Funds | Not started | — | שלבים 8 ו־10 במפל תובעים 0 עד אז |
| 11 | Business & Safe Transfer | Not started | — | נוסחאות קיימות במנוע; זרימת אישור חסרה |
| 12 | Debt Plan & Advisor | Not started | — | דורש AI credentials |
| 13 | Summaries, Notifications & Reports | Not started | — | |
| 14 | Hardening & Production | Not started | — | דורש החלטת אירוח ו־RPO/RTO |

## שערי איכות — מצב נוכחי

הרצה אחת של `npm run verify`, exit 0 אמיתי, 2026-08-23.

| שער | סטטוס | ראיה |
|---|---|---|
| Install | Active | `npm ci --ignore-scripts`, 0 vulnerabilities |
| Format | Active | `prettier --check .`, exit 0 |
| Typecheck | Active | שורש + 4 workspaces |
| Lint | Active | `--max-warnings=0`, type-aware |
| Unit | Active | **581/581**, 25 קבצים, 0 מדולגות |
| **Property** | **Active מ־M5** | **24/24**, seed קבוע 20260823, 300 runs לכל property |
| Build | Active | 5 routes, כולן prerendered |
| Built-shell | Active | 8/8 על ה־HTML הבנוי |
| Client-secret boundary | Active | 16 מודולים + 12 קבצי bundle, 0 ממצאים |
| Manual bundle | Active | 8 מיגרציות, תואם למקורות (`ADR-0019`) |
| Forbidden scan | Active | 89 קבצים, 0 errors |
| Traceability | Active | 34/34 |
| Integration / RLS | Defined, **חסום** | דורש `SUPABASE_DB_URL` — 24 בדיקות בידוד ממתינות |
| E2E / axe / RTL visual | Defined, לא פעיל | Milestone ייעודי; Playwright לא מותקן |

## פערים פתוחים

| # | פער | השפעה | טיפול |
|---:|---|---|---|
| 1 | דרישות ב־`04`, `05`, `07`, `08`, `11` ללא תוויות מזהה | traceability חלקי מחוץ ל־34 המזהים הרשומים | כל milestone רושם מזהים למה שהוא מממש — `ADR-0004` |
| 2 | `UX-DEBT-001` אינו מוקצה | אין | המזהה שמור |
| 3 | אין git remote | CI לא רץ בפועל | אותם שערים רצים מקומית |
| 4 | overflow לא נמדד בפיקסלים ב־360/390/768/1280 | `UX-RTL-001` מאומת מבנית בלבד | Playwright; מוצהר NOT RUN |
| 5 | axe ומקלדת לא הורצו על המסכים החדשים | `UX-A11Y-001` חלקי | אותו milestone |
| 6 | גופני Assistant/Heebo לא מוטמעים | טקסט עברי נופל לגופן מערכת | milestone עיצוב |
| 7 | `.nvmrc` נועל Node 24.18.1; המכונה מריצה 24.19.0 | CI ירוץ על גרסה אחרת מהמקומית | נדרשת החלטה; לא שונה בלי ADR |
| 8 | `UX-STATE-001` חלקי | loading/stale/offline/queued/conflict חסרים | Milestone 7 |
| 9 | שלבים 8 ו־10 במפל תובעים 0 | אין קרנות ומטרות | Milestone 10; השלבים מוצגים ריקים ולא מוסתרים |

## חסמים שדורשים פעולה או החלטה שלך

| Milestone | מה נדרש | למה קלוד לא יכול להשיג זאת |
|---:|---|---|
| 2–4 | החלת המיגרציות + `SUPABASE_DB_URL` להרצת בדיקות הבידוד | סיסמת מסד. חשבון חיצוני וסודות; Docker אינו זמין במכונה |
| 9 | Gmail OAuth, ספק OCR | חשבונות חיצוניים |
| 12 | מפתח API של ספק AI | סוד חיצוני |
| 14 | תוכנית אירוח, RPO/RTO, אנשי קשר | החלטה עסקית |

## הצעד הבא

שלוש פעולות מקומיות שלך, ללא שיתוף ערכים בצ׳אט:

1. `npm run db:copy:diagnostic` → חלון SQL **חדש וריק** → הרץ פעם אחת → מסור את טבלת EXISTS/missing.
2. `npm run db:copy:schema` → חלון חדש וריק → הרץ פעם אחת. שמונה המיגרציות, טרנזקציה אחת, בטוח להרצה חוזרת.
3. צור `.env.integration.local` עם `SUPABASE_DB_URL`, הרץ `npm run integration`, ומסור **סיכום בלבד**.

לאחר מכן אתקן כשלים אמיתיים ואסגור את M2–M4 ל־PASS או אדווח מה לא מחזיק.

## לצפייה במוצר המקומי

```
npm run dev -- --hostname 127.0.0.1
```

עם `NEXT_PUBLIC_DEV_DATA_SOURCE=on` ב־`apps/web/.env.local`. השרת מאזין על 127.0.0.1 בלבד. בלי הדגל המסכים יציגו "אין כרגע מקור נתונים" — וזו התנהגות נכונה, לא תקלה.
