# CHECKPOINT — Milestone 6: Dashboard Source of Truth

- **Result**: **PARTIAL — the screens are real and run, on a development fixture rather than on verified data**
- **Branch**: `milestone-2-identity-isolation` · לא בוצע merge
- **Environment**: local, Windows 11 Pro, Node v24.19.0, npm 11.17.0
- **Date**: 2026-08-23

> **למה PARTIAL**: המסכים קיימים, רצים בדפדפן, ומציגים אך ורק מה ש־finance-engine החזיר. מה שהם מציגים הוא **נתוני הדגמה מומצאים**, כי אין מסד מאומת. שני קריטריוני קבלה נוספים טרם הורצו: מדידת overflow בפיקסלים (`UX-RTL-001`) ובדיקת axe/מקלדת (`UX-A11Y-001`) דורשות Playwright, שאינו מותקן.

## Scope

### הושלם ואומת

| פריט | ראיה |
|---|---|
| היררכיית מסך הבית | ששת הסעיפים לפי `01-PRODUCT-SPEC.md § מסך הבית`, בסדר: עדכניות ואמינות · סכום בטוח · תחזית ונקודת שפל · חוב נטו וכולל · בית מול עסק · פעולה אחת |
| כל מספר פותח breakdown (`UX-TRUST-001`) | `<details>` ללא JavaScript — עובד גם לפני hydration ולמשתמש מקלדת |
| קרן מול ריבית ועלות | פירעון ברוטו, חוב חדש, מתוכו בגלגול, ירידה שמומנה מהכנסה, ריבית ועמלות, תיקוני יתרה — כל אחד בשורה משלו |
| ארבעה מסכים אמיתיים | `/` · `/forecast` · `/debts` · `/business` |
| ניווט | bottom nav במובייל, sidebar ימני בדסקטופ, מאותה רשימה |
| שער מקור הנתונים (`UX-SOURCE-001`) | 15 בדיקות ב־`source.test.ts`; ייצור סגור בכל ערך דגל |
| מצב ריק אמיתי | ללא מקור — המסך אומר שאין נתונים ואינו מציג אפסים |
| bidi | כל מספר בתוך `<bdi dir="ltr">`; מאומת ב־unit ובשער ה־built-shell |

### מקור הנתונים — ההחלטה המרכזית

`ADR-0017`. מקור יחיד, `development_fixture`, מאחורי שני תנאים מצטברים: `NODE_ENV !== 'production'` (נבדק ראשון, לא ניתן לעקיפה) ו־`NEXT_PUBLIC_DEV_DATA_SOURCE === 'on'` (הליטרל המדויק בלבד). ה־import שלו דינמי ומתרחש רק אחרי שהשער אישר, ולכן הוא אינו נכנס ל־bundle של ייצור.

כל מסך שמציג אותו נושא באנר קבוע: *"המסך מוצג על נתוני הדגמה מומצאים… אלה אינם הכספים שלכם."* אין דרך לכבות אותו.

### לא בוצע, ובכוונה

- **Reference screenshots ב־390/768/1280** — `04-DESIGN-SYSTEM.md` דורש אישור snapshots לפני הרחבת שפה עיצובית. לא הורץ: אין Playwright.
- **`UX-STATE-001` במלואו** — `empty` ו־`partial` קיימים ונבדקו. `loading`, `stale`, `offline`, `queued` ו־`conflict` דורשים שכבת סנכרון (M7).
- **מסכי אישורים, תנועה ותכנון** — M8+. הם אינם בניווט: פריט ניווט שמוביל להבטחה ריקה הוא placeholder שמוצג כיכולת.

## Changes

**חדש**: `apps/web/lib/format.ts` + 21 בדיקות · `apps/web/lib/dashboard/{source,load}.ts` + 15 בדיקות · `apps/web/lib/dashboard/fixtures/demo-household.ts` · `apps/web/components/{ui,app-shell}.tsx` · `apps/web/app/{forecast,debts,business}/page.tsx` · ADR 0017, 0018

**שונה**: `apps/web/app/page.tsx` (מעטפת M1 ← דשבורד) · `apps/web/app/layout.test.ts` · `apps/web/next.config.ts` (`transpilePackages`) · כל הייבוא היחסי בקוד שנארז (`ADR-0018`)

## Commands & Evidence

| Gate | Command | Result | Counts |
|---|---|---|---|
| Unit | `npm run unit` | **PASS** | 581 passed, 25 קבצים |
| Property | `npm run property` | **PASS** | 24 passed |
| Build | `npm run build` | **PASS** | 5 routes, כולן prerendered |
| Built-shell | `npm run check:shell` | **PASS** | 8/8 על ה־HTML הבנוי |
| Client secrets | `npm run check:client-secrets` | **PASS** | 16 מודולים + 12 קבצי bundle |
| Aggregate | `npm run verify` | **PASS** | exit 0 אמיתי |
| Local server | `npm run dev -- --hostname 127.0.0.1` | **PASS** | HTTP 200 על ארבעת המסלולים |
| **E2E / axe / RTL visual** | — | **NOT RUN** | Playwright לא מותקן; מוצהר כלא־נבדק |

הבילד של ייצור מרנדר את מצב "אין מקור נתונים" — כלומר שער ה־built-shell בודק בדיוק את המסך שמשתמש ייצור היה מקבל, ולא את מסך ההדגמה.

## Negative verification

| מה נשבר בכוונה | תוצאה |
|---|---|
| `NODE_ENV=production` עם הדגל דלוק | מקור נחסם; נבדק על שישה ערכי דגל שונים |
| `NEXT_PUBLIC_DEV_DATA_SOURCE=true` / `1` / `ON` / `on ` | כולם סגורים — רק `on` המדויק פותח |
| הדגל כבוי | `snapshot` הוא `null`, המסך מצהיר על היעדר נתונים ואינו מציג 0 |
| ניסיון לבנות עם ייבוא `.js` לקבצי `.ts` | `next build` נכשל ב־20 שגיאות; תוקן ותועד ב־`ADR-0018` |

## Reviews

- **Code**: המסכים אינם מחשבים דבר. כל מספר מגיע מ־`FinancialSnapshot`.
- **Financial invariants**: הדשבורד אינו חוגג פירעון ברוטו; ההודעה על התקדמות מותנית ב־`consumerDirection === 'down'`.
- **Security/privacy**: אין secret במסלול לקוח (שער עובר על 16 מודולים ו־12 קבצי bundle). ה־fixture אינו מכיל נתוני אדם אמיתי.
- **UX/RTL/states**: `dir` מוצהר פעם אחת בשורש; כל ריצת ספרות מבודדת; touch target 44px; `<details>` נגיש במקלדת. מדידת overflow בפיקסלים — לא בוצעה.

## Risks

| סיכון | חומרה | טיפול |
|---|---|---|
| מסך הדגמה שנראה אמיתי | **גבוהה** | באנר קבוע בכל מסך + `isRealData: false` + חסימה מוחלטת בייצור |
| `UX-RTL-001` ו־`UX-A11Y-001` לא נמדדו בדפדפן | בינונית | מוצהר NOT RUN; Playwright ב־milestone ייעודי |
| ה־fixture עלול להתיישן מול המנוע | נמוכה | הוא מוקלד ל־`EngineInput`; שינוי חוזה מפיל typecheck |

## Stop declaration

לא מוזג ל־`main`. לא נוצרה זרימת כתיבה: המסכים קוראים בלבד, ואין בהם טופס ששומר דבר.
