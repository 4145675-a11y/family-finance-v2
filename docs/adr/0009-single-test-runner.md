# ADR-0009: Vitest כ־runner יחיד; בדיקות נכתבות ללא JSX

- **Status**: Accepted
- **Date**: 2026-08-16
- **Milestone**: 1
- **Requirement IDs**: —

## הקשר

Milestone 0 הריץ את בדיקות הכלים על `node --test` המובנה, כי באותו שלב לא הותקנה שום תלות (`ADR-0003`). Milestone 1 מתקין toolchain מלא, ו־`ADR-0002` כבר סימן את Vitest כ־runner של הפרויקט.

שני runners במקביל פירושם שני דיווחי כיסוי, שתי תצורות ושתי דרכים לכתוב בדיקה.

## החלטה

1. **Vitest הוא ה־runner היחיד.** 18 הבדיקות של `tools/forbidden-scan.test.mjs` הועברו מ־`node:test` ל־Vitest. הטענות (assertions) לא שונו — רק ה־API. הכיסוי לא ירד.
2. **בדיקות נכתבות ללא JSX.** רכיבים נבנים בבדיקה עם `createElement`.
3. `vitest.config.ts` קובע `allowOnly: false` ו־`passWithNoTests: false`.

## למה בלי JSX בבדיקות

Vitest 4 מבצע טרנספורמציה עם **oxc**, לא esbuild. oxc קורא את `apps/web/tsconfig.json`, שבו `jsx: "preserve"` — ההגדרה שהמהדר של Next דורש. התוצאה: קובץ בדיקה עם JSX נכשל בפירוק עם `content contains invalid JS syntax`.

נבחנו שלוש דרכים:

| חלופה | הערכה |
|---|---|
| להתקין `@vitejs/plugin-react` | תלות נוספת שתפקידה היחיד לפצות על אי־התאמת קונפיגורציה |
| לשנות את `jsx` ב־tsconfig של האפליקציה | לשבור את קונפיגורציית Next כדי לרצות את ה־runner — הזנב מכשכש בכלב |
| להגדיר `oxc.jsx` ב־vitest.config.ts + בדיקות ללא JSX (נבחר) | אפס תלויות נוספות; קוד המקור נשאר כפי שהוא |

`vitest.config.ts` מגדיר `oxc: { jsx: { runtime: 'automatic' } }` כדי שקובצי המקור `.tsx` יעברו טרנספורמציה, והבדיקות עצמן נכתבות ב־`createElement` כדי שלא יהיו תלויות בכלל בשאלה הזו.

כאשר Milestone 6 יזדקק לבדיקות רכיב אמיתיות (Testing Library, אירועי משתמש), אותו milestone יוסיף את התשתית המתאימה במודע.

## השלכות

- חיוביות: runner אחד, דיווח אחד, אפס תלויות נוספות. 88 בדיקות רצות בפקודה אחת.
- שליליות: קריאות פחותה בבדיקות רכיב עתידיות עד ש־Milestone 6 יסדר את זה.
- לאימות: `npm run unit` — 88 עוברות, 0 נכשלות, 0 מדולגות.

## תנאי ביטול

Milestone 6 רשאי להוסיף תמיכת JSX בבדיקות. אין לחזור לשני runners במקביל.
