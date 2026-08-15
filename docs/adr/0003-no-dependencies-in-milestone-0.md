# ADR-0003: Milestone 0 אינו מתקין תלויות; הפקודות מוגדרות בחוזה ומופעלות ב־Milestone שלהן

- **Status**: Accepted
- **Date**: 2026-08-15
- **Milestone**: 0
- **Requirement IDs**: —

## הקשר

קיים מתח בין שני מסמכי סמכות:

- `00-BOOTSTRAP-PROMPT.md` סעיף 5 מורה ל־Milestone 0: "הגדר פקודות install, dev, format, typecheck, lint, unit, property, integration, E2E, build ו־forbidden-artifact scan".
- `09-MILESTONES.md`, שהוא הסמכות על סדר העבודה לפי README, משייך ל־Milestone 1 את "Next/TS strict, package manager נעול, formatting/lint/test runners, CI".

בנוסף, `CLAUDE.md` אוסר "placeholder כיכולת" ו"טענה 'עובד' ללא פקודה ותוצאה". `package.json` עם scripts שמצביעים על כלים שאינם מותקנים היה יוצר בדיוק את הפער הזה: פקודה שנראית קיימת ואינה רצה.

## החלטה

ב־Milestone 0, "הגדר פקודות" פירושו **חוזה פקודות מתועד**, לא scripts מדומים:

1. `docs/COMMANDS.md` מגדיר כל אחת עשרה הפקודות: שם, מטרה, מחרוזת הפקודה המדויקת, השער שהיא משרתת וה־milestone שבו היא הופכת להרצה.
2. `package.json` מכיל **רק scripts שרצים באמת היום**: `unit`, `scan:forbidden`, `check:traceability`, `verify:m0`.
3. אין script שמדפיס "not implemented" ואין script שמסתיים בהצלחה בלי לעשות עבודה. פקודה שאינה קיימת עדיין — לא קיימת ב־`package.json`.
4. אין התקנת dependencies ב־Milestone 0. ההתקנה והנעילה שייכות ל־Milestone 1, לפי `09-MILESTONES.md`.
5. הבדיקות של Milestone 0 רצות על **`node --test` המובנה ב־Node**, שאינו דורש התקנה. בחירת runner ברמת האפליקציה (Vitest לפי ADR-0002) נעשית ב־Milestone 1.

## חלופות שנשקלו

| חלופה | יתרון | חיסרון | מדוע נדחתה |
|---|---|---|---|
| להתקין את כל ה־toolchain ב־M0 | כל השערים ירוקים מיד | מבצע את עבודת Milestone 1 בלי אישור; מכניס ~700MB ועשרות החלטות נעילה בלי ADR מלא | חורג מ־scope מאושר |
| scripts שמסתיימים ב־exit 1 עם "not implemented" | הפקודה "קיימת" | placeholder שמוצג כיכולת; CI אדום קבוע שמאמן להתעלם מכשלים | אסור לפי CLAUDE.md |
| scripts ריקים שמחזירים 0 | CI ירוק | hard-coded success — האיסור החמור ביותר בחוקה | נדחתה מיידית |
| חוזה פקודות + scripts אמיתיים בלבד (נבחר) | אין false completion; scope נשמר | פחות "ירוק" בדוח M0 | — |

## השלכות

- חיוביות: כל שורה בדוח ה־Checkpoint שמסומנת PASS מגובה בפקודה שהורצה ובפלט אמיתי. השערים שלא רצו מוצהרים כ־NOT RUN ולא כ־PASS.
- שליליות: דוח Milestone 0 מציג רק ארבעה שערים פעילים מתוך אחד עשר. זו תמונת אמת, לא חוסר.
- לאימות: `npm run verify:m0` חייב לעבור; `docs/COMMANDS.md` חייב לכסות את כל אחת עשרה הפקודות מסעיף 5 של ה־bootstrap.

## תנאי ביטול

Milestone 1 מרחיב את `package.json` לפקודות המלאות ומעדכן את `docs/COMMANDS.md` מ־"Defined" ל־"Active". ADR זה נשאר תקף כתיעוד הסיבה שהן לא היו שם ב־M0.
