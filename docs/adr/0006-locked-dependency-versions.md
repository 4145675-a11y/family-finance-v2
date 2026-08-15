# ADR-0006: נעילת גרסאות — שתי סטיות מהבסיס של ADR-0002

- **Status**: Accepted
- **Date**: 2026-08-16
- **Milestone**: 1
- **Requirement IDs**: —

## הקשר

`ADR-0002` תיעד את הגרסאות ה־stable שנמדדו ב־bootstrap וקבע: "כל סטייה מהטבלה הזו בזמן הנעילה מחייבת שורה מנומקת ב־ADR של Milestone 1". `05-ARCHITECTURE-DATA.md` מחייב stack עדכני ו־ADR לסטייה.

בבדיקת ה־peer dependencies בפועל התברר ששתיים מהגרסאות ה"אחרונות" אינן ניתנות לשילוב עם שאר ה־toolchain.

## החלטה

הגרסאות הבאות נעולות ב־`package.json` בגרסה מדויקת (`save-exact=true`), ו־`package-lock.json` מחויב למאגר.

| חבילה | ננעל | בסיס ADR-0002 | סטייה |
|---|---|---|---|
| next | 16.3.1 | 16.3.1 | — |
| react / react-dom | 19.2.8 | 19.2.8 | — |
| **typescript** | **6.0.3** | 7.0.2 | **כן — ראה סטייה 1** |
| tailwindcss / @tailwindcss/postcss | 4.3.3 | 4.3.3 | — |
| **eslint** | **9.39.5** | 10.8.1 | **כן — ראה סטייה 2** |
| @eslint/js | 9.39.5 | — | תואם ל־eslint |
| typescript-eslint | 8.67.0 | — | — |
| eslint-config-next | 16.3.1 | — | — |
| prettier | 3.9.6 | 3.9.6 | — |
| vitest | 4.1.10 | 4.1.10 | — |
| globals | 17.11.0 | — | נוסף — ראה למטה |
| @types/node | 26.2.0 | — | — |
| @types/react / @types/react-dom | 19.2.18 / 19.2.4 | — | — |
| postcss | 8.5.26 | — | — |

### סטייה 1 — TypeScript 6.0.3 במקום 7.0.2

`typescript-eslint@8.67.0` (הגרסה האחרונה) מצהיר:

```json
"peerDependencies": { "typescript": ">=4.8.4 <6.1.0" }
```

TypeScript 7 אינו נתמך על ידי ה־linter. בלי typescript-eslint אין type-aware linting, ושער ה־lint הופך לבדיקת תחביר בלבד — לא קביל בפרויקט שבו טעות טיפוס היא טעות בכסף. `6.0.3` היא הגרסה הגבוהה ביותר שעומדת באילוץ.

נשקל ונדחה: לכפות את ההתקנה עם `overrides`. כפיית peer על כלי שמנתח AST של TypeScript היא הזמנה לכשל שקט; העדפנו גרסה נתמכת על פני מספר גבוה יותר.

### סטייה 2 — ESLint 9.39.5 במקום 10.8.1

עם ESLint 10 ההתקנה עברה, אך עם שלוש אזהרות `ERESOLVE overriding peer dependency`. שלושת התוספים שמגיעים עם `eslint-config-next` תומכים ב־ESLint עד `^9` בלבד:

| תוסף | peer מוצהר |
|---|---|
| eslint-plugin-import@2.32.0 | `^2 … ^8 \|\| ^9` |
| eslint-plugin-jsx-a11y@6.10.2 | `^3 … ^8 \|\| ^9` |
| eslint-plugin-react@7.37.5 | `^3 … ^8 \|\| ^9.7` |

`eslint-plugin-jsx-a11y` הוא התוסף שאוכף חלק מ־`UX-A11Y-001`. להריץ אותו על peer שנכפה פירושו להסתמך על כלי נגישות שלא הוצהר כתואם. ESLint 9.39.5 מספק את כל השלושה נקי.

**קריטריון הקבלה שנבחר: התקנה ללא אף `ERESOLVE`.** אומת: `npm install --dry-run` אינו מפיק אזהרת peer.

### תוספת — `globals@17.11.0`

ESLint flat config אינו כולל רשימת globals של Node. בלעדיה `URL` ו־`process` בקבצי `tools/` נופלים על `no-undef`. החלופה — לתחזק רשימה ידנית — מתיישנת בשקט.

## השלכות

- חיוביות: אין peer כפוי; lint type-aware פעיל; התקנה דטרמיניסטית מ־lockfile.
- שליליות: הפרויקט אינו על TypeScript 7 ולא על ESLint 10. שני הפערים נסגרים כשהמערכת האקולוגית מתיישרת.
- לאימות: `npm ci` + `typecheck` + `lint` + `build` — כולם עברו, מתועד ב־`docs/checkpoints/milestone-1.md`.

## תנאי ביטול

שדרוג ל־TypeScript 7 ייבחן כאשר `typescript-eslint` יפרסם peer שכולל `^7`. שדרוג ל־ESLint 10 ייבחן כאשר שלושת התוספים יצהירו `^10`. בכל מקרה — בדיקה מחדש של `npm install --dry-run` ללא אזהרות, ואז ADR מעדכן.
