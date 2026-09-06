# CI GATES — שערי איכות

`11-OPERATIONS.md` מחייב CI הכולל: format, typecheck, lint, unit, property, integration, RLS, build, smoke E2E ו־forbidden scan. `08-TEST-PLAN.md` מוסיף את השער הגלובלי: אין PASS עם בדיקות כושלות או מדולגות, עם build/type/lint כושלים, עם טבלה פרטית בלי RLS ובדיקה שלילית, עם חישוב בלי unit+property, או עם טענה בלי ראיה.

`.github/workflows/ci.yml` מריץ **רק שערים שקיימים באמת**. שער שאינו מיושם אינו מופיע כ־step ירוק. הסיבה: `ADR-0003`.

## טבלת השערים

| שער | פקודה | חוסם merge | פעיל מ־Milestone | ב־CI היום |
|---|---|:---:|---:|:---:|
| Install (`npm ci`) | `npm ci --ignore-scripts` | כן | 0 | ✅ |
| Cache boundary | בדיקה ש־npm cache בתוך הפרויקט | כן | 0 | ✅ |
| Unit | `npm run unit` | כן | 0 | ✅ |
| Forbidden scan | `npm run scan:forbidden` | כן | 0 | ✅ |
| Traceability | `npm run check:traceability` | כן | 0 | ✅ |
| Format | `npm run format:check` | כן | 1 | ✅ |
| Typecheck | `npm run typecheck` | כן | 1 | ✅ |
| Lint | `npm run lint` | כן | 1 | ✅ |
| Build | `npm run build` | כן | 1 | ✅ |
| Client-secret boundary | `npm run check:client-secrets` | כן | 2 | ✅ |
| Built shell (Hebrew RTL, landmarks, manifest) | `npm run check:shell` | כן | 1/7 | ✅ |
| Manual bundle up to date | `npm run db:check` | כן | 3 | ✅ |
| Integration + RLS negative | `npm run integration` | כן | 2 | — (חסום: דורש חיבור DB; ראה checkpoint M2) |
| Property | `npm run property` | כן | 5 | ✅ (רץ מקומית; אין remote) |
| E2E smoke | `npm run e2e -- --grep @smoke` | כן | 6 | — |
| Accessibility / RTL visual | `npm run a11y` | כן | 6 | — |
| Dependency + secret scan | ייקבע ב־Milestone 1 | כן | 1 | — |
| Migration verification | ייקבע ב־Milestone 2 | כן | 2 | — |
| Performance budgets | ייקבע ב־ADR ייעודי | לא (מדווח) | 14 | — |

## כללי השער

1. **אין שער אופציונלי.** שער שחוסם merge אינו מסומן `continue-on-error`.
2. **אין דילוג.** בדיקה מדולגת או ממוקדת נחסמת על ידי `scan:forbidden` עוד לפני שה־runner מגיע אליה.
3. **אין ירוק מדומה.** שער שלא מיושם — לא נמצא ב־workflow. אין step שמחזיר 0 בלי לעשות עבודה.
4. **קוד יציאה אמיתי.** כל step שמשתמש ב־pipe חייב `set -euo pipefail`.
5. **התקנה נעולה.** ב־CI תמיד `npm ci` (מ־lockfile), לעולם לא `npm install`.
6. **`--ignore-scripts`** בהתקנה ב־CI: מונע הרצת קוד צד שלישי בזמן install.
7. **הרחבת השער היא חלק מ־Definition of Done** של ה־milestone שמפעיל אותו. milestone שמוסיף יכולת בלי להוסיף את השער שלה אינו PASS.

## הערה על סביבת ההרצה

אין remote מוגדר למאגר בנקודת ה־bootstrap. קובץ ה־workflow נשמר כמחויב ותקף, ויופעל ברגע שהמאגר יחובר ל־GitHub. עד אז, אותם שערים בדיוק רצים מקומית דרך `npm run verify:m0` — אותן פקודות, אותם קודי יציאה.
