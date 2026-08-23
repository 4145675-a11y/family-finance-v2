# CHECKPOINT — Milestone 3: Financial Accounts & Opening Picture

- **Result**: **PARTIAL — code and tests complete, database application still blocked**
- **Branch**: `milestone-2-identity-isolation` (M3–M6 נבנו על אותו ענף; לא בוצע merge)
- **Environment**: local, Windows 11 Pro, Node v24.19.0, npm 11.17.0 · אין remote, לא בוצע push
- **Date**: 2026-08-23

> **למה PARTIAL**: קריטריון הקבלה של Milestone 3 כולל טבלאות שמחזיקות את תמונת הפתיחה. הטבלאות נכתבו, ה־RLS נכתבה, והחוזים נבדקו — אך **אף מיגרציה לא הוחלה על מסד**. אותה חסימה של Milestone 2, ללא שינוי. `CLAUDE.md` אוסר PASS על migration שלא נבדקה.

## Scope

### הושלם ואומת

| פריט | ראיה |
|---|---|
| חוזי כסף (`FIN-MONEY-001`) | `packages/contracts/src/money.ts` — 15 בדיקות; סכום שלילי, שבר וסימן מטבע נדחים |
| חוזי חשבונות ותנועות | `accounts.ts` — 18 בדיקות; transfer בלי counterpart נדחה, splits שאינם שווים למקור נדחים |
| הפרדת scope (`FIN-SCOPE-001`) | `record_scope` הוא household/business בלבד; `consolidated` נדחה בחוזה ובסכמה |
| ניתוק כרטיס אשראי מנזילות | `LIQUID_ACCOUNT_KINDS` + בדיקות ב־`household.test.ts` |

### הושלם אך **לא אומת** (חסום על גישת DB)

| פריט | מצב |
|---|---|
| `20260822100000_financial_accounts.sql` | 7 טבלאות, 7 enums, אינדקסים, טריגרי audit. **לא הוחלה** |
| `20260822100200_financial_row_security.sql` | RLS enabled+forced על כל טבלה, policies לכל פקודה. **לא הוחלה** |
| טריגר `transaction_splits_sum_matches` | constraint trigger deferrable. **לא הורץ מול DB** |
| טריגר `app.audit_row_change()` | audit אוטומטי בתמונה מצומצמת. **לא הורץ מול DB** |

### לא בוצע, ובכוונה

`credit_card_statements`, `recurring_rules`, `import_*` — שייכים ל־Milestone 8. מסכי הזנה ידנית ו־onboarding לא נבנו: `CLAUDE.md` מציב contracts/schema/RLS/tests לפני UI, וה־UI שנבנה ב־M6 הוא הדשבורד בלבד.

## Changes

**חדש**: `packages/contracts/src/{money,accounts}.ts` + בדיקות · `supabase/migrations/20260822100000_financial_accounts.sql` · `supabase/migrations/20260822100200_financial_row_security.sql` · `docs/adr/0019-single-apply-all-bundle.md`

**שונה**: `packages/contracts/src/index.ts` · `tools/{build-manual-bundle,copy-sql,manual-sql.test,migrations.test}.mjs` · `supabase/manual/{apply-all,diagnostic}.sql` (שמות חדשים) · `package.json` (`db:build`, `db:check`, `db:copy:schema`)

## Commands & Evidence

הרצה אחת משותפת ל־M3–M6, `npm run verify`, **exit 0 אמיתי**:

| Gate | Command | Result | Counts |
|---|---|---|---|
| Format | `npm run format:check` | **PASS** | exit 0 |
| Typecheck | `npm run typecheck` | **PASS** | שורש + 4 workspaces |
| Lint | `npm run lint` | **PASS** | `--max-warnings=0` |
| Unit | `npm run unit` | **PASS** | **581 passed**, 0 failed, 0 skipped, 25 קבצים |
| Property | `npm run property` | **PASS** | 24 passed |
| Build | `npm run build` | **PASS** | exit 0 |
| Built-shell | `npm run check:shell` | **PASS** | 8/8 |
| Client secrets | `npm run check:client-secrets` | **PASS** | 16 מודולים + 12 קבצי bundle |
| Manual bundle | `npm run db:check` | **PASS** | 8 מיגרציות, תואם למקורות |
| Forbidden scan | `npm run scan:forbidden` | **PASS** | 89 קבצים, 0 errors |
| Traceability | `npm run check:traceability` | **PASS** | 34/34 |
| **Migrations** | — | **NOT RUN** | חסום — אין חיבור DB |

בדיקות סטטיות על המיגרציות: `tools/migrations.test.mjs` גדל מ־25 ל־82 בדיקות, וכולל כעת אכיפה גורפת — כל טבלה במאגר חייבת `enable` **וגם** `force row level security`, וכל טבלה חייבת policy אחת לפחות.

## Negative verification

| מה נשבר בכוונה | תוצאה |
|---|---|
| splits שסכומם אינו שווה לסכום הפעולה | חוזה דוחה; נבדק גם כ־property על טווח שלם |
| transfer בלי חשבון נגדי, ו־expense עם חשבון נגדי | שניהם נדחים |
| `displaySuffix` באורך 16 ספרות | נדחה — רק ארבע ספרות אחרונות |
| `record_scope = 'consolidated'` | נדחה בחוזה |

## Reviews

- **Code**: אין `any`, אין השתקות, אין TODO.
- **Financial invariants**: סכום לא־שלילי נאכף בחוזה וב־`app.is_valid_amount_minor()`; transfer נטו אפס נבדק כ־property.
- **Security/privacy**: `force row level security` על שבע הטבלאות; מפתחות זרים אינם מסוננים ב־RLS, ולכן כל policy שמקבלת הפניה מאמתת גם שהשורה המופנית נראית לקורא (`app.household_owns_*`).
- **UX/RTL/states**: אין UI ב־milestone הזה.

## 🔴 חסימה

זהה ל־Milestone 2 ומרוכזת שם: החלת המיגרציות דורשת סיסמת מסד. ראה `docs/checkpoints/milestone-2.md` § חסימה.

## Stop declaration

לא מוזג ל־`main`. `npm run integration` עדיין נכשל במכוון ללא `SUPABASE_DB_URL`.
