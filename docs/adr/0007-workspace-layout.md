# ADR-0007: מבנה ה־workspaces — נוצרות רק חבילות עם תוכן אמיתי

- **Status**: Accepted
- **Date**: 2026-08-16
- **Milestone**: 1
- **Requirement IDs**: —

## הקשר

`05-ARCHITECTURE-DATA.md` מגדיר ארבעה גבולות: `packages/finance-engine` (pure domain), `packages/contracts` (Zod/types), `packages/design-system` (tokens/components) ו־`apps/web`.

השאלה ב־Milestone 1 היא לא **אילו** חבילות יהיו — זה נקבע במסמך הסמכות — אלא **מתי** כל אחת נוצרת.

## החלטה

נוצרות עכשיו רק החבילות שיש להן תוכן אמיתי ב־Milestone 1:

| חבילה | נוצרה | סיבה |
|---|---|---|
| `apps/web` | כן | ה־shell העברי RTL הוא תכולת Milestone 1 |
| `packages/design-system` | כן | tokens הם תכולת Milestone 1 מפורשת |
| `packages/finance-engine` | לא | Milestone 5 |
| `packages/contracts` | לא | Milestone 3 |

`package.json` בשורש כבר מגדיר `workspaces: ["apps/*", "packages/*"]`, כך שחבילה חדשה נקלטת ברגע שהיא נוצרת, בלי שינוי קונפיגורציה.

תיקיית חבילה ריקה עם `package.json` בלבד היא placeholder שנראה כמו יכולת קיימת — בדיוק מה ש־`CLAUDE.md` אוסר. חבילה תיווצר ב־milestone שנותן לה תוכן ובדיקות.

## פרטי מימוש

- `packages/design-system` מייצא TypeScript מקורי (`exports: "./src/index.ts"`); `apps/web` מקמפל אותו דרך `transpilePackages`. אין שלב build נפרד לחבילה, ואין קוד מקומפל במאגר.
- `tsconfig.base.json` בשורש מרכז את הגדרות ה־strict; כל workspace יורש ומוסיף רק את מה שייחודי לו.
- `tsconfig.json` בשורש קיים כדי שקבצי קונפיגורציה ברמת השורש (`vitest.config.ts`) ייכללו ב־project service של ה־linter. בלעדיו ESLint נכשל עם "was not found by the project service".

## השלכות

- חיוביות: אין תיקייה ריקה שמתחזה לרכיב; הגבולות מ־`05` נשמרים; הוספת חבילה אינה דורשת שינוי תשתית.
- שליליות: מי שקורא את מבנה התיקיות לבדו לא רואה את התמונה המלאה. `05-ARCHITECTURE-DATA.md` ו־ADR זה הם המקור לכך.
- לאימות: `npm run typecheck` רץ על כל workspace קיים; `npm run build` מקמפל את `apps/web` יחד עם ה־design-system.

## תנאי ביטול

אם יתברר שנדרש שלב build לחבילה (למשל לצריכה חיצונית), ייכתב ADR חדש שמגדיר את שרשרת ה־build.
