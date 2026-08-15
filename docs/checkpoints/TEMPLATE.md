# CHECKPOINT — Milestone N

תבנית הראיות המחייבת. נגזרת מ־`CHECKPOINT-TEMPLATE.md` בשורש, שהוא הסמכות; כאן נוספו כללי מילוי כדי שהדוח יהיה ראיה ולא הצהרה.

**כללי מילוי**

1. שער מדווח `PASS` רק אם הפקודה הורצה, קוד היציאה האמיתי היה 0, והספירות מצוטטות מהפלט. שער שלא הורץ = `NOT RUN`. אף פעם לא `PASS` בהיעדר הרצה.
2. ב־pipeline יש לשמר קוד יציאה אמיתי (`set -o pipefail`, לכידת `$?`, `exit "$code"`). קוד יציאה של `tail`/`grep` אינו ראיה.
3. "עובד" = קוד קיים + בדיקה מהותית + פקודה שהורצה + תוצאה מתועדת + אין כשל מוסתר.
4. צילום מסך אינו ראיה ללוגיקה.
5. כל ממצא של ה־forbidden scan מדווח, גם אם תוקן — כולל מה תוקן וכיצד.
6. סעיף "לא הושלם" אינו נשאר ריק כברירת מחדל; אם באמת ריק, כותבים זאת מפורשות.

---

- Result: PASS / FAIL / PARTIAL
- Commit / branch / environment / date:

## Scope

- הושלם לפי Requirement IDs:
- לא הושלם, סיבה והשפעה:
- Out-of-scope שלא שונה:

## Changes

- files:
- migrations + forward/recovery evidence:
- ADRs:

## Commands & Evidence

| Gate | Command | Result | Counts / Evidence |
|---|---|---|---|
| Install | | | |
| Format | | | |
| Typecheck | | | |
| Lint | | | |
| Unit | | | |
| Property | | | |
| Integration/RLS | | | |
| E2E | | | |
| Build | | | |
| Forbidden scan | | | |
| Traceability | | | |
| Accessibility/RTL | | | |

## Negative verification

מה נבדק שהוא **נכשל כמצופה** (שער שמזהה הפרה, RLS שחוסם household זר, idempotency שמונע כפילות):

## Reviews

- Code:
- Financial invariants:
- Security/privacy:
- UX/RTL/states:

## Forbidden scan findings

## Risks, rollback, next proposed milestone

## Stop declaration

לא התחלתי את ה־Milestone הבא.
