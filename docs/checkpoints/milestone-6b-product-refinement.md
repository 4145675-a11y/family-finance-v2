# CHECKPOINT — Milestone 6b: Product & UX Refinement

- **Result**: **PARTIAL — the product is materially better and runs locally; browser-level accessibility and the database remain unverified**
- **Branch**: `milestone-2-identity-isolation` · לא בוצע merge, לא בוצע push
- **Environment**: local, Windows 11 Pro, Node v24.19.0, npm 11.17.0
- **Date**: 2026-08-23

> **למה זה milestone נוסף ולא תיקון**: המשוב על המוצר הרץ נגע בשלושה דברים — שפה, צפיפות והיעדר תקציב — ואף אחד מהם אינו באג. שלושתם החלטות מוצר שדורשות ADR, סכמה, מנוע ובדיקות. הליבה הפיננסית לא שונתה.

## מה נאמר, ומה נעשה

| המשוב | מה נעשה |
|---|---|
| התוכן והחישובים מצוינים | לא שונו. 207 בדיקות המנוע הקיימות ממשיכות לעבור, כולל כל אינווריאנטי הגלגול |
| השפה מקצועית מדי | המנוע מחזיר קודים; כל העברית בשכבה אחת; שער טון חוסם ז׳רגון והאשמה (`ADR-0022`) |
| יותר מדי מידע ליום־יום | תשובה אחת, פעולה אחת, ארבעה כרטיסים, השאר מקופל או במסך משלו (`ADR-0021`) |
| חסר תקציב חודשי ושבועי לאוכל | דומיין דטרמיניסטי חדש + מסך ייעודי + מיגרציות (`ADR-0023`) |
| העיצוב חיוור, 4/10 | פלטה חמה ועמוקה, היררכיה, שלושה מפלסי הצללה (`ADR-0020`) |

## Scope

### הושלם ואומת

| פריט | ראיה |
|---|---|
| שכבת עברית אחת | `apps/web/lib/copy` — 31 בדיקות טון, כיסוי מלא של קודי המנוע נאכף |
| שער טון | `banned-terms.ts` — 26 מונחים; כל אחד נבדק על fixture חיובי ושלילי |
| בידוד דו־כיווני במשפטים | `money()`/`count()` עוטפים ב־`U+2068`…`U+2069`; נבדק |
| היררכיית מסך הבית | `screens.test.ts` — סדר, Hero יחיד, תקציב לא על הבית |
| מנוע תקציב | `calculateBudget` — 24 בדיקות; שש כמויות נפרדות |
| הנחיה שבועית לאוכל | `calculateFoodWeek` — 28 בדיקות; לא חלוקה בארבע |
| אינווריאנטי תקציב | 11 בדיקות property; העברה שומרת על הסך, שבוע לא עובר את החודש |
| פלטה חדשה | 23 זוגות ניגודיות AA, נבדקו לפני הכתיבה |
| ניווט חמישה יעדים | אישורים ותנועה — מסכים כנים שאינם קוראים נתונים; נבדק |
| נעילת נתוני הדגמה בייצור | 15 בדיקות; ה־HTML הבנוי מכיל מצב ריק ואפס נתוני הדגמה |

### הושלם אך **לא אומת**

| פריט | מצב |
|---|---|
| `20260823110000_budgets.sql` | `budgets`, `budget_lines`, `budget_changes`. **לא הוחלה** |
| `20260823110100_budget_row_security.sql` | RLS enabled+forced, בדיקות בעלות, audit. **לא הורצה** |
| `UX-RTL-001` בפיקסלים | מבנה נכון; מדידה ב־360/390/768/1280 **לא בוצעה** — אין Playwright |
| `UX-A11Y-001` בדפדפן | ניגודיות, focus, 44px, טקסט חלופי — נבדקו סטטית. **axe ומקלדת לא הורצו** |

### לא בוצע, ובכוונה

כתיבה אמיתית. כפתורי העדכון המהיר מושבתים ואומרים למה: אין שכבת שמירה מאומתת, וכפתור שנראה עובד ואינו שומר גרוע מכפתור מושבת. אישורים ותנועה — Milestone 8. `offline`/`conflict` — Milestone 7.

## Changes

**חדש**: `packages/finance-engine/src/{notice,budget,food-week}.ts` + בדיקות · `packages/contracts/src/budget.ts` · `apps/web/lib/copy/{copy,notices,banned-terms}.ts` + 3 קבצי בדיקה · `apps/web/app/{budget,approvals,activity,more}/page.tsx` · `apps/web/app/screens.test.ts` · 2 מיגרציות · ADR 0020–0023

**שונה**: כל מודול במנוע שהחזיר עברית · `apps/web/app/{page,forecast,debts,business}` · `components/{ui,app-shell}.tsx` · `design-system/src/tokens.ts` · `globals.css` · `lib/{format,dashboard/*}`

## Commands & Evidence

`npm run verify`, **exit 0 אמיתי**:

| Gate | Result | Counts |
|---|---|---|
| Format · Typecheck · Lint | **PASS** | 4 workspaces |
| Unit | **PASS** | **801 passed**, 30 קבצים, 0 מדולגות |
| Property | **PASS** | **35 passed**, seed 20260823 |
| Build | **PASS** | 9 routes, כולן prerendered |
| Built-shell | **PASS** | 8/8 |
| Client secrets | **PASS** | 0 ממצאים |
| Manual bundle | **PASS** | 10 מיגרציות |
| Forbidden scan | **PASS** | 108 קבצים, 0 errors |
| Traceability | **PASS** | 38/38 |
| Local server | **PASS** | 127.0.0.1 בלבד |
| **Migrations** | **NOT RUN** | חסום — אין חיבור DB |
| **axe / RTL visual** | **NOT RUN** | אין Playwright |

## Negative verification

כל אחד נשתל, הופל את השער, ושוחזר:

| מה נשבר בכוונה | תוצאה |
|---|---|
| מילה מאשימה במסך הבית | `tone.test.ts` **נכשל** — `app/page.tsx uses no forbidden term` |
| העברה תקציבית שמוסיפה אגורה ליעד | 2 בדיקות property **נכשלו** — הסך המתוכנן השתנה |
| הסרת ה־`Math.min` מההנחיה השבועית | property **נכשל** — השבוע חרג ממה שנשאר לחודש |
| הבילד של ייצור | מכיל את המצב הריק ו־**0** מספרי ההדגמה |

הכיבוי הפתאומי של המחשב אירע מיד אחרי השחזורים. שלושת הקבצים נבדקו בנפרד בפתיחת הסשן ונמצאו נקיים, ו־`npm run verify` הורץ מחדש ועבר לפני שנגעתי בקוד.

## Reviews

- **Code**: אין `any`, אין השתקות, אין TODO. מסך אינו מחשב ואינו מפרמט כסף — נאכף ב־`screens.test.ts`.
- **Financial invariants**: הליבה לא שונתה. תוכנית תקציב אינה מזיזה יתרה; סיווג מחדש אינו משנה סך; ממתין לאישור אינו מתמזג עם מאושר; כל הסכומים integer minor units — כולם כ־property.
- **Security/privacy**: RLS enabled+forced על שלוש הטבלאות החדשות; בדיקת בעלות על כל מפתח זר שמדיניות מקבלת; audit ללא טקסט חופשי; אין DELETE.
- **UX/RTL/states**: `dir` פעם אחת בשורש; כל ריצת ספרות מבודדת; 44px; מד התקדמות עם `role="img"` וטקסט חלופי; מצבי ריק/חלקי/ישן/הדגמה/בבנייה קיימים.

## Risks

| סיכון | חומרה | טיפול |
|---|---|---|
| מסך הדגמה שנראה אמיתי | **גבוהה** | באנר קבוע, `isRealData: false`, חסימה מוחלטת בייצור, 15 בדיקות |
| נגישות לא נמדדה בדפדפן | בינונית | מוצהר NOT RUN; מבנה נכון + בדיקות סטטיות |
| קודי notice הם חוזה שביר | נמוכה | `copy.test.ts` נכשל על קוד בלי משפט ועל משפט בלי קוד |

## Stop declaration

לא מוזג ל־`main`, לא בוצע push, ולא סומן שום רכיב מסד או נגישות־דפדפן כמאומת.
