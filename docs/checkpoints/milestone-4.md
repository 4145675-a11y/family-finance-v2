# CHECKPOINT — Milestone 4: Debt Domain

- **Result**: **PARTIAL — code and tests complete, database application still blocked**
- **Branch**: `milestone-2-identity-isolation` · לא בוצע merge
- **Environment**: local, Windows 11 Pro, Node v24.19.0, npm 11.17.0
- **Date**: 2026-08-23

> **למה PARTIAL**: החוזים, הסכמה, ה־RLS והחישובים נבדקו ועוברים. הטבלאות עצמן **לא הוחלו על מסד**, ולכן טריגר האימות של הגלגולים ואכיפת ה־RLS לא הורצו מעולם מול Postgres.

## Scope

### הושלם ואומת

| פריט | ראיה |
|---|---|
| אירועי חוב הם האמת (`FIN-DEBT-001`) | אין עמודת יתרה בטבלה; `replayDebtBalances()` הוא ההגדרה היחידה — 27 בדיקות |
| ריבית אינה מקטינה קרן | `DEBT_EVENT_BALANCE_EFFECT` מוגדר פעם אחת ב־contracts ומשמש גם את המנוע; נבדק גם כ־property |
| גלגול חוב (`FIN-ROLL-001`) | פירעון 5,000 שמומן ב־5,000 → שינוי נטו 0; מומן ב־4,000 → ירידה של 1,000 בלבד |
| הצעה אינה אישור | `status: 'proposed'` אינו נספר ב־`rolloverFundedRepaymentMinor` |
| תיקון יתרה נפרד | `balanceCorrectionMinor` מדווח בשורה משלו, לא כפירעון ולא כהתקדמות |
| סיכון דרישה 7/30/90 | `callRisk()` — כולל ריכוז אצל המלווה הגדול וזמן התראה ממוצע |
| חוב פרטי אינו מקור כסף | הלוואה אפשרית אינה נכנסת לתחזית; מוצגת כאזהרה בלבד |

### הושלם אך **לא אומת** (חסום)

| פריט | מצב |
|---|---|
| `20260822100100_debt_domain.sql` | `debts`, `debt_events`, `debt_rollovers`, 8 enums. **לא הוחלה** |
| `app.assert_rollover_references()` | דוחה קישור שמצביע על אירועים לא־קיימים, מסוג שגוי, בחוב אחר או במשק בית אחר. **לא הורץ** |
| `debt_rollovers_one_per_event_pair` | אילוץ ייחודיות שהופך אישור כפול ל־idempotent. **לא הורץ** |
| RLS על שלוש הטבלאות | אין UPDATE ואין DELETE על `debt_events`. **לא הורץ** |

### לא בוצע, ובכוונה

`debt_plans`, `debt_plan_items`, דירוג מומלץ וחלופות — Milestone 12. `02-FINANCIAL-RULES.md § קדימות חובות` אוסר snowball אוטומטי, וההמלצה דורשת שכבת advisor שאינה קיימת.

## Changes

**חדש**: `packages/contracts/src/debt.ts` + 18 בדיקות · `packages/finance-engine/src/debt.ts` + 27 בדיקות · `supabase/migrations/20260822100100_debt_domain.sql`

**שונה**: `packages/contracts/src/index.ts` · `supabase/migrations/20260822100200_financial_row_security.sql` (policies לשלוש הטבלאות)

## Commands & Evidence

הרצה משותפת ל־M3–M6 — ראה `docs/checkpoints/milestone-3.md § Commands & Evidence`. `npm run verify` exit 0: 581 unit, 24 property, build, 8/8 built shell, 89 קבצים נסרקו, traceability 34/34.

בדיקות שנוגעות ישירות ל־Milestone 4: 18 חוזה + 27 מנוע + 3 property על החוב, ועוד 19 ב־`snapshot.test.ts` שכוללות תרחיש מלא של החלפת נושה.

| Gate | Result |
|---|---|
| **Migrations** | **NOT RUN** — חסום |
| **Integration / RLS** | **FAILS BY DESIGN** — exit 1 עם הוראות, ללא `SUPABASE_DB_URL` |

## Negative verification

| מה נשבר בכוונה | תוצאה |
|---|---|
| חוב פרטי בלי `relationshipSensitivity` | חוזה דוחה |
| חוב מוסדי **עם** שדות יחסים | חוזה דוחה — רגישות לא תשפיע על דירוג של בנק |
| `balance_correction` בלי כיוון, וכיוון על אירוע שאינו תיקון | שניהם נדחים |
| גלגול מחוב לעצמו | חוזה ואילוץ DB דוחים |
| קישור `system_suggested` בלי confidence | נדחה |
| פירעון יתר על היתרה | היתרה נעצרת ב־0 ואינה מקזזת חוב אחר — נבדק כ־property |

## Reviews

- **Financial invariants**: "תשלום שאחריו נוצר חוב גדול יותר אינו התקדמות" — נאכף בכך ש־`incomeFundedPrincipalReduction` הוא היחיד שמסומן כהתקדמות, וה־UI אינו חוגג פירעון ברוטו.
- **Security/privacy**: audit על `debts`, `debt_events` ו־`debt_rollovers` בתמונה מצומצמת; `promise_summary` ו־`notes` **אינם** נכנסים ל־audit.
- **UX**: כרטיס "מה קרה באמת לחוב" נבנה ב־M6 (`UX-DEBT-002`).

## Stop declaration

לא מוזג ל־`main`. אין תוכנית חוב ואין המלצה מדורגת.
