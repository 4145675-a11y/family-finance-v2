# COMMANDS — חוזה הפקודות

מקור האמת לשמות הפקודות, למחרוזת המדויקת ולשער שכל אחת משרתת. נוצר ב־Milestone 0 לפי `ADR-0003`.

**כלל יסוד**: פקודה מופיעה ב־`package.json` רק כאשר היא רצה באמת. אין script שמדפיס "not implemented", אין script ריק שמחזיר 0, ואין שער שמסומן PASS בלי פקודה שהורצה ופלט שתועד.

Package manager: **npm**, נעול לפי `ADR-0001`. אין להחליף בלי ADR.

## סטטוס

- **Active** — קיים ב־`package.json`, רץ היום, ומהווה ראיה קבילה.
- **Defined** — החוזה סגור; ההפעלה שייכת ל־milestone הרשום. אין script כזה כרגע.

| # | פקודה | מחרוזת | שער | Milestone | סטטוס |
|---:|---|---|---|---:|---|
| # | פקודה | מחרוזת | שער | Milestone | סטטוס |
|---:|---|---|---|---:|---|
| 1 | install | `npm ci --ignore-scripts` (ב־CI) / `npm install` (מקומי) | reproducible install | 0 | **Active** |
| 2 | unit | `npm run unit` → `vitest run` | Unit | 0 | **Active** |
| 3 | forbidden scan | `npm run scan:forbidden` → `node tools/forbidden-scan.mjs` | No False Completion | 0 | **Active** |
| 4 | traceability | `npm run check:traceability` → `node tools/check-traceability.mjs` | דרישה↔מיפוי | 0 | **Active** |
| 5 | format | `npm run format` → `prettier --write .` · `format:check` → `prettier --check .` | Format | 1 | **Active** |
| 6 | typecheck | `npm run typecheck` → `tsc --noEmit` בשורש ובכל workspace | Typecheck | 1 | **Active** |
| 7 | lint | `npm run lint` → `eslint . --max-warnings=0` (flat config) | Lint | 1 | **Active** |
| 8 | dev | `npm run dev` → `next dev` ב־`apps/web` | — (לא שער) | 1 | **Active** |
| 9 | build | `npm run build` → `next build` ב־`apps/web` | Build | 1 | **Active** |
| 10 | verify (aggregate) | `npm run verify` | כל השערים הפעילים ברצף | 1 | **Active** |
| 11 | verify (M0 subset) | `npm run verify:m0` | שערי M0 בלבד — נשמר כדי ש־checkpoint M0 יישאר משחזר | 0 | **Active** |
| 12 | property | `npm run property` → `vitest run --project property` (fast-check) | Property | 5 | Defined |
| 13 | integration | `npm run integration` → `vitest run --project integration` (כולל RLS negative tests) | Integration/RLS | 2 | Defined |
| 14 | E2E | `npm run e2e` → `playwright test` | E2E | 6 | Defined |
| 15 | a11y/visual | `npm run a11y` → axe + RTL golden snapshots ב־360/390/768/1280 | Accessibility/RTL | 6 | Defined |

`unit` רץ על Vitest בלבד מ־Milestone 1 (`ADR-0009`). ב־Milestone 0 הוא רץ על `node --test` כי לא הותקנה שום תלות.

**משתנה סביבה מקומי**: מומלץ לייצא `NEXT_TELEMETRY_DISABLED=1` לפני `dev`/`build`. ב־CI זה כבר מוגדר ברמת ה־workflow (`ADR-0010`).

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

Vitest, runner יחיד (`ADR-0009`). כרגע 88 בדיקות בארבעה קבצים: כללי ה־forbidden scan (18), חישוב ניגודיות (15), tokens והתאמתם ל־CSS (42), ומעטפת ה־HTML העברית (13). `allowOnly: false` ו־`passWithNoTests: false` — ריצה ריקה או בדיקה ממוקדת נכשלות.

### `npm run typecheck`

`tsc --noEmit` בשורש (קובצי קונפיגורציה) ובכל workspace. `tsconfig.base.json` מפעיל `strict` יחד עם `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitReturns`, `noUnusedLocals` ו־`noUnusedParameters`.

### `npm run lint`

ESLint flat config. הכללים של Next מוגבלים ל־`apps/web/**` בלבד — ללא הגבלה הם מדווחים על תיקיית `pages/` שאינה קיימת בחבילות אחרות. type-aware linting פעיל דרך `projectService`, כולל `no-floating-promises` ו־`no-misused-promises`, שתופסים הבטחה שנזרקה בשקט בזרימת כסף.

## כללי הרצה

1. אין `--force`, אין `--no-verify`, אין דילוג על שער.
2. ב־pipeline, קוד היציאה האמיתי נשמר: `set -o pipefail`, לכידת `$?` מיד אחרי הפקודה, ו־`exit "$code"` בסוף. אין להסתמך על קוד היציאה של `tail` או `grep`.
3. שער שלא הורץ מדווח `NOT RUN`, לעולם לא `PASS`.
4. התקנות הן project-local בלבד: `.npmrc` מקבע `cache=.npm-cache` בתוך הפרויקט. אין התקנות global.
