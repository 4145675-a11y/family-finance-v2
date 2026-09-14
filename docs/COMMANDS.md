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
| 8 | dev | `npm run dev` → `node tools/next.mjs dev` ב־`apps/web` | — (לא שער) | 1 | **Active** |
| 9 | build | `npm run build` → `node tools/next.mjs build` ב־`apps/web` | Build | 1 | **Active** |
| 10 | verify (aggregate) | `npm run verify` | כל השערים הפעילים ברצף | 1 | **Active** |
| 11 | verify (M0 subset) | `npm run verify:m0` | שערי M0 בלבד — נשמר כדי ש־checkpoint M0 יישאר משחזר | 0 | **Active** |
| 12 | property | `npm run property` → `vitest run --config vitest.property.config.ts` (fast-check, seed קבוע) | Property | 5 | **Active** |
| 13 | integration | `npm run integration` → `vitest run --config vitest.integration.config.ts` (כולל RLS negative tests) | Integration/RLS | 2 | **Active** — נכשל במכוון ללא `SUPABASE_DB_URL` |
| 14 | E2E | `npm run e2e` → `playwright test` | E2E | 6 | Defined |
| 15 | a11y/visual | `npm run a11y` → axe + RTL golden snapshots ב־360/390/768/1280 | Accessibility/RTL | 6 | Defined |
| 16 | built shell | `npm run check:shell` → `node tools/check-built-shell.mjs` | Hebrew RTL, landmarks ו־manifest **על השרת הרץ** (`ADR-0027`) | 1/7 | **Active** |
| 17 | client secrets | `npm run check:client-secrets` → `node tools/check-client-secrets.mjs` | גבול service role | 2 | **Active** |
| 18 | manual bundle | `npm run db:build` / `db:check` → `node tools/build-manual-bundle.mjs [--check]` | חבילת ההחלה תואמת למיגרציות | 3 | **Active** |
| 19b | fail-closed gate | `npm run check:fail-closed` → `node tools/check-fail-closed.mjs` | מריץ את ה־build האמיתי ומוודא שתצורת ייצור שגויה **אינה עולה**, ושתצורה תקינה כן | 9 | **Active** |
| 19c | env-file gate | `npm run check:no-env-files` → `node tools/check-no-env-files.mjs` | אף קובץ סביבה במעקב git או בתוך `.next` | 9 | **Active** |
| 19a | auth reset | `npm run auth:reset` → `node tools/auth-reset.mjs` | מסיר את מפתחות הכניסה והסשנים. **אינו נוגע בנתונים הכספיים.** דורש גישה למחשב; אין מסלול HTTP. עם `NODE_ENV=production` מסרב אלא אם נמסר `--i-am-at-the-machine` | 8 | **Active** |
| 19 | copy SQL | `npm run db:copy:diagnostic` · `npm run db:copy:schema` → `node tools/copy-sql.mjs <file>` | — (כלי החלה ידנית) | 2 | **Active** |

`unit` רץ על Vitest בלבד מ־Milestone 1 (`ADR-0009`). ב־Milestone 0 הוא רץ על `node --test` כי לא הותקנה שום תלות.

**טלמטריה**: אין מה לייצא ידנית. כל פקודת Next של הפרויקט עוברת דרך `tools/next.mjs`, שמכריח `NEXT_TELEMETRY_DISABLED=1` בכל מערכת הפעלה, ודורס גם ערך שהגיע בירושה. ב־CI המשתנה מוגדר גם ברמת ה־workflow כהגנה שנייה. script שמריץ `next` ישירות מפיל את `tools/next-telemetry.test.mjs` (`ADR-0011`).

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

Vitest, runner יחיד (`ADR-0009`). כרגע **581 בדיקות ב־25 קבצים**: כלי הבנייה והמיגרציות, חוזי Zod, finance-engine, ומודולי התצוגה של `apps/web`. `allowOnly: false` ו־`passWithNoTests: false` — ריצה ריקה או בדיקה ממוקדת נכשלות.

### `npm run property`

חבילה נפרדת עם config משלה (`vitest.property.config.ts`), כי unit ו־property הם שני סוגי ראיה ואין לדווח עליהם כמספר אחד. `seed: 20260823` ו־300 ריצות לכל property, כדי שכשל יהיה ניתן לשחזור על כל מכונה. הבדיקות מכסות את האינווריאנטים מ־`02-FINANCIAL-RULES.md § אינווריאנטים`.

### `npm run typecheck`

`tsc --noEmit` בשורש (קובצי קונפיגורציה) ובכל workspace. `tsconfig.base.json` מפעיל `strict` יחד עם `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitReturns`, `noUnusedLocals` ו־`noUnusedParameters`.

### `npm run lint`

ESLint flat config. הכללים של Next מוגבלים ל־`apps/web/**` בלבד — ללא הגבלה הם מדווחים על תיקיית `pages/` שאינה קיימת בחבילות אחרות. type-aware linting פעיל דרך `projectService`, כולל `no-floating-promises` ו־`no-misused-promises`, שתופסים הבטחה שנזרקה בשקט בזרימת כסף.

## כללי הרצה

1. אין `--force`, אין `--no-verify`, אין דילוג על שער.
2. ב־pipeline, קוד היציאה האמיתי נשמר: `set -o pipefail`, לכידת `$?` מיד אחרי הפקודה, ו־`exit "$code"` בסוף. אין להסתמך על קוד היציאה של `tail` או `grep`.
3. שער שלא הורץ מדווח `NOT RUN`, לעולם לא `PASS`.
4. התקנות הן project-local בלבד: `.npmrc` מקבע `cache=.npm-cache` בתוך הפרויקט. אין התקנות global.
