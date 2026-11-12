# CHECKPOINT — FEEDBACK: משוב מתוך המוצר

- **Result**: PARTIAL — הקוד, בדיקות היחידה, בדיקות הדפדפן ובדיקות הבידוד מול Supabase עוברים (27/27, 2026-11-12); הקוד ב־`main` (`8a5d527`) ופרוס ב־Render; ה־migration **לא הוחל** על המסד.
- **Branch**: `feature/in-product-feedback` (מ־`main` ב־`a409669`)
- **Environment**: Windows 11, Node 24.19.0, backend `local_json` לבדיקות הדפדפן
- **Date**: 2026-11-12
- **ADR**: [ADR-0047](../adr/0047-feedback-from-inside-the-product.md)

## Scope

- **הושלם**: `SEC-FEEDBACK-001`.
  - כפתור משוב בכל מסך שחבר מחובר מגיע אליו, בייצור ובמקומי, ב־Shadow DOM.
  - שלוש דרכי סימון: רכיב (עם "רכיב עוטף" ו"רכיב פנימי"), אזור, או המסך כולו.
  - טופס עם סוג, דחיפות, מונה תווים, מלכודת לבוטים ואזהרה לפני שליחה של סכום, טלפון, מייל או ת״ז. Escape סוגר בכל שלב, והחלון נסגר לבד 6 שניות אחרי התודה.
  - רשימה לבנה ב־`packages/contracts/src/feedback.ts`: שום טקסט מהמסך, ותבנית נתיב שבה כל מקטע שאינו מילה לטינית קטנה הופך ל־`[id]`.
  - טבלה `public.feedback`: אין policy של INSERT, כתיבה רק דרך `submit_feedback` עם מגבלה של 10 הערות בשעה לאדם. רק בעלי המערכת קוראים.
  - מקומי: קובץ אחד לכל הערה ב־`.data/feedback/`, נכתב עם `wx` ולא נדרס, ובאותה מגבלת קצב.
  - דף `/admin/feedback` לבעלי המערכת: סינון לפי סטטוס, שינוי סטטוס, מחיקה והורדת JSON מ־`/admin/feedback/export`.
  - שמות `data-fb` על המעטפת, על ה־hero ועל 72 כרטיסים בעלי כותרת.
- **לא הושלם**:
  - החלת ה־migration על המסד. פעולת בעלים. עד שהיא נעשית, שליחת משוב בייצור תחזיר "ההערה לא נשלחה".
- **מחוץ ל־scope ולא שונה**: מנוע הכסף, החשבונות, החובות, שכבת ה־AI, והבדיקה הנכשלת ב־`ai-unconfigured.plain.spec.ts` (ראו למטה).

## Changes

- **חדש**:
  - `packages/contracts/src/feedback.ts` ו־`feedback.test.ts`
  - `packages/local-store/src/feedback-store.ts` ו־`feedback-store.test.ts`
  - `apps/web/lib/feedback/collect.ts` ו־`collect.test.ts`, `apps/web/lib/feedback/server.ts`
  - `apps/web/lib/actions/feedback.ts`, `apps/web/lib/copy/feedback.ts`
  - `apps/web/components/feedback-widget.tsx`
  - `apps/web/app/admin/feedback/page.tsx`, `apps/web/app/admin/feedback/export/route.ts`
  - `supabase/migrations/20261112090000_in_product_feedback.sql`
  - `supabase/tests/rls-feedback.integration.test.ts`
  - `e2e/specs/feedback.spec.ts`, `e2e/specs/feedback.mobile.spec.ts`
- **שונה**:
  - `app-shell.tsx`: הכפתור ושמות `data-fb` על המעטפת.
  - `ui.tsx`: `Card` מקבל `fb`, ול־`Hero` יש `data-fb="hero"`.
  - `lib/store/server.ts`: `localFeedbackStore()`, הדלת היחידה לתיקיית הנתונים.
  - 23 קבצי `page.tsx`: הוספת `fb` בלבד.
  - `admin/page.tsx`: קישור לדף המשוב.
  - `.gitignore`: `.feedback/`.
  - `supabase/manual/apply-all.sql`: נבנה מחדש עם `db:build`.
  - תיעוד: `07-SECURITY-PRIVACY.md` § Feedback, `docs/REQUIREMENTS.md`, `10-TRACEABILITY-MATRIX.md`, `docs/adr/README.md`.
- **Migration**: תוספת בלבד. 4 טיפוסים, טבלה אחת, 4 פונקציות ו־policy אחת של SELECT. אידמפוטנטי לפי ADR-0015, ושום דבר קיים לא משתנה. החזרה למצב הקודם, אם תידרש: `drop table public.feedback` והפונקציות. אין תלות של שום טבלה אחרת בטבלה הזו.

## Commands & Evidence

| Gate | Command | Result | Counts/Evidence |
|---|---|---|---|
| Typecheck | `npm run typecheck` | PASS (0) | כל ה־workspaces |
| Lint | `npx eslint . --max-warnings=0 --ignore-pattern "product-video/**"` | PASS (0) | `npm run lint` המלא נכשל על `product-video/`, תיקייה שלא נמצאת ב־git ולא נגעתי בה |
| Format | `npm run format:check` | FAIL (2), רק `product-video/` | קבצי הפרויקט מעוצבים; השגיאה ב־`product-video/.work/primitives.ts` |
| Unit | `npm run unit` | PASS (0) | 2776/2776, מהן 47 חדשות: contracts 31, local-store 6, collect 10 |
| Property | `npm run property` | PASS (0) | 41/41 |
| RLS coverage | `npm run check:rls-coverage` | PASS (0) | 39/39 טבלאות enabled, forced ועם policy |
| SQL bundle | `npm run db:check` | PASS (0) | 25 migrations |
| Integration/RLS | `npx vitest run --config vitest.integration.config.ts supabase/tests/rls-feedback.integration.test.ts` | PASS (0) | 27/27 מול Supabase, 43.7 שניות. ה־migration הוחל בתוך טרנזקציית הבדיקה ובוטל איתה |
| DB cleanliness | `npm run db:cleanliness` | FAIL (1), צפוי | 38 טבלאות ציבוריות (בלי `feedback`, כלומר ה־migration בוטל), 0 משתמשי בדיקה, 38/38 RLS enabled+forced. ה־FAIL היחיד הוא "database holds no household": במסד יש משק בית אמיתי אחד, כי הייצור בשימוש |
| E2E (feedback) | `npm run e2e -- e2e/specs/feedback*.ts` | PASS (0) | 10/10: 8 במחשב ו־2 בטלפון |
| E2E (הכול) | `npm run e2e` | PASS (0) | 174/174, אחרי תיקון התאריך שפג ב־`ai-unconfigured.plain.spec.ts` (`8a5d527`) |
| Build | `npm run build`, `check:build`, `check:shell` | PASS (0) | |
| Fail-closed / secrets / env | `check:fail-closed`, `check:client-secrets`, `check:no-env-files` | PASS (0) | |
| Forbidden scan | `npm run scan:forbidden` | PASS (0) | 0 errors, 0 warnings |
| Traceability | `npm run check:traceability` | PASS (0) | 74 דרישות |

### הבדיקה שנכשלה ב־E2E המלא

`ai-unconfigured.plain.spec.ts:100` מצפה שהמשפט "לפירעון ב־10/10/2026" ייקרא כמועד פירעון. היום הוא 2026-11-12, כך שהתאריך כבר עבר, והכרטיס הציג אותו כתאריך הפעולה ("תאריך: 10 באוקטובר"). השינוי הזה לא נוגע ב־`packages/quick-update` ולא במסך העדכון המהיר. ההערכה היא שזו בדיקה שתלויה בתאריך ופגה. **לא אומת** בהרצה על `main`. 6 הבדיקות שאחריה באותו project לא רצו.

## Reviews

- **Code**: הכפתור נבנה ב־`collect.ts` משדות בשם בלבד, בלי spread, וב־`buildFeedbackRecord` הרשומה נבנית מחדש לפי שם. השרת מסנן לפי הרשימה הלבנה, והמסד אוכף אותה שוב ב־CHECK.
- **Financial invariants**: אין שינוי. שום טבלה כספית לא נגעה, ובשורת משוב אין עמודת סכום. בדיקת אינטגרציה אומרת את זה, ועברה.
- **Security/privacy**:
  - מזהה משק הבית והכותב נקבעים מה־session.
  - `submit_feedback` מסרבת לאדם בלי משק בית, לחבר מבוטל ולמשק בית מושבת.
  - חבר רגיל: אין לו SELECT, ואין לו כתיבה ישירה.
  - ייצוא: אין פרמטרים, ומי שאינו בעלי המערכת מקבל 404.
  - תוכן הערה לא נרשם ביומן.
  - מוכח ב־E2E: קובץ ההערה שנשמר לא כולל אף שורה מטקסט ה־hero, לא את `₪` ולא את שם המלווה.
- **UX/RTL**:
  - הכפתור: לשונית במחשב, אייקון בטאבלט, ובטלפון כפתור בגודל 44×44 שמעל הסרגל התחתון (מוכח ב־E2E).
  - ה־Shadow DOM מונע מהעיצוב של הכפתור לדלוף למוצר (מוכח ב־E2E).
  - הניסוח עבר את `tone.test.ts`.

## Forbidden scan findings

אין.

## Stop

עצירה לאישור. הצעדים הבאים, כל אחד דורש הוראה מפורשת:

1. החלת ה־migration על המסד (פעולת בעלים): `npm run db:apply -- supabase/migrations/20261112090000_in_product_feedback.sql`. הניסיון להריץ אותה מכאן נחסם על ידי בודק ההרשאות של הסביבה.

## Deployment (2026-11-12)

- `main` קודם ל־`8a5d527` בלי merge commit (fast-forward), ונדחף.
- GitHub: "Quality gates" success, "Deployed service (read-only)" success.
- `/api/health` מחזיר `readiness: ready` ו־`schema: compatible`.
- `npm run smoke:production`: 20/20.
- `/admin/feedback/export` עונה לאנונימי `404 Not found` עם `Cache-Control: no-store`, כלומר ה־handler החדש הוא שעונה.
- `db:cleanliness`: 38 טבלאות. `feedback` עוד לא קיימת, ולכן שליחת משוב בייצור עונה "ההערה לא נשלחה" עד להחלת ה־migration.
