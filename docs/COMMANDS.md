# COMMANDS — חוזה הפקודות

מקור האמת לשמות הפקודות, למחרוזת המדויקת ולשער שכל אחת משרתת. נוצר ב־Milestone 0 לפי `ADR-0003`.

**כלל יסוד**: פקודה מופיעה ב־`package.json` רק כאשר היא רצה באמת. אין script שמדפיס "not implemented", אין script ריק שמחזיר 0, ואין שער שמסומן PASS בלי פקודה שהורצה ופלט שתועד.

Package manager: **npm**, נעול לפי `ADR-0001`. אין להחליף בלי ADR.

## סטטוס

- **Active** — קיים ב־`package.json`, רץ היום, ומהווה ראיה קבילה.
- **Defined** — החוזה סגור; ההפעלה שייכת ל־milestone הרשום. אין script כזה כרגע.

| # | פקודה | מחרוזת | שער | Milestone | סטטוס |
|---:|---|---|---|---:|---|
| 1 | install | `npm ci` (ב־CI) / `npm install` (מקומי) | reproducible install | 0 | **Active** |
| 2 | unit | `npm run unit` → `node --test "tools/**/*.test.mjs"` | Unit | 0 | **Active** |
| 3 | forbidden scan | `npm run scan:forbidden` → `node tools/forbidden-scan.mjs` | No False Completion | 0 | **Active** |
| 4 | traceability | `npm run check:traceability` → `node tools/check-traceability.mjs` | דרישה↔מיפוי | 0 | **Active** |
| 5 | verify (aggregate) | `npm run verify:m0` | כל שערי M0 ברצף | 0 | **Active** |
| 6 | format | `npm run format` → `prettier --write .` · `format:check` → `prettier --check .` | Format | 1 | Defined |
| 7 | typecheck | `npm run typecheck` → `tsc --noEmit` בכל workspace | Typecheck | 1 | Defined |
| 8 | lint | `npm run lint` → `eslint .` (flat config, `--max-warnings=0`) | Lint | 1 | Defined |
| 9 | dev | `npm run dev` → `next dev` ב־`apps/web` | — (לא שער) | 1 | Defined |
| 10 | build | `npm run build` → `next build` ב־`apps/web` | Build | 1 | Defined |
| 11 | property | `npm run property` → `vitest run --project property` (fast-check) | Property | 5 | Defined |
| 12 | integration | `npm run integration` → `vitest run --project integration` (כולל RLS negative tests) | Integration/RLS | 2 | Defined |
| 13 | E2E | `npm run e2e` → `playwright test` | E2E | 6 | Defined |
| 14 | a11y/visual | `npm run a11y` → axe + RTL golden snapshots ב־360/390/768/1280 | Accessibility/RTL | 6 | Defined |

הפקודה `unit` תורחב ב־Milestone 1 כך שתריץ גם את בדיקות ה־workspaces דרך Vitest, לצד בדיקות הכלים שרצות ב־`node --test`. `node --test` נבחר ל־Milestone 0 משום שהוא מובנה ב־Node ואינו דורש התקנה.

## פירוט השערים הפעילים

### `npm run scan:forbidden`

אוכף את "אין השלמה מדומה" מ־`CLAUDE.md` ואת השער הגלובלי מ־`08-TEST-PLAN.md`. עשרה כללים: סמן עבודה לא גמורה, test double במסלול production, בדיקה מושבתת/ממוקדת, השתקת type checking, השתקת lint, catch ריק, assertion טאוטולוגית, חומר מפתח פרטי, secret inline, ו־production seed.

החלטות scope:

- נסרקים רק קבצי קוד (`.ts .tsx .js .jsx .mjs .cjs .sql .css .yml .yaml`) תחת `apps`, `packages`, `tools`, `supabase`, `scripts`, `.github` ובשורש.
- קבצי Markdown אינם נסרקים: מסמכי החוקה חייבים להיות מסוגלים לנקוב בשמות הדפוסים כדי לאסור אותם.
- כל שורה נבדקת גם בגרסה מפוצלת ב־camelCase, כדי ש־`createMockSupabaseClient` ייתפס ולא רק `mock`.
- כללים המסומנים `productionOnly` אינם חלים על נתיבי `.test.` / `.spec.` / `tests/` / `e2e/` / `fixtures/` / `__mocks__/`.
- שני קבצי הסורק עצמם מוחרגים ומכוסים בבדיקות — `ADR-0005`.
- אין השתקה ברמת שורה. תוספת החרגה מחייבת ADR.

exit 0 = נקי · exit 1 = ממצאי error · exit 2 = הסורק עצמו נכשל.

### `npm run check:traceability`

אוכף ארבעה אינווריאנטים: כל מזהה שמופיע במסמך סמכות רשום ב־`docs/REQUIREMENTS.md`; כל מזהה רשום ממופה ב־`10-TRACEABILITY-MATRIX.md`; אין מיפוי למזהה לא רשום; כל שורת מרשם מצטטת מסמך קיים.

### `npm run unit`

מריץ את בדיקות הכלים דרך `node --test`. כרגע: כיסוי מלא לכללי ה־forbidden scan (18 בדיקות).

## כללי הרצה

1. אין `--force`, אין `--no-verify`, אין דילוג על שער.
2. ב־pipeline, קוד היציאה האמיתי נשמר: `set -o pipefail`, לכידת `$?` מיד אחרי הפקודה, ו־`exit "$code"` בסוף. אין להסתמך על קוד היציאה של `tail` או `grep`.
3. שער שלא הורץ מדווח `NOT RUN`, לעולם לא `PASS`.
4. התקנות הן project-local בלבד: `.npmrc` מקבע `cache=.npm-cache` בתוך הפרויקט. אין התקנות global.
